import { identify, requireOrigin } from "../lib/identity.mjs";
import { capabilitiesFor, resolveRole } from "../lib/access.mjs";
import { StoreError, docState, editKey, mutate, read, upgrade } from "../lib/store.mjs";
import { scanBlocks } from "../../templates/docbuild/dist/anchor-core.js";
import { toHtml, toMd } from "../../templates/docbuild/dist/inline_md.js";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";

// POST /api/edit — the Mode B direct-edit write path (P4-B).
//
// One authorized reader replaces the inner HTML of one build-approved block.
// The request selects that block by permanent document ID and anchor ID and by
// nothing else: the deployed P2-D manifest is the only path authority, the
// committed anchors map plus the manifest's inner-HTML SHA-256 is the only
// write authority, and the reader's proven identity is the only author. The
// handler commits to a deterministic per-author branch, maintains at most one
// open pull request, and only then records a bounded P3-E pending receipt
// through the P2-B conditional write. It never merges, never force-updates a
// ref, and never guesses which block the caller meant.
//
// Amendment chain: P4-B (this initial apply path) -> P4-M (document-role
// `canSuggest` + `canEdit` replace the temporary `isOrg` gate) -> P4-N (Mode A,
// suggestions, and the `gitedit.mjs` extraction). P4-N must leave this access
// check in this module: `gitedit.mjs` is not an authorization oracle.

const NO_STORE = "private, no-store";
const JSON_TYPE = "application/json; charset=utf-8";
const API_ORIGIN = "https://api.github.com";

const DEPENDENCY_KEYS = Object.freeze([
  "requireOrigin", "identify",
  "docState", "editKey", "read", "mutate", "upgrade", "StoreError",
  "resolveRole", "capabilitiesFor",
  "scanBlocks", "toMd", "toHtml",
  "fetch", "now", "sha256Hex", "getEnv",
]);
const FUNCTION_KEYS = Object.freeze(DEPENDENCY_KEYS.filter((key) => key !== "StoreError"));

const ENV_NAMES = Object.freeze([
  "DOCS_REPO", "DOCS_BASE_BRANCH", "DOCS_GITHUB_TOKEN", "DOCS_BOT_EMAIL",
]);

const BODY_KEYS = Object.freeze(["docId", "aid", "text"]);
const IGNORED_BODY_KEYS = Object.freeze(["author", "email", "name"]);

const IDENTITY_KEYS = Object.freeze(["sub", "email", "name", "isOrg"]);
const ACCESS_KEYS = Object.freeze([
  "role", "shared", "canRead", "canComment", "threadControl",
  "canSuggest", "canEdit", "canAccept", "canShare", "canSeeMembers",
]);
const CAPABILITY_KEYS = Object.freeze(ACCESS_KEYS.slice(2));
const ROLES = Object.freeze(["owner", "editor", "commenter", "viewer", "none"]);
const THREAD_CONTROLS = Object.freeze(["any", "own", "none"]);
const MANIFEST_KEYS = Object.freeze(["docId", "instance", "commit", "blocks"]);
const ROW_KEYS = Object.freeze(["file", "section", "tag", "hash"]);
const ANCHOR_SECTION_KEYS = Object.freeze(["ids", "texts"]);
const ENVELOPE_KEYS = Object.freeze(["value", "etag"]);
const RESULT_KEYS = Object.freeze(["value", "etag", "changed"]);
const ACTOR_KEYS = Object.freeze(["sub", "name", "email"]);
const RECEIPT_KEYS = Object.freeze(["v", "aid", "text", "by", "at", "baseHash", "pr"]);
const DIRECT_KEYS = Object.freeze([...RECEIPT_KEYS, "via"]);
const SUGGESTION_KEYS = Object.freeze([...DIRECT_KEYS, "sugId", "acceptedBy", "acceptedAt"]);
const TAGS = Object.freeze(["p", "h2", "h3", "h4"]);
const SKIPPED_DIRECTORIES = new Set([".git", "_site", "node_modules", "netlify"]);

