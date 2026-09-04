# P4-J — The access write path

## Outcome

Only the document owner can mutate access through one per-document leased write coordinator; successful state changes derive their actor from the server session, attempt the matching retention-exempt access event, and leave a resumable recovery marker whenever this handler creates an Identity account.

## Context

P3-H already owns the read-only `/api/access` roster and P2-G is the sole role and access-record authority. This ticket amends that same Function with the complete owner-only write surface and a private coordinator record that serializes this endpoint's cross-key decisions. It keeps runtime access state outside git and Identity roles, preserves the 50-child integrity ceiling that P3-H enforces, and makes successfully appended `access.*` events retention-exempt without pretending a separate event write is transactional. P4-K consumes the recovery token; P4-L adds browser controls but is never enforcement.

## Scope

### In scope

- Preserve P3-H `GET /api/access?doc=` exactly and add `POST`, `PATCH`, and `DELETE` mutations on `/api/access`.
- Add exact `POST /api/access/transfer` routing from the same Functions v2 module.
- Apply P1-C origin verification, P2-H identity, and P2-G `resolveRole()` independently to every mutation.
- Accept only the closed request variants in this specification and read every body through one 8,192-byte fatal-UTF-8 boundary.
- Acquire one exact `access/<doc>/write.json` lease before inventory, then enumerate and validate the complete grant/invitation inventory before a mutation that can violate the 50-child, invitation-rate, or unique-email invariants.
- Create, amend, and delete P2-G access records using P2-B strong reads and CAS mutation rules.
- Bootstrap a missing external account with `admin.createUser()` and `requestPasswordRecovery()` from pinned `@netlify/identity@2.0.0`.
- Reissue a setup recovery message, without changing access state or emitting an event, when the owner repeats the exact invite POST for a live same-role invitation.
- Revalidate authority through the appropriate unchanged owner/transfer access-document CAS fence immediately before every access or event state commit while the same lease remains live.
- Transfer ownership through a durable phase marker without ever materializing a 51st child: document CAS, redundant target-grant deletion, then former-owner grant reuse/create; either the old owner resumes before the authority CAS or the new owner idempotently repairs after it.
- Attempt exactly one `access.invite`, `access.change`, `access.revoke`, or `access.transfer` event after its authoritative state transition and report an append failure without rolling state back.
- Publish a closed dependency-injection seam for deterministic tests without weakening the production imports.

### Out of scope

- Changing access key builders, record schemas, role precedence, capability rows, owner capture, or invitation-to-grant conversion. P2-G owns those contracts.
- Changing `GET /api/access` or `/api/session` success/error bodies, pagination ceilings, or privacy projection except to share private validated inventory code without observable drift.
- Consuming a recovery token, setting a password, rendering `/invite/`, or issuing auth cookies. P4-K owns that flow.
- Rendering the member list or any invite/role/revoke/transfer control. P3-I/P4-L own the client.
- Sending application email, changing Netlify email templates, exposing a generated password, or storing a recovery token.
- Deleting comments, suggestions, events, or an Identity account when access is revoked.
- Cross-document access queries, group grants, co-owners, bearer links, self-registration, per-user indexes, or a general lock service.
- Realtime/Slack fan-out, retention, polling, logging, analytics, CORS, dependency changes, or any implementation file other than the Function and its permanent ticket-specific test runner.

## Interface contract

### Module and route surface

Amend `netlify/functions/access.mjs`. Its complete runtime exports after this ticket are:

```text
export function createAccessHandler(dependencies = {})
export async function withAccessWriteLease(options)
export default async function handler(req, context)
export const config = { path: ["/api/access", "/api/access/transfer"] }
```

The default export is created once from production dependencies. `createAccessHandler()` accepts only these optional callable dependencies: `requireOriginFn(req)`, `identifyFn(req)`, `resolveRoleFn(doc,user)`, `storeFn()`, `appendEventFn(options)`, `listUsersFn(options)`, `createUserFn(options)`, `requestPasswordRecoveryFn(email)`, `randomBytesFn(size)`, and `nowFn()`. Each result crosses the exact predecessor/provider validation described below. The ordinary dependency object has no symbol/accessor/unknown properties and every supplied value is a function; invalid dependencies throw `TypeError("Invalid access dependencies")` when the factory is called, before any request/provider work. Production defaults are thin wrappers around the named static imports; `listUsersFn` and `createUserFn` call the corresponding `admin` methods with `admin` as receiver. Request data cannot select dependencies. GET may use only `identifyFn`, `resolveRoleFn`, and `storeFn` through P3-H's existing flow; injecting any write dependency must not make GET touch it.

Use static named imports only:

```js
import { admin, requestPasswordRecovery } from "@netlify/identity";
import { randomBytes } from "node:crypto";
import { identify, requireOrigin } from "../lib/identity.mjs";
import {
  AccessError,
  accessDocumentKey,
  accessGrantKey,
  accessGrantPrefix,
  accessInvitationKey,
  accessInvitationPrefix,
  assertAccessDocument,
  assertAccessGrant,
  assertAccessInvitationAtKey,
  assertIdentitySub,
  normalizeEmail,
  resolveRole,
} from "../lib/access.mjs";
import { docState, mutate, read, StoreError } from "../lib/store.mjs";
import { appendEvent } from "./events.mjs";
```

The production dependency wrappers call `admin.listUsers`, `admin.createUser`, and the named `requestPasswordRecovery`. Do not import a low-level GoTrue client, call Identity HTTP endpoints, decode `nf_jwt`, or use a browser SDK.

`listUsersFn({page,perPage})` resolves directly to a dense ordinary array of zero through `perPage` user objects; it is not wrapped in `users`, `data`, or pagination metadata. The array has `Array.prototype`, only own enumerable/writable/configurable decimal index data properties plus the ordinary non-enumerable `length`, no holes, symbols, accessors, or other own keys. Each user is a non-null, non-array ordinary object. Inspect only own data descriptors `id` and `email`: both are enumerable/writable/configurable strings, `id` passes `assertIdentitySub()`, and `email` already equals `normalizeEmail(email)`. Other provider-owned string-keyed data properties are ignored without reading their values; any symbol/accessor, missing/invalid required descriptor, duplicate subject, or duplicate normalized email is malformed provider state and maps to `500 internal-error`. A rejection maps to `503 unavailable`.

`createUserFn({email,password,data:{role:"guest"}})` resolves to one user object under the same `id`/`email` descriptor rules. Its normalized email must equal the requested email; no other property is enumerated or read. A well-formed different email or duplicate/disallowed subject is `500 internal-error`; rejection is `503 unavailable`. `requestPasswordRecoveryFn(email)` has no success payload contract: any normal fulfillment is success and its value is ignored without inspection; every rejection is `503 unavailable`.

