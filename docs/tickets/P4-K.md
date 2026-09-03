# P4-K — Invitation acceptance

## Outcome

An invited person can consume Netlify Identity's recovery token on a public, self-contained `/invite/` page, set a password through exact `POST /api/accept`, receive runtime-managed session cookies, and then prove the invited email through the ordinary document gate; invalid, expired, mismatched, or replayed tokens disclose no account or invitation data.

## Context

P4-J creates an auto-confirmed Identity account with an unrecoverable random password only when the invited email has no account, then asks Netlify Identity to send its recovery email. That recovery mail is account bootstrap only: it contains no document identity or authority, so the owner must share the ordinary current document URL out of band. The email arrives with `#recovery_token=…`; URL fragments never reach a server. This ticket reads that fragment in a minimal public page and sends it once to a same-origin Function. The pinned official package exports `recoverPassword(token,newPassword)`, which redeems a recovery token, changes the password, and logs the user in. P4-K freezes that login as a modern Functions v2 contract: the package/runtime must attach the resulting `nf_jwt` and `nf_refresh` cookies to the Function response without application cookie code. `acceptInvite()` is for a different `invite_token` flow and is not used.

## Scope

### In scope

- Create a complete self-contained `invite/index.html` that handles only one exact `recovery_token` fragment.
- Amend P2-A's public `login/index.html` with one recovery-fragment bridge so Netlify's default root recovery link reaches `/invite/` on Free/Personal plans without a paid custom email template.
- Remove the token from the visible URL before rendering the password form while retaining it only in closure memory.
- Validate and confirm one new password locally, submit it once to same-origin `/api/accept`, and render fixed accessible progress/success/failure states.
- Create a Functions v2 `POST /api/accept` handler with method, origin, media type, bounded-body, exact-shape, token, and password validation.
- Call `recoverPassword()` exactly once after validation and let the pinned library/runtime exclusively establish cookies.
- Normalize all provider token/password failures to one public response and distinguish only temporary provider/runtime unavailability.
- Prove a replay is refused and a successful session still receives document access only through P3-J/P3-H/P2-G.
- State the only document-link UX honestly: the owner shares the ordinary current document URL out of band; the recovery mail only bootstraps the account.

### Out of scope

- Creating accounts or invitations, sending recovery mail, selecting a role, converting an access invitation, or changing/revoking access. P4-J/P2-G/P3-H own those operations.
- Calling `acceptInvite()`, `handleAuthCallback()`, `updateUser()`, a browser Identity library, a widget, or raw GoTrue/Identity HTTP.
- Placing a document ID, invited email, role, return URL, account ID, or access token in the fragment/body/page.
- Treating possession of the recovery token as document authority. It establishes one Identity session; the invitation's hashed-email record still decides document access.
- Password reset for ordinary existing accounts, signup, OAuth, logout, or account recovery support UI beyond this P4-J bootstrap path.
- Editing the Edge gate, `netlify.toml`, identity/access helpers, package files, document templates, generated `_site`, or another implementation file. The one exception is the exact serialized `login/index.html` bridge specified below.
- External scripts/styles/fonts, analytics, logging, persistence, service workers, polling, or email customization.

## Interface contract

### Default-email landing bridge

Netlify's default recovery template links to the project root with `#recovery_token=…`; choosing a custom `/invite/` link requires a Pro custom email template, while the authoritative plan selects Personal. An anonymous root request passes no fragment to P2-A's Edge gate. Its 302 `Location` contains no fragment, so conforming browsers inherit the original fragment when following the redirect to `/login/`. Amend P2-A's existing `login/index.html` inline script with this first synchronous branch, before it parses `next`, `error`, focuses the login form, or makes any request:

```text
var recovery = location.hash.match(/^#recovery_token=([A-Za-z0-9._~-]{20,4096})$/);
if (recovery) {
  location.replace("/invite/" + location.hash);
  return;
}
```

Place the branch inside the existing IIFE/function so `return` stops only that script. Do not decode, copy into DOM/storage/logs, accept a query token, or handle `invite_token`/confirmation/email-change/OAuth fragments. `location.replace()` avoids adding the token-bearing login URL to history. A malformed/non-recovery hash preserves P2-A's login behavior byte-for-byte. A direct custom-template link to `/invite/#recovery_token=…` bypasses the bridge and remains supported.

