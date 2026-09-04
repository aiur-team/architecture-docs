# P4-O — The suggestion API

## Outcome

Readers with suggestion authority can create immutable, block-scoped proposals; document deciders can accept or reject them; authors can withdraw them; every read computes open versus superseded state from P4-N's one effective-base function; and durable create/decision/apply transitions schedule only the exact P4-D/P4-H fan-out inputs without creating a second apply or provider path.

## Context

A suggestion is neither a mutable thread nor a pending edit. Its blob exists while the proposal is undecided, its stored base binds it to the exact text the author saw, and acceptance invokes the same apply operation as `/api/edit`. P2-G, not the superseded `doc.json` proposal in research 08, determines who may suggest and decide. P3-B's canonical event target is intentionally smaller than research 08's draft target, so rejection events record the decision and IDs but do not retain rejected prose or reasons.

## Scope

### In scope

- Add Fetch-style Functions v2 list/create and action handlers at `/api/suggestions` and `/api/suggestion`.
- Store one immutable suggestion per P2-B `suggestionKey(docId, aid, suggestionId)` using `onlyIfNew`.
- Export an exact arbitrary-key validator for P4-T's later age sweep.
- Use P4-N `readEffectiveBase()` for create and list classification/reaping, and P4-N `applyText()`/`readApplyReceipt()` for acceptance and replay.
- Refuse creation when the bounded per-block inventory proves five existing suggestions, with the explicit P2-B list-consistency limit below.
- Accept only by calling P4-N `applyText()`; reject/withdraw/delete by key existence.
- Reap at most ten superseded suggestions at least fourteen days old during a successful list.
- Append the canonical P3-B suggestion event kinds at the state boundaries below.
- Schedule P4-D/P4-H create/decision/edit fan-out only after the corresponding durable transition and audit attempt.
- Bound the complete serialized list response to the exact P4-P 64-MiB stream ceiling.
- Add permanent `scripts/test-p4-o.mjs` local and opt-in hosted regression coverage for the suggestion boundary.

### Out of scope

- Suggestion UI, inline capture, panel rendering, client realtime hints, notification-provider implementation/configuration, or a cross-document queue.
- A mutable status field, per-user index, per-document counter, merge/rebase, auto-accept, unapply, or accepted-record archive.
- A second GitHub/receipt implementation, client-supplied actor/section/path/tag/mode/role, or authority in `doc.json`.
- P4-T's 90-day age sweep, P4-R promotion, P4-Q reconciliation, or changing P3-B's event schema to retain rejected text/reason.
- A notification or realtime provider call outside the sole `notify()` helper.

## Interface contract

### Module and handler surfaces

`netlify/functions/suggestions.mjs` has exactly these runtime exports:

```js
export function assertSuggestionAtKey(value, docId, fullKey) { /* contract below */ }
export function createSuggestionsHandler(dependencies = {}) { /* contract below */ }
export default async function handler(req, context) { /* contract below */ }
export const config = { path: "/api/suggestions" }
```

`netlify/functions/suggestion.mjs` has exactly:

```js
export function createSuggestionHandler(dependencies = {}) { /* contract below */ }
export default async function handler(req, context) { /* contract below */ }
export const config = { path: "/api/suggestion" }
```

There are no other exports or Lambda-v1 handlers. Each factory validates a closed ordinary dependency object synchronously and returns one named two-argument async `(req, context)` handler. Production defaults import `requireOrigin`/`identify`, P2-G access, P2-B `StoreError` plus store/key helpers, P3-B `appendEvent`, P4-D/P4-H `notify`, and P4-N `ApplyError`/`assertApplyReceipt`/`readApplyReceipt`/`readEffectiveBase`/`applyText`; `suggestions.mjs` may also import `randomBytes` from `node:crypto`, and both modules use only the canonical P2-D converter/SHA-256 path. The two error constructors are fixed module boundaries, not factory/request-selected values; map only their valid instances through the safe table, and map forged status/code/current fields or unknown throws to 500. Request/context data cannot replace dependencies. Both default handlers are created once from production defaults and contain no duplicate algorithm, provider import, direct `publish`, or direct `context.waitUntil()` call.

