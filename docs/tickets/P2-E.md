# P2-E — history.ts and the committed history.json

## Outcome

An explicitly public-approved, complete local Git checkout refreshes canonical, review-visible history for a repo-backed Mode B document, while unapproved, shallow, Git-absent, failed-Git, and Netlify builds deterministically consume the same committed history without changing P1-B's builder call sites or ever becoming a writer for a standalone Mode A document.

## Context

P1-B creates an always-compiled `history.ts` stub and owns the hook order plus `#doc-history` embedding. This ticket replaces only that stub, makes source-only Git history a committed input, and renders the changelog as an ordinary generated section. The committed boundary keeps artifact and site HTML reproducible when Git is absent or intentionally skipped. It is the Mode B history producer only. A Mode A document is one already-built standalone HTML file with no repository build; its later promotion writer belongs to P4-R.

## Scope

### In scope

- Replace P1-B's opaque `History` alias and no-op implementation in `templates/docbuild/src/history.ts`.
- Implement concrete history types, closed-schema validation, canonical serialization, Git execution, diff parsing, history assembly, byte-budget trimming, atomic refresh, and changelog rendering.
- Generate and commit history inputs for both real documents rebuilt by `templates/check-dist`: `example/history.json` and `templates/components/history.json`.
- Preserve the exact P1-B public function names, parameters, return types, call sites, hook order, and JSON-script integration.
- Define stable contracts for P2-D's generated-section boundary, P3-D's browser consumer, and P4-R's later standalone promotion rows.
- Make the Mode B build invocation and Mode A promotion invocation mutually exclusive, and prove that a repository-free canonical promotion history is preserved byte-for-byte on P2-E's read-only fallback path.
- Refresh shared compiler and document HTML products only through repository commands after all applicable source work is integrated.

### Out of scope

- Editing `templates/docbuild/src/index.ts`, `templates/base/layout.html`, any P1-D/P2-D source, or any P3-D/P4-R implementation.
- Adding a `history` flag to `doc.json`, a network API, a GitHub API call, remote fetches, annotation events, a version picker, restore behavior, or a second history schema.
- Reading `dist/`, anchors, edit manifests, generated site output, or any repository-wide path when selecting history commits.
- Persisting section labels. Labels are mutable display text and are resolved from current source at render time.
- Adding a runtime dependency, permanent fixture, new builder command, or hand-edited compiler/HTML output.
- Supporting concurrent writers to one real `history.json`; integration and P4-R promotion serialize that file's read-modify-write boundary.
- Detecting deployment mode from Git availability, `NETLIFY`, row URLs, seven-character identifiers, or a new flag/configuration field; none can distinguish the two producers without corrupting valid history.
- Treating public-history approval as a deployment-mode discriminator. `DOCBUILD_PUBLIC_HISTORY_APPROVED` is a local public-history approval declaration only; it never turns a standalone file into Mode B or makes a build a Mode A writer.
- Migrating a Mode A standalone file into a Mode B source instance, or reconciling standalone promotion attribution with later Git history. That is a future migration ticket, not an implicit refresh behavior.

## Interface contract

### Deployment-mode and writer boundary

The invocation selects the deployment mode before `history.ts` runs; `history.ts` does not infer it from data:

- **Mode B, repo-backed:** `templates/build <instance-directory>` or `templates/build --site` invokes P1-B's existing `refresh(inst)` call while building a source instance whose `doc.json`, `sections/`, and optional `extra.css` live in a repository. P2-E is the sole writer of that instance's committed `history.json`. An explicitly approved complete local checkout may generate and atomically replace it; unapproved, Netlify, shallow, incomplete, or Git-unavailable builds only read the committed value.
- **Mode A, standalone:** the input and deploy are one already-built HTML file. The connect/export/promotion workflow operates on that standalone-file path; it has no `docbuild` run, no source-instance directory, and no P2-E call. P4-R is the sole history writer for promotion and must reject a repository/source-instance input before mutation. Storing the standalone file inside or beside an unrelated Git checkout does not change its mode.

The public signature remains exactly `refresh(inst: string): History | null`; no boolean, environment variable, `doc.json` property, URL convention, or row marker is added. Calling `refresh(inst)` is therefore the explicit assertion that the caller selected the Mode B builder workflow. `NETLIFY === "true"` selects Mode B's committed-file read path, not Mode A. Conversely, the Mode A connect/export command is the explicit assertion that the caller selected the standalone workflow, and that command must not import, invoke, shell out to, or otherwise reach `docbuild`, `refresh()`, or `history.ts`. These command/input preflights are the mode discriminator compatible with the existing signature.

There is deliberately no row-level mode heuristic. A valid Git row may have `url: ""`, and both Git and promotion identifiers occupy the same seven-lowercase-hex namespace, so neither property identifies a writer. P2-E never merges existing rows into a fresh Git result: in Mode B it regenerates the complete value from Git; on an incomplete Git attempt it returns the complete committed value unchanged. P4-R loads and validates the complete standalone value, prepends its own complete row, and serializes that Mode A value. No path combines those producer algorithms.

A Mode A-to-Mode B conversion is unsupported even when somebody has placed the standalone file, an exported `history.json`, or reconstructed source files under a Git worktree. The operator and future connect/export tool must stop before `templates/build <instance-directory>` or `templates/build --site`; P2-E has no sound way to recognize promotion rows after that boundary has been violated. A future migration ticket must choose how every retained suggester attribution maps into Git and then construct one canonical Mode B history. It must not silently merge, discard, reclassify, or let ordinary Git retention overwrite promotion rows.

P4-R reuses this schema without adding a marker. For each serialized standalone promotion it derives one stable repository-free identifier in the same seven-lowercase-hex namespace, validates the complete loaded value first, and compares the proposed identifier with **every** retained row before prepend, truncation, or write. Equality aborts the complete promotion, including equality with a row that twelve-row retention would otherwise evict; the identifier is never salted, lengthened, coalesced, retried under another value, or made unique by dropping a row. A successful promotion prepends one canonical row, sets `head` to that identifier, credits the suggester in `author`, uses the canonical UTC-millisecond promotion time, keeps `url: ""`, sorts `changed` by file, applies the same patch and whole-payload budgets, and only then retains at most twelve rows. P4-R owns its deterministic identifier derivation, promoted-change construction, atomic standalone rewrite, and exclusive-writer preflight; P2-E owns only the shared validation/consumer contract stated here.

### Consumed P1-B imports

`templates/docbuild/src/history.ts` uses this exact relative import and no alternate facade:

```ts
import { BuildError, parseSection, type Section } from "./index.js";
```

P1-B supplies these exact consumed shapes:

```ts
export interface Section {
  id: string;
  label: string;
  summary: string;
  nav: string;
  peek: string;
  body: string;
  file: string;
}

export class BuildError extends Error {
  constructor(message: string);
}

export function parseSection(file: string): Section;
```

`parseSection()` receives one absolute native filesystem path to a regular current section file, reads and validates that file, and either returns all seven string fields or throws `BuildError`. P2-E does not catch and reinterpret a successful return, invent missing fields, or call it with source bytes or a relative basename. During optional fresh generation, any throw or a returned value whose `id` is not a lowercase history identifier or whose `file` is not the exact discovered basename makes `history()` return `null` for the whole attempt. The committed fallback remains independently validated and may still be used.

### Public types and closed JSON shape

Replace P1-B's opaque alias with these exact exported interfaces:

```ts
export interface HistoryChange {
  file: string;
  id: string;
  add: number;
  del: number;
  patch: string;
  clipped: boolean;
}

export interface HistoryVersion {
  sha: string;
  date: string;
  author: string;
  subject: string;
  url: string;
  changed: HistoryChange[];
}

export interface History {
  doc: string;
  head: string;
  versions: HistoryVersion[];
}
```

The persisted contract is exact:

- `doc` matches `/^[a-z0-9][a-z0-9._-]*$/` and is exactly the final path component of the normalized instance directory supplied to `refresh()`, such as `example`; it is not P1-A's permanent six-hex document ID. Validation applies both conditions and compares byte-for-byte, so `/`, `\`, `.`, `..`, an empty string, uppercase text, and the basename of another instance cannot be persisted for the current instance.
- `head` equals `versions[0].sha`.
- `versions` has one through twelve rows, newest first along first-parent history, with unique `sha` values.
- `sha` is the first seven lowercase hexadecimal characters of the full Git object ID. P4-R later uses the same seven-lowercase-hex namespace for a stable repository-free promotion identifier. A seven-character collision is never lengthened, salted, coalesced, or resolved by dropping a row: committed input with duplicate values is invalid; fresh Git generation with a collision among the retained rows returns `null` for the complete attempt and follows normal committed fallback; and P4-R must reject a promotion before any prepend, truncation, or write when its proposed identifier equals any row in the valid history it loaded, including a row that retention would otherwise remove.
- `date` is canonical four-digit-year UTC ISO 8601 with milliseconds, for example `2026-01-02T03:04:05.000Z`. For fresh Git input, compute `milliseconds = Date.parse(authorDate)`, require it to be finite, compute `canonical = new Date(milliseconds).toISOString()`, and require `canonical` to match `/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/`; otherwise the complete fresh attempt returns `null`. For committed input, require that same regular expression and require `new Date(Date.parse(value)).toISOString() === value`, which also rejects normalized impossible calendar dates. ECMAScript expanded positive years such as `+010000-...`, negative years, leap seconds, missing milliseconds, offsets, and noncanonical but parseable spellings are deliberately outside this format.
- `author` and `subject` are Git `%an` and `%s` strings. They are stored verbatim and HTML-escaped only during rendering.
- `url` is `""` or matches the complete regular expression `^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/commit/([0-9a-f]{40}|[0-9a-f]{64})$`. For a non-empty URL, apply the same post-`.git` producer grammar as `commitUrl()`: the captured owner and repository tokens are each nonempty and neither `.` nor `..`, and the captured full object ID begins with the row's exact seven-character `sha`. The two object-ID lengths are exact: 40 lowercase hexadecimal characters for SHA-1 or 64 for SHA-256. A URL whose owner/repository token is `.` or `..`, whose object ID cannot abbreviate to the row `sha`, or whose length is 41 through 63 is invalid, as are credentials, ports, query strings, fragments, trailing slashes, and alternate hosts or schemes.
- `changed` is strictly sorted by `file` with JavaScript code-unit ordering. A file appears at most once per version.
- `file` is exactly `doc.json`, exactly `extra.css`, or a safe lowercase section basename matching `/^[a-z0-9][a-z0-9._-]*\.html$/`; directory separators, uppercase characters, empty stems, and every other extension are invalid.
- `id` is a non-empty lowercase ASCII identifier matching `/^[a-z0-9][a-z0-9._-]*$/`. It is the current parsed section ID when `file` is a current section file. For deleted/renamed sections with no current mapping, `doc.json`, and `extra.css`, remove only the basename's final extension. Do not store `label`.
- `add` and `del` are non-negative safe integers counted before clipping from `+` and `-` hunk-body lines.
- `patch` is either `""` or a string whose first line begins `@@`, whose every line begins `@@`, one space, `+`, or `-`, which contains no `\r`, and which has no final LF. Lines are joined by `\n`; the complete string is at most 1,200 UTF-8 bytes and is never cut inside a Unicode code point. Validation is prefix-based by design: a clipped final line may be incomplete, but it must retain its original allowed first byte.
- `clipped` is `true` when the 1,200-byte cap removed content or `trim()` later removed an old patch body; otherwise it is `false`.

Object keys are serialized in this exact order: `doc`, `head`, `versions`; `sha`, `date`, `author`, `subject`, `url`, `changed`; `file`, `id`, `add`, `del`, `patch`, `clipped`. Unknown keys are invalid. `<instance>/history.json` is exactly `JSON.stringify(canonical, null, 2) + "\n"`: two spaces, LF line endings, one trailing LF, and no slash rewriting. A literal `</script>` therefore remains literal in the committed file.

Fresh Git history is a public-data publication, not a harmless build cache. Local generation is disabled unless `DOCBUILD_PUBLIC_HISTORY_APPROVED` is present at call time and exactly equals the parsed GitHub origin slug `<owner>/<repository>` after the producer grammar below removes one terminal `.git`. Before setting it, the operator must verify that the origin is the intended public repository and approve the retained Git author names, subjects, and deleted/current patch text for public redistribution. The value is a public slug, never a credential. An absent, whitespace-padded, malformed, mismatched, unsupported-origin, or private/unapproved value makes `history()` return `null` before section discovery, `git log`, or any diff; `refresh()` then follows the ordinary committed fallback without rewriting. This is fail-closed publication admission, not Mode A/Mode B detection. Netlify never consults it because Netlify is already read-only. Tests may set it only to an invented public fixture slug; the real repository gates require a separately supplied, reviewed slug matching the real origin.

Before returning committed data, validate the complete closed shape, scalar rules, unique/version/file ordering, `head`, per-patch cap, and canonical bytes. Validation receives the normalized instance basename expected by `refresh(inst)`. For `doc`, the sole valid value matches its lowercase predicate and equals that exact basename. For each non-empty `versions[].url`, capture owner, repository, and full object ID with the complete URL expression, reject owner or repository equal to `.` or `..`, and require `fullObjectId.slice(0, 7) === versions[].sha`; shape, token, length, and row-SHA relation failures all report the URL field's existing safe-GitHub-URL expectation. For each `changed[].file`, the sole valid values are `doc.json`, `extra.css`, or the safe lowercase HTML-basename predicate above. For each `changed[].id`, first require the lowercase identifier predicate above, then require exactly `doc` when `file === "doc.json"` and exactly `extra` when `file === "extra.css"`; any predicate-conforming identifier is allowed for an HTML file because deleted and renamed historical sources may have no current map entry. These checks apply equally to generated, committed-fallback, and P4-R-amended data. Rebuild a canonical object in the declared key order instead of trusting parse insertion order. The embedded representation is compact `JSON.stringify(canonical)` with every literal `</` replaced by `<\/`; `Buffer.byteLength(escaped, "utf8")` must be at most 16,384. P1-B performs this same replacement, so the budget measures the actual payload inside `#doc-history`.

Some properties are producer guarantees rather than reconstructable load-time facts. Fresh Git generation guarantees first-parent newest-first order and sets `clipped` only when parsing or `trim()` removed bytes; P4-R guarantees that its standalone row is prepended. The committed validator cannot reconstruct ancestry, an unclipped original patch, or wall-clock ordering, so it validates array order as persisted, checks `head === versions[0].sha`, and checks only that `clipped` is boolean. It does not sort versions by `date` or infer whether `clipped` should be true. File ordering, unique SHAs, patch grammar, and all other closed predicates remain load-time validation rules.

This invented, public-safe row demonstrates committed shape and key order. Real committed files are generated from repository history at implementation time; do not copy these values:

```json
{
  "doc": "example",
  "head": "7aaca51",
  "versions": [
    {
      "sha": "7aaca51",
      "date": "2026-09-01T17:20:00.000Z",
      "author": "Example Writer",
      "subject": "Refine the cache boundary",
      "url": "https://github.com/example/public-history-fixture/commit/7aaca51000000000000000000000000000000000",
      "changed": [
        {
          "file": "03-architecture.html",
          "id": "architecture",
          "add": 1,
          "del": 1,
          "patch": "@@ -1,3 +1,3 @@\n-old boundary\n+new boundary",
          "clipped": false
        }
      ]
    }
  ]
}
```

### Exact function signatures

The first five functions and two seam objects are module-private. Only the interfaces and P1-B's two established functions are exported:

```ts
function git(cwd: string, args: readonly string[]): string | null;
function parse_diff(
  text: string,
  pathspecs: readonly [sections: string, doc: string, css: string],
  ids: ReadonlyMap<string, string>,
): HistoryChange[];
function commitUrl(remote: string | null, fullSha: string): string;
function history(inst: string): History | null;
function trim(h: History): number;

export function refresh(inst: string): History | null;
export function changelogSection(
  h: History,
  labels: Array<[string, string]>,
): Section;
```

Use private constants `HISTORY_LIMIT = 12`, `PATCH_CAP = 1200`, and `HISTORY_BUDGET = 16 * 1024`.

Initialize the process seam once and route the sole Git spawn through it:

```ts
const historyProcess = { spawn: spawnSync };
```

Production never mutates or exports `historyProcess`. Like `historyIO` below, an isolated compiled copy may append an export for deterministic failure-oracle testing without adding a production API.

### `git()` algorithm

Call `historyProcess.spawn("git", ["--no-pager", "--literal-pathspecs", "-c", "color.ui=false", "-c", "core.quotePath=false", ...args], options)`. The global `--literal-pathspecs` option is mandatory; no pathspec component is interpreted as glob, magic, exclusion, or attribute syntax. Set `cwd`, `encoding: "utf8"`, `timeout: 20_000`, `maxBuffer: 8 * 1024 * 1024`, and `windowsHide: true`. Clone `process.env`; delete `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES`; then set `LC_ALL=C`, `LANG=C`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, and `GIT_OPTIONAL_LOCKS=0`.

Return stdout only when the spawn has no error or signal, status is exactly zero, and stdout is a string. Return `null` for an absent executable, timeout, signal, nonzero status, buffer overflow, or non-string output. Never invoke a shell, print stderr, retry, fetch, or throw from this wrapper.

### `parse_diff()` algorithm

Treat Git patch text as a deterministic state machine:

1. Validate the tuple before inspecting `text`: at runtime it is an actual array of exactly three string members. Every member is root-relative, literal `/`-separated, non-empty, contains no backslash or NUL, and has no empty, `.` or `..` component. The ordered members must share one exact instance prefix and end respectively in `/sections`, `/doc.json`, and `/extra.css`, with the repository-root forms `sections`, `doc.json`, and `extra.css` also valid. Any tuple failure returns `[]`.
2. Reject `text` containing NUL or CR. Split on LF and remove at most one final empty item caused by one terminal LF; another empty physical line is unexpected. Empty input returns `[]`.
3. A header is exactly one of two forms. The unquoted form begins `diff --git a/`, contains one exact separator ` b/`, has no ASCII whitespace in either operand, and ends after the `b/` operand. The quoted form is exactly `diff --git "<a-token>" "<b-token>"`; both operands are quoted and no suffix follows the second quote. Mixed quoting, an unescaped quote, a missing operand, another separator, or any line beginning `diff --git` that does not match one complete form rejects the patch.
4. Decode a quoted token into bytes, then decode those bytes with `new TextDecoder("utf-8", { fatal: true })`. An unescaped Unicode code point contributes its UTF-8 bytes. `\\`, `\"`, `\a`, `\b`, `\t`, `\n`, `\v`, `\f`, and `\r` contribute bytes `0x5c`, `0x22`, `0x07`, `0x08`, `0x09`, `0x0a`, `0x0b`, `0x0c`, and `0x0d`. An octal escape consumes greedily from one through three `[0-7]` digits and contributes one byte only when its numeric value is at most `0xff`; a fourth octal digit begins ordinary token text. Unknown, truncated, over-`0xff`, or invalid-UTF-8 escapes reject the complete patch.
5. Decode both operands and require their exact `a/` and `b/` prefixes. Because every invocation uses `--no-renames`, only the decoded `b/` path is authoritative for ownership; the decoded `a/` value may differ. The `b/` remainder must satisfy the same component rules as the tuple and must equal the tuple's `doc` or `css` member, or have parent exactly equal to the tuple's `sections` member and a basename matching the safe lowercase HTML predicate. Prefix siblings, descendants below `sections`, other instances, absolute/double-leading-slash paths, backslashes, and traversal-like components reject the complete patch. Store only the accepted basename.
6. Before the first hunk, allow only `index `, `new file mode `, `deleted file mode `, `old mode `, `new mode `, `similarity index `, `dissimilarity index `, exact `--- ` and `+++ ` file-marker prefixes, `Binary files `, and `GIT binary patch`. They are ignored. Any other non-header line is unexpected. A file header followed only by allowed metadata before the next header or EOF is a complete header-only change, not an incomplete patch: mode-only changes, empty-file creation/deletion, and Git binary notices finalize as `{ file, id, add: 0, del: 0, patch: "", clipped: false }`. Do not invent text or line statistics for them.
7. At the first line beginning `@@`, enter hunk-body state. Retain every line beginning `@@`, one space, `+`, or `-`; after entry, lines resembling `--- ` or `+++ ` are body deletion/addition lines and are retained and counted. Ignore only exact `\ No newline at end of file`. Any other line, including an empty physical line, rejects the complete patch. A later valid header first finalizes the current file, then begins the next.
8. Reject a second header whose authoritative decoded path was already seen anywhere in this patch. Finalize every accepted header, whether it has hunks or is a valid header-only change. For a hunk-bearing file, count retained `+` and `-` body lines before clipping; hunk headers beginning `@@` are not stats. Join retained lines with LF and no final LF.
9. Clip to the longest prefix at or below 1,200 UTF-8 bytes by iterating Unicode code points and adding a whole code point only when its encoded bytes still fit. If that prefix ends in LF, remove that terminal LF so the persisted patch still satisfies its closed grammar. Do not byte-slice and create U+FFFD. Set `id` from the exact-basename map; otherwise remove only the final extension.
10. Return encounter order; `history()` applies final lexical file sorting. Rejection is fail-closed and has one observable result, `[]`: tuple validation precedes text framing, then headers/decoding/path ownership, then per-file state/body/duplicates. Never retain a valid prefix of a later-invalid patch.

When a required Git diff is non-empty and `parse_diff()` returns `[]`, `history()` treats the complete attempted refresh as incomplete and returns `null`.

### `history()` algorithm and Git commands

Resolve the instance and repository boundary before constructing a pathspec:

1. Require `inst` to be a non-empty string. `lexicalInst = resolve(process.cwd(), inst)` is the absolute lexical instance path; `resolve()` removes trailing separators, `.` components, and `..` components. The filesystem root remains the root. `lstatSync(lexicalInst)` must report a directory and must not report a symbolic link. A symbolic link at the final instance component is not a fresh-generation boundary. Symbolic links in ancestor components are allowed because the next step canonicalizes them.
2. Set `realInst = realpathSync(lexicalInst)` and use that real absolute directory for section reads and the generated-history target. Failure of `lstatSync()` or `realpathSync()`, a missing/non-directory final component, or a final symlink makes fresh generation return `null`; fallback reads still use `join(lexicalInst, "history.json")`, which names the same target through any allowed ancestor symlink.
3. Call `git(realInst, ["rev-parse", "--show-toplevel"])`. Its stdout must be one non-empty absolute path followed by either no terminator or exactly one LF. Reject CR, NUL, leading/trailing ASCII whitespace, more than one line, a relative path, or any other suffix. Resolve that path with `realpathSync()` and require a directory.
4. Compute `relativeRoot = relative(realRoot, realInst)`. Containment succeeds exactly when `relativeRoot === ""`, or when it is non-empty, not absolute, not `".."`, and does not begin with `..${sep}`. Repository-root equality is allowed and yields root-relative pathspecs `sections`, `doc.json`, and `extra.css`. Any other relationship returns `null`; string-prefix containment is forbidden.
5. Convert only the accepted `relativeRoot` separators to literal `/`. Construct the immutable tuple as `relativeRoot === "" ? ["sections", "doc.json", "extra.css"] : [relativeRoot + "/sections", relativeRoot + "/doc.json", relativeRoot + "/extra.css"]`. The instance basename is `basename(realInst)` and must satisfy the persisted `doc` predicate.

The initial `rev-parse --show-toplevel` discovery call uses `cwd` exactly `realInst`. After `realRoot` has been canonicalized and containment proved, every other Git call—including the shallow probe, `log`, every `diff`/`diff-tree`, and `remote get-url origin`—uses `cwd` exactly `realRoot`. This makes the repository-root-relative tuple below valid for a nested instance; no command combines an instance `cwd` with repository-root-relative paths. Every history-selecting Git command receives the same three tuple strings, unchanged and in tuple order, after one literal `--`. No Git command runs at `process.cwd()` or an unvalidated parent directory. Apart from substituting object IDs and spreading the immutable tuple at `<paths>`, the exact helper-level argument arrays are:

```ts
["rev-parse", "--show-toplevel"]
["rev-parse", "--is-shallow-repository"]
["log", "-z", "--first-parent", "--max-count=12", "--format=%H%x00%P%x00%aI%x00%an%x00%s", "HEAD", "--", ...paths]
["diff", "--patch", "--unified=2", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic", firstParent, sha, "--", ...paths]
["diff-tree", "--root", "--no-commit-id", "-r", "--patch", "--unified=2", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers", "--no-indent-heuristic", sha, "--", ...paths]
["remote", "get-url", "origin"]
```

Run the second probe through `git()`:

`git(realRoot, ["rev-parse", "--is-shallow-repository"])` must return exactly `false\n` or `false`; do not trim arbitrary whitespace. `true`, empty, CRLF, multiple lines, or failure causes committed-file fallback; never generate a plausible truncated history from a shallow clone.

At this point perform the mandatory origin parse and `DOCBUILD_PUBLIC_HISTORY_APPROVED` admission step defined below. Only an admitted public slug may proceed to section discovery and `git log`; every rejection returns `null` here.

Construct one immutable, normalized pathspec tuple containing only these root-relative `/`-separated values, passed after `--` in this order and passed unchanged to every `parse_diff()` call:

1. `<instance>/sections`
2. `<instance>/doc.json`
3. `<instance>/extra.css`

Never include history, `dist/`, anchors, manifests, other document roots, or repository-wide paths. An absent `extra.css` remains a valid pathspec.

Discover current sections only under `join(realInst, "sections")`. `lstatSync()` must show that directory is a non-symlink directory, then `readdirSync(dir, { withFileTypes: true })` is sorted by entry name with JavaScript code-unit ordering. Ignore names that do not match the exact safe lowercase HTML-basename predicate, including uppercase suffixes and unsafe names. For every matching name, require both its `Dirent` and `lstatSync(join(dir, name))` to report a regular non-symbolic-link file; a matching directory, symlink, FIFO/socket/device, or type disagreement invalidates the whole fresh attempt. Call `parseSection()` once with that absolute real path. A directory read/stat error, source read/parse error, invalid returned ID, returned `file !== name`, or duplicate parsed ID across two current files invalidates the whole fresh attempt. Map exact basename to parsed ID; never parse or persist labels, and never keep a partial map. Then run:

```text
git log -z --first-parent --max-count=12 --format=%H%x00%P%x00%aI%x00%an%x00%s HEAD -- <three-pathspecs>
```

Reject any log stdout containing CR. Split stdout on NUL, require and remove exactly one final empty item, reject any additional trailing empty item, require a nonzero multiple of five fields, and group full SHA, parents, author date, author, and subject. A full SHA must be exactly 40 or 64 lowercase hexadecimal characters. `parents` is empty for a root or a single-ASCII-space-separated list of full SHAs of that same exact length; empty components, mixed lengths, tabs, leading/trailing spaces, or malformed parents invalidate the attempt. Author date uses the exact finite-`Date.parse`/`toISOString`/four-digit-year algorithm above. Author and subject must each be non-empty and contain neither NUL nor CR. Empty, expanded-year, or otherwise malformed results return `null` for the whole attempt.

For a row with parents, take the first whitespace-separated parent and run:

```text
git diff --patch --unified=2 --no-color --no-ext-diff --no-textconv --no-renames --src-prefix=a/ --dst-prefix=b/ --diff-algorithm=myers --no-indent-heuristic <parent> <sha> -- <three-pathspecs>
```

For a root row, run:

```text
git diff-tree --root --no-commit-id -r --patch --unified=2 --no-color --no-ext-diff --no-textconv --no-renames --src-prefix=a/ --dst-prefix=b/ --diff-algorithm=myers --no-indent-heuristic <sha> -- <three-pathspecs>
```

Any required diff failure or non-empty diff for which `parse_diff(text, pathspecs, ids)` returns no changes invalidates the whole attempt; never combine fresh and committed rows. Parse and lexically sort each row's changes, preserve newest-first log order, canonicalize `%aI` to UTC milliseconds, and shorten the full SHA to seven characters. Before returning, run the same closed scalar/cross-field validator used for committed data, except canonical-file-byte and whole-payload-budget checks that do not yet apply to an in-memory generated object. Thus an invalid section ID, empty author/subject, invalid date/SHA, duplicate file/SHA, non-safe generated URL, or noncanonical/CR-bearing patch makes `history()` return `null` for the complete attempt. After all retained full SHAs have been shortened, require the short values to be unique. A collision makes `history()` return `null` for the whole fresh attempt; do not extend either prefix, omit either commit, or write a new file. A structurally valid generated value that cannot fit after `trim()` is different: `refresh()` throws the documented hard budget `BuildError` rather than falling back. Committed fallback follows the ordinary Git-unavailable/incomplete path and remains subject to the same unique-value validator.

Immediately after validating the non-shallow result and before discovering/reading sections or requesting the Git log, call `git(realRoot, ["remote", "get-url", "origin"])` exactly once. Parse the result with the same closed GitHub remote grammar used by `commitUrl()`, yielding the exact `<owner>/<repo>` slug. Fresh generation is admitted only when that parse succeeds and `process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED` equals the slug byte-for-byte. A missing, malformed, unsupported, credential-bearing, private, mismatched, or unapproved origin makes `history()` return `null` before any source file, author, subject, deletion, or row diff is read, returned, or written; committed fallback then applies. This variable is an explicit operator public-history approval declaration that the destination repository and all history fields in scope have been reviewed for public publication, not a Mode A/Mode B discriminator. `commitUrl()` accepts one remote line with either no terminator or exactly one terminal LF; it rejects CR, NUL, another LF, and any leading/trailing whitespace rather than trimming. Accepted remote bodies are exactly `git@github.com:<owner>/<repo>.git`, `ssh://git@github.com/<owner>/<repo>.git`, and credential-free `https://github.com/<owner>/<repo>` with optional `.git`. Both components match `[A-Za-z0-9_.-]+`. Strip one terminal `.git`; then require both final components to remain nonempty and neither `.` nor `..` (so `.git`, `..git`, and `...git` repository tokens are invalid). Emit `https://github.com/<owner>/<repo>/commit/<full-sha>` and require the result to satisfy the closed URL predicate. Ports, scp users other than exact `git`, HTTPS credentials, query/fragment text, extra path components, invalid full SHAs, and all other forms return `""`. After admission, every generated row has the corresponding non-empty safe commit URL. Construct canonical `History`, set `doc` from the real instance basename and `head` from the first short SHA, and do not read an existing history file inside `history()`.

