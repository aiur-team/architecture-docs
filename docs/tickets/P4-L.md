# P4-L — The share panel write controls

## Outcome

A still-authorized owner can invite a person, change grant or invitation roles, revoke or cancel access, change the organization default, and confirm ownership transfer from the existing Share panel; editors retain the exact read-only roster, all mutations are serialized through P4-J, and no forged browser state can grant authority.

## Context

P3-I creates the Share button, lazy roster fetch, private panel state, inert renderer, privacy boundary, and complete removal on unauthorized reads. P4-J adds an owner-only server mutation API whose successful responses are 204 and whose authoritative state is visible through the unchanged GET. This ticket amends `share.js` and its P3-I-owned `share.css`: it renders native controls from an already-validated roster, binds target values in closures rather than DOM attributes, sends one exact request, and reconciles session authority plus the complete roster after transfer or a write-time 403 instead of trusting the cached owner event.

## Scope

### In scope

- Preserve every P3-I activation, offline, lazy-read, body-bound, validation, focus, positioning, privacy, revocation, and editor read-only behavior.
- Add an invite email field and `editor`/`commenter`/`viewer` role select for a validated owner session.
- Add role changes and revoke buttons for non-owner grants.
- Add role changes and cancel buttons for pending invitations.
- Add a recovery-message resend button for a live P4-J-created pending invitation, using the existing exact invite POST body.
- Add an organization-default selector for `commenter`/`viewer`/`none`.
- Add a two-step in-panel ownership-transfer confirmation for each grant.
- Send exact P4-J JSON bodies through same-origin credentialed requests with one active mutation and a 15-second deadline.
- Re-fetch and re-render the full authoritative roster after every server success or definite/ambiguous server failure except the exact write-401/close-removal terminal paths below; after transfer 204, transfer 409, any other ambiguous transfer result, or any write-time 403, first refresh the exact P3-H session and render no owner controls from cached authority.
- Remove the complete feature on a write 401, on a refreshed session that no longer permits member visibility, or on a subsequent roster 401/403; retain an editor's read-only Share surface when refreshed session and roster still allow it.
- Provide fixed accessible status/confirmation text without exposing server errors or moving addresses into unsafe sinks.
- Amend `templates/base/share.css` with ticket-owned styles for the added native controls, disabled/busy/confirmation states, narrow layout, focus, forced colors, reduced motion, and print suppression.

### Out of scope

- Any server authorization, access record mutation, Identity account creation, email delivery, event append, or role computation. P4-J/P2-G own those boundaries.
- Changing the GET roster shape, session shape, role matrix, member cap, invitation expiry, or org default options.
- Showing controls to editors/commenters/viewers, trusting `data-session`, trusting DOM-disabled state, or using client state as an authorization claim.
- A people autocomplete, org directory, bulk operation, co-owner, share link, copy-link button, cross-document access list, or account deletion.
- Editing layout, builder, session/comments/edit clients, server files, package files, or generated output.
- Optimistic roster edits, offline mutation queue, retry loop, polling, persistence, analytics, logging, alerts, native `confirm()`, or a session probe except the exact transfer/write-403 reconciliation defined below.

## Interface contract

### Activation and preserved P3-I behavior

Amend the P3-I side-effect IIFE in `templates/base/share.js`; add no export or global. Keep P3-I's exact initial session listener and validate the entire session before saving any field. Owner controls are eligible only when the latest validated initial-or-refreshed session has `role === "owner"`, `canShare === true`, `canSeeMembers === true`, and `shared === true`. Editors continue to mount/read because `canSeeMembers` is true, but `role !== "owner"` means no form, select, mutation button, or confirmation node is ever created.

Do not infer owner status from `document.documentElement.dataset`, email suffix, first roster row, button existence, a DOM attribute, local storage, or a later script event. Store only P3-I's existing validated `doc`, `role`, and capability booleans in the closure; do not retain the session email/name or attach the session/roster to `window`, `document`, an element, dataset, property bag, storage, or event.

All P3-I read behaviors remain exact except for the narrowly triggered session reconciliation below:

