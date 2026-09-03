# P3-B — The events API

## Outcome

The repository has one Functions v2 events endpoint at `/api/events`. `POST` creates one actor-attributed, append-only audit event with a collision-safe create-only write, and `GET` returns one deterministic, bounded page from one document/month prefix. The endpoint never treats events as document truth, never accepts a client actor, and never stores presence or realtime traffic.

## Context

Comments, suggestions, edits, and access changes need a small audit trail, but the current state for each feature lives in its own authoritative record. An event is therefore evidence that an identified actor submitted an audit fact; it is not the record that renders a thread, grants access, or applies an edit. A missing event after a successful state change is possible because Blob operations are not a cross-record transaction. Callers change authoritative state first and append the event second; they never roll state back because the audit append failed.

The ruling storage layout is one immutable blob per event:

```text
events/<docId>/<YYYY-MM>/<eventId>.json
```

The month directory bounds reads and gives P4-F a retention boundary. P2-B owns the store, key builders, version gate, and create-only convention. P2-H owns the final server identity. P2-G owns document authorization. This ticket composes those contracts in one endpoint and does not duplicate or weaken any of them.

## Scope

### In scope

- Create `netlify/functions/events.mjs` with the exact exports and handler behavior below.
- Provide `GET /api/events` and `POST /api/events` as Netlify Functions v2 operations.
- Authenticate both operations with P2-H `identify()` and authorize them with P2-G `resolveRole()`.
- Call P1-C/P2-H `requireOrigin()` on `POST` before reading the query, body, identity, clock, randomness, or store.
- Validate a closed version-1 event schema, derive `actor` only from the proven identity, and generate `ts`, `id`, and the P2-B event key on the server.
- Write exactly one blob with `{ onlyIfNew: true }`, treat `modified: false` as an ID collision, and never retry under a different ID.
- List exactly one month prefix, validate every returned key and every event used in a response, sort by event ID, and expose exclusive keyset pagination.
- Export the schema/append helpers used by later server-side state writers and P4-F, without adding another library file.
- Return closed, generic public errors and emit no log output.

### Out of scope

- Thread, comment, suggestion, edit, access, invitation, grant, or document mutations. Their owning handlers validate and commit those records before calling `appendEvent()`.
- Rendering comments, the changelog, audit UI, unread state, history dots, realtime delivery, or browser refresh policy.
- Treating the event stream as a fold or source of truth.
- Transactions, retries, overwrites, event correction/deletion, tombstones, or idempotency aliases.
- Retention or scheduled execution. P4-F creates `netlify/functions/retention.mjs`; P4-T later narrows which kinds retention may delete.
- Adding dependencies, tests, scripts, redirects, environment variables, secrets, package files, configuration, fixtures, or a second implementation file.
- Accepting or storing heartbeat, presence, typing, connection, channel, subscription, Ably, websocket, or other transient transport events.

## Interface contract

### Module surface

`netlify/functions/events.mjs` is an ECMAScript module with exactly these exports:

```js
export const EVENT_KINDS
export function assertEvent(value, expectedKey)
export async function appendEvent(input, options = {})
export function createEventsHandler(dependencies = {})
export default async function handler(req)
export const config = { path: "/api/events" }
```

`EVENT_KINDS` is a frozen array, in this exact order, and no caller may mutate it:

```json
[
  "comment.create",
  "comment.reply",
  "comment.edit",
  "thread.resolve",
  "thread.reopen",
  "edit.propose",
  "suggest.create",
  "suggest.accept",
  "suggest.reject",
  "suggest.withdraw",
  "suggest.supersede",
  "edit.apply",
  "access.invite",
  "access.change",
  "access.revoke",
  "access.transfer"
]
```

The module imports `identify` and `requireOrigin` from `../lib/identity.mjs`; `resolveRole`, `normalizeEmail`, `assertIdentitySub`, and `AccessError` from `../lib/access.mjs`; and exactly `docState`, `eventPrefix`, `eventKey`, `upgrade`, `assertDocId`, and `StoreError` from `../lib/store.mjs`. It may import `randomBytes` from `node:crypto`. It imports no Netlify SDK directly and contains no environment lookup.

`createEventsHandler()` is the deterministic server-test seam. Its optional closed dependency object permits only `requireOriginFn`, `identifyFn`, `resolveRoleFn`, `storeFn`, `nowFn`, and `randomBytesFn`; omitted values use the production imports, `Date.now`, and `randomBytes`. Unknown keys, non-functions, accessors, symbols, arrays, null, or a non-ordinary prototype throw synchronously. The default export is one named `async function handler(req)` created from production defaults; request data can never select or replace dependencies.

The factory returns an `async function eventsHandler(req)` with one argument. Before using a P2-G result, the handler validates the complete exact `ResolvedAccess` shape from P2-G: `role`, `shared`, and all eight capability fields must be own ordinary data properties with their documented types and values, no extra key may exist, and the fields must equal the row for `role`. A partial, extended, internally inconsistent, or accessor-backed result is an internal 500, never a permissive truthy capability check.

### Closed data rules

Every “exact object” in this ticket is a non-null, non-array ordinary object whose prototype is `Object.prototype`, whose own string keys are exactly the listed keys, and which has no symbols or accessors. Each listed property is an enumerable, writable, configurable data property. Validation uses own property descriptors before reading values, so a custom prototype, proxy trap, inherited property, getter, non-enumerable field, or symbol fails closed. Arrays are dense, use `Array.prototype`, have no symbol or extra string properties, and contain only the stated values. A validator returns a newly constructed exact object; it never returns a provider/request object by reference.

JSON strings must contain no lone surrogate or C0/C1 control character. Unless a field says otherwise, strings are not trimmed or case-folded: the supplied value must already meet its grammar. Byte limits are UTF-8 byte limits, not JavaScript code-unit limits.

### Stored event schema

Every stored event and every event returned by either operation has exactly this top-level order and shape:

```json
{
  "v": 1,
  "id": "1788452365123-4f2a9c",
  "docId": "4b7d2a",
  "ts": "2026-09-03T16:19:25.123Z",
  "actor": {
    "sub": "u_fixture_931",
    "name": "Avery Quill",
    "email": "avery@example.invalid"
  },
  "kind": "comment.create",
  "target": {
    "threadId": "t_m8x2k1_4f7a9c31",
    "aid": "a3f19c2b7"
  },
  "docVersion": "7aaca51",
  "summary": "commented on Architecture"
}
```

The example is invented and uses the reserved `.invalid` domain. Field rules are exact:

| Field | Contract |
|---|---|
| `v` | The number `1`. No coercion. |
| `id` | `^[0-9]{13}-[0-9a-f]{6}$`. The first 13 digits equal `Date.parse(ts)` as a safe integer. |
| `docId` | P2-B `assertDocId()` succeeds and returns the same six-lowercase-hex string. |
| `ts` | Exactly `YYYY-MM-DDTHH:mm:ss.sssZ`; `new Date(Date.parse(ts)).toISOString()` equals it. |
| `actor` | Exact keys `sub`, `name`, `email`. `sub` passes P2-G `assertIdentitySub()`. `name` is a string of at most 200 UTF-8 bytes. `email` is either `""` or unchanged by P2-G `normalizeEmail()` and at most 320 UTF-8 bytes. |
| `kind` | One exact member of `EVENT_KINDS`. |
| `target` | The exact kind-specific object below. |
| `docVersion` | `null` for `access.*`; otherwise lower-case hexadecimal matching `^[0-9a-f]{7,64}$`. |
| `summary` | A trimmed string of 1–160 UTF-8 bytes containing none of `@`, `<`, `>`, CR/LF, or the control characters barred above. It is rendered later only with `textContent`. |

The one permitted non-human actor is exactly `{ sub: "system", name: "Build", email: "" }`. Other actors come from a proven P2-H identity. P3-B does not invent a subject, fill an absent name, or derive identity from a request body/header.

Targets are exact by kind:

| Kind | Exact `target` |
|---|---|
| `comment.create` | `{ threadId, aid }` |
| `comment.reply`, `comment.edit` | `{ threadId, commentId, aid }` |
| `thread.resolve`, `thread.reopen` | `{ threadId, aid }` |
| `edit.propose` | `{ aid }` |
| `suggest.create`, `suggest.accept`, `suggest.reject`, `suggest.withdraw`, `suggest.supersede` | `{ suggestionId, aid }` |
| `edit.apply` | `{ aid }` |
| `access.invite`, `access.change`, `access.revoke` | Exactly one of `{ email }` or `{ sub }`; two identifiers or neither are invalid. |
| `access.transfer` | `{ fromSub, toSub }`, and the strings differ. |

`aid` is either `null` or matches exact `^a[0-9a-f]{8}$`; discussion threads use `null`. `threadId`, `commentId`, and `suggestionId` respectively match `^t_[a-z0-9]{1,48}_[0-9a-f]{8}$`, `^c_[a-z0-9]{1,48}_[0-9a-f]{8}$`, and `^s_[a-z0-9]{1,48}_[0-9a-f]{8}$`. Every `sub`, `fromSub`, and `toSub` passes `assertIdentitySub()`. Every `email` is non-empty, at most 320 UTF-8 bytes, and unchanged by `normalizeEmail()`.

