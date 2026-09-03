# P2-C — The session probe and the reveal rules

## Outcome

Every built document has one silent browser session probe that reveals capability-scoped controls only after a valid authenticated response and publishes that response once to all downstream client modules.

## Context

Documents must remain complete, quiet, and readable from `file://`, inside a network-restricted artifact, on a plain static host, and while the session service is unavailable.
P1-B created late-loading optional slots so this ticket can add the probe and reveal rules without reopening the builder or layout, while P1-C provides the initial trusted server response.
This client state is only a presentation hint; every write remains authorized by its server function.

## Scope

### In scope

- Create the optional `templates/base/session.js` module consumed by P1-B's `{{SESSION_JS}}` slot.
- Read the permanent document id from `<meta name="doc-id">` and make one `GET /api/session?doc=<docId>` request on an HTTP or HTTPS page.
- Accept P1-C's Phase 1 response and P3-H's later document-aware response without changing this client file.
- Keep loading, signed-out, malformed, timed-out, offline, blocked, partially delivered, and otherwise degraded states visually identical to the static document.
- Set `data-session="editor"` or `data-session="reader"` on `document.documentElement` only after a valid authenticated response.
- Dispatch exactly one `session` `CustomEvent` after the root attribute is set, with the same recursively frozen parsed server object as `detail`.
- Create the default-hidden and authenticated reveal rules in `templates/base/session.css`, including print suppression and preservation of the HTML `hidden` state.
- Define the stable browser seam used later by comments, editing, realtime, presence, and sharing.
- Run the mandatory browser acceptance workflow under one portable macOS/Linux process-group supervisor with bounded package/browser installation, server, Playwright, interruption, cleanup, and retained manual-remediation evidence.

### Out of scope

- Creating or amending `/api/session`; P1-C creates the Phase 1 function and P3-H later adds document-aware authorization.
- Identity lookup, document-role resolution, access storage, login, logout, the edge gate, or any server authorization check.
- Creating comment, edit, history, realtime, presence, or share controls, panels, notices, loaders, or signed-out messages.
- Calling any endpoint other than `/api/session`, retrying, polling, refreshing on visibility changes, or reacting to a session change after the initial probe. The source oracle permits one direct bare `fetch(...)` call and rejects the enumerated platform request constructors, beacon/socket/event-stream APIs, qualified/computed fetch access, fetch call/apply/bind, destructured/assigned aliases, and `Request`/`Image` construction; the browser oracle separately counts the resulting probe invocation and observable request.
- Persisting a session in `window.doc`, `localStorage`, `sessionStorage`, IndexedDB, the Cache API, a cookie, or another client store.
- Adding `data-user`, `data-role`, a class-based capability signal, another root capability attribute, or another session-related event.
- Editing `templates/docbuild/src/index.ts`, `templates/base/layout.html`, `templates/base/app.js`, `templates/base/components.css`, any server file, or any generated file by hand.
- Adding a runtime dependency, browser bundle, permanent test file, service worker, or offline session cache.

## Interface contract

### P1-B slots and execution order

P1-B owns both integration points:

| P1-B-created slot | P2-C source | Required emitted form |
|---|---|---|
| `{{SESSION_CSS}}` | `slot(base, "session.css")` | Source bytes inside the existing page `<style>` after `components.css` and before all later feature CSS |
| `{{SESSION_JS}}` | `slot(base, "session.js")` | One inline `<script type="module">` with no `async`, emitted as the final feature module and final script |

P2-C must not add a second script or style wrapper and must not edit either P1-B-owned call site.
P1-B's complete feature-module order remains `ANCHOR_CORE_JS`, `EDIT_JS`, `COMMENTS_JS`, `HISTORY_JS`, `REALTIME_JS`, `PRESENCE_JS`, `SHARE_JS`, then `SESSION_JS`.
The final position is a correctness boundary: every downstream module attaches its `session` listener before this module starts the asynchronous probe, and no later classic script can invalidate the in-module tail oracle.
The session module starts the probe synchronously during its parser-ordered module evaluation. Calling the asynchronous probe function must reach timer installation and `fetch()` before control returns to the module tail or a queued microtask can defer startup. It must not register a `DOMContentLoaded`, `load`, `pageshow`, visibility, focus, or online listener; use top-level `await`; dynamically import another module; or use an `async` script attribute. Invoke the asynchronous work without awaiting it at module top level so a header-stalled or body-stalled probe never delays either `DOMContentLoaded` or `load`.

### Document and environment preconditions

At module evaluation, remove any existing `data-session` attribute from `document.documentElement` so loading starts dark.
Then apply these gates in order:

1. If `location.protocol` is neither `http:` nor `https:`, return before constructing a request.
2. Read `document.querySelector('meta[name="doc-id"]')?.getAttribute("content")?.trim()`.
3. If the meta element is absent or the trimmed value is empty, return before constructing a request.
4. If `typeof fetch`, `typeof AbortController`, `typeof CustomEvent`, or `typeof URL` is not exactly `"function"`, return without changing the document again. The executable matrix covers both `undefined` and a truthy frozen object for each global; it does not attempt to defend against a hostile callable that impersonates a platform primitive.

These are feature gates, not error states.
They produce no log, banner, alert, rejection, event, or fallback control.
The explicit protocol guard means a `file://` document makes no network request; it also keeps other non-HTTP embedding schemes dark.

### Session request

Construct the endpoint from the current origin and the permanent id:

```js
const endpoint = new URL("/api/session", location.href);
endpoint.searchParams.set("doc", docId);
```

Make exactly one request per normal document evaluation with this contract:

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

Start one 2000 ms timer immediately before `fetch()`; no endpoint, controller, storage, DOM, scheduling, or other probe operation occurs between the timer installation and the call to `fetch()`.
The timer calls `controller.abort()` and is cleared by one `finally` covering fetch, header validation, body consumption, object validation, freezing, reveal, and dispatch. It is therefore still armed after a `200` header arrives while `response.json()` is waiting for the rest of the body, and is cleared exactly once on every synchronous throw, fetch rejection, header rejection, body rejection, validation rejection, and success path.
The AST gate requires the timer declaration to be the statement immediately before the fetch statement, or immediately before the `try` whose first statement performs that fetch; it also requires that same `try`'s `finally` to contain the sole direct `clearTimeout(timer)` call. Browser lifecycle instrumentation proves the runtime order, and a dedicated wrapper makes `fetch()` throw synchronously after recording the call so cleanup is exercised rather than inferred from a rejected promise.
Do not retry an abort or any other result.
`?doc=` is sent from the first P2-C release: P1-C explicitly ignores unknown query parameters, and P3-H later gives the same parameter document-aware meaning.
The parameter selects a server-side record; it asserts no role or capability.

### Status and body handling

Use the strict guard `if (response.status !== 200) return;` before reading the Content-Type header. The source AST requires exactly that comparison, and the runtime matrix includes a `201 application/json` response with a valid-looking body to prove `response.ok` is not an acceptable substitute.

For a `200`, read `response.headers.get("content-type")` and accept exactly this ASCII-case-insensitive grammar, where `OWS` is zero or more ASCII space or tab bytes:

```text
OWS "application" "/" "json" OWS
[ ";" OWS "charset" "=" ( "utf-8" | DQUOTE "utf-8" DQUOTE ) OWS ]
```

The media type may therefore be `application/json`, any ASCII-case variation of it, or that media type followed by exactly one `charset=utf-8` parameter whose token and value are ASCII-case-insensitive and whose value may use one pair of double quotes. OWS is allowed only at the positions shown: before `application`, after `json`, after the semicolon, and after the charset value; it is not allowed around `/`, inside a token, or on either side of `=`. Implement this check in a pure `isJsonContentType(value)` function so the executable gate can call the parser directly as well as exercise it through `Headers.get()`. The direct matrix enumerates space and tab independently at every allowed outer OWS position, their combined form, and representative forbidden non-SP/HTAB whitespace; the HTTP matrix covers the internal OWS positions, token/value case folds, quoted and unquoted values, and the negative equivalence classes for forbidden internal OWS, missing/unbalanced/single/doubled quotes, backslash escapes, quoted suffix/prefix text, empty/wrong values, missing/extra/duplicate parameters, commas, media-type prefixes/suffixes, and a non-ASCII token lookalike. Fetch normalizes leading and trailing HTTP whitespace before `Headers.get()`, so the HTTP cases at that boundary prove normalization-safe behavior while the direct parser matrix proves the source grammar. These are finite equivalence-class checks, not a claim to enumerate every repeated OWS string or Unicode code point.

Reject a missing header, another media type or suffix, an empty/malformed charset, a charset other than UTF-8, single quotes, escapes or extra text inside the quoted value, any additional parameter, and a duplicate `charset`. Check status and this grammar before reading `response.body` or `response.bodyUsed`, cloning the response, constructing another `Response`, or calling any response/stream body operation. The only permitted body access anywhere in `session.js` is one direct `response.json()` call after a `200` and accepted header. In particular it must not use `text()`, `arrayBuffer()`, `blob()`, `formData()`, `bytes()`, `clone()`, `body`, `bodyUsed`, `getReader()`, `tee()`, `pipeTo()`, `pipeThrough()`, `values()`, synchronous iteration, asynchronous iteration, or `new Response(...)` as an alternate consumption path.

Handle the response without treating a non-success body as JSON:

| Result | Browser action |
|---|---|
| `200` with a Content-Type satisfying the exact grammar above and a valid session object | Apply the reveal state, then dispatch one event |
| `401` with its required empty body | Signed out: read no body, leave `data-session` absent, dispatch no event |
| Any other status, including `204`, `302`, `403`, `404`, `405`, `429`, `500`, and `503` | Read no body, leave the document dark, dispatch no event |
| Redirect | `redirect: "error"` converts it to the silent failure path; do not follow it |
| Missing or non-JSON `Content-Type` on `200` | Read no body, leave the document dark, dispatch no event |
| Invalid JSON or an invalid object on `200` | Catch the failure, leave the document dark, dispatch no event |
| Network, DNS, TLS, CSP, offline, abort, truncated-body, or body-stall failure | Catch the failure, leave the document dark, dispatch no event |

A session body is valid only when it is a non-array JSON object that passes exactly one of the two shapes below. The validator uses own-property presence across the reserved final-field set `doc`, `role`, `shared`, `canSuggest`, `canAccept`, `canShare`, and `canSeeMembers` as the discriminator: zero reserved final fields selects the legacy P1-C shape; one or more selects the final P3-H shape and requires all seven. This makes a partial or mixed response fail dark rather than falling back to legacy semantics.

Both shapes require these common fields:

```js
{
  sub: string,
  email: string,
  name: string,
  roles: string[],
  canComment: boolean,
  canEdit: boolean,
}
```

Every `roles` entry must be a string.
For the legacy shape, all seven reserved final fields must be absent. Its `roles` array may contain any strings allowed by P1-C's temporary response, and other non-reserved extension fields are allowed and retained.

The final P3-H shape requires every field below in addition to the six common fields:

```js
{
  doc: string,
  role: "owner" | "editor" | "commenter" | "viewer" | "none",
  shared: boolean,
  canSuggest: boolean,
  canAccept: boolean,
  canShare: boolean,
  canSeeMembers: boolean,
}
```

`doc` must equal the already-trimmed `docId` used in this request byte-for-byte; a valid-looking response for another document is invalid. `role` must be exactly one of P2-G's five `DocumentRole` strings. In this final shape, `roles` must be exactly the one-element array `["member"]` for an organization identity or `["guest"]` for an external identity; an empty array, both values, duplicates, another value, or another length is invalid. P3-H derives that compatibility array only from P2-H's trusted `isOrg` fact. It is presentation compatibility for legacy consumers, never document authority, and P2-C does not infer a document capability from it. Extra non-reserved extension fields remain allowed and are retained unchanged.

Every final capability named above plus common `canComment` and `canEdit` is a required primitive boolean; no truthy coercion, default, relationship inference, or role-derived repair is allowed. A wrong-type field, missing field, inherited-looking JSON spelling, partial final response, wrong document, or unknown role is invalid.
Do not validate a capability by comparing role names, email suffixes, or other client-visible identity data.

After validation and capability derivation, recursively freeze the parsed JSON object and every nested object or array reachable through its own enumerable JSON properties, deepest children first, without projecting or cloning it. Use an iterative work stack rather than JavaScript call-stack recursion. The traversal includes objects inside arrays and arrays inside objects at every finite depth accepted by the browser's JSON parser; the executable boundary is exactly 256 nested extension objects and is not presented as an unbounded engine-limit proof. JSON cannot contain cycles, symbols, accessors, custom prototypes supplied by the response, or non-enumerable fields, so this traversal is finite and has an exact domain. The event owns no mutation protocol: every listener receives the same deeply frozen parsed object and must treat it as read-only. A listener that needs mutable state makes its own copy; one listener can never change what a later listener observes.

The current P1-C body is:

```json
{
  "sub": "u_demo_931",
  "email": "avery@example.com",
  "name": "Avery Quill",
  "roles": ["member"],
  "canComment": true,
  "canEdit": true
}
```

The later P3-H response retains the six common fields and adds the seven required final fields above. Because P2-H's final server identity intentionally removes `roles`, P3-H owns the compatibility projection: it emits exactly `roles: [user.isOrg ? "member" : "guest"]`. That array is presentation compatibility for this client validator only; neither P2-C nor P3-H uses it for document authorization.
P2-C must pass those fields through unchanged.

### Root reveal state

Derive the coarse reveal capability as follows:

```js
const maySuggest = Object.prototype.hasOwnProperty.call(session, "canSuggest")
  ? session.canSuggest
  : session.canEdit;

document.documentElement.dataset.session = maySuggest ? "editor" : "reader";
```

The fallback preserves P1-C's temporary meaning of `canEdit` as "may propose an edit".
Once P3-H supplies `canSuggest`, that field is authoritative and `canEdit` means direct editing only.
The root has exactly two authenticated values:

| Root state | Meaning | CSS result |
|---|---|---|
| no `data-session` | Loading, signed out, or degraded | Both capability groups stay hidden |
| `data-session="reader"` | Valid session without suggestion capability | Reader controls reveal; editor controls stay hidden |
| `data-session="editor"` | Valid session with suggestion capability | Reader and editor controls reveal |

The words `reader` and `editor` are presentation tiers, not document roles.
In particular, a future document role of `commenter` maps to `data-session="editor"` because it can suggest, while finer decisions continue to come from the event payload.
Do not add `data-session="loading"`, `data-session="signed-out"`, or `data-session="error"`.

### The one browser event

After freezing the object and setting `data-session`, synchronously dispatch in the same JavaScript turn, before any microtask checkpoint or observer callback can run:

```js
document.dispatchEvent(new CustomEvent("session", { detail: session }));
```

The target is `document`; the exact event name is lowercase `session`; and `detail` is the same deeply frozen parsed object, not a projection, clone, or client-normalized replacement.
Default `CustomEvent` flags apply: it does not bubble, is not cancelable, and is not composed.
Dispatch at most once per page evaluation and only for a valid `200` response. The attribute mutation must already be observable inside the listener, and a `MutationObserver.takeRecords()` call made by that listener must still see the pending `data-session` record; this is the executable same-turn oracle.
Do not dispatch signed-out, loading, timeout, failure, refresh, or replay events.
Do not cache the object on `window`, `window.doc`, an element, or storage for listeners that attach late.

Downstream listeners must attach during their own module evaluation and before P1-B's final `SESSION_JS` slot.
The event's stable consumers are:

| Downstream ticket | Contract consumed |
|---|---|
| P3-C, then P4-A and P4-Q | One authenticated payload for read-only comments and later comment/suggestion behavior |
| P3-F | The sole start signal for the realtime transport; it must not call `/api/session` again |
| P3-G | Session-derived identity passed through the realtime/presence stack; presence is still decoration |
| P3-I, then P4-L | `shared`, `canShare`, and `canSeeMembers` from P3-H to decide whether to create share UI |
| P4-B, P4-I, and P4-P | Coarse CSS reveal plus exact capability fields for edit and suggestion affordances |

These rows are downstream interface obligations, not P2-C completion gates. Their owning tickets must attach before `SESSION_JS`, consume this event without issuing a second session probe, and independently prove every server-side write denial. P2-C is complete when it publishes the documented one-shot seam; it does not create those consumers or their write tests.

### CSS selectors and DOM attributes

`templates/base/session.css` must contain these behavior rules:

```css
[data-reader-only],
[data-editor-only] { display: none; }

:root[data-session="reader"] [data-reader-only]:not([hidden]),
:root[data-session="editor"] [data-reader-only]:not([hidden]),
:root[data-session="editor"] [data-editor-only]:not([hidden]) { display: revert; }

@media print {
  [data-reader-only],
  [data-editor-only] { display: none !important; }
}
```

`data-reader-only` means "available to any authenticated reader", so it also reveals for `data-session="editor"`.
`data-editor-only` means "available only when the session can suggest"; it does not by itself authorize commenting, direct editing, acceptance, or sharing.
An element may retain `hidden` for its own feature state; the reveal selectors must not override that semantic state.
Downstream modules must use the event detail for capabilities finer than these two presentation tiers and must use `hidden` when a revealed control later becomes unavailable.
Elements without either marker are unaffected.

These three blocks are the complete `session.css` rule surface; no later rule in that file may contradict them. The guarantee is intentionally limited to the CSS cascade domain they define: the hide/reveal declarations are author-origin declarations, `revert` rolls the matched element's `display` back to the preceding cascade origin, and it does not promise to recover an arbitrary earlier author-origin `display` value. A downstream component must not add a higher-specificity or later author rule that contradicts these generic markers. The browser oracle uses ordinary buttons and a section element with no contradictory author `display`; it separately proves an unrelated element is unaffected. An element carrying both reveal markers is unsupported authoring because the reader selector would win in the reader tier; downstream markup must choose exactly one generic marker.

### Loading, signed-out, authenticated, and degraded behavior

- **Loading:** the root attribute is absent, marked controls are `display: none`, no spinner or live region is created, and the document remains usable.
- **Signed out:** a 401 produces the same visible state as loading, with no event and no sign-in chrome added by this ticket.
- **Authenticated reader:** reader-marked controls reveal and one event carries the exact session body.
- **Authenticated suggester:** reader- and editor-marked controls reveal and one event carries the exact session body.
- **Degraded:** missing metadata, unsupported browser primitives, a plain static host, cache miss while offline, CSP rejection, timeout, malformed success, API error, or non-HTTP embedding all keep the static document unchanged.
- **Print:** both marked groups are hidden even if an authenticated root attribute is present.

### Accessibility contract

Default `display: none` keeps unavailable controls out of layout, sequential keyboard focus, and the accessibility tree.
The probe creates no focus target, moves no focus, changes no accessible name, and emits no status announcement.
Revealed elements retain their authored element type, label, keyboard behavior, and ARIA; the downstream feature owner is responsible for those semantics.
The `:not([hidden])` guard preserves a downstream feature's semantic `hidden` state after authentication.
A failed or slow probe must never block reading, navigation, the theme toggle, deep links, or native section disclosure.
The browser gate exercises a fixture-owned focus target and theme attribute, a real generated-document deep link, and native `<details>` disclosure. It does not claim to discover every possible accessible-name mutation; the separate source gate rejects the enumerated DOM creation, focus, text, ARIA live-region, alert-role, and root-signal operations available to these two files.

The executable browser acceptance gate is Chromium as installed by Playwright `1.55.0`. Passing that gate proves Chromium behavior only; it does not prove cross-engine interoperability. A separate AST assertion rejects the enumerated alternate request, scheduling, persistence, vendor-global, and qualified/computed-fetch syntax; it is not a universal proof that no future or obfuscated nonstandard API spelling exists. Firefox and WebKit execution remain downstream integration work and must not be claimed by P2-C.

### Cache, offline, privacy, and authority boundaries

The request's `cache: "no-store"` and P1-C's `Cache-Control: private, no-store` response contract are both required.
Do not fall back to an HTTP cache, service-worker cache, previously dispatched object, browser storage, or stale root value.
A new navigation performs a new probe; this ticket adds no background refresh within one document lifetime.
Never log or persist the response, and never copy the email or role to a DOM attribute. The client-side no-store/no-extra-signal oracle enumerates: no `localStorage`, `sessionStorage`, IndexedDB, Cache API, cookie write, service worker, `window.name`, history-state, URL-fragment/query assignment, global assignment, session-named own property on `document` or the root element, class-based signal, alternate root attribute, alternate event, or second network request is created by `session.js`. AST checks reject the named source surfaces, `Object.defineProperty`/`defineProperties`, root `classList` mutation, and direct global-member assignment; an in-module before/tail/settled surface snapshot separately compares all root attributes, storage entries, cookies, URL/history state, `window.name`, and non-fixture own keys on `window`, `document`, and the root. This is the closed observable list used for acceptance, not a claim to detect behavior hidden behind dynamic code generation, a browser extension, or hostile code outside the two owned files. Dynamic code generation is itself rejected by the AST gate. The only permitted durable-in-document presentation signal is `data-session`; the only payload publication is the one synchronous event.

`data-session`, the reveal selectors, and the `session` event are not security controls.
A reader can alter the attribute, dispatch a forged event, or create a marked button in developer tools.
Every downstream mutation must still call its server endpoint, and that endpoint must identify the caller and resolve the required document capability independently.

## Files owned

- `templates/base/session.js` — **new**, created by P2-C and consumed by P1-B's pre-created `{{SESSION_JS}}` slot.
- `templates/base/session.css` — **new**, created by P2-C and consumed by P1-B's pre-created `{{SESSION_CSS}}` slot.

