# Prompt: make the Build Order tickets implementable

**How to use this:** point an agent at this file. Everything below the line is the instruction.

---

Read `HANDOFF.md`, `README.md` and `docs/research/00-integration-plan.md` in this repository
(`aiur-team/architecture-docs`) before you do anything else.

## The problem

The 42 Build Order tickets — issues **#1 to #42** — are too thin to implement from. Their original
bodies average about 900 bytes and do not point to complete, executable specifications.

Issue **#27, "P4-D — The Slack webhook"**, is the clearest example. It says to fire from
`context.waitUntil` and names one file. It never says what the notification *contains*, where the webhook
URL comes from, what the payload shape is, what happens when the URL is unset, which events fire it, or
how to test any of it. An agent picking that up would guess, and two agents would guess differently.

Every ticket has this problem to some degree.

## The goal

**Write all 42 canonical ticket documents so each is implementable without reading the plan, then make
each GitHub issue body a short permanent link to its canonical document.**

The relationship between the documents and the tracker inverts. Today the issue points at the plan and
the plan holds the detail. After this work, **`docs/tickets/<TICKET-ID>.md` is the specification** — what
to build, and how to know it is done — while the issue is only its tracker pointer and the research
documents are background and citation for *why* a thing is the way it is. A reader should be able to
implement a ticket from the linked document alone and consult the plan only when they want the reasoning.

## Method

**Fan out background agents, one per ticket.** Each agent owns exactly two artifacts:

- `docs/tickets/<TICKET-ID>.md` — new
- the short pointer body of its own issue

It must not touch the plan, the research documents, another ticket's document, or another issue. That is
the same file-ownership rule the repository already applies to code: if two agents would write the same
file, one of them is wrong.

Per agent, use the compound-engineering skills — **`/ce-brainstorm` to settle WHAT, then `/ce-plan` to
settle HOW** — writing the result to `docs/tickets/<ID>.md`. After the phase documents are reviewed,
committed, and pushed, replace each issue body with this short form, using that pushed commit's full SHA:

```md
Implementation specification: [`docs/tickets/<ID>.md`](https://github.com/aiur-team/architecture-docs/blob/<FULL-COMMIT-SHA>/docs/tickets/<ID>.md)

This issue tracks implementation of the linked canonical specification.
```

Do not copy the specification into the issue. A full commit permalink is required so the issue never
silently changes meaning and does not break if the handoff branch is later deleted. Verify that
`git show <FULL-COMMIT-SHA>:docs/tickets/<ID>.md` is byte-identical to the local canonical document.

> **`ce-brainstorm` is interactive and a background agent cannot answer its questions.** It asks one
> question per turn and blocks. Instruct each agent to take its Phase 0.2 *"requirements are already
> clear"* path: skip the interactive elicitation entirely and go straight to synthesis in announce-mode.
> The product decisions are already settled in the plan, so there is genuinely nothing to elicit.
>
> Where something is still ambiguous, the agent **states the assumption explicitly** in the ticket under
> *Assumptions* — it must not block, and it must not quietly invent a decision and present it as settled.

If `/ce-plan` is not installed on this machine, the `ce-*` planning agents or the built-in planning agent
cover the same ground. `/ce-brainstorm` is known to be present.

## What every rewritten ticket must contain

1. **Outcome** — one sentence: what exists when this is done.
2. **Context** — two or three sentences on why this ticket exists. Not a history lesson.
3. **Scope** — what is in scope, and an explicit **out of scope** list. The second list is the one that
   prevents an agent from quietly widening the work.
4. **Interface contract** — exact function signatures, payload shapes, HTTP status codes, environment
   variable names, blob key paths, event names. Written out, not described in prose.
5. **Files owned** — exact paths, each marked *new* or *amended*. If amended, name the ticket that
   created the file, because that makes the sequencing visible.
6. **Dependencies** — ticket IDs **and what specifically is needed from each**. "Depends on P1-C" is not
   useful; "needs `identify()` from P1-C, which returns the session shape in plan §2.9" is.
7. **Acceptance criteria** — a checklist. Every item independently verifiable by somebody who did not
   write the code.
8. **Test plan** — exact commands and their expected output. Never "add tests".
9. **Failure modes** — the edge cases that must be handled, and the ones deliberately not handled.
10. **Settled decisions** — what this ticket may **not** revisit. See plan §1.1, §1.4, §1.5, §1.6 and
    §3.3.
11. **Assumptions and open questions** — anything the agent had to decide, flagged for a human.
12. **References** — plan and research sections, as citations.

## Hard constraints

- **This repository is private today and will be made public.** `scripts/scrub-check.sh` must pass on
  every new file and every rewritten body. **Any example payload, comment body, hostname, address or
  person must be invented.** Do not reach for something real. The one leak the gate caught during this
  repository's extraction was sample data, not identifiers.
- **Do not create or close issues.** Replace bodies only with the exact short canonical-document pointer.
- **Do not change ticket IDs or titles.** The Aiur planning pack keys on issue numbers, and a retitled
  issue breaks the mapping.
- **Do not change anything under `docs/research/` or `templates/`.**
- `templates/check-dist` and `scripts/scrub-check.sh` must both pass before you commit.
- Work on a branch and open **one** pull request. **Do not merge.**

## Batching

**Do not spawn 42 agents at once.** Work phase by phase, roughly six to eight concurrent, and check host
load before each batch and again before topping up. These agents run tests; nothing throttles them the way
the Aiur fleet is throttled.

**Do phase 1 first — issues #1 to #5 — and show me those five before continuing.** If the bar is wrong, it
should be corrected after five tickets rather than after forty-two.

## The acceptance test for your own work

After each batch, dispatch **one reviewer agent that reads only the canonical `docs/tickets/*.md`
documents** — not the issue pointer, plan, research documents, or code — and reports whether it could
implement each ticket from that text alone.

This is the only honest test of "implementable without the plan", because an agent that has already read
the plan cannot judge it: it will fill the gaps from memory and call the ticket complete. Anything the
reviewer cannot answer is a gap to fix now, not a note to file for later.
