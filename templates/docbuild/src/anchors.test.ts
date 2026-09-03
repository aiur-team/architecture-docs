/**
 * Unit coverage for P1-D: the shared anchor core (scanner, normaliser, block
 * list) and the Node anchoring orchestration (alignment, move pass, minting,
 * injection, persistence, report and failure paths).
 *
 * Compiled by the existing package and run with Node's built-in test runner:
 *
 *     npm --prefix templates/docbuild run build
 *     node --test templates/docbuild/dist/anchors.test.js
 *
 * No runtime dependency, no package or tsconfig change. Tests only ever touch
 * temporary directories and never read or overwrite a committed anchors file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { BLOCK, norm, scanBlocks } from "./anchor-core.js";
import { anchorSections, _setAtomicWrite } from "./anchors.js";

/** A Section shaped exactly like `parseSection` produces. */
const section = (id: string, file: string, body: string) => ({
  id,
  label: id,
  summary: "summary",
  nav: id,
  peek: "",
  body,
  file,
});

/** A throwaway instance directory removed when the test finishes. */
const instance = (t: { after: (fn: () => void) => void }): string => {
  const dir = mkdtempSync(join(tmpdir(), "p1d-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** Seed a committed anchors file and read it back. */
const anchors = (dir: string): unknown =>
  JSON.parse(readFileSync(join(dir, "anchors.json"), "utf8"));

const readState = <T>(dir: string): T => anchors(dir) as T;

const anchorErrorMessage = (dir: string, suffix: string): string => {
  const label = relative(process.cwd(), join(dir, "anchors.json")).split("\\").join("/");
  return `${label}: ${suffix}`;
};

const firstBuild = (dir: string, sections: ReturnType<typeof section>[]) => {
  const result = anchorSections(dir, sections);
  const state = JSON.parse(readFileSync(join(dir, "anchors.json"), "utf8")) as Record<
    string,
    { ids: string[]; texts: string[] }
  >;
  return { result, state, sections };
};

test("norm collapses JavaScript whitespace and trims ends", () => {
  assert.equal(norm("  a \t b\n c\u00a0 d  "), "a b c d");
  assert.equal(norm("\t\n\r\f\v"), "");
  assert.equal(norm("no-change"), "no-change");
});

test("scanner returns all exact block tags with canonical names and UTF-16 offsets", () => {
  const inner = [
    "p1", "li1", "h2a", "h3a", "h4a", "td1", "th1", "pre1", "bq1",
    "cap1", "dd1", "dt1",
  ];
  const frag =
    "<p>p1</p><li>li1</li><h2>h2a</h2><h3>h3a</h3><h4>h4a</h4>" +
    "<td>td1</td><th>th1</th><pre>pre1</pre><blockquote>bq1</blockquote>" +
    "<figcaption>cap1</figcaption><dd>dd1</dd><dt>dt1</dt>" +
    "<picture>not a paragraph</picture>";
  const blocks = scanBlocks(frag);
  assert.equal(blocks.length, BLOCK.length);
  assert.equal(blocks.length, 12);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    assert.equal(b.tag, BLOCK[i]);
    assert.equal(b.text, inner[i]);
    const openTag = `<${BLOCK[i]}>`;
    const closeTag = `</${BLOCK[i]}>`;
    assert.equal(frag.slice(b.openStart, b.openEnd), openTag);
    assert.equal(b.openEnd, b.innerStart);
    assert.equal(frag.slice(b.innerStart, b.innerEnd), inner[i]);
    assert.equal(frag.slice(b.innerEnd, b.closeEnd), closeTag);
  }
});

test("scanner matches opening and closing tag case variants", () => {
  const a = scanBlocks("<P>alpha</p>");
  assert.equal(a.length, 1);
  assert.equal(a[0]!.tag, "p");
  assert.equal(a[0]!.text, "alpha");
  const b = scanBlocks("<p>beta</P>");
  assert.equal(b[0]!.tag, "p");
  assert.equal(b[0]!.text, "beta");
});

test("scanner honors quoted greater-than signs and suppresses nested blocks", () => {
  const frag = '<p title="a > b" data-note="x>y">outer</p>' +
    "<blockquote><p>inner</p></blockquote>";
  const blocks = scanBlocks(frag);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.tag, "p");
  assert.equal(blocks[0]!.text, "outer");
  assert.equal(blocks[1]!.tag, "blockquote");
  assert.equal(blocks[1]!.text, "inner");
  // The first tag's `>` inside the quoted attribute must not end the tag.
  assert.equal(frag.slice(blocks[0]!.openStart, blocks[0]!.openEnd).endsWith('">'), true);
});

test("scanner skips blocks whose normalized text is empty", () => {
  assert.deepEqual(
    scanBlocks("<p></p><p> <!-- x --> <b></b> </p><p>kept</p>").map((b) => b.text),
    ["kept"],
  );
});

test("scanner ignores complete comments and their tag-looking contents", () => {
  const frag = "<p>a<!-- <p>fake</p> &amp; nonsense -->b</p>";
  const blocks = scanBlocks(frag);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.tag, "p");
  assert.equal(blocks[0]!.text, "ab");
  // A comment outside any block contributes no block and hides its tags.
  const outer = "before<!-- <h2>hidden</h2> --><p>visible</p>";
  const seen = scanBlocks(outer);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.text, "visible");
});