Routing first parses only `new URL(req.url).pathname` and accepts exact `/api/access` and `/api/access/transfer`. This pathname/method dispatch necessarily precedes mutation-origin verification. The base route allows `GET, POST, PATCH, DELETE`; transfer allows `POST`. A method not allowed on the recognized route returns 405 with the route-specific `Allow` value before origin, identity, query enumeration, body, store, clock, randomness, Identity admin, or event work. Any unrecognized pathname returns 404 without those calls. A malformed request URL is `400 invalid-request` without origin/identity/state work.

`GET /api/access` preserves P3-H exactly: it accepts only its query form, does not call `requireOrigin()`, and never reaches write dependencies. Every mutation requires no query keys and runs in this exact shared order:

1. After the recognized pathname/method dispatch, call `requireOrigin(req)` before enumerating or interpreting query parameters and before body, identity, role, store, clock, randomness, Identity admin, or event work. Return its thrown `Response` after adding only `Cache-Control: private, no-store`; rethrow a non-Response into the internal boundary.
2. Call `identify(req)` exactly once. `null` returns 401. Validate the exact P2-H four-field identity boundary before use; malformed or rejected identity is 500.
3. Require `Content-Type: application/json` with case-insensitive media type and optional parameters; otherwise 415.
4. Stream/read at most 8,192 bytes with one reader, `Uint8Array` chunks, fatal UTF-8 decoding, one `JSON.parse()`, best-effort cancel on overflow, and exactly-once lock release. Overflow is 413; every other body/stream/JSON failure is 400. Do not call a convenience body method.
5. Validate one exact body variant, including `doc`, before any store or role lookup.
6. Call `resolveRole(doc, user)` once with default non-consuming options, validate the complete exact P2-G result, and require `role === "owner"`, `shared === true`, and `canShare === true`. Any valid insufficient row is 403; malformed/inconsistent output is 500.
7. Open `docState()` exactly once and perform the operation below. No later step re-authorizes from an input role, roster row, HTML flag, or Identity metadata.

The request actor is the fresh exact object `{ sub: user.sub, name: user.name, email: normalizeEmail(user.email) }`. Sample `nowMs = nowFn()` exactly once after authorization and before state work; require a safe 13-digit millisecond integer and derive `now = new Date(nowMs).toISOString()`. Every record/event timestamp in the operation derives from that one value. Generate a password only on the proven missing-account branch.

### Per-document write coordinator and owner fence

Every mutation opens `docState()` once, derives the private key `access/<doc>/write.json`, calls `randomBytesFn(16)` once, requires exactly 16 bytes, and lower-hex encodes the 32-character `leaseId`. This call precedes inventory and is separate from the later 32-byte password call. The write record is private to this file and has exactly:

```json
{
  "v": 1,
  "docId": "4b7d2a",
  "epoch": 7,
  "lease": {
    "id": "4f7a9c31000000000000000000000000",
    "holder": {"kind": "owner", "sub": "u_fixture_owner_11"},
    "acquiredAt": "2026-09-03T16:19:25.123Z",
    "expiresAt": "2026-09-03T16:21:25.123Z"
  },
  "recovery": null,
  "transfer": null
}
```

`epoch` is a safe integer from 0 through `Number.MAX_SAFE_INTEGER`. `lease` is null or the exact object above: ID grammar `^[0-9a-f]{32}$`, canonical timestamps, expiry exactly 120,000 ms after acquisition, and exact `holder`. An owner holder is `{kind:"owner",sub}` with a valid identity subject; the sole maintenance holder is `{kind:"retention"}` with no `sub` or other key. `recovery` is null or the exact recovery marker specified under account bootstrap. `transfer` is null or the exact transfer marker specified under ownership transfer. A private `assertAccessWriteRecord(value,doc,key)` validates the complete version/key/body/timestamp relation and reconstructs a fresh object. The coordinator key is outside P3-H's `u/` and `i/` prefixes, is not a person/grant/invitation, and is explicitly excluded from the 50-child count. P4-T never deletes it.

Acquire through one P2-B `mutate()` with initial `{v:1,docId:doc,epoch:0,lease:null,recovery:null,transfer:null}`. Its pure callback rejects a valid lease with `expiresAt > now` as `409 access-busy` plus `Retry-After: 2`; otherwise it increments `epoch` once and stores the new owner lease while preserving `recovery` and `transfer`. Epoch overflow is `500 internal-error`. P2-B's six-attempt CAS exhaustion is `409 conflict`. The 120-second lease is twice Netlify's documented non-configurable 60-second synchronous Function limit, so a live production invocation cannot age into a second lease; a terminated invocation becomes reclaimable without an immortal lock. No handler renewal exists.

The additional export `withAccessWriteLease(options)` is the sole non-HTTP maintenance boundary and exists only for P4-T. It accepts one exact ordinary object `{store,doc,nowMs,run}`: `doc` and `nowMs` pass this ticket's validators, `store` is the exact P2-B `docState()` store object on which the imported `mutate(store,...)` operates, and `run` is a function; proxies, accessors, symbols, missing/extra keys, or invalid values throw `TypeError("Invalid access lease options")` before state work. The helper never calls `docState()` and passes no arguments to `run`. It creates a 16-byte random ID through the production `randomBytes`, acquires the same coordinator with holder `{kind:"retention"}`, and preserves both markers. A live owner or retention lease returns the fresh exact object `{acquired:false}` without calling `run`; acquisition otherwise awaits `run()` exactly once and returns `{acquired:true,value}`. It releases the matching ID/epoch in `finally`; a release failure rejects even when `run` fulfilled, while a primary `run` rejection remains the rejection and the release failure is discarded without logging. No request value can invoke this export.

After acquisition, strongly read/validate the access document. A valid `ownerSub` unequal to the actor is always `403 forbidden`, whether observed here, during inventory, inside a mutation callback, or after CAS retry; missing/malformed state remains `500`. Before every grant, invitation, coordinator-recovery, or event state commit, call a private `ownerFence()` that uses P2-B `mutate()` on the access document, revalidates the fresh record in every retry, requires the actor still owns it, and returns a fresh byte-equivalent record rather than null so the unchanged record is conditionally written with the current ETag. No unrelated provider/list/Identity work occurs between a successful fence and starting the fenced operation; the target strong read in the explicitly fenced compare-and-delete sequence is part of that one operation. Org-default and transfer document mutations perform this owner check inside their own access-document CAS and need no preceding duplicate fence. Post-transfer commits use `transferFence()` instead. Because every P4-J writer holds the same unexpired lease, an old owner's request authorized before a concurrent transfer either loses acquisition or acquires later and fails this fresh owner check before authority state changes.

