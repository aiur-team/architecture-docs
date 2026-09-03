# P3-I — The share panel, read only

## Outcome

An authorized owner or editor gets a lazy, accessible read-only access popover in the masthead, while every offline, unshared, unauthorized, or degraded context has no misleading share control.

## Context

P3-H publishes the current reader's document role through P2-C's one `session` event and exposes a capability-gated roster endpoint. This ticket consumes those two seams without adding static layout markup or a second session request, so an exported file and an unconnected document remain clean static artifacts.

## Scope

### In scope

- Create `templates/base/share.js` in P1-B's existing ordered `SHARE_JS` slot and `templates/base/share.css` in its existing `SHARE_CSS` slot.
- Return before registering behavior outside HTTP(S), then listen once for P2-C's lowercase `session` event.
- Create the Share button only for a validated shared owner/editor session with `canSeeMembers: true`.
- Keep the Share button as the final direct `.head-top` child; the P3-C integration contract inserts its later-created comments toggle before an existing Share button.
- Lazily create a non-modal popover and fetch `GET /api/access?doc=<docId>` only when the reader opens it.
- Validate P3-H's exact roster response and render owner, grants, outstanding invitations, and organization default as inert text.
- Refresh on each closed-to-open transition, handle one request at a time, abort an in-flight request on close, and remove the complete feature on a `401`/`403` response.
- Support keyboard close/focus return, outside-click close, viewport-safe positioning, narrow screens, forced colors, and print suppression.

### Out of scope

- Adding markup to `layout.html`, changing P1-B placeholders/order, or changing `.head-top`, `.tt`, or base component CSS.
- Calling `/api/session`, reading cookies/tokens, deriving roles from email/compatibility `roles`, or treating DOM state as server authorization.
- Inviting, changing a role, revoking, cancelling, transferring ownership, or changing `orgDefault`. P4-L amends `share.js` with those controls after P4-J creates the write API.
- Editing P3-H's response, access resolution, the Edge gate, Identity, Blobs, or any server code.
- A modal/dialog, focus trap, route, full-screen application, live roster, polling, realtime subscription, service worker, client cache, or persisted panel state.
- A bearer share link, “copy secret link,” user autocomplete, organization directory, group/team sharing, co-owner display, or cross-document list.
- Rendering actor snapshots, grant/invitation audit fields, account-creation state, hashes, keys, ETags, or raw response/error data.
- A framework, package, polyfill, external icon/font, template test hook, production global, custom event, or new dependency.
- Editing generated `dist/**` directly or any file outside the two owned assets.

## Interface contract

### Module activation

`templates/base/share.js` is a side-effect-only inline browser ES module. It has no imports, exports, top-level `await`, global assignment, dependency, dynamic code generation, network API other than one direct `fetch()` call site, timer other than the request deadline, observer, worker, socket, event stream, storage, cookie, console call, or custom event.

At evaluation:

1. Return unless `location.protocol` is exactly `http:` or `https:`. In particular, `file:`, `data:`, `blob:`, and `about:` create no listener, control, request, error, or log.
2. Install exactly one `document` listener for the lowercase `session` event with `{ once: true }`. Do not inspect `data-session` and do not call `/api/session`.
3. When the event arrives, accept only a non-null, non-array object whose `doc` matches `^[0-9a-f]{6}$`, whose `shared` is exactly `true`, whose `canSeeMembers` is exactly `true`, and which has one of these consistent combinations:
   - `role === "owner"` and `canShare === true`;
   - `role === "editor"` and `canShare === false`.
4. Resolve `document.querySelector(".head-top")`. It must be an HTML element connected to this document. If the session or host is invalid, return permanently with no UI/request.
5. If a direct child with id `doc-share-button` or class `share-btn` already exists, return instead of duplicating or replacing it.
6. Create the exact button below and append it to `.head-top`, making it the last direct child at mount time. Store the validated `doc`, `role`, and `canShare` only in module-private variables; do not store the email/session object or copy any value to the root element.

```html
<button id="doc-share-button" class="tt share-btn" type="button"
        aria-haspopup="true" aria-expanded="false"
        aria-controls="doc-share-panel">Share</button>
```

The `.tt` class deliberately reuses P1-B's visual language. P3-I does not amend `.tt`. A forged browser event can at most create a button and attempt the same credentialed GET; P3-H remains the privacy boundary.

### Lazy popover DOM

The first button activation creates and appends this structure to `document.body`; later opens reuse it:

```text
aside#doc-share-panel.share-pop[hidden][aria-labelledby="doc-share-title"]
  header.share-head
    h2#doc-share-title[tabindex="-1"] "Access"
    button.share-close[type="button"] "Close access panel"
  p.share-status[role="status"][aria-live="polite"]
  p.share-default
  section.share-members[aria-labelledby="doc-share-members-title"]
    h3#doc-share-members-title "People with access"
    ul.share-list
  section.share-invitations[aria-labelledby="doc-share-invitations-title"]
    h3#doc-share-invitations-title "Pending invitations"
    ul.share-list
```