test("scanner rejects an unterminated comment at its exact offset", () => {
  assert.throws(
    () => scanBlocks("<p>a<!-- x"),
    { message: "anchor scan at 4: unterminated HTML comment" },
  );
  // Even outside any candidate block.
  assert.throws(
    () => scanBlocks("plain text <!-- never closed"),
    { message: "anchor scan at 11: unterminated HTML comment" },
  );
});

test("scanner treats script and style as opaque raw text", () => {
  const script =
    "<p>a<SCRIPT>if (a < b) { x = \"</p>\"; } &amp; not an entity</script>b</p>";
  assert.deepEqual(
    scanBlocks(script).map((b) => b.text),
    ["ab"],
  );
  const style = '<p>x<style>.a::after{content:"</p>"}</style>y</p>';
  assert.deepEqual(
    scanBlocks(style).map((b) => b.text),
    ["xy"],
  );
  // Closing-tag matching for raw text is ASCII case-insensitive.
  assert.deepEqual(scanBlocks("<p>a<script>x</SCRIPT>b</p>").map((b) => b.text), ["ab"]);
  assert.deepEqual(scanBlocks("<p>x<STYLE>y</Style>z</p>").map((b) => b.text), ["xz"]);
  // An unclosed element is an error.
  assert.throws(
    () => scanBlocks("<p>a<style>opaque"),
    { message: "anchor scan at 4: unclosed raw-text element style" },
  );
});

test("character references decode the exact named set and preserve bare ampersands", () => {
  const frag =
    "<p>A & B &amp;&amp; B &gt; &lt; &quot; &apos; &amp; &rarr; &harr; " +
    "&mdash; &ndash; a&nbsp;b &;</p>";
  const blocks = scanBlocks(frag);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.text, "A & B && B > < \" ' & → ↔ — – a b &;");
  // Bare ampersands in isolation survive untouched.
  assert.equal(scanBlocks("<p>A & B</p>")[0]!.text, "A & B");
  assert.equal(scanBlocks("<p>A && B</p>")[0]!.text, "A && B");
  // `&;` stays two literal characters.
  assert.equal(scanBlocks("<p>&;</p>")[0]!.text, "&;");
});

test("named character references require semicolons and lowercase allowed names", () => {
  assert.throws(
    () => scanBlocks("<p>&amp</p>"),
    { message: 'anchor scan at 3: named character reference is missing ";"' },
  );
  assert.throws(
    () => scanBlocks("<p>&AMP;</p>"),
    { message: 'anchor scan at 3: unknown named character reference "AMP"' },
  );
  assert.throws(
    () => scanBlocks("<p>&frobnicate;</p>"),
    { message: 'anchor scan at 3: unknown named character reference "frobnicate"' },
  );
});

test("numeric character references decode decimal and hexadecimal scalars", () => {
  const frag = "<p>&#65;&#0101;&#x41;&#X42;&#x1F600;</p>";
  assert.equal(scanBlocks(frag)[0]!.text, "AeAB\u{1f600}");
});

