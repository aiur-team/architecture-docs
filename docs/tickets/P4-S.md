# P4-S — The connect tool sets the owner

## Outcome

A standalone document can be connected to one new or explicitly selected Netlify site without handing a credential to the tool; the tool validates the built HTML, its P2-D edit sidecar, and its P2-E history sidecar as one reviewable snapshot, publishes only the edit sidecar as private Mode A apply authority, sets exactly one `DOC_OWNERS` seed, performs the production deploy only after both prerequisites are confirmed, and prints the owner and the three Mode A authority warnings.

## Context

Mode A publishes one built HTML file and has no document-source repository. Its deployer therefore chooses the first owner. P2-G makes `DOC_OWNERS` the only uncaptured ownership seed and binds that email to a proven Identity `sub` on first sign-in. This ticket supplies the missing setup path using an already authenticated official Netlify CLI; authentication itself remains a separate `netlify login` operator step. P4-R later amends this same tool with export and promotion; it must not create a second Mode A command.

## Scope

### In scope

- Create a zero-runtime-dependency Node ESM command at `scripts/connect.mjs`.
- Accept one standalone HTML file, its P2-D edit sidecar, its P2-E history sidecar, one normalized owner email, and exactly one of a new-site name or an existing site ID.
- Validate the three files as one exact document/block/version snapshot and upload only the unchanged edit-sidecar bytes to `doc-state` at `mode/<docId>/manifest.json`.
- Extract exactly one six-lowercase-hex `<meta name="doc-id" content="…">` value without executing or repairing the HTML.
- Use an installed, already authenticated Netlify CLI as a bounded noninteractive child process; never initiate, proxy, or capture an interactive login.
- Create or select one site without writing caller-owned link state, read the current `DOC_OWNERS` value, and refuse to replace any different nonempty value.
- Set `DOC_OWNERS` before the first production deploy, read it back, and require exact byte equality.
- Deploy the supplied file as `/index.html` together with the repository's already-owned Netlify configuration, Functions, Edge Function, and package metadata.
- Print a deterministic success receipt and the exact authority warnings.
- Provide closed dependency seams so unit tests use a fake CLI and never contact Netlify.
- Add one permanent source-bound fake-CLI test owned by this ticket so all three documented verification commands exist after implementation.

### Out of scope

- Reading, accepting, printing, storing, or forwarding a Netlify access token; OAuth token; GitHub token; password; cookie; or recovery token.
- Enabling Identity, changing invite-only settings, configuring Ably or Slack, creating an Identity user, binding the owner `sub`, or writing the access store. Those remain provider/operator or P2-G/P4-J responsibilities.
- Appending a second document to a Mode A site. One standalone site contains one document in this version.
- Generating an edit manifest or history from browser attributes, trusting a client-submitted hash/path, or enabling editing for an HTML file without both matching sidecars.
- Updating, deleting, merging, or parsing a pre-existing different `DOC_OWNERS` value. Refusal is the safe migration boundary.
- Exporting an overlay, promoting it into HTML or `history.json`, attaching a repository, or converting Mode A to Mode B. P4-R owns those additions.
- Editing `netlify.toml`, `package.json`, any function/library/template, an HTML input, generated output, or `.netlify/state.json`.
- Anonymous deploys, initiating Netlify login, draft deploys, deploy aliases, project visibility changes, shared bearer links, or a second deployment provider.
- Coordinating two simultaneous connect/promote commands against one site; provider CLI writes have no CAS transaction, so the operator serializes them.

## Interface contract

### Command surface

The supported invocations are exactly:

```text
node scripts/connect.mjs --file <html> --manifest <edit.json> --history <history.json> --owner <email> --name <new-site-name>
node scripts/connect.mjs --file <html> --manifest <edit.json> --history <history.json> --owner <email> --site <site-id>
node scripts/connect.mjs --help
```

Arguments may occur in any order. `--file`, `--manifest`, `--history`, `--owner`, and one of `--name`/`--site` occur exactly once. Reject duplicate, missing, empty, positional, `--flag=value`, unknown, or mutually exclusive options before filesystem or child-process work. `--help` is valid only by itself, writes the exact usage block above to stdout with a final LF, and exits 0. Invalid arguments write exactly `connect: invalid arguments\n` to stderr and exit 2; they do not print usage because the rejected value can contain terminal control bytes.

`parseConnectArgs(["--help"])` returns the fresh exact object `{ help: true }`. A structurally valid setup invocation returns a fresh exact object with keys in this order: `{ file, manifest, history, owner, name, site }`; the five supplied nonempty strings are unchanged and the unused selector is `null`. Every other token structure throws the module-private invalid-argument sentinel. The parser performs no filesystem, environment, value-regex, normalization, output, or child work. Thus a missing/empty/duplicate flag is exit 2, while a nonempty but malformed owner/name/site or invalid file content is a runner `setup` failure and exit 1.

The module has exactly these exports:

```text
export function parseConnectArgs(argv)
export function inspectStandaloneHtml(source)
export function assertModeManifest(value, html)
export function normalizeConnectOwner(value)
export function createConnectRunner(dependencies = {})
export async function main(argv = process.argv.slice(2))
```

There is no default export. The guarded entry point calls `main()` only when `process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href`. Imported tests and stdin-module imports cause no I/O, process exit, handler registration, or console output. `main()` sets `process.exitCode`; it never calls `process.exit()`.

