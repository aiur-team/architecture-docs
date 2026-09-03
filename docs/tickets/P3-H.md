# P3-H — GET /api/access, and session takes a doc

## Outcome

Authenticated readers receive one document-aware session projection, and only an owner or editor can retrieve the document's bounded, validated member and outstanding-invitation list.

## Context

P2-H separates verified identity from authorization, and P2-G makes `resolveRole()` the sole document-role decision. This ticket closes the temporary session incompatibility, performs invitation conversion in the Function that already probes the session, and exposes the minimum read-only access roster needed by the later share panel.

## Scope

### In scope

- Amend the P1-C `GET /api/session` Function to require one `?doc=<docId>`, resolve that proven person's document access with invitation consumption, and return the final P2-C-compatible session body.
- Create `GET /api/access?doc=<docId>` for callers whose resolved access has `canSeeMembers: true`.
- Read one access document record, grant-prefix listing, and invitation-prefix listing from P2-B's site-wide strong store only after authorization succeeds.
- Validate every record and its full storage key through P2-G before projecting it.
- Return the owner first, then deterministic grant and live-invitation rows with only the fields the share client needs.
- Bound a roster read to at most 50 child records and map storage/integrity failures to quiet, non-cacheable failures.
- Supply the source-bound P3-H runtime fixture required by P2-H's release-train gate.

### Out of scope

- Creating, changing, revoking, or transferring access; changing `orgDefault`; creating Identity accounts; or sending recovery mail. P4-J owns every access mutation.
- The share button, popover, list rendering, or write controls. P3-I and P4-L own those browser files.
- Changing identity normalization, access precedence, key builders, record validators, or invitation conversion. P2-H and P2-G own those rules.
- Changing the Edge gate or using the roster endpoint to authorize HTML. P3-J owns the gate and calls `resolveRole()` independently.
- Emitting audit events, Slack notifications, realtime events, CORS headers, redirects, logs, analytics, caches, cookies, or a second session format.
- Listing org members who have no explicit grant. `orgDefault` is returned as policy; it is not expanded into a directory query.
- Cross-document queries, pagination exposed to the browser, search, groups, co-owners, or a “shared with me” index.
- Editing `package.json`, `netlify.toml`, `netlify/lib/**`, any template, generated output, research document, or another ticket document.

## Interface contract

### Shared Functions v2 surface

Both owned files are ECMAScript modules with Fetch-style default handlers. Their only runtime exports are the default handler and the exact config below:

```js
// netlify/functions/session.mjs
export default async function handler(req) { /* implementation specified below */ }
export const config = { path: "/api/session" }
```

```js
// netlify/functions/access.mjs
export default async function handler(req) { /* implementation specified below */ }
export const config = { path: "/api/access" }
```

For both handlers, processing order is exact:

1. Reject every method other than `GET`, including `HEAD`, with `405` before identity, URL parsing, environment access, or storage access.
2. Call P2-H `identify(req)` exactly once. An ordinary `null` result returns `401`. A rejection or malformed non-null identity returns `500`; do not call `resolveRole()`.
3. Read `new URL(req.url).searchParams.getAll("doc")`. Require exactly one value matching `^[0-9a-f]{6}$`; otherwise return `400`. Other query parameter names are ignored.
4. Call P2-G `resolveRole()` exactly as specified for that endpoint. Treat its result as the authority; do not derive access from `isOrg`, email, `roles`, request data, or a listed record.

Neither read-only handler calls `requireOrigin()`. Both import `identify()` only from `../lib/identity.mjs`; neither imports Netlify Identity, reads `nf_jwt`, accepts an actor field, or decodes a token.

Before reading or passing a non-null identity, defensively require the exact P2-H result boundary. It is an ordinary `Object.prototype` object with exactly the own string keys `sub`, `email`, `name`, and `isOrg` in that order, no symbols, and four enumerable/writable/configurable data properties. `sub`, `email`, and `name` are strings; `sub` passes `assertIdentitySub()` unchanged; `isOrg` is a boolean equal to `email.endsWith("@example.com")`. Inspect own descriptors before reading values. Reject arrays, frozen/sealed objects, accessors, missing/extra/non-enumerable/non-writable/non-configurable fields, a custom/null prototype, invalid subject, inconsistent `isOrg`, and any symbol as malformed identity with `500`; never invoke a getter or pass the value to `resolveRole()`. This consumes P2-H's exact fresh-object guarantee without re-normalizing its deliberately lower-case-but-untrimmed email.

Every response has `Cache-Control: private, no-store`. A non-`200` response has an empty, zero-byte body. The exact ordinary headers are:

| Status | Headers |
|---:|---|
| `200` | `Content-Type: application/json; charset=utf-8`, `Cache-Control: private, no-store` |
| `405` | `Allow: GET`, `Cache-Control: private, no-store` |
| every other status | `Cache-Control: private, no-store` |

Do not set CORS, `Vary`, ETag, cache validators, redirect, or diagnostic headers. Serialize each success with `JSON.stringify()` and no trailing LF. Response object keys and array ordering are part of the contract.

Map only a safely recognized P2-B `StoreError` with own data fields `name === "StoreError"`, `code === "unavailable"`, and `status === 503` to `503`. Every other rejection or malformed success from identity, access, listing, reading, validation, URL handling, or serialization returns `500`. Never serialize or log an error, `cause`, stack, key, record, provider result, environment value, or another person's invitation existence.

### `GET /api/session?doc=<docId>`

After the shared method, identity, and query checks, call exactly:

```js
const access = await resolveRole(docId, user, { consumeInvitation: true });
```

P2-G owns owner capture and the grant-first/delete-second invitation conversion. This endpoint does not repeat either write, pass a custom store/clock/configuration option, write an event, or inspect a grant/invitation directly.

Any well-formed `ResolvedAccess` result, including `role: "none"` or `shared: false`, returns `200`. An unknown but syntactically valid document ID is therefore an ordinary unshared result, never a missing-record exception. Construct a fresh plain JSON object with exactly these keys in this order:

```json
{
  "sub": "u_fixture_reader_22",
  "email": "reader@partner.invalid",
  "name": "River Vale",
  "roles": ["guest"],
  "canComment": false,
  "canEdit": false,
  "doc": "4b7d2a",
  "role": "viewer",
  "shared": true,
  "canSuggest": false,
  "canAccept": false,
  "canShare": false,
  "canSeeMembers": false
}
```

