/**
 * Editable-block marking and the edit manifest.
 *
 * P2-D fills P1-B's hook with the round-trip admission gate: only source-body
 * `p`, `h2`, `h3` and `h4` elements that carry exactly one P1-D `data-aid`,
 * occupy whole lines, carry no authored attribute, contain no nested block and
 * survive the exact HTML-to-text-to-HTML round trip become editable. Accepted
 * blocks get a ` data-editable` (and conditional ` data-md`) attribute on their
 * in-memory `Section.body` opening tag, and the builder persists a
 * deterministic edit manifest keyed by aid at
 * `<inst>/dist/<basename(inst)>.edit.json`.
 *
 * P1-D's `scanBlocks()` is the only block scanner. This module never redefines
 * a block grammar, never changes aids, and only narrows editability. The
 * manifest is representation, not authorization: it maps an `aid` to its source
 * path and authoritative inner-HTML SHA-256 so later write paths can fail
 * closed. It carries no owner, editor, clock, ordinal, or version field.
 */

import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";

import { BuildError } from "./index.js";
import type { Doc, Section } from "./index.js";
import { scanBlocks } from "./anchor-core.js";
import type { BlockTag } from "./anchor-core.js";
import { toHtml, toMd } from "./inline_md.js";

/** `EditableTag` is the closed set of block tags this pass may mark. */
export type EditableTag = "p" | "h2" | "h3" | "h4";

/** One accepted block, keyed downstream by its aid. */
export interface ManifestRow {
  readonly aid: string;
  readonly file: string;
  readonly section: string;
  readonly tag: EditableTag;
  readonly hash: string;
}

const SOURCE_FILE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$/;
const INSTANCE_NAME = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const DOC_ID = /^[0-9a-f]{6}$/;
const AID = /^a[0-9a-f]{8}$/;
const EDITABLE: ReadonlySet<BlockTag> = new Set<BlockTag>(["p", "h2", "h3", "h4"]);
const INLINE_TAGS = ["code", "strong", "em"] as const;

const fail = (message: string): never => {
  throw new BuildError(message);
};

const isWs = (c: string | undefined): boolean =>
  c !== undefined && /[ \t\n\r\f\v]/.test(c);

/**
 * Parse the attributes of an opening-tag string that begins at `<` and ends at
 * its closing `>`. Quotes are honoured so `title="data-aid"` is not an aid
 * token. Returns name/value pairs in source order; whitespace around `=` and
 * around names is not an attribute.
 */
function readTagAttributes(raw: string): Array<{ name: string; value: string | null }> {
  const attrs: Array<{ name: string; value: string | null }> = [];
  const n = raw.length;
  let k = 1;
  while (k < n && /[A-Za-z0-9-]/.test(raw[k]!)) k++;
  for (;;) {
    while (k < n && isWs(raw[k])) k++;
    if (k >= n || raw[k] === ">" || raw[k] === "/") return attrs;
    const nameStart = k;
    while (
      k < n &&
      !isWs(raw[k]) &&
      raw[k] !== "=" &&
      raw[k] !== ">" &&
      raw[k] !== "/"
    ) {
      k++;
    }
    const name = raw.slice(nameStart, k);
    while (k < n && isWs(raw[k])) k++;
    let value: string | null = null;
    if (raw[k] === "=") {
      k++;
      while (k < n && isWs(raw[k])) k++;
      const quote = raw[k];
      if (quote === '"' || quote === "'") {
        const close = raw.indexOf(quote, k + 1);
        value = close === -1 ? raw.slice(k + 1) : raw.slice(k + 1, close);
        k = close === -1 ? n : close + 1;
      } else {
        const valueStart = k;
        while (k < n && !isWs(raw[k]) && raw[k] !== ">") k++;
        value = raw.slice(valueStart, k);
      }
    }
    attrs.push({ name, value });
  }
}

/** True when the element starts and ends on lines it owns (space/tab only). */
function occupiesWholeLine(body: string, openStart: number, closeEnd: number): boolean {
  const before = body.lastIndexOf("\n", openStart - 1);
  const lineStart = before === -1 ? 0 : before + 1;
  for (let i = lineStart; i < openStart; i++) {
    const c = body[i];
    if (c !== " " && c !== "\t") return false;
  }
  const after = body.indexOf("\n", closeEnd);
  const lineEnd = after === -1 ? body.length : after;
  for (let i = closeEnd; i < lineEnd; i++) {
    const c = body[i];
    if (c !== " " && c !== "\t") return false;
  }
  return true;
}

