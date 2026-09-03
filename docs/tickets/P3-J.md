# P3-J — The gate learns the grant store

## Outcome

Every authenticated document response is authorized from its permanent baked document ID and the current strongly read access state, so owners, explicitly granted readers, live invitees, and organization defaults work immediately while revocation denies the next request without waiting for logout or token refresh.

## Context

P2-A creates the only Edge Function in front of the site's self-contained HTML, but its intentionally temporary rule admits only an organization identity and still contains a P1-C `roles` compatibility branch. P2-H now makes identity exactly `{ sub, email, name, isOrg }`, P2-G makes `resolveRole()` the sole document-role authority, and P3-H makes the browser session document-aware. P3-J is the one ticket that joins those final contracts at the HTML read wall.

The ruling plan overrides older research where they conflict. In particular, `docs/research/09-sharing-and-roles.md` §5.4's zero-store organization bypass is superseded: P2-G allows a document owner to set `orgDefault: "none"`, and P2-H says `isOrg` is not document authority. Therefore every authenticated identity, including an organization identity, is resolved for the document and `canRead` is the only successful-HTML authorization decision.

Netlify documents that `context.next()` returns the downstream `Response`, that its body may be read and replaced, and that the default call suppresses conditional origin responses so middleware receives a full response. P1-B makes the exact doc-id meta element the first artifact line. This ticket uses those two settled seams: it buffers only that bounded first line, resolves access before releasing any buffered byte, and then replays the unchanged response stream. It never forwards a downstream 304 because doing so would authorize reuse of a representation without extracting its document ID or rechecking current access.

## Scope

### In scope

- Amend P2-A's existing `netlify/edge-functions/gate.ts`; do not create a second gate or declaration.
- Preserve the exact case-sensitive public `/invite/` pathname-family bypass before identity and downstream response work.
- Preserve P2-A's anonymous login redirect, query-preserving safe `next`, thrown-identity 503, generic 403, and no-store behavior.
- Accept only P2-H's final four-field non-null identity shape; reject legacy, partial, mixed, accessor-backed, or wrong-typed identities before downstream work.
- For every authenticated identity, call `context.next()` response-first, extract the exact P1-B first-line permanent ID from a bounded stream prefix, and call P2-G `resolveRole(docId, user, { consumeInvitation: false })` exactly once.
- Validate the complete P2-G result against `capabilitiesFor(role)` and use only exact boolean `canRead` to permit a successful HTML response.
- Preserve safe downstream redirects and error statuses other than unverifiable 304 without following them or replacing their status, headers, or body.
- Reconstruct an authorized GET/body response without changing application bytes and define exact header, HEAD, range, body, cancellation, and stream-error behavior.
- Map provider unavailability and every malformed dependency boundary to quiet, non-cacheable, fail-closed responses without logging identifiers or state.
- Prove owner, organization-default, external grant, live invitation, unknown document, malformed response, revocation, latency, and provider-failure cases with source-bound and hosted gates.

### Out of scope

- Changing P2-H identity classification or accepting P1-C `roles`, `docs`, `appMetadata.docs`, provider metadata, token claims, a cookie-carried role, or an email suffix inside the gate.
- Changing P2-G role precedence, capabilities, validation, strong-read behavior, owner binding, key construction, errors, or invitation conversion.
- Consuming an invitation, creating/updating/deleting a grant or invitation, changing `orgDefault`, or directly calling a Blobs write API. P3-H owns invitation conversion; P4-J owns access mutations. P2-G's already-owned one-time `DOC_OWNERS` owner capture remains an internal resolver behavior and is not duplicated here.
- Using P3-H `/api/session` or `/api/access`, client `data-session`, a query parameter, URL slug, alias, path segment, or response header as HTML authorization.
- Adding a role/result cache, signed authorization cookie, Cache API entry, in-memory permission memo, or stale-while-revalidate path. Immediate next-request revocation is mandatory.
- Editing `netlify.toml`, its `/*` route, its exclusions, P1-B's layout/meta output, any identity/access/session module, a package file, a template, generated HTML, or another ticket.
- Adding API mutation enforcement. P4-M later amends the write handlers and must resolve its own access independently; passing this gate never authorizes an excluded `/api/*` request.
- Following redirects, translating a downstream 404 to an access decision, range delivery for authenticated readers, document-body transformation, HTML sanitization, or whole-body buffering.

## Interface contract

### Module surface and imports

Retain one default Edge handler and no inline route configuration. The amended TypeScript surface is exact:

```ts
type GateContext = {
  next(request?: Request): Promise<Response>;
};

export default async function gate(
  req: Request,
  context: GateContext,
): Promise<Response | undefined>
```

The only imports are static named imports from the two settled server siblings:

```ts
import { identify } from "../lib/identity.mjs";
import { capabilitiesFor, resolveRole } from "../lib/access.mjs";
```

Do not import `@netlify/identity`, `@netlify/blobs`, `store.mjs`, a Function handler, or an HTML parser package. Do not export `GateContext`, constants, validators, response helpers, or a `config` object. P1-E's existing `netlify.toml` declaration remains the sole route declaration.

### Exact processing order

The observable order is exact for every matched request:

1. Construct `new URL(req.url)` once.
2. If `url.pathname === "/invite/" || url.pathname.startsWith("/invite/")`, return `undefined` immediately. Do not call identity, `context.next()`, or access. Query strings and methods do not change this exact public family. Bare `/invite`, case/percent variants, and near-prefixes remain gated.
3. Call `await identify(req)` exactly once inside a catch that covers only that await. A rejection returns the exact P2-A authentication-unavailable 503. It is not anonymous and never reaches the downstream response.
4. If identity is `null`, return P2-A's exact 302: `Location: /login/?next=${encodeURIComponent(url.pathname + url.search)}`, `Cache-Control: private, no-store`, and a zero-byte body. Do not call `context.next()` or access.
5. Validate the non-null identity before reading `isOrg` or calling downstream. It must be a fresh mutable plain object with prototype exactly `Object.prototype`, no symbol keys, and exactly four own enumerable, writable, configurable data properties in the order `sub`, `email`, `name`, and `isOrg`; the first three values are strings and `isOrg` is boolean. Getters, setters, reordered/inherited/missing/extra/non-enumerable/non-writable/non-configurable fields, a frozen/sealed/null/custom-prototype object, an array, or a wrong type returns the internal 500. Do not repeat P2-H/P2-G's subject, email, or name grammar in this file.
6. Call `await context.next()` exactly once for an authenticated non-HEAD request, using the default call even when the client supplied `If-None-Match`, `If-Modified-Since`, or another conditional header. For `HEAD`, call it exactly once with `new Request(req, { method: "GET", body: null })` so the gate can inspect the same full representation that HEAD describes. Do not pass `sendConditionalRequest: true`, call same-site `fetch()`, retry, strip/reinterpret validators, or follow a returned redirect. The default Edge behavior must produce the complete downstream representation needed for the doc-ID/access check. A rejection, non-`Response` value, opaque/status-0 response, or inaccessible response boundary returns the downstream-unavailable 503.
7. Return an authenticated downstream response object unchanged, with no access call or body read, when its status is `204`, `205`, `300`–`303`, `305`–`399`, or `400`–`599`. This preserves canonical/alias redirects, `Location`, login redirects produced elsewhere, 404/405 behavior, `Allow`, and downstream failure semantics. These status classes cannot instruct reuse of a protected representation. For a synthetic HEAD probe, return a new zero-body response with the exact status, status text, and headers instead of returning its GET body.
8. Treat exact `304`, `206`, and every other non-`200` success status as an unverifiable representation and return the internal 500 without reading or forwarding its body or calling access. A 304 is never passed through, synthesized, or treated as proof of permission: it contains no first-line document ID, and forwarding it could reuse bytes authorized before a revocation. P3-J does not implement byte-range authorization; a Range request can never bypass the meta check by receiving a fragment that omits the first line.
9. For exact `200`, require a body and a `Content-Type` whose parsed, ASCII-case-insensitive media type is exactly `text/html`; optional parameters are allowed. A missing/malformed type, non-HTML 200, locked/disturbed body, or wrong stream chunk type returns the internal 500. Do not sniff content.
10. Read only enough stream chunks to locate the first LF, never inspecting more than `MAX_META_LINE_BYTES = 96` bytes before it. The decoded first line must be byte-for-byte ASCII `<meta name="doc-id" content="<docId>">\n`, where `<docId>` matches `^[0-9a-f]{6}$`. A BOM, CRLF, whitespace, attribute reorder, alternate quotes/case, missing LF, overlong line, malformed UTF-8, or invalid ID returns the internal 500 before access. P1-B owns the stronger build assertion that this is the artifact's only doc-id meta element.
11. Retain every complete chunk already taken from the reader, including bytes after the first LF in the final chunk, but do not enqueue or expose any of it yet. The gate retains at most the upstream chunks needed for the 96-byte line; it never calls `text()`, `arrayBuffer()`, `clone()`, or buffers the remaining document.
12. Call exactly `await resolveRole(docId, user, { consumeInvitation: false })`. Do not omit the explicit false, pass a store/clock/config override, or call it a second time. P2-G performs strong operation-level reads. This mode may recognize a live invitation but performs no grant/invitation write or delete; P3-H alone converts it. P2-G may still perform its separately specified one-time configured-owner binding for an unbound document.
13. Validate the result before reading `canRead`. It must be a fresh-style plain object with exactly the ten P2-G keys `role`, `shared`, `canRead`, `canComment`, `threadControl`, `canSuggest`, `canEdit`, `canAccept`, `canShare`, and `canSeeMembers`; no symbols/accessors/extras; `role` is one of `owner|editor|commenter|viewer|none`; `shared` and every `can*` field are booleans; `threadControl` is `any|own|none`; and every capability equals the row returned by `capabilitiesFor(role)`. A thrown validator or mismatch is an internal 500.
14. If and only if the validated `canRead` is `true`, return the authorized downstream representation. If it is `false`, cancel the held reader best-effort and return P2-A's exact generic 403. Never distinguish unshared, revoked, expired, wrong-address, unknown-ID, or `orgDefault: "none"` denial.