test("numeric character references reject malformed syntax, missing semicolons, and nonscalars", () => {
  const malformed = ["<p>&#;</p>", "<p>&#x;</p>", "<p>&#12a;</p>", "<p>&#x1g;</p>"];
  for (const frag of malformed) {
    assert.throws(
      () => scanBlocks(frag),
      { message: "anchor scan at 3: numeric character reference is malformed" },
      frag,
    );
  }
  const missing = ["<p>&#65</p>", "<p>&#65.</p>", "<p>&#65 </p>", "<p>&#65&</p>"];
  for (const frag of missing) {
    assert.throws(
      () => scanBlocks(frag),
      { message: 'anchor scan at 3: numeric character reference is missing ";"' },
      frag,
    );
  }
  const nonscalar = ["<p>&#0;</p>", "<p>&#xD800;</p>", "<p>&#x110000;</p>"];
  for (const frag of nonscalar) {
    assert.throws(
      () => scanBlocks(frag),
      { message: "anchor scan at 3: numeric character reference is not a Unicode scalar value" },
      frag,
    );
  }
});

test("source data-aid detection is ASCII-case-insensitive and token-exact", (t) => {
  const rejected = [
    "<p data-aid>text</p>",
    '<p data-aid="">text</p>',
    "<p data-aid='x'>text</p>",
    "<p data-aid=x>text</p>",
    "<p data-aid = 'x'>text</p>",
    "<p data-aid='a' data-aid='b'>text</p>",
    "<p DATA-AID=x>text</p>",
    "<p dAtA-aId=z>text</p>",
  ];
  for (const body of rejected) {
    const dir = instance(t);
    assert.throws(
      () => anchorSections(dir, [section("a", "a.html", body)]),
      (e: Error) =>
        e.message === "a.html: anchor scan at 0: source data-aid attribute is not allowed",
    );
  }
  // Prefixed attribute names and occurrences inside values are not matches.
  for (const body of [
    '<p data-aidish="1">text</p>',
    '<p title="data-aid">text</p>',
    '<p class="x data-aid">text</p>',
  ]) {
    const dir = instance(t);
    const out = anchorSections(dir, [section("a", "a.html", body)]);
    assert.equal(out.orphans.length, 0);
  }
  // An unterminated attribute quote reports the scanner's unterminated tag.
  const dir = instance(t);
  assert.throws(
    () => anchorSections(dir, [section("a", "a.html", '<p data-aid="oops')]),
    (e: Error) => e.message === "a.html: anchor scan at 0: unterminated tag",
  );
});

test("scanner rejects self-closing, unexpected-closing, unterminated, and unclosed block markup", () => {
  assert.throws(
    () => scanBlocks("<p/>"),
    { message: "anchor scan at 0: self-closing block p" },
  );
  assert.throws(
    () => scanBlocks("<blockquote />"),
    { message: "anchor scan at 0: self-closing block blockquote" },
  );
  assert.throws(
    () => scanBlocks("</p>"),
    { message: "anchor scan at 0: unexpected closing block </p>" },
  );
  assert.throws(
    () => scanBlocks("<p>a</li>"),
    { message: "anchor scan at 4: unexpected closing block </li>" },
  );
  assert.throws(
    () => scanBlocks("<p title=\"abc"),
    { message: "anchor scan at 0: unterminated tag" },
  );
  assert.throws(
    () => scanBlocks("<p>hello"),
    { message: "anchor scan at 0: unclosed block p" },
  );
  assert.throws(
    () => scanBlocks("<li>a<ul><li>b</ul>"),
    { message: "anchor scan at 9: unclosed block li" },
  );
});

