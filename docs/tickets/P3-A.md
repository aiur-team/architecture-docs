# P3-A — The threads API

## Outcome

The repository has two authenticated Netlify Functions v2 endpoints that list and create document threads, append replies, and resolve or reopen a thread without losing concurrent updates. The endpoints persist the ruling version-1 thread shape in the site-wide `doc-state` store, return stable private JSON responses, derive every actor from the verified server identity, authorize every list read through P2-G, and leave mutation-role enforcement for P4-M.

## Context

Threads are the mutable discussion record for one permanent document ID. One thread and all of its shallow replies live at `threads/<docId>/<threadId>.json`; separate threads never contend, while two simultaneous replies to the same thread are serialized by P2-B's six-attempt compare-and-swap loop.

P1-C supplies Functions v2, `identify(req)`, and `requireOrigin(req)`. P2-H later narrows the verified identity to `{ sub, email, name, isOrg }`; P3-A stores only the three-field actor projection and never reads roles or client claims. P2-B supplies the strong `doc-state` store, key builders, version gate, reads, and mutation helper. P2-G supplies the existing non-consuming document-role resolver used here only to protect the actor-bearing list response. The ruling plan deliberately leaves `list()` consistency unverified, so a successful write response is constructed from the committed record and never from an immediate list refresh.

This ticket owns the read-authorization boundary but is not the final mutation-authorization boundary. P3-A imports P2-G only in `threads.mjs`, resolves `canRead` for `GET`, and fails closed before opening thread storage. P4-M later amends these same two files to apply `canComment` and thread-control enforcement to mutations. P3-A must make that amendment small and explicit without interpreting `isOrg` or inventing an interim mutation-role policy.

## Scope

### In scope

- Create `netlify/functions/threads.mjs` for `GET /api/threads` and `POST /api/threads`.
- Create `netlify/functions/thread.mjs` for `POST /api/threads/:doc/:id` and `PATCH /api/threads/:doc/:id`.
- Authenticate every supported request through P1-C/P2-H `identify(req)`, authorize `GET` through P2-G's non-consuming `resolveRole()`/exact `canRead` result before thread storage, and require P1-C `requireOrigin(req)` before identity, parsing, or storage for each supported mutation.
- Validate exact query, path, JSON-body, actor, anchor, comment, thread, and response shapes without repairing or truncating input or stored records.
- List thread keys by the P2-B prefix, strongly read the selected records, validate key/body agreement, sort deterministically, and expose bounded keyset pagination.
- Create a thread with its first comment through one guarded create-only write.
- Append a reply and change thread status only through P2-B `mutate()`, with every retry callback pure and synchronous.
- Specify stable status, header, public error, collision, CAS, request-replay, and eventual-list behavior.
- Provide source-bound deterministic acceptance coverage, including two simultaneous replies that both land exactly once.

### Out of scope

- Mutation-role or capability enforcement, `canComment`, `threadControl`, invitation conversion, or mutation document-access 403s. P4-M owns that write enforcement amendment after P3-A; P3-J separately owns the HTML read gate. P3-A's only role decision is the exact P2-G `canRead` result for `GET /api/threads`.
- Editing an existing comment. `PATCH` changes only the thread status; `editedAt` remains part of the persisted schema for forward compatibility, but P3-A never changes it.
- Deleting a thread or comment, nested replies, reactions, mentions, assignments, unread state, subscriptions, cross-document queries, full-text search, per-user indexes, or stored anchor-resolution state.
- The comment client, write controls, highlighting, margin rail, panel, refresh behavior, or local drafts. P3-C and P4-A own those surfaces.
- Creating or changing the event API, notifications, realtime fan-out, retention, access records, the store helper, identity helper, package manifest, Netlify configuration, or a permanent test file.
- Trusting a slug, instance name, path, body/query/header author, role, capability, timestamp, ID, status metadata, or ETag supplied by the client.

## Interface contract

### Runtime surfaces and routing

Both files are ECMAScript modules using Fetch-style Functions v2 handlers. Their only runtime exports are the default handler and `config`; there is no Lambda-v1 `handler` export and no default object wrapper.

```js
// netlify/functions/threads.mjs
export default async function handler(req, context) { /* contract below */ }
export const config = { path: "/api/threads" };
```

```js
// netlify/functions/thread.mjs
export default async function handler(req, context) { /* contract below */ }
export const config = { path: "/api/threads/:doc/:id" };
```

`threads.mjs` statically imports `identify`/`requireOrigin` from `../lib/identity.mjs`, the named P2-B surfaces it uses from `../lib/store.mjs`, and exactly `capabilitiesFor`/`resolveRole` from `../lib/access.mjs`. `thread.mjs` imports only its required identity and store surfaces; it must not import `access.mjs` until P4-M. Neither file imports provider packages directly.

The handlers enforce methods themselves so every unsupported method has the same response instead of depending on platform routing:

| Endpoint | Method | Operation | Origin check | Identity | Success |
|---|---|---|---|---|---:|
| `/api/threads?doc=<docId>&limit=<n>&cursor=<threadId>` | `GET` | List one page | none | required | `200` |
| `/api/threads?doc=<docId>` | `POST` | Create thread and first comment | first supported-request operation | required after origin | `201` |
| `/api/threads/:doc/:id` | `POST` | Append one reply | first supported-request operation | required after origin | `200` |
| `/api/threads/:doc/:id` | `PATCH` | Resolve or reopen | first supported-request operation | required after origin | `200` |

For a supported mutation, the first executable request-dependent operation is `requireOrigin(req)`. Catch a thrown `Response` only at the handler boundary and return the same object unchanged. Do not inspect the URL, path parameters, headers other than through `requireOrigin`, body, identity, clock, random source, access, or store before that call. Call `identify(req)` exactly once only after origin succeeds. For `GET`, do not call `requireOrigin`; call `identify(req)` before parsing query values, then validate the complete query and identity, call the exact read-authorization seam below, and only then call `docState()` or any list/read surface. For an unsupported method, return `405` before origin, identity, URL parsing, access, or storage. This resolves the Build Order shorthand “requireOrigin then identify” under P1-C's ruling that only supported mutating requests invoke the origin guard.

Never call `getUser()`, `verifyRequestOrigin()`, or read `context.clientContext`, cookies, JWTs, Identity metadata, request author fields, or provider roles directly. Validate a non-null identity's `sub`, `name`, and `email` against the actor scalar contract before any access/clock/random/store work; an impossible malformed server identity is `500 invalid-state`, not a client error. Pass the verified identity object unchanged to `resolveRole`; never interpret `isOrg` as permission. Project it separately to a fresh actor with exactly `{ sub, name, email }`; never persist or return `isOrg`.

### Common HTTP responses

Every response except P1-C's returned origin failure has `Cache-Control: private, no-store`. Every JSON response has `Content-Type: application/json; charset=utf-8`. Successful JSON is serialized from a newly constructed plain object; it never includes an ETag, provider result, storage key, stack, cause, raw Identity value, capability, or `isOrg`.

Public errors have exactly two string fields:

```json
{
  "error": {
    "code": "invalid-body",
    "message": "Invalid request body"
  }
}
```

The complete public error table is:

| Condition | Status | Code | Message | Extra header |
|---|---:|---|---|---|
| Unsupported method on `threads.mjs` | `405` | `method-not-allowed` | `Method not allowed` | `Allow: GET, POST` |
| Unsupported method on `thread.mjs` | `405` | `method-not-allowed` | `Method not allowed` | `Allow: POST, PATCH` |
| `identify(req)` returns `null` | `401` | `unauthenticated` | `Authentication required` | — |
| Valid list request whose validated access result has `canRead: false` | `403` | `forbidden` | `Document access denied` | — |
| Invalid/duplicate/unknown query or invalid path parameter | `400` | `invalid-request` | `Invalid request` | — |
| Missing or unsupported JSON media type | `415` | `unsupported-media-type` | `Content-Type must be application/json` | — |
| Request body exceeds 65,536 UTF-8 bytes | `413` | `payload-too-large` | `Request body exceeds 65536 bytes` | — |
| Malformed JSON, non-object JSON, wrong keys/types/values, or a field limit violation | `400` | `invalid-body` | `Invalid request body` | — |
| Thread is absent at a strongly read listed/path key | `404` | `not-found` | `Thread not found` | — |
| Six P2-B conditional writes lose a race | `409` | `conflict` | `Concurrent update limit reached` | — |
| A generated create key already exists | `409` | `id-collision` | `Generated identifier collision` | — |
| A valid reply targets a thread that already has 500 comments | `409` | `comment-limit` | `Thread comment limit reached` | — |
| Invalid/corrupt/unsupported stored thread or key/body mismatch | `500` | `invalid-state` | `Invalid thread state` | — |
| Store/list/read/write operation is unavailable, returns an indeterminate direct-write envelope, or exceeds the bounded list-work ceiling | `503` | `unavailable` | `Thread store unavailable` | — |

P1-C origin failure is the sole exception: return its exact thrown `403` response with body `Bad origin` and `Content-Type: text/plain; charset=utf-8`; do not wrap it or add information. Errors contain no rejected value, document/thread ID, body, actor, email, key, ETag, origin, provider text, or cause. These two handlers emit no server log output; operational logging belongs to the platform/store boundary rather than this actor-bearing payload boundary.

Map P2-B `StoreError("conflict", ...)` to the documented 409, `invalid-record`/`unsupported-version` to the documented 500, and `unavailable` to the documented 503. A `resolveRole()` rejection maps to the same 503 only when it is a non-null non-array object with own data properties whose values are exactly `name === "StoreError"`, `code === "unavailable"`, and `status === 503`; inherited fields, accessors, or any wrong value/type are not the safe classification. Every other access rejection or malformed result maps to `500 invalid-state`. An `invalid-key` escaping after the endpoint's own validation is an implementation defect and maps to `500 invalid-state`, not a reflected client value. Unknown exceptions map to `500 invalid-state`. Never serialize a `StoreError`, access result, or cause.

### Request grammar

All comparisons are exact; there is no trimming, lowercasing, coercion, defaulting of supplied values, or silent truncation. String lengths are JavaScript UTF-16 code units, matching JavaScript offsets used by the shared anchor normalizer.

- `docId` is exactly `^[0-9a-f]{6}$` and is always the permanent `doc.json` ID.
- `threadId` is exactly `^t_[a-z0-9]{1,48}_[0-9a-f]{8}$`; its middle component is one through 48 lower-case base-36 characters.
- `section` is exactly `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`; length is 1 through 64.
- `docVersion` is exactly seven lower-case hexadecimal characters, the baked history `head` short SHA.
- `body` is a string of 1 through 8,000 code units after requiring `body.trim().length > 0`. Store the original string unchanged; leading/trailing whitespace is not silently removed.
- A JSON media type is accepted only when the parsed media type is case-insensitively `application/json`, optionally followed by syntactically valid parameters. Missing, empty, or another media type returns 415 before reading the body.
- Every supported mutation body is bounded by `MAX_REQUEST_BYTES = 65_536` UTF-8 bytes before `JSON.parse()`. After the media-type check, if `Content-Length` is present it must be the canonical ASCII decimal spelling of a nonnegative safe integer (`0` or a nonzero digit followed by digits, with no sign, padding, comma, whitespace, or exponent). A malformed value is `400 invalid-body`; a value above 65,536 is `413 payload-too-large` without touching `req.body`.
- Otherwise require an unlocked non-null `req.body`, acquire exactly one reader, and accept only `Uint8Array` chunks. Accumulate at most 65,536 bytes. A chunk that would cross the ceiling requests reader cancellation exactly once before completion, ignores a cancellation rejection, releases the lock exactly once, and returns exact 413 without decoding or parsing. A missing/locked body, wrong chunk type, or read rejection requests the same best-effort cancellation when possible, releases exactly once, and returns `400 invalid-body`. On complete input, release exactly once, decode the bounded bytes once with fatal UTF-8, and call `JSON.parse()` exactly once; fatal decode or parse failure is `400 invalid-body`. Do not use `req.json()`, `req.text()`, `Response` wrapping, an unbounded convenience body method, or a second reader.
- Parsed request JSON must be a non-null, non-array ordinary object. A parsed `__proto__` member is an ordinary unknown own key and is rejected; do not merge request objects into defaults.
- Top-level `author`, `email`, and `name` are reserved impersonation fields. They may be present with any JSON value solely so the required hostile-client check can prove they are ignored; never read or copy them. They remain inside the 65,536-byte request envelope. Every other key not explicitly allowed for that operation is rejected.

`GET /api/threads` accepts exactly one `doc`; optional `limit` and `cursor` may each occur at most once. No other query name is accepted. `limit` is an ASCII base-10 canonical integer string (`"1"`, not `"01"`, `"+1"`, or whitespace) from 1 through 100 and defaults to 50. `cursor`, when present, is a valid thread ID and is exclusive. A URL with duplicate parameters, a blank value, or an unknown query name returns 400. `POST /api/threads` accepts exactly one `doc` and no other query parameter.

For `thread.mjs`, use only `context.params.doc` and `context.params.id`. Both must be own string properties matching the grammars above. Missing, array, decoded-slash, query fallback, or extra path content is invalid. Query parameters on the single-thread route are not part of the contract and any present query name returns 400.

The create body has these operation keys plus the three ignored impersonation keys:

```ts
type CommentThreadInput = {
  kind: "comment";
  section: string;
  anchor: Anchor;
  docVersion: string;
  body: string;
  title?: null;
  author?: unknown;
  email?: unknown;
  name?: unknown;
};

type DiscussionThreadInput = {
  kind: "discussion";
  section: string;
  anchor?: null;
  title: string;
  docVersion: string;
  body: string;
  author?: unknown;
  email?: unknown;
  name?: unknown;
};
```

An anchored comment requires `title` absent or `null` and this exact anchor object with no extra or symbol-relevant data after JSON parsing:

```js
const anchor = {
  block: "a3f19c2b7",               // ^a[0-9a-f]{8}$
  exact: "a cache miss stays local", // normalized, 1..1000 code units
  prefix: "The contract says ",      // normalized, 0..32 code units
  suffix: ". That boundary matters", // normalized, 0..32 code units
  start: 91                           // non-negative safe integer
};
```

For `exact`, “normalized” means exact equality with `value.replace(/\s+/g, " ").trim()`. A prefix/suffix is a slice of that normalized block and may therefore retain one boundary space; it may contain only non-whitespace characters and single U+0020 spaces, with no two consecutive spaces. Empty prefix/suffix are valid; empty `exact` is not. A discussion requires a non-blank `title` of at most 200 code units and requires `anchor` absent or `null`. The server stores the original valid title unchanged. Both kinds require `section`, `docVersion`, and `body`.

The reply body has exactly `body` plus the optional ignored impersonation keys. The status body has exactly `status`, whose value is `"resolved"` or `"open"`, plus the optional ignored impersonation keys. A body that combines `status` and `body`, supplies client IDs/timestamps/comments/resolution fields, or contains any other key is invalid.

### Version-1 persisted schema

The authoritative stored thread is a P2-B version-1 JSON-safe ordinary record with exactly these own fields:

```json
{
  "v": 1,
  "id": "t_m8x2k1_4f7a9c31",
  "docId": "4b7d2a",
  "kind": "comment",
  "status": "open",
  "section": "architecture",
  "anchor": {
    "block": "a3f19c2b7",
    "exact": "a cache miss stays local",
    "prefix": "The contract says ",
    "suffix": ". That boundary matters",
    "start": 91
  },
  "title": null,
  "docVersion": "7aaca51",
  "createdAt": "2026-09-03T16:04:11.221Z",
  "author": {
    "sub": "u_demo_931",
    "name": "Avery Quill",
    "email": "avery@example.com"
  },
  "resolvedAt": null,
  "resolvedBy": null,
  "comments": [
    {
      "id": "c_m8x2k1_1a2b3c4d",
      "body": "Could the retry boundary be stated here?",
      "author": {
        "sub": "u_demo_931",
        "name": "Avery Quill",
        "email": "avery@example.com"
      },
      "createdAt": "2026-09-03T16:04:11.221Z",
      "editedAt": null
    }
  ]
}
```

Validation is fail closed before a listed record is returned and on every mutation attempt:

- Call P2-B `upgrade()` first. Require exactly the 14 top-level keys shown, no symbols/accessors/custom prototype after storage decoding, and no added `updatedAt`, `buildRev`, `resolved`, `deleted`, or anchor-state field.
- `id`, `docId`, `section`, `docVersion`, anchor, title, and bodies follow the request grammar. `kind: "comment"` requires the exact anchor and `title: null`; `kind: "discussion"` requires `anchor: null` and a non-blank title of at most 200 code units.
- An actor has exactly `sub`, `name`, and `email`, all strings. `sub` matches P2-G's stable identity-subject grammar `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`. `name` is at most 200 code units. `email` is either empty or already ASCII-trimmed/lower-case and satisfies P2-G's 254-character ASCII mailbox grammar: one 1-to-64-character local part, exactly one `@`, and at least two valid DNS labels. Stored actor fields are snapshots and are not re-derived during a read. P3-A implements this as private record/identity validation and does not import the P2-G authorization module early.
- Every timestamp is an exact real UTC ISO string with milliseconds: it matches `YYYY-MM-DDTHH:mm:ss.sssZ` and `new Date(value).toISOString() === value`.
- `comments` is a non-empty dense array with 1 through exactly 500 entries. Every comment has exactly `id`, `body`, `author`, `createdAt`, `editedAt`. Its ID matches `^c_[a-z0-9]{1,48}_[0-9a-f]{8}$`; the middle component is one through 48 lower-case base-36 characters, IDs are unique within the thread, and `editedAt` is `null` or a valid timestamp, though P3-A only creates `null`.
- The first comment's `author` fields and `createdAt` equal the top-level `author` fields and `createdAt`. This makes the thread creator unambiguous.
- `status: "open"` requires both `resolvedAt` and `resolvedBy` to be `null`. `status: "resolved"` requires a valid `resolvedAt` and exact actor `resolvedBy`.
- The storage key's parsed document and thread IDs must exactly equal record `docId` and `id`. A valid-looking record under the wrong key is corrupt state.

The API returns thread objects with exactly the persisted shape. It does not add ETags, storage keys, computed anchor states, capabilities, list ranks, or client-only fields.

### Identifiers, clocks, actors, and retry purity

For one accepted mutation, validate origin, identity, route/query, media type, and complete body before sampling time, randomness, or storage. Then sample one operation millisecond value and one operation timestamp:

```js
const operationMs = Date.now();
const operationTime = new Date(operationMs).toISOString();
```

Require `operationTime` to be the exact millisecond UTC form and `String(operationMs)` to have 13 ASCII digits; an impossible runtime clock result fails with `500 invalid-state` before a write. Use `operationTime` for every timestamp created by that request.

Create a thread ID exactly as ruled:

```js
const threadId = `t_${operationMs.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
```

Create a comment ID exactly as follows, with a separate UUID sample from the thread-ID sample when both are needed:

```js
const commentId = `c_${operationMs.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
```

Require each UUID result to match the canonical lower-case UUID grammar before slicing; never accept an ID from the request. Create the actor once from the verified identity. All generated IDs, actor snapshots, timestamps, validated input strings, and intended status are immutable request-scoped values captured outside `mutate()`.

The `mutate()` callback is synchronous, reads no request, clock, random source, identity, store, environment, or network, performs no event/notification/logging side effect, and validates the fresh draft before changing it. It returns one complete valid thread or `null` for a status no-op. Because P2-B may call it six times, it appends the same captured reply exactly once to each fresh candidate draft; only one candidate commits.

### `GET /api/threads`

After authentication and complete query validation, call exactly `await resolveRole(docId, identity, { consumeInvitation: false })`. This is P3-A's only authorization call. It must happen before `docState()`, `threadPrefix()`, `store.list()`, or `read()`, and it is repeated for every GET; do not cache it, infer from `isOrg`, use a URL/body role, or consume an invitation. P2-G may perform only its already-owned idempotent one-time configured-owner capture for an unbound document; P3-A performs no direct access-state write.

Validate the result before reading `canRead`. It must be a plain object with exactly the ten own enumerable data properties `role`, `shared`, `canRead`, `canComment`, `threadControl`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers`, no symbols/accessors/extra or inherited fields, and prototype exactly `Object.prototype`. `role` is exactly one of `owner|editor|commenter|viewer|none`; `shared` and every `can*` field are booleans; `threadControl` is `any|own|none`; and every capability equals the exact row returned by `capabilitiesFor(role)`. If validation or `capabilitiesFor()` throws, return `500 invalid-state` without opening thread storage. If and only if the validated `canRead` is false, return exact `403 forbidden` without opening thread storage. A safely classified unavailable rejection returns `503 unavailable`; any other rejection returns `500 invalid-state`. These failures reveal no role, identity, document ID, access state, or provider detail.

Only after `canRead === true`, call `docState()` once and create exactly one manual iterator from `store.list({ prefix: threadPrefix(docId), paginate: true })`. This is P3-A's only direct list use; P2-B intentionally exposes no generic list wrapper. Netlify documents that each provider page contains at most 1,000 entries. Accept at most `MAX_PROVIDER_PAGES = 10` data pages and `MAX_LISTED_KEYS = 10_000` listed entries. Validate every accepted page as a non-null, non-array ordinary object with an own enumerable data-property `blobs` whose value is a dense array of at most 1,000 entries. Each entry is a non-null, non-array ordinary object with an own enumerable data-property `key` whose value is a string of at most 96 UTF-8 bytes; ignore provider ETags and other entry/page metadata without reading them. A malformed iterator result/page/entry envelope, accessor, symbol, sparse/extra array property, missing/non-string/overlong key value, non-iterable result, or page above 1,000 entries is a provider-shape failure and maps to `503 unavailable`. After that envelope validation, require the key string to equal exactly `threadKey(docId, parsedThreadId)`; a wrong-prefix, malformed-ID, key-reconstruction mismatch, or duplicate key across any page is corrupt internal data and maps to `500 invalid-state`.

Drive the iterator explicitly with at most eleven `next()` calls: ten accepted data pages plus one exhaustion probe. If the first ten results are data pages, call `next()` once more without reading a returned page value; `done: true` proves exhaustion, while `done: false`, a malformed iterator result, more than 10,000 accepted keys, or a throw closes the iterator best-effort and returns exact `503 unavailable`. Never fetch a twelfth page or inspect an eleventh page's blobs. A result is valid only when it is a non-null ordinary object with own data properties `done` and, when `done === false`, `value`; `done` must be boolean. Empty data pages are allowed and count toward ten. Call iterator `return()` at most once on early failure when it exists, ignore only its rejection, and retain no provider page after projecting its validated keys. This bounds one GET to eleven provider pulls, ten page validations, and 10,000 key validations without imposing a global write-time thread cap.

After proved exhaustion, sort all unique parsed thread IDs by ascending JavaScript string comparison and discard IDs less than or equal to the exclusive cursor. Walk remaining keys in that order through P2-B `read(store, key)`, without reading more keys once the response boundary is known. A read miss is skipped because a stale list/delete race is possible; a hit is fully validated against its key. Add a live record only when both `threads.length < limit` and `totalComments + record.comments.length <= 5_000`. Because every valid thread has 1–500 comments, the first live record after the cursor always qualifies. Stop before the first live record that would cross 5,000 comments, or immediately after reaching `limit`; do not advance the public cursor past a live record not returned. If stopped with a known remaining candidate, `nextCursor` is the final returned thread ID. If all candidates were examined, it is `null`. Stale misses before the final returned ID are safely advanced; a stale-only exhausted suffix yields `null` on the next page rather than trapping the client. Thus every response contains at most the requested thread count and at most 5,000 comments, contains at least one thread whenever any valid live candidate exists after the cursor, is structurally finite, and preserves exclusive keyset traversal without sampling or omission.

A non-null `nextCursor` does not imply `threads.length === limit`. The 5,000-comment response budget can stop a page after any positive number of returned threads; in that case `nextCursor` is still the final returned thread ID and the next request resumes exclusively after it. A consumer requesting `limit=100` must therefore accept any `threads.length` from 1 through 100 with a non-null cursor, while an empty page can only have `nextCursor: null`.

Return exactly:

```json
{
  "threads": [],
  "nextCursor": null
}
```

`threads` is in ascending thread-ID order; the random suffix is the stable tie-breaker for creations in the same millisecond, so the API does not promise an intra-millisecond arrival order. A client obtains the complete current view by repeating the same `doc` and `limit` with each non-null `nextCursor` until `null`, concatenating pages in response order. A cursor is not a snapshot token: a concurrently created key whose ID sorts after the cursor may appear on a later page, while the unverified list consistency can temporarily omit any key. Clients de-duplicate by thread ID and use the POST/PATCH response as the authoritative result of their own write. No response claims a total count.

P3-A imposes no global per-document thread count. It does impose the per-thread durable 500-comment invariant required to bound mutation/list responses. Durable thread count may grow beyond one GET's ten-provider-page work ceiling; exceeding that ceiling fails the read closed with 503 but does not reject a create. P3-C may deliberately stop fetching or render a bounded subset and label that view as partial, but it must preserve each received page, cursor, and order exactly; it must not reinterpret a non-null `nextCursor` as exhaustion, claim completeness without reaching `null`, or turn its UI bound into a global P3-A thread-write cap.

Provider pagination is an internal enumeration detail, distinct from the public keyset cursor. Do not expose a provider cursor or assume list order/strong consistency. The implementation must not call `store.get()` directly, request bodies from `list()`, or list outside `threads/<docId>/`.

### `POST /api/threads`

After complete validation and generation, construct the exact thread with `v: 1`, `status: "open"`, the request kind/section/docVersion/body, server actor, one first comment, and the kind-dependent anchor/title. Pass it through P2-B `upgrade()` and the private complete thread validator before any provider write, then call:

```js
store.setJSON(threadKey(docId, threadId), thread, { onlyIfNew: true })
```

Creation is the one create-only thread operation; it does not call `mutate()` because there is no prior record to merge. Require a resolved result to be a non-array object with an own boolean `modified`. `modified: true` commits and returns `{ "thread": <exact record> }` with 201 directly from the constructed record; do not relist or re-read. `modified: false` is a 409 `id-collision`; do not generate another ID or overwrite the existing key. A thrown write or malformed/indeterminate result is 503. Additional provider-result fields and prototypes are ignored, and no result field crosses the HTTP boundary.

The body `author`, `email`, and `name`, when present, are never accessed. The stored top-level and first-comment actors are the exact three-field projection of `identify(req)`.

### `POST` and `PATCH /api/threads/:doc/:id`

Both operations call `mutate(store, threadKey(docId, threadId), null, apply)` exactly once. A missing record reaches `apply` as `null`; throw a private domain sentinel that the handler maps to 404. Never create a missing thread from a reply or status request.

For `POST`, validate the current thread. If it already has exactly 500 comments, throw the private comment-limit sentinel from the synchronous callback; map it to exact `409 comment-limit`, perform no write, and do not retry or generate a replacement ID. Otherwise append one captured comment to a fresh comments array. Preserve every other field exactly, including a resolved status; replying never reopens a thread. Return `{ "thread": <committed record> }` with 200 from P2-B's `value`.

For `PATCH`, validate the current thread. If the requested status equals the current status, return `null`; P2-B performs no write and the endpoint returns the current valid record with 200. Otherwise:

- resolving sets `status: "resolved"`, `resolvedAt: operationTime`, and `resolvedBy: actor`;
- reopening sets `status: "open"`, `resolvedAt: null`, and `resolvedBy: null`.

Return the committed P2-B `value`, not the pre-mutation draft. P3-A performs no author/role/capability check beyond requiring a verified identity. A body attempting to edit a comment is invalid, even when that caller authored it.

### CAS and idempotency boundary

CAS guarantees concurrency, not HTTP replay protection:

- Two different accepted reply requests racing on one ETag both land exactly once. The loser re-reads, validates, appends its already-generated distinct comment, and commits on a later P2-B attempt.
- One `mutate()` invocation cannot duplicate its reply across retries because its callback receives a fresh draft and uses one captured comment ID.
- `PATCH` is state-idempotent. Repeating the same target status after success is a no-op, preserves the original resolution actor/time for repeated resolve, and emits no new state change.
- Both `POST` operations are intentionally not replay-idempotent. Repeating a request after an accepted response creates a new thread or a new reply with a new server ID. `Idempotency-Key` and similar headers have no P3-A semantics and must not be represented as protection.
- After an ambiguous client/network outcome, a client must not blindly replay a POST. It refreshes pages and reconciles by returned IDs when a response was received; P3-A has no durable request-receipt key and makes no exactly-once claim across invocations.
- A provider exception or indeterminate create result is not retried. A P2-B provider exception is not retried. Only P2-B's proven `modified: false` CAS result is safe to retry internally.

There is no transaction across a thread blob and any event, notification, or realtime sink. P3-A writes only the thread record. P3-B owns the events API and later fan-out tickets own their sinks; no client-supplied event or hidden secondary write is added here. This keeps the P3-A acceptance oracle about thread durability exact and does not invent an unowned cross-blob recovery protocol.

### P4-M amendment boundary

P4-M (#35) is the only downstream ticket allowed to add **mutation authorization and thread-event appends** to these files. It adds P3-B as a predecessor, reuses P3-A's `threads.mjs` P2-G imports for create, adds the same access imports to `thread.mjs`, imports P3-B's `appendEvent()` directly, and, after the existing origin/identity/input gates, applies the default non-consuming access lookup on every supported mutation:

- create and reply require `canComment === true`;
- resolve and reopen require `threadControl === "any"`, or `threadControl === "own"` with the current validated `thread.author.sub === identity.sub`;
- `threadControl === "none"` denies the status change.

P4-M must preserve P3-A's GET `canRead` check and its route, body, schema, actor, CAS, replay, response, and validation contracts. For a thread-control decision that depends on the current record, enforcement belongs inside the pure CAS transformation against every freshly validated draft so a raced record cannot bypass it. After and only after the authoritative create/reply/changed-status write succeeds, P4-M appends the exact P3-B kind mapping `comment.create`, `comment.reply`, `thread.resolve`, or `thread.reopen`; a status no-op emits no event. Its acceptance injects append failure to prove state is never rolled back and proves the four action-to-kind mappings. It never invokes `/api/events` over HTTP. P3-A must not use its read result to authorize a mutation or add a temporary `isOrg`, email-domain, identity-role, body-role, HTML-gate, stored-actor mutation rule, or event append. The combined product is not mutation-authorization/audit-complete until P4-M lands; the exact P3-A read boundary remains independently mandatory.

## Files owned

- `netlify/functions/threads.mjs` — **new**; owns list and create for `/api/threads`.
- `netlify/functions/thread.mjs` — **new**; owns reply and status mutation for `/api/threads/:doc/:id`.

No other implementation, library, package, lock, generated, configuration, template, research, prompt, or permanent test file is created or amended. `docs/tickets/P3-A.md` is this specification, not an implementation surface.

P4-M later amends exactly these two files for mutation access enforcement and the four post-commit P3-B audit appends. If P3-A cannot be implemented from the published P1-C/P2-H-compatible identity, P2-B store, and P2-G access contracts, stop and report the predecessor gap; do not amend their files from this ticket.

## Dependencies

### Required predecessors

- **P1-C:** supplies the root ESM/Node 22 Functions contract plus `identify(req)` and `requireOrigin(req)`. The integrated Phase 3 release must include P2-H's final four-field identity amendment; P3-A itself consumes only the stable `sub`, `email`, and `name` subset and has no `roles` fallback.
- **P2-B:** supplies `StoreError`, `assertDocId`, `docState`, `read`, `mutate`, `threadPrefix`, `threadKey`, and `upgrade`, including strong reads, exact keys, complete JSON-safety, six-attempt CAS, and stable errors. P3-A starts only after that complete contract is integrated and green.
- **P2-G:** supplies `resolveRole()`, `capabilitiesFor()`, exact result/error semantics, strong access reads, and non-consuming invitation lookup. P3-A imports it only in `threads.mjs` for the GET read boundary.

P2-H is not a new source-authoring prerequisite for P3-A because its final shape is already a declared consumer transition of P1-C. P3-B, P3-C, P4-A, P4-D, and P4-M are downstream/sibling work and do not authorize edits to P3-A's predecessor files.

### Maximum safe within-ticket waves

1. **Predecessor gate:** one integrator lands complete P1-C, P2-H's identity-shape amendment for the release, complete P2-B, and complete P2-G, then runs their published acceptance gates. Do not develop against a partial store or access helper.
2. **Maximum parallel source wave:** one agent owns `threads.mjs` and one owns `thread.mjs`. Their file surfaces are disjoint, and both implement the exact schema/error contract in this ticket without creating a shared helper. No further split inside either file is safe.
3. **Serialized contract wave:** integrate the two files, compare their duplicated private validators/response rules mechanically, and run the exact source-bound fixture. Fix drift in the owning file; do not extract a third implementation file.
4. **Serialized runtime wave:** one operator alone runs the disposable deployed-preview check and repository-wide gates. Installed dependencies, the remote disposable Blobs store, operator token, and authenticated cookies are shared mutable surfaces and must not be driven by parallel agents.

P3-B, P3-C, P3-D, and P3-E may proceed concurrently after their own predecessors because their implementation paths are disjoint. P4-A begins after P3-A and P3-C. P4-M begins only after P3-A, P3-B, P4-B, and P2-G and is serialized with any other work amending these two function files.

## Acceptance criteria

- [ ] Only the two owned implementation files are added, with exactly the default/config exports and Functions v2 paths under **Interface contract**.
- [ ] Unsupported methods return the exact 405 before origin, identity, parsing, access, clock/randomness, or storage; GET identifies without an origin check; every supported POST/PATCH calls `requireOrigin()` first and `identify()` second.
- [ ] Signed-out supported requests return the exact 401 and perform no parsing, access, clock/randomness, list/read/write, or role inference; P1-C origin failures are returned unchanged.
- [ ] Every valid GET calls `resolveRole(docId, identity, { consumeInvitation: false })` exactly once after identity/query validation and before thread storage; the complete result matches `capabilitiesFor(role)`, `canRead: false` returns exact 403, unavailable returns exact 503, and malformed/other failure returns exact 500 without any list/read/write.
- [ ] Query, path, media type, body, anchor, title, body-length, and reserved-author-field behavior matches the exact grammar and public errors. Every mutation body is stream-read through the exact 65,536-byte ceiling before fatal UTF-8 decode/one parse; the fixture proves the exact-byte success boundary, one-byte overflow 413, body untouched after an oversized header, natural read rejection, invalid chunk, rejected cancellation tolerance, and exact cancellation/reader-release counts.
- [ ] Every stored/returned actor is projected from the server identity; hostile body `author`, `email`, and `name` values are not read, logged, stored, or returned.
- [ ] Created, listed, replied, resolved, and reopened records pass the exact version-1 validator. The executable finite schema matrix has one named representative for every declared top-level/comment/actor/anchor missing, extra, type, grammar, length, uniqueness, timestamp, first-comment, kind, resolution, and key/body relation class; it does not pretend to enumerate every possible invalid string.
- [ ] Thread/comment IDs and the one operation timestamp are sampled once outside storage callbacks; no ID, actor, time, random, I/O, event, notification, or log side effect occurs inside a CAS callback.
- [ ] Create uses one `onlyIfNew` write, returns the constructed record without relisting, reports a proven collision as 409, and does not retry an ambiguous write.
- [ ] Listing manually consumes at most ten provider data pages plus one exhaustion probe, rejects pages over the documented 1,000-entry maximum, validates at most 10,000 keys, distrusts provider ordering, and fails exact 503 without inspecting an eleventh page's blobs when the bounded inventory cannot prove exhaustion.
- [ ] Each public page returns ascending IDs with exact exclusive-cursor semantics, at most the requested thread count and 5,000 total comments, and at least one thread when any valid live candidate remains. A non-null cursor may accompany any positive page length through the requested limit when the comment budget stops the page early; an empty page has a null cursor. The API never advances past an unreturned live thread or claims snapshot/list consistency or a total count.
- [ ] P3-A sets no global per-document thread count or create-time inventory cap; its exact per-thread limit is 500 comments. P3-C may present an explicitly bounded partial view but cannot weaken, truncate, or relabel the API's non-null cursor and completion semantics.
- [ ] Reply and status changes use exactly one P2-B `mutate()` call; missing records are 404, six races are 409, a 501st reply is exact `409 comment-limit` without a write, reply preserves resolved status, and status no-op preserves the first resolution actor/time without writing.
- [ ] A deterministic barrier makes two simultaneous replies read the same starting ETag; both responses are 200 and the final thread contains each distinct reply exactly once.
- [ ] The deterministic fixture executes the exact finite request/query/path/media/scalar/schema/provider/error matrices named below, including every public error row and both endpoints' 405 variants. Acceptance makes no universal claim beyond those named equivalence classes; the closed predicates remain mandatory source behavior.
- [ ] The repository-pinned TypeScript AST oracle proves exact static module/export/import boundaries, no dynamic/provider/process/worker/network/server/timer/logging surface, and no access import in `thread.mjs`; runtime poisoning and call traces prove forbidden request/provider paths are not reached on executed branches. Regex is not used as a JavaScript behavioral oracle.
- [ ] P3-A contains no mutation use of `resolveRole`, `canComment`, `threadControl`, identity-role, email-domain, or interim mutation-access enforcement; the exact P4-M amendment seam is retained.
- [ ] The source-bound fixture is finite, installs cleanup/signal handling before creating its guarded root, and supervises one AST-proven descendant-free Node process. Its executable supervisor self-test sends HUP/INT/TERM and forces a deadline against a TERM-resistant child, asserts exact 129/130/143/124 statuses, proves every recorded child PID is gone, and then uses the same supervisor for the ordinary endpoint fixture before removing the root.
- [ ] The repository command proves a byte-identical document rebuild, clean TypeScript builder typecheck, scrub/whitespace gates, absence of fixture-created `package-lock.json`, `node_modules`, or `.netlify`, an exact non-ticket diff containing only `threads.mjs` and `thread.mjs`, and issue #14 pointer integrity: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

### Deterministic source-bound fixture

Run this from the repository root after implementing both files. It copies the exact owned sources and repository-pinned TypeScript parser into an isolated module tree and supplies deterministic P1-C/P2-B fakes. The structural oracle proves the handlers cannot create descendants. A fixture-owned Node supervisor is first self-probed with real HUP/INT/TERM delivery and a deadline against a TERM-resistant child, then the same supervisor runs the endpoint oracle. The outer shell installs signal ownership before creating the guarded root, applies its own 30-second ceiling, reaps the supervisor, and removes only its validated private fixture root.

```bash
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
test -f netlify/functions/threads.mjs
test -f netlify/functions/thread.mjs

fixture_root=
fixture_pid=
latched_status=0

stop_child() {
  test -n "$fixture_pid" || return 0
  if kill -0 "$fixture_pid" 2>/dev/null; then
    kill -TERM "$fixture_pid" 2>/dev/null || true
    stop_deadline=$((SECONDS + 2))
    while kill -0 "$fixture_pid" 2>/dev/null && test "$SECONDS" -lt "$stop_deadline"; do
      sleep 0.05
    done
    if kill -0 "$fixture_pid" 2>/dev/null; then
      kill -KILL "$fixture_pid" 2>/dev/null || true
    fi
  fi
  wait "$fixture_pid" 2>/dev/null || true
  fixture_pid=
}

cleanup() {
  incoming=$?
  trap - EXIT HUP INT TERM
  stop_child
  if test -n "$fixture_root"; then
    case "$fixture_root" in
      "${TMPDIR:-/tmp}"/p3-a-threads.*) ;;
      *) printf '%s\n' 'ERROR  refusing unsafe P3-A cleanup target' >&2; exit 125 ;;
    esac
    test ! -L "$fixture_root" || { printf '%s\n' 'ERROR  symlink fixture root' >&2; exit 125; }
    rm -rf -- "$fixture_root"
  fi
  if test "$latched_status" -ne 0; then exit "$latched_status"; fi
  exit "$incoming"
}