const DOC_ID_PATTERN = /^[0-9a-f]{6}$/;
const AID_PATTERN = /^a[0-9a-f]{8}$/;
const INSTANCE_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const FILE_PATTERN = /^sections\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const BLOB_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const EMAIL_LOCAL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_EDGE_WHITESPACE = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g;
const NON_ASCII_PATTERN = /[^\x00-\x7f]/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SUGGESTION_ID_PATTERN = /^s_[a-z0-9]{1,48}_[0-9a-f]{8}$/;
const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MEDIA_TYPE_PATTERN =
  /^[ \t]*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\/([!#$%&'*+.^_`|~0-9A-Za-z-]+)[ \t]*(?:;[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[^"\\\x00-\x1f\x7f]|\\[\x00-\x7f])*")[ \t]*)*$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const MAX_REQUEST_BYTES = 65_536;
const MAX_TEXT_UNITS = 4_000;
const MAX_NAME_UNITS = 200;
const MAX_EMAIL_UNITS = 254;
const MAX_RESPONSE_BYTES = 2_097_152;
const MAX_CONTENT_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 10_000;

const MAX_DEPTH = 12;
const MAX_ENTRIES = 4_096;
const MAX_CANDIDATES = 64;
const MAX_FILE_BYTES = 2_097_152;
const MAX_TOTAL_BYTES = 8_388_608;
const MAX_MANIFEST_BLOCKS = 5_000;
const MAX_TOTAL_BLOCKS = 10_000;
const READ_CHUNK = 65_536;

const BODY_MARKER = "<!-- body -->";
const COMMITTER_NAME = "Architecture Docs";
const PULL_BODY =
  "Edits proposed from the hosted document. Each commit changes one build-approved block.";

/** The complete public error table: code -> [status, message]. */
const PUBLIC_ERRORS = Object.freeze({
  "invalid-body": [400, "Invalid request body"],
  unauthenticated: [401, "Authentication required"],
  forbidden: [403, "Document edit denied"],
  "not-found": [404, "Document or block not found"],
  "method-not-allowed": [405, "Method not allowed"],
  conflict: [409, "The block changed since this document was built"],
  "payload-too-large": [413, "Request body exceeds 65536 bytes"],
  "unsupported-media-type": [415, "Content-Type must be application/json"],
  "invalid-state": [500, "Invalid edit state"],
  "repository-unavailable": [502, "Repository write unavailable"],
  unavailable: [503, "Edit state unavailable"],
});

/** A private control-flow error carrying only a public code and, for 409, the
 * one bounded `current` field. It never carries a cause, a provider body, a
 * path, a ref, a SHA, or an actor. */
class Failure extends Error {
  constructor(code, current = null) {
    super("edit");
    this.code = code;
    this.current = current;
  }
}

const fail = (code) => new Failure(code);
const conflict = (current) =>
  new Failure("conflict", typeof current === "string" ? current : null);

/** The private compare-and-swap sentinel thrown out of the `mutate()` callback
 * when a competing writer already holds a fresh receipt for this block. */
class ReceiptConflict extends Error {
  constructor(current) {
    super("receipt");
    this.current = current;
  }
}

function jsonResponse(status, body, extra = null) {
  const headers = { "Cache-Control": NO_STORE, "Content-Type": JSON_TYPE };
  if (extra !== null) Object.assign(headers, extra);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(failure) {
  const code = failure instanceof Failure ? failure.code : "invalid-state";
  const [status, message] = PUBLIC_ERRORS[code] ?? PUBLIC_ERRORS["invalid-state"];
  const body = { error: { code, message } };
  if (code === "conflict") body.current = failure.current;
  const extra = code === "method-not-allowed" ? { Allow: "POST" } : null;
  return jsonResponse(status, body, extra);
}

/* ------------------------------------------------------------- shape checks */

const rawCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function sameSet(actual, expected) {
  if (actual.length !== expected.length) return false;
  const sorted = [...actual].sort(rawCompare);
  const wanted = [...expected].sort(rawCompare);
  return wanted.every((key, index) => sorted[index] === key);
}

function isDataDescriptor(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined &&
    hasOwn(descriptor, "value") &&
    descriptor.enumerable === true;
}

/** Plain JSON-style object: `Object.prototype` or null prototype, no symbol
 * keys, every own property an enumerable data property. */
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.getOwnPropertyNames(value).every((key) => isDataDescriptor(value, key));
}

function isExactRecord(value, keys) {
  return isPlainRecord(value) && sameSet(Object.getOwnPropertyNames(value), keys);
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || names[names.length - 1] !== "length") return false;
  for (let index = 0; index < value.length; index += 1) {
    if (names[index] !== String(index) || !isDataDescriptor(value, String(index))) return false;
  }
  return true;
}

function isTimestamp(value) {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

/** P2-G's canonical mailbox grammar. It is duplicated here on purpose: the
 * ticket forbids importing a second identity or access helper into this
 * module, and the value must already be normalized rather than normalized
 * here. */
function isNormalizedEmail(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_EMAIL_UNITS) {
    return false;
  }
  if (value.replace(EMAIL_EDGE_WHITESPACE, "") !== value) return false;
  if (NON_ASCII_PATTERN.test(value)) return false;
  if (value.toLowerCase() !== value) return false;
  const at = value.indexOf("@");
  if (at === -1 || value.indexOf("@", at + 1) !== -1) return false;
  if (!EMAIL_LOCAL_PATTERN.test(value.slice(0, at))) return false;
  const labels = value.slice(at + 1).split(".");
  return labels.length >= 2 && labels.every((label) => DNS_LABEL_PATTERN.test(label));
}

/* ------------------------------------------------------------- dependencies */

function captureDependencies(dependencies) {
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies) ||
      Object.getPrototypeOf(dependencies) !== Object.prototype ||
      Object.getOwnPropertySymbols(dependencies).length !== 0 ||
      !sameSet(Object.getOwnPropertyNames(dependencies), DEPENDENCY_KEYS) ||
      !DEPENDENCY_KEYS.every((key) => isDataDescriptor(dependencies, key))) {
    throw new TypeError("Invalid edit dependencies");
  }
  const captured = {};
  for (const key of FUNCTION_KEYS) {
    const value = dependencies[key];
    if (typeof value !== "function") throw new TypeError("Invalid edit dependencies");
    captured[key] = value;
  }
  if (dependencies.StoreError !== StoreError) throw new TypeError("Invalid edit dependencies");
  captured.StoreError = StoreError;
  return Object.freeze(captured);
}

/** Storage faults carry a stable code: `unavailable` is the 503 edit-state
 * failure, and every other classified fault is an invalid state. */
function storeStatusCode(deps, error) {
  if (error instanceof deps.StoreError) {
    return error.code === "unavailable" ? "unavailable" : "invalid-state";
  }
  return "unavailable";
}

/* ---------------------------------------------------------------- identity */

/** The exact P2-H Mode B identity. A missing or non-canonical email is fatal
 * because the Git commit must retain this reader as its author; it is never
 * replaced with a request or bot address. */
