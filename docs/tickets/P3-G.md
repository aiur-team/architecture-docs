# P3-G — Presence

## Outcome

Authenticated HTTP(S) readers get an optional, client-derived presence view: participating visible tabs announce immediately and every 20 seconds, stale peers disappear after a 50-second lease, their normal page exits publish `bye`, the masthead shows a deterministic reader strip and privacy toggle, and valid block locations appear as non-interactive rail markers without persisting any presence fact.

## Context

Presence is short-lived decoration, not document state. It is derived independently in each tab from P3-F's authenticated client-channel `beat` and `bye` events, and it may be incomplete, delayed, duplicated, or briefly stale without changing access, editing, comments, or durable content.

P3-F deliberately exposes only a frozen `publish()` method and a closed `doc:event` bus; it does not expose credentials or connection state. P3-G uses a successful client publish or an accepted client event as its transport-ready proof, keeps roster decoration dark when realtime is disabled, and never reaches behind that seam. A fail-closed stored-hidden reader gets only the local privacy recovery toggle before proof so they can opt back in without disclosing themselves first.

## Scope

### In scope

- Create `templates/base/presence.js` and `templates/base/presence.css`, consumed by P1-B's existing slots after P3-F and before P2-C's final session module.
- Activate only from P2-C's valid lowercase `session` event and use only P3-F's frozen `window.doc.realtime.publish()` plus normalized `doc:event` details.
- Derive a privacy-safe local label, publish one immediate visible `beat`, publish visible beats every 20 seconds after transport proof, and never overlap beat calls.
- Publish `bye` on `pagehide` for a participating reader and once when the reader chooses hide-me; restart with an immediate beat on visible return or privacy opt-in.
- Maintain a bounded in-memory roster keyed only by P3-F's token-bound `clientId`, retain first-sight order, expire entries at 50 seconds, and sweep every 5 seconds.
- Insert a masthead reader strip with at most five initials plus an overflow count and an accessible hide/show control.
- Render grouped, non-interactive location markers beside unique P1-D `data-aid` blocks for accepted beats that carry an `aid`.
- Define exact storage, lifecycle, privacy, accessibility, responsive, print, failure, cleanup, and deterministic test behavior.
- Leave named internal seams for P4-I to amend later with editing activity, claim/release handling, and editing chips.

### Out of scope

- Creating or changing the realtime connection, token endpoint, channels, provider messages, token refresh, reconnection, backoff, or the `doc:event` schema. P3-F owns all transport.
- Ably Presence, a server presence endpoint, a presence store, Blob keys, audit events, message history, polling, analytics, read receipts, “who read this” history, or cross-document presence.
- Authorization, access checks, roles, trusted display-name assertions, or gating any action from the roster, `clientId`, label, activity, or location.
- Tracking cursor coordinates, selections, scroll position, typing, carets, or character-level collaboration.
- Editing claims/releases, the “is editing” block chip, hiding edit affordances, or changing an outgoing beat to `act: "editing"`. P4-I amends the named seams after P4-B.
- Static presence markup in `layout.html`, builder changes, another global, an SDK/dependency, package/lock/config changes, generated HTML edits, or permanent test files.

## Interface contract

### Module activation and fixed constants

Both owned assets are dependency-free and self-contained. `presence.js` is a plain browser script with no import, export, top-level await, dynamic code, network primitive, token/channel/provider string, or direct EventSource use. P1-B inlines it as a module after `realtime.js`; `presence.css` is included only through the existing style slot.

At module evaluation, fail silently unless all of these predecessor surfaces exist:

- `location.protocol` is exact `http:` or `https:`.
- `window.doc` is a non-null object.
- `window.doc.realtime` is frozen, has exactly one own string key `publish`, has no own symbols, and that key is an own data property containing a function with descriptor `{ enumerable: true, writable: false, configurable: false }`.
- `window.doc.anchor` is a non-null object whose own `BLOCK` is an array and whose own `norm` and `scanBlocks` are functions. P3-G does not call or copy them; their presence proves P1-D's generated anchor layer is installed.

A failed prerequisite installs no listener/timer/UI and touches no storage. Otherwise attach one listener for exact lowercase `session` and one for exact `doc:event`. No UI, storage read, publish, clock read, or timer occurs before a valid session.

Use exactly:

```js
const BEAT_MS = 20000;
const LEASE_MS = 50000;
const SWEEP_MS = 5000;
const MAX_READERS = 200;
const STORAGE_KEY = "doc.presence.hidden.v1";
const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const AID_RE = /^a[0-9a-f]{8}$/;
```

Accept the first `session` event only when its `detail` passes this closed-record check and `document.documentElement` has exact `data-session="reader"` or `data-session="editor"`, `document.querySelectorAll(".head-top")` returns exactly one element, `document.querySelectorAll("button#tt")` returns exactly one element, and that button's `parentElement` is the admitted head-top. Remove the session listener only after every check passes; ignore malformed events without consuming activation. Activation happens at most once.

Perform every reflection operation in one fail-closed `try` boundary before reading a field value. `detail` must have prototype exactly the current realm's `Object.prototype`, be frozen, have no symbol, and have exactly one of these own string-key sequences:

```text
legacy: sub, email, name, roles, canComment, canEdit
final:  sub, email, name, roles, canComment, canEdit, doc, role, shared, canSuggest, canAccept, canShare, canSeeMembers
```

Every named field is an own data property with descriptor `{ enumerable: true, writable: false, configurable: false }`; accessors, non-enumerable/extra/reordered/missing keys, custom/null prototypes, proxies that throw, and unfrozen records are rejected without invoking a getter. In both shapes, `sub`, `email`, and `name` are strings, `roles` is a frozen dense ordinary array with prototype exactly `Array.prototype`, no symbols or non-index key other than `length`, and only string elements, and `canComment`/`canEdit` are booleans. Each index is an enumerable non-writable/non-configurable data property and `length` is the ordinary non-enumerable/non-writable/non-configurable data property. In the final shape, `doc` matches `^[0-9a-f]{6}$`, `role` is `owner`, `editor`, `commenter`, `viewer`, or `none`, and `shared`, `canSuggest`, `canAccept`, `canShare`, and `canSeeMembers` are booleans. These are shape/type checks, not authorization; P3-G still reads only the two admitted presentation fields below.

The module never calls `/api/session` or inspects a capability. It reads only `detail.roles` and `detail.name` to derive the local presentation label:

1. Treat the reader as an organization member only when `roles` is a frozen dense array with the sole string `"member"`; every other accepted P2-C legacy/final roles value is privacy-conservatively external.
2. An external reader's label is the literal `Guest`; never read their `name`, `email`, or `sub`.
3. For a member, accept `name` only when it is a string with no C0/C1 control. Trim it, collapse JavaScript whitespace runs to one ASCII space, and copy complete Unicode code points until adding the next would exceed 24 UTF-16 code units. If the result is empty, use literal `Member`. Never fall back to email, sub, role, or domain.

Keep the resulting label only in closure. The label is presentation, is self-asserted once published, and never authorizes or identifies a durable actor.

### Privacy preference and transport-ready proof

Read `localStorage.getItem(STORAGE_KEY)` once during valid activation inside `try`/`catch`:

- `null` means visible-by-default (`hiddenByChoice = false`).
- exact `"1"` means hidden.
- any other stored value or any read exception means hidden. Corrupt/unavailable storage fails closed against broadcasting.

Do not create presence UI merely because a visible-by-default session exists. If the tab is visible and the preference is not hidden, synchronously initiate the immediate `publish({ t: "beat", ...currentBeat() })` during the session-listener turn. A resolved `false` leaves that default-visible deployment with no UI or timer.

The fail-closed hidden state is the deliberate recovery exception. During activation, immediately mount only the exact masthead container and toggle defined below, set the faces element's HTML `hidden` attribute, do not create the rail, and publish nothing. This applies to exact stored `"1"`, corrupt storage, and storage-read failure. It lets the reader choose Show without first exposing a client ID. An accepted incoming client `beat`/`bye` may prove transport while hidden; explicit Show may also try an immediate beat.

A resolved `true` from an allowed outgoing call, or the first accepted client `beat`/`bye`, is transport proof. Ensure the same container exists, remove `hidden` from its faces element, create the rail once, and start the 5-second sweep. This makes P2-F's absent-key 204 remain decoration-dark without adding a P3-F state getter and never discloses a hidden reader merely to discover transport readiness.

Centralize the one-time transition in `proveTransport()`. On the first proof it mounts the UI, starts the 5-second sweep, and, when the tab is visible and the preference is not hidden, starts one interval whose first tick is exactly 20,000 ms after that proof. Thus an accepted inbound event repairs the schedule even when the activation publish resolved `false`: it does not trigger an extra immediate beat, but the local reader next announces on the normal 20-second tick. A successful immediate beat also proves transport and starts that same single interval. Every tick attempts one beat only when no prior beat call is pending. Once proof exists, a failed call is dropped; an existing schedule continues, and a successful opt-in establishes a missing schedule under the proof-priority rule even if that opt-in's immediate call fails. Before proof, one failed immediate call creates no retry interval; a later transition from hidden to visible, a `pageshow` restoration, or a browser `online` event may make one new immediate attempt. There is no faster retry, timeout, queue, exponential backoff, or direct fetch.

`currentBeat()` is the explicit P4-I amendment seam. P3-G implements it exactly as:

```js
function currentBeat() {
  return { label: localLabel, act: "reading", aid: null };
}
```

`sendBeat()` passes `Object.assign({ t: "beat" }, currentBeat())` only after verifying the exact returned P3-G shape. P3-G itself never publishes an aid or `act: "editing"`. P4-I later amends `currentBeat()` and the same file after it owns a proven editable focus; it must preserve every timer/privacy/validation rule here.

The toggle is a native button. Its exact behavior is:

- Visible state: text `Hide me`, `aria-label="Hide me from live presence"`, `aria-pressed="false"`.
- Hidden state: text `Show me`, `aria-label="Show me in live presence"`, `aria-pressed="true"`.
- On Hide: attempt `localStorage.setItem(STORAGE_KEY, "1")`, but set the in-memory preference hidden even if that write throws; stop the beat interval immediately; initiate one `publish({ t: "bye" })`; keep the subscription, other-reader roster, sweep, and UI.
- On Show: call `localStorage.removeItem(STORAGE_KEY)` first. Only success changes the in-memory preference to visible. A throw leaves it hidden and makes no beat. On success, initiate an immediate beat and apply the proof-priority rule below.

`transportProved` is monotonic until terminal cleanup and has priority over the outcome of Show's immediate publish. If proof already exists when Show begins—or arrives while that publish is pending—keep faces revealed, keep the one rail and 5-second sweep, and ensure the single visible 20-second beat interval exists even when the Show publish later resolves `false`; that failure is only a dropped beat and cannot regress proven UI or scheduling. If no proof exists when a `false` result settles, keep the preference visible and the recovery container mounted with faces hidden, no rail, no sweep, no beat interval, and toggle state `Hide me`; a later accepted event or allowed lifecycle retry can prove transport. Do not silently restore the removed storage key in either branch. A subsequent Hide follows the normal transition rule, including its one removal `bye`, because the reader explicitly opted in even if the attempted beat was not accepted.

No preference value contains a document ID, client ID, label, identity, timestamp, or event. Do not use cookies, sessionStorage, IndexedDB, Cache API, window name, URL/history, or a server write.

### Exact `doc:event` consumption and roster

Ignore every event before valid session activation. Accept only `event.detail` objects created by the frozen P3-F seam: prototype exactly `Object.prototype`, `Object.isFrozen(detail) === true`, no symbols/accessors/extra keys, and for every expected key an own data descriptor with `{ enumerable: true, writable: false, configurable: false }`. Perform reflection in `try`/`catch` and invoke no accessor. Browser JavaScript cannot reliably distinguish a transparent Proxy; this is defensive input validation, not a security boundary.

P3-G accepts only these two flat shapes and ignores server projections plus client claim/release events:

```js
Object.freeze({ source: "client", t: "beat", clientId, label, act, aid });
Object.freeze({ source: "client", t: "bye", clientId });
```

Require `clientId` to match `CLIENT_ID_RE`. For `beat`, require label to be 1–24 UTF-16 code units with no C0/C1 control, `act` exact `reading` or `editing`, and `aid` either null or `AID_RE`. Do not trim or repair another client's accepted label; render it only through `textContent`/text properties.

The private roster is a `Map` keyed by exact `clientId`. Each value is a fresh internal `{ label, act, aid, seen, order }`:

- On a new valid beat, if the roster already has 200 different IDs, drop the new ID; never evict an existing first-sighted reader to admit it. Otherwise sample `Date.now()` once, assign the next monotonically increasing in-memory `order`, insert, prove transport, and repaint.
- On an existing valid beat, sample `Date.now()` once and replace `seen`. Preserve `order`. Repaint only when label, act, or aid changed; a seen-only renewal must not churn the live region or DOM.
- On a valid bye, delete that exact ID. Repaint only if it existed. An unknown bye is still transport proof but changes no roster.
- Never compare or merge by label, sub, email, color, aid, or activity. A refreshed P2-F guest token has a new client ID and is a new first sight.

The sweep runs every 5,000 ms only after transport proof. Each pass samples `Date.now()` once and deletes entries where `now - seen >= 50_000`; then repaint once if anything changed. A backwards/non-finite clock sample deletes nothing; on the next usable sample normal expiry resumes. Because one shared sweep is quantized to five seconds, an entry becomes stale at 50 seconds and is removed by the first sweep then due—strictly before 55 seconds absent browser timer throttling. Run a sweep immediately on return to visible and on BFCache restore before painting or sending the new beat.

### Masthead UI and first-sight ordering

Mount exactly once and immediately before `button#tt`: after transport proof for visible-by-default readers, or during valid activation solely as the recovery container for a fail-closed hidden reader:

```html
<div id="doc-presence" class="doc-presence" role="group" aria-label="Live presence">
  <div class="doc-presence-faces" role="list" aria-live="polite" aria-atomic="true"></div>
  <button id="doc-presence-toggle" class="doc-presence-toggle" type="button"></button>
</div>
```

All nodes are created with `createElement`; set untrusted text with `textContent`, `title`, and `aria-label` only. Never use HTML-string parsing. There is one control: the toggle. Avatars and rail markers are not links/buttons, receive no tabindex, and gate nothing. The faces node is hidden only in pre-proof recovery mode; transport proof removes that attribute exactly once. A valid incoming empty-roster proof therefore reveals `No readers present` rather than fabricating a reader.

Sort roster values by ascending `order`. Render the first five as `<span class="doc-presence-avatar doc-presence-colour-N" role="listitem">`. Compute `N` only with this exact 32-bit FNV-1a operation:

```js
function colourIndex(clientId) {
  let hash = 2166136261;
  for (let index = 0; index < clientId.length; index += 1) {
    hash ^= clientId.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 8;
}
```

The input is the exact already-validated `clientId` string, iterated once from index zero through its JavaScript UTF-16 code units. Do not UTF-8 encode, normalize, trim, case-fold, iterate Unicode code points, seed from another value, or hash the label. The offset basis is decimal `2166136261`, the prime is decimal `16777619`, XOR happens before `Math.imul`, `>>> 0` follows every multiplication, and the final unsigned value maps to the sole class suffix through `% 8`. For example, `u_fixture_z` maps to `doc-presence-colour-7` and `u_fixture_a` maps to `doc-presence-colour-2`. Never put `clientId` itself in an attribute, dataset, text, title, CSS custom property, or accessible name.

Avatar visible text is deterministic initials. Trim the label and split on JavaScript whitespace. Use the first Unicode code point of the first word and, when there is more than one word, the first code point of the last word; for one word use only its first code point. If no code point exists, use `?`. CSS may uppercase visually; JavaScript does not locale-casefold. Set `title` to the label and `aria-label` to exact `<label>, <reading|editing>`.

When more than five entries exist, append one `<span class="doc-presence-more" role="listitem">` whose text is `+<roster.size - 5>` and `aria-label` is `<N> more readers`. Set the faces element's `aria-label` to `No readers present`, `1 reader present`, or `<N> readers present`. A material roster change replaces only faces-element children in one commit; it never replaces the toggle/container or moves first-sighted readers on renewal.

### P1-D block markers

On each material repaint, build a fresh block index by iterating `document.querySelectorAll("[data-aid]")` in document order. Admit an element only when its exact attribute matches `AID_RE` and occurs once; an invalid or duplicate ID receives no presence marker. Never add `data-aid` to a created node or select one ambiguous block.

Group current roster rows with non-null `aid` by that exact ID, sorted by `order`. At transport proof—not recovery-container mount—append one `<div id="doc-presence-rail" aria-label="Reader locations">` to `document.body`. Create one non-interactive marker per admitted aid beneath it. A marker is `<div class="doc-presence-marker" role="img">`, contains at most three small initial spans in first-sight order plus `+N` for overflow, and has one `aria-label` joining exact phrases such as `Invented Reader, reading; Guest, editing`. It contains no client ID and no editable/claim chip.

The rail is absolutely positioned and consumes no layout space. Before committing markers, read each candidate block rectangle and the rail rectangle. Omit that candidate entirely when the block is disconnected, has no layout box, or its closest `details` is closed; a previously rendered marker that becomes ineligible is removed on the next placement commit. Otherwise set top to the block's viewport top minus rail top and left to the block's viewport right minus rail left plus 28 CSS pixels, clamped from 4 through `document.documentElement.scrollWidth - marker.offsetWidth - 4`. Sort desired markers by block document order; if two overlap vertically, set each later top to at least the previous top plus 20 CSS pixels.

Coalesce placement through one `requestAnimationFrame`. Request placement after marker repaint, on `resize`, on capture-phase `toggle`, and once after `document.fonts.ready` settles; ignore a missing FontFaceSet and a rejected ready promise. Scrolling needs no listener because viewport-to-rail subtraction preserves document coordinates. Cancel an outstanding frame during cleanup.

### Visibility, page lifecycle, and cleanup

- On `visibilitychange` to hidden, stop the beat interval and publish no automatic bye. Peers remove the reader by lease if it stays hidden.
- On return to exact visible, sweep stale peers and initiate one immediate beat if not hidden by choice. If transport is already proved, restart the interval regardless of that beat's result; otherwise start it only when this call or an incoming event proves transport. Do not create a second interval.
- On `online`, make at most one immediate visible beat attempt only when session activation exists, transport has not yet been proved, the tab is visible, and the preference is not hidden. There is no hidden readiness publication and no `offline` mutation; P3-F owns connection behavior.
- On every `pagehide`, if and only if the preference is not hidden, initiate exactly one `publish({ t: "bye" })` without awaiting it. P3-F's earlier listener has closed SSE but explicitly permits this later keepalive publish. A reader who already chose Hide sends no second bye and reveals no client ID to a peer that never observed the transition. Then stop intervals, cancel placement, clear the roster/rail faces, and mark suspended. Do not remove mounted DOM on a potentially persisted page.
- On `pageshow` with `persisted === true`, clear suspended, sweep/paint the already-empty roster, and make the same immediate visible beat only when visible and not hidden. If transport is already proved, recreate the one beat interval regardless of that call's result; otherwise wait for proof. A hidden reader remains silent and waits for an incoming event or explicit Show. Ordinary `pageshow` does nothing.

Fatal local setup failure before mount removes every installed listener/timer and publishes nothing. After mount, an unexpected paint/storage/layout exception is caught at the smallest boundary: retain the last good UI/roster, stop the failing optional action, and continue lease/bye cleanup. A terminal cleanup removes module listeners, intervals, pending frame, rail and masthead container, clears the Map, and initiates no new work; normal Document destruction supplies that terminal boundary.

### CSS contract

`presence.css` styles only IDs/classes created above and never hides or restyles document prose. Use existing color/border/surface/mono variables with literal local fallbacks.

- `.doc-presence` uses `margin-inline-start:auto`, inline flex, center alignment, and an 8-pixel gap so it sits immediately before the theme control without changing source markup.
- `.doc-presence-faces` is inline flex, and `.doc-presence-faces[hidden]` is `display:none!important`; adjacent 24-by-24-pixel circular masthead avatars overlap by 6 pixels. `.doc-presence-more` is a non-overlapped compact count. Eight fixed `doc-presence-colour-0` through `-7` classes use these exact foreground/background pairs. Effective light uses `0 #1e3a8a/#dbeafe`, `1 #14532d/#dcfce7`, `2 #78350f/#fef3c7`, `3 #701a75/#fae8ff`, `4 #7f1d1d/#fee2e2`, `5 #164e63/#cffafe`, `6 #4c1d95/#ede9fe`, and `7 #1e293b/#e2e8f0`; effective dark reverses each listed pair. Explicit `data-theme="light"`/`"dark"` overrides system preference exactly as P1-B does, while no explicit theme follows `prefers-color-scheme`. Apply the same class pair to masthead avatars and marker initials; no unlisted dynamic color is allowed.
- `.doc-presence-toggle` is a compact native-looking button with a visible `:focus-visible` outline. Its pressed state cannot be conveyed by color alone because text and accessible name both change.
- `#doc-presence-rail` is absolute at inset zero with `pointer-events:none`; markers are absolute, small, visually lighter than comment controls, and never intercept selection/clicks. Marker initial circles are 16 by 16 pixels and overlap by 4 pixels.
- At widths at or below 720 CSS pixels, hide only `#doc-presence-rail`; the masthead reader strip and privacy toggle remain available and wrap with `.head-top`.
- Under forced colors, avatars/markers/toggle have a visible one-pixel border and the toggle focus outline uses `CanvasText`. Under reduced motion, disable every transition/animation (none is required). Under print, hide `.doc-presence` and `#doc-presence-rail` with `display:none!important`.

## Files owned

- `templates/base/presence.js` — **new**, created exclusively by P3-G; P4-I later amends it after P4-B.
- `templates/base/presence.css` — **new**, created exclusively by P3-G; P4-I later amends it for the editing chip.

No other implementation path is owned. Do not edit P1-B layout/builder, P1-D anchors, P2-C session files, P3-F transport, P3-C comment rail, P4-B edit files, generated `dist/**`, package/lock/config/workflow files, a permanent test, research, prompt, or another ticket. Shared generated artifacts are integration output and are never hand-edited by P3-G. `docs/tickets/P3-G.md` is this specification, not implementation source.

## Dependencies

- **P1-D:** supplies globally unique built `data-aid` values matching `^a[0-9a-f]{8}$` and the installed `window.doc.anchor` proof. P3-G uses only rendered IDs/elements; it does not mint, normalize, scan, or persist anchors.
- **P3-F:** must be fully integrated and green. It supplies the frozen one-method `window.doc.realtime` surface; exact always-settling four-variant publish contract; one multi-channel subscription; token-bound client ID; and frozen flat `doc:event` variants. P3-G never imports provider facts or treats an arbitrary event as trusted identity.
- **Transitive P1-B/P2-C:** P1-B supplies ordered CSS/JS slots, `.head-top`, `button#tt`, and `window.doc`; P2-C supplies the final ordered `session` event and frozen name/roles data. These are consumed through the direct predecessors' published integration state and are not amended.

Use maximum safe parallelism in these waves:

1. Integrate P1-D and P3-F completely and green. Because P3-F itself requires P1-B/P2-C/P2-F, those contracts are also present. A missing global/bus/publish/data-aid/slot is a predecessor gap, not permission to duplicate it.
2. P3-G's two new source files may be authored together by one owner and in parallel with Phase 3 lanes whose source paths are disjoint and whose own predecessors are green. Its VM fixture has no port, child process, install, or shared output.
3. Run the rendered gate only after the two sources and VM fixture are green. Its dependencies live in one private supervised root, but serialize this resource-heavy browser run with shared generated-output/browser integration after all selected template lanes are rebased. Only that integrator rebuilds `dist/**`; no concurrent ticket runs another browser/dependency/generated gate.
4. P4-I starts only after P3-G and P4-B are both integrated and green. It amends these two files plus its owned edit files; it preserves P3-G presence behavior while adding the named editing seam. P3-G and P4-I cannot author in parallel.

## Acceptance criteria

