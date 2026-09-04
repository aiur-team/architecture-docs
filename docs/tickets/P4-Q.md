# P4-Q — The shared client surface

## Outcome

The comments client publishes one bounded rail and panel integration surface for suggestions, adds a Suggestions view without duplicating UI infrastructure, and re-resolves affected comment anchors whenever an applied overlay replaces block contents.

## Context

P3-C owns the only margin rail, comments panel, anchor locator, and live `Range` objects; P4-A adds writes inside that same panel. P4-P must display whole-block suggestions without creating another rail or panel. Because an edit overlay replaces a block's child nodes, this ticket also orders initial overlays before first anchor resolution and repairs invalidated ranges after later overlays.

The interface is intentionally small. Comments remain internal to `comments.js`; a suggestion client can contribute one marker per block and render cards into a supplied empty mount, but cannot take over comment state, focus management, placement, or panel structure.

## Scope

### In scope

- Amend P4-A's `comments.js` to publish exact frozen `window.doc.rail` and `window.doc.panel` objects from the existing private controllers.
- Refactor existing comment markers through the same placement registry without changing P3-C's marker semantics.
- Add one Suggestions kind filter and one external suggestion-renderer registration point.
- Wait for P4-B's optional initial overlay barrier before the first thread anchor resolution.
- Validate `doc:overlay`, rebuild affected text maps, re-resolve affected/missing-block threads, recreate highlights/fallbacks, and place both marker kinds.
- Amend comments CSS only for the shared marker/filter/mount states needed by both clients.
- Create one permanent, public-safe Node 22 runner for registry, barrier, reconciliation, supervision, and rendered-browser integration.

### Out of scope

- Fetching, validating, creating, deciding, or storing suggestions; suggestion drafts/cards/block chips belong to P4-P/P4-O.
- Applying overlay text, computing hashes, editing blocks, or dispatching `doc:overlay`; edit.js is the publisher.
- A second panel, rail, floating layer, framework, event bus, global namespace, layout slot, polling loop, or realtime subscription.
- Changing comment APIs, comment writes, P3-C's anchor algorithm, Custom Highlight policy, panel accessibility model, five-page read bound, or P4-A forms.
- Amending `edit.js`, `edit.css`, server code, static layout, packages, generated documents, or any implementation files beyond the three paths owned below.

## Interface contract

### Publication and activation order

P1-B initializes `window.doc.rail` and `window.doc.panel` to `null` and emits edit before comments. During P4-Q module evaluation, after every existing P3-C prerequisite succeeds, require both fields still be exactly null. Create the existing private rail/panel controllers and atomically assign these recursively frozen exact surfaces before installing the session listener:

```js
window.doc.rail = Object.freeze({ add, remove, place });
window.doc.panel = Object.freeze({ register, refresh, open });
```

If either field is non-null, return silently before UI/listeners/network and do not overwrite it. The six functions never throw through their public boundary.

On the first valid P3-H session, set P3-C activated state, then inspect the optional edit barrier without evaluating `window.doc.edit` or `.overlaysReady` through ordinary property access or optional chaining. First call `Object.getOwnPropertyDescriptor(window.doc, "edit")`; accept only an own data descriptor whose `value` is a non-null object. Then call `Object.getOwnPropertyDescriptor(editDescriptor.value, "overlaysReady")`; accept only an own data descriptor whose `value` is a genuine same-realm `Promise`. An accessor at either level is invalid and is never invoked. Await the accepted value through `Promise.race` with a 5,500 ms local deadline; ignore its fulfillment value and rejection. Only after settlement/deadline call P3-C's initial `refresh()`. When the exact seam is absent/invalid, refresh immediately. Calls to public `window.doc.comments.refresh()` after activation but before that initial barrier settles join the same readiness Promise rather than resolving anchors early. This ordering changes no network timeout and always terminates.

### Rail interface

`add(kind, aid, label, onClick)` accepts only:

- `kind` exactly `comment` or `suggestion`;
- `aid` matching `^a[0-9a-f]{8}$` and currently resolving to one unique connected `[data-aid]` block;
- `label` as 1–160 safe Unicode scalar values with no CR/LF or C0/C1 control;
- `onClick` as a function.

Invalid input returns `null` without mutation/getter coercion. Valid input creates one native `button[type=button]` using text/attributes only, retains the callback privately, registers it in the existing P3-C declutter registry, schedules placement, and returns an opaque token made exactly as `Object.freeze(Object.create(null))`. A token has no data, string representation, id, or authority. `remove(token)` removes only the exact identity returned by this controller and returns boolean; foreign/repeated values return false. `place()` schedules P3-C's existing single-animation-frame placement and returns `undefined`; it never forces synchronous layout through the public call.

P3-C's comment marker construction must use this registry internally with `kind:"comment"`. P4-P registers at most one `kind:"suggestion"` marker per aid, labelled `<N> suggestions` (`1 suggestion` for one). Marker classes are exactly `doc-comment-marker doc-rail-comment` or `doc-comment-marker doc-rail-suggestion`; accessible text is the supplied validated label. Activation invokes the retained callback in a `try/catch`, applies `Promise.resolve(result).catch(() => {})` when it returns a thenable, then schedules placement. A callback throw/rejection is contained with no log or retry.

Both kinds use P3-C's established location, closed-`details`, viewport, raw-sort, 24-pixel declutter, resize/font/toggle scheduling, focus outline, and safe-text rules. A comment marker and suggestion marker on one block are two entries and are pushed apart; several suggestions on one block are never several markers.

### Panel interface and filters

`register(kind, renderFn)` accepts only exact `kind === "suggestion"` and a function. The first valid call stores the function and returns true; invalid or duplicate registration returns false without replacement or invocation. The callback is private code collaboration, not a data/authority boundary.

During each panel repaint, comments.js creates a fresh empty `section.doc-panel-extension` after all matching comment thread groups and before panel status/footer content, then calls:

```js
renderFn(extension, aidFilter)
```

`extension` is that connected empty HTMLElement. `aidFilter` is `null` or a validated aid selected by `open(aid)`. The callback may append only its suggestion UI and returns `undefined`; a throw removes the extension and leaves comments usable. A thenable return is treated as misuse: attach a rejection handler, remove the extension, and do not await it. comments.js never interprets suggestion objects, and edit.js never receives the comment model.

`refresh()` schedules one ordinary panel repaint and rail placement and returns `undefined`. It does not fetch threads or suggestions. `open(aid)` accepts a valid currently unique aid or exact `null`; invalid input returns false. Valid input clears/sets the private block filter, selects the All kind view, opens the existing non-modal panel using P3-C focus behavior, repaints comments first and the extension second, and returns true. Thus either marker can open one block with comment threads above suggestion cards.

Extend P3-C's kind filter values from `anchored | discussions | all` to `anchored | discussions | suggestions | all`, preserving `all` as default and using visible labels `Anchored`, `Discussions`, `Suggestions`, and `All`. The existing Open/Resolved/All status group filters comments only; it never hides suggestion cards. The Suggestions view invokes only the registered extension; Anchored and Discussions do not invoke it; All invokes both comment rendering and the extension. With no renderer, Suggestions shows exact safe empty text `Suggestions are unavailable.` The kind controls remain native `aria-pressed` buttons and block filtering is cleared when the user selects any kind filter.

### Overlay event

P4-B and P4-P dispatch only this recursively frozen shape after successfully changing rendered block content:

```js
document.dispatchEvent(new CustomEvent("doc:overlay", {
  detail: Object.freeze({ aids: Object.freeze(["a31b7c9d2"]) })
}));
```

