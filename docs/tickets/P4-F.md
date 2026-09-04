# P4-F — Retention

## Outcome

The repository has one daily Netlify scheduled function that deterministically deletes validated audit events strictly older than 540 days under explicit provider-page, key, read, delete, time, and execution bounds.

## Context

The append-only event stream is an audit view, not feature state, so ordinary historical events may expire without changing comments, edits, suggestions, or access. Netlify Blobs has no automatic TTL for this store; expiry must be implemented by application code. P4-F creates the bounded scheduler and baseline event policy. P4-T immediately amends the same file to retain durable authorship/decision/access kinds and add the other record sweeps before those later writers are deployed.

## Scope

### In scope

- Create `netlify/functions/retention.mjs` as one Functions v2 scheduled ESM module.
- Run at `@daily` on published deploys.
- Use the P2-B `doc-state` store and P3-B event key/schema validators.
- Manually paginate the global `events/` prefix with hard page/key/pull limits.
- Validate every listed key, strongly read and validate only expiry candidates, and delete at most 100 old events per invocation.
- Define “18 months” as the exact fixed duration 540 days and delete only when `event.ts < now - 540 days`.
- Return a closed summary to deterministic callers and write one non-personal success line from the scheduled handler.
- Fail closed on provider envelope/key/record corruption or unavailable storage without inventing a successful sweep.

### Out of scope

- Deleting thread records, current edit receipts, suggestion records, access records, grants, invitations, generated history, or git history.
- Retention exclusions or suggestion/invitation sweeps. P4-T amends this file and owns those policies.
- Comment-delete tombstones, body purging, per-document policy fields, a retention UI, an HTTP route, a manual admin endpoint, or `deleteAll()`.
- Retrying provider operations, transactions, background functions, queues, cursors stored in Blobs, or a second retention file.
- Changing P2-B/P3-B helpers, package/configuration files, event writers, generated output, or workflows.

## Interface contract

### Module surface and schedule

`netlify/functions/retention.mjs` has exactly these exports:

```text
export const EVENT_RETENTION_MS = 46_656_000_000
export const MAX_EVENT_DELETES = 100
export async function sweepEvents(options)
export function createRetentionHandler(dependencies = {})
export default async function handler(req)
export const config = { schedule: "@daily" }
```

The module imports exactly `docState`, `read`, `eventKey`, and `StoreError` from `../lib/store.mjs`, plus `assertEvent` from `./events.mjs`. It defines the private constant `EVENT_ROOT_PREFIX = "events/"`; P2-B's public `eventPrefix(docId, month)` deliberately requires a document ID and is not a global-scan builder. The module imports no Netlify SDK directly, has no path configuration, and reads no request URL, body, header, cookie, identity, role, environment variable, or document content. Netlify documents that a `schedule` is mutually exclusive with `path`, scheduled functions run automatically only on published deploys, and `@daily` means midnight UTC.

Define one unexported `RetentionError extends Error`. `new RetentionError(code)` sets exact `name = "RetentionError"`, `message = "Invalid retention state"`, and own string `code`; P4-F uses `invalid-event-key`, and P4-T may add `invalid-suggestion-key`, `invalid-invitation-key`, and `invitation-scan-limit`. No provider value, key, record, or cause enters its message.

`sweepEvents(options)` requires one non-null, non-array object with exactly own enumerable data keys `store` and `nowMs`; `store.list` and `store.delete` are functions and the clock satisfies the rule below. Any inspection trap, missing/extra key, accessor, symbol, invalid store method, or invalid clock throws `TypeError("Invalid retention options")` before listing. This is a server-internal deterministic seam, not an HTTP/request option.

`createRetentionHandler()` accepts a closed ordinary dependency object containing optional `storeFn`, `nowFn`, and `logFn` functions only. Defaults are `docState`, `Date.now`, and `console.info`. The returned async handler ignores its scheduled request, samples `nowFn()` exactly once, calls `storeFn()` exactly once, awaits `sweepEvents({store, nowMs})`, writes exactly one line through `logFn`, and resolves `undefined`. Invalid dependencies, clock, store, or summary reject; no catch converts failure to success.