`createSuggestionsHandler()` accepts only optional callable own data keys `requireOriginFn`, `identifyFn`, `resolveRoleFn`, `capabilitiesForFn`, `storeFn`, `readEffectiveBaseFn`, `appendEventFn`, `notifyFn`, `nowFn`, `randomBytesFn`, `sha256Fn`, `toHtmlFn`, and `toMdFn`. `createSuggestionHandler()` accepts only optional callable own data keys `requireOriginFn`, `identifyFn`, `resolveRoleFn`, `capabilitiesForFn`, `storeFn`, `assertApplyReceiptFn`, `readApplyReceiptFn`, `applyTextFn`, `appendEventFn`, `notifyFn`, `sha256Fn`, and `toHtmlFn`. Omitted members use the production imports. Unknown keys, explicit undefined, accessors, symbols, arrays, null, custom prototypes, or non-functions throw `TypeError("Invalid suggestion dependencies")` synchronously without request/store/provider work. Each returned handler has exact two-argument arity.

Unsupported methods return the shared exact `405 method-not-allowed` JSON before request work. GET never calls `requireOrigin`; each supported POST calls it first and returns P1-C's thrown origin `Response` unchanged. Then validate URL/query, identify once, validate exact body where applicable, resolve role once with `{ consumeInvitation: false }`, and validate the complete P2-G result against `capabilitiesFor(role)`. On `/api/suggestion`, branch on the already-validated action before opening state: `accept` and `reject` require `canAccept === true` and return exact 403 on denial before any suggestion-key read, receipt read, apply, or other state work; `withdraw` follows the existence-concealing author proof below. Preserve the established exact public error envelope `{ "error": { "code": <code>, "message": <safe message> } }`, no terminal LF, and `Content-Type: application/json; charset=utf-8`.

All non-origin responses have `Cache-Control: private, no-store`; JSON responses use the content type above. Success is GET `200` with the exact array, create `201` with the exact stored record, and action `200` with the exact result below. Errors are closed:

| Condition | Status | `code` | `message` |
|---|---:|---|---|
| Invalid URL/query | 400 | `invalid-request` | `Invalid request` |
| Invalid JSON/body/value | 400 | `invalid-body` | `Invalid request body` |
| No identity | 401 | `unauthenticated` | `Authentication required` |
| Valid identity without operation authority | 403 | `forbidden` | `Suggestion access denied` |
| Document, block, or suggestion absent | 404 | `not-found` | `Suggestion or block not found` |
| Unsupported method | 405 | `method-not-allowed` | `Method not allowed` |
| Effective-base/source conflict | 409 | `conflict` | `The block changed since this document was built` |
| Fifth-record serial cap already reached | 409 | `suggestion-limit` | `Decide the open suggestions first` |
| Generated suggestion key already exists | 409 | `suggestion-id-collision` | `Generated suggestion identifier collision` |
| Required reject/withdraw audit ID collides | 409 | `event-id-collision` | `Generated event identifier collision` |
| Body exceeds 16,384 bytes | 413 | `payload-too-large` | `Request body exceeds 16384 bytes` |
| Media type is not JSON | 415 | `unsupported-media-type` | `Content-Type must be application/json` |
| Corrupt state/dependency/access result or unexpected failure | 500 | `invalid-state` | `Invalid suggestion state` |
| Repository operation fails safely | 502 | `repository-unavailable` | `Repository write unavailable` |
| Store/manifest operation is unavailable or bounded inventory cannot prove exhaustion | 503 | `unavailable` | `Suggestion state unavailable` |
| Serialized list would exceed 67,108,864 UTF-8 bytes | 503 | `resource-limit` | `Suggestion response exceeds 67108864 bytes` |

`/api/suggestions` adds `Allow: GET, POST` to 405; `/api/suggestion` adds `Allow: POST`. The base-conflict body additionally has exact sibling `current: { hash, text }` as specified below. No other error has `current` or provider/config/key/path/actor/text/reason/cause detail.

### Immutable record, ID, and validator

The stored object has exactly this key order:

```json
{
  "v": 1,
  "id": "s_m8x2k1_4f7a9c31",
  "docId": "4b7d2a",
  "aid": "a3f19c2b7",
  "section": "architecture",
  "text": "The cache key covers **every** declared input.",
  "note": "This matches the public diagram.",
  "by": { "sub": "u_fixture_931", "name": "Avery Quill", "email": "avery@example.invalid" },
  "at": "2026-09-03T16:19:25.123Z",
  "baseHash": "3883a7bdb6a47fb141b722b65dc34319d7c47fa814dcf42dbfffbd1553a22630",
  "baseText": "The cache key covers every declared input.",
  "docVersion": "7aaca51"
}
```