No step logs. No catch passes through the document. Identity presence, `isOrg`, a non-`none` role string by itself, `shared`, URL shape, or client state is never sufficient.

### Response and stream reconstruction

For an authorized non-HEAD 200 response, return a new `ReadableStream<Uint8Array>` that first enqueues the retained chunks in their original order and then pulls one chunk at a time from the same original reader. The stream must implement all three paths:

- `pull`: forward the next byte chunk unchanged; close on `done`; propagate an upstream read rejection with `controller.error(error)` without substituting a successful page.
- `cancel(reason)`: forward cancellation once to the held reader. Await and suppress a cancellation-promise rejection so consumer cancellation still settles without substituting another response; never log `reason` or the error.
- completion: release the reader lock exactly once after normal upstream `done`, upstream read rejection, or consumer cancel, guarded by one shared terminal flag so concurrent terminal paths cannot double-release. On normal completion close the downstream controller and release; on read rejection error the downstream controller and release in the same terminal path; on cancel attempt upstream cancellation and release in `finally`, including when cancellation rejects.

Construct the response with the exact downstream `status` and `statusText`. Copy all downstream headers, then delete `Content-Length`, `Content-Encoding`, and `Transfer-Encoding` because the Edge response is newly framed from the decoded web stream. Preserve every other header and value, including cache/security validators, CSP, `Vary`, `Set-Cookie`, `Location` if present unexpectedly, and application headers; do not add CORS, authorization, identity, document, role, timing, or diagnostic headers. A later conditional request still traverses this gate and receives a fully authorized 200/body or a current denial; this gate never turns a validator into 304. The replayed application bytes are identical even though transport framing may differ.

For an authorized HEAD, drain no representation bytes beyond the meta prefix, cancel the GET-probe reader exactly once, suppress a cancellation rejection, release that reader exactly once in `finally`, and return a zero-body response with the original GET status/status text/headers, including representation `Content-Length` and `Content-Encoding`. For every denial or gate-generated failure after acquiring a reader, request cancellation before returning and release exactly once, but do not let a rejected cancellation turn denial into allow. Cancellation is cleanup, not authority; the platform's 40-second response-header limit remains the outer request bound.

The 96-byte constant is an inspection/buffering limit, not a document-size cap. The rest of an authorized artifact remains streamed. One arbitrarily large upstream chunk is not copied merely to split it: retain and replay that chunk once, while inspecting only its prefix through the first LF. A post-authorization stream failure is an ordinary failed transfer and must not trigger a second response, retry, or partial fallback page.

### Exact response and access matrix

| Caller/downstream condition | Result | Identity / next / resolver calls |
|---|---|---|
| Exact `/invite/` or descendant, any method | `undefined` | `0 / 0 / 0` |
| Anonymous protected path | exact P2-A 302 login redirect | `1 / 0 / 0` |
| Identity rejection | exact P2-A 503 | `1 / 0 / 0` |
| Malformed legacy/mixed/final identity | internal 500 | `1 / 0 / 0` |
| Authenticated non-HEAD downstream 3xx other than 304, or 4xx/5xx | same response object, status/body/headers; redirects are not followed | `1 / 1 / 0` |
| Authenticated non-HEAD downstream 204/205 | same bodyless response object | `1 / 1 / 0` |
| Downstream 304, including for a conditional request | internal 500; never authorize cached representation reuse | `1 / 1 / 0` |
| 206, other body-bearing 2xx, non-HTML 200, bad stream, or malformed first line | internal 500, no downstream bytes | `1 / 1 / 0` |
| Valid HTML; resolved owner/editor/commenter/viewer | streamed 200 | `1 / 1 / 1` |
| Valid HTML; organization caller with explicit grant | that grant's `canRead` result | `1 / 1 / 1` |
| Valid HTML; organization caller with no grant and `orgDefault: commenter|viewer` | streamed 200 | `1 / 1 / 1` |
| Valid HTML; organization caller with no grant and `orgDefault: none` | generic 403 | `1 / 1 / 1` |
| Valid HTML; external caller with explicit grant or live invitation | streamed 200; invitation remains unconsumed | `1 / 1 / 1` |
| Valid HTML; external caller with no live authority, expired invitation, wrong invited address, revoked grant, or unknown valid doc ID | generic 403 | `1 / 1 / 1` |
| P2-B unavailable error with safe exact classification | access-unavailable 503 | `1 / 1 / 1` |
| Other access rejection or malformed result | internal 500 | `1 / 1 / 1` |

The gate-generated responses are exact:

| Status | Body | Headers |
|---:|---|---|
| `302` | zero bytes | `Location` as above; `Cache-Control: private, no-store` |
| `403` | `You do not have access to this document.` with no LF | `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` |
| identity `503` | `Authentication is temporarily unavailable.` with no LF | same two headers |
| downstream/access `503` | `Document access is temporarily unavailable.` with no LF | same two headers |
| internal `500` | `Document access could not be verified.` with no LF | same two headers |

Recognize a provider-unavailable 503 only when the rejection is a non-null non-array object with own data properties whose values are exactly `name === "StoreError"`, `code === "unavailable"`, and `status === 503`. An inherited field, accessor, wrong value/type, ordinary `AccessError`, arbitrary `Response`, or any other rejection maps to 500. Never serialize/log the error, cause, stack, key, record, ETag, email, `sub`, doc ID, invitation state, response prefix, URL, request, or provider result.

### Revocation and latency

Each authenticated 200 HTML request performs a new response extraction and a new P2-G strong read. The gate stores no decision between requests. Conditional request headers do not bypass that sequence: default `context.next()` supplies the full representation, and an unexpected downstream 304 fails 500 rather than directing the client to reuse previously authorized bytes. A deleted grant, canceled/expired invitation, changed role, ownership transfer, or changed `orgDefault` therefore affects the next request while the Identity session itself remains valid.

Latency is measured outside the response contract, not exposed in a response header or application log. The hosted gate records 20 sequential no-body timings for the same warm artifact as an owner, organization-default reader, external viewer, and external denial, plus immediate post-delete denial. It reports only per-class median and p95 milliseconds plus one external-minus-owner median and the deterministic action `none|open-separate-architecture-decision`; it never prints the origin, path, document ID, account, cookie, token, or individual request record. For 20 sorted samples, median means the arithmetic mean of elements 10 and 11 and p95 means element 19 (one-based). There is no pass/fail SLA in P3-J because provider/region/network latency is environmental. If the external-reader median incremental cost over the owner sample exceeds 100 ms, the action is exactly `open-separate-architecture-decision`; do not add a permission cache here because that would violate next-request revocation.

## Files owned

- `netlify/edge-functions/gate.ts` — **amended**, created by P2-A; P3-J is the sole owner of this revision.
- `docs/tickets/P3-J.md` — **new canonical specification**; not an implementation path.

No other implementation path is owned. Do not edit P2-A's ticket or its login/logout/page files, P2-G's access library, P2-H's identity library, P3-H's Functions, P1-E's configuration, P1-B's builder/layout, a package file, generated output, research, or another ticket. Stop and report a predecessor mismatch rather than widening this surface.

## Dependencies

- **P1-B (transitive built-response seam):** every integrated document artifact begins with exactly one `<meta name="doc-id" content="[0-9a-f]{6}">\n`. P3-J consumes that output but does not edit its builder, layout, or generated files.
- **P1-E (transitive declaration seam):** `netlify.toml` maps `/*` to `gate` and excludes exactly `/login/*`, `/api/*`, and `/_assets/*`. P3-J does not add inline config or exclusions.
- **P2-A:** creates `gate.ts`, the public invite bypass, login redirect, exact response text, and identity-error behavior. Its temporary legacy/final organization predicate is replaced, not retained beside the new rule.
- **P2-B (through P2-G):** supplies the site-wide `doc-state` store and strong store- and operation-level reads. P3-J does not open the store directly.
- **P2-G:** supplies `resolveRole()`, `capabilitiesFor()`, the complete result/error boundary, owner binding, strong access reads, and default non-consuming invitation semantics. P3-J starts only from its complete accepted implementation.
- **P2-H:** supplies the exact four-field identity. The P2-H-only intermediate identity shape must already be integrated; legacy P1-C identity is no longer accepted.
- **P3-H (release compatibility, not source ownership):** supplies the final document-aware session that consumes a live invitation after the HTML loads. P3-J neither calls nor edits it. Ship P3-J only with the final P3-H session contract present so an admitted invitee can complete conversion.

P4-J later mutates access state and must preserve the read contract; P4-M later adds independent `resolveRole()` checks to API write paths. Neither may amend this gate. P4-K consumes P2-A's already-public invite seam without changing P3-J.

### Maximum safe implementation waves

