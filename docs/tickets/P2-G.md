# P2-G — The access library

## Outcome

The repository has one server-only access library that validates every access record and key, captures exactly one configured owner, converts an invitation without losing an existing grant, and returns the complete document capability decision used by every later gate and API.

## Context

Identity proves who a caller is; it must not decide what that person may do on one document. `netlify/lib/access.mjs` is the sole authority for the second question, so the edge gate, session endpoint, access API, comment/edit enforcement, suggestion API, realtime token endpoint, and standalone connect tool do not grow competing role rules.

Authority is runtime state, not document content. The first owner is seeded by the site-level `DOC_OWNERS` environment variable and captured once in Netlify Blobs; later grants and transfers live only in the `doc-state` store. No owner, role, email, or capability claim from `doc.json`, built HTML, query parameters, headers, or request bodies is authoritative.

## Scope

### In scope

- Create `netlify/lib/access.mjs` as an ESM module with exactly the runtime exports, JSDoc types, result shapes, and behavior under **Interface contract**.
- Read `DOC_OWNERS` in both Node Functions and Edge Functions without caching it across invocations.
- Parse and strictly validate the complete `DOC_OWNERS` value as comma-separated `docId:email` pairs.
- Normalize and validate email addresses once, and derive the invitation-key hash with Web Crypto.
- Build and validate all document-access, grant, and invitation prefixes and keys.
- Validate the three version-1 access record shapes before any record affects authorization or is written by this module.
- Define the immutable capability matrix for `owner`, `editor`, `commenter`, `viewer`, and `none`.
- Resolve one role by the fixed precedence in this ticket, including the unshared organization default and explicit-grant override.
- Capture the initial owner with one create-only `onlyIfNew` write and resolve a concurrent loser from the winning record.
- Let a caller explicitly opt into invitation consumption; create or preserve the grant before deleting the invitation.
- Normalize access-library failures into stable, privacy-safe errors while preserving P2-B `StoreError` failures.
- Publish stable contracts for P2-F, P3-H, P3-J, P4-J, P4-M, P4-O, P4-S, and P4-T.

### Out of scope

- Amending `netlify/lib/identity.mjs`. P2-H removes temporary identity capabilities and adds `isOrg` independently.
- Creating or amending any Function, Edge Function, HTML, CSS, client script, connect tool, package manifest, lockfile, test file, or Netlify configuration.
- `GET`, `POST`, `PATCH`, `DELETE`, or transfer handlers for `/api/access`. P3-H and P4-J own those HTTP surfaces.
- Listing members or invitations. P3-H uses the exported prefixes and validators to do its own bounded list/get work.
- Creating invitations, creating Identity accounts, sending recovery email, changing roles, revoking access, changing `orgDefault`, or transferring ownership. P4-J owns those state transitions.
- Consuming a Netlify Identity recovery/invite token. P4-K owns the acceptance page and endpoint.
- Enforcing capabilities in thread, edit, suggestion, or realtime handlers. P2-F, P4-M, and P4-O consume the result.
- Writing audit events. P4-J writes the four `access.*` events; invitation conversion intentionally writes no event.
- Adding a per-user index, “shared with me” query, group grants, co-owners, cross-document revoke, bearer share link, or first-writer-wins owner claim.
- Moving authority into Identity roles, `appMetadata.docs`, `doc.json`, the build manifest, HTML, client state, or `data-session`.
- Hiding storage or configuration outages as `role: "none"`. Ordinary absence is no access; unavailable or corrupt authority is an error.

## Interface contract

### Runtime exports and public JSDoc types

`netlify/lib/access.mjs` must have exactly these named runtime exports and no default export:

```js
export class AccessError extends Error {}
export const ROLE_CAPABILITIES = Object.freeze({ /* exact table below */ });

export function normalizeEmail(value)
export function parseDocOwners(value)
export async function emailHash(email)
export function assertIdentitySub(sub)

export function assertAccessDocument(value, expectedDocId)
export function assertAccessGrant(value, expectedDocId, expectedSub)
export function assertAccessInvitation(value, expectedDocId)
export async function assertAccessInvitationAtKey(value, expectedDocId, key, expectedEmail = undefined)

export function accessDocumentKey(docId)
export function accessGrantPrefix(docId)
export function accessGrantKey(docId, sub)
export function accessInvitationPrefix(docId)
export async function accessInvitationKey(docId, email)

export function capabilitiesFor(role)
export async function resolveRole(docId, user, options = {})
```

Do not export private regular expressions, runtime-environment readers, actor/timestamp validators, invitation lookup/conversion helpers, storage wrappers, or mutable aliases of the capability rows.

Use one static named import from P2-B's sibling module and no local declaration that shadows either delegated validator/read helper:

```js
import {
  StoreError,
  assertDocId,
  assertKey,
  docState,
  read,
  upgrade,
} from "./store.mjs";
```

Every access-record validator calls this imported `upgrade()` directly before domain-field validation. Every document, grant, and invitation read calls this imported `read()`; executable code in `access.mjs` never invokes `getWithMetadata()` directly, through bracket notation, or through a locally reimplemented read wrapper.

Define these public JSDoc types next to the exports exactly as shown. They are compile-time/editor contracts and do not add runtime exports:

```js
/** @typedef {"owner" | "editor" | "commenter" | "viewer" | "none"} DocumentRole */
/** @typedef {"any" | "own" | "none"} ThreadControl */
/** @typedef {{ sub: string, email: string, name: string, isOrg: boolean }} AccessUser */
/** @typedef {{ sub: string, name: string, email: string }} AccessActor */
/**
 * @typedef {{
 *   v: 1,
 *   docId: string,
 *   ownerSub: string,
 *   ownerEmail: string,
 *   orgDefault: "commenter" | "viewer" | "none",
 *   boundAt: string,
 *   boundFrom: "env:DOC_OWNERS"
 * }} AccessDocument
 */
/**
 * @typedef {{
 *   v: 1,
 *   docId: string,
 *   sub: string,
 *   email: string,
 *   name: string,
 *   role: "editor" | "commenter" | "viewer",
 *   grantedBy: AccessActor,
 *   grantedAt: string,
 *   fromInvitation: string | null
 * }} AccessGrant
 */
/**
 * @typedef {{
 *   v: 1,
 *   docId: string,
 *   email: string,
 *   role: "editor" | "commenter" | "viewer",
 *   invitedBy: AccessActor,
 *   invitedAt: string,
 *   expiresAt: string,
 *   accountCreated: boolean
 * }} AccessInvitation
 */
/**
 * @typedef {{
 *   canRead: boolean,
 *   canComment: boolean,
 *   threadControl: ThreadControl,
 *   canSuggest: boolean,
 *   canEdit: boolean,
 *   canAccept: boolean,
 *   canShare: boolean,
 *   canSeeMembers: boolean
 * }} AccessCapabilities
 */
/** @typedef {{ role: DocumentRole, shared: boolean } & AccessCapabilities} ResolvedAccess */
/**
 * @typedef {{
 *   getWithMetadata(key: string, options: { type: "json", consistency: "strong" }): Promise<null | { data: unknown, etag: string }>,
 *   setJSON(key: string, value: object, options: { onlyIfNew: true }): Promise<{ modified: boolean, etag?: string }>,
 *   delete(key: string): Promise<unknown>
 * }} AccessStore
 */
/**
 * @typedef {{
 *   consumeInvitation?: boolean,
 *   store?: AccessStore,
 *   docOwners?: string,
 *   now?: string
 * }} ResolveOptions
 */
```

`AccessUser` is the final P2-H server identity. `options.store`, `options.docOwners`, and `options.now` are dependency seams for deterministic tests; production callers omit them. An explicit `docOwners` value, including `""`, overrides runtime environment lookup. `options` must be a non-null, non-array object whose prototype is exactly `Object.prototype`, with no own symbol keys and no own string key except `consumeInvitation`, `store`, `docOwners`, or `now`; null-prototype and custom-prototype option objects are invalid. If present, `consumeInvitation` is a boolean, `docOwners` is a string, and `now` is an exact UTC ISO 8601 timestamp with milliseconds. If present, `store` is a non-null object whose `getWithMetadata`, `setJSON`, and `delete` properties are callable; inherited methods and additional provider methods are allowed, but any missing/non-callable required method is invalid even when the current role path would not need that operation. Unknown or malformed options produce `AccessError("invalid-option", 500, "Invalid access option")`.

After `docId`, the complete options object, any explicit `options.now`, and the complete non-null user—including one required `normalizeEmail()` call for a non-empty email—have passed validation, sample the invocation time exactly once with this expression. Retain that normalized email for every later comparison, lookup, and snapshot; do not normalize it again after sampling:

```js
const now = options.now ?? new Date().toISOString();
```

Do not call `new Date()` without an argument anywhere else in `resolveRole()` or a helper it calls. Invalid input or options reject before this sample. A valid `user === null` call samples once and then returns without environment or store work. Every later comparison and every record made by the call uses this one `now` string. Thus production callers that omit `now` use one real UTC sample, while tests can supply one deterministic value without reading the clock.

`resolveRole()` accepts `user === null` or a plain object with exactly the four `AccessUser` keys. Before sampling the clock, `sub` passes `assertIdentitySub()`. `name` must be a string with `name.length <= 200`, measured in JavaScript UTF-16 code units; the empty string and exactly 200 code units are valid, and no trimming or fallback occurs here. `isOrg` is a boolean. `email` is a string. The empty string means no usable address; before sampling the clock, every non-empty value is passed through `normalizeEmail()` exactly once and the retained normalized result is used for owner comparison, invitation lookup, and any grant snapshot. This intentionally accepts P2-H's lower-case-but-untrimmed verified provider value while ensuring stored authority is canonical. If normalization fails, wrap it as `AccessError("invalid-user", 500, "Invalid access user", { cause })`; a malformed server identity is not a client email error. The library does not derive `isOrg` from the address and does not accept P1-C's temporary `roles`, `canComment`, `canEdit`, or `docs` fields. Any other malformed non-null server user has the same `invalid-user` error, except that a bad subject retains `assertIdentitySub()`'s narrower error.

### Access record shapes

Every access record is a non-null, non-array plain JSON object with exactly the keys shown. It carries `v: 1` and also passes P2-B `upgrade()`. Every timestamp matches `YYYY-MM-DDTHH:mm:ss.sssZ` and round-trips through `new Date(value).toISOString()`.

Every person snapshot uses the same scalar limits as `AccessUser`: its `sub` passes `assertIdentitySub()`; its `name` is a string with `name.length <= 200`, with `""` and exactly 200 UTF-16 code units both valid; and its `email` is either `""` or a non-empty string already equal to `normalizeEmail(email)`. Values are validated as stored and are never trimmed, lowercased, truncated, or defaulted by a record validator. This contract applies to the grant's top-level `sub`, `email`, and `name` and to both exact nested actor objects, `grantedBy` and `invitedBy`. The invitation's own top-level `email` and the document's `ownerEmail` are stricter: each must be non-empty and already normalized because each is bound to an email-derived configuration or key.

The document access record at `access/<docId>/doc.json` is:

```json
{
  "v": 1,
  "docId": "4b7d2a",
  "ownerSub": "u_fixture_owner_11",
  "ownerEmail": "owner@example.com",
  "orgDefault": "commenter",
  "boundAt": "2026-09-02T16:04:11.221Z",
  "boundFrom": "env:DOC_OWNERS"
}
```

- `ownerSub` passes `assertIdentitySub()` and is the sole owner authority after binding.
- `ownerEmail` is a normalized audit/display snapshot. A later email change does not remove the owner.
- `orgDefault` is exactly `"commenter"`, `"viewer"`, or `"none"`. It is never `"owner"` or `"editor"`.
- `boundFrom` is exactly `"env:DOC_OWNERS"`. `boundAt` records the first capture and is not rewritten by transfer.

The grant at `access/<docId>/u/<sub>.json` is:

```json
{
  "v": 1,
  "docId": "4b7d2a",
  "sub": "u_fixture_reviewer_22",
  "email": "reviewer@partner.invalid",
  "name": "River Vale",
  "role": "commenter",
  "grantedBy": {
    "sub": "u_fixture_owner_11",
    "name": "Avery Quill",
    "email": "owner@example.com"
  },
  "grantedAt": "2026-09-02T16:20:41.002Z",
  "fromInvitation": "d3a028e466c0c42c5f0f183aa57bb123"
}
```

- `role` is exactly `"editor"`, `"commenter"`, or `"viewer"`. `"owner"` and `"none"` are never grant values.
- `sub` is the authority. The top-level `email`/`name` use the person-snapshot scalar contract above and need not equal a later session after an account rename.
- `fromInvitation` is `null` or exactly 32 lower-case hexadecimal characters.
- `grantedBy` has exactly `sub`, `name`, and `email`, each validated by the person-snapshot scalar contract above; it comes from a proven server session, never a request actor field.

The invitation at `access/<docId>/i/<emailHash>.json` is:

```json
{
  "v": 1,
  "docId": "4b7d2a",
  "email": "reviewer@partner.invalid",
  "role": "commenter",
  "invitedBy": {
    "sub": "u_fixture_owner_11",
    "name": "Avery Quill",
    "email": "owner@example.com"
  },
  "invitedAt": "2026-09-02T16:18:11.400Z",
  "expiresAt": "2026-10-02T16:18:11.400Z",
  "accountCreated": true
}
```

- `email` is normalized. The synchronous body validator proves that stored shape; the asynchronous contextual validator separately proves that its hash equals the key segment used to read the record.
- `role` is one of the three grantable roles.
- `invitedBy` has exactly `sub`, `name`, and `email`, each validated by the person-snapshot scalar contract above.
- `expiresAt` is exactly 30 days after `invitedAt`.
- `accountCreated` is a boolean. P2-G never creates an account or changes this field.

`assertAccessDocument()`, `assertAccessGrant()`, and `assertAccessInvitation()` first call P2-B `upgrade()` and preserve its `invalid-record` or `unsupported-version` `StoreError`. After that common envelope gate, they return the same object reference on success. They reject a wrong/missing/extra domain key, custom-prototype value, bad nested actor, mismatched expected document/subject, bad role, bad timestamp, or wrong invitation duration with `AccessError("invalid-record", 500, "Invalid access record")`. They accept ordinary objects produced by `JSON.parse`; they never repair, trim, default, or partially accept stored authority. `assertAccessInvitation(value, expectedDocId)` is deliberately synchronous: it validates the exact invitation body, including canonical non-empty `email`, but it does not claim to compute or compare the asynchronous email hash.

`assertAccessInvitationAtKey(value, expectedDocId, key, expectedEmail = undefined)` is the one asynchronous contextual validator. It first calls `assertAccessInvitation(value, expectedDocId)`. If `expectedEmail` is supplied, it must be a non-empty already-normalized email exactly equal to the validated body email. The helper then awaits `accessInvitationKey(expectedDocId, value.email)` and requires `key` to be that exact full key; a prefix, bare hash, differently cased key, malformed/non-string key, body/key hash mismatch, or supplied-email mismatch rejects with `AccessError("invalid-record", 500, "Invalid access record")`. It returns the same validated object reference on success. `resolveRole()` supplies the proven normalized caller email; downstream list consumers omit `expectedEmail` and still prove the body-email/full-key hash relation. No caller may treat the synchronous body validator alone as proof that an invitation came from its storage key.

### `DOC_OWNERS` parsing and runtime lookup

The server value is a comma-separated list of `docId:email` pairs:

```text
4b7d2a:owner@example.com,0a1b2c:second-owner@example.com
```

`parseDocOwners(value)` returns a fresh `Map<string, string>` from permanent document ID to normalized email and follows these exact rules:

1. `undefined`, `""`, or ASCII-whitespace-only input returns an empty map. `null` and every other non-string are invalid configuration.
2. Reject a UTF-8 value above 5000 bytes. Netlify's current site-environment-variable value limit is 5000 characters; the byte check is the narrower portable boundary.
3. Split on commas. Trim ASCII whitespace around each pair, document segment, and email segment.
4. Every non-empty pair contains exactly one `:`. Empty pairs, a leading/trailing comma, or another colon are invalid.
5. Validate the document segment through P2-B `assertDocId()` after trimming. Do not lowercase, repair, or accept a slug.
6. Normalize and validate the email through `normalizeEmail()`.
7. Reject a repeated document ID even when both entries normalize to the same email. One document has one seed owner.
8. The same normalized email may own more than one document.
9. Preserve insertion order; do not expose the raw string in an error or log.

With no explicit `options.docOwners`, `resolveRole()` reads the value for each invocation as follows:

- In an Edge Function, use `globalThis.Netlify?.env?.get("DOC_OWNERS")`.
- Otherwise use `globalThis.process?.env?.DOC_OWNERS` in a Node Function.
- Do not read `DOC_OWNERS` from `netlify.toml`, a `.env` file directly, built HTML, request data, or a client global.
- Do not cache the parsed map at module load. A warm function isolate must not retain a value across invocations or tests.

`DOC_OWNERS` must be configured as a site environment variable available to the Functions scope, which also makes it available to Edge Functions. Current Netlify behavior applies a changed value only after a new deploy. P4-S therefore sets the complete value before the initial deploy, and an operator who corrects an unbound value must redeploy. Once a document record exists, changing or removing the environment value has no effect on its owner.

### Email and subject normalization

`normalizeEmail(value)` returns the ASCII-trimmed, lower-case address. It rejects with `invalid-email` unless all are true:

- the input is a string and the normalized result is at most 254 characters;
- the local part is 1 through 64 ASCII characters from `A-Z`, `a-z`, digits, and ``.!#$%&'*+/=?^_`{|}~-``;
- there is exactly one `@`;
- the domain contains at least two DNS labels; each label starts and ends with an alphanumeric character, contains only alphanumerics or `-`, and is at most 63 characters;
- the value contains no comma, colon, slash, backslash, control, whitespace, quoted local part, or Unicode domain spelling.

The function does not perform mailbox delivery or DNS validation. P4-J uses this same function before it constructs an invitation.

`emailHash(email)` first calls `normalizeEmail(email)`, encodes the normalized string as UTF-8, computes SHA-256 with `crypto.subtle.digest`, and returns the first 32 lower-case hexadecimal characters. It accepts no precomputed/client hash. Exact fixtures:

| Input | Normalized input | Result |
|---|---|---|
| `" OWNER@SAMPLE.INVALID "` | `owner@sample.invalid` | `78f632ac5b62c89afb35f389d6d0436b` |
| `"Reviewer@Partner.Invalid"` | `reviewer@partner.invalid` | `d3a028e466c0c42c5f0f183aa57bb123` |

The hash is key hygiene, not secrecy. Plain email addresses remain in access records, so no response or log may describe the hash as anonymization.

`assertIdentitySub(sub)` returns the unchanged string only when it matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`. It never trims or lowercases. Its segment grammar rejects `/`, `\\`, `%`, whitespace, control characters, an empty value, and values above 128 characters with `invalid-sub`; therefore both `%2F` and `%2f` are invalid identity subjects. This does not change P2-B's generic full-key boundary: `assertKey()` rejects only the literal, case-sensitive leading prefix `%2F`, while a leading lowercase `%2f` remains valid there. P2-G's P2-B fixture and tests must preserve that exact distinction.

### Access key builders

Every builder validates `docId` through P2-B `assertDocId()`, validates its own segment, validates the final value through P2-B `assertKey()`, and returns the exact deterministic form below:

| Call | Exact result |
|---|---|
| `accessDocumentKey("4b7d2a")` | `access/4b7d2a/doc.json` |
| `accessGrantPrefix("4b7d2a")` | `access/4b7d2a/u/` |
| `accessGrantKey("4b7d2a", "u_fixture_reviewer_22")` | `access/4b7d2a/u/u_fixture_reviewer_22.json` |
| `accessInvitationPrefix("4b7d2a")` | `access/4b7d2a/i/` |
| `await accessInvitationKey("4b7d2a", "Reviewer@Partner.Invalid")` | `access/4b7d2a/i/d3a028e466c0c42c5f0f183aa57bb123.json` |

Prefix builders always end in `/`; record keys always end in `.json`. No builder accepts a slug, alias, directory, path, raw invitation hash, owner claim, or email as an un-hashed key segment.

### Capability matrix

`ROLE_CAPABILITIES` is one deeply frozen ordinary object with prototype `Object.prototype` and own role keys in table order: `owner`, `editor`, `commenter`, `viewer`, `none`. Each role property and each row property is an enumerable, non-writable, non-configurable data property. Every row is an ordinary object with prototype `Object.prototype`, exactly the eight own capability keys in table order, the exact values below, and no symbol keys. `capabilitiesFor(role)` validates the role, returns a fresh plain object containing exactly the eight capability keys, and never returns a mutable shared row or a reference to one.

| Role | `canRead` | `canComment` | `threadControl` | `canSuggest` | `canEdit` | `canAccept` | `canShare` | `canSeeMembers` |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| `owner` | `true` | `true` | `"any"` | `true` | `true` | `true` | `true` | `true` |
| `editor` | `true` | `true` | `"any"` | `true` | `true` | `true` | `false` | `true` |
| `commenter` | `true` | `true` | `"own"` | `true` | `false` | `false` | `false` | `false` |
| `viewer` | `true` | `false` | `"none"` | `false` | `false` | `false` | `false` | `false` |
| `none` | `false` | `false` | `"none"` | `false` | `false` | `false` | `false` | `false` |

`threadControl` applies equally to resolve and reopen: `"any"` permits any thread, `"own"` requires `thread.author.sub === user.sub`, and `"none"` denies. `canShare` is the one owner-only server check for invite, pending-invite change, grant-role change, revoke, cancellation, `orgDefault` change, and transfer; it is not only a rendering hint.

### `resolveRole(docId, user, options = {})`

The public signature is:

```js
/**
 * @param {string} docId
 * @param {AccessUser | null} user
 * @param {ResolveOptions} [options]
 * @returns {Promise<ResolvedAccess>}
 */
