# Architecture docs

A template for architecture documents that build into **one self-contained HTML file** — inlined CSS and
JS, theme-aware, no bundler, and no external requests. A document opens from `file://`, survives being
emailed, and can be published anywhere that serves static files.

```bash
cp -r templates/skeleton my-doc
$EDITOR my-doc/doc.json                  # masthead
$EDITOR my-doc/sections/*.html           # content, one file per section
templates/build my-doc                   # -> my-doc/dist/my-doc.html
```

Needs **Node 18 or later** and nothing else. The builder has no runtime dependencies; TypeScript is the
only devDependency and it is fetched once, on the first build.

## What is here

| Path | What it is |
|---|---|
| `templates/base/` | The theme, the components, the page skeleton, the runtime JS |
| `templates/docbuild/` | The builder. TypeScript, zero runtime dependencies |
| `templates/skeleton/` | Copy this to start a document |
| `templates/components/` | Every component, rendered live with its markup |
| `example/` | A complete worked document. Read this one first |
| `docs/research/` | The platform design: hosting, auth, state, comments, editing, history, realtime, roles |
| `.claude/skills/architecture-doc/` | How to turn raw research into a document |

## Read the example

```bash
templates/build example && open example/dist/example.html
```

`example/` is a finished document about an invented subject. It is the reference for both the components
and the *shape* — how a thesis is stated, how a diagram earns its place, how uncertainty is carried
without hedging. **Point an agent at it rather than describing what good looks like.**

`templates/components/` is the exhaustive component reference. It is built by this template, so it cannot
drift from the CSS.

## Checks

```bash
templates/check-dist        # rebuild every document; fail if committed dist/ changed
scripts/scrub-check.sh      # fail if private context reached this repository
npm --prefix templates/docbuild run check   # typecheck
```

`check-dist` is the acceptance test that let the builder be rewritten twice — Python, then Rust, then
TypeScript — without altering a single byte of any document's output.

`scrub-check.sh` exists because this repository was extracted from a private one. The documents here were
written about real internal systems before being generalised, and prose survives a rename. The gate is
the mechanical backstop so nobody has to rely on having read carefully. **Adding a term to it is cheap;
removing one requires knowing why it was added.**

## Writing a document

Read `.claude/skills/architecture-doc/SKILL.md`. Its one rule is the one that matters:

> **A document is an argument, not a summary.** If a reader can only take one sentence away, decide now
> what that sentence is. Everything else earns its place by supporting it or by honestly limiting it.

## The platform

`docs/research/` designs the layer above a static document: hosting, sign-in, comments anchored to text
that moves, inline suggestions and edits, per-document roles, document history, and near-real-time
presence. `docs/research/00-integration-plan.md` is the ruling document — where it and a numbered
research document disagree, the plan is correct.

None of it is implemented yet. The tickets are in this repository's issues.
