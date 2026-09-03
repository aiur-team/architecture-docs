# P3-C — The comments client, read only

## Outcome

An authenticated reader can inspect comment threads and unanchored discussions in a keyboard-accessible side panel. Open anchored comments are represented by a margin marker and, where the quoted text still resolves, a non-mutating CSS Custom Highlight. Every anchored thread is classified as exactly `exact`, `drifted`, `moved`, or `orphaned`; degraded matches are labelled, ambiguous matches are never guessed, and a document opened outside HTTP(S) remains the unchanged static artifact.

## Context

P1-D gives each rendered prose block a stable `data-aid` and publishes the canonical browser-safe `window.doc.anchor = { BLOCK, norm, scanBlocks }`. P2-C publishes one valid, recursively frozen session object through the lowercase `session` event after all feature modules have installed their listeners. P3-A supplies the authenticated thread-list endpoint. This ticket consumes those seams without reopening their files or treating any browser-visible state as authorization.

Anchoring has two independent layers. The builder preserves block identity; this client resolves the stored text quote within the current block. When either layer fails, the interface must state what failed instead of silently moving a comment. The client never wraps prose in `<mark>` or any other element because DOM mutation would change the text-node boundaries on which all live ranges depend.

The current platform basis is explicit. The CSS Custom Highlight API styles registered `Range` objects without changing the DOM and is Baseline across current browsers since June 2025. Older engines receive a block-border fallback, not a polyfill. `TreeWalker` with `NodeFilter.SHOW_TEXT` supplies descendant text nodes, and `Range` offsets in a `Text` node are character offsets represented by JavaScript's UTF-16 string indexing. The document-level `visibilitychange` event is used only when the document becomes visible; there is no interval or background poll.

All example people, documents, ids, text, addresses, and hosts in this ticket are invented public fixtures. No fixture may be replaced with private prose, a production response, a real account, a credential, or a copied discussion.

## Scope

### In scope

- Create the optional `templates/base/comments.js` module and `templates/base/comments.css` stylesheet consumed by P1-B's existing slots.
- Wait for P2-C's one `session` event, then issue authenticated, same-origin, GET-only reads of a deterministic prefix of at most five P3-A cursor pages for the document.
- Validate every page envelope and every retained thread/comment completely before replacing the last good in-memory view; valid state beyond the explicit display budgets is ignored and disclosed, not rejected.
- Implement the exact `textMap()`, quote scoring, `rangeFor()`, and `locate()` algorithms specified below using P1-D's exact `norm()` implementation.
- Compute, display, and test all four anchored states: `exact`, `drifted`, `moved`, and `orphaned`.
- Render open exact/moved ranges with the CSS Custom Highlight API and render a non-mutating block-border fallback when that API is absent.
- Create one internal margin rail, one read-only panel, deterministic filters, thread cards, discussion cards, and the explicit orphan group.
- Publish one callable refresh seam, `window.doc.comments.refresh()`, for later realtime callers.
- Refresh when a hidden document becomes visible, throttled to at most one visibility-triggered call in each 30-second window; do not poll.
- Preserve the static document on `file:`, `data:`, `blob:`, `about:`, a missing prerequisite, a missing session, and an initial read failure.
- Prove the source and behavior with deterministic DOM/browser fixtures run below a bounded, retained process-group owner.

### Out of scope

- Creating or amending the thread API, thread schema, store helper, identity, session, gate, or server authorization. P3-A and its prerequisites own those surfaces.
- Any write request or write affordance: no new comment, start-discussion, reply, edit, resolve, reopen, delete, form, textarea, selection tooltip, draft, or `contenteditable` behavior. P4-A amends `comments.js` for the comment write path.
- Publishing `window.doc.rail` or `window.doc.panel`, registering suggestion renderers, adding a Suggestions filter, or reacting to `doc:overlay`. P4-Q amends both owned files for that shared surface, after P4-A.
- Subscribing to realtime, listening for `doc:event`, opening a socket or event stream, or interpreting `thread.changed`. P3-F owns transport and calls the refresh seam exposed here.
- Applying edit overlays. P1-B's script order places `EDIT_JS` before `COMMENTS_JS`; later edit code must finish its initial overlay before this ticket resolves anchors.
- Selection anchoring or constructing an anchor for a new thread. P4-A owns that write-oriented inverse of `textMap()`.
- Fuzzy, case-insensitive, stemmed, semantic, XPath, CSS-path, or ordinal relocation.
- Marking threads read, persisting UI state, notifications, unread counts, or any use of cookies, `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, or a service worker.
- Adding a framework, runtime dependency, bundler, polyfill, static panel markup, a new layout placeholder, another global object, or another session probe.
- Editing P1-B, P1-D, P2-C, P2-D, P3-A, generated HTML, or any file outside the two owned assets.

### Safe implementation waves

1. **Pure anchor wave:** implement response validation, `textMap()`, `rangeFor()`, context scoring, block indexing, and `locate()` without creating interface elements or making a request. Exercise them through the browser fixture's rendered outcomes; do not add a production test global.
2. **Read-only rendering wave:** add the private thread model, highlight registry, fallback classes, rail, panel, filters, ordering, state labels, and accessibility behavior. Render only invented fixture data through `textContent`.
3. **Lifecycle wave:** add the one-shot session activation, bounded GET, callable refresh, stale-response handling, visibility throttle, and fail-dark environment gates. Keep every request GET-only.
4. **Integration wave:** embed both assets through P1-B, build both committed public instances, run deterministic Chromium behavior, prove process cleanup, and then run the repository gates. A wave may advance only when its preceding focused assertions pass.

## Interface contract

### Module activation and immutable prerequisites

P1-B emits the compiled anchor core first, then edit, then comments, and emits session last. `comments.js` is an inline ES module with no `async` attribute. During module evaluation it must perform only these checks, in this order:

1. Return unless `location.protocol` is exactly `http:` or `https:`.
2. Read and trim `meta[name="doc-id"]`'s `content`; return if absent or empty.
3. Return unless `window.doc` is a non-null object and `window.doc.anchor` supplies `BLOCK` as an array and `norm` as a function. Bind the exact published `norm`; do not copy `s.replace(/\s+/g, " ").trim()` into this file.
4. Return unless `fetch`, `AbortController`, `CustomEvent`, `NodeFilter`, `Range`, `requestAnimationFrame`, `performance.now`, and `document.createTreeWalker` expose the required platform primitives.
5. Return rather than overwrite if `window.doc.comments` is already non-null.
6. Install `window.doc.comments` and the `session` listener. Do not create UI or issue a request yet.

The installed public seam is exactly:

```js
window.doc.comments = Object.freeze({ refresh });
```

`refresh()` takes no arguments and returns `Promise<boolean>`. It resolves `true` when its batch validates and commits at least one fresh list response, and `false` when the client is not activated or no fresh response is committed. It never rejects. It is safe to call before the session event and then resolves `false` without constructing an endpoint.

The listener is registered on `document` for the exact lowercase `session` event with `{ once: true }`. A non-null object detail activates the client; the module stores only an `activated` boolean, not the session object, and immediately calls `refresh()`. It does not inspect `data-session`, infer a document role, inspect an email/domain, or require `canComment`: every authenticated document reader may read existing discussion, while write authorization remains server-owned. A forged event can cause only the same authenticated GET; it cannot grant API access or produce a write.

P3-C keeps its rail and panel controllers in module scope. It must leave P1-B's `window.doc.rail` and `window.doc.panel` values as `null`. P4-Q, sequenced after P4-A, later publishes those two interfaces and adds `doc:overlay` re-resolution.

### Thread-list read and validation

Each network pass constructs this same-origin endpoint from the current page URL:

```js
const endpoint = new URL("/api/threads", location.href);
endpoint.searchParams.set("doc", docId);
endpoint.searchParams.set("limit", "100");
```

It makes one through five sequential fetches for the pass under one five-second abort deadline. The first uses the endpoint above. After each accepted page whose `nextCursor` is non-null, create a fresh URL from that same base, set `cursor` to the exact returned value, and fetch it with the same options unless one of the stop rules below has already made the pass a successful partial view. Never construct a cursor from array length, time, DOM state, or the last locally sorted item; never issue page requests in parallel.

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

The timer is created immediately before the first fetch and cleared in a `finally` that covers every page, status check, JSON consumption, validation, anchor resolution, and render commit. Only status `200` is parsed. There is no retry inside one network pass. A synchronous throw, rejection, abort, non-200 response on a fetched page, invalid JSON, invalid used shape, cursor cycle/regression, or cross-page duplicate among retained threads resolves the entire pass as `false` without committing the candidate prefix, console call, or unhandled rejection. A `401` or `403` on any fetched page uses the terminal behavior below. A valid fifth-page non-null cursor, valid state beyond 500 retained threads, or valid state beyond 5000 retained comments never fails the pass solely because it exceeds a client display budget. A retained thread with 501 comments instead violates P3-A's response cap and fails validation.

Each fetched page is a plain object with exactly own enumerable data keys `threads` and `nextCursor`; `threads` is a dense JSON array of at most 100 items and `nextCursor` is `null` or a string matching `^t_[a-z0-9]{1,48}_[0-9a-f]{8}$`. For every retained or boundary thread in the page, ids are in strictly ascending JavaScript string order. An empty page is valid only with a null cursor. A non-null cursor is valid with any positive page length through 100 and must equal the page's final thread id: P3-A may return fewer than the requested 100 when its 5000-comment response budget stops the page. Validating that final id does not retain or render the final record when a client total-comment stop has already cut the retained prefix before it. Every retained or boundary thread on a later page must sort after the prior cursor. Reject a duplicate id among retained or boundary threads. JSON parsing itself necessarily materialises one server-bounded page; after parsing, never clone or concatenate raw pages, retain at most 500 projected threads and 5000 projected comments, and release each page before fetching the next.

The deterministic display budgets and stop rules are exact:

1. **Fetch/page budget:** fetch at most five pages of at most 100 threads. If the fifth valid page has non-null `nextCursor`, commit its validated retained prefix and stop without fetching page six. The global truncation flag is set.
2. **Thread budget:** retain at most 500 threads, always the server-order prefix. This equals five full 100-thread pages, but P3-A may return a shorter non-final page when its comment budget binds. Never sample, locally resort, or replace earlier records with later ones.
3. **Per-thread comment budget:** P3-A caps every returned thread at 500 comments. For each retained thread, require `1 <= comments.length <= 500`, then fully validate and project every comment. A retained 501-comment thread is a malformed P3-A response and fails the candidate pass; there is no per-thread ignored tail or per-thread truncation UI.
4. **Per-page parsed bound:** P3-A caps every GET page at 100 threads and 5000 total comments. This makes the one already-parsed response object finite before P3-C applies its own retained-view budget. While the client is still consuming a page, fully validated retained comment counts may not exceed 5000 for that page.
5. **Total retained-comment budget:** retain at most 5000 comments across the whole pass in server/page order. When the retained count is already 5000, do not inspect another record; a non-null cursor or remaining page tail makes the view partial. Otherwise completely validate the next thread, including its `comments` array. If that valid boundary thread would exceed the remaining total budget, do not retain it or any later thread, do not fetch a later page, and set the global truncation flag. If a retained thread brings the total to exactly 5000, a remaining page tail or non-null cursor likewise stops the pass as a successful partial view. Thus every retained thread is complete and has its first comment; no partial or empty card is synthesized.

Validation has an explicit used/boundary/ignored split. Every fetched page envelope and cursor is validated. Every retained thread's complete top-level record and every retained comment are validated by the exact rules below. When the client still has comment capacity, the first candidate thread that would cross the remaining capacity is also completely validated before it becomes the omitted boundary thread; a malformed boundary thread therefore fails the pass. The first-comment equivalence is always checked for retained and boundary threads. Only the page tail after that boundary, or the whole remaining tail once the retained count already equals 5000, is ignored. For an ignored tail, inspect only `threads.length` and, when needed for a non-null cursor invariant, require the final item to be a non-null object with an own string `id` matching the thread-id grammar and byte-equal to `nextCursor`; do not inspect any other ignored item or field. No later page is fetched after the rule fires. Ignored tail values may be malformed and cannot affect DOM, ordering, counts, ids other than that final cursor proof, anchors, highlights, logs, selectors, or URLs. A malformed retained or boundary value fails the candidate pass; an ignored value is outside this bounded client view and cannot make an otherwise usable prefix fail. This bounded-tail rule relies on P3-A's 500-comments-per-thread and 5000-comments-per-page response admission so JSON parsing itself is not an unbounded client boundary.

Every retained array item is a complete P3-A version-1 record, without compatibility aliases or defaulted fields:

- The thread is a plain object with exactly the 14 keys `v`, `id`, `docId`, `kind`, `status`, `section`, `anchor`, `title`, `docVersion`, `createdAt`, `author`, `resolvedAt`, `resolvedBy`, `comments`; `v === 1`; `id` matches `^t_[a-z0-9]{1,48}_[0-9a-f]{8}$`; `docId` matches `^[0-9a-f]{6}$` and equals the trimmed document-id meta value byte-for-byte; `section` matches `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`; and `docVersion` matches `^[0-9a-f]{7}$`.
- A timestamp matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` and satisfies `new Date(value).toISOString() === value`. This exact rule applies to thread/comment `createdAt`, non-null `editedAt`, and non-null `resolvedAt`.
- An actor is a plain object with exactly `sub`, `name`, `email`. `sub` matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; `name` is a string of at most 200 UTF-16 code units. `email` is either empty or already ASCII-trimmed/lower-case, at most 254 characters, and has exactly one `@`; its local part has 1 through 64 characters from lower-case ASCII letters, digits, or ``.!#$%&'*+=?^_`{|}~-``; its domain has at least two dot-separated labels, each 1 through 63 lower-case ASCII alphanumeric-or-hyphen characters and beginning/ending alphanumeric. Comma, colon, slash, backslash, control, whitespace, quoted-local, and Unicode-domain forms are invalid. Email is never rendered.
- `kind` is exactly `comment` or `discussion`; `status` is exactly `open` or `resolved`. An open thread has `resolvedAt: null` and `resolvedBy: null`; a resolved thread has a valid timestamp and complete actor.
- `comments` is a non-empty dense JSON array of at most 500 items. Every entry in a retained thread is a plain object with exactly `id`, `body`, `author`, `createdAt`, `editedAt`; `id` matches `^c_[a-z0-9]{1,48}_[0-9a-f]{8}$` and is unique in the thread; `body` is 1 through 8000 UTF-16 code units and `body.trim().length > 0`; `author` and timestamps follow the rules above; `editedAt` is `null` or a valid timestamp. The first comment's author fields and `createdAt` equal the top-level author fields and `createdAt` exactly.
- A comment thread has `title: null` and an `anchor` plain object with exactly `block`, `exact`, `prefix`, `suffix`, `start`. `block` matches the canonical `^a[0-9a-f]{8}$`; `exact` is 1 through 1000 UTF-16 code units and equals `exact.replace(/\s+/g, " ").trim()`; `prefix` and `suffix` are 0 through 32 code units, contain only non-whitespace characters separated by single U+0020 spaces with no doubled space, and may retain one boundary space; `start` is a non-negative safe integer.
- A discussion has `anchor: null` and a string `title` of at most 200 UTF-16 code units with `title.trim().length > 0`.

Validation is all-or-nothing across the fetched, used prefix. One malformed fetched page envelope, cursor, retained record, or retained comment prevents that candidate prefix from replacing the prior valid model. The only omission is the deterministic budget tail above, which is visibly disclosed and never interpreted. All response strings are untrusted display data: create fixed elements with DOM methods, assign strings only through `textContent`, set fixed attributes explicitly, and never place response text in `innerHTML`, a selector, CSS, a URL, an event-handler attribute, or an element id.

An initial failure creates no comment DOM. After a prior successful render, a transient failure retains the last good read-only view and sets the existing polite status text to `Comments could not be refreshed.` A `401` or `403` is terminal for this page: clear both highlight registry entries and fallback classes, remove the toggle/rail/panel, clear the in-memory thread array, set `activated = false`, and leave the document static. Do not create a login control.

Refresh calls use one bounded single-flight batch. If called while a pass is running, set one `again` boolean and return the current batch promise. A batch performs at most two sequential five-second passes: the first requested pass and, only if `again` became true during it, one trailing pass. A request arriving during the trailing pass leaves `again` set; after the current promise settles, schedule one new batch in a microtask. Every pass restarts at page one and recomputes the same server-order bounded prefix and truncation metadata; it never resumes an old terminal cursor or appends to the prior partial model. A valid partial view is a successful commit and makes `refresh()` resolve `true`. A later failure retains that last good partial view and its truncation notes while setting the refresh-failure status. Thus simultaneous visibility/realtime requests coalesce, a change signalled during an older read receives a later read, every individual pass has a finite deadline, and no synchronous or interval loop is introduced.

### Exact `textMap()` and `rangeFor()` algorithms

`textMap(root)` returns `{ text, spans }`. `text` is the exact P1-D-normalised descendant text. `spans[k]` maps UTF-16 code unit `text[k]` to one DOM half-open boundary pair:

```text
{ startNode, startOffset, endNode, endOffset }
```

The algorithm is normative:

1. Create a `TreeWalker(root, NodeFilter.SHOW_TEXT)` and visit text nodes in document order.
2. Skip a text node when it has a `script` or `style` ancestor contained by `root`, matching P1-D's opaque raw-text rule. Do not skip hidden ordinary descendants; the builder includes their text too.
3. Iterate each retained `node.data` by numeric string index, so offsets and lengths are UTF-16 code units. Define `isWhitespace(unit)` only as `norm(unit) === ""`; do not write a second whitespace regular expression or table.
4. Drop whitespace before the first non-whitespace unit. After output has begun, retain a pending whitespace run as its first `{node, offset}` and latest `{node, offset + 1}` boundaries, even when the run crosses text nodes.
5. On the next non-whitespace unit, append exactly one ASCII space and one span covering the complete pending DOM run, clear the pending run, then append the non-whitespace unit with a span from its offset to `offset + 1` in that text node.
6. At end of traversal, discard any pending run. This performs trim and whitespace collapse without duplicating `norm()`.
7. The test postcondition is `result.text === norm(raw)`, where `raw` is the concatenation of every retained text node's data in the same order.

This mapping intentionally has one span for each UTF-16 code unit. A surrogate pair therefore has two adjacent spans, matching JavaScript string length and P1-D offsets. A collapsed internal whitespace character maps to the whole source run, so a range ending on that normalised space covers the full run rather than its first code unit.

`rangeFor(map, start, end)` accepts only safe integers satisfying `0 <= start < end <= map.text.length`. It creates a `Range`, sets its start from `spans[start]`'s start boundary and its end from `spans[end - 1]`'s end boundary, and returns it. It returns `null` on an invalid bound or missing span and never calls `surroundContents()`, inserts a node, or changes prose.

### Exact quote scoring and `locate()` algorithm

Build one fresh block index before resolving a successful response. Iterate `document.querySelectorAll("[data-aid]")` in document order; every element's lowercase `localName` must occur in the exact published `BLOCK` array, and every id must match `^a[0-9a-f]{8}$` and occur once. Cache `{ element, order, map: textMap(element) }` by id. An out-of-policy element, invalid id, or duplicate rendered id aborts the response commit rather than choosing one block.

`commonPrefix(a, b)` counts equal leading UTF-16 code units up to the shorter length. `commonSuffix(a, b)` does the same from the end. `findQuote(map.text, anchor)` enumerates every possibly overlapping occurrence of `anchor.exact` with `indexOf(exact, from)` and advances `from` by one after each hit. For a hit at `i`, compute:

```text
context = commonSuffix(text.slice(max(0, i - prefix.length), i), prefix)
        + commonPrefix(text.slice(i + exact.length, i + exact.length + suffix.length), suffix)
distancePenalty = min(abs(i - start), text.length) / (text.length + 1)
score = context - distancePenalty
```

The fractional penalty is always less than one, so one more matching context code unit always outranks any distance. Higher score wins; an exactly equal score uses the lower offset. An empty exact string has no hit. There is no threshold, fuzzy comparison, case fold, or normalisation beyond the already-normalised stored fields and text map.

`locate(anchor, blockIndex)` returns exactly one of these four shapes:

```text
{ state: "exact",    element, range, order }
{ state: "drifted", element, range: null, order }
{ state: "moved",   element, range, order }
{ state: "orphaned", element: null, range: null, order: Infinity }
```

Its steps are exact:

1. If `anchor.block` exists in the index, run `findQuote()` only in that block. A hit with a valid `rangeFor()` result is `exact`. No hit, or an impossible range-mapping failure, is `drifted`. Do not search elsewhere when the stable block still exists.
2. If the block id is absent, run `findQuote()` once against every indexed block and collect blocks with a hit. Exactly one matching block with a valid range is `moved` and must be labelled `Moved from its original block`. Zero matching blocks, more than one matching block, or a range-mapping failure is `orphaned`.
3. A quote repeated within one candidate block is disambiguated by the scoring rule; moved uniqueness is counted by matching blocks, not raw occurrence count.
4. Discussions have `anchor: null`, bypass `locate()`, receive no anchor-state value, highlight, fallback class, or marker, and render only in the Discussions group.

The observable meanings are fixed:

| State | Block id | Exact quote | Document treatment | Panel treatment |
|---|---|---|---|---|
| `exact` | Present | Found there | Range highlight and marker for open threads | No warning label |
| `drifted` | Present | Not found there | Block-level marker; no range highlight | `Text changed` plus stored quote |
| `moved` | Missing | Found in exactly one other block | Range highlight and marker for open threads | `Moved from its original block` |
| `orphaned` | Missing | Missing or found in multiple blocks | No marker and no highlight | `Not attached any more` group plus stored quote |

### Highlights and non-mutating fallback

Feature-detect all of `typeof Highlight === "function"`, `window.CSS`, and a registry at `CSS.highlights` with callable `set()` and `delete()`. When available, own exactly two registry names, `doc-comments-open` and `doc-comments-active`. Recreate and register both `Highlight` objects on each committed render. Add ranges only for open `exact` and `moved` threads; the active open thread goes into the active registry and the others into the open registry. Delete both names on terminal authorization loss.

When unavailable, add `doc-comment-block` to every located open block and also add `doc-comment-block-active` to the active thread's block. Base and active fallback classes must each produce visible computed decoration, while text labels remain the non-colour state signal. Remove both fallback classes before each repaint. Do not add a polyfill. Neither path changes an anchored block's child nodes or text.

### Rail placement and deterministic ordering

After the first valid response, append one `<div id="doc-comments-rail" aria-label="Comment locations">` to `document.body`. It contains native `<button type="button" class="doc-comment-marker">` elements only for open `exact`, `drifted`, and `moved` threads. Each button has `data-thread-id` set only after the id has passed validation and a complete accessible name such as `Comment by Rowan Vale, 2 messages, text changed`. State is never conveyed by colour alone.

The rail is absolutely positioned over the document without taking layout space. For each visible marker, use the top of `location.range.getBoundingClientRect()` when a range exists and otherwise `location.element.getBoundingClientRect()`. Convert the viewport top to rail coordinates by subtracting `rail.getBoundingClientRect().top`. Set its horizontal position to eight CSS pixels after the host block's right edge, converted through the same rail rectangle and clamped between 4 and `document.documentElement.scrollWidth - marker.offsetWidth - 4`. A marker is hidden when its host is absent, its closest `details` is closed, or its host has no layout box. Sort visible markers by desired top, then located block order, then `createdAt`, then thread id. Set each top to `max(desiredTop, previousTop + 24)` CSS pixels.

Run placement after each committed render, active-thread change, panel open/close, window resize, hash change, `document.fonts.ready` settlement when available, and a captured document `toggle` event. The capture option is required because the section disclosures dispatch `toggle` on their own elements rather than providing a bubbling delegation seam. Coalesce layout requests through one `requestAnimationFrame`; this is layout scheduling, not a network poll. Remove no pre-existing listener or application behavior.

### Panel DOM, events, and accessibility

Create the following fixed structure only after the first valid response:

```text
button#doc-comments-toggle
div#doc-comments-rail
aside#doc-comments-panel[hidden][aria-labelledby="doc-comments-title"]
  header
    h2#doc-comments-title "Comments"
    button#doc-comments-close "Close comments"
  div#doc-comments-status[role="status"][aria-live="polite"]
  p#doc-comments-truncation[hidden]
  div#doc-comments-filters
  div#doc-comments-list
```

Insert the toggle into the existing `.head-top`; if `.head-top` is missing, abort that response commit and keep the document static. Inspect only the container's direct element children. When one or more direct children match `.share-btn`, insert the toggle immediately before the first such child with `insertBefore(toggle, share)`. Otherwise append the toggle. P1-B's single direct share control therefore remains the last `.head-top` control whether comments render before or after that sibling; nested `.share-btn` descendants are irrelevant and no later module/load timing may change the rule. The toggle uses `aria-controls="doc-comments-panel"` and an exact boolean `aria-expanded`. The panel is a non-modal complementary region, not a dialog: the document remains operable, focus is not trapped, and `aria-modal` is not set.

The toggle opens and closes the panel. Opening from the header focuses the panel heading, which has `tabindex="-1"`; opening from a marker sets the active thread, renders it active, and focuses that thread card's heading. `Escape` while focus is inside the panel closes it and returns focus to the invoker when that connected element still exists, otherwise to the header toggle. The visible close button does the same. Closing clears only active presentation, not filters or data.

Filters are native buttons in two labelled groups. Status is exactly one of Open, Resolved, or All and defaults to Open. Kind is exactly one of Anchored, Discussions, or All and defaults to All. Each button exposes selection through `aria-pressed`; filtering changes no stored thread. The header toggle text is `Comments (<open-count>)`, where the count includes only retained open anchored comments and retained open discussions; it never implies a server total.

Render with semantic headings, lists, `<article>` thread cards, and `<time datetime="…">`. A card shows author name, timestamp, every comment body in the complete retained thread in creation order, an `edited` note where applicable, status, and the explicit anchor warning/quote where required. It never shows author email. Live anchored cards sort by located block order, then `createdAt`, then id. Discussions and orphans have separate labelled groups and sort by `createdAt`, then id. The orphan group heading is exactly `Not attached any more`; every matching orphan card contains its stored `anchor.exact` in a `<blockquote>`. It is never folded into a live block or omitted because it lacks a location.

`#doc-comments-truncation` is outside the live region. Keep it hidden only after a fetched view reaches a null cursor without omitting a returned boundary/thread tail. When a non-null cursor is not followed because a client budget binds, the fifth-page cap binds, or a returned boundary/thread tail is omitted, show the exact safe summary `Showing a partial view: <retained-thread-count> threads and <retained-comment-count> messages loaded; additional results may be available.` using locally computed integers and `textContent`. “May” is required because a P3-A cursor proves that listed candidates remain beyond the current page, but later strong reads can find that every candidate has disappeared. The note contains no ignored response text, ids, actors, cursors, or body content. Filters never hide it.

Every live anchored card has a read-only `Show in document` button. It opens the host's closest `details`, selects the thread, repaints, schedules rail placement, and calls `scrollIntoView({ block: "center", behavior: "auto" })` on the host. It does not focus or add `tabindex` to prose. Marker activation performs the inverse navigation into the panel.

Refresh rebuilds the fixed list from the validated model and its newly computed truncation metadata, preserving the selected filters, panel-open state, and active thread id when that thread still exists. A complete later refresh removes stale truncation notes; another partial refresh replaces them rather than appending. If focused list content is replaced, restore focus to the corresponding thread heading when it still exists, otherwise to the panel heading. Update the polite status with a short retained count or refresh failure; never place truncation prose or all thread text in a live region.

CSS must provide a visible `:focus-visible` outline at least two CSS pixels wide, state text in addition to tint/border, and panel foreground/background combinations whose computed WCAG contrast is at least 4.5:1 in both emulated light and dark schemes; the schemes must not compute to the same panel background. Existing variables may supply the colours, but local fallbacks must satisfy the same rendered checks in the isolated fixture. With `prefers-reduced-motion: no-preference`, the panel has at least one positive computed animation or transition duration. With `prefers-reduced-motion: reduce` and forced colours still off, both computed duration lists are exclusively `0s`. In `forced-colors: active`, the panel has a visible border, focused controls retain the outline, and fallback blocks retain visible border/outline decoration.

Above 720 CSS pixels the panel is fixed at the right viewport edge from top to bottom with width `min(26rem, 40vw)`, and the rail remains displayed. At or below 720 pixels it becomes a fixed full-width bottom sheet at the viewport bottom with `max-height: 60vh`, and the margin rail is hidden while the toggle/panel preserve access without horizontal overflow. A print rule computes the toggle, rail, and panel to `display: none`, makes fallback border/outline/background decoration transparent with no shadow, and makes both custom-highlight backgrounds transparent. The stylesheet must not hide existing document content or change layout until the comment UI exists.

### Refresh triggers and later amendment seams

The initial valid session calls `refresh()` once. Initialise the private last-visibility-refresh timestamp as absent; the first subsequent transition into visible state is always eligible and records its start time. The only P3-C automatic refresh listener is:

- on `visibilitychange`, if `document.visibilityState === "visible"` and either no visibility-triggered refresh has started yet or at least 30,000 ms have elapsed since the last one started, record the current monotonic timestamp and call the same public `refresh()`;
- otherwise do nothing, with no delayed timer.

Use `performance.now()` for the visibility throttle. Initial session refresh and direct `window.doc.comments.refresh()` calls do not consume or obey the visibility throttle. There is no `setInterval`, recursive timeout, `focus`, `online`, or polling listener.

P3-F later handles `thread.changed` on its `doc:event` bus and calls `window.doc.comments?.refresh()`; P3-C neither knows the transport nor parses its event. P4-A later amends `comments.js` with write UI and methods while preserving the read resolver and callable refresh. P4-Q runs only after P4-A, amends both files, publishes the already-existing internal controllers as `window.doc.rail` and `window.doc.panel`, adds the Suggestions filter, and re-resolves named blocks on `doc:overlay`. P3-C must keep its internals factored so those amendments do not require another resolver, rail, panel, or fetch path.

## Files owned

- `templates/base/comments.js` — new read-only client module. P4-A amends this same file for comment writes; P4-Q amends it afterward for shared rail/panel publication, Suggestions filtering, and overlay re-resolution.
- `templates/base/comments.css` — new read-only client styles. P4-Q amends this same file after P4-A for the shared suggestion surface.

These two paths are the complete and exclusive source ownership of P3-C. `templates/docbuild/dist/**`, `example/dist/example.html`, and `templates/components/dist/components.html` are shared generated products, not source ownership. The integration owner regenerates them from the combined source immediately before merge; no lane hand-edits them. P3-C must stop rather than alter `layout.html`, builder source, session assets, anchor source/state, edit assets, API files, package manifests, workflows, or another ticket.

## Dependencies

### Required before integration

| Dependency | Contract consumed | P3-C boundary |
|---|---|---|
| P1-B | Optional comments slots, ordered inline modules, `window.doc`, `.head-top`, edit-before-comments and session-last order | Use the slots; do not edit layout or initialize another namespace |
| P1-D | Unique `data-aid` blocks and exact `window.doc.anchor.norm` | Import no duplicate normaliser/scanner; fail dark when the published core is missing |
| P2-C | One immutable `session` event after successful authentication and no event on offline/file failure | Attach during module evaluation; issue no second session probe and treat the event as a reveal signal, never authority |
| P3-A | Authenticated keyset pages `{ threads, nextCursor }` from `GET /api/threads?doc=<docId>&limit=100[&cursor=…]`, with 1–100 threads on a non-null-cursor page, at most 500 comments per thread, and at most 5000 comments per page | Follow exact exclusive cursors until a client budget binds, validate retained/boundary records, disclose omitted state, and never reject solely because additional valid server state exceeds the retained-view budget; server remains authoritative and owns all writes |

P2-D is a compatibility predecessor, not a runtime prerequisite: it may add `data-editable` and edit hashes to a strict subset of P1-D blocks without changing their aids or text. P3-C ignores editability and resolves every P1-D block kind. Its source may be authored against an invented route fixture before P3-A merges, but its integration/browser gate requires P3-A's final GET contract.

### Downstream sequencing

- P3-F may consume only `window.doc.comments.refresh()` and must not reach into private DOM/controller state.
- P4-A amends `comments.js` after P3-C; it adds comment writes without replacing the read pipeline.
- P4-Q amends `comments.js` and `comments.css` only after P4-A; it is the creator of the public `window.doc.rail`/`window.doc.panel` methods and the `doc:overlay` listener.
- P4-C may later add the cross-language normaliser CI gate; P3-C is already required to consume the shared function rather than wait for that gate.

## Acceptance criteria

