#!/usr/bin/env node
/**
 * Load every deployable server module and prove it links.
 *
 * Nothing in CI imported `netlify/functions/**` or `netlify/lib/**` before this
 * check existed, so a module could name an import that does not resolve, or
 * destructure a named export that its dependency does not emit, and every gate
 * would still go green. That is not hypothetical: PR #104 added
 * `./suggestions.mjs` and `withAccessWriteLease` to `netlify/functions/retention.mjs`
 * while `node -e 'import("./netlify/functions/retention.mjs")'` failed
 * immediately (#107).
 *
 * A dynamic `import()` is the whole gate, because ESM resolves and links named
 * imports before it evaluates anything: an unresolvable specifier and a missing
 * named export are both link-time errors, which is exactly the class of failure
 * that was shipping. Evaluation is a bonus, not the point.
 *
 * On top of linking, each `netlify/functions/*.mjs` module must present the
 * entry-point shape Netlify actually invokes — a callable default export and a
 * `config` object — and every routed function must sit under `/api/`, because
 * `netlify.toml` excludes exactly `/api/*` from the edge gate. A function
 * published anywhere else would be served from behind a gate that the config
 * check in `.github/workflows/check.yml` still reports as fail-closed.
 *
 * Modules are loaded, never called, so no handler runs and nothing here reads a
 * credential, opens a store, or contacts a remote service. `*.test.mjs` files
 * are excluded on purpose: they assert on import, they are not deployed, and CI
 * runs them as their own named steps.
 *
 * Output contract: one `PASS` line on stdout and exit 0, or one
 * `FAIL netlify modules:` line per broken module on stderr and exit 1. Every
 * module is attempted before the process exits, so one unresolvable import does
 * not hide the next.
 *
 *   node scripts/check-function-modules.mjs
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The repository root, derived from this file's own location. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const FUNCTIONS = "netlify/functions";
const LIB = "netlify/lib";

/** The path prefix `netlify.toml` excludes from the edge gate. */
const ROUTED_PREFIX = "/api/";

/**
 * Every `.mjs` module in `dir` that is deployed rather than executed as a test,
 * sorted so the report order does not depend on the filesystem.
 */
function modulesIn(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/**
 * The Netlify entry-point shape. A module that links but exports no handler is
 * a function that cannot be invoked, which the deploy would accept silently.
 */
function entryPointFaults(module) {
  const faults = [];
  if (typeof module.default !== "function") {
    faults.push("does not export a callable default handler");
  }
  const config = module.config;
  if (config === null || typeof config !== "object") {
    faults.push("does not export a config object");
    return faults;
  }
  if (config.path !== undefined && !String(config.path).startsWith(ROUTED_PREFIX)) {
    faults.push(`is routed at ${config.path}, outside the ${ROUTED_PREFIX}* edge-gate exclusion`);
  }
  if (config.path === undefined && config.schedule === undefined) {
    faults.push("declares neither a path nor a schedule");
  }
  return faults;
}

async function main() {
  const failures = [];
  const routes = new Map();
  let loaded = 0;

  const functions = modulesIn(FUNCTIONS);
  /* A gate that finds nothing to check reports success, which is the one
     result it must never invent. Every deployable tree here has functions in
     it; an empty scan means the layout moved, not that the code is sound. */
  if (functions.length === 0) {
    process.stderr.write(`FAIL netlify modules: no modules found under ${FUNCTIONS}/\n`);
    return 1;
  }

  for (const relative of [...functions, ...modulesIn(LIB)]) {
    let module;
    try {
      module = await import(pathToFileURL(join(ROOT, relative)).href);
    } catch (error) {
      /* Node's link errors quote absolute paths. The repository root is noise
         in a CI log and an accident waiting to happen in a public one, so it is
         reduced to the same repository-relative vocabulary as everything else
         this script prints. */
      const reason = error.message.split("\n")[0].split(`${ROOT}/`).join("");
      failures.push(`${relative} ${reason}`);
      continue;
    }
    loaded += 1;

    if (!relative.startsWith(`${FUNCTIONS}/`)) continue;

    for (const fault of entryPointFaults(module)) {
      failures.push(`${relative} ${fault}`);
    }

    const path = module.config?.path;
    if (typeof path === "string") {
      const owner = routes.get(path);
      if (owner !== undefined) failures.push(`${relative} claims ${path}, already claimed by ${owner}`);
      else routes.set(path, relative);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL netlify modules: ${failure}\n`);
    return 1;
  }

  process.stdout.write(`PASS netlify modules: ${loaded} modules load and link\n`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  /* A missing directory or an unreadable tree is still a failure of this gate,
     and it reports in the same one-line vocabulary as everything else rather
     than as a stack trace. */
  process.stderr.write(`FAIL netlify modules: ${error.message.split("\n")[0]}\n`);
  process.exitCode = 1;
}
