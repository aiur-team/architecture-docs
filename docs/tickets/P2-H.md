# P2-H — Split identity from authorisation

## Outcome

`netlify/lib/identity.mjs` returns one exact four-field description of the authenticated person, while final document roles and capabilities are left to `netlify/lib/access.mjs` and its consumers; P2-A's explicitly temporary organization-only HTML gate remains the sole migration exception until P3-J removes it.

## Context

P1-C deliberately combines person identity with temporary Phase 1 capabilities so the first session, gate, and client work can start. That seven-field object cannot express a different role for the same person on two documents, and its Identity-backed `docs` array cannot provide immediate per-document grant changes.

This ticket makes the settled split at the single identity boundary. Identity answers who the caller is and whether their normalized email has the reserved organization suffix; P2-G's `resolveRole(docId, user)` alone answers final document roles and capabilities. P2-A's pre-existing organization-only gate is a named, temporary read-wall exception during migration, not a second final authority: it must use the exact old/new identity predicate below, and P3-J later replaces that predicate with `resolveRole()`-backed read access. The change is small in one file but is not independently deployable with every transitional consumer, so the staged-source, transitional-deploy, and final-authority boundaries below are part of the contract.

## Scope

### In scope

- Amend the P1-C-created `netlify/lib/identity.mjs` after the P1-C implementation is present.
- Keep the public `identify(req)` signature and its single `getUser()` call.
- Change a non-null `identify(req)` result from P1-C's exact seven fields to exactly `sub`, `email`, `name`, and `isOrg`.
- Preserve P1-C's `sub`, email normalization, name fallback, no-session, verified-JWT fallback, Functions v2, privacy, and single-accessor behavior.
- Define `isOrg` only from the normalized email and the existing private literal suffix `@example.com`.
- Remove all document authorization output from identity: `roles`, `canComment`, `canEdit`, and `docs` are absent, not `undefined`, `null`, empty, or retained as compatibility aliases.
- Preserve `requireOrigin(req)` and its normalized same-origin failure contract unchanged.
- Publish the exact final person shape consumed by P2-G, P2-F, P3-H, P3-J, and later write-path enforcement.
- Record the already-published P2-A compatibility boundary and the required P3-H session transition without editing either owner’s file.

### Out of scope

- Creating or amending `netlify/lib/access.mjs`; P2-G owns `DOC_OWNERS`, `resolveRole()`, document roles, capabilities, grants, invitations, owner binding, and access keys.
- Editing `netlify/edge-functions/gate.ts`; P2-A creates it and P3-J later replaces its temporary organization-only decision with document access resolution.
- Editing `netlify/functions/session.mjs`; P1-C creates it and P3-H makes it document-aware.
- Editing `templates/base/session.js` or `templates/base/session.css`; P2-C owns the probe, compatibility reveal rule, and browser event.
- Editing P2-F's realtime helper or token endpoint, any access endpoint, any login/logout function, `package.json`, `netlify.toml`, a template, a generated artifact, or a test file.
- Changing the provider's account-level `member` and `guest` values, account creation, invite-only registration, or Netlify Identity metadata. Those values may continue to exist at the provider even though `identify()` no longer returns them.
- Adding an organization-domain environment variable, a second identity provider, browser identity code, a JWT decoder, a capability fallback, or a direct access-store read.
- Returning a document id, document role, document list, grant, capability, token, raw user object, provider metadata, or request-derived author value.
- Making the P1-C session projection compatible inside this ticket. The unavoidable temporary incompatibility is resolved by the P3-H-owned amendment and must be handled in integration order, not through hidden fields in identity.

## Interface contract

### Export surface

After P2-H, `netlify/lib/identity.mjs` still has exactly two public exports:

```js
/**
 * @param {Request} req
 * @returns {Promise<null | {
 *   sub: string,
 *   email: string,
 *   name: string,
 *   isOrg: boolean
 * }>}
 */
export async function identify(req)

/**
 * @param {Request} req
 * @returns {void}
 * @throws {Response} A normalized 403 response when origin verification fails.
 */
export function requireOrigin(req)
```

`ORG_DOMAIN` remains a module-private constant with the literal value `@example.com`. Do not export it or replace it with an environment lookup. `req` remains in `identify()` for the repository-wide helper signature even though the pinned package reads the ambient Functions v2/Edge request context and `getUser()` takes no argument.

### Exact amendment to P1-C's object

P1-C returns these seven own enumerable fields:

```js
{
  sub,
  email,
  name,
  roles,
  canComment,
  canEdit,
  docs,
}
```

P2-H replaces that result with exactly:

```js
{
  sub,
  email,
  name,
  isOrg,
}
```

The amendment is exact:

| P1-C field | P2-H result | Rule |
|---|---|---|
| `sub` | Preserved | Copy `user.id` unchanged |
| `email` | Preserved | `(user.email ?? "").toLowerCase()` |
| `name` | Preserved | `user.name ?? email.split("@")[0]` |
| `roles` | Removed from the returned object | Provider roles remain provider/account metadata; they are not a document role and are not a public identity-helper field |
| `canComment` | Removed | P2-G derives it from the resolved document role |
| `canEdit` | Removed | P2-G derives direct-edit authority; suggestion authority becomes the separate `canSuggest` capability |
| `docs` | Removed | P2-G's access records replace the Identity metadata list |
| `isOrg` | Added | `email.endsWith("@example.com")`; a fact about normalized identity, never permission |

The returned object must have four own enumerable string/boolean properties and no compatibility getters, symbols, prototype fields, nested metadata, or aliases. A consumer that serializes it receives exactly those four JSON keys.

### Identification and classification behavior

For each call to `identify(req)`:

1. Call `getUser()` from exactly `@netlify/identity@2.0.0`, with no arguments, exactly once.
2. If it returns `null`, return `null` without logging, throwing, reading the request, or constructing a partial identity.
3. Read only `user.id`, `user.email`, and `user.name`. Do not read `role`, `roles`, `appMetadata`, `userMetadata`, provider, timestamps, tokens, headers, query parameters, cookies, or a request body.
4. Copy `user.id` unchanged to `sub`. The pinned `User` type requires `id`; do not manufacture a substitute from email or another field.
5. Normalize `email` with `(user.email ?? "").toLowerCase()`. Do not trim it, because P2-H preserves P1-C's exact normalization contract.
6. Normalize `name` with `user.name ?? email.split("@")[0]`. Preserve an explicitly supplied empty string; use the local-part fallback only for `null` or `undefined`.
7. Set `isOrg` to `email.endsWith("@example.com")`. Because the email is lowercased first, the comparison is case-insensitive for ASCII email case. This is deliberately suffix-only classification: empty, missing, external, whitespace-suffixed, and suffix-collision values produce `false`, while any provider string that literally ends in `@example.com` produces `true` even if P2-G later rejects that string as malformed. P2-H does not trim or validate.
8. Return a fresh plain object with exactly the four documented fields.

Provider `role` or `roles` never changes `isOrg`. An external account carrying provider role `member` still has `isOrg: false`, while an organization-suffix account with no provider role has `isOrg: true`. `isOrg` is not `canRead`, `canComment`, or any other capability. Final document decisions require `resolveRole()`; the only transitional exception is P2-A's organization-only HTML gate, whose exact compatibility predicate is removed by P3-J.

P2-G accepts this exact lower-case-but-untrimmed person field, normalizes each non-empty email once for owner/invitation comparison and stored snapshots, and maps a genuinely malformed provider address to its fail-closed `invalid-user` boundary. P2-H must not preempt that shared email grammar by trimming or independently validating the provider value.

### No-session, degraded-provider, and error behavior

The pinned package contract is `getUser(): Promise<User | null>` and states that it never throws, returning `null` on any failure. `identify()` preserves that behavior: a missing, invalid, expired, or provider-failed session without usable verified claims returns `null`.

When the Identity API is unreachable but the runtime has verified JWT claims, the pinned package can populate `id`, `email`, and `name`; those are the only user fields P2-H reads. The fallback therefore produces the same four-field normalization as a full user lookup. Do not test `confirmedAt`, `lastSignInAt`, a provider role, or metadata presence to decide whether the fallback is acceptable.

P2-H introduces no new thrown error or `Response`. If a future package version violates the pinned never-throws contract, do not convert an unverified value into an identity and do not catch an arbitrary error to return a permissive object; the version pin and its contract must be revisited explicitly.

### `requireOrigin(req)` preservation

Do not change the P1-C implementation or behavior of `requireOrigin(req)`:

- It calls `verifyRequestOrigin(req)` with no allowlist override.
- Exact same-origin success returns `undefined`.
- Missing `Origin`, `Origin: null`, foreign scheme/host/port, or a verification error fails closed.
- Every failure throws `new Response("Bad origin", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } })`.
- It does not inspect the method; each POST, PATCH, and DELETE owner calls it before all other work.

The origin helper remains the mutation-CSRF boundary. It is independent of both person identity and document authorization.

### Consumer transition contract

P2-H owns no consumer file. These are integration requirements for the owning tickets and the combined branch:

