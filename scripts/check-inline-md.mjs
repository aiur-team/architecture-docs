#!/usr/bin/env node
/**
 * Prove that the browser copy of the three-mark inline converter is
 * byte-for-byte behaviorally identical to the canonical builder converter for
 * every committed conformance row.
 *
 * P2-D owns `templates/docbuild/src/inline_md.ts` and the 12-row fixture.
 * P4-B carries the same algorithm into `templates/base/edit.js` as four private
 * top-level declarations so the dependency-free page can render and edit
 * pending text. Two copies of one algorithm drift silently; this check turns
 * that drift into a deterministic CI failure.
 *
 * Deliberately absent: a normaliser twin. P1-D publishes one compiled `norm()`
 * that both the builder and `window.doc.anchor.norm` execute, so there is no
 * second implementation to compare and no `scripts/check-normalise.mjs`.
 *
 * The check adds no dependency. It parses the browser module with the
 * repository's already-pinned TypeScript compiler, evaluates only the exact
 * source bytes of the four declarations inside a fresh `node:vm` context with
 * code generation disabled, and never executes the rest of `edit.js`.
 *
 * Output contract: exactly one success line on stdout and exit 0, or exactly
 * one `FAIL inline converter parity:` line on stderr and exit 1 (exit 2 for an
 * invalid command line). A failure line never carries source text, fixture
 * values, a stack, or an absolute path — the fixture row number and direction
 * are the whole public vocabulary.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

/** The repository root, derived from this file's own location. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const CANONICAL_FIXTURE = join(ROOT, "templates", "fixtures", "inline.json");
const DEFAULT_CLIENT = join(ROOT, "templates", "base", "edit.js");
const BUILDER_MODULE = join(ROOT, "templates", "docbuild", "dist", "inline_md.js");
const TYPESCRIPT_HOST = join(ROOT, "templates", "docbuild", "package.json");

/** The exact P2-D row count. A fixture of any other length is drift. */
const EXPECTED_ROWS = 12;

/** The exact own keys of a fixture row, in order. */
const ROW_KEYS = ["md", "html"];

/**
 * The four private top-level declarations P4-B must keep in `edit.js`, in
 * reporting order. They are a test seam inside one browser module, not a new
 * global or public API.
 */
const CONVERTERS = ["untag", "wrap", "toMd", "toHtml"];

/**
 * The only free identifiers a converter declaration may reference besides the
 * other three: ECMAScript primitives. Every host surface — DOM, storage,
 * network, locale, timers, Node — is absent, and so are `eval` and `Function`.
 */
const ALLOWED_GLOBALS = new Set([
  "String",
  "Number",
  "Boolean",
  "Object",
  "Array",
  "Math",
  "JSON",
  "RegExp",
  "Symbol",
  "BigInt",
  "undefined",
  "NaN",
  "Infinity",
]);

/**
 * Member names that reach past string arithmetic: locale-sensitive operations
 * (which make output depend on the runtime's locale) and the prototype
 * plumbing a sandbox escape would climb.
 */
const FORBIDDEN_MEMBERS = new Set([
  "localeCompare",
  "toLocaleString",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "constructor",
  "prototype",
  "__proto__",
]);

/** A checked failure carrying the exact public reason line. */
class ParityError extends Error {}

/** Fail the check with one public reason. */
function fail(reason) {
  throw new ParityError(reason);
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

/**
 * The argument grammar is closed: either no arguments, or `--fixture` and
 * `--client` exactly once each with a usable path. Anything else exits 2
 * before a single byte of fixture or source is read.
 */
function parseArguments(argv) {
  if (argv.length === 0) {
    return { fixture: CANONICAL_FIXTURE, client: DEFAULT_CLIENT };
  }
  if (argv.length !== 4) return null;

  const selected = { fixture: null, client: null };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (option !== "--fixture" && option !== "--client") return null;
    const key = option.slice(2);
    if (selected[key] !== null) return null;
    const value = resolveArgumentPath(argv[index + 1]);
    if (value === null) return null;
    selected[key] = value;
  }
  if (selected.fixture === null || selected.client === null) return null;
  return selected;
}

/**
 * Accept an absolute path, or a repository-root-relative path that stays
 * inside the repository. A relative path is resolved against ROOT, never
 * against `process.cwd()`, so the check reads the same files from any cwd.
 */
