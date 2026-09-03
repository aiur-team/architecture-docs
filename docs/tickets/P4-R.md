# P4-R — Standalone-mode acceptance and promotion

## Outcome

An authenticated Netlify site administrator or deployer can export at most twelve current applied overlays into one new, reviewable local bundle whose HTML, edit manifest, and history agree byte-for-byte; inputs are never overwritten and a cooperative publication lock protects the intended new output name; only a later explicit P4-S reconnect uploads that bundle, so promotion never pretends a local and remote multi-file transaction exists.

## Context

P4-N makes acceptance live immediately in Mode A by writing an overlay receipt only. That state is not a durable artifact. P4-S creates the one tokenless Netlify CLI tool and publishes the private P2-D manifest that makes Mode A editing possible. This ticket extends that exact `scripts/connect.mjs`: it reads the current site's receipts with the same supervised CLI boundary, promotes them into a new directory, and leaves re-upload as a separate deliberate site-administrator/deployer action. It neither creates a colliding second tool nor converts the document to Mode B.

## Scope

### In scope

- Amend P4-S's `scripts/connect.mjs` with one `promote` command and amend its existing `scripts/connect.test.mjs` harness for promotion coverage while preserving every existing connect invocation/export/output/test.
- Validate the supplied standalone HTML, P2-D manifest, and P2-E history as one Mode A snapshot.
- Read the site's exact private manifest and `edits/<docId>/` receipts through the authenticated Netlify CLI without accepting a token.
- Treat an authenticated Netlify CLI session with access to the selected site as the promotion authority; promotion performs no P2-G document-role proof.
- Acquire exact history and output-name cooperative locks before any remote read or output staging.
- Select every current valid receipt, replace only its exact editable block/opening metadata, and update the corresponding manifest hash.
- Add one P2-E-compatible history row per promoted receipt, crediting the text author.
- Publish a complete new local directory atomically under a cooperative output-name lock and the explicit Node rename race boundary below, without overwriting any input.
- Print the exact reconnect command boundary; P4-S performs the later manifest upload and deploy.

### Out of scope

- Writing a second connect/export script, importing `@netlify/blobs`, adding a server endpoint, accepting/reading a bearer token, or writing `.netlify/state.json`.
- Deploying, setting authority, deleting receipts, mutating suggestions, accepting/rejecting text, or calling P4-N/P4-O server code from the CLI.
- Editing a repository/source instance, invoking docbuild/P2-E `refresh()`, reading Git, attaching a repository, or Mode A-to-Mode B conversion.
- Overwriting the input HTML/manifest/history, intentionally replacing an existing output directory beyond the disclosed uncooperative empty-directory race, merging conflicting text, promoting stale/corrupt receipts, or hiding attribution to fit retention.

## Interface contract

### Preserved and added command surface

P4-S's three invocations remain byte-for-contract unchanged. Add exactly:

```text
node scripts/connect.mjs promote --file <html> --manifest <edit.json> --history <history.json> --site <site-id> --output <new-directory>
node scripts/connect.mjs promote --help
```

`promote --help` is valid only as shown and prints those two lines with a final LF. The five options may occur in any order after the exact first positional token `promote`, each exactly once. Reject empty, duplicate, `--flag=value`, unknown, extra positional, absent, or malformed values before filesystem/CLI work with exact stderr `connect: invalid promotion arguments\n` and exit 2. Base `--help` and a base connect invocation keep P4-S behavior. `main()` dispatches on only exact leading `promote`; no Git/environment/file heuristic selects mode.

Preserve P4-S's exports and add exactly:

```js
export function parsePromoteArgs(argv) { /* contract below */ }
export function assertPromotionHistory(value, instance) { /* contract below */ }
export function createPromotion(input, options) { /* contract below */ }
export function createPromotionRunner(dependencies = {}) { /* contract below */ }
```

The final module exports, sorted, are `assertModeManifest`, `assertPromotionHistory`, `createConnectRunner`, `createPromotion`, `createPromotionRunner`, `inspectStandaloneHtml`, `main`, `normalizeConnectOwner`, `parseConnectArgs`, and `parsePromoteArgs`. There is no default export. Imports remain Node built-ins only. `createPromotion()` accepts only the exact ordinary input `{ html, manifest, history, receipts }` and exact ordinary options `{ nowMs }`, is pure over those already validated values, and has no filesystem, process, environment, CLI, network, clock, randomness, or logging access.

Because P4-S's self-contained tool forbids a docbuild runtime import, add one private non-exported `promotionToHtml`/`promotionToMd` twin of P2-D's frozen three-mark converter in this file. It has the exact entity order, `code`/`strong`/`em` pass order, delimiter/run behavior, and round-trip equality; it is used only by promotion transform/validation. `scripts/connect.test.mjs` must compare both directions and both round-trip predicates against all twelve rows in exact `templates/fixtures/inline.json` plus the exhaustive declared boundary classes before any promotion case passes. This mandatory test may read fixture data but production imports no template/docbuild/browser runtime. No caller injects or selects a converter, no P4-S export changes, and no second converter grammar is invented.

