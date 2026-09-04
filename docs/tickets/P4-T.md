# P4-T — Retention exclusions and the suggestion sweep

## Outcome

The daily retention function preserves durable suggestion authorship/decision and access events forever, deletes validated abandoned suggestion records strictly older than 90 days, and removes only validated invitations whose `expiresAt` is at or before the sweep time.

## Context

P4-F's baseline 540-day deletion is correct for ordinary changelog noise but wrong for facts that are the only durable authorship, decision, or authority record—especially in standalone mode. Open suggestion and invitation blobs also have finite product lifetimes but no provider TTL. This ticket is the sole amendment to P4-F. It changes policy without weakening P4-F's bounded pagination, validation-before-delete, deterministic order, daily schedule, or failure visibility.

## Scope

### In scope

- Amend only `netlify/functions/retention.mjs` after P4-F.
- Exclude the exact durable event kinds below after their required read/validation and before any event delete.
- Add a separately bounded global `suggest/` scan and delete validated records strictly older than 90 fixed days.
- Add a separately bounded global `access/` scan, select exact invitation keys, await P2-G's body/key validator, then acquire P4-J's compatible per-document coordinator, re-read, compare, and delete only an invitation still expired and unchanged under that lease.
- Preserve P4-F's 540-day ordinary-event cutoff and 100-event delete cap.
- Use deterministic candidate ordering and per-class caps so one record class cannot starve the others.
- Extend the exact aggregate summary/log without exposing keys, documents, people, text, or provider details.

### Out of scope

- Deleting thread records, edit receipts, access document records, grants, git/history rows, accepted content, or current source.
- Retaining all suggestions or all suggestion lifecycle events forever.
- The P4-O 14-day computed-supersede reaper; P4-T's 90-day sweep is a final abandoned-open-record ceiling and does not compute base hash state.
- Cross-document indexes, stored sweep cursors, retries, queues, transactions, `deleteAll()`, repair, tombstones, status fields, or an HTTP/admin UI.
- Changing P2-B, P2-G, P3-B, or P4-O schemas/keys from this file.

## Interface contract

### Preserved and extended module surface

Keep every P4-F export and add exactly:

```text
export const SUGGESTION_RETENTION_MS = 7_776_000_000
export const MAX_SUGGESTION_DELETES = 75
export const MAX_INVITATION_RECORDS = 250
export const MAX_INVITATION_DELETES = 75
export const DURABLE_EVENT_KINDS
export async function sweepSuggestions(options)
export async function sweepInvitations(options)
```

`SUGGESTION_RETENTION_MS` is exactly 90 fixed 24-hour days. `DURABLE_EVENT_KINDS` is a deeply frozen array in exact order:

```json
[
  "suggest.create",
  "suggest.accept",
  "suggest.reject",
  "edit.apply",
  "access.invite",
  "access.change",
  "access.revoke",
  "access.transfer"
]
```

`suggest.create` is retained in addition to the seven kinds named by the ruling-plan table because P3-B's final canonical `suggest.accept`/`suggest.reject` target contains only `suggestionId` and `aid`; it does not duplicate the author's actor. The create event is therefore the durable authorship half of a decision. `suggest.withdraw`, `suggest.supersede`, `edit.propose`, and ordinary comment/thread events retain P4-F's 540-day policy.

Add P2-B `suggestionKey` to the existing store imports; import `assertAccessInvitationAtKey` from `../lib/access.mjs`; import P4-O's exact synchronous `assertSuggestionAtKey` from `./suggestions.mjs`; and import P4-J's exact `withAccessWriteLease` from `./access.mjs`. The suggestion validator returns a validated fresh suggestion and proves exact body/docId/aid/suggestionId/full-key agreement. P4-T uses `await assertSuggestionAtKey(...)` so a future promise-returning implementation would not change sweep ordering, but it must not duplicate either record schema. The maintenance-lease helper is used only around the final invitation re-read/compare/delete and never routes an HTTP request or imports Identity authority into retention.

`sweepSuggestions(options)` and `sweepInvitations(options)` use P4-F's exact closed `{store, nowMs}` options validation and exact `TypeError("Invalid retention options")`. They add P4-F's private safe `RetentionError` codes `invalid-suggestion-key`, `invalid-invitation-key`, and `invitation-scan-limit`; no listed key or provider value enters the message.

### Three independent bounded scans

One handler invocation samples `nowMs` and `docState()` once, then synchronously starts scans in fixed array order events, suggestions, invitations without awaiting between starts. It awaits all three with `Promise.allSettled()`, so one slow or failing class cannot prevent either other class from beginning and making independent progress. Each calls the same private manual-paginator with its exact global prefix and an independent maximum of ten data pages, 1,000 entries per page, 10,000 keys, and eleven pulls including exhaustion. Prefixes are exactly `events/`, `suggest/`, and `access/`.