Construct every node with `createElement()`, `createTextNode()`, fixed attributes, and `textContent`. Do not use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write()`, `DOMParser`, a template element, or string-to-DOM parsing. The panel is an `aside`, not a modal dialog: it has no `role="dialog"`, `aria-modal`, backdrop, inert document, focus trap, or scroll lock.

On every closed-to-open transition:

1. Set `hidden = false`, button `aria-expanded="true"`, status text `Loading access…`, remember the button as the invoker, position the panel, focus the `h2`, and start one roster refresh.
2. If the panel is already open, button activation closes it; it does not start another request.
3. Closing sets `hidden = true`, `aria-expanded="false"`, aborts the current controller once, invalidates that request generation, cancels any queued positioning frame, and returns focus to the connected invoker. It preserves the last validated rendered roster in memory/DOM for the next open.
4. The close button, `Escape` while the panel is open, and a primary `pointerdown` whose target is outside both panel and button use that same close function. Do not close for a pointer event inside either element.

Install only fixed button/panel/document/window listeners. Remove open-only resize and capture-scroll listeners on close, or keep fixed listeners that return immediately while hidden. There is no mutation/resize observer, interval, delayed reopen, route change, or global event publication.

### Roster request

Each open creates one `AbortController`, a monotonically increasing private generation integer, and this endpoint:

```js
const endpoint = new URL("/api/access", location.href);
endpoint.searchParams.set("doc", docId);
```

Immediately before the direct fetch, start one five-second deadline that calls `controller.abort()`. Clear it once in a `finally` covering headers, body, validation, and render. The exact request is:

```js
fetch(endpoint, {
  method: "GET",
  mode: "same-origin",
  credentials: "same-origin",
  cache: "no-store",
  redirect: "error",
  headers: { Accept: "application/json" },
  signal: controller.signal,
});
```

There is at most one in-flight roster request. An open while open only closes; closing aborts; reopening starts one new generation. A settled response may update DOM only if its generation is still current and the panel remains open.

| Result | Behavior |
|---|---|
| `200` with exact supported JSON Content-Type and a valid body | Atomically replace roster rows/default, clear the status text, retain this as the last good view |
| `401` or `403` | Read no body; remove button and panel, clear all private roster/session state and listeners; return focus to the prior invoker when connected |
| Any other status | Read no body; retain last good rows; set status to `Access list could not be refreshed.` |
| Redirect, offline, rejection, abort, timeout, invalid Content-Type/JSON/body | For the current still-open generation, retain last good rows and use the same failure status; a close-triggered abort leaves the hidden panel unchanged |

Accept the response Content-Type only when ASCII case folding and optional surrounding ASCII space/tab produce exactly `application/json` or `application/json; charset=utf-8`; no other parameter/value is valid. Check `status` and Content-Type before touching the body. Read `response.headers.get("Content-Length")` once. When non-null, require `^(?:0|[1-9][0-9]{0,4})$`, convert with `Number()`, and require the result to be at most `65536`; this is the exact canonical decimal `0..65536` boundary. Absence is allowed, but empty, whitespace-bearing after header normalization, padded, signed, fractional, exponent, non-decimal, unsafe, or larger values fail before evaluating `response.body` or acquiring a reader.

For an otherwise eligible `200`, require `response.body` and acquire its reader exactly once. Read sequential `Uint8Array` chunks under the same five-second abort deadline, allowing arbitrary chunk boundaries but retaining at most 65,536 bytes total. Maintain an integer byte count before allocating/copying each chunk; a wrong chunk type, a count that is not a safe integer, a byte that would exceed 65,536, read rejection, or incomplete/aborted stream is the ordinary fixed refresh failure. On every exit before a successful `{ done: true }`, call `reader.cancel()` best-effort and never retain partial bytes; cancellation rejection does not replace the fixed failure. After `done`, concatenate once into an exact-size `Uint8Array`, decode once with `new TextDecoder("utf-8", { fatal: true })`, parse once with `JSON.parse()`, and then apply the closed roster validator. Put `reader.releaseLock()` in `finally` and call it exactly once whenever acquisition succeeded, after any required cancellation. Do not call `response.json()`, `text()`, `arrayBuffer()`, `blob()`, `formData()`, or clone the response. Never read or display a non-200 body. P3-H's maximum 50 child records and scalar bounds fit below 65,536 bytes; this client limit is an independent hostile-response memory boundary, not permission to truncate a valid roster.

### Exact roster input

Accept only a plain JSON object with exactly `doc`, `orgDefault`, `members`, and `invitations`, in that key order. `doc` must equal the session document. `orgDefault` is `commenter`, `viewer`, or `none`.

`members` is an array of 1 through 51 exact plain objects with keys `sub`, `email`, `name`, and `role`:

- Entry zero has `role: "owner"`, non-empty `sub`, non-empty `email`, and `name === ""`.
- Later entries have role `editor`, `commenter`, or `viewer`; non-empty `sub` and `email`; and string `name` with at most 200 UTF-16 code units.
- Every `sub` matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; every email is at most 254 ASCII characters, is lower-case, contains exactly one `@`, contains no control/whitespace/comma/colon/slash/backslash, and has non-empty local/domain sides.
- Member subjects are pairwise unique and member emails are independently pairwise unique by exact string equality across the owner and every non-owner row. Non-owner entries are already strictly increasing by email then sub under direct JavaScript string comparison. This is exactly P3-H's projected-member guarantee; invitation-email uniqueness is a separate invariant and no cross-array email uniqueness is claimed.

`invitations` is an array of 0 through 50 exact plain objects with keys `email`, `role`, and `expiresAt`:

- `email` follows the same client display boundary and is unique within this array.
- `role` is `editor`, `commenter`, or `viewer`.
- `expiresAt` matches `YYYY-MM-DDTHH:mm:ss.sssZ` and round-trips through `new Date(value).toISOString()`.
- Rows are already strictly increasing by email under direct JavaScript string comparison.

Require `(members.length - 1) + invitations.length <= 50`. JSON parsing cannot supply accessors, symbols, custom prototypes, sparse arrays, or cycles, but the validator must still reject null/array roots, missing/extra/wrong-order keys, wrong primitive types, duplicate rows, malformed strings, bad ordering, or an oversized response. Validation is all-or-nothing. Do not sort, repair, default, truncate, merge a grant/invitation with the same email, or render a valid prefix from a malformed body.

### Read-only rendering

On valid success, detach/rebuild only the two list contents and default paragraph, then swap them into their fixed parents. Response text enters only text nodes.

- `.share-default` is `Organization default: Commenter`, `Organization default: Viewer`, or `Organization default: No access`.
- A member list item is one paragraph-equivalent text line. With a non-empty name, render `NAME — EMAIL — ROLE`; with an empty name, render `EMAIL — ROLE`. Role labels are `Owner`, `Editor`, `Commenter`, and `Viewer`.
- An invitation list item is `EMAIL — ROLE — Pending until YYYY-MM-DD`, using the first ten canonical timestamp characters inside `<time datetime="FULL_TIMESTAMP">` for the date portion.
- When no invitations exist, hide the complete `.share-invitations` section with its `hidden` property. Otherwise reveal it.
- The panel contains no form, input, select, textarea, role menu, invite row, revoke/cancel/transfer/default button, mailto link, copied URL, or clickable email. P4-L creates controls only for a still-authorized owner.

The status live region announces loading/failure only; the complete member list is not a live region. A successful refresh clears status rather than announcing addresses. Emails remain visible only while the reader deliberately opens this server-authorized panel; do not place them in attributes, URLs, logs, title text, a client store, or another global.

### Positioning and CSS

The panel is appended to `body` and uses `position: absolute`. On open, successful render, window resize, and captured scroll while open, coalesce positioning through at most one `requestAnimationFrame()`:

- Let `lowerTop = window.scrollY + 8`, `upperTop = window.scrollY + window.innerHeight - panel.offsetHeight - 8`, `below = window.scrollY + rect.bottom + 8`, and `above = window.scrollY + rect.top - panel.offsetHeight - 8`, where `rect` is the button rectangle. If `upperTop < lowerTop`, use `lowerTop`; otherwise use `below` when `below <= upperTop`, and use `min(upperTop, max(lowerTop, above))` when the below placement would overflow. This prefers below, then above, then a vertically clamped position.
- Desired left is `window.scrollX + button.getBoundingClientRect().right - panel.offsetWidth`.
- Clamp left to the inclusive range from `window.scrollX + 8` through `window.scrollX + document.documentElement.clientWidth - panel.offsetWidth - 8`; when the upper bound is below the lower bound, use the lower bound.
- Require finite `window.innerHeight`, `panel.offsetHeight`, scroll offsets, and rectangle coordinates; otherwise close without issuing a request. Assign finite integer CSS pixels after rounding; do not use element text/data in a style.

`share.css` owns only `.share-*` selectors and their descendant/state/pseudo selectors. It does not restyle `.head-top`, `.tt`, `body`, generic elements, or another feature class.

- `.share-btn` remains a compact uppercase mono pill compatible with `.tt`, with a visible expanded state and `:focus-visible` outline.
- `.share-pop` has a maximum width of `min(24rem, calc(100vw - 1rem))`, `max-height: calc(100vh - 1rem)`, overflow auto, high local stacking order, readable spacing, border, background, foreground, and shadow using existing theme variables with explicit fallbacks.
- Header/rows wrap long display text without horizontal overflow; email text uses `overflow-wrap: anywhere`.
- Close button and every interactive state have visible hover and `:focus-visible` treatment. `forced-colors: active` preserves borders/outlines.
- At `max-width: 640px`, the panel uses the viewport width minus one rem; JavaScript's left clamp remains authoritative.
- There is no transition or animation. A `prefers-reduced-motion: reduce` rule explicitly removes scroll/animation behavior if later P4-L adds a descendant state.
- `@media print` hides `.share-btn` and `.share-pop` with `display: none !important`; no roster address appears in print.

## Files owned

- `templates/base/share.js` — **new**; side-effect-only read client. P4-L later amends this same file with owner write controls.
- `templates/base/share.css` — **new**; read-panel, responsive, focus, forced-colors, and print styles.
- `docs/tickets/P3-I.md` — this specification, not an implementation path.

No other implementation path is owned. Do not amend `templates/base/layout.html`, `templates/base/app.js`, `templates/base/components.css`, `templates/base/session.js`, `templates/base/comments.js`, the builder, any server file, or generated output. The P3-C owner records its sibling-safe insertion behavior in P3-C; P3-I does not take ownership of that file.

## Dependencies

- **P1-B:** supplies the `SHARE_JS`/`SHARE_CSS` slots, inline module order with share before session, `window.doc`, `.head-top`, `.tt`, theme variables, and zero-byte absence. P3-I uses those seams without changing the builder or layout.
- **P2-C:** sends the sole `/api/session?doc=` request, validates/freezes the final P3-H body, and dispatches one `session` event after all feature listeners exist. P3-I never makes a second identity/session probe.
- **P3-H:** supplies `doc`, `role`, `shared`, `canShare`, and `canSeeMembers` in the event body and the exact capability-gated `GET /api/access` response consumed here. It rejects owner-to-grant and grant-to-grant projected-member email collisions, so its successful `members` array has exactly the pairwise subject/email uniqueness this client revalidates; it makes no cross-array email-uniqueness promise.

P3-C is not an authorization or code dependency, but both modules add direct masthead controls. Its finalized integration contract inserts `#doc-comments-toggle` immediately before an existing direct `.share-btn`, otherwise appends, so the share button remains last regardless of response timing. P4-L is the sole later owner allowed to amend `share.js` and must preserve this ticket's offline/read-only/refresh/privacy behavior while adding controls only for `role: "owner"` and `canShare: true`.

### Maximum safe implementation waves

1. `share.js` activation, session validation, request/response validation, and inert rendering may be authored independently from the stylesheet.
2. `share.css` focus/theme/responsive/print states may be authored against the fixed class/DOM contract in parallel.
3. Serialize browser integration after P2-C/P3-H and the finalized P3-C header insertion rule are present. Do not run a shared `dist/**` rebuild or browser dependency installation concurrently with another ticket's integration gate.

## Acceptance criteria

- [ ] Only the two owned feature assets are created; no layout, builder, comments, session, server, dependency, or generated source is changed.
- [ ] Non-HTTP(S), absent/invalid session, unshared, commenter, viewer, and missing-host cases create no listener-dependent UI, request, log, or exception.
- [ ] A consistent owner/editor event creates exactly one direct masthead Share button, after all existing children and with the exact accessible attributes; P3-C's delayed toggle remains before it.
- [ ] There is no access request before an open; each closed-to-open transition starts exactly one bounded same-origin GET; close aborts/invalidates it; there is never more than one in flight or any poll/retry loop.
- [ ] A `200` body is decoded only through the exact 65,536-byte streaming boundary: canonical Content-Length precheck, one reader, bounded `Uint8Array` chunks, best-effort pre-completion cancellation, exactly-once lock release, fatal UTF-8 decode, one `JSON.parse()`, and no convenience body method.
- [ ] `401`/`403` removes the complete feature and state; every other request/parse/validation failure retains the last good roster and exposes only the fixed safe status.
- [ ] The exact closed response validator rejects all shape/type/size/order/uniqueness/document/timestamp violations before any partial render.
- [ ] Valid data renders deterministic owner/member/invitation/default text, hides an empty invitation section, and never creates P4-L controls or exposes private fields.
- [ ] All server strings enter as inert text; addresses never enter attributes, URLs, logs, live-region announcements, print, persistence, or globals. The runtime fixture poisons/observes every named browser sink and global surface, while the TypeScript AST walk rejects forbidden structural API use even in a branch the fixture does not execute.
- [ ] Toggle, close button, Escape, outside pointer, focus return, non-modal reading, and viewport clamping behave as specified without trapping focus or locking scroll; the exact `innerHeight`/`offsetHeight` calculation executes below, above-after-bottom-overflow, and neither-side-fits clamp cases.
- [ ] The exact rendered gate executes light/dark inherited variables, keyboard `:focus-visible`, forced colors, narrow viewport, reduced motion, and print states against real CSS; `.share-btn` and `.share-pop` are absent from print, and the bounded owned process groups/install/cache/root leave no residue after success.
- [ ] Exact heading, Bash-fence, scrub, docbuild, distribution, whitespace, file-ownership, and issue #22 pointer-integrity gates pass: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