`createPromotionRunner()` reuses P4-S's one-child supervisor and accepts one ordinary exact optional dependency object. Its only optional callable own data keys are `lstatFn`, `realpathFn`, `openFn`, `mkdtempFn`, `mkdirFn`, `renameFn`, `rmFn`, `spawnFn`, `tmpdirFn`, `nowFn`, `setTimeoutFn`, `clearTimeoutFn`, and `createPromotionFn`; its only optional scalar keys are `workingDirectory`, `repositoryRoot`, `env`, and `processId`. The two directories are absolute existing non-symlink directories, `env` is a fresh ordinary string map subject to P4-S's exact allowlist copying, and `processId` is a positive safe integer. Omitted members use P4-S's existing named Node dependencies, captured cwd/repository root/environment, `process.pid`, `Date.now`, global timers, and this module's pure function. Unknown keys, accessors, symbols, arrays, null, custom prototypes, explicit undefined, or wrong types throw `TypeError("Invalid promotion dependencies")` synchronously. Copy accepted scalar/environment values at construction. File-handle results must provide only the exact called `stat`/`readFile`/`writeFile`/`sync`/`close` operations, which are validated before each use; the runner never patches globals. Request/HTML/blob data cannot replace dependencies.

`parsePromoteArgs(["--help"])` returns the fresh exact `{ help: true }`. A structurally valid invocation returns a fresh exact object with keys in order `{ file, manifest, history, site, output }`, retaining those five nonempty strings. Every other token shape throws a private invalid-promotion-argument sentinel. The factory returns one named async `run(parsed)` function and revalidates that exact ordinary five-key object before work; help, extras, accessors, symbols, or custom prototypes reject before filesystem/CLI work. Success resolves to a fresh exact `{ output, siteId, promoted, stale }`, where `output` is the validated resolved final path, `siteId` is the supplied canonical UUID, and the counts are canonical nonnegative safe integers. It writes no stdout/stderr. Failure rejects only with a private promotion error tag for generic failure, cleanup, either lock owner, no current overlay, too many current overlays, or history-ID collision; `main()` alone dispatches/matches these tags, writes the exact lines below, and sets the exit code. Base P4-S errors and output remain byte-for-contract unchanged.

Promotion has no P2-G identity or role input and performs no document-owner proof. Its authority is the operator's stored Netlify CLI login plus authenticated access to the exact `--site` UUID; this deliberately follows P4-S's settled site-administrator/deployer boundary. That operator is authorized to read the private manifest and receipt bodies, including actor email, for local review. The later reconnect is again an explicit authenticated operator action; neither command infers document authority from an email, HTML, manifest, receipt, or `doc.json`.

### Input topology and preflight

Resolve all paths from the initial cwd. `--file`, `--manifest`, and `--history` are distinct regular non-symlink files; HTML is at most 10 MiB, manifest 1 MiB, history 1 MiB. Every resolved path is at most 4,096 UTF-8 bytes and contains no lone surrogate, CR/LF, C0, or C1 control, so later receipts and cleanup locators cannot inject or overflow terminal lines. Read stable file descriptors once, verify type/size did not change, and decode fatal UTF-8. `--site` uses P4-S's canonical UUID. `--output` resolves to an absent final path whose existing parent is a regular non-symlink directory; the final path is neither filesystem root, home, cwd/repository root, an input/ancestor of an input, nor inside `.git`, `.netlify`, `node_modules`, or a P2-E source instance. A directory containing `doc.json` or `sections/`, an HTML path accompanied by either in its parent, or any request to an existing output fails before CLI/blob/mutation work. An unrelated surrounding Git checkout does not change a valid standalone file's mode.

Parse HTML with P4-S `inspectStandaloneHtml()` and validate local manifest against it with `assertModeManifest()`. The history bytes must be exact `JSON.stringify(canonical, null, 2) + "\n"` for P2-E's complete closed schema with `doc === manifest.instance`, 1–12 versions, exact key order, unique seven-hex IDs, head equality, safe files/IDs/stats/patches/URLs, and escaped compact payload at most 16,384 bytes. Extract the single `#doc-history` JSON script from HTML using P4-S's non-executing scanner, reverse P1-B's literal `<\/` protection, and require its canonical object to equal the supplied history deeply. Reject absent, duplicate, malformed, entity-encoded, or byte-inconsistent history. This command never calls `templates/build`, `check-dist`, Git, `refresh()`, or `history.ts`.

