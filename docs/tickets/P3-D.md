# P3-D — The changelog client

## Outcome

Returning readers get an offline-safe, accessible change bar and deterministic section dots for the document versions newer than their last-read marker, while first-time readers see no false unread state.

## Context

P2-E bakes one validated `#doc-history` JSON block into a Mode B build and P4-R later writes the same shape for Mode A promotions. This ticket is the browser-only consumer: it compares that bounded history window with one harmless `localStorage` marker and adds transient presentation without a server, account, token, or network request.

The marker is convenience state, not authority. Missing, blocked, cleared, or corrupt browser storage must never prevent the document itself from working.

Document history remains separate from annotation audit. P3-A owns authoritative thread state, and P4-M (#35) is the exact downstream owner that appends `comment.create`, `comment.reply`, `thread.resolve`, and `thread.reopen` audit events after successful thread writes; P3-D neither fetches nor synthesizes those events.

## Scope

### In scope

- Create the optional `templates/base/history.js` module consumed by P1-B's existing `{{HISTORY_JS}}` slot.
- Create `templates/base/history.css` for the change bar, current-section dots, light/dark themes, narrow layouts, focus treatment, and print suppression.
- Read and defensively validate the P2-E JSON already present in `<script type="application/json" id="doc-history">`.
- Store exactly one last-read value under `read:<history.doc>`.
- Treat the first successful visit as the baseline: persist the current `head` and render nothing.
- For a different prior marker, calculate the newest-first version prefix after that marker, or the complete retained window when the marker is absent from the window.
- Deduplicate current changed section IDs in first-encounter order, mark their section and jump-nav link, and render safe links in one change bar.
- Advance the marker and remove only this module's UI/classes when the reader activates **Mark as read**.
- Fail closed and silently when the data block, required DOM, or storage access is unavailable.

### Out of scope

- Generating, validating for build acceptance, rewriting, or retaining `history.json`; P2-E owns the Mode B producer and P4-R owns serialized Mode A promotion writes.
- Fetching Git, GitHub, a history endpoint, events, comments, or any other network resource.
- Authentication, cross-device read state, unread counts, subscriptions, notifications, analytics, or server persistence.
- Rendering diff bodies, changing the P2-E changelog section, building a version picker, restoring a version, or storing past rendered pages.
- Adding markup or placeholders to `layout.html`, changing the builder, `app.js`, `components.css`, another client module, or generated `dist/**` by hand.
- Marking `doc.json`, `extra.css`, deleted sections, renamed sections without a current matching ID, or any unknown ID as a current section.
- Publishing a global API or event. No later ticket is permitted to treat the marker as authorization or durable workflow state.

## Interface contract

### Module surface and startup

`templates/base/history.js` is a side-effect-only browser ES module. It has no imports, exports, top-level `await`, package dependency, global assignment, custom event, timer, observer, worker, dynamic code generation, or network call. P1-B emits it after `#doc-history` and after the base `app.js`; it must work from `file:` as well as HTTP(S).

On evaluation, perform this order exactly:

1. Resolve `document.getElementById("doc-history")`. If absent, return without reading storage or mutating the DOM.
2. Read its `textContent`, call `JSON.parse()` once inside `try`/`catch`, and apply the defensive **History input** checks below. Any failure returns without storage or DOM work and without logging.
3. Resolve the one `main` element. If absent, return before storage access.
4. Compute `key = "read:" + history.doc`.
5. Call `localStorage.getItem(key)` once inside `try`/`catch`. A throw returns without a write or DOM mutation.
6. Apply the marker state machine below.

The implementation may define private functions and constants inside the module. It must not expose `window.doc.history`, overwrite `window.doc`, or add any other property to `window`, `document`, or `document.documentElement`.

### History input

P2-E is authoritative, but this untrusted-DOM boundary must reject enough malformed JSON to avoid unsafe keys, selectors, loops, or rendering. `JSON.parse()` creates only ordinary data objects and arrays: accessors, symbols, custom prototypes, proxies, sparse arrays, repeated references, and cycles cannot cross this text boundary. Accept only a non-null, non-array object whose enumerable keys are exactly `doc`, `head`, and `versions`:

- `doc` matches `^[a-z0-9][a-z0-9._-]*$` and is neither `.` nor `..`.
- `head` matches `^[0-9a-f]{7}$`.
- `versions` is an array with 1 through 12 entries.
- Every version is a non-null, non-array object whose enumerable keys are exactly `sha`, `date`, `author`, `subject`, `url`, and `changed`. It must have a seven-lowercase-hex `sha`, and all row SHAs must be unique.
- `versions[0].sha === head`.
- Every `changed` value is a dense array with 0 through 256 entries, and the sum of all `changed.length` values across the retained versions is at most 256. Each item is a non-null, non-array object whose enumerable keys are exactly `file`, `id`, `add`, `del`, `patch`, and `clipped`; this module reads only `id`, which must match `^[a-z0-9][a-z0-9._-]*$`. P2-E's 16,384-byte escaped compact payload budget makes this 256-row consumer ceiling strictly looser than any valid producer payload, while still placing an explicit finite bound on every validation and rendering loop.

The client need not repeat P2-E's date, URL, patch grammar, byte-budget, file ordering, or stat validation because it does not render or branch on those fields. It must enforce the closed keys, bounded arrays, identifier grammar, unique SHAs, and head relation above. Invalid embedded data is indistinguishable from absence: no storage call, UI, class, exception, or console output.

### Marker state machine

The exact key is:

```text
read:<history.doc>
```

The value is the exact seven-character `history.head`. Do not add an origin, user, email, timestamp, JSON wrapper, expiry, cookie, or session-storage copy.

| Stored value | Behavior |
|---|---|
| `null` | First visit or cleared storage. Attempt `localStorage.setItem(key, head)` once inside `try`/`catch`; render nothing whether the write succeeds or throws. |
| exact `head` | Current. Perform no write and render nothing. |
| a SHA found at version index `i > 0` | `since = versions.slice(0, i)`. |
| any other non-null string, including a malformed or evicted marker | `since = versions`; over-report the complete retained window. |

`getItem()` returns only a string or `null` in a conforming browser. Treat any other test-double result as invalid input and return without mutation. Never advance a returning reader automatically: only a successful **Mark as read** write advances the marker.

### Current-section resolution

Walk `since` newest first and each row's `changed` array in stored order. Deduplicate `change.id` by exact string equality at first encounter.

For each unique ID:

1. Resolve `document.getElementById(id)`.
2. It is a current section only when the result is an HTML `SECTION` whose exact `id` is the requested value and which has a descendant `details.sec`. Otherwise ignore it. This deliberately drops metadata IDs, deleted/renamed sections, and unknown IDs.
3. Find the current jump link by walking `document.querySelectorAll("nav.jump a")` and selecting the first HTML anchor whose `getAttribute("href")` is exactly `#${id}`. Do not interpolate an ID into `querySelector()`.
4. Derive the bar label from the section's `.sec-label` `textContent.trim()`. If empty or absent, use the matching nav link's trimmed text, then the literal ID. Assign the resulting string through `textContent`, never `innerHTML`.
5. Add `history-changed` to the section and, when present, to the matching nav link. Do not add a class to the nested `details`, label, or unrelated links.

Bar links use the exact `href` `#${id}`. On activation, set the section's `details.sec.open = true` and allow ordinary fragment navigation; do not call `preventDefault()`, replace history state, or scroll independently of P1-B's base deep-link behavior.

### Change bar DOM

When `since` is non-empty, prepend exactly one newly created element to `main`:

```html
<aside class="history-changebar" aria-label="Document updates">
  <p><strong>N</strong> update/updates since you last read this[LINKS]</p>
  <button type="button">Mark as read</button>
</aside>
```

This is a structural description; generated whitespace text nodes are not required. `N` is `since.length`, so it counts retained version rows, not files or section IDs. Use singular `update` only for one. When at least one current section resolved, append the text `: ` followed by its safe anchor links separated by the text `, `. When none resolved, add no colon or empty list.

Construct the complete bar with `createElement()`, `createTextNode()`, `textContent`, `setAttribute()`, and node insertion. Do not use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write()`, or string-to-DOM parsing. Store direct references to the created bar, marked sections, and marked nav links.

On button activation, attempt `localStorage.setItem(key, head)` once:

- success: remove the bar and remove `history-changed` only from the stored elements this invocation marked;
- throw: leave the bar and all dots present so the UI does not falsely claim the marker advanced.

Repeated button activation after success is impossible because the button is removed. The module itself installs no listener outside its newly created bar links and button.

### CSS contract

`templates/base/history.css` owns only selectors beginning `.history-` or `section.history-changed`/`nav.jump a.history-changed`, plus its own custom properties. It defines non-empty light values for `--history-change`, `--history-change-bg`, and `--history-change-border` in `:root`, the system-dark branch `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ... }`, and the explicit `:root[data-theme="dark"]` branch. The two dark branches assign the same three values, those values differ from the light triple, and explicit light suppresses the system-dark branch.

- `.history-changebar` is a flexible, wrapping status surface with readable padding, margin, border, background, foreground, and gap.
- The paragraph has no inherited bottom margin. On `:hover`, each link and the button changes at least one computed `color`, `background-color`, `text-decoration-line`, or `border-color` value from its own resting value. Their `:focus-visible` state uses a computed solid `2px` outline in `--history-change` with `2px` outline offset, so keyboard focus is distinguishable from the unfocused state without relying on the user agent default.
- `section.history-changed > details.sec > summary .sec-label::before` and `nav.jump a.history-changed::after` render the same visible bullet using `content: "•"`; the section rule must not replace P1-B's existing `.sec-label::after` divider.
- At `max-width: 640px`, the bar stacks and stretches its button without horizontal overflow.
- Under `@media print`, set `display: none` on the bar and both dot pseudo-elements. The underlying changelog section remains printable.
- Do not hide or recolor content outside these selectors, and do not use an external asset, font, animation, or fixed/sticky positioning.

## Files owned

- `templates/base/history.js` — **new**; P1-B already owns and emits its optional module slot.
- `templates/base/history.css` — **new**; P1-B already owns and emits its optional stylesheet slot.
- `docs/tickets/P3-D.md` — **new canonical specification**; not an implementation path.

No other implementation path is owned. In particular, do not amend `templates/base/layout.html`, `templates/base/app.js`, `templates/base/components.css`, `templates/docbuild/src/index.ts`, `templates/docbuild/src/history.ts`, any `history.json`, or generated output. If an implementation cannot satisfy this contract through the existing slots, stop and report the predecessor gap.

## Dependencies

- **P1-B (transitive through P2-E):** supplies the optional `HISTORY_JS`/`HISTORY_CSS` slots, places `#doc-history` before the history module, and emits no script/data element when the corresponding source/data is absent. P3-D consumes those boundaries without changing them.
- **P2-E:** supplies the exact closed `History` shape, one-to-twelve newest-first rows, `head === versions[0].sha`, stable changed IDs, compact escaped embedding, the generated changelog section, and absence when no valid history exists. P3-D does not reinterpret producer errors.