- Copy `sub`, `email`, and `name` from the proven P2-H identity.
- Set `roles` to exactly `[user.isOrg ? "member" : "guest"]`. This is legacy presentation compatibility only; it is never an authorization input.
- Copy `role`, `shared`, `canComment`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers` from the one resolved-access result.
- Set `doc` to the exact validated query value.
- Do not expose `isOrg`, `canRead`, `threadControl`, conversion state, raw records, hashes, options, or extension fields.

Before projection, defensively require the resolved value to be a non-null, non-array plain object with exactly P2-G's ten enumerable data keys and primitive values: `role` is one of `owner`, `editor`, `commenter`, `viewer`, or `none`; `shared` and all eight boolean capabilities are booleans; `threadControl` is `any`, `own`, or `none`. Reject accessors, symbols, missing/extra/non-enumerable keys, custom/null prototypes, and inconsistent rows by comparing all ten fields with a fresh `capabilitiesFor(role)` result, except that `shared` is independent. This check prevents a malformed dependency result from widening the public session.

### `GET /api/access?doc=<docId>`

After the shared method, identity, and query checks, call exactly:

```js
const access = await resolveRole(docId, user);
```

Use the default read-only mode. Do not consume an invitation from this endpoint. Apply the same exact resolved-result validation as the session endpoint. If `access.canSeeMembers !== true`, return `403` before `docState()`, `list()`, `read()`, or any record-key construction. This makes a `commenter`, `viewer`, `none`, and every ordinary unshared result indistinguishable at the roster boundary.

For an authorized owner/editor:

1. Open one store with P2-B `docState()`.
2. Read `accessDocumentKey(docId)` through P2-B `read(store, key)`. A miss is an internal inconsistency and returns `500`. Validate the hit with `assertAccessDocument(value, docId)`.
3. Call `store.list({ prefix: accessGrantPrefix(docId), paginate: true })` once and `store.list({ prefix: accessInvitationPrefix(docId), paginate: true })` once. Consume each returned async iterator serially and manually through `next()`; do not use default automatic pagination, list another prefix, or expose a provider cursor. Across both iterators, retain at most 50 child keys and accept at most 52 non-`done` page results. Require one terminal `{ done: true }` result from each iterator; a 51st key or 53rd non-`done` page returns `500` before child reads and no later result is pulled. A successful complete traversal therefore makes at most 54 `next()` calls: 52 yielded pages plus the two required terminal results. Because the provider documents at most 1,000 entries per page, the handler materializes at most one bounded provider page at a time. The 52-page allowance tolerates small/empty provider pages while keeping corrupt or adversarial iteration finite.
4. Accept a yielded page only when it is a non-null, non-array ordinary object with own enumerable data properties `blobs` and `directories`; `blobs` is a dense array of at most 1,000 entries and `directories` is a dense empty array. Each entry is an ordinary object with an own enumerable/writable/configurable string data property `key` of at most 600 UTF-8 bytes; keys must be unique within and across all pages and both iterators. Additional own string data properties such as provider `etag` are permitted but their values are ignored without being read. Accessors, symbols, custom prototypes, sparse/extended arrays, or malformed iterators/pages return `500` without executing a getter.
5. Require each returned key to begin with the requested exact prefix and end in `.json`. A grant key's middle segment must pass `assertIdentitySub()` and reproduce exactly through `accessGrantKey(docId, sub)`. Invitation keys are accepted only after the contextual validation below. A foreign, nested, bare-prefix, duplicate, or malformed key returns `500` before projecting any row.
6. If the accumulated pages contain more than 50 entries in total, return `500` without reading child records. This is an integrity guard around P4-J's settled 50-person write cap; do not truncate and imply a complete roster.
7. Read all child keys through `read(store, key)` with `Promise.all()`. A record deleted between list and read is an ordinary concurrent miss and is omitted. Validate every present grant with `assertAccessGrant(value, docId, keySub)`. Validate every present invitation with `await assertAccessInvitationAtKey(value, docId, fullKey)`. Do not use the synchronous invitation validator alone.
8. Exclude any grant whose `sub` equals the document record's `ownerSub`; owner precedence makes it redundant, and the response must contain one owner row. Before projection, require the owner email and every remaining grant email to be pairwise unique by exact string equality. Two different subjects with the same normalized email are corrupt roster state and return `500`; do not silently choose, merge, or expose either duplicate row. P4-J must preserve this invariant on writes.
9. Sample `const now = new Date().toISOString()` exactly once after every present record and member-email invariant validates. Omit invitations with `expiresAt <= now`; do not delete or extend them. P4-T owns deletion.
10. Project and sort the response below. No authorization decision depends on list completeness or order.

The exact success body is:

```json
{
  "doc": "4b7d2a",
  "orgDefault": "commenter",
  "members": [
    {
      "sub": "u_fixture_owner_11",
      "email": "owner@example.com",
      "name": "",
      "role": "owner"
    },
    {
      "sub": "u_fixture_editor_33",
      "email": "editor@partner.invalid",
      "name": "Avery Quill",
      "role": "editor"
    }
  ],
  "invitations": [
    {
      "email": "pending@review.invalid",
      "role": "commenter",
      "expiresAt": "2099-10-02T09:18:11.400Z"
    }
  ]
}
```

`members[0]` is always the access document's owner snapshot with `name: ""`; no owner name is stored, and the handler must not invent or conditionally substitute one from the caller. Each remaining member projects exactly `sub`, `email`, `name`, and `role` from a validated grant. Sort grant rows by ascending `email`, then ascending `sub`, using direct JavaScript string comparison; the owner remains first. Project a live invitation to exactly `email`, `role`, and `expiresAt`, then sort by ascending `email`. Return `orgDefault` from the validated access document.

Do not expose `grantedBy`, `grantedAt`, `fromInvitation`, `invitedBy`, `invitedAt`, `accountCreated`, `boundAt`, `boundFrom`, an ETag, blob key, email hash, or list metadata. The list is display state: a concurrent grant/revoke may make it briefly stale, and a later open refreshes it. Do not add polling or a consistency claim that the provider does not make for `list()`.

### Error and short-circuit matrix

| Condition | Session | Access list |
|---|---:|---:|
| Non-GET method | `405` | `405` |
| `identify()` returns `null` | `401` | `401` |
| Missing, duplicate, blank, uppercase, path-like, slug, or otherwise invalid `doc` | `400` | `400` |
| Valid unknown/unshared `doc` | `200` with resolved unshared session | `403` |
| Valid role lacks `canSeeMembers` | still `200` | `403`, zero list/read calls |
| Owner/editor and valid roster | `200` | `200` |
| P2-B unavailable error | `503` | `503` |
| Identity/access rejection, corrupt state/key/list/result, or unexpected error | `500` | `500` |

The short-circuit order is observable. A rejected method performs no identity call; `null` identity performs no query-dependent access work; invalid query performs no role resolution; list denial performs no roster storage operation; a size violation performs no child read; and no failure emits a partial JSON body.

## Files owned

- `netlify/functions/access.mjs` — **new**; read-only roster endpoint.
- `netlify/functions/session.mjs` — **amended**, created by P1-C; replace the Phase 1 projection with the final document-aware projection.
- `docs/tickets/P3-H.md` — this specification, not an implementation path.

No other implementation path is owned. In particular, do not amend `netlify/lib/identity.mjs`, `netlify/lib/access.mjs`, `netlify/lib/store.mjs`, `templates/base/session.js`, `templates/base/share.js`, `netlify/edge-functions/gate.ts`, configuration, dependencies, or generated output. Stop and report a predecessor gap instead of widening ownership.

## Dependencies

- **P1-C:** creates the Functions v2 `session.mjs` surface, exact `405`/`401`/no-store baseline, and the root pinned runtime package. P3-H amends only the response/query logic and retains that Fetch-style boundary.
- **P2-B (through P2-G):** supplies `docState()` and `read()` with strong per-operation reads, `StoreError`, and the one site-wide `doc-state` store. The roster uses direct manually paginated `store.list()` only because P2-B intentionally has no list wrapper.
- **P2-C (consumer contract):** already sends exactly one `/api/session?doc=<permanent-id>` request and accepts the thirteen-field final body. P3-H does not edit or duplicate that browser probe.
- **P2-G:** supplies `resolveRole()`, `capabilitiesFor()`, `accessDocumentKey()`, grant/invitation prefix/key builders, `assertIdentitySub()`, and all three record validators. It owns owner capture, role precedence, invitation conversion, and safe errors.
- **P2-H:** supplies the final identity `{ sub, email, name, isOrg }` and requires this ticket's marked source-bound fixture. P2-H and P3-H must integrate in one serialized release wave; the P2-H-only tree is not a deployable session state.

Downstream P3-I consumes the exact access-list body and the existing P2-C `session` event. P4-J amends `access.mjs` with writes while retaining this GET contract. P3-J independently enforces HTML read access and must not trust either client response.

### Maximum safe implementation waves

1. The new access-list handler and its isolated source-bound fixtures may be implemented while the session amendment is prepared because the files are disjoint.
2. The session amendment may be integrated only after the complete P2-G/P2-H contracts are present; do not deploy the temporary P2-H-only state.
3. Serialize the combined P2-G/P2-H/P3-H authority tests and all repository gates. Do not run shared dependency installation, `.netlify` state, or generated-output rebuilds concurrently with another ticket.

P3-I drafting may use this frozen response contract, but its implementation waits for P3-H. P4-J is the only later ticket allowed to amend `access.mjs`, and it must preserve the GET branch byte-for-byte in behavior.

## Acceptance criteria

- [ ] Only the two declared implementation files change, with exact Functions v2 default/config exports and no direct Identity-package or client-authority use.
- [ ] Both endpoints apply method, identity, single-document query, and role-resolution checks in the exact short-circuit order and return only the exact no-store header sets.
- [ ] `/api/session` calls `resolveRole(docId, user, { consumeInvitation: true })` once and projects exactly the thirteen ordered fields, including compatibility `roles` from `isOrg` and capabilities only from the validated access result.
- [ ] An authenticated query for a syntactically valid unknown document returns `200` with `shared: false`; ordinary absence never becomes `500`.
- [ ] `/api/access` calls read-only `resolveRole(docId, user)` once and returns `403` before all roster storage work unless `canSeeMembers` is exactly true.
- [ ] The roster reads the validated access document and exactly two manually paginated fixed prefixes, validates every iterator/page/full key and present record, enforces the combined 52-page/50-key boundary with no more than 54 `next()` calls before child reads, omits concurrent misses and expired invitations, and never truncates a claimed-complete result.
- [ ] The response contains one owner-first member row, rejects duplicate member emails across the owner and non-owner grants, sorts the remaining grants and live invitations, and uses exactly the documented projections; private actor, timing, conversion, key, hash, and provider fields never leave the server.
- [ ] A fixed identity with different P2-G access results produces different session capabilities and roster authorization, proving that identity presence, email suffix, compatibility roles, and client state are not document authority.
- [ ] Store unavailability maps only to quiet `503`; malformed/hostile dependency results and every other failure map to quiet `500`; no response/log leaks the error graph or partial data.
- [ ] The marked P3-H runtime fixture binds both production source files and, through the standalone command in this body, emits exactly its required line while its own finite supervisor owns the child, deadline, output cap, signal forwarding, TERM-to-KILL escalation, close/reap, and guarded-root cleanup.
- [ ] Exact heading, Bash-fence, scrub, docbuild, distribution, whitespace, file-ownership, and issue #21 pointer-integrity gates pass: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

All values below are invented for public use. Run from the repository root after P2-G and P2-H are integrated.

### 1. Source-bound identity/access projection and roster behavior

The following is the one marker block consumed by P2-H. It is also a complete standalone command: it evaluates both production modules with Node's VM module linker and deterministic in-memory implementations of their declared predecessor imports. Its self-contained outer Node supervisor starts exactly one direct child, applies a 30-second deadline, forwards HUP/INT/TERM, escalates to KILL after two seconds, caps captured output, waits for close, and preserves 129/130/143. The child opens no socket, performs no network request, creates no file, and starts no descendant or detached session. Acceptance of this ticket is proved by this body alone; it does not require executing or consulting another ticket's supervisor.

```bash
# P3-H runtime authority fixture
set -euo pipefail
P3H_ROOT=""
P3H_SUPERVISOR_PID=""
P3H_SIGNAL_STATUS=0
cleanup_p3h() {
  test -n "$P3H_ROOT" || return 0
  case "$P3H_ROOT" in "$P3H_PARENT"/p3-h.??????) ;; *) return 1;; esac
  test -d "$P3H_ROOT" && test ! -L "$P3H_ROOT" || return 1
  if test -f "$P3H_ROOT/test.mjs" && test ! -L "$P3H_ROOT/test.mjs"; then rm -f -- "$P3H_ROOT/test.mjs"; fi
  rmdir -- "$P3H_ROOT"
  P3H_ROOT=""
}
signal_p3h() {
  local status="$1" signal="$2"
  test "$P3H_SIGNAL_STATUS" -ne 0 || P3H_SIGNAL_STATUS="$status"
  if test -n "$P3H_SUPERVISOR_PID"; then kill -"$signal" -- "$P3H_SUPERVISOR_PID" 2>/dev/null || true; fi
}
trap cleanup_p3h EXIT
trap 'signal_p3h 129 HUP' HUP
trap 'signal_p3h 130 INT' INT
trap 'signal_p3h 143 TERM' TERM
P3H_PARENT="${TMPDIR:-/tmp}"
P3H_PARENT="$(cd "$P3H_PARENT" && pwd -P)"
case "$P3H_PARENT" in /|"") echo "unsafe temp parent" >&2; exit 1;; esac
P3H_ROOT="$(mktemp -d "$P3H_PARENT/p3-h.XXXXXX")"
P3H_ROOT="$(cd "$P3H_ROOT" && pwd -P)"
case "$P3H_ROOT" in "$P3H_PARENT"/p3-h.??????) ;; *) echo "unsafe temp root" >&2; exit 1;; esac
test ! -L "$P3H_ROOT"
command cat >"$P3H_ROOT/test.mjs" <<'P3H_TEST'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require(process.env.P3H_TYPESCRIPT);