### `trim()` algorithm

Measure compact serialization after replacing every literal `</` with `<\/`. While its UTF-8 length exceeds 16,384, walk version indices from oldest to index `1`, never index `0`; within each row walk `changed` from index `0` upward. For each non-empty patch, set `patch = ""`, set `clipped = true`, increment the return count, and remeasure. Do not remove versions, changed rows, stats, attribution, or the newest patch. If structural data plus the preserved newest patch still exceeds the budget, throw the exact budget `BuildError` below.

### `refresh()` state machine and atomic bytes

Before reading `NETLIFY`, resolving a path, touching the filesystem, or spawning Git, require the runtime `inst` value to be a string with length greater than zero. `undefined`, `null`, `""`, numbers, arrays, and objects throw `BuildError("history: expected a non-empty instance path")`; whitespace is not special and proceeds through ordinary path resolution. This validation is identical in local and Netlify branches.

This state machine is entered only after the caller has selected Mode B by invoking the repository builder on an instance directory. It does not inspect the surrounding checkout, existing history rows, `NETLIFY`, or Git success to decide between Mode A and Mode B. A standalone-file argument is not converted into an instance path, and no Mode A connect/export/promotion path may call this function. The P4-R preflight must reject its own invocation when given a repository/source-instance input; the P2-E preflight is the reciprocal repository-builder command and source-instance input. If a caller cannot establish exactly one of those input topologies, it stops before either writer.

Set `lexicalInst = resolve(process.cwd(), inst)` once in `refresh()`, and use `join(lexicalInst, "history.json")` as the committed-fallback read path and as the normalized display-path source. Before every possible `history.json` read, call `historyIO.lstat()` on that exact path. `ENOENT` is optional absence. Any existing target must itself be a regular file and must not be a symbolic link; a directory, symlink, FIFO, socket, device, or reported type disagreement throws `<display-path>: history.json is not a regular non-symbolic-link file` without following it. Other `lstat` errors use the ordinary `cannot read history.json (<code>)` diagnostic. When local generation succeeds, independently require `lstatSync(lexicalInst)` to be a non-symlink directory and set `realInst = realpathSync(lexicalInst)` exactly as `history()` did; use `target = join(realInst, "history.json")` for the comparison check/read, temporary sibling, and rename destination. Thus an ancestor-directory symlink is allowed and the atomic file is always created beside the canonical target, never beside the symlink entry; the display path still follows the lexical caller path. A final-component instance symlink cannot reach the successful-generation write branch. Netlify and incomplete-Git fallback never create a temporary file and read only through the lexical path.

Choose the branch before any Git spawn:

- When `process.env.NETLIFY === "true"`, never call `history()` or `git()`. Check the exact lexical target with `historyIO.lstat()`, then read, validate, canonicalize, and return committed `<inst>/history.json`; return `null` only for `ENOENT`.
- Otherwise call `history(inst)`. A returned value is trimmed and atomically serialized. Check the canonical target with `historyIO.lstat()` before any comparison read. `ENOENT` means there is no prior target and proceeds to the atomic write; a valid regular non-symlink target is read as opaque bytes through `historyIO.read(target)`, while a type violation or other error throws its exact diagnostic before creating a temporary file or printing trim/status output. If the bytes equal the target, do not rewrite it. If `history()` returns `null`, check and read committed history through the exact lexical path in the same way; return `null` only for `ENOENT`.

An invalid fallback is a build error. In the established Mode B workflow, a complete successful Git refresh may replace an invalid older file because its comparison read treats the old bytes as opaque and does not validate them. That replacement authority never applies to Mode A data: reaching this branch with a standalone promotion history means the unsupported Mode A-to-Mode B preflight was bypassed, and the workflow must have stopped before calling P2-E. There is no automatic cross-mode merge, preservation heuristic, or promotion-row detector inside `refresh()`. Write changed Mode B bytes to the exact sibling shape `<history-path>.tmp-<pid>-<12-lowercase-hex>`, opened with `openSync(temp, "wx", 0o644)`. Write all bytes, `fsyncSync()`, close, and `renameSync()` over the target. On failure, close when necessary and remove only that exact temporary path; never delete or truncate the target first. Cleanup failure must not replace the primary error.

Normalize reported paths to `/` separators relative to `process.cwd()` when inside it, otherwise use normalized absolute paths. A successful call or an absence fallback emits exactly one return-status line. `trim()` always returns an integer count, but `refresh()` emits no trim line when that count is zero. When serialized bytes equal the target, emit only `UNCHANGED` and suppress any buffered trim message even when the count is positive: fresh generation may reconstruct old patch bodies that canonical trimming removes again before equality is known. When serialized bytes differ and the count is positive, buffer the trim message until the atomic replacement succeeds, then emit the trim line immediately followed by `WROTE`; if create/write/sync/close/replace later fails, emit neither line and throw the primary `BuildError`. No helper prints anything else:

```text
  history          WROTE <path>
  history          UNCHANGED <path>
  history          SKIPPED git unavailable or incomplete; using <path>
  history          SKIPPED git unavailable or incomplete; no committed history.json
  history          SKIPPED refresh on Netlify; using <path>
  history          SKIPPED refresh on Netlify; no committed history.json
  history trim     dropped <n> old diff bodies
```

The same commit and source bytes must reproduce history and HTML bytes across locale, time zone, cwd, and mtime. `UNCHANGED` preserves the history file's existing mtime.

Keep the atomic filesystem calls behind this exact module-private, unexported object, initialized once from the named `node:fs` functions:

```ts
const historyIO = {
  lstat: lstatSync,
  read: readFileSync,
  open: openSync,
  write: writeFileSync,
  sync: fsyncSync,
  close: closeSync,
  replace: renameSync,
  remove: unlinkSync,
};
```

The production module never mutates or exports `historyIO`; `refresh()` uses `lstat` before and `read` for every `history.json` read, and the other six methods only for its sibling temporary-file transaction. The disposable test appends an export to an isolated compiled copy and replaces one method at a time, which provides deterministic lstat/comparison-read/write/sync/close/replace failures without permissions, global monkey-patching, environment switches, or a production test API.

### `changelogSection()` and downstream shape

Return this structural `Section`:

```ts
{
  id: "changelog",
  label: "Changelog",
  nav: "Changes",
  summary: `${count} ${count === 1 ? "version" : "versions"}. Latest: ${escapedSubject}.`,
  peek,
  body,
  file: "history.json",
}
```

The exact `history.json` sentinel is generated/read-only. P2-D considers only safe lowercase `*.html` basenames resolving to existing regular non-symlink files under `<inst>/sections`; it skips this sentinel without edit attributes, `data-md`, a manifest row, or an error even after P1-D anchored the changelog.

Escape element text in order `&`, `<`, `>`. Escape attributes the same way plus `"` as `&quot;` and `'` as `&#39;`. Construct `peek` and `body` without incidental whitespace using these exact element trees and token order:

- `peek` is `<table class="tbl"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody>…</tbody></table>`. It contains the newest at most three versions, each as `<tr><td><code>SHA</code></td><td>YYYY-MM-DD</td><td>SUBJECT</td></tr>`.
- `body` concatenates every version newest first as `<details class="dx" data-sha="SHA"><summary><code>SHA</code> &nbsp;SUBJECT <span class="dx-meta">AUTHOR &middot; YYYY-MM-DD</span></summary><div class="dxb"><p>Changed: TOUCHED[COMMIT]</p>PATCHES</div></details>`.
- `TOUCHED` is `&mdash;` for an empty `changed` array. Otherwise it is the comma-space join of each change in sorted order: `<a href="#ID">LABEL</a>` when `labels` contains that exact ID, or the escaped filename without a link when it does not.
- `COMMIT` is empty when `url === ""`; otherwise it is exactly ` &middot; <a href="URL">commit on GitHub</a>`.
- `PATCHES` concatenates every change as `<h4>LABEL-OR-FILE  <span class="dx-stat">+ADD &minus;DEL</span></h4><pre class="diff">PATCHTAIL</pre>`. `PATCH` is escaped element text and `TAIL` is exactly `\n[diff clipped]` when `clipped` is true, otherwise empty.

Escape every uppercase placeholder above for its element/attribute context; the literal markup and entities remain as shown. The validated values used in attributes (`sha`, linked `id`, and `url`) already belong to closed character sets that exclude `&`, `<`, `>`, quotes, and apostrophes, so acceptance proves their exact safe placement rather than claiming unreachable attribute-escape characters. Labels, subjects, authors, filenames, and patches exercise element-text escaping. `changelogSection()` returns `summary` already escaped for element text; P1-B's `renderSection()` treats generated `Section.summary`, `peek`, and `body` as trusted pre-escaped renderer fragments and must insert this summary without a second escape pass. It then wraps the value as one `<section id="changelog">` containing one outer `details.sec`, a `sec-label`, the single-escaped `sec-sum`, the `sec-peek` table, and a `sec-body` containing the inner disclosures. The jump navigation contains one `href="#changelog"` link with text `Changes`.

Resolve each change's current label from `labels`. Link to `#<id>` only when the ID exists in that map; render an escaped filename without a link for metadata, styles, and deleted sections. Omit `commit on GitHub` when `url === ""`. Before returning any `Section`, scan `labels` left-to-right without constructing a `Map`. For each tuple, first require its ID not to be exact lowercase `changelog`, then require it not to have appeared in an earlier tuple. The reserved value throws `BuildError('history: source section id "changelog" is reserved')`; a duplicate throws `BuildError('history: duplicate source section id "<id>"')` with the validated source ID substituted literally. Only after that scan construct the lookup map. Case variants do not trigger the reserved check and remain governed by P1-B's source-ID rules. Although P1-B normally rejects duplicates before this call, `changelogSection()` independently enforces both conditions so its exported behavior is total for every declared `labels` argument.

P1-B alone owns the `#doc-history` element, compact serialization, `</` to `<\/` rewrite, and hook order: history append, P1-D anchors, P2-D editability, then render. P3-D may rely on valid embedded JSON, `head === versions[0].sha`, newest-first versions, unique seven-character identifiers, stable `changed[].id`, canonical dates, and unmatched IDs being ignorable; it must tolerate no history element when `refresh()` returns `null`. P4-R later prepends one schema-conforming standalone promotion row, credits the suggester in `author`, uses a stable seven-lowercase-hex promotion ID, UTC-millisecond date, `url: ""`, at most twelve rows, canonical ordering, and the same budgets. Before mutating its loaded value, P4-R must compare its proposed ID with every existing row and abort the promotion on equality, including equality with the oldest row when prepending would otherwise evict it; it must not overwrite, merge, salt, lengthen, or use retention to erase a collision. P4-R owns that promotion-time rejection and `history.json` amendment, not `history.ts`.

### Exact `BuildError` diagnostics

For `<code>`, use non-empty `err.code` or `UNKNOWN`. These messages are exact:

```text
<path>: cannot read history.json (<code>)
<path>: history.json is not a regular non-symbolic-link file
<path>: invalid JSON
<path>: invalid history at <json-path>: <expectation>
<path>: history.json is not canonical
<path>: embedded history is <n> bytes; maximum is 16384
<path>: cannot create temporary history.json (<code>)
<path>: cannot write temporary history.json (<code>)
<path>: cannot sync temporary history.json (<code>)
<path>: cannot close temporary history.json (<code>)
<path>: cannot replace history.json (<code>)
history: embedded history exceeds 16384 bytes after dropping every old diff body
history: expected a non-empty instance path
history: source section id "changelog" is reserved
history: duplicate source section id "<id>"
```

Use root `$`, paths such as `$.versions[0].sha`, and only these expectation phrases: `expected exactly keys <comma-separated quoted keys>`, `expected the current instance basename`, `expected a non-empty string`, `expected a canonical UTC timestamp`, `expected seven lowercase hexadecimal characters`, `expected an empty string or a safe GitHub commit URL`, `expected an array with 1 to 12 items`, `expected an array`, `expected unique values`, `expected newest version to match head`, `expected doc.json, extra.css, or a safe lowercase HTML basename`, `expected a lowercase history identifier`, `expected the identifier implied by file`, `expected strictly increasing file order`, `expected a non-negative safe integer`, `expected a boolean`, and `expected an empty string or canonical diff lines at most 1200 UTF-8 bytes`. Expand the exact-key placeholder with JSON double-quoted names separated by comma-space, for example `expected exactly keys "doc", "head", "versions"`. Use `expected a non-empty string` for either `author` or `subject`. Use `expected an empty string or canonical diff lines at most 1200 UTF-8 bytes` when `patch` is not a string, exceeds the cap, contains CR, ends in LF, is non-empty without an initial `@@`, or has any line whose prefix is outside the closed grammar.

Validate depth-first in declared key order: verify an object's exact keys first, then each property's scalar/container rule, then uniqueness/order/cross-field rules. `$.doc` uses `expected the current instance basename` for either a type/value mismatch. Each version checks the URL's complete lexical/token rules and full-object-ID relation to that already-validated row `sha` at `url`, before validating `changed`. Each change checks `file`, then `id`'s lexical predicate, then the metadata/style file-to-ID relation before `add`, `del`, `patch`, and `clipped`; after a row's changes are valid, check their strict file order and report duplicate or descending files at that row's `changed` array path. After every version is valid, check SHA uniqueness at `$.versions` and then the `head` equality rule at `$.head`. Thus the first invalid field is deterministic; in particular an invalid `$.head` token reports its seven-lowercase-hex error before the later equality check against `versions[0].sha`, a cross-mismatched URL reports at that row's `url` before any `changed` error, and a bad `changed[].file` cannot be masked by its later `id`.

Only committed-path `ENOENT` is absence. Other reads use `cannot read`; JSON syntax uses `invalid JSON`; valid shape with wrong pretty bytes uses `history.json is not canonical`; valid canonical data over the escaped compact budget uses the measured byte-count message. Every expected failure is a `BuildError`, so P1-B's CLI emits one `error: …` line without a stack trace. Never expose Git stderr, environment values, remote credentials, patch content, or temporary randomness.

## Files owned

- `templates/docbuild/src/history.ts` — **amended** from the always-compiled no-op stub created by P1-B. P2-E replaces the opaque alias and inert functions while preserving the exact two public signatures and call-site contract.
- `example/history.json` — **new committed generated input**.
- `templates/components/history.json` — **new committed generated input** because `templates/components` is a real instance rebuilt by `templates/check-dist`.

No other implementation source or committed input is owned. `docs/tickets/P2-E.md` is the specification, not an implementation path. `templates/docbuild/dist/**`, `example/dist/example.html`, and `templates/components/dist/components.html` are shared generated products: commands may refresh them after integration, but no lane hand-edits or claims exclusive ownership of them.

This boundary is mechanically enforceable and has no baseline exception. Start implementation only in a dedicated worktree where `git status --porcelain=v1 -z --untracked-files=all` emits zero bytes after the ticket documents themselves have been committed; if it is not empty, stop or create another worktree instead of recording a permissive baseline. At handoff, collect every NUL-delimited changed path from that same command and reject mechanically unless it is exactly one of the three owned paths or one of the command-generated compiler/HTML products listed above. If any source, configuration, fixture, template, research, prompt, or ticket path outside the three owned paths would need a manual edit—even for an import cleanup, formatting change, test hook, convenience refactor, or apparent one-line fix—stop without making it and report the ownership collision. Do not widen the allowlist, hide the path in a mechanical rewrite, or reinterpret generated-product permission as source ownership.

## Dependencies

### Upstream

P1-B must be integrated, not merely documented. It creates `history.ts`, imports its two functions, exports `Section`, `Section.file`, `parseSection()`, and `BuildError`, captures source `[id, label]` pairs, calls `refresh(inst)` after duplicate-ID validation, appends `changelogSection()`, serializes the same `History` into `{{HISTORY_JSON}}`, then runs P1-D and P2-D before rendering. P2-E amends only the P1-B-created stub and never reopens `index.ts` or `layout.html`.

P1-D is an integration predecessor for anchored changelog output. It may be authored separately, but final generated products include its scan over the appended changelog. P2-D source is disjoint and may be authored in parallel; its finalized source predicate skips exact `file: "history.json"` without error.

### Downstream and delivery waves

- P3-D consumes the embedded schema and changelog. It owns only `history.js`/`history.css`, never persists labels or rewrites history.
- P4-R consumes this closed schema for serialized standalone promotion, retains authorship and budgets, and does not amend or invoke `history.ts`. Its connect/export command accepts the standalone-file topology only and rejects repository/source-instance input before mutation or any attempted docbuild call.
- Mode A-to-Mode B conversion is not an integration wave. A future migration ticket must reconcile promotion attribution into Git deliberately before the first Mode B build; ordinary integration must never place a P4-R-amended value behind P2-E's Git writer and hope URL, SHA, or retention heuristics preserve it.
- P2-E source, P2-D source, and other tickets with disjoint declared paths may proceed in isolated worktrees. Generated `history.json`, real HTML, `templates/docbuild/dist/**`, `_site`, and repository gates are shared integration products and must not be generated or resolved concurrently.
- Integrate/rebase all applicable sources first. One coordination branch then compiles, refreshes both real histories, rebuilds both real documents/site output, inspects the combined generated diff, and runs all gates. Two P4-R promotion processes likewise never race on one history file.

## Acceptance criteria

- [ ] `history.ts` exports the three exact interfaces and preserves P1-B's exact public `refresh()` and `changelogSection()` signatures; all five named helper functions and both deterministic-test seam objects remain private with the specified signatures/shapes.
- [ ] The mode boundary is exclusive and command-selected: P2-E writes only during the Mode B repository-builder workflow; P4-R writes only during the Mode A standalone connect/export workflow; neither infers mode from Git, `NETLIFY`, URL, row ID, or an invented config field, and neither invokes the other writer.
- [ ] Complete non-shallow Git yields at most twelve newest-first first-parent rows from only sections, `doc.json`, and `extra.css`; a root commit is a null-tree creation diff.
- [ ] The initial root-discovery Git call runs from the canonical instance; every selecting/remote Git call thereafter runs from the canonical repository root with one unchanged repository-root-relative tuple, including nested instances.
- [ ] `parse_diff()` receives the exact current-instance pathspec tuple and independently rejects a malformed, traversal-like, nested, prefix-only, or other-instance decoded path without returning a partial subset; valid mode-only, empty-file, and binary header-only changes are retained with zero stats and an empty patch.
- [ ] Fresh Git generation performs no content-bearing diff unless the exact parsed GitHub origin slug has a matching `DOCBUILD_PUBLIC_HISTORY_APPROVED` public-history approval record; missing/mismatched/private/unapproved inputs fall back without republishing author, subject, deleted, or current source text.
- [ ] Shallow, absent, timed-out, malformed, or failed required Git returns the committed value without partial refresh; Netlify skips before spawning Git.
- [ ] Both real instances have canonical committed history with the exact instance `doc`, closed file/ID predicates, IDs but no labels, UTC-millisecond dates, empty or exact 40/64-lowercase-hex GitHub commit URLs whose producer-safe owner/repository and object-ID prefix agree with the row, lexical changed-file order, closed diff-line grammar, Unicode-safe 1,200-byte patches, and escaped compact payloads no larger than 16,384 bytes.
- [ ] Twelve-row retention drops older source commits deterministically. The exact command-array oracle proves the sole selecting tuple; representative committed `history.json` and other-document changes leave `head`, bytes, and mtime unchanged.
- [ ] `trim()` removes only non-newest patch bodies from oldest toward newest and `changed` index zero upward within a row, preserves all structural/attribution data, and throws the exact hard error if the newest-preserving payload cannot fit.
- [ ] `refresh()` lstat-checks the exact `history.json` path before every read, rejects every existing non-regular or symbolic-link target without following it, writes changed data through an exclusive sibling, syncs and renames it, never truncates the target, preserves the old target on failure, removes its exact temporary file, and leaves identical-file mtime unchanged.
- [ ] Malformed, schema-invalid, noncanonical, and canonical-over-budget committed inputs fail with exact stable `BuildError` messages; Git-unavailable states use exact `SKIPPED` lines.
- [ ] Duplicate seven-character identifiers fail committed validation and a fresh Git-prefix collision falls back without rewriting. The interface section records P4-R's later all-rows-before-retention collision obligation and canonical prepend contract, but implementing or proving that downstream behavior is not a P2-E completion gate.
- [ ] The changelog has `file: "history.json"`, the exact table/disclosure structure, current-label lookup, no broken unknown-ID links, optional commit links, element-text escaping plus exact placement of closed safe attribute values, deterministic order, and executable reserved/duplicate source-ID rejection.
- [ ] The public-safe disposable test proves root diffs, path exclusivity, retention, Unicode clipping, trim order, escaping, shallow/failure/Netlify fallback, invalid inputs, diagnostics, atomic recovery, mtime, guarded cleanup, and byte-exact read-only fallback of an invented canonical P4-R-style value in a repository-free directory.
- [ ] Both mandatory fixture families use byte-identical Node supervisor bodies: HUP/INT/TERM ownership exists before parent resolution or guarded-root creation; the worker and deletion launchers each authenticate a nonce-bearing ready message, prove the retained PID still equals its PGID, durably publish the assigned state, and receive `start` only afterward. The complete unchanged Bash suite has a 600-second worker deadline; every owned group receives bounded TERM-to-KILL, leader exit/reaping plus `close`/IPC closure, and group-disappearance proof before root deletion begins. The first direct signal preserves 129/130/143 over a later distinct terminal signal, timeout, and containment failure through final exit; natural Bash HUP/INT/TERM/KILL yields 129/130/143/137, and ordinary status 23 remains 23. Recursive probes may signal only their retained direct `ChildProcess`/current PID=PGID anchor, never an evidence-derived inner PGID; uncertainty retains remediation. The exact-source matrix proves every phase window, timeout, resistant/parent-exit descendants, deletion failures, actual write/chmod/rename/partial-`.new` evidence failures followed by mode-0600 recovery, and forced manual retention. Without a terminal signal, unproved containment or deletion exits 125; with one, its latched status remains authoritative. Either path retains the guarded root and sibling evidence when persistence is possible, prints the exact safe locator, and never reports cleanup success from an unproved state.
- [ ] The exact P2-D, P3-D, and P4-R interface obligations are documented without changing P2-E's owned source; implementation and acceptance of those downstream tickets remain their owners' gates, not P2-E's.
- [ ] The ownership audit, typecheck, builds, `templates/check-dist`, repeated-byte checks, and scrub gate pass; only owned files plus serialized command-generated products differ.

## Test plan

### Disposable public-safe history matrix

Run this exact command from the repository root after P1-B and P2-E are integrated. It uses only invented content, identity, dates, an explicit invented public-history approval, and a fake public GitHub remote. The source repository and shallow clone live below one exact temporary root. The outer Node owner installs signal handlers before resolving or creating that root; its retained launcher places the complete Bash matrix in one detached process group, while the Bash EXIT wrapper remains the cleanup-status and root/owner validation delegate. Only the Node owner performs recursive removal, after bounded TERM/KILL, launcher exit/close/IPC proof, and group-disappearance proof.

```bash
P2E_FIXTURE_FAMILY=history P2E_FIXTURE_DEADLINE_MS=600000 \
node --input-type=module --eval '
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const family = process.env.P2E_FIXTURE_FAMILY ?? "";
const deadlineText = process.env.P2E_FIXTURE_DEADLINE_MS ?? "";
const probeMode = process.env.P2E_FIXTURE_PROBE ?? "";
if (!["history", "repeat"].includes(family)
  || !/^[1-9][0-9]{3,6}$/.test(deadlineText)
  || !["", "early", "early-delete-failure", "signal", "terminal", "delete", "final", "timeout-signal",
    "timeout", "resistant", "parent-exit", "manual", "delete-failure",
    "evidence-write-failure", "evidence-chmod-failure", "evidence-rename-failure",
    "evidence-partial-failure", "missing-handshake", "overrun", "natural", "status"].includes(probeMode)
  || (probeMode !== "" && (typeof process.send !== "function"
    || !/^[0-9a-f]{32}$/.test(process.env.P2E_PROBE_NONCE ?? "")))) {
  throw new Error("invalid P2-E fixture supervisor invocation");
}
const deadlineMilliseconds = Number(deadlineText);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SIGNAL_STATUS = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGKILL: 137, SIGTERM: 143 });
const probeNonce = process.env.P2E_PROBE_NONCE ?? "";
const publish = (message) => process.send({ ...message, nonce: probeNonce });
let latchedSignalStatus = 0;
let timedOut = false;
let interruptResolve;
const interrupted = new Promise((resolve) => { interruptResolve = resolve; });
for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signalName, () => {
    if (latchedSignalStatus !== 0) return;
    latchedSignalStatus = SIGNAL_STATUS[signalName];
    process.exitCode = latchedSignalStatus;
    interruptResolve({ kind: "signal", signal: signalName });
  });
}
function finalStatus(fallback, manual = false) {
  return latchedSignalStatus || (manual ? 125 : (timedOut ? 124 : fallback));
}

const rootParent = realpathSync(family === "history" ? process.cwd() : process.env.TMPDIR || "/tmp");
const rootPrefix = family === "history" ? ".history-fixture." : "p2-e-repeat.";
const launcherSource = `
  import { spawn } from "node:child_process";
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signalName, () => {});
  const nonce = process.env.P2E_LAUNCH_NONCE ?? "";
  if (!/^[0-9a-f]{32}$/.test(nonce) || typeof process.send !== "function") process.exit(127);
  process.send({ type: "ready", nonce, pid: process.pid });
  process.once("message", (message) => {
    if (message?.type !== "start" || message?.nonce !== nonce) return process.exit(127);
    const silentProbe = (process.env.P2E_FIXTURE_PROBE ?? "") !== "";
    const child = spawn("bash", ["/dev/fd/3"], { env: process.env,
      stdio: ["ignore", silentProbe ? "ignore" : "inherit",
        silentProbe ? "ignore" : "inherit", "inherit"] });
    child.once("spawn", () => process.send({ type: "launched", nonce }));
    child.once("error", () => process.send({ type: "result", nonce, code: null,
      signal: null, spawnError: true }));
    child.once("exit", (code, signal) => process.send({ type: "result", nonce, code,
      signal, spawnError: false }));
  });
  setInterval(() => {}, 60000);
`;
const deleteLauncherSource = `
  import { spawn } from "node:child_process";
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signalName, () => {});
  const nonce = process.env.P2E_DELETE_NONCE ?? "";
  if (!/^[0-9a-f]{32}$/.test(nonce) || typeof process.send !== "function") process.exit(127);
  process.send({ type: "ready", nonce, pid: process.pid });
  process.once("message", (message) => {
    if (message?.type !== "start" || message?.nonce !== nonce) return process.exit(127);
    const source = process.argv[1] === "1"
      ? "setInterval(() => {}, 60000)"
      : "import { rmSync } from \\\"node:fs\\\"; rmSync(process.argv[1], { recursive: true, force: true })";
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source,
      process.argv[2]], { stdio: "ignore" });
    child.once("spawn", () => process.send({ type: "launched", nonce }));
    child.once("error", () => process.send({ type: "result", nonce, code: null, signal: null }));
    child.once("exit", (code, signal) => process.send({ type: "result", nonce, code, signal }));
  });
  setInterval(() => {}, 60000);
