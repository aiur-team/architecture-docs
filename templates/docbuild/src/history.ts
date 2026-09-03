/**
 * Document history and the committed `history.json` input (P2-E).
 *
 * A repo-backed (Mode B) document refreshes its canonical history from a
 * complete, explicitly public-approved local Git checkout and renders a
 * changelog as an ordinary generated section. Shallow, Git-absent, failed,
 * Netlify, and unapproved builds deterministically consume the same committed
 * history through the read-only fallback, so artifacts never depend on the
 * deploy host's Git state.
 *
 * The `BuildError` value import forms an ESM cycle with `index.ts`. That is
 * safe here because nothing reads the live binding during module
 * initialisation — only the guarded `changelogSection()` path touches it.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { BuildError, parseSection, type Section } from "./index.js";

export interface HistoryChange {
  file: string;
  id: string;
  add: number;
  del: number;
  patch: string;
  clipped: boolean;
}

export interface HistoryVersion {
  sha: string;
  date: string;
  author: string;
  subject: string;
  url: string;
  changed: HistoryChange[];
}

export interface History {
  doc: string;
  head: string;
  versions: HistoryVersion[];
}

/** Newest-first rows retained in the page. */
const HISTORY_LIMIT = 12;
/** UTF-8 byte cap for one persisted diff body. */
const PATCH_CAP = 1200;
/** Whole embedded escaped-payload cap, in bytes. */
const HISTORY_BUDGET = 16 * 1024;

/** Sole Git spawn seam. Production never mutates or exports it. */
const historyProcess = { spawn: spawnSync };

/**
 * Atomic filesystem seam for `history.json`. `refresh()` routes every read and
 * every step of its temporary-file transaction through this object so an
 * isolated compiled copy can inject deterministic failures for testing.
 */
const historyIO = {
  lstat: lstatSync,
  read: readFileSync,
  open: openSync,
  write: writeFileSync,
  sync: fsyncSync,
  close: closeSync,
  replace: renameSync,
  remove: unlinkSync,
};

const LOWER_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SAFE_HTML_RE = /^[a-z0-9][a-z0-9._-]*\.html$/;
const SHA7_RE = /^[0-9a-f]{7}$/;
const FULL_SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const CANONICAL_UTC_RE =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/commit\/([0-9a-f]{40}|[0-9a-f]{64})$/;

/** JavaScript code-unit ordering; never locale-dependent. */
function codeUnitCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize a filesystem path for display, `/` separated, cwd-relative when inside cwd. */
function normalizeDisplay(path: string): string {
  const rel = relative(process.cwd(), path);
  if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return rel.split(sep).join("/");
  }
  return resolve(path).split(sep).join("/");
}

/** Element-text escaping, in `&`, `<`, `>` order. */
function escText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Attribute escaping: element-text escaping plus `"` and `'`. */
function escAttr(value: string): string {
  return escText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// --------------------------------------------------------------------- git()

function git(cwd: string, args: readonly string[]): string | null {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ]) {
    delete env[name];
  }
  env.LC_ALL = "C";
  env.LANG = "C";
  env.GIT_PAGER = "cat";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  const result = historyProcess.spawn(
    "git",
    [
      "--no-pager",
      "--literal-pathspecs",
      "-c",
      "color.ui=false",
      "-c",
      "core.quotePath=false",
      ...args,
    ],
    {
      cwd,
      env,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error != null || result.signal != null) return null;
  if (result.status !== 0) return null;
  if (typeof result.stdout !== "string") return null;
  return result.stdout;
}

// ------------------------------------------------------------- remote grammar

const REMOTE_TOKEN_RE = /^[A-Za-z0-9_.-]+$/;

/** Parse a closed GitHub remote line into `<owner>/<repo>`, or `null`. */
function remoteSlug(remote: string | null): string | null {
  if (typeof remote !== "string" || remote === "") return null;
  if (remote.includes("\r") || remote.includes("\0")) return null;
  let line = remote;
  if (line.endsWith("\n")) line = line.slice(0, -1);
  if (line === "" || line.includes("\n")) return null;
  if (line !== line.trim()) return null;

  let owner: string | undefined;
  let repo: string | undefined;
  let gitRequired = false;

  const scp = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/.exec(line);
  if (scp) {
    owner = scp[1];
    repo = scp[2];
    gitRequired = true;
  } else {
    const ssh = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/.exec(line);
    if (ssh) {
      owner = ssh[1];
      repo = ssh[2];
      gitRequired = true;
    } else {
      const https = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/.exec(line);
      if (https) {
        owner = https[1];
        repo = https[2];
        gitRequired = false;
      } else {
        return null;
      }
    }
  }
  if (owner === undefined || repo === undefined) return null;
  if (!REMOTE_TOKEN_RE.test(owner) || !REMOTE_TOKEN_RE.test(repo)) return null;
  const hadGit = repo.endsWith(".git");
  if (gitRequired && !hadGit) return null;
  if (hadGit) repo = repo.slice(0, -4);
  if (repo === "" || repo === "." || repo === "..") return null;
  if (owner === "." || owner === "..") return null;
  return `${owner}/${repo}`;
}

