# P2-F — The realtime server contract

## Outcome

The repository has one optional, server-only Ably boundary: a helper that mints a one-document, one-hour token for an authorized reader, a best-effort helper that publishes the two server event shapes, and a Functions v2 `GET /api/realtime-token` endpoint that fails closed for identity and document access while staying silent when realtime is not configured.

## Context

Hosted documents need a short-lived credential for Ably's subscribe-only SSE transport and a server fan-out seam for durable comment and edit changes. The browser must never receive the Ably API key, and a realtime outage must never make a durable write fail. Realtime is an optional accelerator: polling and the durable state remain authoritative.

The ruling plan assigns P2-F two new files and says that both helpers return `null` when `ABLY_API_KEY` is absent. Research document 07 calls the success value an Ably `TokenRequest`, but its client example consumes `tok.token`. Ably's current REST contract resolves that mismatch: `POST /keys/{keyName}/requestToken` accepts an unsigned request under Basic authentication and returns `TokenDetails`, whose `token` string is suitable for the SSE API's `accessToken` query parameter. This ticket returns a validated, reduced `TokenDetails` object and never returns the API key, `keyName`, Basic header, or provider error body.

## Scope

### In scope

- Create `netlify/lib/realtime.mjs` with exactly two production exports: `mintToken(session, docId)` and `publish(docId, event)`.
- Use the built-in Node 22 `fetch`, `Buffer`, Web `Response`, `AbortSignal`, and `node:crypto`; add no package or lockfile.
- Treat an absent or empty `ABLY_API_KEY` as the single off switch. Both helpers return `null` without input validation or network work in that state.
- Exchange an unsigned token request for Ably `TokenDetails` over HTTPS with a one-hour TTL, subscribe-only access to exactly `doc:<docId>:server`, and publish/subscribe access to exactly `doc:<docId>:client`.
- Bind an organization reader's token to the trusted Identity `sub`; bind an external reader's token to a fresh opaque `g_` identifier for each mint.
- Publish only `thread.changed` with a thread ID or `edit.saved` with an anchor ID and content hash.
- Create the Functions v2 `GET /api/realtime-token?doc=<docId>` endpoint with exact method, disabled, authentication, validation, authorization, provider-failure, cache, and origin behavior.
- Verify the provider boundary against a deterministic local HTTP mock. Optionally verify it against a disposable Ably application without using production content or credentials.

### Out of scope

- Client SSE attachment, token refresh, `EventSource`, polling, `degrade()`, the `doc:event` browser bus, or any template file. P3-F owns them.
- Presence heartbeats, `bye`, editing claims, releases, avatars, labels, visibility controls, or presence persistence. P3-G and P4-I own them.
- Calling `publish()` from a write path or amending `notify.mjs`, `threads.mjs`, `thread.mjs`, or `edit.mjs`. P4-H owns the single fan-out integration point after P4-D creates `notify.mjs`.
- Durable storage, message history, retries, queues, delivery receipts, replay state, WebSockets, an Ably SDK, or a second realtime provider.
- Creating or editing `package.json`, `netlify.toml`, an environment file, an access helper, identity code, generated output, or provider-side application settings.
- Accepting a slug, path, instance name, channel, capability, TTL, client ID, event name, actor, display name, email address, or message text from a browser request.
- Correcting P3-F's client URL or `rewind` parameter in this ticket. The downstream contract section records the current provider fact for P3-F to handle.

## Interface contract

### Shared constants and validation

`netlify/lib/realtime.mjs` keeps these values private and literal:

```js
const ABLY_ORIGIN = "https://main.realtime.ably.net";
const ABLY_VERSION = "1.2";
const TOKEN_TTL_MS = 3_600_000;
const PROVIDER_TIMEOUT_MS = 5_000;
const PROVIDER_CLOCK_SKEW_MS = 60_000;
const DOC_ID_RE = /^[0-9a-f]{6}$/;
const IDENTITY_SUB_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const THREAD_ID_RE = /^t_[0-9a-z]+_[0-9a-f]{8}$/;
const AID_RE = /^a[0-9a-f]{8}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
```

The permanent six-lowercase-hex `docId` is the only accepted document identity. Form two disjoint channels internally: the server-only durable-event channel is `doc:${docId}:server`, and the client ephemeral channel is `doc:${docId}:client`. Never accept either channel name from a caller. A readable browser may subscribe to the server channel and publish/subscribe on the client channel, but it receives no capability to publish on the server channel. Consequently, no browser holding a valid P2-F token can forge `thread.changed`, `edit.saved`, or any later server-owned projection on the namespace P3-F treats as authoritative.

Read `process.env.ABLY_API_KEY` at call time so tests and local development can change the switch without re-importing the module. `undefined`, the empty string, and an all-whitespace value mean disabled. A nonempty configured value is valid only when it has no leading or trailing whitespace and matches exactly `<keyName>:<secret>` with one colon and a nonempty segment on each side. Empty key names/secrets, a trailing colon, or a second colon are invalid. The full configured string is the Basic credential; `keyName` is the sole segment before the colon. Never trim, rewrite, print, persist, or return a configured key.

Every Ably request uses `AbortSignal.timeout(5_000)`. A timeout is handled exactly like a network failure. Every provider request uses HTTPS, `Accept: application/json`, and `X-Ably-Version: 1.2`. Neither helper follows a caller-supplied URL.

Where this ticket requires a plain object, the value must be non-null and non-array, must not be a Proxy according to Node's `isProxy()` from `node:util/types`, its prototype must be exactly `Object.prototype`, and every own property must be an ordinary enumerable, writable, configurable string-keyed data property. A null-prototype object, class instance, custom prototype, accessor, non-enumerable/read-only/non-configurable property, symbol key, or Proxy is not plain. Validation checks `isProxy()` before any reflective operation and performs every prototype/key/descriptor inspection inside one defensive `try`/`catch`; a throwing reflection trap therefore fails closed without invoking a getter. This definition governs the parsed capability object, every `publish()` event and nested emitted data object, and the endpoint's resolved access result; the narrower exact-key rules still apply afterward.

Local contract violations throw a `TypeError` with one of these exact safe messages and perform no provider request:

| Condition while configured | Error |
|---|---|
| Invalid `docId` | `Invalid document id` |
| `session` is not a non-null object; `session.sub` does not match `^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$`; or `session.isOrg` is not boolean in `mintToken()` | `Invalid realtime session` |
| Unknown, malformed, or extra-key event in `publish()` | `Invalid realtime event` |

The disabled check happens first, so the same bad inputs return `null` without throwing when the key is absent.

### `mintToken(session, docId)`

Export this exact signature and result shape:

```js
/**
 * @param {{sub: string, isOrg: boolean}} session
 * @param {string} docId
 * @returns {Promise<null | {
 *   token: string,
 *   issued: number,
 *   expires: number,
 *   capability: string,
 *   clientId: string
 * }>}
 */
export async function mintToken(session, docId)
```

The function does not decide document access. Its endpoint caller must first obtain `session` from `identify(req)`, call `resolveRole(docId, session)`, and continue only for `canRead === true`. This separation keeps the provider helper independent of the access store while preventing the endpoint from treating identity as authorization.

When disabled, resolve to `null` immediately. When configured, validate the inputs, parse the key, and derive:

- `serverChannel = "doc:" + docId + ":server"`.
- `clientChannel = "doc:" + docId + ":client"`.
- `capability = JSON.stringify({ [serverChannel]: ["subscribe"], [clientChannel]: ["publish", "subscribe"] })`. This exact request has two channels and three grants: subscribe-only on the server namespace, plus publish and subscribe on the client namespace. It has no wildcard, server-channel publish, presence, history, annotation, or other operation.
- `clientId = session.sub` when `session.isOrg === true`.
- `clientId = "g_" + randomBytes(6).toString("hex")` when `session.isOrg === false`. It is a fresh 14-character value on every call, is never stable across refreshes, and contains no `sub`, email, name, IP address, role, document ID, or browser value.

Send this exact exchange, where the path segment is `encodeURIComponent(keyName)` and the invented values illustrate shape only:

```http
POST https://main.realtime.ably.net/keys/demo123.key456/requestToken
Authorization: Basic <RFC-4648-base64 of the full API key>
Accept: application/json
Content-Type: application/json
X-Ably-Version: 1.2

{"keyName":"demo123.key456","ttl":3600000,"capability":"{\"doc:4b7d2a:server\":[\"subscribe\"],\"doc:4b7d2a:client\":[\"publish\",\"subscribe\"]}","clientId":"u_fixture_member_17","timestamp":1788364800000,"nonce":"0123456789abcdef0123456789abcdef"}
```

The implementation samples `requestTimestamp = Date.now()` immediately before the request, sends that integer as `timestamp`, and generates `nonce` as 16 cryptographically random bytes encoded as 32 lowercase hexadecimal characters. It samples `responseTimestamp = Date.now()` immediately after parsing the response and before validation. It uses unsigned request-token exchange under Basic authentication; it does not calculate or send `mac`.

Accept any HTTP 200–299 response only after parsing JSON and validating all of these facts:

- `token` is a nonempty string.
- `issued` and `expires` are finite integers; `issued >= requestTimestamp - 60_000`; `issued <= responseTimestamp + 60_000`; `expires > responseTimestamp`; `expires > issued`; `expires - issued <= 3_600_000`; and `expires <= responseTimestamp + 3_600_000 + 60_000`. These checks tolerate one minute of provider clock skew while rejecting a token that is already expired, implausibly future-issued, stale-issued, or longer-lived than requested.
- `clientId` exactly equals the requested client ID.
- `capability` is a JSON string that parses to a plain object under the exact shared definition above, with exactly the requested server and client channel own keys in either order. The server value has prototype exactly `Array.prototype`, own keys exactly `"0"` and `"length"`, an ordinary enumerable/writable/configurable index descriptor, the ordinary non-enumerable/writable/non-configurable length descriptor with value `1`, and sole value `subscribe`. The client value has prototype exactly `Array.prototype`, own keys exactly `"0"`, `"1"`, and `"length"`, ordinary enumerable/writable/configurable index descriptors, the ordinary non-enumerable/writable/non-configurable length descriptor with value `2`, and values exactly `publish` and `subscribe`, once each, in either order. Sparse arrays, accessors, symbols, subclass/custom prototypes, extra keys, and `publish` anywhere on the server channel are invalid. Channel-key order and client-operation order in Ably's canonical response are not trusted.

Ignore any additional provider response keys, including `keyName`, and return a fresh object with exactly `token`, `issued`, `expires`, `capability`, and `clientId`. Never cache or persist it.

A malformed configured key, timeout, fetch rejection, non-2xx status, JSON parse failure, or response that widens or fails the validation above rejects with a newly constructed `new Error("Realtime provider unavailable")` whose `cause` is absent. Catch the complete provider/configuration operation and deliberately discard the original error graph: no nested `cause`, `AggregateError.errors`, enumerable error property, provider response, configured key, URL containing credentials, or Ably `ErrorInfo` body may survive on the returned error. The endpoint maps this one safe operational failure to 502.

### `publish(docId, event)`

Export this exact signature and discriminated event contract:

```js
/**
 * @param {string} docId
 * @param {
 *   | {t: "thread.changed", threadId: string}
 *   | {t: "edit.saved", aid: string, hash: string}
 * } event
 * @returns {Promise<null | {channel: string, messageId: string}>}
 */
export async function publish(docId, event)
```

When disabled, resolve to `null` before validation and without network work. When configured, reject a Proxy before reflection, require prototype exactly `Object.prototype`, require no symbol keys, and accept only the exact own string-key sets below. Every required property must have an ordinary enumerable, writable, configurable data descriptor; accessors, non-enumerable/read-only/non-configurable properties, inherited properties, null/custom prototypes, arrays, class instances, and extra keys are invalid without invoking a getter:

| Input | Required validation | Ably message body |
|---|---|---|
| `{t: "thread.changed", threadId}` | keys exactly `t`, `threadId`; `threadId` matches `^t_[0-9a-z]+_[0-9a-f]{8}$` | `{"name":"thread.changed","data":{"threadId":"t_m8x2k1_4f7a9c31"}}` |
| `{t: "edit.saved", aid, hash}` | keys exactly `t`, `aid`, `hash`; `aid` matches `^a[0-9a-f]{8}$`; `hash` matches `^[0-9a-f]{64}$` | `{"name":"edit.saved","data":{"aid":"a3f19c2b","hash":"8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277"}}` |

Extra keys are invalid even when their values are empty. The newly constructed message and nested `data` value are ordinary closed objects with exactly the shown enumerable, writable, configurable data properties and no symbols or accessors. Do not include `clientId`, actor, role, name, email, comment text, edited text, source path, slug, or any other field. Presence and client-originated `beat`, `bye`, `edit.claim`, and `edit.release` are not accepted by this server helper; those four names exist only on `doc:<docId>:client` and can never be interpreted as a server projection.

Send the message with this exact provider request:

```http
POST https://main.realtime.ably.net/channels/doc%3A4b7d2a%3Aserver/messages
Authorization: Basic <RFC-4648-base64 of the full API key>
Accept: application/json
Content-Type: application/json
X-Ably-Version: 1.2

{"name":"edit.saved","data":{"aid":"a3f19c2b","hash":"8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277"}}
```

Encode the complete server channel as one path segment. Only HTTP 201 is a publish success. Parse its JSON, require `channel === "doc:" + docId + ":server"` and a nonempty string `messageId`, and return a fresh object with exactly those two keys. Ignore any extra provider response keys.

`publish()` is best effort by design. A malformed configured key, timeout, fetch rejection, non-201 response, invalid JSON, or malformed success body resolves to `null`; it does not reject, retry, log provider details, or throw. Local argument violations while configured still throw the exact `TypeError` above because they are programming errors, not provider degradation. P4-H may therefore pass the returned promise directly to `context.waitUntil()` after it has constructed a valid event: provider failure cannot change the durable write response.

### `GET /api/realtime-token`

Create `netlify/functions/realtime-token.mjs` as an ESM Functions v2 module with exactly this public surface:

```js
export default async function handler(req)
export const config = { path: "/api/realtime-token" }
```

Import `identify` from `../lib/identity.mjs`, `resolveRole` from `../lib/access.mjs`, and `mintToken` from `../lib/realtime.mjs`. Do not import `@netlify/identity`, read `clientContext`, decode a cookie or token, inspect `appMetadata.docs`, or make an independent role decision.

Handle requests in this exact order:

1. If `req.method !== "GET"`, return 405 with `Allow: GET`; do not read the key, identity, query, access store, or provider.
2. If `ABLY_API_KEY` is absent, empty, or all whitespace, return 204; do not read identity, query, access state, or provider. This makes one environment switch disable the entire feature.
3. Call `identify(req)` inside the handler's identity boundary. If it throws or rejects with any value, return the ordinary empty 500 response; do not inspect, classify, log, stringify, attach, or reflect the thrown value, and do not parse the query, resolve access, or contact the provider. This defensive boundary does not change P2-H's contract that its current `identify()` implementation resolves `null` on provider/session failure. If `identify(req)` resolves `null`, return 401 without parsing or authorizing the document.
4. Read `new URL(req.url).searchParams.getAll("doc")`. Require exactly one value matching `^[0-9a-f]{6}$`; otherwise return 400. Ignore no duplicate and accept no slug, blank, uppercase, path, fragment, or alternate query name. Other query parameter names are ignored.
5. Call `resolveRole(docId, session)`. Its rejection classifier never reads `thrown.name`, `thrown.code`, or `thrown.status` directly. Inside an enclosing defensive `try`/`catch`, reject proxies first, obtain own property descriptors for all three fields, require ordinary data descriptors, and compare only their descriptor values to `"StoreError"`, `"unavailable"`, and `503`; an accessor, inherited field, missing field, reflective trap, or any inspection failure is the ordinary 500 fallback. Only that exact descriptor-safe classification returns 503. If resolution succeeds, validate the result with the shared proxy-first, descriptor-safe plain-object rule and require `canRead` to be an own boolean data property; any reflective failure returns 500 and no getter runs. If `canRead === false`, return 403. Only `canRead === true` may continue; do not infer read access again from `role`, `shared`, `isOrg`, or identity presence.
6. Call `mintToken(session, docId)`. On its documented `Realtime provider unavailable` rejection, return 502. A defensive `null` at this point maps to 204 in case the environment changed during the request.
7. Return 200 with `JSON.stringify(tokenDetails)` and exactly the five documented result fields.