After all local input/topology/content validation succeeds, but before the first lock, Netlify child, temporary root, or staging directory, take the first `nowFn()` sample. It must be a safe 13-digit epoch millisecond whose canonical `new Date(value).toISOString()` succeeds; a malformed first sample fails without creating a lock. Set `startedAt` to that exact UTC-millisecond string and construct the one immutable lock line in this exact key order and byte form:

```js
JSON.stringify({ v: 1, pid: processId, startedAt, output: resolvedOutput }) + "\n"
```

The UTF-8 line is at most 16,384 bytes and contains no actor, site, receipt, text, or credential. Exclusively create exact sibling `<history-path>.promote.lock` with `open("wx", 0o600)`, fully write those exact bytes, fsync, and close. An existing/symlink/non-regular lock is exact `connect: another promotion owns this history\n`; never remove or steal it automatically. Then exclusively create exact sibling `<output-path>.publish.lock` with the same flags/mode/identity discipline, write/fsync/close the same immutable bytes, and map an existing value to exact `connect: another promotion owns this output\n`. Never resample time or reserialize between locks. Hold both descriptor-created locks through remote reads and output rename; acquire history first and output second. In `finally`, attempt removal of every operation-owned staging/temporary/lock path in reverse creation order, but remove a lock only after lstat/fstat identity proof. After all attempts, a surviving operation-owned path makes cleanup failure take precedence over both earlier success and earlier failure. The first lock serializes processes sharing canonical history and the second serializes cooperating processes sharing an output name. Neither is a cross-machine lease, so an operator must not export the same site/history from two machines concurrently.

### Tokenless remote export

Use P4-S's optional validated `NETLIFY_CLI_PATH`, child-only `NETLIFY_SITE_ID`, environment copy with `NETLIFY_AUTH_TOKEN` removed, `shell: false`, one-child-at-a-time rule, 60-second protocol deadline, TERM-to-KILL/reap, and safe errors. All child stderr and every non-list child stdout retain P4-S's inclusive 65,536-byte limit. Only `blobs:list` stdout has an inclusive 1,048,576-byte limit so its complete bounded JSON inventory can fit; byte 1,048,577 terminates/reaps the child and fails before parsing. The official CLI's stored site-administrator/deployer login owns access.

The exact remote sequence is:

1. Run `netlify blobs:get doc-state mode/<docId>/manifest.json --output <private-temp-file>`; require exit 0, then lstat/open/fstat/read/fstat/close that operation-owned regular non-symlink mode-0600 path within the guarded temporary root and require downloaded bytes exactly equal the supplied manifest. A different/missing/malformed/changed remote manifest stops before receipt listing.
2. Run `netlify blobs:list doc-state --prefix edits/<docId>/ --json`; require exit 0 and fatal-UTF-8 decode only after complete stdout within the 1,048,576-byte cap. Netlify CLI v27.4.2 emits one exact ordinary top-level object with own enumerable data keys in order `{ blobs, directories }`; both values are dense arrays, `directories` must be exactly empty, and `blobs` has at most 1,000 entries. Validate every blob row, without early success, as one exact ordinary object with own enumerable data keys in order `{ etag, key }`, both strings. `etag` is nonempty, at most 512 UTF-8 bytes, contains no lone surrogate, C0, or C1 control, and its exact `JSON.stringify(etag)` UTF-8 token is at most 768 bytes; together with the fixed canonical edit-key grammar this makes every admitted 1,000-row encoding strictly smaller than the list stdout cap. No accessor, symbol, custom prototype, missing/extra key, sparse slot, or non-string value is admitted. Require unique canonical aids and exact `editKey(docId, aid)` equality for every complete row, producing `edits/<docId>/<aid>.json`. A missing `.json`, nonempty directory inventory, truncated/overflow/malformed/out-of-prefix/duplicate result fails closed; do not infer completeness.
3. For each key in lexical aid order, run `netlify blobs:get doc-state <key> --output <distinct-private-temp-file>`. Apply the same operation-owned regular-file identity/stability read, reject a declared or observed byte 65,537 before JSON parsing, then parse and validate P3-E's complete direct or suggestion receipt at that exact key. Provider output never goes to stdout/stderr.

Only receipts whose `baseHash` equals the corresponding local manifest row hash are current and selected. A stale receipt is omitted and named only by count in the final receipt; a receipt whose aid has no manifest row, whose body/key/schema is corrupt, or whose selected text fails P2-D `toMd(toHtml(text)) === text` aborts everything. Zero current receipts exits 1 with exact `connect: no current overlays to promote\n` and creates no output. More than twelve exits 1 with `connect: promotion contains more than 12 current overlays\n`; because P2-E requires one retained attribution row per promoted change, the tool does not silently collapse or evict a newly promoted author's row.

### Pure promotion transform