- [ ] Only the two owned assets are added; JavaScript uses no network/provider/storage beyond the one local preference and the frozen P3-F API.
- [ ] Invalid platform/predecessor/session/DOM surfaces stay silent and create no storage read, publish, UI, clock read, timer, throw, or accessor invocation; both exact frozen legacy/final closed session records activate once.
- [ ] Guests always publish literal `Guest`; member labels follow the exact private normalization and never fall back to email/sub/domain.
- [ ] Storage missing means visible; exact `1`, corruption, and read failure mean hidden. A hidden reader gets only a silent recovery toggle before proof; Hide takes effect in memory even on write failure; Show requires a successful removal, and an already-proven transport can never be regressed by Show's failed immediate beat.
- [ ] Visible activation initiates one immediate beat. Every kind of transport proof starts the sole visible 20-second schedule, including an inbound proof after the immediate call failed; beats never overlap, and hidden tabs/readers emit none.
- [ ] Hide initiates one exact `bye`; a pagehide initiates one only while opted in. Hidden activation/lifecycle sends nothing, and P3-F false/rejection never escapes, blocks navigation, creates a retry storm, or changes durable state.
- [ ] Roster keys are exact client IDs, renewals preserve first-sight order, the 200-reader cap is deterministic, bye deletes immediately, and sweeps expire at `>= 50_000` ms on one 5-second pass.
- [ ] Only exact frozen client beat/bye details enter the roster. Server events, claims/releases, malformed/wide/accessor/symbol/hostile values, and invalid scalars do nothing and invoke no getter.
- [ ] The masthead mounts after transport proof except for the exact hidden recovery mode; recovery exposes only the toggle with faces hidden and no rail/sweep. It sits immediately before `#tt`, has exact semantic structure, safe text, at most five first-sighted initials plus overflow after proof, exact 32-bit FNV-1a colour classes, and no client ID in the DOM.
- [ ] Valid unique P1-D aids receive one grouped non-interactive marker; invalid/duplicate/closed/no-layout blocks do not; placement/order/clamping/decluttering is deterministic and coalesced.
- [ ] Seen-only beats do not repaint/live-announce. Material changes, bye, and expiry commit one repaint; no roster/UI state authorizes or controls document actions.
- [ ] Executed visibilitychange, online proof, pagehide, and persisted/ordinary pageshow cases create no duplicate timer/listener/frame and preserve the P3-F keepalive-bye ordering.
- [ ] CSS is scoped, responsive, printable, forced-colors/focus safe, reduced-motion safe, and does not take prose layout space or intercept input; the real-browser oracle computes all eight exact foreground/background pairs in explicit and system light/dark modes.
- [ ] P4-I seams are present but P3-G publishes only reading/null beats, ignores claim/release, renders no editing chip, and hides no edit affordance.
- [ ] The supplied VM fixture executes the closed platform/session/event matrices and the enumerated proof, timing, privacy, roster, clock, lifecycle, ordering, cleanup, and runtime-poison cases without external network or leaked process/file/timer. The separately supervised real-browser gate parses the complete script with pinned Acorn and executes invalid/duplicate/closed/no-layout marker filtering, live placement/clamping/decluttering, responsive rendering, forced colors/focus, reduced motion, and print. Acceptance is limited to those exact executable classes; there is no source-review fallback.
- [ ] Exact headings, fence syntax, scrub, whitespace, check-dist, TypeScript, ownership, and issue #20 pointer integrity pass: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

### Required deterministic source-bound fixture

Run from the repository root on Node 22. The fixture must execute the real JS in a `node:vm` browser double with a fake `document`, `.head-top`, `#tt`, three unique `data-aid` blocks plus one duplicate pair, controllable rectangles/details, P1-D/P3-F globals, localStorage, visibility/lifecycle events, a virtual clock, virtual intervals/animation frames, and an always-settling publish recorder. It starts no child process, socket, server, browser, dependency install, or temporary file. The separate rendered browser gate below—not this VM—owns layout and computed-CSS proof.