Hold the lease through state, recovery, transfer repair, and event work. In `finally`, call `mutate()` on the coordinator and clear only a lease whose `id` and `epoch` equal this request's captured token; a stale request never clears a successor. Response precedence is exact: release failure changes an otherwise successful/no-op 204 to `503 unavailable`; if operation processing has already selected any 4xx or 5xx response, that primary response is preserved and the release failure is discarded without logging. Authoritative state/event outcomes remain intact, and the lease self-recovers when the 120-second expiry passes. Every operation-specific rejection after acquisition still attempts release exactly once under this precedence.

The lease serializes every P4-J owner mutation, so its 50-child, live-invite-rate, and email-inventory decisions are not claimed from independent child CAS calls. P2-G invitation consumption does not acquire this lease; it can replace one invitation with one grant but cannot create a new owner invitation or increase the logical child count. P4-T acquires the exported retention holder before its final invitation re-read/delete fence, so it cannot delete a concurrently renewed invitation. A transient grant-plus-invitation pair during P2-G's grant-first conversion remains governed by P2-G/P3-H and is not falsely described as globally transactional here.

### Closed request variants

Every body is an ordinary JSON object, may present its keys in any order, has exactly the named keys, and has no symbols/accessors/custom prototype after parsing:

| Route/method | Exact body | Meaning |
|---|---|---|
| `POST /api/access` | `{doc,email,role}` | Create one pending invitation |
| `PATCH /api/access` | `{doc,sub,role}` | Change one grant role |
| `PATCH /api/access` | `{doc,email,role}` | Change one pending invitation role |
| `PATCH /api/access` | `{doc,orgDefault}` | Change the org default |
| `DELETE /api/access` | `{doc,sub}` | Revoke one grant |
| `DELETE /api/access` | `{doc,email}` | Cancel one pending invitation |
| `POST /api/access/transfer` | `{doc,sub}` | Transfer to one existing grantee |

`doc` passes P2-B's exact six-lowercase-hex grammar. `sub` passes `assertIdentitySub()` unchanged. `email` is a string and must already equal `normalizeEmail(email)`; the endpoint does not silently repair a browser value. `role` is exactly `editor`, `commenter`, or `viewer`. `orgDefault` is exactly `commenter`, `viewer`, or `none`. Reject `owner`, `none` as a grant role, `action`, actor/author, name, email plus sub, target objects, timestamps, capability fields, and any extra/missing field with 400.

### Complete access inventory

After acquiring the coordinator and before invitation creation, grant-role change, invitation-role change, revoke/cancel, and transfer, read and validate the exact access document and the complete two child prefixes using P3-H's same provider-envelope, key, pagination, and async invitation-key contracts. Refactor that implementation into private functions inside this owned file if useful, but preserve GET's exact call bounds and results.

- Require one access document hit at `accessDocumentKey(doc)` validated by `assertAccessDocument()`; a valid `ownerSub` unequal to the already-authorized actor is `403 forbidden`, consistently with every later owner fence. A missing or malformed record is `500 internal-error`; never classify a valid owner change as corruption.
- List `accessGrantPrefix(doc)` and `accessInvitationPrefix(doc)` with explicit pagination, at most 52 combined data pages, two terminal pulls, and at most 50 combined child keys.
- Strong-read every present child and validate its full key. A concurrent miss is omitted. Reject malformed/foreign/duplicate keys or records. Validate but exclude a redundant grant whose `sub` equals the current `ownerSub` from actionable targets and the member-email uniqueness check, exactly as P3-H does; among the owner and every remaining grant, reject duplicate normalized emails. The redundant owner grant still counts toward the 50-child storage boundary.
- Retain expired invitations in the child count and integrity checks, but do not treat one as a live target; P4-T deletes it. An expired target is 404 for PATCH/DELETE and does not become a new invitation overwrite.
- Sort only for deterministic inspection; authorization and storage keys never depend on provider order.

P3-H's 50-child boundary excludes the owner document and write coordinator and includes grants plus pending invitations, even expired ones. An invitation that would create child 51 returns 409 `member-limit`. A role change does not change the count. Before creating an invitation, also count live invitations whose `invitedAt` is greater than `new Date(nowMs - 3_600_000).toISOString()`; ten such records return 429 `invite-rate-limit`. This is explicitly a live-pending operational throttle, not durable abuse accounting: canceling an invitation removes it from the window. The hard cap, rate check, and email uniqueness are serializable only among lease-participating P4-J requests; the specification makes no cross-provider transaction claim.

### Create invitation and account bootstrap

The write coordinator's `recovery` value is null or this exact marker:

```json
{
  "invitationKey": "access/4b7d2a/i/d3a028e466c0c42c5f0f183aa57bb123.json",
  "email": "reviewer@partner.invalid",
  "role": "viewer",
  "invitedBy": {
    "sub": "u_fixture_owner_11",
    "name": "Fixture Owner",
    "email": "owner@example.invalid"
  },
  "invitedAt": "2026-09-03T16:19:25.123Z",
  "expiresAt": "2026-10-03T16:19:25.123Z",
  "phase": "invitation-pending",
  "accountSub": null
}
```

The key must equal `accessInvitationKey(doc,email)`; email, role, actor, and timestamps pass their predecessor validators; expiry is exactly 30 days after invitation time. `phase` is exactly `invitation-pending`, `account-create-requested`, `recovery-required`, or `recovery-sent`. `accountSub` is null for the first two phases and a valid Identity subject for the last two. No password or recovery token is stored. Every marker write or clear is an exact P2-B coordinator `mutate()` preceded by `ownerFence()`; its callback requires the captured lease ID/epoch and preserves the lease, epoch, and `transfer`. A valid non-null marker blocks every other mutation with `409 recovery-pending`. Only the current owner making the identical `{doc,email,role}` POST may resume it.

For a `POST /api/access`, reject the owner/actor email, a grant email, child 51, and the live-invitation rate limit. A same-key invitation is handled exactly before the new-invitation steps: a malformed record is 500; a live record with a different requested role is 409; and a live record with the same role is the explicit recovery-reissue path below, regardless of `accountCreated`. An expired same-key record is replaced in place under the lease with a fresh P2-G invitation using the requested role/actor/time, while preserving its `accountCreated` boolean; this consumes no new child slot and is a real `access.invite` state transition. No other existing invitation is overwritten.

