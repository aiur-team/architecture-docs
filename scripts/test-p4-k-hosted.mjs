#!/usr/bin/env node
/**
 * P4-K — the isolated hosted acceptance oracle.
 *
 *   node scripts/test-p4-k-hosted.mjs
 *
 * Two of this ticket's acceptance criteria cannot be proved anywhere but a
 * real deployment, and both are provider-acceptance boundaries rather than
 * application behavior:
 *
 *   1. Netlify's *default* recovery email links at the site root. The
 *      anonymous edge gate answers that request with a 302 whose `Location`
 *      carries no fragment, so a conforming browser must carry the original
 *      `#recovery_token=…` through to `/login/`, where the P2-A bridge hands
 *      it to `/invite/`. A copied token pasted by hand proves nothing about
 *      that path.
 *   2. The pinned `@netlify/identity` package and the Functions v2 runtime --
 *      not application code -- attach the session headers that log the
 *      recovered user in. The only honest test is that the very same browser
 *      context authenticates on its next `/api/session` request without a
 *      second login call.
 *
 * The runner owns a freshly created, randomly named, invite-only Netlify site
 * and its deletion. It never reuses another ticket's site. Everything it
 * creates is registered for deletion before it is built, and cleanup failure
 * fails the gate even after behavioral success.
 *
 * Nothing secret is ever printed. Recovery URLs, tokens, passwords and
 * credentials live only in local closures; stdout is exactly one line and
 * carries no identifier.
 *
 * Operator-supplied environment (all required):
 *
 *   NETLIFY_AUTH_TOKEN     a personal access token that may create sites
 *   NETLIFY_ACCOUNT_SLUG   the account the disposable site is created under
 *   P4K_TEST_EMAIL         the invited address the mailbox adapter watches
 *   P4K_MAILBOX_BASE_URL   the adapter endpoint (bare absolute HTTPS URL)
 *   P4K_MAILBOX_BEARER     the adapter bearer credential
 */

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
const API = "https://api.netlify.com/api/v1";
const PLAYWRIGHT = "playwright@1.55.0";

const DEADLINE_MS = 900_000;
const INSTALL_DEADLINE_MS = 900_000;
const TERM_GRACE_MS = 2_000;
const MAX_STREAM_BYTES = 1024 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

const MAILBOX_TIMEOUT_MS = 10_000;
const MAILBOX_WAIT_MS = 30_000;
const MAX_MAILBOX_BYTES = 8_192;
const MESSAGE_ID = /^[\x20-\x7e]{1,128}$/;
const RECOVERY_FRAGMENT = /^#recovery_token=([A-Za-z0-9._~-]{20,4096})$/;
const SITE_ABSENT_ATTEMPTS = 12;

/** The example document this repository ships, and where a deploy serves it. */
const DOC = "a2e912";
const DOC_PATH = "/example.html";

const READY = "Choose a password to finish signing in.";
const DONE = "Password set. Open the document URL shared by the owner.";

const HOSTED_ENV = [
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_ACCOUNT_SLUG",
  "P4K_TEST_EMAIL",
  "P4K_MAILBOX_BASE_URL",
  "P4K_MAILBOX_BEARER",
];

const EXPECTED_STDOUT =
  "PASS  P4-K hosted default fragment, v2 cookies, access, replay, revoke, and cleanup\n";

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function fail(message) {
  throw new Error(`hosted proof failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} (saw ${JSON.stringify(actual)})`);
}