function requireIdentity(user) {
  if (!isExactRecord(user, IDENTITY_KEYS)) throw fail("invalid-state");
  const { sub, email, name, isOrg } = user;
  if (typeof sub !== "string" || !SUBJECT_PATTERN.test(sub)) throw fail("invalid-state");
  if (typeof name !== "string" || name.length > MAX_NAME_UNITS) throw fail("invalid-state");
  if (!isNormalizedEmail(email)) throw fail("invalid-state");
  if (typeof isOrg !== "boolean") throw fail("invalid-state");
  return user;
}

/* ------------------------------------------------------------- request body */

function isJsonMediaType(header) {
  if (typeof header !== "string") return false;
  const match = header.match(MEDIA_TYPE_PATTERN);
  return match !== null && `${match[1]}/${match[2]}`.toLowerCase() === "application/json";
}

/** Stream at most 65,536 bytes through exactly one reader, then cancel and
 * release it exactly once. */
async function readBoundedBody(req) {
  const body = req.body;
  if (body === null || body === undefined || typeof body.getReader !== "function" ||
      body.locked === true) {
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
      if (result.done === true) break;
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
  if (failure !== null) throw fail(failure);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Media type, canonical Content-Length, bounded stream, one fatal UTF-8
 * decode, and exactly one JSON parse into an ordinary object. */
async function readJsonObject(req) {
  if (!isJsonMediaType(req.headers.get("content-type"))) throw fail("unsupported-media-type");
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!CANONICAL_INTEGER_PATTERN.test(declared) || !Number.isSafeInteger(Number(declared))) {
      throw fail("invalid-body");
    }
    if (Number(declared) > MAX_REQUEST_BYTES) throw fail("payload-too-large");
  }
  const bytes = await readBoundedBody(req);
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

/** The round-trip admission gate: text is editable only when both P2-D twins
 * reproduce it exactly. The original text is stored, never a normalised copy. */
function isEditableText(deps, value) {
  if (typeof value !== "string" || value.length > MAX_TEXT_UNITS) return false;
  try {
    const html = deps.toHtml(value);
    if (typeof html !== "string" || deps.toMd(html) !== value) return false;
    return deps.toHtml(deps.toMd(html)) === html;
  } catch {
    return false;
  }
}

/** The exact request grammar. The reserved `author`, `email`, and `name` keys
 * are tolerated but never read: the server identity is the only author. */
function parseEditBody(deps, parsed) {
  for (const key of Object.getOwnPropertyNames(parsed)) {
    if (!BODY_KEYS.includes(key) && !IGNORED_BODY_KEYS.includes(key)) throw fail("invalid-body");
  }
  for (const key of BODY_KEYS) {
    if (!hasOwn(parsed, key)) throw fail("invalid-body");
  }
  const { docId, aid, text } = parsed;
  if (typeof docId !== "string" || !DOC_ID_PATTERN.test(docId)) throw fail("invalid-body");
  if (typeof aid !== "string" || !AID_PATTERN.test(aid)) throw fail("invalid-body");
  if (!isEditableText(deps, text)) throw fail("invalid-body");
  return { docId, aid, text };
}

/* ---------------------------------------------------- the manifest inventory */

function joinPath(directory, name) {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

function walk(directory, segments, depth, counters, candidates) {
  let rows;
  try {
    rows = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw fail("unavailable");
  }
  counters.entries += rows.length;
  if (counters.entries > MAX_ENTRIES) throw fail("unavailable");
  const sorted = [...rows].sort((a, b) => rawCompare(a.name, b.name));
  for (const row of sorted) {
    const name = row.name;
    if (typeof name !== "string") throw fail("unavailable");
    const path = joinPath(directory, name);
    if (row.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      if (depth + 1 > MAX_DEPTH) throw fail("unavailable");
      walk(path, [...segments, name], depth + 1, counters, candidates);
      continue;
    }
    const length = segments.length;
    if (length >= 2 && segments[length - 1] === "dist" &&
        name === `${segments[length - 2]}.edit.json`) {
      counters.candidates += 1;
      if (counters.candidates > MAX_CANDIDATES) throw fail("unavailable");
      candidates.push({
        path,
        relative: [...segments, name].join("/"),
        instance: segments[length - 2],
      });
    }
  }
}

function readCandidate(path, counters) {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    throw fail("unavailable");
  }
  if (info.isSymbolicLink() || !info.isFile()) throw fail("invalid-state");
  const remaining = MAX_TOTAL_BYTES - counters.bytes;
  if (info.size > MAX_FILE_BYTES || info.size > remaining) throw fail("unavailable");
  if (typeof constants.O_RDONLY !== "number" || typeof constants.O_NOFOLLOW !== "number") {
    throw fail("unavailable");
  }
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw fail("unavailable");
  }
  try {
    let before;
    try {
      before = fstatSync(fd);
    } catch {
      throw fail("unavailable");
    }
    if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino) {
      throw fail("unavailable");
    }
    if (before.size > MAX_FILE_BYTES || before.size > remaining) throw fail("unavailable");
    const capacity = before.size + 1;
    const buffer = Buffer.alloc(capacity);
    let total = 0;
    while (total < capacity) {
      let count;
      try {
        count = readSync(fd, buffer, total, Math.min(READ_CHUNK, capacity - total), total);
      } catch {
        throw fail("unavailable");
      }
      if (count === 0) break;
      total += count;
    }
    if (total !== before.size) throw fail("unavailable");
    let after;
    try {
      after = fstatSync(fd);
    } catch {
      throw fail("unavailable");
    }
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw fail("unavailable");
    }
    counters.bytes += total;
    return buffer.subarray(0, total);
  } finally {
    try {
      closeSync(fd);
    } catch {
      throw fail("unavailable");
    }
  }
}

function parseManifest(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw fail("invalid-state");
  }
}

