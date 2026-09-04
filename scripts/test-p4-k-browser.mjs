#!/usr/bin/env node
/**
 * P4-K — the permanent invite-page browser oracle.
 *
 *   node scripts/test-p4-k-browser.mjs
 *
 * The invite page is defined in terms of `location.hash`, `history`, focus,
 * forced colors and a single `fetch`. None of those can be asserted against a
 * hand-written DOM without asserting against my own approximation of one, so
 * this runner drives a real engine.
 *
 * It is self-supervised and self-contained. The parent installs exactly
 * `playwright@1.55.0` and one Chromium into a `mkdtemp()` root outside the
 * worktree, never falling back to a system browser or another version, then
 * spawns the matrix as a detached child under a real 120-second deadline,
 * signals its whole process group on timeout, escalates to `SIGKILL`, proves
 * the group is gone, and removes the root. The dependency fetch is not part of
 * the matrix and gets its own budget: a cold Chromium download is minutes of
 * network, and holding the behavioral deadline hostage to it would only ever
 * report the wrong failure.
 *
 * The matrix owns its own loopback origin, serving the production
 * `invite/index.html` and `login/index.html` byte-for-byte together with a
 * programmable `/api/accept` stub and a root redirect that stands in for
 * P2-A's anonymous edge redirect. No credential, no network beyond loopback,
 * and no repository state is touched.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
const PLAYWRIGHT = "playwright@1.55.0";
const DEADLINE_MS = 120_000;
const INSTALL_DEADLINE_MS = 900_000;
const TERM_GRACE_MS = 2_000;
const MAX_STREAM_BYTES = 1024 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;

const EXPECTED_STDOUT =
  "PASS  P4-K landing bridge, one-attempt secret, and accessibility matrix\n";

/* The fixed strings the page is allowed to show. A message that drifts from
   this list is a finding: the page must never say anything a token, an
   account or an invitation could be inferred from. */
const OFF_SITE = "This invitation page is available on the connected site.";
const UNUSABLE = "This invitation link cannot be used. Request a new invitation.";
const READY = "Choose a password to finish signing in.";
const LOCAL_INVALID = "Use 12–128 characters, and enter the same password twice.";
const WORKING = "Setting your password…";
const DONE = "Password set. Open the document URL shared by the owner.";
const FAILED = "This invitation could not be completed. Ask the owner to resend the setup link.";

/* An invented recovery token. It is not a credential for anything: the stub
   endpoint accepts whatever it is handed. */
const TOKEN = "Rk9VUi1LLXJlY292ZXJ5LXRva2Vu.abc_~-0123456789";
const PASSWORD = "correct horse battery staple";

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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
  const tempRoot = await mkdtemp(join(tmpdir(), "p4k-browser-"));
  let problems = [];
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

    /* The pinned install is the runner's own, and is removed before residue is
       judged; anything else left under the root is fixture state that leaked. */
    await rm(join(tempRoot, "node_modules"), { recursive: true, force: true });
    await rm(join(tempRoot, "package.json"), { force: true });
    await rm(join(tempRoot, "package-lock.json"), { force: true });
    await rm(browsers, { recursive: true, force: true });
    let residue = [];
    try {
      residue = await readdir(tempRoot);
    } catch {
      residue = [];
    }
    if (residue.length !== 0) {
      problems.push(`temporary fixture state was left behind: ${residue.join(", ")}`);
    }
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
 * The loopback origin.
 * ------------------------------------------------------------------ */

/**
 * Serve the production pages unchanged, plus the two seams the page depends
 * on: P2-A's anonymous root redirect, whose `Location` deliberately carries no
 * fragment, and a programmable `/api/accept`.
 */
