# P3-E — GET /api/pending

## Outcome

An authenticated document reader can fetch one deterministic pending-edit overlay; valid receipts whose source block has landed or disappeared are omitted without this read endpoint mutating `doc-state`.

## Context

An accepted edit can be durable before the deployed HTML contains it. A short-lived receipt makes that text visible immediately without making Netlify Blobs the source of record.

The deployed P2-D edit manifest is the authority for document identity, editable-block membership, and the built block hash. P3-E compares every receipt with that manifest, omits stale receipts, and returns only the client fields needed to paint the overlay. Receipt replacement remains race-safe because the later P4-B/P4-N writers use P2-B's conditional `mutate()` protocol for the one slot per aid.

## Scope

### In scope

- Create one Netlify Functions v2 ESM handler at `GET /api/pending?doc=<docId>`.
- Authenticate through P2-H `identify(req)` and authorize through P2-G `resolveRole(docId, user)` before inspecting a manifest or state.
- Locate a P2-D sidecar by permanent document ID, never by a client slug, alias, instance, directory, or path.
- Validate the complete manifest, listed keys, read envelopes, and receipt domain records before using them.
- Read exactly `edits/<docId>/*`, omit valid stale receipts without a write, and project fresh receipts deterministically.
- Accept the initial direct-edit receipt and the settled P4-N direct/suggestion extensions now, so P4-N does not need to amend this reader.
- Return the exact HTTP, cache, error, and privacy behavior below.
- After P1-E is integrated, add the exact pending-function sidecar inclusion declaration to `netlify.toml` and prove both root and nested sidecars occur exactly once in the built function bundle.
- Supply isolated deterministic tests with finite process and cleanup ownership.

### Out of scope

- `POST /api/edit`, conversion, repository writes, receipt creation/replacement, and editing UI. P4-B/P4-N own them.
- Suggestions, decisions, effective-base checks for writes, suggestion expiry, events, notification, or realtime publication.
- Creating/changing manifests, reading section sources, calculating a manifest hash, or repairing malformed state.
- Changing identity, roles, invitations, owner capture, or the capability matrix.
- Adding a store helper, package, lockfile, store, database, environment variable, polling loop, or permanent test file.
- Returning raw receipts, ETags, access records, source paths, instance names, commits, or internal errors.
- Treating `list()` as a write acknowledgement. A write client paints its successful write response directly.
- Deleting or repairing stale/corrupt receipts from this GET. Later writers replace one aid slot only through the required conditional protocol under **Dependencies**.

## Interface contract

### Module surface

Create `netlify/functions/pending.mjs` with exactly these runtime exports:

```js
export function createPendingHandler(dependencies)
export default async function handler(req)
export const config = { path: "/api/pending" }
```

`createPendingHandler()` is the deterministic in-process test seam. It validates and captures one exact dependency object and returns an async `(req) => Response` handler. The default handler is created once from the production dependencies and delegates to it; it contains no second algorithm.

```js
{
  identify,             // P2-H identify(req)
  resolveRole,          // P2-G resolveRole(docId, user)
  capabilitiesFor,      // P2-G capabilitiesFor(role)
  assertIdentitySub,    // P2-G
  normalizeEmail,       // P2-G
  docState,             // P2-B
  editPrefix,           // P2-B
  editKey,              // P2-B
  read,                 // P2-B
  upgrade,              // P2-B
  manifestRoot          // absolute existing directory; production: process.cwd()
}
```

Require an ordinary object with exactly those own keys; every function field must be callable. `manifestRoot` must be an absolute regular directory path after `lstat`, not a symlink. Invalid factory dependencies throw `TypeError("Invalid pending dependencies")` synchronously before a handler exists; request-time filesystem failure uses the HTTP mapping below. The immutable deploy manifest index is lazy and cached per created handler only after complete successful validation; a failure never caches a partial index.

Use static relative imports from `../lib/identity.mjs`, `../lib/access.mjs`, and `../lib/store.mjs`. Import only the named functions above plus P2-B `StoreError` for status mapping. Add no package. Helpers and validators stay private.

Do not set `config.method`; the handler must return its own exact `405`, including for `HEAD` and `OPTIONS`.

### HTTP contract

The only valid target is `/api/pending?doc=<docId>`. The decoded query has exactly one key named `doc`, exactly one value, and that value matches `^[0-9a-f]{6}$`. Missing, empty, repeated, upper-case, slug-like, path-like, encoded-separator, whitespace, or extra parameters are `400`; never trim or normalize.

Every response has `Cache-Control: private, no-store`. A `200` also has `Content-Type: application/json; charset=utf-8`. Every error body is empty and therefore has no `Content-Type`.

| Condition | Status | Extra header | Body |
|---|---:|---|---|
| Authorized success | `200` | JSON content type | Exact overlay object; `{}` when empty |
| Invalid authenticated GET query | `400` | none | Zero bytes |
| No proven session | `401` | none | Zero bytes |
| Complete valid resolved access with `canRead: false` | `403` | none | Zero bytes |
| Authorized ID absent from a nonempty valid index | `404` | none | Zero bytes |
| Non-GET | `405` | `Allow: GET` | Zero bytes |
| Malformed/incomplete/inconsistent resolved access or canonical capability row | `500` | none | Zero bytes |
| Corrupt manifest/state or internal invariant | `500` | none | Zero bytes |
| Missing/unreadable manifest inventory, a stated manifest/list capacity ceiling, or provider unavailable | `503` | none | Zero bytes |

No response redirects or adds CORS headers. GET does not call `requireOrigin()`.

### Exact operation order

Stop at the first response/failure:

1. Reject `req.method !== "GET"` with `405`; do not identify or touch query, access, files, or store.
2. Call `identify(req)` once. `null` returns `401`; do not parse the query or touch access/files/store.
3. Parse and validate the exact query. Client-selected invalid input returns `400`.
4. Call `resolveRole(docId, user)` once with no third argument. Before reading `canRead`, require the result's prototype to be exactly `Object.prototype` and require `Reflect.ownKeys(result)` to equal these ten strings in P2-G order: `role`, `shared`, `canRead`, `canComment`, `threadControl`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, `canSeeMembers`. Every property descriptor must be an own enumerable data descriptor, never an accessor. Require `role` to be `owner`, `editor`, `commenter`, `viewer`, or `none` and `shared` to be boolean. Call `capabilitiesFor(role)` once and apply the same prototype/`Reflect.ownKeys`/data-descriptor checks to its exact eight keys (`canRead` through `canSeeMembers`). Require every returned access capability to equal that canonical row, including the seven boolean fields and `threadControl` string. Any null, incomplete, non-enumerable, symbol, extra, inherited, accessor, wrong-type, or internally inconsistent resolved access/canonical row is a `500` before manifest/store work. Only after this closed validation may exact boolean `canRead: false` return `403`. Never use `consumeInvitation: true`.
5. Load/select the immutable manifest index. Empty/unavailable inventory is `503`; a valid nonempty index without the ID is `404`.
6. Call `docState()` once, `editPrefix(docId)` once, then call `store.list({ prefix, paginate: true })` once. Do not construct the prefix locally. The call must return an async iterable; do not await it as an automatic aggregate result.
7. Consume and validate its manual pages sequentially under the exact limits below, then raw-code-unit sort all listed full keys. Strongly `read()` and validate each in that order.
8. After every hit validates, classify a hit as fresh or stale from the exact manifest/hash rule below. Omit stale hits without calling `delete`, `setJSON`, `mutate`, or any other write.
9. Iterate `Object.keys(manifest.blocks)` in validated insertion order, project only fresh hits, serialize once with `JSON.stringify()`, and return `200` without a terminal newline.

P2-B `unavailable` and thrown list/read provider failures map to `503`. P2-B invalid/unsupported records, P2-G internal errors, malformed provider envelopes, and manifest invariants map to `500`. Never serialize/log an error, cause, stack, provider message, path, key, ETag, actor, receipt, or access record.

### Manifest discovery and binding

P2-D writes `<instance>/dist/<basename(instance)>.edit.json`, including nested instances. The request supplies only `docId`.

Starting at `manifestRoot` at directory depth zero, recursively inspect entries without following symlinks. Raw-code-unit sort every directory's entry names before inspecting them. Skip `.git`, `_site`, `node_modules`, and `netlify` directories at every depth. Accept only regular nonsymlink candidates whose root-relative `/`-separated path ends in `<instance>/dist/<basename(instance)>.edit.json`. A candidate symlink is invalid, not ignored; another symlink is not followed. Raw-sort candidate paths before reading. Reject duplicate paths/docIds, malformed JSON, or any invalid candidate. Do not choose one arbitrarily.

Discovery is finite and uses these exact inclusive ceilings over one attempted index build:

- descend at most 12 directory edges below `manifestRoot`; a regular candidate file may occur inside a directory at depth 12, but encountering an otherwise traversable directory at depth 13 returns `503`;
- admit at most 4,096 directory entries across all `readdir` results, including ignored ordinary files and skipped/symlink entries; observing entry 4,097 returns `503` before inspecting it;
- admit at most 64 candidate sidecars; candidate 65 returns `503` before any candidate bytes are read;
- read at most 2,097,152 bytes from one candidate and 8,388,608 candidate bytes in total; a declared size or observed byte beyond either ceiling returns `503`;
- admit at most 5,000 block rows in one manifest and 10,000 block rows across the index; the first row beyond either ceiling returns `503`.

Ceiling failures mean a complete authoritative index could not be established: return `503` and cache nothing. At an exact boundary, continue normally. The entry, candidate, byte, and block counters reset only for a new index-build attempt after failure; they are not request-selected.

Inventory status is exact. Failure to open or inspect the root, `readdir`/`lstat` failure at any traversed entry, a candidate disappearing or changing during inspection, or failure to read/close candidate bytes (`ENOENT`, `EACCES`, `EIO`, or any other filesystem error) makes the inventory incomplete/unreadable and returns `503`; cache nothing. A complete successful traversal with zero candidates is also `503`. Bytes that were read successfully within capacity but are not strict UTF-8/JSON, violate the candidate/path/schema invariants, collide by path/docId, or identify a symlink candidate are corrupt/ambiguous inventory and return `500`; cache nothing.

Candidate reads are bounded even if a file changes. `lstat` first; open the proven nonsymlink regular candidate with `O_RDONLY | O_NOFOLLOW`; `fstat` and require the same device/inode and a regular file; reject a declared size above the per-file ceiling or remaining aggregate-byte budget before allocation/read; otherwise read in chunks of at most 65,536 bytes while stopping at a limit-plus-one byte if the file grows; `fstat` again and require unchanged device, inode, size, `mtimeMs`, and `ctimeMs`; then close in `finally`. Decode only the bounded bytes with a fatal UTF-8 `TextDecoder` before `JSON.parse`. An unsupported `O_NOFOLLOW`, open/fstat/read/close error, short/growing/replaced file, or metadata change is incomplete inventory `503`, not permission to fall back to `readFileSync` or follow a path.

A completely validated nonempty index is cached immutably inside that created handler. Factory construction performs only the required root `lstat`; the first authorized request needing a manifest performs one full build. After success, later requests through that same handler do not traverse, stat, open, or reread manifests even if source paths change or disappear. A failed build is not cached, so the next eligible request retries from zero. Only after a successful cached build can an absent authorized `docId` return `404`.

Each parsed manifest is a plain JSON object with exactly `docId`, `instance`, `commit`, `blocks`:

