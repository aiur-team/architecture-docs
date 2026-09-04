#!/usr/bin/env node
/**
 * P4-T — the permanent retention policy regression runner.
 *
 *   node scripts/test-p4-t.mjs
 *
 * One entry point, no arguments, one line of output. The script proves the
 * amended `netlify/functions/retention.mjs` twice: once as a source oracle over
 * its own AST — exact imports, exact exports, one schedule, and no identity,
 * network, process-descendant or bulk-delete surface — and once as a runtime
 * matrix driving the real module inside a closed VM realm whose only imports
 * are deterministic synthetic stand-ins for P2-B, P3-B, P2-G, P4-J and P4-O.
 *
 * Nothing here reads a credential, a real repository, a remote provider or a
 * private fixture. Every record, key, actor and address is invented.
 *
 * The matrix is the canonical fixture from `docs/tickets/P4-T.md`, plus the
 * three deletion-safety cases issue #97 found missing from P4-F's own test
 * plan: a duplicate listed key, a page-entry bound proved with distinct keys
 * and an asserted error, and validation before delete on each prefix.
 *
 * `vm.SourceTextModule` needs `--experimental-vm-modules`, so the script
 * re-executes itself once with that flag rather than making the caller
 * remember it. Node always prints an ExperimentalWarning under that flag; the
 * exit code and the single PASS line are the exact signal.
 */

import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import vm from "node:vm";

const FLAG = "--experimental-vm-modules";
const TIMEOUT_MS = 30_000;

if (typeof vm.SourceTextModule !== "function") {
  const child = spawn(
    process.execPath,
    [FLAG, new URL(import.meta.url).pathname, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
} else {
  await main();
}

async function main() {
  const require = createRequire(import.meta.url);
  let ts;
  try {
    ts = require("../templates/docbuild/node_modules/typescript");
  } catch {
    process.stderr.write(
      "FAIL  typescript is not installed; run" +
        " `npm --prefix templates/docbuild ci --no-audit --no-fund` first\n",
    );
    process.exit(1);
  }

  const file = "netlify/functions/retention.mjs";
  const source = await readFile(file, "utf8");

  sourceOracle(ts, file, source);
  await runtimeMatrix(file, source);

  console.log("PASS  P4-T retention policy matrix");
}

/**
 * Prove the module's shape without executing it: exact import specifiers, exact
 * export names, exactly one `schedule` property, and zero occurrences of the
 * surfaces a scheduled maintenance sweep must never grow.
 */
function sourceOracle(ts, file, source) {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(sf.parseDiagnostics.length, 0);

  const imports = [];
  const exports = [];
  let deleteAll = 0;
  let network = 0;
  let identity = 0;
  let schedule = 0;
  let descendantSurface = 0;

  const visit = (n) => {
    if (ts.isImportDeclaration(n)) imports.push(n.moduleSpecifier.text);
    const exported =
      ts.canHaveModifiers(n) &&
      ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isFunctionDeclaration(n) && n.name) {
      exports.push(
        ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
          ? "default"
          : n.name.text,
      );
    }
    if (exported && ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) exports.push(d.name.text);
      }
    }
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "schedule") {
      schedule++;
    }
    if (ts.isCallExpression(n)) {
      const x = n.expression.getText(sf);
      if (x.endsWith(".deleteAll")) deleteAll++;
      if (/fetch|listen|setTimeout|setInterval/.test(x)) network++;
      if (/identify|resolveRole/.test(x)) identity++;
      if (
        n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        /(?:^|\.)(?:spawn|spawnSync|exec|execFile|fork)$/.test(x)
      ) {
        descendantSurface++;
      }
    }
    if (
      ts.isNewExpression(n) &&
      /(?:^|\.)(?:Worker|SharedWorker)$/.test(n.expression.getText(sf))
    ) {
      descendantSurface++;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  assert.deepEqual(
    imports.sort(),
    [
      "../lib/access.mjs",
      "../lib/store.mjs",
      "./access.mjs",
      "./events.mjs",
      "./suggestions.mjs",
    ].sort(),
  );
  assert.deepEqual(
    exports.sort(),
    [
      "DURABLE_EVENT_KINDS",
      "EVENT_RETENTION_MS",
      "MAX_EVENT_DELETES",
      "MAX_INVITATION_DELETES",
      "MAX_INVITATION_RECORDS",
      "MAX_SUGGESTION_DELETES",
      "SUGGESTION_RETENTION_MS",
      "config",
      "createRetentionHandler",
      "default",
      "sweepEvents",
      "sweepInvitations",
      "sweepSuggestions",
    ].sort(),
  );
  assert.equal(deleteAll + network + identity + descendantSurface, 0);
  assert.equal(schedule, 1);
}

/**
 * Drive the real module against invented records through synthetic predecessor
 * modules, proving the deletion matrix, the caps, the ordering, the race
 * fences, the failure precedence and the one log line.
 */