on_hup() { test "$latched_status" -ne 0 || latched_status=129; stop_child; }
on_int() { test "$latched_status" -ne 0 || latched_status=130; stop_child; }
on_term() { test "$latched_status" -ne 0 || latched_status=143; stop_child; }
trap cleanup EXIT
trap on_hup HUP
trap on_int INT
trap on_term TERM

fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/p3-a-threads.XXXXXX")
chmod 700 "$fixture_root"
mkdir -p "$fixture_root/netlify/functions" "$fixture_root/netlify/lib"
cp netlify/functions/threads.mjs netlify/functions/thread.mjs "$fixture_root/netlify/functions/"
cp templates/docbuild/node_modules/typescript/lib/typescript.js "$fixture_root/typescript.cjs"

cat >"$fixture_root/netlify/lib/identity.mjs" <<'NODE'
export function requireOrigin(req) {
  assertPure();
  globalThis.__p3a.calls.push("origin");
  if (req.headers.get("origin") !== new URL(req.url).origin) {
    throw globalThis.__p3a.originResponse ?? new Response("Bad origin", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
export async function identify() {
  assertPure();
  globalThis.__p3a.calls.push("identity");
  return globalThis.__p3a.user;
}
function assertPure() { if (globalThis.__p3a?.inApply) throw new Error("CAS callback used identity/origin"); }
NODE

cat >"$fixture_root/netlify/lib/access.mjs" <<'NODE'
const rows = Object.freeze({
  owner: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: true, canSeeMembers: true },
  editor: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: false, canSeeMembers: true },
  commenter: { canRead: true, canComment: true, threadControl: "own", canSuggest: true, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  viewer: { canRead: true, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  none: { canRead: false, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
});
export function capabilitiesFor(role) {
  if (globalThis.__p3a?.inApply) throw new Error("CAS callback used access");
  if (!Object.hasOwn(rows, role)) throw new Error("invalid fixture role");
  return rows[role];
}
export async function resolveRole(...args) {
  if (globalThis.__p3a?.inApply) throw new Error("CAS callback used access");
  globalThis.__p3a.calls.push("access");
  globalThis.__p3a.accessArgs.push(args);
  if (globalThis.__p3a.accessError) throw globalThis.__p3a.accessError;
  return globalThis.__p3a.accessResult;
}
NODE

cat >"$fixture_root/netlify/lib/store.mjs" <<'NODE'
export class StoreError extends Error {
  constructor(code, status, message, options = {}) {
    super(message, options); this.name = "StoreError"; this.code = code; this.status = status;
  }
}
export const assertDocId = (value) => {
  if (!/^[0-9a-f]{6}$/.test(value)) throw new StoreError("invalid-key", 400, "Invalid state key");
  return value;
};
export const threadPrefix = (doc) => `threads/${assertDocId(doc)}/`;
export const threadKey = (doc, id) => {
  if (!/^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/.test(id)) throw new StoreError("invalid-key", 400, "Invalid state key");
  return `${threadPrefix(doc)}${id}.json`;
};
export function upgrade(value) {
  if (!value || Array.isArray(value) || value.v !== 1) {
    throw new StoreError("invalid-record", 500, "Invalid stored record");
  }
  return value;
}
export const docState = () => { globalThis.__p3a.storeOpens += 1; return globalThis.__p3a.store; };
export async function read(store, key, initial = null) {
  const got = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  return got === null ? { value: structuredClone(initial), etag: null }
    : { value: upgrade(got.data), etag: got.etag };
}
export async function mutate(store, key, initial, apply) {
  globalThis.__p3a.mutateCalls += 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await read(store, key, initial);
    let next;
    globalThis.__p3a.inApply = true;
    try { next = apply(structuredClone(current.value)); }
    finally { globalThis.__p3a.inApply = false; }
    if (next === null) return { value: current.value, etag: current.etag, changed: false };
    upgrade(next);
    const options = current.etag === null ? { onlyIfNew: true } : { onlyIfMatch: current.etag };
    const result = await store.setJSON(key, next, options);
    if (result.modified === true) return { value: next, etag: result.etag, changed: true };
  }
  throw new StoreError("conflict", 409, "Concurrent write limit reached");
}
NODE

cat >"$fixture_root/check.mjs" <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("./typescript.cjs");
for (const file of ["netlify/functions/threads.mjs", "netlify/functions/thread.mjs"]) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(sourceFile.parseDiagnostics, [], `${file} must parse as JavaScript`);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration).map((node) => {
    assert(ts.isStringLiteral(node.moduleSpecifier));
    assert(node.importClause && !node.importClause.isTypeOnly && !node.importClause.name);
    assert(node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings));
    return [node.moduleSpecifier.text, node.importClause.namedBindings.elements.map((element) => {
      assert.equal(element.isTypeOnly, false); assert.equal(element.propertyName, undefined); return element.name.text;
    }).sort()];
  });
  const importMap = new Map(imports);
  assert.equal(importMap.size, imports.length, "one declaration per module");
  const isThreads = file.endsWith("/threads.mjs");
  assert.deepEqual([...importMap.keys()].sort(), ["../lib/identity.mjs", "../lib/store.mjs", ...(isThreads ? ["../lib/access.mjs"] : [])].sort());
  assert.deepEqual(importMap.get("../lib/identity.mjs"), ["identify", "requireOrigin"]);
  assert.deepEqual(importMap.get("../lib/store.mjs"), (isThreads
    ? ["StoreError", "assertDocId", "docState", "read", "threadKey", "threadPrefix", "upgrade"]
    : ["StoreError", "assertDocId", "docState", "mutate", "threadKey", "upgrade"]).sort());
  if (isThreads) assert.deepEqual(importMap.get("../lib/access.mjs"), ["capabilitiesFor", "resolveRole"]);

  const forbiddenCalls = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "BroadcastChannel", "eval", "Function", "setTimeout", "setInterval", "setImmediate", "queueMicrotask", "spawn", "exec", "execFile", "fork"]);
  const staticMember = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
  const staticOwner = (node) => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) ? node.expression.text : null;
  const providerCalls = [], mutationCalls = [];
  function walkAst(node) {
    if (ts.isIdentifier(node)) {
      assert.equal(new Set([...forbiddenCalls, "console", "process", "Deno", "Bun", "globalThis", "self", "window", "navigator", "clientContext", "getUser", "verifyRequestOrigin", "appendEvent"]).has(node.text), false, `forbidden identifier ${node.text}`);
    }
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic import is forbidden");
      const callName = ts.isIdentifier(node.expression) ? node.expression.text : staticMember(node.expression);
      assert.equal(forbiddenCalls.has(callName), false, `forbidden call ${callName}`);
      assert.equal(["getUser", "verifyRequestOrigin", "appendEvent"].includes(callName), false, `forbidden handler call ${callName}`);
      assert.equal(callName === "listen", false, "server listen is forbidden");
      if (["list", "setJSON"].includes(callName)) providerCalls.push([callName, node]);
      if (callName === "mutate") mutationCalls.push(node);
    }
    if (ts.isNewExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : staticMember(node.expression);
      assert.equal(forbiddenCalls.has(name), false, `forbidden constructor ${name}`);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = staticOwner(node), member = staticMember(node);
      assert.equal(owner === "console", false, "console access is forbidden");
      assert.equal(owner === "Math" && member === "random", false, "Math.random is forbidden");
      assert.equal(["process", "Deno", "Bun"].includes(owner) && member === "env", false, `${owner}.env is forbidden`);
      assert.equal(node.expression.kind === ts.SyntaxKind.ImportMeta && member === "env", false, "import.meta.env is forbidden");
      assert.equal(member === "clientContext", false, "clientContext is forbidden");
    }
    ts.forEachChild(node, walkAst);
  }
  walkAst(sourceFile);
  assert.deepEqual(providerCalls.map(([name]) => name).sort(), isThreads ? ["list", "setJSON"] : []);
  assert.equal(mutationCalls.length, isThreads ? 0 : 1); if (!isThreads) assert.equal(mutationCalls[0].arguments.length, 4);
  if (isThreads) {
    const createWrite = providerCalls.find(([name]) => name === "setJSON")[1];
    assert.equal(createWrite.arguments.length, 3); assert(ts.isObjectLiteralExpression(createWrite.arguments[2]));
    assert.equal(createWrite.arguments[2].properties.length, 1);
    const property = createWrite.arguments[2].properties[0]; assert(ts.isPropertyAssignment(property));
    assert.equal(property.name.getText(sourceFile), "onlyIfNew"); assert.equal(property.initializer.kind, ts.SyntaxKind.TrueKeyword);
  }
}
console.log("PASS  P3-A structural source boundary");

const threadsModule = await import("./netlify/functions/threads.mjs");
const threadModule = await import("./netlify/functions/thread.mjs");
assert.deepEqual(Object.keys(threadsModule).sort(), ["config", "default"]); assert.deepEqual(Object.keys(threadModule).sort(), ["config", "default"]);
const { default: threads, config: threadsConfig } = threadsModule;
const { default: thread, config: threadConfig } = threadModule;
const { StoreError: FixtureStoreError } = await import("./netlify/lib/store.mjs");
assert.equal(threads.name, "handler"); assert.equal(threads.length, 2); assert.equal(thread.name, "handler"); assert.equal(thread.length, 2);