The example is invented and public-safe. Exact predicates are: `v === 1`; IDs match `^s_[a-z0-9]{1,48}_[0-9a-f]{8}$`; `docId`, `aid`, and key components satisfy their canonical P2-B validators; actor snapshots use the P2-G contract to which P3-B is aligned, including a `name` of at most 200 UTF-16 code units under P3-B's explicit actor-name override; `section` matches P3-A's section grammar; `text` is 0–4,000 UTF-16 code units; `note` is 0–280; `baseText` is 0–4,000; these three contain no lone surrogate, NUL, other C0/C1 control, while exact TAB/LF/CR are admitted and preserved; `at` is canonical UTC milliseconds; hashes are 64 lowercase hex; and `docVersion` is the exact manifest `commit` matching `^[0-9a-f]{7,64}$`. A Mode B manifest with an empty/opaque commit fails closed because P3-B cannot accept it as an event version. No string is trimmed, normalized, line-ending-folded, or locale-folded. The proposed `text` and `baseText` must each pass `toMd(toHtml(value)) === value` through P4-N.

For creation, evaluate `nowFn()` once and `randomBytesFn(4)` once after authorization/cap/base validation. Require time to be a safe integer from `1000000000000` through `9999999999999` whose `new Date(nowMs).toISOString()` succeeds, and randomness to be a `Uint8Array` of exactly four bytes; a malformed dependency result is 500 before write. Set `id = "s_" + nowMs.toString(36) + "_" + eightLowerHex` and `at` to that timestamp. Construct `section`, `baseText`, and `docVersion` from the same validated effective-base/manifest snapshot, and `by` from proven identity. Call `store.setJSON(suggestionKey(docId, aid, id), record, { onlyIfNew: true })` once. `modified: false` is `409 suggestion-id-collision`; ambiguous/provider failure is exact `503 unavailable`; neither retries nor regenerates.

`assertSuggestionAtKey(value, docId, fullKey)` is the sole record validator and P4-T contract. It first validates `docId`; after full closed-shape validation it requires `record.docId === docId` and `fullKey === suggestionKey(docId, record.aid, record.id)`. It returns a freshly constructed exact object in the order above and has no clock, randomness, store, manifest, access, environment, network, log, or mutation side effect. P4-T must use this exact function for every listed record rather than reconstructing the schema.

### `GET /api/suggestions`

The query is exactly `/api/suggestions?doc=<docId>`: one `doc`, no duplicates or other keys. Require `canRead === true`, then list `suggestionPrefix(docId)` with `paginate: true`. Manually consume at most ten provider pages and 10,000 entries plus one exhaustion pull, validating the same page/key envelopes and 1,000-entry page ceiling as P3-B. Invalid provider envelopes/capacity map to 503; an out-of-prefix, malformed, duplicate, or key/body-mismatched stored record maps to 500. After complete key validation, raw-sort full keys, call P2-B `read(store, key, null)` once per key, skip exact `{value:null,etag:null}` races, and pass every hit's `value` through `assertSuggestionAtKey(value, docId, key)`. Sort validated records by `at`, then `id`, then `aid` using code-unit order; this is creation order and does not trust provider order.

Cache one `readEffectiveBase(docId, aid)` result per distinct aid. Validate every successful dependency result as P4-N's exact closed object, including matching doc/aid, canonical mode/section/tag/version/hashes/text/pending relations; a malformed test double is 500. A valid result makes a record response-state `open` only when `record.baseHash === effective.hash`; a P4-N 404 for that aid means the block was removed/demoted and makes the record `superseded`, while every other error keeps its normal safe failure mapping. This computed field is never stored.

After the maintenance pass below, take only the oldest five surviving records for each aid by `(at,id,aid)` and omit later overflow records from this response without deleting or treating them as decided. Then preserve that tuple's global creation order and construct one array whose members are fresh objects with the record's twelve fields followed by exact `state: "open" | "superseded"`; no envelope, count, or cursor. Thus an eventual/concurrent cap overage remains bounded and drains FIFO as older records are decided or reaped. Serialize the projection once with `JSON.stringify()`, require `Buffer.byteLength(body, "utf8") <= 67_108_864`, and only then construct the status-200 response with those exact bytes and no terminal LF. A larger body returns the quiet exact 503 `resource-limit` above and never constructs a partial/success response.

