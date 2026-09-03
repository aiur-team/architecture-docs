# P4-N — The one apply path

## Outcome

Direct edits and accepted suggestions call one server-only apply operation that uses one effective-base definition, preserves P4-M authorization in the HTTP handler, selects the same manifest for apply and pending reads in both modes, writes Git before receipt only in repository mode, writes receipt only in standalone mode, makes suggestion retries commit/receipt-idempotent, and schedules one post-receipt edit fan-out without putting context in the library.

## Context

P4-B creates the initial Mode B `/api/edit` algorithm in one handler. P4-M then replaces its temporary organization gate with P2-G capability enforcement. This ticket lands third on that shared file: it extracts all manifest, source, GitHub, conflict, pull-request, and receipt work into `netlify/lib/gitedit.mjs`, adds Mode A's private-manifest branch from P4-S, and exposes the exact seams P4-O needs. It does not move role authority into the library.

## Scope

### In scope

- Create the sole `applyText()` implementation and an injected service seam in `netlify/lib/gitedit.mjs`.
- Move P4-B's Mode B manifest/source/branch/commit/PR/receipt algorithm into that service without weakening its bounds.
- Define and export one effective-base read used by direct edits, suggestion create/list, and acceptance.
- Define and export the one Mode A/Mode B manifest selector, and amend P3-E's pending reader to delegate only that selection.
- Read the private P4-S `mode/<docId>/manifest.json` only for an explicitly configured Mode A site.
- Extend `/api/edit` with an optional current effective-base hash while retaining the P4-B legacy no-hash request behavior.
- Add exact P3-E receipt variants and Mode A overlay-only apply.
- Add `X-Suggestion-Id` commit-trailer and exact receipt replay checks for accepted suggestions.
- Append `edit.propose`/`edit.apply` only for successful direct edits.
- Call the sole P4-D/P4-H `notify()` helper once after a direct apply/receipt returns.
- Add permanent `scripts/test-p4-n.mjs` local and opt-in hosted regression coverage for the one-apply boundary.

### Out of scope

- Role resolution inside `gitedit.mjs`, suggestion CRUD/decision, UI, promotion, merge, auto-rebase, multi-block apply, outbox, or remote rollback.
- A second manifest/path/hash source, a request-selected mode/path/repository/ref/author, authority in `doc.json`, or deriving the Mode A manifest from public HTML.
- Changing P3-E's pending authorization/list/receipt/projection/response contract, P4-S's uploader, P2-D's sidecar, a package/config file, or any client asset.
- Calling `notify()` from `gitedit.mjs`, importing a provider there, or teaching the handler Slack/Ably behavior.
- Making P4-B's non-idempotent direct edit idempotent after a Git commit/receipt crash; only a suggestion has a stable operation ID.

## Interface contract

### Module surface and service seam

`netlify/lib/gitedit.mjs` is ESM with exactly these runtime exports and no default:

```js
export class ApplyError extends Error {}
export function assertApplyManifest(value, expectedDocId) { /* contract below */ }
export function assertApplyReceipt(value, expectedAid) { /* contract below */ }
export function createGitEditService(dependencies = {}) { /* contract below */ }
export async function readApplyManifest(docId) { /* contract below */ }
export async function readApplyReceipt(docId, aid) { /* contract below */ }
export async function readEffectiveBase(docId, aid) { /* contract below */ }
export async function applyText(input) { /* contract below */ }
```

`createGitEditService()` validates one closed ordinary dependency object. Optional own data-function members are `storeFn`, `readFn`, `mutateFn`, `fetchFn`, `appendEventFn`, `nowFn`, `sha256Fn`, `closeSyncFn`, `fstatSyncFn`, `lstatSyncFn`, `openSyncFn`, `readSyncFn`, `readdirSyncFn`, `scanBlocksFn`, `toMdFn`, and `toHtmlFn`; optional scalar members are `manifestRoot` and `env`. `manifestRoot` is an absolute path whose traversal applies the inherited regular-directory/non-symlink checks at use time. `env` is a freshly copied ordinary object with no symbols/accessors/custom prototype, only an optional subset of own keys `DOCS_REPO`, `DOCS_BASE_BRANCH`, `DOCS_GITHUB_TOKEN`, and `DOCS_BOT_EMAIL`, and string values. Omitted values use the canonical imports, named synchronous Node filesystem built-ins/constants, `Date.now`, `process.cwd()`, and a one-time narrow snapshot of only those four configuration names; never enumerate `process.env`. Unknown dependency keys, symbols, accessors, arrays, null, custom prototypes, wrong types, or explicit undefined throw `TypeError("Invalid git edit dependencies")` synchronously. The returned frozen exact object has `{ readApplyManifest, readApplyReceipt, readEffectiveBase, applyText }`; each is a named async function. Module-level exports delegate to one production service created once. Request data never selects dependencies.

Production imports P2-B `docState`, `read`, `mutate`, `editKey`, `upgrade`, `assertDocId`, and `StoreError`; P3-B `appendEvent`; compiled P1-D/P2-D `scanBlocks`, `toMd`, and `toHtml`; named `node:fs`, `node:path`, and `node:crypto` operations. It imports no Netlify SDK, identity/access module, HTTP handler, client asset, `doc.json`, or dynamic module. It emits no log.

