# P4-C — The converter twin check in CI

## Outcome

CI proves that the browser copy of the three-mark inline converter is byte-for-byte behaviorally compatible with the canonical builder converter for every committed conformance row, while deliberately adding no second normaliser check.

## Context

P2-D owns the canonical `toMd()`/`toHtml()` implementation and the portable fixture. P4-B must carry the same conversion into the dependency-free page so pending text can be rendered and edited. This ticket makes drift between those two converter copies a deterministic CI failure; P1-D already removed the analogous normaliser risk by publishing one shared `norm()` implementation.

## Scope

### In scope

- Create one Node 22 check that validates the fixture, loads the compiled P2-D converter, extracts P4-B's four closed browser converter declarations, and compares both directions for every row.
- Add that command to the existing repository check workflow after TypeScript compilation and before `templates/check-dist`.
- Reject malformed, empty, duplicated, reordered, extended, or non-string fixture rows before executing either converter.
- Make a mismatch identify only its public fixture row number and direction.

### Out of scope

- A normaliser twin or `scripts/check-normalise.mjs`; `window.doc.anchor.norm` and the builder already execute one compiled function.
- Changing converter behavior, adding syntax, changing `templates/fixtures/inline.json`, or editing P2-D/P4-B source.
- Installing a parser or runtime dependency. The check uses the repository's pinned TypeScript compiler and Node built-ins.
- Browser layout, edit requests, overlays, anchoring, GitHub calls, or generated HTML.

## Interface contract

Create this executable module:

```text
scripts/check-inline-md.mjs
```

It accepts only these invocations:

```text
node scripts/check-inline-md.mjs
node scripts/check-inline-md.mjs --fixture <path> --client <path>
```

The module derives the repository root from its own `import.meta.url`, never from `process.cwd()`. The no-argument form resolves `templates/fixtures/inline.json`, `templates/base/edit.js`, and `templates/docbuild/dist/inline_md.js` beneath that root. The option form requires both options exactly once, accepts an absolute path or a repository-root-relative path without `..`, and still uses the canonical compiled builder module and committed canonical fixture. An unknown, duplicate, missing, empty, escaping, or extra argument exits `2` and writes one `FAIL inline converter parity: invalid arguments` line to stderr.

Always load and validate the committed canonical fixture first. The selected fixture must be a JSON array with exactly the same 12 P2-D rows in the same order. Each row must be an ordinary JSON object with exactly own keys `md`, then `html`; both values are strings; no duplicate pair is allowed. Compare each selected `md` and `html` to the corresponding committed canonical row before converter execution, reporting the first one-based row and field mismatch. This makes a missing, added, reordered, duplicated, or altered row fail even when an altered pair happens to round-trip. The checker also asserts each canonical row is self-consistent before comparing the browser copy:

```js
builder.toHtml(row.md) === row.html;
builder.toMd(row.html) === row.md;
```

P4-B must keep these four top-level function declarations in `templates/base/edit.js`:

```js
function untag(input, tag, open, close) { /* P2-D algorithm */ }
function wrap(input, delimiter, tag) { /* P2-D algorithm */ }
function toMd(html) { /* P2-D order */ }
function toHtml(text) { /* P2-D order */ }
```

They are private browser declarations, not a new global/API. Each declaration is unique and contains no import, export, dynamic import, `eval`, `Function`, DOM, storage, network, locale, timer, Node, or free identifier other than the other three declarations and ECMAScript primitives. The checker parses `edit.js` with the pinned TypeScript compiler, requires zero parse diagnostics, finds exactly those four top-level declarations, rejects an async/generator declaration, then evaluates only their exact source slices in a fresh `node:vm` context with code generation disabled. It never executes the rest of `edit.js`.

For every canonical row, require all six equalities:

```js
client.toHtml(row.md) === row.html
client.toMd(row.html) === row.md
client.toHtml(row.md) === builder.toHtml(row.md)
client.toMd(row.html) === builder.toMd(row.html)
client.toMd(client.toHtml(row.md)) === row.md
client.toHtml(client.toMd(row.html)) === row.html
```

Success writes exactly `PASS inline converter parity: 12 rows` plus LF to stdout, writes nothing to stderr, and exits `0`. A fixture/source/parse/evaluation/equality failure writes exactly one line beginning `FAIL inline converter parity:` to stderr, writes nothing to stdout, and exits `1`; it does not print source text, fixture values, a stack, or an absolute path.

Amend `.github/workflows/check.yml` by adding exactly one step after the existing typecheck step and before `templates/check-dist`. That typecheck step's `npm --prefix templates/docbuild ci` runs the package `prepare` build and emits `dist/inline_md.js`; its following `npm --prefix templates/docbuild run check` is validation-only (`tsc --noEmit`) and must not be described or relied upon as the emitter:

```yaml
      - name: Check inline converter parity
        run: node scripts/check-inline-md.mjs
```

Do not rename the workflow, change triggers/permissions/runtime setup, or fold the check into another shell step.

## Files owned

- `scripts/check-inline-md.mjs` — **new**, created only by P4-C.
- `.github/workflows/check.yml` — **amended**, created by P1-E; P4-C may add only the one step above.

`scripts/check-normalise.mjs`, converter source, fixtures, client source, generated output, package files, and every other workflow are not owned.

## Dependencies

- **P2-D:** supplies the exact 12-row `templates/fixtures/inline.json`, canonical source `inline_md.ts`, compiled `dist/inline_md.js`, and closed converter semantics.
- **P4-B:** supplies the browser twin as the four exact private top-level declarations in `templates/base/edit.js`. The older Build Order row names P3-C because the normaliser was once duplicated; that part is superseded by P1-D's one shared function and issue #26's corrected body.
- **P1-E:** supplies `.github/workflows/check.yml` and the Node/npm setup. P4-C preserves every existing gate.

Safe parallelism is exact: the new script can be authored against a four-function public fixture while P4-B works on `edit.js`, because the files are disjoint. The workflow amendment and final parity run wait until P4-B and P2-D are integrated. Only the integration owner runs compilation/generated-output gates on the combined branch.

## Acceptance criteria

- [ ] Only the two owned paths change, and the workflow delta is exactly one named step in the required position.
- [ ] GitHub issue #26 retains the exact title `P4-C — The converter twin check in CI`, has only the canonical two-paragraph full-commit permalink body, and resolves byte-for-byte to this document.
- [ ] The default command validates the exact ordered 12-row fixture and prints the one success line.
- [ ] All six equalities run for every row against the real compiled P2-D module and the exact extracted P4-B declaration bytes.
- [ ] Missing/extra/reordered/duplicate/non-string fixture data, a missing/duplicate/async/generator converter declaration, a parse failure, a forbidden free surface, or one-direction drift fails with one redacted line and exit `1`.
- [ ] The argument grammar is closed and invalid CLI shape exits `2` without reading source.
- [ ] The checker executes no edit-module side effects and creates no network, DOM, storage, child-process, temporary-file, or generated-output state.
- [ ] No normaliser comparison or `check-normalise` file exists; P1-D's shared `norm()` remains the only normaliser.
- [ ] CI obtains `dist/inline_md.js` from the existing `npm ci`/`prepare` build, the standalone gate emits it through an explicit `npm run build`, and scrub, whitespace, TypeScript, converter parity, and byte-identical distribution checks pass.

## Test plan

Run from the repository root:

```bash
set -euo pipefail

npm --prefix templates/docbuild ci --no-audit --no-fund
npm --prefix templates/docbuild run build
npm --prefix templates/docbuild run check
node scripts/check-inline-md.mjs
```

Expected: a clean checkout installs the pinned dependencies, explicitly emits the compiled converter, and typechecks with exit `0`; the parity command prints exactly `PASS inline converter parity: 12 rows` and exits `0`.

Prove a bad fixture and a changed client fail without touching tracked files:

```bash
set -euo pipefail

P4C_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p4-c.XXXXXX")"
trap 'case "${P4C_ROOT:-}" in "${TMPDIR:-/tmp}"/p4-c.??????) find "$P4C_ROOT" -depth -delete ;; *) exit 1 ;; esac' EXIT HUP INT TERM
cp templates/fixtures/inline.json "$P4C_ROOT/inline.json"
cp templates/base/edit.js "$P4C_ROOT/edit.js"
node --input-type=module - "$P4C_ROOT/inline.json" <<'NODE'
import fs from "node:fs";
const file = process.argv[2];
const rows = JSON.parse(fs.readFileSync(file, "utf8"));
rows[0].html += " changed";
fs.writeFileSync(file, JSON.stringify(rows));
NODE
if node scripts/check-inline-md.mjs --fixture "$P4C_ROOT/inline.json" --client "$P4C_ROOT/edit.js" >"$P4C_ROOT/out" 2>"$P4C_ROOT/err"; then
  echo "bad fixture unexpectedly passed" >&2
  exit 1
fi
test ! -s "$P4C_ROOT/out"
test "$(wc -l < "$P4C_ROOT/err" | tr -d ' ')" = 1
grep -qx 'FAIL inline converter parity: row 1 html mismatch' "$P4C_ROOT/err"
sed '0,/function toHtml/{s/function toHtml/function toHTML/}' templates/base/edit.js >"$P4C_ROOT/edit.js"
if node scripts/check-inline-md.mjs --fixture templates/fixtures/inline.json --client "$P4C_ROOT/edit.js" >"$P4C_ROOT/out" 2>"$P4C_ROOT/err"; then
  echo "missing converter unexpectedly passed" >&2
  exit 1
fi
test ! -s "$P4C_ROOT/out"
grep -qx 'FAIL inline converter parity: missing toHtml declaration' "$P4C_ROOT/err"
echo 'PASS P4-C negative parity cases'
```