### Time and eligibility

`EVENT_RETENTION_MS` is exactly `18 * 30 * 24 * 60 * 60 * 1000`, or 540 fixed 24-hour days. `nowMs` must be a safe integer from `1_000_000_000_000` through `9_999_999_999_999` and convertible to canonical UTC ISO text. Compute `cutoffMs = nowMs - EVENT_RETENTION_MS` once.

An event is eligible only when all are true:

1. Its listed key is structurally valid and reconstructed exactly by P2-B `eventKey()`.
2. The 13-digit millisecond prefix in its event ID is a safe integer strictly less than `cutoffMs`.
3. A strong P2-B `read(store, key)` returns a non-null record.
4. P3-B `assertEvent(record, key)` succeeds and its `Date.parse(ts)` equals the ID milliseconds.
5. The validated event timestamp is strictly less than `cutoffMs`.

An event exactly at the cutoff survives. One millisecond before it is eligible. Calendar month length, timezone, daylight saving time, event kind, actor, summary, and provider listing order do not affect P4-F eligibility.

### Bounded listing

Call `store.list({prefix: EVENT_ROOT_PREFIX, paginate: true})` exactly once and drive its async iterator manually. The root prefix is a private literal because P2-B's `eventPrefix()` accepts a required `docId` and intentionally cannot manufacture a global prefix.

Accept at most ten data pages, 1,000 entries per page, 10,000 unique keys, and eleven `next()` calls including the exhaustion probe. Apply the same provider-envelope discipline as P3-B: ordinary result/page/entry objects, own data descriptors, dense ordinary arrays, string keys no longer than 128 UTF-8 bytes, no accessors/symbols/custom prototypes, and no duplicate key. A malformed iterator/envelope, eleventh data page, 10,001st key, rejection, or non-iterable result is `StoreError("unavailable", 503, "State store unavailable")`. Call iterator `return()` at most once on early failure and ignore only its rejection.

Each full key must match exactly:

```text
events/<six-lowercase-hex-docId>/<YYYY-MM>/<13-decimal-ms>-<six-lowercase-hex>.json
```

Require valid calendar month text, require `new Date(idMs).toISOString().slice(0, 7)` to equal the month segment, and require `eventKey(docId, iso, eventId)` to reproduce the full key. A structurally valid provider envelope containing a malformed, duplicate, mismatched, or out-of-prefix key is corrupt internal state and rejects with `RetentionError("invalid-event-key")`; do not delete or silently skip it.

Retain only the parsed key projection, then sort candidates by numeric ID milliseconds, event ID ASCII, and full key ASCII. Provider order never decides work.

### Read, validation, delete, and result

Walk sorted keys whose ID milliseconds are before cutoff. Stop after 100 successful deletes; do not read later candidates after the cap. Read serially through P2-B `read(store, key)` with strong consistency. A `null` caused by a concurrent delete is skipped. Validate every non-null candidate with `assertEvent(record, key)` before delete.

Call `store.delete(key)` once for an eligible validated event. Its documented successful result is `undefined`; any rejection becomes `StoreError("unavailable", 503, "State store unavailable")`. There is no retry. Earlier successful deletes remain committed if a later read/delete fails because Blobs has no multi-key transaction.

Return one fresh exact ordinary object:

```json
{
  "v": 1,
  "scanned": 240,
  "candidates": 12,
  "deleted": 12,
  "remaining": false,
  "cutoff": "2025-03-12T00:00:00.000Z"
}
```

`scanned` is the number of unique listed event keys. `candidates` is the number of pre-cutoff keys actually read, including stale `null` reads. `deleted` counts resolved successful deletes. `remaining` is `true` only when the delete cap stopped traversal before another parsed pre-cutoff key; otherwise false. `cutoff` is the canonical ISO timestamp. The scheduled handler emits exactly:

```text
retention: events scanned=<scanned> candidates=<candidates> deleted=<deleted> remaining=<true|false>
```