All identifiers, people, addresses, hosts, and response values below are invented public fixtures.

### 1. Static source and stylesheet contract

```bash
set -euo pipefail

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("./templates/docbuild/node_modules/typescript");
const js = readFileSync("templates/base/share.js", "utf8");
const css = readFileSync("templates/base/share.css", "utf8");
for (const token of [
  'addEventListener("session"', 'querySelector(".head-top")', 'doc-share-button', 'doc-share-panel',
  'new URL("/api/access"', 'searchParams.set("doc"', 'credentials: "same-origin"', 'cache: "no-store"',
  'redirect: "error"', 'application/json', 'createElement', 'createTextNode', 'textContent',
]) assert.ok(js.includes(token), `missing source contract: ${token}`);
const tree = ts.createSourceFile("share.js", js, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
assert.deepEqual(tree.parseDiagnostics.map(({ messageText }) => String(messageText)), []);
const accessName = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
const rootName = (node) => {
  const expression = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
  return expression && ts.isIdentifier(expression) ? expression.text : null;
};
const baseName = (node) => ts.isIdentifier(node) ? node.text : (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) ? baseName(node.expression) : null;
const forbiddenGlobals = new Set(["localStorage", "sessionStorage", "indexedDB", "caches", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "MutationObserver", "ResizeObserver", "DOMParser", "CustomEvent", "alert", "setInterval"]);
const forbiddenMembers = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML"]);
const bodyMethods = new Set(["json", "text", "arrayBuffer", "blob", "formData"]);
const counts = { fetch: 0, getReader: 0, contentLength: 0, cancel: 0, releaseLock: 0, parse: 0 };
const failures = [];
const visit = (node) => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isImportEqualsDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword || node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) failures.push("module syntax");
  if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) failures.push(`forbidden global ${node.text}`);
  if (ts.isCallExpression(node)) {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : accessName(node.expression);
    const root = rootName(node.expression);
    if (name === "fetch") counts.fetch += 1;
    if (name === "getReader") counts.getReader += 1;
    if (name === "cancel") counts.cancel += 1;
    if (name === "releaseLock") counts.releaseLock += 1;
    if (name === "get" && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.toLowerCase() === "content-length") counts.contentLength += 1;
    if (root === "JSON" && name === "parse") counts.parse += 1;
    if (bodyMethods.has(name)) failures.push(`whole-body method ${name}`);
    if (name === "dispatchEvent" || name === "eval" || name === "Function" || name === "setInterval" || (root === "document" && name === "write") || (root === "navigator" && name === "sendBeacon") || (root === "history" && ["pushState", "replaceState"].includes(name)) || (root === "location" && ["assign", "replace"].includes(name))) failures.push(`forbidden call ${root ?? ""}.${name}`);
  }
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
    const name = accessName(node), root = rootName(node);
    if (forbiddenMembers.has(name) || root === "console" || (root === "document" && name === "cookie") || (root === "navigator" && name === "serviceWorker")) failures.push(`forbidden member ${root ?? ""}.${name}`);
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") failures.push("dynamic Function");
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
    if (["window", "globalThis"].includes(baseName(node.left))) failures.push("global assignment");
    if (baseName(node.left) === "location") failures.push("location assignment");
  }
  ts.forEachChild(node, visit);
};
visit(tree);
assert.deepEqual(failures, []);
assert.deepEqual(counts, { fetch: 1, getReader: 1, contentLength: 1, cancel: 1, releaseLock: 1, parse: 1 });
assert.match(js, /new\s+TextDecoder\s*\(\s*["']utf-8["']\s*,\s*\{\s*fatal\s*:\s*true\s*\}\s*\)/);
assert.match(js, /65_?536/);
for (const token of [
  ".share-btn", ".share-pop", ".share-status", ".share-members", ".share-invitations",
  "position: absolute", "overflow-wrap: anywhere", ":focus-visible", "forced-colors: active",
  "max-width: 640px", "prefers-reduced-motion: reduce", "@media print", "display: none !important",
]) assert.ok(css.includes(token), `missing CSS contract: ${token}`);
for (const selector of css.match(/([^{}]+)\{/g) ?? []) {
  const value = selector.slice(0, -1).trim();
  if (value.startsWith("@")) continue;
  for (const part of value.split(",")) assert.ok(part.trim().startsWith(".share-"), `foreign selector: ${part.trim()}`);
}
console.log("PASS  P3-I static source and stylesheet contract");
NODE
```

Expected: exactly `PASS  P3-I static source and stylesheet contract` and exit `0`. The TypeScript parser walks executable syntax rather than comments or string literals: it rejects module/dynamic-code/global-assignment and every named forbidden API surface, rejects every convenience body-reader call regardless of receiver spelling, and counts the sole fetch/stream/decode operations structurally.

### 2. Deterministic read-only browser-module behavior

This fixture evaluates the real source with a small deterministic DOM boundary. The interface above deliberately confines the implementation to the supplied standard methods. It starts no server or descendant and makes no external request.