let nowCalls = 0;
let uuidCalls = 0;
let nextMs = 1788452365123, nextUuid = 1, forcedNow, forcedUuid;
Date.now = () => { assert.equal(globalThis.__p3a?.inApply, false, "CAS callback read the clock"); nowCalls += 1; return forcedNow ?? nextMs++; };
crypto.randomUUID = () => {
  assert.equal(globalThis.__p3a?.inApply, false, "CAS callback read randomness"); uuidCalls += 1;
  if (forcedUuid !== undefined) return forcedUuid;
  return `${(nextUuid++).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
};

const clone = (value) => structuredClone(value);
class FakeStore {
  constructor() {
    this.rows = new Map(); this.serial = 0; this.hidden = new Set(); this.vanish = new Set();
    this.conflicts = 0; this.forceCollision = false; this.failList = false; this.malformedPage = false;
    this.malformedWrite = false; this.oversizedPage = false; this.forcedPages = null; this.forcedPageWidth = 0; this.barrier = null;
  }
  armBarrier() {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    this.barrier = { arrived: 0, promise, release };
  }
  seed(key, value) { this.rows.set(key, { data: clone(value), etag: `e${++this.serial}` }); }
  async *list({ prefix, paginate }) {
    assert.equal(globalThis.__p3a.inApply, false, "CAS callback listed storage");
    assert.equal(paginate, true); globalThis.__p3a.calls.push("list");
    if (this.failList) throw new Error("invented list outage");
    if (this.malformedPage) { globalThis.__p3a.listPages += 1; yield { blobs: "not-an-array" }; return; }
    if (this.oversizedPage) {
      const blobs = Array.from({ length: 1001 }, (_, index) => ({ key: `${prefix}t_page${index.toString(36)}_${index.toString(16).padStart(8, "0")}.json` }));
      globalThis.__p3a.listPages += 1; yield { blobs }; return;
    }
    if (this.forcedPages !== null) {
      for (let index = 0; index < this.forcedPages; index += 1) {
        const blobs = Array.from({ length: this.forcedPageWidth }, (_, row) => {
          const item = index * this.forcedPageWidth + row;
          return { key: `${prefix}t_page${item.toString(36)}_${item.toString(16).padStart(8, "0")}.json` };
        });
        const page = index === 10 ? Object.defineProperty({}, "blobs", { enumerable: true, get() { globalThis.__p3a.eleventhPageTouches += 1; throw new Error("eleventh page value must stay opaque"); } }) : { blobs };
        globalThis.__p3a.listPages += 1; yield page;
      }
      return;
    }
    const blobs = [...this.rows].filter(([key]) => key.startsWith(prefix) && !this.hidden.has(key))
      .map(([key, row]) => ({ key, etag: row.etag })).reverse();
    globalThis.__p3a.listPages += 1; yield { blobs: blobs.slice(0, 2) };
    globalThis.__p3a.listPages += 1; yield { blobs: blobs.slice(2) };
  }
  async getWithMetadata(key, options) {
    assert.equal(globalThis.__p3a.inApply, false, "CAS callback read storage");
    assert.deepEqual(options, { type: "json", consistency: "strong" });
    globalThis.__p3a.calls.push("read");
    if (this.vanish.delete(key)) { this.rows.delete(key); return null; }
    const row = this.rows.get(key);
    return row ? { data: clone(row.data), etag: row.etag } : null;
  }
  async setJSON(...args) {
    const [key, value, options] = args; assert.equal(args.length, 3, "no Blob metadata/fourth write argument");
    assert.equal(globalThis.__p3a.inApply, false, "CAS callback wrote storage");
    globalThis.__p3a.calls.push("write");
    await new Promise((resolve) => setImmediate(resolve));
    const barrier = this.barrier;
    if (barrier && Object.hasOwn(options, "onlyIfMatch")) {
      barrier.arrived += 1;
      if (barrier.arrived === 2) { this.barrier = null; barrier.release(); }
      await barrier.promise;
    }
    if (this.malformedWrite) return { modified: "yes" };
    if (this.forceCollision && options.onlyIfNew === true) return { modified: false };
    if (this.conflicts > 0 && Object.hasOwn(options, "onlyIfMatch")) {
      this.conflicts -= 1; return { modified: false };
    }
    const row = this.rows.get(key);
    if (options.onlyIfNew === true && row) return { modified: false };
    if (Object.hasOwn(options, "onlyIfMatch") && row?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = `e${++this.serial}`;
    this.rows.set(key, { data: clone(value), etag });
    return { modified: true, etag };
  }
}

const accessRows = Object.freeze({
  owner: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: true, canSeeMembers: true },
  editor: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: false, canSeeMembers: true },
  commenter: { canRead: true, canComment: true, threadControl: "own", canSuggest: true, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  viewer: { canRead: true, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  none: { canRead: false, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
});
const accessResultFor = (role, shared = role !== "none") => ({ role, shared, ...accessRows[role] });
const serverUser = { sub: "u_demo_931", email: "avery@example.com", name: "Avery Quill" };
Object.defineProperty(serverUser, "isOrg", { enumerable: true, get() { globalThis.__p3a.isOrgReads += 1; throw new Error("P3-A must not read isOrg"); } });
function reset() {
  globalThis.__p3a = { calls: [], user: serverUser, originResponse: null, accessResult: accessResultFor("viewer"), accessError: null, accessArgs: [], store: new FakeStore(), storeOpens: 0, mutateCalls: 0, listPages: 0, eleventhPageTouches: 0, inApply: false, isOrgReads: 0 };
}
const origin = "https://review.example.com";
const request = (path, method = "GET", body, headers = {}) => new Request(`${origin}${path}`, {
  method,
  headers: body === undefined ? headers : { origin, "content-type": "application/json", ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const streamRequest = (path, chunks, { contentLength, readError = false, cancelError = false } = {}) => {
  const state = { getReader: 0, reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (readError) { readError = false; controller.error(new Error("private body read failure")); return; }
      if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close();
    },
    cancel() { if (cancelError) return Promise.reject(new Error("private body cancel failure")); },
  }, { highWaterMark: 0 });
  const acquire = stream.getReader.bind(stream);
  Object.defineProperty(stream, "getReader", { value() {
    state.getReader += 1;
    const reader = acquire();
    return {
      async read() { state.reads += 1; return reader.read(); },
      async cancel(reason) { state.cancels += 1; return reader.cancel(reason); },
      releaseLock() { state.releases += 1; return reader.releaseLock(); },
    };
  } });
  const headers = new Headers({ origin, "content-type": "application/json" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return { request: new Request(`${origin}${path}`, { method: "POST", headers, body: stream, duplex: "half" }), state };
};
const params = (doc, id) => ({ params: { doc, id } });
const json = async (response) => JSON.parse(await response.text());
const validCreate = (body = "Could the retry boundary be stated here?") => ({
  kind: "comment", section: "architecture", docVersion: "7aaca51", body,
  anchor: { block: "a3f19c2b7", exact: "a cache miss stays local", prefix: "The contract says ", suffix: ". That boundary matters", start: 91 },
});
const assertPrivateJSON = (response) => {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
};
const assertPublicError = async (response, status, code, message, allow = null) => {
  assert.equal(response.status, status); assertPrivateJSON(response); assert.equal(response.headers.get("allow"), allow);
  assert.deepEqual(await json(response), { error: { code, message } });
};

assert.deepEqual(threadsConfig, { path: "/api/threads" });
assert.deepEqual(threadConfig, { path: "/api/threads/:doc/:id" });

reset();
let response = await threads(request("/api/threads?doc=4b7d2a", "PUT"), {});
assert.equal(response.status, 405); assert.deepEqual(globalThis.__p3a.calls, []);
assert.equal(response.headers.get("allow"), "GET, POST");

reset(); globalThis.__p3a.user = null;
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 401); assert.deepEqual(globalThis.__p3a.calls, ["identity"]);

reset();
response = await threads(request("/api/threads?doc=4b7d2a&doc=4b7d2a"), {});
assert.equal(response.status, 400); assert.deepEqual(globalThis.__p3a.calls, ["identity"]);

reset();
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 200); assert.deepEqual(await json(response), { threads: [], nextCursor: null });
assert.deepEqual(globalThis.__p3a.calls, ["identity", "access", "list"]);
assert.equal(globalThis.__p3a.storeOpens, 1);
assert.deepEqual(globalThis.__p3a.accessArgs, [["4b7d2a", serverUser, { consumeInvitation: false }]]);

reset(); globalThis.__p3a.accessResult = accessResultFor("none", true);
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 403); assert.deepEqual(await json(response), { error: { code: "forbidden", message: "Document access denied" } });
assert.deepEqual(globalThis.__p3a.calls, ["identity", "access"]);
assert.equal(globalThis.__p3a.storeOpens, 0);

reset();
globalThis.__p3a.accessError = Object.assign(new Error("invented access outage"), { name: "StoreError", code: "unavailable", status: 503 });
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");
assert.deepEqual(globalThis.__p3a.calls, ["identity", "access"]);
assert.equal(globalThis.__p3a.storeOpens, 0);

reset(); globalThis.__p3a.accessResult = { canRead: true };
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 500); assert.equal((await json(response)).error.code, "invalid-state");
assert.deepEqual(globalThis.__p3a.calls, ["identity", "access"]);
assert.equal(globalThis.__p3a.storeOpens, 0);

for (const role of ["owner", "editor", "commenter", "viewer", "none"]) {
  reset(); globalThis.__p3a.accessResult = accessResultFor(role);
  response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, role === "none" ? 403 : 200, `access row ${role}`);
  assert.equal(globalThis.__p3a.calls.includes("list"), role !== "none", `storage boundary ${role}`);
  assert.equal(globalThis.__p3a.storeOpens, role === "none" ? 0 : 1, `store open ${role}`);
}

const accessKeys = ["role", "shared", "canRead", "canComment", "threadControl", "canSuggest", "canEdit", "canAccept", "canShare", "canSeeMembers"];
const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
const viewerAccess = accessResultFor("viewer");
const invalidAccessResults = [
  ["access null", null], ["access array", []], ["access primitive", 1],
  ...accessKeys.map((key) => [`access missing ${key}`, omit(viewerAccess, key)]),
  ["access extra", { ...viewerAccess, extra: true }], ["access role value", { ...viewerAccess, role: "reader" }],
  ["access role type", { ...viewerAccess, role: 1 }], ["access shared type", { ...viewerAccess, shared: "true" }],
  ["access boolean capability type", { ...viewerAccess, canRead: 1 }], ["access threadControl type", { ...viewerAccess, threadControl: 1 }],
  ["access threadControl value", { ...viewerAccess, threadControl: "owner" }], ["access role-row mismatch", { ...viewerAccess, canRead: false }],
];
for (const [label, value] of invalidAccessResults) {
  reset(); globalThis.__p3a.accessResult = value; response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label);
  assert.deepEqual(globalThis.__p3a.calls, ["identity", "access"], label);
  assert.equal(globalThis.__p3a.storeOpens, 0, label);
}
reset();
let accessGetterReads = 0;
const accessorAccess = { ...viewerAccess }; Object.defineProperty(accessorAccess, "canRead", { enumerable: true, get() { accessGetterReads += 1; throw new Error("must not execute access getter"); } });
globalThis.__p3a.accessResult = accessorAccess; response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 500); assert.equal(accessGetterReads, 0); assert.equal(globalThis.__p3a.storeOpens, 0);

reset(); globalThis.__p3a.accessError = new Error("invented malformed access failure");
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 500); assert.equal((await json(response)).error.code, "invalid-state");
assert.deepEqual(globalThis.__p3a.calls, ["identity", "access"]);
assert.equal(globalThis.__p3a.storeOpens, 0);

reset();
let errorGetterReads = 0;
const hostileAccessError = { name: "StoreError", status: 503 }; Object.defineProperty(hostileAccessError, "code", { enumerable: true, get() { errorGetterReads += 1; throw new Error("must not execute error getter"); } });
globalThis.__p3a.accessError = hostileAccessError; response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 500); assert.equal((await json(response)).error.code, "invalid-state"); assert.equal(errorGetterReads, 0); assert.equal(globalThis.__p3a.storeOpens, 0);

const plainIdentity = { sub: "u_demo_931", email: "avery@example.com", name: "Avery Quill", isOrg: true };
for (const [label, user] of [
  ["identity null object", []], ["identity sub type", { ...plainIdentity, sub: 1 }], ["identity sub grammar", { ...plainIdentity, sub: "-bad" }],
  ["identity sub over 128", { ...plainIdentity, sub: `u${"a".repeat(128)}` }], ["identity name type", { ...plainIdentity, name: 1 }],
  ["identity name over 200", { ...plainIdentity, name: "n".repeat(201) }], ["identity email type", { ...plainIdentity, email: 1 }],
  ["identity email not normalized", { ...plainIdentity, email: "Avery@Example.com" }], ["identity email grammar", { ...plainIdentity, email: "invalid" }],
  ["identity email local length", { ...plainIdentity, email: `${"a".repeat(65)}@example.invalid` }],
]) {
  reset(); globalThis.__p3a.user = user; response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label);
  assert.deepEqual(globalThis.__p3a.calls, ["identity"], label);
  assert.equal(globalThis.__p3a.storeOpens, 0, label);
}

reset();
globalThis.__p3a.originResponse = new Response("Bad origin", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Fixture": "preserved" } });
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate(), { origin: "https://foreign.invalid" }), {});
assert.equal(response, globalThis.__p3a.originResponse); assert.equal(response.status, 403); assert.equal(response.headers.get("x-fixture"), "preserved"); assert.equal(await response.text(), "Bad origin");
assert.deepEqual(globalThis.__p3a.calls, ["origin"]);

reset();
const encoder = new TextEncoder();
const exactBody = { ...validCreate(), author: "", email: { hostile: true }, name: ["hostile"] };
const exactBaseBytes = encoder.encode(JSON.stringify(exactBody)).byteLength;
exactBody.author = "x".repeat(65_536 - exactBaseBytes);
const exactBytes = encoder.encode(JSON.stringify(exactBody));
assert.equal(exactBytes.byteLength, 65_536);
const exactRequest = streamRequest("/api/threads?doc=4b7d2a", [exactBytes.slice(0, 7), exactBytes.slice(7, 32768), exactBytes.slice(32768)]);
const nowBeforeCreate = nowCalls;
const uuidBeforeCreate = uuidCalls;
response = await threads(exactRequest.request, {});
assert.equal(response.status, 201); assertPrivateJSON(response);
assert.deepEqual(exactRequest.state, { getReader: 1, reads: 4, cancels: 0, releases: 1 });
let created = (await json(response)).thread;
assert.match(created.id, /^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/);
assert.match(created.comments[0].id, /^c_[a-z0-9]{1,48}_[0-9a-f]{8}$/);
assert.equal(created.id, `t_${(1788452365123).toString(36)}_00000001`);
assert.equal(created.comments[0].id, `c_${(1788452365123).toString(36)}_00000002`);
assert.equal(created.createdAt, "2026-09-03T16:19:25.123Z"); assert.equal(created.comments[0].createdAt, created.createdAt);
assert.deepEqual(created.author, { sub: serverUser.sub, name: serverUser.name, email: serverUser.email });
assert.deepEqual(created.comments[0].author, created.author);
assert.equal(created.comments[0].body, validCreate().body);
assert.equal(nowCalls - nowBeforeCreate, 1); assert.equal(uuidCalls - uuidBeforeCreate, 2);
assert.equal(globalThis.__p3a.isOrgReads, 0);
assert.deepEqual(globalThis.__p3a.calls.slice(0, 2), ["origin", "identity"]);
assert.equal(globalThis.__p3a.calls.includes("access"), false);
const createdKey = `threads/4b7d2a/${created.id}.json`;
assert.deepEqual(globalThis.__p3a.store.rows.get(createdKey).data, created);

for (const [label, clock] of [["non-finite clock", Number.NaN], ["twelve-digit clock", 999999999999], ["fourteen-digit clock", 10000000000000]]) {
  reset(); forcedNow = clock; const uuidBeforeBadClock = uuidCalls;
  response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label); assert.equal(uuidCalls, uuidBeforeBadClock, label); assert.equal(globalThis.__p3a.calls.includes("write"), false, label);
}
forcedNow = undefined;

for (const [label, uuid] of [["UUID type", null], ["UUID grammar", "not-a-uuid"], ["UUID case", "ABCDEF12-0000-4000-8000-000000000000"]]) {
  reset(); forcedUuid = uuid;
  response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label); assert.equal(globalThis.__p3a.calls.includes("write"), false, label);
}
forcedUuid = undefined;

reset();
const overflowRequest = streamRequest("/api/threads?doc=4b7d2a", [exactBytes, Uint8Array.of(0x20)], { cancelError: true });
response = await threads(overflowRequest.request, {});
assert.equal(response.status, 413); assert.equal((await json(response)).error.code, "payload-too-large");
assert.deepEqual(overflowRequest.state, { getReader: 1, reads: 2, cancels: 1, releases: 1 });
assert.equal(nowCalls - nowBeforeCreate, 1); assert.equal(uuidCalls - uuidBeforeCreate, 2);

reset();
const headerRequest = streamRequest("/api/threads?doc=4b7d2a", [encoder.encode("{}")], { contentLength: "65537" });
const headerBody = headerRequest.request.body;
let headerBodyTouches = 0;
Object.defineProperty(headerRequest.request, "body", { get() { headerBodyTouches += 1; return headerBody; } });
response = await threads(headerRequest.request, {});
assert.equal(response.status, 413); assert.equal((await json(response)).error.code, "payload-too-large");
assert.equal(headerBodyTouches, 0); assert.deepEqual(headerRequest.state, { getReader: 0, reads: 0, cancels: 0, releases: 0 });

reset();
const readFailure = streamRequest("/api/threads?doc=4b7d2a", [], { readError: true, cancelError: true });
response = await threads(readFailure.request, {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");
assert.deepEqual(readFailure.state, { getReader: 1, reads: 1, cancels: 1, releases: 1 });

reset();
const wrongChunk = streamRequest("/api/threads?doc=4b7d2a", ["not bytes"], { cancelError: true });
response = await threads(wrongChunk.request, {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");
assert.deepEqual(wrongChunk.state, { getReader: 1, reads: 1, cancels: 1, releases: 1 });

reset();
const invalidUtf8 = streamRequest("/api/threads?doc=4b7d2a", [Uint8Array.of(0xc3, 0x28)]);
response = await threads(invalidUtf8.request, {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");
assert.deepEqual(invalidUtf8.state, { getReader: 1, reads: 2, cancels: 0, releases: 1 });

reset();
const malformedJson = streamRequest("/api/threads?doc=4b7d2a", [encoder.encode("{")]);
response = await threads(malformedJson.request, {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");
assert.deepEqual(malformedJson.state, { getReader: 1, reads: 2, cancels: 0, releases: 1 });

reset();
response = await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: { origin, "content-type": "application/json" } }), {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");

reset();
const lockedBody = streamRequest("/api/threads?doc=4b7d2a", [encoder.encode(JSON.stringify(validCreate()))]);
const heldReader = lockedBody.request.body.getReader();
response = await threads(lockedBody.request, {}); assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body");
assert.deepEqual(lockedBody.state, { getReader: 1, reads: 0, cancels: 0, releases: 0 }); heldReader.releaseLock();

for (const [label, path] of [
  ["query missing doc", "/api/threads"], ["query blank doc", "/api/threads?doc="], ["query invalid doc", "/api/threads?doc=ABC123"],
  ["query duplicate doc", "/api/threads?doc=4b7d2a&doc=4b7d2a"], ["query unknown", "/api/threads?doc=4b7d2a&x=1"],
  ["limit zero", "/api/threads?doc=4b7d2a&limit=0"], ["limit 101", "/api/threads?doc=4b7d2a&limit=101"],
  ["limit padded", "/api/threads?doc=4b7d2a&limit=01"], ["limit sign", "/api/threads?doc=4b7d2a&limit=%2B1"],
  ["limit syntax", "/api/threads?doc=4b7d2a&limit=1.0"], ["limit duplicate", "/api/threads?doc=4b7d2a&limit=1&limit=1"],
  ["cursor grammar", "/api/threads?doc=4b7d2a&cursor=bad"], ["cursor duplicate", "/api/threads?doc=4b7d2a&cursor=t_a_12345678&cursor=t_a_12345678"],
]) {
  reset(); response = await threads(request(path), {}); assert.equal(response.status, 400, label);
  assert.equal((await json(response)).error.code, "invalid-request", label); assert.deepEqual(globalThis.__p3a.calls, ["identity"], label);
}

for (const value of ["-1", "01", "+1", "1.0", "1e2", "9007199254740992"]) {
  reset(); const malformedLength = streamRequest("/api/threads?doc=4b7d2a", [encoder.encode(JSON.stringify(validCreate()))], { contentLength: value });
  response = await threads(malformedLength.request, {}); assert.equal(response.status, 400, `Content-Length ${value}`);
  assert.equal((await json(response)).error.code, "invalid-body"); assert.deepEqual(malformedLength.state, { getReader: 0, reads: 0, cancels: 0, releases: 0 });
}

reset();
response = await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: { origin, "content-type": "Application/JSON; charset=utf-8" }, body: JSON.stringify(validCreate()) }), {});
assert.equal(response.status, 201, "case-insensitive JSON media type with valid parameter");

for (const [label, context, path] of [
  ["path params missing", { params: {} }, "/api/threads/4b7d2a/t_m8x2k1_4f7a9c31"],
  ["path doc type", { params: { doc: ["4b7d2a"], id: "t_m8x2k1_4f7a9c31" } }, "/api/threads/4b7d2a/t_m8x2k1_4f7a9c31"],
  ["path doc grammar", { params: { doc: "ffffff/extra", id: "t_m8x2k1_4f7a9c31" } }, "/api/threads/ffffff%2Fextra/t_m8x2k1_4f7a9c31"],
  ["path id type", { params: { doc: "4b7d2a", id: ["t_m8x2k1_4f7a9c31"] } }, "/api/threads/4b7d2a/t_m8x2k1_4f7a9c31"],
  ["path id grammar", { params: { doc: "4b7d2a", id: "bad" } }, "/api/threads/4b7d2a/bad"],
  ["single route query", params("4b7d2a", "t_m8x2k1_4f7a9c31"), "/api/threads/4b7d2a/t_m8x2k1_4f7a9c31?x=1"],
]) {
  reset(); response = await thread(request(path, "POST", { body: "valid reply" }), context);
  assert.equal(response.status, 400, label); assert.equal((await json(response)).error.code, "invalid-request", label); assert.equal(globalThis.__p3a.calls.includes("read"), false, label);
}

reset(); response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "DELETE"), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "POST, PATCH"); assert.deepEqual(globalThis.__p3a.calls, []);

reset();
globalThis.__p3a.store.seed(createdKey, created);

globalThis.__p3a.store.hidden.add(createdKey);
response = await threads(request("/api/threads?doc=4b7d2a&limit=1"), {});
assert.deepEqual(await json(response), { threads: [], nextCursor: null });
globalThis.__p3a.store.hidden.clear();

globalThis.__p3a.store.armBarrier();
const readsBeforeRace = globalThis.__p3a.calls.filter((call) => call === "read").length;
const nowBeforeRace = nowCalls;
const uuidBeforeRace = uuidCalls;
response = await Promise.all([
  thread(request(`/api/threads/4b7d2a/${created.id}`, "POST", { body: "Reply from Rowan" }), params("4b7d2a", created.id)),
  thread(request(`/api/threads/4b7d2a/${created.id}`, "POST", { body: "Reply from Jules" }), params("4b7d2a", created.id)),
]);
assert.deepEqual(response.map((item) => item.status), [200, 200]);
assert.equal(globalThis.__p3a.calls.filter((call) => call === "read").length - readsBeforeRace, 3);
assert.equal(nowCalls - nowBeforeRace, 2); assert.equal(uuidCalls - uuidBeforeRace, 2);
let finalThread = globalThis.__p3a.store.rows.get(createdKey).data;
for (const body of ["Reply from Rowan", "Reply from Jules"]) {
  assert.equal(finalThread.comments.filter((comment) => comment.body === body).length, 1);
}
assert.equal(new Set(finalThread.comments.map((comment) => comment.id)).size, finalThread.comments.length);

response = await thread(request(`/api/threads/4b7d2a/${created.id}`, "PATCH", { status: "resolved" }), params("4b7d2a", created.id));
assert.equal(response.status, 200); const resolved = (await json(response)).thread;
assert.equal(resolved.status, "resolved"); assert.deepEqual(resolved.resolvedBy, created.author);
const resolvedAt = resolved.resolvedAt; const writesBeforeNoop = globalThis.__p3a.calls.filter((call) => call === "write").length;
response = await thread(request(`/api/threads/4b7d2a/${created.id}`, "PATCH", { status: "resolved" }), params("4b7d2a", created.id));
assert.equal((await json(response)).thread.resolvedAt, resolvedAt);
assert.equal(globalThis.__p3a.calls.filter((call) => call === "write").length, writesBeforeNoop);

response = await thread(request(`/api/threads/4b7d2a/${created.id}`, "POST", { body: "Resolved threads stay resolved" }), params("4b7d2a", created.id));
assert.equal((await json(response)).thread.status, "resolved");
response = await thread(request(`/api/threads/4b7d2a/${created.id}`, "PATCH", { status: "open" }), params("4b7d2a", created.id));
const reopened = (await json(response)).thread;
assert.equal(reopened.status, "open"); assert.equal(reopened.resolvedAt, null); assert.equal(reopened.resolvedBy, null);

const repliesBeforeReplay = reopened.comments.length;
for (let index = 0; index < 2; index += 1) {
  response = await thread(request(`/api/threads/4b7d2a/${created.id}`, "POST", { body: "An intentional replay" }), params("4b7d2a", created.id));
  assert.equal(response.status, 200);
}
finalThread = globalThis.__p3a.store.rows.get(createdKey).data;
assert.equal(finalThread.comments.length, repliesBeforeReplay + 2);
assert.equal(finalThread.comments.filter((comment) => comment.body === "An intentional replay").length, 2);

reset();
const baseCreate = validCreate();
const invalidCreateBodies = [
  ["create top null", null], ["create top array", []], ["create top primitive", 1],
  ...["kind", "section", "anchor", "docVersion", "body"].map((key) => [`comment missing ${key}`, omit(baseCreate, key)]),
  ["create extra", { ...baseCreate, unexpected: true }], ["client commentId", { ...baseCreate, commentId: "c_m8x2k1_1a2b3c4d" }],
  ["kind type", { ...baseCreate, kind: 1 }], ["kind value", { ...baseCreate, kind: "note" }],
  ["section type", { ...baseCreate, section: 1 }], ["section empty", { ...baseCreate, section: "" }],
  ["section grammar", { ...baseCreate, section: "Bad_section" }], ["section over 64", { ...baseCreate, section: `a${"b".repeat(64)}` }],
  ["docVersion type", { ...baseCreate, docVersion: 1 }], ["docVersion short", { ...baseCreate, docVersion: "7aaca5" }],
  ["docVersion long", { ...baseCreate, docVersion: "7aaca511" }], ["docVersion case", { ...baseCreate, docVersion: "7AACA51" }],
  ["body type", { ...baseCreate, body: 1 }], ["body empty", { ...baseCreate, body: "" }],
  ["body blank", { ...baseCreate, body: " \t" }], ["body over 8000", { ...baseCreate, body: "x".repeat(8001) }],
  ["comment title non-null", { ...baseCreate, title: "not allowed" }], ["anchor type", { ...baseCreate, anchor: null }],
  ...["block", "exact", "prefix", "suffix", "start"].map((key) => [`anchor missing ${key}`, { ...baseCreate, anchor: omit(baseCreate.anchor, key) }]),
  ["anchor extra", { ...baseCreate, anchor: { ...baseCreate.anchor, extra: true } }],
  ["anchor block type", { ...baseCreate, anchor: { ...baseCreate.anchor, block: 1 } }], ["anchor block grammar", { ...baseCreate, anchor: { ...baseCreate.anchor, block: "a3f19c2b" } }],
  ["anchor exact type", { ...baseCreate, anchor: { ...baseCreate.anchor, exact: 1 } }], ["anchor exact empty", { ...baseCreate, anchor: { ...baseCreate.anchor, exact: "" } }],
  ["anchor exact normalization", { ...baseCreate, anchor: { ...baseCreate.anchor, exact: "two  spaces" } }], ["anchor exact over 1000", { ...baseCreate, anchor: { ...baseCreate.anchor, exact: "x".repeat(1001) } }],
  ["anchor prefix type", { ...baseCreate, anchor: { ...baseCreate.anchor, prefix: 1 } }], ["anchor prefix normalization", { ...baseCreate, anchor: { ...baseCreate.anchor, prefix: "two  spaces" } }],
  ["anchor prefix over 32", { ...baseCreate, anchor: { ...baseCreate.anchor, prefix: "x".repeat(33) } }], ["anchor suffix type", { ...baseCreate, anchor: { ...baseCreate.anchor, suffix: 1 } }],
  ["anchor suffix normalization", { ...baseCreate, anchor: { ...baseCreate.anchor, suffix: "two  spaces" } }], ["anchor suffix over 32", { ...baseCreate, anchor: { ...baseCreate.anchor, suffix: "x".repeat(33) } }],
  ["anchor start type", { ...baseCreate, anchor: { ...baseCreate.anchor, start: "0" } }], ["anchor start negative", { ...baseCreate, anchor: { ...baseCreate.anchor, start: -1 } }],
  ["anchor start unsafe", { ...baseCreate, anchor: { ...baseCreate.anchor, start: Number.MAX_SAFE_INTEGER + 1 } }],
  ["discussion missing title", { kind: "discussion", section: "architecture", anchor: null, docVersion: "7aaca51", body: "Discuss" }],
  ["discussion title type", { kind: "discussion", section: "architecture", anchor: null, title: 1, docVersion: "7aaca51", body: "Discuss" }],
  ["discussion title blank", { kind: "discussion", section: "architecture", anchor: null, title: "  ", docVersion: "7aaca51", body: "Discuss" }],
  ["discussion title over 200", { kind: "discussion", section: "architecture", anchor: null, title: "x".repeat(201), docVersion: "7aaca51", body: "Discuss" }],
  ["discussion anchor non-null", { kind: "discussion", section: "architecture", anchor: baseCreate.anchor, title: "Discuss", docVersion: "7aaca51", body: "Discuss" }],
];
for (const [label, body] of invalidCreateBodies) {
  const beforeNow = nowCalls, beforeUuid = uuidCalls;
  response = await threads(request("/api/threads?doc=4b7d2a", "POST", body), {});
  assert.equal(response.status, 400, label); assert.equal((await json(response)).error.code, "invalid-body", label);
  assert.equal(globalThis.__p3a.calls.includes("write"), false, label);
  assert.equal(globalThis.__p3a.storeOpens, 0, label);
  assert.equal(nowCalls, beforeNow, label); assert.equal(uuidCalls, beforeUuid, label);
  reset();
}
const protoText = `${JSON.stringify(validCreate()).slice(0, -1)},"__proto__":{"polluted":true}}`;
response = await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: protoText }), {});
assert.equal(response.status, 400); assert.equal((await json(response)).error.code, "invalid-body"); assert.equal({}.polluted, undefined);
reset();
response = await threads(request("/api/threads?doc=4b7d2a", "POST", { ...validCreate("b".repeat(8000)), section: `a${"b".repeat(62)}c`, anchor: { block: "affffffff", exact: "x".repeat(1000), prefix: "p".repeat(32), suffix: "s".repeat(32), start: Number.MAX_SAFE_INTEGER } }), {});
assert.equal(response.status, 201, "valid comment scalar upper boundaries");
reset(); response = await threads(request("/api/threads?doc=4b7d2a", "POST", { kind: "discussion", section: `a${"b".repeat(62)}c`, anchor: null, title: "t".repeat(200), docVersion: "7aaca51", body: "b".repeat(8000) }), {});
assert.equal(response.status, 201, "valid discussion scalar upper boundaries");
reset(); globalThis.__p3a.user = { sub: `u${"a".repeat(127)}`, name: "n".repeat(200), email: `${"l".repeat(64)}@${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(61)}`, isOrg: false };
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 201, "valid actor scalar upper boundaries");
reset(); globalThis.__p3a.user = { sub: "u", name: "", email: "", isOrg: false };
response = await threads(request("/api/threads?doc=4b7d2a", "POST", { kind: "comment", section: "a", anchor: { block: "a00000000", exact: "x", prefix: "", suffix: "", start: 0 }, docVersion: "0000000", body: "x" }), {});
assert.equal(response.status, 201, "valid actor scalar lower/special-empty boundaries");
reset(); response = await threads(request("/api/threads?doc=4b7d2a", "POST", { kind: "discussion", section: "a", anchor: null, title: " padded title ", docVersion: "7aaca51", body: " padded body " }), {});
const preservedWhitespace = (await json(response)).thread; assert.equal(response.status, 201); assert.equal(preservedWhitespace.title, " padded title "); assert.equal(preservedWhitespace.comments[0].body, " padded body ");
for (const [label, contentType] of [["missing media type", null], ["wrong media type", "text/plain"], ["malformed media parameter", "application/json; charset"]]) {
  reset(); const mediaHeaders = { origin }; if (contentType !== null) mediaHeaders["content-type"] = contentType;
  response = await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: mediaHeaders, body: "{}" }), {});
  assert.equal(response.status, 415, label); assert.equal((await json(response)).error.code, "unsupported-media-type", label);
}

reset(); globalThis.__p3a.store.forceCollision = true;
const nowBeforeCollision = nowCalls, uuidBeforeCollision = uuidCalls;
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 409); assert.equal((await json(response)).error.code, "id-collision");
assert.equal(nowCalls - nowBeforeCollision, 1); assert.equal(uuidCalls - uuidBeforeCollision, 2);
assert.equal(globalThis.__p3a.calls.filter((call) => call === "write").length, 1); assert.equal(globalThis.__p3a.calls.some((call) => call === "read" || call === "list"), false);

reset(); globalThis.__p3a.store.malformedWrite = true;
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset(); globalThis.__p3a.store.failList = true;
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset(); globalThis.__p3a.store.malformedPage = true;
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset(); globalThis.__p3a.store.oversizedPage = true;
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");
assert.equal(globalThis.__p3a.listPages, 1); assert.equal(globalThis.__p3a.calls.includes("read"), false);

const installPages = (pages, { nextError = null, malformedResult = false, returnError = false } = {}) => {
  let pulls = 0, returns = 0;
  globalThis.__p3a.store.list = () => ({ [Symbol.asyncIterator]() { let index = 0; return {
    async next() {
      pulls += 1;
      if (nextError) throw nextError;
      if (malformedResult) return null;
      if (index < pages.length) return { done: false, value: pages[index++] };
      return { done: true, value: undefined };
    },
    async return() { returns += 1; if (returnError) throw new Error("private iterator return failure"); return { done: true, value: undefined }; },
  }; } });
  return { pulls: () => pulls, returns: () => returns };
};
const listedKey = "threads/4b7d2a/t_m8x2k1_4f7a9c31.json";
const sparseBlobs = new Array(1), extendedBlobs = []; extendedBlobs.extra = true;
const symbolPage = { blobs: [] }; symbolPage[Symbol("extra")] = true;
for (const [label, page] of [
  ["page null", null], ["page array", []], ["page missing blobs", {}], ["page blobs type", { blobs: null }],
  ["page custom prototype", Object.assign(Object.create(null), { blobs: [] })], ["page symbol", symbolPage], ["page sparse blobs", { blobs: sparseBlobs }], ["page extra array key", { blobs: extendedBlobs }],
]) {
  reset(); installPages([page]); response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 503, label); assert.equal((await json(response)).error.code, "unavailable", label);
}
reset();
let blobsGetterReads = 0;
const hostilePage = {}; Object.defineProperty(hostilePage, "blobs", { enumerable: true, get() { blobsGetterReads += 1; throw new Error("must not execute blobs getter"); } });
installPages([hostilePage]); response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal(blobsGetterReads, 0);

const symbolEntry = { key: listedKey }; symbolEntry[Symbol("extra")] = true;
for (const [label, page] of [
  ["entry null", { blobs: [null] }], ["entry array", { blobs: [[listedKey]] }], ["entry custom prototype", { blobs: [Object.assign(Object.create(null), { key: listedKey })] }], ["entry symbol", { blobs: [symbolEntry] }],
  ["entry key type", { blobs: [{ key: 17 }] }],
  ["entry missing key", { blobs: [{}] }],
  ["entry overlong key", { blobs: [{ key: "x".repeat(97) }] }],
]) {
  reset(); installPages([page]); response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 503, label); assert.equal((await json(response)).error.code, "unavailable", label);
}
reset();
let keyGetterReads = 0;
const hostileEntry = {}; Object.defineProperty(hostileEntry, "key", { enumerable: true, get() { keyGetterReads += 1; throw new Error("must not execute key getter"); } });
installPages([{ blobs: [hostileEntry] }]); response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal(keyGetterReads, 0);

for (const [label, keys] of [
  ["malformed listed key", ["threads/4b7d2a/not-a-thread.json"]],
  ["wrong-prefix listed key", ["threads/ffffff/t_m8x2k1_4f7a9c31.json"]],
  ["duplicate listed key", [listedKey, listedKey]],
]) {
  reset(); const iterator = installPages([{ blobs: keys.map((key) => ({ key })) }], { returnError: true });
  response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label); assert.equal(iterator.returns(), 1, label);
}

reset(); globalThis.__p3a.store.list = () => ({});
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset();
let resultGetterReads = 0;
globalThis.__p3a.store.list = () => ({ [Symbol.asyncIterator]() { return { next() { const result = {}; Object.defineProperty(result, "done", { enumerable: true, get() { resultGetterReads += 1; throw new Error("must not execute done getter"); } }); return Promise.resolve(result); }, async return() { return { done: true }; } }; } });
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal(resultGetterReads, 0);

const symbolResult = { done: true }; symbolResult[Symbol("extra")] = true;
for (const [label, result] of [
  ["iterator result missing done", {}], ["iterator result done type", { done: "false", value: { blobs: [] } }],
  ["iterator result missing value", { done: false }], ["iterator result custom prototype", Object.assign(Object.create(null), { done: true })],
  ["iterator result symbol", symbolResult],
]) {
  reset(); globalThis.__p3a.store.list = () => ({ [Symbol.asyncIterator]() { return { async next() { return result; }, async return() { return { done: true }; } }; } });
  response = await threads(request("/api/threads?doc=4b7d2a"), {}); assert.equal(response.status, 503, label); assert.equal((await json(response)).error.code, "unavailable", label);
}

reset(); const malformedIterator = installPages([], { malformedResult: true, returnError: true });
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal(malformedIterator.pulls(), 1); assert.equal(malformedIterator.returns(), 1);

reset(); const rejectedIterator = installPages([], { nextError: new Error("private provider next failure"), returnError: true });
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal(rejectedIterator.pulls(), 1); assert.equal(rejectedIterator.returns(), 1);

reset(); globalThis.__p3a.store.seed(listedKey, {
  v: 1, id: "t_m8x2k1_4f7a9c31", docId: "4b7d2a", kind: "discussion", status: "open", section: "architecture", anchor: null,
  title: "Provider read", docVersion: "7aaca51", createdAt: "2026-09-03T16:04:11.221Z", author: { sub: "u_demo_482", name: "River Vale", email: "river@review.invalid" },
  resolvedAt: null, resolvedBy: null, comments: [{ id: "c_m8x2k1_1a2b3c4d", body: "Read me", author: { sub: "u_demo_482", name: "River Vale", email: "river@review.invalid" }, createdAt: "2026-09-03T16:04:11.221Z", editedAt: null }],
});
globalThis.__p3a.store.getWithMetadata = async () => { throw new FixtureStoreError("unavailable", 503, "private read failure"); };
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset(); globalThis.__p3a.store.setJSON = async () => { throw new Error("private direct-write failure"); };
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable");

reset();
let modifiedGetterReads = 0;
globalThis.__p3a.store.setJSON = async () => { const result = {}; Object.defineProperty(result, "modified", { enumerable: true, get() { modifiedGetterReads += 1; throw new Error("must not execute modified getter"); } }); return result; };
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 503); assert.equal(modifiedGetterReads, 0);

reset();
let ignoredProviderReads = 0;
globalThis.__p3a.store.setJSON = async () => { const result = Object.create({ inherited: "ignored" }); Object.defineProperty(result, "modified", { value: true, enumerable: true }); Object.defineProperty(result, "secret", { enumerable: true, get() { ignoredProviderReads += 1; throw new Error("must ignore extra provider field"); } }); return result; };
response = await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {});
assert.equal(response.status, 201); assert.equal(ignoredProviderReads, 0);

const afterAllFixtureKeys = `t_${"z".repeat(48)}_ffffffff`;
reset();
const tenPages = Array.from({ length: 10 }, (_, page) => ({ blobs: Array.from({ length: 1000 }, (_, row) => {
  const item = page * 1000 + row; return { key: `threads/4b7d2a/t_page${item.toString(36)}_${item.toString(16).padStart(8, "0")}.json` };
}) }));
const tenPageIterator = installPages(tenPages);
response = await threads(request(`/api/threads?doc=4b7d2a&cursor=${afterAllFixtureKeys}`), {});
assert.equal(response.status, 200); assert.deepEqual(await json(response), { threads: [], nextCursor: null }); assert.equal(tenPageIterator.pulls(), 11); assert.equal(tenPageIterator.returns(), 0); assert.equal(globalThis.__p3a.calls.includes("read"), false);

reset(); globalThis.__p3a.store.forcedPages = 11; globalThis.__p3a.store.forcedPageWidth = 1000;
response = await threads(request(`/api/threads?doc=4b7d2a&cursor=${afterAllFixtureKeys}`), {});
assert.equal(response.status, 503); assert.equal((await json(response)).error.code, "unavailable"); assert.equal(globalThis.__p3a.listPages, 11); assert.equal(globalThis.__p3a.eleventhPageTouches, 0); assert.equal(globalThis.__p3a.calls.includes("read"), false);

reset();
response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "No record" }), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 404);

reset();
const seed = {
  v: 1, id: "t_m8x2k1_4f7a9c31", docId: "4b7d2a", kind: "discussion", status: "open", section: "architecture",
  anchor: null, title: "Retry behavior", docVersion: "7aaca51", createdAt: "2026-09-03T16:04:11.221Z",
  author: { sub: "u_demo_482", name: "River Vale", email: "river@review.invalid" }, resolvedAt: null, resolvedBy: null,
  comments: [{ id: "c_m8x2k1_1a2b3c4d", body: "How are conflicts surfaced?", author: { sub: "u_demo_482", name: "River Vale", email: "river@review.invalid" }, createdAt: "2026-09-03T16:04:11.221Z", editedAt: null }],
};
const seedKey = "threads/4b7d2a/t_m8x2k1_4f7a9c31.json";
const storedComment = { ...clone(seed), kind: "comment", anchor: clone(baseCreate.anchor), title: null };
const invalidStored = [["thread null", null], ["thread array", []], ["thread primitive", 1]];
for (const key of ["v", "id", "docId", "kind", "status", "section", "anchor", "title", "docVersion", "createdAt", "author", "resolvedAt", "resolvedBy", "comments"]) invalidStored.push([`thread missing ${key}`, omit(seed, key)]);
invalidStored.push(
  ["thread extra", { ...clone(seed), extra: true }], ["version type", { ...clone(seed), v: "1" }], ["version value", { ...clone(seed), v: 2 }],
  ["thread id type", { ...clone(seed), id: 1 }], ["thread id grammar", { ...clone(seed), id: "bad" }], ["thread key/id relation", { ...clone(seed), id: "t_other_12345678" }],
  ["document type", { ...clone(seed), docId: 1 }], ["document grammar", { ...clone(seed), docId: "ABC123" }], ["document key/body relation", { ...clone(seed), docId: "ffffff" }],
  ["kind type", { ...clone(seed), kind: 1 }], ["kind value", { ...clone(seed), kind: "note" }], ["comment anchor coupling", { ...clone(storedComment), anchor: null }],
  ["comment title coupling", { ...clone(storedComment), title: "not null" }],
  ["discussion anchor coupling", { ...clone(seed), kind: "discussion", anchor: clone(seed.anchor), title: "Discussion" }],
  ["discussion title coupling", { ...clone(seed), kind: "discussion", anchor: null, title: null }],
  ["discussion title type", { ...clone(seed), kind: "discussion", anchor: null, title: 1 }],
  ["discussion title blank", { ...clone(seed), kind: "discussion", anchor: null, title: " " }],
  ["discussion title length", { ...clone(seed), kind: "discussion", anchor: null, title: "x".repeat(201) }],
  ["status type", { ...clone(seed), status: 1 }], ["status value", { ...clone(seed), status: "closed" }],
  ["open resolution coupling", { ...clone(seed), resolvedAt: seed.createdAt, resolvedBy: clone(seed.author) }],
  ["resolved resolution coupling", { ...clone(seed), status: "resolved", resolvedAt: null, resolvedBy: null }],
  ["resolved timestamp", { ...clone(seed), status: "resolved", resolvedAt: "bad", resolvedBy: clone(seed.author) }],
  ["resolved actor", { ...clone(seed), status: "resolved", resolvedAt: seed.createdAt, resolvedBy: { ...clone(seed.author), extra: true } }],
  ["section type", { ...clone(seed), section: 1 }], ["section grammar", { ...clone(seed), section: "Bad_section" }], ["section length", { ...clone(seed), section: `a${"b".repeat(64)}` }],
  ["document version type", { ...clone(seed), docVersion: 1 }], ["document version length", { ...clone(seed), docVersion: "abc123" }], ["document version grammar", { ...clone(seed), docVersion: "ABC1234" }],
  ["created timestamp type", { ...clone(seed), createdAt: 1 }], ["created timestamp grammar/realness", { ...clone(seed), createdAt: "2026-02-30T00:00:00.000Z" }],
);
for (const key of ["block", "exact", "prefix", "suffix", "start"]) invalidStored.push([`anchor missing ${key}`, { ...clone(storedComment), anchor: omit(storedComment.anchor, key) }]);
invalidStored.push(
  ["anchor extra", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), extra: true } }], ["anchor block type", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), block: 1 } }],
  ["anchor block grammar", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), block: "bad" } }], ["anchor exact type", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), exact: 1 } }],
  ["anchor exact empty", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), exact: "" } }], ["anchor exact normalization", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), exact: "two  spaces" } }], ["anchor exact length", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), exact: "x".repeat(1001) } }],
  ["anchor prefix type", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), prefix: 1 } }], ["anchor prefix normalization", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), prefix: "two  spaces" } }],
  ["anchor prefix length", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), prefix: "x".repeat(33) } }], ["anchor suffix type", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), suffix: 1 } }],
  ["anchor suffix normalization", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), suffix: "two  spaces" } }], ["anchor suffix length", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), suffix: "x".repeat(33) } }],
  ["anchor start type", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), start: "0" } }], ["anchor start negative", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), start: -1 } }],
  ["anchor start unsafe", { ...clone(storedComment), anchor: { ...clone(storedComment.anchor), start: Number.MAX_SAFE_INTEGER + 1 } }],
);
for (const key of ["sub", "name", "email"]) invalidStored.push([`actor missing ${key}`, { ...clone(seed), author: omit(seed.author, key) }]);
invalidStored.push(
  ["actor null", { ...clone(seed), author: null }], ["actor array", { ...clone(seed), author: [] }],
  ["actor extra", { ...clone(seed), author: { ...clone(seed.author), extra: true } }], ["actor sub type", { ...clone(seed), author: { ...clone(seed.author), sub: 1 } }],
  ["actor sub grammar", { ...clone(seed), author: { ...clone(seed.author), sub: "-bad" } }], ["actor name type", { ...clone(seed), author: { ...clone(seed.author), name: 1 } }],
  ["actor name length", { ...clone(seed), author: { ...clone(seed.author), name: "x".repeat(201) } }], ["actor email type", { ...clone(seed), author: { ...clone(seed.author), email: 1 } }],
  ["actor email normalization", { ...clone(seed), author: { ...clone(seed.author), email: "River@review.invalid" } }], ["actor email grammar", { ...clone(seed), author: { ...clone(seed.author), email: "invalid" } }],
  ["actor email length", { ...clone(seed), author: { ...clone(seed.author), email: `${"a".repeat(65)}@example.invalid` } }],
  ["comments type", { ...clone(seed), comments: {} }], ["comments empty", { ...clone(seed), comments: [] }],
  ["comments over 500", { ...clone(seed), comments: Array.from({ length: 501 }, (_, index) => ({ ...clone(seed.comments[0]), id: `c_row${index.toString(36)}_${index.toString(16).padStart(8, "0")}` })) }],
);
for (const key of ["id", "body", "author", "createdAt", "editedAt"]) invalidStored.push([`comment missing ${key}`, { ...clone(seed), comments: [omit(seed.comments[0], key)] }]);
invalidStored.push(
  ["comment row null", { ...clone(seed), comments: [null] }], ["comment row array", { ...clone(seed), comments: [[]] }], ["comment row primitive", { ...clone(seed), comments: [1] }],
  ["comment extra", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), extra: true }] }], ["comment id type", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), id: 1 }] }],
  ["comment id grammar", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), id: "bad" }] }], ["comment id duplicate", { ...clone(seed), comments: [clone(seed.comments[0]), clone(seed.comments[0])] }],
  ["comment body type", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), body: 1 }] }], ["comment body bound", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), body: "x".repeat(8001) }] }],
  ["comment body blank", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), body: " " }] }],
  ["comment actor type", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), author: null }] }], ["comment actor shape", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), author: { ...clone(seed.author), extra: true } }] }],
  ["comment created timestamp", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), createdAt: "bad" }] }],
  ["comment edited timestamp type", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), editedAt: 1 }] }],
  ["comment edited timestamp grammar", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), editedAt: "bad" }] }],
  ["first-comment author relation", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), author: { ...clone(seed.author), name: "Different" } }] }],
  ["first-comment time relation", { ...clone(seed), comments: [{ ...clone(seed.comments[0]), createdAt: "2026-09-03T16:04:12.221Z" }] }],
);
for (const [label, value] of invalidStored) {
  reset(); globalThis.__p3a.store.seed(seedKey, value); response = await threads(request("/api/threads?doc=4b7d2a"), {});
  assert.equal(response.status, 500, label); assert.equal((await json(response)).error.code, "invalid-state", label);
}
reset();
const emptyActorThread = clone(seed); emptyActorThread.author = { sub: "u", name: "", email: "" }; emptyActorThread.comments[0].author = clone(emptyActorThread.author);
globalThis.__p3a.store.seed(seedKey, emptyActorThread); response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 200, "valid stored actor lower/special-empty boundaries");
for (const [label, body] of [
  ["reply top null", null], ["reply top array", []], ["reply missing body", {}], ["reply extra", { body: "valid", extra: true }],
  ["reply client commentId", { body: "valid", commentId: "c_m8x2k1_1a2b3c4d" }], ["reply body type", { body: 1 }],
  ["reply body empty", { body: "" }], ["reply body blank", { body: "  " }], ["reply body over 8000", { body: "x".repeat(8001) }],
  ["reply/status mixture", { body: "valid", status: "open" }],
]) {
  reset(); globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", seed);
  response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", body), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
  assert.equal(response.status, 400, label); assert.equal((await json(response)).error.code, "invalid-body", label); assert.equal(globalThis.__p3a.calls.includes("write"), false, label);
}
for (const [label, body] of [
  ["status top null", null], ["status top array", []], ["status missing", {}], ["status extra", { status: "open", extra: true }],
  ["status type", { status: 1 }], ["status value", { status: "closed" }], ["status/body mixture", { status: "open", body: "invalid" }],
]) {
  reset(); globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", seed);
  response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "PATCH", body), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
  assert.equal(response.status, 400, label); assert.equal((await json(response)).error.code, "invalid-body", label); assert.equal(globalThis.__p3a.calls.includes("write"), false, label);
}

reset(); globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", seed);
response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "hostile fields are ignored", author: { forged: true }, email: ["forged"], name: 17 }), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 200); const hostileReply = (await json(response)).thread.comments.at(-1);
assert.deepEqual(hostileReply.author, { sub: serverUser.sub, name: serverUser.name, email: serverUser.email }); assert.equal(hostileReply.body, "hostile fields are ignored");
const cappedComments = Array.from({ length: 500 }, (_, index) => ({
  ...clone(seed.comments[0]), id: `c_cap${index.toString(36)}_${index.toString(16).padStart(8, "0")}`,
}));

reset();
const cappedThread = { ...clone(seed), comments: cappedComments };
globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", cappedThread);
response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "The five-hundred-first reply is refused" }), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 409); assert.deepEqual(await json(response), { error: { code: "comment-limit", message: "Thread comment limit reached" } });
assert.equal(globalThis.__p3a.calls.filter((call) => call === "write").length, 0);
assert.equal(globalThis.__p3a.store.rows.get("threads/4b7d2a/t_m8x2k1_4f7a9c31.json").data.comments.length, 500);

reset();
const corruptOversizedThread = { ...clone(cappedThread), comments: [...clone(cappedComments), { ...clone(seed.comments[0]), id: "c_overflow_ffffffff" }] };
globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", corruptOversizedThread);
response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "PATCH", { status: "resolved" }), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 500); assert.equal((await json(response)).error.code, "invalid-state");

const middle48 = "a".repeat(48), middle49 = "a".repeat(49);
const boundaryId = `t_${middle48}_12345678`;
const boundarySeed = clone(seed); boundarySeed.id = boundaryId; boundarySeed.comments[0].id = `c_${"b".repeat(48)}_87654321`;
globalThis.__p3a.store.seed(`threads/4b7d2a/${boundaryId}.json`, boundarySeed);
response = await thread(request(`/api/threads/4b7d2a/${boundaryId}`, "POST", { body: "Forty-eight is accepted" }), params("4b7d2a", boundaryId));
assert.equal(response.status, 200);

reset();
const overlongId = `t_${middle49}_12345678`;
response = await thread(request(`/api/threads/4b7d2a/${overlongId}`, "POST", { body: "Forty-nine is rejected" }), params("4b7d2a", overlongId));
assert.equal(response.status, 400);

reset();
const badCommentSeed = clone(boundarySeed); badCommentSeed.comments[0].id = `c_${"b".repeat(49)}_87654321`;
globalThis.__p3a.store.seed(`threads/4b7d2a/${boundaryId}.json`, badCommentSeed);
response = await thread(request(`/api/threads/4b7d2a/${boundaryId}`, "POST", { body: "Stored overlong comment is rejected" }), params("4b7d2a", boundaryId));
assert.equal(response.status, 500); assert.equal((await json(response)).error.code, "invalid-state");

reset(); globalThis.__p3a.store.conflicts = 6;
globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_4f7a9c31.json", seed);
response = await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "A bounded conflict" }), params("4b7d2a", "t_m8x2k1_4f7a9c31"));
assert.equal(response.status, 409); assert.equal(globalThis.__p3a.mutateCalls, 1);

reset();
for (const [id, title] of [["t_m8x2k1_11111111", "First"], ["t_m8x2k2_22222222", "Second"], ["t_m8x2k3_33333333", "Third"]]) {
  const row = clone(seed); row.id = id; row.title = title;
  globalThis.__p3a.store.seed(`threads/4b7d2a/${id}.json`, row);
}
globalThis.__p3a.store.vanish.add("threads/4b7d2a/t_m8x2k1_11111111.json");
response = await threads(request("/api/threads?doc=4b7d2a&limit=2"), {});
let page = await json(response);
assert.deepEqual(page.threads.map((item) => item.id), ["t_m8x2k2_22222222", "t_m8x2k3_33333333"]);
assert.equal(page.nextCursor, null);
globalThis.__p3a.store.seed("threads/4b7d2a/t_m8x2k1_11111111.json", { ...clone(seed), id: "t_m8x2k1_11111111", title: "First" });
response = await threads(request(`/api/threads?doc=4b7d2a&limit=2&cursor=${page.nextCursor}`), {});
page = await json(response);
assert.equal(response.status, 400);

response = await threads(request("/api/threads?doc=4b7d2a&limit=2"), {});
page = await json(response);
assert.deepEqual(page.threads.map((item) => item.id), ["t_m8x2k1_11111111", "t_m8x2k2_22222222"]);
assert.equal(page.nextCursor, "t_m8x2k2_22222222");
response = await threads(request(`/api/threads?doc=4b7d2a&limit=2&cursor=${page.nextCursor}`), {});
page = await json(response);
assert.deepEqual(page.threads.map((item) => item.id), ["t_m8x2k3_33333333"]); assert.equal(page.nextCursor, null);

globalThis.__p3a.store.rows.get("threads/4b7d2a/t_m8x2k3_33333333.json").data.docId = "ffffff";
response = await threads(request("/api/threads?doc=4b7d2a"), {});
assert.equal(response.status, 500);
const publicError = await json(response);
assert.deepEqual(publicError, { error: { code: "invalid-state", message: "Invalid thread state" } });
assert.doesNotMatch(JSON.stringify(publicError), /ffffff|avery|river|etag|threads\//i);

reset();
const budgetIds = [];
for (let index = 0; index < 11; index += 1) {
  const id = `t_budget${String(index).padStart(2, "0")}_${index.toString(16).padStart(8, "0")}`;
  budgetIds.push(id);
  globalThis.__p3a.store.seed(`threads/4b7d2a/${id}.json`, { ...clone(seed), id, title: `Budget row ${index + 1}`, comments: clone(cappedComments) });
}
response = await threads(request("/api/threads?doc=4b7d2a&limit=100"), {});
const budgetPage = await json(response);
assert.deepEqual(budgetPage.threads.map((item) => item.id), budgetIds.slice(0, 10));
assert.equal(budgetPage.threads.reduce((sum, item) => sum + item.comments.length, 0), 5000);
assert.equal(budgetPage.nextCursor, budgetIds[9]);
response = await threads(request(`/api/threads?doc=4b7d2a&limit=100&cursor=${budgetPage.nextCursor}`), {});
const budgetTail = await json(response);
assert.deepEqual(budgetTail.threads.map((item) => item.id), [budgetIds[10]]);
assert.equal(budgetTail.threads[0].comments.length, 500); assert.equal(budgetTail.nextCursor, null);

// Complete finite public-error/status/header matrix.
reset(); await assertPublicError(await threads(request("/api/threads?doc=4b7d2a", "PUT"), {}), 405, "method-not-allowed", "Method not allowed", "GET, POST");
reset(); await assertPublicError(await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "GET"), params("4b7d2a", "t_m8x2k1_4f7a9c31")), 405, "method-not-allowed", "Method not allowed", "POST, PATCH");
reset(); globalThis.__p3a.user = null; await assertPublicError(await threads(request("/api/threads?doc=4b7d2a"), {}), 401, "unauthenticated", "Authentication required");
reset(); globalThis.__p3a.accessResult = accessResultFor("none", true); await assertPublicError(await threads(request("/api/threads?doc=4b7d2a"), {}), 403, "forbidden", "Document access denied");
reset(); await assertPublicError(await threads(request("/api/threads?doc=bad"), {}), 400, "invalid-request", "Invalid request");
reset(); await assertPublicError(await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: { origin }, body: "{}" }), {}), 415, "unsupported-media-type", "Content-Type must be application/json");
reset(); await assertPublicError(await threads(streamRequest("/api/threads?doc=4b7d2a", [exactBytes, Uint8Array.of(0x20)]).request, {}), 413, "payload-too-large", "Request body exceeds 65536 bytes");
reset(); await assertPublicError(await threads(new Request(`${origin}/api/threads?doc=4b7d2a`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" }), {}), 400, "invalid-body", "Invalid request body");
reset(); await assertPublicError(await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "No record" }), params("4b7d2a", "t_m8x2k1_4f7a9c31")), 404, "not-found", "Thread not found");
reset(); globalThis.__p3a.store.seed(seedKey, seed); globalThis.__p3a.store.conflicts = 6;
await assertPublicError(await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "Conflict" }), params("4b7d2a", "t_m8x2k1_4f7a9c31")), 409, "conflict", "Concurrent update limit reached");
reset(); globalThis.__p3a.store.forceCollision = true; await assertPublicError(await threads(request("/api/threads?doc=4b7d2a", "POST", validCreate()), {}), 409, "id-collision", "Generated identifier collision");
reset(); globalThis.__p3a.store.seed(seedKey, cappedThread); await assertPublicError(await thread(request("/api/threads/4b7d2a/t_m8x2k1_4f7a9c31", "POST", { body: "Over cap" }), params("4b7d2a", "t_m8x2k1_4f7a9c31")), 409, "comment-limit", "Thread comment limit reached");
reset(); globalThis.__p3a.store.seed(seedKey, { ...clone(seed), docId: "ffffff" }); await assertPublicError(await threads(request("/api/threads?doc=4b7d2a"), {}), 500, "invalid-state", "Invalid thread state");
reset(); globalThis.__p3a.store.failList = true; await assertPublicError(await threads(request("/api/threads?doc=4b7d2a"), {}), 503, "unavailable", "Thread store unavailable");

console.log("PASS  P3-A endpoint contract");
NODE

cat >"$fixture_root/supervisor-child.mjs" <<'NODE'
import { writeFileSync } from "node:fs";
writeFileSync(process.env.P3A_CHILD_PID_FILE, `${process.pid}\n`, { mode: 0o600 });
if (process.env.P3A_IGNORE_TERM === "1") process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
NODE

cat >"$fixture_root/supervisor.mjs" <<'NODE'
import { spawn } from "node:child_process";
const target = process.argv[2];
if (!target) throw new Error("missing supervised target");
const deadlineMs = Number(process.env.P3A_DEADLINE_MS ?? 30_000), killMs = Number(process.env.P3A_KILL_MS ?? 2_000);
if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || !Number.isSafeInteger(killMs) || killMs < 1) throw new Error("invalid supervisor deadline");
let firstSignal = null, timedOut = false, killTimer;
const statuses = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
let child = null;
let outputOverflow = false;
const captured = { stdout: [], stderr: [] };
const sizes = { stdout: 0, stderr: 0 };
const signalChild = (signal) => { try { child?.kill(signal); } catch {} };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {
  firstSignal ||= signal; signalChild(signal); killTimer ||= setTimeout(() => signalChild("SIGKILL"), killMs);
});
child = spawn(process.execPath, [target], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
for (const name of ["stdout", "stderr"]) child[name].on("data", (chunk) => {
  sizes[name] += chunk.byteLength;
  if (sizes[name] > 4096) { outputOverflow = true; signalChild("SIGTERM"); return; }
  captured[name].push(chunk);
});
const deadline = setTimeout(() => {
  timedOut = true; signalChild("SIGTERM"); killTimer ||= setTimeout(() => signalChild("SIGKILL"), killMs);
}, deadlineMs);
const result = await new Promise((resolve, reject) => {
  child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
});
clearTimeout(deadline); if (killTimer) clearTimeout(killTimer);
if (firstSignal) process.exit(statuses[firstSignal]);
if (timedOut) process.exit(124);
if (result.signal) process.exit(statuses[result.signal] ?? 1);
if (outputOverflow || result.code !== 0) process.exit(result.code || 1);
const stdout = Buffer.concat(captured.stdout).toString("utf8");
const stderr = Buffer.concat(captured.stderr).toString("utf8");
const expected = target.endsWith("check.mjs") ? "PASS  P3-A structural source boundary\nPASS  P3-A endpoint contract\n" : "";
if (stdout !== expected || stderr !== "") process.exit(1);
process.stdout.write(stdout);
NODE

cat >"$fixture_root/supervisor-selftest.mjs" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
const root = process.cwd(), supervisor = join(root, "supervisor.mjs"), worker = join(root, "supervisor-child.mjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; } };
async function probe(label, expected, { signal = null, timeout = false } = {}) {
  const pidFile = join(root, `child-${label}.pid`); rmSync(pidFile, { force: true });
  const env = { ...process.env, P3A_CHILD_PID_FILE: pidFile, P3A_DEADLINE_MS: timeout ? "50" : "2000", P3A_KILL_MS: "100", P3A_IGNORE_TERM: timeout ? "1" : "0" };
  const runner = spawn(process.execPath, [supervisor, worker], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; runner.stderr.setEncoding("utf8"); runner.stderr.on("data", (chunk) => { stderr += chunk; });
  let childPid = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { childPid = Number(readFileSync(pidFile, "utf8").trim()); break; } catch { await delay(10); }
  }
  assert(Number.isSafeInteger(childPid) && childPid > 1, `${label} child did not become ready`);
  if (signal) runner.kill(signal);
  const result = await new Promise((resolve, reject) => { runner.once("error", reject); runner.once("close", (code, closedSignal) => resolve({ code, signal: closedSignal })); });
  assert.deepEqual(result, { code: expected, signal: null }, label); assert.equal(stderr, "", label); assert.equal(alive(childPid), false, `${label} child remained`);
  rmSync(pidFile, { force: true });
}
await probe("hup", 129, { signal: "SIGHUP" });
await probe("int", 130, { signal: "SIGINT" });
await probe("term", 143, { signal: "SIGTERM" });
await probe("timeout", 124, { timeout: true });
console.log("PASS  P3-A supervisor signal and timeout paths");
NODE

(cd "$fixture_root" && node supervisor-selftest.mjs && node supervisor.mjs check.mjs) &
fixture_pid=$!
fixture_deadline=$((SECONDS + 30))
while kill -0 "$fixture_pid" 2>/dev/null; do
  if test "$SECONDS" -ge "$fixture_deadline"; then
    printf '%s\n' 'ERROR  P3-A fixture exceeded 30 seconds' >&2
    latched_status=124
    stop_child
    exit 124
  fi
  sleep 0.05
done
set +e
wait "$fixture_pid"
fixture_status=$?
set -e
fixture_pid=
test "$fixture_status" -eq 0
printf '%s\n' 'PASS  P3-A deterministic fixture'
```