Before serializing, sample `nowFn()` exactly once after the complete inventory/effective-base classification and require a safe integer from `1000000000000` through `9999999999999`. Take the first at most ten `superseded` records satisfying `Date.parse(at) + 14 * 24 * 60 * 60 * 1000 <= nowMs`, ordered oldest first by the same tuple. For each, attempt `appendEvent()` with system actor, kind `suggest.supersede`, target `{ suggestionId: id, aid }`, the record's validated `docVersion`, and exact summary `superseded suggestion in ${section}`; only after append success call `store.delete(fullKey)`. Using the immutable record version keeps a removed-aid proposal auditable without inventing a current manifest row. An append or delete failure leaves the item in the returned array and does not fail the reader's GET. A successful delete removes it from that response. Do not inspect or delete an eleventh candidate. This best-effort read-time maintenance is not P4-T's 90-day sweep.

### `POST /api/suggestions`

After the origin gate, accept `Content-Type: application/json` with optional parameters and use the shared bounded streaming parser with a 16,384-byte maximum. The exact body is `{ docId, aid, text, note, baseHash, baseText }` in any key order. Unknown/reserved actor, role, section, file, tag, mode, docVersion, ID, time, status, or state fields are invalid rather than trusted. Require `canSuggest === true`.

Call `readEffectiveBase(docId, aid)` once and apply the same exact closed-result validation as GET before reading its fields. An unknown document or non-editable/missing aid is 404; unavailable manifest is 503. Require the supplied 64-lowercase-hex `baseHash` to equal `effective.hash`, require `sha256(toHtml(baseText) UTF-8) === baseHash`, and require `sha256(toHtml(text) UTF-8) !== baseHash`. This cryptographically binds the client display text to the authoritative hash when a Mode A manifest has no text and rejects a same-text proposal that P4-N could never apply. A base mismatch is exact 409 `{ "error": { "code": "conflict", "message": "The block changed since this document was built" }, "current": { "hash": effective.hash, "text": effective.text } }`, where text may be null; a same-text proposal is exact 400 `invalid-body`. Validate both text round trips before suggestion inventory work. In repository mode also require the proven author actor's email to be nonempty and canonical; an empty degraded email is safe 500 before inventory/write because P4-N cannot preserve its Git authorship. Mode A admits the canonical empty email. Store the proven submitted `baseText` rather than inventing it from a hash.

Call `store.list({ prefix: suggestionPrefix(docId, aid), paginate: true })` once and manually consume the same closed iterator/page/key envelopes as GET. Stop successfully as soon as five distinct canonical keys are proven; do not read their bodies because key existence is the cap. Otherwise require exhaustion within ten data pages, 10,000 unique keys, and one final exhaustion pull before concluding the observed count is below five. A malformed/out-of-prefix/duplicate key is 500; an invalid page/iterator, provider failure, or unproved exhaustion is 503. An observed count below five permits create; five returns exact `409 suggestion-limit` / `Decide the open suggestions first` without time/random/write. P2-B explicitly does not establish strong `list()` consistency, and immutable create plus prefix inventory are separate operations: concurrent fifth creates or a serial read that has not yet observed a recent key can exceed five. The contract is “refuse once five are proved,” not a transactional/global invariant. Do not add a mutable counter to conceal that provider limit.

After the create succeeds, attempt one `suggest.create` event with the author actor, `{ suggestionId: id, aid }`, `docVersion`, and `suggested ${section}`. Event failure does not delete the suggestion or change the exact `201` response containing the stored record. After that audit attempt, call `notify(context, { t: "suggest.created", docId, suggestionId: record.id, aid, actorName: record.by.name, text: record.text })` exactly once in a catch-all synchronous boundary. Ignore its boolean/throw and never await a sink.

### `POST /api/suggestion`

Use the same media/stream limit. The exact body is `{ docId, aid, sugId, action, reason }`; `action` is `accept`, `reject`, or `withdraw`. `reason` is required and exact `""` for accept/withdraw, and 1–280 safe scalar values for reject. Including `aid` is a canonical correction to research 08's draft body: the immutable key is block-scoped, and omitting it would require an ambiguous whole-document ID scan.

For `accept`/`reject`, the `canAccept` check above precedes the exact-key read, so an unauthorized caller receives the same 403 whether the key is absent or present. An authorized caller then strong-reads the exact key and validates every hit; a miss follows only the accept replay rule below and is otherwise 404.

For `withdraw`, ignore current role capability and strong-read the exact key only to prove immutable authorship. A hit with `record.by.sub === identity.sub` may proceed even when the author's current `canRead` is false. A miss is exact 404. A hit owned by a different subject is 403 only when the caller has `canRead === true`; when `canRead === false`, return the same exact 404 as a miss. Thus a revoked author can withdraw their own known proposal, while a no-read caller cannot distinguish another author's existing key from an absent key. No withdraw path calls `readEffectiveBase()` or otherwise reveals document/suggestion content before that ownership decision.