P4-F's provider-envelope rules apply identically. Each scan closes its iterator best effort on early failure, retains only projected key strings, rejects duplicate keys within that scan, and never uses automatic all-page collection. After every scan settles, throw the first rejection in fixed events/suggestions/invitations order; do not print the success summary. Other scans are allowed to complete valid deletes before that rejection and no result rolls them back. At most one provider operation is awaited inside each scan, so the handler has at most three concurrent store operations and each class retains its own serial order and budget.

The overall bounded worst case is 33 iterator pulls, 30 page validations, 30,000 short key projections, 10,000 event reads, 10,000 suggestion reads, 250 initial invitation reads plus at most 250 leased re-reads, 100 event deletes, 75 suggestion deletes, and 75 invitation deletes. Event reads may continue after the delete cap only far enough to prove another non-durable candidate, as specified below; suggestion reads stop at the delete cap or exhaustion, and invitation reads use the separate cap below. Concurrent scan start is the exact fairness mechanism: the 30-second platform limit may interrupt the invocation, but no class waits for all reads/deletes of another class before its own first operation, and the next daily invocation starts all three again.

### Durable event exclusions

P4-F first validates every listed event key and parses its ID milliseconds. Before calling `read()` for a pre-cutoff event, check its kind only from the validated stored record—not from metadata or a key, because kind is not in the key. Consequently P4-T reads every pre-cutoff candidate up to P4-F's traversal boundary, validates it with P3-B `assertEvent(record,key)`, then:

- if `event.kind` is in `DURABLE_EVENT_KINDS`, retain it and continue without consuming the 100-delete budget;
- otherwise delete under P4-F's exact strict 540-day policy.

The event walk may read more than 100 retained records but never more than the 10,000 listed-key bound. After the 100th successful delete, continue reading/validating pre-cutoff candidates without deleting until either one non-durable hit proves `remaining: true` or all pre-cutoff candidates are exhausted; this is the one necessary refinement of P4-F's post-cap stop. A null race or retained event is not remaining work. All eight durable kinds survive at 540 days, 24 months, and any later age.

### Suggestion sweep

Parse exact keys:

```text
suggest/<six-lowercase-hex-docId>/<a-plus-eight-lowercase-hex>/<s_base36time_eight-lowercase-hex>.json
```

The complete regular language is `^suggest/([0-9a-f]{6})/(a[0-9a-f]{8})/(s_([0-9a-z]{1,48})_[0-9a-f]{8})\.json$`; capture 4 is the base-36 millisecond text.

Reject any listed key below `suggest/` that cannot be reconstructed exactly through P2-B `suggestionKey(docId,aid,suggestionId)`. Decode the nonempty base-36 timestamp segment manually with safe-integer overflow checks. A parsed suggestion is a candidate only when its ID milliseconds are strictly less than `nowMs - SUGGESTION_RETENTION_MS`.

Walk candidates oldest-first by ID milliseconds then full-key ASCII. Read serially through P2-B `read()`. Skip null races. Every hit must pass `await assertSuggestionAtKey(value, docId, fullKey)` and the validated `at` must parse canonically to exactly the ID milliseconds. Delete at most 75 validated old records. Exact 90-day equality survives; one millisecond older deletes. A suggestion's current effective base, author access, note/text, and computed superseded/open presentation do not change the 90-day decision.

P4-O's own 14-day reaper remains responsible for suggestions it has already proved superseded during an authorized suggestion read/action. P4-T does not fetch edit manifests or compute supersede; it guarantees that an abandoned immutable record cannot remain past the 90-day ceiling.

### Expired invitation sweep

From the complete `access/` listing, select only keys matching:

```text
access/<six-lowercase-hex-docId>/i/<32-lowercase-hex>.json
```

Ignore exact access document/grant keys because P4-T does not own their deletion. Reject a key whose path includes an invitation segment `/i/` but fails the exact invitation grammar; it is corrupt state, not an ignorable grant.

If more than `MAX_INVITATION_RECORDS` (250) exact invitation keys are listed, reject before any invitation read/delete with `RetentionError("invitation-scan-limit")`. Otherwise read all selected keys serially through P2-B `read()`, skip null races, and await `assertAccessInvitationAtKey(value, docId, fullKey)` for every hit. Do not use the synchronous invitation validator alone.

Sort validated invitations by `Date.parse(expiresAt)` then full-key ASCII. For each initially expired candidate until 75 successful deletes, call `withAccessWriteLease({store,doc:docId,nowMs,run})`. `{acquired:false}` records contention, leaves the invitation untouched, sets `remaining:true`, and continues to the next document/key without retry. Inside `run`, strongly re-read the same full key and await `assertAccessInvitationAtKey` again. A null is a completed concurrent removal and needs no delete. A fresh live `expiresAt > now` is a completed renewal and survives. A valid still-expired record that is not byte-equivalent to the initial validator-reconstructed snapshot is concurrent change: leave it, set `remaining:true`, and continue. Only a byte-equivalent still-expired record is deleted while the maintenance lease remains held; P4-J cannot renew it until release. Equality is expired, matching P2-G role resolution. Do not extend/convert an invitation, create a grant, consult identity, or emit an access event. A body/key hash mismatch or invalid timestamp rejects before that record can be deleted.

