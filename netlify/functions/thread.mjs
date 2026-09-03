import { identify, requireOrigin } from "../lib/identity.mjs";
import {
  StoreError,
  assertDocId,
  docState,
  mutate,
  threadKey,
  upgrade,
} from "../lib/store.mjs";

/**
 * P3-A — `/api/threads/:doc/:id`: append one reply (`POST`) or resolve and
 * reopen a thread (`PATCH`) through P2-B's six-attempt compare-and-swap.
 *
 * Every actor is projected from the verified server identity. This file
 * requires authentication only; mutation-role enforcement and the P3-B audit
 * appends are added by P4-M, which is the only ticket allowed to import the
 * access library here. `threads.mjs` duplicates the private validators below
 * on purpose: the ticket forbids a shared third helper file.
 */

const MAX_REQUEST_BYTES = 65_536;
const MAX_COMMENTS = 500;
const MAX_BODY_UNITS = 8_000;
const MAX_TITLE_UNITS = 200;
const MAX_NAME_UNITS = 200;
const MAX_EXACT_UNITS = 1_000;
const MAX_AFFIX_UNITS = 32;
const MAX_EMAIL_UNITS = 254;
const MAX_EMAIL_LOCAL_UNITS = 64;

const DOC_ID_PATTERN = /^[0-9a-f]{6}$/;
const THREAD_ID_PATTERN = /^t_[a-z0-9]{1,48}_[0-9a-f]{8}$/;
const COMMENT_ID_PATTERN = /^c_[a-z0-9]{1,48}_[0-9a-f]{8}$/;
const SECTION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const DOC_VERSION_PATTERN = /^[0-9a-f]{7}$/;
const ANCHOR_BLOCK_PATTERN = /^a[0-9a-f]{8}$/;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const EMAIL_LOCAL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPERATION_MS_PATTERN = /^[0-9]{13}$/;
const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const NON_SPACE_WHITESPACE_PATTERN = /[^\S ]/;
const MEDIA_TYPE_PATTERN =
  /^[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)[ \t]*(?:;[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[^"\\\x00-\x1f\x7f]|\\[\x00-\x7f])*")[ \t]*)*$/;

const THREAD_KEYS = Object.freeze([
  "v",
  "id",
  "docId",
  "kind",
  "status",
  "section",
  "anchor",
  "title",
  "docVersion",
  "createdAt",
  "author",
  "resolvedAt",
  "resolvedBy",
  "comments",
]);
const COMMENT_KEYS = Object.freeze(["id", "body", "author", "createdAt", "editedAt"]);
const ACTOR_KEYS = Object.freeze(["sub", "name", "email"]);
const ANCHOR_KEYS = Object.freeze(["block", "exact", "prefix", "suffix", "start"]);
const REPLY_KEYS = Object.freeze(["body", "author", "email", "name"]);
const STATUS_KEYS = Object.freeze(["status", "author", "email", "name"]);

const NO_STORE = "private, no-store";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** The complete public error table: code -> [status, message]. */
const PUBLIC_ERRORS = Object.freeze({
  "method-not-allowed": [405, "Method not allowed"],
  unauthenticated: [401, "Authentication required"],
  forbidden: [403, "Document access denied"],
  "invalid-request": [400, "Invalid request"],
  "unsupported-media-type": [415, "Content-Type must be application/json"],
  "payload-too-large": [413, "Request body exceeds 65536 bytes"],
  "invalid-body": [400, "Invalid request body"],
  "not-found": [404, "Thread not found"],
  conflict: [409, "Concurrent update limit reached"],
  "id-collision": [409, "Generated identifier collision"],
  "comment-limit": [409, "Thread comment limit reached"],
  "invalid-state": [500, "Invalid thread state"],
  unavailable: [503, "Thread store unavailable"],
});

/** Private domain sentinel carrying one public error code. Never serialized.
 * It is also the only value thrown from inside the CAS callback. */
class EndpointError extends Error {
  constructor(code) {
    super(code);
    this.name = "EndpointError";
    this.code = code;
  }
}

function fail(code) {
  return new EndpointError(code);
}

function jsonResponse(status, body, extraHeaders) {
  const headers = {
    "Cache-Control": NO_STORE,
    "Content-Type": JSON_CONTENT_TYPE,
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(code, extraHeaders) {
  const [status, message] = PUBLIC_ERRORS[code];
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}

function classify(error) {
  if (error instanceof EndpointError) {
    return error.code;
  }
  if (error instanceof StoreError) {
    if (error.code === "conflict") {
      return "conflict";
    }
    if (error.code === "unavailable") {
      return "unavailable";
    }
  }
  return "invalid-state";
}

// ---------------------------------------------------------------------------
// Descriptor-safe object inspection. None of these helpers invoke a getter.
// ---------------------------------------------------------------------------

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** A non-null, non-array object whose prototype is exactly Object.prototype
 * and which carries no symbol-keyed own properties. */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

/** Returns `{ value }` when `key` is an own enumerable data property of
 * `object`, or `null` otherwise, without invoking any accessor. */
function ownData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (
    descriptor === undefined ||
    !hasOwn(descriptor, "value") ||
    descriptor.enumerable !== true
  ) {
    return null;
  }
  return { value: descriptor.value };
}

/** Own enumerable data-property names of a plain object whose every own
 * property is such a property, or `null` when any accessor, non-enumerable,
 * or symbol-keyed property exists. */
function ownDataKeys(object) {
  if (!isPlainObject(object)) {
    return null;
  }
  const names = Object.getOwnPropertyNames(object);
  for (const name of names) {
    if (ownData(object, name) === null) {
      return null;
    }
  }
  return names;
}

function hasExactKeys(object, expected) {
  const names = ownDataKeys(object);
  if (names === null || names.length !== expected.length) {
    return false;
  }
  return expected.every((key) => names.includes(key));
}

/** A dense array with only index keys plus `length`, every element an own
 * enumerable data property, and no symbol keys. */
function isDenseArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (ownData(value, String(index)) === null) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Scalar grammar.
// ---------------------------------------------------------------------------

function isTimestamp(value) {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    new Date(value).toISOString() === value
  );
}

function isSubject(value) {
  return typeof value === "string" && SUBJECT_PATTERN.test(value);
}

function isActorName(value) {
  return typeof value === "string" && value.length <= MAX_NAME_UNITS;
}

function isEmail(value) {
  if (typeof value !== "string") {
    return false;
  }
  if (value === "") {
    return true;
  }
  if (value.length > MAX_EMAIL_UNITS) {
    return false;
  }
  const at = value.indexOf("@");
  if (at === -1 || value.indexOf("@", at + 1) !== -1) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (
    local.length < 1 ||
    local.length > MAX_EMAIL_LOCAL_UNITS ||
    !EMAIL_LOCAL_PATTERN.test(local)
  ) {
    return false;
  }
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) => DNS_LABEL_PATTERN.test(label));
}

