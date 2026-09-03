# P4-G — Documentation

## Outcome

`templates/README.md` gives a writer one tested, self-contained procedure for creating, building, publishing, and renaming a document without changing its permanent identity or silently orphaning comments.

## Context

The platform now distinguishes permanent storage identity, mutable URL identity, and filesystem instance location. It also generates committed anchor/history state and has two build modes. These contracts are safe only if a writer can follow them without reading implementation code or the research plan. This ticket is drafted in parallel but integrated last so its commands, output examples, and names match the completed Build Order.

## Scope

### In scope

- Amend `templates/README.md`; preserve its current purpose, voice, and existing authoring guidance.
- Document required `doc.json` fields `id`, `slug`, and `aliases`, including exact grammars and global uniqueness.
- Give an exact new-document initialization procedure using `openssl rand -hex 3` once and replacing the skeleton placeholder values before publication.
- Give an exact slug-rename procedure that preserves `id`, appends the old slug once to `aliases`, validates redirects, and never derives a state key from a URL/directory.
- Explain optional instance-directory rename separately from a URL rename.
- Document sentence-per-line source authoring, its scope, and its no-render-change purpose.
- Document `templates/build <instance>` and `templates/build --site`, their committed/noncommitted outputs, and the repository gates.
- Explain every anchor-report category and the required writer response to `ORPHANED`.
- Include a compact command checklist a writer can copy without consulting another document.

### Out of scope

- Changing the builder, templates, sample metadata, generated files, CI, Netlify configuration, functions, client behavior, or repository-root `README.md`.
- Re-documenting every comments, editing, realtime, sharing, suggestion, access, retention, or provider operation.
- Adding a documentation generator, screenshot, video, migration command, alias repair tool, or compatibility behavior.
- Claiming a rename repairs a previously changed/reused ID, resolves a prior alias collision, or migrates Mode A to Mode B.
- Publishing real private names, addresses, hosts, document text, credentials, or production output.

## Interface contract

### Required section placement

Amend the existing README in place. Keep its H1 and existing sections. Insert one new `## Document identity and URLs` section immediately after `## Make a new document`; add `### Rename a published document` and `### Rename an instance directory` under it. Add `## Build an artifact or a site`, `## Write prose one sentence per line`, and `## Read the anchor report` before the current `## What the build checks`. Consolidate duplicated build/check prose so each normative command has one explanation.

The README remains ordinary Markdown with fenced shell/JSON examples. Examples use only invented names and reserved domains. It contains no absolute local path, private host, token, real address, issue implementation checklist, or research-only contradiction history.

### `doc.json` identity contract

The documentation must show this invented example:

```json
{
  "id": "4b7d2a",
  "slug": "cache-notes",
  "aliases": [],
  "title": "Cache notes"
}
```

It must state:

- `id` is required, exactly six lowercase hexadecimal characters, generated once with `openssl rand -hex 3`, globally unique across tracked `doc.json` files, used as `<docId>` for state and `/d/<id>`, and never edited/reused/derived.
- `slug` is required, matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, is globally unique, controls the current hosted URL, and may change.
- `aliases` is a required array of prior slugs. Items use the same grammar, are unique globally across every current slug/alias, and never contain the current slug.
- `api`, `d`, `login`, `invite`, and `_assets` are reserved and cannot be slugs/aliases.
- The instance directory is a filesystem/build input, not document identity or necessarily the URL.
- A copied skeleton's placeholder `id` and `slug` are not publishable values.

### New-document procedure

The README must give these steps, in order, using the invented `cache-notes` instance/slug. It explains that the writer may replace every occurrence with one different grammar-valid, collision-free name; the fenced commands themselves contain no shell metacharacter placeholders:

```bash
cp -R templates/skeleton cache-notes
openssl rand -hex 3
"${EDITOR:-vi}" cache-notes/doc.json
"${EDITOR:-vi}" cache-notes/sections/*.html
templates/build cache-notes
git add cache-notes
templates/build --site
git add cache-notes
templates/check-dist
scripts/scrub-check.sh
npm --prefix templates/docbuild run check
git diff --check
git diff --cached --check
```