The invitation result's `remaining` flag is true when the 75-delete cap leaves another initially expired candidate, a compatible lease was busy, or a still-expired candidate changed between initial validation and its leased re-read. Null races and records renewed to a live expiry do not set it. P2-G consumption remains outside the lease, but its valid grant-first conversion can only turn the invitation re-read into `null`; retention then performs no delete and never touches the grant.

### Extended result and log

The scheduled handler returns no HTTP response and logs exactly one line after all scans succeed. `sweepEvents`, `sweepSuggestions`, and `sweepInvitations` return their own exact version-1 summaries. The first has P4-F's `cutoff` plus added `retained`; the second has `cutoff`; the third has `now`. `createRetentionHandler()` composes the following internal value for its one log operation and still resolves `undefined`, as P4-F requires:

```json
{
  "v": 1,
  "events": {"v": 1, "scanned": 200, "candidates": 9, "retained": 3, "deleted": 6, "remaining": false, "cutoff": "2025-03-12T00:00:00.000Z"},
  "suggestions": {"v": 1, "scanned": 30, "candidates": 4, "deleted": 4, "remaining": false, "cutoff": "2026-06-05T00:00:00.000Z"},
  "invitations": {"v": 1, "scanned": 18, "records": 5, "expired": 2, "deleted": 2, "remaining": false, "now": "2026-09-03T00:00:00.000Z"}
}
```

The one log line is:

```text
retention: events=6/3 suggestions=4 invitations=2 remaining=false
```

For events, `scanned`/`candidates`/`deleted` retain P4-F's meanings and `retained` counts validated durable pre-cutoff hits. For suggestions, `scanned` is every unique key below `suggest/`, `candidates` counts pre-cutoff keys actually read including null races, and `remaining` is true only when the delete cap leaves another parsed old key. For invitations, `scanned` is every unique listed `access/` key, `records` is the exact invitation-key count initially read (including null races), `expired` counts initially validated `expiresAt <= now` records, and `remaining` follows the cap/contention/changed-expired rule above rather than arithmetic on `expired` and `deleted`. The event log pair is `deleted/retained`; the final boolean is the OR of all three summaries' `remaining`. No object key, ID, address, actor, document content, environment value, or provider error is logged.

### Deletion and failure semantics

Every delete is one direct `await store.delete(fullKey)` whose success must resolve `undefined`. Invitation delete occurs only inside the acquired maintenance lease after its second validation/equality fence. Any rejection maps to P2-B `StoreError("unavailable",503,"State store unavailable")`; no retry occurs. Validators' own safe errors propagate to the scheduled failure. The handler awaits all three settlements, never catch-and-logs a success line, and throws the fixed-order first failure. Deletes are individually idempotent, but the complete multi-prefix run is not transactional; one class may commit valid deletes while another fails and the next daily run reconciles through list/read null races.

## Files owned

- `netlify/functions/retention.mjs` — **amended**, created by P4-F; P4-T is its only policy amendment owner.

No suggestion/access/event writer, helper schema, package, configuration, browser asset, generated file, workflow, test file, research document, prompt, or other ticket is owned by P4-T.

## Dependencies