These are P2-C's complete and exclusive implementation source surface.
`docs/tickets/P2-C.md` is this specification, not an implementation path.
P1-B owns `templates/docbuild/src/index.ts` and `templates/base/layout.html`; P2-C consumes their stable slots and does not amend them.
P1-C owns `netlify/functions/session.mjs`; P3-H later amends that server file without amending either P2-C file.

Built `dist/*.html`, compiled builder output, and site output are shared generated products, not additional P2-C source ownership.
They may change when the repository's normal build integrates the new optional assets, but they must be regenerated by the owning build commands and never hand-edited.

## Dependencies

- **P1-B:** provides optional `SESSION_JS` and `SESSION_CSS` substitutions, the inline-module load order with session last, and the permanent doc-id meta slot populated from P1-A's metadata.
- **P1-C:** provides `GET /api/session`, the initial six-field response, 200/401 behavior, JSON content type, and `Cache-Control: private, no-store`.

P1-A is not a new direct dependency: P1-B's integration order already consumes its permanent id before P2-C can start.
P3-H is a downstream amendment, not a prerequisite; it gives the already-sent `?doc=` parameter meaning and adds document role/capability fields.

After each listed ticket's own predecessors are integrated and green, P2-C's two new source files can be authored in parallel with phase-2 tickets whose source surfaces are disjoint, including P2-A, P2-B, P2-D, P2-E, P2-F, P2-G, and P2-H. In particular, P2-G does not begin from a partial P2-B branch; it joins the source wave only after P2-B's complete contract and acceptance gate are integrated and green.
Runtime integration is not parallel in the same way: before merge, rebase onto the current integrated P1-B/P1-C state, regenerate shared document and site products once, then run the full gates.
Do not hand-resolve or copy generated HTML from another branch.

### External verification prerequisites

The disposable browser gate requires macOS or Linux with Node 22.12 or later on the Node 22 line, npm, Bash 3.2 or later, Git, `rg`, `install`, `find`, `ps`, `seq`, and `tr`, loopback TCP binding, outbound HTTPS access to the npm registry and Playwright Chromium download, and the native libraries required by Playwright Chromium `1.55.0`. Its embedded Node supervisor supplies the portable POSIX process-group deadline, so GNU `timeout`, `gtimeout`, and `setsid` are not prerequisites. P1-B and P1-C must already be integrated. P2-C freezes its repository integration inventory to the two instances rebuilt here and by `templates/check-dist`: `example` and `templates/components`; adding another real-document build target requires deliberately amending this inventory rather than silently extending the claim. Failure to download Chromium, bind loopback, resolve the package registry, establish TLS to those external package hosts, or provide an installed browser dependency is an external-prerequisite failure, not evidence that the session probe passed or failed. The loopback fixture itself performs no live third-party identity, DNS-failure, or TLS-failure call; named DNS/TLS cases use deterministic Playwright route-abort surrogates and prove only that the resulting fetch rejection is contained.

## Acceptance criteria

- [ ] GitHub issue #8 retains the exact title `P2-C — The session probe and the reveal rules`; its body is exactly the two-paragraph canonical-document pointer from `docs/prompts/rewrite-tickets.md`, and the parsed full commit SHA and `docs/tickets/P2-C.md` path resolve through `git show` to bytes identical to this local canonical document.
- [ ] The implementation creates exactly `templates/base/session.js` and `templates/base/session.css` as P2-C source changes and edits no other implementation source.
- [ ] Both documents in P2-C's frozen integration inventory embed `session.css` in the existing CSS order and `session.js` exactly once as the final script and final non-async feature module; P2-C does not edit the slots, defer startup to a task or microtask, wait for a lifecycle event, or use top-level `await`.
- [ ] `file://`, `data:`, and every other non-HTTP(S) scheme return before timer installation or request construction and produce no page error.
- [ ] Missing, empty, or whitespace-only `<meta name="doc-id">` content returns before timer installation or request construction.
- [ ] One normal HTTP(S) evaluation installs exactly one 2000 ms abort timer in the AST-verified adjacent statement position, then sends exactly one same-origin `GET /api/session?doc=<encoded permanent id>` request with JSON acceptance, same-origin credentials, no-store cache mode, redirect rejection, and its abort signal; every enumerated response/failure path clears that timer exactly once through the encompassing `finally`, including synchronous fetch throw, controlled body stall, and truncated-body failures.
- [ ] A valid P1-C body falls back from absent `canSuggest` to `canEdit`; true maps to `data-session="editor"` and false maps to `data-session="reader"`.
- [ ] The validator distinguishes legacy from final deterministically: none of the seven reserved final fields means legacy, while any one means final and requires all seven. A final body requires `doc === docId`, one exact P2-G role, booleans for `shared`, `canComment`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers`, and compatibility `roles` equal to exactly `["member"]` or `["guest"]`, never `[]`; every partial, mixed, missing, wrong-type, wrong-document, unknown-role, or malformed-roles final body fails dark.
- [ ] A valid P3-H body uses `canSuggest` as authoritative even though `canEdit` now has a narrower meaning. The `roles` compatibility value is presentation-only and neither validates nor derives any document capability.
- [ ] On authenticated success, the root attribute is set before exactly one lowercase `session` event is dispatched from and targeted at `document`, with `bubbles`, `cancelable`, and `composed` all `false`.
- [ ] Event `detail` is the same recursively frozen parsed object with every field unchanged, including future P3-H fields and nested object/array/object descendants; sequential listeners cannot mutate what later listeners observe, the finite browser fixture reaches exactly 256 extension objects, and no copy is stored elsewhere.
- [ ] Only a strict status `200` reaches header parsing; a `201 application/json` response is rejected before body access. A `200` is parsed only when `isJsonContentType` accepts the exact ASCII-case, enumerated OWS-position, optional UTF-8 charset, quote/escape, and single-parameter grammar; the direct parser matrix covers normalized outer OWS and representative forbidden Unicode/ASCII whitespace while the HTTP matrix covers observable header behavior.
- [ ] A 401 and every other pre-parse failure access none of `body`, `bodyUsed`, response cloning, response construction, response body-consumption methods, stream readers/pipes/tees/iteration, or equivalent aliases and produce no root attribute or event.
- [ ] Redirects, the enumerated non-200 statuses, wrong content types, malformed JSON, malformed legacy/final shapes, missing and truthy-wrong required primitives, CSP rejection, offline/fetch/DNS/TLS-surrogate rejection, truncated response bodies, the controlled body stall, and timeout produce no script console call, page error, or unhandled rejection and leave the document dark. Platform-generated Chromium network diagnostics are outside the no-console-call claim.
- [ ] There is no retry, polling loop, visibility refresh, alternate request API or fetch alias, alternate event, error UI, client store, extra DOM/global capability signal, or stale-session fallback; each enumerated delayed and failure path observes zero or exactly one `/api/session` request as specified.
- [ ] `[data-reader-only]` and `[data-editor-only]` are hidden before success; reader-only elements reveal for both authenticated tiers; editor-only elements reveal only for the editor tier.
- [ ] An element carrying `hidden` remains hidden after authentication, and both capability groups are hidden in print.
- [ ] Hidden controls cannot be programmatically or sequentially focused and are absent from Chromium's accessibility tree; revealed reader/editor controls enter the expected tab order and tree. The source gate separately rejects the enumerated focus, text, live-region, alert-role, and DOM-construction operations by which these two files could create loading/error UI.
- [ ] The Chromium acceptance fixture proves those finite Chromium keyboard/AX results and preserves a focused fixture, a fixture-owned theme attribute, a real generated-document deep link, and native disclosure on both authenticated success and silent failure. Source inspection separately rejects the enumerated nonstandard/vendor surfaces; neither oracle is a universal accessibility or standards proof, and cross-engine behavior is not claimed.
- [ ] P2-C documents that forged client hints carry no authority and hands downstream tickets one immutable event seam; downstream consumer creation, second-probe rejection, and server-side 403 write proofs remain completion gates of those owning tickets rather than this one.
- [ ] Shared generated products are regenerated only after rebasing onto the current integration base, and all repository gates pass.
- [ ] The complete browser gate, including npm/Chromium installation, fixture-server lifetime, and Playwright, runs below one retained launcher anchor in a fresh detached POSIX process group with a 1200-second outer deadline. The launcher installs HUP/INT/TERM handling and announces anchor readiness before the supervisor records its positive PID=PGID; it cannot spawn the browser worker until the supervisor persists mode-`0600` running ownership and sends the private IPC `go`. During containment the still-unreaped direct-child anchor remains the positively owned group leader for TERM-to-KILL; no numeric PGID is signaled after it exits. The supervisor reaps the anchor and proves group disappearance before bounded root deletion.
- [ ] First observed external HUP/INT/TERM is authoritative as 129/130/143 after the main worker result, during bounded root removal (including deletion timeout/failure), and in the final-success window. Recursive deletion runs in a positively owned direct child with a ten-second deadline, KILL and bounded reaping; failure retains the validated root and mode-`0600` actionable preparing/running/contained evidence at the exact printed root/evidence/supervisor-PID/leader-PGID locator. Failure to replace evidence is itself terminal and retains the last valid record.
- [ ] Deterministic supervisor self-tests deliver real external HUP/INT/TERM to an owning process before and during root initialization and after the worker result in removal/final-success windows; they also prove deadline termination of a TERM-resistant descendant, TERM observation, natural HUP/INT/TERM/KILL statuses 129/130/143/137, first-signal precedence, bounded deletion timeout, evidence-persistence failure, operational-exception cleanup, parent-exit descendant cleanup, positive anchor ownership, leader reaping, group disappearance, retained remediation, and zero delayed residue before npm/network work begins.

## Test plan

Run the base-recording preflight below before P2-C authoring, then run every numbered command from the repository root after P1-B and P1-C are integrated.
All identities, names, addresses, document ids, and hostnames below are invented public fixtures.

The negative browser inventory is closed and named so “every negative case” means these observable equivalence classes:

| Category | Enumerated cases |
|---|---|
| Early environment gates | `file:`, `data:`, `blob:`, `about:`, missing/empty/whitespace doc id, and unavailable `fetch`, `AbortController`, `CustomEvent`, or `URL` |
| Pre-parse HTTP outcomes | `201` with otherwise valid JSON, `401`, `204`, redirect rejection, `403`, `404`, `405`, `429`, `500`, `503`, missing Content-Type, and `text/html` |
| Content-Type grammar rejection | JSON prefix/suffix, OWS on either side of `/` or `=`, whitespace inside a token, extra/duplicate/missing/wrong parameter, comma list, wrong/empty charset, empty quoted charset, single/unbalanced/doubled quote, quoted prefix/suffix, quoted backslash/escaped quote, and non-ASCII lookalike |
| JSON/session-shape rejection | malformed/truncated JSON; null, array, string, number, or boolean root; each missing or wrongly typed legacy common field; non-array roles; non-string legacy role entry; a legacy body mixed with one reserved final field; each missing or wrongly typed common/final field in an otherwise final body; wrong-document `doc`; unknown/wrong-type `role`; and final `roles` that are empty, both compatibility values, duplicated, unknown, or otherwise not exactly `["member"]` or `["guest"]` |
| Transport/timing rejection | synchronous fetch throw, asynchronous fetch rejection, offline route abort, deterministic DNS/TLS route-abort surrogates, CSP block, headers delayed beyond two seconds, accepted headers with a stalled body, and a connection destroyed after a partial body |

Cases outside this inventory still follow the fail-dark catch path, but P2-C makes no false claim that a finite fixture exhausts every browser, proxy, operating-system, or network failure representation.

Before editing any file on the isolated P2-C branch, record and export the exact integrated commit in the shell that will run the ownership proof:

```bash
P2C_BASE="$(git rev-parse --verify HEAD^{commit})" || exit 1
export P2C_BASE || exit 1
git merge-base --is-ancestor "$P2C_BASE" HEAD || exit 1
for path in templates/base/session.js templates/base/session.css; do
  if git cat-file -e "$P2C_BASE:$path" 2>/dev/null; then
    printf 'FAIL  P2-C source already exists at base: %s\n' "$path" >&2
    exit 1
  fi
done
printf 'PASS  P2-C base recorded: %s\n' "$P2C_BASE" || exit 1
```

Expected: all commands exit `0`; neither owned source exists in the recorded tree, and the last line contains the full 40-character commit id that was `HEAD` before P2-C authoring began. Keep `P2C_BASE` exported in this shell through step 5. If it was not recorded before the first edit, stop and recreate the isolated branch from the known integrated P1-B/P1-C commit rather than guessing from a moving branch name or reflog.

1. Check the source surface and integration slots:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   test -f templates/base/session.js
   test -f templates/base/session.css
   rg -q '\{\{SESSION_CSS\}\}' templates/base/layout.html
   rg -q '\{\{SESSION_JS\}\}' templates/base/layout.html
   test "$(rg -l '/api/session' templates/base --glob '*.js')" = "templates/base/session.js"
   git diff --check -- templates/base/session.js templates/base/session.css docs/tickets/P2-C.md
   echo 'PASS  P2-C source and slots'
   BASH
   ```

   Expected: exit `0` and exactly `PASS  P2-C source and slots` after the quiet assertions.

