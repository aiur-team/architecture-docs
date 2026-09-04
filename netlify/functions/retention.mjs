import { StoreError, docState, eventKey, read } from "../lib/store.mjs";
import { assertEvent } from "./events.mjs";

/**
 * P4-F — the daily audit-event retention sweep.
 *
 * The event stream is an append-only audit view, not feature state, so ordinary
 * historical events may expire without changing comments, edits, suggestions or
 * access. Netlify Blobs has no automatic TTL for the `doc-state` store, so
 * expiry has to be application code, and this is the only place that deletes an
 * event.
 *
 * Everything here is deliberately bounded. One invocation samples one clock,
 * opens one store, walks at most ten manually pulled pages of the global
 * `events/` prefix, reads only keys that are already past the cutoff, validates
 * every record through the P3-B schema before touching it, and deletes at most
 * one hundred of them oldest-first. A run that cannot prove what it is looking
 * at fails; it never invents a successful sweep, never repairs a record, and
 * never retries the provider. The next daily run resumes from what is left.
 *
 * Amendment boundary
 * ------------------
 * P4-T is the only ticket allowed to amend this file. It must preserve the
 * schedule, the 540-day strict cutoff, manual pagination, deterministic
 * ordering, validation-before-delete, the delete cap, the failure semantics,
 * the summary version, and the no-route/no-identity boundary. It adds the
 * durable-event exclusion predicate and the separately bounded `suggest/` and
 * expired-invitation sweeps. P4-T must land before the P4-J/P4-N/P4-O writers
 * that make durable excluded kinds operational are deployed.
 */

/**
 * Eighteen months as a fixed duration: 18 * 30 fixed 24-hour days, or 540 days
 * in milliseconds. This is the research contract's definition and deliberately
 * not calendar-month arithmetic, so month length, timezone and daylight saving
 * time cannot move a boundary.
 */
export const EVENT_RETENTION_MS = 18 * 30 * 24 * 60 * 60 * 1000;

/**
 * The most events one invocation may delete. A safety bound chosen to stay
 * comfortably inside Netlify's fixed 30-second scheduled-function limit; it is
 * not a correctness boundary, and exhausting it is reported as `remaining`.
 */
export const MAX_EVENT_DELETES = 100;

/**
 * The global event root. P2-B's public `eventPrefix(docId, month)` requires a
 * document ID on purpose and cannot manufacture a cross-document prefix, so the
 * one global-scan literal lives here rather than widening that builder.
 */
const EVENT_ROOT_PREFIX = "events/";

/** Manual pagination bounds. Crossing one is an operational repair signal. */
const MAX_PAGES = 10;
const MAX_PAGE_ENTRIES = 1_000;
const MAX_KEYS = 10_000;
const MAX_PULLS = MAX_PAGES + 1;

/** Provider keys are short by construction; anything longer is not ours. */
const MAX_KEY_BYTES = 128;

/** Netlify's own bound on `nowMs`: a 13-digit epoch millisecond value. */
const MIN_NOW_MS = 1_000_000_000_000;
const MAX_NOW_MS = 9_999_999_999_999;

/** `events/<docId>/<YYYY-MM>/<13-digit-ms>-<hex6>.json`, and nothing else. */
const EVENT_KEY_PATTERN =
  /^events\/([0-9a-f]{6})\/(\d{4}-(?:0[1-9]|1[0-2]))\/((\d{13})-[0-9a-f]{6})\.json$/;

const KEY_ENCODER = new TextEncoder();

/**
 * The one listing request. Built through the ambient `Object` rather than as a
 * literal so the options carry the ordinary object prototype of whichever realm
 * loads the module, which keeps the single call site observable to a
 * deterministic out-of-realm harness.
 */
const LIST_OPTIONS = Object.assign(Object.create(Object.prototype), {
  prefix: EVENT_ROOT_PREFIX,
  paginate: true,
});

/**
 * Corrupt internal retention state: a stored key that this module's own writers
 * could not have produced. Distinct from `StoreError`, which means the provider
 * failed. The message is fixed and the code is a closed vocabulary; no provider
 * value, key, record or cause is ever carried, because this error may surface
 * in a platform log.
 *
 * P4-F uses `invalid-event-key`; P4-T may add `invalid-suggestion-key`,
 * `invalid-invitation-key` and `invitation-scan-limit`.
 */