- **P4-F:** creates the scheduled function, 540-day event policy, paginator, caps, summary, and provider boundary. P4-T must start from its integrated file.
- **P3-B:** supplies the final 16-kind `assertEvent()` contract whose canonical target shapes make `suggest.create` necessary to retain authorship.
- **P2-B:** supplies the one store, strong `read()`, `suggestionKey()`, event key helpers, and errors.
- **P2-G:** supplies awaited `assertAccessInvitationAtKey()` and the exact `expiresAt <= now` ownership boundary.
- **P4-J:** supplies the shared `withAccessWriteLease()` maintenance boundary and coordinator schema; P4-T must integrate after that export so renewal and retention deletion cannot race.
- **P4-O (#37):** creates suggestion records and must export exact contextual `assertSuggestionAtKey(value,docId,fullKey)`. P4-T may draft against that published contract, but its suggestion-sweep integration/acceptance waits for P4-O.

Maximum safe Phase 4 parallelism: P4-F integrates first; P4-T's amendment authorship is then serialized on `retention.mjs` while P4-O may be authored on its disjoint files. Final P4-T integration waits for both P4-J's lease export and P4-O's validator and must be rebased after them. P2-G/P3-B/P2-B are already integrated predecessors. Do not copy either schema merely to avoid the semantic wait.

## Acceptance criteria

- [ ] All P4-F exports/schedule/bounds survive, and exactly the documented P4-T exports/imports are added.
- [ ] All eight durable kinds, including authorship-bearing `suggest.create`, survive every age; every other old kind follows the original strict 540-day rule.
- [ ] Suggestion equality at 90 days survives and one millisecond older deletes only after exact key/body/time validation; at most 75 delete.
- [ ] Invitations are selected only by exact key grammar, capped at 250 initial reads, asynchronously key-validated, and deleted at `expiresAt <= now`, at most 75, only after a compatible per-document lease and byte-equal second read prove no renewal raced.
- [ ] Access doc/grant records, threads, edits, history, and current source are never deleted.
- [ ] Three scans obey independent finite provider bounds, start without awaiting one another, retain deterministic per-class ordering, allow at most three concurrent store operations, and cannot consume another class's delete budget or prevent it from starting.
- [ ] Failure/corruption/no-transaction behavior is runtime-tested for each prefix and each validator/delete boundary.
- [ ] Exact AST/runtime oracles prove no identity, authorization, manifest, network, environment, retry, timer, worker, route, or `deleteAll` surface.
- [ ] One bounded non-personal success log is emitted only after all scans complete.
- [ ] Repository gates pass and issue #42 points to the pushed, byte-identical canonical spec.

## Test plan

### Source-bound policy and deletion matrix

Run from the repository root after P4-O's validator is integrated:

```bash
perl -e 'alarm shift; exec @ARGV' 30 node --experimental-vm-modules --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const ts=require("./templates/docbuild/node_modules/typescript");
const file="netlify/functions/retention.mjs";
const source=await readFile(file,"utf8");
const sf=ts.createSourceFile(file,source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length,0);
const imports=[];const exports=[];let deleteAll=0,network=0,identity=0,schedule=0,descendantSurface=0;
const visit=(n)=>{if(ts.isImportDeclaration(n))imports.push(n.moduleSpecifier.text);const exported=ts.canHaveModifiers(n)&&ts.getModifiers(n)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);if(exported&&ts.isFunctionDeclaration(n)&&n.name)exports.push(ts.getModifiers(n)?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)?"default":n.name.text);if(exported&&ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name))exports.push(d.name.text);if(ts.isPropertyAssignment(n)&&n.name.getText(sf)==="schedule")schedule++;if(ts.isCallExpression(n)){const x=n.expression.getText(sf);if(x.endsWith(".deleteAll"))deleteAll++;if(/fetch|listen|setTimeout|setInterval/.test(x))network++;if(/identify|resolveRole/.test(x))identity++;if(n.expression.kind===ts.SyntaxKind.ImportKeyword||/(?:^|\.)(?:spawn|spawnSync|exec|execFile|fork)$/.test(x))descendantSurface++;}if(ts.isNewExpression(n)&&/(?:^|\.)(?:Worker|SharedWorker)$/.test(n.expression.getText(sf)))descendantSurface++;ts.forEachChild(n,visit);};visit(sf);
assert.deepEqual(imports.sort(),["../lib/access.mjs","../lib/store.mjs","./access.mjs","./events.mjs","./suggestions.mjs"].sort());
assert.deepEqual(exports.sort(),["DURABLE_EVENT_KINDS","EVENT_RETENTION_MS","MAX_EVENT_DELETES","MAX_INVITATION_DELETES","MAX_INVITATION_RECORDS","MAX_SUGGESTION_DELETES","SUGGESTION_RETENTION_MS","config","createRetentionHandler","default","sweepEvents","sweepInvitations","sweepSuggestions"].sort());
assert.equal(deleteAll+network+identity+descendantSurface,0);assert.equal(schedule,1);

const now=Date.parse("2026-09-03T00:00:00.000Z");
const old=now-46_656_000_000-1;
const actor={sub:"u_fixture",name:"Avery Quill",email:"avery@example.invalid"};
const durable=["suggest.create","suggest.accept","suggest.reject","edit.apply","access.invite","access.change","access.revoke","access.transfer"];
const deleted=[];
const validatorFailure={event:new Error("event validator fixture failure"),suggestion:new Error("suggestion validator fixture failure"),invitation:new Error("invitation validator fixture failure")};
const deleteFailure=new Error("delete fixture failure");
const failValidation={event:false,suggestion:false,invitationCall:0};
let deleteFailurePrefix="",invitationValidationCalls=0,leaseMode="acquire",beforeLeaseRun=null;
const validatedEvents=[];
const storeErrorCalls=[];
const event=(kind,i)=>({v:1,id:`${old}-${String(i).padStart(6,"0")}`,docId:"4b7d2a",ts:new Date(old).toISOString(),actor,kind,target:{},docVersion:kind.startsWith("access.")?null:"7aaca51",summary:"invented audit summary"});
const eventEntries=[...durable,"comment.create"].map((kind,i)=>{const e=event(kind,i+1);return [`events/4b7d2a/${e.ts.slice(0,7)}/${e.id}.json`,e];});
const pagesByPrefix={"events/":eventEntries,"suggest/":[],"access/":[]};
const records=new Map(eventEntries);
const validatedSuggestions=[];const validatedInvitations=[];
const leasedDocs=[];
const store={list({prefix,paginate}){assert.equal(paginate,true);return(async function*(){yield{blobs:(pagesByPrefix[prefix]??[]).map(([key])=>({key}))};})();},async delete(k){if(deleteFailurePrefix&&k.startsWith(deleteFailurePrefix))throw deleteFailure;deleted.push(k);records.delete(k);}};
const context=vm.createContext({console,Date,Error,Map,Object,Promise,Response,Set,TextEncoder,TypeError,URL});
const mod=new vm.SourceTextModule(source,{context,identifier:file});
await mod.link(async(specifier)=>{
 if(specifier==="../lib/store.mjs")return new vm.SyntheticModule(["StoreError","docState","eventKey","read","suggestionKey"],function(){class StoreError extends Error{constructor(...args){super(args[0]);storeErrorCalls.push(args);}};this.setExport("StoreError",StoreError);this.setExport("docState",()=>store);this.setExport("eventKey",(d,t,i)=>`events/${d}/${t.slice(0,7)}/${i}.json`);this.setExport("suggestionKey",(d,a,i)=>`suggest/${d}/${a}/${i}.json`);this.setExport("read",async(s,k)=>records.get(k)??null);},{context});
 if(specifier==="./events.mjs")return new vm.SyntheticModule(["assertEvent"],function(){this.setExport("assertEvent",(v,k)=>{validatedEvents.push(k);if(failValidation.event)throw validatorFailure.event;return structuredClone(v);});},{context});
 if(specifier==="./suggestions.mjs")return new vm.SyntheticModule(["assertSuggestionAtKey"],function(){this.setExport("assertSuggestionAtKey",async(v,d,k)=>{validatedSuggestions.push([d,k]);if(failValidation.suggestion)throw validatorFailure.suggestion;assert.equal(v.docId,d);return structuredClone(v);});},{context});
 if(specifier==="../lib/access.mjs")return new vm.SyntheticModule(["assertAccessInvitationAtKey"],function(){this.setExport("assertAccessInvitationAtKey",async(v,d,k)=>{invitationValidationCalls++;validatedInvitations.push([d,k]);if(failValidation.invitationCall===invitationValidationCalls)throw validatorFailure.invitation;assert.equal(v.docId,d);return structuredClone(v);});},{context});
 if(specifier==="./access.mjs")return new vm.SyntheticModule(["withAccessWriteLease"],function(){this.setExport("withAccessWriteLease",async(options)=>{assert.deepEqual(Object.keys(options).sort(),["doc","nowMs","run","store"]);const{store:s,doc,nowMs,run}=options;assert.equal(s,store);assert.equal(nowMs,now);leasedDocs.push(doc);if(leaseMode==="busy")return{acquired:false};if(beforeLeaseRun){const fn=beforeLeaseRun;beforeLeaseRun=null;await fn();}return{acquired:true,value:await run()};});},{context});
 throw new Error(`unexpected import ${specifier}`);
});
await mod.evaluate();
const deadline=setTimeout(()=>{console.error("FAIL  P4-T fixture exceeded 30 seconds");process.exit(124);},30_000);
assert.deepEqual([...mod.namespace.DURABLE_EVENT_KINDS],durable);
const result=await mod.namespace.sweepEvents({store,nowMs:now});
assert.equal(result.retained,8);assert.equal(result.deleted,1);
assert.equal(deleted.length,1);assert.match(deleted[0],/000009\.json$/);
assert.deepEqual(validatedEvents,eventEntries.map(([key])=>key));

deleted.length=0;
const suggestionTimes=[now-7_776_000_000-1,now-7_776_000_000,now-7_776_000_000+1];
const suggestionEntries=suggestionTimes.map((ms,i)=>{
 const id=`s_${ms.toString(36)}_${String(i+1).padStart(8,"0")}`;
 const key=`suggest/4b7d2a/a3f19c2b7/${id}.json`;
 return [key,{v:1,id,docId:"4b7d2a",aid:"a3f19c2b7",at:new Date(ms).toISOString()}];
});
pagesByPrefix["suggest/"]=suggestionEntries;
for(const pair of suggestionEntries)records.set(...pair);
const suggestions=await mod.namespace.sweepSuggestions({store,nowMs:now});
assert.deepEqual({candidates:suggestions.candidates,deleted:suggestions.deleted,remaining:suggestions.remaining},{candidates:1,deleted:1,remaining:false});
assert.equal(validatedSuggestions.length,1);assert.deepEqual(deleted,[suggestionEntries[0][0]]);

deleted.length=0;
const invitationEntries=[
 ["access/4b7d2a/i/00000000000000000000000000000001.json",{v:1,docId:"4b7d2a",expiresAt:new Date(now-1).toISOString()}],
 ["access/4b7d2a/i/00000000000000000000000000000002.json",{v:1,docId:"4b7d2a",expiresAt:new Date(now).toISOString()}],
 ["access/4b7d2a/i/00000000000000000000000000000003.json",{v:1,docId:"4b7d2a",expiresAt:new Date(now+1).toISOString()}],
];
pagesByPrefix["access/"]=[
 ...invitationEntries,
 ["access/4b7d2a/doc.json",{v:1}],
 ["access/4b7d2a/g/u_fixture.json",{v:1}],
];
for(const pair of invitationEntries)records.set(...pair);
const invitations=await mod.namespace.sweepInvitations({store,nowMs:now});
assert.deepEqual({records:invitations.records,expired:invitations.expired,deleted:invitations.deleted,remaining:invitations.remaining},{records:3,expired:2,deleted:2,remaining:false});
assert.deepEqual(validatedSuggestions,[["4b7d2a",suggestionEntries[0][0]]]);
assert.deepEqual(validatedInvitations,[
 ["4b7d2a",invitationEntries[0][0]],["4b7d2a",invitationEntries[1][0]],["4b7d2a",invitationEntries[2][0]],
 ["4b7d2a",invitationEntries[0][0]],["4b7d2a",invitationEntries[1][0]],
]);
assert.deepEqual(leasedDocs,["4b7d2a","4b7d2a"]);assert.deepEqual(deleted,invitationEntries.slice(0,2).map(([key])=>key));

records.clear();deleted.length=0;
const cappedSuggestions=Array.from({length:76},(_,i)=>{
 const ms=now-7_776_000_000-1-i;const id=`s_${ms.toString(36)}_${i.toString(16).padStart(8,"0")}`;
 return [`suggest/4b7d2a/a3f19c2b7/${id}.json`,{v:1,id,docId:"4b7d2a",aid:"a3f19c2b7",at:new Date(ms).toISOString()}];
});
pagesByPrefix["suggest/"]=cappedSuggestions;for(const pair of cappedSuggestions)records.set(...pair);
const capped=await mod.namespace.sweepSuggestions({store,nowMs:now});
assert.equal(capped.deleted,75);assert.equal(capped.remaining,true);assert.equal(deleted.length,75);assert.equal(records.size,1);

const tooManyInvites=Array.from({length:251},(_,i)=>[`access/4b7d2a/i/${i.toString(16).padStart(32,"0")}.json`,{v:1}]);
pagesByPrefix["access/"]=tooManyInvites;
await assert.rejects(()=>mod.namespace.sweepInvitations({store,nowMs:now}));
pagesByPrefix["access/"]=[["access/4b7d2a/i/not-a-hash.json",{v:1}]];
await assert.rejects(()=>mod.namespace.sweepInvitations({store,nowMs:now}));

const pageOverflow={...store,list(){return(async function*(){yield{blobs:Array.from({length:1001},(_,i)=>({key:`suggest/4b7d2a/a3f19c2b7/s_${(now+i).toString(36)}_${i.toString(16).padStart(8,"0")}.json`}))};})();}};
await assert.rejects(()=>mod.namespace.sweepSuggestions({store:pageOverflow,nowMs:now}));
const pageCountOverflow={...store,list(){return(async function*(){for(let i=0;i<11;i++)yield{blobs:[]};})();}};
await assert.rejects(()=>mod.namespace.sweepSuggestions({store:pageCountOverflow,nowMs:now}));

const raceKey="access/4b7d2a/i/00000000000000000000000000000004.json";
const expiredRace={v:1,docId:"4b7d2a",role:"viewer",expiresAt:new Date(now-1).toISOString()};
const installRace=(value=expiredRace)=>{records.clear();deleted.length=0;pagesByPrefix["access/"]=[[raceKey,value]];records.set(raceKey,value);};
installRace();leaseMode="busy";
const busy=await mod.namespace.sweepInvitations({store,nowMs:now});
assert.deepEqual({deleted:busy.deleted,remaining:busy.remaining},{deleted:0,remaining:true});assert.deepEqual(deleted,[]);

installRace();leaseMode="acquire";
beforeLeaseRun=()=>records.set(raceKey,{...expiredRace,expiresAt:new Date(now+1).toISOString()});
const renewed=await mod.namespace.sweepInvitations({store,nowMs:now});
assert.deepEqual({deleted:renewed.deleted,remaining:renewed.remaining},{deleted:0,remaining:false});assert.deepEqual(deleted,[]);

installRace();beforeLeaseRun=()=>records.set(raceKey,{...expiredRace,role:"editor"});
const changed=await mod.namespace.sweepInvitations({store,nowMs:now});
assert.deepEqual({deleted:changed.deleted,remaining:changed.remaining},{deleted:0,remaining:true});assert.deepEqual(deleted,[]);

installRace();beforeLeaseRun=()=>records.delete(raceKey);
const consumed=await mod.namespace.sweepInvitations({store,nowMs:now});
assert.deepEqual({deleted:consumed.deleted,remaining:consumed.remaining},{deleted:0,remaining:false});assert.deepEqual(deleted,[]);

const ordinaryEvent=event("comment.create",91);const ordinaryEventKey=`events/4b7d2a/${ordinaryEvent.ts.slice(0,7)}/${ordinaryEvent.id}.json`;
records.clear();deleted.length=0;pagesByPrefix["events/"]=[[ordinaryEventKey,ordinaryEvent]];records.set(ordinaryEventKey,ordinaryEvent);failValidation.event=true;
await assert.rejects(()=>mod.namespace.sweepEvents({store,nowMs:now}),error=>error===validatorFailure.event);assert.deepEqual(deleted,[]);failValidation.event=false;

const oldSuggestion=suggestionEntries[0];records.clear();deleted.length=0;pagesByPrefix["suggest/"]=[oldSuggestion];records.set(...oldSuggestion);failValidation.suggestion=true;
await assert.rejects(()=>mod.namespace.sweepSuggestions({store,nowMs:now}),error=>error===validatorFailure.suggestion);assert.deepEqual(deleted,[]);failValidation.suggestion=false;

installRace();failValidation.invitationCall=invitationValidationCalls+1;
await assert.rejects(()=>mod.namespace.sweepInvitations({store,nowMs:now}),error=>error===validatorFailure.invitation);assert.deepEqual(deleted,[]);
installRace();failValidation.invitationCall=invitationValidationCalls+2;
await assert.rejects(()=>mod.namespace.sweepInvitations({store,nowMs:now}),error=>error===validatorFailure.invitation);assert.deepEqual(deleted,[]);failValidation.invitationCall=0;

const expectDeleteFailure=async(run)=>{const before=storeErrorCalls.length;await assert.rejects(run);assert.equal(storeErrorCalls.length,before+1);assert.deepEqual(storeErrorCalls.at(-1),["unavailable",503,"State store unavailable"]);};
records.clear();deleted.length=0;pagesByPrefix["events/"]=[[ordinaryEventKey,ordinaryEvent]];records.set(ordinaryEventKey,ordinaryEvent);deleteFailurePrefix="events/";
await expectDeleteFailure(()=>mod.namespace.sweepEvents({store,nowMs:now}));assert.deepEqual(deleted,[]);
records.clear();pagesByPrefix["suggest/"]=[oldSuggestion];records.set(...oldSuggestion);deleteFailurePrefix="suggest/";
await expectDeleteFailure(()=>mod.namespace.sweepSuggestions({store,nowMs:now}));assert.deepEqual(deleted,[]);
installRace();deleteFailurePrefix="access/";
await expectDeleteFailure(()=>mod.namespace.sweepInvitations({store,nowMs:now}));assert.deepEqual(deleted,[]);deleteFailurePrefix="";

records.clear();deleted.length=0;pagesByPrefix["events/"]=[[ordinaryEventKey,ordinaryEvent]];pagesByPrefix["suggest/"]=[oldSuggestion];pagesByPrefix["access/"]=[];records.set(ordinaryEventKey,ordinaryEvent);records.set(...oldSuggestion);failValidation.event=true;failValidation.suggestion=true;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const gates={"events/":deferred(),"suggest/":deferred(),"access/":deferred()};const starts=[];const fairLog=[];
const fairStore={list({prefix,paginate}){assert.equal(paginate,true);starts.push(prefix);return(async function*(){await gates[prefix].promise;yield{blobs:pagesByPrefix[prefix].map(([key])=>({key}))};})();},async delete(){throw new Error("unexpected fair-store delete");}};
const fairRun=mod.namespace.createRetentionHandler({storeFn:()=>fairStore,nowFn:()=>now,logFn:(line)=>fairLog.push(line)})(new Request("https://fixture.invalid/ignored"));
let fairSettled=false;fairRun.then(()=>{fairSettled=true;},()=>{fairSettled=true;});
await Promise.resolve();assert.deepEqual(starts,["events/","suggest/","access/"]);
gates["events/"].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(fairSettled,false);
gates["suggest/"].resolve();gates["access/"].resolve();
await assert.rejects(()=>fairRun,error=>error===validatorFailure.event);assert.deepEqual(fairLog,[]);failValidation.event=false;failValidation.suggestion=false;

records.clear();deleted.length=0;pagesByPrefix["events/"]=[];pagesByPrefix["suggest/"]=[];pagesByPrefix["access/"]=[];
const log=[];const run=mod.namespace.createRetentionHandler({storeFn:()=>store,nowFn:()=>now,logFn:(line)=>log.push(line)});
assert.equal(await run(new Request("https://fixture.invalid/ignored")),undefined);
assert.deepEqual(log,["retention: events=0/0 suggestions=0 invitations=0 remaining=false"]);
clearTimeout(deadline);
console.log("PASS  P4-T retention policy matrix");
NODE
```

Expected: exit `0`, no stderr/network, and exactly `PASS  P4-T retention policy matrix`. The outer Perl alarm replaces itself with the sole Node process and terminates that process after 30 seconds; the exact-import oracle rules out a spawned production descendant. The finite matrix proves all eight named durable exclusions against one ordinary old event; suggestion cutoff equality and ±1 ms plus the 75/76 cap; invitation live/equality/expired behavior, doc/grant ignore, the 250/251 cap, malformed `/i/` rejection, busy lease, live renewal, changed-still-expired snapshot, and concurrent consumption; 1,001-entry and eleventh-page rejection; exact propagation at the event, suggestion, initial-invitation, and leased-reread validator boundaries; exact store-error mapping at all three delete boundaries; fixed-order concurrent scan start; all-settled rejection timing/precedence; no failure log; and the exact empty-run log. Every contextual validator's observed document/key argument is asserted, and the maintenance fake asserts the exact store/document/time/options boundary. The fixture makes no claim over unenumerated provider values or P3-B/P2-G/P4-O validator behavior already owned by those predecessors.

### Repository and pointer gates

```bash
scripts/scrub-check.sh docs/tickets/P4-T.md netlify/functions/retention.mjs
templates/check-dist
npm --prefix templates/docbuild run check
git diff --check
issue_json="$(gh issue view 42 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-T.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-T — Retention exclusions and the suggestion sweep"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-T repository and pointer gates'
```

Expected after push/update: every command exits `0`; final output is `PASS  P4-T repository and pointer gates`.

## Failure modes

| Failure | Required behavior |
|---|---|
| Old durable event | Validate and retain; it consumes no delete budget. |
| Old ordinary event | Delete under preserved P4-F policy/cap. |
| Suggestion exactly 90 days old | Retain; only strictly older records delete. |
| Invitation expires exactly now | Delete only after compatible lease acquisition and a byte-equal second awaited key/body validation. |
| Access doc/grant key | Ignore without read/delete. |
| Malformed suggestion or invitation-like key | Reject as corrupt; never guess/reconstruct loosely. |
| More than 250 invitation records | Reject before invitation read/delete; operator must reduce/repair or revise the measured bound. |
| Provider/validator/delete rejection | Await every scan settlement, then reject with the first failure in fixed class order; no success log/retry; other committed deletes remain. |
| Invitation lease busy or renewed after initial read | Skip without delete; set `remaining` only for busy or still-expired changed state, not for a live renewal. |
| One scan fails | Other already-started scans may finish bounded work; their deletes remain and the next daily run safely re-lists. |
| 30-second platform termination | Per-class caps bound work; next published daily run is idempotent over remaining keys. |

## Settled decisions

- `suggest.create`, accept/reject decisions, Mode A apply, and all four access changes are durable audit facts and never age out.
- Other event kinds remain on the fixed 540-day policy.
- Open suggestion blobs have a strict 90-day ceiling; P4-O's 14-day proven-supersede cleanup remains separate.
- Invitations expire at `expiresAt <= now`; retention deletes but never converts them.
- Body-to-key validation is mandatory before arbitrary listed suggestion/invitation deletion.
- Three concurrently started, internally serial bounded scans and three budgets are used; there is no global unbounded walk, stored cursor, or bulk delete.
- P4-T is the last owner of `retention.mjs` in this Build Order.

## Assumptions and open questions

- **Reconciliation:** The ruling-plan row lists seven retained kinds but P3-B's final target no longer embeds suggestion author identity in accept/reject. This ticket retains `suggest.create` as the authorship record, following the parent's explicit “decision/authorship/access” requirement. A reviewer should treat removal of `suggest.create` as data loss, not simplification.
- P4-O must expose exact `assertSuggestionAtKey`; this is a required cross-ticket contract, not permission to duplicate its schema. If its final file/export differs, reconcile both canonical tickets before implementation.
- The 250 invitation-record and 75-per-class delete bounds are operational assumptions chosen for the 30-second scheduled limit. Exceeding them fails visibly; measured production latency may justify a separate bound-change ticket.
- The 90-day window is a product judgment recorded by research, not measured behavior. It is settled for this ticket.
- No remaining question blocks implementation once P4-O publishes its validator.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.5, 2.4, and 4.7 — record layout, access audit durability, event kinds, P4-F→P4-T amendment, and suggestion sweep.
- `docs/research/08-suggestions-and-editing-model.md` §§5, 6, 9.3, and 15 — immutable suggestion record, timestamp, authorship loss, retained decisions/apply, 14/90-day roles, and same-file sequencing.
- `docs/research/09-sharing-and-roles.md` §§4 and 8 — invitation shape/expiry and permanent access audit requirement.
- `docs/tickets/P2-B.md` — strong store, read/key builders, and direct-delete boundary.
- `docs/tickets/P2-G.md` — exact invitation validator and explicit P4-T expired-invitation ownership.
- `docs/tickets/P3-B.md` — final event kinds/targets and P4-T durable-kind boundary.
- `docs/tickets/P4-F.md` — created scheduled function and preserved baseline bounds.
- `docs/tickets/P4-O.md` — suggestion record/contextual validator dependency once created.
- [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/) — official daily schedule and 30-second execution limit; checked 2026-09-03.
- [Netlify Blobs API](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — official manual pagination, 1,000-entry pages, direct delete, and custom expiry; checked 2026-09-03.
- GitHub issue #42 — tracker pointer only; the canonical specification is this document.