test("section ids enforce non-integer lowercase kebab-case and preserve JSON key order", (t) => {
  // Current-section ids that are invalid fail with the section filename.
  for (const bad of ["0", "01", "UPPER", "_hidden", "trailing-", "a--b"]) {
    const dir = instance(t);
    assert.throws(
      () => anchorSections(dir, [section(bad, "file.html", "<p>x</p>")]),
      (e: Error) =>
        e.message ===
        `file.html: invalid section id "${bad}"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`,
    );
  }
  // Invalid prior keys fail with the anchor-file label.
  for (const bad of ["0", "01", "UPPER", "_hidden", "trailing-"]) {
    const dir = instance(t);
    writeFileSync(
      join(dir, "anchors.json"),
      JSON.stringify({ [bad]: { ids: [], texts: [] } }),
    );
    assert.throws(
      () => anchorSections(dir, [section("a", "a.html", "<p>x</p>")]),
      (e: Error) =>
        e.message ===
        anchorErrorMessage(
          dir,
          `invalid section id "${bad}"; expected ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`,
        ),
    );
  }
  // Valid ids build and serialize in current section order.
  const dir = instance(t);
  const built = anchorSections(dir, [
    section("a1", "1.html", "<p>one</p>"),
    section("a", "2.html", "<p>two</p>"),
    section("build-order", "3.html", "<p>three</p>"),
  ]);
  assert.equal(built.orphans.length, 0);
  const state = anchors(dir) as Record<string, unknown>;
  assert.deepEqual(Object.keys(state), ["a1", "a", "build-order"]);
});

test("first build mints deterministic globally unique aids and exact JSON bytes", (t) => {
  const dir = instance(t);
  const body = "<p>Paper boats cross the quiet pond.</p><p>Paper boats cross the quiet pond.</p>";
  const built = anchorSections(dir, [section("sect", "s.html", body)]);
  const expected =
    "{\n" +
    '  "sect": {\n' +
    '    "ids": [\n' +
    '      "a8e5bf3ee",\n' +
    '      "a6c049a4c"\n' +
    "    ],\n" +
    '    "texts": [\n' +
    '      "Paper boats cross the quiet pond.",\n' +
    '      "Paper boats cross the quiet pond."\n' +
    "    ]\n" +
    "  }\n" +
    "}\n";
  assert.equal(readFileSync(join(dir, "anchors.json"), "utf8"), expected);
  const state = anchors(dir) as { sect: { ids: string[]; texts: string[] } };
  assert.deepEqual(state.sect.ids, ["a8e5bf3ee", "a6c049a4c"]);
  assert.equal(new Set(state.sect.ids).size, 2);
  for (const aid of state.sect.ids) assert.match(aid, /^a[0-9a-f]{8}$/);
  assert.deepEqual(built.report, ["    sect: 0 equal, 0 edited, 0 moved, 0 ORPHANED"]);
});

test("unchanged rebuild preserves section bodies, ids, JSON bytes, and report format", (t) => {
  const dir = instance(t);
  const markup = [
    section("intro", "1.html", "<h2>Title</h2><p class=\"x\">Body paragraph.</p>"),
    section("more", "2.html", "<p>Only one block.</p>"),
  ];
  const run1 = markup.map((s) => section(s.id, s.file, s.body));
  anchorSections(dir, run1);
  const injectedBodies = run1.map((s) => s.body);
  const firstState = readState<{
    intro: { ids: string[]; texts: string[] };
    more: { ids: string[]; texts: string[] };
  }>(dir);
  const firstJson = readFileSync(join(dir, "anchors.json"), "utf8");
  // The injection itself: exactly one `data-aid`, carrying the minted id, placed
  // immediately before the opening tag's final `>` (after existing attributes).
  assert.deepEqual(injectedBodies, [
    `<h2 data-aid="${firstState.intro.ids[0]}">Title</h2>` +
      `<p class="x" data-aid="${firstState.intro.ids[1]}">Body paragraph.</p>`,
    `<p data-aid="${firstState.more.ids[0]}">Only one block.</p>`,
  ]);

  const fresh = markup.map((s) => section(s.id, s.file, s.body));
  const second = anchorSections(dir, fresh);
  const secondJson = readFileSync(join(dir, "anchors.json"), "utf8");
  assert.equal(secondJson, firstJson);
  assert.deepEqual(fresh.map((s) => s.body), injectedBodies);
  assert.deepEqual(second.orphans, []);

  assert.equal(firstState.intro.ids.length + firstState.more.ids.length, 3);
  assert.deepEqual(second.report, [
    `    intro: ${firstState.intro.ids.length} equal, 0 edited, 0 moved, 0 ORPHANED`,
    `    more: ${firstState.more.ids.length} equal, 0 edited, 0 moved, 0 ORPHANED`,
  ]);
});