`assertEvent(value, expectedKey)` first calls `upgrade(value)`, then validates and clones the complete schema. `expectedKey` is mandatory and must equal `eventKey(event.docId, event.ts, event.id)`. A body/key mismatch, invalid version, unknown field/kind, malformed actor/target, or invalid string throws; it is never repaired, skipped, or partially returned. The function has no clock, randomness, network, store, identity, logging, or mutation side effect.

### ID, timestamp, key, and append contract

`appendEvent(input, options)` is server-only. `input` is an exact object with keys `store`, `docId`, `actor`, `kind`, `target`, `docVersion`, and `summary`. `options` is an exact object with optional keys `nowMs` and `randomBytesFn` only. When either optional key is present, `nowMs` must already be a valid safe integer and `randomBytesFn` must be a function; explicit null/undefined is invalid. The handler passes its injected production/test dependencies; later trusted state handlers may call the helper directly after their state write.

1. Validate every caller-supplied value other than the generated fields before reading time or randomness and before touching the store.
2. Use the own validated `options.nowMs` when present; otherwise evaluate `Date.now()` exactly once. The result must be a safe integer from `1000000000000` through `9999999999999` for which `new Date(nowMs).toISOString()` succeeds.
3. Call `randomBytesFn(3)` exactly once. It must return a `Uint8Array` of exactly three bytes. Encode all six lowercase hexadecimal digits, preserving leading zeroes. `Math.random()`, `randomUUID()`, a counter, request data, actor data, and store reads are forbidden ID sources.
4. Set `ts = new Date(nowMs).toISOString()` and `id = String(nowMs) + "-" + hex`.
5. Construct the exact event in documented field order, validate it, and derive its key only with P2-B `eventKey(docId, ts, id)`.
6. Call `store.setJSON(key, event, { onlyIfNew: true })` exactly once. Do not attach Blob metadata containing actor, email, name, summary, target, or kind.
7. A resolved result is usable only when it is a non-null, non-array object with an own data property `modified` whose value is exactly `true` or `false`. Additional provider fields are ignored without being read. `modified: true` returns a fresh validated event. `modified: false` throws `new StoreError("conflict", 409, "Concurrent write limit reached")`. Never read the existing key, mutate it, overwrite it, sleep, increment, regenerate, or retry.
8. A thrown/ambiguous provider result becomes a `StoreError("unavailable", 503, "State store unavailable", { cause })`. HTTP maps the preserved `conflict` to its public `409 event-id-collision`; a direct server caller receives the ordinary P2-B `StoreError` contract.

The append helper does not authorize. HTTP authorization belongs to the handler; a later domain handler authorizes its own mutation before calling the helper. A domain mutation is authoritative even if the subsequent append reports 409/503. This ticket promises append-only creation, not an atomic state/event transaction.

### `POST /api/events`

The exact route is `/api/events?doc=4b7d2a`. The query contains exactly one `doc` and no other key. Duplicate, empty, encoded-invalid, or unknown query parameters return `400 invalid-request`. The `doc` value must pass P2-B `assertDocId()` unchanged.

Processing order is exact:

1. For a `POST`, call `requireOrigin(req)` before parsing the URL/query/body, calling identity/access, reading time/randomness, or opening the store. Return its normalized P1-C 403 `Response` unchanged. A non-`Response` throw becomes `500 internal-error`.
2. Validate the URL and query.
3. Call `identify(req)` exactly once. `null` returns 401 without calling `resolveRole()` or opening the store.
4. Call `resolveRole(docId, user)` exactly once in its default read-only mode and validate the complete resolved object described above. Do not pass `consumeInvitation: true`. Do not inspect `isOrg`, provider roles, email suffixes, grants, invitations, or client capabilities.
5. Require `Content-Type: application/json` case-insensitively, with optional parameters. For a non-null body, acquire its reader once and consume serially with a fatal UTF-8 decoder. Retain and decode at most 8,192 body bytes; an absent/invalid length or chunked body is still bounded while reading. The first chunk that would take the total above 8,192 triggers exactly one `reader.cancel()` attempt and returns 413 even when cancellation rejects. A natural `read()` rejection, a non-`Uint8Array` chunk, invalid UTF-8, invalid JSON, an empty body, or a non-exact body returns 400. After acquisition, call `releaseLock()` exactly once on normal completion, overflow, parse/validation failure, and read rejection; do not cancel a naturally completed or rejected stream. Only after the bounded byte read succeeds may JSON parsing begin.
6. Accept an exact body with keys in any order: `{ kind, target, docVersion, summary }`. Reject `v`, `id`, `docId`, `doc`, `ts`, `actor`, `author`, `email`, `sub`, `isOrg`, capability, metadata, retry, and every other extra property rather than ignoring it.
7. Apply the capability table below to the one already validated access result. A valid but insufficient capability returns 403 without time, randomness, or an event write.
8. Call `docState()` exactly once and then `appendEvent()` once with the proven `{ sub, name, email }` actor. Return the created event directly. Do not call `list()` after a write.

| Requested kind | Required resolved capability |
|---|---|
| `comment.create`, `comment.reply`, `comment.edit` | `canComment === true` |
| `thread.resolve`, `thread.reopen` | `threadControl === "any"`; the generic endpoint cannot prove an `"own"` thread. The thread handler may authorize ownership and call `appendEvent()` directly. |
| `edit.propose`, `suggest.create`, `suggest.withdraw`, `suggest.supersede` | `canSuggest === true` |
| `suggest.accept`, `suggest.reject` | `canAccept === true` |
| `edit.apply` | `canEdit === true` |
| `access.invite`, `access.change`, `access.revoke`, `access.transfer` | `canShare === true` |

Success is status 201 with the exact event JSON. `POST` establishes who appended the fact and whether that actor had the relevant document capability; it does not claim to verify another feature's state transition. Production feature handlers must append only after they have validated and committed their own authoritative transition.

### `GET /api/events`

The exact route is:

```text
/api/events?doc=4b7d2a&month=2026-09&limit=50&after=1788452365123-4f2a9c
```

`doc` and `month` occur exactly once. `limit` and `after` are optional and occur at most once. No other query key is accepted. Parameter order is irrelevant.

- `month` matches `^[0-9]{4}-(0[1-9]|1[0-2])$`; parsing its first UTC millisecond must succeed and produce the 13-digit millisecond domain used by event IDs. This excludes months in which this schema cannot produce an ID.
- `limit` defaults to 50 and otherwise is the canonical decimal spelling of an integer 1–100: no sign, zero padding, whitespace, decimal, or exponent.
- `after` is an exclusive event-ID cursor matching the ID grammar. Its 13-digit millisecond timestamp must format to the requested UTC `month`; otherwise return 400.

Processing order is exact: validate method and query; call `identify(req)` exactly once; return 401 for null; call `resolveRole(docId, user)` once with default options; require `canSeeMembers === true`; then open `docState()`. A valid access result with `canSeeMembers: false` returns 403. A missing or non-boolean `canSeeMembers` fails closed as 500. `GET` does not call `requireOrigin()` and has no store, list, or response side effect before authorization succeeds.

Call `eventPrefix(docId, month)` and then `store.list({ prefix, paginate: true })` exactly once. The official SDK returns an async iterator whose provider pages contain at most 1,000 entries. Consume that iterator serially and retain only validated key strings. Accept at most ten provider pages and 10,000 keys for one month. Pull at most one additional iterator result solely to prove exhaustion: an eleventh page (including an empty page), a 10,001st entry, a page larger than 1,000 entries, a non-iterable result, or a malformed iterator/page rejects the request as `503 state-unavailable`. Consequently one GET performs at most eleven iterator pulls, materializes at most one provider page at a time, and retains at most 10,000 short event keys; it never invokes the SDK's automatic all-pages collection. This is a read-time operational ceiling, not a write-time event quota. Operators must complete P4-F retention or repair an anomalous month before that month is readable again.

Each yielded page must be a non-null, non-array ordinary object with own enumerable data-properties `blobs` and `directories`; `blobs` must be a dense array of at most 1,000 entries and `directories` must be a dense empty array. Every blob entry must be an ordinary object with an own enumerable data-property `key` whose value is a string of at most 96 UTF-8 bytes. Accessors, symbols, custom prototypes, sparse arrays, extra array properties, a missing/non-string/overlong `key`, and any other page or entry envelope violation are invalid, are never invoked, and map to `503 state-unavailable`. Ignore `etag` and other provider object fields without reading them. After that structural validation, each key string must exactly match `prefix + <valid eventId> + ".json"`, and the ID timestamp must belong to `month`; an out-of-prefix, malformed event-ID, wrong-month, or duplicate key across any page fails the entire request with `500 internal-error`. Thus a malformed provider envelope is unavailable state, while bad data in a structurally valid listed key is corrupt internal state.

Sort validated full keys by their ASCII event-ID suffix in ascending order; never trust provider order or locale collation. Drop keys at or before `after`. Walk candidates in that order and call `store.get(key, { type: "json", consistency: "strong" })` one at a time until either `limit + 1` valid events have been collected or candidates are exhausted. `null` means P4-F deleted a listed event concurrently and is skipped. Any non-null value must pass `assertEvent(value, key)`; corrupt data fails the entire request with 500 rather than being hidden. No more than `limit + 1` non-null events are read after the cursor.

If `limit + 1` valid events were collected, remove the last one and set `nextAfter` to the `id` of the last returned event. Otherwise `nextAfter` is null. The response is an exact fresh object:

```json
{
  "v": 1,
  "docId": "4b7d2a",
  "month": "2026-09",
  "events": [],
  "nextAfter": null
}
```

Pagination is a live keyset view, not a snapshot: concurrent later IDs may appear on a later page; a back-dated ID at or before an already-used cursor requires a fresh month read. Same-millisecond events are ordered by their random hexadecimal suffix. The client must append the successful POST response locally instead of assuming a subsequent list immediately observes it.

### HTTP responses and error boundary

Every JSON response has `Content-Type: application/json; charset=utf-8` and `Cache-Control: private, no-store`. Error JSON is exactly `{"error":"<code>"}` with no detail, stack, cause, path, key, actor, email, target, summary, provider body, record, or environment data.

| Condition | Status and exact code |
|---|---|
| Successful GET | 200 and the exact page object |
| Successful POST | 201 and the exact event object |
| Bad URL/query/body/schema/cursor/document selected by the request | 400 `invalid-request` |
| No proven identity | 401 `unauthenticated` |
| Valid identity without the required capability | 403 `forbidden` |
| P1-C origin rejection | Return the exact text/plain `Bad origin` 403 from `requireOrigin()` unchanged |
| Method other than GET/POST | 405 `method-not-allowed`, plus `Allow: GET, POST` |
| Generated key already exists (`modified: false`) or a preserved P2-B `conflict` | 409 `event-id-collision` |
| Body exceeds 8,192 bytes | 413 `payload-too-large` |
| POST media type is not JSON | 415 `unsupported-media-type` |
| Invalid dependency, access result, listed key, stored event, or unexpected internal error | 500 `internal-error` |
| P2-B/direct Blob unavailable, rejected operation, or malformed/ambiguous list/write result envelope | 503 `state-unavailable` |

Validate request-selected `doc` before general error classification so its `StoreError("invalid-key", ...)` maps to 400. Validate the four-field POST body, including P2-G email/subject helpers, inside a distinct request-validation boundary so those body failures map to 400. After those two boundaries, preserve P2-B `StoreError` only internally: a caught `StoreError` with code `unavailable` maps to 503 and `conflict` maps to 409; other `StoreError` and every later `AccessError` map to 500. Any direct Blob rejection is wrapped as unavailable. Classification reads only own data descriptors for `code`; a hostile thrown object cannot execute a getter or escape the generic 500 fallback.

The module never calls `console.*`, never records request/response bodies, and never places identity or event fields in Blob metadata. Actor email and access-target email are personal data stored only inside the guarded event blob and returned only to the creating actor or a `canSeeMembers` reader. `summary` cannot contain an email spelling and later renderers use `textContent`, not HTML interpretation.

## Files owned

- `netlify/functions/events.mjs` — **created**; the only implementation file and the only source file this ticket may add or change.

Do not change `netlify/lib/store.mjs`, `netlify/lib/identity.mjs`, `netlify/lib/access.mjs`, another Function, a browser/template asset, `package.json`, a lockfile, `netlify.toml`, generated output, a test file, a workflow, a research document, or a prompt. `docs/tickets/P3-B.md` is this specification, not implementation source.

## Dependencies

### Required predecessors

- **P1-C:** supplies the Functions v2 identity/origin module and pinned root Functions dependencies.
- **P2-B:** supplies the `doc-state` strong store, `assertDocId()`, `upgrade()`, `eventPrefix()`, `eventKey()`, `StoreError`, and create-only result convention.
- **P2-H:** must be integrated after P1-C so `identify()` has the final exact `{ sub, email, name, isOrg }` shape. P3-B stores only the first three fields and never treats `isOrg` as authority.
- **P2-G:** must be integrated after P2-B and P2-H so `resolveRole()`, capability fields, identity-sub/email validation, and access errors are final.

The safe predecessor order is P1-C and P2-B in parallel, P2-H after P1-C, P2-G after P2-B plus P2-H, then P3-B after all four implementations and their owning gates pass. Maximum safe parallelism in the first wave is two. Do not implement against P1-C's temporary seven-field identity or add a fallback while waiting for P2-H/P2-G.

### Implementation waves

P3-B changes one shared module, so its own maximum safe implementation parallelism is one. Implement it in four reviewable waves without publishing a partial interface: (1) constants, closed validators, ID/key relation, and the dependency factory; (2) `appendEvent()` and its conditional-create/error boundary; (3) POST then GET using the same validators; (4) the complete source-bound fixture and repository gates. Run the fixture after each wave that can load, but expose the module only when all six exports and both HTTP methods satisfy this ticket. Do not split helpers into an unowned file to manufacture parallel work.

### Downstream boundaries

