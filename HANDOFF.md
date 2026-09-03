# Handoff: run this build with Aiur

You are the next agent on this repository. Your job is to get an Aiur run executing the Build Order that
is already in GitHub issues. **Read this whole file before running anything.**

The work is already planned. Nothing here asks you to design the platform — that argument is settled in
`docs/research/00-integration-plan.md`, which rules over every numbered research document.

## Current coordination status

The Phase 1 specifications in `docs/tickets/P1-A.md` through `docs/tickets/P1-E.md` are complete,
reviewed as implementable without the integration plan, pushed to the handoff branch, and copied exactly
into issues #1 through #5. A separate specification lane is researching every remaining ticket phase by
phase. It will add and push `docs/tickets/P2-*.md`, `P3-*.md`, and `P4-*.md` and replace only the matching
issue bodies after each phase passes a body-only review.

**That specification work does not block Aiur from beginning Phase 1 now.** The Aiur Executor may dispatch
Phase 1 from issues #1 through #5 while the specification lane works on issues #6 through #42. Do not
dispatch a later phase until its rewritten issue bodies have been pushed and reviewed. The two lanes must
not edit the same issue or ticket document: the specification lane owns only the remaining ticket docs and
issue bodies, while Aiur owns Phase 1 implementation branches and pull requests.

Phase 1 maximizes parallel source work without pretending integration is parallel. P1-A, P1-B, P1-C, and
P1-E may be authored concurrently in isolated worktrees; integrate P1-A before P1-B, start P1-D from the
integrated P1-B contract, and integrate P1-E only after P1-A and P1-B. Generated compiler output, document
HTML, anchor state, `_site/`, and the repository-wide gates are refreshed serially on the combined branch.

---

## The sequence

Three steps, in order. Step 2 is the operator's, not yours.

### 1. Create the Build Order in Aiur — yours

The 42 tickets exist as GitHub issues **#1 to #42**, each already labelled `agent:todo` and `phase:N`.
Issue **#43** is the Build Order root, labelled `build-order`; it is a container and is never dispatched.

Write the planning pack and register it with Aiur. The schema, from a working pack:

```json
{
  "schema_version": 1,
  "build_order_id": "aiur-team/architecture-docs:platform",
  "title": "Architecture docs platform",
  "subtitle": "Hosting, comments, editing, roles and realtime — 42 tickets, 4 phases",
  "repository": "aiur-team/architecture-docs",
  "plan_version": 1,
  "workstreams": [{ "id": "build", "title": "Builder" }, { "id": "api", "title": "Functions" }],
  "tickets": [
    {
      "id": "P1-B",
      "title": "The keystone: every placeholder and hook call site",
      "lane": "build",
      "phase": 1,
      "complexity": 4,
      "depends_on": [],
      "ticket": 2,
      "doc": "docs/research/00-integration-plan.md"
    }
  ]
}
```

**Fill `ticket` with the real issue number.** Earlier packs carried `"ticket": null` because they were
written before the issues existed. That is not the case here — the issues exist, and a pack with nulls
will not connect a ticket to its issue.

Take `id`, `phase`, `depends_on` and the file surface from each issue body; every issue states its phase,
its dependencies and the files it owns. **Do not re-derive the dependency graph from the prose** — the
issue bodies are the authority, and `docs/research/00-integration-plan.md` §4.3 to §4.7 is where they came
from.

Properties of the graph you must preserve, because getting them wrong wastes a whole phase:

- **P1-B (issue #2) is the keystone.** Everything in phases 2 to 4 waits on it, and P1-D amends a stub it
  creates. Phase 1 source authoring may still fan out: P1-A, P1-B, P1-C, and P1-E have disjoint source
  ownership. Integration is ordered P1-A, then P1-B; P1-D follows P1-B; P1-C is independent; P1-E merges
  and completes site acceptance after P1-A and P1-B, with that acceptance rerun after P1-D if necessary.
- **Phase 4 is sequenced, not parallel, wherever a file is shared.** Nine phase-4 tickets amend a file an
  earlier ticket creates. Each issue names it. Treat any file that several ready tickets all list as a
  clique and admit those tickets one at a time.

Lanes are yours to choose. A reasonable split: the builder modules, the Netlify functions, the client
scripts, and the access/identity work.

### 2. `aiur init` — the operator's

**Stop and hand back after step 1.** The operator runs `aiur init` in this repository. Do not run it
yourself and do not create `.aiur/config`.

When they tell you it is done, verify before launching:

```bash
aiur status                        # LISTENER present, and read the binding line
aiur alerts --needs-attention      # check timestamps, see the hazards below
gh api repos/aiur-team/architecture-docs/issues?per_page=1 >/dev/null && echo "tracker auth OK"
```

The labels already exist (`agent:todo`, `build-order`, `phase:1` to `phase:4`, `priority:1`). If
`aiur init` adds its own lifecycle labels, reconcile rather than relabelling 42 issues by hand.

### 3. Run all phases — yours

Invoke the `aiur-run` skill and act as Executor. That skill owns the detail: launch flags, the wake
monitor, the capacity audit, the hourly retrospective, review fan-out, and the merge policy. This file
only records what is specific to *this* repository.

Phase 1 may start as soon as the operator has completed step 2; it does not wait for the separate ticket
specification lane to finish phases 2 through 4. Before advancing Aiur to a later phase, confirm that the
matching `docs/tickets/` files exist on the handoff branch, their issue bodies match, and the phase's
body-only reviewer passed them.

---

## Authority envelope

Recorded so you do not have to ask, and so you do not assume more than this.

| | |
|---|---|
| **Scope** | The 42 tickets in issues #1–#42. Nothing else. |
| **Merge** | **The operator merges. You do not.** Open PRs, review them, coordinate rework, and say when something is ready. |
| **Issue creation** | Only the Build Order pack in step 1. **Do not open new issues** — including for defects you find — without asking. Report them instead. |
| **Self-fix and takeover** | Permitted under the convergence rules in the `aiur-run` skill. Preserve the original branch and record why. |
| **Force-push, history rewrite, branch deletion** | Not permitted. |
| **Scope growth** | Not permitted. If a ticket turns out to need work no ticket owns, stop and report it. |

---

## Non-negotiable: this repository becomes public

It is private today and will be made public. It was extracted from a private repository, and the
documents here were written about real internal systems before being generalised.

**`scripts/scrub-check.sh` must pass on every branch, and it runs first in CI** — before the typecheck,
because if private context is present nothing else about the build matters.

Two things that gate is protecting against, both of which actually happened during the extraction:

- **A pattern that was almost right.** A hyphenated deny term missed the same name written with a space.
  If you add a multi-word internal name, write it as `name[-_ ]part`, never with a literal hyphen only.
- **Sample data, not identifiers.** The real leak was example payloads — the private product's own
  architecture sentence used as demo text in four documents. Identifier substitution would never have
  caught it. **If you add an example anchor, comment body or document title, invent it.** Do not reach
  for something real.

Adding a term to the deny list is cheap. Removing one requires knowing why it was added.

---

## Running on a second machine

The repository carries everything about *the work*: this file, the plan, all ten research documents, the
`architecture-doc` skill, the scrub gate, CI, and `check-dist`. A fresh clone plus Node 18 or later builds
every document. **What it does not carry is Aiur itself.** Four things must be set up per machine.

**1. The Aiur skills, and you need more than one.** They live in the Aiur source repository under
`.claude/skills/` and are exposed to Claude Code by symlink. There are eight — `aiur-run`, `aiur-agent`,
`aiur-build`, `aiur-debug`, `aiur-handoff`, `aiur-intro`, `aiur-meta`, `aiur-monitor` — and **`aiur-run`
delegates to four of the others in nine places**: the monitoring loop is `aiur-monitor`, the hourly
meta-check is `aiur-meta`, the credential recipe is in `aiur-agent`, and the handoff format is
`aiur-handoff`. Linking only `aiur-run` leaves those instructions unreachable, and the failure is quiet:
the Executor simply never runs the loop it is told to run.

```bash
git clone <the aiur repo> ~/src/aiur
mkdir -p ~/.claude/skills
for s in aiur-run aiur-agent aiur-build aiur-debug aiur-handoff aiur-intro aiur-meta aiur-monitor; do
  ln -sfn ~/src/aiur/.claude/skills/"$s" ~/.claude/skills/"$s"
done
# Then prove every link resolves. A dangling symlink is silent.
for s in ~/.claude/skills/aiur-*; do [ -e "$s" ] || echo "DANGLING: $s"; done
```

That last loop is not decoration. On the machine this handoff was written on, `aiur-status` was a dangling
symlink to a skill that no longer exists, and seven of the eight were never linked at all.

**2. `aiur-cli`, and expect version drift.** Installed with `bun add -g aiur-cli@latest`. The machine this
was written on runs `0.0.1` while the registry is at `0.0.5`, so a fresh install will **not** behave
identically to what is described here. If a command in `aiur-run` does not exist or behaves differently,
suspect the version before suspecting the instructions.

**3. GitHub auth — and this is where the 404 comes from.** See the hazards below; it is the single most
expensive failure in this list.

**4. `aiur init`, run by the operator.** `~/.aiur/` starts empty on a new machine: no config, no findings
ledger, no handoff archive, no prewarm base record. **You therefore start with no history**, and the
Executor procedure leans on prior handoff archives to tell a recurring fault from a new one. Treat the
first run on a new machine as having no baseline, and say so rather than inferring a trend from one
sample.

## Environment hazards

### Portable — true on any machine

**Aiur prefers `GITHUB_TOKEN` over `gh` auth, and a wrong token hard-pauses the whole fleet.** A token
that cannot reach the repository returns **HTTP 404, not 403**, and `system.tracker.auth_preflight_failed`
pauses dispatch. On the machine this was written on the bad token came from a repo-local `.env` that the
daemon inherited at launch, and it took a process-environment check to find.

This repository is under the `aiur-team` **organisation**, which is the part that catches people: a fresh
personal access token is not authorised for an org by default. A classic token needs SSO authorisation; a
fine-grained token needs the org as its resource owner, which **cannot be changed after creation**. Both
present as the same 404, and so does a token that simply lacks `repo`.

Before launching, and **never printing token material**:

```bash
[ -n "$GITHUB_TOKEN" ] && echo "GITHUB_TOKEN is set — is it the right one?" || echo "unset; gh auth will be used"
gh api repos/aiur-team/architecture-docs/issues?per_page=1 >/dev/null && echo "tracker auth OK"
# If a token is set and 404s, this shows why without revealing it:
curl -sS -D- -o /dev/null -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/aiur-team/architecture-docs | grep -iE '^(HTTP/|x-github-sso|x-oauth-scopes)'
```

**`aiur status` can misreport why the fleet is idle.** It reported `AGENTS 0/15 (binding: ticket supply)`
while dispatch was in fact hard-paused on the auth failure above. An operator reading `status` alone
concludes there is no work queued and goes off to create tickets. **Read `alerts --needs-attention`
alongside it** and do not trust the binding line by itself.

**Alerts persist across repositories and daemon restarts.** The `ACTIONABLE` list showed twelve alerts
dated nearly two months earlier, referencing tickets from a completely different repository. **Check every
alert's timestamp before acting,** and trust the state table over the alert list.

**`Aiur.LauncherWatchdog` was observed DOWN** (`SUPERVISION 123/124`). Report a degraded supervision tree;
do not treat it as normal.

### This host: Omarchy (Arch)

The scripts in this repository are written to be portable and the notes below are the reason.

- **GNU coreutils and bash 5 are present**, so `timeout`, `mapfile` and GNU `grep`/`sed`/`find` all behave
  as documented. `templates/check-dist` avoids `mapfile` anyway, because it also has to run under the
  bash 3.2 that ships on macOS — leave it that way rather than "modernising" it.
- **Install the toolchain with pacman**: `nodejs`, `npm`, `git`, `github-cli`. Arch is rolling, so Node
  will be well past the 18 minimum.
- **`gh` has no system keychain to fall back on.** On macOS it stores an OAuth token in the keychain; on
  Arch it writes `~/.config/gh/hosts.yml` unless a secret service is running. That file is plaintext —
  worth knowing before you copy it anywhere, and a reason to prefer `gh auth login` on each machine over
  moving credentials between them.
- **Hyprland is Wayland.** Anything that wants a browser for a screenshot or a dashboard capture needs a
  headless browser explicitly; do not assume a display is available to a background agent.
- **A note if a future ticket needs the site build:** nothing here requires a Rust toolchain any more. The
  builder is TypeScript, so `nodejs` is the only language runtime to install.

## What "done" means for a ticket here

**`templates/check-dist` is the acceptance test.** It rebuilds every document and fails if committed
`dist/` changed. That test is what allowed this builder to be rewritten three times — Python, then Rust,
then TypeScript — without altering one byte of any document's output. A change that alters existing output
is a bug until proven otherwise, and P1-B in particular must not.

Alongside it: `npm --prefix templates/docbuild run check` typechecks under `strict` with
`noUncheckedIndexedAccess`, and the builder has **zero runtime dependencies**. Do not add one. TypeScript
is the only devDependency.

One trap in the builder, already commented in the source: substitution uses `split`/`join`, **not
`replaceAll`**, because a string replacement in `replaceAll` interprets `$&` and `` $` `` as capture
references and real section bodies contain `$`. Do not "simplify" it back.

---

## Decisions that are already made

These are settled. A ticket does not get to revisit them, and if one appears to require it, stop and
report rather than deciding.

- **State store:** one blob per record. Never a shared mutable array. Plan §1.1.
- **Realtime:** one hosted broker on its free tier, opt-in per site, absent by default. Netlify cannot
  hold a socket and has no fan-in. Presence is never persisted. Plan §1.6.
- **Authority:** one owner per document plus three grantable roles, held in the state store, with every
  grant change writing an append-only audit event. Plan §1.5.
- **Ownership in standalone mode:** seeded by a site environment variable. Plan §1.4.
- **Anchoring:** `norm()` and the block scanner are **one shared function** the builder calls and the page
  inlines. There is no second implementation and no cross-language fixture. Plan §3.3. A client that
  reimplements `norm()` recreates the exact bug this ruling exists to prevent.

---

## When you are done

The terminal condition is not "42 issues closed". It is: every ticket implemented and reviewed, integrated
with green CI on the current base, merged **by the operator** under the recorded policy, documented, and
the scrub gate passing. Deferred non-blockers do not extend that boundary.

Before you run out of context, replace this file's operational sections with what you learned, and leave
the next agent a three-to-five sentence goal naming the Executor role, the authority envelope above, the
Build Order id, and the immediate next actions.
