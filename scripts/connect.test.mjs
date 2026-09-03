import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
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

async function runHostedChild(executable, args, cwd, { siteId = null, timeout = 60_000 } = {}) {
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

async function runHosted(connectModule) {
  let hostedTimedOut = false;
  const deadline = setTimeout(() => { hostedTimedOut = true; }, HOSTED_TIMEOUT);
  deadline.unref?.();
  const repositoryRoot = resolve(dirname(fileURLToPath(new URL("./connect.mjs", import.meta.url))), "..");
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

  const search = async () => {
    const result = await runHostedChild(executable, ["sites:search", siteName, "--json"], evidenceRoot);
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
    const version = await runHostedChild(executable, ["--version"], evidenceRoot);
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
      const result = await runHostedChild(executable, args, evidenceRoot);
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
    const hostedHtml = `<meta name="doc-id" content="${hostedDocId}">\n<!doctype html><html><body><p data-editable data-aid="${hostedAid}">${hostedInner}</p><script type="application/json" id="doc-history">${JSON.stringify(hostedHistory).replaceAll("</", "<\\/")}</script></body></html>\n`;
    writeFileSync(join(inputRoot, "page.html"), hostedHtml);
    writeFileSync(join(inputRoot, "edit.json"), `${JSON.stringify(hostedManifest, null, 2)}\n`);
    writeFileSync(join(inputRoot, "history.json"), `${JSON.stringify(hostedHistory, null, 2)}\n`);
    const hostedCalls = [];
    const wrappedSpawn = (command, args, options) => {
      hostedCalls.push([...args]);
      const child = spawn(command, args, options);
      if (args[0] === "blobs:set") blobWriteMayHaveOccurred = true;
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
    const response = await fetch(first.url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login/?next=%2F");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  } finally {
    try {
      const matches = await search();
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
        if ((await search()).length === 0) {
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
    } finally {
      clearTimeout(deadline);
    }
    if (cleanupFailure || hostedTimedOut) throw new Error("hosted lifecycle failed");
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
const html =
  `<meta name="doc-id" content="${docId}">\n` +
  `<!doctype html><html><body><p data-editable data-aid="${aid}">${inner}</p>` +
  `<script type="application/json" id="doc-history">${JSON.stringify(history).replaceAll("</", "<\\/")}</script>` +
  `<script>const fake = '<meta name="doc-id" content="ffffff">';</script></body></html>\n`;
const unicodeRawTextHtml = html.replace(
  "<script>const fake",
  "<script>const dotted = 'İ'; const fake",
);

assert.deepEqual(inspectStandaloneHtml(html), { docId });
assert.deepEqual(assertModeManifest(manifest, html), { docId, manifest });
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
assert.throws(() => assertModeManifest({ ...manifest, commit: "" }, html));
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
        assert.ok(readFileSync(join(publishRoot, "index.html")).equals(Buffer.from(html)));
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
if (args[0] === "env:get") {
  if (!exact(["env:get", "DOC_OWNERS", "--context", "production"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else if (state.owner === undefined) process.exitCode = 1;
  else process.stdout.write(state.owner + "\\n");
} else if (args[0] === "env:set") {
  if (!exact(["env:set", "DOC_OWNERS", "4b7d2a:owner@example.com"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else { state.owner = args[2]; writeFileSync(statePath, JSON.stringify(state)); }
} else if (args[0] === "blobs:set") {
  const input = args[4];
  if (args.length !== 5 || !exact(["blobs:set", "doc-state", "mode/4b7d2a/manifest.json", "--input", input]) || !isAbsolute(input) || basename(input) !== "manifest.input" || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else copyFileSync(input, blobPath);
} else if (args[0] === "blobs:get") {
  const output = args[4];
  if (args.length !== 5 || !exact(["blobs:get", "doc-state", "mode/4b7d2a/manifest.json", "--output", output]) || !isAbsolute(output) || basename(output) !== "manifest.output" || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else copyFileSync(blobPath, output);
} else if (args[0] === "deploy") {
  if (!exact(["deploy", "--prod", "--no-build", "--dir", "publish", "--json"]) || process.env.NETLIFY_SITE_ID !== siteId) reject();
  else process.stdout.write('{"url":"https://fixture-site.netlify.app/"}');
} else process.exitCode = 2;
`);
  chmodSync(fakeCli, 0o700);
  const rejectedBlob = spawnSync(fakeCli, [
    "blobs:set", "wrong-store", `mode/${docId}/manifest.json`, "--input", join(inputRoot, "edit.json"),
  ], {
    env: { PATH: process.env.PATH, NETLIFY_SITE_ID: "123e4567-e89b-12d3-a456-426614174000" },
    encoding: "utf8",
  });
  assert.equal(rejectedBlob.status, 2);
  assert.equal(rejectedBlob.stdout, "");
  assert.equal(rejectedBlob.stderr, "");
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
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

console.log("PASS  P4-S pure connect contract");
console.log("PASS  P4-S supervised Netlify protocol");
}