- **accept:** call `applyText({ docId, aid, text: record.text, author: record.by, acceptedBy: identityActor, sugId: record.id, via: "suggestion", expectBase: record.baseHash })` directly. P4-N first recognizes an exact completed receipt replay, then performs the sole effective-base check and rechecks it around Git/CAS work; its conflict supplies `currentHash`/`current` and maps to the exact conflict object with current hash/text. This ordering is required because a receipt written before a crashed delete has already changed the effective base and must replay rather than conflict. Require the resolved value to be an ordinary exact `{ receipt, pr }`, validate/clone `receipt` through `assertApplyReceipt(receipt, aid)`, require exactly `receipt.via === "suggestion"`, `receipt.sugId === record.id`, `receipt.aid === record.aid`, `receipt.text === record.text`, and deep equality of `receipt.by` with `record.by`, and require `pr === receipt.pr`; a malformed dependency result is 500 before delete. The immutable record's `baseHash` is used only as `expectBase`: never compare it with `receipt.baseHash`, which P4-N deliberately stores as the manifest hash, or require a replayed receipt's first `acceptedBy` to equal the current retrying decider. On success delete the suggestion, then best-effort append `suggest.accept` with the stored receipt's `acceptedBy` actor, canonical target, the record's validated `docVersion`, and `accepted suggestion in ${section}`. After that audit attempt, independently call `notify(context, { t: "suggest.decided", docId, suggestionId: record.id, aid, authorName: record.by.name, deciderName: result.receipt.acceptedBy.name, outcome: "accepted" })` and then `notify(context, { t: "edit.saved", docId, aid, hash: sha256(toHtml(result.receipt.text) UTF-8) })`, each exactly once in its own catch-all synchronous boundary. One false/throw cannot suppress the other or alter the response. Return that validated exact P4-N `{ receipt, pr }` object. If the suggestion key is absent on an accept request, require `canAccept`, call `readApplyReceipt(docId, aid)` once, validate/clone a non-null value through the same `assertApplyReceipt` boundary, and return `{ receipt, pr: receipt.pr }` only when the valid receipt has `via: "suggestion"` and the same `sugId`; otherwise 404. An absent-key replay performs no delete, event, or notification call. P4-N's trailer/receipt idempotency prevents a second commit/receipt, while the best-effort audit/fan-out may be absent because neither has an operation index.
- **reject:** append `suggest.reject` with decider actor, canonical target, record `docVersion`, and `rejected suggestion in ${section}`; only then delete. After successful deletion call `notify(context, { t: "suggest.decided", docId, suggestionId: record.id, aid, authorName: record.by.name, deciderName: identityActor.name, outcome: "rejected" })` exactly once in a catch-all synchronous boundary. Return `{ "ok": true }`. Append failure returns its safe 409/503 and preserves the record. Delete ambiguity may leave the record and a duplicate event on retry; neither path notifies without proven deletion.
- **withdraw:** append `suggest.withdraw` with author actor, canonical target, record `docVersion`, and `withdrew suggestion in ${section}`; only then delete and return `{ "ok": true }`, with the same retry limitation.

Accept base mismatch returns 409 with P4-N's exact current text/hash and leaves the proposal present; list then calls it superseded. Reject/withdraw deliberately do not compare current base. No action mutates a suggestion object.

## Files owned

- `netlify/functions/suggestions.mjs` — **new** list/create handler and shared validator.
- `netlify/functions/suggestion.mjs` — **new** accept/reject/withdraw handler.
- `scripts/test-p4-o.mjs` — **new permanent regression harness** for source-bound API behavior, supervision, and the opt-in hosted lifecycle.
- `docs/tickets/P4-O.md` — **new canonical specification**; not an implementation path.

No library, existing function, configuration, package, template, client, generated artifact, other fixture, research, prompt, or other permanent test file is owned.

## Dependencies

- **P4-N:** the sole `readEffectiveBase()`, `readApplyReceipt()`, and `applyText()` implementations, exact apply errors, Mode A/Mode B decision, receipt replay, and converter gate.
- **P2-B/P3-E:** store, immutable suggestion keys, strong reads, and canonical extended receipt validator.
- **P2-G:** exact `canRead`, `canSuggest`, and `canAccept` authority; `doc.json` ownership from research 08 is explicitly superseded.
- **P2-D:** manifest membership, section/tag/hash, aid, and inline conversion contract.
- **P3-B:** exact event kinds, target shape, safe summaries, system actor, and non-transaction boundary.
- **P4-D/P4-H:** integrated sole `notify()` helper, exact suggestion/`edit.saved` variants, independent scheduling, and the rule that callers never import providers.
- **P4-T:** downstream only; consumes `assertSuggestionAtKey()` for its 90-day sweep without amending these files.