async function runtimeMatrix(file, source) {
  const now = Date.parse("2026-09-03T00:00:00.000Z");
  const old = now - 46_656_000_000 - 1;
  const actor = {
    sub: "u_fixture",
    name: "Avery Quill",
    email: "avery@example.invalid",
  };
  const durable = [
    "suggest.create",
    "suggest.accept",
    "suggest.reject",
    "edit.apply",
    "access.invite",
    "access.change",
    "access.revoke",
    "access.transfer",
  ];
  const deleted = [];
  const validatorFailure = {
    event: new Error("event validator fixture failure"),
    suggestion: new Error("suggestion validator fixture failure"),
    invitation: new Error("invitation validator fixture failure"),
  };
  const deleteFailure = new Error("delete fixture failure");
  const leaseBoundaryAssertion = new assert.AssertionError({
    message: "invitation delete crossed its held lease",
  });
  const failValidation = { event: false, suggestion: false, invitationCall: 0 };
  let deleteFailurePrefix = "";
  let deleteAssertionPrefix = "";
  let invitationValidationCalls = 0;
  let leaseMode = "acquire";
  let beforeLeaseRun = null;
  // The lease fake models held/released state, and the store refuses an
  // invitation delete outside it. Without this the delete could be moved after
  // `withAccessWriteLease` resolves and every assertion would still pass, which
  // reintroduces exactly the renewal race the lease exists to prevent.
  let leaseHeldFor = null;
  const validatedEvents = [];
  const storeErrorCalls = [];
  const event = (kind, i) => ({
    v: 1,
    id: `${old}-${String(i).padStart(6, "0")}`,
    docId: "4b7d2a",
    ts: new Date(old).toISOString(),
    actor,
    kind,
    target: {},
    docVersion: kind.startsWith("access.") ? null : "7aaca51",
    summary: "invented audit summary",
  });
  const eventEntries = [...durable, "comment.create"].map((kind, i) => {
    const e = event(kind, i + 1);
    return [`events/4b7d2a/${e.ts.slice(0, 7)}/${e.id}.json`, e];
  });
  const pagesByPrefix = { "events/": eventEntries, "suggest/": [], "access/": [] };
  const records = new Map(eventEntries);
  const validatedSuggestions = [];
  const validatedInvitations = [];
  const leasedDocs = [];
  const store = {
    list({ prefix, paginate }) {
      assert.equal(paginate, true);
      return (async function* () {
        yield { blobs: (pagesByPrefix[prefix] ?? []).map(([key]) => ({ key })) };
      })();
    },
    async delete(k) {
      if (k.startsWith("access/")) {
        assert.equal(
          leaseHeldFor,
          k.slice("access/".length, k.indexOf("/i/")),
          "invitation delete must happen inside that document's held lease",
        );
      }
      if (deleteFailurePrefix && k.startsWith(deleteFailurePrefix)) {
        throw deleteFailure;
      }
      if (deleteAssertionPrefix && k.startsWith(deleteAssertionPrefix)) {
        throw leaseBoundaryAssertion;
      }
      deleted.push(k);
      records.delete(k);
    },
  };
  const context = vm.createContext({
    console,
    Date,
    Error,
    Map,
    Object,
    Promise,
    Response,
    Set,
    TextEncoder,
    TypeError,
    URL,
  });
  const mod = new vm.SourceTextModule(source, { context, identifier: file });
  await mod.link(async (specifier) => {
    if (specifier === "../lib/store.mjs") {
      return new vm.SyntheticModule(
        ["StoreError", "docState", "eventKey", "read", "suggestionKey"],
        function () {
          class StoreError extends Error {
            constructor(...args) {
              super(args[0]);
              storeErrorCalls.push(args);
            }
          }
          this.setExport("StoreError", StoreError);
          this.setExport("docState", () => store);
          this.setExport(
            "eventKey",
            (d, t, i) => `events/${d}/${t.slice(0, 7)}/${i}.json`,
          );
          this.setExport(
            "suggestionKey",
            (d, a, i) => `suggest/${d}/${a}/${i}.json`,
          );
          this.setExport("read", async (s, k) => records.get(k) ?? null);
        },
        { context },
      );
    }
    if (specifier === "./events.mjs") {
      return new vm.SyntheticModule(
        ["assertEvent"],
        function () {
          this.setExport("assertEvent", (v, k) => {
            validatedEvents.push(k);
            if (failValidation.event) throw validatorFailure.event;
            return structuredClone(v);
          });
        },
        { context },
      );
    }
    if (specifier === "./suggestions.mjs") {
      return new vm.SyntheticModule(
        ["assertSuggestionAtKey"],
        function () {
          this.setExport("assertSuggestionAtKey", async (v, d, k) => {
            validatedSuggestions.push([d, k]);
            if (failValidation.suggestion) throw validatorFailure.suggestion;
            assert.equal(v.docId, d);
            return structuredClone(v);
          });
        },
        { context },
      );
    }
    if (specifier === "../lib/access.mjs") {
      return new vm.SyntheticModule(
        ["assertAccessInvitationAtKey"],
        function () {
          this.setExport("assertAccessInvitationAtKey", async (v, d, k) => {
            invitationValidationCalls++;
            validatedInvitations.push([d, k]);
            if (failValidation.invitationCall === invitationValidationCalls) {
              throw validatorFailure.invitation;
            }
            assert.equal(v.docId, d);
            return structuredClone(v);
          });
        },
        { context },
      );
    }
    if (specifier === "./access.mjs") {
      return new vm.SyntheticModule(
        ["withAccessWriteLease"],
        function () {
          this.setExport("withAccessWriteLease", async (options) => {
            assert.deepEqual(Object.keys(options).sort(), [
              "doc",
              "nowMs",
              "run",
              "store",
            ]);
            const { store: s, doc, nowMs, run } = options;
            assert.equal(s, store);
            assert.equal(nowMs, now);
            leasedDocs.push(doc);
            if (leaseMode === "busy") return { acquired: false };
            if (beforeLeaseRun) {
              const fn = beforeLeaseRun;
              beforeLeaseRun = null;
              await fn();
            }
            leaseHeldFor = doc;
            try {
              return { acquired: true, value: await run() };
            } finally {
              leaseHeldFor = null;
            }
          });
        },
        { context },
      );
    }
    throw new Error(`unexpected import ${specifier}`);
  });
  await mod.evaluate();

  const deadline = setTimeout(() => {
    console.error("FAIL  P4-T fixture exceeded 30 seconds");
    process.exit(124);
  }, TIMEOUT_MS);

  // --- durable exclusions -------------------------------------------------
  assert.deepEqual([...mod.namespace.DURABLE_EVENT_KINDS], durable);
  const result = await mod.namespace.sweepEvents({ store, nowMs: now });
  assert.equal(result.retained, 8);
  assert.equal(result.deleted, 1);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /000009\.json$/);
  assert.deepEqual(validatedEvents, eventEntries.map(([key]) => key));

  // --- suggestion cutoff equality ----------------------------------------
  deleted.length = 0;
  const suggestionTimes = [
    now - 7_776_000_000 - 1,
    now - 7_776_000_000,
    now - 7_776_000_000 + 1,
  ];
  const suggestionEntries = suggestionTimes.map((ms, i) => {
    const id = `s_${ms.toString(36)}_${String(i + 1).padStart(8, "0")}`;
    const key = `suggest/4b7d2a/a3f19c2b7/${id}.json`;
    return [
      key,
      { v: 1, id, docId: "4b7d2a", aid: "a3f19c2b7", at: new Date(ms).toISOString() },
    ];
  });
  pagesByPrefix["suggest/"] = suggestionEntries;
  for (const pair of suggestionEntries) records.set(...pair);
  const suggestions = await mod.namespace.sweepSuggestions({ store, nowMs: now });
  assert.deepEqual(
    {
      candidates: suggestions.candidates,
      deleted: suggestions.deleted,
      remaining: suggestions.remaining,
    },
    { candidates: 1, deleted: 1, remaining: false },
  );
  assert.equal(validatedSuggestions.length, 1);
  assert.deepEqual(deleted, [suggestionEntries[0][0]]);

  // --- invitation expiry, doc/grant ignore --------------------------------
  deleted.length = 0;
  const invitationEntries = [
    [
      "access/4b7d2a/i/00000000000000000000000000000001.json",
      { v: 1, docId: "4b7d2a", expiresAt: new Date(now - 1).toISOString() },
    ],
    [
      "access/4b7d2a/i/00000000000000000000000000000002.json",
      { v: 1, docId: "4b7d2a", expiresAt: new Date(now).toISOString() },
    ],
    [
      "access/4b7d2a/i/00000000000000000000000000000003.json",
      { v: 1, docId: "4b7d2a", expiresAt: new Date(now + 1).toISOString() },
    ],
  ];
  pagesByPrefix["access/"] = [
    ...invitationEntries,
    ["access/4b7d2a/doc.json", { v: 1 }],
    ["access/4b7d2a/g/u_fixture.json", { v: 1 }],
  ];
  for (const pair of invitationEntries) records.set(...pair);
  const invitations = await mod.namespace.sweepInvitations({ store, nowMs: now });
  assert.deepEqual(
    {
      records: invitations.records,
      expired: invitations.expired,
      deleted: invitations.deleted,
      remaining: invitations.remaining,
    },
    { records: 3, expired: 2, deleted: 2, remaining: false },
  );
  assert.deepEqual(validatedSuggestions, [["4b7d2a", suggestionEntries[0][0]]]);
  assert.deepEqual(validatedInvitations, [
    ["4b7d2a", invitationEntries[0][0]],
    ["4b7d2a", invitationEntries[1][0]],
    ["4b7d2a", invitationEntries[2][0]],
    ["4b7d2a", invitationEntries[0][0]],
    ["4b7d2a", invitationEntries[1][0]],
  ]);
  assert.deepEqual(leasedDocs, ["4b7d2a", "4b7d2a"]);
  assert.deepEqual(deleted, invitationEntries.slice(0, 2).map(([key]) => key));

  // --- per-class caps -----------------------------------------------------
  records.clear();
  deleted.length = 0;
  const cappedSuggestions = Array.from({ length: 76 }, (_, i) => {
    const ms = now - 7_776_000_000 - 1 - i;
    const id = `s_${ms.toString(36)}_${i.toString(16).padStart(8, "0")}`;
    return [
      `suggest/4b7d2a/a3f19c2b7/${id}.json`,
      { v: 1, id, docId: "4b7d2a", aid: "a3f19c2b7", at: new Date(ms).toISOString() },
    ];
  });
  pagesByPrefix["suggest/"] = cappedSuggestions;
  for (const pair of cappedSuggestions) records.set(...pair);
  const capped = await mod.namespace.sweepSuggestions({ store, nowMs: now });
  assert.equal(capped.deleted, 75);
  assert.equal(capped.remaining, true);
  assert.equal(deleted.length, 75);
  assert.equal(records.size, 1);

  const tooManyInvites = Array.from({ length: 251 }, (_, i) => [
    `access/4b7d2a/i/${i.toString(16).padStart(32, "0")}.json`,
    { v: 1 },
  ]);
  pagesByPrefix["access/"] = tooManyInvites;
  await assert.rejects(() => mod.namespace.sweepInvitations({ store, nowMs: now }));
  pagesByPrefix["access/"] = [["access/4b7d2a/i/not-a-hash.json", { v: 1 }]];
  await assert.rejects(() => mod.namespace.sweepInvitations({ store, nowMs: now }));

  // --- provider bounds ----------------------------------------------------
  const pageOverflow = {
    ...store,
    list() {
      return (async function* () {
        yield {
          blobs: Array.from({ length: 1001 }, (_, i) => ({
            key: `suggest/4b7d2a/a3f19c2b7/s_${(now + i).toString(36)}_${i
              .toString(16)
              .padStart(8, "0")}.json`,
          })),
        };
      })();
    },
  };
  await assert.rejects(() =>
    mod.namespace.sweepSuggestions({ store: pageOverflow, nowMs: now }),
  );
  const pageCountOverflow = {
    ...store,
    list() {
      return (async function* () {
        for (let i = 0; i < 11; i++) yield { blobs: [] };
      })();
    },
  };
  await assert.rejects(() =>
    mod.namespace.sweepSuggestions({ store: pageCountOverflow, nowMs: now }),
  );

  // --- invitation race fences ---------------------------------------------
  const raceKey = "access/4b7d2a/i/00000000000000000000000000000004.json";
  const expiredRace = {
    v: 1,
    docId: "4b7d2a",
    role: "viewer",
    expiresAt: new Date(now - 1).toISOString(),
  };
  const installRace = (value = expiredRace) => {
    records.clear();
    deleted.length = 0;
    pagesByPrefix["access/"] = [[raceKey, value]];
    records.set(raceKey, value);
  };
  installRace();
  leaseMode = "busy";
  const busy = await mod.namespace.sweepInvitations({ store, nowMs: now });
  assert.deepEqual(
    { deleted: busy.deleted, remaining: busy.remaining },
    { deleted: 0, remaining: true },
  );
  assert.deepEqual(deleted, []);

  installRace();
  leaseMode = "acquire";
  beforeLeaseRun = () =>
    records.set(raceKey, {
      ...expiredRace,
      expiresAt: new Date(now + 1).toISOString(),
    });
  const renewed = await mod.namespace.sweepInvitations({ store, nowMs: now });
  assert.deepEqual(
    { deleted: renewed.deleted, remaining: renewed.remaining },
    { deleted: 0, remaining: false },
  );
  assert.deepEqual(deleted, []);

  installRace();
  beforeLeaseRun = () => records.set(raceKey, { ...expiredRace, role: "editor" });
  const changed = await mod.namespace.sweepInvitations({ store, nowMs: now });
  assert.deepEqual(
    { deleted: changed.deleted, remaining: changed.remaining },
    { deleted: 0, remaining: true },
  );
  assert.deepEqual(deleted, []);

  installRace();
  beforeLeaseRun = () => records.delete(raceKey);
  const consumed = await mod.namespace.sweepInvitations({ store, nowMs: now });
  assert.deepEqual(
    { deleted: consumed.deleted, remaining: consumed.remaining },
    { deleted: 0, remaining: false },
  );
  assert.deepEqual(deleted, []);

  // --- validation before delete, on every prefix --------------------------
  const ordinaryEvent = event("comment.create", 91);
  const ordinaryEventKey = `events/4b7d2a/${ordinaryEvent.ts.slice(0, 7)}/${
    ordinaryEvent.id
  }.json`;
  records.clear();
  deleted.length = 0;
  pagesByPrefix["events/"] = [[ordinaryEventKey, ordinaryEvent]];
  records.set(ordinaryEventKey, ordinaryEvent);
  failValidation.event = true;
  await assert.rejects(
    () => mod.namespace.sweepEvents({ store, nowMs: now }),
    (error) => error === validatorFailure.event,
  );
  assert.deepEqual(deleted, []);
  failValidation.event = false;

  const oldSuggestion = suggestionEntries[0];
  records.clear();
  deleted.length = 0;
  pagesByPrefix["suggest/"] = [oldSuggestion];
  records.set(...oldSuggestion);
  failValidation.suggestion = true;
  await assert.rejects(
    () => mod.namespace.sweepSuggestions({ store, nowMs: now }),
    (error) => error === validatorFailure.suggestion,
  );
  assert.deepEqual(deleted, []);
  failValidation.suggestion = false;

  installRace();
  failValidation.invitationCall = invitationValidationCalls + 1;
  await assert.rejects(
    () => mod.namespace.sweepInvitations({ store, nowMs: now }),
    (error) => error === validatorFailure.invitation,
  );
  assert.deepEqual(deleted, []);
  installRace();
  failValidation.invitationCall = invitationValidationCalls + 2;
  await assert.rejects(
    () => mod.namespace.sweepInvitations({ store, nowMs: now }),
    (error) => error === validatorFailure.invitation,
  );
  assert.deepEqual(deleted, []);
  failValidation.invitationCall = 0;

  // A lease-boundary assertion is a programmer error, not a provider outage.
  // Preserve its identity so a misplaced invitation delete fails with the
  // invariant's useful message rather than a misleading StoreError.
  installRace();
  deleteAssertionPrefix = "access/";
  {
    const before = storeErrorCalls.length;
    await assert.rejects(
      () => mod.namespace.sweepInvitations({ store, nowMs: now }),
      (error) => error === leaseBoundaryAssertion,
    );
    assert.equal(storeErrorCalls.length, before);
  }
  assert.deepEqual(deleted, []);
  deleteAssertionPrefix = "";

  // --- provider delete failure maps to one store error --------------------
  const expectDeleteFailure = async (run) => {
    const before = storeErrorCalls.length;
    await assert.rejects(run);
    assert.equal(storeErrorCalls.length, before + 1);
    assert.deepEqual(storeErrorCalls.at(-1), [
      "unavailable",
      503,
      "State store unavailable",
    ]);
  };
  records.clear();
  deleted.length = 0;
  pagesByPrefix["events/"] = [[ordinaryEventKey, ordinaryEvent]];
  records.set(ordinaryEventKey, ordinaryEvent);
  deleteFailurePrefix = "events/";
  await expectDeleteFailure(() => mod.namespace.sweepEvents({ store, nowMs: now }));
  assert.deepEqual(deleted, []);
  records.clear();
  pagesByPrefix["suggest/"] = [oldSuggestion];
  records.set(...oldSuggestion);
  deleteFailurePrefix = "suggest/";
  await expectDeleteFailure(() =>
    mod.namespace.sweepSuggestions({ store, nowMs: now }),
  );
  assert.deepEqual(deleted, []);
  installRace();
  deleteFailurePrefix = "access/";
  await expectDeleteFailure(() =>
    mod.namespace.sweepInvitations({ store, nowMs: now }),
  );
  assert.deepEqual(deleted, []);
  deleteFailurePrefix = "";

  // --- fixed-order concurrent start, all-settled failure precedence -------
  records.clear();
  deleted.length = 0;
  pagesByPrefix["events/"] = [[ordinaryEventKey, ordinaryEvent]];
  pagesByPrefix["suggest/"] = [oldSuggestion];
  pagesByPrefix["access/"] = [];
  records.set(ordinaryEventKey, ordinaryEvent);
  records.set(...oldSuggestion);
  failValidation.event = true;
  failValidation.suggestion = true;
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const gates = {
    "events/": deferred(),
    "suggest/": deferred(),
    "access/": deferred(),
  };
  const starts = [];
  const fairLog = [];
  const fairStore = {
    list({ prefix, paginate }) {
      assert.equal(paginate, true);
      starts.push(prefix);
      return (async function* () {
        await gates[prefix].promise;
        yield { blobs: pagesByPrefix[prefix].map(([key]) => ({ key })) };
      })();
    },
    async delete() {
      throw new Error("unexpected fair-store delete");
    },
  };
  const fairRun = mod.namespace.createRetentionHandler({
    storeFn: () => fairStore,
    nowFn: () => now,
    logFn: (line) => fairLog.push(line),
  })(new Request("https://fixture.invalid/ignored"));
  let fairSettled = false;
  fairRun.then(
    () => {
      fairSettled = true;
    },
    () => {
      fairSettled = true;
    },
  );
  await Promise.resolve();
  assert.deepEqual(starts, ["events/", "suggest/", "access/"]);
  gates["events/"].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fairSettled, false);
  gates["suggest/"].resolve();
  gates["access/"].resolve();
  await assert.rejects(
    () => fairRun,
    (error) => error === validatorFailure.event,
  );
  assert.deepEqual(fairLog, []);
  failValidation.event = false;
  failValidation.suggestion = false;

  // --- issue #97: the three cases P4-F's own fixture could not detect -----
  // 1. A duplicate listed key aborts the scan before any delete, rather than
  //    being silently skipped.
  records.clear();
  deleted.length = 0;
  pagesByPrefix["access/"] = [];
  for (const [prefix, entry] of [
    ["events/", [ordinaryEventKey, ordinaryEvent]],
    ["suggest/", oldSuggestion],
  ]) {
    records.clear();
    deleted.length = 0;
    records.set(...entry);
    const duplicating = {
      ...store,
      list() {
        return (async function* () {
          yield { blobs: [{ key: entry[0] }, { key: entry[0] }] };
        })();
      },
    };
    const sweep =
      prefix === "events/"
        ? mod.namespace.sweepEvents
        : mod.namespace.sweepSuggestions;
    await assert.rejects(
      () => sweep({ store: duplicating, nowMs: now }),
      (error) =>
        error.name === "RetentionError" &&
        error.code ===
          (prefix === "events/" ? "invalid-event-key" : "invalid-suggestion-key"),
    );
    assert.deepEqual(deleted, []);
  }

  // 2. The page-entry bound is proved with 1,001 *distinct* keys, so the
  //    duplicate guard cannot mask it, and the raised error is asserted.
  records.clear();
  deleted.length = 0;
  const distinctOverflow = {
    ...store,
    list() {
      return (async function* () {
        yield {
          blobs: Array.from({ length: 1001 }, (_, i) => ({
            key: `events/4b7d2a/2020-01/${(1_577_836_800_000 + i)
              .toString()
              .padStart(13, "0")}-${i.toString(16).padStart(6, "0")}.json`,
          })),
        };
      })();
    },
  };
  {
    const before = storeErrorCalls.length;
    await assert.rejects(() =>
      mod.namespace.sweepEvents({ store: distinctOverflow, nowMs: now }),
    );
    assert.equal(storeErrorCalls.length, before + 1);
    assert.deepEqual(storeErrorCalls.at(-1), [
      "unavailable",
      503,
      "State store unavailable",
    ]);
  }
  assert.deepEqual(deleted, []);

  // 3. A corrupt key under a swept prefix aborts rather than being skipped.
  for (const [sweep, key, code] of [
    [mod.namespace.sweepEvents, "events/4b7d2a/2020-01/nope.json", "invalid-event-key"],
    [
      mod.namespace.sweepSuggestions,
      "suggest/4b7d2a/a3f19c2b7/nope.json",
      "invalid-suggestion-key",
    ],
  ]) {
    records.clear();
    deleted.length = 0;
    const corrupt = {
      ...store,
      list() {
        return (async function* () {
          yield { blobs: [{ key }] };
        })();
      },
    };
    await assert.rejects(
      () => sweep({ store: corrupt, nowMs: now }),
      (error) => error.name === "RetentionError" && error.code === code,
    );
    assert.deepEqual(deleted, []);
  }

  // --- key/body time agreement --------------------------------------------
  // A suggestion ID carries its own creation time, so a segment that cannot
  // decode canonically into a safe integer, and a stored `at` that disagrees
  // with the segment that did, are both corrupt state rather than a deletion
  // decision to make anyway.
  // An overflowing and a non-canonical base-36 segment, each paired with the
  // body a decoder that gave up and returned a sentinel would have accepted,
  // so only the decode's own overflow/canonicality guard can reject them.
  for (const segment of ["z".repeat(20), "0abc"]) {
    records.clear();
    deleted.length = 0;
    const key = `suggest/4b7d2a/a3f19c2b7/s_${segment}_00000001.json`;
    const badKey = {
      ...store,
      list() {
        return (async function* () {
          yield { blobs: [{ key }] };
        })();
      },
    };
    records.set(key, { v: 1, docId: "4b7d2a", at: new Date(-1).toISOString() });
    await assert.rejects(
      () => mod.namespace.sweepSuggestions({ store: badKey, nowMs: now }),
      (error) =>
        error.name === "RetentionError" && error.code === "invalid-suggestion-key",
    );
    assert.deepEqual(deleted, []);
  }

  // A stored `at` that is the right instant in the wrong text, and one that is
  // simply a different instant. Neither may become a deletion.
  const idMs = now - 7_776_000_000 - 1;
  const id = `s_${idMs.toString(36)}_000000ff`;
  for (const at of [
    new Date(idMs).toISOString().replace("Z", "+00:00"),
    new Date(idMs + 1).toISOString(),
  ]) {
    const key = `suggest/4b7d2a/a3f19c2b7/${id}.json`;
    records.clear();
    deleted.length = 0;
    pagesByPrefix["suggest/"] = [
      [key, { v: 1, id, docId: "4b7d2a", aid: "a3f19c2b7", at }],
    ];
    records.set(...pagesByPrefix["suggest/"][0]);
    await assert.rejects(
      () => mod.namespace.sweepSuggestions({ store, nowMs: now }),
      (error) =>
        error.name === "RetentionError" && error.code === "invalid-suggestion-key",
    );
    assert.deepEqual(deleted, []);
  }

  // --- a long but legal grant key does not wedge the invitation sweep -----
  // P2-B admits a 128-character identity subject, so `access/<docId>/u/<sub>`
  // reaches 149 bytes. That key belongs to a record class this sweep skips,
  // but it is still listed, and treating it as an over-long foreign key would
  // report the application's own data as provider unavailability and stop
  // expired invitations from ever being deleted again.
  {
    const longSub = `u${"a".repeat(127)}`;
    const grantKey = `access/4b7d2a/u/${longSub}.json`;
    assert.equal(Buffer.byteLength(grantKey), 149);
    const expiredKey = "access/4b7d2a/i/000000000000000000000000000000ab.json";
    const expiredInvitation = {
      v: 1,
      docId: "4b7d2a",
      expiresAt: new Date(now - 1).toISOString(),
    };
    records.clear();
    deleted.length = 0;
    pagesByPrefix["access/"] = [
      [grantKey, { v: 1 }],
      [expiredKey, expiredInvitation],
    ];
    records.set(expiredKey, expiredInvitation);
    const withLongGrant = await mod.namespace.sweepInvitations({
      store,
      nowMs: now,
    });
    assert.deepEqual(
      {
        scanned: withLongGrant.scanned,
        records: withLongGrant.records,
        deleted: withLongGrant.deleted,
      },
      { scanned: 2, records: 1, deleted: 1 },
    );
    assert.deepEqual(deleted, [expiredKey]);
  }

  // --- durable kinds survive at every age, not just one -------------------
  // The canonical fixture puts every durable event at exactly 540 days + 1 ms.
  // The acceptance criterion is "at 540 days, 24 months, and any later age", so
  // an age-dependent retain predicate would pass that fixture while destroying
  // the only authorship and authority record the product has.
  assert.ok(Object.isFrozen(mod.namespace.DURABLE_EVENT_KINDS));
  {
    const ages = [
      46_656_000_000 + 1, // 540 days + 1 ms
      63_072_000_000, // 24 months
      315_360_000_000, // 10 years
      631_152_000_000, // 20 years (the oldest a 13-digit event ID can express)
    ];
    records.clear();
    deleted.length = 0;
    const aged = [];
    for (const [ageIndex, age] of ages.entries()) {
      const ms = now - age;
      for (const [kindIndex, kind] of durable.entries()) {
        const id = `${ms}-${String(ageIndex * 100 + kindIndex).padStart(6, "0")}`;
        const ts = new Date(ms).toISOString();
        aged.push([
          `events/4b7d2a/${ts.slice(0, 7)}/${id}.json`,
          { ...event(kind, 1), id, ts, kind },
        ]);
      }
    }
    pagesByPrefix["events/"] = aged;
    for (const pair of aged) records.set(...pair);
    const survived = await mod.namespace.sweepEvents({ store, nowMs: now });
    assert.deepEqual(
      {
        retained: survived.retained,
        deleted: survived.deleted,
        remaining: survived.remaining,
      },
      { retained: ages.length * durable.length, deleted: 0, remaining: false },
    );
    assert.deepEqual(deleted, []);
    assert.equal(records.size, ages.length * durable.length);
  }

  // --- the event and invitation delete caps -------------------------------
  // Only the suggestion cap had a runtime fixture. Without these, removing
  // either cap goes green while a single invocation attempts thousands of
  // deletes inside the platform's fixed 30-second limit.
  {
    records.clear();
    deleted.length = 0;
    const ordinary = Array.from({ length: 101 }, (_, i) => {
      const ms = old - i;
      const id = `${ms}-${i.toString(16).padStart(6, "0")}`;
      const ts = new Date(ms).toISOString();
      return [
        `events/4b7d2a/${ts.slice(0, 7)}/${id}.json`,
        { ...event("comment.create", 1), id, ts },
      ];
    });
    pagesByPrefix["events/"] = ordinary;
    for (const pair of ordinary) records.set(...pair);
    const cappedEvents = await mod.namespace.sweepEvents({ store, nowMs: now });
    assert.deepEqual(
      { deleted: cappedEvents.deleted, remaining: cappedEvents.remaining },
      { deleted: 100, remaining: true },
    );
    assert.equal(deleted.length, 100);
    assert.equal(records.size, 1);
  }

  {
    records.clear();
    deleted.length = 0;
    const manyExpired = Array.from({ length: 76 }, (_, i) => [
      `access/4b7d2a/i/${i.toString(16).padStart(32, "0")}.json`,
      {
        v: 1,
        docId: "4b7d2a",
        expiresAt: new Date(now - 76 + i).toISOString(),
      },
    ]);
    pagesByPrefix["access/"] = manyExpired;
    for (const pair of manyExpired) records.set(...pair);
    const cappedInvites = await mod.namespace.sweepInvitations({
      store,
      nowMs: now,
    });
    assert.deepEqual(
      {
        expired: cappedInvites.expired,
        deleted: cappedInvites.deleted,
        remaining: cappedInvites.remaining,
      },
      { expired: 76, deleted: 75, remaining: true },
    );
    assert.equal(deleted.length, 75);
    assert.equal(records.size, 1);
  }

  // --- each invitation is leased under its own document -------------------
  // Every other invitation fixture uses the single document `4b7d2a`, so
  // leasing a constant document instead of each candidate's own would pass
  // while deleting invitations in every other document entirely unfenced.
  {
    records.clear();
    deleted.length = 0;
    leasedDocs.length = 0;
    const twoDocs = [
      [
        "access/9c1e40/i/000000000000000000000000000000aa.json",
        { v: 1, docId: "9c1e40", expiresAt: new Date(now - 2).toISOString() },
      ],
      [
        "access/4b7d2a/i/000000000000000000000000000000bb.json",
        { v: 1, docId: "4b7d2a", expiresAt: new Date(now - 1).toISOString() },
      ],
    ];
    pagesByPrefix["access/"] = twoDocs;
    for (const pair of twoDocs) records.set(...pair);
    const across = await mod.namespace.sweepInvitations({ store, nowMs: now });
    assert.equal(across.deleted, 2);
    // Oldest expiry first, so the second document's invitation leads.
    assert.deepEqual(leasedDocs, ["9c1e40", "4b7d2a"]);
    assert.deepEqual(deleted, twoDocs.map(([key]) => key));
  }

  // --- the log line is wired to the right fields --------------------------
  // The empty-store case below cannot tell `events.deleted` from
  // `events.retained`, `suggestions` from `invitations`, or a real `remaining`
  // from a hardcoded `false`, because every value is zero.
  {
    records.clear();
    deleted.length = 0;
    leasedDocs.length = 0;
    const wiredEvent = (kind, i, ms) => {
      const id = `${ms}-${i.toString(16).padStart(6, "0")}`;
      const ts = new Date(ms).toISOString();
      return [
        `events/4b7d2a/${ts.slice(0, 7)}/${id}.json`,
        { ...event(kind, 1), id, ts, kind },
      ];
    };
    // Three deleted, one retained: the two event counters cannot be swapped.
    pagesByPrefix["events/"] = [
      wiredEvent("comment.create", 1, old),
      wiredEvent("comment.create", 2, old - 1),
      wiredEvent("comment.create", 3, old - 2),
      wiredEvent("access.invite", 4, old - 3),
    ];
    // Two suggestions and one invitation: the two counters cannot be swapped.
    const wiredSuggestions = [0, 1].map((i) => {
      const ms = now - 7_776_000_000 - 1 - i;
      const id = `s_${ms.toString(36)}_${i.toString(16).padStart(8, "0")}`;
      return [
        `suggest/4b7d2a/a3f19c2b7/${id}.json`,
        {
          v: 1,
          id,
          docId: "4b7d2a",
          aid: "a3f19c2b7",
          at: new Date(ms).toISOString(),
        },
      ];
    });
    pagesByPrefix["suggest/"] = wiredSuggestions;
    // Two expired invitations but a busy lease, so `remaining` is genuinely
    // true and a hardcoded `false` is visible.
    pagesByPrefix["access/"] = [
      [
        "access/4b7d2a/i/000000000000000000000000000000cc.json",
        { v: 1, docId: "4b7d2a", expiresAt: new Date(now - 1).toISOString() },
      ],
    ];
    for (const prefix of ["events/", "suggest/", "access/"]) {
      for (const pair of pagesByPrefix[prefix]) records.set(...pair);
    }
    leaseMode = "busy";
    const wiredLog = [];
    const wiredRun = mod.namespace.createRetentionHandler({
      storeFn: () => store,
      nowFn: () => now,
      logFn: (line) => wiredLog.push(line),
    });
    assert.equal(
      await wiredRun(new Request("https://fixture.invalid/ignored")),
      undefined,
    );
    assert.deepEqual(wiredLog, [
      "retention: events=3/1 suggestions=2 invitations=0 remaining=true",
    ]);
    leaseMode = "acquire";
  }

  // --- the one success log ------------------------------------------------
  records.clear();
  deleted.length = 0;
  pagesByPrefix["events/"] = [];
  pagesByPrefix["suggest/"] = [];
  pagesByPrefix["access/"] = [];
  const log = [];
  const run = mod.namespace.createRetentionHandler({
    storeFn: () => store,
    nowFn: () => now,
    logFn: (line) => log.push(line),
  });
  assert.equal(await run(new Request("https://fixture.invalid/ignored")), undefined);
  assert.deepEqual(log, [
    "retention: events=0/0 suggestions=0 invitations=0 remaining=false",
  ]);
  clearTimeout(deadline);
}
