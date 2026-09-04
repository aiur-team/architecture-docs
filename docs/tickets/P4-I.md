# P4-I — The editing soft lock

## Outcome

Direct-edit focus is announced as an advisory block claim, peers show a bounded editing chip and suppress their own direct-edit button until release or lease expiry, and the server's block-hash conflict remains the only write authority.

## Context

P3-F already transports exact `edit.claim` and `edit.release` client messages, and P3-G already holds the 20-second presence lease, 50-second expiry, roster labels, privacy switch, and a deliberate `currentBeat()` amendment seam. P4-B creates the direct-edit lifecycle. This ticket connects those existing surfaces without adding persistence, a second transport, or a correctness lock.

## Scope

### In scope

- Amend P4-B's direct-edit focus/finish lifecycle to publish one claim and one release through P3-F.
- Emit one frozen local edit-state event so P3-G's existing heartbeat changes between reading/null and editing/aid.
- Amend P3-G to consume validated remote claim/release projections, tie claims to its existing roster lease, render one chip per uniquely claimed editable block, and hide only that block's direct-edit button.
- Release on blur, save initiation, Escape cancellation, `pagehide`, and before moving focus to another editable block.
- Preserve forced concurrent saves and exact P4-B/P4-M 409 handling.
- Create one permanent, public-safe Node 22 runner for lifecycle, bounded-map, supervision, and rendered-browser behavior.

### Out of scope

- Server locks, Blobs records, audit events, a claim endpoint, guaranteed delivery, queues, retries, merge logic, CRDTs, cursors, or selection sharing.
- Claiming while drafting a suggestion; P4-P must use this lifecycle only for its direct Edit path.
- Changing P3-F, P3-G CSS, P4-B CSS, layout, session, APIs, provider credentials, or generated HTML.
- Treating a chip, hidden button, heartbeat, or received event as authorization.

## Interface contract

### Local direct-edit lifecycle

P4-I amends P4-B's `templates/base/edit.js`; it does not create a second editor. At most one local direct-edit block is active. The exact local signal is:

```js
document.dispatchEvent(new CustomEvent("doc:edit-state", {
  detail: Object.freeze({ aid: "a31b7c9d2" })
}));

document.dispatchEvent(new CustomEvent("doc:edit-state", {
  detail: Object.freeze({ aid: null })
}));
```

The event is on `document`, does not bubble, is not cancelable/composed, and has a newly created frozen ordinary detail with exactly one enumerable non-writable/non-configurable data property. An aid matches `^a[0-9a-f]{8}$`; `null` means reading. This signal is presentation state only.

On focus entry into a P4-B-proven direct editor:

1. If another aid is active, release it by the finish sequence below.
2. Record the new aid locally.
3. Dispatch `{aid}` synchronously.
4. Initiate exactly one `window.doc.realtime.publish({t:"edit.claim", aid})` without awaiting it.

`publish()` is invoked only when P3-F's frozen one-method surface exists; absence, synchronous throw, rejection, or resolved false is swallowed. There is no retry. The editor remains usable when realtime is absent.

The finish sequence is idempotent. If no aid is active it does nothing. Otherwise it captures and clears the aid before side effects, dispatches `{aid:null}`, and initiates exactly one `publish({t:"edit.release", aid:captured})`. Run it on:

- `blur`, whether text changed or not;
- Escape cancellation, before the programmatic blur can run it again;
- save initiation, before the P4-B request begins;
- `pagehide`, before P3-G's later `bye` listener executes;
- switching directly from one editor to another.

Register P4-I's `pagehide` listener from `edit.js` during module evaluation. P1-B loads edit before presence, so that listener is earlier than P3-G's listener. No `unload` or `beforeunload` listener is added. A save never waits for release publication. A failed save does not restore the old claim; focusing the retry editor publishes a new claim.

P4-P may reuse the lifecycle for direct Edit only. Opening/focusing a suggestion draft must dispatch no local editing state and publish no claim/release.

### Presence amendment

P4-I amends P3-G's private `currentBeat()` to return exactly:

```text
{ label: localLabel, act: localEditingAid === null ? "reading" : "editing", aid: localEditingAid }
```

