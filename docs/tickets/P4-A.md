# P4-A — The comment write path

## Outcome

An authorized reader can create one safely anchored comment or unanchored discussion, reply to a thread, and resolve or reopen an eligible thread from the existing comments panel without weakening server authority or silently clamping a multi-block selection.

## Context

P3-C already owns the validated thread model, quote locator, non-mutating highlights, rail, panel, filters, refresh lifecycle, and frozen `window.doc.comments.refresh()` seam. P3-A already owns every write route and response schema. This ticket adds only the browser write experience; P4-M later enforces document roles and thread-control rules on the server.

Selection capture is the inverse of P3-C's exact `textMap()` boundary map. A draft records one stable block id plus a normalized quote and context; it never writes a DOM path, source path, ordinal, or selection spanning more than one block.

## Scope

### In scope

- Amend P3-C's private comments controller with one selection tooltip, anchored-comment and discussion drafts, reply boxes, and resolve/reopen controls.
- Construct the exact P3-A create, reply, and status bodies and validate each returned full thread before committing it to the existing model.
- Refuse collapsed, ambiguous, invalid, and multi-block selections with deterministic presentation and no write request.
- Derive create authority hints from the one valid P3-H session while treating P4-M as final authority.
- Preserve P3-C's filters, panel focus rules, four anchor states, refresh coalescing, truncation, and non-mutating prose.
- Create one permanent, public-safe Node 22 runner for the deterministic DOM and rendered-browser matrices.

### Out of scope

- Any server, storage, identity, access, audit, realtime, notification, or schema change. P3-A, P4-M, P3-F, and P4-H own those boundaries.
- Editing or deleting comments, changing a thread title, moving an anchor, reacting with emoji, mentioning a user, attachments, offline drafts, autosave, or optimistic writes.
- Clamping a cross-block range to one block, fuzzy selection capture, rich-text input, HTML bodies, Markdown rendering, or wrapping prose in a node.
- Publishing `window.doc.rail` or `window.doc.panel`, adding a Suggestions filter, or handling `doc:overlay`; P4-Q amends this same file after P4-A.
- Amending CSS, static markup, generated HTML, packages, or any implementation file other than the two paths owned below.

## Interface contract

### Session-derived presentation

P4-A retains P3-C's one lowercase `session` listener and stores only this freshly projected private state after validating P3-H's exact recursively frozen session shape:

```js
{ sub, role, canComment }
```

`sub` matches P2-H's subject grammar, `role` is `owner`, `editor`, `commenter`, `viewer`, or `none`, and `canComment` is boolean. A malformed event leaves the module read-only. `canComment === true` enables create and reply presentation. Thread status presentation is:

| Session | Resolve/reopen button |
|---|---|
| `owner` or `editor` | every retained thread |
| `commenter` | only a thread whose `thread.author.sub === session.sub` |
| `viewer`, `none`, or invalid/missing session | none |

This is a display rule, not authorization. Every write can still return P3-A/P4-M `401` or `403`. That response alone takes the permission-loss path: set a private page-lifetime `writesDenied` flag, close the active draft and restore focus to its connected invoker, repaint immediately with every create/reply/status control suppressed regardless of the cached session hint, call the existing comments `refresh()` exactly once, and announce only `You no longer have permission to change comments.` The flag is never cleared in place; a full navigation and a newly validated session are required to expose write controls again. A forged event never changes server behavior.

Creating a thread additionally requires exactly one `#doc-history` element with a valid `data-head` matching `^[0-9a-f]{7}$`; that value is the create request's `docVersion`. Missing or ambiguous version metadata suppresses create controls and leaves read/reply/status behavior intact.

### Selection capture and tooltip