- No UI on `file:`/non-HTTP(S), absent/malformed session, unshared document, commenter/viewer, or missing `.head-top`.
- No roster request until open; one refresh on every closed-to-open transition; one five-second bounded read; one validated all-or-nothing render.
- One direct final Share button, non-modal panel behavior, close/Escape/outside-pointer, focus return, safe position, and print absence.
- A roster `401`/`403` removes the panel/button/listeners and clears private state. Other roster failures keep the last complete roster unless transfer/write-403 reconciliation has invalidated cached authority.
- Server strings enter only text nodes/textContent and never HTML, URL, selector, style, attribute, log, live announcement, global, or persistence.

### Owner-only DOM

After and only after a current open-generation GET validates successfully, render the read-only roster atomically, then add controls in a detached fragment if the closure says owner. Never render controls from stale roster data after close/reopen or a later 401/403.

Append this fixed invite form before `.share-members`:

```text
form.share-invite[novalidate]
  label "Email" -> input.share-invite-email[type=email][autocomplete=off][maxlength=254]
  label "Role" -> select.share-invite-role
    option[value=commenter] "Commenter"
    option[value=viewer] "Viewer"
    option[value=editor] "Editor"
  button[type=submit] "Invite"
```

The default invite role is `commenter`. The input has no list/autocomplete endpoint and values are never persisted. On submit, apply `trim().toLowerCase()` once and validate the canonical P2-G 3–254 UTF-8-byte ASCII email grammar. Because accepted input is ASCII, `maxlength=254` and the byte ceiling agree exactly. A local failure sets status `Enter a valid email address.` and sends nothing. Server validation remains authoritative.

Replace the owner's read-only organization-default paragraph with a labeled `.share-default-control` select in exact option order `Commenter`, `Viewer`, `None`, whose selected value equals the validated roster. Changing the value does not write immediately: enable a sibling `Save default` button only when the value differs. Submitting sends PATCH `{doc,orgDefault}`. After any settled mutation/refetch, reconstruct it from the new roster; do not retain an unsaved selection across close/reopen.

For each non-owner member row, retain P3-I's inert text line, then append a `.share-row-controls` group created with closures over a fresh copied `{sub,role}` only:

- A select with exact options `Editor`, `Commenter`, `Viewer`, current role selected, and accessible label `Role for <visible email>` generated as label text, never an attribute containing the email.
- `Save role`, disabled until changed, sends PATCH `{doc,sub,role}`.
- `Revoke access` sends DELETE `{doc,sub}`.
- `Transfer ownership` opens the confirmation state below.

For each live invitation row, retain the text and append a corresponding closure-bound `{email,role}` group with the same role select/Save behavior using PATCH `{doc,email,role}`, plus `Cancel invitation` using DELETE `{doc,email}` and `Resend setup link` using POST `{doc,email,role}` with the row's current role. Resend relies on P4-J's exact recovery-only reissue branch, which changes no access record/expiry and emits no event; it does not require a new roster field. The email is passed only into `JSON.stringify()` at submit time and existing visible text; it never becomes a dataset, id, name, value, class, selector, URL, title, aria attribute, log, or live-region message.

P3-I's owner row has no role/revoke/transfer controls. No target is selected by array index or DOM text at click time; each listener closes over its validated copied identifier. Re-render removes old nodes/listeners by replacing the detached roster/control subtree. At most 50 child control groups exist.

### Transfer confirmation

Activating `Transfer ownership` does not call the API. It disables that row's ordinary controls and appends one `.share-transfer-confirm` group containing fixed visible text and two buttons:

```text
Transfer ownership to this person? You will become an editor. If setup stops during transfer, the new owner may need to invite you again.
[Transfer] [Cancel]
```

Only one confirmation may exist. Opening another first cancels/removes the old one and restores its row. `Cancel`, panel close, roster refresh, or feature removal clears confirmation with no request and restores focus to the initiating Transfer button when still connected. The confirm `Transfer` button sends POST to `/api/access/transfer` with `{doc,sub}`. It never includes the target email/role or current owner. Native `window.confirm`, `alert`, dialog/modal APIs, and address-bearing announcements are forbidden.

### Mutation transport and state machine

Construct the URL with `new URL("/api/access", location.origin)` or `new URL("/api/access/transfer", location.origin)` and require its origin still equals `location.origin`. There is at most one active mutation across the whole panel. Each exact request is:

```js
fetch(url, {
  method,
  credentials: "same-origin",
  cache: "no-store",
  redirect: "error",
  headers: { "Content-Type": "application/json", "Accept": "application/json" },
  body: JSON.stringify(body),
  signal: controller.signal,
})
```

Do not set `Origin`, CSRF token, author, capability, idempotency, or custom header. The browser supplies Origin/cookies and P4-J proves both. Start one 15-second timer immediately before fetch, clear it in one `finally`, and abort on panel close/feature removal/deadline. While active:

- Set panel `aria-busy="true"`, status `Updating access…`, and disable every owner input/select/action button. The panel's `.share-close` button and masthead Share toggle remain enabled as explicit close paths.
- Refuse every second submit/change activation without queuing/coalescing/retrying it.
- Keep the last validated roster visible; do not optimistically edit/delete/reorder a row.

Classify the response without reading a body:

| Result | Client action |
|---|---|
| Exact 204, no redirect, non-transfer | Clear relevant local input/confirmation, record `Access updated.`, then start exactly one roster refresh in the current open generation |
| Exact 204, no redirect, transfer | Clear confirmation and all owner controls immediately, set provisional closure authority to read-only editor, record `Access updated.`, then run one session refresh followed by one roster refresh only if the refreshed session still permits it |
| 401 | Invoke P3-I's complete feature-removal path immediately; no refresh |
| 403 | Clear confirmation and all owner controls immediately, set provisional closure authority to read-only editor, record `Your access changed.`, then run one session refresh followed by one roster refresh only if the refreshed session still permits it |
| 400, 404, non-transfer 409, 413, 415, 429 | Set `Access change was not accepted.`, then refresh once because a concurrent authoritative state may explain it |
| Transfer 409, 500, 503, other status, redirect, timeout, abort not caused by close, or fetch rejection | Clear confirmation and all owner controls immediately, set provisional closure authority to read-only editor, record `Access change could not be completed.`, then run session followed by permitted roster because transfer may have partially landed |
| Non-transfer 500, 503, other status, redirect, timeout, abort not caused by close, or fetch rejection | Set `Access change could not be completed.`, then refresh the roster once because the server operation may have landed before failure |
| Close/removal abort | Keep hidden/removed state; ignore late result and do not refresh |

Check mutation status/redirect only. Do not inspect mutation Content-Type, Retry-After, response text, JSON, URL, headers, or provider errors. The subsequent read owns all visible authoritative data.

After transfer 204, transfer 409, any other ambiguous transfer result, or any write 403, construct `/api/session?doc=<doc>` and repeat P2-C's exact GET transport, two-second timer, status/content-type/body handling, complete thirteen-field final-session validation, and deep freeze. The request is literally:

```js
const endpoint = new URL("/api/session", location.href)
endpoint.searchParams.set("doc", doc)
fetch(endpoint, {
  method: "GET",
  mode: "same-origin",
  credentials: "same-origin",
  cache: "no-store",
  redirect: "error",
  headers: { Accept: "application/json" },
  signal: controller.signal,
})
```

Install the sole 2,000 ms abort timer immediately before this `fetch`, clear it in the encompassing `finally`, and never retry. This is P4-L's deliberate successor exception to P2-C's single startup probe; it does not dispatch another `session` event, alter `data-session`, call another endpoint, or amend `session.js`. Require the returned `doc` to match and accept continued Share access only for these internally consistent results:

```text
owner  + shared:true + canShare:true  + canSeeMembers:true
editor + shared:true + canShare:false + canSeeMembers:true
```

All thirteen P3-H fields and P2-C's `roles` rules still validate; the two rows above are additional eligibility checks, not a projected replacement shape. A valid owner result restores owner eligibility before the roster GET. A valid editor result keeps the Share button/panel but no owner form, select, mutation button, or confirmation may be present before or after the roster GET. A valid session with another role, `shared:false`, or `canSeeMembers:false`, plus session 401/403, malformed/invalid body, redirect, timeout, or network failure, invokes complete feature removal before any roster request. Never fall back to the cached owner event.

