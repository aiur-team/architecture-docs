import { isProxy } from "node:util/types";
import { publish } from "./realtime.mjs";

const INVALID_DEPENDENCIES = "Invalid notify dependencies";
const INVALID_NOTIFICATION = "Invalid notification";
const DEPENDENCY_KEYS = new Set([
  "envGet",
  "fetchFn",
  "timeoutSignalFn",
  "publishFn",
]);
const DOC_ID = /^[0-9a-f]{6}$/;
const THREAD_ID = /^t_[0-9a-z]+_[0-9a-f]{8}$/;
const SUGGESTION_ID = /^s_[0-9a-z]+_[0-9a-f]{8}$/;
const ANCHOR_ID = /^a[0-9a-f]{8}$/;
const HASH = /^[0-9a-f]{64}$/;
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
).get;

function invalidDependencies() {
  throw new TypeError(INVALID_DEPENDENCIES);
}

function invalidNotification() {
  throw new TypeError(INVALID_NOTIFICATION);
}

function validateDependencies(dependencies) {
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    isProxy(dependencies) ||
    Array.isArray(dependencies) ||
    Object.getPrototypeOf(dependencies) !== Object.prototype
  ) {
    invalidDependencies();
  }

  for (const key of Reflect.ownKeys(dependencies)) {
    if (typeof key !== "string" || !DEPENDENCY_KEYS.has(key)) {
      invalidDependencies();
    }
    const descriptor = Object.getOwnPropertyDescriptor(dependencies, key);
    if (!("value" in descriptor) || typeof descriptor.value !== "function") {
      invalidDependencies();
    }
  }
}