export async function resolveRole(docId, user, options = {})
```

The result is a fresh plain object with exactly these keys:

```json
{
  "role": "commenter",
  "shared": true,
  "canRead": true,
  "canComment": true,
  "threadControl": "own",
  "canSuggest": true,
  "canEdit": false,
  "canAccept": false,
  "canShare": false,
  "canSeeMembers": false
}
```

The algorithm and precedence are exact:

1. Validate `docId`, the complete `options` shape and values, and the complete server user. For a non-null user's non-empty email, call `normalizeEmail()` exactly once here, wrap its failure as `invalid-user`, and retain its result. A bad document, option, explicit timestamp, or non-null user rejects here without reading the current clock, environment, or store.
2. Evaluate `const now = options.now ?? new Date().toISOString()` exactly once.
3. If `user === null`, return `role: "none"`, `shared: false`, and the `none` capability row. This valid call has sampled `now`, but it reads neither the environment nor the store.
4. Use only the normalized email retained by step 1; do not normalize or re-read `user.email` here or later. Accept the already-validated empty email string only for a degraded but otherwise proven identity. Owner/grant lookup remains possible by `sub`; an empty email can never match `DOC_OWNERS` or an invitation.
5. Open P2-B `docState()` unless `options.store` was supplied. Read only the document access key through P2-B `read()`. This is a strongly consistent read and preserves the P2-B error boundary. Do not read the caller's grant or invitation yet: child state is irrelevant until an authoritative document record exists and the caller is known not to be its owner.
6. If a document record exists, validate it and ignore `DOC_OWNERS` permanently for that document.
7. If no document record exists, parse the current `DOC_OWNERS`. No entry means `shared: false`. An entry means `shared: true` with effective `orgDefault: "commenter"` until capture.
8. If the configured email matches the proven non-empty user email, build the exact document record with `ownerSub: user.sub`, normalized `ownerEmail`, `orgDefault: "commenter"`, `boundAt: now`, and `boundFrom: "env:DOC_OWNERS"`. Validate it and call `store.setJSON(accessDocumentKey(docId), record, { onlyIfNew: true })` exactly once.
9. Validate the resolved create-result envelope under **Storage-operation contract**. When its own boolean `modified` is `true`, that record is authoritative. When it is `false`, another invocation won: strongly re-read and validate the winning document record. A malformed resolved envelope fails closed without a winning-record re-read. Do not retry with another owner, overwrite, or use `mutate()` for first binding.
10. A stored `ownerSub` match resolves `owner` immediately, regardless of current email, grant, invitation, `isOrg`, or changed environment value. P2-G does not read or consume a grant or invitation for the owner path, so malformed or unavailable irrelevant child state cannot deny the authoritative owner.
11. Consider grants and invitations only when a valid document access record already existed or was captured by this call and the caller is not its owner. A configured-but-unbound seed has an owner candidate and effective org default, but it does not activate or read orphan child records. At this point, read the caller's grant key through P2-B `read()` using the same store. Validate any returned grant for the caller's exact `sub`; a malformed, mismatched, or unavailable grant now preserves the documented `AccessError`/P2-B `StoreError` boundary because this child is relevant to the non-owner decision.
12. If a valid grant exists and `consumeInvitation === false`, return its role immediately. It wins over any invitation and `orgDefault`, and the read-only path performs no invitation lookup.
13. If a valid grant exists and `consumeInvitation === true`, preserve that grant as the winning role but continue to the caller's exact invitation lookup when the normalized email is non-empty. Validate any returned value with `await assertAccessInvitationAtKey(value, docId, invitationKey, normalizedEmail)`. If no invitation exists or it is expired, return the grant without a write. If a live invitation exists, skip grant creation, delete that redundant invitation, and return the unchanged grant. A delete failure rejects as `StoreError("unavailable", 503, "State store unavailable", { cause })`; a retry follows this same branch and deletes the still-live invitation without rewriting the grant.
14. When no grant exists, compute the hash of the caller's proven non-empty normalized email and read that exact invitation key. Never list/scan invitations to find an email. If the email is empty, skip directly to the default in step 19. Validate a returned invitation with `await assertAccessInvitationAtKey(value, docId, invitationKey, normalizedEmail)` so the body shape, proven email, and asynchronously derived full key are one fail-closed relation.
15. Ignore an invitation when `expiresAt <= now`. Leave the blob unchanged; do not grant, delete, extend, or throw. P4-T owns the eventual expired-invitation sweep; P2-G only makes expiry non-authoritative.
16. A live invitation resolves its grantable role. With `consumeInvitation: false` (the default), perform no grant/invitation write; this is the P3-J edge-gate path.
17. With `consumeInvitation: true`, create the exact grant at the caller's subject key with `onlyIfNew: true`, using the invitation's role and actor, the current normalized email and proven name, `grantedAt: now`, and `fromInvitation` equal to the 32-hex hash. This option is for P3-H `/api/session` only.
18. Validate the resolved create-result envelope under **Storage-operation contract**. If its own boolean `modified` is `false`, strongly read and validate the existing grant and preserve its role. A malformed resolved envelope fails closed without a grant re-read or invitation delete; the next consuming call may reconcile any ambiguous provider outcome. An existing explicit grant is never overwritten by a stale invitation. Only after an own boolean `modified: true` or an existing valid grant is known, call `store.delete(invitationKey)`. A repeated delete is harmless. Return capabilities from the grant that now exists. A delete failure leaves the grant durable and is retried through step 13 on the next consuming call.
19. When there is no owner/grant/live invitation, an `isOrg: true` user resolves the stored/effective `orgDefault`; every other user resolves `none`.

This is the only role precedence in the platform:

```text
bound ownerSub
  > explicit grant by sub
  > live invitation by normalized proven email
  > orgDefault for isOrg
  > none
```

For an unshared document, an organization user receives `commenter` with `shared: false`; an external user receives `none` with `shared: false`. For a configured-but-not-yet-bound document, a non-owner organization user receives `commenter` with `shared: true`, and an external user receives `none` with `shared: true`.

### Owner capture and invitation conversion invariants

- One access document record means one owner. A grant can never carry `owner`.
- A child grant or invitation never activates a document with no authoritative document record. Deleting `doc.json` deliberately suspends its children until the configured owner is captured again. Suspended children are not read, so their corruption or provider unavailability cannot affect the unbound result.
- `DOC_OWNERS` seeds an absent record only. It is not a standing authorization source after capture.
- Two simultaneous matching calls may both construct a candidate, but exactly one `onlyIfNew` write wins. The loser trusts only the strong re-read, so two `owner` results with different subjects are impossible.
- Owner capture writes no audit event. The environment setting is the seed record; later P4-J transfers write `access.transfer`.
- Invitation lookup is by `hash(normalize(proven session email))`, never by a client-supplied email/hash and never by a prefix scan.
- The synchronous invitation validator proves body shape only. `resolveRole()` and every arbitrary-key list consumer must await `assertAccessInvitationAtKey()` before the record affects authorization, display, conversion, or deletion.
- P3-J calls the default read-only invitation path. It may admit the proven invitee to read HTML, but it must not consume the invitation in the Edge Function.
- P3-H calls `resolveRole(docId, user, { consumeInvitation: true })`. The grant-first/delete-second order makes retries safe after a crash or ambiguous delete.
- P4-M and P4-O call the default mode on every write. A live invitation is already an identity-bound authority result, so a user need not call `/api/session` as a security prerequisite.
- Conversion writes no `access.*` event. It is the mechanical completion of the already-audited `access.invite` act.
- If a valid invitation races with cancellation after it was read, there is no cross-blob transaction to make the two acts atomic. Grant-first prevents lost access after successful acceptance; P4-J's later revoke remains the corrective operation. Do not add a status field or transaction fiction.

### Storage-operation contract

- Use P2-B `read()` for every document, grant, and invitation read. Do not call `get()`/`getWithMetadata()` directly or weaken strong consistency.
- Owner capture and invitation-to-grant creation are create-only writes: validate the complete record, call `setJSON(..., { onlyIfNew: true })`, and inspect `modified`. Never use an unconditional write.
- A resolved direct `setJSON()` result is valid only when it is a non-null, non-array object with an own `modified` property whose value is exactly boolean `true` or `false`; additional provider fields and any object prototype are ignored. A primitive, `null`, an array, a missing `modified`, an inherited-only `modified`, or a non-boolean value rejects as `new StoreError("unavailable", 503, "State store unavailable")`. Do not coerce truthiness. On owner capture, reject before a collision re-read; on invitation conversion, reject before a grant re-read or invitation delete. This validation applies identically even if the provider may have committed the write, so a later caller retries from strongly read state.
- Use P2-B `mutate()` only in P4-J for mutable document, grant, and invitation amendments. P2-G supplies validators and keys; it does not pre-implement those changes.
- Use P2-B `upgrade()` inside each access validator so version rules have one gate.
- Deletion is the one operation P2-B intentionally does not wrap. Invitation consumption calls `store.delete()` only after a valid grant is durable. A thrown/ambiguous delete becomes `StoreError("unavailable", 503, "State store unavailable", { cause })`.
- There is no transaction across the grant and invitation. Do not delete first, because a crash would lose the only authority record.
- No state write, retry callback, or validator reads the clock, generates an actor, calls Identity, writes an event, notifies, publishes realtime, or logs personal data as a hidden side effect.

### Errors, downstream statuses, and privacy

`AccessError` has the same public-field pattern as P2-B `StoreError`:

```js
new AccessError(code, status, message, { cause } = {})

error.name
error.code
error.status
error.cause
```

The module creates only these access errors:

| Code | Status | Message | Meaning |
|---|---:|---|---|
| `invalid-email` | 400 | `Invalid email address` | A caller tried to normalize/hash an invalid address. |
| `invalid-sub` | 400 | `Invalid identity subject` | A subject or subject key segment is invalid. |
| `invalid-role` | 400 | `Invalid document role` | `capabilitiesFor()` or a record creator received an unknown role. |
| `invalid-user` | 500 | `Invalid access user` | A non-null server identity does not match P2-H's exact four-field contract. |
| `invalid-option` | 500 | `Invalid access option` | An internal caller supplied an unknown/bad resolve option or timestamp. |
| `invalid-config` | 500 | `Invalid DOC_OWNERS configuration` | The complete environment value is malformed or ambiguous. |
| `invalid-record` | 500 | `Invalid access record` | Stored or next access state does not match its exact version-1 shape/key. |

P2-B `StoreError` values are preserved when P2-B created them. Direct create/delete provider failures and malformed resolved direct-create envelopes become P2-B `StoreError` code `unavailable`; conditional create collisions are handled only for a well-formed own boolean `modified: false` and are not exposed as conflicts.

“`resolveRole()` never throws” applies to expected authorization absence: null user, missing access record, unset `DOC_OWNERS`, no grant, no invitation, and an expired invitation all return a result. Invalid programmer/request inputs, malformed configuration/state, and unavailable storage still reject so callers can fail closed rather than misreport an outage as a denial.

Downstream handlers apply these boundaries:

| Condition | HTTP behavior owned downstream |
|---|---|
| No proven session | `401`, before `resolveRole()` |
| Valid result with `canRead: false` or missing required capability | `403` |
| Invalid client document/email/role/sub selected by an endpoint | `400`, using endpoint-owned empty/generic body |
| P2-B `conflict` from a later access mutation | `409` |
| P2-B `unavailable` | `503` |
| Invalid configuration, corrupt record, or internal option | `500` |
| P3-H queries an unknown/unshared valid docId | `200` with the unshared result, never `500` |

Never serialize an error, `cause`, stack, environment value, access record, ETag, invitation existence for another email, or raw store response. No key contains a plain email. P3-J's denial may name only the signed-in caller's already-known email, never the configured/invited address. The library emits no console output and returns no member list or another person's role.

### Stable downstream contracts

- **P2-F:** imports only `resolveRole()`. It accepts any result with `canRead: true`; it does not inspect P1-C `docs` or derive organization membership. Source work may compile against the documented P2-G/P2-H contracts, but authenticated acceptance waits for both integrations.
- **P3-H:** imports `resolveRole()`, prefixes, and record validators. `/api/session?doc=` passes `consumeInvitation: true`, retains the proven identity's `sub`, `email`, and `name`, projects P2-C's non-authoritative compatibility `roles` as `[user.isOrg ? "member" : "guest"]`, and projects `role`, `shared`, `canComment`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers` from the resolved access result. It does not expose `isOrg`, `canRead`, `threadControl`, raw records, hashes, or resolve options, and neither the endpoint nor a client may use compatibility `roles` for document authorization. `GET /api/access` lists only after `canSeeMembers`; it validates every returned record and awaits `assertAccessInvitationAtKey(value, docId, fullKey)` for each listed invitation before using it.
- **P3-J:** imports `resolveRole()` in its Edge Function and uses the default `consumeInvitation: false`; `canRead` is the only HTML-read decision. It uses the P2-H `isOrg` identity fact and no temporary `roles`/`docs` fallback.
- **P4-J:** uses `canShare`, `normalizeEmail()`, the key/prefix builders, all three synchronous record validators, `assertAccessInvitationAtKey()`, and P2-B `mutate()` for amendments. It alone creates/amends/cancels invitations, amends/revokes grants, changes `orgDefault`, transfers `ownerSub`/`ownerEmail`, calls Identity admin/recovery APIs, and writes `access.invite/change/revoke/transfer` events.
- **P4-M:** calls default `resolveRole()` after origin and identity checks. It checks `canComment`; for resolve/reopen it interprets `threadControl` and compares only `thread.author.sub`; edit enforcement distinguishes `canSuggest` from `canEdit`.
- **P4-O:** calls default `resolveRole()` and checks the appropriate suggestion capability; it does not duplicate the role table.
- **P4-S:** writes the complete, deduplicated parser grammar accepted here. It sets a site environment value available to Functions/Edge before initial deployment, prints the selected normalized owner, never places the value in repository files, and explains that later transfer—not an environment edit—moves a bound owner.
- **P4-T:** owns retention's expired-invitation sweep in addition to suggestion cleanup and access-event exclusions. It lists invitation records, awaits `assertAccessInvitationAtKey(value, docId, fullKey)` for each one, and deletes only records whose `expiresAt` is not later than the sweep time. P2-G never deletes an expired invitation during role resolution.

## Files owned

- `netlify/lib/access.mjs` — **new**, created exclusively by P2-G after P2-B publishes the complete store contract.

No other implementation, package, lock, generated, template, prompt, research, ticket, or configuration file is owned or amended by P2-G. `docs/tickets/P2-G.md` is this specification, not an implementation surface.

If the implementation cannot satisfy this contract through P1-C/P2-H identity and P2-B storage, stop and report the contract gap. Do not amend either predecessor from this ticket.

## Dependencies

### Required predecessors

- **P1-C:** supplies ESM/Node `>=22.12.0`, the pinned `@netlify/blobs@11.0.2` package, and the normalized server identity lineage. P2-G does not call `identify()` itself; callers pass the proven object.
- **P2-B:** supplies `docState`, `read`, `mutate`, `upgrade`, `assertDocId`, `assertKey`, and `StoreError`. P2-G starts only after that complete contract is available, not from a partial first-wave implementation.

P2-H is an independent same-phase sibling, not a source-authoring prerequisite. P2-G defines `AccessUser` against P2-H's final `{sub,email,name,isOrg}` result and must not add a temporary adapter for P1-C's `roles`, `canComment`, `canEdit`, or `docs` fields.

### Maximum safe waves

1. **Predecessor integration:** integrate each ticket's own Phase 1 predecessors. P1-C must be present before P2-G or P2-H source work; the other Phase 2 tickets retain their own declared predecessor gates.
2. **First maximum source wave:** after those ticket-local gates, P2-A, P2-B, P2-C, P2-D, P2-E, P2-F, and P2-H may be authored concurrently on disjoint files. P2-G is deliberately absent because it must not compile or test against a partial P2-B implementation.
3. **Authorization source wave:** after P2-B's complete one-file contract and acceptance gate are integrated and green, begin P2-G. It touches only `access.mjs` and may overlap any still-running disjoint sibling. Rebase P2-F onto integrated P2-G and P2-H before authenticated authorization acceptance; its unauthenticated/provider-only checks may run earlier.
4. **Serialized integration/runtime wave:** one integrator combines the completed source lanes and runs package install, local Blobs/Netlify checks, repository-wide gates, and downstream authorization acceptance. `node_modules`, `.netlify`, `_site`, environment variables, local ports, and provider fixtures are shared mutable surfaces and must not be driven concurrently.

P3-H and P3-J may begin only from the complete P2-G export/result contract. P4-J and P4-M may be authored in their later declared order; neither may amend `access.mjs` to fill an omitted helper.

## Acceptance criteria