- `docId`: `^[0-9a-f]{6}$`.
- `instance`: `^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$` and byte-equal to the candidate instance-directory basename.
- `commit`: a string; an opaque hint that never affects staleness.
- `blocks`: a non-null plain object. Each own key is `^a[0-9a-f]{8}$`.
- Each row has exactly `file`, `section`, `tag`, `hash`; `file` matches `^sections\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$`; `section` is nonempty; `tag` is `p`, `h2`, `h3`, or `h4`; `hash` is 64 lowercase hexadecimal characters.

Do not open any `row.file`, section, HTML artifact, `doc.json`, request-selected path, or manifest-selected path. Only validated manifest identity, block order, and hashes enter P3-E behavior.

### Key/list/read and stale-omission contract

The only store is P2-B site-wide strong `doc-state`:

```text
edits/<docId>/
edits/<docId>/<aid>.json
```

Call the official Netlify Blobs manual-pagination form exactly once: `store.list({ prefix: editPrefix(docId), paginate: true })`. Require its direct return to expose a callable `Symbol.asyncIterator`. Consume at most eight yielded pages sequentially with `for await`; page nine returns `503`. Each page must be a non-null ordinary object with exactly own enumerable data keys `blobs` and `directories`; both are dense arrays, `directories` is empty, and `blobs.length <= 1000`, matching Netlify's documented maximum server page. A malformed iterable/page, a page with 1,001 blobs, or nonempty directories is `500`. Zero yielded pages and yielded empty pages are valid empty inventory; every yielded page still counts toward the eight-page ceiling.

Across pages admit at most 5,000 blob entries and therefore at most 5,000 strong reads. Entry 5,001 returns `503` before any receipt read. Each blob is a non-null ordinary object with own enumerable data-string `key` and `etag` properties; provider-added own fields are ignored, but accessors, inherited key/etag, empty values, symbols, or a non-ordinary prototype are malformed `500`. After the exact prefix, a key suffix must match `^(a[0-9a-f]{8})\.json$`, and `editKey(docId, aid)` must reproduce the full key. Duplicate keys/aids across any pages are `500`. Fully validate and collect this bounded key metadata before the first `read()`, then discard page objects, raw-sort the keys, and make at most 5,000 serial strong reads. Never skip, normalize, echo, mutate, or delete a malformed listed key.

Sort with `(a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0`. For each, call P2-B `read(store, key)` once. `{value:null, etag:null}` means the listed record is no longer present and is skipped. For a hit, call `upgrade(value)` once at the domain boundary, validate the receipt below, and require its `aid` to match the key aid.

A valid receipt is stale exactly when:

```js
manifest.blocks[receipt.aid] === undefined ||
manifest.blocks[receipt.aid].hash !== receipt.baseHash
```

No commit, timestamp age, text comparison, normalization, source read, or status flag participates. After all hits validate, stale hits are excluded only from the response model. This handler never calls `store.delete()`, `store.setJSON()`, P2-B `mutate()`, or another write method. Repeated/concurrent GETs therefore cannot erase a receipt that a writer replaced after an earlier read.

P4-B and P4-N must each implement the same one-slot conditional replacement contract before their respective release: the only slot for an aid is `editKey(docId, aid)`, and every create/replacement calls P2-B `mutate(store, key, nextReceipt, apply)` rather than direct `onlyIfNew`, `onlyIfMatch`, `setJSON`, or delete. `nextReceipt` is a completely validated immutable value. `apply(current)` is synchronous and pure; when `current !== null`, it first applies the exact receipt validator and requires `current.aid === aid`, then returns a fresh clone of `nextReceipt` (or returns `null` only for a writer-defined exact idempotent replay that has proved the committed receipt is already the intended operation). On a miss, P2-B `mutate` uses `onlyIfNew`; on a hit it uses the freshly read ETag with `onlyIfMatch`; it retries a modified race for at most six total attempts. The writer accepts success only from `mutate`'s returned committed `{ value, etag, changed }`, with the value revalidated for the exact aid/operation. Thus a racing writer either conditionally replaces the observed version, retries against the winner, returns its defined idempotent result, or reports its own bounded conflict/unavailable response; no cleaner exists and `onlyIfNew` alone is never claimed to protect replacements.

The plan does not confirm strong consistency for `list()`. A list miss is not proof of absence and not a write acknowledgement; the successful write response paints the new receipt, and a later refresh may discover it.

### Receipt schemas and projection

All receipts are plain JSON objects and pass `upgrade()`. Timestamps match `YYYY-MM-DDTHH:mm:ss.sssZ` and round-trip through `new Date(value).toISOString()`. Hashes are 64 lowercase hexadecimal characters. `pr` is `null` or a positive safe integer. `text` is a string of at most 4,000 UTF-16 code units; empty is valid at this read boundary.

An actor has exactly `sub`, `name`, `email`. `sub` passes P2-G `assertIdentitySub()`. `name` is a string of at most 200 code units, including empty. `email` is empty or already equals `normalizeEmail(email)`.

Initial direct receipt, exact keys:

```json
{
  "v": 1,
  "aid": "a31b7c9d2",
  "text": "The orchard index covers **every** declared basket.",
  "by": { "sub": "u_fixture_writer_31", "name": "Avery Quill", "email": "avery@example.com" },
  "at": "2026-09-03T17:04:11.201Z",
  "baseHash": "1111111111111111111111111111111111111111111111111111111111111111",
  "pr": 412
}
```

Also accept the same seven keys plus `"via":"edit"`. The suggestion extension has the same seven keys plus exactly:

```json
{
  "via": "suggestion",
  "sugId": "s_m8x2k1_4f7a9c31",
  "acceptedBy": { "sub": "u_fixture_decider_44", "name": "River Vale", "email": "river@example.com" },
  "acceptedAt": "2026-09-03T17:08:03.884Z"
}
```

`sugId` matches P3-B exactly: `^s_[a-z0-9]{1,48}_[0-9a-f]{8}$`. Its middle component is one through 48 lower-case base-36 characters. `acceptedBy` is an actor; `acceptedAt` is a timestamp. Missing `via` means only the initial shape. `via:"edit"` forbids suggestion fields. `via:"suggestion"` requires all three. `by` remains the text author, `acceptedBy` the decider, and `pr:null` is valid in standalone mode. Unknown/missing/extra/wrong/over-limit data is corrupt `500` state and is never projected or mutated.

The `200` object is keyed by aid and ordered by `manifest.blocks`, never list completion, timestamp, locale, PR, or actor. Initial entry fields are `text`, `by`, `at`, `pr`; extended direct appends `via`; suggestion appends `via`, `sugId`, `acceptedBy`, `acceptedAt`. Actors are fresh objects ordered `sub`, `name`, `email`.

```json
{
  "a31b7c9d2": {
    "text": "The orchard index covers **every** declared basket.",
    "by": { "sub": "u_fixture_writer_31", "name": "Avery Quill", "email": "avery@example.com" },
    "at": "2026-09-03T17:04:11.201Z",
    "pr": 412,
    "via": "edit"
  }
}
```

Never return `v`, duplicate `aid`, `baseHash`, ETag/list metadata, docId, manifest instance/commit, row file/section/tag/hash, or unknown fields.

## Files owned

- `netlify/functions/pending.mjs` — **new**, created exclusively by P3-E.
- `netlify.toml` — **amended sequentially after P1-E**, only by adding this exact function-scoped declaration:

```toml
[functions.pending]
  included_files = ["**/dist/*.edit.json"]
```

P3-E may not alter any existing `netlify.toml` declaration or add another declaration there. No other implementation/configuration/package/lock/template/generated/fixture/research/prompt/ticket file belongs to P3-E. This ticket document is not implementation surface.

## Dependencies

### Required predecessors

- **P1-E:** owns the base `netlify.toml` configuration. P3-E follows it sequentially and owns only the additive `[functions.pending]` block above; this is not an ownerless release prerequisite.
- **P2-B:** `docState()`, `editPrefix()`, `editKey()`, `read()`, `upgrade()`, `StoreError`, exact key/version/error rules, the list-consistency caveat, and downstream `mutate()` CAS semantics. P3-E itself calls direct `list()` and remains read-only.
- **P2-D:** deterministic root/nested edit sidecars, exact manifest/block order and shape, permanent IDs, editable membership, and exact inner-HTML SHA-256 hashes.
- **P2-G:** `resolveRole()`, `capabilitiesFor()`, `assertIdentitySub()`, and `normalizeEmail()`. P3-E validates the complete resolved-access object against the canonical fresh capability row before reading `canRead`; it never copies the role table.
- **P2-H:** final `identify(req)` result `{sub,email,name,isOrg}`. A non-null identity is not authorization.

P1-C is inherited through P2-H/P2-G and supplies ESM Functions, Node `>=22.12.0`, pinned packages, and the no-session boundary. The ruling P3-E row lists only P2-B/P2-D because it predates the final access split. Omitting P2-G/P2-H would expose pending text through the `/api/*` edge exclusion, so these are mandatory security dependencies.

P3-B is the schema source for suggestion IDs, not a runtime or integration predecessor: P3-E repeats its exact `sugId` grammar so the later P4-N receipt extension is accepted without amending this reader.

### Owned deployment amendment

P3-E adds the exact `[functions.pending]` declaration under **Files owned** only after P1-E has landed, then executes the bundle proof below. The glob is intentionally repository-wide because P2-D instances may be root or nested. The proof must show each representative sidecar exactly once in the built `pending` function and execute the bundled handler against the extracted bundle root; repository-source presence alone is insufficient. No undocumented production working-directory assumption is accepted.

### Downstream consumers and waves

- **P4-B** creates/replaces the one receipt slot through the exact P2-B `mutate()` contract above and consumes the overlay for later refresh.
- **P4-N** may write `via`/suggestion fields through that same `mutate()` contract but must not amend `pending.mjs`; P3-E already accepts them.
- **P4-O/P4-P** consume the same applied-overlay/expiry meaning.

Maximum safe sequence:

1. After P1-E is integrated, add only the exact `[functions.pending]` block to `netlify.toml`.
2. After P2-B/P2-D/P2-G/P2-H are integrated, implement only `pending.mjs`.
3. Run the deterministic fixture, then the exact bundle/config proof, then repository gates serially. Do not concurrently drive shared `node_modules`, `.netlify`, `_site`, ports, or Blobs fixtures.

## Acceptance criteria