No key, docId, actor, email, name, event body, summary, provider value, environment value, stack, or secret is logged.

### P4-T amendment boundary

P4-T is the only ticket allowed to amend this file. It must preserve P4-F's schedule, 540-day strict cutoff, manual-pagination envelope, deterministic ordering, validation-before-delete, cap, failure semantics, summary version, and no-route/no-identity boundary. It adds a durable-event exclusion predicate before reads/deletes and adds separately bounded `suggest/` and expired-invitation sweeps. P4-F and P4-T must be integrated consecutively; do not deploy P4-F alone after access/suggestion/apply event writers are live.

## Files owned

- `netlify/functions/retention.mjs` — **new**, created exclusively by P4-F and later amended only by P4-T.

No event writer, store/access helper, configuration, browser asset, package, generated file, permanent test file, research document, prompt, or other ticket is owned by P4-F.

## Dependencies

- **P2-B:** provides `docState()`, strong `read()`, exact event key builders, and `StoreError`; P4-F does not create a second store wrapper.
- **P3-B:** provides the complete 16-kind `assertEvent(value, expectedKey)` validator and key/body relationship.

P4-F source work may run in parallel with disjoint Phase 4 files after P2-B/P3-B are integrated. Its implementation maximum is one agent because it owns one new file. P4-T must serialize after P4-F on that file. The Phase 4 integrator must land P4-T before deploying P4-J/P4-N/P4-O writers that make durable excluded kinds operational.

## Acceptance criteria

- [ ] The exact module exports and `config.schedule === "@daily"` exist; no HTTP path or background mode exists.
- [ ] One invocation samples one clock/store, manually exhausts at most ten pages/10,000 keys/eleven pulls, validates provider/key structure, and never uses automatic all-page listing.
- [ ] Fixed 540-day semantics are exact: cutoff equality and one millisecond inside survive; one millisecond older deletes.
- [ ] Only a non-null event that passes P3-B key-coupled validation is deleted; null races skip and corrupt state aborts.
- [ ] At most 100 successful event deletes occur, in deterministic oldest-first order; cap exhaustion is explicit in `remaining`.
- [ ] Provider list/read/delete failures remain failures, with no retry, success fiction, record repair, or transaction claim.
- [ ] The scheduled handler returns no HTTP body, logs exactly one bounded non-personal summary on success, and logs nothing itself on failure.
- [ ] The AST oracle proves exact imports/exports, one schedule and list site, no `deleteAll`, no request parsing, no identity/network/environment access, and no timers/workers/servers.
- [ ] P4-T is named as the sole amendment and required pre-deploy successor for durable kinds.
- [ ] Repository and issue-pointer gates pass against the pushed canonical bytes.

## Test plan

### Source-bound deterministic retention fixture

Run from the repository root after implementation. The fixture must import the production module through a VM linker that supplies only its two declared predecessor modules, use an in-memory async iterator/store, and enforce a 30-second outer deadline.

