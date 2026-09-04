# P4-B — The edit write path

## Outcome

An authorized hosted reader can edit one build-approved prose block as plaintext with three inline marks; the server derives the source path, rejects a changed base, commits to that reader's document branch, maintains one open pull request, and publishes a bounded pending receipt that every reader applies as an overlay.

## Context

P2-D decides which blocks are editable and emits the only path/hash manifest. P3-E reads pending receipts and already fixes their validation and conditional one-slot semantics. This ticket supplies the initial Mode B apply path and its browser UI; P4-N later extracts the same machinery into `gitedit.mjs` and adds Mode A/suggestion idempotency, while P4-M adds final document-role enforcement.

The browser must apply pending overlays before comment anchors resolve. Script order alone cannot order two asynchronous reads, so this ticket publishes one bounded readiness promise and P4-Q consumes it before the comments client's first resolution.

## Scope

### In scope

- Create Fetch-style `POST /api/edit` for Mode B with origin/identity gates, exact body parsing, manifest-only path resolution, safe source lookup, block-hash conflict detection, one retry for a GitHub file-SHA race, deterministic per-author branch, one open pull request, and a P2-B conditional pending receipt.
- Read GitHub only through the current official refs, repository-contents, and pull-request REST endpoints with bounded responses and timeouts.
- Create the browser editor, pending-overlay loader, three-mark converter twin, `contenteditable="plaintext-only"` probe/fallback, direct-edit controls, status text, conflict recovery, and `doc:overlay` signal.
- Publish `window.doc.edit.overlaysReady`, an always-settling initial-overlay barrier for P4-Q.
- Preserve static/file/artifact behavior and server authority when client state is forged.
- Create one permanent, public-safe Node 22 runner for the handler, client, supervision, and rendered-browser matrices.

### Out of scope

- Suggestions, accept/reject/withdraw/re-propose, effective-base receipts, Mode A, promotion, and `gitedit.mjs` extraction. P4-N/P4-O/P4-P own them.
- Final document-role enforcement/audit/fan-out. P4-M adds `resolveRole()` checks and P4-H owns notification fan-out.
- A rich-text editor, links, tables, code blocks, diagrams, structural HTML, new blocks, path input, live DOM as source of truth, auto-merge, or PR merge.
- Octokit, a client token, a second identity probe, a normaliser copy, a runtime page dependency, or changes outside the four owned implementation files.

## Interface contract

### Function surface and request boundary

Create `netlify/functions/edit.mjs` with exactly these runtime exports:

```text
export function createEditHandler(dependencies)
export default async function handler(req)
export const config = { path: "/api/edit" }
```

The factory is the deterministic test seam; the default is one production instance. Its argument is a non-null ordinary object with exactly these own enumerable data properties and no accessors/symbols:

```js
{
  requireOrigin, identify,
  docState, editKey, read, mutate, upgrade, StoreError,
  scanBlocks, toMd, toHtml,
  fetch, now, sha256Hex, getEnv
}
```

Every value except `StoreError` is a function; `StoreError` is the exact P2-B constructor. `now()` returns one finite safe integer epoch millisecond sampled only for the receipt. `sha256Hex(value)` accepts a string, hashes its UTF-8 bytes, and synchronously returns exactly 64 lowercase hex. `getEnv(name)` accepts only one of `DOCS_REPO`, `DOCS_BASE_BRANCH`, `DOCS_GITHUB_TOKEN`, or `DOCS_BOT_EMAIL` and returns a string or `undefined`. `fetch` is the sole external-network function. The factory validates this complete shape synchronously and returns one named one-argument async handler; request fields cannot replace a dependency. Production statically imports `identify`/`requireOrigin` from `../lib/identity.mjs`, P2-B `docState`, `editKey`, `read`, `mutate`, `upgrade`, and `StoreError` from `../lib/store.mjs`, the compiled P1-D/P2-D pure functions from `../../templates/docbuild/dist/anchor-core.js` and `../../templates/docbuild/dist/inline_md.js`, and `createHash` from `node:crypto`. It constructs the production dependency object once, using `globalThis.fetch`, `Date.now`, and a narrow `process.env` reader, then constructs the default handler once. It adds no package and exposes no dependency object.

