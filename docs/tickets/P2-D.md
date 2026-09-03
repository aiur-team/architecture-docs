# P2-D — inline_md.ts, the round-trip gate, editable.ts and the manifest

## Outcome

The builder marks only losslessly editable source paragraphs and body headings, emits a deterministic edit manifest keyed by P1-D's permanent `data-aid`, and publishes one exact inline-text conversion contract that the later editor, pending-receipt filter, suggestions path, and CI twin check can share.

## Context

Inline editing must never turn unsupported HTML into different source bytes. P1-B therefore placed an always-compiled `markEditable(sections, doc, inst)` hook after history and anchoring, and P1-D made `data-aid` the sole block identity. P2-D fills that hook with a deliberately small three-mark format, makes exact HTML-to-text-to-HTML equality the admission gate, and writes the only server-readable mapping from an `aid` to its source path and authoritative built-block hash.

This ticket decides representation, not authorization. The edit manifest says which built block can be represented safely and where that block came from. P2-G/P2-H and their later amendments resolve the caller's document role from the state store. Neither `doc.json` nor this manifest gains `owner`, `editors`, email addresses, or another authority list.

The implementation remains TypeScript, Node 18 compatible, strict, and zero-runtime-dependency. The converter is a bounded string transform rather than Markdown or HTML parsing, and the equality gate is the safety property.

## Scope

### In scope

- Create the pure `inline_md.ts` converter with exact ordered-pass support for `<code>`, `<strong>`, and `<em>` and for the Markdown-like delimiters `` ` ``, `**`, and `*`.
- Create a portable JSON fixture containing invented exact `md`/`html` pairs in both directions.
- Amend P1-B's `editable.ts` stub while preserving its exported type name and function signature.
- Reuse P1-D's `scanBlocks()` and UTF-16 offsets; do not create a second block scanner.
- Admit only source-body `p`, `h2`, `h3`, and `h4` elements that have one valid P1-D aid, occupy whole lines, carry no authored attribute, contain no nested block, and survive the exact round trip.
- Add `data-editable` and the conditional `data-md` attribute to in-memory `Section.body` only.
- Return concrete manifest rows and atomically write `<instance>/dist/<basename>.edit.json` in a deterministic format.
- Hash the exact inner HTML bytes with SHA-256 for later stale-receipt and write-conflict checks.
- Prove the ticket-frozen conversion benchmark and the exact current integration counts, then prove required editable/read-only samples, the HTML size budget, transaction behavior, and deterministic rebuild behavior.

### Out of scope

- Editing P1-B's `index.ts`, hook call site, `layout.html`, `Section` or `Doc` interfaces, CLI, package files, TypeScript configuration, or feature slots.
- Editing P1-D's scanner, anchor assignment, browser export, `anchors.json`, source-section grammar, or `data-aid` format.
- Editing source fragments, `doc.json`, committed HTML, or an edit manifest by hand. HTML and manifests are generated integration products.
- Making metadata, peek markup, tables, list items, code blocks, diagrams, summaries, elements with authored attributes, generated history, or base-template text editable.
- Adding links, a recursive or generalized nested-mark grammar, rich text, CommonMark, a DOM, an HTML parser, sanitization, block creation/deletion, or a general entity table. Exact cross-mark nesting that the declared sequential passes produce and reverse is part of this ticket's bounded grammar.
- Adding `data-eid`, an ordinal, an editable flag inside a manifest row, or any identity other than `aid`.
- Reading or writing pending receipts, comments, suggestions, branches, commits, pull requests, audit events, state-store roles, or browser storage.
- Creating the edit client, `/api/edit`, `/api/pending`, the suggestion client/API, or the CI twin-check script. P3-E, P4-B, P4-C, P4-N, P4-O, P4-P, P4-Q, and P4-R consume this ticket's contracts.
- Creating a permanent TypeScript test file, changing a workflow, adding a dependency, or changing a research, prompt, template, or another ticket document.

## Interface contract

### Pure inline conversion

Create `templates/docbuild/src/inline_md.ts` with exactly these public exports:

```ts
export function toMd(html: string): string;
export function toHtml(text: string): string;
```

The module has no imports, filesystem access, Node global, DOM reference, side effect, locale operation, regular-expression lookbehind, or dependency. Both functions operate on JavaScript strings and return a string for every string input. They do not throw on unsupported syntax; unsupported syntax fails a caller's equality gate.

This is not Markdown. Its complete mark vocabulary is:

| Inline HTML token | Editable-text delimiter |
|---|---|
| `<code>`…`</code>` | `` `…` `` |
| `<strong>`…`</strong>` | `**…**` |
| `<em>`…`</em>` | `*…*` |

Tag spellings are exact lowercase ASCII and carry no attributes. The converter does not parse nesting recursively, but its ordered passes inspect the output of earlier passes. Therefore exact cross-mark nesting produced by those passes is representable when the reverse passes reproduce the original string. For example, `*a **b** c*` maps to `<em>a <strong>b</strong> c</em>`, and `` `*x*` `` maps to `<code><em>x</em></code>`; both pairs survive both exact directions. Same-mark nesting and any other nested form receive no special interpretation and are admitted only if the declared transforms happen to reverse exactly. Each `wrap` decision applies its run restriction to that pass's current input, after earlier passes have replaced their successful delimiters: the visible run must be nonempty and contain no occurrence of that delimiter's single character. Thus a code-pass run contains no backtick, and a strong- or emphasis-pass run contains no `*`, while an earlier pass may already have converted source delimiters into tags. Unmatched delimiters, empty runs, tag variants, attributes, other elements, other entities, and non-representable nested constructs are literal input to the transform; the round-trip comparison then admits or rejects the containing block.

`toMd(html)` performs these stages in this exact order:

1. Run `untag` for `code` with opening/closing delimiter `` ` ``.
2. Run `untag` for `strong` with opening/closing delimiter `**`.
3. Run `untag` for `em` with opening/closing delimiter `*`.
4. Decode by literal split/join in this order: `&lt;` to `<`, then `&gt;` to `>`, then `&amp;` to `&`.

For one `untag(input, tag, open, close)` pass, scan left to right for the next exact `<tag>`. If no exact `</tag>` follows it, append the untouched remainder and stop that pass. Otherwise the first following close wins: append the preceding bytes, `open`, the bytes between the two tags unchanged, and `close`; resume immediately after the close. The next tag pass sees the previous pass's output. This deliberately does not parse nesting.

`toHtml(text)` performs these stages in this exact order:

1. Encode literal `&` as `&amp;`, then `<` as `&lt;`, then `>` as `&gt;` using literal split/join. Quotes are not encoded in element text.
2. Run `wrap` for delimiter `` ` `` and tag `code`.
3. Run `wrap` for delimiter `**` and tag `strong`.
4. Run `wrap` for delimiter `*` and tag `em`.

For one `wrap(input, delimiter, tag)` pass, find the next delimiter from left to right. Let `run` be the bytes after it through, but not including, the first occurrence of the delimiter's single character. Wrap only when `run` is nonempty and the bytes immediately following `run` start with the complete delimiter. On success append `<tag>run</tag>` and resume after the closing delimiter. On failure append through the opening delimiter unchanged and resume after it. Because `**` runs before `*` and a run cannot contain `*`, the strong and emphasis grammars do not consume one another. Later passes do inspect output of earlier passes; the fixture and equality gate freeze that behavior.

The canonical builder admission test is exact UTF-16 string equality:

```ts
const md = toMd(inner);
const roundTrips = toHtml(md) === inner;
```

There is no trimming, Unicode normalization, whitespace folding, entity equivalence, case folding, DOM serialization, or semantic comparison. P4-B uses `toHtml()` for submitted editable text and must additionally require `toMd(toHtml(text)) === text` before proposing a source change. P4-C treats this source implementation as one converter and the later browser/server twin as the other; `templates/fixtures/inline.json` is their shared conformance input.

### Portable fixture

Create `templates/fixtures/inline.json` as one JSON array. Every entry is an object with exactly two string properties in this order, `md` then `html`; no names, comments, expected-error records, private text, or optional properties are allowed. Its initial exact content is:

```json
[
  { "md": "Plain lanterns.", "html": "Plain lanterns." },
  { "md": "Tea & <toast>.", "html": "Tea &amp; &lt;toast&gt;." },
  { "md": "Use **bold** type.", "html": "Use <strong>bold</strong> type." },
  { "md": "Keep *quiet* detail.", "html": "Keep <em>quiet</em> detail." },
  { "md": "Run `npm test`.", "html": "Run <code>npm test</code>." },
  { "md": "*Outer **bold** detail*", "html": "<em>Outer <strong>bold</strong> detail</em>" },
  { "md": "**A & B**", "html": "<strong>A &amp; B</strong>" },
  { "md": "Use `*quiet*` in code.", "html": "Use <code><em>quiet</em></code> in code." },
  { "md": "Unicode café — 東京.", "html": "Unicode café — 東京." },
  { "md": "Unmatched *asterisk.", "html": "Unmatched *asterisk." },
  { "md": "Empty **** marks.", "html": "Empty **** marks." },
  { "md": "Literal &lt; stays text.", "html": "Literal &amp;lt; stays text." }
]
```

Every row must satisfy both `toHtml(md) === html` and `toMd(html) === md`. The ordered array and two exact keys are stable downstream API, not illustrative data. A future syntax extension amends the converter and this fixture together in its owning ticket.

### Concrete row and manifest schemas

Amend `templates/docbuild/src/editable.ts`. Import `BuildError`, and import the `Doc`/`Section` types, from `./index.js`; import `scanBlocks` and its `BlockTag` type from `./anchor-core.js`; import `toMd`/`toHtml` from `./inline_md.js`; use only Node built-ins for filesystem, path, and SHA-256 operations.

Replace P1-B's opaque alias with these exact exports while preserving its function signature:

```ts
export type EditableTag = "p" | "h2" | "h3" | "h4";

export interface ManifestRow {
  readonly aid: string;
  readonly file: string;
  readonly section: string;
  readonly tag: EditableTag;
  readonly hash: string;
}

export function markEditable(
  sections: Section[],
  doc: Doc,
  inst: string,
): ManifestRow[];
```

Rows are returned in `sections` order and then opening-tag order. Their fields mean:

| Field | Exact value |
|---|---|
| `aid` | The sole `data-aid` value; it matches `^a[0-9a-f]{8}$` |
| `file` | `sections/${section.file}` with the literal `/` separator, where `section.file` matches `^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$` |
| `section` | The containing `Section.id`, unchanged |
| `tag` | Canonical lowercase `p`, `h2`, `h3`, or `h4` from P1-D's scanner |
| `hash` | 64 lowercase hexadecimal characters: SHA-256 of the exact `inner` string, encoded as UTF-8, with no normalization |

The returned `aid` becomes the key rather than a repeated field in the persisted manifest. The file at `<inst>/dist/<basename(inst)>.edit.json` has exactly this versionless shape:

```json
{
  "docId": "a1b2c3",
  "instance": "fixture-doc",
  "commit": "7aaca51",
  "blocks": {
    "a11111111": {
      "file": "sections/01-intro.html",
      "section": "intro",
      "tag": "p",
      "hash": "3883a7bdb6a47fb141b722b65dc34319d7c47fa814dcf42dbfffbd1553a22630"
    }
  }
}
```

- `docId` is `doc.get("id")` and must match P1-A's `^[0-9a-f]{6}$`; missing, empty, uppercase, or malformed values fail rather than produce a sidecar that cannot be authorized.
- `instance` and the output basename are the final path component returned by Node's `basename(inst)`, exactly as the HTML builder names `<basename>.html`. That component must match the exact ASCII regular expression `^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$`: it is nonempty, contains no path separator, whitespace, control, non-ASCII character, leading/trailing separator, or adjacent separators, while preserving ASCII case. Validate it before inspecting a section or creating `dist`. Failure is `BuildError("<inst>: invalid instance basename (expected ^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$)")`. Nested P1-E instances therefore remain self-contained: `nested/fixture-doc` writes `nested/fixture-doc/dist/fixture-doc.edit.json` and records `"instance": "fixture-doc"`.
- `commit` is exactly `process.env.COMMIT_REF` when the variable is present and `""` when absent. Do not trim, lowercase, shorten, run git, synthesize a local SHA, or use it as conflict authority.
- There is deliberately no `built`, `updatedAt`, epoch, filesystem time, random identifier, owner, editors, authorization field, ordinal, `eid`, or version field. A clock would make unchanged rebuilds differ. `commit` is only the later write path's first advisory check; each row's `hash` is its authoritative source-change check.
- `blocks` keys follow returned-row order. Each value has properties in exact `file`, `section`, `tag`, `hash` order. Duplicate aids across sections are a build error, never last-write-wins behavior.
- Serialize only with `JSON.stringify(value, null, 2) + "\n"`. JavaScript insertion order is the required object order; no key sort, compact form, slash conversion, or extra blank line is allowed.
- An empty accepted set still writes the same object with `"blocks": {}` so a server read fails closed without guessing.

### Source-section and editable policy

`markEditable()` receives the complete post-history, post-anchor array. A `Section` is a source section only when `section.file` matches the exact ASCII regular expression `^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$` and `<inst>/sections/<section.file>` is an existing regular file rather than a directory, FIFO, or symbolic link. The stem therefore consists of one or more lower-case ASCII alphanumeric runs separated by exactly one `.`, `_`, or `-`; an internal single dot such as `part.one.html` is valid. Leading/trailing separators, doubled or mixed adjacent separators, `/`, `\`, ASCII or Unicode whitespace/control characters, `%`, non-ASCII text, uppercase text, an empty stem, and every suffix other than exact lowercase `.html` are invalid. The complete names `.` and `..` are invalid as a consequence of the same regex; there is no separate normalization or platform-dependent basename rule.

Check that regex before joining or inspecting any path, so even a NUL-containing or newline-containing value is demoted without reaching a filesystem API. For a matching name, use `lstatSync()` on the exact joined path. `ENOENT` means generated/read-only and must not create the missing path; a returned non-regular entry also means generated/read-only; every other inspection error is a `BuildError`. A nonmatching name or no matching regular source file makes that complete `Section` generated/read-only. It is skipped completely, even if its body contains valid aids and representable prose.

This rule deliberately skips P2-E's generated changelog sentinel `file: "history.json"`. P2-E may append and P1-D may anchor that section, but P2-D adds no edit attributes and no manifest rows for it. No ticket should rename the sentinel to a source-looking `.html` filename.

Within each source `Section.body`, call P1-D's `scanBlocks(body)` once for top-level blocks. First validate that every returned block has exactly one valid P1-D aid and that no valid aid repeats anywhere in the source-section array; this checks the upstream integration even for a read-only tag. Then, for each returned block whose canonical tag is `p`, `h2`, `h3`, or `h4`, derive `inner = body.slice(innerStart, innerEnd)` and apply these rules in order:

1. Reuse the already-validated aid from the scanned opening tag. It is exact lowercase `data-aid`, uses P1-D's double-quoted generated form, and matches `^a[0-9a-f]{8}$`.
2. Every other attribute token, including `class`, `id`, `style`, ARIA, a feature `data-*`, or an event attribute, demotes the block. Whitespace around the one generated aid is not an attribute and does not demote it.
3. The bytes from the preceding LF or body start through `openStart` must be only space or tab; the bytes from `closeEnd` through the following LF or body end must be only space or tab. The element may span multiple lines, but it must occupy those lines on its own. A same-line sibling or text demotes it.
4. Call `scanBlocks(inner)`. Any returned block demotes the outer block; use the shared scanner's complete twelve-tag `BLOCK` set rather than a narrower nested-tag list. A scanner error is a build error, not a demotion.
5. Compute `md = toMd(inner)` and require exact `toHtml(md) === inner`. Inequality demotes the block without rewriting it.
6. Compute its hash, row, and replacement opening tag.

Metadata, `Section.peek`, and source files are not passed through this policy or mutated. `li`, `td`, `th`, `pre`, `blockquote`, `figcaption`, `dd`, and `dt` may have P1-D aids but are never candidates. A demoted `p`/heading keeps its P1-D aid because comments and history still need identity; it receives neither edit attribute and has no manifest row.

### Annotation bytes and mutation order

For an admitted block, insert attributes immediately before its opening tag's final `>` without reserializing any existing byte:

- Always insert the exact valueless string ` data-editable`.
- Insert ` data-md="<escaped-md>"` immediately after it only when `inner` contains at least one exact, successfully paired `<code>…</code>`, `<strong>…</strong>`, or `<em>…</em>` sequence processed by `toMd`. Determine this by checking the three tags in `code`, `strong`, `em` order: an opening token counts only when its exact closing token occurs later. Entity decoding by itself does not cause `data-md`.
- Attribute-escape `md` in this exact order: `&` to `&amp;`, `"` to `&quot;`, `<` to `&lt;`, then `>` to `&gt;`. Apostrophes and newlines are unchanged inside the double-quoted attribute.

Examples:

```html
<p data-aid="a11111111" data-editable>Plain &amp; ready.</p>
<h3 data-aid="a22222222" data-editable data-md="**Bold** and *soft*."><strong>Bold</strong> and <em>soft</em>.</h3>
```

`data-editable` is a build-time capability hint, never server authorization. `data-md` preserves delimiters that `textContent` cannot; P4-B uses it as the initial editor string when present and otherwise uses `textContent`.

Mutation is transactional in this exact order:

1. Resolve and validate the document id, instance basename, source-section membership, every source body, every aid, every accepted row, and global aid uniqueness.
2. Compute all hashes, all replacement bodies, the complete manifest object, and its serialized bytes in memory. Apply recorded opening-tag insertions from highest UTF-16 offset to lowest within each body.
3. Use `mkdirSync(dist, { recursive: true })`, then choose an operation-owned sibling temporary path distinct from the target. Call `openSync(temp, "wx", 0o644)`. If and only if it fails with `EEXIST`, choose a different sibling path and retry, for at most 16 candidates total; every candidate within one call must be distinct, and a candidate that was not opened must never be unlinked. A non-`EEXIST` failure, or the sixteenth `EEXIST`, is final. Write with the exact buffer overload `writeSync(fd, bytes, offset, bytes.length - offset)`, advancing `offset` by the returned positive count until all bytes are written; a zero count before exhaustion is a final failure. Then call `fsyncSync()`, call `closeSync()`, and atomically `renameSync()` it over `<basename>.edit.json`. On any final failure, close an opened descriptor when necessary and best-effort `unlinkSync()` only the exact temporary path successfully opened by this operation; a close/unlink cleanup failure never replaces the primary error. Temporary-path selection and collision retry are operational and do not affect serialized bytes.
4. Only after the rename succeeds, assign replacement strings to the corresponding `Section.body` values and return the rows. Do not change any other `Section` field.

If any validation, conversion scan, hash, directory, write, close, or rename step fails, throw `BuildError`, retain the old manifest when one exists, and leave every supplied section unchanged. For a non-`ENOENT` source inspection failure, the exact message is `<source-path>: <original error.message>`. For `mkdirSync`, a final temporary open/write/sync/close failure, or rename failure, the exact message is `<manifest-path>: <original error.message>` even when the native operation targeted the directory or temporary sibling. An `EEXIST` collision is retried rather than exposed when a later candidate opens successfully; sixteen collisions expose the sixteenth error through that same manifest-path wrapper. A zero-byte `writeSync()` result uses `BuildError("<manifest-path>: writeSync made no progress")`. The temporary filename is operational only: it must not contain source data and is never returned, serialized, or committed.

### Exact round-trip benchmark and size boundary

The immutable golden corpus is the exact bytes of the eight paths below at full Git commit `2168188f115e4e3453cb75818f8458090f09aaa5`. This ticket lists both the object ID and every path, and Test plan step 3 resolves the commit directly, exports those bytes into a guarded temporary directory, and runs the implemented P1-D parser/scanner plus the P2-D converter against them. Every local `git rev-parse` and `git show` has its own 10-second deadline, `SIGKILL` timeout enforcement, and 16 MiB output bound inside the suite's 120-second deadline. The gate never fetches, substitutes another ref, or falls back to working-tree bytes: an unavailable, missing, slow, or oversized object fails closed with the exact requested object in the error. No plan, moving branch, working-tree source, or inferred ancestor selects the golden:

```text
example/sections/01-problem.html
example/sections/02-solution.html
example/sections/03-architecture.html
example/sections/04-build-order.html
example/sections/05-open-questions.html
templates/components/sections/01-structure.html
templates/components/sections/02-diagrams.html
templates/components/sections/03-content.html
```

That frozen conversion gate has exactly 91 scanned body `p`/`h2`/`h3`/`h4` candidates before the independent attribute, whole-line, nesting, and source-file filters are applied: 79 pass and 12 fail exact conversion equality. The ordered failure identity is frozen as path plus SHA-256 of complete outer HTML:

| Source path | Outer-block SHA-256 |
|---|---|
| `example/sections/01-problem.html` | `888db89d42e33871c31959212c7ea5b2d80de0a7666ff68d066b3011848e4d91` |
| `example/sections/01-problem.html` | `9e5dd0c049232efe97a22fc3b2e1524e3fc67368282faa3c601449c973bebd28` |
| `example/sections/01-problem.html` | `9cc348927316800ff13d3ef81994b8bbf7fc0aaee8059d360509243d7cd86edb` |
| `example/sections/02-solution.html` | `933945c5aed1485143afa6b04322245afb969877f7f591d94c02c02f4ecc552f` |
| `example/sections/02-solution.html` | `549b4d723405b87559ade7be5f68781680ff33cc2df54f9f7c6a4299838571ec` |
| `example/sections/03-architecture.html` | `de35eab2cd73d139c467accf95685886a38e2a1ab2af29017eb9f8b0f2b17a9b` |
| `example/sections/04-build-order.html` | `2446390189bb57faa59ff5c8ea434381d06b952f62e57755000f845f18d452c1` |
| `example/sections/05-open-questions.html` | `7137451ead31e07f730e488c68530846871462e49fe319ee610539b3e35950f7` |
| `example/sections/05-open-questions.html` | `2ede3d04aeabce1c63da557270dee5a7fc818429dff03e8db226adc10e0f61ba` |
| `example/sections/05-open-questions.html` | `aa2790b548100b44ad0b7c3c63cbf5276959100540bfcff47a7507a29c0d2d67` |
| `example/sections/05-open-questions.html` | `80080e534cebf6c24f10cc92238e8478e6e0f46d79c4438ea2ef9f21ef6cc44d` |
| `templates/components/sections/02-diagrams.html` | `428fa42516e07840d63a06d5fec06965d812d64ee26b79f3155907f81b3fe25c` |

The current integration corpus is also an exact gate, not an observation. Read directory entries directly under `example/sections` and `templates/components/sections` without following symbolic links; include only entries whose `Dirent.isFile()` is true and whose name matches the source regex; ignore every other entry; sort bytewise; and require the resulting path list to equal the same eight paths above. It must likewise report exactly 79 of 91 passes and the same ordered 12 path/hash failures. P2-D owns no source fragment, so current-corpus drift is an integration failure that requires the source-owning ticket to amend this benchmark explicitly rather than weakening it to a moving count.

One required read-only integration sample is this exact source element in `templates/components/sections/02-diagrams.html`:

```html
<p>Use <code>.panel</code> &rarr; <code>.flow</code> &rarr; <code>.node</code>. Stack nodes vertically with <code>.col</code>. Label an edge with <code>.arrow .at</code>. Add a legend with <code>.cap</code>.</p>
```

P1-D changes only its opening tag by adding `data-aid`; P2-D must leave the block otherwise byte-identical, add no edit attribute, and omit its aid from the manifest. `&rarr;` is valid to P1-D's broader text scanner but absent from this converter's three-entity grammar, so `toHtml(toMd(inner))` encodes it as `&amp;rarr;` and exact equality fails. The remaining eleven frozen failures contain other unsupported source spelling such as `<b>` or `&nbsp;`/`&mdash;`; their hashes prevent a converter expansion or corpus change from being mistaken for success.

After all editable-policy filters, the real integration sidecars contain exactly these nonzero row counts:

| Manifest | Source row counts | Total |
|---|---|---:|
| `example/dist/example.edit.json` | `01-problem.html`: 5; `02-solution.html`: 3; `03-architecture.html`: 12; `04-build-order.html`: 3; `05-open-questions.html`: 8 | 31 |
| `templates/components/dist/components.edit.json` | `01-structure.html`: 3; `02-diagrams.html`: 5; `03-content.html`: 12 | 20 |

The completeness gate also binds content rather than trusting counts alone. In `example`, the unique `h2` whose exact inner HTML is `CI spends most of its time rebuilding things that have not changed` must carry `data-editable`, carry no `data-md`, and have a manifest row for `sections/01-problem.html`. The unique `p` whose exact inner HTML is `What it costs` must retain its authored `class="kicker"` and aid but carry neither edit attribute and have no row. In `templates/components`, the unique `p` whose exact inner HTML is `Wrap in <code>.tw</code> so wide tables scroll inside their own container rather than the page. Use <code>td.n</code> for numeric columns.` must carry `data-editable`, the exact ``data-md="Wrap in `.tw` so wide tables scroll inside their own container rather than the page. Use `td.n` for numeric columns."``, and a row for `sections/03-content.html`; the `&rarr;` paragraph above must remain read-only. Together, the exact per-file counts and positive/negative samples make an empty or demote-all integration result fail.

For each real generated HTML artifact, P2-D's net increase over the same P1-D base must be less than 2,048 bytes. The comparison allows only the exact terminal ` data-editable` and optional ` data-md="…"` annotation on an opening tag whose aid is a manifest key. Remove those annotations only through P1-D-scanned opening-tag offsets, require their removed byte count to equal the artifact's complete growth, and compare every other byte—including literal content, authored attributes, demoted attributes, and `data-aid`—unchanged. The JSON sidecar is not counted in the HTML budget.

### Downstream stability contract