- P3-A remains parallel with P3-B and, by its own closed contract, writes only authoritative thread state; it performs no audit append and does not acquire a P3-B dependency. **P4-M (#35)** is the exact downstream amendment boundary because it owns `netlify/functions/threads.mjs` and `netlify/functions/thread.mjs`. P4-M adds P3-B as a predecessor, imports `appendEvent()` directly, and appends `comment.create`, `comment.reply`, `thread.resolve`, or `thread.reopen` only after the corresponding authoritative state write succeeds. A resolve/reopen no-op emits no event. An append failure never rolls state back, and P4-M's injected-failure acceptance must prove both the exact action-to-kind mapping and that ordering. Neither P4-M nor a browser calls this endpoint's HTTP POST merely to make a state mutation look audited. Until P4-M lands, the absence of those four thread audit rows is this explicit downstream gap rather than hidden P3-A behavior.
- Changelog/audit clients consume GET pages in order and render text as text. Comment UI continues to read thread blobs, never this stream.
- P4-F owns the daily 18-month deletion function. It imports `assertEvent()`/`EVENT_KINDS` if it needs event validation, deletes only after its own bounded scan/cutoff checks, and never edits P3-B or changes the endpoint response. P3-B performs no eager expiry and tolerates a list/get deletion race only by skipping `null`.
- P4-T later amends P4-F to retain `suggest.accept`, `suggest.reject`, `edit.apply`, and all four `access.*` kinds and to add its other expiry sweeps. P3-B keeps those kinds distinguishable and does not pre-implement either retention policy.
- Realtime publishers may project an already-created event but never call `appendEvent()` for presence, heartbeat, subscription, connection, or transport activity.

## Acceptance criteria

1. The only implementation change is `netlify/functions/events.mjs`, with exactly the six documented exports and exact `/api/events` config.
2. `POST` performs origin, query, identity, authorization, bounded-body, schema, time/randomness, store, and append work in the documented order; the body reader is canceled/released exactly as documented, and early failures prove later dependencies were not called.
3. The stored actor is a fresh projection of the one P2-H identity result. Body-supplied identity/generated/capability fields are rejected.
4. A deterministic timestamp and three deterministic random bytes produce the exact ID, timestamp, month prefix, P2-B key, event field order, and 201 body.
5. `setJSON` receives exactly `{ onlyIfNew: true }` once. `modified: false` returns 409 without read/retry/regeneration; malformed or rejected results fail closed.
6. The fixture accepts each of the 16 enumerated kinds with its documented canonical target and rejects its paired capability-denial case; it also executes the named finite invalid-body equivalence matrix below. The acceptance oracle makes no claim to enumerate the infinite set of possible invalid strings: the source contract remains the closed predicates above, while the executable matrix proves one boundary representative for every declared type, presence, extra-key, grammar, length, relation, and reserved-transient class.
7. GET requires `canSeeMembers`, manually paginates exactly one month-prefix listing, enforces the ten-page/10,000-key/eleven-pull operational boundary, validates provider keys/records, ignores provider order, and returns ascending exclusive pages of at most 100 events with the exact `nextAfter` behavior.
8. GET skips a listed key that becomes `null`, but rejects duplicate/malformed keys and corrupt or mismatched stored records. No event from another document/month can enter a response.
9. Every status, error body, header, and error precedence matches the table. Origin rejection is unchanged; all other failures are generic and private/no-store.
10. POST returns the created object without listing. The exact AST oracle proves the documented import/export boundary, no dynamic import, no environment or logging access, no direct provider/network/server/worker/timer API, and one syntactically create-only `setJSON` call with exactly three arguments and `{ onlyIfNew: true }`. Runtime assertions prove that call receives no fourth metadata argument, collision performs no read/list/retry/regeneration, and the tested POST paths perform no event-derived state mutation. No broader semantic absence is inferred from a text search.
11. The source-bound deterministic fixture covers all 16 event kinds and paired capability denials, all six accepted `{email}`/`{sub}` access-target forms, every row of the named finite target/identifier/document-version/summary matrix, and the remaining request/store/pagination branches named under **Test plan**; it exits with exactly `PASS  P3-B events API` on stdout and no stderr.
12. Repository build/type gates pass without changing generated or configuration files, and issue #15 passes the executable pointer-integrity gate: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

### Source-bound deterministic fixture

Run this from the repository root after the four predecessor implementations are integrated. The fixture imports the real production module and exercises its exported factory with in-memory dependencies; it opens no port and spawns no descendant. Its outer supervisor is cross-platform Node, uses a finite 30-second deadline, forwards HUP/INT/TERM, escalates TERM to KILL after two seconds, awaits the direct child close event, and preserves conventional signal status. A source oracle forbids `child_process`, worker, subprocess, daemon, server-listen, timer-loop, and console routes in `events.mjs`; direct-child supervision is therefore proportionate to the executable under test.

```bash
set -euo pipefail

P3B_PARENT="${TMPDIR:-/tmp}"
P3B_PARENT="$(cd "$P3B_PARENT" && pwd -P)"
case "$P3B_PARENT" in /|"") echo "unsafe temp parent" >&2; exit 1;; esac
P3B_ROOT_REAL=""
P3B_SIGNAL_STATUS=0

cleanup_p3b() {
  if test -n "${P3B_ROOT_REAL:-}" && test -d "$P3B_ROOT_REAL" && test ! -L "$P3B_ROOT_REAL"; then
    case "$P3B_ROOT_REAL" in
      "$P3B_PARENT"/p3-b.??????)
        test ! -e "$P3B_ROOT_REAL/test.mjs" || rm -f -- "$P3B_ROOT_REAL/test.mjs"
        rmdir -- "$P3B_ROOT_REAL"
        ;;
      *) return 1;;
    esac
  fi
}
trap cleanup_p3b EXIT
trap 'test "$P3B_SIGNAL_STATUS" -ne 0 || P3B_SIGNAL_STATUS=129' HUP
trap 'test "$P3B_SIGNAL_STATUS" -ne 0 || P3B_SIGNAL_STATUS=130' INT
trap 'test "$P3B_SIGNAL_STATUS" -ne 0 || P3B_SIGNAL_STATUS=143' TERM

P3B_ROOT="$(mktemp -d "$P3B_PARENT/p3-b.XXXXXX")"
P3B_ROOT_REAL="$(cd "$P3B_ROOT" && pwd -P)"
case "$P3B_ROOT_REAL" in "$P3B_PARENT"/p3-b.??????) ;; *) echo "unsafe temp root" >&2; exit 1;; esac
test ! -L "$P3B_ROOT"

cat >"$P3B_ROOT/test.mjs" <<'P3B_NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const sourcePath = process.env.P3B_SOURCE;
const source = await readFile(sourcePath, "utf8");
const require = createRequire(import.meta.url);
const ts = require(process.env.P3B_TYPESCRIPT);
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.deepEqual(sourceFile.parseDiagnostics, [], "events.mjs must parse as JavaScript");
const imports = sourceFile.statements.filter(ts.isImportDeclaration).map((node) => {
  assert(ts.isStringLiteral(node.moduleSpecifier));
  assert(node.importClause && !node.importClause.isTypeOnly && !node.importClause.name);
  assert(node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings));
  return [node.moduleSpecifier.text, node.importClause.namedBindings.elements.map((element) => {
    assert.equal(element.isTypeOnly, false); assert.equal(element.propertyName, undefined); return element.name.text;
  })];
});
const importMap = new Map(imports);
assert.equal(importMap.size, imports.length, "one declaration per imported module");
assert.deepEqual([...importMap.keys()].sort(), ["../lib/access.mjs", "../lib/identity.mjs", "../lib/store.mjs", ...(importMap.has("node:crypto") ? ["node:crypto"] : [])].sort());
assert.deepEqual(importMap.get("../lib/identity.mjs"), ["identify", "requireOrigin"]);
assert.deepEqual(importMap.get("../lib/access.mjs"), ["resolveRole", "normalizeEmail", "assertIdentitySub", "AccessError"]);
assert.deepEqual(importMap.get("../lib/store.mjs"), ["docState", "eventPrefix", "eventKey", "upgrade", "assertDocId", "StoreError"]);
if (importMap.has("node:crypto")) assert.deepEqual(importMap.get("node:crypto"), ["randomBytes"]);

const forbiddenCalls = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "BroadcastChannel", "eval", "Function", "setTimeout", "setInterval", "setImmediate", "queueMicrotask"]);
const writeCalls = [];
const staticMember = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
const staticOwner = (node) => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) ? node.expression.text : null;
function walkAst(node) {
  if (ts.isIdentifier(node)) {
    assert.equal(new Set([...forbiddenCalls, "console", "process", "Deno", "Bun", "globalThis", "self", "window", "navigator"]).has(node.text), false, `forbidden identifier ${node.text}`);
  }
  if (ts.isCallExpression(node)) {
    assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic import is forbidden");
    if (ts.isIdentifier(node.expression)) assert.equal(forbiddenCalls.has(node.expression.text), false, `forbidden call ${node.expression.text}`);
    if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) {
      const owner = staticOwner(node.expression), member = staticMember(node.expression);
      assert.equal(forbiddenCalls.has(member), false, `forbidden member call ${member}`);
      assert.equal(member === "listen", false, "server listen is forbidden");
      assert.equal(owner === "store" && member === "set", false, "unconditional store.set is forbidden");
      if (member === "setJSON") writeCalls.push(node);
    }
  }
  if (ts.isNewExpression(node)) {
    const constructorName = ts.isIdentifier(node.expression) ? node.expression.text : staticMember(node.expression);
    assert.equal(forbiddenCalls.has(constructorName), false, `forbidden constructor ${constructorName}`);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const owner = staticOwner(node), member = staticMember(node);
    assert.equal(owner === "console", false, "console access is forbidden");
    assert.equal(owner === "Math" && member === "random", false, "Math.random is forbidden");
    assert.equal(["process", "Deno", "Bun"].includes(owner) && member === "env", false, `${owner}.env is forbidden`);
    assert.equal(node.expression.kind === ts.SyntaxKind.ImportMeta && member === "env", false, "import.meta.env is forbidden");
  }
  ts.forEachChild(node, walkAst);
}
walkAst(sourceFile);
assert.equal(writeCalls.length, 1, "the only provider write syntax is one setJSON call site");
const write = writeCalls[0];
assert(ts.isPropertyAccessExpression(write.expression));
assert.equal(write.expression.name.text, "setJSON"); assert.equal(write.arguments.length, 3);
assert(ts.isObjectLiteralExpression(write.arguments[2])); assert.equal(write.arguments[2].properties.length, 1);
const onlyIfNew = write.arguments[2].properties[0];
assert(ts.isPropertyAssignment(onlyIfNew)); assert.equal(onlyIfNew.name.getText(sourceFile), "onlyIfNew");
assert.equal(onlyIfNew.initializer.kind, ts.SyntaxKind.TrueKeyword);

const mod = await import(pathToFileURL(sourcePath).href + `?p3b=${Date.now()}`);
assert.deepEqual(Object.keys(mod).sort(), [
  "EVENT_KINDS", "appendEvent", "assertEvent", "config", "createEventsHandler", "default",
].sort());
assert.deepEqual(mod.config, { path: "/api/events" });
assert.equal(mod.default.name, "handler"); assert.equal(mod.default.length, 1);
assert(Object.isFrozen(mod.EVENT_KINDS));
assert.deepEqual(mod.EVENT_KINDS, [
  "comment.create", "comment.reply", "comment.edit", "thread.resolve", "thread.reopen", "edit.propose",
  "suggest.create", "suggest.accept", "suggest.reject", "suggest.withdraw", "suggest.supersede", "edit.apply",
  "access.invite", "access.change", "access.revoke", "access.transfer",
]);

const actor = { sub: "u_fixture_931", name: "Avery Quill", email: "avery@example.invalid" };
const identity = { ...actor, isOrg: false };
const target = { threadId: "t_m8x2k1_4f7a9c31", aid: "a3f19c2b7" };
const baseBody = { kind: "comment.create", target, docVersion: "7aaca51", summary: "commented on Architecture" };
const headers = { Origin: "https://docs.example.invalid", "Content-Type": "application/json" };
const makeReq = (method, query, body, extra = {}) => new Request(`https://docs.example.invalid/api/events${query}`, {
  method, headers: { ...headers, ...(extra.headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body),
});
function streamedPost(chunks, { readError = false, cancelError = false } = {}) {
  const stats = { reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (readError) { readError = false; controller.error(new Error("private body stream detail")); return; }
      if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();
    },
    cancel() { if (cancelError) return Promise.reject(new Error("private cancel detail")); },
  }, { highWaterMark: 0 });
  const request = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: stream, duplex: "half" });
  const getNativeReader = request.body.getReader.bind(request.body);
  request.body.getReader = () => {
    const reader = getNativeReader();
    return {
      read() { stats.reads += 1; return reader.read(); },
      cancel(reason) { stats.cancels += 1; return reader.cancel(reason); },
      releaseLock() { stats.releases += 1; return reader.releaseLock(); },
    };
  };
  return { request, stats };
}

async function assertJsonResponse(response, status, code = null) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("allow"), status === 405 ? "GET, POST" : null);
  if (code !== null) assert.deepEqual(await response.clone().json(), { error: code });
  return response;
}