- [ ] GitHub issue #12 retains the exact title `P2-G — The access library`; its body is exactly the two-paragraph canonical-document pointer from `docs/prompts/rewrite-tickets.md`, and the parsed full commit SHA and `docs/tickets/P2-G.md` path resolve through `git show` to bytes identical to this local canonical document.
- [ ] `netlify/lib/access.mjs` is the only implementation path added by P2-G and has exactly the runtime exports under **Interface contract**.
- [ ] Public JSDoc defines the exact `AccessUser`, `AccessActor`, `AccessDocument`, `AccessGrant`, `AccessInvitation`, role, capability, result, resolve-option, and three-method duck-typed store shapes without adding runtime type packages or exports.
- [ ] Options and user validation finish before time sampling; every valid call evaluates `options.now ?? new Date().toISOString()` once, including the null-user path, and every later comparison/write uses that one value.
- [ ] `DOC_OWNERS` is read from the correct invocation runtime, never from client/document/config-file content, and is not cached at module load.
- [ ] Unset/blank owner configuration parses to an empty map; every malformed, duplicate, non-hex, invalid-email, separator-injected, or oversized form fails with the exact private-safe config error.
- [ ] Email normalization and both published hashes match the fixtures exactly; raw email never appears in a blob key.
- [ ] All five access key builders return the exact values under **Interface contract** and reject invalid document/subject/email segments before a store call; the P2-B seam rejects literal leading `%2F` while accepting lowercase leading `%2f`.
- [ ] Each synchronous record validator enforces the exact version-1 body shape, own keys, nested actor, expected document/subject, grant/default role restrictions, timestamps, and invitation lifetime; grant and actor names accept empty/exactly-200 values but reject 201, and every stored non-empty email snapshot is already canonical even when the P2-H input required trimming. The async invitation-at-key validator additionally enforces the exact body-email/full-key hash relation for direct resolution and arbitrary-key lists.
- [ ] The deeply frozen exported capability matrix independently has the exact role keys, row keys/values, ordinary prototypes, and frozen data-property descriptors; `capabilitiesFor()` separately returns a fresh exact eight-field object.
- [ ] `resolveRole(null user)` returns the exact `none`/unshared result without environment or storage work.
- [ ] An unshared organization user resolves `commenter`; an unshared external user resolves `none`; both report `shared: false`.
- [ ] A configured-but-unbound document reports `shared: true`; only the matching proven email attempts the one create-only owner capture.
- [ ] Two concurrent matching callers produce exactly one document record and exactly one owner subject; the loser re-reads the winner and does not overwrite/retry ownership.
- [ ] After capture, `ownerSub` remains authoritative across email/config changes—including malformed current configuration—and a grant can never create a second owner. Owner and unbound paths do not read irrelevant child records, so malformed or unavailable grants/invitations cannot affect them; once a valid document record exists for a non-owner, the same child failures propagate through the exact access/store error boundary.
- [ ] Role precedence is exactly owner, explicit grant, live invitation, org default, none; explicit grants override invitations and org defaults.
- [ ] Default resolution never consumes an invitation, and an existing grant in default mode does not even look up one. `consumeInvitation: true` creates/preserves a grant first, deletes second, and is idempotent after success or a delete failure.
- [ ] An invitation with `expiresAt <= now` grants nothing, is not deleted/extended by role resolution, and falls through to the applicable organization default or none; P4-T owns later cleanup.
- [ ] The source oracle proves the one exact P2-B import, direct `upgrade()` delegation by all three synchronous access validators, imported `read()` use, and absence of direct provider reads or local `read`/`upgrade` shadows. Every module-owned first write is validated and guarded by `onlyIfNew`; no unconditional create or second CAS loop exists. On both owner and invitation create paths, a nonobject/array result or missing, inherited, or non-boolean `modified` fails closed as exact P2-B `StoreError("unavailable", 503, "State store unavailable")` before any collision re-read or invitation delete. A resolved object with an own boolean `modified` is accepted regardless of prototype/additional fields; a thrown provider error preserves its cause in the safe `StoreError`; and retry reconciles a write that committed before a malformed envelope was returned.
- [ ] Expected absence never rejects, while invalid inputs, corrupt/configured state, and provider failures retain the exact status/error boundaries under **Interface contract**.
- [ ] No public response, serialized error or cause, public error message, or log exposes `DOC_OWNERS`, another person's address/role, raw records, ETags, provider text, or client-supplied authority; internal `error.cause` retains provider detail for diagnostics and must never cross that serialization boundary.
- [ ] No `owner`, `editor`, grant, capability, or environment field is added to any `doc.json`, HTML, client session claim, or Identity metadata.
- [ ] Deterministic tests content-check all eleven public typedefs and the exact runtime exports; independently prove every exported capability-table role, row, value, prototype, descriptor, and freeze boundary; and cover every record field boundary, all resolution sources and precedence/inactive-child cases—including malformed and unavailable children that are irrelevant to owner/unbound paths and the same failures propagating once relevant—strong-read calls, owner contention, the complete asynchronous key/hash context, malformed/thrown/committed-malformed create outcomes on both direct-write paths, accepted provider-envelope prototypes, invitation conversion/replay/expiry-boundary/existing-grant/delete-failure cases, invocation-local environment reads, exact actual-result own keys/prototype/property descriptors on null, owner, grant, invitation, organization-default, and authenticated-none branches, and privacy.
- [ ] The retained access-suite fixture installs first-signal HUP/INT/TERM ownership before creating its guarded root and preserves that latch through stop, process-group proof, bounded recursive deletion, and final exit. Before any detached process exists it writes mode-`0600` preparing ownership; the detached anchor cannot spawn the large Node suite until its own PID/PGID record is published and the supervisor sends the private inherited go handshake. The still-live direct-child anchor remains the positively owned process-group leader through the 120-second deadline and bounded group-wide TERM-to-KILL cleanup, is reaped by the supervisor, and is followed by group-disappearance proof before ownership records or root can be deleted. No path signals a numeric PGID after that anchor exits.
- [ ] Missing `active-group.pid`, any publication/evidence exception, forced supervisor exit, lost current-anchor identity, unproved containment/reaping, or bounded deletion failure is never treated as cleanup success merely because a numeric PID/group disappeared. The outer owner may KILL only its still-unreaped direct supervisor after its finite TERM grace; the handshake makes an unpublished target escape impossible. It verifies the exact live anchor PID=PGID and command before each fallback group signal, then retains the guarded root, mode-`0600` preparing/anchor evidence, and a deterministic manual-remediation locator when writable whenever it cannot itself reap that anchor.
- [ ] Silent real lifecycle probes execute the exact retained supervisor and shell cleanup source for early, active, supervisor-terminal, and outer-finalizer-terminal HUP/INT/TERM; timeout; a TERM-resistant descendant; ordinary and forced parent exit with a live descendant; natural HUP/INT/TERM/KILL mapping to 129/130/143/137; forced active-publication plus locator-write failure; leader reaping; group disappearance; retained-remediation evidence; and zero per-probe/final residue. Each outer-finalizer case first proves `p2g_on_exit()` has entered `p2g_cleanup_impl()`, sends and observes its first signal, then sends and observes a distinct second signal while the handlers and cleanup remain active; the latch and final status must still name the first signal.
- [ ] Repository scrub, document parity, typecheck, whitespace, fence, exact-heading, and exact-base ownership checks pass with no fixture residue or changed implementation path outside `netlify/lib/access.mjs`.

## Test plan

### 1. Verify predecessors and create an isolated fixture

Run from the repository root on Node 22 after P2-B is integrated:

```bash
set -euo pipefail

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
assert.equal(major, 22);
assert.ok(minor >= 12);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(pkg.type, "module");
assert.equal(pkg.dependencies?.["@netlify/blobs"], "11.0.2");
for (const name of ["docState", "read", "mutate", "upgrade", "assertDocId", "assertKey", "StoreError"]) {
  assert.match(readFileSync("netlify/lib/store.mjs", "utf8"), new RegExp(`export (?:async )?(?:function|class) ${name}|export const ${name}`));
}
console.log("PASS  P2-G predecessor contracts");
NODE

P2G_TEST_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P2G_TEST_ROOT=""
P2G_ACTIVE_PID=""
P2G_SIGNAL_STATUS=0
P2G_SIGNAL_COUNT=0
P2G_CLEANING=0

p2g_manual() {
  local reason="$1" pid="${2:-}" pgid="${3:-}" root="${P2G_TEST_ROOT:-}" locator=no-safe-locator
  if [[ -n "$root" && "${root%/*}" == "$P2G_TEST_PARENT" && -d "$root" && ! -L "$root" ]]; then
    case "${root##*/}" in
      p2-g-access.??????|p2-g-access-probe.??????)
        locator="$root/manual-remediation.txt"
        (umask 077; set -o noclobber; printf 'reason=%s\npid=%s\npgid=%s\n' "$reason" "${pid:-unknown}" "${pgid:-unknown}" >"$locator") 2>/dev/null || true
        ;;
    esac
  fi
  printf 'ERROR  P2-G fixture requires manual remediation: %s (pid %s, pgid %s)\n' \
    "$locator" "${pid:-unknown}" "${pgid:-unknown}" >&2
}

p2g_stop() {
  local pid="${P2G_ACTIVE_PID:-}" group= attempts=0 forced=0 pgid= command=
  case "$pid" in ''|*[!0-9]*|0|1) pid= ;; esac
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && (( attempts < 120 )); do sleep 0.05; attempts=$((attempts + 1)); done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; forced=1; fi
    attempts=0
    while kill -0 "$pid" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
    if kill -0 "$pid" 2>/dev/null; then p2g_manual supervisor-unreaped "$pid"; return 1; fi
    wait "$pid" 2>/dev/null || true
  fi
  P2G_ACTIVE_PID=""
  if [[ -n "${P2G_TEST_ROOT:-}" && -f "$P2G_TEST_ROOT/active-group.pid" ]]; then
    IFS= read -r group <"$P2G_TEST_ROOT/active-group.pid" || true
    case "$group" in ''|*[!0-9]*|0|1) p2g_manual invalid-group "$pid" "$group"; return 1 ;; esac
    pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
    command="$(ps -o command= -p "$group" 2>/dev/null || true)"
    if [[ "$pgid" != "$group" || "$command" != *"$P2G_SUPERVISOR --group-anchor"* ]]; then
      p2g_manual anchor-ownership-unproved "$group" "$group"
      return 1
    fi
    kill -TERM -- "-$group" 2>/dev/null || true
    attempts=0
    while kill -0 "$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
    if kill -0 "$group" 2>/dev/null; then
      pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
      command="$(ps -o command= -p "$group" 2>/dev/null || true)"
      if [[ "$pgid" != "$group" || "$command" != *"$P2G_SUPERVISOR --group-anchor"* ]]; then
        p2g_manual anchor-ownership-lost "$group" "$group"
        return 1
      fi
      kill -KILL -- "-$group" 2>/dev/null || true
    fi
    attempts=0
    while kill -0 -- "-$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
    if kill -0 -- "-$group" 2>/dev/null; then p2g_manual group-unreaped "$group" "$group"; return 1; fi
    p2g_manual fallback-leader-reap-unproved "$group" "$group"
    return 1
  fi
  if [[ -n "${P2G_TEST_ROOT:-}" ]] && { [[ -f "$P2G_TEST_ROOT/supervisor-anchor.json" ]] || [[ -f "$P2G_TEST_ROOT/supervisor-preparing.json" ]]; }; then
    p2g_manual incomplete-anchor-publication "$pid"
    return 1
  fi
  if (( forced != 0 )); then p2g_manual supervisor-forced "$pid"; return 1; fi
}

p2g_remove() {
  local root="${P2G_TEST_ROOT:-}" worker attempts=0
  [[ -n "$root" ]] || return 0
  if [[ "${root%/*}" != "$P2G_TEST_PARENT" ]]; then p2g_manual unsafe-cleanup; return 1; fi
  case "${root##*/}" in p2-g-access.??????|p2-g-access-probe.??????) ;; *) p2g_manual unsafe-cleanup; return 1 ;; esac
  [[ ! -e "$root" ]] && return 0
  if [[ ! -d "$root" || -L "$root" ]]; then p2g_manual unsafe-cleanup; return 1; fi
  if [[ -f "$root/manual-remediation.txt" || -f "$root/supervisor-anchor.json" || -f "$root/supervisor-preparing.json" ]]; then
    printf 'ERROR  retained P2-G fixture for manual remediation: %s\n' "$root/manual-remediation.txt" >&2
    return 1
  fi
  node -e 'require("node:fs").rmSync(process.argv[1], {recursive:true, force:true, maxRetries:2, retryDelay:25})' "$root" &
  worker=$!
  while kill -0 "$worker" 2>/dev/null && (( attempts < 200 )); do sleep 0.05; attempts=$((attempts + 1)); done
  if kill -0 "$worker" 2>/dev/null; then kill -KILL "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; p2g_manual cleanup-timeout "$worker"; return 1; fi
  wait "$worker" 2>/dev/null || true
  if [[ -e "$root" ]]; then p2g_manual cleanup-failed "$worker"; return 1; fi
}

p2g_cleanup_impl() {
  local cleanup_status=0
  if ! p2g_stop; then
    cleanup_status=1
  else
    if [[ -n "${P2G_CLEANUP_READY:-}" ]]; then
      case "$P2G_CLEANUP_READY" in "$P2G_TEST_ROOT"/.outer-terminal-HUP.ready|"$P2G_TEST_ROOT"/.outer-terminal-INT.ready|"$P2G_TEST_ROOT"/.outer-terminal-TERM.ready) ;; *) p2g_manual invalid-cleanup-rendezvous; cleanup_status=1 ;; esac
      case "${P2G_CLEANUP_LATCHED:-}" in "$P2G_TEST_ROOT"/.outer-terminal-HUP.latched|"$P2G_TEST_ROOT"/.outer-terminal-INT.latched|"$P2G_TEST_ROOT"/.outer-terminal-TERM.latched) ;; *) p2g_manual invalid-cleanup-rendezvous; cleanup_status=1 ;; esac
      if (( cleanup_status == 0 )); then
        (umask 077; printf 'ready\n' >"$P2G_CLEANUP_READY")
        local rendezvous_attempts=0
        while (( P2G_SIGNAL_STATUS == 0 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
        if (( P2G_SIGNAL_STATUS == 0 )); then p2g_manual cleanup-rendezvous-timeout; cleanup_status=1; fi
        if (( cleanup_status == 0 )); then
          local first_signal_status=$P2G_SIGNAL_STATUS
          (umask 077; printf '%s\n' "$first_signal_status" >"$P2G_CLEANUP_LATCHED")
          rendezvous_attempts=0
          while (( P2G_SIGNAL_COUNT < 2 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
          if (( P2G_SIGNAL_COUNT < 2 || P2G_SIGNAL_STATUS != first_signal_status )); then
            p2g_manual cleanup-second-signal-timeout
            cleanup_status=1
          fi
        fi
      fi
    fi
    if (( cleanup_status == 0 )); then p2g_remove || cleanup_status=1; fi
  fi
  return "$cleanup_status"
}

cleanup_p2g() {
  local cleanup_status=0
  P2G_CLEANING=1
  p2g_cleanup_impl || cleanup_status=1
  P2G_CLEANING=0
  if (( P2G_SIGNAL_STATUS != 0 )); then return "$P2G_SIGNAL_STATUS"; fi
  return "$cleanup_status"
}

p2g_on_exit() {
  local status=$? cleanup_status=0
  trap - EXIT
  P2G_CLEANING=1
  p2g_cleanup_impl || cleanup_status=1
  if (( P2G_SIGNAL_STATUS != 0 )); then status=$P2G_SIGNAL_STATUS
  elif (( status == 0 && cleanup_status != 0 )); then status=1
  fi
  if (( P2G_SIGNAL_STATUS != 0 )); then status=$P2G_SIGNAL_STATUS; fi
  exit "$status"
}

p2g_signal() {
  P2G_SIGNAL_COUNT=$((P2G_SIGNAL_COUNT + 1))
  if (( P2G_SIGNAL_STATUS == 0 )); then P2G_SIGNAL_STATUS="$1"; fi
  if (( P2G_CLEANING == 0 )); then exit "$P2G_SIGNAL_STATUS"; fi
}

p2g_run() {
  P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" "$@" & P2G_ACTIVE_PID=$!
  local attempts=0 status
  while kill -0 "$P2G_ACTIVE_PID" 2>/dev/null && (( attempts < 2600 )); do sleep 0.05; attempts=$((attempts + 1)); done
  if kill -0 "$P2G_ACTIVE_PID" 2>/dev/null; then p2g_stop || return 1; return 124; fi
  if wait "$P2G_ACTIVE_PID"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  return "$status"
}

trap p2g_on_exit EXIT
trap 'p2g_signal 129' HUP
trap 'p2g_signal 130' INT
trap 'p2g_signal 143' TERM
P2G_TEST_ROOT="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access.XXXXXX")"
export P2G_TEST_PARENT P2G_TEST_ROOT
P2G_SUPERVISOR="$P2G_TEST_ROOT/supervise.mjs"
export P2G_SUPERVISOR
(umask 077; : >"$P2G_SUPERVISOR")
sed 's/^  //' >"$P2G_SUPERVISOR" <<'P2G_SUPERVISOR_JS'
  import { spawn } from "node:child_process";
  import { createReadStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
  import { constants } from "node:os";
  import { basename, dirname, join } from "node:path";

  const root = process.env.P2G_TEST_ROOT ?? "";
  const parent = process.env.P2G_TEST_PARENT ?? "";
  if (dirname(root) !== parent || !/^p2-g-access(?:-probe)?\.[A-Za-z0-9]{6}$/.test(basename(root))) {
    console.error("ERROR  P2-G supervisor refused an unexpected root");
    process.exit(1);
  }
  const pidPath = join(root, "active-group.pid");
  const preparingPath = join(root, "supervisor-preparing.json");
  const anchorPath = join(root, "supervisor-anchor.json");
  const outcomePath = join(root, "target-outcome.json");
  const locator = join(root, "manual-remediation.txt");
  const ownerSignals = new Map([["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]);
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  if (process.argv[2] === "--group-anchor") {
    const target = process.argv.slice(5);
    const targetOutcome = process.argv[3] ?? "";
    const expectedSupervisor = Number(process.argv[4]);
    if (target.length === 0 || targetOutcome !== outcomePath || !Number.isInteger(expectedSupervisor)) process.exit(2);
    for (const signal of ownerSignals.keys()) process.on(signal, () => {});
    let gate = "";
    const gateStream = createReadStream(null, { fd: 3, autoClose: true, encoding: "utf8" });
    gateStream.on("data", (chunk) => { gate += chunk; });
    gateStream.once("error", () => process.exit(1));
    gateStream.once("end", () => {
      if (gate !== "go\n") process.exit(1);
      const targetChild = spawn(target[0], target.slice(1), { stdio: "inherit" });
      const publishOutcome = (status, reason) => {
        const temporary = `${targetOutcome}.${process.pid}.tmp`;
        try {
          writeFileSync(temporary, `${JSON.stringify({ status, reason })}\n`, { flag: "wx", mode: 0o600 });
          renameSync(temporary, targetOutcome);
        } catch {
          if (process.ppid === expectedSupervisor) {
            try { process.kill(expectedSupervisor, "SIGUSR1"); } catch {}
          }
        }
      };
      targetChild.once("error", () => publishOutcome(1, "target-spawn-error"));
      targetChild.once("exit", (code, signal) => {
        const number = signal ? constants.signals[signal] : undefined;
        publishOutcome(signal && number ? 128 + number : (code ?? 1), "target-exit");
      });
    });
    setInterval(() => {}, 1_000);
  } else {
  const argv = process.argv.slice(2);
  if (argv.length === 0) process.exit(2);
  const configuredTimeout = process.env.P2G_SUPERVISOR_TIMEOUT_MS;
  const timeoutMs = configuredTimeout === undefined ? 120_000 : Number(configuredTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120_000) process.exit(2);
  const finishReady = process.env.P2G_FINISH_READY ?? "";
  if (finishReady && (dirname(finishReady) !== root || !/^\.terminal-(?:HUP|INT|TERM)\.ready$/.test(basename(finishReady)))) process.exit(2);
  let anchor;
  let finishing = false;
  let latchedSignalStatus = 0;
  let timer;
  let outcomePoll;
  let retainEvidence = false;
  let targetReleased = false;

  function groupAlive() {
    if (!anchor?.pid) return false;
    try { process.kill(-anchor.pid, 0); return true; }
    catch (error) { if (error?.code === "ESRCH") return false; if (error?.code === "EPERM") return true; throw error; }
  }
  function anchorOwned() {
    return Boolean(anchor?.pid && anchor.exitCode === null && anchor.signalCode === null);
  }
  function signalGroup(signal) {
    if (!anchorOwned()) throw new Error("anchor ownership lost before signal");
    try { process.kill(-anchor.pid, signal); }
    catch (error) { if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error; }
  }
  function evidence(reason) {
    const record = `${JSON.stringify({ reason, supervisorPid: process.pid, leaderPid: anchor?.pid ?? null, processGroup: anchor?.pid ?? null })}\n`;
    if (process.env.P2G_INJECT_EVIDENCE_FAILURE !== "1") {
      try { writeFileSync(locator, record, { flag: "wx", mode: 0o600 }); } catch {}
    }
    console.error(`ERROR  P2-G supervisor requires manual remediation: ${locator} (pid ${anchor?.pid ?? "unknown"}, pgid ${anchor?.pid ?? "unknown"})`);
  }
  async function stopGroup() {
    if (!targetReleased) {
      for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
      if (anchorOwned()) anchor.kill("SIGKILL");
      for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
      if (anchorOwned()) return false;
      for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
      return !groupAlive();
    }
    if (anchorOwned()) signalGroup("SIGTERM");
    for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
    if (anchorOwned()) signalGroup("SIGKILL");
    for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
    if (anchorOwned()) return false;
    for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
    return !groupAlive();
  }
  async function finish(status, reason) {
    if (finishing) return;
    finishing = true;
    clearTimeout(timer);
    clearInterval(outcomePoll);
    if (finishReady) {
      try { writeFileSync(finishReady, `${status} ${reason}\n`, { flag: "wx", mode: 0o600 }); } catch {}
    }
    let stopped = false;
    let stopReason = reason;
    try { stopped = await stopGroup(); } catch (error) { stopReason = `${reason}:${error?.code ?? error?.name ?? "unknown"}`; }
    if (!stopped || retainEvidence) {
      evidence(!stopped ? stopReason : reason);
      process.exit(latchedSignalStatus || 1);
    }
    rmSync(pidPath, { force: true });
    rmSync(outcomePath, { force: true });
    rmSync(anchorPath, { force: true });
    rmSync(preparingPath, { force: true });
    process.exit(latchedSignalStatus || status);
  }
  for (const [signal, status] of ownerSignals) process.on(signal, () => {
    if (latchedSignalStatus === 0) latchedSignalStatus = status;
    void finish(status, signal);
  });
  process.on("SIGUSR1", () => { retainEvidence = true; void finish(1, "anchor-outcome-publication-failure"); });
  try {
    writeFileSync(preparingPath, `${JSON.stringify({ state: "preparing", supervisorPid: process.pid })}\n`, { flag: "wx", mode: 0o600 });
  } catch {
    evidence("preparing-publication-failure");
    process.exit(1);
  }
  anchor = spawn(process.execPath, [process.argv[1], "--group-anchor", outcomePath, String(process.pid), ...argv], {
    detached: true, stdio: ["inherit", "inherit", "inherit", "pipe"],
  });
  anchor.once("error", () => { retainEvidence = true; void finish(1, "anchor-spawn-error"); });
  anchor.once("exit", () => {
    if (!finishing) { retainEvidence = true; void finish(1, "anchor-exit-before-outcome"); }
  });
  try {
    if (!anchor.pid) throw new Error("missing anchor pid");
    writeFileSync(anchorPath, `${JSON.stringify({ state: "published", supervisorPid: process.pid, leaderPid: anchor.pid, processGroup: anchor.pid })}\n`, { flag: "wx", mode: 0o600 });
    if (process.env.P2G_INJECT_PUBLICATION_FAILURE === "1") throw new Error("injected publication failure");
    writeFileSync(pidPath, `${anchor.pid}\n`, { flag: "wx", mode: 0o600 });
    anchor.stdio[3].end("go\n");
    targetReleased = true;
  } catch {
    retainEvidence = true;
    anchor.stdio?.[3]?.end();
    void finish(1, "publication-failure");
  }
  outcomePoll = setInterval(() => {
    try {
      const outcome = JSON.parse(readFileSync(outcomePath, "utf8"));
      if (!Number.isInteger(outcome.status) || outcome.status < 0 || outcome.status > 255) throw new Error("invalid outcome");
      void finish(outcome.status, outcome.reason ?? "target-exit");
    } catch (error) {
      if (error?.code !== "ENOENT" && !finishing) { retainEvidence = true; void finish(1, "invalid-target-outcome"); }
    }
  }, 20);
  timer = setTimeout(() => { void finish(124, "deadline-timeout"); }, timeoutMs);
  }
P2G_SUPERVISOR_JS

p2g_outer_terminal_probe() {
  local signal="$1" expected="$2" second_signal ready latched probe_root owner status attempts=0
  case "$signal" in HUP) second_signal=INT ;; INT) second_signal=TERM ;; TERM) second_signal=HUP ;; esac
  ready="$P2G_TEST_ROOT/.outer-terminal-$signal.owner"
  (
    P2G_TEST_ROOT=""; P2G_ACTIVE_PID=""; P2G_SIGNAL_STATUS=0; P2G_SIGNAL_COUNT=0; P2G_CLEANING=0
    trap p2g_on_exit EXIT
    trap 'p2g_signal 129' HUP; trap 'p2g_signal 130' INT; trap 'p2g_signal 143' TERM
    P2G_TEST_ROOT="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access-probe.XXXXXX")"; export P2G_TEST_ROOT
    P2G_CLEANUP_READY="$P2G_TEST_ROOT/.outer-terminal-$signal.ready"
    P2G_CLEANUP_LATCHED="$P2G_TEST_ROOT/.outer-terminal-$signal.latched"
    printf '%s\n' "$P2G_TEST_ROOT" >"$ready"
    exit 0
  ) & owner=$!
  P2G_ACTIVE_PID="$owner"
  while [[ ! -s "$ready" ]] && kill -0 "$owner" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$ready" ]]; probe_root="$(<"$ready")"
  attempts=0
  while [[ ! -s "$probe_root/.outer-terminal-$signal.ready" ]] && kill -0 "$owner" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$probe_root/.outer-terminal-$signal.ready" ]]
  kill -s "$signal" "$owner"
  latched="$probe_root/.outer-terminal-$signal.latched"
  attempts=0
  while [[ ! -s "$latched" ]] && kill -0 "$owner" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ "$(<"$latched")" -eq "$expected" ]]
  kill -s "$second_signal" "$owner"
  p2g_wait "$owner" 400
  if wait "$owner"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq "$expected" && ! -e "$probe_root" ]]
  rm -f -- "$ready"
}

p2g_wait() {
  local pid="$1" limit="$2" attempts=0
  while kill -0 "$pid" 2>/dev/null && (( attempts < limit )); do sleep 0.05; attempts=$((attempts + 1)); done
  ! kill -0 "$pid" 2>/dev/null
}

p2g_early_probe() {
  local signal="$1" expected="$2" owner status
  local ready="$P2G_TEST_ROOT/.early-$signal.ready"
  (
    P2G_TEST_ROOT=""; P2G_ACTIVE_PID=""; P2G_SIGNAL_STATUS=0; P2G_CLEANING=0
    trap p2g_on_exit EXIT
    trap 'p2g_signal 129' HUP; trap 'p2g_signal 130' INT; trap 'p2g_signal 143' TERM
    printf 'ready\n' >"$ready"
    while :; do sleep 1; done
  ) & owner=$!
  P2G_ACTIVE_PID="$owner"
  for _ in {1..200}; do [[ -s "$ready" ]] && break; sleep 0.01; done
  [[ -s "$ready" ]]
  kill -s "$signal" "$owner"
  p2g_wait "$owner" 200
  if wait "$owner"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq "$expected" ]]
  rm -f -- "$ready"
}

p2g_active_probe() {
  local signal="$1" expected="$2" owner probe_root group descendant status attempts=0
  local ready="$P2G_TEST_ROOT/.active-$signal.ready"
  local descendant_ready="$P2G_TEST_ROOT/.active-$signal.descendant"
  (
    P2G_TEST_ROOT=""; P2G_ACTIVE_PID=""; P2G_SIGNAL_STATUS=0; P2G_CLEANING=0
    trap p2g_on_exit EXIT
    trap 'p2g_signal 129' HUP; trap 'p2g_signal 130' INT; trap 'p2g_signal 143' TERM
    P2G_TEST_ROOT="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access-probe.XXXXXX")"; export P2G_TEST_ROOT
    printf '%s\n' "$P2G_TEST_ROOT" >"$ready"
    P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" sh -c '(trap "" HUP INT TERM; while :; do sleep 1; done) & descendant=$!; printf "%s\n" "$descendant" >"$1"; wait' sh "$descendant_ready" &
    P2G_ACTIVE_PID=$!
    wait "$P2G_ACTIVE_PID"
  ) & owner=$!
  P2G_ACTIVE_PID="$owner"
  for _ in {1..200}; do [[ -s "$ready" ]] && break; sleep 0.01; done
  [[ -s "$ready" ]]; probe_root="$(<"$ready")"
  while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$descendant_ready" ]]; } && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$probe_root/active-group.pid" && -s "$descendant_ready" ]]
  group="$(<"$probe_root/active-group.pid")"; descendant="$(<"$descendant_ready")"
  case "$group:$descendant" in *[!0-9:]*|:*|*:|0:*|1:*|*:0|*:1) return 1 ;; esac
  kill -0 "$descendant"; kill -s "$signal" "$owner"
  p2g_wait "$owner" 400
  if wait "$owner"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq "$expected" && ! -e "$probe_root" ]] && ! kill -0 -- "-$group" 2>/dev/null && ! kill -0 "$descendant" 2>/dev/null
  rm -f -- "$ready" "$descendant_ready"
}

p2g_terminal_probe() {
  local signal="$1" expected="$2" group status attempts=0
  local finish_ready="$P2G_TEST_ROOT/.terminal-$signal.ready"
  local descendant_ready="$P2G_TEST_ROOT/.terminal-$signal.descendant"
  P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY="$finish_ready" node "$P2G_SUPERVISOR" \
    sh -c '(trap "" HUP INT TERM; printf "ready\n" >"$1"; while :; do sleep 1; done) & while [ ! -s "$1" ]; do sleep 0.01; done' \
    sh "$descendant_ready" &
  P2G_ACTIVE_PID=$!
  while { [[ ! -s "$finish_ready" ]] || [[ ! -s "$descendant_ready" ]] || [[ ! -s "$P2G_TEST_ROOT/active-group.pid" ]]; } && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$finish_ready" && -s "$descendant_ready" && -s "$P2G_TEST_ROOT/active-group.pid" ]]
  group="$(<"$P2G_TEST_ROOT/active-group.pid")"
  case "$group" in ''|*[!0-9]*|0|1) return 1 ;; esac
  kill -s "$signal" "$P2G_ACTIVE_PID"
  p2g_wait "$P2G_ACTIVE_PID" 400
  if wait "$P2G_ACTIVE_PID"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq "$expected" && ! -e "$P2G_TEST_ROOT/active-group.pid" ]] && ! kill -0 -- "-$group" 2>/dev/null
  rm -f -- "$finish_ready" "$descendant_ready"
}

p2g_expected_status_probe() {
  local label="$1" expected="$2" timeout="$3" signal="$4" group status attempts=0
  local ready="$P2G_TEST_ROOT/.$label.ready"
  if [[ "$timeout" == natural ]]; then
    P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" node -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"ready\n");setTimeout(()=>process.kill(process.pid,process.argv[2]),50)' "$ready" "$signal" &
  else
    P2G_SUPERVISOR_TIMEOUT_MS="$timeout" P2G_FINISH_READY= node "$P2G_SUPERVISOR" \
      sh -c '(trap "" HUP INT TERM; printf "ready\n" >"$1"; while :; do sleep 1; done) & wait' sh "$ready" &
  fi
  P2G_ACTIVE_PID=$!
  while { [[ ! -s "$ready" ]] || [[ ! -s "$P2G_TEST_ROOT/active-group.pid" ]]; } && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$ready" && -s "$P2G_TEST_ROOT/active-group.pid" ]]
  group="$(<"$P2G_TEST_ROOT/active-group.pid")"
  case "$group" in ''|*[!0-9]*|0|1) return 1 ;; esac
  p2g_wait "$P2G_ACTIVE_PID" 400
  if wait "$P2G_ACTIVE_PID"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq "$expected" && ! -e "$P2G_TEST_ROOT/active-group.pid" ]] && ! kill -0 -- "-$group" 2>/dev/null
  rm -f -- "$ready"
}

p2g_parent_exit_probe() {
  local ready="$P2G_TEST_ROOT/.parent-exit.ready" owner probe_root group descendant status
  (
    P2G_TEST_ROOT=""; P2G_ACTIVE_PID=""; P2G_SIGNAL_STATUS=0; P2G_CLEANING=0
    trap p2g_on_exit EXIT
    trap 'p2g_signal 129' HUP; trap 'p2g_signal 130' INT; trap 'p2g_signal 143' TERM
    P2G_TEST_ROOT="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access-probe.XXXXXX")"; export P2G_TEST_ROOT
    local_ready="$P2G_TEST_ROOT/descendant.ready"
    P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" sh -c '(trap "" HUP INT TERM; while :; do sleep 1; done) & descendant=$!; printf "%s\n" "$descendant" >"$1"; wait' sh "$local_ready" &
    P2G_ACTIVE_PID=$!
    for _ in {1..400}; do [[ -s "$P2G_TEST_ROOT/active-group.pid" && -s "$local_ready" ]] && break; sleep 0.01; done
    printf '%s %s %s\n' "$P2G_TEST_ROOT" "$(<"$P2G_TEST_ROOT/active-group.pid")" "$(<"$local_ready")" >"$ready"
    exit 23
  ) & owner=$!
  P2G_ACTIVE_PID="$owner"
  for _ in {1..400}; do [[ -s "$ready" ]] && break; sleep 0.01; done
  [[ -s "$ready" ]]; read -r probe_root group descendant <"$ready"
  case "$group:$descendant" in *[!0-9:]*|:*|*:|0:*|1:*|*:0|*:1) return 1 ;; esac
  p2g_wait "$owner" 400
  if wait "$owner"; then status=0; else status=$?; fi
  P2G_ACTIVE_PID=""
  [[ "$status" -eq 23 && ! -e "$probe_root" ]] && ! kill -0 -- "-$group" 2>/dev/null && ! kill -0 "$descendant" 2>/dev/null
  rm -f -- "$ready"
}

p2g_publication_probe() {
  local owner_root="$P2G_TEST_ROOT" probe_root supervisor_pid status group attempts=0
  probe_root="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access-probe.XXXXXX")"
  P2G_TEST_ROOT="$probe_root" P2G_INJECT_PUBLICATION_FAILURE=1 P2G_INJECT_EVIDENCE_FAILURE=1 \
    P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" \
    node -e 'require("node:fs").writeFileSync(process.argv[1],"worker ran\n")' "$probe_root/worker-ran" >/dev/null 2>&1 &
  supervisor_pid=$!
  while kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
  if kill -0 "$supervisor_pid" 2>/dev/null; then return 1; fi
  if wait "$supervisor_pid"; then status=0; else status=$?; fi
  [[ "$status" -eq 1 && -s "$probe_root/supervisor-preparing.json" && -s "$probe_root/supervisor-anchor.json" \
    && ! -e "$probe_root/active-group.pid" && ! -e "$probe_root/manual-remediation.txt" && ! -e "$probe_root/worker-ran" ]]
  group="$(node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if((fs.statSync(p).mode&0o777)!==0o600||a.state!=="published"||a.leaderPid!==a.processGroup)process.exit(1);process.stdout.write(String(a.processGroup))' "$probe_root/supervisor-anchor.json")"
  case "$group" in ''|*[!0-9]*|0|1) return 1 ;; esac
  ! kill -0 -- "-$group" 2>/dev/null
  node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if((fs.statSync(p).mode&0o777)!==0o600||a.state!=="preparing"||!Number.isInteger(a.supervisorPid))process.exit(1)' "$probe_root/supervisor-preparing.json"
  rm -f -- "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" "$probe_root/active-group.pid"
  P2G_TEST_ROOT="$probe_root"
  if ! p2g_remove; then P2G_TEST_ROOT="$owner_root"; return 1; fi
  P2G_TEST_ROOT="$owner_root"
  [[ ! -e "$probe_root" ]]
}

p2g_forced_parent_exit_probe() {
  local owner_root="$P2G_TEST_ROOT" probe_root supervisor_pid group descendant status attempts=0
  probe_root="$(mktemp -d "$P2G_TEST_PARENT/p2-g-access-probe.XXXXXX")"
  P2G_TEST_ROOT="$probe_root" P2G_SUPERVISOR_TIMEOUT_MS=120000 P2G_FINISH_READY= node "$P2G_SUPERVISOR" \
    sh -c '(trap "" HUP INT TERM; while :; do sleep 1; done) & descendant=$!; printf "%s\n" "$descendant" >"$1"; wait' \
    sh "$probe_root/descendant.ready" >/dev/null 2>&1 &
  supervisor_pid=$!
  while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$probe_root/descendant.ready" ]]; } \
    && kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
  [[ -s "$probe_root/active-group.pid" && -s "$probe_root/descendant.ready" ]]
  group="$(<"$probe_root/active-group.pid")"; descendant="$(<"$probe_root/descendant.ready")"
  case "$group:$descendant" in *[!0-9:]*|:*|*:|0:*|1:*|*:0|*:1) return 1 ;; esac
  kill -KILL "$supervisor_pid"
  if wait "$supervisor_pid" 2>/dev/null; then status=0; else status=$?; fi
  [[ "$status" -eq 137 ]]
  P2G_TEST_ROOT="$probe_root"; P2G_ACTIVE_PID=""
  if p2g_stop 2>/dev/null; then P2G_TEST_ROOT="$owner_root"; return 1; fi
  [[ -s "$probe_root/manual-remediation.txt" && -s "$probe_root/supervisor-anchor.json" && -s "$probe_root/supervisor-preparing.json" ]] \
    && ! kill -0 -- "-$group" 2>/dev/null && ! kill -0 "$descendant" 2>/dev/null
  node -e 'const fs=require("node:fs");for(const p of process.argv.slice(1)){if((fs.statSync(p).mode&0o777)!==0o600)process.exit(1)}' \
    "$probe_root/manual-remediation.txt" "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json"
  rm -f -- "$probe_root/manual-remediation.txt" "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" \
    "$probe_root/active-group.pid" "$probe_root/target-outcome.json"
  if ! p2g_remove; then P2G_TEST_ROOT="$owner_root"; return 1; fi
  P2G_TEST_ROOT="$owner_root"
  [[ ! -e "$probe_root" ]]
}

for spec in 'HUP 129' 'INT 130' 'TERM 143'; do read -r signal expected <<<"$spec"; p2g_early_probe "$signal" "$expected"; done
for spec in 'HUP 129' 'INT 130' 'TERM 143'; do read -r signal expected <<<"$spec"; p2g_outer_terminal_probe "$signal" "$expected"; done
for spec in 'HUP 129' 'INT 130' 'TERM 143'; do read -r signal expected <<<"$spec"; p2g_active_probe "$signal" "$expected"; done
for spec in 'HUP 129' 'INT 130' 'TERM 143'; do read -r signal expected <<<"$spec"; p2g_terminal_probe "$signal" "$expected"; done
p2g_expected_status_probe timeout 124 500 none
p2g_expected_status_probe natural-hup 129 natural SIGHUP
p2g_expected_status_probe natural-int 130 natural SIGINT
p2g_expected_status_probe natural-term 143 natural SIGTERM
p2g_expected_status_probe natural-kill 137 natural SIGKILL
p2g_parent_exit_probe
p2g_publication_probe
p2g_forced_parent_exit_probe

mkdir -p "$P2G_TEST_ROOT/netlify/lib"
cp netlify/lib/access.mjs "$P2G_TEST_ROOT/netlify/lib/access.mjs"
```

Expected: exit `0` and exactly `PASS  P2-G predecessor contracts`; all lifecycle probes are silent. HUP/INT/TERM handling and EXIT ownership are installed before the retained guarded root is created, and the first signal remains authoritative as 129/130/143 throughout stop, proof, bounded deletion, and final exit. The outer-finalizer rendezvous is emitted only from `p2g_cleanup_impl()` after `p2g_on_exit()` has set `P2G_CLEANING=1` and stop has completed. For each first HUP/INT/TERM, cleanup records that first latched status, publishes a second rendezvous, remains blocked with its handlers active until a distinct second signal is handled, and asserts both the latch and final exit still use the first status before deletion proceeds. The exact retained shell/supervisor source is also exercised against early/empty-root signals; active owner signals with a TERM-resistant descendant; signals after a prior target outcome entered supervisor cleanup; the finite timeout; natural child HUP/INT/TERM/KILL statuses 129/130/143/137; ordinary parent exit; forced supervisor parent exit; and combined active-publication/locator-write failure. Before it spawns a detached process, the supervisor writes a mode-`0600` preparing record. The detached Node anchor waits on a private inherited pipe, publishes its own positive PID=PGID, and cannot launch the worker until the supervisor has written the active record and sent `go`; parent death or any publication exception closes that pipe without launching access-suite code. Once released, the anchor remains the live direct-child group leader until group-wide TERM-to-KILL completes, the supervisor reaps it, and the group is proved absent. The outer fallback revalidates the exact live anchor before each signal and never signals its numeric PGID after leader exit. Missing active state is not evidence of safety: preparing/anchor records or forced supervisor cleanup retain the guarded root and a mode-`0600` actionable locator when writable. The forced-parent probe proves descendants disappear but remediation remains because the outer shell cannot reap the orphaned anchor; the publication/evidence probe proves its prewritten records remain sufficient when locator creation fails. Both explicitly remediate their isolated roots and require zero residue. The access-suite root remains available across steps 2–3. On any later failure, EXIT cleanup preserves the earlier nonzero status unless the first terminal signal supplies 129/130/143 and deletes the root only after ownership, reaping, and containment are proved.

Create a deterministic contract-compatible P2-B fixture. It is written only under the temporary root:

```bash
set -euo pipefail

install -m 600 /dev/stdin "$P2G_TEST_ROOT/netlify/lib/store.mjs" <<'STORE'
export class StoreError extends Error {
  constructor(code, status, message, { cause } = {}) {
    super(message, cause === undefined ? {} : { cause });
    this.name = "StoreError";
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status, message, cause) => {
  throw new StoreError(code, status, message, cause === undefined ? {} : { cause });
};

export function assertKey(key) {
  if (typeof key !== "string" || new TextEncoder().encode(key).length < 1 ||
      new TextEncoder().encode(key).length > 600 || key.startsWith("/") ||
      key.startsWith("%2F")) {
    fail("invalid-key", 400, "Invalid state key");
  }
  return key;
}

export function assertDocId(docId) {
  if (typeof docId !== "string" || !/^[0-9a-f]{6}$/.test(docId)) {
    fail("invalid-key", 400, "Invalid state key");
  }
  return docId;
}

export function upgrade(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !Object.hasOwn(value, "v") || !Number.isInteger(value.v)) {
    fail("invalid-record", 500, "Invalid stored record");
  }
  if (value.v !== 1) fail("unsupported-version", 500, "Unsupported stored record version");
  return value;
}

export async function read(store, key, initial = null) {
  assertKey(key);
  let found;
  try {
    found = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  } catch (cause) {
    fail("unavailable", 503, "State store unavailable", cause);
  }
  if (found === null) {
    return { value: initial === null ? null : structuredClone(upgrade(initial)), etag: null };
  }
  if (typeof found.etag !== "string" || found.etag.length === 0) {
    fail("invalid-record", 500, "Invalid stored record");
  }
  return { value: upgrade(found.data), etag: found.etag };
}

export async function mutate(store, key, initial, apply) {
  const current = await read(store, key, initial);
  const next = apply(structuredClone(current.value));
  if (next === null) return { ...current, changed: false };
  upgrade(next);
  const options = current.etag === null ? { onlyIfNew: true } : { onlyIfMatch: current.etag };
  let result;
  try {
    result = await store.setJSON(key, next, options);
  } catch (cause) {
    fail("unavailable", 503, "State store unavailable", cause);
  }
  if (!result.modified) fail("conflict", 409, "Concurrent write limit reached");
  return { value: next, etag: result.etag, changed: true };
}

export function docState() {
  if (!globalThis.__p2gStore) throw new Error("P2-G fixture store was not installed");
  return globalThis.__p2gStore;
}
STORE
```

The fixture deliberately implements only the already-final P2-B contract that P2-G is permitted to consume. It does not alter the repository copy of `store.mjs`.

### 2. Run the deterministic access contract suite

Continue in the same shell. Write and run this one temporary Node module:

```bash
set -euo pipefail

install -m 600 /dev/stdin "$P2G_TEST_ROOT/test.mjs" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as access from "./netlify/lib/access.mjs";
import { StoreError, assertKey } from "./netlify/lib/store.mjs";

const expectedExports = [
  "AccessError", "ROLE_CAPABILITIES", "accessDocumentKey", "accessGrantKey",
  "accessGrantPrefix", "accessInvitationKey", "accessInvitationPrefix",
  "assertAccessDocument", "assertAccessGrant", "assertAccessInvitation",
  "assertAccessInvitationAtKey",
  "assertIdentitySub", "capabilitiesFor", "emailHash", "normalizeEmail",
  "parseDocOwners", "resolveRole",
].sort();
assert.deepEqual(Object.keys(access).sort(), expectedExports);

const accessSource = readFileSync(new URL("./netlify/lib/access.mjs", import.meta.url), "utf8");
const storeImports = accessSource.match(
  /import\s*\{[\s\S]*?\}\s*from\s*["']\.\/store\.mjs["'];?/g,
) ?? [];
assert.equal(storeImports.length, 1, "access.mjs must have one static store import");
assert.equal(storeImports[0].replace(/\s+/g, " "),
  'import { StoreError, assertDocId, assertKey, docState, read, upgrade, } from "./store.mjs";');
const executableAccessSource = accessSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(executableAccessSource,
  /(?:\.getWithMetadata|\[\s*["']getWithMetadata["']\s*\])\s*\(/,
  "access.mjs must delegate reads instead of calling the provider directly");
assert.doesNotMatch(executableAccessSource,
  /\b(?:function|class|const|let|var)\s+(?:read|upgrade)\b/,
  "access.mjs must not shadow imported read or upgrade helpers");
assert.match(executableAccessSource, /\bawait\s+read\s*\(/,
  "access.mjs must call the imported strong-read helper");
for (const name of ["assertAccessDocument", "assertAccessGrant", "assertAccessInvitation"]) {
  const body = executableAccessSource.match(
    new RegExp(`^export function ${name}\\([\\s\\S]*?^\\}`, "m"),
  )?.[0];
  assert.ok(body, `${name} must own a concrete function body`);
  assert.match(body, /\bupgrade\s*\(/, `${name} must call the imported upgrade helper`);
}
const publicTypedefs = [
  "DocumentRole", "ThreadControl", "AccessUser", "AccessActor", "AccessDocument",
  "AccessGrant", "AccessInvitation", "AccessCapabilities", "ResolvedAccess", "AccessStore",
  "ResolveOptions",
];
for (const name of publicTypedefs) {
  const declarations = accessSource.match(new RegExp(`\\b${name}\\s*\\*\\/`, "g")) ?? [];
  assert.equal(declarations.length, 1, `${name} must have one public JSDoc declaration`);
}
const normalizedJSDoc = accessSource
  .replace(/^[ \t]*\*[ \t]?/gm, "")
  .replace(/\s+/g, " ");
for (const declaration of [
  '@typedef {"owner" | "editor" | "commenter" | "viewer" | "none"} DocumentRole',
  '@typedef {"any" | "own" | "none"} ThreadControl',
  "@typedef {{ sub: string, email: string, name: string, isOrg: boolean }} AccessUser",
  "@typedef {{ sub: string, name: string, email: string }} AccessActor",
  "@typedef {{ v: 1, docId: string, ownerSub: string, ownerEmail: string, orgDefault: \"commenter\" | \"viewer\" | \"none\", boundAt: string, boundFrom: \"env:DOC_OWNERS\" }} AccessDocument",
  "@typedef {{ v: 1, docId: string, sub: string, email: string, name: string, role: \"editor\" | \"commenter\" | \"viewer\", grantedBy: AccessActor, grantedAt: string, fromInvitation: string | null }} AccessGrant",
  "@typedef {{ v: 1, docId: string, email: string, role: \"editor\" | \"commenter\" | \"viewer\", invitedBy: AccessActor, invitedAt: string, expiresAt: string, accountCreated: boolean }} AccessInvitation",
  "@typedef {{ canRead: boolean, canComment: boolean, threadControl: ThreadControl, canSuggest: boolean, canEdit: boolean, canAccept: boolean, canShare: boolean, canSeeMembers: boolean }} AccessCapabilities",
  "@typedef {{ role: DocumentRole, shared: boolean } & AccessCapabilities} ResolvedAccess",
  '@typedef {{ getWithMetadata(key: string, options: { type: "json", consistency: "strong" }): Promise<null | { data: unknown, etag: string }>, setJSON(key: string, value: object, options: { onlyIfNew: true }): Promise<{ modified: boolean, etag?: string }>, delete(key: string): Promise<unknown> }} AccessStore',
  "@typedef {{ consumeInvitation?: boolean, store?: AccessStore, docOwners?: string, now?: string }} ResolveOptions",
]) {
  assert.ok(normalizedJSDoc.includes(declaration), `missing exact JSDoc: ${declaration}`);
}

const DOC = "4b7d2a";
const OTHER_DOC = "0a1b2c";
const NOW = "2026-09-02T16:30:00.000Z";
const OWNER_HASH = "78f632ac5b62c89afb35f389d6d0436b";
const REVIEWER_HASH = "d3a028e466c0c42c5f0f183aa57bb123";
const MEMBER_HASH = "b6e346dee08f8e8cf029179eb5177b5c";
const OWNER = {
  sub: "u_fixture_owner_11", email: "owner@sample.invalid",
  name: "Avery Quill", isOrg: false,
};
const OWNER_RACER = {
  sub: "u_fixture_owner_12", email: "owner@sample.invalid",
  name: "Morgan Reed", isOrg: false,
};
const MEMBER = {
  sub: "u_fixture_member_33", email: "member@example.com",
  name: "Sage Rowan", isOrg: true,
};
const REVIEWER = {
  sub: "u_fixture_reviewer_22", email: "reviewer@partner.invalid",
  name: "River Vale", isOrg: false,
};
const ACTOR = { sub: OWNER.sub, name: OWNER.name, email: OWNER.email };
const assertOpaqueStoreKey = (key) => {
  assert.equal(typeof key, "string");
  assert.ok(!key.includes("@"));
  assert.ok(!key.includes("partner.invalid"));
  assert.ok(!key.includes("sample.invalid"));
};

class FakeStore {
  constructor(barrierKey = null) {
    this.entries = new Map();
    this.reads = [];
    this.writes = [];
    this.deletes = [];
    this.readError = null;
    this.writeError = null;
    this.deleteError = null;
    this.nextETag = 1;
    this.barrierKey = barrierKey;
    this.barrierCalls = 0;
    this.releaseBarrier = null;
    this.barrier = new Promise((resolve) => { this.releaseBarrier = resolve; });
  }
  seed(key, value, etag = '"seed"') {
    assertOpaqueStoreKey(key);
    this.entries.set(key, { value: structuredClone(value), etag });
  }
  async getWithMetadata(key, options) {
    assertOpaqueStoreKey(key);
    assert.deepEqual(options, { type: "json", consistency: "strong" });
    this.reads.push({ key, options: structuredClone(options) });
    if (this.readError) throw this.readError;
    const found = this.entries.get(key);
    return found ? { data: structuredClone(found.value), etag: found.etag } : null;
  }
  async setJSON(key, value, options) {
    assertOpaqueStoreKey(key);
    assert.deepEqual(options, { onlyIfNew: true });
    if (key === this.barrierKey && this.barrierCalls < 2) {
      this.barrierCalls += 1;
      if (this.barrierCalls === 2) this.releaseBarrier();
      await this.barrier;
    }
    this.writes.push({ key, value: structuredClone(value), options: structuredClone(options) });
    if (this.writeError) throw this.writeError;
    const current = this.entries.get(key);
    if (options.onlyIfNew === true && current) return { modified: false };
    if (typeof options.onlyIfMatch === "string" && current?.etag !== options.onlyIfMatch) {
      return { modified: false };
    }
    const etag = `"fixture-${this.nextETag++}"`;
    this.entries.set(key, { value: structuredClone(value), etag });
    return { modified: true, etag };
  }
  async delete(key) {
    assertOpaqueStoreKey(key);
    this.deletes.push(key);
    if (this.deleteError) throw this.deleteError;
    this.entries.delete(key);
  }
  value(key) {
    return this.entries.has(key) ? structuredClone(this.entries.get(key).value) : null;
  }
}

function accessDocument(owner = OWNER, orgDefault = "commenter") {
  return {
    v: 1, docId: DOC, ownerSub: owner.sub, ownerEmail: owner.email,
    orgDefault, boundAt: "2026-09-02T16:04:11.221Z", boundFrom: "env:DOC_OWNERS",
  };
}
function grant(user, role = "commenter", fromInvitation = null) {
  return {
    v: 1, docId: DOC, sub: user.sub, email: user.email, name: user.name, role,
    grantedBy: ACTOR, grantedAt: "2026-09-02T16:20:41.002Z", fromInvitation,
  };
}
function invitation(user, role = "commenter", invitedAt = "2026-09-02T16:18:11.400Z",
                    expiresAt = "2026-10-02T16:18:11.400Z") {
  return {
    v: 1, docId: DOC, email: user.email, role, invitedBy: ACTOR,
    invitedAt, expiresAt, accountCreated: true,
  };
}
const expected = (role, shared) => ({ role, shared, ...access.capabilitiesFor(role) });
const resolvedAccessKeys = [
  "role", "shared", "canRead", "canComment", "threadControl", "canSuggest",
  "canEdit", "canAccept", "canShare", "canSeeMembers",
];
const assertExactResolvedAccess = (result) => {
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(result), resolvedAccessKeys);
  for (const key of resolvedAccessKeys) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, key), {
      value: result[key], writable: true, enumerable: true, configurable: true,
    });
  }
};
const expectAccessError = (fn, code, status, message) => assert.throws(fn, (error) => {
  assert.ok(error instanceof access.AccessError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.equal(error.message, message);
  return true;
});
const expectInvalidRecord = (promise) => assert.rejects(promise, (error) =>
  error instanceof access.AccessError &&
  error.code === "invalid-record" &&
  error.status === 500 &&
  error.message === "Invalid access record");
const hiddenExtra = (value) => Object.defineProperty({ ...value }, "hidden", { value: true });
const without = (value, key) => Object.fromEntries(
  Object.entries(value).filter(([entryKey]) => entryKey !== key));

assert.equal(access.normalizeEmail(" OWNER@SAMPLE.INVALID "), "owner@sample.invalid");
const maxLocalEmail = `${"a".repeat(64)}@sample.invalid`;
const maxTotalEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
assert.equal(access.normalizeEmail(maxLocalEmail), maxLocalEmail);
assert.equal(access.normalizeEmail(maxTotalEmail), maxTotalEmail);
expectAccessError(() => access.normalizeEmail(`${"a".repeat(65)}@sample.invalid`),
  "invalid-email", 400, "Invalid email address");
expectAccessError(() => access.normalizeEmail(
  `${"a".repeat(64)}@${"b".repeat(64)}.invalid`),
  "invalid-email", 400, "Invalid email address");
expectAccessError(() => access.normalizeEmail(`${maxTotalEmail}e`),
  "invalid-email", 400, "Invalid email address");
assert.equal(await access.emailHash(" OWNER@SAMPLE.INVALID "), OWNER_HASH);
assert.equal(await access.emailHash("Reviewer@Partner.Invalid"), REVIEWER_HASH);
assert.equal(await access.emailHash(MEMBER.email), MEMBER_HASH);
assert.equal(access.assertIdentitySub(REVIEWER.sub), REVIEWER.sub);
assert.equal(access.assertIdentitySub(`u${"a".repeat(127)}`), `u${"a".repeat(127)}`);
expectAccessError(() => access.assertIdentitySub(`u${"a".repeat(128)}`),
  "invalid-sub", 400, "Invalid identity subject");
assert.equal(assertKey("%2flowercase-is-not-the-literal-prefix"),
  "%2flowercase-is-not-the-literal-prefix");
assert.throws(() => assertKey("%2Fforbidden-literal-prefix"),
  (error) => error instanceof StoreError && error.code === "invalid-key" && error.status === 400);
for (const sub of ["u%2Flower", "u%2flower"]) {
  expectAccessError(() => access.assertIdentitySub(sub),
    "invalid-sub", 400, "Invalid identity subject");
}
assert.equal(access.accessDocumentKey(DOC), "access/4b7d2a/doc.json");
assert.equal(access.accessGrantPrefix(DOC), "access/4b7d2a/u/");
assert.equal(access.accessGrantKey(DOC, REVIEWER.sub),
  "access/4b7d2a/u/u_fixture_reviewer_22.json");
assert.equal(access.accessInvitationPrefix(DOC), "access/4b7d2a/i/");
const reviewerInviteKey = await access.accessInvitationKey(DOC, REVIEWER.email);
assert.equal(reviewerInviteKey, `access/4b7d2a/i/${REVIEWER_HASH}.json`);
const docRecord = accessDocument();
const grantRecord = grant(REVIEWER, "commenter", REVIEWER_HASH);
const inviteRecord = invitation(REVIEWER);
assert.equal(access.assertAccessDocument(docRecord, DOC), docRecord);
assert.equal(access.assertAccessGrant(grantRecord, DOC, REVIEWER.sub), grantRecord);
assert.equal(access.assertAccessInvitation(inviteRecord, DOC), inviteRecord);
for (const orgDefault of ["commenter", "viewer", "none"]) {
  const record = accessDocument(OWNER, orgDefault);
  assert.equal(access.assertAccessDocument(record, DOC), record);
}
for (const role of ["editor", "commenter", "viewer"]) {
  const record = grant(REVIEWER, role);
  assert.equal(access.assertAccessGrant(record, DOC, REVIEWER.sub), record);
}
for (const role of ["editor", "commenter", "viewer"]) {
  const record = invitation(REVIEWER, role);
  assert.equal(access.assertAccessInvitation(record, DOC), record);
}
assert.equal(await access.assertAccessInvitationAtKey(
  inviteRecord, DOC, reviewerInviteKey, REVIEWER.email), inviteRecord);
assert.equal(await access.assertAccessInvitationAtKey(
  inviteRecord, DOC, reviewerInviteKey), inviteRecord);
for (const wrongKey of [
  access.accessInvitationPrefix(DOC),
  REVIEWER_HASH,
  reviewerInviteKey.replace(REVIEWER_HASH, REVIEWER_HASH.toUpperCase()),
  `access/${OTHER_DOC}/i/${REVIEWER_HASH}.json`,
  "",
  null,
  7,
]) {
  await expectInvalidRecord(access.assertAccessInvitationAtKey(
    inviteRecord, DOC, wrongKey));
}
for (const wrongExpectedEmail of [
  "Reviewer@Partner.Invalid",
  ` ${REVIEWER.email} `,
  "",
  null,
  7,
]) {
  await expectInvalidRecord(access.assertAccessInvitationAtKey(
    inviteRecord, DOC, reviewerInviteKey, wrongExpectedEmail));
}
const wrongKeyInvite = invitation(MEMBER);
assert.equal(access.assertAccessInvitation(wrongKeyInvite, DOC), wrongKeyInvite);
await expectInvalidRecord(access.assertAccessInvitationAtKey(
  wrongKeyInvite, DOC, reviewerInviteKey));
await expectInvalidRecord(access.assertAccessInvitationAtKey(
  inviteRecord, DOC, reviewerInviteKey, MEMBER.email));
const maxName = "N".repeat(200);
for (const name of ["", maxName]) {
  const edgeGrant = {
    ...grantRecord,
    name,
    grantedBy: { ...grantRecord.grantedBy, name },
  };
  const edgeInvite = {
    ...inviteRecord,
    invitedBy: { ...inviteRecord.invitedBy, name },
  };
  assert.equal(access.assertAccessGrant(edgeGrant, DOC, REVIEWER.sub), edgeGrant);
  assert.equal(access.assertAccessInvitation(edgeInvite, DOC), edgeInvite);
}
const emptyEmailGrant = {
  ...grantRecord,
  email: "",
  name: "",
  grantedBy: { ...grantRecord.grantedBy, email: "", name: "" },
};
const emptyEmailActorInvite = {
  ...inviteRecord,
  invitedBy: { ...inviteRecord.invitedBy, email: "", name: "" },
};
assert.equal(access.assertAccessGrant(emptyEmailGrant, DOC, REVIEWER.sub), emptyEmailGrant);
assert.equal(access.assertAccessInvitation(
  emptyEmailActorInvite, DOC), emptyEmailActorInvite);
for (const badGrant of [
  ...["docId", "sub", "email", "name", "role", "grantedBy", "grantedAt", "fromInvitation"]
    .map((key) => without(grantRecord, key)),
  { ...grantRecord, extra: true },
  { ...grantRecord, [Symbol("extra")]: true },
  hiddenExtra(grantRecord),
  { ...grantRecord, docId: OTHER_DOC },
  { ...grantRecord, sub: MEMBER.sub },
  { ...grantRecord, sub: "bad/sub" },
  { ...grantRecord, name: 7 },
  { ...grantRecord, name: "N".repeat(201) },
  { ...grantRecord, email: "Reviewer@Partner.Invalid" },
  { ...grantRecord, role: "owner" },
  { ...grantRecord, role: "none" },
  { ...grantRecord, grantedAt: "2026-09-02T16:20:41Z" },
  { ...grantRecord, grantedAt: "2026-02-30T16:20:41.002Z" },
  { ...grantRecord, fromInvitation: REVIEWER_HASH.toUpperCase() },
  { ...grantRecord, fromInvitation: REVIEWER_HASH.slice(1) },
  { ...grantRecord, fromInvitation: 7 },
  ...["sub", "name", "email"].map((key) => ({
    ...grantRecord, grantedBy: without(grantRecord.grantedBy, key),
  })),
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, name: "N".repeat(201) } },
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, name: 7 } },
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, email: "OWNER@SAMPLE.INVALID" } },
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, sub: "bad/sub" } },
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, extra: true } },
  { ...grantRecord, grantedBy: { ...grantRecord.grantedBy, [Symbol("extra")]: true } },
  { ...grantRecord, grantedBy: hiddenExtra(grantRecord.grantedBy) },
  { ...grantRecord, grantedBy: Object.assign(Object.create(null), grantRecord.grantedBy) },
  Object.assign(Object.create(null), grantRecord),
  Object.assign(Object.create({ inherited: true }), grantRecord),
]) {
  expectAccessError(() => access.assertAccessGrant(badGrant, DOC, REVIEWER.sub),
    "invalid-record", 500, "Invalid access record");
}
for (const badInvite of [
  ...["docId", "email", "role", "invitedBy", "invitedAt", "expiresAt", "accountCreated"]
    .map((key) => without(inviteRecord, key)),
  { ...inviteRecord, extra: true },
  { ...inviteRecord, [Symbol("extra")]: true },
  hiddenExtra(inviteRecord),
  { ...inviteRecord, docId: OTHER_DOC },
  { ...inviteRecord, email: "Reviewer@Partner.Invalid" },
  { ...inviteRecord, email: "" },
  { ...inviteRecord, role: "owner" },
  { ...inviteRecord, role: "none" },
  { ...inviteRecord, invitedAt: "2026-09-02T16:18:11Z" },
  { ...inviteRecord, expiresAt: "2026-10-02T16:18:11Z" },
  { ...inviteRecord, expiresAt: "2026-10-01T16:18:11.400Z" },
  { ...inviteRecord, expiresAt: "2026-10-03T16:18:11.400Z" },
  { ...inviteRecord, accountCreated: "true" },
  ...["sub", "name", "email"].map((key) => ({
    ...inviteRecord, invitedBy: without(inviteRecord.invitedBy, key),
  })),
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, name: "N".repeat(201) } },
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, name: 7 } },
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, email: "OWNER@SAMPLE.INVALID" } },
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, sub: "bad/sub" } },
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, extra: true } },
  { ...inviteRecord, invitedBy: { ...inviteRecord.invitedBy, [Symbol("extra")]: true } },
  { ...inviteRecord, invitedBy: hiddenExtra(inviteRecord.invitedBy) },
  { ...inviteRecord, invitedBy: Object.assign(Object.create(null), inviteRecord.invitedBy) },
  Object.assign(Object.create(null), inviteRecord),
  Object.assign(Object.create({ inherited: true }), inviteRecord),
]) {
  expectAccessError(() => access.assertAccessInvitation(badInvite, DOC),
    "invalid-record", 500, "Invalid access record");
}
expectAccessError(() => access.normalizeEmail("not-an-address"),
  "invalid-email", 400, "Invalid email address");
expectAccessError(() => access.assertIdentitySub("bad/sub"),
  "invalid-sub", 400, "Invalid identity subject");
expectAccessError(() => access.capabilitiesFor("approver"),
  "invalid-role", 400, "Invalid document role");
for (const bad of [
  ...["docId", "ownerSub", "ownerEmail", "orgDefault", "boundAt", "boundFrom"]
    .map((key) => without(docRecord, key)),
  { ...docRecord, extra: true },
  { ...docRecord, [Symbol("extra")]: true },
  hiddenExtra(docRecord),
  { ...docRecord, docId: OTHER_DOC },
  { ...docRecord, ownerSub: "bad/sub" },
  { ...docRecord, ownerEmail: "" },
  { ...docRecord, ownerEmail: "OWNER@SAMPLE.INVALID" },
  { ...docRecord, orgDefault: "editor" },
  { ...docRecord, orgDefault: "owner" },
  { ...docRecord, boundAt: "2026-09-02T16:04:11Z" },
  { ...docRecord, boundAt: "2026-02-30T16:04:11.221Z" },
  { ...docRecord, boundFrom: "request" },
  Object.assign(Object.create(null), docRecord),
  Object.assign(Object.create({ inherited: true }), docRecord),
]) {
  expectAccessError(() => access.assertAccessDocument(bad, DOC),
    "invalid-record", 500, "Invalid access record");
}
assert.throws(() => access.assertAccessDocument({ ...docRecord, v: 2 }, DOC),
  (error) => error instanceof StoreError && error.code === "unsupported-version" && error.status === 500);
assert.throws(() => access.assertAccessDocument({ ...docRecord, v: "1" }, DOC),
  (error) => error instanceof StoreError && error.code === "invalid-record" && error.status === 500);
assert.throws(() => access.assertAccessGrant({ ...grantRecord, v: 2 }, DOC, REVIEWER.sub),
  (error) => error instanceof StoreError && error.code === "unsupported-version" && error.status === 500);
assert.throws(() => access.assertAccessInvitation({ ...inviteRecord, v: "1" }, DOC),
  (error) => error instanceof StoreError && error.code === "invalid-record" && error.status === 500);
await assert.rejects(access.resolveRole(DOC, { ...MEMBER, docs: [DOC] },
  { store: new FakeStore(), docOwners: "", now: NOW }),
  (error) => error instanceof access.AccessError && error.code === "invalid-user" && error.status === 500);
await assert.rejects(access.resolveRole(DOC, { ...MEMBER, email: "not-an-address" },
  { store: new FakeStore(), docOwners: "", now: NOW }),
  (error) => error instanceof access.AccessError && error.code === "invalid-user" && error.status === 500 &&
    error.message === "Invalid access user");
console.log("PASS  access exports, normalization, keys, and records");

for (const blankOwners of [undefined, "", " ", "\t\r\n\f\v"]) {
  assert.deepEqual([...access.parseDocOwners(blankOwners)], []);
}
assert.deepEqual([...access.parseDocOwners(
  " 4b7d2a: OWNER@SAMPLE.INVALID , 0a1b2c:second-owner@example.com ")], [
  [DOC, OWNER.email], [OTHER_DOC, "second-owner@example.com"],
]);
for (const bad of [
  null, `${DOC}:${OWNER.email},${DOC}:${OWNER.email}`, `${DOC}:${OWNER.email},`,
  `${DOC}:${OWNER.email}:extra`, `nothex:${OWNER.email}`, `${DOC}:bad`, "x".repeat(5001),
]) {
  expectAccessError(() => access.parseDocOwners(bad),
    "invalid-config", 500, "Invalid DOC_OWNERS configuration");
}
const matrix = {
  owner: [true, true, "any", true, true, true, true, true],
  editor: [true, true, "any", true, true, true, false, true],
  commenter: [true, true, "own", true, false, false, false, false],
  viewer: [true, false, "none", false, false, false, false, false],
  none: [false, false, "none", false, false, false, false, false],
};
const capabilityKeys = [
  "canRead", "canComment", "threadControl", "canSuggest", "canEdit",
  "canAccept", "canShare", "canSeeMembers",
];
const roleKeys = ["owner", "editor", "commenter", "viewer", "none"];
assert.equal(Object.getPrototypeOf(access.ROLE_CAPABILITIES), Object.prototype);
assert.deepEqual(Reflect.ownKeys(access.ROLE_CAPABILITIES), roleKeys);
assert.ok(Object.isFrozen(access.ROLE_CAPABILITIES));
for (const [role, row] of Object.entries(matrix)) {
  const published = access.ROLE_CAPABILITIES[role];
  assert.deepEqual(Object.getOwnPropertyDescriptor(access.ROLE_CAPABILITIES, role), {
    value: published, writable: false, enumerable: true, configurable: false,
  });
  assert.equal(Object.getPrototypeOf(published), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(published), capabilityKeys);
  assert.deepEqual(Object.values(published), row);
  assert.ok(Object.isFrozen(published));
  for (const [index, key] of capabilityKeys.entries()) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(published, key), {
      value: row[index], writable: false, enumerable: true, configurable: false,
    });
  }

  const shape = access.capabilitiesFor(role);
  assert.deepEqual(Object.values(shape), row);
  assert.equal(Object.getPrototypeOf(shape), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(shape), capabilityKeys);
  shape.canRead = !shape.canRead;
  assert.deepEqual(Object.values(access.capabilitiesFor(role)), row);
}
console.log("PASS  DOC_OWNERS and capability matrix");

for (const badOptions of [
  null,
  [],
  Object.create(null),
  Object.assign(Object.create({ inherited: true }), { now: NOW }),
  { [Symbol("unknown")]: true, now: NOW },
  { store: null, now: NOW },
  { store: undefined, now: NOW },
  { store: {}, now: NOW },
  { store: { getWithMetadata() {}, setJSON() {}, delete: true }, now: NOW },
  { consumeInvitation: "yes", now: NOW },
  { consumeInvitation: undefined, now: NOW },
  { docOwners: null, now: NOW },
  { docOwners: undefined, now: NOW },
  { now: "2026-09-02T16:30:00Z" },
  { now: undefined },
  { unknown: true, now: NOW },
]) {
  await assert.rejects(access.resolveRole(DOC, null, badOptions),
    (error) => error instanceof access.AccessError &&
      error.code === "invalid-option" && error.status === 500 &&
      error.message === "Invalid access option");
}
const inheritedMethodStore = Object.create({
  getWithMetadata() { throw new Error("null-user store read"); },
  setJSON() { throw new Error("null-user store write"); },
  delete() { throw new Error("null-user store delete"); },
});
assert.deepEqual(await access.resolveRole(DOC, null, {
  store: inheritedMethodStore, docOwners: "", now: NOW,
}), expected("none", false));

const exactUserOptions = {store: new FakeStore(), docOwners: "", now: NOW};
const invalidUsers = [
  undefined, false, "user", [], {},
  {sub: MEMBER.sub, email: MEMBER.email, name: MEMBER.name},
  {sub: MEMBER.sub, email: MEMBER.email, name: MEMBER.name, isOrg: "true"},
  {sub: MEMBER.sub, email: 7, name: MEMBER.name, isOrg: true},
  {sub: MEMBER.sub, email: MEMBER.email, name: 7, isOrg: true},
  {sub: MEMBER.sub, email: MEMBER.email, name: "N".repeat(201), isOrg: true},
  {...MEMBER, extra: true},
  {...MEMBER, [Symbol("extra")]: true},
  Object.assign(Object.create(null), MEMBER),
  Object.assign(Object.create({inherited: true}), MEMBER),
];
for (const user of invalidUsers) {
  await assert.rejects(access.resolveRole(DOC, user, exactUserOptions),
    (error) => error instanceof access.AccessError &&
      error.code === "invalid-user" && error.status === 500 &&
      error.message === "Invalid access user");
}
await assert.rejects(access.resolveRole(DOC, {...MEMBER, sub: "bad/sub"}, exactUserOptions),
  (error) => error instanceof access.AccessError &&
    error.code === "invalid-sub" && error.status === 400 &&
    error.message === "Invalid identity subject");
for (const name of ["", "N".repeat(200)]) {
  assert.deepEqual(await access.resolveRole(DOC, {
    ...REVIEWER, email: "", name,
  }, {store: new FakeStore(), docOwners: "", now: NOW}), expected("none", false));
}

const OrderNativeDate = globalThis.Date;
const orderOldNetlify = globalThis.Netlify;
let invalidClockReads = 0;
let invalidEnvironmentReads = 0;
let invalidStoreCalls = 0;
class OrderingDate extends OrderNativeDate {
  constructor(...args) {
    if (args.length === 0) invalidClockReads += 1;
    super(...args);
  }
}
const orderStore = {
  async getWithMetadata() { invalidStoreCalls += 1; throw new Error("invalid-user read"); },
  async setJSON() { invalidStoreCalls += 1; throw new Error("invalid-user write"); },
  async delete() { invalidStoreCalls += 1; throw new Error("invalid-user delete"); },
};
try {
  globalThis.Date = OrderingDate;
  globalThis.Netlify = {env: {get() { invalidEnvironmentReads += 1; return ""; }}};
  for (const user of invalidUsers) {
    await assert.rejects(access.resolveRole(DOC, user, {store: orderStore}),
      (error) => error instanceof access.AccessError && error.code === "invalid-user");
  }
  await assert.rejects(access.resolveRole(
    DOC, {...MEMBER, email: "not-an-address"}, {store: orderStore}),
    (error) => error instanceof access.AccessError && error.code === "invalid-user");
  await assert.rejects(access.resolveRole(DOC, {...MEMBER, sub: "bad/sub"}, {store: orderStore}),
    (error) => error instanceof access.AccessError && error.code === "invalid-sub");
  assert.equal(invalidClockReads, 0);
  assert.equal(invalidEnvironmentReads, 0);
  assert.equal(invalidStoreCalls, 0);
} finally {
  globalThis.Date = OrderNativeDate;
  if (orderOldNetlify === undefined) delete globalThis.Netlify;
  else globalThis.Netlify = orderOldNetlify;
}

const NativeDate = globalThis.Date;
let clockSamples = 0;
class FixedDate extends NativeDate {
  constructor(...args) {
    if (args.length === 0) {
      super(NOW);
      clockSamples += 1;
    } else {
      super(...args);
    }
  }
}
try {
  globalThis.Date = FixedDate;
  await assert.rejects(access.resolveRole("invalid", null),
    (error) => error instanceof StoreError && error.code === "invalid-key");
  await assert.rejects(access.resolveRole(DOC, null, { unknown: true }),
    (error) => error instanceof access.AccessError && error.code === "invalid-option");
  assert.equal(clockSamples, 0, "invalid calls must not sample the clock");
  assert.deepEqual(await access.resolveRole(DOC, null), expected("none", false));
  assert.equal(clockSamples, 1, "a valid null-user call samples exactly once");
  const omittedNowStore = new FakeStore();
  assert.deepEqual(await access.resolveRole(DOC, OWNER, {
    store: omittedNowStore,
    docOwners: `${DOC}:${OWNER.email}`,
  }), expected("owner", true));
  assert.equal(clockSamples, 2, "an omitted-now owner call samples exactly once");
  assert.equal(omittedNowStore.value(access.accessDocumentKey(DOC)).boundAt, NOW);
} finally {
  globalThis.Date = NativeDate;
}

const empty = new FakeStore();
const exactNoneResult = await access.resolveRole(
  DOC, null, { store: empty, docOwners: "", now: NOW });
assert.deepEqual(exactNoneResult, expected("none", false));
assertExactResolvedAccess(exactNoneResult);
assert.equal(empty.reads.length, 0);
const unsharedOrgResult = await access.resolveRole(
  DOC, MEMBER, { store: empty, docOwners: "", now: NOW });
assert.deepEqual(unsharedOrgResult, expected("commenter", false));
assertExactResolvedAccess(unsharedOrgResult);
const authenticatedNoneResult = await access.resolveRole(
  DOC, REVIEWER, { store: empty, docOwners: "", now: NOW });
assert.deepEqual(authenticatedNoneResult, expected("none", false));
assertExactResolvedAccess(authenticatedNoneResult);
const configured = `${OTHER_DOC}:second-owner@example.com`;
assert.deepEqual(await access.resolveRole(OTHER_DOC, MEMBER,
  { store: new FakeStore(), docOwners: configured, now: NOW }), expected("commenter", true));
assert.deepEqual(await access.resolveRole(OTHER_DOC, REVIEWER,
  { store: new FakeStore(), docOwners: configured, now: NOW }), expected("none", true));

const precedence = new FakeStore();
precedence.seed(access.accessDocumentKey(DOC), accessDocument(OWNER, "viewer"));
precedence.seed(access.accessGrantKey(DOC, MEMBER.sub), grant(MEMBER, "commenter"));
precedence.seed(await access.accessInvitationKey(DOC, MEMBER.email), invitation(MEMBER, "editor"));
assert.deepEqual(await access.resolveRole(DOC, OWNER,
  { store: precedence, docOwners: `${DOC}:changed@sample.invalid`, now: NOW }), expected("owner", true));
const grantResult = await access.resolveRole(DOC, MEMBER,
  { store: precedence, docOwners: "", now: NOW });
assert.deepEqual(grantResult, expected("commenter", true));
assertExactResolvedAccess(grantResult);
precedence.entries.delete(access.accessGrantKey(DOC, MEMBER.sub));
const invitationResult = await access.resolveRole(DOC, MEMBER,
  { store: precedence, docOwners: "", now: NOW });
assert.deepEqual(invitationResult, expected("editor", true));
assertExactResolvedAccess(invitationResult);
precedence.seed(await access.accessInvitationKey(DOC, MEMBER.email),
  invitation(MEMBER, "editor", "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"));
assert.deepEqual(await access.resolveRole(DOC, MEMBER,
  { store: precedence, docOwners: "", now: NOW }), expected("viewer", true));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: precedence, docOwners: "", now: NOW }), expected("none", true));

const ownerKey = access.accessDocumentKey(DOC);
const ownerInviteKey = await access.accessInvitationKey(DOC, OWNER.email);
const orphan = new FakeStore();
const orphanGrantKey = access.accessGrantKey(DOC, REVIEWER.sub);
const orphanInviteKey = await access.accessInvitationKey(DOC, REVIEWER.email);
orphan.seed(orphanGrantKey, grant(REVIEWER, "editor"));
orphan.seed(orphanInviteKey, invitation(REVIEWER, "editor"));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: orphan, docOwners: "", now: NOW }), expected("none", false));
orphan.entries.delete(orphanGrantKey);
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: orphan, docOwners: "", now: NOW }), expected("none", false));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: orphan, docOwners: `${DOC}:${OWNER.email}`, now: NOW }), expected("none", true));
assert.deepEqual(orphan.writes, []);
assert.deepEqual(orphan.deletes, []);

const rejectReadsFor = (store, keys, cause) => {
  const rejectedKeys = new Set(keys);
  store.getWithMetadata = async function (key, options) {
    if (rejectedKeys.has(key)) {
      assertOpaqueStoreKey(key);
      assert.deepEqual(options, { type: "json", consistency: "strong" });
      this.reads.push({ key, options: structuredClone(options) });
      throw cause;
    }
    return FakeStore.prototype.getWithMetadata.call(this, key, options);
  };
};

const malformedOrphan = new FakeStore();
malformedOrphan.seed(orphanGrantKey, { ...grant(REVIEWER, "editor"), docId: OTHER_DOC });
malformedOrphan.seed(orphanInviteKey, { ...invitation(REVIEWER, "editor"), docId: OTHER_DOC });
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: malformedOrphan, docOwners: "", now: NOW }), expected("none", false));
assert.deepEqual(malformedOrphan.reads.map(({ key }) => key), [ownerKey]);

const unavailableOrphan = new FakeStore();
rejectReadsFor(unavailableOrphan, [orphanGrantKey, orphanInviteKey],
  new Error("irrelevant orphan child outage"));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: unavailableOrphan, docOwners: `${DOC}:${OWNER.email}`, now: NOW }),
  expected("none", true));
assert.deepEqual(unavailableOrphan.reads.map(({ key }) => key), [ownerKey]);

const unavailableCaptureChildren = new FakeStore();
unavailableCaptureChildren.seed(access.accessGrantKey(DOC, OWNER.sub),
  { ...grant(OWNER, "viewer"), docId: OTHER_DOC });
unavailableCaptureChildren.seed(ownerInviteKey,
  { ...invitation(OWNER, "commenter"), docId: OTHER_DOC });
rejectReadsFor(unavailableCaptureChildren,
  [access.accessGrantKey(DOC, OWNER.sub), ownerInviteKey],
  new Error("irrelevant captured-owner child outage"));
assert.deepEqual(await access.resolveRole(DOC, OWNER, {
  store: unavailableCaptureChildren,
  docOwners: `${DOC}:${OWNER.email}`,
  now: NOW,
  consumeInvitation: true,
}), expected("owner", true));
assert.deepEqual(unavailableCaptureChildren.reads.map(({ key }) => key), [ownerKey]);

const malformedOwnerChildren = new FakeStore();
malformedOwnerChildren.seed(ownerKey, accessDocument());
malformedOwnerChildren.seed(access.accessGrantKey(DOC, OWNER.sub),
  { ...grant(OWNER, "viewer"), docId: OTHER_DOC });
malformedOwnerChildren.seed(ownerInviteKey,
  { ...invitation(OWNER, "commenter"), docId: OTHER_DOC });
assert.deepEqual(await access.resolveRole(DOC, OWNER, {
  store: malformedOwnerChildren, docOwners: "", now: NOW, consumeInvitation: true,
}), expected("owner", true));
assert.deepEqual(malformedOwnerChildren.reads.map(({ key }) => key), [ownerKey]);

const unavailableOwnerChildren = new FakeStore();
unavailableOwnerChildren.seed(ownerKey, accessDocument());
rejectReadsFor(unavailableOwnerChildren,
  [access.accessGrantKey(DOC, OWNER.sub), ownerInviteKey],
  new Error("irrelevant owner child outage"));
assert.deepEqual(await access.resolveRole(DOC, OWNER, {
  store: unavailableOwnerChildren, docOwners: "", now: NOW, consumeInvitation: true,
}), expected("owner", true));
assert.deepEqual(unavailableOwnerChildren.reads.map(({ key }) => key), [ownerKey]);

const malformedRelevantGrant = new FakeStore();
malformedRelevantGrant.seed(ownerKey, accessDocument());
malformedRelevantGrant.seed(orphanGrantKey,
  { ...grant(REVIEWER, "editor"), docId: OTHER_DOC });
await assert.rejects(access.resolveRole(DOC, REVIEWER,
  { store: malformedRelevantGrant, docOwners: "", now: NOW }),
  (error) => error instanceof access.AccessError &&
    error.code === "invalid-record" && error.status === 500);

const unavailableRelevantGrant = new FakeStore();
unavailableRelevantGrant.seed(ownerKey, accessDocument());
rejectReadsFor(unavailableRelevantGrant, [orphanGrantKey],
  new Error("relevant grant outage"));
await assert.rejects(access.resolveRole(DOC, REVIEWER,
  { store: unavailableRelevantGrant, docOwners: "", now: NOW }),
  (error) => error instanceof StoreError &&
    error.code === "unavailable" && error.status === 503);

const malformedRelevantInvitation = new FakeStore();
malformedRelevantInvitation.seed(ownerKey, accessDocument());
malformedRelevantInvitation.seed(orphanInviteKey,
  { ...invitation(REVIEWER, "editor"), docId: OTHER_DOC });
await assert.rejects(access.resolveRole(DOC, REVIEWER,
  { store: malformedRelevantInvitation, docOwners: "", now: NOW }),
  (error) => error instanceof access.AccessError &&
    error.code === "invalid-record" && error.status === 500);

const unavailableRelevantInvitation = new FakeStore();
unavailableRelevantInvitation.seed(ownerKey, accessDocument());
rejectReadsFor(unavailableRelevantInvitation, [orphanInviteKey],
  new Error("relevant invitation outage"));
await assert.rejects(access.resolveRole(DOC, REVIEWER,
  { store: unavailableRelevantInvitation, docOwners: "", now: NOW }),
  (error) => error instanceof StoreError &&
    error.code === "unavailable" && error.status === 503);

const boundIgnoresConfig = new FakeStore();
boundIgnoresConfig.seed(access.accessDocumentKey(DOC), accessDocument());
assert.deepEqual(await access.resolveRole(DOC, OWNER,
  { store: boundIgnoresConfig, docOwners: `${DOC}:bad`, now: NOW }), expected("owner", true));

const ownerPrecedence = new FakeStore();
ownerPrecedence.seed(access.accessDocumentKey(DOC), accessDocument());
ownerPrecedence.seed(access.accessGrantKey(DOC, OWNER.sub), grant(OWNER, "viewer"));
ownerPrecedence.seed(ownerInviteKey, invitation(OWNER, "commenter"));
const exactOwnerResult = await access.resolveRole(DOC, OWNER, {
  store: ownerPrecedence, docOwners: "", now: NOW, consumeInvitation: true,
});
assert.deepEqual(exactOwnerResult, expected("owner", true));
assertExactResolvedAccess(exactOwnerResult);
assert.equal(ownerPrecedence.reads.filter(({ key }) => key === ownerInviteKey).length, 0);
assert.notEqual(ownerPrecedence.value(ownerInviteKey), null);
assert.deepEqual(ownerPrecedence.writes, []);
assert.deepEqual(ownerPrecedence.deletes, []);

const grantSkipsInvitation = new FakeStore();
const grantSkipInviteKey = await access.accessInvitationKey(DOC, REVIEWER.email);
grantSkipsInvitation.seed(access.accessDocumentKey(DOC), accessDocument());
grantSkipsInvitation.seed(access.accessGrantKey(DOC, REVIEWER.sub), grant(REVIEWER, "viewer"));
grantSkipsInvitation.seed(grantSkipInviteKey, invitation(REVIEWER, "editor"));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: grantSkipsInvitation, docOwners: "", now: NOW }), expected("viewer", true));
assert.equal(grantSkipsInvitation.reads.filter(({ key }) => key === grantSkipInviteKey).length, 0);
assert.deepEqual(grantSkipsInvitation.writes, []);
assert.deepEqual(grantSkipsInvitation.deletes, []);

for (const [invitedAt, expiresAt] of [
  ["2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"],
  ["2026-08-03T16:30:00.000Z", NOW],
]) {
  const expiredOrg = new FakeStore();
  const expiredOrgInviteKey = await access.accessInvitationKey(DOC, MEMBER.email);
  expiredOrg.seed(access.accessDocumentKey(DOC), accessDocument(OWNER, "viewer"));
  expiredOrg.seed(expiredOrgInviteKey,
    invitation(MEMBER, "editor", invitedAt, expiresAt));
  const storedOrgDefaultResult = await access.resolveRole(DOC, MEMBER, {
    store: expiredOrg, docOwners: "", now: NOW, consumeInvitation: true,
  });
  assert.deepEqual(storedOrgDefaultResult, expected("viewer", true));
  assertExactResolvedAccess(storedOrgDefaultResult);
  assert.notEqual(expiredOrg.value(expiredOrgInviteKey), null);
  assert.deepEqual(expiredOrg.writes, []);
  assert.deepEqual(expiredOrg.deletes, []);
}
console.log("PASS  unshared defaults and role precedence");

const ownerRace = new FakeStore(ownerKey);
const raceResults = await Promise.all([
  access.resolveRole(DOC, OWNER,
    { store: ownerRace, docOwners: `${DOC}:${OWNER.email}`, now: NOW }),
  access.resolveRole(DOC, OWNER_RACER,
    { store: ownerRace, docOwners: `${DOC}:${OWNER.email}`, now: NOW }),
]);
assert.equal(ownerRace.barrierCalls, 2);
assert.equal(ownerRace.writes.length, 2);
assert.deepEqual(raceResults.map(({ role }) => role).sort(), ["none", "owner"]);
const captured = ownerRace.value(ownerKey);
assert.equal(raceResults.find(({ role }) => role === "owner").role, "owner");
assert.ok([OWNER.sub, OWNER_RACER.sub].includes(captured.ownerSub));
assert.equal(captured.ownerEmail, OWNER.email);
assert.equal(captured.boundAt, NOW);
const capturedUser = captured.ownerSub === OWNER.sub ? OWNER : OWNER_RACER;
assert.deepEqual(await access.resolveRole(DOC, capturedUser,
  { store: ownerRace, docOwners: `${DOC}:third@sample.invalid`, now: NOW }), expected("owner", true));
assert.equal(ownerRace.value(ownerKey).ownerSub, captured.ownerSub);
console.log("PASS  one-owner concurrent capture");

const inviteKey = await access.accessInvitationKey(DOC, REVIEWER.email);
const reviewerGrantKey = access.accessGrantKey(DOC, REVIEWER.sub);
const expectUnavailable = (promise, expectedCause = undefined) => assert.rejects(promise, (error) => {
  assert.ok(error instanceof StoreError);
  assert.equal(error.name, "StoreError");
  assert.equal(error.code, "unavailable");
  assert.equal(error.status, 503);
  assert.equal(error.message, "State store unavailable");
  assert.equal(error.cause, expectedCause);
  return true;
});
const malformedCreateResults = [
  null,
  "not-an-envelope",
  [],
  { etag: '"missing-modified"' },
  Object.assign(Object.create({ modified: true }), { etag: '"inherited-modified"' }),
  { modified: 1 },
];
for (const createResult of malformedCreateResults) {
  const returnMalformedCreate = async function (key, value, options) {
    assertOpaqueStoreKey(key);
    assert.deepEqual(options, { onlyIfNew: true });
    this.writes.push({ key, value: structuredClone(value), options: structuredClone(options) });
    return createResult;
  };

  const malformedOwnerCreate = new FakeStore();
  malformedOwnerCreate.setJSON = returnMalformedCreate;
  await expectUnavailable(access.resolveRole(DOC, OWNER, {
    store: malformedOwnerCreate, docOwners: `${DOC}:${OWNER.email}`, now: NOW,
  }));
  assert.equal(malformedOwnerCreate.writes.length, 1);
  assert.equal(malformedOwnerCreate.reads.filter(({ key }) => key === ownerKey).length, 1,
    "malformed owner create result must not trigger a collision re-read");

  const malformedInvitationCreate = new FakeStore();
  malformedInvitationCreate.seed(ownerKey, accessDocument());
  malformedInvitationCreate.seed(inviteKey, invitation(REVIEWER));
  malformedInvitationCreate.setJSON = returnMalformedCreate;
  await expectUnavailable(access.resolveRole(DOC, REVIEWER, {
    store: malformedInvitationCreate, docOwners: "", now: NOW, consumeInvitation: true,
  }));
  assert.equal(malformedInvitationCreate.writes.length, 1);
  assert.equal(malformedInvitationCreate.reads.filter(
    ({ key }) => key === reviewerGrantKey).length, 1,
    "malformed invitation create result must not trigger a grant re-read");
  assert.deepEqual(malformedInvitationCreate.deletes, []);
}

const ownerWriteCause = new Error("owner provider write detail");
const thrownOwnerCreate = new FakeStore();
thrownOwnerCreate.writeError = ownerWriteCause;
await expectUnavailable(access.resolveRole(DOC, OWNER, {
  store: thrownOwnerCreate, docOwners: `${DOC}:${OWNER.email}`, now: NOW,
}), ownerWriteCause);
assert.equal(thrownOwnerCreate.writes.length, 1);
assert.equal(thrownOwnerCreate.reads.filter(({ key }) => key === ownerKey).length, 1,
  "thrown owner create must not trigger a collision re-read");
assert.deepEqual(thrownOwnerCreate.deletes, []);

const invitationWriteCause = new Error("invitation provider write detail");
const thrownInvitationCreate = new FakeStore();
thrownInvitationCreate.seed(ownerKey, accessDocument());
thrownInvitationCreate.seed(inviteKey, invitation(REVIEWER));
thrownInvitationCreate.writeError = invitationWriteCause;
await expectUnavailable(access.resolveRole(DOC, REVIEWER, {
  store: thrownInvitationCreate, docOwners: "", now: NOW, consumeInvitation: true,
}), invitationWriteCause);
assert.equal(thrownInvitationCreate.writes.length, 1);
assert.equal(thrownInvitationCreate.reads.filter(
  ({ key }) => key === reviewerGrantKey).length, 1,
  "thrown invitation create must not trigger a grant re-read");
assert.deepEqual(thrownInvitationCreate.deletes, []);

const commitThenMalformed = async function (key, value, options) {
  const committed = await FakeStore.prototype.setJSON.call(this, key, value, options);
  assert.equal(committed.modified, true);
  return { modified: "committed-but-malformed" };
};
const committedMalformedOwner = new FakeStore();
committedMalformedOwner.setJSON = commitThenMalformed;
await expectUnavailable(access.resolveRole(DOC, OWNER, {
  store: committedMalformedOwner, docOwners: `${DOC}:${OWNER.email}`, now: NOW,
}));
assert.equal(committedMalformedOwner.reads.filter(({ key }) => key === ownerKey).length, 1);
const committedOwnerWrites = committedMalformedOwner.writes.length;
assert.deepEqual(await access.resolveRole(DOC, OWNER, {
  store: committedMalformedOwner, docOwners: `${DOC}:changed@sample.invalid`, now: NOW,
}), expected("owner", true));
assert.equal(committedMalformedOwner.writes.length, committedOwnerWrites);

const committedMalformedInvitation = new FakeStore();
committedMalformedInvitation.seed(ownerKey, accessDocument());
committedMalformedInvitation.seed(inviteKey, invitation(REVIEWER));
committedMalformedInvitation.setJSON = commitThenMalformed;
await expectUnavailable(access.resolveRole(DOC, REVIEWER, {
  store: committedMalformedInvitation, docOwners: "", now: NOW, consumeInvitation: true,
}));
assert.equal(committedMalformedInvitation.reads.filter(
  ({ key }) => key === reviewerGrantKey).length, 1);
assert.deepEqual(committedMalformedInvitation.deletes, []);
const committedInvitationWrites = committedMalformedInvitation.writes.length;
assert.deepEqual(await access.resolveRole(DOC, REVIEWER, {
  store: committedMalformedInvitation, docOwners: "", now: NOW, consumeInvitation: true,
}), expected("commenter", true));
assert.equal(committedMalformedInvitation.writes.length, committedInvitationWrites);
assert.equal(committedMalformedInvitation.value(inviteKey), null);

for (const wrapEnvelope of [
  (result) => Object.assign(Object.create(null), result),
  (result) => Object.assign(Object.create({ providerEnvelope: true }), result),
]) {
  const prototypeOwnerCreate = new FakeStore();
  prototypeOwnerCreate.setJSON = async function (key, value, options) {
    return wrapEnvelope(await FakeStore.prototype.setJSON.call(this, key, value, options));
  };
  assert.deepEqual(await access.resolveRole(DOC, OWNER, {
    store: prototypeOwnerCreate, docOwners: `${DOC}:${OWNER.email}`, now: NOW,
  }), expected("owner", true));
  assert.equal(prototypeOwnerCreate.value(ownerKey).ownerSub, OWNER.sub);

  const prototypeInvitationCreate = new FakeStore();
  prototypeInvitationCreate.seed(ownerKey, accessDocument());
  prototypeInvitationCreate.seed(inviteKey, invitation(REVIEWER));
  prototypeInvitationCreate.setJSON = async function (key, value, options) {
    return wrapEnvelope(await FakeStore.prototype.setJSON.call(this, key, value, options));
  };
  assert.deepEqual(await access.resolveRole(DOC, REVIEWER, {
    store: prototypeInvitationCreate, docOwners: "", now: NOW, consumeInvitation: true,
  }), expected("commenter", true));
  assert.notEqual(prototypeInvitationCreate.value(reviewerGrantKey), null);
  assert.equal(prototypeInvitationCreate.value(inviteKey), null);
}
console.log("PASS  direct-create provider envelopes and failures");

const mismatchedInviteBody = new FakeStore();
mismatchedInviteBody.seed(ownerKey, accessDocument());
mismatchedInviteBody.seed(inviteKey, invitation(MEMBER, "editor"));
await assert.rejects(access.resolveRole(DOC, REVIEWER, {
  store: mismatchedInviteBody, docOwners: "", now: NOW,
}), (error) => error instanceof access.AccessError &&
  error.code === "invalid-record" && error.status === 500 &&
  error.message === "Invalid access record");
assert.equal(mismatchedInviteBody.writes.length, 0);
assert.equal(mismatchedInviteBody.deletes.length, 0);

const converting = new FakeStore();
converting.seed(ownerKey, accessDocument());
converting.seed(inviteKey, invitation(REVIEWER));
const spacedReviewer = { ...REVIEWER, email: ` ${REVIEWER.email} ` };
assert.deepEqual(await access.resolveRole(DOC, spacedReviewer,
  { store: converting, docOwners: "", now: NOW }), expected("commenter", true));
assert.equal(converting.writes.length, 0);
assert.equal(converting.deletes.length, 0);
assert.deepEqual(await access.resolveRole(DOC, spacedReviewer,
  { store: converting, docOwners: "", now: NOW, consumeInvitation: true }),
  expected("commenter", true));
assert.equal(converting.value(inviteKey), null);
assert.deepEqual(converting.value(reviewerGrantKey), {
  v: 1, docId: DOC, sub: REVIEWER.sub, email: REVIEWER.email, name: REVIEWER.name,
  role: "commenter", grantedBy: ACTOR, grantedAt: NOW, fromInvitation: REVIEWER_HASH,
});
const writesAfterConversion = converting.writes.length;
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: converting, docOwners: "", now: NOW, consumeInvitation: true }),
  expected("commenter", true));
assert.equal(converting.writes.length, writesAfterConversion);

const existing = new FakeStore();
existing.seed(ownerKey, accessDocument());
existing.seed(reviewerGrantKey, grant(REVIEWER, "viewer"));
existing.seed(inviteKey, invitation(REVIEWER, "commenter"));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: existing, docOwners: "", now: NOW, consumeInvitation: true }), expected("viewer", true));
assert.equal(existing.value(reviewerGrantKey).role, "viewer");
assert.equal(existing.value(inviteKey), null);

const expired = new FakeStore();
expired.seed(ownerKey, accessDocument());
expired.seed(inviteKey,
  invitation(REVIEWER, "commenter", "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"));
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: expired, docOwners: "", now: NOW, consumeInvitation: true }), expected("none", true));
assert.notEqual(expired.value(inviteKey), null);
assert.equal(expired.value(reviewerGrantKey), null);

const convertRace = new FakeStore(reviewerGrantKey);
convertRace.seed(ownerKey, accessDocument());
convertRace.seed(inviteKey, invitation(REVIEWER));
const converted = await Promise.all([
  access.resolveRole(DOC, REVIEWER,
    { store: convertRace, docOwners: "", now: NOW, consumeInvitation: true }),
  access.resolveRole(DOC, REVIEWER,
    { store: convertRace, docOwners: "", now: NOW, consumeInvitation: true }),
]);
assert.deepEqual(converted, [expected("commenter", true), expected("commenter", true)]);
assert.equal(convertRace.barrierCalls, 2);
assert.notEqual(convertRace.value(reviewerGrantKey), null);
assert.equal(convertRace.value(inviteKey), null);

const deleteRetry = new FakeStore();
deleteRetry.seed(ownerKey, accessDocument());
deleteRetry.seed(inviteKey, invitation(REVIEWER));
const deleteCause = new Error("provider delete detail");
deleteRetry.deleteError = deleteCause;
await expectUnavailable(access.resolveRole(DOC, REVIEWER,
  { store: deleteRetry, docOwners: "", now: NOW, consumeInvitation: true }), deleteCause);
assert.notEqual(deleteRetry.value(reviewerGrantKey), null);
assert.notEqual(deleteRetry.value(inviteKey), null);
deleteRetry.deleteError = null;
const retryWrites = deleteRetry.writes.length;
assert.deepEqual(await access.resolveRole(DOC, REVIEWER,
  { store: deleteRetry, docOwners: "", now: NOW, consumeInvitation: true }),
  expected("commenter", true));
assert.equal(deleteRetry.writes.length, retryWrites);
assert.equal(deleteRetry.value(inviteKey), null);
console.log("PASS  invitation lookup and conversion");

const providerDetail = `${OWNER.email}/${OWNER.sub}`;
const readFailure = new FakeStore();
readFailure.readError = new Error(providerDetail);
await assert.rejects(access.resolveRole(DOC, OWNER,
  { store: readFailure, docOwners: "", now: NOW }), (error) => {
  assert.ok(error instanceof StoreError);
  assert.equal(error.code, "unavailable");
  assert.equal(error.status, 503);
  assert.equal(error.message, "State store unavailable");
  assert.equal(error.cause.message, providerDetail);
  assert.ok(!error.message.includes(OWNER.email));
  return true;
});
const writeFailure = new FakeStore();
const privateWriteCause = new Error(providerDetail);
writeFailure.writeError = privateWriteCause;
await expectUnavailable(access.resolveRole(DOC, OWNER,
  { store: writeFailure, docOwners: `${DOC}:${OWNER.email}`, now: NOW }), privateWriteCause);
await assert.rejects(access.resolveRole(DOC, OWNER,
  { store: new FakeStore(), docOwners: `${DOC}:bad`, now: NOW }),
  (error) => error instanceof access.AccessError && error.code === "invalid-config");
const corrupt = new FakeStore();
corrupt.seed(ownerKey, { ...accessDocument(), extra: providerDetail });
await assert.rejects(access.resolveRole(DOC, OWNER,
  { store: corrupt, docOwners: "", now: NOW }),
  (error) => error instanceof access.AccessError && error.code === "invalid-record");
const observed = [];
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = (...args) => observed.push(args);
console.warn = (...args) => observed.push(args);
console.error = (...args) => observed.push(args);
try {
  await access.resolveRole(DOC, MEMBER, { store: new FakeStore(), docOwners: "", now: NOW });
} finally {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
assert.deepEqual(observed, []);
for (const store of [empty, precedence, ownerRace, converting, existing, expired, convertRace, deleteRetry]) {
  for (const key of [...store.entries.keys(), ...store.reads.map(({ key }) => key), ...store.deletes]) {
    assert.ok(!key.includes("@"));
    assert.ok(!key.includes("partner.invalid"));
    assert.ok(!key.includes("sample.invalid"));
  }
  assert.ok(store.reads.every(({ options }) =>
    options.type === "json" && options.consistency === "strong"));
}
console.log("PASS  access failure and privacy boundaries");

const oldOwners = process.env.DOC_OWNERS;
const oldNetlify = globalThis.Netlify;
const hadFixtureStore = Object.hasOwn(globalThis, "__p2gStore");
const oldFixtureStore = globalThis.__p2gStore;
try {
  process.env.DOC_OWNERS = `${DOC}:${OWNER.email}`;
  delete globalThis.Netlify;
  const firstFunctionStore = new FakeStore();
  globalThis.__p2gStore = firstFunctionStore;
  assert.deepEqual(await access.resolveRole(DOC, OWNER, { now: NOW }), expected("owner", true));
  assert.equal(firstFunctionStore.value(ownerKey).ownerSub, OWNER.sub);

  process.env.DOC_OWNERS = `${OTHER_DOC}:${REVIEWER.email}`;
  const secondFunctionStore = new FakeStore();
  globalThis.__p2gStore = secondFunctionStore;
  assert.deepEqual(await access.resolveRole(OTHER_DOC, REVIEWER, { now: NOW }),
    expected("owner", true));
  assert.equal(secondFunctionStore.value(access.accessDocumentKey(OTHER_DOC)).ownerSub,
    REVIEWER.sub);

  process.env.DOC_OWNERS = `${DOC}:wrong@sample.invalid`;
  globalThis.Netlify = {
    env: { get: (key) => key === "DOC_OWNERS" ? `${DOC}:${MEMBER.email}` : undefined },
  };
  const edgeStore = new FakeStore();
  globalThis.__p2gStore = edgeStore;
  assert.deepEqual(await access.resolveRole(DOC, MEMBER, { now: NOW }), expected("owner", true));
  assert.equal(edgeStore.value(ownerKey).ownerSub, MEMBER.sub);
} finally {
  if (oldOwners === undefined) delete process.env.DOC_OWNERS;
  else process.env.DOC_OWNERS = oldOwners;
  if (oldNetlify === undefined) delete globalThis.Netlify;
  else globalThis.Netlify = oldNetlify;
  if (hadFixtureStore) globalThis.__p2gStore = oldFixtureStore;
  else delete globalThis.__p2gStore;
}
console.log("PASS  per-invocation Function and Edge environment lookup");
NODE

p2g_run sh -c 'cd "$1" && exec node test.mjs' sh "$P2G_TEST_ROOT"
```