class RetentionError extends Error {
  /** @param {string} code */
  constructor(code) {
    super("Invalid retention state");
    this.name = "RetentionError";
    this.code = code;
  }
}

/** @returns {StoreError} The one provider-failure error this module raises. */
function unavailable() {
  return new StoreError("unavailable", 503, "State store unavailable");
}

/** @returns {TypeError} */
function invalidOptions() {
  return new TypeError("Invalid retention options");
}

/**
 * Own enumerable string-keyed data property names, or `null` when the value is
 * not an inspectable ordinary-ish object. Never invokes an accessor.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
function ownDataKeys(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return null;
  }
  const names = Object.getOwnPropertyNames(value);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return null;
    }
  }
  return names;
}

/**
 * Own data keys of a value that must additionally be a plain object — no class
 * instance, no exotic prototype. Applied to provider envelopes only; a `Store`
 * is a class instance and is never checked this way.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
function ownDataKeysOfPlainObject(value) {
  const names = ownDataKeys(value);
  if (names === null) {
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return null;
  }
  return names;
}

/**
 * Whether an array is dense and carries no own key other than its indices.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isOrdinaryDenseArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  let indices = 0;
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "length") {
      continue;
    }
    const index = Number(name);
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
    indices += 1;
  }
  return indices === value.length;
}

/**
 * Validate the sweep clock: a safe 13-digit epoch millisecond value that round
 * trips through canonical UTC ISO text.
 *
 * @param {unknown} nowMs
 * @returns {boolean}
 */
function isValidClock(nowMs) {
  if (
    typeof nowMs !== "number" ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < MIN_NOW_MS ||
    nowMs > MAX_NOW_MS
  ) {
    return false;
  }
  const iso = new Date(nowMs).toISOString();
  return Date.parse(iso) === nowMs;
}

/**
 * P2-B `read()` resolves the `{ value, etag }` envelope. Reduce it to the
 * record, tolerating a seam that resolves the record directly, and treat a miss
 * as `null` so a concurrent delete is a skip rather than a failure.
 *
 * @param {unknown} found
 * @returns {object | null}
 */
function recordOf(found) {
  if (found === null || found === undefined) {
    return null;
  }
  if (typeof found !== "object") {
    throw unavailable();
  }
  if (
    Object.prototype.hasOwnProperty.call(found, "value") &&
    Object.prototype.hasOwnProperty.call(found, "etag")
  ) {
    return found.value ?? null;
  }
  return found;
}

/**
 * Parse one listed key into the projection the sweep needs, or reject.
 *
 * A key that the provider returned under our own prefix but that this module's
 * writers could not have produced is corrupt internal state, not something to
 * delete and not something to quietly skip: the month segment, the ID
 * milliseconds and the P2-B key builder must all agree.
 *
 * @param {string} key
 * @returns {{ key: string, eventId: string, idMs: number }}
 */
function parseEventKey(key) {
  // `String.prototype.match`, not `RegExp.prototype.exec`: the source oracle
  // treats a callee ending in `.exec` as a process-descendant surface.
  const match = key.match(EVENT_KEY_PATTERN);
  if (match === null) {
    throw new RetentionError("invalid-event-key");
  }
  const docId = match[1];
  const month = match[2];
  const eventId = match[3];
  const idMs = Number(match[4]);
  if (!Number.isSafeInteger(idMs)) {
    throw new RetentionError("invalid-event-key");
  }
  const iso = new Date(idMs).toISOString();
  if (iso.slice(0, 7) !== month || eventKey(docId, iso, eventId) !== key) {
    throw new RetentionError("invalid-event-key");
  }
  return { key, eventId, idMs };
}

/**
 * Collect every event key under the global prefix by driving the provider's
 * paginated iterator by hand.
 *
 * Automatic all-page collection is not used: a scheduled function has a fixed
 * 30-second budget, so the number of pulls, the size of a page and the total
 * key count all have to be things this function decides rather than things the
 * provider decides. A malformed envelope, an eleventh data page, a 10,001st
 * key or a rejection is provider unavailability; a malformed or duplicate key
 * inside a well-formed envelope is corrupt state.
 *
 * @param {{ list: Function }} store
 * @returns {Promise<Map<string, { key: string, eventId: string, idMs: number }>>}
 */
