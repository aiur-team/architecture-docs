# P1-D — anchors.ts: scanner, normaliser, alignment, move pass, report

## Outcome

Every rendered block has a deterministic `data-aid` that survives safe edits and moves, with committed anchor state and a build report that makes lost anchors visible.

## Context

Comments, suggestions, presence markers, and inline edits need one block identity that does not change when prose is lightly edited or reordered. The builder can compare the previous committed block list with the new source, so it can preserve identity more safely than a browser that sees only the current document. This ticket implements that build-time layer and the one string-only scanner/normaliser shared later with the browser.

## Scope

### In scope

- Replace the no-op `anchorSections()` stub created by P1-B with the complete Node-side anchoring orchestration.
- Add a browser-and-Node-safe `anchor-core.ts` containing the canonical block tag list, whitespace normaliser, and raw-HTML block scanner.
- Read and validate each instance's committed `anchors.json`, align old and new normalised block texts, recover exact moves across and within sections, and deterministically mint collision-free ids for remaining new blocks.
- Inject one `data-aid` into every nonempty scanned block in each `Section.body`, mutating only the supplied in-memory `Section[]`.
- Rewrite `anchors.json` deterministically and return exact per-section report lines plus ordered orphan pairs through P1-B's established hook result.
- Commit initial generated anchor state for both real build instances: `example` and `templates/components`.
- Add zero-dependency TypeScript unit coverage for the shared core and the alignment/persistence orchestration.

### Out of scope

- Editing `templates/docbuild/src/index.ts` or `templates/base/layout.html`; P1-B owns the hook call, report printer, and `{{ANCHOR_CORE_JS}}` integration slot.
- Implementing the client-side text-quote resolver, the `exact`/`drifted`/`moved`/`orphaned` UI states, highlights, margin rail, or comments panel; P3-C owns those behaviors.
- Implementing editable-block policy, `data-editable`, `data-md`, inline-Markdown conversion, or the edit manifest; P2-D consumes `data-aid` after this hook returns.
- Implementing comment, suggestion, edit, presence, access, history, or realtime APIs and user interfaces.
- Writing `data-aid` into source `sections/*.html`, accepting author-supplied anchor ids, or creating a second block identity such as `data-eid`.
- Fuzzy text matching, client-side relocation, or any runtime DOM parsing.
- Adding a runtime dependency, changing `package.json`, changing `tsconfig.json`, or adding a test script; tests compile with the existing package and run through Node's built-in test runner.
- Hand-editing committed `dist/*.html`; refreshed artifacts are build products generated after the implementation is complete.

## Interface contract

### Shared block and normalisation core

`templates/docbuild/src/anchor-core.ts` is the only source for block scanning and whitespace normalisation. It has no imports and must not reference Node built-ins, the DOM, `document`, or `window`. Its exact exports are:

```ts
export const BLOCK = [
  "p", "li", "h2", "h3", "h4", "td", "th", "pre", "blockquote", "figcaption", "dd", "dt",
] as const;

export type BlockTag = (typeof BLOCK)[number];

export interface ScannedBlock {
  readonly tag: BlockTag;
  readonly openStart: number;
  readonly openEnd: number;
  readonly innerStart: number;
  readonly innerEnd: number;
  readonly closeEnd: number;
  readonly text: string;
}

export const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

export function scanBlocks(fragment: string): ScannedBlock[];
```

All offsets are zero-based UTF-16 string offsets into `fragment`, matching JavaScript string slicing. End offsets are exclusive: `openEnd === innerStart`, `innerEnd` points at the `<` of the matching close tag, and `closeEnd` points just after its `>`.

P1-B compiles and inlines this exact ESM before feature modules and exposes only the runtime values through:

```js
window.doc.anchor = { BLOCK, norm, scanBlocks };
```

P3-C and other browser consumers use that object. They must not copy `BLOCK`, `norm()`, or scanner logic into a client file. `BlockTag` and `ScannedBlock` are compile-time exports only.

### Scanner boundaries

`scanBlocks()` operates on a section body string, not on a document or DOM tree, and returns blocks in opening-tag document order.

#### Tags, comments, and raw-text elements

- A candidate opening tag is `<` followed case-insensitively by one exact member of `BLOCK`, followed by ASCII whitespace or `>`. Prefixes such as `<picture>` do not match `<p>`. `ScannedBlock.tag` is always the canonical lowercase `BlockTag` even when source markup uses uppercase.
- Candidate closing tags are also matched case-insensitively, so `<P>text</p>` and `<p>text</P>` are equivalent. A closing tag permits ASCII whitespace before `>` and nothing else.
- Every member of `BLOCK` is a paired element. Maintain a stack for candidate tags, including nested candidates that will not be returned separately. A self-closing candidate, a closing `BLOCK` tag that does not match the top of that stack (including any top-level closing candidate), or an opening candidate left on the stack is malformed input.
- The scanner respects single- and double-quoted attributes when finding a tag's closing `>`. A quote opened in a tag must close before the tag's `>`; backslash has no escaping meaning in HTML attributes.
- An HTML comment begins only with the exact four characters `<!--` and ends at the next exact `-->`. Tag-looking strings and character references inside a comment are ignored and contribute no text. An unterminated comment is an error even when it is outside a candidate block.
- `script` and `style` are the bounded raw-text set. Their tag names and closing tags are matched case-insensitively with the same exact-name boundary. After a valid opening tag, all bytes through the first matching `</script>` or `</style>` are opaque: tag-looking strings, comments, ampersands, and quotes inside do not participate in scanning or block text. An unclosed raw-text element is an error. Raw-text content inside an outer candidate contributes no text.
- Other non-`BLOCK` tags are ordinary markup. They do not become returned blocks, but their descendant text contributes to an enclosing block.
- The scanner balances the full nested candidate stack when locating each close. A returned block is an outermost candidate: if a candidate is inside another `BLOCK` element, only the outer candidate is returned. Non-block containers do not suppress descendants, so the `<h4>` and `<p>` inside a `<div>` remain separate blocks.
- `text` is the returned element's complete non-comment, non-raw-text descendant text in source order. Ordinary tags are removed, character references are decoded by the grammar below, then `norm()` is applied. A block whose normalised text is empty is skipped.
- The scanner never mutates its argument. It reports source offsets so Node-side injection can splice the original markup without reserializing it.