function requireHostedEnv() {
  for (const name of HOSTED_ENV) {
    const value = process.env[name];
    if (typeof value !== "string" || value.length === 0) {
      die(`${name} must be a non-empty operator-supplied value`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Supervisor.
 * ------------------------------------------------------------------ */

function install(root) {
  const browsers = join(root, "browsers");
  const npm = spawnSync(
    "npm",
    ["install", "--ignore-scripts", "--no-save", "--no-audit", "--no-fund",
     "--silent", "--prefix", root, PLAYWRIGHT],
    { stdio: ["ignore", "ignore", "pipe"], timeout: INSTALL_DEADLINE_MS, encoding: "utf8" },
  );
  if (npm.status !== 0) {
    die(`could not install ${PLAYWRIGHT}: ${(npm.stderr || "").split("\n")[0]}`);
  }
  const cli = join(root, "node_modules", "playwright", "cli.js");
  if (!existsSync(cli)) die(`the pinned ${PLAYWRIGHT} install produced no CLI`);
  const chromium = spawnSync(process.execPath, [cli, "install", "chromium"], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: INSTALL_DEADLINE_MS,
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
  });
  if (chromium.status !== 0) {
    die(`could not install the pinned Chromium: ${(chromium.stderr || "").split("\n")[0]}`);
  }
  return browsers;
}

async function parent() {
  requireHostedEnv();
  const tempRoot = await mkdtemp(join(tmpdir(), "p4k-hosted-"));
  const problems = [];
  let stdout = "";

  try {
    const browsers = install(tempRoot);
    const nonce = randomBytes(32).toString("hex");

    let child;
    let timer = null;
    let killTimer = null;
    let timedOut = false;
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const forwarded = ["SIGHUP", "SIGINT", "SIGTERM"];
    const forwarders = new Map();

    const finished = await new Promise((resolveRun) => {
      child = spawn(process.execPath, ["--no-warnings", SELF, "--worker"], {
        cwd: ROOT,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          P4K_NONCE: nonce,
          P4K_TEMP_ROOT: tempRoot,
          PLAYWRIGHT_BROWSERS_PATH: browsers,
        },
      });

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

    if (timer !== null) clearTimeout(timer);
    if (killTimer !== null) clearTimeout(killTimer);
    for (const [signal, handler] of forwarders) process.off(signal, handler);

    stdout = Buffer.concat(chunks.stdout).toString("utf8");
    const stderr = Buffer.concat(chunks.stderr).toString("utf8");

    let groupGone = false;
    for (let attempt = 0; attempt < 40 && !groupGone; attempt += 1) {
      try {
        process.kill(-child.pid, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        groupGone = true;
      }
    }

    if (timedOut) problems.push(`worker exceeded the ${DEADLINE_MS} ms deadline`);
    if (finished.code !== 0) {
      problems.push(`worker exited with code ${finished.code} signal ${finished.signal}`);
    }
    if (stderr !== "") problems.push(`worker stderr was not empty:\n${stderr}`);
    if (stdout !== EXPECTED_STDOUT) {
      problems.push(`worker stdout did not match the expected transcript:\n${stdout}`);
    }
    if (!groupGone) problems.push("the worker process group did not disappear");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (problems.length !== 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(stdout);
}

/* ------------------------------------------------------------------ *
 * The mailbox adapter. Its protocol is frozen by the specification.
 * ------------------------------------------------------------------ */

function mailboxUrl() {
  let url;
  try {
    url = new URL(process.env.P4K_MAILBOX_BASE_URL);
  } catch {
    fail("P4K_MAILBOX_BASE_URL is not an absolute URL");
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.search !== "" || url.hash !== "") {
    fail("P4K_MAILBOX_BASE_URL must be a bare absolute HTTPS URL");
  }
  return url;
}

/**
 * One adapter call. `after` is the previous message id, or the empty string
 * for the first wait; the reply's `url` is returned to the caller's closure
 * and to nowhere else.
 */
async function mailbox(url, action, after = "") {
  const body = action === "purge"
    ? { v: 1, action: "purge", email: process.env.P4K_TEST_EMAIL }
    : {
        v: 1,
        action: "wait-recovery",
        email: process.env.P4K_TEST_EMAIL,
        after,
        timeoutMs: MAILBOX_WAIT_MS,
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAILBOX_TIMEOUT_MS + MAILBOX_WAIT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${process.env.P4K_MAILBOX_BEARER}`,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    fail(`the mailbox adapter did not answer the ${action} call`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (action === "purge") {
    assertEqual(response.status, 204, "mailbox purge must answer 204");
    const empty = await response.arrayBuffer();
    assertEqual(empty.byteLength, 0, "mailbox purge must return zero bytes");
    return null;
  }

  assertEqual(response.status, 200, "mailbox wait must answer 200");
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.byteLength > MAX_MAILBOX_BYTES) fail("mailbox response exceeded its bound");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    fail("mailbox response was not bounded fatal-UTF-8 JSON");
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "messageId,url,v" || parsed.v !== 1 ||
      typeof parsed.messageId !== "string" || !MESSAGE_ID.test(parsed.messageId) ||
      typeof parsed.url !== "string") {
    fail("mailbox wait result did not match its exact shape");
  }
  let link;
  try {
    link = new URL(parsed.url);
  } catch {
    fail("mailbox wait result did not carry an absolute URL");
    return null;
  }
  const match = RECOVERY_FRAGMENT.exec(link.hash);
  if (link.protocol !== "https:" || match === null) {
    fail("mailbox wait result did not carry exactly one recovery token fragment");
  }
  return { messageId: parsed.messageId, url: parsed.url, link, token: match[1] };
}

/* ------------------------------------------------------------------ *
 * The Netlify surface.
 * ------------------------------------------------------------------ */

async function netlify(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,
      ...(init.headers || {}),
    },
    redirect: "error",
  });
  if (response.status === 404) return { status: 404, body: null };
  if (response.status >= 400) fail(`Netlify API ${path} answered ${response.status}`);
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

function sha1(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

/**
 * Deploy the checked-out candidate through the documented digest API: declare
 * every file with its SHA-1, then upload only what the API asks for. No
 * repository manifest, lockfile or cache is modified.
 */
async function deploy(siteId, workspace) {
  const publishable = new Map([
    ["/example.html", "example/dist/example.html"],
    ["/login/index.html", "login/index.html"],
    ["/invite/index.html", "invite/index.html"],
    ["/netlify.toml", "netlify.toml"],
  ]);

  const digests = new Map();
  for (const [servedAt, repoPath] of publishable) {
    const bytes = await readFile(join(ROOT, repoPath));
    digests.set(servedAt, { bytes, sha: sha1(bytes) });
  }

  const zipDir = join(workspace, "functions");
  await mkdir(zipDir, { recursive: true });
  const functionZips = new Map();
  try {
    for (const name of ["accept", "access", "session", "login", "logout"]) {
      const zipPath = join(zipDir, `${name}.zip`);
      execFileSync("zip", ["-q", "-j", zipPath, join(ROOT, "netlify/functions", `${name}.mjs`)]);
      const bytes = await readFile(zipPath);
      functionZips.set(name, { bytes, sha: sha1(bytes) });
    }

    const files = {};
    for (const [key, value] of digests) files[key] = value.sha;
    const functions = {};
    for (const [key, value] of functionZips) functions[key] = value.sha;

    const created = await netlify(`/sites/${siteId}/deploys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, functions, async: false }),
    });
    const deployId = created.body.id;

    for (const sha of created.body.required || []) {
      const found = [...digests.entries()].find(([, value]) => value.sha === sha);
      if (found === undefined) continue;
      await netlify(`/deploys/${deployId}/files${found[0]}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: found[1].bytes,
      });
    }
    for (const sha of created.body.required_functions || []) {
      const found = [...functionZips.entries()].find(([, value]) => value.sha === sha);
      if (found === undefined) continue;
      await netlify(`/deploys/${deployId}/functions/${found[0]}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: found[1].bytes,
      });
    }
    return deployId;
  } finally {
    await rm(zipDir, { recursive: true, force: true });
  }
}

async function waitForDeploy(deployId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = await netlify(`/deploys/${deployId}`);
    const state = probe.body === null ? "unknown" : probe.body.state;
    if (state === "ready") return;
    if (state === "error") fail("the disposable deploy failed");
    await new Promise((done) => setTimeout(done, 2_000));
  }
  fail("the disposable deploy never became ready");
}

async function waitForSiteAbsence(siteId) {
  for (let attempt = 0; attempt < SITE_ABSENT_ATTEMPTS; attempt += 1) {
    const probe = await netlify(`/sites/${siteId}`);
    if (probe.status === 404) return;
    await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
  }
  fail("the disposable site was still present after deletion");
}

/* ------------------------------------------------------------------ *
 * The proof.
 * ------------------------------------------------------------------ */

async function worker() {
  const nonce = process.env.P4K_NONCE;
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    die("scripts/test-p4-k-hosted.mjs --worker is a supervised entry point");
  }
  const tempRoot = process.env.P4K_TEMP_ROOT;
  if (typeof tempRoot !== "string" || tempRoot.length === 0 || !existsSync(tempRoot)) {
    die("scripts/test-p4-k-hosted.mjs --worker requires its supervised temporary root");
  }
  requireHostedEnv();

  const workspace = await mkdtemp(join(tempRoot, "run-"));
  try {
    await runHostedProof(workspace, tempRoot);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  process.stdout.write(EXPECTED_STDOUT);
}

async function runHostedProof(workspace, tempRoot) {
  const adapter = mailboxUrl();
  const entry = join(tempRoot, "node_modules", "playwright", "index.js");
  const loaded = await import(pathToFileURL(entry).href);
  const playwright = loaded.chromium !== undefined ? loaded : loaded.default;

  const suffix = randomBytes(5).toString("hex");
  const siteName = `p4k-${suffix}`;
  const ownerEmail = `p4k-owner-${suffix}@example.invalid`;
  const ownerPassword = `${randomBytes(12).toString("base64url")}Aa1!`;
  const invitedPassword = `${randomBytes(12).toString("base64url")}Zz9!`;
  const replayPassword = `${randomBytes(12).toString("base64url")}Qq7!`;

  /* The site is created first and registered for deletion before anything is
     provisioned inside it, so an abort at any later point still cleans up. */
  const created = await netlify(`/${process.env.NETLIFY_ACCOUNT_SLUG}/sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: siteName,
      build_settings: { env: { DOC_OWNERS: `${DOC}:${ownerEmail}` } },
    }),
  });
  const siteId = created.body.id;
  const origin = `https://${siteName}.netlify.app`;

  let behaviorError = null;
  let cleanupError = null;
  let browser = null;

  try {
    await netlify(`/sites/${siteId}/services/identity/instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { registration: "invite" } }),
    });
    const deployId = await deploy(siteId, workspace);
    await waitForDeploy(deployId);

    /* A clean mailbox, so the first message this proof observes is the one it
       caused. */
    await mailbox(adapter, "purge");

    await netlify(`/sites/${siteId}/identity/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword, confirm: true }),
    });

    browser = await playwright.chromium.launch();
    const ownerContext = await browser.newContext({ baseURL: origin });
    const ownerPage = await ownerContext.newPage();
    const signedIn = await ownerPage.request.post(`${origin}/api/login`, {
      form: { email: ownerEmail, password: ownerPassword, next: "/" },
      maxRedirects: 0,
    });
    if (signedIn.status() !== 302) fail("the owner fixture could not sign in");

    const invite = async () => ownerPage.request.post(`${origin}/api/access`, {
      headers: { "Content-Type": "application/json" },
      data: { doc: DOC, email: process.env.P4K_TEST_EMAIL, role: "viewer" },
    });

    const firstInvite = await invite();
    assertEqual(firstInvite.status(), 204, "the owner may invite the test address");
    const first = await mailbox(adapter, "wait-recovery", "");

    /* P4-J's reissue is the owner repeating the exact same-role invite POST
       against the still-live invitation. It must produce a second, distinct
       recovery message without a second account or an access transition. */
    const reissued = await invite();
    assertEqual(reissued.status(), 204, "the owner may reissue the same-role invitation");
    const second = await mailbox(adapter, "wait-recovery", first.messageId);
    if (second.messageId === first.messageId) {
      fail("the reissue produced no distinct second recovery message");
    }

    /* The invited person is a different browser context with no cookies of
       any kind, navigating the provider's own link. */
    const inviteeContext = await browser.newContext({ baseURL: origin });
    const inviteePage = await inviteeContext.newPage();
    const landing = new URL(second.url);
    assertEqual(landing.origin, origin, "the recovery link points at the deployed site");
    assertEqual(landing.pathname, "/", "the default recovery link lands at the site root");

    await inviteePage.goto(second.url);
    await inviteePage.waitForURL((url) => url.pathname === "/invite/");
    assertEqual(
      await inviteePage.evaluate(() => location.hash),
      "",
      "production /invite/ removes the fragment before the form appears",
    );
    assertEqual(
      await inviteePage.textContent("#invite-status"),
      READY,
      "the invited person is asked for a password",
    );
    assertEqual(
      await inviteePage.$eval("#invite-form", (form) => form.hidden),
      false,
      "the password form is revealed only after the fragment is gone",
    );

    await inviteePage.fill("#invite-password", invitedPassword);
    await inviteePage.fill("#invite-confirm", invitedPassword);
    await inviteePage.click("button[type=submit]");
    await inviteePage.waitForFunction(
      (done) => document.getElementById("invite-status").textContent === done,
      DONE,
      { timeout: 30_000 },
    );

    /* The v2 contract: the same context authenticates on its next request
       without a second login call, using only what the package and runtime
       attached to the acceptance response. */
    const session = await inviteePage.request.get(`${origin}/api/session?doc=${DOC}`);
    assertEqual(session.status(), 200, "the recovered session authenticates without a second login");
    const seen = await session.json();
    assertEqual(
      seen.identity.email,
      process.env.P4K_TEST_EMAIL.trim().toLowerCase(),
      "the session proves the invited email",
    );
    assertEqual(seen.access.role, "viewer", "P3-H converted the matching live invitation");
    const invitedSub = seen.identity.sub;

    const document = await inviteePage.request.get(origin + DOC_PATH);
    assertEqual(document.status(), 200, "the converted grant reads the document");

    /* Replay. The token is reused once from memory; it is never printed,
       written to a file, or placed in a process argument. */
    const replay = await inviteePage.request.post(`${origin}/api/accept`, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      data: { token: second.token, password: replayPassword },
    });
    assertEqual(replay.status(), 400, "a replayed recovery token is refused");

    /* Revocation returns the document to the generic refusal. Acceptance
       never fabricated a role, and losing the grant loses the document. */
    const revoked = await ownerPage.request.fetch(`${origin}/api/access`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      data: { doc: DOC, sub: invitedSub },
    });
    assertEqual(revoked.status(), 204, "the owner may revoke the grant");

    const refused = await inviteePage.request.get(origin + DOC_PATH);
    assertEqual(refused.status(), 403, "a revoked grant receives the generic refusal");
  } catch (error) {
    behaviorError = error;
  }

  try {
    if (browser !== null) await browser.close();
    await mailbox(adapter, "purge");
    const users = await netlify(`/sites/${siteId}/identity/users`);
    for (const user of Array.isArray(users.body) ? users.body : []) {
      await netlify(`/sites/${siteId}/identity/users/${user.id}`, { method: "DELETE" });
    }
    /* Deleting the site removes its blob stores with it; the poll below is
       what proves both are actually gone rather than merely requested. */
    await netlify(`/sites/${siteId}`, { method: "DELETE" });
    await waitForSiteAbsence(siteId);
  } catch (error) {
    cleanupError = error;
  }

  if (behaviorError !== null) throw behaviorError;
  if (cleanupError !== null) throw cleanupError;
}

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") {
    if (argv.length !== 1) die("usage: scripts/test-p4-k-hosted.mjs --worker");
    await worker();
    return;
  }
  if (argv.length !== 0) die("usage: scripts/test-p4-k-hosted.mjs");
  await parent();
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