function resolveArgumentPath(value) {
  if (typeof value !== "string" || value === "" || value.includes("\0")) return null;
  if (isAbsolute(value)) return value;
  const segments = value.split(/[/\\]/);
  if (segments.some((segment) => segment === "..")) return null;
  const resolved = resolve(ROOT, value);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** Read and shape-check one fixture file. `label` names it in failures. */
function loadFixture(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`${label} is unreadable`);
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }

  if (!Array.isArray(rows)) fail(`${label} is not a JSON array`);
  if (rows.length !== EXPECTED_ROWS) {
    fail(`${label} has ${rows.length} rows, expected ${EXPECTED_ROWS}`);
  }

  const seen = new Map();
  rows.forEach((row, index) => {
    const number = index + 1;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      fail(`${label} row ${number} is not an object`);
    }
    const keys = Object.keys(row);
    if (keys.length !== ROW_KEYS.length || keys.some((key, at) => key !== ROW_KEYS[at])) {
      fail(`${label} row ${number} does not have exactly the md and html keys`);
    }
    for (const key of ROW_KEYS) {
      if (typeof row[key] !== "string") fail(`${label} row ${number} ${key} is not a string`);
    }
    const identity = JSON.stringify([row.md, row.html]);
    const earlier = seen.get(identity);
    if (earlier !== undefined) fail(`${label} row ${number} duplicates row ${earlier}`);
    seen.set(identity, number);
  });

  return rows;
}

/**
 * Compare the selected fixture to the committed canonical one field by field.
 * Running this before either converter is what makes a missing, added,
 * reordered, duplicated, or altered row fail even when the altered pair happens
 * to round-trip through both copies.
 */
function requireCanonicalRows(selected, canonical) {
  for (let index = 0; index < canonical.length; index += 1) {
    for (const key of ROW_KEYS) {
      if (selected[index][key] !== canonical[index][key]) {
        fail(`row ${index + 1} ${key} mismatch`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Browser converter extraction
// ---------------------------------------------------------------------------

/** Load the TypeScript compiler the repository already pins for the builder. */
function loadTypeScript() {
  try {
    return createRequire(pathToFileURL(TYPESCRIPT_HOST))("typescript");
  } catch {
    return fail("the pinned TypeScript compiler is unavailable");
  }
}

/**
 * Parse the browser module and return the exact source bytes of the four
 * converter declarations. The rest of the file is never evaluated, and a form
 * too dynamic to extract safely fails closed rather than being reached by
 * importing the whole module.
 */
function extractConverterSources(ts, path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail("client source is unreadable");
  }

  const source = ts.createSourceFile(
    "client.js",
    text,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.JS,
  );

  const diagnostics = source.parseDiagnostics;
  if (!Array.isArray(diagnostics)) fail("client source diagnostics are unavailable");
  if (diagnostics.length > 0) fail("client source does not parse");

  const found = new Map();
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    const name = statement.name.text;
    if (!CONVERTERS.includes(name)) continue;
    if (found.has(name)) fail(`duplicate ${name} declaration`);
    found.set(name, statement);
  }

  for (const name of CONVERTERS) {
    if (!found.has(name)) fail(`missing ${name} declaration`);
  }

  const sources = [];
  for (const name of CONVERTERS) {
    const declaration = found.get(name);
    const isAsync = (declaration.modifiers ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    );
    if (isAsync || declaration.asteriskToken !== undefined) {
      fail(`${name} declaration is async or a generator`);
    }
    if (declaration.body === undefined) fail(`${name} declaration has no body`);
    requireClosedDeclaration(ts, declaration, name);
    sources.push(text.slice(declaration.getStart(source), declaration.getEnd()));
  }
  return sources;
}

/**
 * Require that a declaration is closed over nothing but the other three
 * converters and ECMAScript primitives, and that it uses no escape hatch.
 *
 * Bound names are over-collected on purpose: a local that shadows a global name
 * can only reach the local, so treating every declared name in the function as
 * bound can admit a harmless shadow but never hides a real free reference.
 */
function requireClosedDeclaration(ts, declaration, name) {
  const bound = new Set([name]);
  const references = [];

  const collectBindings = (node) => {
    if (node === undefined) return;
    if (ts.isIdentifier(node)) {
      bound.add(node.text);
      return;
    }
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      for (const element of node.elements) {
        if (ts.isBindingElement(element)) collectBindings(element.name);
      }
    }
  };

  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
      case ts.SyntaxKind.ImportEqualsDeclaration:
      case ts.SyntaxKind.ExportDeclaration:
      case ts.SyntaxKind.ExportAssignment:
      case ts.SyntaxKind.MetaProperty:
      case ts.SyntaxKind.ThisKeyword:
      case ts.SyntaxKind.SuperKeyword:
      case ts.SyntaxKind.WithStatement:
      case ts.SyntaxKind.DebuggerStatement:
      case ts.SyntaxKind.AwaitExpression:
      case ts.SyntaxKind.YieldExpression:
        fail(`${name} declaration uses forbidden syntax`);
        break;
      default:
        break;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      fail(`${name} declaration uses forbidden syntax`);
    }

    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_MEMBERS.has(node.name.text)) {
      fail(`${name} declaration uses a forbidden member`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      FORBIDDEN_MEMBERS.has(node.argumentExpression.text)
    ) {
      fail(`${name} declaration uses a forbidden member`);
    }

    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
      collectBindings(node.name);
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node !== declaration
    ) {
      collectBindings(node.name);
    }

    if (ts.isIdentifier(node) && isReference(ts, node)) references.push(node.text);
    ts.forEachChild(node, visit);
  };

  visit(declaration);

  for (const reference of references) {
    if (bound.has(reference)) continue;
    if (CONVERTERS.includes(reference)) continue;
    if (ALLOWED_GLOBALS.has(reference)) continue;
    fail(`${name} declaration references a forbidden identifier`);
  }
}