| Consumer | Required transition | Ownership and safe order |
|---|---|---|
| P2-A edge gate | Its explicitly exceptional, temporary organization-only decision accepts both P1-C and P2-H during integration: `typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member")`. The final-field branch takes precedence. It does not repeat the email suffix. | P2-A owns `gate.ts` and its source-bound fixture. P2-H must not edit the gate. P2-A may integrate before or after P2-H, but its exact predicate and runtime matrix are mandatory for a transitional deployment. P3-J removes this exception, removes the legacy `roles` read, and calls access resolution before the final-authority deployment is declared green. |
| P2-C session client | It consumes `/api/session`, not `identify()`. It may keep its old-`canEdit`/new-`canSuggest` reveal fallback and needs no P2-H source change. | P2-C can be authored in parallel. It remains compatible with the P1-C HTTP body and P3-H HTTP body, but not with a P1-C session handler running alone on top of the P2-H identity shape. |
| P3-H session endpoint | It must use the four identity fields, call `resolveRole(docId, identity, { consumeInvitation: true })`, and synthesize the public session body. That exact option makes P3-H the grant-first/delete-second invitation-conversion owner defined by P2-G. Its compatibility `roles` is `[identity.isOrg ? "member" : "guest"]`; its `canComment`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers` come only from the access result. It does not forward `isOrg` as document authority. | P3-H owns `session.mjs`. Integrate it immediately after P2-H and P2-G in the same release train; there must be no deployable acceptance point between P2-H and P3-H. |
| P2-F realtime token endpoint | It passes the final identity to `resolveRole()` and `mintToken()`. Only `sub` and `isOrg` select the realtime client-id policy; neither grants document access. | P2-F may author against the published four-field signature in parallel. Integrate and run its endpoint acceptance only after P2-G and P2-H. It must not add `roles` or `docs` fallback logic. |
| P2-G access library | Its person input is `null | {sub, email, name, isOrg}`. It uses `isOrg` only when applying the unshared/org-default rule and returns the sole role/capability decision. | P2-G may author against this signature in parallel after P2-B establishes storage. It must not call Identity or infer organization membership again. |

The intermediate tree after P2-H but before P3-H is intentionally **not session-compatible**: P1-C's existing `session.mjs` still projects `roles`, `canComment`, and `canEdit` from `identify()`, but those fields no longer exist. JSON serialization then omits the missing fields, and P2-C correctly rejects the malformed success body. Do not conceal this state by retaining removed fields. Stage P2-H until P3-H is ready, or land both in one serialized integration/release wave.

### Privacy and authority boundary

- `identify()` returns normalized person data needed to attribute records and resolve access. It does not return raw `User`, metadata, tokens, provider details, timestamps, cookies, or a document list.
- It never logs a user, email, request, cookie, provider error, or returned object.
- `isOrg` reveals no new value beyond the already returned normalized email. It is a server-side classification fact and must not be copied into a capability decision outside `resolveRole()`, except for P2-A's named temporary organization-only HTML gate during the transition to P3-J.
- A non-null identity proves only that the runtime authenticated an account. It does not prove access to any document.
- A client-supplied email, name, sub, role, `isOrg`, author, document id, or capability never enters this helper's result.

## Files owned

- `netlify/lib/identity.mjs` — **amended**, created by P1-C. P2-H is the only ticket that changes this file's identity result shape; `requireOrigin(req)` remains unchanged.

No other implementation, test, package, configuration, template, generated, research, prompt, or ticket file belongs to P2-H. `docs/tickets/P2-H.md` is this specification and not part of the implementation source surface.

At specification time, `netlify/` is not yet present on the coordination branch; P1-C is a finalized ticket specification whose implementation creates this file. P2-H must start from the integrated P1-C implementation, not create a parallel replacement from the research text.

## Dependencies

### Required predecessor

- **P1-C:** creates `netlify/lib/identity.mjs`, pins `@netlify/identity@2.0.0`, defines the seven-field temporary `identify(req)` object, and defines the exact `requireOrigin(req)` behavior that P2-H preserves. P1-C's implementation, not only its ticket document, must be on the base.

P2-H does not depend on P2-G for source authoring. It publishes the person contract that P2-G consumes; P2-G owns authorization independently and depends on P2-B's store helper.

### Parallel authoring versus safe integration

1. Integrate P1-C first. P1-C and P2-H both own revisions of `identity.mjs`; they are sequential and must never be authored concurrently in the same working tree.
2. After P1-C, and only after each listed ticket's own predecessors are integrated and green, P2-A, P2-B, P2-C, P2-D, P2-E, P2-F, and P2-H may be authored concurrently in isolated branches/worktrees because their declared Phase 2 source files are disjoint. P2-G is deliberately absent from this first wave: its authoring begins only after P2-B's complete store contract and source acceptance are integrated and green. P2-H writes only `identity.mjs`; parallel authoring does not mean shared runtime, generated output, or same-file concurrency.
3. Integrate P2-A's already-specified P1-C/P2-H compatibility predicate before treating the combined gate and identity tree as green. It may land before P2-H and lets both gate shapes work.
4. Integrate P2-B before P2-G. P2-G then supplies the sole role resolver against the four-field person contract.
5. Integrate P2-H from the P1-C base. P2-F may then run its final endpoint acceptance against P2-G/P2-H.
6. Integrate P3-H's `session.mjs` amendment immediately after P2-G/P2-H in the same serialized release wave. The P2-H-only intermediate commit may exist for review, but it is not a safe deploy, release, or green end-to-end acceptance point.
7. A transitional deployment may occur only after P2-A's exact compatibility predicate, P2-F, P2-G, P2-H, and P3-H are integrated and every standalone and release-train gate below passes. At that point P2-A is the one documented exception that still uses identity classification as its temporary HTML read wall.
8. P3-J later replaces that predicate with `resolveRole()`-backed read access and removes the legacy `roles` read. Only after P3-J's owning acceptance passes may the release be described as having no identity-based document-authorization exception.
9. Before either deployment class, run the applicable combined identity, gate, access, session, realtime, build, and scrub acceptance pass. Temporary roots, linked sites, provider applications, ports, `node_modules`, `_site`, and environment values are shared integration resources and are not evidence of concurrent source ownership.

P3-J later replaces P2-A's organization-only gate decision with `resolveRole()`-backed read access. P4-M later enforces access capabilities in write paths. Neither later ticket changes the four-field identity contract.

## Acceptance criteria

- [ ] The implementation diff amends only P1-C's `netlify/lib/identity.mjs` and creates no test, package, configuration, generated, or consumer source file.
- [ ] The module exports exactly `identify` and `requireOrigin`; `ORG_DOMAIN` remains private.
- [ ] Across `netlify/**/*.{mjs,ts}`, the sole executable access to the package's `getUser()` is one zero-argument call in `netlify/lib/identity.mjs`, bound to its single direct, unaliased named value import from exactly `@netlify/identity`; no alias, default/namespace import, re-export, `require()`, or dynamic-import route exists, and comments or string literals do not count.
- [ ] A null package result returns `null` with no error, log, partial object, or request-derived fallback.
- [ ] `identify()` does not catch an arbitrary future `getUser()` throw and does not reinterpret that throw as the pinned package's documented `null` result.
- [ ] Every authenticated result is a fresh plain object with exactly `sub`, `email`, `name`, and `isOrg`.
- [ ] `sub`, lower-case email normalization, and the nullish-only name fallback match P1-C exactly.
- [ ] `isOrg` is the exact suffix-only result of `email.endsWith("@example.com")`; no trim, validation, substring match, provider role, or metadata affects it.
- [ ] Missing email/name yields `{email: "", name: "", isOrg: false}` while preserving the package-provided `sub`.
- [ ] The simulated verified-JWT fallback succeeds while exposing only the same four fields and reading only `id`, `email`, and `name`.
- [ ] `roles`, `canComment`, `canEdit`, and `docs` are absent as own or inherited output properties; raw provider data and metadata are not returned.
- [ ] `requireOrigin(req)` retains P1-C's exact same-origin success and normalized 403 failure behavior.
- [ ] The enumerated direct static consumers prove that, outside P2-A's explicitly temporary organization-only HTML gate, they use P2-G's `resolveRole()` rather than a non-null identity or `isOrg` as document authorization. Before release, the integration owner also performs and records manual review of every remaining local re-export, dynamic local import, wrapper parameter, object-container transfer, and indirect caller in `netlify/**/*.{mjs,ts}`; this named manual remainder is mandatory because the AST gate deliberately does not claim whole-program flow proof.
- [ ] P2-A's exact transitional predicate and source-bound runtime matrix pass before the P2-H gate/identity combination is transitionally deployable; P2-H itself does not edit `gate.ts`.
- [ ] P3-H owns and supplies the compatible document-aware HTTP session projection; P2-H itself does not edit `session.mjs` or P2-C.
- [ ] P2-F consumes `sub`/`isOrg` only after access succeeds and contains no fallback to removed `roles` or `docs`.
- [ ] The P2-H-only session-incompatible state is not deployed or treated as a release acceptance point.
- [ ] A transitional deployment is labeled with the P2-A exception; a no-exception final-authority deployment additionally includes P3-J's `resolveRole()`-backed gate and removal of the legacy predicate.
- [ ] The standalone isolated fixture installs HUP/INT/TERM handling before temporary-root creation and accepts for deletion only a real, non-symlink directory with the exact `p2-h-identity.` plus six-alphanumeric suffix directly below the resolved exact `TMPDIR` parent. Its bounded direct-child deletion worker, which cannot spawn descendants, receives a positive-PID KILL on timeout and is awaited/reaped before success; no stale negative PGID is signalled. Any timeout, failed deletion, or uncertain cleanup retains the fixture root plus mode-`0600` actionable PID evidence under a safe printed locator. Its first signal status remains authoritative through cleanup and terminal exit; silent real HUP/INT/TERM probes require 129/130/143 from the same finalizer and leave no root.
- [ ] Each TypeScript AST gate durably publishes mode-`0600` `preparing` evidence before spawning anything, accepts only a nonce-authenticated live direct PID=PGID anchor, durably advances the evidence to `active`, and sends authenticated `GO` only afterward; therefore no install, version check, or AST work can begin before ownership publication. The install retains the GNU timeout as an inner deadline. Before `templates/docbuild/node_modules` is reused or replaced, the launcher revalidates the still-live leader immediately before each negative-PGID TERM or KILL, never signals after leader exit, reaps the leader, proves the complete group disappeared, and durably removes the lifecycle evidence. Any ownership, evidence, or cleanup uncertainty retains mode-`0600` PID/PGID evidence and fails before dependency-root reuse. That dependency directory is ordinary repository state intentionally retained for later build checks, not temporary P2-H residue.
- [ ] The release launcher positively owns a nonce-confirmed detached anchor through every group signal, revalidates the live direct PID=PGID immediately before signalling, never signals an exited or unproven PID/PGID, and normally finishes TERM-to-KILL cleanup, direct-child reaping, inherited-stream closure, and process-group disappearance proof before `cleanup.complete` can be true. Its fd 3/4 `READY`/`DONE`/`RELEASE` boundary remains separate from the canonical fd 5/4 authenticated child owner service.
- [ ] Every release fixture receives one validated P2-H-owned `TMPDIR` root. The real P2-A and P2-F marked fixtures must each complete exactly one authenticated `claim`/`reserve`/`release` lifecycle against P2-H's live external owner. P2-A reserves an exact direct `p2-a-*.` six-alphanumeric root; P2-F reserves an exact direct `p2f.` six-alphanumeric root; each evidence sibling is exactly `.${basename}.evidence.json`. Reserved child roots/evidence are removed before `release-ack`. After the fixture anchor group disappears, the outer owned root is removed by a separately bounded, reaped direct-child worker that cannot spawn descendants and is KILLed only by positive PID. Cleanup uncertainty retains the complete owned root and mode-`0600` evidence, so killing an owner fixture cannot leave an unreported artifact while P2-H claims clean.
- [ ] Source-bound release-supervisor self-tests deterministically cover real early, active, post-`DONE`, post-result, and final-tail signals through the exact shared handler/finalizer; a distinct second TERM during active cleanup proves first-SIGINT/status-130 wins; natural child HUP/INT/TERM/KILL statuses 129/130/143/137; launch failure; nonzero exit; timeout; TERM escalation; output overflow; external signal; a same-group background descendant; group/root cleanup completion; and evidence-write failure with the exact expected output. The actual P2-A marked fixture, rather than synthetic P2-A-named directories, proves the authenticated owner lifecycle. The first external signal immediately makes the parent exit nonzero even if it arrives after the last awaited fixture. Each owning marker fixture is manually reviewed to keep all children in the inherited anchor group while `P2H_OWNER_NONCE` is present and to avoid `setsid`, double-forking, daemonization, or `detached: true` in that release path.
- [ ] If launch ownership cannot be proved or a child remains unreapable after KILL, the release launcher stops signaling, detaches every local child/control/owner-service/stream handle before attempting evidence persistence, retains mode-`0600` metadata-only evidence for manual remediation when possible, and exits nonzero without claiming cleanup completed. A real post-reap, post-detach owned-root test forces the evidence write itself to fail and asserts the exact owner PID/PGID, owned root, attempted evidence pathname, and resolved parent locator; it cannot strand a referenced pipe or hide the remediation target.
- [ ] On a successful run, the isolated contract test, repository typecheck/build checks, patch check, and scrub gate all pass with no temporary residue; an explicitly reported terminal remediation path is a failed run, not false success.

P2-H source completion is established by Test plan steps 1, 2, 5, and 6 and may be staged for review. Step 2 independently proves the repository-wide single-accessor boundary on the P1-C/P2-H tree; it does not wait for consumers. Steps 3 and 4 are separate mandatory release-train gates owned by the integrator: step 3 proves only its enumerated direct structural invariants, while step 4 delegates source binding and behavioral authority proof to the owning fixtures that it locates and executes. Their dependence on P2-A, P2-F, P2-G, and P3-H does not authorize P2-H to edit those files or block completion of its one-file source amendment. A transitional deployment remains blocked until all six steps pass. For a final-authority train, steps 3 and 4 are recorded at the pre-P3-J transitional checkpoint; after P3-J removes the predicate that step 3 requires, P3-J's owning source-bound gate acceptance replaces that transitional gate proof for the deployed tree.

## Test plan

Run from the repository root on a branch with the P1-C implementation present. Use Node 22.12 or later on the Node 22 line. Steps 2 and 3 intentionally refresh `templates/docbuild/node_modules` from its lockfile. Their portable Node launcher owns one detached group per install or AST command, while GNU coreutils `timeout`/`gtimeout` supplies an inner install deadline; no later command may reuse or replace the dependency root until the leader is reaped and the group is proved gone. That normal repository dependency directory is retained for the later build gate. The tests create no root package install or permanent test file.

1. Run this isolated module contract. It copies only `identity.mjs`, supplies a process-local mock of the pinned package, uses a guarded temporary directory, captures all implementation output, and verifies exact output, suffix-only normalization, fallback field reads, request privacy, call count, freshness, descriptors, exports, and the unchanged origin helper:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   P2H_REPO="$PWD"
   P2H_TEST_ROOT=
   P2H_ACTIVE_PID=
   P2H_SIGNAL_STATUS=0
   P2H_CLEANING=0
   P2H_SIGNAL_PROBE_CAUGHT=
   P2H_TMP_PARENT=
   P2H_ROOT_CLEANUP_UNPROVED=0

   p2h_signal() {
     if test "$P2H_SIGNAL_STATUS" -eq 0; then P2H_SIGNAL_STATUS="$1"; fi
     if test -n "${P2H_SIGNAL_PROBE_CAUGHT:-}"; then : >"$P2H_SIGNAL_PROBE_CAUGHT"; fi
     if test "$P2H_CLEANING" -eq 0; then exit "$P2H_SIGNAL_STATUS"; fi
   }

   p2h_stop_active() {
     case "${P2H_ACTIVE_PID:-}" in
       ''|*[!0-9]*|0|1) P2H_ACTIVE_PID=; return 0 ;;
     esac
     kill -TERM "$P2H_ACTIVE_PID" 2>/dev/null || true
     local attempts=0
     while kill -0 "$P2H_ACTIVE_PID" 2>/dev/null && test "$attempts" -lt 40; do
       sleep 0.05
       attempts=$((attempts + 1))
     done
     if kill -0 "$P2H_ACTIVE_PID" 2>/dev/null; then
       kill -KILL "$P2H_ACTIVE_PID" 2>/dev/null || true
       attempts=0
       while kill -0 "$P2H_ACTIVE_PID" 2>/dev/null && test "$attempts" -lt 40; do
         sleep 0.05
         attempts=$((attempts + 1))
       done
     fi
     if kill -0 "$P2H_ACTIVE_PID" 2>/dev/null; then
       echo "ERROR  P2-H fixture process could not be reaped; retained ${P2H_TEST_ROOT:-no-root} for manual remediation" >&2
       return 1
     fi
     wait "$P2H_ACTIVE_PID" 2>/dev/null || true
     P2H_ACTIVE_PID=
   }

   p2h_remove_root() {
     local deletion_mode="${1:-delete}"
     local deletion_status=0
     test -n "${P2H_TEST_ROOT:-}" || return 0
     if test "$P2H_ROOT_CLEANUP_UNPROVED" -ne 0; then return 1; fi
     node - "$P2H_TEST_ROOT" "$P2H_TMP_PARENT" "$deletion_mode" <<'NODE' || deletion_status=$?
   const assert = require("node:assert/strict");
   const {spawn} = require("node:child_process");
   const {
     chmodSync, lstatSync, mkdtempSync, realpathSync, renameSync, statSync,
     writeFileSync,
   } = require("node:fs");
   const {dirname, join} = require("node:path");
   const [root, expectedParent, mode] = process.argv.slice(2);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
   let terminalStatus = 0;
   let resolveTerminal;
   const terminalSignal = new Promise((resolve) => { resolveTerminal = resolve; });
   for (const [name, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) {
     process.on(name, () => {
       if (terminalStatus !== 0) return;
       terminalStatus = status;
       process.exitCode = status;
       resolveTerminal({kind: "signal", name, status});
     });
   }
   const finish = async (status) => {
     await pause(0);
     process.exit(terminalStatus || status);
   };
   const actualParent = realpathSync(process.env.TMPDIR || "/tmp");
   assert.equal(expectedParent, actualParent);
   assert.ok(expectedParent.startsWith("/") && expectedParent !== "/");
   assert.equal(dirname(root), expectedParent);
   assert.match(root.slice(expectedParent.length + 1), /^p2-h-identity\.[A-Za-z0-9]{6}$/);
   const rootStat = lstatSync(root);
   assert.equal(rootStat.isDirectory(), true);
   assert.equal(rootStat.isSymbolicLink(), false);
   assert.equal(realpathSync(root), root);
   const worker = mode === "timeout-probe"
     ? "setInterval(() => {}, 60000);"
     : String.raw`
       const {rmSync} = require("node:fs");
       rmSync(process.argv[1], {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
       `;
   function retain(reason, pid, pgid, reaped, disappeared, silent = false) {
     let evidenceRoot = "";
     let evidencePath = "";
     try {
       evidenceRoot = mkdtempSync(join(expectedParent, "p2-h-delete-evidence."));
       assert.equal(dirname(evidenceRoot), expectedParent);
       assert.match(evidenceRoot.slice(expectedParent.length + 1),
         /^p2-h-delete-evidence\.[A-Za-z0-9]{6}$/);
       chmodSync(evidenceRoot, 0o700);
       assert.equal(realpathSync(evidenceRoot), evidenceRoot);
       evidencePath = join(evidenceRoot, "manual-remediation.json");
       const pending = `${evidencePath}.new`;
       writeFileSync(pending, `${JSON.stringify({
         version: 1, reason, fixtureRoot: root, deletionWorkerPid: pid,
         deletionWorkerPgid: pgid, reaped, groupDisappeared: disappeared,
       })}\n`, {mode: 0o600});
       chmodSync(pending, 0o600);
       renameSync(pending, evidencePath);
       chmodSync(evidencePath, 0o600);
       assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
       if (!silent) console.error(`ERROR  P2-H deletion failed; fixture-root=${root} deletion-pid=${pid ?? "not-applicable"} deletion-pgid=${pgid ?? "not-applicable"} evidence=${evidencePath}; manual remediation required`);
       return {evidenceRoot, evidencePath};
     } catch {
       if (!silent) console.error(`ERROR  P2-H deletion failed; fixture-root=${root} deletion-pid=${pid ?? "not-applicable"} deletion-pgid=${pgid ?? "not-applicable"} evidence=unavailable-under-${expectedParent}; manual remediation required`);
       return null;
     }
   }
   (async () => {
     let child;
     try {
       child = spawn(process.execPath, ["-e", worker, root], {stdio: "ignore"});
     } catch {
       retain("deletion-spawn-threw", null, null, true, true);
       await finish(1);
     }
     const workerPid = child.pid;
     if (!Number.isSafeInteger(workerPid) || workerPid <= 1) {
       child.unref();
       retain("deletion-ownership-unproved", workerPid, null, false, false);
       await finish(125);
     }
     let exitResult;
     const exited = new Promise((resolve) => {
       child.once("error", () => { exitResult = {kind: "error"}; resolve(exitResult); });
       child.once("exit", (code, signal) => {
         exitResult = {kind: "exit", code, signal}; resolve(exitResult);
       });
     });
     const first = await Promise.race([
       exited.then(() => "exit"),
       terminalSignal.then(() => "signal"),
       pause(mode === "timeout-probe" ? 50 : 10_000).then(() => "timeout"),
     ]);
     if (first === "timeout" || first === "signal") {
       try {
         if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
       } catch {}
     }
     const reap = await Promise.race([
       exited.then(() => true), pause(5_000).then(() => false),
     ]);
     const deleted = (() => {
       try { lstatSync(root); return false; }
       catch (error) { return error?.code === "ENOENT"; }
     })();
     if (first === "exit" && reap && deleted &&
         exitResult?.kind === "exit" && exitResult.code === 0 && exitResult.signal === null) {
       await finish(0);
     }
     if (!reap) {
       try { child.removeAllListeners(); child.unref(); } catch {}
     }
     const retained = retain(first === "timeout" ? "deletion-timeout" : "deletion-failed",
       workerPid, null, reap, false, mode === "timeout-probe");
     if (mode === "timeout-probe") {
       assert.equal(first, "timeout");
       assert.equal(reap, true);
       assert.equal(exitResult?.kind, "exit");
       assert.equal(exitResult?.signal, "SIGKILL");
       assert.ok(retained);
       assert.equal(statSync(retained.evidencePath).mode & 0o777, 0o600);
       const cleanupSource = String.raw`
         const {rmSync} = require("node:fs");
         for (const path of process.argv.slice(1)) rmSync(path, {recursive: true, force: true});
       `;
       const cleanup = spawn(process.execPath,
         ["-e", cleanupSource, root, retained.evidenceRoot], {stdio: "ignore"});
       let cleanupResult;
       const cleanupExited = new Promise((resolve) => {
         cleanup.once("error", () => { cleanupResult = {kind: "error"}; resolve(); });
         cleanup.once("exit", (code, signal) => {
           cleanupResult = {kind: "exit", code, signal}; resolve();
         });
       });
       const cleanupFirst = await Promise.race([
         cleanupExited.then(() => "exit"), pause(5_000).then(() => "timeout"),
       ]);
       if (cleanupFirst === "timeout" && cleanup.exitCode === null && cleanup.signalCode === null)
         cleanup.kill("SIGKILL");
       assert.equal(await Promise.race([
         cleanupExited.then(() => true), pause(5_000).then(() => false),
       ]), true);
       assert.deepEqual(cleanupResult, {kind: "exit", code: 0, signal: null});
     }
     await finish(first === "timeout" && reap ? 124 : 125);
   })().catch(() => {
     retain("deletion-supervisor-error", null, null, false, false);
     return finish(125);
   });
   NODE
     if test "$deletion_status" -ne 0; then
       if test "$deletion_mode" = timeout-probe && test "$deletion_status" -eq 124; then
         P2H_TEST_ROOT=
         return 124
       fi
       P2H_ROOT_CLEANUP_UNPROVED=1
       return 1
     fi
     test ! -e "$P2H_TEST_ROOT" || { P2H_ROOT_CLEANUP_UNPROVED=1; return 1; }
     P2H_TEST_ROOT=
   }

   p2h_run_bounded() {
     "$@" &
     P2H_ACTIVE_PID=$!
     local attempts=0
     while kill -0 "$P2H_ACTIVE_PID" 2>/dev/null && test "$attempts" -lt 2400; do
       sleep 0.05
       attempts=$((attempts + 1))
     done
     if kill -0 "$P2H_ACTIVE_PID" 2>/dev/null; then
       echo 'ERROR  P2-H standalone fixture exceeded 120 seconds' >&2
       p2h_stop_active || return 1
       return 124
     fi
     set +e
     wait "$P2H_ACTIVE_PID"
     local status=$?
     set -e
     P2H_ACTIVE_PID=
     return "$status"
   }

   cleanup() {
     local status=$?
     P2H_CLEANING=1
     p2h_stop_active || status=1
     if ! p2h_remove_root; then status=1; fi
     p2h_finish "$status"
   }
   p2h_finish() {
     local status="$1"
     trap - HUP INT TERM
     if test "$P2H_SIGNAL_STATUS" -ne 0; then status="$P2H_SIGNAL_STATUS"; fi
     trap - EXIT
     exit "$status"
   }
   trap cleanup EXIT
   trap 'p2h_signal 129' HUP
   trap 'p2h_signal 130' INT
   trap 'p2h_signal 143' TERM

   P2H_TMP_PARENT="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
   case "$P2H_TMP_PARENT" in /*) ;; *) exit 125 ;; esac
   test "$P2H_TMP_PARENT" != /

   P2H_DELETE_RESIDUE_BEFORE="$(find "$P2H_TMP_PARENT" -maxdepth 1 -type d \( -name 'p2-h-identity.*' -o -name 'p2-h-delete-evidence.*' \) -print | sort)"
   P2H_TEST_ROOT="$(mktemp -d "$P2H_TMP_PARENT/p2-h-identity.XXXXXX")"
   set +e
   p2h_remove_root timeout-probe
   P2H_DELETE_PROBE_STATUS=$?
   set -e
   test "$P2H_DELETE_PROBE_STATUS" -eq 124
   test -z "$P2H_TEST_ROOT"
   P2H_DELETE_RESIDUE_AFTER="$(find "$P2H_TMP_PARENT" -maxdepth 1 -type d \( -name 'p2-h-identity.*' -o -name 'p2-h-delete-evidence.*' \) -print | sort)"
   test "$P2H_DELETE_RESIDUE_BEFORE" = "$P2H_DELETE_RESIDUE_AFTER"

   p2h_probe_terminal_signal() {
     local signal="$1" expected="$2" attempts=0 probe_status=0
     P2H_TEST_ROOT="$(mktemp -d "$P2H_TMP_PARENT/p2-h-identity.XXXXXX")"
     local ready="$P2H_TEST_ROOT/ready" caught="$P2H_TEST_ROOT/caught" release="$P2H_TEST_ROOT/release"
     (
       trap - EXIT
       P2H_SIGNAL_STATUS=0
       P2H_CLEANING=1
       P2H_SIGNAL_PROBE_CAUGHT="$caught"
       trap 'p2h_signal 129' HUP
       trap 'p2h_signal 130' INT
       trap 'p2h_signal 143' TERM
       : >"$ready"
       while test ! -e "$release"; do sleep 0.01; done
       p2h_finish 0
     ) &
     P2H_ACTIVE_PID=$!
     while test ! -e "$ready" && kill -0 "$P2H_ACTIVE_PID" 2>/dev/null && test "$attempts" -lt 200; do
       sleep 0.01
       attempts=$((attempts + 1))
     done
     test -e "$ready"
     kill -s "$signal" "$P2H_ACTIVE_PID"
     attempts=0
     while test ! -e "$caught" && kill -0 "$P2H_ACTIVE_PID" 2>/dev/null && test "$attempts" -lt 200; do
       sleep 0.01
       attempts=$((attempts + 1))
     done
     test -e "$caught"
     : >"$release"
     set +e
     wait "$P2H_ACTIVE_PID"
     probe_status=$?
     set -e
     P2H_ACTIVE_PID=
     test "$probe_status" -eq "$expected"
     p2h_remove_root
     P2H_TEST_ROOT=
   }
   p2h_probe_terminal_signal HUP 129
   p2h_probe_terminal_signal INT 130
   p2h_probe_terminal_signal TERM 143

   P2H_TEST_ROOT="$(mktemp -d "$P2H_TMP_PARENT/p2-h-identity.XXXXXX")"

   mkdir -p "$P2H_TEST_ROOT/netlify/lib" "$P2H_TEST_ROOT/node_modules/@netlify/identity"
   cp "$P2H_REPO/netlify/lib/identity.mjs" "$P2H_TEST_ROOT/netlify/lib/identity.mjs"

   install -m 600 /dev/stdin "$P2H_TEST_ROOT/package.json" <<'JSON'
   { "private": true, "type": "module" }
   JSON
   install -m 600 /dev/stdin "$P2H_TEST_ROOT/node_modules/@netlify/identity/package.json" <<'JSON'
   { "name": "@netlify/identity", "version": "2.0.0", "type": "module", "exports": "./index.mjs" }
   JSON
   install -m 600 /dev/stdin "$P2H_TEST_ROOT/node_modules/@netlify/identity/index.mjs" <<'MOCK'
   let currentUser = null;
   let calls = 0;
   let failOriginOnce = false;
   const originCalls = [];

   export function __setUser(user) { currentUser = user; }
   export function __calls() { return calls; }
   export function __originCalls() { return originCalls; }
   export function __failOriginOnce() { failOriginOnce = true; }
   export async function getUser() { calls += 1; return currentUser; }
   export function verifyRequestOrigin(...args) {
     originCalls.push(args);
     if (failOriginOnce) {
       failOriginOnce = false;
       throw new Error("mock verifier failure");
     }
     const [req] = args;
     const actual = req.headers.get("origin");
     if (!actual || actual !== new URL(req.url).origin) {
       const error = new Error("mock origin rejection");
       error.status = 403;
       throw error;
     }
   }
   MOCK

   cd "$P2H_TEST_ROOT"
   if ! p2h_run_bounded node --input-type=module >"$P2H_TEST_ROOT/node.stdout" 2>"$P2H_TEST_ROOT/node.stderr" <<'NODE'
   import assert from "node:assert/strict";
   import {
     __calls,
     __failOriginOnce,
     __originCalls,
     __setUser,
   } from "@netlify/identity";

   const nativeStdoutWrite = process.stdout.write;
   const nativeStderrWrite = process.stderr.write;
   let capturedStdout = "";
   let capturedStderr = "";
   process.stdout.write = (chunk) => { capturedStdout += String(chunk); return true; };
   process.stderr.write = (chunk) => { capturedStderr += String(chunk); return true; };

   const passLines = [
     "PASS  P2-H exact identity classification",
     "PASS  P2-H fallback, request, and privacy contract",
     "PASS  P2-H origin contract unchanged",
   ];
   try {
     const identity = await import("./netlify/lib/identity.mjs");
     assert.deepEqual(Object.keys(identity).sort(), ["identify", "requireOrigin"]);

     const forbidden = (kind, property) => {
       throw new Error(`${kind} inspected forbidden ${String(property)}`);
     };
     const request = new Proxy(new Request("https://docs.example.test/api/session"), {
       get: (_target, property) => forbidden("request", property),
       has: (_target, property) => forbidden("request", property),
       ownKeys: () => forbidden("request", "ownKeys"),
       getOwnPropertyDescriptor: (_target, property) => forbidden("request", property),
       getPrototypeOf: () => forbidden("request", "prototype"),
     });
     const allowedUserFields = new Set(["id", "email", "name"]);
     let thenReads = 0;
     const guardedUser = (values) => new Proxy({
       role: "guest",
       roles: ["member"],
       appMetadata: { docs: ["4b7d2a"], privateMarker: "must-not-escape" },
       userMetadata: { note: "must-not-escape" },
       confirmedAt: "2026-09-02T12:00:00.000Z",
       ...values,
     }, {
       get(target, property, receiver) {
         // Promise resolution performs exactly one unavoidable thenable probe when the
         // async getUser() mock resolves a User. Count it so implementation reads fail.
         if (property === "then") { thenReads += 1; return undefined; }
         if (!allowedUserFields.has(property)) return forbidden("identity", property);
         return Reflect.get(target, property, receiver);
       },
       has(target, property) {
         if (!allowedUserFields.has(property)) return forbidden("identity", property);
         return Reflect.has(target, property);
       },
       ownKeys: () => forbidden("identity", "ownKeys"),
       getOwnPropertyDescriptor(target, property) {
         if (!allowedUserFields.has(property)) return forbidden("identity", property);
         return Reflect.getOwnPropertyDescriptor(target, property);
       },
       getPrototypeOf: () => forbidden("identity", "prototype"),
     });

     const keys = ["sub", "email", "name", "isOrg"];
     const removed = ["roles", "canComment", "canEdit", "docs"];
     const seen = [];
     const assertExactIdentity = (actual, expected) => {
       assert.deepEqual(actual, expected);
       assert.equal(Object.getPrototypeOf(actual), Object.prototype);
       assert.deepEqual(Reflect.ownKeys(actual), keys);
       assert.deepEqual(Object.getOwnPropertyDescriptors(actual), Object.fromEntries(
         keys.map((key) => [key, {
           value: expected[key], writable: true, enumerable: true, configurable: true,
         }]),
       ));
       for (const field of removed) assert.equal(field in actual, false);
       for (const prior of seen) assert.notEqual(actual, prior, "identify() must return a fresh object");
       seen.push(actual);
       return actual;
     };

     let expectedCalls = 0;
     let expectedThenReads = 0;
     const assertAccessorCounts = ({ user }) => {
       assert.equal(__calls(), ++expectedCalls);
       if (user) expectedThenReads += 1;
       assert.equal(thenReads, expectedThenReads,
         "implementation must not inspect the User then property");
     };
     __setUser(null);
     assert.equal(await identity.identify(request), null);
     assertAccessorCounts({ user: false });

     const organizationUser = guardedUser({
       id: "u_fixture_member_17",
       email: "AVERY@EXAMPLE.COM",
       name: "Avery Quill",
     });
     __setUser(organizationUser);
     const organizationExpected = {
       sub: "u_fixture_member_17",
       email: "avery@example.com",
       name: "Avery Quill",
       isOrg: true,
     };
     assertExactIdentity(await identity.identify(request), organizationExpected);
     assertAccessorCounts({ user: true });
     assertExactIdentity(await identity.identify(request), organizationExpected);
     assertAccessorCounts({ user: true });

     const cases = [
       [{ id: "u_fixture_guest_23", email: "river@review.invalid" }, {
         sub: "u_fixture_guest_23", email: "river@review.invalid", name: "river", isOrg: false,
       }],
       [{ id: "u_fixture_collision_24", email: "AVERY@EXAMPLE.COM.INVALID" }, {
         sub: "u_fixture_collision_24", email: "avery@example.com.invalid", name: "avery", isOrg: false,
       }],
       [{ id: "u_fixture_space_25", email: " AVERY@EXAMPLE.COM " }, {
         sub: "u_fixture_space_25", email: " avery@example.com ", name: " avery", isOrg: false,
       }],
       [{ id: "u_fixture_suffix_26", email: "@EXAMPLE.COM" }, {
         sub: "u_fixture_suffix_26", email: "@example.com", name: "", isOrg: true,
       }],
       [{ id: "u_fixture_blank_31", email: undefined, name: undefined }, {
         sub: "u_fixture_blank_31", email: "", name: "", isOrg: false,
       }],
       [{ id: "u_fixture_named_44", email: "named@review.invalid", name: "" }, {
         sub: "u_fixture_named_44", email: "named@review.invalid", name: "", isOrg: false,
       }],
       [{ id: "u_fixture_null_name_45", email: "null-name@review.invalid", name: null }, {
         sub: "u_fixture_null_name_45", email: "null-name@review.invalid", name: "null-name", isOrg: false,
       }],
     ];
     for (const [input, expected] of cases) {
       __setUser(guardedUser(input));
       assertExactIdentity(await identity.identify(request), expected);
       assertAccessorCounts({ user: true });
     }

     __setUser(guardedUser({
       id: "u_fixture_fallback_52",
       email: "FALLBACK@EXAMPLE.COM",
       name: "Fallback Reader",
     }));
     const fallback = assertExactIdentity(await identity.identify(request), {
       sub: "u_fixture_fallback_52",
       email: "fallback@example.com",
       name: "Fallback Reader",
       isOrg: true,
     });
     assertAccessorCounts({ user: true });
     assert.doesNotMatch(JSON.stringify(fallback), /must-not-escape|4b7d2a|member/);

     const assertOneOriginCall = (before, expectedRequest) => {
       assert.equal(__originCalls().length, before + 1);
       const args = __originCalls().at(-1);
       assert.equal(args.length, 1, "verifyRequestOrigin must receive no override");
       assert.equal(args[0], expectedRequest, "verifyRequestOrigin must receive the original request");
     };
     const assertBadOrigin = async (mutation) => {
       const before = __originCalls().length;
       let thrown;
       try { identity.requireOrigin(mutation); } catch (error) { thrown = error; }
       assertOneOriginCall(before, mutation);
       assert.ok(thrown instanceof Response);
       assert.equal(thrown.status, 403);
       assert.deepEqual([...thrown.headers.entries()], [
         ["content-type", "text/plain; charset=utf-8"],
       ]);
       assert.equal(await thrown.text(), "Bad origin");
     };

     const methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
     for (const method of methods) {
       const sameSite = new Request("https://docs.example.test/api/write", {
         method,
         headers: { Origin: "https://docs.example.test" },
       });
       const before = __originCalls().length;
       assert.equal(identity.requireOrigin(sameSite), undefined);
       assertOneOriginCall(before, sameSite);
       for (const origin of [
         undefined,
         "null",
         "https://other.invalid",
         "http://docs.example.test",
         "https://docs.example.test:444",
       ]) {
         const headers = origin === undefined ? {} : { Origin: origin };
         await assertBadOrigin(new Request("https://docs.example.test/api/write", {
           method,
           headers,
         }));
       }
       const verifierFailure = new Request("https://docs.example.test/api/write", {
         method,
         headers: { Origin: "https://docs.example.test" },
       });
       __failOriginOnce();
       await assertBadOrigin(verifierFailure);
     }
   } finally {
     process.stdout.write = nativeStdoutWrite;
     process.stderr.write = nativeStderrWrite;
   }
   assert.equal(capturedStdout, "", "identity implementation wrote stdout");
   assert.equal(capturedStderr, "", "identity implementation wrote stderr");
   for (const line of passLines) process.stdout.write(`${line}\n`);
   NODE
   then
     cd "$P2H_REPO"
     echo 'ERROR  P2-H isolated Node fixture failed with captured output' >&2
     exit 1
   fi
   cd "$P2H_REPO"
   install -m 600 /dev/stdin "$P2H_TEST_ROOT/node.expected" <<'EXPECTED'
   PASS  P2-H exact identity classification
   PASS  P2-H fallback, request, and privacy contract
   PASS  P2-H origin contract unchanged
   EXPECTED
   if test -s "$P2H_TEST_ROOT/node.stderr" ||
      ! cmp -s "$P2H_TEST_ROOT/node.stdout" "$P2H_TEST_ROOT/node.expected"; then
     echo 'ERROR  P2-H isolated Node fixture emitted unexpected output' >&2
     exit 1
   fi
   sed -n 'p' "$P2H_TEST_ROOT/node.stdout"

   p2h_remove_root
   P2H_TEST_ROOT=
   echo 'PASS  P2-H isolated fixture cleaned'
   BASH
   ```

   Expected stdout is exactly:

   ```text
   PASS  P2-H exact identity classification
   PASS  P2-H fallback, request, and privacy contract
   PASS  P2-H origin contract unchanged
   PASS  P2-H isolated fixture cleaned
   ```

   Any implementation output, request/user inspection outside the allowed fields, extra property or descriptor, reused result, call/export/origin change, or cleanup failure exits nonzero. Before creating the production fixture root, silent child-shell probes deliver real HUP, INT, and TERM during the final cleanup window and require exact statuses 129, 130, and 143 with no residue. The first signal is latched. At the final boundary the cleanup function removes HUP/INT/TERM traps before its last status read, then removes the EXIT trap and exits synchronously: a signal handled before trap removal is observed by that last read, while a later signal has default terminating behavior and cannot false-green. The identity cases distinguish `null`, `undefined`, empty, and populated names. The origin matrix repeats success, every normalized rejection, and an injected verifier error across GET, POST, PATCH, DELETE, and OPTIONS, and requires the response's complete header set. The Proxies trap reads, membership, keys, descriptors, and prototypes. Resolving an async mock result necessarily probes its `then` property once; the fixture counts exactly one such runtime probe per non-null result, so an additional implementation read also fails. All values are invented. The cleanup guard resolves the exact `TMPDIR` parent and accepts only the exact nonsymlink six-character fixture directory. Its direct deletion worker cannot spawn descendants and has a ten-second deadline; timeout sends positive-PID KILL and then awaits/reaps that exact child. Any deletion failure or uncertainty retains the fixture root plus a private evidence file containing its actionable deletion PID and prints the safe locator instead of retrying a possibly live worker or claiming cleanup.

2. As a **standalone P2-H source-completion gate**, mechanically verify the private suffix constant and the repository-wide single-accessor boundary without waiting for any consumer ticket:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   read -r -d '' P2H_AST_SUPERVISOR <<'NODE' || true
   import assert from "node:assert/strict";
   import {execFileSync, spawn} from "node:child_process";
   import {randomBytes} from "node:crypto";
   import {
     chmodSync, closeSync, fsyncSync, mkdtempSync, openSync, realpathSync,
     renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
   } from "node:fs";
   import {dirname, join} from "node:path";
   const [duration, command, ...args] = process.argv.slice(1);
   const timeoutMs = Number(duration) * 1000;
   assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && command);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
   const statuses = Object.freeze({SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137});
   let observedSignal = null;
   let resolveSignal;
   const signalReceived = new Promise((resolve) => { resolveSignal = resolve; });
   for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {
     if (observedSignal === null) {
       observedSignal = {kind: "external-signal", name, status: statuses[name]};
       process.exitCode = observedSignal.status;
       resolveSignal(observedSignal);
     }
   });
   const authoritative = (fallback) => observedSignal?.status ?? fallback;
   const parent = realpathSync(process.env.TMPDIR || "/tmp");
   assert.ok(parent.startsWith("/") && parent !== "/");
   const safeEvidenceRoot = (root) => dirname(root) === parent &&
     /^p2-h-ast-evidence\.[A-Za-z0-9]{6}$/.test(root.slice(parent.length + 1));
   let evidenceRoot = "";
   let evidencePath = "";
   const syncPath = (path) => {
     const fd = openSync(path, "r");
     try { fsyncSync(fd); } finally { closeSync(fd); }
   };
   function persistEvidence(state, reason, pid, pgid) {
     if (!evidenceRoot) {
       evidenceRoot = mkdtempSync(join(parent, "p2-h-ast-evidence."));
       assert.equal(safeEvidenceRoot(evidenceRoot), true);
       chmodSync(evidenceRoot, 0o700);
       assert.equal(realpathSync(evidenceRoot), evidenceRoot);
       evidencePath = join(evidenceRoot, "manual-remediation.json");
     }
     const pending = `${evidencePath}.new`;
     writeFileSync(pending, `${JSON.stringify({
       version: 1, state, reason, supervisorPid: process.pid,
       leaderPid: pid ?? null, leaderPgid: pgid ?? null,
     })}\n`, {mode: 0o600});
     chmodSync(pending, 0o600);
     syncPath(pending);
     renameSync(pending, evidencePath);
     chmodSync(evidencePath, 0o600);
     assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
     syncPath(evidenceRoot);
   }
   function retain(reason, pid, pgid) {
     try {
       persistEvidence("manual-remediation", reason, pid, pgid);
       console.error(`ERROR  P2-H AST cleanup unproved; supervisor-pid=${process.pid} leader-pid=${pid ?? "not-applicable"} leader-pgid=${pgid ?? "not-applicable"} evidence=${evidencePath}; manual remediation required`);
     } catch {
       console.error(`ERROR  P2-H AST cleanup unproved; supervisor-pid=${process.pid} leader-pid=${pid ?? "not-applicable"} leader-pgid=${pgid ?? "not-applicable"} evidence=unavailable-under-${parent}; manual remediation required`);
     }
   }
   function removeEvidence() {
     if (!evidenceRoot) return;
     unlinkSync(evidencePath);
     syncPath(evidenceRoot);
     rmdirSync(evidenceRoot);
     syncPath(parent);
     evidenceRoot = "";
     evidencePath = "";
   }
   const launcherSource = String.raw`
     import {spawn} from "node:child_process";
     const [nonce, command, ...args] = process.argv.slice(1);
     for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {});
     process.send({type: "anchor-ready", nonce, pid: process.pid});
     process.once("message", (message) => {
       if (message?.type !== "GO" || message.nonce !== nonce) process.exit(125);
       const child = spawn(command, args, {env: process.env, stdio: "inherit"});
       child.once("spawn", () => process.send({type: "launched", nonce, pid: process.pid}));
       child.once("error", () => process.send({type: "result", nonce, pid: process.pid, code: 127, signal: null}));
       child.once("exit", (code, signal) => process.send({type: "result", nonce, pid: process.pid, code, signal}));
     });
     setInterval(() => {}, 60_000);
   `;
   const groupAlive = (pgid) => {
     try { process.kill(-pgid, 0); return true; }
     catch (error) {
       if (error?.code === "ESRCH") return false;
       if (error?.code === "EPERM") return true;
       throw error;
     }
   };
   const groupGone = async (pgid, milliseconds) => {
     const deadline = Date.now() + milliseconds;
     while (groupAlive(pgid) && Date.now() < deadline) await pause(25);
     return !groupAlive(pgid);
   };
   let leader = null;
   let pgid = null;
   let leaderResult = null;
   let leaderExited = false;
   let unresolved = false;
   const liveLeader = () => {
     if (leaderExited || leader?.exitCode !== null || leader?.signalCode !== null ||
         !Number.isSafeInteger(pgid) || pgid <= 1 || leader?.pid !== pgid) return false;
     try {
       const rows = execFileSync("ps", ["-o", "pid=,pgid=", "-p", String(pgid)], {
         encoding: "utf8", timeout: 1_000,
       }).trim().split("\n").filter(Boolean).map((line) =>
         line.trim().split(/\s+/).map(Number));
       return rows.length === 1 && rows[0][0] === pgid && rows[0][1] === pgid;
     } catch { return false; }
   };
   const detach = () => {
     try { if (leader?.connected) leader.disconnect(); } catch {}
     try { leader?.removeAllListeners("message"); leader?.unref(); } catch {}
   };
   async function contain() {
     if (leader === null) return true;
     const valid = Number.isSafeInteger(pgid) && pgid > 1 && leader?.pid === pgid;
     try { if (liveLeader()) process.kill(-pgid, "SIGTERM"); } catch {}
     await pause(500);
     try { if (liveLeader()) process.kill(-pgid, "SIGKILL"); } catch {}
     const reaped = leaderResult !== null && (await Promise.race([
       leaderResult.then(() => true), pause(5_000).then(() => false),
     ]));
     let disappeared = false;
     try { disappeared = valid && reaped && await groupGone(pgid, 5_000); } catch {}
     if (reaped && disappeared) {
       unresolved = false;
       try { removeEvidence(); return true; }
       catch { retain("evidence-removal-unproved", leader?.pid, pgid); return false; }
     }
     detach();
     retain("group-containment-unproved", leader?.pid, pgid);
     return false;
   }
   async function finish(status) {
     await pause(0);
     process.exit(authoritative(status));
   }
   try {
     try { persistEvidence("preparing", "awaiting-anchor-ownership", null, null); }
     catch { retain("pre-spawn-evidence-write-failed", null, null); await finish(125); }
     const nonce = randomBytes(16).toString("hex");
     leader = spawn(process.execPath,
       ["--input-type=module", "--eval", launcherSource, nonce, command, ...args], {
         detached: true, env: process.env,
         stdio: ["inherit", "inherit", "inherit", "ipc"],
       });
     pgid = leader.pid;
     unresolved = true;
     leaderResult = new Promise((resolve) => {
       leader.once("error", () => { leaderExited = true; resolve({kind: "leader-error"}); });
       leader.once("exit", (code, signal) => {
         leaderExited = true; resolve({kind: "leader-exit", code, signal});
       });
     });
     if (!Number.isSafeInteger(pgid) || pgid <= 1) {
       detach(); retain("launch-ownership-unproved", leader?.pid, pgid); await finish(125);
     }
     let anchorResolve;
     let launchedResolve;
     let resultResolve;
     const anchorReady = new Promise((resolve) => { anchorResolve = resolve; });
     const launched = new Promise((resolve) => { launchedResolve = resolve; });
     const commandResult = new Promise((resolve) => { resultResolve = resolve; });
     leader.on("message", (message) => {
       if (message?.nonce !== nonce || message?.pid !== pgid) return;
       if (message?.type === "anchor-ready") anchorResolve({kind: "anchor-ready"});
       if (message?.type === "launched") launchedResolve({kind: "launched"});
       if (message?.type === "result") resultResolve({
         kind: "result", code: message.code, signal: message.signal,
       });
     });
     const anchorHandshake = await Promise.race([
       anchorReady, leaderResult, signalReceived,
       pause(5_000).then(() => ({kind: "launch-timeout"})),
     ]);
     if (anchorHandshake.kind !== "anchor-ready" || !liveLeader()) {
       await contain();
       await finish(125);
     }
     if (observedSignal !== null) { await contain(); await finish(observedSignal.status); }
     try { persistEvidence("active", "anchor-ownership-published", pgid, pgid); }
     catch { await contain(); await finish(125); }
     if (observedSignal !== null) { await contain(); await finish(observedSignal.status); }
     leader.send({type: "GO", nonce});
     const handshake = await Promise.race([
       launched, commandResult, leaderResult, signalReceived,
       pause(5_000).then(() => ({kind: "launch-timeout"})),
     ]);
     if (handshake.kind !== "launched" || !liveLeader()) {
       await contain();
       await finish(125);
     }
     const outcome = await Promise.race([
       commandResult,
       signalReceived,
       pause(timeoutMs).then(() => ({kind: "timeout", status: 124})),
     ]);
     const complete = await contain();
     if (!complete) await finish(125);
     const status = outcome.kind === "result"
       ? (outcome.signal === null ? outcome.code ?? 1 : statuses[outcome.signal] ?? 1)
       : outcome.status;
     await finish(status);
   } catch {
     if (leader === null && evidenceRoot) {
       retain("leader-spawn-threw", null, null);
       await finish(125);
     }
     if (unresolved && !await contain()) await finish(125);
     await finish(125);
   }
   NODE
   p2h_ast_run() {
     local duration="$1"
     shift
     node --input-type=module --eval "$P2H_AST_SUPERVISOR" -- "$duration" "$@"
   }
   P2H_AST_SIGNAL_STATUS=0
   p2h_ast_signal() {
     if test "$P2H_AST_SIGNAL_STATUS" -eq 0; then P2H_AST_SIGNAL_STATUS="$1"; fi
     exit "$P2H_AST_SIGNAL_STATUS"
   }
   trap 'p2h_ast_signal 129' HUP
   trap 'p2h_ast_signal 130' INT
   trap 'p2h_ast_signal 143' TERM

   if command -v gtimeout >/dev/null 2>&1; then
     P2H_TIMEOUT="$(command -v gtimeout)"
   elif command -v timeout >/dev/null 2>&1 && timeout --version 2>/dev/null | head -1 | grep -q 'GNU coreutils'; then
     P2H_TIMEOUT="$(command -v timeout)"
   else
     echo 'ERROR  P2-H AST gates require GNU coreutils timeout (gtimeout on macOS)' >&2
     exit 1
   fi
   P2H_AST_TMP_PARENT="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
   P2H_AST_EVIDENCE_BEFORE="$(find "$P2H_AST_TMP_PARENT" -maxdepth 1 -type d -name 'p2-h-ast-evidence.*' -print | sort)"
   set +e
   p2h_ast_run 2 node -e 'process.kill(process.pid, "SIGKILL")'
   P2H_AST_NATURAL_STATUS=$?
   p2h_ast_run 0.1 sh -c 'trap "" TERM; (trap "" TERM; sleep 10) & wait'
   P2H_AST_TIMEOUT_STATUS=$?
   set -e
   test "$P2H_AST_NATURAL_STATUS" -eq 137
   test "$P2H_AST_TIMEOUT_STATUS" -eq 124
   P2H_AST_EVIDENCE_AFTER="$(find "$P2H_AST_TMP_PARENT" -maxdepth 1 -type d -name 'p2-h-ast-evidence.*' -print | sort)"
   test "$P2H_AST_EVIDENCE_BEFORE" = "$P2H_AST_EVIDENCE_AFTER"
   p2h_ast_run 190 "$P2H_TIMEOUT" --foreground --signal=TERM --kill-after=5s 180s \
     npm --prefix templates/docbuild ci --ignore-scripts --no-audit --no-fund >/dev/null
   p2h_ast_run 30 node - <<'NODE'
   const assert = require("node:assert/strict");
   const lock = require("./templates/docbuild/package-lock.json");
   const installed = require("./templates/docbuild/node_modules/typescript/package.json");
   assert.equal(installed.version, lock.packages["node_modules/typescript"].version);
   assert.equal(require.resolve("./templates/docbuild/node_modules/typescript/lib/typescript.js"),
     require.resolve("typescript/lib/typescript.js", {paths: ["./templates/docbuild"]}));
   NODE
   p2h_ast_run 120 node <<'NODE'
   const assert = require("node:assert/strict");
   const {readdirSync} = require("node:fs");
   const ts = require("./templates/docbuild/node_modules/typescript/lib/typescript.js");
   const paths = [];
   const scan = (dir) => { for (const e of readdirSync(dir, {withFileTypes: true})) {
     const path = `${dir}/${e.name}`;
     if (e.isDirectory()) scan(path); else if (/\.(mjs|ts)$/.test(e.name)) paths.push(path);
   }};
   scan("netlify"); paths.sort();
   const program = ts.createProgram(paths, {allowJs: true, module: ts.ModuleKind.ESNext,
     noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.Latest});
   const checker = program.getTypeChecker();
   const trees = new Map(paths.map((path) => {
     const tree = program.getSourceFile(path); assert(tree, `cannot parse ${path}`); return [path, tree];
   }));
   const walk = (node, fn) => { fn(node); ts.forEachChild(node, (child) => walk(child, fn)); };
   const unwrap = (node) => {
     while (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ||
            ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node)) node = node.expression;
     return node;
   };
   const symbolAt = (node) => (node = unwrap(node), ts.isIdentifier(node)
     ? checker.getSymbolAtLocation(node) : null);
   const staticText = (node, seen = new Set()) => {
     node = unwrap(node);
     if (ts.isStringLiteralLike(node)) return node.text;
     if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
       const left = staticText(node.left, seen);
       const right = staticText(node.right, seen);
       return left === null || right === null ? null : left + right;
     }
     if (ts.isIdentifier(node)) {
       const symbol = checker.getSymbolAtLocation(node);
       if (!symbol || seen.has(symbol)) return null;
       const declarations = (symbol.declarations ?? []).filter(ts.isVariableDeclaration);
       if (declarations.length !== 1) return null;
       const declaration = declarations[0];
       if (!declaration.initializer || !(declaration.parent.flags & ts.NodeFlags.Const)) return null;
       const next = new Set(seen); next.add(symbol);
       return staticText(declaration.initializer, next);
     }
     return null;
   };
   const literal = (node) => ts.isStringLiteralLike(node) ? node.text : null;
   const packageName = "@netlify/identity";
   const identityPath = "netlify/lib/identity.mjs";
   const packageRoute = (value) => value === packageName || value?.startsWith(`${packageName}/`);
   let accessorImport;
   for (const [path, tree] of trees) {
     walk(tree, (node) => {
       const route = staticText(node);
       if (packageRoute(route)) {
         const allowed = ts.isStringLiteralLike(node) && ts.isImportDeclaration(node.parent) &&
           node.parent.moduleSpecifier === node && route === packageName;
         assert(allowed,
           `${path} has an executable or statically recoverable alternate Identity package route`);
       }
       if (ts.isImportDeclaration(node) && packageRoute(literal(node.moduleSpecifier))) {
         assert.equal(literal(node.moduleSpecifier), packageName, `${path} imports a package subpath`);
         const clause = node.importClause;
         assert(!clause?.name, `${path} default-imports the identity package`);
         assert(!clause?.namedBindings || !ts.isNamespaceImport(clause.namedBindings),
           `${path} namespace-imports the identity package`);
         if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
           for (const specifier of clause.namedBindings.elements) {
             if ((specifier.propertyName ?? specifier.name).text !== "getUser") continue;
             assert.equal(path, identityPath, `${path} imports getUser outside identity.mjs`);
             assert(!clause.isTypeOnly && !specifier.isTypeOnly, "getUser must be a value import");
             assert.equal(specifier.propertyName, undefined, "getUser must be unaliased");
             assert.equal(accessorImport, undefined, "getUser must be imported once");
             accessorImport = specifier;
           }
         }
       }
     });
   }
   assert(accessorImport, `${identityPath} must import getUser from ${packageName}`);
   const accessor = checker.getSymbolAtLocation(accessorImport.name); assert(accessor);
   const getUserCalls = [];
   let identifyDeclaration;
   for (const [path, tree] of trees) {
     walk(tree, (node) => {
       if (ts.isExportSpecifier(node) &&
           checker.getExportSpecifierLocalTargetSymbol(node) === accessor) assert.fail(`${path} exports getUser`);
       if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === accessor) {
         if (node === accessorImport.name) return;
         const call = node.parent;
         assert(ts.isCallExpression(call) && call.expression === node,
           `${path} aliases or indirectly invokes getUser`);
         assert.equal(path, identityPath); assert.equal(call.questionDotToken, undefined);
         assert.equal(call.arguments.length, 0, "getUser must receive zero arguments");
         let owner = call.parent;
         while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
         assert.equal(owner?.name?.text, "identify", "getUser must be inside identify()");
         identifyDeclaration = owner;
         getUserCalls.push(call);
       }
     });
   }
   assert.equal(getUserCalls.length, 1, "getUser must be called once repository-wide");
   assert.equal(identifyDeclaration.parameters.length, 1, "identify() must have exactly one parameter");
   const reqParameter = identifyDeclaration.parameters[0];
   assert(ts.isIdentifier(reqParameter.name) && reqParameter.name.text === "req" &&
          !reqParameter.dotDotDotToken && !reqParameter.questionToken && !reqParameter.initializer,
     "identify() must preserve the exact identify(req) parameter");

   const identityTree = trees.get(identityPath);
   const userDeclarations = [];
   walk(identifyDeclaration, (node) => {
     if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
         unwrap(node.initializer) === getUserCalls[0]) userDeclarations.push(node);
   });
   assert.equal(userDeclarations.length, 1, "identify() must directly bind its getUser() result");
   const userSymbol = checker.getSymbolAtLocation(userDeclarations[0].name); assert(userSymbol);
   const emailDeclarations = [];
   walk(identifyDeclaration, (node) => {
     if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "email") {
       emailDeclarations.push(node);
     }
   });
   assert.equal(emailDeclarations.length, 1, "identify() must declare one normalized email binding");
   const emailDeclaration = emailDeclarations[0];
   const emailSymbol = checker.getSymbolAtLocation(emailDeclaration.name); assert(emailSymbol);
   const lowerCall = unwrap(emailDeclaration.initializer);
   assert(ts.isCallExpression(lowerCall) && lowerCall.arguments.length === 0 &&
          ts.isPropertyAccessExpression(lowerCall.expression) &&
          lowerCall.expression.name.text === "toLowerCase",
     "email must be the result of one zero-argument toLowerCase() call");
   const coalesce = unwrap(lowerCall.expression.expression);
   assert(ts.isBinaryExpression(coalesce) &&
          coalesce.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken,
     "email must preserve the nullish-only fallback");
   const rawEmail = unwrap(coalesce.left);
   assert(ts.isPropertyAccessExpression(rawEmail) && rawEmail.name.text === "email" &&
          symbolAt(rawEmail.expression) === userSymbol && literal(unwrap(coalesce.right)) === "",
     "email must normalize exactly (user.email ?? \"\").toLowerCase()");
   const orgDeclarations = [];
   walk(identityTree, (node) => {
     if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ORG_DOMAIN") {
       orgDeclarations.push(node);
     }
   });
   assert.equal(orgDeclarations.length, 1, "ORG_DOMAIN must be declared once");
   const orgDeclaration = orgDeclarations[0];
   assert(orgDeclaration.parent.flags & ts.NodeFlags.Const, "ORG_DOMAIN must be const");
   const orgStatement = orgDeclaration.parent.parent;
   assert(ts.isVariableStatement(orgStatement), "ORG_DOMAIN must be a module variable");
   assert.equal(orgStatement.parent, identityTree, "ORG_DOMAIN must be declared at module scope");
   assert(!orgStatement.modifiers?.some((modifier) =>
     modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword),
   "ORG_DOMAIN must not use a direct export modifier");
   assert.equal(literal(orgDeclaration.initializer), "@example.com");
   const orgSymbol = checker.getSymbolAtLocation(orgDeclaration.name); assert(orgSymbol);
   const orgUses = [];
   walk(identityTree, (node) => {
     if (ts.isExportSpecifier(node) && checker.getExportSpecifierLocalTargetSymbol(node) === orgSymbol) {
       assert.fail("ORG_DOMAIN must remain private");
     }
     if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === orgSymbol && node !== orgDeclaration.name) {
       orgUses.push(node);
     }
   });
   assert.equal(orgUses.length, 1, "ORG_DOMAIN must have one classification use");
   const orgUse = orgUses[0];
   assert(ts.isCallExpression(orgUse.parent) && orgUse.parent.arguments.length === 1 &&
          orgUse.parent.arguments[0] === orgUse && ts.isPropertyAccessExpression(orgUse.parent.expression) &&
          orgUse.parent.expression.name.text === "endsWith" &&
          symbolAt(orgUse.parent.expression.expression) === emailSymbol,
     "ORG_DOMAIN must be the sole argument to email.endsWith()");
   console.log("PASS  P2-H private suffix and single-accessor AST audit");
   NODE
   BASH
   ```

   Expected: exit `0` and exactly `PASS  P2-H private suffix and single-accessor AST audit`. The install, installed-version check, and AST audit each run below the same finite detached-group owner. It keeps a leader alive after its command result, then applies TERM-to-KILL, reaps the leader, and proves group disappearance before the next command may inspect or replace `templates/docbuild/node_modules`; unproved cleanup fails with private PID/PGID evidence and no dependency-root reuse. Across every Netlify `.mjs`/`.ts` source, the audit symbol-binds one direct, unaliased, zero-argument `getUser()` call inside an exact one-parameter `identify(req)` declaration to the exact package import. Direct named imports of other SDK symbols remain valid in their owning files—P2-A's login/logout functions use that boundary—but `getUser` may be imported only by `identity.mjs`. The audit rejects alternate executable routes whose package or package-subpath value is statically expressed as a string/no-substitution-template literal, a `+` composition, or local `const` aliases of those forms; that covers aliased, reflective, dynamic-import, `require`, `createRequire`, and `process.getBuiltinModule` access without claiming general constant propagation or arbitrary code evaluation. It also proves one non-exported, module-scoped `const ORG_DOMAIN = "@example.com"`, the exact lower-case email binding, and the constant's single use as that binding's sole `endsWith()` argument. Comments cannot satisfy bindings, and the enumerated executable route forms cannot satisfy or bypass the `getUser` boundary.

3. As a **release-train gate**, enumerate every direct static `identify()` import, bind the three declared direct consumers to their real imports, constrain their directly bound identity/access property reads, and find the exact transitional P2-A predicate structurally. Run only after P2-A, P2-F, P2-G, P2-H, and P3-H are assembled. This is deliberately a direct structural gate: it does not claim whole-program data-flow through arbitrary helper parameters, object containers, local re-exports, or control flow. The owning source-bound fixtures in step 4 prove that access results and the gate predicate control runtime behavior:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   read -r -d '' P2H_AST_SUPERVISOR <<'NODE' || true
   import assert from "node:assert/strict";
   import {execFileSync, spawn} from "node:child_process";
   import {randomBytes} from "node:crypto";
   import {
     chmodSync, closeSync, fsyncSync, mkdtempSync, openSync, realpathSync,
     renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
   } from "node:fs";
   import {dirname, join} from "node:path";
   const [duration, command, ...args] = process.argv.slice(1);
   const timeoutMs = Number(duration) * 1000;
   assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0 && command);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
   const statuses = Object.freeze({SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137});
   let observedSignal = null;
   let resolveSignal;
   const signalReceived = new Promise((resolve) => { resolveSignal = resolve; });
   for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {
     if (observedSignal === null) {
       observedSignal = {kind: "external-signal", name, status: statuses[name]};
       process.exitCode = observedSignal.status;
       resolveSignal(observedSignal);
     }
   });
   const authoritative = (fallback) => observedSignal?.status ?? fallback;
   const parent = realpathSync(process.env.TMPDIR || "/tmp");
   assert.ok(parent.startsWith("/") && parent !== "/");
   const safeEvidenceRoot = (root) => dirname(root) === parent &&
     /^p2-h-ast-evidence\.[A-Za-z0-9]{6}$/.test(root.slice(parent.length + 1));
   let evidenceRoot = "";
   let evidencePath = "";
   const syncPath = (path) => {
     const fd = openSync(path, "r");
     try { fsyncSync(fd); } finally { closeSync(fd); }
   };
   function persistEvidence(state, reason, pid, pgid) {
     if (!evidenceRoot) {
       evidenceRoot = mkdtempSync(join(parent, "p2-h-ast-evidence."));
       assert.equal(safeEvidenceRoot(evidenceRoot), true);
       chmodSync(evidenceRoot, 0o700);
       assert.equal(realpathSync(evidenceRoot), evidenceRoot);
       evidencePath = join(evidenceRoot, "manual-remediation.json");
     }
     const pending = `${evidencePath}.new`;
     writeFileSync(pending, `${JSON.stringify({
       version: 1, state, reason, supervisorPid: process.pid,
       leaderPid: pid ?? null, leaderPgid: pgid ?? null,
     })}\n`, {mode: 0o600});
     chmodSync(pending, 0o600);
     syncPath(pending);
     renameSync(pending, evidencePath);
     chmodSync(evidencePath, 0o600);
     assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
     syncPath(evidenceRoot);
   }
   function retain(reason, pid, pgid) {
     try {
       persistEvidence("manual-remediation", reason, pid, pgid);
       console.error(`ERROR  P2-H AST cleanup unproved; supervisor-pid=${process.pid} leader-pid=${pid ?? "not-applicable"} leader-pgid=${pgid ?? "not-applicable"} evidence=${evidencePath}; manual remediation required`);
     } catch {
       console.error(`ERROR  P2-H AST cleanup unproved; supervisor-pid=${process.pid} leader-pid=${pid ?? "not-applicable"} leader-pgid=${pgid ?? "not-applicable"} evidence=unavailable-under-${parent}; manual remediation required`);
     }
   }
   function removeEvidence() {
     if (!evidenceRoot) return;
     unlinkSync(evidencePath);
     syncPath(evidenceRoot);
     rmdirSync(evidenceRoot);
     syncPath(parent);
     evidenceRoot = "";
     evidencePath = "";
   }
   const launcherSource = String.raw`
     import {spawn} from "node:child_process";
     const [nonce, command, ...args] = process.argv.slice(1);
     for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {});
     process.send({type: "anchor-ready", nonce, pid: process.pid});
     process.once("message", (message) => {
       if (message?.type !== "GO" || message.nonce !== nonce) process.exit(125);
       const child = spawn(command, args, {env: process.env, stdio: "inherit"});
       child.once("spawn", () => process.send({type: "launched", nonce, pid: process.pid}));
       child.once("error", () => process.send({type: "result", nonce, pid: process.pid, code: 127, signal: null}));
       child.once("exit", (code, signal) => process.send({type: "result", nonce, pid: process.pid, code, signal}));
     });
     setInterval(() => {}, 60_000);
   `;
   const groupAlive = (pgid) => {
     try { process.kill(-pgid, 0); return true; }
     catch (error) {
       if (error?.code === "ESRCH") return false;
       if (error?.code === "EPERM") return true;
       throw error;
     }
   };
   const groupGone = async (pgid, milliseconds) => {
     const deadline = Date.now() + milliseconds;
     while (groupAlive(pgid) && Date.now() < deadline) await pause(25);
     return !groupAlive(pgid);
   };
   let leader = null;
   let pgid = null;
   let leaderResult = null;
   let leaderExited = false;
   let unresolved = false;
   const liveLeader = () => {
     if (leaderExited || leader?.exitCode !== null || leader?.signalCode !== null ||
         !Number.isSafeInteger(pgid) || pgid <= 1 || leader?.pid !== pgid) return false;
     try {
       const rows = execFileSync("ps", ["-o", "pid=,pgid=", "-p", String(pgid)], {
         encoding: "utf8", timeout: 1_000,
       }).trim().split("\n").filter(Boolean).map((line) =>
         line.trim().split(/\s+/).map(Number));
       return rows.length === 1 && rows[0][0] === pgid && rows[0][1] === pgid;
     } catch { return false; }
   };
   const detach = () => {
     try { if (leader?.connected) leader.disconnect(); } catch {}
     try { leader?.removeAllListeners("message"); leader?.unref(); } catch {}
   };
   async function contain() {
     if (leader === null) return true;
     const valid = Number.isSafeInteger(pgid) && pgid > 1 && leader?.pid === pgid;
     try { if (liveLeader()) process.kill(-pgid, "SIGTERM"); } catch {}
     await pause(500);
     try { if (liveLeader()) process.kill(-pgid, "SIGKILL"); } catch {}
     const reaped = leaderResult !== null && (await Promise.race([
       leaderResult.then(() => true), pause(5_000).then(() => false),
     ]));
     let disappeared = false;
     try { disappeared = valid && reaped && await groupGone(pgid, 5_000); } catch {}
     if (reaped && disappeared) {
       unresolved = false;
       try { removeEvidence(); return true; }
       catch { retain("evidence-removal-unproved", leader?.pid, pgid); return false; }
     }
     detach();
     retain("group-containment-unproved", leader?.pid, pgid);
     return false;
   }
   async function finish(status) {
     await pause(0);
     process.exit(authoritative(status));
   }
   try {
     try { persistEvidence("preparing", "awaiting-anchor-ownership", null, null); }
     catch { retain("pre-spawn-evidence-write-failed", null, null); await finish(125); }
     const nonce = randomBytes(16).toString("hex");
     leader = spawn(process.execPath,
       ["--input-type=module", "--eval", launcherSource, nonce, command, ...args], {
         detached: true, env: process.env,
         stdio: ["inherit", "inherit", "inherit", "ipc"],
       });
     pgid = leader.pid;
     unresolved = true;
     leaderResult = new Promise((resolve) => {
       leader.once("error", () => { leaderExited = true; resolve({kind: "leader-error"}); });
       leader.once("exit", (code, signal) => {
         leaderExited = true; resolve({kind: "leader-exit", code, signal});
       });
     });
     if (!Number.isSafeInteger(pgid) || pgid <= 1) {
       detach(); retain("launch-ownership-unproved", leader?.pid, pgid); await finish(125);
     }
     let anchorResolve;
     let launchedResolve;
     let resultResolve;
     const anchorReady = new Promise((resolve) => { anchorResolve = resolve; });
     const launched = new Promise((resolve) => { launchedResolve = resolve; });
     const commandResult = new Promise((resolve) => { resultResolve = resolve; });
     leader.on("message", (message) => {
       if (message?.nonce !== nonce || message?.pid !== pgid) return;
       if (message?.type === "anchor-ready") anchorResolve({kind: "anchor-ready"});
       if (message?.type === "launched") launchedResolve({kind: "launched"});
       if (message?.type === "result") resultResolve({
         kind: "result", code: message.code, signal: message.signal,
       });
     });
     const anchorHandshake = await Promise.race([
       anchorReady, leaderResult, signalReceived,
       pause(5_000).then(() => ({kind: "launch-timeout"})),
     ]);
     if (anchorHandshake.kind !== "anchor-ready" || !liveLeader()) {
       await contain();
       await finish(125);
     }
     if (observedSignal !== null) { await contain(); await finish(observedSignal.status); }
     try { persistEvidence("active", "anchor-ownership-published", pgid, pgid); }
     catch { await contain(); await finish(125); }
     if (observedSignal !== null) { await contain(); await finish(observedSignal.status); }
     leader.send({type: "GO", nonce});
     const handshake = await Promise.race([
       launched, commandResult, leaderResult, signalReceived,
       pause(5_000).then(() => ({kind: "launch-timeout"})),
     ]);
     if (handshake.kind !== "launched" || !liveLeader()) {
       await contain();
       await finish(125);
     }
     const outcome = await Promise.race([
       commandResult,
       signalReceived,
       pause(timeoutMs).then(() => ({kind: "timeout", status: 124})),
     ]);
     const complete = await contain();
     if (!complete) await finish(125);
     const status = outcome.kind === "result"
       ? (outcome.signal === null ? outcome.code ?? 1 : statuses[outcome.signal] ?? 1)
       : outcome.status;
     await finish(status);
   } catch {
     if (leader === null && evidenceRoot) {
       retain("leader-spawn-threw", null, null);
       await finish(125);
     }
     if (unresolved && !await contain()) await finish(125);
     await finish(125);
   }
   NODE
   p2h_ast_run() {
     local duration="$1"
     shift
     node --input-type=module --eval "$P2H_AST_SUPERVISOR" -- "$duration" "$@"
   }
   P2H_AST_SIGNAL_STATUS=0
   p2h_ast_signal() {
     if test "$P2H_AST_SIGNAL_STATUS" -eq 0; then P2H_AST_SIGNAL_STATUS="$1"; fi
     exit "$P2H_AST_SIGNAL_STATUS"
   }
   trap 'p2h_ast_signal 129' HUP
   trap 'p2h_ast_signal 130' INT
   trap 'p2h_ast_signal 143' TERM

   if command -v gtimeout >/dev/null 2>&1; then
     P2H_TIMEOUT="$(command -v gtimeout)"
   elif command -v timeout >/dev/null 2>&1 && timeout --version 2>/dev/null | head -1 | grep -q 'GNU coreutils'; then
     P2H_TIMEOUT="$(command -v timeout)"
   else
     echo 'ERROR  P2-H AST gates require GNU coreutils timeout (gtimeout on macOS)' >&2
     exit 1
   fi
   p2h_ast_run 190 "$P2H_TIMEOUT" --foreground --signal=TERM --kill-after=5s 180s \
     npm --prefix templates/docbuild ci --ignore-scripts --no-audit --no-fund >/dev/null
   p2h_ast_run 30 node - <<'NODE'
   const assert = require("node:assert/strict");
   const lock = require("./templates/docbuild/package-lock.json");
   const installed = require("./templates/docbuild/node_modules/typescript/package.json");
   assert.equal(installed.version, lock.packages["node_modules/typescript"].version);
   NODE
   p2h_ast_run 120 node <<'NODE'
   const assert = require("node:assert/strict");
   const {readdirSync} = require("node:fs");
   const {posix} = require("node:path");
   const ts = require("./templates/docbuild/node_modules/typescript/lib/typescript.js");
   const paths = [];
   const scan = (dir) => { for (const e of readdirSync(dir, {withFileTypes: true})) {
     const path = `${dir}/${e.name}`;
     if (e.isDirectory()) scan(path); else if (/\.(mjs|ts)$/.test(e.name)) paths.push(path);
   }};
   scan("netlify");
   const program = ts.createProgram(paths, {allowJs: true, module: ts.ModuleKind.ESNext,
     noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.Latest});
   const checker = program.getTypeChecker();
   const trees = new Map(paths.map((path) => {
     const tree = program.getSourceFile(path); assert(tree, `cannot parse ${path}`); return [path, tree];
   }));
   const consumers = new Set([
     "netlify/edge-functions/gate.ts",
     "netlify/functions/realtime-token.mjs",
     "netlify/functions/session.mjs",
   ]);
   const walk = (node, fn) => { fn(node); ts.forEachChild(node, (child) => walk(child, fn)); };
   const target = (from, source) => source.startsWith(".")
     ? posix.normalize(posix.join(posix.dirname(from), source)) : null;
   const unwrap = (node) => {
     while (node && (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ||
            ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node))) node = node.expression;
     return node;
   };
   const symbolAt = (node) => (node = unwrap(node), node && ts.isIdentifier(node)
     ? checker.getSymbolAtLocation(node) : null);
   const imported = (tree, source, name) => {
     const found = [];
     for (const node of tree.statements) if (ts.isImportDeclaration(node) &&
         ts.isStringLiteralLike(node.moduleSpecifier) && node.moduleSpecifier.text === source &&
         node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
       for (const specifier of node.importClause.namedBindings.elements) {
         if ((specifier.propertyName ?? specifier.name).text === name) {
           assert(!node.importClause.isTypeOnly && !specifier.isTypeOnly); found.push(specifier.name);
         }
       }
     }
     assert.equal(found.length, 1, `${tree.fileName} must import ${name} once from ${source}`);
     const symbol = checker.getSymbolAtLocation(found[0]);
     assert(symbol, `TypeScript must bind ${name} in ${tree.fileName}`);
     return symbol;
   };
   const oneCall = (tree, symbol, label) => {
     const calls = []; walk(tree, (node) => {
       if (ts.isCallExpression(node) && symbolAt(node.expression) === symbol) calls.push(node);
     });
     assert.equal(calls.length, 1, `${tree.fileName} must call imported ${label} once`);
     return calls[0];
   };
   const result = (tree, call, label) => {
     const names = []; walk(tree, (node) => {
       if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && unwrap(node.initializer) === call) {
         names.push(node.name);
       }
     });
     assert.equal(names.length, 1, `${tree.fileName} must directly bind ${label}`);
     const symbol = checker.getSymbolAtLocation(names[0]); assert(symbol); return symbol;
   };
   const properties = (tree, symbol) => {
     const names = new Set();
     walk(tree, (node) => {
       if (ts.isPropertyAccessExpression(node) && symbolAt(node.expression) === symbol) names.add(node.name.text);
       if (ts.isElementAccessExpression(node) && symbolAt(node.expression) === symbol) {
         assert(ts.isStringLiteralLike(node.argumentExpression), `${tree.fileName} uses a dynamic audited key`);
         names.add(node.argumentExpression.text);
       }
       if (ts.isVariableDeclaration(node) && node.initializer && symbolAt(node.initializer) === symbol)
         assert.fail(`${tree.fileName} aliases an audited result`);
       if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
           symbolAt(node.right) === symbol) assert.fail(`${tree.fileName} assigns an audited alias`);
     });
     return names;
   };
   const inspect = (path, accessFields, consumeInvitation) => {
     const tree = trees.get(path);
     assert(tree, `release-train source is missing: ${path}`);
     const person = result(tree, oneCall(tree, imported(tree, "../lib/identity.mjs", "identify"),
       "identify"), "identify()");
     for (const field of properties(tree, person)) {
       assert(["sub", "email", "name", "isOrg"].includes(field),
         `${path} reads removed identity field ${field}`);
     }
     const accessCall = oneCall(tree, imported(tree, "../lib/access.mjs", "resolveRole"), "resolveRole");
     assert(symbolAt(accessCall.arguments[1]) === person,
       `${path} must pass the actual identify() result to resolveRole()`);
     assert.equal(accessCall.arguments.length, consumeInvitation ? 3 : 2,
       `${path} has the wrong resolveRole() arity`);
     if (consumeInvitation) {
       const options = accessCall.arguments[2];
       assert(ts.isObjectLiteralExpression(options), `${path} must use a literal invitation option`);
       assert.equal(options.properties.length, 1, `${path} must use one resolve option`);
       const property = options.properties[0];
       assert(ts.isPropertyAssignment(property) && property.name.getText(tree) === "consumeInvitation" &&
         property.initializer.kind === ts.SyntaxKind.TrueKeyword,
       `${path} must pass { consumeInvitation: true }`);
     }
     const fields = properties(tree, result(tree, accessCall, "resolveRole()"));
     for (const field of accessFields) assert(fields.has(field), `${path} must consume access.${field}`);
   };

   for (const [path, tree] of trees) {
     let importsIdentify = false;
     for (const node of tree.statements) {
       if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) &&
           target(path, node.moduleSpecifier.text) === "netlify/lib/identity.mjs") {
         assert(!node.importClause?.name, `${path} must not default-import the identity helper`);
         assert(!node.importClause?.namedBindings ||
           !ts.isNamespaceImport(node.importClause.namedBindings),
           `${path} must not namespace-import the identity helper`);
         if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
           importsIdentify ||= node.importClause.namedBindings.elements.some(
             (specifier) => (specifier.propertyName ?? specifier.name).text === "identify",
           );
         }
       }
       if (ts.isExportDeclaration(node) && node.moduleSpecifier &&
           ts.isStringLiteralLike(node.moduleSpecifier) &&
           target(path, node.moduleSpecifier.text) === "netlify/lib/identity.mjs")
         assert.fail(`${path} must not re-export the identity helper`);
     }
     if (importsIdentify) assert(consumers.has(path), `${path} is an undeclared direct identify() importer`);
   }
   inspect("netlify/functions/session.mjs", [
     "role", "shared", "canComment", "canSuggest", "canEdit",
     "canAccept", "canShare", "canSeeMembers",
   ], true);
   inspect("netlify/functions/realtime-token.mjs", ["canRead"], false);

   const gatePath = "netlify/edge-functions/gate.ts";
   const gateTree = trees.get(gatePath);
   assert(gateTree, `release-train source is missing: ${gatePath}`);
   const gatePerson = result(gateTree, oneCall(gateTree,
     imported(gateTree, "../lib/identity.mjs", "identify"), "identify"), "identify()");
   assert.deepEqual([...properties(gateTree, gatePerson)].sort(), ["isOrg", "roles"]);
   const name = gatePerson.getName();
   const exact = `typeof ${name}.isOrg === "boolean" ? ${name}.isOrg : ` +
     `Array.isArray(${name}.roles) && ${name}.roles.includes("member")`;
   const predicates = [];
   walk(gateTree, (node) => {
     if (ts.isConditionalExpression(node) && node.getText(gateTree).replace(/\s+/g, " ") === exact)
       predicates.push(node);
   });
   assert.equal(predicates.length, 1, "gate must contain the exact authoritative-isOrg compatibility predicate once");
   console.log("PASS  P2-H integrated consumer and transitional-gate AST audit");
   NODE
   BASH
   ```

   Expected: exit `0` and exactly `PASS  P2-H integrated consumer and transitional-gate AST audit`. Its install, version check, and AST program use the same finite detached-group supervision and no-reuse-on-uncertainty rule as step 2. Among direct static imports from `identity.mjs`, only the three declared consumers import `identify()`. Session and realtime directly bind one identity result, pass that binding to the actual resolver, make no directly bound removed-field read or simple alias, and directly read their owned access fields. The exceptional gate's directly bound identity reads are exactly `isOrg`/`roles`, and its source contains the exact conditional once. This gate makes no transitive wrapper, local-re-export, authorization-control, raw-email, or suffix-classification claim. Before release, the integration owner records a manual review of every local re-export, dynamic local import, wrapper parameter, object-container transfer, and indirect identity caller that this direct AST gate deliberately excludes; any identity-based authority decision found there blocks release. P2-A owns predicate behavior against its projected legacy/final shapes; P2-H step 1 owns the stronger raw-email suffix, collision, and whitespace cases; P2-F and P3-H own their access-controlled behavior. Step 4 executes those reviewed owning proofs.