```bash
perl -e 'alarm shift; exec @ARGV' 30 node --experimental-vm-modules --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const ts = require("./templates/docbuild/node_modules/typescript");
const file = "netlify/functions/retention.mjs";
const source = await readFile(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
const imports = [];
const exports = [];
let scheduleCount=0, listCount=0, deleteCount=0, forbidden=0, descendantSurface=0;
const visit=(n)=>{
  if(ts.isImportDeclaration(n)) imports.push(n.moduleSpecifier.text);
  const exported=ts.canHaveModifiers(n)&&ts.getModifiers(n)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
  if(exported&&ts.isFunctionDeclaration(n)&&n.name) exports.push(ts.getModifiers(n)?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)?"default":n.name.text);
  if(exported&&ts.isVariableStatement(n)) for(const d of n.declarationList.declarations) if(ts.isIdentifier(d.name)) exports.push(d.name.text);
  if(exported&&ts.isExportAssignment(n)) exports.push("default");
  if(ts.isPropertyAssignment(n)&&n.name.getText(sf)==="schedule") scheduleCount++;
  if(ts.isCallExpression(n)){
    const x=n.expression.getText(sf);
    if(n.expression.kind===ts.SyntaxKind.ImportKeyword||/(?:^|\.)(?:spawn|spawnSync|exec|execFile|fork)$/.test(x))descendantSurface++;
    if(x.endsWith(".list")) listCount++;
    if(x.endsWith(".delete")) deleteCount++;
    if(x.endsWith(".deleteAll")||x.includes("fetch")||x.includes("setTimeout")||x.includes("listen")) forbidden++;
  }
  if(ts.isNewExpression(n)&&/(?:^|\.)(?:Worker|SharedWorker)$/.test(n.expression.getText(sf)))descendantSurface++;
  ts.forEachChild(n,visit);
};
visit(sf);
assert.deepEqual(imports.sort(), ["../lib/store.mjs","./events.mjs"]);
assert.deepEqual(exports.sort(), ["EVENT_RETENTION_MS","MAX_EVENT_DELETES","config","createRetentionHandler","default","sweepEvents"].sort());
assert.equal(scheduleCount,1);
assert.equal(listCount,1);
assert.equal(deleteCount,1);
assert.equal(forbidden,0);
assert.equal(descendantSurface,0);

const now = Date.parse("2026-09-03T00:00:00.000Z");
const keep = 46_656_000_000;
const iso=(ms)=>new Date(ms).toISOString();
const id=(ms,suffix)=>`${ms}-${suffix}`;
const key=(doc,ms,suffix)=>`events/${doc}/${iso(ms).slice(0,7)}/${id(ms,suffix)}.json`;
const records = new Map();
for (const [ms,suffix] of [[now-keep-1,"000001"],[now-keep,"000002"],[now-keep+1,"000003"]]) {
  const k=key("4b7d2a",ms,suffix);
  records.set(k,{v:1,id:id(ms,suffix),docId:"4b7d2a",ts:iso(ms),actor:{sub:"u_fixture",name:"Avery Quill",email:"avery@example.invalid"},kind:"comment.create",target:{threadId:"t_m8x2k1_4f7a9c31",aid:"a3f19c2b7"},docVersion:"7aaca51",summary:"commented on Architecture"});
}
const deleted=[];
const store={
  list(arg){ assert.deepEqual(arg,{prefix:"events/",paginate:true}); return (async function*(){yield {blobs:[...records.keys()].reverse().map(key=>({key}))};})(); },
  async delete(k){deleted.push(k);records.delete(k);},
};
const readableStores=new WeakSet([store]);
const context=vm.createContext({console,Date,Error,Map,Object,Promise,Response,Set,TextEncoder,TypeError,URL});
const mod=new vm.SourceTextModule(source,{context,identifier:file});
await mod.link(async(specifier)=>{
  if(specifier==="../lib/store.mjs") return new vm.SyntheticModule(["StoreError","docState","eventKey","read"],function(){
    class StoreError extends Error{constructor(code,status,message,o={}){super(message);this.name="StoreError";this.code=code;this.status=status;this.cause=o.cause;}}
    this.setExport("StoreError",StoreError);this.setExport("docState",()=>store);
    this.setExport("eventKey",(doc,ts,eventId)=>`events/${doc}/${ts.slice(0,7)}/${eventId}.json`);
    this.setExport("read",async(s,k)=>{assert.equal(readableStores.has(s),true,"read received an unregistered fixture store");return records.get(k)??null;});
  },{context});
  if(specifier==="./events.mjs") return new vm.SyntheticModule(["assertEvent"],function(){this.setExport("assertEvent",(v,k)=>{assert.equal(k,key(v.docId,Date.parse(v.ts),v.id.slice(-6)));return structuredClone(v);});},{context});
  throw new Error(`unexpected import ${specifier}`);
});
await mod.evaluate();
const deadline=setTimeout(()=>{console.error("FAIL  P4-F fixture exceeded 30 seconds");process.exit(124);},30_000);
const result=await mod.namespace.sweepEvents({store,nowMs:now});
assert.equal(result.v,1);
assert.equal(result.scanned,3);
assert.equal(result.candidates,1);
assert.equal(result.deleted,1);
assert.equal(result.remaining,false);
assert.deepEqual(deleted,[key("4b7d2a",now-keep-1,"000001")]);
assert.equal(records.has(key("4b7d2a",now-keep,"000002")),true);
assert.equal(records.has(key("4b7d2a",now-keep+1,"000003")),true);

records.clear();deleted.length=0;
const capEntries=[];
for(let i=0;i<101;i++){
 const ms=now-keep-1-i;const suffix=i.toString(16).padStart(6,"0");const k=key("4b7d2a",ms,suffix);
 capEntries.push({ms,k});
 records.set(k,{v:1,id:id(ms,suffix),docId:"4b7d2a",ts:iso(ms),actor:{sub:"u_fixture",name:"Avery Quill",email:"avery@example.invalid"},kind:"comment.create",target:{threadId:"t_m8x2k1_4f7a9c31",aid:"a3f19c2b7"},docVersion:"7aaca51",summary:"commented on Architecture"});
}
const capped=await mod.namespace.sweepEvents({store,nowMs:now});
const capOrder=[...capEntries].sort((a,b)=>a.ms-b.ms||(a.k<b.k?-1:a.k>b.k?1:0));
assert.equal(capped.deleted,100);assert.equal(capped.remaining,true);assert.equal(deleted.length,100);assert.equal(records.size,1);
assert.deepEqual(deleted,capOrder.slice(0,100).map(({k})=>k));
assert.deepEqual([...records.keys()],[capOrder[100].k],"the newest candidate must be the sole survivor");

const sampleKey=[...records.keys()][0];records.clear();deleted.length=0;
const staleStore={...store,list(){return(async function*(){yield{blobs:[{key:sampleKey}]};})();}};
readableStores.add(staleStore);
const stale=await mod.namespace.sweepEvents({store:staleStore,nowMs:now});
assert.deepEqual({scanned:stale.scanned,candidates:stale.candidates,deleted:stale.deleted},{scanned:1,candidates:1,deleted:0});
const overPage={...store,list(){return(async function*(){yield{blobs:Array.from({length:1001},()=>({key:sampleKey}))};})();}};
readableStores.add(overPage);
await assert.rejects(()=>mod.namespace.sweepEvents({store:overPage,nowMs:now}));

const failureMs=now-keep-2;const failureKey=key("4b7d2a",failureMs,"00abcd");
records.set(failureKey,{v:1,id:id(failureMs,"00abcd"),docId:"4b7d2a",ts:iso(failureMs),actor:{sub:"u_fixture",name:"Avery Quill",email:"avery@example.invalid"},kind:"comment.create",target:{threadId:"t_m8x2k1_4f7a9c31",aid:"a3f19c2b7"},docVersion:"7aaca51",summary:"commented on Architecture"});
let failureDeleteCalls=0;
const failingStore={...store,async delete(k){failureDeleteCalls++;assert.equal(k,failureKey);throw new Error("invented delete failure");}};
readableStores.add(failingStore);
await assert.rejects(()=>mod.namespace.sweepEvents({store:failingStore,nowMs:now}),/State store unavailable/);
assert.equal(failureDeleteCalls,1,"the delete rejection seam must execute");

records.clear();deleted.length=0;
const log=[];const run=mod.namespace.createRetentionHandler({storeFn:()=>store,nowFn:()=>now,logFn:(line)=>log.push(line)});
assert.equal(await run(new Request("https://fixture.invalid/ignored")),undefined);
assert.deepEqual(log,["retention: events scanned=0 candidates=0 deleted=0 remaining=false"]);
clearTimeout(deadline);
console.log("PASS  P4-F retention boundaries");
NODE
```