1. **Predecessor integration wave:** serialize P1-B/P1-E/P2-A, then P2-B/P2-G, P2-H, and P3-H according to their own gates. P3-J must not implement against ticket prose or a partial access module.
2. **Single-file source wave:** one agent amends only `gate.ts`. In parallel, agents may work only on tickets whose implementation files are disjoint; nobody else edits `gate.ts`, `access.mjs`, `identity.mjs`, `session.mjs`, `netlify.toml`, shared generated HTML, or the root dependency tree in this wave.
3. **Isolated fixture wave:** run the no-file/no-network source-bound VM fixture. It reads the exact production gate and supplies deterministic predecessor modules in memory, so it may run without a Netlify account and without mutating shared state.
4. **Serialized integration wave:** run combined P2-A/P2-G/P2-H/P3-H/P3-J tests, build/check-dist/typecheck/scrub, and manual source review. Shared dependency installation, `_site`, `.netlify`, ports, environment, and generated output are serialized.
5. **Hosted release wave:** an authorized project owner supplies one already-deployed disposable invite-only site and three authenticated fixture-session jars as the exact private inputs listed below. This ticket's command alone seeds, exercises, deletes, and strongly verifies absence of its invented access records. Project/account creation and final disposal are operator-owned environment setup outside this source ticket; P3-J neither receives passwords nor silently claims to delete those resources. No other hosted ticket test shares that site or credentials concurrently.

## Acceptance criteria

- [ ] The implementation diff amends only `netlify/edge-functions/gate.ts`; the module has exactly the two allowed predecessor imports, one default export, and no inline config.
- [ ] The exact `/invite/` family bypasses before identity; anonymous requests retain P2-A's exact login redirect; identity rejection retains its exact 503.
- [ ] Legacy/mixed/malformed identity fails closed, and every accepted identity has exactly the P2-H four-field shape. The source-bound runtime varies identity facts independently from resolved roles, while an exact TypeScript-AST walk rejects executable reads of `roles`, `docs`, `appMetadata`, provider/token data, email-suffix logic, global network/cache APIs, or an undeclared import.
- [ ] Every authenticated identity, including owner and organization identities, calls `context.next()` before access and calls `resolveRole(docId, user, { consumeInvitation: false })` once for an eligible HTML response. There is no org fast path.
- [ ] The doc ID comes only from the exact bounded first response line. URL paths, aliases, query values, headers, and client/session data never select access state.
- [ ] The executable status sweep proves every individual `204`, `205`, `300`–`303`, `305`–`399`, and `400`–`599` response is returned by object identity without access; every individual unverifiable `201`–`203`, `206`–`299`, and `304` fails exact 500 without access or reusable bytes. HEAD authorizes the corresponding GET representation, remains bodyless, cancels/releases its probe reader exactly once, and preserves representation `Content-Length` and `Content-Encoding`.
- [ ] The complete resolved-access object matches `capabilitiesFor(role)`, and exact `canRead` is the sole successful-HTML decision. Owner, each grant role, live invitation, both readable org defaults, `orgDefault: none`, no authority, and unknown document all match the matrix.
- [ ] Authorized bytes stream unchanged after authorization; framing headers are removed only as specified; security/cache/application headers and status text survive. Normal upstream close, natural upstream read error, and consumer cancellation each release the held reader lock exactly once; consumer cancellation forwards upstream exactly once and still settles when upstream cancellation rejects. Cancellation and post-authorization stream errors cannot turn into a second or permissive response.
- [ ] The gate passes `consumeInvitation: false`; its exact two-import AST and VM linker expose no write dependency, and the AST rejects static/dynamic undeclared imports plus direct or aliased references to the named network/store/write globals. The hosted invite case independently proves the invitation remains and no subject grant appears after a fetch-only page request.
- [ ] Deleting a grant causes the very next authenticated page request to return generic 403 with the same Identity session even when that request sends the prior representation's validator. No 304, cache bypass, token refresh, logout, or delay is used.
- [ ] Safe exact StoreError unavailability maps to 503; every other thrown/malformed dependency boundary maps to 500; responses and logs expose no state or identifier.
- [ ] Source-bound tests cover ordering, calls, the exhaustive status classes, exact generated-response bytes/header sets, accepted and rejected content types, every named malformed-meta equivalence class, chunk boundaries, identity/result shape matrices, conditional full-response authorization, downstream-304/status-0 denial, HEAD probe cancellation/release with preserved representation framing headers, cleanup attempts and exactly-once release on every enumerated pre-authorization failure plus normal close/natural stream failure/consumer cancel, repeat-request revocation, and the exact executable AST authority/write boundary.
- [ ] Source completion requires the local source-bound and repository gates only. Before production release, the separately authorized hosted command—self-contained below except for its explicitly enumerated private site/session inputs—proves the deployed Edge import, strong immediate revocation, invitation non-consumption, and sanitized owner/org/external/denied latency summaries.
- [ ] The exact 12-H2, Bash-fence, scrub, whitespace, distribution, typecheck, file-ownership, public-safety, and issue #23 pointer-integrity gates pass: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

All fixture identities, domains, document IDs, hashes, timestamps, paths, and records below are invented and safe to publish. Run from the repository root after the complete P2-G/P2-H/P3-H integration.

### 1. Exact source-bound gate, response, and stream matrix

This fixture uses Node's VM linker to evaluate the exact production `gate.ts` after removing only its asserted TypeScript type surface in memory. It creates no file, directory, socket, subprocess, worker, timer, network request, or provider state. `exec` replaces Bash with the one Node process, so HUP/INT/TERM/KILL cannot orphan a child or guarded root and no cleanup evidence is needed.