Downstream **P4-R** may prepend a schema-conforming Mode A promotion row with an empty URL. This client already treats it as another seven-character version and needs no amendment. No Phase 3 ticket shares either owned file.

### Maximum safe implementation waves

The two files may be authored in parallel because they are disjoint, but the observable gate is one integration wave:

1. `history.js` state machine, defensive boundary, safe DOM construction, and behavioral fixture.
2. `history.css` theme/responsive/print states and static selector gate.
3. One serialized rendered-browser integration check after P2-E's artifacts are present; it owns its temporary Playwright install/cache/browser and must not overlap another browser installer or generated-output task.
4. One serialized build/repository check after the browser root is gone.

Do not generate shared `dist/**` concurrently with another ticket's integration gate.

## Acceptance criteria

- [ ] Only the two declared implementation files are added; the JS module has no import/export/global/network/timer/observer/worker/event surface.
- [ ] Missing/malformed history, missing `main`, a throwing storage read, or a nonconforming storage result produces no write, UI, class, error, or console output.
- [ ] The defensive input gate rejects every declared top-level, version, changed-row, array-bound, identifier, SHA-uniqueness, and head-relation violation.
- [ ] The exact storage key is `read:<doc>` and the only stored value is the exact seven-character `head`.
- [ ] A first visit or cleared marker attempts one baseline write and shows no bar/dot; an exact current marker performs no write and shows no bar/dot.
- [ ] A retained marker shows exactly the newer prefix; an unknown, malformed, or evicted non-null marker safely over-reports the complete retained window.
- [ ] The bar count is version rows, singular/plural wording is exact, changed IDs are deduplicated newest-first, metadata/deleted/unknown IDs are ignored, and current labels are derived from current DOM text.
- [ ] All history-derived strings enter the DOM through `textContent`/attributes; no selector or HTML string interpolates an ID or label.
- [ ] Bar links open their current section and retain normal fragment navigation.
- [ ] A successful Mark-as-read write removes the one bar and exactly the stored classes; a failed write leaves the UI unchanged.
- [ ] A rendered page proves distinct light/system-dark values, system-dark plus explicit-light override, explicit-dark equivalence to system dark, computed hover changes and exact link/button focus-visible outlines, and narrow stack/stretch/no-horizontal-overflow behavior against the actual `history.css`.
- [ ] A rendered print page hides the bar and both section/nav dot pseudo-elements without hiding the underlying section; the normal rendered page shows both dots without replacing the existing label-divider pseudo-element.
- [ ] A built page with no history emits no `#doc-history`, history UI, or history class; the shared optional assets may still be present once P3-D installs them, but `history.js` performs no storage access or DOM mutation without the data block. A page with history runs the actual `history.js` and `history.css` from `file:` while the browser records zero HTTP(S) requests.
- [ ] Deterministic fixtures cover every marker/input/DOM/storage branch, reserved strings remain inert text, and the bounded rendered-browser gate uses pinned public tooling, owns/reaps its processes, and removes its install/cache/browser/fixture root on success.
- [ ] `templates/check-dist`, docbuild typecheck, scrub, whitespace, exact headings, fence syntax, and exact file-ownership checks pass; issue #17 also passes the executable pointer-integrity gate: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

Run after P2-E is integrated. All fixture text and identifiers below are invented for public use.

### 1. Structural JavaScript and stylesheet contract

From the repository root:

```bash
set -euo pipefail

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const js = readFileSync("templates/base/history.js", "utf8");
const css = readFileSync("templates/base/history.css", "utf8");
const require = createRequire(resolve("package.json"));
const ts = require(resolve("templates/docbuild/node_modules/typescript/lib/typescript.js"));
const sourceFile = ts.createSourceFile("history.js", js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.deepEqual(sourceFile.parseDiagnostics, [], "history.js must parse as JavaScript");
assert.equal(sourceFile.statements.some((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)), false);

const forbiddenNames = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "Worker", "SharedWorker", "MutationObserver",
  "setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "queueMicrotask", "eval", "Function",
  "insertAdjacentHTML", "write", "writeln", "scrollTo", "scrollBy", "scrollIntoView", "pushState", "replaceState",
  "dispatchEvent", "CustomEvent",
]);
const forbiddenAssignments = new Set(["innerHTML", "outerHTML"]);
const staticMember = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
const rootIdentifier = (node) => {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : null;
};
const isAssignment = (kind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
function walkAst(node) {
  assert.equal(ts.isAwaitExpression(node), false, "await is forbidden");
  if (ts.isIdentifier(node)) {
    assert.equal(new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "Worker", "SharedWorker", "MutationObserver", "setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "queueMicrotask", "eval", "Function", "CustomEvent", "dispatchEvent", "console", "window", "globalThis"]).has(node.text), false, `forbidden identifier ${node.text}`);
  }
  if (ts.isCallExpression(node)) {
    assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic import is forbidden");
    const name = ts.isIdentifier(node.expression) ? node.expression.text : staticMember(node.expression);
    assert.equal(forbiddenNames.has(name), false, `forbidden call ${name}`);
    if (["assign", "defineProperty", "defineProperties", "setPrototypeOf", "set"].includes(name) && node.arguments.length > 0) {
      assert.equal(["window", "globalThis", "document"].includes(rootIdentifier(node.arguments[0])), false, "global/document mutation helper is forbidden");
    }
  }
  if (ts.isNewExpression(node)) {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : staticMember(node.expression);
    assert.equal(forbiddenNames.has(name), false, `forbidden constructor ${name}`);
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const owner = rootIdentifier(node), member = staticMember(node);
    assert.equal(owner === "console", false, "console access is forbidden");
    assert.equal(member === "serviceWorker", false, "serviceWorker access is forbidden");
    assert.equal(["innerHTML", "outerHTML", "insertAdjacentHTML"].includes(member), false, `forbidden HTML property ${member}`);
  }
  if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
    assert.equal(forbiddenAssignments.has(staticMember(node.left)), false, `forbidden HTML assignment ${staticMember(node.left)}`);
    assert.equal(["window", "globalThis", "document"].includes(rootIdentifier(node.left)), false, "global/document assignment is forbidden");
  }
  ts.forEachChild(node, walkAst);
}
walkAst(sourceFile);

for (const denied of [/url\s*\(/i, /@font-face/i, /\banimation(?:-name)?\s*:/i, /\bposition\s*:\s*(?:fixed|sticky)\b/i]) {
  assert.doesNotMatch(css, denied);
}

for (const token of [
  "--history-change", "--history-change-bg", "--history-change-border",
  ".history-changebar", "section.history-changed > details.sec > summary .sec-label::before",
  "nav.jump a.history-changed::after", "prefers-color-scheme: dark",
  ':root:not([data-theme="light"])', ':root[data-theme="dark"]',
  "max-width: 640px", "@media print", "focus-visible",
]) assert.ok(css.includes(token), `missing CSS contract: ${token}`);

const selectorBlocks = css.match(/([^{}]+)\{/g) ?? [];
for (const block of selectorBlocks) {
  const selector = block.slice(0, -1).trim();
  if (selector.startsWith("@") || selector === ":root" || selector.startsWith(":root")) continue;
  for (const part of selector.split(",")) {
    const value = part.trim();
    assert.ok(value.startsWith(".history-") || value.startsWith("section.history-changed") || value.startsWith("nav.jump a.history-changed"), `foreign selector: ${value}`);
  }
}
console.log("PASS  P3-D structural JavaScript and CSS contract");
NODE
```

Expected: exactly `PASS  P3-D structural JavaScript and CSS contract` and exit `0`. The repository-pinned TypeScript parser supplies the JavaScript oracle; regex is used only for CSS text, where the contract is textual selector/declaration syntax rather than runtime JavaScript behavior.

### 2. Deterministic module behavior

Create one disposable harness and run it as a directly supervised child. The AST oracle in step 1 proves the module cannot create descendants, so a retained positive child PID is the complete process boundary. The VM also poisons each forbidden runtime global so an executed dynamic route fails even if a future syntax form evades the structural member-name checks.