- [ ] P3-E changes only `pending.mjs` plus the exact additive `[functions.pending]` block in `netlify.toml`, and the module exposes exactly the factory, default handler, and config.
- [ ] Non-GET returns exact `405` behavior before other work; GET order is identity, strict query, default role resolution, complete resolved-access/canonical-capability validation, manifest, store/list, sorted reads/validation, stale classification, manifest-order projection.
- [ ] No session is `401`; a complete valid resolved access with exact false `canRead` is `403`; malformed/incomplete/inconsistent access is `500`. None touches manifests/state, and no identity/client field replaces `resolveRole()`.
- [ ] The query accepts exactly one six-lowercase-hex `doc` and rejects extras, duplicates, slugs, instances, paths, encodings, case changes, whitespace, and empty values with `400`.
- [ ] Root/nested manifest discovery raw-sorts each directory, follows no symlink, enforces exact depth/entry/candidate/per-file/aggregate-byte/per-manifest/aggregate-block ceilings, rejects duplicate/malformed candidates, and caches only a complete valid index.
- [ ] Valid authorized missing doc is `404`; absent/unreadable inventory is `503`; corrupt/ambiguous inventory is `500`.
- [ ] Every manifest field/key/row is validated before a hash affects stale classification; `commit` never participates.
- [ ] Store/prefix/manual `list({prefix,paginate:true})` each run once; at most eight ordinary pages, 1,000 entries per page, and 5,000 total entries/reads are admitted; every page/key/ETag is validated before serial P2-B reads in raw key order.
- [ ] Read miss skips. Malformed key/receipt fails `500` without deletion. All three exact receipt shapes and limits, including one-, 48-, and 49-character suggestion-ID boundaries, are covered.
- [ ] Manifest-row absence and unequal `baseHash` are the only stale cases. All stale valid hits are omitted only after the full hit set validates; GET performs no delete or other write. A complete pinned-Acorn walk admits only the exact three relative dependencies plus `node:fs`, rejects aliased or write-capable filesystem imports, statically resolved write calls/constants/store members, dynamic imports, and logs; read-only filesystem exports/open flags and store proxies make any exercised write-surface access fail the runtime fixture. No universal claim is inferred for an unexecuted dynamically computed path.
- [ ] Fresh entries remain stored and emit in manifest order with exact conditional projection and fresh actor copies.
- [ ] Empty state is exact bytes `{}`. Every response is private/no-store; only `200` has the exact content type; error bodies are empty.
- [ ] List/read failures map to exact `500`/`503`; no error/log exposes text, actors, keys, paths, ETags, access data, provider details, causes, or stacks.
- [ ] Concurrent and repeated GETs remain read-only, cannot erase an observed or replacement receipt, and treat a post-list creation as visible only on a later refresh. The P4-B/P4-N conditional-replacement rule remains a downstream dependency boundary, not a P3-E completion gate.
- [ ] The executable fixture instruments and permutes actual production filesystem traversal plus multi-page list enumeration, requires byte-identical repeated output and the same sorted read order, then proves the first invalid sorted receipt stops before a later key is read.
- [ ] The fixture proves every exact manifest and list ceiling at/beyond its boundary and dynamically proves lazy immutable index caching: no traversal during factory construction, one traversal on first eligible request, and no new traversal or changed result after the discovered manifest is changed and then removed.
- [ ] The handler fixture starts no server or detached workload. Its successful foreground run exercises bounded positive-PID deletion, reaping, and absence of the exact root. HUP/INT/TERM trap mappings remain fail-safe operator behavior but are not claimed as dynamically injected acceptance cases by this fixture.
- [ ] P3-E has added the exact function-scoped sidecar inclusion after P1-E, and the executable build proof finds each root/nested sidecar exactly once and runs the bundled handler against its extracted bundle root.
- [ ] On the executed success path, both builds, the networked pinned CLI, AST phase, archive phases, and bundled handler start only after authenticated launcher readiness, complete under one 900-second group deadline, close/reap, prove group disappearance, and then use a separately authenticated deletion child with five-second ready, 30-second operation, five-second close, and five-second disappearance bounds. The command defines first-signal HUP/INT/TERM mapping and revalidated TERM→KILL failure handling, but this ticket does not claim dynamic signal/deadline injection beyond the exact executed success and cleanup path.
- [ ] Scrub, headings/fences, Bash syntax, TypeScript, build freshness, and diff whitespace pass without lockfile, root `node_modules`, `.netlify`, `_site`, response, or fixture residue; issue #18 passes the executable pointer-integrity gate: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

Run from repository root after required predecessors/configuration are integrated, on Node 22.12 or later. Examples are invented.

### 1. Syntax and export smoke contract

```bash
set -euo pipefail
test -f netlify/functions/pending.mjs
test -f netlify/lib/store.mjs
test -f netlify/lib/access.mjs
test -f netlify/lib/identity.mjs

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const module = await import("./netlify/functions/pending.mjs?p3e-export-smoke");
assert.deepEqual(Object.keys(module).sort(), ["config", "createPendingHandler", "default"]);
assert.equal(typeof module.createPendingHandler, "function");
assert.equal(typeof module.default, "function");
assert.deepEqual(module.config, { path: "/api/pending" });
console.log("PASS  P3-E syntax and exports");
NODE
```

Expected exactly `PASS  P3-E syntax and exports` and exit `0`. This is intentionally only a smoke check. The mandatory supervised bundle phase uses pinned Acorn to prove the complete relative-import and forbidden-call structure, and the handler fixture supplies store/filesystem mocks that throw on any write-capable access.

### 2. Deterministic handler fixture

This exact command uses the exported production factory, not a duplicate handler.

```bash
bash <<'BASH'
set -euo pipefail

P3E_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p3-e-pending.XXXXXX")"
P3E_PARENT="$(cd "$(dirname "$P3E_ROOT")" && pwd -P)"
P3E_DELETE_PID=
P3E_SIGNAL_STATUS=0

p3e_cleanup() {
  local prior="$?"
  trap - EXIT HUP INT TERM
  case "$P3E_ROOT" in "$P3E_PARENT"/p3-e-pending.??????) ;; *)
    printf 'ERROR  unsafe P3-E fixture root: %s\n' "$P3E_ROOT" >&2
    exit 1
  esac
  if test -L "$P3E_ROOT" || ! test -d "$P3E_ROOT"; then
    printf 'ERROR  unproved P3-E fixture root: %s\n' "$P3E_ROOT" >&2
    exit 1
  fi
  node -e 'require("node:fs").rmSync(process.argv[1],{recursive:true})' "$P3E_ROOT" &
  P3E_DELETE_PID="$!"
  local tick=0
  while kill -0 "$P3E_DELETE_PID" 2>/dev/null && test "$tick" -lt 100; do
    sleep 0.05
    tick=$((tick + 1))
  done
  if kill -0 "$P3E_DELETE_PID" 2>/dev/null; then
    kill -KILL "$P3E_DELETE_PID" 2>/dev/null || true
    wait "$P3E_DELETE_PID" 2>/dev/null || true
    printf 'ERROR  P3-E cleanup timed out; inspect %s\n' "$P3E_ROOT" >&2
    exit 1
  fi
  wait "$P3E_DELETE_PID"
  if test -e "$P3E_ROOT"; then
    printf 'ERROR  P3-E cleanup left residue: %s\n' "$P3E_ROOT" >&2
    exit 1
  fi
  if test "$P3E_SIGNAL_STATUS" -ne 0; then exit "$P3E_SIGNAL_STATUS"; fi
  if test "$prior" -eq 0; then
    printf 'PASS  P3-E fixture cleaned\n'
  fi
  exit "$prior"
}
trap 'P3E_SIGNAL_STATUS=129; exit 129' HUP
trap 'P3E_SIGNAL_STATUS=130; exit 130' INT
trap 'P3E_SIGNAL_STATUS=143; exit 143' TERM
trap p3e_cleanup EXIT

P3E_ROOT="$P3E_ROOT" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

const fixtureDeadline = setTimeout(() => {
  console.error("FAIL  P3-E handler fixture exceeded 120 seconds");
  process.exit(124);
}, 120000);

const fsSource = `
  import { closeSync as realClose, fstatSync as realFstat, lstatSync as realLstat, openSync as realOpen, readSync as realRead, readdirSync as realReaddir, constants } from "node:fs";
  const hit = (name, value) => { globalThis.__p3eFsLog?.push([name, String(value)]); };
  export { constants };
  export function lstatSync(...args) { hit("lstat", args[0]); return realLstat(...args); }
  export function readdirSync(...args) {
    hit("readdir", args[0]);
    const rows = realReaddir(...args);
    if (!Array.isArray(rows) || rows.length < 2) return rows;
    const result = [...rows];
    let state = ((globalThis.__p3eFsSeed ?? 0) ^ result.length) >>> 0;
    for (let index = result.length - 1; index > 0; index -= 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const selected = state % (index + 1);
      [result[index], result[selected]] = [result[selected], result[index]];
    }
    globalThis.__p3eFsOrders?.push(result.map((entry) => typeof entry === "string" ? entry : entry.name));
    return result;
  }
  export function openSync(path, flags, ...args) {
    hit("open", path);
    if (flags !== (constants.O_RDONLY | constants.O_NOFOLLOW)) throw new Error("pending candidate open was not read-only/no-follow");
    return realOpen(path, flags, ...args);
  }
  export function fstatSync(...args) { hit("fstat", args[0]); return realFstat(...args); }
  export function readSync(...args) { hit("read", args[0]); return realRead(...args); }
  export function closeSync(...args) { hit("close", args[0]); return realClose(...args); }