/**
 * True when an identifier names a value being read, rather than a property
 * key, a label, or the name half of a declaration.
 */
function isReference(ts, node) {
  const parent = node.parent;
  if (parent === undefined) return true;
  switch (parent.kind) {
    case ts.SyntaxKind.PropertyAccessExpression:
    case ts.SyntaxKind.QualifiedName:
    case ts.SyntaxKind.PropertyAssignment:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.LabeledStatement:
    case ts.SyntaxKind.BreakStatement:
    case ts.SyntaxKind.ContinueStatement:
    case ts.SyntaxKind.Parameter:
    case ts.SyntaxKind.VariableDeclaration:
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
    case ts.SyntaxKind.BindingElement:
      // A shorthand `{ value }` is the one property position that also reads a
      // binding; every other name half above declares or labels rather than
      // reads.
      return parent.kind === ts.SyntaxKind.BindingElement
        ? node !== parent.name && node !== parent.propertyName
        : node !== parent.name;
    case ts.SyntaxKind.ShorthandPropertyAssignment:
      return true;
    default:
      return true;
  }
}

/**
 * Evaluate the four exact declaration slices — and nothing else from the
 * browser module — in a fresh context with code generation disabled.
 */
function instantiateClient(sources) {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  try {
    vm.runInContext(sources.join("\n"), context, {
      filename: "client-converter.js",
      timeout: 10_000,
    });
  } catch {
    fail("client converter evaluation failed");
  }
  const client = { toMd: context.toMd, toHtml: context.toHtml };
  for (const direction of ["toMd", "toHtml"]) {
    if (typeof client[direction] !== "function") fail(`client ${direction} is not callable`);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

/** Run one conversion, turning a throw into a public row-scoped failure. */
function convert(fn, input, reason) {
  try {
    return fn(input);
  } catch {
    return fail(reason);
  }
}

async function main(argv) {
  const paths = parseArguments(argv);
  if (paths === null) {
    process.stderr.write("FAIL inline converter parity: invalid arguments\n");
    return 2;
  }

  try {
    // The committed canonical fixture is the reference for everything else, so
    // it is loaded and shape-checked first even when another file is selected.
    const canonical = loadFixture(CANONICAL_FIXTURE, "canonical fixture");
    const rows =
      paths.fixture === CANONICAL_FIXTURE ? canonical : loadFixture(paths.fixture, "fixture");
    requireCanonicalRows(rows, canonical);

    let builder;
    try {
      builder = await import(pathToFileURL(BUILDER_MODULE).href);
    } catch {
      fail("the compiled builder converter is unavailable");
    }
    if (typeof builder.toMd !== "function" || typeof builder.toHtml !== "function") {
      fail("the compiled builder converter is incomplete");
    }

    // The canonical rows must describe the builder before they can judge the
    // browser copy.
    rows.forEach((row, index) => {
      const number = index + 1;
      if (convert(builder.toHtml, row.md, `row ${number} builder threw`) !== row.html) {
        fail(`row ${number} builder toHtml mismatch`);
      }
      if (convert(builder.toMd, row.html, `row ${number} builder threw`) !== row.md) {
        fail(`row ${number} builder toMd mismatch`);
      }
    });

    const ts = loadTypeScript();
    const client = instantiateClient(extractConverterSources(ts, paths.client));

    rows.forEach((row, index) => {
      const number = index + 1;
      const threw = `row ${number} client threw`;
      const clientHtml = convert(client.toHtml, row.md, threw);
      const clientMd = convert(client.toMd, row.html, threw);

      if (clientHtml !== row.html) fail(`row ${number} client toHtml mismatch`);
      if (clientMd !== row.md) fail(`row ${number} client toMd mismatch`);
      // The two direct copy-to-copy comparisons are implied by the fixture
      // equalities above once the builder has been checked against the same
      // rows. They stay because the contract names all six, and because a
      // builder that answered differently on a second call would only be
      // visible here.
      if (clientHtml !== builder.toHtml(row.md)) fail(`row ${number} toHtml drift`);
      if (clientMd !== builder.toMd(row.html)) fail(`row ${number} toMd drift`);
      if (convert(client.toMd, clientHtml, threw) !== row.md) {
        fail(`row ${number} md round trip mismatch`);
      }
      if (convert(client.toHtml, clientMd, threw) !== row.html) {
        fail(`row ${number} html round trip mismatch`);
      }
    });

    process.stdout.write(`PASS inline converter parity: ${rows.length} rows\n`);
    return 0;
  } catch (error) {
    const reason = error instanceof ParityError ? error.message : "unexpected checker failure";
    process.stderr.write(`FAIL inline converter parity: ${reason}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