Only `POST` is supported. Unsupported methods, including `HEAD`, return exact `405 method-not-allowed` with `Allow: POST` before origin, identity, URL, body, environment, manifest, store, clock, crypto, or network work. For POST, `requireOrigin(req)` is the first request-dependent operation and a thrown Response is returned unchanged. Then call `identify(req)` once; null is `401 unauthenticated`; malformed/rejected identity is `500 invalid-state`. A usable Mode B identity is an exact P2-H object whose `sub` satisfies P2-G's subject grammar, `name` is a 0–200-code-unit string, `email` is nonempty, lowercase, already ASCII-trimmed, and satisfies P2-G's canonical mailbox grammar, and `isOrg` is boolean. This nonempty email is required because the Git commit must retain the reader as author; never replace it with a request or bot address.

Require the URL to have no query parameters. Accept only a JSON media type and a body of at most 65,536 UTF-8 bytes using P3-A's exact Content-Length grammar, stream/cancel/release, fatal decode, and single-parse rules. The parsed ordinary object has exactly `docId`, `aid`, and `text`, plus optional ignored `author`, `email`, and `name` fields whose values are never read:

```json
{
  "docId": "4b7d2a",
  "aid": "a31b7c9d2",
  "text": "The orchard index covers **every** declared basket."
}
```

`docId` matches `^[0-9a-f]{6}$`; `aid` matches `^a[0-9a-f]{8}$`; `text` is 0 through 4,000 UTF-16 code units and must satisfy both `toMd(toHtml(text)) === text` and `toHtml(toMd(toHtml(text))) === toHtml(text)`. Store the original text. Unknown keys and wrong types are `400 invalid-body`; missing/wrong media type is `415`; over-limit bytes is `413`.

P4-B's temporary server authorization is exact and narrow: require the proven P2-H identity's `isOrg === true`, otherwise `403 forbidden`, before manifest/store/GitHub work. This preserves the pre-sharing “org member may propose a repo-backed edit” behavior but is not the final role model. P4-M must replace this one temporary check with default `resolveRole()` and exact `canEdit === true`; P4-B must not invent its own document-role table.

All non-origin responses have `Cache-Control: private, no-store`; JSON adds `Content-Type: application/json; charset=utf-8`. Errors use P3-A's two-field `{error:{code,message}}` form, except 409 adds a sibling `current` that is a valid editable string or null:

| Status | Code | Message |
|---:|---|---|
| 400 | `invalid-body` | `Invalid request body` |
| 401 | `unauthenticated` | `Authentication required` |
| 403 | `forbidden` | `Document edit denied` |
| 404 | `not-found` | `Document or block not found` |
| 405 | `method-not-allowed` | `Method not allowed` |
| 409 | `conflict` | `The block changed since this document was built` |
| 413 | `payload-too-large` | `Request body exceeds 65536 bytes` |
| 415 | `unsupported-media-type` | `Content-Type must be application/json` |
| 500 | `invalid-state` | `Invalid edit state` |
| 502 | `repository-unavailable` | `Repository write unavailable` |
| 503 | `unavailable` | `Edit state unavailable` |

Errors/logs never expose environment values, repository/provider bodies, paths, refs, SHAs, actor fields, source/current text except the explicit bounded 409 field, receipts, or causes. The module emits no console output.

### Manifest and source locator

Build and cache the immutable sidecar index with the same root, traversal, symlink, file/aggregate byte, candidate, block-count, strict-UTF-8, shape, and failure rules specified for P3-E. P4-B duplicates no weaker shortcut: request input selects only a six-hex `docId`; it never becomes a path. Production root is `process.cwd()`. A missing/unreadable/over-capacity inventory is `503`; corrupt/ambiguous inventory is `500`; a valid index without the id is `404`.

The selected P2-D manifest supplies `instance` and `blocks[aid]`. Absence is 404. It is the sole source of:

```text
anchors path = <instance>/anchors.json
section path = <instance>/<row.file>
tag          = row.tag
base hash    = row.hash
```

No request field, slug, URL path, ref, source filename, ordinal, or DOM attribute may alter these values.

The source repository is exact environment `DOCS_REPO`, matching `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`. `DOCS_BASE_BRANCH` defaults to `main` and otherwise matches `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$` without `..`, `//`, `@{`, trailing `.`, or leading/trailing `/`. `DOCS_GITHUB_TOKEN` is a nonempty Functions-only secret. `DOCS_BOT_EMAIL` must pass P2-G's normalized email grammar. Invalid/missing production configuration is 500 before an external request.

Derive the author branch without exposing their email or raw subject:

```text
docedit/<docId>/<first-16-lowercase-hex-of-SHA-256(identity.sub UTF-8)>
```

Read/create that ref from the configured base. A concurrent create returning 422 is accepted only after a fresh GET proves the exact ref now exists. Never force-update/delete a ref.

Read `anchors.json` and the section at that branch through repository contents. Bound each HTTP call to 10 seconds, redirect `error`, response bytes to 2,097,152, and JSON parsing to fatal UTF-8. Require `type:"file"`, `encoding:"base64"`, a canonical 40-lowercase-hex `sha`, and canonical base64 content decoding to at most 1,048,576 bytes. Require source/anchors bytes to be valid UTF-8. Provider/status/shape failures are 502.

Validate `anchors.json` using P1-D's exact section `{ids,texts}` schema and require `aid` once in the manifest row's exact `section`. Split the source at its single exact `<!-- body -->` marker and call the shared `scanBlocks()` only on bytes after it. Let `index` be the aid's position in the anchor section's `ids`; select the scanner block at the same index. Require it exists, has `tag === manifest.blocks[aid].tag`, and its exact inner UTF-8 SHA-256 equals the manifest hash. This positional join is used only after the committed `anchors.json` names the aid; the hash is the write authority. Never search-and-replace arbitrary text.

If the selected current block is absent, wrong-tagged, or hash-mismatched, return 409 without writing. Set `current` only when `toMd(inner)` round-trips through `toHtml()` back to that exact inner; otherwise null. This deliberately refuses rather than guesses when unrebuilt source insertion/reorder makes the anchor index stale. The manifest currently lacks enough source-location information to safely promise a different block.

### Git commit, pull request, and receipt

Replace only `[innerStart, innerEnd)` with `toHtml(text)`. Preserve every other source byte. Update the section through `PUT /repos/{owner}/{repo}/contents/{encoded-path}` with exact branch, the just-read file SHA, base64 content, message `Edit block <aid> in document <docId>`, author `{name,email}` from the verified identity, and committer `{name:"Architecture Docs",email:DOCS_BOT_EMAIL}`. On GitHub 409, refetch anchors/source, repeat every locator/hash check, and retry the PUT once. Another 409 is the public 409; every other failed provider result is 502. Never loop.

After a successful commit, list open pull requests with exact `state=open`, configured `base`, derived `head=<owner>:<branch>`, `per_page=2`. Zero rows creates one with title `Inline edits for document <docId>`, the derived head/base, and body `Edits proposed from the hosted document. Each commit changes one build-approved block.` One valid row is reused. Two rows or malformed results are 502. The handler never merges, closes, labels, reviews, or comments on a pull request.

Before external writes, strongly `read()` `editKey(docId, aid)`. A current valid P3-E receipt with the same manifest `baseHash` is an existing applied overlay and returns 409 with `current` equal to that receipt's validated text; a stale receipt may be conditionally replaced. This makes a second P4-B save report the exact text already applied without consulting an eventually listed source. After commit/PR success, create this exact receipt with one timestamp sample:

```json
{
  "v": 1,
  "aid": "a31b7c9d2",
  "text": "The orchard index covers **every** declared basket.",
  "by": { "sub": "u_fixture_writer_31", "name": "Avery Quill", "email": "avery@example.com" },
  "at": "2026-09-03T17:04:11.201Z",
  "baseHash": "1111111111111111111111111111111111111111111111111111111111111111",
  "pr": 412,
  "via": "edit"
}
```