`;
const hook = [
  "const sources=new Map([",
  "['p3e:identity','export async function identify() { return null }'],",
  "['p3e:access','export function assertIdentitySub(v){return v}; export function normalizeEmail(v){return v}; export function capabilitiesFor(){return {canRead:false,canComment:false,threadControl:\"none\",canSuggest:false,canEdit:false,canAccept:false,canShare:false,canSeeMembers:false}}; export async function resolveRole(){return {role:\"none\",shared:false,...capabilitiesFor(\"none\")}}'],",
  "['p3e:store','export class StoreError extends Error {}; export function docState(){throw new Error()}; export function editPrefix(){return \"\"}; export function editKey(){return \"\"}; export async function read(){return {value:null,etag:null}}; export function upgrade(v){return v}'],",
  `["p3e:fs",${JSON.stringify(fsSource)}],`,
  "]);",
  "export async function resolve(s,c,n){if(s.endsWith('/identity.mjs'))return {url:'p3e:identity',shortCircuit:true};if(s.endsWith('/access.mjs'))return {url:'p3e:access',shortCircuit:true};if(s.endsWith('/store.mjs'))return {url:'p3e:store',shortCircuit:true};if(s==='node:fs'&&c.parentURL?.includes('/netlify/functions/pending.mjs'))return {url:'p3e:fs',shortCircuit:true};return n(s,c)}",
  "export async function load(u,c,n){if(sources.has(u))return {format:'module',source:sources.get(u),shortCircuit:true};return n(u,c)}",
].join("\n");
register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);
const { createPendingHandler } = await import("./netlify/functions/pending.mjs?p3e-contract");
globalThis.__p3eFsLog = [];
globalThis.__p3eFsSeed = 0;
globalThis.__p3eFsOrders = [];

const root = process.env.P3E_ROOT;
const calls = [];
const actor = { sub: "u_fixture_reader_21", email: "reader@example.com", name: "Reader Vale", isOrg: true };
const receiptActor = { sub: "u_fixture_writer_31", name: "Avery Quill", email: "avery@example.com" };
const hash1 = "1".repeat(64);
const hash2 = "2".repeat(64);
const capabilityRows = {
  owner: { canRead:true, canComment:true, threadControl:"any", canSuggest:true, canEdit:true, canAccept:true, canShare:true, canSeeMembers:true },
  editor: { canRead:true, canComment:true, threadControl:"any", canSuggest:true, canEdit:true, canAccept:true, canShare:false, canSeeMembers:true },
  commenter: { canRead:true, canComment:true, threadControl:"own", canSuggest:true, canEdit:false, canAccept:false, canShare:false, canSeeMembers:false },
  viewer: { canRead:true, canComment:false, threadControl:"none", canSuggest:false, canEdit:false, canAccept:false, canShare:false, canSeeMembers:false },
  none: { canRead:false, canComment:false, threadControl:"none", canSuggest:false, canEdit:false, canAccept:false, canShare:false, canSeeMembers:false },
};
const resolvedAccess = (role = "viewer", shared = true) => ({ role, shared, ...capabilityRows[role] });
const manifest = {
  docId: "4b7d2a", instance: "sample-doc", commit: "invented-ref",
  blocks: {
    a22222222: { file: "sections/02-body.html", section: "body", tag: "p", hash: hash2 },
    a11111111: { file: "sections/01-intro.html", section: "intro", tag: "h2", hash: hash1 },
  },
};
mkdirSync(join(root, "nested", "sample-doc", "dist"), { recursive: true });
writeFileSync(join(root, "nested", "sample-doc", "dist", "sample-doc.edit.json"), JSON.stringify(manifest));

const records = new Map();
const key1 = "edits/4b7d2a/a11111111.json";
const key2 = "edits/4b7d2a/a22222222.json";
const freshReceipt = { v:1, aid:"a11111111", text:"First invented text.", by:receiptActor,
  at:"2026-09-03T17:04:11.201Z", baseHash:hash1, pr:412, via:"edit" };
const staleReceipt = { v:1, aid:"a22222222", text:"Stale invented text.", by:receiptActor,
  at:"2026-09-03T17:05:11.201Z", baseHash:hash1, pr:null };
records.set(key1, freshReceipt);
records.set(key2, staleReceipt);

const initialStoreTouches = [];
const store = new Proxy({
  list(options) {
    calls.push(["list", options]);
    return { async *[Symbol.asyncIterator]() {
      yield { blobs:[{key:key2,etag:"e2"},{key:key1,etag:"e1"}], directories:[] };
    } };
  },
}, {
  get(target, property, receiver) {
    if (property !== "list") { initialStoreTouches.push(["get", String(property)]); throw new Error(`forbidden store access ${String(property)}`); }
    return Reflect.get(target, property, receiver);
  },
  set(_target, property) { initialStoreTouches.push(["set", String(property)]); throw new Error(`forbidden store write ${String(property)}`); },
});
const deps = {
  async identify(req) { calls.push(["identify", req.method]); return actor; },
  async resolveRole(docId, user, options) {
    calls.push(["resolveRole", docId, user, options]);
    return resolvedAccess();
  },
  capabilitiesFor(role) { calls.push(["capabilitiesFor",role]); return {...capabilityRows[role]}; },
  assertIdentitySub(value) { assert.match(value, /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/); return value; },
  normalizeEmail(value) { return value.toLowerCase(); },
  docState() { calls.push(["docState"]); return store; },
  editPrefix(docId) { calls.push(["editPrefix", docId]); return `edits/${docId}/`; },
  editKey(docId, aid) { return `edits/${docId}/${aid}.json`; },
  async read(_store, key) { calls.push(["read", key]); return {
    value: records.get(key) ?? null, etag: records.has(key) ? `etag-${key}` : null }; },
  upgrade(value) { calls.push(["upgrade", value?.aid]); return value; },
  manifestRoot: root,
};

const handle = createPendingHandler(deps);
const response = await handle(new Request("https://docs.example.test/api/pending?doc=4b7d2a"));
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
assert.equal(await response.text(), JSON.stringify({
  a11111111: { text:"First invented text.", by:receiptActor,
    at:"2026-09-03T17:04:11.201Z", pr:412, via:"edit" },
}));
assert.equal(records.has(key1), true);
assert.equal(records.has(key2), true);
assert.deepEqual(calls.filter(([name]) => name === "read").map(([,key]) => key), [key1,key2]);
assert.deepEqual(calls.find(([name]) => name === "resolveRole").slice(1), ["4b7d2a",actor,undefined]);
assert.deepEqual(calls.find(([name]) => name === "list")[1], {prefix:"edits/4b7d2a/",paginate:true});
assert.deepEqual(initialStoreTouches, []);

function manifestRoot(name, value = manifest, nested = false) {
  const base = join(root, name);
  const instance = value.instance;
  const dir = nested ? join(base,"deep",instance,"dist") : join(base,instance,"dist");
  mkdirSync(dir, {recursive:true});
  writeFileSync(join(dir,`${instance}.edit.json`), JSON.stringify(value));
  return base;
}

function manifestSetRoot(name, values) {
  const base=join(root,name);
  for (const value of values) {
    const dir=join(base,value.instance,"dist");
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,`${value.instance}.edit.json`),JSON.stringify(value));
  }
  return base;
}
function manifestDepthRoot(name, depth, value = manifest) {
  assert.ok(Number.isInteger(depth) && depth >= 2);
  const base=join(root,name);
  let parent=base;
  for (let index=0; index<depth-2; index+=1) parent=join(parent,`level-${index}`);
  const dir=join(parent,value.instance,"dist");
  mkdirSync(dir,{recursive:true});
  const path=join(dir,`${value.instance}.edit.json`);
  writeFileSync(path,JSON.stringify(value));
  return {base,path};
}
const blockRows = (count, start = 1) => Object.fromEntries(Array.from({length:count},(_,index)=>[
  `a${(start+index).toString(16).padStart(8,"0")}`,
  {file:`sections/part-${start+index}.html`,section:`part-${start+index}`,tag:"p",hash:hash1},
]));
function shuffled(values, seed) {
  const result=[...values];
  let state=seed>>>0;
  for (let index=result.length-1; index>0; index-=1) {
    state=(state*1664525+1013904223)>>>0;
    const selected=state%(index+1);
    [result[index],result[selected]]=[result[selected],result[index]];
  }
  return result;
}

let caseNumber = 0;
function fixture(options = {}) {
  const log = [];
  const storeTouches = [];
  const values = new Map(options.values ?? []);
  const fakeStore = new Proxy({
    list(o) {
      log.push(["list",o]);
      if (options.listError) throw options.listError;
      if (Object.hasOwn(options,"listReturn")) return options.listReturn;
      const keys=options.listKeys ?? [...values.keys()].reverse();
      const pages = options.listPages ?? [{blobs:keys.map((key,i)=>({key,etag:`l${i}`})),directories:[]}];
      return { async *[Symbol.asyncIterator]() {
        for (const page of pages) {
          if (page instanceof Error) throw page;
          yield page;
        }
      } };
    },
  }, {
    get(target, property, receiver) {
      if (property !== "list") { storeTouches.push(["get", String(property)]); throw new Error(`forbidden store access ${String(property)}`); }
      return Reflect.get(target, property, receiver);
    },
    set(_target, property) { storeTouches.push(["set", String(property)]); throw new Error(`forbidden store write ${String(property)}`); },
  });
  const d = {
    async identify(req) { log.push(["identify",req.method]); return options.user === undefined ? actor : options.user; },
    async resolveRole(docId,user,third) { log.push(["resolveRole",docId,user,third]); return Object.hasOwn(options,"accessResult") ? options.accessResult : resolvedAccess(options.canRead === false ? "none" : "viewer"); },
    capabilitiesFor(role) { log.push(["capabilitiesFor",role]); return Object.hasOwn(options,"capabilitiesResult") ? options.capabilitiesResult : {...capabilityRows[role]}; },
    assertIdentitySub(v) { if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(v)) throw new Error("sub"); return v; },
    normalizeEmail(v) { const n=v.trim().toLowerCase(); if (!n.includes("@")) throw new Error("email"); return n; },
    docState() { log.push(["docState"]); return fakeStore; },
    editPrefix(docId) { log.push(["editPrefix",docId]); return `edits/${docId}/`; },
    editKey(docId,aid) { return `edits/${docId}/${aid}.json`; },
    async read(_s,key) {
      log.push(["read",key]);
      if (Object.hasOwn(options,"readResult")) return options.readResult;
      const value=values.get(key) ?? null;
      return {value,etag:value===null?null:`r-${key}`};
    },
    upgrade(v) { log.push(["upgrade",v?.aid]); if (v?.v!==1) throw new Error("version"); return v; },
    manifestRoot: options.root ?? manifestRoot(`case-${++caseNumber}`),
  };
  return {handle:createPendingHandler(d),log,values,storeTouches};
}

async function expect(req, instance, status, body="") {
  const r=await instance.handle(req);
  assert.equal(r.status,status);
  assert.equal(r.headers.get("cache-control"),"private, no-store");
  assert.equal(r.headers.get("content-type"),status===200?"application/json; charset=utf-8":null);
  if (status===405) assert.equal(r.headers.get("allow"),"GET");
  assert.equal(await r.text(),body);
  assert.deepEqual(instance.storeTouches, [], "no write-capable store property is accessed");
}

{
  const cached=manifestDepthRoot("cached-index",2);
  globalThis.__p3eFsLog=[];
  globalThis.__p3eFsSeed=41;
  const f=fixture({root:cached.base,values:[[key1,freshReceipt]],listKeys:[key1]});
  assert.equal(globalThis.__p3eFsLog.some(([name])=>["readdir","open","read"].includes(name)),false,"factory construction does not traverse manifests");
  const expected=JSON.stringify({a11111111:{text:freshReceipt.text,by:receiptActor,at:freshReceipt.at,pr:412,via:"edit"}});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,expected);
  const afterFirst=[...globalThis.__p3eFsLog];
  assert.equal(afterFirst.some(([name])=>name==="readdir"),true,"first eligible request traverses");
  assert.equal(afterFirst.some(([name])=>name==="read"),true,"first eligible request reads manifest bytes");
  writeFileSync(cached.path,"{");
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,expected);
  assert.deepEqual(globalThis.__p3eFsLog,afterFirst,"changed manifest is not revisited after successful cache");
  rmSync(cached.base,{recursive:true});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,expected);
  assert.deepEqual(globalThis.__p3eFsLog,afterFirst,"removed manifest tree is not revisited after successful cache");
}
{
  const retry=manifestDepthRoot("retry-index",2);
  writeFileSync(retry.path,"{");
  globalThis.__p3eFsLog=[];
  const f=fixture({root:retry.base,listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  const afterFailure=globalThis.__p3eFsLog.length;
  writeFileSync(retry.path,JSON.stringify(manifest));
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.ok(globalThis.__p3eFsLog.length>afterFailure,"failed index build is not cached and retries traversal");
}

for (const method of ["POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]) {
  const f=fixture();
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a",{method}),f,405);
  assert.deepEqual(f.log,[]);
}

{
  const f=fixture({user:null});
  await expect(new Request("https://docs.example.test/api/pending?doc=bad"),f,401);
  assert.deepEqual(f.log,[["identify","GET"]]);
}

for (const query of ["","?doc=","?doc=ABC123","?doc=sample-doc","?doc=4b7d2a&doc=4b7d2a","?doc=4b7d2a&x=1","?doc=4b7d2%2Fa"]) {
  const f=fixture();
  await expect(new Request(`https://docs.example.test/api/pending${query}`),f,400);
  assert.deepEqual(f.log,[["identify","GET"]]);
}

{
  const f=fixture({canRead:false});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,403);
  assert.deepEqual(f.log.map(([name])=>name),["identify","resolveRole","capabilitiesFor"]);
}

for (const accessResult of [
  null,
  {},
  {...resolvedAccess(),extra:true},
  {...resolvedAccess(),shared:"true"},
  {...resolvedAccess(),role:"reader"},
  {...resolvedAccess(),canEdit:true},
  Object.defineProperty({...resolvedAccess()},"canRead",{enumerable:true,get(){return true;}}),
  Object.defineProperty({...resolvedAccess()},"hidden",{value:true}),
  {...resolvedAccess(),[Symbol("invented")]:true},
  Object.assign(Object.create(null),resolvedAccess()),
]) {
  const f=fixture({accessResult});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  assert.equal(f.log.some(([name])=>name==="docState"),false);
}

