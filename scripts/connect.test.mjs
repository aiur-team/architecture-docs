import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

const HOSTED_ENV = "AIUR_CONNECT_HOSTED";
const HOSTED_TIMEOUT = 900_000;
const CHILD_OUTPUT_LIMIT = 65_536;
const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CHILD_ENV_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM", "LANG",
  "LC_ALL", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "CI", "NO_COLOR",
];

function printableStrictChild(root, candidate) {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);
  const rel = relative(normalizedRoot, normalizedCandidate);
  if (
    !/^[\x20-\x7e]+$/.test(normalizedRoot) ||
    !/^[\x20-\x7e]+$/.test(normalizedCandidate) ||
    normalizedRoot === parse(normalizedRoot).root ||
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) throw new Error("unsafe hosted path");
  return normalizedCandidate;
}

function hostedChildEnvironment(siteId = null) {
  const result = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = Object.getOwnPropertyDescriptor(process.env, key)?.value;
    if (typeof value === "string" && !value.includes("\0")) result[key] = value;
  }
  if (siteId !== null) result.NETLIFY_SITE_ID = siteId;
  return result;
}

function hostedExecutable() {
  const configured = Object.getOwnPropertyDescriptor(process.env, "NETLIFY_CLI_PATH")?.value;
  if (configured === undefined) return "netlify";
  if (
    typeof configured !== "string" ||
    configured.includes("\0") ||
    !isAbsolute(configured) ||
    realpathSync(configured) !== configured
  ) throw new Error("invalid hosted executable");
  const stat = lstatSync(configured);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("invalid hosted executable");
  return configured;
}

async function runHostedChild(executable, args, cwd, { siteId = null, timeout = 60_000, abortSignal = null } = {}) {
  if (abortSignal?.aborted) throw abortSignal.reason instanceof Error ? abortSignal.reason : new Error("hosted lifecycle timeout");
  const child = spawn(executable, args, {
    cwd,
    env: hostedChildEnvironment(siteId),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise((resolvePromise, rejectPromise) => {
    const output = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let failure = null;
    let closed = false;
    let killTimer = null;
    let terminationStarted = false;
    const terminate = (error) => {
      failure ??= error;
      if (terminationStarted || closed) return;
      terminationStarted = true;
      child.stdout.resume();
      child.stderr.resume();
      try { child.kill("SIGTERM"); } catch {}
      killTimer ??= setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2_000);
    };
    const abort = () => terminate(abortSignal.reason instanceof Error ? abortSignal.reason : new Error("hosted lifecycle timeout"));
    abortSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => terminate(new Error("hosted child timeout")), timeout);
    for (const streamName of ["stdout", "stderr"]) {
      child[streamName].on("data", (chunk) => {
        const length = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk?.byteLength;
        if (!Number.isSafeInteger(length) || length < 0) {
          terminate(new Error("invalid hosted child output"));
          return;
        }
        sizes[streamName] += length;
        if (sizes[streamName] > CHILD_OUTPUT_LIMIT) terminate(new Error("hosted child overflow"));
        else output[streamName].push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    }
    child.on("error", terminate);
    child.on("close", (code, signal) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (killTimer !== null) clearTimeout(killTimer);
      abortSignal?.removeEventListener("abort", abort);
      if (failure !== null) rejectPromise(failure);
      else resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(output.stdout),
        stderr: Buffer.concat(output.stderr),
      });
    });
  });
}

function exactUtf8(buffer) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
}

function oneFinalNewline(value) {
  return value.endsWith("\n") ? value.slice(0, value.endsWith("\r\n") ? -2 : -1) : value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertHelp(text, usageLine, requiredOptions) {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^[A-Z][A-Z ]*$/.test(line) && !line.endsWith(" "));
  const usage = headings.filter(({ line }) => line === "USAGE");
  const options = headings.filter(({ line }) => line === "OPTIONS");
  assert.equal(usage.length, 1);
  assert.equal(options.length, 1);
  assert.ok(options[0].index > usage[0].index);
  const nextAfterUsage = headings.find(({ index }) => index > usage[0].index);
  assert.equal(nextAfterUsage.index, options[0].index);
  assert.equal(lines.slice(usage[0].index + 1, options[0].index).filter((line) => line === usageLine).length, 1);
  const nextAfterOptions = headings.find(({ index }) => index > options[0].index)?.index ?? lines.length;
  const optionSection = lines.slice(options[0].index + 1, nextAfterOptions).join("\n");
  for (const spelling of requiredOptions) {
    assert.match(optionSection, new RegExp(`^  (?:-[A-Za-z], )?${escapeRegExp(spelling)}(?: {2,}|$)`, "m"));
  }
}

function snapshotLinkState(path) {
  try {
    const first = lstatSync(path);
    assert.ok(first.isFile() && !first.isSymbolicLink());
    const bytes = readFileSync(path);
    const stat = lstatSync(path);
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) assert.equal(stat[key], first[key]);
    return {
      present: true,
      bytes,
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false };
    throw error;
  }
}

function assertLinkState(path, before) {
  const after = snapshotLinkState(path);
  assert.equal(after.present, before.present);
  if (before.present) {
    assert.ok(after.bytes.equals(before.bytes));
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) assert.equal(after[key], before[key]);
  }
}