Expected output and exit status are exactly:

```text
PASS  P3-A supervisor signal and timeout paths
PASS  P3-A structural source boundary
PASS  P3-A endpoint contract
PASS  P3-A deterministic fixture
```

This command is the complete P3-A deterministic fixture and executes the exact finite equivalence matrices named in the acceptance criteria and traceability table. The shared supervisor captures stdout and stderr independently, terminates a child if either exceeds 4,096 bytes, accepts empty output from its signal-probe worker and only the exact two declared lines from `check.mjs`, then re-emits accepted stdout after a clean close. It covers every public-error row, both unsupported-method routes, the named request/scalar/schema/provider classes, duplicate listed keys, direct-write/read/list failures, descriptor-hostile public classification, and supervisor signal/timeout paths. The TypeScript AST ban includes direct or aliased access through the named global objects. It makes no impossible claim to enumerate the infinite set of strings outside a grammar or every runtime failure value: one named boundary representative is used for each declared equivalence class. No acceptance test may stub the function body, copy its logic into the oracle, pass by inspecting only prose, or replace the AST/behavior oracles with lexical regex.

Acceptance traceability is exact:

| Contract group | Deterministic oracle | Hosted oracle |
|---|---|---|
| exports, routes, methods, forbidden imports/files | exact runtime export/config/function shapes; TypeScript AST import and forbidden-API oracle; both 405 rows with exact bodies/headers | deployed route smoke |
| origin, identity, and read authorization | foreign-origin create stops at origin; signed-out and malformed-query GET stop before access; readable, denied, unavailable, malformed-result, and unexpected-rejection GET prove access before thread storage | same-origin, foreign-origin, missing-origin, signed-out, readable, and denied requests named below |
| query/media/body inputs and public errors | named query/path/media/content-length/create/reply/status matrices; exact 65,536-byte accepted JSON; overflow/read-error/wrong-chunk/invalid-UTF-8 lifecycles; exact body/header for every public status | representative deployed 400/401/403/404/405/415 cases |
| actor/anchor/thread schema and key/body agreement | named identity/access/request and complete persisted top-level/anchor/actor/comment/coupling matrix; hostile ignored actor fields; 48/49 ID, 500/501 comment, duplicate-ID, timestamp, and key/body boundaries | create/list/reply/resolve/reopen response bodies |
| create-only/collision/indeterminate result | AST-proven sole three-argument `{ onlyIfNew: true }` direct write; success, collision, malformed value/accessor, and throw | two created disposable keys and each direct response without relist dependence |
| provider/public pagination and list races | reversed pages; cursor traversal; provider iterator/result/page/entry/accessor/rejection/return-rejection matrix; malformed/wrong-prefix/duplicate keys; 1,001-entry page; exact ten-page exhaustion; opaque eleventh-page 503; hidden/vanish/read rejection; 5,000/5,500-comment traversal | `limit=1` traversal to `nextCursor: null` |
| CAS purity and concurrency | fake ETag barrier, six-conflict reply, and ID/time/random counters for create/race | two simultaneous Promise-all replies both present once |
| state/replay idempotency | repeated resolve with no new write, resolved-thread reply, reopen, and repeated reply with distinct IDs | repeated resolve plus intentional reply replay |
| P4-M mutation exclusion | AST proves `thread.mjs` has no access/events import and `threads.mjs` has only the exact GET access imports; runtime create/reply/status traces prove no access or append call | not applicable until P4-M's own amendment gate |
| process/artifact safety | AST-proven descendant-free handler; the same Node supervisor is self-probed for HUP/INT/TERM/timeout, conventional statuses, TERM-to-KILL, reaping, and then runs the ordinary child; shell confirms root removal | exact owned preflight/smoke/cleanup groups, phase/outer deadlines, key cleanup, signal authority, and retained-evidence rule |