The generated six-hex value is copied into `id`; `cache-notes` is written into `slug`; `aliases` stays `[]` for a never-published name. The writer reviews `git diff`, confirms the ID/slug/alias global checks performed by the instance build, and reads the anchor report. The first `git add cache-notes` must occur before `templates/build --site`: site mode discovers publishable tracked instances, so the new document must already be in the git index for its route and global collisions to be checked. The second `git add cache-notes` restages any committed outputs refreshed by site mode. Before publication, the writer runs `templates/check-dist` against that tracked-document inventory and reviews both `git diff` and `git diff --cached --check`. The commit includes the instance's `doc.json`, `sections/`, `anchors.json`, `history.json` when produced, and `dist/`. `_site/` remains generated/deploy output and is not committed.

### Rename procedures

For a URL rename from `cache-notes` to `bounded-cache`, the README must require one atomic metadata edit:

```json
{
  "id": "4b7d2a",
  "slug": "bounded-cache",
  "aliases": ["cache-notes"]
}
```

The steps are exact:

1. Record the current `id` and `slug` from `doc.json`.
2. Confirm the new slug is valid, nonreserved, and absent from every tracked current slug/alias.
3. Keep `id` byte-for-byte unchanged.
4. Append the old slug once to the end of `aliases`, preserving all earlier aliases, then set `slug` to the new value.
5. Run `templates/build <instance>` and `templates/build --site`.
6. Require `_site/bounded-cache/index.html`, `/d/4b7d2a -> /bounded-cache/ 301`, and `/cache-notes -> /bounded-cache/ 301!` in `_site/_redirects`.
7. Read the anchor report, run all repository gates, review the diff, and publish both metadata and generated committed inputs.

It must explicitly say: do not replace an old alias; do not remove aliases after redirects are shared; do not change `id`; do not rename the directory merely to change the URL; and never edit `_site/_redirects` by hand.

Directory rename is optional and separate. If repository organization also requires it, use `git mv <old-instance> <new-instance>` before the two builds, leave `id` unchanged, and decide the URL solely through `slug`/`aliases`. The writer must review P2-E history behavior on the resulting diff; the documentation makes no promise that a filesystem move alone changes or preserves a URL.

### Build modes and output ownership

Document the exact distinction:

| Command | Scope | Required result | Commit? |
|---|---|---|---|
| `templates/build <instance>` | One source instance | Refresh `<instance>/dist/<basename>.html` and the instance's generated committed inputs | Commit changed `dist/`, `anchors.json`, and `history.json` when validly refreshed |
| `templates/build --site` | Every publishable tracked instance | Refresh artifacts, build `_site/<slug>/index.html`, `_site/index.html`, `_site/_redirects`, and hashed enhancement asset | Do not commit `_site/` |
| `templates/check-dist` | Every tracked document | Rebuild and prove committed output byte-identical | No rewrite accepted; update source/generated inputs first |

Explain that site and artifact HTML differ only by the hosted enhancement-script line, that the document-id meta element is in both, and that neither build fetches comments or live state into committed artifacts. `docbuild --site` is the underlying CLI spelling; writers normally use the repository wrapper `templates/build --site`.

### Sentence-per-line convention

The README must state: in prose paragraphs, headings, list items, blockquotes, table cells, and `<details>` copy inside `sections/*.html`, start each new prose sentence on a new source line while preserving the enclosing HTML. Do not reflow code/preformatted blocks, diagram source, JSON, shell examples, URLs, or a sentence merely because it wraps visually. Browsers collapse ordinary HTML whitespace, so this convention is for readable git diffs and does not intentionally add `<br>`, change rendered spacing, or alter text content.

### Anchor report interpretation

Document all categories exactly:

| Report token | Meaning | Writer action |
|---|---|---|
| `equal` | Block text/order match retained the existing `data-aid` | No action beyond normal diff review |
| `edited` | Similar replacement at or above the 0.6 threshold retained the ID | Confirm the intended block kept the ID and inspect comment quote drift |
| `moved` | Exact orphaned text reappeared and reclaimed its prior ID | Confirm the move is intentional |
| `ORPHANED` | An old block ID no longer has a safe match | Review `anchors.json` and affected prose; accept only when comments should become moved/orphaned |

An unchanged second build must report zero `ORPHANED` and leave `anchors.json` byte-identical. The report is a warning, not permission to hand-edit IDs until it becomes green. A whole rewrite may legitimately orphan threads, but the writer must make that visible in review rather than suppress it.

### Final-integration rule