`createPromotion(input, { nowMs })` accepts one closed exact object `{ html, manifest, history, receipts }`. `receipts` is the 1–12 validated current receipts in lexical aid order. After the complete remote inventory, receipt fetch, validation, current/stale classification, and ordering, production takes the second and only remaining `nowFn()` sample exactly immediately before calling `createPromotion()`. It must be a safe 13-digit epoch millisecond; pass it as `nowMs` and set one canonical UTC-millisecond promotion timestamp for every new row. A malformed second sample enters the same reverse cleanup of temporary paths and both locks, creates no output, and makes no third clock call. Thus a successful run calls `nowFn()` exactly twice: once for immutable lock identity and once for promoted history.

For each receipt, locate exactly one HTML block by aid with P4-S's scanner; require canonical tag, `data-editable`, current inner SHA-256 equal to its manifest row hash, and an opening tag containing only the generated `data-aid`, `data-editable`, and optional `data-md` attributes in P2-D order. Compute `nextInner = toHtml(receipt.text)`. Replace only the inner range and regenerate the opening tag as `<tag data-aid="<aid>" data-editable>` plus exact ` data-md="<P2-D attribute-escaped receipt.text>"` only when `nextInner` contains a paired generated `code`, `strong`, or `em` mark, then `>`. Preserve every other HTML byte. Update only `manifest.blocks[aid].hash = sha256(nextInner UTF-8)`.

Create one history version for each receipt, in lexical `(row.file, aid)` order, and prepend those rows in that order before retained existing rows. Each exact row is:

```json
{
  "sha": "4f7a9c3",
  "date": "2026-09-03T16:19:25.123Z",
  "author": "Avery Quill",
  "subject": "Promote accepted edit to architecture",
  "url": "",
  "changed": [
    {
      "file": "03-architecture.html",
      "id": "architecture",
      "add": 1,
      "del": 1,
      "patch": "@@ -1 +1 @@\n-Old public sentence.\n+New public sentence.",
      "clipped": false
    }
  ]
}
```

This is invented public-safe data. `author` is `receipt.by.name` when nonempty, otherwise its normalized nonempty email, otherwise exact fixed `Reader`; never expose raw `sub` or substitute the accepter. This is the public-safe P2-E nonempty attribution fallback for a canonical degraded Mode A actor. `subject` is exactly `Promote accepted edit to ${row.section}`. Strip the exact `sections/` prefix from `row.file`; `id` is `row.section`. Let `oldText = toMd(currentInner)` after requiring `toHtml(oldText) === currentInner`, and let `newText = receipt.text`. Build a canonical unified one-hunk patch from those exact P2-D plaintext values. Split old/new plaintext on LF (an empty string has zero logical lines); the header range token for each side is `0,0` at zero lines, `1` at one line, and `1,<count>` above one, yielding exact `@@ -<old-token> +<new-token> @@`. Prefix every old/new logical line with `-`/`+`; `add`/`del` are those full logical-line counts. Clip a representable body at 1,200 UTF-8 bytes without cutting a code point or losing the final retained line's permitted prefix, setting `clipped` only when bytes were removed.

As P4-R's explicit Mode A producer rule, if either exact plaintext contains CR or the constructed unified body otherwise cannot satisfy P2-E's closed patch grammar, retain the exact promoted HTML and the already-computed full `add`/`del` counts but emit `patch: ""` and `clipped: true`. This is intentional information loss only in the public history display; it does not remove, normalize, or rewrite any source/receipt text. P2-E's canonical validator already accepts an empty patch with `clipped: true`, so the final history remains closed and the overlay remains promotable.

Derive each stable repository-free ID as the first seven lowercase hex characters of SHA-256 over this exact UTF-8, NUL-separated tuple:

```text
mode-a-promotion-v1, docId, aid, receipt.at, receipt.by.sub, receipt.baseHash, sha256(nextInner), receipt.via-or-legacy, receipt.sugId-or-empty
```

The tuple contains the literal string `legacy` when `receipt.via` is absent, otherwise the exact validated `edit` or `suggestion`; its last field is empty unless that validated receipt has `via: "suggestion"`. These explicit sentinels make every P3-E receipt variant deterministic without serializing JavaScript `undefined`.

Before changing history, compare every proposed ID against every loaded version and against every other proposed ID. Any equality raises the private history-collision tag before HTML/manifest/history/output mutation; `main()` maps it to exact stderr `connect: promotion history identifier collision\n`. This includes a collision with an existing row that retention would evict. Never salt, lengthen, reorder to escape, retry, merge, or drop a row.

After collision proof, set `manifest.commit` to the first new row's ID, set `history.head` likewise, prepend, then retain the first twelve rows. Apply P2-E `trim()` semantics to old patch bodies from oldest toward index 1 until the escaped compact history fits 16,384 bytes, preserving the newest row's patch; fail if structural data plus that patch cannot fit. Serialize manifest/history with two-space JSON and terminal LF. Replace the HTML's one embedded history payload with compact JSON plus P1-B's literal `</` to `<\/` rewrite. Revalidate the final HTML against the final manifest and embedded history against final history. Return a fresh frozen `{ html, manifestBytes, historyBytes, promoted }`; `promoted === receipts.length`. The runner, which classified the complete remote inventory before the pure call, supplies the separate stale count in its success result without placing stale receipt content in the transform.