### Authenticated Functions smoke test

Use one invite-only **disposable deployed preview**, never production or a shared development store. Its P1-C/P2-G setup must already bind one real test identity with `canRead: true` and a second with `canRead: false` to an invented six-hex document ID that is absent from authored content. Complete the repository install first so P2-B's pinned `@netlify/blobs@11.0.2` is available. Export the following without shell tracing: `P3A_SMOKE_BASE_URL` as the preview origin only (`https://HOST`, no path/query/credentials), `P3A_SMOKE_DOC`, `P3A_SMOKE_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `P3A_SMOKE_ALLOW_COOKIE_FILE`, `P3A_SMOKE_DENY_COOKIE_FILE`, and the allowed test actor's exact `P3A_SMOKE_EXPECTED_SUB`, `P3A_SMOKE_EXPECTED_NAME`, and `P3A_SMOKE_EXPECTED_EMAIL`. Each mode-`0600` cookie file contains only the raw `Cookie` header value for its identity, with no `Cookie:` prefix or newline. The inherited token/cookies are never printed, put in a command argument, or copied into the fixture root.

Run this exact command from the repository root on macOS or Linux. The supervisor gives preflight, HTTP oracle, and cleanup their own detached process groups and 30/120/60-second deadlines plus a 240-second outer deadline. It sends TERM, waits two seconds, sends KILL, awaits/reaps the leader, and proves group disappearance. The cleanup worker uses P2-B's strong store and the exact unique prefix: it refuses a non-empty preflight, records each successful created key mode `0600`, deletes only the union of those records and keys under that prefix, strongly confirms each deletion, and confirms the prefix is empty. A failed/terminated create before both response keys are recorded is an ambiguous write and therefore retains the guarded root plus safe external mode-`0600` evidence for manual remediation even after best-effort prefix cleanup. First HUP/INT/TERM preserves 129/130/143; a phase timeout is 124 when cleanup is proved; indeterminate ownership/write/deletion is 125 when no terminal signal was latched. The sole success output appears only after store, group, root, and evidence cleanup all succeed.

