# P1-A — Add id, slug and aliases to every doc.json

## Outcome

Every committed `doc.json` has an explicit, unique permanent document ID, a unique current URL slug, and an alias history field that downstream build and state features can consume without deriving identity from a directory or URL.

## Context

Comments, edits, history, access grants, realtime channels, and permanent links all need an identity that survives a document rename. This ticket establishes that identity in the three `doc.json` files that exist now; P1-B will expose the ID in built HTML and P1-E will consume the slug and aliases when it builds the hosted site and redirects.

The ruling plan's P1-A row contains `example/doc.json` twice and offers a create-or-exclude branch for an example that was absent when that text was drafted. The current repository already contains `example/doc.json` and five section files, so this ticket amends the existing example and owns only the three paths listed below.

## Scope

### In scope

- Add required top-level `id`, `slug`, and `aliases` fields to each of the three existing `doc.json` files.
- Generate a different ID for each file with the exact mutating procedure in the Test plan. A successful run invokes `openssl rand -hex 3` exactly once per file and writes each output unchanged.
- Set the initial slugs exactly as follows:
  - `example/doc.json`: `example`
  - `templates/components/doc.json`: `components`
  - `templates/skeleton/doc.json`: `short-specific-name`
- Set `aliases` to `[]` in all three files because none of these documents has a retired published slug at the time of this change.
- Preserve every pre-existing metadata value. Place the three identity fields before `title` for a consistent human-readable layout; JSON key order is not semantic.

### Out of scope

- Changing `templates/docbuild/src/index.ts`, `templates/base/layout.html`, or any generated HTML. P1-B owns `{{DOC_ID}}`, the `<meta name="doc-id">` output, and builder integration.
- Implementing `docbuild --site`, validating all documents during a site build, generating clean-URL output, or generating ID/alias redirects. P1-E owns those behaviors.
- Documenting the new-document or rename procedure in `templates/README.md`. P4-G owns that documentation.
- Adding `owner`, `editors`, roles, feature flags, or any other fields to `doc.json`. Authority lives in the state store, not in committed document metadata.
- Renaming directories, changing existing titles or prose, creating another example, or editing section files.
- Adding a schema file, validator module, test file, dependency, or runtime package. The validation command in this ticket is the acceptance check for these data-only amendments.

## Interface contract