```bash
set -euo pipefail

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener, options = {}) { const rows = this.listeners.get(type) ?? []; rows.push({ listener, once: options === true || options?.once === true }); this.listeners.set(type, rows); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((row) => row.listener !== listener)); }
  async emit(type, init = {}) { const event = { ...init, type, target: init.target ?? this, key: init.key, button: init.button ?? 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, composedPath() { return [this.target]; } }; for (const row of [...(this.listeners.get(type) ?? [])]) { row.listener.call(this, event); if (row.once) this.removeEventListener(type, row.listener); } return event; }
}
class ClassList { constructor() { this.values = new Set(); } add(...values) { values.forEach((v) => this.values.add(v)); } contains(value) { return this.values.has(value); } }
class Element extends Target {
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.children = []; this.parentNode = null; this.attributes = new Map(); this.classList = new ClassList(); this.style = {}; this.hidden = false; this._text = ""; this.offsetWidth = 320; this.offsetHeight = 240; this._rect = null; this.isConnected = true; }
  set id(value) { this.setAttribute("id", value); } get id() { return this.getAttribute("id") ?? ""; }
  set className(value) { this.classList = new ClassList(); for (const token of String(value).split(/\s+/)) if (token) this.classList.add(token); } get className() { return [...this.classList.values].join(" "); }
  set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "class") this.className = value; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) { for (const value of nodes) { const node = typeof value === "string" ? new TextNode(value, this.ownerDocument) : value; node.parentNode = this; node.isConnected = this.isConnected; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const child of this.children) { child.parentNode = null; child.isConnected = false; } this.children = []; this._text = ""; this.append(...nodes); }
  insertBefore(node, before) { const index = this.children.indexOf(before); if (index < 0) return this.appendChild(node); node.parentNode = this; this.children.splice(index, 0, node); return node; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; this.isConnected = false; }
  contains(node) { for (let current = node; current; current = current.parentNode) if (current === this) return true; return false; }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return this._rect ?? { top: 20, bottom: 44, left: 680, right: 720, width: 40, height: 24 }; }
  querySelector(selector) { return walk(this).find((node) => matches(node, selector)) ?? null; }
  querySelectorAll(selector) { return walk(this).filter((node) => matches(node, selector)); }
}
class TextNode extends Element { constructor(text, owner) { super("#text", owner); this._text = String(text); } }
const walk = (root) => root.children.flatMap((child) => [child, ...walk(child)]);
const matches = (node, selector) => selector.startsWith("#") ? node.id === selector.slice(1) : selector.startsWith(".") ? node.classList.contains(selector.slice(1)) : node.tagName === selector.toUpperCase();
class Document extends Target {
  constructor() { super(); this.documentElement = { clientWidth: 800 }; this.body = new Element("body", this); this.activeElement = null; this.headTop = new Element("div", this); this.headTop.classList.add("head-top"); this.body.append(this.headTop); const theme = new Element("button", this); theme.id = "tt"; this.headTop.append(theme); }
  createElement(tag) { return new Element(tag, this); } createTextNode(text) { return new TextNode(text, this); }
  querySelector(selector) { if (selector === ".head-top") return this.headTop; return this.body.querySelector(selector); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
}
const roster = {
  doc: "4b7d2a", orgDefault: "commenter",
  members: [
    { sub: "u_fixture_owner_11", email: "owner@example.com", name: "", role: "owner" },
    { sub: "u_fixture_editor_33", email: "editor@partner.invalid", name: '<img src=x onerror="fixture">', role: "editor" },
  ],
  invitations: [{ email: "pending@review.invalid", role: "commenter", expiresAt: "2099-10-02T09:18:11.400Z" }],
};
const session = (role) => ({ doc: "4b7d2a", shared: true, role, canSeeMembers: ["owner", "editor"].includes(role), canShare: role === "owner" });
async function run({ protocol = "https:", detail = session("owner"), emitSession = true, host = true, duplicate = false, timeoutImmediately = false, rejectOnAbort = false } = {}) {
  const document = new Document(); const window = new Target(); Object.assign(window, { scrollX: 0, scrollY: 0, innerWidth: 800, innerHeight: 800 });
  const sinkTouches = [], urlConstructions = [];
  const poison = (name) => { sinkTouches.push(name); throw new Error(`forbidden sink ${name}`); };
  const poisonedConsole = new Proxy({}, { get(_target, name) { return () => poison(`console.${String(name)}`); } });
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) Object.defineProperty(window, name, { configurable: true, get() { return poison(`window.${name}`); } });
  Object.defineProperty(document, "cookie", { configurable: true, get() { return poison("document.cookie:get"); }, set() { poison("document.cookie:set"); } });
  window.history = { pushState() { poison("history.pushState"); }, replaceState() { poison("history.replaceState"); } };
  window.navigator = { sendBeacon() { poison("navigator.sendBeacon"); }, get serviceWorker() { return poison("navigator.serviceWorker"); } };
  window.alert = () => poison("window.alert");
  if (!host) { document.headTop.remove(); document.headTop = null; }
  if (duplicate && document.headTop) { const existing = new Element("button", document); existing.classList.add("share-btn"); document.headTop.append(existing); }
  let fetches = 0, status = 200, responseBody = roster, contentType = "application/json; charset=utf-8", nextReply = null;
  const signals = [];
  const fetch = async (url, options) => {
    fetches += 1; signals.push(options.signal);
    assert.equal(String(url), "https://docs.fixture.invalid/api/access?doc=4b7d2a");
    assert.deepEqual({ method: options.method, mode: options.mode, credentials: options.credentials, cache: options.cache, redirect: options.redirect, accept: options.headers.Accept }, { method: "GET", mode: "same-origin", credentials: "same-origin", cache: "no-store", redirect: "error", accept: "application/json" });
    if (rejectOnAbort) return new Promise((_resolve, reject) => {
      if (options.signal.aborted) reject(new Error("fixture abort"));
      else options.signal.addEventListener("abort", () => reject(new Error("fixture abort")), { once: true });
    });
    if (nextReply) { const reply = nextReply; nextReply = null; return typeof reply === "function" ? reply() : reply; }
    return new Response(status === 200 ? JSON.stringify(responseBody) : null, { status, headers: status === 200 && contentType !== null ? { "Content-Type": contentType } : {} });
  };
  const deadline = timeoutImmediately
    ? (callback, milliseconds) => { assert.equal(milliseconds, 5_000); Promise.resolve().then(callback); return 1; }
    : setTimeout;
  const cancelDeadline = timeoutImmediately ? () => {} : clearTimeout;
  let pageHref = `${protocol}//docs.fixture.invalid/guide`;
  const location = { get protocol() { return protocol; }, get href() { return pageHref; }, set href(_value) { poison("location.href"); }, assign() { poison("location.assign"); }, replace() { poison("location.replace"); } };
  class ObservedURL extends URL { constructor(input, base) { super(input, base); urlConstructions.push({ input: String(input), base: base === undefined ? undefined : String(base), href: this.href }); } }
  const sandbox = { document, window, location, fetch, URL: ObservedURL, Response, Headers, AbortController, TextDecoder, Uint8Array, HTMLElement: Element, requestAnimationFrame: (callback) => { callback(0); return 1; }, cancelAnimationFrame: () => {}, setTimeout: deadline, clearTimeout: cancelDeadline, Date, JSON, Object, Array, String, RegExp, Math, console: poisonedConsole, navigator: window.navigator, history: window.history, alert: window.alert };
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) Object.defineProperty(sandbox, name, { configurable: true, get() { return poison(`global.${name}`); } });
  const windowKeys = Object.keys(window).sort();
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync("templates/base/share.js", "utf8"), context, { timeout: 1_000 });
  if (emitSession) await document.emit("session", { target: document, detail });
  const assertSafeSinks = () => {
    assert.deepEqual(sinkTouches, []);
    assert.deepEqual(Object.keys(window).sort(), windowKeys);
    assert.deepEqual(Object.keys(window.doc ?? {}).sort(), []);
    for (const entry of urlConstructions) assert.deepEqual(entry, { input: "/api/access", base: pageHref, href: "https://docs.fixture.invalid/api/access" });
  };
  assertSafeSinks();
  const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); assertSafeSinks(); };
  return {
    document, window, signals, urlConstructions,
    get fetches() { return fetches; },
    setStatus(value) { status = value; }, setBody(value) { responseBody = value; }, setContentType(value) { contentType = value; },
    setNextReply(value) { nextReply = value; }, settle, assertSafeSinks,
  };
}

for (const protocol of ["file:", "data:", "blob:", "about:"]) {
  const offline = await run({ protocol }); assert.equal(offline.document.querySelector(".share-btn"), null); assert.equal(offline.fetches, 0); assert.equal((offline.document.listeners.get("session") ?? []).length, 0);
}
const absent = await run({ emitSession: false }); assert.equal(absent.document.querySelector(".share-btn"), null); assert.equal(absent.fetches, 0); assert.equal((absent.document.listeners.get("session") ?? []).length, 1);
for (const role of ["commenter", "viewer"]) { const denied = await run({ detail: session(role) }); assert.equal(denied.document.querySelector(".share-btn"), null); assert.equal(denied.fetches, 0); }
const missingHost = await run({ host: false }); assert.equal(missingHost.document.querySelector(".share-btn"), null); assert.equal(missingHost.fetches, 0);
for (const detail of [null, {}, { ...session("owner"), shared: false }, { ...session("owner"), doc: "BAD" }, { ...session("owner"), canShare: false }, { ...session("editor"), canShare: true }]) {
  const invalid = await run({ detail }); assert.equal(invalid.document.querySelector(".share-btn"), null); assert.equal(invalid.fetches, 0);
}
const duplicate = await run({ duplicate: true }); assert.equal(duplicate.document.headTop.children.filter((child) => child.classList.contains("share-btn")).length, 1); assert.equal(duplicate.fetches, 0);
const editor = await run({ detail: session("editor") }); assert.ok(editor.document.querySelector(".share-btn")); assert.equal(editor.fetches, 0);
const owner = await run(); const button = owner.document.querySelector(".share-btn");
assert.ok(button); assert.equal(owner.document.headTop.children.at(-1), button); assert.equal(button.tagName, "BUTTON"); assert.equal(button.id, "doc-share-button"); assert.equal(button.classList.contains("tt"), true); assert.equal(button.classList.contains("share-btn"), true);
assert.deepEqual([button.getAttribute("type"), button.getAttribute("aria-haspopup"), button.getAttribute("aria-expanded"), button.getAttribute("aria-controls"), button.textContent], ["button", "true", "false", "doc-share-panel", "Share"]); assert.equal(owner.fetches, 0);
const delayedComments = new Element("button", owner.document); delayedComments.id = "doc-comments-toggle"; owner.document.headTop.insertBefore(delayedComments, button); assert.equal(owner.document.headTop.children.at(-1), button); assert.equal(owner.document.headTop.children.at(-2), delayedComments);
await button.emit("click", { target: button }); await owner.settle();
const panel = owner.document.getElementById("doc-share-panel"); assert.ok(panel); assert.equal(panel.hidden, false); assert.equal(button.getAttribute("aria-expanded"), "true"); assert.equal(owner.fetches, 1);
assert.match(panel.textContent, /owner@example\.com — Owner/); assert.match(panel.textContent, /<img src=x onerror="fixture"> — editor@partner\.invalid — Editor/); assert.match(panel.textContent, /pending@review\.invalid — Commenter — Pending until 2099-10-02/);
assert.equal(panel.getAttribute("role"), null); assert.equal(panel.getAttribute("aria-modal"), null); assert.equal(owner.document.body.getAttribute("inert"), null); assert.deepEqual(owner.document.body.style, {});
for (const tag of ["img", "form", "input", "select", "textarea", "a"]) assert.equal(panel.querySelector(tag), null);
assert.deepEqual(panel.querySelectorAll("button").map((node) => node.className), ["share-close"]);
assert.equal(panel.querySelector(".share-status").textContent, "");
assert.equal(panel.querySelector(".share-status").textContent.includes("@"), false);
for (const node of [panel, ...walk(panel)]) for (const value of node.attributes.values()) { assert.doesNotMatch(value, /@|<img/i); }
owner.assertSafeSinks();
await button.emit("click", { target: button }); assert.equal(panel.hidden, true); assert.equal(button.getAttribute("aria-expanded"), "false"); assert.equal(owner.document.activeElement, button);
await button.emit("click", { target: button }); await owner.settle(); assert.equal(owner.fetches, 2);
await owner.document.emit("keydown", { target: panel, key: "Escape" }); assert.equal(panel.hidden, true); assert.equal(owner.document.activeElement, button);
owner.setStatus(500); await button.emit("click", { target: button }); await owner.settle();
assert.equal(owner.fetches, 3); assert.match(panel.textContent, /owner@example\.com — Owner/); assert.equal(panel.querySelector(".share-status").textContent, "Access list could not be refreshed.");
await button.emit("click", { target: button }); owner.setStatus(403); await button.emit("click", { target: button }); await owner.settle();
assert.equal(owner.fetches, 4); assert.equal(owner.document.querySelector(".share-btn"), null); assert.equal(owner.document.querySelector(".share-pop"), null);