function harness(overrides = {}) {
  const { capability: capabilityOverride = {}, ...dependencyOverrides } = overrides;
  const calls = [];
  const records = new Map();
  const store = {
    async setJSON(...args) { const [key, value, options] = args; calls.push(["set", key, structuredClone(value), options, args.length]); records.set(key, structuredClone(value)); return { modified: true }; },
    list(options) {
      calls.push(["list", options]);
      const blobs = [...records.keys()].reverse().map((key) => ({ key, etag: "ignored" }));
      return { async *[Symbol.asyncIterator]() { yield { blobs, directories: [] }; } };
    },
    async get(key, options) { calls.push(["get", key, options]); return records.has(key) ? structuredClone(records.get(key)) : null; },
  };
  const capability = {
    role: "owner", shared: true, canRead: true, canComment: true, threadControl: "any",
    canSuggest: true, canEdit: true, canAccept: true, canShare: true, canSeeMembers: true,
    ...capabilityOverride,
  };
  const deps = {
    requireOriginFn(req) { calls.push(["origin"]); if (req.headers.get("Origin") !== new URL(req.url).origin) throw new Response("Bad origin", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }); },
    async identifyFn() { calls.push(["identify"]); return identity; },
    async resolveRoleFn(docId, user) { calls.push(["role", docId, user]); return capability; },
    storeFn() { calls.push(["store"]); return store; },
    nowFn() { calls.push(["now"]); return 1788452365123; },
    randomBytesFn(size) { calls.push(["random", size]); return Uint8Array.of(0x4f, 0x2a, 0x9c); },
    ...dependencyOverrides,
  };
  const handler = mod.createEventsHandler(deps);
  assert.equal(handler.name, "eventsHandler"); assert.equal(handler.length, 1);
  return { handler, calls, records, store, capability };
}

{
  const h = harness();
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  await assertJsonResponse(response, 201);
  const event = await response.json();
  assert.deepEqual(Object.keys(event), ["v", "id", "docId", "ts", "actor", "kind", "target", "docVersion", "summary"]);
  assert.deepEqual(event, {
    v: 1, id: "1788452365123-4f2a9c", docId: "4b7d2a", ts: "2026-09-03T16:19:25.123Z",
    actor, kind: "comment.create", target, docVersion: "7aaca51", summary: "commented on Architecture",
  });
  const set = h.calls.find((call) => call[0] === "set");
  assert.equal(set[1], "events/4b7d2a/2026-09/1788452365123-4f2a9c.json");
  assert.deepEqual(h.calls.find((call) => call[0] === "role").slice(1), ["4b7d2a", identity]);
  assert.deepEqual(set[2].actor, actor); assert.deepEqual(Object.keys(set[2].actor), ["sub", "name", "email"]);
  assert.deepEqual(set[3], { onlyIfNew: true });
  assert.equal(set[4], 3, "no Blob metadata/fourth write argument");
  assert.equal(h.calls.filter((call) => call[0] === "set").length, 1);
  assert.equal(h.calls.some((call) => call[0] === "list"), false);
}

{
  const order = [];
  const h = harness({
    requireOriginFn() { order.push("origin"); throw new Response("Bad origin", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }); },
    async identifyFn() { order.push("identify"); return actor; },
  });
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", { ...baseBody, actor: { sub: "forged" } }));
  assert.equal(response.status, 403); assert.equal(await response.text(), "Bad origin"); assert.deepEqual(order, ["origin"]);
}
{
  const order = [];
  const h = harness({
    requireOriginFn() { order.push("origin"); throw new Error("private origin detail"); },
    async identifyFn() { order.push("identify"); return actor; },
  });
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: "internal-error" }); assert.deepEqual(order, ["origin"]);
}

const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
const invalidBodies = [
  ...["kind", "target", "docVersion", "summary"].map((key) => [`top missing ${key}`, omit(baseBody, key)]),
  ...["v", "id", "docId", "doc", "ts", "actor", "author", "email", "sub", "isOrg", "canShare", "metadata", "retry"]
    .map((key) => [`top reserved/extra ${key}`, { ...baseBody, [key]: key === "actor" ? actor : "forged" }]),
  ["top non-object null", null], ["top non-object array", []],
  ["kind type", { ...baseBody, kind: 1 }], ["kind ordinary unknown", { ...baseBody, kind: "comment.unknown" }],
  ["kind reserved presence", { ...baseBody, kind: "presence" }], ["kind reserved heartbeat", { ...baseBody, kind: "heartbeat" }],
  ["kind reserved realtime", { ...baseBody, kind: "realtime.publish" }],
  ["target type", { ...baseBody, target: null }], ["target missing key", { ...baseBody, target: { threadId: target.threadId } }],
  ["target extra key", { ...baseBody, target: { ...target, extra: "x" } }],
  ["summary type", { ...baseBody, summary: 1 }], ["summary empty", { ...baseBody, summary: "" }],
  ["summary untrimmed", { ...baseBody, summary: " padded" }], ["summary utf8 over 160", { ...baseBody, summary: "é".repeat(81) }],
  ["summary email marker", { ...baseBody, summary: "mail avery@example.invalid" }],
  ["summary markup less", { ...baseBody, summary: "contains < markup" }], ["summary markup greater", { ...baseBody, summary: "contains > markup" }],
  ["summary newline", { ...baseBody, summary: "line\nbreak" }], ["summary control", { ...baseBody, summary: `bad${String.fromCharCode(0x85)}value` }],
  ["summary lone surrogate", { ...baseBody, summary: "bad\ud800value" }],
  ["docVersion type", { ...baseBody, docVersion: 1 }], ["docVersion null on non-access", { ...baseBody, docVersion: null }],
  ["docVersion uppercase", { ...baseBody, docVersion: "7AACA51" }], ["docVersion too short", { ...baseBody, docVersion: "7aaca5" }],
  ["docVersion too long", { ...baseBody, docVersion: "a".repeat(65) }],
];
for (const [label, body] of invalidBodies) {
  const h = harness(); const response = await h.handler(makeReq("POST", "?doc=4b7d2a", body));
  assert.equal(response.status, 400, label); assert.equal(h.calls.some((call) => call[0] === "set"), false, label);
  assert.equal(h.calls.some((call) => call[0] === "now" || call[0] === "random"), false);
}

{
  const h = harness({ async identifyFn() { return null; } });
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 401); assert.equal(h.calls.some((call) => call[0] === "role"), false);
}