```bash
set -euo pipefail

node --check templates/base/presence.js
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const js = fs.readFileSync("templates/base/presence.js", "utf8");
const deadline = setTimeout(() => process.exit(124), 15000);
const forbiddenTouches = [];
const forbidden = (name) => { forbiddenTouches.push(name); throw new Error(`forbidden presence sink reached: ${name}`); };

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options = {}) {
    const rows = this.listeners.get(type) || [];
    rows.push({ fn, once: options === true || options?.once === true, capture: options === true || options?.capture === true });
    this.listeners.set(type, rows);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((row) => row.fn !== fn));
  }
  dispatchEvent(event) {
    event.target = this;
    for (const row of [...(this.listeners.get(event.type) || [])]) {
      if (row.once) this.removeEventListener(event.type, row.fn);
      row.fn.call(this, event);
    }
    return true;
  }
}

class EventFixture {
  constructor(type, init = {}) { Object.assign(this, init, { type }); }
}

class StyleFixture {
  setProperty(name, value) { this[name] = String(value); }
  removeProperty(name) { delete this[name]; }
}

function matches(node, selector) {
  if (selector === "[data-aid]") return node.hasAttribute("data-aid");
  if (selector === "button#tt") return node.localName === "button" && node.id === "tt";
  if (selector.startsWith("#")) return node.id === selector.slice(1);
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  return node.localName === selector.toLowerCase();
}

class ElementFixture extends Target {
  constructor(name) {
    super();
    this.localName = name.toLowerCase();
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.style = new StyleFixture();
    this._text = "";
    this.rect = { top: 0, right: 24, left: 0, bottom: 24, width: 24, height: 24 };
    this.offsetWidth = 24;
    this.open = true;
    this.writeCount = 0;
  }
  get parentElement() { return this.parentNode instanceof ElementFixture ? this.parentNode : null; }
  get id() { return this.getAttribute("id") || ""; }
  set id(value) { this.setAttribute("id", value); }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get classList() {
    const node = this;
    const values = () => new Set(node.className.split(/\s+/u).filter(Boolean));
    return {
      contains(value) { return values().has(value); },
      add(...items) { const next = values(); for (const item of items) next.add(item); node.className = [...next].join(" "); },
      remove(...items) { const next = values(); for (const item of items) next.delete(item); node.className = [...next].join(" "); },
      toggle(item, force) { const next = values(); const add = force === undefined ? !next.has(item) : Boolean(force); add ? next.add(item) : next.delete(item); node.className = [...next].join(" "); return add; }
    };
  }
  get textContent() { return this.children.length ? this.children.map((node) => node.textContent).join("") : this._text; }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get innerHTML() { return forbidden("innerHTML:get"); }
  set innerHTML(_value) { forbidden("innerHTML:set"); }
  get outerHTML() { return forbidden("outerHTML:get"); }
  set outerHTML(_value) { forbidden("outerHTML:set"); }
  insertAdjacentHTML() { return forbidden("insertAdjacentHTML"); }
  get isConnected() { let node = this; while (node) { if (node.localName === "html") return true; node = node.parentNode; } return false; }
  setAttribute(name, value) { this.writeCount += 1; this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null; }
  hasAttribute(name) { return this.attributes.has(String(name)); }
  removeAttribute(name) { if (this.attributes.has(String(name))) this.writeCount += 1; this.attributes.delete(String(name)); }
  toggleAttribute(name, force) { const on = force === undefined ? !this.hasAttribute(name) : Boolean(force); on ? this.setAttribute(name, "") : this.removeAttribute(name); return on; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) { if (node.parentNode) node.remove(); this.writeCount += 1; node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) {
    const at = this.children.indexOf(before);
    assert.ok(at >= 0, "insertBefore reference must be a child");
    if (node.parentNode) node.remove();
    this.writeCount += 1;
    node.parentNode = this;
    this.children.splice(at, 0, node);
    return node;
  }
  replaceChildren(...nodes) { this.writeCount += 1; for (const child of this.children) child.parentNode = null; this.children = []; this._text = ""; this.append(...nodes); }
  remove() { if (!this.parentNode) return; const at = this.parentNode.children.indexOf(this); if (at >= 0) { this.parentNode.writeCount += 1; this.parentNode.children.splice(at, 1); } this.parentNode = null; }
  contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => { for (const child of node.children) { if (matches(child, selector)) found.push(child); visit(child); } };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { ...this.rect }; }
}

class DocumentFixture extends Target {
  constructor() {
    super();
    this.documentElement = new ElementFixture("html");
    this.documentElement.scrollWidth = 1000;
    this.body = new ElementFixture("body");
    this.documentElement.append(this.body);
    this.visibilityState = "visible";
    this.fonts = { ready: Promise.resolve() };
  }
  createElement(name) { if (["form", "input", "textarea"].includes(String(name).toLowerCase())) forbidden(`createElement:${name}`); return new ElementFixture(name); }
  querySelectorAll(selector) { const out = matches(this.documentElement, selector) ? [this.documentElement] : []; return out.concat(this.documentElement.querySelectorAll(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

function environment({ protocol = "https:", anchor = true, realtime = true, stored = null } = {}) {
  const document = new DocumentFixture();
  const window = new Target();
  const head = document.createElement("div"); head.className = "head-top";
  const theme = document.createElement("button"); theme.id = "tt"; head.append(theme); document.body.append(head);
  const details = document.createElement("details"); details.open = true; document.body.append(details);
  const aids = ["a03f19c2b", "a04e27d91", "a08b61f0e"];
  const blocks = aids.map((aid, index) => {
    const block = document.createElement("section"); block.setAttribute("data-aid", aid);
    block.rect = { top: 100 + index * 12, right: 500, left: 100, bottom: 110 + index * 12, width: 400, height: 10 };
    details.append(block); return block;
  });
  for (let index = 0; index < 2; index += 1) { const duplicate = document.createElement("section"); duplicate.setAttribute("data-aid", "af00dcafe"); document.body.append(duplicate); }
  let now = 0;
  let nextTimer = 1;
  const intervals = new Map();
  let nextFrame = 1;
  const frames = new Map();
  const calls = [];
  const lifecycle = [];
  const outcomes = [];
  const held = [];
  const storage = { value: stored, reads: 0, writes: [], failRead: false, failSet: false, failRemove: false };
  const storageApi = {
    getItem(key) { storage.reads += 1; assert.equal(key, "doc.presence.hidden.v1"); if (storage.failRead) throw new Error("fixture read"); return storage.value; },
    setItem(key, value) { if (storage.failSet) throw new Error("fixture set"); storage.value = String(value); storage.writes.push(["set", key, String(value)]); },
    removeItem(key) { if (storage.failRemove) throw new Error("fixture remove"); storage.value = null; storage.writes.push(["remove", key]); }
  };
  const localStorage = new Proxy(storageApi, {
    get(target, property, receiver) {
      if (!["getItem", "setItem", "removeItem"].includes(property)) return forbidden(`localStorage.${String(property)}:get`);
      return Reflect.get(target, property, receiver);
    },
    set(_target, property) { return forbidden(`localStorage.${String(property)}:set`); }
  });
  const publish = (event) => {
    calls.push(JSON.parse(JSON.stringify(event)));
    lifecycle.push(`publish:${event?.t ?? "unknown"}`);
    const outcome = outcomes.length ? outcomes.shift() : true;
    if (outcome === "hold") return new Promise((resolve) => held.push(resolve));
    if (outcome === "throw") throw new Error("fixture publish");
    if (outcome === "reject") return Promise.reject(new Error("fixture publish rejection"));
    return Promise.resolve(outcome);
  };
  const setIntervalFixture = (fn, ms) => { const id = nextTimer++; intervals.set(id, { fn, ms, due: now + ms }); return id; };
  const clearIntervalFixture = (id) => intervals.delete(id);
  const requestAnimationFrameFixture = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
  const cancelAnimationFrameFixture = (id) => frames.delete(id);
  class ClockDate extends Date { static now() { return now; } }
  const location = new Proxy({ protocol }, { get(target, property, receiver) { if (property === "hash" || property === "search") return forbidden(`location.${String(property)}`); return Reflect.get(target, property, receiver); } });
  const navigator = {};
  Object.defineProperty(navigator, "sendBeacon", { value: () => forbidden("sendBeacon") });
  Object.defineProperty(navigator, "serviceWorker", { get: () => forbidden("serviceWorker") });
  const deniedFunction = (name) => function deniedPresencePrimitive() { return forbidden(name); };
  const console = new Proxy({}, { get(_target, property) { return deniedFunction(`console.${String(property)}`); } });
  Object.defineProperty(document, "cookie", { get: () => forbidden("cookie:get"), set: () => forbidden("cookie:set") });
  Object.assign(window, { document, location, localStorage, navigator, console });
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]) Object.defineProperty(window, name, { value: deniedFunction(name) });
  for (const name of ["sessionStorage", "indexedDB", "caches", "history"]) Object.defineProperty(window, name, { get: () => forbidden(name) });
  const sandbox = {
    window, document, location, localStorage, navigator, console,
    fetch: window.fetch, XMLHttpRequest: window.XMLHttpRequest, WebSocket: window.WebSocket, EventSource: window.EventSource,
    Event: EventFixture, CustomEvent: EventFixture, Date: ClockDate,
    setInterval: setIntervalFixture, clearInterval: clearIntervalFixture,
    requestAnimationFrame: requestAnimationFrameFixture, cancelAnimationFrame: cancelAnimationFrameFixture,
    addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
    queueMicrotask, __publish: publish
  };
  for (const name of ["sessionStorage", "indexedDB", "caches", "history"]) Object.defineProperty(sandbox, name, { get: () => forbidden(`global.${name}`) });
  const context = vm.createContext(sandbox);
  vm.runInContext(`window.doc = { rail: null, panel: null };`, context);
  Object.defineProperty(window.doc, "presence", { get: () => forbidden("window.doc.presence:get"), set: () => forbidden("window.doc.presence:set") });
  if (anchor) vm.runInContext(`window.doc.anchor = { BLOCK: [], norm() {}, scanBlocks() {} };`, context);
  if (realtime) vm.runInContext(`window.doc.realtime = Object.freeze({ publish(event) { return __publish(event); } });`, context);
  const settle = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
  const flushFrames = () => { const rows = [...frames.values()]; frames.clear(); for (const fn of rows) fn(now); };
  const advance = async (ms) => {
    const end = now + ms;
    while (true) {
      const due = Math.min(...[...intervals.values()].map((row) => row.due));
      if (!Number.isFinite(due) || due > end) break;
      now = due;
      for (const row of [...intervals.values()].filter((value) => value.due === due)) { row.due += row.ms; row.fn(); }
      await settle(); flushFrames();
    }
    now = end; await settle(); flushFrames();
  };
  const setNow = (value) => { now = value; };
  const fireInterval = async (ms) => {
    for (const row of [...intervals.values()].filter((value) => value.ms === ms)) row.fn();
    await settle();
    flushFrames();
  };
  const run = () => vm.runInContext(js, context, { filename: "templates/base/presence.js" });
  const validDetail = ({ roles = ["member"], name = "Invented Reader" } = {}) => vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: ${JSON.stringify(name)}, roles: Object.freeze(${JSON.stringify(roles)}), canComment: true, canEdit: false })`, context);
  const finalDetail = () => vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Invented Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false, doc: "4b7d2a", role: "commenter", shared: true, canSuggest: true, canAccept: false, canShare: false, canSeeMembers: false })`, context);
  const rawSession = (detail, mode = "reader") => {
    if (mode === null) document.documentElement.removeAttribute("data-session");
    else document.documentElement.setAttribute("data-session", mode);
    document.dispatchEvent(new EventFixture("session", { detail }));
  };
  const session = (options = {}) => rawSession(validDetail(options));
  const client = (detail) => {
    const value = vm.runInContext(`Object.freeze(${JSON.stringify(detail)})`, context);
    document.dispatchEvent(new EventFixture("doc:event", { detail: value }));
  };
  const pagehide = (persisted = true) => window.dispatchEvent(new EventFixture("pagehide", { persisted }));
  const pageshow = (persisted) => window.dispatchEvent(new EventFixture("pageshow", { persisted }));
  const visibility = (state) => { document.visibilityState = state; return document.dispatchEvent(new EventFixture("visibilitychange")); };
  const online = () => window.dispatchEvent(new EventFixture("online"));
  return { window, document, head, theme, details, blocks, calls, lifecycle, outcomes, held, storage, intervals, frames, context, run, validDetail, finalDetail, rawSession, session, client, settle, flushFrames, advance, setNow, fireInterval, pagehide, pageshow, visibility, online };
}

{
  for (const options of [{ protocol: "file:" }, { protocol: "about:" }, { protocol: "https" }, { anchor: false }, { realtime: false }]) {
    const env = environment(options); env.run(); env.session(); await env.settle();
    assert.equal(env.calls.length, 0); assert.equal(env.storage.reads, 0); assert.equal(env.document.getElementById("doc-presence"), null); assert.equal(env.intervals.size, 0);
    assert.equal([...env.document.listeners.values()].flat().length, 0, "failed prerequisites install no document listener");
    assert.equal([...env.window.listeners.values()].flat().length, 0, "failed prerequisites install no window listener");
  }
}
{
  const env = environment(); env.run();
  env.client({ source: "client", t: "beat", clientId: "u_fixture_before", label: "Before Session", act: "reading", aid: null });
  env.visibility("hidden"); env.visibility("visible"); env.online(); env.pageshow(false); env.pageshow(true); env.pagehide(true);
  await env.settle();
  assert.equal(env.calls.length, 0); assert.equal(env.storage.reads, 0); assert.equal(env.document.getElementById("doc-presence"), null); assert.equal(env.intervals.size, 0);
  env.session(); assert.equal(env.calls.length, 1, "pre-session events and lifecycle do not consume activation"); await env.settle(); env.pagehide();
}
{
  const env = environment(); env.run(); env.context.__sessionGetterRuns = 0;
  env.context.__rolesGetterRuns = 0;
  const malformed = [
    vm.runInContext(`({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false })`, env.context),
    vm.runInContext(`Object.freeze({ email: "reader@example.invalid", sub: "u_fixture_member_17", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false })`, env.context),
    vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false, extra: true })`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create(null), { sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false }))`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create({ fixture: true }), { sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false }))`, env.context),
    vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: ["member"], canComment: true, canEdit: false })`, env.context),
    vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: "true", canEdit: false })`, env.context),
    vm.runInContext(`(() => { const value = { sub: "u_fixture_member_17", email: "reader@example.invalid" }; Object.defineProperty(value, "name", { enumerable: true, get() { globalThis.__sessionGetterRuns += 1; return "Reader"; } }); value.roles = Object.freeze(["member"]); value.canComment = true; value.canEdit = false; return Object.freeze(value); })()`, env.context),
    vm.runInContext(`(() => { const value = { sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false }; value[Symbol("extra")] = true; return Object.freeze(value); })()`, env.context),
    vm.runInContext(`Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false, doc: "BAD", role: "commenter", shared: true, canSuggest: true, canAccept: false, canShare: false, canSeeMembers: false })`, env.context),
  ];
  const legacyLiteral = `{ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false }`;
  const finalLiteral = `{ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false, doc: "4b7d2a", role: "commenter", shared: true, canSuggest: true, canAccept: false, canShare: false, canSeeMembers: false }`;
  const mutate = (literal, body) => vm.runInContext(`(() => { const value = ${literal}; ${body}; return Object.freeze(value); })()`, env.context);
  for (const key of ["sub", "email", "name", "roles", "canComment", "canEdit"]) malformed.push(mutate(legacyLiteral, `delete value.${key}`));
  for (const [key, replacement] of [["sub", "7"], ["email", "null"], ["name", "{}"], ["roles", "Object.freeze([7])"], ["canComment", "1"], ["canEdit", "0"]]) {
    malformed.push(mutate(legacyLiteral, `value.${key} = ${replacement}`));
  }
  malformed.push(
    mutate(legacyLiteral, `value.roles = Object.freeze(["member", , "member"])`),
    mutate(legacyLiteral, `const roles=["member"]; roles.extra=true; value.roles=Object.freeze(roles)`),
    mutate(legacyLiteral, `const roles=["member"]; roles[Symbol("extra")]=true; value.roles=Object.freeze(roles)`),
    mutate(legacyLiteral, `const roles=[]; Object.defineProperty(roles,"0",{enumerable:true,get(){globalThis.__rolesGetterRuns+=1;return "member"}}); value.roles=Object.freeze(roles)`),
    mutate(legacyLiteral, `value.roles=Object.freeze(Object.assign(Object.create(null),{0:"member",length:1}))`),
    vm.runInContext(`(() => { const value=${legacyLiteral}; Object.defineProperty(value,"sub",{value:value.sub,enumerable:false}); return Object.freeze(value); })()`, env.context),
    vm.runInContext(`new Proxy(Object.freeze({}), { getPrototypeOf() { throw new Error("fixture proxy trap"); } })`, env.context),
  );
  for (const key of ["sub", "email", "name", "roles", "canComment", "canEdit", "doc", "role", "shared", "canSuggest", "canAccept", "canShare", "canSeeMembers"]) malformed.push(mutate(finalLiteral, `delete value.${key}`));
  for (const [key, replacement] of [["doc", `"ABC123"`], ["role", `"reader"`], ["shared", `"true"`], ["canSuggest", `"true"`], ["canAccept", `1`], ["canShare", `null`], ["canSeeMembers", `[]`]]) {
    malformed.push(mutate(finalLiteral, `value.${key} = ${replacement}`));
  }
  malformed.push(vm.runInContext(`Object.freeze({ email:"reader@example.invalid", sub:"u_fixture_member_17", name:"Reader", roles:Object.freeze(["member"]), canComment:true, canEdit:false, doc:"4b7d2a", role:"commenter", shared:true, canSuggest:true, canAccept:false, canShare:false, canSeeMembers:false })`, env.context));
  for (const detail of malformed) assert.doesNotThrow(() => env.rawSession(detail));
  assert.equal(malformed.length, 50, "closed session rejection matrix case count");
  assert.equal(env.context.__sessionGetterRuns, 0); assert.equal(env.context.__rolesGetterRuns, 0); assert.equal(env.calls.length, 0); assert.equal(env.storage.reads, 0); assert.equal(env.document.getElementById("doc-presence"), null);
  env.rawSession(env.finalDetail()); assert.equal(env.calls.length, 1, "malformed sessions do not consume the listener and the exact final record activates"); await env.settle(); env.pagehide();
}
{
  const env = environment(); env.run();
  env.rawSession(null);
  env.rawSession(env.validDetail(), null);
  env.rawSession(env.validDetail(), "owner");
  const duplicateHead = env.document.createElement("div"); duplicateHead.className = "head-top"; env.document.body.append(duplicateHead);
  env.rawSession(env.validDetail()); duplicateHead.remove();
  const duplicateTheme = env.document.createElement("button"); duplicateTheme.id = "tt"; env.head.append(duplicateTheme);
  env.rawSession(env.validDetail()); duplicateTheme.remove();
  env.document.body.append(env.theme); env.rawSession(env.validDetail()); env.head.append(env.theme);
  assert.equal(env.calls.length, 0, "malformed session/root/masthead cases must not consume activation");
  env.session(); env.session(); assert.equal(env.calls.length, 1, "only the first valid session activates"); await env.settle(); env.pagehide();
}
{
  const env = environment(); env.run(); env.rawSession(env.finalDetail(), "editor");
  assert.equal(env.calls.length, 1, "exact final session activates in editor root mode"); await env.settle();
  env.session(); assert.equal(env.calls.length, 1, "final activation consumes the session listener once"); env.pagehide();
}
{
  const env = environment(); env.run();
  assert.equal(env.calls.length, 0); assert.equal(env.storage.reads, 0);
  env.session({ name: "  Invented   Reader  " });
  assert.deepEqual(env.calls, [{ t: "beat", label: "Invented Reader", act: "reading", aid: null }]);
  assert.equal(env.document.getElementById("doc-presence"), null, "UI waits for transport proof");
  await env.settle(); env.flushFrames();
  const ui = env.document.getElementById("doc-presence");
  assert.ok(ui); assert.equal(env.head.children.indexOf(ui), env.head.children.indexOf(env.theme) - 1);
  await env.advance(19999); assert.equal(env.calls.length, 1);
  await env.advance(1); assert.equal(env.calls.length, 2);
  env.pagehide(); assert.deepEqual(env.calls.at(-1), { t: "bye" }); assert.equal(env.intervals.size, 0); assert.equal(env.frames.size, 0);
}
{
  for (const [roles, name, label] of [
    [["member"], "   ", "Member"],
    [["member"], `Bad${String.fromCharCode(7)}Name`, "Member"],
    [["member"], "😀".repeat(13), "😀".repeat(12)],
    [[], "Must Not Publish", "Guest"],
    [["guest"], "Must Not Publish", "Guest"],
    [["member", "other"], "Must Not Publish", "Guest"],
  ]) {
    const env = environment(); env.run(); env.session({ roles, name });
    assert.deepEqual(env.calls[0], { t:"beat", label, act:"reading", aid:null });
    assert.equal(JSON.stringify(env.calls[0]).includes("reader@example.invalid"), false);
    assert.equal(JSON.stringify(env.calls[0]).includes("u_fixture_member_17"), false);
    await env.settle(); env.pagehide();
  }
}
{
  const env = environment(); env.outcomes.push(false); env.run(); env.session(); await env.settle();
  assert.equal(env.document.getElementById("doc-presence"), null); assert.equal(env.intervals.size, 0);
  env.client({ source: "client", t: "bye", clientId: "u_fixture_peer_29" }); await env.settle();
  assert.ok(env.document.getElementById("doc-presence"));
  const beforeTick = env.calls.length; await env.advance(19999); assert.equal(env.calls.length, beforeTick); await env.advance(1);
  assert.deepEqual(env.calls.at(-1), { t: "beat", label: "Invented Reader", act: "reading", aid: null });
  env.pagehide();
}
{
  for (const outcome of ["throw", "reject"]) {
    const env = environment(); env.outcomes.push(outcome); env.run();
    assert.doesNotThrow(() => env.session(), `${outcome}: publish failure is contained synchronously`);
    await env.settle();
    assert.equal(env.calls.length, 1);
    assert.equal(env.document.getElementById("doc-presence"), null);
    assert.equal(env.intervals.size, 0);
    env.online(); await env.settle();
    assert.equal(env.calls.length, 2, `${outcome}: one later allowed lifecycle retry`);
    assert.ok(env.document.getElementById("doc-presence"));
    env.pagehide();
  }
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  env.outcomes.push("hold");
  const beforeHeld = env.calls.length; await env.advance(20000); assert.equal(env.calls.length, beforeHeld + 1); assert.equal(env.held.length, 1);
  await env.advance(40000); assert.equal(env.calls.length, beforeHeld + 1, "a pending beat suppresses later ticks");
  env.held.shift()(true); await env.settle(); await env.advance(20000); assert.equal(env.calls.length, beforeHeld + 2);
  env.pagehide();
}
{
  for (const mode of ["corrupt", "read-error"]) {
    const env = environment({ stored: mode === "corrupt" ? "unexpected" : null });
    if (mode === "read-error") env.storage.failRead = true;
    env.run(); env.session(); await env.settle();
    assert.equal(env.calls.length, 0, `${mode}: fail closed without publication`);
    assert.equal(env.document.getElementById("doc-presence-toggle").textContent, "Show me");
    assert.equal(env.document.querySelector(".doc-presence-faces").hasAttribute("hidden"), true);
    assert.equal(env.document.getElementById("doc-presence-rail"), null);
    assert.equal(env.intervals.size, 0);
  }
}
{
  const env = environment(); env.document.visibilityState = "hidden"; env.run(); env.session(); await env.settle();
  assert.equal(env.calls.length, 0, "initial hidden session does not publish");
  assert.equal(env.document.getElementById("doc-presence"), null);
  env.online(); await env.settle(); assert.equal(env.calls.length, 0, "online while hidden does not publish");
  env.visibility("visible"); assert.equal(env.calls.length, 1, "first visible return makes one immediate attempt"); await env.settle();
  assert.ok(env.document.getElementById("doc-presence"));
  env.pagehide();
}
{
  const env = environment({ stored: "1" }); env.run(); env.session({ roles: ["guest"], name: "Must Not Leak" });
  assert.equal(env.calls.length, 0);
  const toggle = env.document.getElementById("doc-presence-toggle"); assert.equal(toggle.textContent, "Show me");
  const faces = env.document.querySelector(".doc-presence-faces"); assert.equal(faces.hasAttribute("hidden"), true);
  assert.equal(env.document.getElementById("doc-presence-rail"), null); assert.equal(env.intervals.size, 0);
  env.online(); await env.settle(); assert.equal(env.calls.length, 0, "online is silent while hidden by choice");
  env.pagehide(true); env.pageshow(true); await env.settle(); assert.equal(env.calls.length, 0, "persisted hidden restore is silent");
  env.storage.failRemove = true; toggle.dispatchEvent(new EventFixture("click")); await env.settle(); assert.equal(env.calls.length, 0);
  env.storage.failRemove = false; env.outcomes.push(false); toggle.dispatchEvent(new EventFixture("click")); await env.settle();
  assert.deepEqual(env.calls.at(-1), { t: "beat", label: "Guest", act: "reading", aid: null });
  assert.equal(toggle.textContent, "Hide me"); assert.equal(faces.hasAttribute("hidden"), true); assert.equal(env.document.getElementById("doc-presence-rail"), null);
  toggle.dispatchEvent(new EventFixture("click")); await env.settle(); assert.deepEqual(env.calls.at(-1), { t: "bye" });
  toggle.dispatchEvent(new EventFixture("click")); await env.settle(); assert.deepEqual(env.calls.at(-1), { t: "beat", label: "Guest", act: "reading", aid: null });
  assert.equal(faces.hasAttribute("hidden"), false); assert.ok(env.document.getElementById("doc-presence-rail"));
  env.storage.failSet = true; toggle.dispatchEvent(new EventFixture("click")); await env.settle(); assert.deepEqual(env.calls.at(-1), { t: "bye" });
  const beforePagehide = env.calls.length; env.pagehide(); assert.equal(env.calls.length, beforePagehide);
}
{
  const env = environment({ stored: "1" }); env.run(); env.session();
  env.client({ source: "client", t: "beat", clientId: "u_fixture_peer_29", label: "Peer Reader", act: "reading", aid: null }); await env.settle();
  const toggle = env.document.getElementById("doc-presence-toggle");
  const faces = env.document.querySelector(".doc-presence-faces");
  const rail = env.document.getElementById("doc-presence-rail");
  assert.equal(toggle.textContent, "Show me"); assert.equal(faces.hasAttribute("hidden"), false); assert.ok(rail); assert.equal(env.intervals.size, 1, "hidden proof starts only the sweep");
  env.outcomes.push(false); toggle.dispatchEvent(new EventFixture("click")); await env.settle();
  assert.deepEqual(env.calls, [{ t: "beat", label: "Invented Reader", act: "reading", aid: null }]);
  assert.equal(toggle.textContent, "Hide me"); assert.equal(faces.hasAttribute("hidden"), false); assert.equal(env.document.getElementById("doc-presence-rail"), rail);
  assert.equal(env.intervals.size, 2, "proved Show failure preserves sweep and starts the visible beat schedule");
  await env.advance(19999); assert.equal(env.calls.length, 1); await env.advance(1); assert.deepEqual(env.calls.at(-1), { t: "beat", label: "Invented Reader", act: "reading", aid: null });
  env.pagehide();
}
{
  const env = environment(); env.run(); env.session(); await env.settle(); env.flushFrames();
  env.client({ source: "client", t: "beat", clientId: "u_fixture_z", label: "Zed Reader", act: "reading", aid: "a03f19c2b" });
  env.client({ source: "client", t: "beat", clientId: "u_fixture_a", label: "Alpha Editor", act: "editing", aid: "a04e27d91" });
  env.flushFrames();
  let avatars = env.document.querySelectorAll(".doc-presence-avatar");
  assert.deepEqual(avatars.map((node) => node.textContent), ["ZR", "AE"]); assert.deepEqual(avatars.map((node) => node.title), ["Zed Reader", "Alpha Editor"]);
  assert.equal(avatars[0].classList.contains("doc-presence-colour-7"), true);
  assert.equal(avatars[1].classList.contains("doc-presence-colour-2"), true);
  assert.equal(avatars[0].className.includes("u_fixture_z"), false); assert.equal(avatars[1].className.includes("u_fixture_a"), false);
  const faces = env.document.querySelector(".doc-presence-faces");
  const rail = env.document.getElementById("doc-presence-rail");
  const treeWrites = (node) => node.writeCount + node.children.reduce((sum, child) => sum + treeWrites(child), 0);
  const beforeRenewal = {
    faceChildren: [...faces.children], faceText: faces.textContent, faceLabel: faces.getAttribute("aria-label"), faceWrites: treeWrites(faces),
    railChildren: [...rail.children], railText: rail.textContent, railWrites: treeWrites(rail), frames: env.frames.size,
  };
  env.client({ source: "client", t: "beat", clientId: "u_fixture_z", label: "Zed Reader", act: "reading", aid: "a03f19c2b" });
  assert.deepEqual([...faces.children], beforeRenewal.faceChildren); assert.equal(faces.textContent, beforeRenewal.faceText); assert.equal(faces.getAttribute("aria-label"), beforeRenewal.faceLabel);
  assert.equal(treeWrites(faces), beforeRenewal.faceWrites, "seen-only beat performs no live-region write");
  assert.deepEqual([...rail.children], beforeRenewal.railChildren); assert.equal(rail.textContent, beforeRenewal.railText); assert.equal(treeWrites(rail), beforeRenewal.railWrites, "seen-only beat performs no rail repaint");
  assert.equal(env.frames.size, beforeRenewal.frames, "seen-only beat schedules no placement repaint");
  env.client({ source: "client", t: "bye", clientId: "u_fixture_z" });
  env.client({ source: "client", t: "beat", clientId: "u_fixture_z", label: "Zed Reader", act: "reading", aid: "a03f19c2b" });
  env.flushFrames(); avatars = env.document.querySelectorAll(".doc-presence-avatar"); assert.deepEqual(avatars.map((node) => node.textContent), ["AE", "ZR"]);
  assert.equal(env.document.querySelectorAll(".doc-presence-marker").length, 2);
  await env.advance(49999); assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 2);
  await env.advance(1); assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 0);
  env.pagehide();
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  env.client({ source: "client", t: "beat", clientId: "u_fixture_clock", label: "Clock Reader", act: "reading", aid: null });
  assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 1);
  env.setNow(-1); await env.fireInterval(5000); assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 1, "backwards clock deletes nothing");
  env.setNow(Number.NaN); await env.fireInterval(5000); assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 1, "non-finite clock deletes nothing");
  env.setNow(50000); await env.fireInterval(5000); assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 0, "next usable sample resumes exact lease expiry");
  env.pagehide();
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  for (let index = 0; index < 200; index += 1) env.client({ source: "client", t: "beat", clientId: `u_fixture_${String(index).padStart(3, "0")}`, label: `Reader ${index}`, act: "reading", aid: null });
  let more = env.document.querySelector(".doc-presence-more"); assert.equal(more.textContent, "+195");
  env.client({ source: "client", t: "beat", clientId: "u_fixture_overflow", label: "Overflow Candidate", act: "reading", aid: null });
  env.client({ source: "client", t: "bye", clientId: "u_fixture_000" });
  more = env.document.querySelector(".doc-presence-more"); assert.equal(more.textContent, "+194", "the 201st ID was dropped rather than evicting an existing reader");
  env.client({ source: "client", t: "beat", clientId: "u_fixture_overflow", label: "Overflow Candidate", act: "reading", aid: null });
  more = env.document.querySelector(".doc-presence-more"); assert.equal(more.textContent, "+195", "space after bye admits the next sighting");
  env.pagehide();
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  assert.equal(env.intervals.size, 2, "proved visible activation owns one beat and one sweep interval");
  const beforeHidden = env.calls.length; env.visibility("hidden"); assert.equal(env.calls.length, beforeHidden); assert.equal(env.intervals.size, 1, "visibilitychange hidden stops only the beat interval");
  await env.advance(20000); assert.equal(env.calls.length, beforeHidden, "hidden sweep does not publish");
  env.outcomes.push(false); env.visibility("visible"); assert.equal(env.calls.length, beforeHidden + 1, "visibilitychange visible attempts one immediate beat"); await env.settle();
  assert.equal(env.intervals.size, 2, "existing proof restarts one beat interval despite a false visible beat");
  const beforeOnline = env.calls.length; env.online(); await env.settle(); assert.equal(env.calls.length, beforeOnline, "online does not publish after transport proof");
  env.pagehide();
}
{
  const env = environment(); env.outcomes.push(false); env.run(); env.session(); await env.settle();
  assert.equal(env.calls.length, 1); assert.equal(env.intervals.size, 0); assert.equal(env.document.getElementById("doc-presence"), null);
  env.online(); assert.equal(env.calls.length, 2, "online retries once only while visible and unproved"); await env.settle();
  assert.ok(env.document.getElementById("doc-presence")); assert.equal(env.intervals.size, 2);
  env.pagehide();
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  env.client({ source: "client", t: "beat", clientId: "u_fixture_peer_29", label: "Peer Reader", act: "reading", aid: null });
  env.pagehide(true); const afterHide = env.calls.length; assert.equal(env.intervals.size, 0);
  env.pageshow(false); await env.settle(); assert.equal(env.calls.length, afterHide); assert.equal(env.intervals.size, 0, "ordinary pageshow is a no-op");
  env.pageshow(true); assert.equal(env.calls.length, afterHide + 1, "persisted pageshow immediately reannounces"); await env.settle(); assert.ok(env.intervals.size > 0);
  env.pagehide(true);
}
{
  const env = environment();
  env.window.addEventListener("pagehide", () => env.lifecycle.push("p3f-pagehide"));
  env.run(); env.session(); await env.settle(); env.lifecycle.length = 0;
  env.pagehide(true);
  assert.deepEqual(env.lifecycle, ["p3f-pagehide", "publish:bye"], "P3-F's earlier pagehide listener runs before P3-G's keepalive bye");
  assert.equal(env.intervals.size, 0); assert.equal(env.frames.size, 0);
}
{
  const env = environment(); env.run(); env.session(); await env.settle();
  env.context.__eventGetterRuns = 0;
  const beatLiteral = `{ source:"client", t:"beat", clientId:"u_fixture_peer_29", label:"Peer Reader", act:"reading", aid:null }`;
  const byeLiteral = `{ source:"client", t:"bye", clientId:"u_fixture_peer_29" }`;
  const mutate = (literal, body) => vm.runInContext(`(() => { const value=${literal}; ${body}; return Object.freeze(value); })()`, env.context);
  const malformed = [vm.runInContext(`(${beatLiteral})`, env.context)];
  for (const key of ["source", "t", "clientId", "label", "act", "aid"]) malformed.push(mutate(beatLiteral, `delete value.${key}`));
  malformed.push(
    mutate(beatLiteral, `value.extra=true`),
    vm.runInContext(`Object.freeze({ t:"beat", source:"client", clientId:"u_fixture_peer_29", label:"Peer Reader", act:"reading", aid:null })`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create(null),${beatLiteral}))`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create({fixture:true}),${beatLiteral}))`, env.context),
    mutate(beatLiteral, `value[Symbol("extra")]=true`),
    vm.runInContext(`(() => { const value=${beatLiteral}; Object.defineProperty(value,"label",{value:value.label,enumerable:false}); return Object.freeze(value); })()`, env.context),
    vm.runInContext(`(() => { const value={}; Object.defineProperty(value,"source",{enumerable:true,get(){globalThis.__eventGetterRuns+=1;return "client"}}); return Object.freeze(value); })()`, env.context),
  );
  for (const [key, replacement] of [
    ["source", `"server"`], ["t", `"claim"`], ["clientId", `""`], ["clientId", `"_bad"`], ["clientId", `"${"a".repeat(129)}"`],
    ["clientId", `7`], ["label", `""`], ["label", `"${"l".repeat(25)}"`], ["label", `"bad"+String.fromCharCode(7)+"label"`], ["label", `7`], ["act", `"idle"`], ["aid", `"a123"`], ["aid", `7`],
  ]) malformed.push(mutate(beatLiteral, `value.${key}=${replacement}`));
  malformed.push(
    vm.runInContext(`Object.freeze({ source:"client", t:"edit.claim", clientId:"u_fixture_a", aid:"a03f19c2b" })`, env.context),
    vm.runInContext(`Object.freeze({ source:"client", t:"edit.release", clientId:"u_fixture_a", aid:"a03f19c2b" })`, env.context),
  );

  malformed.push(vm.runInContext(`(${byeLiteral})`, env.context));
  for (const key of ["source", "t", "clientId"]) malformed.push(mutate(byeLiteral, `delete value.${key}`));
  malformed.push(
    mutate(byeLiteral, `value.extra=true`),
    vm.runInContext(`Object.freeze({ t:"bye", source:"client", clientId:"u_fixture_peer_29" })`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create(null),${byeLiteral}))`, env.context),
    vm.runInContext(`Object.freeze(Object.assign(Object.create({fixture:true}),${byeLiteral}))`, env.context),
    mutate(byeLiteral, `value[Symbol("extra")]=true`),
    vm.runInContext(`(() => { const value=${byeLiteral}; Object.defineProperty(value,"clientId",{value:value.clientId,enumerable:false}); return Object.freeze(value); })()`, env.context),
    vm.runInContext(`(() => { const value={}; Object.defineProperty(value,"source",{enumerable:true,get(){globalThis.__eventGetterRuns+=1;return "client"}}); return Object.freeze(value); })()`, env.context),
    mutate(byeLiteral, `value.source="server"`),
    mutate(byeLiteral, `value.t="beat"`),
    mutate(byeLiteral, `value.clientId="_bad"`),
    mutate(byeLiteral, `value.clientId=""`),
    mutate(byeLiteral, `value.clientId="${"a".repeat(129)}"`),
    mutate(byeLiteral, `value.clientId=7`),
  );
  const faces = env.document.querySelector(".doc-presence-faces");
  const before = { writes: faces.writeCount, frames: env.frames.size, calls: env.calls.length };
  for (const detail of malformed) assert.doesNotThrow(() => env.document.dispatchEvent(new EventFixture("doc:event", { detail })));
  assert.equal(malformed.length, 46, "closed client-event rejection matrix case count");
  assert.equal(env.context.__eventGetterRuns, 0);
  assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 0);
  assert.deepEqual({ writes:faces.writeCount, frames:env.frames.size, calls:env.calls.length }, before, "malformed/server/claim events make no observable change");
  const maxClientId = "u".repeat(128);
  env.client({ source:"client", t:"beat", clientId:maxClientId, label:"L".repeat(24), act:"editing", aid:"a03f19c2b" });
  assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 1, "exact event scalar maxima are admitted");
  env.client({ source:"client", t:"bye", clientId:maxClientId });
  assert.equal(env.document.querySelectorAll(".doc-presence-avatar").length, 0, "exact bye removes the admitted id");
  env.pagehide(); assert.equal(env.intervals.size, 0); assert.equal(env.frames.size, 0);
}

assert.deepEqual(forbiddenTouches, [], "all executed VM paths avoid forbidden network/storage/HTML/navigation/global sinks");
clearTimeout(deadline);
console.log("PASS  P3-G presence runtime");
process.exit(0);
NODE
```