function commitUrl(remote: string | null, fullSha: string): string {
  const slug = remoteSlug(remote);
  if (slug === null) return "";
  if (!FULL_SHA_RE.test(fullSha)) return "";
  const url = `https://github.com/${slug}/commit/${fullSha}`;
  const match = URL_RE.exec(url);
  if (match === null) return "";
  if (match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") return "";
  return url;
}

// -------------------------------------------------------------- parse_diff()

function validTuple(tuple: readonly [string, string, string]): boolean {
  if (tuple === null || tuple === undefined) return false;
  if (typeof tuple !== "object") return false;
  if (tuple.length !== 3) return false;
  for (const member of tuple) {
    if (typeof member !== "string" || member === "") return false;
    if (member.includes("\\") || member.includes("\0")) return false;
    if (member.startsWith("/")) return false;
    const components = member.split("/");
    for (const component of components) {
      if (component === "" || component === "." || component === "..") return false;
    }
  }
  const suffixes: Array<[string, string]> = [
    ["sections", "/sections"],
    ["doc.json", "/doc.json"],
    ["extra.css", "/extra.css"],
  ];
  const prefixes: string[] = [];
  for (let index = 0; index < 3; index++) {
    const member = tuple[index] as string;
    const [root, suffix] = suffixes[index] as [string, string];
    let prefix: string;
    if (member === root) {
      prefix = "";
    } else if (member.endsWith(suffix)) {
      prefix = member.slice(0, member.length - suffix.length);
      if (prefix === "") return false;
    } else {
      return false;
    }
    prefixes.push(prefix);
  }
  return prefixes[0] === prefixes[1] && prefixes[1] === prefixes[2];
}

/** Scan a quoted git token and return its raw interior (escapes preserved). */
function scanQuoted(value: string, start: number): { raw: string; end: number } | null {
  if (value[start] !== '"') return null;
  let index = start + 1;
  while (index < value.length) {
    const ch = value[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === '"') return { raw: value.slice(start + 1, index), end: index + 1 };
    index++;
  }
  return null;
}

const SIMPLE_ESCAPES: Record<string, number> = {
  "\\": 0x5c,
  '"': 0x22,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
};

/** Decode a quoted git token into its decoded path string, or `null`. */
function decodeQuoted(raw: string): string | null {
  const bytes: number[] = [];
  let index = 0;
  while (index < raw.length) {
    const ch = raw[index] as string;
    if (ch !== "\\") {
      for (const byte of Buffer.from(ch, "utf8")) bytes.push(byte);
      index++;
      continue;
    }
    index++;
    if (index >= raw.length) return null;
    const escape = raw[index] as string;
    if (escape in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[escape] as number);
      index++;
      continue;
    }
    if (/^[0-7]$/.test(escape)) {
      let value = Number(escape);
      let cursor = index + 1;
      while (cursor < raw.length && cursor - index < 3 && /^[0-7]$/.test(raw[cursor] as string)) {
        value = value * 8 + Number(raw[cursor]);
        cursor++;
      }
      if (value > 0xff) return null;
      bytes.push(value);
      index = cursor;
      continue;
    }
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

type ParsedHeader = { aPath: string; bPath: string } | null;

/** Parse one `diff --git` header line into its decoded a/ path and b/ remainder. */
function parseHeaderLine(line: string): ParsedHeader {
  if (!line.startsWith("diff --git ")) return null;
  const rest = line.slice("diff --git ".length);
  if (rest === "") return null;

  if (rest.startsWith('"')) {
    const first = scanQuoted(rest, 0);
    if (first === null) return null;
    if (rest[first.end] !== " " || rest[first.end + 1] !== '"') return null;
    const second = scanQuoted(rest, first.end + 1);
    if (second === null) return null;
    if (second.end !== rest.length) return null;
    const aRaw = decodeQuoted(first.raw);
    const bRaw = decodeQuoted(second.raw);
    if (aRaw === null || bRaw === null) return null;
    if (!aRaw.startsWith("a/") || !bRaw.startsWith("b/")) return null;
    return { aPath: aRaw, bPath: bRaw.slice(2) };
  }

  // Unquoted form: `a/<a> b/<b>` with no ASCII whitespace in either operand.
  const match = /^a\/([^\s]+) b\/([^\s]+)$/.exec(rest);
  if (match === null) return null;
  return { aPath: `a/${match[1]}`, bPath: match[2]! };
}

/** Resolve an owned basename for a decoded `b/` path, or `null`. */
function ownedBasename(bPath: string, tuple: readonly [string, string, string]): string | null {
  if (bPath === tuple[1]) return "doc.json";
  if (bPath === tuple[2]) return "extra.css";
  const slash = bPath.lastIndexOf("/");
  const parent = slash === -1 ? "" : bPath.slice(0, slash);
  const base = slash === -1 ? bPath : bPath.slice(slash + 1);
  if (parent === tuple[0] && SAFE_HTML_RE.test(base)) return base;
  return null;
}

function isMetaLine(line: string): boolean {
  const prefixes = [
    "index ",
    "new file mode ",
    "deleted file mode ",
    "old mode ",
    "new mode ",
    "similarity index ",
    "dissimilarity index ",
    "--- ",
    "+++ ",
    "Binary files ",
    "GIT binary patch",
  ];
  for (const prefix of prefixes) {
    if (line.startsWith(prefix)) return true;
  }
  return false;
}

function clipPatch(patch: string): string {
  if (Buffer.byteLength(patch, "utf8") <= PATCH_CAP) return patch;
  let out = "";
  let bytes = 0;
  for (const ch of patch) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > PATCH_CAP) break;
    out += ch;
    bytes += size;
  }
  if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

interface ParsedFile {
  file: string;
  lines: string[];
  inHunk: boolean;
}

function buildChange(cur: ParsedFile, ids: ReadonlyMap<string, string>): HistoryChange {
  const body = cur.lines.join("\n");
  let add = 0;
  let del = 0;
  for (const line of cur.lines) {
    if (line.startsWith("+")) add++;
    else if (line.startsWith("-")) del++;
  }
  const clipped = Buffer.byteLength(body, "utf8") > PATCH_CAP;
  const stem = cur.file.replace(/\.[^.]*$/, "");
  const id = ids.get(cur.file) ?? stem;
  return { file: cur.file, id, add, del, patch: clipPatch(body), clipped };
}

function parse_diff(
  text: string,
  pathspecs: readonly [sections: string, doc: string, css: string],
  ids: ReadonlyMap<string, string>,
): HistoryChange[] {
  if (!validTuple(pathspecs)) return [];
  if (text === "") return [];
  if (text.includes("\0") || text.includes("\r")) return [];
  let lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines = lines.slice(0, -1);
  for (const line of lines) {
    if (line === "") return [];
  }

  const accepted: HistoryChange[] = [];
  const seen = new Set<string>();
  let cur: ParsedFile | null = null;

  const finalize = (): void => {
    if (cur === null) return;
    accepted.push(buildChange(cur, ids));
    cur = null;
  };

  for (const line of lines) {
    const header = parseHeaderLine(line);
    if (header !== null) {
      finalize();
      const file = ownedBasename(header.bPath, pathspecs);
      if (file === null) return [];
      if (seen.has(file)) return [];
      seen.add(file);
      cur = { file, lines: [], inHunk: false };
      continue;
    }
    if (cur === null) return [];
    if (!cur.inHunk) {
      if (isMetaLine(line)) continue;
      if (line.startsWith("@@")) {
        cur.inHunk = true;
        cur.lines.push(line);
        continue;
      }
      return [];
    }
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("@@") || line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
      cur.lines.push(line);
      continue;
    }
    return [];
  }
  finalize();
  return accepted;
}