const kindCases = [
  ["comment.create", { threadId: "t_m8x2k1_4f7a9c31", aid: "a3f19c2b7" }, "7aaca51", "canComment", false],
  ["comment.reply", { threadId: "t_m8x2k1_4f7a9c31", commentId: "c_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canComment", false],
  ["comment.edit", { threadId: "t_m8x2k1_4f7a9c31", commentId: "c_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canComment", false],
  ["thread.resolve", { threadId: "t_m8x2k1_4f7a9c31", aid: null }, "7aaca51", "threadControl", "own"],
  ["thread.reopen", { threadId: "t_m8x2k1_4f7a9c31", aid: "a3f19c2b7" }, "7aaca51", "threadControl", "none"],
  ["edit.propose", { aid: "a3f19c2b7" }, "7aaca51", "canSuggest", false],
  ["suggest.create", { suggestionId: "s_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canSuggest", false],
  ["suggest.accept", { suggestionId: "s_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canAccept", false],
  ["suggest.reject", { suggestionId: "s_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canAccept", false],
  ["suggest.withdraw", { suggestionId: "s_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canSuggest", false],
  ["suggest.supersede", { suggestionId: "s_n7p2_1234abcd", aid: "a3f19c2b7" }, "7aaca51", "canSuggest", false],
  ["edit.apply", { aid: "a3f19c2b7" }, "7aaca51", "canEdit", false],
  ["access.invite", { email: "reviewer@example.invalid" }, null, "canShare", false],
  ["access.change", { sub: "u_fixture_482" }, null, "canShare", false],
  ["access.revoke", { email: "reviewer@example.invalid" }, null, "canShare", false],
  ["access.transfer", { fromSub: "u_fixture_931", toSub: "u_fixture_482" }, null, "canShare", false],
];
for (const [kind, kindTarget, docVersion, capabilityName, deniedValue] of kindCases) {
  const body = { kind, target: kindTarget, docVersion, summary: `audit ${kind}` };
  const allowed = harness();
  const accepted = await allowed.handler(makeReq("POST", "?doc=4b7d2a", body));
  assert.equal(accepted.status, 201, `accept ${kind}`);
  assert.equal((await accepted.json()).kind, kind);
  const denied = harness({ capability: { [capabilityName]: deniedValue } });
  const rejected = await denied.handler(makeReq("POST", "?doc=4b7d2a", body));
  assert.equal(rejected.status, 403, `deny ${kind}`);
  assert.equal(denied.calls.some((call) => call[0] === "set"), false);
}

for (const [kind, kindTarget] of [
  ["access.invite", { sub: "u_fixture_482" }],
  ["access.change", { email: "member@review.invalid" }],
  ["access.revoke", { sub: "u_fixture_482" }],
]) {
  const h = harness();
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", {
    kind, target: kindTarget, docVersion: null, summary: `audit ${kind}`,
  }));
  assert.equal(response.status, 201, `accept alternative target for ${kind}`);
}

for (const [label, body] of [
  ["aid missing", { ...baseBody, target: { threadId: "t_m8x2k1_4f7a9c31" } }],
  ["aid type", { ...baseBody, target: { ...target, aid: 1 } }], ["aid grammar", { ...baseBody, target: { ...target, aid: "a3f19c2b" } }],
  ["thread type", { ...baseBody, target: { ...target, threadId: 1 } }], ["thread grammar", { ...baseBody, target: { ...target, threadId: "bad" } }],
  ["thread 49-char middle", { ...baseBody, target: { ...target, threadId: `t_${"m".repeat(49)}_4f7a9c31` } }],
  ["comment missing", { kind: "comment.reply", target: { threadId: "t_m8x2k1_4f7a9c31", aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit reply" }],
  ["comment type", { kind: "comment.reply", target: { threadId: "t_m8x2k1_4f7a9c31", commentId: 1, aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit reply" }],
  ["comment grammar", { kind: "comment.reply", target: { threadId: "t_m8x2k1_4f7a9c31", commentId: "c_n7p2_1234abc", aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit reply" }],
  ["suggestion missing", { kind: "suggest.create", target: { aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit suggestion" }],
  ["suggestion type", { kind: "suggest.create", target: { suggestionId: 1, aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit suggestion" }],
  ["suggestion grammar", { kind: "suggest.create", target: { suggestionId: "s_n7p2_1234abc", aid: "a3f19c2b7" }, docVersion: "7aaca51", summary: "audit suggestion" }],
  ["access neither identifier", { kind: "access.invite", target: {}, docVersion: null, summary: "audit invite" }],
  ["access both identifiers", { kind: "access.change", target: { sub: "u_fixture_482", email: "member@review.invalid" }, docVersion: null, summary: "audit change" }],
  ["access sub type", { kind: "access.change", target: { sub: 1 }, docVersion: null, summary: "audit change" }],
  ["access sub grammar", { kind: "access.change", target: { sub: "x" }, docVersion: null, summary: "audit change" }],
  ["access email type", { kind: "access.revoke", target: { email: 1 }, docVersion: null, summary: "audit revoke" }],
  ["access email empty", { kind: "access.revoke", target: { email: "" }, docVersion: null, summary: "audit revoke" }],
  ["access email not normalized", { kind: "access.revoke", target: { email: "Member@review.invalid" }, docVersion: null, summary: "audit revoke" }],
  ["access email over 320 bytes", { kind: "access.revoke", target: { email: `${"a".repeat(305)}@example.invalid` }, docVersion: null, summary: "audit revoke" }],
  ["transfer missing from", { kind: "access.transfer", target: { toSub: "u_fixture_482" }, docVersion: null, summary: "audit transfer" }],
  ["transfer missing to", { kind: "access.transfer", target: { fromSub: "u_fixture_931" }, docVersion: null, summary: "audit transfer" }],
  ["transfer same", { kind: "access.transfer", target: { fromSub: "u_fixture_482", toSub: "u_fixture_482" }, docVersion: null, summary: "audit transfer" }],
  ["access non-null version", { kind: "access.invite", target: { email: "member@review.invalid" }, docVersion: "7aaca51", summary: "audit invite" }],
]) {
  const h = harness();
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", body));
  assert.equal(response.status, 400, label);
  assert.equal(h.calls.some((call) => call[0] === "set"), false);
  assert.equal(h.calls.some((call) => call[0] === "now" || call[0] === "random"), false);
}

{
  const h = harness();
  h.store.setJSON = async (...args) => { h.calls.push(["collision-set", args.length]); return { modified: false }; };
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 409); assert.equal((await response.json()).error, "event-id-collision");
  assert.deepEqual(h.calls.filter((call) => call[0] === "collision-set"), [["collision-set", 3]]);
  assert.equal(h.calls.filter((call) => call[0] === "now").length, 1); assert.equal(h.calls.filter((call) => call[0] === "random").length, 1);
  assert.equal(h.calls.some((call) => call[0] === "get" || call[0] === "list"), false);
}

for (const result of [null, [], {}, { modified: "true" }]) {
  const h = harness(); h.store.setJSON = async () => result;
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 503); assert.equal((await response.json()).error, "state-unavailable");
}
{
  let getterCalls = 0;
  const hostile = {};
  Object.defineProperty(hostile, "modified", { get() { getterCalls++; throw new Error("must not execute"); }, enumerable: true });
  const h = harness(); h.store.setJSON = async () => hostile;
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 503); assert.equal(getterCalls, 0);
}
{
  const h = harness(); h.store.setJSON = async () => { throw new Error("private provider detail"); };
  const response = await h.handler(makeReq("POST", "?doc=4b7d2a", baseBody));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "state-unavailable" });
}

{
  const badMedia = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers: { Origin: "https://docs.example.invalid", "Content-Type": "text/plain" }, body: "{}" });
  assert.equal((await harness().handler(badMedia)).status, 415);
  const badJson = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: "{" });
  assert.equal((await harness().handler(badJson)).status, 400);
  const validJson = JSON.stringify(baseBody);
  const exact = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: validJson + " ".repeat(8192 - Buffer.byteLength(validJson)) });
  assert.equal((await harness().handler(exact)).status, 201);
  const huge = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: `{"x":"${"x".repeat(8200)}"}` });
  assert.equal((await harness().handler(huge)).status, 413);
  const invalidUtf8 = new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: Uint8Array.of(0xc3, 0x28) });
  assert.equal((await harness().handler(invalidUtf8)).status, 400);
  assert.equal((await harness().handler(makeReq("POST", "?doc=4b7d2a&x=1", baseBody))).status, 400);
  assert.equal((await harness().handler(makeReq("POST", "?doc=4b7d2a&doc=4b7d2a", baseBody))).status, 400);
}
{
  const encoded = new TextEncoder().encode(JSON.stringify(baseBody));
  const normal = streamedPost([encoded]);
  await assertJsonResponse(await harness().handler(normal.request), 201);
  assert.deepEqual(normal.stats, { reads: 2, cancels: 0, releases: 1 });

  const malformed = streamedPost([new TextEncoder().encode("{")]);
  await assertJsonResponse(await harness().handler(malformed.request), 400, "invalid-request");
  assert.deepEqual(malformed.stats, { reads: 2, cancels: 0, releases: 1 });

  const overflow = streamedPost([new Uint8Array(8192), Uint8Array.of(0x20)], { cancelError: true });
  const overflowHarness = harness();
  await assertJsonResponse(await overflowHarness.handler(overflow.request), 413, "payload-too-large");
  assert.deepEqual(overflow.stats, { reads: 2, cancels: 1, releases: 1 });
  assert.equal(overflowHarness.calls.some((call) => call[0] === "now" || call[0] === "random" || call[0] === "store"), false);

  const failed = streamedPost([], { readError: true });
  const failedHarness = harness();
  await assertJsonResponse(await failedHarness.handler(failed.request), 400, "invalid-request");
  assert.deepEqual(failed.stats, { reads: 1, cancels: 0, releases: 1 });
  assert.equal(failedHarness.calls.some((call) => call[0] === "now" || call[0] === "random" || call[0] === "store"), false);
}

assert.throws(() => mod.createEventsHandler(Object.create(null)));
assert.throws(() => mod.createEventsHandler({ unknownFn() {} }));
{
  let trapCalls = 0;
  const hostile = new Proxy({}, { ownKeys() { trapCalls++; throw new Error("hostile"); } });
  assert.throws(() => mod.assertEvent(hostile, "events/4b7d2a/2026-09/1788452365123-4f2a9c.json"));
  assert.equal(trapCalls, 1);
}
{
  let writes = 0;
  const store = { async setJSON() { writes++; return { modified: true }; } };
  const input = { store, docId: "4b7d2a", actor, kind: "comment.create", target, docVersion: "7aaca51", summary: "commented on Architecture" };
  await assert.rejects(mod.appendEvent(input, { nowMs: Number.NaN, randomBytesFn: () => Uint8Array.of(1, 2, 3) }));
  await assert.rejects(mod.appendEvent(input, { nowMs: 1788452365123, randomBytesFn: () => Uint8Array.of(1, 2) }));
  assert.equal(writes, 0);
}

{
  const h = harness();
  const expectedEvents = [];
  for (let i = 0; i < 3; i++) {
    const ms = 1788452365123 + i;
    const id = `${ms}-00000${i}`;
    const ts = new Date(ms).toISOString();
    const event = { v: 1, id, docId: "4b7d2a", ts, actor, kind: "comment.create", target, docVersion: "7aaca51", summary: `comment ${i}` };
    expectedEvents.push(event);
    h.records.set(`events/4b7d2a/2026-09/${id}.json`, event);
  }
  let response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09&limit=2"));
  await assertJsonResponse(response, 200);
  let page = await response.json();
  assert.deepEqual(Object.keys(page), ["v", "docId", "month", "events", "nextAfter"]);
  assert.deepEqual(page, { v: 1, docId: "4b7d2a", month: "2026-09", events: expectedEvents.slice(0, 2), nextAfter: "1788452365124-000001" });
  response = await h.handler(makeReq("GET", `?doc=4b7d2a&month=2026-09&limit=2&after=${page.nextAfter}`));
  await assertJsonResponse(response, 200);
  page = await response.json();
  assert.deepEqual(page, { v: 1, docId: "4b7d2a", month: "2026-09", events: expectedEvents.slice(2), nextAfter: null });
  assert.deepEqual(h.calls.find((call) => call[0] === "list")[1], { prefix: "events/4b7d2a/2026-09/", paginate: true });
}

function boundedListing(extraPage) {
  const h = harness();
  const prefix = "events/4b7d2a/2026-09/";
  let pulls = 0;
  const keyAt = (index) => `${prefix}${1788452365123 + index}-000000.json`;
  h.store.list = (options) => {
    h.calls.push(["list", options]);
    let page = 0;
    return { [Symbol.asyncIterator]() { return {
      async next() {
        pulls += 1;
        if (page < 10) {
          const start = page * 1000; page += 1;
          return { done: false, value: { blobs: Array.from({ length: 1000 }, (_, offset) => ({ key: keyAt(start + offset) })), directories: [] } };
        }
        if (page === 10 && extraPage) { page += 1; return { done: false, value: { blobs: [{ key: keyAt(10_000) }], directories: [] } }; }
        return { done: true, value: undefined };
      },
      async return() { return { done: true, value: undefined }; },
    }; } };
  };
  h.store.get = async (key, options) => {
    h.calls.push(["get", key, options]);
    const id = key.slice(prefix.length, -".json".length);
    const ms = Number(id.slice(0, 13));
    return { v: 1, id, docId: "4b7d2a", ts: new Date(ms).toISOString(), actor, kind: "comment.create", target, docVersion: "7aaca51", summary: "bounded listing" };
  };
  return { h, pulls: () => pulls };
}
{
  const bounded = boundedListing(false);
  const response = await bounded.h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09&limit=1"));
  await assertJsonResponse(response, 200);
  const page = await response.json();
  assert.deepEqual(page.events.map((event) => event.id), ["1788452365123-000000"]);
  assert.equal(page.nextAfter, "1788452365123-000000");
  assert.equal(bounded.pulls(), 11);
  assert.equal(bounded.h.calls.filter((call) => call[0] === "list").length, 1);
  assert.equal(bounded.h.calls.filter((call) => call[0] === "get").length, 2);
}
{
  const overflow = boundedListing(true);
  await assertJsonResponse(await overflow.h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09&limit=1")), 503, "state-unavailable");
  assert.equal(overflow.pulls(), 11);
  assert.equal(overflow.h.calls.some((call) => call[0] === "get"), false);
}

{
  const h = harness({ capability: { canSeeMembers: false } });
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  assert.equal(response.status, 403); assert.equal(h.calls.some((call) => call[0] === "list"), false);
}
{
  const h = harness({ async identifyFn() { return null; } });
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  assert.equal(response.status, 401); assert.equal(h.calls.some((call) => call[0] === "role" || call[0] === "list"), false);
}
{
  const h = harness({ async resolveRoleFn() { return { role: "viewer", canSeeMembers: "yes" }; } });
  assert.equal((await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))).status, 500);
}
{
  const h = harness(); h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: [{ key: "events/4b7d2a/2026-09/not-an-id.json" }], directories: [] }; } });
  assert.equal((await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))).status, 500);
}
{
  const h = harness(); const key = "events/4b7d2a/2026-09/1788452365123-4f2a9c.json";
  h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: [{ key }, { key }], directories: [] }; } });
  assert.equal((await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))).status, 500);
}
{
  const h = harness(); const key = "events/4b7d2a/2026-09/1788452365123-4f2a9c.json";
  h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: [{ key }], directories: [] }; } }); h.store.get = async () => null;
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).events, []);
}
{
  const h = harness();
  const ids = ["1788452365123-000000", "1788452365124-000001", "1788452365125-000002"];
  const prefix = "events/4b7d2a/2026-09/", keys = ids.map((id) => `${prefix}${id}.json`);
  h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: keys.map((key) => ({ key })), directories: [] }; } });
  h.store.get = async (key, options) => {
    h.calls.push(["get", key, options]);
    if (key === keys[0]) return null;
    const id = key.slice(prefix.length, -".json".length), ms = Number(id.slice(0, 13));
    return { v: 1, id, docId: "4b7d2a", ts: new Date(ms).toISOString(), actor, kind: "comment.create", target, docVersion: "7aaca51", summary: "after retention race" };
  };
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09&limit=1"));
  await assertJsonResponse(response, 200);
  const page = await response.json();
  assert.deepEqual(page.events.map((event) => event.id), [ids[1]]); assert.equal(page.nextAfter, ids[1]);
  assert.equal(h.calls.filter((call) => call[0] === "get").length, 3);
}
{
  const h = harness(); const key = "events/4b7d2a/2026-09/1788452365123-4f2a9c.json";
  h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: [{ key }], directories: [] }; } }); h.store.get = async () => ({ v: 1, id: "wrong" });
  assert.equal((await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))).status, 500);
}
{
  const h = harness(); h.store.list = () => ({ async *[Symbol.asyncIterator]() { throw new Error("private list detail"); } });
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "state-unavailable" });
}
{
  const h = harness(); h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: null, directories: [] }; } });
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "state-unavailable" });
}
{
  const h = harness(); h.store.list = () => ({ async *[Symbol.asyncIterator]() { yield { blobs: [{ key: 17 }], directories: [] }; } });
  await assertJsonResponse(await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09")), 503, "state-unavailable");
}
{
  const h = harness(); h.store.list = () => ({});
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  await assertJsonResponse(response, 503, "state-unavailable");
  assert.equal(h.calls.some((call) => call[0] === "get"), false);
}

{
  let pulls = 0;
  const h = harness();
  h.store.list = (options) => {
    h.calls.push(["list", options]);
    return { async *[Symbol.asyncIterator]() {
      for (let page = 0; page < 11; page++) {
        pulls += 1;
        yield { blobs: [], directories: [] };
      }
    } };
  };
  const response = await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"));
  await assertJsonResponse(response, 503, "state-unavailable");
  assert.equal(pulls, 11);
}
{
  const h = harness();
  h.store.list = (options) => {
    h.calls.push(["list", options]);
    return { async *[Symbol.asyncIterator]() {
      yield { blobs: Array.from({ length: 1001 }, (_, index) => ({ key: `events/4b7d2a/2026-09/1788452${String(index).padStart(6, "0")}-000000.json` })), directories: [] };
    } };
  };
  await assertJsonResponse(await h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09")), 503, "state-unavailable");
  assert.equal(h.calls.some((call) => call[0] === "get"), false);
}

for (const query of [
  "?doc=4b7d2a", "?doc=4b7d2a&month=2026-13", "?doc=4b7d2a&month=2026-09&limit=01",
  "?doc=4b7d2a&month=2026-09&after=1785773965123-4f2a9c", "?doc=4b7d2a&month=2026-09&x=1",
]) {
  const h = harness(); const response = await h.handler(makeReq("GET", query)); assert.equal(response.status, 400);
}

{
  const h = harness();
  const response = await h.handler(makeReq("DELETE", "?doc=4b7d2a"));
  await assertJsonResponse(response, 405, "method-not-allowed");
}

{
  const cases = [
    [400, "invalid-request", () => harness().handler(makeReq("GET", "?doc=4b7d2a"))],
    [401, "unauthenticated", () => harness({ async identifyFn() { return null; } }).handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))],
    [403, "forbidden", () => harness({ capability: { canSeeMembers: false } }).handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))],
    [409, "event-id-collision", () => { const h = harness(); h.store.setJSON = async () => ({ modified: false }); return h.handler(makeReq("POST", "?doc=4b7d2a", baseBody)); }],
    [413, "payload-too-large", () => harness().handler(new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers, body: `{"x":"${"x".repeat(8200)}"}` }))],
    [415, "unsupported-media-type", () => harness().handler(new Request("https://docs.example.invalid/api/events?doc=4b7d2a", { method: "POST", headers: { Origin: "https://docs.example.invalid", "Content-Type": "text/plain" }, body: "{}" }))],
    [500, "internal-error", () => harness({ async resolveRoleFn() { return { role: "viewer", canSeeMembers: "yes" }; } }).handler(makeReq("GET", "?doc=4b7d2a&month=2026-09"))],
    [503, "state-unavailable", () => { const h = harness(); h.store.list = () => ({ async *[Symbol.asyncIterator]() { throw new Error("private"); } }); return h.handler(makeReq("GET", "?doc=4b7d2a&month=2026-09")); }],
  ];
  for (const [status, code, invoke] of cases) await assertJsonResponse(await invoke(), status, code);
}