Expected: exit `0`, no stderr, no external request, and exactly `PASS  P4-F retention boundaries`. The outer Perl alarm replaces itself with the sole Node process and terminates that process after 30 seconds; the exact-import oracle rules out a spawned production descendant. The finite matrix proves cutoff equality and ±1 ms, the exact oldest-first 100-key deletion sequence and newest survivor, the 100/101 cap, a null read race, 1,001-entry page rejection, an executed delete rejection against the actual injected store, and the exact empty-run handler log. The source oracle proves the exact static import/export/list/delete/schedule counts; it makes no claim about unenumerated provider values.

### Repository and pointer gates

```bash
scripts/scrub-check.sh docs/tickets/P4-F.md netlify/functions/retention.mjs
templates/check-dist
npm --prefix templates/docbuild run check
git diff --check
issue_json="$(gh issue view 28 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-F.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-F — Retention"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-F repository and pointer gates'
```

Expected after push/pointer update: all commands exit `0`; the final line is `PASS  P4-F repository and pointer gates`.

## Failure modes

| Failure | Required behavior |
|---|---|
| Invalid clock/dependency/options | Reject before list/delete. |
| Malformed or over-bound provider pagination | Reject as unavailable; close iterator best effort; no automatic collection. |
| Malformed/duplicate/key-month-mismatched event key | Reject as corrupt state; delete nothing not already committed. |
| Candidate disappears after list | Skip null and continue. |
| Candidate record fails P3-B validation | Reject; never delete or repair it. |
| Delete rejects after earlier deletes | Reject; earlier deletes remain; next daily run is safe. |
| More than 100 expired events | Delete oldest 100 and report `remaining: true`; next run continues. |
| More than 10,000 event keys | Reject and require operational repair; do not perform an unbounded scan. |
| Scheduled run exceeds platform limit | Netlify terminates it; caps reduce exposure, and the next idempotent run resumes from remaining keys. |