const closeControl = await run(); const closeControlButton = closeControl.document.querySelector(".share-btn");
await closeControlButton.emit("click", { target: closeControlButton }); await closeControl.settle();
const closeControlPanel = closeControl.document.querySelector(".share-pop");
await closeControlPanel.querySelector(".share-close").emit("click", { target: closeControlPanel.querySelector(".share-close") });
assert.equal(closeControlPanel.hidden, true); assert.equal(closeControl.document.activeElement, closeControlButton);

for (const revokedStatus of [401, 403]) {
  const revoked = await run(); revoked.setStatus(revokedStatus); const revokedButton = revoked.document.querySelector(".share-btn");
  await revokedButton.emit("click", { target: revokedButton }); await revoked.settle();
  assert.equal(revoked.fetches, 1); assert.equal(revoked.document.querySelector(".share-btn"), null); assert.equal(revoked.document.querySelector(".share-pop"), null);
  assert.equal([...revoked.document.listeners.values()].reduce((sum, rows) => sum + rows.length, 0), 0); assert.equal([...revoked.window.listeners.values()].reduce((sum, rows) => sum + rows.length, 0), 0);
}

const pointer = await run(); const pointerButton = pointer.document.querySelector(".share-btn");
await pointerButton.emit("click", { target: pointerButton }); await pointer.settle();
const pointerPanel = pointer.document.querySelector(".share-pop");
await pointer.document.emit("pointerdown", { target: pointerPanel, button: 0 }); assert.equal(pointerPanel.hidden, false, "inside pointer stays open");
await pointer.document.emit("pointerdown", { target: pointer.document.body, button: 0 }); assert.equal(pointerPanel.hidden, true, "outside primary pointer closes"); assert.equal(pointer.document.activeElement, pointerButton);

const positioned = await run(); const positionedButton = positioned.document.querySelector(".share-btn");
await positionedButton.emit("click", { target: positionedButton }); await positioned.settle();
const positionedPanel = positioned.document.querySelector(".share-pop");
assert.deepEqual([positionedPanel.style.top, positionedPanel.style.left], ["52px", "400px"]);
positioned.window.scrollX = 100; positioned.window.scrollY = 25; await positioned.window.emit("resize", { target: positioned.window });
assert.deepEqual([positionedPanel.style.top, positionedPanel.style.left], ["77px", "500px"]);
positioned.window.innerHeight = 700; positionedButton._rect = { top: 650, bottom: 674, left: 680, right: 720, width: 40, height: 24 };
await positioned.window.emit("resize", { target: positioned.window });
assert.deepEqual([positionedPanel.style.top, positionedPanel.style.left], ["427px", "500px"], "bottom overflow prefers the clamped above position");
positioned.window.scrollY = 0; positioned.window.innerHeight = 300; positionedButton._rect = { top: 100, bottom: 124, left: 680, right: 720, width: 40, height: 24 };
await positioned.window.emit("resize", { target: positioned.window });
assert.equal(positionedPanel.style.top, "8px", "when neither side fits, clamp the above candidate to the viewport top inset");

let releaseHeld;
const heldResponse = new Promise((resolve) => { releaseHeld = resolve; });
const closing = await run(); closing.setNextReply(heldResponse); const closingButton = closing.document.querySelector(".share-btn");
await closingButton.emit("click", { target: closingButton }); assert.equal(closing.fetches, 1); assert.equal(closing.signals[0].aborted, false);
const loadingPanel = closing.document.querySelector(".share-pop"); const loadingHeading = closing.document.getElementById("doc-share-title");
assert.equal(loadingPanel.hidden, false); assert.equal(loadingPanel.querySelector(".share-status").textContent, "Loading access…"); assert.equal(closing.document.activeElement, loadingHeading);
await closingButton.emit("click", { target: closingButton }); assert.equal(closing.document.querySelector(".share-pop").hidden, true); assert.equal(closing.signals[0].aborted, true);
releaseHeld(new Response(JSON.stringify(roster), { status: 200, headers: { "Content-Type": "application/json" } })); await closing.settle();
assert.equal(closing.document.querySelector(".share-pop").hidden, true); assert.equal(closing.document.querySelector(".share-members").textContent.includes("owner@example.com"), false, "closed stale generation cannot render");