Install one `doc:edit-state` listener only after P3-G's valid session activation. Accept only the exact frozen detail shape above; malformed, accessor, symbolic, extra, non-frozen, invalid-aid, or wrong-prototype values do nothing without getter invocation. On acceptance, set the private `localEditingAid`. Do not publish from this listener: edit.js already publishes the edge transition, and the normal P3-G beat supplies renewal.

P3-G already validates P3-F frozen `doc:event` projections. Extend its closed accepted set with:

```js
Object.freeze({ source: "client", t: "edit.claim", clientId, aid })
Object.freeze({ source: "client", t: "edit.release", clientId, aid })
```

Use P3-F's exact client-id and aid grammars and descriptor requirements. Maintain a private `Map` from exact `clientId` to claimed `aid`:

- a valid claim replaces that client's previous aid;
- a release deletes only when the stored aid equals the event aid; an old/out-of-order release for another aid is ignored;
- a valid bye deletes the client's roster row and claim in one material repaint;
- roster expiry deletes the corresponding claim in the same sweep;
- a claim without a current roster row is retained but not rendered; the next valid beat may make it visible;
- the claim map itself has an unconditional 200-key cap: replacing the aid for an already claimed client is permitted at size 200, but every valid claim for any client without an existing claim key is dropped when `claims.size === 200`, regardless of whether that client is present in the roster; no path evicts a different client or creates key 201;
- cleanup clears the claim map and local aid with the existing roster/timer cleanup.

Claims are hints. They never extend a roster lease, call a clock, create a timer, or cause a beat. A current beat with `act:"editing"` and an aid updates the roster presentation but does not synthesize a missing claim; only `edit.claim` hides peer controls. This prevents an old replayed beat from becoming a new lock.

### Chip and affordance contract

At each material roster/claim repaint, index exact unique `[data-aid]` elements as P3-G already does. A renderable claim requires a current roster entry for its client, a unique connected matching block, an open closest `details`, and that block's immediate next element sibling to be one `div.doc-edit-controls` containing exactly one descendant `button.doc-edit-button`. Invalid, duplicate, disconnected, closed, noneditable, ambiguous, nonadjacent, or control-less targets render nothing and hide nothing.

For each eligible block with one or more claimants, raw-sort claimants by their existing first-sight `order`. Insert exactly one noninteractive element immediately before the direct-edit button:

```html
<span class="pill warn doc-edit-claim" role="status">Avery Quill is editing</span>
```

For one claimant, text is `<label> is editing`. For two or more, text is `<N> people are editing`. Set `title`/`aria-label` to the semicolon-separated, first-sight ordered `<label>, editing` phrases. Labels enter only through text properties. Never expose client IDs. Set the direct-edit button's HTML `hidden` attribute while the chip exists and remove it when the last renderable claim leaves. Do not hide Suggest, comment, share, panel, or prose controls.

If a local editor is already active on that exact block, keep its direct-edit button in its existing P4-B editing state and do not insert a chip into the editing host; a peer claim remains in memory and appears after local editing ends if still leased. This avoids moving focus-owned DOM while typing. A forced request issued through developer tools remains possible and reaches the server hash check.

The classes `pill warn` reuse P1-B's existing component styling. No inline styles and no CSS amendment are permitted. `role=status` supplies text, so color is never the only signal. Print inherits P4-B's rule hiding `.doc-edit-controls`; P4-I adds no printable content outside that wrapper.

## Files owned

- `templates/base/edit.js` — **amended**, created by P4-B; add only local claim/release lifecycle and keep P4-B request/overlay behavior.
- `templates/base/presence.js` — **amended**, created by P3-G; add only local activity, claim registry, chip, and direct-edit-button suppression.
- `scripts/test-p4-i.mjs` — **new**, created only by P4-I; permanent self-supervising lifecycle/DOM/browser regression runner.

No CSS file is owned. `presence.css`, `edit.css`, `realtime.js`, APIs, layout, storage, generated output, and other tickets must not change.

## Dependencies