for (const capabilitiesResult of [
  null,
  {},
  {...capabilityRows.viewer,extra:true},
  {...capabilityRows.viewer,canRead:"true"},
  Object.defineProperty({...capabilityRows.viewer},"hidden",{value:true}),
  {...capabilityRows.viewer,[Symbol("invented")]:true},
  Object.assign(Object.create(null),capabilityRows.viewer),
]) {
  const f=fixture({capabilitiesResult});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  assert.equal(f.log.some(([name])=>name==="docState"),false);
}

{
  const empty=join(root,"empty"); mkdirSync(empty);
  const f=fixture({root:empty});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
  assert.deepEqual(f.log.map(([name])=>name),["identify","resolveRole","capabilitiesFor"]);
}

{
  const unavailable=manifestRoot("unavailable");
  const f=fixture({root:unavailable});
  rmSync(unavailable,{recursive:true});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
  assert.deepEqual(f.log.map(([name])=>name),["identify","resolveRole","capabilitiesFor"]);
}

{
  const other={...manifest,docId:"5c8e3f"};
  const f=fixture({root:manifestRoot("other",other)});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,404);
  assert.deepEqual(f.log.map(([name])=>name),["identify","resolveRole","capabilitiesFor"]);
}

{
  const bad=join(root,"bad-json","sample-doc","dist"); mkdirSync(bad,{recursive:true});
  writeFileSync(join(bad,"sample-doc.edit.json"),"{");
  const f=fixture({root:join(root,"bad-json")});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

for (const [name,badManifest] of [
  ["bad-outer",{...manifest,extra:true}],
  ["bad-doc",{...manifest,docId:"sample-doc"}],
  ["bad-row",{...manifest,blocks:{a11111111:{...manifest.blocks.a11111111,hash:"bad"}}}],
]) {
  const f=fixture({root:manifestRoot(name,badManifest)});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

{
  const duplicate=join(root,"duplicate");
  for (const instance of ["one-doc","two-doc"]) manifestRoot(join("duplicate",instance),{...manifest,instance});
  const f=fixture({root:duplicate});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

{
  const base=join(root,"symlink"); mkdirSync(join(base,"sample-doc","dist"),{recursive:true});
  const target=join(base,"real.json"); writeFileSync(target,JSON.stringify(manifest));
  symlinkSync(target,join(base,"sample-doc","dist","sample-doc.edit.json"));
  const f=fixture({root:base});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

{
  const atDepth=manifestDepthRoot("depth-12",12);
  const f=fixture({root:atDepth.base,listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const beyondDepth=manifestDepthRoot("depth-13",13);
  const f=fixture({root:beyondDepth.base,listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}
for (const [name,ignoredCount,status] of [["entries-4096",4093,200],["entries-4097",4094,503]]) {
  const base=manifestRoot(name);
  for (let index=0; index<ignoredCount; index+=1) writeFileSync(join(base,`ignored-${index}.txt`),"");
  const f=fixture({root:base,listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,status,status===200?"{}":"");
}
{
  const values=[manifest,...Array.from({length:63},(_,index)=>({...manifest,docId:(0x500000+index).toString(16),instance:`candidate-${index}`}))];
  const f=fixture({root:manifestSetRoot("candidates-64",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const values=[manifest,...Array.from({length:64},(_,index)=>({...manifest,docId:(0x510000+index).toString(16),instance:`candidate-over-${index}`}))];
  globalThis.__p3eFsLog=[];
  const f=fixture({root:manifestSetRoot("candidates-65",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
  assert.equal(globalThis.__p3eFsLog.some(([name])=>name==="read"),false,"candidate 65 fails before candidate bytes");
}
const sizedManifest = (size, docId, instance) => {
  const value={...manifest,docId,instance,commit:""};
  const emptyBytes=Buffer.byteLength(JSON.stringify(value));
  assert.ok(size>=emptyBytes);
  value.commit="x".repeat(size-emptyBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(value)),size);
  return value;
};
{
  const f=fixture({root:manifestSetRoot("bytes-one-exact",[sizedManifest(2097152,"4b7d2a","sample-doc")]),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const f=fixture({root:manifestSetRoot("bytes-one-over",[sizedManifest(2097153,"4b7d2a","sample-doc")]),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}
{
  const values=Array.from({length:4},(_,index)=>sizedManifest(2097152,index===0?"4b7d2a":(0x520000+index).toString(16),index===0?"sample-doc":`bytes-${index}`));
  const f=fixture({root:manifestSetRoot("bytes-total-exact",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const values=[
    ...Array.from({length:4},(_,index)=>sizedManifest(2097152,index===0?"4b7d2a":(0x530000+index).toString(16),index===0?"sample-doc":`bytes-over-${index}`)),
    sizedManifest(1_000,"530010","bytes-over-last"),
  ];
  const f=fixture({root:manifestSetRoot("bytes-total-over",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}
{
  const exact={...manifest,blocks:blockRows(5000)};
  const f=fixture({root:manifestRoot("blocks-one-exact",exact),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const over={...manifest,blocks:blockRows(5001)};
  const f=fixture({root:manifestRoot("blocks-one-over",over),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}
{
  const values=[
    {...manifest,instance:"sample-doc",blocks:blockRows(5000,1)},
    {...manifest,docId:"540001",instance:"blocks-two",blocks:blockRows(5000,6000)},
  ];
  const f=fixture({root:manifestSetRoot("blocks-total-exact",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
}
{
  const values=[
    {...manifest,instance:"sample-doc",blocks:blockRows(5000,1)},
    {...manifest,docId:"540002",instance:"blocks-two-over",blocks:blockRows(5000,6000)},
    {...manifest,docId:"540003",instance:"blocks-last",blocks:blockRows(1,12000)},
  ];
  const f=fixture({root:manifestSetRoot("blocks-total-over",values),listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}

for (const listReturn of [null,{}, {[Symbol.asyncIterator]:1}]) {
  const f=fixture({listReturn});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

for (const listPage of [null,{}, {blobs:[],directories:{}}, {blobs:[{key:key1,etag:""}],directories:[]}]) {
  const f=fixture({listPages:[listPage]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

const listedEntry = (index) => {
  const aid = `a${index.toString(16).padStart(8,"0")}`;
  return { key:`edits/4b7d2a/${aid}.json`, etag:`etag-${index}` };
};
const listedPage = (start, count) => ({ blobs:Array.from({length:count},(_,index)=>listedEntry(start+index)), directories:[] });

{
  const f=fixture({listPages:[]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.log.filter(([name])=>name==="read").length,0);
}
{
  const f=fixture({listPages:[listedPage(0,1000)]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.log.filter(([name])=>name==="read").length,1000,"1,000-entry page is admitted");
}
{
  const f=fixture({listPages:[listedPage(0,1001)]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  assert.equal(f.log.filter(([name])=>name==="read").length,0,"overfull provider page fails before reads");
}
{
  const f=fixture({listPages:Array.from({length:8},(_,index)=>listedPage(index,1))});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.log.filter(([name])=>name==="read").length,8,"eight pages are admitted");
}
{
  const f=fixture({listPages:Array.from({length:9},(_,index)=>listedPage(index,1))});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
  assert.equal(f.log.filter(([name])=>name==="read").length,0,"page nine fails before reads");
}
{
  const f=fixture({listPages:Array.from({length:5},(_,index)=>listedPage(index*1000,1000))});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.log.filter(([name])=>name==="read").length,5000,"5,000 entries and reads are admitted");
}
{
  const f=fixture({listPages:[...Array.from({length:5},(_,index)=>listedPage(index*1000,1000)),listedPage(5000,1)]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
  assert.equal(f.log.filter(([name])=>name==="read").length,0,"entry 5,001 fails before reads");
}
{
  const duplicate=listedEntry(7);
  const f=fixture({listPages:[{blobs:[duplicate],directories:[]},{blobs:[duplicate],directories:[]}]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  assert.equal(f.log.filter(([name])=>name==="read").length,0,"cross-page duplicate fails before reads");
}
for (const options of [{listError:new Error("invented list failure")},{listPages:[new Error("invented iterator failure")]}]) {
  const f=fixture(options);
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,503);
}

{
  const f=fixture({listPages:[{blobs:[{key:"edits/4b7d2a/not-an-aid.json",etag:"e"}],directories:[]}]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

{
  const f=fixture({listPages:[{blobs:[{key:key1,etag:"e"}],directories:[]}]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.deepEqual(f.log.filter(([n])=>n==="delete"),[]);
}

for (const readResult of [undefined,{}, {value:null,etag:"unexpected"}, {value:freshReceipt,etag:null}]) {
  const f=fixture({listPages:[{blobs:[{key:key1,etag:"e"}],directories:[] }],readResult});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

for (const invalid of [
  {...freshReceipt,extra:true},
  {...freshReceipt,aid:"a99999999"},
  {...freshReceipt,text:"x".repeat(4001)},
  {...freshReceipt,by:{...receiptActor,email:"UPPER@EXAMPLE.COM"}},
  {...freshReceipt,baseHash:"x"},
  {...freshReceipt,via:"suggestion"},
  {...freshReceipt,via:"suggestion",sugId:`s_${"z".repeat(49)}_4f7a9c31`,acceptedBy:receiptActor,acceptedAt:"2026-09-03T17:08:03.884Z"},
]) {
  const f=fixture({values:[[key1,invalid]]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
}

for (const middle of ["z", "z".repeat(48)]) {
  const suggestion={...freshReceipt,via:"suggestion",sugId:`s_${middle}_4f7a9c31`,
    acceptedBy:{sub:"u_fixture_decider_44",name:"River Vale",email:"river@example.com"},
    acceptedAt:"2026-09-03T17:08:03.884Z"};
  const f=fixture({values:[[key1,suggestion]]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,JSON.stringify({
    a11111111:{text:suggestion.text,by:receiptActor,at:suggestion.at,pr:412,via:"suggestion",
      sugId:suggestion.sugId,acceptedBy:suggestion.acceptedBy,acceptedAt:suggestion.acceptedAt},
  }));
}

{
  const legacy={...freshReceipt}; delete legacy.via;
  const second={...staleReceipt,baseHash:hash2};
  const f=fixture({values:[[key1,legacy],[key2,second]]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,JSON.stringify({
    a22222222:{text:second.text,by:receiptActor,at:second.at,pr:null},
    a11111111:{text:legacy.text,by:receiptActor,at:legacy.at,pr:412},
  }));
  assert.deepEqual(f.log.filter(([n])=>n==="delete"),[]);
}

{
  const absentKey="edits/4b7d2a/a99999999.json";
  const absent={...staleReceipt,aid:"a99999999"};
  const f=fixture({values:[[absentKey,absent]]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.values.size,1);
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,"{}");
  assert.equal(f.values.has(absentKey),true,"stale receipt remains stored after repeated GETs");
}

{
  const stale={...staleReceipt,aid:"a99999999"};
  const staleKey="edits/4b7d2a/a99999999.json";
  const f=fixture({values:[[staleKey,stale],[key1,{...freshReceipt,extra:true}]]});
  await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
  assert.equal(f.values.has(staleKey),true,"corrupt sibling cannot cause a stale-receipt write");
}

{
  const secondFresh={...staleReceipt,baseHash:hash2};
  const decoys=[
    {...manifest,docId:"5c8e3f",instance:"other-one"},
    {...manifest,docId:"6d9f40",instance:"other-two"},
  ];
  const expectedBytes=JSON.stringify({
    a22222222:{text:secondFresh.text,by:receiptActor,at:secondFresh.at,pr:null},
    a11111111:{text:freshReceipt.text,by:receiptActor,at:freshReceipt.at,pr:412,via:"edit"},
  });
  const candidateOrders=new Set();
  const listOrders=new Set();
  for (let seed=1; seed<=12; seed+=1) {
    const candidates=shuffled([manifest,...decoys],seed);
    const listed=shuffled([key1,key2],seed^0x9e3779b9);
    listOrders.add(listed.join(","));
    globalThis.__p3eFsSeed=seed;
    globalThis.__p3eFsOrders=[];
    const f=fixture({
      root:manifestSetRoot(`permuted-${seed}`,candidates),
      values:[[key1,freshReceipt],[key2,secondFresh]],
      listPages:listed.map((key,index)=>({blobs:[{key,etag:`permuted-${index}`}],directories:[]})),
    });
    await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,expectedBytes);
    candidateOrders.add(JSON.stringify(globalThis.__p3eFsOrders));
    await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,200,expectedBytes);
    assert.deepEqual(f.log.filter(([name])=>name==="read").map(([,key])=>key),[key1,key2,key1,key2]);
    for (const name of ["docState","editPrefix","list"]) assert.equal(f.log.filter(([entry])=>entry===name).length,2);
  }
  assert.ok(candidateOrders.size>1,"instrumented production readdir order varied");
  assert.ok(listOrders.size>1,"manual page/list order varied");

  for (const listed of [[key1,key2],[key2,key1]]) {
    const firstInvalid={...freshReceipt,extra:"invented-invalid-field"};
    const laterInvalid={...secondFresh,baseHash:"not-a-hash"};
    const f=fixture({values:[[key1,firstInvalid],[key2,laterInvalid]],listPages:listed.map((key,index)=>({blobs:[{key,etag:`failure-${index}`}],directories:[]}))});
    await expect(new Request("https://docs.example.test/api/pending?doc=4b7d2a"),f,500);
    assert.deepEqual(f.log.filter(([name])=>name==="read").map(([,key])=>key),[key1]);
    assert.deepEqual(f.log.filter(([name])=>name==="upgrade").map(([,aid])=>aid),["a11111111"]);
  }
}

clearTimeout(fixtureDeadline);
console.log("PASS  P3-E pending handler contract");
NODE
BASH
```

Expected: exit `0` and exactly the two declared PASS lines. The matrix executes the production factory and covers method/auth/query order; complete resolved-access/canonical-capability validation before `canRead`; denial; root/nested/empty/unknown/corrupt/duplicate/symlink manifests; exact accepted/rejected depth, entry, candidate, per-file/aggregate-byte, and per-manifest/aggregate-block boundaries; no traversal at factory construction; one instrumented production traversal on first eligible access; immutable reuse after the sidecar is changed and then removed; malformed list iterators/pages; exact 1,000-entry, eight-page, and 5,000-entry/read accepted boundaries plus their first rejected values; synchronous/iterator provider failure; cross-page duplication; read miss; initial/direct/suggestion receipts including suggestion-ID boundaries; field failures; both stale forms; validate-before-projection; seeded actual `readdir` and manual page/list permutations; byte-identical repeated output; sorted calls and first failure; read-only stale omission; headers/body bytes; and no-touch paths. The production filesystem shim exports only read operations and rejects candidate opens without exact `O_RDONLY | O_NOFOLLOW`; every fake store is a `Proxy` that permits only `list` and throws on any other get or any set. The fixture starts no server/browser/detached workload/network/package install. Its workload is one foreground Node process with an explicit 120-second exit-124 deadline. The executed success path validates one exact direct six-character root, uses a bounded direct-child deletion worker, reaps it, and proves root absence. HUP/INT/TERM trap mapping remains defensive operator behavior and is not described as an injected fixture result.

### 3. Owned configuration and function-bundle proof

Run after P1-E and P2-D are integrated. This builds the current root and nested document fixtures, verifies P3-E's one exact configuration amendment, builds the function with the same pinned CLI used by P1-C, inspects the archive, and invokes the bundled factory with the extracted bundle root.

```bash
set -euo pipefail
case "$(uname -s)" in Darwin|Linux) ;; *) printf 'FAIL  P3-E bundle proof requires macOS or Linux\n' >&2; exit 1 ;; esac
P3E_REPO="$(pwd -P)"
P3E_BUNDLE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p3-e-bundle.XXXXXX")"
chmod 700 "$P3E_BUNDLE_ROOT"
export P3E_REPO P3E_BUNDLE_ROOT
umask 077
P3E_PREP_SIGNAL=0
p3e_prepare_signal() {
  if test "$P3E_PREP_SIGNAL" -eq 0; then P3E_PREP_SIGNAL="$1"; fi
  exit "$P3E_PREP_SIGNAL"
}
p3e_prepare_cleanup() {
  local prior="$?"
  local deletion_status=0
  local deletion_pid
  local tick=0
  trap - EXIT
  trap '' HUP INT TERM
  node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");const root=fs.realpathSync(process.argv[1]),temp=fs.realpathSync(os.tmpdir()),s=fs.lstatSync(root);if(p.dirname(root)!==temp||!/^p3-e-bundle\.[A-Za-z0-9]{6}$/.test(p.basename(root))||!s.isDirectory()||s.isSymbolicLink()||(s.mode&511)!==448)process.exit(2);fs.rmSync(root,{recursive:true});' "$P3E_BUNDLE_ROOT" &
  deletion_pid="$!"
  while kill -0 "$deletion_pid" 2>/dev/null && test "$tick" -lt 200; do
    sleep 0.05
    tick=$((tick + 1))
  done
  if kill -0 "$deletion_pid" 2>/dev/null; then
    kill -KILL "$deletion_pid" 2>/dev/null || true
    wait "$deletion_pid" 2>/dev/null || true
    printf 'FAIL  P3-E preparation cleanup timed out; inspect %s\n' "$P3E_BUNDLE_ROOT" >&2
    exit 1
  fi
  wait "$deletion_pid" || deletion_status="$?"
  if test "$deletion_status" -ne 0 || test -e "$P3E_BUNDLE_ROOT"; then
    printf 'FAIL  P3-E preparation cleanup retained %s\n' "$P3E_BUNDLE_ROOT" >&2
    exit 1
  fi
  if test "$P3E_PREP_SIGNAL" -ne 0; then exit "$P3E_PREP_SIGNAL"; fi
  exit "$prior"
}
trap 'p3e_prepare_signal 129' HUP
trap 'p3e_prepare_signal 130' INT
trap 'p3e_prepare_signal 143' TERM
trap p3e_prepare_cleanup EXIT

command cat >"$P3E_BUNDLE_ROOT/launcher.mjs" <<'LAUNCHER'
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.P3E_LAUNCH_MODE;
const root = process.env.P3E_BUNDLE_ROOT;
const repo = process.env.P3E_REPO;
const keepAlive = setInterval(() => {}, 1000);
const run = () => new Promise((resolve) => {
  const child = spawn(process.execPath, [`${root}/worker.mjs`], { cwd: repo, env: process.env, stdio: "inherit" });
  child.once("close", (code, signal) => resolve({ code, signal }));
});
process.once("message", async (message) => {
  if (message?.type !== "go") return;
  if (mode === "delete") {
    try {
      rmSync(root, { recursive: true });
      process.send?.({ type: "result", code: 0, signal: null }, () => process.exit(0));
    } catch (error) {
      process.send?.({ type: "result", code: 1, signal: null, error: String(error) }, () => process.exit(1));
    }
    return;
  }
  const result = await run();
  process.send?.({ type: "result", ...result }, () => process.exit(0));
});
process.send?.({ type: "ready", pid: process.pid });
void keepAlive;
LAUNCHER

command cat >"$P3E_BUNDLE_ROOT/worker.mjs" <<'WORKER'
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.P3E_BUNDLE_ROOT;
const repo = process.env.P3E_REPO;
const must = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: repo, env: process.env, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `${command} terminated by signal`);
  assert.equal(result.status, 0, `${command} exit`);
  return result;
};
must("templates/build", ["example"]);
must("templates/build", ["templates/components"]);
must("npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "acorn@8.15.0"]);

const pendingSource = readFileSync(join(repo, "netlify/functions/pending.mjs"), "utf8");
const { parse } = await import(pathToFileURL(join(root, "node_modules/acorn/dist/acorn.mjs")));
const ast = parse(pendingSource, { ecmaVersion:"latest", sourceType:"module" });
const children = (node) => Object.entries(node).flatMap(([key,value]) => {
  if (["start","end","loc"].includes(key)) return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry.type === "string");
  return value && typeof value.type === "string" ? [value] : [];
});
const nodes=[];
const visit=(node)=>{nodes.push(node);for(const child of children(node))visit(child);};
visit(ast);
const staticName=(node)=>node?.type === "Identifier" ? node.name : node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
const memberPath=(node)=>{
  if (!node) return null;
  if (node.type === "ChainExpression") return memberPath(node.expression);
  if (node.type === "Identifier") return [node.name];
  if (node.type !== "MemberExpression") return null;
  const head=memberPath(node.object);
  const tail=node.computed?staticName(node.property):node.property?.name;
  return head&&tail?[...head,tail]:null;
};
assert.equal(nodes.some((node)=>node.type === "ImportExpression"),false,"no dynamic import");
const imports=ast.body.filter((node)=>node.type === "ImportDeclaration");
assert.deepEqual(imports.map((node)=>node.source.value).sort(),["../lib/access.mjs","../lib/identity.mjs","../lib/store.mjs","node:fs"],"only exact dependency modules");
const relative=imports.filter((node)=>String(node.source.value).startsWith("."));
const expectedImports=new Map([
  ["../lib/identity.mjs",["identify"]],
  ["../lib/access.mjs",["assertIdentitySub","capabilitiesFor","normalizeEmail","resolveRole"]],
  ["../lib/store.mjs",["StoreError","docState","editKey","editPrefix","read","upgrade"]],
]);
assert.deepEqual(relative.map((node)=>node.source.value).sort(),[...expectedImports.keys()].sort(),"exact relative dependency modules");
for (const declaration of relative) {
  const names=declaration.specifiers.map((specifier)=>{
    assert.equal(specifier.type,"ImportSpecifier",`${declaration.source.value}: named imports only`);
    assert.equal(specifier.local.name,specifier.imported.name,`${declaration.source.value}: no import alias`);
    return specifier.imported.name;
  }).sort();
  assert.deepEqual(names,expectedImports.get(declaration.source.value),`${declaration.source.value}: exact imported surface`);
}
const allowedFs=new Set(["closeSync","constants","fstatSync","lstatSync","openSync","readSync","readdirSync"]);
const fsImports=imports.filter((node)=>node.source.value === "node:fs");
assert.equal(fsImports.length,1,"one exact node:fs declaration");
for (const declaration of fsImports) {
  for (const specifier of declaration.specifiers) {
    assert.equal(specifier.type,"ImportSpecifier","node:fs named imports only");
    assert.equal(specifier.local.name,specifier.imported.name,"node:fs imports are not aliased");
    assert.ok(allowedFs.has(specifier.imported.name),`forbidden node:fs import ${specifier.imported.name}`);
  }
}
const calls=nodes.filter((node)=>node.type === "CallExpression" || node.type === "NewExpression");
const callPaths=calls.map((node)=>memberPath(node.callee)).filter(Boolean);
for (const forbidden of ["requireOrigin","getUser","getStore","getDeployStore","mutate","readFileSync","writeFileSync","rmSync","unlinkSync","renameSync","setJSON"]) {
  assert.equal(callPaths.some((path)=>path.at(-1)===forbidden),false,`forbidden call ${forbidden}`);
}
assert.equal(callPaths.some((path)=>path[0] === "console"),false,"no console call");
assert.equal(callPaths.some((path)=>path[0] === "store" && path.at(-1) === "delete"),false,"no store delete call");
assert.equal(callPaths.filter((path)=>path[0] === "store" && path.at(-1) === "list").length,1,"one direct store.list call");
for (const node of nodes.filter((entry)=>entry.type === "MemberExpression")) {
  const path=memberPath(node);
  if (!path) continue;
  if (path[0] === "store") assert.deepEqual(path,["store","list"],`only store.list member access: ${path.join(".")}`);
  if (path[0] === "constants") assert.equal(["O_WRONLY","O_RDWR","O_CREAT","O_TRUNC","O_APPEND"].includes(path.at(-1)),false,`forbidden filesystem flag ${path.join(".")}`);
}
console.log("PASS  P3-E AST read-only import/call boundary");

const source = readFileSync(join(repo, "netlify.toml"), "utf8");
assert.equal((source.match(/^\[functions\.pending\]$/gm) ?? []).length, 1);
assert.match(source, /(?:^|\n)\[functions\.pending\]\n  included_files = \["\*\*\/dist\/\*\.edit\.json"\](?=\n(?:[ \t]*\n)*(?:\[|$))/);
console.log("PASS  P3-E exact pending bundle declaration");

const functions = join(root, "functions");
const unpacked = join(root, "unpacked");
mkdirSync(functions);
mkdirSync(unpacked);
must("npx", ["--yes", "netlify-cli@24.2.0", "functions:build", "--src", "netlify/functions", "--functions", functions], {
  env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
});
const archive = join(functions, "pending.zip");
const listing = spawnSync("unzip", ["-Z1", archive], { cwd: repo, encoding: "utf8" });
if (listing.error) throw listing.error;
assert.equal(listing.signal, null);
assert.equal(listing.status, 0);
writeFileSync(join(root, "entries"), listing.stdout, { mode: 0o600 });
const entries = listing.stdout.split("\n").filter(Boolean);
for (const expected of ["example/dist/example.edit.json", "templates/components/dist/components.edit.json"]) {
  assert.equal(entries.filter((entry) => entry === expected).length, 1, `${expected} must appear exactly once`);
  console.log(expected);
}
must("unzip", ["-q", archive, "-d", unpacked]);
for (const expected of ["example/dist/example.edit.json", "templates/components/dist/components.edit.json", "pending.mjs"]) {
  readFileSync(join(unpacked, expected));
}

const manifest = JSON.parse(readFileSync(join(unpacked, "example/dist/example.edit.json"), "utf8"));
const bundled = await import(pathToFileURL(join(unpacked, "pending.mjs")));
const store = { list(options) {
  assert.deepEqual(options,{prefix:`edits/${manifest.docId}/`,paginate:true});
  return { async *[Symbol.asyncIterator]() { yield { blobs:[], directories:[] }; } };
} };
const viewer = { canRead:true, canComment:false, threadControl:"none", canSuggest:false, canEdit:false, canAccept:false, canShare:false, canSeeMembers:false };
const handler = bundled.createPendingHandler({
  async identify() { return { sub: "u_bundle_reader_21", email: "reader@example.com", name: "Reader Vale", isOrg: true }; },
  async resolveRole() { return { role:"viewer", shared:true, ...viewer }; },
  capabilitiesFor() { return {...viewer}; },
  assertIdentitySub(value) { return value; },
  normalizeEmail(value) { return value; },
  docState() { return store; },
  editPrefix(docId) { return `edits/${docId}/`; },
  editKey(docId, aid) { return `edits/${docId}/${aid}.json`; },
  async read() { throw new Error("empty list must not read"); },
  upgrade() { throw new Error("empty list must not upgrade"); },
  manifestRoot: unpacked,
});
const response = await handler(new Request(`https://docs.example.test/api/pending?doc=${manifest.docId}`));
assert.equal(response.status, 200);
assert.equal(await response.text(), "{}");
console.log("PASS  P3-E bundled root and nested sidecars");
WORKER

command cat >"$P3E_BUNDLE_ROOT/supervisor.mjs" <<'SUPERVISOR'
import { closeSync, chmodSync, constants, fsyncSync, lstatSync, openSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { fork, spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = realpathSync(process.env.P3E_BUNDLE_ROOT);
const repo = realpathSync(process.env.P3E_REPO);
const temp = realpathSync(tmpdir());
const evidence = join(root, "owner.json");
const info = lstatSync(root);
if (dirname(root) !== temp || !/^p3-e-bundle\.[A-Za-z0-9]{6}$/.test(basename(root)) || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) throw new Error(`unsafe bundle root: ${root}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let signalStatus = 0;
let wakeSignal;
const signalPromise = new Promise((resolve) => { wakeSignal = resolve; });
for (const [name, status] of [["SIGHUP",129],["SIGINT",130],["SIGTERM",143]]) process.on(name, () => {
  if (signalStatus === 0) {
    signalStatus = status;
    wakeSignal({ kind:"signal" });
  }
});
function atomicEvidence(phase, leader) {
  const next = `${evidence}.new`;
  const payload = `${JSON.stringify({ root, supervisorPid:process.pid, leaderPgid:leader, phase, remediation:leader ? `/bin/ps -o pid=,pgid= -p ${leader}; verify PID equals PGID before any kill -- -${leader}` : "inspect root; no group signal is authorized" }, null, 2)}\n`;
  const fd = openSync(next, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    chmodSync(next, 0o600);
  } finally { closeSync(fd); }
  renameSync(next, evidence);
  const dirfd = openSync(root, constants.O_RDONLY);
  try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
}
function retained(child) {
  let closed = false;
  child.on("error", () => {});
  const close = new Promise((resolve) => child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); }));
  return { child, close, isClosed: () => closed };
}
function message(owner, type) {
  return new Promise((resolve) => {
    const onMessage = (value) => { if (value?.type === type) { cleanup(); resolve(value); } };
    const onClose = (code, signal) => { cleanup(); resolve({ type:"closed", code, signal }); };
    const cleanup = () => { owner.child.off("message", onMessage); owner.child.off("close", onClose); };
    owner.child.on("message", onMessage);
    owner.child.on("close", onClose);
  });
}
function currentLeader(owner) {
  if (owner.isClosed() || owner.child.exitCode !== null || owner.child.signalCode !== null) return false;
  const result = spawnSync("/bin/ps", ["-o","pid=,pgid=","-p",String(owner.child.pid)], { encoding:"utf8" });
  if (result.status !== 0) return false;
  const match = result.stdout.trim().match(/^(\d+)\s+(\d+)$/);
  return Boolean(match && Number(match[1]) === owner.child.pid && Number(match[2]) === owner.child.pid);
}
function groupMembers(pgid) {
  const result = spawnSync("/bin/ps", ["-axo","pid=,pgid="], { encoding:"utf8" });
  if (result.status !== 0) throw new Error("cannot inspect process groups");
  return result.stdout.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)$/)).filter(Boolean).filter((match) => Number(match[2]) === pgid);
}
async function waitGroupGone(pgid) {
  try {
    for (let tick = 0; tick < 50; tick += 1) {
      if (groupMembers(pgid).length === 0) return true;
      await delay(100);
    }
  } catch {}
  return false;
}
async function stop(owner, anchored) {
  try {
    if (!owner.isClosed()) {
      if (!anchored) owner.child.kill("SIGTERM");
      else {
        if (!currentLeader(owner)) return false;
        try { process.kill(-owner.child.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
      }
      await Promise.race([owner.close, delay(5000)]);
    }
    if (!owner.isClosed()) {
      if (anchored) {
        if (!currentLeader(owner)) return false;
        try { process.kill(-owner.child.pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
      } else owner.child.kill("SIGKILL");
      await Promise.race([owner.close, delay(5000)]);
    }
    if (!owner.isClosed()) return false;
    return anchored ? waitGroupGone(owner.child.pid) : true;
  } catch { return false; }
}
const mapResult = (value) => value.signal ? ({SIGHUP:129,SIGINT:130,SIGTERM:143,SIGKILL:137}[value.signal] ?? 1) : (Number.isInteger(value.code) ? value.code : 1);
async function deleteRoot() {
  const child = fork(join(root, "launcher.mjs"), [], { cwd:repo, detached:true, stdio:["ignore","ignore","inherit","ipc"], env:{...process.env,P3E_LAUNCH_MODE:"delete"} });
  const owner = retained(child);
  let anchored = false;
  try {
    const ready = await Promise.race([message(owner,"ready"), delay(5000).then(() => ({type:"timeout"}))]);
    if (ready.type !== "ready" || ready.pid !== child.pid || !currentLeader(owner)) {
      await stop(owner, false);
      return false;
    }
    anchored = true;
    atomicEvidence("deleting", child.pid);
    const resultPromise = message(owner, "result");
    child.send({type:"go"});
    const result = await Promise.race([resultPromise, delay(30000).then(() => ({type:"timeout"}))]);
    if (result.type === "timeout") {
      await stop(owner, true);
      return false;
    }
    await Promise.race([owner.close, delay(5000)]);
    if (!owner.isClosed() || !(await waitGroupGone(child.pid)) || mapResult(result) !== 0) return false;
    try { lstatSync(root); return false; } catch (error) { return error?.code === "ENOENT"; }
  } catch {
    await stop(owner, anchored);
    return false;
  }
}
let status = 1;
let retainReason = "";
const child = fork(join(root, "launcher.mjs"), [], { cwd:repo, detached:true, stdio:["ignore","inherit","inherit","ipc"], env:{...process.env,P3E_LAUNCH_MODE:"bundle"} });
const owner = retained(child);
let anchored = false;
try {
  const ready = await Promise.race([message(owner,"ready"), signalPromise, delay(5000).then(() => ({kind:"ready-timeout"}))]);
  if (ready?.kind === "signal") status = signalStatus;
  else if (ready?.type !== "ready" || ready.pid !== child.pid || !currentLeader(owner)) retainReason = "launcher did not publish an authenticated PID=PGID anchor";
  else {
    anchored = true;
    atomicEvidence("ready", child.pid);
    const resultPromise = message(owner, "result");
    atomicEvidence("running", child.pid);
    child.send({type:"go"});
    const result = await Promise.race([resultPromise, signalPromise, delay(900000).then(() => ({kind:"deadline"}))]);
    if (result?.kind === "signal") status = signalStatus;
    else if (result?.kind === "deadline") status = 124;
    else status = mapResult(result);
  }
} catch (error) {
  retainReason = `supervisor failure: ${String(error)}`;
}
if (!retainReason && signalStatus === 0 && status === 0 && !owner.isClosed()) await Promise.race([owner.close, delay(5000)]);
if (!(await stop(owner, anchored))) retainReason ||= "owned bundle group did not disappear after leader close";
if (retainReason) {
  console.error(`FAIL  P3-E retained ${root}: ${retainReason}; inspect ${evidence}`);
  process.exit(signalStatus || status || 1);
}
try { atomicEvidence("group-gone", 0); } catch (error) {
  console.error(`FAIL  P3-E retained ${root}: evidence update failed: ${String(error)}`);
  process.exit(signalStatus || status || 1);
}
if (!(await deleteRoot())) {
  console.error(`FAIL  P3-E deletion failed or timed out; inspect ${root}`);
  process.exit(signalStatus || status || 1);
}
const finalStatus = signalStatus || status;
if (finalStatus === 0) console.log("PASS  P3-E bundle proof cleaned");
process.exit(finalStatus);
SUPERVISOR

chmod 600 "$P3E_BUNDLE_ROOT/launcher.mjs" "$P3E_BUNDLE_ROOT/worker.mjs" "$P3E_BUNDLE_ROOT/supervisor.mjs"
exec node "$P3E_BUNDLE_ROOT/supervisor.mjs"
```

Expected: both `templates/build` commands pass. The pinned Acorn walk first prints `PASS  P3-E AST read-only import/call boundary` after proving the complete dependency set is exactly the three relative modules with exact unaliased names plus one unaliased read-only `node:fs` import, one direct `store.list` call and no other static store member, no write flag, dynamic import, or forbidden identity/store/write/log call. The archive assertion then requires each exact root/nested sidecar path to occur exactly once and prints each path once. The command exits `0` only after that AST line, `PASS  P3-E exact pending bundle declaration`, both paths, `PASS  P3-E bundled root and nested sidecars`, and `PASS  P3-E bundle proof cleaned` occur in order. The bundled handler discovers the extracted repository-root layout by permanent `docId`; it receives no source-tree fallback, instance, slug, or client path.

The networked pinned-package/CLI invocations, both builds, AST walk, archive inspection/extraction, and bundled-handler call all run inside one retained launcher process group after the direct child publishes `ready`, a fresh `/bin/ps` query proves PID=PGID, and mode-`0600` durable evidence is fsynced before `go`. The executed success gate has a 900-second deadline, observes launcher close/IPC and group disappearance, then exercises the separately authenticated bounded deletion and proves root absence. The supervisor also defines first-signal HUP/INT/TERM mapping and revalidated TERM→KILL failure handling, but this success gate does not claim those branches were dynamically injected. After leader close/IPC and the subsequent five-second group-disappearance proof, that group number is never signalled again. Recursive deletion has its own five-second authenticated-ready bound, 30-second operation bound, five-second close bound, and five-second group-disappearance bound. A group/evidence/deletion failure retains the exact mode-`0700` root and actionable evidence instead of signalling a stale group or deleting an unresolved target.

### 4. Repository gates and ownership

```bash
set -euo pipefail
scripts/scrub-check.sh docs/tickets/P3-E.md netlify/functions/pending.mjs netlify.toml
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check -- netlify/functions/pending.mjs netlify.toml docs/tickets/P3-E.md

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const body = readFileSync("docs/tickets/P3-E.md", "utf8");
assert.deepEqual(body.match(/^## .+$/gm), [
  "## Outcome", "## Context", "## Scope", "## Interface contract",
  "## Files owned", "## Dependencies", "## Acceptance criteria", "## Test plan",
  "## Failure modes", "## Settled decisions", "## Assumptions and open questions", "## References",
]);
assert.equal((body.match(/^```/gm) ?? []).length % 2, 0);
console.log("PASS  P3-E ticket structure");
NODE
awk '/^```bash$/{inside=1; next} /^```$/{inside=0} inside{print}' docs/tickets/P3-E.md | bash -n

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const paths = new Set();
for (const args of [["diff","--name-only"],["diff","--name-only","--cached"],["ls-files","--others","--exclude-standard"]])
  for (const p of execFileSync("git", args, {encoding:"utf8"}).trim().split("\n")) if (p) paths.add(p);
for (const p of paths) {
  if (p.startsWith("docs/tickets/")) continue;
  assert.ok(["netlify/functions/pending.mjs", "netlify.toml"].includes(p), `unexpected implementation path: ${p}`);
}
assert.ok(paths.has("netlify/functions/pending.mjs"));
assert.ok(paths.has("netlify.toml"));
console.log("PASS  P3-E implementation ownership");
NODE

issue_json="$(gh issue view 18 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-E.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-E — GET /api/pending" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-E issue #18 pointer integrity'
```

Expected: scrub has zero warnings; TypeScript exits `0`; `check-dist` ends `PASS  every committed document is byte-identical after a rebuild`; ticket headings/fences and extracted Bash parse; diff check is silent; the ownership oracle prints `PASS  P3-E implementation ownership`. Issue #18 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the final line is `PASS  P3-E issue #18 pointer integrity`. Coordination ticket docs may coexist; no other implementation path may.

## Failure modes

### Handled

- Non-GET: `405` before identity/query/files/state. Missing session: `401` before document input. Invalid query: `400` before access/files/state. Denied access: `403` before manifest/state.
- Incomplete, extra, accessor-backed, custom-prototype, wrong-type, or role-inconsistent resolved access/canonical capabilities: `500` before `canRead`, manifest, or state.
- Authorized unknown doc: `404` without path/slug. Missing inventory, any exact discovery/list capacity excess, or provider availability failure: `503`. Corrupt/duplicate/symlinked manifest: `500`; no partial authority.
- Malformed list iterator/page/key/ETag, a provider page above 1,000, duplicate aid, invalid/unsupported receipt, or key/body mismatch: `500`, retain questionable record, no partial overlay. A ninth valid page or 5,001st valid entry is bounded-unavailable `503` before reads.
- Listed key absent before read: skip. Post-list creation: next refresh.
- Missing manifest aid or unequal base hash: omit without mutation. Commit, timestamp, and text are irrelevant.
- Concurrent readers and receipt replacement: GET cannot delete either observed or replacement state; the next refresh reclassifies the then-current record.
- Random list/filesystem order: raw-sort reads and use manifest projection order.
- Every error: empty no-store response; no private state or provider diagnostics escape.
- Foreground-fixture timeout executes the shell's bounded positive-PID cleanup and either proves absence or prints retained remediation; HUP/INT/TERM handling is defined defensively but is not claimed as a dynamically injected test result.
- Bundle build/install/inspection signal or 900-second timeout: stop only the freshly revalidated retained group, await leader/IPC closure and group disappearance, then perform separately authenticated bounded deletion or retain the exact root/evidence.

### Deliberately not handled

- Reconstructing a manifest from HTML, `doc.json`, source, slug, instance, or request path.
- Read-your-write completeness from `list()`.
- Merging two applied edits into one receipt. P4-B/P4-N conditionally replace the one aid slot.
- Repairing/migrating/returning/deleting an invalid receipt.
- Stale-state garbage collection, cleanup event, notification, or realtime fan-out.
- Authority from `isOrg`, compatibility roles, edge gate, client capability, or receipt actor.
- Mode-specific expiry. Rebuild and standalone promotion both expire by manifest hash.
- A source-only release that skips P3-E's owned bundle proof.

## Settled decisions

- One site-wide `doc-state`; one blob per applied edit. No document array, second store, DB, or deploy store.
- Permanent six-lowercase-hex doc ID is API/storage identity; slug/alias/instance/route/path are not inputs.
- `data-aid` is sole block/edit identity. No `data-eid` or ordinal.
- Exact P2-D inner-HTML SHA-256 is expiry authority; manifest commit and clock are not.
- Absent aid and unequal hash are stale; both are omitted without any read-side mutation.
- Overlay is a receipt, not source of record. Key existence, not a status field, carries state.
- The complete validated default `resolveRole()` result after P2-H identity is the only read authority. It must match P2-G's canonical `capabilitiesFor(role)` row before exact boolean `canRead` is consulted; truthy or partial `canRead` is never sufficient.
- Responses are deterministic projections, never raw storage/manifest/access objects.
- Manifest discovery admits at most depth 12, 4,096 entries, 64 candidates, 2 MiB per candidate, 8 MiB total candidate bytes, 5,000 blocks per manifest, and 10,000 blocks total. The successful immutable index is lazy and handler-local; capacity excess is `503` and caches nothing.
- Netlify Blobs enumeration uses only the documented manual async iterator with `paginate:true`, at most eight pages, at most the documented 1,000 entries per page, and at most 5,000 entries/strong reads in total.
- No polling loop. Clients use their owned refresh/realtime contracts.
- P3-E owns one Function file plus one exact sequential `netlify.toml` block; it cannot amend other configuration or consumers.

## Assumptions and open questions

### Assumptions

- P1-C's fail-closed method pattern supplies `405`/`Allow`, while invalid authenticated query is `400`; all error bodies are empty.
- P2-G/P2-H correct the older dependency row because `/api/*` bypasses the HTML gate.
- P3-E accepts P4-N receipt extensions now because P4-N does not own `pending.mjs`.
- Receipt actors reuse P2-G snapshot scalar rules rather than a second subject/email grammar.
- Research sets only a 4,000 maximum, so empty stored text is accepted here; P4-B owns write/converter admission.
- The pinned Netlify Blobs API retains the documented `store.list({paginate:true})` async-iterator contract and at-most-1,000-entry server pages. A breaking SDK change fails closed through the iterable/page validators.
- P4-B/P4-N adopt P2-B `mutate()` for conditional one-slot replacement; direct `onlyIfNew` is insufficient once a prior receipt occupies the slot.
- Stale receipt retention is bounded by the existing one-key-per-aid storage model; this GET does not add a background cleanup responsibility.

### Open questions and gaps

- **Unverified list consistency:** one list may omit a new receipt. The write response, not relist, acknowledges it; later refresh reconciles.

No ownership or implementation decision is open. P3-E owns and proves exact bundle inclusion; P4-B/P4-N own the already-specified conditional writer amendments. Choosing a deploy store/generated registry instead of `included_files` is a cross-ticket architecture amendment to P1-E/P2-D/P3-E, not a P3-E implementation detail.

## References

- `docs/research/00-integration-plan.md` §§1.1–1.5, 2.5–2.6, 3.4, 4.5, 4.7, ruling 23 — store/key, permanent identity, access, receipt, manifest, hash expiry, ownership, later consumers.
- `docs/research/05-inline-editing.md` §§3, 7–8, 10–12 — pending overlay, stale-state handling, initial projection, dynamic manifest files, degradation. Its language/store/identity/`eid`/ordinal/slug-path prototype is superseded.
- `docs/research/08-suggestions-and-editing-model.md` §§4–6, 7.5, 13, 15–17 — receipt lifecycle/extensions, effective base, Mode A, consumers, manifest uncertainty. Its authority proposal/ticket letters are superseded.
- `docs/tickets/P2-B.md` — exact store/read/version/error/edit-key contracts, list caveat, and conditional `mutate()` algorithm.
- `docs/tickets/P2-D.md` — exact deterministic versionless manifest, nested path, ordered blocks, row/hash schema, downstream stability.
- `docs/tickets/P2-G.md` — sole role authority, exact resolved-access and `capabilitiesFor()` shapes, default resolution, actor helpers, error/status/privacy, and `canRead`.
- `docs/tickets/P2-H.md` — final person identity and prohibition on identity-only document authority.
- `docs/tickets/P3-B.md` — exact suggestion-ID grammar reused by the accepted P4-N receipt extension.
- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/) and [file-based configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/) — ESM/routing and `included_files`; checked 2026-09-03.
- [Netlify Blobs pagination](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#pagination) — official manual `store.list({ paginate: true })` async iteration and server pages of up to 1,000 entries; checked 2026-09-03.
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — key/ETag list entries, strong reads, unconditional deletion, key limits, and site-wide persistence; checked 2026-09-03.
- GitHub issue #18 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