### Maximum safe implementation waves

1. After P4-N's public seam and the serialized P4-D-then-P4-H helper are fixed, one agent may implement `suggestions.mjs`, another `suggestion.mjs`, and a third `scripts/test-p4-o.mjs` against the frozen contracts; each file has one writer and only `suggestions.mjs` owns the validator.
2. Integrate the two functions and run one shared validator/key/event/error fixture. Do not duplicate the validator or apply logic to resolve integration failures.
3. P4-P/P4-Q client work and P4-T retention work may proceed in parallel only after these API/export contracts land because their owned files are disjoint.
4. Serialize hosted tests: list-time reaping and action races share one document prefix and cannot be driven by parallel agents.

## Acceptance criteria

- [ ] The two modules expose only the exact exports/routes and share one arbitrary-key validator consumed by P4-T.
- [ ] Records, IDs, keys, actors, times, text/note/base fields, and public examples satisfy the exact closed schema; request actor/authority/path/mode fields are rejected and never stored.
- [ ] GET requires `canRead`, validates a finite complete inventory, computes state only through P4-N effective base, runs bounded maintenance, and returns the exact globally ordered oldest-five-per-aid array projection.
- [ ] POST create requires `canSuggest`, exact current base and converter round trip, refuses once bounded inventory proves five records, states the eventual-list/concurrent overage boundary, writes once with `onlyIfNew`, and appends only after state success.
- [ ] Same-text and repository empty-email proposals fail before immutable write; Mode A still permits canonical empty-email actors.
- [ ] Accept/reject deny missing `canAccept` before a suggestion-key or receipt read; withdraw requires exact author `sub` even after role loss, and a no-read non-author receives the same 404 as a miss.
- [ ] Accept invokes only P4-N's apply/receipt seams, preserves authorship/acceptance, reaches receipt replay before effective-base conflict, and never merges a PR.
- [ ] Reject, withdraw, and supersede obey their event/delete ordering; every P3-B target has only `{ suggestionId, aid }` and no rejected prose/reason is falsely claimed durable.
- [ ] Create/reject call one exact suggestion notification; accept independently calls exact decided then edit-saved notifications; withdraw/supersede/replay/failure call none, and fan-out cannot alter responses.
- [ ] GET emits at most 67,108,864 UTF-8 bytes, never a partial array; the next byte returns exact quiet 503 `resource-limit` before response construction.
- [ ] List and create have finite provider page/key ceilings; reaping handles at most ten exact candidates and P4-T remains the sole 90-day sweeper.
- [ ] Race tests document the non-transactional cap and event/delete limits rather than claiming cross-key atomicity.
- [ ] `node scripts/test-p4-o.mjs` is the permanent executable local gate, and its hosted branch withholds success until all generated site/store/repository and local resources are cleaned.
- [ ] AST, runtime, supervision, hosted-provider, repository, scrub, generated-output, and issue-pointer gates pass with exact output.

## Test plan

### 1. Syntax, export, and AST gate

```bash
set -euo pipefail
node --check netlify/functions/suggestions.mjs
node --check netlify/functions/suggestion.mjs
node --check scripts/test-p4-o.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as many from "./netlify/functions/suggestions.mjs";
import * as one from "./netlify/functions/suggestion.mjs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
assert.deepEqual(Object.keys(many).sort(), ["assertSuggestionAtKey", "config", "createSuggestionsHandler", "default"]);
assert.deepEqual(Object.keys(one).sort(), ["config", "createSuggestionHandler", "default"]);
assert.deepEqual(many.config, { path: "/api/suggestions" });
assert.deepEqual(one.config, { path: "/api/suggestion" });
for (const file of ["suggestions.mjs", "suggestion.mjs"]) {
  const source = readFileSync(`netlify/functions/${file}`, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(sf.parseDiagnostics.length, 0);
  for (const denied of ["doc.json", "@netlify/blobs", "console.", "process.env", "/api/edit", "/api/events", "waitUntil(", "publish("]) assert.equal(source.includes(denied), false, `${file}:${denied}`);
}
assert.match(readFileSync("netlify/functions/suggestions.mjs", "utf8"), /notify/);
assert.match(readFileSync("netlify/functions/suggestion.mjs", "utf8"), /notify/);
console.log("PASS  P4-O exports and AST boundaries");
NODE
```