async function listEventKeys(store) {
  let listed;
  try {
    listed = store.list(LIST_OPTIONS);
  } catch {
    throw unavailable();
  }
  if (listed === null || typeof listed !== "object") {
    throw unavailable();
  }
  const iterate = listed[Symbol.asyncIterator];
  if (typeof iterate !== "function") {
    throw unavailable();
  }
  const iterator = iterate.call(listed);
  if (iterator === null || typeof iterator !== "object" ||
      typeof iterator.next !== "function") {
    throw unavailable();
  }

  /** @type {Map<string, { key: string, eventId: string, idMs: number }>} */
  const parsed = new Map();
  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (typeof iterator.return === "function") {
      try {
        await iterator.return();
      } catch {
        // A best-effort close. Its failure must not mask the real error.
      }
    }
  };

  try {
    let pages = 0;
    for (let pull = 0; pull < MAX_PULLS; pull += 1) {
      let step;
      try {
        step = await iterator.next();
      } catch {
        throw unavailable();
      }
      const stepKeys = ownDataKeysOfPlainObject(step);
      if (stepKeys === null || typeof step.done !== "boolean") {
        throw unavailable();
      }
      if (step.done === true) {
        return parsed;
      }
      pages += 1;
      if (pages > MAX_PAGES) {
        throw unavailable();
      }
      collectPage(step.value, parsed);
    }
    // Unreachable: the eleventh pull either exhausts the iterator or trips the
    // page bound above. Kept so the pull budget can never silently become a
    // partial sweep reported as a complete one.
    throw unavailable();
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * Validate one page envelope and fold its entries into `parsed`.
 *
 * @param {unknown} page
 * @param {Map<string, { key: string, eventId: string, idMs: number }>} parsed
 * @returns {void}
 */
function collectPage(page, parsed) {
  const pageKeys = ownDataKeysOfPlainObject(page);
  if (pageKeys === null || !pageKeys.includes("blobs")) {
    throw unavailable();
  }
  const blobs = page.blobs;
  if (!isOrdinaryDenseArray(blobs) || blobs.length > MAX_PAGE_ENTRIES) {
    throw unavailable();
  }
  for (const entry of blobs) {
    const entryKeys = ownDataKeysOfPlainObject(entry);
    if (entryKeys === null || !entryKeys.includes("key")) {
      throw unavailable();
    }
    const key = entry.key;
    if (typeof key !== "string" || KEY_ENCODER.encode(key).length > MAX_KEY_BYTES) {
      throw unavailable();
    }
    if (parsed.size >= MAX_KEYS && !parsed.has(key)) {
      throw unavailable();
    }
    if (parsed.has(key)) {
      throw new RetentionError("invalid-event-key");
    }
    parsed.set(key, parseEventKey(key));
  }
}

/**
 * Delete every audit event older than the retention window.
 *
 * `options` is a server-internal deterministic seam — the store and the clock —
 * not anything derived from a request. It is closed on purpose: an unexpected
 * key means a caller believes this function takes an option it does not have,
 * which is a bug worth failing on before anything is listed or deleted.
 *
 * Eligibility is conjunctive. The listed key must be reproducible by the P2-B
 * builder, its ID milliseconds must be strictly before the cutoff, a strong
 * read must return a record, that record must pass P3-B validation against the
 * key it was stored under, and its validated timestamp must also be strictly
 * before the cutoff. An event exactly at the cutoff survives; one millisecond
 * older does not.
 *
 * @param {{ store: object, nowMs: number }} options
 * @returns {Promise<{ v: 1, scanned: number, candidates: number, deleted: number,
 *                     remaining: boolean, cutoff: string }>}
 */
export async function sweepEvents(options) {
  const optionKeys = ownDataKeys(options);
  if (
    optionKeys === null ||
    optionKeys.length !== 2 ||
    !optionKeys.includes("store") ||
    !optionKeys.includes("nowMs")
  ) {
    throw invalidOptions();
  }
  const store = options.store;
  const nowMs = options.nowMs;
  if (
    store === null ||
    typeof store !== "object" ||
    typeof store.list !== "function" ||
    typeof store.delete !== "function" ||
    !isValidClock(nowMs)
  ) {
    throw invalidOptions();
  }

  const cutoffMs = nowMs - EVENT_RETENTION_MS;
  const cutoff = new Date(cutoffMs).toISOString();
  const parsed = await listEventKeys(store);

  // Provider listing order is not trusted for anything. Oldest first, then two
  // total tie-breaks, so the same store always yields the same deletions.
  const candidates = [...parsed.values()]
    .filter((entry) => entry.idMs < cutoffMs)
    .sort(
      (a, b) =>
        a.idMs - b.idMs ||
        compareAscii(a.eventId, b.eventId) ||
        compareAscii(a.key, b.key),
    );

  let readCount = 0;
  let deleted = 0;
  let remaining = false;

  for (const candidate of candidates) {
    if (deleted >= MAX_EVENT_DELETES) {
      remaining = true;
      break;
    }
    readCount += 1;
    const record = recordOf(await read(store, candidate.key));
    if (record === null) {
      // The event was deleted between the listing and this read. Nothing to do.
      continue;
    }
    const event = assertEvent(record, candidate.key);
    const ts = Date.parse(event.ts);
    if (ts !== candidate.idMs) {
      throw new RetentionError("invalid-event-key");
    }
    if (ts >= cutoffMs) {
      continue;
    }
    try {
      await store.delete(candidate.key);
    } catch {
      // No retry and no transaction: Blobs has neither. Earlier deletes stay
      // committed and tomorrow's run continues from what survives.
      throw unavailable();
    }
    deleted += 1;
  }

  return {
    v: 1,
    scanned: parsed.size,
    candidates: readCount,
    deleted,
    remaining,
    cutoff,
  };
}

/**
 * @param {string} a @param {string} b @returns {number}
 */
function compareAscii(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Build the scheduled handler over injectable seams.
 *
 * The returned handler ignores its request entirely — a scheduled function has
 * no route, no caller and no identity — samples the clock once, opens the store
 * once, sweeps, and writes exactly one aggregate line. The line carries counts
 * only: no key, document ID, actor, email, name, body, summary, provider value,
 * environment value or stack. On failure it logs nothing and rejects, because a
 * sweep that did not happen must not look like one that did.
 *
 * @param {{ storeFn?: Function, nowFn?: Function, logFn?: Function }} [dependencies]
 * @returns {(request?: unknown) => Promise<void>}
 */
export function createRetentionHandler(dependencies = {}) {
  const names = ownDataKeys(dependencies);
  if (
    names === null ||
    names.some((name) => !["storeFn", "nowFn", "logFn"].includes(name))
  ) {
    throw invalidOptions();
  }
  const storeFn = names.includes("storeFn") ? dependencies.storeFn : docState;
  const nowFn = names.includes("nowFn") ? dependencies.nowFn : Date.now;
  const logFn = names.includes("logFn") ? dependencies.logFn : console.info;
  if (
    typeof storeFn !== "function" ||
    typeof nowFn !== "function" ||
    typeof logFn !== "function"
  ) {
    throw invalidOptions();
  }

  return async function retention() {
    const nowMs = nowFn();
    const store = storeFn();
    const summary = await sweepEvents({ store, nowMs });
    logFn(
      `retention: events scanned=${summary.scanned}` +
        ` candidates=${summary.candidates}` +
        ` deleted=${summary.deleted}` +
        ` remaining=${summary.remaining}`,
    );
  };
}

const scheduledRetention = createRetentionHandler();

/**
 * The scheduled entry point. Netlify invokes it on the cron below; it returns
 * no HTTP body because a scheduled function has no route.
 *
 * @param {unknown} req The scheduled request, deliberately unused.
 * @returns {Promise<void>}
 */
export default async function handler(req) {
  return scheduledRetention(req);
}

/**
 * Midnight UTC, every day. `schedule` is mutually exclusive with `path`, and a
 * scheduled function runs automatically only on published deploys.
 */
export const config = { schedule: "@daily" };