Status precedence is exact. Complete feature removal displays nothing. A roster read failure outranks and replaces any mutation message with P3-I's fixed `Access list could not be refreshed.`; session failure removes the feature. After successful reconciliation, keep exactly one fixed mutation result: `Access updated.` for 204, `Your access changed.` for 403, `Access change was not accepted.` for the listed client failures, or `Access change could not be completed.` for ambiguous failures. Never concatenate read and mutation messages, expose a server body, or let an earlier request overwrite the current generation.

Refresh serialization is exact: a mutation may start only after the current roster GET settles valid; no read begins while a mutation is active. After ordinary mutation settlement, one roster refresh begins before controls are re-enabled. After transfer 204, transfer 409, any other ambiguous transfer result, or write 403, one session refresh settles first, then at most one roster refresh begins. At most one fetch and one controller exist across mutation/session/roster work. Thus there is never concurrent GET/write from this module and never a stale response rendering controls.

Closing is exact. Activating `.share-close`, the masthead Share toggle, Escape, or P3-I's outside-pointer path increments the generation, aborts the sole active controller, clears the deadline through its owning `finally`, clears `aria-busy`, blanks the invite input, removes transfer confirmation, hides the panel, and returns focus to the masthead Share button when connected. `.share-close` is never disabled. A close-caused abort sets no status and starts no follow-up read; every late result is ignored. Reopening creates a fresh generation and roster GET, except that closing during transfer or session reconciliation marks authority unknown and requires the session-then-roster sequence before anything is rendered.

### Privacy and accessibility

Native labels are connected without putting an email in an attribute: wrap the control in a `<label>` whose text node includes the visible address, or use adjacent fixed text plus association with a generated operation-local numeric-free ID that contains no server string. Do not announce addresses through the live status. Buttons have exact action text; destructive actions are text, not icon-only.

Keyboard order follows DOM order. A newly opened transfer confirmation focuses its `Transfer` button; cancel returns focus. After a mutation refresh, focus the panel heading because the initiating row may no longer exist; do not focus `body`. Disabling does not trap focus. P4-L's `share.css` amendment gives new controls readable inherited foreground/background, wrapping grid/flex layout, non-color-only disabled/busy/confirmation distinction, and visible `:focus-visible` outlines without escaping P3-I's `.share-*` selector scope. At 320 CSS pixels it has no horizontal overflow; forced colors preserves borders/outlines; reduced motion has no transition/animation; print hides the complete Share surface and every address.

## Files owned

- `templates/base/share.js` — **amended**, created by P3-I; add owner controls and serialized writes.
- `templates/base/share.css` — **amended**, created by P3-I; add control, busy, confirmation, responsive, focus, forced-color, reduced-motion, and print states.
- `scripts/test-p4-l.mjs` — **new** production-source deterministic session/roster/mutation and repository oracle; no shared harness dependency.
- `scripts/test-p4-l-browser.mjs` — **new** self-supervised rendered accessibility/privacy oracle.
- `scripts/test-p4-l-hosted.mjs` — **new** isolated hosted authorization, transfer, session-reconciliation, and cleanup oracle.

The already-canonical `docs/tickets/P4-L.md` is the specification being amended, not an implementation-owned path. No layout, server, builder, package, generated artifact, or other client module is owned. The three test paths are unique to P4-L and may use only Node built-ins plus dependencies installed in a test-owned temporary directory; they do not amend package manifests or a shared runner.

## Dependencies

- **P3-I:** supplies `share.js`, `share.css`, session/roster validators, lazy panel DOM, read transport, renderer, and focus/position/removal paths. P4-L is the serialized successor for both owned feature assets.
- **P4-J:** supplies the seven closed owner-only request variants, 204 success, private error boundary, transfer partial-failure warning, and unchanged authoritative GET.
- **P2-C/P3-H:** supply the initial validated session event, exact final-session response/validator contract, and complete roster. P4-L deliberately adds only the bounded post-transfer/write-403 session reconciliation specified above and does not amend or redispatch through `session.js`.

### Maximum safe implementation waves

