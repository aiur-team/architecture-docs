# Architecture doc template

A small build step that composes a document into **one self-contained HTML file**.

Single file is not a preference. A published Claude artifact runs under a strict CSP that blocks every
external host except the font CDN, so relative CSS and JS would fail silently. The build inlines
everything.

## Make a new document

```bash
cp -r templates/skeleton my-doc
$EDITOR my-doc/doc.json                  # title, lede, masthead metadata
$EDITOR my-doc/sections/*.html           # one file per section
templates/build my-doc                   # -> my-doc/dist/my-doc.html
```

The builder is TypeScript with **zero runtime dependencies**. `templates/build` compiles it on first run
and caches the output, so the only thing you need installed is **Node 18 or later**. TypeScript is the one
devDependency and it is fetched once.

Run `templates/check-dist` to rebuild every document and assert the committed `dist/` is unchanged. That is
the acceptance test which allowed this builder to be rewritten twice without altering one byte of output.

Open `my-doc/dist/my-doc.html` in a browser, or publish it as an artifact.

## What is in a document

| Path | What it is |
|---|---|
| `doc.json` | Title, eyebrow, status chip, heading, lede, masthead metadata, footer |
| `sections/*.html` | One section each, ordered by filename. Rename to reorder |
| `extra.css` | Optional. Per-document CSS, appended last so it wins |
| `extra.js` | Optional. Per-document JavaScript, for something genuinely specific to one document |
| `dist/` | Build output. Committed, so a reviewer can open it without a toolchain |

The skeleton starts with six sections, which is the shape most of these documents want:

1. **The problem** — what is broken and what it costs, evidence before argument
2. **Solution** — the shape of the answer, and what it deliberately does not do
3. **Architecture** — the parts, how they fit, where the guarantees stop
4. **API** — the interface other systems call
5. **Build order** — how the work splits and where it parallelises
6. **Open questions** — what is unresolved and changes the design

Delete what you do not need. Add more by adding files. Use `details.dx` for depth inside a section rather
than adding top-level sections, so the jump nav stays scannable.

## Section file format

```html
<!--
id: architecture
label: Architecture
summary: One or two sentences, shown while the section is closed.
-->
<!-- peek -->
  ...closed-state markup, usually the section's key diagram...
<!-- body -->
  ...open markup...
```

`id` becomes the anchor and the nav target. Add `nav:` to use a shorter label in the jump nav. The peek
block is optional.

**The peek is the part that matters.** It is the only thing most readers see. Put the section's key
diagram, table or chips there — never a restatement of the summary line.

## Components

Every component is rendered live, with its markup, in the component reference:

```bash
templates/build templates/components
open templates/components/dist/components.html
```

That page is itself built by this template, so it cannot drift from the CSS.

## Theming

Three states, and all three must work: an explicit `data-theme` stamp in either direction, and the
un-stamped default where only `prefers-color-scheme` decides. `templates/base/theme.css` handles this.

The rule that matters: **never declare a colour only inside a media or `[data-theme]` block.** Define
tokens in the bare `:root`, redefine them in the two theme blocks, and style components through the
tokens. A colour that exists only behind `[data-theme]` renders one theme's text on the other theme's
ground.

The semantic trio `ok` / `warn` / `risk` is deliberately generic. Each document decides what the three
mean and states it in a legend. The compliance document uses them as hard guarantee, best effort, and
bypass.

## What the build checks

`docbuild` fails on a missing section field, a duplicate section id, and an unfilled placeholder. After
writing it reports tag balance, the theme-state count, and the file size — the two bugs that actually bite
being an unbalanced tag and a colour trapped in a theme block.

It has no runtime dependencies. Node only, and only to build — a reader needs nothing.

## Where to put a component

If two documents would use it, it belongs in `templates/base/components.css`. If only one ever will, it
belongs in that document's `extra.css`.

The line is drawn by reuse, not by complexity. A lane diagram and a decision card are general, so they
are in the base. An interactive graph built for one document's data is not, however polished it is, so it
lives in that document's `extra.css` and `extra.js`.
