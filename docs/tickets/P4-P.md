# P4-P — The suggestion client

## Outcome

Readers with suggestion authority can propose a whole-block plaintext replacement, inspect all proposals in the shared panel, and perform only their permitted accept, reject, withdraw, or re-propose actions while direct edits keep their advisory claim and every apply remains bound to the exact effective-base hash.

## Context

P4-B creates the plaintext editor and pending overlay; P4-I reserves its focus/blur lifecycle for direct editing. P4-O owns immutable suggestion records and decisions, while P4-Q owns the only rail and panel. This ticket composes those surfaces in `edit.js` and adds suggestion-specific presentation in `edit.css`; it does not create another apply path or authority model.

The current block text is also the client's exact effective-base claim. The browser converts that plaintext through P2-D's frozen `toHtml()` twin and hashes those UTF-8 bytes; P4-O/P4-N compare the claim with authoritative manifest/receipt state before storing or applying anything.

## Scope

### In scope

- Amend the P4-B/P4-I editor with Suggest and Edit controls derived from a fully validated P3-H session.
- Compute an effective-base `{text,hash}` from current overlaid block state and submit P4-O's six-field create body.
- Fetch, completely validate, bound, and creation-order sort the P4-O suggestion list; render one open-count chip/rail marker per block and cards through P4-Q's registered panel extension.
- Accept, reject, withdraw, and re-propose through P4-O's exact action semantics; apply a successful acceptance receipt and dispatch exact `doc:overlay`.
- Add `baseHash` to direct-edit requests after P4-N so a sequential direct edit is checked against the visible overlay, without changing P4-I's claim lifecycle.
- Consume P3-F's exact server `edit.saved` hint by coalescing authoritative pending-overlay and suggestion-list refreshes, and use the same reconciliation on visible-page transitions with a 30-second throttle and no polling.
- Create one permanent, public-safe Node 22 runner for source-bound DOM/network/crypto, supervision, and rendered-browser integration.

### Out of scope

- Suggestion APIs, records, keys, authorization, event/audit append, notifications, retention, GitHub writes, Mode A promotion, or apply logic. P4-O/P4-N and later tickets own those.
- A second rail/panel, direct access to comments' private model, suggestion passage highlights, word/character diffs, merge/rebase, auto-accept, unapply, or mutating an existing suggestion.
- Realtime protocol expansion or suggestion-created/decided variants. P3-F already carries exact server `edit.saved`; P4-N/P4-O call the sole P4-H `notify()` helper after durable applied text and only that helper publishes it, while creation/rejection/withdrawal continue to use visibility refresh and server conflicts.
- Claiming while a suggestion draft is open, presence/cursors inside drafts, draft persistence, autosave, offline queue, or background polling.
- Structural/rich editing, new blocks, links, tables, code blocks, HTML input, or any block outside P2-D's `data-editable` policy.
- Amending comments assets, server files, packages, layout, generated documents, or any implementation file beyond the three paths owned below.

## Interface contract

### Activation, session, and shared prerequisites

P4-P remains inside P4-B's side-effect `templates/base/edit.js` and adds no public global or property. On the existing one valid lowercase `session` event, project only the exact recursively frozen P3-H fields `sub`, `canSuggest`, `canEdit`, and `canAccept` after validating the complete thirteen-field session. Do not read legacy `roles` for authority.

After `window.doc.edit.overlaysReady` settles, split activation into two closed prerequisite sets. Shared effective-base prerequisites are callable `crypto.subtle.digest`, `TextEncoder`, fetch, AbortController, the existing P4-B converter primitives, and unique connected `[data-editable][data-aid]` blocks satisfying P2-D's tag/aid rules. P4-P's direct-edit amendment always installs when that shared set is valid, computes the hash before P4-I opens a claim/editor, and always sends `baseHash`, even when suggestion presentation cannot initialize. If a block lacks a valid shared hashing/converter/current-base prerequisite, suppress its Edit and Suggest controls and start neither flow; readable prose, pending overlays, comments, and non-edit presentation remain.

Suggestion-only prerequisites are the exact P4-Q frozen `window.doc.rail` with callable `add/remove/place` and frozen `window.doc.panel` with callable `register/refresh/open` own data properties. If only those suggestion-panel prerequisites are absent, preserve the now-baseHash-aware P4-P direct editing and P4-I claims but create no Suggest control/fetch/listener. Register `window.doc.panel.register("suggestion", renderSuggestions)` exactly once; false/throw leaves suggestion UI absent while direct editing remains available. A forged session may change presentation only; every API enforces P2-G.