#### Character-reference grammar

Character references are recognized only in text that contributes to a returned block. They are not interpreted inside tags, attribute values, comments, or `script`/`style` raw text.

All recognized references require a semicolon. The grammar is:

```text
named   = "&" ASCII_LETTER ASCII_ALNUM* ";"
decimal = "&#" ASCII_DIGIT+ ";"
hex     = "&#" ("x" | "X") ASCII_HEX_DIGIT+ ";"
```

- Named references are case-sensitive and the allowed names are exactly `amp`, `apos`, `gt`, `harr`, `lt`, `mdash`, `nbsp`, `ndash`, `quot`, and `rarr`. Uppercase or mixed-case forms such as `&AMP;` are unknown.
- Decimal and hexadecimal values may contain leading zeroes. Decode only Unicode scalar values from U+0001 through U+10FFFF, excluding U+D800–U+DFFF. U+0000, a surrogate, or a value above U+10FFFF is not a Unicode scalar value under this contract.
- `&` is literal when the following character is neither `#` nor an ASCII letter, including end of input, whitespace, punctuation, and a second `&`. Thus `A & B` and `A && B` remain literal text.
- `&` followed by an ASCII letter starts a named-reference candidate. Consume ASCII alphanumerics; if the next character is not `;`, the candidate is unterminated and fails. With a semicolon, a name outside the exact list fails as unknown.
- `&#` always starts a numeric candidate. After optional `x`/`X`, the first character must be a digit in the selected base or the candidate is malformed. Consume valid digits. If the next character is an ASCII letter or digit that is invalid in that base, the candidate is malformed. If the digit run instead ends at end-of-input, whitespace, `<`, `&`, or punctuation other than `;`, the semicolon is missing. A complete syntactic candidate is then scalar-checked. It is never treated as literal text.
- A semicolon outside a candidate has no special meaning. For example, `&;` remains the two literal characters `&;` because `;` cannot start a candidate after `&`.

The core scanner throws the stable messages listed under **BuildError behavior**. `anchorSections()` adds the section filename and converts the error to `BuildError`.

#### Existing `data-aid` attributes

`scanBlocks()` accepts built markup containing `data-aid`; browser consumers must be able to scan built output. Before injection, `anchorSections()` separately tokenizes every returned opening tag's attributes and rejects an exact ASCII-case-insensitive attribute name `data-aid`.

- `data-aid`, `DATA-AID`, and mixed-case forms are the same prohibited source attribute.
- Valueless, empty, quoted, unquoted, whitespace-around-`=`, and duplicate forms are all rejected once the exact attribute-name token is seen.
- Attribute names such as `data-aidish` are not matches. Text such as `title="data-aid"` inside another attribute value is not an attribute name.
- If a tag or quoted attribute is itself unterminated, the scanner's unterminated-tag error takes precedence because no complete opening tag exists to validate. For every complete start tag, the source-`data-aid` error takes precedence over alignment or injection.

### Node anchoring hook and mutation

P1-D preserves the exact signature P1-B created in `templates/docbuild/src/anchors.ts`:

```ts
export function anchorSections(
  inst: string,
  sections: Section[],
): { report: string[]; orphans: Array<[string, string]> };
```

`Section` is imported from `./index.js`; the function does not redefine that type. `inst` is the trusted instance path already resolved by the builder, never a client-supplied value. `anchors.ts` may use Node `fs`, `path`, and `crypto`; those Node-only operations stay outside `anchor-core.ts`.

The function completes these stages in order:

1. Read `<inst>/anchors.json`. `ENOENT` means a first build with no prior anchors; every other read error is an expected `BuildError`.
2. Validate all prior data before changing any section. Scan every current `Section.body` with `scanBlocks()` and convert scanner errors to `BuildError` messages prefixed by `Section.file`.
3. Align each current section with the prior entry of the same `section.id`.
4. Run one document-wide exact move pass over all still-orphaned old blocks and all still-unclaimed new blocks. This includes moves between sections.
5. Mint ids for every still-unclaimed new block, reserving every prior id including ids that remain orphaned.
6. Build all replacement section bodies by inserting ` data-aid="<aid>"` immediately before each candidate opening tag's final `>`, walking recorded offsets from the end of the string toward the start.
7. Serialize the complete new anchor state, write it to a sibling temporary file, and atomically rename it to `<inst>/anchors.json`.
8. Only after all scans, alignment, serialization, and the temporary-file write succeed, assign the replacement bodies back to `sections`. Do not change `id`, `label`, `summary`, `nav`, `peek`, or `file`.

The source section fragments are never rewritten. A source candidate that already contains a `data-aid` is an expected `BuildError`; generated ids exist only in `Section.body`, built HTML, and `anchors.json`.

### `anchors.json` shape and deterministic serialization

Both owned anchor files use this exact versionless shape:

```json
{
  "overview": {
    "ids": ["a8e5bf3ee", "a982c7ca0"],
    "texts": [
      "Paper boats cross the quiet pond.",
      "Two lanterns mark the garden path."
    ]
  }
}
```

The prose and ids above are invented examples. The committed files contain values generated from the actual public example/component sections.

Validation and serialization rules are exact:

