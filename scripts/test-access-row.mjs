#!/usr/bin/env node
/**
 * Drive the capability matrix against the four paths that #125 left behind.
 *
 * #125 unified the access-row validator across the three write paths and
 * proved each one with a mutation. It left four copies standing —
 * `netlify/functions/access.mjs`, `session.mjs`, `pending.mjs`, and the one in
 * `events.mjs` that had drifted far enough to be called `assertResolvedAccess`
 * and so never matched that ticket's acceptance grep at all. #128 folds those
 * into `validateAccessRow()`; this runner is the gate that folding needs.
 *
 * The reason it exists is the defect #125 found: `thread.mjs` carried a copy
 * that no test ever exercised, so neutering it left the suite green. All four
 * paths converted here were in the same position — before this file, none of
 * them had a single test of any kind. Sharing one validator makes them all
 * depend on one function; only a matrix that runs through each handler proves
 * that each one actually reaches it.
 *
 * Every row of the matrix is a mutation of a *complete owner* row, chosen so
 * that a validator which wrongly accepted it would produce a status this file
 * distinguishes from the rejection. Each path therefore asserts three
 * outcomes, not one:
 *
 *   - a broken row is the handler's own "impossible server state" status,
 *     with no store work attempted;
 *   - a well-formed row for an under-privileged role reaches that handler's
 *     authorization decision, which is a different status;
 *   - a well-formed owner row runs past the check into the work behind it.
 *
 * Without the second and third assertions, "broken rows are rejected" would
 * also hold for a handler that rejected everything.
 *
 * `access.mjs` and `session.mjs` import their collaborators statically, so
 * their specifiers — and only theirs — are bound to stubs through a resolve
 * hook. `pending.mjs` and `events.mjs` expose dependency-injecting factories
 * and are driven directly. In every case the validator under test is the real
 * `validateAccessRow()` from `netlify/lib/access.mjs`: the stub re-exports the
 * genuine function and controls only `capabilitiesFor` and `resolveRole`, so
 * the assertions run against production logic rather than a double.
 *
 * Output contract: one `PASS` line per section on stdout and exit 0, or one
 * `FAIL` line on stderr and exit 1.
 *
 *   node scripts/test-access-row.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

let failures = 0;

function ok(condition, label) {
  if (condition) return;
  failures += 1;
  process.stderr.write(`FAIL  ${label}\n`);
}

function eq(actual, expected, label) {
  ok(Object.is(actual, expected), `${label} (expected ${expected}, got ${actual})`);
}

const real = (path) => pathToFileURL(join(ROOT, path)).href;

/* ========================================================================= */
/* fixtures                                                                  */
/* ========================================================================= */

const DOC_ID = "4b7d2a";
/* `sub, email, name, isOrg`, in that order: every identity validator on these
   paths requires the exact key order, so a fixture written in another order
   fails as an invalid identity before the access row is ever looked at. */
const USER = Object.freeze({
  sub: "u_fixture_auditor_58",
  email: "marin@example.com",
  name: "Marin Cleave",
  isOrg: true,
});

/** The control surface both stubs and both factories read. */
const control = {
  identify: () => ({ ...USER }),
  resolveRole: null,
  capabilitiesFor: null,
  storeCalls: 0,
};
globalThis.__ACCESSROW__ = control;

/* ========================================================================= */
/* the module resolve hook for the two statically-importing handlers         */
/* ========================================================================= */

const stubRoot = mkdtempSync(join(tmpdir(), "access-row-"));

