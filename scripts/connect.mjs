import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  realpath,
  open,
  mkdtemp,
  mkdir,
  readdir,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE =
  "node scripts/connect.mjs --file <html> --manifest <edit.json> [--history <history.json>] --owner <email> --name <new-site-name>\n" +
  "node scripts/connect.mjs --file <html> --manifest <edit.json> [--history <history.json>] --owner <email> --site <site-id>\n" +
  "--history is required when manifest.commit is set; omit --history and #doc-history when it is empty.\n" +
  "node scripts/connect.mjs --help\n";
const PROMOTE_USAGE =
  "node scripts/connect.mjs promote --file <html> --manifest <edit.json> [--history <history.json>] --site <site-id> --output <new-directory>\n" +
  "node scripts/connect.mjs promote --help\n";
const RECEIPT_WARNINGS =
  "Whoever can deploy this file decides who owns it.\n" +
  "WARNING: In standalone mode, an editor can change the live document without review.\n" +
  "WARNING: Export is the only path back to a reviewable artifact.\n" +
  "WARNING: A Netlify account with site access outranks the document owner.\n";
const INVALID_ARGUMENTS = Symbol("invalid arguments");
const INVALID_PROMOTION_ARGUMENTS = Symbol("invalid promotion arguments");
const INVALID_INPUT = Symbol("invalid input");
const HTML_LIMIT = 10 * 1024 * 1024;
const SIDECAR_LIMIT = 1024 * 1024;
const COPY_FILE_LIMIT = 10 * 1024 * 1024;
const COPY_TOTAL_LIMIT = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 65_536;
const LIST_OUTPUT_LIMIT = 1_048_576;
const HISTORY_EMBED_LIMIT = 16_384;
const CHILD_TIMEOUT = 60_000;
const LONG_CHILD_TIMEOUT = 600_000;
const ASCII_WS = "\t\n\f\r ";
const CANDIDATES = new Set([
  "p",
  "li",
  "h2",
  "h3",
  "h4",
  "td",
  "th",
  "pre",
  "blockquote",
  "figcaption",
  "dd",
  "dt",
]);
const ENV_KEYS = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "CI",
  "NO_COLOR",
]);
const DEPENDENCY_FUNCTIONS = Object.freeze([
  "lstatFn",
  "realpathFn",
  "openFn",
  "mkdtempFn",
  "mkdirFn",
  "readdirFn",
  "writeFileFn",
  "rmFn",
  "spawnFn",
  "tmpdirFn",
  "setTimeoutFn",
  "clearTimeoutFn",
]);
const DEPENDENCY_KEYS = new Set([
  ...DEPENDENCY_FUNCTIONS,
  "workingDirectory",
  "repositoryRoot",
  "env",
]);
const PROMOTION_DEPENDENCY_FUNCTIONS = Object.freeze([
  "lstatFn",
  "realpathFn",
  "openFn",
  "mkdtempFn",
  "mkdirFn",
  "renameFn",
  "rmFn",
  "spawnFn",
  "tmpdirFn",
  "nowFn",
  "setTimeoutFn",
  "clearTimeoutFn",
  "createPromotionFn",
]);
const PROMOTION_DEPENDENCY_KEYS = new Set([
  ...PROMOTION_DEPENDENCY_FUNCTIONS,
  "workingDirectory",
  "repositoryRoot",
  "env",
  "processId",
]);
const PROMOTION_INPUT_KEYS = Object.freeze(["html", "manifest", "history", "receipts"]);
const PROMOTION_OPTION_KEYS = Object.freeze(["nowMs"]);
const ACTOR_KEYS = Object.freeze(["sub", "name", "email"]);
const RECEIPT_KEYS = Object.freeze(["v", "aid", "text", "by", "at", "baseHash", "pr"]);
const DIRECT_RECEIPT_KEYS = Object.freeze([...RECEIPT_KEYS, "via"]);
const SUGGESTION_RECEIPT_KEYS = Object.freeze([
  ...DIRECT_RECEIPT_KEYS,
  "sugId",
  "acceptedBy",
  "acceptedAt",
]);
const PROMOTION_STAGING_SUFFIX = ".promote-staging";
const PROMOTION_OUTPUT_LOCK_SUFFIX = ".publish.lock";
const PROMOTION_HISTORY_LOCK_SUFFIX = ".promote.lock";
const PROMOTION_PATCH_LIMIT = 1_200;
const PROMOTION_HISTORY_LIMIT = 12;
const PROMOTION_ERROR_TAGS = new Set([
  "promotion",
  "promotion-cleanup",
  "history-lock",
  "output-lock",
  "no-current",
  "too-many",
  "history-collision",
]);

class ConnectError extends Error {
  constructor(tag, detail = null) {
    super(tag);
    this.tag = tag;
    this.detail = detail;
  }
}

function failInput() {
  throw INVALID_INPUT;
}

function isWhitespace(value) {
  return ASCII_WS.includes(value);
}

function exactKeys(value, keys) {
  const ownNames = value !== null && typeof value === "object"
    ? Object.getOwnPropertyNames(value)
    : [];
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    ownNames.length === keys.length &&
    ownNames.every((key, index) => key === keys[index]) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  );
}

function parseTag(source, start) {
  let cursor = start + 1;
  let closing = false;
  if (source[cursor] === "/") {
    closing = true;
    cursor += 1;
  }
  if (!/[A-Za-z]/.test(source[cursor] ?? "")) return null;
  const nameStart = cursor;
  while (/[A-Za-z0-9:-]/.test(source[cursor] ?? "")) cursor += 1;
  const rawName = source.slice(nameStart, cursor);
  const name = rawName.toLowerCase();
  const attrs = [];
  const names = new Set();
  let selfClosing = false;

  if (closing) {
    while (isWhitespace(source[cursor])) cursor += 1;
    if (source[cursor] !== ">") failInput();
    return { type: "end", name, rawName, start, end: cursor + 1, attrs };
  }

  while (cursor < source.length) {
    if (source[cursor] === ">") {
      cursor += 1;
      return { type: "start", name, rawName, start, end: cursor, attrs, selfClosing };
    }
    if (source[cursor] === "/" && source[cursor + 1] === ">") {
      selfClosing = true;
      cursor += 2;
      return { type: "start", name, rawName, start, end: cursor, attrs, selfClosing };
    }
    if (!isWhitespace(source[cursor])) failInput();
    while (isWhitespace(source[cursor])) cursor += 1;
    if (source[cursor] === ">" || (source[cursor] === "/" && source[cursor + 1] === ">")) {
      continue;
    }
    const attributeStart = cursor;
    while (
      cursor < source.length &&
      !isWhitespace(source[cursor]) &&
      !["\0", '"', "'", "`", "<", ">", "/", "="].includes(source[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === attributeStart) failInput();
    const rawNameValue = source.slice(attributeStart, cursor);
    const lowerName = rawNameValue.toLowerCase();
    if (names.has(lowerName)) failInput();
    names.add(lowerName);
    const afterName = cursor;
    while (isWhitespace(source[cursor])) cursor += 1;
    let value = null;
    let quote = null;
    let raw = rawNameValue;
    if (source[cursor] === "=") {
      cursor += 1;
      while (isWhitespace(source[cursor])) cursor += 1;
      if (source[cursor] === '"' || source[cursor] === "'") {
        quote = source[cursor];
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        if (cursor >= source.length) failInput();
        value = source.slice(valueStart, cursor);
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < source.length &&
          !isWhitespace(source[cursor]) &&
          !['"', "'", "`", "=", "<", ">"].includes(source[cursor])
        ) {
          cursor += 1;
        }
        if (cursor === valueStart) failInput();
        value = source.slice(valueStart, cursor);
      }
      raw = source.slice(attributeStart, cursor);
    } else {
      cursor = afterName;
    }
    attrs.push({ name: lowerName, rawName: rawNameValue, value, quote, raw });
  }
  failInput();
}

function skipOpaque(source, start) {
  let quote = null;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return cursor + 1;
    }
  }
  failInput();
}

function findRawClose(source, start, name) {
  let cursor = source.indexOf("</", start);
  while (cursor !== -1) {
    let end = cursor + 2;
    let matches = true;
    for (const expected of name) {
      const code = source.charCodeAt(end);
      const folded = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
      if (folded !== expected.charCodeAt(0)) {
        matches = false;
        break;
      }
      end += 1;
    }
    if (!matches) {
      cursor = source.indexOf("</", cursor + 2);
      continue;
    }
    while (isWhitespace(source[end])) end += 1;
    if (source[end] === ">") return { start: cursor, end: end + 1 };
    cursor = source.indexOf("</", cursor + 2);
  }
  failInput();
}

function* tokenizeHtml(source) {
  if (typeof source !== "string") failInput();
  let cursor = 0;
  while (cursor < source.length) {
    const next = source.indexOf("<", cursor);
    if (next === -1) break;
    cursor = next;
    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end === -1) failInput();
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<!", cursor) || source.startsWith("<?", cursor)) {
      cursor = skipOpaque(source, cursor + 2);
      continue;
    }
    const token = parseTag(source, cursor);
    if (token === null) {
      cursor += 1;
      continue;
    }
    yield token;
    cursor = token.end;
    if (token.type === "start" && (token.name === "script" || token.name === "style")) {
      if (token.selfClosing) failInput();
      const close = findRawClose(source, cursor, token.name);
      token.rawStart = cursor;
      token.rawEnd = close.start;
      const closeToken = parseTag(source, close.start);
      yield closeToken;
      cursor = close.end;
    }
  }
}