`;

function rootIsGuarded(root) {
  if (!root || root === rootParent || root.slice(0, root.lastIndexOf("/")) !== rootParent) return false;
  const name = root.slice(root.lastIndexOf("/") + 1);
  return name.startsWith(rootPrefix)
    && /^[A-Za-z0-9]{6}$/.test(name.slice(rootPrefix.length));
}
function groupAlive(groupId) {
  try { process.kill(-groupId, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
function processGroup(pid) {
  const value = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^[0-9]+$/.test(value)) throw new Error("process group unavailable");
  return Number(value);
}
function currentAnchor(leader, groupId) {
  if (!leader || leader.pid !== groupId || leader.exitCode !== null || leader.signalCode !== null) return false;
  try { process.kill(groupId, 0); return processGroup(groupId) === groupId; }
  catch { return false; }
}
function signalGroup(groupId, signalName) {
  assert.ok(Number.isSafeInteger(groupId) && groupId > 1);
  try { process.kill(-groupId, signalName); }
  catch (error) { if (error?.code !== "ESRCH") throw error; }
}
async function groupGone(groupId, milliseconds) {
  const end = Date.now() + milliseconds;
  while (groupAlive(groupId) && Date.now() < end) await pause(25);
  return !groupAlive(groupId);
}
const evidenceIO = {
  write: writeFileSync, chmod: chmodSync, replace: renameSync,
  open: openSync, sync: fsyncSync, close: closeSync,
};
function syncEvidencePath(path) {
  let descriptor;
  try {
    descriptor = evidenceIO.open(path, "r");
    evidenceIO.sync(descriptor);
  } finally {
    if (descriptor !== undefined) evidenceIO.close(descriptor);
  }
}
function persistEvidence(context, state, failure = "") {
  const pending = `${context.evidencePath}.new`;
  const bytes = `${JSON.stringify({ ...context, state })}\n`;
  const write = failure === "write" ? () => { throw new Error("injected evidence write failure"); }
    : evidenceIO.write;
  const chmod = failure === "chmod" ? () => { throw new Error("injected evidence chmod failure"); }
    : evidenceIO.chmod;
  const replace = failure === "rename" ? () => { throw new Error("injected evidence rename failure"); }
    : evidenceIO.replace;
  write(pending, failure === "partial" ? bytes.slice(0, 7) : bytes, { mode: 0o600 });
  if (failure === "partial") throw new Error("injected partial evidence write failure");
  chmod(pending, 0o600);
  syncEvidencePath(pending);
  replace(pending, context.evidencePath);
  syncEvidencePath(dirname(context.evidencePath));
}
function manualDiagnostic(context) {
  console.error(`ERROR  P2-E ${family} fixture cleanup is unproved; root=${context.root} evidence=${context.evidencePath} supervisor-pid=${context.supervisorPid} leader-pgid=${context.leaderPgid ?? "unassigned"}; manual remediation required`);
}
function removeIfPresent(path) {
  try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
const terminations = new WeakMap();
async function terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed) {
  if (terminations.has(leader)) return terminations.get(leader);
  const operation = (async () => {
    let signalFailure = false;
    if (!currentAnchor(leader, groupId)) return { complete: false, ownership: false };
    try { signalGroup(groupId, "SIGTERM"); } catch { signalFailure = true; }
    const afterTerm = await within(leaderResult, probeMode === "" ? 1000 : 100);
    if (afterTerm === null) {
      if (!currentAnchor(leader, groupId)) return { complete: false, ownership: false };
      try { signalGroup(groupId, "SIGKILL"); } catch { signalFailure = true; }
    }
    const reaped = afterTerm !== null || await within(leaderResult, 5000) !== null;
    const closed = reaped && await within(leaderClosed, 5000) !== null;
    const disappeared = closed && await groupGone(groupId, 5000);
    return { complete: probeMode !== "manual" && !signalFailure && reaped && closed && disappeared,
      ownership: true, reaped, closed, disappeared };
  })();
  terminations.set(leader, operation);
  return operation;
}
function outcomeStatus(outcome) {
  if (outcome.kind === "signal") return SIGNAL_STATUS[outcome.signal] ?? 127;
  if (outcome.kind === "deadline") return 124;
  if (outcome.kind === "result") {
    if (outcome.spawnError) return 127;
    if (outcome.signal) return SIGNAL_STATUS[outcome.signal] ?? 127;
    return Number.isSafeInteger(outcome.code) && outcome.code >= 0
      && outcome.code <= 255 && outcome.code !== 125 ? outcome.code : 127;
  }
  return 127;
}
async function removeRootBounded(root) {
  const deleteNonce = randomBytes(16).toString("hex");
  const leader = spawn(process.execPath, ["--input-type=module", "--eval",
    deleteLauncherSource, ["early-delete-failure", "delete-failure"].includes(probeMode) ? "1" : "0", root], {
      detached: true, env: { ...process.env, P2E_DELETE_NONCE: deleteNonce },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  const leaderResult = new Promise((resolve) => {
    leader.once("error", () => resolve({ code: null, signal: null }));
    leader.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const leaderClosed = new Promise((resolve) => leader.once("close", () => resolve(true)));
  let readyResolve;
  let launchResolve;
  let resultResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const launched = new Promise((resolve) => { launchResolve = resolve; });
  const childResult = new Promise((resolve) => { resultResolve = resolve; });
  leader.on("message", (message) => {
    if (message?.nonce !== deleteNonce) return;
    if (message?.type === "ready") readyResolve(message);
    if (message?.type === "launched") launchResolve(true);
    if (message?.type === "result") resultResolve(message);
  });
  const groupId = leader.pid;
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    try { leader.disconnect(); } catch {}
    return false;
  }
  let timer;
  const readyMessage = await Promise.race([
    ready,
    leaderResult.then(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); }),
  ]);
  clearTimeout(timer);
  if (readyMessage?.pid !== groupId || !currentAnchor(leader, groupId)) {
    const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { leader.disconnect(); } catch {}
    return terminal.complete && !existsSync(root);
  }
  const deletionContext = { version: 1, family, root, evidencePath: `${root}.evidence.json`,
    supervisorPid: process.pid, leaderPgid: groupId };
  try { persistEvidence(deletionContext, "deleting"); }
  catch {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    return false;
  }
  leader.send({ type: "start", nonce: deleteNonce });
  const launchOutcome = await Promise.race([
    launched,
    leaderResult.then(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
  ]);
  clearTimeout(timer);
  if (launchOutcome !== true) {
    const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { leader.disconnect(); } catch {}
    return terminal.complete && !existsSync(root);
  }
  const outcome = await Promise.race([
    childResult,
    leaderResult,
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); }),
  ]);
  clearTimeout(timer);
  const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
  try { leader.disconnect(); } catch {}
  return outcome?.type === "result" && outcome.code === 0 && outcome.signal === null
    && terminal.complete && !existsSync(root);
}

async function superviseWorker() {
  let root = "";
  let evidencePath = "";
  if (latchedSignalStatus !== 0) return latchedSignalStatus;
  try {
    root = mkdtempSync(join(rootParent, rootPrefix));
    evidencePath = `${root}.evidence.json`;
    chmodSync(root, 0o700);
    assert.equal(rootIsGuarded(root), true);
    const evidenceFailure = ({
      "evidence-write-failure": "write",
      "evidence-chmod-failure": "chmod",
      "evidence-rename-failure": "rename",
      "evidence-partial-failure": "partial",
    })[probeMode] ?? "";
    persistEvidence({ version: 1, family, root, evidencePath,
      supervisorPid: process.pid, leaderPgid: null }, "preparing", evidenceFailure);
  } catch {
    const context = { version: 1, family, root, evidencePath,
      supervisorPid: process.pid, leaderPgid: null };
    if (root !== "") {
      if (probeMode.startsWith("evidence-") && process.connected) {
        const pending = `${evidencePath}.new`;
        const pendingBytes = existsSync(pending) ? readFileSync(pending, "utf8") : "";
        publish({ type: "root", root, evidencePath });
        publish({ type: `${probeMode}-window`, pendingExists: existsSync(pending),
          partialBytes: probeMode === "evidence-partial-failure" ? pendingBytes : "" });
        await Promise.race([interrupted, pause(500)]);
      }
      try { persistEvidence(context, "manual-remediation"); } catch {}
      assert.equal(existsSync(`${evidencePath}.new`), false);
      assert.equal((statSync(evidencePath).mode & 0o777), 0o600);
      manualDiagnostic(context);
      process.exitCode = finalStatus(125, true);
      await pause(0);
      process.exitCode = finalStatus(125, true);
      if (probeMode !== "" && process.connected) process.disconnect();
      return process.exitCode;
    }
    return 127;
  }
  if (probeMode !== "") publish({ type: "root", root, evidencePath });
  if (["early", "early-delete-failure"].includes(probeMode)) {
    publish({ type: `${probeMode}-window` });
    await Promise.race([interrupted, pause(500)]);
  }
  await Promise.race([pause(0), interrupted]);
  if (latchedSignalStatus !== 0) {
    const removed = await removeRootBounded(root);
    if (removed) removeIfPresent(evidencePath);
    else {
      const context = { version: 1, family, root, evidencePath,
        supervisorPid: process.pid, leaderPgid: null };
      try { persistEvidence(context, "manual-remediation"); } catch {}
      manualDiagnostic(context);
    }
    process.exitCode = finalStatus(0, !removed);
    await pause(0);
    process.exitCode = finalStatus(0, !removed);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }

  const childEnvironment = {
    ...process.env,
    P2E_FIXTURE_ROOT: root,
    P2E_FIXTURE_PARENT: rootParent,
    P2E_GROUP_OWNER_NONCE: randomBytes(16).toString("hex"),
    P2E_LAUNCH_NONCE: randomBytes(16).toString("hex"),
  };
  if (probeMode !== "natural") delete childEnvironment.P2E_FIXTURE_PROBE_SIGNAL;
  const leader = spawn(process.execPath, ["--input-type=module", "--eval", launcherSource], {
    detached: true,
    env: childEnvironment,
    stdio: ["ignore", "inherit", "inherit", "inherit", "ipc"],
  });
  const leaderResult = new Promise((resolve) => {
    leader.once("error", () => resolve({ kind: "leader-error" }));
    leader.once("exit", (code, signal) => resolve({ kind: "leader-exit", code, signal }));
  });
  const leaderClosed = new Promise((resolve) => leader.once("close", () => resolve(true)));
  let readyResolve;
  let launchResolve;
  let resultResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const launched = new Promise((resolve) => { launchResolve = resolve; });
  const workerResult = new Promise((resolve) => { resultResolve = resolve; });
  leader.on("message", (message) => {
    if (message?.nonce !== childEnvironment.P2E_LAUNCH_NONCE) return;
    if (message?.type === "ready") readyResolve(message);
    if (message?.type === "launched") launchResolve({ kind: "launched" });
    if (message?.type === "result") resultResolve({ kind: "result", code: message.code,
      signal: message.signal, spawnError: message.spawnError === true });
  });
  const groupId = leader.pid;
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    const exited = await within(leaderResult, 2000) !== null;
    const closed = exited && await within(leaderClosed, 2000) !== null;
    const removed = closed && await removeRootBounded(root);
    if (removed) removeIfPresent(evidencePath);
    else {
      const failed = { version: 1, family, root, evidencePath,
        supervisorPid: process.pid, leaderPgid: null };
      try { persistEvidence(failed, "manual-remediation"); } catch {}
      manualDiagnostic(failed);
    }
    process.exitCode = finalStatus(127, !removed);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  const context = { version: 1, family, root, evidencePath,
    supervisorPid: process.pid, leaderPgid: groupId };
  const readyMessage = await within(Promise.race([ready, leaderResult.then(() => null)]), 2000);
  if (readyMessage?.pid !== groupId || !currentAnchor(leader, groupId)) {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(125, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  try { persistEvidence(context, "running"); }
  catch {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(125, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  leader.send({ type: "start", nonce: childEnvironment.P2E_LAUNCH_NONCE });
  let deadlineTimer;
  const effectiveDeadline = ["timeout", "timeout-signal", "resistant"].includes(probeMode)
    ? 250 : deadlineMilliseconds;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ kind: "deadline" }), effectiveDeadline);
  });
  const launchOutcome = await Promise.race([launched, workerResult, leaderResult, interrupted, deadline]);
  let outcome = launchOutcome;
  if (launchOutcome.kind === "launched") {
    if (probeMode !== "" && probeMode !== "missing-handshake") {
      publish({ type: "owned", root, leaderPgid: groupId });
    }
    if (probeMode === "signal") publish({ type: "signal-window" });
    outcome = await Promise.race([workerResult, leaderResult, interrupted, deadline]);
  }
  clearTimeout(deadlineTimer);
  if (["timeout", "timeout-signal"].includes(probeMode) && outcome.kind === "deadline") {
    timedOut = true;
    if (probeMode === "timeout-signal") {
      publish({ type: "timeout-signal-window" });
      await pause(500);
    }
  }
  const status = outcomeStatus(outcome);
  process.exitCode = finalStatus(status);
  const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
  if (!terminal.complete) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    if (probeMode === "manual") {
      publish({ type: "manual-window" });
      await pause(500);
    }
    process.exitCode = finalStatus(status, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  if (probeMode === "terminal") {
    publish({ type: "terminal-window" });
    await pause(500);
  }
  if (["delete", "delete-failure"].includes(probeMode)) {
    publish({ type: `${probeMode}-window` });
    await pause(500);
  }
  const removed = rootIsGuarded(root) && await removeRootBounded(root);
  if (!removed) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(status, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  if (probeMode === "final") {
    publish({ type: "final-window" });
    await pause(500);
  }
  let evidenceRemoved = true;
  try { removeIfPresent(evidencePath); } catch { evidenceRemoved = false; }
  if (!evidenceRemoved) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
  }
  await pause(0);
  process.exitCode = finalStatus(status, !evidenceRemoved);
  if (probeMode === "" && family === "repeat" && process.exitCode === 0) {
    console.log("PASS  P2-E repeat fixture cleaned");
  }
  if (probeMode !== "" && process.connected) process.disconnect();
  return process.exitCode;
}

function probeScript(mode) {
  if (mode === "signal") return "while :; do sleep 1; done\n";
  if (["timeout", "timeout-signal", "overrun", "missing-handshake"].includes(mode)) {
    return "while :; do sleep 1; done\n";
  }
  if (mode === "natural") return "kill -\"$P2E_FIXTURE_PROBE_SIGNAL\" $$\n";
  if (mode === "status") return "exit 23\n";
  if (["terminal", "delete", "final", "manual", "delete-failure"].includes(mode)) return "exit 0\n";
  if (["early", "early-delete-failure"].includes(mode) || mode.startsWith("evidence-")) return "";
  if (mode === "resistant") return `
    trap "printf TERM >\\"$P2E_PROBE_TERM\\"" TERM
    node --input-type=module --eval "import { writeFileSync } from \\"node:fs\\"; process.on(\\"SIGTERM\\", () => {}); setTimeout(() => writeFileSync(process.env.P2E_PROBE_LEAK, \\"leak\\"), 2000); setInterval(() => {}, 1000)" &
    while :; do sleep 1; done
  `;
  return "(sleep 1; printf leak >\"$P2E_PROBE_LEAK\") & exit 0\n";
}

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeProbeHandles(proof) {
  try { proof.disconnect(); } catch {}
  const drains = [proof.stdout, proof.stderr].map((stream) => new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.readableEnded) resolve();
    else { stream.once("end", resolve); stream.once("close", resolve); }
  }));
  await within(Promise.all(drains), 500);
  for (const stream of [proof.stdout, proof.stderr, proof.stdio[3]]) stream?.destroy();
}
function retainedEvidence(rootMessage) {
  const evidencePath = rootMessage?.evidencePath;
  if (!rootMessage?.root || evidencePath !== `${rootMessage.root}.evidence.json`
    || !existsSync(evidencePath)) return null;
  if ((statSync(evidencePath).mode & 0o777) !== 0o600) return null;
  try { return JSON.parse(readFileSync(evidencePath, "utf8")); }
  catch { return null; }
}
async function containProbe(proof, result, proofClosed, rootMessage, ownedMessage) {
  let outcome = null;
  if (currentAnchor(proof, proof.pid)) signalGroup(proof.pid, "SIGTERM");
  outcome = await within(result, 3000);
  if (!outcome) {
    if (currentAnchor(proof, proof.pid) && rootMessage?.root) {
      const evidence = retainedEvidence(rootMessage);
      const context = { version: 1, family, root: rootMessage.root,
        evidencePath: rootMessage.evidencePath, supervisorPid: proof.pid,
        leaderPgid: ownedMessage?.leaderPgid ?? evidence?.leaderPgid ?? null };
      let retained = false;
      try {
        persistEvidence(context, "manual-remediation");
        retained = retainedEvidence(rootMessage)?.state === "manual-remediation";
      } catch {}
      if (retained) {
        manualDiagnostic(context);
        try { proof.disconnect(); } catch {}
        for (const stream of [proof.stdout, proof.stderr, proof.stdio[3]]) stream?.destroy();
        proof.unref();
        return { outcome: null, complete: false, detached: true };
      }
      manualDiagnostic(context);
    }
    return { outcome: null, complete: false, detached: false };
  }
  const wrapperGone = outcome !== null && await groupGone(proof.pid, 3000);
  const closed = outcome !== null && await within(proofClosed, 3000) !== null;
  await closeProbeHandles(proof);
  return { outcome, complete: wrapperGone && closed };
}

async function runProbe(mode, signalName = "", laterSignalName = "") {
  const markerParent = realpathSync(process.env.TMPDIR || "/tmp");
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const leakPath = join(markerParent, `p2-e-${family}-${mode}-${suffix}.leak`);
  const termPath = join(markerParent, `p2-e-${family}-${mode}-${suffix}.term`);
  const probeAuthNonce = randomBytes(16).toString("hex");
  const environment = {
    ...process.env,
    P2E_FIXTURE_PROBE: mode,
    P2E_FIXTURE_PROBE_SIGNAL: signalName,
    P2E_PROBE_LEAK: leakPath,
    P2E_PROBE_TERM: termPath,
    P2E_PROBE_NONCE: probeAuthNonce,
  };
  const proof = spawn(process.execPath, process.execArgv, {
    detached: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe", "pipe", "ipc"],
  });
  let output = "";
  let errorOutput = "";
  proof.stdout.setEncoding("utf8");
  proof.stderr.setEncoding("utf8");
  proof.stdout.on("data", (chunk) => { output += chunk; });
  proof.stderr.on("data", (chunk) => { errorOutput += chunk; });
  proof.stdio[3].on("error", () => {});
  const spawned = new Promise((resolve) => {
    proof.once("spawn", () => resolve(true));
    proof.once("error", () => resolve(false));
  });
  const result = new Promise((resolve) => {
    proof.once("error", () => resolve({ code: 127, signal: null }));
    proof.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const proofClosed = new Promise((resolve) => proof.once("close", () => resolve(true)));
  const rootReady = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === "root") resolve(message);
    });
  });
  const owned = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === "owned") resolve(message);
    });
  });
  const phase = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === `${mode}-window`) resolve(message);
    });
  });
  assert.equal(await within(spawned, 2000), true, `${family} ${mode} probe spawn failed`);
  assert.equal(currentAnchor(proof, proof.pid), true,
    `${family} ${mode} probe lacks its retained process-group anchor`);
  proof.stdio[3].end(probeScript(mode));
  const rootMessage = await within(rootReady, 3000);
  if (!rootMessage?.root) {
    const contained = await containProbe(proof, result, proofClosed, rootMessage, null);
    assert.ok(contained.complete, `${family} ${mode} missing-root containment is unproved`);
    throw new Error(`${family} ${mode} probe did not publish its guarded root`);
  }
  assert.equal(rootIsGuarded(rootMessage.root), true);
  let ownedMessage = null;
  if (mode === "missing-handshake") {
    ownedMessage = await within(owned, 500);
    assert.equal(ownedMessage, null);
  } else if (!["early", "early-delete-failure"].includes(mode) && !mode.startsWith("evidence-")) {
    ownedMessage = await within(owned, 3000);
    if (!(ownedMessage?.leaderPgid > 1)) {
      const contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
      assert.ok(contained.complete, `${family} ${mode} missing-owner containment is unproved`);
      throw new Error(`${family} ${mode} probe did not publish positive ownership`);
    }
  }
  if (signalName !== "" && mode !== "natural") {
    const phaseMessage = await within(phase, 3000);
    assert.ok(phaseMessage, `${family} ${mode} did not expose its signal window`);
    if (mode === "evidence-partial-failure") {
      assert.equal(phaseMessage.pendingExists, true);
      assert.ok(phaseMessage.partialBytes.length > 0 && !phaseMessage.partialBytes.endsWith("\n"));
    }
    assert.equal(currentAnchor(proof, proof.pid), true);
    process.kill(proof.pid, signalName);
    if (laterSignalName !== "") {
      assert.notEqual(laterSignalName, signalName);
      await pause(25);
      assert.equal(currentAnchor(proof, proof.pid), true,
        `${family} ${mode} closed before the distinct later signal proof`);
      process.kill(proof.pid, laterSignalName);
    }
  }
  let contained = null;
  let outcome;
  if (["missing-handshake", "overrun"].includes(mode)) {
    await pause(500);
    contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
    outcome = contained.outcome;
  } else {
    outcome = await within(result, 12000);
    if (!outcome) {
      contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
      outcome = contained.outcome;
    } else {
      const wrapperGone = await groupGone(proof.pid, 3000);
      const closed = await within(proofClosed, 3000) !== null;
      await closeProbeHandles(proof);
      contained = { complete: wrapperGone && closed };
    }
  }
  assert.ok(contained.complete, `${family} ${mode} probe containment is unproved`);
  assert.ok(outcome, `${family} ${mode} probe exceeded its terminal bound`);
  const expected = signalName !== "" ? SIGNAL_STATUS[signalName]
    : ["timeout", "resistant"].includes(mode) ? 124
      : ["manual", "delete-failure"].includes(mode) || mode.startsWith("evidence-") ? 125
        : ["missing-handshake", "overrun"].includes(mode) ? 143 : mode === "status" ? 23 : 0;
  assert.deepEqual(outcome, { code: expected, signal: null });
  assert.equal(output, "");
  const mustRetain = ["manual", "early-delete-failure", "delete-failure"].includes(mode)
    || mode.startsWith("evidence-");
  if (mustRetain) {
    const evidence = retainedEvidence(rootMessage);
    assert.ok(evidence, `${family} ${mode} did not retain mode-0600 evidence`);
    const leaderPgid = mode === "early-delete-failure" || mode.startsWith("evidence-")
      ? null : ownedMessage.leaderPgid;
    assert.deepEqual(evidence, {
      version: 1,
      family,
      root: rootMessage.root,
      evidencePath: rootMessage.evidencePath,
      supervisorPid: proof.pid,
      leaderPgid,
      state: "manual-remediation",
    });
    const printablePgid = leaderPgid ?? "unassigned";
    const expectedError = `ERROR  P2-E ${family} fixture cleanup is unproved; root=${evidence.root} evidence=${evidence.evidencePath} supervisor-pid=${proof.pid} leader-pgid=${printablePgid}; manual remediation required\n`;
    assert.equal(errorOutput, expectedError);
    assert.equal(existsSync(rootMessage.root), true);
    if (leaderPgid !== null) assert.equal(await groupGone(leaderPgid, 3000), true);
    assert.equal(await removeRootBounded(rootMessage.root), true);
    removeIfPresent(rootMessage.evidencePath);
  } else {
    assert.equal(errorOutput, "");
    assert.equal(existsSync(rootMessage.root), false);
    assert.equal(existsSync(rootMessage.evidencePath), false);
  }
  if (["resistant", "parent-exit"].includes(mode)) await pause(2200);
  if (mode === "resistant") assert.equal(existsSync(termPath), true);
  assert.equal(existsSync(leakPath), false);
  removeIfPresent(termPath);
  removeIfPresent(leakPath);
}

if (probeMode === "") {
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    for (const mode of ["early", "early-delete-failure", "signal", "terminal", "delete", "final",
      "timeout-signal", "manual", "delete-failure", "evidence-write-failure",
      "evidence-chmod-failure", "evidence-rename-failure", "evidence-partial-failure"]) {
      await runProbe(mode, signalName);
    }
  }
  for (const [first, later] of [["SIGHUP", "SIGTERM"], ["SIGINT", "SIGHUP"], ["SIGTERM", "SIGINT"]]) {
    await runProbe("signal", first, later);
  }
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM", "SIGKILL"]) {
    await runProbe("natural", signalName);
  }
  await runProbe("timeout");
  await runProbe("resistant");
  await runProbe("parent-exit");
  await runProbe("manual");
  await runProbe("delete-failure");
  await runProbe("evidence-write-failure");
  await runProbe("evidence-chmod-failure");
  await runProbe("evidence-rename-failure");
  await runProbe("evidence-partial-failure");
  await runProbe("missing-handshake");
  await runProbe("overrun");
  await runProbe("status");
  if (latchedSignalStatus !== 0) process.exitCode = latchedSignalStatus;
  else await superviseWorker();
} else {
  await superviseWorker();
}
' 3<<'P2E_HISTORY_WORKER'
set -euo pipefail

repo_root="$(pwd -P)"
test -f "$repo_root/templates/build"
fixture_parent="${P2E_FIXTURE_PARENT:-}"
fixture_template="$fixture_parent/.history-fixture.XXXXXX"
fixture="${P2E_FIXTURE_ROOT:-}"

cleanup() {
  local cleanup_status=0
  local parent name
  trap - HUP INT TERM
  set +e
  if [[ -n "${fixture:-}" ]]; then
    parent="${fixture%/*}"
    name="${fixture##*/}"
    if [[ "$parent" != "$fixture_parent" || "$fixture" == "$fixture_parent" ]]; then
      printf 'REFUSED cleanup outside repository fixture parent: %s\n' "$fixture" >&2
      cleanup_status=1
    else
      case "$name" in
        .history-fixture.??????)
          if [[ ! "${P2E_GROUP_OWNER_NONCE:-}" =~ ^[0-9a-f]{32}$ || ! -d "$fixture" ]]; then
            printf 'REFUSED cleanup without the live P2-E group owner: %s\n' "$fixture" >&2
            cleanup_status=1
          fi
          ;;
        *)
          printf 'REFUSED cleanup of unexpected fixture name: %s\n' "$name" >&2
          cleanup_status=1
          ;;
      esac
    fi
  fi
  return "$cleanup_status"
}
finish() {
  local prior_status=$?
  local cleanup_status
  trap - EXIT HUP INT TERM
  set +e
  cleanup
  cleanup_status=$?
  if (( prior_status != 0 )); then exit "$prior_status"; fi
  exit "$cleanup_status"
}
exit_on_signal() {
  local signal_status="$1"
  trap - HUP INT TERM
  exit "$signal_status"
}
trap finish EXIT
trap 'exit_on_signal 129' HUP
trap 'exit_on_signal 130' INT
trap 'exit_on_signal 143' TERM

if [[ "$fixture_parent" != "$repo_root" || "$fixture_parent" != /* \
  || ! -d "$fixture_parent" || "${fixture_template%/*}" != "$fixture_parent" \
  || "${fixture_template##*/}" != '.history-fixture.XXXXXX' ]]; then
  printf 'REFUSED creation outside exact repository fixture template: %s\n' "$fixture_template" >&2
  exit 1
fi
if [[ -z "$fixture" || "${fixture%/*}" != "$fixture_parent" \
  || "$fixture" == "$fixture_parent" || ! -d "$fixture" ]]; then
  printf 'REFUSED unexpected created fixture path: %s\n' "$fixture" >&2
  exit 1
fi
case "${fixture##*/}" in
  .history-fixture.??????) ;;
  *)
    printf 'REFUSED unexpected created fixture name: %s\n' "${fixture##*/}" >&2
    exit 1
    ;;
esac

repo="$fixture/source"
shallow="$fixture/shallow"

mkdir -p "$repo/doc/sections"
cat >"$repo/doc/doc.json" <<'JSON'
{
  "id": "a1b2c3",
  "slug": "fixture",
  "aliases": [],
  "title": "History fixture"
}
JSON
cat >"$repo/doc/extra.css" <<'CSS'
.fixture { color: #123456; }
CSS
cat >"$repo/doc/sections/01-overview.html" <<'HTML'
<!--
id: overview
label: Overview & <Map> "A" 'B'
summary: A public-safe history fixture.
nav: Overview
-->
<!-- body -->
<h2>Overview</h2>
<p>The first boundary is stable.</p>
HTML

git -C "$repo" init -q
git -C "$repo" config user.name "Fixture Writer"
git -C "$repo" config user.email "fixture@example.invalid"
git -C "$repo" remote add origin https://github.com/example/public-history-fixture.git
export DOCBUILD_PUBLIC_HISTORY_APPROVED=example/public-history-fixture
git -C "$repo" add doc
GIT_AUTHOR_DATE=2026-01-01T00:00:00Z \
GIT_COMMITTER_DATE=2026-01-01T00:00:00Z \
  git -C "$repo" commit -q -m "Create fixture document"

perl -0pi -e 's/The first boundary is stable\./The second boundary closes <\/script> safely\./' \
  "$repo/doc/sections/01-overview.html"
git -C "$repo" add doc/sections/01-overview.html
GIT_AUTHOR_DATE=2026-01-02T03:04:05Z \
GIT_COMMITTER_DATE=2026-01-02T03:04:05Z \
  git -C "$repo" commit -q -m 'Close </script> & refine'

repo_rel="${repo#"$repo_root"/}"
templates/build "$repo_rel/doc" | tee "$fixture/initial.out"
grep -Fx "  history          WROTE $repo_rel/doc/history.json" "$fixture/initial.out"
test "$(grep -c '^  history ' "$fixture/initial.out")" -eq 1
! grep -F "  history trim     dropped " "$fixture/initial.out"

FIXTURE_DOC="$repo/doc" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as historyModule from "./templates/docbuild/dist/history.js";
import { BuildError } from "./templates/docbuild/dist/index.js";

const doc = process.env.FIXTURE_DOC;
assert.ok(doc);
const { changelogSection } = historyModule;
assert.deepEqual(Object.keys(historyModule).sort(), ["changelogSection", "refresh"]);
const source = readFileSync("templates/docbuild/src/history.ts", "utf8");
assert.ok(source.includes('import { BuildError, parseSection, type Section } from "./index.js";'));
assert.deepEqual(
  [...source.matchAll(/^export (?:interface|type|class|const|let|function) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1]),
  ["HistoryChange", "HistoryVersion", "History", "refresh", "changelogSection"],
);
assert.doesNotMatch(source, /^export\s*\{/m);
for (const shape of [
  /export interface HistoryChange\s*\{\s*file: string;\s*id: string;\s*add: number;\s*del: number;\s*patch: string;\s*clipped: boolean;\s*\}/,
  /export interface HistoryVersion\s*\{\s*sha: string;\s*date: string;\s*author: string;\s*subject: string;\s*url: string;\s*changed: HistoryChange\[];\s*\}/,
  /export interface History\s*\{\s*doc: string;\s*head: string;\s*versions: HistoryVersion\[];\s*\}/,
]) assert.match(source, shape);
for (const signature of [
  /function git\(cwd: string, args: readonly string\[\]\): string \| null\s*\{/,
  /function parse_diff\([\s\S]*?text: string,[\s\S]*?pathspecs: readonly \[sections: string, doc: string, css: string\],[\s\S]*?ids: ReadonlyMap<string, string>,[\s\S]*?\): HistoryChange\[]\s*\{/,
  /function commitUrl\(remote: string \| null, fullSha: string\): string\s*\{/,
  /function history\(inst: string\): History \| null\s*\{/,
  /function trim\(h: History\): number\s*\{/,
  /export function refresh\(inst: string\): History \| null/,
  /export function changelogSection\([\s\S]*?h: History,[\s\S]*?labels: Array<\[string, string\]>,[\s\S]*?\): Section/,
]) assert.match(source, signature);
assert.match(source, /const HISTORY_LIMIT = 12;/);
assert.match(source, /const PATCH_CAP = 1200;/);
assert.match(source, /const HISTORY_BUDGET = 16 \* 1024;/);
assert.match(source, /const historyProcess = \{ spawn: spawnSync \};/);
for (const member of [
  "lstat: lstatSync", "read: readFileSync", "open: openSync", "write: writeFileSync", "sync: fsyncSync",
  "close: closeSync", "replace: renameSync", "remove: unlinkSync",
]) assert.ok(source.includes(member));
const raw = readFileSync(join(doc, "history.json"), "utf8");
const h = JSON.parse(raw);
assert.equal(raw, `${JSON.stringify(h, null, 2)}\n`);
assert.deepEqual(Object.keys(h), ["doc", "head", "versions"]);
assert.equal(h.doc, "doc");
assert.equal(h.versions.length, 2);
assert.equal(h.head, h.versions[0].sha);
assert.deepEqual(Object.keys(h.versions[0]), ["sha", "date", "author", "subject", "url", "changed"]);
assert.equal(h.versions[0].date, "2026-01-02T03:04:05.000Z");
assert.equal(h.versions[1].date, "2026-01-01T00:00:00.000Z");
assert.equal(h.versions[0].author, "Fixture Writer");
assert.equal(h.versions[0].subject, "Close </script> & refine");
assert.match(h.versions[0].url, /^https:\/\/github\.com\/example\/public-history-fixture\/commit\/(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
assert.deepEqual(h.versions[0].changed.map((c) => c.file), ["01-overview.html"]);
assert.deepEqual(h.versions[1].changed.map((c) => c.file), ["01-overview.html", "doc.json", "extra.css"]);
assert.equal(h.versions[0].changed[0].id, "overview");
assert.equal("label" in h.versions[0].changed[0], false);
assert.equal(h.versions[0].changed[0].add, 1);
assert.equal(h.versions[0].changed[0].del, 1);
assert.match(h.versions[0].changed[0].patch, /^@@ /);
assert.match(h.versions[1].changed[0].patch, /^@@ /);

const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const attr = (value) => esc(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const labels = new Map([["overview", 'Overview & <Map> "A" \'B\'']]);
const renderFixture = {
  doc: "doc",
  head: "abc1234",
  versions: [{
    sha: "abc1234",
    date: "2026-02-03T04:05:06.000Z",
    author: "O'Neil & Co",
    subject: "Render <fixed> & exact",
    url: `https://github.com/example/repo/commit/${"a".repeat(40)}`,
    changed: [
      { file: "01-overview.html", id: "overview", add: 2, del: 1, patch: "@@ -1 +1 @@\n-<old>\n+new & exact", clipped: true },
      { file: "doc.json", id: "doc", add: 0, del: 0, patch: "", clipped: false },
    ],
  }],
};
const fixedSection = changelogSection(renderFixture, [...labels]);
assert.deepEqual(
  { id: fixedSection.id, label: fixedSection.label, nav: fixedSection.nav, summary: fixedSection.summary, file: fixedSection.file },
  { id: "changelog", label: "Changelog", nav: "Changes", summary: "1 version. Latest: Render &lt;fixed&gt; &amp; exact.", file: "history.json" },
);
assert.equal(
  fixedSection.peek,
  '<table class="tbl"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody><tr><td><code>abc1234</code></td><td>2026-02-03</td><td>Render &lt;fixed&gt; &amp; exact</td></tr></tbody></table>',
);
assert.equal(
  fixedSection.body,
  `<details class="dx" data-sha="abc1234"><summary><code>abc1234</code> &nbsp;Render &lt;fixed&gt; &amp; exact <span class="dx-meta">O'Neil &amp; Co &middot; 2026-02-03</span></summary><div class="dxb"><p>Changed: <a href="#overview">Overview &amp; &lt;Map&gt; "A" 'B'</a>, doc.json &middot; <a href="https://github.com/example/repo/commit/${"a".repeat(40)}">commit on GitHub</a></p><h4>Overview &amp; &lt;Map&gt; "A" 'B'  <span class="dx-stat">+2 &minus;1</span></h4><pre class="diff">@@ -1 +1 @@\n-&lt;old&gt;\n+new &amp; exact\n[diff clipped]</pre><h4>doc.json  <span class="dx-stat">+0 &minus;0</span></h4><pre class="diff"></pre></div></details>`,
);
const expectedPeek = `<table class="tbl"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody>${h.versions.slice(0, 3).map((version) => `<tr><td><code>${esc(version.sha)}</code></td><td>${version.date.slice(0, 10)}</td><td>${esc(version.subject)}</td></tr>`).join("")}</tbody></table>`;
const expectedBody = h.versions.map((version) => {
  const touched = version.changed.length === 0
    ? "&mdash;"
    : version.changed.map((change) => labels.has(change.id)
      ? `<a href="#${attr(change.id)}">${esc(labels.get(change.id))}</a>`
      : esc(change.file)).join(", ");
  const commit = version.url === ""
    ? ""
    : ` &middot; <a href="${attr(version.url)}">commit on GitHub</a>`;
  const patches = version.changed.map((change) => {
    const label = labels.get(change.id) ?? change.file;
    const tail = change.clipped ? "\n[diff clipped]" : "";
    return `<h4>${esc(label)}  <span class="dx-stat">+${change.add} &minus;${change.del}</span></h4><pre class="diff">${esc(change.patch + tail)}</pre>`;
  }).join("");
  return `<details class="dx" data-sha="${attr(version.sha)}"><summary><code>${esc(version.sha)}</code> &nbsp;${esc(version.subject)} <span class="dx-meta">${esc(version.author)} &middot; ${version.date.slice(0, 10)}</span></summary><div class="dxb"><p>Changed: ${touched}${commit}</p>${patches}</div></details>`;
}).join("");

