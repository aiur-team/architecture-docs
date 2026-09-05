# P3-F — The client realtime transport

## Outcome

Every generated document has an optional, silent browser transport that activates only from P2-C's valid `session` event, obtains P2-F's least-privileged token, subscribes to the document's two separated Ably channels over one resumable SSE connection, publishes the four permitted client events over REST, and exposes only a validated `doc:event` bus plus `window.doc.realtime.publish()` for later feature modules.

## Context

Realtime is a best-effort hint layer over durable comments, edits, pending overlays, and audit records. P2-F deliberately separates server projections from client-originated ephemeral traffic so a readable browser can never forge `thread.changed` or `edit.saved`; this client must preserve that boundary after both channels enter one transport.

The base document must still work from `file:`, inside a network-restricted artifact, without an Ably key, and while Ably is unavailable. P3-F therefore owns transport and degradation only: no presence calculation, visual state, polling policy, or durable write may depend on it.

## Scope

### In scope

- Create `templates/base/realtime.js`, consumed by P1-B's existing `{{REALTIME_JS}}` slot as an inline module before presence/share/session modules.
- Install the exact four dark-by-default gates and use the lowercase P2-C `session` event as the sole activation signal.
- Read the permanent six-lowercase-hex document ID from the one `<meta name="doc-id">` element; never derive a channel from a slug, path, title, or session field.
- Fetch and defensively validate P2-F's five-field TokenDetails response.
- Attach one Ably `EventSource` to exactly `doc:<docId>:server` and `doc:<docId>:client`, with no speculative rewind on a fresh attach and `lastEvent` only when manually resuming a known cursor.
- Preserve P2-F's source boundary: accept durable projections only from the server channel and ephemeral client events only from the client channel.
- Dispatch the six normalized event variants on the exact `doc:event` browser bus.
- Publish only `beat`, `bye`, `edit.claim`, and `edit.release` through a frozen `window.doc.realtime.publish()` API and P2-F's client channel.
- Refresh the token only after a parseable Ably error code from 40140 through 40149, closing the old EventSource before a replacement is created.
- Define browser-native reconnection/backoff, page lifecycle, hidden/offline behavior, bounded fetches, cleanup, error privacy, and deterministic source-bound tests.

### Out of scope

- Presence rosters, heartbeats or heartbeat timers, label selection, expiry, avatars, rail markers, the hide-me preference, editing chips, or any DOM/user interface. P3-G owns presence; P4-I owns claim/release interaction.
- Content polling, comment/thread refresh, pending-overlay refresh, history refresh, or interpreting a server projection as durable state. Owning client modules may react to `doc:event` by fetching their authoritative API.
- Server token minting, server publication, Ably key configuration, provider setup, CORS configuration, access/identity policy, or changing either P2-F file.
- Ably Presence, an Ably SDK, WebSockets, a local SSE endpoint, another broker, channel history queries, message persistence, delivery receipts, queues, offline storage, or application-level reconnect polling.
- Persisting any realtime message or credential to Blobs, the audit event API, DOM, storage, cookies, history, URL, service worker, logs, analytics, or generated metadata.
- Adding markup, styles, notices, live regions, console output, dependencies, package/lock/configuration changes, permanent test files, builder changes, or hand-edited generated HTML.

## Interface contract

### Evaluation order and the four gates

`realtime.js` is a plain browser script with no import, export, top-level await, dynamic import, `eval`, or external asset. P1-B inlines it in a `<script type="module">` after `window.doc` exists and before P3-G and the final P2-C session module. It must not depend on `DOMContentLoaded`; the document and its metadata already exist when the inline module evaluates.

Evaluate the gates in this order. Every failed gate returns silently, throws nothing outside the module, performs no provider request, creates no EventSource/timer/worker, dispatches no event, and makes no DOM or storage change.

1. **Platform gate:** if `typeof window.EventSource !== "function"`, return. A P2-C `session` event also implies that `fetch`, `AbortController`, `CustomEvent`, and `URL` passed P2-C's own platform gate; nevertheless, every later use remains inside P3-F's fail-closed boundary.
2. **Protocol gate:** if `location.protocol` is neither exact `"http:"` nor exact `"https:"`, return. In particular, `file:` stops before listener/global installation or network work.
3. **Session gate:** on HTTP(S), create the API below and attach one `document` listener for exact lowercase `session`. Do not fetch before that event. Ignore an event unless `detail` is a non-null object, `document.documentElement.getAttribute("data-session")` is exact `reader` or `editor`, and exactly one `meta[name="doc-id"]` exists with content matching `^[0-9a-f]{6}$`. The first valid event removes the listener and starts at most one activation; malformed or duplicate events do not consume or restart it. Do not inspect, clone, cache globally, or authorize from any session field.
4. **Token gate:** fetch P2-F's token once for that activation. A 204, any other non-200 status, timeout, abort not caused by a BFCache suspension, fetch/parse/validation failure, or EventSource-constructor failure makes the transport permanently dark for that document lifetime. There is no notice and no thrown/logged error.

On HTTP(S), before the session event, require `window.doc` to be a non-null object and require it not to have an own `realtime` property. Otherwise return rather than overwrite another owner. Install exactly this frozen surface, with no other own key, getter, setter, event target, state value, credential, document ID, or EventSource reference:

```js
window.doc.realtime = Object.freeze({ publish });

// The function always settles and never throws to its caller.
// It returns true only for a validated Ably HTTP 201 acknowledgement.
async function publish(event) { /* contract below */ }
```

`publish()` called before the valid session listener has begun activation resolves `false`. Because P1-B orders realtime before presence, P3-F's session listener runs before P3-G's listener; a valid call made by P3-G during that same `session` dispatch waits for the already-created activation promise. Token failure resolves every waiting and future call `false`.

### Constants, channels, and credential acquisition

Use these constants and no configurable/browser-supplied alternatives:

```js
const ABLY_ORIGIN = "https://main.realtime.ably.net";
const ABLY_VERSION = "1.2";
const TOKEN_TIMEOUT_MS = 7000;
const PUBLISH_TIMEOUT_MS = 5000;
const CLOCK_SKEW_MS = 60000;
const TOKEN_TTL_MS = 3600000;
const DOC_ID_RE = /^[0-9a-f]{6}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const AID_RE = /^a[0-9a-f]{8}$/;
const THREAD_ID_RE = /^t_[0-9a-z]{1,48}_[0-9a-f]{8}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
```

For an accepted `docId`, derive these exact strings internally:

```text
serverChannel = doc:<docId>:server
clientChannel = doc:<docId>:client
```

Acquire a credential with exactly this same-origin request. Start a 7,000 ms timer before `fetch`, abort through a fresh `AbortController` at the deadline, and clear the timer in `finally`:

```http
GET /api/realtime-token?doc=4b7d2a
Accept: application/json
```

The corresponding fetch options are a fresh ordinary object with exactly these own enumerable data keys: `method`, `credentials`, `cache`, `redirect`, `headers`, and `signal`. Their values are exactly `method: "GET"`, `credentials: "same-origin"`, `cache: "no-store"`, `redirect: "error"`, a fresh ordinary `headers: { Accept: "application/json" }` object with no other key, and the fresh controller's signal. Do not set `mode`, `keepalive`, `referrerPolicy`, an Origin override, bearer credential, session data, client ID, channel, slug, or any other option/header.

Only status 200 is read. Require a JSON media type (`application/json`, case-insensitive, with optional syntactically valid parameters), then use the bounded streaming decoder below with limit 8,192. Parse the materialized string exactly once and validate a non-null non-array object with prototype exactly `Object.prototype`, no symbols, and exactly five ordinary enumerable/writable/configurable own data properties in any order:

```json
{
  "token": "invented-token-value-not-a-credential",
  "issued": 1788364800000,
  "expires": 1788368400000,
  "capability": "{\"doc:4b7d2a:server\":[\"subscribe\"],\"doc:4b7d2a:client\":[\"publish\",\"subscribe\"]}",
  "clientId": "u_fixture_member_17"
}
```

Validation is exact:

- `token` is 1 through 343 ASCII code units, with every code unit from `!` through `~`. This makes both the SSE query value and the RFC-4648 `btoa(token)` REST credential unambiguous. Do not trim it.
- Sample `requestTime = Date.now()` immediately before the token fetch and `responseTime = Date.now()` immediately after parsing. `issued` and `expires` are safe integers; `issued >= requestTime - 60_000`; `issued <= responseTime + 60_000`; `expires > responseTime`; `expires > issued`; `expires - issued <= 3_600_000`; and `expires <= responseTime + 3_660_000`.
- `clientId` matches `CLIENT_ID_RE`; do not compare it to a session field, expose it, or assume it remains stable after refresh.
- `capability` parses to an ordinary object with exactly the derived server/client keys. The server value is a dense ordinary array containing only `"subscribe"`. The client value is a dense ordinary array containing `"publish"` and `"subscribe"` once each, in either order. Reject wildcards, other operations, missing/extra channels, server publish, accessors, symbols, custom prototypes, sparse/extended arrays, or malformed JSON.

Inspect prototypes/keys/descriptors inside defensive `try` blocks and return failure on any reflection error without invoking an accessor. A JSON parse normally creates ordinary data properties, but this rule makes the validator independently testable and fail-closed. Retain the validated five-field projection only in the module closure, replace it atomically after an authenticated refresh, and never persist or publish it.

For both token and REST acknowledgement/error bodies, `readBoundedJson(response, limit)` is the only body reader. Before evaluating `response.body`, read `Content-Length` once. A present value must match `^(?:0|[1-9][0-9]{0,3})$` for the 8,192-byte token limit or `^(?:0|[1-9][0-9]{0,3})$` for the 4,096-byte REST limit, and its numeric value must be no greater than that call's `limit`; the shared numeric comparison is authoritative, so `8192` is accepted only for the token call and `4096` only for REST. Missing length is allowed. Empty, padded, signed, fractional, exponent, non-decimal, or larger values fail before body access.

Require a body and call `getReader()` exactly once. Sequentially accept only `Uint8Array` chunks. Before retaining/copying a chunk, require its byte length and the cumulative total to be safe integers and require the new total not to exceed `limit`. On every exit before `{ done: true }`—including wrong chunk, overflow, read rejection, and abort—call `reader.cancel()` once best-effort; a cancellation rejection is swallowed into the same failure. In `finally`, call `reader.releaseLock()` exactly once after every successful acquisition, even after cancellation failure; a release failure makes the decode fail. After `done`, allocate and concatenate one exact-size `Uint8Array`, decode exactly once with `new TextDecoder("utf-8", { fatal: true })`, then call `JSON.parse()` exactly once for that body. Do not use `text()`, `json()`, `arrayBuffer()`, `blob()`, `formData()`, clone, an unbounded accumulator, replacement-character decoding, or partial/truncated JSON. A body/stream/decode/parse failure is handled exactly like the endpoint's other malformed responses and never escapes.

### SSE attach, routing, continuity, and reconnection

Create one `EventSource` for both exact channels. Ably's current SSE API accepts one or more comma-separated channel names, and the token already grants subscribe on both. This is one transport connection; logically, its durable projection route still attaches only to `serverChannel`, while the client route is isolated by the envelope's exact `channel` value.