Expected stdout from the access suite is exactly:

```text
PASS  access exports, normalization, keys, and records
PASS  DOC_OWNERS and capability matrix
PASS  unshared defaults and role precedence
PASS  one-owner concurrent capture
PASS  direct-create provider envelopes and failures
PASS  invitation lookup and conversion
PASS  access failure and privacy boundaries
PASS  per-invocation Function and Edge environment lookup
```

The harness exits nonzero before printing the relevant line on any mismatch. `p2g_run` starts the large Node suite through the retained supervisor and its publication-gated detached anchor with the fixture root as the suite working directory. The anchor—not the suite process—remains the positive process-group leader until the suite and any descendants are stopped, the anchor is reaped, the group is proved absent, and the preparing/anchor/active records are removed; the guarded fixture itself then remains for the later static checks. It uses no network, Netlify account, Identity account, production environment value as test data, fixed port, clock, random value, repository store, or real person/address. The script restores `process.env.DOC_OWNERS`, `globalThis.Netlify`, the fixture store, and console methods in `finally` paths.

### 3. Check static authority and environment boundaries

Run from the repository root:

```bash
set -euo pipefail

test "$(rg -l 'ROLE_CAPABILITIES|function capabilitiesFor|function resolveRole' netlify --glob '*.{mjs,js,ts}')" = "netlify/lib/access.mjs"
test "$(rg -l 'Netlify[^\n]*env[^\n]*get\([^)]*DOC_OWNERS|process[^\n]*env[^\n]*DOC_OWNERS' netlify --glob '*.{mjs,js,ts}')" = "netlify/lib/access.mjs"
! rg -n 'clientContext|appMetadata\.docs|user\.roles|user\.role|console\.(log|warn|error)' netlify/lib/access.mjs
! rg -n 'data-session|query|request\.json|req\.json' netlify/lib/access.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("netlify/lib/access.mjs", "utf8");
const builder = source.match(
  /^export function accessDocumentKey\(docId\)\s*\{[\s\S]*?^\}/m)?.[0];
const documentKeyLiterals = [...source.matchAll(/doc\.json/g)];
assert.ok(builder, "accessDocumentKey must own a concrete function body");
assert.equal(documentKeyLiterals.length, 1,
  "the raw document access-key suffix must have one owner");
assert.equal([...builder.matchAll(/doc\.json/g)].length, 1,
  "the raw document access-key suffix must be owned by accessDocumentKey");
NODE
echo "PASS  sole server authority boundary"
```