For the live reissue case, inventory Identity through the exact list contract and require exactly one canonical user whose email matches the invitation. Zero matches is `409 conflict`; duplicate/malformed canonical email state is `500 internal-error`; provider rejection or bounded-page exhaustion is `503 unavailable`. Call `requestPasswordRecoveryFn(email)` once after `ownerFence()`, change no record or timestamp, append no event, and return 204 on fulfillment. A provider rejection is 503 and an identical owner retry may send another message; this explicitly at-least-once mail behavior is safe because it cannot create an account or grant access. For an expired replacement, perform its fenced CAS replacement directly rather than entering the new-account marker flow. When its preserved `accountCreated` is true, inventory the exact one matching Identity user under the same zero/duplicate/exhaustion mapping and make the same recovery request after the replacement write and before the one `access.invite` event; when false, send no recovery because it belongs to a pre-existing account. The renewed state remains authoritative if recovery or event append fails, and a same-role retry takes the live reissue branch without repeating the state transition/event.

For an absent invitation only, continue as follows:

1. Build and validate the exact P2-G invitation derived from the request, actor, and sampled timestamps with `accountCreated: false`. Fence the owner and commit the `invitation-pending` marker before any invitation or Identity call.
2. Fence again and create the invitation with `store.setJSON(key, invitation, { onlyIfNew: true })`. A false modification is 409; an indeterminate result is 503. Resumption is phase-specific: `invitation-pending` accepts an absent key and creates the exact false record, or accepts only that already-present false record; `account-create-requested` and `recovery-required` require that exact false record; `recovery-sent` accepts that exact record with only `accountCreated` false or true. No phase after `invitation-pending` recreates an absent invitation, and any other present state returns 409 while retaining the marker.
3. Determine account existence through `listUsersFn({ page, perPage: 100 })`, starting at page 1 and stopping after the first page shorter than 100, with at most 100 serial pages. Validate every array/user sufficiently to reconstruct canonical subject and email. Continue through exhaustion after a match so duplicate normalized emails fail 500 as malformed provider state; page 100 being full without a terminating short page fails 503 because completeness is unproven. Do not log or return a user.
4. If exactly one account existed before this operation and the marker is still `invitation-pending`, clear the marker, keep `accountCreated: false`, and proceed to the event. Do not create an account or send email.
5. If no account exists, fence and change the marker to `account-create-requested` before calling Identity. Generate exactly 32 random bytes, base64url without padding, and call `createUserFn({ email, password, data: { role: "guest" } })`; validate the returned email and subject and never retain, return, or log the password. If creation succeeds but the process stops before recording the result, the next identical POST lists Identity first, discovers the one matching account, and resumes without creating a duplicate. Provider uniqueness is a backstop, not the recovery mechanism.
6. Once the created-or-recovered subject is known, fence and change the marker to `recovery-required` with that subject. Call `requestPasswordRecoveryFn(email)`. After a definite success, fence and change the marker to `recovery-sent`. An indeterminate/failing call returns 503 with `recovery-required` retained; an identical retry may send a duplicate recovery message rather than strand the account. This is explicitly at-least-once recovery delivery, not exactly once.
7. In `recovery-sent`, fence and mutate the invitation to set only `accountCreated: true`. The callback accepts an already-true exact record as a no-op and validates the complete key/body. If the invitation is absent, do not recreate it: strongly read `accessGrantKey(doc, accountSub)`, require one valid grant whose `docId`, `sub`, normalized `email`, and `role` equal the marker and whose `fromInvitation` is non-null, and treat that exact state as completed P2-G consumption. A malformed grant is 500; an absent or valid mismatching grant is 409. After either the true invitation or exact consumed grant is proven, fence and clear the matching marker. Thus P2-G consumption between the account flag and marker clear cannot resurrect an invitation or permanently block the coordinator.
8. Fence the owner and attempt one `access.invite` event with target `{ email }`, `docVersion: null`, and summary `invited a reviewer as <role>`, then return 204 only if that attempt succeeds. The marker is cleared before event append, so a crash or append failure can leave an invitation without an audit event but cannot cause the handler to repeat the state transition or event attempt on a later duplicate POST.

An owner retries the exact POST to resume any marker. Repeated Identity list/recovery failures return 503 and retain it. After the marker has cleared, repeating the exact POST against the live same-role invitation invokes the bounded recovery-reissue path without recreating the account, extending invitation expiry, or emitting a second event. The operator path is to inspect the controlled Identity site for the marker email, resolve duplicate/corrupt provider users if present, and retry that exact POST. Other access changes remain blocked until the marker clears, so recovery is visible rather than silently abandoned.

### Role/default changes and revocation

Grant PATCH locates exactly `accessGrantKey(doc, sub)`, requires a live validated grant whose subject is not the owner, calls `ownerFence()`, and uses one `mutate()` call. Its pure callback revalidates the fresh record, changes only `role`, `grantedBy: actor`, and `grantedAt: now`, preserves `fromInvitation`, email, name, subject, version, and document, and returns null for the same role. A same-role no-op returns 204 and emits no event. A real change appends `access.change` with target `{ sub }`, null docVersion, and summary `changed access role to <role>`.

Invitation PATCH computes the exact email key, requires a present unexpired contextual record, calls `ownerFence()`, and uses one `mutate()` call. Its pure callback changes only `role`, `invitedBy: actor`, `invitedAt: now`, and `expiresAt` to exact now plus 30 days; it preserves `accountCreated`, email, version, and document. A same-role request is a no-op and does not extend expiry or emit an event. A real change appends `access.change` with `{ email }` and the same safe summary.

Org-default PATCH uses one `mutate()` on the access document. The pure callback revalidates the current owner equals the actor, changes only `orgDefault`, and returns null for the same value. A real change appends `access.change` with target `{ sub: actor.sub }` and summary `changed organization default to <orgDefault>`.

P2-B exposes no conditional delete, and a tombstone would violate P2-G's closed grant/invitation schemas. Therefore DELETE uses this exact compare-and-delete protocol while holding the document lease:

1. Capture the validator-reconstructed target from complete inventory; refuse the owner, expired invitation, or missing target as specified.
2. Call `ownerFence()`, then strongly read and validate the same full key again. A miss or any field difference from the reconstructed snapshot is `409 conflict`; do not delete. Start the following delete immediately, with no awaited provider operation between comparison and `store.delete(key)`.
3. Call `store.delete(key)` once and strong-read the key. A present record, malformed result, throw, or indeterminate delete is `503 unavailable`; a miss completes the state transition. All P4-J writes to that key hold the lease, so no cooperating writer can pass the comparison and then replace the record.
4. For invitation DELETE only, strongly re-inventory the exact normalized email after the confirmed miss. P2-G invitation acceptance is the one non-lease writer and creates its grant before deleting the invitation. If a matching grant now exists, cancellation lost to acceptance: return `409 conflict`, emit no revoke event, and leave that valid grant in place. Otherwise append `access.revoke`.

A successful grant delete appends the same event with `{ sub }`; a successful invitation cancellation uses `{ email }`; both use summary `revoked document access`. Delete is not silently idempotent: an initially missing target is 404 and emits nothing.

### Ownership transfer