2. Typecheck and build both documents in P2-C's frozen integration inventory, then prove their generated order and single embedding:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   npm --prefix templates/docbuild run check
   templates/build example
   templates/build templates/components
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";

   const source = readFileSync("templates/base/session.js", "utf8").trim();
   const css = readFileSync("templates/base/session.css", "utf8").trim();
   const componentsCss = readFileSync("templates/base/components.css", "utf8").trim();
   const layout = readFileSync("templates/base/layout.html", "utf8");
   const documents = [
     "example/dist/example.html",
     "templates/components/dist/components.html",
   ];
   const built = documents.map((path) => [path, readFileSync(path, "utf8")]);
   for (const [path, html] of built) {
     const sessionAt = html.indexOf(source);
     assert.ok(sessionAt >= 0, `${path}: session.js was not embedded`);
     assert.equal(html.indexOf(source, sessionAt + source.length), -1, `${path}: session.js was embedded twice`);
     const openAt = html.lastIndexOf('<script type="module">', sessionAt);
     const closeAt = html.indexOf("</script>", sessionAt);
     assert.ok(openAt >= 0 && closeAt > sessionAt, `${path}: session.js wrapper is malformed`);
     assert.doesNotMatch(html.slice(openAt, sessionAt), /\basync\b/, `${path}: session module is async`);
     assert.doesNotMatch(
       html.slice(closeAt + "</script>".length),
       /<script\b/i,
       `${path}: a classic or module script appears after session.js`,
     );
     const cssAt = html.indexOf(css);
     const componentsAt = html.indexOf(componentsCss);
     assert.ok(cssAt >= 0, `${path}: session.css was not embedded`);
     assert.ok(componentsAt >= 0 && componentsAt < cssAt, `${path}: session.css must follow components.css`);
     const docMeta = html.match(/<meta name="doc-id" content="[0-9a-f]{6}">/g) ?? [];
     assert.equal(docMeta.length, 1, `${path}: expected one permanent doc-id meta element`);
     assert.ok(html.includes(`${docMeta[0]}\n<title>`), `${path}: doc-id must immediately precede title`);
   }
   const cssSlots = [...layout.matchAll(/\{\{([A-Z][A-Z0-9_]*_CSS)\}\}/g)].map((match) => match[1]);
   assert.equal(cssSlots.filter((name) => name === "COMPONENTS_CSS").length, 1);
   assert.equal(cssSlots.filter((name) => name === "SESSION_CSS").length, 1);
   const sessionCssSlot = cssSlots.indexOf("SESSION_CSS");
   assert.ok(cssSlots.indexOf("COMPONENTS_CSS") < sessionCssSlot);
   for (const [index, name] of cssSlots.entries()) {
     if (["THEME_CSS", "COMPONENTS_CSS", "SESSION_CSS"].includes(name)) continue;
     assert.ok(index > sessionCssSlot, `${name} must remain after SESSION_CSS`);
   }
   const normalizedCss = css
     .replace(/\/\*[\s\S]*?\*\//g, "")
     .replace(/\s+/g, " ")
     .replace(/\s*([{},:;])\s*/g, "$1")
     .trim();
   assert.equal(normalizedCss,
     '[data-reader-only],[data-editor-only]{display:none;}:root[data-session="reader"] [data-reader-only]:not([hidden]),:root[data-session="editor"] [data-reader-only]:not([hidden]),:root[data-session="editor"] [data-editor-only]:not([hidden]){display:revert;}@media print{[data-reader-only],[data-editor-only]{display:none!important;}}',
     "session.css must contain only the three non-contradictory reveal blocks");
   assert.doesNotMatch(source,
     /\b(?:localStorage|sessionStorage|Storage|indexedDB|IDBFactory|IDBDatabase|caches|Cache|CacheStorage|BroadcastChannel|serviceWorker)\b|document\s*\.\s*cookie|\bwindow\s*\.\s*name\b|\bhistory\s*\.\s*(?:pushState|replaceState)\b|\blocation\s*\.\s*(?:hash|search|href)\s*=|\bconsole\s*\.|(?:window|globalThis)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=/,
     "session.js must not log or use a client persistence surface");
   assert.doesNotMatch(source, /^\s*import\b|\bimport\s*\(/m,
     "session.js must not add a dependency or dynamic import");
   assert.doesNotMatch(source,
     /\b(?:addEventListener|setInterval|requestIdleCallback|requestAnimationFrame|queueMicrotask|MessageChannel)\s*\(|\bscheduler\s*\.|\b(?:ondomcontentloaded|onreadystatechange|onload|onvisibilitychange|onpageshow|onfocus|ononline)\b/i,
     "session.js must not wait for lifecycle events, poll, or refresh");
   assert.equal((source.match(/\bfetch\s*\(/g) ?? []).length, 1,
     "session.js must have one fetch call site");
   assert.doesNotMatch(source,
     /\b(?:XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection|sendBeacon|importScripts)\b|(?:window|globalThis|self|frames|parent|top|navigator)\s*(?:\.\s*fetch|\[\s*["']fetch["']\s*\])|\bfetch\s*\.\s*(?:call|apply|bind)\b|\bReflect\s*\.\s*apply\s*\(\s*fetch\b|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*fetch\b|\{\s*fetch\s*(?::|,|\})|\bnew\s+(?:Request|Image)\b/,
     "session.js must not use another network API or fetch alias");
   assert.equal((source.match(/\bsetTimeout\s*\(/g) ?? []).length, 1,
     "session.js must have only the abort-timer call site");
   assert.doesNotMatch(source,
     /\b(?:createElement|appendChild|insertBefore|prepend|insertAdjacentHTML|replaceChildren|alert|confirm|prompt)\s*\(|\.(?:append|before|after|focus)\s*\(|\.(?:innerHTML|outerHTML|textContent)\s*=|setAttribute\s*\(\s*["'](?:role|aria-[\w-]+|hidden|class)["']|aria-live|role=["']alert/,
     "session.js must not create error or loading UI");
   const customEventNames = [...source.matchAll(/new\s+CustomEvent\s*\(\s*["']([^"']+)["']/g)]
     .map((match) => match[1]);
   assert.deepEqual(customEventNames, ["session"], "session.js must create only the one session event");
   assert.equal((source.match(/\.dispatchEvent\s*\(/g) ?? []).length, 1,
     "session.js must have one event-dispatch site");
   assert.doesNotMatch(source,
     /\bnew\s+Event\b|\.dispatchEvent\s*\.\s*(?:call|apply|bind)\b|\bEventTarget\s*\.\s*prototype\s*\.\s*dispatchEvent\b/,
     "session.js must not create or dispatch an alternate event through an alias");
   assert.doesNotMatch(source,
     /\.\s*(?:body|bodyUsed)\b|\.\s*(?:text|arrayBuffer|blob|formData|bytes|clone|tee|pipeTo|pipeThrough|getReader)\s*\(|\bfor\s+await\b|Symbol\s*\.\s*(?:asyncIterator|iterator)|\bnew\s+Response\b/,
     "session.js must use only response.json after header validation");
   assert.equal((source.match(/\.\s*json\s*\(/g) ?? []).length, 1,
     "session.js must have exactly one JSON body-consumption call site");
   assert.match(source, /\bresponse\s*\.\s*status\s*!==\s*200\b/,
     "session.js must strictly reject every status other than 200");
   assert.match(source, /\bfunction\s+isJsonContentType\s*\(/,
     "session.js must expose the pure parser to the in-module fixture tail");
   assert.match(source, /\bfinally\s*\{/, "timer cleanup must be in finally");
   console.log("PASS  P2-C assets are embedded once in final position in both frozen documents");
   NODE
   BASH
   ```

   Expected: typecheck and both builds exit `0`; each builder reports balanced tags; the probe prints exactly `PASS  P2-C assets are embedded once in final position in both frozen documents`.

3. Run the source-AST and browser contract in an isolated fixture.
   The block installs HUP/INT/TERM ownership before it creates the guarded root, then uses real external signals to owning probe processes before/during initialization and after a worker result in root-removal/final-success windows. Before any npm/network work it also runs deadline, TERM observation, natural-child-signal, bounded deletion/evidence-failure, operational-exception, and parent-exit process-supervisor regressions. It then copies only the generated example, installs pinned test-only Acorn, Playwright, and Chromium under the disposable directory, starts a loopback server on an ephemeral port, exercises every named browser state, and removes the browser, package install, logs, and fixture files only after process-group cleanup is proven. The one retained Node launcher anchor owns the complete nested Bash workflow and every ordinary npm, Chromium, server, and Playwright descendant in its dedicated detached POSIX group. The launcher reports readiness but cannot spawn the worker until the outer owner records its positive PID=PGID and sends a private IPC `go`. Its total deadline is 1200 seconds; HUP, INT, TERM, deadline, nested failure, operational exception, and normal completion all use TERM, a five-second grace for the real workflow, KILL, bounded anchor reaping, and group-disappearance proof without signaling a PGID after anchor exit. The first observed parent terminal signal sets the pending exit code immediately, overrides any already-selected command/deletion result after containment, remains live during the separately bounded recursive-deletion worker, and is checked again immediately before final exit.

   ```bash
   bash <<'BASH'
   set -euo pipefail

   node --input-type=module --eval '
     import assert from "node:assert/strict";
     import { spawn } from "node:child_process";
     import {
       chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync,
       rmdirSync, statSync, unlinkSync, writeFileSync,
     } from "node:fs";
     import { join } from "node:path";

     if (!["darwin", "linux"].includes(process.platform)) {
       throw new Error("P2-C browser supervision requires macOS or Linux");
     }
     const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
     const childSignalStatuses = Object.freeze({
       SIGHUP: 129,
       SIGINT: 130,
       SIGTERM: 143,
       SIGKILL: 137,
     });
     let root = "";
     let evidencePath = "";
     let unresolvedGroup = null;

     function createSignalLatch() {
       let observed = null;
       let resolve;
       const promise = new Promise((done) => { resolve = done; });
       return {
         raise(name, status) {
           if (observed === null) {
             observed = { kind: "signal", name, status };
             resolve(observed);
           }
         },
         get observed() { return observed; },
         promise,
       };
     }
     function installTerminalSignalHandlers(signals, statuses) {
       for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) {
         process.on(name, () => {
           signals.raise(name, statuses[name]);
           process.exitCode = signals.observed.status;
         });
       }
     }
     function authoritativeStatus(signals, fallbackStatus) {
       return signals.observed?.status ?? fallbackStatus;
     }
     const externalSignals = createSignalLatch();
     installTerminalSignalHandlers(externalSignals, childSignalStatuses);
     async function exitAuthoritatively(fallbackStatus) {
       await pause(0);
       process.exit(authoritativeStatus(externalSignals, fallbackStatus));
     }

     const parent = realpathSync(process.env.TMPDIR || "/tmp");
     assert.ok(parent.startsWith("/") && parent !== "/");
     assert.ok(Number.isSafeInteger(process.pid) && process.pid > 1);
     const safeRootPath = (path) => typeof path === "string" && path !== "" &&
       path.slice(0, path.lastIndexOf("/")) === parent && path !== parent &&
       /^p2-c-browser\.[^/]{6}$/.test(path.slice(path.lastIndexOf("/") + 1));

     async function removeGuardedRoot(options = {}) {
       if (root === "") return true;
       if (!safeRootPath(root)) return false;
       const guarded = root;
       const deletionSource = options.syntheticHang === true
         ? "setInterval(() => {}, 1000)"
         : "require(\"node:fs\").rmSync(process.argv[1], { recursive: true, force: true, maxRetries: 2, retryDelay: 25 })";
       const worker = spawn(process.execPath, ["--eval", deletionSource, guarded], {
         stdio: "ignore",
       });
       const workerResult = new Promise((resolve) => {
         worker.once("error", () => resolve({ kind: "error" }));
         worker.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
       });
       const timeoutMs = options.syntheticHang === true ? 100 : 10_000;
       let outcome = await Promise.race([
         workerResult, pause(timeoutMs).then(() => ({ kind: "timeout" })),
       ]);
       if (outcome.kind === "timeout") {
         if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
         outcome = await Promise.race([
           workerResult, pause(2_000).then(() => ({ kind: "unreaped" })),
         ]);
       }
       if (outcome.kind !== "exit" || outcome.code !== 0 || existsSync(guarded)) return false;
       root = "";
       evidencePath = "";
       return true;
     }
     function remove(path) {
       if (path === "") return;
       try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
     }
     function persist(state, supervisorPid, leaderPgid) {
       if (!safeRootPath(root) || evidencePath !== join(root, "browser-supervisor.evidence.json")) {
         throw new Error("P2-C evidence root is not validated");
       }
       const pending = `${evidencePath}.new`;
       writeFileSync(pending, `${JSON.stringify({
         version: 1, state, guardedRoot: root, evidencePath, supervisorPid, leaderPgid,
       })}\n`, { mode: 0o600 });
       renameSync(pending, evidencePath);
     }
     function manual(supervisorPid, leaderPgid) {
       const safeSupervisorPid = Number.isSafeInteger(supervisorPid) && supervisorPid > 1
         ? supervisorPid : "not-applicable";
       const safeLeaderPgid = Number.isSafeInteger(leaderPgid) && leaderPgid > 1
         ? leaderPgid : "not-applicable";
       const safeRoot = safeRootPath(root) ? root : "not-applicable";
       const safeEvidence = safeRootPath(root) &&
         evidencePath === join(root, "browser-supervisor.evidence.json")
         ? evidencePath : "not-applicable";
       try { persist("manual-remediation", safeSupervisorPid, safeLeaderPgid); } catch {}
       if (unresolvedGroup !== null) unresolvedGroup.reported = true;
       console.error(`ERROR  P2-C browser cleanup could not be proven; guarded-root=${safeRoot} evidence-path=${safeEvidence} supervisor-pid=${safeSupervisorPid} leader-pgid=${safeLeaderPgid}; manual remediation required`);
     }
     function initializeGuardedRoot(signals) {
       if (signals.observed !== null) {
         return { created: false, status: signals.observed.status };
       }
       root = mkdtempSync(join(parent, "p2-c-browser."));
       evidencePath = join(root, "browser-supervisor.evidence.json");
       chmodSync(root, 0o700);
       assert.equal(safeRootPath(root), true);
       assert.equal(statSync(root).isDirectory(), true);
       persist("preparing", process.pid, "not-applicable");
       return { created: true, status: 0 };
     }

     const initializationProbeSource = String.raw`
       import { chmodSync, mkdtempSync, rmdirSync } from "node:fs";
       import { join } from "node:path";
       const [signal, phase, parent, expectedText] = process.argv.slice(1);
       const expected = Number(expectedText);
       let observed = 0;
       for (const [name, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
         process.on(name, () => { if (observed === 0) observed = status; });
       }
       process.send({ type: "handlers-ready" });
       await new Promise((resolve) => process.once("message", resolve));
       let probeRoot = "";
       if (phase === "during") {
         process.send({ type: "initializing" });
         probeRoot = mkdtempSync(join(parent, "p2-c-browser-init."));
         chmodSync(probeRoot, 0o700);
         process.send({ type: "root", root: probeRoot });
       }
       await new Promise((resolve) => setTimeout(resolve, 50));
       if (probeRoot !== "") rmdirSync(probeRoot);
       process.exit(observed === expected ? observed : 125);
     `;
     async function runInitializationSignalProbe(signal, expected, phase) {
       let probeRoot = "";
       const owner = spawn(process.execPath,
         ["--input-type=module", "--eval", initializationProbeSource,
           signal, phase, parent, String(expected)], {
           stdio: ["ignore", "ignore", "inherit", "ipc"],
         });
       const outcome = new Promise((resolve) => {
         owner.once("error", () => resolve({ kind: "error" }));
         owner.once("exit", (code, childSignal) => resolve({ kind: "exit", code, childSignal }));
       });
       owner.on("message", (message) => {
         if (message?.type === "handlers-ready") {
           if (phase === "before") {
             owner.kill(signal);
             setTimeout(() => { if (owner.connected) owner.send({ type: "begin" }); }, 25);
           } else {
             owner.send({ type: "begin" });
           }
         }
         if (message?.type === "initializing") owner.kill(signal);
         if (message?.type === "root") probeRoot = message.root;
       });
       let result = await Promise.race([
         outcome, pause(5_000).then(() => ({ kind: "timeout" })),
       ]);
       if (result.kind === "timeout") {
         if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
         result = await Promise.race([
           outcome, pause(2_000).then(() => ({ kind: "unreaped" })),
         ]);
       }
       assert.deepEqual(result, { kind: "exit", code: expected, childSignal: null });
       if (phase === "before") assert.equal(probeRoot, "");
       else assert.equal(existsSync(probeRoot), false);
     }
     for (const [signal, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
       await runInitializationSignalProbe(signal, status, "before");
       await runInitializationSignalProbe(signal, status, "during");
     }
     assert.equal(root, "");
     console.log("PASS  P2-C supervisor handles external early/initializing HUP/INT/TERM");

     await pause(0);
     try {
       const initialized = initializeGuardedRoot(externalSignals);
       if (!initialized.created) {
         await exitAuthoritatively(initialized.status);
       }
     } catch {
       try {
         if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
       } catch { manual(process.pid, "not-applicable"); }
       console.error("ERROR  P2-C guarded-root initialization failed");
       await exitAuthoritatively(125);
     }
     async function stopBeforeMainForExternalSignal() {
       if (externalSignals.observed === null) return;
       if (unresolvedGroup !== null) {
         if (!unresolvedGroup.reported) {
           manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
         }
         await exitAuthoritatively(125);
       }
       try {
         if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
         await exitAuthoritatively(125);
       } catch {
         manual(process.pid, "not-applicable");
         await exitAuthoritatively(125);
       }
     }
     await pause(0);
     await stopBeforeMainForExternalSignal();

     const retainedRoot = root;
     const retainedEvidencePath = evidencePath;
     const retainedUnresolvedGroup = unresolvedGroup;
     const deletionProbeRoot = mkdtempSync(join(parent, "p2-c-browser."));
     root = deletionProbeRoot;
     evidencePath = join(root, "browser-supervisor.evidence.json");
     chmodSync(root, 0o700);
     persist("preparing", process.pid, 4242);
     const preparingEvidence = readFileSync(evidencePath, "utf8");
     mkdirSync(`${evidencePath}.new`);
     unresolvedGroup = { supervisorPid: process.pid, leaderPgid: 4242, reported: false };
     const capturedManualErrors = [];
     const originalConsoleError = console.error;
     let deletionTimedOut;
     try {
       console.error = (...arguments_) => capturedManualErrors.push(arguments_.join(" "));
       deletionTimedOut = !await removeGuardedRoot({ syntheticHang: true });
       manual(process.pid, 4242);
     } finally {
       console.error = originalConsoleError;
     }
     assert.equal(deletionTimedOut, true);
     assert.equal(root, deletionProbeRoot);
     assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
     assert.equal(readFileSync(evidencePath, "utf8"), preparingEvidence,
       "failed evidence replacement must retain the actionable preparing record");
     assert.equal(unresolvedGroup.reported, true);
     assert.deepEqual(capturedManualErrors, [
       `ERROR  P2-C browser cleanup could not be proven; guarded-root=${deletionProbeRoot} evidence-path=${evidencePath} supervisor-pid=${process.pid} leader-pgid=4242; manual remediation required`,
     ]);
     unresolvedGroup = null;
     assert.equal(await removeGuardedRoot(), true);
     assert.equal(existsSync(deletionProbeRoot), false);
     root = retainedRoot;
     evidencePath = retainedEvidencePath;
     unresolvedGroup = retainedUnresolvedGroup;
     const launcherSource = String.raw`
       import { spawn } from "node:child_process";
       const [command, ...args] = process.argv.slice(1);
       if (!command || typeof process.send !== "function") process.exit(127);
       for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {});
       let child = null;
       process.on("message", (message) => {
         if (message?.type !== "go" || child !== null) return;
         child = spawn(command, args, {
           env: process.env,
           stdio: ["ignore", "inherit", "inherit", "inherit"],
         });
         child.once("spawn", () => process.send({ type: "launched" }));
         child.once("error", () => process.send({ type: "result", code: 127, signal: null }));
         child.once("exit", (code, signal) => process.send({ type: "result", code, signal }));
       });
       process.send({ type: "anchor-ready" });
       setInterval(() => {}, 60_000);
     `;

     function groupAlive(pgid) {
       try { process.kill(-pgid, 0); return true; }
       catch (error) {
         if (error?.code === "ESRCH") return false;
         if (error?.code === "EPERM") return true;
         throw error;
       }
     }
     function signalGroup(pgid, signal) {
       assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
       try { process.kill(-pgid, signal); }
       catch (error) { if (error?.code !== "ESRCH") throw error; }
     }
     async function groupGone(pgid, milliseconds) {
       const deadline = Date.now() + milliseconds;
       while (groupAlive(pgid) && Date.now() < deadline) await pause(25);
       return !groupAlive(pgid);
     }
     function detachLeader(leader) {
       try { if (leader?.connected) leader.disconnect(); } catch {}
       try { leader?.removeAllListeners("message"); } catch {}
       try { leader?.unref(); } catch {}
     }
     const mayRecursivelyRemoveGuardedRoot = (record = unresolvedGroup) => record === null;

     async function containGroup(leader, leaderResult, pgid, termGraceMs) {
       if (leader === null) {
         unresolvedGroup = null;
         return { complete: true, reaped: true, disappeared: true };
       }
       const validPgid = Number.isSafeInteger(pgid) && pgid > 1;
       const leaderOwned = () => leader.exitCode === null && leader.signalCode === null;
       if (validPgid && leaderOwned()) {
         try { signalGroup(pgid, "SIGTERM"); } catch {}
         await pause(termGraceMs);
         try { if (leaderOwned()) signalGroup(pgid, "SIGKILL"); } catch {}
       }
       let leaderOutcome = null;
       try {
         leaderOutcome = leaderResult === null ? null
           : await Promise.race([leaderResult, pause(5000).then(() => null)]);
       } catch {}
       const reaped = leaderOutcome !== null;
       let disappeared = !validPgid && leaderOutcome?.kind === "leader-error";
       if (validPgid && reaped) {
         try { disappeared = await groupGone(pgid, 5000); } catch { disappeared = false; }
       }
       const complete = reaped && disappeared;
       if (complete) {
         unresolvedGroup = null;
       } else {
         manual(process.pid, pgid);
         detachLeader(leader);
       }
       return { complete, reaped, disappeared };
     }

     async function supervise(command, args, options = {}) {
       let leader = null;
       let leaderResult = null;
       let pgid = null;
       let cleanupProved = false;
       try {
         leader = spawn(process.execPath,
           ["--input-type=module", "--eval", launcherSource, command, ...args], {
             detached: true,
             env: options.env ?? process.env,
             stdio: ["ignore", "inherit", "inherit", "inherit", "ipc"],
           });
         pgid = leader.pid;
         unresolvedGroup = { supervisorPid: process.pid, leaderPgid: pgid, reported: false };
         leaderResult = new Promise((resolve) => {
           leader.once("error", () => resolve({ kind: "leader-error" }));
           leader.once("exit", (code, signal) => resolve({ kind: "leader-exit", code, signal }));
         });
         if (!Number.isSafeInteger(pgid) || pgid <= 1) {
           const invalidLeaderOutcome = await Promise.race([
             leaderResult, pause(2000).then(() => null),
           ]);
           if (invalidLeaderOutcome?.kind === "leader-error") {
             unresolvedGroup = null;
             return { complete: true, status: authoritativeStatus(externalSignals, 125),
               pgid, outcome: { kind: "launch-failure" } };
           }
           manual(process.pid, pgid);
           detachLeader(leader);
           return { complete: false, status: authoritativeStatus(externalSignals, 125), pgid,
             outcome: { kind: "launch-ownership-unproved" } };
         }
         let launchResolve;
         let anchorResolve;
         let resultResolve;
         const anchorReady = new Promise((resolve) => { anchorResolve = resolve; });
         const launched = new Promise((resolve) => { launchResolve = resolve; });
         const commandResult = new Promise((resolve) => { resultResolve = resolve; });
         leader.on("message", (message) => {
           if (message?.type === "anchor-ready") anchorResolve({ kind: "anchor-ready" });
           if (message?.type === "launched") launchResolve({ kind: "launched" });
           if (message?.type === "result") {
             resultResolve({ kind: "result", code: message.code, signal: message.signal });
           }
         });
         const anchorHandshake = await Promise.race([
           anchorReady,
           commandResult,
           leaderResult,
           pause(5000).then(() => ({ kind: "handshake-timeout" })),
         ]);
         if (anchorHandshake.kind !== "anchor-ready" || !groupAlive(pgid)) {
           const cleanup = await containGroup(leader, leaderResult, pgid, 100);
           return { complete: cleanup.complete,
             status: authoritativeStatus(externalSignals, 125), pgid,
             outcome: { kind: "launch-failure" } };
         }
         if (options.evidence) persist("running", process.pid, pgid);
         leader.send({ type: "go" });
         const launchHandshake = await Promise.race([
           launched,
           commandResult,
           leaderResult,
           pause(5000).then(() => ({ kind: "handshake-timeout" })),
         ]);
         if (launchHandshake.kind !== "launched" || !groupAlive(pgid)) {
           const cleanup = await containGroup(leader, leaderResult, pgid, 100);
           return { complete: cleanup.complete,
             status: authoritativeStatus(externalSignals, 125), pgid,
             outcome: { kind: "launch-failure" } };
         }
         if (options.syntheticOperationalError === true) {
           throw new Error("synthetic P2-C supervisor operational failure");
         }

         const timeout = pause(options.timeoutMs).then(() => ({ kind: "timeout", status: 124 }));
         const synthetic = options.syntheticSignal
           ? pause(options.syntheticSignal.afterMs).then(() => ({
               kind: "signal", name: options.syntheticSignal.name,
               status: options.syntheticSignal.status,
             }))
           : new Promise(() => {});
         const external = options.externalSignals === false
           ? new Promise(() => {}) : externalSignals.promise;
         const outcome = await Promise.race([commandResult, timeout, synthetic, external]);
         const cleanup = await containGroup(
           leader, leaderResult, pgid, options.termGraceMs ?? 500,
         );
         cleanupProved = cleanup.complete;
         if (options.evidence && cleanup.complete) {
           persist("contained", process.pid, pgid);
         }
         const status = outcome.kind === "result"
           ? (outcome.signal === null
               ? outcome.code ?? 1
               : childSignalStatuses[outcome.signal] ?? 1)
           : outcome.status;
         return { complete: cleanup.complete,
           retainRoot: false, status: authoritativeStatus(externalSignals, status), pgid, outcome };
       } catch {
         const cleanup = cleanupProved
           ? { complete: true }
           : await containGroup(leader, leaderResult, pgid, options.termGraceMs ?? 500);
         return { complete: cleanup.complete,
           retainRoot: options.evidence === true,
           status: authoritativeStatus(externalSignals, 125), pgid,
           outcome: { kind: "operational-error" } };
       }
     }

     try {
     const publicationEvidence = readFileSync(evidencePath, "utf8");
     const publicationPending = `${evidencePath}.new`;
     const publicationMarker = join(root, "evidence-publication.marker");
     mkdirSync(publicationPending);
     const publicationRun = await supervise(process.execPath,
       ["--input-type=module", "--eval",
         `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(publicationMarker)}, "escaped");`], {
         timeoutMs: 5000, termGraceMs: 100, externalSignals: false, evidence: true,
       });
     assert.equal(publicationRun.status, 125);
     assert.equal(publicationRun.complete, true);
     assert.equal(publicationRun.retainRoot, true);
     assert.equal(publicationRun.outcome.kind, "operational-error");
     assert.equal(unresolvedGroup, null);
     assert.equal(existsSync(publicationMarker), false,
       "the worker must not start before running ownership is durable");
     assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
     assert.equal(readFileSync(evidencePath, "utf8"), publicationEvidence);
     rmdirSync(publicationPending);
     console.log("PASS  P2-C supervisor bounds deletion and retains evidence on persistence failure");
     await stopBeforeMainForExternalSignal();

     const timeoutRun = await supervise("sh", ["-c",
       "trap \"\" TERM; (trap \"\" TERM; sleep 30) & wait"], {
         timeoutMs: 100, termGraceMs: 100, externalSignals: false,
       });
     assert.equal(timeoutRun.status, 124);
     assert.equal(timeoutRun.complete, true);
     console.log("PASS  P2-C supervisor terminates a timed-out descendant group");
     await stopBeforeMainForExternalSignal();

     const termMarker = join(root, "supervisor-term.marker");
     const signalRun = await supervise(process.execPath, ["--input-type=module", "--eval",
       `import { writeFileSync } from "node:fs"; process.on("SIGTERM", () => writeFileSync(${JSON.stringify(termMarker)}, "TERM")); setInterval(() => {}, 1000);`], {
         timeoutMs: 5000,
         termGraceMs: 250,
         externalSignals: false,
         syntheticSignal: { afterMs: 500, name: "SIGTERM", status: 143 },
       });
     assert.equal(signalRun.status, 143);
     assert.equal(signalRun.complete, true);
     assert.equal(readFileSync(termMarker, "utf8"), "TERM");
     console.log("PASS  P2-C supervisor handles TERM with bounded escalation and reaping");
     await stopBeforeMainForExternalSignal();

     assert.deepEqual(childSignalStatuses,
       { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 });
     for (const [name, status] of Object.entries(childSignalStatuses)) {
       const naturalSignalRun = await supervise(process.execPath,
         ["--input-type=module", "--eval",
           `setTimeout(() => process.kill(process.pid, ${JSON.stringify(name)}), 50); setInterval(() => {}, 1000);`], {
           timeoutMs: 5000, termGraceMs: 0, externalSignals: false,
         });
       assert.equal(naturalSignalRun.status, status, `${name} status`);
       assert.equal(naturalSignalRun.complete, true, `${name} cleanup`);
     }
     console.log("PASS  P2-C supervisor preserves natural child signal statuses");
     await stopBeforeMainForExternalSignal();

     const outerTerminalProbeSource = String.raw`
       import { spawn } from "node:child_process";
       import { chmodSync, mkdtempSync, rmdirSync, writeFileSync } from "node:fs";
       import { join } from "node:path";
       const [firstSignal, phase, parent, expectedText] = process.argv.slice(1);
       const expected = Number(expectedText);
       let observed = 0;
       for (const [name, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
         process.on(name, () => { if (observed === 0) observed = status; });
       }
       const probeRoot = mkdtempSync(join(parent, "p2-c-browser."));
       chmodSync(probeRoot, 0o700);
       process.send({ type: "root", root: probeRoot });
       process.send({ type: "worker-result" });
       if (phase === "deletion-failure") {
         const evidence = join(probeRoot, "browser-supervisor.evidence.json");
         writeFileSync(evidence, JSON.stringify({ state: "deletion-failed", guardedRoot: probeRoot }) + "\n", { mode: 0o600 });
         const worker = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
         const workerExit = new Promise((resolve) => worker.once("exit", resolve));
         process.send({ type: "signal-now" });
         await new Promise((resolve) => setTimeout(resolve, 100));
         if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
         const workerReaped = await Promise.race([
           workerExit.then(() => true),
           new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
         ]);
         if (!workerReaped) process.exit(125);
         process.exit(observed === expected ? observed : 125);
       }
       if (phase === "post-result") {
         process.send({ type: "signal-now" });
         await new Promise((resolve) => setTimeout(resolve, 75));
       }
       if (phase === "removal") {
         const worker = spawn(process.execPath,
           ["--eval", "setTimeout(() => require(\"node:fs\").rmdirSync(process.argv[1]), 100)", probeRoot],
           { stdio: "ignore" });
         const workerExit = new Promise((resolve) => {
           worker.once("error", () => resolve({ code: 125, signal: null }));
           worker.once("exit", (code, signal) => resolve({ code, signal }));
         });
         process.send({ type: "signal-now" });
         const workerOutcome = await Promise.race([
           workerExit,
           new Promise((resolve) => setTimeout(() => resolve({ code: 125, signal: null }), 2000)),
         ]);
         if (workerOutcome.code !== 0 || workerOutcome.signal !== null) process.exit(125);
       }
       if (phase !== "removal") rmdirSync(probeRoot);
       if (phase === "final-success") {
         process.send({ type: "signal-now" });
         await new Promise((resolve) => setTimeout(resolve, 75));
       }
       process.exit(observed === expected ? observed : 125);
     `;
     async function runOuterTerminalProbe(firstSignal, expected, phase) {
       let probeRoot = "";
       let signaled = false;
       const owner = spawn(process.execPath,
         ["--input-type=module", "--eval", outerTerminalProbeSource,
           firstSignal, phase, parent, String(expected)], {
           stdio: ["ignore", "ignore", "inherit", "ipc"],
         });
       const outcome = new Promise((resolve) => {
         owner.once("error", () => resolve({ kind: "error" }));
         owner.once("exit", (code, childSignal) => resolve({ kind: "exit", code, childSignal }));
       });
       owner.on("message", (message) => {
         if (message?.type === "root") probeRoot = message.root;
         if (message?.type === "signal-now" && !signaled) {
           signaled = true;
           owner.kill(firstSignal);
           const secondSignal = firstSignal === "SIGTERM" ? "SIGINT" : "SIGTERM";
           setTimeout(() => {
             if (owner.exitCode === null && owner.signalCode === null) owner.kill(secondSignal);
           }, 20);
         }
       });
       let result = await Promise.race([
         outcome, pause(5_000).then(() => ({ kind: "timeout" })),
       ]);
       if (result.kind === "timeout") {
         if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
         result = await Promise.race([
           outcome, pause(2_000).then(() => ({ kind: "unreaped" })),
         ]);
       }
       assert.equal(signaled, true);
       assert.deepEqual(result, { kind: "exit", code: expected, childSignal: null });
       if (phase === "deletion-failure") {
         const probeEvidence = join(probeRoot, "browser-supervisor.evidence.json");
         assert.equal(statSync(probeEvidence).mode & 0o777, 0o600);
         const savedRoot = root;
         const savedEvidencePath = evidencePath;
         root = probeRoot;
         evidencePath = probeEvidence;
         assert.equal(await removeGuardedRoot(), true);
         root = savedRoot;
         evidencePath = savedEvidencePath;
       }
       assert.equal(existsSync(probeRoot), false);
     }
     for (const [signal, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
       for (const phase of ["post-result", "removal", "deletion-failure", "final-success"]) {
         await runOuterTerminalProbe(signal, status, phase);
       }
     }
     console.log("PASS  P2-C supervisor gives external terminal signals final authority");
     await stopBeforeMainForExternalSignal();

     const operationalRun = await supervise("sh", ["-c",
       "trap \"\" TERM; sleep 30"], {
         timeoutMs: 5000, termGraceMs: 100, externalSignals: false,
         syntheticOperationalError: true,
       });
     assert.equal(operationalRun.status, 125);
     assert.equal(operationalRun.complete, true);
     assert.equal(operationalRun.outcome.kind, "operational-error");
     assert.equal(unresolvedGroup, null);
     assert.equal(mayRecursivelyRemoveGuardedRoot(), true);
     assert.equal(mayRecursivelyRemoveGuardedRoot({ leaderPgid: operationalRun.pgid }), false);
     console.log("PASS  P2-C supervisor contains an operational exception and proves cleanup");
     await stopBeforeMainForExternalSignal();

     const descendantMarker = join(root, "supervisor-descendant.marker");
     const descendantRun = await supervise("sh", ["-c",
       "(sleep 1; printf leak >\"$1\") & exit 0", "p2-c-descendant", descendantMarker], {
         timeoutMs: 5000, termGraceMs: 0, externalSignals: false,
       });
     assert.equal(descendantRun.status, 0);
     assert.equal(descendantRun.complete, true);
     await pause(1200);
     try { readFileSync(descendantMarker); assert.fail("background descendant survived"); }
     catch (error) { assert.equal(error?.code, "ENOENT"); }
     console.log("PASS  P2-C supervisor removes descendants after their parent exits");
     await stopBeforeMainForExternalSignal();

     const main = await supervise("bash", ["/dev/fd/3"], {
       timeoutMs: 1_200_000,
       termGraceMs: 5000,
       evidence: true,
       env: { ...process.env, P2C_TEMP_PARENT: parent, P2C_TEST_ROOT: root },
     });
     if (!main.complete || main.retainRoot) {
       if (unresolvedGroup !== null && !unresolvedGroup.reported) {
         manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
       } else if (main.retainRoot) {
         manual(process.pid, main.pgid);
       }
       await exitAuthoritatively(125);
     }
     assert.equal(statSync(root).isDirectory(), true);
     try {
       if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
     } catch {
       manual(process.pid, main.pgid);
       await exitAuthoritatively(125);
     }
     await exitAuthoritatively(main.status);
     } catch {
       if (!mayRecursivelyRemoveGuardedRoot()) {
         if (!unresolvedGroup.reported) {
           manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
         }
         console.error("ERROR  P2-C process-supervisor self-test or launch failed with cleanup unproved; guarded root retained");
         await exitAuthoritatively(125);
       }
       try {
         if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
       } catch {
         manual(process.pid, "not-applicable");
         await exitAuthoritatively(125);
       }
       console.error("ERROR  P2-C process-supervisor self-test or launch failed");
       await exitAuthoritatively(125);
     }
   ' 3<<'P2C_BROWSER_BODY'
   set -euo pipefail

   P2C_REPO="$PWD"
   P2C_TEMP_PARENT="${P2C_TEMP_PARENT:-}"
   P2C_TEST_ROOT="${P2C_TEST_ROOT:-}"
   P2C_SERVER_PID=''

   if [[ -z "$P2C_TEMP_PARENT" || "$P2C_TEMP_PARENT" != /* || ! -d "$P2C_TEMP_PARENT" \
     || -z "$P2C_TEST_ROOT" || "${P2C_TEST_ROOT%/*}" != "$P2C_TEMP_PARENT" \
     || "$P2C_TEST_ROOT" == "$P2C_TEMP_PARENT" \
     || "${P2C_TEST_ROOT##*/}" != p2-c-browser.?????? || ! -d "$P2C_TEST_ROOT" ]]; then
     echo 'ERROR  P2-C browser root is outside its validated temporary parent' >&2
     exit 1
   fi
   P2C_BROWSER_EVIDENCE="$P2C_TEST_ROOT/browser-supervisor.evidence.json" \
     P2C_BROWSER_ROOT="$P2C_TEST_ROOT" node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync, statSync } from "node:fs";
       const evidence = JSON.parse(readFileSync(process.env.P2C_BROWSER_EVIDENCE, "utf8"));
       assert.equal(statSync(process.env.P2C_BROWSER_EVIDENCE).mode & 0o777, 0o600);
       assert.equal(evidence.version, 1);
       assert.equal(evidence.state, "running");
       assert.equal(evidence.guardedRoot, process.env.P2C_BROWSER_ROOT);
       assert.equal(evidence.evidencePath, process.env.P2C_BROWSER_EVIDENCE);
       assert.ok(Number.isSafeInteger(evidence.supervisorPid) && evidence.supervisorPid > 1);
       assert.ok(Number.isSafeInteger(evidence.leaderPgid) && evidence.leaderPgid > 1);
       process.kill(-evidence.leaderPgid, 0);
     '

   stop_server() {
     local tick state
     [[ -n "${P2C_SERVER_PID:-}" ]] || return 0
     if ! [[ "$P2C_SERVER_PID" =~ ^[0-9]+$ ]] || (( P2C_SERVER_PID <= 1 )); then return 1; fi
     kill -TERM "$P2C_SERVER_PID" 2>/dev/null || true
     for tick in $(seq 1 50); do
       state="$(ps -o stat= -p "$P2C_SERVER_PID" 2>/dev/null | tr -d '[:space:]')"
       if ! kill -0 "$P2C_SERVER_PID" 2>/dev/null || [[ -z "$state" || "$state" == *Z* ]]; then
         wait "$P2C_SERVER_PID" 2>/dev/null || true
         P2C_SERVER_PID=''
         return 0
       fi
       sleep 0.1
     done
     kill -KILL "$P2C_SERVER_PID" 2>/dev/null || true
     for tick in $(seq 1 50); do
       state="$(ps -o stat= -p "$P2C_SERVER_PID" 2>/dev/null | tr -d '[:space:]')"
       if ! kill -0 "$P2C_SERVER_PID" 2>/dev/null || [[ -z "$state" || "$state" == *Z* ]]; then
         wait "$P2C_SERVER_PID" 2>/dev/null || true
         P2C_SERVER_PID=''
         return 0
       fi
       sleep 0.1
     done
     return 1
   }

   cleanup() {
     local status=$?
     trap - EXIT HUP INT TERM
     set +e
     stop_server || status=1
     exit "$status"
   }
   trap cleanup EXIT
   trap 'exit 129' HUP
   trap 'exit 130' INT
   trap 'exit 143' TERM

   cp "$P2C_REPO/example/dist/example.html" "$P2C_TEST_ROOT/document.html"
   install -m 600 /dev/stdin "$P2C_TEST_ROOT/package.json" <<'JSON'
   { "private": true, "type": "module" }
   JSON

   install -m 600 /dev/stdin "$P2C_TEST_ROOT/server.mjs" <<'SERVER'
   import { createServer } from "node:http";
   import { readFileSync, writeFileSync } from "node:fs";

   const rawHtml = readFileSync(process.env.P2C_HTML, "utf8");
   const sessionOpenTag = '<script type="module">';
   const sessionOpen = rawHtml.lastIndexOf(sessionOpenTag);
   if (sessionOpen < 0) throw new Error("fixture has no final session module");
   const sessionSourceAt = sessionOpen + sessionOpenTag.length;
   const sessionClose = rawHtml.indexOf("</script>", sessionSourceAt);
   if (sessionClose < 0) throw new Error("fixture session module is not closed");
   if (/<script\b/i.test(rawHtml.slice(sessionClose + "</script>".length))) {
     throw new Error("fixture has a classic or module script after session.js");
   }
   const modulePrefixOracle = `
     window.__captureSessionSurface = () => {
       const storageEntries = (storage) => Array.from({ length: storage.length }, (_, index) => {
         const key = storage.key(index);
         return [key, key === null ? null : storage.getItem(key)];
       }).sort(([left], [right]) => String(left).localeCompare(String(right)));
       const ownKeys = (value) => Reflect.ownKeys(value)
         .filter((key) => typeof key === "string" && !key.startsWith("__"))
         .sort();
       return {
         rootAttributes: [...document.documentElement.attributes]
           .map((attribute) => attribute.name + "=" + attribute.value)
           .sort(),
         localStorage: storageEntries(localStorage),
         sessionStorage: storageEntries(sessionStorage),
         cookie: document.cookie,
         href: location.href,
         historyState: JSON.stringify(history.state) ?? null,
         windowName: window.name,
         windowKeys: ownKeys(window),
         documentKeys: ownKeys(document),
         rootKeys: ownKeys(document.documentElement),
       };
     };
     window.__sessionSurfaceBaseline = window.__captureSessionSurface();
   `;
   const moduleTailOracle = `
     window.__sessionModuleTailSnapshot = {
       fetchCalls: window.__fetchCalls.length,
       lifecycle: [...window.__probeLifecycle],
       localStorageLength: localStorage.length,
       sessionStorageLength: sessionStorage.length,
       cookie: document.cookie,
       href: location.href,
       rootDataset: { ...document.documentElement.dataset },
       sessionAttribute: document.documentElement.getAttribute("data-session"),
       surface: window.__captureSessionSurface(),
       directContentTypes: [
         ["leading-space", isJsonContentType(" application/json")],
         ["leading-tab", isJsonContentType("\\tapplication/json")],
         ["trailing-space", isJsonContentType("application/json ")],
         ["trailing-tab", isJsonContentType("application/json\\t")],
         ["combined-outer-ows", isJsonContentType("\\t application/json \\t")],
         ["quoted-combined-outer-ows", isJsonContentType(" \\tapplication/json;charset=\\\"utf-8\\\"\\t ")],
         ["leading-nbsp", isJsonContentType("\\u00a0application/json")],
         ["trailing-em-space", isJsonContentType("application/json\\u2003")],
         ["unicode-casefold-lookalike", isJsonContentType("application/j\\u017fon")],
         ["leading-vertical-tab", isJsonContentType("\\vapplication/json")],
         ["trailing-form-feed", isJsonContentType("application/json\\f")],
         ["leading-line-feed", isJsonContentType("\\napplication/json")],
         ["trailing-carriage-return", isJsonContentType("application/json\\r")],
       ],
     };
   `;
   const html = `${rawHtml.slice(0, sessionSourceAt)}${modulePrefixOracle}${rawHtml.slice(sessionSourceAt, sessionClose)}${moduleTailOracle}${rawHtml.slice(sessionClose)}`;
   const docId = html.match(/<meta name="doc-id" content="([0-9a-f]{6})">/)?.[1];
   if (!docId) throw new Error("fixture has no permanent doc id");
   const counts = new Map();
   const json = (value) => JSON.stringify(value);
   const common = {
     sub: "u_demo_931",
     email: "avery@example.com",
     name: "Avery Quill",
     roles: ["member"],
     canComment: true,
   };
   const complete = { ...common, canEdit: true };
   const finalSession = (overrides = {}) => ({
     ...common,
     canEdit: false,
     doc: docId,
     role: "viewer",
     shared: true,
     canSuggest: false,
     canAccept: false,
     canShare: false,
     canSeeMembers: false,
     ...overrides,
   });
   let deepExtension = { level: 255, leaf: true };
   for (let level = 254; level >= 0; level -= 1) {
     deepExtension = { level, next: deepExtension };
   }
   const without = (object, key) => {
     const copy = { ...object };
     delete copy[key];
     return copy;
   };
   const invalidSessions = new Map([
     ["shape-null", null],
     ["shape-array", []],
     ["shape-string", "not a session"],
     ["shape-number", 931],
     ["shape-boolean", true],
     ["shape-missing-sub", without(complete, "sub")],
     ["shape-sub-type", { ...complete, sub: 931 }],
     ["shape-missing-email", without(complete, "email")],
     ["shape-email-type", { ...complete, email: null }],
     ["shape-missing-name", without(complete, "name")],
     ["shape-name-type", { ...complete, name: ["Avery Quill"] }],
     ["shape-missing-roles", without(complete, "roles")],
     ["shape-roles-type", { ...complete, roles: "member" }],
     ["shape-role-entry", { ...complete, roles: ["member", 931] }],
     ["shape-missing-can-comment", without(complete, "canComment")],
     ["shape-can-comment-type", { ...complete, canComment: 1 }],
     ["shape-missing-can-edit", without(complete, "canEdit")],
     ["shape-can-edit-type", { ...complete, canEdit: "yes" }],
     ["final-partial-doc-only", { ...complete, doc: docId }],
     ["final-missing-sub", without(finalSession(), "sub")],
     ["final-sub-type", finalSession({ sub: 931 })],
     ["final-missing-email", without(finalSession(), "email")],
     ["final-email-type", finalSession({ email: null })],
     ["final-missing-name", without(finalSession(), "name")],
     ["final-name-type", finalSession({ name: ["Avery Quill"] })],
     ["final-missing-roles", without(finalSession(), "roles")],
     ["final-roles-type", finalSession({ roles: "member" })],
     ["final-roles-empty", finalSession({ roles: [] })],
     ["final-roles-entry-type", finalSession({ roles: [931] })],
     ["final-roles-both", finalSession({ roles: ["member", "guest"] })],
     ["final-roles-duplicate", finalSession({ roles: ["member", "member"] })],
     ["final-roles-unknown", finalSession({ roles: ["editor"] })],
     ["final-missing-can-comment", without(finalSession(), "canComment")],
     ["final-can-comment-type", finalSession({ canComment: 1 })],
     ["final-missing-can-edit", without(finalSession(), "canEdit")],
     ["final-can-edit-type", finalSession({ canEdit: "yes" })],
     ["final-missing-doc", without(finalSession(), "doc")],
     ["final-doc-type", finalSession({ doc: 931 })],
     ["final-wrong-doc", finalSession({ doc: docId === "ffffff" ? "000000" : "ffffff" })],
     ["final-missing-role", without(finalSession(), "role")],
     ["final-role-type", finalSession({ role: ["viewer"] })],
     ["final-role-unknown", finalSession({ role: "reader" })],
     ["final-missing-shared", without(finalSession(), "shared")],
     ["final-shared-type", finalSession({ shared: 1 })],
     ["final-missing-can-suggest", without(finalSession(), "canSuggest")],
     ["final-can-suggest-type", finalSession({ canSuggest: "yes" })],
     ["final-missing-can-accept", without(finalSession(), "canAccept")],
     ["final-can-accept-type", finalSession({ canAccept: null })],
     ["final-missing-can-share", without(finalSession(), "canShare")],
     ["final-can-share-type", finalSession({ canShare: "false" })],
     ["final-missing-can-see-members", without(finalSession(), "canSeeMembers")],
     ["final-can-see-members-type", finalSession({ canSeeMembers: 0 })],
   ]);

   const insertBeforeSessionModule = (body, source) => {
     const at = body.lastIndexOf('<script type="module">');
     if (at < 0) throw new Error("fixture has no session module");
     return `${body.slice(0, at)}<script>${source}</script>\n${body.slice(at)}`;
   };

   const server = createServer((req, res) => {
     const url = new URL(req.url ?? "/", "http://fixture.invalid");
     if (url.pathname === "/_counts") {
       res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
       res.end(json(Object.fromEntries(counts)));
       return;
     }
     if (url.pathname === "/api/session") {
       const from = new URL(req.headers.referer ?? "http://fixture.invalid/unknown/");
       const scenario = from.pathname.split("/").filter(Boolean)[0] ?? "unknown";
       counts.set(scenario, (counts.get(scenario) ?? 0) + 1);
       const validRequest = req.method === "GET"
         && url.searchParams.get("doc") === docId
         && req.headers.accept === "application/json"
         && /(?:^|;\s*)p2c_fixture=present(?:;|$)/.test(req.headers.cookie ?? "");
       if (!validRequest) {
         res.writeHead(418, { "Cache-Control": "private, no-store" });
         res.end();
         return;
       }
   const acceptedContentTypes = new Map([
     ["type-bare", "application/json"],
     ["type-casefold", "Application/JSON"],
     ["type-leading-space", " application/json"],
     ["type-leading-tab", "\tapplication/json"],
     ["type-trailing-space", "application/json "],
     ["type-trailing-tab", "application/json\t"],
     ["type-before-semicolon-space", "application/json ;charset=utf-8"],
     ["type-before-semicolon-tab", "application/json\t;charset=utf-8"],
     ["type-after-semicolon-space", "application/json; charset=utf-8"],
     ["type-after-semicolon-tab", "application/json;\tcharset=utf-8"],
     ["type-after-value-space", "application/json;charset=utf-8 "],
     ["type-after-value-tab", "application/json;charset=utf-8\t"],
     ["type-all-ows", "\t application/json \t; \tChArSeT=UtF-8\t "],
     ["type-charset-unquoted", "application/json;charset=utf-8"],
     ["type-charset-quoted", 'application/json;ChArSeT="UtF-8"'],
   ]);
   const rejectedContentTypes = new Map([
     ["type-json-prefix", "application/jsonx"],
     ["type-json-suffix", "application/problem+json"],
     ["type-slash-left-ows", "application /json"],
     ["type-slash-right-ows", "application/ json"],
     ["type-token-inner-ows", "app lication/json"],
     ["type-equals-left-ows", "application/json;charset =utf-8"],
     ["type-equals-right-ows", "application/json;charset= utf-8"],
     ["type-extra-parameter", "application/json;charset=utf-8;profile=fixture"],
     ["type-duplicate-charset", "application/json;charset=utf-8;charset=utf-8"],
     ["type-comma", "application/json, application/json"],
     ["type-missing-parameter", "application/json;"],
     ["type-missing-name", "application/json;=utf-8"],
     ["type-wrong-name", "application/json;encoding=utf-8"],
     ["type-wrong-charset", "application/json;charset=us-ascii"],
     ["type-empty-charset", "application/json;charset="],
     ["type-empty-quoted-charset", 'application/json;charset=""'],
     ["type-single-quoted-charset", "application/json;charset='utf-8'"],
     ["type-unbalanced-open-quote", 'application/json;charset="utf-8'],
     ["type-unbalanced-close-quote", 'application/json;charset=utf-8"'],
     ["type-doubled-quote", 'application/json;charset=""utf-8""'],
     ["type-quoted-prefix", 'application/json;charset="xutf-8"'],
     ["type-quoted-suffix", 'application/json;charset="utf-8x"'],
     ["type-quoted-backslash", 'application/json;charset="utf\\-8"'],
     ["type-quoted-escaped-quote", 'application/json;charset="utf-8\\""'],
     ["type-non-ascii-lookalike", "application/json;charset=utf­8"],
   ]);
       if (scenario === "legacy-editor") {
         res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: true }));
       } else if (scenario === "future-commenter") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({ canSuggest: true, role: "commenter", extension: { channel: "invented", nested: { members: [{ active: true }] } } })));
       } else if (scenario === "future-viewer") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({ canComment: false })));
       } else if (scenario === "future-authoritative-reader") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({ canEdit: true, role: "editor" })));
       } else if (scenario === "future-external-guest") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({ roles: ["guest"], role: "none", shared: false })));
       } else if (scenario === "future-all-capabilities") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({
           role: "owner", canComment: true, canEdit: true, canSuggest: true,
           canAccept: true, canShare: true, canSeeMembers: true,
         })));
       } else if (scenario.startsWith("future-role-")) {
         const role = scenario.slice("future-role-".length);
         if (!["owner", "editor", "commenter", "viewer", "none"].includes(role)) throw new Error("bad role fixture");
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(finalSession({ role })));
       } else if (scenario === "deep-extension") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json({ ...complete, extension: deepExtension }));
       } else if (scenario === "trimmed-doc") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: false }));
       } else if (acceptedContentTypes.has(scenario)) {
         res.writeHead(200, { "Content-Type": acceptedContentTypes.get(scenario), "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: false }));
       } else if (rejectedContentTypes.has(scenario)) {
         res.writeHead(200, { "Content-Type": rejectedContentTypes.get(scenario), "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: true }));
       } else if (scenario === "focus-stability") {
         setTimeout(() => {
           if (res.destroyed) return;
           res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
           res.end(json({ ...common, canEdit: false }));
         }, 1000);
       } else if (scenario === "empty-scalars") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json({ sub: "", email: "", name: "", roles: [], canComment: false, canEdit: false }));
       } else if (scenario === "signed-out") {
         res.writeHead(401, { "Cache-Control": "private, no-store" });
         res.end();
       } else if (scenario === "stale-session") {
         setTimeout(() => {
           if (res.destroyed) return;
           res.writeHead(401, { "Cache-Control": "private, no-store" });
           res.end();
         }, 300);
       } else if (scenario === "redirect") {
         res.writeHead(302, { Location: "/redirect-target", "Cache-Control": "private, no-store" });
         res.end();
       } else if (scenario === "missing-type") {
         res.writeHead(200, { "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: true }));
       } else if (scenario === "bad-type") {
         res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "private, no-store" });
         res.end("<p>Not a session</p>");
       } else if (scenario === "status-201-json") {
         res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: true }));
       } else if (scenario === "bad-json") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end("{");
       } else if (invalidSessions.has(scenario)) {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json(invalidSessions.get(scenario)));
       } else if (scenario === "slow") {
         setTimeout(() => {
           if (res.destroyed) return;
           res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
           res.end(json({ ...common, canEdit: true }));
         }, 3000);
       } else if (scenario === "body-stall") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.write('{"sub":"u_stall_421"');
       } else if (scenario === "partial-body") {
         res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.write('{"sub":"u_partial_772"');
         setTimeout(() => res.destroy(), 50);
       } else if (scenario === "focus-failure") {
         setTimeout(() => {
           if (res.destroyed) return;
           res.writeHead(503, { "Cache-Control": "private, no-store" });
           res.end();
         }, 1000);
       } else if (scenario === "status-403") {
         res.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
         res.end(json({ ...common, canEdit: true }));
       } else {
         const status = new Map([
           ["status-204", 204],
           ["status-404", 404],
           ["status-405", 405],
           ["status-429", 429],
           ["status-500", 500],
           ["server-error", 503],
         ]).get(scenario) ?? 503;
         res.writeHead(status, { "Cache-Control": "private, no-store" });
         res.end();
       }
       return;
     }

     const scenario = url.pathname.split("/").filter(Boolean)[0] ?? "";
     let body = scenario === "missing-doc"
       ? html.replace(/<meta name="doc-id"[^>]*>\n?/, "")
       : html;
     if (scenario === "empty-doc") {
       body = body.replace(/(<meta name="doc-id" content=")[^"]*(">)/, "$1$2");
     } else if (scenario === "whitespace-doc") {
       body = body.replace(/(<meta name="doc-id" content=")[^"]*(">)/, "$1   $2");
     } else if (scenario === "trimmed-doc") {
       body = body.replace(/(<meta name="doc-id" content=")[^"]*(">)/, `$1  ${docId}  $2`);
     }
     const primitiveOverride = {
       "missing-fetch": ["fetch", "undefined"],
       "missing-abort-controller": ["AbortController", "undefined"],
       "missing-custom-event": ["CustomEvent", "undefined"],
       "missing-url": ["URL", "undefined"],
       "wrong-fetch": ["fetch", "Object.freeze({})"],
       "wrong-abort-controller": ["AbortController", "Object.freeze({})"],
       "wrong-custom-event": ["CustomEvent", "Object.freeze({})"],
       "wrong-url": ["URL", "Object.freeze({})"],
     }[scenario];
     if (primitiveOverride) {
       const [primitive, replacement] = primitiveOverride;
       body = insertBeforeSessionModule(
         body,
         `Object.defineProperty(window, ${JSON.stringify(primitive)}, { configurable: true, value: ${replacement} });`,
       );
     }
     const startsWithStaleHint = primitiveOverride
       || ["missing-doc", "empty-doc", "whitespace-doc", "stale-session"].includes(scenario);
     if (startsWithStaleHint) {
       body = insertBeforeSessionModule(
         body,
         'document.documentElement.dataset.session = "editor"; window.__preexistingSession = document.documentElement.dataset.session;',
       );
     }
     if (["focus-stability", "focus-failure"].includes(scenario)) {
       body = insertBeforeSessionModule(body, `
         const focusFixture = document.createElement("button");
         focusFixture.id = "focus-fixture";
         focusFixture.textContent = "Focus fixture";
         const themeFixture = document.createElement("button");
         themeFixture.id = "theme-fixture";
         themeFixture.textContent = "Theme fixture";
         themeFixture.addEventListener("click", () => {
           document.documentElement.dataset.theme = document.documentElement.dataset.theme === "fixture-dark"
             ? "fixture-light" : "fixture-dark";
         });
         const deepLinkFixture = document.createElement("div");
         deepLinkFixture.id = "p2c-deep-link";
         const disclosureFixture = document.createElement("details");
         disclosureFixture.id = "disclosure-fixture";
         const disclosureSummary = document.createElement("summary");
         disclosureSummary.id = "summary-fixture";
         disclosureSummary.textContent = "Disclosure fixture";
         disclosureFixture.append(disclosureSummary, document.createTextNode("Invented detail."));
         document.body.append(focusFixture, themeFixture, deepLinkFixture, disclosureFixture);
         focusFixture.focus();
       `);
     }
     const headers = {
       "Content-Type": "text/html; charset=utf-8",
       "Set-Cookie": "p2c_fixture=present; Path=/; SameSite=Lax",
       "Cache-Control": "no-store",
     };
     if (scenario === "csp") headers["Content-Security-Policy"] = "connect-src 'none'";
     res.writeHead(200, headers);
     res.end(body);
   });

   server.listen(0, "127.0.0.1", () => {
     const address = server.address();
     if (!address || typeof address === "string") throw new Error("no fixture port");
     writeFileSync(process.env.P2C_PORT_FILE, String(address.port));
   });
   SERVER

   install -m 600 /dev/stdin "$P2C_TEST_ROOT/session.spec.mjs" <<'SPEC'
   import { test, expect } from "@playwright/test";
   import assert from "node:assert/strict";
   import { parse } from "acorn";
   import { readFileSync, writeFileSync } from "node:fs";
   import { dirname, join } from "node:path";
   import { pathToFileURL } from "node:url";

   const origin = process.env.P2C_ORIGIN;
   const fixtureHtml = readFileSync(process.env.P2C_HTML, "utf8");
   const sessionOpenTag = '<script type="module">';
   const sessionModuleAt = fixtureHtml.lastIndexOf(sessionOpenTag);
   if (sessionModuleAt < 0) throw new Error("fixture has no session module");
   const sessionSourceAt = sessionModuleAt + sessionOpenTag.length;
   const sessionModuleEnd = fixtureHtml.indexOf("</script>", sessionSourceAt);
   if (sessionModuleEnd < 0) throw new Error("fixture session module is not closed");
   if (/<script\b/i.test(fixtureHtml.slice(sessionModuleEnd + "</script>".length))) {
     throw new Error("fixture has a classic or module script after session.js");
   }
   const sessionSource = fixtureHtml.slice(sessionSourceAt, sessionModuleEnd).trim();
   const syntaxTree = parse(sessionSource, { ecmaVersion: "latest", sourceType: "module" });
   const ancestorsByNode = new Map();
   const allNodes = [];
   const visit = (value, ancestors = []) => {
     if (!value || typeof value !== "object") return;
     if (Array.isArray(value)) {
       for (const item of value) visit(item, ancestors);
       return;
     }
     if (typeof value.type !== "string") return;
     ancestorsByNode.set(value, ancestors);
     allNodes.push(value);
     const next = [...ancestors, value];
     for (const [key, child] of Object.entries(value)) {
       if (["start", "end", "loc", "range"].includes(key)) continue;
       visit(child, next);
     }
   };
   visit(syntaxTree);

   const functionTypes = new Set([
     "FunctionDeclaration",
     "FunctionExpression",
     "ArrowFunctionExpression",
   ]);
   for (const node of allNodes) {
     if (node.type === "AwaitExpression"
       || (node.type === "ForOfStatement" && node.await)) {
       assert.ok(
         ancestorsByNode.get(node).some((ancestor) => functionTypes.has(ancestor.type)),
         "session.js must not contain top-level await",
       );
     }
   }

   const staticPropertyName = (node) => {
     if (!node || node.type !== "MemberExpression") return null;
     if (!node.computed && node.property.type === "Identifier") return node.property.name;
     if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
       return node.property.value;
     }
     if (node.computed && node.property.type === "TemplateLiteral"
       && node.property.expressions.length === 0) {
       return node.property.quasis[0].value.cooked;
     }
     return null;
   };
   const rootIdentifier = (node) => {
     let current = node;
     while (current?.type === "MemberExpression") current = current.object;
     return current?.type === "Identifier" ? current.name : null;
   };
   const globalObjects = new Set(["window", "globalThis", "self", "frames", "parent", "top", "navigator"]);
   const forbiddenIdentifiers = new Set([
     "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection",
     "BroadcastChannel", "Storage", "indexedDB", "IDBFactory", "IDBDatabase",
     "Cache", "CacheStorage", "caches", "chrome", "webkitRequestFileSystem",
     "Request", "Image", "Response", "importScripts", "requestIdleCallback", "requestAnimationFrame", "queueMicrotask",
     "MessageChannel", "scheduler", "eval", "Function",
   ]);
   const directFetchCalls = [];
   for (const node of allNodes) {
     if (node.type === "MemberExpression") {
       const propertyName = staticPropertyName(node);
       assert.notEqual(propertyName, "fetch", "fetch must be a direct bare call");
       assert.ok(
         !(node.computed && globalObjects.has(rootIdentifier(node))),
         "computed access through a browser global is forbidden",
       );
       assert.ok(!["classList", "className", "focus"].includes(propertyName),
         "class-based signals and focus mutation are forbidden");
       assert.ok(!(typeof propertyName === "string" && /^aria[A-Z-]/.test(propertyName)),
         "ARIA mutation surfaces are forbidden");
     }
     if (node.type === "AssignmentExpression" && node.left.type === "MemberExpression") {
       assert.ok(
         !globalObjects.has(rootIdentifier(node.left)),
         "direct global-member assignment is forbidden",
       );
     }
     if (node.type === "CallExpression") {
       if (node.callee.type === "Identifier" && node.callee.name === "fetch") {
         directFetchCalls.push(node);
       }
       if (node.callee.type === "MemberExpression"
         && ["defineProperty", "defineProperties"].includes(staticPropertyName(node.callee))) {
         assert.fail("defineProperty/defineProperties is forbidden in session.js");
       }
     }
     if (node.type === "Identifier" && forbiddenIdentifiers.has(node.name)) {
       assert.fail(`session.js uses forbidden API or vendor global ${node.name}`);
     }
   }
   assert.equal(directFetchCalls.length, 1, "session.js must contain one direct bare fetch call");
   for (const node of allNodes.filter((candidate) => candidate.type === "Identifier" && candidate.name === "fetch")) {
     const parent = ancestorsByNode.get(node).at(-1);
     const allowed = (parent?.type === "CallExpression" && parent.callee === node)
       || (parent?.type === "UnaryExpression" && parent.operator === "typeof");
     assert.ok(allowed, "fetch must not be aliased, assigned, destructured, or otherwise referenced");
   }
   const customEvents = allNodes.filter((node) => node.type === "NewExpression"
     && node.callee.type === "Identifier"
     && node.callee.name === "CustomEvent");
   assert.equal(customEvents.length, 1, "session.js must construct one CustomEvent");
   assert.equal(customEvents[0].arguments[0]?.value, "session",
     "the sole CustomEvent must be lowercase session");
   const dispatchCalls = allNodes.filter((node) => node.type === "CallExpression"
     && node.callee.type === "MemberExpression"
     && staticPropertyName(node.callee) === "dispatchEvent");
   assert.equal(dispatchCalls.length, 1, "session.js must have one direct dispatchEvent call");
   assert.equal(rootIdentifier(dispatchCalls[0].callee), "document",
     "the session event must be dispatched from document");

   const isResponseStatus = (node) => node?.type === "MemberExpression"
     && !node.computed
     && node.object.type === "Identifier"
     && node.object.name === "response"
     && node.property.type === "Identifier"
     && node.property.name === "status";
   const strictStatusGuard = allNodes.filter((node) => node.type === "BinaryExpression"
     && node.operator === "!=="
     && isResponseStatus(node.left)
     && node.right.type === "Literal"
     && node.right.value === 200);
   assert.equal(strictStatusGuard.length, 1, "session.js must contain one strict response.status !== 200 guard");
   const responseHeaderReads = allNodes.filter((node) => node.type === "MemberExpression"
     && !node.computed
     && node.object.type === "Identifier"
     && node.object.name === "response"
     && node.property.type === "Identifier"
     && node.property.name === "headers");
   assert.ok(responseHeaderReads.length >= 1, "session.js must read the response headers after status 200");
   assert.ok(responseHeaderReads.every((node) => node.start > strictStatusGuard[0].end),
     "session.js must check status before accessing response headers");
   const contentTypeFunctions = allNodes.filter((node) => node.type === "FunctionDeclaration"
     && node.id?.name === "isJsonContentType");
   assert.equal(contentTypeFunctions.length, 1,
     "session.js must declare one pure isJsonContentType function");
   assert.equal(ancestorsByNode.get(contentTypeFunctions[0]).at(-1)?.type, "Program",
     "isJsonContentType must be visible to the in-module fixture tail");

   const fetchCall = directFetchCalls[0];
   const fetchAncestors = ancestorsByNode.get(fetchCall);
   const fetchTry = [...fetchAncestors].reverse().find((node) => node.type === "TryStatement");
   assert.ok(fetchTry?.finalizer, "the fetch must be covered by a finally block");
   const fetchStatement = fetchTry.block.body.find((statement) => statement.start <= fetchCall.start
     && statement.end >= fetchCall.end);
   assert.ok(fetchStatement, "the fetch must be a direct statement in the protected try block");
   assert.equal(fetchStatement.type, "VariableDeclaration",
     "the fetch statement must only bind the awaited response");
   assert.equal(fetchStatement.declarations.length, 1,
     "the fetch statement must contain one declaration");
   assert.equal(fetchStatement.declarations[0].init?.type, "AwaitExpression",
     "the response declaration must directly await fetch");
   assert.equal(fetchStatement.declarations[0].init.argument, fetchCall,
     "no operation may wrap or precede fetch in its statement");
   const fetchIndex = fetchTry.block.body.indexOf(fetchStatement);
   let timerStatement;
   if (fetchIndex > 0) {
     timerStatement = fetchTry.block.body[fetchIndex - 1];
   } else {
     const parentBlock = ancestorsByNode.get(fetchTry).at(-1);
     assert.equal(parentBlock?.type, "BlockStatement",
       "a timer outside the fetch try must share its containing block");
     timerStatement = parentBlock.body[parentBlock.body.indexOf(fetchTry) - 1];
   }
   assert.equal(timerStatement?.type, "VariableDeclaration",
     "the abort timer declaration must immediately precede the fetch statement or its try");
   assert.equal(timerStatement.declarations.length, 1, "the timer declaration must contain no other work");
   const timerDeclaration = timerStatement.declarations[0];
   assert.equal(timerDeclaration.id.type, "Identifier", "the timer handle must use a local identifier");
   assert.equal(timerDeclaration.init?.type, "CallExpression", "the timer handle must come from setTimeout");
   assert.equal(timerDeclaration.init.callee.type, "Identifier");
   assert.equal(timerDeclaration.init.callee.name, "setTimeout");
   assert.equal(timerDeclaration.init.arguments[1]?.value, 2000, "the abort timer must be 2000 ms");
   const clearCalls = allNodes.filter((node) => node.type === "CallExpression"
     && node.start >= fetchTry.finalizer.start
     && node.end <= fetchTry.finalizer.end
     && node.callee.type === "Identifier"
     && node.callee.name === "clearTimeout");
   assert.equal(clearCalls.length, 1, "the encompassing finally must clear the timer once");
   assert.equal(clearCalls[0].arguments[0]?.type, "Identifier");
   assert.equal(clearCalls[0].arguments[0].name, timerDeclaration.id.name,
     "the encompassing finally must clear the installed timer handle");

   const staleScript = '<script>document.documentElement.dataset.session = "editor"; window.__preexistingSession = document.documentElement.dataset.session;</script>\n';
   const nonHttpHtml = `${fixtureHtml.slice(0, sessionModuleAt)}${staleScript}${fixtureHtml.slice(sessionModuleAt)}`;
   const nonHttpPath = join(dirname(process.env.P2C_HTML), "non-http-document.html");
   writeFileSync(nonHttpPath, nonHttpHtml, { mode: 0o600 });
   const fileUrl = pathToFileURL(nonHttpPath);
   const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(nonHttpHtml)}`;

   test.beforeEach(async ({ page }) => {
     await page.addInitScript(() => {
       window.__sessionEvents = [];
       window.__sessionRelatedDispatches = [];
       window.__fetchCalls = [];
       window.__parsedSessionBodies = [];
       window.__sessionBodyConsumption = [];
       window.__sessionEndpointConstructions = [];
       window.__probeTimers = [];
       window.__probeLifecycle = [];
       window.__domContentLoadedSnapshot = null;
       window.__loadSnapshot = null;
       window.__unhandledRejections = [];
       window.__consoleCalls = [];
       window.addEventListener("unhandledrejection", (event) => {
         window.__unhandledRejections.push(String(event.reason));
       });
       for (const level of ["log", "info", "warn", "error", "debug"]) {
         const nativeConsole = console[level].bind(console);
         console[level] = (...args) => {
           window.__consoleCalls.push([level, ...args.map(String)]);
           return nativeConsole(...args);
         };
       }
       const NativeURL = window.URL;
       window.URL = class FixtureURL extends NativeURL {
         constructor(input, base) {
           super(input, base);
           if (input === "/api/session") {
             window.__sessionEndpointConstructions.push(String(this));
             window.__probeLifecycle.push("endpoint");
           }
         }
       };
       const NativeAbortController = window.AbortController;
       window.AbortController = class FixtureAbortController extends NativeAbortController {
         constructor() {
           super();
           window.__probeLifecycle.push("controller");
         }
         abort(...args) {
           window.__probeLifecycle.push("abort");
           return super.abort(...args);
         }
       };
       const NativeCustomEvent = window.CustomEvent;
       const nativeDocumentDispatch = document.dispatchEvent.bind(document);
       document.dispatchEvent = function (event) {
         if (event instanceof NativeCustomEvent && /session/i.test(event.type)) {
           window.__sessionRelatedDispatches.push(event.type);
         }
         return nativeDocumentDispatch(event);
       };
       document.addEventListener("DOMContentLoaded", () => {
         window.__domContentLoadedSnapshot = {
           fetchCalls: window.__fetchCalls.length,
           lifecycle: [...window.__probeLifecycle],
           bodyConsumption: [...window.__sessionBodyConsumption],
           timers: window.__probeTimers.map((timer) => ({
             fired: timer.fired,
             cleared: timer.cleared,
           })),
         };
       }, { once: true });
       window.addEventListener("load", () => {
         window.__loadSnapshot = {
           fetchCalls: window.__fetchCalls.length,
           lifecycle: [...window.__probeLifecycle],
           bodyConsumption: [...window.__sessionBodyConsumption],
           timers: window.__probeTimers.map((timer) => ({
             fired: timer.fired,
             cleared: timer.cleared,
           })),
         };
       }, { once: true });
       const nativeSetTimeout = window.setTimeout.bind(window);
       const nativeClearTimeout = window.clearTimeout.bind(window);
       window.setTimeout = function (handler, delay, ...args) {
         if (delay !== 2000 || typeof handler !== "function") {
           return nativeSetTimeout(handler, delay, ...args);
         }
         const timer = { id: null, fired: false, cleared: false };
         const id = nativeSetTimeout((...timerArgs) => {
           timer.fired = true;
           return handler(...timerArgs);
         }, delay, ...args);
         timer.id = id;
         window.__probeTimers.push(timer);
         window.__probeLifecycle.push("timer");
         return id;
       };
       window.clearTimeout = function (id) {
         const timer = window.__probeTimers.find((entry) => entry.id === id);
         if (timer) {
           timer.cleared = true;
           timer.clearCount = (timer.clearCount ?? 0) + 1;
           window.__probeLifecycle.push("clear");
         }
         return nativeClearTimeout(id);
       };
       const bodyMethods = new Set(["json", "text", "arrayBuffer", "blob", "formData", "bytes"]);
       const streamMethods = new Set(["getReader", "tee", "pipeTo", "pipeThrough", "cancel", "values"]);
       const wrapStream = (stream) => new Proxy(stream, {
         get(target, property) {
           if (property === Symbol.asyncIterator) {
             window.__sessionBodyConsumption.push("body.asyncIterator");
           } else if (property === Symbol.iterator) {
             window.__sessionBodyConsumption.push("body.iterator");
           } else if (streamMethods.has(property)) {
             window.__sessionBodyConsumption.push(`body.${String(property)}`);
           }
           const value = Reflect.get(target, property, target);
           return typeof value === "function" ? value.bind(target) : value;
         },
       });
       const wrapResponse = (response) => new Proxy(response, {
         get(target, property) {
           if (property === "body" || property === "bodyUsed") {
             window.__sessionBodyConsumption.push(`response.${property}`);
             const value = Reflect.get(target, property, target);
             return property === "body" && value ? wrapStream(value) : value;
           }
           if (property === "clone") {
             window.__sessionBodyConsumption.push("response.clone");
             return (...args) => wrapResponse(target.clone(...args));
           }
           if (bodyMethods.has(property)) {
             return async (...args) => {
               window.__sessionBodyConsumption.push(String(property));
               const consumed = await target[property](...args);
               if (property === "json") window.__parsedSessionBodies.push(consumed);
               return consumed;
             };
           }
           const value = Reflect.get(target, property, target);
           return typeof value === "function" ? value.bind(target) : value;
         },
       });
       const NativeResponse = window.Response;
       window.Response = new Proxy(NativeResponse, {
         construct(target, args) {
           window.__sessionBodyConsumption.push("new Response");
           return wrapResponse(Reflect.construct(target, args));
         },
       });
       const sessionMutationObserver = new MutationObserver(() => {});
       sessionMutationObserver.observe(document.documentElement, {
         attributes: true,
         attributeFilter: ["data-session"],
       });
       const nativeFetch = window.fetch;
       if (typeof nativeFetch === "function") {
         window.fetch = function (input, init) {
           window.__probeLifecycle.push("fetch");
           window.__fetchCalls.push({
             url: String(input),
             inputIsURL: input instanceof NativeURL,
             method: init?.method,
             mode: init?.mode,
             credentials: init?.credentials,
             cache: init?.cache,
             redirect: init?.redirect,
             headerEntries: [...new Headers(init?.headers).entries()],
             initKeys: Object.keys(init ?? {}).sort(),
             signal: init?.signal ?? null,
           });
           if (location.pathname.startsWith("/fetch-throw/")) {
             throw new TypeError("fixture synchronous fetch throw");
           }
           if (location.pathname.startsWith("/fetch-failure/")) {
             return Promise.reject(new TypeError("fixture fetch failure"));
           }
           if (location.pathname.startsWith("/body-stall/")) {
             const nativeRequest = nativeFetch.call(this, input, init);
             nativeRequest.catch(() => {});
             const stalledResponse = {
               status: 200,
               headers: new Headers({ "Content-Type": "application/json" }),
               json() {
                 return new Promise((resolve, reject) => {
                   const rejectAbort = () => reject(init.signal?.reason ?? new Error("fixture abort"));
                   if (init.signal?.aborted) rejectAbort();
                   else init.signal?.addEventListener("abort", rejectAbort, { once: true });
                 });
               },
             };
             return Promise.resolve(wrapResponse(stalledResponse));
           }
           return nativeFetch.call(this, input, init).then(wrapResponse);
         };
       }
       document.addEventListener("session", (event) => {
         const mutationRecords = sessionMutationObserver.takeRecords();
         window.__sessionEvents.push({
           detail: event.detail,
           detailIsParsedBody: event.detail === window.__parsedSessionBodies.at(-1),
           type: event.type,
           targetIsDocument: event.target === document,
           bubbles: event.bubbles,
           cancelable: event.cancelable,
           composed: event.composed,
           root: document.documentElement.dataset.session,
           sameTurnAttributeRecords: mutationRecords.map((record) => record.attributeName),
         });
       });
     });
   });

   async function addControls(page) {
     return page.evaluate(() => {
       const reader = document.createElement("button");
       reader.id = "reader-fixture";
       reader.dataset.readerOnly = "";
       reader.textContent = "P2-C reader fixture";
       const readerBlock = document.createElement("section");
       readerBlock.id = "reader-block-fixture";
       readerBlock.dataset.readerOnly = "";
       readerBlock.textContent = "P2-C reader block fixture";
       const editor = document.createElement("button");
       editor.id = "editor-fixture";
       editor.dataset.editorOnly = "";
       editor.textContent = "P2-C editor fixture";
       const hidden = document.createElement("button");
       hidden.id = "hidden-fixture";
       hidden.dataset.editorOnly = "";
       hidden.hidden = true;
       hidden.textContent = "P2-C hidden fixture";
       const unrelated = document.createElement("button");
       unrelated.id = "unrelated-fixture";
       unrelated.textContent = "P2-C unrelated fixture";
       document.body.prepend(reader, readerBlock, editor, hidden, unrelated);
       return true;
     });
   }

   async function display(page, id) {
     return page.locator(id).evaluate((node) => getComputedStyle(node).display);
   }

   async function accessibilityNames(page) {
     const session = await page.context().newCDPSession(page);
     const { nodes } = await session.send("Accessibility.getFullAXTree");
     await session.detach();
     return nodes.map((node) => node.name?.value).filter(Boolean);
   }

   const normalizeSurface = (surface) => ({
     ...surface,
     rootAttributes: surface.rootAttributes.filter((entry) => !entry.startsWith("data-session=")),
   });

   async function expectNoExtraSessionSurface(page) {
     const surfaces = await page.evaluate(() => ({
       baseline: window.__sessionSurfaceBaseline,
       tail: window.__sessionModuleTailSnapshot,
       settled: window.__captureSessionSurface(),
     }));
     expect(surfaces.tail.sessionAttribute).toBeNull();
     expect(normalizeSurface(surfaces.tail.surface)).toEqual(normalizeSurface(surfaces.baseline));
     expect(normalizeSurface(surfaces.settled)).toEqual(normalizeSurface(surfaces.baseline));
   }

   async function expectProbeTimer(page, fired, checkSurface = true) {
     await expect.poll(() => page.evaluate(() => ({
       lifecycle: window.__probeLifecycle,
       timers: window.__probeTimers.map((timer) => ({
         fired: timer.fired,
         cleared: timer.cleared,
         clearCount: timer.clearCount ?? 0,
       })),
     }))).toEqual({
       lifecycle: fired
         ? ["endpoint", "controller", "timer", "fetch", "abort", "clear"]
         : ["endpoint", "controller", "timer", "fetch", "clear"],
       timers: [{ fired, cleared: true, clearCount: 1 }],
     });
     expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
     expect(await page.evaluate(() => window.__sessionEndpointConstructions.length)).toBe(1);
     if (checkSurface) await expectNoExtraSessionSurface(page);
     await expectSilentProbe(page);
   }

   function expectSessionEvent(event) {
     expect(event).toMatchObject({
       type: "session",
       targetIsDocument: true,
       bubbles: false,
       cancelable: false,
       composed: false,
       sameTurnAttributeRecords: ["data-session"],
     });
   }

   async function expectSilentProbe(page) {
     expect(await page.evaluate(() => window.__consoleCalls)).toEqual([]);
     expect(await page.evaluate(() => window.__unhandledRejections)).toEqual([]);
   }

   test("legacy editor maps canEdit and dispatches once", async ({ page }) => {
     const consoleMessages = [];
     page.on("console", (message) => consoleMessages.push(message.text()));
     await page.clock.install();
     await page.goto(`${origin}/legacy-editor/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     await addControls(page);
     expect(await display(page, "#reader-fixture")).not.toBe("none");
     expect(await display(page, "#reader-block-fixture")).toBe("block");
     expect(await display(page, "#editor-fixture")).not.toBe("none");
     expect(await display(page, "#hidden-fixture")).toBe("none");
     expect(await display(page, "#unrelated-fixture")).not.toBe("none");
     const visibleAccessibilityNames = await accessibilityNames(page);
     expect(visibleAccessibilityNames).toContain("P2-C reader fixture");
     expect(visibleAccessibilityNames).toContain("P2-C editor fixture");
     expect(visibleAccessibilityNames).not.toContain("P2-C hidden fixture");
     await page.evaluate(() => document.activeElement?.blur());
     await page.keyboard.press("Tab");
     expect(await page.evaluate(() => document.activeElement?.id)).toBe("reader-fixture");
     await page.keyboard.press("Tab");
     expect(await page.evaluate(() => document.activeElement?.id)).toBe("editor-fixture");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     expect(events[0].root).toBe("editor");
     expect(events[0].detail).toEqual({
       sub: "u_demo_931",
       email: "avery@example.com",
       name: "Avery Quill",
       roles: ["member"],
       canComment: true,
       canEdit: true,
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     await expectProbeTimer(page, false);
     const calls = await page.evaluate(() => window.__fetchCalls.map(({ signal, ...call }) => ({
       ...call,
       signalIsAbortSignal: signal instanceof AbortSignal,
       signalAborted: signal?.aborted,
     })));
     expect(calls).toHaveLength(1);
     const endpoint = new URL(calls[0].url);
     expect(endpoint.pathname).toBe("/api/session");
     expect([...endpoint.searchParams]).toEqual([["doc", expect.stringMatching(/^[0-9a-f]{6}$/)]]);
     expect(calls[0]).toMatchObject({
       inputIsURL: true,
       method: "GET",
       mode: "same-origin",
       credentials: "same-origin",
       cache: "no-store",
       redirect: "error",
       headerEntries: [["accept", "application/json"]],
       initKeys: ["cache", "credentials", "headers", "method", "mode", "redirect", "signal"],
       signalIsAbortSignal: true,
       signalAborted: false,
     });
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual(["json"]);
     expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([calls[0].url]);
     const moduleTail = await page.evaluate(() => window.__sessionModuleTailSnapshot);
     expect(moduleTail).toMatchObject({
       fetchCalls: 1,
       lifecycle: ["endpoint", "controller", "timer", "fetch"],
       localStorageLength: 0,
       sessionStorageLength: 0,
       cookie: "p2c_fixture=present",
     });
     expect(moduleTail.directContentTypes).toEqual([
       ["leading-space", true],
       ["leading-tab", true],
       ["trailing-space", true],
       ["trailing-tab", true],
       ["combined-outer-ows", true],
       ["quoted-combined-outer-ows", true],
       ["leading-nbsp", false],
       ["trailing-em-space", false],
       ["unicode-casefold-lookalike", false],
       ["leading-vertical-tab", false],
       ["trailing-form-feed", false],
       ["leading-line-feed", false],
       ["trailing-carriage-return", false],
     ]);
     expect(moduleTail.href).toBe(`${origin}/legacy-editor/`);
     expect(await page.evaluate(() => {
       const after = { ...document.documentElement.dataset };
       delete after.session;
       return after;
     })).toEqual(moduleTail.rootDataset);
     expect(await page.evaluate(() => location.href)).toBe(moduleTail.href);
     expect(await page.evaluate(() => ({
       localStorageLength: localStorage.length,
       sessionStorageLength: sessionStorage.length,
       cookie: document.cookie,
       dataUser: document.documentElement.getAttribute("data-user"),
       dataRole: document.documentElement.getAttribute("data-role"),
       documentSessionProperties: Object.keys(document).filter((key) => /session/i.test(key)),
       rootSessionProperties: Object.keys(document.documentElement).filter((key) => /session/i.test(key)),
     }))).toEqual({
       localStorageLength: 0,
       sessionStorageLength: 0,
       cookie: "p2c_fixture=present",
       dataUser: null,
       dataRole: null,
       documentSessionProperties: [],
       rootSessionProperties: [],
     });
     await page.evaluate(() => {
       window.__lateSessionEvents = 0;
       document.addEventListener("session", () => { window.__lateSessionEvents += 1; });
       document.dispatchEvent(new Event("visibilitychange"));
       window.dispatchEvent(new PageTransitionEvent("pageshow"));
       window.dispatchEvent(new Event("focus"));
       window.dispatchEvent(new Event("online"));
     });
     await page.clock.fastForward(86_400_000);
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(1);
     expect(await page.evaluate(() => window.__lateSessionEvents)).toBe(0);
     expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
     expect(await page.evaluate(() => window.__sessionRelatedDispatches)).toEqual(["session"]);
     expect(consoleMessages).toEqual([]);
   });

   test("future canSuggest is authoritative and payload is unchanged", async ({ page }) => {
     await page.addInitScript(() => {
       window.__sessionMutationAttempt = null;
       window.__sequentialListenerView = null;
       document.addEventListener("session", (event) => {
         window.__sessionMutationAttempt = {
           rootFrozen: Object.isFrozen(event.detail),
           rolesFrozen: Object.isFrozen(event.detail.roles),
           extensionFrozen: Object.isFrozen(event.detail.extension),
           nestedFrozen: Object.isFrozen(event.detail.extension.nested),
           membersFrozen: Object.isFrozen(event.detail.extension.nested.members),
           memberFrozen: Object.isFrozen(event.detail.extension.nested.members[0]),
           topLevelChanged: Reflect.set(event.detail, "canEdit", true),
           roleChanged: Reflect.set(event.detail.roles, 0, "guest"),
           extensionChanged: Reflect.set(event.detail.extension, "channel", "changed"),
           nestedChanged: Reflect.set(event.detail.extension.nested.members[0], "active", false),
         };
       });
       document.addEventListener("session", (event) => {
         window.__sequentialListenerView = {
           canEdit: event.detail.canEdit,
           role: event.detail.roles[0],
           channel: event.detail.extension.channel,
           active: event.detail.extension.nested.members[0].active,
         };
       });
     });
     await page.goto(`${origin}/future-commenter/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     const doc = await page.locator('meta[name="doc-id"]').getAttribute("content");
     expect(events[0].detail).toEqual({
       sub: "u_demo_931",
       email: "avery@example.com",
       name: "Avery Quill",
       roles: ["member"],
       canComment: true,
       canEdit: false,
       canSuggest: true,
       doc,
       role: "commenter",
       shared: true,
       canAccept: false,
       canShare: false,
       canSeeMembers: false,
       extension: { channel: "invented", nested: { members: [{ active: true }] } },
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     expect(await page.evaluate(() => window.__sessionMutationAttempt)).toEqual({
       rootFrozen: true,
       rolesFrozen: true,
       extensionFrozen: true,
       nestedFrozen: true,
       membersFrozen: true,
       memberFrozen: true,
       topLevelChanged: false,
       roleChanged: false,
       extensionChanged: false,
       nestedChanged: false,
     });
     expect(await page.evaluate(() => window.__sequentialListenerView)).toEqual({
       canEdit: false,
       role: "member",
       channel: "invented",
       active: true,
     });
     await expectProbeTimer(page, false);
   });

   test("future viewer receives reader UI only", async ({ page }) => {
     await page.goto(`${origin}/future-viewer/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     await addControls(page);
     expect(await display(page, "#reader-fixture")).not.toBe("none");
     expect(await display(page, "#reader-block-fixture")).toBe("block");
     expect(await display(page, "#editor-fixture")).toBe("none");
     expect(await display(page, "#unrelated-fixture")).not.toBe("none");
     const readerAccessibilityNames = await accessibilityNames(page);
     expect(readerAccessibilityNames).toContain("P2-C reader fixture");
     expect(readerAccessibilityNames).not.toContain("P2-C editor fixture");
     await page.evaluate(() => document.activeElement?.blur());
     await page.keyboard.press("Tab");
     expect(await page.evaluate(() => document.activeElement?.id)).toBe("reader-fixture");
     await page.keyboard.press("Tab");
     expect(await page.evaluate(() => document.activeElement?.id)).toBe("unrelated-fixture");
     const events = await page.evaluate(() => window.__sessionEvents);
     const doc = await page.locator('meta[name="doc-id"]').getAttribute("content");
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     expect(events[0].detail).toEqual({
       sub: "u_demo_931",
       email: "avery@example.com",
       name: "Avery Quill",
       roles: ["member"],
       canComment: false,
       canEdit: false,
       canSuggest: false,
       doc,
       role: "viewer",
       shared: true,
       canAccept: false,
       canShare: false,
       canSeeMembers: false,
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     await expectProbeTimer(page, false);
   });

   test("final external compatibility is exactly guest and remains presentation-only", async ({ page }) => {
     await page.goto(`${origin}/future-external-guest/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     const doc = await page.locator('meta[name="doc-id"]').getAttribute("content");
     expect(events[0].detail).toEqual({
       sub: "u_demo_931",
       email: "avery@example.com",
       name: "Avery Quill",
       roles: ["guest"],
       canComment: true,
       canEdit: false,
       doc,
       role: "none",
       shared: false,
       canSuggest: false,
       canAccept: false,
       canShare: false,
       canSeeMembers: false,
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     expect(await page.evaluate(() => Object.isFrozen(window.__sessionEvents[0].detail)
       && Object.isFrozen(window.__sessionEvents[0].detail.roles))).toBe(true);
     expect(events[0].root).toBe("reader");
     await expectProbeTimer(page, false);
   });

   test("every required final boolean accepts true and remains unchanged", async ({ page }) => {
     await page.goto(`${origin}/future-all-capabilities/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     expect(events[0].detail).toMatchObject({
       role: "owner",
       shared: true,
       canComment: true,
       canSuggest: true,
       canEdit: true,
       canAccept: true,
       canShare: true,
       canSeeMembers: true,
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     expect(events[0].root).toBe("editor");
     await expectProbeTimer(page, false);
   });

   for (const role of ["owner", "editor", "commenter", "viewer", "none"]) {
     test(`final P2-G role ${role} is accepted without deriving presentation authority`, async ({ page }) => {
       await page.goto(`${origin}/future-role-${role}/`, { waitUntil: "domcontentloaded" });
       await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
       const events = await page.evaluate(() => window.__sessionEvents);
       expect(events).toHaveLength(1);
       expectSessionEvent(events[0]);
       expect(events[0].detail.role).toBe(role);
       expect(events[0].detail.roles).toEqual(["member"]);
       expect(events[0].detailIsParsedBody).toBe(true);
       expect(events[0].root).toBe("reader");
       await expectProbeTimer(page, false);
     });
   }

   test("the finite 256-object nesting boundary is frozen without projection", async ({ page }) => {
     await page.goto(`${origin}/deep-extension/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     const result = await page.evaluate(() => {
       const event = window.__sessionEvents[0];
       let current = event?.detail?.extension;
       const levels = [];
       const frozen = [];
       let leaf = false;
       for (let level = 0; level < 256; level += 1) {
         levels.push(current?.level);
         frozen.push(Object.isFrozen(current));
         if (level === 255) leaf = current?.leaf === true;
         current = current?.next;
       }
       return {
         eventCount: window.__sessionEvents.length,
         detailIsParsedBody: event?.detailIsParsedBody,
         rootFrozen: Object.isFrozen(event?.detail),
         levels,
         frozen,
         endedAtLeaf: current === undefined && leaf,
       };
     });
     expect(result.eventCount).toBe(1);
     expect(result.detailIsParsedBody).toBe(true);
     expect(result.rootFrozen).toBe(true);
     expect(result.levels).toEqual(Array.from({ length: 256 }, (_, level) => level));
     expect(result.frozen).toEqual(Array.from({ length: 256 }, () => true));
     expect(result.endedAtLeaf).toBe(true);
     await expectProbeTimer(page, false);
   });

   test("present false canSuggest overrides true canEdit", async ({ page }) => {
     await page.goto(`${origin}/future-authoritative-reader/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     await addControls(page);
     expect(await display(page, "#reader-fixture")).not.toBe("none");
     expect(await display(page, "#editor-fixture")).toBe("none");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     expect(events[0].detail.canEdit).toBe(true);
     expect(events[0].detail.canSuggest).toBe(false);
     expect(events[0].root).toBe("reader");
     await expectProbeTimer(page, false);
   });

   test("empty strings and roles remain a valid reader payload", async ({ page }) => {
     await page.goto(`${origin}/empty-scalars/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     const events = await page.evaluate(() => window.__sessionEvents);
     expect(events).toHaveLength(1);
     expectSessionEvent(events[0]);
     expect(events[0].detail).toEqual({
       sub: "",
       email: "",
       name: "",
       roles: [],
       canComment: false,
       canEdit: false,
     });
     expect(events[0].detailIsParsedBody).toBe(true);
     await expectProbeTimer(page, false);
   });

   test("doc-id metadata is trimmed before endpoint construction", async ({ page }) => {
     await page.goto(`${origin}/trimmed-doc/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     const content = await page.locator('meta[name="doc-id"]').getAttribute("content");
     expect(content).toMatch(/^  [0-9a-f]{6}  $/);
     const calls = await page.evaluate(() => window.__fetchCalls.map(({ signal, ...call }) => call));
     expect(calls).toHaveLength(1);
     expect(new URL(calls[0].url).searchParams.get("doc")).toBe(content.trim());
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(1);
     await expectProbeTimer(page, false);
   });

   test("https pages run the same authenticated probe", async ({ page }) => {
     const httpsOrigin = "https://p2c.example.invalid";
     await page.route(`${httpsOrigin}/**`, async (route) => {
       const url = new URL(route.request().url());
       if (url.pathname === "/api/session") {
         await route.fulfill({
           status: 200,
           headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
           body: JSON.stringify({
             sub: "u_https_482",
             email: "river@example.com",
             name: "River Vale",
             roles: ["member"],
             canComment: false,
             canEdit: false,
           }),
         });
       } else {
         await route.fulfill({
           status: 200,
           headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
           body: fixtureHtml,
         });
       }
     });
     await page.goto(`${httpsOrigin}/allowed/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
     await expectProbeTimer(page, false, false);
     const calls = await page.evaluate(() => window.__fetchCalls.map(({ signal, ...call }) => call));
     expect(calls).toHaveLength(1);
     expect(new URL(calls[0].url).protocol).toBe("https:");
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(1);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual(["json"]);
   });

   for (const scenario of [
     "type-bare",
     "type-casefold",
     "type-leading-space",
     "type-leading-tab",
     "type-trailing-space",
     "type-trailing-tab",
     "type-before-semicolon-space",
     "type-before-semicolon-tab",
     "type-after-semicolon-space",
     "type-after-semicolon-tab",
     "type-after-value-space",
     "type-after-value-tab",
     "type-all-ows",
     "type-charset-unquoted",
     "type-charset-quoted",
   ]) {
     test(`${scenario} satisfies the exact JSON media-type grammar`, async ({ page }) => {
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "domcontentloaded" });
       await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("reader");
       await expectProbeTimer(page, false);
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(1);
       expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual(["json"]);
     });
   }

   for (const [scenario, expectedSession, expectedEvents] of [
     ["focus-stability", "reader", 1],
     ["focus-failure", null, 0],
   ]) {
     test(`${scenario} preserves focus, a fixture theme attribute, a real deep link, and disclosure`, async ({ page }) => {
       const errors = [];
       page.on("pageerror", (error) => errors.push(error.message));
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "domcontentloaded" });
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => document.activeElement?.id)).toBe("focus-fixture");
       const deepLink = await page.evaluate(() => {
         const link = [...document.querySelectorAll('a[href^="#"]')].find((candidate) => {
           const id = candidate.getAttribute("href")?.slice(1);
           return id && document.getElementById(id);
         });
         if (!link) throw new Error("generated document has no real deep link");
         link.click();
         const href = link.getAttribute("href");
         return { href, id: href.slice(1), targetExists: Boolean(document.getElementById(href.slice(1))) };
       });
       expect(deepLink.href).toMatch(/^#[a-z0-9._-]+$/);
       expect(deepLink.targetExists).toBe(true);
       await page.locator("#theme-fixture").click();
       expect(await page.locator("html").getAttribute("data-theme")).toBe("fixture-dark");
       await page.locator("#summary-fixture").click();
       expect(await page.locator("#disclosure-fixture").getAttribute("open")).not.toBeNull();
       expect(await page.evaluate(() => document.activeElement?.id)).toBe("summary-fixture");
       await expectProbeTimer(page, false, false);
       expect(await page.locator("html").getAttribute("data-session")).toBe(expectedSession);
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(expectedEvents);
       expect(await page.locator("html").getAttribute("data-theme")).toBe("fixture-dark");
       expect(await page.locator("#disclosure-fixture").getAttribute("open")).not.toBeNull();
       expect(await page.evaluate(() => document.activeElement?.id)).toBe("summary-fixture");
       expect(await page.evaluate(() => location.hash)).toBe(deepLink.href);
       expect(await page.evaluate((id) => document.getElementById(id) !== null, deepLink.id)).toBe(true);
       expect(errors).toEqual([]);
     });
   }

   test("print suppresses authenticated capability controls", async ({ page }) => {
     await page.goto(`${origin}/legacy-editor/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     await expectProbeTimer(page, false);
     await addControls(page);
     await page.emulateMedia({ media: "print" });
     expect(await display(page, "#reader-fixture")).toBe("none");
     expect(await display(page, "#editor-fixture")).toBe("none");
   });

   for (const scenario of [
     "signed-out",
     "status-201-json",
     "status-204",
     "redirect",
     "status-403",
     "status-404",
     "status-405",
     "status-429",
     "status-500",
     "server-error",
     "missing-type",
     "bad-type",
     "type-json-prefix",
     "type-json-suffix",
     "type-slash-left-ows",
     "type-slash-right-ows",
     "type-token-inner-ows",
     "type-equals-left-ows",
     "type-equals-right-ows",
     "type-extra-parameter",
     "type-duplicate-charset",
     "type-comma",
     "type-missing-parameter",
     "type-missing-name",
     "type-wrong-name",
     "type-wrong-charset",
     "type-empty-charset",
     "type-empty-quoted-charset",
     "type-single-quoted-charset",
     "type-unbalanced-open-quote",
     "type-unbalanced-close-quote",
     "type-doubled-quote",
     "type-quoted-prefix",
     "type-quoted-suffix",
     "type-quoted-backslash",
     "type-quoted-escaped-quote",
     "type-non-ascii-lookalike",
     "bad-json",
     "csp",
     "fetch-throw",
     "fetch-failure",
   ]) {
     test(`${scenario} stays dark without a page error`, async ({ page }) => {
       const errors = [];
       page.on("pageerror", (error) => errors.push(error.message));
       if (scenario === "signed-out") await page.clock.install();
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "domcontentloaded" });
       await expectProbeTimer(page, false);
       await addControls(page);
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
       expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
       expect(await page.evaluate(() => window.__parsedSessionBodies.length)).toBe(0);
       expect(await page.evaluate(() => window.__sessionBodyConsumption))
         .toEqual(scenario === "bad-json" ? ["json"] : []);
       expect(await display(page, "#reader-fixture")).toBe("none");
       expect(await display(page, "#reader-block-fixture")).toBe("none");
       expect(await display(page, "#editor-fixture")).toBe("none");
       expect(errors).toEqual([]);
       if (scenario === "signed-out") {
         expect(await page.evaluate(() => {
           document.querySelector("#editor-fixture").focus();
           return document.activeElement?.id === "editor-fixture";
         })).toBe(false);
         const hiddenAccessibilityNames = await accessibilityNames(page);
         expect(hiddenAccessibilityNames).not.toContain("P2-C reader fixture");
         expect(hiddenAccessibilityNames).not.toContain("P2-C editor fixture");
         await page.evaluate(() => document.activeElement?.blur());
         await page.keyboard.press("Tab");
         expect(await page.evaluate(() => document.activeElement?.id)).toBe("unrelated-fixture");
         await page.evaluate(() => {
           document.dispatchEvent(new Event("visibilitychange"));
           window.dispatchEvent(new PageTransitionEvent("pageshow"));
           window.dispatchEvent(new Event("focus"));
           window.dispatchEvent(new Event("online"));
         });
         await page.clock.fastForward(86_400_000);
         expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
         expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
         expect(await page.evaluate(() => window.__sessionRelatedDispatches)).toEqual([]);
       }
     });
   }

   const invalidShapeScenarios = [
     "shape-null",
     "shape-array",
     "shape-string",
     "shape-number",
     "shape-boolean",
     "shape-missing-sub",
     "shape-sub-type",
     "shape-missing-email",
     "shape-email-type",
     "shape-missing-name",
     "shape-name-type",
     "shape-missing-roles",
     "shape-roles-type",
     "shape-role-entry",
     "shape-missing-can-comment",
     "shape-can-comment-type",
     "shape-missing-can-edit",
     "shape-can-edit-type",
     "final-partial-doc-only",
     "final-missing-sub",
     "final-sub-type",
     "final-missing-email",
     "final-email-type",
     "final-missing-name",
     "final-name-type",
     "final-missing-roles",
     "final-roles-type",
     "final-roles-empty",
     "final-roles-entry-type",
     "final-roles-both",
     "final-roles-duplicate",
     "final-roles-unknown",
     "final-missing-can-comment",
     "final-can-comment-type",
     "final-missing-can-edit",
     "final-can-edit-type",
     "final-missing-doc",
     "final-doc-type",
     "final-wrong-doc",
     "final-missing-role",
     "final-role-type",
     "final-role-unknown",
     "final-missing-shared",
     "final-shared-type",
     "final-missing-can-suggest",
     "final-can-suggest-type",
     "final-missing-can-accept",
     "final-can-accept-type",
     "final-missing-can-share",
     "final-can-share-type",
     "final-missing-can-see-members",
     "final-can-see-members-type",
   ];
   for (const scenario of invalidShapeScenarios) {
     test(`${scenario} is rejected without revealing controls`, async ({ page }) => {
       const errors = [];
       page.on("pageerror", (error) => errors.push(error.message));
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "domcontentloaded" });
       await expectProbeTimer(page, false);
       await addControls(page);
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
       expect(await page.evaluate(() => window.__parsedSessionBodies.length)).toBe(1);
       expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual(["json"]);
       expect(await display(page, "#reader-fixture")).toBe("none");
       expect(await display(page, "#editor-fixture")).toBe("none");
       expect(errors).toEqual([]);
       await expectSilentProbe(page);
     });
   }

   test("slow request is dark while loading and after the two-second abort", async ({ page }) => {
     const errors = [];
     page.on("pageerror", (error) => errors.push(error.message));
     await page.goto(`${origin}/slow/`, { waitUntil: "load" });
     expect(await page.evaluate(() => window.__domContentLoadedSnapshot)).toEqual({
       fetchCalls: 1,
       lifecycle: ["endpoint", "controller", "timer", "fetch"],
       bodyConsumption: [],
       timers: [{ fired: false, cleared: false }],
     });
     expect(await page.evaluate(() => window.__loadSnapshot)).toEqual({
       fetchCalls: 1,
       lifecycle: ["endpoint", "controller", "timer", "fetch"],
       bodyConsumption: [],
       timers: [{ fired: false, cleared: false }],
     });
     expect(await page.evaluate(() => window.__sessionModuleTailSnapshot.lifecycle))
       .toEqual(["endpoint", "controller", "timer", "fetch"]);
     await addControls(page);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await display(page, "#reader-fixture")).toBe("none");
     await expectProbeTimer(page, true);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
     expect(await page.evaluate(() => window.__fetchCalls[0]?.signal?.aborted)).toBe(true);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
     expect(errors).toEqual([]);
   });

   test("controlled accepted headers enter a pending JSON read before lifecycle events", async ({ page }) => {
     const errors = [];
     const requests = [];
     page.on("pageerror", (error) => errors.push(error.message));
     page.on("request", (request) => {
       if (new URL(request.url()).pathname === "/api/session") requests.push(request.url());
     });
     await page.goto(`${origin}/body-stall/`, { waitUntil: "load" });
     expect(await page.evaluate(() => window.__domContentLoadedSnapshot)).toMatchObject({
       lifecycle: ["endpoint", "controller", "timer", "fetch"],
       bodyConsumption: ["json"],
       timers: [{ fired: false, cleared: false }],
     });
     expect(await page.evaluate(() => window.__loadSnapshot)).toMatchObject({
       lifecycle: ["endpoint", "controller", "timer", "fetch"],
       bodyConsumption: ["json"],
       timers: [{ fired: false, cleared: false }],
     });
     await expectProbeTimer(page, true);
     expect(requests).toHaveLength(1);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents)).toEqual([]);
     expect(errors).toEqual([]);
   });

   test("a truncated JSON response fails silently after one body read", async ({ page }) => {
     const errors = [];
     page.on("pageerror", (error) => errors.push(error.message));
     await page.goto(`${origin}/partial-body/`, { waitUntil: "load" });
     await expectProbeTimer(page, false);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual(["json"]);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents)).toEqual([]);
     expect(errors).toEqual([]);
   });

   test("an offline session request rejects silently", async ({ page }) => {
     const errors = [];
     page.on("pageerror", (error) => errors.push(error.message));
     await page.route("**/api/session?*", (route) => route.abort("internetdisconnected"));
     await page.goto(`${origin}/offline/`, { waitUntil: "domcontentloaded" });
     await expectProbeTimer(page, false);
     await addControls(page);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
     expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
     expect(await display(page, "#reader-fixture")).toBe("none");
     expect(await display(page, "#editor-fixture")).toBe("none");
     expect(errors).toEqual([]);
   });

   for (const [scenario, abortCode] of [
     ["dns-failure", "namenotresolved"],
     ["tls-failure", "failed"],
   ]) {
     test(`${scenario} route-abort surrogate is contained`, async ({ page }) => {
       const errors = [];
       const requests = [];
       page.on("pageerror", (error) => errors.push(error.message));
       page.on("request", (request) => {
         if (new URL(request.url()).pathname === "/api/session") requests.push(request.url());
       });
       await page.route("**/api/session?*", (route) => route.abort(abortCode));
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "load" });
       await expectProbeTimer(page, false);
       expect(requests).toHaveLength(1);
       expect(await page.evaluate(() => window.__fetchCalls.length)).toBe(1);
       expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => window.__sessionEvents)).toEqual([]);
       expect(errors).toEqual([]);
     });
   }

   for (const availability of ["missing", "wrong"]) {
     for (const primitive of ["fetch", "abort-controller", "custom-event", "url"]) {
       test(`${availability} ${primitive} API stays dark and makes no session request`, async ({ page }) => {
         const requests = [];
         const errors = [];
         page.on("request", (request) => requests.push(request.url()));
         page.on("pageerror", (error) => errors.push(error.message));
         await page.goto(`${origin}/${availability}-${primitive}/`, { waitUntil: "domcontentloaded" });
         await addControls(page);
         expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
         expect(await page.locator("html").getAttribute("data-session")).toBeNull();
         expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
         expect(await page.evaluate(() => window.__probeLifecycle)).toEqual([]);
         expect(await page.evaluate(() => window.__probeTimers)).toEqual([]);
         expect(await page.evaluate(() => window.__fetchCalls)).toEqual([]);
         expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
         expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([]);
         expect(requests.some((url) => url.includes("/api/session"))).toBe(false);
         expect(await display(page, "#reader-fixture")).toBe("none");
         expect(await display(page, "#editor-fixture")).toBe("none");
         expect(errors).toEqual([]);
         await expectNoExtraSessionSurface(page);
         await expectSilentProbe(page);
       });
     }
   }

   const docMetaScenarios = new Map([
     ["missing-doc", null],
     ["empty-doc", ""],
     ["whitespace-doc", "   "],
   ]);
   for (const [scenario, expectedContent] of docMetaScenarios) {
     test(`${scenario} returns before timer installation or fetch`, async ({ page }) => {
       const requests = [];
       const errors = [];
       page.on("request", (request) => requests.push(request.url()));
       page.on("pageerror", (error) => errors.push(error.message));
       await page.goto(`${origin}/${scenario}/`, { waitUntil: "domcontentloaded" });
       expect(await page.evaluate(() => document.querySelector('meta[name="doc-id"]')?.getAttribute("content") ?? null)).toBe(expectedContent);
       expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
       expect(await page.evaluate(() => window.__probeLifecycle)).toEqual([]);
       expect(await page.evaluate(() => window.__probeTimers)).toEqual([]);
       expect(await page.evaluate(() => window.__fetchCalls)).toEqual([]);
       expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
       expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([]);
       expect(requests.some((url) => url.includes("/api/session"))).toBe(false);
       expect(errors).toEqual([]);
       await expectNoExtraSessionSurface(page);
       await expectSilentProbe(page);
     });
   }

   for (const [scheme, url] of [["file", fileUrl.href], ["data", dataUrl]]) {
     test(`${scheme} scheme returns before timer installation or fetch`, async ({ page }) => {
       const requests = [];
       const errors = [];
       page.on("request", (request) => requests.push(request.url()));
       page.on("pageerror", (error) => errors.push(error.message));
       await page.goto(url, { waitUntil: "domcontentloaded" });
       expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
       expect(await page.locator("html").getAttribute("data-session")).toBeNull();
       expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
       expect(await page.evaluate(() => window.__probeLifecycle)).toEqual([]);
       expect(await page.evaluate(() => window.__probeTimers)).toEqual([]);
       expect(await page.evaluate(() => window.__fetchCalls)).toEqual([]);
       expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
       expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([]);
       expect(requests.some((requestUrl) => requestUrl.includes("/api/session"))).toBe(false);
       expect(errors).toEqual([]);
       await expectSilentProbe(page);
     });
   }

   test("blob scheme removes stale state before returning without a probe", async ({ page }) => {
     const requests = [];
     const errors = [];
     page.on("request", (request) => requests.push(request.url()));
     page.on("pageerror", (error) => errors.push(error.message));
     const blobUrl = await page.evaluate((body) => URL.createObjectURL(new Blob([body], { type: "text/html" })), nonHttpHtml);
     await page.goto(blobUrl, { waitUntil: "domcontentloaded" });
     expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents)).toEqual([]);
     expect(await page.evaluate(() => window.__probeLifecycle)).toEqual([]);
     expect(await page.evaluate(() => window.__probeTimers)).toEqual([]);
     expect(await page.evaluate(() => window.__fetchCalls)).toEqual([]);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
     expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([]);
     expect(requests.some((requestUrl) => requestUrl.includes("/api/session"))).toBe(false);
     expect(errors).toEqual([]);
     await expectSilentProbe(page);
   });

   test("about scheme removes stale state before returning without a probe", async ({ page }) => {
     const requests = [];
     const errors = [];
     page.on("request", (request) => requests.push(request.url()));
     page.on("pageerror", (error) => errors.push(error.message));
     await page.goto("about:blank");
     await page.setContent(nonHttpHtml, { waitUntil: "domcontentloaded" });
     expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents)).toEqual([]);
     expect(await page.evaluate(() => window.__probeLifecycle)).toEqual([]);
     expect(await page.evaluate(() => window.__probeTimers)).toEqual([]);
     expect(await page.evaluate(() => window.__fetchCalls)).toEqual([]);
     expect(await page.evaluate(() => window.__sessionBodyConsumption)).toEqual([]);
     expect(await page.evaluate(() => window.__sessionEndpointConstructions)).toEqual([]);
     expect(requests.some((requestUrl) => requestUrl.includes("/api/session"))).toBe(false);
     expect(errors).toEqual([]);
     await expectSilentProbe(page);
   });

   test("module evaluation removes a pre-existing session hint before a signed-out response", async ({ page }) => {
     await page.goto(`${origin}/stale-session/`, { waitUntil: "domcontentloaded" });
     expect(await page.evaluate(() => window.__preexistingSession)).toBe("editor");
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     await expectProbeTimer(page, false);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
   });

   test("a new navigation probes again instead of reusing session state", async ({ page, request }) => {
     await page.goto(`${origin}/legacy-editor/`, { waitUntil: "domcontentloaded" });
     await expect.poll(() => page.locator("html").getAttribute("data-session")).toBe("editor");
     await page.goto(`${origin}/signed-out/`, { waitUntil: "domcontentloaded" });
     await expectProbeTimer(page, false);
     expect(await page.locator("html").getAttribute("data-session")).toBeNull();
     expect(await page.evaluate(() => window.__sessionEvents.length)).toBe(0);
     const counts = await (await request.get(`${origin}/_counts`)).json();
     expect(counts["legacy-editor"]).toBeGreaterThanOrEqual(1);
     expect(counts["signed-out"]).toBeGreaterThanOrEqual(1);
   });
   SPEC

   install -m 600 /dev/stdin "$P2C_TEST_ROOT/playwright.config.mjs" <<'CONFIG'
   import { defineConfig } from "@playwright/test";
   export default defineConfig({
     testDir: ".",
     testMatch: "session.spec.mjs",
     workers: 1,
     retries: 0,
     reporter: "line",
     use: { browserName: "chromium", headless: true },
   });
   CONFIG

   npm install --prefix "$P2C_TEST_ROOT" --ignore-scripts --no-package-lock --no-save \
     @playwright/test@1.55.0 acorn@8.15.0 >/dev/null
   PLAYWRIGHT_BROWSERS_PATH="$P2C_TEST_ROOT/browsers" \
     "$P2C_TEST_ROOT/node_modules/.bin/playwright" install chromium >/dev/null

   P2C_HTML="$P2C_TEST_ROOT/document.html" \
     P2C_PORT_FILE="$P2C_TEST_ROOT/port" \
     node "$P2C_TEST_ROOT/server.mjs" >"$P2C_TEST_ROOT/server.log" 2>&1 &
   P2C_SERVER_PID=$!
   for _ in $(seq 1 100); do
     [[ -s "$P2C_TEST_ROOT/port" ]] && break
     kill -0 "$P2C_SERVER_PID"
     sleep 0.05
   done
   test -s "$P2C_TEST_ROOT/port"
   P2C_PORT="$(cat "$P2C_TEST_ROOT/port")"

   (
     cd "$P2C_TEST_ROOT"
     P2C_ORIGIN="http://127.0.0.1:$P2C_PORT" \
       P2C_HTML="$P2C_TEST_ROOT/document.html" \
       PLAYWRIGHT_BROWSERS_PATH="$P2C_TEST_ROOT/browsers" \
       "$P2C_TEST_ROOT/node_modules/.bin/playwright" test --config playwright.config.mjs
   )

   stop_server
   trap - EXIT HUP INT TERM
   test "${P2C_TEST_ROOT%/*}" = "$P2C_TEMP_PARENT"
   test "${P2C_TEST_ROOT##*/}" = p2-c-browser.??????
   test ! -e package-lock.json
   test ! -e node_modules
   echo 'PASS  P2-C browser fixture cleaned'
   P2C_BROWSER_BODY
   BASH
   ```

   Expected: before npm work, the supervisor prints exactly `PASS  P2-C supervisor handles external early/initializing HUP/INT/TERM`, `PASS  P2-C supervisor bounds deletion and retains evidence on persistence failure`, `PASS  P2-C supervisor terminates a timed-out descendant group`, `PASS  P2-C supervisor handles TERM with bounded escalation and reaping`, `PASS  P2-C supervisor preserves natural child signal statuses`, `PASS  P2-C supervisor gives external terminal signals final authority`, `PASS  P2-C supervisor contains an operational exception and proves cleanup`, and `PASS  P2-C supervisor removes descendants after their parent exits`, in that order. Playwright then reports every enumerated test passed; no fixed test-count claim is used because the scenario arrays are the authoritative inventory. AST checks prove the source has no top-level await, one bare fetch call, no qualified/computed global fetch access, the enumerated API/vendor exclusions, one strict `response.status !== 200` guard before header access, and an adjacent timer/fetch shape with the sole matching clear in the encompassing `finally`. Runtime request cases prove one endpoint construction, one timer, one fetch invocation, one clear, and the observable `endpoint`, `controller`, `timer`, `fetch`, optional `abort`, `clear` order; the legacy case proves the exact options. The final-session matrix proves both exact compatibility-role values, all five P2-G roles, requested-document equality, required primitive booleans, and fail-dark rejection for every missing/wrong-type common or final field, partial/mixed final presence, wrong document, unknown role, and invalid final roles length/value combination. Valid final extensions and the compatibility array remain the same parsed, recursively frozen event object. The controlled body-stall case starts one real request but supplies its accepted-header/body-pending response to the probe immediately, so both DOM lifecycle snapshots record the pending `json` read before the same signal aborts the fixture body and network request. The module-tail snapshot plus the AST check prove synchronous startup without task, microtask, lifecycle, or top-level-await deferral. Pre-parse failures, including `201 application/json`, prove zero access to response body properties, cloning, construction, all named consumption methods, stream readers, tees, pipes, and iteration; malformed/truncated JSON alone records the one allowed `json` access. Both allowed protocols probe; `file:`, `data:`, `blob:`, and `about:` plus missing metadata and missing/truthy-wrong primitives remove stale state without constructing the endpoint. The direct Content-Type parser matrix proves outer SP/HTAB and representative non-SP/HTAB rejection, while the HTTP matrix proves observable internal OWS/case/quote classes and normalization-safe outer behavior. Synchronous fetch throw, asynchronous rejection, offline, DNS/TLS route-abort surrogate, CSP, partial-body, body-stall, status, media-type, JSON, and shape failures produce no script console call, page error, unhandled rejection, reveal, or event. Same-turn mutation records, the exact 256-object nested freeze fixture, exact request options, keyboard/AX visibility, fixture focus/theme and real deep-link/disclosure preservation, long-horizon no-retry behavior, and the enumerated before/tail/settled no-extra-signal/storage surface all pass. These are finite named oracles, not universal proofs against unenumerated browser APIs or engine limits. The final line is exactly `PASS  P2-C browser fixture cleaned`.
   HUP/INT/TERM handlers are registered before any guarded-root creation. Real external-signal probes address separate owner processes before and during initialization for all three signals and require exact 129/130/143 status with no residue. Once a guarded root exists, the supervisor immediately persists mode-`0600` preparing ownership. The nested cleanup trap bounds and reaps the fixture server. The outer supervisor first starts a retained, positive group-leading launcher and waits for its private `anchor-ready` handshake; the launcher cannot spawn npm, Chromium, the fixture server, or Playwright until mode-`0600` running ownership is durably published and the supervisor sends `go`. Containment revalidates that this direct-child anchor is still live before each group-wide TERM or KILL and never signals a numeric PGID after the anchor exits; it reaps the anchor and proves group disappearance before root deletion. Natural child termination has the closed tested mapping `SIGHUP` 129, `SIGINT` 130, `SIGTERM` 143, and `SIGKILL` 137; an unknown reported signal fails closed as 1. The first external HUP/INT/TERM is authoritative through post-worker handling, group containment, root removal, deletion failure, and the final-success window; a later signal cannot replace its 129/130/143 status. Recursive root deletion runs in a separately reaped worker with a 10-second deadline and bounded KILL fallback. A deletion timeout, failure, or unreaped worker retains the guarded root and its last mode-`0600` ownership record and prints exactly `ERROR  P2-C browser cleanup could not be proven; guarded-root=<validated path or not-applicable> evidence-path=<private artifact or not-applicable> supervisor-pid=<positive PID or not-applicable> leader-pgid=<positive PGID or not-applicable>; manual remediation required`. Evidence updates use a mode-`0600` temporary artifact and atomic rename; if an update fails, the supervisor fails closed while preserving the last durable record and the same exact locator. Deterministic probes cover all external initialization and terminal-window signals, bounded deletion and forced evidence-update failure, a TERM-resistant timeout descendant, TERM-to-KILL escalation, all four natural child signals, an operational exception, and a delayed descendant after parent exit; they require anchor reaping, group disappearance, deletion-status precedence, exact retained remediation, and zero probe residue. Successful group cleanup persists a contained record until bounded root deletion succeeds. The browser download, dependency tree, fixture server, and response logs remain outside the repository on every path.

4. Run the repository-wide deterministic-build, type, publication, and patch gates after including the command-generated shared artifacts in the candidate integration commit:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   templates/build example
   templates/build templates/components
   templates/check-dist
   npm --prefix templates/docbuild run check
   scripts/scrub-check.sh docs/tickets/P2-C.md templates/base/session.js templates/base/session.css
   git diff --check
   BASH
   ```

   Expected: both real document builds exit `0`, name their generated HTML, and report balanced tags; every later command exits `0`; `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; typecheck emits no diagnostics; scrub-check ends with `PASS  no denied term and no warning.`; and patch checking emits no output.

5. On the isolated P2-C branch and in the same shell that ran the pre-authoring command, resolve the recorded `P2C_BASE` to its canonical commit and mechanically reject every changed path except P2-C's two owned implementation sources, this ticket document, and the two command-generated document artifacts:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   export P2C_BASE="$(git rev-parse --verify "${P2C_BASE:?run the pre-authoring P2C_BASE command}^{commit}")"
   git merge-base --is-ancestor "$P2C_BASE" HEAD
   for path in templates/base/session.js templates/base/session.css; do
     if git cat-file -e "$P2C_BASE:$path" 2>/dev/null; then
       printf 'FAIL  P2-C source existed at base: %s\n' "$path" >&2
       exit 1
     fi
     if ! git ls-files --error-unmatch "$path" >/dev/null \
       || [[ "$(git diff --name-only --diff-filter=A "$P2C_BASE" -- "$path")" != "$path" ]]; then
       printf 'FAIL  P2-C source is not a tracked addition: %s\n' "$path" >&2
       exit 1
     fi
   done
   unexpected="$({
     git diff --name-only --diff-filter=ACDMRTUXB "$P2C_BASE"
     git ls-files --others --exclude-standard
   } | LC_ALL=C sort -u | while IFS= read -r path; do
     case "$path" in
       templates/base/session.js|templates/base/session.css|docs/tickets/P2-C.md) ;;
       example/dist/example.html|templates/components/dist/components.html) ;;
       *) printf '%s\n' "$path" ;;
     esac
   done)"
   if [[ -n "$unexpected" ]]; then
     printf 'FAIL  P2-C changed an unowned path:\n%s\n' "$unexpected" >&2
     exit 1
   fi
   test ! -e package-lock.json
   test ! -e node_modules
   test -z "$(find . -maxdepth 1 -name 'p2-c-*' -print -quit)"
   echo 'PASS  P2-C owns every changed implementation path'
   BASH
   ```

   Expected: all quiet assertions exit `0`, both owned sources are tracked additions relative to the exact recorded base, no unexpected path is printed, and the final line is exactly `PASS  P2-C owns every changed implementation path`. Run this ownership proof before combining P2-C with any other phase-2 source branch.