- **P1-B:** exact edit-before-presence module order; it makes P4-I's `edit.js` pagehide listener register before P3-G's bye listener.
- **P3-F (through P3-G):** frozen always-settling `publish()` and exact frozen claim/release `doc:event` variants on the client channel.
- **P3-G:** validated roster, first-sight ordering, 20-second beats, 50-second/5-second lease sweep, privacy state, page lifecycle, and `currentBeat()` seam. P4-I preserves all of them.
- **P4-B:** one direct editor, `button.doc-edit-button` within the immediately following `div.doc-edit-controls`, save/cancel/blur lifecycle, and server 409 conflict authority.
- **P4-M (release dependency, no shared client file):** final server authorization and hash-conflict enforcement. P4-I may be authored before P4-M, but the combined write release is not complete without it.

Maximum parallelism: after P3-G and P4-B are each integrated, one owner amends both shared files as one atomic ticket. P4-I cannot author in parallel with P4-B, P3-G, or P4-P because each shares at least one file. P4-Q may be authored concurrently after P4-A because its files are disjoint, but shared browser/generated gates run serially on the combined branch. P4-P starts after P4-I and P4-Q.

## Acceptance criteria

- [ ] Only the three owned JavaScript files change; no CSS, storage, server, provider, package, or generated file is amended.
- [ ] GitHub issue #31 retains the exact title `P4-I — The editing soft lock`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] Direct focus publishes one exact claim and dispatches one exact local state; every finish trigger publishes at most one matching release and dispatches reading/null before write/navigation work.
- [ ] Suggestion drafting publishes no claim/release and never changes the heartbeat to editing.
- [ ] Missing/failing realtime never blocks focus, blur, save, navigation, or cleanup and creates no retry/timer.
- [ ] P3-G's ordinary heartbeat reports the local active direct-edit aid and returns to reading/null on finish while preserving every privacy/visibility schedule.
- [ ] Only exact frozen P3-F claim/release projections mutate the claim map; it never exceeds 200 keys, an existing key may replace its aid at the cap, and every previously unseen client is dropped at the cap whether rostered or not; stale releases, malformed variants, server-source events, and accessors do nothing.
- [ ] Bye/expiry removes a claim; claim traffic does not renew a lease; out-of-order releases cannot clear a newer claim.
- [ ] One eligible peer claim produces one safe-text chip and hides only the direct Edit button; multiple peers collapse to a count; invalid/duplicate/closed/disconnected/control-less targets and the local active host are untouched.
- [ ] Forced concurrent saves remain possible and the second authoritative P4-B/P4-M write returns its exact 409 response.
- [ ] Pagehide ordering is release, then P3-G bye; no duplicate release occurs through blur/pagehide/save overlap.
- [ ] The finite fixture matrix below passes with no unhandled rejection, console output, leaked timer, network outside the injected publish seam, or client ID in DOM.

## Test plan

First run exact syntax gates:

```bash
node --check templates/base/edit.js
node --check templates/base/presence.js
node --check scripts/test-p4-i.mjs
```

`scripts/test-p4-i.mjs` is a permanent Node 22 entry point with no public arguments. It evaluates the two real browser scripts with closed invented DOM/clock/event/publish/fetch fixtures. It launches runtime and browser workers as direct children in separate mode-`0700` temporary roots, gives each 180 seconds, caps captured output, forwards HUP/INT/TERM, escalates TERM to KILL, reaps the child, proves its process group absent, and removes the guarded root before success. Its signal probes require 129/130/143 and its deadline probe requires 124. The browser worker installs only Playwright `1.55.0` under its temporary root, serves an invented two-page loopback fixture, and removes all install/browser/server state. It reads no credential or remote service.

Run exactly:

```bash
node scripts/test-p4-i.mjs
```

The runtime matrix covers claim success/false/reject/throw; blur, unchanged blur, save, Escape, switch, pagehide, and overlapping finish calls; suggestion-focus exclusion; exact/malformed local events; both exact remote variants; wrong source/name/keys/types/descriptors; claim-before-beat; a full 200-key map followed by both an unrostered and a rostered previously unseen claimant, each remaining at 200; same-client replacement at 200; same/different-aid release; bye; 49,999/50,000/54,999 ms sweeps; one/two/three peers; invalid/duplicate/disconnected/closed/nonadjacent/no-controls/local-active blocks; hide/show; hidden/visible/pagehide/BFCache; and a forced two-save 409 stub. The browser matrix injects exact P3-F events, proves the chip reuses computed `.pill.warn` styling, button `hidden` changes, keyboard focus is not moved, controls are absent in print, and a forced second POST observes 409. Success has no stderr, exits `0`, and writes exactly:

```text
PASS P4-I supervisor signals and deadline
PASS P4-I claim lifecycle, lease, chip, and advisory-conflict matrix
PASS P4-I rendered peer chip, focus, print, and forced-conflict behavior
PASS P4-I fixture cleaned
```

Run repository and ownership gates:

```bash
set -euo pipefail
: "${P4I_BASE:?set P4I_BASE to the reviewed P3-G/P4-B predecessor commit}"
test "$(git rev-parse --verify "$P4I_BASE^{commit}")" = "$P4I_BASE"

scripts/scrub-check.sh docs/tickets/P4-I.md templates/base/edit.js templates/base/presence.js scripts/test-p4-i.mjs
npm --prefix templates/docbuild run check
templates/check-dist
git diff --check "$P4I_BASE"...HEAD
git diff --check
P4I_OWNED="$({ git diff --name-only "$P4I_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-I.md' || true)"
test "$P4I_OWNED" = $'scripts/test-p4-i.mjs\ntemplates/base/edit.js\ntemplates/base/presence.js'
unset P4I_OWNED
issue_json="$(gh issue view 31 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-I.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-I — The editing soft lock"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-I repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #31 is updated: all commands exit `0`; scrub emits no denied term; TypeScript emits no diagnostic; `check-dist` reports byte-identical committed documents; ownership, whitespace, title, exact-body, full-SHA, and byte-equality checks emit nothing; the final line is exactly `PASS  P4-I repository and pointer gates`.

## Failure modes

- Lost, delayed, duplicated, or reordered claim/release: the UI may be stale until release, bye, or lease expiry; no write correctness changes.
- Realtime absent or down: no chip; direct editing still uses the authoritative block hash.
- Claim before beat: retained only within the 200-key bound and invisible until that client's valid roster beat.
- Tab/process death: no release may arrive; the existing 50-second roster lease removes the claim.
- Deliberately not handled: server-enforced locks, merged concurrent edits, caret/selection display, or suggestion-draft claims.

## Settled decisions

- The lock is advisory; the source/effective-base block hash is authoritative and still returns 409.
- Presence and claims are never persisted or audited.
- P3-F is the only transport and `doc:event` is the only wire projection bus.
- Server/client events carry ids and hashes, never edited text.
- The page remains framework-free, dependency-free, file-safe, and artifact-safe.
- Only direct Edit claims a block; Suggest does not.

## Assumptions and open questions

- **Assumption:** P4-B renders its direct button as `button.doc-edit-button` inside the block's immediately following `div.doc-edit-controls`; this ticket freezes that amendment seam.
- **Assumption:** reusing the existing `pill warn` component meets the requested “editing chip” without a CSS ownership expansion. If product wants a different visual, a separate owner must explicitly amend a stylesheet.
- **Assumption:** pinned Playwright installation is test-only and remains inside the runner's guarded temporary root; no package or lockfile amendment is required.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.6, 3.4, 4.7, and 5 — ephemeral-state prohibition, advisory lock, hash authority, sequencing, and rejected CRDT/server-lock scope.
- `docs/research/07-realtime-and-presence.md` §§7, 8.1, 8.4, 9, and 12 — claim/release intent, chip behavior, degradation, and ticket boundary.
- `docs/tickets/P3-F.md` — exact publish input and frozen receive-event contracts.
- `docs/tickets/P3-G.md` — roster lease, privacy, lifecycle, first-sight labels, and `currentBeat()` amendment seam.
- `docs/tickets/P4-B.md` — direct-edit lifecycle, control DOM, and authoritative conflict response.
- HTML Standard editing-host definition, accessed 2026-09-03: https://html.spec.whatwg.org/multipage/interaction.html#editing-host
