/**
 * Node-facing anchoring pass.
 *
 * Reads `<inst>/anchors.json` (ENOENT = first build), validates every current
 * section and every prior anchor, aligns old and new normalised block texts,
 * runs one document-wide exact move pass, mints deterministic collision-free
 * ids, injects ` data-aid="…"` into each nonempty scanned block of every
 * `Section.body`, and atomically rewrites the anchor file. Only `Section.body`
 * is mutated, and only after the new state has been durably written.
 *
 * The scanner and normaliser live in `anchor-core.ts`; everything Node-only
 * (fs, path, crypto) stays in this module so the core can be inlined into the
 * page and shared with browser consumers.
 */

import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";

import { BuildError } from "./index.js";
import type { Section } from "./index.js";
import { norm, scanBlocks } from "./anchor-core.js";

const SECTION_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const AID = /^a[0-9a-f]{8}$/;

const fail = (message: string): never => {
  throw new BuildError(message);
};

/**
 * The two fallible atomic-write steps are routed through these handles so the
 * failure-path unit tests can force a filesystem code without monkeypatching
 * the `node:fs` module (whose ESM namespace is a fixed snapshot). Production
 * behaviour is the default binding below.
 */
interface AtomicWrite {
  writeFileSync(path: string, data: string): void;
  renameSync(oldPath: string, newPath: string): void;
}

let atomicWrite: AtomicWrite;
const realFs: AtomicWrite = {
  writeFileSync: (p, data) => writeFileSync(p, data, "utf8"),
  renameSync,
};
atomicWrite = realFs;

/** Test-only seam. Unprovided steps fall back to the real fs. */
export function _setAtomicWrite(next: Partial<AtomicWrite>): void {
  atomicWrite = {
    writeFileSync: next.writeFileSync ?? realFs.writeFileSync,
    renameSync: next.renameSync ?? realFs.renameSync,
  };
}

/** `errno` code from an OS error, or `UNKNOWN` when absent. */
function codeOf(err: unknown): string {
  const c = (err as NodeJS.ErrnoException).code;
  return typeof c === "string" && c !== "" ? c : "UNKNOWN";
}

/** The `<anchors>` label used in every anchor-state error message. */
function anchorLabel(inst: string): string {
  const p = relative(process.cwd(), join(inst, "anchors.json")).split("\\").join("/");
  return p === "" ? "anchors.json" : p;
}

// ------------------------------------------------------------------ validation

interface PriorEntry {
  ids: string[];
  texts: string[];
}

type PriorState = Map<string, PriorEntry>;