For each editable block, preserve the P4-B `div.doc-edit-controls` and P4-I `button.doc-edit-button`. When `canSuggest === true`, insert primary `button.doc-suggest-button` text `Suggest`; when `canEdit === true`, retain secondary `button.doc-edit-button` text `Edit`. A commenter sees Suggest only. An editor/owner sees Suggest then Edit. A viewer/none sees neither. P4-I hides only the Edit button during a peer claim, so Suggest remains usable and never publishes a claim.

### Effective-base text and hash

P4-B/P4-P keep each block's current editable plaintext synchronized after every initial or later receipt: write the validated receipt text to `block.dataset.md` immediately after controlled `toHtml()` application, whether the built block originally needed `data-md` or not. The private `editableText(block)` therefore returns this synchronized exact string; before any overlay it returns validated `data-md` when present and otherwise `textContent`. Require the text to pass `toMd(toHtml(text)) === text` and P4-O's safe 0–4,000-UTF-16-code-unit base-text rules before enabling Suggest.

For every new/re-proposed draft and every direct-edit entry, capture the base before the user changes the editor:

```js
const baseText = editableText(block);
const bytes = new TextEncoder().encode(toHtml(baseText));
const baseHash = lowerHex(await crypto.subtle.digest("SHA-256", bytes));
```

`lowerHex` emits exactly 64 lowercase hex characters. Hash failure leaves the prose unchanged and announces `Editing is unavailable for this block.` It never substitutes DOM `innerHTML`, a manifest guess, suggestion record hash, or an earlier block's hash.

After P4-N, direct Edit POSTs exact `{docId,aid,text,baseHash}` using the hash captured at editor entry. P4-N retains P4-B's absent-`baseHash` compatibility, but P4-P always supplies it. After P4-B validates/applies a direct 200 receipt, compute the new effective hash from its synchronized text and immediately mark retained suggestions on that aid superseded when their base differs, then repaint chips/panel; hash failure does not undo the successful edit and the next reconciliation repairs suggestion state. P4-I claim occurs only after base capture succeeds and direct focus starts; suggestion capture/focus dispatches no `doc:edit-state`, `edit.claim`, or `edit.release`.

### Suggestion list read

After successful renderer registration and initial overlays, call exact `GET /api/suggestions?doc=<docId>` with same-origin credentials, no-store, redirect error, Accept JSON, and one five-second abort. Consume the body as fatal UTF-8 through a stream ceiling of 67,108,864 bytes; lack of a bounded readable stream is failure. Only status 200 is parsed.

Require a dense plain array of 0–10,000 records. Validate every item as exactly thirteen fields: P4-O's twelve stored fields in their canonical order followed by final `state`, including prototypes/descriptors/nested actor, id/doc/aid/section/text/note/time/hash/base-text/version string bounds, lone-surrogate/control rules, converter round trip, and `state === "open" || state === "superseded"`. Require matching page doc id and a unique id/key tuple. Require the server creation order `(at,id,aid)` to be strictly increasing; do not locally repair invalid order. Records for an aid absent from the unique current editable-block index remain valid panel records but get no block chip/marker.

One suggestion read may be active. Calls while active set one dirty bit; after settlement, one trailing read runs if dirty. Each response has an increasing request generation; only the newest completely valid response replaces the last good model. Initial failure leaves suggestion controls available with safe status `Suggestions could not be loaded.` and no cards/counts. Later failure retains the last good model and reports the same fixed text. A valid 401/403 terminal response removes Suggest/action controls, clears suggestion markers/chips/model, marks the reconciliation lifecycle closed, aborts and drains any active pending/suggestion response reader, clears dirty/deferred state, and makes later realtime/visibility hints inert without affecting direct Edit presentation.

### Realtime and visibility reconciliation