1. Pure detached owner-control rendering in `share.js`, new `.share-*` states in `share.css`, and each unique test script can be authored in parallel against the frozen DOM/transport contract because those paths are disjoint.
2. The mutation/session/roster controller must integrate serially into `share.js` after P3-I, then the independently authored CSS and tests join it. No concurrent edit to either P3-I feature asset is safe during that integration.
3. P4-J server work is file-disjoint and may proceed in parallel, but browser/hosted integration waits for its final route/body/status contract. P4-L's hosted runner owns a separate disposable site; shared dist rebuild and browser dependency installation remain serialized with other UI ticket gates.

## Acceptance criteria

- [ ] Every P3-I owner/editor/offline/read/privacy/focus/position/revocation behavior still passes unchanged.
- [ ] A validated editor sees exactly the read-only roster and zero forms/selects/write buttons; commenter/viewer/no session still have no Share surface.
- [ ] Only an exact validated owner session plus current valid roster creates invite, grant, invitation, default, revoke/cancel, and transfer controls.
- [ ] Control targets are closure-bound validated copies; no email/sub/role is recovered from mutable DOM text/index/attribute and no address enters an attribute or live announcement.
- [ ] Invite/default/grant/invitation/revoke/cancel/transfer/recovery-resend construct only the seven P4-J body shapes, use the canonical 254-byte email ceiling, normalize only new email input, and send no authority/actor/client-only field.
- [ ] Transfer is two-step, only one confirmation exists, its exact partial-failure warning is visible, cancel/close writes nothing, and focus transitions are deterministic.
- [ ] One active mutation disables controls, retains the old roster, has one 15-second abort, queues/retries nothing, and reads no response body.
- [ ] An ordinary exact 204 and every definite/ambiguous non-auth outcome trigger one roster GET; transfer 204, transfer 409, every other ambiguous transfer, and write 403 first remove owner controls and refresh the full session, then preserve read-only Share for a validated editor or restore owner controls only from a validated owner before one roster GET.
- [ ] Write 401, roster 401/403, or a refreshed session that is unauthorized/invalid/unavailable removes all private Share state; cached owner authority is never reused after transfer or 403.
- [ ] A forged `data-session`, enabled button, DOM row, target text, or dispatched click cannot bypass P4-J; hosted tests receive 403 with no authority write.
- [ ] `.share-close` and the masthead toggle stay enabled during writes, every close path aborts/invalidates/clears/focuses exactly, and late completions perform no render or refresh.
- [ ] Native controls meet keyboard/name/focus/disabled/busy/forced-color/narrow/reduced-motion/print behavior through P4-L's scoped `share.css` amendment.
- [ ] Static/runtime/browser/hosted/repository/scrub and issue #34 immutable-pointer gates pass.

## Test plan

The ticket creates three unique, checked-in entry points; no command depends on a shared or assumed harness. `scripts/test-p4-l.mjs` loads the production `share.js` into a deterministic DOM with a programmable fetch queue and parses the production `share.css`; it has a 120-second deadline and fails on unexpected stdout/stderr, timers, children, or residue. Run:

```bash
set -euo pipefail
node scripts/test-p4-l.mjs contract
node scripts/test-p4-l-browser.mjs
```

Contract mode reruns P3-I's offline, role, lazy-read, body-bound, all-or-nothing roster, focus/position, close, privacy, and revoke matrix before testing P4-L. It executes owner/editor/commenter/viewer/invalid initial and refreshed sessions; valid/invalid rosters; all labels/options/defaults; zero/50 children; every exact action/body including same-role recovery resend; 254/255-byte invite boundaries; unchanged selects; transfer replace/cancel/confirm; close via button/toggle/Escape/outside pointer; double activation; held mutation/session/roster; deadlines/redirect/network; every status; generation suppression; and status precedence. It proves transfer 204, transfer 409 after committed ownership, every other ambiguous transfer class, and write 403 synchronously remove owner controls, use the exact P2-C session request/validator, retain Share after a validated editor plus roster success, restore owner controls only from a fresh valid owner session, and remove on invalid/unauthorized/unavailable session. It poisons response body methods on mutations, unsafe HTML/string/attribute sinks, logs, modal APIs, storage/cookies, external URLs, polling, observers, and globals.

