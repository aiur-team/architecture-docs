/* Direct-edit client and pending-overlay barrier.

   Two jobs, in this order. First, every authenticated reader applies the
   server's bounded pending receipts over the built text, so what everyone sees
   is the same overlay; `window.doc.edit.overlaysReady` is the one promise that
   says when that first pass is done, and P4-Q waits on it before the comments
   client resolves its first anchor. Second, and only for a session that says
   it may edit, each build-approved block gets an Edit control that turns the
   block into plaintext with three inline marks and POSTs it to /api/edit.

   The page is never the authority. The control is a presentation hint from the
   session projection; the server decides. Outside HTTP(S), without the document
   id, the anchor core, the platform primitives, or with a namespace another
   owner already filled, the module installs nothing and the static document is
   unchanged.

   Amendment chain: P4-B (this initial overlay/direct-edit client) -> P4-I ->
   P4-P. The four converter declarations below are byte-compatible with P2-D's
   `inline_md` twin on purpose; P4-C extracts them and runs the parity gate. */

/** Replace every exact `needle` in `input` with `replacement`. */
const replaceLiteral = (input, needle, replacement) =>
  input.split(needle).join(replacement);

/**
 * One `untag` pass: scan left to right for the next exact `<tag>`. When no
 * exact `</tag>` follows that opening tag, append the untouched remainder and
 * stop the pass. Otherwise the first following close wins: append the preceding
 * bytes, `open`, the bytes between the two tags unchanged, and `close`, then
 * resume immediately after the close.
 */
function untag(input, tag, open, close) {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let out = "";
  let rest = input;
  for (;;) {
    const openAt = rest.indexOf(openTag);
    if (openAt === -1) return out + rest;
    const closeAt = rest.indexOf(closeTag, openAt + openTag.length);
    if (closeAt === -1) return out + rest;
    out += rest.slice(0, openAt);
    out += open;
    out += rest.slice(openAt + openTag.length, closeAt);
    out += close;
    rest = rest.slice(closeAt + closeTag.length);
  }
}

/**
 * One `wrap` pass. Find the next delimiter from left to right and let `run` be
 * the bytes after it through, but not including, the first occurrence of the
 * delimiter's single character. Wrap only when `run` is nonempty and the bytes
 * immediately following `run` start with the complete delimiter; on success
 * append `<tag>run</tag>` and resume after the closing delimiter. On failure
 * append through the opening delimiter unchanged and resume after it.
 */
function wrap(input, delimiter, tag) {
  const single = delimiter[0];
  let out = "";
  let rest = input;
  for (;;) {
    const openAt = rest.indexOf(delimiter);
    if (openAt === -1) return out + rest;
    const runStart = openAt + delimiter.length;
    const singleAt = rest.indexOf(single, runStart);
    if (singleAt === -1) {
      out += rest.slice(0, runStart);
      rest = rest.slice(runStart);
      continue;
    }
    const run = rest.slice(runStart, singleAt);
    if (run !== "" && rest.startsWith(delimiter, singleAt)) {
      out += rest.slice(0, openAt);
      out += `<${tag}>`;
      out += run;
      out += `</${tag}>`;
      rest = rest.slice(singleAt + delimiter.length);
    } else {
      out += rest.slice(0, runStart);
      rest = rest.slice(runStart);
    }
  }
}

/** Convert an inner-HTML string to editable text. */
function toMd(html) {
  let out = untag(untag(untag(html, "code", "`", "`"), "strong", "**", "**"), "em", "*", "*");
  out = replaceLiteral(out, "&lt;", "<");
  out = replaceLiteral(out, "&gt;", ">");
  out = replaceLiteral(out, "&amp;", "&");
  return out;
}

/** Convert editable text to an inner-HTML string. */
function toHtml(text) {
  let out = replaceLiteral(text, "&", "&amp;");
  out = replaceLiteral(out, "<", "&lt;");
  out = replaceLiteral(out, ">", "&gt;");
  out = wrap(out, "`", "code");
  out = wrap(out, "**", "strong");
  out = wrap(out, "*", "em");
  return out;
}

