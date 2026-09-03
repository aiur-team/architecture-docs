# P4-M — Enforcement in the existing write paths

## Outcome

Every existing thread and direct-edit mutation is authorized from P2-G's current document role before it writes; every successful thread transition attempts exactly one canonical P3-B audit append; and durable thread creation/reply schedules the exact P4-D/P4-H fan-out input without weakening P3-A's state, response, or concurrency contracts.

## Context

P3-A deliberately ships thread persistence before mutation authorization and reserves this amendment. P4-B likewise establishes `/api/edit` before the shared apply extraction. This ticket closes those temporary seams in their existing handlers. It is a serialized integration ticket, not a new policy layer: P2-G remains the sole role authority, P3-A remains the thread-state authority, P3-B remains the event-schema authority, and P4-B remains the direct-edit request authority.

## Scope

### In scope

- Amend `netlify/functions/threads.mjs` and `netlify/functions/thread.mjs` exactly at P3-A's reserved mutation-authorization and post-commit audit seams.
- Amend `netlify/functions/edit.mjs` after P4-B, before P4-N, to require both the suggestion and direct-edit capabilities for a direct edit.
- Validate the complete P2-G resolved-access object before using a capability.
- Keep a thread ownership-dependent `threadControl: "own"` decision inside P2-B's pure CAS transform against each freshly validated draft.
- Append the four exact thread event kinds directly through P3-B `appendEvent()` only after authoritative state success.
- Call the sole P4-D/P4-H `notify()` helper once for durable thread create/reply after the audit attempt.
- Preserve successful state and the predecessor response when an audit append fails.
- Add the permanent source-bound `scripts/test-p4-m.mjs` regression and hosted fixture for this integration boundary.

### Out of scope

- A new endpoint, role, capability, event kind, event schema, request field, store key, test-only production export, or HTTP call to `/api/events`.
- Suggestion creation/decision, the shared Git apply implementation, Mode A receipts, promotion, a notification/realtime provider algorithm, or retention.
- Moving authorization into `store.mjs`, trusting browser controls, accepting authority from a body, consuming an invitation, or consulting `doc.json`.
- Changing any P3-A route/body/thread/comment/actor/ID/CAS/replay/response/error rule or any P4-B edit/conversion/conflict/receipt rule.

## Interface contract

### Preserved module surfaces and order

The two P3-A modules retain only their existing default handler and `config` exports. `edit.mjs` retains P4-B's exact exports, route, request, and response shapes. This ticket adds no production export. Amend P4-B's closed `createEditHandler()` dependency object with exactly two additional own callable data properties, `resolveRole` and `capabilitiesFor`; every prior dependency and validation rule remains. Production statically imports exactly those two names from `../lib/access.mjs`, and neither request data nor a test can replace them after factory construction. The shared-file landing order is mandatory:

```text
P4-B -> P4-M -> P4-N
```

P4-N extracts P4-B's apply algorithm only after this authorization amendment and must leave the access check in `edit.mjs`; `gitedit.mjs` is not an authorization oracle.

Preserve each predecessor route's own exact validation order; there is no new generic order shared across the handlers. P3-A's supported mutation paths keep their exact origin-first sequence, then identity and their route/path/query/media/body/exact-validation gates in the order P3-A specifies. P4-B's `POST /api/edit` keeps its exact unsupported-method check, then `requireOrigin`, `identify`, and its URL/query/media/body/exact-validation sequence. Only after the applicable route has completed all of its predecessor gates, and before clock, randomness, domain-record store access, GitHub, receipt, or event work, call `resolveRole(docId, identity, { consumeInvitation: false })` exactly once. Its own P2-G access-store reads are the authority lookup, not forbidden domain work. Validate that the returned ordinary exact object has, in order, `role`, `shared`, `canRead`, `canComment`, `threadControl`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers`, and that its capabilities equal `capabilitiesFor(role)`. A partial, extended, accessor-backed, or internally inconsistent result maps to each endpoint's predecessor `500 invalid-state` response. Preserve P3-A/P4-B's safe access-error mapping: only the exact descriptor-safe P2-G unavailable shape maps to the predecessor `503 unavailable` response; every other access failure maps to its `500 invalid-state`. Insufficient valid authority is the predecessor's exact `403 forbidden` JSON response.