The hosted gate must prove the actual browser carries the unmodified provider-default root fragment through P2-A's 302. This is a mandatory provider acceptance gate for P4-K on the selected plan, not an unresolved implementation dependency or a manually copied-token substitute. P4-K is incomplete unless the default email link reaches `/invite/` intact in the supported hosted browser.

### Static page

`invite/index.html` is a complete UTF-8 HTML5 document with `lang="en"`, viewport metadata, `<title>Set your password</title>`, `<meta name="referrer" content="no-referrer">`, one inline `<style>`, and one inline classic `<script>`. It has no external URL, preload, module import, image, font, form `action`, link, iframe, worker, storage access, or script-generated HTML.

The inert body contains exactly these functional elements:

```html
<main>
  <h1>Set your password</h1>
  <p id="invite-status" role="status" aria-live="polite"></p>
  <form id="invite-form" hidden novalidate>
    <label for="invite-password">Password</label>
    <input id="invite-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>
    <label for="invite-confirm">Confirm password</label>
    <input id="invite-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>
    <button type="submit">Set password</button>
  </form>
</main>
```

Styling is system-font only, responsive at 320 CSS pixels, visible in light/dark and forced colors, and never animates. The form remains `hidden` until a valid token is captured. HTML `maxlength` counts UTF-16 code units rather than Unicode code points, so the exact value is 256: it admits every valid 128-code-point astral password while the JavaScript 128-code-point/512-byte validator rejects any extra value. `minlength` is only an early hint; JavaScript remains authoritative for the 12-code-point minimum. All messages enter with `textContent`; the page never writes `innerHTML`, inserts adjacent HTML, executes strings, or copies the token/password into markup, attributes, URL query, title, accessible description, console, storage, or a global property.

On `DOMContentLoaded`, in exact order:

1. Require `location.protocol` to be `http:` or `https:` and `location.pathname === "/invite/"`. Otherwise set status to `This invitation page is available on the connected site.` and stop without network work.
2. Read `location.hash` exactly once into a block-local string and match `^#recovery_token=([A-Za-z0-9._~-]{20,4096})$`; no percent decoding, URLSearchParams, second field, delimiter, whitespace, empty token, `invite_token`, or query fallback is allowed.
3. If the fragment is absent or malformed, overwrite the local hash string, set status to `This invitation link cannot be used. Request a new invitation.`, and stop without calling `history.replaceState()`, changing the URL, installing submit behavior, or making a request. Never echo any part of the fragment.
4. For a valid match only, copy the captured token into a block-scoped closure variable, overwrite the local hash/match references, and immediately call `history.replaceState(null, "", "/invite/")` before unhiding the form or installing submit behavior. If replacement throws, overwrite the token with `null`, set the same fixed invalid-link status, and stop.
5. Set status to `Choose a password to finish signing in.`, unhide the form, and focus the first password input without scrolling.

On form submission:

1. Prevent default. Refuse while one request is active or after the one total submission attempt has begun. A local validation failure is not an attempt and may be corrected.
2. Read both input `.value` strings once. The password must be 12–128 Unicode code points, 12–512 UTF-8 bytes, contain no C0/C1 control or lone surrogate, and equal confirmation exactly. Do not trim, normalize, case-fold, or transform it. Invalid input stays local and sets `Use 12–128 characters, and enter the same password twice.`.
3. Set a closure `attempted` latch before network work, disable both inputs/button, set `aria-busy="true"` on the form, set status to `Setting your password…`, and issue exactly one `fetch("/api/accept", { method:"POST", credentials:"same-origin", cache:"no-store", redirect:"error", headers:{"Content-Type":"application/json","Accept":"application/json"}, body: JSON.stringify({token,password}), signal })`.
4. Abort after 10 seconds. Clear the timer in `finally`. Do not retry, follow a redirect, call a second endpoint, inspect cookies, or parse a response body.
5. Require status 204 and a zero-byte body as proven by `Content-Length: 0` when the header is present; otherwise treat the response as failure without reading it.
6. In one settlement `finally`, clear both password input values, overwrite local password/confirmation copies, overwrite the closure token with `null`, clear `aria-busy`, and keep the form hidden with every control disabled. The token is never retained for a retry after an attempted request, regardless of result.
7. On success set status to `Password set. Open the document URL shared by the owner.`. On failure set status to `This invitation could not be completed. Ask the owner to resend the setup link.`. A timeout, network error, 400, 403, 409, 413, 415, 500, or 503 is deliberately indistinguishable in the page. Do not redirect: the recovery mail is only account bootstrap, and the ordinary document URL is shared separately. P4-J defines resend as the owner's exact same-role invite POST against the live `accountCreated:true` invitation; it sends another recovery message without another account, access transition, expiry extension, or event.