const section = changelogSection(h, [...labels]);
assert.deepEqual(
  { id: section.id, label: section.label, nav: section.nav, summary: section.summary, file: section.file },
  {
    id: "changelog",
    label: "Changelog",
    nav: "Changes",
    summary: "2 versions. Latest: Close &lt;/script&gt; &amp; refine.",
    file: "history.json",
  },
);
assert.equal(section.peek, expectedPeek);
assert.equal(section.body, expectedBody);
const emptyHistory = {
  doc: "doc",
  head: "abc1234",
  versions: [{
    sha: "abc1234",
    date: "2026-01-01T00:00:00.000Z",
    author: "O'Neil & Co",
    subject: "No remote & <quiet>",
    url: "",
    changed: [],
  }],
};
const emptySection = changelogSection(emptyHistory, []);
assert.equal(emptySection.summary, "1 version. Latest: No remote &amp; &lt;quiet&gt;.");
assert.equal(
  emptySection.peek,
  '<table class="tbl"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody><tr><td><code>abc1234</code></td><td>2026-01-01</td><td>No remote &amp; &lt;quiet&gt;</td></tr></tbody></table>',
);
assert.equal(
  emptySection.body,
  '<details class="dx" data-sha="abc1234"><summary><code>abc1234</code> &nbsp;No remote &amp; &lt;quiet&gt; <span class="dx-meta">O\'Neil &amp; Co &middot; 2026-01-01</span></summary><div class="dxb"><p>Changed: &mdash;</p></div></details>',
);
assert.equal(emptySection.body.includes("commit on GitHub"), false);
assert.throws(
  () => changelogSection(h, [["overview", "Overview"], ["changelog", "Reserved"]]),
  (error) => error instanceof BuildError
    && error.message === 'history: source section id "changelog" is reserved',
);
assert.throws(
  () => changelogSection(h, [["overview", "First"], ["overview", "Second"]]),
  (error) => error instanceof BuildError
    && error.message === 'history: duplicate source section id "overview"',
);

const html = readFileSync(join(doc, "dist", "doc.html"), "utf8");
const match = html.match(/<script type="application\/json" id="doc-history">([\s\S]*?)<\/script>/);
assert.ok(match);
assert.ok(Buffer.byteLength(match[1], "utf8") <= 16 * 1024);
assert.equal(match[1].includes("</script"), false);
assert.ok(match[1].includes("<\\/script>"));
assert.deepEqual(JSON.parse(match[1]), h);
assert.equal((html.match(/<section id="changelog">/g) ?? []).length, 1);
assert.equal((html.match(/<a href="#changelog">Changes<\/a>/g) ?? []).length, 1);
const sectionAt = html.indexOf('<section id="changelog">');
const sectionEnd = html.indexOf("</section>", sectionAt);
assert.ok(sectionAt >= 0 && sectionEnd > sectionAt);
const rendered = html.slice(sectionAt, sectionEnd + "</section>".length);
assert.equal((rendered.match(/<details class="sec">/g) ?? []).length, 1);
assert.ok(rendered.includes('<p class="sec-label">Changelog</p>'));
assert.ok(rendered.includes('<p class="sec-sum">2 versions. Latest: Close &lt;/script&gt; &amp; refine.</p>'));
assert.ok(rendered.includes(`<div class="sec-peek">${expectedPeek}</div>`));
const bodyOpen = '<div class="sec-body"><div class="wrap">\n';
const bodyAt = rendered.indexOf(bodyOpen);
const bodyEnd = rendered.lastIndexOf("\n    </div></div>");
assert.ok(bodyAt >= 0 && bodyEnd > bodyAt);
const renderedBody = rendered.slice(bodyAt + bodyOpen.length, bodyEnd);
const aids = [...renderedBody.matchAll(/ data-aid="(a[0-9a-f]{8})"/g)].map((entry) => entry[1]);
assert.equal(aids.length, 2 + h.versions.reduce((count, version) => count + (2 * version.changed.length), 0));
assert.equal(new Set(aids).size, aids.length);
assert.equal(renderedBody.replace(/ data-aid="a[0-9a-f]{8}"/g, ""), expectedBody);
assert.deepEqual(
  [...rendered.matchAll(/<details class="dx" data-sha="([0-9a-f]{7})">/g)].map((entry) => entry[1]),
  h.versions.map((version) => version.sha),
);
assert.equal((rendered.match(/commit on GitHub<\/a>/g) ?? []).length, 2);
assert.equal((rendered.match(/class="dx-stat"/g) ?? []).length, 4);
assert.doesNotMatch(rendered, /href="#(?:doc|extra)"/);
assert.doesNotMatch(rendered, /(?:\sdata-editable(?:\s|>)|\sdata-md=)/);
assert.match(rendered, /Changed: <a href="#overview">Overview &amp; &lt;Map&gt; "A" 'B'<\/a>, doc\.json, extra\.css/);
console.log("PASS  complete changelog Section and HTML, reserved ID, root diff, canonical data, and budgets");
NODE

i=3
while [[ "$i" -le 16 ]]; do
  FIXTURE_FILE="$repo/doc/sections/01-overview.html" FIXTURE_I="$i" \
    node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.FIXTURE_FILE;
const i = process.env.FIXTURE_I;
if (!file || !i) throw new Error("missing fixture input");
const raw = readFileSync(file, "utf8");
const next = raw.replace(/<p>[^\n]*<\/p>/, `<p>${"é".repeat(900)} change-${i}</p>`);
if (next === raw) throw new Error("fixture paragraph did not change");
writeFileSync(file, next);
NODE
  git -C "$repo" add doc/sections/01-overview.html
  stamp="$(printf '2026-01-%02dT03:04:05Z' "$i")"
  GIT_AUTHOR_DATE="$stamp" GIT_COMMITTER_DATE="$stamp" \
    git -C "$repo" commit -q -m "Fixture change $i"
  i=$((i + 1))
done

templates/build "$repo_rel/doc" | tee "$fixture/retention.out"
grep -F "  history trim     dropped " "$fixture/retention.out"
grep -Fx "  history          WROTE $repo_rel/doc/history.json" "$fixture/retention.out"
test "$(grep -c '^  history ' "$fixture/retention.out")" -eq 2
retention_first="$(grep '^  history ' "$fixture/retention.out" | sed -n '1p')"
retention_second="$(grep '^  history ' "$fixture/retention.out" | sed -n '2p')"
test "$retention_first" = "  history trim     dropped 2 old diff bodies"
test "$retention_second" = "  history          WROTE $repo_rel/doc/history.json"

FIXTURE_HISTORY="$repo/doc/history.json" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = process.env.FIXTURE_HISTORY;
assert.ok(file);
const h = JSON.parse(readFileSync(file, "utf8"));
assert.equal(h.versions.length, 12);
assert.deepEqual(h.versions.map((v) => v.subject), Array.from({ length: 12 }, (_, n) => `Fixture change ${16 - n}`));
assert.equal(h.head, h.versions[0].sha);
for (const version of h.versions) {
  assert.deepEqual(version.changed.map((c) => c.file), ["01-overview.html"]);
  assert.equal(version.changed[0].id, "overview");
  assert.equal(version.changed[0].add, 1);
  assert.equal(version.changed[0].del, 1);
  assert.equal(version.changed[0].clipped, true);
  assert.ok(Buffer.byteLength(version.changed[0].patch, "utf8") <= 1200);
  assert.equal(version.changed[0].patch.includes("\uFFFD"), false);
}
const patches = h.versions.map((v) => v.changed[0].patch);
const firstEmpty = patches.findIndex((patch) => patch === "");
assert.notEqual(firstEmpty, -1);
assert.ok(patches.slice(0, firstEmpty).every((patch) => patch !== ""));
assert.ok(patches.slice(firstEmpty).every((patch) => patch === ""));
assert.notEqual(patches[0], "");
const payload = JSON.stringify(h).split("</").join("<\\/");
assert.ok(Buffer.byteLength(payload, "utf8") <= 16 * 1024);
const html = readFileSync(join(dirname(file), "dist", "doc.html"), "utf8");
const sectionAt = html.indexOf('<section id="changelog">');
const sectionEnd = html.indexOf("</section>", sectionAt);
assert.ok(sectionAt >= 0 && sectionEnd > sectionAt);
const rendered = html.slice(sectionAt, sectionEnd + "</section>".length);
assert.equal((rendered.match(/<details class="dx" data-sha="[0-9a-f]{7}">/g) ?? []).length, 12);
const peekBody = rendered.match(/<div class="sec-peek"><table class="tbl">[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table><\/div>/)?.[1];
assert.ok(peekBody);
assert.equal((peekBody.match(/<tr>/g) ?? []).length, 3);
assert.equal((rendered.match(/\[diff clipped\]/g) ?? []).length, 12);
console.log("PASS  retention, Unicode clipping, oldest-first trim, and three-row/clipped HTML");
NODE

cp "$repo/doc/history.json" "$fixture/good.history"
git -C "$repo" add doc/history.json
GIT_AUTHOR_DATE=2026-01-17T03:04:05Z \
GIT_COMMITTER_DATE=2026-01-17T03:04:05Z \
  git -C "$repo" commit -q -m "Commit generated history input"
mkdir -p "$repo/other-document/sections"
printf '%s\n' '<p>Out-of-path source changed.</p>' >"$repo/other-document/sections/01-other.html"
git -C "$repo" add other-document/sections/01-other.html
GIT_AUTHOR_DATE=2026-01-18T03:04:05Z \
GIT_COMMITTER_DATE=2026-01-18T03:04:05Z \
  git -C "$repo" commit -q -m "Change another document source"

HISTORY_FILE="$repo/doc/history.json" node --input-type=module <<'NODE'
import { utimesSync } from "node:fs";
const file = process.env.HISTORY_FILE;
if (!file) throw new Error("missing history path");
utimesSync(file, 946684800, 946684800);
NODE
templates/build "$repo_rel/doc" | tee "$fixture/out-of-path.out"
grep -Fx "  history          UNCHANGED $repo_rel/doc/history.json" "$fixture/out-of-path.out"
test "$(grep -c '^  history ' "$fixture/out-of-path.out")" -eq 1
cmp "$fixture/good.history" "$repo/doc/history.json"
HISTORY_FILE="$repo/doc/history.json" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { statSync } from "node:fs";
const file = process.env.HISTORY_FILE;
assert.ok(file);
assert.equal(statSync(file).mtimeMs, 946684800000);
console.log("PASS  history and other-document commits are outside the three pathspecs; mtime is unchanged");
NODE

git clone -q --depth=1 "file://$repo" "$shallow"
shallow_rel="${shallow#"$repo_root"/}"
HISTORY_FILE="$shallow/doc/history.json" node --input-type=module <<'NODE'
import { utimesSync } from "node:fs";
const file = process.env.HISTORY_FILE;
if (!file) throw new Error("missing history path");
utimesSync(file, 946684800, 946684800);
NODE
templates/build "$shallow_rel/doc" | tee "$fixture/shallow.out"
grep -Fx "  history          SKIPPED git unavailable or incomplete; using $shallow_rel/doc/history.json" "$fixture/shallow.out"
test "$(grep -c '^  history ' "$fixture/shallow.out")" -eq 1
cmp "$fixture/good.history" "$shallow/doc/history.json"
HISTORY_FILE="$shallow/doc/history.json" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { statSync } from "node:fs";
const file = process.env.HISTORY_FILE;
assert.ok(file);
assert.equal(statSync(file).mtimeMs, 946684800000);
console.log("PASS  shallow repository falls back without rewriting committed history");
NODE

mkdir "$fixture/fakebin"
cat >"$fixture/fakebin/git" <<'SH'
#!/bin/sh
: >"$DOCBUILD_GIT_MARKER"
exit 99
SH
chmod +x "$fixture/fakebin/git"
node_bin="$(command -v node)"
cp "$repo/doc/dist/doc.html" "$fixture/doc.before"

DOCBUILD_GIT_MARKER="$fixture/local-git.marker" PATH="$fixture/fakebin" \
  "$node_bin" templates/docbuild/dist/cli.js "$repo_rel/doc" | tee "$fixture/no-git.out"
test -e "$fixture/local-git.marker"
grep -Fx "  history          SKIPPED git unavailable or incomplete; using $repo_rel/doc/history.json" "$fixture/no-git.out"
test "$(grep -c '^  history ' "$fixture/no-git.out")" -eq 1
cmp "$fixture/good.history" "$repo/doc/history.json"
cmp "$fixture/doc.before" "$repo/doc/dist/doc.html"

NETLIFY=true DOCBUILD_GIT_MARKER="$fixture/netlify-git.marker" PATH="$fixture/fakebin" \
  "$node_bin" templates/docbuild/dist/cli.js "$repo_rel/doc" | tee "$fixture/netlify.out"
test ! -e "$fixture/netlify-git.marker"
grep -Fx "  history          SKIPPED refresh on Netlify; using $repo_rel/doc/history.json" "$fixture/netlify.out"
test "$(grep -c '^  history ' "$fixture/netlify.out")" -eq 1
cmp "$fixture/good.history" "$repo/doc/history.json"
cmp "$fixture/doc.before" "$repo/doc/dist/doc.html"

missing="$fixture/missing-committed"
mkdir -p "$missing/sections" "$fixture/emptybin"
cp "$repo/doc/doc.json" "$missing/doc.json"
cp "$repo/doc/sections/01-overview.html" "$missing/sections/01-overview.html"
missing_rel="${missing#"$repo_root"/}"
PATH="$fixture/emptybin" "$node_bin" templates/docbuild/dist/cli.js "$missing_rel" \
  | tee "$fixture/missing-local.out"
test "$(grep -c '^  history ' "$fixture/missing-local.out")" -eq 1
grep -Fx "  history          SKIPPED git unavailable or incomplete; no committed history.json" \
  "$fixture/missing-local.out"
test ! -e "$missing/history.json"
NETLIFY=true PATH="$fixture/emptybin" "$node_bin" templates/docbuild/dist/cli.js "$missing_rel" \
  | tee "$fixture/missing-netlify.out"
test "$(grep -c '^  history ' "$fixture/missing-netlify.out")" -eq 1
grep -Fx "  history          SKIPPED refresh on Netlify; no committed history.json" \
  "$fixture/missing-netlify.out"
test ! -e "$missing/history.json"

read_error="$fixture/read-error"
mkdir -p "$read_error/sections" "$read_error/history.json"
cp "$repo/doc/doc.json" "$read_error/doc.json"
cp "$repo/doc/sections/01-overview.html" "$read_error/sections/01-overview.html"
read_error_rel="${read_error#"$repo_root"/}"
if NETLIFY=true "$node_bin" templates/docbuild/dist/cli.js "$read_error_rel" \
  >"$fixture/read-error.out" 2>"$fixture/read-error.err"; then
  echo "expected non-ENOENT committed read failure" >&2
  exit 1
fi
test ! -s "$fixture/read-error.out"
test "$(cat "$fixture/read-error.err")" = \
  "error: $read_error_rel/history.json: history.json is not a regular non-symbolic-link file"

symlink_error="$fixture/symlink-error"
mkdir -p "$symlink_error/sections"
cp "$repo/doc/doc.json" "$symlink_error/doc.json"
cp "$repo/doc/sections/01-overview.html" "$symlink_error/sections/01-overview.html"
cp "$repo/doc/history.json" "$fixture/external-history.json"
cp "$fixture/external-history.json" "$fixture/external-history.before"
ln -s "$fixture/external-history.json" "$symlink_error/history.json"
symlink_error_rel="${symlink_error#"$repo_root"/}"
if NETLIFY=true "$node_bin" templates/docbuild/dist/cli.js "$symlink_error_rel" \
  >"$fixture/symlink-error.out" 2>"$fixture/symlink-error.err"; then
  echo "expected exact history.json symlink rejection" >&2
  exit 1
fi
test ! -s "$fixture/symlink-error.out"
test "$(cat "$fixture/symlink-error.err")" = \
  "error: $symlink_error_rel/history.json: history.json is not a regular non-symbolic-link file"
cmp "$fixture/external-history.before" "$fixture/external-history.json"

cp -R templates/docbuild/dist "$fixture/parser-probe"
printf '\nexport { commitUrl, git, history, historyIO, historyProcess, parse_diff, trim };\n' >>"$fixture/parser-probe/history.js"
PARSER_PROBE="$fixture/parser-probe/history.js" FIXTURE_REPO="$repo" FIXTURE_INSTANCE="$repo/doc" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PARSER_PROBE;
const fixtureRepo = process.env.FIXTURE_REPO;
const fixtureInstance = process.env.FIXTURE_INSTANCE;
assert.ok(modulePath && fixtureRepo && fixtureInstance);
const { commitUrl, git, history, historyIO, historyProcess, parse_diff, refresh, trim } = await import(pathToFileURL(modulePath).href);
assert.deepEqual(Object.keys(historyProcess), ["spawn"]);
assert.deepEqual(Object.keys(historyIO), ["lstat", "read", "open", "write", "sync", "close", "replace", "remove"]);
const initialSpawn = historyProcess.spawn;
const initialLstat = historyIO.lstat;
const initialRead = historyIO.read;
let invalidSpawnCalls = 0;
let invalidLstatCalls = 0;
let invalidReadCalls = 0;
historyProcess.spawn = () => { invalidSpawnCalls++; throw new Error("invalid inst reached Git"); };
historyIO.lstat = () => { invalidLstatCalls++; throw new Error("invalid inst reached filesystem"); };
historyIO.read = () => { invalidReadCalls++; throw new Error("invalid inst reached filesystem"); };
const priorNetlify = process.env.NETLIFY;
for (const netlify of [undefined, "true"]) {
  if (netlify === undefined) delete process.env.NETLIFY;
  else process.env.NETLIFY = netlify;
  for (const invalidInst of [undefined, null, "", 0, [], {}]) {
    assert.throws(
      () => refresh(invalidInst),
      (error) => error?.message === "history: expected a non-empty instance path",
    );
  }
}
if (priorNetlify === undefined) delete process.env.NETLIFY;
else process.env.NETLIFY = priorNetlify;
assert.equal(invalidSpawnCalls, 0);
assert.equal(invalidLstatCalls, 0);
assert.equal(invalidReadCalls, 0);
historyProcess.spawn = initialSpawn;
historyIO.lstat = initialLstat;
historyIO.read = initialRead;
const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);
for (const [remote, expected] of [
  ["git@github.com:example/repo.git", `https://github.com/example/repo/commit/${sha40}`],
  ["ssh://git@github.com/example/repo.git\n", `https://github.com/example/repo/commit/${sha40}`],
  ["https://github.com/example/repo", `https://github.com/example/repo/commit/${sha64}`],
  ["https://github.com/example/repo.git", `https://github.com/example/repo/commit/${sha40}`],
  ["git@github.com:owner._-/repo._-.git\n", `https://github.com/owner._-/repo._-/commit/${sha40}`],
]) assert.equal(commitUrl(remote, expected.endsWith(sha64) ? sha64 : sha40), expected);
for (const remote of [
  null,
  "",
  "\n",
  " git@github.com:example/repo.git",
  "\tgit@github.com:example/repo.git",
  "git@github.com:example/repo.git ",
  "git@github.com:example/repo.git\t",
  "git@github.com:example/repo.git\nextra",
  "git@github.com:example/repo.git\n\n",
  "git@github.com:example/repo.git\r\n",
  "git@github.com:example/repo.git\0",
  "git@github.com:example/repo",
  "git@github.com:/repo.git",
  "git@github.com:example/.git",
  "git@github.com:./repo.git",
  "git@github.com:../repo.git",
  "git@github.com:example/..git",
  "git@github.com:example/...git",
  "git@github.com:example/bad%20repo.git",
  "git@example.invalid:example/repo.git",
  "other@github.com:example/repo.git",
  "ssh://git@github.com/example/repo",
  "ssh://other@github.com/example/repo.git",
  "ssh://git@github.com:22/example/repo.git",
  "ssh://git@example.invalid/example/repo.git",
  "ssh://git@github.com/example/repo/extra.git",
  "http://github.com/example/repo.git",
  "https://user@github.com/example/repo.git",
  "https://github.com:443/example/repo.git",
  "https://github.com//repo.git",
  "https://github.com/example/",
  "https://github.com/example/../repo.git",
  "https://github.com/example/repo/extra",
  "https://github.com/example/repo.git?token=invented",
  "https://github.com/example/repo.git#fragment",
]) assert.equal(commitUrl(remote, sha40), "", String(remote));
for (const invalidSha of ["", "abc1234", "A".repeat(40), "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65)])
  assert.equal(commitUrl("https://github.com/example/repo.git", invalidSha), "", invalidSha);

const originalSpawn = historyProcess.spawn;
const failedSpawns = [
  { error: Object.assign(new Error("missing"), { code: "ENOENT" }), signal: null, status: null, stdout: "" },
  { error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), signal: null, status: null, stdout: "" },
  { error: undefined, signal: "SIGTERM", status: null, stdout: "" },
  { error: Object.assign(new Error("buffer"), { code: "ENOBUFS" }), signal: null, status: null, stdout: "" },
  { error: undefined, signal: null, status: 1, stdout: "invented stderr is ignored" },
  { error: undefined, signal: null, status: 0, stdout: Buffer.from("not a string") },
];
for (const result of failedSpawns) {
  historyProcess.spawn = () => result;
  assert.equal(git("/invented/cwd", ["status"]), null);
}
let spawnCall;
const savedGitEnv = Object.fromEntries(
  ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]
    .map((name) => [name, process.env[name]]),
);
process.env.DOCBUILD_HISTORY_SENTINEL = "preserved";
for (const name of Object.keys(savedGitEnv)) process.env[name] = "must-not-reach-child";
const expectedSpawnEnv = { ...process.env };
for (const name of Object.keys(savedGitEnv)) delete expectedSpawnEnv[name];
Object.assign(expectedSpawnEnv, {
  LC_ALL: "C", LANG: "C", GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
});
historyProcess.spawn = (command, args, options) => {
  spawnCall = { command, args, options };
  return { error: undefined, signal: null, status: 0, stdout: "ok" };
};
assert.equal(git(realpathSync(fixtureInstance), ["log", "--", ":(glob)literal[*]"]), "ok");
assert.equal(spawnCall.command, "git");
assert.deepEqual(spawnCall.args, [
  "--no-pager", "--literal-pathspecs", "-c", "color.ui=false", "-c", "core.quotePath=false",
  "log", "--", ":(glob)literal[*]",
]);
assert.equal(spawnCall.options.cwd, realpathSync(fixtureInstance));
assert.equal(spawnCall.options.encoding, "utf8");
assert.equal(spawnCall.options.timeout, 20_000);
assert.equal(spawnCall.options.maxBuffer, 8 * 1024 * 1024);
assert.equal(spawnCall.options.windowsHide, true);
assert.deepEqual(Object.keys(spawnCall.options).sort(), ["cwd", "encoding", "env", "maxBuffer", "timeout", "windowsHide"]);
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"])
  assert.equal(name in spawnCall.options.env, false);