Expected: exactly `PASS P4-C negative parity cases`, exit `0`, and no `p4-c.*` residue. The two negative invocations each produce their exact one-line stderr and no stdout.

Run repository gates:

```bash
set -euo pipefail
: "${P4C_BASE:?set P4C_BASE to the reviewed P4-B/P2-D/P1-E predecessor commit}"
test "$(git rev-parse --verify "$P4C_BASE^{commit}")" = "$P4C_BASE"

scripts/scrub-check.sh docs/tickets/P4-C.md scripts/check-inline-md.mjs .github/workflows/check.yml
npm --prefix templates/docbuild ci --no-audit --no-fund
npm --prefix templates/docbuild run build
npm --prefix templates/docbuild run check
node scripts/check-inline-md.mjs
templates/check-dist
git diff --check "$P4C_BASE"...HEAD
git diff --check
test "$(rg -l 'check-inline-md\.mjs' .github/workflows --glob '*.yml')" = ".github/workflows/check.yml"
test ! -e scripts/check-normalise.mjs
P4C_OWNED="$({ git diff --name-only "$P4C_BASE"...HEAD; git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -vx 'docs/tickets/P4-C.md' || true)"
test "$P4C_OWNED" = $'.github/workflows/check.yml\nscripts/check-inline-md.mjs'
unset P4C_OWNED
issue_json="$(gh issue view 26 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-C.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-C — The converter twin check in CI"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-C repository and pointer gates'
```

Expected after the ticket commit is pushed and issue #26 is updated: all commands exit `0`; scrub prints no denial; install/build/typecheck succeed; parity prints its exact PASS line; `check-dist` reports byte-identical committed documents; ownership, whitespace, title, exact-body, full-SHA, and byte-equality assertions print nothing; the final line is exactly `PASS  P4-C repository and pointer gates`.

## Failure modes

- Handled: missing build output, malformed fixture JSON, fixture contract drift, parser diagnostics, declaration drift, forbidden converter dependencies, thrown conversion, one-way mismatch, and nonzero CI execution.
- Deliberately not handled: converter syntax expansion, browser editing behavior, or semantic HTML equivalence. Exact strings and the committed fixture are the entire parity boundary.
- A source form too dynamic for safe extraction fails closed; it is not executed by importing the whole browser module.

## Settled decisions

- P2-D's ordered converter and exact-string equality are authoritative; this ticket cannot replace them with Markdown or DOM serialization.
- There are exactly three marks: `code`, `strong`, and `em`; no links, rich text, or semantic equivalence.
- `norm()` has one shared implementation. A normaliser parity script is rejected.
- CI uses the existing pinned TypeScript compiler and Node built-ins; no parser/runtime dependency is added.
- Existing workflow gates and generated-output policy remain intact.

## Assumptions and open questions

- **Assumption:** P4-B retains the four closed top-level declarations named above. This is an intentional test seam inside one private browser module, not a public API.
- **Assumption:** P1-E's workflow retains `npm ci` without `--ignore-scripts`, so the package `prepare` build emits `dist/inline_md.js` before the new parity step; the standalone gate nevertheless runs `build` explicitly and does not depend on lifecycle knowledge.
- **Open questions:** none block implementation. If P4-B chooses to inline or rename the converter, amend P4-B and this ticket together before either lands; do not weaken extraction to source-text regexes.

## References

- `docs/research/00-integration-plan.md` §§3.3, 3.4, 4.6, and ruling 39 — one shared normaliser, editable round trip, corrected Phase 4 scope, and TypeScript toolchain.
- `docs/research/05-inline-editing.md` §6 and §11 — three-mark converter intent and original twin-check rationale; its Rust names and old measured count are superseded by P2-D.
- `docs/tickets/P1-D.md` — sole compiled `norm()`/scanner publication and the prohibition on a second normaliser.
- `docs/tickets/P2-D.md` — authoritative conversion algorithms, 12-row fixture, compilation, and exact equality contract.
- `docs/tickets/P4-B.md` — browser converter declarations consumed by this check.
- Node.js VM documentation, accessed 2026-09-03: https://nodejs.org/api/vm.html
- TypeScript Compiler API wiki, accessed 2026-09-03: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
