#!/usr/bin/env node
/**
 * The permanent gate on the shared access-row validator.
 *
 *   node scripts/test-access-row.mjs
 *
 * `validateAccessRow()` (#132) is the single definition of "is this a
 * complete, internally consistent resolved access row?". A hand-duplicated
 * security validator only has to drift in one file to open a hole the other
 * copies still close, and whichever copy no gate happens to exercise is the
 * one that drifts (#125). The duplication kept coming back because each new
 * copy arrived under a new name — `validateAccess`, `assertResolvedAccess`,
 * `validResolvedAccess`, `accessDecision` — so a grep for the previous name
 * found nothing.
 *
 * This runner replaces the grep with two things a new copy cannot slip past:
 *
 *   1. A static inventory. Every module under `netlify/` that imports
 *      `resolveRole` must also import `validateAccessRow`, unless it is named
 *      in `KNOWN_BYPASSES` below. The list is asserted *exactly*: a new
 *      bypassing module fails, and so does leaving a name on the list after
 *      its module has been folded in. Closing one of the remaining surfaces
 *      means deleting its entry, and this runner fails until you do.
 *
 *   2. A runtime matrix for the two surfaces #135 folded in — the realtime
 *      token endpoint and the edge document gate. Each is driven with the same
 *      table of malformed and matrix-inconsistent rows, and each must refuse
 *      every one of them. `netlify/edge-functions/gate.ts` had no test harness
 *      of its own before this file; it is transpiled with the repository's
 *      pinned TypeScript and run on Node against stubbed collaborators, which
 *      is the closest executable proof available without a Deno toolchain.
 *
 * Nothing here reads a credential, a real repository, a remote provider, or a
 * private fixture. Every actor, document, and host is invented.
 *
 * Output contract: one `PASS` line per section on stdout and exit 0, or a
 * `FAIL` line on stderr and exit 1.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

/* ========================================================================= */
/* assertions                                                                */
/* ========================================================================= */

let checks = 0;

function fail(message) {
  process.stderr.write(`FAIL access-row: ${message}\n`);
  process.exit(1);
}

function ok(condition, message) {
  checks += 1;
  if (!condition) fail(message);
}