`createConnectRunner()` accepts an ordinary exact dependency object. Optional own data-function members are `lstatFn`, `realpathFn`, `openFn`, `mkdtempFn`, `mkdirFn`, `readdirFn`, `writeFileFn`, `rmFn`, `spawnFn`, `tmpdirFn`, `nowFn`, `setTimeoutFn`, and `clearTimeoutFn`; optional scalar members are `workingDirectory` and `repositoryRoot` (absolute existing non-symlink directories) and `env` (a fresh ordinary object whose recognized own properties are strings). Omitted members use named Node imports, `process.cwd()`, `Date.now`, global timers, and the repository root resolved exactly as the parent of the directory containing `fileURLToPath(import.meta.url)`. The default environment is not cloned: at construction production reads each exact allowlisted key and `NETLIFY_CLI_PATH` from `process.env` once; absent values are omitted and a present non-string or NUL-bearing value fails synchronously. Unknown top-level dependency keys, top-level accessors, symbols, arrays, null, custom prototypes, wrong types, or explicit `undefined` fail synchronously. An injected `env` must have exactly `Object.prototype`, no symbol keys, and is inspected only through own descriptors. For each recognized allowlist key and `NETLIFY_CLI_PATH`, absence is allowed; an own accessor, explicit `undefined`, non-string value, or NUL-bearing string fails synchronously. Every other own string key and its descriptor/value are ignored without invoking a getter or validating its value. The runner copies accepted scalar/environment values at construction so caller mutation cannot change a run. Production code imports only `createHash` from `node:crypto` plus named operations from `node:child_process`, `node:fs/promises`, `node:os`, `node:path`, and `node:url`. It does not import a shell library, Netlify SDK, P2-G server code, HTTP client, or package not built into Node.

The factory returns one `async run(parsed)` function. `parsed` must be an ordinary object with exactly the setup keys/values returned by `parseConnectArgs()` and is revalidated before work; `{ help: true }`, extra/missing keys, accessors, symbols, a custom prototype, or a mutated invalid value rejects with `setup` before filesystem/environment/child work. Success resolves to a fresh exact `{ docId, owner, siteId, url }` object of already validated strings and produces no console output. Failure rejects only with a module-private error tagged `conflict`, `cleanup`, `new-site`, or `setup`; cleanup carries the already-validated temporary path and new-site carries only the already-validated requested name. `main()` handles `{ help: true }` without creating a runner. It alone maps tags to the named public lines, writes the five-line receipt from the success object, and sets exit code 0, 1, or 2. A test may observe the success `siteId` solely to delete its disposable hosted fixture; the command never prints it.

### Input validation

Resolve `--file`, `--manifest`, and `--history` against the captured initial working directory. For each path, call `lstatFn()` and require a regular non-symlink file; open it with `openFn(path, "r")`; require the handle's first `stat()` to be regular and have the same finite nonnegative integer `dev`/`ino` pair as the `lstat`; reject its finite nonnegative integer `size` above the declared limit before allocation; read only through that handle in chunks stopping at limit plus one; require a final `stat()` with unchanged device, inode, size, `mtimeMs`, and `ctimeMs`; and close exactly once in `finally`. Any unsupported identity/time field, short read inconsistent with the stable size, overflow, or open/stat/read/close race fails before remote work. Require the three device/inode pairs and normalized absolute paths to be pairwise distinct, catching hard-link and lexical aliases. Reject HTML above 10 MiB and either sidecar above 1 MiB. Decode each once with `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`; preserving a leading U+FEFF makes the exact HTML prefix or canonical JSON comparison reject a UTF-8 BOM. Do not normalize line endings, rewrite an input, or echo a path after validation.

All HTML inspection uses one private lexical tokenizer. ASCII whitespace is exactly U+0009, U+000A, U+000C, U+000D, and U+0020. A comment starts only at `<!--` and ends at the next `-->`. A declaration starts at `<!` when the following two bytes are not `--`; a processing instruction starts at `<?`; each is opaque through the next `>` that occurs outside complete single- or double-quoted runs. Thus `<!x>`, `<!-x>`, and `<?x>` are complete opaque tokens, while an EOF before their quote-aware `>` rejects. A tag starts only at `<` plus an optional `/` and an ASCII letter; its name continues through ASCII letters, digits, `:`, or `-` and is compared ASCII-case-insensitively. A start-tag attribute is preceded by ASCII whitespace; its nonempty name excludes ASCII whitespace, NUL, `"`, `'`, `` ` ``, `<`, `>`, `/`, and `=`; and its optional value follows optional whitespace, `=`, optional whitespace, then a complete single-quoted, double-quoted, or nonempty unquoted token excluding ASCII whitespace, `"`, `'`, `` ` ``, `=`, `<`, and `>`. Attribute names are compared case-insensitively and duplicates reject. A close tag permits only whitespace before `>`; a start tag permits only whitespace and an optional `/` before `>`. Any started comment, tag, attribute quote, declaration, processing instruction, `script`, or `style` that does not close rejects. Text `<` bytes that begin none of these forms are ordinary text.

`inspectStandaloneHtml(source)` requires the exact first bytes `<meta name="doc-id" content="<docId>">\n`, where `<docId>` matches `^[0-9a-f]{6}$`; this is P1-B's canonical generated placement and spelling, not a semantic-DOM equivalence. The tokenizer scans the complete remaining HTML and rejects any other case-insensitive `meta` start tag whose parsed `name` value is exactly `doc-id`, including alternate attribute order/case/quoting, as well as any duplicate attribute. It returns exactly `{ docId }`. It does not use a DOM, execute markup, repair input, or infer a browser-created `<head>` element.

Parse the manifest exactly once with `JSON.parse()` and pass it with the decoded HTML to `assertModeManifest(value, html)`. The manifest is a non-null ordinary JSON object with exact keys `docId`, `instance`, `commit`, and `blocks` in that order. `docId` equals the HTML meta value. `instance` matches `^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$`; Mode A narrows `commit` to exactly `^[0-9a-f]{7}$`; and `blocks` is an ordinary object with at most 1,000 insertion-ordered `^a[0-9a-f]{8}$` keys. Every row has exact ordered keys `file`, `section`, `tag`, `hash`; `file` matches `^sections/[a-z0-9]+(?:[._-][a-z0-9]+)*\.html$`; `section` matches `^[a-z0-9][a-z0-9._-]*$`; `tag` is exactly `p`, `h2`, `h3`, or `h4`; and `hash` is 64 lowercase hexadecimal characters. `assertModeManifest()` returns the fresh exact `{ docId, manifest: canonical }`. The runner, which alone has the raw sidecar, then requires its bytes to equal `JSON.stringify(canonical, null, 2) + "\n"` before retaining those same bytes for upload.

