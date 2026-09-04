#!/usr/bin/env node
/**
 * P4-K — the permanent invitation-acceptance test runner.
 *
 *   node --experimental-vm-modules scripts/test-p4-k.mjs contract
 *
 * The entry point is its own supervisor. Parent mode generates an unguessable
 * in-memory nonce and spawns this same file with `--worker` in its own
 * detached process group under a real 120-second deadline. On any timeout or
 * failure it signals that group, escalates to `SIGKILL` after 2,000 ms, reaps
 * it, and confirms it is gone before printing anything. A direct `--worker`
 * invocation without the nonce fails.
 *
 * `contract` is hermetic. It reads the three production sources -- the accept
 * Function, the invite page and the amended login page -- through a static
 * gate, then loads `netlify/functions/accept.mjs` through `vm.SourceTextModule`
 * inside one poisoned context whose only linkable modules are the real deploy
 * tree and three exact fakes. Nothing here reads a credential, touches a
 * network, or leaves state behind.
 *
 * The replay class is the reason the recovery fake is written the way it is:
 * it captures the first token it is handed in a closure and hands that same
 * value back to the handler once more. That captured value never reaches
 * stdout, stderr, an assertion message, a file, an environment variable, a
 * process argument or a log.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { guardedTempRoot, installSignalCleanup, sweepStaleTempRoots } from "./lib/temp-roots.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
const MODES = ["contract"];
const DEADLINE_MS = 120_000;
const TERM_GRACE_MS = 2_000;
const MAX_STREAM_BYTES = 1024 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

const ACCEPT = "netlify/functions/accept.mjs";
const INVITE = "invite/index.html";
const LOGIN = "login/index.html";

const EXPECTED_STDOUT =
  "PASS  P4-K accept Function, returned-user, and replay matrix\n";

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Supervisor.
 * ------------------------------------------------------------------ */