```bash
set -euo pipefail

P3D_TEST_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P3D_TEST_ROOT="$(mktemp -d "$P3D_TEST_PARENT/p3-d-history.XXXXXX")"
export P3D_TEST_ROOT
trap 'case "${P3D_TEST_ROOT:-}" in "$P3D_TEST_PARENT"/p3-d-history.??????) find "$P3D_TEST_ROOT" -depth -delete ;; *) exit 1 ;; esac' EXIT HUP INT TERM
cp templates/base/history.js "$P3D_TEST_ROOT/history.js"

sed 's/^  //' >"$P3D_TEST_ROOT/test.mjs" <<'P3D_TEST'
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import vm from "node:vm";

  const source = readFileSync(new URL("./history.js", import.meta.url), "utf8");
  class ClassList {
    values = new Set();
    add(value) { this.values.add(value); }
    remove(value) { this.values.delete(value); }
    contains(value) { return this.values.has(value); }
  }
  class Element {
    constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = new Map(); this.classList = new ClassList(); this.listeners = new Map(); this.parent = null; this.open = false; this._text = ""; }
    set id(value) { this.setAttribute("id", value); }
    get id() { return this.getAttribute("id") ?? ""; }
    set className(value) { this.classList = new ClassList(); for (const token of String(value).split(/\s+/)) if (token) this.classList.add(token); }
    get className() { return [...this.classList.values].join(" "); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    append(...nodes) { for (const node of nodes) { const child = typeof node === "string" ? new Text(node) : node; child.parent = this; this.children.push(child); } }
    appendChild(node) { this.append(node); return node; }
    prepend(node) { node.parent = this; this.children.unshift(node); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === "class") for (const token of String(value).split(/\s+/)) if (token) this.classList.add(token); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    click() { const event = { type: "click", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.listeners.get("click")?.(event); this.lastClick = event; }
    querySelector(selector) {
      if (selector === "details.sec") return walk(this).find((node) => node.tagName === "DETAILS" && node.classList.contains("sec")) ?? null;
      if (selector === ".sec-label") return walk(this).find((node) => node.classList.contains("sec-label")) ?? null;
      throw new Error(`unsupported fixture selector ${selector}`);
    }
  }
  class Text extends Element { constructor(value) { super("#text"); this._text = value; } }
  const walk = (root) => root.children.flatMap((child) => [child, ...walk(child)]);
  const snapshot = (node) => ({ tag: node.tagName, text: node._text, open: node.open, classes: [...node.classList.values], attributes: [...node.attributes], children: node.children.map(snapshot) });
  const ordinaryHistory = () => ({
    doc: "sample-guide", head: "abc1234", versions: [
      { sha: "abc1234", date: "2026-03-03T00:00:00.000Z", author: "Sample Writer", subject: "Refine the overview", url: "", changed: [
        { file: "01-overview.html", id: "overview", add: 1, del: 1, patch: "@@ -1 +1 @@", clipped: false },
        { file: "deleted.html", id: "retired", add: 0, del: 1, patch: "", clipped: false },
      ] },
      { sha: "def5678", date: "2026-03-02T00:00:00.000Z", author: "Example Editor", subject: "Clarify delivery", url: "", changed: [
        { file: "01-overview.html", id: "overview", add: 1, del: 0, patch: "@@ -1 +1 @@", clipped: false },
        { file: "02-delivery.html", id: "delivery", add: 2, del: 0, patch: "", clipped: false },
      ] },
      { sha: "9876abc", date: "2026-03-01T00:00:00.000Z", author: "Fixture Author", subject: "Initial sample", url: "", changed: [] },
    ],
  });
  function page({ history = ordinaryHistory(), historyElement = true, stored = null, getError = null, setError = null, main = true, sectionIds = ["overview", "delivery"], navIds = ["overview", "delivery"], labels = {}, navLabels = labels, omitLabelIds = [], sectionTags = {}, omitDetailsIds = [] } = {}) {
    const data = new Element("script"); data.setAttribute("id", "doc-history"); data.textContent = typeof history === "string" ? history : JSON.stringify(history);
    const body = new Element("body"); const mainNode = main ? new Element("main") : null; if (mainNode) body.append(mainNode);
    const nav = new Element("nav"); nav.classList.add("jump"); body.append(nav);
    const byId = new Map(historyElement ? [["doc-history", data]] : []);
    for (const id of sectionIds) {
      const label = labels[id] ?? ({ overview: "Overview", delivery: "Delivery" }[id] ?? id);
      const section = new Element(sectionTags[id] ?? "section"); section.setAttribute("id", id);
      const details = new Element("details"); details.classList.add("sec");
      const heading = new Element("p"); heading.classList.add("sec-label"); heading.textContent = label; if (!omitLabelIds.includes(id)) details.append(heading); if (!omitDetailsIds.includes(id)) section.append(details); body.append(section); byId.set(id, section);
    }
    for (const id of navIds) {
      const label = navLabels[id] ?? ({ overview: "Overview", delivery: "Delivery" }[id] ?? id);
      const link = new Element("a"); link.setAttribute("href", `#${id}`); link.textContent = label; nav.append(link);
    }
    const calls = [];
    const storage = {
      getItem(key) { calls.push(["get", key]); if (getError) throw getError; return stored; },
      setItem(key, value) { calls.push(["set", key, value]); if (setError) throw setError; stored = value; },
    };
    const document = {
      getElementById(id) { return byId.get(id) ?? null; },
      querySelector(selector) { if (selector === "main") return mainNode; throw new Error(`unsupported document selector ${selector}`); },
      querySelectorAll(selector) { if (selector === "nav.jump a") return walk(nav).filter((node) => node.tagName === "A"); throw new Error(`unsupported document selector ${selector}`); },
      createElement(tag) { return new Element(tag); },
      createTextNode(text) { return new Text(text); },
    };
    const before = snapshot(body);
    const poisonHits = [];
    const poison = (name) => new Proxy(function () {}, {
      apply() { poisonHits.push(name); throw new Error(`forbidden runtime ${name}`); },
      construct() { poisonHits.push(name); throw new Error(`forbidden runtime ${name}`); },
      get() { poisonHits.push(name); throw new Error(`forbidden runtime ${name}`); },
      set() { poisonHits.push(name); throw new Error(`forbidden runtime ${name}`); },
    });
    const poisoned = Object.fromEntries([
      "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "Worker", "SharedWorker", "MutationObserver",
      "setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "queueMicrotask", "eval", "Function",
      "CustomEvent", "dispatchEvent", "open", "navigator", "console",
    ].map((name) => [name, poison(name)]));
    document.write = poison("document.write"); document.writeln = poison("document.writeln");
    vm.runInNewContext(source, { ...poisoned, document, localStorage: storage, HTMLElement: Element, HTMLAnchorElement: Element }, { timeout: 1000 });
    assert.deepEqual(poisonHits, [], "history.js reached a poisoned forbidden runtime surface");
    return { body, mainNode, nav, byId, calls, before, stored: () => stored };
  }
  const bar = (result) => result.mainNode?.children.find((node) => node.classList.contains("history-changebar"));
  const assertNoPresentation = (result, expectedCalls, label = "no presentation") => {
    assert.equal(bar(result), undefined, label);
    assert.equal(walk(result.body).some((node) => node.classList.contains("history-changed")), false, label);
    assert.deepEqual(result.calls, expectedCalls, label);
    assert.deepEqual(snapshot(result.body), result.before, `${label}: DOM changed`);
  };

  const first = page();
  assertNoPresentation(first, [["get", "read:sample-guide"], ["set", "read:sample-guide", "abc1234"]]);
  const current = page({ stored: "abc1234" });
  assertNoPresentation(current, [["get", "read:sample-guide"]]);
  const returning = page({ stored: "9876abc" });
  const returningBar = bar(returning);
  assert.equal(returning.mainNode.children[0], returningBar);
  assert.equal(returningBar.tagName, "ASIDE"); assert.equal(returningBar.className, "history-changebar"); assert.equal(returningBar.getAttribute("aria-label"), "Document updates");
  const barElements = returningBar.children.filter((node) => node.tagName !== "#TEXT");
  assert.deepEqual(barElements.map((node) => node.tagName), ["P", "BUTTON"]);
  assert.equal(returningBar.children.filter((node) => node.tagName === "#TEXT").every((node) => /^\s*$/.test(node.textContent)), true);
  const strong = barElements[0].children.find((node) => node.tagName === "STRONG");
  assert.equal(strong.textContent, "2"); assert.equal(barElements[0].children.filter((node) => node.tagName === "STRONG").length, 1);
  assert.equal(barElements[1].getAttribute("type"), "button"); assert.equal(barElements[1].textContent, "Mark as read");
  assert.match(returningBar.textContent.trim(), /^2 updates since you last read this: Overview, DeliveryMark as read$/);
  assert.equal(returning.byId.get("overview").classList.contains("history-changed"), true);
  assert.equal(returning.byId.get("delivery").classList.contains("history-changed"), true);
  assert.equal(returning.byId.get("retired"), undefined);
  const returningNavLinks = walk(returning.nav).filter((node) => node.tagName === "A");
  assert.deepEqual(returningNavLinks.map((node) => node.classList.contains("history-changed")), [true, true]);
  const anchors = walk(bar(returning)).filter((node) => node.tagName === "A");
  assert.deepEqual(anchors.map((node) => [node.getAttribute("href"), node.textContent]), [["#overview", "Overview"], ["#delivery", "Delivery"]]);
  anchors[0].click(); assert.equal(anchors[0].lastClick.defaultPrevented, false); assert.equal(returning.byId.get("overview").querySelector("details.sec").open, true);
  const button = walk(bar(returning)).find((node) => node.tagName === "BUTTON"); button.click();
  assert.deepEqual(returning.calls.at(-1), ["set", "read:sample-guide", "abc1234"]); assert.equal(bar(returning), undefined);
  assert.equal(returning.byId.get("overview").classList.contains("history-changed"), false);
  assert.equal(returning.byId.get("delivery").classList.contains("history-changed"), false);
  assert.deepEqual(returningNavLinks.map((node) => node.classList.contains("history-changed")), [false, false]);

  const old = page({ stored: "fffffff" }); assert.match(bar(old).textContent, /^3 updates /);
  const one = page({ stored: "def5678" }); assert.match(bar(one).textContent, /^1 update since /);
  const failedWrite = page({ stored: "9876abc", setError: new Error("blocked") }); const retainedBar = bar(failedWrite); walk(retainedBar).find((node) => node.tagName === "BUTTON").click(); assert.equal(bar(failedWrite), retainedBar);
  assert.equal(failedWrite.byId.get("overview").classList.contains("history-changed"), true);
  assert.equal(walk(failedWrite.nav).find((node) => node.tagName === "A" && node.getAttribute("href") === "#overview").classList.contains("history-changed"), true);
  const failedBaseline = page({ setError: new Error("blocked") }); assertNoPresentation(failedBaseline, [["get", "read:sample-guide"], ["set", "read:sample-guide", "abc1234"]]);
  assertNoPresentation(page({ historyElement: false }), []);
  assertNoPresentation(page({ getError: new Error("blocked") }), [["get", "read:sample-guide"]]);
  assertNoPresentation(page({ history: "{" }), []);
  assertNoPresentation(page({ main: false }), []);
  assertNoPresentation(page({ stored: 17 }), [["get", "read:sample-guide"]]);
  const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
  const oneVersion = (row) => ({ doc: "sample-guide", head: "abc1234", versions: [row] });
  const baseVersion = ordinaryHistory().versions[0];
  const oneChanged = (row) => oneVersion({ ...baseVersion, changed: [row] });
  const baseChanged = baseVersion.changed[0];
  const invalidHistoryCases = [
    ["top null", null], ["top array", []], ["top primitive", 1],
    ...["doc", "head", "versions"].map((key) => [`top missing ${key}`, omit(ordinaryHistory(), key)]),
    ["top extra", { ...ordinaryHistory(), extra: true }],
    ["doc type", { ...ordinaryHistory(), doc: 1 }], ["doc empty", { ...ordinaryHistory(), doc: "" }],
    ["doc dot", { ...ordinaryHistory(), doc: "." }], ["doc dot-dot", { ...ordinaryHistory(), doc: ".." }],
    ["doc path-like", { ...ordinaryHistory(), doc: "../sample" }], ["doc grammar/case", { ...ordinaryHistory(), doc: "Sample" }],
    ["head type", { ...ordinaryHistory(), head: 1 }], ["head short", { ...ordinaryHistory(), head: "abc123" }],
    ["head long", { ...ordinaryHistory(), head: "abc12345" }], ["head grammar/case", { ...ordinaryHistory(), head: "ABC1234" }],
    ["versions type", { ...ordinaryHistory(), versions: {} }], ["versions lower bound", { ...ordinaryHistory(), versions: [] }],
    ["versions upper bound", { ...ordinaryHistory(), versions: Array.from({ length: 13 }, (_, index) => ({ ...baseVersion, sha: index.toString(16).padStart(7, "0") })), head: "0000000" }],
    ["version null", oneVersion(null)], ["version array", oneVersion([])], ["version primitive", oneVersion(1)],
    ...["sha", "date", "author", "subject", "url", "changed"].map((key) => [`version missing ${key}`, oneVersion(omit(baseVersion, key))]),
    ["version extra", oneVersion({ ...baseVersion, extra: true })],
    ["sha type", oneVersion({ ...baseVersion, sha: 1 })], ["sha short", oneVersion({ ...baseVersion, sha: "abc123" })],
    ["sha long", oneVersion({ ...baseVersion, sha: "abc12345" })], ["sha grammar/case", oneVersion({ ...baseVersion, sha: "ABC1234" })],
    ["sha duplicate", { ...ordinaryHistory(), versions: [baseVersion, { ...ordinaryHistory().versions[1], sha: "abc1234" }] }],
    ["head relation", { ...ordinaryHistory(), head: "fffffff" }],
    ["changed type", oneVersion({ ...baseVersion, changed: null })],
    ["changed per-row upper bound", oneVersion({ ...baseVersion, changed: Array.from({ length: 257 }, () => baseChanged) })],
    ["changed aggregate upper bound", { doc: "sample-guide", head: "0000000", versions: Array.from({ length: 12 }, (_, index) => ({ ...baseVersion, sha: index.toString(16).padStart(7, "0"), changed: Array.from({ length: 22 }, () => baseChanged) })) }],
    ["changed row null", oneChanged(null)], ["changed row array", oneChanged([])], ["changed row primitive", oneChanged(1)],
    ...["file", "id", "add", "del", "patch", "clipped"].map((key) => [`changed row missing ${key}`, oneChanged(omit(baseChanged, key))]),
    ["changed row extra", oneChanged({ ...baseChanged, extra: true })],
    ["changed id type", oneChanged({ ...baseChanged, id: 1 })], ["changed id empty", oneChanged({ ...baseChanged, id: "" })],
    ["changed id path-like", oneChanged({ ...baseChanged, id: "../overview" })], ["changed id grammar/case", oneChanged({ ...baseChanged, id: "Overview" })],
  ];
  for (const [label, invalid] of invalidHistoryCases) assertNoPresentation(page({ history: invalid }), [], label);
  const twelveVersions = { doc: "sample-guide", head: "0000000", versions: Array.from({ length: 12 }, (_, index) => ({ ...baseVersion, sha: index.toString(16).padStart(7, "0"), changed: [] })) };
  assertNoPresentation(page({ history: twelveVersions, stored: "0000000" }), [["get", "read:sample-guide"]]);
  const exactly256Changes = oneVersion({ ...baseVersion, changed: Array.from({ length: 256 }, (_, index) => ({ ...baseChanged, id: `section-${index}` })) });
  assertNoPresentation(page({ history: exactly256Changes, stored: "abc1234", sectionIds: [], navIds: [] }), [["get", "read:sample-guide"]]);
  const hostile = ordinaryHistory(); hostile.versions[0].changed[0].id = 'overview\"/><img src=x onerror=1>';
  assertNoPresentation(page({ history: hostile, stored: "9876abc" }), []);
  const inertLabel = page({ stored: "9876abc", labels: { overview: '<img src=x onerror="fixture">' } });
  assert.match(bar(inertLabel).textContent, /<img src=x onerror="fixture">/); assert.equal(walk(bar(inertLabel)).some((node) => node.tagName === "IMG"), false);
  const navLabelFallback = page({ stored: "9876abc", sectionIds: ["overview"], navIds: ["overview"], omitLabelIds: ["overview"], navLabels: { overview: "Navigation overview" } });
  assert.match(bar(navLabelFallback).textContent, /Navigation overview/);
  const idLabelFallback = page({ stored: "9876abc", sectionIds: ["overview"], navIds: [], labels: { overview: "   " } });
  assert.match(bar(idLabelFallback).textContent, /overview/);
  const noNav = page({ stored: "9876abc", navIds: [] }); assert.ok(bar(noNav)); assert.equal(noNav.byId.get("overview").classList.contains("history-changed"), true);
  const wrongElement = page({ stored: "9876abc", sectionIds: ["overview"], navIds: ["overview"], sectionTags: { overview: "article" } });
  assert.equal(wrongElement.byId.get("overview").classList.contains("history-changed"), false); assert.equal(bar(wrongElement).textContent.includes("Overview"), false);
  assert.equal(walk(wrongElement.nav)[0].classList.contains("history-changed"), false);
  const missingDetails = page({ stored: "9876abc", sectionIds: ["overview"], navIds: ["overview"], omitDetailsIds: ["overview"] });
  assert.equal(missingDetails.byId.get("overview").classList.contains("history-changed"), false); assert.equal(bar(missingDetails).textContent.includes("Overview"), false);
  assert.equal(walk(missingDetails.nav)[0].classList.contains("history-changed"), false);
  const noCurrent = page({ stored: "9876abc", sectionIds: [], navIds: [] }); assert.equal(bar(noCurrent).textContent.includes(":"), false);
  console.log("PASS  P3-D marker, bar, section, storage, and hostile-input contract");