### Atomic local bundle and next step

Create exact absent sibling `<output-path>.promote-staging` as the one operation-owned mode-0700 staging directory with `mkdir(..., { recursive: false, mode: 0o700 })`, then lstat the result before use. An existing file/directory/symlink at that name fails and is never removed because ownership was not established. Write mode-0600 `index.html`, `document.edit.json`, and `history.json`, fully write/fsync/close each, fsync the directory, and while holding the output lock lstat the final path once more immediately before renaming. If it exists, stop and preserve it. If absent, use one Node built-in `rename(staging, output)` and fsync its parent; this atomically exposes the complete bundle. A file or nonempty directory created before/during rename makes the operation fail and is preserved.

Node exposes no portable no-replace rename for directories. Therefore an uncooperative external process that ignores `<output>.publish.lock` can create an empty directory in the final absence-check/rename window, and POSIX may replace that empty directory. This is the sole stated residual local race; the tool does not claim to prevent it, while all cooperating promotions are serialized. On other failure remove only the operation-owned staging directory after proving its resolved parent/name; never touch inputs or a pre-existing nonempty output. Release both proven local locks only after final rename/parent sync or failure cleanup. No remote write occurs.

If cleanup leaves any operation-owned promotion path after all best-effort removal attempts, stdout is empty, exit is 1, and stderr is exactly `connect: promotion cleanup failed; inspect <validated-path>\n`, where `<validated-path>` is the portable single-quote encoding of the lexically first surviving validated path. This line takes precedence over success, a narrower operation error, and the generic promotion error; other survivors, if any, remain limited to the deterministic guarded temporary root, staging path, and two lock paths derived above. This promotion-only line does not change P4-S's exact base-connect cleanup output or precedence.

Success stdout is exactly:

```text
Promoted <n> current overlays; skipped <m> stale overlays.
Wrote reviewable Mode A bundle to <validated-output-path>.
Review index.html, document.edit.json, and history.json before reconnecting.
Reconnect with: node scripts/connect.mjs --file <output>/index.html --manifest <output>/document.edit.json --history <output>/history.json --owner <owner-email> --site <site-id>
```

Substitute `<n>`/`<m>` with canonical decimal counts, `<validated-output-path>` and every `<output>/...` token with the portable single-quote-encoded resolved paths, and `<site-id>` with the validated closed token. The literal `<owner-email>` placeholder is printed exactly; the tool neither knows nor retrieves owner identity. The displayed command is copyable after the operator replaces that one placeholder. The separate P4-S command validates all three files and their equality, rechecks authority, uploads the exact new manifest, and then deploys the new HTML. It does not upload `history.json`; that file is the reviewable canonical source mirrored in HTML. The later manifest upload, not this local promotion, makes old receipts stale by base-hash mismatch; deploy follows as P4-S's separately verified step. Promotion success therefore means local export, not publication and not a distributed transaction.

Every promotion content/provider/filesystem/supervision failure not assigned a narrower line above, and whose cleanup completes, exits 1 with exact stderr `connect: promotion failed\n`, empty stdout, and no provider body, command, actor, text, site, key, credential, or stack. Narrower exit-1 lines remain exact for history/output lock ownership, no current overlays, more than twelve current overlays, history-ID collision, and the promotion cleanup failure above. Argument errors remain exit 2; help and complete success are the only exit-0 paths.

## Files owned

- `scripts/connect.mjs` — **amended after P4-S** with promotion/export behavior; no second tool is created.
- `scripts/connect.test.mjs` — **amended after P4-S** with the finite pure-transform, fake-CLI, supervisor, atomic-output, and opt-in hosted promotion cases below; no second harness is created.
- `docs/tickets/P4-R.md` — **new canonical specification**; not an implementation path.

The command creates only its explicit operation-owned output directory and temporary history/output-name lock/staging paths at runtime. No repository `history.json`, example, source instance, implementation library, function, config, dependency manifest, template, generated repository artifact, research, prompt, or other permanent test file is owned.

## Dependencies

- **P4-S:** creates the exact tool, supervisor, tokenless CLI/site boundary, three-input HTML/manifest/history validation, private `mode/<docId>/manifest.json` key, and reconnect/deploy path. This ticket lands after and amends it.
- **P4-N:** defines Mode A receipts, fresh baseHash semantics, authorship/acceptance fields, and overlay-only apply behavior.
- **P4-O:** establishes accepted-suggestion receipts as promotable through that sole apply path.
- **P2-D/P3-E:** exact editable transform/manifest and complete receipt schemas.
- **P2-E/P1-B:** exact history schema, patch/whole-payload limits, collision/retention rules, and embedded script serialization.