Every response, including 204, 400, 401, 403, 405, 500, 502, and 503, has `Cache-Control: private, no-store`. Every non-200 response has an empty, zero-byte body. The constructed header set is exact: ordinary non-200 responses have only `Cache-Control`; 405 has only `Allow: GET` plus `Cache-Control`; 200 has only `Content-Type: application/json` plus `Cache-Control`. Do not set `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, wildcard CORS, or a redirect. Do not reflect request data or provider error text in a body or header.

The handler does not call `requireOrigin()`: this is a read-only GET, matching the settled identity contract. Same-origin browser code later uses `fetch(..., {credentials: "same-origin"})`, and the absence of CORS response headers prevents browser JavaScript on another origin from reading the response. Identity plus `resolveRole()` remains the authorization boundary; Origin is not substituted for either check.

An invented success body is:

```json
{
  "token": "invented-token-value-not-a-credential",
  "issued": 1788364800000,
  "expires": 1788368400000,
  "capability": "{\"doc:4b7d2a:server\":[\"subscribe\"],\"doc:4b7d2a:client\":[\"publish\",\"subscribe\"]}",
  "clientId": "u_fixture_member_17"
}
```

### Secret handling

- Configure `ABLY_API_KEY` through the Netlify UI, CLI, or API as a site environment variable available to the Functions scope. Where Secrets Controller is available, mark it as containing secret values. Do not put it in `netlify.toml`, a committed or shared `.env` file, source, fixtures, issue text, logs, screenshots, command history, or browser code.
- Scope the provider key itself to only the channel capability needed by this application (`doc:*:server` publish/subscribe and `doc:*:client` publish/subscribe). The issued client token narrows this further to subscribe-only on one exact server channel and publish/subscribe on its paired client channel. Do not use an account-level key with broader administrative permissions.
- Use the API key only from the two server helpers and only in an HTTPS Basic header. Never place it in a URL, JSON body, response, thrown message, error `cause`, or structured log.
- Treat minted tokens as disposable credentials. Do not persist, reuse, log, or place them in test output. A one-hour token does not authorize a second document, and Ably's bound `clientId` prevents the client from claiming another identity.
- Deployment without a key is the normal default, not a broken configuration. A syntactically malformed nonempty key is an operator error: minting returns a sanitized 502 through the endpoint while publishing degrades to `null`.

## Files owned

- `netlify/lib/realtime.mjs` — **new**, created exclusively by P2-F.
- `netlify/functions/realtime-token.mjs` — **new**, created exclusively by P2-F.

No other implementation, configuration, package, generated, ticket, research, prompt, or template file is owned or amended by P2-F. `docs/tickets/P2-F.md` is this specification, not an implementation surface.

## Dependencies

The ruling Build Order lists P1-C and P1-E as P2-F dependencies. P1-C creates the root Node/Functions package plus `identify()`; P1-E selects Node 22, declares the Functions directory/bundler, and exposes `/api/*` outside the edge gate. Neither predecessor creates or configures `ABLY_API_KEY`; provider setup is an operator action for P2-F and remains optional.

The final authorization model creates a same-phase runtime dependency that the original table did not name. P2-H changes `identify()` to return `{sub, email, name, isOrg}` and P2-G creates the sole document authority `resolveRole(docId, user)`. P2-F must consume those published final contracts. It must not preserve P1-C's temporary `docs` check or infer organization status from email.

Use the maximum safe parallelism in these explicit waves:

1. **Prerequisite integration:** P1-C and P1-E are present. P2-H starts from P1-C.
2. **Maximum Phase 2 source wave before P2-B is green:** After each listed ticket's own declared predecessors are complete, integrated, and green, P2-A, P2-B, P2-C, P2-D, P2-E, P2-F, and P2-H may be authored concurrently only while every ticket stays on its declared, disjoint source files. P2-F and the other disjoint tickets may therefore author alongside P2-B, but P2-G does not start in this wave. P2-F writes only its two new files and authors imports against P2-G/P2-H's published signatures. Tests use isolated temporary roots and do not share a linked site or provider application.
3. **Access source and authorization integration wave:** P2-G starts only after P2-B's complete one-file contract is integrated and green. Integrate P2-G, and integrate P2-H after P1-C. Rebase P2-F onto the resulting `access.mjs` and final `identity.mjs`; run the deterministic endpoint suite only then. Missing `access.mjs` or `session.isOrg` is an expected pre-integration state, not permission to add a fallback.
4. **Serialized runtime gate:** one integrator runs package installation, Netlify/dev or direct module acceptance, generated-site checks, and any optional disposable-provider smoke on the combined tree. `node_modules`, `_site/**`, `.netlify/**`, ports, environment variables, and an Ably application are shared runtime surfaces and are not concurrent source ownership.

Downstream boundaries are exact:

- P3-F receives the five-field 200 JSON, uses only its raw `token` value as the percent-encoded `accessToken` query value, and opens its durable-event SSE stream only for `doc:<docId>:server`. It accepts `thread.changed`, `edit.saved`, and every later server-owned projection only from that server channel; it never treats any message on `doc:<docId>:client` as a server projection. It treats every non-200 response—including 204, 401, 403, 500, 502, and 503—plus fetch failure, invalid JSON, and no `EventSource` as silent degradation. It does not receive the API key or derive capabilities. Current official Ably SSE documentation defines `rewind` as an integer message count, not the research document's `rewind=30s`; P3-F must reconcile its URL with the current SSE API rather than changing P2-F.
- P4-H imports `publish` after P4-D creates `netlify/lib/notify.mjs`. Its one fan-out point calls `context.waitUntil(publish(docId, event))` only after the durable write has succeeded. It passes exactly `{t: "thread.changed", threadId}` or `{t: "edit.saved", aid, hash}` and does not retry or turn `null` into a write failure. Only this server helper publishes those names, and it always targets `doc:<docId>:server` with the server API key.
- P3-G and P4-I may later use the token's client publish/subscribe capability for ephemeral `beat`, `bye`, `edit.claim`, and `edit.release` messages only on `doc:<docId>:client`. They never publish to the server channel, and P2-F neither sends nor stores their client events.

## Acceptance criteria

- [ ] Only the two owned implementation files are added, with no dependency, SDK, configuration, lockfile, generated-output, access, identity, or template change.
- [ ] `realtime.mjs` exports exactly `mintToken` and `publish`, with the documented signatures, result projections, validation, timeout, and error/degradation semantics.
- [ ] With no effective `ABLY_API_KEY`, both helpers resolve to `null` before validating bad arguments and make zero fetch calls.
- [ ] With the key configured, `mintToken()` accepts only the exact 1–128-character identity-subject grammar and a boolean `isOrg`, rejecting all other session/document inputs before fetch with the documented safe `TypeError`.
- [ ] Token minting sends the exact HTTPS request-token path, Basic header, JSON fields, version header, TTL, nonce shape, two-channel capability, and bound client ID; it returns only a validated five-field `TokenDetails` projection. The browser can subscribe but cannot publish on `doc:<docId>:server`; its publish/subscribe grant is confined to `doc:<docId>:client`, so client traffic cannot forge a server projection.
- [ ] TokenDetails time validation is tied to the request and response clock samples with the exact one-minute skew bound; already-expired, stale-issued, implausibly future-issued, and overlong tokens are rejected.
- [ ] Organization sessions use their trusted `sub`; external sessions get a fresh `g_` plus 12 lowercase hex value for every mint, with no stable or personal value embedded. The deterministic crypto seam proves one 6-byte entropy request per external client ID and one 16-byte entropy request per nonce without relying on chance inequality.
- [ ] A configured mint rejects every provider/configuration failure with only `Realtime provider unavailable`; recursive inspection of `cause`, aggregate errors, and attached properties proves that neither secrets, raw responses, nor provider details enter the error or response.
- [ ] Publishing accepts only the two exact discriminated, non-Proxy closed event objects, converts them to exact ordinary Ably `name`/`data` messages containing IDs and the edit hash only, and rejects prototype, symbol, descriptor, accessor, Proxy, or extra-key violations before fetch without invoking getters or traps after proxy detection.
- [ ] Publishing uses the exact encoded `doc:<docId>:server` REST path and succeeds only on a valid HTTP 201 acknowledgement with a nonempty string message ID; all provider/configuration failures resolve to `null` and never endanger a durable write.
- [ ] The Functions v2 endpoint is available only at `/api/realtime-token`, owns its 405 behavior, maps any `identify(req)` throw to an ordinary empty 500, and follows the documented short-circuit order for 204, identity-500/401, 400, 403, access-500/503, 502, and 200.
- [ ] Every endpoint response is `private, no-store`; non-200 bodies are zero bytes; 200 exposes exactly five token fields; no response enables CORS or exposes request/provider/secret data.
- [ ] The endpoint obtains identity only through `identify()` and document authority only through `resolveRole().canRead`; it distinguishes access 500/503 failures exactly and does not use P1-C's temporary `docs` field, a client claim, a role inference, or an Origin header as authorization. Mandatory post-integration acceptance proves that `identify` receives the actual `Request`, `resolveRole` receives the parsed `docId` and the exact returned session reference, and only that `canRead` decision permits minting for the same document.
- [ ] The deterministic mock suite covers success; off; strict identity/access argument binding; authorization; identity failure; malformed input; 200, 201, 202, and upper-bound valid mint statuses; valid-body publish 200 rejection; provider timeout/failure; exact provider requests; recursive error privacy; and best-effort publish without external network access. Its clock seam proves exactly one request sample is taken before fetch and one response sample after parse, accepts the exact stale/future/expiry boundaries, and rejects the one-millisecond-outside and `expires <= issued` cases. Its response-shape matrix accepts reversed client operations/channel order but rejects empty/non-string tokens, noninteger times, null/array/malformed/wrong/missing channels, server publish, and missing/duplicated/widened operations under the exact object/array prototype, key, and descriptor rules. Its endpoint matrix rejects null-prototype, custom-prototype, class, accessor, non-enumerable, symbol-bearing, missing, non-boolean, and Proxy access results without invoking getters; descriptor-safe thrown-error classification maps only the exact own-data StoreError triple to 503 and encloses hostile reflection in a 500 fallback. Cross-cases prove method-before-key with zero key reads, identity-before-query, and safe handling of primitive or hostile thrown access values. The suite also rejects empty/trailing/multicolon keys, empty/non-string publish message IDs, and symbol/non-enumerable/accessor/custom-prototype/Proxy events, and asserts exact exports for both modules.
- [ ] On macOS/Linux unless a live P2-H owner completes the canonical authenticated handshake below, the complete marked fixture runs below one retained positive detached process-group anchor with a 180-second deadline. HUP/INT/TERM ownership is installed before the guarded `p2f.*` root is created; the first signal remains authoritative as 129/130/143 through containment and the final exit; natural HUP/INT/TERM/KILL child exits preserve 129/130/143/137; and TERM-to-KILL escalation, direct-anchor reaping/stream closure, and group-disappearance proof finish before bounded recursive root deletion. Every negative-PGID signal is preceded by a fresh proof that the unreaped direct anchor still leads and belongs to that PGID.
- [ ] Standalone exact-source self-tests use the same terminal handlers, status helper, retained anchor, and bounded deletion helper to prove every real HUP/INT/TERM at early, active, post-result, final-cleanup, and timeout-cleanup stages; a distinct second terminal signal during final cleanup with the first status still authoritative; the closed natural-signal mapping; publication-before-command failure; actual pre-spawn and active write/chmod/rename/post-write evidence failures; deletion-worker asynchronous spawn failure; failed and timed-out recursive deletion; timeout cleanup of a TERM-resistant descendant; and cleanup of a delayed descendant after its parent exits. Every recursive self-test itself runs under a separately retained detached anchor with a finite command deadline, TERM-to-KILL escalation, direct-leader reaping, stream-close proof, and group-disappearance proof. The timeout-cleanup cases prove a directly received signal outranks 124 while containment still completes. Evidence remains until bounded recursive deletion succeeds and is retained on uncertainty. An unproved group or deletion retains the validated root plus mode-0600 actionable metadata and prints the exact safe root/evidence/supervisor-PID/leader-PGID locator; pre-root remediation writes only below an already canonical explicitly safe temp parent and never in an empty/cwd or `/` path. All successful probes and the fixture leave no `p2f.*` or remediation residue.
- [ ] `P2H_OWNER_NONCE` never selects inherited mode by itself. P2-H must also expose child-readable fd 4, child-writable fd 5, exact `P2H_OWNER_RESPONSE_FD=4` / `P2H_OWNER_REQUEST_FD=5`, and the same HMAC-SHA-256 `claim` → `reserve` → `release` protocol P2-A specifies. A missing, closed, silent, stale, replayed, wrong-MAC, wrong-PGID, dead-owner, malformed, otherwise hostile, or insufficient-budget handshake falls back to the finite standalone owner without an unowned root. A valid reservation transfers the nonexistent direct `p2f.??????` root and sibling `.p2f.??????.evidence.json` to P2-H before creation. Inherited mode is not committed until reservation succeeds and at least the fixed 105-second worker budget plus 1-second TERM grace, 2-second KILL/reap wait, 5-second release exchange, and 1-second safety margin remain. The claim must have 116 seconds remaining before reservation, at least 115 seconds must remain immediately after reservation, and the full 114 seconds must remain after setup at mode commit. Thus a 251–499 ms lease—and every lease below those stage-specific thresholds—is unusable. Any post-reservation budget loss is authentically released/deleted before standalone fallback. The inherited command deadline reserves all cleanup/release budgets, and its direct child receives TERM then KILL and is reaped before release on timeout/interruption. P2-H's outside-group owner performs bounded deletion after authenticated release and after any inherited-group KILL, so it cannot report clean while either path remains. The inherited worker never detaches, calls `setsid`, double-forks, or daemonizes and emits exactly the original five runtime PASS lines.
- [ ] Optional live verification uses a disposable, least-privileged Ably application and invented IDs/content, prints no credential/token, leaves no local process/file/environment residue, and deletes or revokes the disposable provider resources.

## Test plan

### Required static and deterministic mock verification

Run this complete fixture from the repository root on Node 22 after P2-G and P2-H are integrated. In mandatory standalone mode on macOS/Linux, the wrapper first runs its process-supervisor proofs and then executes the complete unchanged worker body below one retained detached anchor and finite deadline. Merely setting owner-looking environment values does not change modes: inherited execution begins only after P2-H completes the canonical P2-A-compatible fd 4/fd 5 HMAC claim, supplies the stage-specific 116/115/114-second remaining budgets, and reserves both guarded paths before creation. P2-H's marker oracle must also exercise signed 251 ms, 499 ms, and 115,999 ms claims and prove they never reach `reserve`; it delays a valid reservation response past the post-reserve threshold and proves P2-F sends authenticated `release`, both paths are absent, and standalone fallback—not a partial inherited run—follows. Missing, hostile, or insufficient owner communication takes the same finite standalone path. Under an authenticated sufficient lease the ordinary, non-detached worker remains in P2-H's anchor group and P2-H's outside-group owner is responsible for bounded release/KILL cleanup of every registered path. The worker copies only P2-F's real modules, supplies strict argument-aware identity/access seams inside an isolated root, installs a deterministic `node:crypto` loader seam, binds a provider mock to a random loopback port, forwards only the fixed Ably origin, and performs no external request. The identity seam rejects any object other than the actual handler `Request`; the access seam rejects any document other than the parsed query value or any session other than the exact object reference returned by identity. Provider request assertions then prove that the permitted document is the document minted. The Authorization value is checked only in memory and is never stored in the request records or printed.

This isolated suite is not, by itself, called P2-G/P2-H integration acceptance. Mandatory post-integration authority acceptance is the conjunction of this source-bound P2-F runtime suite and P2-H Test plan step 3 on the same combined commit: that step AST-binds the endpoint's real imports and result flow to the integrated `identity.mjs` and `access.mjs`, while this suite proves the fail-closed behavior with strict seams. P2-H step 4 locates and executes this exact marked fixture. A mocked-only result, a P2-H structural result without this runtime suite, or results from different commits do not satisfy final authorization acceptance.

```bash
# P2-F runtime authority fixture
(
set -eu
P2F_INHERITED_STATUS=200
if [ "${P2H_OWNER_REQUEST_FD:-}" = 5 ] &&
   [ "${P2H_OWNER_RESPONSE_FD:-}" = 4 ] &&
   [ -r /dev/fd/4 ] && [ -w /dev/fd/5 ] &&
   printf '%s' "${P2H_OWNER_NONCE:-}" | grep -Eq '^[0-9a-f]{32}$'; then
  set +e
  node --input-type=module 3<&3 4<&4 5>&5 <<'NODE'
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {createHmac, randomBytes} from "node:crypto";
import {
  chmodSync, closeSync, createReadStream, existsSync, lstatSync, mkdirSync,
  realpathSync, renameSync, statSync, writeFileSync, writeSync,
} from "node:fs";
import {basename, dirname, join} from "node:path";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nonce = process.env.P2H_OWNER_NONCE ?? "";
const SIGNAL_STATUS = Object.freeze({SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137});
const INHERITED_WORKER_BUDGET_MS = 105_000;
const INHERITED_TERM_GRACE_MS = 1_000;
const INHERITED_KILL_REAP_MS = 2_000;
const INHERITED_RELEASE_MS = 5_000;
const INHERITED_SAFETY_MS = 1_000;
const INHERITED_CLEANUP_BUDGET_MS = INHERITED_TERM_GRACE_MS +
  INHERITED_KILL_REAP_MS + INHERITED_RELEASE_MS + INHERITED_SAFETY_MS;
const INHERITED_REQUIRED_AT_COMMIT_MS = INHERITED_WORKER_BUDGET_MS +
  INHERITED_CLEANUP_BUDGET_MS;
const INHERITED_RESERVE_AND_SETUP_MS = 2_000;
let signalStatus = 0;
let signalResolve;
const interrupted = new Promise((resolve) => { signalResolve = resolve; });
for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(name, () => {
    if (signalStatus !== 0) return;
    signalStatus = SIGNAL_STATUS[name];
    process.exitCode = signalStatus;
    signalResolve({kind: "signal", status: signalStatus});
  });
}
const finalStatus = (fallback) => signalStatus || fallback;
const processGroup = (pid) => {
  const output = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  assert.match(output, /^[0-9]+$/);
  const pgid = Number(output);
  assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
  return pgid;
};
const hmac = (value) => createHmac("sha256", Buffer.from(nonce, "hex"))
  .update(JSON.stringify(value)).digest("hex");
let ownerInput = null;
let ownerBuffer = "";
const ownerLines = [];
const ownerWaiters = [];
let ownerFailed = false;
function startOwnerChannel() {
  if (ownerInput !== null) return;
  ownerInput = createReadStream(null, {fd: 4, autoClose: false});
  ownerInput.setEncoding("utf8");
  ownerInput.on("data", (chunk) => {
    ownerBuffer += chunk;
    if (Buffer.byteLength(ownerBuffer) > 16_384) { ownerFailed = true; ownerBuffer = ""; }
    for (;;) {
      const newline = ownerBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = ownerBuffer.slice(0, newline);
      ownerBuffer = ownerBuffer.slice(newline + 1);
      const waiter = ownerWaiters.shift();
      if (waiter) waiter(line); else ownerLines.push(line);
    }
  });
  ownerInput.on("error", () => { ownerFailed = true; });
  ownerInput.on("end", () => { ownerFailed = true; });
}
async function readOwnerLine(milliseconds) {
  if (ownerFailed) throw new Error("owner response channel closed");
  if (ownerLines.length) return ownerLines.shift();
  let timer;
  const line = await Promise.race([
    new Promise((resolve) => ownerWaiters.push(resolve)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("owner response timeout")), milliseconds);
    }),
  ]);
  clearTimeout(timer);
  return line;
}
async function exchange(action, fields, milliseconds = 1_000) {
  startOwnerChannel();
  const request = {version: 1, action, ...fields};
  writeSync(5, `${JSON.stringify({...request, mac: hmac(request)})}\n`);
  const response = JSON.parse(await readOwnerLine(milliseconds));
  const {mac, ...signed} = response ?? {};
  assert.equal(response?.version, 1);
  assert.equal(response?.action, `${action}-ack`);
  assert.equal(typeof mac, "string");
  assert.equal(mac, hmac(signed));
  for (const [key, value] of Object.entries(fields)) assert.equal(response[key], value);
  return response;
}
function closeOwnerChannel() {
  try { ownerInput?.destroy(); } catch {}
  for (const descriptor of [4, 5]) try { closeSync(descriptor); } catch {}
}
function writeEvidence(path, value) {
  const pending = `${path}.new`;
  writeFileSync(pending, `${JSON.stringify(value)}\n`, {mode: 0o600});
  chmodSync(pending, 0o600);
  renameSync(pending, path);
  chmodSync(path, 0o600);
  assert.equal(statSync(path).mode & 0o777, 0o600);
}

let lease = null;
let root = "";
let evidencePath = "";
let reserved = false;
let inheritedCommitted = false;
let inheritedWorkerDeadlineMs = 0;
try {
  assert.ok(["darwin", "linux"].includes(process.platform));
  assert.match(nonce, /^[0-9a-f]{32}$/);
  const challenge = randomBytes(16).toString("hex");
  const claim = await exchange("claim", {challenge, childPid: process.pid});
  assert.ok(Number.isSafeInteger(claim.ownerPid) && claim.ownerPid > 1);
  assert.ok(Number.isSafeInteger(claim.anchorPgid) && claim.anchorPgid > 1);
  assert.ok(Number.isSafeInteger(claim.leaseDeadlineMs));
  const claimNow = Date.now();
  assert.ok(claim.leaseDeadlineMs >= claimNow + INHERITED_REQUIRED_AT_COMMIT_MS +
    INHERITED_RESERVE_AND_SETUP_MS && claim.leaseDeadlineMs <= claimNow + 120_000);
  assert.equal(typeof claim.ownerRoot, "string");
  assert.ok(claim.ownerRoot.startsWith("/") && claim.ownerRoot !== "/");
  assert.equal(realpathSync(claim.ownerRoot), claim.ownerRoot);
  const ownerRootStats = lstatSync(claim.ownerRoot);
  assert.equal(ownerRootStats.isDirectory(), true);
  assert.equal(ownerRootStats.isSymbolicLink(), false);
  assert.equal(processGroup(process.pid), claim.anchorPgid);
  assert.equal(processGroup(claim.anchorPgid), claim.anchorPgid);
  assert.notEqual(processGroup(claim.ownerPid), claim.anchorPgid);
  process.kill(claim.ownerPid, 0);
  lease = claim;
  if (signalStatus !== 0) throw new Error("interrupted before owner reservation");
  for (let attempt = 0; attempt < 32 && root === ""; attempt += 1) {
    const suffix = randomBytes(6).toString("base64url").replace(/[-_]/g, "a").slice(0, 6);
    const candidate = join(claim.ownerRoot, `p2f.${suffix}`);
    const candidateEvidence = join(claim.ownerRoot, `.p2f.${suffix}.evidence.json`);
    if (existsSync(candidate) || existsSync(candidateEvidence)) continue;
    await exchange("reserve", {
      challenge, childPid: process.pid, anchorPgid: claim.anchorPgid,
      guardedRoot: candidate, evidencePath: candidateEvidence,
    }, INHERITED_RESERVE_AND_SETUP_MS);
    root = candidate;
    evidencePath = candidateEvidence;
    reserved = true;
    if (signalStatus !== 0) throw new Error("interrupted after owner reservation");
    assert.ok(claim.leaseDeadlineMs >= Date.now() +
      INHERITED_REQUIRED_AT_COMMIT_MS + 1_000);
  }
  assert.notEqual(root, "");
  mkdirSync(root, {mode: 0o700});
  chmodSync(root, 0o700);
  assert.equal(dirname(root), lease.ownerRoot);
  assert.match(basename(root), /^p2f\.[A-Za-z0-9]{6}$/);
  assert.equal(realpathSync(root), root);
  writeEvidence(evidencePath, {
    version: 1, state: "active", protocol: "p2-h-owned-root/v1",
    guardedRoot: root, evidencePath, childPid: process.pid,
    anchorPgid: lease.anchorPgid, ownerPid: lease.ownerPid,
  });
  const commitNow = Date.now();
  assert.ok(lease.leaseDeadlineMs >= commitNow + INHERITED_REQUIRED_AT_COMMIT_MS);
  inheritedWorkerDeadlineMs = commitNow + INHERITED_WORKER_BUDGET_MS;
  inheritedCommitted = true;
} catch {
  if (reserved && lease !== null) {
    try {
      await exchange("release", {
        challenge: lease.challenge, childPid: process.pid, anchorPgid: lease.anchorPgid,
        guardedRoot: root, evidencePath,
      }, Math.max(1, Math.min(INHERITED_RELEASE_MS, lease.leaseDeadlineMs - Date.now())));
      assert.equal(existsSync(root), false);
      assert.equal(existsSync(evidencePath), false);
      closeOwnerChannel();
      process.exit(finalStatus(inheritedCommitted ? 125 : 200));
    } catch {}
    try { writeEvidence(evidencePath, {
      version: 1, state: "manual-remediation", guardedRoot: root, evidencePath,
      supervisorPid: process.pid, leaderPgid: lease.anchorPgid,
    }); } catch {}
    console.error(`ERROR  P2-F inherited owner setup cleanup could not be proven; guarded-root=${root} evidence-path=${evidencePath} supervisor-pid=${process.pid} leader-pgid=${lease.anchorPgid}; manual remediation required`);
  }
  closeOwnerChannel();
  process.exit(signalStatus || (reserved ? 125 : 200));
}

let worker = null;
let workerResult = null;
let workerExit = null;
let inheritedFallbackStatus = 125;
try {
  const inheritedTimeoutMs = inheritedWorkerDeadlineMs - Date.now();
  assert.ok(inheritedTimeoutMs > 0 && inheritedTimeoutMs <= INHERITED_WORKER_BUDGET_MS);
  worker = spawn("bash", ["-eu", "-o", "pipefail", "/dev/fd/3"], {
    env: {
      ...process.env, P2H_OWNER_NONCE: "", P2H_OWNER_REQUEST_FD: "",
      P2H_OWNER_RESPONSE_FD: "", P2F_STANDALONE_ROOT: root,
      P2F_STANDALONE_EVIDENCE_ROOT: evidencePath,
    },
    stdio: ["ignore", "inherit", "inherit", 3],
  });
  workerExit = new Promise((resolve) => {
    worker.once("error", () => resolve({code: 127, signal: null}));
    worker.once("exit", (code, signal) => resolve({code, signal}));
  });
  const outcome = await Promise.race([
    workerExit.then((value) => ({kind: "result", value})), interrupted,
    pause(inheritedTimeoutMs).then(() => ({kind: "timeout", status: 124})),
  ]);
  if (outcome.kind === "timeout") inheritedFallbackStatus = 124;
  if (outcome.kind !== "result") {
    try { worker.kill("SIGTERM"); } catch {}
    workerResult = await Promise.race([
      workerExit, pause(INHERITED_TERM_GRACE_MS).then(() => null),
    ]);
    if (workerResult === null) {
      try { worker.kill("SIGKILL"); } catch {}
      workerResult = await Promise.race([
        workerExit, pause(INHERITED_KILL_REAP_MS).then(() => null),
      ]);
    }
  } else {
    workerResult = outcome.value;
  }
  assert.notEqual(workerResult, null);
  process.kill(lease.ownerPid, 0);
  await exchange("release", {
    challenge: lease.challenge, childPid: process.pid, anchorPgid: lease.anchorPgid,
    guardedRoot: root, evidencePath,
  }, Math.max(1, Math.min(INHERITED_RELEASE_MS, lease.leaseDeadlineMs - Date.now())));
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(evidencePath), false);
  closeOwnerChannel();
  const workerStatus = outcome.kind === "timeout" ? 124 : workerResult.signal === null
    ? workerResult.code ?? 1 : SIGNAL_STATUS[workerResult.signal] ?? 1;
  process.exit(finalStatus(workerStatus));
} catch {
  try {
    if (worker !== null && workerResult === null) worker.kill("SIGKILL");
  } catch {}
  if (workerExit !== null && workerResult === null) {
    try { workerResult = await Promise.race([
      workerExit, pause(INHERITED_KILL_REAP_MS).then(() => null),
    ]); } catch {}
  }
  if (workerExit !== null && workerResult !== null && lease !== null) {
    try {
      process.kill(lease.ownerPid, 0);
      await exchange("release", {
        challenge: lease.challenge, childPid: process.pid, anchorPgid: lease.anchorPgid,
        guardedRoot: root, evidencePath,
      }, Math.max(1, Math.min(INHERITED_RELEASE_MS, lease.leaseDeadlineMs - Date.now())));
      assert.equal(existsSync(root), false);
      assert.equal(existsSync(evidencePath), false);
      closeOwnerChannel();
      process.exit(finalStatus(inheritedFallbackStatus));
    } catch {}
  }
  try { writeEvidence(evidencePath, {
    version: 1, state: "manual-remediation", guardedRoot: root, evidencePath,
    supervisorPid: process.pid, leaderPgid: lease?.anchorPgid ?? "not-applicable",
  }); } catch {}
  console.error(`ERROR  P2-F inherited owner cleanup could not be proven; guarded-root=${root || "not-applicable"} evidence-path=${evidencePath || "not-applicable"} supervisor-pid=${process.pid} leader-pgid=${lease?.anchorPgid ?? "not-applicable"}; manual remediation required`);
  closeOwnerChannel();
  process.exit(finalStatus(125));
}
NODE
  P2F_INHERITED_STATUS=$?
  set -e
  if [ "$P2F_INHERITED_STATUS" -ne 200 ]; then
    exit "$P2F_INHERITED_STATUS"
  fi
fi
if [ "$P2F_INHERITED_STATUS" -eq 200 ]; then
  if [ "${P2H_OWNER_REQUEST_FD:-}" = 5 ] &&
     [ "${P2H_OWNER_RESPONSE_FD:-}" = 4 ]; then
    exec 4<&- 5>&-
  fi
  P2H_OWNER_NONCE= \
  P2H_OWNER_REQUEST_FD= P2H_OWNER_RESPONSE_FD= \
  node --input-type=module --eval '
    import assert from "node:assert/strict";
    import { execFileSync, spawn } from "node:child_process";
    import {
      chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
      realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
    } from "node:fs";
    import { basename, dirname, isAbsolute, join } from "node:path";
    import { randomBytes } from "node:crypto";

    if (!["darwin", "linux"].includes(process.platform)) {
      throw new Error("P2-F standalone supervision requires macOS or Linux");
    }
    const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const childSignalStatuses = Object.freeze({
      SIGHUP: 129,
      SIGINT: 130,
      SIGTERM: 143,
      SIGKILL: 137,
    });
    let root = "";
    let evidencePath = "";
    let unresolvedGroup = null;
    let parent = "";

    function createSignalLatch() {
      let observed = null;
      const deliveries = [];
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return {
        raise(name, status) {
          deliveries.push({name, status});
          if (observed === null) {
            observed = { kind: "signal", name, status };
            resolve(observed);
          }
        },
        get observed() { return observed; },
        get deliveries() { return [...deliveries]; },
        promise,
      };
    }
    function installTerminalSignalHandlers(signals, statuses) {
      for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) {
        process.on(name, () => {
          signals.raise(name, statuses[name]);
          process.exitCode = signals.observed.status;
        });
      }
    }
    function authoritativeStatus(signals, fallbackStatus) {
      return signals.observed?.status ?? fallbackStatus;
    }
    function mayCreateRoot(signals) {
      return signals.observed === null;
    }
    const externalSignals = createSignalLatch();
    installTerminalSignalHandlers(externalSignals, childSignalStatuses);
    const argumentValue = (prefix) => {
      const value = process.argv.find((argument) => argument.startsWith(prefix));
      return value === undefined ? "" : value.slice(prefix.length);
    };
    const lifecycleProbeStage = argumentValue("--p2f-lifecycle-stage=");
    const lifecycleProbeSignal = argumentValue("--p2f-lifecycle-signal=");
    const failureProbe = argumentValue("--p2f-failure-probe=");
    let evidenceFailureInjected = false;
    if (lifecycleProbeStage === "early") {
      assert.ok(["SIGHUP", "SIGINT", "SIGTERM"].includes(lifecycleProbeSignal));
      process.kill(process.pid, lifecycleProbeSignal);
      await pause(50);
      process.exit(authoritativeStatus(externalSignals, 125));
    }

    const safeParentPath = (path = parent) => {
      if (typeof path !== "string" || path === "" || path === "/" || !isAbsolute(path)) {
        return false;
      }
      try {
        const stats = lstatSync(path);
        return stats.isDirectory() && !stats.isSymbolicLink() && realpathSync(path) === path;
      } catch {
        return false;
      }
    };
    const safeRootPath = (path) => safeParentPath() && typeof path === "string" &&
      path !== "" && dirname(path) === parent &&
      /^p2f\.[A-Za-z0-9]{6}$/.test(basename(path));
    const safeEvidencePath = (path = evidencePath) => safeRootPath(root) &&
      typeof path === "string" && dirname(path) === parent &&
      basename(path) === `.${basename(root)}.evidence.json`;

    function validateGuardedRoot(path = root) {
      if (!safeRootPath(path)) return false;
      const stats = lstatSync(path);
      return stats.isDirectory() && !stats.isSymbolicLink() && realpathSync(path) === path;
    }
    function validateEvidence(path = evidencePath) {
      if (!safeEvidencePath(path)) return false;
      const stats = lstatSync(path);
      return stats.isFile() && !stats.isSymbolicLink() && realpathSync(path) === path &&
        (statSync(path).mode & 0o777) === 0o600;
    }

    async function removeGuardedRoot(options = {}) {
      if (root === "") return true;
      if (!validateGuardedRoot() || !validateEvidence()) return false;
      const workerSource = options.deleteMode === "hang"
        ? "setInterval(() => {}, 60000);"
        : options.deleteMode === "fail"
          ? "process.exit(73);"
          : String.raw`
            const {rmSync} = require("node:fs");
            rmSync(process.argv[1], {recursive: true, force: true,
              maxRetries: 2, retryDelay: 25});
          `;
      const workerCommand = options.deleteMode === "spawn-error"
        ? join(root, "missing-delete-worker") : process.execPath;
      let worker;
      try {
        worker = spawn(workerCommand, ["-e", workerSource, root], {
          detached: true, stdio: "ignore",
        });
      } catch {
        return false;
      }
      let workerResult;
      const deletionOwner = {leader: worker, pgid: null, exited: false};
      const exited = new Promise((resolve) => {
        worker.once("error", () => {
          deletionOwner.exited = true;
          workerResult = {kind: "error"}; resolve(workerResult);
        });
        worker.once("exit", (code, signal) => {
          deletionOwner.exited = true;
          workerResult = {kind: "exit", code, signal}; resolve(workerResult);
        });
      });
      const closed = new Promise((resolve) => worker.once("close", resolve));
      const pgid = worker.pid;
      deletionOwner.pgid = pgid;
      if (!Number.isSafeInteger(pgid) || pgid <= 1) {
        await Promise.race([exited, pause(2_000)]);
        await Promise.race([closed, pause(2_000)]);
        return false;
      }
      const proveDeletionOwner = () => {
        if (deletionOwner.exited || deletionOwner.leader.pid !== deletionOwner.pgid) return null;
        const members = groupMembers(deletionOwner.pgid);
        return members.includes(deletionOwner.pgid) ? members : null;
      };
      await options.onStarted?.();
      const first = await Promise.race([
        exited.then(() => "exit"),
        pause(options.deleteTimeoutMs ?? 10_000).then(() => "timeout"),
      ]);
      if (first === "timeout" && workerResult === undefined) {
        try {
          if (proveDeletionOwner() !== null) process.kill(-pgid, "SIGKILL");
        } catch {}
      }
      const reaped = (await Promise.race([
        exited.then(() => true), pause(2_000).then(() => false),
      ]));
      const streamClosed = (await Promise.race([
        closed.then(() => true), pause(2_000).then(() => false),
      ]));
      let disappeared = false;
      try { disappeared = reaped && streamClosed && await groupGone(pgid, 2_000); }
      catch {}
      let absent = false;
      try { lstatSync(root); }
      catch (error) { absent = error?.code === "ENOENT"; }
      if (first !== "exit" || !reaped || !streamClosed || !disappeared || !absent ||
          workerResult?.kind !== "exit" || workerResult.code !== 0 ||
          workerResult.signal !== null) {
        if (!reaped || !streamClosed || !disappeared) {
          try { worker.removeAllListeners(); worker.unref(); } catch {}
        }
        return false;
      }
      try {
        unlinkSync(evidencePath);
      } catch (error) {
        if (error?.code !== "ENOENT") return false;
      }
      if (existsSync(evidencePath)) return false;
      root = "";
      evidencePath = "";
      return true;
    }
    function remove(path) {
      if (path === "") return;
      try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    function persist(state, supervisorPid, leaderPgid) {
      if (!safeRootPath(root) || !safeEvidencePath()) {
        throw new Error("P2-F evidence root is not validated");
      }
      const pending = `${evidencePath}.new`;
      const injectionStage = state === "pre-spawn" ? "pre" : state;
      const injectionPrefix = `evidence-${injectionStage}-`;
      const injection = !evidenceFailureInjected && failureProbe.startsWith(injectionPrefix)
        ? failureProbe.slice(injectionPrefix.length) : "";
      if (["write", "chmod", "rename", "post-write"].includes(injection)) {
        evidenceFailureInjected = true;
      }
      if (injection === "write") {
        mkdirSync(pending);
        try {
          writeFileSync(pending, "injected write must fail", {mode: 0o600});
        } finally {
          rmSync(pending, {recursive: true, force: true});
        }
      }
      writeFileSync(pending, `${JSON.stringify({
        version: 1, state, guardedRoot: root, evidencePath, supervisorPid, leaderPgid,
      })}\n`, { mode: 0o600 });
      if (injection === "chmod") unlinkSync(pending);
      chmodSync(pending, 0o600);
      if (injection === "rename") unlinkSync(pending);
      renameSync(pending, evidencePath);
      chmodSync(evidencePath, 0o600);
      if (injection === "post-write") unlinkSync(evidencePath);
      assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
    }
    function manual(supervisorPid, leaderPgid, reason = "cleanup-unproved") {
      const safeSupervisorPid = Number.isSafeInteger(supervisorPid) && supervisorPid > 1
        ? supervisorPid : "not-applicable";
      const safeLeaderPgid = Number.isSafeInteger(leaderPgid) && leaderPgid > 1
        ? leaderPgid : "not-applicable";
      const safeRoot = safeRootPath(root) ? root : "not-applicable";
      const safeEvidence = safeEvidencePath() ? evidencePath : "not-applicable";
      let remediationPath = safeEvidence;
      let remediationParent = parent;
      try {
        if (safeEvidence !== "not-applicable") {
          persist("manual-remediation", safeSupervisorPid, safeLeaderPgid);
          remediationPath = safeEvidence;
          if (unresolvedGroup !== null) unresolvedGroup.reported = true;
          console.error(`ERROR  P2-F standalone cleanup could not be proven; guarded-root=${safeRoot} evidence-path=${remediationPath} supervisor-pid=${safeSupervisorPid} leader-pgid=${safeLeaderPgid}; manual remediation required`);
          return;
        }
      } catch {}
      try {
        if (!safeParentPath(remediationParent)) {
          throw new Error("P2-F remediation parent is not canonical and safe");
        }
        const remediationRoot = mkdtempSync(join(remediationParent, "p2-f-remediation."));
        chmodSync(remediationRoot, 0o700);
        assert.equal(dirname(remediationRoot), remediationParent);
        assert.match(basename(remediationRoot), /^p2-f-remediation\.[A-Za-z0-9]{6}$/);
        assert.equal(realpathSync(remediationRoot), remediationRoot);
        remediationPath = join(remediationRoot, "manual-remediation.json");
        const pending = `${remediationPath}.new`;
        writeFileSync(pending, `${JSON.stringify({
          version: 1, reason, guardedRoot: safeRoot, supervisorPid: safeSupervisorPid,
          leaderPgid: safeLeaderPgid, evidencePath: safeEvidence,
        }, null, 2)}\n`, {mode: 0o600});
        chmodSync(pending, 0o600);
        renameSync(pending, remediationPath);
        chmodSync(remediationPath, 0o600);
        assert.equal(statSync(remediationPath).mode & 0o777, 0o600);
      } catch {
        remediationPath = "not-applicable";
      }
      if (unresolvedGroup !== null) unresolvedGroup.reported = true;
      console.error(`ERROR  P2-F standalone cleanup could not be proven; guarded-root=${safeRoot} evidence-path=${remediationPath} supervisor-pid=${safeSupervisorPid} leader-pgid=${safeLeaderPgid}; manual remediation required`);
    }
    function initializeGuardedRoot(signals) {
      if (!mayCreateRoot(signals)) return { created: false, status: signals.observed.status };
      root = mkdtempSync(join(parent, "p2f."));
      evidencePath = join(parent, `.${basename(root)}.evidence.json`);
      chmodSync(root, 0o700);
      assert.equal(validateGuardedRoot(), true);
      return { created: true, status: 0 };
    }
    async function exitWithTerminalAuthority(fallbackStatus) {
      await pause(0);
      process.exit(authoritativeStatus(externalSignals, fallbackStatus));
    }

    await pause(0);
    try {
      parent = realpathSync(process.env.TMPDIR || "/tmp");
      assert.equal(safeParentPath(parent), true);
      assert.ok(Number.isSafeInteger(process.pid) && process.pid > 1);
      const initialized = initializeGuardedRoot(externalSignals);
      if (!initialized.created) {
        if (!await removeGuardedRoot()) throw new Error("unsafe empty guarded root");
        await exitWithTerminalAuthority(initialized.status);
      }
      persist("pre-spawn", process.pid, null);
    } catch {
      manual(process.pid, "not-applicable", "pre-spawn-evidence-failure");
      console.error("ERROR  P2-F guarded-root initialization failed");
      await exitWithTerminalAuthority(125);
    }
    await pause(0);
    await stopBeforeMainForExternalSignal();

    const launcherSource = String.raw`
      import { spawn } from "node:child_process";
      const [command, ...args] = process.argv.slice(1);
      const nonce = process.env.P2F_OWNER_NONCE ?? "";
      if (!command || typeof process.send !== "function" ||
          !/^[0-9a-f]{32}$/.test(nonce)) process.exit(127);
      for (const name of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(name, () => {});
      let child = null;
      let result = null;
      let released = false;
      let started = false;
      const statusFor = (value) => value.signal === null
        ? value.code ?? 1
        : ({SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137}[value.signal] ?? 1);
      const publishResult = (value) => {
        if (result !== null) return;
        result = value;
        process.send({type: "result", nonce, code: value.code, signal: value.signal});
        if (released) process.exit(statusFor(value));
      };
      process.on("message", (message) => {
        if (message?.nonce !== nonce) return;
        if (message.type === "start" && !started) {
          started = true;
          child = spawn(command, args, {
            env: process.env,
            stdio: ["ignore", "inherit", "inherit",
              process.env.P2F_INHERIT_FD3 === "1" ? "inherit" : "ignore"],
          });
          child.once("spawn", () => process.send({type: "launched", nonce}));
          child.once("error", () => publishResult({code: 127, signal: null}));
          child.once("exit", (code, signal) => publishResult({code, signal}));
        }
        if (message.type === "release") {
          released = true;
          if (!started) process.exit(125);
          if (result !== null) process.exit(statusFor(result));
        }
      });
      if (process.env.P2F_TEST_PUBLICATION_FAILURE !== "1") {
        process.send({type: "ready", nonce, pid: process.pid});
      }
      setInterval(() => {}, 60_000);
    `;

    function groupAlive(pgid) {
      try { process.kill(-pgid, 0); return true; }
      catch (error) {
        if (error?.code === "ESRCH") return false;
        if (error?.code === "EPERM") return true;
        throw error;
      }
    }
    function groupMembers(pgid) {
      assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
      const rows = execFileSync("ps", ["-axo", "pid=,pgid="], {
        encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024,
      });
      return rows.split("\n").map((row) => row.trim().split(/\s+/).map(Number))
        .filter(([pid, group]) => Number.isSafeInteger(pid) && group === pgid)
        .map(([pid]) => pid).sort((left, right) => left - right);
    }
    function signalGroup(pgid, signal) {
      assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
      process.kill(-pgid, signal);
    }
    async function groupGone(pgid, milliseconds) {
      const deadline = Date.now() + milliseconds;
      while (groupAlive(pgid) && Date.now() < deadline) await pause(25);
      return !groupAlive(pgid);
    }
    function detachLeader(leader) {
      try { if (leader?.connected) leader.disconnect(); } catch {}
      try { leader?.removeAllListeners("message"); } catch {}
      try { leader?.unref(); } catch {}
    }
    const mayRecursivelyRemoveGuardedRoot = (record = unresolvedGroup) => record === null;

    function proveCurrentOwner(owner) {
      if (owner === null || owner.exited || !Number.isSafeInteger(owner.pgid) ||
          owner.pgid <= 1 || owner.leader?.pid !== owner.pgid) return null;
      const members = groupMembers(owner.pgid);
      return members.includes(owner.pgid) ? members : null;
    }
    async function waitForOnlyAnchor(owner, milliseconds) {
      const deadline = Date.now() + milliseconds;
      while (Date.now() < deadline) {
        const members = proveCurrentOwner(owner);
        if (members === null) return null;
        if (members.every((pid) => pid === owner.pgid)) return members;
        await pause(25);
      }
      return proveCurrentOwner(owner);
    }
    function signalOwnedGroup(owner, signal) {
      const members = proveCurrentOwner(owner);
      if (members === null) throw new Error("P2-F retained owner proof failed");
      signalGroup(owner.pgid, signal);
      return members;
    }

    async function containGroup(owner, termGraceMs) {
      if (owner === null) {
        unresolvedGroup = null;
        return {complete: true, reaped: true, streamClosed: true, disappeared: true};
      }
      const {leader, leaderResult, leaderClosed, pgid, nonce} = owner ?? {};
      if (!leader) {
        unresolvedGroup = null;
        return { complete: true, reaped: true, disappeared: true };
      }
      const validPgid = Number.isSafeInteger(pgid) && pgid > 1;
      let containmentError = null;
      if (validPgid && !owner.exited) {
        try {
          signalOwnedGroup(owner, "SIGTERM");
          const afterTerm = await waitForOnlyAnchor(owner, termGraceMs);
          if (afterTerm === null) throw new Error("P2-F owner disappeared during TERM");
          if (afterTerm.every((pid) => pid === pgid)) {
            if (!leader.connected) throw new Error("P2-F owner control channel closed");
            leader.send({type: "release", nonce});
          } else {
            signalOwnedGroup(owner, "SIGKILL");
          }
        } catch (error) {
          containmentError = error;
        }
      }
      let leaderOutcome = null;
      try {
        leaderOutcome = leaderResult === null ? null
          : await Promise.race([leaderResult, pause(5000).then(() => null)]);
      } catch {}
      const reaped = leaderOutcome !== null;
      let streamClosed = false;
      try {
        streamClosed = leaderClosed === null ? false
          : await Promise.race([leaderClosed.then(() => true), pause(2000).then(() => false)]);
      } catch {}
      let disappeared = !validPgid && leaderOutcome?.kind === "leader-error" && streamClosed;
      if (validPgid && reaped && streamClosed) {
        try { disappeared = await groupGone(pgid, 5000); } catch { disappeared = false; }
      }
      const complete = containmentError === null && reaped && streamClosed && disappeared;
      if (complete) {
        unresolvedGroup = null;
      } else {
        manual(process.pid, pgid, containmentError === null
          ? "reap-or-disappearance-unproved" : "current-owner-proof-failed");
        detachLeader(leader);
      }
      return { complete, reaped, streamClosed, disappeared };
    }

    async function supervise(command, args, options = {}) {
      let leader = null;
      let leaderResult = null;
      let leaderClosed = null;
      let pgid = null;
      let owner = null;
      let cleanupProved = false;
      try {
        const nonce = randomBytes(16).toString("hex");
        assert.match(nonce, /^[0-9a-f]{32}$/);
        leader = spawn(process.execPath,
          ["--input-type=module", "--eval", launcherSource, command, ...args], {
            detached: true,
            env: {
              ...(options.env ?? process.env), P2F_OWNER_NONCE: nonce,
              P2F_TEST_PUBLICATION_FAILURE: options.publicationFailure ? "1" : "0",
              P2F_INHERIT_FD3: options.inheritFd3 ? "1" : "0",
            },
            stdio: ["ignore", "inherit", "inherit",
              options.inheritFd3 ? "inherit" : "ignore", "ipc"],
          });
        pgid = leader.pid;
        unresolvedGroup = { supervisorPid: process.pid, leaderPgid: pgid, reported: false };
        let leaderExited = false;
        leaderResult = new Promise((resolve) => {
          leader.once("error", () => resolve({ kind: "leader-error" }));
          leader.once("exit", (code, signal) => {
            leaderExited = true;
            if (owner !== null) owner.exited = true;
            resolve({ kind: "leader-exit", code, signal });
          });
        });
        leaderClosed = new Promise((resolve) => leader.once("close", resolve));
        owner = {leader, leaderResult, leaderClosed, pgid, nonce, exited: leaderExited};
        if (!Number.isSafeInteger(pgid) || pgid <= 1) {
          const invalidLeaderOutcome = await Promise.race([
            leaderResult, pause(2000).then(() => null),
          ]);
          if (invalidLeaderOutcome?.kind === "leader-error") {
            unresolvedGroup = null;
            return { complete: true, status: authoritativeStatus(externalSignals, 125),
              pgid, outcome: { kind: "launch-failure" } };
          }
          manual(process.pid, pgid);
          detachLeader(leader);
          return { complete: false, status: authoritativeStatus(externalSignals, 125), pgid,
            outcome: { kind: "launch-ownership-unproved" } };
        }
        let readyResolve;
        let launchResolve;
        let resultResolve;
        const ready = new Promise((resolve) => { readyResolve = resolve; });
        const launched = new Promise((resolve) => { launchResolve = resolve; });
        const commandResult = new Promise((resolve) => { resultResolve = resolve; });
        leader.on("message", (message) => {
          if (message?.nonce !== nonce) return;
          if (message.type === "ready") readyResolve({kind: "ready", pid: message.pid});
          if (message.type === "launched") launchResolve({ kind: "launched" });
          if (message.type === "result") {
            resultResolve({ kind: "result", code: message.code, signal: message.signal });
          }
        });
        const handshake = await Promise.race([
          ready,
          leaderResult,
          pause(options.handshakeTimeoutMs ?? 5000)
            .then(() => ({ kind: "handshake-timeout" })),
        ]);
        const initialMembers = handshake.kind === "ready" && handshake.pid === pgid
          ? proveCurrentOwner(owner) : null;
        if (initialMembers === null || initialMembers.length !== 1) {
          const cleanup = await containGroup(owner, 100);
          return { complete: cleanup.complete,
            status: authoritativeStatus(externalSignals, 125), pgid,
            outcome: { kind: "launch-failure" } };
        }
        if (options.evidence) persist("active", process.pid, pgid);
        leader.send({type: "start", nonce});
        const launch = await Promise.race([
          launched, commandResult, leaderResult,
          pause(options.handshakeTimeoutMs ?? 5000)
            .then(() => ({kind: "command-publication-timeout"})),
        ]);
        if (launch.kind !== "launched" && launch.kind !== "result") {
          const cleanup = await containGroup(owner, 100);
          return {complete: cleanup.complete,
            status: authoritativeStatus(externalSignals, 125), pgid,
            outcome: {kind: "launch-failure"}};
        }
        await options.onActive?.();

        const timeout = pause(options.timeoutMs).then(() => ({ kind: "timeout", status: 124 }));
        const external = options.externalSignals === false
          ? new Promise(() => {}) : externalSignals.promise;
        const outcome = await Promise.race([commandResult, timeout, external]);
        await options.onPostResult?.(outcome);
        const cleanup = await containGroup(owner, options.termGraceMs ?? 250);
        cleanupProved = cleanup.complete;
        const status = outcome.kind === "result"
          ? (outcome.signal === null
              ? outcome.code ?? 1
              : childSignalStatuses[outcome.signal] ?? 1)
          : outcome.status;
        return { complete: cleanup.complete,
          status: authoritativeStatus(externalSignals, status), pgid, outcome };
      } catch {
        const cleanup = cleanupProved
          ? { complete: true }
          : await containGroup(owner, options.termGraceMs ?? 250);
        let retained = false;
        if (options.evidence) {
          try { persist("operational-error", process.pid, pgid); } catch {}
          manual(process.pid, pgid, "operational-error");
          retained = true;
        }
        return { complete: cleanup.complete,
          status: authoritativeStatus(externalSignals, 125), pgid,
          retained, outcome: { kind: "operational-error" } };
      }
    }

    async function stopBeforeMainForExternalSignal() {
      if (externalSignals.observed === null) return;
      if (unresolvedGroup !== null) {
        if (!unresolvedGroup.reported) {
          manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
        }
        await exitWithTerminalAuthority(125);
      }
      try {
        if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
      } catch {
        manual(process.pid, "not-applicable");
        await exitWithTerminalAuthority(125);
      }
      await exitWithTerminalAuthority(125);
    }

    function assertMode0600Evidence(path) {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(typeof parsed, "object");
      assert.equal(parsed === null, false);
      return parsed;
    }
    async function runLifecycleProbe(stage, signal) {
      assert.ok(["active", "post-result", "final-cleanup", "timeout-cleanup"].includes(stage));
      assert.ok(["SIGHUP", "SIGINT", "SIGTERM"].includes(signal));
      const waitForDeliveries = async (count) => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          if (externalSignals.deliveries.length >= count) return;
          await pause(10);
        }
        assert.fail(`terminal signal delivery ${count} was not observed`);
      };
      const signalSelf = async (name = signal) => {
        const prior = externalSignals.deliveries.length;
        process.kill(process.pid, name);
        await waitForDeliveries(prior + 1);
      };
      const signalPairSelf = async () => {
        const second = {SIGHUP: "SIGINT", SIGINT: "SIGTERM", SIGTERM: "SIGHUP"}[signal];
        await signalSelf(signal);
        assert.equal(externalSignals.observed?.name, signal);
        await signalSelf(second);
        assert.equal(externalSignals.deliveries.at(-1)?.name, second);
        assert.equal(externalSignals.observed?.name, signal);
        assert.equal(externalSignals.observed?.status, childSignalStatuses[signal]);
      };
      const options = {
        timeoutMs: stage === "timeout-cleanup" ? 100 : 5000,
        termGraceMs: 100, evidence: true,
        externalSignals: true,
        ...(stage === "active" ? {onActive: signalSelf} : {}),
        ...(stage === "post-result" ? {onPostResult: async (outcome) => {
          assert.equal(outcome.kind, "result");
          await signalSelf();
        }} : {}),
        ...(stage === "timeout-cleanup" ? {onPostResult: async (outcome) => {
          assert.equal(outcome.kind, "timeout");
          await signalSelf();
        }} : {}),
      };
      const commandArgs = stage === "active" || stage === "timeout-cleanup"
        ? ["-e", "setInterval(() => {}, 1000)"]
        : ["-e", "process.exit(0)"];
      const run = await supervise(process.execPath, commandArgs, options);
      assert.equal(run.complete, true);
      assert.equal(run.status, stage === "final-cleanup" ? 0 : childSignalStatuses[signal],
        JSON.stringify(run));
      const removed = await removeGuardedRoot(stage === "final-cleanup"
        ? {onStarted: signalPairSelf} : {});
      assert.equal(removed, true);
      await exitWithTerminalAuthority(0);
    }
    async function runFailureProbe(kind) {
      if (kind === "publication") {
        const run = await supervise(process.execPath, ["-e", "process.exit(0)"], {
          timeoutMs: 5000, termGraceMs: 100, externalSignals: false,
          publicationFailure: true, handshakeTimeoutMs: 100,
        });
        assert.equal(run.complete, true);
        assert.equal(run.status, 125);
        assert.equal(await removeGuardedRoot(), true);
        process.exit(0);
      }
      if (/^evidence-active-(?:write|chmod|rename|post-write)$/.test(kind)) {
        const run = await supervise(process.execPath, ["-e", "process.exit(0)"], {
          timeoutMs: 5000, termGraceMs: 100, externalSignals: false,
          evidence: true,
        });
        assert.equal(run.complete, true);
        assert.equal(run.status, 125);
        assert.equal(run.retained, true);
        assert.equal(assertMode0600Evidence(evidencePath).state, "manual-remediation");
        const remediation = readdirSync(root)
          .filter((name) => /^p2-f-remediation\.[A-Za-z0-9]{6}$/.test(name));
        assert.equal(remediation.length, 0);
        assert.equal(await removeGuardedRoot(), true);
        process.exit(0);
      }
      if (["delete-spawn-error", "delete-fail", "delete-timeout"].includes(kind)) {
        const deleteMode = kind === "delete-spawn-error" ? "spawn-error"
          : kind === "delete-fail" ? "fail" : "hang";
        const removed = await removeGuardedRoot({
          deleteMode, deleteTimeoutMs: 100,
        });
        assert.equal(removed, false);
        manual(process.pid, "not-applicable", kind);
        assert.equal(assertMode0600Evidence(evidencePath).state, "manual-remediation");
        const remediation = readdirSync(root)
          .filter((name) => /^p2-f-remediation\.[A-Za-z0-9]{6}$/.test(name));
        assert.equal(remediation.length, 0);
        assert.equal(await removeGuardedRoot(), true);
        process.exit(0);
      }
      throw new Error("unknown P2-F failure probe");
    }

    if (lifecycleProbeStage !== "") {
      await runLifecycleProbe(lifecycleProbeStage, lifecycleProbeSignal);
    }
    if (failureProbe !== "" &&
        !/^evidence-pre-(?:write|chmod|rename|post-write)$/.test(failureProbe) &&
        failureProbe !== "unsafe-parent") {
      await runFailureProbe(failureProbe);
    }

    try {
    const rootArtifactNames = () => readdirSync(root).filter((name) =>
      /^(?:p2f|p2-f-remediation)\.[A-Za-z0-9]{6}$/.test(name)).sort();
    const evidenceArtifactNames = () => readdirSync(root).filter((name) =>
      /^\.p2f\.[A-Za-z0-9]{6}\.evidence\.json(?:\.new)?$/.test(name)).sort();
    const artifactNames = () => [...rootArtifactNames(), ...evidenceArtifactNames()].sort();
    let recursiveProbeIndex = 0;
    async function runRecursiveProbe(args, envOverrides = {}) {
      recursiveProbeIndex += 1;
      const stdoutPath = join(root, `.recursive-${recursiveProbeIndex}.stdout`);
      const stderrPath = join(root, `.recursive-${recursiveProbeIndex}.stderr`);
      const command = String.raw`
        stdout_path="$1"; stderr_path="$2"; shift 2
        exec "$@" >"$stdout_path" 2>"$stderr_path"
      `;
      const run = await supervise("sh", ["-c", command, "p2f-recursive-probe",
        stdoutPath, stderrPath, process.execPath, ...process.execArgv, "--", ...args], {
        timeoutMs: 15_000,
        termGraceMs: 1_000,
        externalSignals: false,
        env: {
          ...process.env, TMPDIR: root, P2H_OWNER_NONCE: "", ...envOverrides,
        },
      });
      const retainRecursiveUncertainty = (reason, leaderPgid = run.pgid) => {
        unresolvedGroup = {
          supervisorPid: process.pid,
          leaderPgid: Number.isSafeInteger(leaderPgid) ? leaderPgid : run.pgid,
          reported: false,
        };
        manual(process.pid, unresolvedGroup.leaderPgid, reason);
        throw new Error(`P2-F recursive probe cleanup unproved: ${reason}`);
      };
      if (!run.complete || run.outcome?.kind !== "result") {
        retainRecursiveUncertainty("recursive-wrapper-containment-unproved");
      }
      for (const name of evidenceArtifactNames()) {
        let nested;
        try { nested = JSON.parse(readFileSync(join(root, name), "utf8")); }
        catch { retainRecursiveUncertainty("recursive-evidence-unreadable"); }
        if (Number.isSafeInteger(nested?.leaderPgid) && nested.leaderPgid > 1 &&
            groupAlive(nested.leaderPgid)) {
          retainRecursiveUncertainty("recursive-descendant-group-live", nested.leaderPgid);
        }
      }
      let stdout;
      let stderr;
      try {
        stdout = readFileSync(stdoutPath, "utf8");
        stderr = readFileSync(stderrPath, "utf8");
      } catch {
        retainRecursiveUncertainty("recursive-capture-unproved");
      }
      remove(stdoutPath);
      remove(stderrPath);
      return {error: undefined, signal: null, status: run.status, stdout, stderr};
    }
    for (const stage of [
      "early", "active", "post-result", "final-cleanup", "timeout-cleanup",
    ]) {
      for (const [signal, status] of Object.entries({
        SIGHUP: 129, SIGINT: 130, SIGTERM: 143,
      })) {
        const before = artifactNames();
        const run = await runRecursiveProbe([
          `--p2f-lifecycle-stage=${stage}`,
          `--p2f-lifecycle-signal=${signal}`,
        ]);
        assert.equal(run.error, undefined, `${stage} ${signal} spawn`);
        assert.equal(run.signal, null, `${stage} ${signal} outer signal`);
        assert.equal(run.status, status, `${stage} ${signal} status: ${run.stderr}`);
        assert.equal(run.stdout, "", `${stage} ${signal} stdout`);
        assert.equal(run.stderr, "", `${stage} ${signal} stderr`);
        assert.deepEqual(artifactNames(), before, `${stage} ${signal} residue`);
      }
    }
    console.log("PASS  P2-F supervisor handles real early HUP, INT, and TERM before root creation");
    console.log("PASS  P2-F supervisor handles real active HUP, INT, and TERM");
    console.log("PASS  P2-F supervisor gives post-result, first-of-two final-cleanup, and timeout-cleanup signals final authority");
    await stopBeforeMainForExternalSignal();

    for (const kind of [
      "publication",
      "evidence-active-write", "evidence-active-chmod",
      "evidence-active-rename", "evidence-active-post-write",
      "delete-spawn-error", "delete-fail", "delete-timeout",
    ]) {
      const before = artifactNames();
      const run = await runRecursiveProbe([`--p2f-failure-probe=${kind}`]);
      assert.equal(run.error, undefined, `${kind} spawn`);
      assert.equal(run.signal, null, `${kind} signal`);
      assert.equal(run.status, 0, `${kind} status: ${run.stderr}`);
      assert.equal(run.stdout, "", `${kind} stdout`);
      if (kind === "publication") assert.equal(run.stderr, "", `${kind} stderr`);
      assert.deepEqual(artifactNames(), before, `${kind} residue`);
    }
    for (const operation of ["write", "chmod", "rename", "post-write"]) {
      const beforeEvidencePre = artifactNames();
      const beforeEvidenceRoots = rootArtifactNames();
      const evidencePre = await runRecursiveProbe([
        `--p2f-failure-probe=evidence-pre-${operation}`,
      ]);
      assert.equal(evidencePre.error, undefined);
      assert.equal(evidencePre.signal, null);
      assert.equal(evidencePre.status, 125);
      assert.match(evidencePre.stderr, /manual remediation required/);
      const retainedAfterEvidencePre = rootArtifactNames()
        .filter((name) => !beforeEvidenceRoots.includes(name));
      assert.equal(retainedAfterEvidencePre.length, 1);
      const retainedEvidenceRoot = join(root, retainedAfterEvidencePre[0]);
      const retainedEvidencePath = join(root,
        `.${retainedAfterEvidencePre[0]}.evidence.json`);
      const retainedStats = lstatSync(retainedEvidenceRoot);
      assert.equal(retainedStats.isDirectory(), true);
      assert.equal(retainedStats.isSymbolicLink(), false);
      assert.equal(realpathSync(retainedEvidenceRoot), retainedEvidenceRoot);
      assert.equal(assertMode0600Evidence(retainedEvidencePath).state,
        "manual-remediation");
      const evidenceCleanup = await supervise(process.execPath, ["-e", String.raw`
        const {rmSync} = require("node:fs");
        rmSync(process.argv[1], {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
      `, retainedEvidenceRoot], {
        timeoutMs: 5000, termGraceMs: 100, externalSignals: false,
      });
      assert.equal(evidenceCleanup.status, 0);
      assert.equal(evidenceCleanup.complete, true);
      unlinkSync(retainedEvidencePath);
      assert.deepEqual(artifactNames(), beforeEvidencePre,
        `evidence-pre-${operation} residue`);
    }

    const cwdRemediation = () => readdirSync(process.cwd())
      .filter((name) => /^p2-f-remediation\.[A-Za-z0-9]{6}$/.test(name)).sort();
    const cwdBeforeUnsafeParent = cwdRemediation();
    for (const unsafeParent of ["/", join(root, "missing-parent")]) {
      const before = artifactNames();
      const unsafe = await runRecursiveProbe([
        "--p2f-failure-probe=unsafe-parent",
      ], {TMPDIR: unsafeParent});
      assert.equal(unsafe.status, 125);
      assert.match(unsafe.stderr,
        /guarded-root=not-applicable evidence-path=not-applicable/);
      assert.deepEqual(artifactNames(), before, `unsafe parent residue: ${unsafeParent}`);
      assert.deepEqual(cwdRemediation(), cwdBeforeUnsafeParent,
        `unsafe parent wrote remediation in cwd: ${unsafeParent}`);
    }

    assert.deepEqual(childSignalStatuses,
      { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137 });
    for (const [name, status] of Object.entries(childSignalStatuses)) {
      const run = await supervise(process.execPath,
        ["--input-type=module", "--eval",
          `setTimeout(() => process.kill(process.pid, ${JSON.stringify(name)}), 50); setInterval(() => {}, 1000);`], {
          timeoutMs: 5000, termGraceMs: 0, externalSignals: false,
        });
      assert.equal(run.status, status, `${name} status`);
      assert.equal(run.complete, true, `${name} cleanup`);
    }
    console.log("PASS  P2-F supervisor preserves natural child signal statuses");
    await stopBeforeMainForExternalSignal();

    const timeoutRun = await supervise("sh", ["-c",
      "trap \"\" TERM; (trap \"\" TERM; sleep 30) & wait"], {
        timeoutMs: 100, termGraceMs: 100, externalSignals: false,
      });
    assert.equal(timeoutRun.status, 124);
    assert.equal(timeoutRun.complete, true);
    console.log("PASS  P2-F supervisor terminates a timed-out TERM-resistant descendant group");
    await stopBeforeMainForExternalSignal();

    const descendantMarker = join(root, "p2-f-descendant.marker");
    const descendantRun = await supervise("sh", ["-c",
      "(sleep 1; printf leak >\"$1\") & exit 0", "p2-f-descendant", descendantMarker], {
        timeoutMs: 5000, termGraceMs: 0, externalSignals: false,
      });
    assert.equal(descendantRun.status, 0);
    assert.equal(descendantRun.complete, true);
    await pause(1200);
    try { readFileSync(descendantMarker); assert.fail("background descendant survived"); }
    catch (error) { assert.equal(error?.code, "ENOENT"); }
    console.log("PASS  P2-F supervisor removes descendants after their parent exits");
    await stopBeforeMainForExternalSignal();

    const main = await supervise("bash", ["-eu", "-o", "pipefail", "/dev/fd/3"], {
      timeoutMs: 180_000,
      termGraceMs: 1000,
      evidence: true,
      inheritFd3: true,
      env: {
        ...process.env,
        P2F_STANDALONE_ROOT: root,
        P2F_STANDALONE_EVIDENCE_ROOT: evidencePath,
      },
    });
    if (!main.complete) {
      if (unresolvedGroup !== null && !unresolvedGroup.reported) {
        manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
      }
      await exitWithTerminalAuthority(125);
    }
    if (main.retained) await exitWithTerminalAuthority(125);
    assert.equal(statSync(root).isDirectory(), true);
    try {
      if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
    } catch {
      manual(process.pid, main.pgid);
      await exitWithTerminalAuthority(125);
    }
    await exitWithTerminalAuthority(main.status);
    } catch {
      if (!mayRecursivelyRemoveGuardedRoot()) {
        if (!unresolvedGroup.reported) {
          manual(unresolvedGroup.supervisorPid, unresolvedGroup.leaderPgid);
        }
        console.error("ERROR  P2-F standalone supervisor failed with cleanup unproved; guarded root retained");
        await exitWithTerminalAuthority(125);
      }
      try {
        if (!await removeGuardedRoot()) throw new Error("unsafe guarded root");
      } catch {
        manual(process.pid, "not-applicable");
        await exitWithTerminalAuthority(125);
      }
      console.error("ERROR  P2-F standalone supervisor failed");
      await exitWithTerminalAuthority(125);
    }
  '
fi
) 3<<'P2F_RUNTIME_BODY'
set -eu
P2F_TMP_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
P2F_TMP="${P2F_STANDALONE_ROOT:-}"
P2F_EVIDENCE_PATH="${P2F_STANDALONE_EVIDENCE_ROOT:-}"
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
node --input-type=module - "$P2F_TMP" "$P2F_EVIDENCE_PATH" "$P2F_TMP_PARENT" <<'NODE'
import assert from "node:assert/strict";
import {lstatSync, realpathSync, statSync} from "node:fs";
import {basename, dirname} from "node:path";
const [root, evidencePath, suppliedParent] = process.argv.slice(2);
const parent = realpathSync(suppliedParent);
assert.equal(parent, suppliedParent);
assert.equal(dirname(root), parent);
assert.match(basename(root), /^p2f\.[A-Za-z0-9]{6}$/);
const rootStats = lstatSync(root);
assert.equal(rootStats.isDirectory(), true);
assert.equal(rootStats.isSymbolicLink(), false);
assert.equal(realpathSync(root), root);
if (evidencePath !== "") {
  assert.equal(dirname(evidencePath), parent);
  assert.equal(basename(evidencePath), `.${basename(root)}.evidence.json`);
  const evidenceStats = lstatSync(evidencePath);
  assert.equal(evidenceStats.isFile(), true);
  assert.equal(evidenceStats.isSymbolicLink(), false);
  assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
}
NODE

mkdir -p "$P2F_TMP/netlify/lib" "$P2F_TMP/netlify/functions"
cp netlify/lib/realtime.mjs "$P2F_TMP/netlify/lib/realtime.mjs"
cp netlify/functions/realtime-token.mjs "$P2F_TMP/netlify/functions/realtime-token.mjs"
cat >"$P2F_TMP/crypto-loader.mjs" <<'EOF'
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "node:crypto" && context.parentURL?.endsWith("/netlify/lib/realtime.mjs")) {
    return {url: "p2f:crypto", shortCircuit: true};
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "p2f:crypto") {
    return {
      format: "module",
      shortCircuit: true,
      source: `
        import {Buffer} from "node:buffer";
        let guestCalls = 0;
        let nonceCalls = 0;
        export function randomBytes(size) {
          if (size === 6) return Buffer.alloc(6, ++guestCalls);
          if (size === 16) return Buffer.alloc(16, ++nonceCalls);
          throw new Error("unexpected entropy byte length");
        }
      `
    };
  }
  return nextLoad(url, context);
}
EOF
cat >"$P2F_TMP/netlify/lib/identity.mjs" <<'EOF'
export async function identify(req) {
  globalThis.__p2fCounts.identity += 1;
  if (req !== globalThis.__p2fExpectedRequest) throw new Error("identity received wrong request");
  if (globalThis.__p2fIdentityFailure !== undefined) throw globalThis.__p2fIdentityFailure;
  if (globalThis.__p2fDisableAfterIdentify) delete process.env.ABLY_API_KEY;
  const session = globalThis.__p2fUser ?? null;
  globalThis.__p2fIssuedSession = session;
  return session;
}
EOF
cat >"$P2F_TMP/netlify/lib/access.mjs" <<'EOF'
export async function resolveRole(docId, session) {
  globalThis.__p2fCounts.access += 1;
  if (docId !== globalThis.__p2fExpectedDocId) throw new Error("access received wrong document");
  if (session !== globalThis.__p2fIssuedSession) throw new Error("access received wrong session");
  globalThis.__p2fAccessCalls.push({docId, session});
  if (globalThis.__p2fShouldThrowAccess) throw globalThis.__p2fAccessThrow;
  if (globalThis.__p2fAccess instanceof Error) throw globalThis.__p2fAccess;
  return globalThis.__p2fAccess;
}
EOF
cat >"$P2F_TMP/test.mjs" <<'EOF'
import assert from "node:assert/strict";
import http from "node:http";
import { Buffer } from "node:buffer";

const apiKey = "demo123.key456:fixture-secret-value";
const basic = `Basic ${Buffer.from(apiKey).toString("base64")}`;
const serverChannel = "doc:4b7d2a:server";
const clientChannel = "doc:4b7d2a:client";
const capability = JSON.stringify({
  [serverChannel]: ["subscribe"],
  [clientChannel]: ["publish", "subscribe"],
});
const nativeFetch = globalThis.fetch;
const nativeDateNow = Date.now;
const fixedNow = 1_788_364_800_000;
const records = [];
let mode = "ok";
let fetchCount = 0;
let clockValues = [];
const clockReads = [];
let verifyClockAtRequest = false;
Date.now = () => {
  const fallback = clockReads.length % 2 === 0 ? fixedNow : fixedNow + 25;
  const value = clockValues.length ? clockValues.shift() : fallback;
  clockReads.push(value);
  return value;
};
const resetClock = (request = fixedNow, response = fixedNow + 25) => {
  clockValues = [request, response];
  clockReads.length = 0;
};

function json(res, status, value) {
  res.writeHead(status, {"content-type": "application/json"});
  res.end(JSON.stringify(value));
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  assert.equal(req.headers.authorization === basic, true, "Authorization header mismatch");
  assert.equal(req.headers.accept, "application/json");
  assert.match(req.headers["content-type"] ?? "", /^application\/json(?:;|$)/);
  assert.equal(req.headers["x-ably-version"], "1.2");
  records.push({url: req.url, method: req.method, body: raw});

  if (mode === "delay") {
    await new Promise((resolve) => setTimeout(resolve, 5_250));
  }
  if (mode === "status") return json(res, 401, {message: "provider-private-detail"});
  if (mode === "malformed") {
    res.writeHead(201, {"content-type": "application/json"});
    return res.end("{");
  }

  if (req.url === "/keys/demo123.key456/requestToken") {
    const body = JSON.parse(raw);
    if (verifyClockAtRequest) {
      assert.deepEqual(clockReads, [fixedNow],
        "request timestamp was not sampled exactly once immediately before fetch");
      verifyClockAtRequest = false;
    }
    if (mode === "mint-204") {
      res.writeHead(204);
      return res.end();
    }
    const replyCapability = mode === "wide"
      ? JSON.stringify({[serverChannel]: ["subscribe"],
          [clientChannel]: ["publish", "subscribe", "history"]})
      : mode === "capability-null" ? null
      : mode === "capability-array" ? JSON.stringify([])
      : mode === "capability-malformed" ? "{"
      : mode === "capability-reversed" ? JSON.stringify({
          [clientChannel]: ["subscribe", "publish"], [serverChannel]: ["subscribe"]})
      : mode === "capability-wrong-channel" ? JSON.stringify({
          "doc:ffffff:server": ["subscribe"], [clientChannel]: ["publish", "subscribe"]})
      : mode === "capability-missing-channel" ? JSON.stringify({
          [serverChannel]: ["subscribe"]})
      : mode === "capability-server-publish" ? JSON.stringify({
          [serverChannel]: ["subscribe", "publish"],
          [clientChannel]: ["publish", "subscribe"]})
      : mode === "capability-server-wrong-op" ? JSON.stringify({
          [serverChannel]: ["publish"],
          [clientChannel]: ["publish", "subscribe"]})
      : mode === "capability-missing-op" ? JSON.stringify({
          [serverChannel]: ["subscribe"], [clientChannel]: ["publish"]})
      : mode === "capability-duplicate-op" ? JSON.stringify({
          [serverChannel]: ["subscribe"],
          [clientChannel]: ["publish", "subscribe", "subscribe"]})
      : body.capability;
    const issued = mode === "stale-issued" ? body.timestamp - 60_001
      : mode === "stale-boundary" ? body.timestamp - 60_000
      : mode === "future-issued" ? fixedNow + 25 + 60_001
      : mode === "future-boundary" ? fixedNow + 25 + 60_000
      : mode === "noninteger-issued" ? body.timestamp + 0.5
      : body.timestamp;
    const expires = mode === "expired" ? fixedNow + 25
      : mode === "expiry-boundary" ? fixedNow + 26
      : mode === "expires-equals-issued" ? issued
      : mode === "expires-before-issued" ? issued - 1
      : mode === "overlong" ? issued + 3_600_001
      : mode === "noninteger-expires" ? issued + 3_600_000.5
      : issued + 3_600_000;
    const status = mode === "mint-200" ? 200
      : mode === "mint-202" ? 202
      : mode === "mint-299" ? 299
      : 201;
    return json(res, status, {
      token: mode === "empty-token" ? "" : mode === "nonstring-token" ? 7
        : "invented-token-value-not-a-credential",
      issued,
      expires,
      capability: replyCapability,
      clientId: mode === "mismatch" ? "wrong-client" : body.clientId,
      keyName: "ignored-provider-field"
    });
  }
  if (req.url === "/channels/doc%3A4b7d2a%3Aserver/messages") {
    return json(res, mode === "publish-200" ? 200 : 201, {
      channel: mode === "mismatch" ? "doc:ffffff:server" : serverChannel,
      messageId: mode === "empty-message-id" ? ""
        : mode === "nonstring-message-id" ? 7 : "invented-message-001",
      ignored: true
    });
  }
  return json(res, 404, {message: "provider-private-detail"});
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert(address && typeof address === "object");
const loopback = `http://127.0.0.1:${address.port}`;

globalThis.fetch = async (input, init = {}) => {
  const source = new URL(typeof input === "string" ? input : input.url);
  if (source.origin !== "https://main.realtime.ably.net") {
    throw new Error("unexpected network origin");
  }
  fetchCount += 1;
  if (mode === "network") {
    const nested = Object.assign(
      new Error("provider-private-detail", {cause: new Error(`nested ${apiKey}`)}),
      {response: {body: "invented-token-value-not-a-credential"}}
    );
    throw new AggregateError([nested], "provider aggregate detail", {
      cause: new Error(`authorization ${basic}`)
    });
  }
  return nativeFetch(loopback + source.pathname + source.search, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    redirect: "error"
  });
};

globalThis.__p2fCounts = {identity: 0, access: 0};
globalThis.__p2fUser = null;
globalThis.__p2fAccess = {role: "none", canRead: false};
globalThis.__p2fShouldThrowAccess = false;
globalThis.__p2fAccessThrow = undefined;
globalThis.__p2fDisableAfterIdentify = false;
globalThis.__p2fIdentityFailure = undefined;
globalThis.__p2fExpectedRequest = undefined;
globalThis.__p2fExpectedDocId = undefined;
globalThis.__p2fIssuedSession = undefined;
globalThis.__p2fAccessCalls = [];
const realtime = await import("./netlify/lib/realtime.mjs");
assert.deepEqual(Object.getOwnPropertyNames(realtime).sort(), ["mintToken", "publish"]);
const {mintToken, publish} = realtime;
const endpointModule = await import("./netlify/functions/realtime-token.mjs");
const endpoint = endpointModule.default;
assert.deepEqual(Object.getOwnPropertyNames(endpointModule).sort(), ["config", "default"]);
assert.deepEqual(endpointModule.config, {path: "/api/realtime-token"});

const call = (method, query = "?doc=4b7d2a") => {
  const request = new Request(`https://docs.review.invalid/api/realtime-token${query}`, {method});
  const values = new URL(request.url).searchParams.getAll("doc");
  globalThis.__p2fExpectedRequest = request;
  globalThis.__p2fExpectedDocId = values.length === 1 && /^[0-9a-f]{6}$/.test(values[0])
    ? values[0]
    : undefined;
  return endpoint(request);
};
async function bodyBytes(response) {
  return Buffer.from(await response.arrayBuffer()).byteLength;
}
async function assertResponse(response, status, {allow = false, jsonBody = false} = {}) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal(response.headers.has("access-control-allow-credentials"), false);
  assert.equal(response.headers.get("allow"), allow ? "GET" : null);
  if (jsonBody) {
    assert.deepEqual([...response.headers.keys()].sort(), ["cache-control", "content-type"]);
    assert.equal(response.headers.get("content-type"), "application/json");
  } else {
    assert.deepEqual([...response.headers.keys()].sort(),
      allow ? ["allow", "cache-control"] : ["cache-control"]);
    assert.equal(await bodyBytes(response), 0);
  }
}
function assertOrdinaryDataObject(value, keys) {
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
  for (const key of keys) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, key), {
      value: value[key], enumerable: true, writable: true, configurable: true,
    });
  }
}
async function exactTypeError(run, message) {
  const before = fetchCount;
  let caught;
  try { await run(); } catch (error) { caught = error; }
  assert.equal(caught instanceof TypeError && caught.message === message, true,
    "Expected safe TypeError");
  assert.equal(fetchCount, before);
}
function assertSanitizedErrorGraph(error) {
  assert.equal(error instanceof Error && error.constructor === Error, true,
    "Mint provider failure did not return a plain Error");
  assert.equal(error.message, "Realtime provider unavailable");
  assert.equal(Object.hasOwn(error, "cause"), false, "Sanitized error retained a cause");
  const seen = new Set();
  const pending = [error];
  while (pending.length) {
    const value = pending.pop();
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof AggregateError) pending.push(...value.errors);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const nested = descriptor.value;
      if (typeof nested === "string") {
        assert.equal(/fixture-secret|provider-private|invented-token|authorization|Basic/i.test(nested), false,
          "Sanitized error graph retained private provider data");
      } else {
        pending.push(nested);
      }
    }
  }
}

try {
  for (const off of [undefined, "", " \t "]) {
    if (off === undefined) delete process.env.ABLY_API_KEY;
    else process.env.ABLY_API_KEY = off;
    assert.equal((await mintToken(null, "bad")) === null, true,
      "Disabled mint did not return null");
    assert.equal((await publish("bad", {t: "bad"})) === null, true,
      "Disabled publish did not return null");
    assert.equal(fetchCount, 0);
    await assertResponse(await call("POST", "?doc=not-valid"), 405, {allow: true});
    await assertResponse(await call("GET", "?doc=not-valid"), 204);
  }
  assert.deepEqual(globalThis.__p2fCounts, {identity: 0, access: 0});
  console.log("PASS  realtime disabled contract");

  process.env.ABLY_API_KEY = apiKey;
  const member = {sub: "u_fixture_member_17", email: "member@example.com", name: "Fixture Member", isOrg: true};
  resetClock();
  verifyClockAtRequest = true;
  const token = await mintToken(member, "4b7d2a");
  assert.deepEqual(clockReads, [fixedNow, fixedNow + 25],
    "mint did not sample request and response clocks exactly once in order");
  assert.deepEqual(clockValues, [], "mint did not consume both clock samples");
  assert.deepEqual(Object.keys(token).sort(), ["capability", "clientId", "expires", "issued", "token"]);
  assert.equal(token.clientId === member.sub, true, "Minted client ID mismatch");
  assert.equal(token.capability === capability, true, "Minted capability mismatch");
  assert(token.expires > token.issued && token.expires - token.issued <= 3_600_000);
  const tokenRecord = records.at(-1);
  assert.equal(tokenRecord.url === "/keys/demo123.key456/requestToken", true,
    "Token request path mismatch");
  assert.equal(tokenRecord.method, "POST");
  const requestToken = JSON.parse(tokenRecord.body);
  assert.deepEqual(Object.keys(requestToken).sort(), ["capability", "clientId", "keyName", "nonce", "timestamp", "ttl"]);
  assert.equal(requestToken.keyName === "demo123.key456", true,
    "Token request key name mismatch");
  assert.equal(requestToken.ttl === 3_600_000, true, "Token request TTL mismatch");
  assert.equal(requestToken.capability === capability, true,
    "Token request capability mismatch");
  assert.equal(requestToken.clientId === member.sub, true,
    "Token request client ID mismatch");
  assert.equal(requestToken.timestamp, fixedNow);
  assert.equal(requestToken.nonce, "01".repeat(16),
    "Token request did not consume exactly 16 nonce bytes");
  await exactTypeError(() => mintToken({}, "4b7d2a"), "Invalid realtime session");
  for (const badSession of [null, "user", {sub: "a", isOrg: "true"}]) {
    await exactTypeError(() => mintToken(badSession, "4b7d2a"), "Invalid realtime session");
  }
  for (const sub of ["", ".bad", "_bad", "~bad", "-bad", " bad", "bad/sub", "bad\\sub", "%2F", "a".repeat(129)]) {
    await exactTypeError(() => mintToken({...member, sub}, "4b7d2a"), "Invalid realtime session");
  }
  assert.equal((await mintToken({...member, sub: "a"}, "4b7d2a")).clientId === "a", true,
    "Minimum-length client ID mismatch");
  const maxSub = `u${"a".repeat(127)}`;
  assert.equal((await mintToken({...member, sub: maxSub}, "4b7d2a")).clientId === maxSub, true,
    "Maximum-length client ID mismatch");
  await exactTypeError(() => mintToken(member, "ABCDEF"), "Invalid document id");
  const guest = {sub: "u_fixture_guest_23", email: "reader@review.invalid", name: "Fixture Reader", isOrg: false};
  const guestA = await mintToken(guest, "4b7d2a");
  const guestB = await mintToken(guest, "4b7d2a");
  assert.equal(guestA.clientId, `g_${"01".repeat(6)}`,
    "First guest mint did not consume exactly 6 client-ID bytes");
  assert.equal(guestB.clientId, `g_${"02".repeat(6)}`,
    "Second guest mint did not consume a fresh 6-byte client-ID draw");
  for (const successMode of ["mint-200", "ok", "mint-202", "mint-299"]) {
    mode = successMode;
    const accepted = await mintToken(member, "4b7d2a");
    assert.equal(accepted?.clientId, member.sub,
      `Mint did not accept valid ${successMode === "ok" ? 201 : successMode.slice(5)} response`);
  }
  mode = "capability-reversed";
  const reversedCapability = await mintToken(member, "4b7d2a");
  assert.deepEqual(JSON.parse(reversedCapability.capability), {
    [clientChannel]: ["subscribe", "publish"], [serverChannel]: ["subscribe"],
  });
  for (const boundaryMode of ["stale-boundary", "future-boundary", "expiry-boundary"]) {
    resetClock();
    mode = boundaryMode;
    const accepted = await mintToken(member, "4b7d2a");
    assert.equal(accepted?.clientId, member.sub,
      `Mint rejected exact inclusive ${boundaryMode} response`);
    assert.deepEqual(clockReads, [fixedNow, fixedNow + 25]);
  }
  mode = "ok";
  console.log("PASS  realtime token request contract");

  const nativeProcessEnv = process.env;
  let methodKeyReads = 0;
  process.env = new Proxy(nativeProcessEnv, {
    get(target, key, receiver) {
      if (key === "ABLY_API_KEY") methodKeyReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    for (const method of ["POST", "HEAD"]) {
      const counts = {...globalThis.__p2fCounts};
      const requests = fetchCount;
      await assertResponse(await call(method), 405, {allow: true});
      assert.deepEqual(globalThis.__p2fCounts, counts);
      assert.equal(fetchCount, requests);
    }
  } finally {
    process.env = nativeProcessEnv;
  }
  assert.equal(methodKeyReads, 0, "unsupported method read ABLY_API_KEY");
  for (const identityFailure of [
    "identity-private-string",
    new AggregateError(
      [new Error("identity-private-detail", {cause: new Error("nested-identity-detail")})],
      "identity-private-aggregate"
    ),
  ]) {
    const accessBefore500 = globalThis.__p2fCounts.access;
    const requestsBefore500 = fetchCount;
    globalThis.__p2fIdentityFailure = identityFailure;
    await assertResponse(await call("GET"), 500);
    await assertResponse(await call("GET", "?doc=not-valid"), 500);
    assert.equal(globalThis.__p2fCounts.access, accessBefore500);
    assert.equal(fetchCount, requestsBefore500);
  }
  globalThis.__p2fIdentityFailure = undefined;
  globalThis.__p2fUser = null;
  const accessBefore401 = globalThis.__p2fCounts.access;
  await assertResponse(await call("GET"), 401);
  await assertResponse(await call("GET", "?doc=not-valid"), 401);
  assert.equal(globalThis.__p2fCounts.access, accessBefore401);
  globalThis.__p2fUser = guest;
  for (const query of ["", "?doc=4b7d2a&doc=4b7d2a", "?doc=ABCDEF", "?doc=zzzzzz"]) {
    const accessBefore400 = globalThis.__p2fCounts.access;
    await assertResponse(await call("GET", query), 400);
    assert.equal(globalThis.__p2fCounts.access, accessBefore400);
  }
  globalThis.__p2fAccess = {role: "none", canRead: false};
  const requestsBefore403 = fetchCount;
  await assertResponse(await call("GET"), 403);
  assert.equal(fetchCount, requestsBefore403);
  globalThis.__p2fAccess = Object.assign(new Error("store-private-detail"), {
    name: "StoreError", code: "unavailable", status: 503
  });
  await assertResponse(await call("GET"), 503);
  assert.equal(fetchCount, requestsBefore403);
  globalThis.__p2fAccess = Object.assign(new Error("record-private-detail"), {
    name: "AccessError", code: "invalid-record", status: 500
  });
  await assertResponse(await call("GET"), 500);
  globalThis.__p2fAccess = new Error("generic-private-detail");
  await assertResponse(await call("GET"), 500);
  globalThis.__p2fAccess = Object.assign(new Error("lookalike-private-detail"), {
    name: "AccessError", code: "unavailable", status: 503
  });
  await assertResponse(await call("GET"), 500);
  for (const fields of [
    {name: "StoreError", code: "other", status: 503},
    {name: "StoreError", status: 503},
    {name: "StoreError", code: "unavailable", status: 500},
    {name: "StoreError", code: "unavailable"},
  ]) {
    globalThis.__p2fAccess = Object.assign(new Error("partial-store-private-detail"), fields);
    await assertResponse(await call("GET"), 500);
  }
  globalThis.__p2fShouldThrowAccess = true;
  for (const primitive of ["access-private-string", 17, null, undefined]) {
    globalThis.__p2fAccessThrow = primitive;
    await assertResponse(await call("GET"), 500);
  }
  let thrownGetterCalls = 0;
  const accessorStoreError = {};
  Object.defineProperties(accessorStoreError, {
    name: {enumerable: true, get() { thrownGetterCalls += 1; return "StoreError"; }},
    code: {enumerable: true, value: "unavailable"},
    status: {enumerable: true, value: 503},
  });
  let thrownProxyTrapCalls = 0;
  const hostileThrownProxy = new Proxy({}, {
    get() { thrownProxyTrapCalls += 1; throw new Error("private get trap"); },
    getOwnPropertyDescriptor() {
      thrownProxyTrapCalls += 1;
      throw new Error("private descriptor trap");
    },
    ownKeys() { thrownProxyTrapCalls += 1; throw new Error("private keys trap"); },
  });
  for (const hostile of [accessorStoreError, hostileThrownProxy]) {
    globalThis.__p2fAccessThrow = hostile;
    await assertResponse(await call("GET"), 500);
  }
  assert.equal(thrownGetterCalls, 0, "access error classification invoked a getter");
  assert.equal(thrownProxyTrapCalls, 0, "access error classification entered a Proxy trap");
  globalThis.__p2fShouldThrowAccess = false;
  globalThis.__p2fAccessThrow = undefined;
  let accessGetterCalls = 0;
  const accessorAccess = {};
  Object.defineProperty(accessorAccess, "canRead", {
    enumerable: true,
    get() { accessGetterCalls += 1; return true; },
  });
  const nonEnumerableAccess = {};
  Object.defineProperty(nonEnumerableAccess, "canRead", {value: true, enumerable: false});
  const symbolAccess = {canRead: true};
  symbolAccess[Symbol("invented-access-field")] = true;
  const readOnlyAccess = {};
  Object.defineProperty(readOnlyAccess, "canRead", {
    value: true, enumerable: true, writable: false, configurable: true,
  });
  const fixedAccess = {};
  Object.defineProperty(fixedAccess, "canRead", {
    value: true, enumerable: true, writable: true, configurable: false,
  });
  let accessProxyTrapCalls = 0;
  const proxyAccess = new Proxy({canRead: true}, {
    ownKeys() { accessProxyTrapCalls += 1; throw new Error("private keys trap"); },
    getOwnPropertyDescriptor() {
      accessProxyTrapCalls += 1;
      throw new Error("private descriptor trap");
    },
  });
  class InventedAccess { constructor() { this.canRead = true; } }
  for (const malformed of [
    null, [], {}, {role: "viewer"}, {canRead: "yes"},
    Object.assign(Object.create(null), {canRead: true}),
    Object.assign(Object.create({inherited: true}), {canRead: true}),
    new InventedAccess(), accessorAccess, nonEnumerableAccess, symbolAccess,
    readOnlyAccess, fixedAccess, proxyAccess,
  ]) {
    globalThis.__p2fAccess = malformed;
    await assertResponse(await call("GET"), 500);
  }
  assert.equal(accessGetterCalls, 0, "access validation invoked an accessor");
  assert.equal(accessProxyTrapCalls, 0, "access validation entered a Proxy trap");
  assert.equal(fetchCount, requestsBefore403);
  globalThis.__p2fAccess = {role: "editor", canRead: false};
  await assertResponse(await call("GET"), 403);
  assert.equal(fetchCount, requestsBefore403);
  globalThis.__p2fAccess = {role: "none", canRead: true};
  const contradictoryAllow = await call("GET");
  await assertResponse(contradictoryAllow.clone(), 200, {jsonBody: true});
  assert.deepEqual(Object.keys(await contradictoryAllow.json()).sort(),
    ["capability", "clientId", "expires", "issued", "token"]);
  const authorityCall = globalThis.__p2fAccessCalls.at(-1);
  assert.equal(authorityCall.docId, "4b7d2a",
    "Authorization did not receive the parsed document ID");
  assert.strictEqual(authorityCall.session, guest,
    "Authorization did not receive the exact identity result");
  const authorityMint = JSON.parse(records.at(-1).body);
  assert.equal(authorityMint.capability, capability,
    "Authorized document was not the document minted");
  globalThis.__p2fAccess = {role: "viewer", canRead: true};
  const guestResponse = await call("GET");
  await assertResponse(guestResponse.clone(), 200, {jsonBody: true});
  assert.match(guestResponse.headers.get("content-type") ?? "", /^application\/json(?:;|$)/);
  const guestBody = await guestResponse.json();
  assert.deepEqual(Object.keys(guestBody).sort(), ["capability", "clientId", "expires", "issued", "token"]);
  assert.equal(/^g_[0-9a-f]{12}$/.test(guestBody.clientId), true,
    "Endpoint guest client ID shape mismatch");
  assert.equal(guestBody.capability === capability, true,
    "Endpoint capability mismatch");
  assert.equal(JSON.stringify(guestBody).includes("reader@review.invalid"), false);
  globalThis.__p2fUser = member;
  globalThis.__p2fAccess = {role: "commenter", canRead: true};
  const memberResponse = await call("GET");
  await assertResponse(memberResponse.clone(), 200, {jsonBody: true});
  assert.equal((await memberResponse.json()).clientId === member.sub, true,
    "Endpoint member client ID mismatch");
  const alternateResponse = await call("GET", "?doc=5c8e3b");
  await assertResponse(alternateResponse.clone(), 200, {jsonBody: true});
  const alternateAuthorityCall = globalThis.__p2fAccessCalls.at(-1);
  assert.equal(alternateAuthorityCall.docId, "5c8e3b",
    "Authorization did not receive the alternate parsed document ID");
  assert.strictEqual(alternateAuthorityCall.session, member,
    "Alternate authorization did not receive the exact identity result");
  const alternateMint = JSON.parse(records.at(-1).body);
  assert.equal(alternateMint.capability,
    JSON.stringify({
      "doc:5c8e3b:server": ["subscribe"],
      "doc:5c8e3b:client": ["publish", "subscribe"],
    }),
    "Capability decision did not gate the same alternate document minted");
  globalThis.__p2fUser = guest;
  globalThis.__p2fAccess = {role: "viewer", canRead: true};
  globalThis.__p2fDisableAfterIdentify = true;
  await assertResponse(await call("GET"), 204);
  globalThis.__p2fDisableAfterIdentify = false;
  process.env.ABLY_API_KEY = apiKey;
  console.log("PASS  realtime token endpoint contract");

  mode = "ok";
  const threadResult = await publish("4b7d2a", {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"});
  assert.equal(threadResult !== null &&
    Object.keys(threadResult).sort().join(",") === "channel,messageId" &&
    threadResult.channel === serverChannel &&
    threadResult.messageId === "invented-message-001", true,
    "Thread publish result mismatch");
  let publishRecord = records.at(-1);
  assert.equal(publishRecord.url === "/channels/doc%3A4b7d2a%3Aserver/messages", true,
    "Thread publish path mismatch");
  const threadMessage = JSON.parse(publishRecord.body);
  assertOrdinaryDataObject(threadMessage, ["name", "data"]);
  assertOrdinaryDataObject(threadMessage.data, ["threadId"]);
  assert.equal(Object.keys(threadMessage).sort().join(",") === "data,name" &&
    threadMessage.name === "thread.changed" &&
    Object.keys(threadMessage.data).join(",") === "threadId" &&
    threadMessage.data.threadId === "t_m8x2k1_4f7a9c31", true,
    "Thread publish payload mismatch");
  const hash = "8f14e45fceea167a5a36dedd4bea2543d42049f25f0f4c31f9e8b21f841f8277";
  await publish("4b7d2a", {t: "edit.saved", aid: "a3f19c2b", hash});
  publishRecord = records.at(-1);
  const editMessage = JSON.parse(publishRecord.body);
  assertOrdinaryDataObject(editMessage, ["name", "data"]);
  assertOrdinaryDataObject(editMessage.data, ["aid", "hash"]);
  assert.equal(Object.keys(editMessage).sort().join(",") === "data,name" &&
    editMessage.name === "edit.saved" &&
    Object.keys(editMessage.data).sort().join(",") === "aid,hash" &&
    editMessage.data.aid === "a3f19c2b" && editMessage.data.hash === hash, true,
    "Edit publish payload mismatch");
  assert.equal(/email|name":"Fixture|role|actor|fixture-secret/i.test(publishRecord.body), false,
    "Publish body contained private data");
  let eventGetterCalls = 0;
  const accessorEvent = {threadId: "t_m8x2k1_4f7a9c31"};
  Object.defineProperty(accessorEvent, "t", {
    enumerable: true,
    get() { eventGetterCalls += 1; return "thread.changed"; },
  });
  const nonEnumerableEvent = {t: "thread.changed"};
  Object.defineProperty(nonEnumerableEvent, "threadId", {
    value: "t_m8x2k1_4f7a9c31", enumerable: false,
  });
  const symbolEvent = {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"};
  symbolEvent[Symbol("invented-event-field")] = true;
  const readOnlyEvent = {threadId: "t_m8x2k1_4f7a9c31"};
  Object.defineProperty(readOnlyEvent, "t", {
    value: "thread.changed", enumerable: true, writable: false, configurable: true,
  });
  const fixedEvent = {threadId: "t_m8x2k1_4f7a9c31"};
  Object.defineProperty(fixedEvent, "t", {
    value: "thread.changed", enumerable: true, writable: true, configurable: false,
  });
  class InventedEvent {
    constructor() { this.t = "thread.changed"; this.threadId = "t_m8x2k1_4f7a9c31"; }
  }
  let eventProxyTrapCalls = 0;
  const proxyEvent = new Proxy(
    {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"}, {
      ownKeys() { eventProxyTrapCalls += 1; throw new Error("private keys trap"); },
      getOwnPropertyDescriptor() {
        eventProxyTrapCalls += 1;
        throw new Error("private descriptor trap");
      },
    });
  for (const bad of [
    {t: "thread.changed", threadId: "bad"},
    {t: "edit.saved", aid: "bad", hash},
    {t: "unknown"},
    {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31", extra: true},
    Object.create({t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"}),
    Object.assign(Object.create(null),
      {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"}),
    Object.assign(Object.create({inherited: true}),
      {t: "thread.changed", threadId: "t_m8x2k1_4f7a9c31"}),
    new InventedEvent(), accessorEvent, nonEnumerableEvent, symbolEvent,
    readOnlyEvent, fixedEvent, proxyEvent,
  ]) await exactTypeError(() => publish("4b7d2a", bad), "Invalid realtime event");
  assert.equal(eventGetterCalls, 0, "event validation invoked an accessor");
  assert.equal(eventProxyTrapCalls, 0, "event validation entered a Proxy trap");
  for (const docId of ["", "ABCDEF", "not-valid"]) {
    await exactTypeError(() => publish(docId, {t: "edit.saved", aid: "a3f19c2b", hash}), "Invalid document id");
  }
  console.log("PASS  realtime publish contract");

  for (const malformedKey of [
    " malformed:key", "malformed:key ", ":", "demo123.key456:",
    ":fixture-secret-value", "demo123.key456:fixture-secret-value:trailing",
  ]) {
    process.env.ABLY_API_KEY = malformedKey;
    const before = fetchCount;
    let malformedKeyError;
    try { await mintToken(member, "4b7d2a"); } catch (error) { malformedKeyError = error; }
    assertSanitizedErrorGraph(malformedKeyError);
    assert.equal((await publish("4b7d2a", {
      t: "edit.saved", aid: "a3f19c2b", hash,
    })) === null, true, "Malformed key publish did not degrade to null");
    assert.equal(fetchCount, before, "Malformed key reached provider fetch");
  }
  process.env.ABLY_API_KEY = apiKey;
  for (const failure of [
    "status", "malformed", "wide", "mismatch", "network", "delay", "mint-204",
    "expired", "expires-equals-issued", "expires-before-issued",
    "stale-issued", "future-issued", "overlong", "empty-token",
    "nonstring-token", "noninteger-issued", "noninteger-expires", "capability-null",
    "capability-array", "capability-malformed", "capability-wrong-channel",
    "capability-missing-channel", "capability-server-publish",
    "capability-server-wrong-op",
    "capability-missing-op", "capability-duplicate-op",
  ]) {
    mode = failure;
    let caught;
    try { await mintToken(member, "4b7d2a"); } catch (error) { caught = error; }
    assertSanitizedErrorGraph(caught);
  }
  mode = "status";
  await assertResponse(await call("GET"), 502);
  for (const failure of [
    "status", "malformed", "mismatch", "network", "delay", "publish-200",
    "empty-message-id", "nonstring-message-id",
  ]) {
    mode = failure;
    const before = fetchCount;
    assert.equal((await publish("4b7d2a", {t: "edit.saved", aid: "a3f19c2b", hash})) === null,
      true, "Publish provider failure did not degrade to null");
    assert.equal(fetchCount, before + 1);
  }
  assert.equal(/fixture-secret|Authorization|provider-private|invented-token|reader@/i
    .test(JSON.stringify(records)), false, "Request records contained private data");
  console.log("PASS  realtime degradation and privacy contract");
} finally {
  delete process.env.ABLY_API_KEY;
  globalThis.fetch = nativeFetch;
  Date.now = nativeDateNow;
  await new Promise((resolve) => server.close(resolve));
}
EOF

ABLY_API_KEY='demo123.key456:fixture-secret-value' \
  node --no-warnings --experimental-loader "$P2F_TMP/crypto-loader.mjs" "$P2F_TMP/test.mjs"
trap - HUP INT TERM
P2F_RUNTIME_BODY
```

With a completed authenticated P2-H claim and reservation, expected stdout remains exactly these five lines for P2-H's release-fixture oracle. Otherwise, including with any merely present or hostile owner-looking environment value, mandatory standalone stdout first contains exactly these six supervisor lines in order and then the same five runtime lines. Either mode exits nonzero before a line whose group fails and prints no URL, credential, Authorization value, token, email address, provider body, or remediation artifact on success:

```text
PASS  P2-F supervisor handles real early HUP, INT, and TERM before root creation
PASS  P2-F supervisor handles real active HUP, INT, and TERM
PASS  P2-F supervisor gives post-result, first-of-two final-cleanup, and timeout-cleanup signals final authority
PASS  P2-F supervisor preserves natural child signal statuses
PASS  P2-F supervisor terminates a timed-out TERM-resistant descendant group
PASS  P2-F supervisor removes descendants after their parent exits
```

```text
PASS  realtime disabled contract
PASS  realtime token request contract
PASS  realtime token endpoint contract
PASS  realtime publish contract
PASS  realtime degradation and privacy contract
```

The outer parentheses isolate both modes. The inherited path is the canonical P2-A owner protocol, not an environment shortcut: a private 32-hex nonce keys insertion-ordered newline-JSON HMAC-SHA-256 messages on child-readable fd 4 and child-writable fd 5. `claim` proves the live outside-group owner, current anchor PGID, resolved non-symlink owner root, and at-most-120-second lease. Before `reserve`, at least 116 seconds must remain: the fixed 105-second worker budget, 1-second TERM grace, 2-second KILL/reap bound, 5-second release exchange, 1-second safety margin, and 2-second reserve/setup allowance. `reserve` transfers the nonexistent direct root and sibling evidence path before either is created; after reservation at least 115 seconds must remain, and immediately before inherited mode is committed at least the full 114-second worker/cleanup/release budget must remain. A short claim therefore falls back before reservation, and a budget lost during reservation/setup is authentically released and deleted before fallback. The wrapper then invokes the shared worker through an ordinary non-detached Bash child with pipefail and sends `release` only after reaping it. P2-H acknowledges release only after bounded deletion and path-absence proof; it also owns those registered paths if it KILLs the inherited anchor group. Any pre-reservation authentication failure closes the private descriptors and uses standalone mode; no unauthenticated caller-supplied root is honored.

In standalone mode, the Node supervisor installs HUP/INT/TERM handlers before resolving a temp parent or creating the canonical `p2f.*` root. A remediation artifact may be created only after that parent is proven absolute, non-root, resolved, a directory, and non-symlink; an empty/unresolved parent, cwd fallback, or `/` yields only the `not-applicable` locator. The supervisor first persists a mode-0600 sibling evidence file, creates a positive detached anchor that publishes a fresh private nonce before it may spawn the command, verifies that the retained direct child still leads a one-member PGID, persists active ownership, and only then sends `start`. The anchor stays alive through command `result`; it exits only on authenticated `release` or group KILL. Before every group TERM or KILL, a bounded `ps` check must still find that unreaped direct anchor as the current PGID leader, preventing signaling of a stale/reused group. The supervisor reaps the anchor, awaits stream closure, proves group disappearance, revalidates the regular non-symlink mode-0600 evidence, and only then starts a separately retained, bounded deletion group; an asynchronous deletion spawn error is observed before any PID use, while deletion timeout KILLs and reaps the direct leader before checking stream closure, group disappearance, and absence. The sibling evidence is unlinked only after recursive root deletion has succeeded and absence is proven, so write/chmod/rename/post-write, containment, reap, disappearance, and deletion uncertainty retain an actionable artifact. Every recursive lifecycle/failure invocation is itself the command of another retained detached anchor with the same finite containment proof. The first signal latch counts later deliveries without replacing the first status; the final-cleanup cases deliver a distinct second signal while deletion is active and finally recheck the first 129/130/143. Natural child HUP/INT/TERM/KILL maps to 129/130/143/137. Failure stderr prints exactly `ERROR  P2-F standalone cleanup could not be proven; guarded-root=<validated path or not-applicable> evidence-path=<private artifact or not-applicable> supervisor-pid=<positive PID or not-applicable> leader-pgid=<positive PGID or not-applicable>; manual remediation required`.

The fixed fixture credential applies only to the worker's Node command; the harness does not save, restore, unset, or export the caller's `ABLY_API_KEY`. The loader intercepts `node:crypto` only for the copied production `realtime.mjs`: any entropy request other than exactly 6 bytes for an external client ID or 16 bytes for a nonce throws, and deterministic byte sequences make both assertions non-probabilistic. `--no-warnings` suppresses only Node's experimental-loader notice so the owner fixture retains its exact no-stderr runtime contract. On a successful run, the Node fixture restores its clock/fetch seams and closes its loopback server. The authenticated P2-H outside owner or standalone supervisor then performs its bounded removal, so no fixture process, file, scratch variable, loader, or environment assignment remains in the caller.

Then run repository gates and mechanically reject every implementation path outside the two owned files. Set `P2F_BASE` to the reviewed commit that already contains this ticket and all required predecessors, not to an arbitrary ancestor:

```bash
bash <<'P2F_REPOSITORY_GATES'
set -euo pipefail

scripts/scrub-check.sh
npm --prefix templates/docbuild run check
git diff --check
export P2F_BASE="$(git rev-parse --verify "${P2F_BASE:?set P2F_BASE to the reviewed predecessor commit}^{commit}")"
node <<'EOF'
const {execFileSync} = require("node:child_process");
const assert = require("node:assert/strict");
const base = process.env.P2F_BASE;
const run = (args) => execFileSync("git", args, {encoding: "utf8"}).trim().split("\n").filter(Boolean);
const changed = new Set([
  ...run(["diff", "--name-only", `${base}...HEAD`]),
  ...run(["diff", "--name-only"]),
  ...run(["diff", "--cached", "--name-only"]),
  ...run(["ls-files", "--others", "--exclude-standard"])
]);
const allowed = new Set(["netlify/lib/realtime.mjs", "netlify/functions/realtime-token.mjs"]);
const unexpected = [...changed].filter((path) => !allowed.has(path));
assert.deepEqual(unexpected, [], `P2-F changed unowned paths: ${unexpected.join(", ")}`);
assert.deepEqual([...changed].sort(), [...allowed].sort());
console.log("PASS  P2-F exclusive source ownership");
EOF
git status --short
P2F_REPOSITORY_GATES
```

The final implementation diff contains exactly the two owned source paths. Generated `node_modules`, `_site`, `.netlify`, logs, response captures, and temporary fixture modules do not remain or become staged.

### Optional disposable Ably smoke

This smoke is optional and never blocks the deterministic acceptance suite unless an operator explicitly chooses to run it. Create a disposable Ably application and a disposable API key limited to publish and subscribe on `doc:*:server` and `doc:*:client`; do not reuse a production application or key. Use invented document `4b7d2a`, member `u_fixture_member_17`, anchor `a3f19c2b`, and the 64-hex fixture hash above.

Read the key without echo into a process environment variable, with shell tracing disabled. Run a temporary Node 22 script that imports the real `mintToken()` and `publish()`, asserts the five-field two-channel token and 201 acknowledgement projections in memory, opens `https://main.realtime.ably.net/sse?channel=doc%3A4b7d2a%3Aserver&v=1.2&enveloped=true&accessToken=<encoded token>` through `fetch`, publishes one `edit.saved`, and aborts the stream as soon as the exact enveloped invented message is observed or after 10 seconds. Independently attempt a client-token REST publish to the server channel and require provider denial, then publish and observe an invented client event only on the client channel. The script must not print a URL, token, Basic header, key, event stream body, or denial body; stdout is only `PASS  disposable Ably token, channel separation, publish, and SSE contract`.

In an unconditional cleanup trap, stop the script, unset `ABLY_API_KEY`, delete its temporary directory, and remove any capture. Delete the disposable Ably API key and application in the provider dashboard; channels require no separate provisioned resource, but the invented message may remain in disposable history until the application is deleted. If key/application deletion cannot be confirmed, the smoke is not complete: record only the disposable application identifier needed for targeted cleanup, never its secret, and finish deletion before reporting success.

## Failure modes

| Failure | Required behavior |
|---|---|
| Realtime is not configured | Both helpers return `null`; GET returns 204; no identity, access, provider, console, or browser error |
| Unsupported method | 405, `Allow: GET`, empty body, no other work |
| `identify(req)` throws or rejects despite P2-H's null-on-failure contract | Generic 500 with only `Cache-Control: private, no-store` and an empty body; do not inspect or expose the error, parse the query, resolve access, or contact Ably |
| Missing/invalid session returned as `null` | 401, empty body, no document authorization or provider request |
| Invalid or duplicate document query | 400 after authentication, before access/provider work |
| Authenticated reader resolves with `canRead: false` | 403, empty body, no token request |
| Access store throws P2-B `unavailable`/503 | 503, empty body; do not mint on an unproven authorization result |
| Access resolution throws any configuration/record/option/internal error, or returns a malformed/non-boolean `canRead` result | 500, empty body; never collapse corrupt authority into either denial or provider failure |
| Configured key is malformed | `mintToken()` rejects with the safe provider error and endpoint returns 502; `publish()` resolves `null`; no secret detail escapes |
| Ably token request times out, rejects, is non-2xx, or returns malformed/wider/stale/future/expired/overlong details | `mintToken()` rejects only a newly constructed `Realtime provider unavailable` error with no cause or retained provider error graph; endpoint returns 502 with no body |
| Ably publish times out, rejects, returns even a valid-body 200, is otherwise non-201, or has a malformed acknowledgement | `publish()` resolves `null`, makes no retry, and does not affect the durable write |
| Caller passes a bad document/session/event while configured | Exact `TypeError`, no provider request; this is a server programming fault, not provider degradation |
| Provider returns extra response fields | Ignore them and return only the documented safe projection after required-field validation |
| Client attempts another document/identity or forges a server projection | Channel/capability/client ID are server-derived and validated. Ably denies client publication on `doc:<docId>:server`; P3-F accepts durable projections only from that channel, while browser publish/subscribe is confined to `doc:<docId>:client` |
| Browser calls cross-origin | No CORS allow header is returned; identity and document role checks still run for a readable same-origin request |
| Standalone fixture runs outside macOS/Linux | Fail before guarded-root creation; the mandatory standalone supervisor is not silently bypassed |
| Standalone parent receives HUP/INT/TERM before root creation, while the fixture is active, after its command result, or during final deletion | The first observed signal is authoritative as 129/130/143; empty-root cleanup is safe, active descendants are contained, and the final post-removal recheck cannot return a false zero |
| Standalone publication/evidence/deletion fails, the fixture times out, leaves a TERM-resistant descendant, or exits while a delayed descendant remains | Do not start before anchor publication and active evidence. Signal a group only after fresh retained-anchor proof; TERM then KILL if needed; reap/close/prove disappearance before guarded bounded deletion. On any uncertainty retain the root and mode-0600 actionable evidence, detach local handles, print the exact manual PID/PGID/root locator, and fail |
| Owner nonce/descriptors are missing, closed, silent, stale, replayed, wrong-MAC, wrong-PGID, dead, malformed, or below the stage-specific 116/115/114-second lease budgets | Do not commit inherited mode. Before reservation, create no artifact and use standalone; after reservation, authenticate release, prove both paths absent, then use the same finite standalone supervisor. No merely nonempty or 32-hex environment value enables inherited mode |
| Canonical P2-H claim and reserve succeed | Run one ordinary inherited worker with no detached descendant, preserve the exact five runtime PASS lines, and let P2-H's outside-group owner bound deletion of the registered root/evidence on authenticated release or inherited-group KILL; it may acknowledge clean only after both paths are absent |
| Token or API key appears in logs/storage | Security failure; remove the leak, rotate/revoke the affected disposable or real credential, and rerun scrub/privacy checks before completion |
| Realtime message contains prose or personal data | Contract failure; only the exact ID/hash projections are accepted and emitted |

## Settled decisions

- Ably is optional and is the only realtime provider. No key means a silent dark feature, not a deployment error.
- Each permanent six-hex document has exactly two channels, `doc:<docId>:server` and `doc:<docId>:client`; no slug, directory, path, wildcard, unsuffixed channel, or multi-document token is accepted.
- The client token lasts at most 60 minutes. It has subscribe only on one `doc:<docId>:server` channel and publish/subscribe only on the paired `doc:<docId>:client` channel; it has no server-channel publish, wildcard, presence, or history capability.
- P2-F uses Ably's REST API directly with Node 22 platform features and adds no SDK or package.
- The API key remains server-only under Functions scope and a least-privileged provider capability. Basic authentication is used only over HTTPS.
- `mintToken()` returns validated TokenDetails, not a signed TokenRequest, because downstream SSE needs the raw short-lived token string.
- `isOrg` selects the client identity policy but never grants document access. `resolveRole()` is the sole document authorization decision.
- External client IDs are random per mint. Stable identity and personal data do not enter presence/realtime messages.
- Token response timestamps are checked against both local request and response samples with exactly one minute of provider clock skew; a structurally valid but already-expired or implausibly timed credential is unavailable, not a success.
- Provider failures are collapsed into a newly allocated safe error without `cause`; the original error, nested causes, aggregates, attached response data, and all other provider details are discarded rather than propagated.
- Server messages are `thread.changed` with `threadId` or `edit.saved` with `aid` and `hash`; no text, actor, identity, or presentation data is published.
- Realtime delivery is best effort. Durable state, polling, hash conflict checks, and the audit log remain authoritative.
- The token endpoint is GET, private/no-store, same-origin by browser policy, and does not call the mutating-request Origin guard.
- The marked runtime fixture has exactly two ownership modes: the canonical P2-A-compatible authenticated P2-H claim/reserve/release owner when that live handshake succeeds, and otherwise a mandatory finite retained-anchor standalone supervisor on macOS/Linux. Both execute one shared worker body; only the owning layer may recursively delete its guarded root, and owner-looking environment values alone never choose inherited mode.
- Source authoring uses maximum safe parallelism only after every listed ticket's own declared predecessors are complete, integrated, and green: P2-F and the other disjoint tickets may author alongside P2-B, but P2-G begins only after P2-B is complete, integrated, and green; final access/identity/runtime integration is serialized after P2-G and P2-H.

## Assumptions and open questions

### Assumptions

- **TokenDetails reconciliation:** Research 07 says the 200 body is a `TokenRequest`, but its client requires `tok.token`. Current Ably documentation says an authenticated unsigned request to `requestToken` returns `TokenDetails`; this ticket's safe five-field projection is the minimum contract that makes P3-F possible without exposing the API key.
- **Authorization integration:** The ruling plan's P2-F row names only P1-C and P1-E, while its later access ruling makes `resolveRole()` the sole document authority and P2-H removes P1-C's `docs`. P2-F may be authored against those same-phase interfaces, but final endpoint acceptance waits for P2-G and P2-H. A transitional `docs` fallback would be insecure after integration and is prohibited.
- **Document grammar:** P1-A resolves the ruling plan's contradictory sample by enforcing its normative six-lowercase-hex generation rule. P2-F therefore accepts `^[0-9a-f]{6}$` and uses invented `4b7d2a`, not the plan's non-hex `k7m2q4` sample.
- **Provider timeout:** The plan does not set an outbound timeout. Five seconds bounds token endpoint latency and background fan-out work while leaving durable state authoritative; it is implemented with Node 22's `AbortSignal.timeout()` and is covered deterministically.
- **Token response status:** Ably documents any 20x REST response as success but does not pin a single status for `requestToken`. P2-F accepts 200–299 only when a complete, narrow TokenDetails body validates; an empty 204 therefore still becomes the sanitized provider failure. Publish is explicitly 201-only in Ably's contract.
- **Guest identity lifetime:** Research 07 says “per-session,” but P2-F has no safe server session store. A fresh `g_` ID per token mint is more private and still binds each live credential. P3-G must tolerate a guest identity change after token refresh.
- **No CORS header:** The plan specifies a same-origin authenticated GET and no cross-origin consumer. Omitting CORS headers is the narrow browser contract; it does not replace identity or role authorization.

### Open questions

None block implementation. P3-F must choose a current valid integer message-count rewind (or omit rewind) because Ably's current SSE API no longer documents duration syntax. If a live disposable test contradicts the current REST status or SSE behavior, record the provider response status and documentation version without printing credentials, then update the owning downstream ticket or this provider contract through normal review rather than silently widening capability or error handling.

## References

- `HANDOFF.md`, “Non-negotiable,” “Decisions that are already made,” and “What done means for a ticket here” — public-repository scrub rules, optional realtime, secret handling, ticket boundaries, and acceptance expectations.
- `README.md`, “Checks” and “The platform” — current repository gates, Node constraints, zero-dependency builder boundary, and ruling-plan authority.
- `docs/research/00-integration-plan.md` §§1.2, 1.3, 1.5, 1.6, 4.7, and 6 — Functions v2 identity, permanent document IDs, sole role resolution, optional realtime, canonical P2-F/P3-F/P4-H numbering, and conflict rulings.
- `docs/research/07-realtime-and-presence.md` §§4, 7–12, 14, and 15 — ephemeral-presence boundary, channel/events, degradation, privacy, ticket seam, verification intent, unknowns, and original cited sources. Its TokenRequest success wording and duration rewind are superseded by the current primary API references below.
- `docs/research/09-sharing-and-roles.md` §§3.2–3.3 and 4 — final `identify()` shape, `resolveRole(docId, user)` contract, and the rule that identity is not document authorization. Its internal ticket letters are superseded by the ruling plan.
- `docs/tickets/P1-A.md`, “Interface contract” and “Assumptions and open questions” — exact permanent document ID grammar and resolution of the plan's invalid sample.
- `docs/tickets/P1-C.md`, “Interface contract” and “Dependencies” — Functions v2 identity boundary, read-only Origin behavior, root Node 22 package, and temporary Phase 1 fields that P2-H later removes.
- `docs/tickets/P1-E.md`, “Interface contract” and “Dependencies” — Netlify Functions configuration, Node 22 deployment runtime, `/api/*` edge exclusion, and shared-runtime serialization.
- [Ably REST API reference](https://ably.com/docs/api/rest-api) — Basic authentication, JSON/version headers, common 20x/error behavior, exact `requestToken` and channel publish routes, and the publish 201 acknowledgement.
- [Ably TokenRequest specification](https://ably.com/docs/api/token-request-spec) — unsigned request JSON, TTL/capability/client identity fields, nonce/timestamp shape, and the returned TokenDetails contract.
- [Ably SSE API](https://ably.com/docs/api/sse) — exact `/sse` endpoint, `channel`, `v`, raw `accessToken`, enveloped messages, and current integer-count `rewind` contract consumed by P3-F.
- [Ably token authentication](https://ably.com/docs/auth/token) — short-lived, capability-scoped, client-identity-bound token guidance.
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/) — Fetch-style Functions v2 default handlers, standard `Request`/`Response`, and background `context.waitUntil()` behavior.
- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/?fn-language=js) — custom `config.path`, custom-path exclusivity, and default all-method routing that lets the handler own exact 405 behavior.
- [Netlify Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/) and [environment variable overview](https://docs.netlify.com/build/environment-variables/overview/) — `process.env`, Functions scope, deploy-context values, secret marking, and the prohibition on relying on `netlify.toml` for function runtime variables.
- [Netlify security checklist](https://docs.netlify.com/resources/checklists/security-checklist/) — keep sensitive values out of committed configuration and environment files and narrow their scope.