function attribute(token, name) {
  return token.attrs.find((item) => item.name === name) ?? null;
}

export function parseConnectArgs(argv) {
  if (!Array.isArray(argv)) throw INVALID_ARGUMENTS;
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const allowed = new Set(["--file", "--manifest", "--history", "--owner", "--name", "--site"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      typeof key !== "string" ||
      !allowed.has(key) ||
      values.has(key) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      throw INVALID_ARGUMENTS;
    }
    values.set(key, value);
  }
  if (
    (values.size !== 4 && values.size !== 5) ||
    !values.has("--file") ||
    !values.has("--manifest") ||
    !values.has("--owner") ||
    values.has("--name") === values.has("--site")
  ) {
    throw INVALID_ARGUMENTS;
  }
  return {
    file: values.get("--file"),
    manifest: values.get("--manifest"),
    history: values.get("--history") ?? null,
    owner: values.get("--owner"),
    name: values.get("--name") ?? null,
    site: values.get("--site") ?? null,
  };
}

export function parsePromoteArgs(argv) {
  if (!Array.isArray(argv)) throw INVALID_PROMOTION_ARGUMENTS;
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const allowed = new Set(["--file", "--manifest", "--history", "--site", "--output"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      typeof key !== "string" ||
      !allowed.has(key) ||
      values.has(key) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      throw INVALID_PROMOTION_ARGUMENTS;
    }
    values.set(key, value);
  }
  if (
    (values.size !== 4 && values.size !== 5) ||
    !values.has("--file") ||
    !values.has("--manifest") ||
    !values.has("--site") ||
    !values.has("--output")
  ) {
    throw INVALID_PROMOTION_ARGUMENTS;
  }
  return {
    file: values.get("--file"),
    manifest: values.get("--manifest"),
    history: values.get("--history") ?? null,
    site: values.get("--site"),
    output: values.get("--output"),
  };
}

function standaloneDocId(source) {
  if (typeof source !== "string") failInput();
  const match = source.match(/^<meta name="doc-id" content="([0-9a-f]{6})">\n/);
  if (match === null) failInput();
  return match[1];
}

function inspectStandaloneHtmlTokens(source, tokens) {
  const docId = standaloneDocId(source);
  let found = 0;
  for (const token of tokens) {
    if (token.type !== "start" || token.name !== "meta") continue;
    const name = attribute(token, "name");
    if (name?.value === "doc-id") found += 1;
  }
  if (found !== 1) failInput();
  return { docId };
}

export function inspectStandaloneHtml(source) {
  return inspectStandaloneHtmlTokens(source, tokenizeHtml(source));
}

function validManifest(value, docId) {
  if (!exactKeys(value, ["docId", "instance", "commit", "blocks"])) failInput();
  if (
    value.docId !== docId ||
    !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(value.instance) ||
    !/^(?:[0-9a-f]{7})?$/.test(value.commit) ||
    value.blocks === null ||
    typeof value.blocks !== "object" ||
    Array.isArray(value.blocks) ||
    Object.getPrototypeOf(value.blocks) !== Object.prototype
  ) {
    failInput();
  }
  const blockKeys = Object.getOwnPropertyNames(value.blocks);
  if (blockKeys.length > 1000 || Object.getOwnPropertySymbols(value.blocks).length !== 0) failInput();
  const blocks = {};
  for (const aid of blockKeys) {
    const blockDescriptor = Object.getOwnPropertyDescriptor(value.blocks, aid);
    if (blockDescriptor?.enumerable !== true || !("value" in blockDescriptor)) failInput();
    const row = blockDescriptor.value;
    if (
      !/^a[0-9a-f]{8}$/.test(aid) ||
      !exactKeys(row, ["file", "section", "tag", "hash"]) ||
      !/^sections\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$/.test(row.file) ||
      !/^[a-z0-9][a-z0-9._-]*$/.test(row.section) ||
      !["p", "h2", "h3", "h4"].includes(row.tag) ||
      !/^[0-9a-f]{64}$/.test(row.hash)
    ) {
      failInput();
    }
    blocks[aid] = { file: row.file, section: row.section, tag: row.tag, hash: row.hash };
  }
  return { docId: value.docId, instance: value.instance, commit: value.commit, blocks };
}

function assertModeManifestTokens(value, html, tokens) {
  const docId = standaloneDocId(html);
  const manifest = validManifest(value, docId);
  const stack = [];
  const seen = new Set();
  let foundDocId = 0;
  let historyScript = null;
  for (const token of tokens) {
    if (token.type === "start") {
      if (token.name === "meta" && attribute(token, "name")?.value === "doc-id") foundDocId += 1;
      if (attribute(token, "id")?.value === "doc-history") {
        if (historyScript !== null) failInput();
        historyScript = token;
      }
      const editable = attribute(token, "data-editable");
      const aidAttr = attribute(token, "data-aid");
      if (!CANDIDATES.has(token.name)) {
        if (editable !== null || aidAttr !== null) failInput();
        continue;
      }
      if (token.selfClosing) failInput();
      if (stack.length > 0 && (editable !== null || aidAttr !== null)) failInput();
      const marked = editable !== null || aidAttr !== null;
      if (marked) {
        if (
          editable === null ||
          aidAttr === null ||
          editable.rawName !== "data-editable" ||
          editable.raw !== "data-editable" ||
          editable.value !== null ||
          aidAttr.rawName !== "data-aid" ||
          aidAttr.quote !== '"' ||
          aidAttr.raw !== `data-aid="${aidAttr.value}"` ||
          !/^a[0-9a-f]{8}$/.test(aidAttr.value ?? "")
        ) {
          failInput();
        }
      }
      stack.push({ token, aid: marked ? aidAttr.value : null });
    } else if (token.type === "end" && CANDIDATES.has(token.name)) {
      const current = stack.pop();
      if (current === undefined || current.token.name !== token.name) failInput();
      if (current.aid !== null) {
        const row = manifest.blocks[current.aid];
        const hash = createHash("sha256")
          .update(html.slice(current.token.end, token.start), "utf8")
          .digest("hex");
        if (row === undefined || row.tag !== token.name || row.hash !== hash || seen.has(current.aid)) failInput();
        seen.add(current.aid);
      }
    }
  }
  if (foundDocId !== 1 || stack.length !== 0 || seen.size !== Object.keys(manifest.blocks).length) failInput();
  return { docId, manifest, historyScript };
}

export function assertModeManifest(value, html) {
  const { docId, manifest } = assertModeManifestTokens(value, html, tokenizeHtml(html));
  return { docId, manifest };
}

export function normalizeConnectOwner(value) {
  if (typeof value !== "string") failInput();
  const trimmed = value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed.charCodeAt(index) > 0x7f) failInput();
  }
  const canonical = trimmed.toLowerCase();
  if (canonical.length > 254 || canonical.split("@").length !== 2) failInput();
  const [local, domain] = canonical.split("@");
  if (!/^[a-z0-9.!#$%&'*+=?^_`{|}~-]{1,64}$/.test(local)) failInput();
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) failInput();
  return canonical;
}

function validHistory(value) {
  if (!exactKeys(value, ["doc", "head", "versions"])) failInput();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value.doc) || !Array.isArray(value.versions) || value.versions.length < 1 || value.versions.length > 12) failInput();
  const shas = new Set();
  const versions = value.versions.map((version) => {
    if (!exactKeys(version, ["sha", "date", "author", "subject", "url", "changed"])) failInput();
    if (
      !/^[0-9a-f]{7}$/.test(version.sha) ||
      shas.has(version.sha) ||
      !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(version.date) ||
      !Number.isFinite(Date.parse(version.date)) ||
      new Date(Date.parse(version.date)).toISOString() !== version.date ||
      typeof version.author !== "string" ||
      typeof version.subject !== "string" ||
      typeof version.url !== "string" ||
      !Array.isArray(version.changed)
    ) {
      failInput();
    }
    shas.add(version.sha);
    if (version.url !== "") {
      const match = version.url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/commit\/([0-9a-f]{40}|[0-9a-f]{64})$/);
      if (match === null || [match[1], match[2]].includes(".") || [match[1], match[2]].includes("..") || !match[3].startsWith(version.sha)) failInput();
    }
    let previous = null;
    const changed = version.changed.map((change) => {
      if (!exactKeys(change, ["file", "id", "add", "del", "patch", "clipped"])) failInput();
      if (
        !(change.file === "doc.json" || change.file === "extra.css" || /^[a-z0-9][a-z0-9._-]*\.html$/.test(change.file)) ||
        !/^[a-z0-9][a-z0-9._-]*$/.test(change.id) ||
        (change.file === "doc.json" && change.id !== "doc") ||
        (change.file === "extra.css" && change.id !== "extra") ||
        !Number.isSafeInteger(change.add) || change.add < 0 ||
        !Number.isSafeInteger(change.del) || change.del < 0 ||
        typeof change.patch !== "string" ||
        typeof change.clipped !== "boolean" ||
        (previous !== null && previous >= change.file)
      ) {
        failInput();
      }
      previous = change.file;
      if (change.patch !== "") {
        if (
          change.patch.includes("\r") ||
          change.patch.endsWith("\n") ||
          Buffer.byteLength(change.patch, "utf8") > 1200 ||
          !change.patch.startsWith("@@") ||
          change.patch.split("\n").some((line) => !/^(?:@@| |\+|-)/.test(line))
        ) failInput();
      }
      return { file: change.file, id: change.id, add: change.add, del: change.del, patch: change.patch, clipped: change.clipped };
    });
    return { sha: version.sha, date: version.date, author: version.author, subject: version.subject, url: version.url, changed };
  });
  if (value.head !== versions[0].sha) failInput();
  return { doc: value.doc, head: value.head, versions };
}