const timed = await run({ timeoutImmediately: true, rejectOnAbort: true }); const timedButton = timed.document.querySelector(".share-btn");
await timedButton.emit("click", { target: timedButton }); await timed.settle();
assert.equal(timed.signals[0].aborted, true); assert.equal(timed.document.querySelector(".share-pop").hidden, false);
assert.equal(timed.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");

for (const reply of [new Response("{", { status: 200, headers: { "Content-Type": "application/json" } }), () => { throw new Error("invented offline failure"); }]) {
  const failed = await run(); failed.setNextReply(reply); const failedButton = failed.document.querySelector(".share-btn");
  await failedButton.emit("click", { target: failedButton }); await failed.settle(); assert.equal(failed.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
}

const rosterBytes = JSON.stringify(roster);
const makeStreamReply = (chunks, contentLength = null, { readRejectAt = 0, cancelReject = false } = {}) => {
  const state = { getReader: 0, reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const body = { getReader() {
    state.getReader += 1;
    return {
      async read() { state.reads += 1; if (readRejectAt === state.reads) throw new Error("invented read failure"); return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }; },
      async cancel() { state.cancels += 1; if (cancelReject) throw new Error("invented cancel failure"); },
      releaseLock() { state.releases += 1; },
    };
  } };
  const headers = new Headers({ "Content-Type": "application/json" });
  if (contentLength !== null) headers.set("Content-Length", contentLength);
  return { reply: { status: 200, headers, body }, state };
};
for (const reply of [
  new Response(rosterBytes, { status: 200, headers: { "Content-Type": "application/json", "Content-Length": "065536" } }),
  new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }),
  new Response(Uint8Array.of(0xc3, 0x28), { status: 200, headers: { "Content-Type": "application/json" } }),
]) {
  const failed = await run(); failed.setNextReply(reply); const failedButton = failed.document.querySelector(".share-btn");
  await failedButton.emit("click", { target: failedButton }); await failed.settle();
  assert.equal(failed.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
}
{
  const bytes = new Uint8Array(Buffer.from(rosterBytes + " ".repeat(65_536 - Buffer.byteLength(rosterBytes))));
  assert.equal(bytes.byteLength, 65_536);
  const boundaryReply = makeStreamReply([bytes.slice(0, 1), bytes.slice(1, 32_768), bytes.slice(32_768)], "65536");
  const boundary = await run(); boundary.setNextReply(boundaryReply.reply);
  const boundaryButton = boundary.document.querySelector(".share-btn"); await boundaryButton.emit("click", { target: boundaryButton }); await boundary.settle();
  assert.equal(boundary.document.querySelector(".share-status").textContent, "");
  assert.deepEqual(boundaryReply.state, { getReader: 1, reads: 4, cancels: 0, releases: 1 });
}
{
  const overLimitReply = makeStreamReply([new Uint8Array(32_768), new Uint8Array(32_769)]);
  const failed = await run(); failed.setNextReply(overLimitReply.reply);
  const failedButton = failed.document.querySelector(".share-btn"); await failedButton.emit("click", { target: failedButton }); await failed.settle();
  assert.equal(failed.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
  assert.deepEqual(overLimitReply.state, { getReader: 1, reads: 2, cancels: 1, releases: 1 });
}
for (const streamCase of [
  { reply: makeStreamReply([new Uint8Array(Buffer.from("{")), "wrong chunk"]), expected: { getReader: 1, reads: 2, cancels: 1, releases: 1 } },
  { reply: makeStreamReply([new Uint8Array(Buffer.from("{"))], null, { readRejectAt: 2 }), expected: { getReader: 1, reads: 2, cancels: 1, releases: 1 } },
  { reply: makeStreamReply([new Uint8Array(65_537)], null, { cancelReject: true }), expected: { getReader: 1, reads: 1, cancels: 1, releases: 1 } },
]) {
  const failed = await run(); failed.setNextReply(streamCase.reply.reply);
  const failedButton = failed.document.querySelector(".share-btn"); await failedButton.emit("click", { target: failedButton }); await failed.settle();
  assert.equal(failed.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
  assert.deepEqual(streamCase.reply.state, streamCase.expected);
}
{
  let bodyTouches = 0;
  const tooLargeHeader = new Response(rosterBytes, { status: 200, headers: { "Content-Type": "application/json", "Content-Length": "65537" } });
  const untouchedBody = tooLargeHeader.body;
  Object.defineProperty(tooLargeHeader, "body", { get() { bodyTouches += 1; return untouchedBody; } });
  const failed = await run(); failed.setNextReply(tooLargeHeader);
  const failedButton = failed.document.querySelector(".share-btn"); await failedButton.emit("click", { target: failedButton }); await failed.settle();
  assert.equal(failed.document.querySelector(".share-status").textContent, "Access list could not be refreshed."); assert.equal(bodyTouches, 0);
}

const emptyInvitations = await run(); emptyInvitations.setBody({ ...roster, invitations: [] }); const emptyInvitationsButton = emptyInvitations.document.querySelector(".share-btn");
await emptyInvitationsButton.emit("click", { target: emptyInvitationsButton }); await emptyInvitations.settle();
assert.equal(emptyInvitations.document.querySelector(".share-invitations").hidden, true);

for (const contentType of ["application/json", "Application/JSON; Charset=UTF-8", "\tapplication/json; charset=utf-8\t"]) {
  const validType = await run(); validType.setContentType(contentType); const validButton = validType.document.querySelector(".share-btn");
  await validButton.emit("click", { target: validButton }); await validType.settle(); assert.equal(validType.document.querySelector(".share-status").textContent, "");
}
for (const contentType of [null, "text/json", "application/json; charset=us-ascii", "application/json; charset=utf-8; profile=fixture", "application/json, text/plain", "application/json;charset=\"utf-8\""]) {
  const invalidType = await run(); invalidType.setContentType(contentType); const invalidButton = invalidType.document.querySelector(".share-btn");
  await invalidButton.emit("click", { target: invalidButton }); await invalidType.settle(); assert.equal(invalidType.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
}

const unsortedMembers = [{ sub: "u_fixture_owner_11", email: "owner@example.com", name: "", role: "owner" }, { sub: "u_fixture_zed_44", email: "zed@review.invalid", name: "Zed", role: "viewer" }, { sub: "u_fixture_alpha_33", email: "alpha@review.invalid", name: "Alpha", role: "editor" }];
const oversizedMembers = [roster.members[0], ...Array.from({ length: 50 }, (_, index) => ({ sub: `u_fixture_${String(index).padStart(2, "0")}`, email: `person${String(index).padStart(2, "0")}@review.invalid`, name: "Fixture", role: "viewer" }))];
const tooManyMembers = [roster.members[0], ...Array.from({ length: 51 }, (_, index) => ({ sub: `u_fixture_many_${String(index).padStart(2, "0")}`, email: `many${String(index).padStart(2, "0")}@review.invalid`, name: "Fixture", role: "viewer" }))];
const tooManyInvitations = Array.from({ length: 51 }, (_, index) => ({ email: `invite${String(index).padStart(2, "0")}@review.invalid`, role: "viewer", expiresAt: "2099-10-02T09:18:11.400Z" }));
const ownerRow = roster.members[0], editorRow = roster.members[1], invitationRow = roster.invitations[0];
for (const invalidBody of [
  null, [], "invalid root",
  { orgDefault: roster.orgDefault, doc: roster.doc, members: roster.members, invitations: roster.invitations },
  { ...roster, doc: "ffffff" }, { ...roster, doc: 17 }, { ...roster, extra: true }, { ...roster, orgDefault: "editor" },
  { ...roster, members: null }, { ...roster, members: {} }, { ...roster, members: [] }, { ...roster, invitations: null }, { ...roster, invitations: {} },
  { ...roster, members: [null] }, { ...roster, invitations: [null] },
  { ...roster, members: [{ ...ownerRow, name: "Owner Name" }] }, { ...roster, members: [{ ...ownerRow, sub: "" }] }, { ...roster, members: [{ ...ownerRow, email: "" }] },
  { ...roster, members: [ownerRow, { email: editorRow.email, sub: editorRow.sub, name: editorRow.name, role: editorRow.role }] },
  { ...roster, members: [ownerRow, { ...editorRow, sub: ownerRow.sub, email: "second@partner.invalid" }] },
  { ...roster, members: [ownerRow, { ...editorRow, sub: "u_fixture_second_44", email: ownerRow.email }] },
  { ...roster, members: [ownerRow, editorRow, { ...editorRow, sub: "u_fixture_editor_44", role: "viewer" }] },
  { ...roster, members: [ownerRow, { ...editorRow, email: "Editor@partner.invalid" }] },
  { ...roster, members: [ownerRow, { ...editorRow, email: "editor partner.invalid" }] },
  { ...roster, members: [ownerRow, { ...editorRow, sub: "bad subject" }] },
  { ...roster, members: [ownerRow, { ...editorRow, sub: `u${"x".repeat(128)}` }] },
  { ...roster, members: [ownerRow, { ...editorRow, name: 17 }] },
  { ...roster, members: [ownerRow, { ...editorRow, name: "n".repeat(201) }] },
  { ...roster, members: [ownerRow, { ...editorRow, role: "owner" }] },
  { ...roster, members: unsortedMembers },
  { ...roster, invitations: [{ expiresAt: invitationRow.expiresAt, email: invitationRow.email, role: invitationRow.role }] },
  { ...roster, invitations: [invitationRow, { ...invitationRow }] },
  { ...roster, invitations: [{ ...invitationRow, email: "zed@review.invalid" }, { ...invitationRow, email: "alpha@review.invalid" }] },
  { ...roster, invitations: [{ ...invitationRow, email: "Pending@review.invalid" }] },
  { ...roster, invitations: [{ ...invitationRow, role: "owner" }] },
  { ...roster, invitations: [{ ...invitationRow, expiresAt: "tomorrow" }] },
  { ...roster, members: oversizedMembers, invitations: roster.invitations },
  { ...roster, members: tooManyMembers, invitations: [] },
  { ...roster, members: [ownerRow], invitations: tooManyInvitations },
]) {
  const invalid = await run(); invalid.setBody(invalidBody); const invalidButton = invalid.document.querySelector(".share-btn");
  await invalidButton.emit("click", { target: invalidButton }); await invalid.settle();
  const invalidPanel = invalid.document.querySelector(".share-pop"); assert.equal(invalidPanel.querySelector(".share-status").textContent, "Access list could not be refreshed.");
  assert.equal(invalidPanel.textContent.includes("pending@review.invalid"), false);
}
for (const malformedEmail of [
  "", "Editor@partner.invalid", "editor.partner.invalid", "editor@@partner.invalid",
  "@partner.invalid", "editor@", "edi,tor@partner.invalid", "edi:tor@partner.invalid",
  "edi/tor@partner.invalid", "edi\\tor@partner.invalid", "edi tor@partner.invalid",
  "edi\ntor@partner.invalid", `${"e".repeat(246)}@x.invalid`,
]) {
  const invalid = await run(); invalid.setBody({ ...roster, members: [ownerRow, { ...editorRow, email: malformedEmail }] });
  const invalidButton = invalid.document.querySelector(".share-btn");
  await invalidButton.emit("click", { target: invalidButton }); await invalid.settle();
  assert.equal(invalid.document.querySelector(".share-status").textContent, "Access list could not be refreshed.");
  invalid.assertSafeSinks();
}
console.log("PASS  P3-I offline, role, lazy-fetch, inert-render, refresh, and revoke contract");
NODE
```

Expected: exactly `PASS  P3-I offline, role, lazy-fetch, inert-render, refresh, and revoke contract`, exit `0`, no external request, and no artifact. The source is the executed production module; all four named non-HTTP protocols, absent-event, commenter/viewer, invalid-session, missing-host, duplicate-control, valid owner/editor, exact button, and delayed-comments-order cases execute. The harness poisons console, storage, cookies, history/location mutation, beacon/service-worker, alert, unexpected window globals, and unexpected URL construction; every synchronous and settled checkpoint proves those sinks remained untouched, the window key set did not widen, and every constructed URL is only the exact roster endpoint. The stream oracle proves a three-chunk body of exactly 65,536 bytes succeeds with one reader and one release; a 65,537-byte stream cancels and releases before completion; wrong-chunk and read-rejection paths best-effort cancel and release; rejected cancellation retains the fixed failure and still releases exactly once; an oversized Content-Length leaves the body untouched; padded length/fatal UTF-8/malformed JSON fail closed; and the exact deadline owns the whole operation. The closed roster validators execute root/top-level/member/invitation key order, null/empty/extra/type, document/default/role, identifier/email/name, owner-to-member and sorted member-to-member email duplication, subject duplication, ordering, timestamp, individual/combined-size, and request-rejection classes; the reserved HTML-looking name remains text. The first request waits for an explicit open; the held response proves immediate `Loading access…` and heading focus before settlement; reopening refreshes; toggle, close-button, inside/outside pointer, Escape, focus return, below/above/vertical-clamp positioning, close-during-flight abort/generation invalidation, exact five-second timeout path, empty-invitation hiding, both `401` and `403` revocation/listener-removal paths, and the complete accepted/rejected Content-Type classes execute directly; a transient failure retains the last good view; and a later capability denial removes the complete surface.

### 3. Rendered stylesheet-state gate

Run this exact pinned Chromium gate after the behavior fixture. It renders the real stylesheet together with P1-B's real theme variables; it does not substitute a CSS parser or infer behavior from token presence. Public `playwright@1.55.0`, its Chromium revision, npm cache, and test programs live under one guarded temporary root.

The Node supervisor owns each install/browser command in a detached process group, applies 180/300/60-second phase deadlines and a 600-second overall deadline, sends TERM then KILL, waits/reaps, and proves group disappearance before deleting the root. HUP/INT/TERM preserve 129/130/143. A contained failure removes the root without printing a false pass. Before recursive deletion it publishes a mode-0600 locator beside the guarded root; success removes both. Uncertain containment/deletion retains that locator and exits 125 when no terminal signal was latched; if locator publication itself fails, it leaves the guarded root, prints `evidence=unavailable` with the exact root/PID/owned PGID, and uses that same status rule.

```bash
set -euo pipefail

P3I_VISUAL_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P3I_VISUAL_ROOT=
pre_exec_cleanup() {
  case "${P3I_VISUAL_ROOT:-}" in
    "$P3I_VISUAL_PARENT"/p3-i-visual.??????) test ! -e "$P3I_VISUAL_ROOT" || find "$P3I_VISUAL_ROOT" -depth -delete ;;
    "") ;;
    *) printf '%s\n' 'ERROR  refusing unsafe P3-I visual cleanup target' >&2; exit 125 ;;
  esac
}
pre_exec_signal() { status="$1"; trap - HUP INT TERM; pre_exec_cleanup || exit 125; exit "$status"; }
trap pre_exec_cleanup EXIT
trap 'pre_exec_signal 129' HUP
trap 'pre_exec_signal 130' INT
trap 'pre_exec_signal 143' TERM
P3I_VISUAL_ROOT="$(mktemp -d "$P3I_VISUAL_PARENT/p3-i-visual.XXXXXX")"
P3I_VISUAL_ROOT="$(cd "$P3I_VISUAL_ROOT" && pwd -P)"
P3I_VISUAL_REPO="$(git rev-parse --show-toplevel)"
case "$P3I_VISUAL_ROOT" in "$P3I_VISUAL_PARENT"/p3-i-visual.??????) ;; *) exit 125 ;; esac
test ! -L "$P3I_VISUAL_ROOT"
chmod 700 "$P3I_VISUAL_ROOT"
export P3I_VISUAL_ROOT P3I_VISUAL_REPO