Expected: both commands exit 0, stdout is exactly `PASS  P3-G presence runtime`, stderr is empty, and the 15-second deadline never fires. This is the complete fixed VM fixture for the ticket: it runs only the real owned JavaScript in an isolated realm, uses no implementation hook, and leaves no OS resource or persistent artifact. It directly proves the exact assertions present in the command: the five invalid prerequisite variants install no listeners and file/about/malformed protocols or missing predecessor surfaces stay silent; pre-session client/visibility/online/pageshow/pagehide events stay inert and do not consume activation; the exact 50-case closed session rejection matrix invokes no getter and does not consume the exact final session; missing/invalid root state, duplicate head/theme, and wrong parent are followed by one consumable valid legacy-reader session, while an exact final-editor session also activates once; six exact label/privacy variants; synchronous immediate beat and 19,999/20,000-ms boundary; inbound proof after a false first publish; held-promise non-overlap across two ticks; hidden recovery, storage read/write/remove failures, synchronous throw and rejected publish, false Show before proof, successful opt-in, silent hidden online/persisted restore/pagehide, and proven Show failure; first-sight renewal/delete/rejoin, 49,999/50,000-ms lease behavior, backwards/non-finite clock retention and next-sample recovery; seen-only renewal with identical UI/write/frame state; 200-reader admission, 201st rejection, and post-bye admission; hidden/visible `visibilitychange`, unproved/proved `online`, persisted/ordinary pageshow, exact earlier-P3-F/later-P3-G pagehide ordering, and cleanup; representative masthead initials and exact FNV-1a colour classes without client-ID leakage; and the exact 46-case closed client-event rejection matrix—including separate beat/bye record, key, prototype, descriptor, scalar, claim, and release variants—followed by admitted maximum scalar boundaries. Runtime-poisoned network, alternate storage, HTML, navigation, console, form, and public-global sinks remain untouched across every executed path. It makes no computed-style or real-layout claim and claims no unexecuted case class.