const DOC = "4b7d2a";
const USER = { sub: "u_fixture_reader_22", email: "reader@partner.invalid", name: "River Vale", isOrg: false };
const capability = (role) => ({
  canRead: role !== "none", canComment: ["owner", "editor", "commenter"].includes(role),
  threadControl: ["owner", "editor"].includes(role) ? "any" : role === "commenter" ? "own" : "none",
  canSuggest: ["owner", "editor", "commenter"].includes(role), canEdit: ["owner", "editor"].includes(role),
  canAccept: ["owner", "editor"].includes(role), canShare: role === "owner", canSeeMembers: ["owner", "editor"].includes(role),
});
const resolved = (role, shared = true) => ({ role, shared, ...capability(role) });
const fixture = {
  identityCalls: 0, resolveCalls: [], listCalls: [], listYields: 0, listPulls: 0, readCalls: [], invitationSyncCalls: 0, invitationAtKeyCalls: 0,
  holdInvitationValidation: false, invitationResolvers: [],
  user: USER, identityError: null, access: resolved("viewer"), resolveError: null,
  listError: null, readError: null, lists: new Map(), records: new Map(),
};
class StoreError extends Error { constructor(code, status, message) { super(message); this.name = "StoreError"; this.code = code; this.status = status; } }
class AccessError extends Error {}
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value), keys);
const accessDocument = { v: 1, docId: DOC, ownerSub: "u_fixture_owner_11", ownerEmail: "owner@example.com", orgDefault: "commenter", boundAt: "2026-01-01T00:00:00.000Z", boundFrom: "env:DOC_OWNERS" };
const grant = (sub, email, name, role) => ({ v: 1, docId: DOC, sub, email, name, role, grantedBy: { sub: "u_fixture_owner_11", name: "Fixture Owner", email: "owner@example.com" }, grantedAt: "2026-01-02T00:00:00.000Z", fromInvitation: null });
const invitation = (email, role, expiresAt) => ({ v: 1, docId: DOC, email, role, invitedBy: { sub: "u_fixture_owner_11", name: "Fixture Owner", email: "owner@example.com" }, invitedAt: "2026-01-03T00:00:00.000Z", expiresAt, accountCreated: false });
const grantPrefix = `access/${DOC}/u/`, invitePrefix = `access/${DOC}/i/`;
const keys = {
  doc: `access/${DOC}/doc.json`, ownerGrant: `${grantPrefix}u_fixture_owner_11.json`,
  zed: `${grantPrefix}u_fixture_zed_44.json`, alpha: `${grantPrefix}u_fixture_alpha_33.json`,
  live: `${invitePrefix}${"a".repeat(32)}.json`, expired: `${invitePrefix}${"b".repeat(32)}.json`,
};
fixture.records.set(keys.doc, accessDocument);
fixture.records.set(keys.ownerGrant, grant("u_fixture_owner_11", "owner@example.com", "Stale Owner Grant", "viewer"));
fixture.records.set(keys.zed, grant("u_fixture_zed_44", "zed@review.invalid", "Zed Vale", "viewer"));
fixture.records.set(keys.alpha, grant("u_fixture_alpha_33", "alpha@review.invalid", "Alpha Vale", "editor"));
fixture.records.set(keys.live, invitation("pending@review.invalid", "commenter", "2099-10-02T09:18:11.400Z"));
fixture.records.set(keys.expired, invitation("expired@review.invalid", "viewer", "2000-01-01T00:00:00.000Z"));
fixture.lists.set(grantPrefix, { blobs: [{ key: keys.zed, etag: '"fixture-zed"' }, { key: keys.ownerGrant }, { key: keys.alpha }], directories: [] });
fixture.lists.set(invitePrefix, { blobs: [{ key: keys.expired }, { key: keys.live }], directories: [] });

