# Handoff: run this build with Aiur

You are the next agent on this repository. Your job is to get an Aiur run executing the Build Order that
is already in GitHub issues. **Read this whole file before running anything.**

The work is already planned. Nothing here asks you to design the platform — that argument is settled in
`docs/research/00-integration-plan.md`, which rules over every numbered research document.

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

Two properties of the graph you must preserve, because getting them wrong wastes a whole phase:

- **P1-B (issue #2) is the keystone.** Everything in phases 2 to 4 waits on it. It lands alone.
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

## Environment hazards measured on this machine

Every one of these was hit during the session that produced this repository. They are facts about this
host, not guesses.

**Aiur prefers `GITHUB_TOKEN` over `gh` keyring auth, and a wrong token hard-pauses the fleet.** A token
that cannot reach the repository returns **HTTP 404**, not 403, and `system.tracker.auth_preflight_failed`
pauses dispatch. In the sibling repository the bad token came from a repo-local `.env` that the daemon
inherited at launch. Before launching: confirm no stale `GITHUB_TOKEN` is in the launching shell, and that
`gh api` reaches this repository. **Never print token material** — check for the variable's presence, not
its value.

Note that this repository is under the `aiur-team` **organisation**. A freshly created PAT is not
authorised for an org by default: a classic token needs SSO authorisation, and a fine-grained token needs
the org as its resource owner. Both failure modes present as the same 404.

**`aiur status` can misreport why the fleet is idle.** It reported `AGENTS 0/15 (binding: ticket supply)`
while dispatch was in fact hard-paused on the auth failure above. Read `alerts --needs-attention`
alongside it; do not trust the binding line alone.

**Alerts persist across repositories and daemon restarts.** The `ACTIONABLE` list showed twelve alerts
dated nearly two months earlier, referencing tickets from a different repository entirely. **Check every
alert's timestamp before acting on it,** and trust the state table over the alert list.

**`Aiur.LauncherWatchdog` was observed DOWN** (`SUPERVISION 123/124`). If you see it, report it; do not
treat a degraded supervision tree as normal.

**macOS specifics.** There is no `timeout` binary — use `gtimeout` or omit it. `/bin/bash` is 3.2 and has
no `mapfile`; `bash` in `PATH` is 5.3 from homebrew, so a script that works interactively can still fail
under `/bin/bash` or in CI. `templates/check-dist` is already written for 3.2.

---

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