## Settled decisions

- Event retention is a fixed 540-day duration, not calendar-month arithmetic or a `doc.json` setting.
- The strict cutoff is `<`; exact-boundary events survive.
- Listing is global, manually paginated, and bounded. Provider ordering is not trusted.
- Validation precedes deletion. `deleteAll()` and deleting solely from an unvalidated listed key are forbidden.
- Deletes are serial, oldest-first, capped at 100, and non-transactional.
- The function is scheduled at `@daily`, has no production URL, and writes only one aggregate success log.
- P4-T owns every exclusion and non-event sweep and must land before durable later kinds are deployed.

## Assumptions and open questions

- The integration plan's “18 months” is interpreted as the research contract's exact `18 * 30 days` (540 days). Changing to calendar subtraction would change boundary results and requires a ruling.
- Ten provider pages/10,000 keys matches the established P3-A/P3-B operational ceiling. Crossing it is an observable maintenance threshold, not permission for an unbounded scheduled run.
- The 100-delete cap is an implementation safety bound chosen to stay comfortably below Netlify's fixed 30-second scheduled limit. It is non-blocking and may be raised only with measured provider latency and an updated executable boundary test.
- P4-F intentionally has a short-lived unsafe deployment shape for future durable kinds; integration must land P4-T before those writers. No product question remains open.

## References

- `docs/research/00-integration-plan.md` §§1.1, 2.4, 4.6–4.7 — one event per key, month-sharded layout, daily 18-month retention, and the P4-T amendment.
- `docs/research/06-history.md` §7 — fixed-duration retention, daily schedule, 30-second concern, and bounded monthly/key scanning rationale; superseded where it proposes other stores or comment deletion.
- `docs/tickets/P2-B.md` — strong store, key builders, read/error contracts, and direct-delete boundary.
- `docs/tickets/P3-B.md` — complete event schema, key validation, provider pagination envelope, and null deletion-race behavior.
- [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/) — official UTC cron, `@daily`, published-deploy behavior, manual invocation, and fixed 30-second execution limit; checked 2026-09-03.
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/#schedule) — official inline `config.schedule` and no-route constraint; checked 2026-09-03.
- [Netlify Blobs API](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — official manual `paginate: true` iterator, pages of at most 1,000, delete semantics, and custom-expiration requirement; checked 2026-09-03.
- GitHub issue #28 — tracker pointer only; the canonical specification is this document.