assert.equal(spawnCall.options.env.DOCBUILD_HISTORY_SENTINEL, "preserved");
assert.deepEqual(spawnCall.options.env, expectedSpawnEnv);
assert.deepEqual(
  Object.fromEntries(["LC_ALL", "LANG", "GIT_PAGER", "GIT_TERMINAL_PROMPT", "GIT_OPTIONAL_LOCKS"].map((name) => [name, spawnCall.options.env[name]])),
  { LC_ALL: "C", LANG: "C", GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
);
delete process.env.DOCBUILD_HISTORY_SENTINEL;
for (const [name, value] of Object.entries(savedGitEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const full = "c".repeat(40);
const firstParent = "d".repeat(40);
const secondParent = "e".repeat(40);
const priorApproval = process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED;
process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED = "example/repo";
const gitCalls = [];
historyProcess.spawn = (_command, args, options) => {
  const call = args.slice(6);
  gitCalls.push({ call, cwd: options.cwd });
  let stdout;
  if (call[0] === "rev-parse" && call[1] === "--show-toplevel") stdout = `${realpathSync(fixtureRepo)}\n`;
  else if (call[0] === "rev-parse") stdout = "false\n";
  else if (call[0] === "log") stdout = [full, `${firstParent} ${secondParent}`, "2026-01-20T03:04:05Z", "Fixture Writer", "Merge fixture", ""].join("\0");
  else if (call[0] === "remote") stdout = "git@github.com:example/repo.git\n";
  else if (call[0] === "diff") stdout = [
    "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
    "index 1111111..2222222 100644",
    "--- a/doc/sections/01-overview.html",
    "+++ b/doc/sections/01-overview.html",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
  else throw new Error(`unexpected mocked Git call: ${call.join(" ")}`);
  return { error: undefined, signal: null, status: 0, stdout };
};
const merged = history(fixtureInstance);
assert.equal(merged?.versions.length, 1);
assert.equal(merged?.versions[0].sha, full.slice(0, 7));
assert.equal(gitCalls[0].cwd, realpathSync(fixtureInstance));
assert.ok(gitCalls.slice(1).every(({ cwd }) => cwd === realpathSync(fixtureRepo)));
const exactPaths = ["doc/sections", "doc/doc.json", "doc/extra.css"];
assert.deepEqual(gitCalls.map(({ call }) => call[0]), ["rev-parse", "rev-parse", "remote", "log", "diff"]);
assert.deepEqual(gitCalls[0].call, ["rev-parse", "--show-toplevel"]);
assert.deepEqual(gitCalls[1].call, ["rev-parse", "--is-shallow-repository"]);
assert.deepEqual(gitCalls[2].call, ["remote", "get-url", "origin"]);
assert.deepEqual(gitCalls[3].call, [
  "log", "-z", "--first-parent", "--max-count=12",
  "--format=%H%x00%P%x00%aI%x00%an%x00%s", "HEAD", "--", ...exactPaths,
]);
const mergeDiff = gitCalls.find(({ call }) => call[0] === "diff")?.call;
assert.ok(mergeDiff);
assert.deepEqual(mergeDiff, [
  "diff", "--patch", "--unified=2", "--no-color", "--no-ext-diff", "--no-textconv",
  "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-algorithm=myers",
  "--no-indent-heuristic", firstParent, full, "--", ...exactPaths,
]);
assert.equal(mergeDiff.includes(secondParent), false);

gitCalls.length = 0;
delete process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED;
assert.equal(history(fixtureInstance), null, "missing public-history approval");
assert.deepEqual(gitCalls.map(({ call }) => call[0]), ["rev-parse", "rev-parse", "remote"]);
assert.equal(gitCalls.some(({ call }) => ["log", "diff", "diff-tree"].includes(call[0])), false,
  "unapproved history reached author, subject, or source history");
const approvalFallbackPath = join(fixtureInstance, "history.json");
const approvalFallbackBytes = readFileSync(approvalFallbackPath);
const approvalFallbackMtime = statSync(approvalFallbackPath).mtimeMs;
gitCalls.length = 0;
const approvalOutput = [];
const savedApprovalLog = console.log;
console.log = (...values) => approvalOutput.push(values.join(" "));
try {
  assert.deepEqual(refresh(fixtureInstance), JSON.parse(approvalFallbackBytes.toString("utf8")));
} finally {
  console.log = savedApprovalLog;
}
assert.deepEqual(readFileSync(approvalFallbackPath), approvalFallbackBytes);
assert.equal(statSync(approvalFallbackPath).mtimeMs, approvalFallbackMtime);
assert.deepEqual(gitCalls.map(({ call }) => call[0]), ["rev-parse", "rev-parse", "remote"]);
assert.equal(approvalOutput.length, 1);
assert.match(approvalOutput[0], /^  history          SKIPPED git unavailable or incomplete; using /);
gitCalls.length = 0;
process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED = "example/other";
assert.equal(history(fixtureInstance), null, "mismatched public-history approval");
assert.deepEqual(gitCalls.map(({ call }) => call[0]), ["rev-parse", "rev-parse", "remote"]);
process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED = "example/repo";

const malformed = [
  ["empty SHA", ["", "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["malformed SHA", ["A".repeat(40), "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["uppercase parent", [full, "D".repeat(40), "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["mixed-length parents", [full, `${"d".repeat(40)} ${"e".repeat(64)}`, "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["leading-space parent", [full, ` ${"d".repeat(40)}`, "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["empty date", [full, "", "", "Fixture Writer", "Subject", ""].join("\0")],
  ["malformed date", [full, "", "not-a-date", "Fixture Writer", "Subject", ""].join("\0")],
  ["expanded-year date", [full, "", "+010000-01-01T00:00:00.000Z", "Fixture Writer", "Subject", ""].join("\0")],
  ["empty author", [full, "", "2026-01-20T03:04:05Z", "", "Subject", ""].join("\0")],
  ["empty subject", [full, "", "2026-01-20T03:04:05Z", "Fixture Writer", "", ""].join("\0")],
  ["missing final NUL", [full, "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject"].join("\0")],
  ["extra final NUL", [full, "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", "", ""].join("\0")],
  ["non-multiple field count", [full, "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", "extra", ""].join("\0")],
  ["CR-bearing log", [full, "", "2026-01-20T03:04:05Z", "Fixture\rWriter", "Subject", ""].join("\0")],
];
for (const [name, logText] of malformed) {
  historyProcess.spawn = (_command, args) => {
    const call = args.slice(6);
    const stdout = call[0] === "rev-parse" && call[1] === "--show-toplevel" ? `${realpathSync(fixtureRepo)}\n`
      : call[0] === "rev-parse" ? "false\n"
      : call[0] === "log" ? logText
      : "git@github.com:example/repo.git\n";
    return { error: undefined, signal: null, status: 0, stdout };
  };
  assert.equal(history(fixtureInstance), null, name);
}
const rootLog = [full, "", "2026-01-20T03:04:05Z", "Fixture Writer", "Subject", ""].join("\0");
const rootCalls = [];
const rootResponder = (patchText) => (_command, args, options) => {
  const call = args.slice(6);
  rootCalls.push({ call, cwd: options.cwd });
  const stdout = call[0] === "rev-parse" && call[1] === "--show-toplevel" ? `${realpathSync(fixtureRepo)}\n`
    : call[0] === "rev-parse" ? "false\n"
    : call[0] === "log" ? rootLog
    : call[0] === "diff-tree" ? patchText
    : "git@github.com:example/repo.git\n";
  return { error: undefined, signal: null, status: 0, stdout };
};
historyProcess.spawn = rootResponder([
  "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
  "@@ -1 +1 @@",
  "-old\r",
  "+new",
].join("\n"));
assert.equal(history(fixtureInstance), null, "CR-bearing Git patch");
assert.equal(rootCalls[0].cwd, realpathSync(fixtureInstance));
assert.ok(rootCalls.slice(1).every(({ cwd }) => cwd === realpathSync(fixtureRepo)));
assert.deepEqual(rootCalls.find(({ call }) => call[0] === "diff-tree")?.call, [
  "diff-tree", "--root", "--no-commit-id", "-r", "--patch", "--unified=2", "--no-color",
  "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/",
  "--diff-algorithm=myers", "--no-indent-heuristic", full, "--", ...exactPaths,
]);
historyProcess.spawn = rootResponder(null);
assert.equal(history(fixtureInstance), null, "required diff failure");
historyProcess.spawn = rootResponder("unexpected patch line");
assert.equal(history(fixtureInstance), null, "non-empty unparseable diff");
historyProcess.spawn = rootResponder("");
assert.deepEqual(history(fixtureInstance)?.versions[0].changed, [], "empty required diff is a valid empty change list");
const sectionFile = join(fixtureInstance, "sections", "01-overview.html");
const validSection = readFileSync(sectionFile, "utf8");
writeFileSync(sectionFile, validSection.replace("id: overview", "id: INVALID"));
try {
  historyProcess.spawn = rootResponder([
    "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n"));
  assert.equal(history(fixtureInstance), null, "invalid parsed section ID");
} finally {
  writeFileSync(sectionFile, validSection);
}
const duplicateSection = join(fixtureInstance, "sections", "02-duplicate.html");
writeFileSync(duplicateSection, validSection);
try {
  historyProcess.spawn = rootResponder("");
  assert.equal(history(fixtureInstance), null, "duplicate parsed section ID");
} finally {
  unlinkSync(duplicateSection);
}
const typedEntry = join(fixtureInstance, "sections", "02-type.html");
mkdirSync(typedEntry);
try {
  assert.equal(history(fixtureInstance), null, "safe-name directory");
} finally {
  rmdirSync(typedEntry);
}
symlinkSync(sectionFile, typedEntry);
try {
  assert.equal(history(fixtureInstance), null, "safe-name symlink");
} finally {
  unlinkSync(typedEntry);
}
const ignoredCaseEntry = join(fixtureInstance, "sections", "02-IGNORED.HTML");
writeFileSync(ignoredCaseEntry, "not a section");
try {
  assert.deepEqual(history(fixtureInstance)?.versions[0].changed, [], "uppercase-suffix entry is ignored");
} finally {
  unlinkSync(ignoredCaseEntry);
}
historyProcess.spawn = originalSpawn;
const tuple = ["doc/sections", "doc/doc.json", "doc/extra.css"];
const ids = new Map([["01-overview.html", "overview"]]);
const patch = (header) => [
  header,
  "@@ -1 +1 @@",
  "-old fixture line",
  "+new fixture line",
].join("\n");
const validPatch = patch("diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html");
assert.deepEqual(parse_diff(validPatch, tuple, ids).map((change) => change.file), ["01-overview.html"]);
assert.deepEqual(parse_diff(`${validPatch}\n`, tuple, ids).map((change) => change.file), ["01-overview.html"], "one terminal LF");
const rootTuple = ["sections", "doc.json", "extra.css"];
const rootFiles = [
  "diff --git a/doc.json b/doc.json",
  "index 1111111..2222222 100644",
  "old mode 100755",
  "new mode 100644",
  "Binary files a/doc.json and b/doc.json differ",
  "GIT binary patch",
  "--- a/doc.json",
  "+++ b/doc.json",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "diff --git a/extra.css b/extra.css",
  "new file mode 100644",
  "similarity index 100%",
  "dissimilarity index 0%",
  "--- /dev/null",
  "+++ b/extra.css",
  "@@ -0,0 +1 @@",
  "+new",
  "diff --git a/sections/01-overview.html b/sections/01-overview.html",
  "deleted file mode 100644",
  "--- a/sections/01-overview.html",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-old",
].join("\n");
assert.deepEqual(
  parse_diff(rootFiles, rootTuple, ids).map(({ file, id, add, del }) => ({ file, id, add, del })),
  [
    { file: "doc.json", id: "doc", add: 1, del: 1 },
    { file: "extra.css", id: "extra", add: 1, del: 0 },
    { file: "01-overview.html", id: "overview", add: 0, del: 1 },
  ],
);
const quotedUnicode = patch('diff --git "a/dóc/sections/01-overview.html" "b/dóc/sections/01-overview.html"');
assert.deepEqual(
  parse_diff(quotedUnicode, ["dóc/sections", "dóc/doc.json", "dóc/extra.css"], ids).map((change) => change.file),
  ["01-overview.html"],
);

const bAuthority = patch(
  "diff --git a/other-document/sections/99-old.html b/doc/sections/01-overview.html",
);
assert.deepEqual(parse_diff(bAuthority, tuple, ids).map((change) => change.file), ["01-overview.html"]);
const escapedBackslashInIgnoredA = patch(
  'diff --git "a/old\\\\path/99-old.html" "b/doc/sections/01-overview.html"',
);
assert.deepEqual(
  parse_diff(escapedBackslashInIgnoredA, tuple, ids).map((change) => change.file),
  ["01-overview.html"],
);

const controlParent = (code) => `doc${String.fromCharCode(code)}part`;
const quotedCases = [
  ["quote", 'doc\\"part', 'doc"part'],
  ["bell", "doc\\apart", controlParent(7)],
  ["backspace", "doc\\bpart", controlParent(8)],
  ["tab", "doc\\tpart", controlParent(9)],
  ["newline", "doc\\npart", controlParent(10)],
  ["vertical tab", "doc\\vpart", controlParent(11)],
  ["form feed", "doc\\fpart", controlParent(12)],
  ["carriage return", "doc\\rpart", controlParent(13)],
  ["one-digit octal", "doc\\7part", controlParent(7)],
  ["two-digit octal", "doc\\41part", "doc!part"],
  ["three-digit octal", "doc\\141part", "docapart"],
  ["three-digit octal stops before a fourth digit", "doc\\1411part", "doca1part"],
];
for (const [name, encodedParent, decodedParent] of quotedCases) {
  const quoted = patch(
    `diff --git "a/${encodedParent}/sections/01-overview.html" "b/${encodedParent}/sections/01-overview.html"`,
  );
  const quotedTuple = [
    `${decodedParent}/sections`,
    `${decodedParent}/doc.json`,
    `${decodedParent}/extra.css`,
  ];
  assert.deepEqual(parse_diff(quoted, quotedTuple, ids).map((change) => change.file), ["01-overview.html"], name);
}
const decodedBackslash = patch(
  'diff --git "a/doc\\\\part/sections/01-overview.html" "b/doc\\\\part/sections/01-overview.html"',
);
assert.deepEqual(
  parse_diff(decodedBackslash, ["doc\\part/sections", "doc\\part/doc.json", "doc\\part/extra.css"], ids),
  [],
  "decoded backslash makes the tuple and path invalid",
);

const multiHunk = [
  "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
  "index 1111111..2222222 100644",
  "--- a/doc/sections/01-overview.html",
  "+++ b/doc/sections/01-overview.html",
  "@@ -1,2 +1,2 @@",
  "--- deletion text that resembles a file marker",
  "+++ addition text that resembles a file marker",
  " context",
  "\\ No newline at end of file",
  "@@ -7 +7 @@",
  "-old",
  "+new",
].join("\n");
const [multiChange] = parse_diff(multiHunk, tuple, ids);
assert.equal(multiChange.add, 2);
assert.equal(multiChange.del, 2);
assert.equal(multiChange.patch, [
  "@@ -1,2 +1,2 @@",
  "--- deletion text that resembles a file marker",
  "+++ addition text that resembles a file marker",
  " context",
  "@@ -7 +7 @@",
  "-old",
  "+new",
].join("\n"));

const unicodeChange = parse_diff([
  "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
  "@@ -1 +1 @@",
  "-x",
  `+${"é".repeat(900)}`,
].join("\n"), tuple, ids)[0];
assert.equal(unicodeChange.add, 1);
assert.equal(unicodeChange.del, 1);
assert.equal(unicodeChange.clipped, true);
assert.ok(Buffer.byteLength(unicodeChange.patch, "utf8") <= 1200);
assert.equal(unicodeChange.patch.includes("�"), false);
assert.equal(unicodeChange.patch.endsWith("\n"), false);

for (const [name, headerOnly] of [
  ["mode-only", [
    "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html",
    "old mode 100644",
    "new mode 100755",
  ].join("\n")],
  ["empty-file", [
    "diff --git a/doc/extra.css b/doc/extra.css",
    "new file mode 100644",
    "index 0000000..e69de29",
    "--- /dev/null",
    "+++ b/doc/extra.css",
  ].join("\n")],
  ["binary", [
    "diff --git a/doc/doc.json b/doc/doc.json",
    "index 1111111..2222222 100644",
    "Binary files a/doc/doc.json and b/doc/doc.json differ",
  ].join("\n")],
]) {
  const [change] = parse_diff(headerOnly, tuple, ids);
  assert.deepEqual(
    { file: change?.file, add: change?.add, del: change?.del, patch: change?.patch, clipped: change?.clipped },
    { file: name === "mode-only" ? "01-overview.html" : name === "empty-file" ? "extra.css" : "doc.json",
      add: 0, del: 0, patch: "", clipped: false },
    name,
  );
}

const malformedPatches = [
  ["duplicate authoritative header", `${validPatch}\n${validPatch}`],
  ["unexpected pre-hunk line", "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html\nnot a header\n@@ -1 +1 @@\n-old\n+new"],
  ["unexpected hunk line", `${validPatch}\nnot hunk content`],
  ["empty physical line", `${validPatch}\n\n`],
  ["NUL framing", `${validPatch}\0`],
  ["CR framing", `${validPatch}\r`],
  ["unquoted operand space", "diff --git a/doc/sections/01 overview.html b/doc/sections/01 overview.html\n@@ -1 +1 @@\n-old\n+new"],
  ["ambiguous b separator", "diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html b/doc/extra.css\n@@ -1 +1 @@\n-old\n+new"],
  ["mixed quoted operands", 'diff --git "a/doc/sections/01-overview.html" b/doc/sections/01-overview.html\n@@ -1 +1 @@\n-old\n+new'],
  ["unescaped quote", 'diff --git "a/doc/sections/01-"overview.html" "b/doc/sections/01-overview.html"\n@@ -1 +1 @@\n-old\n+new'],
  ["unknown C escape", String.raw`diff --git "a/doc/sections/01-overview.html" "b/doc/sections/01-overview\x.html"` + "\n@@ -1 +1 @@\n-old\n+new"],
  ["truncated C escape", 'diff --git "a/doc/sections/01-overview.html" "b/doc/sections/01-overview.html' + "\\" + "\n@@ -1 +1 @@\n-old\n+new"],
  ["missing b prefix", 'diff --git "a/doc/sections/01-overview.html" "doc/sections/01-overview.html"\n@@ -1 +1 @@\n-old\n+new'],
  ["wrong no-newline marker", `${validPatch}\n\\ No newline at end of file `],
  ["invalid UTF-8 octal byte", String.raw`diff --git "a/doc/sections/01-overview.html" "b/doc/sections/01-overview\377.html"` + "\n@@ -1 +1 @@\n-old\n+new"],
  ["over-byte octal", String.raw`diff --git "a/doc/sections/01-overview.html" "b/doc/sections/01-overview\777.html"` + "\n@@ -1 +1 @@\n-old\n+new"],
];
for (const [name, malformedPatch] of malformedPatches)
  assert.deepEqual(parse_diff(malformedPatch, tuple, ids), [], name);

const invalidTuples = [
  ["non-array", null],
  ["short tuple", ["doc/sections", "doc/doc.json"]],
  ["long tuple", ["doc/sections", "doc/doc.json", "doc/extra.css", "doc/other.json"]],
  ["non-string member", ["doc/sections", null, "doc/extra.css"]],
  ["empty member", ["", "doc/doc.json", "doc/extra.css"]],
  ["absolute member", ["/doc/sections", "doc/doc.json", "doc/extra.css"]],
  ["backslash member", ["doc\\sections", "doc/doc.json", "doc/extra.css"]],
  ["empty component", ["doc//sections", "doc/doc.json", "doc/extra.css"]],
  ["dot component", ["doc/./sections", "doc/doc.json", "doc/extra.css"]],
  ["dotdot component", ["doc/../sections", "doc/doc.json", "doc/extra.css"]],
  ["wrong order", ["doc/doc.json", "doc/sections", "doc/extra.css"]],
  ["wrong fixed basename", ["doc/section", "doc/meta.json", "doc/styles.css"]],
  ["mixed instance", ["doc/sections", "other/doc.json", "doc/extra.css"]],
];
for (const [name, badTuple] of invalidTuples) {
  assert.deepEqual(parse_diff(validPatch, badTuple, ids), [], name);
}

if (priorApproval === undefined) delete process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED;
else process.env.DOCBUILD_PUBLIC_HISTORY_APPROVED = priorApproval;

const embeddedBytes = (value) => Buffer.byteLength(JSON.stringify(value).split("</").join("<\\/"), "utf8");
const newestPatch = "@@ -1 +1 @@\n-newest-old\n+newest-new";
const olderPatches = [
  "@@ -1 +1 @@\n-first-old\n+first-new",
  "@@ -1 +1 @@\n-second-old\n+second-new",
  "@@ -1 +1 @@\n-third-old\n+third-new",
];
const retentionFixture = {
  doc: "doc",
  head: "abc1234",
  versions: [
    {
      sha: "abc1234",
      date: "2026-01-02T00:00:00.000Z",
      author: "Fixture Writer",
      subject: "Newest",
      url: "",
      changed: [
        { file: "00-newest.html", id: "newest", add: 1, del: 1, patch: newestPatch, clipped: false },
      ],
    },
    {
      sha: "def5678",
      date: "2026-01-01T00:00:00.000Z",
      author: "Fixture Writer",
      subject: "Older with three changes",
      url: "",
      changed: olderPatches.map((patch, index) => ({
        file: `0${index + 1}-older.html`,
        id: `older-${index + 1}`,
        add: 1,
        del: 1,
        patch,
        clipped: false,
      })),
    },
  ],
};
const afterFirstDrop = structuredClone(retentionFixture);
afterFirstDrop.versions[1].changed[0].patch = "";
afterFirstDrop.versions[1].changed[0].clipped = true;
const firstDropBytes = embeddedBytes(retentionFixture) - embeddedBytes(afterFirstDrop);
const targetBytes = (16 * 1024) + firstDropBytes + 1;
const subjectPadding = targetBytes - embeddedBytes(retentionFixture);
assert.ok(subjectPadding > 0);
retentionFixture.versions[0].subject += "x".repeat(subjectPadding);
assert.equal(embeddedBytes(retentionFixture), targetBytes);
const expectedRetention = structuredClone(retentionFixture);
for (const index of [0, 1]) {
  expectedRetention.versions[1].changed[index].patch = "";
  expectedRetention.versions[1].changed[index].clipped = true;
}
assert.equal(trim(retentionFixture), 2);
assert.deepEqual(retentionFixture, expectedRetention);
assert.equal(retentionFixture.versions[0].changed[0].patch, newestPatch);
assert.deepEqual(
  retentionFixture.versions[1].changed.map(({ patch, clipped }) => ({ patch, clipped })),
  [
    { patch: "", clipped: true },
    { patch: "", clipped: true },
    { patch: olderPatches[2], clipped: false },
  ],
);
assert.ok(embeddedBytes(retentionFixture) <= 16 * 1024);
console.log("PASS  trim drops older changed indices 0 then 1, preserves index 2/newest, and returns 2");

const oversizedNewest = {
  doc: "doc",
  head: "abc1234",
  versions: [{
    sha: "abc1234",
    date: "2026-01-01T00:00:00.000Z",
    author: "Fixture Writer",
    subject: "x".repeat(17_000),
    url: "",
    changed: [],
  }],
};
assert.throws(
  () => trim(oversizedNewest),
  (error) => error?.message === "history: embedded history exceeds 16384 bytes after dropping every old diff body",
);
console.log("PASS  Git seam, remotes, merge parent, parser grammar/stats/clipping, tuple, and trim contracts");
NODE

mkdir "$fixture/fakebin-parser"
cat >"$fixture/fakebin-parser/git" <<'SH'
#!/bin/sh
: >"$DOCBUILD_GIT_MARKER"
case " $* " in
  *" rev-parse --show-toplevel "*) printf '%s\n' "$DOCBUILD_FAKE_ROOT" ;;
  *" rev-parse --is-shallow-repository "*) printf '%s\n' false ;;
  *" log "*)
    printf '%s\000\000%s\000%s\000%s\000' \
      aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      2026-01-20T03:04:05Z \
      'Fixture Writer' \
      'Attempt parser boundary diff'
    ;;
  *" diff-tree "*)
    printf '%s\n' \
      'diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html' \
      '--- a/doc/sections/01-overview.html' \
      '+++ b/doc/sections/01-overview.html' \
      '@@ -1 +1 @@' \
      '-valid file parsed first' \
      '+valid file must not survive a later invalid header'
    case "$DOCBUILD_PATH_CASE" in
      valid) ;;
      malformed-header)
        printf '%s\n' 'diff --git a/doc/sections/02-invalid.html'
        ;;
      traversal)
        printf '%s\n' 'diff --git a/doc/sections/../02-invalid.html b/doc/sections/../02-invalid.html'
        ;;
      dot-component)
        printf '%s\n' 'diff --git a/doc/sections/./02-invalid.html b/doc/sections/./02-invalid.html'
        ;;
      empty-component)
        printf '%s\n' 'diff --git a/doc//sections/02-invalid.html b/doc//sections/02-invalid.html'
        ;;
      empty-path)
        printf '%s\n' 'diff --git a/ b/'
        ;;
      nested)
        printf '%s\n' 'diff --git a/doc/sections/nested/02-invalid.html b/doc/sections/nested/02-invalid.html'
        ;;
      prefix-only)
        printf '%s\n' 'diff --git a/doc/sections-old/02-invalid.html b/doc/sections-old/02-invalid.html'
        ;;
      other-instance)
        printf '%s\n' 'diff --git a/other-document/sections/02-invalid.html b/other-document/sections/02-invalid.html'
        ;;
      absolute)
        printf '%s\n' 'diff --git a//doc/sections/02-invalid.html b//doc/sections/02-invalid.html'
        ;;
      backslash)
        printf '%s\n' 'diff --git "a/doc/sections\\02-invalid.html" "b/doc/sections\\02-invalid.html"'
        ;;
      unsafe-basename)
        printf '%s\n' 'diff --git a/doc/sections/02-Invalid.HTML b/doc/sections/02-Invalid.HTML'
        ;;
      cstyle-traversal)
        printf '%s\n' 'diff --git "a/doc/sections/\056\056/02-invalid.html" "b/doc/sections/\056\056/02-invalid.html"'
        ;;
      cstyle-malformed)
        printf '%s\n' 'diff --git "a/doc/sections/02-invalid\q.html" "b/doc/sections/02-invalid\q.html"'
        ;;
      cstyle-unterminated)
        printf '%s\n' 'diff --git "a/doc/sections/02-invalid.html" "b/doc/sections/02-invalid.html'
        ;;
      *) exit 97 ;;
    esac
    ;;
  *" remote get-url origin "*) exit 2 ;;
  *) exit 98 ;;
esac
SH
chmod +x "$fixture/fakebin-parser/git"
parser_cases=(
  malformed-header
  traversal
  dot-component
  empty-component
  empty-path
  nested
  prefix-only
  other-instance
  absolute
  backslash
  unsafe-basename
  cstyle-traversal
  cstyle-malformed
  cstyle-unterminated
)
for parser_case in "${parser_cases[@]}"; do
  DOCBUILD_GIT_MARKER="$fixture/parser-$parser_case.marker" \
  DOCBUILD_FAKE_ROOT="$repo" DOCBUILD_PATH_CASE="$parser_case" \
  PATH="$fixture/fakebin-parser" \
    "$node_bin" templates/docbuild/dist/cli.js "$repo_rel/doc" \
      | tee "$fixture/parser-$parser_case.out"
  test -e "$fixture/parser-$parser_case.marker"
  grep -Fx "  history          SKIPPED git unavailable or incomplete; using $repo_rel/doc/history.json" \
    "$fixture/parser-$parser_case.out"
  cmp "$fixture/good.history" "$repo/doc/history.json"
  cmp "$fixture/doc.before" "$repo/doc/dist/doc.html"
done

tuple_parent="$repo/invalid\\tuple"
mkdir -p "$tuple_parent"
cp -R "$repo/doc" "$tuple_parent/doc"
tuple_rel="${tuple_parent#"$repo_root"/}/doc"
DOCBUILD_GIT_MARKER="$fixture/parser-invalid-tuple.marker" \
DOCBUILD_FAKE_ROOT="$repo" DOCBUILD_PATH_CASE=valid \
PATH="$fixture/fakebin-parser" \
  "$node_bin" templates/docbuild/dist/cli.js "$tuple_rel" \
    | tee "$fixture/parser-invalid-tuple.out"
test -e "$fixture/parser-invalid-tuple.marker"
grep -Fx "  history          SKIPPED git unavailable or incomplete; using $tuple_rel/history.json" \
  "$fixture/parser-invalid-tuple.out"
cmp "$fixture/good.history" "$tuple_parent/doc/history.json"
echo "PASS  malformed tuple/header and every unsafe decoded/C-style path reject the complete diff"

mkdir "$fixture/fakebin-collision"
cat >"$fixture/fakebin-collision/git" <<'SH'
#!/bin/sh
case " $* " in
  *" rev-parse --show-toplevel "*) printf '%s\n' "$DOCBUILD_FAKE_ROOT" ;;
  *" rev-parse --is-shallow-repository "*) printf '%s\n' false ;;
  *" log "*)
    printf '%s\000\000%s\000%s\000%s\000%s\000\000%s\000%s\000%s\000' \
      aaaaaaa111111111111111111111111111111111 \
      2026-01-21T03:04:05Z \
      'Fixture Writer' \
      'First colliding prefix' \
      aaaaaaa222222222222222222222222222222222 \
      2026-01-20T03:04:05Z \
      'Fixture Writer' \
      'Second colliding prefix'
    ;;
  *" diff-tree "*)
    printf '%s\n' \
      'diff --git a/doc/sections/01-overview.html b/doc/sections/01-overview.html' \
      '--- a/doc/sections/01-overview.html' \
      '+++ b/doc/sections/01-overview.html' \
      '@@ -1 +1 @@' \
      '-old fixture line' \
      '+new fixture line'
    ;;
  *" remote get-url origin "*) exit 2 ;;
  *) exit 98 ;;