// ----------------------------------------------------------------- history()

function parseLogOut(text: string): Array<[string, string, string, string, string]> | null {
  if (text.includes("\r")) return null;
  const parts = text.split("\0");
  if (parts[parts.length - 1] !== "") return null;
  parts.pop();
  if (parts.length === 0 || parts.length % 5 !== 0) return null;
  const rows: Array<[string, string, string, string, string]> = [];
  for (let index = 0; index < parts.length; index += 5) {
    const sha = parts[index] as string;
    const parents = parts[index + 1] as string;
    const authorDate = parts[index + 2] as string;
    const author = parts[index + 3] as string;
    const subject = parts[index + 4] as string;
    if (!FULL_SHA_RE.test(sha)) return null;
    if (parents !== "") {
      if (parents.includes("\t") || parents.startsWith(" ") || parents.endsWith(" ")) return null;
      const list = parents.split(" ");
      for (const parent of list) {
        if (!FULL_SHA_RE.test(parent) || parent.length !== sha.length) return null;
      }
    }
    if (author === "" || subject === "" || authorDate === "") return null;
    rows.push([sha, parents, authorDate, author, subject]);
  }
  return rows;
}

/** Canonicalize a git author date to UTC milliseconds, or `null`. */
function canonicalDate(authorDate: string): string | null {
  const milliseconds = Date.parse(authorDate);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  if (!CANONICAL_UTC_RE.test(canonical)) return null;
  return canonical;
}

