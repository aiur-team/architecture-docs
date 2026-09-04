// realtime.js — the optional client realtime transport.
//
// Dark by default. It activates only from P2-C's valid `session` event, asks
// P2-F for a narrow one-hour token, subscribes to the document's two separated
// Ably channels over one SSE connection, and publishes the four permitted
// ephemeral client events over REST. Everything it exposes is one frozen
// `window.doc.realtime.publish()` and validated `doc:event` details; no
// credential, channel, or transport object ever leaves this closure.
//
// Realtime is a hint layer. Nothing durable waits on it, so every failure is a
// silent, permanent degrade rather than a notice, retry loop, or thrown error.

(() => {
  "use strict";

  const ABLY_ORIGIN = "https://main.realtime.ably.net";
  const ABLY_VERSION = "1.2";
  const TOKEN_TIMEOUT_MS = 7000;
  const PUBLISH_TIMEOUT_MS = 5000;
  const CLOCK_SKEW_MS = 60000;
  const TOKEN_TTL_MS = 3600000;
  const TOKEN_LIMIT = 8192;
  const REST_LIMIT = 4096;
  const MESSAGE_LIMIT = 4096;
  const CURSOR_LIMIT = 512;
  const AUTH_CODE_MIN = 40140;
  const AUTH_CODE_MAX = 40149;

  const DOC_ID_RE = /^[0-9a-f]{6}$/;
  const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
  const AID_RE = /^a[0-9a-f]{8}$/;
  const THREAD_ID_RE = /^t_[0-9a-z]{1,48}_[0-9a-f]{8}$/;
  const HASH_RE = /^[0-9a-f]{64}$/;
  const TOKEN_TEXT_RE = /^[\u0021-\u007e]{1,343}$/;
  const CONTENT_LENGTH_RE = /^(?:0|[1-9][0-9]{0,3})$/;
  const MEDIA_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const MEDIA_QUOTED_RE = /^"(?:[^"\\\u0000-\u001f]|\\[\u0020-\u007e])*"$/;
  const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
  const CURSOR_INVALID_RE = /[\u0000\r\n]/;

  // Gate 1: no EventSource, no transport, no listener, no global.
  if (typeof window.EventSource !== "function") return;

  // Gate 2: a `file:` artifact stops before anything observable happens.
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  // P1-B owns `window.doc`. Never overwrite another owner's realtime surface.
  const namespace = window.doc;
  if (namespace === null || typeof namespace !== "object") return;
  if (Object.prototype.hasOwnProperty.call(namespace, "realtime")) return;

  const encoder = new TextEncoder();

  let dark = false;
  let started = false;
  let activation = null;
  let credential = null;
  let refreshing = null;
  let awaitingOpen = false;
  let stream = null;
  let streamHandlers = null;
  let generation = 0;
  let cursor = "";
  let docId = "";
  let serverChannel = "";
  let clientChannel = "";
  let tokenController = null;
  let acquiring = false;
  let suspended = false;
  let suspendedAcquisition = false;
  let restartNeeded = false;
  const publishControllers = new Set();

  // --- Reflection helpers -------------------------------------------------
  //
  // Every provider and caller value is inspected through descriptors inside a
  // defensive boundary, so an exotic object fails closed instead of running an
  // accessor or a proxy trap in our stead.

  // Prototype identity is realm-scoped: a plain object handed over from another
  // realm (an iframe, a worker, a test harness) carries a structurally
  // identical but non-identical `Object.prototype`. Accept that shape and still
  // reject a null, custom, or deeper prototype chain.
  const ordinaryObject = (value) => {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype) return true;
    return (
      proto !== null &&
      Object.getPrototypeOf(proto) === null &&
      Object.prototype.hasOwnProperty.call(proto, "hasOwnProperty") &&
      Object.prototype.hasOwnProperty.call(proto, "isPrototypeOf")
    );
  };

  const ownDataKeys = (value) => {
    if (value === null || typeof value !== "object") return null;
    try {
      if (Array.isArray(value)) return null;
      if (!ordinaryObject(value)) return null;
      const names = [];
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined) return null;
        if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
        if (
          descriptor.enumerable !== true ||
          descriptor.writable !== true ||
          descriptor.configurable !== true
        ) {
          return null;
        }
        names.push(key);
      }
      return names;
    } catch (ignored) {
      return null;
    }
  };

  const exactKeys = (names, expected) =>
    names.length === expected.length && expected.every((key) => names.includes(key));

  const matches = (pattern, value) => typeof value === "string" && pattern.test(value);

  // A dense ordinary array holding each expected operation exactly once.
  const operationList = (value, expected) => {
    if (value === null || typeof value !== "object") return false;
    try {
      if (!Array.isArray(value)) return false;
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== expected.length + 1) return false;
      const found = [];
      for (let index = 0; index < expected.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) return false;
        if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) return false;
        if (
          descriptor.enumerable !== true ||
          descriptor.writable !== true ||
          descriptor.configurable !== true
        ) {
          return false;
        }
        found.push(descriptor.value);
      }
      if (value.length !== expected.length) return false;
      return expected.every(
        (operation) => found.filter((entry) => entry === operation).length === 1,
      );
    } catch (ignored) {
      return false;
    }
  };

  // --- Bounded response bodies --------------------------------------------

  const jsonMedia = (response) => {
    let raw;
    try {
      raw = response.headers.get("content-type");
    } catch (ignored) {
      return false;
    }
    if (typeof raw !== "string") return false;
    const parts = raw.split(";");
    if (parts[0].trim().toLowerCase() !== "application/json") return false;
    for (let index = 1; index < parts.length; index += 1) {
      const parameter = parts[index].trim();
      const equals = parameter.indexOf("=");
      if (equals <= 0) return false;
      const name = parameter.slice(0, equals);
      const value = parameter.slice(equals + 1);
      if (!MEDIA_TOKEN_RE.test(name)) return false;
      if (!MEDIA_TOKEN_RE.test(value) && !MEDIA_QUOTED_RE.test(value)) return false;
    }
    return true;
  };

  // The one body reader. Returns `{ value }` for a parsed body, or null. A
  // declared length larger than the endpoint's limit fails before the stream is
  // even touched, and no partial byte survives a failure.
  const readBoundedJson = async (response, limit) => {
    let declared;
    try {
      declared = response.headers.get("content-length");
    } catch (ignored) {
      return null;
    }
    if (declared !== null && declared !== undefined) {
      if (!CONTENT_LENGTH_RE.test(declared)) return null;
      if (Number(declared) > limit) return null;
    }

    let reader = null;
    try {
      const body = response.body;
      if (body === null || body === undefined) return null;
      reader = body.getReader();
    } catch (ignored) {
      return null;
    }
    if (reader === null || reader === undefined) return null;

    let decoded = null;
    let complete = false;
    let ok = false;
    try {
      const parts = [];
      let total = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done === true) break;
        const value = chunk.value;
        if (!(value instanceof Uint8Array)) throw new Error();
        const size = value.byteLength;
        if (!Number.isSafeInteger(size)) throw new Error();
        const next = total + size;
        if (!Number.isSafeInteger(next) || next > limit) throw new Error();
        total = next;
        parts.push(value);
      }
      complete = true;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(merged);
      ok = true;
    } catch (ignored) {
      ok = false;
      if (!complete) {
        try {
          await reader.cancel();
        } catch (swallowed) {
          // A cancellation rejection is folded into the same failure.
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (ignored) {
        ok = false;
      }
    }
    if (!ok) return null;
    try {
      return { value: JSON.parse(decoded) };
    } catch (ignored) {
      return null;
    }
  };

  // --- Credential acquisition ---------------------------------------------

  const validCapability = (value) => {
    if (typeof value !== "string") return false;
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (ignored) {
      return false;
    }
    const keys = ownDataKeys(parsed);
    if (keys === null || !exactKeys(keys, [serverChannel, clientChannel])) return false;
    return (
      operationList(parsed[serverChannel], ["subscribe"]) &&
      operationList(parsed[clientChannel], ["publish", "subscribe"])
    );
  };

  const validToken = (value, requestTime, responseTime) => {
    const keys = ownDataKeys(value);
    if (keys === null) return null;
    if (!exactKeys(keys, ["token", "issued", "expires", "capability", "clientId"])) return null;
    const text = value.token;
    const issued = value.issued;
    const expires = value.expires;
    const clientId = value.clientId;
    if (typeof text !== "string" || !TOKEN_TEXT_RE.test(text)) return null;
    if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)) return null;
    if (issued < requestTime - CLOCK_SKEW_MS) return null;
    if (issued > responseTime + CLOCK_SKEW_MS) return null;
    if (expires <= responseTime) return null;
    if (expires <= issued) return null;
    if (expires - issued > TOKEN_TTL_MS) return null;
    if (expires > responseTime + TOKEN_TTL_MS + CLOCK_SKEW_MS) return null;
    if (!matches(CLIENT_ID_RE, clientId)) return null;
    if (!validCapability(value.capability)) return null;
    return {
      token: text,
      issued,
      expires,
      capability: value.capability,
      clientId,
    };
  };

  const acquireToken = async () => {
    const controller = new AbortController();
    tokenController = controller;
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (ignored) {
        // An abort failure just leaves the fetch to its own outcome.
      }
    }, TOKEN_TIMEOUT_MS);
    const requestTime = Date.now();
    try {
      const response = await fetch(`/api/realtime-token?doc=${docId}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status !== 200) return null;
      if (!jsonMedia(response)) return null;
      const parsed = await readBoundedJson(response, TOKEN_LIMIT);
      if (parsed === null) return null;
      return validToken(parsed.value, requestTime, Date.now());
    } catch (ignored) {
      return null;
    } finally {
      clearTimeout(timer);
      if (tokenController === controller) tokenController = null;
    }
  };

  // --- The stream ---------------------------------------------------------

  const closeStream = () => {
    generation += 1;
    const current = stream;
    const handlers = streamHandlers;
    stream = null;
    streamHandlers = null;
    if (current === null || current === undefined) return;
    if (handlers !== null) {
      for (const type of ["message", "error", "open"]) {
        try {
          current.removeEventListener(type, handlers[type]);
        } catch (ignored) {
          // Detachment is best effort; close() below is the real guarantee.
        }
      }
    }
    try {
      current.close();
    } catch (ignored) {
      // The platform closes an abandoned EventSource with the Document anyway.
    }
  };

  const degrade = () => {
    if (dark) return;
    dark = true;
    try {
      document.removeEventListener("session", onSession);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    } catch (ignored) {
      // Keep tearing the rest down even if listener removal throws.
    }
    closeStream();
    if (tokenController !== null) {
      try {
        tokenController.abort();
      } catch (ignored) {
        // Ignored: the acquisition already resolves to a dark transport.
      }
      tokenController = null;
    }
    for (const controller of publishControllers) {
      try {
        controller.abort();
      } catch (ignored) {
        // Ignored: each publication settles false on its own.
      }
    }
    publishControllers.clear();
    credential = null;
    activation = null;
    refreshing = null;
    cursor = "";
    awaitingOpen = false;
  };

  const updateCursor = (value) => {
    if (
      typeof value === "string" &&
      value.length <= CURSOR_LIMIT &&
      !CURSOR_INVALID_RE.test(value)
    ) {
      cursor = value;
      return;
    }
    cursor = "";
  };

  // Normalize one enveloped provider message into a frozen `doc:event` detail,
  // or null. The channel is checked before the name, which is what keeps P2-F's
  // server/client trust boundary intact after both channels share a transport.
  const normalize = (raw) => {
    if (typeof raw !== "string") return null;
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (ignored) {
      return null;
    }
    const outer = ownDataKeys(envelope);
    if (outer === null) return null;
    if (
      !outer.includes("channel") ||
      !outer.includes("name") ||
      !outer.includes("encoding") ||
      !outer.includes("data")
    ) {
      return null;
    }
    const channel = envelope.channel;
    const name = envelope.name;
    const payload = envelope.data;
    if (typeof channel !== "string" || typeof name !== "string") return null;
    if (envelope.encoding !== "json" || typeof payload !== "string") return null;
    if (encoder.encode(payload).byteLength > MESSAGE_LIMIT) return null;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (ignored) {
      return null;
    }
    const fields = ownDataKeys(data);
    if (fields === null) return null;

    if (channel === serverChannel) {
      if (name === "thread.changed") {
        if (!exactKeys(fields, ["threadId"])) return null;
        if (!matches(THREAD_ID_RE, data.threadId)) return null;
        return Object.freeze({ source: "server", t: "thread.changed", threadId: data.threadId });
      }
      if (name === "edit.saved") {
        if (!exactKeys(fields, ["aid", "hash"])) return null;
        if (!matches(AID_RE, data.aid) || !matches(HASH_RE, data.hash)) return null;
        return Object.freeze({
          source: "server",
          t: "edit.saved",
          aid: data.aid,
          hash: data.hash,
        });
      }
      return null;
    }

    if (channel !== clientChannel) return null;
    if (!outer.includes("clientId")) return null;
    const clientId = envelope.clientId;
    if (!matches(CLIENT_ID_RE, clientId)) return null;

    if (name === "beat") {
      if (!exactKeys(fields, ["label", "act", "aid"])) return null;
      const label = data.label;
      const act = data.act;
      const aid = data.aid;
      if (typeof label !== "string" || label.length < 1 || label.length > 24) return null;
      if (CONTROL_RE.test(label)) return null;
      if (act !== "reading" && act !== "editing") return null;
      if (aid !== null && !matches(AID_RE, aid)) return null;
      return Object.freeze({ source: "client", t: "beat", clientId, label, act, aid });
    }
    if (name === "bye") {
      if (!exactKeys(fields, [])) return null;
      return Object.freeze({ source: "client", t: "bye", clientId });
    }
    if (name === "edit.claim" || name === "edit.release") {
      if (!exactKeys(fields, ["aid"])) return null;
      if (!matches(AID_RE, data.aid)) return null;
      return Object.freeze({ source: "client", t: name, clientId, aid: data.aid });
    }
    return null;
  };

  const receive = (event) => {
    updateCursor(event.lastEventId);
    const detail = normalize(event.data);
    if (detail === null) return;
    document.dispatchEvent(new CustomEvent("doc:event", { detail }));
  };

  // Only a parseable Ably error body with an own safe-integer `code` is a
  // refresh candidate; a bare browser reconnect carries no such body.
  const sseErrorCode = (raw) => {
    if (typeof raw !== "string") return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (ignored) {
      return null;
    }
    const keys = ownDataKeys(parsed);
    if (keys === null || !keys.includes("code")) return null;
    return Number.isSafeInteger(parsed.code) ? parsed.code : null;
  };

  const restErrorCode = (value) => {
    const keys = ownDataKeys(value);
    if (keys === null || !keys.includes("error")) return null;
    const inner = value.error;
    const innerKeys = ownDataKeys(inner);
    if (innerKeys === null || !innerKeys.includes("code")) return null;
    return Number.isSafeInteger(inner.code) ? inner.code : null;
  };

  const isAuthCode = (code) =>
    code !== null && code >= AUTH_CODE_MIN && code <= AUTH_CODE_MAX;

  const attach = (resume) => {
    if (dark || credential === null) return;
    // Never let two streams overlap: a `pageshow` landing during an in-flight
    // refresh would otherwise attach beside the replacement it is racing.
    closeStream();
    const local = generation + 1;
    generation = local;

    const url = new URL(`${ABLY_ORIGIN}/sse`);
    url.searchParams.set("v", ABLY_VERSION);
    url.searchParams.set("channels", `${serverChannel},${clientChannel}`);
    url.searchParams.set("enveloped", "true");
    url.searchParams.set("accessToken", credential.token);
    if (resume && cursor !== "") url.searchParams.set("lastEvent", cursor);

    let source;
    try {
      source = new EventSource(url.href, { withCredentials: false });
    } catch (ignored) {
      degrade();
      return;
    }

    const handlers = {
      message: (event) => {
        if (local === generation) receive(event);
      },
      error: (event) => {
        if (local === generation) streamError(event, source);
      },
      open: () => {
        if (local === generation) awaitingOpen = false;
      },
    };
    stream = source;
    streamHandlers = handlers;
    try {
      source.addEventListener("message", handlers.message);
      source.addEventListener("error", handlers.error);
      source.addEventListener("open", handlers.open);
    } catch (ignored) {
      degrade();
    }
  };

  // One shared refresh: SSE expiry and a REST 401 racing each other must not
  // mint two credentials or leave two streams live.
  const refresh = () => {
    if (refreshing !== null) return refreshing;
    const run = (async () => {
      closeStream();
      const next = await acquireToken();
      if (dark) return null;
      if (next === null) {
        degrade();
        return null;
      }
      credential = next;
      awaitingOpen = true;
      attach(true);
      return next;
    })();
    refreshing = run;
    const clear = () => {
      if (refreshing === run) refreshing = null;
    };
    run.then(clear, clear);
    return run;
  };

  const streamError = (event, source) => {
    if (dark) return;
    const code = sseErrorCode(event === null || event === undefined ? null : event.data);
    if (isAuthCode(code)) {
      // A replacement that never opened and fails again is a loop, not a race.
      if (awaitingOpen) {
        degrade();
        return;
      }
      refresh();
      return;
    }
    if (code !== null) {
      degrade();
      return;
    }
    // A generic error while CONNECTING belongs to the browser's own reconnect
    // and backoff algorithm. We neither close it nor time it.
    let readyState;
    try {
      readyState = source.readyState;
    } catch (ignored) {
      readyState = EventSource.CLOSED;
    }
    if (readyState === EventSource.CONNECTING) return;
    degrade();
  };

  // --- Activation ---------------------------------------------------------

  const begin = async () => {
    acquiring = true;
    const next = await acquireToken();
    acquiring = false;
    if (dark) return false;
    if (next !== null) {
      credential = next;
      attach(false);
      return true;
    }
    // An abort caused by BFCache suspension is not a provider failure: the
    // original acquisition is simply resumed on restore.
    if (suspendedAcquisition) {
      suspendedAcquisition = false;
      if (suspended) restartNeeded = true;
      else activation = begin();
      return false;
    }
    degrade();
    return false;
  };

  function onSession(event) {
    if (dark || started) return;
    const detail = event === null || event === undefined ? null : event.detail;
    if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return;

    let mode;
    let metas;
    try {
      mode = document.documentElement.getAttribute("data-session");
      metas = document.querySelectorAll('meta[name="doc-id"]');
    } catch (ignored) {
      return;
    }
    if (mode !== "reader" && mode !== "editor") return;
    if (metas === null || metas === undefined || metas.length !== 1) return;

    let content;
    try {
      content = metas[0].getAttribute("content");
    } catch (ignored) {
      return;
    }
    if (!matches(DOC_ID_RE, content)) return;

    started = true;
    docId = content;
    serverChannel = `doc:${docId}:server`;
    clientChannel = `doc:${docId}:client`;
    try {
      document.removeEventListener("session", onSession);
    } catch (ignored) {
      // A stuck listener is harmless: `started` already makes it a no-op.
    }
    activation = begin();
  }

  function onPageHide() {
    if (dark) return;
    suspended = true;
    closeStream();
    if (acquiring) suspendedAcquisition = true;
    if (tokenController !== null) {
      try {
        tokenController.abort();
      } catch (ignored) {
        // Ignored: the acquisition restarts from `pageshow` either way.
      }
    }
  }

  function onPageShow(event) {
    if (dark) return;
    const persisted = event === null || event === undefined ? false : event.persisted;
    if (persisted !== true) return;
    suspended = false;
    if (!started) return;
    if (credential !== null) {
      attach(true);
      return;
    }
    if (restartNeeded) {
      restartNeeded = false;
      activation = begin();
    }
  }

  // --- The published surface ----------------------------------------------

  const clientMessage = (event) => {
    const keys = ownDataKeys(event);
    if (keys === null) return null;
    const t = event.t;
    if (t === "beat") {
      if (!exactKeys(keys, ["t", "label", "act", "aid"])) return null;
      const label = event.label;
      const act = event.act;
      const aid = event.aid;
      if (typeof label !== "string" || label.length < 1 || label.length > 24) return null;
      if (CONTROL_RE.test(label)) return null;
      if (act !== "reading" && act !== "editing") return null;
      if (aid !== null && !matches(AID_RE, aid)) return null;
      return { name: "beat", data: { label, act, aid } };
    }
    if (t === "bye") {
      if (!exactKeys(keys, ["t"])) return null;
      return { name: "bye", data: {} };
    }
    if (t === "edit.claim" || t === "edit.release") {
      if (!exactKeys(keys, ["t", "aid"])) return null;
      if (!matches(AID_RE, event.aid)) return null;
      return { name: t, data: { aid: event.aid } };
    }
    return null;
  };

  const validAcknowledgement = (value) => {
    const keys = ownDataKeys(value);
    if (keys === null) return false;
    if (value.channel !== clientChannel) return false;
    return typeof value.messageId === "string" && value.messageId !== "";
  };

  const send = async (message, allowRefresh) => {
    const used = credential;
    if (dark || used === null) return false;

    const controller = new AbortController();
    publishControllers.add(controller);
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (ignored) {
        // The publication settles false on its own if abort is unavailable.
      }
    }, PUBLISH_TIMEOUT_MS);

    let outcome = false;
    let authFailure = false;
    try {
      const response = await fetch(
        `${ABLY_ORIGIN}/channels/${encodeURIComponent(clientChannel)}/messages?v=${ABLY_VERSION}`,
        {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          keepalive: true,
          headers: {
            Authorization: `Bearer ${btoa(used.token)}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: message.name,
            data: message.data,
            clientId: used.clientId,
          }),
          signal: controller.signal,
        },
      );
      if (jsonMedia(response)) {
        const parsed = await readBoundedJson(response, REST_LIMIT);
        if (parsed !== null) {
          if (response.status === 201) outcome = validAcknowledgement(parsed.value);
          else authFailure = isAuthCode(restErrorCode(parsed.value));
        }
      }
    } catch (ignored) {
      outcome = false;
    } finally {
      clearTimeout(timer);
      publishControllers.delete(controller);
    }

    if (outcome || !authFailure || !allowRefresh || dark) return outcome;

    // Exactly one retry, on exactly one replacement credential. A caller that
    // lost the race to another refresh reuses the current credential instead of
    // minting a second one.
    const replacement = credential !== null && credential !== used ? credential : await refresh();
    if (replacement === null || dark) return false;
    return await send(message, false);
  };

  async function publish(event) {
    const message = clientMessage(event);
    if (message === null) return false;
    if (dark) return false;
    const pending = activation;
    if (pending === null) return false;
    try {
      await pending;
    } catch (ignored) {
      return false;
    }
    if (dark || credential === null) return false;
    return await send(message, true);
  }

  window.doc.realtime = Object.freeze({ publish });

  document.addEventListener("session", onSession);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
})();