const identityExports = {
  identify: async () => { fixture.identityCalls += 1; if (fixture.identityError) throw fixture.identityError; return fixture.user; },
  requireOrigin: () => { throw new Error("GET must not call requireOrigin"); },
};
const accessExports = {
  AccessError, ROLE_CAPABILITIES: Object.freeze({}),
  normalizeEmail: (value) => value, parseDocOwners: () => new Map(), emailHash: async () => "a".repeat(32),
  assertIdentitySub: (sub) => { assert.match(sub, /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/); return sub; },
  assertAccessDocument: (value, doc) => { assert.equal(value.docId, doc); return value; },
  assertAccessGrant: (value, doc, sub) => { assert.equal(value.docId, doc); assert.equal(value.sub, sub); return value; },
  assertAccessInvitation: () => { fixture.invitationSyncCalls += 1; throw new Error("context-free invitation validator is forbidden"); },
  assertAccessInvitationAtKey: async (value, doc, key) => {
    fixture.invitationAtKeyCalls += 1; assert.equal(value.docId, doc); assert.equal(key.startsWith(`access/${doc}/i/`), true);
    if (fixture.holdInvitationValidation) await new Promise((resolve) => fixture.invitationResolvers.push(resolve));
    return value;
  },
  accessDocumentKey: (doc) => `access/${doc}/doc.json`, accessGrantPrefix: (doc) => `access/${doc}/u/`,
  accessGrantKey: (doc, sub) => `access/${doc}/u/${sub}.json`, accessInvitationPrefix: (doc) => `access/${doc}/i/`,
  accessInvitationKey: async (doc, email) => `access/${doc}/i/${email}.json`,
  capabilitiesFor: (role) => ({ ...capability(role) }),
  resolveRole: async (doc, user, options) => { fixture.resolveCalls.push({ doc, user, options }); if (fixture.resolveError) throw fixture.resolveError; return { ...fixture.access }; },
};
const store = {
  list(options) {
    fixture.listCalls.push(options);
    const listing = fixture.lists.get(options.prefix);
    return { async *[Symbol.asyncIterator]() {
      if (fixture.listError) throw fixture.listError;
      for (const page of Array.isArray(listing) ? listing : [listing]) { fixture.listPulls += 1; fixture.listYields += 1; yield page; }
      fixture.listPulls += 1;
    } };
  },
};
const storeExports = {
  StoreError, STORE_NAME: "doc-state", MAX_MUTATE_ATTEMPTS: 6,
  docState: () => store, assertKey: (key) => key, assertDocId: (doc) => doc, upgrade: (value) => value,
  read: async (_store, key) => { fixture.readCalls.push(key); if (fixture.readError) throw fixture.readError; return { value: fixture.records.get(key) ?? null, etag: fixture.records.has(key) ? '"fixture"' : null }; },
  mutate: async () => { throw new Error("GET must not mutate"); },
};