```bash
set -euo pipefail
set +x

P3A_HOSTED_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P3A_HOSTED_ROOT=
pre_exec_cleanup() {
  case "${P3A_HOSTED_ROOT:-}" in
    "$P3A_HOSTED_PARENT"/p3-a-hosted.??????) test ! -e "$P3A_HOSTED_ROOT" || find "$P3A_HOSTED_ROOT" -depth -delete ;;
    "") ;;
    *) printf '%s\n' 'ERROR  refusing unsafe P3-A hosted cleanup target' >&2; exit 125 ;;
  esac
}
pre_exec_signal() { status="$1"; trap - HUP INT TERM; pre_exec_cleanup || exit 125; exit "$status"; }
trap pre_exec_cleanup EXIT
trap 'pre_exec_signal 129' HUP
trap 'pre_exec_signal 130' INT
trap 'pre_exec_signal 143' TERM

P3A_HOSTED_ROOT="$(mktemp -d "$P3A_HOSTED_PARENT/p3-a-hosted.XXXXXX")"
P3A_HOSTED_ROOT="$(cd "$P3A_HOSTED_ROOT" && pwd -P)"
P3A_HOSTED_REPO="$(git rev-parse --show-toplevel)"
case "$P3A_HOSTED_ROOT" in "$P3A_HOSTED_PARENT"/p3-a-hosted.??????) ;; *) exit 125 ;; esac
test ! -L "$P3A_HOSTED_ROOT"
chmod 700 "$P3A_HOSTED_ROOT"
export P3A_HOSTED_ROOT P3A_HOSTED_REPO

sed 's/^  //' >"$P3A_HOSTED_ROOT/admin.mjs" <<'P3A_ADMIN'
  import assert from "node:assert/strict";
  import { existsSync, readFileSync } from "node:fs";
  import { createRequire } from "node:module";
  import { join } from "node:path";
  import { pathToFileURL } from "node:url";

  const root = process.env.P3A_HOSTED_ROOT, repo = process.env.P3A_HOSTED_REPO;
  const doc = process.env.P3A_SMOKE_DOC, siteID = process.env.P3A_SMOKE_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
  assert.match(root, /\/p3-a-hosted\.[A-Za-z0-9]{6}$/); assert.match(doc ?? "", /^[0-9a-f]{6}$/);
  assert.match(siteID ?? "", /^[A-Za-z0-9-]{1,128}$/); assert.ok(token); assert.ok(["assert-empty", "cleanup"].includes(process.argv[2]));
  const require = createRequire(join(repo, "package.json"));
  const blobs = await import(pathToFileURL(require.resolve("@netlify/blobs")).href);
  const storeHelper = await import(`${pathToFileURL(join(repo, "netlify/lib/store.mjs")).href}?p3a-hosted-admin`);
  blobs.setEnvironmentContext({ siteID, token });
  const store = storeHelper.docState(), prefix = storeHelper.threadPrefix(doc);
  const grammar = new RegExp(`^threads/${doc}/t_[a-z0-9]{1,48}_[0-9a-f]{8}\\.json$`);
  const listed = async () => {
    const keys = [];
    for await (const page of store.list({ prefix, paginate: true })) {
      assert.ok(page && !Array.isArray(page) && Array.isArray(page.blobs));
      for (const blob of page.blobs) { assert.equal(typeof blob?.key, "string"); assert.match(blob.key, grammar); keys.push(blob.key); }
    }
    assert.equal(new Set(keys).size, keys.length); return keys.sort();
  };
  if (process.argv[2] === "assert-empty") { assert.deepEqual(await listed(), []); }
  else {
    const recorded = existsSync(join(root, "created-keys")) ? readFileSync(join(root, "created-keys"), "utf8").split("\n").filter(Boolean) : [];
    for (const key of recorded) assert.match(key, grammar);
    const keys = [...new Set([...recorded, ...await listed()])].sort();
    for (const key of keys) await store.delete(key);
    for (const key of keys) assert.equal(await store.get(key, { type: "json", consistency: "strong" }), null);
    assert.deepEqual(await listed(), []);
  }
P3A_ADMIN

sed 's/^  //' >"$P3A_HOSTED_ROOT/smoke.mjs" <<'P3A_SMOKE'
  import assert from "node:assert/strict";
  import { appendFileSync, chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
  import { join } from "node:path";

  const root = process.env.P3A_HOSTED_ROOT, doc = process.env.P3A_SMOKE_DOC;
  const base = new URL(process.env.P3A_SMOKE_BASE_URL ?? "");
  assert.equal(base.protocol, "https:"); assert.equal(base.username + base.password + base.pathname + base.search + base.hash, "/");
  assert.match(doc ?? "", /^[0-9a-f]{6}$/);
  const secretFile = (name) => {
    const path = process.env[name]; assert.ok(path); assert.equal(statSync(path).mode & 0o077, 0);
    const value = readFileSync(path, "utf8"); assert.equal(value, value.trim()); assert.ok(value); assert.doesNotMatch(value, /[\r\n]/); return value;
  };
  const allowCookie = secretFile("P3A_SMOKE_ALLOW_COOKIE_FILE"), denyCookie = secretFile("P3A_SMOKE_DENY_COOKIE_FILE");
  const expectedActor = { sub: process.env.P3A_SMOKE_EXPECTED_SUB, name: process.env.P3A_SMOKE_EXPECTED_NAME, email: process.env.P3A_SMOKE_EXPECTED_EMAIL };
  assert.match(expectedActor.sub ?? "", /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/); assert.equal(typeof expectedActor.name, "string"); assert.equal(typeof expectedActor.email, "string");
  const createdKeys = join(root, "created-keys"), mutationStarted = join(root, "mutation-started"), createsComplete = join(root, "creates-complete");
  const request = (path, { method = "GET", cookie = allowCookie, origin, body, contentType, timeout = 10_000 } = {}) => {
    const headers = new Headers(); if (cookie !== null) headers.set("Cookie", cookie); if (origin !== undefined) headers.set("Origin", origin);
    if (contentType !== undefined) headers.set("Content-Type", contentType);
    return fetch(new URL(path, base), { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(timeout) });
  };
  const readJSON = async (response, status) => {
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8"); return JSON.parse(await response.text());
  };
  const remember = (thread) => {
    assert.equal(thread.docId, doc); assert.match(thread.id, /^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/);
    const key = `threads/${doc}/${thread.id}.json`; appendFileSync(createdKeys, `${key}\n`, { mode: 0o600 }); chmodSync(createdKeys, 0o600); return thread;
  };
  const expectError = async (response, status, code, message, allow, plain = false) => {
    const text = await response.text();
    if (response.status === 201) { try { remember(JSON.parse(text).thread); } catch {} }
    assert.equal(response.status, status);
    if (plain) { assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8"); assert.equal(text, message); return; }
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(text), { error: { code, message } }); assert.equal(response.headers.get("allow"), allow ?? null);
  };
  const createBody = (kind) => kind === "comment" ? {
    kind, section: "architecture", anchor: { block: "a3f19c2b7", exact: "a cache miss stays local", prefix: "The contract says ", suffix: ". That boundary matters", start: 91 },
    docVersion: "7aaca51", body: "Could the retry boundary be stated here?", author: "hostile fixture", email: "hostile@fixture.invalid", name: { hostile: true },
  } : { kind, section: "architecture", anchor: null, title: "Fixture discussion", docVersion: "7aaca51", body: "A second thread makes pagination observable." };
  const create = async (kind) => {
    writeFileSync(mutationStarted, "started\n", { flag: "a", mode: 0o600 });
    const value = await readJSON(await request(`/api/threads?doc=${doc}`, { method: "POST", origin: base.origin, body: JSON.stringify(createBody(kind)), contentType: "application/json" }), 201);
    assert.deepEqual(Object.keys(value), ["thread"]); const thread = remember(value.thread);
    assert.deepEqual(thread.author, expectedActor); assert.deepEqual(thread.comments[0].author, expectedActor);
    assert.notEqual(thread.author.sub, "hostile fixture"); assert.notEqual(thread.author.email, "hostile@fixture.invalid"); return thread;
  };
  const listOnce = async (cookie = allowCookie, deadline = Date.now() + 10_000) => {
    const rows = []; let cursor = null;
    for (let pages = 0; pages < 20; pages += 1) {
      const query = new URLSearchParams({ doc, limit: "1" }); if (cursor !== null) query.set("cursor", cursor);
      const value = await readJSON(await request(`/api/threads?${query}`, { cookie, timeout: Math.max(1, deadline - Date.now()) }), 200);
      assert.deepEqual(Object.keys(value), ["threads", "nextCursor"]); assert.ok(Array.isArray(value.threads)); rows.push(...value.threads);
      if (value.nextCursor === null) return rows; assert.match(value.nextCursor, /^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/); assert.notEqual(value.nextCursor, cursor); cursor = value.nextCursor;
    }
    throw new Error("public cursor did not terminate");
  };
  const eventuallyList = async (predicate) => {
    const deadline = Date.now() + 10_000;
    for (let attempt = 0; attempt < 40 && Date.now() < deadline; attempt += 1) { const rows = await listOnce(allowCookie, deadline); if (predicate(rows)) return rows; await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now())))); }
    throw new Error("thread list did not converge within ten seconds");
  };
  const reply = async (thread, body) => readJSON(await request(`/api/threads/${doc}/${thread.id}`, { method: "POST", origin: base.origin, body: JSON.stringify({ body }), contentType: "application/json" }), 200);
  const status = async (thread, value) => readJSON(await request(`/api/threads/${doc}/${thread.id}`, { method: "PATCH", origin: base.origin, body: JSON.stringify({ status: value }), contentType: "application/json" }), 200);

  const anchored = await create("comment"), discussion = await create("discussion");
  writeFileSync(createsComplete, "complete\n", { mode: 0o600 });
  const createdIds = [anchored.id, discussion.id].sort();
  const firstComplete = await eventuallyList((rows) => createdIds.every((id) => rows.some((thread) => thread.id === id)));
  assert.deepEqual(firstComplete.map((thread) => thread.id), createdIds);
  await expectError(await request(`/api/threads?doc=${doc}&limit=1`, { cookie: denyCookie }), 403, "forbidden", "Document access denied");

  const concurrentBodies = ["Concurrent reply alpha.", "Concurrent reply beta."];
  const concurrent = await Promise.all(concurrentBodies.map((body) => reply(anchored, body)));
  for (let index = 0; index < concurrent.length; index += 1) {
    assert.deepEqual(Object.keys(concurrent[index]), ["thread"]); assert.equal(concurrent[index].thread.comments.filter((comment) => comment.body === concurrentBodies[index]).length, 1);
  }
  await eventuallyList((rows) => {
    const thread = rows.find((row) => row.id === anchored.id); return Boolean(thread && concurrentBodies.every((body) => thread.comments.filter((comment) => comment.body === body).length === 1));
  });
  const resolved = (await status(anchored, "resolved")).thread, repeated = (await status(anchored, "resolved")).thread;
  assert.equal(resolved.status, "resolved"); assert.equal(repeated.resolvedAt, resolved.resolvedAt); assert.deepEqual(repeated.resolvedBy, resolved.resolvedBy);
  assert.equal((await reply(anchored, "A reply while resolved stays resolved.")).thread.status, "resolved");
  const reopened = (await status(anchored, "open")).thread; assert.deepEqual([reopened.status, reopened.resolvedAt, reopened.resolvedBy], ["open", null, null]);
  const replayA = (await reply(anchored, "Intentional replay fixture.")).thread, replayB = (await reply(anchored, "Intentional replay fixture.")).thread;
  const replayIds = replayB.comments.filter((comment) => comment.body === "Intentional replay fixture.").map((comment) => comment.id);
  assert.equal(replayA.comments.filter((comment) => comment.body === "Intentional replay fixture.").length, 1); assert.equal(replayIds.length, 2); assert.equal(new Set(replayIds).size, 2);

  await expectError(await request(`/api/threads?doc=${doc}`, { cookie: null }), 401, "unauthenticated", "Authentication required");
  await expectError(await request(`/api/threads?doc=${doc}`, { method: "POST", origin: "https://foreign.fixture.invalid", body: JSON.stringify(createBody("discussion")), contentType: "application/json" }), 403, "", "Bad origin", undefined, true);
  await expectError(await request(`/api/threads?doc=${doc}`, { method: "POST", body: JSON.stringify(createBody("discussion")), contentType: "application/json" }), 403, "", "Bad origin", undefined, true);
  await expectError(await request(`/api/threads?doc=${doc}`, { method: "POST", origin: base.origin, body: "{", contentType: "application/json" }), 400, "invalid-body", "Invalid request body");
  await expectError(await request(`/api/threads?doc=${doc}`, { method: "POST", origin: base.origin, body: JSON.stringify(createBody("discussion")), contentType: "text/plain" }), 415, "unsupported-media-type", "Content-Type must be application/json");
  await expectError(await request(`/api/threads/${doc}/t_missing_12345678`, { method: "POST", origin: base.origin, body: JSON.stringify({ body: "Missing fixture." }), contentType: "application/json" }), 404, "not-found", "Thread not found");
  await expectError(await request(`/api/threads?doc=${doc}`, { method: "PUT" }), 405, "method-not-allowed", "Method not allowed", "GET, POST");
  await expectError(await request(`/api/threads/${doc}/${anchored.id}`, { method: "GET" }), 405, "method-not-allowed", "Method not allowed", "POST, PATCH");
P3A_SMOKE

sed 's/^  //' >"$P3A_HOSTED_ROOT/supervisor.mjs" <<'P3A_SUPERVISOR'
  import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { spawn } from "node:child_process";

  const root = process.env.P3A_HOSTED_ROOT, site = process.env.P3A_SMOKE_SITE_ID, doc = process.env.P3A_SMOKE_DOC;
  if (!root || !/\/p3-a-hosted\.[A-Za-z0-9]{6}$/.test(root)) throw new Error("invalid hosted root");
  if (!/^[A-Za-z0-9-]{1,128}$/.test(site ?? "") || !/^[0-9a-f]{6}$/.test(doc ?? "")) throw new Error("invalid hosted locator");
  let activePid = 0, uncleanPgid = 0, requestedStatus = 0, timedOut = false, groupProved = true, phaseTimedOut = false, terminalKill;
  const evidence = `${root}.manual-remediation.txt`, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; } };
  const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; } };
  const contain = async (pid) => {
    if (!pid || !groupAlive(pid)) return true; signalGroup(pid, "SIGTERM");
    for (let index = 0; index < 20 && groupAlive(pid); index += 1) await delay(100);
    if (groupAlive(pid)) signalGroup(pid, "SIGKILL"); for (let index = 0; index < 20 && groupAlive(pid); index += 1) await delay(100);
    return !groupAlive(pid);
  };
  const evidenceBody = () => {
    let keys = "none"; try { keys = readFileSync(join(root, "created-keys"), "utf8").trim().replace(/\n/g, ",") || "none"; } catch {}
    return `site=${site}\ndoc=${doc}\nroot=${root}\npid=${process.pid}\npgid=${uncleanPgid || activePid || "none"}\nkeys=${keys}\n`;
  };
  let evidenceReady = false; try { writeFileSync(evidence, evidenceBody(), { flag: "wx", mode: 0o600 }); chmodSync(evidence, 0o600); evidenceReady = true; } catch {}
  for (const [signal, code] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => {
    if (!requestedStatus) { requestedStatus = code; process.exitCode = code; }
    if (activePid) { signalGroup(activePid, "SIGTERM"); clearTimeout(terminalKill); terminalKill = setTimeout(() => { if (activePid && groupAlive(activePid)) signalGroup(activePid, "SIGKILL"); }, 2_000); }
  });
  const run = (script, argument, limit, cleanupPhase = false) => {
    if ((!cleanupPhase && (requestedStatus || timedOut)) || !evidenceReady) return Promise.reject(new Error("hosted phase refused"));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, script), argument], { cwd: process.env.P3A_HOSTED_REPO, env: process.env, detached: true, stdio: "ignore" }); activePid = child.pid || 0;
      let settled = false, expired = false, evidenceFailed = false, killTimer;
      const timer = setTimeout(() => { expired = true; timedOut = true; phaseTimedOut = true; if (child.pid) { signalGroup(child.pid, "SIGTERM"); killTimer = setTimeout(() => { if (groupAlive(child.pid)) signalGroup(child.pid, "SIGKILL"); }, 2_000); } }, limit);
      child.once("error", (error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); activePid = 0; reject(error); });
      child.once("close", async (code, signal) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(terminalKill);
        let clean = false; try { clean = await contain(child.pid); } catch {} groupProved &&= clean; if (!clean) uncleanPgid ||= child.pid; activePid = 0;
        if (!clean) reject(new Error("owned group remained")); else if (evidenceFailed) reject(new Error("evidence update failed")); else if (expired) reject(new Error("hosted phase deadline")); else if (code !== 0 || signal !== null) reject(new Error("hosted phase failed")); else resolve();
      });
      try { writeFileSync(evidence, evidenceBody(), { mode: 0o600 }); chmodSync(evidence, 0o600); } catch { evidenceFailed = true; evidenceReady = false; if (child.pid) signalGroup(child.pid, "SIGTERM"); }
    });
  };

  let failed = !evidenceReady, preflightPassed = false, smokeStarted = false, smokePassed = false, cleanupProved = true;
  const overall = setTimeout(() => { timedOut = true; if (activePid) { signalGroup(activePid, "SIGTERM"); terminalKill = setTimeout(() => { if (activePid && groupAlive(activePid)) signalGroup(activePid, "SIGKILL"); }, 2_000); } }, 240_000);
  try {
    await run("admin.mjs", "assert-empty", 30_000); preflightPassed = true;
    smokeStarted = true; await run("smoke.mjs", "run", 120_000); smokePassed = true;
  } catch { failed = true; }
  if (preflightPassed && (smokeStarted || existsSync(join(root, "mutation-started")))) {
    try { await run("admin.mjs", "cleanup", 60_000, true); } catch { cleanupProved = false; }
  }
  clearTimeout(overall); clearTimeout(terminalKill);
  if (activePid) { const pid = activePid; let clean = false; try { clean = await contain(pid); } catch {} groupProved &&= clean; if (!clean) uncleanPgid ||= pid; activePid = 0; }
  const ambiguousWrite = existsSync(join(root, "mutation-started")) && !existsSync(join(root, "creates-complete"));
  if (evidenceReady) { try { writeFileSync(evidence, evidenceBody(), { mode: 0o600 }); chmodSync(evidence, 0o600); } catch { evidenceReady = false; } }
  let rootRemoved = false, evidenceRemoved = false;
  if (evidenceReady && groupProved && cleanupProved && !ambiguousWrite) {
    try { rmSync(root, { recursive: true }); rootRemoved = !existsSync(root); } catch {}
    if (rootRemoved) { try { rmSync(evidence); evidenceRemoved = !existsSync(evidence); } catch {} }
  }
  await new Promise((resolve) => setImmediate(resolve));
  const manual = !evidenceReady || !groupProved || !cleanupProved || ambiguousWrite || !rootRemoved || !evidenceRemoved;
  if (manual) {
    console.error(`MANUAL REMEDIATION P3-A site=${site} doc=${doc} root=${root} pid=${process.pid} pgid=${uncleanPgid || "none"} evidence=${evidenceReady ? evidence : "unavailable"}`);
    process.exitCode = requestedStatus || 125;
  } else {
    if (smokePassed && !failed && !timedOut && !requestedStatus) console.log("PASS  P3-A authenticated Functions smoke");
    process.exitCode = requestedStatus || (timedOut || phaseTimedOut ? 124 : failed ? 1 : 0);
  }
P3A_SUPERVISOR

exec env P3A_HOSTED_ROOT="$P3A_HOSTED_ROOT" P3A_HOSTED_REPO="$P3A_HOSTED_REPO" node "$P3A_HOSTED_ROOT/supervisor.mjs"
```