- [ ] **AC-01 — Environment gate:** `file:`, `data:`, `blob:`, `about:`, missing/empty doc id, missing anchor core, missing required primitives, and no session event create no comment DOM, request, storage access, console call, or unhandled error.
- [ ] **AC-02 — One activation seam:** the module installs one `{ once: true }` `session` listener before P2-C runs, stores no session object, issues no `/api/session` request, and activates exactly one initial refresh for a valid event.
- [ ] **AC-03 — Read-only transport:** every comments request is the exact bounded same-origin GET with `limit=100` and only the prior server cursor. A complete pinned-Acorn AST walk proves there is one statically resolved fetch call site and no import/export, dynamic import, or statically resolved write/network call, storage/cookie/service-worker member, HTML sink, forbidden element creation, polling interval, or downstream event/global reference. The mandatory success, refresh-failure, and forbidden-event browser paths poison those runtime dependencies—including dynamic forbidden-element creation—and assert zero touches. Acceptance makes no universal claim about an unexecuted dynamically computed path and infers nothing from a text regex.
- [ ] **AC-04 — Response safety:** every fetched page envelope and retained or omitted boundary P3-A v1 thread/comment validates exactly for the current doc before commit; the executable closed mutation matrix covers every required thread/comment/actor/anchor key, scalar domain, timestamp, and kind/status/resolution/first-comment coupling, while retained and boundary threads enforce P3-A's 500-comment cap and parsing relies on its 5000-comment page cap. Malformed used/boundary input is all-or-nothing, while state beyond five pages/500 threads/5000 retained comments commits as a deterministic visibly truncated prefix rather than failing solely for size. Adversarial malformed ignored thread tails are never interpreted, strings render only through `textContent`, emails are not rendered, and 401/403 clears the feature.
- [ ] **AC-05 — Canonical mapping:** `textMap()` consumes P1-D's `norm()`, matches its normalised text over inline elements, entities, cross-node whitespace, NBSP, surrogate pairs, and opaque script/style descendants, and `rangeFor()` maps half-open UTF-16 offsets back without prose mutation.
- [ ] **AC-06 — Deterministic resolution:** quote occurrence enumeration, context score, fractional distance tiebreak, lower-offset final tie, correct-block precedence, and unique-block moved recovery implement the exact algorithms in this ticket with no fuzzy or silent relocation.
- [ ] **AC-07 — Four visible states:** the fixture proves `exact`, `drifted`, `moved`, and both zero-hit/multi-block `orphaned` cases. Drifted and moved labels are visible; every orphan appears under `Not attached any more` with its quote.
- [ ] **AC-08 — Non-mutating highlight:** supported Chromium uses exactly the two custom-highlight registry names and leaves anchored child DOM byte-equivalent; unsupported-mode simulation executes both base and active fallback classes, proves each has visible computed decoration, and uses no `<mark>`/wrapper/polyfill.
- [ ] **AC-09 — Rail behavior:** only open located threads have native-button markers; closed disclosures hide them; capture-phase toggle, resize, hash, font, panel, and active changes re-place them; ordering/24-pixel decluttering is deterministic.
- [ ] **AC-10 — Panel behavior:** one private rail and one private non-modal panel render complete retained anchored comments, discussions, and orphan groups in fixed order; filters, retained counts, the exact global truncation note, refresh replacement, inverse navigation, and failure status match this contract.
- [ ] **AC-11 — Accessibility:** all controls are keyboard reachable, the fixture proves a rendered focus-visible outline at least two pixels wide, names and pressed/expanded state are programmatically exposed, state is not colour-only, Escape/close restore focus, the live region stays terse, and Chromium accessibility snapshots contain the expected headings/buttons/articles while hidden UI is absent.
- [ ] **AC-12 — Refresh contract:** `window.doc.comments` is frozen and exposes only `refresh`; pre-session calls return false, each pass restarts at page one, accepts/follows P3-A non-null cursors on 1–100-thread pages until an explicit client budget binds, and commits at most five sequential cursor pages under one five-second deadline. Partial success returns true, overlapping calls follow the bounded single-flight rule, direct calls fetch fresh data, the first hidden→visible edge refreshes, and later visible edges are throttled once per 30 seconds without polling.
- [ ] **AC-13 — Amendment boundary:** P3-C leaves `window.doc.rail` and `window.doc.panel` null, does not listen for `doc:event` or `doc:overlay`, and documents the strict P3-C → P4-A → P4-Q file chain. The AST oracle rejects those static member/listener surfaces, and the browser fixture installs throwing setters/listener guards before module evaluation, dispatches both forbidden events after activation, and observes no write, request, or sink touch.
- [ ] **AC-14 — Rendered modes:** the mandatory Chromium fixture executes light/dark contrast, forced colours, reduced motion, desktop right-edge geometry, narrow bottom-sheet geometry/rail hiding/no overflow, and print hiding/transparent fallback and custom-highlight decoration against computed styles rather than source tokens.
- [ ] **AC-15 — Repository integrity:** both public instances build, generated outputs are byte-stable, the owned-source boundary holds, scrub and whitespace gates pass, the browser supervisor removes every owned process/temp artifact, and issue #16 passes the executable pointer-integrity gate: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

### Acceptance traceability

| Test | Acceptance criteria |
|---|---|
| T1 syntax and declared-seam smoke oracle | AC-02, AC-15 |
| T2 embedding and repository build | AC-01, AC-13, AC-15 |
| T3–T6 executable Chromium fixture, mandatory rendered-mode oracle, and retained-owner gate | AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-14, AC-15 |
| T7 final repository/issue gates | AC-15 |

All commands run from the repository root after P1-B, P1-D, P2-C, P2-D, and P3-A are integrated. Fixture prose is invented and public: `The aurora ledger keeps one blue token.`, `A silver path crosses the quiet field.`, and variants. Fixture actors are `Rowan Vale <rowan@reader.example>` and `Mira Stone <mira@reader.example>`.

### T1 — syntax and declared-seam smoke oracle

```bash
set -euo pipefail
test -f templates/base/comments.js
test -f templates/base/comments.css
node --check templates/base/comments.js
test "$(rg -l '/api/threads' templates/base --glob '*.js')" = "templates/base/comments.js"
test "$(rg -l 'doc-comments-open' templates/base | sort)" = $'templates/base/comments.css\ntemplates/base/comments.js'
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("templates/base/comments.js", "utf8");
assert.equal((js.match(/\bfetch\s*\(/g) ?? []).length, 1, "one fetch call site");
assert.equal((js.match(/addEventListener\s*\(\s*["']session["']/g) ?? []).length, 1, "one session listener");
assert.match(js, /Object\.freeze\s*\(\s*\{\s*refresh\s*\}\s*\)/, "frozen callable surface");
assert.match(js, /insertBefore\s*\(\s*toggle\s*,\s*share\s*\)/, "toggle precedes retained direct share sibling");
assert.match(js, /searchParams\.set\s*\(\s*["']limit["']\s*,\s*["']100["']\s*\)/, "requests maximum P3-A page size");
assert.ok(js.includes("nextCursor"), "consumes the bounded P3-A cursor prefix");
for (const [name, value] of [["method", "GET"], ["mode", "same-origin"], ["credentials", "same-origin"], ["cache", "no-store"], ["redirect", "error"]]) {
  assert.match(js, new RegExp(`${name}\\s*:\\s*["']${value}["']`), `exact fetch option ${name}`);
}
assert.match(js, /5000|5_000/, "required five-second and 5000-comment constants are present");
assert.doesNotMatch(js, /replace\s*\(\s*\/\\s\+\//, "must not copy norm implementation");
assert.doesNotMatch(js, /setInterval\s*\(/, "no polling interval");
console.log("PASS  P3-C source declares the expected read seam");
NODE
```

Expected: all assertions exit `0`; the final line is exactly `PASS  P3-C source declares the expected read seam`. This smoke gate does not claim to prove forbidden paths. The mandatory Chromium command parses the whole module with pinned Acorn and exercises poisoned browser sinks on activation, refresh, error, and forbidden-event paths.

### T2 — embedding and repository build

```bash
set -euo pipefail
npm --prefix templates/docbuild run check
templates/build example
templates/build templates/components
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("templates/base/comments.js", "utf8").trim();
const css = readFileSync("templates/base/comments.css", "utf8").trim();
for (const path of ["example/dist/example.html", "templates/components/dist/components.html"]) {
  const html = readFileSync(path, "utf8");
  assert.equal(html.split(js).length - 1, 1, `${path}: comments JS count`);
  assert.equal(html.split(css).length - 1, 1, `${path}: comments CSS count`);
  const anchor = html.indexOf("window.doc.anchor = { BLOCK, norm, scanBlocks };");
  const comments = html.indexOf(js);
  const session = html.indexOf("/api/session");
  assert.ok(anchor >= 0 && anchor < comments && comments < session, `${path}: module order`);
}
console.log("PASS  P3-C assets are embedded once after anchors and before session");
NODE
```

Expected: typecheck and builds exit `0`, and the final probe prints its exact PASS line.

### T3–T6 — executable Chromium fixture and retained-owner gate

This one self-contained command creates no repository file. It derives the exact compiled P1-D anchor script from the built public fixture, serves the owned P3-C assets from a disposable loopback origin, and gives every case a fresh browser context and page. Pinned Playwright `1.55.0`, pinned Acorn `8.15.0`, the npm cache, browser, server, and fixture all remain below one private temporary root.

```bash
set -euo pipefail
case "$(uname -s)" in Darwin|Linux) ;; *) printf 'FAIL  P3-C requires macOS or Linux\n' >&2; exit 1 ;; esac
P3C_REPO="$(pwd -P)"
test -f "$P3C_REPO/templates/base/comments.js"
test -f "$P3C_REPO/templates/base/comments.css"
test -f "$P3C_REPO/example/dist/example.html"
P3C_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p3-c-browser.XXXXXX")"
chmod 700 "$P3C_ROOT"
export P3C_REPO P3C_ROOT
umask 077
P3C_PREP_SIGNAL=0
p3c_prepare_signal() {
  if test "$P3C_PREP_SIGNAL" -eq 0; then P3C_PREP_SIGNAL="$1"; fi
  exit "$P3C_PREP_SIGNAL"
}
p3c_prepare_cleanup() {
  local prior="$?"
  local deletion_status=0
  local deletion_pid
  local tick=0
  trap - EXIT
  trap '' HUP INT TERM
  node -e 'const fs=require("node:fs"),os=require("node:os"),p=require("node:path");const root=fs.realpathSync(process.argv[1]),temp=fs.realpathSync(os.tmpdir()),s=fs.lstatSync(root);if(p.dirname(root)!==temp||!/^p3-c-browser\.[A-Za-z0-9]{6}$/.test(p.basename(root))||!s.isDirectory()||s.isSymbolicLink()||(s.mode&511)!==448)process.exit(2);fs.rmSync(root,{recursive:true});' "$P3C_ROOT" &
  deletion_pid="$!"
  while kill -0 "$deletion_pid" 2>/dev/null && test "$tick" -lt 200; do
    sleep 0.05
    tick=$((tick + 1))
  done
  if kill -0 "$deletion_pid" 2>/dev/null; then
    kill -KILL "$deletion_pid" 2>/dev/null || true
    wait "$deletion_pid" 2>/dev/null || true
    printf 'FAIL  P3-C preparation cleanup timed out; inspect %s\n' "$P3C_ROOT" >&2
    exit 1
  fi
  wait "$deletion_pid" || deletion_status="$?"
  if test "$deletion_status" -ne 0 || test -e "$P3C_ROOT"; then
    printf 'FAIL  P3-C preparation cleanup retained %s\n' "$P3C_ROOT" >&2
    exit 1
  fi
  if test "$P3C_PREP_SIGNAL" -ne 0; then exit "$P3C_PREP_SIGNAL"; fi
  exit "$prior"
}
trap 'p3c_prepare_signal 129' HUP
trap 'p3c_prepare_signal 130' INT
trap 'p3c_prepare_signal 143' TERM
trap p3c_prepare_cleanup EXIT

command cat >"$P3C_ROOT/launcher.mjs" <<'LAUNCHER'
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.P3C_LAUNCH_MODE;
const root = process.env.P3C_ROOT;
const repo = process.env.P3C_REPO;
const keepAlive = setInterval(() => {}, 1000);
const run = (command, args, env = process.env) => new Promise((resolve) => {
  const child = spawn(command, args, { cwd: repo, env, stdio: "inherit" });
  child.once("close", (code, signal) => resolve({ code, signal }));
});

process.once("message", async (message) => {
  if (message?.type !== "go") return;
  if (mode === "delete") {
    try {
      rmSync(root, { recursive: true });
      process.send?.({ type: "result", code: 0, signal: null }, () => process.exit(0));
    } catch (error) {
      process.send?.({ type: "result", code: 1, signal: null, error: String(error) }, () => process.exit(1));
    }
    return;
  }

  const env = {
    ...process.env,
    npm_config_cache: `${root}/npm-cache`,
    PLAYWRIGHT_BROWSERS_PATH: `${root}/browsers`,
  };
  let result = await run("npm", ["--prefix", root, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "playwright@1.55.0", "acorn@8.15.0"], env);
  if (result.code === 0 && result.signal === null) {
    result = await run(process.execPath, [`${root}/node_modules/playwright/cli.js`, "install", "chromium"], env);
  }
  if (result.code === 0 && result.signal === null) {
    result = await run(process.execPath, [`${root}/runner.mjs`], env);
  }
  process.send?.({ type: "result", ...result });
});

process.send?.({ type: "ready", pid: process.pid });
void keepAlive;
LAUNCHER

command cat >"$P3C_ROOT/runner.mjs" <<'RUNNER'
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parse } from "acorn";
import { chromium } from "playwright";

const root = process.env.P3C_ROOT;
const repo = process.env.P3C_REPO;
const commentsJS = readFileSync(join(repo, "templates/base/comments.js"), "utf8");
const commentsCSS = readFileSync(join(repo, "templates/base/comments.css"), "utf8");
const built = readFileSync(join(repo, "example/dist/example.html"), "utf8");