P3D_TEST

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const child = spawn(process.execPath, [join(process.env.P3D_TEST_ROOT, "test.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "", timedOut = false;
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 30_000);
const result = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
assert.equal(timedOut, false); assert.deepEqual(result, { code: 0, signal: null }); assert.equal(stderr, "");
assert.equal(stdout, "PASS  P3-D marker, bar, section, storage, and hostile-input contract\n");
process.stdout.write(stdout);
NODE

find "$P3D_TEST_ROOT" -depth -delete
trap - EXIT HUP INT TERM
test ! -e "$P3D_TEST_ROOT"
```

Expected: exactly `PASS  P3-D marker, bar, section, storage, and hostile-input contract`, exit `0`, and no `p3-d-history.*` residue. The fixed matrix covers every marker branch; every declared top-level, version-row, and changed-row missing/extra/type class; both invalid sides and the valid edge of the 12-version and 256-change bounds; exact SHA length/case/uniqueness/head relation; explicit `.`, `..`, path-like, empty, case, and non-string identifier rejection; storage failures; absent current sections/nav links; wrong-element and missing-`details.sec` eligibility failures; deduplicated changed IDs; inert HTML-looking text; ordinary fragment navigation without cancellation; and successful/failed acknowledgement. The poisoned VM runtime proves none of the enumerated forbidden globals is reached on any executed fixture path, complementing the whole-source AST oracle. No additional test seam is required or permitted in production.

### 3. Rendered file-mode, theme, responsive, focus, and print gate

This mandatory rendered gate opens a `file:` document, loads the exact owned `history.css` as its file subresource, and injects the exact owned `history.js` bytes as a module after document load, matching the optional inline module slot without copying its behavior into the test. It uses public `playwright@1.55.0` and that package's pinned Chromium revision; the install, npm cache, browser, HTML, and scripts live only under one guarded temporary root. Setup downloads are outside the page request oracle. Once Chromium opens the fixture, every page request is recorded and any HTTP(S) request fails the test.

The directly running Node supervisor owns each npm/Playwright/browser-test command in a detached process group, applies per-command and overall deadlines, sends TERM then KILL, waits for the child, and proves group disappearance before deleting the root. HUP/INT/TERM preserve statuses 129/130/143. A clean failure still removes the root; an uncontained group or deletion failure retains a mode-0600 locator and exits 125 for manual remediation. Run on macOS or Linux from the repository root with public registry/download access:

```bash
set -euo pipefail

P3D_RENDER_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P3D_RENDER_ROOT=
pre_exec_cleanup() {
  case "${P3D_RENDER_ROOT:-}" in
    "$P3D_RENDER_PARENT"/p3-d-render.??????) find "$P3D_RENDER_ROOT" -depth -delete ;;
    "") ;;
    *) printf '%s\n' 'ERROR  refusing unsafe P3-D render cleanup target' >&2; exit 125 ;;
  esac
}
trap pre_exec_cleanup EXIT HUP INT TERM
P3D_RENDER_ROOT="$(mktemp -d "$P3D_RENDER_PARENT/p3-d-render.XXXXXX")"
chmod 700 "$P3D_RENDER_ROOT"
export P3D_RENDER_ROOT
cp templates/base/history.js templates/base/history.css "$P3D_RENDER_ROOT/"