Install no `unhandledrejection`/`error` handler and write nothing to console. On `pagehide`, abort an active request and overwrite the token/password closure values. Browser history after step 4 contains no recovery token.

### Acceptance Function

Create `netlify/functions/accept.mjs` with exactly:

```text
export function createAcceptHandler(dependencies = {})
export default async function handler(req)
export const config = { path: "/api/accept" }
```

The factory's optional exact ordinary dependency object permits only callable `requireOriginFn` and `recoverPasswordFn`; production defaults are the static imports:

```js
import { AuthError, MissingIdentityError, recoverPassword } from "@netlify/identity";
import { requireOrigin } from "../lib/identity.mjs";
```

Unknown keys, symbols, accessors, arrays, null, custom prototypes, or non-functions throw synchronously. The default handler is created once from production functions. Request data cannot select dependencies.

For every method other than exact `POST`, including HEAD/OPTIONS, return 405 with `Allow: POST`, `Cache-Control: private, no-store`, and zero bytes before origin/body/Identity. For POST, processing is exact:

1. Call `requireOrigin(req)` before media type, stream, or provider work. Return its thrown P1-C `Response` after adding `Cache-Control: private, no-store`; unexpected throws become 500.
2. Require `Content-Type` media type `application/json` case-insensitively with optional parameters; otherwise 415.
3. Acquire `req.body`'s reader once and read serial `Uint8Array` chunks. Retain at most 8,192 bytes; on overflow, attempt `reader.cancel()` once and return 413. Release the lock exactly once after acquisition on completion/overflow/error. Fatal-decode UTF-8 and call `JSON.parse()` once. A missing body, stream rejection, wrong chunk, invalid UTF-8/JSON, or empty body is 400. Never call `json()`, `text()`, `arrayBuffer()`, `blob()`, `formData()`, or clone the request.
4. Require an ordinary parsed object with exactly string keys `token` and `password` in either order. Reject actor/email/doc/role/next/author, symbols, or any extra/missing field.
5. Apply the same exact token grammar as the page. Apply the same password code-point, UTF-8, control, lone-surrogate, and byte rules independently. Server validation is authoritative; the page check is convenience.
6. Call `recoverPasswordFn(token,password)` exactly once. Do not call `identify()`, because this operation establishes the session. Do not call access storage; P3-H consumes the matching invitation later.
7. Hold the returned value in one local binding only long enough to require a non-null, non-array ordinary object and inspect own property descriptors for `id` and `email`. Both must be enumerable/writable/configurable string data properties, never accessors: `id` matches `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; `email` already equals `trim().toLowerCase()` and satisfies P2-G's 3–254-byte ASCII email grammar. Do not enumerate or read any other property; do not clone, freeze, persist, log, serialize, or return either value. After validation, allow the binding to leave scope and return 204 with `Cache-Control: private, no-store`, explicit `Content-Length: 0`, no application `Content-Type`, and zero application bytes.

For this handler, the pinned `@netlify/identity@2.0.0` Functions contract is explicit and indivisible: `recoverPassword()` runs inside the current modern/v2 Netlify Function request, redeems the token, updates the password, logs in that returned user, and the package/runtime appends `nf_jwt` and `nf_refresh` `Set-Cookie` fields to the outgoing response. The handler must not construct, read, copy, enumerate, forward, delete, or overwrite cookie values or `Set-Cookie`; returning the 204 must preserve runtime-added fields. A unit double can prove the call/return boundary, but only the isolated hosted test can accept this cookie contract: the same browser context must authenticate on its next `/api/session?doc=...` request without a second login call. Failure to observe that behavior fails P4-K rather than authorizing raw Identity HTTP or application-owned cookies.

Classify an `AuthError` with integer status 400–499 as 400 `invalid-invitation`; an `AuthError` with absent/non-integer/out-of-range status or status 500–599, `MissingIdentityError`, or any other provider/runtime/network rejection is 503 `unavailable`; a returned value that fails step 7 is 500 `internal-error`. Recognize the two error classes only through the static package imports above, never by an input-controlled `name`, `status`, or prototype lookalike. All JSON errors have exact `{"error":"<code>"}`, `Content-Type: application/json; charset=utf-8`, and no trailing LF. Every response is private/no-store. Never expose whether the token existed, expired, was replayed, belonged to an account, or matched a document invitation.

The recovery token is an Identity recovery credential, but never a document bearer credential. Successful recovery proves the account email in a runtime session. P3-J then permits only a matching live access invitation/grant, and P3-H converts the invitation only after `resolveRole(doc,user,{consumeInvitation:true})`; forwarding the plain document URL alone grants nothing.

## Files owned

- `invite/index.html` — **new** public fragment reader and password form.
- `netlify/functions/accept.mjs` — **new** exact recovery-token Function.
- `login/index.html` — **amended**, created by P2-A; change only its inline script with the exact default-email recovery bridge, then preserve every login behavior.
- `scripts/test-p4-k.mjs` — **new** production-source Function/static/replay and repository oracle; no shared harness dependency.
- `scripts/test-p4-k-browser.mjs` — **new** self-supervised local browser state/accessibility/privacy oracle.
- `scripts/test-p4-k-hosted.mjs` — **new** isolated hosted default-email, v2-cookie, access, replay, revoke, and cleanup oracle.

The already-canonical `docs/tickets/P4-K.md` is the specification being amended, not an implementation-owned path. No other file is owned. The three test paths are unique to P4-K and may use only Node built-ins plus dependencies installed in a test-owned temporary directory; they do not amend package manifests or a shared runner. P1-E already copies `invite/`; P2-A/P3-J already bypass the exact public pathname and `/api/*`; this ticket must not amend those source files or route declarations.

## Dependencies

- **P4-J:** creates the account/invitation and calls `requestPasswordRecovery()`; the resulting hash is `recovery_token`, not `invite_token`.
- **P2-A/P2-H:** provide the public path/API seams, login page/redirect, Functions v2 runtime, origin helper, pinned Identity package, and runtime cookie behavior. P4-K is the sole serialized amendment to `login/index.html`.
- **P3-J:** preserves the exact `/invite/` bypass and performs document access checks after acceptance.
- **P3-H/P2-G:** consume the matching invitation from the newly proven session; acceptance itself grants no document role.

### Maximum safe implementation waves

1. The invite page DOM/style/token/password state machine and the tiny P2-A login bridge can be authored independently from the Function, but their shared browser redirect gate is integrated together.
2. The Function's bounded-body/error fixture can proceed in parallel because it owns a disjoint file and a fixed two-field contract.
3. Serialize the end-to-end hosted recovery/replay/revoke proof after P4-J and the P3-J/P3-H access path are deployed. The hosted script owns a fresh disposable Netlify site and its deletion; it neither borrows nor cleans up P4-J's site.

## Acceptance criteria

- [ ] `/invite/` is one self-contained accessible page with no external request before submit; after the initial fragment capture, no token/password remains in the URL or enters DOM, globals, logs, storage, referrer, or later navigation.
- [ ] Netlify's default root recovery link crosses P2-A's fragment-preserving anonymous redirect and the exact login bridge into `/invite/`; every non-recovery login case remains byte-for-byte behavior-compatible.
- [ ] An absent/malformed fragment stops without a URL rewrite; only exact `#recovery_token=<safe token>` is captured, then history replacement succeeds before the form appears or the token fails closed.
- [ ] Client and server enforce the exact password/token boundaries; the 256-UTF-16-unit HTML ceiling admits every valid 128-code-point value, server validation remains authoritative, and no input is trimmed or normalized.
- [ ] The page performs one total network submission at most, has a ten-second abort, never retries/follows/reads a body, clears the token after settlement, and exposes only fixed status strings.
- [ ] `/api/accept` has the exact exports/route, rejects non-POST before origin, applies origin before body, consumes at most 8,192 bytes, and accepts only `{token,password}`.
- [ ] The Function calls only `recoverPassword()` once; it never uses `acceptInvite`, browser callback handling, raw Identity HTTP, identity/access lookups, or application cookies.
- [ ] Success is exact private 204/zero application bytes and preserves the pinned package/runtime's `nf_jwt` and `nf_refresh` cookies; the next same-browser session request authenticates without another login, while bad/expired/replayed tokens share exact 400 and provider unavailability is quiet 503.
- [ ] Successful recovery grants no document itself; wrong invited email/revoked invitation still receives P3-J 403, while the matching live invitation converts through P3-H.
- [ ] A successful token replay is refused and no second password/session mutation is reported; the fixed failure directs the person to P4-J's exact non-authoritative recovery-message reissue rather than an impossible new-account bootstrap.
- [ ] Static AST/sink, browser accessibility/privacy, Function matrix, hosted recovery/revoke, repository, scrub, and issue #33 immutable-pointer gates pass.

## Test plan

The ticket creates three unique, checked-in test entry points; no command below depends on a shared or assumed harness. `scripts/test-p4-k.mjs` uses `vm.SourceTextModule` to link the production Function only to exact fakes, and its replay fake captures the first token in a test-local closure. That captured value is reused once without ever entering stdout, stderr, an assertion message, a file, environment, process argument, DOM, URL, or log. `scripts/test-p4-k-browser.mjs` installs exact `playwright@1.55.0` under a `mkdtemp()` directory outside the worktree using `npm install --ignore-scripts --no-save --prefix <temp> playwright@1.55.0`, sets `PLAYWRIGHT_BROWSERS_PATH=<temp>/browsers`, runs `<temp>/node_modules/.bin/playwright install chromium`, owns and kills its loopback server/browser children, and removes the directory in `finally`. It never falls back to a system browser or another package/version. Both scripts have a 120-second supervisor deadline and fail on nonempty stderr, residue, leaked child processes, or unexpected stdout.

```bash
set -euo pipefail
node --experimental-vm-modules scripts/test-p4-k.mjs contract
node scripts/test-p4-k-browser.mjs
```

The contract mode executes the production static source and Function against every method; origin; content type; stream failure/chunk/UTF-8/JSON/8,192-byte boundary; exact body; token/password boundary; imported AuthError 4xx/5xx; MissingIdentityError; arbitrary failure; malformed returned user; valid canonical returned user; and replay class. It proves the returned user reads only `id`/`email`, then leaves scope, and application code never touches cookie APIs or `Set-Cookie`. The browser mode executes absent/malformed/other/valid fragments, wrong protocol/path, `replaceState` failure, P2-A bridge cases, the exact 128-code-point astral password admitted by `maxlength=256`, a 129-code-point BMP value rejected by JavaScript despite fitting the HTML ceiling, every other local password boundary, one total submit, 204/non-204/network/timeout, pagehide, focus, narrow/theme/forced-color, and poison sinks. Invalid fragments perform zero rewrites; valid fragments rewrite before revealing; after any network settlement, the in-page token is gone and a second submit performs no request. Exact stdout is:

```text
PASS  P4-K accept Function, returned-user, and replay matrix
PASS  P4-K landing bridge, one-attempt secret, and accessibility matrix
```

The hosted entry point requires operator-supplied `NETLIFY_AUTH_TOKEN`, `NETLIFY_ACCOUNT_SLUG`, `P4K_TEST_EMAIL`, `P4K_MAILBOX_BASE_URL`, and `P4K_MAILBOX_BEARER`. It uses the same exact `playwright@1.55.0` temporary install/browser path above. It creates its own randomly named invite-only Personal-plan Netlify site, deploys the integrated candidate, and registers cleanup before provisioning Identity, users, blobs, or mail. It does not reuse P4-J's site. The mailbox adapter returns the one provider-default recovery URL only to a test-local closure; the runner parses and retains the replay token only in memory, never prints it, and navigates the real browser using the original URL. Production `/invite/` must remove the fragment before the form appears. The same browser submits once, accepts the runtime cookies, calls `/api/session?doc=...` without another login, and proves invitation conversion. After the captured token is replayed once through an in-memory request body, the owner repeats the exact same-role invite POST and the adapter exposes a distinct second recovery message, proving the reissue path before owner revocation proves the document returns generic 403. `finally` deletes mail, blobs, users, and the site and polls boundedly until all are absent; cleanup failure fails the test. Hosted stdout contains no identifiers or secrets and is exactly one line.

The mailbox protocol is exact. `P4K_MAILBOX_BASE_URL` is an absolute HTTPS URL without credentials, query, or fragment and `P4K_MAILBOX_BEARER` is used only as `Authorization: Bearer <value>`. Use `POST`, JSON request/accept headers, `redirect:"error"`, a ten-second abort, and exact bodies `{"v":1,"action":"wait-recovery","email":"<P4K_TEST_EMAIL>","after":"<messageId-or-empty>","timeoutMs":30000}` and `{"v":1,"action":"purge","email":"<P4K_TEST_EMAIL>"}`. Wait success is exact 200 JSON `{"v":1,"messageId":"<1-128 safe ASCII>","url":"<absolute deployed-site HTTPS URL with exactly one recovery_token fragment>"}`; the second wait must return a different `messageId`. Purge success is 204 with zero bytes. Fatal-UTF-8 response reads are capped at 8,192 bytes; any redirect, other status, extra/missing field, malformed URL, duplicate result, or timeout fails. No adapter value enters output.

```bash
set -euo pipefail
node scripts/test-p4-k-hosted.mjs
```

```text
PASS  P4-K hosted default fragment, v2 cookies, access, replay, revoke, and cleanup
```

Run the repository/pointer gate after the implementation and ticket commits are available. `P4K_BASE` is mandatory and names the reviewed commit that already contains this canonical document and every predecessor but no P4-K implementation change. At that base, predecessor-owned `login/index.html` must exist, while the genuinely new `invite/index.html`, `netlify/functions/accept.mjs`, and three P4-K runners must not exist; the base-to-head diff below proves the one login amendment and five new paths.

```bash
set -euo pipefail
test -n "${P4K_BASE:-}"
git cat-file -e "${P4K_BASE}:login/index.html"
for new_path in invite/index.html netlify/functions/accept.mjs scripts/test-p4-k-browser.mjs scripts/test-p4-k-hosted.mjs scripts/test-p4-k.mjs; do
  if git cat-file -e "${P4K_BASE}:${new_path}" 2>/dev/null; then
    exit 1
  fi
done
expected=$(printf '%s\n' invite/index.html login/index.html netlify/functions/accept.mjs scripts/test-p4-k-browser.mjs scripts/test-p4-k-hosted.mjs scripts/test-p4-k.mjs | sort)
test "$(git diff --name-only "$P4K_BASE"...HEAD -- ':!docs/tickets/P4-K.md' | sort)" = "$expected"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-K.md invite/index.html login/index.html netlify/functions/accept.mjs scripts/test-p4-k.mjs scripts/test-p4-k-browser.mjs scripts/test-p4-k-hosted.mjs
git diff --check
issue_file=$(mktemp)
trap 'rm -f "$issue_file"' EXIT HUP INT TERM
gh api repos/aiur-team/architecture-docs/issues/33 >"$issue_file"
node --input-type=module - "$issue_file" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(issue.title, "P4-K — Invitation acceptance");
const match = /^Implementation specification: \[`docs\/tickets\/P4-K\.md`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/docs\/tickets\/P4-K\.md\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
assert.ok(match);
assert.deepEqual(execFileSync("git", ["show", `${match[1]}:docs/tickets/P4-K.md`]), readFileSync("docs/tickets/P4-K.md"));
NODE
printf '%s\n' 'PASS  P4-K repository gates'
```

Expected: every command exits zero, each test emits only its specified PASS line(s), the provider-default path and v2 cookie contract pass on P4-K's isolated site, issue #33 contains only the exact full-SHA pointer, the addressed bytes match this document, and the repository command actually ends with `PASS  P4-K repository gates`.

## Failure modes

- Missing/malformed fragment or history replacement failure: clear token, keep form absent, make no request, show one fixed invalid-link message.
- Browser/provider does not preserve the provider-default root fragment across P2-A's 302: fail P4-K's mandatory hosted acceptance gate; do not substitute a copied token or claim completion.
- Invalid/mismatched password before the attempted latch: keep failure local, retain the valid closure token, and send no request.
- Network timeout/non-204 after the attempted latch: clear token and password fields, keep the form unavailable, show one fixed failure, and require the owner to use P4-J's exact setup-link reissue; never parse or display provider content or retry from this page.
- Bad/expired/replayed provider token: exact 400 without account/invitation distinction.
- Provider/runtime unavailable: exact 503; no token, password, stack, or provider body escapes.
- Provider recovers a session but password update later fails internally: return failure; do not claim success or add access state. Operator recovery is required because atomicity is provider-owned.
- Successful Identity recovery for an email without matching live document invitation: the document gate returns 403. Acceptance never fabricates a role.

## Settled decisions

- P4-J uses password recovery, so P4-K consumes `recovery_token` with `recoverPassword()`. It does not use `invite_token` or `acceptInvite()`.
- Personal-plan default recovery email is supported by the serialized P2-A login bridge; no paid custom email template is assumed.
- Token processing is server-side. The browser only transports the exact fragment once over same-origin HTTPS.
- The token is an Identity credential, not document authority; email-bound access state remains the document gate.
- There is no document return URL in the recovery flow. Recovery mail bootstraps the account only; the owner shares the ordinary current document URL out of band, and success tells the person to open that URL.
- Secrets remain only in closure/request memory and are removed from browser history before the form appears.
- One locally valid submit is the only network attempt. The token is cleared after that request settles, including timeout/failure, so retry requires the owner to repeat the exact same-role invite POST and obtain a fresh P4-J recovery email.
- Server success is 204 and all UI text is fixed; provider/account details are never returned.

## Assumptions and open questions

- **Provider acceptance boundary:** the pinned official API describes `recoverPassword(token,newPassword)` as redeeming the token, setting the new password, and logging the user in, and describes modern/v2 Functions plus package-managed cookies as the supported server environment. P4-K makes the resulting two runtime cookies a required hosted acceptance result, not an application-owned fallback.
- **Provider acceptance boundary:** supported browsers must preserve the default root recovery fragment when P2-A's 302 `Location` omits a fragment. The isolated hosted proof is mandatory and must pass before P4-K is complete.
- **Open operational boundary:** the Identity provider owns atomicity between token exchange, password update, and cookie setting. The application can validate, call once, and fail closed, but cannot roll back a partially completed provider operation.

## References

- `docs/research/00-integration-plan.md` §§1.2, 1.5, 4.7 — Identity, access, and P4-K authority.
- `docs/research/09-sharing-and-roles.md` §§5.1–5.5 and 11 — identity-bound invitation and previously unresolved recovery-token function.
- `docs/tickets/P2-A.md` — public invite/API route seams and origin/runtime cookie behavior.
- `docs/tickets/P3-H.md`, `docs/tickets/P3-J.md`, and `docs/tickets/P4-J.md` — invitation conversion, read gate, and account/recovery creation.
- [Netlify `@netlify/identity@2.0.0` API reference](https://www.npmjs.com/package/@netlify/identity/v/2.0.0), accessed 2026-09-03 — modern/v2 server prerequisite, package-managed cookies, `recoverPassword()` signature, recovery semantics, and login result.
- [Netlify `@netlify/identity` recovery implementation](https://github.com/netlify/primitives/blob/main/packages/identity/prod/src/account.ts), accessed 2026-09-03 — recovery-token redemption, password update, normalized returned user, and login event sequence.
- [Netlify `@netlify/identity` runtime-cookie implementation](https://github.com/netlify/primitives/blob/main/packages/identity/prod/src/cookies.ts), accessed 2026-09-03 — runtime cookie names and attributes; hosted acceptance remains authoritative for their recovery-response attachment.
- [Netlify, “Identity-generated emails”](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/identity-generated-emails/), accessed 2026-09-03 — provider-generated email behavior and template configuration.
- [RFC 9110 §10.2.2](https://www.rfc-editor.org/rfc/rfc9110#section-10.2.2), accessed 2026-09-03 — redirect reference fragment inheritance when `Location` has no fragment.
