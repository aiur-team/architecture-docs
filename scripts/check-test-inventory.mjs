#!/usr/bin/env node
/**
 * Prove that every test file in this repository is named by CI.
 *
 * `.github/workflows/check.yml` names its test files literally rather than
 * globbing them, and says so in its own comment: `node --test` treats an
 * unmatched pattern as a glob matching nothing and exits 0, so a literal path
 * is the only spelling that fails loudly when a file stops being emitted. The
 * cost of that choice is a list a human has to remember to extend, and the
 * instruction "Add new test files to this list" was then missed three times in
 * a row — `scripts/test-p4-a.mjs`, `scripts/test-p4-b.mjs` and
 * `scripts/test-p4-t.mjs` all landed as permanent regression runners that
 * nothing ever ran (#107).
 *
 * This check is the enforcement the list was missing. It walks the repository
 * for test files, derives what the workflow must say about each one, and fails
 * when a file exists on disk that the workflow does not mention. The list stays
 * literal, and forgetting to extend it stops being a silent no-op.
 *
 * The `templates/docbuild` tests are TypeScript sources compiled before they
 * run, so the source file on disk is checked against its compiled `dist`
 * counterpart — the path the workflow actually executes.
 *
 * Comment lines are stripped before the search: a test file named only in prose
 * is exactly the situation this check exists to catch, and the header comment
 * above the `unit tests` step names files itself.
 *
 * Output contract: one `PASS` line on stdout and exit 0, or one
 * `FAIL test inventory:` line per unwired file on stderr and exit 1.
 *
 *   node scripts/check-test-inventory.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, derived from this file's own location. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const WORKFLOW = ".github/workflows/check.yml";

/**
 * A repository path is a test file when it is a `*.test.*` module or one of the
 * `scripts/test-*.mjs` standalone regression runners.
 */
function isTestFile(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.endsWith(".d.ts")) return false;
  if (path.startsWith("scripts/") && name.startsWith("test-") && name.endsWith(".mjs")) return true;
  return /\.test\.(mjs|js|ts)$/.test(name);
}

/**
 * The path the workflow must name for a given source file. A docbuild test is
 * compiled before CI runs it, so the executed path is its `dist` twin; a
 * `dist` test is skipped because its `src` original already stands for it.
 */
function executedPath(path) {
  if (path.startsWith("templates/docbuild/dist/")) return null;
  if (path.startsWith("templates/docbuild/src/")) {
    return path.replace("/src/", "/dist/").replace(/\.ts$/, ".js");
  }
  return path;
}

/**
 * Every tracked test file, in sorted order. Tracked files are the honest
 * definition of what this repository owns: it keeps an installed dependency, a
 * build artifact and a stray scratch file out of the inventory without a
 * hand-maintained exclusion list that would itself go stale.
 */
function trackedTestFiles() {
  return execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => path !== "" && isTestFile(path))
    .sort();
}

/** The workflow with its comment lines removed, so prose cannot satisfy it. */
function workflowInstructions() {
  return readFileSync(join(ROOT, WORKFLOW), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function main() {
  const instructions = workflowInstructions();
  const failures = [];
  let wired = 0;

  const tests = trackedTestFiles();
  /* An inventory that finds no tests would report that every test is wired,
     which is the one answer this check must never invent for itself. */
  if (tests.length === 0) {
    process.stderr.write("FAIL test inventory: no tracked test files found\n");
    return 1;
  }

  for (const path of tests) {
    const executed = executedPath(path);
    if (executed === null) continue;
    if (instructions.includes(executed)) {
      wired += 1;
      continue;
    }
    const via = executed === path ? "" : ` (as ${executed})`;
    failures.push(`${path} is not named by ${WORKFLOW}${via}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL test inventory: ${failure}\n`);
    process.stderr.write(`FAIL test inventory: add each file above to a run step in ${WORKFLOW}\n`);
    return 1;
  }

  process.stdout.write(`PASS test inventory: ${wired} test files are named by CI\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  /* An unreadable workflow or an unavailable `git` is still a failure of this
     gate, reported in the same one-line vocabulary rather than as a stack. */
  process.stderr.write(`FAIL test inventory: ${error.message.split("\n")[0]}\n`);
  process.exitCode = 1;
}