installEdit();

function installEdit() {
  const protocol = location.protocol;
  if (protocol !== "http:" && protocol !== "https:") return;

  const metas = document.querySelectorAll('meta[name="doc-id"]');
  if (metas.length !== 1) return;
  const content = metas[0].getAttribute("content");
  const docId = typeof content === "string" ? content.trim() : "";
  if (!/^[0-9a-f]{6}$/.test(docId)) return;

  const doc = window.doc;
  if (doc === null || typeof doc !== "object") return;
  if (doc.edit !== null && doc.edit !== undefined) return;
  const anchor = doc.anchor;
  if (anchor === null || typeof anchor !== "object") return;
  if (!Array.isArray(anchor.BLOCK) || typeof anchor.norm !== "function" ||
      typeof anchor.scanBlocks !== "function") {
    return;
  }

  if (typeof fetch !== "function" ||
      typeof AbortController !== "function" ||
      typeof CustomEvent !== "function" ||
      typeof Range !== "function" ||
      typeof URL !== "function") {
    return;
  }

  /* ------------------------------------------------------------ constants */

  const AID = /^a[0-9a-f]{8}$/;
  const SUB = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const SUGGESTION_ID = /^s_[a-z0-9]{1,48}_[0-9a-f]{8}$/;

  const MAX_TEXT = 4000;
  const MAX_NAME = 200;
  const OVERLAY_TIMEOUT_MS = 5000;
  const SAVE_TIMEOUT_MS = 5000;
  const BATCH = 50;

  const PENDING_CLASS = "doc-edit-pending";
  const EDITING_CLASS = "doc-edit-editing";
  const CONFLICT_MESSAGE = "This block changed. Review the current text and try again.";
  const FAILED_MESSAGE = "The edit was not saved.";
  const SAVING_MESSAGE = "Saving…";
  const EDITING_MESSAGE = "Editing. Ctrl+Enter saves, Escape cancels.";

  const RESERVED_FINAL_FIELDS = [
    "doc", "role", "shared", "canSuggest", "canAccept", "canShare", "canSeeMembers",
  ];
  const ROLES = ["owner", "editor", "commenter", "viewer", "none"];

  const ENTRY_KEYS = ["text", "by", "at", "pr"];
  const ACTOR_KEYS = ["sub", "name", "email"];

  /* ------------------------------------------------------------- the blocks */

  const found = document.querySelectorAll("[data-editable][data-aid]");
  const blocks = [];
  const byAid = new Map();
  for (const element of found) {
    const aid = element.getAttribute("data-aid");
    if (typeof aid !== "string" || !AID.test(aid)) return;
    if (byAid.has(aid)) return;
    byAid.set(aid, element);
    blocks.push({ aid, element });
  }

  /* --------------------------------------------------------------- helpers */

  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    if (!isRecord(value)) return false;
    const names = Object.keys(value);
    if (names.length !== keys.length) return false;
    return keys.every((key) => hasOwn(value, key));
  }

  function isTimestamp(value) {
    if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
    try {
      return new Date(value).toISOString() === value;
    } catch (error) {
      return false;
    }
  }

  function isActor(value) {
    if (!exactKeys(value, ACTOR_KEYS)) return false;
    return typeof value.sub === "string" && SUB.test(value.sub) &&
      typeof value.name === "string" && value.name.length <= MAX_NAME &&
      typeof value.email === "string";
  }

  /** Text is displayable only when the twin converters reproduce it exactly:
     the same admission gate the server applies before it will write. */
  function isEditableText(value) {
    if (typeof value !== "string" || value.length > MAX_TEXT) return false;
    const html = toHtml(value);
    return toMd(html) === value && toHtml(toMd(html)) === html;
  }

  /** Pure content-type grammar for `application/json` with an optional
     `charset=utf-8` parameter, ASCII-case-insensitive. */
  function isJsonContentType(value) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "application/json") return true;
    const semicolon = trimmed.indexOf(";");
    if (semicolon === -1) return false;
    if (trimmed.slice(0, semicolon).trim() !== "application/json") return false;
    const parameter = trimmed.slice(semicolon + 1).trim();
    return parameter === "charset=utf-8" || parameter === 'charset="utf-8"';
  }

  function freezeDetail(aids) {
    return Object.freeze({ aids: Object.freeze(aids) });
  }

  /* ------------------------------------------------------------- the session */

  /** The complete session projection. Presence of any reserved final field
     commits to the whole P3-H shape; zero reserved fields selects the legacy
     shape. Only `canEdit` is ever read, and only as a presentation hint. */
  function validSession(body) {
    if (!isRecord(body)) return null;
    let reservedPresent = 0;
    for (const field of RESERVED_FINAL_FIELDS) {
      if (hasOwn(body, field)) reservedPresent += 1;
    }
    if (typeof body.sub !== "string") return null;
    if (typeof body.email !== "string") return null;
    if (typeof body.name !== "string") return null;
    if (!Array.isArray(body.roles)) return null;
    for (const entry of body.roles) {
      if (typeof entry !== "string") return null;
    }
    if (typeof body.canComment !== "boolean") return null;
    if (typeof body.canEdit !== "boolean") return null;
    if (reservedPresent === 0) return body;

    if (reservedPresent !== RESERVED_FINAL_FIELDS.length) return null;
    if (body.doc !== docId) return null;
    if (!ROLES.includes(body.role)) return null;
    if (typeof body.shared !== "boolean") return null;
    if (typeof body.canSuggest !== "boolean") return null;
    if (typeof body.canAccept !== "boolean") return null;
    if (typeof body.canShare !== "boolean") return null;
    if (typeof body.canSeeMembers !== "boolean") return null;
    if (body.roles.length !== 1) return null;
    if (body.roles[0] !== "member" && body.roles[0] !== "guest") return null;
    return body;
  }

  /* -------------------------------------------------------- pending overlays */

  /** One entry of P3-E's projection. The suggestion fields are accepted and
     validated here so a document already carrying P4-N state still overlays,
     but this ticket writes only the direct shape. */
  function validEntry(value) {
    if (!isRecord(value)) return null;
    const via = hasOwn(value, "via") ? value.via : undefined;
    let keys = ENTRY_KEYS;
    if (via === "edit") keys = ENTRY_KEYS.concat(["via"]);
    else if (via === "suggestion") {
      keys = ENTRY_KEYS.concat(["via", "sugId", "acceptedBy", "acceptedAt"]);
    } else if (via !== undefined) return null;
    if (!exactKeys(value, keys)) return null;
    if (!isEditableText(value.text)) return null;
    if (!isActor(value.by)) return null;
    if (!isTimestamp(value.at)) return null;
    if (!(value.pr === null || (Number.isSafeInteger(value.pr) && value.pr > 0))) return null;
    if (via === "suggestion") {
      if (typeof value.sugId !== "string" || !SUGGESTION_ID.test(value.sugId)) return null;
      if (!isActor(value.acceptedBy)) return null;
      if (!isTimestamp(value.acceptedAt)) return null;
    }
    return value;
  }

  /** The complete projection, or null. One bad entry rejects the response:
     a partial overlay would be a different document for different readers. */
  function validOverlay(body) {
    if (!isRecord(body) || Object.getPrototypeOf(body) !== Object.prototype) return null;
    const overlay = new Map();
    for (const aid of Object.keys(body)) {
      if (!AID.test(aid)) return null;
      const entry = validEntry(body[aid]);
      if (entry === null) return null;
      overlay.set(aid, entry);
    }
    return overlay;
  }

  /** Paint one block from exact plaintext and keep `data-md` in step, so a
     later edit reads the overlay rather than stale built text. */
  function paint(element, text) {
    element.innerHTML = toHtml(text);
    element.setAttribute("data-md", text);
  }

  /** Consecutive frozen batches of 1 through 50 aids, dispatched
     synchronously. No empty, duplicate, unsorted, or oversized batch. */
  function announce(aids) {
    for (let at = 0; at < aids.length; at += BATCH) {
      const slice = aids.slice(at, at + BATCH);
      document.dispatchEvent(new CustomEvent("doc:overlay", { detail: freezeDetail(slice) }));
    }
  }

  async function loadOverlays() {
    const endpoint = new URL("/api/pending", location.href);
    endpoint.searchParams.set("doc", docId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERLAY_TIMEOUT_MS);
    let overlay = null;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        mode: "same-origin",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status !== 200) return { applied: [], available: false };
      if (!isJsonContentType(response.headers.get("content-type"))) {
        return { applied: [], available: false };
      }
      overlay = validOverlay(await response.json());
    } catch (error) {
      return { applied: [], available: false };
    } finally {
      clearTimeout(timer);
    }
    if (overlay === null) return { applied: [], available: false };

    // DOM order, so a reader watching the page sees one top-to-bottom pass.
    const applied = [];
    for (const block of blocks) {
      const entry = overlay.get(block.aid);
      if (entry === undefined) continue;
      paint(block.element, entry.text);
      block.element.classList.add(PENDING_CLASS);
      applied.push(block.aid);
    }
    applied.sort();
    return { applied, available: true };
  }

  /* -------------------------------------------------------------- the editor */

  let saving = false;

  function probePlaintextOnly(element) {
    try {
      element.setAttribute("contenteditable", "plaintext-only");
      if (element.contentEditable === "plaintext-only") return true;
    } catch (error) {
      // A host that rejects the value simply does not support it.
    }
    element.setAttribute("contenteditable", "true");
    return false;
  }

  function makeControls(block) {
    const controls = document.createElement("div");
    controls.className = "doc-edit-controls";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "doc-edit-button";
    button.textContent = "Edit";
    const status = document.createElement("span");
    status.className = "doc-edit-status";
    status.setAttribute("role", "status");
    controls.appendChild(button);
    controls.appendChild(status);
    block.element.insertAdjacentElement("afterend", controls);
    return { controls, button, status };
  }

  function editableText(element) {
    const md = element.getAttribute("data-md");
    return md === null ? element.textContent : md;
  }

  function attach(block) {
    const { element, aid } = block;
    const { controls, button, status } = makeControls(block);

    let priorHtml = "";
    let priorMd = null;
    let priorMdPresent = false;
    let startText = "";
    let editing = false;
    let plaintextOnly = false;

    const setStatus = (text) => {
      status.textContent = text;
    };

    const onPaste = (event) => {
      if (plaintextOnly) return;
      event.preventDefault();
      const clipboard = event.clipboardData;
      const text = clipboard === null || clipboard === undefined
        ? "" : clipboard.getData("text/plain");
      if (typeof text !== "string" || text === "") return;
      document.execCommand("insertText", false, text);
    };

    const stopEditing = () => {
      editing = false;
      element.removeAttribute("contenteditable");
      element.classList.remove(EDITING_CLASS);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("paste", onPaste);
      element.removeEventListener("blur", onBlur);
      button.disabled = false;
      controls.classList.remove("doc-edit-controls-busy");
    };

    const restore = () => {
      element.innerHTML = priorHtml;
      if (priorMdPresent) element.setAttribute("data-md", priorMd);
      else element.removeAttribute("data-md");
    };

    const cancel = () => {
      stopEditing();
      restore();
      setStatus("");
    };

    async function save() {
      const text = element.textContent;
      stopEditing();
      if (saving) {
        restore();
        setStatus(FAILED_MESSAGE);
        controls.classList.add("doc-edit-failed");
        return;
      }
      saving = true;
      button.disabled = true;
      controls.classList.add("doc-edit-saving");
      controls.classList.remove("doc-edit-conflict", "doc-edit-failed");
      setStatus(SAVING_MESSAGE);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
      let response = null;
      let body = null;
      try {
        response = await fetch(new URL("/api/edit", location.href), {
          method: "POST",
          mode: "same-origin",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ docId, aid, text }),
          signal: controller.signal,
        });
        if (isJsonContentType(response.headers.get("content-type"))) {
          body = await response.json();
        }
      } catch (error) {
        response = null;
      } finally {
        clearTimeout(timer);
        saving = false;
        button.disabled = false;
        controls.classList.remove("doc-edit-saving");
      }

      if (response !== null && response.status === 200 && isRecord(body) &&
          exactKeys(body, ["receipt"])) {
        const receipt = validEntry(body.receipt);
        // The receipt carries no document id: the request's already validated
        // context is what binds this response to this block.
        if (receipt !== null && receipt.text === text) {
          paint(element, receipt.text);
          element.classList.add(PENDING_CLASS);
          setStatus("");
          announce([aid]);
          return;
        }
        restore();
        setStatus(FAILED_MESSAGE);
        controls.classList.add("doc-edit-failed");
        return;
      }

      if (response !== null && response.status === 409) {
        const current = isRecord(body) && hasOwn(body, "current") ? body.current : null;
        if (isEditableText(current)) paint(element, current);
        else restore();
        setStatus(CONFLICT_MESSAGE);
        controls.classList.add("doc-edit-conflict");
        return;
      }

      restore();
      setStatus(FAILED_MESSAGE);
      controls.classList.add("doc-edit-failed");
    }

    function onBlur() {
      if (!editing) return;
      // A blur that changed nothing is not an edit and never becomes a request.
      if (element.textContent === startText) cancel();
      else void save();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        button.focus();
        return;
      }
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        void save();
        return;
      }
      // Enter alone stays text. Native plaintext-only already does that; the
      // fallback would otherwise insert structural markup.
      if (!plaintextOnly && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        document.execCommand("insertText", false, "\n");
      }
    }

    button.addEventListener("click", () => {
      if (editing || saving) return;
      priorHtml = element.innerHTML;
      priorMdPresent = element.hasAttribute("data-md");
      priorMd = priorMdPresent ? element.getAttribute("data-md") : null;
      startText = editableText(element);
      element.textContent = startText;
      plaintextOnly = probePlaintextOnly(element);
      element.classList.add(EDITING_CLASS);
      controls.classList.remove("doc-edit-conflict", "doc-edit-failed");
      editing = true;
      element.addEventListener("keydown", onKeyDown);
      element.addEventListener("paste", onPaste);
      element.addEventListener("blur", onBlur);
      setStatus(EDITING_MESSAGE);
      element.focus();
    });
  }

  /* ------------------------------------------------------------ composition */

  let settle = null;
  const overlaysReady = new Promise((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const finish = (applied, available) => {
    if (settled) return;
    settled = true;
    settle(Object.freeze({ applied: Object.freeze(applied), available }));
  };

  window.doc.edit = Object.freeze({ overlaysReady });

  let started = false;
  document.addEventListener("session", (event) => {
    if (started) return;
    const session = validSession(event === null ? null : event.detail);
    if (session === null) return;
    started = true;
    void (async () => {
      let result = { applied: [], available: false };
      try {
        result = await loadOverlays();
      } catch (error) {
        result = { applied: [], available: false };
      }
      // The barrier settles before anything else observes the pass, and it
      // never rejects: a failed read is an empty overlay, not a broken page.
      finish(result.applied, result.available);
      if (result.applied.length > 0) announce(result.applied);
      if (session.canEdit === true) {
        for (const block of blocks) attach(block);
      }
    })();
  });
}
