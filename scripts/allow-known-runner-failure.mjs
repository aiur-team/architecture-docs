#!/usr/bin/env node
/**
 * Run one permanent regression runner, and excuse exactly one known failure in
 * it while the defect that causes it is still in the tree.
 *
 * Wiring the runners into CI (#107) is what found the failures this file names.
 * That is the gate working, not the gate being wrong, so the runner stays wired
 * in and keeps running in full: dropping it, or teaching it to skip a matrix,
 * would trade a red build for no coverage at all. What this wrapper buys is the
 * ability to land the wiring before the defects it exposed are fixed, without
 * the exclusion being silent.
 *
 * Only a runner named in `ALLOWED_RUNNER_FAILURES` may be launched through
 * here. Every other runner is invoked directly in `.github/workflows/check.yml`
 * and is unaffected by this file; passing one to this wrapper fails rather than
 * quietly wrapping it.
 *
 * The allowance is narrow in three directions:
 *
 *   - It names a failure, not a runner. Every `FAIL` line the runner prints
 *     must be the one the entry was granted for, and the excused error text
 *     must be present. A second, unrelated failure still fails CI.
 *   - It is dated and carries the issue that deletes it, and it prints an
 *     `ALLOW` line on every run, so it is visible in the log rather than
 *     inferred from a green check.
 *   - It is decided from the source of the defect, not from whether the runner
 *     happened to fail. These failures are environment-dependent -- the P4-A
 *     browser matrix passes on a developer machine and fails in Actions -- so
 *     keying staleness to the outcome would fail spuriously for whoever runs it
 *     locally. Keying it to the code means the entry stops applying the moment
 *     the fix lands, and this wrapper then fails until the entry is removed.
 *
 * Output contract: the runner's own stdout and stderr, unmodified and in order,
 * plus at most one `ALLOW runner:` line; `FAIL runner:` on stderr and exit 1
 * for a stale entry, an unknown runner, or any failure the entry does not
 * excuse. The runner's exit code is otherwise passed through.
 *
 *   node scripts/allow-known-runner-failure.mjs scripts/test-p4-a.mjs
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, derived from this file's own location. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The known failures this repository currently carries, keyed by the runner
 * that reports them.
 *
 * **This table is empty, and empty is the state to keep it in.** Every runner
 * named in `.github/workflows/check.yml` is invoked directly; nothing goes
 * through this wrapper today, and an entry here is a hole in a gate that someone
 * has to close. The mechanism is kept because the situation it exists for
 * recurs: wiring a runner in finds a defect in already-merged code, and landing
 * the wiring should not have to wait for the fix.
 *
 * The one entry this table has held so far was `scripts/test-p4-a.mjs`, whose
 * `--browser` worker measured the selection tooltip with
 * `[...document.body.children].filter(...).pop()` and called
 * `getBoundingClientRect()` on the result without asserting that it found one.
 * It was granted on 2026-09-04 by #107 (PR #116) and removed by #124, which made
 * the measurement wait for a laid-out host and report the selector when there is
 * none. That is the intended lifetime of an entry here.
 *
 * A new entry needs all six keys the code below reads: `since`, `issue`,
 * `worker`, `whileSourceMatches` (a pattern over the runner's *source*, so the
 * entry goes stale the moment the fix lands rather than when a run happens to
 * pass), `failureLine`, and `excusesErrorMatching`. All six are required: an
 * entry missing one throws where it is read, which fails the build rather than
 * excusing anything, but the message is generic -- so write all six.
 */
const ALLOWED_RUNNER_FAILURES = new Map([]);

/** One-line failure in the same vocabulary as the other gates in CI. */
function refuse(message) {
  process.stderr.write(`FAIL runner: ${message}\n`);
  return 1;
}

/**
 * Whether an allowance still describes the code it was granted for. A stale
 * entry is a hole left open in a gate, so it is checked on every run rather
 * than left to whoever lands the fix to remember.
 */
function allowanceApplies(runner, allowance) {
  try {
    return allowance.whileSourceMatches.test(readFileSync(join(ROOT, runner), "utf8"));
  } catch {
    /* The runner named by an allowance is gone. The entry is stale either way. */
    return false;
  }
}

/**
 * Run the runner, streaming its output through unchanged so CI shows the same
 * log it would without this wrapper, while keeping a copy to match against.
 */
function run(runner) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, runner)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => {
        output += chunk.toString("utf8");
        sink.write(chunk);
      });
    }

    /* A cancelled CI job signals this wrapper; the runner is its own supervisor
       and cleans up its temporary root when it is signalled in turn. */
    const forwarded = [];
    for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      const handler = () => { try { child.kill(name); } catch { /* already gone */ } };
      forwarded.push([name, handler]);
      process.on(name, handler);
    }

    child.on("error", (error) => { output += `spawn failed: ${error.message}\n`; });
    child.on("close", (code, signal) => {
      for (const [name, handler] of forwarded) process.removeListener(name, handler);
      resolve({ code: code !== null ? code : 1, signal, output });
    });
  });
}

async function main() {
  const runner = process.argv[2];
  if (runner === undefined) return refuse("usage: node scripts/allow-known-runner-failure.mjs <runner>");

  const allowance = ALLOWED_RUNNER_FAILURES.get(runner);
  /* Fail closed: this wrapper can only ever be used for a runner whose failure
     someone has already written down here. */
  if (allowance === undefined) {
    return refuse(`${runner} has no ALLOWED_RUNNER_FAILURES entry; run it directly`);
  }
  if (!allowanceApplies(runner, allowance)) {
    return refuse(`${runner} no longer matches its ALLOWED_RUNNER_FAILURES entry; delete it (#${allowance.issue})`);
  }

  const result = await run(runner);
  if (result.code === 0 && result.signal === null) return 0;

  const reported = result.output.split("\n").filter((line) => line.startsWith("FAIL"));
  const error = result.output.match(allowance.excusesErrorMatching);
  const excused =
    result.signal === null &&
    reported.length > 0 &&
    reported.every((line) => allowance.failureLine.test(line.trimEnd())) &&
    error !== null;
  if (!excused) return result.code;

  /* The runner's own failure report is already above this line in the log. This
     says, in one line, that CI saw it and chose to continue anyway, on whose
     authority and until when. */
  process.stderr.write(
    `ALLOW runner: ${runner} ${allowance.worker} ${error[0]} ` +
      `(allowed ${allowance.since}, removed by #${allowance.issue})\n`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.exitCode = refuse(error.message.split("\n")[0]);
}