### Thread authorization

Apply this closed matrix; do not infer from `role`, email domain, Identity roles, organization membership, stored actor, or request data:

| Existing operation | Required resolved value |
|---|---|
| create thread | `canComment === true` |
| reply | `canComment === true` |
| resolve | `threadControl === "any"`, or `threadControl === "own"` and `thread.author.sub === identity.sub` |
| reopen | the same rule as resolve |

For create, the check precedes the handler's P3-A thread-store `docState()` call. For reply, the capability check precedes the mutation; no record ownership check is needed. For resolve/reopen, `threadControl === "none"` fails before `mutate()`, but the `"own"` author comparison occurs inside P3-A's existing synchronous pure `mutate()` callback after `upgrade()` and full key/body validation on every CAS attempt. That callback may compare already-captured identity/access scalars; it performs no access call, clock, randomness, event, log, network, or other I/O. A failed ownership check throws one private sentinel mapped to exact `403 forbidden`, not 404. GET behavior and its existing `canRead` lookup remain byte-for-contract unchanged; do not add a second GET lookup.

### Direct-edit authorization

After P4-B's exact edit input gates, `edit.mjs` performs the same one non-consuming resolved-access call and complete validation. A direct edit requires `canSuggest === true` and then `canEdit === true`. The first check freezes the shared editing-family boundary; the second is the actual direct-write boundary. Because P2-G's valid table makes every editor/owner true for both, the two checks do not create a role. A commenter (`canSuggest: true`, `canEdit: false`), viewer, or none receives exact `403 forbidden` before manifest, source, GitHub, receipt, or event work. P4-O later uses `canSuggest` without `canEdit` for creating a suggestion.

### Post-commit thread audit

Import `appendEvent` directly from `./events.mjs` in each thread function. Never invoke its HTTP handler. After, and only after, the authoritative state operation succeeds, call it once with the same `docState()` store and the proven identity projected as exact `{ sub, name, email }`:

| State transition | `kind` | `target` | `docVersion` | `summary` |
|---|---|---|---|---|
| create | `comment.create` | `{ threadId: thread.id, aid: thread.anchor?.block ?? null }` | `thread.docVersion` | `commented on ${thread.section}` |
| reply | `comment.reply` | `{ threadId: thread.id, commentId: appended.id, aid: thread.anchor?.block ?? null }` | `thread.docVersion` | `commented on ${thread.section}` |
| changed to resolved | `thread.resolve` | `{ threadId: thread.id, aid: thread.anchor?.block ?? null }` | `thread.docVersion` | `resolved ${thread.section}` |
| changed to open | `thread.reopen` | `{ threadId: thread.id, aid: thread.anchor?.block ?? null }` | `thread.docVersion` | `reopened ${thread.section}` |

`aid` remains `null` for a discussion thread. The validated section grammar makes every exact summary satisfy P3-B's safe 1–160-byte grammar. A repeated PATCH whose P2-B result has `changed === false` appends nothing. Create collision, missing thread, comment limit, failed CAS, authorization denial, invalid input, and any failed state write append nothing.

P3-B explicitly has no transaction with the domain record. Therefore an `appendEvent()` collision, unavailable store, or unexpected throw after state success is caught at this boundary and must not retry, roll back, rewrite, log actor-bearing data, change a success status/body/header, or encourage a replay. Return the exact successful P3-A response. The audit row can be lost; the authoritative thread state cannot. This is the only behavior compatible with P3-A's preserved responses and its non-idempotent POST boundary.

### Post-audit thread fan-out

Import only `notify` from `../lib/notify.mjs`; never import `publish`, inspect Slack/Ably configuration, call `context.waitUntil()` directly, or await a sink. After the durable state operation and its one audit attempt have both returned or been safely caught, call `notify(context, notification)` synchronously inside its own try boundary. Ignore its boolean result and any throw; notification cannot alter the exact successful response. Resolve/reopen, status no-op, failed state, failed authorization, and failed input call it zero times.

Create passes exactly one fresh closed object derived only from the validated durable thread:

```text
{
  t: "thread.created", docId: thread.docId, threadId: thread.id,
  actorName: thread.author.name, threadKind: thread.kind,
  body: thread.comments[0].body,
  quote: thread.kind === "comment" ? thread.anchor.exact : null,
}
```

Reply passes exactly one fresh closed object from the revalidated committed thread and its newly appended comment:

```text
{
  t: "thread.replied", docId: thread.docId, threadId: thread.id,
  actorName: appended.author.name, body: appended.body,
  quote: thread.kind === "comment" ? thread.anchor.exact : null,
}
```

The two caller modules retain `(req, context)` handlers and pass the unmodified Functions v2 `context`. They do not copy request actor/notification fields. P4-H may schedule Slack and/or its text-free realtime projection behind this one call.

## Files owned

- `netlify/functions/threads.mjs` — **amended after P3-A** for create authorization, `comment.create` audit, and `thread.created` fan-out.
- `netlify/functions/thread.mjs` — **amended after P3-A** for reply/status authorization, reply/status audit, and `thread.replied` fan-out.
- `netlify/functions/edit.mjs` — **amended after P4-B and before P4-N** for direct-edit capability enforcement.
- `scripts/test-p4-m.mjs` — **new permanent regression harness** for source-bound authorization/audit/fan-out, supervision, and the opt-in hosted lifecycle.
- `docs/tickets/P4-M.md` — **new canonical specification**; not an implementation path.

No other implementation, library, configuration, dependency, template, generated artifact, fixture, research, prompt, or permanent test file is owned.

## Dependencies

- **P3-A:** exact thread handlers, pure-CAS rules, responses, and this reserved amendment boundary.
- **P3-B:** exact `appendEvent()` input, target/event schemas, create-only storage, errors, and explicit non-transaction boundary.
- **P2-G:** sole role/capability authority and non-consuming lookup.
- **P4-B:** creates the direct-edit handler and its complete input/apply response contract.
- **P4-D/P4-H:** the integrated sole `notify(context, notification)` fan-out helper and exact thread input variants; this ticket owns only its two caller sites.
- **P2-B/P1-C/P2-H:** store, origin, and proven-identity contracts transitively preserved by the amended handlers.

### Maximum safe implementation waves

1. After P3-A/P3-B/P2-G and the serialized P4-D-then-P4-H helper land, one agent may amend `threads.mjs` while another amends `thread.mjs`; a third may create `scripts/test-p4-m.mjs` against the frozen table. Each file has one writer.
2. Separately, P4-B must land before one agent amends `edit.mjs`. Do not edit that shared file concurrently with P4-B or P4-N.
3. Serialize integration in the exact order P4-B, then this ticket, then P4-N. Run the combined mutation matrix after all three files are integrated.
4. Provider/deployed-preview tests are a final single-operator phase because one Blobs store, one repository branch, and one authenticated site are shared mutable resources.

## Acceptance criteria

- [ ] The non-ticket diff contains only the three owned amended files and `scripts/test-p4-m.mjs`, with every predecessor export/route/request/response contract preserved and only the exact two access callables added to the edit factory seam.
- [ ] Every supported mutation calls default non-consuming P2-G resolution once after the predecessor's public request gates and before any mutation-side state/Git work; complete capability validation fails closed.
- [ ] Create/reply require `canComment`; resolve/reopen obey `any`/matching-author `own`/`none`; direct edit requires both `canSuggest` and `canEdit`.
- [ ] The `threadControl: "own"` author comparison is inside the synchronous CAS transform and is reevaluated for every fresh draft without I/O.
- [ ] State success alone selects an audit attempt. The four exact event mappings, targets, doc version, actor, and summaries match the interface table; a PATCH no-op emits none.
- [ ] An injected append conflict, unavailable error, and unexpected throw each leave the committed state and exact success response intact, with no retry, rollback, request replay, log, or HTTP event call.
- [ ] Create/reply each call `notify()` once after the audit attempt with the exact durable projection; status/no-op/failure calls none, and every notify return/throw preserves the response.
- [ ] Denial and every state failure append nothing; hostile body authority fields never influence role, actor, or event data.
- [ ] P4-N's resulting `edit.mjs` keeps these access gates outside the extracted `applyText()` call.
- [ ] `node scripts/test-p4-m.mjs` is the permanent executable source-bound/supervisor gate, and its opt-in hosted branch withholds success until all local and remote fixture resources are cleaned.
- [ ] AST, deterministic runtime, provider, repository, scrub, generated-output, and issue-pointer gates below all pass with exact terminal output.