test("insert opcode mints one id without changing later ids", (t) => {
  const dir = instance(t);
  anchorSections(dir, [
    section("sect", "s.html", "<p>Alpha first.</p><p>Beta second.</p>"),
  ]);
  const before = readState<{ sect: { ids: string[]; texts: string[] } }>(dir);
  const old = before.sect.ids;

  const updated = [
    section(
      "sect",
      "s.html",
      "<p>Alpha first.</p><p>Inserted in the middle.</p><p>Beta second.</p>",
    ),
  ];
  const after = anchorSections(dir, updated);
  const state = anchors(dir) as { sect: { ids: string[]; texts: string[] } };
  assert.equal(state.sect.ids.length, 3);
  assert.equal(state.sect.ids[0], old[0]);
  assert.equal(state.sect.ids[2], old[1]);
  assert.notEqual(state.sect.ids[1], old[0]);
  assert.notEqual(state.sect.ids[1], old[1]);
  assert.deepEqual(after.report, [
    "    sect: 2 equal, 0 edited, 0 moved, 0 ORPHANED",
  ]);
});

test("replace at similarity exactly 0.6 carries the id and reports edited", (t) => {
  const dir = instance(t);
  anchorSections(dir, [section("a", "a.html", "<p>abcde</p>")]);
  const before = readState<{ a: { ids: string[]; texts: string[] } }>(dir);
  const oldId = before.a.ids[0]!;

  const after = anchorSections(dir, [section("a", "a.html", "<p>axcye</p>")]);
  const state = anchors(dir) as { a: { ids: string[]; texts: string[] } };
  assert.equal(state.a.ids[0], oldId);
  assert.deepEqual(after.report, ["    a: 0 equal, 1 edited, 0 moved, 0 ORPHANED"]);
  assert.deepEqual(after.orphans, []);
});

test("replace below 0.6 orphans the old id and mints a new id", (t) => {
  const dir = instance(t);
  anchorSections(dir, [section("a", "a.html", "<p>abcde</p>")]);
  const before = readState<{ a: { ids: string[]; texts: string[] } }>(dir);
  const oldId = before.a.ids[0]!;

  const after = anchorSections(dir, [section("a", "a.html", "<p>vwxyz</p>")]);
  const state = anchors(dir) as { a: { ids: string[]; texts: string[] } };
  assert.notEqual(state.a.ids[0], oldId);
  assert.deepEqual(after.report, ["    a: 0 equal, 0 edited, 0 moved, 1 ORPHANED"]);
  assert.deepEqual(after.orphans, [["a", oldId]]);

  // A near miss just under the floor (similarity 0.4) is still an orphan, so
  // the floor is exactly 0.6 rather than any lower value that would also
  // reject a total rewrite.
  const dir2 = instance(t);
  anchorSections(dir2, [section("a", "a.html", "<p>abcde</p>")]);
  const near = readState<{ a: { ids: string[]; texts: string[] } }>(dir2);
  const nearOld = near.a.ids[0]!;
  const nearAfter = anchorSections(dir2, [section("a", "a.html", "<p>axyze</p>")]);
  assert.notEqual((anchors(dir2) as { a: { ids: string[] } }).a.ids[0], nearOld);
  assert.deepEqual(nearAfter.orphans, [["a", nearOld]]);
});

test("delete and removed-section opcodes return orphans in prior order", (t) => {
  const dir = instance(t);
  const initial = [
    section("keep", "k.html", "<p>First stays.</p><p>Second goes.</p>"),
    section("gone", "g.html", "<p>Whole section goes.</p>"),
  ];
  firstBuild(dir, initial);
  const before = anchors(dir) as { keep: { ids: string[] }; gone: { ids: string[] } };

  const after = anchorSections(dir, [
    section("keep", "k.html", "<p>First stays.</p>"),
  ]);
  const state = anchors(dir) as { keep: { ids: string[] } };
  assert.equal(state.keep.ids.length, 1);
  assert.deepEqual(after.orphans, [
    ["keep", before.keep.ids[1]],
    ["gone", before.gone.ids[0]],
  ]);
  assert.deepEqual(after.report, [
    "    keep: 1 equal, 0 edited, 0 moved, 1 ORPHANED",
    "    gone: 0 equal, 0 edited, 0 moved, 1 ORPHANED",
  ]);
});