`POST /api/access/transfer` refuses the actor subject and requires the target to be one present validated grant, never an invitation. Capture the complete target snapshot and any redundant grant for the current owner from the inventory. If the inventory has 50 children, that existing target grant is the capacity slot later reused for the former owner; transfer never adds first.

Before the authority CAS, fence the old owner and store this exact `transfer` marker while preserving the active lease, epoch, and `recovery:null`:

```json
{
  "fromOwner": {"sub":"u_fixture_owner_11","name":"Fixture Owner","email":"owner@example.invalid"},
  "toOwner": {"sub":"u_fixture_editor_22","email":"editor@example.invalid"},
  "targetGrant": {
    "v": 1,
    "docId": "4b7d2a",
    "sub": "u_fixture_editor_22",
    "email": "editor@example.invalid",
    "name": "Fixture Editor",
    "role": "editor",
    "grantedBy": {"sub":"u_fixture_owner_11","name":"Fixture Owner","email":"owner@example.invalid"},
    "grantedAt": "2026-08-01T12:00:00.000Z",
    "fromInvitation": null
  },
  "at": "2026-09-03T16:19:25.123Z",
  "phase": "owner-pending"
}
```

`targetGrant` is the exact fresh validated grant snapshot captured from inventory. `fromOwner` is the exact actor, `toOwner` contains exactly the target subject/email, `at` equals the sampled operation time, and `phase` is exactly `owner-pending`, `owner-committed`, or `target-grant-removed`. The coordinator validator invokes `assertAccessGrant(targetGrant, accessGrantKey(doc,toOwner.sub))`, requires its subject/email to equal `toOwner`, and requires every marker identity/time to match the enclosing document contract. A non-null transfer marker requires `recovery:null` and blocks ordinary state work until the repair protocol below completes.

Recovery ownership is exact. While phase is `owner-pending` and the access document still names `fromOwner`, only the identical old-owner transfer POST may resume. If the access document already names `toOwner`, or after phase advances to `owner-committed`, only a freshly authorized current `toOwner.sub` may repair it; any P4-J mutation by that new owner first finishes the stored transfer repair and its one event attempt before evaluating the requested operation against a fresh inventory. Other actors receive 403 and a valid but incompatible document/marker relation is 409. Repair is idempotent: every phase transition is a coordinator CAS under the captured lease, already-completed target deletion/former-owner grant creation is recognized from strong validated reads, and no completed step is repeated destructively.

Perform exactly:

1. In `owner-pending`, mutate the access document. In every retry the callback validates the complete record. If it still names `fromOwner`, change only `ownerSub` and `ownerEmail` to `toOwner`; if it already names `toOwner`, return the byte-equivalent record and treat the authority CAS as previously completed; every other owner is 409. This CAS is the final old-owner authority check and the transfer's authority commit; there is no target-role prewrite. Immediately CAS the marker phase to `owner-committed`. A crash between these two CAS operations is reconciled from the access document as described above.
2. For the remainder of this leased saga, a private `transferFence()` first requires the in-memory lease ID/epoch, then uses one P2-B `mutate()` to conditionally rewrite a byte-equivalent access document while requiring exact `toOwner` in every retry. The coordinator and access document are not falsely described as one atomic CAS. Run the fence before each post-transfer state write. It authorizes only completion of the stored transfer; it cannot authorize another request or arbitrary mutation by the former owner.
3. In `owner-committed`, after a transfer fence, compare-and-delete the now-redundant target grant against the stored `targetGrant` snapshot using the same read/equality/delete/read-back discipline as grant revocation. An absent key means a prior attempt completed deletion; a byte-equal hit is deleted; a malformed hit is 500 and a different valid hit is 409. After confirmed absence, CAS the phase to `target-grant-removed`.
4. In `target-grant-removed`, after another transfer fence, mutate the former owner's grant key to the exact editor grant `{ v:1,docId:doc,sub:fromOwner.sub,email:fromOwner.email,name:fromOwner.name,role:"editor",grantedBy:fromOwner,grantedAt:at,fromInvitation:null }`. An already byte-equal grant is completed work; any other valid former-owner grant is validated and overwritten/reused as this exact record. Because target deletion is already proven, an absent key can be created without reaching child 51. Starting from `N <= 50`, the sequence is `N -> N - 1 -> N` for an absent former grant and `N -> N - 1 -> N - 1` for an existing one.
5. Run `transferFence()` again and clear only the exact matching transfer marker. Then attempt `access.transfer` once with target `{ fromSub: fromOwner.sub, toSub: toOwner.sub }`, null docVersion, and summary `transferred document ownership`. Clearing before append preserves the project-wide no-audit-repair rule: a crash or append failure can leave no event but cannot repeat one on repair.

Return 204 only after step 5. Never write an `owner` grant or pre-promote the target to editor. A failure before the authority CAS leaves the original owner and its exact retry can resume. A failure after it leaves the target as sole authority and the durable marker lets that new owner's next mutation finish cleanup before doing anything else. A retry by the old owner is 403. The state is non-atomic but resumable, never permanently consumes the target's redundant capacity slot, and never requires an undocumented repair route.

### Events and HTTP boundary

Call P3-B `appendEvent()` directly after state, never the public HTTP endpoint and never inside `mutate()`. Immediately before it, run `ownerFence()` for invitation/role/default/revoke changes or `transferFence()` for transfer. Pass the exact object `{ store, docId: doc, actor, kind, target, docVersion: null, summary }`. A state change remains authoritative if the fence or append fails; return the mapped 403/409/503 and never roll state back or repeat it inside the same request. There is no atomic state-plus-event transaction or repair queue: a crash or failed fence/append can leave a real access change with no audit event. Any `access.*` event that is successfully appended is retention-exempt under P4-F/P4-T.

All non-P3-H-GET responses set `Cache-Control: private, no-store`. Successful mutations are 204 with no `Content-Type` and a zero-byte body. JSON errors use exact `Content-Type: application/json; charset=utf-8`, body `{"error":"<code>"}` with no trailing LF, and no data-dependent detail.

| Condition | Status/code |
|---|---|
| Successful mutation or exact no-op | `204`, empty body |
| Invalid route reached | `404 not-found` |
| Bad query/body/schema/doc/email/sub/role/default | `400 invalid-request` |
| No identity | `401 unauthenticated` |
| Valid non-owner/inconsistent current owner | `403 forbidden` |
| Missing grant/invitation/transfer target | `404 not-found` |
| Duplicate/self/owner target, target compare mismatch, CAS exhaustion | `409 conflict` |
| Live document writer lease | `409 access-busy` plus `Retry-After: 2` |
| Unfinished bootstrap and non-matching request | `409 recovery-pending` |
| 51st child | `409 member-limit` |
| Ten live pending invitations inside the hour | `429 invite-rate-limit` plus `Retry-After: 3600` |
| Body above 8,192 bytes | `413 payload-too-large` |
| Non-JSON media type | `415 unsupported-media-type` |
| Malformed dependency/record/key/identity/access/event result | `500 internal-error` |
| Store/Identity/admin/recovery/list/delete/read-back unavailable or indeterminate | `503 unavailable` |
| Disallowed method | `405 method-not-allowed` plus exact `Allow` |