sed 's/^  //' >"$P3I_VISUAL_ROOT/browser.mjs" <<'P3I_BROWSER'
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  import { readFileSync } from "node:fs";
  import { join } from "node:path";

  const root = process.env.P3I_VISUAL_ROOT, repo = process.env.P3I_VISUAL_REPO;
  const require = createRequire(import.meta.url);
  const { chromium } = require("./tool/node_modules/playwright");
  const theme = readFileSync(join(repo, "templates/base/theme.css"), "utf8");
  const share = readFileSync(join(repo, "templates/base/share.css"), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" });
    const page = await context.newPage(); page.setDefaultTimeout(5_000);
    const requests = [], pageErrors = [], consoleErrors = [];
    page.on("request", (request) => { if (/^https?:/i.test(request.url())) requests.push(request.url()); });
    page.on("pageerror", (error) => { pageErrors.push(error.message); });
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.setContent(`<!doctype html><html><head><style>${theme}\n${share}</style></head><body>
      <header><div class="head-top"><button class="share-btn" id="doc-share-button" type="button" aria-expanded="true">Share</button></div></header>
      <aside class="share-pop" id="doc-share-panel" aria-labelledby="doc-share-title">
        <header class="share-head"><h2 id="doc-share-title" tabindex="-1">Access</h2><button class="share-close" type="button">Close access panel</button></header>
        <p class="share-status" role="status" aria-live="polite"></p><p class="share-default">Organization default: Commenter</p>
        <section class="share-members"><h3>People with access</h3><ul class="share-list"><li>owner@example.com — Owner</li><li>A very long invented display row that must wrap safely — reader-with-a-long-local-part@partner.invalid — Viewer</li></ul></section>
        <section class="share-invitations"><h3>Pending invitations</h3><ul class="share-list"><li>pending@review.invalid — Commenter — Pending until 2099-10-02</li></ul></section>
      </aside></body></html>`);
    const button = page.locator(".share-btn"), close = page.locator(".share-close"), panel = page.locator(".share-pop");
    const nextFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const palette = async (themeName, colorScheme) => {
      await page.emulateMedia({ media: "screen", colorScheme, forcedColors: "none", reducedMotion: "no-preference" });
      await page.evaluate((value) => { if (value === null) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = value; }, themeName);
      await nextFrame();
      return panel.evaluate((node) => { const style = getComputedStyle(node); return [style.backgroundColor, style.color, style.borderColor, style.boxShadow]; });
    };
    const light = await palette(null, "light"), systemDark = await palette(null, "dark");
    assert.notDeepEqual(systemDark, light); assert.deepEqual(await palette("light", "dark"), light); assert.deepEqual(await palette("dark", "light"), systemDark);

    await page.evaluate(() => { delete document.documentElement.dataset.theme; document.activeElement?.blur(); }); await page.keyboard.press("Tab");
    let focus = await button.evaluate((node) => { const style = getComputedStyle(node); return [document.activeElement === node, node.matches(":focus-visible"), style.outlineStyle, style.outlineWidth]; });
    assert.equal(focus[0], true); assert.equal(focus[1], true); assert.notEqual(focus[2], "none"); assert.notEqual(focus[3], "0px");
    const expanded = await button.evaluate((node) => { const style = getComputedStyle(node); return [style.color, style.backgroundColor, style.borderColor]; });
    await button.evaluate((node) => node.setAttribute("aria-expanded", "false")); await nextFrame();
    const collapsed = await button.evaluate((node) => { const style = getComputedStyle(node); return [style.color, style.backgroundColor, style.borderColor]; }); assert.notDeepEqual(expanded, collapsed);
    await page.keyboard.press("Tab");
    focus = await close.evaluate((node) => { const style = getComputedStyle(node); return [document.activeElement === node, node.matches(":focus-visible"), style.outlineStyle, style.outlineWidth]; });
    assert.equal(focus[0], true); assert.equal(focus[1], true); assert.notEqual(focus[2], "none"); assert.notEqual(focus[3], "0px");

    await page.emulateMedia({ media: "screen", colorScheme: "light", forcedColors: "active", reducedMotion: "no-preference" }); await page.keyboard.press("Shift+Tab"); await nextFrame();
    const forced = await panel.evaluate((node) => { const style = getComputedStyle(node); return [style.borderStyle, style.borderWidth]; }); assert.notEqual(forced[0], "none"); assert.notEqual(forced[1], "0px");
    focus = await button.evaluate((node) => { const style = getComputedStyle(node); return [document.activeElement === node, node.matches(":focus-visible"), style.outlineStyle, style.outlineWidth]; });
    assert.equal(focus[0], true); assert.equal(focus[1], true); assert.notEqual(focus[2], "none"); assert.notEqual(focus[3], "0px");

    await page.setViewportSize({ width: 390, height: 700 }); await page.emulateMedia({ media: "screen", colorScheme: "light", forcedColors: "none", reducedMotion: "reduce" }); await nextFrame();
    const box = await panel.boundingBox(); assert.ok(box); assert.ok(Math.abs(box.width - 374) <= 1); assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await page.locator(".share-list li").nth(1).evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    const motion = await panel.evaluate((node) => { const style = getComputedStyle(node); return [style.animationDuration, style.transitionDuration, style.scrollBehavior]; }); assert.deepEqual(motion, ["0s", "0s", "auto"]);

    await page.emulateMedia({ media: "print" }); await nextFrame(); assert.equal(await button.evaluate((node) => getComputedStyle(node).display), "none"); assert.equal(await panel.evaluate((node) => getComputedStyle(node).display), "none");
    assert.deepEqual(requests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []);
    await context.close();
  } finally { await browser.close(); }
P3I_BROWSER