Expected: after exact create/list/pagination/denial/concurrency/status/replay/error assertions and proved cleanup, print exactly `PASS  P3-A authenticated Functions smoke` and exit `0`; leave no created thread key, `p3-a-hosted.*` root, sidecar evidence, process, or descendant. The two successful creates make `limit=1` produce a real non-null public cursor before `null`; the list retry is bounded at ten seconds and accommodates only the documented list-visibility lag. Every request has a ten-second deadline. The command adds no endpoint or production test hook.

### Repository gates

After the deterministic and hosted gates pass, run:

```bash
set -euo pipefail

test "$(rg -n '^## ' docs/tickets/P3-A.md | wc -l | tr -d ' ')" = 12
test "$(rg '^## ' docs/tickets/P3-A.md | sed 's/^## //')" = "$(printf '%s\n' \
  'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' \
  'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' \
  'Assumptions and open questions' 'References')"
! rg -n '[[:blank:]]+$' docs/tickets/P3-A.md netlify/functions/threads.mjs netlify/functions/thread.mjs
git diff --check
templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P3-A.md netlify/functions/threads.mjs netlify/functions/thread.mjs
test -z "$(git status --short -- package-lock.json node_modules .netlify)"

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3A_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
const lines = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = new Set([
  ...lines(["diff", "--name-only", `${base}...HEAD`]),
  ...lines(["diff", "--name-only"]),
  ...lines(["diff", "--cached", "--name-only"]),
  ...lines(["ls-files", "--others", "--exclude-standard"]),
]);
for (const path of [...changed]) if (path.startsWith("docs/tickets/")) changed.delete(path);
assert.deepEqual([...changed].sort(), ["netlify/functions/thread.mjs", "netlify/functions/threads.mjs"]);
console.log("PASS  P3-A owns only thread.mjs and threads.mjs");
NODE

issue_json="$(gh issue view 14 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-A.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-A — The threads API" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-A issue #14 pointer integrity'

printf '%s\n' 'PASS  P3-A repository gates'
```

Expected: export `P3A_BASE` as the reviewed predecessor commit before running this gate in P3-A's isolated implementation worktree. Every command exits 0; `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; typecheck emits no diagnostics; scrub-check ends with `PASS  no denied term and no warning.`; the ownership oracle prints `PASS  P3-A owns only thread.mjs and threads.mjs`; issue #14 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; and the final line is `PASS  P3-A repository gates`. Other ticket documents may be present, but the complete committed, staged, unstaged, and untracked non-ticket diff is exactly the two implementation files P3-A owns.

## Failure modes

- Missing/foreign origin on a supported mutation: return P1-C's exact 403 before identity or observable work.
- Missing session: return the private no-store 401 before request parsing, access, or storage.
- List access denies, is unavailable, or is malformed: return exact 403, 503, or 500 respectively before any thread prefix/list/read; never return actor-bearing thread JSON or expose access detail.
- Malformed client input: return the stable 400/415 boundary without reflecting the value or silently repairing it. A body over 65,536 bytes returns exact 413 before decoding/parsing; an oversized canonical Content-Length leaves the stream untouched, and detected streaming overflow cancels best-effort and releases exactly once.
- Generated create collision: return 409, preserve the existing record, and do not generate a replacement ID in the same request.
- Simultaneous replies: P2-B re-reads and reapplies; both land once. Six proven races return 409 without a blind write. A thread already holding 500 comments returns exact `409 comment-limit` and remains unchanged.
- Provider throw, more than ten provider data pages, or indeterminate write result: return 503 and do not retry an outcome that may have landed. Never inspect an eleventh page value or fetch a twelfth page. POST request replay remains the documented client boundary.
- Corrupt stored thread, wrong-key record, malformed list page/key, invalid P2-B version, or broken resolution coupling: return 500 and reveal no record/key detail.
- Listed key disappears before its strong read: skip that key and advance pagination; do not turn an expected list/read race into a fabricated record.
- `list()` omits a fresh write: the write response remains authoritative; a later refresh may converge. Never relist to construct the write response.
- Reply to a resolved thread: append while preserving `resolved`; never reopen implicitly.
- Repeated resolve/reopen: no write and no replacement timestamp/actor.
- Client sends actor/role/capability/server fields: ignore only the three named impersonation probes and reject other unknown keys; all stored authority remains server-owned.
- Deterministic-fixture timeout or terminal signal: stop the retained direct Node child, escalate TERM to KILL, reap it, then delete the guarded local root.
- Hosted preflight/smoke/cleanup timeout or terminal signal: contain the active owned group before continuing; best-effort-delete only the isolated prefix, and report manual remediation with the retained safe locator if group disappearance, remote deletion, evidence, or local deletion is unproved. An interrupted create without both recorded response keys is always ambiguous and never green.
- P4-M is absent: GET is document-authorized, while mutations provide authentication but not their final document capabilities or four authoritative thread-event appends. Do not describe or deploy that intermediate state as mutation-access/audit complete.

## Settled decisions

- One site-wide `doc-state` store, one blob per thread, exact `threads/<docId>/<threadId>.json` key, strong reads, and no shared per-document array.
- `docId` is the permanent six-hex ID; slug, instance, URL path, and client path never enter a storage key.
- P3-A has two Functions v2 files and no shared third helper or permanent test file.
- GET is authenticated, does not invoke the origin guard, and requires exact P2-G `canRead` before thread storage; supported mutations call `requireOrigin()` before `identify()` and all other work.
- The complete version-1 thread shape, actor projection, anchor coupling, status coupling, 8,000-code-unit field limit, 65,536-byte request limit, 500-comment thread limit, and one-level replies are fixed here.
- Create is guarded `onlyIfNew`; reply/resolve/reopen use P2-B's six-attempt CAS. Mutable updates never call provider `setJSON()` directly.
- Public pages are ascending by opaque thread ID, use an exclusive thread-ID cursor, default to 50, cap at 100 threads and 5,000 comments, expose no total, and do not claim snapshot or strong-list consistency. Enumeration accepts at most ten documented 1,000-entry provider pages plus one exhaustion probe and never creates a global thread-write cap.
- A successful write response comes from the committed/constructed record, never a relist.
- Status PATCH is idempotent; POST create/reply is not replay-idempotent and no header pretends otherwise.
- Replying never reopens. P3-A has no comment edit or delete operation and emits no hidden secondary event/notification write.
- Every actor is the verified server projection. Body author/email/name fields exist only as ignored hostile probes.
- P3-A owns only the `canRead` list rule; P4-M exclusively adds `canComment`/thread-control enforcement plus the four post-commit P3-B appends, with no temporary mutation-role or audit policy here.

## Assumptions and open questions

- **Assumption:** the integrated Phase 3 release includes P2-H's final identity shape even though the Build Order dependency cell names its origin ticket P1-C. P3-A relies only on the stable three actor fields, so there is no compatibility adapter.
- **Assumption:** the baked history head remains exactly seven lower-case hexadecimal characters. If the builder changes that public contract, amend the producer and this consumer together before implementation; do not silently widen P3-A alone.
- **Assumption:** `context.params` contains decoded own strings for named Functions v2 path segments. The handler still validates both values and accepts no URL/query fallback.
- **Assumption:** the provider's documented `paginate: true` iterator and page `blobs` array are available in pinned `@netlify/blobs@11.0.2`; the official API states that provider pages contain at most 1,000 entries and manual pagination lets the caller fetch only the data it needs. P3-A validates resolved shapes, caps its own iterator work, and does not expose provider cursors.
- **Open question (does not block P3-A):** store-level strong consistency for `list()` remains unverified. The contract deliberately tolerates omission and uses strong per-key reads; changing that provider fact later may improve freshness but does not change the API.
- **Open question (downstream ownership):** the ruling model includes audit events and notification/realtime sinks, but P3-A has no owned event/notification helper and no cross-blob transaction. Their owning tickets must define server-side fan-out without weakening P3-A's state-first/replay boundary; clients must not fabricate actors or audit authority.

## References

- `docs/prompts/rewrite-tickets.md` — standalone ticket shape, implementation ownership, verification, and public-safety requirements.
- `docs/research/00-integration-plan.md` §1.1–§1.3, §2.1–§2.4, §4.5–§4.7 — ruling store/key/identity/document/thread contracts, Phase 3 work, verification, and P4-M amendment order.
- `docs/research/04-comments-and-discussion.md` §3, §5–§9 — one-level discussion model, durable anchor vocabulary, one-thread-per-blob rationale, endpoint lineage, and resolve/reopen behavior. Its separate store, slug key, 10,000-character limit, three-attempt CAS, loose coercion, comment-edit branch, and notification call are superseded or excluded by the ruling plan and this ticket.
- `docs/research/03-state-storage.md` §2–§3, §5.2–§5.3 — strong-read and CAS motivation. Its one-document blob, mutable array, sequence counter, and older route/schema are superseded by the integration plan.
- `docs/tickets/P1-C.md` — Functions v2, normalized identity, same-origin guard, response privacy, and package/runtime contract.
- `docs/tickets/P2-B.md` — `doc-state`, exact thread keys, version/JSON safety, strong reads, direct-create boundary, six-attempt CAS, retry purity, and stable store errors.
- `docs/tickets/P2-H.md` — final identity object and the prohibition on treating `isOrg` as document permission.
- `docs/tickets/P2-G.md` — final role/capability model, P3-A's non-consuming `canRead` list seam, and P4-M's later `canComment`/`threadControl` mutation contract.
- [Netlify Blobs API reference](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — official `list({ paginate: true })` iterator, pages of up to 1,000 entries, prefix filtering, and strong-consistency selection; checked 2026-09-03 for the pinned package contract.
- GitHub issue #14 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
