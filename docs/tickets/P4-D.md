# P4-D — The Slack webhook

## Outcome

The repository has one optional, server-only Slack incoming-webhook helper that schedules bounded best-effort notifications for new comments, replies, new suggestions, and suggestion decisions without delaying or changing the durable write response.

## Context

Readers who do not reopen a document need one low-cost signal that discussion or a proposed change needs attention. The ruling product deliberately rejects email, subscriptions, digests, and unread server state; one incoming webhook is the complete external notification surface. This ticket creates the shared notification boundary only. Tickets that own durable write handlers call it after their state transition succeeds.

## Scope

### In scope

- Create `netlify/lib/notify.mjs` with the exact exports, event union, Slack payloads, secret handling, timeout, and scheduling behavior below.
- Read `SLACK_WEBHOOK_URL` and `URL` only at call time through `Netlify.env.get` in production.
- Treat an absent or blank webhook URL as the normal disabled state.
- Send exactly one JSON `{text}` payload for each supported notification through `context.waitUntil()`.
- Support both comment notifications and the suggestion-create/accept/reject notifications that are the author's only out-of-document decision signal.
- Escape Slack control characters, normalize line breaks, and truncate user-controlled text before interpolation.
- Swallow every provider/configuration failure after the durable write and emit no secret, body, URL, identity, or provider log.

### Out of scope

- Editing `threads.mjs`, `thread.mjs`, `suggestions.mjs`, `suggestion.mjs`, `edit.mjs`, or any browser file. P4-M and P4-O own the call sites.
- Realtime publication. P4-H amends this file after P4-D and adds the only realtime sink.
- Email, direct messages, per-user subscriptions, digests, retries, queues, delivery receipts, Block Kit, attachments, interactive Slack actions, or message deletion.
- Accepting a webhook URL, site URL, actor, document path, slug, or notification kind from an HTTP request.
- Adding dependencies, configuration files, committed environment files, tests, fixtures, or another notification module.

## Interface contract

### Module surface

`netlify/lib/notify.mjs` is an ECMAScript module with exactly these exports:

```text
import { isProxy } from "node:util/types"

export function createNotifier(dependencies = {})
export const notify = createNotifier()
```

The `isProxy` import is the sole production import and is required to reject a Proxy before any reflective operation can trigger its traps.

`createNotifier()` accepts an optional exact ordinary object containing only `envGet`, `fetchFn`, and `timeoutSignalFn`. Each supplied value is a function. Production defaults are `(name) => Netlify.env.get(name)`, `globalThis.fetch`, and `(ms) => AbortSignal.timeout(ms)`. Unknown keys, accessors, symbols, arrays, null, a custom prototype, or non-functions throw `TypeError("Invalid notify dependencies")` without reading the environment or starting network work.

The returned function has this exact signature:

```text
/**
 * @param {{waitUntil(promise: Promise<unknown>): void}} context
 * @param {Notification} notification
 * @returns {boolean} true only when one bounded Slack promise was accepted by waitUntil
 */
function notify(context, notification)
```

`context` is a non-null, non-array ordinary object with prototype exactly `Object.prototype` and an own `waitUntil` data property whose value is a function. The `waitUntil` property's enumerable, writable, and configurable flags are immaterial. The platform context may carry arbitrary additional own string or symbol properties, including accessors; accept and ignore them without enumerating, reading, or describing them. Reject a Proxy with `isProxy(context)` before `Object.getPrototypeOf` or the sole `Object.getOwnPropertyDescriptor(context, "waitUntil")` inspection; reject inherited `waitUntil`, custom or null prototypes, a `waitUntil` accessor, and a non-function value without invoking an accessor or Proxy trap. Invoke the accepted method as `context.waitUntil(promise)`, not as an extracted function, so its receiver is the original validated context object.

The four P4-D input variants are closed ordinary objects with exactly these keys:

```text
{ t: "thread.created", docId, threadId, actorName, threadKind, body, quote }
{ t: "thread.replied", docId, threadId, actorName, body, quote }
{ t: "suggest.created", docId, suggestionId, aid, actorName, text }
{ t: "suggest.decided", docId, suggestionId, aid, authorName, deciderName, outcome }
```

Required grammars and bounds:

| Field | Exact rule |
|---|---|
| `docId` | `^[0-9a-f]{6}$` |
| `threadId` | `^t_[0-9a-z]+_[0-9a-f]{8}$` |
| `suggestionId` | `^s_[0-9a-z]+_[0-9a-f]{8}$` |
| `aid` | `^a[0-9a-f]{8}$` |
| `actorName`, `authorName`, `deciderName` | server-derived string, 0–200 UTF-16 code units, no lone surrogate or C0/C1 control except CR/LF/TAB before normalization |
| `threadKind` | exactly `comment` or `discussion` |
| `body`, `text` | string, at most 8,000 and 4,000 Unicode scalar values respectively; no lone surrogate or C0/C1 control except CR/LF/TAB |
| `quote` | `null` or a string of at most 8,000 Unicode scalar values with the same control rule |
| `outcome` | exactly `accepted` or `rejected` |

Notification validation rejects proxies before reflection and requires `Object.prototype`, exact own enumerable/writable/configurable data properties, and no symbols. It never invokes an accessor. When Slack is configured, an invalid context or notification throws `TypeError("Invalid notification")` before a timeout or fetch. When Slack is disabled, `notify()` returns `false` before inspecting `context` or `notification`, matching the optional-provider behavior of P2-F.

### Configuration and secret boundary

Read `SLACK_WEBHOOK_URL` first. Missing, empty, whitespace-only, non-string, or malformed values disable this call and return `false`. A usable value must be an absolute HTTPS URL with hostname exactly `hooks.slack.com`, no username, password, query, or fragment, and a pathname matching `/services/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+`. Never trim a nonblank configured URL into validity. The webhook URL is a secret: it never enters a message, returned value, error, cause, log, test output, or Ably event.

After input validation, read `URL` once. It must be an absolute HTTPS origin with pathname exactly `/` and no username, password, query, or fragment. Serialize the origin without a terminal slash before adding `/d/...`. A missing or malformed `URL` is a best-effort notification failure: schedule nothing and return `false`; it never changes the durable write result.

Configure both variables for the Functions scope, not Builds. No `doc.json` field, build flag, alternate environment name, or per-document client value exists.

### Exact Slack text

Before interpolation, convert CRLF and CR to LF, TAB to one space, all other permitted whitespace runs to one ASCII space within each line, trim each line, remove empty edge lines, and escape `&`, `<`, and `>` as `&amp;`, `&lt;`, and `&gt;`. Apply scalar-value truncation after normalization and before escaping: names 80, comment bodies 400, quotes 140, and suggestion text 400. Truncation appends the single character `…` and the final value never exceeds its stated scalar limit. Replace an empty normalized actor/author/decider name with exact invented presentation label `Someone`; empty names are valid in predecessor identity records and must not turn a successful durable write into a notification exception.

Use the permanent document URL, never a slug or instance path:

```text
<URL>/d/<docId>
```

Construct exactly one of these messages, with no trailing newline:

```text
*<actorName>* commented on <<thread-url>|document <docId>>
> <quote>
<body>
```

```text
*<actorName>* started a discussion on <<thread-url>|document <docId>>
<body>
```

```text
*<actorName>* replied on <<thread-url>|document <docId>>
> <quote>
<body>
```

```text
*<actorName>* proposed a change on <<suggestion-url>|document <docId>>
> <text>
```

```text
*<deciderName>* <accepted|rejected> *<authorName>*'s suggestion on <<suggestion-url>|document <docId>>
```

Omit the quote line when `quote === null` or its normalized value is empty. For `thread.created`, choose “started a discussion” only when `threadKind === "discussion"`; otherwise choose “commented on”. Empty normalized bodies/text remain valid and cause the body/quoted-text line to be omitted. The JSON body is a new exact ordinary object with sole key `text`.

### Scheduling and provider behavior

Create `AbortSignal.timeout(2_000)` once and start exactly one fetch:

```http
POST <SLACK_WEBHOOK_URL>
Content-Type: application/json
Accept: text/plain

{"text":"<exact message>"}
```

The scheduled promise accepts only status `200` with response text exactly `ok`; it cancels an unread response body on every other status, bounds a 200 response body to 16 bytes, and always releases an acquired reader. Status mismatch, oversized/malformed body, timeout, fetch rejection, body-read rejection, or configuration failure resolves the scheduled promise to `false`. It never retries and never rejects.