- The top level is a non-null JSON object keyed by section id. Each value is an object with exactly `ids` and `texts`.
- Every current `Section.id` and every prior top-level key must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`. This lowercase kebab-case grammar begins with a letter, so no section id is an ECMAScript integer-index property key. An invalid current id fails with the current section filename; an invalid prior key fails with the anchor-file label. Do not sanitise or reorder an invalid id.
- Current section ids must be unique. P1-B rejects duplicates before calling this hook; `anchorSections()` also fails defensively if called directly with a duplicate.
- `ids` and `texts` are arrays of strings with equal lengths. Every id matches `^a[0-9a-f]{8}$`, ids are unique across the whole document, every text is nonempty, and every stored text already equals `norm(text)`.
- Unknown fields, arrays at the top level, invalid JSON, invalid ids, duplicate ids, or mismatched array lengths fail with `BuildError`; invalid prior state is never silently regenerated.
- The new object is created from scratch by inserting non-integer section keys in current `sections` order; do not spread or mutate the prior parsed object. `JSON.stringify()` therefore preserves current section order. Within each section, object properties are inserted as `ids` then `texts`; both arrays follow scanner order and index `n` in `ids` identifies index `n` in `texts`.
- Removed sections are omitted from the rewritten file after their remaining ids have been reported as orphans.
- Serialize with `JSON.stringify(value, null, 2) + "\n"`. Object properties are emitted as `ids` then `texts`. An unchanged rebuild must produce byte-identical JSON.

`example/anchors.json` and `templates/components/anchors.json` are committed generated inputs. They are not placed in `dist/` and are not fetched by the browser.

### Alignment opcodes and similarity

Alignment is a dependency-free TypeScript port of `difflib.SequenceMatcher` with junk filtering and the `autojunk` heuristic disabled. It operates on the old and new arrays of normalised block-text strings.

The matching rule is deterministic:

1. Find the longest contiguous equal run in the current old/new ranges.
2. On equal-length ties, choose the lowest old start index, then the lowest new start index.
3. Recursively apply the same rule to the ranges before and after that run.
4. Sort and merge adjacent matching runs, add the terminal zero-length run, and derive `equal`, `replace`, `delete`, and `insert` opcodes in ascending old/new order.

For a pair of strings in a `replace` opcode, run the same matcher over arrays of Unicode code points (`Array.from(text)`). Similarity is `2 * M / (oldLength + newLength)`, where `M` is the total size of its matching runs. Two empty strings have similarity `1`; scanner output is nonempty, so that case is defensive only.

Apply opcodes as follows:

| Opcode | Required action |
|---|---|
| `equal` | Carry each old id to the corresponding new block and count it as `equal` in the destination section. |
| `replace` | Pair old and new blocks by relative position up to the shorter run. Carry and count the old id as `edited` when similarity is **greater than or equal to `0.6`**. Below `0.6`, leave the new block unclaimed and make the old block an orphan candidate. Extra old blocks become orphan candidates; extra new blocks remain unclaimed. |
| `delete` | Make every old block in the run an orphan candidate. |
| `insert` | Leave every new block in the run unclaimed. |

The threshold is inclusive: exactly `0.6` carries the id. Do not round before comparison. Sequence alignment is performed first within the same section id; it never pairs different sections as an edit.

### Move pass and section moves

After every section's local alignment, group orphan candidates and unclaimed new blocks by exact normalised text across the whole document. Reclaim an old id as `moved` only when that text has exactly one orphan candidate and exactly one unclaimed destination. This one-to-one rule handles reorderings and cross-section moves without guessing. If either side has duplicates, leave every candidate unmatched: old ids remain orphaned and new blocks receive new ids.

A moved id keeps its original value, is removed from the orphan result, and increments `moved` on the destination section. It is not also counted as `equal` or `edited`. The move pass compares exact normalised text only; it does not apply the `0.6` similarity rule across sections.

### Deterministic id minting and collisions

Mint ids only after alignment and the move pass, in current section order and then block order.

- The base candidate is `"a" + sha1(utf8(normalisedText)).slice(0, 8)` in lowercase hexadecimal. For example, the invented text `Paper boats cross the quiet pond.` produces `a8e5bf3ee`.
- The reserved set starts with every id read from prior `anchors.json`, including ids that remain orphaned, then gains each carried, moved, or newly minted id. An orphaned id is never silently reused for unrelated content.
- If the base candidate is reserved, try `"a" + sha1(utf8(normalisedText + "\0" + attempt)).slice(0, 8)` for decimal `attempt` values `1`, `2`, and so on until unused. For the duplicated invented text above, attempt 1 produces `a6c049a4c`.
- SHA-1 is an identity checksum, not a security control. Use Node's built-in crypto implementation in `anchors.ts`; do not add a package.

This rule gives duplicate equal-text blocks distinct ids while keeping repeated clean builds byte-identical.

### Report format and ordering

`anchorSections()` never writes to stdout or stderr. It returns one line for each current section in `sections` order, followed by a line for each removed prior section that still has at least one orphan, in the removed sections' prior JSON key order.

Each line is exact, including four leading spaces and the uppercase final label:

```text
    overview: 12 equal, 1 edited, 1 moved, 2 ORPHANED
```

Counts have these meanings:

- `equal`, `edited`, and `moved` are attributed to the destination current section.
- `ORPHANED` is attributed to the old section that owned the id.
- Newly minted blocks are not included in these four counts.
- A current section with all zero counts still gets a line, so first-build and no-change reports have a stable shape.

The returned `orphans` array contains only ids left after the move pass, as `[oldSectionId, aid]`. Its order is prior JSON section order and then prior `ids` order. P1-B prints the `anchors` heading, these lines unchanged, and this exact warning shape with the first eight pairs while retaining the full count:

```text
  !! 2 anchor(s) gone. Threads on them become orphaned: overview/a8e5bf3ee, overview/a982c7ca0