Write only through P2-B `mutate()` exactly as P3-E requires. The callback validates any current receipt. It replaces only a stale receipt; a fresh different receipt throws the private conflict sentinel; an exact same receipt returns null as an idempotent no-op. Revalidate the committed result. Store failure is 503 and never rolls back the Git commit.

Success is 200 with exactly `{"receipt":<P3-E direct projection>}` and no LF. Render from this response; do not immediately relist. The response contains no repository URL/ref/path/SHA/token.

### Browser editor and overlay barrier

Create dependency-free `templates/base/edit.js` and `edit.css` in P1-B's existing slots. `edit.js` is a side-effect module. It returns silently unless protocol is exact HTTP(S), exactly one valid doc-id meta exists, `window.doc` is an object with no existing `edit`, P1-D anchor functions exist, fetch/AbortController/CustomEvent/Range primitives exist, and unique `[data-editable][data-aid]` blocks have valid aids.

During evaluation, install exactly:

```js
window.doc.edit = Object.freeze({ overlaysReady });
```

`overlaysReady` is one Promise created during evaluation. It settles once, never rejects, and resolves to a recursively frozen `Object.freeze({ applied: Object.freeze([...]), available })`: `applied` is the sorted unique aids actually overlaid and `available` says whether one valid P3-E 200 response was consumed. Before a valid session it remains pending. On the first valid P3-H session event, fetch exact `GET /api/pending?doc=<docId>` with same-origin credentials, no-store, redirect error, Accept JSON, and one 5-second abort. Any error/non-200/malformed response resolves with empty applied/false and leaves built text. A valid response is completely validated against P3-E's projection; apply entries in DOM order with the private `toHtml()`, set each affected block's `data-md` to the receipt's exact plaintext so later edits read the overlay rather than stale built text, mark `.doc-edit-pending`, and resolve available true. After a nonempty commit, take the already sorted unique `applied` aids in order and synchronously dispatch consecutive `doc:overlay` events containing slices of 1 through 50 aids until none remain. Every event uses P4-Q's recursively frozen exact detail `{aids:Object.freeze([...])}`; no empty, duplicate, unsorted, or oversized batch is emitted.

P4-Q waits for this bounded promise before the first P3-C anchor resolution when the exact seam exists. Later overlay changes always dispatch the same event.

Keep these four top-level pure declarations, byte-compatible with P2-D, for P4-C extraction:

```js
function untag(input, tag, open, close) {}
function wrap(input, delimiter, tag) {}
function toMd(html) {}
function toHtml(text) {}
```

After overlays settle, a valid session with `canEdit === true` gets one `div.doc-edit-controls` immediately after each unique build-approved block, containing `button.doc-edit-button` text `Edit`. Other sessions get no controls. This is presentation only; P4-M is server authority.

Activating Edit captures exact prior `innerHTML`, prior presence/value of `data-md`, and editable text (`data-md` when present, otherwise `textContent`), replaces block content with that text, and sets `contenteditable="plaintext-only"` when the exact probe succeeds. Fallback sets `contenteditable="true"` and on paste prevents default, reads only `text/plain`, and inserts it through `document.execCommand("insertText", false, text)`. Enter alone remains text; Ctrl/Meta+Enter saves; Escape restores prior HTML and the prior `data-md` presence/value without a request; blur saves only when exact text changed. No trimming occurs; 0 and 4,000 code units are valid.

One block may save at a time. POST the exact body above with a five-second abort and no retry. Disable that block's controls while pending. On 200, retain the request's already validated document context separately because a P3-E receipt has no `docId`; validate receipt equality to submitted aid/text and safe actor/timestamp/pr fields, set block innerHTML to `toHtml(receipt.text)`, set `data-md` to exact `receipt.text`, mark pending, dispatch recursively frozen `doc:overlay` detail with a frozen one-aid array, and restore controls. On 409, validate `current`; when it is a string render `toHtml(current)` and set `data-md` to that exact string, otherwise restore prior HTML and prior `data-md`; mark conflict and show fixed text `This block changed. Review the current text and try again.` Every other failure restores prior HTML and prior `data-md` and fixed text `The edit was not saved.` No response/provider text becomes markup.