sed 's/^  //' >"$P3D_RENDER_ROOT/fixture.html" <<'P3D_HTML'
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>History render fixture</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; max-width: 100%; }
      main { width: 100%; padding: 12px; }
      .sec-label::after { content: " —"; }
    </style>
    <link rel="stylesheet" href="./history.css">
  </head>
  <body>
    <main>
      <nav class="jump" aria-label="Fixture sections"><a href="#overview">Overview</a><a href="#delivery">Delivery</a></nav>
      <section id="overview"><details class="sec"><summary><span class="sec-label">Overview</span></summary><p>Rendered overview.</p></details></section>
      <section id="delivery"><details class="sec"><summary><span class="sec-label">Delivery</span></summary><p>Rendered delivery.</p></details></section>
    </main>
    <script type="application/json" id="doc-history">{"doc":"sample-guide","head":"abc1234","versions":[{"sha":"abc1234","date":"2026-09-03T00:00:00.000Z","author":"Fixture Writer","subject":"Refine sections","url":"","changed":[{"file":"01-overview.html","id":"overview","add":2,"del":1,"patch":"","clipped":false},{"file":"02-delivery.html","id":"delivery","add":1,"del":0,"patch":"","clipped":false}]},{"sha":"9876abc","date":"2026-09-02T00:00:00.000Z","author":"Fixture Editor","subject":"Earlier state","url":"","changed":[]}]}</script>
  </body>
  </html>
P3D_HTML

sed 's/^  //' >"$P3D_RENDER_ROOT/no-history.html" <<'P3D_NO_HISTORY_HTML'
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>No history fixture</title>
    <link rel="stylesheet" href="./history.css">
  </head>
  <body><main><section id="overview"><details class="sec"><summary><span class="sec-label">Overview</span></summary></details></section></main></body>
  </html>
P3D_NO_HISTORY_HTML

sed 's/^  //' >"$P3D_RENDER_ROOT/browser.mjs" <<'P3D_BROWSER'
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";
  import { pathToFileURL } from "node:url";
  import { join } from "node:path";

  const root = process.env.P3D_RENDER_ROOT;
  const require = createRequire(import.meta.url);
  const { chromium } = require("./tool/node_modules/playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 720 }, colorScheme: "light" });
    const page = await context.newPage();
    const httpRequests = [], pageErrors = [], consoleErrors = [];
    page.on("request", (request) => { if (/^https?:/i.test(request.url())) httpRequests.push(request.url()); });
    page.on("pageerror", (error) => { pageErrors.push(error.message); });
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem("read:sample-guide", "9876abc"));
    await page.goto(pathToFileURL(join(root, "fixture.html")).href, { waitUntil: "load", timeout: 15_000 });
    await page.addScriptTag({ path: join(root, "history.js"), type: "module" });
    await page.locator(".history-changebar").waitFor({ state: "visible", timeout: 5_000 });

    assert.match(page.url(), /^file:/); assert.deepEqual(httpRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []);
    assert.equal(await page.locator("section.history-changed").count(), 2);
    assert.equal(await page.locator("nav.jump a.history-changed").count(), 2);
    assert.equal(await page.evaluate(() => [...document.styleSheets].some((sheet) => sheet.href?.startsWith("file:") && sheet.href.endsWith("/history.css"))), true);

    const theme = () => page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement), barStyle = getComputedStyle(document.querySelector(".history-changebar"));
      return {
        vars: ["--history-change", "--history-change-bg", "--history-change-border"].map((name) => rootStyle.getPropertyValue(name).trim()),
        paint: [barStyle.color, barStyle.backgroundColor, barStyle.borderTopColor],
      };
    });
    const light = await theme(); assert.equal(light.vars.every(Boolean), true); assert.equal(light.paint.every(Boolean), true);
    await page.emulateMedia({ colorScheme: "dark" }); const systemDark = await theme(); assert.notDeepEqual(systemDark, light);
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; }); assert.deepEqual(await theme(), light);
    await page.emulateMedia({ colorScheme: "light" }); await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); assert.deepEqual(await theme(), systemDark);
    await page.evaluate(() => { delete document.documentElement.dataset.theme; document.activeElement?.blur(); });

    const hoverPaint = (locator) => locator.evaluate((element) => { const style = getComputedStyle(element); return [style.color, style.backgroundColor, style.textDecorationLine, style.borderColor]; });
    const firstLink = page.locator(".history-changebar a").first(), markButton = page.locator(".history-changebar button");
    const linkRest = await hoverPaint(firstLink); await firstLink.hover(); assert.notDeepEqual(await hoverPaint(firstLink), linkRest);
    await page.mouse.move(0, 0); const buttonRest = await hoverPaint(markButton); await markButton.hover(); assert.notDeepEqual(await hoverPaint(markButton), buttonRest); await page.mouse.move(0, 0);

    await page.keyboard.press("Tab");
    let focus = await page.evaluate(() => {
      const element = document.activeElement, style = getComputedStyle(element), probe = document.createElement("span");
      probe.style.color = "var(--history-change)"; document.body.append(probe); const expectedColor = getComputedStyle(probe).color; probe.remove();
      return { tag: element.tagName, inBar: Boolean(element.closest(".history-changebar")), visible: element.matches(":focus-visible"), outline: [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor], expectedColor };
    });
    assert.equal(focus.tag, "A"); assert.equal(focus.inBar, true); assert.equal(focus.visible, true); assert.deepEqual(focus.outline.slice(0, 3), ["solid", "2px", "2px"]); assert.equal(focus.outline[3], focus.expectedColor);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    focus = await page.evaluate(() => {
      const element = document.activeElement, style = getComputedStyle(element), probe = document.createElement("span");
      probe.style.color = "var(--history-change)"; document.body.append(probe); const expectedColor = getComputedStyle(probe).color; probe.remove();
      return { tag: element.tagName, inBar: Boolean(element.closest(".history-changebar")), visible: element.matches(":focus-visible"), outline: [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor], expectedColor };
    });
    assert.deepEqual(focus, { tag: "BUTTON", inBar: true, visible: true, outline: ["solid", "2px", "2px", focus.expectedColor], expectedColor: focus.expectedColor });

    const normalDots = await page.evaluate(() => ({
      sectionBefore: getComputedStyle(document.querySelector("section.history-changed .sec-label"), "::before").content,
      sectionDivider: getComputedStyle(document.querySelector("section.history-changed .sec-label"), "::after").content,
      navAfter: getComputedStyle(document.querySelector("nav.jump a.history-changed"), "::after").content,
    }));
    assert.match(normalDots.sectionBefore, /•/); assert.match(normalDots.navAfter, /•/); assert.match(normalDots.sectionDivider, /—/);

    await page.setViewportSize({ width: 390, height: 720 });
    const narrow = await page.evaluate(() => {
      const bar = document.querySelector(".history-changebar"), button = bar.querySelector("button"), barRect = bar.getBoundingClientRect(), buttonRect = button.getBoundingClientRect(), style = getComputedStyle(bar);
      const contentWidth = barRect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { direction: style.flexDirection, widthDelta: Math.abs(buttonRect.width - contentWidth), left: barRect.left, right: barRect.right, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });
    assert.equal(narrow.direction, "column"); assert.ok(narrow.widthDelta <= 1); assert.ok(narrow.left >= 0 && narrow.right <= narrow.viewport); assert.ok(narrow.scrollWidth <= narrow.clientWidth);

    await page.emulateMedia({ media: "print", colorScheme: "light" });
    const printed = await page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector(".history-changebar")).display,
      sectionDot: getComputedStyle(document.querySelector("section.history-changed .sec-label"), "::before").display,
      navDot: getComputedStyle(document.querySelector("nav.jump a.history-changed"), "::after").display,
      section: getComputedStyle(document.querySelector("section.history-changed")).display,
    }));
    assert.deepEqual(printed, { bar: "none", sectionDot: "none", navDot: "none", section: "block" });
    assert.deepEqual(httpRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []);
    await context.close();

    const quietContext = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const quietPage = await quietContext.newPage();
    const quietHttp = [], quietErrors = [], quietConsole = [];
    quietPage.on("request", (request) => { if (/^https?:/i.test(request.url())) quietHttp.push(request.url()); });
    quietPage.on("pageerror", (error) => { quietErrors.push(error.message); });
    quietPage.on("console", (message) => { if (message.type() === "error") quietConsole.push(message.text()); });
    await quietPage.addInitScript(() => {
      globalThis.__historyStorageAccesses = 0;
      for (const name of ["getItem", "setItem"]) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function (...args) { globalThis.__historyStorageAccesses += 1; return original.apply(this, args); };
      }
    });
    await quietPage.goto(pathToFileURL(join(root, "no-history.html")).href, { waitUntil: "load", timeout: 15_000 });
    await quietPage.addScriptTag({ path: join(root, "history.js"), type: "module" });
    await quietPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await quietPage.locator("#doc-history").count(), 0);
    assert.equal(await quietPage.locator(".history-changebar, .history-changed").count(), 0);
    assert.equal(await quietPage.evaluate(() => globalThis.__historyStorageAccesses), 0);
    assert.deepEqual(quietHttp, []); assert.deepEqual(quietErrors, []); assert.deepEqual(quietConsole, []);
    await quietContext.close();
  } finally {
    await browser.close();
  }
  console.log("PASS  P3-D rendered file-mode, theme, focus, narrow, and print contract");