The browser entry point installs exact `playwright@1.55.0` in a `mkdtemp()` directory outside the worktree using `npm install --ignore-scripts --no-save --prefix <temp> playwright@1.55.0`, sets `PLAYWRIGHT_BROWSERS_PATH=<temp>/browsers`, and runs `<temp>/node_modules/.bin/playwright install chromium`. It never falls back to a system browser or another version, owns/kills its loopback server and browser children, and removes the directory in `finally`. It renders real `share.js`/`share.css` at 320/390/1280 CSS pixels in light, dark, forced colors, reduced motion, and print; it tabs every control, holds each network phase, exercises both enabled close buttons, verifies deterministic focus, and proves no horizontal overflow or printed address/control. Exact stdout is:

```text
PASS  P3-I offline, role, lazy-fetch, inert-render, refresh, and revoke contract
PASS  P4-L owner controls, session reconciliation, close, privacy, and CSS contract
PASS  P4-L rendered owner/editor access panel
```

`scripts/test-p4-l-hosted.mjs` requires operator-supplied `NETLIFY_AUTH_TOKEN` and `NETLIFY_ACCOUNT_SLUG`. In its test-owned temporary directory it installs exactly `playwright@1.55.0` as above and `netlify-cli@23.5.0` with `npm install --ignore-scripts --no-save --prefix <temp> playwright@1.55.0 netlify-cli@23.5.0`; only `<temp>/node_modules/.bin/netlify` may perform provider administration. The token exists only in that child's environment. After `netlify --version` proves exact `23.5.0`, the only administrative argv tails are `sites:create --account-slug <NETLIFY_ACCOUNT_SLUG> --name <random-name> --json`, `deploy --site <site-id> --dir <dist-dir> --functions <functions-dir> --prod --json`, `api getSite --data <exact-JSON-{site_id}>`, and `sites:delete --site <site-id> --force --json`; there is no ambient linked site, interactive prompt, implicit account, or alternate command. Every CLI response is parsed through a 1 MiB fatal-UTF-8 closed-object boundary, with exact required `id`/URL fields for create/deploy/inspect and no ignored duplicate/extra identifier; non-JSON success, an unexpected site ID, or a CLI version other than exact `23.5.0` fails. It creates a randomly named disposable Netlify site and registers the exact deletion argv before deploying or provisioning fixtures; it does not reuse P4-J's site. On the integrated deployment it creates separate owner/editor/commenter/viewer accounts and one document, performs all seven P4-J body shapes plus recovery resend through the real panel, and forges lower-role controls/requests. For the stale-owner case, one response is forced to transfer 409 after the authority CAS; the stale context must immediately remove owner controls, refresh session, and retain only the former owner's read-only editor Share panel. The new owner then triggers P4-J's marker repair through an ordinary mutation, revokes that editor, and reopening the former owner's panel proves the authorized roster read removes the feature on 403. Every provider/browser/CLI process is bounded. `finally` deletes state, users, and the exact site ID, then performs bounded `api getSite` inspections until that ID is absent; cleanup failure fails the gate. Stdout contains no account, address, document, site, or credential and is exactly:

```bash
set -euo pipefail
node scripts/test-p4-l-hosted.mjs
```

```text
PASS  P4-L hosted authorization, transfer, editor refresh, removal, and cleanup
```

Run the repository/pointer gate after implementation and ticket commits are available. `P4L_BASE` is mandatory and names the reviewed commit that contains this canonical document and P3-I/P4-J but none of P4-L's implementation/test changes.

```bash
set -euo pipefail
test -n "${P4L_BASE:-}"
expected=$(printf '%s\n' scripts/test-p4-l-browser.mjs scripts/test-p4-l-hosted.mjs scripts/test-p4-l.mjs templates/base/share.css templates/base/share.js | sort)
test "$(git diff --name-only "$P4L_BASE"...HEAD -- ':!docs/tickets/P4-L.md' | sort)" = "$expected"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-L.md templates/base/share.js templates/base/share.css scripts/test-p4-l.mjs scripts/test-p4-l-browser.mjs scripts/test-p4-l-hosted.mjs
git diff --check
issue_file=$(mktemp)
trap 'rm -f "$issue_file"' EXIT HUP INT TERM
gh api repos/aiur-team/architecture-docs/issues/34 >"$issue_file"
node --input-type=module - "$issue_file" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(issue.title, "P4-L — The share panel write controls");
const match = /^Implementation specification: \[`docs\/tickets\/P4-L\.md`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/docs\/tickets\/P4-L\.md\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
assert.ok(match);
assert.deepEqual(execFileSync("git", ["show", `${match[1]}:docs/tickets/P4-L.md`]), readFileSync("docs/tickets/P4-L.md"));
NODE
printf '%s\n' 'PASS  P4-L repository gates'
```