function validatePrior(raw: string, label: string): PriorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(`${label}: invalid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(`${label}: expected a JSON object`);
  }
  const state = new Map<string, PriorEntry>();
  const seenAids = new Set<string>();
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (!SECTION_ID.test(key)) {
      return fail(
        `${label}: invalid section id "${key}"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`,
      );
    }
    const value = (parsed as Record<string, unknown>)[key];
    const sectionLabel = `${label}: section "${key}"`;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "ids,texts"
    ) {
      return fail(`${sectionLabel} must contain exactly "ids" and "texts"`);
    }
    const { ids, texts } = value as { ids: unknown; texts: unknown };
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
      return fail(`${sectionLabel}.ids must be an array of strings`);
    }
    if (!Array.isArray(texts) || !texts.every((x) => typeof x === "string")) {
      return fail(`${sectionLabel}.texts must be an array of strings`);
    }
    if (ids.length !== texts.length) {
      return fail(`${sectionLabel} has different ids/texts lengths`);
    }
    const idsArr = ids as string[];
    const textsArr = texts as string[];
    for (let idx = 0; idx < idsArr.length; idx++) {
      const aid = idsArr[idx]!;
      if (!AID.test(aid)) return fail(`${sectionLabel} has invalid aid at ids[${idx}]`);
      if (seenAids.has(aid)) return fail(`${label}: duplicate aid "${aid}"`);
      seenAids.add(aid);
    }
    for (let idx = 0; idx < textsArr.length; idx++) {
      const text = textsArr[idx]!;
      if (text === "" || text !== norm(text)) {
        return fail(`${sectionLabel} has invalid normalized text at texts[${idx}]`);
      }
    }
    state.set(key, { ids: idsArr, texts: textsArr });
  }
  return state;
}

/** Validate the current section ids before any alignment work happens. */
function validateCurrentIds(sections: Section[]): void {
  const seen = new Set<string>();
  for (const s of sections) {
    if (!SECTION_ID.test(s.id)) {
      return fail(
        `${s.file}: invalid section id "${s.id}"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`,
      );
    }
    if (seen.has(s.id)) return fail(`${s.file}: duplicate section id "${s.id}"`);
    seen.add(s.id);
  }
}

/** True when a complete candidate start tag already carries a `data-aid`. */
function hasSourceAid(tagRaw: string): boolean {
  const isWs = (c: string | undefined): boolean =>
    c !== undefined && /[ \t\n\r\f\v]/.test(c);
  const n = tagRaw.length;
  let k = 1; // skip "<"
  while (k < n && /[A-Za-z0-9-]/.test(tagRaw[k]!)) k++;
  for (;;) {
    while (k < n && isWs(tagRaw[k])) k++;
    const c = tagRaw[k];
    if (c === undefined || c === ">" || c === "/") return false;
    const nameStart = k;
    while (
      k < n &&
      !isWs(tagRaw[k]) &&
      tagRaw[k] !== "=" &&
      tagRaw[k] !== ">" &&
      tagRaw[k] !== "/"
    ) {
      k++;
    }
    if (tagRaw.slice(nameStart, k).toLowerCase() === "data-aid") return true;
    while (k < n && isWs(tagRaw[k])) k++;
    if (tagRaw[k] === "=") {
      k++;
      while (k < n && isWs(tagRaw[k])) k++;
      const q = tagRaw[k];
      if (q === '"' || q === "'") {
        const close = tagRaw.indexOf(q, k + 1);
        if (close === -1) return false;
        k = close + 1;
      } else {
        while (k < n && !isWs(tagRaw[k]) && tagRaw[k] !== ">") k++;
      }
    }
  }
}

// ------------------------------------------------------------------ alignment

type Opcode = readonly [
  tag: "equal" | "replace" | "delete" | "insert",
  i1: number,
  i2: number,
  j1: number,
  j2: number,
];

/** Ratcliff/Obershelp matching without junk or autojunk heuristics. */
function findLongestMatch(
  a: string[],
  b: string[],
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): [number, number, number] {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i++) {
    const newj2len = new Map<number, number>();
    const ai = a[i]!;
    for (let j = blo; j < bhi; j++) {
      if (ai === b[j]) {
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = newj2len;
  }
  return [besti, bestj, bestsize];
}

function matchingBlocks(a: string[], b: string[]): Array<[number, number, number]> {
  const la = a.length;
  const lb = b.length;
  const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
  const blocks: Array<[number, number, number]> = [];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, size] = findLongestMatch(a, b, alo, ahi, blo, bhi);
    if (size > 0) {
      blocks.push([i, j, size]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + size < ahi && j + size < bhi) {
        queue.push([i + size, ahi, j + size, bhi]);
      }
    }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const merged: Array<[number, number, number]> = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last[0] + last[2] === block[0] &&
      last[1] + last[2] === block[1]
    ) {
      last[2] += block[2];
    } else {
      merged.push([block[0], block[1], block[2]]);
    }
  }
  merged.push([la, lb, 0]);
  return merged;
}

function opcodes(a: string[], b: string[]): Opcode[] {
  const out: Opcode[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj, size] of matchingBlocks(a, b)) {
    if (i < ai && j < bj) out.push(["replace", i, ai, j, bj]);
    else if (i < ai) out.push(["delete", i, ai, j, j]);
    else if (j < bj) out.push(["insert", i, i, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size > 0) out.push(["equal", ai, i, bj, j]);
  }
  return out;
}

/** Ratcliff/Obershelp similarity in [0, 1]; two empties score 1. */
function similarity(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  if (ca.length === 0 && cb.length === 0) return 1;
  let matched = 0;
  for (const [, , size] of matchingBlocks(ca, cb)) matched += size;
  return (2 * matched) / (ca.length + cb.length);
}

const EDITED_FLOOR = 0.6;

// ---------------------------------------------------------------- id minting

const minted = (text: string, attempt: number): string => {
  const salt = attempt === 0 ? text : `${text}\u0000${attempt}`;
  return `a${createHash("sha1").update(salt, "utf8").digest("hex").slice(0, 8)}`;
};

// -------------------------------------------------------------------- report

interface Counts {
  equal: number;
  edited: number;
  moved: number;
}

function reportLine(id: string, c: Counts, orphaned: number): string {
  return `    ${id}: ${c.equal} equal, ${c.edited} edited, ${c.moved} moved, ${orphaned} ORPHANED`;
}

// --------------------------------------------------------------------- pass

interface Local {
  id: string;
  file: string;
  blocks: ReturnType<typeof scanBlocks>;
  aids: Array<string | null>;
  counts: Counts;
}

export function anchorSections(
  inst: string,
  sections: Section[],
): { report: string[]; orphans: Array<[string, string]> } {
  const label = anchorLabel(inst);
  const anchorsPath = join(inst, "anchors.json");

  // 1. Read the committed anchor state; ENOENT means a first build.
  let raw: string | null = null;
  try {
    raw = readFileSync(anchorsPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") raw = null;
    else return fail(`${label}: read failed (${codeOf(e)})`);
  }
  const prior: PriorState = raw === null ? new Map() : validatePrior(raw, label);

  // 2. Validate every current section and scan every body before any change.
  validateCurrentIds(sections);
  const locals: Local[] = [];
  const currentIds = new Set<string>();
  for (const s of sections) {
    currentIds.add(s.id);
    let blocks: ReturnType<typeof scanBlocks>;
    try {
      blocks = scanBlocks(s.body);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("anchor scan at ")) {
        return fail(`${s.file}: ${e.message}`);
      }
      throw e;
    }
    for (const block of blocks) {
      if (hasSourceAid(s.body.slice(block.openStart, block.openEnd))) {
        return fail(
          `${s.file}: anchor scan at ${block.openStart}: source data-aid attribute is not allowed`,
        );
      }
    }
    locals.push({
      id: s.id,
      file: s.file,
      blocks,
      aids: blocks.map(() => null),
      counts: { equal: 0, edited: 0, moved: 0 },
    });
  }

  // 3. Align each current section against its prior entry.
  const used = new Set<string>();
  for (const local of locals) {
    const old = prior.get(local.id);
    const oldTexts = old?.texts ?? [];
    const oldAids = old?.ids ?? [];
    const newTexts = local.blocks.map((b) => b.text);
    for (const [tag, i1, i2, j1, j2] of opcodes(oldTexts, newTexts)) {
      if (tag === "equal") {
        for (let k = 0; k < i2 - i1; k++) {
          const aid = oldAids[i1 + k]!;
          local.aids[j1 + k] = aid;
          used.add(aid);
          local.counts.equal++;
        }
      } else if (tag === "replace") {
        const pairs = Math.min(i2 - i1, j2 - j1);
        for (let k = 0; k < pairs; k++) {
          if (similarity(oldTexts[i1 + k]!, newTexts[j1 + k]!) >= EDITED_FLOOR) {
            const aid = oldAids[i1 + k]!;
            local.aids[j1 + k] = aid;
            used.add(aid);
            local.counts.edited++;
          }
        }
        // Extra old blocks orphan; extra new blocks stay unclaimed.
      }
      // `delete` makes every old block an orphan candidate; `insert` leaves
      // every new block unclaimed. Both fall through to the move pass below.
    }
  }

  // 4. One document-wide exact move pass over still-orphaned old blocks and
  //    still-unclaimed new blocks.
  const orphanByText = new Map<string, Array<{ aid: string; text: string }>>();
  for (const [, entry] of prior) {
    for (let idx = 0; idx < entry.ids.length; idx++) {
      const aid = entry.ids[idx]!;
      if (!used.has(aid)) {
        const text = entry.texts[idx]!;
        const list = orphanByText.get(text);
        if (list === undefined) orphanByText.set(text, [{ aid, text }]);
        else list.push({ aid, text });
      }
    }
  }
  const unclaimedByText = new Map<
    string,
    Array<{ local: Local; index: number }>
  >();
  for (const local of locals) {
    for (let idx = 0; idx < local.aids.length; idx++) {
      if (local.aids[idx] === null) {
        const text = local.blocks[idx]!.text;
        const list = unclaimedByText.get(text);
        const item = { local, index: idx };
        if (list === undefined) unclaimedByText.set(text, [item]);
        else list.push(item);
      }
    }
  }
  for (const [text, candidates] of orphanByText) {
    const targets = unclaimedByText.get(text);
    if (candidates.length === 1 && targets !== undefined && targets.length === 1) {
      const candidate = candidates[0]!;
      const target = targets[0]!;
      target.local.aids[target.index] = candidate.aid;
      used.add(candidate.aid);
      target.local.counts.moved++;
    }
    // Duplicates on either side stay ambiguous: nothing is reclaimed.
  }

  // 5. Mint ids for every still-unclaimed new block, reserving every prior id.
  const reserved = new Set<string>();
  for (const [, entry] of prior) for (const aid of entry.ids) reserved.add(aid);
  for (const local of locals) {
    for (let idx = 0; idx < local.aids.length; idx++) {
      if (local.aids[idx] !== null) continue;
      const text = local.blocks[idx]!.text;
      let attempt = 0;
      let aid = minted(text, attempt);
      while (reserved.has(aid)) {
        attempt++;
        aid = minted(text, attempt);
      }
      reserved.add(aid);
      local.aids[idx] = aid;
    }
  }

  // Order the survivors: ids left orphaned after the move pass.
  const orphanCount = new Map<string, number>();
  const orphans: Array<[string, string]> = [];
  for (const [sid, entry] of prior) {
    for (const aid of entry.ids) {
      if (!used.has(aid)) {
        orphanCount.set(sid, (orphanCount.get(sid) ?? 0) + 1);
        orphans.push([sid, aid]);
      }
    }
  }

  // 6. Build every replacement body by inserting each aid before the final `>`.
  const replacements: Array<{ index: number; body: string }> = [];
  for (let sc = 0; sc < locals.length; sc++) {
    const local = locals[sc]!;
    const inserts: Array<{ at: number; attr: string }> = [];
    for (let idx = 0; idx < local.blocks.length; idx++) {
      const block = local.blocks[idx]!;
      inserts.push({
        at: block.openEnd - 1,
        attr: ` data-aid="${local.aids[idx]}"`,
      });
    }
    inserts.sort((x, y) => y.at - x.at);
    let body = sections[sc]!.body;
    for (const insert of inserts) {
      body = body.slice(0, insert.at) + insert.attr + body.slice(insert.at);
    }
    replacements.push({ index: sc, body });
  }

  // 7. Serialize the new state and write it atomically next to the old file.
  const state: Record<string, { ids: string[]; texts: string[] }> = {};
  for (const local of locals) {
    const ids: string[] = [];
    const texts: string[] = [];
    for (let idx = 0; idx < local.blocks.length; idx++) {
      const block = local.blocks[idx]!;
      const aid = local.aids[idx];
      if (aid === null || aid === undefined) {
        // Every block must have an id by now; reaching here is a defect.
        return fail(`${local.file}: block failed to receive an aid`);
      }
      ids.push(aid);
      texts.push(block.text);
    }
    state[local.id] = { ids, texts };
  }
  const serialized = `${JSON.stringify(state, null, 2)}\n`;

  const dir = dirname(anchorsPath);
  const tempPath = join(dir, "anchors.json.tmp");
  try {
    atomicWrite.writeFileSync(tempPath, serialized);
  } catch (e) {
    const code = codeOf(e);
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup must not hide the original BuildError.
    }
    return fail(`${label}: temporary write failed (${code})`);
  }
  try {
    atomicWrite.renameSync(tempPath, anchorsPath);
  } catch (e) {
    const code = codeOf(e);
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup must not hide the original BuildError.
    }
    return fail(`${label}: replace failed (${code})`);
  }

  // 8. Only after the new state is durably committed, mutate the supplied
  //    sections. Source files and all other Section fields stay untouched.
  for (const replacement of replacements) {
    sections[replacement.index]!.body = replacement.body;
  }

  // Report: one line per current section, then removed prior sections that
  // still own at least one orphan, in prior JSON key order.
  const report: string[] = [];
  for (const local of locals) {
    const orphaned = orphanCount.get(local.id) ?? 0;
    report.push(reportLine(local.id, local.counts, orphaned));
  }
  for (const [sid] of prior) {
    if (currentIds.has(sid)) continue;
    const orphaned = orphanCount.get(sid) ?? 0;
    if (orphaned > 0) report.push(reportLine(sid, { equal: 0, edited: 0, moved: 0 }, orphaned));
  }

  return { report, orphans };
}