function eq(actual, expected, message) {
  checks += 1;
  if (!Object.is(actual, expected)) {
    fail(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function deepEq(actual, expected, message) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`${message}\n  expected ${b}\n  actual   ${a}`);
}

/* ========================================================================= */
/* section 1 — the static inventory                                          */
/* ========================================================================= */

/**
 * The role-resolving modules that still validate their own access rows, each
 * with the name its private copy goes by. Every one of them predates #132 and
 * changes an error surface when folded in, so each needs its own coverage
 * rather than a drive-by edit; they are tracked separately. Removing a module
 * from this list is the acceptance step for closing it.
 */
const KNOWN_BYPASSES = Object.freeze([
  "netlify/functions/events.mjs", // assertResolvedAccess() -- #139
  "netlify/functions/pending.mjs", // validateAccess() -- #128
  "netlify/functions/session.mjs", // validateAccess() -- #128
]);

const ACCESS_LIB = /(^|\/)lib\/access\.mjs$/;

async function loadTypeScript() {
  const entry = join(ROOT, "templates/docbuild/node_modules/typescript/lib/typescript.js");
  let loaded;
  try {
    loaded = await import(pathToFileURL(entry).href);
  } catch {
    fail(
      "the docbuild TypeScript install is missing; run " +
        "`npm --prefix templates/docbuild ci` before this runner",
    );
  }
  return loaded.default ?? loaded;
}

/**
 * Every tracked module under `netlify/`, as sorted repository-relative paths.
 * Tracked files are the honest definition of what the deploy tree owns: an
 * installed dependency or a stray scratch file cannot join the inventory, and
 * a module that is added to the tree cannot stay out of it.
 */
function netlifyModules() {
  return execFileSync("git", ["-C", ROOT, "ls-files", "-z", "netlify"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => /^netlify\/.+\.(mjs|ts)$/.test(path) && !/\.test\.mjs$/.test(path))
    .sort();
}

/** The named bindings each module imports, keyed by module specifier. */
function importedNames(ts, source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const found = new Map();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const names = found.get(specifier) ?? new Set();
    for (const element of statement.importClause.namedBindings.elements) {
      names.add((element.propertyName ?? element.name).text);
    }
    found.set(specifier, names);
  }
  return found;
}

async function staticInventory(ts) {
  const resolving = [];
  const bypassing = [];
  for (const path of netlifyModules()) {
    const source = readFileSync(join(ROOT, path), "utf8");
    const imports = importedNames(ts, source, path);
    let resolvesRole = false;
    let validates = false;
    for (const [specifier, names] of imports) {
      if (!ACCESS_LIB.test(specifier)) continue;
      if (names.has("resolveRole")) resolvesRole = true;
      if (names.has("validateAccessRow")) validates = true;
    }
    if (!resolvesRole) continue;
    resolving.push(path);
    if (!validates) bypassing.push(path);
  }

  ok(resolving.length >= 8, `expected the role-resolving inventory to be found, saw ${resolving.length}`);
  ok(
    resolving.includes("netlify/functions/realtime-token.mjs"),
    "realtime-token.mjs must still be counted as a role-resolving module",
  );
  ok(
    resolving.includes("netlify/edge-functions/gate.ts"),
    "gate.ts must still be counted as a role-resolving module",
  );
  deepEq(
    bypassing,
    [...KNOWN_BYPASSES],
    "the set of role-resolving modules bypassing validateAccessRow changed;\n" +
      "  fold the new module onto validateAccessRow(), or -- if it genuinely\n" +
      "  needs its own staged ticket -- add it to KNOWN_BYPASSES with the name\n" +
      "  its private copy goes by",
  );

  // One definition, not one plus a re-export chain that could diverge.
  const definitions = netlifyModules().filter((path) =>
    /export function validateAccessRow\b/.test(readFileSync(join(ROOT, path), "utf8")),
  );
  deepEq(
    definitions,
    ["netlify/lib/access.mjs"],
    "validateAccessRow() must be defined exactly once, in netlify/lib/access.mjs",
  );

  // The two names #135 removed must not come back in the modules it fixed.
  for (const [path, name] of [
    ["netlify/functions/realtime-token.mjs", "accessDecision"],
    ["netlify/edge-functions/gate.ts", "validResolvedAccess"],
  ]) {
    ok(
      !readFileSync(join(ROOT, path), "utf8").includes(`function ${name}(`),
      `${path} must not reintroduce ${name}()`,
    );
  }

  process.stdout.write(
    `PASS  static inventory: ${resolving.length} role-resolving modules, ` +
      `${bypassing.length} known bypasses\n`,
  );
}

/* ========================================================================= */
/* the shared row matrix                                                     */
/* ========================================================================= */

const ROW_KEYS = Object.freeze([
  "role",
  "shared",
  "canRead",
  "canComment",
  "threadControl",
  "canSuggest",
  "canEdit",
  "canAccept",
  "canShare",
  "canSeeMembers",
]);

/** A well-formed row for `role`, in matrix key order. */
function row(capabilitiesFor, role, shared = false) {
  const out = { role, shared };
  const capabilities = capabilitiesFor(role);
  for (const key of ROW_KEYS.slice(2)) out[key] = capabilities[key];
  return out;
}

/**
 * Rows a role-resolving path must refuse. Every entry is either malformed or
 * inconsistent with the capability matrix; none of them may be read as a falsy
 * capability and quietly denied, because a caller that denies a malformed row
 * is one edit away from allowing one.
 */
function brokenRows(capabilitiesFor) {
  const valid = () => row(capabilitiesFor, "editor");
  return [
    // The hole #135 names: `role: "none"` cannot carry `canRead: true`. Before
    // this ticket the realtime endpoint minted a token for exactly this row.
    ["a none role claiming canRead", { ...row(capabilitiesFor, "none"), canRead: true }],
    ["a capability contradicting the matrix", { ...valid(), canShare: true }],
    ["an unknown role", { ...valid(), role: "admin" }],
    ["an unknown threadControl", { ...valid(), threadControl: "everything" }],
    ["a non-boolean capability", { ...valid(), canEdit: "yes" }],
    ["a non-boolean shared", { ...valid(), shared: "no" }],
    ["a missing capability", (() => {
      const partial = valid();
      delete partial.canSeeMembers;
      return partial;
    })()],
    ["an extra key", { ...valid(), canPublish: true }],
    ["an accessor-backed capability", Object.defineProperty(valid(), "canRead", {
      get: () => true,
      enumerable: true,
      configurable: true,
    })],
    ["a non-enumerable capability", Object.defineProperty(valid(), "canRead", {
      value: true,
      enumerable: false,
      writable: true,
      configurable: true,
    })],
    ["a symbol-keyed extra", Object.assign(valid(), { [Symbol("canPublish")]: true })],
    ["a null-prototype row", Object.assign(Object.create(null), valid())],
    ["an array", Object.assign([], valid())],
    ["a class instance", Object.assign(new (class Access {})(), valid())],
    ["null", null],
    ["a string", "owner"],
    ["undefined", undefined],
  ];
}

/* ========================================================================= */
/* section 2 — netlify/functions/realtime-token.mjs                          */
/* ========================================================================= */

const DOC_ID = "a1b2c3";
const SESSION = Object.freeze({
  sub: "sub_realtime_0001",
  email: "sample.reader@example.com",
  name: "Sample Reader",
  isOrg: true,
});
const TOKEN = Object.freeze({ keyName: "invented.key", token: "invented-token" });

/**
 * Bind the endpoint's three collaborators to stubs that delegate to a control
 * channel. The module under test is not rewritten or copied: the loader
 * substitutes only what it depends on, and the *real* `validateAccessRow` is
 * re-exported through the access stub so the assertion is about the shared
 * validator rather than a reimplementation of it.
 */
function bindRealtimeToken(stubRoot) {
  mkdirSync(stubRoot, { recursive: true });
  const real = (path) => pathToFileURL(join(ROOT, path)).href;
  const stub = (name, source) => {
    const file = join(stubRoot, name);
    writeFileSync(file, source, "utf8");
    return pathToFileURL(file).href;
  };

  const stubs = new Map([
    ["../lib/identity.mjs", stub("identity.mjs", `
      export function identify(req) { return globalThis.__ACCESSROW__.identify(req); }
    `)],
    ["../lib/access.mjs", stub("access.mjs", `
      import { validateAccessRow } from ${JSON.stringify(real("netlify/lib/access.mjs"))};
      export { validateAccessRow };
      export function capabilitiesFor(role) {
        return globalThis.__ACCESSROW__.capabilitiesFor(role);
      }
      export function resolveRole(docId, user, options) {
        return globalThis.__ACCESSROW__.resolveRole(docId, user, options);
      }
    `)],
    ["../lib/realtime.mjs", stub("realtime.mjs", `
      export function mintToken(session, docId) {
        return globalThis.__ACCESSROW__.mintToken(session, docId);
      }
    `)],
  ]);

  const bound = real("netlify/functions/realtime-token.mjs");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === bound && stubs.has(specifier)) {
        return { url: stubs.get(specifier), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

async function realtimeTokenMatrix(stubRoot, accessLib) {
  bindRealtimeToken(stubRoot);
  process.env.ABLY_API_KEY = "invented-ably-key";

  const handler = (await import(pathToFileURL(join(ROOT, "netlify/functions/realtime-token.mjs")).href))
    .default;

  const control = {
    identify: () => ({ ...SESSION }),
    capabilitiesFor: (role) => accessLib.capabilitiesFor(role),
    resolveRole: () => row(accessLib.capabilitiesFor, "editor"),
    mintToken: () => ({ ...TOKEN }),
    minted: 0,
  };
  globalThis.__ACCESSROW__ = control;

  const request = () =>
    new Request(`https://docs.example.invalid/api/realtime-token?doc=${DOC_ID}`, { method: "GET" });

  const run = async (overrides) => {
    control.minted = 0;
    Object.assign(control, {
      resolveRole: () => row(accessLib.capabilitiesFor, "editor"),
      capabilitiesFor: (role) => accessLib.capabilitiesFor(role),
      mintToken: () => {
        control.minted += 1;
        return { ...TOKEN };
      },
      ...overrides,
    });
    return handler(request());
  };

  for (const [label, access] of brokenRows(accessLib.capabilitiesFor)) {
    const response = await run({ resolveRole: () => access });
    eq(response.status, 500, `realtime-token refuses ${label} with 500`);
    eq(control.minted, 0, `realtime-token mints nothing for ${label}`);
  }

  // A proxied row is refused before the validator sees it: a trapped row can
  // answer one way while it is checked and another when the capability is read.
  {
    const target = row(accessLib.capabilitiesFor, "editor");
    const response = await run({
      resolveRole: () => new Proxy(target, {}),
    });
    eq(response.status, 500, "realtime-token refuses a proxied row with 500");
    eq(control.minted, 0, "realtime-token mints nothing for a proxied row");
  }

  // An unusable capability table is invalid state, never an implicit denial.
  {
    const response = await run({
      capabilitiesFor: () => {
        throw new Error("no row");
      },
    });
    eq(response.status, 500, "realtime-token refuses an unusable capability table with 500");
    eq(control.minted, 0, "realtime-token mints nothing for an unusable capability table");
  }

  // A well-formed row is still answered exactly as before.
  {
    const response = await run({ resolveRole: () => row(accessLib.capabilitiesFor, "none") });
    eq(response.status, 403, "realtime-token denies a well-formed unreadable row");
    eq(control.minted, 0, "a denied realtime request mints nothing");
  }
  for (const role of ["owner", "editor", "commenter", "viewer"]) {
    const response = await run({ resolveRole: () => row(accessLib.capabilitiesFor, role, true) });
    eq(response.status, 200, `realtime-token allows a well-formed ${role} row`);
    deepEq(await response.json(), TOKEN, `a ${role} request returns the minted token`);
    eq(control.minted, 1, `a ${role} request mints exactly one token`);
  }
  {
    const response = await run({ mintToken: () => null });
    eq(response.status, 204, "an absent realtime provider is still 204");
  }

  process.stdout.write("PASS  realtime-token.mjs validates the resolved row\n");
}

/* ========================================================================= */
/* section 3 — netlify/edge-functions/gate.ts                                */
/* ========================================================================= */

const META_LINE = `<meta name="doc-id" content="${DOC_ID}">\n`;
const PAGE = `${META_LINE}<p>An invented document body.</p>\n`;

/**
 * The edge gate is TypeScript that runs on Deno and has no test harness of its
 * own. Transpiling it with the repository's pinned TypeScript and loading it
 * on Node is the closest executable proof available here: the transpile is
 * type-erasure only, so the control flow under test is the shipped control
 * flow. The stubs are written as siblings under the temporary root so the
 * module's own relative specifiers resolve without a loader hook.
 */
function transpileGate(ts, gateRoot) {
  mkdirSync(join(gateRoot, "edge-functions"), { recursive: true });
  mkdirSync(join(gateRoot, "lib"), { recursive: true });

  const real = (path) => pathToFileURL(join(ROOT, path)).href;
  writeFileSync(
    join(gateRoot, "lib/identity.mjs"),
    `export function identify(req) { return globalThis.__ACCESSROW__.identify(req); }\n`,
    "utf8",
  );
  writeFileSync(
    join(gateRoot, "lib/access.mjs"),
    `import { validateAccessRow } from ${JSON.stringify(real("netlify/lib/access.mjs"))};\n` +
      `export { validateAccessRow };\n` +
      `export function capabilitiesFor(role) { return globalThis.__ACCESSROW__.capabilitiesFor(role); }\n` +
      `export function resolveRole(docId, user, options) {\n` +
      `  return globalThis.__ACCESSROW__.resolveRole(docId, user, options);\n` +
      `}\n`,
    "utf8",
  );

  const source = readFileSync(join(ROOT, "netlify/edge-functions/gate.ts"), "utf8");
  const emitted = ts.transpileModule(source, {
    fileName: "gate.ts",
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  });
  const errors = (emitted.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  ok(errors.length === 0, `gate.ts failed to transpile: ${errors.map((d) => d.messageText).join("; ")}`);

  const file = join(gateRoot, "edge-functions/gate.mjs");
  writeFileSync(file, emitted.outputText, "utf8");
  return pathToFileURL(file).href;
}

async function gateMatrix(ts, gateRoot, accessLib) {
  const gate = (await import(transpileGate(ts, gateRoot))).default;

  const control = globalThis.__ACCESSROW__;
  const request = () => new Request("https://docs.example.invalid/doc/", { method: "GET" });
  const downstream = () =>
    new Response(PAGE, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const context = () => ({ next: async () => downstream() });

  const run = async (overrides) => {
    Object.assign(control, {
      identify: () => ({ ...SESSION }),
      capabilitiesFor: (role) => accessLib.capabilitiesFor(role),
      resolveRole: () => row(accessLib.capabilitiesFor, "editor"),
      ...overrides,
    });
    return gate(request(), context());
  };

  for (const [label, access] of brokenRows(accessLib.capabilitiesFor)) {
    const response = await run({ resolveRole: () => access });
    eq(response.status, 500, `the edge gate refuses ${label} with 500`);
    eq(
      await response.text(),
      "Document access could not be verified.",
      `the edge gate reports ${label} as unverified`,
    );
  }

  {
    const response = await run({
      capabilitiesFor: () => {
        throw new Error("no row");
      },
    });
    eq(response.status, 500, "the edge gate refuses an unusable capability table with 500");
  }

  {
    const response = await run({ resolveRole: () => row(accessLib.capabilitiesFor, "none") });
    eq(response.status, 403, "the edge gate denies a well-formed unreadable row");
    eq(
      await response.text(),
      "You do not have access to this document.",
      "a denied document says so in plain text",
    );
  }
  for (const role of ["owner", "editor", "commenter", "viewer"]) {
    const response = await run({ resolveRole: () => row(accessLib.capabilitiesFor, role, true) });
    eq(response.status, 200, `the edge gate serves a well-formed ${role} row`);
    eq(await response.text(), PAGE, `a ${role} request replays the whole document`);
  }

  // A deliberate relaxation, recorded because it is a behaviour change and not
  // a refactor: `validResolvedAccess()` required every own property to be
  // writable *and* configurable, so a frozen row was a 500. The shared
  // validator requires an enumerable data property and nothing more, which is
  // what every other write path has always accepted.
  {
    const frozen = Object.freeze(row(accessLib.capabilitiesFor, "editor", true));
    const response = await run({ resolveRole: () => frozen });
    eq(response.status, 200, "the edge gate accepts a frozen well-formed row");
  }

  process.stdout.write("PASS  gate.ts validates the resolved row through the shared validator\n");
}

/* ========================================================================= */
/* entry point                                                               */
/* ========================================================================= */

async function main() {
  const ts = await loadTypeScript();
  await staticInventory(ts);

  const accessLib = await import(pathToFileURL(join(ROOT, "netlify/lib/access.mjs")).href);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "access-row-"), { mode: 0o700 });
  try {
    await realtimeTokenMatrix(join(temporaryRoot, "realtime"), accessLib);
    await gateMatrix(ts, join(temporaryRoot, "gate"), accessLib);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  process.stdout.write(`PASS  access-row: ${checks} checks\n`);
}

const deadline = setTimeout(() => {
  fail("the runner exceeded its 120s deadline");
}, 120_000);
deadline.unref();

await main();