const ast = parse(commentsJS, { ecmaVersion: "latest", sourceType: "module" });
const children = (node) => Object.entries(node).flatMap(([key, value]) => {
  if (key === "start" || key === "end" || key === "loc") return [];
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry.type === "string");
  return value && typeof value.type === "string" ? [value] : [];
});
const nodes = [];
const visit = (node) => { nodes.push(node); for (const child of children(node)) visit(child); };
visit(ast);
const staticName = (node) => {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
};
const memberPath = (node) => {
  if (!node) return null;
  if (node.type === "ChainExpression") return memberPath(node.expression);
  if (node.type === "Identifier") return [node.name];
  if (node.type !== "MemberExpression") return null;
  const head = memberPath(node.object);
  const tail = node.computed ? staticName(node.property) : node.property?.name;
  return head && tail ? [...head, tail] : null;
};
assert.equal(nodes.some((node) => ["ImportDeclaration", "ImportExpression", "ExportNamedDeclaration", "ExportDefaultDeclaration", "ExportAllDeclaration"].includes(node.type)), false, "comments module has no import/export or dynamic import");
const calls = nodes.filter((node) => node.type === "CallExpression" || node.type === "NewExpression");
const callPaths = calls.map((node) => memberPath(node.callee)).filter(Boolean);
assert.equal(callPaths.filter((path) => path.at(-1) === "fetch").length, 1, "one fetch call site in the complete AST");
for (const forbidden of ["XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "submit", "requestSubmit", "setInterval", "eval", "Function"]) {
  assert.equal(callPaths.some((path) => path.at(-1) === forbidden), false, `forbidden call/new target ${forbidden}`);
}
for (const node of nodes.filter((entry) => entry.type === "MemberExpression")) {
  const path = memberPath(node);
  if (!path) continue;
  const root = path[0] === "window" ? path[1] : path[0];
  assert.equal(["localStorage", "sessionStorage", "indexedDB", "caches"].includes(root), false, `forbidden storage root ${path.join(".")}`);
  assert.equal(["innerHTML", "outerHTML", "insertAdjacentHTML", "cookie", "serviceWorker"].includes(path.at(-1)), false, `forbidden member path ${path.join(".")}`);
  assert.equal(path.join(".") === "window.doc.rail" || path.join(".") === "window.doc.panel", false, `private downstream global ${path.join(".")}`);
}
for (const node of calls) {
  const path = memberPath(node.callee);
  if (path?.at(-1) !== "addEventListener") continue;
  const type = staticName(node.arguments[0]);
  assert.notEqual(type, "doc:event", "no static doc:event listener");
  assert.notEqual(type, "doc:overlay", "no static doc:overlay listener");
}
for (const node of calls.filter((entry) => memberPath(entry.callee)?.at(-1) === "createElement")) {
  assert.equal(["form", "textarea", "input", "mark"].includes(staticName(node.arguments[0])), false, "no write or prose-wrapper element creation");
}
const anchorScripts = [...built.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((body) => body.includes("window.doc.anchor = { BLOCK, norm, scanBlocks };"));
assert.equal(anchorScripts.length, 1, "one compiled P1-D anchor script");
const anchorJS = anchorScripts[0];

const actor = Object.freeze({ sub: "reader-7", name: "Rowan Vale", email: "rowan@reader.example" });
const docId = "4b7d2a";
const threadId = (number) => `t_m8x2k1_${number.toString(16).padStart(8, "0")}`;
const commentId = (number) => `c_m8x2k1_${number.toString(16).padStart(8, "0")}`;
const note = (id, body = "An invented public observation.") => ({ id: `c_m8x2k1_${id.slice(-8)}`, body, author: actor, createdAt: "2026-01-02T03:04:05.000Z", editedAt: null });
const notes = (count, label) => Array.from({ length: count }, (_, index) => ({ ...note(threadId(index + 1), `${label} ${index + 1}.`), id: commentId(index + 1) }));
const thread = (id, anchor, overrides = {}) => ({
  v: 1,
  id,
  docId,
  kind: anchor === null ? "discussion" : "comment",
  status: "open",
  section: "ledger",
  docVersion: "7aaca51",
  author: actor,
  comments: [note(id)],
  anchor,
  title: anchor === null ? "Invented ledger discussion" : null,
  createdAt: "2026-01-02T03:04:05.000Z",
  resolvedAt: null,
  resolvedBy: null,
  ...overrides,
});
const quote = (block, exact, start = 0, prefix = "", suffix = "") => ({ block, exact, prefix, suffix, start });
const pageOf = (threads, nextCursor = null) => ({ threads, nextCursor });
const rows = () => [
  thread(threadId(1), quote("a11111111", "aurora ledger keeps one 😀 blue token", 4, "The ", ".")),
  thread(threadId(2), quote("a22222222", "silver path", 0)),
  thread(threadId(3), quote("affffffff", "unique moved phrase", 0)),
  thread(threadId(4), quote("afffffffe", "absent amber phrase", 0)),
  thread(threadId(5), quote("afffffffd", "silver path", 0)),
  thread(threadId(6), null),
];

function html(withShare = true, withHead = true, docMode = "valid", withCore = true, duplicateAid = false, boundary = false) {
  const head = withHead
    ? `<div class="head-top"><button type="button">Index</button>${withShare ? '<button type="button" class="share-btn">Share</button>' : ""}</div>`
    : "";
  const meta = docMode === "missing" ? "" : `<meta name="doc-id" content="${docMode === "empty" ? "" : docId}">`;
  const duplicate = duplicateAid ? '<p data-aid="a11111111">Invented duplicate aid.</p>' : "";
  const bootstrap = boundary
    ? `<script>window.__p3cGlobalWrites=[];const state={};for(const key of ["rail","panel"])Object.defineProperty(state,key,{enumerable:true,get(){return null},set(){window.__p3cGlobalWrites.push(key);throw new Error("forbidden downstream global write: "+key)}});window.doc=state;<\/script>`
    : `<script>window.doc={rail:null,panel:null};<\/script>`;
  return `<!doctype html><html><head><meta charset="utf-8">${meta}<link rel="icon" href="data:,"><link rel="stylesheet" href="/comments.css">${bootstrap}</head><body><header>${head}</header><main><details id="fold" open><summary>Ledger</summary><section><p data-aid="a11111111">The <em>aurora</em>\n ledger\tkeeps&nbsp;one 😀 <span hidden>blue</span> token.<script>ignored raw text</script><style>ignored raw text</style></p></section></details><section><p data-aid="a22222222">The copper entry changed.</p></section><section><p data-aid="a33333333">A silver path crosses the quiet field. A unique moved phrase rests here.</p></section><section><p data-aid="a44444444">blue token xx blue token</p></section><section><p data-aid="a55555555">Another silver path reaches the invented ridge.</p>${duplicate}</section></main>${withCore ? `<script type="module">${anchorJS}</script>` : ""}<script type="module" src="/comments.js"></script></body></html>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/comments.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    response.end(commentsJS);
  } else if (url.pathname === "/comments.css") {
    response.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
    response.end(commentsCSS);
  } else if (url.pathname === "/fixture") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(html(url.searchParams.get("share") !== "0", url.searchParams.get("head") !== "0", url.searchParams.get("doc") ?? "valid", url.searchParams.get("core") !== "0", url.searchParams.get("duplicate") === "1", url.searchParams.get("boundary") === "1"));
  } else if (url.pathname === "/blank") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>blank</title>");
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.equal(typeof address, "object");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

async function openPage({ response = pageOf(rows()), share = true, head = true, doc = "valid", core = true, duplicate = false, boundary = false, init, handler } = {}) {
  const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC", viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  if (boundary) await page.addInitScript(() => {
    window.__p3cSinkTouches = [];
    const fail = (name) => { window.__p3cSinkTouches.push(name); throw new Error(`forbidden sink reached: ${name}`); };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = String(options.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.origin !== location.origin || url.pathname !== "/api/threads" || method !== "GET") fail(`fetch:${method}:${url.origin}${url.pathname}`);
      return nativeFetch(input, options);
    };
    for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) {
      Object.defineProperty(window, name, { configurable: true, value: class { constructor() { fail(name); } } });
    }
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value() { return fail("sendBeacon"); } });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, get() { return fail("serviceWorker"); } });
    for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) {
      Object.defineProperty(window, name, { configurable: true, get() { return fail(name); } });
    }
    Object.defineProperty(document, "cookie", { configurable: true, get() { return fail("cookie:get"); }, set() { fail("cookie:set"); } });
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function guardedListener(type, ...rest) {
      if (type === "doc:event" || type === "doc:overlay") fail(`listener:${type}`);
      return add.call(this, type, ...rest);
    };
    HTMLFormElement.prototype.submit = function forbiddenSubmit() { fail("form.submit"); };
    HTMLFormElement.prototype.requestSubmit = function forbiddenRequestSubmit() { fail("form.requestSubmit"); };
    const createElement = Document.prototype.createElement;
    Document.prototype.createElement = function guardedCreateElement(name, ...rest) {
      if (["form", "textarea", "input", "mark"].includes(String(name).toLowerCase())) fail(`createElement:${name}`);
      return createElement.call(this, name, ...rest);
    };
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function guardedAttribute(name, value) {
      if (String(name).toLowerCase() === "contenteditable") fail("contenteditable");
      return setAttribute.call(this, name, value);
    };
    const interval = window.setInterval;
    window.setInterval = (...args) => { fail("setInterval"); return interval(...args); };
  });
  if (init) await page.addInitScript(init);
  await page.route("**/api/threads?*", async (route) => {
    requests.push({ method: route.request().method(), url: route.request().url(), headers: await route.request().allHeaders() });
    if (handler) await handler(route, requests.length);
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto(`${origin}/fixture?share=${share ? 1 : 0}&head=${head ? 1 : 0}&doc=${doc}&core=${core ? 1 : 0}&duplicate=${duplicate ? 1 : 0}&boundary=${boundary ? 1 : 0}`);
  await page.waitForFunction(() => Boolean(window.doc?.comments));
  return { context, page, errors, requests };
}

const activate = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("session", { detail: Object.freeze({ user: Object.freeze({ sub: "reader-7" }) }) })));
};
const waitToggle = (page) => page.locator("#doc-comments-toggle").waitFor();
const rangeStart = (page) => page.evaluate(() => {
  const ranges = [...CSS.highlights.get("doc-comments-open")];
  if (ranges.length !== 1) return null;
  return ranges[0].startOffset;
});
async function run(name, body) {
  await body();
  console.log(`PASS  P3-C ${name}`);
}

try {
  await run("mapping", async () => {
    const state = await openPage({ response: pageOf([rows()[0]]) });
    try {
      const before = await state.page.locator('[data-aid="a11111111"]').innerHTML();
      await activate(state.page);
      await waitToggle(state.page);
      const mapped = await state.page.evaluate(() => {
        const ranges = [...CSS.highlights.get("doc-comments-open")];
        return { count: ranges.length, text: window.doc.anchor.norm(ranges[0].toString()), open: CSS.highlights.has("doc-comments-open"), active: CSS.highlights.has("doc-comments-active") };
      });
      assert.deepEqual(mapped, { count: 1, text: "aurora ledger keeps one 😀 blue token", open: true, active: true });
      assert.equal(await state.page.locator('[data-aid="a11111111"]').innerHTML(), before);
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("read-only-downstream-boundary", async () => {
    const state = await openPage({ response: pageOf([rows()[0]]), boundary: true });
    try {
      await activate(state.page);
      await waitToggle(state.page);
      assert.equal(state.requests.length, 1);
      const request = state.requests[0];
      const requestURL = new URL(request.url);
      assert.equal(request.method, "GET");
      assert.equal(requestURL.origin, origin);
      assert.equal(requestURL.pathname, "/api/threads");
      assert.deepEqual([...requestURL.searchParams.entries()], [["doc", docId], ["limit", "100"]]);
      assert.equal(await state.page.locator("form, textarea, input, [contenteditable]").count(), 0);
      assert.deepEqual(await state.page.evaluate(() => ({
        sinks: window.__p3cSinkTouches,
        globals: window.__p3cGlobalWrites,
        rail: window.doc.rail,
        panel: window.doc.panel,
      })), { sinks: [], globals: [], rail: null, panel: null });
      await state.page.evaluate(() => {
        document.dispatchEvent(new CustomEvent("doc:event", { detail: Object.freeze({ source: "server", t: "thread.changed" }) }));
        document.dispatchEvent(new CustomEvent("doc:overlay", { detail: Object.freeze({ blocks: [] }) }));
      });
      await state.page.waitForTimeout(50);
      assert.equal(state.requests.length, 1, "forbidden downstream events have no listener or transport effect");
      await state.page.unroute("**/api/threads?*");
      await state.page.route("**/api/threads?*", (route) => route.fulfill({ status: 500, body: "" }));
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), false);
      assert.deepEqual(await state.page.evaluate(() => ({ sinks: window.__p3cSinkTouches, globals: window.__p3cGlobalWrites })), { sinks: [], globals: [] });
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("occurrence-score", async () => {
    for (const [prefix, start, expected, number] of [[" xx ", 0, 14, 10], ["", 13, 14, 11], ["", 7, 0, 12]]) {
      const response = pageOf([thread(threadId(number), quote("a44444444", "blue token", start, prefix, ""))]);
      const state = await openPage({ response });
      try {
        await activate(state.page);
        await waitToggle(state.page);
        assert.equal(await rangeStart(state.page), expected);
        assert.deepEqual(state.errors, []);
      } finally { await state.context.close(); }
    }
  });

  await run("pagination", async () => {
    const first = Array.from({ length: 100 }, (_, index) => thread(threadId(0x100 + index), null, { title: `Invented page-one discussion ${index}` }));
    const second = [thread(threadId(0x200), null, { title: "Invented page-two discussion" })];
    const cursor = first.at(-1).id;
    const state = await openPage({
      handler: async (route) => {
        const url = new URL(route.request().url());
        assert.equal(url.searchParams.get("limit"), "100");
        const supplied = url.searchParams.get("cursor");
        if (supplied === null) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf(first, cursor)) });
        else {
          assert.equal(supplied, cursor);
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf(second)) });
        }
      },
    });
    try {
      await activate(state.page);
      await waitToggle(state.page);
      assert.equal(state.requests.length, 2);
      assert.equal(await state.page.locator("#doc-comments-toggle").textContent(), "Comments (101)");
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }

    const firstBudgetPage = Array.from({ length:100 },(_,index)=>thread(threadId(0x5000+index),null,{title:`Invented first budget page ${index+1}`}));
    const secondBudgetPage = Array.from({ length:10 },(_,index)=>thread(threadId(0x5100+index),null,{
      title:`Invented second budget page ${index+1}`,
      comments:notes(500,`Invented second-page message ${index+1}`),
    }));
    const firstBudgetCursor=firstBudgetPage.at(-1).id;
    let corruptBoundary=false;
    const shortPage = await openPage({handler:async (route)=>{
      const supplied=new URL(route.request().url()).searchParams.get("cursor");
      if (supplied===null) {
        await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(pageOf(firstBudgetPage,firstBudgetCursor))});
        return;
      }
      assert.equal(supplied,firstBudgetCursor);
      const rows=structuredClone(secondBudgetPage);
      if (corruptBoundary) rows[9].extra="invalid boundary field";
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(pageOf(rows))});
    }});
    try {
      await activate(shortPage.page);
      await waitToggle(shortPage.page);
      assert.equal(shortPage.requests.length,2,"a full page cursor is followed into a short comment-bounded page");
      assert.equal(await shortPage.page.locator("#doc-comments-toggle").textContent(),"Comments (109)");
      assert.equal(await shortPage.page.locator("#doc-comments-truncation").textContent(),"Showing a partial view: 109 threads and 4600 messages loaded; additional results may be available.");
      corruptBoundary=true;
      assert.equal(await shortPage.page.evaluate(()=>window.doc.comments.refresh()),false,"malformed omitted boundary thread fails validation");
      assert.equal(shortPage.requests.length,4);
      assert.equal(await shortPage.page.locator("article").count(),109,"failed refresh retains the prior valid partial view");
      assert.equal(await shortPage.page.locator("#doc-comments-truncation").textContent(),"Showing a partial view: 109 threads and 4600 messages loaded; additional results may be available.");
      assert.deepEqual(shortPage.errors,[]);
    } finally { await shortPage.context.close(); }

    const exactServerBudgetRows=Array.from({length:10},(_,index)=>thread(threadId(0x5200+index),null,{
      title:`Invented exact server budget ${index+1}`,
      comments:notes(500,`Invented exact-budget message ${index+1}`),
    }));
    const exactServerBudget = await openPage({response:pageOf(exactServerBudgetRows,exactServerBudgetRows.at(-1).id)});
    try {
      await activate(exactServerBudget.page);
      await waitToggle(exactServerBudget.page);
      assert.equal(exactServerBudget.requests.length,1,"exact 5,000-comment short page stops before its non-null continuation");
      assert.equal(await exactServerBudget.page.locator("#doc-comments-toggle").textContent(),"Comments (10)");
      assert.equal(await exactServerBudget.page.locator("#doc-comments-truncation").textContent(),"Showing a partial view: 10 threads and 5000 messages loaded; additional results may be available.");
      assert.deepEqual(exactServerBudget.errors,[]);
    } finally { await exactServerBudget.context.close(); }

    const oversizedThreads = Array.from({ length: 501 }, (_, index) => thread(threadId(0x1000 + index), null, { title: `Bounded invented discussion ${index + 1}` }));
    const overflow = await openPage({ handler: async (route, number) => {
      assert.ok(number <= 5, "page six must not be requested");
      const supplied = new URL(route.request().url()).searchParams.get("cursor");
      assert.equal(supplied, number === 1 ? null : oversizedThreads[number * 100 - 101].id);
      const page = oversizedThreads.slice((number - 1) * 100, number * 100);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf(page, page.at(-1).id)) });
    } });
    try {
      await activate(overflow.page);
      await waitToggle(overflow.page);
      assert.equal(overflow.requests.length, 5);
      assert.equal(await overflow.page.locator("#doc-comments-toggle").textContent(), "Comments (500)");
      assert.equal(await overflow.page.locator("#doc-comments-truncation").textContent(), "Showing a partial view: 500 threads and 500 messages loaded; additional results may be available.");
      assert.deepEqual(overflow.errors, []);
    } finally { await overflow.context.close(); }

    const exactCommentLimit = thread(threadId(0x2000), null, {
      title: "Invented maximum-size discussion",
      comments: notes(500, "Invented bounded message"),
    });
    const commentBoundary = await openPage({ response: pageOf([exactCommentLimit]) });
    try {
      await activate(commentBoundary.page);
      await waitToggle(commentBoundary.page);
      assert.equal(await commentBoundary.page.locator("#doc-comments-toggle").textContent(), "Comments (1)");
      assert.equal(await commentBoundary.page.locator("#doc-comments-truncation").getAttribute("hidden"), "");
      assert.equal(await commentBoundary.page.locator("article").getByText(/^Invented bounded message \d+\.$/).count(), 500);
      assert.deepEqual(commentBoundary.errors, []);
    } finally { await commentBoundary.context.close(); }

    const aboveCommentLimit = thread(threadId(0x2001), null, { comments: notes(501, "Invented over-limit message") });
    const invalidCommentCount = await openPage({ response: pageOf([aboveCommentLimit]) });
    try {
      await activate(invalidCommentCount.page);
      await invalidCommentCount.page.waitForTimeout(100);
      assert.equal(await invalidCommentCount.page.locator("#doc-comments-toggle").count(), 0);
      assert.deepEqual(invalidCommentCount.errors, []);
    } finally { await invalidCommentCount.context.close(); }

    const totalVisibleRows = Array.from({ length: 50 }, (_, index) => thread(threadId(0x3000 + index), null, {
      title: `Invented total-budget discussion ${index + 1}`,
      comments: notes(100, `Invented total-budget message ${index + 1}`),
    }));
    const ignoredTail = Array.from({ length: 50 }, (_, index) => ({
      id: threadId(0x3032 + index),
      docId: "INVALID-IGNORED-DOC",
      title: '<img src="https://ignored.invalid/never-requested" onerror="window.fixtureLeak=1">',
      comments: "INVALID-IGNORED-COMMENTS",
      author: { email: "ignored-tail@invalid.example" },
    }));
    let totalResponse = pageOf([...totalVisibleRows, ...ignoredTail], ignoredTail.at(-1).id);
    let totalStatus = 200;
    const totalOverflow = await openPage({
      init: () => {
        const nativeJSON = Response.prototype.json;
        window.__p3cIgnoredTouches = [];
        Response.prototype.json = async function instrumentIgnoredTail() {
          const value = await nativeJSON.call(this);
          if (!Array.isArray(value?.threads) || value.threads.length !== 100 || value.nextCursor !== "t_m8x2k1_00003063") return value;
          value.threads = value.threads.map((entry, index) => index < 50 ? entry : new Proxy(entry, {
            get(target, property, receiver) {
              window.__p3cIgnoredTouches.push(`${index - 50}:get:${String(property)}`);
              if (index === 99 && property === "id") return Reflect.get(target, property, receiver);
              throw new Error(`ignored tail property was interpreted: ${index - 50}:${String(property)}`);
            },
            getOwnPropertyDescriptor(target, property) {
              window.__p3cIgnoredTouches.push(`${index - 50}:descriptor:${String(property)}`);
              if (index === 99 && property === "id") return Reflect.getOwnPropertyDescriptor(target, property);
              throw new Error(`ignored tail descriptor was interpreted: ${index - 50}:${String(property)}`);
            },
            getPrototypeOf() { throw new Error(`ignored tail prototype was interpreted: ${index - 50}`); },
            ownKeys() { throw new Error(`ignored tail keys were interpreted: ${index - 50}`); },
          }));
          return value;
        };
      },
      handler: (route) => {
        assert.equal(new URL(route.request().url()).searchParams.has("cursor"), false, "each refresh restarts at page one");
        return route.fulfill({ status: totalStatus, contentType: "application/json", body: totalStatus === 200 ? JSON.stringify(totalResponse) : "" });
      },
    });
    try {
      await activate(totalOverflow.page);
      await waitToggle(totalOverflow.page);
      assert.equal(totalOverflow.requests.length, 1);
      assert.equal(await totalOverflow.page.locator("#doc-comments-toggle").textContent(), "Comments (50)");
      assert.equal(await totalOverflow.page.locator("#doc-comments-truncation").textContent(), "Showing a partial view: 50 threads and 5000 messages loaded; additional results may be available.");
      assert.equal(await totalOverflow.page.locator("article").count(), 50);
      const partialText = await totalOverflow.page.locator("#doc-comments-panel").textContent();
      assert.doesNotMatch(partialText, /INVALID-IGNORED|ignored-tail|ignored\.invalid/);
      assert.equal(await totalOverflow.page.locator("#doc-comments-panel img").count(), 0);
      assert.equal(await totalOverflow.page.evaluate(() => window.fixtureLeak), undefined);
      const ignoredTouches = await totalOverflow.page.evaluate(() => window.__p3cIgnoredTouches);
      assert.ok(ignoredTouches.length >= 1, "the final ignored id is inspected only for the cursor invariant");
      assert.equal(ignoredTouches.every((entry) => /^49:(?:get|descriptor):id$/.test(entry)), true, "no ignored tail value other than the final id is read");
      totalStatus = 500;
      assert.equal(await totalOverflow.page.evaluate(() => window.doc.comments.refresh()), false);
      assert.equal(totalOverflow.requests.length, 2);
      assert.equal(await totalOverflow.page.locator("#doc-comments-truncation").textContent(), "Showing a partial view: 50 threads and 5000 messages loaded; additional results may be available.");
      totalStatus = 200;
      totalResponse = pageOf([totalVisibleRows[0]]);
      assert.equal(await totalOverflow.page.evaluate(() => window.doc.comments.refresh()), true);
      assert.equal(totalOverflow.requests.length, 3);
      assert.equal(await totalOverflow.page.locator("#doc-comments-truncation").getAttribute("hidden"), "");
      assert.equal(await totalOverflow.page.locator("#doc-comments-toggle").textContent(), "Comments (1)");
      assert.deepEqual(totalOverflow.errors, []);
    } finally { await totalOverflow.context.close(); }
  });

  await run("p3a-v1-validation-matrix", async () => {
    const commentBase = () => structuredClone(rows()[0]);
    const discussionBase = () => thread(threadId(0x6100), null, { title: "Invented validation discussion" });
    const resolvedBase = () => thread(threadId(0x6101), quote("a11111111", "aurora ledger keeps one 😀 blue token", 4, "The ", "."), {
      status: "resolved",
      resolvedAt: "2026-01-03T00:00:00.000Z",
      resolvedBy: structuredClone(actor),
    });
    const cases = [];
    const invalidThread = (label, mutate, make = commentBase) => cases.push([label, () => {
      const value = make();
      mutate(value);
      return pageOf([value]);
    }]);

    cases.push(
      ["page null", () => null],
      ["page missing threads", () => ({ nextCursor: null })],
      ["page missing cursor", () => ({ threads: [commentBase()] })],
      ["page extra key", () => ({ threads: [commentBase()], nextCursor: null, extra: true })],
      ["page threads type", () => ({ threads: {}, nextCursor: null })],
      ["page cursor type", () => ({ threads: [commentBase()], nextCursor: 7 })],
      ["page null thread", () => pageOf([null])],
      ["page array thread", () => pageOf([[]])],
      ["page above 100 threads", () => pageOf(Array.from({ length: 101 }, (_, index) => thread(threadId(0x6200 + index), null)))],
      ["empty page with cursor", () => pageOf([], threadId(0x6200))],
      ["cursor grammar", () => pageOf([commentBase()], "bad")],
      ["cursor/final id mismatch", () => pageOf([commentBase()], threadId(0x6201))],
      ["page duplicate id", () => { const value = commentBase(); return pageOf([value, structuredClone(value)]); }],
      ["page descending id", () => pageOf([thread(threadId(0x6203), null), thread(threadId(0x6202), null)])],
    );

    const threadKeys = ["v", "id", "docId", "kind", "status", "section", "anchor", "title", "docVersion", "createdAt", "author", "resolvedAt", "resolvedBy", "comments"];
    for (const key of threadKeys) invalidThread(`thread missing ${key}`, (value) => { delete value[key]; });
    invalidThread("thread extra key", (value) => { value.extra = true; });
    for (const [label, mutate] of [
      ["version type/value", (value) => { value.v = "1"; }],
      ["version enum", (value) => { value.v = 2; }],
      ["thread id type", (value) => { value.id = 7; }],
      ["thread id grammar", (value) => { value.id = "t_BAD"; }],
      ["document id type", (value) => { value.docId = 7; }],
      ["document id grammar", (value) => { value.docId = "ABC123"; }],
      ["cross-document id", (value) => { value.docId = "ffffff"; }],
      ["kind type", (value) => { value.kind = null; }],
      ["kind enum", (value) => { value.kind = "note"; }],
      ["status type", (value) => { value.status = null; }],
      ["status enum", (value) => { value.status = "closed"; }],
      ["section type", (value) => { value.section = 7; }],
      ["section empty", (value) => { value.section = ""; }],
      ["section length", (value) => { value.section = "a".repeat(64); }],
      ["section edge hyphen", (value) => { value.section = "-section"; }],
      ["section grammar", (value) => { value.section = "Bad Section"; }],
      ["document version type", (value) => { value.docVersion = 7; }],
      ["document version grammar", (value) => { value.docVersion = "12345678"; }],
      ["created timestamp type", (value) => { value.createdAt = 7; }],
      ["created timestamp grammar", (value) => { value.createdAt = "2026-01-02"; }],
      ["created timestamp round trip", (value) => { value.createdAt = "2026-02-30T03:04:05.000Z"; }],
      ["comments type", (value) => { value.comments = {}; }],
      ["comments empty", (value) => { value.comments = []; }],
      ["comments sparse/null member", (value) => { value.comments = [null]; }],
      ["comments above P3-A cap", (value) => { value.comments = notes(501, "Invented validation overflow"); }],
    ]) invalidThread(label, mutate);

    const actorKeys = ["sub", "name", "email"];
    for (const key of actorKeys) invalidThread(`thread actor missing ${key}`, (value) => { delete value.author[key]; });
    invalidThread("thread actor extra key", (value) => { value.author.extra = true; });
    for (const [label, mutate] of [
      ["actor sub type", (value) => { value.author.sub = 7; }],
      ["actor sub grammar", (value) => { value.author.sub = "_reader"; }],
      ["actor name type", (value) => { value.author.name = null; }],
      ["actor name length", (value) => { value.author.name = "n".repeat(201); }],
      ["actor email type", (value) => { value.author.email = null; }],
      ["actor email case", (value) => { value.author.email = "ROWAN@READER.EXAMPLE"; }],
      ["actor email trim", (value) => { value.author.email = " rowan@reader.example"; }],
      ["actor email local length", (value) => { value.author.email = `${"a".repeat(65)}@reader.example`; }],
      ["actor email domain grammar", (value) => { value.author.email = "rowan@-reader.example"; }],
    ]) invalidThread(label, mutate);

    const actorMutations = [
      ["object type", (_value, replace) => replace(null)],
      ["missing sub", (value) => { delete value.sub; }],
      ["missing name", (value) => { delete value.name; }],
      ["missing email", (value) => { delete value.email; }],
      ["extra key", (value) => { value.extra = true; }],
      ["sub type", (value) => { value.sub = 7; }],
      ["sub empty", (value) => { value.sub = ""; }],
      ["sub grammar", (value) => { value.sub = "_reader"; }],
      ["sub length", (value) => { value.sub = "u".repeat(129); }],
      ["name type", (value) => { value.name = null; }],
      ["name length", (value) => { value.name = "n".repeat(201); }],
      ["email type", (value) => { value.email = null; }],
      ["email case", (value) => { value.email = "ROWAN@READER.EXAMPLE"; }],
      ["email trim", (value) => { value.email = " rowan@reader.example"; }],
      ["email missing at", (value) => { value.email = "rowan.reader.example"; }],
      ["email multiple at", (value) => { value.email = "rowan@@reader.example"; }],
      ["email empty local", (value) => { value.email = "@reader.example"; }],
      ["email local length", (value) => { value.email = `${"a".repeat(65)}@reader.example`; }],
      ["email domain needs dot", (value) => { value.email = "rowan@reader"; }],
      ["email leading hyphen", (value) => { value.email = "rowan@-reader.example"; }],
      ["email trailing hyphen", (value) => { value.email = "rowan@reader-.example"; }],
      ["email label length", (value) => { value.email = `rowan@${"a".repeat(64)}.example`; }],
      ["email Unicode domain", (value) => { value.email = "rowan@réader.example"; }],
      ["email forbidden local character", (value) => { value.email = "rowan,vale@reader.example"; }],
      ["email total length", (value) => { value.email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`; }],
    ];
    const actorContexts = [
      ["thread actor", commentBase, (value) => value.author, (value, next) => { value.author = next; }],
      ["comment actor", commentBase, (value) => value.comments[0].author, (value, next) => { value.comments[0].author = next; }],
      ["resolved actor", resolvedBase, (value) => value.resolvedBy, (value, next) => { value.resolvedBy = next; }],
    ];
    for (const [context, make, get, replace] of actorContexts) {
      for (const [label, mutate] of actorMutations) {
        invalidThread(`${context} matrix ${label}`, (value) => mutate(get(value), (next) => replace(value, next)), make);
      }
    }

    const commentKeys = ["id", "body", "author", "createdAt", "editedAt"];
    for (const key of commentKeys) invalidThread(`comment missing ${key}`, (value) => { delete value.comments[0][key]; });
    invalidThread("comment extra key", (value) => { value.comments[0].extra = true; });
    for (const key of actorKeys) invalidThread(`comment actor missing ${key}`, (value) => { delete value.comments[0].author[key]; });
    invalidThread("comment actor extra key", (value) => { value.comments[0].author.extra = true; });
    for (const [label, mutate] of [
      ["comment id type", (value) => { value.comments[0].id = 7; }],
      ["comment id grammar", (value) => { value.comments[0].id = "c_BAD"; }],
      ["comment id middle length", (value) => { value.comments[0].id = `c_${"a".repeat(49)}_12345678`; }],
      ["duplicate comment id", (value) => { value.comments.push(structuredClone(value.comments[0])); }],
      ["comment body type", (value) => { value.comments[0].body = 1; }],
      ["comment body empty", (value) => { value.comments[0].body = ""; }],
      ["comment body blank", (value) => { value.comments[0].body = "   "; }],
      ["comment body length", (value) => { value.comments[0].body = "x".repeat(8001); }],
      ["comment author scalar", (value) => { value.comments[0].author.sub = "_reader"; }],
      ["comment created timestamp type", (value) => { value.comments[0].createdAt = 7; }],
      ["comment created timestamp", (value) => { value.comments[0].createdAt = "2026-02-30T03:04:05.000Z"; }],
      ["comment edited type", (value) => { value.comments[0].editedAt = false; }],
      ["comment edited timestamp", (value) => { value.comments[0].editedAt = "2026-01-02"; }],
      ["comment edited timestamp round trip", (value) => { value.comments[0].editedAt = "2026-02-30T03:04:05.000Z"; }],
      ["first author sub mismatch", (value) => { value.comments[0].author.sub = "reader-8"; }],
      ["first author name mismatch", (value) => { value.comments[0].author.name = "Mira Stone"; }],
      ["first author email mismatch", (value) => { value.comments[0].author.email = "mira@reader.example"; }],
      ["first created mismatch", (value) => { value.comments[0].createdAt = "2026-01-02T03:04:06.000Z"; }],
    ]) invalidThread(label, mutate);

    const anchorKeys = ["block", "exact", "prefix", "suffix", "start"];
    for (const key of anchorKeys) invalidThread(`anchor missing ${key}`, (value) => { delete value.anchor[key]; });
    invalidThread("anchor extra key", (value) => { value.anchor.extra = true; });
    for (const [label, mutate] of [
      ["anchor object type", (value) => { value.anchor = 7; }],
      ["anchor block type", (value) => { value.anchor.block = 7; }],
      ["anchor block grammar", (value) => { value.anchor.block = "a123"; }],
      ["anchor exact type", (value) => { value.anchor.exact = 7; }],
      ["anchor exact empty", (value) => { value.anchor.exact = ""; }],
      ["anchor exact normalization", (value) => { value.anchor.exact = " aurora  ledger "; }],
      ["anchor exact length", (value) => { value.anchor.exact = "x".repeat(1001); }],
      ["anchor prefix type", (value) => { value.anchor.prefix = 7; }],
      ["anchor prefix whitespace", (value) => { value.anchor.prefix = "two  spaces"; }],
      ["anchor prefix length", (value) => { value.anchor.prefix = "x".repeat(33); }],
      ["anchor suffix type", (value) => { value.anchor.suffix = 7; }],
      ["anchor suffix whitespace", (value) => { value.anchor.suffix = "\tbad"; }],
      ["anchor suffix length", (value) => { value.anchor.suffix = "x".repeat(33); }],
      ["anchor start type", (value) => { value.anchor.start = "0"; }],
      ["anchor start negative", (value) => { value.anchor.start = -1; }],
      ["anchor start fractional", (value) => { value.anchor.start = 1.5; }],
      ["anchor start unsafe", (value) => { value.anchor.start = Number.MAX_SAFE_INTEGER + 1; }],
    ]) invalidThread(label, mutate);

    invalidThread("comment kind requires anchor", (value) => { value.anchor = null; });
    invalidThread("comment kind forbids title", (value) => { value.title = "Invented title"; });
    invalidThread("discussion kind forbids anchor", (value) => { value.anchor = quote("a11111111", "aurora"); }, discussionBase);
    invalidThread("discussion title type", (value) => { value.title = null; }, discussionBase);
    invalidThread("discussion title blank", (value) => { value.title = "   "; }, discussionBase);
    invalidThread("discussion title length", (value) => { value.title = "x".repeat(201); }, discussionBase);
    invalidThread("open status forbids resolvedAt", (value) => { value.resolvedAt = "2026-01-03T00:00:00.000Z"; });
    invalidThread("open status forbids resolvedBy", (value) => { value.resolvedBy = structuredClone(actor); });
    invalidThread("resolved status requires resolvedAt", (value) => { value.resolvedAt = null; }, resolvedBase);
    invalidThread("resolved status requires resolvedBy", (value) => { value.resolvedBy = null; }, resolvedBase);
    invalidThread("resolved timestamp type", (value) => { value.resolvedAt = false; }, resolvedBase);
    invalidThread("resolved timestamp validates", (value) => { value.resolvedAt = "2026-02-30T00:00:00.000Z"; }, resolvedBase);
    for (const key of actorKeys) invalidThread(`resolved actor missing ${key}`, (value) => { delete value.resolvedBy[key]; }, resolvedBase);
    invalidThread("resolved actor extra key", (value) => { value.resolvedBy.extra = true; }, resolvedBase);
    invalidThread("resolved actor scalar", (value) => { value.resolvedBy.email = "RIVER@READER.EXAMPLE"; }, resolvedBase);

    let matrixResponse = pageOf([commentBase()]);
    const state = await openPage({ handler: (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(matrixResponse) }) });
    try {
      await activate(state.page);
      await waitToggle(state.page);
      assert.equal(await state.page.locator("article").count(), 1);
      for (const [label, build] of cases) {
        matrixResponse = build();
        const before = state.requests.length;
        assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), false, label);
        assert.equal(state.requests.length, before + 1, `${label}: one failed page request`);
        assert.equal(await state.page.locator("article").count(), 1, `${label}: prior valid model retained`);
        assert.equal(await state.page.locator("#doc-comments-status").textContent(), "Comments could not be refreshed.", `${label}: fixed failure status`);
      }
      assert.equal(cases.length, 210, "closed validation matrix case count");
      const maximums = commentBase();
      maximums.id = `t_${"a".repeat(48)}_12345678`;
      maximums.section = `a${"b".repeat(61)}c`;
      maximums.author = { sub: "u".repeat(128), name: "n".repeat(200), email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}` };
      maximums.comments[0] = {
        ...maximums.comments[0],
        id: `c_${"b".repeat(48)}_87654321`,
        body: "x".repeat(8000),
        author: structuredClone(maximums.author),
        editedAt: "2026-01-02T03:04:06.000Z",
      };
      maximums.anchor = { block: "a11111111", exact: "x".repeat(1000), prefix: "p".repeat(32), suffix: "s".repeat(32), start: Number.MAX_SAFE_INTEGER };
      const emptyActorScalars = commentBase();
      emptyActorScalars.author = { ...emptyActorScalars.author, name: "", email: "" };
      emptyActorScalars.comments[0].author = structuredClone(emptyActorScalars.author);
      for (const [label, value] of [
        ["exact scalar maxima", maximums],
        ["empty actor name and email", emptyActorScalars],
        ["resolved coupling", resolvedBase()],
        ["discussion coupling", discussionBase()],
      ]) {
        matrixResponse = pageOf([value]);
        assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), true, label);
        assert.equal(await state.page.locator("article").count(), 1, `${label}: valid record commits`);
      }
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("four-states", async () => {
    const displayActor = { sub: "reader-8", name: "Mira <Stone>", email: "mira@reader.example" };
    const displayId = threadId(7);
    const display = thread(displayId, null, { title: '<img src=x onerror="window.fixtureLeak=1">', author: displayActor, comments: [{ ...note(displayId, "<b>Public fixture text</b>"), author: displayActor }] });
    const state = await openPage({ response: pageOf([...rows(), display]) });
    try {
      await activate(state.page);
      await waitToggle(state.page);
      const text = await state.page.locator("#doc-comments-panel").textContent();
      assert.match(text, /Text changed/);
      assert.match(text, /Moved from its original block/);
      assert.match(text, /Not attached any more/);
      assert.match(text, /absent amber phrase/);
      assert.match(text, /silver path/);
      assert.match(text, /Discussions/);
      assert.match(text, /<b>Public fixture text<\/b>/);
      assert.doesNotMatch(text, /mira@reader\.example/);
      assert.equal(await state.page.locator("#doc-comments-panel img, #doc-comments-panel b").count(), 0);
      assert.equal(await state.page.evaluate(() => window.fixtureLeak), undefined);
      assert.equal(await state.page.locator(".doc-comment-marker").count(), 3);
      assert.equal(await state.page.evaluate(() => [...CSS.highlights.get("doc-comments-open")].length), 2);
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("panel-rail-accessibility-share", async () => {
    const resolved = thread(threadId(8), null, { status: "resolved", title: "Resolved invented discussion", resolvedAt: "2026-01-03T00:00:00.000Z", resolvedBy: actor });
    const panelRows = pageOf([...rows(), resolved]);
    const state = await openPage({ response: panelRows });
    try {
      await activate(state.page);
      await waitToggle(state.page);
      const siblingOrder = await state.page.locator(".head-top").evaluate((node) => [...node.children].map((child) => child.id || child.className || child.textContent.trim()));
      assert.deepEqual(siblingOrder.slice(-2), ["doc-comments-toggle", "share-btn"]);
      const toggle = state.page.locator("#doc-comments-toggle");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(await state.page.getByRole("complementary").count(), 0);
      assert.equal(await state.page.locator("#doc-comments-panel").ariaSnapshot(), "", "hidden panel is absent from the accessibility tree");
      await toggle.focus();
      await state.page.keyboard.press("Space");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await state.page.locator("#doc-comments-filters button").count(), 6);
      const snapshot = await state.page.locator("#doc-comments-panel").ariaSnapshot();
      for (const expected of [
        /complementary "Comments"/i,
        /heading "Comments"/i,
        /button "Close comments"/i,
        /button "Open" \[pressed\]/i,
        /button "Anchored"/i,
        /button "All" \[pressed\]/i,
        /article/i,
        /Rowan Vale/,
        /Text changed/,
        /Moved from its original block/,
        /Not attached any more/,
        /Discussions/,
      ]) assert.match(snapshot, expected);
      assert.match(await state.page.locator(".head-top").ariaSnapshot(), /button "Comments \(6\)" \[expanded\]/i);
      const tops = await state.page.locator(".doc-comment-marker:visible").evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(getComputedStyle(node).top)));
      for (let index = 1; index < tops.length; index += 1) assert.ok(tops[index] - tops[index - 1] >= 24);
      await state.page.locator("#fold summary").click();
      await state.page.waitForFunction(() => !document.querySelector('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]')?.getClientRects().length);
      await state.page.locator("#fold summary").click();
      await state.page.waitForFunction(() => Boolean(document.querySelector('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]')?.getClientRects().length));
      await state.page.evaluate(() => { dispatchEvent(new Event("resize")); location.hash = "#ledger"; });
      await state.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const replacedTops = await state.page.locator(".doc-comment-marker:visible").evaluateAll((nodes) => nodes.map((node) => Number.parseFloat(getComputedStyle(node).top)));
      assert.equal(replacedTops.every(Number.isFinite), true);
      const exactMarker = state.page.locator('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]');
      await exactMarker.focus();
      await state.page.keyboard.press("Enter");
      assert.equal(await state.page.locator("#doc-comments-panel").getAttribute("hidden"), null);
      await state.page.keyboard.press("Escape");
      assert.equal(await state.page.evaluate(() => document.activeElement?.getAttribute("data-thread-id")), "t_m8x2k1_00000001");
      await toggle.focus();
      await state.page.keyboard.press("Enter");
      await state.page.getByRole("button", { name: "Close comments" }).click();
      assert.equal(await state.page.evaluate(() => document.activeElement?.id), "doc-comments-toggle");
      assert.equal(await state.page.getByRole("complementary").count(), 0);
      assert.equal(await state.page.locator("#doc-comments-panel").ariaSnapshot(), "", "closed panel is absent from the accessibility tree");
      await toggle.click();
      const resolvedFilter = state.page.getByRole("button", { name: "Resolved", exact: true });
      await resolvedFilter.focus();
      await state.page.keyboard.press("Enter");
      assert.equal(await resolvedFilter.getAttribute("aria-pressed"), "true");
      const discussionsFilter = state.page.getByRole("button", { name: "Discussions", exact: true });
      await discussionsFilter.focus();
      await state.page.keyboard.press("Space");
      assert.equal(await discussionsFilter.getAttribute("aria-pressed"), "true");
      assert.equal(await state.page.getByText("Resolved invented discussion", { exact: true }).isVisible(), true);
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), true);
      assert.equal(await resolvedFilter.getAttribute("aria-pressed"), "true");
      assert.equal(await discussionsFilter.getAttribute("aria-pressed"), "true");
      assert.equal(await state.page.locator("#doc-comments-panel").getAttribute("hidden"), null);
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("reposition-triggers", async () => {
    const state = await openPage({
      response: pageOf([rows()[0]]),
      init: () => {
        let settleFonts;
        Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise((resolve) => { settleFonts = resolve; }) } });
        window.__p3cSettleFonts = () => settleFonts();
        window.__p3cMarkerCoordinates = () => {
          const marker = document.querySelector('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]');
          const rail = document.querySelector("#doc-comments-rail");
          const host = document.querySelector('[data-aid="a11111111"]');
          if (!marker?.getClientRects().length || !rail || !host) return null;
          const ranges = [
            ...(CSS.highlights.get("doc-comments-open") ?? []),
            ...(CSS.highlights.get("doc-comments-active") ?? []),
          ];
          const range = ranges.find((candidate) => host.contains(candidate.startContainer));
          if (!range) return null;
          const markerRect = marker.getBoundingClientRect();
          const railRect = rail.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          const desiredTop = range.getBoundingClientRect().top - railRect.top;
          const desiredLeft = Math.min(
            Math.max(hostRect.right - railRect.left + 8, 4),
            document.documentElement.scrollWidth - marker.offsetWidth - 4,
          );
          return {
            actualTop: markerRect.top - railRect.top,
            actualLeft: markerRect.left - railRect.left,
            desiredTop,
            desiredLeft,
          };
        };
      },
    });
    const coordinates = () => state.page.evaluate(() => window.__p3cMarkerCoordinates());
    const correct = (value) => value && Math.abs(value.actualTop - value.desiredTop) <= 1.5 && Math.abs(value.actualLeft - value.desiredLeft) <= 1.5;
    const waitForCorrectChange = async (label, before = null) => {
      await state.page.waitForFunction(({ prior }) => {
        const value = window.__p3cMarkerCoordinates();
        return value
          && Math.abs(value.actualTop - value.desiredTop) <= 1.5
          && Math.abs(value.actualLeft - value.desiredLeft) <= 1.5
          && (prior === null || Math.abs(value.actualTop - prior) >= 8);
      }, { prior: before?.actualTop ?? null }, { timeout: 2000 });
      const after = await coordinates();
      assert.equal(correct(after), true, `${label}: marker has correct range-derived coordinates`);
      if (before) assert.ok(Math.abs(after.actualTop - before.actualTop) >= 8, `${label}: marker coordinates changed`);
      return after;
    };
    const moveHost = (pixels) => state.page.locator('[data-aid="a11111111"]').evaluate((node, value) => { node.style.transform = `translateY(${value}px)`; }, pixels);
    try {
      await activate(state.page);
      await waitToggle(state.page);
      let prior = await waitForCorrectChange("initial committed render");

      await moveHost(20);
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), true);
      prior = await waitForCorrectChange("committed refresh", prior);

      await moveHost(40);
      await state.page.locator("#doc-comments-toggle").click();
      prior = await waitForCorrectChange("panel open", prior);

      await moveHost(60);
      await state.page.getByRole("button", { name: "Close comments" }).click();
      prior = await waitForCorrectChange("panel close", prior);

      await state.page.locator("#doc-comments-toggle").click();
      await moveHost(80);
      await state.page.locator('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]').click();
      prior = await waitForCorrectChange("active-thread change", prior);

      await moveHost(100);
      await state.page.setViewportSize({ width: 1180, height: 850 });
      prior = await waitForCorrectChange("window resize", prior);

      await moveHost(120);
      await state.page.evaluate(() => { location.hash = "#ledger"; });
      prior = await waitForCorrectChange("hash change", prior);

      await moveHost(140);
      await state.page.evaluate(() => window.__p3cSettleFonts());
      prior = await waitForCorrectChange("document.fonts.ready", prior);

      await state.page.locator("#fold summary").click();
      await state.page.waitForFunction(() => !document.querySelector('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]')?.getClientRects().length);
      await moveHost(160);
      await state.page.locator("#fold summary").click();
      await waitForCorrectChange("captured disclosure toggle", prior);
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }
  });

  await run("fallback-rendered-modes", async () => {
    const state = await openPage({
      response: pageOf([rows()[0], rows()[2]]),
      init: () => Object.defineProperty(CSS, "highlights", { configurable: true, value: null }),
    });
    const channel = (value) => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      assert.ok(match, `expected computed rgb colour, got ${value}`);
      return match[1].split(/[, /]+/).filter(Boolean).slice(0, 3).map(Number);
    };
    const luminance = (value) => channel(value).map((part) => part / 255).map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4).reduce((sum, part, index) => sum + part * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = ({ color, backgroundColor }) => {
      const values = [luminance(color), luminance(backgroundColor)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const style = (locator, pseudo = null) => locator.evaluate((node, suffix) => {
      const computed = getComputedStyle(node, suffix);
      return {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        display: computed.display,
        position: computed.position,
        borderStyle: computed.borderStyle,
        borderWidth: computed.borderWidth,
        borderInlineStartColor: computed.borderInlineStartColor,
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineColor: computed.outlineColor,
        boxShadow: computed.boxShadow,
        animationDuration: computed.animationDuration,
        transitionDuration: computed.transitionDuration,
      };
    }, pseudo);
    const transparent = (value) => value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value);
    const width = (value) => Number.parseFloat(value);
    const maxWidth = (value) => Math.max(...value.split(" ").map(Number.parseFloat));
    const maxDuration = (value) => Math.max(...value.split(",").map((part) => part.trim().endsWith("ms") ? Number.parseFloat(part) : Number.parseFloat(part) * 1000));
    const decorated = (value) => (value.borderStyle !== "none" && maxWidth(value.borderWidth) >= 1) || (value.outlineStyle !== "none" && width(value.outlineWidth) >= 1) || value.boxShadow !== "none" || !transparent(value.backgroundColor);
    try {
      assert.equal(await state.page.locator("head style").count(), 0, "fixture does not override production motion CSS");
      const exact = state.page.locator('[data-aid="a11111111"]');
      const moved = state.page.locator('[data-aid="a33333333"]');
      const before = await exact.innerHTML();
      const movedBefore = await moved.innerHTML();
      await activate(state.page);
      await waitToggle(state.page);
      assert.equal(await state.page.locator(".doc-comment-block").count(), 2);
      assert.equal(await state.page.locator(".doc-comment-block-active").count(), 0);
      assert.equal(decorated(await style(moved)), true, "base fallback has rendered decoration");
      await state.page.locator('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]').click();
      assert.equal(await exact.evaluate((node) => node.classList.contains("doc-comment-block")), true);
      assert.equal(await exact.evaluate((node) => node.classList.contains("doc-comment-block-active")), true);
      assert.equal(decorated(await style(exact)), true, "active fallback has rendered decoration");
      assert.equal(await exact.innerHTML(), before);
      assert.equal(await moved.innerHTML(), movedBefore);

      const panel = state.page.locator("#doc-comments-panel");
      const rail = state.page.locator("#doc-comments-rail");
      const desktopBox = await panel.boundingBox();
      const desktopStyle = await style(panel);
      assert.ok(desktopBox);
      assert.equal(desktopStyle.position, "fixed");
      assert.ok(Math.abs(desktopBox.x + desktopBox.width - 1280) <= 1);
      assert.ok(Math.abs(desktopBox.y) <= 1 && Math.abs(desktopBox.height - 900) <= 1);
      assert.ok(desktopBox.width <= 416.5 && desktopBox.width <= 1280 * 0.4 + 0.5);
      assert.notEqual((await style(rail)).display, "none");
      assert.ok(Math.max(maxDuration(desktopStyle.animationDuration),maxDuration(desktopStyle.transitionDuration))>0,"production no-preference panel motion is positive");

      await state.page.keyboard.press("Escape");
      const toggle = state.page.locator("#doc-comments-toggle");
      await toggle.focus();
      await state.page.keyboard.press("Enter");
      await state.page.keyboard.press("Tab");
      const close = state.page.locator("#doc-comments-close");
      assert.equal(await state.page.evaluate(() => document.activeElement?.id), "doc-comments-close");
      const focused = await style(close);
      assert.notEqual(focused.outlineStyle, "none");
      assert.ok(width(focused.outlineWidth) >= 2);

      await state.page.emulateMedia({ colorScheme: "light" });
      const light = await style(panel);
      assert.equal(transparent(light.backgroundColor), false);
      assert.ok(contrast(light) >= 4.5, `light contrast ${contrast(light)}`);
      await state.page.emulateMedia({ colorScheme: "dark" });
      const dark = await style(panel);
      assert.equal(transparent(dark.backgroundColor), false);
      assert.ok(contrast(dark) >= 4.5, `dark contrast ${contrast(dark)}`);
      assert.notEqual(light.backgroundColor, dark.backgroundColor);

      await state.page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", forcedColors: "none" });
      const reducedPanel = await style(panel);
      assert.equal(maxDuration(reducedPanel.animationDuration),0,"production reduced-motion animation is zero");
      assert.equal(maxDuration(reducedPanel.transitionDuration),0,"production reduced-motion transition is zero");

      await state.page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", forcedColors: "active" });
      const forcedPanel = await style(panel);
      const forcedFocus = await style(close);
      assert.notEqual(forcedPanel.borderStyle, "none");
      assert.ok(maxWidth(forcedPanel.borderWidth) >= 1);
      assert.notEqual(forcedFocus.outlineStyle, "none");
      assert.ok(width(forcedFocus.outlineWidth) >= 2);
      assert.equal(decorated(await style(moved)), true, "forced-colors fallback remains rendered");
      assert.equal(maxDuration(forcedPanel.animationDuration),0);
      assert.equal(maxDuration(forcedPanel.transitionDuration),0);

      await state.page.setViewportSize({ width: 390, height: 844 });
      const box = await panel.boundingBox();
      assert.ok(box);
      assert.ok(Math.abs(box.x) <= 1 && Math.abs(box.width - 390) <= 1);
      assert.ok(Math.abs(box.y + box.height - 844) <= 1 && box.height <= 844 * 0.6 + 1);
      assert.equal((await style(panel)).position, "fixed");
      assert.equal((await style(rail)).display, "none");
      assert.equal(await state.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
      assert.match(await state.page.locator("#doc-comments-panel").textContent(), /Rowan Vale/);

      await state.page.emulateMedia({ media: "print", colorScheme: "light", reducedMotion: "no-preference", forcedColors: "none" });
      for (const selector of ["#doc-comments-toggle", "#doc-comments-panel", "#doc-comments-rail"]) {
        assert.equal(await state.page.locator(selector).evaluate((node) => getComputedStyle(node).display), "none");
      }
      for (const block of [exact, moved]) {
        const printed = await style(block);
        assert.equal(transparent(printed.borderInlineStartColor), true);
        assert.equal(transparent(printed.outlineColor), true);
        assert.equal(transparent(printed.backgroundColor), true);
        assert.equal(printed.boxShadow, "none");
      }
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }

    const highlight = await openPage({ response: pageOf([rows()[0], rows()[2]]) });
    try {
      await activate(highlight.page);
      await waitToggle(highlight.page);
      await highlight.page.locator('.doc-comment-marker[data-thread-id="t_m8x2k1_00000001"]').click();
      assert.deepEqual(await highlight.page.evaluate(() => ({
        open: [...CSS.highlights.get("doc-comments-open")].length,
        active: [...CSS.highlights.get("doc-comments-active")].length,
      })), { open:1, active:1 });
      await highlight.page.emulateMedia({ media: "print" });
      const printedOpen = await style(highlight.page.locator('[data-aid="a33333333"]'), "::highlight(doc-comments-open)");
      const printedActive = await style(highlight.page.locator('[data-aid="a11111111"]'), "::highlight(doc-comments-active)");
      assert.equal(transparent(printedOpen.backgroundColor), true);
      assert.equal(transparent(printedActive.backgroundColor), true);
      assert.notEqual(await highlight.page.locator('[data-aid="a11111111"]').evaluate((node) => getComputedStyle(node).display), "none");
      assert.deepEqual(highlight.errors, []);
    } finally { await highlight.context.close(); }
  });

  await run("whole-pass-deadline", async () => {
    const first = Array.from({ length: 100 }, (_, index) => thread(threadId(0x4000 + index), null, { title: `Invented deadline discussion ${index + 1}` }));
    const cursor = first.at(-1).id;
    let releaseSecond;
    const state = await openPage({
      init: () => {
        const NativeAbortController = AbortController;
        window.__p3cDeadlineRecords = [];
        window.AbortController = class extends NativeAbortController {
          constructor() {
            super();
            const record = { start: performance.now(), aborted: null };
            window.__p3cDeadlineRecords.push(record);
            this.signal.addEventListener("abort", () => { record.aborted = performance.now(); }, { once: true });
          }
        };
      },
      handler: async (route, number) => {
        if (number === 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf(first, cursor)) });
          return;
        }
        assert.equal(number, 2, "deadline pass may start only its second page");
        await new Promise((resolve) => { releaseSecond = resolve; });
        try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([])) }); } catch {}
      },
    });
    try {
      await activate(state.page);
      await state.page.waitForFunction(() => window.__p3cDeadlineRecords[0]?.aborted !== null, null, { timeout: 7500 });
      const timing = await state.page.evaluate(() => ({
        count: window.__p3cDeadlineRecords.length,
        elapsed: window.__p3cDeadlineRecords[0].aborted - window.__p3cDeadlineRecords[0].start,
      }));
      assert.equal(timing.count, 1, "one AbortController covers the whole cursor pass");
      assert.ok(timing.elapsed >= 4750 && timing.elapsed <= 7000, `whole pass aborted near five seconds: ${timing.elapsed}`);
      assert.equal(state.requests.length, 2);
      releaseSecond();
      await state.page.waitForTimeout(100);
      assert.equal(await state.page.locator("#doc-comments-toggle").count(), 0);
      assert.deepEqual(state.errors, []);
    } finally {
      releaseSecond?.();
      await state.context.close();
    }
  });

  await run("lifecycle-refresh", async () => {
    let current = pageOf([]);
    let held = false;
    const releases = [];
    const waitForRequestCount = async (requests, count) => {
      for (let tick = 0; tick < 100 && requests.length < count; tick += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(requests.length, count);
    };
    const state = await openPage({
      share: false,
      init: () => {
        let clock = 0;
        let visibility = "hidden";
        Object.defineProperty(performance, "now", { configurable: true, value: () => clock });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
        window.__p3cVisibility = (nextVisibility, nextClock) => {
          clock = nextClock;
          visibility = nextVisibility;
          document.dispatchEvent(new Event("visibilitychange"));
        };
      },
      handler: async (route) => {
        if (held) await new Promise((resolve) => releases.push(resolve));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(current) });
      },
    });
    try {
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), false);
      assert.equal(state.requests.length, 0);
      assert.equal(await state.page.locator("#doc-comments-toggle").count(), 0);
      await activate(state.page);
      await waitToggle(state.page);
      assert.equal(state.requests.length, 1);
      assert.equal(await state.page.locator("#doc-comments-toggle").textContent(), "Comments (0)");
      assert.equal(await state.page.locator(".head-top > :last-child").getAttribute("id"), "doc-comments-toggle");
      await activate(state.page);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(state.requests.length, 1);
      current = pageOf([rows()[0]]);
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), true);
      assert.equal(await state.page.locator(".doc-comment-marker").count(), 1);
      held = true;
      const batchStart = state.requests.length;
      await state.page.evaluate(() => { window.__p3cFirst = window.doc.comments.refresh(); window.__p3cSecond = window.doc.comments.refresh(); });
      await waitForRequestCount(state.requests, batchStart + 1);
      releases.shift()();
      await waitForRequestCount(state.requests, batchStart + 2);
      await state.page.evaluate(() => { window.__p3cThird = window.doc.comments.refresh(); });
      releases.shift()();
      await state.page.evaluate(() => Promise.all([window.__p3cFirst, window.__p3cSecond]));
      await waitForRequestCount(state.requests, batchStart + 3);
      releases.shift()();
      await state.page.waitForTimeout(50);
      held = false;
      assert.equal(state.requests.length, batchStart + 3);
      const beforeVisibility = state.requests.length;
      await state.page.evaluate(() => window.__p3cVisibility("hidden", 90));
      await state.page.waitForTimeout(50);
      assert.equal(state.requests.length, beforeVisibility, "hidden transition does not refresh");
      await state.page.evaluate(() => window.__p3cVisibility("visible", 100));
      await waitForRequestCount(state.requests, beforeVisibility + 1);
      await state.page.evaluate(() => window.__p3cVisibility("hidden", 150));
      await state.page.waitForTimeout(50);
      await state.page.evaluate(() => window.__p3cVisibility("visible", 200));
      await state.page.waitForTimeout(50);
      assert.equal(state.requests.length, beforeVisibility + 1, "second visible transition inside 30 seconds is throttled");
      await state.page.evaluate(() => window.__p3cVisibility("hidden", 30000));
      await state.page.waitForTimeout(50);
      await state.page.evaluate(() => window.__p3cVisibility("visible", 30100));
      await waitForRequestCount(state.requests, beforeVisibility + 2);
      for (const request of state.requests) {
        assert.equal(request.method, "GET");
        assert.equal(new URL(request.url).searchParams.get("doc"), docId);
        assert.equal(request.headers.accept, "application/json");
      }
      await state.page.unroute("**/api/threads?*");
      await state.page.route("**/api/threads?*", (route) => route.fulfill({ status: 500, body: "" }));
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), false);
      assert.equal(await state.page.locator("#doc-comments-toggle").count(), 1);
      assert.equal(await state.page.locator("#doc-comments-status").textContent(), "Comments could not be refreshed.");
      await state.page.unroute("**/api/threads?*");
      await state.page.route("**/api/threads?*", (route) => route.fulfill({ status: 401, body: "" }));
      assert.equal(await state.page.evaluate(() => window.doc.comments.refresh()), false);
      assert.equal(await state.page.locator("#doc-comments-toggle").count(), 0);
      assert.deepEqual(state.errors, []);
    } finally { await state.context.close(); }

    const malformed = await openPage({ response: pageOf([{ v: 1, id: "broken" }]) });
    try {
      await activate(malformed.page);
      await malformed.page.waitForTimeout(100);
      assert.equal(await malformed.page.locator("#doc-comments-toggle").count(), 0);
      assert.deepEqual(malformed.errors, []);
    } finally { await malformed.context.close(); }

    const wrongDoc = structuredClone(rows()[0]);
    wrongDoc.docId = "ffffff";
    const duplicateThread = rows()[0];
    const invalidAnchor = structuredClone(rows()[0]);
    invalidAnchor.anchor.exact = "";
    for (const options of [
      { head: false },
      { duplicate: true },
      { response: pageOf([wrongDoc]) },
      { response: pageOf([duplicateThread, duplicateThread]) },
      { response: pageOf([invalidAnchor]) },
    ]) {
      const invalid = await openPage(options);
      try {
        await activate(invalid.page);
        await invalid.page.waitForTimeout(100);
        assert.equal(await invalid.page.locator("#doc-comments-toggle").count(), 0);
        assert.deepEqual(invalid.errors, []);
      } finally { await invalid.context.close(); }
    }

    for (const environment of [
      { doc: "missing", core: true, primitive: true },
      { doc: "empty", core: true, primitive: true },
      { doc: "valid", core: false, primitive: true },
      { doc: "valid", core: true, primitive: false },
    ]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      let requests = 0;
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      if (!environment.primitive) await page.addInitScript(() => Object.defineProperty(window, "AbortController", { configurable: true, value: undefined }));
      await page.route("**/api/threads?*", (route) => { requests += 1; return route.fulfill({ status: 200, contentType: "application/json", body: '{"threads":[],"nextCursor":null}' }); });
      try {
        await page.goto(`${origin}/fixture?doc=${environment.doc}&core=${environment.core ? 1 : 0}`);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.doc?.comments), undefined);
        assert.equal(await page.locator("#doc-comments-toggle").count(), 0);
        assert.equal(requests, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });

  await run("offline-schemes", async () => {
    assert.equal(/<\/script/i.test(commentsJS), false, "comments source is safe in the disposable inline module");
    const encoded = Buffer.from(commentsJS).toString("base64");
    const protocolFixture = `<!doctype html><meta name="doc-id" content="${docId}"><div class="head-top"></div><script>
      window.__p3cProtocolReads = [];
      const nativeQuery = document.querySelector.bind(document);
      window.__p3cOfflineProbe = () => ({ reads: [...window.__p3cProtocolReads], toggle: Number(Boolean(nativeQuery("#doc-comments-toggle"))) });
      const poison = (name, value) => Object.defineProperty(window, name, { configurable: true, get() { window.__p3cProtocolReads.push(name); return value; } });
      poison("doc", { anchor: { BLOCK: [], norm: (value) => value } });
      poison("fetch", () => Promise.reject(new Error("offline fetch must not be read")));
      poison("AbortController", class {});
      Object.defineProperty(document, "querySelector", { configurable: true, get() { window.__p3cProtocolReads.push("querySelector"); return nativeQuery; } });
      Object.defineProperty(document, "createTreeWalker", { configurable: true, get() { window.__p3cProtocolReads.push("createTreeWalker"); return () => {}; } });
    <\/script>`;
    const offline = `${protocolFixture}<script type="module">import("data:text/javascript;base64,${encoded}")</script>`;
    const offlinePath = join(root, "offline.html");
    writeFileSync(offlinePath, offline, { mode: 0o600 });
    chmodSync(offlinePath, 0o600);

    const check = async (kind, navigate) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));
      try {
        await navigate(page, offline);
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => window.__p3cOfflineProbe()), { reads: [], toggle: 0 }, `${kind}: protocol gate precedes metadata and prerequisites`);
        assert.deepEqual(errors, [], kind);
        assert.equal(requests.some((url) => url.includes("/api/threads")), false, kind);
      } finally { await context.close(); }
    };
    await check("file", (page) => page.goto(`file://${offlinePath}`));
    await check("data", (page, source) => page.goto(`data:text/html;base64,${Buffer.from(source).toString("base64")}`));
    await check("about", async (page) => { await page.goto("about:blank"); await page.setContent(protocolFixture); await page.addScriptTag({ type: "module", content: `import("data:text/javascript;base64,${encoded}")` }); });
    await check("blob", async (page, source) => {
      await page.goto(`${origin}/blank`);
      await page.evaluate((markup) => { location.href = URL.createObjectURL(new Blob([markup], { type: "text/html" })); }, source);
      await page.waitForURL(/^blob:/);
    });
  });

  console.log("PASS  P3-C browser fixture");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