P1-C origin rejection remains its exact text/plain 403 rather than JSON. Never serialize/log a password, token, environment value, record, store key, provider body, error/cause/stack, member roster, or whether an arbitrary address owns an account to anyone except through the owner-authorized success/no-success behavior.

## Files owned

- `netlify/functions/access.mjs` — **amended**, created by P3-H; add the complete owner write and transfer surface.
- `scripts/test-p4-j.mjs` — **new**; permanent hermetic/hosted test runner and 120-second process-group supervisor unique to this ticket.

The already-canonical `docs/tickets/P4-J.md` is the specification being amended, not an implementation-owned path. No other implementation file is owned. Do not edit P2-G's access library, P3-B's event module, Identity helpers, templates, Netlify configuration, manifests, dependency files, or generated output.

## Dependencies

- **P3-H:** owns this file's GET/session-compatible read contract, roster validation, and 50-child invariant. P4-J must preserve it.
- **P3-J:** ensures guests are read-gated by the same P2-G authority that writes here; this ticket does not amend the Edge gate.
- **P2-A/P2-H:** supply Functions v2 Identity/admin runtime, origin behavior, and final server identity.
- **P2-G/P2-B:** supply record/key validators, role resolution, strong store, and retry-pure `mutate()`.
- **P3-B:** supplies the exact four access event kinds and `appendEvent()` boundary.
- **P4-K/P4-L:** consume the recovery and write API surfaces after P4-J; neither changes server authorization.
- **P4-F/P4-T:** must retain every successfully appended `access.*` event permanently.

### Maximum safe implementation waves

1. Pure body/result/inventory/coordinator validators and `scripts/test-p4-j.mjs` fixtures can be authored independently from Function orchestration.
2. Serialize all edits to `access.mjs`: first refactor shared roster traversal without changing GET, then add the coordinator and base mutations, then transfer/account/event integration.
3. P4-K may implement its disjoint acceptance files after the recovery-marker contract is fixed; P4-L starts only after the final API shapes land. No other ticket edits `access.mjs` or `scripts/test-p4-j.mjs`.

## Acceptance criteria

- [ ] P3-H GET behavior remains exact while the module exposes only the documented factory/maintenance-lease/default/config surface and exact two-route config.
- [ ] Pathname/method dispatch may precede mutation origin; for every recognized mutation, origin precedes query enumeration/interpretation, body, identity, role, state, clock, randomness, Identity, and events, after which bounded body and exact owner/canShare enforcement run in the stated order.
- [ ] All seven request variants are closed; actor, authority, timestamps, targets, paths, and keys are never accepted from untrusted surplus fields.
- [ ] The exact 120-second per-document lease, epoch/token-safe release, complete inventory, and owner CAS fences serialize P4-J's cross-key decisions and preserve P3-H's 52-page/50-key/54-pull bounds without claiming to serialize P2-G consumption.
- [ ] Invitation creation uses create-only storage, exact 30-day expiry, the live-pending throttle, no self/owner/duplicate target, no raw email in a key, and the coordinator marker makes every pre-event bootstrap crash point resumable; a same-role live invitation can reissue recovery without state/event mutation and an expired record is renewed in place.
- [ ] An existing Identity account causes no account/email write; a normal missing-account path uses one 32-byte password, one account creation, one `accountCreated` CAS update, and one recovery request, while ambiguous recovery may be retried at least once without recreating the account.
- [ ] Grant/invitation/default mutations use pure P2-B CAS callbacks after their final owner fence, preserve every unrelated field, do not extend a same-role invitation, and emit no event for a no-op.
- [ ] Revocation uses the exact read/compare/delete/read-back protocol, detects P2-G invitation acceptance, never deletes Identity/comments/events, and reports initially missing targets as 404.
- [ ] Transfer durably records its exact target snapshot, changes the owner document, removes the redundant target grant, then reuses/creates the former-owner editor grant; starting at 50 never reaches 51, every post-owner write has a transfer fence, and old/new-owner crash recovery is idempotent.
- [ ] Exactly one matching `access.*` append is attempted after each completed real transition, never within CAS; append/crash failure cannot roll state back and may honestly leave no audit event.
- [ ] Error/status/header/body mapping is exact and no response/log reveals credentials, provider data, records, keys, invited-account existence, or error graphs.
- [ ] The permanent P4-J runner's unit, concurrency, crash-point, hosted Identity, repository, scrub, and issue #32 immutable-pointer gates pass under its real 120-second supervisor.

## Test plan

### 1. Hermetic Function contract

Create permanent `scripts/test-p4-j.mjs`; no shared or assumed harness is allowed. Its contract worker loads the production `access.mjs` through `vm.SourceTextModule`, links only exact fakes for Identity, P2-G, P2-B, and P3-B, and poisons `console`, `fetch`, direct SDK/store access, and every undeclared import. It parses the production source with the existing docbuild TypeScript install and rejects dynamic imports, token/cookie decoding, convenience body readers, unbounded timers/retries, and event/admin calls inside a CAS callback. Temporary modules and fixtures live in one `mkdtemp()` directory outside the worktree and are removed in `finally`.

The entry point is its own real supervisor. Parent mode generates an unguessable in-memory nonce and spawns the same file with `--worker`, exact worker `execArgv` `--experimental-vm-modules --no-warnings`, that nonce only in the child environment, `detached: true`, and piped stdout/stderr. Direct `--worker` invocation without the nonce fails. Parent mode caps each stream at 1 MiB, starts one 120,000 ms deadline, forwards `HUP`, `INT`, and `TERM`, and on any timeout/failure signals the child's process group with `SIGTERM`, waits at most 2,000 ms, then sends `SIGKILL` and reaps it. Success requires exit 0, empty stderr, exact stdout, removed temp state, and confirmed process-group disappearance before the parent prints anything. The script itself, not just this wrapper, requires `P4J_BASE` to be exactly one lowercase full commit ID naming an ancestor that contains this canonical ticket and every predecessor but no P4-J implementation change. At that base, predecessor-owned `netlify/functions/access.mjs` must exist and the new `scripts/test-p4-j.mjs` must not exist; the base-to-head ownership gate below must then prove exactly the access amendment and new runner. The script verifies those path conditions, verifies the base resolves to itself with `git rev-parse --verify "${P4J_BASE}^{commit}"`, and fails before fixture work otherwise.