## Test plan

### 1. Finite AST and runtime gate

Run from the repository root after setting `P4M_BASE` to the reviewed integrated P3-A/P3-B/P2-G/P4-B commit:

```bash
set -euo pipefail
: "${P4M_BASE:?set P4M_BASE}"
node --check netlify/functions/threads.mjs
node --check netlify/functions/thread.mjs
node --check netlify/functions/edit.mjs
node --check scripts/test-p4-m.mjs
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";

for (const file of ["threads.mjs", "thread.mjs", "edit.mjs"]) {
  const text = readFileSync(`netlify/functions/${file}`, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(sf.parseDiagnostics.length, 0, file);
  assert.equal(text.includes("consumeInvitation: true"), false, file);
  assert.equal(text.includes("/api/events"), false, file);
  assert.equal(/console\.|process\.env|fetch\s*\(|waitUntil\s*\(|\bpublish\s*\(/.test(text), false, file);
}
const threads = readFileSync("netlify/functions/threads.mjs", "utf8");
const thread = readFileSync("netlify/functions/thread.mjs", "utf8");
const edit = readFileSync("netlify/functions/edit.mjs", "utf8");
assert.match(threads, /appendEvent/); assert.match(thread, /appendEvent/);
assert.match(threads, /notify/); assert.match(thread, /notify/);
assert.match(threads, /canComment/); assert.match(thread, /canComment/);
assert.match(thread, /threadControl/); assert.match(edit, /canSuggest/); assert.match(edit, /canEdit/);
console.log("PASS  P4-M AST boundaries");
NODE
```

Expected: all commands exit 0 and the only inline-oracle output is exactly `PASS  P4-M AST boundaries`. The permanent harness uses a source-bound loader and deterministic identity/access/store/event/notify fakes against the real three modules. Its finite matrix covers the exact post-M edit factory keys and invalid dependency shapes; owner/editor/commenter/viewer/none; `any`/matching-own/nonmatching-own/none; create/reply/resolve/reopen/no-op; six CAS races; all predecessor public errors; append success/conflict/unavailable/unexpected failure; exact create/reply notification objects; call order; notify true/false/throw; and zero notify for status/failure.

### 2. Finite supervision and provider gate

Run the permanent local gate from the repository root:

```bash
node scripts/test-p4-m.mjs
```

It runs the source-bound fixture under one direct-child Node supervisor with a 120-second deadline. The supervisor installs HUP/INT/TERM handlers before spawning, forwards the first signal, waits two seconds, escalates only its still-live child to KILL, reaps it, and proves the PID absent before deleting its `mktemp -d` root. Self-probe HUP/INT/TERM and a TERM-resistant child first; expected mapped statuses are 129/130/143/124. Unproved reaping or containment exits 125 and retains the mode-0700 root plus a mode-0600 locator. Success prints exactly:

```text
PASS  P4-M supervisor signals and deadline
PASS  P4-M authorization, audit, and fan-out runtime
PASS  P4-M fixture cleaned
```

The opt-in hosted gate requires authenticated `netlify` and `gh` CLIs with permission to create and delete disposable fixture resources and the exact environment flag below; no other environment value selects hosted execution:

```bash
AIUR_P4M_HOSTED=1 node scripts/test-p4-m.mjs --hosted
```

It uses one generated disposable deploy preview/site, invented `.invalid` actors and blocks, and generated disposable repository branches. It exercises every capability row, an ownership race, successful/no-op status, and an injected post-state event/fan-out failure; strong Blobs reads and the injected helper boundary prove exact state/event/notification counts. The harness has a 600-second outer deadline, removes the site, state, branches/PRs, and its local mode-0700 root, and prints exactly `PASS  P4-M hosted enforcement audit and fan-out` only after proving that cleanup. Cleanup uncertainty exits 125, prints no PASS line, and retains only a mode-0600 locator to the unresolved disposable resource.