```

An orphan is a warning, not a build failure; `anchorSections()` returns normally after writing the new state.

### BuildError behavior

Expected operational and input failures throw the `BuildError` class exported by `templates/docbuild/src/index.ts`. `anchors.ts` may import `BuildError` as a runtime value despite the existing ESM cycle; it must not read that binding at module initialization. The P1-B CLI catches it, prepends `error: `, prints one line, exits `1`, and emits no stack trace.

Error text is part of the test contract. In the templates below, angle-bracketed terms are substituted values and all other punctuation/capitalisation is literal.

`<offset>` is the zero-based UTF-16 offset of the opening `<` or `&`. `<tag>` is canonical lowercase. `scanBlocks()` throws a plain `Error` with exactly one of:

```text
anchor scan at <offset>: unterminated HTML comment
anchor scan at <offset>: unterminated tag
anchor scan at <offset>: unexpected closing block </<tag>>
anchor scan at <offset>: self-closing block <tag>
anchor scan at <offset>: unclosed block <tag>
anchor scan at <offset>: unclosed raw-text element <tag>
anchor scan at <offset>: named character reference is missing ";"
anchor scan at <offset>: unknown named character reference "<name>"
anchor scan at <offset>: numeric character reference is malformed
anchor scan at <offset>: numeric character reference is missing ";"
anchor scan at <offset>: numeric character reference is not a Unicode scalar value
```

Error selection is deterministic:

- For named candidates, a missing semicolon is reported before allowed-name lookup. With a semicolon, an unsupported/case-mismatched `<name>` reports `unknown named`.
- For numeric candidates, missing/invalid digits report `malformed`; a valid digit run not followed immediately by `;` reports `missing ";"`; only a syntactically complete number is range-checked.
- For markup, an unterminated comment/raw-text region is reported before interpreting anything inside it. An unterminated candidate start tag is reported before source-attribute validation. Otherwise an unexpected close or self-closing candidate is reported before searching for a later match.

`anchorSections()` catches a core scanner error and throws `BuildError` with exactly `<section-file>: <core-message>`. A prohibited attribute in a complete candidate start tag uses:

```text
<section-file>: anchor scan at <openStart>: source data-aid attribute is not allowed
```

For anchor-state errors, `<anchors>` is `path.relative(process.cwd(), path.join(inst, "anchors.json"))` with platform separators converted to `/`. If that calculation is empty, use `anchors.json`. JSON parsing discards the engine-specific `SyntaxError` detail so the public messages remain stable across supported Node versions.

```text
<anchors>: read failed (<code>)
<anchors>: invalid JSON
<anchors>: expected a JSON object
<anchors>: invalid section id "<id>"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
<anchors>: section "<id>" must contain exactly "ids" and "texts"
<anchors>: section "<id>".ids must be an array of strings
<anchors>: section "<id>".texts must be an array of strings
<anchors>: section "<id>" has different ids/texts lengths
<anchors>: section "<id>" has invalid aid at ids[<index>]
<anchors>: duplicate aid "<aid>"
<anchors>: section "<id>" has invalid normalized text at texts[<index>]
<anchors>: temporary write failed (<code>)
<anchors>: replace failed (<code>)
```

An operating-system error uses its string `code`; if absent, use `UNKNOWN`. `ENOENT` is treated as first-run absence only for the initial read. It remains an error for temporary-file creation or replacement.

Current-section validation uses these stable messages before alignment:

```text
<section-file>: invalid section id "<id>"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
<section-file>: duplicate section id "<id>"
```

For a duplicate, `<section-file>` is the later entry's `Section.file`, encountered in supplied array order. The first occurrence remains unchanged.

Programming defects that do not match an expected scanner, validation, or filesystem branch continue to propagate rather than being relabelled as `BuildError`.

Failure is transactional at the ticket boundary: if any section fails, no supplied `Section.body` is changed and the prior `anchors.json` remains in place. Best-effort removal of a leftover temporary file must not hide the original `BuildError`.

## Files owned

- `templates/docbuild/src/anchors.ts` — **amended**; P1-B creates it as an always-compiled no-op stub, and P1-D replaces only that stub implementation.
- `templates/docbuild/src/anchor-core.ts` — **new**; P1-D owns the browser/Node-safe `BLOCK`, `norm()`, and `scanBlocks()` source.
- `templates/docbuild/src/anchors.test.ts` — **new**; P1-D owns all core, alignment, persistence, report, and failure-path unit coverage.
- `example/anchors.json` — **new**; generated by P1-D from the current `example/sections/*.html` and committed.
- `templates/components/anchors.json` — **new**; generated by P1-D because `templates/components` is a real instance rebuilt by `templates/check-dist`, and committed.

`example/dist/example.html` and `templates/components/dist/components.html` are refreshed generated build products, not hand-edited implementation surfaces. `docs/tickets/P1-D.md` is the ticket specification, not part of the implementation file surface.

## Dependencies

### Upstream

- **P1-B (required, land first):** provides the always-compiled `anchors.ts` stub, `Section` type, exact `anchorSections(inst, sections)` call after history and before editable marking, anchor report channel, and the optional `{{ANCHOR_CORE_JS}}` slot that exposes `{ BLOCK, norm, scanBlocks }` through `window.doc.anchor`. P1-D amends the P1-B-created stub and must start from or rebase onto P1-B. It does not edit P1-B's `index.ts` or `layout.html`.

### Parallel phase-1 work

- **P1-A:** no dependency in either direction. Document `id`/`slug`/`aliases` files are disjoint from P1-D and do not participate in anchor minting.
- **P1-C:** no dependency in either direction. Identity/functions files are disjoint from the builder anchor modules.
- **P1-E:** no dependency in either direction. Site/CI configuration files are disjoint; after integration, its site build consumes the same already-hooked builder behavior.

P1-A, P1-C, and P1-E can run concurrently with each other and with P1-B on disjoint files. P1-D is the only Phase 1 ticket serialized behind P1-B because it amends `templates/docbuild/src/anchors.ts`.

The safe source-code waves do not grant parallel ownership of generated HTML. P1-A, P1-B, and P1-D can all change `example/dist/example.html` or `templates/components/dist/components.html` indirectly. Implementers edit only their exclusive source paths; after the applicable source changes are integrated, the coordination branch performs one serialized rebuild and accepts the generated artifact refresh. A ticket must not hand-edit, reset, or use either `dist/*.html` file to resolve another ticket's output delta.

### Downstream contracts

- **P2-D** receives `data-aid` on every scanned block and imports the shared scanner rather than defining another block boundary. It marks only its narrower editable subset after `anchorSections()` returns.
- **P3-C** receives `window.doc.anchor.norm` and `window.doc.anchor.scanBlocks` from P1-B's slot plus the rendered `data-aid` values; it adds text-quote resolution without copying the shared functions.
- **P3-G** uses `data-aid` to place per-block presence markers.
- **P4-B, P4-N, and P4-P** use the same `aid` as the edit/suggestion join and must not introduce `data-eid`.

## Acceptance criteria

- [ ] `anchor-core.ts` exports the exact `BLOCK`, `BlockTag`, `ScannedBlock`, `norm()`, and `scanBlocks()` contract and contains no import, Node built-in, DOM, `document`, or `window` reference.
- [ ] `BLOCK` contains exactly the twelve tags in the declared order, and `norm()` is exactly the one-line JavaScript whitespace rule.
- [ ] The scanner finds only exact case-insensitive tag names, canonicalizes returned names, honors quoted attributes and case-varied closing tags, returns outermost nonempty blocks in document order, and reports exact UTF-16 offsets.
- [ ] Complete comments and `script`/`style` raw text suppress tag-looking content; unterminated comments, tags, blocks, and raw-text elements fail with their exact offset/message contract.
- [ ] Character references follow the exact semicolon, case, literal-ampersand, digit, and Unicode-scalar grammar; every accepted and rejected branch has a named unit test.
- [ ] `anchorSections()` rejects every exact case variant/form of a source `data-aid` attribute without rejecting `data-aidish` or attribute values containing that text.
- [ ] `anchorSections()` retains P1-B's exact signature, mutates only `Section.body`, and does not require an `index.ts` or `layout.html` change.
- [ ] Current and prior section ids follow the non-integer lowercase-kebab grammar; invalid ids fail instead of being sanitised, and valid keys serialize in current section order.
- [ ] Both owned `anchors.json` files use the exact shape and `JSON.stringify(..., null, 2) + "\n"` serialization; two unchanged builds leave them byte-identical.
- [ ] Equal local blocks keep ids; paired replacements at similarity `>= 0.6` keep ids and count as edited; replacements below `0.6` orphan rather than guess.
- [ ] Inserting a new paragraph leaves every later block's id unchanged.
- [ ] Reordering three uniquely worded paragraphs preserves all three ids through the move pass.
- [ ] Moving a uniquely worded paragraph to another section preserves its id and counts `moved` in the destination section.
- [ ] Ambiguous duplicate text is never silently moved; unmatched old ids orphan and unmatched new blocks receive distinct deterministic ids.
- [ ] Minted ids match `^a[0-9a-f]{8}$`, are globally unique within an instance, reserve orphaned prior ids, and follow the exact salted collision rule.
- [ ] Every scanned rendered block receives exactly one `data-aid`; source section fragments and `Section.peek` remain unchanged.
- [ ] Report lines, counts, line ordering, orphan ordering, capitalization, indentation, and P1-B's eight-item warning boundary match the interface contract.
- [ ] Invalid prior JSON/shape, malformed section markup, unsupported entities, existing source anchor attributes, and filesystem failures use the exact stable error templates and become `BuildError` without partial section mutation or replacement of good prior state.
- [ ] The unit suite compiles under `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, and `exactOptionalPropertyTypes`, with no package or TypeScript configuration change.
- [ ] The builder remains zero-runtime-dependency and Node 18 compatible.
- [ ] Refreshed `example` and `templates/components` artifacts pass the repository's deterministic-dist gate.
- [ ] No implementation source outside the five owned paths is edited.

## Test plan

Run every command from the repository root.

1. Typecheck the implementation and tests with the existing strict configuration:

   ```bash
   npm --prefix templates/docbuild run check
   ```

   Expected: exit `0` with no TypeScript diagnostics. No `package.json`, lockfile, or `tsconfig.json` change is required.

2. Compile and run the built-in Node test suite directly:

   ```bash
   npm --prefix templates/docbuild run build
   node --test templates/docbuild/dist/anchors.test.js
   ```

   Expected: exit `0`; TAP summary contains `# tests 26`, `# pass 26`, and `# fail 0`.

   `anchors.test.ts` must contain exactly these independently named tests:

   1. `norm collapses JavaScript whitespace and trims ends` — include spaces, tabs, newlines, and U+00A0.
   2. `scanner returns all exact block tags with canonical names and UTF-16 offsets` — include all twelve tags and ensure `<picture>` is not `<p>`.
   3. `scanner matches opening and closing tag case variants` — cover `<P>...</p>` and `<p>...</P>`.
   4. `scanner honors quoted greater-than signs and suppresses nested blocks`.
   5. `scanner ignores complete comments and their tag-looking contents`.
   6. `scanner rejects an unterminated comment at its exact offset` — assert the complete stable error message, including a comment outside any block.
   7. `scanner treats script and style as opaque raw text` — include case-varied closing tags, tag-looking strings, ampersands, and one unclosed raw-text error with its exact message.
   8. `character references decode the exact named set and preserve bare ampersands` — include `A & B`, `A && B`, `&;`, and every allowed lowercase name.
   9. `named character references require semicolons and lowercase allowed names` — assert exact missing-semicolon and unknown-name messages for `&amp`, `&AMP;`, and an invented unknown name.
   10. `numeric character references decode decimal and hexadecimal scalars` — include leading zeroes and lowercase/uppercase `x`.
   11. `numeric character references reject malformed syntax, missing semicolons, and nonscalars` — cover no digits, a sign, an invalid base digit, end/punctuation after a valid run, U+0000, a surrogate, and above U+10FFFF with exact messages.
   12. `source data-aid detection is ASCII-case-insensitive and token-exact` — reject valueless, empty, quoted, unquoted, whitespace-around-equals, duplicate, and mixed-case forms; accept `data-aidish` and `title="data-aid"`; assert that an unterminated attribute quote reports `unterminated tag` first.
   13. `scanner rejects self-closing, unexpected-closing, unterminated, and unclosed block markup` — assert exact offsets, canonical tag names, and complete stable messages.
   14. `section ids enforce non-integer lowercase kebab-case and preserve JSON key order` — reject current/prior `0`, `01`, `UPPER`, `_hidden`, and `trailing-`; accept `a`, `a1`, and `build-order`; assert exact current/prior error labels and serialized current order.
   15. `first build mints deterministic globally unique aids and exact JSON bytes` — include duplicate invented text and assert `a8e5bf3ee` then salted `a6c049a4c`.
   16. `unchanged rebuild preserves section bodies, ids, JSON bytes, and report format`.
   17. `insert opcode mints one id without changing later ids`.
   18. `replace at similarity exactly 0.6 carries the id and reports edited`.
   19. `replace below 0.6 orphans the old id and mints a new id`.
   20. `delete and removed-section opcodes return orphans in prior order`.
   21. `three-block reorder preserves all ids through the move pass`.
   22. `unique cross-section move preserves the id and counts the destination move`.
   23. `duplicate move candidates remain ambiguous and are not reclaimed`.
   24. `anchors JSON shape errors use every stable validation template` — cover non-object top levels, extra/missing fields, non-string arrays, length mismatch, invalid/duplicate aids, and non-normalised/empty text.
   25. `invalid anchors read or scanner input throws BuildError without mutation or overwrite` — assert exact path/section wrapping and error text.
   26. `temporary-write or replace failure throws BuildError without partial section mutation` — assert exact filesystem-code messages and retained prior bytes.

   Tests use `node:test`, `node:assert/strict`, and temporary directories from Node core. They clean up their own temporary data and do not read or overwrite either committed anchors file.

3. Prove the shared source is safe to inline in a browser module:

   ```bash
   if rg -n '(^|[[:space:]])import[[:space:]]|node:|\bdocument\b|\bwindow\b' templates/docbuild/src/anchor-core.ts; then
     echo "FAIL  anchor-core is not browser-safe" >&2
     exit 1
   else
     echo "PASS  anchor-core is browser-safe"
   fi
   ```

   Expected: exactly `PASS  anchor-core is browser-safe` and exit `0`.

4. Build both real instances twice and prove their committed anchor state is stable:

   ```bash
   (
     set -e
     p1d_before="$(mktemp -d)"
     p1d_cleanup() {
       p1d_cleanup_code=$?
       rm -f -- "$p1d_before/example.json" "$p1d_before/components.json"
       rmdir -- "$p1d_before" 2>/dev/null || true
       return "$p1d_cleanup_code"
     }
     trap p1d_cleanup EXIT
     trap 'exit 129' HUP
     trap 'exit 130' INT
     trap 'exit 143' TERM

     templates/build example
     templates/build templates/components
     cp example/anchors.json "$p1d_before/example.json"
     cp templates/components/anchors.json "$p1d_before/components.json"
     templates/build example
     templates/build templates/components
     cmp "$p1d_before/example.json" example/anchors.json
     cmp "$p1d_before/components.json" templates/components/anchors.json
   )
   ```

   Expected: the subshell exits `0`; each build prints an `anchors` heading followed by one exact report line per current section, every line has `0 ORPHANED` on an unchanged rebuild, and both `cmp` commands print nothing. On success, command failure, or `HUP`/`INT`/`TERM`, the `EXIT` trap removes only the two explicitly named comparison files and then removes their now-empty `mktemp` directory. The cleanup function returns the status captured on trap entry, so it does not turn a failed build, copy, or comparison into success.

5. Inspect rendered coverage and uniqueness for each instance:

   ```bash
   node --input-type=module <<'NODE'
   import { readFileSync } from "node:fs";

   for (const [htmlPath, anchorsPath] of [
     ["example/dist/example.html", "example/anchors.json"],
     ["templates/components/dist/components.html", "templates/components/anchors.json"],
   ]) {
     const html = readFileSync(htmlPath, "utf8");
     const anchors = JSON.parse(readFileSync(anchorsPath, "utf8"));
     const ids = Object.values(anchors).flatMap(({ ids }) => ids);
     if (ids.length === 0) throw new Error(`${anchorsPath}: expected anchors`);
     if (new Set(ids).size !== ids.length) throw new Error(`${anchorsPath}: duplicate id`);
     for (const id of ids) {
       const count = html.split(`data-aid="${id}"`).length - 1;
       if (count !== 1) throw new Error(`${htmlPath}: ${id} occurs ${count} times`);
     }
     console.log(`PASS  ${htmlPath}: ${ids.length} unique anchors rendered once`);
   }
   NODE
   ```

   Expected: two `PASS` lines, one for each invented/public example artifact, and exit `0`. Every id from committed state appears exactly once in its built document.

6. After refreshing and including both generated HTML artifacts in the candidate commit, run the repository acceptance gate:

   ```bash
   templates/check-dist
   ```

   Expected: exit `0`; output ends with `PASS  every committed document is byte-identical after a rebuild`.

7. Check public-repository hygiene and patch hygiene:

   ```bash
   scripts/scrub-check.sh docs/tickets/P1-D.md templates/docbuild/src/anchors.ts templates/docbuild/src/anchor-core.ts templates/docbuild/src/anchors.test.ts example/anchors.json templates/components/anchors.json
   git diff --check
   ```

   Expected: the scrub exits `0` with `PASS  no denied term and no warning.` and `git diff --check` exits `0` with no output.

8. Confirm the implementation source diff stays inside P1-D's boundary:

   ```bash
   git status --short
   ```

   Expected: P1-D contributes only the five owned implementation paths, the ticket specification, and refreshed generated `example/dist/example.html` and `templates/components/dist/components.html`. Other coordination-branch ticket documents may also be present; `templates/docbuild/src/index.ts`, `templates/base/layout.html`, package files, and source section fragments are not P1-D changes.

## Failure modes

### Handled

- `anchors.json` does not exist on first build: treat prior state as empty, mint all ids, and create the file.
- Prior anchor state is unreadable, malformed, noncanonical, or internally inconsistent: fail with `BuildError` and preserve the prior file.
- A candidate opening tag is malformed, self-closing, unexpectedly closed, or unclosed: fail with the exact scan offset, canonical tag, section filename, and no partial mutation.
- A tag name merely begins with a block name, a tag-looking string occurs in a complete comment or `script`/`style`, or `>` occurs inside a quoted attribute: the scanner does not create a false block boundary.
- A comment or `script`/`style` raw-text element is unterminated: fail at its opening offset; opaque contents cannot create a competing error.
- A bare `&` is followed by whitespace, punctuation, end-of-input, or another `&`: preserve it literally. A named/numeric candidate violates its semicolon, case, digit, or scalar rule: fail with the exact character-reference message.
- A block contains only tags, comments, or whitespace: skip it and mint no id.
- Source markup already contains an exact case-insensitive `data-aid` attribute in any complete syntactic form: fail rather than trust, duplicate, or overwrite it; prefix attributes and occurrences inside other attribute values do not match.
- A current or stored section id is an integer-index key, uppercase, malformed kebab case, or duplicated: fail before alignment so object-property enumeration cannot change serialized section order.
- A block is unchanged: carry its id through an `equal` opcode.
- A replacement is at least `0.6` similar: carry its id and report `edited`; a lower score or whole rewrite orphans rather than guesses.
- A uniquely worded block is reordered or moved between sections: reclaim the old id during the global move pass.
- Repeated exact text makes a move ambiguous: reclaim nothing, report the old ids as orphaned, and mint collision-free ids for the new blocks.
- A new id's eight-hex SHA-1 prefix collides with any prior/current id: use the deterministic NUL-plus-decimal retry sequence.
- A whole section is removed: return every unreclaimed prior id from that section in stable order and omit the section from new state.
- More than eight ids orphan: return all pairs; P1-B prints the total and only the first eight pair names.
- Writing or renaming the replacement anchor file fails: throw `BuildError`, retain old state, do not mutate supplied sections, and best-effort remove the temporary file.

### Deliberately not handled

- Fuzzy recovery of edited or moved prose. A low-confidence match must be visible as an orphan; P3-C later performs only unique exact quote recovery in the browser.
- Persisting anchor state in Blobs or storing `exact`/`drifted`/`moved`/`orphaned`. `anchors.json` is committed build state; reader state is computed at load time.
- Preserving identity through a split or merge when the one-to-one rules do not identify a unique block. One side may keep an id; the rest orphan or mint visibly.
- A complete general-purpose HTML5 parser. Section fragments are trusted authored inputs; the scanner implements the explicit paired-block/comment/attribute/entity contract and fails loud outside it.
- Repairing manually edited anchor files, accepting legacy id formats, or silently normalising stored text. Review the diff and correct invalid state explicitly.
- Browser wiring outside `anchor-core.ts`. P1-B owns the integration slot and P3-C owns browser behavior; P1-D supplies the exact shared module only.
- Editing or suggestion conflict resolution. Later write paths use the block hash as authority and consume this ticket's `aid`; they do not change the anchor alignment policy.

## Settled decisions

- `data-aid` is the platform's only block identity. `data-eid`, ordinals, XPath/CSS selectors, and content-hash-only replacement identities are rejected.
- Anchoring has two independent layers: P1-D carries block identity at build time; P3-C later resolves an exact text quote inside the block at read time.
- `BLOCK`, `norm()`, and raw-string scanning have one implementation in `anchor-core.ts`. Browser consumers receive those exact runtime functions through `window.doc.anchor`; no parity fixture between duplicate implementations is permitted.
- The block set and its order are fixed at twelve tags. The editable subset is a later policy layered on the same scanner, not a second scanner.
- Section ids are non-integer lowercase kebab-case keys. This keeps `JSON.stringify()` section ordering equal to builder order without a custom serializer.
- Character references use the bounded, semicolon-required, case-sensitive grammar in this ticket; complete HTML comments and `script`/`style` raw text are opaque scanner regions.
- Local sequence alignment is order-sensitive, has no junk/autojunk heuristics, and carries a replacement only at similarity `>= 0.6`.
- Exact one-to-one move recovery runs after local alignment across the whole document, including section moves. Ambiguity orphans instead of guessing.
- `anchors.json` is committed and deterministic so anchor churn is reviewed beside prose changes. It is not part of the built artifact.
- Anchor loss is reported but does not fail the build. Invalid input or filesystem operations do fail through `BuildError` without a stack trace.
- Anchor ids are deterministic SHA-1-derived checksums with an explicit collision rule; they are not authentication, authorization, or integrity controls.
- The builder stays TypeScript, Node 18 compatible, and zero-runtime-dependency. Node built-ins are allowed only in Node orchestration, never in the browser-safe core.
- P1-D consumes P1-B's stable stub, hook order, report channel, and inlining slot without touching `index.ts` or `layout.html`.
- Source sections never receive generated ids. The hook mutates in-memory `Section.body`; the normal builder renders the resulting attributes.

## Assumptions and open questions

### Assumptions

- **Module split:** integration plan §3.3 overstates the browser constraint when it says all of `anchors.ts` can be browser-valid while the same synchronous module must read and atomically rewrite `<inst>/anchors.json`. P1-D resolves that contradiction explicitly: `anchor-core.ts` is the shared browser/Node-safe string module, while `anchors.ts` is Node-only orchestration. This preserves one implementation of every shared rule without pretending filesystem code can execute in a page.
- **P1-B integration amendment:** P1-B's detailed §4.1 responsibility controls over the older summary table and is amended to provide `{{ANCHOR_CORE_JS}}`, ordered inline module scripts, and `window.doc.anchor = { BLOCK, norm, scanBlocks }`. P1-D relies on that stable slot and does not widen into P1-B files.
- **Second committed anchor file:** the §4.3 summary lists only `example/anchors.json`, but P1-B calls the hook for every real instance and `templates/check-dist` also builds `templates/components`. P1-D therefore owns `templates/components/anchors.json` as a new generated input; excluding it would make the mandatory deterministic-dist check impossible.
- **Scanner interpretation:** the older research phrase “every non-nested block” means outermost elements from the shared `BLOCK` set, while recognized descendants inside non-block layout containers remain candidates. This prevents overlapping anchors without hiding prose inside ordinary `<div>` layout.
- **Section-id grammar:** the builder already supplies word-like ids, but the ruling plan did not exclude ECMAScript integer-index keys, whose property enumeration would reorder `JSON.stringify()` output. The explicit `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` grammar preserves every current id and makes current section order mechanically stable.
- **Bounded HTML grammar:** a full HTML5 entity/tokenizer table would violate the zero-dependency, shared-source boundary. The exact entity list, literal-ampersand rule, two-element raw-text set, and fail-loud syntax rules cover every committed instance and define deterministic extension behavior.
- **SequenceMatcher port:** “`difflib.SequenceMatcher`” means the deterministic Ratcliff/Obershelp matching-block and ratio rules stated in this ticket, with junk and autojunk disabled. No Python process or dependency is introduced.
- **Collision rule:** the ruling plan fixes the base `a` plus eight SHA-1 hex characters but does not define duplicate/collision handling. Reserving all historical ids and hashing `text + NUL + decimal attempt` is the minimum deterministic rule that prevents two DOM blocks from sharing one selector and prevents an orphan id from silently attaching to unrelated prose.

### Open questions

None block implementation. If the owner later chooses a broader entity table, nested-block policy, or a different collision salt, that is an explicit format change to review before editing committed anchor state; implementations must not improvise those changes inside P1-D.

## References

- `HANDOFF.md`, **What “done” means** and **Decisions that are already made** — strict TypeScript, zero runtime dependencies, deterministic `check-dist`, one shared normaliser/scanner, and no second anchoring implementation.
- `README.md`, **Checks** and **The platform** — Node 18 baseline, self-contained output, typecheck, scrub gate, and the integration plan's authority.
- `docs/research/00-integration-plan.md` §2.2, **Anchor** — `data-aid` is the block half of the stored anchor and reader state is computed rather than persisted.
- `docs/research/00-integration-plan.md` §2.7, **Anchors file** — committed section-keyed `ids`/`texts` state.
- `docs/research/00-integration-plan.md` §3.1–§3.3, **The anchoring decision** — one block identity, shared tag/normalisation policy, opcode actions, inclusive similarity floor, move pass, report, and no fuzzy matching.
- `docs/research/00-integration-plan.md` §3.4–§3.5, **Inline editing and survival** — in-memory `data-aid` continuity, source/build boundary, and expected behavior for edits, moves, splits, deletes, and section moves.
- `docs/research/00-integration-plan.md` §4.1, **The move that makes the front wide** — P1-B's stable signature/call site, always-compiled stub, `Section[]` mutation, report channel, and browser-safe shared-function requirement.
- `docs/research/00-integration-plan.md` §4.3, **Phase 1** — P1-D scope and verification; P1-A, P1-C, and P1-E parallel boundaries.
- `docs/research/00-integration-plan.md` §6 rulings 7, 18, 27, 39, and 40 — `data-aid`, one scanner with layered policies, final TypeScript choice, and no extra toolchain.
- `docs/research/04-comments-and-discussion.md` §3–§4, **Anchoring and build-time behavior** — two-layer failure behavior, `0.6` guard, scanner/injector intent, tested reorder/similar-sibling/split cases, and committed review state. Its older Rust names and hash fallback are superseded by the integration plan and this TypeScript ticket.
- `docs/research/04-comments-and-discussion.md` §8.2–§8.4, **Normalised text and resolution** — JavaScript whitespace behavior, entity/text expectations, and why unique exact recovery fails visibly.
- `docs/research/04-comments-and-discussion.md` §15–§16, **Build order and dependencies** — anchoring lands before comment UI and inline editing consumes the same identity.
- `docs/research/05-inline-editing.md` §4–§5, §7, and §11–§12 — editable-policy boundary, scanner reuse, block-hash conflict role, and the rejected ordinal-derived `data-eid` design.
- `docs/research/08-suggestions-and-editing-model.md` §10, **The interaction with anchoring** — accepted edits above/below the threshold, comment effects, and why anchor churn must remain visible in review.
- GitHub issue #2, **P1-B — The keystone** — the creator and owner of the stub, hook call/report integration, and browser-module slot P1-D consumes.