Run exactly:

```bash
set -euo pipefail
: "${P4J_BASE:?export P4J_BASE as the reviewed 40-character lowercase commit ID}"
printf '%s\n' "$P4J_BASE" | grep -Eq '^[0-9a-f]{40}$'
test "$(git rev-parse --verify "${P4J_BASE}^{commit}")" = "$P4J_BASE"
git cat-file -e "${P4J_BASE}:netlify/functions/access.mjs"
if git cat-file -e "${P4J_BASE}:scripts/test-p4-j.mjs" 2>/dev/null; then
  exit 1
fi
node scripts/test-p4-j.mjs contract
```

The worker executes at minimum:

- Both path method matrices, malformed/unknown paths, base GET regression snapshots, and proof that route parsing may precede origin while recognized-mutation origin precedes query/body/identity/state. Exercise every malformed dependency/identity/access/body/query/content-type/stream class and exact headers/bodies/call suppression.
- Each of seven accepted body variants plus every missing/extra/ambiguous field and all scalar boundaries.
- Inventories of 0, 50, and 51; the exact page/pull ceiling; duplicate/foreign/malformed/hash-mismatch children; expired invitations; duplicate email; concurrent misses; and exclusion of owner/write records from the child count.
- Lease acquire/contention/expiry/epoch overflow/token-safe release/release failure with exact primary-response precedence; owner and retention holder exclusion; competing invite decisions at 49/50 children; concurrent rate/email decisions; and owner transfer between initial authorization and every fenced state commit. The old owner must never commit after losing the authority CAS.
- Invitation collisions, live same-role recovery reissue, expired in-place renewal, nine/ten live invitations and boundary time, 100 Identity pages/exhaustion, every exact list/create user envelope failure, existing/missing/duplicate/malformed accounts, 32-byte password encoding, and all crash points before/after invitation, create, marker phases, recovery, P2-G consumption, account flag, marker clear, and event. Exact POST retry must recover each pre-event point without another account; an ambiguous recovery may repeat only the recovery request.
- CAS contention for grant/invitation/default and transfer; no-op suppression; compare mismatch; delete/read-back failure; invitation accept-versus-cancel; and transfers with 49/50 children, present/absent former-owner grants, every marker/authority/delete/former-grant crash point, old-owner exact resume, new-owner next-mutation repair, and post-transfer authority.
- Exact event kind/target/summary/actor/null-docVersion mapping, state-before-event ordering, append 409/503 with retained state, and explicit proof that the oracle does not assert an event exists after a simulated crash between state and append.

Expected: timeout 120 seconds; exit 0; empty stderr; no fixture residue; and exactly these stdout lines:

```text
PASS  P4-J P3-H GET regression
PASS  P4-J owner-only access mutations
PASS  P4-J account and recovery boundary
PASS  P4-J transfer, audit, and crash matrix
```

### 2. Repository and pointer gates

```bash
set -euo pipefail
: "${P4J_BASE:?export P4J_BASE as the reviewed 40-character lowercase commit ID}"
printf '%s\n' "$P4J_BASE" | grep -Eq '^[0-9a-f]{40}$'
test "$(git rev-parse --verify "${P4J_BASE}^{commit}")" = "$P4J_BASE"
git cat-file -e "${P4J_BASE}:netlify/functions/access.mjs"
if git cat-file -e "${P4J_BASE}:scripts/test-p4-j.mjs" 2>/dev/null; then
  exit 1
fi
expected=$(printf '%s\n' netlify/functions/access.mjs scripts/test-p4-j.mjs | sort)
actual=$(git diff --name-only "$P4J_BASE"...HEAD -- ':!docs/tickets/P4-J.md' | sort)
test "$actual" = "$expected"
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check
! rg -n '(nf_jwt|nf_refresh|NETLIFY_AUTH_TOKEN)[=:][[:space:]]*[^[:space:]$<{]' netlify/functions/access.mjs scripts/test-p4-j.mjs

ticket_json=$(mktemp)
trap 'rm -f "$ticket_json"' EXIT
gh api repos/aiur-team/architecture-docs/issues/32 >"$ticket_json"
node --input-type=module - "$ticket_json" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(issue.title, "P4-J — The access write path");
const match = issue.body.match(/^Implementation specification: \[`docs\/tickets\/P4-J\.md`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/docs\/tickets\/P4-J\.md\)\n\nThis issue tracks implementation of the linked canonical specification\.$/);
assert.ok(match);
assert.equal(execFileSync("git", ["show", `${match[1]}:docs/tickets/P4-J.md`], { encoding: "utf8" }), readFileSync("docs/tickets/P4-J.md", "utf8"));
console.log("PASS  P4-J repository gates");
NODE
```

Expected: all commands exit 0; the non-ticket diff contains exactly the Function and permanent P4-J runner; no credential assignment is committed; the issue body is only the immutable two-paragraph pointer; its blob equals the local spec byte-for-byte; and the last line is `PASS  P4-J repository gates`.

### 3. Disposable hosted Identity proof