Expected: exit 0 and exactly `PASS  P4-O exports and AST boundaries`. A pinned AST walk in the implementation PR additionally proves direct calls only to the declared P2-B/P3-B/P4-N/P4-H seams, no dynamic import/provider SDK/network/server/worker/timer/logging surface, create-only `setJSON(..., { onlyIfNew: true })`, no suggestion-object update, and no direct provider/`waitUntil` fan-out.

### 2. Deterministic runtime and supervisor gate

Run the permanent harness from the repository root:

```bash
node scripts/test-p4-o.mjs
```

It drives the real exported factories with closed fakes for origin, identity, access, store, effective base, apply, time, randomness, audit, hashing, and notify. The finite matrix covers every method/action/capability; accept/reject authorization denial before any key/receipt read; no-read withdraw miss and non-author hit producing identical 404; author-after-revocation withdraw; aligned actor-name boundaries at 200 UTF-16 code units including multibyte, control, and lone-surrogate actor-name cases; exact/missing/deleted/same-text base; preserved TAB/LF/CR plus rejected NUL/other controls/lone surrogates in proposal scalars; a multiline direct overlay used as suggestion base and accepted text; Mode A/B empty/nonempty author email; observed four/five/six records, a stale serial list that permits a sixth immutable create, simultaneous fifth creates whose successful writes overtake one another, and oldest-five FIFO projection/emergence across multiple aids; record/key corruption classes; 10-page/10,000-key and 67,108,863/67,108,864/67,108,865-byte response ceilings; ordering; 14-day boundary; ten/eleven reaper candidates; event/delete failures; two conflicting accepts; same/different-decider receipt replay; exact notification shapes/order/counts and true/false/throw isolation; body byte boundaries; and every public status.

The same command runs beneath one direct-child Node supervisor with a 180-second deadline. Beforeward self-probes HUP/INT/TERM and a TERM-resistant child, mapping 129/130/143/124, then reaps and proves the PID absent. First signal wins; unproved containment/deletion exits 125 and retains a mode-0700 root with a mode-0600 locator. On success the only lines are:

```text
PASS  P4-O supervisor signals and deadline
PASS  P4-O suggestion, reaping, and fan-out runtime
PASS  P4-O fixture cleaned
```

### 3. Hosted and repository gate

With authenticated `gh` and `netlify` CLIs able to create/delete disposable fixture resources, run the exact opt-in command:

```bash
AIUR_P4O_HOSTED=1 node scripts/test-p4-o.mjs --hosted
```

No other environment value selects hosted execution. Against one generated disposable Netlify site/store and one invented GitHub fixture repository, it creates five proposals, refuses the sixth, accepts one in each mode, proves denied accept/reject do not touch a known key, rejects one, withdraws one after revocation, proves no-read non-author hit/miss concealment, supersedes/reaps ten, and forces one Git conflict. Strong reads prove exact keys/records/receipts/events/deletions, while the injected fan-out boundary proves the one/two/zero caller matrix. A 900-second supervisor removes site/state/users, branches/PRs/repository fixture, and its local mode-0700 root before printing exactly `PASS  P4-O hosted suggestion lifecycle and fan-out`. Cleanup uncertainty exits 125, prints no PASS line, and retains only a mode-0600 locator to the unresolved disposable resource.

```bash
set -euo pipefail
: "${P4O_BASE:?set P4O_BASE}"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-O.md netlify/functions/suggestions.mjs netlify/functions/suggestion.mjs scripts/test-p4-o.mjs
git diff --check "$P4O_BASE"...HEAD
git diff --check
test -z "$(git diff --name-only "$P4O_BASE"...HEAD | grep -Ev '^(netlify/functions/suggestions?\.mjs|scripts/test-p4-o\.mjs|docs/tickets/P4-O\.md)$' || true)"
issue_json="$(gh issue view 37 --json title,body)"
pointer="$(ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P4-O.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P4-O — The suggestion API" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
unset issue_json pointer pointer_sha pointer_path
printf '%s\n' 'PASS  P4-O repository gates'
```

Expected: every command exits 0, generated artifacts are byte-identical, issue #37 contains only the prompt-prescribed full-commit permalink to this canonical document and its addressed bytes match, and the last line is exactly `PASS  P4-O repository gates`.

## Failure modes