The following JSON Schema is the normative `doc.json` shape after this ticket. Only `id`, `slug`, and `aliases` are added by P1-A. `title` remains the builder's pre-existing required field; the remaining named presentation fields remain optional to the builder. Additional properties stay allowed so later tickets can extend metadata without changing this contract first.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "slug", "aliases", "title"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[0-9a-f]{6}$"
    },
    "slug": {
      "type": "string",
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "aliases": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
      },
      "uniqueItems": true
    },
    "title": { "type": "string" },
    "eyebrow": { "type": "string" },
    "status": { "type": "string" },
    "heading": { "type": "string" },
    "lede": { "type": "string" },
    "meta": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "footer": { "type": "string" }
  },
  "additionalProperties": true
}
```

A complete invented example is shown below. `7a4c2e` is reserved for documentation and must not be copied into any owned file; generate each real value with the command above.

```json
{
  "id": "7a4c2e",
  "slug": "sample-system",
  "aliases": [],
  "title": "Sample System",
  "eyebrow": "Example team · Architecture",
  "status": "Draft",
  "heading": "How the sample system is arranged",
  "lede": "An invented document used only to demonstrate the metadata contract.",
  "meta": {
    "Owner": "Example team",
    "Status": "Draft"
  },
  "footer": "Sample system · architecture document"
}
```

Validation and lifecycle rules:

- `id` is required and must match `^[0-9a-f]{6}$`: exactly six lowercase hexadecimal characters and no prefix or whitespace.
- Use the exact mutating implementation procedure in the Test plan. On a successful run it calls `openssl rand -hex 3` separately and exactly once for each owned file. If any generated value collides, the procedure exits before writing; rerun the whole procedure from the unchanged inputs.
- `id` is opaque and permanent. After first assignment it must never be edited, derived from `slug`, derived from a directory, or reused for another document.
- `id` is the value denoted by `<docId>` in all storage keys, access records, API contracts, realtime channels, and `/d/<id>` permanent links.
- `slug` is required and must be one lowercase kebab-case URL path segment matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. It contains no slash, leading/trailing hyphen, whitespace, query, or fragment.
- Each current `slug` must be unique across every tracked `*/doc.json`, including the excluded skeleton template.
- `slug` is mutable URL identity, not storage identity. Changing a slug must not change the document ID.
- `aliases` is required and is always a JSON array of prior slug strings, never a scalar or `null`. Each item follows the slug format, items are unique, and the current slug is not repeated in its own aliases.
- An alias belongs to only one document and must not collide with another document's current slug or alias. On a future rename, append the old slug and retain all earlier aliases; never use aliases as storage keys.
- The instance directory is a source/build path only. It is not the document ID. Server functions must not accept an instance name or filesystem path from a client as document identity.
- P1-A changes data only. The current builder may continue ignoring these fields until P1-B and P1-E consume them. Those tickets have disjoint file surfaces and may be developed in parallel with P1-A; their consuming behavior may rely on this contract once the changes are integrated together.

Downstream tickets may consume this exact contract without taking ownership of the three `doc.json` files:

- P1-B may read required `id` as the `{{DOC_ID}}` value. It must not derive or generate an ID, and it does not own `slug` or `aliases` behavior.
- P1-E may read required `id` for `/d/<id>` redirects, required `slug` for the current site path, and `aliases` as the complete set of retired site paths. It must not rewrite these source values.
- Later state, access, and realtime tickets may treat `id` as `<docId>`. They must not use `slug`, an alias, a directory name, or a client-supplied path as the storage identity.

## Files owned

- `example/doc.json` — **amended**; pre-existing repository file, so no Build Order ticket created it.
- `templates/components/doc.json` — **amended**; pre-existing repository file, so no Build Order ticket created it.
- `templates/skeleton/doc.json` — **amended**; pre-existing repository file, so no Build Order ticket created it.

No other implementation file is owned by P1-A. `docs/tickets/P1-A.md` is the ticket specification, not part of the implementation file surface.

## Dependencies

None. P1-A is a Phase 1 root, consumes no file or interface from another ticket, and can start from the current repository state. P1-B and P1-E are downstream consumers of the resulting data contract, not prerequisites; their disjoint implementation work does not need to wait for P1-A.

## Acceptance criteria

- [ ] Each owned file contains required top-level `id`, `slug`, and `aliases` fields and remains valid JSON.
- [ ] The implementer ran the exact mutating generation procedure below; inspection of that command shows one `openssl rand -hex 3` process per owned file on a successful run. The resulting IDs match `^[0-9a-f]{6}$` and differ from every other document ID.
- [ ] The three slugs are exactly `example`, `components`, and `short-specific-name` at their paths specified above, and no slug repeats.
- [ ] Every `aliases` value is exactly `[]` for this initial assignment.
- [ ] All pre-existing metadata values in the three files are byte-for-byte unchanged apart from indentation/comma changes required to insert the new keys.
- [ ] No file outside the owned implementation surface changes.
- [ ] Rebuilding every real document leaves committed `dist/` HTML byte-identical, proving the current artifact build still works and these data-only fields do not alter output early.
- [ ] The TypeScript builder still passes strict typechecking with zero runtime dependencies added.
- [ ] The repository scrub gate passes for the new ticket text and the implementation changes.

## Test plan

### Implementation procedure (mutating; run once)

Run this command once from the repository root while all three owned files still lack `id`, `slug`, and `aliases`. This is the reviewable generation procedure, not an acceptance validator. It invokes `openssl rand -hex 3` exactly once for each owned file during a successful attempt, checks all three outputs before writing anything, and then inserts the identity fields while preserving the existing metadata.

```bash
node --input-type=module <<'NODE'
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const targets = [
  ["example/doc.json", "example"],
  ["templates/components/doc.json", "components"],
  ["templates/skeleton/doc.json", "short-specific-name"],
];
const targetPaths = new Set(targets.map(([file]) => file));
const tracked = execFileSync("git", ["ls-files", "*/doc.json"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const documents = new Map();
const usedIds = new Map();
const idPattern = /^[0-9a-f]{6}$/;

for (const file of tracked) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  documents.set(file, doc);
  if (targetPaths.has(file)) {
    if ("id" in doc || "slug" in doc || "aliases" in doc) {
      throw new Error(`${file}: identity fields already exist; do not rotate a permanent ID`);
    }
  } else if (typeof doc.id === "string") {
    if (!idPattern.test(doc.id)) throw new Error(`${file}: existing id is invalid`);
    if (usedIds.has(doc.id)) throw new Error(`${file}: existing id duplicates ${usedIds.get(doc.id)}`);
    usedIds.set(doc.id, file);
  }
}

const assignments = [];
for (const [file, slug] of targets) {
  if (!documents.has(file)) throw new Error(`${file}: tracked input is missing`);
  const id = execFileSync("openssl", ["rand", "-hex", "3"], { encoding: "utf8" }).trim();
  if (!idPattern.test(id)) throw new Error(`${file}: openssl returned an invalid id`);
  if (usedIds.has(id)) throw new Error(`${file}: generated id collides with ${usedIds.get(id)}; no files written`);
  usedIds.set(id, file);
  assignments.push({ file, slug, id });
}

for (const { file, slug, id } of assignments) {
  const { id: oldId, slug: oldSlug, aliases: oldAliases, ...metadata } = documents.get(file);
  void oldId;
  void oldSlug;
  void oldAliases;
  writeFileSync(file, `${JSON.stringify({ id, slug, aliases: [], ...metadata }, null, 2)}\n`);
  console.log(`SET   ${file}  id=${id}`);
}
NODE
```

Expected: exit `0` and exactly three `SET` lines, one for each owned path, with a different six-character lowercase hexadecimal ID on each line. The command exits nonzero before any write if an identity field already exists, an input is missing, OpenSSL returns an invalid value, or an ID collides. If it reports a collision, verify the three inputs are still unchanged and rerun the entire command. Never rerun it after a successful write, because that would rotate permanent IDs.

The command and its implementation transcript are the only review-time evidence that OpenSSL performed generation. Persisted JSON cannot prove how a syntactically valid value was produced, so the acceptance checks below deliberately make no after-the-fact provenance claim.

### Acceptance validation (read-only except for documented rebuild output)

1. Validate every tracked `doc.json`, the exact initial slugs, empty initial alias lists, and global identity uniqueness from the repository root:

   ```bash
   node --input-type=module <<'NODE'
   import { execFileSync } from "node:child_process";
   import { readFileSync } from "node:fs";

   const files = execFileSync("git", ["ls-files", "*/doc.json"], { encoding: "utf8" })
     .trim()
     .split("\n")
     .filter(Boolean);
   const expectedSlugs = new Map([
     ["example/doc.json", "example"],
     ["templates/components/doc.json", "components"],
     ["templates/skeleton/doc.json", "short-specific-name"],
   ]);
   const ids = new Map();
   const routeNames = new Map();
   const idPattern = /^[0-9a-f]{6}$/;
   const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

   if (files.length !== expectedSlugs.size) {
     throw new Error(`expected ${expectedSlugs.size} tracked doc.json files, found ${files.length}`);
   }

   for (const file of files) {
     if (!expectedSlugs.has(file)) throw new Error(`unexpected doc.json: ${file}`);
     const doc = JSON.parse(readFileSync(file, "utf8"));
     if (!idPattern.test(doc.id)) throw new Error(`${file}: invalid id ${JSON.stringify(doc.id)}`);
     if (ids.has(doc.id)) throw new Error(`${file}: duplicate id also used by ${ids.get(doc.id)}`);
     ids.set(doc.id, file);

     if (doc.slug !== expectedSlugs.get(file) || !slugPattern.test(doc.slug)) {
       throw new Error(`${file}: invalid or unexpected slug ${JSON.stringify(doc.slug)}`);
     }
     if (!Array.isArray(doc.aliases)) throw new Error(`${file}: aliases must be an array`);
     if (doc.aliases.length !== 0) throw new Error(`${file}: aliases must be empty on initial assignment`);

     for (const routeName of [doc.slug, ...doc.aliases]) {
       if (!slugPattern.test(routeName)) throw new Error(`${file}: invalid route name ${JSON.stringify(routeName)}`);
       if (routeNames.has(routeName)) {
         throw new Error(`${file}: route name ${routeName} also used by ${routeNames.get(routeName)}`);
       }
       routeNames.set(routeName, file);
     }
   }

   console.log(`PASS  ${files.length} doc.json files have valid, unique identities`);
   NODE
   ```

   Expected: exit `0` and exactly `PASS  3 doc.json files have valid, unique identities`. Invalid JSON, an unexpected/missing file, a format violation, a wrong slug, a nonempty initial alias list, or any collision exits nonzero with an identifying error.

2. Rebuild all non-skeleton documents and compare committed output:

   ```bash
   templates/check-dist
   ```

   Expected: exit `0`; stdout ends with `PASS  every committed document is byte-identical after a rebuild`. Any changed generated HTML exits `1` and names the changed output.

3. Typecheck the unchanged builder contract:

   ```bash
   npm --prefix templates/docbuild run check
   ```

   Expected: exit `0` with no TypeScript diagnostics. Any type error exits nonzero.

4. Check public-repository hygiene, including this new untracked ticket file before it is committed:

   ```bash
   scripts/scrub-check.sh docs/tickets/P1-A.md example/doc.json templates/components/doc.json templates/skeleton/doc.json
   ```

   Expected: exit `0` and `PASS  no denied term and no warning.` Any denied term exits `1`; a warning requires replacing or confirming the generic text before review.

5. Confirm the implementation diff is limited to the owned files:

   ```bash
   git diff --name-only -- example/doc.json templates/components/doc.json templates/skeleton/doc.json
   git status --short
   ```

   Expected: the first command prints exactly the three owned paths after all three are amended. In the second command, P1-A contributes only those three implementation paths; the coordination branch may also contain `docs/tickets/P1-A.md` and other agents' separately owned ticket documents.

## Failure modes

### Handled

- `openssl` produces a value that collides with another document ID: the mutating procedure exits before writing any file. Confirm the inputs remain unchanged, then rerun the whole procedure; a successful attempt still makes one OpenSSL invocation per owned file.
- An ID contains uppercase characters, a prefix, whitespace, too few/many characters, or non-hexadecimal characters: the identity validation exits nonzero.
- A slug is missing, duplicated, malformed, or assigned to the wrong current file: the identity validation exits nonzero.
- `aliases` is missing, `null`, a scalar, malformed, nonempty during this initial assignment, or creates a duplicate route name: the identity validation exits nonzero.
- Adding fields accidentally changes built artifact bytes: `templates/check-dist` fails and the data change must be corrected; do not bless generated output drift in P1-A.
- The plan's sample value `k7m2q4` conflicts with its own normative lowercase-hex rule. The prose rule and `openssl rand -hex 3` command govern, so no owned file may use that non-hex sample.

### Deliberately not handled

- Runtime/build-time enforcement of the schema. P1-A supplies conforming source data and an acceptance command; P1-B and P1-E own the consuming builder surfaces.
- Redirect behavior for current or historical slugs, including `/d/<id>`. P1-E owns site output and redirect generation.
- Automatic protection against changing an ID after its first assignment. Code review and the permanent-ID contract prevent that; adding a registry or migration system is outside this ticket.
- After-the-fact proof that OpenSSL generated a committed ID. The repository can prove format and uniqueness only; generation provenance comes from running and reviewing the specified mutating command.
- Copies made from `templates/skeleton/doc.json` after P1-A lands. A writer must replace the copied template ID with a fresh `openssl rand -hex 3` value and set the new document slug before publication; P4-G owns user-facing instructions.
- Recovery from a previously published slug collision or a previously changed ID. No such history exists for the three initial records, and migration tooling is outside scope.

## Settled decisions

- The permanent six-character lowercase hexadecimal `id` is the only document storage identity. It is generated once, meaningless, and never changed.
- The `slug` is the mutable human-readable URL. `aliases` retains every retired slug. Neither is a storage key.
- The directory name is an instance/build path only. It must not become an API identity or be accepted from a client as a path.
- Both standalone artifacts and hosted site copies use the same document identity. P1-B places the document ID in `layout.html` so both outputs carry it; P1-A does not move that work into `doc.json` rendering.
- Authority does not live in `doc.json`. Do not add `owner` or `editors`; document grants live under `access/<docId>/...` in the state store.
- Stateful records use one blob per record and key by permanent document ID. Realtime uses one hosted broker when enabled and also keys channels by document ID; neither decision changes this ticket's data shape.
- The builder remains TypeScript with zero runtime dependencies. P1-A adds no package and no builder branch.
- `norm()` and the block scanner remain one shared builder/browser implementation. Document identity must not introduce a second anchoring identity or alter that boundary.

## Assumptions and open questions

- **Assumption (non-blocking):** URL names use lowercase kebab-case route segments. The ruling plan requires unique slugs but does not spell out a regex; `^[a-z0-9]+(?:-[a-z0-9]+)*$` matches every current and planned example while excluding values that cannot be one unambiguous path segment.
- **Assumption (non-blocking):** `templates/skeleton/doc.json` uses the explicit placeholder slug `short-specific-name`, aligned with its existing placeholder title. The skeleton is excluded from hosted discovery, and P4-G will require a copied document to choose its real slug and generate a fresh ID.
- **Assumption (non-blocking):** Alias names are globally exclusive across current slugs and aliases. This avoids ambiguous generated redirect ownership; all initial alias arrays are empty, so the rule does not alter this ticket's data edits.
- **Open questions:** None block implementation. Any desire to change the slug grammar, skeleton placeholder, or alias collision policy should be handled by a follow-up ruling rather than silently changing P1-A's exact values.

## References

- `docs/research/00-integration-plan.md` §1.1, **The state store** — `<docId>` is the permanent `doc.json` ID and never the directory name or slug.
- `docs/research/00-integration-plan.md` §1.3, **The document key** — permanent ID, mutable slug, alias history, instance-path boundary, and `/d/<id>`.
- `docs/research/00-integration-plan.md` §1.4–§1.6, **Deployment, authority, realtime** — two output modes share identity; authority stays out of `doc.json`; realtime state also keys by document ID.
- `docs/research/00-integration-plan.md` §4.1, **The move that makes the front wide** — P1-B consumes `{{DOC_ID}}`; JSON arrays already work through `JSON.parse`.
- `docs/research/00-integration-plan.md` §4.2, **The build contract** — artifact and site outputs remain parallel and deterministic.
- `docs/research/00-integration-plan.md` §4.3, **Phase 1** — P1-A ownership, generation command, and uniqueness acceptance rule.
- `docs/research/00-integration-plan.md` §6 rulings 2, 3, 12, 27, 39, and 40 — clean URLs, permanent storage key, HTML meta location, and the final TypeScript/no-toolchain decisions.
- `docs/research/01-hosting-and-build.md` §1, **Summary of the recommendation** — permanent IDs, clean slug URLs, and writer-command continuity.
- `docs/research/01-hosting-and-build.md` §3, **Directory layout** — a directory containing `doc.json` is a document; the skeleton is excluded from publication.
- `docs/research/01-hosting-and-build.md` §9, **Clean URLs, and a URL that survives a rename** — generation command, identity/slug distinction, alias retention, and rename behavior. Where its older Rust snippets or sample IDs disagree with the integration plan, the integration plan rules.
- `docs/research/01-hosting-and-build.md` §12–§13, **Order of work and dependencies** — P1-A lands first and downstream stateful areas consume permanent document IDs.