For a fresh attach, construct a `URL` from exact `https://main.realtime.ably.net/sse` and set only these parameters once: `v=1.2`, `channels=<serverChannel>,<clientChannel>` in that order, `enveloped=true`, and raw validated `accessToken=<token>`. Do not set `rewind` or `lastEvent` on a fresh attach. Let `URLSearchParams` percent-encode values exactly once. Call `new EventSource(url.href, { withCredentials: false })`; never put the API key or Base64 bearer value in this URL.

Do not request a speculative backlog. Server-event consumers fetch their authoritative API after activation and on an accepted projection; they do not need replay payloads as initial state. P3-G publishes an immediate beat when it activates and every 20 seconds while visible, so peers converge without treating an older replayed beat as newly observed presence. On every `message`, update the private resume cursor from `MessageEvent.lastEventId` before routing: accept the empty string as a reset, or a string of at most 512 code units containing no NUL, CR, or LF; an invalid value resets the private cursor to empty. Native reconnection of the same EventSource owns its own `Last-Event-ID` header.

When P3-F itself must create a replacement connection after an authenticated refresh or BFCache restore, close the old object first. If the private cursor is nonempty, add `lastEvent=<cursor>`; otherwise attach with neither `lastEvent` nor `rewind`. Never create a replacement while the old EventSource remains live, and ignore callbacks from a stale connection generation.

Handle errors as follows:

- An `error` event whose string `data` parses to an object with an own safe-integer `code` from 40140 through 40149 is the only token-refresh trigger. Close the current EventSource, share one in-flight refresh across SSE and REST callers, fetch/validate a new P2-F token, then attach with `lastEvent` continuity. One qualifying error is allowed before a replacement has opened; a second qualifying error on a replacement that has never reached `open` degrades instead of looping. After `open`, a later qualifying expiry may refresh again.
- A generic browser `error` event with no parseable Ably body and `readyState === EventSource.CONNECTING` is left to the native EventSource reconnect algorithm. Do not close, fetch a token, schedule a timer, or dispatch a status event. The browser/server owns reconnect delay and optional exponential backoff.
- A generic error with `readyState === EventSource.CLOSED`, or a parseable Ably error outside 40140–40149, permanently degrades. It never refreshes the token.
- Malformed messages are dropped individually. They do not refresh, reconnect, degrade, log, or reach the bus.

There is no application reconnect loop, random jitter, online listener, periodic token timer, proactive expiry refresh, or polling timer. A network outage is handled by EventSource's native reconnect/backoff; REST publication during an outage settles `false` and is not queued. Keep the stream attached while `document.visibilityState` is hidden. P3-G, not this transport, stops visible-only beats.

### Provider messages and the `doc:event` bus

Register only `message`, `error`, and `open` handlers on the private EventSource. With `enveloped=true`, a `message` event's string `data` must parse to an Ably Message object. Require own ordinary string data properties `channel`, `name`, `encoding`, and `data`; require `encoding === "json"`; require the nested `data` string to be at most 4,096 UTF-8 bytes; parse it once to an exact ordinary object. Provider-added outer properties such as `id` and `timestamp` may exist but are never copied. Both inspected objects come exclusively from the platform's unmodified `JSON.parse`, so they necessarily have ordinary JSON data properties rather than accessors, symbols, custom prototypes, or proxies; the executable matrix covers parse failure, missing/wrong/extra fields, byte limits, and every routed scalar class instead of claiming unreachable reflective inputs.

Route only these provider-envelope combinations. The nested `data` key set and scalar grammar are exact; no trimming/coercion/defaulting or extra key is allowed.

| Provider `channel` | Provider `name` | Provider `clientId` | Decoded provider `data` |
|---|---|---|---|
| `serverChannel` | `thread.changed` | ignored and never copied | `{ "threadId": "t_m8x2k1_4f7a9c31" }` with `THREAD_ID_RE` |
| `serverChannel` | `edit.saved` | ignored and never copied | `{ "aid": "a03f19c2b", "hash": "8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277" }` with `AID_RE` and `HASH_RE` |
| `clientChannel` | `beat` | required own data property matching `CLIENT_ID_RE` | `{ "label": "Invented Reader", "act": "reading", "aid": null }`; label 1–24 code units, no C0/C1 controls; `act` is `reading` or `editing`; `aid` is null or `AID_RE` |
| `clientChannel` | `bye` | required own data property matching `CLIENT_ID_RE` | `{}` |
| `clientChannel` | `edit.claim` | required own data property matching `CLIENT_ID_RE` | `{ "aid": "a03f19c2b" }` with `AID_RE` |
| `clientChannel` | `edit.release` | required own data property matching `CLIENT_ID_RE` | `{ "aid": "a03f19c2b" }` with `AID_RE` |

The channel/name cross-product is closed. In particular, drop `thread.changed` or `edit.saved` from `clientChannel` even if every other field is valid, and drop the four client names from `serverChannel`. This source check—not a name alone—is what preserves the P2-F server/client trust boundary.

For an accepted provider message, synchronously dispatch exactly one event:

```js
document.dispatchEvent(new CustomEvent("doc:event", { detail }));
```

The event target is `document`; its exact case-sensitive type is `doc:event`; `bubbles`, `cancelable`, and `composed` are false. `detail` is a newly constructed frozen ordinary flat object with exactly one of these discriminated shapes and key order; no provider object is reused:

```js
Object.freeze({ source: "server", t: "thread.changed", threadId });
Object.freeze({ source: "server", t: "edit.saved", aid, hash });
Object.freeze({ source: "client", t: "beat", clientId, label, act, aid });
Object.freeze({ source: "client", t: "bye", clientId });
Object.freeze({ source: "client", t: "edit.claim", clientId, aid });
Object.freeze({ source: "client", t: "edit.release", clientId, aid });
```

P3-F does not interpret or retain a roster, mutate content, call another API, or dispatch a local event on publish success. P3-G consumes the `source: "client"` presence variants. Later content modules consume the `source: "server"` projections and fetch durable state. A `doc:event` is a hint, never authorization, a lock, or content.

### Client publication API

`window.doc.realtime.publish(event)` accepts only an ordinary, non-null, non-array `Object.prototype` object with exactly the variant's own string keys, no symbols, and enumerable/writable/configurable data descriptors for every field. Frozen/sealed objects, custom/null prototypes, accessors, and extra/missing fields fail closed. It accepts these four closed inputs:

```js
[
  { t: "beat", label: "Invented Reader", act: "reading", aid: null },
  { t: "bye" },
  { t: "edit.claim", aid: "a03f19c2b" },
  { t: "edit.release", aid: "a03f19c2b" }
];
```

The grammars are the same as the receive table. Invalid input resolves `false` before activation/token/network work; it never throws or repairs a value. P3-G owns when to send `beat`/`bye` and which privacy-safe label to supply. P4-I owns when to send claim/release. P3-F supplies no timer and never publishes autonomously.

For valid input after a token is available, construct a fresh provider Message with exact top-level keys `name`, `data`, `clientId`. Set `name = event.t`, copy only the variant's fields other than `t` into a fresh exact `data` object, and set `clientId` from the current validated token. Send exactly:

```http
POST https://main.realtime.ably.net/channels/doc%3A4b7d2a%3Aclient/messages?v=1.2
Authorization: Bearer <RFC-4648-base64 of the literal token string>
Accept: application/json
Content-Type: application/json

{"name":"edit.claim","data":{"aid":"a03f19c2b"},"clientId":"u_fixture_member_17"}
```

