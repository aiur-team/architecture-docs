import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  realpath,
  open,
  mkdtemp,
  mkdir,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
  "node scripts/connect.mjs --file <html> --manifest <edit.json> --history <history.json> --owner <email> --name <new-site-name>\n" +
  "node scripts/connect.mjs --file <html> --manifest <edit.json> --history <history.json> --owner <email> --site <site-id>\n" +
  "node scripts/connect.mjs --help\n";
const RECEIPT_WARNINGS =
  "Whoever can deploy this file decides who owns it.\n" +
  "WARNING: In standalone mode, an editor can change the live document without review.\n" +
  "WARNING: Export is the only path back to a reviewable artifact.\n" +
  "WARNING: A Netlify account with site access outranks the document owner.\n";
const INVALID_ARGUMENTS = Symbol("invalid arguments");
const INVALID_INPUT = Symbol("invalid input");
const HTML_LIMIT = 10 * 1024 * 1024;
const SIDECAR_LIMIT = 1024 * 1024;
const COPY_FILE_LIMIT = 10 * 1024 * 1024;
const COPY_TOTAL_LIMIT = 64 * 1024 * 1024;
const OUTPUT_LIMIT = 65_536;
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
    values.size !== 5 ||
    !values.has("--file") ||
    !values.has("--manifest") ||
    !values.has("--history") ||
    !values.has("--owner") ||
    values.has("--name") === values.has("--site")
  ) {
    throw INVALID_ARGUMENTS;
  }
  return {
    file: values.get("--file"),
    manifest: values.get("--manifest"),
    history: values.get("--history"),
    owner: values.get("--owner"),
    name: values.get("--name") ?? null,
    site: values.get("--site") ?? null,
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
    !/^[0-9a-f]{7}$/.test(value.commit) ||
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
    html.slice(script.start, script.end) !== '<script type="application/json" id="doc-history">' ||
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
  for (const key of ["file", "manifest", "history", "owner"]) if (typeof parsed[key] !== "string" || parsed[key].length === 0) failInput();
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

async function supervise(spawnFn, executable, args, options, timeoutMs, timers, afterSpawn) {
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
      if (stdoutBytes > OUTPUT_LIMIT || stderrBytes > OUTPUT_LIMIT) terminate(new ConnectError("setup"));
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
      const historyPath = resolve(workingDirectory, parsed.history);
      if (new Set([filePath, manifestPath, historyPath]).size !== 3) failInput();
      const [htmlFile, manifestFile, historyFile] = await Promise.all([
        readStable(filePath, HTML_LIMIT, deps),
        readStable(manifestPath, SIDECAR_LIMIT, deps),
        readStable(historyPath, SIDECAR_LIMIT, deps),
      ]);
      const identities = new Set([htmlFile, manifestFile, historyFile].map((file) => `${file.stat.dev}:${file.stat.ino}`));
      if (identities.size !== 3) failInput();
      const html = decodeUtf8(htmlFile.bytes);
      const manifestText = decodeUtf8(manifestFile.bytes);
      const historyText = decodeUtf8(historyFile.bytes);
      let manifestValue;
      let historyValue;
      try {
        manifestValue = JSON.parse(manifestText);
        historyValue = JSON.parse(historyText);
      } catch {
        failInput();
      }
      const inspected = assertModeManifestTokens(manifestValue, html, tokenizeHtml(html));
      const canonicalManifest = `${JSON.stringify(inspected.manifest, null, 2)}\n`;
      if (manifestText !== canonicalManifest) failInput();
      const history = validHistory(historyValue);
      if (historyText !== `${JSON.stringify(history, null, 2)}\n` || history.doc !== inspected.manifest.instance || history.head !== inspected.manifest.commit) failInput();
      assertEmbeddedHistory(html, history, inspected.historyScript);
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

export async function main(argv = process.argv.slice(2)) {
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