The document may be drafted while implementation continues because it owns only `templates/README.md`. It is accepted and integrated only after every ticket whose shipped command or term it names is present on the combined Phase 4 branch. The final validation follows the README literally in a clean worktree; undocumented local knowledge does not count.

## Files owned

- `templates/README.md` — **amended**; pre-existing before the Build Order, and amended only for the author-facing identity, rename, sentence-per-line, build-mode, and anchor-report contract above.

No builder, template source, function, config, workflow, example, generated output, ticket, prompt, or research file is owned by P4-G.

## Dependencies

P4-G has no source-file collision with another Phase 4 ticket, so drafting may proceed in parallel. Its implementation/integration is semantically last and depends on the complete Build Order (“everything” in the authoritative plan), with these load-bearing inputs:

- **P1-A:** final `id`/`slug`/`aliases` grammar, skeleton placeholder, uniqueness, and rename invariants.
- **P1-D:** generated `anchors.json`, shared anchor identity, exact report tokens, stability, and orphan meaning.
- **P1-E:** wrapper/CLI spelling, site discovery, reserved names, clean URL output, redirects, `_site/`, and repository gates.
- **P2-E:** committed/fallback `history.json`, public-history approval, and source-path/history behavior.
- **All P2–P4 tickets:** final shipped names, environment modes, file ownership, and command behavior must not contradict the author procedure. P4-G does not need to describe every feature, but final review waits until their interfaces stop moving.

Maximum safe work: one agent edits `templates/README.md`; other agents may work on disjoint source. One integrator runs clean-tree instructions and merges P4-G last.

## Acceptance criteria

- [ ] The README contains all required sections, examples, exact commands, identity rules, rename steps, build/output table, sentence convention, and four-category anchor table.
- [ ] A writer can copy the skeleton, replace its placeholder identity, build one artifact and the site, and identify every file to commit without another document.
- [ ] The rename drill preserves `id`, retains every alias, produces both permanent-ID and old-slug redirects, keeps state identity, and requires no hand-edited output.
- [ ] The sentence convention distinguishes source lines from visual wrapping and forbids semantic `<br>` changes.
- [ ] Anchor guidance explains both safe retention and visible orphaning; an unchanged rebuild has an exact byte-stability oracle.
- [ ] Every example is invented/public-safe and every command is repository-relative and current.
- [ ] The AST/text oracle proves the exact required semantic statements without claiming prose quality from a loose keyword grep.
- [ ] A clean-worktree runtime drill executes the documented build/check sequence and verifies generated route/redirect bytes.
- [ ] Only `templates/README.md` is implemented by this ticket; no generated file is changed merely to make the docs test pass.
- [ ] Issue #29 keeps its title and exact full-commit permalink pointer to byte-identical canonical spec bytes.

## Test plan

### Exact documentation contract gate

Run from the repository root after amending the README:

```bash
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const text = await readFile("templates/README.md", "utf8");
const headings=[];
let fence=null;
for(const [lineNumber,line] of text.split("\n").entries()){
  const marker=/^(`{3,}|~{3,})/.exec(line)?.[1];
  if(marker){
    if(fence===null)fence=marker[0];
    else if(marker[0]===fence)fence=null;
    continue;
  }
  if(fence!==null)continue;
  const match=/^(#{2,3}) (.+)$/.exec(line);
  if(match)headings.push({level:match[1].length,title:match[2],line:lineNumber+1});
}
const exactlyOne = (level,title) => {
  const matches=headings.filter((heading)=>heading.level===level&&heading.title===title);
  assert.equal(matches.length,1,`expected one level-${level} heading: ${title}`);
  return matches[0];
};
const make=exactlyOne(2,"Make a new document");
const identity=exactlyOne(2,"Document identity and URLs");
const rename=exactlyOne(3,"Rename a published document");
const directory=exactlyOne(3,"Rename an instance directory");
const build=exactlyOne(2,"Build an artifact or a site");
const sentences=exactlyOne(2,"Write prose one sentence per line");
const anchors=exactlyOne(2,"Read the anchor report");
const checks=exactlyOne(2,"What the build checks");
const h2=headings.filter((heading)=>heading.level===2);
assert.equal(h2.indexOf(identity),h2.indexOf(make)+1,"identity section must immediately follow Make a new document");
const nextAfterIdentity=h2[h2.indexOf(identity)+1];
assert(identity.line<rename.line&&rename.line<directory.line&&directory.line<nextAfterIdentity.line,"rename subsections must be ordered inside identity section");
assert(build.line<sentences.line&&sentences.line<anchors.line&&anchors.line<checks.line,"build, sentence, and anchor sections must be ordered before What the build checks");
const newDocumentSequence=[
  "cp -R templates/skeleton cache-notes",
  "openssl rand -hex 3",
  '"${EDITOR:-vi}" cache-notes/doc.json',
  '"${EDITOR:-vi}" cache-notes/sections/*.html',
  "templates/build cache-notes",
  "git add cache-notes",
  "templates/build --site",
  "git add cache-notes",
  "templates/check-dist",
  "scripts/scrub-check.sh",
  "npm --prefix templates/docbuild run check",
  "git diff --check",
  "git diff --cached --check",
].join("\n");
assert(text.includes(newDocumentSequence),"new-document commands must stage before site discovery and restage afterward in exact order");
for (const exact of [
  "openssl rand -hex 3", "templates/build <instance>", "templates/build --site",
  "templates/check-dist", "scripts/scrub-check.sh", "npm --prefix templates/docbuild run check",
  "git diff --check", "^[a-z0-9]+(?:-[a-z0-9]+)*$", "api", "_assets",
  "equal", "edited", "moved", "ORPHANED", "0.6", "_site/", "anchors.json", "history.json",
]) assert(text.includes(exact), `missing exact contract text: ${exact}`);
assert.match(text, /id[^\n]+never (?:changes|edited)|never (?:change|edit)[^\n]+id/i);
assert.match(text, /append[^\n]+old slug[^\n]+aliases/i);
assert.match(text, /one sentence per (?:source )?line/i);
assert.match(text, /do not commit[^\n]+_site|_site[^\n]+not committed/i);
assert.doesNotMatch(text, /(?:\/Users\/|\/home\/|file:\/\/)/);
console.log("PASS  P4-G documentation contract");
NODE
```

Expected: exit `0`, no stderr, and exactly `PASS  P4-G documentation contract`. Review additionally checks each matched statement in context; the command proves required exact clauses are present, not that unrelated prose is correct.

### Clean rename/build drill

Run only from a clean worktree after the full Phase 4 integration. It uses a detached temporary worktree, traps cleanup, modifies only the temporary copy, and gives each build/check subprocess a five-minute deadline through the inline Node `bounded` helper.

```bash
set -eu
test -z "$(git status --porcelain)"
p4g_tmp=$(mktemp -d "${TMPDIR:-/tmp}/p4g.XXXXXX")
cleanup() {
  status=$?
  git worktree remove --force "$p4g_tmp" >/dev/null 2>&1 || true
  rmdir "$p4g_tmp" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT HUP INT TERM
git worktree add --detach "$p4g_tmp" HEAD >/dev/null
cd "$p4g_tmp"
bounded() {
  node --input-type=commonjs - "$@" <<'NODE'
const {spawnSync}=require("node:child_process");
const [command,...args]=process.argv.slice(2);
const result=spawnSync(command,args,{stdio:"inherit",timeout:300_000});
if(result.error?.code==="ETIMEDOUT")process.exit(124);
if(result.error)throw result.error;
if(result.signal)process.kill(process.pid,result.signal);
process.exit(result.status??1);
NODE
}
old_id=$(node -p 'require("./example/doc.json").id')
node --input-type=module <<'NODE'
import {readFileSync, writeFileSync} from "node:fs";
const file="example/doc.json";
const doc=JSON.parse(readFileSync(file,"utf8"));
if(doc.slug!=="example"||doc.aliases.length!==0) throw new Error("fixture identity changed");
writeFileSync(file,JSON.stringify({...doc,slug:"bounded-cache",aliases:["example"]},null,2)+"\n");
NODE
bounded templates/build example
cp example/anchors.json "$p4g_tmp/.p4g-anchors.before"
bounded templates/build example >"$p4g_tmp/.p4g-second-build.log" 2>&1
sed -n '1,240p' "$p4g_tmp/.p4g-second-build.log"
if grep -F 'ORPHANED' "$p4g_tmp/.p4g-second-build.log"; then exit 1; fi
cmp -s "$p4g_tmp/.p4g-anchors.before" example/anchors.json
bounded templates/build --site
test "$(node -p 'require("./example/doc.json").id')" = "$old_id"
test -f _site/bounded-cache/index.html
grep -Fx "/d/$old_id /bounded-cache/ 301" _site/_redirects
grep -Fx '/example /bounded-cache/ 301!' _site/_redirects
git add example/doc.json example/anchors.json example/history.json example/dist/example.html
bounded templates/check-dist
bounded scripts/scrub-check.sh
bounded npm --prefix templates/docbuild run check
git diff --check
git diff --cached --check
printf '%s\n' 'PASS  P4-G clean rename and build drill'
```

Expected: every command exits `0`; the captured unchanged second instance build contains no `ORPHANED` report and leaves `anchors.json` byte-identical; both exact redirect lines print; the final line is `PASS  P4-G clean rename and build drill`; cleanup removes only the validated temporary worktree. If the documented procedures or final implementation use different canonical redirect bytes, update the README and this oracle together before acceptance rather than weakening the comparison.

### Pointer integrity

```bash
issue_json="$(gh issue view 29 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-G.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-G — Documentation"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-G pointer integrity'
```

Expected after push/update: exit `0` and exactly `PASS  P4-G pointer integrity`.

## Failure modes

| Failure | Required behavior |
|---|---|
| Writer publishes copied skeleton identity | Builder rejects duplicate/placeholder identity; README tells the writer to replace it first. |
| Writer changes slug but not aliases | Old URL is lost; rename procedure explicitly prevents and test detects this. |
| Writer changes ID during rename | State becomes orphaned; procedure forbids it and drill compares exact old/new ID. |
| New slug collides/is reserved | Site build fails; writer chooses another slug rather than editing redirects. |
| Anchor report contains `ORPHANED` | Stop, inspect source/`anchors.json`, and deliberately accept or revise the prose. |
| Generated history cannot refresh | Builder uses its documented committed fallback; README must not recommend deleting history. |
| `_site/` appears in a commit | Documentation says it is uncommitted deploy output; review removes it through the repository's normal reversible workflow. |
| README command differs from shipped CLI | P4-G is not complete; correct the docs or implementation owner before merge. |

## Settled decisions

- `id` is permanent storage identity; `slug` is current URL identity; `aliases` is retained URL history; directory name is neither.
- URL rename keeps `id` and appends the retired slug. Redirect output is generated, never hand-maintained.
- Source prose uses sentence-per-line where HTML whitespace is collapsible; this is a diff convention, not rendered line breaks.
- `templates/build <instance>` and `templates/build --site` are one builder's two modes.
- `anchors.json`, validly refreshed `history.json`, and `dist/` are committed inputs/outputs; `_site/` is not.
- Anchor loss is reported rather than hidden or fuzzily repaired.
- P4-G lands last even though its single documentation file is collision-free.

## Assumptions and open questions

- The author-facing wrapper remains `templates/build`; the underlying executable name `docbuild` is explanatory only.
- The rename test uses `example` because it is an invented public fixture and has an empty initial alias list. It never publishes the temporary build.
- Directory renames are deliberately not part of the normal URL rename. If P2-E's final history contract forbids or further constrains a directory move, preserve that stronger rule in the README before integration.
- No question blocks drafting. Final command/output drift is an integration defect to reconcile after every predecessor lands, not a product choice for P4-G to invent.

## References

- `docs/research/00-integration-plan.md` §§1.3, 3.2, 4.2, 4.6 — identity, anchor report, deterministic build modes, sentence convention, and “everything” dependency.
- `docs/research/01-hosting-and-build.md` §§8–9 — site author flow and rename rationale; authoritative tickets supersede old language/tooling.
- `docs/research/06-history.md` §§3.2 and 4–5 — sentence-per-line and committed history rationale; P2-E is the current executable contract.
- `docs/tickets/P1-A.md` — exact metadata grammar, skeleton placeholder, uniqueness, and rename ownership.
- `docs/tickets/P1-D.md` — anchor report semantics, committed state, and stable rebuild gate.
- `docs/tickets/P1-E.md` — current site CLI, output, redirects, reserved names, ignore policy, and CI gates.
- `docs/tickets/P2-E.md` — final history refresh/fallback/publication contract.
- GitHub issue #29 — tracker pointer only; the canonical specification is this document.