process.stdout.write("PASS  P3-B events API\n");
P3B_NODE

set +e
P3B_SOURCE="$PWD/netlify/functions/events.mjs" P3B_TYPESCRIPT="$PWD/templates/docbuild/node_modules/typescript/lib/typescript.js" P3B_TEST="$P3B_ROOT/test.mjs" node --input-type=module <<'P3B_SUPERVISOR'
import { spawn } from "node:child_process";
const file = process.env.P3B_TEST;
const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
let firstSignal = null;
let timedOut = false;
let killTimer;
let outputOverflow = false;
const captured = { stdout: [], stderr: [] };
const sizes = { stdout: 0, stderr: 0 };
for (const name of ["stdout", "stderr"]) child[name].on("data", (chunk) => {
  sizes[name] += chunk.byteLength;
  if (sizes[name] > 4096) { outputOverflow = true; child.kill("SIGTERM"); return; }
  captured[name].push(chunk);
});
const signalStatus = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {
  if (!firstSignal) firstSignal = signal;
  child.kill(signal);
  killTimer ||= setTimeout(() => child.kill("SIGKILL"), 2000);
});
const deadline = setTimeout(() => {
  timedOut = true; child.kill("SIGTERM"); killTimer ||= setTimeout(() => child.kill("SIGKILL"), 2000);
}, 30000);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
clearTimeout(deadline); if (killTimer) clearTimeout(killTimer);
if (firstSignal) process.exit(signalStatus[firstSignal]);
if (timedOut) process.exit(124);
if (result.signal) process.exit(signalStatus[result.signal] ?? 1);
if (outputOverflow || result.code !== 0) process.exit(result.code || 1);
const stdout = Buffer.concat(captured.stdout).toString("utf8");
const stderr = Buffer.concat(captured.stderr).toString("utf8");
if (stdout !== "PASS  P3-B events API\n" || stderr !== "") process.exit(1);
process.stdout.write(stdout);
P3B_SUPERVISOR
P3B_STATUS=$?
set -e
test "$P3B_SIGNAL_STATUS" -eq 0 || P3B_STATUS="$P3B_SIGNAL_STATUS"
cleanup_p3b || P3B_STATUS=1
test "$P3B_SIGNAL_STATUS" -eq 0 || P3B_STATUS="$P3B_SIGNAL_STATUS"
trap - EXIT HUP INT TERM
exit "$P3B_STATUS"
```

Expected: exit 0, stdout exactly `PASS  P3-B events API`, and no stderr. The supervisor captures stdout and stderr independently, kills the child if either exceeds 4,096 bytes, accepts only the exact declared stdout and empty stderr, and re-emits that one line only after the child closes successfully. The AST oracle parses the module with the repository-pinned TypeScript parser and proves the exact import modules/bindings, forbidden structural API surface—including direct or aliased access through the named global objects—and sole create-only write call; no regex is used as a JavaScript behavioral oracle. The runtime fixture covers all 16 kinds and paired capability denials; all six accepted `{email}`/`{sub}` variants across invite/change/revoke; one named representative of every declared missing/extra/type/grammar/length/relation/reserved-transient class for the body, aid, thread, comment, suggestion, access, transfer, document-version, and summary; the exact generated record/key and four-field-identity projection; origin and identity precedence; body/query/media bounds plus normal, parse-error, overflow-with-rejected-cancel, and read-error reader lifecycles; client-field rejection; dependency shape; hostile schema input; invalid time/random bytes; conditional-create collision and malformed outcomes; bounded manual month pagination/order, exact ten-page/10,000-key success with an eleventh exhaustion pull, rejection of a 10,001st key or even an empty eleventh page, non-iterable-list rejection, and provider-page-size rejection; denial before list; invalid access shape; malformed/duplicate/list-race/corrupt cases; provider rejection; method handling; the exact JSON headers/body for every 200/201/400/401/403/405/409/413/415/500/503 status; and private error bodies. This is a finite equivalence-class oracle, not a claim that a finite fixture literally enumerates every possible invalid string. A production change that passes by weakening or removing an assertion is not accepted.

### Repository gates

Run after the fixture passes:

```bash
set -euo pipefail