### 3. Repository and immutable-pointer gate

```bash
set -euo pipefail
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-M.md netlify/functions/threads.mjs netlify/functions/thread.mjs netlify/functions/edit.mjs scripts/test-p4-m.mjs
git diff --check "$P4M_BASE"...HEAD
git diff --check
test -z "$(git diff --name-only "$P4M_BASE"...HEAD | grep -Ev '^(netlify/functions/(threads|thread|edit)\.mjs|scripts/test-p4-m\.mjs|docs/tickets/P4-M\.md)$' || true)"
issue_json="$(gh issue view 35 --json title,body)"
pointer="$(ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P4-M.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P4-M — Enforcement in the existing write paths" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
unset issue_json pointer pointer_sha pointer_path
printf '%s\n' 'PASS  P4-M repository gates'
```

Expected: every command exits 0; `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; scrub and whitespace checks are clean; issue #35 has the exact title and the prompt-prescribed two-paragraph commit-permalink body whose addressed bytes equal this document; the final line is exactly `PASS  P4-M repository gates`.

## Failure modes

- Invalid/missing/inconsistent access data: fail 500 or P2-G's exact 503 before state/Git/event work; never downgrade to a truthy-field check.
- Valid insufficient authority: exact 403 with no existence, actor, member, manifest, branch, or provider detail.
- Raced owned-thread authorization: every CAS draft is checked; a non-author cannot win by changing state between an earlier read and write.
- Audit append fails after state: preserve the state and exact successful response; the event may be absent. This ticket deliberately adds no outbox or replay key.
- Notification scheduling returns false or throws after state/audit: preserve the state, audit outcome, and exact response; no handler retries or calls a provider directly.
- A POST response is lost: P3-A remains non-replay-idempotent. The client refreshes; audit behavior does not change that rule.
- Integration applies P4-N before this ticket: reject the merge/rebase until `edit.mjs` visibly retains enforcement around the extracted call.

## Settled decisions

- P2-G access state, not `doc.json`, Identity roles, HTML, or request data, is authoritative.
- Direct editing requires `canEdit`; `canSuggest` is checked as the editing-family invariant, not as a substitute.
- Thread ownership authorization is a CAS-state predicate; it cannot be decided from stale pre-read state.
- Thread state wins over best-effort audit. An append failure cannot change a P3-A success response or cause a dangerous POST replay.
- Thread mutations call `appendEvent()` directly and never their own HTTP API.
- Thread create/reply call only the integrated `notify()` helper after audit; resolve/reopen produce no notification.
- The shared `edit.mjs` sequence is P4-B, P4-M, then P4-N.

## Assumptions and open questions

- **Assumption:** P4-B exposes a single handler apply call after all exact request validation, so P4-M can place access enforcement immediately before it without changing the body contract.
- **Assumption:** P3-A returns the appended reply in its authoritative result so the exact `commentId` is available after CAS success.
- **Open question, non-blocking:** the accepted best-effort audit boundary can lose one event after state success. A future durable outbox would require a new atomicity design and is not implied by this ticket.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.5, 2.4, 3.4, and 4.7 — state, role, event, conflict, and Phase 4 ordering decisions.
- `docs/research/08-suggestions-and-editing-model.md` §§3.5, 4.2, 6, and 12 — direct-edit capability distinction and effective-base family; its `doc.json` authority proposal is superseded by the plan and P2-G.
- `docs/research/05-inline-editing.md` §§6–9 — inline representation and Git edit context.
- `docs/research/09-sharing-and-roles.md` §§4–6 — per-document role intent, superseded where canonical P2-G is more exact.
- `docs/tickets/P3-A.md` — exact reserved mutation-authorization/audit amendment and thread contracts.
- `docs/tickets/P3-B.md` — exact append helper, event targets, actor rules, and non-transaction boundary.
- `docs/tickets/P4-D.md` and `P4-H.md` — exact notification inputs, text-free realtime projections, optional scheduling, and caller boundary.
- `docs/tickets/P2-G.md` and `docs/tickets/P4-B.md` — exact capability resolver and direct-edit predecessor.
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — conditional write and strong-consistency behavior; checked 2026-09-03.