/**
 * True when `inner` contains at least one exact, successfully paired
 * `<code>`, `<strong>` or `<em>` sequence (checked in that order): an opening
 * token counts only when its exact closing token occurs later.
 */
function hasInlineMark(inner: string): boolean {
  for (const tag of INLINE_TAGS) {
    const open = `<${tag}>`;
    const at = inner.indexOf(open);
    if (at !== -1 && inner.indexOf(`</${tag}>`, at + open.length) !== -1) return true;
  }
  return false;
}

/** Attribute-escape `md` in the exact order `&`, `"`, `<`, `>`. */
function escapeAttribute(md: string): string {
  let out = md.split("&").join("&amp;");
  out = out.split('"').join("&quot;");
  out = out.split("<").join("&lt;");
  out = out.split(">").join("&gt;");
  return out;
}

/**
 * Apply every recorded opening-tag insertion from highest UTF-16 offset to
 * lowest so earlier offsets stay valid.
 */
function replaceBody(body: string, inserts: Array<{ at: number; text: string }>): string {
  const sorted = [...inserts].sort((x, y) => y.at - x.at);
  let out = body;
  for (const insert of sorted) {
    out = out.slice(0, insert.at) + insert.text + out.slice(insert.at);
  }
  return out;
}

/**
 * Open an operation-owned sibling temporary path with `"wx"`/`0o644`, retrying
 * only an `EEXIST` collision on a fresh distinct candidate, at most 16 total.
 * A colliding path that this operation did not open is never unlinked; a
 * non-`EEXIST` failure, or the sixteenth `EEXIST`, is final.
 */
function openTemp(distDir: string, base: string): { fd: number; path: string } {
  for (let attempt = 0; attempt < 16; attempt++) {
    const candidate = join(distDir, `.${base}.tmp-${attempt}`);
    try {
      const fd = openSync(candidate, "wx", 0o644);
      return { fd, path: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt === 15) throw error;
    }
  }
  throw new BuildError(`${distDir}: could not open a temporary file`);
}

/**
 * Atomically write `serialized` to `<distDir>/<basename>.edit.json`. A final
 * failure preserves any existing target, leaves section objects untouched, and
 * best-effort removes only the temporary file this operation opened; cleanup
 * errors never mask the primary error.
 */
function writeManifest(manifestPath: string, distDir: string, serialized: string): void {
  const wrap = (error: unknown): BuildError =>
    new BuildError(`${manifestPath}: ${(error as Error).message}`);

  try {
    mkdirSync(distDir, { recursive: true });
  } catch (error) {
    throw wrap(error);
  }

  const bytes = Buffer.from(serialized, "utf8");
  let fd: number | null = null;
  let tempPath: string | null = null;
  let opened = false;
  try {
    const temp = openTemp(distDir, basename(manifestPath));
    fd = temp.fd;
    tempPath = temp.path;
    opened = true;
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written === 0) fail(`${manifestPath}: writeSync made no progress`);
      offset += written;
    }
    fsyncSync(fd);
    closeSync(fd);
    opened = false;
    renameSync(tempPath, manifestPath);
  } catch (error) {
    // Best-effort cleanup never masks the primary error and never touches a
    // temporary file this operation did not open.
    if (opened && fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Cleanup failure is secondary.
      }
    }
    if (tempPath !== null) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Cleanup failure is secondary.
      }
    }
    if (error instanceof BuildError) throw error;
    throw wrap(error);
  }
}

interface Candidate {
  aid: string;
  file: string;
  section: string;
  tag: EditableTag;
  hash: string;
  index: number;
  at: number;
  mdAttr: string;
}

/**
 * Mark losslessly editable source paragraphs and body headings, and persist the
 * edit manifest. `sections` is the complete post-history, post-anchor array.
 * Returns manifest rows in `sections` order and then opening-tag order.
 */