function validateManifest(value, instance, counters) {
  if (!isExactRecord(value, MANIFEST_KEYS)) throw fail("invalid-state");
  const { docId, commit, blocks } = value;
  if (typeof docId !== "string" || !DOC_ID_PATTERN.test(docId)) throw fail("invalid-state");
  if (typeof value.instance !== "string" || !INSTANCE_PATTERN.test(value.instance) ||
      value.instance !== instance) {
    throw fail("invalid-state");
  }
  if (typeof commit !== "string") throw fail("invalid-state");
  if (!isPlainRecord(blocks)) throw fail("invalid-state");
  const rows = new Map();
  let count = 0;
  for (const aid of Object.getOwnPropertyNames(blocks)) {
    count += 1;
    counters.blocks += 1;
    if (count > MAX_MANIFEST_BLOCKS || counters.blocks > MAX_TOTAL_BLOCKS) {
      throw fail("unavailable");
    }
    if (!AID_PATTERN.test(aid)) throw fail("invalid-state");
    const row = blocks[aid];
    if (!isExactRecord(row, ROW_KEYS)) throw fail("invalid-state");
    if (typeof row.file !== "string" || !FILE_PATTERN.test(row.file) ||
        typeof row.section !== "string" || row.section.length === 0 ||
        !TAGS.includes(row.tag) ||
        typeof row.hash !== "string" || !HASH_PATTERN.test(row.hash)) {
      throw fail("invalid-state");
    }
    rows.set(aid, Object.freeze({
      file: row.file, section: row.section, tag: row.tag, hash: row.hash,
    }));
  }
  return Object.freeze({ docId, instance, rows });
}

/** The inventory root itself gets the same treatment as every file under it:
 * a symlinked or non-directory root is refused rather than traversed. */
function validateRoot(root) {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
    throw fail("invalid-state");
  }
  let normalized = root;
  while (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  let info;
  try {
    info = lstatSync(normalized);
  } catch {
    throw fail("unavailable");
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw fail("invalid-state");
  return normalized;
}

function buildIndex(root) {
  const counters = { entries: 0, candidates: 0, bytes: 0, blocks: 0 };
  const candidates = [];
  walk(validateRoot(root), [], 0, counters, candidates);
  if (candidates.length === 0) throw fail("unavailable");
  candidates.sort((a, b) => rawCompare(a.relative, b.relative));
  const index = new Map();
  const seenPaths = new Set();
  for (const candidate of candidates) {
    if (seenPaths.has(candidate.relative)) throw fail("invalid-state");
    seenPaths.add(candidate.relative);
    const bytes = readCandidate(candidate.path, counters);
    const manifest = validateManifest(parseManifest(bytes), candidate.instance, counters);
    if (index.has(manifest.docId)) throw fail("invalid-state");
    index.set(manifest.docId, manifest);
  }
  return index;
}

/* ------------------------------------------------------------ configuration */

/** Read and validate the four Functions-only environment values. An invalid or
 * missing value is an invalid state decided before any external request. */
function readConfiguration(deps) {
  let repo;
  let branch;
  let token;
  let botEmail;
  try {
    repo = deps.getEnv(ENV_NAMES[0]);
    branch = deps.getEnv(ENV_NAMES[1]);
    token = deps.getEnv(ENV_NAMES[2]);
    botEmail = deps.getEnv(ENV_NAMES[3]);
  } catch {
    throw fail("invalid-state");
  }
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) throw fail("invalid-state");
  const base = branch === undefined ? "main" : branch;
  if (typeof base !== "string" || !BRANCH_PATTERN.test(base) ||
      base.includes("..") || base.includes("//") || base.includes("@{") ||
      base.endsWith(".") || base.startsWith("/") || base.endsWith("/")) {
    throw fail("invalid-state");
  }
  if (typeof token !== "string" || token.length === 0) throw fail("invalid-state");
  if (!isNormalizedEmail(botEmail)) throw fail("invalid-state");
  return Object.freeze({
    repo,
    owner: repo.slice(0, repo.indexOf("/")),
    base,
    token,
    botEmail,
  });
}

/* --------------------------------------------------------- GitHub transport */

const encodeSegments = (path) =>
  path.split("/").map((segment) => encodeURIComponent(segment)).join("/");

/** Read at most two MiB from a provider response through exactly one reader. */
async function readBoundedResponse(response) {
  const body = response.body;
  if (body === null || body === undefined) {
    if (typeof response.arrayBuffer !== "function") throw fail("repository-unavailable");
    let buffer;
    try {
      buffer = await response.arrayBuffer();
    } catch {
      throw fail("repository-unavailable");
    }
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw fail("repository-unavailable");
    return new Uint8Array(buffer);
  }
  if (typeof body.getReader !== "function" || body.locked === true) {
    throw fail("repository-unavailable");
  }
  let reader;
  try {
    reader = body.getReader();
  } catch {
    throw fail("repository-unavailable");
  }
  const chunks = [];
  let total = 0;
  let broken = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done === true) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array) || total + chunk.byteLength > MAX_RESPONSE_BYTES) {
        broken = true;
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch {
    broken = true;
  }
  if (broken) {
    try {
      await reader.cancel();
    } catch {
      // A rejected cancellation is tolerated.
    }
  }
  try {
    reader.releaseLock();
  } catch {
    // Best effort, never repeated.
  }
  if (broken) throw fail("repository-unavailable");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** One bounded GitHub REST call: ten seconds, no redirect, at most two MiB of
 * response, and one fatal UTF-8 decode before a single JSON parse. Returns
 * `{status, body}`; an empty or non-JSON payload has a `null` body. */
async function callGitHub(deps, config, method, path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "User-Agent": "architecture-docs-edit",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const init = { method, headers, redirect: "error", signal: controller.signal };
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    let response;
    try {
      response = await deps.fetch(`${API_ORIGIN}${path}`, init);
    } catch {
      throw fail("repository-unavailable");
    }
    if (response === null || typeof response !== "object" ||
        !Number.isSafeInteger(response.status)) {
      throw fail("repository-unavailable");
    }
    const bytes = await readBoundedResponse(response);
    if (bytes.byteLength === 0) return { status: response.status, body: null };
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw fail("repository-unavailable");
    }
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: null };
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- the branch */