Walk the token stream once using UTF-16 offsets without executing or reserializing it. After a valid `script` or `style` start, raw text continues through the first case-insensitive matching close name followed only by ASCII whitespace and `>`; every other byte inside is opaque. Outside those regions, recognize paired `p`, `li`, `h2`, `h3`, `h4`, `td`, `th`, `pre`, `blockquote`, `figcaption`, `dd`, and `dt` and maintain a properly nested candidate stack. Reject a self-closing candidate, mismatched/top-level candidate close, or candidate left open. On every tokenized start tag outside raw text, reject a case-insensitive `data-editable` or `data-aid` attribute name on a noncandidate tag. An outermost candidate bearing neither name is ordinary content. If an outermost candidate bears either name, it is valid only when it has both the exact lowercase valueless token `data-editable` and exactly one exact lowercase `data-aid="<aid>"` attribute in P1-D's double-quoted generated form, where `<aid>` matches `^a[0-9a-f]{8}$`; a half-marked pair, alternate case, alternate quotes, unquoted value, duplicate, malformed aid, or a value on `data-editable` rejects. A nested candidate may not carry either name in any spelling or form. Each manifest aid must identify exactly one editable with the same canonical tag and SHA-256 of its byte-preserved inner HTML equal to the row hash. Every editable must have a manifest row. Reject missing, extra, duplicate, nested, malformed, mismatched-tag, or mismatched-hash data. `file`, `section`, `instance`, and `commit` are retained for provenance but are never Mode A filesystem authority. The function returns a fresh exact `{ docId, manifest }`; it does not repair or reserialize the input.

Parse the history sidecar once and require one ordinary object with exact ordered keys `doc`, `head`, `versions`. `doc` matches `^[a-z0-9][a-z0-9._-]*$`; `versions` has 1–12 rows with unique `sha` values; and `head === versions[0].sha`. Each version has exact ordered keys `sha`, `date`, `author`, `subject`, `url`, `changed`: `sha` matches `^[0-9a-f]{7}$`; `date` matches `^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$` and satisfies `new Date(Date.parse(value)).toISOString() === value`; and `author`/`subject` are strings. `url` is empty or matches `^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/commit/([0-9a-f]{40}|[0-9a-f]{64})$`, with neither captured repository token equal to `.` or `..` and the object ID beginning with `sha`. Each `changed` array is strictly JavaScript-code-unit sorted with unique `file` values. A change has exact ordered keys `file`, `id`, `add`, `del`, `patch`, `clipped`: `file` is `doc.json`, `extra.css`, or `^[a-z0-9][a-z0-9._-]*\.html$`; `id` matches `^[a-z0-9][a-z0-9._-]*$` and is exactly `doc` or `extra` for those two special files; `add`/`del` are nonnegative safe integers; `clipped` is boolean; and `patch` is empty or has no CR/final LF, is at most 1,200 UTF-8 bytes, begins `@@`, and has only lines beginning `@@`, one space, `+`, or `-`. Rebuild the canonical object in this key order and require the sidecar bytes to equal `JSON.stringify(canonical, null, 2) + "\n"`.

Require exactly one literal opening tag `<script type="application/json" id="doc-history">` and its matching exact `</script>` close. Any other tokenized element whose parsed case-sensitive `id` value is `doc-history`, or a duplicate/alternate spelling of the canonical script, rejects. Its raw text must equal `JSON.stringify(validatedHistory).replaceAll("</", "<\\/")` byte-for-byte and be at most 16,384 UTF-8 bytes. This comparison occurs before one parse of the raw text after reversing only the literal `<\/` protection to `</`; the result must deeply equal the validated sidecar. Alternate whitespace, key order, duplicate keys, entity spelling, or slash protection therefore cannot pass as an exact mirror. Also require `history.doc === manifest.instance` and `history.head === manifest.commit`; the head is the exact seven-lower-hex Mode A `docVersion`. Missing, duplicate, malformed, noncanonical, over-budget, or unequal history rejects setup. P4-R preserves and advances the same embedded/local history during promotion; it never has to invent a first history row.

`normalizeConnectOwner(value)` requires a string and removes only leading/trailing U+0009, U+000A, U+000C, U+000D, and U+0020. Before case folding, require every remaining code unit to be ASCII; this rejects Unicode such as U+212A before it could lowercase to an ASCII letter. Apply `toLowerCase()` once. The result is at most 254 characters and has exactly one `@`; its local part is 1–64 ASCII characters from letters, digits, and ``.!#$%&'*+=?^_`{|}~-``; and its domain has at least two dot-separated labels, each 1–63 characters, beginning/ending alphanumeric and otherwise containing only ASCII alphanumerics or `-`. The inherited grammar deliberately permits leading, trailing, or consecutive dots in the local part; do not silently tighten it. Reject comma, colon, slash, backslash, control, remaining whitespace, quoted local parts, an empty domain label, or any other form. Return the canonical email or throw the private invalid-input sentinel. Do not locale-fold, Unicode-normalize, perform DNS/delivery checks, or print a rejected address.