CSS owns only `.doc-edit-*` and `[data-editable].doc-edit-*` selectors. Controls have visible keyboard focus; editing/pending/conflict/saving states include text or accessible status in addition to color; narrow layouts do not overflow. `@media print` hides controls/status and removes transient edit decoration while leaving the applied overlay text. Reduced motion makes all edit transitions zero. Forced colors preserves outlines/borders.

## Files owned

- `netlify/functions/edit.mjs` — **new**, initial Mode B apply handler; P4-M and P4-N later amend it in their specified order.
- `templates/base/edit.js` — **new**, initial overlay/direct-edit client; P4-I then P4-P amend it.
- `templates/base/edit.css` — **new**, initial edit/overlay styles; P4-P later amends it.
- `scripts/test-p4-b.mjs` — **new**, created only by P4-B; permanent self-supervising handler/client/browser regression runner.

No manifest, anchor, store, access, identity, config, workflow, package, source section, generated file, or other ticket is owned.

## Dependencies

- **P2-D:** exact manifest membership/path/hash, compiled scanner/converter, `data-editable`/`data-md`, and 4,000-code-unit round-trip policy.
- **P3-E:** exact manifest inventory boundary, pending receipt schemas/projection, `GET /api/pending`, and required one-slot `mutate()` semantics.
- **P3-H:** exact recursively frozen document-aware session projection; the client validates it completely and reads only `canEdit` as a presentation hint.
- **P2-B/P2-H (transitive):** strong store/CAS/errors and final `{sub,email,name,isOrg}` identity. P4-B does not reopen them.
- **P4-M:** final release dependency replacing temporary `isOrg` with document-role `canEdit` and adding audit; it amends `edit.mjs` after P4-B.
- **P4-N:** later extracts this exact apply path, adds Mode A/effective-base/idempotent suggestion fields, and must preserve direct-edit behavior.
- **P4-Q:** consumes `overlaysReady` and `doc:overlay`; it is the ticket that makes asynchronous overlay-before-anchor ordering exact.
- **P4-C (downstream verification):** extracts the four private converter declarations and runs parity in CI; P4-B can land first, then P4-C makes that gate mandatory.

Safe parallelism: server and browser/CSS may be authored concurrently by one ticket owner because their source files are disjoint and the HTTP contract is frozen here. P4-A and P4-Q use different files and may proceed in their own serialized chain. Shared-file landing is exactly P4-B → P4-M → P4-N for `edit.mjs`, P4-B → P4-I → P4-P for `edit.js`, and P4-B → P4-P for `edit.css`; P4-Q must precede P4-P. P4-C can author its script concurrently but integrates after the P4-B converter exists. Dependency installs, build output, browser integration, and repository-wide gates are serialized by the phase integrator.

## Acceptance criteria

- [ ] Only four owned implementation files change; the server exposes exactly factory/default/config and the client publishes only frozen `window.doc.edit.overlaysReady`.
- [ ] GitHub issue #25 retains the exact title `P4-B — The edit write path`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] Method, origin, identity, temporary org gate, body, manifest, receipt, repository, and response operations short-circuit in the documented order.
- [ ] Request bytes/JSON/scalars and every provider response are bounded and validated; secrets, paths, provider text, actors, and source do not leak through errors/logs.
- [ ] The request cannot select a path/ref/repository/author. The sidecar plus committed anchors map select one scanner block, and the exact inner hash decides whether any write can occur.
- [ ] Same-index/tag/hash writes replace only one inner range; missing/changed/ambiguous state returns 409, with `current` only when safely representable.
- [ ] Branch creation is deterministic and race-safe without force; one file-SHA conflict retries once from complete hash checking; exactly zero or one open PR exists for the author/document branch.
- [ ] A fresh receipt is written only after commit/PR success through P2-B mutate; a prior fresh receipt refuses, stale state may replace, and post-commit receipt failure is reported without false rollback.
- [ ] Pending overlays apply for every authenticated reader before direct controls, synchronize exact plaintext in `data-md`, and the always-settling five-second barrier plus P4-Q gives overlay-before-anchor resolution.
- [ ] The editor supports exact plaintext-only detection, text-only paste fallback, three marks, empty/4,000 boundaries, Escape, blur, Ctrl/Meta+Enter, one in-flight save, exact 200 commit, 409 recovery, and quiet failure.
- [ ] File/data/blob/about/missing-session/missing-prerequisite/fetch-failure cases create no edit control/request/error and retain readable built text.
- [ ] P4-C parity, deterministic handler/client matrices, rendered accessibility/environment checks, scrub, typecheck, and byte-identical build all pass.