export function markEditable(sections: Section[], doc: Doc, inst: string): ManifestRow[] {
  const docId = doc.get("id");
  if (docId === undefined || !DOC_ID.test(docId)) {
    fail(`${inst}/doc.json: missing or invalid 'id' (expected six lowercase hexadecimal characters)`);
  }
  const instance = basename(inst);
  if (!INSTANCE_NAME.test(instance)) {
    fail(`${inst}: invalid instance basename (expected ^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$)`);
  }
  const commit = process.env.COMMIT_REF ?? "";

  // 1. Source-section membership: only names matching the ASCII source grammar
  //    are ever joined or inspected; a matching name must be an existing
  //    regular file. ENOENT and non-regular entries (directory, FIFO, symlink)
  //    mean generated/read-only; any other inspection error is a BuildError.
  const sourceAt = new Map<number, string>();
  for (let index = 0; index < sections.length; index++) {
    const file = sections[index]!.file;
    if (!SOURCE_FILE.test(file)) continue;
    const sourcePath = join(inst, "sections", file);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(sourcePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw new BuildError(`${sourcePath}: ${(error as Error).message}`);
    }
    if (!stat.isFile()) continue;
    sourceAt.set(index, sourcePath);
  }

  // 2. Scan every source body once, validate aids and global aid uniqueness
  //    (including read-only tags), and apply the editable policy in memory.
  const candidates: Candidate[] = [];
  const insertsByIndex = new Map<number, Array<{ at: number; text: string }>>();
  const seen = new Set<string>();
  for (const index of [...sourceAt.keys()].sort((a, b) => a - b)) {
    const section = sections[index]!;
    const fileLabel = `sections/${section.file}`;
    let blocks: ReturnType<typeof scanBlocks>;
    try {
      blocks = scanBlocks(section.body);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("anchor scan at ")) {
        fail(`${fileLabel}: ${error.message}`);
      }
      throw error;
    }
    const inserts: Array<{ at: number; text: string }> = [];
    for (const block of blocks) {
      const openRaw = section.body.slice(block.openStart, block.openEnd);
      const attrs = readTagAttributes(openRaw);
      const aids = attrs.filter((a) => a.name.toLowerCase() === "data-aid");
      if (aids.length !== 1 || aids[0]!.value === null || !AID.test(aids[0]!.value)) {
        fail(
          `${fileLabel}: scanned ${block.tag} at offset ${block.openStart} ` +
            `requires exactly one data-aid matching ^a[0-9a-f]{8}$`,
        );
      }
      const aid = aids[0]!.value!;
      if (seen.has(aid)) fail(`${fileLabel}: duplicate data-aid '${aid}'`);
      seen.add(aid);

      // Only p/h2/h3/h4 may become editable; every other aid stays read-only.
      if (!EDITABLE.has(block.tag)) continue;

      // Every attribute besides the one generated aid demotes the block.
      if (attrs.length !== 1) continue;

      // The element must occupy whole lines on its own.
      if (!occupiesWholeLine(section.body, block.openStart, block.closeEnd)) continue;

      const inner = section.body.slice(block.innerStart, block.innerEnd);
      let nested: ReturnType<typeof scanBlocks>;
      try {
        nested = scanBlocks(inner);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("anchor scan at ")) {
          fail(`${fileLabel}: ${error.message}`);
        }
        throw error;
      }
      // Any nested block (from the full shared BLOCK set) demotes the outer.
      if (nested.length > 0) continue;

      const md = toMd(inner);
      if (toHtml(md) !== inner) continue;

      const hash = createHash("sha256").update(inner, "utf8").digest("hex");
      const mdAttr = hasInlineMark(inner) ? ` data-md="${escapeAttribute(md)}"` : "";
      inserts.push({
        at: block.openEnd - 1,
        text: ` data-editable${mdAttr}`,
      });
      candidates.push({
        aid,
        file: fileLabel,
        section: section.id,
        tag: block.tag as EditableTag,
        hash,
        index,
        at: block.openEnd - 1,
        mdAttr,
      });
    }
    if (inserts.length > 0) insertsByIndex.set(index, inserts);
  }

  // 3. Compute the replacement bodies and serialized manifest in memory.
  const blocksRecord: Record<
    string,
    { file: string; section: string; tag: EditableTag; hash: string }
  > = {};
  for (const candidate of candidates) {
    blocksRecord[candidate.aid] = {
      file: candidate.file,
      section: candidate.section,
      tag: candidate.tag,
      hash: candidate.hash,
    };
  }
  const manifest = { docId, instance, commit, blocks: blocksRecord };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const replacementBodies = new Map<number, string>();
  for (const [index, inserts] of insertsByIndex) {
    replacementBodies.set(index, replaceBody(sections[index]!.body, inserts));
  }

  // 4. Write the sidecar atomically; only then mutate the supplied bodies.
  const manifestPath = join(inst, "dist", `${instance}.edit.json`);
  writeManifest(manifestPath, join(inst, "dist"), serialized);
  for (const [index, body] of replacementBodies) {
    sections[index]!.body = body;
  }

  return candidates.map(({ aid, file, section, tag, hash }) => ({
    aid,
    file,
    section,
    tag,
    hash,
  }));
}