```bash
set -euo pipefail
exec env NODE_NO_WARNINGS=1 node --experimental-vm-modules --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("./templates/docbuild/node_modules/typescript");

const DOC = "4b7d2a";
const META = `<meta name="doc-id" content="${DOC}">\n`;
const USERS = {
  owner: { sub: "u_fixture_owner_11", email: "owner@example.com", name: "Owner Vale", isOrg: true },
  org: { sub: "u_fixture_org_22", email: "reader@example.com", name: "Org Vale", isOrg: true },
  external: { sub: "u_fixture_external_33", email: "reader@partner.invalid", name: "External Vale", isOrg: false },
};
const rows = Object.freeze({
  owner: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: true, canSeeMembers: true },
  editor: { canRead: true, canComment: true, threadControl: "any", canSuggest: true, canEdit: true, canAccept: true, canShare: false, canSeeMembers: true },
  commenter: { canRead: true, canComment: true, threadControl: "own", canSuggest: true, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  viewer: { canRead: true, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
  none: { canRead: false, canComment: false, threadControl: "none", canSuggest: false, canEdit: false, canAccept: false, canShare: false, canSeeMembers: false },
});
const resolved = (role, shared = role !== "none") => ({ role, shared, ...rows[role] });
const state = { user: USERS.external, identityError: null, result: resolved("viewer"), resolveError: null, capabilitiesError: null, identityCalls: 0, nextCalls: [], resolveCalls: [] };

const identityModule = new vm.SyntheticModule(["identify"], function () {
  this.setExport("identify", async (request) => {
    state.identityCalls += 1;
    assert.ok(request instanceof Request);
    if (state.identityError) throw state.identityError;
    return state.user;
  });
});
const accessModule = new vm.SyntheticModule(["capabilitiesFor", "resolveRole"], function () {
  this.setExport("capabilitiesFor", (role) => {
    if (state.capabilitiesError) throw state.capabilitiesError;
    if (!Object.hasOwn(rows, role)) throw new Error("invalid role");
    return rows[role];
  });
  this.setExport("resolveRole", async (...args) => {
    state.resolveCalls.push(args);
    if (state.resolveError) throw state.resolveError;
    return state.result;
  });
});

const original = readFileSync("netlify/edge-functions/gate.ts", "utf8");
const sourceFile = ts.createSourceFile("gate.ts", original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const imports = [], violations = [];
const propertyName = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;
const visit = (node) => {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    imports.push({
      from: node.moduleSpecifier.text,
      default: clause?.name?.text ?? null,
      namespace: clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : null,
      named: clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements.map((item) => [item.propertyName?.text ?? item.name.text, item.name.text]) : [],
    });
  }
  if (ts.isImportEqualsDeclaration(node) || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) violations.push("dynamic or import-equals dependency");
  if (ts.isIdentifier(node) && ["fetch", "caches", "CacheStorage", "Deno", "Netlify", "globalThis", "self", "window", "navigator", "console", "process", "XMLHttpRequest", "WebSocket", "EventSource", "require", "eval", "Function", "getStore", "setJSON", "mutate", "appendEvent"].includes(node.text)) violations.push(`forbidden executable identifier ${node.text}`);
  if (ts.isPropertyAccessExpression(node) || ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) {
    const name = propertyName(node.name);
    if (["roles", "docs", "appMetadata", "app_metadata", "clientContext", "userMetadata", "nf_jwt", "nf_refresh", "setJSON", "mutate", "appendEvent", "fetch", "caches"].includes(name)) violations.push(`forbidden property ${name}`);
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    if (["roles", "docs", "appMetadata", "app_metadata", "clientContext", "userMetadata", "nf_jwt", "nf_refresh", "setJSON", "mutate", "appendEvent", "fetch", "caches"].includes(node.argumentExpression.text)) violations.push(`forbidden element ${node.argumentExpression.text}`);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee) && ["fetch", "eval", "Function", "getStore", "setJSON", "mutate", "appendEvent"].includes(callee.text)) violations.push(`forbidden call ${callee.text}`);
    if (ts.isPropertyAccessExpression(callee) && ["setJSON", "mutate", "appendEvent", "endsWith"].includes(callee.name.text)) violations.push(`forbidden method ${callee.name.text}`);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ["console", "caches", "process"].includes(callee.expression.text)) violations.push(`forbidden global ${callee.expression.text}`);
  }
  if (ts.isPropertyAssignment(node) && propertyName(node.name) === "consumeInvitation" && node.initializer.kind === ts.SyntaxKind.TrueKeyword) violations.push("consuming invitation");
  if (ts.isPropertyAssignment(node) && propertyName(node.name) === "sendConditionalRequest" && node.initializer.kind === ts.SyntaxKind.TrueKeyword) violations.push("conditional passthrough");
  if (ts.isStringLiteralLike(node) && ["@example.com", "nf_jwt", "nf_refresh", "data-session"].includes(node.text)) violations.push(`forbidden literal ${node.text}`);
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert.deepEqual(sourceFile.parseDiagnostics, []);
assert.deepEqual(imports, [
  { from: "../lib/identity.mjs", default: null, namespace: null, named: [["identify", "identify"]] },
  { from: "../lib/access.mjs", default: null, namespace: null, named: [["capabilitiesFor", "capabilitiesFor"], ["resolveRole", "resolveRole"]] },
]);
assert.deepEqual(violations, []);
assert.equal(sourceFile.statements.filter((node) => node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)).length, 1);
assert.match(original, /resolveRole\(docId, user, \{ consumeInvitation: false \}\)/);
assert.match(original, /MAX_META_LINE_BYTES\s*=\s*96/);

const fixtureTypeScript = original
  .replace(/^import \{ identify \} from "\.\.\/lib\/identity\.mjs";$/m, 'import { identify } from "fixture:identity";')
  .replace(/^import \{ capabilitiesFor, resolveRole \} from "\.\.\/lib\/access\.mjs";$/m, 'import { capabilitiesFor, resolveRole } from "fixture:access";');
assert.notEqual(fixtureTypeScript, original);
const transpiled = ts.transpileModule(fixtureTypeScript, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  fileName: "gate.ts",
  reportDiagnostics: true,
});
assert.deepEqual((transpiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const source = transpiled.outputText;
const gateModule = new vm.SourceTextModule(source, { identifier: "file:///fixture/netlify/edge-functions/gate.ts" });
await gateModule.link((specifier) => {
  if (specifier === "fixture:identity") return identityModule;
  if (specifier === "fixture:access") return accessModule;
  throw new Error(`undeclared import ${specifier}`);
});
await identityModule.evaluate(); await accessModule.evaluate(); await gateModule.evaluate();
assert.deepEqual(Object.keys(gateModule.namespace), ["default"]);
const gate = gateModule.namespace.default;

const byteStream = (parts, { failAt = -1, onCancel = () => {}, onReaderCancel = () => {}, onRelease = () => {} } = {}) => {
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index === failAt) { controller.error(new Error("injected private stream failure")); return; }
      if (index === parts.length) { controller.close(); return; }
      controller.enqueue(typeof parts[index] === "string" ? new TextEncoder().encode(parts[index++]) : parts[index++]);
    },
    cancel(reason) { return onCancel(reason); },
  });
  const getReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, "getReader", { value: (...args) => {
    const reader = getReader(...args);
    const cancel = reader.cancel.bind(reader);
    const releaseLock = reader.releaseLock.bind(reader);
    Object.defineProperty(reader, "cancel", { value: (reason) => { onReaderCancel(reason); return cancel(reason); } });
    Object.defineProperty(reader, "releaseLock", { value: () => { onRelease(); return releaseLock(); } });
    return reader;
  } });
  return stream;
};
const html = (body = "<title>Fixture</title><main>public-safe fixture text</main>", parts = null, streamOptions = {}, headers = {}) =>
  new Response(parts ? byteStream(parts, streamOptions) : META + body, { status: 200, statusText: "Fixture OK", headers: { "Content-Type": "text/html; charset=utf-8", "Content-Length": "999", "Content-Encoding": "gzip", "Transfer-Encoding": "chunked", "Content-Security-Policy": "default-src 'none'", "Vary": "Accept-Encoding", "Set-Cookie": "fixture=kept; Secure; HttpOnly", "X-Fixture": "kept", ...headers } });
const reset = () => { state.user = USERS.external; state.identityError = null; state.result = resolved("viewer"); state.resolveError = null; state.capabilitiesError = null; state.identityCalls = 0; state.nextCalls = []; state.resolveCalls = []; };
const invoke = async ({ path = "/fixture/", method = "GET", downstream = html(), requestHeaders } = {}) => {
  const request = new Request(`https://docs.example.invalid${path}`, { method, headers: requestHeaders });
  const context = { next: async (nextRequest) => { state.nextCalls.push(nextRequest); return downstream; } };
  return gate(request, context);
};
const body = async (response) => response === undefined ? undefined : response.text();
const expectGate = async (response, status, text, headers = {}) => {
  assert.ok(response instanceof Response); assert.equal(response.status, status); assert.equal(await response.text(), text);
  const expected = Object.keys(headers).length ? headers : { "cache-control": "private, no-store", "content-type": "text/plain; charset=utf-8" };
  assert.deepEqual(Object.fromEntries([...response.headers].sort(([a], [b]) => a.localeCompare(b))), Object.fromEntries(Object.entries(expected).map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a.localeCompare(b))));
};
const assertCall = (user = state.user, doc = DOC) => {
  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0][0], doc); assert.equal(state.resolveCalls[0][1], user);
  assert.deepEqual(state.resolveCalls[0][2], { consumeInvitation: false });
};

for (const path of ["/invite/", "/invite/?token=fragment-never-arrives", "/invite/child"]) for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
  reset(); state.user = null; assert.equal(await invoke({ path, method }), undefined); assert.deepEqual([state.identityCalls, state.nextCalls.length, state.resolveCalls.length], [0, 0, 0]);
}
for (const [path, location] of [["/fixture/", "/login/?next=%2Ffixture%2F"], ["/fixture/?view=review&section=one", "/login/?next=%2Ffixture%2F%3Fview%3Dreview%26section%3Done"]]) {
  reset(); state.user = null; await expectGate(await invoke({ path }), 302, "", { location, "cache-control": "private, no-store" }); assert.deepEqual([state.identityCalls, state.nextCalls.length, state.resolveCalls.length], [1, 0, 0]);
}
reset(); state.identityError = new Error("private identity failure"); await expectGate(await invoke(), 503, "Authentication is temporarily unavailable."); assert.deepEqual([state.nextCalls.length, state.resolveCalls.length], [0, 0]);
const identityBad = [];
for (const key of ["sub", "email", "name", "isOrg"]) {
  const missing = { ...USERS.external }; delete missing[key]; identityBad.push(missing);
  const wrong = { ...USERS.external, [key]: key === "isOrg" ? "false" : 7 }; identityBad.push(wrong);
  const hidden = { ...USERS.external }; Object.defineProperty(hidden, key, { value: USERS.external[key], enumerable: false }); identityBad.push(hidden);
  const readOnly = { ...USERS.external }; Object.defineProperty(readOnly, key, { value: USERS.external[key], enumerable: true, writable: false, configurable: true }); identityBad.push(readOnly);
  const fixed = { ...USERS.external }; Object.defineProperty(fixed, key, { value: USERS.external[key], enumerable: true, writable: true, configurable: false }); identityBad.push(fixed);
  const accessor = { ...USERS.external }; Object.defineProperty(accessor, key, { enumerable: true, get() { throw new Error("identity accessor must not run"); }, set() {} }); identityBad.push(accessor);
}
identityBad.push(
  { ...USERS.external, roles: ["guest"] },
  { email: USERS.external.email, sub: USERS.external.sub, name: USERS.external.name, isOrg: USERS.external.isOrg },
  Object.freeze({ ...USERS.external }),
  Object.seal({ ...USERS.external }),
  Object.assign(Object.create(null), USERS.external),
  Object.assign(Object.create({ inherited: true }), USERS.external),
  Object.assign([...Object.values(USERS.external)], USERS.external),
  Object.assign({ ...USERS.external }, { [Symbol("private")]: true }),
);
for (const bad of identityBad) {
  reset(); state.user = bad; await expectGate(await invoke(), 500, "Document access could not be verified."); assert.deepEqual([state.nextCalls.length, state.resolveCalls.length], [0, 0]);
}

