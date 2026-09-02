---
name: architecture-doc
description: "Turn raw research into a cohesive architecture document using the architecture-doc template. Use when asked to write, restructure or update an architecture doc, design doc, feature analysis or technical brief in a repo that uses this template — including 'turn these notes into a doc', 'write this up as an architecture doc', 'add a section to <doc>', or when handed meeting notes, research files or a prototype and asked to produce a document from them."
---

# Writing an architecture document

You turn raw material — research notes, meeting transcripts, a prototype, a pile of decisions — into one
document an engineer can act on. The template handles the chrome. Your job is the thinking.

Read this whole file before you start. Then look at a finished document, because the shape is easier to
copy than to describe.

**Find the exemplar in the repo you are working in.** Build the component reference and open it — it is
built by this template, so it cannot drift from the CSS, and it ships wherever the template ships:

```
templates/build templates/components && open templates/components/dist/components.html
```

That shows you every component. For the *argument* — how a real document is structured, what earns a
section, how uncertainty is carried — read the most complete document already in the consuming repo,
which its README should name. **Do not assume a particular exemplar file exists.** The template travels
between repositories and the documents do not; a document that was the reference in one repo may be
absent, renamed, or restricted in another. If you find no finished document, this file is the
specification and the component reference is the visual source of truth.

**A note on where things live.** The template, the builder, the skeleton and this skill are portable and
move together. Documents, research and their sources belong to the repo that owns the subject matter and
stay there. If an instruction here names a document rather than a component, treat it as an example and
not as a path you can rely on.

## The one rule

**A document is an argument, not a summary.** If a reader can only take one sentence away, decide now what
that sentence is and put it in the thesis box. Everything else earns its place by supporting it or by
honestly limiting it.

A summary tells the reader what exists. An argument tells them what to believe and why, and what would
change your mind. Only the second is worth their time.

## Build and preview

```bash
cp -r templates/skeleton my-doc          # start
$EDITOR my-doc/doc.json                  # masthead
$EDITOR my-doc/sections/*.html           # content, one file per section
templates/build my-doc                   # -> my-doc/dist/my-doc.html
```

**The wrapper name is repo-local.** This file writes `templates/build` throughout. A repo that consumes
the template as a package may expose the builder under a different name; that repo's README is
authoritative. The arguments and the output path never change, so nothing else in this file depends on it.

Every component is rendered live with its markup here:

```bash
templates/build templates/components && open templates/components/dist/components.html
```

**Never hand-write the page chrome.** No `<html>`, no `<head>`, no masthead, no nav, no theme toggle. A
section file contains content and nothing else.

## From raw material to a document, in order

### 1. Find the argument before you write anything

Read everything first. Then write one sentence: *the claim this document makes*. If you cannot, you do not
understand the material yet, and writing sections will produce a summary.

Test it: could a reasonable engineer disagree with it? If not, it is a description, not a claim. "The system
has three components" is a description. "The system can prove every transaction was evaluated, and that is
a different claim from preventing bad ones" is an argument.

### 2. Sort the material into three piles

- **Load-bearing.** Facts the argument depends on. These go in the body with a number attached.
- **Supporting.** True and useful, but a reader can skip it. These go in a nested `details.dx`.
- **Cut.** Interesting, not relevant. Leave it in the research file and link to it.

Most raw material is the third pile. A document that includes everything makes the reader do the sorting you
were supposed to do.

### 3. Choose the sections

The skeleton offers six: problem, solution, architecture, API, build order, open questions. **They are a
starting point, not a requirement.** Delete what the document does not need, and add what it does. A
document arguing toward a decision often wants a `decisions` section, which the skeleton does not
include; a document with nothing to decide should drop `open questions` rather than pad it.

Rules that matter more than the list:

- **Six top-level sections is about the limit.** Past that the jump nav stops being scannable. Go deeper
  with `details.dx` instead of wider.
- **Order sections so each one earns the next.** Problem before solution. Guarantees before the API that
  exposes them. If the order is arbitrary, a reader assumes the content is too.