async function startOrigin(state) {
  const invite = await readFile(join(ROOT, "invite/index.html"), "utf8");
  const login = await readFile(join(ROOT, "login/index.html"), "utf8");

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push({ method: req.method, path: url.pathname });

    if (req.method === "POST" && url.pathname === "/api/accept") {
      state.accepts.push(url.pathname);
      const mode = state.acceptMode;
      if (mode === "hang") return;
      if (mode === "redirect") {
        /* The page sends `redirect: "error"`, so a redirect must abort the
           request rather than be followed to a second endpoint. */
        res.writeHead(302, { Location: "/invite/", "Cache-Control": "private, no-store" });
        res.end();
        return;
      }
      if (mode === "200") {
        const body = "{}";
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }
      if (mode === "400") {
        const body = '{"error":"invalid-invitation"}';
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
        return;
      }
      res.writeHead(204, { "Cache-Control": "private, no-store", "Content-Length": "0" });
      res.end();
      return;
    }

    const html = (body) => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
    };

    if (url.pathname === "/") {
      /* P2-A's anonymous gate. RFC 9110 §10.2.2: a `Location` without a
         fragment leaves the request's own fragment in place. */
      res.writeHead(302, { Location: "/login/?next=%2F", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/login/") return html(login);
    if (url.pathname === "/invite/" || url.pathname === "/invite/elsewhere/") {
      return html(invite);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  /* The `hang` mode never answers, so a socket can outlive the page that
     opened it. Track every one and destroy them at close, or the runner
     deadlocks waiting for a connection nothing will ever finish. */
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const origin = await new Promise((resolveOrigin) => {
    server.listen(0, "127.0.0.1", () => {
      resolveOrigin(`http://127.0.0.1:${server.address().port}`);
    });
  });
  const close = () => new Promise((done) => {
    for (const socket of sockets) socket.destroy();
    server.close(done);
  });
  return { origin, close };
}

/* ------------------------------------------------------------------ *
 * The matrix.
 * ------------------------------------------------------------------ */

async function worker() {
  const nonce = process.env.P4K_NONCE;
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    die("scripts/test-p4-k-browser.mjs --worker is a supervised entry point");
  }
  const tempRoot = process.env.P4K_TEMP_ROOT;
  if (typeof tempRoot !== "string" || tempRoot.length === 0 || !existsSync(tempRoot)) {
    die("scripts/test-p4-k-browser.mjs --worker requires its supervised temporary root");
  }

  const entry = join(tempRoot, "node_modules", "playwright", "index.js");
  if (!existsSync(entry)) die(`the pinned ${PLAYWRIGHT} install is not present`);
  const loaded = await import(pathToFileURL(entry).href);
  const playwright = loaded.chromium !== undefined ? loaded : loaded.default;

  const state = { requests: [], accepts: [], acceptMode: "204" };
  const { origin, close } = await startOrigin(state);
  const failures = [];
  const browser = await playwright.chromium.launch();

  try {
    await runMatrix({ browser, origin, state, failures, tempRoot });
  } finally {
    await browser.close();
    await close();
  }

  if (failures.length !== 0) {
    throw new Error(`browser matrix failures:\n${failures.join("\n")}`);
  }
  process.stdout.write(EXPECTED_STDOUT);
}

async function runMatrix({ browser, origin, state, failures, tempRoot }) {
  const check = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const eq = (actual, expected, message) => {
    check(actual === expected, `${message} (saw ${JSON.stringify(actual)})`);
  };

  /** One fresh, isolated page per case; nothing carries over between them. */
  async function withPage(run, options = {}) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    try {
      return await run(page, context);
    } finally {
      await context.close();
    }
  }

  const statusOf = (page) => page.textContent("#invite-status");
  const formHidden = (page) => page.$eval("#invite-form", (form) => form.hidden);

  /* ---- the fragment state machine ---- */

  const rejectedFragments = [
    "",
    "#",
    "#recovery_token=",
    `#recovery_token=${"a".repeat(19)}`,
    `#recovery_token=${"a".repeat(4097)}`,
    `#recovery_token=${"a".repeat(20)}!`,
    `#recovery_token=${"a".repeat(20)}&next=/`,
    `#recovery_token=${"a".repeat(20)}%20`,
    `#RECOVERY_TOKEN=${"a".repeat(20)}`,
    `#recovery_token%3D${"a".repeat(20)}`,
    `#invite_token=${"a".repeat(20)}`,
    `#access_token=${"a".repeat(20)}`,
    `#error=access_denied&recovery_token=${"a".repeat(20)}`,
    "#anything-else",
  ];
  for (const fragment of rejectedFragments) {
    await withPage(async (page) => {
      const before = state.accepts.length;
      await page.goto(`${origin}/invite/${fragment}`);
      const label = `the fragment ${JSON.stringify(fragment.slice(0, 32))}`;
      eq(await statusOf(page), UNUSABLE, `${label} is refused`);
      eq(await formHidden(page), true, `${label} leaves the form hidden`);
      /* No URL rewrite at all: an invalid fragment must not even call
         history.replaceState(). */
      eq(
        await page.evaluate(() => location.hash),
        fragment === "#" ? "" : fragment,
        `${label} leaves the URL untouched`,
      );
      eq(state.accepts.length, before, `${label} issues no request`);
    });
  }

  /* A token-shaped query string is not a fragment and must not be honored. */
  await withPage(async (page) => {
    await page.goto(`${origin}/invite/?recovery_token=${"a".repeat(20)}`);
    eq(await statusOf(page), UNUSABLE, "a query-string token is refused");
    eq(await formHidden(page), true, "a query-string token leaves the form hidden");
  });

  /* The valid fragment: captured, removed from the URL before the form
     appears, and never written anywhere the page can be read from. */
  await withPage(async (page) => {
    await page.goto(`${origin}/invite/#recovery_token=${TOKEN}`);
    eq(await statusOf(page), READY, "a valid fragment is accepted");
    eq(await formHidden(page), false, "a valid fragment reveals the form");
    eq(await page.evaluate(() => location.hash), "", "the token leaves the URL");
    eq(
      await page.evaluate(() => location.pathname + location.search),
      "/invite/",
      "the URL is replaced with the bare page",
    );
    eq(
      await page.evaluate(() => document.activeElement.id),
      "invite-password",
      "the first password field takes focus",
    );
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    check(!html.includes(TOKEN), "the token must not appear anywhere in the DOM");
    const leaked = await page.evaluate((token) => {
      const names = Object.getOwnPropertyNames(window);
      for (const name of names) {
        let value;
        try {
          value = window[name];
        } catch {
          continue;
        }
        if (typeof value === "string" && value.includes(token)) return name;
      }
      return null;
    }, TOKEN);
    eq(leaked, null, "the token must not reach any global");
    const storage = await page.evaluate(() => [
      localStorage.length, sessionStorage.length, document.cookie, document.title,
    ]);
    eq(storage[0], 0, "local storage stays empty");
    eq(storage[1], 0, "session storage stays empty");
    eq(storage[2], "", "no client-side state is written for the session");
    eq(storage[3], "Set your password", "the title never carries a secret");
  });

  /* The one navigation entry left behind must not carry the token either. */
  await withPage(async (page) => {
    await page.goto(`${origin}/invite/#recovery_token=${TOKEN}`);
    await page.goBack().catch(() => {});
    const url = page.url();
    check(!url.includes(TOKEN), "history must not retain the token");
  });

  /* A page whose history replacement fails must fail closed. */
  await withPage(async (page) => {
    await page.addInitScript(() => {
      history.replaceState = () => {
        throw new Error("replaceState is unavailable");
      };
    });
    await page.goto(`${origin}/invite/#recovery_token=${TOKEN}`);
    eq(await statusOf(page), UNUSABLE, "a failed URL replacement fails closed");
    eq(await formHidden(page), true, "a failed URL replacement hides the form");
  });

  /* Wrong pathname and wrong protocol both stop before any network work. */
  await withPage(async (page) => {
    await page.goto(`${origin}/invite/elsewhere/#recovery_token=${TOKEN}`);
    eq(await statusOf(page), OFF_SITE, "another pathname is refused");
    eq(await formHidden(page), true, "another pathname leaves the form hidden");
  });
  const localCopy = join(tempRoot, "invite-copy.html");
  await writeFile(localCopy, await readFile(join(ROOT, "invite/index.html"), "utf8"), "utf8");
  await withPage(async (page) => {
    await page.goto(`${pathToFileURL(localCopy).href}#recovery_token=${TOKEN}`);
    eq(await statusOf(page), OFF_SITE, "a file: origin is refused");
    eq(await formHidden(page), true, "a file: origin leaves the form hidden");
  });
  await rm(localCopy, { force: true });

  /* ---- P2-A's landing bridge ---- */

  await withPage(async (page) => {
    /* The provider-default link: the root, with the fragment the mail carries.
       The redirect drops no fragment, so the bridge sees it. */
    await page.goto(`${origin}/#recovery_token=${TOKEN}`);
    await page.waitForURL((url) => url.pathname === "/invite/");
    eq(await statusOf(page), READY, "the default root link reaches the invite page");
    eq(await page.evaluate(() => location.hash), "", "the bridged token leaves the URL");
  });

  await withPage(async (page) => {
    await page.goto(`${origin}/login/#recovery_token=${TOKEN}`);
    await page.waitForURL((url) => url.pathname === "/invite/");
    eq(await formHidden(page), false, "the login bridge reveals the invite form");
  });

  /* Every non-recovery login case keeps P2-A's behavior exactly. */
  for (const [hash, label] of [
    ["", "a bare login page"],
    ["#invite_token=abcdefghijklmnopqrst", "an invite_token fragment"],
    ["#recovery_token=short", "a malformed recovery fragment"],
    ["#access_token=abcdefghijklmnopqrst", "an access_token fragment"],
  ]) {
    await withPage(async (page) => {
      await page.goto(`${origin}/login/?next=%2Fdoc%2F4b7d2a&error=1${hash}`);
      eq(page.url().includes("/login/"), true, `${label} stays on the login page`);
      eq(
        await page.$eval('input[name="next"]', (input) => input.value),
        "/doc/4b7d2a",
        `${label} still honors next`,
      );
      eq(
        await page.$eval("#login-error", (element) => element.hidden),
        false,
        `${label} still shows the login error`,
      );
    });
  }

  /* ---- the password boundary ---- */

  async function primed(page) {
    await page.goto(`${origin}/invite/#recovery_token=${TOKEN}`);
  }

  await withPage(async (page) => {
    await primed(page);
    /* The HTML ceiling counts UTF-16 units, and 256 of them is exactly the
       128-code-point astral maximum the validator admits. */
    eq(
      await page.$eval("#invite-password", (input) => input.maxLength),
      256,
      "the HTML ceiling is 256 UTF-16 units",
    );
    await page.locator("#invite-password").pressSequentially("a".repeat(260), { delay: 0 });
    eq(
      await page.$eval("#invite-password", (input) => input.value.length),
      256,
      "typing past the ceiling is truncated at 256 units",
    );
  });

  const astral = "\u{1f600}".repeat(128);
  await withPage(async (page) => {
    state.acceptMode = "204";
    const before = state.accepts.length;
    await primed(page);
    await page.fill("#invite-password", astral);
    await page.fill("#invite-confirm", astral);
    eq(
      await page.$eval("#invite-password", (input) => input.value.length),
      256,
      "the astral maximum occupies exactly the HTML ceiling",
    );
    await page.click("button[type=submit]");
    await page.waitForFunction(
      (done) => document.getElementById("invite-status").textContent === done,
      DONE,
    );
    eq(state.accepts.length, before + 1, "the astral maximum is submitted once");
  });

  const localRejections = [
    ["a".repeat(11), "a".repeat(11), "eleven characters"],
    ["a".repeat(129), "a".repeat(129), "one hundred and twenty-nine characters"],
    [PASSWORD, `${PASSWORD}!`, "a mismatched confirmation"],
    [PASSWORD, "", "an empty confirmation"],
    ["", "", "two empty fields"],
  ];
  for (const [value, repeat, label] of localRejections) {
    await withPage(async (page) => {
      const before = state.accepts.length;
      await primed(page);
      await page.fill("#invite-password", value);
      await page.fill("#invite-confirm", repeat);
      await page.click("button[type=submit]");
      eq(await statusOf(page), LOCAL_INVALID, `${label} is refused locally`);
      eq(state.accepts.length, before, `${label} issues no request`);
      /* A local failure is not an attempt: the person may correct it. */
      eq(await formHidden(page), false, `${label} leaves the form usable`);
      eq(
        await page.$eval("#invite-password", (input) => input.disabled),
        false,
        `${label} leaves the fields enabled`,
      );
      await page.fill("#invite-password", PASSWORD);
      await page.fill("#invite-confirm", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForFunction(
        (done) => document.getElementById("invite-status").textContent === done,
        DONE,
      );
      eq(state.accepts.length, before + 1, `${label} can still be corrected once`);
    });
  }

  /* ---- one attempt, and what settlement clears ---- */

  await withPage(async (page) => {
    state.acceptMode = "204";
    const before = state.accepts.length;
    await primed(page);
    await page.fill("#invite-password", PASSWORD);
    await page.fill("#invite-confirm", PASSWORD);

    await page.click("button[type=submit]");
    await page.waitForFunction(
      (done) => document.getElementById("invite-status").textContent === done,
      DONE,
    );
    eq(state.accepts.length, before + 1, "success submits exactly once");
    eq(await formHidden(page), true, "the form is sealed after settlement");
    eq(
      await page.$eval("#invite-form", (form) => form.hasAttribute("aria-busy")),
      false,
      "aria-busy is cleared on settlement",
    );
    const fields = await page.evaluate(() => [
      document.getElementById("invite-password").value,
      document.getElementById("invite-confirm").value,
      document.getElementById("invite-password").disabled,
      document.getElementById("invite-confirm").disabled,
      document.querySelector("button[type=submit]").disabled,
    ]);
    eq(fields[0], "", "the password field is cleared");
    eq(fields[1], "", "the confirmation field is cleared");
    eq(fields[2], true, "the password field stays disabled");
    eq(fields[3], true, "the confirmation field stays disabled");
    eq(fields[4], true, "the submit button stays disabled");
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    check(!html.includes(TOKEN), "the token is gone from the DOM after settlement");
    check(!html.includes(PASSWORD), "the password is gone from the DOM after settlement");

    /* A second submission performs no request, whatever is done to the form. */
    await page.evaluate(() => {
      document.getElementById("invite-form").hidden = false;
      for (const control of document.querySelectorAll("#invite-form input, #invite-form button")) {
        control.disabled = false;
      }
    });
    await page.fill("#invite-password", PASSWORD);
    await page.fill("#invite-confirm", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForTimeout(250);
    eq(state.accepts.length, before + 1, "a second submission performs no request");
  });

  /* Every settlement other than an exact 204 is the same fixed failure, and
     the token does not survive it. */
  for (const [mode, label] of [
    ["400", "a refused token"],
    ["200", "a 200 that is not the exact 204 contract"],
    ["redirect", "a redirect the page must refuse to follow"],
  ]) {
    await withPage(async (page) => {
      state.acceptMode = mode;
      const before = state.accepts.length;
      await primed(page);
      await page.fill("#invite-password", PASSWORD);
      await page.fill("#invite-confirm", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForFunction(
        (failed) => document.getElementById("invite-status").textContent === failed,
        FAILED,
      );
      eq(state.accepts.length, before + 1, `${label} is attempted exactly once`);
      eq(await formHidden(page), true, `${label} still seals the form`);
      await page.evaluate(() => {
        document.getElementById("invite-form").hidden = false;
        for (const control of document.querySelectorAll("#invite-form input, #invite-form button")) {
          control.disabled = false;
        }
      });
      await page.fill("#invite-password", PASSWORD);
      await page.fill("#invite-confirm", PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForTimeout(250);
      eq(state.accepts.length, before + 1, `${label} cannot be retried from the page`);
    });
  }

  /* The ten-second abort. The stub never answers; the page must give up on
     its own and say exactly what it says for every other failure. */
  await withPage(async (page) => {
    state.acceptMode = "hang";
    await primed(page);
    await page.fill("#invite-password", PASSWORD);
    await page.fill("#invite-confirm", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForFunction(
      (working) => document.getElementById("invite-status").textContent === working,
      WORKING,
    );
    eq(
      await page.$eval("#invite-form", (form) => form.getAttribute("aria-busy")),
      "true",
      "the form is marked busy while the one request is in flight",
    );
    eq(
      await page.$eval("#invite-password", (input) => input.disabled),
      true,
      "the fields are disabled while the one request is in flight",
    );
    await page.waitForFunction(
      (failed) => document.getElementById("invite-status").textContent === failed,
      FAILED,
      { timeout: 20_000 },
    );
    eq(await formHidden(page), true, "a timeout still seals the form");
  });
  state.acceptMode = "204";

  /* Leaving the page mid-flight aborts the request rather than letting it
     settle against a page that is already gone. */
  await withPage(async (page) => {
    state.acceptMode = "hang";
    await primed(page);
    await page.fill("#invite-password", PASSWORD);
    await page.fill("#invite-confirm", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForFunction(
      (working) => document.getElementById("invite-status").textContent === working,
      WORKING,
    );
    await page.goto(`${origin}/invite/`);
    eq(await statusOf(page), UNUSABLE, "a reloaded page has no token to reuse");
    eq(await formHidden(page), true, "a reloaded page shows no form");
  });
  state.acceptMode = "204";

  /* ---- presentation and accessibility ---- */

  await withPage(async (page) => {
    await primed(page);
    eq(
      await page.$eval("#invite-status", (element) => element.getAttribute("role")),
      "status",
      "the status region is announced",
    );
    eq(
      await page.$eval("#invite-status", (element) => element.getAttribute("aria-live")),
      "polite",
      "the status region is polite",
    );
    const labelled = await page.evaluate(() =>
      [...document.querySelectorAll("#invite-form label")].map((label) => [
        label.getAttribute("for"),
        label.control === null ? null : label.control.id,
      ]));
    eq(JSON.stringify(labelled), JSON.stringify([
      ["invite-password", "invite-password"],
      ["invite-confirm", "invite-confirm"],
    ]), "both fields carry a resolved label");
    eq(
      await page.evaluate(() => document.documentElement.scrollWidth <= 320),
      true,
      "the page fits 320 CSS pixels without overflow",
    );
  }, { viewport: { width: 320, height: 640 } });

  for (const options of [
    { colorScheme: "dark" },
    { colorScheme: "light" },
    { forcedColors: "active" },
    { reducedMotion: "reduce" },
  ]) {
    await withPage(async (page) => {
      await primed(page);
      const label = JSON.stringify(options);
      eq(await formHidden(page), false, `${label} still shows the form`);
      const visible = await page.evaluate(() => {
        const button = document.querySelector("button[type=submit]");
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      eq(visible, true, `${label} still lays the submit control out`);
      const animated = await page.evaluate(() => {
        for (const element of document.querySelectorAll("*")) {
          const style = getComputedStyle(element);
          if (style.animationName !== "none") return true;
          if (style.transitionDuration !== "0s") return true;
        }
        return false;
      });
      eq(animated, false, `${label} never animates`);
    }, options);
  }

  /* Nothing but the document and the one acceptance call ever leaves the
     page: no font, no stylesheet, no image, no beacon. */
  await withPage(async (page) => {
    const seen = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      /* Chromium probes for a favicon on its own; the page never asks. */
      if (path !== "/favicon.ico") seen.push(path);
    });
    state.acceptMode = "204";
    await primed(page);
    await page.fill("#invite-password", PASSWORD);
    await page.fill("#invite-confirm", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForFunction(
      (done) => document.getElementById("invite-status").textContent === done,
      DONE,
    );
    eq(
      [...new Set(seen)].sort().join(","),
      "/api/accept,/invite/",
      "the page requests exactly its own document and /api/accept",
    );
  });
}

/* ------------------------------------------------------------------ *
 * Entry point.
 * ------------------------------------------------------------------ */

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--worker") {
    if (argv.length !== 1) die("usage: scripts/test-p4-k-browser.mjs --worker");
    await worker();
    return;
  }
  if (argv.length !== 0) die("usage: scripts/test-p4-k-browser.mjs");
  await parent();
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