`assertApplyReceipt(value, expectedAid)` applies `upgrade()`, then validates and freshly clones exactly P3-E's initial seven-field direct receipt, eight-field `via: "edit"` receipt, or eleven-field `via: "suggestion"` receipt, including exact field order, actors, timestamps, hash, positive/null PR, and suggestion/acceptance relations. `expectedAid` is mandatory and must equal the validated receipt aid. This is the sole exported server receipt validator for P4-N/P4-O; P3-E's receipt read/validation/projection remains unchanged and its private validator must stay behaviorally identical.

### Explicit server mode and manifest

Capture exactly `DOCS_REPO`, `DOCS_BASE_BRANCH`, `DOCS_GITHUB_TOKEN`, and `DOCS_BOT_EMAIL`; do not enumerate or log the environment. Mode is configuration-selected, never request-selected:

- **Mode B / `repository`:** `DOCS_REPO` is present. Apply all P4-B repository/base/token/bot validation. `URL`/`DEPLOY_URL` are irrelevant. Read the immutable deployed P2-D manifest inventory from `manifestRoot` with P3-E/P4-B's bounded traversal/cache rules.
- **Mode A / `standalone`:** all four `DOCS_*` repository variables are absent. Strong-read exact key `mode/<docId>/manifest.json` from `docState()` and validate it with `assertApplyManifest()`. This is the exact P2-D sidecar uploaded and read back by P4-S. Retain `file` as provenance but never resolve/read/write that path in this branch.
- Any partial repository configuration, including token/base/bot without repository, is `500 invalid-state`. A missing Mode A manifest is 404; unavailable read is 503; corrupt manifest is 500. Do not fall from a configured repository into Mode A or vice versa.

`assertApplyManifest(value, expectedDocId)` validates/clones P2-D's exact ordered `{ docId, instance, commit, blocks }`, at most 5,000 rows, exact aid and row `{file,section,tag,hash}` order/grammar, no authority fields, and matching document ID. For apply/audit use, require `commit` to match `^[0-9a-f]{7,64}$`. It has no I/O or authority side effect.

`readApplyManifest(docId)` validates the ID, selects configuration exactly once, and returns a fresh frozen exact `{ mode, manifest }`, where `mode` is `"repository"` or `"standalone"` and `manifest` is the freshly validated canonical object. Repository mode uses the complete lazy bounded immutable sidecar index inherited from P3-E/P4-B and caches only a fully valid inventory; a valid inventory without the document is 404. Standalone mode calls `docState()` once and then exact `store.get("mode/<docId>/manifest.json", { type: "json", consistency: "strong" })` once. After generic `assertApplyManifest()` validation it additionally enforces P4-S's full Mode A publication subset: `commit` is exactly seven lowercase hexadecimal characters, `blocks` has at most 1,000 rows, and every remaining P4-S manifest predicate is preserved rather than widened to P2-D's generic limits. The service therefore rejects 8-character Mode A commits and 1,001-row Mode A manifests even though the generic validator admits them; the permanent fixture pins 7/8 and 1,000/1,001 boundaries. It deliberately does not call P2-B `read()`/`upgrade()` for this immutable sidecar because that helper requires the mutable-record `{v:1}` envelope while P2-D's exact manifest has no `v`. `null` is 404; a `SyntaxError`, non-ordinary/corrupt value, or manifest-validation failure is 500; every other provider throw is 503. Partial configuration, capacity, and unavailable errors retain the exact mapping above. No caller supplies a mode, store key, manifest, path, or fallback, and no direct SDK import or alternate store is permitted.

### Effective base and receipt read

`readApplyReceipt(docId, aid)` validates identifiers, opens `docState()` once, strongly calls P2-B `read(store, editKey(docId, aid), null)`, and returns either `null` or a fresh complete P3-E receipt after exact key/record validation. Corrupt data is `500 invalid-state`; unavailable store is 503. It does not read a manifest or delete stale state.

`readEffectiveBase(docId, aid)` calls the same service's `readApplyManifest(docId)`, selects one row, and performs one strong receipt read. Unknown aid is 404. A receipt is current only when its exact `baseHash === row.hash`; an absent/stale receipt does not become authority. Return a fresh exact object in this order:

```json
{
  "mode": "standalone",
  "docId": "4b7d2a",
  "aid": "a3f19c2b7",
  "section": "architecture",
  "tag": "p",
  "docVersion": "7aaca51",
  "manifestHash": "1111111111111111111111111111111111111111111111111111111111111111",
  "hash": "2222222222222222222222222222222222222222222222222222222222222222",
  "text": "Current **overlay** text.",
  "pending": true
}
```

`hash` is `sha256(toHtml(receipt.text) UTF-8)`, `text` is `receipt.text`, and `pending` is true for a current receipt. Otherwise `hash === manifestHash`, `text === null`, and `pending === false`; the canonical manifest deliberately contains no source text. This definition performs no GitHub/source read and makes list/create costs bounded. A caller may prove a client-supplied base text by exact `sha256(toHtml(baseText)) === hash`; it must never trust unbound text. The receipt's stored `baseHash` always remains the underlying manifest row hash so P3-E expiry continues to work.