test("three-block reorder preserves all ids through the move pass", (t) => {
  const dir = instance(t);
  const initial = [
    section(
      "sect",
      "s.html",
      "<p>Alpha is the first block.</p><p>Beta is the second block.</p><p>Gamma is the third block.</p>",
    ),
  ];
  firstBuild(dir, initial);
  const before = anchors(dir) as { sect: { ids: string[] } };

  const after = anchorSections(dir, [
    section(
      "sect",
      "s.html",
      "<p>Gamma is the third block.</p><p>Alpha is the first block.</p><p>Beta is the second block.</p>",
    ),
  ]);
  const state = anchors(dir) as { sect: { ids: string[] } };
  assert.equal(new Set(state.sect.ids).size, 3);
  for (const id of before.sect.ids) assert.ok(state.sect.ids.includes(id));
  assert.deepEqual(after.report, [
    "    sect: 2 equal, 0 edited, 1 moved, 0 ORPHANED",
  ]);
  assert.deepEqual(after.orphans, []);
});

test("unique cross-section move preserves the id and counts the destination move", (t) => {
  const dir = instance(t);
  firstBuild(dir, [section("source", "s.html", "<p>A uniquely worded paragraph.</p>")]);
  const before = anchors(dir) as { source: { ids: string[] } };

  const after = anchorSections(dir, [
    section("target", "t.html", "<p>A uniquely worded paragraph.</p>"),
  ]);
  const state = anchors(dir) as { target: { ids: string[] } };
  assert.equal(state.target.ids[0], before.source.ids[0]);
  assert.deepEqual(after.report, [
    "    target: 0 equal, 0 edited, 1 moved, 0 ORPHANED",
  ]);
  assert.deepEqual(after.orphans, []);
});

test("duplicate move candidates remain ambiguous and are not reclaimed", (t) => {
  const dir = instance(t);
  const dup = "<p>Repeated exact text.</p><p>Repeated exact text.</p>";
  firstBuild(dir, [section("old-sec", "o.html", dup)]);
  const before = anchors(dir) as { "old-sec": { ids: string[] } };

  const after = anchorSections(dir, [section("new-sec", "n.html", dup)]);
  const state = anchors(dir) as { "new-sec": { ids: string[]; texts: string[] } };
  assert.equal(new Set(state["new-sec"].ids).size, 2);
  assert.deepEqual(state["new-sec"].texts, ["Repeated exact text.", "Repeated exact text."]);
  assert.ok(!state["new-sec"].ids.includes(before["old-sec"].ids[0]!));
  assert.deepEqual(after.report, [
    "    new-sec: 0 equal, 0 edited, 0 moved, 0 ORPHANED",
    "    old-sec: 0 equal, 0 edited, 0 moved, 2 ORPHANED",
  ]);
  assert.deepEqual(after.orphans, [
    ["old-sec", before["old-sec"].ids[0]],
    ["old-sec", before["old-sec"].ids[1]],
  ]);
});

test("anchors JSON shape errors use every stable validation template", (t) => {
  const cases: Array<[string, string, string]> = [
    ["invalid JSON", "{nope", "invalid JSON"],
    ["top-level array", "[]", "expected a JSON object"],
    ["top-level null", "null", "expected a JSON object"],
    [
      "missing texts field",
      '{"a":{"ids":[]}}',
      'section "a" must contain exactly "ids" and "texts"',
    ],
    [
      "extra field",
      '{"a":{"ids":[],"texts":[],"x":1}}',
      'section "a" must contain exactly "ids" and "texts"',
    ],
    [
      "ids not strings",
      '{"a":{"ids":[1],"texts":["x"]}}',
      'section "a".ids must be an array of strings',
    ],
    [
      "texts not array",
      '{"a":{"ids":[],"texts":"x"}}',
      'section "a".texts must be an array of strings',
    ],
    [
      "texts element not string",
      '{"a":{"ids":[],"texts":[null]}}',
      'section "a".texts must be an array of strings',
    ],
    [
      "length mismatch",
      '{"a":{"ids":["a11111111"],"texts":[]}}',
      'section "a" has different ids/texts lengths',
    ],
    [
      "invalid aid pattern",
      '{"a":{"ids":["bad"],"texts":["x"]}}',
      'section "a" has invalid aid at ids[0]',
    ],
    [
      "duplicate aid",
      '{"a":{"ids":["a11111111"],"texts":["x"]},"b":{"ids":["a11111111"],"texts":["y"]}}',
      'duplicate aid "a11111111"',
    ],
    [
      "non-normalised text",
      '{"a":{"ids":["a11111111"],"texts":["  x  "]}}',
      'section "a" has invalid normalized text at texts[0]',
    ],
    [
      "empty text",
      '{"a":{"ids":["a11111111"],"texts":[""]}}',
      'section "a" has invalid normalized text at texts[0]',
    ],
  ];
  for (const [name, raw, suffix] of cases) {
    const dir = instance(t);
    writeFileSync(join(dir, "anchors.json"), raw);
    assert.throws(
      () => anchorSections(dir, [section("a", "a.html", "<p>hello</p>")]),
      (e: Error) => e.message === anchorErrorMessage(dir, suffix),
      name,
    );
  }
});