test "$(rg -n '^## ' docs/tickets/P3-B.md | wc -l | tr -d ' ')" = 12
test -z "$(rg -n '[[:blank:]]+$' docs/tickets/P3-B.md netlify/functions/events.mjs)"
templates/check-dist
templates/docbuild/node_modules/.bin/tsc --noEmit -p templates/docbuild/tsconfig.json

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3B_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
assert.match(base, /^[0-9a-f]{40,64}$/, "export P3B_BASE as the reviewed P2-G/P2-H predecessor commit");
const lines = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = new Set([...lines(["diff", "--name-only", `${base}...HEAD`]), ...lines(["diff", "--name-only"]), ...lines(["diff", "--cached", "--name-only"]), ...lines(["ls-files", "--others", "--exclude-standard"])]);
for (const file of [...changed]) if (file.startsWith("docs/tickets/")) changed.delete(file);
assert.deepEqual([...changed].sort(), ["netlify/functions/events.mjs"]);
console.log("PASS  P3-B owns only events.mjs");
NODE

issue_json="$(gh issue view 15 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-B.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-B — The events API" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-B issue #15 pointer integrity'
```

Expected: export `P3B_BASE` as the reviewed P2-G/P2-H predecessor commit, then every command exits 0. `check:dist` reports no generated drift, TypeScript reports no errors, the ownership oracle prints `PASS  P3-B owns only events.mjs`, and the final line is `PASS  P3-B issue #15 pointer integrity`. The issue retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document. No command may rewrite an owned or generated file.

## Failure modes

| Failure | Required behavior |
|---|---|
| Missing/null/foreign Origin or verifier failure on POST | Exact P1-C 403 before all other work. |
| Invalid/oversized JSON or client-supplied actor/generated field | 400/413 with no time, randomness, or write. |
| No session or insufficient capability | 401/403; no event-store operation. |
| `threadControl: "own"` on generic resolve/reopen POST | 403; only the authoritative thread handler can prove ownership. |
| Same millisecond and same three random bytes | One create can win; the loser returns 409 and never changes IDs. |
| Blob rejects or returns an ambiguous envelope | 503; no success fiction or overwrite. |
| List returns malformed/duplicate/out-of-prefix key | Entire GET returns 500, not a partial audit. |
| Listed event disappears under retention | Skip null and continue filling the bounded page. |
| Stored event is malformed or disagrees with its key | Entire GET returns 500; never repair or expose it. |
| Provider order differs | Explicit ASCII sort determines response order. |
| A fresh write is absent from an immediate list | POST response remains authoritative for that new UI row; GET makes no read-your-write claim. |
| State write succeeds and event append fails/crashes | State remains truth; report append failure where possible and do not roll state back. |
| Presence/realtime input | Unknown kind 400; no blob. |
| Hostile thrown object/error | Descriptor-safe classification falls back to generic 500 without invoking user code. |
| Test fixture hangs | Supervisor sends TERM, escalates to KILL, awaits direct-child close, and exits 124; cleanup starts only after reaping. |

## Settled decisions

- One event equals one immutable Blob object. There is no folded log blob and no overwrite path.
- The exact key is built by P2-B; the ID's millisecond prefix and the event timestamp are one sampled instant.
- Cryptographic random bytes provide the six-hex suffix. A create collision is a bug/rare collision, not ordinary contention, and is never hidden by retry.
- Actor identity is server-derived. Client identity, role, capability, and generated fields are invalid input.
- GET audit visibility uses `canSeeMembers`; POST uses the capability relevant to the declared kind. Identity classification alone grants nothing.
- Events are audit facts, not feature state. Authoritative feature writers mutate state first and append second.
- The HTTP POST can attest only the actor, capability, and appended payload; it cannot prove another endpoint's state transition. High-integrity domain events are appended by the authoritative server handler after that handler's checks.
- GET lists one exact month, sorts locally by key, and paginates with an exclusive event-ID cursor. It never exposes a provider cursor or scans all months.
- POST returns its created event directly. No correctness claim depends on immediate list visibility.
- Access-target email is necessary audit data, but it appears only inside the event body. Keys, metadata, logs, summaries, and errors contain no email.
- There is no event for invitation-to-grant conversion, heartbeat, presence, or realtime transport.
- P4-F owns deletion after 18 months; P4-T owns later durable-kind exclusions. P3-B neither deletes nor silently drops valid stored kinds.

## Assumptions and open questions

The following are closed implementation assumptions, not choices left to the implementer:

- The deployed predecessor set is P2-H's final four-field identity plus P2-G authorization, even though the original Phase 3 row named only P1-C/P2-B. Implementing against temporary P1-C capability fields is unsafe and forbidden.
- Netlify Blobs manual `list({ paginate: true })` iteration is used because the official API documents pages of at most 1,000 entries. The public API still exposes only its own event-ID cursor; the provider iterator is consumed under the exact ten-page/10,000-key ceiling and never leaks into the response.
- Store-level strong consistency does not create a documented immediate-list guarantee. The POST response, not a relist, supplies the newly created event to its caller.
- The server clock may move backward. Pagination is a live ordered view, so clients that need reconciliation re-read the month from the beginning; P3-B does not add a sequence counter or mutable head blob.
- An audit summary is display text, not HTML. A later UI that interprets it as markup violates this contract.

No product or implementation question remains open for P3-B. Any desired snapshot pagination, state/event transaction, richer target schema, unauthenticated audit view, broader audit audience, alternate ID, or provider cursor is a new design decision and a follow-up ticket.

## References

- `docs/research/00-integration-plan.md` §§1.1, 2.1, 2.4, 4.5–4.6, and contradiction 16 — ruling identity, append-only layout, event schema, phase ownership, retention, and state-writer decision.
- `docs/research/03-state-storage.md` — Blob tradeoffs and one-record-per-key storage rationale; superseded where the ruling plan differs.
- `docs/research/04-comments-and-discussion.md` — thread state is authoritative and owns thread actions.
- `docs/research/06-history.md` §6 — history/event rationale; superseded by the ruling plan's audit-not-fold decision and schema.
- `docs/research/09-sharing-and-roles.md` §§8–9 — access event meanings, email privacy, and server capability enforcement.
- `docs/tickets/P1-C.md` — Functions v2 and exact origin boundary.
- `docs/tickets/P2-B.md` — strong store, JSON/version boundary, event prefix/key, errors, and `onlyIfNew` convention.
- `docs/tickets/P2-H.md` — final server identity projection.
- `docs/tickets/P2-G.md` — role resolution, capabilities, email/subject validation, and error boundary.
- [Netlify Blobs API](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — official `setJSON`, `get`, prefix, conditional-create, and manual `list({ paginate: true })` pages of at most 1,000 entries; checked 2026-09-03.
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/) — official Request/Response handler and route configuration surface; checked 2026-09-03.
- [Node.js `crypto.randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback) — official cryptographic-byte API; checked 2026-09-03.
- GitHub issue #15 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