## Test plan

Run the source gates immediately:

```bash
set -euo pipefail

node --check netlify/functions/edit.mjs
node --check templates/base/edit.js
node --check scripts/test-p4-b.mjs
npm --prefix templates/docbuild run check
```

Expected: both syntax checks and TypeScript exit `0` with no diagnostics. After downstream P4-C is integrated, also run `node scripts/check-inline-md.mjs`; it prints exactly `PASS inline converter parity: 12 rows`.

`scripts/test-p4-b.mjs` is a permanent Node 22 entry point with no public arguments. It imports the real handler factory and evaluates the real browser module through a closed DOM/VM seam; it never starts a live provider request. It launches runtime and browser workers as direct children in separate mode-`0700` temporary roots, gives each 180 seconds, caps captured output, forwards HUP/INT/TERM, escalates TERM to KILL, reaps the child, proves the child process group absent, and removes the guarded root before success. Its signal probes require 129/130/143 and its deadline probe requires 124. The browser worker installs only Playwright `1.55.0` below its temporary root and serves an invented loopback document; it removes all install/browser/server state. No credential, real repository, remote provider, or private fixture is read.

Run exactly:

```bash
node scripts/test-p4-b.mjs
```

The handler matrix covers every method; origin Response identity; null/malformed/final identity; every allowed/forbidden body key/type and 65,535/65,536/65,537-byte boundary; 0/4,000/4,001 text; both round-trip results; manifest 404/500/503; configuration failures; branch present/absent/concurrent-create; anchors/source malformed; missing body marker/aid/index/tag; hash equal/mismatch and current string/null; PUT success/409-once/409-twice/other failure; zero/one/two PR rows; PR creation; prior missing/stale/fresh/exact receipt; mutate conflict/unavailable/malformed success; post-commit receipt failure; exact response headers/body; and zero forbidden request/body/provider/log access after every short circuit. The browser matrix covers five protocols; absent/malformed prerequisites; viewer/commenter/editor sessions; pending 200/401/403/500/timeout/malformed; deterministic overlay order and exact 1/50/51/1000-aid event batching; barrier settlement; converter marks; native/fallback paste; Escape/unchanged blur/changed blur/Ctrl/Meta+Enter; empty/4,000/4,001; one in-flight save; exact request; 200, 409 string/null, and other failures; safe hostile text; `doc:overlay`; focus-visible, reduced-motion, forced-colors, narrow, and print. Success has no stderr, exits `0`, and writes exactly:

```text
PASS P4-B supervisor signals and deadline
PASS P4-B server request, locator, GitHub, conflict, and receipt matrix
PASS P4-B overlay barrier, plaintext editor, save, conflict, and degradation matrix
PASS P4-B fixture cleaned
```

Run P4-B's final repository gates before downstream P4-C is integrated:

```bash
set -euo pipefail
: "${P4B_BASE:?set P4B_BASE to the reviewed P2-D/P3-E predecessor commit}"
test "$(git rev-parse --verify "$P4B_BASE^{commit}")" = "$P4B_BASE"

scripts/scrub-check.sh docs/tickets/P4-B.md netlify/functions/edit.mjs templates/base/edit.js templates/base/edit.css scripts/test-p4-b.mjs
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check "$P4B_BASE"...HEAD
git diff --check
P4B_OWNED="$({ git diff --name-only "$P4B_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-B.md' || true)"
test "$P4B_OWNED" = $'netlify/functions/edit.mjs\nscripts/test-p4-b.mjs\ntemplates/base/edit.css\ntemplates/base/edit.js'
unset P4B_OWNED
issue_json="$(gh issue view 25 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-B.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-B — The edit write path"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-B repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #25 is updated: all commands exit `0`; scrub emits no denial; typecheck emits no diagnostic; `check-dist` reports byte-identical committed documents; whitespace, ownership, title, exact-body, full-SHA, and byte-equality assertions emit nothing; the final line is exactly `PASS  P4-B repository and pointer gates`. P4-C subsequently owns and runs the parity gate without changing P4-B source.

## Failure modes

- A changed/moved/deleted/unrepresentable source block returns 409 and is never guessed or overwritten.
- GitHub unavailable/malformed/slow returns 502. One file-SHA race retries once; no other provider act loops.
- Receipt failure after commit leaves a reviewable branch/PR commit but no overlay. The response is 503; the system does not claim rollback.
- Two writers can both commit before the receipt CAS chooses one; the loser receives 409/503 and can leave an extra reviewable branch commit. No cross-system transaction exists.
- Pending read failure leaves built text and settles the barrier false; edit controls may still appear only for a valid `canEdit` session.
- Deliberately not handled: source insertion/reorder recovery beyond the committed anchor index plus hash, rich markup, auto-merge, delete/revert, Mode A, and suggestion acceptance.

## Settled decisions

- `data-aid` is the only block identity; the P2-D manifest is the only file/path authority; exact block hash is conflict authority.
- Mode B writes git first, then the pending receipt. A crash may lose the overlay/audit, not the source commit.
- One deterministic branch and one open PR exist per text author per document; the handler never merges.
- The page uses plaintext with only code/strong/em marks and zero runtime dependencies.
- Pending state is a bounded receipt, not the durable source; list consistency is not a write acknowledgement.
- Final authorization comes from P2-G in P4-M; browser state never authorizes.

## Assumptions and open questions

- **Assumption:** until P4-M lands, `isOrg === true` is the temporary Mode B write gate. P4-B and P4-M should be treated as one release train.
- **Assumption:** P4-Q may add the exact wait on `window.doc.edit.overlaysReady` without making P4-B a graph dependency; the seam is optional and bounded.
- **Open gap:** the manifest contains no source offset and source fragments do not persist `data-aid`. The safe anchor-index-plus-hash join here can refuse harmless insertions/reorders and cannot always return current text. Fixing that requires an explicit P1-D/P2-D contract change, not a guess inside this ticket.
- **Assumption:** pinned Playwright installation is test-only and remains inside the runner's guarded temporary root; no package or lockfile amendment is required.

## References

- `docs/research/00-integration-plan.md` §§1.1–1.5, 2.5–2.7, 3.4, 4.6–4.7, and 5 — state, modes, authority, manifests, hash checks, sequencing, and exclusions.
- `docs/research/05-inline-editing.md` §§6–9 and 11 — plaintext editor, original Mode B GitHub flow, conflict order, attribution, and twin-check intent; old identity/path/ordinal/Rust details are superseded.
- `docs/tickets/P1-D.md` — browser/Node scanner and committed anchor mapping.
- `docs/tickets/P2-D.md` — exact edit manifest, converter, editable policy, and fixture.
- `docs/tickets/P3-E.md` — manifest inventory, pending receipt schemas/projection, and conditional one-slot write contract.
- GitHub REST refs, repository contents, and pull-request docs, accessed 2026-09-03: https://docs.github.com/en/rest/git/refs , https://docs.github.com/en/rest/repos/contents , https://docs.github.com/en/rest/pulls/pulls
- HTML Standard editing APIs, accessed 2026-09-03: https://html.spec.whatwg.org/multipage/interaction.html#editing-apis