### Required rendered browser gate

Run this exact macOS/Linux gate from the repository root after the VM fixture. Prerequisites are Node 22, npm, outbound HTTPS access to the npm registry and Playwright Chromium download, and Chromium's platform libraries. It uses Playwright `1.55.0` and Acorn `8.15.0` only inside a guarded temporary root. The supervisor installs signal handlers before creating that root, launches each install/browser phase as a detached process group with a finite deadline, sends TERM then KILL, awaits the direct child, proves the group absent before reuse or recursive deletion, and retains mode-`0600` evidence plus an exact locator on failure. The browser uses an intercepted invented HTTPS origin; it opens no fixture server or third-party application endpoint.

```bash
set -euo pipefail

node --input-type=module <<'SUPERVISOR'
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const signalStatus = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
let firstStatus = 0;
let currentPgid = 0;
let root = "";
let evidence = "";

function groupAlive(pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) return false;
  try { process.kill(-pgid, 0); return true; }
  catch (error) { if (error?.code === "EPERM") return true; if (error?.code === "ESRCH") return false; throw error; }
}
function signalGroup(pgid, signal) {
  if (!groupAlive(pgid)) return;
  try { process.kill(-pgid, signal); }
  catch (error) { if (error?.code !== "ESRCH") throw error; }
}
for (const [signal, status] of Object.entries(signalStatus)) {
  process.on(signal, () => {
    if (!firstStatus) firstStatus = status;
    if (currentPgid > 1) { try { signalGroup(currentPgid, signal); } catch {} }
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitGone(pgid, ms) {
  const end = Date.now() + ms;
  while (groupAlive(pgid) && Date.now() < end) await delay(50);
  return !groupAlive(pgid);
}
function record(phase, extra = {}) {
  if (!evidence) return;
  fs.writeFileSync(evidence, `${JSON.stringify({ phase, supervisorPid: process.pid, leaderPgid: currentPgid || null, root, ...extra })}\n`, { mode: 0o600 });
  fs.chmodSync(evidence, 0o600);
}
async function stopAndReap(pgid, closed) {
  signalGroup(pgid, "SIGTERM");
  if (!(await waitGone(pgid, 3000))) signalGroup(pgid, "SIGKILL");
  const reaped = await Promise.race([closed.then(() => true, () => true), delay(3000).then(() => false)]);
  const gone = await waitGone(pgid, 3000);
  if (!reaped || !gone) throw new Error(`unproved cleanup for leader PGID ${pgid}`);
}
async function runOwned(label, command, args, timeoutMs, extraEnv = {}) {
  if (firstStatus) throw new Error("terminal signal received");
  record("pre-spawn", { label });
  const child = spawn(command, args, {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv }
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const pgid = child.pid;
  if (!Number.isSafeInteger(pgid) || pgid <= 1) { await closed.catch(() => {}); throw new Error(`${label}: child PID was not published`); }
  currentPgid = pgid;
  let stdout = "";
  let stderr = "";
  let outputError = "";
  const append = (which, chunk) => {
    const next = which === "out" ? stdout + chunk : stderr + chunk;
    if (Buffer.byteLength(next) > 1048576) { outputError = `${label}: captured output exceeded 1 MiB`; return; }
    if (which === "out") stdout = next; else stderr = next;
  };
  child.stdout.on("data", (chunk) => append("out", chunk));
  child.stderr.on("data", (chunk) => append("err", chunk));
  let result;
  try {
    record("active", { label, childPid: pgid });
    result = await Promise.race([closed, delay(timeoutMs).then(() => ({ timeout: true }))]);
    if (result.timeout || firstStatus) {
      await stopAndReap(pgid, closed);
      throw new Error(result.timeout ? `${label}: deadline exceeded` : "terminal signal received");
    }
    if (groupAlive(pgid)) {
      await stopAndReap(pgid, closed);
      throw new Error(`${label}: descendants remained after leader exit`);
    }
    if (outputError) throw new Error(outputError);
    if (result.code !== 0) throw new Error(`${label}: exited ${result.code ?? result.signal}; stderr=${stderr.slice(-2000)}`);
    return { stdout, stderr };
  } catch (error) {
    if (groupAlive(pgid)) await stopAndReap(pgid, closed);
    throw error;
  } finally {
    if (!groupAlive(pgid)) currentPgid = 0;
  }
}

async function browserOracle() {
  const assert = await import("node:assert/strict");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const repo = process.env.P3G_REPO;
  const deps = process.env.P3G_DEPS;
  const { chromium } = await import(pathToFileURL(path.join(deps, "node_modules/playwright/index.mjs")).href);
  const { parse } = await import(pathToFileURL(path.join(deps, "node_modules/acorn/dist/acorn.mjs")).href);
  const js = fs.readFileSync(path.join(repo, "templates/base/presence.js"), "utf8");
  const css = fs.readFileSync(path.join(repo, "templates/base/presence.css"), "utf8");
  const ast = parse(js, { ecmaVersion: "latest", sourceType: "script" });
  const children = (node) => Object.entries(node).flatMap(([key, value]) => {
    if (["start", "end", "loc"].includes(key)) return [];
    if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry.type === "string");
    return value && typeof value.type === "string" ? [value] : [];
  });
  const nodes = [];
  const visit = (node) => { nodes.push(node); for (const child of children(node)) visit(child); };
  visit(ast);
  const staticName = (node) => node?.type === "Identifier" ? node.name : node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
  const memberPath = (node) => {
    if (!node) return null;
    if (node.type === "ChainExpression") return memberPath(node.expression);
    if (node.type === "Identifier") return [node.name];
    if (node.type !== "MemberExpression") return null;
    const head = memberPath(node.object);
    const tail = node.computed ? staticName(node.property) : node.property?.name;
    return head && tail ? [...head, tail] : null;
  };
  assert.strictEqual(nodes.some((node) => ["ImportDeclaration", "ImportExpression", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration"].includes(node.type)), false, "plain dependency-free script without import/export");
  const functionBoundary = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
  const hasTopLevelAwait = (node, functionDepth = 0) => {
    if (functionDepth === 0 && (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true))) return true;
    const nextDepth = functionDepth + (functionBoundary.has(node.type) ? 1 : 0);
    return children(node).some((child) => hasTopLevelAwait(child, nextDepth));
  };
  assert.strictEqual(hasTopLevelAwait(ast), false, "no top-level await or for-await");
  const calls = nodes.filter((node) => node.type === "CallExpression" || node.type === "NewExpression");
  const callPaths = calls.map((node) => memberPath(node.callee)).filter(Boolean);
  for (const forbidden of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "eval", "Function"]) {
    assert.strictEqual(callPaths.some((parts) => parts.at(-1) === forbidden), false, `forbidden call/new target ${forbidden}`);
  }
  assert.strictEqual(callPaths.some((parts) => parts[0] === "console"), false, "no console call");
  const localStorageCalls = callPaths.filter((parts) => (parts[0] === "localStorage" || parts.slice(0, 2).join(".") === "window.localStorage")).map((parts) => parts.at(-1)).sort();
  assert.deepStrictEqual([...new Set(localStorageCalls)], ["getItem", "removeItem", "setItem"], "only the exact local preference API surface");
  for (const node of nodes.filter((entry) => entry.type === "MemberExpression")) {
    const parts = memberPath(node);
    if (!parts) continue;
    const root = parts[0] === "window" ? parts[1] : parts[0];
    if (root === "localStorage") {
      const normalized = parts[0] === "window" ? parts.slice(1) : parts;
      assert.strictEqual(normalized.length, 2, `no nested localStorage surface ${parts.join(".")}`);
      assert.strictEqual(["getItem", "removeItem", "setItem"].includes(normalized[1]), true, `only exact localStorage methods ${parts.join(".")}`);
    }
    assert.strictEqual(["sessionStorage", "indexedDB", "caches", "history"].includes(root), false, `forbidden persistent/navigation root ${parts.join(".")}`);
    assert.strictEqual(["innerHTML", "outerHTML", "insertAdjacentHTML", "cookie", "serviceWorker"].includes(parts.at(-1)), false, `forbidden member path ${parts.join(".")}`);
    assert.strictEqual(parts.join(".") === "location.hash" || parts.join(".") === "location.search" || parts.join(".") === "window.location.hash" || parts.join(".") === "window.location.search", false, `forbidden location state ${parts.join(".")}`);
    assert.strictEqual(parts.join(".") === "window.doc.presence", false, "no extra public presence global");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.route("https://fixture.example.invalid/**", (route) => route.fulfill({
      status: 200, contentType: "text/html", body: `<!doctype html><html><body style="min-height:900px;margin:0">
        <header><div class="head-top"><button id="tt" type="button">Theme</button></div></header>
        <details open><summary>Visible blocks</summary>
          <section id="normal" data-aid="a01aa22bb" style="position:absolute;top:150px;left:100px;width:220px;height:24px">Normal</section>
          <section id="overlap" data-aid="a02bb33cc" style="position:absolute;top:154px;left:110px;width:220px;height:24px">Overlap</section>
          <section id="clamp" data-aid="a03cc44dd" style="position:absolute;top:158px;left:1200px;width:40px;height:24px">Clamp</section>
          <section id="nolayout" data-aid="a06ff7788" style="display:none">No layout</section>
        </details>
        <section data-aid="a04dd55ee">Duplicate one</section><section data-aid="a04dd55ee">Duplicate two</section>
        <details><summary>Closed</summary><section id="closed" data-aid="a05ee66ff">Closed block</section></details>
        <section data-aid="not-an-aid">Invalid block</section>
      </body></html>`
    }));
    await page.goto("https://fixture.example.invalid/document", { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: css });
    await page.evaluate(() => {
      window.__calls = [];
      window.doc = { rail: null, panel: null, anchor: { BLOCK: [], norm() {}, scanBlocks() {} } };
      window.doc.realtime = Object.freeze({ publish(event) { window.__calls.push(JSON.parse(JSON.stringify(event))); return Promise.resolve(true); } });
    });
    await page.addScriptTag({ type: "module", content: js });
    await page.evaluate(() => {
      const detail = Object.freeze({ sub: "u_fixture_member_17", email: "reader@example.invalid", name: "Invented Reader", roles: Object.freeze(["member"]), canComment: true, canEdit: false });
      document.documentElement.setAttribute("data-session", "reader");
      document.dispatchEvent(new CustomEvent("session", { detail }));
    });
    await page.waitForSelector("#doc-presence");
    await page.evaluate(() => {
      const rows = [
        ["u_fixture_normal", "Normal Reader", "a01aa22bb"],
        ["u_fixture_overlap", "Overlap Reader", "a02bb33cc"],
        ["u_fixture_clamp", "Clamp Reader", "a03cc44dd"],
        ["u_fixture_duplicate", "Duplicate Reader", "a04dd55ee"],
        ["u_fixture_closed", "Closed Reader", "a05ee66ff"],
        ["u_fixture_nolayout", "No Layout Reader", "a06ff7788"],
        ["u_fixture_invalid", "Invalid Reader", "not-an-aid"]
      ];
      for (const [clientId, label, aid] of rows) {
        const detail = Object.freeze({ source: "client", t: "beat", clientId, label, act: "reading", aid });
        document.dispatchEvent(new CustomEvent("doc:event", { detail }));
      }
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => {
      const rail = document.querySelector("#doc-presence-rail");
      const markers = [...document.querySelectorAll(".doc-presence-marker")];
      const find = (label) => markers.find((node) => node.getAttribute("aria-label")?.startsWith(`${label},`));
      const normal = find("Normal Reader");
      const overlap = find("Overlap Reader");
      const clamp = find("Clamp Reader");
      const position = (node) => ({ top: Number.parseFloat(node.style.top), left: Number.parseFloat(node.style.left), width: node.offsetWidth });
      const railRect = rail.getBoundingClientRect();
      const normalRect = document.querySelector("#normal").getBoundingClientRect();
      return {
        markerCount: markers.length,
        labels: markers.map((node) => node.getAttribute("aria-label")),
        normal: position(normal), overlap: position(overlap), clamp: position(clamp),
        normalExpectedLeft: Math.max(4, Math.min(normalRect.right - railRect.left + 28, document.documentElement.scrollWidth - normal.offsetWidth - 4)),
        clampExpectedLeft: document.documentElement.scrollWidth - clamp.offsetWidth - 4,
        avatars: [...document.querySelectorAll(".doc-presence-avatar")].map((node) => node.title),
        moreText: document.querySelector(".doc-presence-more")?.textContent || ""
      };
    });
    assert.strictEqual(layout.markerCount, 3);
    for (const omitted of ["Duplicate Reader", "Closed Reader", "No Layout Reader", "Invalid Reader"]) assert.ok(!layout.labels.some((label) => label?.startsWith(`${omitted},`)), `${omitted} must have no marker`);
    assert.ok(Math.abs(layout.normal.left - layout.normalExpectedLeft) < 1.5);
    assert.ok(Math.abs(layout.clamp.left - layout.clampExpectedLeft) < 1.5);
    assert.ok(layout.overlap.top >= layout.normal.top + 20);
    assert.ok(layout.clamp.top >= layout.overlap.top + 20);
    assert.ok(!layout.avatars.includes("Invalid Reader"));
    assert.strictEqual(layout.moreText, "+1", "invalid aid event must not enter the six-reader roster");

    const lightPairs = [
      ["rgb(30, 58, 138)", "rgb(219, 234, 254)"], ["rgb(20, 83, 45)", "rgb(220, 252, 231)"],
      ["rgb(120, 53, 15)", "rgb(254, 243, 199)"], ["rgb(112, 26, 117)", "rgb(250, 232, 255)"],
      ["rgb(127, 29, 29)", "rgb(254, 226, 226)"], ["rgb(22, 78, 99)", "rgb(207, 250, 254)"],
      ["rgb(76, 29, 149)", "rgb(237, 233, 254)"], ["rgb(30, 41, 59)", "rgb(226, 232, 240)"],
    ];
    const darkPairs = lightPairs.map(([foreground, background]) => [background, foreground]);
    const palette = async (theme, colorScheme) => {
      await page.emulateMedia({ media: "screen", colorScheme, forcedColors: "none", reducedMotion: "no-preference" });
      return page.evaluate((selectedTheme) => {
        if (selectedTheme === null) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = selectedTheme;
        const host = document.createElement("div");
        for (let index = 0; index < 8; index += 1) { const probe = document.createElement("span"); probe.className = `doc-presence-avatar doc-presence-colour-${index}`; probe.textContent = String(index); host.append(probe); }
        document.body.append(host);
        const pairs = [...host.children].map((node) => { const style = getComputedStyle(node); return [style.color, style.backgroundColor]; });
        host.remove(); return pairs;
      }, theme);
    };
    assert.deepStrictEqual(await palette("light", "dark"), lightPairs, "explicit light executes all eight pairs");
    assert.deepStrictEqual(await palette("dark", "light"), darkPairs, "explicit dark executes all eight reversed pairs");
    assert.deepStrictEqual(await palette(null, "light"), lightPairs, "system light executes all eight pairs");
    assert.deepStrictEqual(await palette(null, "dark"), darkPairs, "system dark executes all eight pairs");

    await page.setViewportSize({ width: 700, height: 700 });
    assert.strictEqual(await page.locator("#doc-presence-rail").evaluate((node) => getComputedStyle(node).display), "none");
    assert.notStrictEqual(await page.locator("#doc-presence").evaluate((node) => getComputedStyle(node).display), "none");
    await page.setViewportSize({ width: 900, height: 700 });
    assert.notStrictEqual(await page.locator("#doc-presence-rail").evaluate((node) => getComputedStyle(node).display), "none");

    await page.emulateMedia({ media: "screen", forcedColors: "active", reducedMotion: "no-preference" });
    await page.mouse.click(850, 650);
    await page.keyboard.press("Tab");
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id), "doc-presence-toggle");
    const forced = await page.evaluate(() => {
      const avatar = document.querySelector(".doc-presence-avatar");
      const marker = document.querySelector(".doc-presence-marker");
      const toggle = document.querySelector("#doc-presence-toggle");
      const probe = document.createElement("span"); probe.style.color = "CanvasText"; document.body.append(probe);
      const border = (node) => Number.parseFloat(getComputedStyle(node).borderTopWidth);
      const focus = getComputedStyle(toggle);
      const result = { avatar: border(avatar), marker: border(marker), toggle: border(toggle), outlineStyle: focus.outlineStyle, outlineWidth: Number.parseFloat(focus.outlineWidth), outlineColor: focus.outlineColor, canvasText: getComputedStyle(probe).color };
      probe.remove(); return result;
    });
    assert.ok(forced.avatar >= 1 && forced.marker >= 1 && forced.toggle >= 1);
    assert.notStrictEqual(forced.outlineStyle, "none"); assert.ok(forced.outlineWidth >= 1); assert.strictEqual(forced.outlineColor, forced.canvasText);

    await page.emulateMedia({ media: "screen", forcedColors: "none", reducedMotion: "reduce" });
    const motion = await page.evaluate(() => [...document.querySelectorAll("#doc-presence, #doc-presence *, #doc-presence-rail, #doc-presence-rail *")].every((node) => {
      const style = getComputedStyle(node);
      return style.transitionDuration.split(",").every((value) => Number.parseFloat(value) === 0) && style.animationDuration.split(",").every((value) => Number.parseFloat(value) === 0);
    }));
    assert.strictEqual(motion, true);

    await page.emulateMedia({ media: "print", forcedColors: "none", reducedMotion: "no-preference" });
    assert.deepStrictEqual(await page.evaluate(() => [getComputedStyle(document.querySelector("#doc-presence")).display, getComputedStyle(document.querySelector("#doc-presence-rail")).display]), ["none", "none"]);
  } finally {
    await browser.close();
  }
  process.stdout.write("PASS  P3-G rendered presence browser gate\n");
}

let exitCode = 0;
try {
  const tmpParent = fs.realpathSync(os.tmpdir());
  const parentStat = fs.lstatSync(tmpParent);
  assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink());
  if (firstStatus) throw new Error("terminal signal received");
  root = fs.mkdtempSync(path.join(tmpParent, "p3-g-browser-"));
  fs.chmodSync(root, 0o700);
  const resolvedRoot = fs.realpathSync(root);
  assert.strictEqual(path.dirname(resolvedRoot), tmpParent);
  assert.match(path.basename(resolvedRoot), /^p3-g-browser-[A-Za-z0-9]{6}$/);
  const rootStat = fs.lstatSync(resolvedRoot);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  root = resolvedRoot;
  evidence = `${root}.evidence.json`;
  record("prepared");
  const browserPath = path.join(root, "browsers");
  await runOwned("npm install", "npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "playwright@1.55.0", "acorn@8.15.0"], 120000);
  await runOwned("Chromium install", process.execPath, [path.join(root, "node_modules/playwright/cli.js"), "install", "chromium"], 180000, { PLAYWRIGHT_BROWSERS_PATH: browserPath });
  const worker = path.join(root, "oracle.mjs");
  fs.writeFileSync(worker, `(${browserOracle.toString()})().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });\n`, { mode: 0o600 });
  const result = await runOwned("rendered oracle", process.execPath, [worker], 30000, { P3G_REPO: process.cwd(), P3G_DEPS: root, PLAYWRIGHT_BROWSERS_PATH: browserPath });
  assert.strictEqual(result.stderr, "");
  assert.strictEqual(result.stdout, "PASS  P3-G rendered presence browser gate\n");
  record("contained");
  if (firstStatus) throw new Error("terminal signal received");
  await runOwned("root deletion", "/bin/rm", ["-rf", "--", root], 10000);
  assert.strictEqual(fs.existsSync(root), false);
  fs.unlinkSync(evidence);
  root = "";
  evidence = "";
  process.stdout.write(result.stdout);
} catch (error) {
  exitCode = firstStatus || 1;
  if (evidence && fs.existsSync(evidence)) {
    try { record("retained", { error: String(error?.message || error) }); } catch {}
    console.error(`P3-G browser gate retained: root=${root} evidence=${evidence} supervisorPid=${process.pid} leaderPgid=${currentPgid || "none"}`);
  } else {
    console.error(`P3-G browser gate failed before safe root publication: ${String(error?.message || error)}`);
  }
}
process.exit(firstStatus || exitCode);
SUPERVISOR
```