### Maximum safe implementation waves

1. After P4-S lands, one agent may implement pure `assertPromotionHistory`/`createPromotion` while another prepares the promotion CLI fixture; only one edits `scripts/connect.mjs`, so use patch handoff rather than concurrent writes.
2. Integrate pure transform and runner serially in that same file, preserving every P4-S export/command test before adding promotion cases.
3. P4-N/O server work may proceed in parallel on disjoint files once their receipt contract is frozen. Do not run their hosted state fixture concurrently with promotion export against the same site.
4. One operator alone runs the tokenless hosted export/reconnect lifecycle and cleanup.

## Acceptance criteria

- [ ] P4-S connect behavior/exports/output and every preexisting `scripts/connect.test.mjs` case remain exact; `promote` is the only new command and no second Mode A tool or harness exists.
- [ ] Promotion authority is an authenticated Netlify site administrator/deployer with access to the selected site; no P2-G actor, owner-email, manifest, HTML, or receipt field is treated as authority.
- [ ] Command selection and standalone/source-instance preflights are explicit; neither Git presence, environment, URL, history row, nor manifest field guesses mode.
- [ ] The tool accepts no token, imports no provider SDK, writes no link state, and uses only the inherited supervised Netlify CLI boundary for one manifest get, one bounded list, and bounded receipt gets.
- [ ] Remote/local manifests match exactly; `blobs:list` validates v27.4.2's complete exact `{blobs,directories}` object, empty directories, and every exact `{etag,key}` row within its dedicated 1-MiB stdout cap; every receipt/key/schema is validated; only current baseHash matches promote; corrupt/unknown state aborts without partial output.
- [ ] Zero and more-than-twelve current overlays fail exactly; attribution is never coalesced or silently evicted.
- [ ] Every promoted block preserves non-owned HTML bytes, regenerates only canonical editable opening metadata/inner text, updates its sole manifest hash, and the private self-contained converter twin passes mandatory parity on all twelve P2-D fixture rows without a production template/browser import or P4-S export change.
- [ ] Each change gets one canonical history row credited from `receipt.by` with the fixed public-safe `Reader` degraded fallback, a stable ID across every receipt variant, exact subject/date/url/change, P2-E patch/whole-payload budgets, and all-row collision proof before retention.
- [ ] Final manifest commit, history head, embedded history, standalone HTML, and separate canonical history bytes agree and completely revalidate.
- [ ] After complete preflight, exactly one first clock sample creates the exact shared, at-most-16,384-byte lock JSON line; history/output locks receive identical bytes in order before remote read. Exactly one second clock sample occurs after remote classification immediately before the pure transform. Locks remain held through durable publication, identity-checked before reverse removal, and never stolen; the rechecked absent output is published by one atomic rename after durable three-file staging, inputs remain preserved, and no portable no-replace guarantee is claimed against the exact uncooperative empty-directory race.
- [ ] Promotion performs no remote write/deploy/delete. Success explicitly names the review/reconnect step, and only P4-S's later private-manifest upload makes old receipts stale before its separately verified deploy.
- [ ] AST, pure/runtime, supervision, hosted CLI, repository, scrub, generated-output, and issue-pointer gates pass with exact output.

## Test plan

### 1. Syntax, exports, and AST gate

```bash
set -euo pipefail
node --check scripts/connect.mjs
node --check scripts/connect.test.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as connect from "./scripts/connect.mjs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
assert.deepEqual(Object.keys(connect).sort(), [
  "assertModeManifest", "assertPromotionHistory", "createConnectRunner", "createPromotion",
  "createPromotionRunner", "inspectStandaloneHtml", "main", "normalizeConnectOwner",
  "parseConnectArgs", "parsePromoteArgs",
]);
const source = readFileSync("scripts/connect.mjs", "utf8");
const sf = ts.createSourceFile("connect.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
for (const denied of ["@netlify/blobs", "DOCS_REPO", "history.ts", "refresh(", "templates/build", "blobs:delete"]) assert.equal(source.includes(denied), false, denied);
console.log("PASS  P4-R single-tool AST boundary");
NODE
node scripts/connect.test.mjs
```

Expected: exit 0; the inline oracle prints exactly `PASS  P4-R single-tool AST boundary`, then the amended permanent harness prints P4-S's two existing PASS lines followed by the P4-R lines declared below. The pinned implementation AST oracle additionally binds `createPromotion()` as call-free outside declared pure helpers, proves no dynamic import/shell/network/server/worker/provider SDK/process/clock/random/log access in it, and proves the runner's only new child commands are exact `blobs:get` and `blobs:list` arrays.

### 2. Pure transform and supervised runner gate