Listen to `mouseup` and a 250 ms trailing `selectionchange`; Ctrl/Meta+Alt+M performs the same capture immediately. At most one timer exists and cleanup clears it. Capture only `document.getSelection()` with exactly one non-collapsed range whose start and end boundary containers are connected descendants of this document. Resolve an element boundary to itself when it is an element and otherwise to its parent element. Both boundaries must have the same unique closest `[data-aid]` element, whose lowercase tag occurs in P1-D `window.doc.anchor.BLOCK`, whose aid matches `^a[0-9a-f]{8}$`, and which belongs to exactly one closest `section[id]` whose id satisfies P3-A's section grammar.

If valid, build P3-C's exact `textMap(block)` and translate the DOM range to a normalized half-open interval by selecting all map spans fully contained by, or intersecting, the range. The selected indices must be one nonempty contiguous run. Set:

```js
anchor = {
  block: aid,
  exact: map.text.slice(start, end),
  prefix: map.text.slice(Math.max(0, start - 32), start),
  suffix: map.text.slice(end, Math.min(map.text.length, end + 32)),
  start
}
```

Require `exact.length` from 1 through 1,000 UTF-16 code units and the complete anchor to satisfy P3-A's validator. Never trim or independently normalize it: `textMap()` already used P1-D's `norm`. A range intersecting zero spans, a partial surrogate boundary, an invalid block/section, or duplicate aid suppresses the tooltip.

When the two boundaries resolve to different valid blocks, show one native fixed-position status/button host next to the range rectangle with exact text `Select inside one paragraph`; it contains no create action and disappears on the next selection change, Escape, scroll, resize, or after 3 seconds. The range is never clamped. A valid capture shows one `Comment` button positioned from `range.getBoundingClientRect()` with viewport clamping; because this ticket owns no stylesheet, the host uses only native button/status semantics and the minimum positioning properties assigned by this module. It never changes a prose node. Activating it opens the existing panel and draft, then removes the tooltip.

### Drafts and request bodies

All forms are constructed with DOM APIs. User strings enter only through value/text properties. Textareas use `maxLength = 8000`; discussion titles use `maxLength = 200`. Bodies/titles are submitted exactly as typed and are valid only when P3-A's canonical validators accept them. Ctrl/Meta+Enter submits a valid focused form; Escape closes the draft and returns focus to its connected invoker. Only one draft and one write request exist at a time.

The unanchored discussion form also has one required native section select. Build its options once per opening from exact direct children matching `main > section[id]`, in document order; every id must satisfy P3-A's section grammar and be unique or the discussion action remains unavailable. The visible option label is the nonempty trimmed text of that section's unique `.sec-label`, otherwise its already validated id, inserted as text. Default to the panel's valid block-filter section when one exists, then the valid section named by `location.hash`, then the first option. Submit the selected id unchanged. Anchored comments never show this select and always use their captured block's closest section id.

The anchored draft POST is exact:

```http
POST /api/threads?doc=4b7d2a
Content-Type: application/json
Accept: application/json

{"kind":"comment","section":"architecture","anchor":{"block":"a31b7c9d2","exact":"cache key","prefix":"The ","suffix":" covers every input","start":4},"docVersion":"7aaca51","body":"Could we name the invalidation case?"}
```

The panel provides a separate `Start discussion` action, enabled by the same comment capability but requiring no selection:

```json
{"kind":"discussion","section":"architecture","anchor":null,"title":"Clarify the rollout boundary","docVersion":"7aaca51","body":"Should the first release keep the old reader available?"}
```

The exact reply and state bodies are:

```http
POST /api/threads/4b7d2a/t_m8x2k1_4f7a9c31
{"body":"The fixture now covers that case."}

PATCH /api/threads/4b7d2a/t_m8x2k1_4f7a9c31
{"status":"resolved"}

PATCH /api/threads/4b7d2a/t_m8x2k1_4f7a9c31
{"status":"open"}
```

Create uses the query route; reply/status use the path route and no query. Construct both from `location.href`, require same origin, and call fetch with `mode:"same-origin"`, `credentials:"same-origin"`, `cache:"no-store"`, `redirect:"error"`, exact JSON and Accept headers, and one five-second `AbortController` deadline. There is no retry. Disable the initiating form/control until settlement.