P4-P refactors P4-B's existing private pending fetch/validation/application code into one private `refreshPending()` function; `window.doc.edit` remains exactly `{overlaysReady}` and no new public seam appears. `refreshPending()` issues the same exact five-second `GET /api/pending?doc=<docId>` as initial load, consumes and completely validates P3-E's bounded projection before mutation, and returns an always-settling `Promise<boolean>`. On success, process valid entries in DOM order. For each connected unique editable block whose current `data-md` differs, apply controlled `toHtml(receipt.text)`, synchronize `data-md`, and mark pending. Collect changed aids, sort/deduplicate them, and dispatch one or more exact P4-Q `doc:overlay` events in batches of at most 50. An absent entry never causes reversion to built text.

There is at most one live pending read. A reconciliation request during it sets one boolean dirty bit; after the active response reader is canceled/released and controller timer cleared in `finally`, at most one trailing read begins. Each read has a monotonic generation and can commit only when it is the current generation and lifecycle is open. If its receipt targets the currently active direct `contenteditable` block, do not replace that block or disturb selection; set one deferred bit. P4-I's idempotent finish sequence schedules one fresh pending read after blur/save/Escape when that bit is set. Suggestion drafts live in the panel, so their values/focus are preserved across model repaint; when a refreshed overlay hash differs from their captured baseHash, mark the draft stale and require explicit Try again rather than changing its proposal.

After valid session activation, install exactly one `doc:event` listener. Accept only P3-F's exact frozen ordinary flat object, key order, own enumerable non-writable/non-configurable data descriptors, no symbols/accessors, and values:

```js
Object.freeze({ source: "server", t: "edit.saved", aid, hash })
```

`aid` matches `^a[0-9a-f]{8}$`; `hash` is 64 lowercase hex. Reflection is wrapped and invokes no getter. A valid event starts one reconciliation cycle consisting of `refreshPending()` and the existing suggestion refresh concurrently; the event hash is only a validated change hint and never text/base authority. Repeated events coalesce through the two readers' dirty bits. Wrong source/name/order/shape/descriptor/scalar, `thread.changed`, client traffic, and any future `suggest.*` variant do nothing.

Install one `visibilitychange` listener in the same lifecycle. When the page becomes visible, request that same two-read reconciliation only if at least 30,000 ms have elapsed since the last visibility-triggered request. On `pagehide`, abort active reconciliation reads, cancel/release their body readers, clear timers and dirty/deferred bits, and set a suspended flag; do not clear last-good model or P4-I's separately owned release/bye behavior. On BFCache `pageshow` with `persisted === true`, clear suspended and request one reconciliation when the page is visible; ordinary pageshow does nothing. A terminal 401/403 closes permanently as above. Aborts, malformed/non-200 responses, and one half failing do not prevent the other half from committing valid state. There is no interval, retry loop, second event bus, or use of the event hash as content.

### Draft and create

Activating Suggest captures the exact base, calls `window.doc.panel.open(aid)`, and renders one draft at the top of that block's suggestion extension. It has a labelled proposed-text textarea prefilled with `baseText`, `maxLength=4000`, a labelled optional note textarea with `maxLength=280`, Save/Cancel native buttons, and an `aria-live=polite` status. Text is plaintext and enters only through value/text properties. Ctrl/Meta+Enter submits; Escape cancels and returns focus to the connected invoker. At most one suggestion draft and one suggestion mutation are active.

Creation is exact:

```http
POST /api/suggestions
Content-Type: application/json
Accept: application/json

{"docId":"4b7d2a","aid":"a31b7c9d2","text":"The cache key covers **every** declared input.","note":"This matches the public diagram.","baseHash":"3883a7bdb6a47fb141b722b65dc34319d7c47fa814dcf42dbfffbd1553a22630","baseText":"The cache key covers every declared input."}
```

Require proposed text 0–4,000 UTF-16 code units, note 0–280, P4-O lone-surrogate/control/newline rules, converter round trip, and `text !== baseText`. Equal text shows `Change the text before saving.` and sends no request. Use the common mutation fetch options below. On 201 validate the exact twelve-field stored record, match request doc/aid/text/note/base fields and `record.by.sub === session.sub`, reject an existing ID, and insert a fresh `{...record,state:"open"}` at its deterministic `(at,id,aid)` position, close the draft, repaint, and focus its card heading. Do not immediately GET.