P3D_BROWSER

sed 's/^  //' >"$P3D_RENDER_ROOT/supervisor.mjs" <<'P3D_SUPERVISOR'
  import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { spawn } from "node:child_process";

  const root = process.env.P3D_RENDER_ROOT;
  if (!root || !/\/p3-d-render\.[A-Za-z0-9]{6}$/.test(root)) throw new Error("invalid render root");
  let activePid = 0, requestedStatus = 0, timedOut = false, groupProved = true;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; } };
  const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (error) { if (error?.code !== "ESRCH") throw error; } };
  const contain = async (pid) => {
    if (!pid || !groupAlive(pid)) return true;
    signalGroup(pid, "SIGTERM");
    for (let index = 0; index < 20 && groupAlive(pid); index += 1) await delay(100);
    if (groupAlive(pid)) signalGroup(pid, "SIGKILL");
    for (let index = 0; index < 20 && groupAlive(pid); index += 1) await delay(100);
    return !groupAlive(pid);
  };
  for (const [signal, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => {
    if (!requestedStatus) { requestedStatus = status; process.exitCode = status; }
    if (activePid) signalGroup(activePid, "SIGTERM");
  });
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(root, "browsers"), npm_config_cache: join(root, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
  const run = (command, args, timeout, visible = false) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, detached: true, stdio: visible ? "inherit" : "ignore" });
    let settled = false, expired = false, killTimer;
    child.once("spawn", () => { activePid = child.pid; });
    const timer = setTimeout(() => {
      expired = true; timedOut = true;
      if (child.pid) signalGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => { if (child.pid && groupAlive(child.pid)) signalGroup(child.pid, "SIGKILL"); }, 2_000);
    }, timeout);
    child.once("error", (error) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); activePid = 0; reject(error); });
    child.once("close", async (code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer);
      const clean = await contain(child.pid); groupProved &&= clean; activePid = 0;
      if (!clean) reject(new Error("owned process group remained"));
      else if (requestedStatus) reject(new Error("fixture interrupted"));
      else if (expired) reject(new Error("fixture command deadline"));
      else if (code !== 0 || signal !== null) reject(new Error("fixture command failed"));
      else resolve();
    });
  });

  let failed = false;
  const overall = setTimeout(() => { timedOut = true; if (activePid) signalGroup(activePid, "SIGTERM"); }, 600_000);
  try {
    await run("npm", ["install", "--prefix", join(root, "tool"), "--no-save", "--no-package-lock", "--ignore-scripts", "playwright@1.55.0"], 180_000);
    await run(join(root, "tool/node_modules/.bin/playwright"), ["install", "chromium"], 300_000);
    await run(process.execPath, [join(root, "browser.mjs")], 60_000, true);
  } catch { failed = true; }
  clearTimeout(overall);
  if (activePid) groupProved &&= await contain(activePid);

  let removed = false;
  if (groupProved) {
    try { rmSync(root, { recursive: true }); removed = !existsSync(root); } catch { removed = false; }
  }
  if (!groupProved || !removed) {
    const evidence = join(root, "manual-remediation.txt");
    try { writeFileSync(evidence, `root=${root}\npid=${process.pid}\npgid=${activePid || "none"}\n`, { flag: "wx", mode: 0o600 }); chmodSync(evidence, 0o600); } catch {}
    console.error(`MANUAL REMEDIATION P3-D root=${root} pid=${process.pid} pgid=${activePid || "none"} evidence=${evidence}`);
    process.exit(requestedStatus || 125);
  }
  process.exit(requestedStatus || (timedOut ? 124 : failed ? 1 : 0));
P3D_SUPERVISOR

exec env P3D_RENDER_ROOT="$P3D_RENDER_ROOT" node "$P3D_RENDER_ROOT/supervisor.mjs"
```

Expected: the tooling setup is bounded and quiet; the browser command prints exactly `PASS  P3-D rendered file-mode, theme, focus, narrow, and print contract`; the command exits `0`; and the guarded `p3-d-render.*` root no longer exists. The rendered oracle proves the exact module bytes create the bar/classes in a history-bearing `file:` document, the exact stylesheet is loaded from `file:`, both pages make zero HTTP(S) requests, the no-history page has no data block/UI/class/storage read or write after the production module executes, theme precedence changes computed values exactly as specified, link/button hover changes a declared computed paint value, keyboard focus paints the exact variable-derived outline on both links and the button, the narrow bar stacks with a full-content-width button and no horizontal overflow, normal section/nav dots coexist with the label divider, and print hides only the bar/dots among those tested elements.

### 4. Build and repository gates

```bash
set -euo pipefail