Expected: every command exits zero; each runner emits only its specified PASS line(s); `P4L_BASE` proves the five exact implementation/test paths and no other file; issue #34 contains only the exact two-paragraph full-SHA pointer whose bytes match this document; `check-dist` passes; and the repository command actually ends with `PASS  P4-L repository gates`.

## Failure modes

- Invalid/expired/stale roster: render no new owner controls or retain the last fully valid roster according to P3-I; never render a valid prefix.
- Local invite validation fails: fixed status, no request, no address echo in live region.
- Mutation returns 401: remove the complete feature and private state immediately. Mutation returns 403: remove owner controls immediately, refresh the full session, then keep only freshly authorized owner/editor Share state and refresh the roster; otherwise remove the feature.
- Mutation outcome is rejected/timeout/5xx: do not retry or guess. Definite non-transfer client failures refresh the roster; ambiguous non-transfer failures refresh the roster; transfer 409 and every other ambiguous transfer failure refresh session then the roster only when still permitted because ownership may have partially landed.
- Ordinary roster refresh after mutation fails: retain the last validated pre-write roster with the fixed read failure. A transfer/403 session refresh failure removes the feature rather than reusing cached owner authority.
- Close during write/session/roster work: the enabled close path aborts/invalidates, clears confirmation/private input/busy state, ignores late results, and returns focus. Reopen starts roster-only unless authority was invalidated, in which case it runs session then roster.
- Transfer partially lands server-side: the exact confirmation warned that the new owner may need to re-invite the old owner; UI refetch shows current authority and never rolls it back.

## Settled decisions

- P4-J is enforcement; owner-only DOM is a privacy/usability hint.
- All successful and ambiguous mutations reconcile through the unchanged complete GET. There is no optimistic update or mutation response body.
- Transfer 204, transfer 409, every other ambiguous transfer result, and write 403 additionally reconcile the exact full P3-H session first; this narrowly supersedes P2-C's one-startup-probe rule without amending `session.js` or dispatching a second event.
- One mutation/refresh state machine serves every control; no action-specific network implementation may drift.
- Validated identifiers live only in closures and JSON request bodies. Server strings do not become selectors or attributes.
- Transfer uses an in-panel two-step confirmation with the exact partial-failure warning, not a native modal.
- P4-L owns the serialized amendment of P3-I's `share.css`; all added rules remain inside the established `.share-*` boundary.
- Mutation status is retained after a successful reconciliation, a roster read failure outranks it, and session failure/authority loss removes the surface. The close button is never disabled.

## Assumptions and open questions

- **Assumption:** P3-I's `.share-pop` layout and theme variables remain the base. P4-L owns only the scoped additions needed for the new controls and must prove them in the rendered gate.
- **Assumption:** P4-J returns zero-byte 204 for every success/no-op and never requires a CSRF header beyond browser Origin and runtime cookies.
- No implementation-blocking product question remains. Adding bulk access, autocomplete, custom role names, co-owners, or cross-document membership would require new storage/privacy/API decisions.

## References

- `docs/research/00-integration-plan.md` §§1.2, 1.5, 4.7 — authority and P4-L scope.
- `docs/research/09-sharing-and-roles.md` §§2, 5.2, 5.6, 6.5, 7, 9 — capability/UI matrix, write operations, transfer warning, and server enforcement.
- `docs/tickets/P3-I.md` — exact panel/session/roster/privacy/focus/style behavior preserved here.
- `docs/tickets/P3-H.md` — authoritative GET roster schema and ordering.
- `docs/tickets/P4-J.md` — exact owner-only write bodies, routes, statuses, partial failures, and 204/refetch boundary.