async function parent(mode) {
  const nonce = randomBytes(32).toString("hex");
  sweepStaleTempRoots(["p4k-root-"]);
  const tempRoot = guardedTempRoot("p4k-root-");
  const uninstallSignalCleanup = installSignalCleanup([tempRoot], { exitAfterCleanup: false });

  let child;
  let timer = null;
  let killTimer = null;
  let timedOut = false;
  const chunks = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  const forwarded = ["SIGHUP", "SIGINT", "SIGTERM"];
  const forwarders = new Map();
  let supervisionStopped = false;
  let stdout = "";
  let problems = [];

  function stopSupervision() {
    if (supervisionStopped) return;
    supervisionStopped = true;
    if (timer !== null) clearTimeout(timer);
    if (killTimer !== null) clearTimeout(killTimer);
    for (const [signal, handler] of forwarders) process.off(signal, handler);
  }

  try {
    const finished = await new Promise((resolveRun) => {
      child = spawn(
        process.execPath,
        ["--experimental-vm-modules", "--no-warnings", SELF, "--worker", mode],
        {
          cwd: ROOT,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, P4K_NONCE: nonce, P4K_TEMP_ROOT: tempRoot },
        },
      );

      for (const name of ["stdout", "stderr"]) {
        child[name].on("data", (chunk) => {
          if (sizes[name] >= MAX_STREAM_BYTES) return;
          sizes[name] += chunk.length;
          chunks[name].push(chunk);
        });
      }

      function stopGroup() {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
        if (killTimer === null) {
          killTimer = setTimeout(() => {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              // Already gone.
            }
          }, TERM_GRACE_MS);
          killTimer.unref();
        }
      }

      for (const signal of forwarded) {
        const handler = () => {
          timedOut = true;
          stopGroup();
        };
        forwarders.set(signal, handler);
        process.on(signal, handler);
      }

      timer = setTimeout(() => {
        timedOut = true;
        stopGroup();
      }, DEADLINE_MS);

      child.on("close", (code, signal) => resolveRun({ code, signal }));
    });

    stopSupervision();

    stdout = Buffer.concat(chunks.stdout).toString("utf8");
    const stderr = Buffer.concat(chunks.stderr).toString("utf8");

    let groupGone = false;
    for (let attempt = 0; attempt < 20 && !groupGone; attempt += 1) {
      try {
        process.kill(-child.pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        groupGone = true;
      }
    }

    let residue = [];
    try {
      residue = await readdir(tempRoot);
    } catch {
      residue = [];
    }
    problems = [];
    if (timedOut) problems.push(`worker exceeded the ${DEADLINE_MS} ms deadline`);
    if (finished.code !== 0) {
      problems.push(`worker exited with code ${finished.code} signal ${finished.signal}`);
    }
    if (stderr !== "") problems.push(`worker stderr was not empty:\n${stderr}`);
    if (stdout !== EXPECTED_STDOUT) {
      problems.push(`worker stdout did not match the expected transcript:\n${stdout}`);
    }
    if (residue.length !== 0) {
      problems.push(`temporary fixture state was left behind: ${residue.join(", ")}`);
    }
    if (!groupGone) problems.push("the worker process group did not disappear");

  } finally {
    stopSupervision();
    uninstallSignalCleanup();
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (problems.length !== 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(stdout);
}

/* ------------------------------------------------------------------ *
 * Worker.
 * ------------------------------------------------------------------ */

async function worker(mode) {
  const nonce = process.env.P4K_NONCE;
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    die("scripts/test-p4-k.mjs --worker is a supervised entry point");
  }
  const tempRoot = process.env.P4K_TEMP_ROOT;
  if (typeof tempRoot !== "string" || tempRoot.length === 0 || !existsSync(tempRoot)) {
    die("scripts/test-p4-k.mjs --worker requires its supervised temporary root");
  }

  const workspace = await mkdtemp(join(tempRoot, "run-"));
  try {
    if (mode !== "contract") die("unknown worker mode");
    await runContract(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ *
 * The static source gate.
 *
 * Some of the acceptance criteria are properties of the source rather than
 * of any one response: the Function must never reach for a session header,
 * and the page must never own a sink that could leak the token. Those are
 * asserted here, against the production files, before anything runs.
 * ------------------------------------------------------------------ */

const FORBIDDEN_CALLEES = new Set([
  "setInterval",
  "setImmediate",
  "require",
  "fetch",
  "eval",
]);
const CONVENIENCE_BODY_READERS = new Set([
  "json", "text", "formData", "arrayBuffer", "blob", "bytes", "clone",
]);
/* The wrong Identity surfaces for this ticket. `acceptInvite` belongs to the
   other invitation flow entirely; the rest either establish a second session
   or reach for state P3-H owns. */
const FORBIDDEN_IDENTIFIERS = new Set([
  "acceptInvite",
  "handleAuthCallback",
  "updateUser",
  "identify",
  "getUser",
  "getStore",
  "signup",
  "hydrateSession",
  "refreshSession",
]);
/* The session headers are the runtime's to write. Application code that so
   much as names one is a finding, which is why none of these words appear in
   `accept.mjs` at all -- not in a call, not in a string, not in a comment. */
const SESSION_HEADER_WORDS = [
  /nf_jwt/i,
  /nf_refresh/i,
  /set-cookie/i,
  /\bcookies?\b/i,
];

async function loadTypeScript() {
  const entry = resolve(ROOT, "templates/docbuild/node_modules/typescript/lib/typescript.js");
  if (!existsSync(entry)) {
    throw new Error(
      "the docbuild TypeScript install is missing; run npm --prefix templates/docbuild install",
    );
  }
  const loaded = await import(pathToFileURL(entry).href);
  return loaded.default ?? loaded;
}

function hasEscape(ts, node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (child.kind === ts.SyntaxKind.BreakStatement ||
        child.kind === ts.SyntaxKind.ThrowStatement ||
        child.kind === ts.SyntaxKind.ReturnStatement) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * True when `node` names a `Headers` bag: `headers`, or anything `.headers`.
 *
 * @param {object} ts
 * @param {object} node
 * @returns {boolean}
 */
function headersReceiver(ts, node) {
  if (ts.isIdentifier(node)) return /headers$/i.test(node.text);
  if (ts.isPropertyAccessExpression(node)) return /headers$/i.test(node.name.text);
  return false;
}

/**
 * Walk one JavaScript source and report every sink this ticket forbids.
 *
 * @param {object} ts
 * @param {string} source
 * @param {string} fileName
 * @param {{ sessionHeaders?: boolean, fetchTargets?: string[] }} rules
 * @returns {string[]}
 */
function inspectSource(ts, source, fileName, rules = {}) {
  const problems = [];
  const file = ts.createSourceFile(
    fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS,
  );
  const fetchTargets = [];

  if (rules.sessionHeaders === true) {
    for (const pattern of SESSION_HEADER_WORDS) {
      if (pattern.test(source)) {
        problems.push(`${fileName} names a runtime session header: ${pattern}`);
      }
    }
  }

  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        problems.push(`${fileName} uses a dynamic import`);
      }
      if (ts.isIdentifier(callee)) {
        if (FORBIDDEN_CALLEES.has(callee.text) &&
            !(callee.text === "fetch" && Array.isArray(rules.fetchTargets))) {
          problems.push(`${fileName} calls ${callee.text}`);
        }
        if (FORBIDDEN_IDENTIFIERS.has(callee.text)) {
          problems.push(`${fileName} calls the forbidden Identity surface ${callee.text}`);
        }
        if (callee.text === "fetch" && Array.isArray(rules.fetchTargets)) {
          const first = node.arguments[0];
          fetchTargets.push(
            first !== undefined && ts.isStringLiteral(first) ? first.text : "<computed>",
          );
        }
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "req" &&
            CONVENIENCE_BODY_READERS.has(name)) {
          problems.push(`${fileName} uses the convenience body reader req.${name}()`);
        }
        if (FORBIDDEN_IDENTIFIERS.has(name)) {
          problems.push(`${fileName} calls the forbidden Identity surface .${name}()`);
        }
        /* A bare-identifier check alone is not a gate: `globalThis.fetch(...)`
           reaches the same function through a property access. */
        if (FORBIDDEN_CALLEES.has(name) &&
            !(name === "fetch" && Array.isArray(rules.fetchTargets))) {
          problems.push(`${fileName} calls ${name} through a property access`);
        }
        if (name === "fetch" && Array.isArray(rules.fetchTargets)) {
          const first = node.arguments[0];
          fetchTargets.push(
            first !== undefined && ts.isStringLiteral(first) ? first.text : "<computed>",
          );
        }
      }
      /* `headers.set("Set-Cookie", ...)` and friends never appear in this
         Function; the header words above already ban the literal, and this
         catches a computed spelling reaching a Headers mutator. The receiver
         has to be a `headers` reference: `set` is also `Uint8Array.prototype`'s
         and flagging that spells a false gate failure on the body reader. */
      if (rules.sessionHeaders === true && ts.isPropertyAccessExpression(callee) &&
          (callee.name.text === "append" || callee.name.text === "set" ||
           callee.name.text === "delete") &&
          headersReceiver(ts, callee.expression) &&
          node.arguments.length > 0 && !ts.isStringLiteral(node.arguments[0])) {
        problems.push(`${fileName} mutates a header under a computed name`);
      }
    }
    if (ts.isWhileStatement(node) || ts.isForStatement(node)) {
      const test = ts.isWhileStatement(node) ? node.expression : node.condition;
      const unbounded = test === undefined || test.kind === ts.SyntaxKind.TrueKeyword;
      if (unbounded && !hasEscape(ts, node.statement)) {
        problems.push(`${fileName} has an unbounded loop without a break or throw`);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);

  if (Array.isArray(rules.fetchTargets)) {
    const seen = fetchTargets.join(",");
    const wanted = rules.fetchTargets.join(",");
    if (seen !== wanted) {
      problems.push(`${fileName} issues fetch(${seen}); expected fetch(${wanted})`);
    }
  }
  return problems;
}

/** Every DOM or storage sink the invite page must not own. */
const PAGE_SINKS = [
  "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write",
  "localStorage", "sessionStorage", "indexedDB", "openDatabase",
  "navigator.sendBeacon", "XMLHttpRequest", "WebSocket", "EventSource",
  "serviceWorker", "console.", "new Function", "setAttribute(\"title\"",
  "unhandledrejection", "window.name",
];

/** Every markup construct that would make the page reach off-origin. */
const PAGE_EXTERNALS = [
  "<link", "<img", "<iframe", "<object", "<embed", "<video", "<audio",
  "<source", "<base", "@import", "url(", "src=", "http://", "https://",
  "action=", "srcdoc", "integrity=", "type=\"module\"",
];

function inspectInvitePage(source) {
  const problems = [];

  const styles = source.match(/<style\b/g) || [];
  const scripts = source.match(/<script\b/g) || [];
  if (styles.length !== 1) problems.push(`${INVITE} must carry exactly one inline <style>`);
  if (scripts.length !== 1) problems.push(`${INVITE} must carry exactly one inline <script>`);

  for (const required of [
    '<html lang="en">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    "<title>Set your password</title>",
    "<main>",
    "<h1>Set your password</h1>",
    '<p id="invite-status" role="status" aria-live="polite"></p>',
    '<label for="invite-password">Password</label>',
    '<label for="invite-confirm">Confirm password</label>',
    '<form id="invite-form" hidden novalidate>',
    '<input id="invite-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>',
    '<input id="invite-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>',
    '<button type="submit">Set password</button>',
  ]) {
    if (!source.includes(required)) {
      problems.push(`${INVITE} is missing its required markup: ${required}`);
    }
  }

  for (const sink of PAGE_SINKS) {
    if (source.includes(sink)) problems.push(`${INVITE} owns the forbidden sink ${sink}`);
  }
  for (const external of PAGE_EXTERNALS) {
    if (source.includes(external)) {
      problems.push(`${INVITE} carries the off-origin construct ${external}`);
    }
  }
  return problems;
}

/**
 * The login page keeps every behavior P2-A gave it and gains exactly one
 * branch. Both halves are asserted: the bridge is present and exact, and the
 * `next`/`error` handling it must not disturb is still there.
 */
function inspectLoginPage(source) {
  const problems = [];
  const scripts = source.match(/<script\b/g) || [];
  if (scripts.length !== 1) problems.push(`${LOGIN} must carry exactly one inline <script>`);

  for (const required of [
    'var recovery = location.hash.match(/^#recovery_token=([A-Za-z0-9._~-]{20,4096})$/);',
    "if (recovery) {",
    'location.replace("/invite/" + location.hash);',
    "return;",
    'const params = new URLSearchParams(location.search);',
    'const nextValue = params.get("next");',
    'document.querySelector(\'input[name="next"]\').value = nextValue;',
    'const errorValue = params.get("error");',
    'document.getElementById("login-error").hidden = false;',
    '<form method="post" action="/api/login">',
  ]) {
    if (!source.includes(required)) {
      problems.push(`${LOGIN} no longer carries: ${required}`);
    }
  }

  const bridgeAt = source.indexOf("var recovery = location.hash.match");
  const paramsAt = source.indexOf("const params = new URLSearchParams");
  if (bridgeAt === -1 || paramsAt === -1 || bridgeAt > paramsAt) {
    problems.push(`${LOGIN} must run the recovery bridge before it parses next/error`);
  }
  for (const forbidden of ["invite_token", "sessionStorage", "localStorage", "innerHTML",
                           "decodeURIComponent(location.hash", "console."]) {
    if (source.includes(forbidden)) {
      problems.push(`${LOGIN} bridge must not use ${forbidden}`);
    }
  }
  return problems;
}

/** The one inline script of an HTML document, for AST inspection. */
function inlineScript(source, fileName) {
  const open = source.indexOf("<script>");
  const close = source.indexOf("</script>");
  if (open === -1 || close === -1 || close < open) {
    throw new Error(`${fileName} has no inspectable inline script`);
  }
  return source.slice(open + "<script>".length, close);
}

/* ------------------------------------------------------------------ *
 * The hermetic contract worker.
 * ------------------------------------------------------------------ */

async function runContract(workspace) {
  const vm = await import("node:vm");
  const ts = await loadTypeScript();

  const acceptPath = resolve(ROOT, ACCEPT);
  const acceptSource = await readFile(acceptPath, "utf8");
  const inviteSource = await readFile(resolve(ROOT, INVITE), "utf8");
  const loginSource = await readFile(resolve(ROOT, LOGIN), "utf8");

  const problems = [
    ...inspectSource(ts, acceptSource, ACCEPT, { sessionHeaders: true }),
    ...inspectInvitePage(inviteSource),
    ...inspectLoginPage(loginSource),
    ...inspectSource(ts, inlineScript(inviteSource, INVITE), INVITE, {
      sessionHeaders: true,
      fetchTargets: ["/api/accept"],
    }),
    ...inspectSource(ts, inlineScript(loginSource, LOGIN), LOGIN, { sessionHeaders: true }),
  ];
  if (problems.length !== 0) {
    throw new Error(`source gate failed:\n${problems.join("\n")}`);
  }

  const fakes = join(workspace, "fakes");
  await mkdir(fakes, { recursive: true });
  const blobsFake = join(fakes, "blobs.mjs");
  const identityFake = join(fakes, "identity-sdk.mjs");
  const suiteFile = join(workspace, "suite.mjs");
  await writeFile(blobsFake, BLOBS_FAKE_SOURCE, "utf8");
  await writeFile(identityFake, IDENTITY_FAKE_SOURCE, "utf8");
  await writeFile(suiteFile, suiteSource(acceptPath, identityFake), "utf8");

  const failures = [];
  const context = vm.createContext(Object.create(null));
  Object.assign(context, {
    URL,
    URLSearchParams,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    /* The realm's typed arrays are replaced with the host's so that a chunk
       produced by the host TextEncoder is the same `Uint8Array` the Function
       tests its chunks against. Leaving the two realms apart would make the
       Function reject every legitimate body for a reason production never
       has. */
    Uint8Array,
    ArrayBuffer,
    Proxy,
    Reflect,
    AbortController,
    crypto: globalThis.crypto,
    __report(group, message) {
      failures.push(`${group}: ${message}`);
    },
  });
  vm.runInContext(CONTEXT_BOOTSTRAP, context);

  const modules = new Map();
  const specifiers = new Map([
    ["@netlify/blobs", blobsFake],
    ["@netlify/identity", identityFake],
  ]);

  /* The cache holds the pending compilation, not the finished module. Linking
     resolves a module's dependencies concurrently, so caching only the settled
     value lets one path be compiled twice -- and two copies of the Identity
     fake means two `AuthError` classes, which quietly turns every `instanceof`
     against the provider's own error class into `false`. */
  const compile = (path) => {
    if (modules.has(path)) return modules.get(path);
    const pending = (async () => {
      const text = await readFile(path, "utf8");
      return new vm.SourceTextModule(text, { identifier: path, context });
    })();
    modules.set(path, pending);
    return pending;
  };

  const linker = async (specifier, referencing) => {
    if (specifiers.has(specifier)) return compile(specifiers.get(specifier));
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const target = specifier.startsWith("/")
        ? specifier
        : resolve(dirname(referencing.identifier), specifier);
      if (!target.startsWith(`${ROOT}/netlify/`) && !target.startsWith(`${workspace}/`)) {
        throw new Error(`undeclared module outside the linked graph: ${specifier}`);
      }
      return compile(target);
    }
    throw new Error(`undeclared import: ${specifier}`);
  };

  const suite = await compile(suiteFile);
  await suite.link(linker);
  await suite.evaluate();
  const groups = await suite.namespace.default();

  if (failures.length !== 0) {
    throw new Error(`contract worker failures:\n${failures.join("\n")}`);
  }
  if (groups !== 5) {
    throw new Error(`expected five completed groups, saw ${groups}`);
  }
  process.stdout.write(EXPECTED_STDOUT);
}

const CONTEXT_BOOTSTRAP = `
globalThis.globalThis = globalThis;
globalThis.structuredClone = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
globalThis.console = new Proxy({}, {
  get() { throw new Error("console is poisoned inside the contract worker"); },
});
globalThis.fetch = () => { throw new Error("fetch is poisoned inside the contract worker"); };
globalThis.setInterval = () => { throw new Error("setInterval is poisoned"); };
globalThis.setImmediate = () => { throw new Error("setImmediate is poisoned"); };
globalThis.require = () => { throw new Error("require is poisoned"); };
globalThis.process = { env: {} };
globalThis.__timers = 0;
globalThis.setTimeout = (fn) => {
  globalThis.__timers += 1;
  if (globalThis.__timers > 2000) { throw new Error("unbounded retry backoff"); }
  Promise.resolve().then(fn);
  return 0;
};
globalThis.clearTimeout = () => {};
globalThis.queueMicrotask = (fn) => { Promise.resolve().then(fn); };
`;

const BLOBS_FAKE_SOURCE = `export function getStore() {
  throw new Error("direct @netlify/blobs access is poisoned in the contract worker");
}
`;

/**
 * The Identity fake. `AuthError` and `MissingIdentityError` are real classes
 * so the Function's `instanceof` checks mean what they mean in production;
 * every callable surface is poisoned so a stray call is a loud failure rather
 * than a quiet success. The two the Function is allowed to use are injected
 * per test through `createAcceptHandler`.
 */
const IDENTITY_FAKE_SOURCE = `export class AuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
export class MissingIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = "MissingIdentityError";
  }
}
function poison(name) {
  return () => { throw new Error("direct Identity SDK access (" + name + ") is poisoned"); };
}
export const recoverPassword = poison("recoverPassword");
export const acceptInvite = poison("acceptInvite");
export const handleAuthCallback = poison("handleAuthCallback");
export const updateUser = poison("updateUser");
export const getUser = poison("getUser");
export const admin = { listUsers: poison("admin.listUsers") };
export function verifyRequestOrigin() {
  throw new Error("direct verifyRequestOrigin is poisoned");
}
`;

function suiteSource(acceptPath, identityFake) {
  return [
    `import { createAcceptHandler, config } from ${JSON.stringify(acceptPath)};`,
    `import defaultHandler from ${JSON.stringify(acceptPath)};`,
    `import * as acceptNamespace from ${JSON.stringify(acceptPath)};`,
    `import { AuthError, MissingIdentityError } from ${JSON.stringify(identityFake)};`,
    SUITE_BODY,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * The in-realm contract suite. It is written into the supervised
 * temporary directory, linked inside the poisoned vm context, and
 * removed with the rest of the fixture state.
 * ------------------------------------------------------------------ */

const SUITE_BODY = String.raw`
const OK_TOKEN = "Rk9VUi1LLXJlY292ZXJ5LXRva2Vu.abc_~-0123456789";
const OK_PASSWORD = "correct horse battery staple";
const OK_USER_ID = "u_fixture_invited_77";
const OK_USER_EMAIL = "invited@example.invalid";

let group = "";
function check(ok, message) { if (!ok) __report(group, message); }
function eq(actual, expected, message) {
  check(actual === expected, message + " (saw " + JSON.stringify(actual) + ")");
}

function encode(text) { return new TextEncoder().encode(text); }

/**
 * A request body the Function must read by hand. The reader records how many
 * times its lock was released and whether it was cancelled, because "exactly
 * once" is part of the contract rather than an implementation detail.
 */
function makeBody(chunks, options = {}) {
  const state = { released: 0, cancelled: 0, reads: 0, locked: false };
  const body = {
    __state: state,
    getReader() {
      if (options.getReaderThrows === true) throw new Error("no reader");
      if (state.locked) throw new TypeError("already locked");
      state.locked = true;
      let index = 0;
      return {
        async read() {
          state.reads += 1;
          if (options.rejectAt === state.reads) throw new Error("stream failed");
          if (options.malformedResult === true) return null;
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = chunks[index];
          index += 1;
          return { done: false, value };
        },
        async cancel() { state.cancelled += 1; },
        releaseLock() { state.released += 1; },
      };
    },
  };
  return body;
}

function jsonBody(value) {
  return makeBody([encode(typeof value === "string" ? value : JSON.stringify(value))]);
}

function makeReq(method, contentType, body) {
  const headers = new Headers();
  if (contentType !== null) headers.set("Content-Type", contentType);
  return { method, headers, body };
}

function goodReq(overrides = {}) {
  const payload = {
    token: overrides.token === undefined ? OK_TOKEN : overrides.token,
    password: overrides.password === undefined ? OK_PASSWORD : overrides.password,
  };
  return makeReq("POST", "application/json", jsonBody(payload));
}

/** The canonical user the pinned package returns from a successful recovery. */
function canonicalUser(overrides = {}) {
  return {
    id: overrides.id === undefined ? OK_USER_ID : overrides.id,
    email: overrides.email === undefined ? OK_USER_EMAIL : overrides.email,
  };
}

function okOrigin() { return () => {}; }
function okRecover(record) {
  return async (token, password) => {
    if (record !== undefined) record.calls.push([token, password]);
    return canonicalUser();
  };
}

function handlerWith(overrides) {
  return createAcceptHandler({
    requireOriginFn: overrides.requireOriginFn === undefined ? okOrigin() : overrides.requireOriginFn,
    recoverPasswordFn: overrides.recoverPasswordFn === undefined ? okRecover() : overrides.recoverPasswordFn,
  });
}

async function bodyBytes(response) {
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function expectNoContent(response, label) {
  eq(response.status, 204, label + " must answer 204");
  eq(response.headers.get("Cache-Control"), "private, no-store", label + " must be private");
  eq(response.headers.get("Content-Length"), "0", label + " must declare a zero length");
  eq(response.headers.get("Content-Type"), null, label + " must carry no application media type");
  const bytes = await bodyBytes(response);
  eq(bytes.byteLength, 0, label + " must carry zero application bytes");
}

async function expectError(response, status, code, label) {
  eq(response.status, status, label + " must answer " + status);
  eq(response.headers.get("Cache-Control"), "private, no-store", label + " must be private");
  eq(
    response.headers.get("Content-Type"),
    "application/json; charset=utf-8",
    label + " must be exact JSON",
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await bodyBytes(response));
  eq(text, '{"error":"' + code + '"}', label + " must carry the exact error body");
}

/* ---------------- group one: shape of the endpoint ---------------- */

async function groupOne() {
  group = "endpoint";

  eq(config.path, "/api/accept", "the route is declared exactly once");
  eq(typeof defaultHandler, "function", "the module has a default handler");
  eq(typeof createAcceptHandler, "function", "the module exports its factory");
  eq(
    Object.keys(acceptNamespace).sort().join(","),
    "config,createAcceptHandler,default",
    "the module exports exactly its three declared names",
  );

  /* Every non-POST method is refused before origin, body or Identity is ever
     consulted -- proved by handing the handler a poisoned everything. */
  const poisoned = createAcceptHandler({
    requireOriginFn: () => { throw new Error("origin must not be consulted"); },
    recoverPasswordFn: () => { throw new Error("Identity must not be consulted"); },
  });
  for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE", "post", "TRACE"]) {
    const body = makeBody([encode("{}")]);
    const response = await poisoned(makeReq(method, "application/json", body));
    eq(response.status, 405, method + " must be refused");
    eq(response.headers.get("Allow"), "POST", method + " must advertise POST");
    eq(response.headers.get("Cache-Control"), "private, no-store", method + " must be private");
    const bytes = await bodyBytes(response);
    eq(bytes.byteLength, 0, method + " must carry zero bytes");
    eq(body.__state.locked, false, method + " must not touch the request stream");
  }

  /* Origin runs before media type and before the stream. */
  const originBody = makeBody([encode("{}")]);
  const refused = await createAcceptHandler({
    requireOriginFn: () => {
      throw new Response("Bad origin", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    },
    recoverPasswordFn: () => { throw new Error("Identity must not be consulted"); },
  })(makeReq("POST", "text/plain", originBody));
  eq(refused.status, 403, "a bad origin is refused with P1-C's own response");
  eq(refused.headers.get("Cache-Control"), "private, no-store", "the refusal is private");
  eq(originBody.__state.locked, false, "a bad origin never opens the stream");

  const thrown = await handlerWith({
    requireOriginFn: () => { throw new Error("boom"); },
  })(goodReq());
  await expectError(thrown, 500, "internal-error", "an unexpected origin throw");

  for (const [type, status] of [
    ["application/json", 204],
    ["application/JSON", 204],
    ["Application/Json; charset=utf-8", 204],
    ["application/json ; charset=utf-8", 204],
    [null, 415],
    ["text/plain", 415],
    ["application/jsonx", 415],
    ["application/x-www-form-urlencoded", 415],
    ["", 415],
  ]) {
    const response = await handlerWith({})(
      makeReq("POST", type, jsonBody({ token: OK_TOKEN, password: OK_PASSWORD })),
    );
    eq(response.status, status, "media type " + JSON.stringify(type));
  }
  return 1;
}

/* ---------------- group two: the bounded body ---------------- */

async function groupTwo() {
  group = "body";

  const missing = await handlerWith({})(makeReq("POST", "application/json", null));
  await expectError(missing, 400, "invalid-invitation", "a missing body");

  const noReader = await handlerWith({})(
    makeReq("POST", "application/json", { getReader: 7 }),
  );
  await expectError(noReader, 400, "invalid-invitation", "a body with no reader");

  const throwing = makeBody([], { getReaderThrows: true });
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", throwing)),
    400, "invalid-invitation", "a stream that refuses a reader",
  );

  const rejecting = makeBody([encode("{}")], { rejectAt: 1 });
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", rejecting)),
    400, "invalid-invitation", "a stream that rejects",
  );
  eq(rejecting.__state.released, 1, "a rejecting stream releases its lock exactly once");

  const malformed = makeBody([], { malformedResult: true });
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", malformed)),
    400, "invalid-invitation", "a reader that resolves a non-result",
  );
  eq(malformed.__state.released, 1, "a malformed result still releases the lock once");

  const wrongChunk = makeBody(["not bytes"]);
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", wrongChunk)),
    400, "invalid-invitation", "a non-Uint8Array chunk",
  );
  eq(wrongChunk.__state.released, 1, "a wrong chunk releases the lock once");

  const invalidUtf8 = makeBody([new Uint8Array([0x7b, 0xff, 0x7d])]);
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", invalidUtf8)),
    400, "invalid-invitation", "invalid UTF-8",
  );

  for (const raw of ["", "   ", "{", "[]", "null", "\"text\"", "7", "true"]) {
    const response = await handlerWith({})(
      makeReq("POST", "application/json", makeBody([encode(raw)])),
    );
    eq(response.status, 400, "the non-object body " + JSON.stringify(raw));
  }

  /* The 8,192-byte boundary is asserted from both sides, and the payload is
     split across several chunks so the accumulator is exercised rather than a
     single-read shortcut. */
  const shell = JSON.stringify({ token: OK_TOKEN, password: OK_PASSWORD, pad: "" });
  const padding = 8192 - shell.length;
  const atLimit = JSON.stringify({ token: OK_TOKEN, password: OK_PASSWORD, pad: "x".repeat(padding) });
  eq(encode(atLimit).byteLength, 8192, "the boundary fixture is exactly 8,192 bytes");
  const limitBytes = encode(atLimit);
  const split = [limitBytes.slice(0, 10), limitBytes.slice(10, 5000), limitBytes.slice(5000)];
  const accepted = await handlerWith({})(
    makeReq("POST", "application/json", makeBody(split)),
  );
  /* Exactly at the ceiling the body is read in full; it is then rejected for
     its extra field rather than for its size. */
  await expectError(accepted, 400, "invalid-invitation", "an 8,192-byte body with an extra field");

  const overBytes = encode(atLimit + "x");
  const over = makeBody([overBytes.slice(0, 4096), overBytes.slice(4096)]);
  await expectError(
    await handlerWith({})(makeReq("POST", "application/json", over)),
    413, "invalid-invitation", "an 8,193-byte body",
  );
  eq(over.__state.cancelled, 1, "an oversized body is cancelled exactly once");
  eq(over.__state.released, 1, "an oversized body releases its lock exactly once");

  /* Exact two-field shape. */
  const shapes = [
    {},
    { token: OK_TOKEN },
    { password: OK_PASSWORD },
    { token: OK_TOKEN, password: OK_PASSWORD, doc: "4b7d2a" },
    { token: OK_TOKEN, password: OK_PASSWORD, email: "x@example.invalid" },
    { token: OK_TOKEN, password: OK_PASSWORD, role: "editor" },
    { token: OK_TOKEN, password: OK_PASSWORD, next: "/" },
    { token: OK_TOKEN, password: OK_PASSWORD, actor: "x" },
    { token: OK_TOKEN, password: OK_PASSWORD, author: "x" },
    { token: OK_TOKEN, Password: OK_PASSWORD },
    { token: 7, password: OK_PASSWORD },
    { token: OK_TOKEN, password: 7 },
    { token: null, password: null },
    { token: [OK_TOKEN], password: [OK_PASSWORD] },
  ];
  for (const shape of shapes) {
    const response = await handlerWith({})(
      makeReq("POST", "application/json", jsonBody(shape)),
    );
    eq(response.status, 400, "the body shape " + JSON.stringify(Object.keys(shape)));
  }

  /* Field order is irrelevant; the pair is what matters. */
  const reordered = await handlerWith({})(
    makeReq("POST", "application/json", makeBody([
      encode('{"password":' + JSON.stringify(OK_PASSWORD) + ',"token":' + JSON.stringify(OK_TOKEN) + "}"),
    ])),
  );
  await expectNoContent(reordered, "a reordered body");
  return 1;
}

/* ---------------- group three: token and password ---------------- */

async function groupThree() {
  group = "credentials";

  const validTokens = [
    "a".repeat(20),
    "a".repeat(4096),
    "AZaz09._~-" + "b".repeat(10),
    OK_TOKEN,
  ];
  for (const token of validTokens) {
    const response = await handlerWith({})(goodReq({ token }));
    eq(response.status, 204, "a token of length " + token.length + " is accepted");
  }

  const invalidTokens = [
    "a".repeat(19),
    "a".repeat(4097),
    "",
    "a".repeat(19) + "!",
    "a".repeat(19) + "/",
    "a".repeat(19) + "+",
    "a".repeat(19) + "=",
    "a".repeat(19) + " ",
    "a".repeat(19) + "\n",
    "#recovery_token=" + "a".repeat(20),
    "a".repeat(10) + "é" + "a".repeat(10),
  ];
  for (const token of invalidTokens) {
    const response = await handlerWith({
      recoverPasswordFn: () => { throw new Error("Identity must not see a bad token"); },
    })(goodReq({ token }));
    eq(response.status, 400, "the token " + JSON.stringify(token.slice(0, 24)) + " is refused");
  }

  const astral = "\u{1f600}".repeat(128);
  const validPasswords = [
    "a".repeat(12),
    "a".repeat(128),
    astral,
    " leading and trailing ",
    "é".repeat(128),
    OK_PASSWORD,
  ];
  for (const password of validPasswords) {
    const response = await handlerWith({})(goodReq({ password }));
    eq(response.status, 204, "a password of " + [...password].length + " code points is accepted");
  }

  const invalidPasswords = [
    "a".repeat(11),
    "a".repeat(129),
    "\u{1f600}".repeat(129),
    "\u00e9".repeat(129),
    "aaaaaaaaaaa\u0000",
    "aaaaaaaaaaa\u0007",
    "aaaaaaaaaaa\t",
    "aaaaaaaaaaa\n",
    "aaaaaaaaaaa\u001f",
    "aaaaaaaaaaa\u007f",
    "aaaaaaaaaaa\u0085",
    "aaaaaaaaaaa\u009f",
    "aaaaaaaaaaa\ud800",
    "aaaaaaaaaaa\udfff",
    "aaaaaaaaaa\ud83d\udc4dz\ud800",
    "",
  ];
  for (const password of invalidPasswords) {
    const response = await handlerWith({
      recoverPasswordFn: () => { throw new Error("Identity must not see a bad password"); },
    })(goodReq({ password }));
    eq(response.status, 400, "a password of " + password.length + " units is refused");
  }

  /* The 512-byte ceiling binds independently of the code-point ceiling: 128
     four-byte characters are 512 bytes and pass, while 128 characters that
     encode wider would not. */
  eq(new TextEncoder().encode(astral).byteLength, 512, "the astral fixture is exactly 512 bytes");

  /* Nothing is trimmed, normalized or case-folded on the way through. */
  const seen = { calls: [] };
  const spaced = "  Mixed Case Password  ";
  const passed = await handlerWith({ recoverPasswordFn: okRecover(seen) })(
    goodReq({ password: spaced }),
  );
  eq(passed.status, 204, "an untrimmed password is accepted");
  eq(seen.calls.length, 1, "recovery is called exactly once");
  eq(seen.calls[0][0], OK_TOKEN, "the token reaches the provider verbatim");
  eq(seen.calls[0][1], spaced, "the password reaches the provider verbatim");
  return 1;
}

/* ---------------- group four: provider outcomes and replay ---------------- */

async function groupFour() {
  group = "provider";

  const classified = [
    [new AuthError("bad token", 400), 400, "invalid-invitation"],
    [new AuthError("gone", 404), 400, "invalid-invitation"],
    [new AuthError("nope", 499), 400, "invalid-invitation"],
    [new AuthError("early", 399), 503, "unavailable"],
    [new AuthError("late", 500), 503, "unavailable"],
    [new AuthError("later", 599), 503, "unavailable"],
    [new AuthError("no status", undefined), 503, "unavailable"],
    [new AuthError("fractional", 400.5), 503, "unavailable"],
    [new AuthError("stringly", "400"), 503, "unavailable"],
    [new MissingIdentityError("identity is not configured"), 503, "unavailable"],
    [new TypeError("something else"), 503, "unavailable"],
    [new Error("plain"), 503, "unavailable"],
  ];
  for (const [error, status, code] of classified) {
    const response = await handlerWith({
      recoverPasswordFn: async () => { throw error; },
    })(goodReq());
    await expectError(response, status, code, error.name + " " + String(error.status));
  }

  /* A rejection that merely dresses up as the package's own error class is
     not one. Recognition is by identity against the pinned import. */
  const lookalike = Object.assign(new Error("counterfeit"), { name: "AuthError", status: 400 });
  await expectError(
    await handlerWith({ recoverPasswordFn: async () => { throw lookalike; } })(goodReq()),
    503, "unavailable", "an AuthError lookalike",
  );

  /* Non-Error rejections, including one carrying a poisoned getter. */
  const poisonedStatus = { name: "AuthError", get status() { throw new Error("read"); } };
  await expectError(
    await handlerWith({ recoverPasswordFn: async () => { throw poisonedStatus; } })(goodReq()),
    503, "unavailable", "a rejection with a throwing status",
  );

  /* The returned-user gate. */
  const badUsers = [
    [null, "null"],
    [undefined, "undefined"],
    ["a string", "a string"],
    [[], "an array"],
    [{ email: OK_USER_EMAIL }, "a user with no id"],
    [{ id: OK_USER_ID }, "a user with no email"],
    [{ id: 7, email: OK_USER_EMAIL }, "a non-string id"],
    [{ id: OK_USER_ID, email: 7 }, "a non-string email"],
    [{ id: "", email: OK_USER_EMAIL }, "an empty id"],
    [{ id: "-leading", email: OK_USER_EMAIL }, "an id with a leading dash"],
    [{ id: "has space", email: OK_USER_EMAIL }, "an id with a space"],
    [{ id: "a".repeat(129), email: OK_USER_EMAIL }, "an over-long id"],
    [{ id: OK_USER_ID, email: "Invited@example.invalid" }, "an unnormalized email"],
    [{ id: OK_USER_ID, email: " invited@example.invalid " }, "an untrimmed email"],
    [{ id: OK_USER_ID, email: "not-an-email" }, "an email with no domain"],
    [{ id: OK_USER_ID, email: "a@b" }, "an email with no dotted domain"],
    [{ id: OK_USER_ID, email: "a@b.cé" }, "a non-ASCII email"],
    [{ id: OK_USER_ID, email: "a".repeat(250) + "@example.invalid" }, "an over-long email"],
  ];
  for (const [user, label] of badUsers) {
    const response = await handlerWith({ recoverPasswordFn: async () => user })(goodReq());
    await expectError(response, 500, "internal-error", "a returned user that is " + label);
  }

  const accessorUser = {};
  Object.defineProperty(accessorUser, "id", { get: () => OK_USER_ID, enumerable: true, configurable: true });
  Object.defineProperty(accessorUser, "email", { value: OK_USER_EMAIL, enumerable: true, writable: true, configurable: true });
  await expectError(
    await handlerWith({ recoverPasswordFn: async () => accessorUser })(goodReq()),
    500, "internal-error", "a returned user whose id is an accessor",
  );

  const frozenUser = Object.freeze({ id: OK_USER_ID, email: OK_USER_EMAIL });
  await expectError(
    await handlerWith({ recoverPasswordFn: async () => frozenUser })(goodReq()),
    500, "internal-error", "a returned user with non-writable properties",
  );

  const hiddenUser = {};
  Object.defineProperty(hiddenUser, "id", { value: OK_USER_ID, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(hiddenUser, "email", { value: OK_USER_EMAIL, enumerable: true, writable: true, configurable: true });
  await expectError(
    await handlerWith({ recoverPasswordFn: async () => hiddenUser })(goodReq()),
    500, "internal-error", "a returned user with a non-enumerable id",
  );

  /* Only the id and the email may ever be looked at, and neither may be read
     through a getter. A proxy records every property the handler asks about;
     anything beyond the two names, or any use of [[Get]] at all, fails. */
  const target = canonicalUser();
  Object.assign(target, { token: "must not be read", app_metadata: {}, jwt: "must not be read" });
  const queried = [];
  const gets = [];
  const watched = new Proxy(target, {
    get(object, property, receiver) {
      gets.push(String(property));
      return Reflect.get(object, property, receiver);
    },
    getOwnPropertyDescriptor(object, property) {
      queried.push(String(property));
      return Reflect.getOwnPropertyDescriptor(object, property);
    },
    ownKeys(object) {
      queried.push("<ownKeys>");
      return Reflect.ownKeys(object);
    },
  });
  const watchedResponse = await handlerWith({ recoverPasswordFn: async () => watched })(goodReq());
  await expectNoContent(watchedResponse, "a canonical returned user");
  eq(queried.sort().join(","), "email,id", "only id and email are inspected");
  /* Awaiting the provider's result necessarily probes the then property
     once; nothing beyond that may be read. */
  eq(gets.filter((name) => name !== "then").length, 0,
     "no property of the returned user is read beyond the await probe");

  /* Replay. The provider fake keeps the first token it is handed in a
     closure, hands it back to the handler once, and then behaves the way the
     provider does for a spent recovery token. The captured value is never
     printed, written or embedded in a message. */
  const vault = { token: null, calls: 0 };
  const replayFn = async (token, password) => {
    vault.calls += 1;
    void password;
    if (vault.token === null) {
      vault.token = token;
      return canonicalUser();
    }
    throw new AuthError("recovery token has already been used", 400);
  };
  const replayHandler = handlerWith({ recoverPasswordFn: replayFn });
  await expectNoContent(await replayHandler(goodReq()), "the first acceptance");
  const replayed = await replayHandler(
    makeReq("POST", "application/json", jsonBody({ token: vault.token, password: OK_PASSWORD })),
  );
  await expectError(replayed, 400, "invalid-invitation", "a replayed token");
  eq(vault.calls, 2, "each acceptance calls the provider exactly once");
  vault.token = null;
  return 1;
}

/* ---------------- group five: the factory surface ---------------- */

async function groupFive() {
  group = "factory";

  eq(typeof createAcceptHandler(), "function", "the factory defaults to production functions");
  eq(typeof createAcceptHandler({}), "function", "an empty dependency object is allowed");
  eq(
    typeof createAcceptHandler({ requireOriginFn: okOrigin() }),
    "function",
    "a partial dependency object is allowed",
  );

  const rejected = [
    [null, "null"],
    ["", "a string"],
    [7, "a number"],
    [[], "an array"],
    [() => {}, "a function"],
    [Object.create(null), "a null prototype"],
    [Object.assign(Object.create({ inherited: 1 }), {}), "a custom prototype"],
    [{ unknown: () => {} }, "an unknown key"],
    [{ requireOriginFn: 7 }, "a non-callable origin guard"],
    [{ recoverPasswordFn: null }, "a null recovery function"],
    [{ requireOriginFn: okOrigin(), recoverPasswordFn: okRecover(), extra: () => {} }, "an extra key"],
  ];
  for (const [dependencies, label] of rejected) {
    let threw = false;
    try {
      createAcceptHandler(dependencies);
    } catch {
      threw = true;
    }
    check(threw, "the factory must reject " + label + " synchronously");
  }

  const symbolled = { requireOriginFn: okOrigin() };
  symbolled[Symbol("sneaky")] = () => {};
  let symbolThrew = false;
  try {
    createAcceptHandler(symbolled);
  } catch {
    symbolThrew = true;
  }
  check(symbolThrew, "the factory must reject a symbol-keyed dependency");

  const accessor = {};
  Object.defineProperty(accessor, "recoverPasswordFn", {
    get: () => okRecover(),
    enumerable: true,
    configurable: true,
  });
  let accessorThrew = false;
  try {
    createAcceptHandler(accessor);
  } catch {
    accessorThrew = true;
  }
  check(accessorThrew, "the factory must reject an accessor dependency");

  /* Request data can never select a dependency: the default handler is bound
     once, and a body field named after one is simply an extra field. */
  const smuggled = await handlerWith({})(
    makeReq("POST", "application/json", jsonBody({
      token: OK_TOKEN, password: OK_PASSWORD, recoverPasswordFn: "x",
    })),
  );
  eq(smuggled.status, 400, "a dependency name in the body is just an extra field");
  return 1;
}

export default async function run() {
  let completed = 0;
  completed += await groupOne();
  completed += await groupTwo();
  completed += await groupThree();
  completed += await groupFour();
  completed += await groupFive();
  return completed;
}
`;

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") {
    const mode = argv[1];
    if (!MODES.includes(mode) || argv.length !== 2) {
      die("usage: scripts/test-p4-k.mjs --worker contract");
    }
    await worker(mode);
    return;
  }
  const mode = argv[0];
  if (!MODES.includes(mode) || argv.length !== 1) {
    die("usage: scripts/test-p4-k.mjs contract");
  }
  await parent(mode);
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