templates/check-dist
npm --prefix templates/docbuild run check

P3D_BUILD_PARENT="$PWD"
P3D_BUILD_ROOT="$(mktemp -d "$P3D_BUILD_PARENT/.p3-d-no-history.XXXXXX")"
case "$P3D_BUILD_ROOT" in "$P3D_BUILD_PARENT"/.p3-d-no-history.??????) ;; *) echo "unsafe build fixture root" >&2; exit 1;; esac
cleanup_p3d_build() {
  case "${P3D_BUILD_ROOT:-}" in "$P3D_BUILD_PARENT"/.p3-d-no-history.??????) find "$P3D_BUILD_ROOT" -depth -delete ;; *) return 1;; esac
}
trap cleanup_p3d_build EXIT HUP INT TERM
cp templates/skeleton/doc.json "$P3D_BUILD_ROOT/doc.json"
mkdir "$P3D_BUILD_ROOT/sections"
cp templates/skeleton/sections/01-problem.html "$P3D_BUILD_ROOT/sections/01-problem.html"
P3D_BUILD_REL="${P3D_BUILD_ROOT#"$P3D_BUILD_PARENT"/}"
NETLIFY=true templates/build "$P3D_BUILD_REL" >"$P3D_BUILD_ROOT/build.out" 2>"$P3D_BUILD_ROOT/build.err"
test ! -s "$P3D_BUILD_ROOT/build.err"
P3D_BUILT_HTML="$P3D_BUILD_ROOT/dist/$(basename "$P3D_BUILD_ROOT").html"
test -f "$P3D_BUILT_HTML"
P3D_BUILT_HTML="$P3D_BUILT_HTML" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(process.env.P3D_BUILT_HTML, "utf8");
const tags = html.match(/<[^>]+>/g) ?? [];
assert.equal(tags.some((tag) => /\bid\s*=\s*["']doc-history["']/.test(tag)), false);
assert.equal(tags.some((tag) => /\bclass\s*=\s*["'][^"']*\bhistory-(?:changebar|changed)\b/.test(tag)), false);
NODE
cleanup_p3d_build
trap - EXIT HUP INT TERM
test ! -e "$P3D_BUILD_ROOT"

scripts/scrub-check.sh docs/tickets/P3-D.md templates/base/history.js templates/base/history.css
git diff --check
test "$(rg '^## ' docs/tickets/P3-D.md | sed 's/^## //')" = "$(printf '%s\n' 'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' 'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' 'Assumptions and open questions' 'References')"
test "$(( $(rg -n '^```' docs/tickets/P3-D.md | wc -l | tr -d ' ') % 2 ))" -eq 0
awk 'BEGIN{inbash=0} /^```bash[[:space:]]*$/{inbash=1; next} /^```[[:space:]]*$/{if(inbash){inbash=0; print ""}; next} inbash{print}' docs/tickets/P3-D.md | bash -n

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const fields = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8" }).split("\0").filter(Boolean);
const paths = [];
for (let i = 0; i < fields.length; i += 1) {
  const entry = fields[i]; assert.match(entry, /^.. /); paths.push(entry.slice(3));
  if (/[RC]/.test(entry.slice(0, 2))) paths.push(fields[++i]);
}
const implementation = [...new Set(paths)].filter((path) => !path.startsWith("docs/tickets/")).sort();
assert.deepEqual(implementation, ["templates/base/history.css", "templates/base/history.js"]);
console.log("PASS  P3-D owns only history.js and history.css");
NODE

issue_json="$(gh issue view 17 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-D.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-D — The changelog client" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-D issue #17 pointer integrity'
```

Expected: all commands exit `0`; `check-dist` reports byte-identical committed documents; TypeScript emits no diagnostics; the isolated Netlify-mode skeleton build emits no `#doc-history`, history UI, or history class and leaves no `.p3-d-no-history.*` residue; scrub reports no denied term or warning; whitespace is clean; the heading/fence/Bash syntax checks emit nothing; and the ownership oracle prints its one `PASS` line. Issue #17 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the final line is `PASS  P3-D issue #17 pointer integrity`. The implementation commit includes rebuilt output only when the repository's normal build policy requires it; P3-D never edits generated output directly.

## Failure modes

- No `#doc-history`, no valid history, or no `main`: return silently before storage and presentation work.
- `JSON.parse` or defensive shape validation fails: treat the block as absent; do not partially render a valid prefix.
- `localStorage.getItem` throws: render nothing and do not try a write.
- First-visit `setItem` throws: remain visually first-visit; the next load may retry.
- Returning-reader `setItem` throws: keep the bar and dots; never falsely acknowledge the update.
- Marker is non-null but malformed, unknown, or older than the retained window: show every retained version. Over-reporting is safer than hiding unseen work.
- A version changes only metadata, extra CSS, or a removed/renamed/unknown section: count the version in the bar but add no link/dot for that item.
- A current section has no nav link: mark and link the section; omit only the nav dot.
- A current section has no usable label: display the nav text or literal safe ID.
- Duplicate changed IDs across rows: render and mark once at their first newest-first occurrence.
- History-derived text resembles HTML or a selector: keep it inert via validation and text-node construction.
- Storage is cleared later: the next load is a new baseline and intentionally shows no bar.
- Rendered-gate install, launch, or assertion fails: contain/reap the owned group and remove the guarded tooling root; retain the mode-0600 locator and fail 125 only when group disappearance or root removal cannot be proved.
- Deliberately not handled: cross-device continuity, a marker older than data the twelve-row window can describe precisely, live history, annotation unread state, and a second browser-side source of truth.

## Settled decisions

- Document history and annotation history remain separate. This ticket consumes committed/baked document history only.
- Git/source history is produced before deployment; the browser never reads GitHub or a server for this feature.
- `localStorage` is permitted only as a disposable last-read marker, never a record of authority.
- First visit is a baseline, not an unread event. Cleared storage deliberately returns to that state.
- An evicted marker over-reports the complete retained window rather than hiding possible unread work.
- The count is retained version rows; dots are deduplicated current section IDs.
- Current labels come from current DOM because P2-E intentionally does not persist labels.
- DOM construction is node-based and history text is never parsed as markup.
- P2-E's generated changelog remains the detailed history surface; this ticket adds only orientation and acknowledgement.
- There is no dependency, fetch, global API, or amendment to the base app/layout/builder.

## Assumptions and open questions

- **Assumption:** P1-B's base app continues to own general fragment scrolling. P3-D only opens a changed section before ordinary navigation.
- **Assumption:** one browser profile may use the same `read:<doc>` key across origins. The instance basename is the settled P2-E identity for this non-authoritative convenience state; origin scoping is already supplied by `localStorage` itself.
- **Assumption:** the parsed P2-E/P4-R JSON is the only history input. Same-origin code that replaces the script text is still constrained to JSON data and cannot inject object capabilities.
- **Open question (non-blocking):** none. Product behavior, failure behavior, and the later P4-R schema compatibility are settled.

## References

- `docs/research/00-integration-plan.md` §§1.4, 2.8, 4.1, 4.5, and 6 — Mode boundaries, committed history, optional asset slots, Phase 3 ownership, and the narrow allowed use of `localStorage`.
- `docs/research/06-history.md` §§1, 3, 5, 8, and 10 — document/annotation separation, source-only history, last-read interaction, rejected alternatives, and verification intent. Its old `changed[].label` example is superseded by P2-E's label-free schema and current-DOM lookup here.
- `docs/tickets/P1-B.md` — exact history asset/data slot placement, zero-byte absence, module order, and no-layout-amendment boundary.
- `docs/tickets/P2-E.md` — authoritative `History` shape, changed-ID behavior, bounded window, embedded escaping, generated changelog, public-history admission, and P4-R compatibility.
- GitHub issue #17 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