function assertEmbeddedHistory(html, history, script) {
  if (script === null) failInput();
  if (
    html.slice(script.start, script.end) !==
      `<script type="application/json" id="doc-history" data-head="${history.head}">` ||
    script.rawStart === undefined ||
    script.rawEnd === undefined ||
    !html.startsWith("</script>", script.rawEnd)
  ) failInput();
  const raw = html.slice(script.rawStart, script.rawEnd);
  const expected = JSON.stringify(history).replaceAll("</", "<\\/");
  if (Buffer.byteLength(raw, "utf8") > HISTORY_EMBED_LIMIT || raw !== expected) failInput();
  let reparsed;
  try {
    reparsed = JSON.parse(raw.replaceAll("<\\/", "</"));
  } catch {
    failInput();
  }
  if (JSON.stringify(reparsed) !== JSON.stringify(history)) failInput();
}

function denseArray(value) {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || names[names.length - 1] !== "length") return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (names[index] !== String(index) || descriptor?.enumerable !== true || !("value" in descriptor)) return false;
  }
  return true;
}

export function assertPromotionHistory(value, instance) {
  if (typeof instance !== "string" || !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(instance)) failInput();
  if (!exactKeys(value, ["doc", "head", "versions"]) || !denseArray(value.versions)) failInput();
  for (const version of value.versions) {
    if (!exactKeys(version, ["sha", "date", "author", "subject", "url", "changed"]) || !denseArray(version.changed)) failInput();
    if (version.author === "" || version.subject === "") failInput();
    for (const change of version.changed) {
      if (!exactKeys(change, ["file", "id", "add", "del", "patch", "clipped"])) failInput();
    }
  }
  const history = validHistory(value);
  if (history.doc !== instance || Buffer.byteLength(JSON.stringify(history).replaceAll("</", "<\\/"), "utf8") > HISTORY_EMBED_LIMIT) failInput();
  return history;
}

function promotionReplaceLiteral(input, needle, replacement) {
  return input.split(needle).join(replacement);
}

function promotionUntag(input, tag, open, close) {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  let out = "";
  let rest = input;
  for (;;) {
    const openAt = rest.indexOf(openTag);
    if (openAt === -1) return out + rest;
    const closeAt = rest.indexOf(closeTag, openAt + openTag.length);
    if (closeAt === -1) return out + rest;
    out += rest.slice(0, openAt) + open + rest.slice(openAt + openTag.length, closeAt) + close;
    rest = rest.slice(closeAt + closeTag.length);
  }
}

function promotionWrap(input, delimiter, tag) {
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
      out += rest.slice(0, openAt) + `<${tag}>${run}</${tag}>`;
      rest = rest.slice(singleAt + delimiter.length);
    } else {
      out += rest.slice(0, runStart);
      rest = rest.slice(runStart);
    }
  }
}

function promotionToMd(html) {
  let out = promotionUntag(promotionUntag(promotionUntag(html, "code", "`", "`"), "strong", "**", "**"), "em", "*", "*");
  out = promotionReplaceLiteral(out, "&lt;", "<");
  out = promotionReplaceLiteral(out, "&gt;", ">");
  return promotionReplaceLiteral(out, "&amp;", "&");
}

function promotionToHtml(text) {
  let out = promotionReplaceLiteral(text, "&", "&amp;");
  out = promotionReplaceLiteral(out, "<", "&lt;");
  out = promotionReplaceLiteral(out, ">", "&gt;");
  out = promotionWrap(out, "`", "code");
  out = promotionWrap(out, "**", "strong");
  return promotionWrap(out, "*", "em");
}

function promotionAttribute(value) {
  let out = promotionReplaceLiteral(value, "&", "&amp;");
  out = promotionReplaceLiteral(out, '"', "&quot;");
  out = promotionReplaceLiteral(out, "<", "&lt;");
  return promotionReplaceLiteral(out, ">", "&gt;");
}

function hasPromotionMark(inner) {
  return ["code", "strong", "em"].some((tag) => {
    const open = inner.indexOf(`<${tag}>`);
    return open !== -1 && inner.indexOf(`</${tag}>`, open + tag.length + 2) !== -1;
  });
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validPromotionEmail(value) {
  if (value === "") return true;
  try {
    return normalizeConnectOwner(value) === value;
  } catch {
    return false;
  }
}

function validPromotionActor(value) {
  return exactKeys(value, ACTOR_KEYS) &&
    typeof value.sub === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value.sub) &&
    typeof value.name === "string" && value.name.length <= 200 &&
    typeof value.email === "string" && validPromotionEmail(value.email);
}

function promotionReceiptKeys(via) {
  if (via === undefined) return RECEIPT_KEYS;
  if (via === "edit") return DIRECT_RECEIPT_KEYS;
  if (via === "suggestion") return SUGGESTION_RECEIPT_KEYS;
  return null;
}

function promotionReceipt(value, expectedAid) {
  if (value === null || typeof value !== "object") failInput();
  const via = Object.prototype.hasOwnProperty.call(value, "via") ? value.via : undefined;
  const keys = promotionReceiptKeys(via);
  if (keys === null || !exactKeys(value, keys)) failInput();
  if (
    value.v !== 1 || value.aid !== expectedAid || !/^a[0-9a-f]{8}$/.test(expectedAid) ||
    typeof value.text !== "string" || value.text.length > 4000 ||
    !validPromotionActor(value.by) || !validTimestamp(value.at) ||
    typeof value.baseHash !== "string" || !/^[0-9a-f]{64}$/.test(value.baseHash) ||
    !(value.pr === null || (Number.isSafeInteger(value.pr) && value.pr > 0))
  ) failInput();
  if (via === "suggestion" && (
    typeof value.sugId !== "string" || !/^s_[a-z0-9]{1,48}_[0-9a-f]{8}$/.test(value.sugId) ||
    !validPromotionActor(value.acceptedBy) || !validTimestamp(value.acceptedAt)
  )) failInput();
  const receipt = {
    v: 1,
    aid: value.aid,
    text: value.text,
    by: { sub: value.by.sub, name: value.by.name, email: value.by.email },
    at: value.at,
    baseHash: value.baseHash,
    pr: value.pr,
  };
  if (via !== undefined) receipt.via = via;
  if (via === "suggestion") {
    receipt.sugId = value.sugId;
    receipt.acceptedBy = { sub: value.acceptedBy.sub, name: value.acceptedBy.name, email: value.acceptedBy.email };
    receipt.acceptedAt = value.acceptedAt;
  }
  return receipt;
}

function promotionBlocks(html, manifest, tokens, historyScript) {
  const stack = [];
  const blocks = new Map();
  let bodyClose = null;
  for (const token of tokens) {
    if (token.type === "start") {
      if (CANDIDATES.has(token.name)) stack.push(token);
    } else if (token.type === "end") {
      if (token.name === "body") {
        if (bodyClose !== null) failInput();
        bodyClose = token.start;
      }
      if (!CANDIDATES.has(token.name)) continue;
      const open = stack.pop();
      if (open === undefined || open.name !== token.name) failInput();
      const aid = attribute(open, "data-aid")?.value;
      if (aid === undefined || aid === null || manifest.blocks[aid] === undefined) continue;
      const row = manifest.blocks[aid];
      const inner = html.slice(open.end, token.start);
      const oldText = promotionToMd(inner);
      const expectedAttrs = hasPromotionMark(inner) ? ["data-aid", "data-editable", "data-md"] : ["data-aid", "data-editable"];
      if (
        open.rawName !== row.tag || open.attrs.length !== expectedAttrs.length ||
        !open.attrs.every((item, index) => item.rawName === expectedAttrs[index]) ||
        open.attrs[0]?.raw !== `data-aid="${aid}"` || open.attrs[1]?.raw !== "data-editable" ||
        (expectedAttrs.length === 3 && open.attrs[2]?.raw !== `data-md="${promotionAttribute(oldText)}"`) ||
        createHash("sha256").update(inner, "utf8").digest("hex") !== row.hash ||
        promotionToHtml(oldText) !== inner || blocks.has(aid)
      ) failInput();
      blocks.set(aid, { open, close: token, inner, oldText, row });
    }
  }
  if (stack.length !== 0 || blocks.size !== Object.keys(manifest.blocks).length || bodyClose === null) failInput();
  return { blocks, historyScript, bodyClose };
}

function promotionLogicalLines(value) {
  return value === "" ? [] : value.split("\n");
}

function promotionRange(length) {
  if (length === 0) return "0,0";
  if (length === 1) return "1";
  return `1,${length}`;
}

function clipPromotionPatch(value) {
  if (Buffer.byteLength(value, "utf8") <= PROMOTION_PATCH_LIMIT) return { patch: value, clipped: false };
  const bytes = Buffer.from(value, "utf8");
  let end = PROMOTION_PATCH_LIMIT;
  let patch;
  while (end > 0) {
    try {
      patch = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
      break;
    } catch {
      end -= 1;
    }
  }
  if (patch === undefined) failInput();
  patch = patch.replace(/\n+$/, "");
  return { patch, clipped: true };
}

