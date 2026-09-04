# P4-H — The server fan-out

## Outcome

P4-D's `notify()` helper becomes the sole server fan-out point: one caller invocation schedules the applicable Slack notification and/or one best-effort Ably durable-change projection, with realtime payloads limited to IDs and a hash and never document text.

## Context

P4-D creates an optional Slack sink and P2-F creates an optional Ably publisher. Durable write handlers must not learn two provider APIs or schedule them independently, because ordering, degradation, and privacy would drift. This amendment composes the sinks in the one existing helper. Slack may receive short human-readable excerpts under P4-D; Ably receives only reload hints whose durable state remains authoritative.

## Scope

### In scope

- Amend only `netlify/lib/notify.mjs` after P4-D.
- Import P2-F `publish()` exactly once and call it only from `notify()`'s scheduled fan-out.
- Preserve every P4-D export, four input variants, Slack message, configuration, timeout, and provider-failure behavior, with the one explicit validation-order amendment below.
- Add the exact `edit.saved` input variant needed by the edit apply path.
- Project thread create/reply to `{t:"thread.changed", threadId}` and edit save to `{t:"edit.saved", aid, hash}`.
- Schedule Slack and realtime promises independently through the same helper so either sink may fail without affecting the other or the durable response.
- Prove structurally and at runtime that no comment, quote, suggestion, actor, email, name, URL, slug, path, proposed text, or decision text reaches `publish()`.

### Out of scope

- Changing P2-F's event union, channel, REST request, token endpoint, provider configuration, or best-effort semantics.
- Adding realtime events for suggestion creation/decision. The ruling transport treats suggestions as asynchronous; Slack and refresh/409 are sufficient.
- Editing any thread, suggestion, edit, client, store, access, identity, template, configuration, package, or generated file.
- Presence, heartbeats, bye, claims/releases, client-channel messages, polling, SSE attachment, browser refresh, retries, queues, delivery guarantees, or persistence.
- Awaiting either sink before the durable handler returns.

## Interface contract

### Preserved P4-D surface

`netlify/lib/notify.mjs` remains an ESM module with exactly `createNotifier` and `notify` exports and retains P4-D's `node:util/types` `isProxy` import. P4-H adds one static import:

```js
import { publish } from "./realtime.mjs"
```

`createNotifier(dependencies = {})` extends its exact dependency keys with optional `publishFn` and otherwise retains P4-D's `envGet`, `fetchFn`, and `timeoutSignalFn`. The production default is the imported `publish`. No dependency may be selected from request/event data.

The returned `notify(context, notification)` still returns a synchronous boolean: `true` when at least one applicable promise is accepted by `context.waitUntil`, otherwise `false`. It never returns or awaits a provider result. A configured Slack sink is independent from configured realtime: `SLACK_WEBHOOK_URL` absence does not suppress Ably, and `ABLY_API_KEY` absence is handled inside P2-F `publish()` as `null` without suppressing Slack.

P4-H necessarily supersedes P4-D's disabled-Slack prevalidation shortcut: validate the context and complete five-variant notification union before selecting sinks, even when Slack is blank. The helper cannot safely discover whether a Slack-disabled input needs realtime without inspecting it. Therefore a malformed input now throws `TypeError("Invalid notification")` regardless of provider configuration; a valid Slack-disabled suggestion still schedules nothing and returns `false`. This is the only P4-D validation-order change.

P4-D's exact platform-context predicate and receiver semantics otherwise remain unchanged: Proxy rejection precedes reflection, the `waitUntil` accessor and unrelated context accessors are never invoked, extra platform fields remain ignored, and an accepted promise is registered by calling `context.waitUntil(promise)` with the validated context as receiver. P4-H applies that predicate before sink selection even when Slack is disabled.

### Complete fan-out matrix

P4-H retains P4-D's four variants and adds one exact closed variant:

```js
{ t: "edit.saved", docId, aid, hash }
```

`hash` matches `^[0-9a-f]{64}$`; other fields retain P4-D grammars. The complete matrix is exact:

| Input | Slack promise | Realtime promise |
|---|---:|---:|
| `thread.created` | P4-D exact message | `publish(docId, {t:"thread.changed", threadId})` |
| `thread.replied` | P4-D exact message | `publish(docId, {t:"thread.changed", threadId})` |
| `suggest.created` | P4-D exact message | none |
| `suggest.decided` (`accepted` or `rejected`) | P4-D exact message | none |
| `edit.saved` | none | `publish(docId, {t:"edit.saved", aid, hash})` |

There is no default fan-out. Unknown kinds fail P4-D's configured-input validation. A suggestion is never coerced into `thread.changed`; an edit is never sent to Slack merely because the helper has a Slack sink.

### Scheduling, ordering, and isolation

Validate the closed notification before projecting or scheduling. Build each provider promise inside a separate synchronous `try` boundary and pass it to `context.waitUntil()` separately. Call order is Slack first, realtime second when both apply. P4-D's Slack work is already a non-rejecting guarded promise. Require the P2-F `publishFn(docId,event)` result to be non-null with callable `then` and `catch`; an injected synchronous non-promise result is a swallowed sink failure and is never registered. Pass the original valid promise directly to `waitUntil`, as P2-F requires; attach a rejection observer to that same promise only to prevent an unhandled rejection if an injected test double violates P2-F's valid-input no-rejection contract. The observer does not change the original promise's identity or settlement: the exact promise returned by `publishFn` is the one registered, and an injected rejection remains a rejection observable by `waitUntil`. Do not replace the promise with `Promise.resolve(...)`, `.then(...)`, or `.catch(...)` output. A synchronous sink call failure or synchronous `waitUntil` failure is swallowed for that sink and does not stop the other sink.

For a thread input with configured Slack, call `context.waitUntil()` exactly twice. For suggestion input with configured Slack, exactly once. For `edit.saved`, exactly once. With Slack disabled, thread input still schedules realtime once, suggestion input schedules nothing and returns `false`, and edit schedules realtime once. P2-F decides whether its promise ultimately yields a publish result or `null`; P4-H does not read `ABLY_API_KEY`, retry, inspect, log, or reinterpret that result.

Return `true` if at least one `waitUntil` call returns normally. Return `false` only if no sink applies or every applicable `waitUntil` call throws. This return remains diagnostic and must not affect a durable HTTP response.

### Text-free realtime projection

The value passed to `publishFn` is newly constructed, ordinary, and contains exactly:

```json
{"t":"thread.changed","threadId":"t_m8x2k1_4f7a9c31"}
```

or:

```json
{"t":"edit.saved","aid":"a3f19c2b7","hash":"8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277"}
```

It never passes the original notification object by reference. The projection contains no `docId` because P2-F receives document identity as its first argument. It contains no text, body, quote, proposed/rejected words, actor/name/email, outcome, URL, slug, section, path, version, role, or arbitrary copied key. “Never text” is proved by exact-object equality at the injected `publishFn` boundary, not by searching only for selected property spellings.

### Caller boundary

P4-H owns fan-out logic, not caller files. The later/parallel call-site tickets must call only `notify(context, exactInput)` after their authoritative write succeeds:

- P4-M (#35): thread create and reply call the thread variants; resolve/reopen do not notify or publish because the P2-F public union defines only a generic changed hint and the original notification requirement covers comment activity.
- P4-N (#36): the direct edit handler calls `edit.saved` once only after the receipt/content write is durable and supplies the authoritative effective hash. Its shared `applyText()` seam does not itself notify, which prevents duplicate publication when P4-O consumes it.
- P4-O (#37): create calls `suggest.created`; reject calls `suggest.decided`; accept calls `suggest.decided` first and then `edit.saved` with P4-N's authoritative applied hash after both apply and decision durability. Thus accepted suggestion intentionally makes two semantic `notify()` calls: one Slack-only decision and one realtime-only saved-edit projection.

Callers never import `publish`, never call `context.waitUntil` for Slack/Ably, never send a text-bearing realtime object, and never roll back/alter a state response after `notify` failure. Source authoring of those tickets remains parallel because their files are disjoint; integration into each already-owned handler is serialized by that handler's owner.

### Provider truth

P2-F remains the authority for the Ably request: server channel `doc:<docId>:server`, one REST message, exact 201 acknowledgement, two accepted event variants, two-second timeout, no retry, provider failures resolved to `null`, and no key in a URL/body/log. Ably's official REST API supports server-side `POST /channels/{channelId}/messages` with JSON `name` and `data`; P4-H does not widen that provider boundary.

Netlify's official `waitUntil()` contract allows response sending before the promise finishes but still counts extended work against the function limit. Therefore each sink remains bounded by its predecessor's timeout and is scheduled only after durability.

## Files owned

- `netlify/lib/notify.mjs` — **amended**, created by P4-D; P4-H is the only ticket allowed to add the realtime sink and complete fan-out.

No caller, realtime helper, template/client asset, package, configuration, generated file, permanent test file, research document, prompt, or ticket file outside this canonical spec is owned by P4-H.

## Dependencies

- **P4-D:** must be integrated first because it creates the only file and fixes the Slack/export/input contract P4-H preserves.
- **P2-F:** supplies exact `publish(docId,event)` validation, server channel, timeout, acknowledgement, secret, and best-effort result.
- **P3-F:** supplies the browser's server-channel interpretation of `thread.changed`/`edit.saved` and the `doc:event` refresh bus; P4-H must not publish another shape the client cannot route.

The authoritative table omits P4-B from P4-H's direct file dependencies, and this helper does not edit `edit.mjs`. P4-N, which owns the final apply path after P4-B, consumes the completed helper. P4-M and P4-O consume it from their own files. Thus the maximum safe Phase 4 waves are: integrate P4-D; amend it with P4-H while disjoint handler owners proceed; then each handler owner wires its own call after its own durability checks. Never run P4-D and P4-H concurrently.

## Acceptance criteria

- [ ] Only P4-D's file is amended; exports stay exact, the sole new production import is P2-F `publish`, and the one Slack-disabled validation-order amendment is implemented explicitly.
- [ ] The five-row matrix is exhaustive and runtime-tested in every Slack-on/off and sink synchronous/async failure combination.
- [ ] Thread inputs create an exact fresh `thread.changed` object; edit input creates an exact fresh `edit.saved` object; suggestion inputs make zero publish calls.
- [ ] The injected publish observer inspects the original projection object before any clone/normalization, recursively records its exact own keys/descriptors/prototypes, proves a fresh object reference for every call, and proves no original notification object or text-bearing value crosses the boundary.
- [ ] Each applicable promise gets its own `waitUntil`; synchronous/asynchronous failure of either sink cannot prevent scheduling the other or affect the durable response.
- [ ] `waitUntil` receives the exact original realtime promise after a side rejection observer is attached; an injected rejection remains rejected and observable rather than becoming a resolving wrapper.
- [ ] The P4-H amendment does not read Ably environment/provider response state, retry, log, persist, open a connection, or directly invoke a handler; P4-D's Slack environment reads remain unchanged.
- [ ] AST proof rejects direct `publish` imports/calls outside `notify.mjs` across the final integration, except the defining import in `realtime.mjs`; call-site tickets import only `notify`.
- [ ] The source-bound fixture terminates under a 30-second supervisor deadline and reports exact call ordering/counts.
- [ ] Repository gates pass and issue #30 points by full commit permalink to byte-identical canonical bytes.

## Test plan

### Exact projection and isolation fixture

Run from the repository root after P4-H implementation:

```bash
perl -e 'alarm shift; exec @ARGV' 30 node --experimental-vm-modules --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const ts=require("./templates/docbuild/node_modules/typescript");
const file="netlify/lib/notify.mjs";
const source=await readFile(file,"utf8");
const sf=ts.createSourceFile(file,source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length,0);
const imports=[];let publishCalls=0,consoleCalls=0,descendantSurface=0;
const visit=(n)=>{if(ts.isImportDeclaration(n)) imports.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)){const x=n.expression.getText(sf);if(x==="publish"||x==="publishFn")publishCalls++;if(x.startsWith("console."))consoleCalls++;if(n.expression.kind===ts.SyntaxKind.ImportKeyword||/(?:^|\.)(?:spawn|spawnSync|exec|execFile|fork)$/.test(x))descendantSurface++;}if(ts.isNewExpression(n)&&/(?:^|\.)(?:Worker|SharedWorker)$/.test(n.expression.getText(sf)))descendantSurface++;ts.forEachChild(n,visit);};visit(sf);
assert.deepEqual(imports.sort(),["./realtime.mjs","node:util/types"].sort());
assert.equal(publishCalls,1);
assert.equal(consoleCalls,0);
assert.equal(descendantSurface,0);

const published=[];
const context=vm.createContext({AbortSignal,Promise,Response,TextDecoder,TextEncoder,TypeError,URL,console,fetch:async()=>{throw new Error("default fetch must not run in fixture");}});
const mod=new vm.SourceTextModule(source,{context,identifier:file});
await mod.link(async(specifier)=>{
 if(specifier==="node:util/types")return new vm.SyntheticModule(["isProxy"],function(){this.setExport("isProxy",()=>false);},{context});
 if(specifier==="./realtime.mjs")return new vm.SyntheticModule(["publish"],function(){this.setExport("publish",async(docId,event)=>{published.push({docId,event});return null;});},{context});
 throw new Error(`unexpected import ${specifier}`);
});
await mod.evaluate();
const createNotifier=mod.namespace.createNotifier;
const vmObjectPrototype=vm.runInContext("Object.prototype",context);
const ordinary=(entries={})=>Object.assign(vm.runInContext("({})",context),entries);
const projectionReferences=new Set();
let activeNotification;
const inspectGraph=(value)=>{
 if(value===null||typeof value!=="object")return {kind:"primitive",type:value===null?"null":typeof value,value};
 assert.equal(Object.getPrototypeOf(value),vmObjectPrototype,"projection objects must use the module realm's Object.prototype");
 const keys=Reflect.ownKeys(value);
 return {kind:"object",prototype:"Object.prototype",keys,descriptors:keys.map((key)=>{
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   assert.equal("value" in descriptor,true,"projection properties must be data properties");
   return {key,enumerable:descriptor.enumerable,writable:descriptor.writable,configurable:descriptor.configurable,kind:"data",value:inspectGraph(descriptor.value)};
 })};
};
const inspectPublication=(docId,event)=>{
 assert.notEqual(event,activeNotification,"projection must not reuse the notification object");
 assert.equal(projectionReferences.has(event),false,"every publish call must receive a fresh projection object");
 projectionReferences.add(event);
 return {docId,graph:inspectGraph(event)};
};
const expectedGraph=(entries)=>({kind:"object",prototype:"Object.prototype",keys:Object.keys(entries),descriptors:Object.entries(entries).map(([key,value])=>({key,enumerable:true,writable:true,configurable:true,kind:"data",value:{kind:"primitive",type:typeof value,value}}))});
const deadline=setTimeout(()=>{console.error("FAIL  P4-H fixture exceeded 30 seconds");process.exit(124);},30_000);
const hook="https://hooks.slack.com/services/T00000000/B00000000/INVENTEDTOKEN";
const envGet=(k)=>k==="SLACK_WEBHOOK_URL"?hook:"https://docs.example.invalid";
const waits=[];const fetches=[];
const notify=createNotifier(ordinary({envGet,timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async(url,init)=>{fetches.push({url,init});return new Response("ok");},publishFn:async(docId,event)=>{published.push(inspectPublication(docId,event));return null;}}));
const ctx=ordinary({waitUntil(p){waits.push(p);}});
const thread=ordinary({t:"thread.created",docId:"4b7d2a",threadId:"t_m8x2k1_4f7a9c31",actorName:"Avery Quill",threadKind:"comment",body:"Private invented words",quote:"An invented quote"});
activeNotification=thread;
assert.equal(notify(ctx,thread),true);
assert.equal(waits.length,2);
await Promise.all(waits.splice(0));
assert.equal(fetches.length,1);
assert.deepEqual(published.shift(),{docId:"4b7d2a",graph:expectedGraph({t:"thread.changed",threadId:"t_m8x2k1_4f7a9c31"})});
const hash="8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277";
const edit=ordinary({t:"edit.saved",docId:"4b7d2a",aid:"a3f19c2b7",hash});
activeNotification=edit;
assert.equal(notify(ctx,edit),true);
assert.equal(waits.length,1);await waits.pop();
assert.deepEqual(published.shift(),{docId:"4b7d2a",graph:expectedGraph({t:"edit.saved",aid:"a3f19c2b7",hash})});
for(const suggestion of [
 ordinary({t:"suggest.created",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",actorName:"Morgan Reed",text:"Use a bounded cache."}),
 ordinary({t:"suggest.decided",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",authorName:"Morgan Reed",deciderName:"Avery Quill",outcome:"accepted"}),
]) {activeNotification=suggestion;assert.equal(notify(ctx,suggestion),true);await waits.pop();}
assert.equal(published.length,0);
assert.equal(fetches.length,3);

const disabledWaits=[];const disabledPublished=[];
const disabled=createNotifier(ordinary({envGet:()=>"",timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async()=>{throw new Error("Slack must stay disabled");},publishFn:async(docId,event)=>{disabledPublished.push(inspectPublication(docId,event));return null;}}));
activeNotification=thread;
assert.equal(disabled(ordinary({waitUntil(p){disabledWaits.push(p);}}),thread),true);
assert.equal(disabledWaits.length,1);await disabledWaits.pop();
assert.deepEqual(disabledPublished,[{docId:"4b7d2a",graph:expectedGraph({t:"thread.changed",threadId:"t_m8x2k1_4f7a9c31"})}]);
assert.equal(disabled(ordinary({waitUntil(){throw new Error("must not schedule");}}),ordinary({t:"suggest.created",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",actorName:"Morgan Reed",text:"Use a bounded cache."})),false);

let rejected,originalRealtimePromise;
const rejecting=createNotifier(ordinary({envGet:()=>"",timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async()=>new Response("ok"),publishFn:()=>{originalRealtimePromise=Promise.reject(new Error("invented realtime rejection"));return originalRealtimePromise;}}));
assert.equal(rejecting(ordinary({waitUntil(p){rejected=p;}}),ordinary({t:"edit.saved",docId:"4b7d2a",aid:"a3f19c2b7",hash})),true);
assert.equal(rejected,originalRealtimePromise,"waitUntil must receive the original realtime promise");
await assert.rejects(rejected,/invented realtime rejection/);
const throwing=createNotifier(ordinary({envGet:()=>"",timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async()=>new Response("ok"),publishFn(){throw new Error("invented synchronous failure");}}));
assert.equal(throwing(ordinary({waitUntil(){throw new Error("must not register");}}),ordinary({t:"edit.saved",docId:"4b7d2a",aid:"a3f19c2b7",hash})),false);
const nonPromise=createNotifier(ordinary({envGet:()=>"",timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async()=>new Response("ok"),publishFn:()=>null}));
assert.equal(nonPromise(ordinary({waitUntil(){throw new Error("must not register");}}),ordinary({t:"edit.saved",docId:"4b7d2a",aid:"a3f19c2b7",hash})),false);

let attemptedWaits=0;
const both=createNotifier(ordinary({envGet,timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async()=>{throw new Error("invented Slack failure");},publishFn:async()=>null}));
assert.equal(both(ordinary({waitUntil(){attemptedWaits++;throw new Error("invented registration failure");}}),thread),false);
assert.equal(attemptedWaits,2);
assert.throws(()=>disabled(ordinary({waitUntil(){}}),ordinary({t:"edit.saved",docId:"4b7d2a",aid:"a3f19c2b7",hash:"bad"})),{name:"TypeError",message:"Invalid notification"});
clearTimeout(deadline);
console.log("PASS  P4-H exact fan-out projections");
NODE
```

Expected: exit `0`, no stderr/network, exactly `PASS  P4-H exact fan-out projections`. The outer Perl alarm replaces itself with the sole Node process and terminates that process after 30 seconds; the exact-import oracle rules out a spawned production descendant. The finite matrix inspects each original projection before normalization and proves exact recursive prototype/key/descriptor/value structure, fresh reference identity, exact thread/edit projections, zero suggestion publication, Slack-disabled independence, publish resolution, original-promise rejection identity, synchronous throw, non-promise refusal, Slack rejection, both `waitUntil` registrations throwing, and invalid edit-hash rejection.

### Final integration AST and repository gate

```bash
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const files=execFileSync("git",["ls-files","netlify/**/*.mjs"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
for(const file of files){
  const source=readFileSync(file,"utf8");
  const importsRealtime=/from\s+["'][^"']*realtime\.mjs["']/.test(source);
  const callsPublish=/\bpublish\s*\(/.test(source);
  const callsInjectedPublish=/\bpublishFn\s*\(/.test(source);
  if(file==="netlify/lib/realtime.mjs") continue;
  if(file==="netlify/lib/notify.mjs"){assert(importsRealtime&&callsInjectedPublish&&!callsPublish);continue;}
  assert.equal(importsRealtime||callsPublish||callsInjectedPublish,false,`${file}: bypasses sole fan-out`);
}
console.log("PASS  P4-H sole server fan-out import boundary");
NODE
scripts/scrub-check.sh docs/tickets/P4-H.md netlify/lib/notify.mjs
templates/check-dist
npm --prefix templates/docbuild run check
git diff --check
issue_json="$(gh issue view 30 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-H.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-H — The server fan-out"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-H integration, repository, and pointer gates'
```

Expected after all caller tickets and pointer update: the two exact PASS lines print, every command exits `0`, and no handler imports/calls P2-F directly. The regex is only a repository-wide tripwire; exact projection and module semantics are proved by the VM/AST fixture above.

## Failure modes

| Failure | Required behavior |
|---|---|
| Slack disabled | Realtime still schedules for thread/edit; suggestion schedules nothing. |
| Realtime disabled/provider down | P2-F resolves null; Slack and durable response are unchanged. |
| One sink throws/rejects | Slack's guarded provider promise resolves `false`. A production P2-F realtime promise resolves a result or `null`; if an injected realtime promise rejects, the same registered promise remains rejected but has a side rejection observer. Synchronous sink throws are swallowed, and the other sink is still attempted. |
| One `waitUntil` call throws | Attempt the other applicable sink and return according to accepted calls. |
| Notification contains text-bearing values | Slack may use P4-D bounds; realtime receives only a new exact projection. |
| Suggestion event | Slack only; no unsupported P2-F publish. |
| Durable write fails/no-ops | Owning handler does not call the helper. |
| Caller bypasses helper | Final integration gate fails; caller owner removes direct provider scheduling. |

## Settled decisions

- `notify.mjs` is the one fan-out point; server handlers do not know Slack/Ably separately.
- Slack and realtime are independent, optional, one-attempt, post-durability sinks.
- Realtime carries `thread.changed` IDs or `edit.saved` ID/hash only, never text or identity.
- Suggestion lifecycle inputs use Slack and refresh/conflict behavior, not a new suggestion realtime event in v1; an accepted suggestion separately emits the existing text-free `edit.saved` projection for its durable content change.
- There is no cross-provider transaction, retry, delivery guarantee, or state rollback.
- Presence/client events remain on the client channel and never pass through this helper.

## Assumptions and open questions

- P4-M notifies on create/reply only; resolve/reopen remain audit/state changes without Slack because the original notification contract names new/reply activity. If product wants resolution notification, that is a new explicit variant rather than overloading `thread.changed`.
- P4-N owns the direct-edit call site and the shared `applyText()` result that supplies the effective post-write hash to P4-O's accepted-suggestion call site. P4-H does not infer a hash or read an edit record.
- A separate `waitUntil` per sink is chosen so synchronous rejection in one registration cannot suppress the other; both remain within the parent function's execution limit.
- No question blocks P4-H. Adding suggestion realtime requires first widening P2-F and P3-F contracts in a separate decision.

## References

- `docs/research/00-integration-plan.md` §§1.6 and 4.7 — optional Ably, one fan-out point, server IDs/hashes only, and P4-D→P4-H serialization.
- `docs/research/07-realtime-and-presence.md` §§7–12 — server event names, privacy, degradation, and client routing.
- `docs/research/08-suggestions-and-editing-model.md` §11 — suggestions are asynchronous; Slack/refresh is the fallback and no delivery guarantee is needed.
- `docs/tickets/P2-F.md` — exact publisher event, channel, provider, timeout, error, and secret contract.
- `docs/tickets/P3-F.md` — exact server-channel client message validation and `doc:event` behavior.
- `docs/tickets/P4-D.md` — created file, Slack contract, and later call-site ownership.
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/#waituntil) — official response-nonblocking `waitUntil()` semantics and execution-limit inclusion; checked 2026-09-03.
- [Ably REST API](https://ably.com/docs/api/rest-api#channel-publish) — official server-side channel publish route and JSON message `name`/`data` contract; checked 2026-09-03.
- GitHub issue #30 — tracker pointer only; the canonical specification is this document.