/** `docedit/<docId>/<first 16 lowercase hex of SHA-256(sub)>`: deterministic
 * per author and document, and it exposes neither the email nor the raw
 * subject. */
function branchFor(deps, docId, sub) {
  let digest;
  try {
    digest = deps.sha256Hex(sub);
  } catch {
    throw fail("invalid-state");
  }
  if (typeof digest !== "string" || !HASH_PATTERN.test(digest)) throw fail("invalid-state");
  return `docedit/${docId}/${digest.slice(0, 16)}`;
}

function refObjectSha(body) {
  if (!isPlainRecord(body)) return null;
  const object = body.object;
  if (!isPlainRecord(object)) return null;
  const sha = object.sha;
  return typeof sha === "string" && BLOB_SHA_PATTERN.test(sha) ? sha : null;
}

async function readRef(deps, config, ref) {
  const result = await callGitHub(
    deps, config, "GET", `/repos/${config.repo}/git/ref/${encodeSegments(ref)}`,
  );
  if (result.status === 404) return null;
  if (result.status !== 200) throw fail("repository-unavailable");
  const sha = refObjectSha(result.body);
  if (sha === null) throw fail("repository-unavailable");
  return sha;
}

/** Read the author branch, creating it from the configured base when absent. A
 * concurrent create returning 422 is accepted only after a fresh read proves
 * the exact ref now exists. The ref is never force-updated and never deleted. */
