// presence.js — the optional, client-derived presence layer.
//
// Presence is decoration, never document state. Every tab derives it
// independently from P3-F's authenticated client-channel `beat` and `bye`
// events, so it may be incomplete, delayed, duplicated or briefly stale
// without changing access, editing, comments or durable content.
//
// P3-F owns transport absolutely. This module reaches for exactly one frozen
// method — `window.doc.realtime.publish()` — and one closed bus, `doc:event`.
// It never learns a credential, a channel, or a connection state. A successful
// publish or an accepted client event is the only proof that transport exists,
// which is what keeps a realtime-disabled deployment visually dark without
// asking P3-F for a state getter it deliberately does not expose.
//
// The one persisted fact is a local privacy preference. Storage that is
// corrupt or unavailable fails closed toward silence: a reader who cannot be
// proven visible-by-default is treated as hidden and gets only a recovery
// toggle, so they can opt back in without first disclosing a client ID.

(() => {
  "use strict";

  const BEAT_MS = 20000;
  const LEASE_MS = 50000;
  const SWEEP_MS = 5000;
  const MAX_READERS = 200;
  const STORAGE_KEY = "doc.presence.hidden.v1";
  const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
  const AID_RE = /^a[0-9a-f]{8}$/;

  const DOC_RE = /^[0-9a-f]{6}$/;
  const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
  const WHITESPACE_RUN_RE = /\s+/gu;

  const LABEL_LIMIT = 24;
  const MAX_FACES = 5;
  const MAX_MARKER_INITIALS = 3;
  const MARKER_OFFSET_PX = 28;
  const MARKER_GAP_PX = 20;
  const RAIL_EDGE_PX = 4;
  const COLOURS = 8;

  const LEGACY_KEYS = ["sub", "email", "name", "roles", "canComment", "canEdit"];
  const FINAL_KEYS = [
    "sub", "email", "name", "roles", "canComment", "canEdit",
    "doc", "role", "shared", "canSuggest", "canAccept", "canShare", "canSeeMembers",
  ];
  const FINAL_BOOLEANS = ["shared", "canSuggest", "canAccept", "canShare", "canSeeMembers"];
  const ROLE_VALUES = ["owner", "editor", "commenter", "viewer", "none"];
  const BEAT_KEYS = ["source", "t", "clientId", "label", "act", "aid"];
  const BYE_KEYS = ["source", "t", "clientId"];
  const OWN_BEAT_KEYS = ["label", "act", "aid"];

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  const sameSequence = (actual, expected) => {
    if (actual.length !== expected.length) return false;
    for (let index = 0; index < expected.length; index += 1) {
      if (actual[index] !== expected[index]) return false;
    }
    return true;
  };

  // Descriptor-shaped validation, never a read: an accessor must be rejected
  // without ever being invoked.
  const plainDataKey = (value, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return false;
    if (!own(descriptor, "value")) return false;
    return descriptor.enumerable === true
      && descriptor.writable === false
      && descriptor.configurable === false;
  };

  // --- Predecessor surfaces -------------------------------------------------

  // A missing predecessor is a gap to stay silent about, not one to fill in.
  // Nothing observable — no listener, timer, storage read or clock read —
  // happens when any of these is absent.
  function prerequisites() {
    try {
      const protocol = location.protocol;
      if (protocol !== "http:" && protocol !== "https:") return null;

      const namespace = window.doc;
      if (namespace === null || typeof namespace !== "object") return null;

      const surface = namespace.realtime;
      if (surface === null || typeof surface !== "object") return null;
      if (!Object.isFrozen(surface)) return null;
      if (Object.getOwnPropertySymbols(surface).length !== 0) return null;
      const names = Object.getOwnPropertyNames(surface);
      if (names.length !== 1 || names[0] !== "publish") return null;
      const descriptor = Object.getOwnPropertyDescriptor(surface, "publish");
      if (descriptor === undefined || !own(descriptor, "value")) return null;
      if (typeof descriptor.value !== "function") return null;
      if (descriptor.enumerable !== true) return null;
      if (descriptor.writable !== false || descriptor.configurable !== false) return null;

      // P1-D's generated anchor layer is proved, never called or copied.
      const anchor = namespace.anchor;
      if (anchor === null || typeof anchor !== "object") return null;
      if (!own(anchor, "BLOCK") || !Array.isArray(anchor.BLOCK)) return null;
      if (!own(anchor, "norm") || typeof anchor.norm !== "function") return null;
      if (!own(anchor, "scanBlocks") || typeof anchor.scanBlocks !== "function") return null;

      return surface;
    } catch (ignored) {
      return null;
    }
  }

  const realtime = prerequisites();
  if (realtime === null) return;

  // --- Module state ---------------------------------------------------------

  let activated = false;
  let suspended = false;
  let transportProved = false;
  let hiddenByChoice = false;
  let beatPending = false;
  let localLabel = "";

  let beatTimer = 0;
  let sweepTimer = 0;
  let frameId = 0;
  let lastClock = -Infinity;
  let nextOrder = 0;
  let fontsBound = false;
  let placementBound = false;

  let headEl = null;
  let themeEl = null;
  let container = null;
  let facesEl = null;
  let toggleEl = null;
  let railEl = null;

  // clientId -> { label, act, aid, seen, order }. The key is the only identity
  // this module knows, and it authorizes nothing.
  const roster = new Map();

  document.addEventListener("session", onSession);
  document.addEventListener("doc:event", onDocEvent);

  // --- Activation -----------------------------------------------------------

  function onSession(event) {
    if (activated) return;
    const admitted = admitSession(event);
    if (admitted === null) return;

    document.removeEventListener("session", onSession);
    activated = true;
    headEl = admitted.head;
    themeEl = admitted.theme;
    localLabel = admitted.label;

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    hiddenByChoice = readPreference();

    // The deliberate exception to "no UI before proof": a fail-closed hidden
    // reader needs a way back in that does not broadcast them first.
    if (hiddenByChoice) {
      if (!mountContainer()) return;
      facesEl.setAttribute("hidden", "");
      return;
    }

    if (isVisible()) sendBeat();
  }

  function admitSession(event) {
    let head = null;
    let theme = null;
    try {
      const root = document.documentElement;
      if (root === null) return null;
      const mode = root.getAttribute("data-session");
      if (mode !== "reader" && mode !== "editor") return null;

      const heads = document.querySelectorAll(".head-top");
      if (heads.length !== 1) return null;
      const themes = document.querySelectorAll("button#tt");
      if (themes.length !== 1) return null;
      head = heads[0];
      theme = themes[0];
      if (theme.parentElement !== head) return null;
    } catch (ignored) {
      return null;
    }

    const detail = readSessionDetail(event);
    if (detail === null) return null;
    return { head, theme, label: deriveLabel(detail) };
  }

  // The closed-record check. Every reflection happens inside one fail-closed
  // boundary and completes before any field value is read, so a hostile
  // accessor or trap is rejected rather than run.
  function readSessionDetail(event) {
    let detail;
    try {
      detail = event.detail;
    } catch (ignored) {
      return null;
    }

    let final = false;
    try {
      if (detail === null || typeof detail !== "object") return null;
      if (Object.getPrototypeOf(detail) !== Object.prototype) return null;
      if (!Object.isFrozen(detail)) return null;
      if (Object.getOwnPropertySymbols(detail).length !== 0) return null;

      const keys = Object.getOwnPropertyNames(detail);
      if (sameSequence(keys, FINAL_KEYS)) final = true;
      else if (!sameSequence(keys, LEGACY_KEYS)) return null;

      for (let index = 0; index < keys.length; index += 1) {
        if (!plainDataKey(detail, keys[index])) return null;
      }
    } catch (ignored) {
      return null;
    }

    try {
      if (typeof detail.sub !== "string") return null;
      if (typeof detail.email !== "string") return null;
      if (typeof detail.name !== "string") return null;
      if (!validRoles(detail.roles)) return null;
      if (typeof detail.canComment !== "boolean") return null;
      if (typeof detail.canEdit !== "boolean") return null;

      if (final) {
        if (typeof detail.doc !== "string" || !DOC_RE.test(detail.doc)) return null;
        if (!ROLE_VALUES.includes(detail.role)) return null;
        for (const key of FINAL_BOOLEANS) {
          if (typeof detail[key] !== "boolean") return null;
        }
      }
      return detail;
    } catch (ignored) {
      return null;
    }
  }

  // A frozen dense ordinary string array: exact index descriptors, the ordinary
  // `length`, and nothing else. Checked by descriptor so an index accessor is
  // never invoked.
  function validRoles(roles) {
    try {
      if (!Array.isArray(roles)) return false;
      if (Object.getPrototypeOf(roles) !== Array.prototype) return false;
      if (!Object.isFrozen(roles)) return false;
      if (Object.getOwnPropertySymbols(roles).length !== 0) return false;

      const lengthDescriptor = Object.getOwnPropertyDescriptor(roles, "length");
      if (lengthDescriptor === undefined || !own(lengthDescriptor, "value")) return false;
      if (lengthDescriptor.enumerable !== false) return false;
      if (lengthDescriptor.writable !== false || lengthDescriptor.configurable !== false) return false;

      const length = lengthDescriptor.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return false;

      const names = Object.getOwnPropertyNames(roles);
      if (names.length !== length + 1) return false;
      if (names[length] !== "length") return false;

      for (let index = 0; index < length; index += 1) {
        if (names[index] !== String(index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(roles, names[index]);
        if (descriptor === undefined || !own(descriptor, "value")) return false;
        if (descriptor.enumerable !== true) return false;
        if (descriptor.writable !== false || descriptor.configurable !== false) return false;
        if (typeof descriptor.value !== "string") return false;
      }
      return true;
    } catch (ignored) {
      return false;
    }
  }

  // Presentation only. The sole `member` role is the one shape that may carry a
  // server-supplied name; everything else is privacy-conservatively external
  // and broadcasts the literal `Guest`. There is no email, sub, role or domain
  // fallback in either branch.
  function deriveLabel(detail) {
    const roles = detail.roles;
    if (roles.length !== 1 || roles[0] !== "member") return "Guest";

    const name = detail.name;
    if (typeof name !== "string" || CONTROL_RE.test(name)) return "Member";

    const collapsed = name.trim().replace(WHITESPACE_RUN_RE, " ");
    let label = "";
    for (const point of collapsed) {
      if (label.length + point.length > LABEL_LIMIT) break;
      label += point;
    }
    return label === "" ? "Member" : label;
  }

  // Absent means visible. Every other outcome — an unexpected value, or a read
  // that throws — fails closed against broadcasting.
  function readPreference() {
    let stored = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (ignored) {
      return true;
    }
    return stored !== null;
  }

  // --- Publishing -----------------------------------------------------------

  // The P4-I amendment seam. P3-G itself never publishes an aid or an editing
  // activity; a later owner amends this one function once it has a proven
  // editable focus, and every timer, privacy and validation rule here still
  // applies to what it returns.
  function currentBeat() {
    return { label: localLabel, act: "reading", aid: null };
  }

  function sendBeat() {
    if (beatPending) return;
    const beat = currentBeat();
    if (!validOwnBeat(beat)) return;
    beatPending = true;
    settleOutcome(attempt(Object.assign({ t: "beat" }, beat)), true);
  }

  function sendBye() {
    settleOutcome(attempt({ t: "bye" }), false);
  }

  function validOwnBeat(beat) {
    try {
      if (beat === null || typeof beat !== "object") return false;
      if (Object.getOwnPropertySymbols(beat).length !== 0) return false;
      if (!sameSequence(Object.getOwnPropertyNames(beat), OWN_BEAT_KEYS)) return false;
      const label = beat.label;
      if (typeof label !== "string" || label.length < 1 || label.length > LABEL_LIMIT) return false;
      if (CONTROL_RE.test(label)) return false;
      if (beat.act !== "reading" && beat.act !== "editing") return false;
      const aid = beat.aid;
      if (aid !== null && !(typeof aid === "string" && AID_RE.test(aid))) return false;
      return true;
    } catch (ignored) {
      return false;
    }
  }

  // P3-F's publish always settles, but a synchronous throw is contained here
  // too: a transport failure is a dropped beat, never an escaping error, a
  // blocked navigation, or a retry storm.
  function attempt(event) {
    try {
      return realtime.publish(event);
    } catch (ignored) {
      return false;
    }
  }

  function settleOutcome(result, isBeat) {
    let settled;
    try {
      settled = Promise.resolve(result);
    } catch (ignored) {
      if (isBeat) beatPending = false;
      return;
    }
    settled.then(
      (value) => {
        if (isBeat) beatPending = false;
        if (value === true) proveTransport();
      },
      () => {
        if (isBeat) beatPending = false;
      },
    );
  }

  // --- Transport proof ------------------------------------------------------

  // Monotonic until terminal cleanup. It is the single place decoration turns
  // on, so an inbound event repairs a schedule that a failed publish never
  // created, and a later failed publish can never regress it.
  function proveTransport() {
    if (transportProved || suspended || !activated) return;
    if (!mountContainer()) return;
    transportProved = true;
    facesEl.removeAttribute("hidden");
    createRail();
    startSweep();
    if (isVisible() && !hiddenByChoice) startBeat();
    repaint();
    bindFonts();
  }

  function startSweep() {
    if (sweepTimer !== 0) return;
    try {
      sweepTimer = setInterval(sweep, SWEEP_MS);
    } catch (ignored) {
      sweepTimer = 0;
    }
  }

  function stopSweep() {
    if (sweepTimer === 0) return;
    clearInterval(sweepTimer);
    sweepTimer = 0;
  }

  function startBeat() {
    stopBeat();
    try {
      beatTimer = setInterval(onBeatTick, BEAT_MS);
    } catch (ignored) {
      beatTimer = 0;
    }
  }

  function stopBeat() {
    if (beatTimer === 0) return;
    clearInterval(beatTimer);
    beatTimer = 0;
  }

  function onBeatTick() {
    if (suspended || hiddenByChoice || !isVisible()) return;
    sendBeat();
  }

  function isVisible() {
    try {
      return document.visibilityState === "visible";
    } catch (ignored) {
      return false;
    }
  }

  // --- Roster ---------------------------------------------------------------

  function onDocEvent(event) {
    if (!activated || suspended) return;
    const detail = readClientDetail(event);
    if (detail === null) return;

    // An accepted client event proves transport even when it changes nothing.
    proveTransport();
    if (detail.t === "beat") applyBeat(detail);
    else removeReader(detail.clientId);
  }

  // Only P3-F's two frozen flat client shapes. Server projections and
  // claim/release events are ignored, and every rejection is descriptor-shaped
  // so no getter runs.
  function readClientDetail(event) {
    let detail;
    try {
      detail = event.detail;
    } catch (ignored) {
      return null;
    }

    try {
      if (detail === null || typeof detail !== "object") return null;
      if (Object.getPrototypeOf(detail) !== Object.prototype) return null;
      if (!Object.isFrozen(detail)) return null;
      if (Object.getOwnPropertySymbols(detail).length !== 0) return null;

      const keys = Object.getOwnPropertyNames(detail);
      const isBeat = sameSequence(keys, BEAT_KEYS);
      const isBye = !isBeat && sameSequence(keys, BYE_KEYS);
      if (!isBeat && !isBye) return null;

      for (let index = 0; index < keys.length; index += 1) {
        if (!plainDataKey(detail, keys[index])) return null;
      }

      if (detail.source !== "client") return null;
      const clientId = detail.clientId;
      if (typeof clientId !== "string" || !CLIENT_ID_RE.test(clientId)) return null;

      if (isBye) {
        if (detail.t !== "bye") return null;
        return { t: "bye", clientId };
      }

      if (detail.t !== "beat") return null;
      const label = detail.label;
      if (typeof label !== "string" || label.length < 1 || label.length > LABEL_LIMIT) return null;
      if (CONTROL_RE.test(label)) return null;
      const act = detail.act;
      if (act !== "reading" && act !== "editing") return null;
      const aid = detail.aid;
      if (aid !== null && !(typeof aid === "string" && AID_RE.test(aid))) return null;
      return { t: "beat", clientId, label, act, aid };
    } catch (ignored) {
      return null;
    }
  }

  function applyBeat(detail) {
    const now = stamp();
    if (now === null) return;

    const existing = roster.get(detail.clientId);
    if (existing === undefined) {
      // The cap protects first sight, not recency: a full roster drops the new
      // ID rather than evicting a reader who was already here.
      if (roster.size >= MAX_READERS) return;
      roster.set(detail.clientId, {
        label: detail.label,
        act: detail.act,
        aid: detail.aid,
        seen: now,
        order: nextOrder,
      });
      nextOrder += 1;
      repaint();
      return;
    }

    const material = existing.label !== detail.label
      || existing.act !== detail.act
      || existing.aid !== detail.aid;
    existing.seen = now;
    if (!material) return;
    existing.label = detail.label;
    existing.act = detail.act;
    existing.aid = detail.aid;
    repaint();
  }

  function removeReader(clientId) {
    if (!roster.delete(clientId)) return;
    repaint();
  }

  function sweep() {
    if (!transportProved || suspended) return;
    const now = clockSample();
    if (now === null) return;
    let changed = false;
    for (const entry of roster) {
      if (now - entry[1].seen >= LEASE_MS) {
        roster.delete(entry[0]);
        changed = true;
      }
    }
    if (changed) repaint();
  }

  function stamp() {
    let now;
    try {
      now = Date.now();
    } catch (ignored) {
      return null;
    }
    return typeof now === "number" && Number.isFinite(now) ? now : null;
  }

  // Expiry needs a clock that only moves forward. A backwards or non-finite
  // sample deletes nothing, and the next usable sample resumes normal expiry.
  // A backwards reading still re-baselines: an NTP correction moves the clock
  // back for good, and holding the pre-correction peak as a floor would
  // suspend every future expiry until wall-clock time caught back up.
  function clockSample() {
    const now = stamp();
    if (now === null) return null;
    if (now < lastClock) {
      lastClock = now;
      return null;
    }
    lastClock = now;
    return now;
  }

  function sortedRoster() {
    const rows = [];
    for (const entry of roster) {
      rows.push({
        id: entry[0],
        label: entry[1].label,
        act: entry[1].act,
        aid: entry[1].aid,
        order: entry[1].order,
      });
    }
    rows.sort((left, right) => left.order - right.order);
    return rows;
  }

  // --- Masthead -------------------------------------------------------------

  function mountContainer() {
    if (container !== null) return true;
    try {
      const node = document.createElement("div");
      node.id = "doc-presence";
      node.className = "doc-presence";
      node.setAttribute("role", "group");
      node.setAttribute("aria-label", "Live presence");

      const faces = document.createElement("div");
      faces.className = "doc-presence-faces";
      faces.setAttribute("role", "list");
      faces.setAttribute("aria-live", "polite");
      faces.setAttribute("aria-atomic", "true");
      faces.setAttribute("aria-label", summary(0));

      const toggle = document.createElement("button");
      toggle.id = "doc-presence-toggle";
      toggle.className = "doc-presence-toggle";
      toggle.setAttribute("type", "button");
      toggle.addEventListener("click", onToggle);

      node.append(faces, toggle);
      headEl.insertBefore(node, themeEl);

      container = node;
      facesEl = faces;
      toggleEl = toggle;
      applyToggleState();
      return true;
    } catch (ignored) {
      teardown();
      return false;
    }
  }

  // The pressed state never rests on colour alone: both the visible text and
  // the accessible name change with it.
  function applyToggleState() {
    if (toggleEl === null) return;
    if (hiddenByChoice) {
      toggleEl.textContent = "Show me";
      toggleEl.setAttribute("aria-label", "Show me in live presence");
      toggleEl.setAttribute("aria-pressed", "true");
      return;
    }
    toggleEl.textContent = "Hide me";
    toggleEl.setAttribute("aria-label", "Hide me from live presence");
    toggleEl.setAttribute("aria-pressed", "false");
  }

  function onToggle() {
    if (!activated || toggleEl === null) return;
    if (hiddenByChoice) showMe();
    else hideMe();
  }

  // Only a successful removal changes the in-memory preference: storage that
  // cannot be cleared keeps this reader silent rather than broadcasting a
  // choice the next load would forget.
  function showMe() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (ignored) {
      return;
    }
    hiddenByChoice = false;
    applyToggleState();
    if (!suspended && isVisible()) sendBeat();
    // Proof outranks this opt-in's own publish: an already-decorated tab keeps
    // its faces, rail and sweep, and gains the beat schedule, even if the
    // immediate call settles false.
    if (transportProved && !suspended && isVisible()) startBeat();
  }

  function hideMe() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (ignored) {
      // The current tab hides regardless; a future load re-reads and, with
      // storage still unavailable, fails closed to hidden anyway.
    }
    hiddenByChoice = true;
    applyToggleState();
    stopBeat();
    sendBye();
  }

  function repaint() {
    if (facesEl === null) return;
    try {
      const rows = sortedRoster();
      const nodes = [];
      const shown = rows.length < MAX_FACES ? rows.length : MAX_FACES;
      for (let index = 0; index < shown; index += 1) nodes.push(avatarNode(rows[index]));
      if (rows.length > MAX_FACES) {
        const extra = rows.length - MAX_FACES;
        const more = document.createElement("span");
        more.className = "doc-presence-more";
        more.setAttribute("role", "listitem");
        more.textContent = `+${extra}`;
        more.setAttribute("aria-label", `${extra} more readers`);
        nodes.push(more);
      }
      facesEl.replaceChildren(...nodes);
      facesEl.setAttribute("aria-label", summary(rows.length));
    } catch (ignored) {
      return;
    }
    requestPlacement();
  }

  function avatarNode(row) {
    const node = document.createElement("span");
    node.className = `doc-presence-avatar doc-presence-colour-${colourIndex(row.id)}`;
    node.setAttribute("role", "listitem");
    node.textContent = initials(row.label);
    node.title = row.label;
    node.setAttribute("aria-label", `${row.label}, ${row.act}`);
    return node;
  }

  function summary(count) {
    if (count === 0) return "No readers present";
    if (count === 1) return "1 reader present";
    return `${count} readers present`;
  }

  // 32-bit FNV-1a over the exact validated client ID's UTF-16 code units. The
  // ID itself never reaches the DOM; only this index does.
  function colourIndex(clientId) {
    let hash = 2166136261;
    for (let index = 0; index < clientId.length; index += 1) {
      hash ^= clientId.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % COLOURS;
  }

  function initials(label) {
    const words = label.trim().split(WHITESPACE_RUN_RE).filter((word) => word !== "");
    if (words.length === 0) return "?";
    const first = firstPoint(words[0]);
    const last = words.length > 1 ? firstPoint(words[words.length - 1]) : "";
    const text = `${first}${last}`;
    return text === "" ? "?" : text;
  }

  function firstPoint(word) {
    for (const point of word) return point;
    return "";
  }

  // --- Block markers --------------------------------------------------------

  function createRail() {
    if (railEl !== null) return;
    try {
      const rail = document.createElement("div");
      rail.id = "doc-presence-rail";
      rail.setAttribute("aria-label", "Reader locations");
      document.body.append(rail);
      railEl = rail;
    } catch (ignored) {
      railEl = null;
      return;
    }
    if (placementBound) return;
    placementBound = true;
    window.addEventListener("resize", requestPlacement);
    document.addEventListener("toggle", requestPlacement, true);
  }

  function bindFonts() {
    if (fontsBound) return;
    fontsBound = true;
    try {
      const fonts = document.fonts;
      if (fonts === null || typeof fonts !== "object") return;
      const ready = fonts.ready;
      if (ready === null || typeof ready !== "object") return;
      if (typeof ready.then !== "function") return;
      ready.then(onFontsReady, onFontsReady);
    } catch (ignored) {
      // A missing FontFaceSet or a rejected ready promise is not a failure.
    }
  }

  function onFontsReady() {
    requestPlacement();
  }

  function requestPlacement() {
    if (railEl === null || suspended || frameId !== 0) return;
    try {
      frameId = requestAnimationFrame(runPlacement);
    } catch (ignored) {
      frameId = 0;
    }
  }

  function cancelPlacement() {
    if (frameId === 0) return;
    try {
      cancelAnimationFrame(frameId);
    } catch (ignored) {
      // The frame is abandoned either way; `frameId` is cleared below.
    }
    frameId = 0;
  }

  function runPlacement() {
    frameId = 0;
    try {
      place();
    } catch (ignored) {
      // Keep the last good rail rather than tearing decoration down.
    }
  }

  // Scrolling needs no listener: subtracting the rail rectangle from the block
  // rectangle already yields document coordinates.
  function place() {
    if (railEl === null || suspended) return;

    const blocks = blockIndex();
    const order = new Map();
    let position = 0;
    for (const aid of blocks.keys()) {
      order.set(aid, position);
      position += 1;
    }

    const groups = new Map();
    for (const row of sortedRoster()) {
      if (row.aid === null || !blocks.has(row.aid)) continue;
      const rows = groups.get(row.aid);
      if (rows === undefined) groups.set(row.aid, [row]);
      else rows.push(row);
    }

    const railRect = railEl.getBoundingClientRect();
    const candidates = [];
    for (const entry of groups) {
      const block = blocks.get(entry[0]);
      if (!eligible(block)) continue;
      candidates.push({ aid: entry[0], rows: entry[1], rect: block.getBoundingClientRect(), node: null });
    }
    candidates.sort((left, right) => order.get(left.aid) - order.get(right.aid));

    const nodes = [];
    for (const candidate of candidates) {
      candidate.node = markerNode(candidate.rows);
      nodes.push(candidate.node);
    }
    railEl.replaceChildren(...nodes);

    // Measure every marker first, then write every position, the way the
    // comment rail's own placement pass does. Interleaving an `offsetWidth`
    // read with the previous marker's style write forces one synchronous
    // reflow per marker.
    const scrollWidth = document.documentElement.scrollWidth;
    const placements = [];
    let previousTop = null;
    for (const candidate of candidates) {
      let top = candidate.rect.top - railRect.top;
      if (previousTop !== null && top < previousTop + MARKER_GAP_PX) top = previousTop + MARKER_GAP_PX;
      previousTop = top;

      const desired = candidate.rect.right - railRect.left + MARKER_OFFSET_PX;
      const ceiling = scrollWidth - candidate.node.offsetWidth - RAIL_EDGE_PX;
      placements.push({
        node: candidate.node,
        top,
        left: Math.max(RAIL_EDGE_PX, Math.min(desired, ceiling)),
      });
    }
    for (const placement of placements) {
      placement.node.style.top = `${placement.top}px`;
      placement.node.style.left = `${placement.left}px`;
    }
  }

  // A duplicated ID names no single block, so it names none.
  function blockIndex() {
    const found = new Map();
    const duplicated = [];
    for (const element of document.querySelectorAll("[data-aid]")) {
      const aid = element.getAttribute("data-aid");
      if (typeof aid !== "string" || !AID_RE.test(aid)) continue;
      if (found.has(aid)) {
        duplicated.push(aid);
        continue;
      }
      found.set(aid, element);
    }
    for (const aid of duplicated) found.delete(aid);
    return found;
  }

  function eligible(block) {
    try {
      if (block === null || block === undefined) return false;
      if (block.isConnected !== true) return false;
      const details = block.closest("details");
      if (details !== null && details !== undefined && details.open === false) return false;
      const rect = block.getBoundingClientRect();
      return rect.width !== 0 || rect.height !== 0;
    } catch (ignored) {
      return false;
    }
  }

  function markerNode(rows) {
    const node = document.createElement("div");
    node.className = "doc-presence-marker";
    node.setAttribute("role", "img");

    const children = [];
    const shown = rows.length < MAX_MARKER_INITIALS ? rows.length : MAX_MARKER_INITIALS;
    for (let index = 0; index < shown; index += 1) {
      const initial = document.createElement("span");
      initial.className = `doc-presence-initial doc-presence-colour-${colourIndex(rows[index].id)}`;
      initial.textContent = initials(rows[index].label);
      children.push(initial);
    }
    if (rows.length > MAX_MARKER_INITIALS) {
      const extra = document.createElement("span");
      extra.className = "doc-presence-initial doc-presence-marker-more";
      extra.textContent = `+${rows.length - MAX_MARKER_INITIALS}`;
      children.push(extra);
    }
    node.append(...children);

    const phrases = [];
    for (const row of rows) phrases.push(`${row.label}, ${row.act}`);
    node.setAttribute("aria-label", phrases.join("; "));
    return node;
  }

  // --- Page lifecycle -------------------------------------------------------

  function onVisibility() {
    if (!activated || suspended) return;
    if (!isVisible()) {
      // Peers remove this reader by lease. Going to another tab is not leaving.
      stopBeat();
      return;
    }
    sweep();
    if (hiddenByChoice) return;
    sendBeat();
    if (transportProved) startBeat();
  }

  function onOnline() {
    if (!activated || suspended || transportProved) return;
    if (hiddenByChoice || !isVisible()) return;
    sendBeat();
  }

  // P3-F's earlier listener has already closed SSE and explicitly permits this
  // later keepalive publish. A reader who already chose Hide sends nothing, so
  // a peer that never saw the transition never learns their client ID.
  function onPageHide() {
    if (!activated) return;
    if (!hiddenByChoice) sendBye();
    stopBeat();
    stopSweep();
    cancelPlacement();
    roster.clear();
    if (railEl !== null) {
      try {
        railEl.replaceChildren();
      } catch (ignored) {
        // Nothing durable depends on the rail being emptied.
      }
    }
    if (facesEl !== null) {
      try {
        facesEl.replaceChildren();
        facesEl.setAttribute("aria-label", summary(0));
      } catch (ignored) {
        // Same: the page is going away or being persisted.
      }
    }
    // Release the in-flight beat with every other handle. P3-F aborts its
    // publish controllers on its own earlier pagehide, so nothing is still
    // travelling; leaving the flag set would swallow the immediate beat a
    // BFCache restore owes its peers until the abandoned call settled.
    beatPending = false;
    suspended = true;
  }

  function onPageShow(event) {
    if (!activated) return;
    let persisted = false;
    try {
      persisted = event.persisted === true;
    } catch (ignored) {
      return;
    }
    if (!persisted) return;

    suspended = false;
    if (transportProved) startSweep();
    sweep();
    repaint();
    if (hiddenByChoice || !isVisible()) return;
    sendBeat();
    if (transportProved) startBeat();
  }

  // Only for a fatal failure during setup: normal Document destruction is the
  // terminal boundary in every other case.
  function teardown() {
    document.removeEventListener("session", onSession);
    document.removeEventListener("doc:event", onDocEvent);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    if (placementBound) {
      window.removeEventListener("resize", requestPlacement);
      document.removeEventListener("toggle", requestPlacement, true);
      placementBound = false;
    }
    stopBeat();
    stopSweep();
    cancelPlacement();
    roster.clear();
    try {
      if (railEl !== null) railEl.remove();
      if (container !== null) container.remove();
    } catch (ignored) {
      // Nothing else depends on the nodes being gone.
    }
    railEl = null;
    container = null;
    facesEl = null;
    toggleEl = null;
    activated = false;
    suspended = true;
  }
})();