function isBodyText(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_BODY_UNITS &&
    value.trim().length > 0
  );
}

function isTitleText(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_TITLE_UNITS &&
    value.trim().length > 0
  );
}

function isNormalizedExact(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_EXACT_UNITS &&
    value === value.replace(/\s+/g, " ").trim()
  );
}

function isNormalizedAffix(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_AFFIX_UNITS &&
    !NON_SPACE_WHITESPACE_PATTERN.test(value) &&
    !value.includes("  ")
  );
}

function isOffset(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

// ---------------------------------------------------------------------------
// Persisted version-1 thread validation.
// ---------------------------------------------------------------------------

function isActor(value) {
  return (
    hasExactKeys(value, ACTOR_KEYS) &&
    isSubject(value.sub) &&
    isActorName(value.name) &&
    isEmail(value.email)
  );
}

function isAnchor(value) {
  return (
    hasExactKeys(value, ANCHOR_KEYS) &&
    typeof value.block === "string" &&
    ANCHOR_BLOCK_PATTERN.test(value.block) &&
    isNormalizedExact(value.exact) &&
    isNormalizedAffix(value.prefix) &&
    isNormalizedAffix(value.suffix) &&
    isOffset(value.start)
  );
}

function isComment(value) {
  return (
    hasExactKeys(value, COMMENT_KEYS) &&
    typeof value.id === "string" &&
    COMMENT_ID_PATTERN.test(value.id) &&
    isBodyText(value.body) &&
    isActor(value.author) &&
    isTimestamp(value.createdAt) &&
    (value.editedAt === null || isTimestamp(value.editedAt))
  );
}

function sameActor(left, right) {
  return (
    left.sub === right.sub && left.name === right.name && left.email === right.email
  );
}

/**
 * Fail-closed validation of one stored thread against the key it lives
 * under. Returns the same record or throws `invalid-state`. It is
 * synchronous and pure so the CAS callback can run it on every fresh draft.
 */
function validateThread(record, docId, threadId) {
  try {
    upgrade(record);
  } catch {
    throw fail("invalid-state");
  }
  if (!hasExactKeys(record, THREAD_KEYS)) {
    throw fail("invalid-state");
  }
  const valid =
    record.v === 1 &&
    record.id === threadId &&
    typeof threadId === "string" &&
    THREAD_ID_PATTERN.test(threadId) &&
    record.docId === docId &&
    typeof docId === "string" &&
    DOC_ID_PATTERN.test(docId) &&
    (record.kind === "comment" || record.kind === "discussion") &&
    (record.status === "open" || record.status === "resolved") &&
    typeof record.section === "string" &&
    SECTION_PATTERN.test(record.section) &&
    typeof record.docVersion === "string" &&
    DOC_VERSION_PATTERN.test(record.docVersion) &&
    isTimestamp(record.createdAt) &&
    isActor(record.author);
  if (!valid) {
    throw fail("invalid-state");
  }
  if (record.kind === "comment") {
    if (!isAnchor(record.anchor) || record.title !== null) {
      throw fail("invalid-state");
    }
  } else if (record.anchor !== null || !isTitleText(record.title)) {
    throw fail("invalid-state");
  }
  if (record.status === "open") {
    if (record.resolvedAt !== null || record.resolvedBy !== null) {
      throw fail("invalid-state");
    }
  } else if (!isTimestamp(record.resolvedAt) || !isActor(record.resolvedBy)) {
    throw fail("invalid-state");
  }
  const comments = record.comments;
  if (
    !isDenseArray(comments) ||
    comments.length < 1 ||
    comments.length > MAX_COMMENTS
  ) {
    throw fail("invalid-state");
  }
  const seen = new Set();
  for (const comment of comments) {
    if (!isComment(comment) || seen.has(comment.id)) {
      throw fail("invalid-state");
    }
    seen.add(comment.id);
  }
  const first = comments[0];
  if (!sameActor(first.author, record.author) || first.createdAt !== record.createdAt) {
    throw fail("invalid-state");
  }
  return record;
}

// ---------------------------------------------------------------------------
// Identity, actor projection, clock, and identifiers.
// ---------------------------------------------------------------------------

/** Validate the verified identity's three actor scalars and project them to a
 * fresh actor. Only `sub`, `name`, and `email` are ever read. */
function requireActor(identity) {
  if (identity === null) {
    throw fail("unauthenticated");
  }
  if (typeof identity !== "object" || Array.isArray(identity)) {
    throw fail("invalid-state");
  }
  const sub = identity.sub;
  const name = identity.name;
  const email = identity.email;
  if (!isSubject(sub) || !isActorName(name) || !isEmail(email)) {
    throw fail("invalid-state");
  }
  return { sub, name, email };
}

function copyActor(actor) {
  return { sub: actor.sub, name: actor.name, email: actor.email };
}

/** Sample the one operation clock value; an impossible result is a 500. */
function sampleOperationTime() {
  const operationMs = Date.now();
  if (typeof operationMs !== "number" || !OPERATION_MS_PATTERN.test(String(operationMs))) {
    throw fail("invalid-state");
  }
  const operationTime = new Date(operationMs).toISOString();
  if (!isTimestamp(operationTime)) {
    throw fail("invalid-state");
  }
  return { operationMs, operationTime };
}

function sampleIdentifier(prefix, operationMs) {
  const uuid = crypto.randomUUID();
  if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
    throw fail("invalid-state");
  }
  return `${prefix}_${operationMs.toString(36)}_${uuid.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Request parsing.
// ---------------------------------------------------------------------------

/** Exactly `context.params.doc` and `context.params.id` as own strings; the
 * single-thread route accepts no query parameters at all. */
function parsePath(req, context) {
  let url;
  try {
    url = new URL(req.url);
  } catch {
    throw fail("invalid-request");
  }
  if ([...url.searchParams].length !== 0) {
    throw fail("invalid-request");
  }
  if (context === null || typeof context !== "object") {
    throw fail("invalid-request");
  }
  const params = context.params;
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw fail("invalid-request");
  }
  const doc = ownData(params, "doc");
  const id = ownData(params, "id");
  if (
    doc === null ||
    typeof doc.value !== "string" ||
    !DOC_ID_PATTERN.test(doc.value) ||
    id === null ||
    typeof id.value !== "string" ||
    !THREAD_ID_PATTERN.test(id.value)
  ) {
    throw fail("invalid-request");
  }
  return { docId: assertDocId(doc.value), threadId: id.value };
}

function isJsonMediaType(header) {
  if (typeof header !== "string") {
    return false;
  }
  const match = header.match(MEDIA_TYPE_PATTERN);
  return match !== null && `${match[1]}/${match[2]}`.toLowerCase() === "application/json";
}

/** Stream at most 65,536 bytes through exactly one reader. */
async function readBoundedBytes(req) {
  const body = req.body;
  if (
    body === null ||
    body === undefined ||
    typeof body.getReader !== "function" ||
    body.locked === true
  ) {
    throw fail("invalid-body");
  }
  let reader;
  try {
    reader = body.getReader();
  } catch {
    throw fail("invalid-body");
  }
  const chunks = [];
  let total = 0;
  let failure = null;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done === true) {
        break;
      }
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array)) {
        failure = "invalid-body";
        break;
      }
      if (total + chunk.byteLength > MAX_REQUEST_BYTES) {
        failure = "payload-too-large";
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch {
    failure = "invalid-body";
  }
  if (failure !== null) {
    try {
      await reader.cancel();
    } catch {
      // A rejected cancellation is tolerated; the lock is still released once.
    }
  }
  try {
    reader.releaseLock();
  } catch {
    // The lock release is best effort and never repeated.
  }
  if (failure !== null) {
    throw fail(failure);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Media type, canonical Content-Length, bounded stream read, one fatal
 * UTF-8 decode, and one parse into a non-null, non-array ordinary object. */
async function readJsonObject(req) {
  if (!isJsonMediaType(req.headers.get("content-type"))) {
    throw fail("unsupported-media-type");
  }
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!CANONICAL_INTEGER_PATTERN.test(declared) || !Number.isSafeInteger(Number(declared))) {
      throw fail("invalid-body");
    }
    if (Number(declared) > MAX_REQUEST_BYTES) {
      throw fail("payload-too-large");
    }
  }
  const bytes = await readBoundedBytes(req);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw fail("invalid-body");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail("invalid-body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail("invalid-body");
  }
  return parsed;
}

/** The reply body is exactly `body`; the status body is exactly `status`.
 * The reserved `author`, `email`, and `name` keys are tolerated but never
 * read. */
function parseMutationBody(parsed, allowedKeys, field) {
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.includes(key)) {
      throw fail("invalid-body");
    }
  }
  if (!hasOwn(parsed, field)) {
    throw fail("invalid-body");
  }
  return parsed[field];
}

function parseReplyBody(parsed) {
  const body = parseMutationBody(parsed, REPLY_KEYS, "body");
  if (!isBodyText(body)) {
    throw fail("invalid-body");
  }
  return body;
}

function parseStatusBody(parsed) {
  const status = parseMutationBody(parsed, STATUS_KEYS, "status");
  if (status !== "resolved" && status !== "open") {
    throw fail("invalid-body");
  }
  return status;
}

// ---------------------------------------------------------------------------
// Pure CAS transformations. Each receives a fresh draft from P2-B, validates
// it, and returns one complete thread or `null` for a status no-op. Nothing
// here reads the request, clock, randomness, identity, or storage.
// ---------------------------------------------------------------------------

function replyTransformation(docId, threadId, comment) {
  return (draft) => {
    if (draft === null) {
      throw fail("not-found");
    }
    const current = validateThread(draft, docId, threadId);
    if (current.comments.length >= MAX_COMMENTS) {
      throw fail("comment-limit");
    }
    current.comments.push({
      id: comment.id,
      body: comment.body,
      author: copyActor(comment.author),
      createdAt: comment.createdAt,
      editedAt: null,
    });
    return validateThread(current, docId, threadId);
  };
}

function statusTransformation(docId, threadId, status, operationTime, actor) {
  return (draft) => {
    if (draft === null) {
      throw fail("not-found");
    }
    const current = validateThread(draft, docId, threadId);
    if (current.status === status) {
      return null;
    }
    if (status === "resolved") {
      current.status = "resolved";
      current.resolvedAt = operationTime;
      current.resolvedBy = copyActor(actor);
    } else {
      current.status = "open";
      current.resolvedAt = null;
      current.resolvedBy = null;
    }
    return current;
  };
}

// ---------------------------------------------------------------------------
// Operations.
// ---------------------------------------------------------------------------

function openStore() {
  try {
    return docState();
  } catch {
    throw fail("unavailable");
  }
}

async function mutateThread(req, context, method) {
  requireOrigin(req);
  const identity = await identify(req);
  const actor = requireActor(identity);
  const { docId, threadId } = parsePath(req, context);
  const parsed = await readJsonObject(req);

  let apply;
  if (method === "POST") {
    const body = parseReplyBody(parsed);
    const { operationMs, operationTime } = sampleOperationTime();
    const comment = {
      id: sampleIdentifier("c", operationMs),
      body,
      author: copyActor(actor),
      createdAt: operationTime,
    };
    apply = replyTransformation(docId, threadId, comment);
  } else {
    const status = parseStatusBody(parsed);
    const { operationTime } = sampleOperationTime();
    apply = statusTransformation(docId, threadId, status, operationTime, actor);
  }

  const key = threadKey(docId, threadId);
  const store = openStore();
  const committed = await mutate(store, key, null, apply);
  if (committed === null || typeof committed !== "object" || !hasOwn(committed, "value")) {
    throw fail("invalid-state");
  }
  return jsonResponse(200, { thread: committed.value });
}

/**
 * `POST /api/threads/:doc/:id` appends one reply; `PATCH` resolves or
 * reopens the thread.
 *
 * @param {Request} req
 * @param {object} context
 * @returns {Promise<Response>}
 */
export default async function handler(req, context) {
  try {
    if (req.method === "POST" || req.method === "PATCH") {
      return await mutateThread(req, context, req.method);
    }
    return errorResponse("method-not-allowed", { Allow: "POST, PATCH" });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return errorResponse(classify(error));
  }
}

export const config = { path: "/api/threads/:doc/:id" };