async function resolveBranch(deps, config, branch) {
  const existing = await readRef(deps, config, `heads/${branch}`);
  if (existing !== null) return existing;
  const baseSha = await readRef(deps, config, `heads/${config.base}`);
  if (baseSha === null) throw fail("repository-unavailable");
  const created = await callGitHub(deps, config, "POST", `/repos/${config.repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });
  if (created.status === 201) {
    const sha = refObjectSha(created.body);
    if (sha === null) throw fail("repository-unavailable");
    return sha;
  }
  if (created.status === 422) {
    const raced = await readRef(deps, config, `heads/${branch}`);
    if (raced === null) throw fail("repository-unavailable");
    return raced;
  }
  throw fail("repository-unavailable");
}

/* ----------------------------------------------------------- file contents */

function decodeBase64Content(value) {
  if (typeof value !== "string") throw fail("repository-unavailable");
  const packed = value.split("\n").join("");
  if (packed.length % 4 !== 0 || !BASE64_PATTERN.test(packed)) {
    throw fail("repository-unavailable");
  }
  const bytes = Buffer.from(packed, "base64");
  if (bytes.toString("base64") !== packed) throw fail("repository-unavailable");
  if (bytes.byteLength > MAX_CONTENT_BYTES) throw fail("repository-unavailable");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw fail("repository-unavailable");
  }
}

/** Read one repository file at the author branch. A missing file, a directory,
 * a submodule, an unexpected encoding, or a non-canonical blob SHA is a
 * repository fault, never a guess. */
async function readFile(deps, config, branch, path) {
  const result = await callGitHub(
    deps, config, "GET",
    `/repos/${config.repo}/contents/${encodeSegments(path)}?ref=${encodeURIComponent(branch)}`,
  );
  if (result.status !== 200) throw fail("repository-unavailable");
  const body = result.body;
  if (!isPlainRecord(body)) throw fail("repository-unavailable");
  if (body.type !== "file" || body.encoding !== "base64") throw fail("repository-unavailable");
  const sha = body.sha;
  if (typeof sha !== "string" || !BLOB_SHA_PATTERN.test(sha)) {
    throw fail("repository-unavailable");
  }
  return { sha, text: decodeBase64Content(body.content) };
}

/* --------------------------------------------------------------- the locator */

/** P1-D's exact per-section `{ids, texts}` schema. Every section is validated,
 * not only the one this request selects, so a corrupt map is a repository
 * fault rather than a silently narrower search. */
function anchorSectionIds(text, section) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw fail("repository-unavailable");
  }
  if (!isPlainRecord(parsed)) throw fail("repository-unavailable");
  for (const name of Object.getOwnPropertyNames(parsed)) {
    const value = parsed[name];
    if (!isExactRecord(value, ANCHOR_SECTION_KEYS)) throw fail("repository-unavailable");
    const { ids, texts } = value;
    if (!isDenseArray(ids) || !isDenseArray(texts) || ids.length !== texts.length) {
      throw fail("repository-unavailable");
    }
    for (const id of ids) {
      if (typeof id !== "string" || !AID_PATTERN.test(id)) throw fail("repository-unavailable");
    }
    for (const entry of texts) {
      if (typeof entry !== "string") throw fail("repository-unavailable");
    }
  }
  if (!hasOwn(parsed, section)) throw conflict(null);
  return parsed[section].ids;
}

/** Split the source at its single exact body marker and scan only the bytes
 * after it, keeping every reported offset in whole-source coordinates.
 *
 * This is deliberately stricter than the builder's `parseSection()`, which
 * takes the first marker and tolerates a section with none. A section that
 * builds with zero or two markers is therefore buildable but not editable: the
 * scan offset would be a guess, and this path may not guess. */
function scanSourceBody(deps, source) {
  const at = source.indexOf(BODY_MARKER);
  if (at === -1 || source.indexOf(BODY_MARKER, at + BODY_MARKER.length) !== -1) {
    throw fail("repository-unavailable");
  }
  const start = at + BODY_MARKER.length;
  let blocks;
  try {
    blocks = deps.scanBlocks(source.slice(start));
  } catch {
    throw fail("repository-unavailable");
  }
  if (!Array.isArray(blocks)) throw fail("repository-unavailable");
  return { start, blocks };
}

/** The 409 `current` projection: the block's text only when it is safely
 * representable in the editable vocabulary, otherwise null. */
function representable(deps, inner) {
  let text;
  try {
    text = deps.toMd(inner);
  } catch {
    return null;
  }
  if (typeof text !== "string" || text.length > MAX_TEXT_UNITS) return null;
  try {
    if (deps.toHtml(text) !== inner) return null;
  } catch {
    return null;
  }
  return text;
}

/**
 * Join the committed anchors map to the scanned source and prove the selected
 * block is exactly the one the manifest hashed. The positional join is used
 * only after `anchors.json` names the aid; the inner hash is the sole write
 * authority. A stale index, a retagged block, or a changed hash refuses rather
 * than guesses, because the manifest carries no source offset.
 */
function locateBlock(deps, row, aid, anchorsText, source) {
  const ids = anchorSectionIds(anchorsText, row.section);
  let index = -1;
  for (let at = 0; at < ids.length; at += 1) {
    if (ids[at] !== aid) continue;
    if (index !== -1) throw fail("repository-unavailable");
    index = at;
  }
  if (index === -1) throw conflict(null);
  const { start, blocks } = scanSourceBody(deps, source);
  const block = blocks[index];
  if (block === undefined) throw conflict(null);
  if (block === null || typeof block !== "object") throw fail("repository-unavailable");
  const innerStart = start + block.innerStart;
  const innerEnd = start + block.innerEnd;
  if (!Number.isSafeInteger(innerStart) || !Number.isSafeInteger(innerEnd) ||
      innerStart < start || innerEnd < innerStart || innerEnd > source.length) {
    throw fail("repository-unavailable");
  }
  const inner = source.slice(innerStart, innerEnd);
  if (block.tag !== row.tag) throw conflict(representable(deps, inner));
  let hash;
  try {
    hash = deps.sha256Hex(inner);
  } catch {
    throw fail("invalid-state");
  }
  if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) throw fail("invalid-state");
  if (hash !== row.hash) throw conflict(representable(deps, inner));
  return { innerStart, innerEnd };
}

/* ------------------------------------------------------------- the receipt */

function validateActor(value) {
  if (!isExactRecord(value, ACTOR_KEYS)) return false;
  const { sub, name, email } = value;
  if (typeof sub !== "string" || !SUBJECT_PATTERN.test(sub)) return false;
  if (typeof name !== "string" || name.length > MAX_NAME_UNITS) return false;
  if (typeof email !== "string") return false;
  return email.length === 0 || isNormalizedEmail(email);
}

/** P3-E's receipt schema, in all three of its accepted shapes. */
function validateReceipt(value) {
  if (!isPlainRecord(value)) throw fail("invalid-state");
  const names = Object.getOwnPropertyNames(value);
  const via = hasOwn(value, "via") ? value.via : undefined;
  let keys;
  if (via === undefined) keys = RECEIPT_KEYS;
  else if (via === "edit") keys = DIRECT_KEYS;
  else if (via === "suggestion") keys = SUGGESTION_KEYS;
  else throw fail("invalid-state");
  if (!sameSet(names, keys)) throw fail("invalid-state");
  const { v, aid, text, by, at, baseHash, pr } = value;
  if (v !== 1 ||
      typeof aid !== "string" || !AID_PATTERN.test(aid) ||
      typeof text !== "string" || text.length > MAX_TEXT_UNITS ||
      !validateActor(by) ||
      !isTimestamp(at) ||
      typeof baseHash !== "string" || !HASH_PATTERN.test(baseHash) ||
      !(pr === null || (Number.isSafeInteger(pr) && pr > 0))) {
    throw fail("invalid-state");
  }
  if (via === "suggestion") {
    const { sugId, acceptedBy, acceptedAt } = value;
    if (typeof sugId !== "string" || !SUGGESTION_ID_PATTERN.test(sugId) ||
        !validateActor(acceptedBy) || !isTimestamp(acceptedAt)) {
      throw fail("invalid-state");
    }
  }
  return value;
}

/** Strongly read the one receipt slot before any external write. A fresh
 * receipt for this base is an overlay that already exists: report its exact
 * text instead of consulting an eventually listed source. */
async function readCurrentReceipt(deps, store, key, aid) {
  let found;
  try {
    found = await deps.read(store, key);
  } catch (error) {
    throw fail(storeStatusCode(deps, error));
  }
  if (!isExactRecord(found, ENVELOPE_KEYS)) throw fail("invalid-state");
  const { value, etag } = found;
  if (value === null) {
    if (etag !== null) throw fail("invalid-state");
    return null;
  }
  if (typeof etag !== "string" || etag.length === 0) throw fail("invalid-state");
  let record;
  try {
    record = deps.upgrade(value);
  } catch {
    throw fail("invalid-state");
  }
  const receipt = validateReceipt(record);
  if (receipt.aid !== aid) throw fail("invalid-state");
  return receipt;
}

/** Only text this handler would itself accept is safe to echo back as the
 * bounded 409 `current` field. */
function receiptText(deps, receipt) {
  return isEditableText(deps, receipt.text) ? receipt.text : null;
}

function sameReceipt(a, b) {
  return a.aid === b.aid && a.text === b.text && a.at === b.at && a.baseHash === b.baseHash &&
    a.pr === b.pr && a.via === b.via &&
    a.by.sub === b.by.sub && a.by.name === b.by.name && a.by.email === b.by.email;
}

/** P3-E's direct projection, in P3-E's exact key order. */
function projectReceipt(receipt) {
  return {
    text: receipt.text,
    by: { sub: receipt.by.sub, name: receipt.by.name, email: receipt.by.email },
    at: receipt.at,
    pr: receipt.pr,
    via: receipt.via,
  };
}

/* ---------------------------------------------------------- pull requests */

function pullNumber(row, config, branch) {
  if (!isPlainRecord(row)) throw fail("repository-unavailable");
  const number = row.number;
  if (!Number.isSafeInteger(number) || number <= 0) throw fail("repository-unavailable");
  const { head, base } = row;
  if (!isPlainRecord(head) || !isPlainRecord(base)) throw fail("repository-unavailable");
  if (head.ref !== branch || base.ref !== config.base) throw fail("repository-unavailable");
  return number;
}

/** Exactly zero or one open pull request exists per author branch. Two rows is
 * an ambiguity this handler refuses rather than resolves, and it never merges,
 * closes, labels, reviews, or comments. */
async function ensurePullRequest(deps, config, branch, docId) {
  const query = `state=open&base=${encodeURIComponent(config.base)}` +
    `&head=${encodeURIComponent(`${config.owner}:${branch}`)}&per_page=2`;
  const listed = await callGitHub(deps, config, "GET", `/repos/${config.repo}/pulls?${query}`);
  if (listed.status !== 200 || !isDenseArray(listed.body)) throw fail("repository-unavailable");
  if (listed.body.length > 1) throw fail("repository-unavailable");
  if (listed.body.length === 1) return pullNumber(listed.body[0], config, branch);
  const created = await callGitHub(deps, config, "POST", `/repos/${config.repo}/pulls`, {
    title: `Inline edits for document ${docId}`,
    head: branch,
    base: config.base,
    body: PULL_BODY,
  });
  if (created.status !== 201) throw fail("repository-unavailable");
  return pullNumber(created.body, config, branch);
}

/* -------------------------------------------------------------- the commit */

/** Replace only `[innerStart, innerEnd)`, preserve every other source byte,
 * and update the section with the file SHA just read. The reader stays the
 * commit author; the site is only the committer. */
async function commitSection(deps, config, branch, path, file, located, html, message, identity) {
  const next = file.text.slice(0, located.innerStart) + html + file.text.slice(located.innerEnd);
  return callGitHub(deps, config, "PUT", `/repos/${config.repo}/contents/${encodeSegments(path)}`, {
    message,
    content: Buffer.from(next, "utf8").toString("base64"),
    sha: file.sha,
    branch,
    author: { name: identity.name, email: identity.email },
    committer: { name: COMMITTER_NAME, email: config.botEmail },
  });
}

/* -------------------------------------------------------------- the factory */

/** Own enumerable data property `key` of `object` as `{ value }`, or `null`.
 * Never invokes an accessor. */
function ownEditData(object, key) {
  if (object === null || typeof object !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    return null;
  }
  return { value: descriptor.value };
}

/** The exact descriptor-safe P2-G unavailable shape. Everything else — an
 * arbitrary throw, a hostile object, a different store code — is invalid
 * state, never a 503. */
function isAccessUnavailable(error) {
  if (error === null || typeof error !== "object" || Array.isArray(error)) return false;
  const name = ownEditData(error, "name");
  const code = ownEditData(error, "code");
  const status = ownEditData(error, "status");
  return (
    name !== null && code !== null && status !== null &&
    name.value === "StoreError" && code.value === "unavailable" && status.value === 503
  );
}

/** Validate the complete P2-G result and return it unchanged. A partial,
 * extended, accessor-backed, or internally inconsistent object is an
 * `invalid-state`, never a falsy capability. */
function validateAccess(deps, result) {
  if (!isExactRecord(result, ACCESS_KEYS)) throw fail("invalid-state");
  if (!ROLES.includes(result.role) || typeof result.shared !== "boolean") {
    throw fail("invalid-state");
  }
  for (const key of CAPABILITY_KEYS) {
    const value = result[key];
    if (key === "threadControl") {
      if (!THREAD_CONTROLS.includes(value)) throw fail("invalid-state");
    } else if (typeof value !== "boolean") {
      throw fail("invalid-state");
    }
  }
  let row;
  try {
    row = deps.capabilitiesFor(result.role);
  } catch {
    throw fail("invalid-state");
  }
  if (row === null || typeof row !== "object") throw fail("invalid-state");
  for (const key of CAPABILITY_KEYS) {
    if (row[key] !== result[key]) throw fail("invalid-state");
  }
  return result;
}

/** The single non-consuming P2-G lookup for this request. */
async function resolveAccess(deps, docId, identity) {
  let result;
  try {
    result = await deps.resolveRole(docId, identity, { consumeInvitation: false });
  } catch (error) {
    throw fail(isAccessUnavailable(error) ? "unavailable" : "invalid-state");
  }
  return validateAccess(deps, result);
}

/**
 * Create the edit handler from one exact dependency object. Throws
 * `TypeError("Invalid edit dependencies")` synchronously on any invalid
 * dependency, so no request field can ever replace a dependency. The manifest
 * index is built lazily on the first authorized request and cached immutably
 * only after complete success.
 *
 * @param {object} dependencies
 * @returns {(req: Request) => Promise<Response>}
 */
export function createEditHandler(dependencies) {
  const deps = captureDependencies(dependencies);
  let index = null;

  const manifestIndex = () => {
    if (index === null) index = buildIndex(process.cwd());
    return index;
  };

  return async function handleEdit(req) {
    if (req.method !== "POST") return errorResponse(fail("method-not-allowed"));
    try {
      try {
        deps.requireOrigin(req);
      } catch (error) {
        if (error instanceof Response) return error;
        throw fail("invalid-state");
      }

      let user;
      try {
        user = await deps.identify(req);
      } catch {
        throw fail("invalid-state");
      }
      if (user === null) throw fail("unauthenticated");
      const identity = requireIdentity(user);

      let search;
      try {
        search = new URL(req.url).search;
      } catch {
        throw fail("invalid-body");
      }
      if (search !== "") throw fail("invalid-body");

      const { docId, aid, text } = parseEditBody(deps, await readJsonObject(req));

      // P4-M: the one non-consuming P2-G lookup, after every P4-B request gate
      // and before the manifest, the source, GitHub, the receipt, or an event.
      // `canSuggest` freezes the shared editing-family boundary; `canEdit` is
      // the direct-write boundary. This module owns no role table of its own.
      const access = await resolveAccess(deps, docId, identity);
      if (access.canSuggest !== true) throw fail("forbidden");
      if (access.canEdit !== true) throw fail("forbidden");

      const manifest = manifestIndex().get(docId);
      if (manifest === undefined) throw fail("not-found");
      const row = manifest.rows.get(aid);
      if (row === undefined) throw fail("not-found");

      let store;
      try {
        store = deps.docState();
      } catch (error) {
        throw fail(storeStatusCode(deps, error));
      }
      let key;
      try {
        key = deps.editKey(docId, aid);
      } catch {
        throw fail("invalid-state");
      }
      const prior = await readCurrentReceipt(deps, store, key, aid);
      if (prior !== null && prior.baseHash === row.hash) {
        throw conflict(receiptText(deps, prior));
      }

      const config = readConfiguration(deps);
      const branch = branchFor(deps, docId, identity.sub);
      await resolveBranch(deps, config, branch);

      const anchorsPath = `${manifest.instance}/anchors.json`;
      const sectionPath = `${manifest.instance}/${row.file}`;
      const message = `Edit block ${aid} in document ${docId}`;
      const html = deps.toHtml(text);

      // Exactly one retry, and only for a GitHub file-SHA race. The second
      // attempt repeats every locator and hash check from scratch; a second
      // 409 is the public conflict and nothing here ever loops.
      for (let attempt = 0; ; attempt += 1) {
        const anchors = await readFile(deps, config, branch, anchorsPath);
        const source = await readFile(deps, config, branch, sectionPath);
        const located = locateBlock(deps, row, aid, anchors.text, source.text);
        const written = await commitSection(
          deps, config, branch, sectionPath, source, located, html, message, identity,
        );
        if (written.status === 200 || written.status === 201) break;
        if (written.status !== 409) throw fail("repository-unavailable");
        if (attempt !== 0) throw conflict(null);
      }

      const pr = await ensurePullRequest(deps, config, branch, docId);

      const sampled = deps.now();
      if (!Number.isSafeInteger(sampled)) throw fail("invalid-state");
      let at;
      try {
        at = new Date(sampled).toISOString();
      } catch {
        throw fail("invalid-state");
      }
      if (!isTimestamp(at)) throw fail("invalid-state");

      const receipt = {
        v: 1,
        aid,
        text,
        by: { sub: identity.sub, name: identity.name, email: identity.email },
        at,
        baseHash: row.hash,
        pr,
        via: "edit",
      };

      // The commit already landed. The receipt is a second, ordered act: a
      // failure here is reported honestly and never claims a rollback.
      let result;
      try {
        result = await deps.mutate(store, key, null, (draft) => {
          if (draft === null) return structuredClone(receipt);
          // A receipt shape this build cannot read is neither stale nor fresh,
          // so it is not ours to replace: a later schema's acceptance or audit
          // fields would be destroyed silently. The precheck already validated
          // this slot, so reaching here means it changed underneath us. Fail
          // closed and report the commit that did land.
          const current = validateReceipt(draft);
          if (current.baseHash !== row.hash) return structuredClone(receipt);
          if (sameReceipt(current, receipt)) return null;
          throw new ReceiptConflict(receiptText(deps, current));
        });
      } catch (error) {
        if (error instanceof ReceiptConflict) throw conflict(error.current);
        if (error instanceof Failure) throw error;
        throw fail("unavailable");
      }
      if (!isExactRecord(result, RESULT_KEYS)) throw fail("unavailable");
      let committed;
      try {
        committed = validateReceipt(result.value);
      } catch {
        throw fail("unavailable");
      }
      if (!sameReceipt(committed, receipt)) throw fail("unavailable");

      return jsonResponse(200, { receipt: projectReceipt(committed) });
    } catch (error) {
      return errorResponse(error instanceof Failure ? error : fail("invalid-state"));
    }
  };
}

const production = createEditHandler({
  requireOrigin,
  identify,
  docState,
  editKey,
  read,
  mutate,
  upgrade,
  StoreError,
  resolveRole,
  capabilitiesFor,
  scanBlocks,
  toMd,
  toHtml,
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => Date.now(),
  sha256Hex: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
  getEnv: (name) => {
    if (!ENV_NAMES.includes(name)) throw new TypeError("Unknown edit environment name");
    return process.env[name];
  },
});

/** @param {Request} req @returns {Promise<Response>} */
export default async function handler(req) {
  return production(req);
}

export const config = { path: "/api/edit" };