- **P3-E (`GET /api/pending`):** locate a receipt's `aid` only in `manifest.blocks`; compare its `baseHash` to exact row `hash`; delete/drop a stale or absent row. It must not derive a path, accept a receipt hash as truth, or use `commit` as the stale decision.
- **P4-B (`POST /api/edit` and client):** the client opens only `[data-editable][data-aid]`, starts from `data-md` or `textContent`, and submits the same aid. The server obtains `file`, `section`, `tag`, and built hash only from the manifest, re-finds the aid through P1-D's scanner, verifies the exact SHA-256 before writing, and applies `toHtml()` only to canonical input. Absence from `blocks` is read-only even if a client forges an attribute.
- **P4-C (converter twin check):** consume every ordered fixture pair and require both directions for the P2-D implementation and the later twin. No implementation may silently expand grammar without a fixture amendment.
- **P4-N/P4-O (shared apply and suggestion APIs):** use the same manifest row and hash check for direct edits and accepted suggestions; `aid` remains the join key and no ordinal/eid fallback is allowed.
- **P4-P/P4-Q/P4-R (suggestion UI, reconciliation, expiry):** suggestions exist only for manifest-backed `data-editable` blocks, preserve the submitted canonical text and `baseHash`, and become superseded when the manifest row disappears or its hash changes. Suggestion capability never widens P2-D's editable policy.

The manifest is the only file-path source for these consumers and the row hash is the cross-path change detector. Authorization remains an independent server-side role check; browser attributes, manifest membership, and `commit` never grant a write.

## Files owned

- `templates/docbuild/src/inline_md.ts` — **new**; the canonical three-mark source converter. P4-C consumes its fixture contract but does not amend this file.
- `templates/docbuild/src/editable.ts` — **amended** from the no-op file created by P1-B; P2-D replaces only the opaque `ManifestRow` type and inert implementation while preserving the public function name, parameter order, and return type family.
- `templates/fixtures/inline.json` — **new**; portable invented conformance pairs. P4-C reads it and a future explicit grammar owner may amend it together with the converter.

No other implementation source is owned. `docs/tickets/P2-D.md` is this specification, not an implementation path.

`<instance>/dist/<basename>.edit.json`, compiled `templates/docbuild/dist/**`, and generated `<instance>/dist/<basename>.html` are build products, not independently editable source ownership. The edit sidecars and committed HTML for `example` and `templates/components` are shared integration products: the coordination branch runs one serialized build after P1-B, P1-D, P2-D, and any integrated P2-E source are combined, then includes the generated refresh according to the repository's artifact convention. No implementation lane hand-edits, resets, or concurrently regenerates them.

## Dependencies

### Upstream

P2-D starts only from integrated P1-B and P1-D implementations, not merely their ticket documents.

| Dependency | Contract consumed | Ownership boundary |
|---|---|---|
| P1-B | Creates `editable.ts`; exports `Doc`/`Section`; calls `markEditable(sections, doc, inst)` after history and anchors and before navigation/rendering; makes the hook own manifest persistence | P2-D amends only the stub and does not edit the call site, types, layout, or render order |
| P1-D | `scanBlocks()` and exact UTF-16 offsets; one valid `data-aid` on every nonempty scanned body block; source fragments and peek remain unchanged | P2-D imports the scanner, never redefines a block grammar, never changes aids, and only narrows editability |

The P1-B mutation chain remains:

1. P2-E may refresh history and append its generated `file: "history.json"` `Section`.
2. P1-D anchors the complete array.
3. P2-D ignores non-source sections, annotates accepted source bodies, and persists the edit manifest.
4. P1-B renders navigation and HTML from the final array.

Reordering P2-D before P1-D is a build error because eligible tags would lack their sole identity. Running it before P2-E would produce a manifest and HTML from different section arrays. P2-D does not need P2-E source to be implemented, but the final shared-artifact integration run is serialized after whichever history implementation is present.

### Independent work and integration gates

- After P1-B/P1-D land, `inline_md.ts` plus `inline.json` and the `editable.ts` implementation are disjoint source tasks and may be developed independently, with the fixture as their agreement.
- After each listed ticket's own predecessors are integrated and green, P2-A, P2-B, P2-C, P2-E, P2-F, P2-G, and P2-H may proceed in parallel only on their declared source files. P2-G specifically starts only after P2-B's complete contract and acceptance gate are integrated and green; P2-B and P2-G are therefore separate source waves, even though either may overlap P2-D. P2-E and P2-D interact through the finalized `history.json` sentinel, not shared ownership.
- Builds of one temporary invented instance are isolated and may run independently. Builds that rewrite the same real HTML/manifest, compiled builder output, `_site`, or a shared working tree are serialized.
- The final integration gate runs after all applicable source branches are combined: compile once, build each real instance once, inspect generated diffs, build again, and require byte identity. Generated manifests/HTML reflect the combined hook order and must never be resolved by choosing one lane's artifact.
- P3-E and P4-C can begin after P2-D lands. P4-B begins after P2-D and P3-E. Suggestion/apply tickets inherit rather than amend the row, converter, identity, and hash contracts.

## Acceptance criteria

- [ ] `inline_md.ts` exports exactly `toMd` and `toHtml`, has no import or environment dependency, and implements the declared ordered `untag`, entity, encoding, and `wrap` operations byte-for-byte; an AST check enforces its source surface.
- [ ] The converter supports only exact `code`, `strong`, and `em` under the declared ordered passes, including only those cross-mark nested forms that the sequential transforms reproduce exactly; it implements no recursive nesting grammar, and every non-representable construct is preserved/demoted through exact equality rather than silently normalized.
- [ ] `inline.json` has exactly the declared ordered array and two-key string schema; every row passes both directions.
- [ ] `editable.ts` preserves P1-B's `markEditable(sections, doc, inst): ManifestRow[]` signature and exports the exact `EditableTag` and `ManifestRow` shapes.
- [ ] P1-D's `scanBlocks()` is the only block scanner. P2-D consumes its canonical tag and offsets, and hashes the exact `innerStart..innerEnd` slice as UTF-8 SHA-256.
- [ ] Only `Section.file` values matching `^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$` and naming actual regular `<inst>/sections/` files are considered. Every nonmatching name is rejected before filesystem access; peek, metadata, source files, generated sections, and exact `history.json` remain unchanged/read-only.
- [ ] Missing/malformed/duplicate aids abort transactionally; authored attributes, non-whole-line placement, nested blocks, non-editable tags, and failed round trips demote without losing the P1-D aid.
- [ ] Accepted opening tags preserve every existing byte and receive exact ordered `data-editable`/conditional escaped `data-md` additions; the invented `&"<>` case proves attribute-escape order and exact bytes; no `data-eid`, ordinal, or extra marker is emitted.
- [ ] Returned rows are in section/block order and contain exact `aid`, `sections/<file>`, section id, canonical tag, and 64-lowercase-hex hash values.
- [ ] The sidecar path, exact instance-basename grammar and error, nested-instance behavior, outer/row property order, block order, empty case, two-space JSON, terminal LF, `COMMIT_REF` behavior, and absence of clock/authority/version fields match the contract.
- [ ] Any validation or final filesystem failure is a `BuildError`, preserves a prior manifest, leaves all supplied sections unchanged, and best-effort removes only the operation's successfully opened temporary file; temporary open uses a distinct sibling, exact `"wx"`/`0o644`, at most 16 distinct candidates for `EEXIST` retry, and a complete partial-write loop. A pre-close primary failure plus a cleanup failure proves that cleanup is retried and never masks the primary message.
- [ ] Against the eight-path corpus frozen at commit `2168188f115e4e3453cb75818f8458090f09aaa5`, exactly 79 of 91 conversion candidates pass and the ordered 12 failures equal the declared path/hash list. Every local object read is bounded to 10 seconds and 16 MiB; absence, timeout, or overflow fails closed without a fetch, alternate ref, or working-tree fallback.
- [ ] Current discovery yields exactly the same eight direct regular non-symlink paths, 79-of-91 count, and ordered 12 failure identities; drift fails until the source-owning ticket explicitly amends the frozen contract.
- [ ] Real manifests contain exactly 31 `example` rows and 20 `components` rows with the declared per-file distribution. The two required editable samples have exact markers/rows, and the authored-attribute and `&rarr;` samples keep their aids but have neither edit attribute nor row.
- [ ] Each real HTML artifact differs from the uniquely derived first parent of the one common P2-D-new-path creation commit only by the exact P2-D attributes and grows by fewer than 2,048 bytes; no operator-supplied base ref participates.
- [ ] Two builds under the same inputs and same `COMMIT_REF` produce byte-identical HTML and manifests; no timestamp, mtime, random value, or unstable iteration changes output.
- [ ] The policy, golden-corpus, and repeat-build fixture families install first-signal HUP/INT/TERM handling before root creation and retain it through stop, proof, bounded recursive deletion, and final exit. Before any detached process exists they publish a mode-`0600` preparing record; the detached anchor cannot spawn the real command until its PID/PGID record is published and the supervisor sends the private go handshake. The still-live direct-child anchor remains the positively owned process-group leader through TERM-to-KILL cleanup, includes every descendant (including `git`), is reaped by the supervisor, and is followed by a finite group-disappearance proof before records or root are deleted. No path signals a numeric PGID after that leader exits. Silent deterministic probes cover early, active, and terminal HUP/INT/TERM, a distinct later HUP/INT/TERM delivered during final cleanup without replacing the first status, natural child HUP/INT/TERM/KILL statuses 129/130/143/137, combined publication/evidence-write failure, descendant cleanup, group disappearance, and zero residue for all three families.
- [ ] If a supervisor is unresponsive, killed, cannot reap its group anchor, loses positive current ownership, or cannot complete bounded recursive deletion, the outer owner may KILL only its still-unreaped direct supervisor after the finite TERM grace; the private handshake guarantees that doing so in a preparing/unpublished state closes the anchor pipe before any target can spawn. It never signals an unverified/stale PID or PGID, always treats forced-supervisor cleanup or unproved anchor reaping as manual-remediation failure, and retains the exact guarded root plus mode-`0600` preparing/anchor evidence and an actionable locator when writable. The repeat-build parent-exit probe kills the supervisor after publication, requires group-wide cleanup, requires retained PID/PGID evidence because the outer shell cannot reap the orphaned anchor, and proves that fallback never deletes that root.
- [ ] Every supervisor latches the first HUP/INT/TERM even after another outcome has begun asynchronous cleanup, rechecks that latch at final exit, and maps a child’s natural signal to conventional `128 + signal number` status. Each fixture family's final-cleanup probe waits for an exact first-signal latch acknowledgement, sends a distinct second signal while the latch remains installed, and requires the original 129/130/143 status at terminal exit; deterministic probes also require early/active statuses 129/130/143 and natural-child HUP/INT/TERM/KILL statuses 129/130/143/137.
- [ ] P3-E can reject/delete a stale receipt from row absence/hash mismatch; P4 edit/suggestion consumers can obtain a source path only from the manifest and can use the portable converter contract without guessing.
- [ ] Strict typecheck and the repository dist gate pass without a package, lockfile, TypeScript config, workflow, or runtime-dependency change.
- [ ] Implementation source changes stay inside the three owned paths; real source fragments and other tickets' files are untouched.

## Test plan

Run every command from the repository root. All fixture prose, ids, paths, and metadata below are invented.