Expected: exit 0, stdout exactly `PASS  P3-G rendered presence browser gate`, and empty stderr. The real browser must prove exactly three rendered markers from the seven public-safe events: the invalid event is rejected; duplicate, closed-details, and no-layout aids have no marker; normal `+28` placement, right clamping, and 20-pixel vertical decluttering match the live rectangles. It computes all eight exact color pairs under explicit-light/system-light and their exact reversal under explicit-dark/system-dark. At 700 pixels only the rail is hidden; at 900 it renders again. Forced colors computes one-pixel-or-greater borders and a visible focus outline, reduced motion computes zero transition/animation durations, and print computes `display:none` for both presence surfaces. Failure/timeout/signal is not a pass and prints the retained remediation locator.

### Exact AST and ownership gates

```bash
set -euo pipefail

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3G_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
assert.match(base, /^[0-9a-f]{40,64}$/, "export P3G_BASE as the reviewed P1-D/P3-F predecessor commit");
const rows = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const paths = new Set([...rows(["diff", "--name-only", `${base}...HEAD`]), ...rows(["diff", "--name-only"]), ...rows(["diff", "--cached", "--name-only"]), ...rows(["ls-files", "--others", "--exclude-standard"])]);
for (const file of [...paths]) if (file.startsWith("docs/tickets/")) paths.delete(file);
assert.deepEqual([...paths].sort(), ["templates/base/presence.css", "templates/base/presence.js"]);
NODE
```