`scripts/test-p4-j.mjs hosted` is a second mode under the same 120-second process-group supervisor. It requires operator-supplied `P4J_BASE`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_ACCOUNT_SLUG`, `P4J_TEST_EMAIL`, `P4J_MAILBOX_API_URL`, and `P4J_MAILBOX_API_TOKEN`; it rejects empty values before network work and never prints them. It installs exact `playwright@1.55.0` with `npm install --ignore-scripts --no-save --prefix <temp> playwright@1.55.0`, sets `PLAYWRIGHT_BROWSERS_PATH` to a child of that temporary directory, and runs that package's `playwright install chromium`; no repository manifest/cache is changed. The worker creates a randomly named invite-only disposable site, registers site deletion before deployment or fixtures, deploys the integrated candidate, and creates invented owner/editor/commenter/viewer/external identities and one document. It exercises every mutation through HTTPS with real same-origin cookies, races competing writes, inspects strong records/events, and runs the retention dry run. Mail content and recovery links remain only in test-local memory.

The mailbox adapter is frozen here rather than invented in the runner header. `P4J_MAILBOX_API_URL` is one absolute HTTPS URL with no credentials, query, or fragment; `P4J_MAILBOX_API_TOKEN` is sent only as `Authorization: Bearer <token>`. Requests use `POST`, `Content-Type` and `Accept` both `application/json`, `redirect:"error"`, a ten-second abort, and one of two exact bodies: `{"v":1,"action":"wait-recovery","email":"<P4J_TEST_EMAIL>","timeoutMs":30000}` or `{"v":1,"action":"purge","email":"<P4J_TEST_EMAIL>"}`. Wait success is exact status 200 JSON `{"v":1,"messageId":"<1-128 safe ASCII>","url":"<absolute same-site HTTPS URL with one recovery_token fragment>"}`; purge success is exact 204 with zero bytes. Responses are fatal-UTF-8/body-bounded to 8,192 bytes, ordinary exact objects, and never logged. Any other status, shape, redirect, timeout, or duplicate wait result fails the test; cleanup always attempts purge.

Run exactly:

```bash
set -euo pipefail
: "${P4J_BASE:?}"
: "${NETLIFY_AUTH_TOKEN:?}"
: "${NETLIFY_ACCOUNT_SLUG:?}"
: "${P4J_TEST_EMAIL:?}"
: "${P4J_MAILBOX_API_URL:?}"
: "${P4J_MAILBOX_API_TOKEN:?}"
node scripts/test-p4-j.mjs hosted
```

The hosted worker owns cleanup in `finally`: delete fixture blobs/users and its site, then poll with bounded backoff until the Netlify API reports the site absent. Cleanup failure fails the gate even after behavioral success. P4-K and P4-L each own a different disposable site and their own final deletion; neither may borrow or defer cleanup to P4-J, so phases can run independently without a shared-site handoff.

Expected: editor/commenter/viewer receive 403 from every write; concurrent P4-J mutations serialize or return the exact busy response; one normal missing-account invitation creates one account and requests one recovery message; transfer makes the target sole owner without a 51st child; compare-delete cannot erase a replacement; successfully appended access events survive the retention dry run; simulated append failure retains state without claiming an event; all resources are absent; stderr is empty; and stdout is exactly:

```text
PASS  P4-J hosted access, Identity, retention, and cleanup
```

## Failure modes

- Origin, identity, body, or role failure: reject before authority state, Identity admin, randomness, or event work.
- Malformed/corrupt/oversized access inventory: fail closed with no partial projection or mutation; do not truncate a roster claimed complete.
- Live lease: return 409 with bounded retry advice; a terminated holder becomes reclaimable at the exact expiry, and a stale holder cannot clear the successor token.
- Marker/invitation creation collision: retain the marker and return 409 rather than overwrite. An identical owner POST can resume only the exact phase-derived invitation; a proven consumed invitation plus exact matching grant clears `recovery-sent` without recreation.
- Account creation fails or is indeterminate: retain `account-create-requested`; retry lists first and either resumes the one account or retries creation if absence is proven.
- Recovery fails or is indeterminate: retain `recovery-required`, return 503, and allow an identical retry that can duplicate mail but cannot recreate the account or expose its password.
- Invitation account flag CAS fails after recovery: retain `recovery-sent`; identical retry completes the flag and marker clear without resending recovery.
- State succeeds but audit append fails or the process stops before append: retain state and allow the event to be absent; never roll back or claim repair/exactly-once behavior.
- Compare step changes: return 409 without deleting. Delete throws or remains visible: return 503 without a revoke event. Invitation acceptance detected after deletion wins and preserves its grant.
- Transfer fails before document CAS: the old owner remains authority and its exact request can resume `owner-pending`. Failure after document CAS leaves the target owner; that new owner's next mutation first resumes the exact marker through target cleanup and former-owner editor creation, while count never exceeds its starting value.
- Concurrent old-owner mutation: lease acquisition and the final owner CAS fence reject it before its access-state commit; no earlier `resolveRole()` result remains authority.

## Settled decisions

- Runtime grants in `doc-state`, not Identity roles, committed metadata, or client state, are authority.
- The base API uses closed method/body variants; ownership transfer is exact `POST /api/access/transfer` routed from the same file.
- Successful mutations return 204 and clients refetch the P3-H roster; no second write-response schema is introduced.
- The 50-child bound is hard and excludes the owner/coordinator records. One lease makes cap/rate/email decisions serializable among P4-J writers; P2-G conversion remains an explicit external writer.
- Existing accounts receive no automatic bootstrap email. Missing accounts are auto-confirmed with an unrecoverable random password; a durable non-secret coordinator marker makes account discovery, recovery request, invitation flag, and consumption reconciliation resumable. An explicit exact same-role repeat for any live invitation may reissue recovery without another state/event transition.
- Recovery-token consumption is `recoverPassword(token,password)` in P4-K, verified in the official `@netlify/identity@2.0.0` package; `acceptInvite()` is not used for recovery tokens.
- State writes precede audit. There is no transaction across blobs, Identity, email, or events; an event append is attempted once but can be permanently absent. Transfer state uses a durable phase marker solely to repair authority children, not to promise audit repair.
- The owner cannot be revoked or represented as a grant; transfer is the only owner change.

## Assumptions and open questions

- **Assumption:** `@netlify/identity@2.0.0` admin pagination honors positive `page`/`perPage`; its official package README and types expose those options. The 10,000-user scan bound is an implementation ceiling; reaching it returns 503 rather than assuming absence.
- **Assumption:** `admin.createUser()` is allowed under invite-only registration and auto-confirms without email, as the pinned official package states. The hosted gate must prove this before completion.
- **Assumption:** provider uniqueness prevents two successful accounts for one canonical email, but the handler still rejects duplicate/malformed list results.
- **Open operational boundary:** no application-level transaction can make the invitation blob, Identity account, recovery email, and audit event exactly once together. The coordinator recovers access/account/email progress with possible duplicate recovery mail; no audit repair is promised.

## References

- `docs/research/00-integration-plan.md` §§1.1–1.5, 2.4, 4.7 — authoritative access, event, and phase scope.
- `docs/research/09-sharing-and-roles.md` §§2, 4–8 — role matrix, record layout, invitation, transfer, panel, and audit decisions.
- `docs/tickets/P2-G.md` — exact access validators, keys, capability matrix, and owner/invitation authority.
- `docs/tickets/P2-B.md` — strong read, create-only writes, retry-pure CAS, and error taxonomy.
- `docs/tickets/P2-A.md` and `docs/tickets/P2-H.md` — Functions v2 origin and proven identity contracts.
- `docs/tickets/P3-B.md` — exact access event kinds, targets, append helper, and non-transactional ordering.
- `docs/tickets/P3-H.md` and `docs/tickets/P3-J.md` — roster/session read contract and HTML read gate.
- [`@netlify/identity@2.0.0` README](https://unpkg.com/@netlify/identity@2.0.0/README.md), accessed 2026-09-03 — `admin.listUsers`, `admin.createUser`, `requestPasswordRecovery`, `recoverPassword`, and documented user/error behavior.
- [Use Identity in Functions](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/), accessed 2026-09-03 — Identity admin operations are server-Function capabilities, not browser authority.
- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/), accessed 2026-09-03 — synchronous Functions have a non-configurable 60-second execution limit, used to bound the 120-second lease.
