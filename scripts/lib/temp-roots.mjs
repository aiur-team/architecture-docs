import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_STALE_ROOT_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RETAINED_EVIDENCE_COUNT = 3;

const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

function missingDuringSweep(error) {
  return error?.code === "ENOENT";
}

export function removeTempRoots(roots) {
  for (const root of [...new Set(roots)].reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
}

export function sweepStaleTempRoots(
  prefixes,
  {
    directory = tmpdir(),
    now = Date.now(),
    maxAgeMs = DEFAULT_STALE_ROOT_AGE_MS,
    excludePrefixes = [],
  } = {},
) {
  const cutoff = now - maxAgeMs;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory()
      || !prefixes.some((prefix) => entry.name.startsWith(prefix))
      || excludePrefixes.some((prefix) => entry.name.startsWith(prefix))
    ) continue;
    const root = join(directory, entry.name);
    try {
      if (statSync(root).mtimeMs < cutoff) rmSync(root, { recursive: true, force: true });
    } catch (error) {
      if (!missingDuringSweep(error)) throw error;
    }
  }
}

export function guardedTempRoot(prefix, { directory = tmpdir() } = {}) {
  const root = mkdtempSync(join(directory, prefix));
  chmodSync(root, 0o700);
  return root;
}

export function installSignalCleanup(roots, { exitAfterCleanup = true } = {}) {
  const handlers = new Map();
  const currentRoots = () => typeof roots === "function" ? roots() : roots;
  const uninstall = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    handlers.clear();
  };

  for (const [signal, number] of Object.entries(SIGNAL_NUMBERS)) {
    const handler = () => {
      try {
        removeTempRoots(currentRoots());
      } catch {
        // The ordinary supervisor failure path reports cleanup failures.
      }
      if (exitAfterCleanup) {
        uninstall();
        process.exit(128 + number);
      }
    };
    handlers.set(signal, handler);
    process.prependListener(signal, handler);
  }
  return uninstall;
}

function capRetainedEvidence(directory, prefix, maxCount, protectedName) {
  const retained = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(directory, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));

  const keep = new Set([
    protectedName,
    ...retained.filter((entry) => entry.name !== protectedName).slice(0, maxCount - 1).map((entry) => entry.name),
  ]);
  for (const entry of retained.filter((candidate) => !keep.has(candidate.name))) {
    rmSync(join(directory, entry.name), { recursive: true, force: true });
    rmSync(join(directory, `${entry.name}.txt`), { force: true });
  }
}

export function retainEvidenceRoot(
  root,
  detail,
  {
    directory = tmpdir(),
    prefix = "runner-evidence-",
    maxCount = DEFAULT_RETAINED_EVIDENCE_COUNT,
  } = {},
) {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1) throw new TypeError("maxCount must be a positive integer");
  const stem = `${prefix}${Date.now()}-${randomBytes(4).toString("hex")}`;
  const retainedRoot = join(directory, stem);
  const locator = join(directory, `${stem}.txt`);
  renameSync(root, retainedRoot);
  chmodSync(retainedRoot, 0o700);
  writeFileSync(locator, `${detail}\n${retainedRoot}\n`, { mode: 0o600 });
  chmodSync(locator, 0o600);
  capRetainedEvidence(directory, prefix, maxCount, stem);
  return { root: retainedRoot, locator };
}