1. Compile with the repository's existing strict configuration and run the converter fixture in both directions:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   npm --prefix templates/docbuild run check

   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import ts from "./templates/docbuild/node_modules/typescript/lib/typescript.js";
   import { toHtml, toMd } from "./templates/docbuild/dist/inline_md.js";

   const sourcePath = "templates/docbuild/src/inline_md.ts";
   const sourceText = readFileSync(sourcePath, "utf8");
   const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
   assert.deepEqual(sourceFile.parseDiagnostics, [], "inline_md.ts must parse without recovery");
   const exported = [];
   for (const statement of sourceFile.statements) {
     assert.ok(!ts.isImportDeclaration(statement) && !ts.isImportEqualsDeclaration(statement),
       "inline_md.ts must not import");
     assert.ok(!ts.isExportDeclaration(statement) && !ts.isExportAssignment(statement),
       "inline_md.ts must not re-export or export an expression");
     const isExported = statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false;
     if (!isExported) continue;
     assert.ok(ts.isFunctionDeclaration(statement) && statement.name,
       "inline_md.ts may export only named functions");
     exported.push(statement.name.text);
   }
   assert.deepEqual(exported, ["toMd", "toHtml"], "inline_md.ts exact export surface");
   const forbiddenGlobals = new Set([
     "Buffer", "__dirname", "__filename", "document", "global", "globalThis",
     "module", "process", "require", "window",
   ]);
   const inspectSource = (node) => {
     assert.ok(!(ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword),
       "inline_md.ts must not use dynamic import");
     assert.ok(!ts.isImportTypeNode(node), "inline_md.ts must not use an import type");
     if (ts.isIdentifier(node)) {
       assert.ok(!forbiddenGlobals.has(node.text), `inline_md.ts forbidden global ${node.text}`);
     }
     ts.forEachChild(node, inspectSource);
   };
   inspectSource(sourceFile);

   const rows = JSON.parse(readFileSync("templates/fixtures/inline.json", "utf8"));
   const expectedRows = [
     { md: "Plain lanterns.", html: "Plain lanterns." },
     { md: "Tea & <toast>.", html: "Tea &amp; &lt;toast&gt;." },
     { md: "Use **bold** type.", html: "Use <strong>bold</strong> type." },
     { md: "Keep *quiet* detail.", html: "Keep <em>quiet</em> detail." },
     { md: "Run `npm test`.", html: "Run <code>npm test</code>." },
     { md: "*Outer **bold** detail*", html: "<em>Outer <strong>bold</strong> detail</em>" },
     { md: "**A & B**", html: "<strong>A &amp; B</strong>" },
     { md: "Use `*quiet*` in code.", html: "Use <code><em>quiet</em></code> in code." },
     { md: "Unicode café — 東京.", html: "Unicode café — 東京." },
     { md: "Unmatched *asterisk.", html: "Unmatched *asterisk." },
     { md: "Empty **** marks.", html: "Empty **** marks." },
     { md: "Literal &lt; stays text.", html: "Literal &amp;lt; stays text." },
   ];
   assert.ok(Array.isArray(rows));
   assert.deepEqual(rows, expectedRows, "inline fixture must equal the exact ordered 12-row corpus");
   for (const [i, row] of rows.entries()) {
     assert.deepEqual(Object.keys(row), ["md", "html"], `row ${i} keys`);
     assert.equal(typeof row.md, "string");
     assert.equal(typeof row.html, "string");
     assert.equal(toHtml(row.md), row.html, `row ${i} md -> html`);
     assert.equal(toMd(row.html), row.md, `row ${i} html -> md`);
   }

   assert.equal(toHtml("**x**"), "<strong>x</strong>");
   assert.equal(toHtml("****"), "****");
   assert.equal(toHtml("`*`"), "<code>*</code>");
   assert.equal(toHtml("*a **b** c*"), "<em>a <strong>b</strong> c</em>");
   assert.equal(toMd("<em>a <strong>b</strong> c</em>"), "*a **b** c*");
   assert.equal(toHtml("`*x*`"), "<code><em>x</em></code>");
   assert.equal(toMd("<code><em>x</em></code>"), "`*x*`");
   assert.equal(toMd("<STRONG>x</STRONG>"), "<STRONG>x</STRONG>");
   assert.notEqual(toHtml(toMd("<a href=\"/x\">x</a>")), "<a href=\"/x\">x</a>");
   assert.notEqual(toHtml(toMd("left &rarr; right")), "left &rarr; right");
   console.log("PASS  inline fixture: 12 exact pairs and unsupported syntax demotes");
   NODE
   BASH
   ```

   Expected: typecheck exits `0`; the script prints exactly the one `PASS` line and exits `0`. Its TypeScript AST check first requires exactly the ordered `toMd`/`toHtml` named-function exports, rejects static/dynamic/import-type syntax, and rejects the listed Node/environment/DOM globals. It then requires semantic equality with the exact ordered 12-row fixture, including exact row values and key order, and covers plain text, the three marks, combined marks, entity encoding, double decoding prevention, Unicode, unmatched/empty delimiters, mark-pass ordering, the two declared pass-order-representable nested forms in both directions, exact tag case, a link, and `&rarr;`.

2. Exercise policy, exact output, serialization, hash values, the generated-section sentinel, and transaction failure in an isolated temporary instance:

   ```bash
   bash <<'P2D_POLICY_GATE'
   set -euo pipefail
   P2D_POLICY_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
   P2D_POLICY_ROOT=
   P2D_POLICY_ACTIVE_PID=
   P2D_POLICY_SIGNAL_STATUS=0
   P2D_POLICY_SIGNAL_COUNT=0
   P2D_POLICY_CLEANING=0

   p2d_policy_manual() {
     local reason="$1" pid="${2:-}" pgid="${3:-}" root="${P2D_POLICY_ROOT:-}" locator=no-safe-locator
     if [[ -n "$root" && "${root%/*}" == "$P2D_POLICY_PARENT" && -d "$root" && ! -L "$root" ]]; then
       case "${root##*/}" in
         p2d-policy.??????|p2d-policy-probe.??????)
           locator="$root/manual-remediation.txt"
           (umask 077; set -o noclobber; printf 'reason=%s\npid=%s\npgid=%s\n' "$reason" "${pid:-unknown}" "${pgid:-unknown}" >"$locator") 2>/dev/null || true
           ;;
       esac
     fi
     printf 'ERROR  P2-D policy fixture requires manual remediation: %s (pid %s, pgid %s)\n' \
       "$locator" "${pid:-unknown}" "${pgid:-unknown}" >&2
   }
   p2d_policy_stop() {
     local pid="${P2D_POLICY_ACTIVE_PID:-}" group= attempts=0 pgid= command= forced=0
     case "$pid" in ''|*[!0-9]*|0|1) pid= ;; esac
     if [[ -n "$pid" ]]; then
       kill -TERM "$pid" 2>/dev/null || true
       while kill -0 "$pid" 2>/dev/null && (( attempts < 240 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; forced=1; fi
       attempts=0
       while kill -0 "$pid" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then p2d_policy_manual supervisor-unreaped "$pid"; return 1; fi
       wait "$pid" 2>/dev/null || true
     fi
     P2D_POLICY_ACTIVE_PID=
     if [[ -n "${P2D_POLICY_ROOT:-}" && -f "$P2D_POLICY_ROOT/active-group.pid" ]]; then
       IFS= read -r group <"$P2D_POLICY_ROOT/active-group.pid" || true
       case "$group" in ''|*[!0-9]*|0|1) p2d_policy_manual invalid-group "$pid" "$group"; return 1 ;; esac
       pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
       command="$(ps -o command= -p "$group" 2>/dev/null || true)"
       if [[ "$pgid" != "$group" || "$command" != *"$P2D_POLICY_SUPERVISOR --group-anchor"* ]]; then
         p2d_policy_manual anchor-ownership-unproved "$group" "$group"
         return 1
       fi
       kill -TERM -- "-$group" 2>/dev/null || true
       attempts=0
       while kill -0 "$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$group" 2>/dev/null; then
         pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
         command="$(ps -o command= -p "$group" 2>/dev/null || true)"
         if [[ "$pgid" != "$group" || "$command" != *"$P2D_POLICY_SUPERVISOR --group-anchor"* ]]; then
           p2d_policy_manual anchor-ownership-lost "$group" "$group"
           return 1
         fi
         kill -KILL -- "-$group" 2>/dev/null || true
       fi
       attempts=0
       while kill -0 -- "-$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 -- "-$group" 2>/dev/null; then p2d_policy_manual group-unreaped "$group" "$group"; return 1; fi
       p2d_policy_manual fallback-leader-reap-unproved "$group" "$group"
       return 1
     fi
     if [[ -n "${P2D_POLICY_ROOT:-}" ]] && { [[ -f "$P2D_POLICY_ROOT/supervisor-anchor.json" ]] || [[ -f "$P2D_POLICY_ROOT/supervisor-preparing.json" ]]; }; then
       p2d_policy_manual incomplete-anchor-publication "$pid"
       return 1
     fi
     if (( forced != 0 )); then p2d_policy_manual supervisor-forced "$pid"; return 1; fi
   }
   p2d_policy_remove() {
     local root="${P2D_POLICY_ROOT:-}" worker attempts=0
     [[ -n "$root" ]] || return 0
     if [[ "${root%/*}" != "$P2D_POLICY_PARENT" ]]; then p2d_policy_manual unsafe-cleanup; return 1; fi
     case "${root##*/}" in p2d-policy.??????|p2d-policy-probe.??????) ;; *) p2d_policy_manual unsafe-cleanup; return 1 ;; esac
     [[ ! -e "$root" ]] && return 0
     if [[ ! -d "$root" || -L "$root" ]]; then p2d_policy_manual unsafe-cleanup; return 1; fi
     if [[ -f "$root/manual-remediation.txt" || -f "$root/supervisor-anchor.json" || -f "$root/supervisor-preparing.json" ]]; then
       printf 'ERROR  retained P2-D policy fixture for manual remediation: %s\n' "$root" >&2
       return 1
     fi
     node -e 'require("node:fs").rmSync(process.argv[1], {recursive:true, force:true, maxRetries:2, retryDelay:25})' "$root" &
     worker=$!
     while kill -0 "$worker" 2>/dev/null && (( attempts < 200 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$worker" 2>/dev/null; then kill -KILL "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; p2d_policy_manual cleanup-timeout "$worker"; return 1; fi
     wait "$worker" 2>/dev/null || true
     if [[ -e "$root" ]]; then p2d_policy_manual cleanup-failed "$worker"; return 1; fi
   }
   p2d_policy_cleanup() {
     local status=$? cleanup_status=0 latch=
     trap - EXIT
     P2D_POLICY_CLEANING=1
     if ! p2d_policy_stop; then
       cleanup_status=1
     else
       if [[ -n "${P2D_POLICY_CLEANUP_READY:-}" ]]; then
         case "$P2D_POLICY_CLEANUP_READY" in "$P2D_POLICY_ROOT"/.outer-finish-HUP.ready|"$P2D_POLICY_ROOT"/.outer-finish-INT.ready|"$P2D_POLICY_ROOT"/.outer-finish-TERM.ready) ;; *) p2d_policy_manual invalid-cleanup-rendezvous; cleanup_status=1 ;; esac
         if (( cleanup_status == 0 )); then
           (umask 077; printf 'ready\n' >"$P2D_POLICY_CLEANUP_READY")
           local rendezvous_attempts=0
           while (( P2D_POLICY_SIGNAL_COUNT == 0 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
           if (( P2D_POLICY_SIGNAL_COUNT == 0 )); then
             p2d_policy_manual cleanup-first-signal-timeout; cleanup_status=1
           else
             latch="${P2D_POLICY_CLEANUP_READY%.ready}.latched"
             (umask 077; printf '%s\n' "$P2D_POLICY_SIGNAL_STATUS" >"$latch")
             rendezvous_attempts=0
             while (( P2D_POLICY_SIGNAL_COUNT < 2 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
             if (( P2D_POLICY_SIGNAL_COUNT < 2 )); then p2d_policy_manual cleanup-second-signal-timeout; cleanup_status=1; fi
           fi
         fi
       fi
       if (( cleanup_status == 0 )); then p2d_policy_remove || cleanup_status=1; fi
     fi
     if (( P2D_POLICY_SIGNAL_STATUS != 0 )); then status=$P2D_POLICY_SIGNAL_STATUS
     elif (( status == 0 && cleanup_status != 0 )); then status=1
     fi
     if (( P2D_POLICY_SIGNAL_STATUS != 0 )); then status=$P2D_POLICY_SIGNAL_STATUS; fi
     exit "$status"
   }
   p2d_policy_signal() {
     P2D_POLICY_SIGNAL_COUNT=$((P2D_POLICY_SIGNAL_COUNT + 1))
     if (( P2D_POLICY_SIGNAL_STATUS == 0 )); then P2D_POLICY_SIGNAL_STATUS="$1"; fi
     if (( P2D_POLICY_CLEANING == 0 )); then exit "$P2D_POLICY_SIGNAL_STATUS"; fi
   }
   p2d_policy_run() {
     local attempts=0 status stdin_fd
     exec {stdin_fd}<&0
     P2D_FIXTURE_ROOT="$P2D_POLICY_ROOT" node "$P2D_POLICY_SUPERVISOR" "$@" <&"$stdin_fd" & P2D_POLICY_ACTIVE_PID=$!
     exec {stdin_fd}<&-
     while kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 2600 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null; then echo 'ERROR  P2-D policy supervisor exceeded 130 seconds' >&2; p2d_policy_stop || return 1; return 124; fi
     set +e; wait "$P2D_POLICY_ACTIVE_PID"; status=$?; set -e
     P2D_POLICY_ACTIVE_PID=; return "$status"
   }
   trap p2d_policy_cleanup EXIT
   trap 'p2d_policy_signal 129' HUP
   trap 'p2d_policy_signal 130' INT
   trap 'p2d_policy_signal 143' TERM
   p2d_policy_early_probe() {
     local signal="$1" expected="$2" status
     if (
       P2D_POLICY_ROOT=
       P2D_POLICY_ACTIVE_PID=
       P2D_POLICY_SIGNAL_STATUS=0
       P2D_POLICY_CLEANING=0
       trap p2d_policy_cleanup EXIT
       trap 'p2d_policy_signal 129' HUP
       trap 'p2d_policy_signal 130' INT
       trap 'p2d_policy_signal 143' TERM
       kill -s "$signal" "$BASHPID"
       exit 99
     ); then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" ]] || { echo "ERROR  P2-D policy early $signal status failed" >&2; return 1; }
   }
   p2d_policy_early_probe HUP 129
   p2d_policy_early_probe INT 130
   p2d_policy_early_probe TERM 143
   P2D_POLICY_ROOT="$(mktemp -d "$P2D_POLICY_PARENT/p2d-policy.XXXXXX")"
   export P2D_POLICY_ROOT P2D_POLICY_PARENT
   P2D_POLICY_SUPERVISOR="$P2D_POLICY_ROOT/supervise.mjs"
   export P2D_POLICY_SUPERVISOR P2D_FIXTURE_FAMILY=policy
   (umask 077; : >"$P2D_POLICY_SUPERVISOR")
   sed 's/^   //' >"$P2D_POLICY_SUPERVISOR" <<'P2D_FIXTURE_SUPERVISOR_JS'
   import { spawn } from "node:child_process";
   import { createReadStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
   import { constants } from "node:os";
   import { basename, dirname, join } from "node:path";

   const family = process.env.P2D_FIXTURE_FAMILY ?? "";
   const root = process.env.P2D_FIXTURE_ROOT ?? "";
   const parent = process.env[`P2D_${family.toUpperCase()}_PARENT`] ?? "";
   if (!/^(?:policy|golden)$/.test(family) || dirname(root) !== parent
       || !new RegExp(`^p2d-${family}(?:-probe)?\\.[A-Za-z0-9]{6}$`).test(basename(root))) {
     console.error("ERROR  P2-D fixture supervisor refused an unexpected root");
     process.exit(1);
   }
   const pidPath = join(root, "active-group.pid");
   const preparingPath = join(root, "supervisor-preparing.json");
   const anchorPath = join(root, "supervisor-anchor.json");
   const outcomePath = join(root, "target-outcome.json");
   const locator = join(root, "manual-remediation.txt");
   const ownerSignals = new Map([["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

   if (process.argv[2] === "--group-anchor") {
     const target = process.argv.slice(5);
     const targetOutcome = process.argv[3] ?? "";
     const expectedSupervisor = Number(process.argv[4]);
     if (target.length === 0 || targetOutcome !== outcomePath || !Number.isInteger(expectedSupervisor)) process.exit(2);
     for (const signal of ownerSignals.keys()) process.on(signal, () => {});
     let gate = "";
     const gateStream = createReadStream(null, { fd: 3, autoClose: true, encoding: "utf8" });
     gateStream.on("data", (chunk) => { gate += chunk; });
     gateStream.once("error", () => process.exit(1));
     gateStream.once("end", () => {
       if (gate !== "go\n") process.exit(1);
       const targetChild = spawn(target[0], target.slice(1), { stdio: "inherit" });
       const publishOutcome = (status, reason) => {
         const temporary = `${targetOutcome}.${process.pid}.tmp`;
         try {
           writeFileSync(temporary, `${JSON.stringify({ status, reason })}\n`, { flag: "wx", mode: 0o600 });
           renameSync(temporary, targetOutcome);
         } catch {
           if (process.ppid === expectedSupervisor) {
             try { process.kill(expectedSupervisor, "SIGUSR1"); } catch {}
           }
         }
       };
       targetChild.once("error", () => publishOutcome(1, "target-spawn-error"));
       targetChild.once("exit", (code, signal) => {
         const number = signal ? constants.signals[signal] : undefined;
         publishOutcome(signal && number ? 128 + number : (code ?? 1), "target-exit");
       });
     });
     setInterval(() => {}, 1_000);
   } else {
   const argv = process.argv.slice(2);
   if (argv.length === 0) process.exit(2);
   const finishReady = process.env.P2D_FIXTURE_FINISH_READY ?? "";
   if (finishReady && (dirname(finishReady) !== root || !/^\.finish-(?:HUP|INT|TERM)\.ready$/.test(basename(finishReady)))) {
     console.error(`ERROR  P2-D ${family} supervisor refused an unexpected finish rendezvous`);
     process.exit(1);
   }
   let anchor;
   let finishing = false;
   let latchedSignalStatus = 0;
   let timer;
   let outcomePoll;
   let retainEvidence = false;
   let targetReleased = false;

   function groupAlive() {
     if (!anchor?.pid) return false;
     try { process.kill(-anchor.pid, 0); return true; }
     catch (error) { if (error?.code === "ESRCH") return false; if (error?.code === "EPERM") return true; throw error; }
   }
   function anchorOwned() {
     return Boolean(anchor?.pid && anchor.exitCode === null && anchor.signalCode === null);
   }
   function signalGroup(signal) {
     if (!anchorOwned()) throw new Error("anchor ownership lost before signal");
     try { process.kill(-anchor.pid, signal); }
     catch (error) { if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error; }
   }
   function evidence(reason) {
     const record = `${JSON.stringify({ reason, supervisorPid: process.pid, leaderPid: anchor?.pid ?? null, processGroup: anchor?.pid ?? null })}\n`;
     if (process.env.P2D_FIXTURE_INJECT_EVIDENCE_FAILURE !== "1") {
       try { writeFileSync(locator, record, { flag: "wx", mode: 0o600 }); } catch {}
     }
     console.error(`ERROR  P2-D ${family} fixture requires manual remediation: ${locator} (pid ${anchor?.pid ?? "unknown"}, pgid ${anchor?.pid ?? "unknown"})`);
   }
   async function stopGroup() {
     if (!targetReleased) {
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) anchor.kill("SIGKILL");
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) return false;
       for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
       return !groupAlive();
     }
     if (anchorOwned()) signalGroup("SIGTERM");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) signalGroup("SIGKILL");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) return false;
     for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
     return !groupAlive();
   }
   async function finish(status, reason) {
     if (finishing) return;
     finishing = true;
     clearTimeout(timer);
     clearInterval(outcomePoll);
     if (finishReady) {
       try { writeFileSync(finishReady, `${status} ${reason}\n`, { flag: "wx", mode: 0o600 }); } catch {}
     }
     let stopped = false;
     let stopReason = reason;
     try { stopped = await stopGroup(); } catch (error) { stopReason = `${reason}:${error?.code ?? error?.name ?? "unknown"}`; }
     if (!stopped || retainEvidence) {
       evidence(!stopped ? stopReason : reason);
       process.exit(latchedSignalStatus || 1);
     }
     rmSync(pidPath, { force: true });
     rmSync(outcomePath, { force: true });
     rmSync(anchorPath, { force: true });
     rmSync(preparingPath, { force: true });
     process.exit(latchedSignalStatus || status);
   }
   for (const [signal, status] of ownerSignals) process.on(signal, () => {
     if (latchedSignalStatus === 0) latchedSignalStatus = status;
     void finish(status, signal);
   });
   process.on("SIGUSR1", () => { retainEvidence = true; void finish(1, "anchor-outcome-publication-failure"); });
   try {
     writeFileSync(preparingPath, `${JSON.stringify({ state: "preparing", supervisorPid: process.pid })}\n`, { flag: "wx", mode: 0o600 });
   } catch {
     evidence("preparing-publication-failure");
     process.exit(1);
   }
   anchor = spawn(process.execPath, [process.argv[1], "--group-anchor", outcomePath, String(process.pid), ...argv], {
     detached: true, stdio: ["inherit", "inherit", "inherit", "pipe"],
   });
   anchor.once("error", () => { retainEvidence = true; void finish(1, "anchor-spawn-error"); });
   anchor.once("exit", () => {
     if (!finishing) { retainEvidence = true; void finish(1, "anchor-exit-before-outcome"); }
   });
   try {
     if (!anchor.pid) throw new Error("missing anchor pid");
     writeFileSync(anchorPath, `${JSON.stringify({ state: "published", supervisorPid: process.pid, leaderPid: anchor.pid, processGroup: anchor.pid })}\n`, { flag: "wx", mode: 0o600 });
     if (process.env.P2D_FIXTURE_INJECT_PUBLICATION_FAILURE === "1") throw new Error("injected publication failure");
     writeFileSync(pidPath, `${anchor.pid}\n`, { flag: "wx", mode: 0o600 });
     anchor.stdio[3].end("go\n");
     targetReleased = true;
   } catch {
     retainEvidence = true;
     anchor.stdio?.[3]?.end();
     void finish(1, "publication-failure");
   }
   outcomePoll = setInterval(() => {
     try {
       const outcome = JSON.parse(readFileSync(outcomePath, "utf8"));
       if (!Number.isInteger(outcome.status) || outcome.status < 0 || outcome.status > 255) throw new Error("invalid outcome");
       void finish(outcome.status, outcome.reason ?? "target-exit");
     } catch (error) {
       if (error?.code !== "ENOENT" && !finishing) { retainEvidence = true; void finish(1, "invalid-target-outcome"); }
     }
   }, 20);
   timer = setTimeout(() => { void finish(124, "120-second-timeout"); }, 120_000);
   }
   P2D_FIXTURE_SUPERVISOR_JS

   p2d_policy_outer_terminal_probe() {
     local signal="$1" expected="$2" later="$3" ready probe_root latch first_latched= status attempts=0
     ready="$P2D_POLICY_ROOT/.outer-finish-$signal.ready"
     (
       P2D_POLICY_ROOT=
       P2D_POLICY_ACTIVE_PID=
       P2D_POLICY_SIGNAL_STATUS=0
       P2D_POLICY_SIGNAL_COUNT=0
       P2D_POLICY_CLEANING=0
       trap p2d_policy_cleanup EXIT
       trap 'p2d_policy_signal 129' HUP
       trap 'p2d_policy_signal 130' INT
       trap 'p2d_policy_signal 143' TERM
       P2D_POLICY_ROOT="$(mktemp -d "$P2D_POLICY_PARENT/p2d-policy-probe.XXXXXX")"
       export P2D_POLICY_ROOT
       P2D_POLICY_CLEANUP_READY="$P2D_POLICY_ROOT/.outer-finish-$signal.ready"
       printf '%s\n' "$P2D_POLICY_ROOT" >"$ready.root"
       exit 0
     ) &
     P2D_POLICY_ACTIVE_PID=$!
     while [[ ! -s "$ready.root" ]] && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready.root" ]] || { echo "ERROR  P2-D policy terminal $signal root rendezvous failed" >&2; return 1; }
     probe_root="$(<"$ready.root")"
     attempts=0
     while [[ ! -s "$probe_root/.outer-finish-$signal.ready" ]] && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/.outer-finish-$signal.ready" ]] || { echo "ERROR  P2-D policy terminal $signal cleanup rendezvous failed" >&2; return 1; }
     kill -s "$signal" "$P2D_POLICY_ACTIVE_PID"
     latch="$probe_root/.outer-finish-$signal.latched"
     attempts=0
     while [[ ! -s "$latch" ]] && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$latch" ]] && first_latched="$(<"$latch")"
     kill -s "$later" "$P2D_POLICY_ACTIVE_PID" 2>/dev/null || true
     if wait "$P2D_POLICY_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_POLICY_ACTIVE_PID=
     [[ "$first_latched" == "$expected" && "$status" -eq "$expected" && ! -e "$probe_root" ]] || { echo "ERROR  P2-D policy terminal $signal then $later first-signal/cleanup failed" >&2; return 1; }
     rm -f -- "$ready.root"
   }
   p2d_policy_outer_terminal_probe HUP 129 TERM
   p2d_policy_outer_terminal_probe INT 130 HUP
   p2d_policy_outer_terminal_probe TERM 143 INT

   p2d_policy_probe() {
     local signal="$1" expected="$2" owner_root="$P2D_POLICY_ROOT" supervisor="$P2D_POLICY_SUPERVISOR"
     local ready="$owner_root/.probe-$signal" descendant_ready="$owner_root/.descendant-$signal"
     local probe_root descendant_pid group status attempts=0
     (
       P2D_POLICY_ROOT=
       P2D_POLICY_ACTIVE_PID=
       P2D_POLICY_SIGNAL_STATUS=0
       P2D_POLICY_CLEANING=0
       trap p2d_policy_cleanup EXIT
       trap 'p2d_policy_signal 129' HUP
       trap 'p2d_policy_signal 130' INT
       trap 'p2d_policy_signal 143' TERM
       P2D_POLICY_ROOT="$(mktemp -d "$P2D_POLICY_PARENT/p2d-policy-probe.XXXXXX")"
       export P2D_POLICY_ROOT
       printf '%s\n' "$P2D_POLICY_ROOT" >"$ready"
       P2D_FIXTURE_ROOT="$P2D_POLICY_ROOT" node "$supervisor" \
         sh -c 'sleep 30 & child=$!; printf "%s\n" "$child" >"$1"; wait' sh "$descendant_ready" &
       P2D_POLICY_ACTIVE_PID=$!
       wait "$P2D_POLICY_ACTIVE_PID"
     ) &
     P2D_POLICY_ACTIVE_PID=$!
     while [[ ! -s "$ready" ]] && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready" ]] || { p2d_policy_stop || true; echo "ERROR  P2-D policy $signal probe did not become ready" >&2; return 1; }
     probe_root="$(<"$ready")"
     attempts=0
     while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$descendant_ready" ]]; } && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/active-group.pid" && -s "$descendant_ready" ]] || { p2d_policy_stop || true; echo "ERROR  P2-D policy $signal process group did not become ready" >&2; return 1; }
     group="$(<"$probe_root/active-group.pid")"
     descendant_pid="$(<"$descendant_ready")"
     case "$group" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D policy $signal process group invalid" >&2; return 1 ;; esac
     case "$descendant_pid" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D policy $signal descendant PID invalid" >&2; return 1 ;; esac
     kill -0 "$descendant_pid"
     kill -s "$signal" "$P2D_POLICY_ACTIVE_PID"
     attempts=0
     while kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null; then p2d_policy_stop || true; echo "ERROR  P2-D policy $signal cleanup probe exceeded 20 seconds" >&2; return 1; fi
     set +e; wait "$P2D_POLICY_ACTIVE_PID"; status=$?; set -e
     P2D_POLICY_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$probe_root" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null && ! kill -0 "$descendant_pid" 2>/dev/null \
       || { echo "ERROR  P2-D policy $signal cleanup probe failed" >&2; return 1; }
     rm -f -- "$ready" "$descendant_ready"
   }
   p2d_policy_probe HUP 129
   p2d_policy_probe INT 130
   p2d_policy_probe TERM 143
   echo 'PASS  P2-D policy fixture HUP/INT/TERM cleanup'

   p2d_policy_supervisor_terminal_probe() {
     local signal="$1" expected="$2" status group attempts=0
     local finish_ready="$P2D_POLICY_ROOT/.finish-$signal.ready" child_ready="$P2D_POLICY_ROOT/.child-$signal.ready"
     P2D_FIXTURE_FINISH_READY="$finish_ready" P2D_FIXTURE_ROOT="$P2D_POLICY_ROOT" node "$P2D_POLICY_SUPERVISOR" \
       sh -c '(trap "" HUP INT TERM; printf "ready\n" >"$1"; while :; do sleep 1; done) & while [ ! -s "$1" ]; do sleep 0.01; done' \
       sh "$child_ready" &
     P2D_POLICY_ACTIVE_PID=$!
     while { [[ ! -s "$finish_ready" ]] || [[ ! -s "$child_ready" ]] || [[ ! -s "$P2D_POLICY_ROOT/active-group.pid" ]]; } \
       && kill -0 "$P2D_POLICY_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$finish_ready" && -s "$child_ready" && -s "$P2D_POLICY_ROOT/active-group.pid" ]] || { echo "ERROR  P2-D policy terminal supervisor $signal rendezvous failed" >&2; return 1; }
     group="$(<"$P2D_POLICY_ROOT/active-group.pid")"
     kill -s "$signal" "$P2D_POLICY_ACTIVE_PID"
     if wait "$P2D_POLICY_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_POLICY_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$P2D_POLICY_ROOT/active-group.pid" && ! -e "$P2D_POLICY_ROOT/supervisor-anchor.json" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null \
       || { echo "ERROR  P2-D policy terminal supervisor $signal latch failed" >&2; return 1; }
     rm -f -- "$finish_ready" "$child_ready"
   }
   p2d_policy_supervisor_terminal_probe HUP 129
   p2d_policy_supervisor_terminal_probe INT 130
   p2d_policy_supervisor_terminal_probe TERM 143

   p2d_policy_natural_probe() {
     local signal="$1" expected="$2" status
     if p2d_policy_run node -e 'process.kill(process.pid, process.argv[1])' "SIG$signal"; then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" && ! -e "$P2D_POLICY_ROOT/active-group.pid" ]] || { echo "ERROR  P2-D policy natural SIG$signal status failed" >&2; return 1; }
   }
   p2d_policy_natural_probe HUP 129
   p2d_policy_natural_probe INT 130
   p2d_policy_natural_probe TERM 143
   p2d_policy_natural_probe KILL 137

   p2d_policy_publication_probe() {
     local owner_root="$P2D_POLICY_ROOT" probe_root status supervisor_pid attempts=0 group
     probe_root="$(mktemp -d "$P2D_POLICY_PARENT/p2d-policy-probe.XXXXXX")"
     P2D_FIXTURE_ROOT="$probe_root" P2D_FIXTURE_INJECT_PUBLICATION_FAILURE=1 P2D_FIXTURE_INJECT_EVIDENCE_FAILURE=1 \
       node "$P2D_POLICY_SUPERVISOR" true >/dev/null 2>&1 &
     supervisor_pid=$!
     while kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$supervisor_pid" 2>/dev/null; then echo 'ERROR  P2-D policy publication-failure probe exceeded 20 seconds' >&2; return 1; fi
     if wait "$supervisor_pid"; then status=0; else status=$?; fi
     [[ "$status" -eq 1 && -s "$probe_root/supervisor-preparing.json" && -s "$probe_root/supervisor-anchor.json" && ! -e "$probe_root/manual-remediation.txt" ]] \
       || { echo 'ERROR  P2-D policy publication/evidence failure was not retained' >&2; return 1; }
     group="$(node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="published"||a.leaderPid!==a.processGroup) process.exit(1);process.stdout.write(String(a.processGroup))' "$probe_root/supervisor-anchor.json")"
     case "$group" in ''|*[!0-9]*|0|1) echo 'ERROR  P2-D policy retained anchor evidence invalid' >&2; return 1 ;; esac
     ! kill -0 -- "-$group" 2>/dev/null || { echo 'ERROR  P2-D policy publication-failure group survived' >&2; return 1; }
     node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="preparing"||!Number.isInteger(a.supervisorPid)) process.exit(1)' "$probe_root/supervisor-preparing.json"
     rm -f -- "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" "$probe_root/active-group.pid"
     P2D_POLICY_ROOT="$probe_root"
     if ! p2d_policy_remove; then P2D_POLICY_ROOT="$owner_root"; return 1; fi
     P2D_POLICY_ROOT="$owner_root"
     [[ ! -e "$probe_root" ]] || { echo 'ERROR  P2-D policy publication probe residue' >&2; return 1; }
   }
   p2d_policy_publication_probe

   p2d_policy_run node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { execFileSync } from "node:child_process";
   import fs, { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
   import { syncBuiltinESMExports } from "node:module";
   import { basename, dirname, join } from "node:path";
   import { markEditable } from "./templates/docbuild/dist/editable.js";
   import { parseDoc, BuildError } from "./templates/docbuild/dist/index.js";

   const fixtureParent = process.env.P2D_POLICY_ROOT;
   assert.match(fixtureParent ?? "", /\/p2d-policy\.[^/]+$/);
   const roots = [];
   let rootSerial = 0;
   const makeRoot = (...parts) => {
     const container = join(fixtureParent, `case-${String(++rootSerial).padStart(3, "0")}`);
     mkdirSync(container);
     roots.push(container);
     const root = join(container, ...parts);
     mkdirSync(join(root, "sections"), { recursive: true });
     return root;
   };
   const section = (body, file = "01-intro.html", id = "intro") => ({
     id, label: "Invented", summary: "Invented only.", nav: "Invented", peek: "<p>Never touched.</p>", body, file,
   });
   const doc = parseDoc('{"id":"a1b2c3","title":"Invented"}', "invented/doc.json");
   const priorCommit = process.env.COMMIT_REF;
   const opaqueCommit = " \tRefs/Heads/Feature-X \n";
   const injected = (message) => Object.assign(new Error(message), { code: "EIO" });
   const withFsFailure = (method, message, action, afterOriginal = false) => {
     const original = fs[method];
     let fired = false;
     fs[method] = (...args) => {
       if (!fired) {
         fired = true;
         if (afterOriginal) original(...args);
         throw injected(message);
       }
       return original(...args);
     };
     syncBuiltinESMExports();
     try {
       const result = action();
       assert.equal(fired, true, `${method} fault did not fire`);
       return result;
     } finally {
       fs[method] = original;
       syncBuiltinESMExports();
     }
   };
   const priorManifest = (root) => {
     const dist = join(root, "dist");
     mkdirSync(dist);
     const target = join(dist, `${basename(root)}.edit.json`);
     const bytes = [
       "{",
       '  "docId": "a1b2c3",',
       `  "instance": ${JSON.stringify(basename(root))},`,
       '  "commit": "prior-invented",',
       '  "blocks": {}',
       "}",
       "",
     ].join("\n");
     writeFileSync(target, bytes);
     return { dist, target, bytes };
   };

   try {
     process.env.COMMIT_REF = opaqueCommit;
     const root = makeRoot();
     const sourceMarkerPath = join(root, "sections", "01-intro.html");
     const sourceMarkerBytes = Buffer.from("invented source marker\n", "utf8");
     const unsafeMarkerPath = join(root, "escape.html");
     const unsafeMarkerBytes = Buffer.from("invented unsafe-path marker\n", "utf8");
     const linkedSourcePath = join(root, "sections", "03-link.html");
     const linkedSourceTarget = "01-intro.html";
     const missingSourcePath = join(root, "sections", "02-missing.html");
     const nestedSourcePath = join(root, "sections", "nested", "04-nested.html");
     const backslashSourcePath = join(root, "sections", "05\\backslash.html");
     const uppercaseSourcePath = join(root, "sections", "06-Upper.html");
     const suffixSourcePath = join(root, "sections", "07-note.txt");
     const directorySourcePath = join(root, "sections", "08-directory.html");
     const fifoSourcePath = join(root, "sections", "09-stream.html");
     const absentSourcePath = join(root, "sections", "10-absent.html");
     const hiddenSourcePath = join(root, "sections", ".hidden.html");
     const repeatedDotSourcePath = join(root, "sections", "11-bad..dot.html");
     const spaceSourcePath = join(root, "sections", "12-two words.html");
     const unicodeSourcePath = join(root, "sections", "13-café.html");
     const percentSourcePath = join(root, "sections", "14-percent%20name.html");
     const newlineSourcePath = join(root, "sections", "15-line\nbreak.html");
     const trailingSeparatorSourcePath = join(root, "sections", "16-trailing-.html");
     const doubledSeparatorSourcePath = join(root, "sections", "17-double--dash.html");
     writeFileSync(sourceMarkerPath, sourceMarkerBytes);
     writeFileSync(unsafeMarkerPath, unsafeMarkerBytes);
     symlinkSync(linkedSourceTarget, linkedSourcePath);
     mkdirSync(join(root, "sections", "nested"));
     writeFileSync(nestedSourcePath, "invented nested-path marker\n");
     writeFileSync(backslashSourcePath, "invented backslash-path marker\n");
     writeFileSync(uppercaseSourcePath, "invented uppercase-path marker\n");
     writeFileSync(suffixSourcePath, "invented suffix-path marker\n");
     mkdirSync(directorySourcePath);
     execFileSync("mkfifo", [fifoSourcePath]);
     writeFileSync(hiddenSourcePath, "invented hidden-path marker\n");
     writeFileSync(repeatedDotSourcePath, "invented repeated-dot marker\n");
     writeFileSync(spaceSourcePath, "invented space-path marker\n");
     writeFileSync(unicodeSourcePath, "invented unicode-path marker\n");
     writeFileSync(percentSourcePath, "invented percent-path marker\n");
     writeFileSync(newlineSourcePath, "invented control-path marker\n");
     writeFileSync(trailingSeparatorSourcePath, "invented trailing-separator marker\n");
     writeFileSync(doubledSeparatorSourcePath, "invented doubled-separator marker\n");
     assert.equal(existsSync(absentSourcePath), false);
     const accepted = section([
       '<p data-aid="a11111111">Plain &amp; ready.</p>',
       '<h3 data-aid="a22222222"><strong>Bold</strong> and <em>soft</em>.</h3>',
       '<p data-aid="a23232323"><strong>A &amp; "B" &lt;C&gt;</strong></p>',
       '<p class="warn" data-aid="a33333333">Authored attribute.</p>',
       'prefix <p data-aid="a44444444">Not whole-line.</p>',
       '<p data-aid="a55555555">Outer <li data-aid="a66666666">Nested</li></p>',
       '<p data-aid="a77777777"><code>left</code> &rarr; <em>right</em></p>',
       '<li data-aid="a88888888">Wrong tag.</li>',
     ].join("\n"));
     const unsafe = section('<p data-aid="acccccccc">Unsafe path.</p>', "../escape.html", "unsafe");
     const missingSource = section('<p data-aid="adddddddd">Missing source.</p>', "02-missing.html", "missing");
     const linkedSource = section('<p data-aid="aeeeeeeee">Linked source.</p>', "03-link.html", "linked");
     const nestedPath = section('<p data-aid="a10101010">Nested slash.</p>', "nested/04-nested.html", "nested-path");
     const backslashPath = section('<p data-aid="a20202020">Backslash.</p>', "05\\backslash.html", "backslash-path");
     const uppercasePath = section('<p data-aid="a30303030">Uppercase.</p>', "06-Upper.html", "uppercase-path");
     const suffixPath = section('<p data-aid="a40404040">Suffix.</p>', "07-note.txt", "suffix-path");
     const directorySource = section('<p data-aid="a50505050">Directory.</p>', "08-directory.html", "directory-source");
     const fifoSource = section('<p data-aid="a60606060">FIFO.</p>', "09-stream.html", "fifo-source");
     const absentSource = section('<p data-aid="a70707070">Absent.</p>', "10-absent.html", "absent-source");
     const hiddenSource = section('<p data-aid="a90909090">Hidden.</p>', ".hidden.html", "hidden-source");
     const repeatedDotSource = section('<p data-aid="aabababab">Repeated dot.</p>', "11-bad..dot.html", "repeated-dot-source");
     const spaceSource = section('<p data-aid="abcbcbcbc">Space.</p>', "12-two words.html", "space-source");
     const unicodeSource = section('<p data-aid="acdededede">Unicode.</p>', "13-café.html", "unicode-source");
     const percentSource = section('<p data-aid="adefefef0">Percent.</p>', "14-percent%20name.html", "percent-source");
     const newlineSource = section('<p data-aid="a13572468">Control.</p>', "15-line\nbreak.html", "control-source");
     const nulSource = section('<p data-aid="a24681357">NUL.</p>', "18-nul\0name.html", "nul-source");
     const trailingSeparatorSource = section('<p data-aid="a31415926">Trailing separator.</p>', "16-trailing-.html", "trailing-separator-source");
     const doubledSeparatorSource = section('<p data-aid="a27182818">Doubled separator.</p>', "17-double--dash.html", "doubled-separator-source");
     const history = section('<p data-aid="a99999999">Generated history.</p>', "history.json", "history");
     const skipped = [
       unsafe, missingSource, linkedSource, nestedPath, backslashPath, uppercasePath,
       suffixPath, directorySource, fifoSource, absentSource, hiddenSource,
       repeatedDotSource, spaceSource, unicodeSource, percentSource, newlineSource,
       nulSource, trailingSeparatorSource, doubledSeparatorSource, history,
     ];
     const skippedBodies = skipped.map(({ body }) => body);
     const sections = [accepted, ...skipped];
     const originalLstatSync = fs.lstatSync;
     const inspectedSourcePaths = [];
     fs.lstatSync = (path, ...args) => {
       inspectedSourcePaths.push(path);
       return originalLstatSync(path, ...args);
     };
     syncBuiltinESMExports();
     let rows;
     try {
       rows = markEditable(sections, doc, root);
     } finally {
       fs.lstatSync = originalLstatSync;
       syncBuiltinESMExports();
     }
     assert.deepEqual(inspectedSourcePaths, [
       sourceMarkerPath,
       missingSourcePath,
       linkedSourcePath,
       directorySourcePath,
       fifoSourcePath,
       absentSourcePath,
     ], "only regex-valid section filenames may reach lstatSync");

     assert.deepEqual(rows, [
       {
         aid: "a11111111", file: "sections/01-intro.html", section: "intro", tag: "p",
         hash: "3883a7bdb6a47fb141b722b65dc34319d7c47fa814dcf42dbfffbd1553a22630",
       },
       {
         aid: "a22222222", file: "sections/01-intro.html", section: "intro", tag: "h3",
         hash: "78f379ba4d5a07b409ed7aa716f838008f528193c9d2fdabdd7284fe2cc3439f",
       },
       {
         aid: "a23232323", file: "sections/01-intro.html", section: "intro", tag: "p",
         hash: "cdfb0d8a980ca2fa29f03f05f0ac9275658a0c11d5bb85c924e16c76b37a2f03",
       },
     ]);
     assert.equal(accepted.body, [
       '<p data-aid="a11111111" data-editable>Plain &amp; ready.</p>',
       '<h3 data-aid="a22222222" data-editable data-md="**Bold** and *soft*."><strong>Bold</strong> and <em>soft</em>.</h3>',
       '<p data-aid="a23232323" data-editable data-md="**A &amp; &quot;B&quot; &lt;C&gt;**"><strong>A &amp; "B" &lt;C&gt;</strong></p>',
       '<p class="warn" data-aid="a33333333">Authored attribute.</p>',
       'prefix <p data-aid="a44444444">Not whole-line.</p>',
       '<p data-aid="a55555555">Outer <li data-aid="a66666666">Nested</li></p>',
       '<p data-aid="a77777777"><code>left</code> &rarr; <em>right</em></p>',
       '<li data-aid="a88888888">Wrong tag.</li>',
     ].join("\n"));
     assert.deepEqual(skipped.map(({ body }) => body), skippedBodies);
     assert.deepEqual(readFileSync(sourceMarkerPath), sourceMarkerBytes);
     assert.deepEqual(readFileSync(unsafeMarkerPath), unsafeMarkerBytes);
     assert.ok(lstatSync(linkedSourcePath).isSymbolicLink());
     assert.equal(readlinkSync(linkedSourcePath), linkedSourceTarget);
     assert.equal(readFileSync(nestedSourcePath, "utf8"), "invented nested-path marker\n");
     assert.equal(readFileSync(backslashSourcePath, "utf8"), "invented backslash-path marker\n");
     assert.equal(readFileSync(uppercaseSourcePath, "utf8"), "invented uppercase-path marker\n");
     assert.equal(readFileSync(suffixSourcePath, "utf8"), "invented suffix-path marker\n");
     assert.ok(lstatSync(directorySourcePath).isDirectory());
     assert.ok(lstatSync(fifoSourcePath).isFIFO());
     assert.equal(existsSync(absentSourcePath), false);
     assert.equal(readFileSync(hiddenSourcePath, "utf8"), "invented hidden-path marker\n");
     assert.equal(readFileSync(repeatedDotSourcePath, "utf8"), "invented repeated-dot marker\n");
     assert.equal(readFileSync(spaceSourcePath, "utf8"), "invented space-path marker\n");
     assert.equal(readFileSync(unicodeSourcePath, "utf8"), "invented unicode-path marker\n");
     assert.equal(readFileSync(percentSourcePath, "utf8"), "invented percent-path marker\n");
     assert.equal(readFileSync(newlineSourcePath, "utf8"), "invented control-path marker\n");
     assert.equal(readFileSync(trailingSeparatorSourcePath, "utf8"), "invented trailing-separator marker\n");
     assert.equal(readFileSync(doubledSeparatorSourcePath, "utf8"), "invented doubled-separator marker\n");

     const manifestPath = join(root, "dist", `${basename(root)}.edit.json`);
     const manifestBytes = readFileSync(manifestPath, "utf8");
     const manifest = JSON.parse(manifestBytes);
     assert.deepEqual(Object.keys(manifest), ["docId", "instance", "commit", "blocks"]);
     assert.equal(manifest.docId, "a1b2c3");
     assert.equal(manifest.instance, basename(root));
     assert.equal(manifest.commit, opaqueCommit);
     assert.deepEqual(Object.keys(manifest.blocks), ["a11111111", "a22222222", "a23232323"]);
     assert.deepEqual(Object.keys(manifest.blocks.a11111111), ["file", "section", "tag", "hash"]);
     assert.equal(manifestBytes, JSON.stringify(manifest, null, 2) + "\n");

     const nestedRoot = makeRoot("nested", "fixture-doc");
     writeFileSync(join(nestedRoot, "sections", "04-part.one_name-2.html"), "invented nested source\n");
     const nested = section('<h2 data-aid="affffffff">Nested instance.</h2>', "04-part.one_name-2.html", "nested");
     const nestedRows = markEditable([nested], doc, nestedRoot);
     assert.equal(nestedRows.length, 1);
     assert.deepEqual(
       { aid: nestedRows[0].aid, file: nestedRows[0].file, section: nestedRows[0].section, tag: nestedRows[0].tag },
       { aid: "affffffff", file: "sections/04-part.one_name-2.html", section: "nested", tag: "h2" },
     );
     assert.match(nestedRows[0].hash, /^[0-9a-f]{64}$/);
     assert.equal(nested.body, '<h2 data-aid="affffffff" data-editable>Nested instance.</h2>');
     const nestedManifestPath = join(nestedRoot, "dist", "fixture-doc.edit.json");
     const nestedManifestBytes = readFileSync(nestedManifestPath, "utf8");
     const nestedManifest = JSON.parse(nestedManifestBytes);
     assert.equal(nestedManifest.instance, "fixture-doc");
     assert.deepEqual(Object.keys(nestedManifest.blocks), ["affffffff"]);
     assert.equal(nestedManifestBytes, JSON.stringify(nestedManifest, null, 2) + "\n");

     for (const invalidBasename of ["bad name", ".leading", "trailing-", "double--dash", "café"]) {
       const invalidRoot = makeRoot(invalidBasename);
       writeFileSync(join(invalidRoot, "sections", "01-intro.html"), "invented invalid instance\n");
       const invalidBody = '<p data-aid="a42424242">Invalid instance.</p>';
       const invalidInstance = section(invalidBody);
       let invalidInstanceInspections = 0;
       fs.lstatSync = (...args) => {
         invalidInstanceInspections += 1;
         return originalLstatSync(...args);
       };
       syncBuiltinESMExports();
       try {
         assert.throws(() => markEditable([invalidInstance], doc, invalidRoot), (error) => {
           assert.ok(error instanceof BuildError);
           assert.equal(error.message,
             `${invalidRoot}: invalid instance basename (expected ^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$)`);
           return true;
         });
       } finally {
         fs.lstatSync = originalLstatSync;
         syncBuiltinESMExports();
       }
       assert.equal(invalidInstanceInspections, 0);
       assert.equal(invalidInstance.body, invalidBody);
       assert.equal(existsSync(join(invalidRoot, "dist")), false);
     }

     const atomicRoot = makeRoot();
     writeFileSync(join(atomicRoot, "sections", "01-intro.html"), "invented atomic source\n");
     const atomicTarget = join(atomicRoot, "dist", `${basename(atomicRoot)}.edit.json`);
     const originalOpenSync = fs.openSync;
     const originalWriteSync = fs.writeSync;
     const originalCloseSync = fs.closeSync;
     const originalUnlinkSync = fs.unlinkSync;
     const openCalls = [];
     let injectCollision = true;
     const collisionSentinel = Buffer.from("owned by another operation\n", "utf8");
     let injectedShortWrite = false;
     let writeCalls = 0;
     fs.openSync = (path, flags, mode) => {
       openCalls.push({ path, flags, mode });
       if (injectCollision) {
         injectCollision = false;
         const collisionFd = originalOpenSync(path, "wx", 0o644);
         originalWriteSync(collisionFd, collisionSentinel, 0, collisionSentinel.length);
         fs.closeSync(collisionFd);
         throw Object.assign(new Error("injected temporary collision"), { code: "EEXIST" });
       }
       return originalOpenSync(path, flags, mode);
     };
     fs.writeSync = (fd, buffer, offset, length) => {
       writeCalls += 1;
       if (!injectedShortWrite && length > 1) {
         injectedShortWrite = true;
         return originalWriteSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2)));
       }
       return originalWriteSync(fd, buffer, offset, length);
     };
     syncBuiltinESMExports();
     const atomicBody = '<p data-aid="a45454545">Atomic.</p>';
     const atomic = section(atomicBody);
     try {
       const atomicRows = markEditable([atomic], doc, atomicRoot);
       assert.deepEqual(atomicRows.map(({ aid }) => aid), ["a45454545"]);
     } finally {
       fs.openSync = originalOpenSync;
       fs.writeSync = originalWriteSync;
       syncBuiltinESMExports();
     }
     assert.equal(openCalls.length, 2, "one EEXIST must select one new candidate and retry");
     for (const call of openCalls) {
       assert.equal(typeof call.path, "string");
       assert.equal(dirname(call.path), dirname(atomicTarget));
       assert.notEqual(call.path, atomicTarget);
       assert.equal(call.flags, "wx");
       assert.equal(call.mode, 0o644);
     }
     assert.notEqual(openCalls[0].path, openCalls[1].path);
     assert.equal(injectedShortWrite, true);
     assert.ok(writeCalls >= 2, "a partial write must be followed by another write");
     assert.equal(atomic.body, '<p data-aid="a45454545" data-editable>Atomic.</p>');
     const atomicBytes = readFileSync(atomicTarget, "utf8");
     assert.equal(atomicBytes, JSON.stringify(JSON.parse(atomicBytes), null, 2) + "\n");
     assert.deepEqual(readFileSync(openCalls[0].path), collisionSentinel);
     assert.deepEqual(
       readdirSync(dirname(atomicTarget)).sort(),
       [basename(atomicTarget), basename(openCalls[0].path)].sort(),
     );

     const collisionRoot = makeRoot();
     writeFileSync(join(collisionRoot, "sections", "01-intro.html"), "invented collision source\n");
     const collisionPrior = priorManifest(collisionRoot);
     const collisionBody = '<p data-aid="a56565656">Collisions.</p>';
     const collision = section(collisionBody);
     const collisionPaths = [];
     fs.openSync = (path, flags, mode) => {
       collisionPaths.push(path);
       assert.equal(flags, "wx");
       assert.equal(mode, 0o644);
       throw Object.assign(new Error(`injected collision ${collisionPaths.length}`), { code: "EEXIST" });
     };
     syncBuiltinESMExports();
     try {
       assert.throws(() => markEditable([collision], doc, collisionRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${collisionPrior.target}: injected collision 16`);
         return true;
       });
     } finally {
       fs.openSync = originalOpenSync;
       syncBuiltinESMExports();
     }
     assert.equal(collisionPaths.length, 16);
     assert.equal(new Set(collisionPaths).size, 16);
     assert.ok(collisionPaths.every((path) => dirname(path) === collisionPrior.dist && path !== collisionPrior.target));
     assert.equal(collision.body, collisionBody);
     assert.equal(readFileSync(collisionPrior.target, "utf8"), collisionPrior.bytes);
     assert.deepEqual(readdirSync(collisionPrior.dist), [basename(collisionPrior.target)]);

     const emptyRoot = makeRoot();
     const emptySourcePath = join(emptyRoot, "sections", "01-intro.html");
     const emptySourceBytes = Buffer.from("invented empty-case source marker\n", "utf8");
     writeFileSync(emptySourcePath, emptySourceBytes);
     const emptySection = section('<p class="read-only" data-aid="a12121212">Demoted only.</p>');
     assert.deepEqual(markEditable([emptySection], doc, emptyRoot), []);
     assert.equal(emptySection.body, '<p class="read-only" data-aid="a12121212">Demoted only.</p>');
     assert.deepEqual(readFileSync(emptySourcePath), emptySourceBytes);
     const emptyManifestPath = join(emptyRoot, "dist", `${basename(emptyRoot)}.edit.json`);
     const expectedEmptyManifestBytes = [
       "{",
       '  "docId": "a1b2c3",',
       `  "instance": ${JSON.stringify(basename(emptyRoot))},`,
       `  "commit": ${JSON.stringify(opaqueCommit)},`,
       '  "blocks": {}',
       "}",
       "",
     ].join("\n");
     assert.equal(readFileSync(emptyManifestPath, "utf8"), expectedEmptyManifestBytes);

     const aidFailures = [
       ["missing", "<p>Missing aid.</p>"],
       ["malformed", '<p data-aid="A11111111">Malformed aid.</p>'],
       ["multiple", '<p data-aid="a11111111" data-aid="a22222222">Multiple aids.</p>'],
     ];
     for (const [name, body] of aidFailures) {
       const aidRoot = makeRoot();
       writeFileSync(join(aidRoot, "sections", "01-intro.html"), `invented ${name} aid\n`);
       const prior = priorManifest(aidRoot);
       const candidate = section(body);
       assert.throws(() => markEditable([candidate], doc, aidRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, "sections/01-intro.html: scanned p at offset 0 requires exactly one data-aid matching ^a[0-9a-f]{8}$");
         return true;
       });
       assert.equal(candidate.body, body);
       assert.equal(readFileSync(prior.target, "utf8"), prior.bytes);
       assert.deepEqual(readdirSync(prior.dist), [basename(prior.target)]);
     }

     const invalidDocs = [
       ["missing", new Map([["title", "Invented"]])],
       ["malformed", new Map([["id", "A1B2C3"], ["title", "Invented"]])],
     ];
     for (const [name, invalidDoc] of invalidDocs) {
       const docRoot = makeRoot();
       writeFileSync(join(docRoot, "sections", "01-intro.html"), `invented ${name} doc id\n`);
       const prior = priorManifest(docRoot);
       const candidate = section('<p data-aid="a81818181">Invalid doc id.</p>');
       assert.throws(() => markEditable([candidate], invalidDoc, docRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${docRoot}/doc.json: missing or invalid 'id' (expected six lowercase hexadecimal characters)`);
         return true;
       });
       assert.equal(candidate.body, '<p data-aid="a81818181">Invalid doc id.</p>');
       assert.equal(readFileSync(prior.target, "utf8"), prior.bytes);
       assert.deepEqual(readdirSync(prior.dist), [basename(prior.target)]);
     }

     const hiddenDuplicates = [
       ["demoted", '<p class="read-only" data-aid="aaaaaaaaa">Demoted duplicate.</p>'],
       ["noneditable", '<li data-aid="aaaaaaaaa">Noneditable duplicate.</li>'],
     ];
     for (const [name, hiddenBody] of hiddenDuplicates) {
       const duplicateRoot = makeRoot();
       for (const file of ["01-intro.html", "02-more.html"]) {
         writeFileSync(join(duplicateRoot, "sections", file), `invented ${name} duplicate\n`);
       }
       const prior = priorManifest(duplicateRoot);
       const duplicate = [
         section('<p data-aid="aaaaaaaaa">First.</p>'),
         section(hiddenBody, "02-more.html", "more"),
       ];
       const before = duplicate.map(({ body }) => body);
       assert.throws(() => markEditable(duplicate, doc, duplicateRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, "sections/02-more.html: duplicate data-aid 'aaaaaaaaa'");
         return true;
       });
       assert.deepEqual(duplicate.map(({ body }) => body), before);
       assert.equal(readFileSync(prior.target, "utf8"), prior.bytes);
       assert.deepEqual(readdirSync(prior.dist), [basename(prior.target)]);
     }

     const inspectionRoot = makeRoot();
     const inspectionSource = join(inspectionRoot, "sections", "01-intro.html");
     writeFileSync(inspectionSource, "invented inspection failure\n");
     const inspectionPrior = priorManifest(inspectionRoot);
     const inspectionBody = '<p data-aid="abbbbbbbb">Inspection.</p>';
     const inspection = section(inspectionBody);
     withFsFailure("lstatSync", "injected inspection failure", () => {
       assert.throws(() => markEditable([inspection], doc, inspectionRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${inspectionSource}: injected inspection failure`);
         return true;
       });
     });
     assert.equal(inspection.body, inspectionBody);
     assert.equal(readFileSync(inspectionPrior.target, "utf8"), inspectionPrior.bytes);
     assert.deepEqual(readdirSync(inspectionPrior.dist), [basename(inspectionPrior.target)]);

     const mkdirRoot = makeRoot();
     writeFileSync(join(mkdirRoot, "sections", "01-intro.html"), "invented mkdir failure\n");
     const mkdirTarget = join(mkdirRoot, "dist", `${basename(mkdirRoot)}.edit.json`);
     const mkdirBody = '<p data-aid="acccccccc">Mkdir.</p>';
     const mkdirCandidate = section(mkdirBody);
     withFsFailure("mkdirSync", "injected mkdir failure", () => {
       assert.throws(() => markEditable([mkdirCandidate], doc, mkdirRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${mkdirTarget}: injected mkdir failure`);
         return true;
       });
     });
     assert.equal(mkdirCandidate.body, mkdirBody);
     assert.equal(existsSync(join(mkdirRoot, "dist")), false);

     const noProgressRoot = makeRoot();
     writeFileSync(join(noProgressRoot, "sections", "01-intro.html"), "invented zero-write failure\n");
     const noProgressPrior = priorManifest(noProgressRoot);
     const noProgressBody = '<p data-aid="a67676767">No progress.</p>';
     const noProgress = section(noProgressBody);
     fs.writeSync = () => 0;
     syncBuiltinESMExports();
     try {
       assert.throws(() => markEditable([noProgress], doc, noProgressRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${noProgressPrior.target}: writeSync made no progress`);
         return true;
       });
     } finally {
       fs.writeSync = originalWriteSync;
       syncBuiltinESMExports();
     }
     assert.equal(noProgress.body, noProgressBody);
     assert.equal(readFileSync(noProgressPrior.target, "utf8"), noProgressPrior.bytes);
     assert.deepEqual(readdirSync(noProgressPrior.dist), [basename(noProgressPrior.target)]);

     const manifestFailures = [
       ["openSync", "injected open failure", false],
       ["writeSync", "injected write failure", false],
       ["fsyncSync", "injected sync failure", false],
       ["closeSync", "injected close failure", true],
       ["renameSync", "injected rename failure", false],
     ];
     for (const [method, message, afterOriginal] of manifestFailures) {
       const failedRoot = makeRoot();
       writeFileSync(join(failedRoot, "sections", "01-intro.html"), `invented ${method} failure\n`);
       const prior = priorManifest(failedRoot);
       const body = '<p data-aid="adddddddd">Transactional.</p>';
       const candidate = section(body);
       withFsFailure(method, message, () => {
         assert.throws(() => markEditable([candidate], doc, failedRoot), (error) => {
           assert.ok(error instanceof BuildError);
           assert.equal(error.message, `${prior.target}: ${message}`);
           return true;
         });
       }, afterOriginal);
       assert.equal(candidate.body, body);
       assert.equal(readFileSync(prior.target, "utf8"), prior.bytes);
       assert.deepEqual(readdirSync(prior.dist), [basename(prior.target)]);
     }

     const doubleFaultRoot = makeRoot();
     writeFileSync(join(doubleFaultRoot, "sections", "01-intro.html"), "invented double fault\n");
     const doubleFaultPrior = priorManifest(doubleFaultRoot);
     const doubleFaultBody = '<p data-aid="a34343434">Double fault.</p>';
     const doubleFault = section(doubleFaultBody);
     let closeAttempts = 0;
     let cleanupUnlinkAttempts = 0;
     fs.closeSync = (fd) => {
       closeAttempts += 1;
       if (closeAttempts === 1) throw injected("injected primary close failure");
       return originalCloseSync(fd);
     };
     fs.unlinkSync = (path) => {
       cleanupUnlinkAttempts += 1;
       originalUnlinkSync(path);
       throw injected("injected secondary cleanup failure");
     };
     syncBuiltinESMExports();
     try {
       assert.throws(() => markEditable([doubleFault], doc, doubleFaultRoot), (error) => {
         assert.ok(error instanceof BuildError);
         assert.equal(error.message, `${doubleFaultPrior.target}: injected primary close failure`);
         return true;
       });
     } finally {
       fs.closeSync = originalCloseSync;
       fs.unlinkSync = originalUnlinkSync;
       syncBuiltinESMExports();
     }
     assert.equal(closeAttempts, 2, "a pre-close failure must be retried during cleanup");
     assert.equal(cleanupUnlinkAttempts, 1, "the opened temporary file must be cleanup-unlinked once");
     assert.equal(doubleFault.body, doubleFaultBody);
     assert.equal(readFileSync(doubleFaultPrior.target, "utf8"), doubleFaultPrior.bytes);
     assert.deepEqual(readdirSync(doubleFaultPrior.dist), [basename(doubleFaultPrior.target)]);
     console.log("PASS  editable policy, manifest, skipped entries, exact validation, and every transaction boundary");
   } finally {
     if (priorCommit === undefined) delete process.env.COMMIT_REF;
     else process.env.COMMIT_REF = priorCommit;
     for (const root of roots) {
       assert.ok(root.startsWith(`${fixtureParent}/case-`));
       rmSync(root, { recursive: true, force: true });
     }
   }
   NODE
   p2d_policy_remove
   P2D_POLICY_ROOT=
   trap - EXIT HUP INT TERM
   echo 'PASS  P2-D policy fixture bounded cleanup'
   P2D_POLICY_GATE
   ```

   Expected: the script prints `PASS  P2-D policy fixture HUP/INT/TERM cleanup`, the existing policy/transaction `PASS` line, and `PASS  P2-D policy fixture bounded cleanup`, in that order, and exits `0`; all added ownership probes are silent on success. The shell installs first-signal HUP/INT/TERM and EXIT ownership before root creation and retains the latch throughout stop, group proof, bounded deletion, and final exit. Early, active-command, supervisor-terminal, and outer-finalizer-terminal probes require exact 129/130/143; each outer-finalizer case waits for proof of its first latch, sends a distinct later signal during cleanup, and proves the first status remains authoritative; natural target HUP/INT/TERM/KILL require 129/130/143/137. Before spawning its detached group anchor, the supervisor writes a mode-`0600` preparing record. The anchor waits on a private inherited handshake and cannot spawn the fixture until its exact PID/PGID has been published; EOF before that handshake exits without spawning. The anchor stays the live, direct-child group leader until the supervisor has sent group-wide TERM then KILL, reaped it, and proved the group (including `mkfifo` descendants) absent; only then are ownership records removed. The 120-second supervisor and 130-second outer bound are finite. Injected active-publication plus locator-write failure proves that the preparing/anchor records remain mode `0600`, identify the stopped group, and permit deterministic manual cleanup with zero test residue. After its finite TERM grace, the outer fallback may KILL only its still-unreaped direct supervisor; the handshake then closes before any unpublished target spawn, and every forced path retains evidence. It signals a group only while `ps` proves the exact anchor remains its live leader, never signals that numeric PGID after leader exit, and retains the guarded root whenever reaping or deletion is unproved. JavaScript `finally` still restores application seams and removes ordinary case directories, but the shell is the interruption owner. The literal hashes and bodies prove UTF-8 inner hashing, attribute order, conditional `data-md`, the exact `&`, `"`, `<`, `>` attribute-escape order, marked-inline demotion without either edit attribute, all major demotion classes, no history row, exact row order, canonical JSON bytes, and byte-for-byte preservation of an opaque `COMMIT_REF` with leading/trailing whitespace. The traversal, nested-slash, backslash, uppercase, wrong-suffix, leading-dot, doubled-dot, space, Unicode, percent, newline-control, NUL-control, trailing-separator, and doubled-separator names reach zero filesystem inspection calls; valid-name regular, directory, FIFO, missing, and symlink entries are inspected exactly once in section order. All skipped entries remain read-only, existing marker files are reread only by the assertions, directory/FIFO types and symlink target are re-inspected after instrumentation is restored, and missing paths remain absent. The valid `04-part.one_name-2.html` case proves the one-separator ASCII source-name grammar; invalid instance basenames fail before section inspection or `dist` creation; the explicit zero-row call writes the exact canonical manifest ending in `"blocks": {}` and one LF; and the nested instance uses its valid final-component basename.

   Missing, malformed, and multiple aids plus missing/malformed document IDs produce exact `BuildError` messages without changing bodies or prior manifest bytes. Duplicate aids are rejected even when their later occurrence is hidden in an attributed/demoted `p` or a noneditable `li`. The atomic-success probe creates a colliding sentinel, forces one `EEXIST`, requires a distinct sibling retry with exact `"wx"` and `0o644`, preserves the unowned collision file, forces a short write and requires another write, and proves the successfully opened temporary file is consumed by rename. A second probe requires exactly 16 distinct collision candidates and the sixteenth wrapped error, while the zero-progress probe requires its stable `BuildError`. Deterministically injected inspection, directory, non-collision open, write, sync, close, and rename failures assert the exact source/manifest-path message; each preserves section bodies and any prior target, and every manifest-operation failure leaves no operation-owned temporary sibling. The final double-fault probe makes the primary `closeSync()` fail before closing, requires a cleanup close retry, makes cleanup `unlinkSync()` fail after deleting the temporary, and proves that the primary manifest-path `BuildError` still wins.

3. Prove the immutable golden benchmark independently of final policy filters, then require the current integration corpus to match its exact file set, counts, and failure identities. The command resolves the exact ticket-owned commit, reads only the eight named golden paths from that object, uses the exported source parser and P1-D scanner rather than a second block regex, and deletes its temporary export in `finally`:

   ```bash
   bash <<'P2D_GOLDEN_GATE'
   set -euo pipefail
   P2D_GOLDEN_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
   P2D_GOLDEN_ROOT=
   P2D_GOLDEN_ACTIVE_PID=
   P2D_GOLDEN_SIGNAL_STATUS=0
   P2D_GOLDEN_SIGNAL_COUNT=0
   P2D_GOLDEN_CLEANING=0

   p2d_golden_manual() {
     local reason="$1" pid="${2:-}" pgid="${3:-}" root="${P2D_GOLDEN_ROOT:-}" locator=no-safe-locator
     if [[ -n "$root" && "${root%/*}" == "$P2D_GOLDEN_PARENT" && -d "$root" && ! -L "$root" ]]; then
       case "${root##*/}" in
         p2d-golden.??????|p2d-golden-probe.??????)
           locator="$root/manual-remediation.txt"
           (umask 077; set -o noclobber; printf 'reason=%s\npid=%s\npgid=%s\n' "$reason" "${pid:-unknown}" "${pgid:-unknown}" >"$locator") 2>/dev/null || true
           ;;
       esac
     fi
     printf 'ERROR  P2-D golden fixture requires manual remediation: %s (pid %s, pgid %s)\n' \
       "$locator" "${pid:-unknown}" "${pgid:-unknown}" >&2
   }
   p2d_golden_stop() {
     local pid="${P2D_GOLDEN_ACTIVE_PID:-}" group= attempts=0 pgid= command= forced=0
     case "$pid" in ''|*[!0-9]*|0|1) pid= ;; esac
     if [[ -n "$pid" ]]; then
       kill -TERM "$pid" 2>/dev/null || true
       while kill -0 "$pid" 2>/dev/null && (( attempts < 240 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; forced=1; fi
       attempts=0
       while kill -0 "$pid" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then p2d_golden_manual supervisor-unreaped "$pid"; return 1; fi
       wait "$pid" 2>/dev/null || true
     fi
     P2D_GOLDEN_ACTIVE_PID=
     if [[ -n "${P2D_GOLDEN_ROOT:-}" && -f "$P2D_GOLDEN_ROOT/active-group.pid" ]]; then
       IFS= read -r group <"$P2D_GOLDEN_ROOT/active-group.pid" || true
       case "$group" in ''|*[!0-9]*|0|1) p2d_golden_manual invalid-group "$pid" "$group"; return 1 ;; esac
       pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
       command="$(ps -o command= -p "$group" 2>/dev/null || true)"
       if [[ "$pgid" != "$group" || "$command" != *"$P2D_GOLDEN_SUPERVISOR --group-anchor"* ]]; then
         p2d_golden_manual anchor-ownership-unproved "$group" "$group"
         return 1
       fi
       kill -TERM -- "-$group" 2>/dev/null || true
       attempts=0
       while kill -0 "$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$group" 2>/dev/null; then
         pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
         command="$(ps -o command= -p "$group" 2>/dev/null || true)"
         if [[ "$pgid" != "$group" || "$command" != *"$P2D_GOLDEN_SUPERVISOR --group-anchor"* ]]; then
           p2d_golden_manual anchor-ownership-lost "$group" "$group"
           return 1
         fi
         kill -KILL -- "-$group" 2>/dev/null || true
       fi
       attempts=0
       while kill -0 -- "-$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 -- "-$group" 2>/dev/null; then p2d_golden_manual group-unreaped "$group" "$group"; return 1; fi
       p2d_golden_manual fallback-leader-reap-unproved "$group" "$group"
       return 1
     fi
     if [[ -n "${P2D_GOLDEN_ROOT:-}" ]] && { [[ -f "$P2D_GOLDEN_ROOT/supervisor-anchor.json" ]] || [[ -f "$P2D_GOLDEN_ROOT/supervisor-preparing.json" ]]; }; then
       p2d_golden_manual incomplete-anchor-publication "$pid"
       return 1
     fi
     if (( forced != 0 )); then p2d_golden_manual supervisor-forced "$pid"; return 1; fi
   }
   p2d_golden_remove() {
     local root="${P2D_GOLDEN_ROOT:-}" worker attempts=0
     [[ -n "$root" ]] || return 0
     if [[ "${root%/*}" != "$P2D_GOLDEN_PARENT" ]]; then p2d_golden_manual unsafe-cleanup; return 1; fi
     case "${root##*/}" in p2d-golden.??????|p2d-golden-probe.??????) ;; *) p2d_golden_manual unsafe-cleanup; return 1 ;; esac
     [[ ! -e "$root" ]] && return 0
     if [[ ! -d "$root" || -L "$root" ]]; then p2d_golden_manual unsafe-cleanup; return 1; fi
     if [[ -f "$root/manual-remediation.txt" || -f "$root/supervisor-anchor.json" || -f "$root/supervisor-preparing.json" ]]; then
       printf 'ERROR  retained P2-D golden fixture for manual remediation: %s\n' "$root" >&2
       return 1
     fi
     node -e 'require("node:fs").rmSync(process.argv[1], {recursive:true, force:true, maxRetries:2, retryDelay:25})' "$root" &
     worker=$!
     while kill -0 "$worker" 2>/dev/null && (( attempts < 200 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$worker" 2>/dev/null; then kill -KILL "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; p2d_golden_manual cleanup-timeout "$worker"; return 1; fi
     wait "$worker" 2>/dev/null || true
     if [[ -e "$root" ]]; then p2d_golden_manual cleanup-failed "$worker"; return 1; fi
   }
   p2d_golden_cleanup() {
     local status=$? cleanup_status=0 latch=
     trap - EXIT
     P2D_GOLDEN_CLEANING=1
     if ! p2d_golden_stop; then
       cleanup_status=1
     else
       if [[ -n "${P2D_GOLDEN_CLEANUP_READY:-}" ]]; then
         case "$P2D_GOLDEN_CLEANUP_READY" in "$P2D_GOLDEN_ROOT"/.outer-finish-HUP.ready|"$P2D_GOLDEN_ROOT"/.outer-finish-INT.ready|"$P2D_GOLDEN_ROOT"/.outer-finish-TERM.ready) ;; *) p2d_golden_manual invalid-cleanup-rendezvous; cleanup_status=1 ;; esac
         if (( cleanup_status == 0 )); then
           (umask 077; printf 'ready\n' >"$P2D_GOLDEN_CLEANUP_READY")
           local rendezvous_attempts=0
           while (( P2D_GOLDEN_SIGNAL_COUNT == 0 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
           if (( P2D_GOLDEN_SIGNAL_COUNT == 0 )); then
             p2d_golden_manual cleanup-first-signal-timeout; cleanup_status=1
           else
             latch="${P2D_GOLDEN_CLEANUP_READY%.ready}.latched"
             (umask 077; printf '%s\n' "$P2D_GOLDEN_SIGNAL_STATUS" >"$latch")
             rendezvous_attempts=0
             while (( P2D_GOLDEN_SIGNAL_COUNT < 2 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
             if (( P2D_GOLDEN_SIGNAL_COUNT < 2 )); then p2d_golden_manual cleanup-second-signal-timeout; cleanup_status=1; fi
           fi
         fi
       fi
       if (( cleanup_status == 0 )); then p2d_golden_remove || cleanup_status=1; fi
     fi
     if (( P2D_GOLDEN_SIGNAL_STATUS != 0 )); then status=$P2D_GOLDEN_SIGNAL_STATUS
     elif (( status == 0 && cleanup_status != 0 )); then status=1
     fi
     if (( P2D_GOLDEN_SIGNAL_STATUS != 0 )); then status=$P2D_GOLDEN_SIGNAL_STATUS; fi
     exit "$status"
   }
   p2d_golden_signal() {
     P2D_GOLDEN_SIGNAL_COUNT=$((P2D_GOLDEN_SIGNAL_COUNT + 1))
     if (( P2D_GOLDEN_SIGNAL_STATUS == 0 )); then P2D_GOLDEN_SIGNAL_STATUS="$1"; fi
     if (( P2D_GOLDEN_CLEANING == 0 )); then exit "$P2D_GOLDEN_SIGNAL_STATUS"; fi
   }
   p2d_golden_run() {
     local attempts=0 status stdin_fd
     exec {stdin_fd}<&0
     P2D_FIXTURE_ROOT="$P2D_GOLDEN_ROOT" node "$P2D_GOLDEN_SUPERVISOR" "$@" <&"$stdin_fd" & P2D_GOLDEN_ACTIVE_PID=$!
     exec {stdin_fd}<&-
     while kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 2600 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null; then echo 'ERROR  P2-D golden supervisor exceeded 130 seconds' >&2; p2d_golden_stop || return 1; return 124; fi
     set +e; wait "$P2D_GOLDEN_ACTIVE_PID"; status=$?; set -e
     P2D_GOLDEN_ACTIVE_PID=; return "$status"
   }
   trap p2d_golden_cleanup EXIT
   trap 'p2d_golden_signal 129' HUP
   trap 'p2d_golden_signal 130' INT
   trap 'p2d_golden_signal 143' TERM
   p2d_golden_early_probe() {
     local signal="$1" expected="$2" status
     if (
       P2D_GOLDEN_ROOT=
       P2D_GOLDEN_ACTIVE_PID=
       P2D_GOLDEN_SIGNAL_STATUS=0
       P2D_GOLDEN_CLEANING=0
       trap p2d_golden_cleanup EXIT
       trap 'p2d_golden_signal 129' HUP
       trap 'p2d_golden_signal 130' INT
       trap 'p2d_golden_signal 143' TERM
       kill -s "$signal" "$BASHPID"
       exit 99
     ); then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" ]] || { echo "ERROR  P2-D golden early $signal status failed" >&2; return 1; }
   }
   p2d_golden_early_probe HUP 129
   p2d_golden_early_probe INT 130
   p2d_golden_early_probe TERM 143
   P2D_GOLDEN_ROOT="$(mktemp -d "$P2D_GOLDEN_PARENT/p2d-golden.XXXXXX")"
   export P2D_GOLDEN_ROOT P2D_GOLDEN_PARENT
   P2D_GOLDEN_SUPERVISOR="$P2D_GOLDEN_ROOT/supervise.mjs"
   export P2D_GOLDEN_SUPERVISOR P2D_FIXTURE_FAMILY=golden
   (umask 077; : >"$P2D_GOLDEN_SUPERVISOR")
   sed 's/^   //' >"$P2D_GOLDEN_SUPERVISOR" <<'P2D_FIXTURE_SUPERVISOR_JS'
   import { spawn } from "node:child_process";
   import { createReadStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
   import { constants } from "node:os";
   import { basename, dirname, join } from "node:path";

   const family = process.env.P2D_FIXTURE_FAMILY ?? "";
   const root = process.env.P2D_FIXTURE_ROOT ?? "";
   const parent = process.env[`P2D_${family.toUpperCase()}_PARENT`] ?? "";
   if (!/^(?:policy|golden)$/.test(family) || dirname(root) !== parent
       || !new RegExp(`^p2d-${family}(?:-probe)?\\.[A-Za-z0-9]{6}$`).test(basename(root))) {
     console.error("ERROR  P2-D fixture supervisor refused an unexpected root");
     process.exit(1);
   }
   const pidPath = join(root, "active-group.pid");
   const preparingPath = join(root, "supervisor-preparing.json");
   const anchorPath = join(root, "supervisor-anchor.json");
   const outcomePath = join(root, "target-outcome.json");
   const locator = join(root, "manual-remediation.txt");
   const ownerSignals = new Map([["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

   if (process.argv[2] === "--group-anchor") {
     const target = process.argv.slice(5);
     const targetOutcome = process.argv[3] ?? "";
     const expectedSupervisor = Number(process.argv[4]);
     if (target.length === 0 || targetOutcome !== outcomePath || !Number.isInteger(expectedSupervisor)) process.exit(2);
     for (const signal of ownerSignals.keys()) process.on(signal, () => {});
     let gate = "";
     const gateStream = createReadStream(null, { fd: 3, autoClose: true, encoding: "utf8" });
     gateStream.on("data", (chunk) => { gate += chunk; });
     gateStream.once("error", () => process.exit(1));
     gateStream.once("end", () => {
       if (gate !== "go\n") process.exit(1);
       const targetChild = spawn(target[0], target.slice(1), { stdio: "inherit" });
       const publishOutcome = (status, reason) => {
         const temporary = `${targetOutcome}.${process.pid}.tmp`;
         try {
           writeFileSync(temporary, `${JSON.stringify({ status, reason })}\n`, { flag: "wx", mode: 0o600 });
           renameSync(temporary, targetOutcome);
         } catch {
           if (process.ppid === expectedSupervisor) {
             try { process.kill(expectedSupervisor, "SIGUSR1"); } catch {}
           }
         }
       };
       targetChild.once("error", () => publishOutcome(1, "target-spawn-error"));
       targetChild.once("exit", (code, signal) => {
         const number = signal ? constants.signals[signal] : undefined;
         publishOutcome(signal && number ? 128 + number : (code ?? 1), "target-exit");
       });
     });
     setInterval(() => {}, 1_000);
   } else {
   const argv = process.argv.slice(2);
   if (argv.length === 0) process.exit(2);
   const finishReady = process.env.P2D_FIXTURE_FINISH_READY ?? "";
   if (finishReady && (dirname(finishReady) !== root || !/^\.finish-(?:HUP|INT|TERM)\.ready$/.test(basename(finishReady)))) {
     console.error(`ERROR  P2-D ${family} supervisor refused an unexpected finish rendezvous`);
     process.exit(1);
   }
   let anchor;
   let finishing = false;
   let latchedSignalStatus = 0;
   let timer;
   let outcomePoll;
   let retainEvidence = false;
   let targetReleased = false;

   function groupAlive() {
     if (!anchor?.pid) return false;
     try { process.kill(-anchor.pid, 0); return true; }
     catch (error) { if (error?.code === "ESRCH") return false; if (error?.code === "EPERM") return true; throw error; }
   }
   function anchorOwned() {
     return Boolean(anchor?.pid && anchor.exitCode === null && anchor.signalCode === null);
   }
   function signalGroup(signal) {
     if (!anchorOwned()) throw new Error("anchor ownership lost before signal");
     try { process.kill(-anchor.pid, signal); }
     catch (error) { if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error; }
   }
   function evidence(reason) {
     const record = `${JSON.stringify({ reason, supervisorPid: process.pid, leaderPid: anchor?.pid ?? null, processGroup: anchor?.pid ?? null })}\n`;
     if (process.env.P2D_FIXTURE_INJECT_EVIDENCE_FAILURE !== "1") {
       try { writeFileSync(locator, record, { flag: "wx", mode: 0o600 }); } catch {}
     }
     console.error(`ERROR  P2-D ${family} fixture requires manual remediation: ${locator} (pid ${anchor?.pid ?? "unknown"}, pgid ${anchor?.pid ?? "unknown"})`);
   }
   async function stopGroup() {
     if (!targetReleased) {
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) anchor.kill("SIGKILL");
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) return false;
       for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
       return !groupAlive();
     }
     if (anchorOwned()) signalGroup("SIGTERM");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) signalGroup("SIGKILL");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) return false;
     for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
     return !groupAlive();
   }
   async function finish(status, reason) {
     if (finishing) return;
     finishing = true;
     clearTimeout(timer);
     clearInterval(outcomePoll);
     if (finishReady) {
       try { writeFileSync(finishReady, `${status} ${reason}\n`, { flag: "wx", mode: 0o600 }); } catch {}
     }
     let stopped = false;
     let stopReason = reason;
     try { stopped = await stopGroup(); } catch (error) { stopReason = `${reason}:${error?.code ?? error?.name ?? "unknown"}`; }
     if (!stopped || retainEvidence) {
       evidence(!stopped ? stopReason : reason);
       process.exit(latchedSignalStatus || 1);
     }
     rmSync(pidPath, { force: true });
     rmSync(outcomePath, { force: true });
     rmSync(anchorPath, { force: true });
     rmSync(preparingPath, { force: true });
     process.exit(latchedSignalStatus || status);
   }
   for (const [signal, status] of ownerSignals) process.on(signal, () => {
     if (latchedSignalStatus === 0) latchedSignalStatus = status;
     void finish(status, signal);
   });
   process.on("SIGUSR1", () => { retainEvidence = true; void finish(1, "anchor-outcome-publication-failure"); });
   try {
     writeFileSync(preparingPath, `${JSON.stringify({ state: "preparing", supervisorPid: process.pid })}\n`, { flag: "wx", mode: 0o600 });
   } catch {
     evidence("preparing-publication-failure");
     process.exit(1);
   }
   anchor = spawn(process.execPath, [process.argv[1], "--group-anchor", outcomePath, String(process.pid), ...argv], {
     detached: true, stdio: ["inherit", "inherit", "inherit", "pipe"],
   });
   anchor.once("error", () => { retainEvidence = true; void finish(1, "anchor-spawn-error"); });
   anchor.once("exit", () => {
     if (!finishing) { retainEvidence = true; void finish(1, "anchor-exit-before-outcome"); }
   });
   try {
     if (!anchor.pid) throw new Error("missing anchor pid");
     writeFileSync(anchorPath, `${JSON.stringify({ state: "published", supervisorPid: process.pid, leaderPid: anchor.pid, processGroup: anchor.pid })}\n`, { flag: "wx", mode: 0o600 });
     if (process.env.P2D_FIXTURE_INJECT_PUBLICATION_FAILURE === "1") throw new Error("injected publication failure");
     writeFileSync(pidPath, `${anchor.pid}\n`, { flag: "wx", mode: 0o600 });
     anchor.stdio[3].end("go\n");
     targetReleased = true;
   } catch {
     retainEvidence = true;
     anchor.stdio?.[3]?.end();
     void finish(1, "publication-failure");
   }
   outcomePoll = setInterval(() => {
     try {
       const outcome = JSON.parse(readFileSync(outcomePath, "utf8"));
       if (!Number.isInteger(outcome.status) || outcome.status < 0 || outcome.status > 255) throw new Error("invalid outcome");
       void finish(outcome.status, outcome.reason ?? "target-exit");
     } catch (error) {
       if (error?.code !== "ENOENT" && !finishing) { retainEvidence = true; void finish(1, "invalid-target-outcome"); }
     }
   }, 20);
   timer = setTimeout(() => { void finish(124, "120-second-timeout"); }, 120_000);
   }
   P2D_FIXTURE_SUPERVISOR_JS

   p2d_golden_outer_terminal_probe() {
     local signal="$1" expected="$2" later="$3" ready probe_root latch first_latched= status attempts=0
     ready="$P2D_GOLDEN_ROOT/.outer-finish-$signal.ready"
     (
       P2D_GOLDEN_ROOT=
       P2D_GOLDEN_ACTIVE_PID=
       P2D_GOLDEN_SIGNAL_STATUS=0
       P2D_GOLDEN_SIGNAL_COUNT=0
       P2D_GOLDEN_CLEANING=0
       trap p2d_golden_cleanup EXIT
       trap 'p2d_golden_signal 129' HUP
       trap 'p2d_golden_signal 130' INT
       trap 'p2d_golden_signal 143' TERM
       P2D_GOLDEN_ROOT="$(mktemp -d "$P2D_GOLDEN_PARENT/p2d-golden-probe.XXXXXX")"
       export P2D_GOLDEN_ROOT
       P2D_GOLDEN_CLEANUP_READY="$P2D_GOLDEN_ROOT/.outer-finish-$signal.ready"
       printf '%s\n' "$P2D_GOLDEN_ROOT" >"$ready.root"
       exit 0
     ) &
     P2D_GOLDEN_ACTIVE_PID=$!
     while [[ ! -s "$ready.root" ]] && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready.root" ]] || { echo "ERROR  P2-D golden terminal $signal root rendezvous failed" >&2; return 1; }
     probe_root="$(<"$ready.root")"
     attempts=0
     while [[ ! -s "$probe_root/.outer-finish-$signal.ready" ]] && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/.outer-finish-$signal.ready" ]] || { echo "ERROR  P2-D golden terminal $signal cleanup rendezvous failed" >&2; return 1; }
     kill -s "$signal" "$P2D_GOLDEN_ACTIVE_PID"
     latch="$probe_root/.outer-finish-$signal.latched"
     attempts=0
     while [[ ! -s "$latch" ]] && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$latch" ]] && first_latched="$(<"$latch")"
     kill -s "$later" "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null || true
     if wait "$P2D_GOLDEN_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_GOLDEN_ACTIVE_PID=
     [[ "$first_latched" == "$expected" && "$status" -eq "$expected" && ! -e "$probe_root" ]] || { echo "ERROR  P2-D golden terminal $signal then $later first-signal/cleanup failed" >&2; return 1; }
     rm -f -- "$ready.root"
   }
   p2d_golden_outer_terminal_probe HUP 129 TERM
   p2d_golden_outer_terminal_probe INT 130 HUP
   p2d_golden_outer_terminal_probe TERM 143 INT

   p2d_golden_probe() {
     local signal="$1" expected="$2" owner_root="$P2D_GOLDEN_ROOT" supervisor="$P2D_GOLDEN_SUPERVISOR"
     local ready="$owner_root/.probe-$signal" descendant_ready="$owner_root/.descendant-$signal"
     local probe_root descendant_pid group status attempts=0
     (
       P2D_GOLDEN_ROOT=
       P2D_GOLDEN_ACTIVE_PID=
       P2D_GOLDEN_SIGNAL_STATUS=0
       P2D_GOLDEN_CLEANING=0
       trap p2d_golden_cleanup EXIT
       trap 'p2d_golden_signal 129' HUP
       trap 'p2d_golden_signal 130' INT
       trap 'p2d_golden_signal 143' TERM
       P2D_GOLDEN_ROOT="$(mktemp -d "$P2D_GOLDEN_PARENT/p2d-golden-probe.XXXXXX")"
       export P2D_GOLDEN_ROOT
       printf '%s\n' "$P2D_GOLDEN_ROOT" >"$ready"
       P2D_FIXTURE_ROOT="$P2D_GOLDEN_ROOT" node "$supervisor" \
         sh -c 'sleep 30 & child=$!; printf "%s\n" "$child" >"$1"; wait' sh "$descendant_ready" &
       P2D_GOLDEN_ACTIVE_PID=$!
       wait "$P2D_GOLDEN_ACTIVE_PID"
     ) &
     P2D_GOLDEN_ACTIVE_PID=$!
     while [[ ! -s "$ready" ]] && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready" ]] || { p2d_golden_stop || true; echo "ERROR  P2-D golden $signal probe did not become ready" >&2; return 1; }
     probe_root="$(<"$ready")"
     attempts=0
     while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$descendant_ready" ]]; } && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/active-group.pid" && -s "$descendant_ready" ]] || { p2d_golden_stop || true; echo "ERROR  P2-D golden $signal process group did not become ready" >&2; return 1; }
     group="$(<"$probe_root/active-group.pid")"
     descendant_pid="$(<"$descendant_ready")"
     case "$group" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D golden $signal process group invalid" >&2; return 1 ;; esac
     case "$descendant_pid" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D golden $signal descendant PID invalid" >&2; return 1 ;; esac
     kill -0 "$descendant_pid"
     kill -s "$signal" "$P2D_GOLDEN_ACTIVE_PID"
     attempts=0
     while kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null; then p2d_golden_stop || true; echo "ERROR  P2-D golden $signal cleanup probe exceeded 20 seconds" >&2; return 1; fi
     set +e; wait "$P2D_GOLDEN_ACTIVE_PID"; status=$?; set -e
     P2D_GOLDEN_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$probe_root" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null && ! kill -0 "$descendant_pid" 2>/dev/null \
       || { echo "ERROR  P2-D golden $signal cleanup probe failed" >&2; return 1; }
     rm -f -- "$ready" "$descendant_ready"
   }
   p2d_golden_probe HUP 129
   p2d_golden_probe INT 130
   p2d_golden_probe TERM 143
   echo 'PASS  P2-D golden fixture HUP/INT/TERM cleanup'

   p2d_golden_supervisor_terminal_probe() {
     local signal="$1" expected="$2" status group attempts=0
     local finish_ready="$P2D_GOLDEN_ROOT/.finish-$signal.ready" child_ready="$P2D_GOLDEN_ROOT/.child-$signal.ready"
     P2D_FIXTURE_FINISH_READY="$finish_ready" P2D_FIXTURE_ROOT="$P2D_GOLDEN_ROOT" node "$P2D_GOLDEN_SUPERVISOR" \
       sh -c '(trap "" HUP INT TERM; printf "ready\n" >"$1"; while :; do sleep 1; done) & while [ ! -s "$1" ]; do sleep 0.01; done' \
       sh "$child_ready" &
     P2D_GOLDEN_ACTIVE_PID=$!
     while { [[ ! -s "$finish_ready" ]] || [[ ! -s "$child_ready" ]] || [[ ! -s "$P2D_GOLDEN_ROOT/active-group.pid" ]]; } \
       && kill -0 "$P2D_GOLDEN_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$finish_ready" && -s "$child_ready" && -s "$P2D_GOLDEN_ROOT/active-group.pid" ]] || { echo "ERROR  P2-D golden terminal supervisor $signal rendezvous failed" >&2; return 1; }
     group="$(<"$P2D_GOLDEN_ROOT/active-group.pid")"
     kill -s "$signal" "$P2D_GOLDEN_ACTIVE_PID"
     if wait "$P2D_GOLDEN_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_GOLDEN_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$P2D_GOLDEN_ROOT/active-group.pid" && ! -e "$P2D_GOLDEN_ROOT/supervisor-anchor.json" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null \
       || { echo "ERROR  P2-D golden terminal supervisor $signal latch failed" >&2; return 1; }
     rm -f -- "$finish_ready" "$child_ready"
   }
   p2d_golden_supervisor_terminal_probe HUP 129
   p2d_golden_supervisor_terminal_probe INT 130
   p2d_golden_supervisor_terminal_probe TERM 143

   p2d_golden_natural_probe() {
     local signal="$1" expected="$2" status
     if p2d_golden_run node -e 'process.kill(process.pid, process.argv[1])' "SIG$signal"; then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" && ! -e "$P2D_GOLDEN_ROOT/active-group.pid" ]] || { echo "ERROR  P2-D golden natural SIG$signal status failed" >&2; return 1; }
   }
   p2d_golden_natural_probe HUP 129
   p2d_golden_natural_probe INT 130
   p2d_golden_natural_probe TERM 143
   p2d_golden_natural_probe KILL 137

   p2d_golden_publication_probe() {
     local owner_root="$P2D_GOLDEN_ROOT" probe_root status supervisor_pid attempts=0 group
     probe_root="$(mktemp -d "$P2D_GOLDEN_PARENT/p2d-golden-probe.XXXXXX")"
     P2D_FIXTURE_ROOT="$probe_root" P2D_FIXTURE_INJECT_PUBLICATION_FAILURE=1 P2D_FIXTURE_INJECT_EVIDENCE_FAILURE=1 \
       node "$P2D_GOLDEN_SUPERVISOR" true >/dev/null 2>&1 &
     supervisor_pid=$!
     while kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$supervisor_pid" 2>/dev/null; then echo 'ERROR  P2-D golden publication-failure probe exceeded 20 seconds' >&2; return 1; fi
     if wait "$supervisor_pid"; then status=0; else status=$?; fi
     [[ "$status" -eq 1 && -s "$probe_root/supervisor-preparing.json" && -s "$probe_root/supervisor-anchor.json" && ! -e "$probe_root/manual-remediation.txt" ]] \
       || { echo 'ERROR  P2-D golden publication/evidence failure was not retained' >&2; return 1; }
     group="$(node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="published"||a.leaderPid!==a.processGroup) process.exit(1);process.stdout.write(String(a.processGroup))' "$probe_root/supervisor-anchor.json")"
     case "$group" in ''|*[!0-9]*|0|1) echo 'ERROR  P2-D golden retained anchor evidence invalid' >&2; return 1 ;; esac
     ! kill -0 -- "-$group" 2>/dev/null || { echo 'ERROR  P2-D golden publication-failure group survived' >&2; return 1; }
     node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="preparing"||!Number.isInteger(a.supervisorPid)) process.exit(1)' "$probe_root/supervisor-preparing.json"
     rm -f -- "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" "$probe_root/active-group.pid"
     P2D_GOLDEN_ROOT="$probe_root"
     if ! p2d_golden_remove; then P2D_GOLDEN_ROOT="$owner_root"; return 1; fi
     P2D_GOLDEN_ROOT="$owner_root"
     [[ ! -e "$probe_root" ]] || { echo 'ERROR  P2-D golden publication probe residue' >&2; return 1; }
   }
   p2d_golden_publication_probe

   p2d_golden_run node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { execFileSync } from "node:child_process";
   import { createHash } from "node:crypto";
   import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
   import { dirname, join } from "node:path";
   import { scanBlocks } from "./templates/docbuild/dist/anchor-core.js";
   import { parseSection } from "./templates/docbuild/dist/index.js";
   import { toHtml, toMd } from "./templates/docbuild/dist/inline_md.js";

   const GOLDEN_COMMIT = "2168188f115e4e3453cb75818f8458090f09aaa5";
   const GOLDEN_FILES = [
     "example/sections/01-problem.html",
     "example/sections/02-solution.html",
     "example/sections/03-architecture.html",
     "example/sections/04-build-order.html",
     "example/sections/05-open-questions.html",
     "templates/components/sections/01-structure.html",
     "templates/components/sections/02-diagrams.html",
     "templates/components/sections/03-content.html",
   ];
   const editable = new Set(["p", "h2", "h3", "h4"]);
   const EXPECTED_FAILURES = [
     "example/sections/01-problem.html#sha256=888db89d42e33871c31959212c7ea5b2d80de0a7666ff68d066b3011848e4d91",
     "example/sections/01-problem.html#sha256=9e5dd0c049232efe97a22fc3b2e1524e3fc67368282faa3c601449c973bebd28",
     "example/sections/01-problem.html#sha256=9cc348927316800ff13d3ef81994b8bbf7fc0aaee8059d360509243d7cd86edb",
     "example/sections/02-solution.html#sha256=933945c5aed1485143afa6b04322245afb969877f7f591d94c02c02f4ecc552f",
     "example/sections/02-solution.html#sha256=549b4d723405b87559ade7be5f68781680ff33cc2df54f9f7c6a4299838571ec",
     "example/sections/03-architecture.html#sha256=de35eab2cd73d139c467accf95685886a38e2a1ab2af29017eb9f8b0f2b17a9b",
     "example/sections/04-build-order.html#sha256=2446390189bb57faa59ff5c8ea434381d06b952f62e57755000f845f18d452c1",
     "example/sections/05-open-questions.html#sha256=7137451ead31e07f730e488c68530846871462e49fe319ee610539b3e35950f7",
     "example/sections/05-open-questions.html#sha256=2ede3d04aeabce1c63da557270dee5a7fc818429dff03e8db226adc10e0f61ba",
     "example/sections/05-open-questions.html#sha256=aa2790b548100b44ad0b7c3c63cbf5276959100540bfcff47a7507a29c0d2d67",
     "example/sections/05-open-questions.html#sha256=80080e534cebf6c24f10cc92238e8478e6e0f46d79c4438ea2ef9f21ef6cc44d",
     "templates/components/sections/02-diagrams.html#sha256=428fa42516e07840d63a06d5fec06965d812d64ee26b79f3155907f81b3fe25c",
   ];

   function measure(entries) {
     const failures = [];
     let candidates = 0;
     for (const { label, path } of entries) {
       const section = parseSection(path);
       for (const block of scanBlocks(section.body)) {
         if (!editable.has(block.tag)) continue;
         candidates += 1;
         const inner = section.body.slice(block.innerStart, block.innerEnd);
         if (toHtml(toMd(inner)) !== inner) {
           failures.push({
             file: label,
             outer: section.body.slice(block.openStart, block.closeEnd),
           });
         }
       }
     }
     return { candidates, failures, passes: candidates - failures.length };
   }

   function failureIdentities(failures) {
     return failures.map(({ file, outer }) =>
       `${file}#sha256=${createHash("sha256").update(outer, "utf8").digest("hex")}`);
   }

   function readGoldenObject(arguments_, encoding) {
     try {
       return execFileSync("git", arguments_, {
         encoding,
         timeout: 10_000,
         killSignal: "SIGKILL",
         maxBuffer: 16 * 1024 * 1024,
         stdio: ["ignore", "pipe", "pipe"],
       });
     } catch {
       assert.fail(`P2-D immutable golden object unavailable within 10 seconds: ${arguments_.join(" ")}`);
     }
   }

   const resolved = readGoldenObject(["rev-parse", "--verify", `${GOLDEN_COMMIT}^{commit}`], "utf8").trim();
   assert.equal(resolved, GOLDEN_COMMIT, "P2-D golden commit did not resolve exactly");
   const fixtureParent = process.env.P2D_GOLDEN_ROOT;
   assert.match(fixtureParent ?? "", /\/p2d-golden\.[^/]+$/);
   const goldenRoot = join(fixtureParent, "export");
   mkdirSync(goldenRoot);
   try {
     const goldenEntries = GOLDEN_FILES.map((file) => {
       const path = join(goldenRoot, file);
       mkdirSync(dirname(path), { recursive: true });
       writeFileSync(path, readGoldenObject(["show", `${GOLDEN_COMMIT}:${file}`]));
       return { label: file, path };
     });
     const golden = measure(goldenEntries);
     assert.equal(golden.candidates, 91);
     assert.equal(golden.passes, 79);
     assert.deepEqual(failureIdentities(golden.failures), EXPECTED_FAILURES);
   } finally {
     assert.equal(goldenRoot, join(fixtureParent, "export"));
     rmSync(goldenRoot, { recursive: true, force: true });
   }
   console.log("PASS  frozen round-trip golden: 79 of 91; 12 exact demotions");

   const sourceName = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$/;
   const currentFiles = ["example", "templates/components"]
     .flatMap((instance) => readdirSync(join(instance, "sections"), { withFileTypes: true })
       .filter((entry) => entry.isFile() && sourceName.test(entry.name))
       .map((entry) => join(instance, "sections", entry.name).split("\\").join("/")))
     .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
   assert.deepEqual(currentFiles, GOLDEN_FILES, "current source corpus path set");
   const current = measure(currentFiles.map((file) => ({ label: file, path: file })));
   assert.equal(current.candidates, 91);
   assert.equal(current.passes, 79);
   assert.deepEqual(failureIdentities(current.failures), EXPECTED_FAILURES);
   console.log("PASS  current round-trip corpus: exact eight paths, 79 of 91, 12 exact demotions");
   NODE
   p2d_golden_remove
   P2D_GOLDEN_ROOT=
   trap - EXIT HUP INT TERM
   echo 'PASS  P2-D golden fixture bounded cleanup'
   P2D_GOLDEN_GATE
   ```

   Expected: exit `0`; the four lines are exactly `PASS  P2-D golden fixture HUP/INT/TERM cleanup`, `PASS  frozen round-trip golden: 79 of 91; 12 exact demotions`, `PASS  current round-trip corpus: exact eight paths, 79 of 91, 12 exact demotions`, and `PASS  P2-D golden fixture bounded cleanup`; all other ownership probes are silent on success. Early, active-command, supervisor-terminal, and outer-finalizer-terminal probes require exact HUP/INT/TERM statuses 129/130/143; each outer-finalizer case acknowledges the first latch before a distinct later signal and proves the first status still wins, while natural target HUP/INT/TERM/KILL require 129/130/143/137. Before its detached anchor exists, the supervisor writes mode-`0600` preparing evidence; the anchor cannot launch `git` until its PID/PGID publication completes and the private inherited handshake arrives. The live direct-child anchor owns every `git rev-parse`/`git show` descendant until bounded group-wide TERM-to-KILL, leader reaping, and group-disappearance proof complete. The supervisor then removes its preparing/active/anchor records; injected publication plus locator-write failure retains actionable mode-`0600` records and the silent probe proves group absence and zero residue after explicit remediation. After a finite TERM grace the outer fallback may KILL only its still-unreaped direct supervisor; the handshake prevents an unpublished target escape, and every forced path retains evidence. It signals only a currently proven anchor-led group, never signals that PGID after its leader exits, and retains the root if leader reaping or bounded deletion is unproved. The suite is bounded by 120 seconds and its outer owner by 130; independently, each local immutable-object command is bounded to 10 seconds and 16 MiB with `SIGKILL` enforcement. It never fetches or substitutes another ref/source, so absent, slow, or oversized commit `2168188f115e4e3453cb75818f8458090f09aaa5` fails closed. JavaScript `finally` remains an ordinary-export defense. Any golden commit, file, count, ordered failure identity, or cleanup mismatch exits nonzero. Current discovery includes only direct regular non-symlink entries matching the source basename grammar, must equal the exact eight-path list, and must reproduce the same count and ordered path/hash failures. Source drift is a failing contract amendment, never an observation that can pass silently.

4. Build each real instance twice under one fixed environment and compare both kinds of generated bytes. The guarded cleanup runs explicitly on success and from an exit trap on failure or interruption:

   ```bash
   bash <<'P2D_REBUILD_GATE'
   set -euo pipefail
   unset COMMIT_REF
   P2D_REBUILD_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
   P2D_REBUILD_ROOT=
   P2D_REBUILD_ACTIVE_PID=
   P2D_REBUILD_SIGNAL_STATUS=0
   P2D_REBUILD_SIGNAL_COUNT=0
   P2D_REBUILD_CLEANING=0

   p2d_rebuild_manual() {
     local reason="$1" pid="${2:-}" pgid="${3:-}" root="${P2D_REBUILD_ROOT:-}" locator=no-safe-locator
     if [[ -n "$root" && "${root%/*}" == "$P2D_REBUILD_PARENT" && -d "$root" && ! -L "$root" ]]; then
       case "${root##*/}" in
         p2d-rebuild.??????|p2d-rebuild-probe.??????)
           locator="$root/manual-remediation.txt"
           (umask 077; set -o noclobber; printf 'reason=%s\npid=%s\npgid=%s\n' "$reason" "${pid:-unknown}" "${pgid:-unknown}" >"$locator") 2>/dev/null || true
           ;;
       esac
     fi
     printf 'ERROR  P2-D rebuild fixture requires manual remediation: %s (pid %s, pgid %s)\n' \
       "$locator" "${pid:-unknown}" "${pgid:-unknown}" >&2
   }
   p2d_rebuild_stop() {
     local pid="${P2D_REBUILD_ACTIVE_PID:-}" group= attempts=0 pgid= command= forced=0
     case "$pid" in ''|*[!0-9]*|0|1) pid= ;; esac
     if [[ -n "$pid" ]]; then
       kill -TERM "$pid" 2>/dev/null || true
       while kill -0 "$pid" 2>/dev/null && (( attempts < 240 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; forced=1; fi
       attempts=0
       while kill -0 "$pid" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$pid" 2>/dev/null; then p2d_rebuild_manual supervisor-unreaped "$pid"; return 1; fi
       wait "$pid" 2>/dev/null || true
     fi
     P2D_REBUILD_ACTIVE_PID=
     if [[ -n "${P2D_REBUILD_ROOT:-}" && -f "$P2D_REBUILD_ROOT/active-group.pid" ]]; then
       IFS= read -r group <"$P2D_REBUILD_ROOT/active-group.pid" || true
       case "$group" in ''|*[!0-9]*|0|1) p2d_rebuild_manual invalid-group "$pid" "$group"; return 1 ;; esac
       pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
       command="$(ps -o command= -p "$group" 2>/dev/null || true)"
       if [[ "$pgid" != "$group" || "$command" != *"$P2D_REBUILD_SUPERVISOR --group-anchor"* ]]; then
         p2d_rebuild_manual anchor-ownership-unproved "$group" "$group"
         return 1
       fi
       kill -TERM -- "-$group" 2>/dev/null || true
       attempts=0
       while kill -0 "$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 "$group" 2>/dev/null; then
         pgid="$(ps -o pgid= -p "$group" 2>/dev/null | tr -d '[:space:]')"
         command="$(ps -o command= -p "$group" 2>/dev/null || true)"
         if [[ "$pgid" != "$group" || "$command" != *"$P2D_REBUILD_SUPERVISOR --group-anchor"* ]]; then
           p2d_rebuild_manual anchor-ownership-lost "$group" "$group"
           return 1
         fi
         kill -KILL -- "-$group" 2>/dev/null || true
       fi
       attempts=0
       while kill -0 -- "-$group" 2>/dev/null && (( attempts < 40 )); do sleep 0.05; attempts=$((attempts + 1)); done
       if kill -0 -- "-$group" 2>/dev/null; then p2d_rebuild_manual group-unreaped "$group" "$group"; return 1; fi
       p2d_rebuild_manual fallback-leader-reap-unproved "$group" "$group"
       return 1
     fi
     if [[ -n "${P2D_REBUILD_ROOT:-}" ]] && { [[ -f "$P2D_REBUILD_ROOT/supervisor-anchor.json" ]] || [[ -f "$P2D_REBUILD_ROOT/supervisor-preparing.json" ]]; }; then
       p2d_rebuild_manual incomplete-anchor-publication "$pid"
       return 1
     fi
     if (( forced != 0 )); then p2d_rebuild_manual supervisor-forced "$pid"; return 1; fi
   }
   p2d_rebuild_remove() {
     local root="${P2D_REBUILD_ROOT:-}" worker attempts=0
     [[ -n "$root" ]] || return 0
     if [[ "${root%/*}" != "$P2D_REBUILD_PARENT" ]]; then p2d_rebuild_manual unsafe-cleanup; return 1; fi
     case "${root##*/}" in p2d-rebuild.??????|p2d-rebuild-probe.??????) ;; *) p2d_rebuild_manual unsafe-cleanup; return 1 ;; esac
     [[ ! -e "$root" ]] && return 0
     if [[ ! -d "$root" || -L "$root" ]]; then p2d_rebuild_manual unsafe-cleanup; return 1; fi
     if [[ -f "$root/manual-remediation.txt" || -f "$root/supervisor-anchor.json" || -f "$root/supervisor-preparing.json" ]]; then
       printf 'ERROR  retained P2-D rebuild fixture for manual remediation: %s\n' "$root/manual-remediation.txt" >&2
       return 1
     fi
     node -e 'require("node:fs").rmSync(process.argv[1], {recursive:true, force:true, maxRetries:2, retryDelay:25})' "$root" &
     worker=$!
     while kill -0 "$worker" 2>/dev/null && (( attempts < 200 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$worker" 2>/dev/null; then kill -KILL "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; p2d_rebuild_manual cleanup-timeout "$worker"; return 1; fi
     wait "$worker" 2>/dev/null || true
     if [[ -e "$root" ]]; then p2d_rebuild_manual cleanup-failed "$worker"; return 1; fi
   }
   p2d_rebuild_cleanup() {
     local status=$? cleanup_status=0 latch=
     trap - EXIT
     P2D_REBUILD_CLEANING=1
     if ! p2d_rebuild_stop; then
       cleanup_status=1
     else
       if [[ -n "${P2D_REBUILD_CLEANUP_READY:-}" ]]; then
         case "$P2D_REBUILD_CLEANUP_READY" in "$P2D_REBUILD_ROOT"/.outer-finish-HUP.ready|"$P2D_REBUILD_ROOT"/.outer-finish-INT.ready|"$P2D_REBUILD_ROOT"/.outer-finish-TERM.ready) ;; *) p2d_rebuild_manual invalid-cleanup-rendezvous; cleanup_status=1 ;; esac
         if (( cleanup_status == 0 )); then
           (umask 077; printf 'ready\n' >"$P2D_REBUILD_CLEANUP_READY")
           local rendezvous_attempts=0
           while (( P2D_REBUILD_SIGNAL_COUNT == 0 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
           if (( P2D_REBUILD_SIGNAL_COUNT == 0 )); then
             p2d_rebuild_manual cleanup-first-signal-timeout; cleanup_status=1
           else
             latch="${P2D_REBUILD_CLEANUP_READY%.ready}.latched"
             (umask 077; printf '%s\n' "$P2D_REBUILD_SIGNAL_STATUS" >"$latch")
             rendezvous_attempts=0
             while (( P2D_REBUILD_SIGNAL_COUNT < 2 && rendezvous_attempts < 400 )); do sleep 0.01; rendezvous_attempts=$((rendezvous_attempts + 1)); done
             if (( P2D_REBUILD_SIGNAL_COUNT < 2 )); then p2d_rebuild_manual cleanup-second-signal-timeout; cleanup_status=1; fi
           fi
         fi
       fi
       if (( cleanup_status == 0 )); then p2d_rebuild_remove || cleanup_status=1; fi
     fi
     if (( P2D_REBUILD_SIGNAL_STATUS != 0 )); then status=$P2D_REBUILD_SIGNAL_STATUS
     elif (( status == 0 && cleanup_status != 0 )); then status=1
     fi
     if (( P2D_REBUILD_SIGNAL_STATUS != 0 )); then status=$P2D_REBUILD_SIGNAL_STATUS; fi
     exit "$status"
   }
   p2d_rebuild_signal() {
     P2D_REBUILD_SIGNAL_COUNT=$((P2D_REBUILD_SIGNAL_COUNT + 1))
     if (( P2D_REBUILD_SIGNAL_STATUS == 0 )); then P2D_REBUILD_SIGNAL_STATUS="$1"; fi
     if (( P2D_REBUILD_CLEANING == 0 )); then exit "$P2D_REBUILD_SIGNAL_STATUS"; fi
   }
   p2d_rebuild_run() {
     node "$P2D_REBUILD_SUPERVISOR" "$@" & P2D_REBUILD_ACTIVE_PID=$!
     local attempts=0 status
     while kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 2600 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null; then echo 'ERROR  P2-D rebuild supervisor exceeded 130 seconds' >&2; p2d_rebuild_stop || return 1; return 124; fi
     set +e; wait "$P2D_REBUILD_ACTIVE_PID"; status=$?; set -e
     P2D_REBUILD_ACTIVE_PID=; return "$status"
   }
   trap p2d_rebuild_cleanup EXIT
   trap 'p2d_rebuild_signal 129' HUP
   trap 'p2d_rebuild_signal 130' INT
   trap 'p2d_rebuild_signal 143' TERM
   p2d_rebuild_early_probe() {
     local signal="$1" expected="$2" status
     if (
       P2D_REBUILD_ROOT=
       P2D_REBUILD_ACTIVE_PID=
       P2D_REBUILD_SIGNAL_STATUS=0
       P2D_REBUILD_CLEANING=0
       trap p2d_rebuild_cleanup EXIT
       trap 'p2d_rebuild_signal 129' HUP
       trap 'p2d_rebuild_signal 130' INT
       trap 'p2d_rebuild_signal 143' TERM
       kill -s "$signal" "$BASHPID"
       exit 99
     ); then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" ]] || { echo "ERROR  P2-D rebuild early $signal status failed" >&2; return 1; }
   }
   p2d_rebuild_early_probe HUP 129
   p2d_rebuild_early_probe INT 130
   p2d_rebuild_early_probe TERM 143
   P2D_REBUILD_ROOT="$(mktemp -d "$P2D_REBUILD_PARENT/p2d-rebuild.XXXXXX")"
   export P2D_REBUILD_PARENT P2D_REBUILD_ROOT
   P2D_REBUILD_SUPERVISOR="$P2D_REBUILD_ROOT/supervise.mjs"
   export P2D_REBUILD_SUPERVISOR
   (umask 077; : >"$P2D_REBUILD_SUPERVISOR")
   sed 's/^   //' >"$P2D_REBUILD_SUPERVISOR" <<'P2D_REBUILD_SUPERVISOR_JS'
   import { spawn } from "node:child_process";
   import { basename, dirname, join } from "node:path";
   import { createReadStream, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
   import { constants } from "node:os";

   const root = process.env.P2D_REBUILD_ROOT ?? "";
   const parent = process.env.P2D_REBUILD_PARENT ?? "";
   const name = basename(root);
   if (dirname(root) !== parent || !/^p2d-rebuild(?:-probe)?\.[A-Za-z0-9]{6}$/.test(name)) {
     console.error("ERROR  P2-D rebuild supervisor refused an unexpected root");
     process.exit(1);
   }
   const pidPath = join(root, "active-group.pid");
   const preparingPath = join(root, "supervisor-preparing.json");
   const anchorPath = join(root, "supervisor-anchor.json");
   const outcomePath = join(root, "target-outcome.json");
   const locator = join(root, "manual-remediation.txt");
   const statuses = new Map([["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]);
   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

   if (process.argv[2] === "--group-anchor") {
     const target = process.argv.slice(5);
     const targetOutcome = process.argv[3] ?? "";
     const expectedSupervisor = Number(process.argv[4]);
     if (target.length === 0 || targetOutcome !== outcomePath || !Number.isInteger(expectedSupervisor)) process.exit(2);
     for (const signal of statuses.keys()) process.on(signal, () => {});
     let gate = "";
     const gateStream = createReadStream(null, { fd: 3, autoClose: true, encoding: "utf8" });
     gateStream.on("data", (chunk) => { gate += chunk; });
     gateStream.once("error", () => process.exit(1));
     gateStream.once("end", () => {
       if (gate !== "go\n") process.exit(1);
       const targetChild = spawn(target[0], target.slice(1), { stdio: "inherit" });
       const publishOutcome = (status, reason) => {
         const temporary = `${targetOutcome}.${process.pid}.tmp`;
         try {
           writeFileSync(temporary, `${JSON.stringify({ status, reason })}\n`, { flag: "wx", mode: 0o600 });
           renameSync(temporary, targetOutcome);
         } catch {
           if (process.ppid === expectedSupervisor) {
             try { process.kill(expectedSupervisor, "SIGUSR1"); } catch {}
           }
         }
       };
       targetChild.once("error", () => publishOutcome(1, "target-spawn-error"));
       targetChild.once("exit", (code, signal) => {
         const number = signal ? constants.signals[signal] : undefined;
         publishOutcome(signal && number ? 128 + number : (code ?? 1), "target-exit");
       });
     });
     setInterval(() => {}, 1_000);
   } else {
   const argv = process.argv.slice(2);
   if (argv.length === 0) process.exit(2);
   const finishReady = process.env.P2D_REBUILD_FINISH_READY ?? "";
   if (finishReady && (dirname(finishReady) !== root || !/^\.finish-(?:HUP|INT|TERM)\.ready$/.test(basename(finishReady)))) {
     console.error("ERROR  P2-D rebuild supervisor refused an unexpected finish rendezvous");
     process.exit(1);
   }
   let anchor;
   let finishing = false;
   let latchedSignalStatus = 0;
   let timer;
   let outcomePoll;
   let retainEvidence = false;
   let targetReleased = false;

   function groupAlive() {
     if (!anchor?.pid) return false;
     try { process.kill(-anchor.pid, 0); return true; }
     catch (error) { if (error?.code === "ESRCH") return false; if (error?.code === "EPERM") return true; throw error; }
   }
   function anchorOwned() {
     return Boolean(anchor?.pid && anchor.exitCode === null && anchor.signalCode === null);
   }
   function signalGroup(signal) {
     if (!anchorOwned()) throw new Error("anchor ownership lost before signal");
     try { process.kill(-anchor.pid, signal); }
     catch (error) { if (error?.code !== "ESRCH" && error?.code !== "EPERM") throw error; }
   }
   function evidence(reason) {
     const record = `${JSON.stringify({ reason, supervisorPid: process.pid, leaderPid: anchor?.pid ?? null, processGroup: anchor?.pid ?? null })}\n`;
     if (process.env.P2D_REBUILD_INJECT_EVIDENCE_FAILURE !== "1") {
       try { writeFileSync(locator, record, { flag: "wx", mode: 0o600 }); } catch {}
     }
     console.error(`ERROR  P2-D rebuild supervisor requires manual remediation: ${locator} (process group ${anchor?.pid ?? "unknown"})`);
   }
   async function stopGroup() {
     if (!targetReleased) {
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) anchor.kill("SIGKILL");
       for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
       if (anchorOwned()) return false;
       for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
       return !groupAlive();
     }
     if (anchorOwned()) signalGroup("SIGTERM");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) signalGroup("SIGKILL");
     for (let attempt = 0; attempt < 40 && anchorOwned(); attempt += 1) await pause(50);
     if (anchorOwned()) return false;
     for (let attempt = 0; attempt < 40 && groupAlive(); attempt += 1) await pause(50);
     return !groupAlive();
   }
   async function finish(status, reason) {
     if (finishing) return;
     finishing = true;
     clearTimeout(timer);
     clearInterval(outcomePoll);
     if (finishReady) {
       try { writeFileSync(finishReady, `${status} ${reason}\n`, { flag: "wx", mode: 0o600 }); } catch {}
     }
     let stopped = false;
     try { stopped = await stopGroup(); } catch { stopped = false; }
     if (!stopped || retainEvidence) { evidence(reason); process.exit(latchedSignalStatus || 1); }
     rmSync(pidPath, { force: true });
     rmSync(outcomePath, { force: true });
     rmSync(anchorPath, { force: true });
     rmSync(preparingPath, { force: true });
     process.exit(latchedSignalStatus || status);
   }
   for (const [signal, status] of statuses) process.on(signal, () => {
     if (latchedSignalStatus === 0) latchedSignalStatus = status;
     void finish(status, signal);
   });
   process.on("SIGUSR1", () => { retainEvidence = true; void finish(1, "anchor-outcome-publication-failure"); });
   try {
     writeFileSync(preparingPath, `${JSON.stringify({ state: "preparing", supervisorPid: process.pid })}\n`, { flag: "wx", mode: 0o600 });
   } catch {
     evidence("preparing-publication-failure");
     process.exit(1);
   }
   anchor = spawn(process.execPath, [process.argv[1], "--group-anchor", outcomePath, String(process.pid), ...argv], {
     detached: true, stdio: ["inherit", "inherit", "inherit", "pipe"],
   });
   anchor.once("error", () => { retainEvidence = true; void finish(1, "anchor-spawn-error"); });
   anchor.once("exit", () => {
     if (!finishing) { retainEvidence = true; void finish(1, "anchor-exit-before-outcome"); }
   });
   try {
     if (!anchor.pid) throw new Error("missing anchor pid");
     writeFileSync(anchorPath, `${JSON.stringify({ state: "published", supervisorPid: process.pid, leaderPid: anchor.pid, processGroup: anchor.pid })}\n`, { flag: "wx", mode: 0o600 });
     if (process.env.P2D_REBUILD_INJECT_PUBLICATION_FAILURE === "1") throw new Error("injected publication failure");
     writeFileSync(pidPath, `${anchor.pid}\n`, { flag: "wx", mode: 0o600 });
     anchor.stdio[3].end("go\n");
     targetReleased = true;
   } catch {
     retainEvidence = true;
     anchor.stdio?.[3]?.end();
     void finish(1, "publication-failure");
   }
   outcomePoll = setInterval(() => {
     try {
       const outcome = JSON.parse(readFileSync(outcomePath, "utf8"));
       if (!Number.isInteger(outcome.status) || outcome.status < 0 || outcome.status > 255) throw new Error("invalid outcome");
       void finish(outcome.status, outcome.reason ?? "target-exit");
     } catch (error) {
       if (error?.code !== "ENOENT" && !finishing) { retainEvidence = true; void finish(1, "invalid-target-outcome"); }
     }
   }, 20);
   timer = setTimeout(() => { void finish(124, "120-second-timeout"); }, 120_000);
   }
   P2D_REBUILD_SUPERVISOR_JS

   p2d_rebuild_outer_terminal_probe() {
     local signal="$1" expected="$2" later="$3" ready probe_root latch first_latched= status attempts=0
     ready="$P2D_REBUILD_ROOT/.outer-finish-$signal.ready"
     (
       P2D_REBUILD_ROOT=
       P2D_REBUILD_ACTIVE_PID=
       P2D_REBUILD_SIGNAL_STATUS=0
       P2D_REBUILD_SIGNAL_COUNT=0
       P2D_REBUILD_CLEANING=0
       trap p2d_rebuild_cleanup EXIT
       trap 'p2d_rebuild_signal 129' HUP
       trap 'p2d_rebuild_signal 130' INT
       trap 'p2d_rebuild_signal 143' TERM
       P2D_REBUILD_ROOT="$(mktemp -d "$P2D_REBUILD_PARENT/p2d-rebuild-probe.XXXXXX")"
       export P2D_REBUILD_ROOT
       P2D_REBUILD_CLEANUP_READY="$P2D_REBUILD_ROOT/.outer-finish-$signal.ready"
       printf '%s\n' "$P2D_REBUILD_ROOT" >"$ready.root"
       exit 0
     ) &
     P2D_REBUILD_ACTIVE_PID=$!
     while [[ ! -s "$ready.root" ]] && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready.root" ]] || { echo "ERROR  P2-D rebuild terminal $signal root rendezvous failed" >&2; return 1; }
     probe_root="$(<"$ready.root")"
     attempts=0
     while [[ ! -s "$probe_root/.outer-finish-$signal.ready" ]] && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/.outer-finish-$signal.ready" ]] || { echo "ERROR  P2-D rebuild terminal $signal cleanup rendezvous failed" >&2; return 1; }
     kill -s "$signal" "$P2D_REBUILD_ACTIVE_PID"
     latch="$probe_root/.outer-finish-$signal.latched"
     attempts=0
     while [[ ! -s "$latch" ]] && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$latch" ]] && first_latched="$(<"$latch")"
     kill -s "$later" "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null || true
     if wait "$P2D_REBUILD_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_REBUILD_ACTIVE_PID=
     [[ "$first_latched" == "$expected" && "$status" -eq "$expected" && ! -e "$probe_root" ]] || { echo "ERROR  P2-D rebuild terminal $signal then $later first-signal/cleanup failed" >&2; return 1; }
     rm -f -- "$ready.root"
   }
   p2d_rebuild_outer_terminal_probe HUP 129 TERM
   p2d_rebuild_outer_terminal_probe INT 130 HUP
   p2d_rebuild_outer_terminal_probe TERM 143 INT

   p2d_rebuild_probe() {
     local signal="$1" expected="$2" owner_root="$P2D_REBUILD_ROOT" supervisor="$P2D_REBUILD_SUPERVISOR"
     local ready="$owner_root/.probe-$signal" probe_root group status attempts=0
     (
       P2D_REBUILD_ROOT=
       P2D_REBUILD_ACTIVE_PID=
       P2D_REBUILD_SIGNAL_STATUS=0
       P2D_REBUILD_CLEANING=0
       trap p2d_rebuild_cleanup EXIT
       trap 'p2d_rebuild_signal 129' HUP
       trap 'p2d_rebuild_signal 130' INT
       trap 'p2d_rebuild_signal 143' TERM
       P2D_REBUILD_ROOT="$(mktemp -d "$P2D_REBUILD_PARENT/p2d-rebuild-probe.XXXXXX")"
       export P2D_REBUILD_ROOT
       printf '%s\n' "$P2D_REBUILD_ROOT" >"$ready"
       node "$supervisor" node -e 'const fs=require("node:fs");process.on("SIGHUP",()=>{});process.on("SIGINT",()=>{});process.on("SIGTERM",()=>{});fs.writeFileSync(process.argv[1],"ready\n");setInterval(()=>{},1000)' "$P2D_REBUILD_ROOT/child-ready" &
       P2D_REBUILD_ACTIVE_PID=$!
       wait "$P2D_REBUILD_ACTIVE_PID"
     ) &
     P2D_REBUILD_ACTIVE_PID=$!
     while [[ ! -s "$ready" ]] && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 200 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$ready" ]] || { p2d_rebuild_stop || true; echo "ERROR  P2-D rebuild $signal probe did not become ready" >&2; return 1; }
     probe_root="$(<"$ready")"
     attempts=0
     while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$probe_root/child-ready" ]]; } && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/active-group.pid" && -s "$probe_root/child-ready" ]] || { p2d_rebuild_stop || true; echo "ERROR  P2-D rebuild $signal process group did not become ready" >&2; return 1; }
     group="$(<"$probe_root/active-group.pid")"
     case "$group" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D rebuild $signal process group invalid" >&2; return 1 ;; esac
     kill -s "$signal" "$P2D_REBUILD_ACTIVE_PID"
     attempts=0
     while kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 600 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null; then p2d_rebuild_stop || true; echo "ERROR  P2-D rebuild $signal cleanup probe exceeded 30 seconds" >&2; return 1; fi
     set +e; wait "$P2D_REBUILD_ACTIVE_PID"; status=$?; set -e
     P2D_REBUILD_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$probe_root" ]] && ! kill -0 -- "-$group" 2>/dev/null \
       || { echo "ERROR  P2-D rebuild $signal cleanup probe failed" >&2; return 1; }
     rm -f -- "$ready"
   }
   p2d_rebuild_probe HUP 129
   p2d_rebuild_probe INT 130
   p2d_rebuild_probe TERM 143
   echo 'PASS  P2-D rebuild fixture HUP/INT/TERM process-group cleanup'

   p2d_rebuild_latch_probe() {
     local signal="$1" expected="$2" group status attempts=0
     local finish_ready="$P2D_REBUILD_ROOT/.finish-$signal.ready"
     local child_ready="$P2D_REBUILD_ROOT/.child-$signal.ready"
     P2D_REBUILD_FINISH_READY="$finish_ready" node "$P2D_REBUILD_SUPERVISOR" \
       sh -c '(trap "" HUP INT TERM; printf "ready\n" >"$1"; while :; do sleep 1; done) & while [ ! -s "$1" ]; do sleep 0.01; done' \
       sh "$child_ready" &
     P2D_REBUILD_ACTIVE_PID=$!
     while { [[ ! -s "$finish_ready" ]] || [[ ! -s "$child_ready" ]] || [[ ! -s "$P2D_REBUILD_ROOT/active-group.pid" ]]; } \
       && kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$finish_ready" && -s "$child_ready" && -s "$P2D_REBUILD_ROOT/active-group.pid" ]] || { p2d_rebuild_stop || true; echo "ERROR  P2-D rebuild $signal latch probe did not enter cleanup" >&2; return 1; }
     group="$(<"$P2D_REBUILD_ROOT/active-group.pid")"
     case "$group" in ''|*[!0-9]*|0|1) echo "ERROR  P2-D rebuild $signal latch process group invalid" >&2; return 1 ;; esac
     kill -s "$signal" "$P2D_REBUILD_ACTIVE_PID"
     attempts=0
     while kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null && (( attempts < 600 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$P2D_REBUILD_ACTIVE_PID" 2>/dev/null; then p2d_rebuild_stop || true; echo "ERROR  P2-D rebuild $signal latch probe exceeded 30 seconds" >&2; return 1; fi
     if wait "$P2D_REBUILD_ACTIVE_PID"; then status=0; else status=$?; fi
     P2D_REBUILD_ACTIVE_PID=
     [[ "$status" -eq "$expected" && ! -e "$P2D_REBUILD_ROOT/active-group.pid" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null \
       || { echo "ERROR  P2-D rebuild $signal terminal-status latch failed" >&2; return 1; }
     rm -f -- "$finish_ready" "$child_ready"
   }
   p2d_rebuild_latch_probe HUP 129
   p2d_rebuild_latch_probe INT 130
   p2d_rebuild_latch_probe TERM 143
   echo 'PASS  P2-D rebuild first-signal terminal-status latch: HUP=129 INT=130 TERM=143'

   p2d_rebuild_natural_probe() {
     local signal="$1" expected="$2" status
     if p2d_rebuild_run node -e 'process.kill(process.pid, process.argv[1])' "SIG$signal"; then status=0; else status=$?; fi
     [[ "$status" -eq "$expected" && ! -e "$P2D_REBUILD_ROOT/active-group.pid" ]] || { echo "ERROR  P2-D rebuild natural SIG$signal status failed" >&2; return 1; }
   }
   p2d_rebuild_natural_probe HUP 129
   p2d_rebuild_natural_probe INT 130
   p2d_rebuild_natural_probe TERM 143
   p2d_rebuild_natural_probe KILL 137
   echo 'PASS  P2-D rebuild natural child signals: HUP=129 INT=130 TERM=143 KILL=137'

   p2d_rebuild_publication_probe() {
     local owner_root="$P2D_REBUILD_ROOT" probe_root status supervisor_pid attempts=0 group
     probe_root="$(mktemp -d "$P2D_REBUILD_PARENT/p2d-rebuild-probe.XXXXXX")"
     P2D_REBUILD_ROOT="$probe_root" P2D_REBUILD_INJECT_PUBLICATION_FAILURE=1 P2D_REBUILD_INJECT_EVIDENCE_FAILURE=1 \
       node "$P2D_REBUILD_SUPERVISOR" true >/dev/null 2>&1 &
     supervisor_pid=$!
     while kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.05; attempts=$((attempts + 1)); done
     if kill -0 "$supervisor_pid" 2>/dev/null; then echo 'ERROR  P2-D rebuild publication-failure probe exceeded 20 seconds' >&2; return 1; fi
     if wait "$supervisor_pid"; then status=0; else status=$?; fi
     [[ "$status" -eq 1 && -s "$probe_root/supervisor-preparing.json" && -s "$probe_root/supervisor-anchor.json" && ! -e "$probe_root/manual-remediation.txt" ]] \
       || { echo 'ERROR  P2-D rebuild publication/evidence failure was not retained' >&2; return 1; }
     group="$(node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="published"||a.leaderPid!==a.processGroup) process.exit(1);process.stdout.write(String(a.processGroup))' "$probe_root/supervisor-anchor.json")"
     case "$group" in ''|*[!0-9]*|0|1) echo 'ERROR  P2-D rebuild retained anchor evidence invalid' >&2; return 1 ;; esac
     ! kill -0 -- "-$group" 2>/dev/null || { echo 'ERROR  P2-D rebuild publication-failure group survived' >&2; return 1; }
     node -e 'const fs=require("node:fs");const p=process.argv[1];const a=JSON.parse(fs.readFileSync(p,"utf8"));if ((fs.statSync(p).mode&0o777)!==0o600||a.state!=="preparing"||!Number.isInteger(a.supervisorPid)) process.exit(1)' "$probe_root/supervisor-preparing.json"
     rm -f -- "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" "$probe_root/active-group.pid"
     P2D_REBUILD_ROOT="$probe_root"
     if ! p2d_rebuild_remove; then P2D_REBUILD_ROOT="$owner_root"; return 1; fi
     P2D_REBUILD_ROOT="$owner_root"
     [[ ! -e "$probe_root" ]] || { echo 'ERROR  P2-D rebuild publication probe residue' >&2; return 1; }
   }
   p2d_rebuild_publication_probe

   p2d_rebuild_parent_exit_probe() {
     local owner_root="$P2D_REBUILD_ROOT" probe_root supervisor_pid group status attempts=0
     probe_root="$(mktemp -d "$P2D_REBUILD_PARENT/p2d-rebuild-probe.XXXXXX")"
     P2D_REBUILD_ROOT="$probe_root" node "$P2D_REBUILD_SUPERVISOR" \
       node -e 'const fs=require("node:fs");process.on("SIGHUP",()=>{});process.on("SIGINT",()=>{});process.on("SIGTERM",()=>{});fs.writeFileSync(process.argv[1],"ready\n");setInterval(()=>{},1000)' \
       "$probe_root/child-ready" >/dev/null 2>&1 &
     supervisor_pid=$!
     while { [[ ! -s "$probe_root/active-group.pid" ]] || [[ ! -s "$probe_root/child-ready" ]]; } \
       && kill -0 "$supervisor_pid" 2>/dev/null && (( attempts < 400 )); do sleep 0.01; attempts=$((attempts + 1)); done
     [[ -s "$probe_root/active-group.pid" && -s "$probe_root/child-ready" ]] || { echo 'ERROR  P2-D rebuild parent-exit probe did not become ready' >&2; return 1; }
     group="$(<"$probe_root/active-group.pid")"
     kill -KILL "$supervisor_pid"
     if wait "$supervisor_pid" 2>/dev/null; then status=0; else status=$?; fi
     [[ "$status" -eq 137 ]] || { echo 'ERROR  P2-D rebuild parent-exit supervisor status failed' >&2; return 1; }
     P2D_REBUILD_ROOT="$probe_root"
     P2D_REBUILD_ACTIVE_PID=
     if p2d_rebuild_stop 2>/dev/null; then echo 'ERROR  P2-D rebuild fallback falsely proved leader reaping' >&2; return 1; fi
     [[ -s "$probe_root/manual-remediation.txt" && -s "$probe_root/supervisor-anchor.json" && -s "$probe_root/supervisor-preparing.json" ]] \
       && ! kill -0 -- "-$group" 2>/dev/null \
       || { echo 'ERROR  P2-D rebuild parent-exit evidence/group cleanup failed' >&2; return 1; }
     node -e 'const fs=require("node:fs");for(const p of process.argv.slice(1)){if((fs.statSync(p).mode&0o777)!==0o600)process.exit(1)}' \
       "$probe_root/manual-remediation.txt" "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json"
     rm -f -- "$probe_root/manual-remediation.txt" "$probe_root/supervisor-anchor.json" "$probe_root/supervisor-preparing.json" \
       "$probe_root/active-group.pid" "$probe_root/target-outcome.json"
     if ! p2d_rebuild_remove; then P2D_REBUILD_ROOT="$owner_root"; return 1; fi
     P2D_REBUILD_ROOT="$owner_root"
     [[ ! -e "$probe_root" ]] || { echo 'ERROR  P2-D rebuild parent-exit probe residue' >&2; return 1; }
   }
   p2d_rebuild_parent_exit_probe

   p2d_rebuild_run templates/build example
   p2d_rebuild_run templates/build templates/components
   p2d_rebuild_run cp example/dist/example.edit.json "$P2D_REBUILD_ROOT/example.edit.json"
   p2d_rebuild_run cp templates/components/dist/components.edit.json "$P2D_REBUILD_ROOT/components.edit.json"
   p2d_rebuild_run cp example/dist/example.html "$P2D_REBUILD_ROOT/example.html"
   p2d_rebuild_run cp templates/components/dist/components.html "$P2D_REBUILD_ROOT/components.html"

   p2d_rebuild_run templates/build example
   p2d_rebuild_run templates/build templates/components
   p2d_rebuild_run cmp "$P2D_REBUILD_ROOT/example.edit.json" example/dist/example.edit.json
   p2d_rebuild_run cmp "$P2D_REBUILD_ROOT/components.edit.json" templates/components/dist/components.edit.json
   p2d_rebuild_run cmp "$P2D_REBUILD_ROOT/example.html" example/dist/example.html
   p2d_rebuild_run cmp "$P2D_REBUILD_ROOT/components.html" templates/components/dist/components.html
   P2D_REBUILD_REMOVED="$P2D_REBUILD_ROOT"
   p2d_rebuild_remove
   P2D_REBUILD_ROOT=
   trap - EXIT HUP INT TERM
   test ! -e "$P2D_REBUILD_REMOVED"
   unset P2D_REBUILD_REMOVED P2D_REBUILD_ROOT
   echo 'PASS  P2-D repeat-build fixture cleaned'
   P2D_REBUILD_GATE
   ```

   Expected: all four `cmp` commands exit `0`; before the builds the gate prints, in order, `PASS  P2-D rebuild fixture HUP/INT/TERM process-group cleanup`, `PASS  P2-D rebuild first-signal terminal-status latch: HUP=129 INT=130 TERM=143`, and `PASS  P2-D rebuild natural child signals: HUP=129 INT=130 TERM=143 KILL=137`; it ends with exactly `PASS  P2-D repeat-build fixture cleaned`. All early/outer-terminal/publication/parent-exit ownership probes are silent on success. The shell installs first-signal HUP/INT/TERM and EXIT ownership before root creation; the latch remains live throughout stop, group proof, bounded deletion, and final exit. Early, active-command, supervisor-terminal, and outer-finalizer-terminal probes require 129/130/143; every outer-finalizer case observes the first latch, sends a distinct later signal during cleanup, and still requires the first status, while natural target signals require conventional 129/130/143/137. Before spawning the detached group anchor, the supervisor writes a mode-`0600` preparing record. The anchor waits on a private inherited handshake and cannot launch any build/copy/compare command until its exact PID/PGID record is published. It then stays the live, direct-child process-group leader while the target and all descendants run. Every command has a 120-second deadline; completion, timeout, and interruption use finite group-wide TERM-to-KILL, reap the leader, prove group disappearance, and only then remove preparing/active/anchor records. The supervisor reads the first-signal latch again at final exit. Injected publication plus locator-write failure retains actionable mode-`0600` evidence and proves the unstarted group is gone. The parent-exit probe kills a fully published supervisor, makes the outer fallback verify the current anchor before each group signal, proves all descendants disappear, and requires the guarded root/evidence to remain because that shell cannot reap the orphaned anchor; it never deletes the evidence merely because KILL made the numeric group disappear. After its finite TERM grace the owner may KILL only the still-unreaped direct supervisor; the handshake prevents an unpublished target escape, and forced cleanup retains remediation. No numeric PGID is signaled after anchor exit. Recursive deletion has its own finite worker deadline and writes/retains mode-`0600` remediation evidence on timeout or failure. The child shell unsets `COMMIT_REF` only for this gate and cannot alter a caller value. Every manifest has `commit: ""`, and neither sidecar contains `built`, `updatedAt`, `owner`, `editors`, `ordinal`, or `eid`.

5. Verify manifest/HTML consistency for every real accepted row. P1-B's rendered contract is one semantic `<section>` element carrying each `Section.id`; attribute order and additional section attributes are not stable API. This test uses a quote-aware balanced tag scanner that skips comments and raw-text elements, so enclosure does not depend on an exact opening-tag spelling or mistake embedded source text for markup. Its small attribute matches do not become production scanning logic:

   ```bash
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { createHash } from "node:crypto";
   import { lstatSync, readFileSync } from "node:fs";
   import { scanBlocks } from "./templates/docbuild/dist/anchor-core.js";
   import { parseSection } from "./templates/docbuild/dist/index.js";

   function attribute(token, name) {
     const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
     const match = new RegExp(
       `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i",
     ).exec(token);
     return match ? (match[1] ?? match[2] ?? match[3]) : null;
   }

   function scanRendered(html) {
     const stack = [];
     const ranges = [];
     const docIds = [];
     const lower = html.toLowerCase();
     const rawText = new Set(["script", "style", "textarea", "title"]);
     let cursor = 0;
     while (cursor < html.length) {
       const offset = html.indexOf("<", cursor);
       if (offset < 0) break;
       if (html.startsWith("<!--", offset)) {
         const commentEnd = html.indexOf("-->", offset + 4);
         assert.ok(commentEnd >= 0, `unclosed comment at ${offset}`);
         cursor = commentEnd + 3;
         continue;
       }

       let quote = "";
       let end = offset + 1;
       for (; end < html.length; end += 1) {
         const char = html[end];
         if (quote) {
           if (char === quote) quote = "";
         } else if (char === '"' || char === "'") {
           quote = char;
         } else if (char === ">") {
           break;
         }
       }
       assert.ok(end < html.length, `unclosed tag at ${offset}`);
       const token = html.slice(offset, end + 1);
       cursor = end + 1;
       const tag = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/.exec(token);
       if (!tag) continue;
       const closing = tag[1] === "/";
       const name = tag[2].toLowerCase();
       if (!closing && name === "meta" && attribute(token, "name") === "doc-id") {
         const docId = attribute(token, "content");
         assert.notEqual(docId, null, `doc-id meta lacks content at ${offset}`);
         docIds.push(docId);
       }
       if (!closing && rawText.has(name)) {
         const close = `</${name}>`;
         const closeAt = lower.indexOf(close, cursor);
         assert.ok(closeAt >= 0, `unclosed ${name} at ${offset}`);
         cursor = closeAt + close.length;
         continue;
       }
       if (name !== "section") continue;
       if (closing) {
         const open = stack.pop();
         assert.ok(open, `unexpected closing section at ${offset}`);
         ranges.push({ id: open.id, start: open.contentStart, end: offset });
         continue;
       }
       assert.ok(!/\/>$/.test(token), `self-closing section at ${offset}`);
       const id = attribute(token, "id");
       stack.push({ id, contentStart: end + 1 });
     }
     assert.equal(stack.length, 0, "unclosed rendered section");
     return { sections: ranges, docIds };
   }

   const expectedDemotion = 'Use <code>.panel</code> &rarr; <code>.flow</code> &rarr; <code>.node</code>. Stack nodes vertically with <code>.col</code>. Label an edge with <code>.arrow .at</code>. Add a legend with <code>.cap</code>.';
   const integrationCases = [
     {
       instance: "example",
       name: "example",
       rowsByFile: {
         "sections/01-problem.html": 5,
         "sections/02-solution.html": 3,
         "sections/03-architecture.html": 12,
         "sections/04-build-order.html": 3,
         "sections/05-open-questions.html": 8,
       },
       editable: {
         inner: "CI spends most of its time rebuilding things that have not changed",
         tag: "h2",
         file: "sections/01-problem.html",
         dataMd: null,
       },
       readOnly: "What it costs",
     },
     {
       instance: "templates/components",
       name: "components",
       rowsByFile: {
         "sections/01-structure.html": 3,
         "sections/02-diagrams.html": 5,
         "sections/03-content.html": 12,
       },
       editable: {
         inner: "Wrap in <code>.tw</code> so wide tables scroll inside their own container rather than the page. Use <code>td.n</code> for numeric columns.",
         tag: "p",
         file: "sections/03-content.html",
         dataMd: "Wrap in `.tw` so wide tables scroll inside their own container rather than the page. Use `td.n` for numeric columns.",
       },
       readOnly: expectedDemotion,
     },
   ];
   for (const { instance, name, rowsByFile, editable, readOnly } of integrationCases) {
     const html = readFileSync(`${instance}/dist/${name}.html`, "utf8");
     const manifestBytes = readFileSync(`${instance}/dist/${name}.edit.json`, "utf8");
     const manifest = JSON.parse(manifestBytes);
     assert.equal(manifestBytes, JSON.stringify(manifest, null, 2) + "\n", `${name}: noncanonical manifest bytes`);
     assert.deepEqual(Object.keys(manifest), ["docId", "instance", "commit", "blocks"]);
     assert.match(manifest.docId, /^[0-9a-f]{6}$/);
     assert.equal(manifest.instance, name);
     assert.equal(manifest.commit, "");
     assert.ok(manifest.blocks && typeof manifest.blocks === "object" && !Array.isArray(manifest.blocks));
     const actualRowsByFile = {};
     for (const row of Object.values(manifest.blocks)) {
       actualRowsByFile[row.file] = (actualRowsByFile[row.file] ?? 0) + 1;
     }
     assert.deepEqual(actualRowsByFile, rowsByFile, `${name}: exact nonempty rows by source file`);
     const { sections, docIds } = scanRendered(html);
     assert.deepEqual(docIds, [manifest.docId], `${name}: manifest docId does not match rendered meta doc-id`);
     const found = new Map();
     for (const block of scanBlocks(html)) {
       const open = html.slice(block.openStart, block.openEnd);
       const match = /(?:^|\s)data-aid="(a[0-9a-f]{8})"(?:\s|>)/.exec(open);
       if (!match) continue;
       assert.ok(!found.has(match[1]), `${name}: duplicate rendered ${match[1]}`);
       found.set(match[1], { block, open });
     }

     const findOneByInner = (expected, label) => {
       const matches = [...found].filter(([, rendered]) =>
         html.slice(rendered.block.innerStart, rendered.block.innerEnd) === expected);
       assert.equal(matches.length, 1, `${name}: expected one ${label}`);
       return matches[0];
     };
     const [editableAid, editableRendered] = findOneByInner(editable.inner, "required editable sample");
     assert.equal(editableRendered.block.tag, editable.tag);
     assert.ok(/(?:^|\s)data-editable(?:\s|>)/.test(editableRendered.open));
     assert.ok(manifest.blocks[editableAid], `${name}: required editable sample lacks row`);
     assert.equal(manifest.blocks[editableAid].file, editable.file);
     if (editable.dataMd === null) {
       assert.ok(!/(?:^|\s)data-md(?:\s*=|\s|>)/.test(editableRendered.open));
     } else {
       assert.equal(attribute(editableRendered.open, "data-md"), editable.dataMd);
     }
     const [readOnlyAid, readOnlyRendered] = findOneByInner(readOnly, "required read-only sample");
     assert.ok(!/(?:^|\s)data-editable(?:\s|>)/.test(readOnlyRendered.open));
     assert.ok(!/(?:^|\s)data-md(?:\s*=|\s|>)/.test(readOnlyRendered.open));
     assert.ok(!manifest.blocks[readOnlyAid]);

     for (const [aid, row] of Object.entries(manifest.blocks)) {
       assert.match(aid, /^a[0-9a-f]{8}$/);
       assert.deepEqual(Object.keys(row), ["file", "section", "tag", "hash"]);
       const rendered = found.get(aid);
       assert.ok(rendered, `${name}: missing rendered ${aid}`);
       assert.ok(/(?:^|\s)data-editable(?:\s|>)/.test(rendered.open), `${name}: ${aid} lacks marker`);
       assert.equal(rendered.block.tag, row.tag);
       assert.ok(["p", "h2", "h3", "h4"].includes(row.tag));
       assert.equal(typeof row.section, "string");
       assert.match(row.hash, /^[0-9a-f]{64}$/);
       const inner = html.slice(rendered.block.innerStart, rendered.block.innerEnd);
       assert.equal(createHash("sha256").update(inner, "utf8").digest("hex"), row.hash);
       assert.match(row.file, /^sections\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$/);
       const sourcePath = `${instance}/${row.file}`;
       assert.ok(lstatSync(sourcePath).isFile());
       const sourceSection = parseSection(sourcePath);
       assert.equal(sourceSection.id, row.section,
         `${name}: ${aid} file ${row.file} does not produce section ${row.section}`);
       const enclosing = sections.filter(({ id, start, end }) =>
         id === row.section && start <= rendered.block.openStart && rendered.block.closeEnd <= end);
       assert.equal(enclosing.length, 1, `${name}: ${aid} is not inside section ${row.section}`);
     }

     for (const [aid, rendered] of found) {
       if (/(?:^|\s)data-editable(?:\s|>)/.test(rendered.open)) assert.ok(manifest.blocks[aid], `${name}: marker lacks row`);
       if (html.slice(rendered.block.innerStart, rendered.block.innerEnd) === expectedDemotion) {
         assert.ok(!/(?:^|\s)data-editable(?:\s|>)/.test(rendered.open));
         assert.ok(!/(?:^|\s)data-md(?:\s*=|\s|>)/.test(rendered.open));
         assert.ok(!manifest.blocks[aid]);
       }
     }
     const renderedOrder = [...found]
       .filter(([, rendered]) => /(?:^|\s)data-editable(?:\s|>)/.test(rendered.open))
       .map(([aid]) => aid);
     assert.deepEqual(Object.keys(manifest.blocks), renderedOrder, `${name}: manifest block order`);
     assert.ok(Object.values(manifest.blocks).every((row) => row.file !== "history.json"));
   }
   console.log("PASS  every edit marker and manifest row is a one-to-one hash/path match");
   NODE
   ```

   Expected: exactly the declared `PASS` line and exit `0`. The probe requires the exact nonzero 31-row/20-row manifest totals and per-source-file distribution before checking exact outer and row key sets/order, two-space serialization with one terminal LF, one rendered `meta name="doc-id"` whose content equals the six-hex manifest document id, final-component instance, empty commit, manifest block order, row-to-element and element-to-row completeness, tag, rendered section enclosure, a regular source path whose parsed source section id equals `row.section`, exact inner SHA-256, and the history exclusion. It also binds one editable and one read-only block in each real instance to exact content: the positive samples require their row/marker and exact conditional `data-md`, while the authored-attribute and `&rarr;` samples require neither edit attribute nor row. Counts cannot pass vacuously with empty manifests.

6. Verify the HTML-only delta and budget against the uniquely derived immutable P1-D base. Run this gate only after the P2-D implementation is committed. Both P2-D-new paths must first appear in the same reachable commit; the gate derives that creation commit independently for each path, requires the two values to match, and selects its first parent as the base. This makes the comparison reproducible without an operator-selected ref while permitting later P2-D fix commits. The command then verifies ancestry, P1-B/P1-D files and artifacts, and absence of both P2-D-new source paths and markers at the derived parent:

   ```bash
   set -euo pipefail
   P2D_EXAMPLE_HTML="example/dist/example.html"
   P2D_COMPONENTS_HTML="templates/components/dist/components.html"
   P2D_MD_CREATIONS="$(git log --format=%H --diff-filter=A HEAD -- templates/docbuild/src/inline_md.ts)"
   P2D_FIXTURE_CREATIONS="$(git log --format=%H --diff-filter=A HEAD -- templates/fixtures/inline.json)"
   test "$(printf '%s\n' "$P2D_MD_CREATIONS" | sed '/^$/d' | wc -l | tr -d ' ')" = 1
   test "$(printf '%s\n' "$P2D_FIXTURE_CREATIONS" | sed '/^$/d' | wc -l | tr -d ' ')" = 1
   [[ "$P2D_MD_CREATIONS" =~ ^[0-9a-f]{40}$ ]]
   test "$P2D_FIXTURE_CREATIONS" = "$P2D_MD_CREATIONS"
   P2D_CREATION_COMMIT="$P2D_MD_CREATIONS"
   test "$(git rev-list --parents -n 1 "$P2D_CREATION_COMMIT" | wc -w | tr -d ' ')" -ge 2
   P2D_BASE="$(git rev-parse --verify "${P2D_CREATION_COMMIT}^1^{commit}")"
   [[ "$P2D_BASE" =~ ^[0-9a-f]{40}$ ]]
   git merge-base --is-ancestor "$P2D_CREATION_COMMIT" HEAD
   git cat-file -e "${P2D_BASE}:templates/docbuild/src/editable.ts"
   ! git cat-file -e "${P2D_BASE}:templates/docbuild/src/inline_md.ts" 2>/dev/null
   ! git cat-file -e "${P2D_BASE}:templates/fixtures/inline.json" 2>/dev/null
   git cat-file -e "${P2D_BASE}:${P2D_EXAMPLE_HTML}"
   git cat-file -e "${P2D_BASE}:${P2D_COMPONENTS_HTML}"
   git grep -q -F -e ' data-aid="' "$P2D_BASE" -- "$P2D_EXAMPLE_HTML"
   git grep -q -F -e ' data-aid="' "$P2D_BASE" -- "$P2D_COMPONENTS_HTML"
   ! git grep -q -F -e ' data-editable' "$P2D_BASE" -- \
     "$P2D_EXAMPLE_HTML" "$P2D_COMPONENTS_HTML"
   export P2D_BASE
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { execFileSync } from "node:child_process";
   import { readFileSync } from "node:fs";
   import { scanBlocks } from "./templates/docbuild/dist/anchor-core.js";

   function withoutP2DAnnotations(html, blocks, file) {
     const replacements = [];
     const seen = [];
     for (const block of scanBlocks(html)) {
       const open = html.slice(block.openStart, block.openEnd);
       const aid = /(?:^|\s)data-aid="(a[0-9a-f]{8})"(?:\s|>)/.exec(open)?.[1];
       if (!aid || !Object.prototype.hasOwnProperty.call(blocks, aid)) continue;
       assert.ok(!seen.includes(aid), `${file}: duplicate rendered manifest aid ${aid}`);
       assert.equal(block.tag, blocks[aid].tag, `${file}: ${aid} tag mismatch`);
       const annotation = / data-editable(?: data-md="[^"]*")?>$/.exec(open);
       assert.ok(annotation, `${file}: ${aid} lacks exact terminal P2-D annotation`);
       const replacement = `${open.slice(0, annotation.index)}>`;
       replacements.push({
         start: block.openStart,
         end: block.openEnd,
         replacement,
         bytes: Buffer.byteLength(open, "utf8") - Buffer.byteLength(replacement, "utf8"),
       });
       seen.push(aid);
     }
     assert.deepEqual(seen, Object.keys(blocks), `${file}: manifest/rendered annotation order`);
     let stripped = html;
     for (const { start, end, replacement } of replacements.reverse()) {
       stripped = stripped.slice(0, start) + replacement + stripped.slice(end);
     }
     return {
       stripped,
       annotationBytes: replacements.reduce((sum, replacement) => sum + replacement.bytes, 0),
     };
   }

   const base = process.env.P2D_BASE;
   assert.match(base ?? "", /^[0-9a-f]{40}$/, "derived P2D_BASE must be a full commit id");
   for (const [file, manifestFile] of [
     ["example/dist/example.html", "example/dist/example.edit.json"],
     ["templates/components/dist/components.html", "templates/components/dist/components.edit.json"],
   ]) {
     const before = execFileSync("git", ["show", `${base}:${file}`]);
     const current = readFileSync(file);
     const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
     assert.ok(manifest.blocks && typeof manifest.blocks === "object" && !Array.isArray(manifest.blocks));
     const { stripped, annotationBytes } = withoutP2DAnnotations(
       current.toString("utf8"), manifest.blocks, file,
     );
     assert.deepEqual(Buffer.from(stripped, "utf8"), before, `${file}: non-P2-D byte changed`);
     const growth = current.byteLength - before.byteLength;
     assert.equal(growth, annotationBytes, `${file}: growth is not exactly manifest-backed annotations`);
     assert.ok(growth > 0 && growth < 2048, `${file}: ${growth} bytes`);
     console.log(`PASS  ${file}: +${growth} bytes`);
   }
   NODE
   unset P2D_MD_CREATIONS P2D_FIXTURE_CREATIONS P2D_CREATION_COMMIT P2D_BASE P2D_EXAMPLE_HTML P2D_COMPONENTS_HTML
   ```

   Expected: baseline verification is silent and accepts exactly one common creation commit for both P2-D-new paths. Its first parent must be an ancestor that contains P1-B's `editable.ts` and both aid-bearing P1-D artifacts, and contains neither P2-D-new source path nor an edit marker. No operator chooses a base ref; a missing, multiply-added, independently-added, or uncommitted new path fails. Node then prints one `PASS  <artifact>: +<n> bytes` line per artifact with `0 < n < 2048`; empty manifests or a demote-all build cannot pass. The probe reads derived-base bytes through `git show`, uses P1-D's scanner to remove only an exact terminal P2-D annotation from an opening tag whose aid is present in the corresponding manifest, requires one ordered annotation per manifest row, requires measured growth to equal those removed annotation bytes, compares buffers, and never writes a base artifact or helper into the worktree. Literal body text, demoted attributes, and authored attributes outside manifest-backed opening tags are never normalized away.

7. Include the generated integration refresh, then run the normal repository gates and hygiene checks:

   ```bash
   bash <<'BASH'
   set -euo pipefail

   templates/check-dist
   scripts/scrub-check.sh docs/tickets/P2-D.md templates/docbuild/src/inline_md.ts templates/docbuild/src/editable.ts templates/fixtures/inline.json
   git diff --check
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { execFileSync } from "node:child_process";

   const paths = (command, args) => execFileSync(command, args)
     .toString("utf8").split("\0").filter(Boolean);
   const changed = new Set([
     ...paths("git", ["diff", "--name-only", "--no-renames", "-z", "HEAD"]),
     ...paths("git", ["ls-files", "--others", "--exclude-standard", "-z"]),
   ]);
   const owned = [
     "templates/docbuild/src/editable.ts",
     "templates/docbuild/src/inline_md.ts",
     "templates/fixtures/inline.json",
   ];
   assert.deepEqual(owned.filter((path) => changed.has(path)).sort(), [...owned].sort(),
     "P2-D must change all and only its three implementation source paths");
   const allowed = (path) => owned.includes(path)
     || /^docs\/tickets\/[^/]+\.md$/.test(path)
     || path.startsWith("templates/docbuild/dist/")
     || /^(?:example\/dist\/example|templates\/components\/dist\/components)\.(?:html|edit\.json)$/.test(path);
   const unowned = [...changed].filter((path) => !allowed(path)).sort();
   assert.deepEqual(unowned, [], `unowned implementation paths changed: ${unowned.join(", ")}`);
   console.log("PASS  P2-D implementation ownership");
   NODE
   BASH
   ```

   Expected: `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; scrub reports no denied term or warning; diff check is silent; and the final line is exactly `PASS  P2-D implementation ownership`. The ownership assertion includes tracked, staged, unstaged, and untracked paths; requires all three owned implementation files; permits only the ticket-document set and the declared shared compiler/real-document outputs; and rejects every other changed implementation path. It therefore replaces a visual `git status` judgment. The coordination branch may contain other agents' ticket documents, but it must not contain another ticket's implementation source during this ownership gate.

## Failure modes

### Handled

- A `doc.json` id is absent or invalid: throw `BuildError("<inst>/doc.json: missing or invalid 'id' (expected six lowercase hexadecimal characters)")` before manifest or section mutation.
- Node's `basename(inst)` fails `^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$`: throw `BuildError("<inst>: invalid instance basename (expected ^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$)")` before source inspection, `dist` creation, manifest mutation, or section mutation.
- A scanned source block lacks exactly one generated aid or its form/value is wrong: throw `BuildError("<file>: scanned <tag> at offset <openStart> requires exactly one data-aid matching ^a[0-9a-f]{8}$")`, where `<file>` is the exact root-relative `sections/${section.file}` value and `<openStart>` is P1-D's decimal UTF-16 offset.
- The same valid aid appears again anywhere in the complete source-section scan: throw `BuildError("<file>: duplicate data-aid '<aid>'")` using the same root-relative `<file>` form for the later occurrence. This validation includes attributed/demoted editable tags and noneditable block tags so a hidden collision cannot enter later behavior.
- P1-D's scanner rejects a body or inner fragment: prefix its stable message with `<file>: ` and rethrow a `BuildError`; do not reinterpret malformed markup as read-only.
- A `section.file` fails `^[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$`, or its matching path is missing, a directory, FIFO, or symlink: treat that complete `Section` as generated/read-only. Reject a nonmatching name before filesystem access; a non-`ENOENT` `lstatSync()` failure for a matching name uses `BuildError("<source-path>: <original error.message>")`.
- An editable tag carries another attribute, shares a line with content, contains a nested block, or fails conversion equality: retain the exact body and aid but add no edit metadata or row.
- A supported inline tag is unclosed, case-varied, attributed, same-mark nested, or nested in a form the ordered passes cannot reproduce exactly: converter functions return deterministic text, and the equality gate demotes it without attempting repair. Exact pass-order-representable cross-mark nesting remains inside the bounded grammar.
- `&rarr;`, a link, a noncanonical entity, or another unsupported source spelling would change under the bounded converter: exact equality demotes it.
- No block passes: write a valid empty `blocks` object and return `[]`.
- `COMMIT_REF` is absent: serialize the empty string. A present value is opaque and escaped by JSON; it does not affect hashes or admission.
- Manifest directory creation, final temporary open/write/sync/close, or atomic rename fails: apply the exact manifest-path error rules above, preserve an existing target, keep all section objects unchanged, and remove only the temporary file successfully opened by this operation when possible. Retry only `EEXIST`, use at most 16 distinct candidates, and never unlink a colliding path that this operation did not open. Cleanup errors do not replace the primary message.
- The same instance is built twice with unchanged inputs/environment: both output kinds are identical because no clock, mtime, random serialized value, unordered traversal, or locale operation participates.

### Deliberately not handled

- Recovering from P1-D not having run, synthesizing an aid, trusting an authored aid, or falling back to section/ordinal identity.
- Treating a generated `.html`-looking synthetic section as editable. Generated section owners must use a non-source sentinel and must not impersonate an existing source filename.
- Editing an unsupported block by flattening it, sanitizing it, converting it to rich text, or partially marking safe descendants.
- Detecting authorization, a racing source write, or a stale pending receipt during build. The manifest provides inputs; server owners perform those checks in request order.
- Making two concurrent processes write one real instance. Integration serializes shared generated products; isolated roots are the supported parallel test boundary.
- Maintaining compatibility for a future converter or manifest format change without an explicit ticket that updates all named downstream consumers and the fixture.

## Settled decisions

- `aid` is the only edit identity. The older research `eid` and ordinal fields are superseded and must not reappear.
- The manifest is keyed by aid and is the only source of a source-file path; the exact inner-HTML SHA-256, not a timestamp or commit hint, detects source drift.
- `commit` remains an opaque advisory build reference; it is never shortened or promoted to conflict authority.
- The `built` timestamp is dropped. Deterministic output is more important than recording wall-clock build time.
- Editability is a narrow builder decision layered over P1-D's broader block identity. A read-only block still keeps its aid for comments, anchors, and history.
- Only `p`, `h2`, `h3`, and `h4` in actual source bodies are eligible. Authored attributes, nested blocks, non-whole-line placement, peek content, metadata, and generated history are read-only.
- Exact byte round trip is the safety gate. There is no HTML-equivalence or normalized comparison.
- The converter remains a three-mark ordered-pass string grammar with only `amp`, `lt`, and `gt` entity behavior. It has no recursive nesting model, but exact cross-mark nesting produced and reversed by those passes is representable. It is not CommonMark.
- `data-md` is emitted only for a successfully converted supported inline mark; entity decoding alone uses visible `textContent` and does not duplicate prose into an attribute.
- `data-editable` and manifest membership are capability hints, not authorization. Server-side role resolution remains mandatory.
- P1-B created `editable.ts`; P2-D is its first and only Build Order amendment. It does not reopen `index.ts`.
- `history.json` is the exact P2-E generated/read-only `Section.file` sentinel and is outside the edit manifest.
- Source implementation may proceed independently behind the fixture, but real HTML/manifests and final repository gates are one serialized integration step.

## Assumptions and open questions

Assumptions made explicit by this ticket:

- P1-A's final six-lowercase-hex `doc.id` contract and state-store authorization ruling supersede older suggestion research that placed owner/editor emails in `doc.json` or the edit manifest.
- P1-D is integrated first and preserves exact source inner HTML while adding one double-quoted lowercase `data-aid` to every scanned opening tag.
- P1-E's nested instances use the HTML builder's final-component basename for each artifact; document id, not a directory basename, is the cross-document identity.
- P2-E uses exact `file: "history.json"` for its generated section. This was coordinated with the P2-E owner so the source-file predicate is unambiguous.
- The 79-of-91 result and ordered 12 outer-block failure hashes belong to the eight named paths at immutable commit `2168188f115e4e3453cb75818f8458090f09aaa5`. Because P2-D owns none of those sources, current integration must reproduce the exact path set, counts, and failure identities; a source-owning ticket must amend P2-D explicitly if that public corpus changes.
- `COMMIT_REF` may be absent locally and may be a short or full opaque reference in hosting. Consumers must compare it only as a hint and never assume a fixed hex length.
- Generated edit manifests are deployment sidecars and shared integration products; they are not hand-authored or an additional exclusive source surface.

No implementation-blocking question remains. A future request to support links, a broader or recursive nested-mark grammar beyond the exact ordered-pass behavior, an editable generated section, source attributes, or a versioned manifest is a format migration: it must specify fixture changes, browser/server compatibility, size effects, and downstream rollout rather than extending P2-D implicitly.

No new external or platform research is required for this ticket. Its material contracts are internal deterministic string, filesystem, hashing, and predecessor-ticket contracts; Node's built-in SHA-256, UTF-8, JSON, and rename behavior are already sufficient for the specified target.

## References

- `HANDOFF.md` — working-tree preservation, public-data, generated-artifact, and no-commit handoff constraints.
- `README.md` — self-contained document model, source/build commands, zero-runtime-dependency builder, and public-repository posture.
- `docs/research/00-integration-plan.md` §§1.5, 2.5–2.7, 3.3–3.5, 4.1–4.6, 5 — authoritative state-store boundary, manifest shape, aid/hash conflict model, TypeScript hook contract, Build Order, benchmark, and downstream ownership.
- `docs/research/05-inline-editing.md` §§4–6, 9, 12 — narrow editable policy, bounded converter algorithm, equality gate, deterministic no-timestamp sidecar, size intent, and exact demoted paragraph. Its Rust names, `data-eid`, ordinal identity, noncryptographic hash, and direct implementation sketches are superseded by the final integration plan and this ticket.
- `docs/research/08-suggestions-and-editing-model.md` §§3–5, 10–12 — one editable policy for edits/suggestions, row absence/hash supersession behavior, apply ordering, and reconciliation consumers. Its committed owner/editor authority proposal is superseded by integration-plan §1.5.
- `docs/research/04-comments-and-discussion.md` §§3–4, 8.2–8.4, 15–16 — aid as shared block identity, scanner reuse, generated HTML boundaries, and later block-anchored consumers.
- `docs/tickets/P1-B.md` — creator of the `editable.ts` stub, exact signature/call site, hook order, `Section.file`, `BuildError`, and shared generated-artifact rules.
- `docs/tickets/P1-D.md` — authoritative scanner/tag/offset contract, source-versus-generated `data-aid`, mutation order, browser seam, and downstream prohibition on `data-eid`.
- GitHub issues #18, #25, #26, and #36–#40 — P3-E pending filtering, P4 edit/twin/apply/suggestion consumers that depend on this stable manifest, converter, and editable-policy contract.