### Publication pointer integrity gate

Run this after the canonical document commit is pushed and issue #8's pointer is published:

```bash
set -euo pipefail
pointer_json="$(mktemp "${TMPDIR:-/tmp}/p2c-pointer.XXXXXX")"
trap 'rm -f -- "$pointer_json"' EXIT HUP INT TERM
chmod 600 "$pointer_json"
gh issue view 8 --repo aiur-team/architecture-docs --json title,body >"$pointer_json"

node --input-type=module - "$pointer_json" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
const expectedTitle = "P2-C — The session probe and the reveal rules";
const expectedPath = "docs/tickets/P2-C.md";
assert.equal(issue.title, expectedTitle);
const pointer = /^Implementation specification: \[`([^`]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40,64})\/([^)]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
assert.ok(pointer, "issue body must be the exact two-paragraph canonical-document pointer");
const [, labelPath, commitSha, linkedPath] = pointer;
assert.equal(labelPath, expectedPath);
assert.equal(linkedPath, expectedPath);
assert.equal(
  issue.body,
  `Implementation specification: [\`${expectedPath}\`](https://github.com/aiur-team/architecture-docs/blob/${commitSha}/${expectedPath})\n\nThis issue tracks implementation of the linked canonical specification.`,
);
const resolvedSha = execFileSync("git", ["rev-parse", "--verify", `${commitSha}^{commit}`], { encoding: "utf8" }).trim();
assert.equal(resolvedSha, commitSha, "issue pointer must contain the full commit SHA");
assert.deepEqual(execFileSync("git", ["show", `${commitSha}:${linkedPath}`]), readFileSync(expectedPath));
console.log("PASS  P2-C issue #8 pointer resolves to the byte-identical canonical document");
NODE
```

Expected: the command exits `0`, the issue title and exact two-paragraph body pass, the parsed path is exactly `docs/tickets/P2-C.md`, the object ID is the full commit SHA, and the final line is `PASS  P2-C issue #8 pointer resolves to the byte-identical canonical document`. The mode-`0600` issue JSON file is removed by the trap.

## Failure modes

### Handled

- A document opens from `file://`, `data:`, or another non-HTTP(S) scheme: the protocol gate returns before timer installation or `fetch()`.
- The doc-id meta element is absent or its content is empty/whitespace-only: the module returns before timer installation without guessing from a slug, path, or directory name.
- The browser lacks `fetch`, `AbortController`, `CustomEvent`, or `URL`, or exposes a truthy non-function at one of those globals: the feature stays dark instead of throwing.
- The server has no session: 401 is not parsed and the document remains static.
- The API route is absent on a plain static host: 404 is a silent non-success.
- The endpoint redirects unexpectedly: redirect rejection enters the silent catch path.
- The endpoint delays headers or accepts the request and then stalls its body: the single request aborts after 2000 ms and the timer is cleared once in `finally`; the lifecycle/body-pending ordering is proved with the named controlled-response surrogate, not generalized to native network scheduling.
- The browser is offline, a DNS/TLS-style route rejection or connection failure occurs, CSP blocks the request, or the body is truncated: the rejection is swallowed and no stale session is used. The fixture's DNS/TLS labels are deterministic rejection surrogates, not live infrastructure tests.
- The endpoint returns any non-200 status, including `201` with otherwise valid JSON, an unexpected content type, invalid JSON, an invalid legacy shape, or a partial/mixed/wrong-type/wrong-document final shape: no root hint and no event are produced.
- P1-C has no `canSuggest`: `canEdit` supplies the temporary reveal meaning.
- P3-H adds the complete reserved field set and narrower direct-edit semantics: only the full exact-document schema is accepted, `canSuggest` takes precedence, compatibility `roles` is exactly member-or-guest and presentation-only, and every parsed field reaches listeners unchanged and frozen.
- HUP/INT/TERM arrives before guarded-root creation: the installed handler records the conventional status and the shared initializer creates nothing; a signal observed during creation removes only the validated new root, or retains and names it if removal fails.
- HUP/INT/TERM arrives after a normal command result but before final exit: the first observed signal immediately becomes the pending 129/130/143 exit code, overrides the selected result after group containment, and is rechecked after root removal; a later terminal signal cannot replace it, and this path cannot exit 0.
- npm, Chromium installation, the fixture server, or Playwright hangs, receives HUP/INT/TERM, exits naturally by HUP/INT/TERM/KILL, or triggers a supervisor operational exception: the outer supervisor gates worker launch behind durable ownership, owns the retained launcher group, preserves the closed 128-plus-signal status for natural child termination, performs bounded TERM-to-KILL and reaping without signaling a stale PGID, and starts bounded root deletion only after group disappearance. An unproved terminal or deletion state keeps mode-`0600` actionable ownership evidence and prints the exact safe locator for manual remediation.
- A marked downstream element also has `hidden`: it stays hidden after authentication.
- An authenticated page is printed: both marked capability groups are suppressed.

### Deliberately not handled

- A session, grant, or role changes while the document remains open: there is no refresh, polling, or second event; the next server action still authorizes independently and a new navigation re-probes.
- A page restored from the browser back-forward cache retains its presentation hint: server authority still applies, and bfcache-specific revalidation would violate this ticket's one-probe/one-event contract.
- A downstream listener attaches after the event: there is no replay store; P1-B's module order is the supported registration mechanism.
- A downstream module treats the root attribute or event as authority: that is a defect in the downstream module and must fail its server-side permission tests.
- A trusted inlined source contains a literal closing `</script>` sequence: P1-B owns slot embedding and feature sources must not contain one.
- A browser without JavaScript module support: P1-B's optional module does not run, while default CSS keeps capability controls hidden and the document stays readable.
- Login, logout, password recovery, session renewal, token refresh, account creation, or a signed-out call to action.
- Error telemetry or user-facing outage messaging; silent static degradation is the product requirement.

## Settled decisions

- Netlify Identity and Functions v2 remain the only session source; browser Identity SDKs, manual JWT parsing, GitHub OAuth, and Auth0 are not introduced.
- There is one session probe, one root attribute, and one lowercase `session` event whose detail is the same recursively frozen parsed JSON object for every listener.
- The permanent `doc.json` id, exposed through `<meta name="doc-id">`, is the only document key; a slug, URL segment, or instance directory is never substituted.
- `?doc=` is present from P2-C onward so P3-H can make the endpoint document-aware without a second client revision.
- `data-session="editor"` means suggestion capability, not the literal document role and not direct-edit authority.
- The P3-H `canSuggest` field supersedes P1-C's temporary reveal use of `canEdit`; the compatibility fallback exists only when `canSuggest` is absent.
- Any own reserved final field commits validation to the complete P3-H shape. Its `doc` is bound byte-for-byte to the requested permanent id, its role is a P2-G `DocumentRole`, all projected capabilities are required booleans, and final compatibility `roles` is exactly `["member"]` or `["guest"]`, never empty.
- Every response field used by another client module travels through the event unchanged; P2-C neither derives document roles nor projects capabilities, and compatibility `roles` remains presentation-only.
- Loading, signed-out, and every degraded result share one plain-document state with no status attribute, error UI, or event.
- `file://` and non-HTTP(S) embeddings make no request; network and cache failure never activate a feature.
- The session request is same-origin, credentialed, no-store, redirect-rejecting, abortable after two seconds, and never retried.
- Probe startup occurs during module evaluation without a lifecycle listener or top-level `await`; the exact JSON Content-Type grammar is checked before any response-body consumption.
- `[data-reader-only]` and `[data-editor-only]` are the only generic reveal markers; later feature modules own finer conditional creation and semantic `hidden` states.
- Client hints never authorize. Every mutating server path independently runs identity, origin, and document-capability checks.
- The page gains no runtime dependency, alternate global, second event bus, or persistent client session cache.
- P2-C creates only its two base assets and consumes P1-B's slots; it does not reopen shared builder, layout, application, or component files.
- Playwright Chromium is the P2-C executable browser gate; the AST gate rejects the named alternate/vendor surfaces but is not a universal standards whitelist, and cross-engine expansion is downstream integration work.
- One 1200-second detached-group supervisor owns the complete disposable browser workflow. Durable preparing/running evidence and the launcher's private readiness/`go` handshake precede worker spawn; the retained anchor remains the current direct-child group owner through TERM/KILL, reaping, and group-disappearance proof, after which separately bounded root deletion either succeeds or retains actionable remediation evidence.
- A finite negative matrix proves the enumerated equivalence classes only; it does not claim to enumerate every failure representation exposed by every browser or network stack.

## Assumptions and open questions

### Assumptions

- **Non-blocking:** P1-C's rule that unknown query parameters are ignored makes `GET /api/session?doc=<docId>` valid before P3-H lands; P3-H can adopt the parameter without changing P2-C.
- **Non-blocking:** A successful current or future session body retains the common `sub`, `email`, `name`, `roles`, `canComment`, and `canEdit` fields documented by P1-C and P3-H. Non-reserved extension fields remain forward-compatible; presence of any reserved final field requires the full P3-H shape.
- **Non-blocking:** The success-only dispatch rule means a 200 with the wrong content type or an invalid legacy/final shape is degradation, not a partially authenticated state.
- **Non-blocking:** The research rule `display: revert` is narrowed with `:not([hidden])` so authentication never defeats an element's semantic `hidden` state; later modules use `hidden` for post-reveal availability.
- **Non-blocking:** Print suppression belongs in the generic reveal stylesheet so an already-authenticated page cannot print interaction-only controls before feature-specific print rules exist.
- **Non-blocking:** `redirect: "error"` completes the silent failure contract for an unexpectedly redirected API and prevents a login HTML response from being treated as a session.

### Open questions

None. If implementation cannot preserve the one-probe/one-event contract inside the two owned files, stop rather than widening the source surface.

## References

- `HANDOFF.md`, "Non-negotiable: this repository becomes public," "What done means for a ticket here," and "Decisions that are already made."
- `README.md`, "Checks" and "The platform."
- `docs/research/00-integration-plan.md` §1.2 for the one probe, root attribute, event, and no-client-authority ruling; §2.9 for the session response; §4.1 for P1-B's slots and module order; §4.4 for P2-C ownership; §4.7 for downstream session consumers; and §6 agreement 4 for silent offline/artifact degradation.
- `docs/tickets/P1-B.md`, "Placeholder and file mapping," "The emitted script/data order," and the P2-C dependency row for the exact slot and listener-before-probe boundaries.
- `docs/tickets/P1-C.md`, "GET /api/session" for method, status, response, and cache behavior, and "Dependencies" for the initial P2-C response boundary.
- `docs/prompts/rewrite-tickets.md` — canonical-document publication contract and exact two-paragraph issue-pointer form.
- `docs/research/02-auth.md` §3.2 for the two-second probe, default-hidden reveal model, `file:` guard, silent artifact behavior, and the single downstream event.
- `docs/research/07-realtime-and-presence.md` §8.3 and §9 for the session event as the only realtime start signal and for no-broker/offline degradation.
- `docs/research/09-sharing-and-roles.md` §3.4 for `canSuggest` superseding the old reveal meaning of `canEdit`, and §7.2–7.4 for listener-only share startup and absence in unsupported contexts.
- [WHATWG HTML Standard, `script` element](https://html.spec.whatwg.org/multipage/scripting.html#the-script-element) and [parsing completion](https://html.spec.whatwg.org/multipage/parsing.html#the-end) for non-async module execution after parsing and in parser order.
- [WHATWG Fetch Standard, request credentials and cache modes](https://fetch.spec.whatwg.org/#requests) for `same-origin`, `no-store`, redirect mode, and `AbortSignal` request plumbing.
- [WHATWG DOM Standard, `CustomEvent`](https://dom.spec.whatwg.org/#interface-customevent) and [`AbortController`](https://dom.spec.whatwg.org/#interface-abortcontroller) for the event-detail and abort contracts.