function validWebhookUrl(value) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    /\s/u.test(value) ||
    /[?#]/u.test(value) ||
    value !== value.trim()
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "hooks.slack.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(
        url.pathname,
      )
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function validSiteOrigin(value) {
  if (
    typeof value !== "string" ||
    /\s/u.test(value) ||
    /[?#]/u.test(value) ||
    value !== value.trim()
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function hasValidText(value, maximum, countScalars) {
  if (typeof value !== "string") {
    return false;
  }
  if (countScalars ? Array.from(value).length > maximum : value.length > maximum) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return false;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validName(value) {
  return hasValidText(value, 200, false);
}

function validContent(value, maximum) {
  return hasValidText(value, maximum, true);
}

const SHAPES = Object.freeze({
  "thread.created": Object.freeze({
    docId: (value) => typeof value === "string" && DOC_ID.test(value),
    threadId: (value) => typeof value === "string" && THREAD_ID.test(value),
    actorName: validName,
    threadKind: (value) => value === "comment" || value === "discussion",
    body: (value) => validContent(value, 8_000),
    quote: (value) => value === null || validContent(value, 8_000),
  }),
  "thread.replied": Object.freeze({
    docId: (value) => typeof value === "string" && DOC_ID.test(value),
    threadId: (value) => typeof value === "string" && THREAD_ID.test(value),
    actorName: validName,
    body: (value) => validContent(value, 8_000),
    quote: (value) => value === null || validContent(value, 8_000),
  }),
  "suggest.created": Object.freeze({
    docId: (value) => typeof value === "string" && DOC_ID.test(value),
    suggestionId: (value) =>
      typeof value === "string" && SUGGESTION_ID.test(value),
    aid: (value) => typeof value === "string" && ANCHOR_ID.test(value),
    actorName: validName,
    text: (value) => validContent(value, 4_000),
  }),
  "suggest.decided": Object.freeze({
    docId: (value) => typeof value === "string" && DOC_ID.test(value),
    suggestionId: (value) =>
      typeof value === "string" && SUGGESTION_ID.test(value),
    aid: (value) => typeof value === "string" && ANCHOR_ID.test(value),
    authorName: validName,
    deciderName: validName,
    outcome: (value) => value === "accepted" || value === "rejected",
  }),
  "edit.saved": Object.freeze({
    docId: (value) => typeof value === "string" && DOC_ID.test(value),
    aid: (value) => typeof value === "string" && ANCHOR_ID.test(value),
    hash: (value) => typeof value === "string" && HASH.test(value),
  }),
});

/**
 * Project a validated notification onto the P2-F event union, or null when the
 * kind carries no realtime hint. Every call builds a fresh ordinary object
 * holding only identifiers, never the notification itself and never its text.
 *
 * @param {Notification} notification
 * @returns {null | {t: "thread.changed", threadId: string} | {t: "edit.saved", aid: string, hash: string}}
 */
function realtimeEventFor(notification) {
  if (notification.t === "thread.created" || notification.t === "thread.replied") {
    return { t: "thread.changed", threadId: notification.threadId };
  }
  if (notification.t === "edit.saved") {
    return { t: "edit.saved", aid: notification.aid, hash: notification.hash };
  }
  return null;
}

function validateContext(context) {
  if (
    context === null ||
    typeof context !== "object" ||
    isProxy(context) ||
    Array.isArray(context) ||
    Object.getPrototypeOf(context) !== Object.prototype
  ) {
    invalidNotification();
  }
  const descriptor = Object.getOwnPropertyDescriptor(context, "waitUntil");
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function"
  ) {
    invalidNotification();
  }
}

function validateNotification(notification) {
  if (
    notification === null ||
    typeof notification !== "object" ||
    isProxy(notification) ||
    Array.isArray(notification) ||
    Object.getPrototypeOf(notification) !== Object.prototype
  ) {
    invalidNotification();
  }

  const typeDescriptor = Object.getOwnPropertyDescriptor(notification, "t");
  if (
    !typeDescriptor ||
    !("value" in typeDescriptor) ||
    !typeDescriptor.enumerable ||
    !typeDescriptor.writable ||
    !typeDescriptor.configurable ||
    typeof typeDescriptor.value !== "string"
  ) {
    invalidNotification();
  }
  if (!Object.hasOwn(SHAPES, typeDescriptor.value)) {
    invalidNotification();
  }
  const shape = SHAPES[typeDescriptor.value];

  const expectedKeys = new Set(["t", ...Object.keys(shape)]);
  const keys = Reflect.ownKeys(notification);
  if (
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    invalidNotification();
  }

  for (const [key, predicate] of Object.entries(shape)) {
    const descriptor = Object.getOwnPropertyDescriptor(notification, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !descriptor.writable ||
      !descriptor.configurable ||
      !predicate(descriptor.value)
    ) {
      invalidNotification();
    }
  }
}

function truncate(value, maximum) {
  const scalars = Array.from(value);
  return scalars.length <= maximum
    ? value
    : `${scalars.slice(0, maximum - 1).join("")}…`;
}

function presentationText(value, maximum) {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim());
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return truncate(lines.join("\n"), maximum).replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nameText(value) {
  return presentationText(value, 80) || "Someone";
}

function messageFor(notification, siteOrigin) {
  const documentUrl = `${siteOrigin}/d/${notification.docId}`;
  if (notification.t === "suggest.decided") {
    return `*${nameText(notification.deciderName)}* ${notification.outcome} *${nameText(notification.authorName)}*'s suggestion on <${documentUrl}|document ${notification.docId}>`;
  }

  const actor = nameText(notification.actorName);
  if (notification.t === "suggest.created") {
    const text = presentationText(notification.text, 400);
    const heading = `*${actor}* proposed a change on <${documentUrl}|document ${notification.docId}>`;
    return text === "" ? heading : `${heading}\n> ${text}`;
  }

  const verb = notification.t === "thread.replied"
    ? "replied"
    : notification.threadKind === "discussion"
      ? "started a discussion"
      : "commented";
  const heading = `*${actor}* ${verb} on <${documentUrl}|document ${notification.docId}>`;
  const lines = [heading];
  if (notification.quote !== null) {
    const quote = presentationText(notification.quote, 140);
    if (quote !== "") lines.push(`> ${quote}`);
  }
  const body = presentationText(notification.body, 400);
  if (body !== "") lines.push(body);
  return lines.join("\n");
}

async function acceptedSlackResponse(response) {
  if (!response || response.status !== 200) {
    await response?.body?.cancel();
    return false;
  }

  let reader;
  try {
    reader = response.body.getReader();
    const chunks = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !ArrayBuffer.isView(value) ||
        typedArrayTag.call(value) !== "Uint8Array"
      ) {
        return false;
      }
      byteLength += value.byteLength;
      if (byteLength > 16) return false;
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) === "ok";
  } finally {
    reader?.releaseLock();
  }
}

export function createNotifier(dependencies = {}) {
  validateDependencies(dependencies);
  const envGet = dependencies.envGet ?? ((name) => Netlify.env.get(name));
  const fetch = dependencies.fetchFn ?? globalThis.fetch;
  const timeoutSignal = dependencies.timeoutSignalFn ?? ((ms) => AbortSignal.timeout(ms));
  const publishFn = dependencies.publishFn ?? publish;

  /**
   * The sole server fan-out point. Schedules the applicable Slack message and
   * the applicable realtime projection independently: either sink may fail
   * without touching the other or the durable response, and neither is awaited.
   *
   * @param {{waitUntil(promise: Promise<unknown>): void}} context
   * @param {Notification} notification
   * @returns {boolean} true when at least one sink was accepted by waitUntil
   */
  return function notify(context, notification) {
    validateContext(context);
    validateNotification(notification);

    let scheduled = false;

    if (notification.t !== "edit.saved") {
      try {
        const webhookUrl = validWebhookUrl(envGet("SLACK_WEBHOOK_URL"));
        const siteOrigin =
          webhookUrl === null ? null : validSiteOrigin(envGet("URL"));
        if (webhookUrl !== null && siteOrigin !== null) {
          const signal = timeoutSignal(2_000);
          const slackPromise = Promise.resolve(fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/plain",
            },
            body: JSON.stringify({ text: messageFor(notification, siteOrigin) }),
            signal,
          })).then(acceptedSlackResponse).catch(() => false);
          slackPromise.catch(() => {});
          context.waitUntil(slackPromise);
          scheduled = true;
        }
      } catch {
        // A Slack configuration read, request, or registration failure never
        // stops the realtime sink.
      }
    }

    const event = realtimeEventFor(notification);
    if (event !== null) {
      try {
        const realtimePromise = publishFn(notification.docId, event);
        if (
          realtimePromise !== null &&
          realtimePromise !== undefined &&
          typeof realtimePromise.then === "function" &&
          typeof realtimePromise.catch === "function"
        ) {
          // Observe rejection on the side only. The exact promise the sink
          // returned is what waitUntil registers, so an injected rejection
          // stays a rejection rather than becoming a resolving wrapper.
          realtimePromise.catch(() => {});
          context.waitUntil(realtimePromise);
          scheduled = true;
        }
      } catch {
        // A synchronous sink or registration failure is swallowed for realtime
        // alone; Slack scheduling above already happened.
      }
    }

    return scheduled;
  };
}

export const notify = createNotifier();