### Exact apply input and errors

`applyText(input)` requires one ordinary exact object in this key set:

```js
{
  docId, aid, text, author, acceptedBy, sugId, via, expectBase
}
```

Canonical IDs apply. `text` is 0–4,000 UTF-16 code units, contains no lone surrogate, and passes both P4-B converter equalities. `author` and non-null `acceptedBy` are the exact P2-G/P3-B actor snapshot aligned by P3-B to P2-G: canonical `sub`, `name` at most 200 UTF-16 code units under the actor-name override, and canonical email. `expectBase` is 64 lowercase hex. For `via: "edit"`, `acceptedBy === null` and `sugId === null`. For `via: "suggestion"`, `acceptedBy` is an exact actor, `sugId` matches P3-B's suggestion ID, and `author.sub !== "system"`. Unknown keys/accessors/symbols/types fail `ApplyError(400, "invalid-body", "Invalid request body")` before state/provider work.

In repository mode, require `author.email` to be a nonempty canonical P2-G email before branch or provider work. A valid degraded actor with `email: ""` fails safe `500 invalid-state`; never substitute `DOCS_BOT_EMAIL`, the accepter's address, a request value, or a fabricated address for the text author. For the GitHub commit author object only, set exact `name: author.name === "" ? author.email : author.name` and exact `email: author.email`; GitHub requires a usable name, and this deterministic repository-only fallback remains the author's own address. Preserve the original actor, including an empty name, byte-for-byte in receipts and events. Standalone mode permits the canonical empty actor email/name because it constructs no Git commit and P3-E receipts explicitly admit both; it performs no author projection.

Select the authoritative manifest and strongly read a current receipt first. For a suggestion only, an exact receipt with `via: "suggestion"`, the same `sugId`, `aid`, `text`, `by`, `baseHash === the current manifest row hash`, canonical timestamps, and a fully valid stored `acceptedBy` is completed replay: return its stable `{ receipt, pr }` before comparing effective base or touching Git. The replay preserves the first stored accepter even when another currently authorized decider resumes the same operation; it never rewrites acceptance attribution. Any same-`sugId` mismatch in operation identity/text/author/base is 409 conflict. Otherwise compute the same effective-base result and require `expectBase === effective.hash`; mismatch throws exact 409 with `currentHash: effective.hash` and `current: effective.text` (string or null). Require `sha256(toHtml(text)) !== expectBase`; a no-op is 400 invalid-body.

`ApplyError` has own read-only `status`, `code`, `message`, `currentHash` (undefined or 64 lowercase hex), and `current` (undefined, string, or null) fields and no provider/body/cause serialization. A base/source conflict includes both current fields; other errors leave both undefined. Status mapping is P4-B's existing table: input 400, not found 404, conflict 409, invalid state 500, repository 502, state unavailable 503.

### Mode A apply and receipts

Mode A makes no GitHub/network/ref/PR call. Capture the pre-apply receipt snapshot used to compute the accepted effective base (`null`, stale, or current). After the base/round-trip/no-op checks, sample one timestamp and write the exact P3-E receipt through `mutate(store, editKey(docId, aid), nextReceipt, callback)`:

- direct: exact `{ v, aid, text, by, at, baseHash: manifestHash, pr: null, via: "edit" }`;
- suggestion: exact same seven core fields plus `{ via: "suggestion", sugId, acceptedBy, acceptedAt: at }` in P3-E's declared order.

Inside the pure callback validate any current receipt. The non-null `nextReceipt` initial means a missing-key callback receives a clone of the intended value; when the captured snapshot was null, return a fresh `nextReceipt` for that default, return it again if a concurrent exact same suggestion operation won, and conflict on any other newly observed receipt. When the captured snapshot was non-null, return null for an exact intended receipt, return a fresh `nextReceipt` only while the draft deeply equals the captured snapshot, and conflict on every other value. This admits a sequential direct edit or suggestion against the explicit visible overlay, replaces an unchanged stale receipt, and makes a CAS loser re-evaluate against the winner rather than blindly overwriting it. No clock/hash/converter/access/event/network/log occurs inside. Revalidate the committed value and return `{ receipt, pr: null }`.

For a direct Mode A edit only, best-effort append P3-B `edit.apply` after receipt success with actor `author`, target `{ aid }`, `docVersion`, and exact summary `applied edit to ${section}`. Append failure never rolls back/changes the successful apply result. Suggestion acceptance emits only P4-O's later `suggest.accept`, not a duplicate `edit.apply`.

### Mode B Git and receipt order

Preserve P4-B's manifest-selected anchors/section paths, deterministic `docedit/<docId>/<subHash16>` author branch, non-force ref create race, bounded fatal-UTF-8/base64 repository-content reads, positional anchor/scanner join, exact tag/range replacement, one complete retry after a file-SHA 409, zero/one open PR rule, and exact safe 502 mapping.