Expected: exit `0` and exactly `PASS  sole server authority boundary`. The document-key oracle permits the one required `doc.json` literal inside `accessDocumentKey()` and rejects a second raw construction anywhere else in the module. The static environment assertion is intentionally scoped to direct `DOC_OWNERS` runtime reads, so a later ticket may mention the variable in a validation message, configuration helper, or test without becoming a competing authority definition. The environment lookup itself was executed in both Function and Edge forms by step 2.

No live Netlify smoke is required for P2-G. P2-B already proves the pinned local Blobs API; P3-J owns the Edge integration/latency/revocation smoke, P3-H owns session conversion, P4-J owns real Identity invitation/account work, and P4-S owns CLI environment setting plus redeploy behavior.

### 4. Remove the fixture and run repository gates

Continue in the same shell:

```bash
set -euo pipefail

P2G_REMOVED_ROOT="$P2G_TEST_ROOT"
cleanup_p2g
P2G_TEST_ROOT=""
trap - EXIT HUP INT TERM
test ! -e "$P2G_REMOVED_ROOT"
unset P2G_REMOVED_ROOT P2G_TEST_ROOT P2G_ACTIVE_PID P2G_SIGNAL_STATUS P2G_CLEANING P2G_SUPERVISOR
test ! -e package-lock.json
test ! -e node_modules
test ! -e .netlify
test ! -e netlify/lib/_p2_g_fixture.mjs

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("docs/tickets/P2-G.md", "utf8");
assert.deepEqual([...source.matchAll(/^## (.+)$/gm)].map((match) => match[1]), [
  "Outcome",
  "Context",
  "Scope",
  "Interface contract",
  "Files owned",
  "Dependencies",
  "Acceptance criteria",
  "Test plan",
  "Failure modes",
  "Settled decisions",
  "Assumptions and open questions",
  "References",
]);
const fences = source.match(/^```[^\n]*$/gm) ?? [];
assert.equal(fences.length % 2, 0, "P2-G Markdown fences must be balanced");
NODE

templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P2-G.md netlify/lib/access.mjs
git diff --check

: "${P2G_BASE:?export the exact integrated P2-B base commit for this isolated branch}"
git rev-parse --verify "$P2G_BASE^{commit}" >/dev/null
unexpected="$({
  git diff --name-only --diff-filter=ACDMRTUXB "$P2G_BASE"
  git ls-files --others --exclude-standard
} | LC_ALL=C sort -u | while IFS= read -r path; do
  case "$path" in
    netlify/lib/access.mjs|docs/tickets/P2-G.md) ;;
    *) printf '%s\n' "$path" ;;
  esac
done)"
if [[ -n "$unexpected" ]]; then
  printf 'FAIL  P2-G changed an unowned path:\n%s\n' "$unexpected" >&2
  exit 1
fi
test -z "$(git status --short -- package-lock.json node_modules .netlify netlify/lib/_p2_g_fixture.mjs)"
echo "PASS  P2-G fixture cleaned and repository gates passed"
```

Expected: every command exits `0`; explicit cleanup reuses the same bounded group/reaping and guarded-deletion path, proves the retained root absent, then disables its traps. The exact 12-H2/fence oracle emits nothing, document parity ends with `PASS  every committed document is byte-identical after a rebuild`, typecheck emits no diagnostics, scrub-check ends with `PASS  no denied term and no warning.`, no unowned path is printed, and the final line is exactly `PASS  P2-G fixture cleaned and repository gates passed`. The shell-level `DOC_OWNERS` value is never changed or unset by these commands. Run the exact-base ownership proof on P2-G's isolated source branch before combining it with any other phase-2 branch; P2-G contributes only `netlify/lib/access.mjs` to the implementation diff and its own coordination ticket document.

### 5. Verify publication pointer integrity

Run this after the canonical document commit is pushed and issue #12's pointer is published:

```bash
set -euo pipefail
pointer_json="$(mktemp "${TMPDIR:-/tmp}/p2g-pointer.XXXXXX")"
trap 'rm -f -- "$pointer_json"' EXIT HUP INT TERM
chmod 600 "$pointer_json"
gh issue view 12 --repo aiur-team/architecture-docs --json title,body >"$pointer_json"

node --input-type=module - "$pointer_json" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
const expectedTitle = "P2-G — The access library";
const expectedPath = "docs/tickets/P2-G.md";
assert.equal(issue.title, expectedTitle);
const pointer = /^Implementation specification: \[`([^`]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40,64})\/([^)]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
assert.ok(pointer, "issue body must be the exact two-paragraph canonical-document pointer");
const [, labelPath, commitSha, linkedPath] = pointer;
assert.equal(labelPath, expectedPath);
assert.equal(linkedPath, expectedPath);
assert.equal(
  issue.body,
  `Implementation specification: [\`${expectedPath}\`](https://github.com/aiur-team/architecture-docs/blob/${commitSha}/${expectedPath})\n\nThis issue tracks implementation of the linked canonical specification.`,
);
const resolvedSha = execFileSync("git", ["rev-parse", "--verify", `${commitSha}^{commit}`], { encoding: "utf8" }).trim();
assert.equal(resolvedSha, commitSha, "issue pointer must contain the full commit SHA");
assert.deepEqual(execFileSync("git", ["show", `${commitSha}:${linkedPath}`]), readFileSync(expectedPath));
console.log("PASS  P2-G issue #12 pointer resolves to the byte-identical canonical document");
NODE
```

Expected: the command exits `0`, the issue title and exact two-paragraph body pass, the parsed path is exactly `docs/tickets/P2-G.md`, the object ID is the full commit SHA, and the final line is `PASS  P2-G issue #12 pointer resolves to the byte-identical canonical document`. The mode-`0600` issue JSON file is removed by the trap.

## Failure modes

### Handled

- Null user: return exact `none`/unshared capabilities without environment/store access.
- Unset owner configuration or absent access/grant/invitation records: return the documented default; absence is not an exception.
- Invalid/ambiguous `DOC_OWNERS`: fail closed with 500 before any candidate owner write; do not skip only the bad pair.
- Configured email mismatch: do not bind; use organization default or none.
- Simultaneous initial owner calls: one create wins; every loser strongly re-reads the one authoritative record.
- Environment changed after capture: ignore it for that document; only P4-J transfer changes the stored owner.
- Missing/empty session email with a stable subject: owner/grant-by-sub remains usable, while environment/invitation matching is unavailable. A non-empty invalid email rejects as `invalid-user` before storage lookup.
- Malformed, mismatched, or unavailable child record relevant to a bound non-owner decision: propagate the exact 500/503 access/store error and grant nothing; never repair stored authority silently. Irrelevant child state is not read for an owner or an unbound document and therefore cannot affect those results.
- Explicit grant plus invitation: explicit grant wins; consuming mode removes the redundant invitation without changing the grant.
- Expired invitation: grant nothing, leave the blob unchanged, and fall through to org default/none.
- Concurrent invitation conversion: one grant create wins; all callers resolve from the one grant; delete is repeatable.
- Malformed resolved owner/grant create envelope: reject as exact `StoreError` `unavailable` before treating it as success/collision, re-reading a winner, or deleting an invitation; retry from strong state.
- Crash/provider failure after grant creation and before invitation deletion: return 503; a retry sees/preserves the grant and removes the invitation.
- Provider exception with ambiguous write/delete outcome: expose only `State store unavailable` with the provider detail in `cause`; do not attempt an alternate owner or role.
- Unauthorized role: return capabilities, including `canRead: false`; the consuming handler owns its 403.
- Client authority spoof: ignored because `resolveRole()` accepts only the proven server user and stored/configured server data.

### Deliberately not handled

- Atomicity across invitation and grant, access state and audit event, or two documents. Netlify Blobs has no cross-key transaction.
- A cancel/convert race after the conversion already read a valid invitation. P4-J can revoke the resulting grant; no status/lock record is added.
- Account lookup/creation, recovery mail, token acceptance, or Identity invitation semantics.
- Group membership, co-owner arbitration, per-section/thread roles, cross-document queries, or organization offboarding. Delete the Identity account for global offboarding.
- Ending an already-open browser session or removing HTML already delivered. Revocation applies on the next request/write.
- Email deliverability, DNS/MX lookup, quoted/unicode mailbox syntax, or changing the reserved organization-domain rule.
- An environment edit moving a bound owner. It cannot; transfer is the only ordinary mechanism.
- Edge latency optimization or signed role cookies. P3-J measures first; a cache would weaken immediate revocation.
- HTTP/CORS/body parsing or client rendering. This file is a server library only.

## Settled decisions

- One owner and three grantable roles exist per document. No co-owner and no owner-valued grant.
- `resolveRole()` is the sole document authority. Consumers may project or enforce its result but may not recreate the matrix or precedence.
- Identity supplies `{sub,email,name,isOrg}` only. `isOrg` selects an org default; it is not itself permission. P1-C `roles`, `canComment`, `canEdit`, and `docs` are transitional and must not be read here.
- Runtime authority lives only under `access/<docId>/...` in site-wide strongly consistent `doc-state`; it never lives in `doc.json`, HTML, Identity metadata, or client claims.
- The permanent six-lowercase-hex document ID is the only document key. No slug, alias, instance, route, or client path enters storage.
- A configured environment address seeds only an absent document record. The first matching proven sign-in is captured with `onlyIfNew`; stored `ownerSub` then wins forever until transfer.
- Explicit grants override the org default. The default is `commenter` when unshared/new and may later be changed only to `commenter`, `viewer`, or `none`.
- Invitation access is identity-bound by a proven normalized email and direct hash lookup. The synchronous validator proves body shape; the asynchronous invitation-at-key validator proves the full key/body-email hash relation for resolution and lists. There is no bearer credential, raw-email key, or invitation scan.
- The edge gate resolves invitations read-only. The document-aware session call consumes them grant-first and delete-second. Conversion emits no audit event.
- `canShare` covers every owner-only access mutation; editors may see members but may not invite, change, revoke, default, or transfer.
- `threadControl` is the sole resolve/reopen policy: owner/editor any, commenter own by `sub`, viewer/none never.
- Expected absence resolves; authority outages/corruption reject. Failing closed must remain distinguishable from ordinary 403 denial.
- Access mutations are one-record CAS operations in P4-J; create-only owner/grant writes use `onlyIfNew`. There is no unconditional mutable write or cross-blob transaction.
- Both standalone and repository-backed modes use the same access records. Whoever can deploy a standalone site chooses its seed owner, and the connect tool must say so.
- No access event is subject to the ordinary retention delete after P4-T. P2-G does not write events.

## Assumptions and open questions

### Assumptions

- **“Never throws” reconciliation:** issue #12's thin verification phrase refers to normal authorization absence. Returning `none` on a storage outage or corrupt owner record would turn a server failure into an apparently valid denial and prevent P2-F/P3-H/P3-J from returning 503/500, so those conditions reject with stable safe errors.
- **Configured-but-unbound `shared`:** a valid `DOC_OWNERS` entry makes `shared: true` before capture. That lets the intended owner bind and makes the document's opt-in state truthful without treating any nonmatching caller as owner.
- **Empty degraded email:** a proven user with a stable `sub` and empty email may still match a bound owner/grant; they cannot bind from the environment or claim an invitation. This preserves sub-based authority without treating an absent address as a match.
- **Invitation precedence:** a live invitation outranks `orgDefault` because it is an explicit owner decision for that address, even before mechanical conversion. A grant by `sub` still outranks it.
- **Existing-grant conversion:** when a grant and invitation coexist, conversion preserves the grant and consumes the invitation. Overwriting an explicitly changed role with an older invitation would violate the grant-precedence ruling.
- **ASCII email grammar:** the plan requires normalization/validation but does not select an RFC parser. The bounded ASCII grammar accepts the addresses Netlify Identity and this project use, rejects the delimiters used by `DOC_OWNERS`, and avoids adding a dependency. Supporting quoted or Unicode forms needs a later explicit contract.
- **Environment runtime split:** current official Netlify documentation requires `process.env` in Node Functions and `Netlify.env.get` in Edge Functions; the shared module probes those server globals in that order by runtime, not a client-visible source.
- **Environment activation:** current official documentation says UI/CLI/API environment changes require a build and deploy. P4-S sets the seed before initial deploy; correcting an unbound owner also requires redeploy. Binding removes the standing dependency afterward.
- **Test seams:** `options.store`, `docOwners`, and `now` are explicit internal dependency seams, not request fields. Production handlers must not spread client JSON into `resolveRole()` options.

### Open questions

- **None block P2-G.** P3-J still must verify that the pinned Blobs package and strong-consistency reads work in the deployed Deno Edge runtime and measure guest-path latency. It must fail closed rather than add a cached permission before measurement.
- The ruling plan does not publish a `list()` strong-consistency guarantee. P3-H may list members/invitations for display, but no authorization decision or just-written response may depend on that list.
- Research 09 expects a retention owner, while the ruling-plan table does not name the access-prefix sweep explicitly. This ticket assigns that adjacent responsibility to P4-T, which already amends the retention function for suggestion cleanup and access-event exclusions. P2-G remains read-path-only for expired invitations; the P4-T ticket must repeat this exact sweep contract before Phase 4 is dispatchable.
- Netlify's 5000-character environment value limit is larger than the intended roughly 20-document seed use. If manual editing becomes unwieldy, the already-set trigger is to move seeds to a blob with the variable as fallback; that migration is not P2-G work.

## References

- `docs/research/00-integration-plan.md` §1.1 — one site-wide `doc-state` store, access key layout, strong consistency, one blob per record, guarded mutable writes, create-only records, and no cross-document access query.
- `docs/research/00-integration-plan.md` §1.2 and §1.5 — identity/authorization split, one owner, three grantable roles, runtime authority, audit requirement, `resolveRole()` supremacy, and the prohibition on `doc.json` authority.
- `docs/research/00-integration-plan.md` §2.1, §2.4, and §2.9 — server-owned actor shape, access event names, and the document-aware session projection boundary.
- `docs/research/00-integration-plan.md` §4.7 — P2-G's exclusive file, predecessors, and downstream P3-H/P3-J/P4-J/P4-M/P4-S contracts.
- `docs/tickets/P1-C.md` — Node/ESM/package contract and the temporary identity shape that P2-H later replaces.
- `docs/tickets/P2-B.md` — exact strong-read, `StoreError`, `upgrade`, key validation, CAS mutation, create-only write, retry-purity, and local-test contracts consumed here.
- `docs/prompts/rewrite-tickets.md` — canonical-document publication contract and exact two-paragraph issue-pointer form.
- `docs/research/09-sharing-and-roles.md` §2–§6 and §8–§9 — full capability table, org default, storage records, invitation/owner flows, audit/privacy, and enforcement boundaries. Its ticket letters are superseded by ruling-plan §4.7.
- [Netlify environment variables and Functions](https://docs.netlify.com/build/functions/environment-variables/) — site variables available to Functions use `process.env`; `netlify.toml` variables are not Function runtime variables; checked 2026-09-02.
- [Netlify environment variables and Edge Functions](https://docs.netlify.com/build/edge-functions/environment-variables/) — Functions-scoped site variables are available through `Netlify.env.get`, and changes require a build/deploy; checked 2026-09-02.
- [Netlify CLI environment-variable guide](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/#manage-environment-variables) — `env:set`, context/scope behavior, and deploy activation used by P4-S; checked 2026-09-02.
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — site-wide stores in Functions/Edge Functions, strong consistency, ETags, `onlyIfNew`, and `onlyIfMatch`; checked 2026-09-02.
- [Netlify Identity setup](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/) — `getUser()` returns the current server user or `null`; identity proof remains P1-C/P2-H's boundary, not this library's; checked 2026-09-02.