Only P3-A's exact success is accepted: status 201 for create and 200 for reply/status, with a plain exact envelope `{ "thread": <complete-record> }`. Validate that record through the same P3-C validator and require `thread.docId === docId`. Create additionally matches requested kind/section/anchor/title/docVersion and first-comment body; reply matches the path thread id and has a final comment whose body equals the submitted body and author subject equals the validated session subject; status matches the path thread id and requested status. Concurrently added valid comments may precede the final reply and are retained. Then replace or insert the record in the private model and run one ordinary P3-C repaint. This response is the acknowledgement; do not immediately list. A 401 or 403 follows only the permission-loss path above. Invalid success, abort, network failure, or any other status keeps the last good model, restores the form, and announces only `The comment change was not saved.` Response bodies and server messages never become markup or status text.

### Model and accessibility preservation

New controls are native buttons/forms/labels/textareas inserted into P3-C's existing panel. Each thread card owns at most one reply form and one status button. Resolved threads show `Reopen`; open threads show `Resolve`. Disabled/pending status is textual and uses `aria-busy` on the submitting form/card. Successful creation focuses the new thread heading; reply focuses the appended comment; state change retains focus on the same thread heading. Existing close/Escape/filter/marker focus behavior remains unchanged.

P4-A may refactor P3-C private functions so the write path can call thread validation, model replacement, repaint, `textMap()`, and panel opening. It must not add a public method or mutate the frozen `window.doc.comments` object. P4-Q relies only on those private named responsibilities and the DOM contracts documented here, not on a new global.

## Files owned

- `templates/base/comments.js` — **amended**, created by P3-C; add only comment/discussion write presentation and selection capture.
- `scripts/test-p4-a.mjs` — **new**, created only by P4-A; permanent self-supervising DOM/browser regression runner.

No stylesheet, server function, layout, package, workflow, generated document, or other source is owned.

## Dependencies

- **P3-A:** exact create/reply/status routes, body limits, thread/comment/anchor schemas, full-thread success projection, safe error envelope, and server mutation semantics.
- **P3-C:** validated private model, `textMap()`, locator, rail/panel, filters, focus, repaint, and frozen refresh seam.
- **P1-D:** exact `window.doc.anchor.BLOCK`, `norm()`, stable-aid grammar, and text-map normalization boundary consumed directly by selection capture.
- **P3-H:** exact session projection containing `sub`, `role`, and `canComment`; the client uses it only for presentation.
- **P4-M (release dependency):** server `canComment` and `threadControl` enforcement. P4-A can be authored against P3-A, but its write UI is not a complete release until P4-M lands.
- **P4-Q (downstream):** amends the same file after P4-A to publish shared rail/panel interfaces and reconcile anchors after overlays.

Maximum safe authoring: pure selection/body construction, panel-control rendering, and the new runner can be developed concurrently behind the frozen seams after P3-C is integrated. Integration into `comments.js`, DOM/browser fixtures, generated builds, and repository gates are serialized. P4-A may overlap the disjoint P4-B lane; P4-I starts only after P4-B is integrated and never authors `edit.js` concurrently with P4-B. The comment lane is exactly P4-A then P4-Q.

## Acceptance criteria