esac
SH
chmod +x "$fixture/fakebin-collision/git"
DOCBUILD_FAKE_ROOT="$repo" PATH="$fixture/fakebin-collision" \
  "$node_bin" templates/docbuild/dist/cli.js "$repo_rel/doc" | tee "$fixture/collision.out"
grep -Fx "  history          SKIPPED git unavailable or incomplete; using $repo_rel/doc/history.json" "$fixture/collision.out"
test "$(grep -c '^  history ' "$fixture/collision.out")" -eq 1
cmp "$fixture/good.history" "$repo/doc/history.json"
cmp "$fixture/doc.before" "$repo/doc/dist/doc.html"
echo "PASS  failed Git, parser-rejected paths, and seven-character collisions fall back; Netlify spawns no Git"

TEST_NODE="$node_bin" TEST_INSTANCE="$repo_rel/doc" TEST_HISTORY="$repo/doc/history.json" \
TEST_GOOD="$fixture/good.history" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const node = process.env.TEST_NODE;
const inst = process.env.TEST_INSTANCE;
const file = process.env.TEST_HISTORY;
const goodFile = process.env.TEST_GOOD;
assert.ok(node && inst && file && goodFile);
const good = readFileSync(goodFile, "utf8");
const run = () => spawnSync(node, ["templates/docbuild/dist/cli.js", inst], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, NETLIFY: "true" },
});
const expectFailure = (expected) => {
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `error: ${expected}\n`);
};
const expectSuccess = () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes(`  history          SKIPPED refresh on Netlify; using ${inst}/history.json\n`));
};
const parseGood = () => JSON.parse(good);
const changed = (mutate) => {
  const value = parseGood();
  mutate(value);
  return value;
};
const rootKeys = 'expected exactly keys "doc", "head", "versions"';
const versionKeys = 'expected exactly keys "sha", "date", "author", "subject", "url", "changed"';
const changeKeys = 'expected exactly keys "file", "id", "add", "del", "patch", "clipped"';
const invalidPath = `${inst}/history.json: invalid history at `;
const invalidCases = [
  ["root array", () => [], "$", rootKeys],
  ["missing root key", () => changed((h) => { delete h.doc; }), "$", rootKeys],
  ["extra root key", () => changed((h) => { h.extra = true; }), "$", rootKeys],
  ["non-string doc", () => changed((h) => { h.doc = null; }), "$.doc", "expected the current instance basename"],
  ["empty doc", () => changed((h) => { h.doc = ""; }), "$.doc", "expected the current instance basename"],
  ["uppercase doc", () => changed((h) => { h.doc = "Doc"; }), "$.doc", "expected the current instance basename"],
  ["separator doc", () => changed((h) => { h.doc = "other/doc"; }), "$.doc", "expected the current instance basename"],
  ["wrong-instance doc", () => changed((h) => { h.doc = "other-document"; }), "$.doc", "expected the current instance basename"],
  ["non-string head", () => changed((h) => { h.head = null; }), "$.head", "expected seven lowercase hexadecimal characters"],
  ["short head", () => changed((h) => { h.head = "abc123"; }), "$.head", "expected seven lowercase hexadecimal characters"],
  ["invalid head token", () => changed((h) => { h.head = "BAD"; }), "$.head", "expected seven lowercase hexadecimal characters"],
  ["non-array versions", () => changed((h) => { h.versions = null; }), "$.versions", "expected an array with 1 to 12 items"],
  ["empty versions", () => changed((h) => { h.versions = []; }), "$.versions", "expected an array with 1 to 12 items"],
  ["too many versions", () => changed((h) => { h.versions = Array.from({ length: 13 }, () => structuredClone(h.versions[0])); }), "$.versions", "expected an array with 1 to 12 items"],
  ["non-object version", () => changed((h) => { h.versions[0] = null; }), "$.versions[0]", versionKeys],
  ["missing version key", () => changed((h) => { delete h.versions[0].date; }), "$.versions[0]", versionKeys],
  ["extra version key", () => changed((h) => { h.versions[0].extra = true; }), "$.versions[0]", versionKeys],
  ["non-string sha", () => changed((h) => { h.versions[0].sha = null; }), "$.versions[0].sha", "expected seven lowercase hexadecimal characters"],
  ["short sha", () => changed((h) => { h.versions[0].sha = "abc123"; }), "$.versions[0].sha", "expected seven lowercase hexadecimal characters"],
  ["invalid sha", () => changed((h) => { h.versions[0].sha = "ABC1234"; }), "$.versions[0].sha", "expected seven lowercase hexadecimal characters"],
  ["non-string date", () => changed((h) => { h.versions[0].date = null; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["invalid date", () => changed((h) => { h.versions[0].date = "2026-01-16"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["offset date", () => changed((h) => { h.versions[0].date = "2026-01-16T01:00:00.000+01:00"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["missing milliseconds", () => changed((h) => { h.versions[0].date = "2026-01-16T00:00:00Z"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["expanded-year date", () => changed((h) => { h.versions[0].date = "+010000-01-01T00:00:00.000Z"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["impossible calendar date", () => changed((h) => { h.versions[0].date = "2026-02-30T00:00:00.000Z"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["leap-second date", () => changed((h) => { h.versions[0].date = "2026-01-16T00:00:60.000Z"; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["non-string author", () => changed((h) => { h.versions[0].author = null; }), "$.versions[0].author", "expected a non-empty string"],
  ["empty author", () => changed((h) => { h.versions[0].author = ""; }), "$.versions[0].author", "expected a non-empty string"],
  ["empty subject", () => changed((h) => { h.versions[0].subject = ""; }), "$.versions[0].subject", "expected a non-empty string"],
  ["non-string subject", () => changed((h) => { h.versions[0].subject = null; }), "$.versions[0].subject", "expected a non-empty string"],
  ["non-string URL", () => changed((h) => { h.versions[0].url = null; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["HTTP URL", () => changed((h) => { h.versions[0].url = `http://github.com/example/repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["credential URL", () => changed((h) => { h.versions[0].url = `https://user@github.com/example/repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["alternate-host URL", () => changed((h) => { h.versions[0].url = `https://example.invalid/example/repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["port URL", () => changed((h) => { h.versions[0].url = `https://github.com:443/example/repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["missing-owner URL", () => changed((h) => { h.versions[0].url = `https://github.com//repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["missing-repository URL", () => changed((h) => { h.versions[0].url = `https://github.com/example//commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["dot-owner URL", () => changed((h) => { h.versions[0].url = `https://github.com/./repo/commit/${h.versions[0].sha}${"a".repeat(33)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["dotdot-owner URL", () => changed((h) => { h.versions[0].url = `https://github.com/../repo/commit/${h.versions[0].sha}${"a".repeat(33)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["dot-repository URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/./commit/${h.versions[0].sha}${"a".repeat(33)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["dotdot-repository URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/../commit/${h.versions[0].sha}${"a".repeat(33)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["bad-owner URL", () => changed((h) => { h.versions[0].url = `https://github.com/bad%20owner/repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["bad-repository URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/bad%20repo/commit/${"a".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ...[39, 41, 63, 65].map((length) => [
    `${length}-character object ID`,
    () => changed((h) => { h.versions[0].url = `https://github.com/example/repo/commit/${"a".repeat(length)}`; }),
    "$.versions[0].url",
    "expected an empty string or a safe GitHub commit URL",
  ]),
  ...[40, 64].map((length) => [
    `cross-mismatched ${length}-character object ID`,
    () => changed((h) => {
      const first = h.versions[0].sha[0] === "a" ? "b" : "a";
      h.versions[0].url = `https://github.com/example/repo/commit/${first.repeat(length)}`;
    }),
    "$.versions[0].url",
    "expected an empty string or a safe GitHub commit URL",
  ]),
  ["uppercase object ID", () => changed((h) => { h.versions[0].url = `https://github.com/example/repo/commit/${"A".repeat(40)}`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["query URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/repo/commit/${"a".repeat(40)}?view=1`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["fragment URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/repo/commit/${"a".repeat(40)}#diff`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["trailing-slash URL", () => changed((h) => { h.versions[0].url = `https://github.com/example/repo/commit/${"a".repeat(40)}/`; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["non-array changed", () => changed((h) => { h.versions[0].changed = null; }), "$.versions[0].changed", "expected an array"],
  ["non-object change", () => changed((h) => { h.versions[0].changed[0] = null; }), "$.versions[0].changed[0]", changeKeys],
  ["missing change key", () => changed((h) => { delete h.versions[0].changed[0].add; }), "$.versions[0].changed[0]", changeKeys],
  ["extra change key", () => changed((h) => { h.versions[0].changed[0].extra = true; }), "$.versions[0].changed[0]", changeKeys],
  ...[
    ["empty file", ""],
    ["traversal file", "../01-overview.html"],
    ["slash file", "nested/01-overview.html"],
    ["backslash file", "nested\\01-overview.html"],
    ["uppercase file", "01-Overview.html"],
    ["uppercase extension", "01-overview.HTML"],
    ["wrong extension", "01-overview.md"],
    ["empty-stem file", ".html"],
    ["bad-leading file", "-overview.html"],
    ["space file", "01 overview.html"],
  ].map(([name, value]) => [name, () => changed((h) => { h.versions[0].changed[0].file = value; }), "$.versions[0].changed[0].file", "expected doc.json, extra.css, or a safe lowercase HTML basename"]),
  ...[
    ["empty id", ""],
    ["uppercase id", "Overview"],
    ["dot-leading id", ".overview"],
    ["hyphen-leading id", "-overview"],
    ["slash id", "overview/next"],
    ["backslash id", "overview\\next"],
    ["space id", "overview next"],
  ].map(([name, value]) => [name, () => changed((h) => { h.versions[0].changed[0].id = value; }), "$.versions[0].changed[0].id", "expected a lowercase history identifier"]),
  ["doc id mismatch", () => changed((h) => { h.versions[0].changed[0].file = "doc.json"; h.versions[0].changed[0].id = "overview"; }), "$.versions[0].changed[0].id", "expected the identifier implied by file"],
  ["css id mismatch", () => changed((h) => { h.versions[0].changed[0].file = "extra.css"; h.versions[0].changed[0].id = "overview"; }), "$.versions[0].changed[0].id", "expected the identifier implied by file"],
  ["non-number add", () => changed((h) => { h.versions[0].changed[0].add = null; }), "$.versions[0].changed[0].add", "expected a non-negative safe integer"],
  ["negative add", () => changed((h) => { h.versions[0].changed[0].add = -1; }), "$.versions[0].changed[0].add", "expected a non-negative safe integer"],
  ["fractional add", () => changed((h) => { h.versions[0].changed[0].add = 0.5; }), "$.versions[0].changed[0].add", "expected a non-negative safe integer"],
  ["unsafe add", () => changed((h) => { h.versions[0].changed[0].add = Number.MAX_SAFE_INTEGER + 1; }), "$.versions[0].changed[0].add", "expected a non-negative safe integer"],
  ["non-number del", () => changed((h) => { h.versions[0].changed[0].del = null; }), "$.versions[0].changed[0].del", "expected a non-negative safe integer"],
  ["negative del", () => changed((h) => { h.versions[0].changed[0].del = -1; }), "$.versions[0].changed[0].del", "expected a non-negative safe integer"],
  ["fractional del", () => changed((h) => { h.versions[0].changed[0].del = 0.5; }), "$.versions[0].changed[0].del", "expected a non-negative safe integer"],
  ["unsafe del", () => changed((h) => { h.versions[0].changed[0].del = Number.MAX_SAFE_INTEGER + 1; }), "$.versions[0].changed[0].del", "expected a non-negative safe integer"],
  ["non-string patch", () => changed((h) => { h.versions[0].changed[0].patch = null; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["patch without hunk", () => changed((h) => { h.versions[0].changed[0].patch = "+orphan addition"; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["patch with invalid line", () => changed((h) => { h.versions[0].changed[0].patch = "@@ -1 +1 @@\ninvalid line"; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["patch with CR", () => changed((h) => { h.versions[0].changed[0].patch = "@@ -1 +1 @@\r\n-old"; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["patch with final LF", () => changed((h) => { h.versions[0].changed[0].patch = "@@ -1 +1 @@\n"; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["over-budget patch", () => changed((h) => { h.versions[0].changed[0].patch = `@@ ${"x".repeat(1198)}`; }), "$.versions[0].changed[0].patch", "expected an empty string or canonical diff lines at most 1200 UTF-8 bytes"],
  ["non-boolean clipped", () => changed((h) => { h.versions[0].changed[0].clipped = "false"; }), "$.versions[0].changed[0].clipped", "expected a boolean"],
  ["duplicate file", () => changed((h) => { h.versions[0].changed.push(structuredClone(h.versions[0].changed[0])); }), "$.versions[0].changed", "expected strictly increasing file order"],
  ["descending files", () => changed((h) => {
    const base = h.versions[0].changed[0];
    h.versions[0].changed = [
      { ...base, file: "02-z.html", id: "z" },
      { ...base, file: "01-a.html", id: "a" },
    ];
  }), "$.versions[0].changed", "expected strictly increasing file order"],
  ["duplicate sha", () => changed((h) => { h.versions[1].sha = h.versions[0].sha; }), "$.versions", "expected unique values"],
  ["head mismatch", () => changed((h) => { h.head = h.head === "deadbee" ? "decafed" : "deadbee"; }), "$.head", "expected newest version to match head"],
];

const precedenceCases = [
  ["root keys before doc", () => changed((h) => { h.extra = true; h.doc = null; }), "$", rootKeys],
  ["doc before head", () => changed((h) => { h.doc = "other-document"; h.head = "BAD"; }), "$.doc", "expected the current instance basename"],
  ["head before versions", () => changed((h) => { h.head = "BAD"; h.versions = null; }), "$.head", "expected seven lowercase hexadecimal characters"],
  ["version keys before sha", () => changed((h) => { delete h.versions[0].date; h.versions[0].sha = "BAD"; }), "$.versions[0]", versionKeys],
  ["sha before date", () => changed((h) => { h.versions[0].sha = "BAD"; h.versions[0].date = "bad"; }), "$.versions[0].sha", "expected seven lowercase hexadecimal characters"],
  ["date before author", () => changed((h) => { h.versions[0].date = "bad"; h.versions[0].author = ""; }), "$.versions[0].date", "expected a canonical UTC timestamp"],
  ["author before subject", () => changed((h) => { h.versions[0].author = ""; h.versions[0].subject = ""; }), "$.versions[0].author", "expected a non-empty string"],
  ["subject before URL", () => changed((h) => { h.versions[0].subject = ""; h.versions[0].url = "bad"; }), "$.versions[0].subject", "expected a non-empty string"],
  ["URL before changed", () => changed((h) => { h.versions[0].url = "bad"; h.versions[0].changed = null; }), "$.versions[0].url", "expected an empty string or a safe GitHub commit URL"],
  ["change keys before file", () => changed((h) => { delete h.versions[0].changed[0].add; h.versions[0].changed[0].file = "bad"; }), "$.versions[0].changed[0]", changeKeys],
  ["file before id", () => changed((h) => { h.versions[0].changed[0].file = "bad"; h.versions[0].changed[0].id = "BAD"; }), "$.versions[0].changed[0].file", "expected doc.json, extra.css, or a safe lowercase HTML basename"],
  ["id lexical before relation", () => changed((h) => { h.versions[0].changed[0].file = "doc.json"; h.versions[0].changed[0].id = "BAD"; }), "$.versions[0].changed[0].id", "expected a lowercase history identifier"],
  ["id relation before add", () => changed((h) => { h.versions[0].changed[0].file = "doc.json"; h.versions[0].changed[0].id = "overview"; h.versions[0].changed[0].add = -1; }), "$.versions[0].changed[0].id", "expected the identifier implied by file"],
  ["add before del", () => changed((h) => { h.versions[0].changed[0].add = -1; h.versions[0].changed[0].del = -1; }), "$.versions[0].changed[0].add", "expected a non-negative safe integer"],
  ["duplicate SHA before head relation", () => changed((h) => { h.versions[1].sha = h.versions[0].sha; h.head = "deadbee"; }), "$.versions", "expected unique values"],
];

writeFileSync(file, "{\n");
expectFailure(`${inst}/history.json: invalid JSON`);

const h = parseGood();
writeFileSync(file, `${JSON.stringify(h)}\n`);
expectFailure(`${inst}/history.json: history.json is not canonical`);
for (const [name, formatted] of [
  ["missing terminal LF", good.slice(0, -1)],
  ["CRLF", good.replaceAll("\n", "\r\n")],
  ["two terminal LFs", `${good}\n`],
  ["tab indentation", `${JSON.stringify(h, null, "\t")}\n`],
  ["reordered root keys", `${JSON.stringify({ head: h.head, doc: h.doc, versions: h.versions }, null, 2)}\n`],
]) {
  writeFileSync(file, formatted);
  expectFailure(`${inst}/history.json: history.json is not canonical`);
  process.stdout.write(`PASS  validator rejects ${name} formatting\n`);
}

for (const [name, make, path, expectation] of invalidCases) {
  writeFileSync(file, `${JSON.stringify(make(), null, 2)}\n`);
  expectFailure(`${invalidPath}${path}: ${expectation}`);
  process.stdout.write(`PASS  validator rejects ${name} with the exact diagnostic\n`);
}
for (const [name, make, path, expectation] of precedenceCases) {
  writeFileSync(file, `${JSON.stringify(make(), null, 2)}\n`);
  expectFailure(`${invalidPath}${path}: ${expectation}`);
  process.stdout.write(`PASS  validator preserves ${name}\n`);
}

for (const length of [0, 40, 64]) {
  const validURL = parseGood();
  validURL.versions[0].url = length === 0
    ? ""
    : `https://github.com/owner._-/repo._-/commit/${validURL.versions[0].sha}${"a".repeat(length - 7)}`;
  writeFileSync(file, `${JSON.stringify(validURL, null, 2)}\n`);
  expectSuccess();
}
for (const clipped of [false, true]) {
  const emptyPatch = parseGood();
  emptyPatch.versions = [emptyPatch.versions[0]];
  emptyPatch.head = emptyPatch.versions[0].sha;
  emptyPatch.versions[0].changed = [{
    ...emptyPatch.versions[0].changed[0],
    patch: "",
    clipped,
  }];
  writeFileSync(file, `${JSON.stringify(emptyPatch, null, 2)}\n`);
  expectSuccess();
}
const emptyChanged = parseGood();
emptyChanged.versions = [emptyChanged.versions[0]];
emptyChanged.head = emptyChanged.versions[0].sha;
emptyChanged.versions[0].changed = [];
writeFileSync(file, `${JSON.stringify(emptyChanged, null, 2)}\n`);
expectSuccess();
const twelveVersions = parseGood();
assert.equal(twelveVersions.versions.length, 12);
writeFileSync(file, `${JSON.stringify(twelveVersions, null, 2)}\n`);
expectSuccess();
const validScalarBoundaries = parseGood();
validScalarBoundaries.versions = [validScalarBoundaries.versions[0]];
validScalarBoundaries.head = validScalarBoundaries.versions[0].sha;
const baseChange = validScalarBoundaries.versions[0].changed[0];
validScalarBoundaries.versions[0].changed = [
  { ...baseChange, file: "a._-0.html", id: "a._-0", add: 0, del: Number.MAX_SAFE_INTEGER, patch: `@@ ${"x".repeat(1197)}`, clipped: false },
  { ...baseChange, file: "doc.json", id: "doc" },
  { ...baseChange, file: "extra.css", id: "extra" },
];
writeFileSync(file, `${JSON.stringify(validScalarBoundaries, null, 2)}\n`);
expectSuccess();

const exactBudget = parseGood();
exactBudget.versions = [exactBudget.versions[0]];
exactBudget.head = exactBudget.versions[0].sha;
exactBudget.versions[0].url = "";
exactBudget.versions[0].changed = [];
exactBudget.versions[0].subject = "x";
const exactBase = Buffer.byteLength(JSON.stringify(exactBudget).split("</").join("<\\/"), "utf8");
exactBudget.versions[0].subject += "x".repeat((16 * 1024) - exactBase);
assert.equal(Buffer.byteLength(JSON.stringify(exactBudget).split("</").join("<\\/"), "utf8"), 16 * 1024);
writeFileSync(file, `${JSON.stringify(exactBudget, null, 2)}\n`);
expectSuccess();

const escapedOverflow = parseGood();
escapedOverflow.versions = [escapedOverflow.versions[0]];
escapedOverflow.head = escapedOverflow.versions[0].sha;
escapedOverflow.versions[0].url = "";
escapedOverflow.versions[0].changed = [];
escapedOverflow.versions[0].subject = "</".repeat(5_400);
const rawCompactBytes = Buffer.byteLength(JSON.stringify(escapedOverflow), "utf8");
const escapedCompactBytes = Buffer.byteLength(JSON.stringify(escapedOverflow).split("</").join("<\\/"), "utf8");
assert.ok(rawCompactBytes <= 16 * 1024);
assert.ok(escapedCompactBytes > 16 * 1024);
writeFileSync(file, `${JSON.stringify(escapedOverflow, null, 2)}\n`);
expectFailure(`${inst}/history.json: embedded history is ${escapedCompactBytes} bytes; maximum is 16384`);

const over = parseGood();
over.versions[0].changed = Array.from({ length: 20 }, (_, i) => ({
  file: `x${String(i).padStart(2, "0")}.html`,
  id: `x${String(i).padStart(2, "0")}`,
  add: 1,
  del: 0,
  patch: `@@ ${"x".repeat(1197)}`,
  clipped: true,
}));
const overRaw = `${JSON.stringify(over, null, 2)}\n`;
writeFileSync(file, overRaw);
const bytes = Buffer.byteLength(JSON.stringify(over).split("</").join("<\\/"), "utf8");
assert.ok(bytes > 16 * 1024);
expectFailure(`${inst}/history.json: embedded history is ${bytes} bytes; maximum is 16384`);

writeFileSync(file, good);
console.log("PASS  enumerated closed-schema predicates, boundaries, precedence, formatting, and budgets are exact");
NODE

FIXTURE_FILE="$repo/doc/sections/01-overview.html" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.FIXTURE_FILE;
if (!file) throw new Error("missing fixture file");
const raw = readFileSync(file, "utf8");
const next = raw.replace(/change-16/, "atomic-write-change");
if (next === raw) throw new Error("atomic fixture did not change");
writeFileSync(file, next);
NODE
git -C "$repo" add doc/sections/01-overview.html
GIT_AUTHOR_DATE=2026-01-19T03:04:05Z \
GIT_COMMITTER_DATE=2026-01-19T03:04:05Z \
git -C "$repo" commit -q -m "Exercise atomic refresh"
cp "$repo/doc/history.json" "$fixture/atomic.before"
ln -s "$repo" "$fixture/repo-alias"
alias_rel="${fixture#"$repo_root"/}/repo-alias/doc"
PARSER_PROBE="$fixture/parser-probe/history.js" TEST_INSTANCE="$alias_rel" \
TEST_HISTORY="$repo/doc/history.json" TEST_BEFORE="$fixture/atomic.before" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PARSER_PROBE;
const inst = process.env.TEST_INSTANCE;
const file = process.env.TEST_HISTORY;
const before = process.env.TEST_BEFORE;
assert.ok(modulePath && inst && file && before);
delete process.env.NETLIFY;
const { history, historyIO, refresh, trim } = await import(pathToFileURL(modulePath).href);
const originals = { ...historyIO };
const prior = readFileSync(before);
const error = (code) => Object.assign(new Error(`invented ${code} failure`), { code });
const targetDir = dirname(file);
assert.equal(realpathSync(dirname(inst)), realpathSync(dirname(dirname(file))));
const baselineSiblings = new Set(readdirSync(targetDir));
const addedSiblings = () => readdirSync(targetDir).filter((name) => !baselineSiblings.has(name));
const expectedHistory = history(inst);
assert.ok(expectedHistory);
trim(expectedHistory);
const expectedBytes = Buffer.from(`${JSON.stringify(expectedHistory, null, 2)}\n`);

Object.assign(historyIO, originals);
let comparisonPath;
historyIO.read = (path) => { comparisonPath = path; throw error("EIO"); };
const readFailureOutput = [];
const savedLog = console.log;
console.log = (...values) => readFailureOutput.push(values.join(" "));
try {
  assert.throws(
    () => refresh(inst),
    (thrown) => thrown?.message === `${inst}/history.json: cannot read history.json (EIO)`,
  );
} finally {
  console.log = savedLog;
}
Object.assign(historyIO, originals);
assert.equal(comparisonPath, file);
assert.deepEqual(readFailureOutput, []);
assert.deepEqual(readFileSync(file), prior);
assert.deepEqual(addedSiblings(), []);

const operations = [];
let openedFd;
let tempPath;
historyIO.read = (path) => { operations.push(["read", path]); return originals.read(path); };
historyIO.open = (path, flags, mode) => {
  operations.push(["open", path, flags, mode]);
  tempPath = path;
  openedFd = originals.open(path, flags, mode);
  return openedFd;
};
historyIO.write = (fd, data) => { operations.push(["write", fd, Buffer.from(data)]); return originals.write(fd, data); };
historyIO.sync = (fd) => { operations.push(["sync", fd]); return originals.sync(fd); };
historyIO.close = (fd) => { operations.push(["close", fd]); return originals.close(fd); };
historyIO.replace = (from, to) => { operations.push(["replace", from, to]); throw error("EXDEV"); };
historyIO.remove = (path) => { operations.push(["remove", path]); return originals.remove(path); };
const operationOutput = [];
const operationLog = console.log;
console.log = (...values) => operationOutput.push(values.join(" "));
try {
  assert.throws(
    () => refresh(inst),
    (thrown) => thrown?.message === `${inst}/history.json: cannot replace history.json (EXDEV)`,
  );
} finally {
  console.log = operationLog;
}
Object.assign(historyIO, originals);
assert.deepEqual(operationOutput, []);
assert.deepEqual(operations.map(([name]) => name), ["read", "open", "write", "sync", "close", "replace", "remove"]);
assert.equal(operations[0][1], file);
assert.equal(dirname(tempPath), targetDir);
assert.match(basename(tempPath), new RegExp(`^history\\.json\\.tmp-${process.pid}-[0-9a-f]{12}$`));
assert.deepEqual(operations[1], ["open", tempPath, "wx", 0o644]);
assert.equal(operations[2][1], openedFd);
assert.deepEqual(operations[2][2], expectedBytes);
assert.deepEqual(operations[3], ["sync", openedFd]);
assert.deepEqual(operations[4], ["close", openedFd]);
assert.deepEqual(operations[5], ["replace", tempPath, file]);
assert.deepEqual(operations[6], ["remove", tempPath]);
assert.deepEqual(readFileSync(file), prior);
assert.deepEqual(addedSiblings(), []);

const cases = [
  ["create", "open", "EACCES"],
  ["write", "write", "EIO"],
  ["sync", "sync", "EIO"],
  ["close", "close", "EIO"],
];

for (const [label, method, code] of cases) {
  Object.assign(historyIO, originals);
  if (method === "close") {
    historyIO.close = (fd) => {
      originals.close(fd);
      throw error(code);
    };
  } else {
    historyIO[method] = () => { throw error(code); };
  }
  const expected = label === "replace"
    ? `${inst}/history.json: cannot replace history.json (${code})`
    : `${inst}/history.json: cannot ${label} temporary history.json (${code})`;
  const output = [];
  const originalLog = console.log;
  console.log = (...values) => output.push(values.join(" "));
  try {
    assert.throws(
      () => refresh(inst),
      (thrown) => thrown?.message === expected,
      label,
    );
  } finally {
    console.log = originalLog;
  }
  Object.assign(historyIO, originals);
  assert.deepEqual(output, [], `${label}: emitted buffered trim or status output`);
  assert.deepEqual(readFileSync(file), prior, `${label}: target changed`);
  assert.deepEqual(addedSiblings(), [], `${label}: unexpected sibling remained`);
}

Object.assign(historyIO, originals);
historyIO.write = () => { throw error("EIO"); };
historyIO.remove = () => { throw error("EPERM"); };
const cleanupOutput = [];
const originalLog = console.log;
console.log = (...values) => cleanupOutput.push(values.join(" "));
try {
  assert.throws(
    () => refresh(inst),
    (thrown) => thrown?.message === `${inst}/history.json: cannot write temporary history.json (EIO)`,
  );
} finally {
  console.log = originalLog;
}
Object.assign(historyIO, originals);
assert.deepEqual(cleanupOutput, [], "cleanup failure emitted buffered trim or status output");
assert.deepEqual(readFileSync(file), prior, "cleanup failure changed target");
const cleanupRemainder = addedSiblings();
assert.equal(cleanupRemainder.length, 1);
assert.match(cleanupRemainder[0], new RegExp(`^history\\.json\\.tmp-${process.pid}-[0-9a-f]{12}$`));
originals.remove(join(targetDir, cleanupRemainder[0]));
assert.deepEqual(addedSiblings(), []);
console.log("PASS  atomic failures retain primary diagnostics/output order; cleanup failure never masks primary");
NODE
templates/build "$repo_rel/doc" | tee "$fixture/atomic-success.out"
grep -Fx "  history          WROTE $repo_rel/doc/history.json" "$fixture/atomic-success.out"
test "$(grep -c '^  history ' "$fixture/atomic-success.out")" -eq 2

HISTORY_FILE="$repo/doc/history.json" node --input-type=module <<'NODE'
import { utimesSync } from "node:fs";
const file = process.env.HISTORY_FILE;
if (!file) throw new Error("missing history path");
utimesSync(file, 946684800, 946684800);
NODE
templates/build "$repo_rel/doc" | tee "$fixture/repeat.out"
grep -Fx "  history          UNCHANGED $repo_rel/doc/history.json" "$fixture/repeat.out"
test "$(grep -c '^  history ' "$fixture/repeat.out")" -eq 1
HISTORY_FILE="$repo/doc/history.json" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { statSync } from "node:fs";
const file = process.env.HISTORY_FILE;
assert.ok(file);
assert.equal(statSync(file).mtimeMs, 946684800000);
console.log("PASS  successful atomic refresh is stable and UNCHANGED preserves mtime");
NODE

cp "$repo/doc/history.json" "$fixture/determinism.before"
(
  cd "$fixture"
  LC_ALL=C LANG=fr_FR.UTF-8 TZ=UTC0 \
    "$node_bin" "$repo_root/templates/docbuild/dist/cli.js" "source/doc" \
    >"$fixture/determinism.out"
)
grep -Fx "  history          UNCHANGED source/doc/history.json" "$fixture/determinism.out"
test "$(grep -c '^  history ' "$fixture/determinism.out")" -eq 1
cmp "$fixture/determinism.before" "$repo/doc/history.json"
HISTORY_FILE="$repo/doc/history.json" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { statSync } from "node:fs";
const file = process.env.HISTORY_FILE;
assert.ok(file);
assert.equal(statSync(file).mtimeMs, 946684800000);
console.log("PASS  alternate cwd, locale, timezone, and mtime reproduce unchanged bytes");
NODE

mode_a_stage="$fixture/repository-free-promotion"
mkdir "$mode_a_stage"
cat >"$mode_a_stage/history.json" <<'JSON'
{
  "doc": "repository-free-promotion",
  "head": "a11ce55",
  "versions": [
    {
      "sha": "a11ce55",
      "date": "2026-02-03T04:05:06.000Z",
      "author": "Example Suggester",
      "subject": "Promote the accepted wording",
      "url": "",
      "changed": [
        {
          "file": "01-overview.html",
          "id": "overview",
          "add": 1,
          "del": 1,
          "patch": "@@ -1 +1 @@\n-old wording\n+accepted wording",
          "clipped": false
        }
      ]
    }
  ]
}
JSON
mode_a_stage_rel="${mode_a_stage#"$repo_root"/}"
cp "$mode_a_stage/history.json" "$fixture/repository-free-promotion.before"
HISTORY_FILE="$mode_a_stage/history.json" node --input-type=module <<'NODE'
import { utimesSync } from "node:fs";
const file = process.env.HISTORY_FILE;
if (!file) throw new Error("missing repository-free history path");
utimesSync(file, 946684800, 946684800);
NODE
if GIT_CEILING_DIRECTORIES="$mode_a_stage" git -C "$mode_a_stage" rev-parse --show-toplevel \
  >"$fixture/repository-free-git.out" 2>"$fixture/repository-free-git.err"; then
  echo "expected repository-free promotion fixture to have no discoverable Git root" >&2
  exit 1
fi
GIT_CEILING_DIRECTORIES="$mode_a_stage" MODE_A_STAGE="$mode_a_stage" \
MODE_A_STAGE_REL="$mode_a_stage_rel" REPO_ROOT="$repo_root" \
  "$node_bin" --input-type=module <<'NODE' | tee "$fixture/repository-free.out"
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { refresh } from "./templates/docbuild/dist/history.js";

const stage = process.env.MODE_A_STAGE;
const stageRel = process.env.MODE_A_STAGE_REL;
const root = process.env.REPO_ROOT;
assert.ok(stage && stageRel && root);
const file = join(stage, "history.json");
const before = readFileSync(file);
const value = refresh(stage);
assert.deepEqual(value, JSON.parse(before.toString("utf8")));
assert.deepEqual(readFileSync(file), before);
assert.equal(statSync(file).mtimeMs, 946684800000);

const historySource = readFileSync(join(root, "templates/docbuild/src/history.ts"), "utf8");
const indexSource = readFileSync(join(root, "templates/docbuild/src/index.ts"), "utf8");
assert.equal(
  (historySource.match(/export function refresh\(inst: string\): History \| null/g) ?? []).length,
  1,
);
assert.equal((indexSource.match(/\brefresh\(inst\)/g) ?? []).length, 1);
assert.match(
  indexSource,
  /import\s*\{\s*(?:changelogSection\s*,\s*refresh|refresh\s*,\s*changelogSection)\s*\}\s*from\s*"\.\/history\.js";/,
);
const trackedSources = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"],
  { cwd: root },
).toString("utf8").split("\0").filter(Boolean)
  .filter((path) => !path.includes("/dist/") && !path.startsWith("docs/"));
const refreshImporters = trackedSources.filter((path) => {
  const source = readFileSync(join(root, path), "utf8");
  return /import\s*\{[^}]*\brefresh\b[^}]*\}\s*from\s*["'][^"']*history\.js["']/.test(source);
});
assert.deepEqual(refreshImporters, ["templates/docbuild/src/index.ts"]);
console.log("PASS  repository-free promotion history is read-only and refresh keeps its sole Mode B caller");
NODE
grep -Fx "  history          SKIPPED git unavailable or incomplete; using $mode_a_stage_rel/history.json" \
  "$fixture/repository-free.out"
grep -Fx "PASS  repository-free promotion history is read-only and refresh keeps its sole Mode B caller" \
  "$fixture/repository-free.out"
test "$(grep -c '^  history ' "$fixture/repository-free.out")" -eq 1
cmp "$fixture/repository-free-promotion.before" "$mode_a_stage/history.json"
test "$(find "$mode_a_stage" -mindepth 1 -maxdepth 1 -type f -name 'history.json.tmp-*' | wc -l | tr -d '[:space:]')" -eq 0

echo "PASS  complete disposable P2-E history matrix"
P2E_HISTORY_WORKER
```

Expected: the command exits zero and prints every `PASS` line. The first history has two versions with a non-empty three-file root creation diff, canonical UTC time, current section ID without label, safe full-SHA URL, literal `</script>` in committed JSON, `<\/script>` in embedded JSON, and both byte budgets satisfied; embedded JSON deep-equals the committed value. Its source label is the same escaping fixture used by the independent, fixed renderer input and hard-coded expected markup. Those assertions prove complete section fields, peek/disclosure/changed/patch structure, optional-link placement, current-label links, filename fallbacks, applicable element-text escaping, closed safe attribute placement, version order, and exact reserved/duplicate-ID `BuildError`s; the generated HTML contains the corresponding live structure inside the one ordinary changelog section and one jump-navigation entry. The production module exposes exactly `refresh` and `changelogSection`, while static source oracles verify the three interfaces, five private signatures, constants, P1-B import, and both private seam shapes. The initial zero-drop write emits only `WROTE`. The extended history retains exactly changes 16 through 5; all long patches are Unicode-safe and at most 1,200 bytes; cleared bodies form only an oldest suffix; the newest patch remains; and the embedded payload is at most 16,384 bytes. Its exact `dropped 2 old diff bodies` line is immediately before `WROTE` with no extra history status.

The exact log/diff command assertions prove that only the immutable repository-root-relative three-path tuple can select history: root discovery alone uses the canonical instance cwd, while the shallow/log/remote/diff calls use the canonical repository root. Committed `history.json` and another document are representative outside-path commits whose bytes, `head`, and forced mtime remain unchanged. Missing or mismatched public-history approval stops before any diff and falls back. The shallow clone prints the Git-incomplete fallback and preserves committed bytes/mtime. The failed-Git run creates its marker and falls back; Netlify never creates its marker. Separate no-history instances prove exact local and Netlify absence lines; a directory and an exact final symlink prove the non-regular/non-symbolic-link diagnostic and that an external target is not followed or changed. The repository-free promotion fixture uses Git's ceiling to prove that no repository root is discoverable, supplies an invented canonical P4-R-style row, and proves fallback returns its value while preserving exact bytes, mtime, and absence of temporary siblings. Its static assertions preserve the exact public signature and P1-B's sole integrated `refresh(inst)` call; P4-R remains responsible for the reciprocal no-docbuild assertion when its Mode A tool exists. A temporary instrumented copy proves absent/timeout/signal/nonzero/max-buffer/non-string Git outcomes, exact spawn options and literal pathspec bytes, every documented remote class, exact Git cwd/arrays, and first-parent-only merge diffing. It also proves tuple/path authority, multi-hunk stats, valid mode-only/empty-file/binary header-only records, malformed and duplicate rejection, Unicode clipping, quoted escapes, and invalid UTF-8/octal input. Malformed log/scalars/parents, required diff failures, invalid/duplicate parsed IDs, and CR-bearing patches make the complete fresh attempt `null`; an empty required diff produces the documented empty `changed` list. The synthetic retention value proves the exact oldest-first body-drop order and newest-preserving hard failure. The fake-Git path matrix rejects the listed ownership attacks without changing committed output, and a second fake log proves colliding seven-character prefixes reject the complete attempt.

The data-driven committed-input matrix covers the declared object keys, scalar/container predicates, one/twelve/zero/thirteen version boundaries, empty `changed`, empty patches with both `clipped` values, ordering/cross-field precedence, URL lengths, dot/dotdot owner/repository tokens, URL-to-row object-ID prefix mismatches, exact 1,200-byte patch acceptance, invalid JSON, canonical formatting variants, exact 16,384-byte escaped compact acceptance, and escaped-overflow rejection using literal `</`. It claims those enumerated boundaries, not every possible JSON value. The isolated private-I/O seam deterministically fails comparison read, create, write, sync, close, and replace; spies assert the canonical real target under an ancestor symlink, exact temp name/flags/mode/bytes/call order/rename/removal, preserve the prior target, catch any new sibling, and preserve primary errors when cleanup itself fails. Subsequent success and exact `UNCHANGED` runs prove recovery, alternate cwd/locale/time-zone reproducibility, and unchanged mtime.

Cleanup is part of the test. Before any parent resolution or root creation, the outer Node process installs a first-signal HUP/INT/TERM latch and immediately maps it to 129/130/143. It creates the exact mode-0700 `.history-fixture.??????` root directly below the resolved repository root and publishes sibling mode-0600 `preparing` evidence by write, exact chmod, file fsync, rename, and parent-directory fsync before yielding. A detached retained launcher first sends an authenticated nonce-bearing ready message; the owner proves its live PID equals its PGID, durably publishes `running` with that PGID through the same transaction, and only then sends authenticated `start`, so Bash cannot begin earlier. Natural completion, error, timeout, or signal drives TERM, bounded KILL escalation, launcher exit and `close`/IPC closure, and verified group disappearance before deletion begins. The separately detached deletion launcher follows the same authenticated ready/current-anchor/durable-`deleting`/start sequence and is likewise bounded and proved closed and absent. A direct terminal signal overrides a later distinct signal, timeout 124, and manual-containment 125 through every cleanup phase and the final event-loop yield; 125 is used only when no terminal signal was latched.

The Bash process still installs `finish` and its signal handlers before validating the exact supplied parent/template/root. Every worker success, error, or group signal reaches `cleanup` exactly once through `finish`; `finish` clears every trap, preserves a prior nonzero status, and otherwise explicitly exits with the validation cleanup status. `cleanup` verifies the exact parent, `.history-fixture.??????` basename, live 32-hex outer-owner nonce, and still-present root but deliberately leaves deletion to the outer owner. Recursive executions prove direct HUP/INT/TERM during pre-launch, active-worker, post-result, pre-deletion, deletion, post-root-removal, timeout, manual-containment, and early-deletion-failure windows; three explicit first/later signal pairs prove first-signal precedence. They also invoke the real evidence write/chmod/rename operation seams and leave an actual truncated `.new` before recovering all four cases to a complete mode-0600 manual record with no `.new` remainder. Natural Bash HUP/INT/TERM/KILL statuses, timeout 124, ordinary status 23, resistant descendants, and parent-exit descendants remain covered.

The recursive harness owns its wrapper as another detached process group before supplying the exact worker source. Missing handshakes and overruns may signal only that retained direct `ChildProcess` while a current PID=PGID proof succeeds. It never signals an evidence/message-derived inner PGID or any stale bare number. If the wrapper cannot finish its own inner containment within the bound, the harness atomically retains manual-remediation evidence, detaches the still-live direct handle, and fails rather than guessing at ownership. Completed wrappers require exit, stream/IPC closure, and group disappearance. An indeterminate state, deletion failure, or injected evidence-operation failure retains the guarded root and mode-0600 record whenever persistence is possible. The exact safe locator remains actionable; a terminal signal keeps its first 129/130/143 result despite retention, otherwise the result is 125. Successful probe cleanup uses the same bounded deletion owner only for deliberate artifacts. Never replace the root guard with a glob or remove a broader path.

### Real repository gates

After integrating intended source and generating both committed histories/compiler/HTML products, run:

```bash
: "${DOCBUILD_PUBLIC_HISTORY_APPROVED:?set to the separately reviewed public GitHub origin slug}"
P2E_FIXTURE_FAMILY=repeat P2E_FIXTURE_DEADLINE_MS=600000 \
node --input-type=module --eval '
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const family = process.env.P2E_FIXTURE_FAMILY ?? "";
const deadlineText = process.env.P2E_FIXTURE_DEADLINE_MS ?? "";
const probeMode = process.env.P2E_FIXTURE_PROBE ?? "";
if (!["history", "repeat"].includes(family)
  || !/^[1-9][0-9]{3,6}$/.test(deadlineText)
  || !["", "early", "early-delete-failure", "signal", "terminal", "delete", "final", "timeout-signal",
    "timeout", "resistant", "parent-exit", "manual", "delete-failure",
    "evidence-write-failure", "evidence-chmod-failure", "evidence-rename-failure",
    "evidence-partial-failure", "missing-handshake", "overrun", "natural", "status"].includes(probeMode)
  || (probeMode !== "" && (typeof process.send !== "function"
    || !/^[0-9a-f]{32}$/.test(process.env.P2E_PROBE_NONCE ?? "")))) {
  throw new Error("invalid P2-E fixture supervisor invocation");
}
const deadlineMilliseconds = Number(deadlineText);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SIGNAL_STATUS = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGKILL: 137, SIGTERM: 143 });
const probeNonce = process.env.P2E_PROBE_NONCE ?? "";
const publish = (message) => process.send({ ...message, nonce: probeNonce });
let latchedSignalStatus = 0;
let timedOut = false;
let interruptResolve;
const interrupted = new Promise((resolve) => { interruptResolve = resolve; });
for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signalName, () => {
    if (latchedSignalStatus !== 0) return;
    latchedSignalStatus = SIGNAL_STATUS[signalName];
    process.exitCode = latchedSignalStatus;
    interruptResolve({ kind: "signal", signal: signalName });
  });
}
function finalStatus(fallback, manual = false) {
  return latchedSignalStatus || (manual ? 125 : (timedOut ? 124 : fallback));
}

const rootParent = realpathSync(family === "history" ? process.cwd() : process.env.TMPDIR || "/tmp");
const rootPrefix = family === "history" ? ".history-fixture." : "p2-e-repeat.";
const launcherSource = `
  import { spawn } from "node:child_process";
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signalName, () => {});
  const nonce = process.env.P2E_LAUNCH_NONCE ?? "";
  if (!/^[0-9a-f]{32}$/.test(nonce) || typeof process.send !== "function") process.exit(127);
  process.send({ type: "ready", nonce, pid: process.pid });
  process.once("message", (message) => {
    if (message?.type !== "start" || message?.nonce !== nonce) return process.exit(127);
    const silentProbe = (process.env.P2E_FIXTURE_PROBE ?? "") !== "";
    const child = spawn("bash", ["/dev/fd/3"], { env: process.env,
      stdio: ["ignore", silentProbe ? "ignore" : "inherit",
        silentProbe ? "ignore" : "inherit", "inherit"] });
    child.once("spawn", () => process.send({ type: "launched", nonce }));
    child.once("error", () => process.send({ type: "result", nonce, code: null,
      signal: null, spawnError: true }));
    child.once("exit", (code, signal) => process.send({ type: "result", nonce, code,
      signal, spawnError: false }));
  });
  setInterval(() => {}, 60000);
`;
const deleteLauncherSource = `
  import { spawn } from "node:child_process";
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signalName, () => {});
  const nonce = process.env.P2E_DELETE_NONCE ?? "";
  if (!/^[0-9a-f]{32}$/.test(nonce) || typeof process.send !== "function") process.exit(127);
  process.send({ type: "ready", nonce, pid: process.pid });
  process.once("message", (message) => {
    if (message?.type !== "start" || message?.nonce !== nonce) return process.exit(127);
    const source = process.argv[1] === "1"
      ? "setInterval(() => {}, 60000)"
      : "import { rmSync } from \\\"node:fs\\\"; rmSync(process.argv[1], { recursive: true, force: true })";
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source,
      process.argv[2]], { stdio: "ignore" });
    child.once("spawn", () => process.send({ type: "launched", nonce }));
    child.once("error", () => process.send({ type: "result", nonce, code: null, signal: null }));
    child.once("exit", (code, signal) => process.send({ type: "result", nonce, code, signal }));
  });
  setInterval(() => {}, 60000);
`;

function rootIsGuarded(root) {
  if (!root || root === rootParent || root.slice(0, root.lastIndexOf("/")) !== rootParent) return false;
  const name = root.slice(root.lastIndexOf("/") + 1);
  return name.startsWith(rootPrefix)
    && /^[A-Za-z0-9]{6}$/.test(name.slice(rootPrefix.length));
}
function groupAlive(groupId) {
  try { process.kill(-groupId, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
function processGroup(pid) {
  const value = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^[0-9]+$/.test(value)) throw new Error("process group unavailable");
  return Number(value);
}
function currentAnchor(leader, groupId) {
  if (!leader || leader.pid !== groupId || leader.exitCode !== null || leader.signalCode !== null) return false;
  try { process.kill(groupId, 0); return processGroup(groupId) === groupId; }
  catch { return false; }
}
function signalGroup(groupId, signalName) {
  assert.ok(Number.isSafeInteger(groupId) && groupId > 1);
  try { process.kill(-groupId, signalName); }
  catch (error) { if (error?.code !== "ESRCH") throw error; }
}
async function groupGone(groupId, milliseconds) {
  const end = Date.now() + milliseconds;
  while (groupAlive(groupId) && Date.now() < end) await pause(25);
  return !groupAlive(groupId);
}
const evidenceIO = {
  write: writeFileSync, chmod: chmodSync, replace: renameSync,
  open: openSync, sync: fsyncSync, close: closeSync,
};
function syncEvidencePath(path) {
  let descriptor;
  try {
    descriptor = evidenceIO.open(path, "r");
    evidenceIO.sync(descriptor);
  } finally {
    if (descriptor !== undefined) evidenceIO.close(descriptor);
  }
}
function persistEvidence(context, state, failure = "") {
  const pending = `${context.evidencePath}.new`;
  const bytes = `${JSON.stringify({ ...context, state })}\n`;
  const write = failure === "write" ? () => { throw new Error("injected evidence write failure"); }
    : evidenceIO.write;
  const chmod = failure === "chmod" ? () => { throw new Error("injected evidence chmod failure"); }
    : evidenceIO.chmod;
  const replace = failure === "rename" ? () => { throw new Error("injected evidence rename failure"); }
    : evidenceIO.replace;
  write(pending, failure === "partial" ? bytes.slice(0, 7) : bytes, { mode: 0o600 });
  if (failure === "partial") throw new Error("injected partial evidence write failure");
  chmod(pending, 0o600);
  syncEvidencePath(pending);
  replace(pending, context.evidencePath);
  syncEvidencePath(dirname(context.evidencePath));
}
function manualDiagnostic(context) {
  console.error(`ERROR  P2-E ${family} fixture cleanup is unproved; root=${context.root} evidence=${context.evidencePath} supervisor-pid=${context.supervisorPid} leader-pgid=${context.leaderPgid ?? "unassigned"}; manual remediation required`);
}
function removeIfPresent(path) {
  try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
const terminations = new WeakMap();
async function terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed) {
  if (terminations.has(leader)) return terminations.get(leader);
  const operation = (async () => {
    let signalFailure = false;
    if (!currentAnchor(leader, groupId)) return { complete: false, ownership: false };
    try { signalGroup(groupId, "SIGTERM"); } catch { signalFailure = true; }
    const afterTerm = await within(leaderResult, probeMode === "" ? 1000 : 100);
    if (afterTerm === null) {
      if (!currentAnchor(leader, groupId)) return { complete: false, ownership: false };
      try { signalGroup(groupId, "SIGKILL"); } catch { signalFailure = true; }
    }
    const reaped = afterTerm !== null || await within(leaderResult, 5000) !== null;
    const closed = reaped && await within(leaderClosed, 5000) !== null;
    const disappeared = closed && await groupGone(groupId, 5000);
    return { complete: probeMode !== "manual" && !signalFailure && reaped && closed && disappeared,
      ownership: true, reaped, closed, disappeared };
  })();
  terminations.set(leader, operation);
  return operation;
}
function outcomeStatus(outcome) {
  if (outcome.kind === "signal") return SIGNAL_STATUS[outcome.signal] ?? 127;
  if (outcome.kind === "deadline") return 124;
  if (outcome.kind === "result") {
    if (outcome.spawnError) return 127;
    if (outcome.signal) return SIGNAL_STATUS[outcome.signal] ?? 127;
    return Number.isSafeInteger(outcome.code) && outcome.code >= 0
      && outcome.code <= 255 && outcome.code !== 125 ? outcome.code : 127;
  }
  return 127;
}
async function removeRootBounded(root) {
  const deleteNonce = randomBytes(16).toString("hex");
  const leader = spawn(process.execPath, ["--input-type=module", "--eval",
    deleteLauncherSource, ["early-delete-failure", "delete-failure"].includes(probeMode) ? "1" : "0", root], {
      detached: true, env: { ...process.env, P2E_DELETE_NONCE: deleteNonce },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  const leaderResult = new Promise((resolve) => {
    leader.once("error", () => resolve({ code: null, signal: null }));
    leader.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const leaderClosed = new Promise((resolve) => leader.once("close", () => resolve(true)));
  let readyResolve;
  let launchResolve;
  let resultResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const launched = new Promise((resolve) => { launchResolve = resolve; });
  const childResult = new Promise((resolve) => { resultResolve = resolve; });
  leader.on("message", (message) => {
    if (message?.nonce !== deleteNonce) return;
    if (message?.type === "ready") readyResolve(message);
    if (message?.type === "launched") launchResolve(true);
    if (message?.type === "result") resultResolve(message);
  });
  const groupId = leader.pid;
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    try { leader.disconnect(); } catch {}
    return false;
  }
  let timer;
  const readyMessage = await Promise.race([
    ready,
    leaderResult.then(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); }),
  ]);
  clearTimeout(timer);
  if (readyMessage?.pid !== groupId || !currentAnchor(leader, groupId)) {
    const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { leader.disconnect(); } catch {}
    return terminal.complete && !existsSync(root);
  }
  const deletionContext = { version: 1, family, root, evidencePath: `${root}.evidence.json`,
    supervisorPid: process.pid, leaderPgid: groupId };
  try { persistEvidence(deletionContext, "deleting"); }
  catch {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    return false;
  }
  leader.send({ type: "start", nonce: deleteNonce });
  const launchOutcome = await Promise.race([
    launched,
    leaderResult.then(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
  ]);
  clearTimeout(timer);
  if (launchOutcome !== true) {
    const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { leader.disconnect(); } catch {}
    return terminal.complete && !existsSync(root);
  }
  const outcome = await Promise.race([
    childResult,
    leaderResult,
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000); }),
  ]);
  clearTimeout(timer);
  const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
  try { leader.disconnect(); } catch {}
  return outcome?.type === "result" && outcome.code === 0 && outcome.signal === null
    && terminal.complete && !existsSync(root);
}

async function superviseWorker() {
  let root = "";
  let evidencePath = "";
  if (latchedSignalStatus !== 0) return latchedSignalStatus;
  try {
    root = mkdtempSync(join(rootParent, rootPrefix));
    evidencePath = `${root}.evidence.json`;
    chmodSync(root, 0o700);
    assert.equal(rootIsGuarded(root), true);
    const evidenceFailure = ({
      "evidence-write-failure": "write",
      "evidence-chmod-failure": "chmod",
      "evidence-rename-failure": "rename",
      "evidence-partial-failure": "partial",
    })[probeMode] ?? "";
    persistEvidence({ version: 1, family, root, evidencePath,
      supervisorPid: process.pid, leaderPgid: null }, "preparing", evidenceFailure);
  } catch {
    const context = { version: 1, family, root, evidencePath,
      supervisorPid: process.pid, leaderPgid: null };
    if (root !== "") {
      if (probeMode.startsWith("evidence-") && process.connected) {
        const pending = `${evidencePath}.new`;
        const pendingBytes = existsSync(pending) ? readFileSync(pending, "utf8") : "";
        publish({ type: "root", root, evidencePath });
        publish({ type: `${probeMode}-window`, pendingExists: existsSync(pending),
          partialBytes: probeMode === "evidence-partial-failure" ? pendingBytes : "" });
        await Promise.race([interrupted, pause(500)]);
      }
      try { persistEvidence(context, "manual-remediation"); } catch {}
      assert.equal(existsSync(`${evidencePath}.new`), false);
      assert.equal((statSync(evidencePath).mode & 0o777), 0o600);
      manualDiagnostic(context);
      process.exitCode = finalStatus(125, true);
      await pause(0);
      process.exitCode = finalStatus(125, true);
      if (probeMode !== "" && process.connected) process.disconnect();
      return process.exitCode;
    }
    return 127;
  }
  if (probeMode !== "") publish({ type: "root", root, evidencePath });
  if (["early", "early-delete-failure"].includes(probeMode)) {
    publish({ type: `${probeMode}-window` });
    await Promise.race([interrupted, pause(500)]);
  }
  await Promise.race([pause(0), interrupted]);
  if (latchedSignalStatus !== 0) {
    const removed = await removeRootBounded(root);
    if (removed) removeIfPresent(evidencePath);
    else {
      const context = { version: 1, family, root, evidencePath,
        supervisorPid: process.pid, leaderPgid: null };
      try { persistEvidence(context, "manual-remediation"); } catch {}
      manualDiagnostic(context);
    }
    process.exitCode = finalStatus(0, !removed);
    await pause(0);
    process.exitCode = finalStatus(0, !removed);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }

  const childEnvironment = {
    ...process.env,
    P2E_FIXTURE_ROOT: root,
    P2E_FIXTURE_PARENT: rootParent,
    P2E_GROUP_OWNER_NONCE: randomBytes(16).toString("hex"),
    P2E_LAUNCH_NONCE: randomBytes(16).toString("hex"),
  };
  if (probeMode !== "natural") delete childEnvironment.P2E_FIXTURE_PROBE_SIGNAL;
  const leader = spawn(process.execPath, ["--input-type=module", "--eval", launcherSource], {
    detached: true,
    env: childEnvironment,
    stdio: ["ignore", "inherit", "inherit", "inherit", "ipc"],
  });
  const leaderResult = new Promise((resolve) => {
    leader.once("error", () => resolve({ kind: "leader-error" }));
    leader.once("exit", (code, signal) => resolve({ kind: "leader-exit", code, signal }));
  });
  const leaderClosed = new Promise((resolve) => leader.once("close", () => resolve(true)));
  let readyResolve;
  let launchResolve;
  let resultResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const launched = new Promise((resolve) => { launchResolve = resolve; });
  const workerResult = new Promise((resolve) => { resultResolve = resolve; });
  leader.on("message", (message) => {
    if (message?.nonce !== childEnvironment.P2E_LAUNCH_NONCE) return;
    if (message?.type === "ready") readyResolve(message);
    if (message?.type === "launched") launchResolve({ kind: "launched" });
    if (message?.type === "result") resultResolve({ kind: "result", code: message.code,
      signal: message.signal, spawnError: message.spawnError === true });
  });
  const groupId = leader.pid;
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    const exited = await within(leaderResult, 2000) !== null;
    const closed = exited && await within(leaderClosed, 2000) !== null;
    const removed = closed && await removeRootBounded(root);
    if (removed) removeIfPresent(evidencePath);
    else {
      const failed = { version: 1, family, root, evidencePath,
        supervisorPid: process.pid, leaderPgid: null };
      try { persistEvidence(failed, "manual-remediation"); } catch {}
      manualDiagnostic(failed);
    }
    process.exitCode = finalStatus(127, !removed);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  const context = { version: 1, family, root, evidencePath,
    supervisorPid: process.pid, leaderPgid: groupId };
  const readyMessage = await within(Promise.race([ready, leaderResult.then(() => null)]), 2000);
  if (readyMessage?.pid !== groupId || !currentAnchor(leader, groupId)) {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(125, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  try { persistEvidence(context, "running"); }
  catch {
    await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(125, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  leader.send({ type: "start", nonce: childEnvironment.P2E_LAUNCH_NONCE });
  let deadlineTimer;
  const effectiveDeadline = ["timeout", "timeout-signal", "resistant"].includes(probeMode)
    ? 250 : deadlineMilliseconds;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ kind: "deadline" }), effectiveDeadline);
  });
  const launchOutcome = await Promise.race([launched, workerResult, leaderResult, interrupted, deadline]);
  let outcome = launchOutcome;
  if (launchOutcome.kind === "launched") {
    if (probeMode !== "" && probeMode !== "missing-handshake") {
      publish({ type: "owned", root, leaderPgid: groupId });
    }
    if (probeMode === "signal") publish({ type: "signal-window" });
    outcome = await Promise.race([workerResult, leaderResult, interrupted, deadline]);
  }
  clearTimeout(deadlineTimer);
  if (["timeout", "timeout-signal"].includes(probeMode) && outcome.kind === "deadline") {
    timedOut = true;
    if (probeMode === "timeout-signal") {
      publish({ type: "timeout-signal-window" });
      await pause(500);
    }
  }
  const status = outcomeStatus(outcome);
  process.exitCode = finalStatus(status);
  const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, leaderClosed);
  if (!terminal.complete) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    if (probeMode === "manual") {
      publish({ type: "manual-window" });
      await pause(500);
    }
    process.exitCode = finalStatus(status, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  if (probeMode === "terminal") {
    publish({ type: "terminal-window" });
    await pause(500);
  }
  if (["delete", "delete-failure"].includes(probeMode)) {
    publish({ type: `${probeMode}-window` });
    await pause(500);
  }
  const removed = rootIsGuarded(root) && await removeRootBounded(root);
  if (!removed) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
    process.exitCode = finalStatus(status, true);
    if (probeMode !== "" && process.connected) process.disconnect();
    return process.exitCode;
  }
  if (probeMode === "final") {
    publish({ type: "final-window" });
    await pause(500);
  }
  let evidenceRemoved = true;
  try { removeIfPresent(evidencePath); } catch { evidenceRemoved = false; }
  if (!evidenceRemoved) {
    try { persistEvidence(context, "manual-remediation"); } catch {}
    manualDiagnostic(context);
  }
  await pause(0);
  process.exitCode = finalStatus(status, !evidenceRemoved);
  if (probeMode === "" && family === "repeat" && process.exitCode === 0) {
    console.log("PASS  P2-E repeat fixture cleaned");
  }
  if (probeMode !== "" && process.connected) process.disconnect();
  return process.exitCode;
}

function probeScript(mode) {
  if (mode === "signal") return "while :; do sleep 1; done\n";
  if (["timeout", "timeout-signal", "overrun", "missing-handshake"].includes(mode)) {
    return "while :; do sleep 1; done\n";
  }
  if (mode === "natural") return "kill -\"$P2E_FIXTURE_PROBE_SIGNAL\" $$\n";
  if (mode === "status") return "exit 23\n";
  if (["terminal", "delete", "final", "manual", "delete-failure"].includes(mode)) return "exit 0\n";
  if (["early", "early-delete-failure"].includes(mode) || mode.startsWith("evidence-")) return "";
  if (mode === "resistant") return `
    trap "printf TERM >\\"$P2E_PROBE_TERM\\"" TERM
    node --input-type=module --eval "import { writeFileSync } from \\"node:fs\\"; process.on(\\"SIGTERM\\", () => {}); setTimeout(() => writeFileSync(process.env.P2E_PROBE_LEAK, \\"leak\\"), 2000); setInterval(() => {}, 1000)" &
    while :; do sleep 1; done
  `;
  return "(sleep 1; printf leak >\"$P2E_PROBE_LEAK\") & exit 0\n";
}

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeProbeHandles(proof) {
  try { proof.disconnect(); } catch {}
  const drains = [proof.stdout, proof.stderr].map((stream) => new Promise((resolve) => {
    if (!stream || stream.destroyed || stream.readableEnded) resolve();
    else { stream.once("end", resolve); stream.once("close", resolve); }
  }));
  await within(Promise.all(drains), 500);
  for (const stream of [proof.stdout, proof.stderr, proof.stdio[3]]) stream?.destroy();
}
function retainedEvidence(rootMessage) {
  const evidencePath = rootMessage?.evidencePath;
  if (!rootMessage?.root || evidencePath !== `${rootMessage.root}.evidence.json`
    || !existsSync(evidencePath)) return null;
  if ((statSync(evidencePath).mode & 0o777) !== 0o600) return null;
  try { return JSON.parse(readFileSync(evidencePath, "utf8")); }
  catch { return null; }
}
async function containProbe(proof, result, proofClosed, rootMessage, ownedMessage) {
  let outcome = null;
  if (currentAnchor(proof, proof.pid)) signalGroup(proof.pid, "SIGTERM");
  outcome = await within(result, 3000);
  if (!outcome) {
    if (currentAnchor(proof, proof.pid) && rootMessage?.root) {
      const evidence = retainedEvidence(rootMessage);
      const context = { version: 1, family, root: rootMessage.root,
        evidencePath: rootMessage.evidencePath, supervisorPid: proof.pid,
        leaderPgid: ownedMessage?.leaderPgid ?? evidence?.leaderPgid ?? null };
      let retained = false;
      try {
        persistEvidence(context, "manual-remediation");
        retained = retainedEvidence(rootMessage)?.state === "manual-remediation";
      } catch {}
      if (retained) {
        manualDiagnostic(context);
        try { proof.disconnect(); } catch {}
        for (const stream of [proof.stdout, proof.stderr, proof.stdio[3]]) stream?.destroy();
        proof.unref();
        return { outcome: null, complete: false, detached: true };
      }
      manualDiagnostic(context);
    }
    return { outcome: null, complete: false, detached: false };
  }
  const wrapperGone = outcome !== null && await groupGone(proof.pid, 3000);
  const closed = outcome !== null && await within(proofClosed, 3000) !== null;
  await closeProbeHandles(proof);
  return { outcome, complete: wrapperGone && closed };
}

async function runProbe(mode, signalName = "", laterSignalName = "") {
  const markerParent = realpathSync(process.env.TMPDIR || "/tmp");
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const leakPath = join(markerParent, `p2-e-${family}-${mode}-${suffix}.leak`);
  const termPath = join(markerParent, `p2-e-${family}-${mode}-${suffix}.term`);
  const probeAuthNonce = randomBytes(16).toString("hex");
  const environment = {
    ...process.env,
    P2E_FIXTURE_PROBE: mode,
    P2E_FIXTURE_PROBE_SIGNAL: signalName,
    P2E_PROBE_LEAK: leakPath,
    P2E_PROBE_TERM: termPath,
    P2E_PROBE_NONCE: probeAuthNonce,
  };
  const proof = spawn(process.execPath, process.execArgv, {
    detached: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe", "pipe", "ipc"],
  });
  let output = "";
  let errorOutput = "";
  proof.stdout.setEncoding("utf8");
  proof.stderr.setEncoding("utf8");
  proof.stdout.on("data", (chunk) => { output += chunk; });
  proof.stderr.on("data", (chunk) => { errorOutput += chunk; });
  proof.stdio[3].on("error", () => {});
  const spawned = new Promise((resolve) => {
    proof.once("spawn", () => resolve(true));
    proof.once("error", () => resolve(false));
  });
  const result = new Promise((resolve) => {
    proof.once("error", () => resolve({ code: 127, signal: null }));
    proof.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const proofClosed = new Promise((resolve) => proof.once("close", () => resolve(true)));
  const rootReady = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === "root") resolve(message);
    });
  });
  const owned = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === "owned") resolve(message);
    });
  });
  const phase = new Promise((resolve) => {
    proof.on("message", (message) => {
      if (message?.nonce === probeAuthNonce && message?.type === `${mode}-window`) resolve(message);
    });
  });
  assert.equal(await within(spawned, 2000), true, `${family} ${mode} probe spawn failed`);
  assert.equal(currentAnchor(proof, proof.pid), true,
    `${family} ${mode} probe lacks its retained process-group anchor`);
  proof.stdio[3].end(probeScript(mode));
  const rootMessage = await within(rootReady, 3000);
  if (!rootMessage?.root) {
    const contained = await containProbe(proof, result, proofClosed, rootMessage, null);
    assert.ok(contained.complete, `${family} ${mode} missing-root containment is unproved`);
    throw new Error(`${family} ${mode} probe did not publish its guarded root`);
  }
  assert.equal(rootIsGuarded(rootMessage.root), true);
  let ownedMessage = null;
  if (mode === "missing-handshake") {
    ownedMessage = await within(owned, 500);
    assert.equal(ownedMessage, null);
  } else if (!["early", "early-delete-failure"].includes(mode) && !mode.startsWith("evidence-")) {
    ownedMessage = await within(owned, 3000);
    if (!(ownedMessage?.leaderPgid > 1)) {
      const contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
      assert.ok(contained.complete, `${family} ${mode} missing-owner containment is unproved`);
      throw new Error(`${family} ${mode} probe did not publish positive ownership`);
    }
  }
  if (signalName !== "" && mode !== "natural") {
    const phaseMessage = await within(phase, 3000);
    assert.ok(phaseMessage, `${family} ${mode} did not expose its signal window`);
    if (mode === "evidence-partial-failure") {
      assert.equal(phaseMessage.pendingExists, true);
      assert.ok(phaseMessage.partialBytes.length > 0 && !phaseMessage.partialBytes.endsWith("\n"));
    }
    assert.equal(currentAnchor(proof, proof.pid), true);
    process.kill(proof.pid, signalName);
    if (laterSignalName !== "") {
      assert.notEqual(laterSignalName, signalName);
      await pause(25);
      assert.equal(currentAnchor(proof, proof.pid), true,
        `${family} ${mode} closed before the distinct later signal proof`);
      process.kill(proof.pid, laterSignalName);
    }
  }
  let contained = null;
  let outcome;
  if (["missing-handshake", "overrun"].includes(mode)) {
    await pause(500);
    contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
    outcome = contained.outcome;
  } else {
    outcome = await within(result, 12000);
    if (!outcome) {
      contained = await containProbe(proof, result, proofClosed, rootMessage, ownedMessage);
      outcome = contained.outcome;
    } else {
      const wrapperGone = await groupGone(proof.pid, 3000);
      const closed = await within(proofClosed, 3000) !== null;
      await closeProbeHandles(proof);
      contained = { complete: wrapperGone && closed };
    }
  }
  assert.ok(contained.complete, `${family} ${mode} probe containment is unproved`);
  assert.ok(outcome, `${family} ${mode} probe exceeded its terminal bound`);
  const expected = signalName !== "" ? SIGNAL_STATUS[signalName]
    : ["timeout", "resistant"].includes(mode) ? 124
      : ["manual", "delete-failure"].includes(mode) || mode.startsWith("evidence-") ? 125
        : ["missing-handshake", "overrun"].includes(mode) ? 143 : mode === "status" ? 23 : 0;
  assert.deepEqual(outcome, { code: expected, signal: null });
  assert.equal(output, "");
  const mustRetain = ["manual", "early-delete-failure", "delete-failure"].includes(mode)
    || mode.startsWith("evidence-");
  if (mustRetain) {
    const evidence = retainedEvidence(rootMessage);
    assert.ok(evidence, `${family} ${mode} did not retain mode-0600 evidence`);
    const leaderPgid = mode === "early-delete-failure" || mode.startsWith("evidence-")
      ? null : ownedMessage.leaderPgid;
    assert.deepEqual(evidence, {
      version: 1,
      family,
      root: rootMessage.root,
      evidencePath: rootMessage.evidencePath,
      supervisorPid: proof.pid,
      leaderPgid,
      state: "manual-remediation",
    });
    const printablePgid = leaderPgid ?? "unassigned";
    const expectedError = `ERROR  P2-E ${family} fixture cleanup is unproved; root=${evidence.root} evidence=${evidence.evidencePath} supervisor-pid=${proof.pid} leader-pgid=${printablePgid}; manual remediation required\n`;
    assert.equal(errorOutput, expectedError);
    assert.equal(existsSync(rootMessage.root), true);
    if (leaderPgid !== null) assert.equal(await groupGone(leaderPgid, 3000), true);
    assert.equal(await removeRootBounded(rootMessage.root), true);
    removeIfPresent(rootMessage.evidencePath);
  } else {
    assert.equal(errorOutput, "");
    assert.equal(existsSync(rootMessage.root), false);
    assert.equal(existsSync(rootMessage.evidencePath), false);
  }
  if (["resistant", "parent-exit"].includes(mode)) await pause(2200);
  if (mode === "resistant") assert.equal(existsSync(termPath), true);
  assert.equal(existsSync(leakPath), false);
  removeIfPresent(termPath);
  removeIfPresent(leakPath);
}

if (probeMode === "") {
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    for (const mode of ["early", "early-delete-failure", "signal", "terminal", "delete", "final",
      "timeout-signal", "manual", "delete-failure", "evidence-write-failure",
      "evidence-chmod-failure", "evidence-rename-failure", "evidence-partial-failure"]) {
      await runProbe(mode, signalName);
    }
  }
  for (const [first, later] of [["SIGHUP", "SIGTERM"], ["SIGINT", "SIGHUP"], ["SIGTERM", "SIGINT"]]) {
    await runProbe("signal", first, later);
  }
  for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM", "SIGKILL"]) {
    await runProbe("natural", signalName);
  }
  await runProbe("timeout");
  await runProbe("resistant");
  await runProbe("parent-exit");
  await runProbe("manual");
  await runProbe("delete-failure");
  await runProbe("evidence-write-failure");
  await runProbe("evidence-chmod-failure");
  await runProbe("evidence-rename-failure");
  await runProbe("evidence-partial-failure");
  await runProbe("missing-handshake");
  await runProbe("overrun");
  await runProbe("status");
  if (latchedSignalStatus !== 0) process.exitCode = latchedSignalStatus;
  else await superviseWorker();
} else {
  await superviseWorker();
}
' 3<<'P2E_REPEAT_WORKER'
set -euo pipefail

npm --prefix templates/docbuild run check
templates/build example
templates/build templates/components
templates/check-dist
scripts/scrub-check.sh

repeat_parent="${P2E_FIXTURE_PARENT:-}"
repeat_template="$repeat_parent/p2-e-repeat.XXXXXX"
tmp="${P2E_FIXTURE_ROOT:-}"
cleanup_repeat() {
  local cleanup_status=0
  local repeat_name repeat_parent_check
  trap - HUP INT TERM
  set +e
  if [[ -n "${tmp:-}" ]]; then
    repeat_name="${tmp##*/}"
    repeat_parent_check="${tmp%/*}"
    if [[ "$repeat_parent_check" != "$repeat_parent" || "$tmp" == "$repeat_parent" ]]; then
      printf 'REFUSED cleanup outside repeat parent: %s\n' "$tmp" >&2
      cleanup_status=1
    else
      case "$repeat_name" in
        p2-e-repeat.??????)
          if [[ ! "${P2E_GROUP_OWNER_NONCE:-}" =~ ^[0-9a-f]{32}$ || ! -d "$tmp" ]]; then
            printf 'REFUSED cleanup without the live P2-E group owner: %s\n' "$tmp" >&2
            cleanup_status=1
          fi
          ;;
        *)
          printf 'REFUSED cleanup of unexpected repeat fixture: %s\n' "$tmp" >&2
          cleanup_status=1
          ;;
      esac
    fi
  fi
  return "$cleanup_status"
}
finish_repeat() {
  local prior_status=$?
  local cleanup_status
  trap - EXIT HUP INT TERM
  set +e
  cleanup_repeat
  cleanup_status=$?
  if (( prior_status != 0 )); then exit "$prior_status"; fi
  exit "$cleanup_status"
}
exit_repeat_on_signal() {
  local signal_status="$1"
  trap - HUP INT TERM
  exit "$signal_status"
}
trap finish_repeat EXIT
trap 'exit_repeat_on_signal 129' HUP
trap 'exit_repeat_on_signal 130' INT
trap 'exit_repeat_on_signal 143' TERM

if [[ -z "$repeat_parent" || "$repeat_parent" != /* || ! -d "$repeat_parent" \
  || "${repeat_template%/*}" != "$repeat_parent" \
  || "${repeat_template##*/}" != 'p2-e-repeat.XXXXXX' ]]; then
  printf 'REFUSED creation outside exact repeat fixture template: %s\n' "$repeat_template" >&2
  exit 1
fi
if [[ -z "$tmp" || "${tmp%/*}" != "$repeat_parent" \
  || "$tmp" == "$repeat_parent" || ! -d "$tmp" ]]; then
  printf 'REFUSED unexpected created repeat fixture path: %s\n' "$tmp" >&2
  exit 1
fi
case "${tmp##*/}" in
  p2-e-repeat.??????) ;;
  *)
    printf 'REFUSED unexpected created repeat fixture name: %s\n' "${tmp##*/}" >&2
    exit 1
    ;;
esac

cp example/history.json "$tmp/example.history.json"
cp templates/components/history.json "$tmp/components.history.json"
cp example/dist/example.html "$tmp/example.html"
cp templates/components/dist/components.html "$tmp/components.html"
templates/build example
templates/build templates/components
cmp "$tmp/example.history.json" example/history.json
cmp "$tmp/components.history.json" templates/components/history.json
cmp "$tmp/example.html" example/dist/example.html
cmp "$tmp/components.html" templates/components/dist/components.html

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const fields = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const exact = new Set([
  "templates/docbuild/src/history.ts",
  "example/history.json",
  "templates/components/history.json",
  "example/dist/example.html",
  "templates/components/dist/components.html",
]);
for (let i = 0; i < fields.length; i++) {
  const field = fields[i];
  assert.ok(field.length >= 4 && field[2] === " ", `malformed git status field: ${field}`);
  const status = field.slice(0, 2);
  const path = field.slice(3);
  if (status.includes("R") || status.includes("C")) {
    throw new Error(`ownership gate rejects explicit rename/copy status: ${path}`);
  }
  assert.ok(
    exact.has(path) || path.startsWith("templates/docbuild/dist/"),
    `ownership gate rejects unexpected path: ${path}`,
  );
}
console.log("PASS  every changed path is owned or an exact shared generated product");
NODE

P2E_REPEAT_WORKER
```

Expected: typecheck and every command exit zero; both initial and repeated real builds report `UNCHANGED`; `templates/check-dist` reports byte-identical committed documents; the scrub gate passes; all four comparisons are silent; the ownership script prints its one `PASS` line; and the outer owner prints the final line `PASS  P2-E repeat fixture cleaned` only after proving group disappearance and guarded-root absence. The outer Node program is byte-for-byte the history-family supervisor body; only the command's validated `repeat` family selector changes its root parent and prefix. It installs HUP/INT/TERM ownership before resolving the temporary parent or creating `p2-e-repeat.??????`; both worker and deletion launchers require authenticated ready/current PID=PGID proof, durable state publication, and authenticated start. It runs the repository gate below one detached retained-anchor PGID with a 600-second deadline and performs bounded TERM-to-KILL, leader exit plus `close`/IPC proof, group disappearance, and only then bounded recursive deletion.

The same exact-source matrix independently proves this family's early/active/post-result/deletion/final-cleanup direct-signal windows, three first/later distinct-signal pairs, natural Bash HUP/INT/TERM/KILL mapping, ordinary status 23, timeout, resistant and parent-exit descendants, missing-handshake and overrun containment, deletion failures, and actual evidence write/chmod/rename/partial-`.new` recovery. The recursive harness signals only a retained direct wrapper with current PID=PGID proof; it never signals an inner bare PGID and retains remediation on uncertainty. The guarded Bash `finish_repeat`/`cleanup_repeat` wrapper validates the exact supplied parent/template/root and live-owner nonce, preserves prior status, and leaves deletion to the outer owner. Unproved cleanup retains the root and mode-0600 actionable evidence; the first terminal status remains authoritative, otherwise the result is 125, and neither path prints the cleanup `PASS`. Every changed path is examined; an unexpected path or explicit Git `R`/`C` status is a hard ownership failure.

## Failure modes

- A runtime `refresh()` call with a non-string or empty instance value throws the exact instance-path `BuildError` before the local/Netlify branch and before any filesystem or Git call.
- A Mode A connect/export invocation receives a repository/source-instance input, or a Mode B builder invocation receives a standalone-file input: the owning command's preflight rejects the mixed topology before either history writer. Git presence around a standalone file is not permission to refresh it.
- Either mandatory fixture exceeds its 600-second worker deadline or receives HUP/INT/TERM: its live Node owner preserves status 124 or the first 129/130/143, uses only a current retained direct anchor to terminate each owned group TERM-to-KILL, requires leader exit plus `close`/IPC closure and group disappearance, and only then admits separately owned bounded recursive deletion. A later distinct signal cannot replace the latch. If authentication, durable state publication, terminal proof, or deletion is unproved, it retains the root and sibling mode-0600 evidence when writable and prints the safe actionable locator. With no terminal signal it exits 125. A naturally signaled Bash worker is translated to 129/130/143/137 for HUP/INT/TERM/KILL.
- A standalone file, P4-R-amended history, or reconstructed source is being converted from Mode A to Mode B: stop before docbuild and require a future migration ticket to reconcile attribution. P2-E has no row marker and performs no silent merge, drop, or promotion-preserving guess.
- Git absent, timed out, killed, over buffer, nonzero, malformed, outside a worktree, outside the resolved root, or shallow: print the exact local `SKIPPED` state and use canonical committed history, or return `null` when it is absent.
- `NETLIFY === "true"`: skip before spawn and use committed history. Other values do not enable the Netlify branch.
- Public-history approval absent/mismatched, or `origin` absent, unsupported, credential-bearing, private, unapproved, or failed: stop fresh generation before its first diff and use committed fallback. Do not emit empty-URL Git rows or republish author, subject, deleted, or current source text. Required log/diff failure likewise invalidates the complete attempted refresh.
- Root commit: use the null-tree creation patch. Merge commit: compare only its first parent. Out-of-path commits do not become versions.
- Malformed Git path quoting or a non-empty unparseable patch: fail the attempt softly and fall back; do not write partial rows.
- A decoded path falls outside the exact current-instance tuple, uses traversal-like components, or names a nested/non-safe section path: reject the complete diff parse and fall back without retaining earlier parsed files.
- Two retained full Git SHAs shorten to one seven-character value: reject the complete fresh attempt and use committed fallback. Duplicate committed values are an exact schema error. The separate P4-R ticket is obligated by this interface to abort a colliding proposal before mutation; that downstream implementation is not exercised or accepted here.
- Deleted/renamed section, metadata, or styles: store the fallback ID and render a filename without a broken anchor when no current label exists.
- Per-file Unicode overflow: clip at a whole code point and retain pre-clip stats. Whole-payload overflow: drop old non-newest bodies only, then hard-fail if still too large.
- A non-empty committed URL with dot/dotdot owner or repository tokens, or with a full object ID whose first seven characters differ from its row `sha`, is invalid at that row's `url`; never render a syntactically plausible link to a different object.
- A committed patch is non-string, over budget, contains CR or a final LF, lacks an initial hunk header, or contains a line outside the closed prefixes: reject it at that patch's JSON path with the exact canonical-diff expectation.
- Committed `ENOENT`: optional absence. An exact existing `history.json` that is not a regular non-symbolic-link file is rejected without being followed; other lstat/read, syntax, schema, canonical-byte, or budget errors are exact `BuildError`s with no stack trace.
- Successful generation followed by a non-`ENOENT` opaque comparison-read failure: exact `cannot read history.json` `BuildError`, no sibling creation, and no trim/status output.
- Temporary create/write/sync/close/replace failure: preserve the old target and remove only the exact sibling temporary file. An identical result performs no write.
- Source ID `changelog`: exact reserved-ID `BuildError`; no silent rename.
- Deliberately not handled: live remote history, Git fetch, concurrent writers to one target, repository restoration, annotation timelines, or history beyond twelve rows.

## Settled decisions

- P2-E history is a Mode B committed generated input; deploy HTML never depends on Netlify Git state. P4-R separately owns Mode A promotion history in the standalone-file workflow.
- Mode is selected explicitly by command and input topology, not inferred from Git, `NETLIFY`, URLs, identifiers, or a new config field. The Mode B builder and Mode A connect/export writer are mutually exclusive and never call one another.
- Mode A-to-Mode B conversion is an unsupported migration. There is no automatic cross-mode merge or retention-based overwrite; a future migration ticket must preserve and reconcile promotion attribution deliberately.
- Local generation requires a complete non-shallow checkout, a supported GitHub origin, and the exact operator-supplied public-history approval slug; it follows first-parent history only after that admission.
- Only sections, `doc.json`, and `extra.css` select versions and diffs. Generated/history/other-document changes are excluded.
- The committed shape stores section IDs, never labels. Rendering resolves current labels.
- Retention is twelve versions; per-file patch cap is 1,200 UTF-8 bytes; embedded escaped payload cap is 16 KiB.
- Root changes are creation diffs. Patch order and JSON key order are deterministic.
- Persisted patches are empty or canonical prefix-safe diff lines, and commit URLs are empty or exact GitHub URLs with producer-safe owner/repository tokens and 40- or 64-character lowercase hexadecimal object IDs beginning with the row `sha`.
- The pathspec tuple is passed unchanged to Git and `parse_diff()`; the parser independently enforces the exact current-instance files and direct section basenames.
- Seven-character identifiers are a closed namespace: collisions are rejected, never lengthened, salted, merged, or solved by eviction.
- The newest patch is never removed to satisfy the whole-payload budget.
- Unsupported, private, mismatched, or unapproved origins do not generate rows: they fall back before content-bearing diffs, preventing accidental public redistribution. Empty URLs remain valid only in committed input, including P4-R rows.
- P1-B owns integration and script escaping. P2-E amends only its stub and supplies data/section output.
- Exact `file: "history.json"` is generated/read-only for P2-D.
- P3-D is a read-only browser consumer. P4-R writes the same schema during serialized standalone promotion, prepends one attributed row, applies collision checks before retention, and never invokes P2-E.
- Source lanes may run in parallel only on disjoint ownership; histories, HTML, compiler/site output, and final gates integrate serially.

## Assumptions and open questions

Assumptions made explicit by this ticket:

- Node runs on the repository's supported POSIX build hosts, and Git may use SHA-1 or SHA-256 full object IDs; the persisted marker remains the required first seven lowercase hex characters.
- P1-B and its concrete `Section.file`/`BuildError`/hook order are integrated before implementation starts. P1-D and P2-D honor the finalized generated-section boundary.
- The integration-plan P2-E row omitted `templates/components/history.json`, but finalized P1-B invokes history for every real document and `templates/check-dist` rebuilds components. The second committed history is required, matching P1-D's two-instance generated-input precedent.
- JavaScript code-unit file ordering is the cross-host canonical order. Git encounter order is never persisted directly.
- The atomic failure matrix instruments only an isolated compiled copy's module-private `historyIO` object. Production exports and global Node filesystem bindings remain unchanged, and the real target is touched only by the normal `refresh()` transaction under test.
- The repository-free fixture exercises P2-E's existing committed fallback solely as a schema/read-preservation oracle. It does not authorize Mode A to invoke P2-E or make `history.ts` a standalone writer.
- P4-R defines its stable promotion-ID derivation within the seven-lowercase-hex contract, but must apply P2-E's collision rule before retention: equality with any row in the loaded valid history aborts before mutation. P2-E does not invent a repository-free receipt algorithm or row marker early.

No implementation-blocking question remains. A future request to convert Mode A to Mode B, widen source pathspecs, retain more versions, store labels, support another forge URL, expose private helpers, add concurrent mutation, or change budgets is a format/consumer migration and requires an explicit owner rather than an incidental P2-E edit.

## References

- `HANDOFF.md` — public-repository scrub posture, ownership, generated-product coordination, and no-commit/no-push constraints.
- `README.md` — self-contained artifact model, source/build layout, zero-runtime-dependency builder, and current build commands.
- `docs/research/00-integration-plan.md` §§1.4, 2.8, 3.3–3.5, 4.1–4.7, 5 — authoritative Mode A/Mode B boundary, committed-history ruling, TypeScript hook contract, build order, P3-D/P4-R consumers, and excluded alternatives.
- `docs/research/06-history.md` §§1–5 — source-only pathspec, first-parent history, patch/whole-block measurements, changelog presentation, and last-read consumer. Its Rust names, stored label, hard-coded URL, and root-empty behavior are superseded here.
- `docs/research/08-suggestions-and-editing-model.md` §§8.4 and 9.3 — Mode A promotion and durable suggester attribution in the existing history shape.
- `docs/tickets/P1-B.md` — creator of `history.ts`, exact public signatures, `Section.file`, `parseSection()`, `BuildError`, hook order, JSON-script escaping, and shared generated artifacts.
- `docs/tickets/P1-D.md` — changelog anchoring stage and two-real-instance committed generated-input precedent.
- `docs/tickets/P2-D.md` — finalized safe source-basename predicate and exact generated/read-only `history.json` sentinel behavior.
- Git [`git-log`](https://git-scm.com/docs/git-log) — `--max-count`, pretty formatting, and first-parent traversal.
- Git [`git-diff-tree`](https://git-scm.com/docs/git-diff-tree) — `--root` null-tree behavior, recursive patch output, pathname quoting, and pathspec limitation.
- Git [`git-diff`](https://git-scm.com/docs/git-diff) — deterministic patch options, disabled external/textconv/rename behavior, prefixes, context, and diff algorithm.
- Git [`git-rev-parse`](https://git-scm.com/docs/git-rev-parse) — worktree root and shallow-repository probes.
- Netlify [build environment variables](https://docs.netlify.com/build/configure-builds/environment-variables/) — documented read-only `NETLIFY=true` build signal.
- GitHub issues #10, #17, and #40 — P2-E ownership, P3-D read-only client, and P4-R promotion-time history amendment.