test("invalid anchors read or scanner input throws BuildError without mutation or overwrite", (t) => {
  // A directory where anchors.json should be is a read failure.
  const readDir = instance(t);
  mkdirSync(join(readDir, "anchors.json"));
  const readSections = [section("a", "a.html", "<p>x</p>")];
  assert.throws(
    () => anchorSections(readDir, readSections),
    (e: Error) => e.message === anchorErrorMessage(readDir, "read failed (EISDIR)"),
  );
  assert.equal(readSections[0]!.body, "<p>x</p>");

  // Malformed section markup after a valid prior file leaves everything intact.
  const dir = instance(t);
  firstBuild(dir, [section("a", "a.html", "<p>good</p>")]);
  const goodBytes = readFileSync(join(dir, "anchors.json"), "utf8");
  const broken = [section("a", "a.html", "<p>never closed")];
  assert.throws(
    () => anchorSections(dir, broken),
    (e: Error) => e.message === "a.html: anchor scan at 0: unclosed block p",
  );
  assert.equal(broken[0]!.body, "<p>never closed");
  assert.equal(readFileSync(join(dir, "anchors.json"), "utf8"), goodBytes);

  // A source data-aid attribute also fails without overwriting prior state.
  const dir2 = instance(t);
  firstBuild(dir2, [section("a", "a.html", "<p>good</p>")]);
  const goodBytes2 = readFileSync(join(dir2, "anchors.json"), "utf8");
  const withAid = [section("a", "a.html", '<p data-aid="x">y</p>')];
  assert.throws(
    () => anchorSections(dir2, withAid),
    (e: Error) =>
      e.message === "a.html: anchor scan at 0: source data-aid attribute is not allowed",
  );
  assert.equal(withAid[0]!.body, '<p data-aid="x">y</p>');
  assert.equal(readFileSync(join(dir2, "anchors.json"), "utf8"), goodBytes2);
});

test("temporary-write or replace failure throws BuildError without partial section mutation", (t) => {
  const dir = instance(t);
  firstBuild(dir, [section("a", "a.html", "<p>unchanged</p>")]);
  const priorBytes = readFileSync(join(dir, "anchors.json"), "utf8");

  const mutate = [section("a", "a.html", "<p>brand new content</p>")];

  // Force the temporary-file write to fail.
  _setAtomicWrite({
    writeFileSync(): void {
      const err = new Error("disk full") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    },
  });
  try {
    assert.throws(
      () => anchorSections(dir, mutate),
      (e: Error) => e.message === anchorErrorMessage(dir, "temporary write failed (EACCES)"),
    );
    assert.equal(mutate[0]!.body, "<p>brand new content</p>");
    assert.equal(readFileSync(join(dir, "anchors.json"), "utf8"), priorBytes);

    // Force the atomic rename to fail; the write itself now succeeds.
    _setAtomicWrite({
      renameSync(): void {
        const err = new Error("busy") as NodeJS.ErrnoException;
        err.code = "EBUSY";
        throw err;
      },
    });
    assert.throws(
      () => anchorSections(dir, mutate),
      (e: Error) => e.message === anchorErrorMessage(dir, "replace failed (EBUSY)"),
    );
    assert.equal(mutate[0]!.body, "<p>brand new content</p>");
    assert.equal(readFileSync(join(dir, "anchors.json"), "utf8"), priorBytes);
  } finally {
    _setAtomicWrite({});
  }
});