- [ ] Only the two owned implementation paths change; `window.doc.comments` remains the exact frozen `{refresh}` surface.
- [ ] GitHub issue #24 retains the exact title `P4-A — The comment write path`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] Valid one-block mouse and keyboard selection creates the exact normalized anchor/context/start from P3-C's map; invalid or multi-block selection sends no request and is never clamped.
- [ ] Comment/discussion creation uses one valid seven-hex history head and exact P3-A bodies; the discussion section comes from the bounded built-section select, and a missing/ambiguous head or section inventory suppresses only the affected create action.
- [ ] Replies and resolve/reopen use the exact path/body contract and display controls only under the documented session hints.
- [ ] Every write has same-origin credentials, JSON/Accept headers, one five-second deadline, no retry, and at most one in-flight mutation.
- [ ] Exact create 201 and reply/status 200 `{thread}` envelopes are completely validated and action-matched before the record replaces/inserts model state; the client does not depend on immediate list consistency.
- [ ] Authorization loss and ordinary failure retain the last good model, use fixed safe text, restore an actionable state, and inject no response/user HTML.
- [ ] Draft keyboard/focus behavior, P3-C panel navigation, filters, highlights, four location states, refresh, and static/file degradation remain intact.
- [ ] AST, deterministic DOM runtime, rendered browser/accessibility, process-supervision, scrub, generated-output, and ownership gates below pass.

## Test plan

Run syntax and a pinned AST boundary gate from the repository root after P3-C is integrated:

```bash
set -euo pipefail
npm --prefix templates/docbuild run check
node --check templates/base/comments.js
node --check scripts/test-p4-a.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
const file = "templates/base/comments.js";
const source = readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
for (const denied of ["innerHTML =", "outerHTML", "localStorage", "sessionStorage", "indexedDB", "navigator.sendBeacon", "window.doc.comments = Object.freeze({ refresh,"]) {
  assert.equal(source.includes(denied), false, denied);
}
for (const required of ["/api/threads", "Select inside one paragraph", "Start discussion", "docVersion", "AbortController"]) assert.equal(source.includes(required), true, required);
console.log("PASS  P4-A syntax and AST boundaries");
NODE
```

Expected: TypeScript and syntax exit 0 and the only fixture line is `PASS  P4-A syntax and AST boundaries`.

`scripts/test-p4-a.mjs` is a permanent Node 22 entry point with no public arguments. It evaluates the real `comments.js` and uses only closed, invented selection/range/fetch/session/DOM fixtures. It launches its runtime and browser workers as direct children in fresh mode-`0700` temporary roots, gives each 180 seconds, caps captured output, forwards HUP/INT/TERM, escalates TERM to KILL, reaps the child, proves the child process group absent, and removes the guarded root before success. Its signal self-probes require 129/130/143 and its deadline probe requires 124. The browser worker installs only pinned Playwright `1.55.0` beneath its temporary root, serves only an invented loopback document, covers HTTP and `file:` modes, and removes browser/install state. User/provider examples are invented and no credential or remote service is read.

Run exactly:

```bash
node scripts/test-p4-a.mjs
```

The runtime matrix covers exact first/middle/last/full-block and cross-text-node selections; collapsed/zero-span/partial-surrogate/1,000/1,001/multi-block/duplicate-aid cases; mouse/debounce/shortcut/Escape/scroll/resize/three-second lifecycle; all four session roles and own/other author; missing/invalid/duplicate history head; 0/8,000/8,001 bodies and 0/200/201 titles; exact three routes and bodies; success/action mismatch/malformed/401/403/409/500/abort/reject; focus restoration; one-in-flight rule; and preserved P3-C refresh/locate/filter/highlight behavior. The browser matrix selects across nested `strong`/`code` text nodes, performs writes against the fake origin, checks keyboard-only use, 200% zoom, narrow layout, light/dark/forced colors, no prose mutation, and zero requests/UI mutation under `file:`. Success has no stderr, exits `0`, and writes exactly:

```text
PASS  P4-A supervisor signals and deadline
PASS  P4-A selection, write, model, and focus matrix
PASS  P4-A rendered comment write behavior
PASS  P4-A fixture cleaned
```

Run repository gates:

```bash
set -euo pipefail
: "${P4A_BASE:?set P4A_BASE to the reviewed P3-C predecessor commit}"
test "$(git rev-parse --verify "$P4A_BASE^{commit}")" = "$P4A_BASE"
scripts/scrub-check.sh docs/tickets/P4-A.md templates/base/comments.js scripts/test-p4-a.mjs
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check "$P4A_BASE"...HEAD
git diff --check
P4A_OWNED="$({ git diff --name-only "$P4A_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-A.md' || true)"
test "$P4A_OWNED" = $'scripts/test-p4-a.mjs\ntemplates/base/comments.js'
unset P4A_OWNED
issue_json="$(gh issue view 24 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-A.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-A — The comment write path"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-A repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #24 is updated: every command exits `0`; scrub emits no denial; `check-dist` proves byte-identical committed documents; ownership, whitespace, title, exact-body, full-SHA, and byte-equality checks print nothing; the final line is exactly `PASS  P4-A repository and pointer gates`.

## Failure modes

- Invalid/missing selection, metadata, anchor prerequisites, or session: no write affordance/request; existing read-only comments remain usable.
- Multi-block selection: fixed refusal, never clamped; the user's document selection remains untouched.
- Network/abort/non-success other than 401/403, or malformed nominal success: retain the last good model and draft; use the fixed ordinary failure text and never retry blindly. Create 201 and reply/status 200 are the only nominal success statuses.
- Authorization changed after render: server denial wins; the private page-lifetime denial flag closes the draft, repaints read-only before one refresh, and cannot be reset by stale session state.
- Concurrent thread mutation: P3-A's current response/409 behavior wins; no local merge or fabricated success.
- Deliberately not handled: offline queue, comment edit/delete, rich text, persisted drafts, exact cross-device focus state, or transactional audit/fan-out.

## Settled decisions

- Stable aid plus normalized text quote is the anchor; paths, ordinals, selectors, and DOM mutation are rejected.
- A selection must remain inside one build-approved block; cross-block input is refused, not clamped.
- The browser presents capability hints, but P4-M/P2-G server checks authorize every mutation.
- Successful POST/PATCH response, not an immediate list, acknowledges a write.
- Comment bodies remain plaintext; user/provider strings enter the DOM only through safe text/value properties.
- P4-Q, not this ticket, owns shared rail/panel publication and overlay reconciliation.

## Assumptions and open questions

- **Assumption:** P3-C keeps reusable private entry points for complete thread validation, `textMap()`, model replacement, repaint, and panel opening; P4-A may refactor them without changing the public seam.
- **Assumption:** native controls plus module-assigned fixed-position geometry are sufficient for the transient selection tooltip because this ticket was deliberately assigned no CSS ownership. P4-Q may later style shared suggestion/comment surface classes, but P4-A cannot require it to function.
- **Open question, non-blocking:** P3-A stores `docVersion` on the thread at creation and reply/status bodies do not carry it. A stale rendered head can therefore be recorded on create; the stable quote/hash model, not this field, decides later anchor location.
- **Assumption:** pinned Playwright installation is test-only and remains inside the runner's guarded temporary root; no package or lockfile amendment is required.

## References

- `docs/research/00-integration-plan.md` §§1.2, 2.3, 3.2, 4.5–4.7, and 5 — thread state, canonical anchor, mutation order, file ownership, and exclusions.
- `docs/research/04-comments-and-discussion.md` §§8–11 — selection, panel write interactions, error behavior, and testing background; its author-edit proposal is superseded by the current plan/ticket split.
- `docs/tickets/P1-D.md` — exact stable aid, block policy, and shared `norm()`/scanner surface.
- `docs/tickets/P3-A.md` — authoritative route, body, response, validation, and error contracts.
- `docs/tickets/P3-C.md` — current read model, text mapping, quote resolution, panel, rail, and refresh behavior.
- `docs/tickets/P3-H.md` and `docs/tickets/P4-M.md` — session presentation and final mutation authority.
- [Selection API](https://w3c.github.io/selection-api/), accessed 2026-09-03 — one document selection and range model.
- [DOM Standard](https://dom.spec.whatwg.org/), accessed 2026-09-03 — `Range` boundary points and DOM event/node primitives.