const inclusive = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
const passthroughStatuses = [204, 205, 300, 301, 302, 303, ...inclusive(305, 399), ...inclusive(400, 599)];
for (const status of passthroughStatuses) {
  const downstream = new Response(status === 204 || status === 205 ? null : `passthrough-${status}`, { status, statusText: "Fixture Passthrough", headers: { "X-Fixture": String(status) } });
  reset(); const response = await invoke({ downstream }); assert.equal(response, downstream, `status ${status}`); assert.equal(response.statusText, "Fixture Passthrough"); assert.equal(response.headers.get("x-fixture"), String(status)); assert.equal(state.resolveCalls.length, 0);
}
const rejectedSuccessStatuses = [201, 202, 203, ...inclusive(206, 299), 304];
for (const status of rejectedSuccessStatuses) {
  const downstream = new Response(status === 204 || status === 205 || status === 304 ? null : `unverifiable-${status}`, { status, headers: { "X-Fixture": String(status) } });
  reset(); await expectGate(await invoke({ downstream }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0, `status ${status}`);
}
reset(); await expectGate(await invoke({ downstream: new Response(null, { status: 304, headers: { ETag: '"fixture-v1"' } }), requestHeaders: { "If-None-Match": '"fixture-v1"' } }), 500, "Document access could not be verified."); assert.deepEqual([state.identityCalls, state.nextCalls.length, state.resolveCalls.length], [1, 1, 0]);
reset(); await expectGate(await invoke({ downstream: new Response("partial", { status: 206, headers: { "Content-Type": "text/html", "Content-Range": "bytes 10-16/80" } }), requestHeaders: { Range: "bytes=10-16" } }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
reset(); response = await invoke({ downstream: html("<main>parameterized</main>", null, {}, { "Content-Type": "TEXT/HTML; CHARSET=UTF-8; profile=fixture" }) }); assert.equal(await response.text(), META + "<main>parameterized</main>"); assertCall();
for (const downstream of [
  new Response("plain"),
  new Response("plain", { headers: { "Content-Type": "text/plain" } }),
  new Response("plain", { headers: { "Content-Type": "text/htmlish" } }),
  new Response("plain", { headers: { "Content-Type": "text/html; charset" } }),
]) {
  reset(); await expectGate(await invoke({ downstream }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
}
for (const line of [
  "<title>No meta</title>\n", `\ufeff${META}`, META.replace("\n", "\r\n"), ` ${META}`, META.replace('name="doc-id" content=', 'content="4b7d2a" name='),
  META.replaceAll('"', "'"), META.replace("meta", "META"), META.replace("doc-id", "DOC-ID"), META.slice(0, -1),
  `<meta name="doc-id" content="ABCDEF">\n`, `<meta name="doc-id" content="12345">\n`, `<meta name="doc-id" content="1234567">\n`,
  `${"x".repeat(95)}\n`, `${"x".repeat(96)}\n`, `${"x".repeat(97)}\n`,
]) {
  reset(); await expectGate(await invoke({ downstream: new Response(line + "secret", { headers: { "Content-Type": "text/html" } }) }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
}
reset(); await expectGate(await invoke({ downstream: new Response(null, { status: 200, headers: { "Content-Type": "text/html" } }) }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
reset(); await expectGate(await invoke({ downstream: html("", [Uint8Array.of(0xff, 0x0a)]) }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
reset(); await expectGate(await invoke({ downstream: new Response(new ReadableStream({ start(controller) { controller.enqueue("not bytes"); controller.close(); } }), { headers: { "Content-Type": "text/html" } }) }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
const locked = html(); const externalLock = locked.body.getReader(); reset(); await expectGate(await invoke({ downstream: locked }), 500, "Document access could not be verified."); externalLock.releaseLock(); assert.equal(state.resolveCalls.length, 0);
const disturbed = html(); await disturbed.text(); reset(); await expectGate(await invoke({ downstream: disturbed }), 500, "Document access could not be verified."); assert.equal(state.resolveCalls.length, 0);
reset(); await expectGate(await gate(new Request("https://docs.example.invalid/fixture/"), { next: async () => { throw new Error("private origin failure"); } }), 503, "Document access is temporarily unavailable.");
reset(); await expectGate(await gate(new Request("https://docs.example.invalid/fixture/"), { next: async () => null }), 503, "Document access is temporarily unavailable.");
reset(); await expectGate(await gate(new Request("https://docs.example.invalid/fixture/"), { next: async () => Response.error() }), 503, "Document access is temporarily unavailable.");

for (const [name, user, role, allowed] of [
  ["owner", USERS.owner, "owner", true], ["org commenter", USERS.org, "commenter", true], ["org viewer", USERS.org, "viewer", true],
  ["org none", USERS.org, "none", false], ["external editor", USERS.external, "editor", true], ["external commenter", USERS.external, "commenter", true],
  ["external viewer", USERS.external, "viewer", true], ["external none", USERS.external, "none", false],
]) {
  reset(); state.user = user; state.result = resolved(role, name !== "external none"); const downstream = html(); const response = await invoke({ downstream }); assertCall(user);
  if (allowed) { assert.equal(response.status, 200, name); assert.equal(await body(response), META + "<title>Fixture</title><main>public-safe fixture text</main>", name); assert.equal(response.statusText, "Fixture OK"); assert.equal(response.headers.get("x-fixture"), "kept"); assert.equal(response.headers.get("content-security-policy"), "default-src 'none'"); assert.equal(response.headers.get("vary"), "Accept-Encoding"); assert.equal(response.headers.get("set-cookie"), "fixture=kept; Secure; HttpOnly"); assert.equal(response.headers.get("content-length"), null); assert.equal(response.headers.get("content-encoding"), null); assert.equal(response.headers.get("transfer-encoding"), null); }
  else await expectGate(response, 403, "You do not have access to this document.");
}

reset(); let normalReleaseCalls = 0; state.result = resolved("viewer"); const oneByte = [...new TextEncoder().encode(META + "<main>split</main>")].map((byte) => Uint8Array.of(byte)); let response = await invoke({ downstream: html("", oneByte, { onRelease: () => { normalReleaseCalls += 1; } }) }); assert.equal(await response.text(), META + "<main>split</main>"); assert.equal(normalReleaseCalls, 1); assertCall();
reset(); state.result = resolved("viewer"); response = await invoke({ requestHeaders: { "If-None-Match": '"fixture-v1"', "If-Modified-Since": "Wed, 02 Sep 2026 12:00:00 GMT" } }); assert.equal(response.status, 200); assert.equal(await response.text(), META + "<title>Fixture</title><main>public-safe fixture text</main>"); assert.equal(state.nextCalls[0], undefined); assertCall();
reset(); state.result = resolved("none", false); response = await invoke({ downstream: new Response(`<meta name="doc-id" content="ffffff">\n<main>unknown</main>`, { headers: { "Content-Type": "text/html" } }) }); await expectGate(response, 403, "You do not have access to this document."); assertCall(state.user, "ffffff");
reset(); let headCancelCalls = 0, headReleaseCalls = 0; state.result = resolved("viewer"); response = await invoke({ method: "HEAD", downstream: html("", [META, "<main>probe remainder</main>"], { onReaderCancel: () => { headCancelCalls += 1; }, onRelease: () => { headReleaseCalls += 1; } }) }); assert.equal(response.status, 200); assert.equal(await response.text(), ""); assert.equal(response.headers.get("content-length"), "999"); assert.equal(response.headers.get("content-encoding"), "gzip"); assert.equal(response.headers.get("transfer-encoding"), "chunked"); assert.equal(response.headers.get("content-security-policy"), "default-src 'none'"); assert.equal(response.headers.get("vary"), "Accept-Encoding"); assert.equal(response.headers.get("set-cookie"), "fixture=kept; Secure; HttpOnly"); assert.equal(response.headers.get("x-fixture"), "kept"); assert.deepEqual([headCancelCalls, headReleaseCalls], [1, 1]); assert.equal(state.nextCalls.length, 1); assert.ok(state.nextCalls[0] instanceof Request); assert.equal(state.nextCalls[0].method, "GET"); assertCall();
reset(); let cancelCalls = 0, denialReleaseCalls = 0; state.result = resolved("none", true); await expectGate(await invoke({ downstream: html("", [META, "<main>held</main>"], { onReaderCancel: () => { cancelCalls += 1; }, onRelease: () => { denialReleaseCalls += 1; } }) }), 403, "You do not have access to this document."); assert.deepEqual([cancelCalls, denialReleaseCalls], [1, 1]);
reset(); let consumerCancelCalls = 0, consumerReleaseCalls = 0; state.result = resolved("viewer");
response = await invoke({ downstream: html("", [META, "<main>delivered</main>", "<footer>not delivered</footer>"], { onCancel: () => { consumerCancelCalls += 1; return Promise.reject(new Error("injected private cancellation rejection")); }, onRelease: () => { consumerReleaseCalls += 1; } }) }); assertCall();
const consumer = response.body.getReader(); const delivered = await consumer.read(); assert.equal(new TextDecoder().decode(delivered.value), META); assert.equal(delivered.done, false);
await consumer.cancel("fixture consumer stopped"); await consumer.cancel("fixture consumer repeated cancellation");
assert.equal(consumerCancelCalls, 1); assert.equal(consumerReleaseCalls, 1);

const cleanupFailure = async ({ parts = [META, "<main>held</main>"], configure = () => {}, method = "GET", cancelRejects = false }) => {
  reset(); configure(); let attempts = 0, releases = 0;
  const downstream = html("", parts, { onReaderCancel: () => { attempts += 1; }, onCancel: () => cancelRejects ? Promise.reject(new Error("injected private cleanup rejection")) : undefined, onRelease: () => { releases += 1; } });
  const result = await invoke({ downstream, method });
  assert.deepEqual([attempts, releases], [1, 1]);
  return result;
};
await expectGate(await cleanupFailure({ parts: ["not metadata\nsecret"] }), 500, "Document access could not be verified.");
await expectGate(await cleanupFailure({ parts: [META], configure: () => { state.resolveError = new Error("private access failure"); } }), 500, "Document access could not be verified.");
await expectGate(await cleanupFailure({ parts: [META], configure: () => { state.result = { canRead: true }; } }), 500, "Document access could not be verified.");
await expectGate(await cleanupFailure({ parts: [META], configure: () => { state.result = resolved("none", false); }, cancelRejects: true }), 403, "You do not have access to this document.");
response = await cleanupFailure({ parts: [META], configure: () => { state.result = resolved("viewer"); }, method: "HEAD", cancelRejects: true }); assert.equal(response.status, 200); assert.equal(await response.text(), "");
reset(); let failedReadCancelAttempts = 0, failedReadReleases = 0; await expectGate(await invoke({ downstream: html("", [META], { failAt: 0, onReaderCancel: () => { failedReadCancelAttempts += 1; }, onRelease: () => { failedReadReleases += 1; } }) }), 500, "Document access could not be verified."); assert.deepEqual([failedReadCancelAttempts, failedReadReleases], [1, 1]); assert.equal(state.resolveCalls.length, 0);

const resultKeys = ["role", "shared", "canRead", "canComment", "threadControl", "canSuggest", "canEdit", "canAccept", "canShare", "canSeeMembers"];
const resultBad = [];
for (const key of resultKeys) {
  const missing = resolved("viewer"); delete missing[key]; resultBad.push(missing);
  const wrong = resolved("viewer"); wrong[key] = key === "role" ? "reader" : key === "threadControl" ? "some" : "yes"; resultBad.push(wrong);
  const hidden = resolved("viewer"); Object.defineProperty(hidden, key, { value: hidden[key], enumerable: false }); resultBad.push(hidden);
  const accessor = resolved("viewer"); Object.defineProperty(accessor, key, { enumerable: true, get() { throw new Error("result accessor must not run"); }, set() {} }); resultBad.push(accessor);
}
resultBad.push(
  { ...resolved("viewer"), canEdit: true },
  { ...resolved("viewer"), extra: false },
  Object.assign(Object.create(null), resolved("viewer")),
  Object.assign(Object.create({ inherited: true }), resolved("viewer")),
  Object.assign([...Object.values(resolved("viewer"))], resolved("viewer")),
  Object.assign(resolved("viewer"), { [Symbol("private")]: true }),
);
for (const bad of resultBad) {
  reset(); state.result = bad; await expectGate(await invoke(), 500, "Document access could not be verified.");
}
reset(); state.capabilitiesError = new Error("private capabilities failure"); await expectGate(await invoke(), 500, "Document access could not be verified.");
reset(); const unavailable = new Error("private provider failure"); unavailable.name = "StoreError"; unavailable.code = "unavailable"; unavailable.status = 503; state.resolveError = unavailable; await expectGate(await invoke(), 503, "Document access is temporarily unavailable.");
reset(); state.resolveError = new Error("private access failure"); await expectGate(await invoke(), 500, "Document access could not be verified.");
reset(); state.resolveError = Object.assign(Object.create({ name: "StoreError", code: "unavailable", status: 503 }), { message: "inherited classification" }); await expectGate(await invoke(), 500, "Document access could not be verified.");

reset(); state.result = resolved("viewer"); assert.equal((await invoke()).status, 200); reset(); state.result = resolved("none", true); await expectGate(await invoke(), 403, "You do not have access to this document."); reset(); state.result = resolved("viewer"); assert.equal((await invoke()).status, 200);
reset(); let errorReleaseCalls = 0; state.result = resolved("viewer"); response = await invoke({ downstream: html("", [META, "<main>", "never delivered"], { failAt: 2, onRelease: () => { errorReleaseCalls += 1; } }) }); await assert.rejects(response.text(), /injected private stream failure/); assert.equal(errorReleaseCalls, 1); assertCall();

console.log("PASS  P3-J exact source-bound response and authority matrix");
NODE
```

Expected: exit `0`, empty stderr, and exactly `PASS  P3-J exact source-bound response and authority matrix`. The VM linker rejects undeclared imports; the source assertions reject retired identity/document authority, conditional pass-through, and caching; call counts prove short-circuit order; the role matrix keeps identity class separate from document access; and the response/byte-stream cases prove first-line bounds, replay, headers, HEAD probe cancellation/release with preserved `Content-Length`/`Content-Encoding`, conditional full-response authorization, downstream-304 denial, range denial, result validation, exactly-once reader release on normal close and natural upstream failure, rejected consumer cancellation forwarding once with one release, errors, and per-request revocation. Because Bash is replaced by the sole process and there are no owned artifacts or descendants, normal exit and every terminal signal have an honest zero-residue boundary.

### 2. Hosted Edge, strong revocation, invitation, and latency gate

This is a mandatory pre-release gate, not a source-completion gate, because local mocks cannot prove the pinned Blobs package bundles in Netlify's Deno Edge runtime or that a strong read observes a revoke immediately. It is self-contained for the exact private inputs below: one disposable invite-only site containing the exact integrated commit and one already-built, already-owner-bound document whose record has `ownerSub` equal to `P3J_OWNER_SUB` and `orgDefault: "commenter"`; three already-authenticated fixture cookie jars; their matching subjects; and one disposable-site token. The command validates that existing document without changing or deleting it, proves the three jar identities through the final `/api/session`, requires its fixture grant/invitation keys to be absent, and is then the sole seeder and cleaner of those two child records. Cookie acquisition is deliberately an enumerated secret input rather than copied automation: P3-J never handles fixture passwords or creates Identity accounts. Never paste or print cookie contents.

```text
P3J_ORIGIN             exact disposable https origin, no trailing slash
P3J_DOC_PATH           exact deployed document pathname, beginning and ending /
P3J_DOC_ID             its six-lowercase-hex baked id
P3J_SITE_ID            disposable Netlify Project ID
P3J_NETLIFY_TOKEN      disposable-site-capable personal access token
P3J_OWNER_JAR          mode-0600 owner cookie jar
P3J_ORG_JAR            mode-0600 organization-reader cookie jar
P3J_EXTERNAL_JAR       mode-0600 external-reader cookie jar
P3J_OWNER_SUB          invented owner's exact P2-H subject
P3J_ORG_SUB            invented organization reader's exact P2-H subject
P3J_EXTERNAL_SUB       invented external reader's exact P2-H subject
P3J_EXTERNAL_EMAIL     exact invented normalized external address
```

After validating the enumerated inputs, the command installs signal handling before creating its private evidence root, then `exec` replaces Bash with one Node process. Node starts no child, worker, server, daemon, detached session, npm install, or background task; it owns every network promise directly and applies a 15-second timeout to each request. Its 180-second active-work deadline aborts ordinary work and is followed by at most three sequential 15-second cleanup windows—parallel owned-key deletes, parallel absence reads, then the document re-read—so the declared worst-case process bound is 225 seconds. On HUP/INT/TERM it aborts active work, attempts that separately bounded cleanup of only the fixture child keys it may have written, and preserves the first status 129/130/143. An active-work timeout uses 124 after cleanup. On unproved cleanup it retains a mode-0600 evidence record containing the private disposable site/document identifiers, direct PID, and guarded root, but stderr prints only the root/evidence locator and never those identifiers. SIGKILL cannot leave a process descendant; it intentionally leaves the pre-created evidence for remote cleanup. Successful cleanup strongly proves the owned grant/invitation keys absent and revalidates the pre-existing document record before bounded removal of the small local root.

```bash
set -euo pipefail
exec env NODE_NO_WARNINGS=1 node --input-type=module <<'NODE'
import { getStore } from "@netlify/blobs";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const required = (name) => { const value = env[name]; if (!value) throw new Error("invalid fixture input"); return value; };
const origin = required("P3J_ORIGIN"), path = required("P3J_DOC_PATH"), docId = required("P3J_DOC_ID");
const siteID = required("P3J_SITE_ID"), token = required("P3J_NETLIFY_TOKEN");
const ownerSub = required("P3J_OWNER_SUB"), orgSub = required("P3J_ORG_SUB"), externalSub = required("P3J_EXTERNAL_SUB"), externalEmail = required("P3J_EXTERNAL_EMAIL");
let parsedOrigin, parsedPath;
try { parsedOrigin = new URL(origin); parsedPath = new URL(path, parsedOrigin); } catch { throw new Error("invalid fixture input"); }
if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin || parsedOrigin.pathname !== "/" || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash) throw new Error("invalid fixture input");
if (!path.startsWith("/") || path.startsWith("//") || !path.endsWith("/") || parsedPath.origin !== origin || parsedPath.pathname !== path || parsedPath.search || parsedPath.hash) throw new Error("invalid fixture input");
if (!/^[0-9a-f]{6}$/.test(docId) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(siteID)) throw new Error("invalid fixture input");
if (![ownerSub, orgSub, externalSub].every((value) => /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value))) throw new Error("invalid fixture input");
const emailParts = externalEmail.split("@");
const emailLabels = emailParts.length === 2 ? emailParts[1].split(".") : [];
if (externalEmail.length > 254 || emailParts[0]?.length < 1 || emailParts[0]?.length > 64 || !/^[a-z0-9.!#$%&'*+=?^_`{|}~-]+$/.test(emailParts[0] ?? "")) throw new Error("invalid fixture input");
if (emailLabels.length < 2 || emailLabels.at(-1) !== "invalid" || emailLabels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error("invalid fixture input");

let requestedStatus = 0, timedOut = false, cleanupProved = false;
const active = new AbortController();
for (const [signal, status] of [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => {
  if (!requestedStatus) { requestedStatus = status; process.exitCode = status; }
  active.abort(new Error("fixture interrupted"));
});
const overall = setTimeout(() => { timedOut = true; active.abort(new Error("fixture deadline")); }, 180_000);
const withDeadline = () => AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]);
const boundedFetch = (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any([withDeadline(), ...(init.signal ? [init.signal] : [])]) });
let root = null, evidence = null, store = null, cleanupStore = null, docKey = null, grantKey = null, inviteKey = null, cookies = null, expectedDocument = null;
const ownedKeys = new Set();
const now = "2026-09-03T12:00:00.000Z";

const cookieHeader = (filename) => {
  const mode = statSync(filename).mode & 0o777;
  if (mode !== 0o600) throw new Error("invalid cookie jar mode");
  const pairs = [];
  for (let line of readFileSync(filename, "utf8").split("\n")) {
    if (line.startsWith("#HttpOnly_")) line = line.slice(10);
    else if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 7 || /[\r\n;]/.test(fields[5]) || /[\r\n]/.test(fields[6])) throw new Error("invalid cookie jar");
    pairs.push(`${fields[5]}=${fields[6]}`);
  }
  if (!pairs.length) throw new Error("empty cookie jar");
  return pairs.join("; ");
};
const request = async (cookie, headers = {}) => {
  const started = performance.now();
  const response = await fetch(origin + path, { headers: { ...headers, Cookie: cookie }, redirect: "manual", signal: withDeadline() });
  const status = response.status, etag = response.headers.get("etag");
  if (response.body) await response.body.cancel();
  return { status, etag, milliseconds: performance.now() - started };
};
const requireStatus = async (cookie, expected, headers) => { const result = await request(cookie, headers); if (result.status !== expected) throw new Error("unexpected hosted status"); return result; };
const samples = async (cookie, expected) => { const values = []; for (let index = 0; index < 20; index += 1) values.push((await requireStatus(cookie, expected)).milliseconds); return values.sort((a, b) => a - b); };
const session = async (cookie) => {
  const response = await fetch(`${origin}/api/session?doc=${encodeURIComponent(docId)}`, { headers: { Cookie: cookie }, redirect: "manual", signal: withDeadline() });
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("invalid fixture session");
  const value = await response.json();
  const keys = ["sub", "email", "name", "roles", "canComment", "canEdit", "doc", "role", "shared", "canSuggest", "canAccept", "canShare", "canSeeMembers"];
  if (Object.getPrototypeOf(value) !== Object.prototype || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys) || value.doc !== docId) throw new Error("invalid fixture session");
  return value;
};

let failure = false;
const summaries = [];
try {
  root = mkdtempSync(join(tmpdir(), "p3j-hosted-"));
  chmodSync(root, 0o700);
  evidence = join(root, "manual-remediation.txt");
  writeFileSync(evidence, `site=${siteID}\ndoc=${docId}\npid=${process.pid}\nroot=${root}\n`, { mode: 0o600, flag: "wx" });
  store = getStore({ name: "doc-state", siteID, token, consistency: "strong", fetch: boundedFetch });
  cleanupStore = getStore({ name: "doc-state", siteID, token, consistency: "strong", fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) });
  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(externalEmail)));
  const hash = [...hashBytes].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
  docKey = `access/${docId}/doc.json`; grantKey = `access/${docId}/u/${externalSub}.json`; inviteKey = `access/${docId}/i/${hash}.json`;
  expectedDocument = await store.get(docKey, { type: "json", consistency: "strong" });
  if (expectedDocument?.docId !== docId || expectedDocument?.ownerSub !== ownerSub || expectedDocument?.orgDefault !== "commenter") throw new Error("invalid pre-bound fixture document");
  const actor = { sub: ownerSub, name: "Fixture Owner", email: expectedDocument.ownerEmail };
  const [existingGrant, existingInvitation] = await Promise.all([store.get(grantKey, { type: "json", consistency: "strong" }), store.get(inviteKey, { type: "json", consistency: "strong" })]);
  if (existingGrant !== null || existingInvitation !== null) throw new Error("fixture child key already exists");
  cookies = { owner: cookieHeader(required("P3J_OWNER_JAR")), org: cookieHeader(required("P3J_ORG_JAR")), external: cookieHeader(required("P3J_EXTERNAL_JAR")) };
  if (new Set(Object.values(cookies)).size !== 3 || new Set([ownerSub, orgSub, externalSub]).size !== 3) throw new Error("fixture identities must be distinct");
  const [ownerSession, orgSession, externalSession] = await Promise.all([session(cookies.owner), session(cookies.org), session(cookies.external)]);
  if (ownerSession.sub !== ownerSub || ownerSession.role !== "owner" || JSON.stringify(ownerSession.roles) !== '["member"]') throw new Error("invalid owner fixture session");
  if (orgSession.sub !== orgSub || orgSession.role !== "commenter" || JSON.stringify(orgSession.roles) !== '["member"]') throw new Error("invalid organization fixture session");
  if (externalSession.sub !== externalSub || externalSession.email !== externalEmail || externalSession.role !== "none" || JSON.stringify(externalSession.roles) !== '["guest"]') throw new Error("invalid external fixture session");
  ownedKeys.add(grantKey);
  await store.setJSON(grantKey, { v: 1, docId, sub: externalSub, email: externalEmail, name: "External Reader", role: "viewer", grantedBy: actor, grantedAt: now, fromInvitation: null });
  for (const [label, cookie] of [["owner", cookies.owner], ["org", cookies.org], ["external", cookies.external]]) {
    await requireStatus(cookie, 200);
    summaries.push([label, await samples(cookie, 200)]);
  }
  const prior = await requireStatus(cookies.external, 200);
  if (!prior.etag || /[\r\n]/.test(prior.etag)) throw new Error("missing safe representation validator");
  await store.delete(grantKey);
  await requireStatus(cookies.external, 403, { "If-None-Match": prior.etag });
  summaries.push(["denied", await samples(cookies.external, 403)]);
  ownedKeys.add(inviteKey);
  await store.setJSON(inviteKey, { v: 1, docId, email: externalEmail, role: "viewer", invitedBy: actor, invitedAt: now, expiresAt: "2099-10-03T12:00:00.000Z", accountCreated: true });
  await requireStatus(cookies.external, 200);
  const [grant, invitation] = await Promise.all([store.get(grantKey, { type: "json", consistency: "strong" }), store.get(inviteKey, { type: "json", consistency: "strong" })]);
  if (grant !== null || invitation?.email !== externalEmail) throw new Error("invitation conversion boundary failed");
} catch {
  failure = true;
} finally {
  try {
    if (!cleanupStore) throw new Error("cleanup store unavailable");
    await Promise.all([...ownedKeys].map((key) => cleanupStore.delete(key)));
    const remaining = await Promise.all([...ownedKeys].map((key) => cleanupStore.get(key, { type: "json", consistency: "strong" })));
    const currentDocument = docKey && await cleanupStore.get(docKey, { type: "json", consistency: "strong" });
    if (remaining.some((value) => value !== null) || JSON.stringify(currentDocument) !== JSON.stringify(expectedDocument)) throw new Error("cleanup not visible");
    cleanupProved = true;
  } catch { cleanupProved = false; }
  clearTimeout(overall);
}

if (!failure && !requestedStatus && !timedOut && cleanupProved) {
  await new Promise((resolve) => setImmediate(resolve));
  if (!requestedStatus) {
    try {
      rmSync(root, { recursive: true });
    } catch { cleanupProved = false; }
  }
}
if (!failure && !requestedStatus && !timedOut && cleanupProved) {
  const median = (values) => (values[9] + values[10]) / 2;
  for (const [label, values] of summaries) console.log(`P3-J latency ${label} median_ms=${median(values).toFixed(1)} p95_ms=${values[18].toFixed(1)}`);
  const incremental = median(summaries.find(([label]) => label === "external")[1]) - median(summaries.find(([label]) => label === "owner")[1]);
  console.log(`P3-J latency decision external_minus_owner_median_ms=${incremental.toFixed(1)} threshold_ms=100 action=${incremental > 100 ? "open-separate-architecture-decision" : "none"}`);
  console.log("PASS  P3-J hosted Edge, invitation, immediate revocation, and latency gate");
} else {
  console.error(`MANUAL REMEDIATION P3-J pid=${process.pid} root=${root ?? "not-created"} evidence=${evidence ?? "not-created"}`);
  process.exitCode = requestedStatus || (cleanupProved ? (timedOut ? 124 : 1) : 125);
}
NODE
```

Expected: the command first proves the existing document record is unchanged, the three cookie jars and subjects are distinct, and `/api/session` reports exact owner/member, organization-commenter/member, and external-none/guest identities. The owner, organization-default reader, and seeded external viewer then each return exact 200; the external 200 supplies a safe ETag, and deletion is followed immediately by exact 403 when the same external jar sends that ETag in `If-None-Match`—never 304 or reused HTML. A live invitation then returns 200 and remains present with no subject grant after the fetch-only page request. Successful stdout is exactly four sanitized timing summary lines, one sanitized decision line whose action is `open-separate-architecture-decision` iff the external-minus-owner median is greater than 100 ms, and `PASS  P3-J hosted Edge, invitation, immediate revocation, and latency gate`; stderr is empty. Do not publish the numeric result with a site, path, ID, person, validator, or request timestamp. Normal cleanup deletes and strongly verifies absence of only the grant/invitation records this command may have created, proves the pre-existing document record byte-equivalent as JSON, and then removes evidence. The supplying project owner separately disposes of the already-existing site and fixture accounts; that external environment lifecycle is not part of P3-J's source-completion or cleanup claim. After evidence creation, exceptional output is only the safe PID/root/evidence manual-remediation locator; private site/document identifiers remain inside the retained mode-0600 evidence for operator cleanup.

### 3. Ownership, source, repository, and issue gates

```bash
set -euo pipefail
: "${P3J_BASE:?export the reviewed predecessor commit}"
base_commit=$(git rev-parse --verify "${P3J_BASE}^{commit}")
bash_syntax=$(mktemp "${TMPDIR:-/tmp}/p3j-bash.XXXXXX")
trap 'rm -f -- "$bash_syntax"' EXIT

test "$(rg -l 'export default async function gate' netlify/edge-functions --glob '*.ts')" = "netlify/edge-functions/gate.ts"
test "$(rg -l 'resolveRole\(' netlify/edge-functions --glob '*.ts')" = "netlify/edge-functions/gate.ts"
! rg -n 'appMetadata|app_metadata|\.docs\b|\broles\b|getUser|nf_jwt|endsWith\s*\(|@example\.com|consumeInvitation\s*:\s*true|sendConditionalRequest\s*:\s*true|console\.|caches\.' netlify/edge-functions/gate.ts
test "$(rg -n '^## ' docs/tickets/P3-J.md | wc -l | tr -d ' ')" = 12
test "$(rg '^## ' docs/tickets/P3-J.md | sed 's/^## //')" = "$(printf '%s\n' 'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' 'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' 'Assumptions and open questions' 'References')"
awk '/^```bash$/ { inside=1; next } /^```$/ { if (inside) { inside=0; print "" }; next } inside' docs/tickets/P3-J.md >"$bash_syntax"
bash -n "$bash_syntax"

templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P3-J.md netlify/edge-functions/gate.ts
git diff --check "$base_commit...HEAD"
git diff --check
git diff --cached --check

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3J_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
assert.match(base, /^[0-9a-f]{40,64}$/, "export P3J_BASE as the reviewed P2-A/P2-G/P2-H/P3-H predecessor commit");
const rows = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const paths = new Set([...rows(["diff", "--name-only", `${base}...HEAD`]), ...rows(["diff", "--name-only"]), ...rows(["diff", "--cached", "--name-only"]), ...rows(["ls-files", "--others", "--exclude-standard"])]);
for (const path of [...paths]) if (path === "docs/tickets/P3-J.md") paths.delete(path);
assert.deepEqual([...paths].sort(), ["netlify/edge-functions/gate.ts"]);
console.log("PASS  P3-J owns only gate.ts");
NODE

issue_json="$(gh issue view 23 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-J.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-J — The gate learns the grant store" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-J issue #23 pointer integrity'
```

Expected: export `P3J_BASE` as the full reviewed predecessor commit, then every command exits `0`. Source/privacy/heading/Bash-fence checks emit nothing; `check-dist` reports byte-identical committed documents; TypeScript emits no diagnostics; scrub reports no denied term or warning; and committed, staged, and unstaged diff whitespace is clean. Issue #23 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the final two lines are `PASS  P3-J owns only gate.ts` and `PASS  P3-J issue #23 pointer integrity`. The Bash-syntax temporary is removed by the installed trap.

## Failure modes

- Exact public invite path: bypass before identity/response/access; P4-K owns the eventual public page and acceptance Function.
- Anonymous protected path: return P2-A's exact login redirect with path and query only; never ask the origin for document bytes first.
- Identity provider rejection or malformed identity: return exact 503 or internal 500 respectively, with no downstream/access call and no diagnostic leak.
- Redirect, 404, 405, or downstream server error: preserve its response rather than converting routing/login behavior into a grant oracle. Never follow the redirect inside the gate.
- Conditional document request: use default full-response `context.next()`, extract the document ID, and authorize current access before returning 200. An unexpected downstream 304 returns internal 500 and never instructs cached-byte reuse.
- Partial-range or other unverifiable successful representation: fail 500 before forwarding bytes. Authorized range delivery is deliberately unsupported in v1.
- Missing/non-HTML/locked/errored 200 body or malformed/overlong first line: cancel best-effort and fail 500. Never fall back to URL-derived identity or pass through.
- Unknown but syntactically valid baked document ID: let P2-G return ordinary unshared/none and return generic 403; absence is not a storage error.
- Owner, explicit grant, live invitation, or readable org default: stream the unchanged HTML after exact result validation.
- `orgDefault: none`, expired/canceled invitation, different proven email, deleted grant, or no authority: return the same generic 403 without naming any address or state.
- Strong-store/provider unavailability: return safe 503 only for the exact own-field StoreError classification. Corrupt state, AccessError, malformed result, or unexpected failure returns 500.
- Invitation path: recognize read authority with `consumeInvitation: false`; do not create a grant or delete the invitation. P3-H may convert only when the loaded page calls session.
- Owner-capture path: P2-G may perform its already-specified create-only configured-owner binding. P3-J performs no direct write and must not copy that algorithm.
- Client cancels an allowed response: forward cancel once to the held reader, suppress a rejected cancellation promise, release exactly once, and do not log reason/state or mutate access.
- Origin stream closes or fails after authorization: release the reader exactly once; on failure, fail the transfer through the stream without retrying, synthesizing a complete 200, or exposing an alternate response.
- Hosted interruption/active-work timeout after evidence creation: the one direct Node process aborts active network promises at 180 seconds, then uses at most three separately bounded 15-second cleanup windows to delete/check only fixture grant/invitation keys it may have created and re-read the pre-existing document; the total declared process bound is 225 seconds. It removes its guarded local root only after proved cleanup and owns no child or process group. Unproved remote or local cleanup retains mode-0600 private evidence and prints only the safe direct-PID/root/evidence locator, never the site or document identifier.

## Settled decisions

- `canRead` from P2-G is the sole document-success authority. `isOrg` is input to P2-G, not a gate bypass; the older research org fast path is superseded.
- Every authenticated identity needs the baked ID before access resolution, so every authenticated eligible response is response-first through `context.next()`.
- The permanent ID is the exact first artifact line emitted by P1-B. Slugs, aliases, permanent-ID redirect paths, query strings, and clients are not authority inputs.
- A live invitation is sufficient read authority before conversion. The gate always passes explicit `consumeInvitation: false`; P3-H owns grant-first/delete-second conversion.
- The gate does not import storage or perform direct writes. P2-G retains its own one-time configured-owner binding because splitting that behavior would create competing authority.
- Strong reads occur on every authenticated document request. No authorization cache is allowed before measurement or afterward without a new ruling that explicitly accepts delayed revocation.
- Safe downstream redirects and errors keep their own semantics; 304 is the explicit exception because it could reuse protected bytes without current authorization. Successful body-bearing responses never bypass meta/access verification.
- HEAD is authorized against the corresponding GET representation, cancels/releases its probe reader exactly once, preserves the GET representation headers including `Content-Length` and `Content-Encoding`, and returns without a body. Range responses fail closed rather than weakening the first-line proof.
- Only the bounded first line is inspected/buffered. Authorized remaining bytes stream unchanged; newly framed GET responses discard only transport framing headers. Every normal-close, read-error, or consumer-cancel terminal path releases the one reader exactly once.
- Privacy is stricter than the older research denial copy: P3-J retains P2-A's generic 403 and never names even the signed-in address.
- HTML read authorization is independent of `/api/*`. P4-M later adds write-path capability enforcement and cannot rely on this gate.
- P3-J alone amends `gate.ts`; predecessor and downstream ticket documents/files remain untouched.

## Assumptions and open questions

- **Assumption:** P1-B's accepted exact first-line contract is the runtime parser contract; arbitrary hand-authored HTML is not a supported protected document. Missing or altered metadata is an integrity failure, not an alternate syntax to accept.
- **Assumption:** returning a newly constructed web-stream `Response` requires removal of `Content-Length`, `Content-Encoding`, and `Transfer-Encoding`; all application/security/cache headers remain valid because the logical bytes are unchanged.
- **Assumption:** Netlify's documented default `context.next()` behavior supplies a full non-conditional origin response. P3-J verifies that behavior in the hosted validator/revocation case; an unexpected bodyless 304 and a partial 206 both fail closed.
- **Assumption:** P2-G's explicit `consumeInvitation: false` guarantee means no grant/invitation mutation. Its separate one-time configured-owner capture is intentionally inherited; an absolute no-write resolver would require a new P2-G-owned API and is outside this ticket.
- **Assumption:** the hosted fixture begins with the exact validated owner-bound document and absent fixture child keys. The command never overwrites or deletes that document, validates the three distinct authenticated subjects through `/api/session`, and cleans only child keys it first proved absent.
- **Open question (measured, not pre-decided):** actual Edge response-read plus strong-store overhead varies by region/provider. Record sanitized median/p95 values and the external-minus-owner median. More than 100 ms incremental median emits the exact `open-separate-architecture-decision` action; it does not authorize a cache that weakens revocation.
- **Open question (non-blocking):** Netlify does not document an application-level maximum static response chunk size. The implementation avoids whole-body copies and bounds its own inspected prefix, but one upstream-provided chunk is necessarily resident when read.
- **No blocking contract gap:** final P2-H identity, P2-G capability/result/error behavior, P3-H invitation conversion, P1-B meta placement, and P2-A/P1-E gate seams are sufficiently specified for implementation.

## References

- `docs/research/00-integration-plan.md` §§1.2, 1.3, 4.1, 4.7, and 6 — load-bearing gate, permanent ID, exact build seam, P3-J ownership, and ruling precedence.
- `docs/research/02-auth.md` §§2–3 and 8 — original Edge/Identity/login boundary and provider constraints; obsolete share-token and `appMetadata.docs` alternatives are not adopted.
- `docs/research/09-sharing-and-roles.md` §§3–5, 9, and 11 — identity/access split, access records, live-invitation read, conversion ownership, revocation, privacy, and original latency/Edge questions. Its ticket letters and org fast-path sentence are superseded by the ruling plan and final tickets.
- `docs/tickets/P1-B.md` — exact first-line doc-id meta output and generated-artifact integrity gate.
- `docs/tickets/P2-A.md` — gate/login/invite/error seams, sole gate ownership before this amendment, and source/hosted process-supervision boundary.
- `docs/tickets/P2-G.md` — exact roles/capabilities, strong reads, result/error contract, owner capture, explicit non-consuming invitation mode, and P3-J consumer obligations.
- `docs/tickets/P2-H.md` — final four-field identity and removal of `isOrg`/legacy roles as final document authority.
- `docs/tickets/P3-H.md` — final document-aware session and sole invitation-consuming read path; it does not authorize HTML.
- Netlify, “Edge Functions API,” accessed 2026-09-03 — `context.next()`, response-body middleware, default full-response conditional behavior, Web Streams, TextDecoder, Performance, and timers: <https://docs.netlify.com/build/edge-functions/api/>.
- Netlify, “Edge Functions declarations,” accessed 2026-09-03 — response termination, redirect/static processing order, and `context.next()` for same-path downstream content: <https://docs.netlify.com/build/edge-functions/declarations/>.
- Netlify, “Edge Functions limits,” accessed 2026-09-03 — 512 MB deployed-set memory, 50 ms CPU time, and 40-second response-header timeout: <https://docs.netlify.com/build/edge-functions/limits/>.
- Netlify, “Netlify Blobs,” accessed 2026-09-03 — Edge support, site-wide stores, manual site/token context, and strong store/operation reads: <https://docs.netlify.com/build/data-and-storage/netlify-blobs/>.
- GitHub issue #23 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