On exact P4-O 409 `conflict`, require the top-level `current` object `{hash,text}` where hash is valid and text is either a valid base string or null. When text is a string, apply it as the safe current block overlay only if its hash equals local SHA-256/toHtml verification, synchronize `data-md`, mark P4-B's pending state, and dispatch `doc:overlay`; otherwise retain the block. Keep the user's proposed text/note, recompute a new base only after the user activates `Try again`, and never silently resubmit. A 409 `suggestion-limit` shows exact fixed text `Decide the open suggestions first.` Identifier collision and every other failure show `The suggestion was not saved.`

### Chips, marker, panel cards, and actions

For each unique block with `N > 0` records whose computed state is `open`, set exact decimal `data-suggest="N"`, add one noninteractive `span.doc-suggest-chip` after the controls with text `1 suggestion` or `<N> suggestions`, and register one P4-Q suggestion rail marker with the same label and a callback calling `window.doc.panel.open(aid)`. Remove prior opaque marker tokens before every repaint. Blocks with only superseded records have no attribute/chip/marker. Labels and records never use HTML insertion.

`renderSuggestions(extension, aidFilter)` filters by the optional aid, retains P4-O creation order, and appends one `article.doc-suggest-card` per record. Each has a heading; safe author name (fixed `Reader` when the validated snapshot name is empty) and `<time datetime>`; note when nonempty; state text `Open` or `Superseded`; a collapsed native `<details>` summary `Current text` containing full `baseText`; and labelled `Proposed text` containing full `text`. An empty current/proposed string renders fixed italic text `Empty block` in its own field, never an absent field. There is no diff. When an accepted overlay makes another local record's baseHash differ, repaint it as superseded immediately; the server remains authoritative on next GET.

Controls are presentation hints:

- `Accept` and `Reject` appear only for `state:"open" && canAccept === true`.
- `Withdraw` appears for any retained record with `record.by.sub === session.sub`, including superseded.
- `Re-propose` appears for `state:"superseded" && canSuggest === true`; it opens a new draft prefilled with that record's proposed text/note but captures fresh `baseText/baseHash` from the current block and creates a new immutable record/ID.

Accept/withdraw send empty reason. Reject first opens a required 1–280-safe-scalar plaintext reason control. Every action POST is exact:

```json
{"docId":"4b7d2a","aid":"a31b7c9d2","sugId":"s_m8x2k1_4f7a9c31","action":"accept","reason":""}
```

All mutation fetches use same-origin credentials, no-store, redirect error, JSON/Accept headers, one five-second abort, and no retry. Disable only the active card/draft. Validate 200 reject/withdraw as exact `{ok:true}`, then remove that record locally and repaint. Validate 200 accept as P4-N's exact `{receipt,pr}`; retain the request's already validated document context separately because a P3-E receipt has no `docId`, and require receipt aid/text/by/sugId/via fields to match the accepted record. Then apply `receipt.text` with `toHtml`, synchronize `data-md`, mark the P4-B pending state, remove the accepted record, mark every other record on that aid superseded unless its baseHash equals the new verified effective hash, dispatch one exact recursively frozen sorted `doc:overlay` detail, and repaint through P4-Q. `pr` is shown as `Pending repository review` when an integer and `Applied` when null; it is never made into a provider URL.

On action 401/403 apply terminal control removal. On 404 remove the vanished record locally and announce `This suggestion is no longer available.` On exact 409 base `conflict`, require P4-O's `{current:{hash,text}}`, verify/apply/synchronize/dispatch a non-null current text exactly as for create conflict, retain and mark the record superseded, and show `The block changed. Re-propose against the current text.` Another 409 or failure retains it and shows `The suggestion change was not saved.` No response message/body is rendered. After any action, focus the surviving card heading, next card heading, or panel heading in that order.

### CSS boundary

`edit.css` owns `.doc-suggest-*` controls, draft, chip, card, state, and block decoration plus `[data-suggest]`. One block chip represents the open count; state is textual as well as colored. Full current/proposed text wraps without horizontal page overflow. Focus outlines are at least two CSS pixels. Light/dark colors reach 4.5:1 for text; forced colors retains borders/outlines; reduced motion makes durations zero; print hides controls/drafts/chips/rail contributions while leaving proposed/current card text only if P3-C's panel is printable, otherwise the existing panel print rule wins.

## Files owned

- `templates/base/edit.js` — **amended**, created by P4-B and amended by P4-I; add suggestion lifecycle and effective-base hashes while preserving direct claim behavior.
- `templates/base/edit.css` — **amended**, created by P4-B; add only suggestion controls/cards/chips/block state.
- `scripts/test-p4-p.mjs` — **new**, created only by P4-P; permanent self-supervising DOM/network/crypto/browser regression runner.