Amend the source hash gate to the captured effective base without confusing branch transport state with concurrency authority. With no current receipt, require the selected target-branch source inner hash to equal `manifestHash`. With a current receipt, admit either `manifestHash` (the normal cross-author target branch that has not carried the other author's overlay) or `effective.hash` (a target branch that already contains the captured overlay). The target branch being at `manifestHash` does not redefine the accepted effective base: `expectBase` must still equal the captured overlay hash, and the later receipt CAS must still prove that captured receipt snapshot unchanged. Any other source hash is 409. For every source mismatch where the selected canonical block exists, set `currentHash = sha256(inner UTF-8)` and set `current = candidate` only when `candidate = toMd(inner)` is within 0–4,000 UTF-16 code units, contains no lone surrogate, and satisfies both exact converter equalities including `toHtml(candidate) === inner`; otherwise set `current = null`. The manifest still supplies the sole file/section/tag and built expiry hash.

For a direct edit, retain P4-B's exact commit message, author, committer, PR title/body, and one-retry behavior. For a suggestion, derive the branch from `author.sub`, set GitHub commit `author` to that actor and the configured bot committer, and use exact message:

```text
Edit block <aid> in document <docId>

Accepted suggestion <sugId>.

X-Suggestion-Id: <sugId>
```

Before a suggestion PUT, after the exact source locator/tag checks but before applying the pre-edit source-hash gate, read the branch-head commit once through GitHub's commit endpoint. A trailer match is one complete line exactly `X-Suggestion-Id: <sugId>`. If present, require the current source inner bytes to equal `toHtml(text)`, skip the pre-edit source-hash gate and PUT, and continue to PR/receipt completion; mismatch is a source 409 with the actual `currentHash`/bounded `current` projection above. If the trailer is absent, apply the pre-edit source gate and PUT normally. Perform this same ordering on the initial attempt and the one complete file-SHA-409 retry. Do not search older commits, accept substring/case/whitespace variants, regenerate an ID, or skip locator/tag validation. This makes a PUT-success/receipt-failure retry at the matching branch head idempotent instead of rejecting its already-edited source; a later unrelated head commit ends that limited guarantee.

Open/reuse the same one author/document PR and never merge it. A new suggestion PR uses P4-B's exact title and body plus final sentence `Accepted suggestions retain their authorship in their commits and receipts.` Existing PR bodies are not rewritten. GitHub commit author is the text author; accepter is retained in receipt/event, not substituted as author.

Only after commit/PR success (or proven trailer replay) write the P3-E receipt with `baseHash: manifestHash` and `pr: positiveNumber`, using the same captured-snapshot callback contract as Mode A. A receipt failure does not roll back Git. Return `{ receipt, pr }`. For a successful direct Mode B edit, best-effort append `edit.propose` after receipt with author actor, `{ aid }`, `docVersion`, and `proposed edit to ${section}`; event failure does not change success.

### `/api/edit` amendment and fan-out

Preserve P4-B's `createEditHandler`, default/config exports, route, origin/body bounds, ignored optional `author`/`email`/`name`, response headers, client compatibility, and errors. Deliberately widen only the handler's identity projection so `email` may be either `""` or an unchanged canonical P2-G email and `name` may retain the canonical empty value. The handler must not reject an empty email before mode selection: `applyText()` selects the mode, standalone admits the empty actor without projection, and repository mode alone rejects it before branch/provider work under the rule above. Amend the factory/default handler to exact `(req, context)` arity, preserve P4-M's one complete P2-G lookup, and require both `canSuggest` and `canEdit` before apply. Remove all duplicate manifest/store/GitHub/receipt logic. The post-N factory argument is an ordinary exact object containing these ten own enumerable writable/configurable callable data properties and no others:

```text
{
  requireOrigin,
  identify,
  resolveRole,
  capabilitiesFor,
  readEffectiveBase,
  applyText,
  notify,
  toMd,
  toHtml,
  sha256Hex,
}
```

Unknown/missing/extra/undefined/non-function values, accessors, symbols, arrays, null, or a custom prototype throw `TypeError("Invalid edit dependencies")` synchronously. The returned handler is named and has exact `(req, context)` arity. Production statically imports P1-C/P2-H identity/origin, P2-G access, this ticket's `ApplyError` plus two service functions, P4-D/P4-H `notify`, the canonical converter pair, and `node:crypto` for the existing synchronous `sha256Hex`; it constructs one closed dependency object and one default handler. The imported constructor is not request/factory-selectable: map only `instanceof ApplyError` through the safe table, while forged status/code/current fields are 500. `toMd`/`toHtml` preserve P4-B's converter validation before P4-M authorization, while `sha256Hex` projects the post-apply notification hash. It never imports `publish`, P2-B store helpers, a provider SDK, manifest/source/Git code, or accesses `context.waitUntil()` directly.

Amend the exact body to allow optional `baseHash` in addition to P4-B's existing fields. When present it must be 64 lowercase hex and becomes `expectBase`. When absent, call `readEffectiveBase()` and proceed only when `pending === false`, using its `manifestHash`; a current overlay returns 409. This legacy path preserves the already-shipped P4-B client safely but cannot overwrite an unseen overlay. P4-P later sends `baseHash` on every direct edit, computed as SHA-256 UTF-8 of `toHtml(current editable text)`, and synchronizes every applied receipt text into `data-md` so that a later base capture cannot read stale built Markdown.

Call `applyText({ docId, aid, text, author: identityActor, acceptedBy: null, sugId: null, via: "edit", expectBase })`. After it returns, compute exact `hash = sha256(toHtml(result.receipt.text) UTF-8)` and call the factory's exact `notify(context, { t: "edit.saved", docId, aid, hash })` once inside a catch-all synchronous boundary. This occurs after `applyText()` has finished its receipt and best-effort audit work. Ignore the boolean result/throw; do not await a sink or alter success. Then return P4-B's exact status-200 `{"receipt":<public-direct-projection>}`: project `aid`, `text`, `by`, `at`, `pr`, and `via` from the fully validated stored receipt in that order, preserving the submitted-aid validation used by the P4-B client. Do not serialize stored `v`, `baseHash`, suggestion fields, or the library result's sibling `pr`. Map `ApplyError` through P4-B's safe table; exact 409 is `{ "error": { "code": "conflict", "message": "The block changed since this document was built" }, "current": <string-or-null> }`.

### `/api/pending` manifest-selection amendment

Amend P3-E's `netlify/functions/pending.mjs` without changing its three exports, `GET`-only route, `(req)` handler arity, authentication/access order, exact query/status/empty-error/header bodies, list ceilings/order, strong receipt reads, receipt validator/projection, stale rule, or read-only guarantee. Its post-N factory argument is one ordinary exact object with these eleven own enumerable writable/configurable data properties, no accessors/symbols/custom prototype, and every value callable:

```text
{
  identify,
  resolveRole,
  capabilitiesFor,
  assertIdentitySub,
  normalizeEmail,
  docState,
  editPrefix,
  editKey,
  read,
  upgrade,
  readApplyManifestFn,
}
```

Unknown/missing/extra/undefined/non-function data rejects synchronously with P3-E's exact `TypeError("Invalid pending dependencies")`. The factory returns the same named one-argument async handler. Production supplies the first ten values from P3-E's existing identity/access/store modules and imports exact `ApplyError` plus `readApplyManifest` from `../lib/gitedit.mjs`, passing only the latter as `readApplyManifestFn`; the constructor remains a fixed module boundary rather than a factory/request-selected value. Remove exact scalar factory key `manifestRoot`; remove the private manifest-index cache/traversal/parser; and remove the entire `node:fs` import and its `closeSync`, `constants`, `fstatSync`, `lstatSync`, `openSync`, `readSync`, and `readdirSync` bindings. No other dependency/import is added or removed.

After `canRead` succeeds, call `readApplyManifestFn(docId)` exactly once and use only returned `manifest`; validate the returned exact `{mode,manifest}` boundary rather than trusting a test double. The handler does not call `assertApplyManifest()` itself and cannot inspect mode configuration, a filesystem root, the private key, HTML, or request-selected path.

Repository mode therefore preserves P3-E's same bounded cached sidecar selection through the centralized service. Standalone mode now reads the same private P4-S manifest used by apply. Map only an `error instanceof ApplyError` with `status === 404` to P3-E's empty 404 and one with `status === 503` to its empty 503; every other instance/value/throw maps to its empty 500. Continue to call the pending handler's own `docState()` for receipt inventory only after manifest success. This amendment makes Mode A overlay reads and expiry use the same authoritative row hashes as apply without putting HTML, request paths, or a second manifest algorithm into `pending.mjs`.

## Files owned

- `netlify/lib/gitedit.mjs` — **new**, sole effective-base/apply implementation.
- `netlify/functions/edit.mjs` — **amended after P4-M**, retaining authorization and delegating apply.
- `netlify/functions/pending.mjs` — **amended after P3-E**, delegating only Mode A/Mode B manifest selection to `readApplyManifest()`.
- `scripts/test-p4-n.mjs` — **new permanent regression harness** for deterministic service/handler behavior, supervision, and the opt-in hosted lifecycle.
- `docs/tickets/P4-N.md` — **new canonical specification**; not an implementation path.

No client, suggestion function, P4-S tool, configuration, package, manifest, template, source, generated artifact, other fixture, research, prompt, or other permanent test file is owned.

## Dependencies

- **P4-B then P4-M:** mandatory serialized predecessors on `edit.mjs`; N must preserve B's request/client compatibility and M's P2-G enforcement.
- **P4-S:** integration predecessor for Mode A, exact private `mode/<docId>/manifest.json`, canonical commit/history admission, and no-public-HTML authority.
- **P2-D/P1-D:** exact manifest, converter, scanner, aid, tag, and hash contracts.
- **P2-B/P3-E:** store/CAS/key errors and all accepted receipt variants.
- **P3-B:** exact direct-edit event kinds/targets and non-transaction boundary.
- **P4-D/P4-H:** integrated sole `notify()` helper and exact `edit.saved` input; the handler owns one caller site while the library remains context-free.
- **P3-E:** exact pending authentication/list/receipt/projection/response contract; N amends only its manifest selection so Mode A overlays are readable.
- **P4-O:** downstream consumer of the receipt/effective-base/apply service methods; it must not implement another apply/effective-base path.

### Maximum safe implementation waves

1. Finish and gate P4-B, then P4-M. No agent edits `edit.mjs` concurrently across those tickets.
2. One agent may build `gitedit.mjs` while another creates `scripts/test-p4-n.mjs` against the frozen service contract and others prepare read-only extraction-diff reviews against P4-B/P3-E; each file has one writer.
3. After the library API is green, separate agents may amend `edit.mjs` and `pending.mjs` because those files are disjoint; each file still has one writer. Integrate and run their common manifest-mode fixture before P4-O starts.
4. Serialize provider tests that share a GitHub branch/PR or Mode A edit key; separate documents/repositories may run independently.

## Acceptance criteria

- [ ] `gitedit.mjs` has exactly the eight exports and one production service; `edit.mjs` preserves factory/default/config plus P4-M authority and contains no duplicate apply algorithm.
- [ ] Mode is selected only by complete server configuration; repository mode never falls back, standalone makes the exact one strong raw-sidecar read (not versioned-record `read()`), and request/HTML/`doc.json` cannot select authority/path.
- [ ] Standalone manifest admission is exactly P4-S's Mode A subset, including seven-character commit and 1,000-row maximum; generic P2-D/P3-B-compatible bounds do not widen it.
- [ ] `readEffectiveBase()` returns receipt-derived hash/text only for a fresh baseHash match and otherwise manifest hash/null; receipt `baseHash` remains the built hash.
- [ ] Apply validates the exact discriminated input, rejects no-op/stale base, and returns exact safe errors/current text without provider/config/path/actor leakage.
- [ ] Mode A performs zero Git calls and writes only the canonical direct/suggestion receipt; explicit current-overlay bases can replace the captured slot, while a CAS-changed slot conflicts; Mode B preserves all P4-B Git bounds and one retry before receipt.
- [ ] Suggestion acceptance authors the commit/branch by the suggester, records accepter in receipt, uses the exact trailer, skips only a matching head operation with matching source, and makes exact receipt replay a no-op.
- [ ] A current overlay may be accepted by a different author whose target branch is at either the manifest source or captured overlay, while `expectBase`, file-SHA retry, and receipt CAS still protect the captured effective state.
- [ ] Direct edit has no false cross-crash idempotency claim; Git success followed by receipt failure remains a documented 503/reviewable-commit state.
- [ ] Direct `edit.apply`/`edit.propose` events occur only after receipt success; suggestion apply emits no duplicate direct-edit event; audit failure preserves success.
- [ ] Direct edit calls `notify(context,{t:"edit.saved",docId,aid,hash})` exactly once after apply/audit completion; notification false/throw cannot change success and `gitedit.mjs` remains context/provider-free.
- [ ] `pending.mjs` preserves P3-E's exact API/list/projection behavior while delegating the sole manifest selection; Mode A pending and apply use the same private manifest and Mode B retains the same bounded cache.
- [ ] Repository apply rejects an empty author email before Git, projects an empty commit-author name only to that author's own email, and preserves the exact actor in receipts/events; Mode A admits the canonical empty actor snapshot without projection.
- [ ] Legacy P4-B edit requests remain safe only without a current overlay; optional `baseHash` enables exact effective-base concurrency and P4-P is named as the client amendment.
- [ ] `node scripts/test-p4-n.mjs` is the permanent executable local gate, and its hosted branch withholds success until its generated repository, site, state, PR/branches, and local root are cleaned.
- [ ] AST, deterministic runtime, supervision, GitHub/Netlify provider, repository, scrub, generated-output, and issue-pointer gates pass with exact output.

## Test plan

### 1. Syntax, exports, extraction AST gate

```bash
set -euo pipefail
node --check netlify/lib/gitedit.mjs
node --check netlify/functions/edit.mjs
node --check netlify/functions/pending.mjs
node --check scripts/test-p4-n.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as service from "./netlify/lib/gitedit.mjs";
import * as edit from "./netlify/functions/edit.mjs";
import * as pending from "./netlify/functions/pending.mjs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
assert.deepEqual(Object.keys(service).sort(), ["ApplyError", "applyText", "assertApplyManifest", "assertApplyReceipt", "createGitEditService", "readApplyManifest", "readApplyReceipt", "readEffectiveBase"]);
assert.deepEqual(Object.keys(edit).sort(), ["config", "createEditHandler", "default"]);
assert.deepEqual(Object.keys(pending).sort(), ["config", "createPendingHandler", "default"]);
for (const file of ["netlify/lib/gitedit.mjs", "netlify/functions/edit.mjs", "netlify/functions/pending.mjs"]) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(sf.parseDiagnostics.length, 0, file);
  assert.equal(/console\.|eval\s*\(|new Function|import\s*\(/.test(source), false, file);
}
const handler = readFileSync("netlify/functions/edit.mjs", "utf8");
assert.match(handler, /resolveRole/); assert.match(handler, /canSuggest/); assert.match(handler, /canEdit/); assert.match(handler, /applyText/);
assert.match(handler, /notify/); assert.equal(/\bpublish\s*\(|waitUntil\s*\(/.test(handler), false);
for (const forbidden of ["DOCS_REPO", "anchors.json", "pulls", "editKey(", "mutate("]) assert.equal(handler.includes(forbidden), false, forbidden);
const pendingSource = readFileSync("netlify/functions/pending.mjs", "utf8");
assert.match(pendingSource, /readApplyManifest/);
assert.match(pendingSource, /ApplyError/);
for (const forbidden of ["node:fs", "readdir", "manifestRoot", "DOCS_REPO", "mode/"]) assert.equal(pendingSource.includes(forbidden), false, forbidden);
console.log("PASS  P4-N one-apply AST boundary");
NODE
```

Expected: exit 0 and exactly `PASS  P4-N one-apply AST boundary`. A pinned TypeScript AST walk additionally binds all imports/calls, proves only `gitedit.mjs` contains manifest selection/source/GitHub/apply-receipt operations, proves `pending.mjs` retains its read-only receipt list while delegating one manifest read, proves direct notification only in `edit.mjs`, and proves no dynamic/provider SDK/server/worker/timer/log surface or identity/access import in the library.

### 2. Deterministic runtime and supervisor gate

Run the permanent harness from the repository root:

```bash
node scripts/test-p4-n.mjs
```

It drives the real service and both edited handlers through their exported factories with exact fake filesystem/store/fetch/access/clock/hash/notify. The finite matrix covers every accepted/rejected service dependency key including `appendEventFn`, the exact ten-key post-N edit factory, and the exact eleven-key pending factory; both handlers' exact imported-`ApplyError` instance mapping and forged error rejection; both modes/partial config; the Mode A manifest's exact `get` key/options/count, null/SyntaxError/corrupt/provider mappings, 7/8-character commit and 1,000/1,001-row boundaries, and prohibition on the versioned `read()` helper; the same manifest result in apply and pending; pending's unchanged auth/list/receipt/projection surface; absent/stale/fresh receipts; effective hash/text; every input discriminator; repository empty/nonempty author email and empty-name-to-own-email projection with unmodified receipt/event actor; 0/4,000/4,001/no-op; legacy/explicit edit base; all P4-M roles; branch create race; source/anchors locator failures and actual source `currentHash`/bounded `current`; first/second PUT 409; zero/one/two PRs; direct and suggestion receipt variants; trailer exact/case/substring/mismatch/later-head and PUT-success/receipt-failure replay; different-author overlay acceptance from manifest-base and effective-overlay target branches; exact receipt replay/mismatch/accepter preservation; CAS races; event success/failure; exact edit.saved hash and notify true/false/throw; bounded provider bodies/timeouts; and every public response.

The same command runs beneath one direct-child Node supervisor with a 240-second deadline. Self-probe HUP/INT/TERM and a TERM-resistant child first, require 129/130/143/124, forward first signal, TERM then KILL only a proven live child, reap, prove absence, and only then remove its mode-0700 root. Uncertainty exits 125 and retains a mode-0600 locator. Successful output is exactly:

```text
PASS  P4-N supervisor signals and deadline
PASS  P4-N modes, pending, conflict, Git, receipt, replay, and fan-out runtime
PASS  P4-N fixture cleaned
```

### 3. Official-provider and repository gate

With authenticated `gh` and `netlify` CLIs able to create/delete disposable fixture resources, run the exact opt-in command:

```bash
AIUR_P4N_HOSTED=1 node scripts/test-p4-n.mjs --hosted
```

No other environment value selects hosted execution. Against one generated disposable GitHub repository and Netlify site, it proves repository direct edit, cross-author suggestion accept from both allowed target-branch states, forced post-commit crash/retry, one PUT conflict retry, one PR reuse, standalone receipt-only apply, private-manifest mismatch, Mode A pending overlay visibility/expiry, edit fan-out, and no Mode A Git request. The complete harness has a 1,200-second outer deadline and removes PRs/branches, repository/site/blob/user state, and its local mode-0700 root before printing exactly `PASS  P4-N hosted one-apply and pending lifecycle`. Cleanup uncertainty exits 125, prints no PASS line, and retains only a mode-0600 locator to the unresolved disposable resource.

```bash
set -euo pipefail
: "${P4N_BASE:?set P4N_BASE}"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-N.md netlify/lib/gitedit.mjs netlify/functions/edit.mjs netlify/functions/pending.mjs scripts/test-p4-n.mjs
git diff --check "$P4N_BASE"...HEAD
git diff --check
test -z "$(git diff --name-only "$P4N_BASE"...HEAD | grep -Ev '^(netlify/lib/gitedit\.mjs|netlify/functions/(edit|pending)\.mjs|scripts/test-p4-n\.mjs|docs/tickets/P4-N\.md)$' || true)"
issue_json="$(gh issue view 36 --json title,body)"
pointer="$(ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P4-N.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P4-N — The one apply path" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
unset issue_json pointer pointer_sha pointer_path
printf '%s\n' 'PASS  P4-N repository gates'
```

Expected: all commands exit 0; generated documents are byte-identical; issue #36 contains only the prompt-prescribed full-commit permalink to this canonical document and addressed bytes match; the final line is exactly `PASS  P4-N repository gates`.

## Failure modes

- Missing/partial/corrupt mode configuration or manifest: fail closed before source/Git/receipt and never infer from public HTML/request.
- Pending manifest selection fails: preserve P3-E's empty 404/500/503 and perform no receipt inventory; never fall back to its removed filesystem-only algorithm.
- Effective base mismatch: 409 with only bounded representable current text or null; no merge/rebase/write.
- Git unavailable/malformed/slow: 502; one file-SHA 409 retries the complete source check once, then stops.
- Git commit succeeds and receipt fails: source commit/PR may exist. Suggestion retry is limited-idempotent by head trailer; direct edit remains a surfaced manual reconciliation case.
- Receipt succeeds and audit fails: apply remains success; direct audit can be absent.
- Notification false/throw after direct apply: apply and audit outcome remain unchanged; the client still receives the successful receipt.
- Repository author email is empty: safe 500 before branch/provider work; standalone apply remains valid and no bot/accepter substitution occurs.
- Repository author name is empty but its email is valid: only the Git commit author name uses that same email; the exact empty-name actor remains in the durable receipt/event.
- Concurrent different applies: receipt CAS chooses one visible overlay, but Mode B can retain an extra reviewable branch commit; no cross-provider transaction is claimed.
- A matching suggestion trailer is no longer branch head: limited replay cannot prove prior operation and refuses/uses normal conflict behavior rather than searching unbounded history.

## Settled decisions

- Authorization stays in `edit.mjs`; `gitedit.mjs` accepts only trusted server actors and never resolves roles.
- `readApplyManifest()` is the sole mode/manifest selector for apply, suggestions, and pending; its Mode A branch uses the strong store's raw JSON `get()` because the P2-D sidecar is intentionally not a versioned record, while `pending.mjs` keeps only its read authorization/receipt behavior.
- This final Mode A manifest seam narrowly supersedes P3-E's earlier statement that P4-N would not amend `pending.mjs`; P3-E's receipt schemas were already forward-compatible, and only its filesystem-only manifest selector is removed.
- The effective base is a fresh overlay hash/text else manifest hash/null; Git branch content is check three, not a competing base definition.
- Mode A uses the private P4-S manifest and receipt only. Mode B uses manifest-selected Git source, PR, then receipt.
- Receipt `baseHash` is always the deployed manifest hash, even when `expectBase` is an overlay hash.
- Repository Git author name falls back only from empty actor name to that same actor's required nonempty email; Mode A and all durable actor snapshots remain unprojected.
- Suggestion operation ID is the exact trailer and receipt `sugId`; its guarantee is head/retry-scoped, not global history search.
- P4-P upgrades direct-edit requests to explicit base hashes; absent hashes preserve only safe first-edit compatibility.
- Only the edit handler calls `notify()` for direct writes, after the library has completed apply/audit; the library has no Functions context or fan-out knowledge.

## Assumptions and open questions

- **Assumption:** P4-S admits Mode A only when manifest `commit` is exactly seven lowercase hex characters and matches embedded history head, which is the narrower Mode A subset of P3-B-compatible `docVersion`.
- **Assumption:** P3-E's private validator remains behaviorally identical to P4-N's exported `assertApplyReceipt`; the integration fixture runs the same finite receipt matrix through both boundaries.
- **Open question, non-blocking:** a later commit after a crash moves the suggestion trailer off head. Supporting that replay needs a bounded operation index or bounded commit query contract.
- **Open question, non-blocking:** Mode B can create an extra author-branch commit before receipt CAS loses. A cross-provider transaction is unavailable; manual PR review is the containment.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.4–1.5, 2.5–2.6, 3.4, and 4.7 — one store, two modes, access, receipts, manifest, and one apply path.
- `docs/research/08-suggestions-and-editing-model.md` §§4.2–4.3, 5.4, 6, 8, 9, and 12.1 — apply ordering, receipt extension, effective base, modes, authorship, and trailer; its `doc.json` authority is superseded.
- `docs/research/05-inline-editing.md` §§6–9 — converter, locator, conflict, Git attribution, branch, and PR background.
- `docs/research/09-sharing-and-roles.md` §§4–6 — mode/role intent, refined by P2-G/P4-M.
- `docs/tickets/P4-B.md`, `P4-M.md`, `P4-S.md`, `P2-D.md`, `P2-G.md`, `P3-B.md`, and `P3-E.md` — exact predecessor handler, enforcement, private manifest, conversion, access, event, and receipt contracts.
- `docs/tickets/P4-D.md` and `P4-H.md` — exact optional fan-out helper, `edit.saved` input, and caller isolation.
- [GitHub repository contents REST documentation](https://docs.github.com/en/rest/repos/contents) — update requires current blob SHA and can return 409; checked 2026-09-03.
- [GitHub Git references REST documentation](https://docs.github.com/en/rest/git/refs) and [pull requests REST documentation](https://docs.github.com/en/rest/pulls/pulls) — branch create/update and head/base PR behavior; checked 2026-09-03.
- [GitHub commits REST documentation](https://docs.github.com/en/rest/commits/commits) — branch/head commit message retrieval for the trailer check; checked 2026-09-03.
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — strong reads and conditional writes; checked 2026-09-03.