- Missing/corrupt/unbundled manifest or Mode A private manifest: safe 503/500, no fallback to HTML, request path, or `doc.json`.
- Base/aid changed or deleted: create/accept returns 409/404 as contracted; existing record remains and lists superseded.
- Same-text create or repository actor without a usable author email: 400/500 before inventory/write; no permanently unacceptable proposal is stored and no author address is fabricated.
- Multiline/TAB text and base text remain byte-for-byte input to conversion, hashing, storage, notification, and apply; no layer folds CR/LF, while P4-R alone may omit an unrepresentable public patch display without changing promoted text.
- GitHub failure in accept: P4-N returns safe 502 before receipt/delete/event; the proposal remains.
- Unauthorized accept/reject: exact 403 before key/receipt state, so existence is not probed. A revoked no-read withdrawer sees the same exact 404 for a miss and another author's hit, while their own immutable author match remains withdrawable.
- Crash after apply before delete: valid suggestion receipt makes retry skip the second commit/write and finish deletion.
- Crash/event ambiguity around delete: an event can duplicate or be absent; immutable proposal/applied receipt remains authoritative.
- Notification false/throw after a durable transition: response and state/event outcome remain unchanged; accept's two notification attempts are isolated from each other.
- Accept racing reject/withdraw/reap crosses independent receipt/event/delete keys. The applied receipt wins publication if apply committed; delete wins proposal existence; contradictory/duplicate audit is possible and no cross-key transaction is claimed.
- Concurrent cap checks or an eventually stale serial list: more than five can land. GET validates all but projects only the oldest five per aid, so later overflow appears FIFO after older records leave. A future strict limit requires a per-block coordination design; do not add an unowned counter.
- Inventory beyond finite ceilings: return 503 and perform no maintenance/action that depended on an incomplete view.
- Serialized list above 67,108,864 UTF-8 bytes: exact 503 `resource-limit`, no partial JSON or success response.

## Settled decisions

- Suggestion state is key existence plus computed base relation; no mutable `status` exists.
- P2-G access store is sole authority; commenters can suggest, owners/editors decide, and only an author may withdraw.
- Decision denial is pre-read; revoked-author withdrawal is the only action allowed to read solely for author proof, with 404 concealment for no-read non-author hits.
- The action body carries `aid` because the canonical key is block-scoped; suggestion ID alone is not a safe locator.
- Acceptance shares P4-N's apply path and never merges a pull request.
- P3-B's canonical target wins over research 08: rejected prose/reason is not stored in events.
- Creation refuses when its bounded list proves five; P2-B's eventual-list/concurrent boundary means storage is not falsely described as a hard invariant, while list projection remains deterministically bounded to the oldest five per aid.
- P4-T reuses `assertSuggestionAtKey()`; it does not own a second record parser.
- P4-D/P4-H `notify()` is the sole fan-out call: suggestions never import Slack, Ably, or `publish`, and only acceptance also emits `edit.saved`.
- A proposed replacement must differ from its proven base; repository-mode authors need their own nonempty canonical email, while Mode A actors may retain empty email.

## Assumptions and open questions

- **Assumption:** P4-N exports `readEffectiveBase()` and returns manifest `section`/`commit` with the effective text/hash so this ticket never parses a manifest independently.
- **Assumption:** P4-N's same-suggestion receipt replay is distinguishable by exact `via` and `sugId` and returns the stable PR number.
- **Open question, non-blocking:** if simultaneous traffic exceeds the five-record product cap often, enforcing it strictly requires a new mutable coordination record and a cleanup protocol.
- **Open question, non-blocking:** canonical P3-B cannot preserve rejected text/reason after deletion. Expanding that audit payload would require a separately owned P3-B schema amendment.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.5, 2.4, and 4.7 — immutable suggestion keys, authority, events, and Phase 4 split.
- `docs/research/08-suggestions-and-editing-model.md` §§4–6, 8–9, and 12 — lifecycle, effective base, modes, authorship, API, and caps; its `doc.json` authority and oversized event targets are superseded by P2-G/P3-B.
- `docs/research/05-inline-editing.md` §§6–9 — converter, conflict, attribution, and Git apply background.
- `docs/research/09-sharing-and-roles.md` §§4–6 — role intent, refined by canonical P2-G.
- `docs/tickets/P2-B.md`, `P2-D.md`, `P2-G.md`, `P3-B.md`, `P3-E.md`, and `P4-N.md` — canonical keys, manifest, access, events, receipts, effective base, and apply contracts.
- `docs/tickets/P4-D.md` and `P4-H.md` — exact suggestion/edit notification variants and single fan-out boundary.
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — strong reads, conditional creates, delete propagation, and page-size behavior; checked 2026-09-03.