No comment asset, API, library, presence/realtime file, package, layout, generated document, or other implementation path is owned.

## Dependencies

- **P4-B:** converter twin, pending overlays, direct editor/control DOM, five-second request behavior, receipt application, and frozen `overlaysReady`.
- **P4-I:** direct-only claim/release lifecycle and P3-G button/chip seam; suggestion drafts must never enter it.
- **P4-N:** one effective apply path, optional direct `baseHash`, extended receipt, Mode A/B result, and conflict current projection.
- **P4-O:** exact list/create/action routes, immutable record schemas/states, permissions, five-record serial cap, reaping, and responses.
- **P4-Q:** only rail/panel integration, Suggestions filter, block opening, and exact overlay reconciliation.
- **P4-C:** integrated converter-parity command guarding the amended P4-B twin after suggestion changes.
- **P3-F/P4-H:** exact frozen server `edit.saved` client projection and the one server fan-out path used by successful direct edits and accepted suggestions.
- **P3-H/P2-D:** exact session capability fields and editable/converter policy.

Maximum safe authoring: list/record validation, effective-base hashing, card DOM, and CSS can be developed concurrently against these frozen seams. Integration into shared `edit.js`, P4-I lifecycle regression, P4-Q browser integration, and generated/repository gates are serialized. The shared-file landing order is exactly P4-B, P4-I, P4-P for `edit.js`; P4-B then P4-P for `edit.css`; P4-A then P4-Q for comment assets. P4-Q must precede P4-P.

## Acceptance criteria

- [ ] Only the three owned implementation paths change; no new global appears and P4-B's frozen `window.doc.edit` surface is unchanged.
- [ ] GitHub issue #38 retains the exact title `P4-P — The suggestion client`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] Exact validated session capabilities produce Suggest-only, Suggest-plus-Edit, or no controls; browser state never authorizes an API.
- [ ] Every suggestion/re-proposal captures current synchronized overlay text and the SHA-256 of exact `toHtml(baseText)`; direct saves carry their entry baseHash.
- [ ] A successful local direct save immediately applies the receipt and supersedes/repaints retained proposals for that aid without depending on an echoed realtime event.
- [ ] List reads are same-origin, five-second, 64-MiB/10,000-record bounded, completely validated/ordered, last-good, coalesced, and visibility-throttled without polling.
- [ ] Only exact frozen server `edit.saved` events start reconciliation; pending and suggestion reads coalesce independently, settle within their deadlines, close readers/timers, and treat the event hash only as a hint.
- [ ] Reconciliation applies only completely validated current receipts, synchronizes `data-md`, batches exact overlay events, defers an active direct host without disturbing selection, preserves/marks a stale suggestion draft, and becomes inert after terminal authorization loss.
- [ ] Create sends exactly six fields and commits only a matched 201 record; base conflicts never auto-resubmit or silently discard the proposal.
- [ ] One open-count chip and one P4-Q marker exist per eligible block; cards are creation-ordered, show full collapsed current/full proposed text, state, note, author/time, and no diff.
- [ ] Accept/reject/withdraw/re-propose controls follow exact state/session/author hints and exact P4-O action bodies; re-propose creates a new ID against a fresh base.
- [ ] A valid accepted receipt updates text/data-md/pending presentation, supersedes other local bases, emits exact `doc:overlay`, and preserves P4-I's direct-only claims.
- [ ] Missing shared/crypto/session prerequisites, file/artifact mode, fetch/API failure, malformed data, disappeared/reaped records, and stale bases preserve readable prose and fixed safe status.
- [ ] AST, converter parity, deterministic runtime/browser, supervisor, accessibility/environment, scrub, build parity, and ownership gates pass.

## Test plan

Run syntax, converter parity, and pinned source boundaries after P4-I/P4-Q/P4-O/P4-N are integrated:

```bash
set -euo pipefail
npm --prefix templates/docbuild run check
node --check templates/base/edit.js
node --check scripts/test-p4-p.mjs
node scripts/check-inline-md.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
const source = readFileSync("templates/base/edit.js", "utf8");
const sf = ts.createSourceFile("edit.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
for (const text of ["/api/pending", "/api/suggestions", "/api/suggestion", "edit.saved", "baseHash", "baseText", "doc:overlay", 'register("suggestion"']) assert.equal(source.includes(text), true, text);
for (const denied of ["setInterval", "localStorage", "sessionStorage", "diffWords", "window.doc.suggestions"]) assert.equal(source.includes(denied), false, denied);
console.log("PASS  P4-P syntax, converter, and source boundaries");
NODE
```

Expected: compiler/syntax exit 0; parity prints `PASS inline converter parity: 12 rows`; the AST fixture prints exact `PASS  P4-P syntax, converter, and source boundaries`.

`scripts/test-p4-p.mjs` is a permanent Node 22 entry point with no public arguments. It evaluates the real integrated `edit.js` with closed invented DOM/network/crypto/realtime/API fixtures. It launches runtime and browser workers as direct children in separate mode-`0700` temporary roots, gives each 180 seconds, caps captured output, forwards HUP/INT/TERM, escalates TERM to KILL, reaps the child, proves its process group absent, and removes the guarded root before success. Its signal probes require 129/130/143 and its deadline probe requires 124. The browser worker installs only Playwright `1.55.0` under its temporary root, serves an invented loopback document, also exercises `file:`, and removes all install/browser/server state. It reads no credential or remote service.

Run exactly:

```bash
node scripts/test-p4-p.mjs
```

The runtime matrix covers all role/capability combinations; missing/malformed shared/crypto primitives; built/plain/data-md/pending bases; Unicode/mark/empty/4,000/4,001 and SHA failure; direct baseHash plus P4-I claim/release; suggestion no-claim; exact/malformed/0/10,000/10,001/64-MiB list, ordering/duplicate/generation/coalescing/last-good; every exact/malformed server/client `doc:event` shape; repeated edit-saved dirty-bit coalescing; concurrent pending/suggestion success and one-side failure; pending response generation/timeout/reader close; active-direct defer/finish and stale-draft preservation; pagehide abort, persisted pageshow, terminal close; 29,999/30,000-ms visibility; one/five/superseded counts; missing/duplicate/closed blocks; renderer registration failure; create match/mismatch/conflict/null-current/limit/abort; all action capability/state/author permutations; reject reason bounds; accept Mode A/B receipts; local supersession; 404/409/401/403/500; focus; and safe DOM. The browser matrix proves commenter/editor controls, direct peer-claim suppression with Suggest retained, keyboard draft/action flows, one/three chip and marker behavior, comment-before-suggestion order, accepted-overlay highlight repair, 320-CSS-pixel/200%-zoom wrapping, light/dark/reduced-motion/forced-colors/print rules, and zero suggestion fetch/UI on `file:`. Success has no stderr, exits `0`, and writes exactly:

```text
PASS  P4-P supervisor signals and deadline
PASS  P4-P base, list, draft, action, overlay, and claim matrix
PASS  P4-P rendered suggestion and direct-edit integration
PASS  P4-P fixture cleaned
```

Run repository gates:

```bash
set -euo pipefail
: "${P4P_BASE:?set P4P_BASE to the reviewed P4-C/P4-I/P4-N/P4-O/P4-Q predecessor commit}"
test "$(git rev-parse --verify "$P4P_BASE^{commit}")" = "$P4P_BASE"
scripts/scrub-check.sh docs/tickets/P4-P.md templates/base/edit.js templates/base/edit.css scripts/test-p4-p.mjs
npm --prefix templates/docbuild run check
node scripts/check-inline-md.mjs
templates/check-dist
git diff --check "$P4P_BASE"...HEAD
git diff --check
P4P_OWNED="$({ git diff --name-only "$P4P_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-P.md' || true)"
test "$P4P_OWNED" = $'scripts/test-p4-p.mjs\ntemplates/base/edit.css\ntemplates/base/edit.js'
unset P4P_OWNED
issue_json="$(gh issue view 38 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-P.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-P — The suggestion client"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-P repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #38 is updated: every command exits `0`; scrub emits no denial; converter parity and generated-output checks pass exactly; ownership, whitespace, title, exact-body, full-SHA, and byte-equality checks print nothing; the final line is exactly `PASS  P4-P repository and pointer gates`.

## Failure modes

- Crypto/converter/current-base unavailable: no suggestion/direct re-edit starts for that block; prose and read-only comments remain.
- Oversized/malformed/list failure: retain last good bounded model; never partially accept or locally reorder it.
- Base changes during draft/action: server 409 wins; keep proposed text, show fixed guidance, require explicit retry/re-propose against a newly captured base.
- Record reaped/decided elsewhere: 404 removes the stale card locally; no error body is shown.
- `edit.saved` is lost, duplicated, delayed, reordered, or arrives during a read: one dirty bit collapses work; server conflicts and the visible-page fallback remain authoritative.
- Pending refresh targets an active direct editor: leave its DOM/selection intact and rerun once that lifecycle finishes; a forced stale save still receives server 409.
- Accept succeeds but audit/notification/realtime does not: receipt response updates this page; later visibility reconciliation repairs other pages.
- P4-Q absent/fails: direct editing survives, but suggestion presentation does not initialize; no second panel is created.
- Deliberately not handled: transactional five-record concurrency, live suggestion events, persistent drafts, diffs, automatic rebases, offline actions, or PR merge.

## Settled decisions

- Suggestions are immutable proposals; accept is exclusive, while reject/withdraw delete and re-propose creates a new record.
- The effective-base hash, not a chip/claim/session/DOM guess, decides whether create/apply can proceed.
- Direct Edit is only for `canEdit`; Suggest is for `canSuggest`; suggestion focus never claims a block.
- comments.js owns the only rail/panel and overlay anchor reconciliation; edit.js owns suggestion data/cards/chips and overlay publication.
- One chip/marker counts open suggestions for a block; cards show open and superseded records in creation order with no diff.
- Realtime carries only applied-text `edit.saved`; it triggers authoritative pending/suggestion refetch and never supplies content or authority. Creation/rejection/withdrawal have no dedicated variant and rely on visibility refresh.

## Assumptions and open questions

- **Assumption:** P4-O's final create body is the six-field `{docId,aid,text,note,baseHash,baseText}` correction, and its base-conflict `current.text` may be null. P4-P and P4-O must be amended together if that frozen boundary changes.
- **Assumption:** P4-N accepts P4-P's direct-edit `baseHash` while preserving P4-B requests that omit it, and its acceptance result is exact `{receipt,pr}` with receipt `via:"suggestion"` and matching `sugId`.
- **Assumption:** P4-P may refactor P4-B's private pending loader into repeatable `refreshPending()` while preserving the only public property, the one-shot `overlaysReady` Promise. No P4-B surface change is required.
- **Open gap, non-blocking:** suggestion creation, rejection, and withdrawal have no separate P3-F realtime variants by design. Accepted text is covered by existing `edit.saved`; other suggestion-only state converges on visible-page refresh.
- **Open gap, non-blocking:** P4-O's non-paginated valid list can approach 10,000 large records. This client fails safely above 64 MiB but cannot present a server-valid larger response; pagination needs a jointly owned future API/client contract.
- **Assumption:** pinned Playwright installation is test-only and remains inside the runner's guarded temporary root; no package or lockfile amendment is required.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.5–1.6, 3.3–3.4, 4.5–4.7, and 5 — storage/authority, advisory locks, converter/hash, globals, ticket sequence, and exclusions.
- `docs/research/05-inline-editing.md` §§6–9 — plaintext/three-mark editing, conflicts, and attribution background.
- `docs/research/07-realtime-and-presence.md` §§7–9 and 12 — direct-edit-only soft lock and graceful transport degradation.
- `docs/research/08-suggestions-and-editing-model.md` §§3–12 and 15–17 — immutable lifecycle, effective base, shared UI, modes, attribution, anchor interaction, refresh, and test matrix; current P2-G/P3-B/P4-O contracts supersede its old authority/event payload drafts.
- `docs/tickets/P4-B.md`, `P4-I.md`, `P4-N.md`, `P4-O.md`, and `P4-Q.md` — exact editor, claim, apply, API, and shared-surface seams.
- `docs/tickets/P3-F.md` and `P4-H.md` — exact frozen `edit.saved` projection and successful-apply fan-out.
- [Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/), accessed 2026-09-03 — SHA-256 `SubtleCrypto.digest` byte contract.
- [Encoding Standard](https://encoding.spec.whatwg.org/), accessed 2026-09-03 — UTF-8 `TextEncoder` behavior.