RUNNER

command cat >"$P3C_ROOT/supervisor.mjs" <<'SUPERVISOR'
import { closeSync, chmodSync, constants, fsyncSync, lstatSync, openSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { fork, spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = realpathSync(process.env.P3C_ROOT);
const repo = realpathSync(process.env.P3C_REPO);
const temp = realpathSync(tmpdir());
const evidence = join(root, "owner.json");
const info = lstatSync(root);
if (dirname(root) !== temp || !/^p3-c-browser\.[A-Za-z0-9]{6}$/.test(basename(root)) || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
  throw new Error(`unsafe fixture root: ${root}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let signalStatus = 0;
let wakeSignal;
const signalPromise = new Promise((resolve) => { wakeSignal = resolve; });
for (const [name, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(name, () => {
    if (signalStatus === 0) {
      signalStatus = status;
      wakeSignal({ kind: "signal" });
    }
  });
}

function atomicEvidence(phase, leader) {
  const next = `${evidence}.new`;
  const payload = `${JSON.stringify({ root, supervisorPid: process.pid, leaderPgid: leader, phase, remediation: leader ? `/bin/ps -o pid=,pgid= -p ${leader}; verify PID equals PGID before any kill -- -${leader}` : "inspect root; no group signal is authorized" }, null, 2)}\n`;
  const fd = openSync(next, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    chmodSync(next, 0o600);
  } finally { closeSync(fd); }
  renameSync(next, evidence);
  const dirfd = openSync(root, constants.O_RDONLY);
  try { fsyncSync(dirfd); } finally { closeSync(dirfd); }
}

function retained(child) {
  let closed = false;
  child.on("error", () => {});
  const close = new Promise((resolve) => child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); }));
  return { child, close, isClosed: () => closed };
}
function message(owner, type) {
  return new Promise((resolve) => {
    const onMessage = (value) => { if (value?.type === type) { cleanup(); resolve(value); } };
    const onClose = (code, signal) => { cleanup(); resolve({ type: "closed", code, signal }); };
    const cleanup = () => { owner.child.off("message", onMessage); owner.child.off("close", onClose); };
    owner.child.on("message", onMessage);
    owner.child.on("close", onClose);
  });
}
function currentLeader(owner) {
  if (owner.isClosed() || owner.child.exitCode !== null || owner.child.signalCode !== null) return false;
  const result = spawnSync("/bin/ps", ["-o", "pid=,pgid=", "-p", String(owner.child.pid)], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const match = result.stdout.trim().match(/^(\d+)\s+(\d+)$/);
  return Boolean(match && Number(match[1]) === owner.child.pid && Number(match[2]) === owner.child.pid);
}
function groupMembers(pgid) {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("cannot inspect process groups");
  return result.stdout.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)$/)).filter(Boolean).filter((match) => Number(match[2]) === pgid).map((match) => Number(match[1]));
}
async function waitGroupGone(pgid) {
  try {
    for (let tick = 0; tick < 50; tick += 1) {
      if (groupMembers(pgid).length === 0) return true;
      await delay(100);
    }
  } catch {}
  return false;
}
async function stop(owner, anchored) {
  try {
    if (!owner.isClosed()) {
      if (!anchored) {
        owner.child.kill("SIGTERM");
      } else {
        if (!currentLeader(owner)) return false;
        try { process.kill(-owner.child.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
      }
      await Promise.race([owner.close, delay(5000)]);
    }
    if (!owner.isClosed()) {
      if (!anchored || currentLeader(owner)) {
        if (anchored) {
          try { process.kill(-owner.child.pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
        } else owner.child.kill("SIGKILL");
      } else return false;
      await Promise.race([owner.close, delay(5000)]);
    }
    if (!owner.isClosed()) return false;
    return anchored ? waitGroupGone(owner.child.pid) : true;
  } catch {
    return false;
  }
}
const mapResult = (value) => value.signal ? ({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 }[value.signal] ?? 1) : (Number.isInteger(value.code) ? value.code : 1);

async function deleteRoot() {
  const child = fork(join(root, "launcher.mjs"), [], { cwd: repo, detached: true, stdio: ["ignore", "ignore", "inherit", "ipc"], env: { ...process.env, P3C_LAUNCH_MODE: "delete" } });
  const owner = retained(child);
  let anchored = false;
  try {
    const ready = await Promise.race([message(owner, "ready"), delay(5000).then(() => ({ type: "timeout" }))]);
    if (ready.type !== "ready" || ready.pid !== child.pid || !currentLeader(owner)) {
      await stop(owner, false);
      return false;
    }
    anchored = true;
    atomicEvidence("deleting", child.pid);
    const resultPromise = message(owner, "result");
    child.send({ type: "go" });
    const result = await Promise.race([resultPromise, delay(30000).then(() => ({ type: "timeout" }))]);
    if (result.type === "timeout") {
      await stop(owner, true);
      return false;
    }
    await Promise.race([owner.close, delay(5000)]);
    if (!owner.isClosed() || !(await waitGroupGone(child.pid)) || mapResult(result) !== 0) return false;
    try { lstatSync(root); return false; } catch (error) { return error?.code === "ENOENT"; }
  } catch {
    await stop(owner, anchored);
    return false;
  }
}

let status = 1;
let retainReason = "";
const child = fork(join(root, "launcher.mjs"), [], { cwd: repo, detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"], env: { ...process.env, P3C_LAUNCH_MODE: "browser" } });
const owner = retained(child);
let anchored = false;
try {
  const ready = await Promise.race([message(owner, "ready"), signalPromise, delay(5000).then(() => ({ kind: "ready-timeout" }))]);
  if (ready?.kind === "signal") {
    status = signalStatus;
  } else if (ready?.type !== "ready" || ready.pid !== child.pid || !currentLeader(owner)) {
    status = 1;
    retainReason = "launcher did not publish an authenticated PID=PGID anchor";
  } else {
    anchored = true;
    atomicEvidence("ready", child.pid);
    const resultPromise = message(owner, "result");
    atomicEvidence("running", child.pid);
    child.send({ type: "go" });
    const result = await Promise.race([resultPromise, signalPromise, delay(900000).then(() => ({ kind: "deadline" }))]);
    if (result?.kind === "signal") status = signalStatus;
    else if (result?.kind === "deadline") status = 124;
    else status = mapResult(result);
  }
} catch (error) {
  status = 1;
  retainReason = `supervisor failure: ${String(error)}`;
}

if (!(await stop(owner, anchored))) retainReason ||= "owned browser group did not disappear after leader close";
if (retainReason) {
  console.error(`FAIL  P3-C retained ${root}: ${retainReason}; inspect ${evidence}`);
  process.exit(signalStatus || status || 1);
}
try { atomicEvidence("group-gone", 0); } catch (error) {
  console.error(`FAIL  P3-C retained ${root}: evidence update failed: ${String(error)}`);
  process.exit(signalStatus || status || 1);
}
if (!(await deleteRoot())) {
  console.error(`FAIL  P3-C deletion failed or timed out; inspect ${root}`);
  process.exit(signalStatus || status || 1);
}
await new Promise((resolve) => setImmediate(resolve));
const finalStatus = signalStatus || status;
if (finalStatus === 0) console.log("PASS  P3-C browser fixture cleaned");
process.exit(finalStatus);
SUPERVISOR

chmod 600 "$P3C_ROOT/launcher.mjs" "$P3C_ROOT/runner.mjs" "$P3C_ROOT/supervisor.mjs"
exec node "$P3C_ROOT/supervisor.mjs"
```

Expected: npm/Chromium installation may print ordinary progress. The command exits `0` only after these lines occur in order and the retained launcher has closed its IPC channel, its process group is absent, the separately anchored deletion child has closed, and the exact private root is absent:

```text
PASS  P3-C mapping
PASS  P3-C read-only-downstream-boundary
PASS  P3-C occurrence-score
PASS  P3-C pagination
PASS  P3-C p3a-v1-validation-matrix
PASS  P3-C four-states
PASS  P3-C panel-rail-accessibility-share
PASS  P3-C reposition-triggers
PASS  P3-C fallback-rendered-modes
PASS  P3-C whole-pass-deadline
PASS  P3-C lifecycle-refresh
PASS  P3-C offline-schemes
PASS  P3-C browser fixture
PASS  P3-C browser fixture cleaned
```

The AST assertions run before browser startup against the complete owned module and are the structural half of AC-03/AC-13. `read-only-downstream-boundary` then executes normal activation, exact GET construction, forbidden downstream events, and a refresh error with throwing transport/storage/form/element/event/global sinks installed before module evaluation; it requires zero touches and no write UI. `p3a-v1-validation-matrix` starts from one valid committed thread and executes exactly 210 invalid page/thread/comment/actor/anchor mutations, including the same complete 25-case actor matrix in thread-author, comment-author, and resolved-author positions; every exact key/type plus each documented scalar, timestamp, status/resolution, kind/anchor/title, and first-comment coupling class is exercised. Each invalid case must return false, make one request, keep the prior card, and show only the fixed refresh-failure status; four positive records exercise maxima, empty actor strings, resolved coupling, and discussion coupling. The `pagination` line is mandatory and occurs only after Chromium has executed the ordinary two-page chain; a valid full page followed by P3-A's short comment-bounded page; complete validation and omission of the first valid thread that would cross the client's remaining total; rejection of that boundary thread when malformed; an exact 5000-comment short page with a non-null cursor that is visibly partial without another request; a valid five-page 501-thread server state; the accepted exact 500-comment P3-A boundary; rejection of a retained 501-comment protocol violation; and an exact 5000-comment retained prefix followed by adversarial-invalid ignored records. Those cases prove 1–100-thread non-null cursor acceptance, exact exclusive cursor following, deterministic prefix counts, exact visible truncation notes, no sixth-page request, no interpretation or rendering of the ignored tail, boundary validation, partial-success return behavior, failed-refresh retention, and complete-refresh replacement. `reposition-triggers` separately changes document geometry and proves correct new range-derived coordinates after initial/refresh commits, panel open, panel close, active selection, resize, hash change, controlled font readiness, and captured disclosure toggle. `whole-pass-deadline` instruments the one controller, delays page one by three seconds, stalls page two, and dynamically observes abort about five seconds after the pass began rather than five seconds per page. `panel-rail-accessibility-share` checks exact exposed headings, buttons, articles, state labels/groups, and absence of the hidden panel in Chromium's accessibility tree. `fallback-rendered-modes` executes both fallback classes, focus-visible outline, light/dark contrast, forced colours, production reduced-motion rules without a fixture override, desktop and narrow geometry, fallback print removal, and custom-highlight print transparency through rendered/computed results; it is not a stylesheet-token oracle. `lifecycle-refresh` proves the first hidden→visible edge refreshes, a second edge inside 30 seconds does not, and an edge after the window refreshes. `offline-schemes` poisons metadata and prerequisite getters and observes that none are touched on any excluded protocol. Every page/case contains invented public fixtures only. The launcher starts no npm, server, browser, or fixture worker before its exact retained direct PID is proved to be the process-group leader and durable `ready` evidence exists. HUP/INT/TERM map to 129/130/143 with first-signal precedence; the 900-second workload and 30-second deletion deadlines are finite. TERM→five-second→KILL escalation is permitted only while the retained leader is still live and a fresh PID=PGID query succeeds. Leader close includes IPC/stdout/stderr closure; after it, the numeric process-group id is never signalled again. Any surviving group, anchor/evidence failure, or deletion failure retains the mode-`0700` exact root and mode-`0600` evidence with a verify-before-signal remediation, and exits nonzero. Recursive deletion begins only after browser-group disappearance and runs below a separately retained, freshly authenticated deletion leader.

### T7 — final repository and issue gates

```bash
set -euo pipefail
templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P3-C.md templates/base/comments.js templates/base/comments.css
git diff --check -- docs/tickets/P3-C.md templates/base/comments.js templates/base/comments.css
: "${P3C_BASE:?export P3C_BASE as the exact integrated P3-A predecessor commit}"
P3C_BASE_COMMIT="$(git rev-parse --verify "${P3C_BASE}^{commit}")"
export P3C_BASE_COMMIT
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const run = (args) => execFileSync("git", args, { encoding:"utf8" }).split("\n").filter(Boolean);
const changed = new Set([
  ...run(["diff", "--name-only", process.env.P3C_BASE_COMMIT, "--"]),
  ...run(["ls-files", "--others", "--exclude-standard"]),
]);
const owned = ["templates/base/comments.css", "templates/base/comments.js"];
for (const path of changed) {
  if (path.startsWith("docs/tickets/")) continue;
  assert.ok(owned.includes(path), `unexpected P3-C implementation path: ${path}`);
}
assert.deepEqual(owned.filter((path) => changed.has(path)), owned, "both and only P3-C source assets must change");
console.log("PASS  P3-C implementation ownership");
NODE
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const body = readFileSync("docs/tickets/P3-C.md", "utf8");
assert.deepEqual(body.match(/^## .+$/gm), [
  "## Outcome", "## Context", "## Scope", "## Interface contract",
  "## Files owned", "## Dependencies", "## Acceptance criteria", "## Test plan",
  "## Failure modes", "## Settled decisions", "## Assumptions and open questions", "## References",
]);
assert.equal((body.match(/^```/gm) ?? []).length % 2, 0);
console.log("PASS  P3-C ticket structure");
NODE
test "$(( $(rg -n '^```' docs/tickets/P3-C.md | wc -l | tr -d ' ') % 2 ))" = 0
awk '/^```bash$/{inside=1; next} /^```$/{inside=0} inside{print}' docs/tickets/P3-C.md | bash -n
issue_json="$(gh issue view 16 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-C.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-C — The comments client, read only" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-C issue #16 pointer integrity'
```

Expected: after `P3C_BASE` names the exact integrated P3-A predecessor commit, the diff oracle prints `PASS  P3-C implementation ownership` only when both owned assets and no other non-ticket implementation path differ from that base. `templates/check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; TypeScript, scrub, whitespace, 12-heading, and fence checks exit `0`; scrub reports zero warnings. Issue #16 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the pointer gate prints `PASS  P3-C issue #16 pointer integrity`.

## Failure modes

### Handled

- Non-HTTP(S), missing metadata/core/platform primitives, missing session, artifact CSP, or initial network failure: return or remain dark with no partial controls.
- Session expires or access is revoked: a 401/403 clears every comment-only surface and prevents later refresh.
- A read stalls or the connection fails: abort at five seconds, clear the timer, resolve false, and retain only a previously valid view.
- A fetched page envelope, cursor, retained/boundary thread, or retained/boundary comment is malformed, cross-document, or internally duplicated: reject the candidate prefix as a unit and never render unvalidated strings. An ignored budget tail is never inspected or rendered and is disclosed as partial rather than treated as failure.
- More than five pages, 500 retained threads, or 5000 total retained comments: keep the deterministic server-order prefix, show the exact global truncation note, and restart from page one on refresh. A retained thread above P3-A's 500-comment response cap is malformed and fails the candidate pass.
- Thread text contains markup-looking content: `textContent` renders it as text; it cannot create HTML, CSS, selectors, ids, URLs, or handlers.
- Stable block and quote survive: exact range. Stable block survives but quote changes: drifted at that block even if matching prose exists elsewhere.
- Stable block disappears and the quote occurs in one other block: moved with a visible label. It occurs nowhere or in multiple blocks: orphaned with the quote retained in the panel.
- Multiple occurrences occur inside one block: deterministic context/distance/lower-offset precedence chooses one range.
- CSS Custom Highlight is missing: block-level classes preserve discoverability without a polyfill or child-node mutation.
- A section is closed or layout moves: hide or reposition markers through captured toggle and coalesced layout events.
- A refresh overlaps another trigger: one bounded trailing read prevents an older response from becoming the final visible state.
- A browser worker, server, installer, or deletion stalls: retained-leader TERM→KILL, bounded reaping, group-disappearance proof, and evidence-preserving cleanup prevent blind stale-PGID signalling and unbounded residue.

### Deliberately not handled

- Fuzzy recovery or choosing among multiple candidate blocks. Ambiguity remains visible as orphaned.
- Preserving an exact quote through edits to the quoted code units. The stable block yields the honest drifted state.
- Live updates inside this ticket. Visibility and the public callable are sufficient; P3-F supplies transport later.
- Write controls, drafts, selection anchoring, replies, resolution, or discussions creation. P4-A owns them.
- Overlay-driven local range repair or public rail/panel registration. P4-Q owns them after P4-A.
- A no-JavaScript comments snapshot in the artifact. Network-dependent generated HTML would violate deterministic dist parity.
- Cross-engine accessibility or rendering claims beyond the specified Chromium fixture. Platform use follows standards, but the executable oracle is deliberately named and finite.

## Settled decisions

- P3-C is read-only. It sends GET only and creates navigation/filter controls only.
- The canonical browser normaliser is P1-D's `window.doc.anchor.norm`; no duplicate regex, scanner, or normalisation fixture can substitute for direct consumption.
- Anchor state is computed on every successful read and never stored. Correct-block identity outranks quote relocation; only a unique other block may produce moved.
- Quote scoring uses exact UTF-16 search, suffix/prefix context, a sub-one distance penalty, and lower-offset final tie. There is no fuzzy matching.
- CSS Custom Highlight is the precision path because it does not mutate DOM. The only fallback is a block border; no `<mark>` and no polyfill.
- Resolved threads remain readable through filters but have no marker or highlight.
- Discussions share thread cards but have no anchor state or marker. Orphans always retain their quote in a named group.
- The panel is a non-modal complementary region. Native buttons, explicit focus return, terse live status, text state labels, forced-colors, reduced-motion, responsive, and print behavior are required.
- All API strings render through `textContent`; author emails and client-supplied authority are never exposed or trusted.
- Refresh uses the same callable for initial, visibility, and later realtime requests. Visibility is edge-triggered and throttled; there is no poll.
- Fetching is capped at five pages requested at 100 threads each; P3-A may return a shorter non-final page when its 5000-comment response budget binds. Retained state is capped at 500 threads and 5000 total comments. P3-A caps every valid thread at 500 comments and every parsed page at 5000 comments. Valid state beyond the client fetch/retained totals is a visibly partial success, while a retained or boundary value that violates either P3-A admission cap is malformed; ignored tails cannot influence client state.
- P3-C publishes `window.doc.comments.refresh()` only. The rail and panel remain private and `window.doc.rail`/`window.doc.panel` remain null until P4-Q.
- File amendment order is P3-C, then P4-A for comment writes, then P4-Q for shared suggestion surfaces and overlay repair.
- Browser acceptance owns a fresh process group through a retained direct leader, never signals a pgid after leader exit, and deletes only a revalidated exact temp root after IPC close, reap, and group disappearance.

## Assumptions and open questions

### Assumptions

- P3-A's final list response is the ruling `{ threads: Thread[], nextCursor: ThreadId | null }` keyset page and returns `docId`, not the obsolete `doc` field from research document 04. A non-null cursor may accompany any positive response length through the requested 100 because P3-A's comment budget can bind before its thread-count limit; the cursor equals the final returned ID. P3-C implements only that final contract and adds no compatibility guessing.
- P3-A enforces at most 500 comments in each returned thread and at most 5000 comments across each returned GET page before serialization. These server response-admission caps are the bounded parsed-page prerequisite for P3-C's deterministic ignored-tail policy.
- P1-D guarantees globally unique `data-aid` values in valid built output. Runtime duplicate detection is still required because choosing between duplicates would silently misattach a thread.
- P1-B's `.head-top` remains the header control container and its module order remains anchor core → edit → comments → later modules → session. A changed container/order is an integration-contract change, not permission for P3-C to edit the layout.
- P2-C's event means authentication succeeded, not that commenting is allowed. Read visibility follows document read access; P4-A later uses exact session capabilities only for write affordances, and the server independently authorizes every write.
- P2-D annotations do not insert display text or change P1-D aids. P3-C deliberately ignores `data-editable`.
- `performance.now()` is monotonic for the duration of one page, which is the only domain of the visibility throttle.

### Open questions

None block implementation. A product decision to make the panel modal, persist filters, display unread state, bake an offline thread snapshot, or add fuzzy recovery would change settled behavior and requires a new ticket rather than an implementation-time improvisation.

## References

- `docs/research/00-integration-plan.md` §§1.2, 2.2–2.3, 3.1–3.5, 4.1, 4.5–4.7, and ruling 13 — ruling data model, four computed states, module/file ownership, highlight policy, refresh throttle, and downstream P4-A/P4-Q order.
- `docs/research/04-comments-and-discussion.md` §§3, 5, and 8 — two-layer anchoring, thread display, exact quote resolution, non-mutating highlights, rail, panel, and visible degradation; older language/file names and write UI are superseded by the integration plan and this ticket's phase boundary.
- `docs/tickets/P1-B.md`, **Interface contract** — optional asset slots, compiled-core adapter, `.head-top`, exact script order, and initial `window.doc` namespace.
- `docs/tickets/P1-D.md`, **Shared block and normalisation core** — unique aids, exact `norm()`, raw-text exclusions, UTF-16 offsets, and browser-safe publication.
- `docs/tickets/P2-C.md`, **The one browser event** — one immutable session payload, listener-before-probe order, offline silence, and no client authority.
- `docs/tickets/P2-D.md`, **Downstream stability contract** — editability is layered over the shared block scanner without replacing aids or widening comments' block set.
- `docs/research/07-realtime-and-presence.md` §§6.3 and 8.1–8.3 — callable refresh boundary and later `thread.changed` transport; P3-C does not implement that transport.
- `docs/research/08-suggestions-and-editing-model.md` §§7.2–7.5 and 11.2–11.3 — one rail/panel, edit-before-comments order, and later `doc:overlay` repair; integration-plan P4-Q identifiers and state-store authority supersede its earlier ticket labels.
- [MDN: CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) — current range/registry/pseudo-element model, non-mutating DOM behavior, and June 2025 Baseline status.
- [CSSWG: CSS Custom Highlight API Module Level 1](https://drafts.csswg.org/css-highlight-api-1/) — primary registry, `Highlight`, `::highlight()`, painting, and range-invalidation model.
- [WHATWG DOM Standard](https://dom.spec.whatwg.org/) — primary `TreeWalker` and live `Range` boundary model.
- [WHATWG HTML Standard: interaction](https://html.spec.whatwg.org/multipage/interaction.html) — primary document visibility state and `visibilitychange` algorithm.
- [WHATWG HTML Standard: interactive elements](https://html.spec.whatwg.org/multipage/interactive-elements.html) — primary `<details>` and `toggle` algorithm.
- [MDN: `Document.createTreeWalker()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/createTreeWalker) — `NodeFilter.SHOW_TEXT` traversal.
- [MDN: `Range.setStart()`](https://developer.mozilla.org/en-US/docs/Web/API/Range/setStart) — text-node boundary offsets.
- [MDN: `visibilitychange`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) — document visibility transition semantics.
- [MDN: `<details>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details) — post-state-change `toggle` events used for marker placement.
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) — the `exact`, `prefix`, and `suffix` TextQuoteSelector vocabulary.
- GitHub issue #16, **P3-C — The comments client, read only** — tracker pointer to this canonical document; the full specification remains document-only.