Extend P4-S's existing `scripts/connect.test.mjs`; do not create a second harness. First run full two-direction/round-trip parity across all twelve rows in P2-D's canonical inline fixture and the declared empty/entity/delimiter/nesting/Unicode/control boundaries. Then use invented HTML/manifest/history and direct/suggestion receipts against the real exports. The finite matrix covers 1/12/13 current receipts, stale omission, every receipt variant/key failure, all input/output type/path/control/symlink/source-instance guards, malformed first/second clock samples and exact two-sample call order, exact lock schema/key order/identical bytes and private source-bound lock-encoder UTF-8 boundaries at 16,383/16,384/16,385 bytes, both lock acquire/write/fsync/close/content/order/ownership/removal failures, two concurrent cooperating local promoters, a deterministic injected uncooperative empty-directory final-window race proving the documented replacement boundary plus file/nonempty-directory preservation, inline marks/attribute regeneration, a multiline direct-overlay-to-suggestion-to-accept promotion, Unicode clipping, exact CR/unrepresentable-patch fallback with unchanged promoted text/full stats/empty patch/`clipped:true`, 16,384-byte history trimming/hard failure, history/embedded mismatch, existing/proposed collisions including an evicted row, deterministic IDs/order, identical promotion timestamps, exact three-file bytes/modes, every staged write/fsync/close/rename/parent-sync failure, output collision, and guarded cleanup. Its new deterministic line is exactly `PASS  P4-R pure promotion and atomic bundle`.

The runner fixture fakes the real CLI child boundary and covers manifest mismatch; exact top-level `{blobs,directories}` and exact complete `{etag,key}` rows; `etag` at 511/512/513 raw UTF-8 bytes and 767/768/769 serialized-token bytes plus empty, control, lone-surrogate, and non-string cases; rejected arrays, extra/missing/accessor-like shapes, nonempty directories, sparse arrays, and partial rows; 0/1/1,000/1,001 list entries; valid `blobs:list` stdout at 1,048,575 and 1,048,576 bytes and failure at 1,048,577; malformed/truncated output; receipt gets; timeout/signal/nonzero; token stripping; one child at a time; and zero remote mutation. Run it below the reused P4-S direct-child supervisor with a 240-second deadline after HUP/INT/TERM/TERM-resistant self-probes. Expected output is exactly:

```text
PASS  P4-S pure connect contract
PASS  P4-S supervised Netlify protocol
PASS  P4-R supervisor signals and deadline
PASS  P4-R pure promotion and atomic bundle
PASS  P4-R supervised tokenless export
PASS  P4-R fixture cleaned
```

### 3. Hosted two-step proof and repository gate

With Netlify CLI `27.4.2`, an authenticated test site administrator/deployer, one disposable Mode A site, invented public data, and no token argument/environment: connect the original bundle; create/accept one direct and one suggestion overlay; run `promote` without a P2-G proof; compare local output; manually review; run the printed P4-S reconnect command with the known invented owner; then strongly verify that pending returns no fresh promoted receipts and history names both authors. Delete blobs/site/users. One 1,200-second supervisor owns child/site cleanup and withholds both declared PASS lines until cleanup succeeds.

Run that lifecycle by amending P4-S's existing opt-in hosted branch, not by creating another harness:

```bash
AIUR_CONNECT_HOSTED=1 node scripts/connect.test.mjs --hosted
```

The combined hosted harness preserves P4-S's existing setup proof and prints exactly its `PASS  P4-S hosted connect lifecycle` line followed by `PASS  P4-R hosted export review reconnect lifecycle` after all local and remote cleanup.

```bash
set -euo pipefail
: "${P4R_BASE:?set P4R_BASE}"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-R.md scripts/connect.mjs scripts/connect.test.mjs
git diff --check "$P4R_BASE"...HEAD
git diff --check
test -z "$(git diff --name-only "$P4R_BASE"...HEAD | grep -Ev '^(scripts/connect(\.test)?\.mjs|docs/tickets/P4-R\.md)$' || true)"
issue_json="$(gh issue view 40 --json title,body)"
pointer="$(ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P4-R.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P4-R — Standalone-mode acceptance and promotion" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
unset issue_json pointer pointer_sha pointer_path
printf '%s\n' 'PASS  P4-R repository gates'
```

Expected: all commands exit 0; connect's original suite remains green; generated repository documents are byte-identical; issue #40 has only the prompt-prescribed full-commit permalink to this document and addressed bytes match; final output is exactly `PASS  P4-R repository gates`.

## Failure modes