`--name` matches `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`. `--site` matches the canonical UUID `^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. Values are passed as separate child arguments, never interpolated into a command string.

### CLI supervision and protocol

Read `NETLIFY_CLI_PATH` only from the captured dependency environment as an optional executable path for test/managed installations; the default executable is literal `netlify`. When present it is an absolute NUL-free path whose `realpathFn()` is unchanged and whose `lstatFn()` result is a regular non-symlink file; reject otherwise, then omit it from every child environment. Never look up a token-named variable. Build every child environment from this exact allowlist when the captured value is a NUL-free string: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `COLORTERM`, `LANG`, `LC_ALL`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `CI`, and `NO_COLOR`. No other captured key is forwarded. Site-scoped calls add only the validated `NETLIFY_SITE_ID`. This permits the official CLI to use its previously stored login while preventing ambient provider, repository, package, and application credentials from crossing the boundary.

Every child is `spawnFn(executable, args, { cwd: projectRoot, env: childEnv, shell: false, stdio: ["ignore", "pipe", "pipe"] })`. Capture at most 65,536 bytes from each of stdout and stderr and never forward provider bytes. On overflow, timeout, signal, spawn error, or a result not explicitly accepted below, send `SIGTERM` to that exact child, wait at most two seconds, send `SIGKILL` if it has not closed, drain/close both streams, and await its close so no zombie remains. Clear both timers on settlement. Only one child may exist at a time. Each gets 60 seconds except `sites:create` and production deploy, which get ten minutes. A command requiring login, account/team selection, confirmation, or any other stdin interaction fails closed; the operator must run `netlify login` or select the account separately and retry.

After all three inputs validate, create one `connect-` temporary directory with mode `0700` directly under the captured `tmpdirFn()` result. Require the normalized temp root and returned path to contain only U+0020–U+007E, require the returned path to be a strict child of that normalized temp root, and require neither to be a filesystem root. This rejects CR/LF, C0/C1 controls, Unicode line separators, escape bytes, and non-ASCII path spoofing before a path can appear in cleanup output. Create `project/`, `project/publish/`, and `project/private/` below it. Before remote work, recursively reproduce the repository's `netlify/` tree and copy `netlify.toml`, `package.json`, and `package-lock.json` into `project/` by walking lexically sorted directory entries. The repository root is depth 0; `netlify/` plus the three root files are the four depth-1 entries; a child of `netlify/` is depth 2. Count those four paths and every descendant directory/file toward the inclusive 4,096-entry and depth-16 limits. Count only stable regular-file source bytes, across the three root files and all `netlify/` descendants, toward an inclusive 10 MiB per-file and 64 MiB aggregate copy limit; input HTML/sidecar and destination directories do not count toward that aggregate. Every source path must stay lexically below the captured repository root, satisfy `realpathFn(path) === path`, and be checked with `lstatFn`; only directories and regular files are allowed. Read each regular file through the same stable-handle routine and write those captured bytes rather than delegating a path-based copy. Recheck every directory's device, inode, `mtimeMs`, and `ctimeMs` after its children, so a changed tree rejects; any symlink, special node, escape, race, or budget overflow fails closed. Write only the original HTML bytes to `project/publish/index.html`. Write the exact manifest bytes to a mode-`0600` `project/private/manifest.input` and create a distinct mode-`0600` empty `project/private/manifest.output`. The history sidecar is not copied. Failure in this local assembly performs no remote mutation.

The exact successful remote sequence is:

1. With `--name`, call `spawnFn` for `netlify sites:create --name <name> --disable-linking --json`. If `spawnFn` throws synchronously, reject as `setup`; once it returns a child object, set the run's `mayHaveCreatedSite` flag before awaiting any event. Require exit 0 and a complete stdout JSON object containing a canonical UUID string at `site_id` or `id`. If both are present they must be equal; missing, extra non-string decisive values, or an unequal pair rejects. Additional plain data fields are ignored without display. When `mayHaveCreatedSite` is true, every later non-cleanup rejection—including child error/nonzero, owner conflict, or provider/setup failure—maps to `new-site`; the inspection line has precedence over `conflict`/`setup`. With `--site`, use the supplied ID, keep the flag false, and run neither `sites:create` nor `link`.
2. Run `netlify env:get DOC_OWNERS --context production` under child-only `NETLIFY_SITE_ID`. On exit 0, strip exactly one final LF and optional preceding CR while preserving every other byte. Exit 1 with empty stdout means absent. Any stderr is captured but not printed; any other nonzero result fails.
3. Let `seed = docId + ":" + owner`. Continue only when the value is absent/empty or exactly `seed`. A different value rejects with `conflict` for `--site` or, under the precedence above, `new-site` for `--name`; `main()` prints the corresponding exact line and exits 1 without an environment write, blob write, or deploy.
4. If absent/empty, run `netlify env:set DOC_OWNERS <seed>` under the child-only site ID and require exit 0. Do not use `--secret`, `--context`, or `--scope`: this deliberately creates one ordinary all-context/all-scope value for Edge and Functions. Never put the seed in a shell or temporary file. Ignore bounded stdout/stderr on success.
5. Repeat the exact production `env:get`; require exit 0 and the normalized output to equal `seed` byte-for-byte. A masked value, extra whitespace, duplicate line, or mismatch fails before blob write or deploy.
6. Run `netlify blobs:set doc-state mode/<docId>/manifest.json --input <absolute-manifest-input>` under the child-only site ID and require exit 0. Then run `netlify blobs:get doc-state mode/<docId>/manifest.json --output <absolute-manifest-output>`, require exit 0, and read that output with the same stable-file routine and 1 MiB limit. Ignore bounded stdout/stderr on success and require downloaded bytes to equal the local manifest exactly. Never use stdout for manifest bytes.
7. Run `netlify deploy --prod --no-build --dir publish --json` from `project/` under the child-only site ID. Require exit 0 and one complete stdout JSON object. Each present `url` or `deploy_url` must be a string that parses to an absolute `https:` URL with no username, password, query, fragment, non-default port, or pathname other than `/`; its canonical value is `new URL(value).href`. Use canonical `url` for the receipt when present, otherwise canonical `deploy_url`; require at least one, and ignore other plain fields without display. The production runner does not fetch the deployed document; only the separately invoked hosted proof does so.
8. Remove only the validated temporary root in `finally` with recursive force. Cleanup is permitted only for that exact strict child of the captured OS temp directory. It never targets the repository, input parent, home directory, empty path, or filesystem root. A cleanup failure takes precedence over an earlier success, setup/new-site failure, or owner conflict: reject with the `cleanup` tag and write exactly `connect: cleanup failed; remove <validated-temp-path>\n` to stderr; no receipt, conflict line, generic line, or provider detail follows it. If cleanup succeeds, preserve the earlier result/tag.

The private `mode/<docId>/manifest.json` blob is the only Mode A apply manifest. P4-N opens P2-B's `docState()` and uses the underlying strong `store.get()` only when Mode B GitHub configuration is absent; it validates these exact versionless P2-D bytes rather than calling P2-B `read()`, whose `{v:1}` envelope does not apply. No request may select that key, provide a manifest, path, tag, or hash, and no server may derive a Mode A manifest from the public HTML. P4-R uses the same record to validate overlay export. Both local sidecars are setup/review inputs, but Netlify still receives only one public built HTML document.

The tool never runs `netlify login`, accepts stdin, or invokes `netlify link`. `sites:create --disable-linking`, child-only site scope, and the isolated child working directory prevent caller-owned `.netlify/state.json`; any CLI-private state created inside the temporary project is discarded by the guarded cleanup. Caller files are never mutated.

### Success output

Only after the verified environment/blob writes, successful production deploy, and successful local cleanup, stdout is exactly these five LF-terminated lines, substituting only validated values:

```text
Connected document 4b7d2a with owner owner@example.com at https://fixture-site.netlify.app/.
Whoever can deploy this file decides who owns it.
WARNING: In standalone mode, an editor can change the live document without review.
WARNING: Export is the only path back to a reviewable artifact.
WARNING: A Netlify account with site access outranks the document owner.
```

No earlier step prints this receipt. Suppress successful protocol-command output so provider JSON and account data do not mingle with it. On failure, print exactly `connect: setup failed\n` unless this contract names the conflict, new-site, or cleanup line; return exit 1 and never claim connection. The new-site line is exactly `connect: setup failed; inspect Netlify site name <validated-name>\n`, allowing recovery after uncertain creation without disclosing a provider object or newly assigned identifier. Cleanup has the precedence stated above.

## Files owned

- `scripts/connect.mjs` — **new**; Mode A site selection, owner seeding, deployment, warnings, and the downstream P4-R extension seam.
- `scripts/connect.test.mjs` — **new**; permanent source-bound validator, supervisor, fake-CLI, cleanup, command-output, and opt-in hosted lifecycle gate. P4-R may amend this same test file only for its serialized promotion coverage.
- `docs/tickets/P4-S.md` — **new canonical specification**; not an implementation path.

No other file is owned. In particular, do not edit the standalone input, `.netlify/state.json`, `netlify.toml`, dependency manifests, server modules, templates, generated outputs, or `history.json`.

## Dependencies

- **P2-D/P2-E/P1-B:** own the edit manifest, canonical history sidecar, embedded-history serialization, size/retention rules, and the exact correspondence this command validates.
- **P2-G:** owns the `DOC_OWNERS` grammar, permanent document ID, owner-capture semantics, and the rule that a captured store record outranks later environment edits.
- **P1-E/P2-A/P3-J and their server predecessors:** supply the already-configured Mode B-compatible deploy tree that the Mode A tool packages without modification. If that tree cannot deploy a root `index.html`, stop and report the integration gap.
- **Repository verification infrastructure:** the integrated predecessor must already contain root `scripts/scrub-check.sh`, executable `templates/check-dist`, and `templates/docbuild` with its `npm run check`; P4-S invokes but never amends them. A missing/non-executable prerequisite blocks integration rather than widening this ticket's files.
- **P4-N:** consumes the validated private `mode/<docId>/manifest.json` in its Mode A apply branch and must add P4-S as an integration dependency. It uses row membership/tag/hash but never the retained source `file` as a Mode A path.
- **P4-R:** is the only later ticket allowed to amend `scripts/connect.mjs`; it adds export/promotion after this setup protocol and depends on P4-S, P4-N, and P4-O.

### Maximum safe implementation waves

1. The pure argument/email/HTML validators and fake-child supervisor tests can be implemented independently.
2. Serialize the CLI runner and temporary deployment-tree assembly in `scripts/connect.mjs` because they share process and cleanup state.
3. P4-R starts only after P4-S lands. No other ticket edits the tool; backend and UI tickets can proceed in parallel because they own disjoint files.

## Acceptance criteria

- [ ] The only new implementation paths are `scripts/connect.mjs` and `scripts/connect.test.mjs`; the command has the exact exports, import safety, zero runtime dependencies, and no token-reading surface.
- [ ] Arguments, all three distinct file types/sizes/UTF-8 bodies, HTML meta, canonical sidecar and embedded history equality, nonempty-hex manifest/history head, exact block/tag/hash correspondence, document ID, owner email, site name, and site ID obey the closed contracts before CLI state changes.
- [ ] Every subprocess uses argument arrays with `shell: false`, ignored stdin, the exact environment allowlist, and one bounded supervisor; it never prints a command, environment, rejected input, or provider body.
- [ ] A new-site run derives one canonical site ID; an existing-site run uses only the explicit site ID; neither writes local link state.
- [ ] A different existing `DOC_OWNERS` value fails without overwrite/deploy, while an exact same seed is idempotent and skips `env:set`.
- [ ] A new seed and the private exact manifest are each written and read back before deploy; an unverified, masked, whitespace-changed, or failed value cannot reach production deploy.
- [ ] Local preflight builds separate private/project/public directories before mutation; deployment exposes only the unchanged input at `publish/index.html` plus the fixed repository-owned backend, accepts only a safe HTTPS result URL, and cleans only its guarded temporary tree.
- [ ] Success prints the exact owner receipt, deploy URL, deployer-authority sentence, and all three Mode A warnings; no failure path prints them.
- [ ] P4-R is named as the serialized next owner of this exact file and no second connect/export tool remains ambiguous.
- [ ] Static, fake-CLI, cleanup, full repository, scrub, and issue #41 immutable-pointer gates pass.

## Test plan

### 1. Static and deterministic fake-CLI gate

Run after the implementation commit, with its reviewed predecessor recorded in `P4S_BASE`. The targeted status check requires both owned executable paths to match the index and `HEAD` before their working-tree bytes are executed; unrelated worktree changes do not block this ticket gate.

```bash
set -euo pipefail
: "${P4S_BASE:?export P4S_BASE as the reviewed 40-character lowercase commit ID}"
printf '%s\n' "$P4S_BASE" | grep -Eq '^[0-9a-f]{40}$'
test "$(git rev-parse --verify "${P4S_BASE}^{commit}")" = "$P4S_BASE"
test -z "$(git status --porcelain=v1 --untracked-files=all -- scripts/connect.mjs scripts/connect.test.mjs)"
node scripts/connect.test.mjs
```

`scripts/connect.test.mjs` uses only Node built-ins and invented public data. It imports the command to prove the exact exports and no import effects; exercises argument, email, meta, manifest, block scanner/hash, canonical history, and sidecar/embedded-equality accept/reject matrices, including a leading UTF-8 BOM, U+212A, slash-bearing local parts, every recognized injected-environment property failure, and ignored hostile unknown-environment accessors; and checks same-path plus hard-link aliases and read/stat/close races. Its fake process/fs/timer seams record all calls and assert the new-site sequence `sites:create`, first `env:get`, `env:set`, second `env:get`, `blobs:set`, `blobs:get`, `deploy`; the existing-site and same-seed omissions; exact arguments/cwd/environment allowlist; ignored stdin; one child at a time; byte-identical upload/download/HTML; lexically walked symlink-free source copy; public-directory isolation; and guarded cleanup. It also covers a conflicting seed, malformed provider JSON/site/URL, missing auth, unexpected nonzero, signal, spawn error, each stream overflow, deterministic timeout TERM/KILL/reap, failed cleanup, and zero success output on every failure. It proves that synchronous `sites:create` spawn failure remains `setup`, while every failure after a child object is returned is `new-site` unless local cleanup fails. A spawned end-to-end fake executable proves `main()`'s exact exit codes and stderr/stdout lines without exposing its captured environment.

The supplemental source predicate reads `scripts/connect.mjs` as UTF-8 and requires every static import specifier to be named and every source to belong to the exact set `node:crypto`, `node:child_process`, `node:fs/promises`, `node:os`, `node:path`, and `node:url`; dynamic `import(` and `require(` are absent. It rejects the exact token regex `\b(?:exec|execFile|execSync|execFileSync|fork|spawnSync|fetch)\s*\(`, `\bprocess\s*\.\s*exit\s*\(`, and any ASCII uppercase identifier/string word matching `\b[A-Z0-9_]*(?:TOKEN|PASSWORD|COOKIE|SECRET)[A-Z0-9_]*\b`. Runtime seam assertions separately prove that the sole permitted `spawnFn` always receives `shell: false`, ignored stdin, and the closed environment. These are test predicates, not a ban on the literal `https:` validation or the documented `DOC_OWNERS` seed.

Expected: exit 0, no network, and exactly these final two lines:

```text
PASS  P4-S pure connect contract
PASS  P4-S supervised Netlify protocol
```

### 2. Repository and pointer gate

```bash
set -euo pipefail
: "${P4S_BASE:?export P4S_BASE as the reviewed 40-character lowercase commit ID}"
printf '%s\n' "$P4S_BASE" | grep -Eq '^[0-9a-f]{40}$'
test "$(git rev-parse --verify "${P4S_BASE}^{commit}")" = "$P4S_BASE"
npm --prefix templates/docbuild run check
templates/check-dist
scripts/scrub-check.sh docs/tickets/P4-S.md scripts/connect.mjs scripts/connect.test.mjs
git diff --check "$P4S_BASE"...HEAD
git diff --check
command -v gh >/dev/null

test "$(git diff --name-only "$P4S_BASE"...HEAD | sort)" = "scripts/connect.mjs
scripts/connect.test.mjs"
test -z "$(git status --porcelain=v1 --untracked-files=all -- scripts/connect.mjs scripts/connect.test.mjs)"

issue_json=$(mktemp)
trap 'rm -f "$issue_json"' EXIT
gh api repos/aiur-team/architecture-docs/issues/41 >"$issue_json"
node --input-type=module - "$issue_json" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(issue.title, "P4-S — The connect tool sets the owner");
const match = issue.body.match(/^Implementation specification: \[`docs\/tickets\/P4-S\.md`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/docs\/tickets\/P4-S\.md\)\n\nThis issue tracks implementation of the linked canonical specification\.$/);
assert.ok(match);
assert.deepEqual(execFileSync("git", ["show", `${match[1]}:docs/tickets/P4-S.md`]), readFileSync("docs/tickets/P4-S.md"));
console.log("PASS  P4-S repository gates");
NODE
```

Expected: every command exits 0; `check-dist` reports all committed documents byte-identical after rebuild; the issue body contains only the two-paragraph permanent pointer; commit-addressed bytes equal the local canonical document; and the final line is `PASS  P4-S repository gates`.

### 3. One disposable hosted proof

After a separate `netlify login` to a disposable account and with no Netlify token in the command environment, run:

```bash
set -euo pipefail
AIUR_CONNECT_HOSTED=1 node scripts/connect.test.mjs --hosted
```

The opt-in branch resolves the OS temporary directory through `realpath()`, applies the production printable-ASCII/non-root rule, and creates a strict-child `p4s-hosted-` evidence root with `mkdtemp()` and mode `0700`. Its exact recovery path is `<evidence-root>/manual-remediation.json`. Before any remote work, open that path with `wx` and mode `0600` and write `JSON.stringify({ v: 1, siteName, siteId: null }, null, 2) + "\n"`. `siteName` is exactly `aiur-p4s-${process.pid.toString(36)}-${randomBytes(16).toString("hex")}`, must pass the production site-name regex, and is never supplied by a human. Once a canonical site ID is known, atomically replace the record with the same ordered keys and that ID by writing a mode-`0600` strict-child sibling, renaming it over the record, and removing only that sibling on a failed replacement. The hosted branch applies the production child-process supervisor, output cap, path validation, and cleanup guard to every additional test operation. It gives the complete test 900 seconds.

After the version/help preflight below and before `sites:create`, run exactly `netlify sites:search <siteName> --json` with no `NETLIFY_SITE_ID`. Require exit 0 and parse stdout once as a JSON array of at most 100 rows. Every row must be an ordinary object with string `id` and `name`; validate every `id` as a canonical site UUID and every `name` with the production site-name grammar, ignoring only additional plain-data fields. Filter with exact code-unit equality on `name`. The pre-create result must contain zero exact matches. A malformed row, nonzero exit, or any exact match fails without remote mutation and retains the evidence root. Every later search uses this identical protocol. More than one exact match is ambiguous and causes no delete or blob mutation, retains evidence, and fails. If the runner returned a canonical site ID, retain it as the cleanup target; a later zero-match search does not erase that knowledge, while one exact row must carry the same ID and a different ID fails without mutation. If creation may have succeeded before returning a usable ID, the pre-create-zero proof permits exactly one later exact-name row to be adopted and recorded for recovery; zero means no recovered target. Thus cleanup never derives an ID from a partial-name match or deletes a name that existed before this test.

As the first child-process work after local evidence creation, before any provider query or mutation, the hosted branch runs every auxiliary CLI child with `cwd` exactly the already-validated evidence root. It first runs `netlify --version` and requires exit 0, empty stderr, valid UTF-8 stdout with at most one final LF and optional preceding CR, and first U+0020-delimited token exactly `netlify-cli/27.4.2`. It then runs each exact argv `sites:create --help`, `sites:search --help`, `env:get --help`, `env:set --help`, `blobs:set --help`, `blobs:get --help`, `blobs:delete --help`, `deploy --help`, and `sites:delete --help`, each without `NETLIFY_SITE_ID`; each must exit 0 with empty stderr and valid bounded UTF-8 stdout. Normalize only CRLF to LF for this help oracle. A help heading is exactly one line matching `^[A-Z][A-Z ]*$`, with no trailing space. Isolate text between the sole exact `USAGE` heading and the next help heading, and require respectively the literal usage line `$ netlify sites:create [options]`, `$ netlify sites:search [options] <search-term>`, `$ netlify env:get [options] <name>`, `$ netlify env:set [options] <key> [value]`, `$ netlify blobs:set [options] <store> <key> [value...]`, `$ netlify blobs:get [options] <store> <key>`, `$ netlify blobs:delete [options] <store> <key>`, `$ netlify deploy [options]`, and `$ netlify sites:delete [options] <id>`. Isolate text between the sole later exact `OPTIONS` heading and the next help heading or EOF and require entries for, respectively, `--disable-linking`/`--json`/`--name <name>`, `--json`, `--context <context>`, no additional option, `--input <path>`, `--output <path>`, `--force`, `--prod`/`--no-build`/`--dir <path>`/`--json`, and `--force`. For each required spelling `s`, require `new RegExp("^  (?:-[A-Za-z], )?" + escapeRegExp(s) + "(?: {2,}|$)", "m").test(optionsSection)`, where private `escapeRegExp()` escapes every regular-expression metacharacter. Missing/duplicate headings, usage lines, or required option-definition spellings fail before mutation.

Through the exported runner, the branch performs the new-site path, captures the returned site ID without printing it, performs an idempotent same-owner repeat through the existing-site path, and confirms a different owner is refused before mutation. It proves `DOC_OWNERS` and the private manifest by exact read-back. Fetch the canonical result URL with a ten-second abort and `redirect: "manual"`; require status `302`, `Location` exactly `/login/?next=%2F`, `Cache-Control` exactly `private, no-store`, and zero response-body bytes. The fake-CLI public-tree oracle—not an impossible authenticated body read—proves neither sidecar entered `publish/`.

Before the hosted branch, snapshot `.netlify/state.json` under the captured caller working directory and captured repository root, deduplicating an equal path, as either absent or stable regular-file bytes plus device, inode, size, `mtimeMs`, and `ctimeMs`. After the branch, each named path must remain absent if absent or exactly byte/metadata unchanged if present. The test makes no claim about unrelated paths outside these two named roots; CLI-private state below the guarded test/runner roots is discarded.

Remote cleanup is registered by the validated unique site name before the pre-create search. The injected `spawnFn` wrapper records command progress without reading provider data: once a `blobs:set` child object is returned, set `blobWriteMayHaveOccurred = true` before awaiting any event. In `finally`, use the exact search protocol above and select only the validated runner-returned ID or one safely recovered exact-name ID. With that target and the flag true, attempt `netlify blobs:delete doc-state mode/<docId>/manifest.json --force` under a child environment containing only the validated `NETLIFY_SITE_ID` in addition to the allowlist; supervise it fully, but proceed to whole-site deletion after any spawn error, timeout, signal, nonzero, or malformed output because site deletion is the authoritative cleanup. If the flag is false, skip the blob command. Then run exactly `netlify sites:delete <siteId> --force` with no site environment and require exit 0. Poll the exact-name search at most five times two seconds apart and require zero exact matches. Provider output is bounded and ignored. Only after required deletion, remote absence, and unchanged caller link-state snapshots may the guarded evidence root be removed. Otherwise retain its recovery record and print only `P4-S hosted cleanup failed; inspect <validated-evidence-path>\n` to stderr, where `<validated-evidence-path>` is exactly the already-validated `<evidence-root>/manual-remediation.json`; then fail. The branch never creates an Identity user and never prints provider bodies, site name, site ID, deploy ID, account data, fixture email, or credentials.

Expected: exit 0 and exactly `PASS  P4-S hosted connect lifecycle`; the first and repeat runner results select the same site URL, the repeat performs no `env:set`, both explicitly named caller link-state paths remain absent or unchanged, and remote/local cleanup is confirmed before the line is printed.

## Failure modes

- Invalid or hostile arguments/files/HTML/manifest/history/email/site values: exit 2 for arguments or 1 for content; perform no remote mutation and echo no rejected value.
- Missing, unauthenticated, account-ambiguous, interactive, or incompatible Netlify CLI before mutation or on an existing-site run: fail noninteractively as `connect: setup failed`; the operator performs login/team selection separately and retries. On a named-site run, a synchronous `sites:create` spawn failure remains `setup`, but once `spawnFn` returns a child object every non-cleanup failure uses the exact new-site inspection line because creation may have occurred.
- Named-site creation may have succeeded but any later setup step fails: print only the exact safe new-site inspection line so the operator can find the already-supplied name; do not print an assigned ID or ownership receipt. Retry may select that site explicitly after inspection or the operator may delete it.
- Owner seeding succeeds but manifest publication/deploy fails: retain the authoritative seed and any exact manifest, report failure, and make a retry idempotent; never unset authority or delete possibly-consumed apply state automatically.
- Existing different `DOC_OWNERS`: refuse without overwrite. The operator must choose a new empty site or perform a separately reviewed migration.
- Concurrent connect commands targeting one existing site: unsupported because Netlify's CLI environment/blob writes expose no conditional transaction. Operators serialize connect/reconnect per site; the read-back catches many races but is not claimed to prevent every last-write-wins interleaving.
- Process overflow, hang, signal, or spawn error: terminate/reap the exact child, clean only the guarded temp tree, fail closed, and print no provider detail.
- Local cleanup cannot complete: its safe path-bearing line takes precedence over any earlier tag; do not print another line or broaden deletion. Hosted remote cleanup cannot prove exact-name absence: retain the mode-`0600` recovery record, print only its validated path using the separately specified hosted line, and fail.
- Mode A to Mode B changes the public URL: P4-S makes no promise; the permanent `/d/<docId>` redirect is the migration mechanism once a repo-backed site exists.

## Settled decisions

- The connect/export tool is `scripts/connect.mjs`, written as dependency-free Node ESM; P4-R amends this exact file.
- The official Netlify CLI owns authentication. The tool never asks for or reads a token.
- Mode A uses the exact P2-D sidecar uploaded privately at `mode/<docId>/manifest.json`; public HTML or request data never becomes server manifest authority.
- Editable Mode A always starts from a canonical P2-E history sidecar exactly mirrored in the HTML. The history stays local; only HTML is public and only the edit manifest is private runtime authority.
- Mode A narrows P2-D's otherwise opaque/possibly empty `commit` at admission to exactly seven lowercase hexadecimal characters so it equals the required P2-E history head and gives later edit/suggestion events a valid `docVersion`.
- One Mode A site contains one standalone document; a nonempty different `DOC_OWNERS` value is not merged automatically.
- Authority is seeded before deploy and verified by read-back. The runtime store becomes authoritative after P2-G's first-owner capture.
- No local site link is created; site scope is a child-only `NETLIFY_SITE_ID`.
- The CLI runs noninteractively from an isolated project with an exact environment allowlist. `sites:create --disable-linking` and `deploy --no-build --dir publish` keep caller state and private sidecars out of the public artifact.
- `DOC_OWNERS` is ordinary all-context environment configuration, not a secret and not committed into the HTML.
- Mode A direct edits have no review gate, export is the route back to a reviewable artifact, and Netlify site administrators outrank document roles; the tool says all three facts.

## Assumptions and open questions

- **Assumption:** the repository-owned `netlify.toml`, `netlify/`, and root dependency manifests form a deployable backend beside a standalone root `index.html`; this ticket packages them but does not change them.
- **Assumption:** a document intended for Mode A editing is accompanied locally by the P2-D edit sidecar and P2-E history sidecar built with it. The public deploy still contains one HTML document; the edit sidecar becomes private server authority and the history sidecar remains local review state. A file without both may still be hosted manually but cannot enter the editable Mode A contract.
- **Assumption:** Netlify CLI `27.4.2` supports `sites:create --disable-linking --json`, exact-name recovery through `sites:search <name> --json`, `env:get --context production`, `env:set`, `blobs:set --input`, `blobs:get --output`, `blobs:delete --force`, `deploy --prod --no-build --dir publish --json`, `sites:delete --force`, and site selection through `NETLIFY_SITE_ID`, as verified against official documentation/current help in September 2026. The hosted gate must fail and reopen this contract if any JSON field or exit convention differs.
- **Open question, not blocking P4-S:** whether a CLI-upload site can later attach a Git repository without changing its URL. P4-R must preserve doc ID and document the `/d/<id>` migration fallback.

## References

- `docs/research/00-integration-plan.md` §§1.3–1.5, 4.7, rulings 29, 32, 35, and 38 — authoritative Mode A, owner, apply-path, and connect-tool decisions.
- `docs/research/09-sharing-and-roles.md` §§6.1–6.3 — `DOC_OWNERS`, first-owner binding, and the three warnings.
- `docs/tickets/P2-G.md` — exact owner seed grammar, key authority, and capture semantics.
- `docs/tickets/P2-D.md` and `docs/tickets/P2-E.md` — exact edit-manifest, history-sidecar, retention, and embedded-history contracts.
- `docs/tickets/P3-J.md` — Mode A HTML gate and document-ID metadata boundary.
- `docs/tickets/P4-R.md` — serialized downstream export/promotion amendment to this tool.
- Netlify, “Get started with Netlify CLI,” last checked 2026-09-03 — official create/link, manual production deploy, environment, and site-ID guidance.
- Netlify CLI reference, `sites`, `env`, `blobs`, and `deploy`, checked 2026-09-03 — `--disable-linking`, site scoping, private blob file I/O, `--no-build`, publish-directory, and JSON protocol surfaces required by the hosted gate.