// ------------------------------------------------------- schema validation

const ROOT_KEYS = 'expected exactly keys "doc", "head", "versions"';
const VERSION_KEYS = 'expected exactly keys "sha", "date", "author", "subject", "url", "changed"';
const CHANGE_KEYS = 'expected exactly keys "file", "id", "add", "del", "patch", "clipped"';

function keySetEquals(object: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(object).sort().join(",");
  return actual === [...expected].sort().join(",");
}

/**
 * Validate a complete closed `History` and rebuild it in declared key order.
 * `fail(path, expectation)` throws the stable BuildError diagnostic.
 */
function validateHistory(
  raw: unknown,
  docName: string,
  fail: (path: string, expectation: string) => never,
): History {
  if (!isObject(raw)) fail("$", ROOT_KEYS);
  const root = raw as Record<string, unknown>;
  if (!keySetEquals(root, ["doc", "head", "versions"])) fail("$", ROOT_KEYS);

  const docValue = root.doc;
  if (typeof docValue !== "string" || !LOWER_ID_RE.test(docValue) || docValue !== docName) {
    fail("$.doc", "expected the current instance basename");
  }
  const headValue = root.head;
  if (typeof headValue !== "string" || !SHA7_RE.test(headValue)) {
    fail("$.head", "expected seven lowercase hexadecimal characters");
  }
  const versionsValue = root.versions;
  if (
    !Array.isArray(versionsValue) ||
    versionsValue.length < 1 ||
    versionsValue.length > HISTORY_LIMIT
  ) {
    fail("$.versions", "expected an array with 1 to 12 items");
  }

  const versions: HistoryVersion[] = [];
  const seenShas = new Set<string>();
  versionsValue.forEach((versionValue, versionIndex) => {
    const versionPath = `$.versions[${versionIndex}]`;
    if (!isObject(versionValue)) fail(versionPath, VERSION_KEYS);
    const version = versionValue as Record<string, unknown>;
    if (!keySetEquals(version, ["sha", "date", "author", "subject", "url", "changed"])) {
      fail(versionPath, VERSION_KEYS);
    }

    const sha = version.sha;
    if (typeof sha !== "string" || !SHA7_RE.test(sha)) {
      fail(`${versionPath}.sha`, "expected seven lowercase hexadecimal characters");
    }
    if (seenShas.has(sha)) {
      fail("$.versions", "expected unique values");
    }
    seenShas.add(sha);
    const date = version.date;
    if (
      typeof date !== "string" ||
      !CANONICAL_UTC_RE.test(date) ||
      new Date(Date.parse(date)).toISOString() !== date
    ) {
      fail(`${versionPath}.date`, "expected a canonical UTC timestamp");
    }
    const author = version.author;
    if (typeof author !== "string" || author === "") {
      fail(`${versionPath}.author`, "expected a non-empty string");
    }
    const subject = version.subject;
    if (typeof subject !== "string" || subject === "") {
      fail(`${versionPath}.subject`, "expected a non-empty string");
    }
    const url = version.url;
    if (typeof url !== "string") {
      fail(`${versionPath}.url`, "expected an empty string or a safe GitHub commit URL");
    }
    if (url !== "") {
      const match = URL_RE.exec(url);
      if (
        match === null ||
        match[1] === "." ||
        match[1] === ".." ||
        match[2] === "." ||
        match[2] === ".." ||
        !match[3]!.startsWith(sha)
      ) {
        fail(`${versionPath}.url`, "expected an empty string or a safe GitHub commit URL");
      }
    }

    const changedValue = version.changed;
    if (!Array.isArray(changedValue)) {
      fail(`${versionPath}.changed`, "expected an array");
    }
    const changed: HistoryChange[] = [];
    changedValue.forEach((changeValue, changeIndex) => {
      const changePath = `${versionPath}.changed[${changeIndex}]`;
      if (!isObject(changeValue)) fail(changePath, CHANGE_KEYS);
      const change = changeValue as Record<string, unknown>;
      if (!keySetEquals(change, ["file", "id", "add", "del", "patch", "clipped"])) {
        fail(changePath, CHANGE_KEYS);
      }
      const file = change.file;
      if (typeof file !== "string" || (file !== "doc.json" && file !== "extra.css" && !SAFE_HTML_RE.test(file))) {
        fail(`${changePath}.file`, "expected doc.json, extra.css, or a safe lowercase HTML basename");
      }
      const id = change.id;
      if (typeof id !== "string" || !LOWER_ID_RE.test(id)) {
        fail(`${changePath}.id`, "expected a lowercase history identifier");
      }
      if (file === "doc.json" && id !== "doc") {
        fail(`${changePath}.id`, "expected the identifier implied by file");
      }
      if (file === "extra.css" && id !== "extra") {
        fail(`${changePath}.id`, "expected the identifier implied by file");
      }
      const add = change.add;
      if (typeof add !== "number" || !Number.isSafeInteger(add) || add < 0) {
        fail(`${changePath}.add`, "expected a non-negative safe integer");
      }
      const del = change.del;
      if (typeof del !== "number" || !Number.isSafeInteger(del) || del < 0) {
        fail(`${changePath}.del`, "expected a non-negative safe integer");
      }
      const patch = change.patch;
      if (typeof patch !== "string" || !canonicalPatch(patch)) {
        fail(
          `${changePath}.patch`,
          "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes",
        );
      }
      const clipped = change.clipped;
      if (typeof clipped !== "boolean") {
        fail(`${changePath}.clipped`, "expected a boolean");
      }
      changed.push({ file, id, add, del, patch, clipped });
    });
    for (let index = 1; index < changed.length; index++) {
      if (codeUnitCompare(changed[index - 1]!.file, changed[index]!.file) >= 0) {
        fail(`${versionPath}.changed`, "expected strictly increasing file order");
      }
    }
    versions.push({ sha, date, author, subject, url, changed });
  });

  if (headValue !== versions[0]!.sha) {
    fail("$.head", "expected newest version to match head");
  }
  return { doc: docName, head: headValue, versions };
}