function bindStaticModules() {
  const stub = (name, source) => {
    const file = join(stubRoot, name);
    writeFileSync(file, source, "utf8");
    return pathToFileURL(file).href;
  };

  /* Each stub re-exports its real module wholesale with `export *` and then
     declares only the collaborators this file controls; an explicit local
     export shadows the same name arriving through the star. Naming the
     pass-through exports individually instead would make every stub a second
     copy of its module's import list, and each time a handler grew a
     dependency the stub would fail to resolve rather than exercise the
     handler — which is how this runner broke when P4-J (#120) landed. */
  const stubs = new Map([
    ["../lib/identity.mjs", stub("identity.mjs", `
      export * from ${JSON.stringify(real("netlify/lib/identity.mjs"))};
      export function identify(req) { return globalThis.__ACCESSROW__.identify(req); }
    `)],
    /* Everything except the two controlled collaborators is the real export.
       `validateAccessRow` above all: substituting it would make this file
       assert against a double of the very function it exists to cover. */
    ["../lib/access.mjs", stub("access.mjs", `
      export * from ${JSON.stringify(real("netlify/lib/access.mjs"))};
      export function capabilitiesFor(role) {
        return globalThis.__ACCESSROW__.capabilitiesFor(role);
      }
      export function resolveRole(docId, user, options) {
        return globalThis.__ACCESSROW__.resolveRole(docId, user, options);
      }
    `)],
    ["../lib/store.mjs", stub("store.mjs", `
      import { StoreError } from ${JSON.stringify(real("netlify/lib/store.mjs"))};
      export * from ${JSON.stringify(real("netlify/lib/store.mjs"))};
      export function docState() {
        globalThis.__ACCESSROW__.storeCalls += 1;
        throw new StoreError("unavailable", 503, "Access store unavailable");
      }
    `)],
  ]);

  const bound = new Set([
    real("netlify/functions/access.mjs"),
    real("netlify/functions/session.mjs"),
  ]);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (bound.has(context.parentURL) && stubs.has(specifier)) {
        return { url: stubs.get(specifier), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

/* ========================================================================= */
/* the matrix                                                                */
/* ========================================================================= */

/**
 * Mutations of a complete owner row. Each one is a shape the shared validator
 * must reject; each is also a shape that, if wrongly accepted, carries enough
 * privilege to reach the work behind the check, so the assertion below can
 * tell acceptance from rejection.
 */
function brokenRows(complete) {
  return [
    ["a missing key", (() => { const copy = { ...complete }; delete copy.canShare; return copy; })()],
    ["an extra key", { ...complete, canPublish: true }],
    ["an unknown role", { ...complete, role: "admin" }],
    ["a non-boolean shared", { ...complete, shared: "yes" }],
    ["a non-boolean capability", { ...complete, canComment: "yes" }],
    ["an invalid threadControl", { ...complete, threadControl: "some" }],
    ["capabilities that disagree with the role", { ...complete, canComment: false }],
    ["an array", Object.freeze([])],
    ["null", null],
    ["a non-ordinary prototype", Object.assign(Object.create({ ping: 1 }), complete)],
    ["an accessor-backed capability", Object.defineProperties({ ...complete }, {
      canComment: { get: () => true, enumerable: true, configurable: true },
    })],
    ["a non-enumerable capability", Object.defineProperty({ ...complete }, "canComment", {
      value: true, enumerable: false, writable: true, configurable: true,
    })],
    ["a symbol-keyed extra", Object.assign({ ...complete }, { [Symbol("canPublish")]: true })],
    /* The key-order requirement `pending.mjs` had grown and the other copies
       had not. A resolved row is always `role`, `shared`, then the frozen
       matrix spread in order, so any other order was assembled elsewhere. */
    ["keys out of matrix order", (() => {
      const { role, shared, ...rest } = complete;
      return { shared, role, ...rest };
    })()],
  ];
}

/** Capability tables no row can be validated against. */
function unusableTables(canonical) {
  return [
    ["a table that throws", () => { throw new Error("no row"); }],
    ["a table answering null", () => null],
    ["a table answering a callable", () => () => true],
    ["a table answering a short row", (role) => {
      const row = { ...canonical(role) };
      delete row.canShare;
      return row;
    }],
    ["a table answering an extra key", (role) => ({ ...canonical(role), canPublish: true })],
    ["a table answering out of order", (role) => {
      const { canRead, ...rest } = canonical(role);
      return { ...rest, canRead };
    }],
    ["a table answering an accessor", (role) => Object.defineProperty(
      { ...canonical(role) }, "canRead", { get: () => true, enumerable: true, configurable: true },
    )],
  ];
}

/* ========================================================================= */
/* per-handler drivers                                                       */
/* ========================================================================= */

const request = (path) => new Request(`https://docs.example.invalid${path}`);

async function main() {
  bindStaticModules();

  const accessLib = await import(real("netlify/lib/access.mjs"));
  const { capabilitiesFor } = accessLib;
  const complete = Object.freeze({ role: "owner", shared: false, ...capabilitiesFor("owner") });
  const rowFor = (role) => ({ role, shared: false, ...capabilitiesFor(role) });

  const sessionHandler = (await import(real("netlify/functions/session.mjs"))).default;
  const accessHandler = (await import(real("netlify/functions/access.mjs"))).default;
  const { createPendingHandler } = await import(real("netlify/functions/pending.mjs"));
  const { createEventsHandler } = await import(real("netlify/functions/events.mjs"));
  const storeLib = await import(real("netlify/lib/store.mjs"));

  /* `pending.mjs` answers 503 for a deploy tree with no manifest at all, which
     would collide with the store-failure status the other paths use as their
     accepted control. One valid manifest for a *different* document makes the
     accepted outcome an unambiguous 404 instead. */
  const manifestRoot = mkdtempSync(join(tmpdir(), "access-row-manifest-"));
  const instance = "fixture";
  mkdirSync(join(manifestRoot, instance, "dist"), { recursive: true });
  writeFileSync(join(manifestRoot, instance, "dist", `${instance}.edit.json`), JSON.stringify({
    docId: "0c1d2e",
    instance,
    commit: "0".repeat(40),
    blocks: {
      a0123456f: {
        file: "sections/orchard-index.html",
        section: "orchard-index",
        tag: "p",
        hash: "b".repeat(64),
      },
    },
  }), "utf8");

  /* Each entry drives one converted path. `run(access, table)` installs the
     resolved row and the capability table, invokes the handler, and reports
     the status plus how much store work the handler attempted. */
  const paths = [
    {
      name: "session.mjs",
      reject: 500,
      async run(access, table = capabilitiesFor) {
        control.storeCalls = 0;
        control.capabilitiesFor = table;
        control.resolveRole = async () => access;
        const response = await sessionHandler(request(`/api/session?doc=${DOC_ID}`));
        return { status: response.status, storeCalls: control.storeCalls };
      },
      /* `session.mjs` opens no store at all: a valid row is simply projected
         into the 200 body, so 200-versus-500 is the whole signal. */
      accepted: [
        ["an owner row", "owner", 200, 0],
        ["a role with no capabilities", "none", 200, 0],
      ],
    },
    {
      name: "access.mjs",
      reject: 500,
      async run(access, table = capabilitiesFor) {
        control.storeCalls = 0;
        control.capabilitiesFor = table;
        control.resolveRole = async () => access;
        const response = await accessHandler(request(`/api/access?doc=${DOC_ID}`));
        return { status: response.status, storeCalls: control.storeCalls };
      },
      /* An accepted owner row reaches `docState()`, which the stub answers
         with the P2-B unavailable error — so 503 with one store call is proof
         the handler ran past the check, and 403 with none is proof it ran past
         the check and then denied on `canSeeMembers`. */
      accepted: [
        ["an owner row", "owner", 503, 1],
        ["a viewer row", "viewer", 403, 0],
      ],
    },
    {
      name: "pending.mjs",
      reject: 500,
      async run(access, table = capabilitiesFor) {
        let storeCalls = 0;
        const handler = createPendingHandler({
          identify: () => ({ ...USER }),
          resolveRole: async () => access,
          capabilitiesFor: table,
          assertIdentitySub: accessLib.assertIdentitySub,
          normalizeEmail: accessLib.normalizeEmail,
          docState: () => { storeCalls += 1; throw new storeLib.StoreError("unavailable", 503, "x"); },
          editPrefix: storeLib.editPrefix,
          editKey: storeLib.editKey,
          read: storeLib.read,
          upgrade: storeLib.upgrade,
          manifestRoot,
        });
        const response = await handler(request(`/api/pending?doc=${DOC_ID}`));
        return { status: response.status, storeCalls };
      },
      /* The manifest root is empty, so an accepted `canRead` row falls through
         to the 404 for an unknown document — a status the rejection can never
         produce. A `none` row is denied at 403 before that lookup. */
      accepted: [
        ["an owner row", "owner", 404, 0],
        ["a role with no capabilities", "none", 403, 0],
      ],
    },
    {
      name: "events.mjs",
      reject: 500,
      async run(access, table = capabilitiesFor) {
        control.storeCalls = 0;
        control.capabilitiesFor = table;
        let storeCalls = 0;
        const handler = createEventsHandler({
          requireOriginFn: () => {},
          identifyFn: () => ({ ...USER }),
          resolveRoleFn: async () => access,
          storeFn: () => { storeCalls += 1; throw new storeLib.StoreError("unavailable", 503, "x"); },
        });
        const response = await handler(request(`/api/events?doc=${DOC_ID}&month=2026-01`));
        return { status: response.status, storeCalls };
      },
      /* `events.mjs` authorizes before it opens the store, so an accepted
         owner row reaches `storeFn()` and reports 503, while a viewer row is
         denied on `canSeeMembers` with the store untouched. */
      accepted: [
        ["an owner row", "owner", 503, 1],
        ["a viewer row", "viewer", 403, 0],
      ],
      /* Alone among the four, `events.mjs` takes no capability table as a
         dependency — its factory injects the identity, role and store
         collaborators but reads `capabilitiesFor` from the module scope. There
         is no table to make unusable, so it always validates against the real
         matrix and the table cases below do not apply to it. */
      injectableTable: false,
    },
  ];

  /* ---- every path rejects every broken row, without doing any work ------ */

  for (const path of paths) {
    for (const [label, access] of brokenRows(complete)) {
      const { status, storeCalls } = await path.run(access);
      eq(status, path.reject, `${path.name}: ${label} is ${path.reject}`);
      eq(storeCalls, 0, `${path.name}: ${label} performs no store work`);
    }
  }

  /* ---- and rejects a valid row against an unusable capability table ----- */

  for (const path of paths.filter((path) => path.injectableTable !== false)) {
    for (const [label, table] of unusableTables(capabilitiesFor)) {
      const { status, storeCalls } = await path.run(rowFor("owner"), table);
      eq(status, path.reject, `${path.name}: ${label} is ${path.reject}`);
      eq(storeCalls, 0, `${path.name}: ${label} performs no store work`);
    }
  }

  /* ---- while a row the validator accepts still runs the path ------------ */

  for (const path of paths) {
    for (const [label, role, expected, expectedStoreCalls] of path.accepted) {
      const { status, storeCalls } = await path.run(rowFor(role));
      eq(status, expected, `${path.name}: ${label} is ${expected}`);
      eq(storeCalls, expectedStoreCalls, `${path.name}: ${label} store calls`);
    }
  }

  rmSync(manifestRoot, { recursive: true, force: true });

  if (failures === 0) {
    process.stdout.write("PASS  access-row matrix across the four converted paths\n");
  }

  /* ---- the call-graph acceptance, asserted rather than grepped by name -- */

  /* The acceptance property, asserted on the call graph rather than grepped by
     name. #125's acceptance check was `grep "function validateAccess"`, which
     `events.mjs` escaped simply by calling its copy `assertResolvedAccess`;
     `gate.ts` escapes it too, as `validResolvedAccess`. Naming is not the
     invariant. The invariant is that a module which resolves a role reaches
     the shared validator, and the exceptions are named here so that adding a
     new one fails rather than passing silently. */
  const { readFileSync, readdirSync } = await import("node:fs");
  const sourceDirs = ["netlify/functions", "netlify/edge-functions"];
  const unshared = sourceDirs.flatMap((dir) => readdirSync(join(ROOT, dir))
    .filter((name) => /\.(mjs|ts)$/.test(name))
    .filter((name) => {
      const source = readFileSync(join(ROOT, dir, name), "utf8");
      return source.includes("resolveRole") && !source.includes("validateAccessRow");
    })
    .map((name) => `${dir}/${name}`))
    .sort();

  /* Two known exceptions, both out of scope for #128 and both filed:
     - `realtime-token.mjs` never validated the row against the matrix at all.
       It checks only `canRead`, so a row claiming `role: "none", canRead: true`
       mints a token. That is a missing check, not a copy to fold in, and
       closing it changes the authentication path's error surface.
     - `gate.ts` is the Deno edge gate. Its `validResolvedAccess()` is a real
       hand copy and it already imports from `../lib/access.mjs`, but it runs
       on a different runtime with no test harness of its own, and its copy
       requires writable-and-configurable descriptors that the shared validator
       does not. Folding it in is a behaviour change on the request path that
       fronts every document, and belongs in its own ticket. */
  eq(unshared.join(", "), "netlify/edge-functions/gate.ts, netlify/functions/realtime-token.mjs",
    "exactly the known role-resolving modules that bypass the shared validator");

  if (failures === 0) {
    process.stdout.write("PASS  every role-resolving module reaches the shared validator\n");
  }

  return failures === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`FAIL  access-row runner: ${error.stack}\n`);
  process.exitCode = 1;
} finally {
  rmSync(stubRoot, { recursive: true, force: true });
}