- Local/remote manifest mismatch, stale inventory proof, corrupt receipt/history/HTML, or collision: no output and no remote mutation.
- Existing promotion/output lock, precheck output, or staging durability/rename failure: preserve inputs and any file/nonempty output; never steal a lock; remove only proven operation-owned staging/locks or retain their safe locators. An uncooperative empty directory created in the final window has the separately disclosed POSIX replacement boundary.
- CLI unavailable/unauthenticated/slow/overflow/nonzero: safe export failure, no provider text or credentials printed.
- Stored CLI login lacks administrator/deployer access to the selected site: safe generic export failure; do not fall back to a P2-G/document-owner guess.
- Either clock sample is malformed: no lock for a bad first sample; reverse-clean temporary state and both locks for a bad second sample; never create output or take a third sample.
- More than twelve current overlays: refuse rather than violate one-row-per-change attribution under twelve-row retention.
- Export succeeds but owner never reconnects: live site remains on overlays; the reviewable local bundle is the recovery artifact.
- Reconnect uploads the manifest but deploy fails: receipts are already stale while the prior HTML may still be live; P4-S's documented retry boundary applies, and neither tool claims distributed rollback.
- Mode A-to-B request: stop. `/d/<docId>` is the future migration redirect; no ordinary build may consume promotion rows.

## Settled decisions

- P4-R extends the one P4-S tool and adds no colliding command file.
- Promotion is export-first and never deploys. Authenticated site-administrator/deployer review plus explicit P4-S reconnect is the publication boundary; P2-G roles do not authorize this local CLI operation.
- The private Mode A manifest and local supplied manifest must match byte-for-byte before receipts are trusted.
- One same-history local lock is the exclusive-writer preflight; cross-machine concurrent promotion remains an explicit operator prohibition.
- Both cooperative locks contain the same exact bounded JSON line from the first clock sample; the second and only remaining sample timestamps the pure promotion after complete remote classification.
- One output-name lock plus the immediate absence recheck serializes cooperating publishers; Node's lack of portable directory no-replace is disclosed instead of hidden behind an absolute guarantee.
- Every promoted receipt gets one history row credited to the text author; twelve current receipts is the safe maximum per bundle.
- A CR-bearing or otherwise unrepresentable unified patch loses only public patch detail (`patch:""`, `clipped:true`); promoted HTML and full add/delete statistics retain the exact logical replacement.
- Stable promotion IDs share P2-E's seven-lowercase-hex namespace and collide fail-closed against all rows before retention.
- The connect tool stays Node-builtins-only; its private promotion converter twin is release-gated against P2-D rather than becoming another format authority.
- `history.json` is a local review artifact mirrored into HTML; P4-S deploys HTML plus the private edit manifest, not the public history sidecar.

## Assumptions and open questions

- **Assumption:** Netlify CLI `27.4.2` supports exact `blobs:list doc-state --prefix <prefix> --json` output `{blobs,directories}` with exact `{etag,key}` blob rows, plus `blobs:get doc-state <key> --output <path>`, under child-only `NETLIFY_SITE_ID`; the hosted gate reopens this pinned contract if help/output differs.
- **Assumption:** the standalone HTML and supplied `history.json` originated from the same P1-B/P2-E build and contain exactly one equivalent history payload.
- **Assumption:** local tools that share the target output honor `<output>.publish.lock`. An uncooperative creator in the final window can lose only an empty directory on POSIX; choosing a fresh output parent/name avoids that residual race.
- **Open question, non-blocking:** a document with more than twelve simultaneous current overlays needs selectable/batched promotion while preserving remaining receipt bases; that is a future CLI design, not silent attribution loss here.
- **Open question, non-blocking:** attaching a Git repository to the existing CLI-upload site without URL change remains provider-dependent; no Mode A-to-B conversion is promised.

## References

- `docs/research/00-integration-plan.md` §§1.4, 2.5, 2.8, 3.4, 4.7, and ruling 29 — Mode A overlay/export cost, receipts, history, apply, and promotion split.
- `docs/research/08-suggestions-and-editing-model.md` §§8.4, 9, 12, and 13 — overlay-only acceptance, authorship, apply seam, and unpromoted-loss boundary; promotion authority is superseded by P4-S's authenticated site-administrator/deployer boundary.
- `docs/research/05-inline-editing.md` §§6–9 — text conversion and source replacement background.
- `docs/research/09-sharing-and-roles.md` §§6 — standalone deployer/administrator warnings, refined by P4-S's exact CLI authority.
- `docs/tickets/P2-D.md`, `P2-E.md`, `P3-E.md`, `P4-N.md`, `P4-O.md`, and `P4-S.md` — canonical manifest, history, receipt, apply, acceptance, private-manifest, and single-tool contracts.
- [Netlify CLI Blobs command reference](https://cli.netlify.com/commands/blobs/) — authenticated list/get commands and JSON/output flags; checked 2026-09-03.
- [Netlify CLI v27.4.2 `blobs:list` source](https://github.com/netlify/cli/blob/v27.4.2/src/commands/blobs/blobs-list.ts) — pinned JSON wrapper shape; checked 2026-09-03.
- [Netlify CLI manual deploy documentation](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/#manual-deploys) — explicit production deploy behavior used only by the later P4-S reconnect; checked 2026-09-03.