The event is non-bubbling, non-cancelable, and non-composed. Accept only a frozen ordinary exact detail with one own enumerable data property `aids`; its value is a frozen dense array of 1–50 sorted unique valid aids with ordinary indexed data descriptors and no symbolic/extra keys. Validation never invokes a getter. Malformed, empty, duplicate, unsorted, oversized, disconnected, or unknown-aid events do nothing.

On acceptance, cancel any queued placement, rebuild the P3-C unique block index once, and recompute `textMap()` only for named blocks. Re-run `locate()` for every anchored thread whose stored `anchor.block` is named or absent from the rebuilt index. The latter inclusion is required because new text in a named block can turn a moved/orphaned unique quote into a different state. Threads anchored to another present block retain their valid location/range. Then delete/recreate the two owned Highlight registries or fallback classes, repaint affected panel warnings/quotes and all rail entries, restore active/focus state as P3-C specifies, and schedule one placement frame. Discussion cards and thread data are unchanged; no HTTP request occurs.

Multiple valid overlay events arriving in one task are coalesced into one microtask with the sorted union, capped at 50. If a union would exceed 50, process the current batch and queue another finite batch. There is no timer/poll and no event is redispatched.

### CSS boundary

`comments.css` adds only `.doc-rail-suggestion`, `.doc-panel-extension`, and filter/shared panel selectors necessary for the new kind. Suggestion marker styling is distinguishable in ordinary color but retains the same visible border/shape and complete accessible label in forced colors. The extension participates in P3-C's panel width/overflow/print rules. P4-P owns all `.doc-suggest-*` draft/card/block styles in `edit.css`; P4-Q must not define them.

## Files owned

- `templates/base/comments.js` — **amended**, created by P3-C and first amended by P4-A; publish shared controllers and reconcile overlays.
- `templates/base/comments.css` — **amended**, created by P3-C; add only shared rail/panel/filter integration styles.
- `scripts/test-p4-q.mjs` — **new**, created only by P4-Q; permanent self-supervising registry/barrier/DOM/browser regression runner.

No edit asset, function, layout, package, workflow, generated document, or other implementation path is owned.

## Dependencies

- **P1-B:** exact `window.doc` initialization plus edit-before-comments module order consumed by publication and optional-barrier discovery.
- **P3-C:** sole anchor locator/text map, validated thread model, comments rail/panel, filters, focus rules, highlight/fallback ownership, and refresh lifecycle.
- **P4-A:** comment write forms and their repaint/focus state in the shared panel; P4-Q must land after it in `comments.js`.
- **P4-B (optional runtime seam):** exact always-settling `window.doc.edit.overlaysReady` and initial pending overlays. It is not an authoring prerequisite because absence is explicitly supported.
- **P4-P (downstream):** consumes the frozen rail/panel surfaces and emits exact `doc:overlay`; it must land after P4-Q and P4-I.

Maximum safe authoring: the private rail registry, panel extension, overlay validator/reconciler, and new runner are disjoint internal units and may be developed concurrently against this frozen contract. Their integration into `comments.js` and all browser/generated gates are serialized after P4-A. The disjoint P4-B lane may overlap P4-Q, but P4-I starts only after P4-B is integrated because both amend `edit.js`. P4-P waits until both P4-I and P4-Q are integrated.

## Acceptance criteria

- [ ] Only the three owned implementation paths change; existing `window.doc.comments` remains frozen `{refresh}` and the exact two new frozen surfaces publish once without overwrite.
- [ ] GitHub issue #39 retains the exact title `P4-Q — The shared client surface`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] The initial thread refresh discovers both levels of the optional P4-B barrier through own data descriptors without invoking an `edit` or `overlaysReady` accessor, and cannot resolve anchors before a valid barrier settles or the exact 5.5-second guard expires.
- [ ] Rail arguments, opaque tokens, removal, callback containment, one-suggestion-marker-per-aid, closed-section hiding, and 24-pixel two-kind declutter follow the exact contract.
- [ ] One suggestion renderer registers once; All/block view renders matching comments first then suggestions, Suggestions invokes only the extension, and renderer failure leaves comments usable.
- [ ] Existing comment filters, write forms, panel focus/Escape, active thread, marker inverse navigation, truncation, and network refresh semantics remain unchanged.
- [ ] Only exact recursively frozen bounded overlay events trigger work; bursts coalesce without losing aids or creating an unbounded queue.
- [ ] A later overlay produces fresh ranges/states/highlights/markers for affected and missing-block threads without refetch, prose mutation, stale Range reuse, or discussion changes.
- [ ] HTTP(S), missing edit seam, overlay timeout/failure, file/artifact, missing renderer, no Highlight API, forced colors, reduced motion, print, and narrow-layout cases degrade as documented.
- [ ] Finite AST, deterministic runtime/browser, supervisor, scrub, build parity, and ownership gates pass.

