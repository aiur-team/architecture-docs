/* Comments client, read only.
   Waits for the one `session` reveal, then reads a bounded prefix of the
   thread list with same-origin GETs and shows it in a private margin rail and
   side panel.  Every anchored thread is classified as exact, drifted, moved or
   orphaned against the current rendered blocks; the quote is resolved through
   P1-D's published normaliser and painted with the CSS Custom Highlight API so
   no prose node is ever wrapped or moved.  Outside HTTP(S), or without the
   document id, the anchor core, the platform primitives or a session, the
   module returns before touching anything and the static document is
   unchanged.

   Amendment chain: P3-C (this read path) -> P4-A (comment writes) -> P4-Q
   (shared rail/panel publication, Suggestions filter, overlay repair).  The
   rail and panel controllers stay in module scope until P4-Q publishes them;
   the only public seam is `window.doc.comments.refresh()`. */

const PROTOCOL = location.protocol;
if (PROTOCOL === "http:" || PROTOCOL === "https:") installComments();

function installComments() {
  const meta = document.querySelector('meta[name="doc-id"]');
  const content = meta === null ? null : meta.getAttribute("content");
  const docId = typeof content === "string" ? content.trim() : "";
  if (docId === "") return;

  const doc = window.doc;
  if (doc === null || typeof doc !== "object") return;
  const anchor = doc.anchor;
  if (anchor === null || typeof anchor !== "object") return;
  if (!Array.isArray(anchor.BLOCK) || typeof anchor.norm !== "function") return;
  const BLOCK = anchor.BLOCK;
  const norm = anchor.norm;

  if (typeof fetch !== "function"
    || typeof AbortController !== "function"
    || typeof CustomEvent !== "function"
    || typeof NodeFilter === "undefined" || NodeFilter === null
    || typeof NodeFilter.SHOW_TEXT !== "number"
    || typeof Range !== "function"
    || typeof requestAnimationFrame !== "function"
    || typeof performance !== "object" || performance === null
    || typeof performance.now !== "function"
    || typeof document.createTreeWalker !== "function") {
    return;
  }

  if (doc.comments !== null && doc.comments !== undefined) return;

  /* ------------------------------------------------------------ constants */

  const MAX_PAGES = 5;
  const MAX_THREADS = 500;
  const MAX_COMMENTS = 5000;
  const MAX_THREAD_COMMENTS = 500;
  const PASS_DEADLINE_MS = 5000;
  const VISIBILITY_WINDOW_MS = 30000;
  const MARKER_STEP = 24;

  const THREAD_ID = /^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/;
  const COMMENT_ID = /^c_[a-z0-9]{1,48}_[0-9a-f]{8}$/;
  const DOC_ID = /^[0-9a-f]{6}$/;
  const SECTION = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
  const DOC_VERSION = /^[0-9a-f]{7}$/;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const SUB = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
  const EMAIL_LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
  const EMAIL_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const AID = /^a[0-9a-f]{8}$/;

  const THREAD_KEYS = ["v", "id", "docId", "kind", "status", "section", "anchor", "title",
    "docVersion", "createdAt", "author", "resolvedAt", "resolvedBy", "comments"];
  const COMMENT_KEYS = ["id", "body", "author", "createdAt", "editedAt"];
  const ACTOR_KEYS = ["sub", "name", "email"];
  const ANCHOR_KEYS = ["block", "exact", "prefix", "suffix", "start"];
  const PAGE_KEYS = ["threads", "nextCursor"];

  const OPEN_HIGHLIGHT = "doc-comments-open";
  const ACTIVE_HIGHLIGHT = "doc-comments-active";
  const BLOCK_CLASS = "doc-comment-block";
  const BLOCK_ACTIVE_CLASS = "doc-comment-block-active";
  const REFRESH_FAILED = "Comments could not be refreshed.";

  const STATE_LABEL = Object.freeze({
    exact: "",
    drifted: "Text changed",
    moved: "Moved from its original block",
    orphaned: "Not attached any more",
  });

  /* ---------------------------------------------------------------- state */

  let activated = false;
  let batch = null;
  let again = false;
  let lastVisibilityRefresh = null;

  /* The last good view: validated threads with their computed locations. */
  let model = [];
  let truncation = null;
  let activeId = null;
  let statusFilter = "open";
  let kindFilter = "all";

  let toggle = null;
  let rail = null;
  let panel = null;
  let title = null;
  let status = null;
  let truncationNote = null;
  let list = null;
  let opener = null;
  let placementFrame = 0;
  const markers = new Map();
  const cards = new Map();
  const decoratedBlocks = new Set();

  /* --------------------------------------------------------- validation */

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function isPlain(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  function exactKeys(value, keys) {
    if (!isPlain(value)) return false;
    const own = Object.keys(value);
    if (own.length !== keys.length) return false;
    for (const key of keys) if (!hasOwn(value, key)) return false;
    return true;
  }

  function validTimestamp(value) {
    if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && new Date(time).toISOString() === value;
  }

  function validEmail(value) {
    if (typeof value !== "string") return false;
    if (value === "") return true;
    if (value.length > 254) return false;
    const at = value.indexOf("@");
    if (at === -1 || value.indexOf("@", at + 1) !== -1) return false;
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (!EMAIL_LOCAL.test(local)) return false;
    const labels = domain.split(".");
    if (labels.length < 2) return false;
    for (const label of labels) if (!EMAIL_LABEL.test(label)) return false;
    return true;
  }

  function validActor(value) {
    if (!exactKeys(value, ACTOR_KEYS)) return false;
    if (typeof value.sub !== "string" || !SUB.test(value.sub)) return false;
    if (typeof value.name !== "string" || value.name.length > 200) return false;
    return validEmail(value.email);
  }

  function sameActor(a, b) {
    return a.sub === b.sub && a.name === b.name && a.email === b.email;
  }

  /* Only non-whitespace code units separated by single spaces; one boundary
     space on either side is allowed because a context slice may end on it. */
  function validContext(value) {
    if (typeof value !== "string" || value.length > 32) return false;
    let previousSpace = false;
    for (let i = 0; i < value.length; i += 1) {
      const unit = value[i];
      if (norm(unit) === "") {
        if (unit !== " " || previousSpace) return false;
        previousSpace = true;
      } else {
        previousSpace = false;
      }
    }
    return true;
  }

  function validAnchor(value) {
    if (!exactKeys(value, ANCHOR_KEYS)) return false;
    if (typeof value.block !== "string" || !AID.test(value.block)) return false;
    if (typeof value.exact !== "string" || value.exact.length === 0 || value.exact.length > 1000) return false;
    if (norm(value.exact) !== value.exact) return false;
    if (!validContext(value.prefix) || !validContext(value.suffix)) return false;
    return Number.isSafeInteger(value.start) && value.start >= 0;
  }

  function validComment(value, seen) {
    if (!exactKeys(value, COMMENT_KEYS)) return false;
    if (typeof value.id !== "string" || !COMMENT_ID.test(value.id) || seen.has(value.id)) return false;
    seen.add(value.id);
    if (typeof value.body !== "string" || value.body.length === 0 || value.body.length > 8000) return false;
    if (value.body.trim().length === 0) return false;
    if (!validActor(value.author)) return false;
    if (!validTimestamp(value.createdAt)) return false;
    return value.editedAt === null || validTimestamp(value.editedAt);
  }

  function validThread(value) {
    if (!exactKeys(value, THREAD_KEYS)) return false;
    if (value.v !== 1) return false;
    if (typeof value.id !== "string" || !THREAD_ID.test(value.id)) return false;
    if (typeof value.docId !== "string" || !DOC_ID.test(value.docId) || value.docId !== docId) return false;
    if (value.kind !== "comment" && value.kind !== "discussion") return false;
    if (value.status !== "open" && value.status !== "resolved") return false;
    if (typeof value.section !== "string" || value.section.length > 63 || !SECTION.test(value.section)) return false;
    if (typeof value.docVersion !== "string" || !DOC_VERSION.test(value.docVersion)) return false;
    if (!validTimestamp(value.createdAt)) return false;
    if (!validActor(value.author)) return false;

    if (value.status === "open") {
      if (value.resolvedAt !== null || value.resolvedBy !== null) return false;
    } else if (!validTimestamp(value.resolvedAt) || !validActor(value.resolvedBy)) {
      return false;
    }

    if (value.kind === "comment") {
      if (value.title !== null || !validAnchor(value.anchor)) return false;
    } else {
      if (value.anchor !== null) return false;
      if (typeof value.title !== "string" || value.title.length > 200 || value.title.trim().length === 0) return false;
    }

    const comments = value.comments;
    if (!Array.isArray(comments) || comments.length === 0 || comments.length > MAX_THREAD_COMMENTS) return false;
    const seen = new Set();
    for (let i = 0; i < comments.length; i += 1) {
      if (!validComment(comments[i], seen)) return false;
    }
    const first = comments[0];
    if (!sameActor(first.author, value.author) || first.createdAt !== value.createdAt) return false;
    return true;
  }

  /* ----------------------------------------------------- text mapping */

  function opaque(node, root) {
    let parent = node.parentNode;
    while (parent !== null && parent !== root) {
      const name = parent.localName;
      if (name === "script" || name === "style") return true;
      parent = parent.parentNode;
    }
    return false;
  }

  /* One span per UTF-16 code unit of the normalised text; a collapsed
     whitespace run maps to the whole source run, across text nodes. */
  function textMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = "";
    const spans = [];
    let started = false;
    let pending = null;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (opaque(node, root)) continue;
      const data = node.data;
      for (let offset = 0; offset < data.length; offset += 1) {
        const unit = data[offset];
        if (norm(unit) === "") {
          if (!started) continue;
          if (pending === null) pending = { startNode: node, startOffset: offset, endNode: node, endOffset: offset + 1 };
          else {
            pending.endNode = node;
            pending.endOffset = offset + 1;
          }
          continue;
        }
        if (pending !== null) {
          text += " ";
          spans.push(pending);
          pending = null;
        }
        started = true;
        text += unit;
        spans.push({ startNode: node, startOffset: offset, endNode: node, endOffset: offset + 1 });
      }
    }
    return { text, spans };
  }

  function rangeFor(map, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start < 0 || start >= end || end > map.text.length) return null;
    const first = map.spans[start];
    const last = map.spans[end - 1];
    if (first === undefined || last === undefined) return null;
    try {
      const range = new Range();
      range.setStart(first.startNode, first.startOffset);
      range.setEnd(last.endNode, last.endOffset);
      return range;
    } catch (error) {
      return null;
    }
  }

  /* ------------------------------------------------------ quote scoring */

  function commonPrefix(a, b) {
    const limit = Math.min(a.length, b.length);
    let count = 0;
    while (count < limit && a[count] === b[count]) count += 1;
    return count;
  }

  function commonSuffix(a, b) {
    const limit = Math.min(a.length, b.length);
    let count = 0;
    while (count < limit && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1;
    return count;
  }

  function findQuote(text, quote) {
    const exact = quote.exact;
    if (exact.length === 0) return -1;
    let best = -1;
    let bestScore = -Infinity;
    let from = 0;
    for (;;) {
      const i = text.indexOf(exact, from);
      if (i === -1) break;
      const before = text.slice(Math.max(0, i - quote.prefix.length), i);
      const after = text.slice(i + exact.length, i + exact.length + quote.suffix.length);
      const context = commonSuffix(before, quote.prefix) + commonPrefix(after, quote.suffix);
      const distancePenalty = Math.min(Math.abs(i - quote.start), text.length) / (text.length + 1);
      const score = context - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
      from = i + 1;
    }
    return best;
  }

  /* Every rendered block by aid; a duplicate or out-of-policy element aborts
     the commit because choosing between candidates would misattach threads. */
  function buildBlockIndex() {
    const index = new Map();
    const elements = document.querySelectorAll("[data-aid]");
    for (let order = 0; order < elements.length; order += 1) {
      const element = elements[order];
      if (!BLOCK.includes(element.localName)) return null;
      const id = element.getAttribute("data-aid");
      if (id === null || !AID.test(id) || index.has(id)) return null;
      index.set(id, { element, order, map: textMap(element) });
    }
    return index;
  }

  function locate(quote, index) {
    const home = index.get(quote.block);
    if (home !== undefined) {
      const hit = findQuote(home.map.text, quote);
      const range = hit === -1 ? null : rangeFor(home.map, hit, hit + quote.exact.length);
      if (range === null) return { state: "drifted", element: home.element, range: null, order: home.order };
      return { state: "exact", element: home.element, range, order: home.order };
    }
    let found = null;
    let count = 0;
    for (const entry of index.values()) {
      const hit = findQuote(entry.map.text, quote);
      if (hit === -1) continue;
      count += 1;
      if (count > 1) break;
      found = { entry, hit };
    }
    if (count === 1) {
      const range = rangeFor(found.entry.map, found.hit, found.hit + quote.exact.length);
      if (range !== null) return { state: "moved", element: found.entry.element, range, order: found.entry.order };
    }
    return { state: "orphaned", element: null, range: null, order: Infinity };
  }

  /* --------------------------------------------------------- transport */

  function teardown() {
    activated = false;
    again = false;
    window.removeEventListener("resize", schedulePlacement);
    window.removeEventListener("hashchange", schedulePlacement);
    document.removeEventListener("toggle", schedulePlacement, true);
    document.removeEventListener("visibilitychange", visibilityRefresh);
    clearDecoration();
    if (toggle !== null && toggle.parentNode !== null) toggle.parentNode.removeChild(toggle);
    if (rail !== null && rail.parentNode !== null) rail.parentNode.removeChild(rail);
    if (panel !== null && panel.parentNode !== null) panel.parentNode.removeChild(panel);
    toggle = null;
    rail = null;
    panel = null;
    title = null;
    status = null;
    truncationNote = null;
    list = null;
    opener = null;
    markers.clear();
    cards.clear();
    model = [];
    truncation = null;
    activeId = null;
  }

  /* Consume one already-parsed page into the retained prefix.  Returns
     `false` for a malformed used/boundary value, or the page verdict. */
  function consumePage(page, priorCursor, retained, seenIds, totals) {
    if (!exactKeys(page, PAGE_KEYS)) return false;
    const threads = page.threads;
    const nextCursor = page.nextCursor;
    if (!Array.isArray(threads) || threads.length > 100) return false;
    if (nextCursor !== null && (typeof nextCursor !== "string" || !THREAD_ID.test(nextCursor))) return false;
    if (threads.length === 0) return nextCursor === null ? { next: null, stop: false } : false;
    if (nextCursor !== null) {
      const final = threads[threads.length - 1];
      if (final === null || typeof final !== "object") return false;
      if (!hasOwn(final, "id")) return false;
      const finalId = final.id;
      if (typeof finalId !== "string" || !THREAD_ID.test(finalId) || finalId !== nextCursor) return false;
    }

    let previous = priorCursor;
    for (let i = 0; i < threads.length; i += 1) {
      if (totals.comments >= MAX_COMMENTS) return { next: null, stop: true };
      const thread = threads[i];
      if (!validThread(thread)) return false;
      if (previous !== null && !(thread.id > previous)) return false;
      if (seenIds.has(thread.id)) return false;
      previous = thread.id;
      if (totals.comments + thread.comments.length > MAX_COMMENTS) return { next: null, stop: true };
      seenIds.add(thread.id);
      retained.push(thread);
      totals.comments += thread.comments.length;
      const more = i + 1 < threads.length || nextCursor !== null;
      if (more && (retained.length >= MAX_THREADS || totals.comments >= MAX_COMMENTS)) {
        return { next: null, stop: true };
      }
    }
    return { next: nextCursor, stop: false };
  }

  async function runPass() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PASS_DEADLINE_MS);
    try {
      const retained = [];
      const seenIds = new Set();
      const totals = { comments: 0 };
      let cursor = null;
      let truncated = false;
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const endpoint = new URL("/api/threads", location.href);
        endpoint.searchParams.set("doc", docId);
        endpoint.searchParams.set("limit", "100");
        if (cursor !== null) endpoint.searchParams.set("cursor", cursor);
        const response = await fetch(endpoint, {
          method: "GET",
          mode: "same-origin",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          teardown();
          return false;
        }
        if (response.status !== 200) return false;
        const page = await response.json();
        const verdict = consumePage(page, cursor, retained, seenIds, totals);
        if (verdict === false) return false;
        if (verdict.stop) {
          truncated = true;
          break;
        }
        if (verdict.next === null) break;
        cursor = verdict.next;
        if (pageNumber === MAX_PAGES - 1) truncated = true;
      }
      if (!activated) return false;
      return commit(retained, totals.comments, truncated);
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /* One pass; a failure after a prior good view keeps that view and says so. */
  async function pass() {
    const committed = await runPass();
    if (!committed && activated && panel !== null) setStatus(REFRESH_FAILED);
    return committed;
  }

  async function runBatch() {
    let committed = await pass();
    if (again && activated) {
      again = false;
      if (await pass()) committed = true;
    }
    return committed;
  }

  function refresh() {
    if (!activated) return Promise.resolve(false);
    if (batch !== null) {
      again = true;
      return batch;
    }
    batch = runBatch().then((result) => {
      batch = null;
      if (again) {
        again = false;
        queueMicrotask(() => { refresh(); });
      }
      return result;
    }, () => {
      batch = null;
      return false;
    });
    return batch;
  }

  /* ---------------------------------------------------------- commit */

  function commit(threads, commentCount, truncated) {
    const index = buildBlockIndex();
    if (index === null) return false;
    if (panel === null && document.querySelector(".head-top") === null) return false;
    const next = threads.map((thread) => ({
      thread,
      location: thread.kind === "comment" ? locate(thread.anchor, index) : null,
    }));
    model = next;
    truncation = truncated ? { threads: threads.length, comments: commentCount } : null;
    if (activeId !== null && !model.some((entry) => entry.thread.id === activeId)) activeId = null;
    if (panel === null && !createUI()) return false;
    render();
    setStatus(`${threads.length} ${threads.length === 1 ? "thread" : "threads"} loaded.`);
    return true;
  }

  /* -------------------------------------------------------- DOM helpers */

  function el(name, attributes, text) {
    const node = document.createElement(name);
    if (attributes !== undefined) {
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key]);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function timeNode(value) {
    return el("time", { datetime: value }, `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`);
  }

  function setStatus(text) {
    if (status !== null) status.textContent = text;
  }

  function openCount() {
    let count = 0;
    for (const entry of model) if (entry.thread.status === "open") count += 1;
    return count;
  }

  function byCreated(a, b) {
    if (a.thread.createdAt !== b.thread.createdAt) return a.thread.createdAt < b.thread.createdAt ? -1 : 1;
    return a.thread.id < b.thread.id ? -1 : a.thread.id > b.thread.id ? 1 : 0;
  }

  function byLocation(a, b) {
    if (a.location.order !== b.location.order) return a.location.order - b.location.order;
    return byCreated(a, b);
  }

  const isLive = (entry) => entry.location !== null && entry.location.state !== "orphaned";
  const isOpenLive = (entry) => isLive(entry) && entry.thread.status === "open";

  /* ------------------------------------------------------------- UI */

  function createUI() {
    const head = document.querySelector(".head-top");
    if (head === null) return false;

    toggle = el("button", {
      type: "button",
      id: "doc-comments-toggle",
      "aria-controls": "doc-comments-panel",
      "aria-expanded": "false",
    }, "Comments");
    toggle.addEventListener("click", () => {
      if (panel.hidden) openPanel(toggle, null);
      else closePanel();
    });
    const share = head.querySelector(":scope > .share-btn");
    if (share !== null) head.insertBefore(toggle, share);
    else head.appendChild(toggle);

    rail = el("div", { id: "doc-comments-rail", "aria-label": "Comment locations" });
    document.body.appendChild(rail);

    panel = el("aside", { id: "doc-comments-panel", "aria-labelledby": "doc-comments-title" });
    panel.hidden = true;
    const header = el("header");
    title = el("h2", { id: "doc-comments-title", tabindex: "-1" }, "Comments");
    const close = el("button", { type: "button", id: "doc-comments-close" }, "Close comments");
    close.addEventListener("click", closePanel);
    header.appendChild(title);
    header.appendChild(close);
    status = el("div", { id: "doc-comments-status", role: "status", "aria-live": "polite" });
    truncationNote = el("p", { id: "doc-comments-truncation" });
    truncationNote.hidden = true;
    const filters = el("div", { id: "doc-comments-filters" });
    filters.appendChild(filterGroup("Status", [["open", "Open"], ["resolved", "Resolved"], ["all", "All"]], statusFilter, (value) => { statusFilter = value; }));
    filters.appendChild(filterGroup("Kind", [["anchored", "Anchored"], ["discussions", "Discussions"], ["all", "All"]], kindFilter, (value) => { kindFilter = value; }));
    list = el("div", { id: "doc-comments-list" });
    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(truncationNote);
    panel.appendChild(filters);
    panel.appendChild(list);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        closePanel();
      }
    });
    document.body.appendChild(panel);

    window.addEventListener("resize", schedulePlacement);
    window.addEventListener("hashchange", schedulePlacement);
    document.addEventListener("toggle", schedulePlacement, true);
    const fonts = document.fonts;
    if (fonts !== null && typeof fonts === "object" && fonts.ready !== null
      && typeof fonts.ready === "object" && typeof fonts.ready.then === "function") {
      fonts.ready.then(schedulePlacement, () => {});
    }
    return true;
  }

  function filterGroup(label, options, selected, onSelect) {
    const group = el("div", { role: "group", "aria-label": label });
    const buttons = [];
    for (const [value, text] of options) {
      const button = el("button", { type: "button", "aria-pressed": selected === value ? "true" : "false" }, text);
      button.addEventListener("click", () => {
        onSelect(value);
        for (const [other, candidate] of buttons) candidate.setAttribute("aria-pressed", other === value ? "true" : "false");
        applyFilters();
      });
      buttons.push([value, button]);
      group.appendChild(button);
    }
    return group;
  }

  function openPanel(invoker, threadId) {
    opener = invoker;
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (threadId !== null) {
      activeId = threadId;
      paintDecoration();
      renderList();
      const card = cards.get(threadId);
      if (card !== undefined) card.heading.focus();
      else title.focus();
    } else {
      title.focus();
    }
    schedulePlacement();
  }

  function closePanel() {
    if (panel === null || panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    activeId = null;
    paintDecoration();
    renderList();
    const target = opener !== null && opener.isConnected ? opener : toggle;
    opener = null;
    target.focus();
    schedulePlacement();
  }

  function selectThread(threadId) {
    activeId = threadId;
    paintDecoration();
    renderList();
    schedulePlacement();
  }

  /* --------------------------------------------------------- render */

  function render() {
    toggle.textContent = `Comments (${openCount()})`;
    if (truncation === null) {
      truncationNote.hidden = true;
      truncationNote.textContent = "";
    } else {
      truncationNote.textContent = `Showing a partial view: ${truncation.threads} threads and ${truncation.comments} messages loaded; additional results may be available.`;
      truncationNote.hidden = false;
    }
    renderMarkers();
    paintDecoration();
    renderList();
    schedulePlacement();
  }

  function stateSuffix(state) {
    if (state === "drifted") return ", text changed";
    if (state === "moved") return ", moved from its original block";
    return "";
  }

  function renderMarkers() {
    markers.clear();
    rail.replaceChildren();
    for (const entry of model) {
      if (!isOpenLive(entry)) continue;
      const count = entry.thread.comments.length;
      const marker = el("button", {
        type: "button",
        class: "doc-comment-marker",
        "aria-label": `Comment by ${entry.thread.author.name}, ${count} ${count === 1 ? "message" : "messages"}${stateSuffix(entry.location.state)}`,
      }, String(count));
      marker.setAttribute("data-thread-id", entry.thread.id);
      marker.hidden = true;
      marker.addEventListener("click", () => {
        if (panel.hidden) openPanel(marker, entry.thread.id);
        else {
          opener = marker;
          selectThread(entry.thread.id);
          const card = cards.get(entry.thread.id);
          if (card !== undefined) card.heading.focus();
        }
      });
      markers.set(entry.thread.id, { marker, entry });
      rail.appendChild(marker);
    }
  }

  function passesFilters(entry) {
    const thread = entry.thread;
    if (statusFilter !== "all" && thread.status !== statusFilter) return false;
    if (kindFilter === "anchored" && thread.kind !== "comment") return false;
    if (kindFilter === "discussions" && thread.kind !== "discussion") return false;
    return true;
  }

  function renderList() {
    if (list === null) return;
    let focusedThread = null;
    let focusedInList = false;
    const active = document.activeElement;
    if (active !== null && list.contains(active)) {
      focusedInList = true;
      const article = active.closest("article");
      if (article !== null) focusedThread = article.getAttribute("data-thread-id");
    }

    cards.clear();
    const live = [];
    const orphans = [];
    const discussions = [];
    for (const entry of model) {
      if (entry.location === null) discussions.push(entry);
      else if (entry.location.state === "orphaned") orphans.push(entry);
      else live.push(entry);
    }
    live.sort(byLocation);
    orphans.sort(byCreated);
    discussions.sort(byCreated);

    const fragment = document.createDocumentFragment();
    if (live.length > 0) fragment.appendChild(group("Comments in the document", live));
    if (orphans.length > 0) fragment.appendChild(group(STATE_LABEL.orphaned, orphans));
    if (discussions.length > 0) fragment.appendChild(group("Discussions", discussions));
    fragment.appendChild(el("p", { class: "doc-comments-empty" }, "No comments match the current filters."));
    list.replaceChildren(fragment);
    applyFilters();

    if (focusedInList) {
      const card = focusedThread === null ? undefined : cards.get(focusedThread);
      if (card !== undefined) card.heading.focus();
      else title.focus();
    }
  }

  /* Filters hide cards in place; every retained thread keeps its card and no
     stored thread changes. */
  function applyFilters() {
    if (list === null) return;
    let shown = 0;
    for (const section of list.querySelectorAll(".doc-comments-group")) {
      let visible = 0;
      for (const item of section.querySelectorAll(":scope > ul > li")) {
        const article = item.firstElementChild;
        const entry = article === null ? undefined : cards.get(article.getAttribute("data-thread-id"));
        const pass = entry !== undefined && passesFilters(entry.entry);
        item.hidden = !pass;
        if (pass) visible += 1;
      }
      section.hidden = visible === 0;
      shown += visible;
    }
    const empty = list.querySelector(".doc-comments-empty");
    if (empty !== null) empty.hidden = shown > 0;
  }

  function group(heading, entries) {
    const section = el("section", { class: "doc-comments-group" });
    section.appendChild(el("h3", undefined, heading));
    const items = el("ul");
    for (const entry of entries) items.appendChild(card(entry));
    section.appendChild(items);
    return section;
  }

  function card(entry) {
    const thread = entry.thread;
    const item = el("li");
    const article = el("article", { class: "doc-comments-card" });
    article.setAttribute("data-thread-id", thread.id);
    if (thread.id === activeId) {
      article.classList.add("doc-comments-card-active");
      article.setAttribute("aria-current", "true");
    }
    const heading = el("h4", { tabindex: "-1" }, thread.kind === "discussion" ? thread.title : `Comment by ${thread.author.name}`);
    article.appendChild(heading);

    const meta = el("p", { class: "doc-comments-meta" });
    meta.appendChild(el("span", { class: "doc-comments-status-label" }, thread.status === "open" ? "Open" : "Resolved"));
    meta.appendChild(document.createTextNode(" · "));
    meta.appendChild(timeNode(thread.createdAt));
    if (thread.status === "resolved") {
      meta.appendChild(document.createTextNode(` · Resolved by ${thread.resolvedBy.name} `));
      meta.appendChild(timeNode(thread.resolvedAt));
    }
    article.appendChild(meta);

    if (entry.location !== null) {
      const state = entry.location.state;
      if (state !== "exact") article.appendChild(el("p", { class: "doc-comments-state" }, STATE_LABEL[state]));
      if (state === "drifted" || state === "orphaned") article.appendChild(el("blockquote", undefined, thread.anchor.exact));
    }

    const messages = el("ol", { class: "doc-comments-messages" });
    for (const comment of thread.comments) {
      const message = el("li");
      const line = el("p", { class: "doc-comments-byline" });
      line.appendChild(el("span", { class: "doc-comments-author" }, comment.author.name));
      line.appendChild(document.createTextNode(" "));
      line.appendChild(timeNode(comment.createdAt));
      if (comment.editedAt !== null) {
        line.appendChild(document.createTextNode(" "));
        line.appendChild(el("span", { class: "doc-comments-edited" }, "edited"));
      }
      message.appendChild(line);
      message.appendChild(el("p", { class: "doc-comments-body" }, comment.body));
      messages.appendChild(message);
    }
    article.appendChild(messages);

    if (isLive(entry)) {
      const show = el("button", { type: "button", class: "doc-comments-show" }, "Show in document");
      show.addEventListener("click", () => showInDocument(entry));
      article.appendChild(show);
    }
    item.appendChild(article);
    cards.set(thread.id, { heading, entry });
    return item;
  }

  function showInDocument(entry) {
    const host = entry.location.element;
    let details = host.closest("details");
    while (details !== null) {
      details.open = true;
      details = details.parentElement === null ? null : details.parentElement.closest("details");
    }
    selectThread(entry.thread.id);
    host.scrollIntoView({ block: "center", behavior: "auto" });
  }

  /* ----------------------------------------------------- decoration */

  function highlightRegistry() {
    if (typeof Highlight !== "function") return null;
    const css = window.CSS;
    if (css === null || typeof css !== "object") return null;
    const registry = css.highlights;
    if (registry === null || typeof registry !== "object") return null;
    if (typeof registry.set !== "function" || typeof registry.delete !== "function") return null;
    return registry;
  }

  function clearDecoration() {
    const registry = highlightRegistry();
    if (registry !== null) {
      registry.delete(OPEN_HIGHLIGHT);
      registry.delete(ACTIVE_HIGHLIGHT);
    }
    for (const block of decoratedBlocks) block.classList.remove(BLOCK_CLASS, BLOCK_ACTIVE_CLASS);
    decoratedBlocks.clear();
  }

  function paintDecoration() {
    clearDecoration();
    const registry = highlightRegistry();
    if (registry !== null) {
      const open = [];
      const active = [];
      for (const entry of model) {
        if (!isOpenLive(entry) || entry.location.range === null) continue;
        (entry.thread.id === activeId ? active : open).push(entry.location.range);
      }
      registry.set(OPEN_HIGHLIGHT, new Highlight(...open));
      registry.set(ACTIVE_HIGHLIGHT, new Highlight(...active));
      return;
    }
    for (const entry of model) {
      if (!isOpenLive(entry)) continue;
      const block = entry.location.element;
      block.classList.add(BLOCK_CLASS);
      if (entry.thread.id === activeId) block.classList.add(BLOCK_ACTIVE_CLASS);
      decoratedBlocks.add(block);
    }
  }

  /* ------------------------------------------------------- placement */

  function schedulePlacement() {
    if (placementFrame !== 0) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = 0;
      placeMarkers();
    });
  }

  function disclosed(element) {
    let details = element.closest("details");
    while (details !== null) {
      if (!details.open) return false;
      details = details.parentElement === null ? null : details.parentElement.closest("details");
    }
    return true;
  }

  function placeMarkers() {
    if (rail === null || !rail.isConnected) return;
    const railRect = rail.getBoundingClientRect();
    for (const { marker } of markers.values()) marker.hidden = true;
    const scrollWidth = document.documentElement.scrollWidth;
    const visible = [];
    for (const { marker, entry } of markers.values()) {
      const host = entry.location.element;
      if (!host.isConnected || !disclosed(host) || host.getClientRects().length === 0) {
        marker.hidden = true;
        continue;
      }
      marker.hidden = false;
      const source = entry.location.range === null ? host : entry.location.range;
      const top = source.getBoundingClientRect().top - railRect.top;
      const hostRect = host.getBoundingClientRect();
      const left = Math.min(Math.max(hostRect.right - railRect.left + 8, 4), scrollWidth - marker.offsetWidth - 4);
      visible.push({ marker, entry, top, left });
    }
    visible.sort((a, b) => {
      if (a.top !== b.top) return a.top - b.top;
      return byLocation(a.entry, b.entry);
    });
    let previous = -Infinity;
    for (const item of visible) {
      const top = Math.max(item.top, previous + MARKER_STEP);
      item.marker.style.top = `${top}px`;
      item.marker.style.left = `${item.left}px`;
      item.marker.classList.toggle("doc-comment-marker-active", item.entry.thread.id === activeId);
      previous = top;
    }
  }

  /* ------------------------------------------------------- lifecycle */

  document.addEventListener("session", (event) => {
    const detail = event.detail;
    if (detail === null || typeof detail !== "object") return;
    if (activated) return;
    activated = true;
    refresh();
  }, { once: true });

  function visibilityRefresh() {
    if (document.visibilityState !== "visible") return;
    const now = performance.now();
    if (lastVisibilityRefresh !== null && now - lastVisibilityRefresh < VISIBILITY_WINDOW_MS) return;
    lastVisibilityRefresh = now;
    refresh();
  }

  document.addEventListener("visibilitychange", visibilityRefresh);

  doc.comments = Object.freeze({ refresh });
}