Expected: exit 0. The mandatory rendered gate has already parsed the complete script with pinned Acorn and proved the forbidden call/member surface plus the exact three-method local-storage API structurally; this gate makes no regex-based source claim. Export `P3G_BASE` as the reviewed P1-D/P3-F predecessor commit. The ownership oracle unions committed changes from `P3G_BASE...HEAD`, unstaged changes, staged changes, and untracked paths across the whole repository; after excluding ticket documents, the exact set is only `templates/base/presence.css` and `templates/base/presence.js`.

### Repository and issue gates

```bash
set -euo pipefail

test "$(grep -c '^## ' docs/tickets/P3-G.md)" -eq 12
test "$(grep '^## ' docs/tickets/P3-G.md | sed 's/^## //')" = "$(printf '%s\n' \
  'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' \
  'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' \
  'Assumptions and open questions' 'References')"
templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh
git diff --check
issue_json="$(gh issue view 20 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-G.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-G — Presence" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-G issue #20 pointer integrity'
echo 'PASS  P3-G repository gates'
```

Expected: every command exits 0. `check-dist` reports byte-identical documents, TypeScript emits no diagnostics, scrub reports no denied term/warning, and whitespace is clean. Issue #20 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the pointer gate prints `PASS  P3-G issue #20 pointer integrity`, and the final line is `PASS  P3-G repository gates`. Shared generated output is rebuilt only by the serialized integration owner after implementation; this document-only specification lane does not edit it.

## Failure modes

| Condition | Required behavior |
|---|---|
| File/artifact, missing predecessor surface, no/invalid session, invalid masthead | Stay silent: no storage, publish, timers, UI, global, log, or throw |
| Session is unfrozen, wide/reordered, wrong-prototype, accessor/symbol-bearing, nested-array-invalid, or has a wrong scalar | Invoke no getter, consume no activation, and remain silent so a later exact legacy/final record can activate |
| Realtime disabled or a default-visible first publish fails | Keep roster/rail/sweep UI dark and interval-free; a stored-hidden reader retains only the local recovery toggle; retry only on the explicit later lifecycle transitions or an accepted inbound event |
| Storage missing | Default visible; store only an optional `1` after Hide |
| Storage corrupt/unavailable or Show removal fails | Fail hidden; keep subscription/peer UI when transport is proved by an incoming event; publish nothing |
| Show removal succeeds but its immediate beat fails | Keep the visible choice. Before proof, retain recovery-only UI and no timers; after proof, preserve faces/rail/sweep and ensure the one 20-second beat interval. Never regress `transportProved` |
| Hide persistence fails | Hide current tab anyway, stop beats, and send one bye; future reads also fail hidden when storage remains unavailable |
| Beat publish is slow/fails | Never overlap or queue; keep prior UI, drop the result, and try only at the next allowed beat/lifecycle boundary |
| Duplicate/malformed/forged bus detail | Ignore it; invoke no accessor and change no roster/timer/UI |
| More than 200 distinct live IDs | Preserve the first 200 by first sight and drop new IDs until space expires/departs |
| Peer closes normally | Valid bye deletes and repaints immediately |
| Peer crashes, loses network, or hides | Entry becomes stale at 50 seconds and disappears on the next 5-second sweep; throttled background tabs sweep immediately when visible |
| Client ID rotates on token refresh | Old entry expires or receives bye; new ID is a new first sight. Never merge by label |
| Resume delivers an older missed beat | It may appear for at most one new 50-second lease; presence is approximate and no action depends on it. No speculative rewind broadens this case |
| Aid missing/invalid/duplicate or block hidden/no box | Keep masthead presence and omit only that location marker |
| Layout/storage/render operation throws | Contain it, retain last good state where possible, and preserve pagehide/timer cleanup |
| Opted-in pagehide publish cannot complete | Navigation is never blocked; peers fall back to lease expiry. A hidden-by-choice reader sends nothing |

## Settled decisions

- Presence is derived only in each tab from ephemeral client-channel traffic. It is never persisted, audited, queried as history, or used as a read receipt.
- P3-F is the only transport owner. P3-G uses its exact bus/publish seam and never imports Ably/provider/token/channel logic.
- A beat is immediate on visible activation and every 20 seconds while visible; a lease is 50 seconds with a 5-second sweep. These values are not configurable.
- No fresh SSE rewind is used. Existing visible peers reannounce within 20 seconds; durable consumers fetch their own initial state.
- Token-bound `clientId` is the roster key, but neither it nor a self-asserted label/activity/location authorizes, locks, or identifies durable work.
- External readers broadcast only literal `Guest`; members never fall back to email/sub. All remote labels remain untrusted display text.
- Hide-me stops outbound beats and sends one transition bye while subscription/peer visibility remains. Hidden activation and later lifecycle events publish nothing; storage uncertainty fails toward silence.
- The first-sight order is stable across renewals; delete/expiry followed by a beat is a new sight at the end.
- The masthead has at most five visible avatars plus a count. Rail markers are non-interactive decoration and vanish on narrow/print layouts.
- P4-I, not P3-G, owns edit claims/releases, editing activity, editing chips, and affordance hiding. Hash conflict checks remain authoritative.

## Assumptions and open questions

### Assumptions

- **Dark UI proof:** P3-F intentionally exposes no state getter/event. A successful opted-in publish or accepted client event is the narrowest proof that can keep no-key deployments visually dark. A reader already hidden by preference waits for an incoming event and emits no readiness probe, because even `bye` would disclose its token-bound client ID.
- **Lease quantization:** The requirement combines a 50-second lease with a shared 5-second sweep. An arbitrary beat can therefore remain until just under 55 seconds in an unthrottled foreground tab; it is stale at 50 seconds, and the first due sweep removes it. Claiming a strict wall-clock 50-second disappearance would require per-reader timers and contradict the fixed sweep.
- **Legacy session label:** P2-C accepts a transitional P1-C session before P3-H. Only the exact sole `member` role permits the server name; every other legacy/final roles shape uses `Guest`, which is the privacy-safe fallback.
- **Initial peer discovery:** With P3-F's no-rewind correction, a newly joined reader receives each existing visible peer's next beat within 20 seconds rather than reconstructing presence from possibly stale provider backlog. Its own immediate beat is visible to already connected peers promptly.
- **Rail ownership:** P3-C's comment rail remains private and P4-Q later publishes shared comment/suggestion controls. P3-G's separate pointer-free rail is presence-only, offset farther from the block, and never claims `window.doc.rail`.
- **Transparent proxies:** Browser JavaScript has no Node `isProxy` equivalent. Descriptor-safe validation rejects observable hostile traps/accessors but cannot prove an otherwise transparent object is not a Proxy; the bus is presentation-only and P3-F supplies frozen ordinary objects in production.

### Open questions

None block implementation. If real browser layout shows the fixed +28-pixel presence rail colliding with the P3-C comment rail at a supported viewport, preserve both owners and adjust only P3-G's documented offset through review; do not amend the comment rail or introduce shared rail ownership before P4-Q/P4-I sequencing.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.4, 1.6, 2.10–2.11, 4.1, 4.5, and 4.7 — computed ephemeral state, offline/artifact guarantees, optional broker, template ordering, fallback boundary, and authoritative P3-G/P4-I split.
- `docs/research/07-realtime-and-presence.md` §§4, 7–12 — 20-second beat, 50-second client lease, pagehide bye, first-sight roster, masthead/rail/hide-me UI, privacy, no persistence, and downstream editing boundary.
- `docs/tickets/P1-D.md` — permanent generated `data-aid` grammar/uniqueness, installed anchor surface, and P3-G block-marker dependency.
- `docs/tickets/P3-F.md` — frozen `publish()` surface, exact normalized `doc:event` variants, token-bound client ID, no-rewind decision, pagehide ordering, visibility/connection ownership, and fail-silent transport behavior.
- `docs/tickets/P1-B.md` — `PRESENCE_JS`/`PRESENCE_CSS` slots, `.head-top`/theme control, window namespace, asset order, and shared generated-output boundary.
- `docs/tickets/P2-C.md` — valid final/legacy session shapes, frozen detail, root reveal state, one-shot synchronous event, and module-listener order.
- GitHub issue #20 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