async function load(path) {
  const poisonedConsole = new Proxy({}, { get() { throw new Error("production logging is forbidden"); } });
  const context = vm.createContext({ Request, Response, Headers, URL, Date, JSON, Object, Array, Promise, RegExp, String, Boolean, console: poisonedConsole });
  const mocks = new Map();
  for (const [specifier, values] of [["../lib/identity.mjs", identityExports], ["../lib/access.mjs", accessExports], ["../lib/store.mjs", storeExports]]) {
    const module = new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context, identifier: specifier });
    mocks.set(specifier, module);
  }
  const source = readFileSync(path, "utf8");
  assert.equal(source.includes("PASS  P3-H fixed-identity access projection"), false, "production must not hard-code the fixture output");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(sourceFile.parseDiagnostics, []);
  const forbiddenIdentifiers = new Set(["console", "process", "globalThis", "self", "window", "navigator", "fetch", "caches", "CacheStorage", "Deno", "Netlify", "XMLHttpRequest", "WebSocket", "EventSource", "getStore", "setJSON", "mutate", "requireOrigin", "getUser", "clientContext", "nf_jwt"]);
  const walk = (node) => {
    if (ts.isIdentifier(node)) assert.equal(forbiddenIdentifiers.has(node.text), false, `forbidden executable identifier ${node.text}`);
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic import is forbidden");
      if (ts.isPropertyAccessExpression(node.expression)) assert.equal(["set", "setJSON", "mutate", "delete"].includes(node.expression.name.text), false, `write method ${node.expression.name.text} is forbidden`);
      if (ts.isElementAccessExpression(node.expression) && ts.isStringLiteralLike(node.expression.argumentExpression)) assert.equal(["set", "setJSON", "mutate", "delete"].includes(node.expression.argumentExpression.text), false, `write method ${node.expression.argumentExpression.text} is forbidden`);
    }
    if (ts.isStringLiteralLike(node)) assert.equal(["nf_jwt", "clientContext", "appMetadata", "app_metadata"].includes(node.text), false, `forbidden authority literal ${node.text}`);
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  const module = new vm.SourceTextModule(source, { context, identifier: path });
  await module.link((specifier) => { assert.ok(mocks.has(specifier), `unexpected import ${specifier}`); return mocks.get(specifier); });
  await module.evaluate({ timeout: 1_000 });
  return module.namespace;
}
const session = await load("netlify/functions/session.mjs");
const access = await load("netlify/functions/access.mjs");
assert.deepEqual(Object.keys(session).sort(), ["config", "default"]);
assert.deepEqual(Object.keys(access).sort(), ["config", "default"]);
assert.deepEqual(Object.keys(session.config), ["path"]); assert.equal(session.config.path, "/api/session");
assert.deepEqual(Object.keys(access.config), ["path"]); assert.equal(access.config.path, "/api/access");
const request = (path, method = "GET") => new Request(`https://docs.fixture.invalid${path}`, { method });
const json = async (response) => JSON.parse(await response.text());
const assertHeaders = (response, jsonBody = false) => {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), jsonBody ? "application/json; charset=utf-8" : null);
};

let response = await session.default(request(`/api/session?doc=${DOC}`));
assert.equal(response.status, 200); assertHeaders(response, true);
let body = await json(response);
exactKeys(body, ["sub", "email", "name", "roles", "canComment", "canEdit", "doc", "role", "shared", "canSuggest", "canAccept", "canShare", "canSeeMembers"]);
assert.deepEqual(body, { sub: USER.sub, email: USER.email, name: USER.name, roles: ["guest"], canComment: false, canEdit: false, doc: DOC, role: "viewer", shared: true, canSuggest: false, canAccept: false, canShare: false, canSeeMembers: false });
assert.equal(fixture.resolveCalls.at(-1).doc, DOC); assert.equal(fixture.resolveCalls.at(-1).user, USER);
assert.deepEqual(Object.keys(fixture.resolveCalls.at(-1).options), ["consumeInvitation"]);
assert.equal(fixture.resolveCalls.at(-1).options.consumeInvitation, true);

fixture.access = resolved("owner");
response = await session.default(request(`/api/session?doc=${DOC}`)); body = await json(response);
assert.equal(body.canShare, true); assert.equal(body.canEdit, true); assert.equal(body.role, "owner"); assert.deepEqual(body.roles, ["guest"]);
fixture.access = resolved("none", false);
response = await session.default(request("/api/session?doc=ffffff")); body = await json(response);
assert.equal(response.status, 200); assert.equal(body.doc, "ffffff"); assert.equal(body.shared, false); assert.equal(body.role, "none");

fixture.access = resolved("commenter"); fixture.listCalls.length = 0; fixture.readCalls.length = 0;
response = await access.default(request(`/api/access?doc=${DOC}`));
assert.equal(response.status, 403); assert.equal(await response.text(), ""); assertHeaders(response); assert.deepEqual(fixture.listCalls, []); assert.deepEqual(fixture.readCalls, []);