Use `encodeURIComponent(clientChannel)` as the one path segment and the query version `v=1.2`. Fetch options are a fresh ordinary object with exactly `method`, `mode`, `credentials`, `cache`, `redirect`, `referrerPolicy`, `keepalive`, `headers`, `body`, and `signal`. Values are exactly `method: "POST"`, `mode: "cors"`, `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, `referrerPolicy: "no-referrer"`, `keepalive: true`, the exact serialized provider Message body, a fresh controller signal, and a fresh ordinary headers object with exactly `Authorization`, `Accept`, and `Content-Type` mapped to the shown values. Start one 5,000 ms timer before `fetch`, abort at the deadline, and clear it once in `finally` after response streaming/validation or failure. `btoa(token)` supplies the required RFC-4648 Bearer value; never send the raw token in the header. Track publication controllers so permanent degradation aborts them; `pagehide` deliberately does not abort an already-started keepalive publication, allowing P3-G's synchronous `bye` call to leave the page.

Only HTTP 201 with JSON media type and a body accepted by `readBoundedJson(response, 4096)` whose parsed object has own `channel` equal to `clientChannel` and own nonempty string `messageId` resolves `true`. Extra acknowledgement fields are ignored without copying. Every timeout, abort, network/CORS failure, redirect, malformed response, or other status resolves `false` without log or retry.

The sole exception is a non-201 JSON-media-type body accepted by `readBoundedJson(response, 4096)` that defensively parses as Ably `{ "error": { "code": 40142 } }` with an own safe-integer code from 40140 through 40149. Close the old stream, share the same one in-flight token refresh, and retry that publication exactly once with the new token/client ID. If another caller already replaced the failed credential, reuse the current credential without fetching again. The retry cannot trigger a second refresh. A non-auth code, missing/non-JSON/unparseable/oversized body, or exhausted auth retry resolves `false`; it never refreshes.

### Page lifecycle, cleanup, and privacy

Install one `pagehide` and one `pageshow` listener only after gates 1 and 2. On `pagehide`, remove handlers from and close the current EventSource, invalidate its callback generation, and abort an in-progress token fetch. Keep an already validated token only in closure so a later BFCache restore can resume; do not abort already-started keepalive publications. Do not use `unload` or `beforeunload`.

On `pageshow` with `event.persisted === true`, if the valid session activation previously began and the transport is not permanently degraded, reattach with the retained token and cursor. If suspension aborted the first acquisition before any token existed, restart that incomplete acquisition once. Do not proactively replace a retained token based on `expires`; an expired credential is refreshed only if Ably reports 40140–40149. An ordinary non-persisted `pageshow` does nothing. While the `pagehide` dispatch is still running, a valid `publish()` remains permitted when a token already exists, even though the SSE object has closed; this is the exact seam that lets P3-G's later-registered listener start its keepalive `bye`.

Permanent `degrade()` is idempotent: mark the module dark, remove the session/page lifecycle listeners, detach EventSource handlers, close the stream, abort token and publication controllers, clear every timeout, discard token/cursor/activation references, and make `publish()` settle `false`. It changes no DOM/class/attribute/text/style, dispatches no error/status/presence event, and calls no polling function. A page that goes away permanently also receives the platform's mandatory EventSource close semantics.

No caught value is inspected beyond the narrow safe response/error-code validators. Never print, interpolate into an error, rethrow, report, persist, or expose the token, Base64 token, client ID, capability, SSE URL, channel, provider body, session, event body, or caught value. There is no `console.*`, `alert`, telemetry, beacon, storage, cookie write, DOM text, or URL/history mutation in this file.

## Files owned

- `templates/base/realtime.js` — **new**, created exclusively by P3-F and inlined through P1-B's existing slot.

No other implementation path is owned. Do not amend P1-B's builder/layout, P2-C's session assets, either P2-F server file, P3-G/P4-I feature assets, `package.json`, a lockfile, configuration, generated `dist/**`, a permanent test file, a workflow, research, prompt, or another ticket. Shared generated artifacts are regenerated by the integration owner from the combined source immediately before merge; P3-F never hand-edits them. `docs/tickets/P3-F.md` is this specification, not implementation source.

## Dependencies

- **P1-B:** provides the empty-when-missing `{{REALTIME_JS}}` slot, inline module order, the permanent `<meta name="doc-id">`, and `window.doc` before feature modules. P3-F relies on REALTIME preceding PRESENCE and SESSION being last; it does not amend that order.
- **P2-C:** provides the sole valid activation signal: one synchronous `document` `CustomEvent("session", { detail: frozenSession })` after exact root `data-session`, and no event on file/artifact/auth/platform failure. P3-F attaches at module evaluation and does not call `/api/session` again.
- **P2-F:** provides the exact token endpoint, five-field validated TokenDetails, one-hour time bounds, raw token, bound client ID, and disjoint server-subscribe/client-publish-subscribe capability. It also fixes `main.realtime.ably.net`, version 1.2, channel grammars, server event schemas, and the rule that provider failure is best effort.

Safe implementation/integration waves are exact:

1. Integrate P1-B, P2-C, and P2-F completely and green. A missing slot, session event, final token shape, or separated capability is a predecessor gap; do not add a fallback.
2. P3-F may be authored in parallel with Phase 3 tickets that own disjoint files and whose own predecessors are green. It alone creates `templates/base/realtime.js`; its deterministic harness has no port, child process, dependency install, or shared generated-output write.
3. Run P3-F's source-bound tests. Then serialize the combined build/check-dist/browser integration with other template lanes because generated `dist/**`, dependency roots, and browser/runtime state are shared.
4. Only after P3-F is integrated and green may P3-G consume client beats/bye and `publish()`. P4-H later creates server fan-out; P4-I later consumes/publishes claim/release. Those tickets amend only their owned files and the six-event bus contract here remains stable.

The maximum safe source parallelism is therefore every disjoint Phase 3 lane after its own predecessors; the integration maximum is one owner for generated/browser gates. P3-G is specifically serialized after P3-F, not parallel with it.

## Acceptance criteria

- [ ] Only `templates/base/realtime.js` is added as implementation source; it has no dependency/import/export/UI/config/generated-file change.
- [ ] The four gates execute in order. `file:` makes no listener/global/network/timer; HTTP(S) without a valid `session` makes no network; every unusable token response stays silent and dark.
- [ ] A valid P2-C session causes exactly one token request for the exact permanent `docId`; duplicate/malformed session events cannot restart or redirect activation.
- [ ] The fixture proves the exact closed token/publish option and header objects, actual 7,000/5,000-ms AbortController deadlines, and always-settling failure boundary.
- [ ] Token and REST bodies use only the bounded streaming decoder: Content-Length precheck, one reader, safe cumulative bytes, exact 8,192/4,096 boundaries, pre-completion cancellation, exactly-once release, fatal UTF-8, and one body `JSON.parse`; overflow, wrong chunks, read/cancel/release failure, and convenience whole-body methods fail closed.
- [ ] One EventSource subscribes to exactly the separated server and client channels with the raw token, `v=1.2`, and `enveloped=true`; a fresh attach has neither `rewind` nor `lastEvent`.
- [ ] The last event ID is retained privately; native reconnect is left intact, while every manual replacement closes the old stream first and uses exact `lastEvent` continuity instead of rewind.
- [ ] Only parseable Ably 40140–40149 errors refresh. Concurrent errors share one refresh; a pre-open auth loop stops; generic reconnecting errors use browser backoff; every other fatal/provider error degrades without refresh.
- [ ] The exact channel/name/data/client-ID matrix is enforced. A client-channel attempt to forge either server event and a server-channel attempt to inject a client event are dropped.
- [ ] Each accepted provider message dispatches one synchronous, frozen, closed, normalized `doc:event`; malformed/wide/prototype/accessor/symbol/proxy/oversized messages dispatch none and invoke no getter.
- [ ] The frozen global API has only `publish`; it accepts only the four exact client variants, posts only to the client channel with the bound `clientId`, and validates exact 201 acknowledgements.
- [ ] The REST Bearer header contains RFC-4648 Base64 of the literal token, while SSE receives the raw token through one encoded query value. Neither credential is otherwise exposed.
- [ ] A REST 40140–40149 refreshes and retries once; stale concurrent failures reuse the new generation; all other failures resolve false with no queue, log, local dispatch, or second retry.
- [ ] Hidden/offline/pagehide/BFCache behavior follows the lifecycle contract; P3-G can initiate a keepalive `bye`, stale callbacks are ignored, and teardown leaves no EventSource or timer owned by a degraded module.
- [ ] The TypeScript-AST oracle rejects presence intervals, UI/storage/cookie/history/location/DOM sinks, SDK/socket/worker/dynamic-code/import/export, convenience body readers, console/error-reporting surfaces, and unexpected transport constructors structurally; runtime-poisoned equivalents prove caught failures cannot hide their execution.
- [ ] The supplied deterministic fixture executes the complete finite gate, request, token, stream, message, publication, acknowledgement, refresh-concurrency, cursor, and lifecycle equivalence matrices without an external network, child process, listening port, dependency install, persistent file, or leaked timer/handle. No mandatory behavior is deferred to an unspecified source review.
- [ ] Repository syntax, exact-heading, scrub, whitespace, build parity, typecheck, one-file ownership, and issue #19 pointer-integrity gates pass: exact title and two-paragraph short body, a full commit SHA and exact document path parsed from the permalink, and commit-addressed bytes identical to this canonical document.

## Test plan

### Source syntax and deterministic transport fixture

Run on Node 22 from the repository root after implementing the one owned source file. Each table-driven list below is an equivalence matrix: it executes every distinct validator/control-flow class and both inclusive boundaries, while literals inside the same already-exercised regex range do not require a Cartesian product with unrelated response, lifecycle, and transport classes.

```bash
set -euo pipefail

node --check templates/base/realtime.js
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("templates/base/realtime.js", "utf8");
const nativeSetTimeout = globalThis.setTimeout;
const deadline = nativeSetTimeout(() => process.exit(124), 25000);

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options = {}) {
    const rows = this.listeners.get(type) || [];
    rows.push({ fn, once: options === true || options?.once === true });
    this.listeners.set(type, rows);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((row) => row.fn !== fn));
  }
  dispatchEvent(event) {
    event.target = this;
    for (const row of [...(this.listeners.get(event.type) || [])]) {
      if (row.once) this.removeEventListener(event.type, row.fn);
      row.fn.call(this, event);
    }
    return !event.defaultPrevented;
  }
}

class CustomEventFixture {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail ?? null;
    this.bubbles = options.bubbles ?? false;
    this.cancelable = options.cancelable ?? false;
    this.composed = options.composed ?? false;
    this.defaultPrevented = false;
  }
}

function response(status, text = "", contentType = "application/json", options = {}) {
  const chunks = options.chunks ?? [new TextEncoder().encode(text)];
  const state = { bodyGets: 0, readers: 0, reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const reader = {
    async read() {
      state.reads += 1;
      if (options.readRejectAt === state.reads) throw new Error("fixture read rejection");
      return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined };
    },
    async cancel() { state.cancels += 1; if (options.cancelReject) throw new Error("fixture cancel rejection"); },
    releaseLock() { state.releases += 1; if (options.releaseReject) throw new Error("fixture release rejection"); }
  };
  const body = options.noBody ? null : { getReader() { state.readers += 1; if (options.getReaderReject) throw new Error("fixture reader acquisition failure"); return reader; } };
  const headers = { get(name) {
    const lower = String(name).toLowerCase();
    if (lower === "content-type") return contentType;
    if (lower === "content-length") return options.contentLength ?? null;
    return null;
  } };
  const reply = { status, ok: status >= 200 && status < 300, headers };
  Object.defineProperty(reply, "body", { enumerable: true, get() { state.bodyGets += 1; if (options.bodyReject) throw new Error("fixture body access failure"); return body; } });
  Object.defineProperty(reply, "streamState", { value: state });
  return reply;
}

function tokenBody(docId = "4b7d2a", overrides = {}) {
  const now = Date.now();
  return JSON.stringify({
    token: "invented-token-value-not-a-credential",
    issued: now - 1000,
    expires: now + 3500000,
    capability: JSON.stringify({
      [`doc:${docId}:server`]: ["subscribe"],
      [`doc:${docId}:client`]: ["publish", "subscribe"]
    }),
    clientId: "u_fixture_member_17",
    ...overrides
  });
}

function assertTokenRequest(request) {
  assert.equal(request.url, "/api/realtime-token?doc=4b7d2a");
  assert.deepEqual(Object.keys(request.options).sort(), ["cache", "credentials", "headers", "method", "redirect", "signal"]);
  assert.deepEqual({
    method: request.options.method,
    credentials: request.options.credentials,
    cache: request.options.cache,
    redirect: request.options.redirect,
  }, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" });
  assert.deepEqual(Object.keys(request.options.headers), ["Accept"]);
  assert.equal(request.options.headers.Accept, "application/json");
  assert.ok(request.options.signal instanceof AbortSignal);
}

function assertPublishRequest(request, expectedBody) {
  assert.equal(request.url, "https://main.realtime.ably.net/channels/doc%3A4b7d2a%3Aclient/messages?v=1.2");
  assert.deepEqual(Object.keys(request.options).sort(), ["body", "cache", "credentials", "headers", "keepalive", "method", "mode", "redirect", "referrerPolicy", "signal"]);
  assert.deepEqual({
    method: request.options.method,
    mode: request.options.mode,
    credentials: request.options.credentials,
    cache: request.options.cache,
    redirect: request.options.redirect,
    referrerPolicy: request.options.referrerPolicy,
    keepalive: request.options.keepalive,
  }, { method: "POST", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", keepalive: true });
  assert.deepEqual(Object.keys(request.options.headers).sort(), ["Accept", "Authorization", "Content-Type"]);
  assert.deepEqual({ ...request.options.headers }, {
    Authorization: `Bearer ${Buffer.from("invented-token-value-not-a-credential", "latin1").toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal(request.options.body, JSON.stringify(expectedBody));
  assert.ok(request.options.signal instanceof AbortSignal);
}

function createEnvironment({ protocol = "https:", eventSource = true, eventSourceThrows = false } = {}) {
  const document = new Target();
  const sinkTouches = [], urlConstructions = [];
  const poison = (name) => { sinkTouches.push(name); throw new Error(`forbidden sink ${name}`); };
  let rootMode = "reader";
  const root = { getAttribute(name) { return name === "data-session" ? rootMode : null; } };
  const meta = { content: "4b7d2a", getAttribute(name) { return name === "content" ? this.content : null; } };
  const metas = [meta];
  document.documentElement = root;
  document.querySelectorAll = (selector) => selector === 'meta[name="doc-id"]' ? metas : [];
  const window = new Target();
  window.doc = { rail: null, panel: null };
  const requests = [];
  const replies = [];
  const streams = [];
  const timers = new Set();
  const timerDelays = [];
  const bus = [];
  document.addEventListener("doc:event", (event) => bus.push(event));
  Object.defineProperty(document, "cookie", { configurable: true, get() { return poison("document.cookie:get"); }, set() { poison("document.cookie:set"); } });
  document.createElement = () => poison("document.createElement");
  document.createTextNode = () => poison("document.createTextNode");
  document.write = () => poison("document.write");

  class EventSourceFixture extends Target {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    constructor(url, options) {
      super();
      if (eventSourceThrows) throw new Error("fixture EventSource constructor failure");
      this.url = String(url);
      this.options = options;
      this.readyState = EventSourceFixture.CONNECTING;
      this.closed = false;
      streams.push(this);
    }
    close() { this.closed = true; this.readyState = EventSourceFixture.CLOSED; }
    emit(type, data, lastEventId = "") {
      const event = { type, data, lastEventId, target: this };
      if (type === "open") this.readyState = EventSourceFixture.OPEN;
      const handler = this[`on${type}`];
      if (typeof handler === "function") handler.call(this, event);
      this.dispatchEvent(event);
    }
  }

  const fetchFixture = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    assert.ok(replies.length, `unexpected fetch ${url}`);
    const next = replies.shift();
    return typeof next === "function" ? next(url, options) : next;
  };
  const setTimeoutFixture = (fn, ms) => {
    timerDelays.push(ms);
    const id = nativeSetTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };
  const clearTimeoutFixture = (id) => { timers.delete(id); clearTimeout(id); };
  let pageHref = `${protocol}//docs.fixture.invalid/guide`;
  const location = { get protocol() { return protocol; }, get href() { return pageHref; }, set href(_value) { poison("location.href"); }, assign() { poison("location.assign"); }, replace() { poison("location.replace"); } };
  class ObservedURL extends URL { constructor(input, base) { super(input, base); urlConstructions.push({ input: String(input), base: base === undefined ? undefined : String(base), href: this.href }); } }
  const poisonedConsole = new Proxy({}, { get(_target, name) { return () => poison(`console.${String(name)}`); } });
  const navigator = { sendBeacon() { poison("navigator.sendBeacon"); }, get serviceWorker() { return poison("navigator.serviceWorker"); } };
  const history = { pushState() { poison("history.pushState"); }, replaceState() { poison("history.replaceState"); } };
  Object.assign(window, {
    EventSource: eventSource ? EventSourceFixture : undefined,
    location,
    fetch: fetchFixture,
    CustomEvent: CustomEventFixture,
    AbortController,
    URL: ObservedURL,
    URLSearchParams,
    TextEncoder,
    btoa: (value) => Buffer.from(value, "latin1").toString("base64"),
    console: poisonedConsole, navigator, history, alert: () => poison("window.alert")
  });
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) Object.defineProperty(window, name, { configurable: true, get() { return poison(`window.${name}`); } });
  const sandbox = {
    window, document, location,
    EventSource: window.EventSource, fetch: fetchFixture,
    CustomEvent: CustomEventFixture, AbortController, URL: ObservedURL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    btoa: window.btoa,
    encodeURIComponent, setTimeout: setTimeoutFixture, clearTimeout: clearTimeoutFixture,
    queueMicrotask, console: poisonedConsole, navigator, history, alert: window.alert
  };
  for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) Object.defineProperty(sandbox, name, { configurable: true, get() { return poison(`global.${name}`); } });
  const windowKeys = Object.keys(window).sort();
  const context = vm.createContext(sandbox);
  const run = () => vm.runInContext(source, context, { filename: "templates/base/realtime.js" });
  const session = () => document.dispatchEvent(new CustomEventFixture("session", { detail: Object.freeze({ sub: "u_fixture_member_17" }) }));
  const settle = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
  const cleanup = () => {
    for (const id of timers) clearTimeout(id); timers.clear();
    assert.deepEqual(sinkTouches, []);
    assert.deepEqual(Object.keys(window).sort(), windowKeys);
    const docKeys = Object.keys(window.doc).sort();
    assert.deepEqual(docKeys, Object.hasOwn(window.doc, "realtime") ? ["panel", "rail", "realtime"] : ["panel", "rail"]);
    assert.equal(JSON.stringify(window.doc).includes("invented-token"), false);
    assert.equal((window.listeners.get("online") ?? []).length, 0); assert.equal((document.listeners.get("visibilitychange") ?? []).length, 0);
    assert.equal(timerDelays.every((value) => value === 5000 || value === 7000), true);
  };
  return { window, document, root, meta, metas, requests, replies, streams, bus, timers, timerDelays, urlConstructions, run, session, settle, cleanup, setMode(value) { rootMode = value; }, EventSourceFixture };
}

{
  const env = createEnvironment({ eventSource: false });
  env.run();
  assert.equal(Object.hasOwn(env.window.doc, "realtime"), false);
  assert.equal(env.requests.length, 0);
  env.cleanup();
}
{
  const env = createEnvironment({ protocol: "file:" });
  env.run();
  assert.equal(Object.hasOwn(env.window.doc, "realtime"), false);
  assert.equal(env.requests.length, 0);
  env.cleanup();
}
{
  const env = createEnvironment({ protocol: "http:" }); env.setMode("editor"); env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle(); assert.equal(env.requests.length, 1); assert.equal(env.streams.length, 1); env.cleanup();
}
for (const preset of [null, { rail: null, panel: null, realtime: Object.freeze({ publish: async () => false }) }]) {
  const env = createEnvironment(); env.window.doc = preset; env.run();
  assert.equal(env.requests.length, 0); assert.equal(preset === null ? env.window.doc : preset, preset);
  env.window.doc = { rail: null, panel: null };
  env.cleanup();
}
{
  const env = createEnvironment();
  env.run();
  assert.deepEqual(Object.keys(env.window.doc.realtime), ["publish"]);
  assert.equal(Object.isFrozen(env.window.doc.realtime), true);
  assert.equal(env.requests.length, 0);
  assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
  env.cleanup();
}
{
  const env = createEnvironment({ eventSourceThrows: true });
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  assert.equal(env.streams.length, 0); assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
  env.cleanup();
}
{
  const env = createEnvironment(); env.replies.push(() => { throw new Error("fixture token network failure"); });
  env.run(); env.session(); await env.settle(); assert.equal(env.streams.length, 0); assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false); env.cleanup();
}
{
  const env = createEnvironment();
  const disabled = response(204);
  env.replies.push(disabled);
  env.run(); env.session(); await env.settle();
  assert.equal(env.requests.length, 1);
  assertTokenRequest(env.requests[0]);
  assert.deepEqual(disabled.streamState, { bodyGets: 0, readers: 0, reads: 0, cancels: 0, releases: 0 });
  assert.equal(env.streams.length, 0);
  assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
  assert.equal((env.document.listeners.get("session") ?? []).length, 0); assert.equal((env.window.listeners.get("pagehide") ?? []).length, 0); assert.equal((env.window.listeners.get("pageshow") ?? []).length, 0);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle(); env.streams[0].emit("open");
  let releaseStale;
  env.replies.push(
    response(401, JSON.stringify({ error: { code: 40142 } })),
    () => new Promise((resolve) => { releaseStale = resolve; }),
    response(200, tokenBody("4b7d2a", { token: "invented-current-generation", clientId: "g_current_generation" })),
    response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-first-retry" })),
    response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-stale-retry" })),
  );
  const first = env.window.doc.realtime.publish({ t: "bye" });
  const stale = env.window.doc.realtime.publish({ t: "edit.release", aid: "a03f19c2b" });
  assert.equal(await first, true);
  releaseStale(response(401, JSON.stringify({ error: { code: 40142 } })));
  assert.equal(await stale, true);
  assert.equal(env.requests.length, 6); assert.equal(env.requests.filter((request) => request.url.startsWith("/api/realtime-token?")).length, 2);
  assert.equal(JSON.parse(env.requests.at(-1).options.body).clientId, "g_current_generation");
  env.cleanup();
}
{
  const env = createEnvironment();
  env.run();
  env.document.dispatchEvent(new CustomEventFixture("session", { detail: null }));
  env.document.dispatchEvent(new CustomEventFixture("session", { detail: [] }));
  env.setMode(null);
  env.session();
  env.meta.content = "BAD-ID";
  env.setMode("reader");
  env.session();
  env.meta.content = "4b7d2a";
  env.metas.push({ content: "4b7d2a" });
  env.session();
  assert.equal(env.requests.length, 0, "invalid session/meta events must not consume or activate");
  env.metas.pop();
  env.replies.push(response(200, tokenBody()));
  env.session(); env.session(); await env.settle();
  assert.equal(env.requests.length, 1, "only the first valid session activates");
  assertTokenRequest(env.requests[0]);
  assert.equal(env.streams.length, 1);
  env.cleanup();
}
{
  const now = Date.now();
  const validCapability = JSON.stringify({
    "doc:4b7d2a:client": ["subscribe", "publish"],
    "doc:4b7d2a:server": ["subscribe"]
  });
  const tokenText = tokenBody();
  const boundaryTokenText = tokenText + " ".repeat(8192 - new TextEncoder().encode(tokenText).byteLength);
  const boundaryToken = response(200, boundaryTokenText, "application/json", { contentLength: "8192", chunks: [
    new TextEncoder().encode(boundaryTokenText.slice(0, 1)),
    new TextEncoder().encode(boundaryTokenText.slice(1, 4096)),
    new TextEncoder().encode(boundaryTokenText.slice(4096)),
  ] });
  const overToken = response(200, "", "application/json", { chunks: [new Uint8Array(4096), new Uint8Array(4097)] });
  const wrongToken = response(200, "", "application/json", { chunks: ["not bytes"] });
  const readRejectedToken = response(200, "", "application/json", { readRejectAt: 1 });
  const cancelRejectedToken = response(200, "", "application/json", { chunks: ["not bytes"], cancelReject: true });
  const releaseRejectedToken = response(200, tokenText, "application/json", { releaseReject: true });
  const bodyRejectedToken = response(200, tokenText, "application/json", { bodyReject: true });
  const readerRejectedToken = response(200, tokenText, "application/json", { getReaderReject: true });
  const oversizedHeaderToken = response(200, tokenText, "application/json", { contentLength: "8193" });
  const malformedLengthTokens = ["", "+1", "1.0", "1e3", "8192x"].map((contentLength) => response(200, tokenText, "application/json", { contentLength }));
  const cases = [
    [response(200, tokenBody("4b7d2a", { capability: validCapability })), true],
    [response(200, JSON.stringify({ clientId: "u_fixture_member_17", capability: validCapability, expires: now + 3500000, issued: now - 1000, token: "!" }), "Application/JSON; Charset=UTF-8"), true],
    [response(200, tokenBody(), 'application/json; profile="invented"'), true],
    [response(200, tokenBody("4b7d2a", { token: "~".repeat(343), clientId: `u${"x".repeat(127)}` })), true],
    [boundaryToken, true],
    [response(500), false],
    [response(200, "not-json"), false],
    [response(200, "", "application/json", { noBody: true }), false],
    [response(200, "", "application/json", { chunks: [Uint8Array.of(0xc3, 0x28)] }), false],
    [response(200, tokenText, "application/json", { contentLength: "08192" }), false],
    [oversizedHeaderToken, false],
    ...malformedLengthTokens.map((reply) => [reply, false]),
    [overToken, false],
    [wrongToken, false],
    [readRejectedToken, false],
    [cancelRejectedToken, false],
    [releaseRejectedToken, false],
    [bodyRejectedToken, false],
    [readerRejectedToken, false],
    [response(200, tokenBody(), "text/plain"), false],
    [response(200, tokenBody(), "application/json;"), false],
    [response(200, JSON.stringify([])), false],
    [response(200, tokenBody("4b7d2a", { extra: true })), false],
    [response(200, tokenBody("4b7d2a", { token: "" })), false],
    [response(200, tokenBody("4b7d2a", { token: "é" })), false],
    [response(200, tokenBody("4b7d2a", { token: "x".repeat(344) })), false],
    [response(200, tokenBody("4b7d2a", { token: undefined })), false],
    [response(200, tokenBody("4b7d2a", { issued: now - 61000 })), false],
    [response(200, tokenBody("4b7d2a", { issued: now + 61000 })), false],
    [response(200, tokenBody("4b7d2a", { issued: now - 0.5 })), false],
    [response(200, tokenBody("4b7d2a", { expires: now - 1 })), false],
    [response(200, tokenBody("4b7d2a", { issued: now, expires: now })), false],
    [response(200, tokenBody("4b7d2a", { issued: now - 1000, expires: now + 3600001 })), false],
    [response(200, tokenBody("4b7d2a", { expires: now + 1000.5 })), false],
    [response(200, tokenBody("4b7d2a", { clientId: "bad client" })), false],
    [response(200, tokenBody("4b7d2a", { clientId: `u${"x".repeat(128)}` })), false],
    [response(200, tokenBody("4b7d2a", { capability: "not-json" })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["subscribe"], "doc:4b7d2a:client": ["publish"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["subscribe"], "doc:4b7d2a:client": ["publish", "publish", "subscribe"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["subscribe"], "doc:4b7d2a:client": ["publish", "subscribe", "history"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["subscribe", "publish"], "doc:4b7d2a:client": ["publish", "subscribe"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["*"] , "doc:4b7d2a:client": ["publish", "subscribe"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["publish", "subscribe"], "doc:4b7d2a:client": ["publish", "subscribe"] }) })), false],
    [response(200, tokenBody("4b7d2a", { capability: JSON.stringify({ "doc:4b7d2a:server": ["subscribe"], "doc:4b7d2a:client": ["publish", "subscribe"], "doc:ffffff:client": ["subscribe"] }) })), false]
  ];
  for (const [reply, accepted] of cases) {
    const env = createEnvironment();
    env.replies.push(reply);
    env.run(); env.session(); await env.settle();
    assertTokenRequest(env.requests[0]);
    assert.equal(env.streams.length === 1, accepted);
    env.cleanup();
  }
  assert.deepEqual(boundaryToken.streamState, { bodyGets: 1, readers: 1, reads: 4, cancels: 0, releases: 1 });
  for (const reply of [overToken, wrongToken, readRejectedToken, cancelRejectedToken]) {
    assert.equal(reply.streamState.readers, 1); assert.equal(reply.streamState.cancels, 1); assert.equal(reply.streamState.releases, 1);
  }
  assert.equal(releaseRejectedToken.streamState.releases, 1);
  assert.deepEqual(bodyRejectedToken.streamState, { bodyGets: 1, readers: 0, reads: 0, cancels: 0, releases: 0 });
  assert.deepEqual(readerRejectedToken.streamState, { bodyGets: 1, readers: 1, reads: 0, cancels: 0, releases: 0 });
  for (const reply of [oversizedHeaderToken, ...malformedLengthTokens]) assert.deepEqual(reply.streamState, { bodyGets: 0, readers: 0, reads: 0, cancels: 0, releases: 0 });
}
{
  const env = createEnvironment();
  let observeAbort;
  const aborted = new Promise((resolve) => { observeAbort = resolve; });
  env.replies.push((_url, options) => new Promise((_resolve, reject) => {
    assert.equal(options.signal.aborted, false);
    options.signal.addEventListener("abort", () => { observeAbort(Date.now()); reject(new Error("fixture token timeout")); }, { once: true });
  }));
  const started = Date.now();
  env.run(); env.session();
  const ended = await aborted; await env.settle();
  assert.ok(ended - started >= 6800 && ended - started < 10000, `token abort elapsed ${ended - started}`);
  assertTokenRequest(env.requests[0]); assert.equal(env.requests[0].options.signal.aborted, true);
  assert.equal(env.timerDelays.filter((value) => value === 7000).length, 1);
  assert.equal(env.streams.length, 0); assert.equal(env.timers.size, 0);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  assertTokenRequest(env.requests[0]);
  assert.equal(env.streams.length, 1);
  const url = new URL(env.streams[0].url);
  assert.equal(url.origin, "https://main.realtime.ably.net");
  assert.equal(url.pathname, "/sse");
  assert.deepEqual([...url.searchParams], [["v", "1.2"], ["channels", "doc:4b7d2a:server,doc:4b7d2a:client"], ["enveloped", "true"], ["accessToken", "invented-token-value-not-a-credential"]]);
  assert.equal(url.searchParams.get("v"), "1.2");
  assert.equal(url.searchParams.get("channels"), "doc:4b7d2a:server,doc:4b7d2a:client");
  assert.equal(url.searchParams.get("enveloped"), "true");
  assert.equal(url.searchParams.get("accessToken"), "invented-token-value-not-a-credential");
  assert.equal(url.searchParams.has("rewind"), false);
  assert.equal(url.searchParams.has("lastEvent"), false);
  assert.deepEqual(Object.keys(env.streams[0].options), ["withCredentials"]); assert.equal(env.streams[0].options.withCredentials, false);

  const message = (channel, name, data, clientId) => JSON.stringify({
    channel, name, encoding: "json", data: JSON.stringify(data), ...(clientId ? { clientId } : {})
  });
  const threadMin = "t_a_4f7a9c31";
  const threadMax = `t_${"a".repeat(48)}_4f7a9c31`;
  const threadTooLong = `t_${"a".repeat(49)}_4f7a9c31`;
  env.streams[0].emit("message", message("doc:4b7d2a:server", "thread.changed", { threadId: threadMin }), "cursor-thread-min");
  env.streams[0].emit("message", message("doc:4b7d2a:server", "thread.changed", { threadId: threadMax }), "cursor-thread-max");
  env.streams[0].emit("message", message("doc:4b7d2a:server", "thread.changed", { threadId: threadTooLong }), "cursor-thread-long");
  env.streams[0].emit("message", message("doc:4b7d2a:server", "thread.changed", { threadId: "t__4f7a9c31" }), "cursor-thread-empty");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "beat", { label: "Invented Reader", act: "reading", aid: null }, "u_fixture_peer_29"), "cursor-2");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "edit.saved", { aid: "a03f19c2b", hash: "8".repeat(64) }, "u_fixture_peer_29"), "cursor-3");
  env.streams[0].emit("message", JSON.stringify({ channel: "doc:4b7d2a:server", name: "edit.saved", encoding: "json", data: JSON.stringify({ aid: "a03f19c2b", hash: "8".repeat(64) }), id: "invented-provider-id", timestamp: 1788364800000 }), "cursor-4");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "bye", {}, "u_fixture_peer_29"), "cursor-5");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "edit.claim", { aid: "a03f19c2b" }, "u_fixture_peer_29"), "cursor-6");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "edit.release", { aid: "a03f19c2b" }, "u_fixture_peer_29"), "cursor-7");
  env.streams[0].emit("message", message("doc:4b7d2a:server", "beat", { label: "Invented Reader", act: "reading", aid: null }, "u_fixture_peer_29"), "cursor-8");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "beat", { label: "", act: "reading", aid: null }, "u_fixture_peer_29"), "cursor-9");
  env.streams[0].emit("message", "not-json", "cursor-10");
  env.streams[0].emit("message", message("doc:4b7d2a:client", "beat", { label: "L".repeat(24), act: "editing", aid: "a03f19c2b" }, "u_fixture_peer_30"), "cursor-11");
  assert.deepEqual(env.bus.map((event) => ({ ...event.detail })), [
    { source: "server", t: "thread.changed", threadId: threadMin },
    { source: "server", t: "thread.changed", threadId: threadMax },
    { source: "client", t: "beat", clientId: "u_fixture_peer_29", label: "Invented Reader", act: "reading", aid: null },
    { source: "server", t: "edit.saved", aid: "a03f19c2b", hash: "8".repeat(64) },
    { source: "client", t: "bye", clientId: "u_fixture_peer_29" },
    { source: "client", t: "edit.claim", clientId: "u_fixture_peer_29", aid: "a03f19c2b" },
    { source: "client", t: "edit.release", clientId: "u_fixture_peer_29", aid: "a03f19c2b" },
    { source: "client", t: "beat", clientId: "u_fixture_peer_30", label: "L".repeat(24), act: "editing", aid: "a03f19c2b" },
  ]);
  for (const event of env.bus) {
    assert.equal(Object.isFrozen(event.detail), true);
    assert.deepEqual([event.type, event.bubbles, event.cancelable, event.composed], ["doc:event", false, false, false]);
  }
  const invalidMessages = [
    "not-json", "[]", "{}",
    JSON.stringify({ channel: "doc:4b7d2a:server", name: "thread.changed", encoding: "utf-8", data: JSON.stringify({ threadId: threadMin }) }),
    JSON.stringify({ channel: "doc:4b7d2a:server", name: "thread.changed", encoding: "json", data: 17 }),
    message("doc:ffffff:server", "thread.changed", { threadId: threadMin }),
    message("doc:4b7d2a:server", "unknown", { threadId: threadMin }),
    message("doc:4b7d2a:server", "thread.changed", { threadId: "t__4f7a9c31" }),
    message("doc:4b7d2a:server", "thread.changed", { threadId: threadTooLong }),
    message("doc:4b7d2a:server", "thread.changed", { threadId: threadMin, extra: true }),
    message("doc:4b7d2a:server", "edit.saved", { aid: "bad", hash: "8".repeat(64) }),
    message("doc:4b7d2a:server", "edit.saved", { aid: "a03f19c2b", hash: "8".repeat(63) }),
    message("doc:4b7d2a:client", "thread.changed", { threadId: threadMin }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "edit.saved", { aid: "a03f19c2b", hash: "8".repeat(64) }, "u_fixture_peer_29"),
    message("doc:4b7d2a:server", "beat", { label: "Invented Reader", act: "reading", aid: null }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "beat", { label: "Invented Reader", act: "reading", aid: null }),
    message("doc:4b7d2a:client", "beat", { label: "Invented Reader", act: "reading", aid: null }, "bad client"),
    message("doc:4b7d2a:client", "beat", { label: "L".repeat(25), act: "reading", aid: null }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "beat", { label: "bad" + String.fromCharCode(0) + "label", act: "reading", aid: null }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "beat", { label: "Invented Reader", act: "idle", aid: null }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "beat", { label: "Invented Reader", act: "reading", aid: "bad" }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "bye", { extra: true }, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "edit.claim", {}, "u_fixture_peer_29"),
    message("doc:4b7d2a:client", "edit.release", { aid: "bad" }, "u_fixture_peer_29"),
    JSON.stringify({ channel: "doc:4b7d2a:client", name: "bye", encoding: "json", data: " ".repeat(4097), clientId: "u_fixture_peer_29" }),
  ];
  const acceptedBeforeInvalidMatrix = env.bus.length;
  for (let i = 0; i < invalidMessages.length; i += 1) env.streams[0].emit("message", invalidMessages[i], `invalid-${i}`);
  assert.equal(env.bus.length, acceptedBeforeInvalidMatrix);

  const acceptedPublications = [
    { t: "beat", label: "Invented Reader", act: "reading", aid: null },
    { t: "bye" },
    { t: "edit.claim", aid: "a03f19c2b" },
    { t: "edit.release", aid: "a03f19c2b" }
  ];
  for (let i = 0; i < acceptedPublications.length; i += 1) {
    const acknowledgement = response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: `invented-message-${i}` }));
    env.replies.push(acknowledgement);
    assert.equal(await env.window.doc.realtime.publish(acceptedPublications[i]), true);
    const { t: name, ...data } = acceptedPublications[i];
    assertPublishRequest(env.requests.at(-1), { name, data, clientId: "u_fixture_member_17" });
    assert.deepEqual(acknowledgement.streamState, { bodyGets: 1, readers: 1, reads: 2, cancels: 0, releases: 1 });
  }
  const publication = env.requests.at(-1);
  assertPublishRequest(publication, { name: "edit.release", data: { aid: "a03f19c2b" }, clientId: "u_fixture_member_17" });

  const ackText = JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-boundary" });
  const boundaryAckText = ackText + " ".repeat(4096 - new TextEncoder().encode(ackText).byteLength);
  const boundaryAck = response(201, boundaryAckText, "application/json", { contentLength: "4096", chunks: [
    new TextEncoder().encode(boundaryAckText.slice(0, 2048)), new TextEncoder().encode(boundaryAckText.slice(2048)),
  ] });
  env.replies.push(boundaryAck);
  assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), true);
  assertPublishRequest(env.requests.at(-1), { name: "bye", data: {}, clientId: "u_fixture_member_17" });
  assert.deepEqual(boundaryAck.streamState, { bodyGets: 1, readers: 1, reads: 3, cancels: 0, releases: 1 });

  for (const [reply, accepted] of [
    [response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-extra", providerExtra: true }), "application/json; charset=utf-8"), true],
    [response(201, JSON.stringify({ channel: "doc:ffffff:client", messageId: "invented-wrong-channel" })), false],
    [response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "" })), false],
    [response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: 17 })), false],
    [response(201, JSON.stringify([])), false],
    [response(201, "not-json"), false],
    [response(201, "", "application/json", { noBody: true }), false],
    [response(201, ackText, "text/plain"), false],
    [response(201, ackText, "application/json;"), false],
    [response(400, JSON.stringify({ error: { code: 40000 } })), false],
  ]) {
    env.replies.push(reply);
    assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), accepted);
    assertPublishRequest(env.requests.at(-1), { name: "bye", data: {}, clientId: "u_fixture_member_17" });
  }

  const overAck = response(201, "", "application/json", { chunks: [new Uint8Array(2048), new Uint8Array(2049)] });
  const wrongAck = response(201, "", "application/json", { chunks: ["not bytes"] });
  const readRejectedAck = response(201, "", "application/json", { readRejectAt: 1 });
  const cancelRejectedAck = response(201, "", "application/json", { chunks: ["not bytes"], cancelReject: true });
  const releaseRejectedAck = response(201, ackText, "application/json", { releaseReject: true });
  const bodyRejectedAck = response(201, ackText, "application/json", { bodyReject: true });
  const readerRejectedAck = response(201, ackText, "application/json", { getReaderReject: true });
  const oversizedHeaderAck = response(201, ackText, "application/json", { contentLength: "4097" });
  const malformedLengthAcks = ["", "+1", "1.0", "1e3", "4096x"].map((contentLength) => response(201, ackText, "application/json", { contentLength }));
  for (const reply of [overAck, wrongAck, readRejectedAck, cancelRejectedAck, releaseRejectedAck, bodyRejectedAck, readerRejectedAck, oversizedHeaderAck, ...malformedLengthAcks]) {
    env.replies.push(reply);
    assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
    assertPublishRequest(env.requests.at(-1), { name: "bye", data: {}, clientId: "u_fixture_member_17" });
  }
  for (const reply of [overAck, wrongAck, readRejectedAck, cancelRejectedAck]) {
    assert.equal(reply.streamState.readers, 1); assert.equal(reply.streamState.cancels, 1); assert.equal(reply.streamState.releases, 1);
  }
  assert.equal(releaseRejectedAck.streamState.releases, 1);
  assert.deepEqual(bodyRejectedAck.streamState, { bodyGets: 1, readers: 0, reads: 0, cancels: 0, releases: 0 });
  assert.deepEqual(readerRejectedAck.streamState, { bodyGets: 1, readers: 1, reads: 0, cancels: 0, releases: 0 });
  for (const reply of [oversizedHeaderAck, ...malformedLengthAcks]) assert.deepEqual(reply.streamState, { bodyGets: 0, readers: 0, reads: 0, cancels: 0, releases: 0 });
  const publicationSignals = env.requests.slice(1).map((request) => request.options.signal);
  assert.equal(new Set(publicationSignals).size, publicationSignals.length, "every publish owns a fresh AbortController signal");
  assert.equal(env.timers.size, 0, "settled token and publication operations clear every deadline");
  let getterRuns = 0;
  const accessor = {};
  Object.defineProperty(accessor, "t", { enumerable: true, get() { getterRuns += 1; return "bye"; } });
  const symbolEvent = { t: "bye" };
  symbolEvent[Symbol("extra")] = true;
  const hostileProxy = new Proxy({}, { ownKeys() { throw new Error("fixture trap"); } });
  const frozenBye = Object.freeze({ t: "bye" });
  const hiddenBye = Object.defineProperty({}, "t", { value: "bye", enumerable: false, writable: true, configurable: true });
  const customPrototypeBye = Object.assign(Object.create({ inherited: true }), { t: "bye" });
  const beforeInvalid = env.requests.length;
  for (const value of [
    null, [], {}, { t: "bye", extra: true }, { t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31" }, Object.create(null), customPrototypeBye, frozenBye, hiddenBye, accessor, symbolEvent, hostileProxy,
    { t: "beat", label: "", act: "reading", aid: null }, { t: "beat", label: "L".repeat(25), act: "reading", aid: null },
    { t: "beat", label: "bad" + String.fromCharCode(0x85) + "label", act: "reading", aid: null }, { t: "beat", label: "Invented Reader", act: "idle", aid: null },
    { t: "beat", label: "Invented Reader", act: "reading", aid: "bad" }, { t: "edit.claim", aid: "bad" }, { t: "edit.release", aid: null },
  ]) {
    assert.equal(await env.window.doc.realtime.publish(value), false);
  }
  assert.equal(getterRuns, 0);
  assert.equal(env.requests.length, beforeInvalid);

  const beforeNetworkError = env.requests.length;
  env.streams[0].readyState = env.EventSourceFixture.CONNECTING;
  env.streams[0].emit("error", undefined);
  await env.settle();
  assert.equal(env.requests.length, beforeNetworkError);
  assert.equal(env.streams[0].closed, false);

  env.replies.push(response(200, tokenBody("4b7d2a", { token: "invented-refresh-token", clientId: "g_0123456789ab" })));
  env.streams[0].emit("error", JSON.stringify({ message: "expired", code: 40142, statusCode: 401 }));
  await env.settle();
  assert.equal(env.streams[0].closed, true);
  assert.equal(env.streams.length, 2);
  const resumed = new URL(env.streams[1].url);
  assert.equal(resumed.searchParams.get("lastEvent"), `invalid-${invalidMessages.length - 1}`);
  assert.equal(resumed.searchParams.has("rewind"), false);
  assert.equal(resumed.searchParams.get("accessToken"), "invented-refresh-token");
  const beforeStaleCallback = env.bus.length;
  env.streams[0].emit("message", message("doc:4b7d2a:client", "bye", {}, "u_fixture_stale_31"), "stale-cursor");
  assert.equal(env.bus.length, beforeStaleCallback, "callbacks from the closed generation are detached");
  const beforeLoop = env.requests.length;
  env.streams[1].emit("error", JSON.stringify({ code: 40142, statusCode: 401 }));
  await env.settle();
  assert.equal(env.requests.length, beforeLoop, "a second pre-open auth failure must not loop");
  assert.equal(env.streams[1].closed, true);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  let observeAbort;
  const aborted = new Promise((resolve) => { observeAbort = resolve; });
  env.replies.push((_url, options) => new Promise((_resolve, reject) => {
    assert.equal(options.signal.aborted, false);
    options.signal.addEventListener("abort", () => { observeAbort(Date.now()); reject(new Error("fixture publish timeout")); }, { once: true });
  }));
  const started = Date.now();
  const result = env.window.doc.realtime.publish({ t: "bye" });
  const ended = await aborted;
  assert.ok(ended - started >= 4800 && ended - started < 8000, `publish abort elapsed ${ended - started}`);
  assert.equal(await result, false);
  assertPublishRequest(env.requests.at(-1), { name: "bye", data: {}, clientId: "u_fixture_member_17" });
  assert.equal(env.requests.at(-1).options.signal.aborted, true);
  assert.equal(env.timerDelays.filter((value) => value === 5000).length, 1);
  assert.equal(env.timers.size, 0);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.streams[0].emit("open");
  env.replies.push(response(401, JSON.stringify({ error: { code: 40142, message: "expired", statusCode: 401 } })));
  env.replies.push(response(200, tokenBody("4b7d2a", { token: "invented-refresh-token", clientId: "g_0123456789ab" })));
  env.replies.push(response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-message-retry" })));
  assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), true);
  assert.equal(env.requests.length, 4, "initial token + failed publish + refresh + one retry");
  assert.equal(env.streams[0].closed, true);
  assert.equal(env.streams.length, 2);
  assert.equal(JSON.parse(env.requests.at(-1).options.body).clientId, "g_0123456789ab");
  env.cleanup();
}
for (const code of [40140, 40149]) {
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.replies.push(response(200, tokenBody("4b7d2a", { token: `invented-refresh-${code}` })));
  env.streams[0].emit("error", JSON.stringify({ code, statusCode: 401 })); await env.settle();
  assert.equal(env.requests.length, 2); assert.equal(env.streams[0].closed, true); assert.equal(env.streams.length, 2);
  env.cleanup();
}
for (const code of [40139, 40150]) {
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.streams[0].emit("error", JSON.stringify({ code, statusCode: 401 })); await env.settle();
  assert.equal(env.requests.length, 1); assert.equal(env.streams[0].closed, true);
  assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.streams[0].readyState = env.EventSourceFixture.CLOSED;
  env.streams[0].emit("error", undefined); await env.settle();
  assert.equal(env.requests.length, 1); assert.equal(await env.window.doc.realtime.publish({ t: "bye" }), false);
  assert.equal((env.window.listeners.get("pagehide") ?? []).length, 0); assert.equal((env.window.listeners.get("pageshow") ?? []).length, 0);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  let publicationAborted;
  const aborted = new Promise((resolve) => { publicationAborted = resolve; });
  env.replies.push((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { publicationAborted(); reject(new Error("fixture degraded publication")); }, { once: true })));
  const pending = env.window.doc.realtime.publish({ t: "bye" }); await env.settle();
  env.streams[0].readyState = env.EventSourceFixture.CLOSED; env.streams[0].emit("error", undefined);
  await aborted; assert.equal(await pending, false); assert.equal(env.timers.size, 0);
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle(); env.streams[0].emit("open");
  env.replies.push(
    response(401, JSON.stringify({ error: { code: 40142 } })),
    response(401, JSON.stringify({ error: { code: 40142 } })),
    response(200, tokenBody("4b7d2a", { token: "invented-shared-refresh", clientId: "g_shared_refresh" })),
    response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-shared-1" })),
    response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-shared-2" })),
  );
  const results = await Promise.all([env.window.doc.realtime.publish({ t: "bye" }), env.window.doc.realtime.publish({ t: "edit.claim", aid: "a03f19c2b" })]);
  assert.deepEqual(results, [true, true]);
  assert.equal(env.requests.length, 6, "initial token, two failures, one shared refresh, and two retries");
  assert.equal(env.requests.filter((request) => request.url.startsWith("/api/realtime-token?")).length, 2);
  for (const request of env.requests.slice(-2)) assert.equal(JSON.parse(request.options.body).clientId, "g_shared_refresh");
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.streams[0].emit("message", JSON.stringify({
    channel: "doc:4b7d2a:client", name: "bye", encoding: "json", data: "{}", clientId: "u_fixture_peer_29"
  }), "cursor-lifecycle");
  let byeResult;
  env.replies.push(response(201, JSON.stringify({ channel: "doc:4b7d2a:client", messageId: "invented-bye" })));
  env.window.addEventListener("pagehide", () => { byeResult = env.window.doc.realtime.publish({ t: "bye" }); });
  env.window.dispatchEvent({ type: "pagehide", persisted: true });
  assert.equal(env.streams[0].closed, true);
  assert.equal(await byeResult, true, "a later pagehide listener can start keepalive bye");
  assert.equal(env.requests.at(-1).options.keepalive, true);
  env.window.dispatchEvent({ type: "pageshow", persisted: true });
  await env.settle();
  assert.equal(env.streams.length, 2);
  assert.equal(new URL(env.streams[1].url).searchParams.get("lastEvent"), "cursor-lifecycle");
  env.cleanup();
}
{
  const env = createEnvironment();
  let tokenSignal;
  env.replies.push((_url, options) => new Promise((_resolve, reject) => {
    tokenSignal = options.signal;
    options.signal.addEventListener("abort", () => reject(new Error("fixture BFCache suspension")), { once: true });
  }));
  env.run(); env.session(); await env.settle();
  assert.equal(tokenSignal.aborted, false); env.window.dispatchEvent({ type: "pagehide", persisted: true }); assert.equal(tokenSignal.aborted, true);
  await env.settle(); assert.equal(env.timers.size, 0);
  env.replies.push(response(200, tokenBody()));
  env.window.dispatchEvent({ type: "pageshow", persisted: true }); await env.settle();
  assert.equal(env.requests.length, 2); assert.equal(env.streams.length, 1, "persisted restore restarts only the suspended first acquisition");
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.document.visibilityState = "hidden";
  env.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(env.streams.length, 1); assert.equal(env.streams[0].closed, false); assert.equal((env.document.listeners.get("visibilitychange") ?? []).length, 0);
  env.window.dispatchEvent({ type: "pagehide", persisted: false }); assert.equal(env.streams[0].closed, true);
  env.window.dispatchEvent({ type: "pageshow", persisted: false }); await env.settle(); assert.equal(env.streams.length, 1, "ordinary pageshow never reattaches");
  env.cleanup();
}
{
  const env = createEnvironment();
  env.replies.push(response(200, tokenBody()));
  env.run(); env.session(); await env.settle();
  env.streams[0].emit("message", JSON.stringify({ channel: "doc:4b7d2a:client", name: "bye", encoding: "json", data: "{}", clientId: "u_fixture_peer_29" }), "bad\ncursor");
  env.window.dispatchEvent({ type: "pagehide", persisted: true });
  env.window.dispatchEvent({ type: "pageshow", persisted: true }); await env.settle();
  const resetUrl = new URL(env.streams[1].url); assert.equal(resetUrl.searchParams.has("lastEvent"), false); assert.equal(resetUrl.searchParams.has("rewind"), false);
  env.cleanup();
}

clearTimeout(deadline);
console.log("PASS  P3-F client realtime transport");
process.exit(0);
NODE
```

Expected: `node --check` is silent; the fixture exits 0 with stdout exactly `PASS  P3-F client realtime transport` and no stderr. It is one finite Node process, starts no child/daemon/server/listening socket, creates no temporary path, and uses no real credential or external network. The 25-second parent-process deadline is authoritative; the test waits for one real 7,000-ms token abort and one real 5,000-ms publish abort, while explicit cleanup clears every other simulated source timer before exit, so there is no process group or recursive deletion surface to supervise.

The command is the complete fixed executable fixture for this ticket; there is no deferred instruction to author more test code or perform an informal source review. It directly covers missing EventSource, file mode, invalid/pre-owned `window.doc`, pre-session, invalid-then-valid/duplicate activation, 204 and constructor degradation; exact token request objects and a real seven-second abort; accepted field order/operation order/scalar endpoints and every rejected token/time/capability/content-type/length/body/stream equivalence class; exact fresh SSE query and constructor objects; all six accepted message projections, both thread-middle boundaries, optional provider fields, every channel/name/field/scalar/size forgery class, frozen normalized details, valid/invalid cursor continuity, and stale-generation suppression; all four exact publication request bodies plus closed caller-input classes; exact acknowledgement success, extra-field acceptance, wrong channel/message ID/status/media/body/JSON/length/stream classes and a real five-second abort; generic native reconnect, both auth-code endpoints and adjacent rejections, one-retry REST refresh, shared concurrent refresh, pre-open loop prevention, closed-stream degradation, visible/hidden invariance, ordinary/persisted pageshow, suspended-first-token restart, and pagehide keepalive publication. Every environment also asserts that poisoned console, persistence, cookie, DOM-write, history/location, beacon/service-worker, alert, unexpected-global, online-listener, visibility-listener, and timer surfaces remained untouched.

### Repository and ownership gates

Run after the source-bound fixture and after the integration owner has regenerated shared artifacts according to repository policy:

```bash
set -euo pipefail

test "$(grep -c '^## ' docs/tickets/P3-F.md)" -eq 12
test "$(grep '^## ' docs/tickets/P3-F.md | sed 's/^## //')" = "$(printf '%s\n' \
  'Outcome' 'Context' 'Scope' 'Interface contract' 'Files owned' 'Dependencies' \
  'Acceptance criteria' 'Test plan' 'Failure modes' 'Settled decisions' \
  'Assumptions and open questions' 'References')"
node --input-type=module <<'P3F_AST'
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const ts = require("./templates/docbuild/node_modules/typescript");
const source = readFileSync("templates/base/realtime.js", "utf8");
const tree = ts.createSourceFile("realtime.js", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
assert.deepEqual(tree.parseDiagnostics.map(({ messageText }) => String(messageText)), []);
const accessName = (node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
const rootName = (node) => {
  const expression = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
  return expression && ts.isIdentifier(expression) ? expression.text : null;
};
const baseName = (node) => ts.isIdentifier(node) ? node.text : (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) ? baseName(node.expression) : null;
const accessPath = (node) => ts.isIdentifier(node) ? node.text : (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && accessName(node) ? `${accessPath(node.expression)}.${accessName(node)}` : "";
const forbiddenGlobals = new Set(["localStorage", "sessionStorage", "indexedDB", "caches", "WebSocket", "Worker", "SharedWorker", "XMLHttpRequest", "MutationObserver", "ResizeObserver", "alert"]);
const forbiddenMembers = new Set(["innerHTML", "outerHTML", "insertAdjacentHTML"]);
const domMutationMethods = new Set(["append", "appendChild", "prepend", "before", "after", "replaceChildren", "insertBefore", "remove", "setAttribute", "removeAttribute", "createElement", "createTextNode", "write"]);
const domMutationProperties = new Set(["textContent", "innerHTML", "outerHTML", "className", "hidden", "id"]);
const bodyMethods = new Set(["text", "json", "arrayBuffer", "blob", "formData"]);
const failures = [];
const counts = { fetch: 0, eventSource: 0, customEvent: 0, interval: 0, globalInstall: 0 };
const visit = (node) => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) || ts.isImportEqualsDeclaration(node) || node.kind === ts.SyntaxKind.ImportKeyword || node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) failures.push("module import/export");
  if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) failures.push(`forbidden global ${node.text}`);
  if (ts.isCallExpression(node)) {
    const name = ts.isIdentifier(node.expression) ? node.expression.text : accessName(node.expression), root = rootName(node.expression);
    if (name === "fetch") counts.fetch += 1;
    if (name === "setInterval") counts.interval += 1;
    if (bodyMethods.has(name)) failures.push(`whole-body method ${name}`);
    if (name === "eval" || name === "Function" || name === "setInterval" || domMutationMethods.has(name) || (root === "document" && ["getElementById", "querySelector"].includes(name)) || (root === "navigator" && name === "sendBeacon") || (root === "history" && ["pushState", "replaceState"].includes(name)) || (root === "location" && ["assign", "replace"].includes(name))) failures.push(`forbidden call ${root ?? ""}.${name}`);
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === "EventSource") counts.eventSource += 1;
    if (node.expression.text === "CustomEvent") counts.customEvent += 1;
    if (node.expression.text === "Function") failures.push("dynamic Function");
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const name = accessName(node), root = rootName(node);
    if (forbiddenMembers.has(name) || root === "console" || (root === "document" && name === "cookie") || (root === "navigator" && name === "serviceWorker")) failures.push(`forbidden member ${root ?? ""}.${name}`);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))) {
    if (baseName(node.left) === "location") failures.push("location assignment");
    if (["window", "globalThis"].includes(baseName(node.left))) {
      if (accessPath(node.left) === "window.doc.realtime") counts.globalInstall += 1;
      else failures.push(`unexpected global assignment ${accessPath(node.left)}`);
    }
    if (domMutationProperties.has(accessName(node.left))) failures.push(`DOM assignment ${accessName(node.left)}`);
  }
  ts.forEachChild(node, visit);
};
visit(tree);
assert.deepEqual(failures, []);
assert.ok(counts.fetch === 1 || counts.fetch === 2, "one shared or two endpoint-specific fetch call sites");
assert.deepEqual({ eventSource: counts.eventSource, customEvent: counts.customEvent, interval: counts.interval, globalInstall: counts.globalInstall }, { eventSource: 1, customEvent: 1, interval: 0, globalInstall: 1 });
P3F_AST
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = execFileSync("git", ["rev-parse", "--verify", `${process.env.P3F_BASE ?? ""}^{commit}`], { encoding: "utf8" }).trim();
assert.match(base, /^[0-9a-f]{40,64}$/, "export P3F_BASE as the reviewed P1-B/P2-C/P2-F predecessor commit");
const rows = (args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
const paths = new Set([...rows(["diff", "--name-only", `${base}...HEAD`]), ...rows(["diff", "--name-only"]), ...rows(["diff", "--cached", "--name-only"]), ...rows(["ls-files", "--others", "--exclude-standard"])]);
for (const file of [...paths]) if (file.startsWith("docs/tickets/")) paths.delete(file);
assert.deepEqual([...paths].sort(), ["templates/base/realtime.js"]);
NODE
templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh
git diff --check
issue_json="$(gh issue view 19 --json title,body)"
pointer="$(
ISSUE_JSON="$issue_json" node --input-type=module <<'NODE'
const issue = JSON.parse(process.env.ISSUE_JSON);
const path = "docs/tickets/P3-F.md";
const match = /^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/.exec(issue.body);
if (issue.title !== "P3-F — The client realtime transport" || !match || match[1] !== path || match[3] !== path) process.exit(1);
process.stdout.write(`${match[2]}:${match[3]}`);
NODE
)"
pointer_sha="${pointer%%:*}"
pointer_path="${pointer#*:}"
test "$(git rev-parse --verify "${pointer_sha}^{commit}")" = "$pointer_sha"
git show "${pointer_sha}:${pointer_path}" | cmp -s "$pointer_path" -
printf '%s\n' 'PASS  P3-F issue #19 pointer integrity'
echo 'PASS  P3-F repository gates'
```

Expected: export `P3F_BASE` as the reviewed P1-B/P2-C/P2-F predecessor commit, then every command exits 0. The ownership oracle unions committed changes from `P3F_BASE...HEAD`, unstaged changes, staged changes, and untracked paths across the whole repository; after excluding ticket documents, the exact set is only `templates/base/realtime.js`. `check-dist` reports byte-identical committed documents, TypeScript emits no diagnostics, scrub reports no denied term or warning, and whitespace is clean. Issue #19 retains its exact title and exact two-paragraph canonical-document pointer, whose parsed full commit SHA and path resolve through `git show` to bytes identical to the local document; the pointer gate prints `PASS  P3-F issue #19 pointer integrity`, and the final line is `PASS  P3-F repository gates`. The TypeScript parser, rather than regex text matching, rejects forbidden executable structures while deliberately permitting bounded `setTimeout`, `fetch`, `EventSource`, `CustomEvent`, `pagehide`, and `pageshow`; the runtime equivalence fixture proves their allowed uses and poisons the forbidden sinks.

### Optional disposable-provider smoke

After deterministic acceptance, an operator may use a disposable least-privileged Ably application and invented document/session data. In two authenticated browser tabs, register `doc:event` collectors, call `window.doc.realtime.publish({ t: "beat", label: "Invented Reader", act: "reading", aid: null })` in one tab, and require the other tab to receive the exact normalized client detail within one second. Publish an invented `thread.changed` through the server helper and require the normalized server detail; attempt the same server name through the browser API and require `false`. Rotate/revoke the disposable key afterward. Do not print/copy the API key, token, Bearer value, channel URL, client ID, or provider body, and do not make this credentialed smoke a CI requirement.

## Failure modes

| Condition | Required behavior |
|---|---|
| No EventSource, non-HTTP(S), no/invalid session, or bad document metadata | Stay dark; no network, global API where gates 1/2 fail, UI, event, log, or throw |
| Token endpoint is disabled, unauthorized, forbidden, unavailable, slow, malformed, wider, expired, future/stale, or over-capable | Permanently degrade; no EventSource or provider request |
| Token/REST Content-Length is malformed/over-limit, body is absent, or stream chunk/read/cancel/release/decode/parse fails | Fail the token or publication quietly; never materialize over the endpoint limit, retain partial bytes, leak a caught value, or use a whole-body convenience reader |
| SSE constructor throws or a fatal/non-auth Ably error arrives | Close/clean once and permanently degrade; never refresh on an unqualified error |
| Network drops while EventSource is CONNECTING | Leave the object open for native resume/backoff and make no token request |
| Token expires with code 40140–40149 | Close the old stream, fetch once, replace atomically, resume from `lastEvent`; failure degrades |
| Repeated auth error before replacement opens | Stop the loop and degrade; no unbounded token churn or duplicate streams |
| Malformed, oversized, unknown, cross-channel, or client-forged server message | Drop only that message; no bus event, state change, refresh, or reflected data |
| Downstream `doc:event` listener is absent | Dispatch still succeeds; retain no queue/history |
| Invalid client publication | Resolve false locally before network; never coerce or throw |
| REST is offline, times out, fails CORS, redirects, or returns malformed/non-201 | Resolve false, no queue/local echo/retry; only an exact 40140–40149 gets one refresh/retry |
| Client ID changes after refresh | Replacement and retry use the new bound ID; downstream presence treats it as a new ephemeral reader |
| Tab becomes hidden/offline | Keep transport policy unchanged; P3-G stops beats, browser reconnects, failed publishes are lost by design |
| `pagehide` / BFCache restore | Close old SSE without blocking a keepalive bye; resume one stream with cursor and current token on persisted pageshow |
| Any cleanup operation throws | Swallow it inside idempotent cleanup, continue remaining cleanup, expose nothing, and leave the API resolving false |
| Realtime misses/duplicates/reorders an event | Durable API state, polling fallback, hash conflict checks, and audit records remain authoritative; consumers refetch rather than apply event payload as truth |

## Settled decisions

- Ably Pub/Sub is the optional hosted broker; no SDK is shipped. Browser subscription is native EventSource/SSE and browser publication is raw REST.
- `ABLY_API_KEY` remains the single server-side feature switch. The client never sees it, adds no second configuration switch, and treats endpoint 204 as normal.
- P2-F's two-channel namespace is mandatory: server projections are subscribe-only to browsers; client ephemeral traffic is publish/subscribe. Source channel is always checked before routing.
- Fresh attachment requests no replay. Only a known cursor may produce `lastEvent`; application APIs, new immediate beats, and the 20-second visible beat interval provide initial durable state and bounded presence convergence without resurrecting replayed ghosts.
- The only activation is P2-C's valid `session` event. `data-session`, `doc:event`, the token, and client ID are not authorization controls.
- Realtime delivery is best effort. No write, conflict decision, access decision, or rendered truth waits on it.
- Presence and claim traffic is ephemeral and never enters Blobs, P3-B events, history, analytics, or logs. Server projection payloads contain only IDs and the edit hash, never content or identity.
- No presence, Ably Presence, roster, heartbeat schedule, expiry, interface, notice, or polling behavior is implemented here.
- Browser EventSource owns ordinary reconnect and backoff. P3-F replaces a stream only for a documented token error or BFCache lifecycle restoration.
- The self-contained-file and public-safe requirements prohibit external scripts, dependencies, real user data, real credentials, or private examples.

## Assumptions and open questions

### Assumptions

- **Rewind reconciliation:** Research 07 and the ruling shorthand say `rewind=30s`, while the current endpoint-specific Ably SSE API table defines `rewind` as an integer message count and Ably's general Rewind page also describes time specifiers. Rather than choose between conflicting primary descriptions or accidentally turn 30 seconds into 30 messages, P3-F omits rewind. This also prevents P3-G from timestamping replayed old beats as newly seen and extending a ghost beyond its 50-second roster expiry. Durable consumers fetch their own initial state; a visible presence peer announces immediately and then within 20 seconds.
- **One connection, two channels:** The current SSE reference documents comma-separated `channels`. One subscription is used to avoid doubling browser connections; the provider `channel` field is mandatory for routing, and P2-F's server-only durable trust boundary is applied logically after the shared transport receives the envelope.
- **Token text:** Current Ably literal and persisted tokens are short ASCII token strings; P3-F narrows its accepted browser value to printable ASCII so raw query encoding and `btoa` REST authentication cannot disagree. A future non-ASCII token format requires a reviewed encoding change.
- **Seven-second token budget:** P2-F gives its outbound provider mint five seconds. Seven seconds gives that Function two seconds of same-origin transport/serialization headroom while keeping activation finite. REST publication uses five seconds because it is already talking directly to Ably.
- **Lifecycle reacquisition:** Retrying an initial token acquisition aborted specifically by BFCache suspension is completion of the original activation, not a provider-error refresh. Once a token exists, it is never proactively refreshed by time, visibility, online state, or pageshow.
- **Bus/API seam:** The plan names `doc:event` but did not close its detail or publication surface. The flat discriminated objects and one frozen `publish()` method above are the smallest stable seam that lets P3-G and P4-I act without seeing credentials or transport objects.

### Open questions

None block implementation. The optional disposable-provider smoke should record only pass/fail and the documentation date if Ably's live CORS, enveloped JSON encoding, multi-channel routing, or error event differs from the current official references. Do not add speculative rewind, loosen channel capability, accept a raw/unattributed client event, print credentials, or add an SDK as an ad hoc workaround; revise the owning ticket through review.

## References

- `docs/research/00-integration-plan.md` §§1.2, 1.3, 1.4, 1.6, 4.1, 4.5, and 4.7 — session activation, permanent document identity, offline/artifact behavior, optional hosted realtime, ordered template slots, polling fallback boundary, and authoritative P3-F/P3-G/P4-H/P4-I ticket split.
- `docs/research/07-realtime-and-presence.md` §§4, 6–12, and 14 — ephemeral-state boundary, broker/SSE/REST design, six event names, four degradation gates, privacy, client transport sketch, downstream ownership, and provider facts that required current verification.
- `docs/tickets/P1-B.md` — exact `{{REALTIME_JS}}` slot, generated metadata/namespace, inline module order, missing-file behavior, and shared-generated-output boundary.
- `docs/tickets/P2-C.md` — exact P2-C platform gate, root state, frozen session detail, synchronous one-shot `session` dispatch, and downstream-listener order.
- `docs/tickets/P2-F.md` — exact origin/version/channels, five-field TokenDetails, capability and client identity, token endpoint/error behavior, separated trust boundary, and server event envelopes.
- [Ably SSE API reference](https://ably.com/docs/api/sse) — `/sse`, multiple `channels`, `accessToken`, `lastEvent`, enveloped Message/ErrorInfo data, and the narrower integer rewind table that makes the older duration shorthand unsafe to assume.
- [Ably SSE guide](https://ably.com/docs/protocols/sse) — native EventSource reconnect, 40140–40149 refresh, close-before-replace, `lastEvent` continuity, multi-channel options, and SSE rewind support.
- [Ably Rewind](https://ably.com/docs/channels/options/rewind) — the broader general message-count/time-specifier behavior whose mismatch with the endpoint-specific table is resolved here by omitting speculative replay.
- [Ably REST API reference](https://ably.com/docs/api/rest-api) — raw publish route/body, token Bearer Base64 encoding, 201 acknowledgement, ErrorInfo shape, and token string limits.
- [WHATWG HTML, Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) — EventSource constructor/credentials, native reconnection/backoff, Last-Event-ID behavior, ready states, and close/Document cleanup semantics.
- GitHub issue #19 — tracker pointer to this canonical document and unchanged ticket title; the full specification remains document-only.