Call `context.waitUntil(promise)` exactly once. Catch a synchronous `waitUntil` throw and return `false`; attach a rejection sink before that call so the provider promise can never become unhandled. Return `true` only when `waitUntil` returns normally. Never `await` the provider promise in a write handler. Netlify documents that `waitUntil()` extends execution for a promise without blocking the client response, while the extended work still counts toward the function execution limit.

### Downstream call-site contract

P4-D does not own any caller file. The exact later integrations are:

- P4-M (#35), after a successful authoritative thread create/reply and its audit attempt, calls `notify(context, ...)` once with `thread.created` or `thread.replied`. Status no-ops never notify.
- P4-O (#37), after a successful immutable suggestion create, calls once with `suggest.created`; after reject, once with `suggest.decided`; after accept, it calls `suggest.decided` and, once P4-H is integrated, separately calls `edit.saved` with the authoritative applied hash. Withdraw/supersede do not notify.
- Each call passes server-derived actors and durable records, not request-body actor fields. Notification failure never rolls back state, changes status, or replaces the response.
- P4-H later amends this one function to add realtime projection. Most durable actions make one `notify()` call, while accepted suggestion is the explicit two-call exception because it represents both a decision and a saved edit. No caller calls P2-F `publish()` directly.

## Files owned

- `netlify/lib/notify.mjs` — **new**, created exclusively by P4-D and later amended only by P4-H.

No handler, browser asset, package, configuration, generated file, workflow, research document, prompt, or other ticket is owned by P4-D. `docs/tickets/P4-D.md` is this specification, not implementation source.

## Dependencies

- **P1-C:** supplies the Node 22 / Functions v2 runtime in which `Netlify.env`, `fetch`, `AbortSignal.timeout`, and Fetch `Response` exist.
- **P3-A:** supplies the canonical thread/comment ID, actor, body, quote, discussion, and durable-write contracts that the downstream P4-M caller projects into this helper.
- **P4-O contract dependency, integration only:** P4-D can be authored and tested before P4-O, but the suggestion call-site acceptance waits for P4-O (#37), which owns both suggestion handlers and their server-derived records.

Maximum safe source parallelism is one agent on `notify.mjs`. P4-D may run alongside every Phase 4 ticket whose implementation file is disjoint. P4-H must start from the integrated P4-D file and is never parallel with it. P4-M and P4-O may consume the published interface from their separately owned handlers; they must not amend `notify.mjs`.

## Acceptance criteria

- [ ] `notify.mjs` has exactly the two documented exports, only the documented built-in `isProxy` import, and no package dependency, persistent state, timer loop, queue, retry, logging, or alternate notification surface.
- [ ] Disabled configuration returns `false` before context/input inspection and performs no timeout, URL-base read, `waitUntil`, or fetch.
- [ ] Every accepted variant produces the exact normalized, escaped, truncated text and permanent-ID URL; the finite schema matrix rejects every property-level missing/type/descriptor case and every extra/grammar/prototype/symbol/Proxy class without invoking accessors or Proxy traps.
- [ ] A configured call enforces the exact open platform-context predicate, ignores extra string/symbol/accessor properties, accepts every `waitUntil` data-descriptor flag combination, invokes it with the original context as receiver, and rejects context proxy/`waitUntil`-accessor/prototype/missing/type classes before timeout or fetch.
- [ ] Suggestion creation and both accept/reject decisions are first-class input variants; there is no email fallback and no claim that Slack reaches an author who does not read the configured channel.
- [ ] A configured call creates one 2,000 ms signal, one exact POST, and one `waitUntil` call, returns before provider completion, and never exposes the secret.
- [ ] Only exact HTTP 200 plus exact body `ok` resolves the scheduled work `true`; every enumerated provider/body failure resolves it `false` without retry, rejection, log, or effect on the durable response.
- [ ] The AST gate proves the exact import/export surface and one syntactic fetch/`waitUntil` call site with no console or descendant surface; the injected runtime observer proves one pending provider promise is registered before it settles and no URL/secret enters the payload.
- [ ] Downstream boundaries name P4-M for thread calls, P4-O for suggestion calls, and P4-H for the same-file realtime amendment; P4-D edits none of those files.
- [ ] Repository build/type/dist/privacy gates pass without changing generated output.
- [ ] Issue #27 keeps its exact title and exact two-paragraph commit-permalink pointer; `git show` at that full SHA is byte-identical to this document.

## Test plan

### Deterministic module, AST, and provider fixture

Run from the repository root after P4-D is implemented:

```bash
perl -e 'alarm shift; exec @ARGV' 30 node --experimental-vm-modules --input-type=module <<'NODE'
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createRequire} from "node:module";
import {isProxy} from "node:util/types";

const require = createRequire(import.meta.url);
const ts = require("./templates/docbuild/node_modules/typescript");
const file = "netlify/lib/notify.mjs";
const source = await readFile(file, "utf8");
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
assert.equal(sf.parseDiagnostics.length, 0);
const exports = [];
const imports = [];
let waitUntilCalls = 0, fetchCalls = 0, consoleCalls = 0, descendantSurface = 0;
const visit = (n) => {
  if (ts.isImportDeclaration(n)) imports.push(n.moduleSpecifier.text);
  if (ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    if (ts.isFunctionDeclaration(n) && n.name) exports.push(n.name.text);
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.push(d.name.text);
  }
  if (ts.isCallExpression(n)) {
    const text = n.expression.getText(sf);
    if (n.expression.kind === ts.SyntaxKind.ImportKeyword || /(?:^|\.)(?:spawn|spawnSync|exec|execFile|fork)$/.test(text)) descendantSurface++;
    if (text.endsWith(".waitUntil")) waitUntilCalls++;
    if (text === "fetch" || text.endsWith(".fetch")) fetchCalls++;
    if (text.startsWith("console.")) consoleCalls++;
  }
  if (ts.isNewExpression(n) && /(?:^|\.)(?:Worker|SharedWorker)$/.test(n.expression.getText(sf))) descendantSurface++;
  ts.forEachChild(n, visit);
};
visit(sf);
assert.deepEqual(imports, ["node:util/types"]);
assert.deepEqual(exports.sort(), ["createNotifier", "notify"]);
assert.equal(waitUntilCalls, 1);
assert.equal(fetchCalls, 1);
assert.equal(consoleCalls, 0);
assert.equal(descendantSurface, 0);

const context = vm.createContext({
  AbortSignal,
  TextDecoder,
  TextEncoder,
  TypeError,
  URL,
  fetch: async()=>{ throw new Error("default fetch must not run in fixture"); },
  console: new Proxy({}, {get(){ consoleCalls++; throw new Error("console forbidden"); }}),
});
const mod = new vm.SourceTextModule(source, {context, identifier: file});
await mod.link(async(specifier) => {
  if (specifier !== "node:util/types") throw new Error(`unexpected import ${specifier}`);
  return new vm.SyntheticModule(["isProxy"], function(){ this.setExport("isProxy", isProxy); }, {context});
});
await mod.evaluate();
assert.deepEqual(Object.keys(mod.namespace).sort(), ["createNotifier", "notify"]);

const createNotifier = mod.namespace.createNotifier;
const ordinary = (entries={}) => Object.assign(vm.runInContext("({})", context), entries);
const withValue = (value, key, replacement) => { const copy=ordinary(value); copy[key]=replacement; return copy; };
const deadline = setTimeout(() => { console.error("FAIL  P4-D fixture exceeded 30 seconds"); process.exit(124); }, 30_000);
const goodHook = "https://hooks.slack.com/services/T00000000/B00000000/INVENTEDTOKEN";
const base = "https://docs.example.invalid/";
const calls = [];
let resolveFetch;
const pending = new Promise((resolve) => { resolveFetch = resolve; });
const notifier = createNotifier(ordinary({
  envGet(name) { return name === "SLACK_WEBHOOK_URL" ? goodHook : base; },
  timeoutSignalFn(ms) { assert.equal(ms, 2000); return AbortSignal.abort("fixture"); },
  fetchFn(url, init) { calls.push({url, init}); return pending; },
}));
const scheduled = [];
const acceptedContext = ordinary({waitUntil(p){ assert.equal(this, acceptedContext); scheduled.push(p); }});
const threadCreated = ordinary({
  t: "thread.created", docId: "4b7d2a", threadId: "t_m8x2k1_4f7a9c31",
  actorName: "Avery <Quill>", threadKind: "comment",
  body: "Please check & confirm.", quote: "A cache miss never blocks the build",
});
const accepted = notifier(acceptedContext, threadCreated);
assert.equal(accepted, true);
assert.equal(calls.length, 1);
assert.equal(scheduled.length, 1);
assert.equal(calls[0].url, goodHook);
assert.equal(calls[0].init.method, "POST");
assert.deepEqual(JSON.parse(calls[0].init.body), {text:
  "*Avery &lt;Quill&gt;* commented on <https://docs.example.invalid/d/4b7d2a|document 4b7d2a>\n> A cache miss never blocks the build\nPlease check &amp; confirm."
});
let settled = false;
scheduled[0].then(() => { settled = true; });
await Promise.resolve();
assert.equal(settled, false, "notify must return before provider completion");
const encoder = new TextEncoder();
const trackedResponse = (status, chunks, {readError=false, cancelError=false}={}) => {
  const lifecycle = {acquired:0, reads:0, released:0, cancelled:0};
  let index = 0;
  return {lifecycle, response:{
    status,
    body:{
      async cancel(){ lifecycle.cancelled++; if(cancelError) throw new Error("invented cancel failure"); },
      getReader(){
        lifecycle.acquired++;
        return {
          async read(){
            lifecycle.reads++;
            if(readError) throw new Error("invented read failure");
            return index < chunks.length ? {done:false,value:chunks[index++]} : {done:true,value:undefined};
          },
          releaseLock(){ lifecycle.released++; },
        };
      },
    },
  }};
};
const initialSuccess = trackedResponse(200, [encoder.encode("ok")]);
resolveFetch(initialSuccess.response);
assert.equal(await scheduled[0], true);
assert.deepEqual(initialSuccess.lifecycle,{acquired:1,reads:2,released:1,cancelled:0});

const variants = [
  ordinary({t:"thread.replied",docId:"4b7d2a",threadId:"t_m8x2k1_4f7a9c31",actorName:"Morgan Reed",body:"I checked it.",quote:null}),
  ordinary({t:"suggest.created",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",actorName:"Morgan Reed",text:"Use a bounded cache."}),
  ordinary({t:"suggest.decided",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",authorName:"Morgan Reed",deciderName:"Avery Quill",outcome:"accepted"}),
  ordinary({t:"suggest.decided",docId:"4b7d2a",suggestionId:"s_m8x2k1_4f7a9c31",aid:"a3f19c2b7",authorName:"Morgan Reed",deciderName:"Avery Quill",outcome:"rejected"}),
];
const expectedTexts = [
  "*Morgan Reed* replied on <https://docs.example.invalid/d/4b7d2a|document 4b7d2a>\nI checked it.",
  "*Morgan Reed* proposed a change on <https://docs.example.invalid/d/4b7d2a|document 4b7d2a>\n> Use a bounded cache.",
  "*Avery Quill* accepted *Morgan Reed*'s suggestion on <https://docs.example.invalid/d/4b7d2a|document 4b7d2a>",
  "*Avery Quill* rejected *Morgan Reed*'s suggestion on <https://docs.example.invalid/d/4b7d2a|document 4b7d2a>",
];
for (const [index,item] of variants.entries()) {
  let held;
  let sent;
  const n = createNotifier(ordinary({envGet:(k)=>k==="SLACK_WEBHOOK_URL"?goodHook:base,timeoutSignalFn:()=>AbortSignal.abort(),fetchFn:async(_url,init)=>{sent=JSON.parse(init.body);return new Response("ok");}}));
  assert.equal(n(ordinary({waitUntil(p){held=p;}}), item), true);
  assert.equal(await held, true);
  assert.deepEqual(sent,{text:expectedTexts[index]});
}

let touched = 0;
const off = createNotifier(ordinary({envGet(){return "   ";},fetchFn(){touched++;},timeoutSignalFn(){touched++;}}));
assert.equal(off(new Proxy({}, {get(){touched++;}}), new Proxy({}, {get(){touched++;}})), false);
assert.equal(touched, 0);

const non200 = trackedResponse(400, [], {cancelError:true});
const wrong200 = trackedResponse(200, [encoder.encode("okay")]);
const oversized200 = trackedResponse(200, [encoder.encode("0123456789abcdefx")]);
const readFailure200 = trackedResponse(200, [], {readError:true});
const failures = [
  {fetchFn:async()=>non200.response, lifecycle:non200.lifecycle, expected:{acquired:0,reads:0,released:0,cancelled:1}},
  {fetchFn:async()=>wrong200.response, lifecycle:wrong200.lifecycle, expected:{acquired:1,reads:2,released:1,cancelled:0}},
  {fetchFn:async()=>oversized200.response, lifecycle:oversized200.lifecycle, expected:{acquired:1,reads:1,released:1,cancelled:0}},
  {fetchFn:async()=>readFailure200.response, lifecycle:readFailure200.lifecycle, expected:{acquired:1,reads:1,released:1,cancelled:0}},
  {fetchFn:async()=>{throw new Error("provider secret-like detail");}},
];
for (const {fetchFn,lifecycle,expected} of failures) {
  let held;
  const n = createNotifier(ordinary({envGet:(k)=>k==="SLACK_WEBHOOK_URL"?goodHook:base,timeoutSignalFn:()=>AbortSignal.abort(),fetchFn}));
  assert.equal(n(ordinary({waitUntil(p){held=p;}}), variants[0]), true);
  assert.equal(await held, false);
  if(lifecycle) assert.deepEqual(lifecycle,expected);
}

let validationBaseReads=0,validationTimeouts=0,validationFetches=0,validationWaits=0,accessorReads=0,proxyTraps=0;
const configured=createNotifier(ordinary({
 envGet:(k)=>{if(k==="SLACK_WEBHOOK_URL")return goodHook;validationBaseReads++;return base;},
 timeoutSignalFn:()=>{validationTimeouts++;return AbortSignal.abort();},
 fetchFn:async()=>{validationFetches++;return new Response("ok");},
}));
const validVariants=[threadCreated,...variants];
const goodContext=()=>ordinary({waitUntil(){validationWaits++;}});
const assertBadNotification=(bad)=>assert.throws(()=>configured(goodContext(),bad),{name:"TypeError",message:"Invalid notification"});
for(const valid of validVariants){
  for(const field of Object.keys(valid)){
    const missing=ordinary(valid);delete missing[field];assertBadNotification(missing);
    assertBadNotification(withValue(valid,field,field==="quote"?0:null));
    for(const change of [{enumerable:false},{writable:false},{configurable:false}]){
      const bad=ordinary(valid);const descriptor=Object.getOwnPropertyDescriptor(bad,field);
      Object.defineProperty(bad,field,{...descriptor,...change});assertBadNotification(bad);
    }
    const accessor=ordinary(valid);
    Object.defineProperty(accessor,field,{enumerable:true,configurable:true,get(){accessorReads++;throw new Error("getter invoked");}});
    assertBadNotification(accessor);
  }
  assertBadNotification(ordinary({...valid,extra:true}));
  const symbolic=ordinary(valid);symbolic[Symbol("extra")]=true;assertBadNotification(symbolic);
  assertBadNotification(Object.assign(Object.create(null),valid));
  assertBadNotification(Object.assign(Object.create({}),valid));
  assertBadNotification(new Proxy(valid,{ownKeys(){proxyTraps++;throw new Error("proxy trap invoked");},getPrototypeOf(){proxyTraps++;throw new Error("proxy trap invoked");},getOwnPropertyDescriptor(){proxyTraps++;throw new Error("proxy trap invoked");}}));
}
const grammarCases=[
  withValue(variants[0],"docId","ABC123"), withValue(variants[0],"docId","abc12"),
  withValue(variants[0],"threadId","t_bad"), withValue(variants[1],"suggestionId","s_bad"),
  withValue(variants[1],"aid","aBAD00000"), withValue(threadCreated,"threadKind","note"),
  withValue(threadCreated,"actorName","x".repeat(201)), withValue(threadCreated,"actorName","bad\u0000name"), withValue(threadCreated,"actorName","bad\u0080name"), withValue(threadCreated,"actorName","bad\ud800name"),
  withValue(variants[2],"authorName","bad\u0000name"), withValue(variants[2],"deciderName","bad\ud800name"),
  withValue(threadCreated,"body","x".repeat(8001)), withValue(threadCreated,"body","bad\u0000body"), withValue(threadCreated,"body","bad\ud800body"),
  withValue(threadCreated,"quote","x".repeat(8001)), withValue(threadCreated,"quote","bad\u0000quote"), withValue(threadCreated,"quote","bad\ud800quote"),
  withValue(variants[1],"text","x".repeat(4001)), withValue(variants[1],"text","bad\u0000text"), withValue(variants[1],"text","bad\ud800text"),
  withValue(variants[2],"outcome","withdrawn"), withValue(variants[0],"t","unknown"),
];
for(const bad of grammarCases) assertBadNotification(bad);
assert.equal(accessorReads,0);
assert.equal(proxyTraps,0);
assert.deepEqual({validationBaseReads,validationTimeouts,validationFetches,validationWaits},{validationBaseReads:0,validationTimeouts:0,validationFetches:0,validationWaits:0});

const validNotification=variants[0];
const assertBadContext=(bad)=>assert.throws(()=>configured(bad,validNotification),{name:"TypeError",message:"Invalid notification"});
assertBadContext(null);assertBadContext([]);assertBadContext(ordinary());
assertBadContext(Object.assign(Object.create(null),{waitUntil(){}}));
assertBadContext(Object.create({waitUntil(){}}));
assertBadContext(ordinary({waitUntil:null}));
const accessorContext=ordinary();
Object.defineProperty(accessorContext,"waitUntil",{enumerable:true,configurable:true,get(){accessorReads++;throw new Error("getter invoked");}});
assertBadContext(accessorContext);
assertBadContext(new Proxy(ordinary({waitUntil(){}}),{ownKeys(){proxyTraps++;throw new Error("proxy trap invoked");},getPrototypeOf(){proxyTraps++;throw new Error("proxy trap invoked");},getOwnPropertyDescriptor(){proxyTraps++;throw new Error("proxy trap invoked");}}));
assert.equal(accessorReads,0);assert.equal(proxyTraps,0);
assert.deepEqual({validationBaseReads,validationTimeouts,validationFetches,validationWaits},{validationBaseReads:0,validationTimeouts:0,validationFetches:0,validationWaits:0});
const acceptedWaits=[];
const makeAcceptedContext=(decorate=()=>{})=>{
  let value;
  value=ordinary({waitUntil(p){assert.equal(this,value);validationWaits++;acceptedWaits.push(p);}});
  decorate(value);
  return value;
};
const extraContext=makeAcceptedContext((value)=>{value.extra=true;});
const symbolContext=makeAcceptedContext((value)=>{value[Symbol("platform")]=true;});
const unrelatedAccessorContext=makeAcceptedContext((value)=>Object.defineProperty(value,"ignored",{enumerable:true,configurable:true,get(){accessorReads++;throw new Error("unrelated accessor invoked");}}));
const descriptorContexts=[];
for(const enumerable of [false,true])for(const writable of [false,true])for(const configurable of [false,true]){
  descriptorContexts.push(makeAcceptedContext((value)=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,"waitUntil");
    Object.defineProperty(value,"waitUntil",{...descriptor,enumerable,writable,configurable});
  }));
}
for(const validContext of [extraContext,symbolContext,unrelatedAccessorContext,...descriptorContexts]) assert.equal(configured(validContext,validNotification),true);
assert.equal(accessorReads,0,"unrelated context accessors must remain unobserved");
await Promise.all(acceptedWaits);
let runtimeWaitCalls=0;
const receiverContext=ordinary({waitUntil(){assert.equal(this,receiverContext);runtimeWaitCalls++;throw new Error("invented waitUntil failure");}});
assert.equal(configured(receiverContext,variants[0]),false);
assert.equal(runtimeWaitCalls,1);
assert.equal(consoleCalls, 0);
clearTimeout(deadline);
console.log("PASS  P4-D notifier contract");
NODE
```

Expected: exit `0`, no stderr, no network request, and exactly `PASS  P4-D notifier contract`. The outer Perl alarm replaces itself with the sole Node process and terminates that process after 30 seconds; the exact-import oracle rules out a spawned production descendant. The held-promise assertion proves scheduling is observable before the provider completes. The finite matrix covers all four accepted shapes and both decisions; disabled configuration; non-200 cancellation; success, wrong-body, oversized-body, and read-failure reader release; fetch rejection; synchronous `waitUntil` failure and receiver identity; every notification property-level missing/type/descriptor case; and each notification extra-field, grammar, prototype, accessor, symbol, and Proxy rejection class. The context matrix proves missing/type/prototype/accessor/Proxy rejection, accepts ignored extra string/symbol/accessor fields and all `waitUntil` data-descriptor flags, and leaves Proxy traps and accessors uninvoked. It makes no universal claim over unenumerated JavaScript values.

### Repository and pointer gates

```bash
scripts/scrub-check.sh docs/tickets/P4-D.md netlify/lib/notify.mjs
templates/check-dist
npm --prefix templates/docbuild run check
git diff --check
issue_json="$(gh issue view 27 --repo aiur-team/architecture-docs --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue=JSON.parse(process.env.ISSUE_JSON);
const path="docs/tickets/P4-D.md";
const match=/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if(issue.title!=="P4-D — The Slack webhook"||!match||match[1]!==path||match[3]!==path)process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P4-D repository and pointer gates'
```

Expected after the phase commit is pushed and issue #27 is updated: every command exits `0`; dist/type/scrub/diff checks report no failure; final output is `PASS  P4-D repository and pointer gates`.

## Failure modes

| Failure | Required behavior |
|---|---|
| Webhook URL absent/blank/malformed or base `URL` malformed | Return `false`; no input inspection beyond configuration, timeout, fetch, or `waitUntil` as applicable. |
| Context or notification object malformed | Configured call throws exact safe `TypeError` before timeout/fetch; durable caller treats this as an implementation defect, not a provider error. |
| Slack timeout, rejection, non-200, wrong/oversized body | Scheduled promise resolves `false`; no retry, rejection, or response change. |
| `waitUntil` throws synchronously | Return `false`; provider promise retains a rejection sink. |
| User text contains Slack markup/control text | Normalize, escape, and truncate before interpolation. |
| Durable write fails | Owning handler never calls `notify`; no false notification. |
| Durable write succeeds and notification fails | Durable response and state remain unchanged. |
| Author never reads the configured Slack channel | No delivery guarantee; email and per-user notification remain deliberately absent. |

## Settled decisions

- One Slack incoming webhook is the entire notification provider surface.
- `SLACK_WEBHOOK_URL` is an optional Functions-scoped secret; absence is normal degradation.
- Permanent `/d/<docId>` links are used. Slugs, paths, and instance names are never notification authority.
- Comment/reply text may appear in Slack under the explicit short bounds above. That does not permit any text on the realtime channel.
- Suggestion creation and accept/reject decisions notify; withdraw and computed supersede do not.
- Notification is state-after, best effort, one attempt, and never transactional with the authoritative record or audit event.
- Call-site ownership remains with P4-M and P4-O. Same-file realtime ownership remains with P4-H.

## Assumptions and open questions

- The webhook is site-wide rather than per-document because the ruling plan names one environment variable and rejects another configuration surface.
- `hooks.slack.com` is the only accepted hostname. GovSlack is not in product scope; adding `hooks.slack-gov.com` would be a reviewed follow-up.
- Notifications link only to the permanent document route because the predecessor client tickets do not define stable thread/suggestion URL fragments. Adding a deep-link fragment requires a separately tested client contract rather than guessing one here.
- Slack acknowledges ordinary incoming webhooks with HTTP 200 and body `ok`; any other result is treated as best-effort failure.
- No remaining question blocks P4-D. A request for direct author delivery, multiple channels, retry, or richer blocks changes product scope.

## References

- `docs/research/00-integration-plan.md` §§1.1, 1.3, 4.6–4.7, and §5 — no transactions, permanent document links, ticket ownership, suggestion notification expansion, and rejected email/subscription scope.
- `docs/research/04-comments-and-discussion.md` §10 — one webhook, bounded quote/body content, local seen state, and accepted notification gap.
- `docs/research/08-suggestions-and-editing-model.md` §§11, 13.2, and 16 — Slack is the decision channel, suggestion-create mitigation, accept/reject requirement, and no email fallback.
- `docs/tickets/P3-A.md` — authoritative thread/comment shapes and P4-M amendment boundary.
- `docs/tickets/P2-F.md` — optional-provider, timeout, privacy, and best-effort semantics that P4-H later composes.
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/#waituntil) — official `context.waitUntil()` response-nonblocking and execution-limit behavior; checked 2026-09-03.
- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) — official HTTPS JSON `{text}` contract, secret-URL warning, HTTP 200 `ok` success, and provider error behavior; checked 2026-09-03.
- GitHub issue #27 — tracker pointer only; the canonical specification is this document.