4. As a **release-train gate**, execute the owning source-bound runtime fixtures from the combined P2-A/P2-F/P3-H integration tree. P2-A's existing local gate matrix already contains `# P2-A gate compatibility source fixture`; P2-F retains `# P2-F runtime authority fixture`; P3-H supplies `# P3-H runtime authority fixture`. Each marker is one exact standalone line in exactly one Bash fence whose own acceptance contract binds and executes its real production source. While `P2H_OWNER_NONCE` is present, every marked owner fixture must keep all children in the inherited anchor process group: it must not invoke `setsid`, double-fork, daemonize, spawn with `detached: true`, or close inherited supervision pipes before its descendants finish. A ticket may use a detached watchdog only in its separate standalone mode; its P2-H release-fixture path must use this inherited supervisor. P2-H is the canonical live owner for both P2-A and P2-F: it exports the 32-hex HMAC key in `P2H_OWNER_NONCE`, the child-writable request descriptor as `P2H_OWNER_REQUEST_FD=5`, and the child-readable response descriptor as `P2H_OWNER_RESPONSE_FD=4`. Version-1 newline-delimited JSON `claim`, `reserve`, `interrupt`, and `release` requests and their `${action}-ack` responses carry a lower-case SHA-256 HMAC over `JSON.stringify()` of the object without `mac`; acknowledgements echo every request field. `claim-ack` additionally publishes the live external `ownerPid`, direct anchor `anchorPgid`, absolute `ownerRoot`, and a bounded `leaseDeadlineMs`. A reservation is limited to one absent direct P2-A `p2-a-*.` or P2-F `p2f.` six-alphanumeric child of `ownerRoot` plus its exact sibling `.${basename}.evidence.json`; `release-ack` is withheld until a bounded, reaped direct deletion worker has proved both absent. The anchor keeps P2-H's independent fd 3 `READY`/`DONE` and fd 4 `RELEASE` boundary; only the inner fixture receives the owner service remapped onto fd 5/4. The launcher below is intentionally only an exact fixture locator/executor; it does not parse Bash or independently infer source binding or the no-daemonization precondition from tokens. Those properties are mandatory owning-ticket source-review items. Source binding, non-vacuous assertions, no hard-coded PASS, and behavioral coverage are requirements of each owning ticket and fixture:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   node <<'NODE'
   const assert = require("node:assert/strict");
   const {execFileSync, spawn, spawnSync} = require("node:child_process");
   const {
     chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, renameSync,
     statSync, writeFileSync,
   } = require("node:fs");
   const {createHmac, randomBytes, timingSafeEqual} = require("node:crypto");
   const {tmpdir} = require("node:os");
   const {basename, dirname, join} = require("node:path");
   const MAX_OUTPUT_BYTES = 1024 * 1024;
   const FIXTURE_TIMEOUT_MS = 120_000;
   const LAUNCH_TIMEOUT_MS = 2_000;
   const TERM_GRACE_MS = 2_000;
   const KILL_GRACE_MS = 2_000;
   const DELETE_TIMEOUT_MS = 10_000;
   const POLL_MS = 25;
   const SIGNAL_STATUS = Object.freeze({
     SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137,
   });
   const TMP_PARENT = realpathSync(tmpdir());
   assert.ok(TMP_PARENT.startsWith("/") && TMP_PARENT !== "/");
   const SELF_TEST_ONLY = process.argv.includes("--p2-h-supervisor-self-test-only") ||
     process.env.P2H_SUPERVISOR_SELF_TEST_ONLY === "1";
   let manualEvidencePath;

   const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
   const deferred = () => {
     let resolve;
     const promise = new Promise((done) => { resolve = done; });
     return {promise, resolve};
   };
   const within = async (promise, milliseconds) => Promise.race([
     promise.then((value) => ({complete: true, value})),
     delay(milliseconds).then(() => ({complete: false})),
   ]);

   function createSignalLatch() {
     const event = deferred();
     let signal;
     return {
       raise(next) { if (signal === undefined) { signal = next; event.resolve(next); } },
       wait: event.promise,
       get signal() { return signal; },
     };
   }

   function installSignalHandlers(target, latch) {
     const handlers = new Map();
     for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
       const handler = () => {
         if (latch.signal !== undefined) return;
         latch.raise(signal);
         target.exitCode = SIGNAL_STATUS[signal];
       };
       handlers.set(signal, handler);
       target.on(signal, handler);
     }
     return handlers;
   }

   const externalSignals = createSignalLatch();
   let externalSignalHandlers = installSignalHandlers(process, externalSignals);
   function removeSignalHandlers(target, handlers) {
     for (const [signal, handler] of handlers) target.off(signal, handler);
   }
   const signalStatus = (latch, fallback) => SIGNAL_STATUS[latch.signal] ?? fallback;
   async function exitWithSignalAuthority(latch, fallback) {
     await delay(0);
     await new Promise((resolve) => setImmediate(resolve));
     process.exit(signalStatus(latch, fallback));
   }

   const safeTemporaryRoot = (root, prefix) => typeof root === "string" &&
     dirname(root) === TMP_PARENT &&
     new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[A-Za-z0-9]{6}$`)
       .test(root.slice(TMP_PARENT.length + 1));

   function retainEvidence(details, io = {
     chmodSync, mkdtempSync, realpathSync, renameSync, statSync, writeFileSync,
   }) {
     let root;
     let path;
     try {
       root = io.mkdtempSync(join(TMP_PARENT, "p2-h-supervisor-evidence."));
       assert.equal(safeTemporaryRoot(root, "p2-h-supervisor-evidence"), true);
       io.chmodSync(root, 0o700);
       assert.equal(io.realpathSync(root), root);
       path = join(root, "manual-remediation.json");
       const pending = `${path}.new`;
       io.writeFileSync(pending, `${JSON.stringify({
         version: 1,
         recordedAt: new Date().toISOString(),
         ...details,
       }, null, 2)}\n`, {mode: 0o600});
       io.chmodSync(pending, 0o600);
       io.renameSync(pending, path);
       io.chmodSync(path, 0o600);
       assert.equal(io.statSync(path).mode & 0o777, 0o600);
       manualEvidencePath = path;
       return path;
     } catch {
       const ownerPid = Number.isSafeInteger(details.ownerPid) && details.ownerPid > 1
         ? details.ownerPid : "not-applicable";
       const ownerPgid = Number.isSafeInteger(details.ownerPgid) && details.ownerPgid > 1
         ? details.ownerPgid : "not-applicable";
       const locator = path ?? root ?? TMP_PARENT;
       const ownedRoot = safeTemporaryRoot(details.ownedFixtureRoot,
         "p2-h-owned-fixture") ? details.ownedFixtureRoot : "not-applicable";
       console.error(`ERROR  P2-H evidence persistence failed; owner PID/PGID ${ownerPid}/${ownerPgid}; owned-root=${ownedRoot}; attempted=${locator}; parent=${TMP_PARENT}`);
       return null;
     }
   }

   function validatedOwnedRoot() {
     const root = mkdtempSync(join(TMP_PARENT, "p2-h-owned-fixture."));
     assert.equal(safeTemporaryRoot(root, "p2-h-owned-fixture"), true);
     chmodSync(root, 0o700);
     const stats = lstatSync(root);
     assert.equal(stats.isDirectory(), true);
     assert.equal(stats.isSymbolicLink(), false);
     assert.equal(realpathSync(root), root);
     return root;
   }

   function groupAlive(pgid) {
     assert(Number.isSafeInteger(pgid) && pgid > 1, "unsafe process-group id");
     try { process.kill(-pgid, 0); return true; }
     catch (error) {
       if (error?.code === "ESRCH") return false;
       if (error?.code === "EPERM") return true;
       throw error;
     }
   }

   async function groupGone(pgid, milliseconds) {
     const deadline = Date.now() + milliseconds;
     while (groupAlive(pgid) && Date.now() < deadline) await delay(POLL_MS);
     return !groupAlive(pgid);
   }

   async function removeOwnedRoot(root) {
     if (!safeTemporaryRoot(root, "p2-h-owned-fixture")) {
       const evidencePath = retainEvidence({
         reason: "unsafe-owned-root", ownerPid: process.pid, ownerPgid: process.pid,
         ownedFixtureRoot: root,
       });
       return {complete: false, evidencePath};
     }
     const stats = lstatSync(root);
     if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(root) !== root) {
       const evidencePath = retainEvidence({
         reason: "invalid-owned-root", ownerPid: process.pid, ownerPgid: process.pid,
         ownedFixtureRoot: root,
       });
       return {complete: false, evidencePath};
     }
     const source = String.raw`
       const {rmSync} = require("node:fs");
       rmSync(process.argv[1], {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
     `;
     let worker;
     try {
       worker = spawn(process.execPath, ["-e", source, root], {
         detached: false, stdio: "ignore",
       });
     } catch {
       const evidencePath = retainEvidence({
         reason: "owned-root-deletion-spawn", ownerPid: process.pid,
         ownerPgid: process.pid, ownedFixtureRoot: root,
       });
       return {complete: false, evidencePath};
     }
     const workerPid = worker.pid;
     let workerResult;
     const exited = new Promise((resolve) => {
       worker.once("error", () => { workerResult = {kind: "error"}; resolve(workerResult); });
       worker.once("exit", (code, signal) => {
         workerResult = {kind: "exit", code, signal}; resolve(workerResult);
       });
     });
     if (!Number.isSafeInteger(workerPid) || workerPid <= 1) {
       worker.unref();
       const evidencePath = retainEvidence({
         reason: "owned-root-deletion-ownership", ownerPid: workerPid, ownerPgid: null,
         ownedFixtureRoot: root,
       });
       return {complete: false, evidencePath};
     }
     const first = await Promise.race([
       exited.then(() => "exit"), delay(DELETE_TIMEOUT_MS).then(() => "timeout"),
     ]);
     if (first === "timeout") {
       try {
         if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
       } catch {}
     }
     const reaped = (await within(exited, KILL_GRACE_MS)).complete;
     let absent = false;
     try { lstatSync(root); } catch (error) { absent = error?.code === "ENOENT"; }
     if (first === "exit" && reaped && absent &&
         workerResult?.kind === "exit" && workerResult.code === 0 && workerResult.signal === null) {
       return {complete: true};
     }
     if (!reaped) {
       try { worker.removeAllListeners(); worker.unref(); } catch {}
     }
     const evidencePath = retainEvidence({
       reason: first === "timeout" ? "owned-root-deletion-timeout" : "owned-root-deletion-failed",
       ownerPid: workerPid, ownerPgid: null, ownedFixtureRoot: root,
       deletionWorkerReaped: reaped,
     });
     return {complete: false, evidencePath};
   }

   function groupMembers(pid) {
     assert(Number.isSafeInteger(pid) && pid > 1, "unsafe fixture owner PID");
     const rows = execFileSync("ps", ["-axo", "pid=,pgid="], {
       encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024,
     });
     return rows.split("\n").map((row) => row.trim().split(/\s+/).map(Number))
       .filter(([member, group]) => Number.isSafeInteger(member) && group === pid)
       .map(([member]) => member).sort((a, b) => a - b);
   }

   const ownerMac = (nonce, value) => createHmac("sha256", Buffer.from(nonce, "hex"))
     .update(JSON.stringify(value)).digest("hex");
   const pathAbsent = (path) => {
     try { lstatSync(path); return false; }
     catch (error) { return error?.code === "ENOENT"; }
   };
   const exactOwnerReservation = (ownerRoot, guardedRoot, evidencePath) =>
     typeof guardedRoot === "string" && dirname(guardedRoot) === ownerRoot &&
     /^(?:p2-a-[A-Za-z0-9-]*|p2f)\.[A-Za-z0-9]{6}$/.test(basename(guardedRoot)) &&
     evidencePath === join(ownerRoot, `.${basename(guardedRoot)}.evidence.json`);

   async function deleteOwnerReservation(guardedRoot, evidencePath) {
     const source = String.raw`
       const {rmSync} = require("node:fs");
       for (const path of process.argv.slice(1))
         rmSync(path, {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
     `;
     let worker;
     try {
       worker = spawn(process.execPath, ["-e", source, guardedRoot, evidencePath], {
         stdio: "ignore",
       });
     } catch {
       return {complete: false, workerPid: null, reaped: true, outcome: "spawn-threw"};
     }
     let outcome;
     const exited = new Promise((resolve) => {
       worker.once("error", () => { outcome = {kind: "error"}; resolve(outcome); });
       worker.once("exit", (code, signal) => {
         outcome = {kind: "exit", code, signal}; resolve(outcome);
       });
     });
     const first = await Promise.race([
       exited.then(() => "exit"), delay(DELETE_TIMEOUT_MS).then(() => "timeout"),
     ]);
     if (first === "timeout") {
       try {
         if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
       } catch {}
     }
     const reaped = (await within(exited, KILL_GRACE_MS)).complete;
     if (!reaped) {
       try { worker.removeAllListeners(); worker.unref(); } catch {}
     }
     return {complete: first === "exit" && reaped && outcome?.kind === "exit" &&
       outcome.code === 0 && outcome.signal === null &&
       pathAbsent(guardedRoot) && pathAbsent(evidencePath),
       workerPid: worker.pid, reaped, outcome: outcome ?? first};
   }

   function createOwnerService({child, nonce, ownerRoot, fail, ownerReleaseFailed}) {
     const counts = {claims: 0, reserves: 0, interrupts: 0, releases: 0};
     let lease;
     let reservation;
     let input = "";
     let queue = Promise.resolve();
     const requests = child.stdio[6];
     const responses = child.stdio[5];
     const reject = () => {
       fail("owner-protocol-error");
       try { responses.destroy(); } catch {}
       try { requests.destroy(); } catch {}
     };
     const reply = (request, extra = {}) => {
       const {mac: ignored, ...signedRequest} = request;
       const unsigned = {...signedRequest, action: `${request.action}-ack`, ...extra};
       responses.write(`${JSON.stringify({...unsigned, mac: ownerMac(nonce, unsigned)})}\n`);
     };
     const verify = (request) => {
       assert(request && typeof request === "object" && !Array.isArray(request));
       const {mac, ...unsigned} = request;
       assert.equal(request.version, 1);
       assert.match(request.challenge, /^[0-9a-f]{32}$/);
       assert(Number.isSafeInteger(request.childPid) && request.childPid > 1);
       assert.equal(typeof mac, "string");
       const actual = Buffer.from(mac, "hex");
       const expected = Buffer.from(ownerMac(nonce, unsigned), "hex");
       assert.equal(actual.length, expected.length);
       assert(timingSafeEqual(actual, expected));
       assert(groupMembers(child.pid).includes(request.childPid));
       return unsigned;
     };
     const verifyLease = (request) => {
       assert(lease && request.challenge === lease.challenge && request.childPid === lease.childPid);
       assert.equal(request.anchorPgid, child.pid);
       assert.equal(request.guardedRoot, reservation?.guardedRoot ?? request.guardedRoot);
       assert.equal(request.evidencePath, reservation?.evidencePath ?? request.evidencePath);
     };
     const handle = async (line) => {
       assert(line.length > 0 && line.length <= 16 * 1024);
       const request = JSON.parse(line);
       verify(request);
       if (request.action === "claim") {
         assert.deepEqual(Object.keys(request).sort(),
           ["action", "challenge", "childPid", "mac", "version"].sort());
         assert.equal(lease, undefined);
         assert.notEqual(process.pid, child.pid);
         lease = {challenge: request.challenge, childPid: request.childPid,
           deadline: Date.now() + 119_000};
         counts.claims += 1;
         reply(request, {ownerPid: process.pid, anchorPgid: child.pid,
           ownerRoot, leaseDeadlineMs: lease.deadline});
         return;
       }
       assert(["reserve", "interrupt", "release"].includes(request.action));
       assert(Date.now() < lease.deadline);
       assert.deepEqual(Object.keys(request).sort(), [
         "action", "anchorPgid", "challenge", "childPid", "evidencePath",
         "guardedRoot", "mac", "version",
       ].sort());
       if (request.action === "reserve") {
         assert(lease && request.challenge === lease.challenge && request.childPid === lease.childPid);
         assert.equal(request.anchorPgid, child.pid);
         assert.equal(reservation, undefined);
         assert(exactOwnerReservation(ownerRoot, request.guardedRoot, request.evidencePath));
         assert(pathAbsent(request.guardedRoot) && pathAbsent(request.evidencePath));
         reservation = {guardedRoot: request.guardedRoot, evidencePath: request.evidencePath};
         counts.reserves += 1;
         reply(request);
         return;
       }
       verifyLease(request);
       assert(reservation);
       if (request.action === "interrupt") {
         counts.interrupts += 1;
         reply(request);
         return;
       }
       const deletion = await deleteOwnerReservation(
         reservation.guardedRoot, reservation.evidencePath);
       if (!deletion.complete) {
         ownerReleaseFailed(deletion);
         throw new Error("owner release deletion failed");
       }
       counts.releases += 1;
       reply(request);
       reservation = undefined;
       lease = undefined;
     };
     requests.setEncoding("utf8");
     requests.on("data", (chunk) => {
       input += chunk;
       if (input.length > 32 * 1024) return reject();
       while (input.includes("\n")) {
         const index = input.indexOf("\n");
         const line = input.slice(0, index);
         input = input.slice(index + 1);
         queue = queue.then(() => handle(line)).catch(reject);
       }
     });
     requests.on("end", () => { if (input.length !== 0) reject(); });
     requests.on("error", reject);
     responses.on("error", (error) => { if (error?.code !== "EPIPE") reject(); });
     return {snapshot: () => ({...counts})};
   }

   const ANCHOR = String.raw`
   set -u
   trap ':' HUP INT TERM
   owner_pid=$$
   owner_pgid=$(ps -o pgid= -p "$owner_pid" | tr -d '[:space:]')
   test "$owner_pid" = "$owner_pgid" || exit 125
   printf 'READY %s %s\n' "$P2H_OWNER_NONCE" "$owner_pid" >&3
   set +e
   bash -seu -o pipefail 4<&5 5>&6 3>&- 6>&-
   fixture_status=$?
   set -e
   exec 5<&- 6>&-
   printf 'DONE %s %s %s\n' "$P2H_OWNER_NONCE" "$owner_pid" "$fixture_status" >&3 || exit 125
   while IFS= read -r command <&4; do
     if test "$command" = "RELEASE $P2H_OWNER_NONCE"; then exit "$fixture_status"; fi
   done
   exit 125
   `;

   async function supervise(block, options = {}) {
     assert(["darwin", "linux"].includes(process.platform),
       "release fixture launcher requires macOS or Linux");
     const nonce = randomBytes(16).toString("hex");
     const timeoutMs = options.timeoutMs ?? FIXTURE_TIMEOUT_MS;
     const termGraceMs = options.termGraceMs ?? TERM_GRACE_MS;
     const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
     const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
     const signalLatch = options.signalLatch ?? externalSignals;
     const executable = options.executable ?? "bash";
     const stageHook = options.stageHook ?? (async () => {});
     await stageHook("early");
     await delay(0);
     if (signalLatch.signal !== undefined) {
       return {code: null, signal: null, stdout: "", stderr: "",
         failure: `external-signal:${signalLatch.signal}`, ownedFixtureRoot: null,
         cleanup: {complete: true, groupDisappeared: true, rootRemoved: true, signals: []}};
     }
     const ownedFixtureRoot = validatedOwnedRoot();
     const child = spawn(executable, ["-c", ANCHOR], {
       cwd: process.cwd(), detached: true,
       env: {...process.env, TMPDIR: ownedFixtureRoot, P2H_OWNER_NONCE: nonce,
         P2H_OWNER_REQUEST_FD: "5", P2H_OWNER_RESPONSE_FD: "4"},
       stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
     });
     const ready = deferred();
     const done = deferred();
     const failed = deferred();
     const spawnFailed = deferred();
     let failure;
     const fail = (reason) => {
       if (failure === undefined) {
         failure = reason;
         failed.resolve(reason);
       }
     };
     const capture = (stream, label) => {
       const chunks = [];
       let bytes = 0;
       stream.on("data", (chunk) => {
         if (bytes + chunk.length > maxOutputBytes) {
           fail(`${label}-limit`);
           return;
         }
         chunks.push(chunk);
         bytes += chunk.length;
       });
       stream.on("error", () => fail(`${label}-error`));
       return () => Buffer.concat(chunks, bytes).toString("utf8");
     };
     const stdout = capture(child.stdout, "stdout");
     const stderr = capture(child.stderr, "stderr");
     child.stdin.on("error", (error) => {
       if (error?.code !== "EPIPE") fail("stdin-error");
     });
     child.stdio[3].on("error", () => fail("protocol-error"));
     child.stdio[4].on("error", (error) => {
       if (error?.code !== "EPIPE") fail("control-error");
     });
     let ownerReleaseFailure;
     const ownerService = createOwnerService({
       child, nonce, ownerRoot: ownedFixtureRoot, fail,
       ownerReleaseFailed(details) { ownerReleaseFailure ??= details; },
     });
     let exitedResult;
     const exited = new Promise((resolve) => child.once("exit", (code, signal) => {
       exitedResult = {code, signal};
       resolve(exitedResult);
     }));
     const closed = new Promise((resolve) => child.once("close", resolve));
     child.once("error", (error) => {
       const reason = error?.code === "ENOENT" ? "spawn-error" : "launch-error";
       fail(reason);
       spawnFailed.resolve(reason);
     });
     const detachHandles = () => {
       child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
       child.stdio[3].destroy(); child.stdio[4].destroy();
       child.stdio[5].destroy(); child.stdio[6].destroy(); child.unref();
     };
     const completeWithOwnedRootRemoval = async (result) => {
       if (ownerReleaseFailure) {
         detachHandles();
         const evidencePath = retainEvidence({
           reason: "owner-release-deletion-unproved", ownerPid: child.pid,
           ownerPgid: child.pid, ownedFixtureRoot, ownerReleaseFailure,
         });
         return {...result, ownedFixtureRoot, ownerProtocol: ownerService.snapshot(),
           failure: "manual-remediation", evidencePath,
           cleanup: {...result.cleanup, complete: false, rootRemoved: false}};
       }
       if (options.postDetachEvidenceIo) {
         detachHandles();
         const evidencePath = retainEvidence({
           reason: "post-detach-evidence-persistence-self-test", ownerPid: child.pid,
           ownerPgid: child.pid, ownedFixtureRoot,
         }, options.postDetachEvidenceIo);
         return {...result, ownerPid: child.pid, ownerPgid: child.pid,
           ownedFixtureRoot, ownerProtocol: ownerService.snapshot(),
           failure: "manual-remediation", evidencePath,
           cleanup: {...result.cleanup, complete: false, rootRemoved: false}};
       }
       let deletion;
       try { deletion = await removeOwnedRoot(ownedFixtureRoot); }
       catch {
         const evidencePath = retainEvidence({
           reason: "owned-root-deletion-error", ownerPid: child.pid,
           ownerPgid: child.pid, ownedFixtureRoot,
         });
         deletion = {complete: false, evidencePath};
       }
       if (!deletion.complete) {
         return {...result, ownedFixtureRoot, ownerProtocol: ownerService.snapshot(),
           failure: "manual-remediation",
           evidencePath: deletion.evidencePath,
           cleanup: {...result.cleanup, complete: false, rootRemoved: false}};
       }
       return {...result, ownedFixtureRoot, ownerProtocol: ownerService.snapshot(),
         cleanup: {...result.cleanup, complete: true, rootRemoved: true}};
     };

     let protocol = "";
     child.stdio[3].setEncoding("utf8");
     child.stdio[3].on("data", (chunk) => {
       protocol += chunk;
       if (protocol.length > 4096) return fail("protocol-limit");
       while (protocol.includes("\n")) {
         const index = protocol.indexOf("\n");
         const line = protocol.slice(0, index);
         protocol = protocol.slice(index + 1);
         const readyMatch = /^READY ([0-9a-f]{32}) ([0-9]+)$/.exec(line);
         const doneMatch = /^DONE ([0-9a-f]{32}) ([0-9]+) ([0-9]+)$/.exec(line);
         if (readyMatch && readyMatch[1] === nonce && Number(readyMatch[2]) === child.pid) {
           ready.resolve(true);
         } else if (doneMatch && doneMatch[1] === nonce && Number(doneMatch[2]) === child.pid) {
           done.resolve(Number(doneMatch[3]));
         } else {
           fail("protocol-error");
         }
       }
     });

     const pid = child.pid;
     const launch = await Promise.race([
       ready.promise.then(() => "ready"),
       spawnFailed.promise,
       failed.promise.then(() => "failure"),
       exited.then(() => "exit"),
       signalLatch.wait.then(() => "external-signal"),
       delay(options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS).then(() => "launch-timeout"),
     ]);
     if (launch !== "ready") {
       child.stdin.destroy();
       child.stdio[4].destroy();
       child.stdio[5].destroy(); child.stdio[6].destroy();
       const closeResult = await within(closed, KILL_GRACE_MS);
       if (launch === "spawn-error" || (!Number.isSafeInteger(pid) && closeResult.complete)) {
         return completeWithOwnedRootRemoval({
           code: null, signal: null, stdout: stdout(), stderr: stderr(),
           failure: failure ?? launch, cleanup: {complete: true, signals: []},
         });
       }
       detachHandles();
       const evidencePath = retainEvidence({reason: failure ?? launch,
         ownerPid: Number.isSafeInteger(pid) ? pid : null,
         ownerPgid: Number.isSafeInteger(pid) ? pid : null,
         ownedFixtureRoot, ownershipConfirmed: false});
       return {code: null, signal: null, stdout: stdout(), stderr: stderr(),
         ownedFixtureRoot, failure: "manual-remediation", evidencePath,
         cleanup: {complete: false, signals: []}};
     }
     let anchorOwnershipPublished = false;
     try {
       anchorOwnershipPublished = !exitedResult && child.exitCode === null &&
         child.signalCode === null && Number.isSafeInteger(pid) && pid > 1 &&
         child.pid === pid && groupMembers(pid).includes(pid);
     } catch {}
     if (!anchorOwnershipPublished) {
       child.stdin.destroy(); child.stdio[4].destroy();
       child.stdio[5].destroy(); child.stdio[6].destroy();
       const closeResult = await within(closed, KILL_GRACE_MS);
       let disappeared = false;
       try { disappeared = closeResult.complete && await groupGone(pid, KILL_GRACE_MS); }
       catch {}
       if (closeResult.complete && disappeared) return completeWithOwnedRootRemoval({
         code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
         stdout: stdout(), stderr: stderr(), failure: "launch-ownership-unproved",
         cleanup: {complete: true, groupDisappeared: true, signals: []},
       });
       detachHandles();
       const evidencePath = retainEvidence({reason: "launch-ownership-unproved",
         ownerPid: Number.isSafeInteger(pid) ? pid : null,
         ownerPgid: Number.isSafeInteger(pid) ? pid : null,
         ownedFixtureRoot, ownershipConfirmed: false});
       return {code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
         stdout: stdout(), stderr: stderr(), ownedFixtureRoot,
         ownerProtocol: ownerService.snapshot(), failure: "manual-remediation", evidencePath,
         cleanup: {complete: false, signals: []}};
     }
     child.stdin.end(block);
     await stageHook("active");

     const first = await Promise.race([
       done.promise.then(() => "done"),
       failed.promise.then(() => "failure"),
       exited.then(() => "owner-exit"),
       signalLatch.wait.then(() => "external-signal"),
       delay(timeoutMs).then(() => "timeout"),
     ]);
     if (first === "timeout") fail("timeout");
     if (first === "external-signal") fail(`external-signal:${signalLatch.signal}`);
     if (first === "owner-exit") fail("ownership-lost");
     if (first === "done") await stageHook("post-DONE");
     if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
     await stageHook("cleanup");

     const signals = [];
     const evidence = (reason, members = []) => {
       detachHandles();
       const evidencePath = retainEvidence({reason, ownerPid: pid, ownerPgid: pid, nonce,
         ownedFixtureRoot,
         ownershipConfirmed: true, lastObservedGroupMembers: members, signals});
       return {code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
         stdout: stdout(), stderr: stderr(), ownedFixtureRoot,
         ownerProtocol: ownerService.snapshot(),
         failure: "manual-remediation", evidencePath,
         cleanup: {complete: false, signals}};
     };
     const ownedMembers = () => {
       if (exitedResult || child.exitCode !== null || child.signalCode !== null ||
           !Number.isSafeInteger(pid) || pid <= 1 || child.pid !== pid)
         throw new Error("ownership-lost");
       const members = groupMembers(pid);
       if (!members.includes(pid)) throw new Error("ownership-lost");
       if (exitedResult || child.exitCode !== null || child.signalCode !== null)
         throw new Error("ownership-lost");
       return members;
     };
     const signalOwnedGroup = (signal) => {
       const members = ownedMembers();
       process.kill(-pid, signal);
       signals.push(signal);
       return members;
     };
     const waitForOnlyAnchor = async (milliseconds) => {
       const deadline = Date.now() + milliseconds;
       while (true) {
         const members = ownedMembers();
         if (members.length === 1) return {onlyAnchor: true, members};
         if (Date.now() >= deadline) return {onlyAnchor: false, members};
         await delay(POLL_MS);
       }
     };

     let observed;
     try {
       observed = ownedMembers();
       if (observed.length > 1) {
         signalOwnedGroup("SIGTERM");
         const afterTerm = await waitForOnlyAnchor(termGraceMs);
         observed = afterTerm.members;
         if (!afterTerm.onlyAnchor) {
           signalOwnedGroup("SIGKILL");
           child.stdio[4].destroy();
           const exitAfterKill = await within(exited, killGraceMs);
           const closeAfterKill = await within(closed, killGraceMs);
           let disappeared = false;
           try {
             disappeared = exitAfterKill.complete && closeAfterKill.complete &&
               await groupGone(pid, killGraceMs);
           } catch {}
           if (!exitAfterKill.complete || !closeAfterKill.complete || !disappeared) {
             return evidence("group-survived-sigkill", observed);
           }
           await stageHook("post-result");
           if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
           return completeWithOwnedRootRemoval({
             ...exitedResult, stdout: stdout(), stderr: stderr(), failure,
             cleanup: {complete: true, groupDisappeared: true, signals},
           });
         }
       }
       child.stdio[4].end(`RELEASE ${nonce}\n`);
       const exitAfterRelease = await within(exited, killGraceMs);
       const closeAfterRelease = await within(closed, killGraceMs);
       let disappeared = false;
       try {
         disappeared = exitAfterRelease.complete && closeAfterRelease.complete &&
           await groupGone(pid, killGraceMs);
       } catch {}
       if (!exitAfterRelease.complete || !closeAfterRelease.complete || !disappeared) {
         return evidence("anchor-release-incomplete", observed);
       }
       await stageHook("post-result");
       if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
       return completeWithOwnedRootRemoval({
         ...exitedResult, stdout: stdout(), stderr: stderr(), failure,
         cleanup: {complete: true, groupDisappeared: true, signals},
       });
     } catch {
       return evidence("ownership-lost", observed ?? []);
     }
   }

   async function testSupervisor() {
     removeSignalHandlers(process, externalSignalHandlers);
     try {
       for (const [stage, signal, expectedStatus] of [
       ["early", "SIGHUP", 129],
       ["active", "SIGINT", 130],
       ["post-DONE", "SIGTERM", 143],
       ["post-result", "SIGHUP", 129],
       ]) {
         const latch = createSignalLatch();
         const handlers = installSignalHandlers(process, latch);
         let fired = false;
         let secondSignalFired = false;
         try {
           const result = await supervise(stage === "active" ? "sleep 10\n" : ":\n", {
             signalLatch: latch, timeoutMs: 500, termGraceMs: 50, killGraceMs: 500,
             stageHook: async (current) => {
               if (stage === "active" && fired && current === "cleanup") {
                 process.kill(process.pid, "SIGTERM");
                 await delay(0);
                 secondSignalFired = true;
                 return;
               }
               if (fired || current !== stage) return;
               fired = true;
               await delay(0);
               process.kill(process.pid, signal);
               await delay(0);
               await latch.wait;
             },
           });
           assert.equal(fired, true, `${stage} hook`);
           assert.equal(secondSignalFired, stage === "active", `${stage} second signal`);
           assert.equal(latch.signal, signal, `${stage} signal`);
           assert.equal(SIGNAL_STATUS[latch.signal], expectedStatus, `${stage} status`);
           assert.equal(result.failure, `external-signal:${signal}`, `${stage} failure`);
           assert.equal(result.cleanup.complete, true, `${stage} cleanup`);
           assert.equal(result.cleanup.groupDisappeared, true, `${stage} group cleanup`);
           assert.equal(result.cleanup.rootRemoved, true, `${stage} root cleanup`);
         } finally {
           removeSignalHandlers(process, handlers);
           process.exitCode = 0;
         }
       }
     } finally {
       externalSignalHandlers = installSignalHandlers(process, externalSignals);
     }

     const finalTailSource = [
       `const SIGNAL_STATUS = Object.freeze(${JSON.stringify(SIGNAL_STATUS)});`,
       `const delay = ${delay.toString()};`,
       `const deferred = ${deferred.toString()};`,
       createSignalLatch.toString(),
       installSignalHandlers.toString(),
       `const signalStatus = ${signalStatus.toString()};`,
       exitWithSignalAuthority.toString(),
       `const latch = createSignalLatch();
        installSignalHandlers(process, latch);
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 0);
        await exitWithSignalAuthority(latch, 0);`,
     ].join("\n");
     const finalTailProbe = spawnSync(process.execPath,
       ["--input-type=module", "-e", finalTailSource], {
         encoding: "utf8", timeout: 2_000,
       });
     assert.equal(finalTailProbe.error, undefined);
     assert.equal(finalTailProbe.signal, null);
     assert.equal(finalTailProbe.status, 143);
     assert.equal(finalTailProbe.stdout, "");
     assert.equal(finalTailProbe.stderr, "");

     for (const [signal, status] of Object.entries(SIGNAL_STATUS)) {
       const result = await supervise(`kill -${signal.slice(3)} $$\n`, {
         timeoutMs: 500, termGraceMs: 50, killGraceMs: 500,
       });
       assert.equal(result.code, status, `${signal} status`);
       assert.equal(result.signal, null, `${signal} anchor signal`);
       assert.equal(result.cleanup.complete, true, `${signal} cleanup`);
       assert.equal(result.cleanup.groupDisappeared, true, `${signal} group disappearance`);
       assert.equal(result.cleanup.rootRemoved, true, `${signal} owned-root removal`);
       try { lstatSync(result.ownedFixtureRoot); assert.fail(`${signal} root survived`); }
       catch (error) { assert.equal(error?.code, "ENOENT"); }
     }

     let result = await supervise("exit 7\n", {timeoutMs: 500});
     assert.equal(result.code, 7); assert.equal(result.failure, undefined);
     assert.equal(result.cleanup.complete, true);

     result = await supervise(":\n", {
       executable: "/p2-h-deliberately-missing-bash", launchTimeoutMs: 100,
     });
     assert.equal(result.failure, "spawn-error"); assert.deepEqual(result.cleanup.signals, []);

     result = await supervise("sleep 10\n", {timeoutMs: 40, termGraceMs: 100});
     assert.equal(result.failure, "timeout"); assert(result.cleanup.signals.includes("SIGTERM"));
     assert.equal(result.cleanup.complete, true);

     result = await supervise(
       "mkdir -p \"$TMPDIR/descendant-one.orphan\" \"$TMPDIR/descendant-two.orphan\"\n" +
       "trap '' TERM\nwhile :; do sleep 1; done\n", {
       timeoutMs: 40, termGraceMs: 75, killGraceMs: 500,
     });
     assert.deepEqual(result.cleanup.signals, ["SIGTERM", "SIGKILL"]);
     assert.equal(result.cleanup.complete, true);
     assert.equal(result.cleanup.groupDisappeared, true);
     assert.equal(result.cleanup.rootRemoved, true);
     try { lstatSync(result.ownedFixtureRoot); assert.fail("forced-KILL root survived"); }
     catch (error) { assert.equal(error?.code, "ENOENT"); }

     result = await supervise("i=0; while test $i -lt 100; do printf 1234567890; i=$((i + 1)); done\n", {
       maxOutputBytes: 32, timeoutMs: 500, termGraceMs: 100,
     });
     assert.equal(result.failure, "stdout-limit"); assert.equal(result.cleanup.complete, true);

     const testSignal = createSignalLatch();
     setTimeout(() => testSignal.raise("SIGTERM"), 30);
     result = await supervise("sleep 10\n", {signalLatch: testSignal, timeoutMs: 500, termGraceMs: 100});
     assert.equal(result.failure, "external-signal:SIGTERM");
     assert.equal(result.cleanup.complete, true);

     result = await supervise("(trap 'exit 0' TERM; while :; do sleep 1; done) &\nexit 0\n", {
       timeoutMs: 500, termGraceMs: 250,
     });
     assert.equal(result.code, 0); assert.deepEqual(result.cleanup.signals, ["SIGTERM"]);
     assert.equal(result.cleanup.complete, true);

     result = await supervise(":\n", {timeoutMs: 500});
     assert.equal(result.code, 0); assert.equal(result.cleanup.complete, true);
     assert.equal(result.stdout, ""); assert.equal(result.stderr, "");

     const evidencePath = retainEvidence({
       reason: "mode-self-test", ownerPid: process.pid, ownerPgid: process.pid,
     });
     assert.ok(evidencePath);
     assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
     assert.equal((await deleteOwnerReservation(dirname(evidencePath),
       join(dirname(evidencePath), ".absent-evidence-sibling"))).complete, true);
     manualEvidencePath = undefined;

     const nativeConsoleError = console.error;
     const evidenceDiagnostics = [];
     let attemptedEvidenceRoot;
     console.error = (message) => evidenceDiagnostics.push(String(message));
     try {
       result = await supervise(":\n", {timeoutMs: 500, postDetachEvidenceIo: {
         mkdtempSync(prefix) { attemptedEvidenceRoot = mkdtempSync(prefix); return attemptedEvidenceRoot; },
         chmodSync, realpathSync, renameSync, statSync,
         writeFileSync() { throw new Error("invented evidence write failure"); },
       }});
     } finally {
       console.error = nativeConsoleError;
     }
     assert.equal(result.failure, "manual-remediation");
     assert.equal(result.cleanup.complete, false);
     assert.equal(result.cleanup.rootRemoved, false);
     assert.equal(result.evidencePath, null);
     assert.equal(realpathSync(result.ownedFixtureRoot), result.ownedFixtureRoot);
     assert.equal(evidenceDiagnostics.length, 1);
     assert.equal(evidenceDiagnostics[0],
       `ERROR  P2-H evidence persistence failed; owner PID/PGID ${result.ownerPid}/${result.ownerPgid}; owned-root=${result.ownedFixtureRoot}; attempted=${join(attemptedEvidenceRoot, "manual-remediation.json")}; parent=${TMP_PARENT}`);
     assert.equal((await removeOwnedRoot(result.ownedFixtureRoot)).complete, true);
     assert.equal((await deleteOwnerReservation(attemptedEvidenceRoot,
       join(attemptedEvidenceRoot, ".absent-evidence-sibling"))).complete, true);
     console.log("PASS  P2-H release supervisor self-tests");
   }

   async function run({path, marker, stdout, requiresOwnerProtocol = false}) {
     const markdown = readFileSync(path, "utf8");
     const blocks = [...markdown.matchAll(/^([ \t]*)```bash[ \t]*\r?\n([\s\S]*?)^\1```[ \t]*$/gm)]
       .map((match) => match[2].split("\n").map((line) =>
         line.startsWith(match[1]) ? line.slice(match[1].length) : line,
       ).join("\n")).filter((block) => block.split("\n").includes(marker));
     assert.equal(blocks.length, 1, `${path} must contain one ${marker} block`);
     const block = blocks[0];
     assert.equal(block.split("\n").filter((line) => line === marker).length, 1,
       `${marker} must appear as one exact standalone line`);
     const result = await supervise(block);
     assert.equal(result.failure, undefined, `${path} fixture supervisor failed`);
     assert.equal(result.signal, null, `${path} fixture received a signal`);
     assert.equal(result.code, 0, `${path} fixture exited nonzero`);
     assert(result.stderr === "", `${path} fixture wrote stderr`);
     assert(result.stdout === `${stdout}\n`, `${path} fixture wrote unexpected stdout`);
     if (requiresOwnerProtocol) assert.deepEqual(result.ownerProtocol,
       {claims: 1, reserves: 1, interrupts: 0, releases: 1},
       `${path} did not complete the authenticated owner lifecycle`);
   }

   (async () => {
     await testSupervisor();
     if (SELF_TEST_ONLY) return;
     await run({
       path: "docs/tickets/P2-A.md",
       marker: "# P2-A gate compatibility source fixture",
       stdout: [
         "PASS  safeNext and exact login/logout response matrix",
         "PASS  exact anonymous, legacy, final, contradictory, and malformed gate matrix",
       ].join("\n"),
       requiresOwnerProtocol: true,
     });
     await run({
       path: "docs/tickets/P2-F.md",
       marker: "# P2-F runtime authority fixture",
       stdout: [
         "PASS  realtime disabled contract",
         "PASS  realtime token request contract",
         "PASS  realtime token endpoint contract",
         "PASS  realtime publish contract",
         "PASS  realtime degradation and privacy contract",
       ].join("\n"),
       requiresOwnerProtocol: true,
     });
     await run({
       path: "docs/tickets/P3-H.md",
       marker: "# P3-H runtime authority fixture",
       stdout: "PASS  P3-H fixed-identity access projection",
     });
     if (externalSignals.signal !== undefined) throw new Error("external signal");
     console.log("PASS  P2-H owning source-bound runtime suites");
   })().then(async () => {
     await exitWithSignalAuthority(externalSignals, 0);
   }).catch(async () => {
     const suffix = manualEvidencePath ? `; manual remediation evidence: ${manualEvidencePath}` : "";
     console.error(`ERROR  P2-H owning source-bound runtime launcher failed${suffix}`);
     await exitWithSignalAuthority(externalSignals, 1);
   });
   NODE
   BASH
   ```

   Expected: exit `0` and exactly:

   ```text
   PASS  P2-H release supervisor self-tests
   PASS  P2-H owning source-bound runtime suites
   ```

   Child output is captured in memory with a one-mebibyte limit per stream and is never included in launcher diagnostics. Each fixture runs below a dedicated detached Bash anchor on macOS or Linux. A nonce-bearing handshake proves that the direct child is the positive PID/PGID owner, and the still-open control pipe keeps that anchor alive while the parent revalidates exact live leader identity immediately before signalling the owned negative group id. An exited anchor, missing anchor membership, malformed handshake, or otherwise stale/unproven id fails safe: the launcher never group-signals it. It never signals group `0` or `-1`. Before launch, P2-H creates and validates one mode-`0700` `p2-h-owned-fixture.` root directly below the resolved system temporary parent and passes it as the fixture's `TMPDIR`. The external parent services the canonical authenticated P2-A/P2-F claim/reserve/interrupt/release protocol on descriptors distinct from the anchor's READY/DONE/RELEASE boundary; the real P2-A marker must complete claim, reserve, bounded owner deletion, and release before it can pass. Only after anchor exit, inherited-stream closure, and group-disappearance proof does a separately bounded direct-child deletion worker remove the outer tree. That worker cannot spawn descendants, is KILLed only through its positive PID, and is reaped before cleanup can be complete; any uncertainty retains the complete child-artifact tree and private evidence locator.

   HUP, INT, and TERM all enter the same supervised cleanup path. The installed handler atomically latches the first signal and immediately sets the process exit code to 129, 130, or 143; the terminal finalizer yields once and rechecks the latch before the actual exit, so a post-result or final-tail signal cannot false-green. Silent subprocess probes deliver real signals at the early, active, post-`DONE`, post-result, and final-tail checkpoints through that exact shared handler and finalizer. The active probe sends SIGINT first and a distinct SIGTERM while cleanup is underway, and requires the first SIGINT/status 130 to remain authoritative. Separate source-bound anchor runs require natural child HUP/INT/TERM/KILL to emerge conventionally as 129/130/143/137. For conforming fixtures whose children remain in the inherited anchor process group, ordinary completion, nonzero exit, timeout, output overflow, external signal, or a same-group background descendant sends owned-group TERM when descendants remain, escalates to owned-group KILL after the bounded grace period, waits for the direct child and every inherited pipe to close, and then proves the complete process group disappeared before another fixture starts. The exact self-tests also exercise launch failure, nonzero exit, timeout, TERM escalation, output overflow, the shared external-signal latch, same-group background descendants, clean group/root completion, and a real post-detach evidence-write failure retaining an actual owned root. The launcher does not claim to discover a forbidden new-session daemon after it closes all inherited pipes; the mandatory owning-ticket review above forbids that behavior. A launch that never establishes ownership, unexpected ownership loss, or a process that the kernel does not release after KILL is the explicit exceptional path: no further id is signaled, all local fixture and owner-service handles are detached before evidence persistence is attempted, the owned child-artifact root and a mode-`0600` metadata-only evidence file are retained under a printed guarded temporary path when writable, and the gate exits nonzero. If evidence persistence itself fails, the exact safe PID/PGID, owned-root locator, attempted evidence path, and resolved parent locator are asserted and printed directly; the already-detached launcher still exits. An operator must inspect and remediate either form. That exceptional path deliberately does not promise the normal deadline, group disappearance, or reaping.

   The launcher proves only that one exactly marked owner fixture ran successfully with its reviewed exact output and no stderr; the output is a routing signature, not source-binding evidence by itself. The owning fixtures must independently fail hard-coded/output-only implementations and bind their assertions to production source. Under those owner contracts, P2-A proves the old/new/contradictory predicate matrix over fixture-projected identity shapes; it does not prove P2-H's raw-email suffix classifier. P2-H step 1 owns the raw-email, collision, and whitespace cases. P2-F proves contradictory access, and P3-H holds identity fixed while varying access. Missing, malformed, vacuous under its owning contract, or failing owner evidence blocks transitional deployment, not P2-H source completion.

5. Run repository-wide non-regression, privacy, and patch gates with fail-fast handling:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   templates/check-dist
   npm --prefix templates/docbuild run check
   scripts/scrub-check.sh docs/tickets/P2-H.md netlify/lib/identity.mjs
   git diff --check
   BASH
   ```

   Expected: all commands exit `0`; `templates/check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`, typecheck and patch checking emit no diagnostics, and scrub-check ends with `PASS  no denied term and no warning.`

6. Confirm ownership and the exact P2-H residue boundary. Set `P2H_BASE` to the reviewed commit that already contains P1-C and this ticket document:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   export P2H_BASE="$(git rev-parse --verify "${P2H_BASE:?set P2H_BASE to the reviewed P1-C predecessor}^{commit}")"
   node <<'NODE'
   const {execFileSync} = require("node:child_process");
   const assert = require("node:assert/strict");
   const run = (args) => execFileSync("git", args, {encoding: "utf8"}).trim().split("\n").filter(Boolean);
   const changed = new Set([
     ...run(["diff", "--name-only", `${process.env.P2H_BASE}...HEAD`]),
     ...run(["diff", "--name-only"]),
     ...run(["diff", "--cached", "--name-only"]),
     ...run(["ls-files", "--others", "--exclude-standard"]),
   ]);
   const unexpected = [...changed].filter((path) => path !== "netlify/lib/identity.mjs");
   assert.deepEqual(unexpected, [], `P2-H changed unowned paths: ${unexpected.join(", ")}`);
   assert.deepEqual([...changed], ["netlify/lib/identity.mjs"]);
   console.log("PASS  P2-H exclusive source ownership");
   NODE
   for path in package-lock.json node_modules .netlify _site; do
     test ! -e "$path"
   done
   test -z "$(find . -maxdepth 1 \( -name 'p2-h-*' -o -name 'p2h-*' \) -print -quit)"
   BASH
   ```

   Expected: exit `0` and exactly `PASS  P2-H exclusive source ownership`. Only `identity.mjs` changes. Step 1 proves deletion of its external fixture; step 6 asserts absence of the enumerated repository paths and makes no claim about unrelated ignored/provider state. Each owning ticket still closes its normal inner resources; P2-H step 4 additionally contains every release fixture below its own guarded outer root so forced group cleanup cannot strand an unreported child artifact.

## Failure modes

### Handled

- Missing, expired, invalid, or provider-failed session without verified fallback claims: return `null` with no throw or partial identity.
- Identity API outage with verified JWT claims: normalize the available `id`, `email`, and `name` into the same four-field result.
- Uppercase organization email: lowercase first, then return `isOrg: true`.
- Whitespace-suffixed or suffix-collision email: preserve whitespace/lowercase only and return `isOrg: false` because the normalized string does not end with the exact suffix.
- Syntactically malformed provider email that nevertheless ends with `@example.com`: return `isOrg: true` at this identity-classification boundary; P2-G separately applies its fail-closed email grammar before granting document authority.
- External email with provider role `member`: return `isOrg: false`; provider role cannot grant organization classification or document access.
- Organization-suffix email with no provider role: return `isOrg: true`; access still resolves separately.
- Missing email and name: return empty strings and `isOrg: false`, preserving P1-C's stable string-valued fields.
- Explicit empty name: preserve it rather than replacing it with the email local part.
- Extra raw Identity fields or metadata: ignore them and return only the four safe fields.
- Missing, null, foreign, downgraded-scheme, or wrong-port Origin in a caller of `requireOrigin()`: preserve the exact P1-C 403 response.
- Transitional P2-A consumer: its owner uses the exact old/new predicate so either identity revision fails closed correctly.
- Transitional session consumer: P3-H synthesizes the document-aware public body; P2-C continues to consume the HTTP contract without becoming an identity consumer.
- Standalone fixture deletion timeout or failure: KILL the owned deletion group, await/reap its child, prove group disappearance, and retain the exact guarded root plus mode-`0600` PID/PGID evidence and a safe locator on any failure or uncertainty.
- AST install, version, or audit timeout: TERM then KILL the still-owned detached group, await/reap its leader, prove disappearance, and fail with private evidence before any dependency-root reuse or replacement.
- Interrupted or failed release fixture with a still-owned anchor: HUP/INT/TERM, timeout, output overflow, nonzero exit, natural child signal, and background descendants enter the bounded TERM-to-KILL path; normal cleanup reaps the anchor, closes inherited pipes, proves group disappearance, and removes the guarded outer fixture root before return.
- Missing or lost release-fixture ownership, group disappearance, deletion-worker reaping, or child-root removal proof: never signal a stale or unproven group id and never claim cleanup; retain the complete owned root plus metadata-only evidence and fail for manual remediation.

### Deliberately not handled

- A document role or capability decision inside identity. P2-G is the sole final authority; P2-A's temporary gate exception remains outside identity and ends at P3-J.
- Retaining removed fields to make the P1-C session endpoint appear compatible. That would preserve the design defect this ticket exists to remove.
- Deploying the P2-H-only intermediate state. Integration must pair it with P3-H's session amendment and include P2-A's already-specified compatibility predicate.
- An organization suffix configured by environment. The ruling plan retains the public reserved `@example.com` literal.
- Email trimming or validation inside identity. P2-H deliberately classifies the lowercased provider string by exact suffix only; P2-G owns validation for access resolution.
- Malformed or empty `user.id`. The pinned package's `User` type requires `id`; changing that upstream contract requires a separate decision rather than a locally generated substitute.
- Catching an arbitrary future `getUser()` throw and manufacturing an identity. The pinned package says it never throws and returns `null` on failure.
- Claiming automatic cleanup of a kernel-unkillable fixture process. After the bounded KILL grace the launcher retains evidence, detaches its local handles, exits nonzero, and requires manual remediation; it does not promise a strict terminal deadline and reaping simultaneously.
- Login, logout, token refresh, invite acceptance, password recovery, account deletion, or provider metadata maintenance.
- Access-store outage, grant resolution, owner binding, invitation conversion, gate document lookup, write enforcement, or audit events.
- Client refresh, UI state, realtime connection behavior, presence, or any storage operation.

## Settled decisions

- Netlify Identity in invite-only mode remains the only identity system, through exactly `@netlify/identity@2.0.0` and modern Functions v2/Edge request context.
- Only `netlify/lib/identity.mjs` calls `getUser()`. No caller reads `clientContext`, manually decodes `nf_jwt`, or accepts an actor from the client.
- The final `identify()` result is exactly `{sub, email, name, isOrg}` or `null`. Provider account roles may remain at Identity but are not part of this helper's result.
- `isOrg` is normalized suffix-only identity classification, not a final document permission. A non-null identity is also not permission.
- `resolveRole(docId, user)` in P2-G is the final document authority and returns the document role and all capabilities. P2-A's exact old/new organization predicate is the sole temporary HTML read-wall exception until P3-J removes it.
- Document authority is one owner plus grantable `editor`, `commenter`, and `viewer` roles in strong-consistency Netlify Blobs, one record per key. It never lives in Identity metadata or `doc.json`.
- P2-C's `data-session` and `session` event are rendering hints. P3-H supplies their document-aware payload; every server operation authorizes independently.
- The P2-A gate compatibility predicate and source-bound matrix belong to P2-A, and the P3-H session correction belongs to P3-H. A transitional deployment names that P2-A exception; a no-exception final-authority deployment waits for P3-J. File ownership is not widened to hide integration work.
- Source authoring may run in parallel only across disjoint files and isolated worktrees. Same-file amendments and combined runtime/generated acceptance remain serialized.
- Every release owner fixture runs with a P2-H-owned guarded `TMPDIR`; normal completion deletes it only after anchor and deletion-worker group proof, while uncertain cleanup retains it and private actionable evidence.
- `requireOrigin()` remains the first operation in every POST, PATCH, and DELETE handler and is unchanged by the identity/authorization split.
- Both standalone and repository-backed deployment modes remain supported; P2-H adds no deployment-specific behavior.
- Realtime remains optional Ably and presence remains ephemeral. P2-F consumes `sub`/`isOrg` only after document access succeeds.
- The permanent six-lowercase-hex document id, shared `data-aid`, `norm()`, and block scanner decisions remain untouched.

## Assumptions and open questions

### Assumptions

- **Non-blocking normalization assumption:** P2-H preserves P1-C's exact email operation, including no trim, and its nullish-only name fallback. This ticket changes authorization separation, not person normalization.
- **Non-blocking provider-role assumption:** the provider's account-level `member`/`guest` values may remain useful to account-management flows, but returning them from `identify()` would contradict the final four-field contract. P3-H may derive its public compatibility `roles` array from `isOrg`; it does not recover provider metadata.
- **Integration assumption:** P3-H's public session body retains P2-C's common `roles`, `canComment`, and `canEdit` fields, adds `canSuggest` and the other document fields, and sources every capability from P2-G. This is the settled research §3.4 transition and is owned by P3-H.
- **Verification assumption:** a permanent unit-test path is not added because P2-H owns one amended runtime file only. The exact isolated command supplies repeatable coverage without expanding source ownership.

### Coordination item

- **P2-A compatibility is already specified and marked:** P2-A's rewritten contract contains the exact old/new predicate and its source-bound local gate-matrix Bash fence already contains the exact `# P2-A gate compatibility source fixture` marker that P2-H step 4 locates. That owning fixture binds production `gate.ts` and proves the old/new/contradictory predicate matrix over its fixture-projected shapes. It does not receive raw organization-domain emails and therefore does not prove P2-H's suffix classifier; P2-H step 1 owns the exact suffix, collision, and whitespace cases. P2-H's launcher deliberately does not re-parse or certify the owner fixture's internals. P2-H must not edit `gate.ts`, P2-A's ticket, duplicate the predicate in implementation source, or retain removed identity fields. P3-J later removes the exception before the release is labeled final-authority.

### Open questions

None block implementation. The pinned package's `README.md` and `dist/main.d.ts` were rechecked for this ticket: `getUser()` takes no argument, returns `Promise<User | null>`, never throws, requires modern Functions v2 or Edge Functions server context, guarantees `id`, and documents the verified-JWT fallback fields that include `id`, `email`, and `name`.

## References

- `HANDOFF.md`, public-repository and settled-decision sections — public-safe fixtures, ownership, and authority boundaries.
- `README.md`, “Checks” and “The platform” — artifacts, repository gates, and ruling-plan authority.
- `docs/research/00-integration-plan.md` §1.2 and §1.5 — identity, Functions v2, origin, normalization, and the identity/authority split.
- `docs/research/00-integration-plan.md` §2.9 and §4.7 — session transition, ownership, dependencies, and consumer order.
- `docs/research/00-integration-plan.md` §6 rulings 9, 10, and 32 — accessor, roles, and state authority.
- `docs/research/09-sharing-and-roles.md` §2–§3 — roles, organization default, four-field identity, authority, and session transition.
- `docs/research/09-sharing-and-roles.md` §9.1–§9.2 — server enforcement and the HTML read wall.
- `docs/research/02-auth.md` §3.1 — `getUser()` trust, fallback, privacy, and origin verification.
- `docs/tickets/P1-C.md` — creator shape, normalization, origin helper, and package pin.
- `docs/tickets/P2-A.md` — temporary old/new gate predicate and ownership.
- `docs/tickets/P2-C.md` — HTTP session compatibility and client-hint boundary.
- `docs/tickets/P2-F.md` — realtime identity policy and access check.
- `docs/tickets/P2-G.md` — `AccessUser`, `resolveRole()`, capabilities, and errors.
- `@netlify/identity@2.0.0` packaged `README.md` and `dist/main.d.ts` — server requirements, `User`, and `getUser()` contract.