- **One section, one job.** If you cannot write its summary line in two sentences, it is two sections.

### 4. Write each section

Every section needs three things.

**A summary line** that says what the section concludes, not what it covers. "Hard guarantees exist at the
bridge; the sequencer detects and does not enforce" beats "an overview of enforcement".

**A peek.** This is the only part most readers see, so it is the most valuable markup in the document. Put
the section's key diagram, comparison table or set of chips there. Never restate the summary line.

**A body** that opens with the conclusion and then supports it. Put the limits before the capabilities: a
reader who finds a limit you hid stops trusting the rest.

### 5. Check it against the reader

Before you build, answer these:

- What does a reader do differently after reading this? If nothing, it is notes, not a document.
- What is the most hostile question, and does the document answer it in its own voice? Ask it yourself,
  first. Being the one to state the weakness is what makes the rest credible.
- Is every number attributable? Say where it came from, or say it is an estimate.
- Would the person whose work this describes recognise it?

## Handling uncertainty

This matters more than anything about layout.

| Situation | What to write |
|---|---|
| A number from one source | Give it, name the source, say it is not measured by us |
| Two sources disagree | State both, pick one, say why. Never average them |
| Nobody knows | Put it in open questions. Do not let it hide as a passive sentence |
| You could not verify it | Mark it unverified where it appears, not only in a footnote |
| A decision is not yours | State the options and the trade-off. Do not smuggle a preference in as a fact |

**Never present a summary as a measurement**, and never launder a guess into confident prose. A document
that is wrong once is not trusted again.

## Open questions are the most useful section

Write them as questions, then say **what changes depending on the answer**. A question with no consequence
is a note. Rank them by how much they would change the design, not by how easy they are.

If a question is load-bearing — the whole design rests on it — say so plainly and put it first.

## Diagrams

Hand-built from the template's components. **Do not add a diagram library.** Mermaid renders one fixed
theme, cannot be verified before publishing, and needs a script the CSP may block.

- A diagram must show a **mechanism**, not decorate a heading. If it restates the sentence above it, delete
  it. Four labelled boxes and one arrow is not a diagram.
- Every colour must mean one thing, and a legend must say what. The template gives you `ok`, `warn` and
  `risk` deliberately unnamed: each document declares what they mean.
- Reach for `.flow` for a pipeline, `.seq` for an ordered exchange between parties, `.bands` for thresholds
  or tiers, and a table when the content is really a table.

## Copy

- Active voice. Short sentences. One idea per sentence.
- Name things the way a reader recognises them, not the way the system is built.
- No filler openers, no "it is important to note", no rhetorical questions.
- **Avoid negative parallelism.** "It is not X, it is Y" is a tic. State Y.
- No em-dash-and-restate as a habit. No reflexive triplets.
- Do not assert a conclusion that is not yours to draw. Describe what the thing does.

## Before you say it is done

```bash
templates/build my-doc
```

The builder fails on a missing section field, a duplicate id, and an unfilled placeholder. It then reports
tag balance, theme states and size. **Read that output.** An unbalanced tag means you dropped a `</div>`.

Then render both themes and look at them. A colour declared only inside a media or `[data-theme]` block
renders one theme's text on the other theme's ground, and it is the single most common way these documents
break:

```bash
for t in light dark; do
  { printf '<!doctype html><html data-theme="%s"><head><meta charset="utf-8"></head><body style="margin:0">' "$t"
    sed 's/<details class="sec">/<details class="sec" open>/g' my-doc/dist/my-doc.html
    printf '</body></html>'
  } > "/tmp/$t.html"
done
# then screenshot /tmp/light.html and /tmp/dark.html and actually look
```

Commit `dist/` with the source. A reviewer must be able to open the document without a toolchain.

## Updating an existing document

Edit the section file, rebuild, commit both. Do not edit anything in `dist/` by hand — it is generated and
the next build discards it.

When new research contradicts what a document already says, **do not quietly overwrite it.** Say what
changed and why the earlier reading was wrong. A document whose history is visible is more trustworthy than
one that has always been right.