## Test plan

Run syntax and a pinned AST/public-surface gate after P4-A:

```bash
set -euo pipefail
npm --prefix templates/docbuild run check
node --check templates/base/comments.js
node --check scripts/test-p4-q.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
const source = readFileSync("templates/base/comments.js", "utf8");
const sf = ts.createSourceFile("comments.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
for (const text of ["Object.freeze({ add, remove, place })", "Object.freeze({ register, refresh, open })", "doc:overlay", "Suggestions are unavailable."]) assert.equal(source.includes(text), true, text);
for (const denied of ["setInterval", "localStorage", "sessionStorage", "innerHTML =", "window.doc.suggestions"]) assert.equal(source.includes(denied), false, denied);
console.log("PASS  P4-Q syntax and public surfaces");
NODE
```

Expected: compilation/syntax exit 0 and the exact fixture line is `PASS  P4-Q syntax and public surfaces`.

`scripts/test-p4-q.mjs` is a permanent Node 22 entry point with no public arguments. It evaluates the real integrated P3-C/P4-A/P4-Q `comments.js` with closed invented DOM/clock/event fixtures. It launches runtime and browser workers as direct children in separate mode-`0700` temporary roots, gives each 180 seconds, caps captured output, forwards HUP/INT/TERM, escalates TERM to KILL, reaps the child, proves its process group absent, and removes the guarded root before success. Its signal probes require 129/130/143 and its deadline probe requires 124. The browser worker installs only Playwright `1.55.0` under its temporary root, serves an invented loopback document, and removes all install/browser/server state. It reads no credential or remote service.

Run exactly:

```bash
node scripts/test-p4-q.mjs
```

The runtime matrix covers null/preoccupied publication; frozen surfaces/descriptors; every invalid/valid rail argument; opaque/foreign/repeated token; callback throw/reject; comment/suggestion same-block placement; closed/open details; one/three suggestion labels; renderer invalid/first/duplicate/throw; all four kind values and three status values; valid/null/invalid open; comment-first order; edit and overlaysReady accessors that throw and must never be invoked; initial absent/resolve/reject/never-settle barriers at 5,499/5,500 ms; every overlay shape/descriptor/order/1/50/51 bound; affected present and missing-block exact/drifted/moved/orphaned transitions; two-event coalescing; Highlight/fallback; focus preservation; and no fetch. The browser matrix delays pending overlays while comments return first, proves no Range is created before overlay settlement, dispatches a later overlay across nested text nodes, and checks corrected highlight geometry, two-kind marker order, block-filtered comment-before-suggestion order, keyboard focus, 200% zoom, narrow viewport, light/dark/reduced-motion/forced-colors/print modes, and static `file:` behavior. Success has no stderr, exits `0`, and writes exactly:

```text
PASS  P4-Q supervisor signals and deadline
PASS  P4-Q rail, panel, barrier, and overlay matrix
PASS  P4-Q rendered shared surface and overlay ordering
PASS  P4-Q fixture cleaned
```

Run repository gates:

```bash
set -euo pipefail
: "${P4Q_BASE:?set P4Q_BASE to the reviewed P3-C/P4-A predecessor commit}"
test "$(git rev-parse --verify "$P4Q_BASE^{commit}")" = "$P4Q_BASE"
scripts/scrub-check.sh docs/tickets/P4-Q.md templates/base/comments.js templates/base/comments.css scripts/test-p4-q.mjs
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check "$P4Q_BASE"...HEAD
git diff --check
P4Q_OWNED="$({ git diff --name-only "$P4Q_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-Q.md' || true)"
test "$P4Q_OWNED" = $'scripts/test-p4-q.mjs\ntemplates/base/comments.css\ntemplates/base/comments.js'
unset P4Q_OWNED
issue_json="$(gh issue view 39 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-Q.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-Q — The shared client surface"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-Q repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #39 is updated: every command exits `0`; scrub emits no denial; generated documents are byte-identical after rebuilding; ownership, whitespace, title, exact-body, full-SHA, and byte-equality checks emit nothing; the final line is exactly `PASS  P4-Q repository and pointer gates`.

## Failure modes

- Edit seam absent, malformed, rejected, or slow: the 5.5-second guard preserves a finite initial comments read; a later valid overlay event still repairs it.
- Invalid/oversized overlay event: ignored without partial work; the last good comment/suggestion presentation remains.
- Renderer/callback throws or rejects: contain it, remove only the extension where applicable, preserve comments, and do not retry/log.
- Overlay changes a named block: affected and missing-block anchors may change among all four states; the stored thread never changes.
- Section collapses or layout moves: existing placement scheduler hides/repositions both marker kinds; no new observer or poll.
- Deliberately not handled: suggestion data/network, cross-module transactional render, plugin renderer removal/replacement, more extension kinds, or external DOM mutation not accompanied by `doc:overlay`.

## Settled decisions

- comments.js remains the only owner of the rail, panel, comment locator, and Highlight registries.
- Suggestions are whole-block state: one marker/chip per block and no suggestion passage highlight.
- For one block, comment threads render before suggestion cards; several suggestions remain creation-ordered inside their extension.
- Applied overlay text precedes initial anchor resolution, and later replacement requires one exact in-page `doc:overlay` signal.
- The shared surfaces coordinate presentation only; they carry no identity, capability, suggestion record, edited text, or authority.
- Static/file/artifact output stays network-free and contains no baked volatile counts.

## Assumptions and open questions

- **Assumption:** P4-B publishes `overlaysReady` before the session event and settles it within its five-second fetch bound. The local 5.5-second guard prevents a broken optional publisher from blocking comments forever.
- **Assumption:** P4-P owns one renderer for the only extension kind, `suggestion`; a future kind requires an explicit contract/file-owner amendment rather than an open plugin registry.
- **Open question, non-blocking:** the original research signature does not define renderer parameters or duplicate registration. This ticket freezes `(extension, aidFilter)`, first-registration-wins, and contained failure so P4-P can implement without private-controller access.
- **Assumption:** pinned Playwright installation is test-only and remains inside the runner's guarded temporary root; no package or lockfile amendment is required.

## References

- `docs/research/00-integration-plan.md` §§3.2, 4.5–4.7, and 5 — anchor behavior, global/load order, ticket split, and exclusions.
- `docs/research/04-comments-and-discussion.md` §§8–11 — existing panel, rail placement, filters, accessibility, and anchor repair background.
- `docs/research/08-suggestions-and-editing-model.md` §§7.2–7.6 and 10 — shared surface, one-marker rule, comment-first order, environments, and overlay/anchor interaction.
- `docs/tickets/P3-C.md` — authoritative text map/locator, rail/panel, filters, refresh, and rendering limits.
- `docs/tickets/P4-A.md` — comment forms/status controls preserved in the shared panel.
- `docs/tickets/P4-B.md` — optional overlay readiness and exact overlay event publisher.
- [DOM Standard](https://dom.spec.whatwg.org/), accessed 2026-09-03 — `Range`, `CustomEvent`, node replacement, and event dispatch primitives.