async function runHosted(connectModule, {
  fetchFn = fetch,
  fetchTimeoutMs = 10_000,
  scheduleDeadline = setTimeout,
  clearDeadline = clearTimeout,
  repositoryRoot: suppliedRepositoryRoot = null,
} = {}) {
  const lifecycle = new AbortController();
  const deadline = scheduleDeadline(() => lifecycle.abort(new Error("hosted lifecycle timeout")), HOSTED_TIMEOUT);
  const repositoryRoot = suppliedRepositoryRoot ?? resolve(dirname(fileURLToPath(new URL("./connect.mjs", import.meta.url))), "..");
  const tempRoot = realpathSync(tmpdir());
  const evidenceRoot = printableStrictChild(tempRoot, mkdtempSync(join(tempRoot, "p4s-hosted-"), { encoding: "utf8", mode: 0o700 }));
  const remediationPath = printableStrictChild(evidenceRoot, join(evidenceRoot, "manual-remediation.json"));
  const siteName = `aiur-p4s-${process.pid.toString(36)}-${randomBytes(16).toString("hex")}`;
  assert.match(siteName, SITE_NAME);
  const recovery = { v: 1, siteName, siteId: null };
  const recoveryHandle = openSync(remediationPath, "wx", 0o600);
  try {
    writeFileSync(recoveryHandle, `${JSON.stringify(recovery, null, 2)}\n`);
  } finally {
    closeSync(recoveryHandle);
  }
  const linkPaths = [...new Set([
    join(process.cwd(), ".netlify", "state.json"),
    join(repositoryRoot, ".netlify", "state.json"),
  ])];
  const linkStates = new Map(linkPaths.map((path) => [path, snapshotLinkState(path)]));
  const executable = hostedExecutable();
  let cleanupTarget = null;
  let blobWriteMayHaveOccurred = false;
  let remoteCleanupComplete = false;
  let cleanupFailure = false;

  const active = () => {
    if (lifecycle.signal.aborted) throw lifecycle.signal.reason instanceof Error ? lifecycle.signal.reason : new Error("hosted lifecycle timeout");
  };
  const search = async (abortSignal = lifecycle.signal) => {
    const result = await runHostedChild(executable, ["sites:search", siteName, "--json"], evidenceRoot, { abortSignal });
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    const rows = JSON.parse(exactUtf8(result.stdout));
    assert.ok(Array.isArray(rows) && rows.length <= 100);
    for (const row of rows) {
      assert.ok(row !== null && typeof row === "object" && !Array.isArray(row) && Object.getPrototypeOf(row) === Object.prototype);
      assert.match(row.id, SITE_ID);
      assert.match(row.name, SITE_NAME);
    }
    const matches = rows.filter((row) => row.name === siteName);
    assert.ok(matches.length <= 1);
    return matches;
  };
  const replaceRecovery = (siteId) => {
    assert.match(siteId, SITE_ID);
    const sibling = printableStrictChild(evidenceRoot, join(evidenceRoot, "manual-remediation.next"));
    try {
      writeFileSync(sibling, `${JSON.stringify({ v: 1, siteName, siteId }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      renameSync(sibling, remediationPath);
    } finally {
      rmSync(sibling, { force: true });
    }
  };

  try {
    active();
    const version = await runHostedChild(executable, ["--version"], evidenceRoot, { abortSignal: lifecycle.signal });
    assert.equal(version.code, 0);
    assert.equal(version.signal, null);
    assert.equal(version.stderr.length, 0);
    const versionText = exactUtf8(version.stdout);
    const normalizedVersion = oneFinalNewline(versionText);
    assert.ok(!normalizedVersion.endsWith("\n") && !normalizedVersion.endsWith("\r"));
    assert.equal(normalizedVersion.split(" ")[0], "netlify-cli/27.4.2");
    const helpCases = [
      [["sites:create", "--help"], "$ netlify sites:create [options]", ["--disable-linking", "--json", "--name <name>"]],
      [["sites:search", "--help"], "$ netlify sites:search [options] <search-term>", ["--json"]],
      [["env:get", "--help"], "$ netlify env:get [options] <name>", ["--context <context>"]],
      [["env:set", "--help"], "$ netlify env:set [options] <key> [value]", []],
      [["blobs:set", "--help"], "$ netlify blobs:set [options] <store> <key> [value...]", ["--input <path>"]],
      [["blobs:get", "--help"], "$ netlify blobs:get [options] <store> <key>", ["--output <path>"]],
      [["blobs:delete", "--help"], "$ netlify blobs:delete [options] <store> <key>", ["--force"]],
      [["deploy", "--help"], "$ netlify deploy [options]", ["--prod", "--no-build", "--dir <path>", "--json"]],
      [["sites:delete", "--help"], "$ netlify sites:delete [options] <id>", ["--force"]],
    ];
    for (const [args, usage, options] of helpCases) {
      const result = await runHostedChild(executable, args, evidenceRoot, { abortSignal: lifecycle.signal });
      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(result.stderr.length, 0);
      assertHelp(exactUtf8(result.stdout), usage, options);
    }
    assert.deepEqual(await search(), []);

    const inputRoot = printableStrictChild(evidenceRoot, join(evidenceRoot, "input"));
    mkdirSync(inputRoot, { mode: 0o700 });
    const hostedDocId = "4b7d2a";
    const hostedAid = "a12345678";
    const hostedInner = "Hosted lifecycle fixture";
    const hostedHistory = {
      doc: "hosted",
      head: "abc1234",
      versions: [{ sha: "abc1234", date: "2026-09-03T12:34:56.000Z", author: "Fixture", subject: "Hosted proof", url: "", changed: [] }],
    };
    const hostedManifest = {
      docId: hostedDocId,
      instance: "hosted",
      commit: "abc1234",
      blocks: { [hostedAid]: { file: "sections/hosted.html", section: "hosted", tag: "p", hash: createHash("sha256").update(hostedInner).digest("hex") } },
    };
    const hostedHtml = `<meta name="doc-id" content="${hostedDocId}">\n<!doctype html><html><body><p data-editable data-aid="${hostedAid}">${hostedInner}</p><script type="application/json" id="doc-history" data-head="${hostedHistory.head}">${JSON.stringify(hostedHistory).replaceAll("</", "<\\/")}</script></body></html>\n`;
    writeFileSync(join(inputRoot, "page.html"), hostedHtml);
    writeFileSync(join(inputRoot, "edit.json"), `${JSON.stringify(hostedManifest, null, 2)}\n`);
    writeFileSync(join(inputRoot, "history.json"), `${JSON.stringify(hostedHistory, null, 2)}\n`);
    const hostedCalls = [];
    const wrappedSpawn = (command, args, options) => {
      hostedCalls.push([...args]);
      const child = spawn(command, args, options);
      if (args[0] === "blobs:set") blobWriteMayHaveOccurred = true;
      let killTimer = null;
      const interrupt = () => {
        try { child.kill("SIGTERM"); } catch {}
        killTimer ??= setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2_000);
      };
      lifecycle.signal.addEventListener("abort", interrupt, { once: true });
      child.once("close", () => {
        lifecycle.signal.removeEventListener("abort", interrupt);
        if (killTimer !== null) clearTimeout(killTimer);
      });
      if (lifecycle.signal.aborted) interrupt();
      return child;
    };
    const capturedEnv = {};
    for (const key of [...CHILD_ENV_KEYS, "NETLIFY_CLI_PATH"]) {
      const value = Object.getOwnPropertyDescriptor(process.env, key)?.value;
      if (typeof value === "string") capturedEnv[key] = value;
    }
    const runner = connectModule.createConnectRunner({
      workingDirectory: inputRoot,
      repositoryRoot,
      env: capturedEnv,
      spawnFn: wrappedSpawn,
    });
    const baseArgs = ["--file", "page.html", "--manifest", "edit.json", "--history", "history.json"];
    active();
    const first = await runner(connectModule.parseConnectArgs([...baseArgs, "--owner", "hosted@example.com", "--name", siteName]));
    cleanupTarget = first.siteId;
    replaceRecovery(cleanupTarget);
    const repeatStart = hostedCalls.length;
    const repeated = await runner(connectModule.parseConnectArgs([...baseArgs, "--owner", "hosted@example.com", "--site", cleanupTarget]));
    assert.equal(repeated.siteId, first.siteId);
    assert.equal(repeated.url, first.url);
    assert.ok(!hostedCalls.slice(repeatStart).some((args) => args[0] === "env:set"));
    const conflictStart = hostedCalls.length;
    await assert.rejects(
      runner(connectModule.parseConnectArgs([...baseArgs, "--owner", "different@example.com", "--site", cleanupTarget])),
      (error) => error.tag === "conflict",
    );
    assert.deepEqual(hostedCalls.slice(conflictStart).map((args) => args[0]), ["env:get"]);
    active();
    const fetchController = new AbortController();
    const abortFetch = () => fetchController.abort(lifecycle.signal.reason);
    lifecycle.signal.addEventListener("abort", abortFetch, { once: true });
    const fetchTimer = setTimeout(() => fetchController.abort(new Error("hosted fetch timeout")), fetchTimeoutMs);
    let response;
    try {
      response = await fetchFn(first.url, { redirect: "manual", signal: fetchController.signal });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/login/?next=%2F");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    } catch (error) {
      try { await response?.body?.cancel?.(); } catch {}
      throw error;
    } finally {
      clearTimeout(fetchTimer);
      lifecycle.signal.removeEventListener("abort", abortFetch);
    }
  } finally {
    clearDeadline(deadline);
    try {
      const matches = await search(null);
      if (cleanupTarget === null && matches.length === 1) {
        cleanupTarget = matches[0].id;
        replaceRecovery(cleanupTarget);
      } else if (cleanupTarget !== null && matches.length === 1) {
        assert.equal(matches[0].id, cleanupTarget);
      }
      if (cleanupTarget !== null) {
        if (blobWriteMayHaveOccurred) {
          try {
            await runHostedChild(executable, ["blobs:delete", "doc-state", "mode/4b7d2a/manifest.json", "--force"], evidenceRoot, { siteId: cleanupTarget });
          } catch {}
        }
        const deleted = await runHostedChild(executable, ["sites:delete", cleanupTarget, "--force"], evidenceRoot);
        assert.equal(deleted.code, 0);
        assert.equal(deleted.signal, null);
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if ((await search(null)).length === 0) {
          remoteCleanupComplete = true;
          break;
        }
        if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
      }
      for (const [path, before] of linkStates) assertLinkState(path, before);
      assert.equal(remoteCleanupComplete, true);
      rmSync(evidenceRoot, { recursive: true, force: true });
    } catch {
      cleanupFailure = true;
      process.stderr.write(`P4-S hosted cleanup failed; inspect ${remediationPath}\n`);
    }
    if (cleanupFailure) throw new Error("hosted lifecycle failed");
  }
}

const connect = await import("./connect.mjs");
const {
  assertModeManifest,
  createConnectRunner,
  inspectStandaloneHtml,
  normalizeConnectOwner,
  parseConnectArgs,
} = connect;

const hostedArguments = process.argv.slice(2);
const hostedMode = hostedArguments.length === 1 && hostedArguments[0] === "--hosted" && process.env[HOSTED_ENV] === "1";
const hostedRequested = hostedArguments.length !== 0 || Object.hasOwn(process.env, HOSTED_ENV);

if (hostedMode) {
  try {
    await runHosted(connect);
    process.stdout.write("PASS  P4-S hosted connect lifecycle\n");
  } catch {
    process.exitCode = 1;
  }
} else if (hostedRequested) {
  process.exitCode = 1;
} else {
assert.deepEqual(Object.keys(connect).sort(), [
  "assertModeManifest",
  "createConnectRunner",
  "inspectStandaloneHtml",
  "main",
  "normalizeConnectOwner",
  "parseConnectArgs",
]);

const hostedAbortController = new AbortController();
const hostedAbortReason = new Error("invented hosted deadline");
const hostedAbortRun = runHostedChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], tmpdir(), {
  abortSignal: hostedAbortController.signal,
  timeout: 10_000,
});
hostedAbortController.abort(hostedAbortReason);
await assert.rejects(hostedAbortRun, (error) => error === hostedAbortReason);

assert.deepEqual(parseConnectArgs(["--help"]), { help: true });
const parsed = parseConnectArgs([
  "--owner", " Owner@Example.COM ",
  "--history", "history.json",
  "--file", "page.html",
  "--site", "123e4567-e89b-12d3-a456-426614174000",
  "--manifest", "edit.json",
]);
assert.deepEqual(parsed, {
  file: "page.html",
  manifest: "edit.json",
  history: "history.json",
  owner: " Owner@Example.COM ",
  name: null,
  site: "123e4567-e89b-12d3-a456-426614174000",
});
assert.deepEqual(parseConnectArgs([
  "--owner", "owner@example.com",
  "--file", "page.html",
  "--site", "123e4567-e89b-12d3-a456-426614174000",
  "--manifest", "edit.json",
]), {
  file: "page.html",
  manifest: "edit.json",
  history: null,
  owner: "owner@example.com",
  name: null,
  site: "123e4567-e89b-12d3-a456-426614174000",
});
assert.equal(parseConnectArgs([
  "--file", "--opaque-file",
  "--manifest", "--opaque-manifest",
  "--history", "--opaque-history",
  "--owner", "--opaque-owner",
  "--name", "--opaque-name",
]).file, "--opaque-file");
for (const argv of [
  [],
  ["--help", "x"],
  ["--file=x"],
  ["value"],
  ["--file", ""],
  ["--file", "--owner"],
  ["--file", "a", "--file", "b", "--history", "h", "--manifest", "m", "--owner", "o", "--site", "s"],
]) {
  assert.throws(() => parseConnectArgs(argv));
}

assert.equal(normalizeConnectOwner("\tOWNER+tag@Sub.Example.COM\r"), "owner+tag@sub.example.com");
assert.equal(normalizeConnectOwner("a..b@example.com"), "a..b@example.com");
for (const owner of ["a@localhost", "a/b@example.com", "a@-bad.example", "a@bad..example", "K@example.com", "a@example.com\u0085"]) {
  assert.throws(() => normalizeConnectOwner(owner));
}

const docId = "4b7d2a";
const aid = "a12345678";
const inner = "Hello <em>world</em>";
const history = {
  doc: "sample",
  head: "abc1234",
  versions: [{
    sha: "abc1234",
    date: "2026-09-03T12:34:56.000Z",
    author: "Example Author",
    subject: "Initial document",
    url: "",
    changed: [],
  }],
};
const manifest = {
  docId,
  instance: "sample",
  commit: "abc1234",
  blocks: {
    [aid]: {
      file: "sections/example.html",
      section: "example",
      tag: "p",
      hash: createHash("sha256").update(inner).digest("hex"),
    },
  },
};
const embeddedHistoryScript =
  `<script type="application/json" id="doc-history" data-head="${history.head}">${JSON.stringify(history).replaceAll("</", "<\\/")}</script>`;
const html =
  `<meta name="doc-id" content="${docId}">\n` +
  `<!doctype html><html><body><p data-editable data-aid="${aid}">${inner}</p>` +
  embeddedHistoryScript +
  `<script>const fake = '<meta name="doc-id" content="ffffff">';</script></body></html>\n`;
const noHistoryManifest = { ...manifest, commit: "" };
const noHistoryHtml = html.replace(embeddedHistoryScript, "");
const unicodeRawTextHtml = html.replace(
  "<script>const fake",
  "<script>const dotted = 'İ'; const fake",
);

assert.deepEqual(inspectStandaloneHtml(html), { docId });
assert.deepEqual(assertModeManifest(manifest, html), { docId, manifest });
assert.deepEqual(assertModeManifest(noHistoryManifest, noHistoryHtml), { docId, manifest: noHistoryManifest });
assert.deepEqual(assertModeManifest(manifest, unicodeRawTextHtml), { docId, manifest });
for (const badHtml of [
  `\ufeff${html}`,
  html.replace("</body>", '<meta content="ffffff" name="doc-id"></body>'),
  html.replace("data-editable", "DATA-EDITABLE"),
  html.replace(`data-aid="${aid}"`, `data-aid='${aid}'`),
  html.replace("</p>", "</h2>"),
  html.replace("<script>const", "<script data-aid=\"a00000000\">const"),
  html.replace("<script>const fake", "<script/><script>const fake"),
  html.replace("</body>", "<style/></body>"),
]) {
  assert.throws(() => assertModeManifest(manifest, badHtml));
}
assert.throws(() => assertModeManifest({ ...manifest, commit: "abc123" }, html));
assert.throws(() => assertModeManifest({ ...manifest, blocks: {} }, html));

const source = readFileSync(fileURLToPath(new URL("./connect.mjs", import.meta.url)), "utf8");
const importBlock = source.match(/^import[\s\S]+?(?=\n\nconst USAGE)/)?.[0];
assert.ok(importBlock);
const importDeclarations = importBlock.split(/;\n/).filter((declaration) => declaration.trim() !== "");
assert.equal(importDeclarations.length, 6);
assert.ok(importDeclarations.every((declaration) => /^import\s+{[\s\S]+}\s+from\s+"[^"]+"$/.test(declaration.trim().replace(/;$/, ""))));
const importSources = [...source.matchAll(/^import\s+{[^;]+}\s+from\s+"([^"]+)";/gms)].map((match) => match[1]).sort();
assert.deepEqual(importSources, [
  "node:child_process",
  "node:crypto",
  "node:fs/promises",
  "node:os",
  "node:path",
  "node:url",
]);
assert.doesNotMatch(source, /\b(?:exec|execFile|execSync|execFileSync|fork|spawnSync|fetch)\s*\(/);
assert.doesNotMatch(source, /\bprocess\s*\.\s*exit\s*\(/);
assert.doesNotMatch(source, /\b[A-Z0-9_]*(?:TOKEN|PASSWORD|COOKIE|SECRET)[A-Z0-9_]*\b/);
assert.doesNotMatch(source, /\b(?:require|import)\s*\(/);

const testRoot = mkdtempSync(join(tmpdir(), "p4s-test-"));
try {
  const repositoryRoot = join(testRoot, "repository");
  const inputRoot = join(testRoot, "input");
  mkdirSync(join(repositoryRoot, "netlify", "functions"), { recursive: true });
  mkdirSync(join(repositoryRoot, "scripts"), { recursive: true });
  mkdirSync(inputRoot, { recursive: true });
  writeFileSync(join(repositoryRoot, "netlify", "functions", "noop.mjs"), "export default () => new Response();\n");
  writeFileSync(join(repositoryRoot, "netlify.toml"), "[build]\npublish = \"publish\"\n");
  writeFileSync(join(repositoryRoot, "package.json"), "{\"type\":\"module\"}\n");
  writeFileSync(join(repositoryRoot, "package-lock.json"), "{\"lockfileVersion\":3}\n");
  copyFileSync(fileURLToPath(new URL("./connect.mjs", import.meta.url)), join(repositoryRoot, "scripts", "connect.mjs"));
  writeFileSync(join(inputRoot, "page.html"), html);
  writeFileSync(join(inputRoot, "edit.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(inputRoot, "history.json"), `${JSON.stringify(history, null, 2)}\n`);
  writeFileSync(join(inputRoot, "page-no-history.html"), noHistoryHtml);
  writeFileSync(join(inputRoot, "edit-no-history.json"), `${JSON.stringify(noHistoryManifest, null, 2)}\n`);

  const calls = [];
  let ownerSeed = "";
  let activeChildren = 0;
  const fakeSpawn = (executable, args, options) => {
    assert.equal(executable, "netlify");
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    assert.ok(options.cwd.endsWith("/project"));
    assert.equal(options.env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    activeChildren += 1;
    assert.equal(activeChildren, 1);
    calls.push({ args: [...args], options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      let code = 0;
      let output = "";
      if (args[0] === "sites:create") {
        assert.deepEqual(args, ["sites:create", "--name", "fixture-site", "--disable-linking", "--json"]);
        output = '{"site_id":"123e4567-e89b-12d3-a456-426614174000"}';
      }
      else if (args[0] === "env:get") {
        assert.deepEqual(args, ["env:get", "DOC_OWNERS", "--context", "production"]);
        if (ownerSeed === "") code = 1;
        else output = `${ownerSeed}\n`;
      } else if (args[0] === "env:set") {
        assert.deepEqual(args, ["env:set", "DOC_OWNERS", `${docId}:owner@example.com`]);
        ownerSeed = args[2];
      }
      else if (args[0] === "blobs:get") {
        assert.deepEqual(args.slice(0, -1), ["blobs:get", "doc-state", `mode/${docId}/manifest.json`, "--output"]);
        assert.equal(args.at(-1).split(sep).at(-1), "manifest.output");
        const outputPath = args[args.indexOf("--output") + 1];
        const inputPath = calls.find((call) => call.args[0] === "blobs:set").args.at(-1);
        copyFileSync(inputPath, outputPath);
      } else if (args[0] === "blobs:set") {
        assert.deepEqual(args.slice(0, -1), ["blobs:set", "doc-state", `mode/${docId}/manifest.json`, "--input"]);
        assert.equal(args.at(-1).split(sep).at(-1), "manifest.input");
      } else if (args[0] === "deploy") {
        assert.deepEqual(args, ["deploy", "--prod", "--no-build", "--dir", "publish", "--json"]);
        const publishRoot = join(options.cwd, args[args.indexOf("--dir") + 1]);
        assert.deepEqual(readdirSync(publishRoot), ["index.html"]);
        const publishedManifest = JSON.parse(readFileSync(join(options.cwd, "private", "manifest.input"), "utf8"));
        const expectedHtml = publishedManifest.commit === "" ? noHistoryHtml : html;
        assert.ok(readFileSync(join(publishRoot, "index.html")).equals(Buffer.from(expectedHtml)));
        assert.ok(lstatSync(join(options.cwd, "netlify")).isDirectory());
        for (const name of ["netlify.toml", "package.json", "package-lock.json"]) {
          assert.ok(lstatSync(join(options.cwd, name)).isFile());
        }
        output = '{"url":"https://fixture-site.netlify.app"}';
      } else assert.fail(`unexpected fake command ${args[0]}`);
      child.stdout.end(output);
      child.stderr.end();
      activeChildren -= 1;
      child.emit("close", code, null);
    });
    return child;
  };
  const runner = createConnectRunner({
    workingDirectory: inputRoot,
    repositoryRoot,
    env: { PATH: process.env.PATH, NETLIFY_AUTH_TOKEN: "must-not-cross" },
    spawnFn: fakeSpawn,
  });
  const result = await runner(parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", "Owner@Example.com",
    "--name", "fixture-site",
  ]));
  assert.deepEqual(result, {
    docId,
    owner: "owner@example.com",
    siteId: "123e4567-e89b-12d3-a456-426614174000",
    url: "https://fixture-site.netlify.app/",
  });
  assert.deepEqual(calls.map((call) => call.args[0]), [
    "sites:create", "env:get", "env:set", "env:get", "blobs:set", "blobs:get", "deploy",
  ]);
  assert.equal(calls[0].options.env.NETLIFY_SITE_ID, undefined);
  assert.ok(calls.slice(1).every((call) => call.options.env.NETLIFY_SITE_ID === result.siteId));
  assert.equal(calls.at(-1).args.join(" "), "deploy --prod --no-build --dir publish --json");
  const noHistoryArguments = () => parseConnectArgs([
    "--file", "page-no-history.html",
    "--manifest", "edit-no-history.json",
    "--owner", "owner@example.com",
    "--site", result.siteId,
  ]);

  const exactProtocol = [
    ["sites:create", "--name", "fixture-site", "--disable-linking", "--json"],
    ["env:get", "DOC_OWNERS", "--context", "production"],
    ["env:set", "DOC_OWNERS", `${docId}:owner@example.com`],
    ["env:get", "DOC_OWNERS", "--context", "production"],
    ["blobs:set", "doc-state", `mode/${docId}/manifest.json`, "--input"],
    ["blobs:get", "doc-state", `mode/${docId}/manifest.json`, "--output"],
    ["deploy", "--prod", "--no-build", "--dir", "publish", "--json"],
  ];
  for (const [index, expected] of exactProtocol.entries()) {
    const actual = calls[index].args;
    if (["blobs:set", "blobs:get"].includes(expected[0])) {
      assert.deepEqual(actual.slice(0, -1), expected);
      assert.ok(actual.at(-1).startsWith(calls[index].options.cwd));
    } else {
      assert.deepEqual(actual, expected);
    }
  }

  calls.length = 0;
  const noHistoryResult = await runner(noHistoryArguments());
  assert.deepEqual(noHistoryResult, {
    docId,
    owner: "owner@example.com",
    siteId: result.siteId,
    url: "https://fixture-site.netlify.app/",
  });
  assert.deepEqual(calls.map((call) => call.args[0]), ["env:get", "env:get", "blobs:set", "blobs:get", "deploy"]);

  calls.length = 0;
  const repeated = await runner(parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", "owner@example.com",
    "--site", result.siteId,
  ]));
  assert.equal(repeated.siteId, result.siteId);
  assert.deepEqual(calls.map((call) => call.args[0]), ["env:get", "env:get", "blobs:set", "blobs:get", "deploy"]);

  calls.length = 0;
  await assert.rejects(runner(parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", "different@example.com",
    "--site", result.siteId,
  ])), (error) => error.tag === "conflict");
  assert.deepEqual(calls.map((call) => call.args[0]), ["env:get"]);

  const errorSignals = [];
  const errorTimers = [];
  const errorRunner = createConnectRunner({
    workingDirectory: inputRoot,
    repositoryRoot,
    env: { PATH: process.env.PATH },
    setTimeoutFn(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      errorTimers.push(timer);
      if (milliseconds === 2_000) process.nextTick(() => callback());
      return timer;
    },
    clearTimeoutFn(timer) { timer.cleared = true; },
    spawnFn() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (signal) => {
        errorSignals.push(signal);
        if (signal === "SIGKILL") process.nextTick(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", null, "SIGKILL");
        });
        return true;
      };
      process.nextTick(() => child.emit("error", new Error("invented spawn failure")));
      return child;
    },
  });
  await assert.rejects(errorRunner(parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", "owner@example.com",
    "--site", result.siteId,
  ])), (error) => error.tag === "setup");
  assert.deepEqual(errorSignals, ["SIGTERM", "SIGKILL"]);
  assert.ok(errorTimers.every((timer) => timer.cleared));

  const siteArguments = (owner = "owner@example.com") => parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", owner,
    "--site", result.siteId,
  ]);
  const nameArguments = parseConnectArgs([
    "--file", "page.html",
    "--manifest", "edit.json",
    "--history", "history.json",
    "--owner", "owner@example.com",
    "--name", "failure-fixture",
  ]);
  const makeProtocolSpawn = (override = () => null, signalLog = [], commandLog = []) => {
    let storedManifest = null;
    let index = 0;
    return (_executable, args) => {
      const callIndex = index;
      index += 1;
      const command = args[0];
      commandLog.push(command);
      let response = command === "sites:create"
        ? { stdout: `{"site_id":"${result.siteId}"}` }
        : command === "env:get"
          ? { stdout: `${docId}:owner@example.com\n` }
          : command === "deploy"
            ? { stdout: '{"url":"https://fixture-site.netlify.app/"}' }
            : {};
      response = override({ args, callIndex, command, response }) ?? response;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let closed = false;
      const close = (
        code = response.code === undefined ? 0 : response.code,
        childSignal = response.signal === undefined ? null : response.signal,
      ) => {
        if (closed) return;
        closed = true;
        child.stdout.end();
        child.stderr.end();
        child.emit("close", code, childSignal);
      };
      child.kill = (childSignal) => {
        signalLog.push(childSignal);
        process.nextTick(() => close(null, childSignal));
        return true;
      };
      process.nextTick(() => {
        if (command === "blobs:set" && response.code === undefined) storedManifest = args.at(-1);
        if (command === "blobs:get" && response.code === undefined) {
          if (response.output !== undefined) writeFileSync(args.at(-1), response.output);
          else if (storedManifest !== null) copyFileSync(storedManifest, args.at(-1));
        }
        if (response.stdout !== undefined) child.stdout.write(response.stdout);
        if (response.stderr !== undefined) child.stderr.write(response.stderr);
        if (response.close !== false) close();
      });
      return child;
    };
  };
  const runProtocolFailure = async ({ arguments: parsedArguments = siteArguments(), override, rmFn }) => {
    const signals = [];
    const commands = [];
    const failureRunner = createConnectRunner({
      workingDirectory: inputRoot,
      repositoryRoot,
      env: { PATH: process.env.PATH },
      spawnFn: makeProtocolSpawn(override, signals, commands),
      ...(rmFn === undefined ? {} : { rmFn }),
    });
    let failure;
    try {
      await failureRunner(parsedArguments);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    return { failure, signals, commands };
  };

  const providerFailures = [
    ["malformed create JSON", nameArguments, ({ command }) => command === "sites:create" ? { stdout: "{" } : null, "new-site"],
    ["malformed created site id", nameArguments, ({ command }) => command === "sites:create" ? { stdout: '{"site_id":"invalid"}' } : null, "new-site"],
    ["contradictory created site ids", nameArguments, ({ command }) => command === "sites:create" ? { stdout: `{"site_id":"${result.siteId}","id":"223e4567-e89b-12d3-a456-426614174000"}` } : null, "new-site"],
    ["missing auth", siteArguments(), ({ callIndex }) => callIndex === 0 ? { code: 2, stderr: "Not logged in\n" } : null, "setup"],
    ["post-create unexpected nonzero", nameArguments, ({ callIndex }) => callIndex === 1 ? { code: 2, stderr: "provider failure\n" } : null, "new-site"],
    ["signal close", siteArguments(), ({ callIndex }) => callIndex === 0 ? { code: null, signal: "SIGTERM" } : null, "setup"],
    ["malformed deploy JSON", siteArguments(), ({ command }) => command === "deploy" ? { stdout: "{" } : null, "setup"],
    ["malformed deploy URL", siteArguments(), ({ command }) => command === "deploy" ? { stdout: '{"url":"http://fixture-site.netlify.app/"}' } : null, "setup"],
    ["malformed secondary deploy URL", siteArguments(), ({ command }) => command === "deploy" ? { stdout: '{"url":"https://fixture-site.netlify.app/","deploy_url":"https://fixture-site.netlify.app/?"}' } : null, "setup"],
  ];
  for (const [label, parsedArguments, override, expectedTag] of providerFailures) {
    const { failure } = await runProtocolFailure({ arguments: parsedArguments, override });
    assert.equal(failure.tag, expectedTag, label);
  }
  for (const [label, parsedArguments] of [
    ["history snapshot requires sidecar", parseConnectArgs([
      "--file", "page.html",
      "--manifest", "edit.json",
      "--owner", "owner@example.com",
      "--site", result.siteId,
    ])],
    ["empty history rejects sidecar", { ...noHistoryArguments(), history: "history.json" }],
    ["empty history rejects mirror", { ...noHistoryArguments(), file: "page.html" }],
  ]) {
    const { failure, commands } = await runProtocolFailure({ arguments: parsedArguments });
    assert.equal(failure.tag, "setup", label);
    assert.deepEqual(commands, [], `${label} stops before remote work`);
  }
  const manifestBytes = readFileSync(join(inputRoot, "edit.json"));
  for (const [label, drifted] of [
    ["appended byte", Buffer.concat([manifestBytes, Buffer.from("\n")])],
    ["truncated byte", manifestBytes.subarray(0, manifestBytes.length - 1)],
    ["reserialized manifest", Buffer.from(JSON.stringify(manifest))],
  ]) {
    const readbackCommands = [];
    const { failure } = await runProtocolFailure({
      override: ({ command }) => {
        readbackCommands.push(command);
        return command === "blobs:get" ? { output: drifted } : null;
      },
    });
    assert.equal(failure.tag, "setup", `read-back ${label}`);
    assert.deepEqual(readbackCommands, ["env:get", "env:get", "blobs:set", "blobs:get"], `read-back ${label} stops before deploy`);
  }

  const leakedRoot = join(testRoot, "leaked\ttemp");
  const leakRunner = createConnectRunner({
    workingDirectory: inputRoot,
    repositoryRoot,
    env: { PATH: process.env.PATH },
    spawnFn: makeProtocolSpawn(),
    mkdtempFn: async () => {
      mkdirSync(leakedRoot, { mode: 0o700 });
      return leakedRoot;
    },
  });
  await assert.rejects(leakRunner(siteArguments()), (error) => error.tag === "setup");
  assert.equal(existsSync(leakedRoot), false, "rejected temp root removed");

  const linkedInput = join(testRoot, "linked-input");
  symlinkSync(inputRoot, linkedInput);
  const linkedRunner = createConnectRunner({
    workingDirectory: linkedInput,
    repositoryRoot,
    env: { PATH: process.env.PATH },
    spawnFn: makeProtocolSpawn(),
  });
  await assert.rejects(linkedRunner(siteArguments()), (error) => error.tag === "setup");

  for (const deployUrl of [
    "https://fixture-site.netlify.app/?",
    "https://fixture-site.netlify.app/#",
    "https://fixture-site.netlify.app/?query",
    "https://fixture-site.netlify.app/#fragment",
  ]) {
    const { failure } = await runProtocolFailure({
      override: ({ command }) => command === "deploy" ? { stdout: JSON.stringify({ url: deployUrl }) } : null,
    });
    assert.equal(failure.tag, "setup", deployUrl);
  }
  for (const streamName of ["stdout", "stderr"]) {
    const { failure, signals } = await runProtocolFailure({
      override: ({ callIndex }) => callIndex === 0 ? { [streamName]: Buffer.alloc(CHILD_OUTPUT_LIMIT + 1) } : null,
    });
    assert.equal(failure.tag, "setup", `${streamName} overflow`);
    assert.deepEqual(signals, ["SIGTERM"], `${streamName} overflow termination`);
  }
  const synchronousCreateRunner = createConnectRunner({
    workingDirectory: inputRoot,
    repositoryRoot,
    env: { PATH: process.env.PATH },
    spawnFn() { throw new Error("invented synchronous create failure"); },
  });
  await assert.rejects(synchronousCreateRunner(nameArguments), (error) => error.tag === "setup");

  const cleanupRm = async (path, options) => {
    rmSync(path, options);
    throw new Error("invented cleanup failure");
  };
  for (const [label, owner] of [["success cleanup", "owner@example.com"], ["conflict cleanup precedence", "different@example.com"]]) {
    const { failure } = await runProtocolFailure({ arguments: siteArguments(owner), rmFn: cleanupRm });
    assert.equal(failure.tag, "cleanup", label);
  }

  const timeoutSignals = [];
  const timeoutTimers = [];
  const timeoutRunner = createConnectRunner({
    workingDirectory: inputRoot,
    repositoryRoot,
    env: { PATH: process.env.PATH },
    setTimeoutFn(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timeoutTimers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) { timer.cleared = true; },
    spawnFn() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = (childSignal) => {
        timeoutSignals.push(childSignal);
        if (childSignal === "SIGKILL") process.nextTick(() => {
          child.stdout.end();
          child.stderr.end();
          child.emit("close", null, "SIGKILL");
        });
        return true;
      };
      return child;
    },
  });
  const timedRun = timeoutRunner(siteArguments());
  for (let attempt = 0; attempt < 100 && !timeoutTimers.some((timer) => timer.milliseconds === 60_000); attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  const operationTimer = timeoutTimers.find((timer) => timer.milliseconds === 60_000);
  assert.ok(operationTimer, "operation timeout was initiated");
  operationTimer.callback();
  const escalationTimer = timeoutTimers.find((timer) => timer.milliseconds === 2_000);
  assert.ok(escalationTimer, "kill escalation was initiated");
  escalationTimer.callback();
  await assert.rejects(timedRun, (error) => error.tag === "setup");
  assert.deepEqual(timeoutSignals, ["SIGTERM", "SIGKILL"]);
  assert.ok(timeoutTimers.every((timer) => timer.cleared));

  const fakeBin = join(testRoot, "bin");
  const fakeCli = join(fakeBin, "netlify");
  const statePath = join(testRoot, "fake-state.json");
  const blobPath = join(testRoot, "fake-blob.json");
  mkdirSync(fakeBin);
  writeFileSync(statePath, "{}\n");
  writeFileSync(fakeCli, `#!/usr/bin/env node
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(statePath)};
const blobPath = ${JSON.stringify(blobPath)};
const state = JSON.parse(readFileSync(statePath, "utf8"));
const siteId = "123e4567-e89b-12d3-a456-426614174000";
const exact = (expected) => JSON.stringify(args) === JSON.stringify(expected);
const reject = () => { process.exitCode = 2; };
const save = () => writeFileSync(statePath, JSON.stringify(state));
const help = {
  "sites:create": ["$ netlify sites:create [options]", ["--disable-linking", "--json", "--name <name>"]],
  "sites:search": ["$ netlify sites:search [options] <search-term>", ["--json"]],
  "env:get": ["$ netlify env:get [options] <name>", ["--context <context>"]],
  "env:set": ["$ netlify env:set [options] <key> [value]", []],
  "blobs:set": ["$ netlify blobs:set [options] <store> <key> [value...]", ["--input <path>"]],
  "blobs:get": ["$ netlify blobs:get [options] <store> <key>", ["--output <path>"]],
  "blobs:delete": ["$ netlify blobs:delete [options] <store> <key>", ["--force"]],
  deploy: ["$ netlify deploy [options]", ["--prod", "--no-build", "--dir <path>", "--json"]],
  "sites:delete": ["$ netlify sites:delete [options] <id>", ["--force"]],
};
if (exact(["--version"])) process.stdout.write("netlify-cli/27.4.2\\n");
else if (args.length === 2 && args[1] === "--help" && help[args[0]] !== undefined) {
  const [usage, options] = help[args[0]];
  process.stdout.write("USAGE\\n" + usage + "\\n\\nOPTIONS\\n" + options.map((option) => "  " + option + "  fixture").join("\\n") + "\\n");
} else if (args[0] === "sites:search") {
  if (args.length !== 3 || args[2] !== "--json") reject();
  else process.stdout.write(JSON.stringify(state.siteName === args[1] ? [{ id: siteId, name: state.siteName }] : []));
} else if (args[0] === "sites:create") {
  if (args.length !== 5 || args[1] !== "--name" || args[3] !== "--disable-linking" || args[4] !== "--json") reject();
  else { state.siteName = args[2]; save(); process.stdout.write(JSON.stringify({ site_id: siteId })); }
} else if (args[0] === "sites:delete") {
  if (!exact(["sites:delete", siteId, "--force"])) reject();
  else { delete state.siteName; delete state.owner; state.deleted = (state.deleted ?? 0) + 1; save(); }
} else if (args[0] === "blobs:delete") {
  if (!exact(["blobs:delete", "doc-state", "mode/4b7d2a/manifest.json", "--force"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
} else if (args[0] === "env:get") {
  if (!exact(["env:get", "DOC_OWNERS", "--context", "production"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else if (state.owner === undefined) process.exitCode = 1;
  else process.stdout.write(state.owner + "\\n");
} else if (args[0] === "env:set") {
  if (
    args.length !== 3 ||
    args[0] !== "env:set" ||
    args[1] !== "DOC_OWNERS" ||
    !["4b7d2a:owner@example.com", "4b7d2a:hosted@example.com"].includes(args[2]) ||
    process.env.NETLIFY_SITE_ID !== siteId
  ) reject();
  else { state.owner = args[2]; save(); }
} else if (args[0] === "blobs:set") {
  const input = args[4];
  if (args.length !== 5 || !exact(["blobs:set", "doc-state", "mode/4b7d2a/manifest.json", "--input", input]) || !isAbsolute(input) || basename(input) !== "manifest.input" || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else copyFileSync(input, blobPath);
} else if (args[0] === "blobs:get") {
  const output = args[4];
  if (args.length !== 5 || !exact(["blobs:get", "doc-state", "mode/4b7d2a/manifest.json", "--output", output]) || !isAbsolute(output) || basename(output) !== "manifest.output" || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else if (state.drift === true) writeFileSync(output, Buffer.concat([readFileSync(blobPath), Buffer.from("\\n")]));
  else copyFileSync(blobPath, output);
} else if (args[0] === "deploy") {
  if (!exact(["deploy", "--prod", "--no-build", "--dir", "publish", "--json"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else { state.deploys = (state.deploys ?? 0) + 1; save(); process.stdout.write('{"url":"https://fixture-site.netlify.app/"}'); }
} else process.exitCode = 2;
`);
  chmodSync(fakeCli, 0o700);
  const originalCliPath = Object.getOwnPropertyDescriptor(process.env, "NETLIFY_CLI_PATH")?.value;
  process.env.NETLIFY_CLI_PATH = fakeCli;
  try {
    for (const abortKind of ["fetch timeout", "lifecycle timeout"]) {
      let deadlineCallback = null;
      let bodyStarted = false;
      let bodyAborted = false;
      let bodyCancelled = false;
      const fakeFetch = async (_url, options) => ({
        status: 302,
        headers: new Map([
          ["location", "/login/?next=%2F"],
          ["cache-control", "private, no-store"],
        ]),
        body: {
          async cancel() { bodyCancelled = true; },
        },
        arrayBuffer() {
          bodyStarted = true;
          return new Promise((_resolvePromise, rejectPromise) => {
            const aborted = () => {
              bodyAborted = true;
              rejectPromise(options.signal.reason);
            };
            options.signal.addEventListener("abort", aborted, { once: true });
            if (options.signal.aborted) aborted();
            if (abortKind === "lifecycle timeout") process.nextTick(() => deadlineCallback());
          });
        },
      });
      const hostedFailure = runHosted(connect, {
        fetchFn: fakeFetch,
        fetchTimeoutMs: abortKind === "fetch timeout" ? 5 : 10_000,
        repositoryRoot,
        ...(abortKind === "lifecycle timeout" ? {
          scheduleDeadline(callback) {
            deadlineCallback = callback;
            return { kind: "deadline" };
          },
          clearDeadline() {},
        } : {}),
      });
      let hostedError;
      try { await hostedFailure; } catch (error) { hostedError = error; }
      assert.ok(hostedError, `${abortKind} rejected`);
      assert.equal(hostedError.message, `hosted ${abortKind}`);
      assert.equal(bodyStarted, true, `${abortKind} body started: ${hostedError.stack}\n${readFileSync(statePath, "utf8")}`);
      assert.equal(bodyAborted, true, `${abortKind} aborted stalled body`);
      assert.equal(bodyCancelled, true, `${abortKind} cancelled failed body`);
      const hostedState = JSON.parse(readFileSync(statePath, "utf8"));
      assert.equal(hostedState.siteName, undefined, `${abortKind} remote cleanup`);
      assert.ok(hostedState.deleted >= 1, `${abortKind} site deleted`);
    }
  } finally {
    if (originalCliPath === undefined) delete process.env.NETLIFY_CLI_PATH;
    else process.env.NETLIFY_CLI_PATH = originalCliPath;
  }
  const rejectedBlob = spawnSync(fakeCli, [
    "blobs:set", "wrong-store", `mode/${docId}/manifest.json`, "--input", join(inputRoot, "edit.json"),
  ], {
    env: { PATH: process.env.PATH, NETLIFY_SITE_ID: "123e4567-e89b-12d3-a456-426614174000" },
    encoding: "utf8",
  });
  assert.equal(rejectedBlob.status, 2);
  assert.equal(rejectedBlob.stdout, "");
  assert.equal(rejectedBlob.stderr, "");
  const helpCommand = spawnSync(process.execPath, [join(repositoryRoot, "scripts", "connect.mjs"), "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(helpCommand.status, 0);
  assert.equal(helpCommand.stderr, "");
  assert.equal(helpCommand.stdout,
    "node scripts/connect.mjs --file <html> --manifest <edit.json> [--history <history.json>] --owner <email> --name <new-site-name>\n" +
    "node scripts/connect.mjs --file <html> --manifest <edit.json> [--history <history.json>] --owner <email> --site <site-id>\n" +
    "--history is required when manifest.commit is set; omit --history and #doc-history when it is empty.\n" +
    "node scripts/connect.mjs --help\n");
  const command = spawnSync(process.execPath, [
    join(repositoryRoot, "scripts", "connect.mjs"),
    "--file", join(inputRoot, "page.html"),
    "--manifest", join(inputRoot, "edit.json"),
    "--history", join(inputRoot, "history.json"),
    "--owner", "OWNER@example.com",
    "--site", "123e4567-e89b-12d3-a456-426614174000",
  ], {
    cwd: repositoryRoot,
    env: { PATH: `${fakeBin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stderr, "");
  assert.equal(command.stdout,
    "Connected document 4b7d2a with owner owner@example.com at https://fixture-site.netlify.app/.\n" +
    "Whoever can deploy this file decides who owns it.\n" +
    "WARNING: In standalone mode, an editor can change the live document without review.\n" +
    "WARNING: Export is the only path back to a reviewable artifact.\n" +
    "WARNING: A Netlify account with site access outranks the document owner.\n");
  const commandTempRoot = join(testRoot, "command-tmp");
  mkdirSync(commandTempRoot);
  const noHistoryCommand = spawnSync(process.execPath, [
    join(repositoryRoot, "scripts", "connect.mjs"),
    "--file", join(inputRoot, "page-no-history.html"),
    "--manifest", join(inputRoot, "edit-no-history.json"),
    "--owner", "OWNER@example.com",
    "--name", "no-history-fixture",
  ], {
    cwd: repositoryRoot,
    env: { PATH: `${fakeBin}:${process.env.PATH}`, TMPDIR: commandTempRoot },
    encoding: "utf8",
  });
  assert.equal(noHistoryCommand.status, 0, noHistoryCommand.stderr);
  assert.equal(noHistoryCommand.stderr, "");
  assert.equal(noHistoryCommand.stdout, command.stdout);
  assert.doesNotMatch(noHistoryHtml, /Example Author/);
  assert.deepEqual(readdirSync(commandTempRoot), [], "no-history create cleans its temporary project");
  const stateAfterNoHistoryCreate = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stateAfterNoHistoryCreate.siteName, "no-history-fixture", "successful create keeps the new site");
  const deploysAfterSuccess = stateAfterNoHistoryCreate.deploys;
  assert.ok(Number.isInteger(deploysAfterSuccess) && deploysAfterSuccess >= 1);
  const runCommand = (owner) => spawnSync(process.execPath, [
    join(repositoryRoot, "scripts", "connect.mjs"),
    "--file", join(inputRoot, "page.html"),
    "--manifest", join(inputRoot, "edit.json"),
    "--history", join(inputRoot, "history.json"),
    "--owner", owner,
    "--site", "123e4567-e89b-12d3-a456-426614174000",
  ], {
    cwd: repositoryRoot,
    env: { PATH: `${fakeBin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  const conflictCommand = runCommand("different@example.com");
  assert.equal(conflictCommand.status, 1);
  assert.equal(conflictCommand.stdout, "");
  assert.equal(conflictCommand.stderr, "connect: setup failed\n");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).deploys, deploysAfterSuccess, "conflict never deploys");
  const driftedState = JSON.parse(readFileSync(statePath, "utf8"));
  driftedState.drift = true;
  writeFileSync(statePath, JSON.stringify(driftedState));
  const driftCommand = runCommand("owner@example.com");
  assert.equal(driftCommand.status, 1);
  assert.equal(driftCommand.stdout, "");
  assert.equal(driftCommand.stderr, "connect: setup failed\n");
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).deploys, deploysAfterSuccess, "read-back drift never deploys");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

console.log("PASS  P4-S pure connect contract");
console.log("PASS  P4-S supervised Netlify protocol");
}