fixture.access = resolved("editor"); fixture.resolveCalls.length = 0;
response = await access.default(request(`/api/access?doc=${DOC}`));
assert.equal(response.status, 200); assertHeaders(response, true); body = await json(response);
exactKeys(body, ["doc", "orgDefault", "members", "invitations"]);
assert.deepEqual(body, {
  doc: DOC, orgDefault: "commenter",
  members: [
    { sub: "u_fixture_owner_11", email: "owner@example.com", name: "", role: "owner" },
    { sub: "u_fixture_alpha_33", email: "alpha@review.invalid", name: "Alpha Vale", role: "editor" },
    { sub: "u_fixture_zed_44", email: "zed@review.invalid", name: "Zed Vale", role: "viewer" },
  ],
  invitations: [{ email: "pending@review.invalid", role: "commenter", expiresAt: "2099-10-02T09:18:11.400Z" }],
});
assert.deepEqual(fixture.resolveCalls, [{ doc: DOC, user: USER, options: undefined }]);
assert.deepEqual(fixture.listCalls, [{ prefix: grantPrefix, paginate: true }, { prefix: invitePrefix, paginate: true }]);
assert.equal(fixture.invitationSyncCalls, 0); assert.equal(fixture.invitationAtKeyCalls, 2);
const heldGrantList = fixture.lists.get(grantPrefix), heldInviteList = fixture.lists.get(invitePrefix);
fixture.holdInvitationValidation = true; fixture.invitationResolvers.length = 0;
fixture.lists.set(grantPrefix, { blobs: [], directories: [] }); fixture.lists.set(invitePrefix, { blobs: [{ key: keys.live }], directories: [] });
let heldSettled = false; const heldValidation = access.default(request(`/api/access?doc=${DOC}`)).then((value) => { heldSettled = true; return value; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(fixture.invitationResolvers.length, 1); assert.equal(heldSettled, false, "access response must await contextual invitation validation");
fixture.invitationResolvers.splice(0).forEach((resolve) => resolve());
response = await heldValidation; assert.equal(response.status, 200);
fixture.holdInvitationValidation = false; fixture.lists.set(grantPrefix, heldGrantList); fixture.lists.set(invitePrefix, heldInviteList);

for (const [handler, route] of [[session, "/api/session"], [access, "/api/access"]]) {
  fixture.user = USER;
  let before = { identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length };
  response = await handler.default(request(`${route}?doc=${DOC}`, "POST"));
  assert.equal(response.status, 405); assert.equal(await response.text(), "");
  assert.deepEqual(Object.fromEntries(response.headers), { allow: "GET", "cache-control": "private, no-store" });
  assert.deepEqual({ identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length }, before);

  fixture.user = null; before = { identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length };
  response = await handler.default(request(`${route}?doc=${DOC}`));
  assert.equal(response.status, 401); assert.equal(await response.text(), "");
  assert.deepEqual(Object.fromEntries(response.headers), { "cache-control": "private, no-store" });
  assert.deepEqual({ identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length }, { ...before, identity: before.identity + 1 });

  for (const query of ["", "?ignored=x", "?doc=", `?doc=${DOC}&doc=${DOC}`, "?doc=4B7D2A", "?doc=../4b7d2a", "?doc=sample-doc", "?doc=%2F4b7d2a"]) {
    fixture.user = USER; before = { identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length };
    response = await handler.default(request(`${route}${query}`));
    assert.equal(response.status, 400, `${route}${query}`); assert.equal(await response.text(), "");
    assert.deepEqual(Object.fromEntries(response.headers), { "cache-control": "private, no-store" });
    assert.deepEqual({ identity: fixture.identityCalls, resolve: fixture.resolveCalls.length, list: fixture.listCalls.length, read: fixture.readCalls.length }, { ...before, identity: before.identity + 1 });
  }
  fixture.user = USER; response = await handler.default(request(`${route}?doc=${DOC}&ignored=x`)); assert.equal(response.status, 200, `${route} ignores unrelated query names`);
}

fixture.user = USER; fixture.identityError = new Error("private identity detail");
response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), ""); fixture.identityError = null;
fixture.user = { ...USER, extra: true };
response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), ""); fixture.user = USER;
for (const malformedIdentity of [
  Object.freeze({ ...USER }),
  Object.assign(Object.create(null), USER),
  Object.assign(Object.create({ inherited: true }), USER),
  { email: USER.email, sub: USER.sub, name: USER.name, isOrg: USER.isOrg },
  { sub: USER.sub, email: USER.email, isOrg: USER.isOrg },
  Object.defineProperty({ ...USER }, "name", { value: USER.name, enumerable: true, writable: false, configurable: true }),
  Object.defineProperty({ ...USER }, "name", { value: USER.name, enumerable: false, writable: true, configurable: true }),
  Object.defineProperty({ ...USER }, "name", { value: USER.name, enumerable: true, writable: true, configurable: false }),
  { ...USER, email: 17 },
  { ...USER, name: 17 },
  { ...USER, isOrg: "false" },
  { ...USER, isOrg: true },
  { ...USER, sub: "bad subject" },
  Object.assign({ ...USER }, { [Symbol("extra")]: true }),
]) {
  fixture.user = malformedIdentity; const callsBefore = fixture.resolveCalls.length;
  response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), "");
  assert.equal(fixture.resolveCalls.length, callsBefore);
}
{
  let getterCalls = 0;
  const accessorIdentity = { ...USER };
  Object.defineProperty(accessorIdentity, "name", { enumerable: true, configurable: true, get() { getterCalls += 1; throw new Error("must not execute"); } });
  fixture.user = accessorIdentity; const callsBefore = fixture.resolveCalls.length;
  response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(getterCalls, 0); assert.equal(fixture.resolveCalls.length, callsBefore);
}
fixture.user = USER;
fixture.resolveError = new StoreError("unavailable", 503, "State store unavailable");
response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 503); assert.equal(await response.text(), "");
fixture.resolveError = new StoreError("invalid-record", 500, "Invalid stored record");
response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); fixture.resolveError = null;
fixture.access = { ...resolved("owner"), canShare: false };
response = await session.default(request(`/api/session?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), "");

fixture.access = resolved("editor"); fixture.listError = new StoreError("unavailable", 503, "State store unavailable");
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 503); assert.equal(await response.text(), ""); fixture.listError = null;
const originalGrantList = fixture.lists.get(grantPrefix);
const originalInviteList = fixture.lists.get(invitePrefix);
fixture.lists.set(grantPrefix, null);
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); fixture.lists.set(grantPrefix, originalGrantList);
const duplicateEmailKey = `${grantPrefix}u_fixture_duplicate_55.json`;
fixture.records.set(duplicateEmailKey, grant("u_fixture_duplicate_55", "owner@example.com", "Duplicate Fixture", "viewer"));
fixture.lists.set(grantPrefix, { blobs: [...originalGrantList.blobs, { key: duplicateEmailKey }], directories: [] });
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), "");
fixture.records.delete(duplicateEmailKey); fixture.lists.set(grantPrefix, originalGrantList);
const duplicateGrantEmailKey = `${grantPrefix}u_fixture_duplicate_66.json`;
fixture.records.set(duplicateGrantEmailKey, grant("u_fixture_duplicate_66", "zed@review.invalid", "Duplicate Grant Fixture", "commenter"));
fixture.lists.set(grantPrefix, { blobs: [...originalGrantList.blobs, { key: duplicateGrantEmailKey }], directories: [] });
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), "");
fixture.records.delete(duplicateGrantEmailKey); fixture.lists.set(grantPrefix, originalGrantList);
for (const blobs of [
  [{ key: `access/ffffff/u/u_fixture_foreign.json` }],
  [{ key: `${grantPrefix}nested/u_fixture_child.json` }],
  [{ key: grantPrefix }],
  [{ key: `${grantPrefix}bad subject.json` }],
  [{ key: keys.zed }, { key: keys.zed }],
]) {
  fixture.readCalls.length = 0;
  fixture.lists.set(grantPrefix, { blobs, directories: [] });
  fixture.lists.set(invitePrefix, originalInviteList);
  response = await access.default(request(`/api/access?doc=${DOC}`));
  assert.equal(response.status, 500);
  assert.deepEqual(fixture.readCalls, [keys.doc], "invalid child keys fail before child reads");
}
fixture.lists.set(grantPrefix, originalGrantList);
fixture.lists.set(invitePrefix, originalInviteList);
fixture.readCalls.length = 0;
fixture.lists.set(grantPrefix, { blobs: Array.from({ length: 51 }, (_, index) => ({ key: `${grantPrefix}u_fixture_cap_${String(index).padStart(2, "0")}.json` })), directories: [] });
fixture.lists.set(invitePrefix, { blobs: [], directories: [] });
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); assert.deepEqual(fixture.readCalls, [keys.doc]);
fixture.readCalls.length = 0;
fixture.listYields = 0;
fixture.listPulls = 0;
fixture.lists.set(grantPrefix, Array.from({ length: 26 }, () => ({ blobs: [], directories: [] })));
fixture.lists.set(invitePrefix, Array.from({ length: 26 }, () => ({ blobs: [], directories: [] })));
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 200); assert.deepEqual(fixture.readCalls, [keys.doc]); assert.equal(fixture.listYields, 52); assert.equal(fixture.listPulls, 54);
fixture.readCalls.length = 0; fixture.listYields = 0; fixture.listPulls = 0;
fixture.lists.set(grantPrefix, Array.from({ length: 26 }, () => ({ blobs: [], directories: [] })));
fixture.lists.set(invitePrefix, Array.from({ length: 27 }, () => ({ blobs: [], directories: [] })));
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); assert.deepEqual(fixture.readCalls, [keys.doc]); assert.equal(fixture.listYields, 53); assert.equal(fixture.listPulls, 54);
fixture.lists.set(grantPrefix, originalGrantList); fixture.lists.set(invitePrefix, { blobs: [{ key: keys.expired }, { key: keys.live }], directories: [] });
fixture.records.delete(keys.alpha);
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 200); body = await json(response); assert.deepEqual(body.members.map(({ sub }) => sub), ["u_fixture_owner_11", "u_fixture_zed_44"]);
fixture.records.set(keys.alpha, { ...grant("u_fixture_alpha_33", "alpha@review.invalid", "Alpha Vale", "editor"), docId: "ffffff" });
response = await access.default(request(`/api/access?doc=${DOC}`)); assert.equal(response.status, 500); assert.equal(await response.text(), "");
console.log("PASS  P3-H fixed-identity access projection");
P3H_TEST

set +e
P3H_TEST="$P3H_ROOT/test.mjs" P3H_TYPESCRIPT="$PWD/templates/docbuild/node_modules/typescript/lib/typescript.js" NODE_NO_WARNINGS=1 node --input-type=module <<'P3H_SUPERVISOR' &
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
let child = null, firstSignal = null, killTimer = null;
let stdout = "", stderr = "", outputBytes = 0, timedOut = false, outputOverflow = false;
const signalStatus = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
const safeKill = (signal) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill(signal); } catch (error) { if (error?.code !== "ESRCH") throw error; }
};
const scheduleKill = () => { killTimer ||= setTimeout(() => safeKill("SIGKILL"), 2_000); };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {
  firstSignal ||= signal;
  process.exitCode = signalStatus[firstSignal];
  safeKill(signal);
  scheduleKill();
});
child = spawn(process.execPath, ["--experimental-vm-modules", process.env.P3H_TEST], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1);
const append = (current, chunk) => {
  outputBytes += Buffer.byteLength(chunk);
  if (outputBytes <= 65_536) return current + chunk;
  outputOverflow = true; safeKill("SIGTERM"); scheduleKill(); return current;
};
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
const deadline = setTimeout(() => { timedOut = true; safeKill("SIGTERM"); scheduleKill(); }, 30_000);
const result = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, signal: null, error }));
  child.once("close", (code, signal) => resolve({ code, signal, error: null }));
});
clearTimeout(deadline); if (killTimer) clearTimeout(killTimer);
if (firstSignal) process.exitCode = signalStatus[firstSignal];
else if (timedOut) process.exitCode = 124;
else if (outputOverflow || result.error) process.exitCode = 1;
else if (result.signal) process.exitCode = signalStatus[result.signal] ?? 1;
if (!process.exitCode) {
  const expected = "PASS  P3-H fixed-identity access projection\n";
  if (result.code !== 0 || stderr !== "" || stdout !== expected) process.exitCode = 1;
  else if (!firstSignal) process.stdout.write(expected);
}
P3H_SUPERVISOR
P3H_SUPERVISOR_PID=$!
while :; do
  wait "$P3H_SUPERVISOR_PID"
  P3H_STATUS=$?
  kill -0 "$P3H_SUPERVISOR_PID" 2>/dev/null || break
done
P3H_SUPERVISOR_PID=""
set -e
test "$P3H_SIGNAL_STATUS" -eq 0 || P3H_STATUS="$P3H_SIGNAL_STATUS"
cleanup_p3h || P3H_STATUS=1
trap - EXIT
trap - HUP INT TERM
test "$P3H_SIGNAL_STATUS" -eq 0 || P3H_STATUS="$P3H_SIGNAL_STATUS"
exit "$P3H_STATUS"
```

Expected: exit `0`, empty stderr, and exactly `PASS  P3-H fixed-identity access projection`, with no `p3-h.*` residue. Signal handlers exist before the temporary root, the first HUP/INT/TERM remains authoritative through cleanup as `129`/`130`/`143`, and the self-contained supervisor enforces one combined 65,536-byte output cap and the 30-second TERM-to-two-second-KILL deadline before it closes both output streams and reaps its sole child. The pinned TypeScript AST walk rejects dynamic imports and direct or aliased access through the named logging/process/global/network/provider/legacy-authority roots; the runtime console is poisoned. The VM linker rejects any undeclared import and the namespace assertions reject any export beyond `default`/`config`; assertions bind both production handlers, execute non-GET and null-identity short circuits plus missing, unrelated-only, blank, duplicate, uppercase, path-like, slug, and percent-decoded-path invalid-query classes independently for both endpoints with exact empty bodies/header sets/call suppression, prove a valid `doc` plus unrelated query name succeeds, keep identity fixed while access varies, reject exact key-order/prototype/descriptor/scalar/symbol/accessor identity violations before role resolution, verify invitation-consuming versus read-only resolver calls, prove the contextual async invitation validator is awaited and its context-free sibling is not used, prove denial before roster storage, validate deterministic projection/filtering/sorting, reject owner-to-grant and grant-to-grant projected-member email collisions, accept exactly 52 empty pages with two terminal results, reject foreign, nested, bare-prefix, malformed, duplicate, oversized, 51-key, and 53-page child inventories before child reads, cover concurrent misses and corrupt state, and distinguish safe `503` from `500`.

### 2. Static privacy, ownership, and repository gates

```bash
set -euo pipefail

test "$(rg -l 'config\s*=\s*\{\s*path:\s*"/api/access"' netlify/functions --glob '*.mjs')" = "netlify/functions/access.mjs"
test "$(rg -l 'consumeInvitation:\s*true' netlify/functions --glob '*.mjs')" = "netlify/functions/session.mjs"
! rg -n 'clientContext|appMetadata\.docs|user\.roles|user\.role|nf_jwt|requireOrigin|console\.(log|warn|error)|Access-Control-Allow|grantedBy|invitedBy|fromInvitation' netlify/functions/access.mjs netlify/functions/session.mjs

templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P3-H.md netlify/functions/access.mjs netlify/functions/session.mjs
git diff --check
test "$(rg '^## ' docs/tickets/P3-H.md | sed 's/^## //')" = "$(printf '%s\n' 'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' 'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' 'Assumptions and open questions' 'References')"
test "$(( $(rg -n '^```' docs/tickets/P3-H.md | wc -l | tr -d ' ') % 2 ))" -eq 0
awk 'BEGIN{inbash=0} /^```bash[[:space:]]*$/{inbash=1; next} /^```[[:space:]]*$/{if(inbash){inbash=0; print ""}; next} inbash{print}' docs/tickets/P3-H.md | bash -n

issue_json="$(gh issue view 21 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-H.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-H — GET /api/access, and session takes a doc" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-H issue #21 pointer integrity'

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3H_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
assert.match(base, /^[0-9a-f]{40,64}$/, "export P3H_BASE as the reviewed P2-G/P2-H predecessor commit");
const rows = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const paths = new Set([...rows(["diff", "--name-only", `${base}...HEAD`]), ...rows(["diff", "--name-only"]), ...rows(["diff", "--cached", "--name-only"]), ...rows(["ls-files", "--others", "--exclude-standard"])]);
for (const path of [...paths]) if (path.startsWith("docs/tickets/")) paths.delete(path);
assert.deepEqual([...paths].sort(), ["netlify/functions/access.mjs", "netlify/functions/session.mjs"]);
console.log("PASS  P3-H owns only access.mjs and session.mjs");
NODE
```

Expected: export `P3H_BASE` as the full reviewed predecessor commit, then every command exits `0`; the uniqueness/privacy, exact-heading, fence-balance, and Bash-syntax checks emit nothing; `check-dist` reports byte-identical committed documents; TypeScript emits no diagnostics; scrub reports no denied term or warning; and whitespace is clean. Issue #21 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the pointer gate prints `PASS  P3-H issue #21 pointer integrity`, and the last line is `PASS  P3-H owns only access.mjs and session.mjs`. No live Identity or Blobs credential is needed; P2-G owns those provider contracts, and this ticket's source-bound fixture owns the handler binding.

## Failure modes

- Signed out: return `401` with no role lookup and no body.
- Bad or duplicated document query: return `400` after identity and before authorization/storage.
- Unknown valid document: session returns the ordinary P2-G unshared projection; roster returns `403`.
- Commenter/viewer/no access: return roster `403` before any list or record read, even if the store contains malformed unrelated data.
- Owner capture or invitation conversion failure in the session resolver: preserve the safe `500`/`503` boundary and never claim a partial session.
- List provider rejection or P2-B read unavailability: return `503` only for the exact safe unavailable classification; otherwise `500`.
- Malformed iterator/page, a 53rd yielded page, a 51st child key, foreign/duplicate key, corrupt document/grant/invitation, or inconsistent resolver row: return `500`, no partial roster.
- Duplicate projected member email, whether owner-to-grant or grant-to-grant: return `500` with an empty body instead of choosing, merging, or emitting either conflicting non-owner row.
- Grant or invitation deleted after listing: omit that missed record. A newly created record missed by the list appears on the next panel open.
- Expired invitation: omit it without deletion; P4-T removes it later.
- Redundant grant for the current owner: validate it, then omit it so the owner appears once.
- Empty owner name snapshot: return the explicit empty string; do not invent a name from email or caller state.
- Deliberately not handled: cross-document lookup, org-directory expansion, live roster refresh, read receipts, group access, co-owners, and atomic snapshots across multiple blobs.

## Settled decisions

- Identity answers who the caller is; P2-G access results alone answer what that caller may do on a document.
- The exact permanent six-lowercase-hex document ID selects state. A slug, path, alias, or client-supplied key is never accepted.
- `/api/session` is the only invitation-consuming read path. It writes the grant before deleting the invitation; this handler delegates the complete operation to P2-G.
- Compatibility `roles` is a one-element presentation field derived from `isOrg`, not document authority.
- Editors may see the roster; commenters and viewers may not because it contains email addresses. Only an owner may mutate it in P4-J.
- The access roster is document-scoped display state from one document record and two manually paginated fixed prefixes under finite page/key ceilings. There is no per-user index or query across documents.
- Netlify Blobs `list()` completeness is not an authorization primitive. Every request that changes or protects data resolves the caller independently.
- One owner lives in `access/<docId>/doc.json`; `owner` is never a grant role. The response's empty owner name is honest because no owner name is stored.
- No state error, provider detail, raw record, actor snapshot, key, hash, or ETag crosses the HTTP boundary.
- File ownership remains exact. P3-H does not repair predecessor modules or pre-implement P4-J/P3-I/P3-J.

## Assumptions and open questions

- **Assumption:** the read-only roster body includes `orgDefault` because P4-L's later owner control must display the current setting; returning it now prevents P4-J from silently changing the GET shape.
- **Assumption:** `name: ""` is the stable owner projection because the authoritative document record intentionally stores only `ownerSub` and `ownerEmail`. A future stored owner-name field would require a versioned access-record ticket, not caller-dependent guessing here.
- **Assumption:** P4-J's 50-person cap counts grant and invitation child records and excludes the one owner record. P3-H applies the same combined bound as an integrity/read-amplification guard.
- **Assumption:** manual `store.list({ prefix, paginate: true })` in pinned `@netlify/blobs` `11.0.2` yields provider pages containing at most 1,000 entries; the official Netlify Blobs API documents that behavior. P3-H independently applies its smaller combined 50-key ceiling, 52-page ceiling, and 54-`next()` complete-traversal bound across the two iterators.
- **Open question (non-blocking):** none. The response projection, ordering, privacy boundary, and downstream amendment responsibilities are settled here.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.2, 1.5, 4.7, and 6 — one-record storage, identity/access split, role authority, ticket ownership, and binding rulings.
- `docs/research/09-sharing-and-roles.md` §§2.1–2.5, 3.2–3.4, 4.1–4.4, 5.5, 6, 7, and 9 — capability/privacy rules, final session shape, key/record model, invitation conversion, ownership, share-panel needs, and enforcement boundaries. Ticket letters inside that research document are superseded by the ruling plan.
- `docs/tickets/P1-C.md` — original Functions v2 session endpoint, status/header contract, and P3-H amendment boundary.
- `docs/tickets/P2-B.md` — site-wide strong store, `read()`/`StoreError` behavior, and the explicit absence of a list wrapper.
- `docs/tickets/P2-C.md` — exact browser query and final thirteen-field session consumer contract.
- `docs/tickets/P2-G.md` — authoritative roles/capabilities, key builders, record validators, invitation conversion, errors, and downstream P3-H obligations.
- `docs/tickets/P2-H.md` — final identity shape, serialized release requirement, and exact marked-fixture contract.
- Netlify, “Netlify Blobs,” API reference, accessed 2026-09-03 — manual `list({ prefix, paginate: true })`, pages of at most 1,000 entries, and `{ blobs: [{ key, etag }], directories }` result: <https://docs.netlify.com/build/data-and-storage/netlify-blobs/#list>.
- GitHub issue #21 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