function promotionPatch(oldText, newText) {
  const oldLines = promotionLogicalLines(oldText);
  const newLines = promotionLogicalLines(newText);
  const body = [
    `@@ -${promotionRange(oldLines.length)} +${promotionRange(newLines.length)} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
  if (oldText.includes("\r") || newText.includes("\r")) return { patch: "", clipped: true, add: newLines.length, del: oldLines.length };
  const clipped = clipPromotionPatch(body);
  return { ...clipped, add: newLines.length, del: oldLines.length };
}

function canonicalPromotionNow(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 1_000_000_000_000 || nowMs > 9_999_999_999_999) failInput();
  try {
    const value = new Date(nowMs).toISOString();
    if (!validTimestamp(value)) failInput();
    return value;
  } catch {
    failInput();
  }
}

function measurePromotionHistory(history) {
  return Buffer.byteLength(JSON.stringify(history).replaceAll("</", "<\\/"), "utf8");
}

function trimPromotionHistory(history) {
  while (measurePromotionHistory(history) > HISTORY_EMBED_LIMIT) {
    let dropped = false;
    for (let versionIndex = history.versions.length - 1; versionIndex >= 1 && !dropped; versionIndex -= 1) {
      for (const change of history.versions[versionIndex].changed) {
        if (change.patch !== "") {
          change.patch = "";
          change.clipped = true;
          dropped = true;
          break;
        }
      }
    }
    if (!dropped) failInput();
  }
}

function promotionAuthor(actor) {
  if (actor.name !== "") return actor.name;
  if (actor.email !== "") return actor.email;
  return "Reader";
}

function promotionCodeUnitCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function createPromotion(input, options) {
  if (!exactKeys(input, PROMOTION_INPUT_KEYS) || !exactKeys(options, PROMOTION_OPTION_KEYS)) failInput();
  const { html, manifest: rawManifest, history: rawHistory, receipts: rawReceipts } = input;
  if (typeof html !== "string" || !denseArray(rawReceipts) || rawReceipts.length < 1 || rawReceipts.length > PROMOTION_HISTORY_LIMIT) failInput();
  const inspected = assertModeManifestTokens(rawManifest, html, tokenizeHtml(html));
  const manifest = {
    docId: inspected.manifest.docId,
    instance: inspected.manifest.instance,
    commit: inspected.manifest.commit,
    blocks: {},
  };
  for (const [aid, row] of Object.entries(inspected.manifest.blocks)) manifest.blocks[aid] = { ...row };
  let history;
  if (rawHistory === null) {
    if (manifest.commit !== "" || inspected.historyScript !== null) failInput();
    history = { doc: manifest.instance, head: "", versions: [] };
  } else {
    history = assertPromotionHistory(rawHistory, manifest.instance);
    if (manifest.commit !== history.head) failInput();
    assertEmbeddedHistory(html, history, inspected.historyScript);
  }
  const date = canonicalPromotionNow(options.nowMs);
  const scanned = promotionBlocks(html, manifest, tokenizeHtml(html), inspected.historyScript);
  const receipts = rawReceipts.map((value) => {
    if (value === null || typeof value !== "object" || typeof value.aid !== "string") failInput();
    return promotionReceipt(value, value.aid);
  });
  for (let index = 1; index < receipts.length; index += 1) if (receipts[index - 1].aid >= receipts[index].aid) failInput();
  const changes = [];
  const proposedIds = new Set();
  const existingIds = new Set(history.versions.map((version) => version.sha));
  for (const receipt of receipts) {
    const block = scanned.blocks.get(receipt.aid);
    const nextInner = promotionToHtml(receipt.text);
    if (block === undefined || receipt.baseHash !== block.row.hash || promotionToMd(nextInner) !== receipt.text) failInput();
    const nextHash = createHash("sha256").update(nextInner, "utf8").digest("hex");
    if (nextHash === receipt.baseHash) failInput();
    const stableTuple = [
      "mode-a-promotion-v1",
      manifest.docId,
      receipt.aid,
      receipt.at,
      receipt.by.sub,
      receipt.baseHash,
      nextHash,
      receipt.via ?? "legacy",
      receipt.via === "suggestion" ? receipt.sugId : "",
    ].join("\0");
    const sha = createHash("sha256").update(stableTuple, "utf8").digest("hex").slice(0, 7);
    if (existingIds.has(sha) || proposedIds.has(sha)) throw new ConnectError("history-collision");
    proposedIds.add(sha);
    const patch = promotionPatch(block.oldText, receipt.text);
    const author = promotionAuthor(receipt.by);
    changes.push({
      receipt,
      block,
      nextInner,
      nextHash,
      version: {
        sha,
        date,
        author,
        subject: `Promote accepted edit to ${block.row.section}`,
        url: "",
        changed: [{
          file: block.row.file.slice("sections/".length),
          id: block.row.section,
          add: patch.add,
          del: patch.del,
          patch: patch.patch,
          clipped: patch.clipped,
        }],
      },
    });
  }
  changes.sort((left, right) => {
    const fileOrder = promotionCodeUnitCompare(left.block.row.file, right.block.row.file);
    return fileOrder === 0 ? promotionCodeUnitCompare(left.receipt.aid, right.receipt.aid) : fileOrder;
  });
  history = {
    doc: manifest.instance,
    head: changes[0].version.sha,
    versions: [...changes.map(({ version }) => version), ...history.versions].slice(0, PROMOTION_HISTORY_LIMIT),
  };
  manifest.commit = history.head;
  for (const change of changes) manifest.blocks[change.receipt.aid].hash = change.nextHash;
  trimPromotionHistory(history);
  assertPromotionHistory(history, manifest.instance);
  const historyData = JSON.stringify(history).replaceAll("</", "<\\/");
  const historyScript = `<script type="application/json" id="doc-history" data-head="${history.head}">${historyData}</script>`;
  const replacements = changes.map((change) => ({
    start: change.block.open.start,
    end: change.block.close.start,
    value: `<${change.block.row.tag} data-aid="${change.receipt.aid}" data-editable${hasPromotionMark(change.nextInner) ? ` data-md="${promotionAttribute(change.receipt.text)}"` : ""}>${change.nextInner}`,
  }));
  if (scanned.historyScript === null) {
    replacements.push({ start: scanned.bodyClose, end: scanned.bodyClose, value: `${historyScript}\n` });
  } else {
    replacements.push({ start: scanned.historyScript.start, end: scanned.historyScript.rawEnd + "</script>".length, value: historyScript });
  }
  replacements.sort((left, right) => left.start - right.start);
  const promotedParts = [];
  let promotedCursor = 0;
  for (const replacement of replacements) {
    if (replacement.start < promotedCursor || replacement.end < replacement.start) failInput();
    promotedParts.push(html.slice(promotedCursor, replacement.start), replacement.value);
    promotedCursor = replacement.end;
  }
  promotedParts.push(html.slice(promotedCursor));
  const promotedHtml = promotedParts.join("");
  const finalInspected = assertModeManifestTokens(manifest, promotedHtml, tokenizeHtml(promotedHtml));
  assertEmbeddedHistory(promotedHtml, history, finalInspected.historyScript);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const historyBytes = Buffer.from(`${JSON.stringify(history, null, 2)}\n`, "utf8");
  return Object.freeze({ html: promotedHtml, manifestBytes, historyBytes, promoted: receipts.length });
}

function checkedDependencyObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError("invalid dependencies");
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!DEPENDENCY_KEYS.has(key) || descriptor?.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) throw new TypeError("invalid dependencies");
  }
  return value;
}

function captureEnvironment(environment, requirePlainObject) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    (requirePlainObject && (
      Array.isArray(environment) ||
      Object.getPrototypeOf(environment) !== Object.prototype ||
      Object.getOwnPropertySymbols(environment).length !== 0
    ))
  ) throw new TypeError("invalid environment");
  const result = {};
  for (const key of [...ENV_KEYS, "NETLIFY_CLI_PATH"]) {
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor) || descriptor.value === undefined || typeof descriptor.value !== "string" || descriptor.value.includes("\0")) throw new TypeError("invalid environment");
    result[key] = descriptor.value;
  }
  return result;
}

function validStat(stat) {
  return (
    stat !== null &&
    typeof stat === "object" &&
    typeof stat.isFile === "function" &&
    Number.isInteger(stat.dev) && stat.dev >= 0 &&
    Number.isInteger(stat.ino) && stat.ino >= 0 &&
    Number.isInteger(stat.size) && stat.size >= 0 &&
    Number.isFinite(stat.mtimeMs) &&
    Number.isFinite(stat.ctimeMs)
  );
}

function sameFileStat(left, right) {
  return validStat(left) && validStat(right) && left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readStable(path, limit, dependencies) {
  const before = await dependencies.lstatFn(path);
  if (!validStat(before) || !before.isFile() || before.isSymbolicLink?.() === true || before.size > limit) failInput();
  const handle = await dependencies.openFn(path, "r");
  let closeError;
  try {
    const first = await handle.stat();
    if (!sameFileStat(before, first)) failInput();
    const chunks = [];
    let offset = 0;
    while (offset < first.size) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, first.size - offset));
      const result = await handle.read(buffer, 0, buffer.length, offset);
      if (!Number.isInteger(result?.bytesRead) || result.bytesRead <= 0 || result.bytesRead > buffer.length) failInput();
      chunks.push(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
      if (offset > limit) failInput();
    }
    const extra = Buffer.alloc(1);
    const extraResult = await handle.read(extra, 0, 1, offset);
    if (!Number.isInteger(extraResult?.bytesRead) || extraResult.bytesRead !== 0 || offset !== first.size) failInput();
    const after = await handle.stat();
    if (!sameFileStat(first, after)) failInput();
    return { bytes: Buffer.concat(chunks), stat: after };
  } finally {
    try {
      await handle.close();
    } catch (error) {
      closeError = error;
    }
    if (closeError !== undefined) throw closeError;
  }
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    failInput();
  }
}

function assertParsed(parsed) {
  if (!exactKeys(parsed, ["file", "manifest", "history", "owner", "name", "site"])) failInput();
  for (const key of ["file", "manifest", "owner"]) if (typeof parsed[key] !== "string" || parsed[key].length === 0) failInput();
  if (parsed.history !== null && (typeof parsed.history !== "string" || parsed.history.length === 0)) failInput();
  if ((parsed.name === null) === (parsed.site === null)) failInput();
  if (parsed.name !== null && (typeof parsed.name !== "string" || parsed.name.length === 0)) failInput();
  if (parsed.site !== null && (typeof parsed.site !== "string" || parsed.site.length === 0)) failInput();
}

function safeTempPath(root, candidate) {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  const printable = /^[\x20-\x7e]+$/;
  const rootParse = parse(normalizedRoot);
  const rel = relative(normalizedRoot, normalizedCandidate);
  if (!printable.test(normalizedRoot) || !printable.test(normalizedCandidate) || normalizedRoot === rootParse.root || rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) failInput();
  return normalizedCandidate;
}

function validDirectoryStat(stat) {
  return validStat(stat) && typeof stat.isDirectory === "function" && stat.isDirectory();
}

async function copyRepository(projectRoot, repositoryRoot, dependencies) {
  if ((await dependencies.realpathFn(repositoryRoot)) !== repositoryRoot) failInput();
  const rootBefore = await dependencies.lstatFn(repositoryRoot);
  if (!validDirectoryStat(rootBefore) || rootBefore.isSymbolicLink?.() === true) failInput();
  let entries = 0;
  let totalBytes = 0;
  const count = () => {
    entries += 1;
    if (entries > 4096) failInput();
  };
  const copyPath = async (source, destination, depth) => {
    const sourceRelative = relative(repositoryRoot, source);
    if (
      depth > 16 ||
      sourceRelative === "" ||
      sourceRelative === ".." ||
      sourceRelative.startsWith(`..${sep}`) ||
      isAbsolute(sourceRelative) ||
      (await dependencies.realpathFn(source)) !== source
    ) failInput();
    const stat = await dependencies.lstatFn(source);
    if (stat.isSymbolicLink?.() === true) failInput();
    count();
    if (stat.isDirectory?.()) {
      if (!validDirectoryStat(stat)) failInput();
      await dependencies.mkdirFn(destination, { mode: 0o700 });
      const names = await dependencies.readdirFn(source);
      if (
        !Array.isArray(names) ||
        new Set(names).size !== names.length ||
        names.some((name) => typeof name !== "string" || name === "" || name === "." || name === ".." || name.includes("/") || name.includes("\0"))
      ) failInput();
      names.sort();
      for (const name of names) await copyPath(join(source, name), join(destination, name), depth + 1);
      const after = await dependencies.lstatFn(source);
      if (!validDirectoryStat(after) || stat.dev !== after.dev || stat.ino !== after.ino || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) failInput();
      return;
    }
    const file = await readStable(source, COPY_FILE_LIMIT, dependencies);
    totalBytes += file.bytes.length;
    if (totalBytes > COPY_TOTAL_LIMIT) failInput();
    await dependencies.writeFileFn(destination, file.bytes, { mode: 0o600 });
  };
  for (const name of ["netlify", "netlify.toml", "package.json", "package-lock.json"]) {
    await copyPath(join(repositoryRoot, name), join(projectRoot, name), 1);
  }
  const rootAfter = await dependencies.lstatFn(repositoryRoot);
  if (
    !validDirectoryStat(rootAfter) ||
    rootBefore.dev !== rootAfter.dev ||
    rootBefore.ino !== rootAfter.ino ||
    rootBefore.mtimeMs !== rootAfter.mtimeMs ||
    rootBefore.ctimeMs !== rootAfter.ctimeMs
  ) failInput();
}

function normalizedOutput(buffer) {
  let value = buffer.toString("utf8");
  if (value.endsWith("\n")) {
    value = value.slice(0, -1);
    if (value.endsWith("\r")) value = value.slice(0, -1);
  }
  return value;
}

function parseJsonObject(buffer) {
  let value;
  try {
    value = JSON.parse(decodeUtf8(buffer));
  } catch {
    failInput();
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) failInput();
  return value;
}

function canonicalSiteId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function canonicalDeployUrl(value) {
  if (typeof value !== "string" || value.includes("?") || value.includes("#")) failInput();
  let url;
  try {
    url = new URL(value);
  } catch {
    failInput();
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.port !== "" || url.pathname !== "/") failInput();
  return url.href;
}

async function supervise(spawnFn, executable, args, options, timeoutMs, timers, afterSpawn, limits = {}) {
  let child;
  try {
    child = spawnFn(executable, args, options);
  } catch (error) {
    throw new ConnectError("setup", error);
  }
  afterSpawn?.();
  if (child === null || typeof child !== "object" || child.stdout?.on === undefined || child.stderr?.on === undefined || typeof child.on !== "function" || typeof child.kill !== "function") throw new ConnectError("setup");
  return await new Promise((resolvePromise, rejectPromise) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure = null;
    let killTimer = null;
    let terminationStarted = false;
    let settled = false;
    const terminate = (reason) => {
      if (failure === null) failure = reason;
      if (terminationStarted || settled) return;
      terminationStarted = true;
      child.stdout.resume?.();
      child.stderr.resume?.();
      try { child.kill("SIGTERM"); } catch {}
      if (killTimer === null) killTimer = timers.setTimeoutFn(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    };
    const timer = timers.setTimeoutFn(() => terminate(new ConnectError("setup")), timeoutMs);
    const collect = (target, chunk, stream) => {
      const length = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk?.byteLength;
      if (!Number.isSafeInteger(length) || length < 0) {
        terminate(new ConnectError("setup"));
        return;
      }
      if (stream === "stdout") stdoutBytes += length;
      else stderrBytes += length;
      const limit = stream === "stdout" ? (limits.stdout ?? OUTPUT_LIMIT) : (limits.stderr ?? OUTPUT_LIMIT);
      if ((stream === "stdout" ? stdoutBytes : stderrBytes) > limit) terminate(new ConnectError("setup"));
      else target.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    child.on("error", (error) => terminate(new ConnectError("setup", error)));
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      timers.clearTimeoutFn(timer);
      if (killTimer !== null) timers.clearTimeoutFn(killTimer);
      if (failure !== null) rejectPromise(failure);
      else resolvePromise({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export function createConnectRunner(dependencies = {}) {
  const supplied = checkedDependencyObject(dependencies);
  for (const key of DEPENDENCY_FUNCTIONS) if (key in supplied && typeof supplied[key] !== "function") throw new TypeError("invalid dependencies");
  const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workingDirectory = supplied.workingDirectory ?? process.cwd();
  const repositoryRoot = supplied.repositoryRoot ?? moduleRoot;
  if (typeof workingDirectory !== "string" || !isAbsolute(workingDirectory) || typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) throw new TypeError("invalid dependencies");
  const capturedEnv = captureEnvironment(supplied.env ?? process.env, supplied.env !== undefined);
  const deps = {
    lstatFn: supplied.lstatFn ?? lstat,
    realpathFn: supplied.realpathFn ?? realpath,
    openFn: supplied.openFn ?? open,
    mkdtempFn: supplied.mkdtempFn ?? mkdtemp,
    mkdirFn: supplied.mkdirFn ?? mkdir,
    readdirFn: supplied.readdirFn ?? readdir,
    writeFileFn: supplied.writeFileFn ?? writeFile,
    rmFn: supplied.rmFn ?? rm,
    spawnFn: supplied.spawnFn ?? spawn,
    tmpdirFn: supplied.tmpdirFn ?? tmpdir,
    setTimeoutFn: supplied.setTimeoutFn ?? setTimeout,
    clearTimeoutFn: supplied.clearTimeoutFn ?? clearTimeout,
  };
  const childBaseEnv = {};
  for (const key of ENV_KEYS) if (Object.prototype.hasOwnProperty.call(capturedEnv, key)) childBaseEnv[key] = capturedEnv[key];

  return async function run(parsed) {
    let temporaryRoot = null;
    let outcome;
    let mayHaveCreatedSite = false;
    try {
      assertParsed(parsed);
      if ((await deps.realpathFn(workingDirectory)) !== workingDirectory) failInput();
      const workingStat = await deps.lstatFn(workingDirectory);
      if (!validDirectoryStat(workingStat) || workingStat.isSymbolicLink?.() === true) failInput();
      const filePath = resolve(workingDirectory, parsed.file);
      const manifestPath = resolve(workingDirectory, parsed.manifest);
      const inputs = [
        { path: filePath, limit: HTML_LIMIT },
        { path: manifestPath, limit: SIDECAR_LIMIT },
      ];
      if (parsed.history !== null) inputs.push({ path: resolve(workingDirectory, parsed.history), limit: SIDECAR_LIMIT });
      if (new Set(inputs.map(({ path }) => path)).size !== inputs.length) failInput();
      const inputFiles = await Promise.all(inputs.map(({ path, limit }) => readStable(path, limit, deps)));
      const [htmlFile, manifestFile, historyFile = null] = inputFiles;
      const identities = new Set(inputFiles.map((file) => `${file.stat.dev}:${file.stat.ino}`));
      if (identities.size !== inputFiles.length) failInput();
      const html = decodeUtf8(htmlFile.bytes);
      const manifestText = decodeUtf8(manifestFile.bytes);
      let manifestValue;
      try {
        manifestValue = JSON.parse(manifestText);
      } catch {
        failInput();
      }
      const inspected = assertModeManifestTokens(manifestValue, html, tokenizeHtml(html));
      const canonicalManifest = `${JSON.stringify(inspected.manifest, null, 2)}\n`;
      if (manifestText !== canonicalManifest) failInput();
      const hasHistory = inspected.manifest.commit !== "";
      if ((historyFile !== null) !== hasHistory) failInput();
      if (hasHistory) {
        const historyText = decodeUtf8(historyFile.bytes);
        let historyValue;
        try {
          historyValue = JSON.parse(historyText);
        } catch {
          failInput();
        }
        const history = validHistory(historyValue);
        if (historyText !== `${JSON.stringify(history, null, 2)}\n` || history.doc !== inspected.manifest.instance || history.head !== inspected.manifest.commit) failInput();
        assertEmbeddedHistory(html, history, inspected.historyScript);
      } else if (inspected.historyScript !== null) {
        failInput();
      }
      const owner = normalizeConnectOwner(parsed.owner);
      if (parsed.name !== null && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(parsed.name)) failInput();
      if (parsed.site !== null && !canonicalSiteId(parsed.site)) failInput();

      let executable = "netlify";
      if (capturedEnv.NETLIFY_CLI_PATH !== undefined) {
        executable = capturedEnv.NETLIFY_CLI_PATH;
        if (!isAbsolute(executable) || (await deps.realpathFn(executable)) !== executable) failInput();
        const executableStat = await deps.lstatFn(executable);
        if (!validStat(executableStat) || !executableStat.isFile() || executableStat.isSymbolicLink?.() === true) failInput();
      }

      const tempRoot = deps.tmpdirFn();
      if (typeof tempRoot !== "string") failInput();
      const made = await deps.mkdtempFn(join(tempRoot, "connect-"), { encoding: "utf8" });
      try {
        temporaryRoot = safeTempPath(tempRoot, made);
      } catch (error) {
        if (typeof made === "string") await deps.rmFn(made, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      const projectRoot = join(temporaryRoot, "project");
      const publishRoot = join(projectRoot, "publish");
      const privateRoot = join(projectRoot, "private");
      await deps.mkdirFn(projectRoot, { mode: 0o700 });
      await deps.mkdirFn(publishRoot, { mode: 0o700 });
      await deps.mkdirFn(privateRoot, { mode: 0o700 });
      await copyRepository(projectRoot, repositoryRoot, deps);
      const inputPath = join(privateRoot, "manifest.input");
      const outputPath = join(privateRoot, "manifest.output");
      await deps.writeFileFn(join(publishRoot, "index.html"), htmlFile.bytes);
      await deps.writeFileFn(inputPath, manifestFile.bytes, { mode: 0o600 });
      await deps.writeFileFn(outputPath, Buffer.alloc(0), { mode: 0o600 });

      const call = async (args, { siteId = null, timeout = CHILD_TIMEOUT, afterSpawn = null } = {}) => {
        const env = { ...childBaseEnv };
        if (siteId !== null) env.NETLIFY_SITE_ID = siteId;
        return await supervise(deps.spawnFn, executable, args, {
          cwd: projectRoot,
          env,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        }, timeout, deps, afterSpawn);
      };

      let siteId = parsed.site;
      if (parsed.name !== null) {
        const result = await call(
          ["sites:create", "--name", parsed.name, "--disable-linking", "--json"],
          { timeout: LONG_CHILD_TIMEOUT, afterSpawn: () => { mayHaveCreatedSite = true; } },
        );
        if (result.code !== 0 || result.signal !== null) failInput();
        const json = parseJsonObject(result.stdout);
        const first = json.site_id;
        const second = json.id;
        if (first !== undefined && !canonicalSiteId(first)) failInput();
        if (second !== undefined && !canonicalSiteId(second)) failInput();
        if (first !== undefined && second !== undefined && first !== second) failInput();
        siteId = first ?? second;
        if (!canonicalSiteId(siteId)) failInput();
      }
      const seed = `${inspected.docId}:${owner}`;
      let result = await call(["env:get", "DOC_OWNERS", "--context", "production"], { siteId });
      let current;
      if (result.code === 0 && result.signal === null) current = normalizedOutput(result.stdout);
      else if (result.code === 1 && result.signal === null && result.stdout.length === 0) current = "";
      else failInput();
      if (current !== "" && current !== seed) throw new ConnectError("conflict");
      if (current === "") {
        result = await call(["env:set", "DOC_OWNERS", seed], { siteId });
        if (result.code !== 0 || result.signal !== null) failInput();
      }
      result = await call(["env:get", "DOC_OWNERS", "--context", "production"], { siteId });
      if (result.code !== 0 || result.signal !== null || normalizedOutput(result.stdout) !== seed) failInput();
      result = await call(["blobs:set", "doc-state", `mode/${inspected.docId}/manifest.json`, "--input", inputPath], { siteId });
      if (result.code !== 0 || result.signal !== null) failInput();
      result = await call(["blobs:get", "doc-state", `mode/${inspected.docId}/manifest.json`, "--output", outputPath], { siteId });
      if (result.code !== 0 || result.signal !== null) failInput();
      const downloaded = await readStable(outputPath, SIDECAR_LIMIT, deps);
      if (!downloaded.bytes.equals(manifestFile.bytes)) failInput();
      result = await call(
        ["deploy", "--prod", "--no-build", "--dir", "publish", "--json"],
        { siteId, timeout: LONG_CHILD_TIMEOUT },
      );
      if (result.code !== 0 || result.signal !== null) failInput();
      const deploy = parseJsonObject(result.stdout);
      let url = null;
      if (deploy.url !== undefined) url = canonicalDeployUrl(deploy.url);
      if (deploy.deploy_url !== undefined) {
        const deployUrl = canonicalDeployUrl(deploy.deploy_url);
        if (url === null) url = deployUrl;
      }
      if (url === null) failInput();
      outcome = { docId: inspected.docId, owner, siteId, url };
    } catch (error) {
      if (error instanceof ConnectError) outcome = error;
      else outcome = new ConnectError("setup", error);
      if (mayHaveCreatedSite && outcome.tag !== "cleanup") outcome = new ConnectError("new-site", parsed?.name ?? null);
    } finally {
      if (temporaryRoot !== null) {
        try {
          await deps.rmFn(temporaryRoot, { recursive: true, force: true });
        } catch {
          outcome = new ConnectError("cleanup", temporaryRoot);
        }
      }
    }
    if (outcome instanceof ConnectError) throw outcome;
    return { docId: outcome.docId, owner: outcome.owner, siteId: outcome.siteId, url: outcome.url };
  };
}

function checkedPromotionDependencyObject(value) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0
  ) throw new TypeError("Invalid promotion dependencies");
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!PROMOTION_DEPENDENCY_KEYS.has(key) || descriptor?.enumerable !== true || !("value" in descriptor) || descriptor.value === undefined) {
      throw new TypeError("Invalid promotion dependencies");
    }
  }
  return value;
}

function assertPromotionParsed(parsed) {
  if (!exactKeys(parsed, ["file", "manifest", "history", "site", "output"])) failInput();
  for (const key of ["file", "manifest", "site", "output"]) if (typeof parsed[key] !== "string" || parsed[key].length === 0) failInput();
  if (parsed.history !== null && (typeof parsed.history !== "string" || parsed.history.length === 0)) failInput();
}

function validPromotionPath(path) {
  return typeof path === "string" && Buffer.byteLength(path, "utf8") <= 4096 &&
    !/[\u0000-\u001f\u007f-\u009f\r\n]/.test(path) &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(path);
}

async function missingPromotionPath(path, lstatFn) {
  try {
    await lstatFn(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function readPromotionFile(path, limit, dependencies) {
  const before = await dependencies.lstatFn(path);
  if (!validStat(before) || !before.isFile() || before.isSymbolicLink?.() === true || before.size > limit) failInput();
  const handle = await dependencies.openFn(path, "r");
  if (handle === null || typeof handle !== "object" || typeof handle.stat !== "function" || typeof handle.readFile !== "function" || typeof handle.close !== "function") failInput();
  let value;
  let failure;
  try {
    const first = await handle.stat();
    if (!sameFileStat(before, first)) failInput();
    value = await handle.readFile();
    if (!Buffer.isBuffer(value)) value = Buffer.from(value);
    if (value.length !== first.size || value.length > limit) failInput();
    const after = await handle.stat();
    if (!sameFileStat(first, after)) failInput();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
  return { bytes: value, stat: before };
}

async function writePromotionFile(path, bytes, dependencies) {
  const handle = await dependencies.openFn(path, "wx", 0o600);
  if (handle === null || typeof handle !== "object" || typeof handle.writeFile !== "function" || typeof handle.sync !== "function" || typeof handle.close !== "function") failInput();
  let failure;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

async function syncPromotionDirectory(path, dependencies) {
  const handle = await dependencies.openFn(path, "r");
  if (handle === null || typeof handle !== "object" || typeof handle.sync !== "function" || typeof handle.close !== "function") failInput();
  let failure;
  try {
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

async function createPromotionLock(path, line, tag, dependencies) {
  let handle;
  try {
    handle = await dependencies.openFn(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new ConnectError(tag);
    throw error;
  }
  let identity;
  let failure;
  try {
    if (handle === null || typeof handle !== "object" || typeof handle.stat !== "function" || typeof handle.writeFile !== "function" || typeof handle.sync !== "function" || typeof handle.close !== "function") failInput();
    identity = await handle.stat();
    if (!validStat(identity) || !identity.isFile() || identity.isSymbolicLink?.() === true) failInput();
    await handle.writeFile(line);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  if (typeof handle?.close === "function") {
    try {
      await handle.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    if (!validStat(identity)) throw new ConnectError("promotion-cleanup", path);
    try {
      const current = await dependencies.lstatFn(path);
      if (!validStat(current) || current.dev !== identity?.dev || current.ino !== identity?.ino) throw new Error("promotion identity changed");
      await dependencies.rmFn(path, { force: false, recursive: false });
    } catch {
      throw new ConnectError("promotion-cleanup", path);
    }
    throw failure;
  }
  return { path, identity };
}

async function removePromotionOwned(item, dependencies) {
  const current = await dependencies.lstatFn(item.path);
  if (!validStat(current) || current.dev !== item.identity.dev || current.ino !== item.identity.ino) throw new Error("promotion identity changed");
  await dependencies.rmFn(item.path, { force: false, recursive: false });
}

function promotionShellPath(path) {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function promotionBlobInventory(value, docId) {
  if (!exactKeys(value, ["blobs", "directories"]) || !denseArray(value.blobs) || !denseArray(value.directories) || value.directories.length !== 0 || value.blobs.length > 1000) failInput();
  const prefix = `edits/${docId}/`;
  const keyPattern = new RegExp(`^${prefix}(a[0-9a-f]{8})\\.json$`);
  const rows = [];
  const aids = new Set();
  for (const blob of value.blobs) {
    if (!exactKeys(blob, ["etag", "key"]) || typeof blob.etag !== "string" || typeof blob.key !== "string") failInput();
    if (
      blob.etag === "" || Buffer.byteLength(blob.etag, "utf8") > 512 ||
      Buffer.byteLength(JSON.stringify(blob.etag), "utf8") > 768 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(blob.etag) ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(blob.etag)
    ) failInput();
    const match = blob.key.match(keyPattern);
    if (match === null || blob.key !== `${prefix}${match[1]}.json` || aids.has(match[1])) failInput();
    aids.add(match[1]);
    rows.push({ aid: match[1], key: blob.key });
  }
  rows.sort((left, right) => promotionCodeUnitCompare(left.aid, right.aid));
  return rows;
}

export function createPromotionRunner(dependencies = {}) {
  const supplied = checkedPromotionDependencyObject(dependencies);
  for (const key of PROMOTION_DEPENDENCY_FUNCTIONS) if (key in supplied && typeof supplied[key] !== "function") throw new TypeError("Invalid promotion dependencies");
  if ("processId" in supplied && (!Number.isSafeInteger(supplied.processId) || supplied.processId <= 0)) throw new TypeError("Invalid promotion dependencies");
  const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workingDirectory = supplied.workingDirectory ?? process.cwd();
  const repositoryRoot = supplied.repositoryRoot ?? moduleRoot;
  if (typeof workingDirectory !== "string" || !isAbsolute(workingDirectory) || typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) throw new TypeError("Invalid promotion dependencies");
  let capturedEnv;
  try {
    capturedEnv = captureEnvironment(supplied.env ?? process.env, supplied.env !== undefined);
  } catch {
    throw new TypeError("Invalid promotion dependencies");
  }
  const deps = {
    lstatFn: supplied.lstatFn ?? lstat,
    realpathFn: supplied.realpathFn ?? realpath,
    openFn: supplied.openFn ?? open,
    mkdtempFn: supplied.mkdtempFn ?? mkdtemp,
    mkdirFn: supplied.mkdirFn ?? mkdir,
    renameFn: supplied.renameFn ?? rename,
    rmFn: supplied.rmFn ?? rm,
    spawnFn: supplied.spawnFn ?? spawn,
    tmpdirFn: supplied.tmpdirFn ?? tmpdir,
    nowFn: supplied.nowFn ?? Date.now,
    setTimeoutFn: supplied.setTimeoutFn ?? setTimeout,
    clearTimeoutFn: supplied.clearTimeoutFn ?? clearTimeout,
    createPromotionFn: supplied.createPromotionFn ?? createPromotion,
  };
  const processId = supplied.processId ?? process.pid;
  const homeDirectory = homedir();
  const childBaseEnv = {};
  for (const key of ENV_KEYS) if (Object.prototype.hasOwnProperty.call(capturedEnv, key)) childBaseEnv[key] = capturedEnv[key];

  return async function run(parsed) {
    const cleanup = [];
    let outcome;
    try {
      assertPromotionParsed(parsed);
      if ((await deps.realpathFn(workingDirectory)) !== workingDirectory || (await deps.realpathFn(repositoryRoot)) !== repositoryRoot) failInput();
      const workingStat = await deps.lstatFn(workingDirectory);
      const repositoryStat = await deps.lstatFn(repositoryRoot);
      if (!validDirectoryStat(workingStat) || workingStat.isSymbolicLink?.() === true || !validDirectoryStat(repositoryStat) || repositoryStat.isSymbolicLink?.() === true) failInput();
      const filePath = resolve(workingDirectory, parsed.file);
      const manifestPath = resolve(workingDirectory, parsed.manifest);
      const historyPath = parsed.history === null ? null : resolve(workingDirectory, parsed.history);
      const outputPath = resolve(workingDirectory, parsed.output);
      const inputPaths = historyPath === null ? [filePath, manifestPath] : [filePath, manifestPath, historyPath];
      if (![...inputPaths, outputPath].every(validPromotionPath) || new Set(inputPaths).size !== inputPaths.length) failInput();
      const outputParent = dirname(outputPath);
      const parentStat = await deps.lstatFn(outputParent);
      if (!validDirectoryStat(parentStat) || parentStat.isSymbolicLink?.() === true || (await deps.realpathFn(outputParent)) !== outputParent) failInput();
      const forbiddenRoots = [parse(outputPath).root, homeDirectory, workingDirectory, repositoryRoot];
      if (forbiddenRoots.includes(outputPath) || [".git", ".netlify", "node_modules"].some((name) => normalize(outputPath).split(sep).includes(name))) failInput();
      for (const inputPath of inputPaths) {
        const rel = relative(outputPath, inputPath);
        if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) failInput();
      }
      if (!(await missingPromotionPath(outputPath, deps.lstatFn))) failInput();
      for (let cursor = outputParent;; cursor = dirname(cursor)) {
        if (!(await missingPromotionPath(join(cursor, "doc.json"), deps.lstatFn)) || !(await missingPromotionPath(join(cursor, "sections"), deps.lstatFn))) failInput();
        const next = dirname(cursor);
        if (next === cursor) break;
      }
      const htmlParent = dirname(filePath);
      if (!(await missingPromotionPath(join(htmlParent, "doc.json"), deps.lstatFn)) || !(await missingPromotionPath(join(htmlParent, "sections"), deps.lstatFn))) failInput();
      const inputs = await Promise.all(inputPaths.map((path, index) => readPromotionFile(path, index === 0 ? HTML_LIMIT : SIDECAR_LIMIT, deps)));
      if (new Set(inputs.map(({ stat }) => `${stat.dev}:${stat.ino}`)).size !== inputs.length) failInput();
      const [htmlFile, manifestFile, historyFile = null] = inputs;
      const html = decodeUtf8(htmlFile.bytes);
      const manifestText = decodeUtf8(manifestFile.bytes);
      let manifestValue;
      try { manifestValue = JSON.parse(manifestText); } catch { failInput(); }
      const inspected = assertModeManifestTokens(manifestValue, html, tokenizeHtml(html));
      if (manifestText !== `${JSON.stringify(inspected.manifest, null, 2)}\n`) failInput();
      let history = null;
      if (historyFile === null) {
        if (inspected.manifest.commit !== "" || inspected.historyScript !== null) failInput();
      } else {
        const historyText = decodeUtf8(historyFile.bytes);
        let historyValue;
        try { historyValue = JSON.parse(historyText); } catch { failInput(); }
        history = assertPromotionHistory(historyValue, inspected.manifest.instance);
        if (historyText !== `${JSON.stringify(history, null, 2)}\n` || history.head !== inspected.manifest.commit) failInput();
        assertEmbeddedHistory(html, history, inspected.historyScript);
      }
      if (!canonicalSiteId(parsed.site)) failInput();

      let executable = "netlify";
      if (capturedEnv.NETLIFY_CLI_PATH !== undefined) {
        executable = capturedEnv.NETLIFY_CLI_PATH;
        if (!isAbsolute(executable) || (await deps.realpathFn(executable)) !== executable) failInput();
        const executableStat = await deps.lstatFn(executable);
        if (!validStat(executableStat) || !executableStat.isFile() || executableStat.isSymbolicLink?.() === true) failInput();
      }
      const startedAt = canonicalPromotionNow(deps.nowFn());
      const lockLine = `${JSON.stringify({ v: 1, pid: processId, startedAt, output: outputPath })}\n`;
      if (Buffer.byteLength(lockLine, "utf8") > HISTORY_EMBED_LIMIT) failInput();
      const sourceLockPath = `${historyPath ?? manifestPath}${PROMOTION_HISTORY_LOCK_SUFFIX}`;
      const sourceLock = await createPromotionLock(sourceLockPath, lockLine, "history-lock", deps);
      cleanup.push(sourceLock);
      const outputLock = await createPromotionLock(`${outputPath}${PROMOTION_OUTPUT_LOCK_SUFFIX}`, lockLine, "output-lock", deps);
      cleanup.push(outputLock);

      const tempBase = deps.tmpdirFn();
      if (typeof tempBase !== "string" || !validPromotionPath(tempBase)) failInput();
      const made = await deps.mkdtempFn(join(tempBase, "promote-"), { encoding: "utf8", mode: 0o700 });
      const temporaryRoot = safeTempPath(tempBase, made);
      const temporaryStat = await deps.lstatFn(temporaryRoot);
      if (!validDirectoryStat(temporaryStat) || temporaryStat.isSymbolicLink?.() === true) failInput();
      cleanup.push({ path: temporaryRoot, identity: temporaryStat, recursive: true });
      const remoteManifestPath = join(temporaryRoot, "manifest.json");
      await writePromotionFile(remoteManifestPath, Buffer.alloc(0), deps);
      const childEnv = { ...childBaseEnv, NETLIFY_SITE_ID: parsed.site };
      const call = async (args, stdoutLimit = OUTPUT_LIMIT) => await supervise(deps.spawnFn, executable, args, {
        cwd: repositoryRoot,
        env: childEnv,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      }, CHILD_TIMEOUT, deps, null, { stdout: stdoutLimit, stderr: OUTPUT_LIMIT });
      let child = await call(["blobs:get", "doc-state", `mode/${inspected.docId}/manifest.json`, "--output", remoteManifestPath]);
      if (child.code !== 0 || child.signal !== null) failInput();
      const downloadedManifest = await readPromotionFile(remoteManifestPath, SIDECAR_LIMIT, deps);
      if (!downloadedManifest.bytes.equals(manifestFile.bytes)) failInput();
      child = await call(["blobs:list", "doc-state", "--prefix", `edits/${inspected.docId}/`, "--json"], LIST_OUTPUT_LIMIT);
      if (child.code !== 0 || child.signal !== null) failInput();
      let inventoryValue;
      try { inventoryValue = JSON.parse(decodeUtf8(child.stdout)); } catch { failInput(); }
      const listed = promotionBlobInventory(inventoryValue, inspected.docId);
      const current = [];
      let stale = 0;
      for (let index = 0; index < listed.length; index += 1) {
        const row = listed[index];
        const receiptPath = join(temporaryRoot, `receipt-${index}.json`);
        await writePromotionFile(receiptPath, Buffer.alloc(0), deps);
        child = await call(["blobs:get", "doc-state", row.key, "--output", receiptPath]);
        if (child.code !== 0 || child.signal !== null) failInput();
        const receiptFile = await readPromotionFile(receiptPath, OUTPUT_LIMIT, deps);
        let receiptValue;
        try { receiptValue = JSON.parse(decodeUtf8(receiptFile.bytes)); } catch { failInput(); }
        const receipt = promotionReceipt(receiptValue, row.aid);
        const manifestRow = inspected.manifest.blocks[row.aid];
        if (manifestRow === undefined) failInput();
        if (receipt.baseHash === manifestRow.hash) current.push(receipt);
        else stale += 1;
      }
      if (current.length === 0) throw new ConnectError("no-current");
      if (current.length > PROMOTION_HISTORY_LIMIT) throw new ConnectError("too-many");
      const transformed = deps.createPromotionFn({ html, manifest: inspected.manifest, history, receipts: current }, { nowMs: deps.nowFn() });
      if (
        transformed === null || typeof transformed !== "object" ||
        typeof transformed.html !== "string" || !Buffer.isBuffer(transformed.manifestBytes) || !Buffer.isBuffer(transformed.historyBytes) ||
        transformed.promoted !== current.length
      ) failInput();
      const stagingPath = `${outputPath}${PROMOTION_STAGING_SUFFIX}`;
      await deps.mkdirFn(stagingPath, { recursive: false, mode: 0o700 });
      const stagingStat = await deps.lstatFn(stagingPath);
      if (!validDirectoryStat(stagingStat) || stagingStat.isSymbolicLink?.() === true) failInput();
      cleanup.push({ path: stagingPath, identity: stagingStat, recursive: true });
      await writePromotionFile(join(stagingPath, "index.html"), Buffer.from(transformed.html, "utf8"), deps);
      await writePromotionFile(join(stagingPath, "document.edit.json"), transformed.manifestBytes, deps);
      await writePromotionFile(join(stagingPath, "history.json"), transformed.historyBytes, deps);
      await syncPromotionDirectory(stagingPath, deps);
      if (!(await missingPromotionPath(outputPath, deps.lstatFn))) failInput();
      await deps.renameFn(stagingPath, outputPath);
      cleanup.splice(cleanup.findIndex((item) => item.path === stagingPath), 1);
      await syncPromotionDirectory(outputParent, deps);
      outcome = { output: outputPath, siteId: parsed.site, promoted: current.length, stale };
    } catch (error) {
      outcome = error instanceof ConnectError && PROMOTION_ERROR_TAGS.has(error.tag)
        ? error
        : new ConnectError("promotion", error);
    } finally {
      const survivors = [];
      for (const item of [...cleanup].reverse()) {
        try {
          if (item.recursive === true) {
            const current = await deps.lstatFn(item.path);
            if (current.dev !== item.identity.dev || current.ino !== item.identity.ino) throw new Error("promotion identity changed");
            await deps.rmFn(item.path, { recursive: true, force: false });
          } else {
            await removePromotionOwned(item, deps);
          }
        } catch {
          if (!(await missingPromotionPath(item.path, deps.lstatFn).catch(() => false))) survivors.push(item.path);
        }
      }
      if (survivors.length > 0) outcome = new ConnectError("promotion-cleanup", survivors.sort()[0]);
    }
    if (outcome instanceof ConnectError) throw outcome;
    return { output: outcome.output, siteId: outcome.siteId, promoted: outcome.promoted, stale: outcome.stale };
  };
}

export async function main(argv = process.argv.slice(2)) {
  let promotionMode;
  try {
    promotionMode = Array.isArray(argv) && argv[0] === "promote";
  } catch {
    process.stderr.write("connect: invalid arguments\n");
    process.exitCode = 2;
    return;
  }
  if (promotionMode) {
    let parsedPromotion;
    try {
      parsedPromotion = parsePromoteArgs(argv.slice(1));
    } catch {
      process.stderr.write("connect: invalid promotion arguments\n");
      process.exitCode = 2;
      return;
    }
    if (parsedPromotion.help === true) {
      process.stdout.write(PROMOTE_USAGE);
      process.exitCode = 0;
      return;
    }
    try {
      const result = await createPromotionRunner()(parsedPromotion);
      const output = promotionShellPath(result.output);
      process.stdout.write(
        `Promoted ${result.promoted} current overlays; skipped ${result.stale} stale overlays.\n` +
        `Wrote reviewable Mode A bundle to ${output}.\n` +
        "Review index.html, document.edit.json, and history.json before reconnecting.\n" +
        `Reconnect with: node scripts/connect.mjs --file ${promotionShellPath(join(result.output, "index.html"))} --manifest ${promotionShellPath(join(result.output, "document.edit.json"))} --history ${promotionShellPath(join(result.output, "history.json"))} --owner <owner-email> --site ${result.siteId}\n`,
      );
      process.exitCode = 0;
    } catch (error) {
      if (error?.tag === "history-lock") process.stderr.write("connect: another promotion owns this history\n");
      else if (error?.tag === "output-lock") process.stderr.write("connect: another promotion owns this output\n");
      else if (error?.tag === "no-current") process.stderr.write("connect: no current overlays to promote\n");
      else if (error?.tag === "too-many") process.stderr.write("connect: promotion contains more than 12 current overlays\n");
      else if (error?.tag === "history-collision") process.stderr.write("connect: promotion history identifier collision\n");
      else if (error?.tag === "promotion-cleanup") process.stderr.write(`connect: promotion cleanup failed; inspect ${promotionShellPath(error.detail)}\n`);
      else process.stderr.write("connect: promotion failed\n");
      process.exitCode = 1;
    }
    return;
  }
  let parsed;
  try {
    parsed = parseConnectArgs(argv);
  } catch {
    process.stderr.write("connect: invalid arguments\n");
    process.exitCode = 2;
    return;
  }
  if (parsed.help === true) {
    process.stdout.write(USAGE);
    process.exitCode = 0;
    return;
  }
  try {
    const result = await createConnectRunner()(parsed);
    process.stdout.write(`Connected document ${result.docId} with owner ${result.owner} at ${result.url}.\n${RECEIPT_WARNINGS}`);
    process.exitCode = 0;
  } catch (error) {
    if (error?.tag === "cleanup") process.stderr.write(`connect: cleanup failed; remove ${error.detail}\n`);
    else if (error?.tag === "new-site") process.stderr.write(`connect: setup failed; inspect Netlify site name ${error.detail}\n`);
    else process.stderr.write("connect: setup failed\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