sed 's/^  //' >"$P3I_VISUAL_ROOT/supervisor.mjs" <<'P3I_SUPERVISOR'
  import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { spawn } from "node:child_process";

  const root = process.env.P3I_VISUAL_ROOT;
  if (!root || !/\/p3-i-visual\.[A-Za-z0-9]{6}$/.test(root)) throw new Error("invalid visual root");
  let activePid = 0, uncleanPgid = 0, requestedStatus = 0, timedOut = false, groupProved = true, terminalKill;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; } };
  const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; } };
  const contain = async (pid) => {
    if (!pid || !groupAlive(pid)) return true;
    signalGroup(pid, "SIGTERM"); for (let i = 0; i < 20 && groupAlive(pid); i += 1) await delay(100);
    if (groupAlive(pid)) signalGroup(pid, "SIGKILL"); for (let i = 0; i < 20 && groupAlive(pid); i += 1) await delay(100);
    return !groupAlive(pid);
  };
  for (const [signal, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => {
    if (!requestedStatus) { requestedStatus = status; process.exitCode = status; }
    if (activePid) { signalGroup(activePid, "SIGTERM"); clearTimeout(terminalKill); terminalKill = setTimeout(() => { if (activePid && groupAlive(activePid)) signalGroup(activePid, "SIGKILL"); }, 2_000); }
  });
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(root, "browsers"), npm_config_cache: join(root, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false", npm_config_fetch_timeout: "30000", PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "30000" };
  const run = (command, args, limit, visible = false) => {
    if (requestedStatus || timedOut) return Promise.reject(new Error("visual gate already terminating"));
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env, detached: true, stdio: visible ? "inherit" : "ignore" }); activePid = child.pid || 0;
      let settled = false, expired = false, killTimer;
      const timer = setTimeout(() => { expired = true; timedOut = true; if (child.pid) { signalGroup(child.pid, "SIGTERM"); killTimer = setTimeout(() => { if (groupAlive(child.pid)) signalGroup(child.pid, "SIGKILL"); }, 2_000); } }, limit);
      child.once("error", (error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); activePid = 0; reject(error); });
      child.once("close", async (code, signal) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(terminalKill);
        let clean = false; try { clean = await contain(child.pid); } catch {} groupProved &&= clean; if (!clean) uncleanPgid ||= child.pid; activePid = 0;
        if (!clean) reject(new Error("owned process group remained")); else if (requestedStatus) reject(new Error("visual gate interrupted")); else if (expired) reject(new Error("visual phase deadline")); else if (code !== 0 || signal !== null) reject(new Error("visual phase failed")); else resolve();
      });
    });
  };

  let failed = false;
  const overall = setTimeout(() => { timedOut = true; if (activePid) { signalGroup(activePid, "SIGTERM"); terminalKill = setTimeout(() => { if (activePid && groupAlive(activePid)) signalGroup(activePid, "SIGKILL"); }, 2_000); } }, 600_000);
  try {
    await run("npm", ["install", "--prefix", join(root, "tool"), "--no-save", "--no-package-lock", "--ignore-scripts", "playwright@1.55.0"], 180_000);
    await run(join(root, "tool/node_modules/.bin/playwright"), ["install", "chromium"], 300_000);
    await run(process.execPath, [join(root, "browser.mjs")], 60_000, true);
  } catch { failed = true; }
  clearTimeout(overall); clearTimeout(terminalKill);
  if (activePid) { const pid = activePid; let clean = false; try { clean = await contain(pid); } catch {} groupProved &&= clean; if (!clean) uncleanPgid ||= pid; activePid = 0; }
  let evidence = `${root}.manual-remediation.txt`, evidenceReady = false, externalEvidence = false, removed = false, evidenceRemoved = false;
  const evidenceBody = `root=${root}\npid=${process.pid}\npgid=${uncleanPgid || "none"}\n`;
  try { writeFileSync(evidence, evidenceBody, { flag: "wx", mode: 0o600 }); chmodSync(evidence, 0o600); evidenceReady = true; externalEvidence = true; } catch {
    evidence = join(root, "manual-remediation.txt"); try { writeFileSync(evidence, evidenceBody, { flag: "wx", mode: 0o600 }); chmodSync(evidence, 0o600); evidenceReady = true; } catch {}
  }
  if (groupProved && externalEvidence) {
    try { rmSync(root, { recursive: true }); removed = !existsSync(root); } catch { removed = false; }
    if (removed) { try { rmSync(evidence); evidenceRemoved = !existsSync(evidence); } catch { evidenceRemoved = false; } }
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (!groupProved || !removed || !evidenceRemoved) {
    console.error(`MANUAL REMEDIATION P3-I root=${root} pid=${process.pid} pgid=${uncleanPgid || "none"} evidence=${evidenceReady ? evidence : "unavailable"}`); process.exitCode = requestedStatus || 125;
  } else {
    if (!failed && !timedOut && !requestedStatus) console.log("PASS  P3-I rendered theme, focus, forced-colors, responsive, motion, and print states");
    process.exitCode = requestedStatus || (timedOut ? 124 : failed ? 1 : 0);
  }
P3I_SUPERVISOR

exec env P3I_VISUAL_ROOT="$P3I_VISUAL_ROOT" P3I_VISUAL_REPO="$P3I_VISUAL_REPO" node "$P3I_VISUAL_ROOT/supervisor.mjs"
```

Expected: setup is quiet and finite; after all three owned process groups are reaped and the private root is removed, the supervisor prints exactly `PASS  P3-I rendered theme, focus, forced-colors, responsive, motion, and print states` and exits `0`. The executable assertions use the actual CSS cascade and Chromium media emulation for inherited light/system-dark/explicit themes, expanded and keyboard `:focus-visible` states, forced-color borders/outlines, exact 390-pixel responsive width without horizontal overflow, reduced motion, and print suppression. No `p3-i-visual.*`, npm cache, browser, or test artifact remains after success or a contained failure.

### 4. Repository and ownership gates

```bash
set -euo pipefail

templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P3-I.md templates/base/share.js templates/base/share.css
git diff --check
test "$(rg '^## ' docs/tickets/P3-I.md | sed 's/^## //')" = "$(printf '%s\n' 'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' 'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' 'Assumptions and open questions' 'References')"
test "$(( $(rg -n '^```' docs/tickets/P3-I.md | wc -l | tr -d ' ') % 2 ))" -eq 0
awk 'BEGIN{inbash=0} /^```bash[[:space:]]*$/{inbash=1; next} /^```[[:space:]]*$/{if(inbash){inbash=0; print ""}; next} inbash{print}' docs/tickets/P3-I.md | bash -n

issue_json="$(gh issue view 22 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-I.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-I — The share panel, read only" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-I issue #22 pointer integrity'

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3I_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
const lines = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const changed = new Set([...lines(["diff", "--name-only", `${base}...HEAD`]), ...lines(["diff", "--name-only"]), ...lines(["diff", "--cached", "--name-only"]), ...lines(["ls-files", "--others", "--exclude-standard"])]);
for (const path of [...changed]) if (path.startsWith("docs/tickets/")) changed.delete(path);
assert.deepEqual([...changed].sort(), ["templates/base/share.css", "templates/base/share.js"]);
console.log("PASS  P3-I owns only share.js and share.css");
NODE
```

Expected: export `P3I_BASE` as the reviewed P1-B/P2-C/P3-H predecessor commit, then every command exits `0`; the exact-heading, fence-balance, and Bash-syntax checks emit nothing; `check-dist` reports byte-identical committed documents; TypeScript emits no diagnostics; scrub reports no denied term or warning; and whitespace is clean. Issue #22 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the pointer gate prints `PASS  P3-I issue #22 pointer integrity`, and the final line is `PASS  P3-I owns only share.js and share.css`.

## Failure modes

- Offline/non-HTTP(S), missing session event, invalid event, unshared result, commenter/viewer role, or absent `.head-top`: remain absent and silent.
- Duplicate pre-existing share control: do not overwrite or create a second control.
- First roster load fails: keep the accessible empty panel with the fixed failure status so the reader may close and retry on a later open.
- Later refresh fails: retain the last complete validated list and show only the fixed failure status.
- Close during load: abort/invalidate the generation; a late result cannot render into the hidden/reopened panel.
- Server returns `401`/`403` after a stale session: remove the button, panel, addresses, state, and feature listeners.
- Malformed/oversized/wrong-document/unsorted response: reject the complete response and keep the last good view; never render a prefix.
- Malformed or oversized Content-Length, missing body, wrong/over-limit chunk, read/decode/parse failure, or abort before stream completion: touch no body when the header precheck fails; otherwise cancel before completion best-effort, release the acquired reader exactly once, discard every partial byte, and show only the fixed refresh failure.
- Extremely long but valid address/name: wrapping prevents horizontal overflow; input bounds still apply.
- Button near the viewport bottom: use the `innerHeight`/`offsetHeight` calculation to place above when it fits and clamp to the eight-pixel vertical inset when neither side fits. A viewport narrower than the panel clamps left and uses the narrow CSS width.
- P3-C comments UI mounts later: its own insertion rule places its toggle before `.share-btn`, so Share remains the final masthead control.
- Print: hide button/panel even when the panel was open before printing.
- Rendered-gate install, browser, timeout, or signal failure: TERM then KILL the owned group, reap/prove disappearance, and remove the guarded tool/cache root; retain the mode-0600 locator and use containment status 125 when cleanup cannot be proved and no terminal signal was latched, or retain the root and print exact safe identifiers if evidence publication fails.
- Deliberately not handled: live membership, cross-tab state, background refresh, offline cache, org directory, share links, access writes, or revocation of an already-rendered HTML document before the next server request.

## Settled decisions

- The control is created by JavaScript after a valid session event; no static layout markup or hidden dead button exists.
- Owners and editors may see member email addresses; commenters and viewers may not see the control at all.
- The access endpoint, not the event/DOM, is the privacy authority. Every open refreshes through credentialed same-origin GET.
- The panel is a non-modal popover. It never traps focus or blocks document reading.
- This ticket is read-only for every role. P4-L owns all access controls and must keep them absent for editors.
- There is no bearer/signed share link and no secret in the document URL.
- Server strings render only as text. No response field becomes HTML, a selector, style, URL, global, or persisted state.
- A `401`/`403` removes stale sensitive UI; transient/service failures keep the last validated view with a safe status.
- Share remains the final direct masthead child through the explicit P3-C sibling insertion contract, without either ticket writing the other's file.
- File, artifact, static-server-without-API, print, and unconnected Mode A behavior is absence, not broken chrome.

## Assumptions and open questions

- **Assumption:** each closed-to-open transition refreshes the list. Research says both “first click” and “fetched when the panel opens”; refreshing per open is the narrow behavior that lets a later revoke/change become visible without polling.
- **Assumption:** P3-H returns the current `orgDefault` in its read body so P4-L can later render the owner control without a second GET shape. P3-I renders it as read-only policy for both owner and editor.
- **Assumption:** the comments-toggle/share-button sibling order is an integration contract, not a dependency on P3-C runtime behavior. P3-C detects only an existing direct `.share-btn`; P3-I never imports or waits for comments.
- **Open question (non-blocking):** none. Placement, refresh, privacy, degradation, and P4-L amendment boundaries are settled.

## References

- `docs/research/00-integration-plan.md` §§1.2, 1.5, 4.1, 4.7, and 6 — fail-dark feature convention, document roles, pre-created asset slots, ticket ownership, and binding rulings.
- `docs/research/09-sharing-and-roles.md` §§2.1–2.4, 3.4, 7, and 9 — role visibility, session fields, masthead placement, lazy panel, degradation, and server-side enforcement.
- `docs/tickets/P1-B.md` — exact share slots, CSS/module order, `.head-top`/`.tt` boundary, session-last execution, and zero-byte absence.
- `docs/tickets/P2-C.md` — one session request/event, final document-aware response validation, and presentation-only reveal state.
- `docs/tickets/P3-H.md` — exact session capability projection and access roster response consumed by this ticket.
- GitHub issue #22 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