/** The closed persisted diff-line grammar for a committed patch string. */
function canonicalPatch(patch: unknown): boolean {
  if (typeof patch !== "string") return false;
  if (patch === "") return true;
  if (Buffer.byteLength(patch, "utf8") > PATCH_CAP) return false;
  if (patch.includes("\r")) return false;
  if (patch.endsWith("\n")) return false;
  const lines = patch.split("\n");
  if (lines.length === 0 || !lines[0]!.startsWith("@")) return false;
  for (const line of lines) {
    if (!line.startsWith("@") && !line.startsWith(" ") && !line.startsWith("+") && !line.startsWith("-")) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ history()

/**
 * Refresh a repo-backed instance's history from an approved local Git checkout.
 * Returns the complete fresh value, or `null` for any incomplete attempt.
 * Never reads or writes an existing `history.json`.
 */
function history(inst: string): History | null {
  if (typeof inst !== "string" || inst === "") return null;
  let lexicalInst: string;
  try {
    lexicalInst = resolve(process.cwd(), inst);
    const lexicalStat = lstatSync(lexicalInst);
    if (!lexicalStat.isDirectory() || lexicalStat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  let realInst: string;
  try {
    realInst = realpathSync(lexicalInst);
  } catch {
    return null;
  }
  const instanceName = basename(realInst);
  if (!LOWER_ID_RE.test(instanceName)) return null;

  const topLevel = git(realInst, ["rev-parse", "--show-toplevel"]);
  if (topLevel === null || topLevel === "") return null;
  const topLine = topLevel.endsWith("\n") ? topLevel.slice(0, -1) : topLevel;
  if (
    topLine === "" ||
    topLine.includes("\r") ||
    topLine.includes("\0") ||
    topLine.includes("\n") ||
    topLine !== topLine.trim() ||
    !isAbsolute(topLine)
  ) {
    return null;
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(topLine);
    if (!lstatSync(realRoot).isDirectory()) return null;
  } catch {
    return null;
  }

  const relativeRoot = relative(realRoot, realInst);
  const contained =
    relativeRoot === "" ||
    (relativeRoot !== ".." &&
      !isAbsolute(relativeRoot) &&
      !relativeRoot.startsWith(`..${sep}`));
  if (!contained) return null;

  const tuple: [string, string, string] =
    relativeRoot === ""
      ? ["sections", "doc.json", "extra.css"]
      : [
          `${relativeRoot.split(sep).join("/")}/sections`,
          `${relativeRoot.split(sep).join("/")}/doc.json`,
          `${relativeRoot.split(sep).join("/")}/extra.css`,
        ];

  const shallow = git(realRoot, ["rev-parse", "--is-shallow-repository"]);
  if (shallow !== "false" && shallow !== "false\n") return null;

  const remoteText = git(realRoot, ["remote", "get-url", "origin"]);
  const slug = remoteSlug(remoteText);
  const approved = process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED;
  if (slug === null || approved !== slug) return null;

  // Discover current sections.
  const sectionMap = new Map<string, string>();
  try {
    const sectionsDir = join(realInst, "sections");
    const dirStat = lstatSync(sectionsDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return null;
    const entries = readdirSync(sectionsDir, { withFileTypes: true });
    entries.sort((a, b) => codeUnitCompare(a.name, b.name));
    for (const entry of entries) {
      if (!SAFE_HTML_RE.test(entry.name)) continue;
      if (!entry.isFile()) return null;
      const path = join(sectionsDir, entry.name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const section = parseSection(path);
      if (!LOWER_ID_RE.test(section.id)) return null;
      if (section.file !== entry.name) return null;
      if (sectionMap.has(entry.name)) return null;
      const id = section.id;
      for (const existing of sectionMap.values()) {
        if (existing === id) return null;
      }
      sectionMap.set(entry.name, id);
    }
  } catch {
    return null;
  }

  const logText = git(realRoot, [
    "log",
    "-z",
    "--first-parent",
    `--max-count=${HISTORY_LIMIT}`,
    "--format=%H%x00%P%x00%aI%x00%an%x00%s",
    "HEAD",
    "--",
    ...tuple,
  ]);
  if (logText === null) return null;
  const rows = parseLogOut(logText);
  if (rows === null) return null;

  const built: HistoryVersion[] = [];
  for (const [fullSha, parents, authorDate, author, subject] of rows) {
    const date = canonicalDate(authorDate);
    if (date === null) return null;
    let firstParent: string | null = null;
    if (parents !== "") {
      const first = parents.split(" ")[0];
      if (first === undefined) return null;
      firstParent = first;
    }
    const diffArgs: string[] = firstParent === null
      ? [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          "--patch",
          "--unified=2",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--diff-algorithm=myers",
          "--no-indent-heuristic",
          fullSha,
          "--",
          ...tuple,
        ]
      : [
          "diff",
          "--patch",
          "--unified=2",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--diff-algorithm=myers",
          "--no-indent-heuristic",
          firstParent,
          fullSha,
          "--",
          ...tuple,
        ];
    const diffText = git(realRoot, diffArgs);
    if (diffText === null) return null;
    let changed: HistoryChange[];
    if (diffText === "") {
      changed = [];
    } else {
      const parsed = parse_diff(diffText, tuple, sectionMap);
      if (parsed.length === 0) return null;
      changed = parsed;
    }
    changed.sort((a, b) => codeUnitCompare(a.file, b.file));
    const url = commitUrl(remoteText, fullSha);
    built.push({
      sha: fullSha.slice(0, 7),
      date,
      author,
      subject,
      url,
      changed,
    });
  }

  const short = new Set<string>();
  for (const version of built) {
    if (short.has(version.sha)) return null;
    short.add(version.sha);
  }
  if (built.length === 0) return null;
  const candidate: History = { doc: instanceName, head: built[0]!.sha, versions: built };
  try {
    return validateHistory(candidate, instanceName, () => {
      throw new Error("generated history invalid");
    });
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- trim()

function measureHistory(h: History): number {
  return Buffer.byteLength(JSON.stringify(h).split("</").join("<\\/"), "utf8");
}

/**
 * Drop old diff bodies oldest-first until the whole payload fits. Returns the
 * number of bodies dropped and never removes the newest version's patch.
 */
function trim(h: History): number {
  let count = 0;
  for (;;) {
    if (measureHistory(h) <= HISTORY_BUDGET) return count;
    let dropped = false;
    for (let versionIndex = h.versions.length - 1; versionIndex >= 1; versionIndex--) {
      const changed = h.versions[versionIndex]!.changed;
      for (let changeIndex = 0; changeIndex < changed.length; changeIndex++) {
        const change = changed[changeIndex]!;
        if (change.patch !== "") {
          change.patch = "";
          change.clipped = true;
          count++;
          dropped = true;
          break;
        }
      }
      if (dropped) break;
    }
    if (!dropped) {
      throw new BuildError(
        "history: embedded history exceeds 16384 bytes after dropping every old diff body",
      );
    }
  }
}

// ----------------------------------------------------------------- refresh()

function failCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && code !== "" ? code : "UNKNOWN";
}

/** Whether the exact committed path exists as a regular non-symlink file. */
function checkTarget(display: string, path: string): boolean {
  try {
    const stat = historyIO.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new BuildError(`${display}: history.json is not a regular non-symbolic-link file`);
    }
    return true;
  } catch (error) {
    if (error instanceof BuildError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new BuildError(`${display}: cannot read history.json (${failCode(error)})`);
  }
}

function readTarget(display: string, path: string): string {
  try {
    const bytes = historyIO.read(path);
    if (typeof bytes === "string") return bytes;
    return bytes.toString("utf8");
  } catch (error) {
    throw new BuildError(`${display}: cannot read history.json (${failCode(error)})`);
  }
}

const parseCommitted = (display: string, text: string, docName: string): History => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BuildError(`${display}: invalid JSON`);
  }
  const canonical = validateHistory(parsed, docName, (path, expectation) => {
    throw new BuildError(`${display}: invalid history at ${path}: ${expectation}`);
  });
  if (text !== `${JSON.stringify(canonical, null, 2)}\n`) {
    throw new BuildError(`${display}: history.json is not canonical`);
  }
  const escaped = JSON.stringify(canonical).split("</").join("<\\/");
  const bytes = Buffer.byteLength(escaped, "utf8");
  if (bytes > HISTORY_BUDGET) {
    throw new BuildError(`${display}: embedded history is ${bytes} bytes; maximum is 16384`);
  }
  return canonical;
};

export function refresh(inst: string): History | null {
  if (typeof inst !== "string" || inst.length === 0) {
    throw new BuildError("history: expected a non-empty instance path");
  }
  const lexicalInst = resolve(process.cwd(), inst);
  const instanceName = basename(lexicalInst);
  const lexicalFile = join(lexicalInst, "history.json");

  if (process.env.NETLIFY === "true") {
    const display = normalizeDisplay(lexicalFile);
    const present = checkTarget(display, lexicalFile);
    if (!present) {
      console.log("  history          SKIPPED refresh on Netlify; no committed history.json");
      return null;
    }
    const text = readTarget(display, lexicalFile);
    const value = parseCommitted(display, text, instanceName);
    console.log(`  history          SKIPPED refresh on Netlify; using ${display}`);
    return value;
  }

  const fresh = history(inst);
  if (fresh === null) {
    const display = normalizeDisplay(lexicalFile);
    const present = checkTarget(display, lexicalFile);
    if (!present) {
      console.log(
        "  history          SKIPPED git unavailable or incomplete; no committed history.json",
      );
      return null;
    }
    const text = readTarget(display, lexicalFile);
    const value = parseCommitted(display, text, instanceName);
    console.log(`  history          SKIPPED git unavailable or incomplete; using ${display}`);
    return value;
  }

  // Successful fresh generation: trim, compare, and atomically replace.
  const display = normalizeDisplay(lexicalFile);
  let dropped = 0;
  try {
    dropped = trim(fresh);
  } catch {
    throw new BuildError(
      "history: embedded history exceeds 16384 bytes after dropping every old diff body",
    );
  }
  const serialized = Buffer.from(`${JSON.stringify(fresh, null, 2)}\n`);
  const trimMessage = `  history trim     dropped ${dropped} old diff bodies`;

  let realInst: string;
  try {
    const stat = lstatSync(lexicalInst);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    realInst = realpathSync(lexicalInst);
  } catch {
    return null;
  }
  const target = join(realInst, "history.json");
  const present = checkTarget(display, target);
  if (present) {
    const existing = readTarget(display, target);
    if (existing === serialized.toString("utf8")) {
      console.log(`  history          UNCHANGED ${display}`);
      return fresh;
    }
  }

  const temp = join(
    dirname(target),
    `history.json.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  let fd: number | undefined;
  let tempCreated = false;
  try {
    try {
      fd = historyIO.open(temp, "wx", 0o644);
    } catch (error) {
      throw new BuildError(
        `${display}: cannot create temporary history.json (${failCode(error)})`,
      );
    }
    tempCreated = true;
    try {
      historyIO.write(fd, serialized);
    } catch (error) {
      throw new BuildError(
        `${display}: cannot write temporary history.json (${failCode(error)})`,
      );
    }
    try {
      historyIO.sync(fd);
    } catch (error) {
      throw new BuildError(
        `${display}: cannot sync temporary history.json (${failCode(error)})`,
      );
    }
    try {
      historyIO.close(fd);
    } catch (error) {
      throw new BuildError(
        `${display}: cannot close temporary history.json (${failCode(error)})`,
      );
    }
    fd = undefined;
    try {
      historyIO.replace(temp, target);
    } catch (error) {
      throw new BuildError(`${display}: cannot replace history.json (${failCode(error)})`);
    }
    tempCreated = false;
    if (dropped > 0) console.log(trimMessage);
    console.log(`  history          WROTE ${display}`);
    return fresh;
  } catch (primary) {
    if (fd !== undefined) {
      try {
        historyIO.close(fd);
      } catch {
        // cleanup must not mask the primary error
      }
    }
    if (tempCreated) {
      try {
        historyIO.remove(temp);
      } catch {
        // cleanup must not mask the primary error
      }
    }
    throw primary;
  }
}

// ---------------------------------------------------------- changelogSection()

export function changelogSection(
  h: History,
  labels: Array<[string, string]>,
): Section {
  const seen = new Set<string>();
  for (const [id] of labels) {
    if (id === "changelog") {
      throw new BuildError('history: source section id "changelog" is reserved');
    }
    if (seen.has(id)) {
      throw new BuildError(`history: duplicate source section id "${id}"`);
    }
    seen.add(id);
  }
  const labelOf = new Map(labels);

  const labelFor = (change: HistoryChange): string => {
    const label = labelOf.get(change.id);
    return label ?? change.file;
  };
  const linkFor = (change: HistoryChange): string => {
    if (labelOf.has(change.id)) {
      return `<a href="#${escAttr(change.id)}">${escText(labelOf.get(change.id) as string)}</a>`;
    }
    return escText(change.file);
  };

  const count = h.versions.length;
  const summary = `${count} ${count === 1 ? "version" : "versions"}. Latest: ${escText(h.versions[0]!.subject)}.`;

  const peekRows = h.versions
    .slice(0, 3)
    .map(
      (version) =>
        `<tr><td><code>${escText(version.sha)}</code></td><td>${version.date.slice(0, 10)}</td><td>${escText(version.subject)}</td></tr>`,
    )
    .join("");
  const peek =
    '<table class="tbl"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody>' +
    peekRows +
    "</tbody></table>";

  const body = h.versions
    .map((version) => {
      const touched =
        version.changed.length === 0
          ? "&mdash;"
          : version.changed.map(linkFor).join(", ");
      const commit =
        version.url === ""
          ? ""
          : ` &middot; <a href="${escAttr(version.url)}">commit on GitHub</a>`;
      const patches = version.changed
        .map((change) => {
          const tail = change.clipped ? "\n[diff clipped]" : "";
          const stat = `<span class="dx-stat">+${change.add} &minus;${change.del}</span>`;
          return `<h4>${escText(labelFor(change))}  ${stat}</h4><pre class="diff">${escText(change.patch + tail)}</pre>`;
        })
        .join("");
      return (
        `<details class="dx" data-sha="${escAttr(version.sha)}">` +
        `<summary><code>${escText(version.sha)}</code> &nbsp;${escText(version.subject)} ` +
        `<span class="dx-meta">${escText(version.author)} &middot; ${version.date.slice(0, 10)}</span></summary>` +
        `<div class="dxb"><p>Changed: ${touched}${commit}</p>${patches}</div></details>`
      );
    })
    .join("");

  return {
    id: "changelog",
    label: "Changelog",
    nav: "Changes",
    summary,
    peek,
    body,
    file: "history.json",
  };
}
