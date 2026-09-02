# Near-real-time editing and presence

**Area:** the transport for live updates, and presence — who reads the document, who edits it, and where.

**Requirement, verbatim from the product owner:** "I additionally want us to make sure that we're using
WebSockets or any other relevant library or infrastructure to ensure near-real-time editing and being able
to see when other users are reading and editing the page, similar to Google Docs."

**Written:** 2026-09-02. `00-integration-plan.md` rules. This document does not change a binding decision
in section 1.1, 1.2, 1.3 or 1.4 of that plan. It contradicts one bullet in section 5 of that plan, and it
says so in section 13.

**Everything below was checked on 2026-09-02.** Sources are in section 15.

Language: ASD-STE100 Simplified Technical English. "Must" is a requirement. "Do not" is a prohibition.

---

## 1. The short version

**Netlify Functions cannot hold an open WebSocket. Netlify has no publish-subscribe primitive of any
kind. So a broker is necessary, and the broker must be a third party.**

**Recommendation, with a named first choice: Ably Pub/Sub, one channel for each document, subscribed with
the browser's own `EventSource` against Ably's SSE endpoint, published with `fetch` against Ably's REST
endpoint. A Netlify Function mints a short-lived, capability-scoped token. No SDK, no script tag, no
bundler, and not one byte added to the page's dependency surface.**

Five rulings follow from that:

1. **Presence is a broadcast, not a record.** It lives in the messages on the channel and in a map in each
   reader's tab. It is never written to Netlify Blobs and never written to the event log in section 2.4 of
   the plan.
2. **Presence is derived on the client from heartbeat messages.** Ably's own presence feature is not used,
   because Ably's SSE endpoint is subscribe-only and cannot enter a presence set. A heartbeat every 20
   seconds and an expiry at 50 seconds gives the same result with no SDK.
3. **No trigger in section 1.1 of the plan fires. The store decision does not change.** Trigger 4 is the
   reason presence must stay out of Blobs, not a reason to leave Blobs.
4. **A 5-second poll is good enough for content freshness, and it cannot do presence at all.** Not because
   it is too slow, but because a poll needs a mutable ephemeral store on the server, and this platform has
   none that is legal to use for it. The poll stays as the fallback for content only.
5. **"Near-real-time editing" in this design is block-level notification, not character-level
   co-editing.** The plan already rejects a conflict-free replicated data type, and nothing here reopens
   that. The socket makes a conflict rare and visible. The block hash in section 3.4 of the plan stays the
   only authority on a conflict.

The surprise in the cost arithmetic, in section 6: **the broker is about 1,000 times cheaper in Netlify
credits than a 5-second poll.** The socket is the cheap option here, not the heavy one.

---

## 2. The hard constraint, established first

### 2.1 Netlify Functions cannot hold a WebSocket

This is not a limit that a plan can work around. A Netlify Function is an AWS Lambda behind a request and
a response. It has these documented execution limits, checked 2026-09-02:

| Function type | Documented limit |
|---|---|
| Synchronous | 10 seconds |
| Background | 15 minutes, and it cannot stream a response |
| Streaming | 60 seconds, and a 20 MB response |

Netlify staff state the platform position in the support forum: "No server side processing is supported at
Netlify (outside of Functions used for API calls)." That reply is from 2019, so it is old. The 2026
evidence agrees with it: Netlify's own blog post on real-time applications does not offer a Netlify
WebSocket at all. It tells the reader to put Ably between the browser and the Functions.

**Conclusion: a WebSocket server on Netlify Functions is impossible. Do not plan one.**

### 2.2 Netlify Edge Functions can stream, and this is more interesting than it looks

An Edge Function is a Deno isolate at the edge. Its limits, checked 2026-09-02:

| Limit | Value |
|---|---|
| CPU time for each request | 50 ms |
| Response header timeout | 40 s |
| Memory for the set of deployed edge functions | 512 MB |
| Code size | 20 MB after compression |
| Included invocations | 1,000,000 each month |

The 50 ms is CPU time only. Netlify states that "time spent waiting for a response from an upstream
service, or waiting for a timer to expire, does not count towards this limit", and its own example page
says that "as long as a function returns headers within 40 seconds it can run indefinitely". Netlify
publishes a working server-sent-events example that holds a `ReadableStream` open with `setInterval`.

So **Netlify can hold a long-lived downstream pipe to a browser.** That is real, and it is documented.

The Edge Functions API reference also lists the **WebSocket API** among its supported web APIs. Read that
carefully. The `WebSocket` constructor makes an edge function a WebSocket *client* of some other server.
It is not a server-side upgrade. Netlify does not document `Deno.upgradeWebSocket`, and it does not
document the `Deno` namespace at all. Treat an inbound upgrade as unproved. See section 14.

### 2.3 The thing that is actually missing is fan-in, not fan-out

This is the finding that decides the whole document.

A live channel needs two halves:

- **Fan-out.** One server holds a pipe to each reader. Netlify Edge Functions can do this, with SSE.
- **Fan-in.** When reader A publishes, the server that holds reader B's pipe must learn about it.

**Netlify has no fan-in.** There is no shared memory between isolates, no message bus, no publish-subscribe
service, and no way for one invocation to signal another. The only shared thing on the platform is Netlify
Blobs, which is a key-value store with no change feed and no notification.

So an SSE Edge Function on Netlify has exactly one way to learn that something changed: poll Blobs from
inside the stream. That gives the same Blobs read volume as client polling, plus a held connection for each
reader, plus an edge invocation for each connection. **SSE with no broker is polling with extra steps.**
It is strictly worse than the plain poll, and it still cannot hold presence, because presence would have
to be written to Blobs. Section 4 shows why that is forbidden.

**Rule: do not build an SSE endpoint on Netlify for this. Use SSE as a client, against a broker that has
fan-in.**

---

## 3. The transports, compared

### 3.1 The comparison

Two constraints decide most of this table before the price does.

- **No runtime dependency in the page.** `templates/README.md` states why the document is one
  self-contained HTML file: a published Claude artifact runs under a strict content security policy that
  blocks every external host except the font CDN. Section 5 of the plan states the rule as "Any runtime npm
  dependency in the page. Zero." A realtime SDK is either an external `<script>` tag, which is blocked in
  an artifact and breaks self-containment, or it is inlined, which adds 100 KB or more to a 40 KB document.
- **`EventSource`, `WebSocket` and `fetch` are browser built-ins.** They cost nothing, they need no script
  tag, and they need no bundler. Any option that is reachable with only these three passes the constraint.
  Any option that needs its own SDK fails it.

Assumption for the cost column: **10 concurrent readers on one document, one hour, one document.**

| Option | Works from one static HTML file, no bundler | Free tier | Cost at 10 concurrent for 1 hour | Auth model | Needs a server we do not have | Verdict |
|---|---|---|---|---|---|---|
| WebSocket on Netlify Functions | — | — | — | — | — | **Impossible.** Section 2.1 |
| SSE from a Netlify Edge Function | Yes. `EventSource` is built in | 1,000,000 edge invocations each month | 10 invocations, plus a Blobs poll from inside each stream | The existing `nf_jwt` cookie | No, but it has **no fan-in** | **Reject.** Section 2.3. Polling with extra steps, and presence stays homeless |
| Client poll of `/api/*` | Yes. `fetch` is built in | 300 credits each month on Free | About **3.0 credits** at a 5-second interval. See section 6.2 | The existing cookie | No | **Keep as the fallback, for content only.** It cannot do presence |
| **Ably, SSE plus REST, no SDK** | **Yes.** `EventSource` to subscribe, `fetch` to publish | 6,000,000 messages each month, 200 concurrent connections, 200 channels, 200 presence members for each channel, 500 messages each second, 64 KiB each message | About **18,000 messages** and 600 connection-minutes. Free tier holds about 330 such hours each month. Netlify cost is 10 token mints, about **0.001 credits** | A Function holds `ABLY_API_KEY` and mints a token with a capability set and a `clientId` | No | **RECOMMENDED** |
| Ably with the JavaScript SDK | No. It needs `<script src="https://cdn.ably.com/lib/ably.min-2.js">` | Same as above | Same as above | Same as above | No | **Reject.** The SDK gives real presence and automatic reconnection, and the price is an external script tag. The SSE path buys the same result for about 90 lines |
| Pusher Channels, raw protocol over `WebSocket` | Yes, but only if the Channels wire protocol is hand-written | Sandbox plan: 100 concurrent connections, 200,000 messages each day | Well inside the free tier | An auth endpoint signs each private or presence channel, for each socket id | No | **Second choice.** A bidirectional socket is a better fit than SSE plus REST, and the price is roughly twice the client code: connect, subscribe, ping and pong, and a reconnect with back-off. The browser gives none of that for a raw `WebSocket` |
| Liveblocks | No. The documented no-bundler path is an ESM import from Skypack, plus a manual `globalThis.process` shim | 500 monthly active rooms, 10 projects, 3 team members, **10 simultaneous connections for each room** | Inside the free tier, and the per-room connection cap is exactly our target number | A Function mints a room token | No | **Reject.** It is the best product in the list for this problem and the worst fit for this page. It is React-first, it needs a module fetch from a third CDN, and its free per-room connection cap is 10, which is the number we plan for |
| PartyKit | The client is a plain `WebSocket`, so yes | Follows Cloudflare Workers and Durable Objects | Inside the free tier | Whatever the party server implements | **Yes.** Each party is a Cloudflare Durable Object that we must write and deploy | **Reject.** Cloudflare acquired PartyKit in April 2024, so it is now a wrapper over Durable Objects. It adds a second vendor, a second deploy pipeline and a second set of secrets |
| Supabase Realtime | The UMD bundle of `@supabase/supabase-js` exists on a CDN, so partly. It is an external script tag and it pulls the whole client | 200 peak concurrent connections, 2,000,000 realtime messages each month, 256 KB each message | Inside the free tier | A Function mints a JWT; channel access follows Realtime authorisation | No | **Reject.** Section 5 of the plan already rejects Supabase, for storage. A broker is not a store, so that rejection does not transfer by itself. It is rejected here on the SDK, and because Ably does the same job with no SDK |
| Cloudflare Durable Objects, direct | The client is a plain `WebSocket`, so yes | Available on the Workers Free plan, with the SQLite backend only: 100,000 requests each day, 13,000 GB-s each day, 5,000,000 SQLite reads each day, 100,000 writes each day, 5 GB stored | Far inside the free tier. Incoming WebSocket messages are billed at a 20:1 ratio, and the Hibernation API removes the duration charge while idle | Whatever the Worker implements | **Yes.** A Worker that we write, deploy and maintain | **Reject for version 1. Name it as the migration target.** It is the best technical fit in the list — one object for each document is exactly the right shape — and the cost is a second repository surface, a second deploy and a second on-call surface |

### 3.2 Why Ably wins on the axis that matters

`new EventSource(url)` gives automatic reconnection and `Last-Event-ID` resume for free, in every browser,
with no code. Ably's SSE endpoint accepts `lastEvent` to resume from a known point, and `rewind` to replay
a window of recent messages on a fresh attach. Publishing is one `fetch` POST to the REST endpoint.

That is the whole transport. It is about 90 lines. Every other option in the table either needs an SDK, or
needs a hand-written wire protocol, or needs a server we would have to run.

**The cost of the SSE path, stated honestly.** Ably's SSE endpoint is documented as subscribe-only. It
cannot publish, it cannot enter presence, it cannot read a presence set, and it cannot attach to a new
channel without restarting the stream. Publishing therefore goes over REST, and presence is derived on the
client. Section 4.3 shows that this is not a workaround; it is a smaller design.

---

## 4. Presence is not state. It is a broadcast.

### 4.1 Why Netlify Blobs is the wrong store for presence

Presence is high-frequency ephemeral state. Blobs is a durable key-value store with no expiry. The two do
not fit, and section 1.1 of the plan already says why.

**The write rate fires trigger 4 directly.** Trigger 4 is "sustained writes exceed about one per second on
one thread". Take 10 readers on one document, each with a heartbeat:

| Heartbeat interval | Writes each second, 10 readers | Trigger 4 |
|---|---|---|
| 20 s | 0.5 | Under, but only just |
| 15 s | 0.67 | Under, but only just |
| 5 s | 2.0 | **Fires** |
| 5 s, 2 documents live | 4.0 | **Fires hard** |

And that arithmetic is for a **shared** presence blob, which section 1.1 forbids outright: "Never a shared
mutable array in one blob." Ten readers writing a heartbeat into one array is the exact contention that
ruling exists to prevent, at a rate no comment traffic will ever reach.

**One blob for each viewer does not save it.** A key of `presence/<docId>/<sub>.json` removes the
contention, and then four new problems appear:

1. **Blobs has no time-to-live.** The documented `set` options are `metadata`, `onlyIfMatch` and
   `onlyIfNew`. There is no expiry. So a reader who closes the tab stays present forever, and something
   must delete the key. A delete is another write.
2. **Reading the roster costs a `list()` plus N `get()` calls**, on every poll, for every reader. Ten
   readers polling at 5 seconds is 7,200 list calls and about 72,000 get calls in an hour, for one
   document.
3. **Blobs rate limits are not published.** Document 03 lists this as unverified. Presence would be the
   first thing on this platform to test it, and it would test it during a live review session.
4. **It persists reading behaviour.** Who opened which document, and when. The requirement asks for a
   presence indicator, not a reading log. Section 10 covers this.

**Ruling: presence must not be written to Netlify Blobs, in any layout. Presence must not be persisted at
all.**

### 4.2 Where presence lives instead

Presence lives in two places, and neither is a store we own:

1. **In flight**, as ordinary messages on the document's Ably channel. Ably's free tier retains channel
   history for 24 hours; nothing in this design reads history except a 30-second `rewind` on attach.
2. **In each reader's tab**, as a plain object keyed by `clientId`. It dies when the tab closes.

There is no third place. No function writes presence. No blob holds presence. The event log in section 2.4
of the plan gains no new `kind`.

### 4.3 The roster, derived on the client

Ably has a presence feature. This design does not use it, for one reason: the SSE endpoint cannot enter a
presence set. Deriving the roster from heartbeat messages needs no SDK and gives the same result.

**The beat.** Each client publishes one message every 20 seconds while its tab is visible, and none while
its tab is hidden.

```json
{ "t": "beat", "label": "the owner W", "act": "reading", "aid": null }
```

`act` is `"reading"` or `"editing"`. `aid` is the `data-aid` of the block that holds the caret, or `null`.

**The roster.**

```js
var roster = Object.create(null);   // clientId -> { label, act, aid, seen }
var BEAT = 20000, TTL = 50000;

function onBeat(msg) {
  var id = msg.clientId;            // Ably stamps this from the token. Never from the body.
  if (!id) return;                  // A message with no clientId is not presence. Drop it.
  roster[id] = {
    label: String(msg.data.label || "Someone").slice(0, 24),
    act:   msg.data.act === "editing" ? "editing" : "reading",
    aid:   typeof msg.data.aid === "string" ? msg.data.aid : null,
    seen:  Date.now()
  };
  paint();
}

setInterval(function () {           // Expiry. This is the whole leave mechanism.
  var now = Date.now(), dirty = false;
  for (var id in roster) if (now - roster[id].seen > TTL) { delete roster[id]; dirty = true; }
  if (dirty) paint();
}, 5000);
```

**What the two intervals buy and cost.**

| Behaviour | With provider presence | With a 20 s beat and a 50 s expiry |
|---|---|---|
| A reader arrives | Immediate | Immediate. The client publishes one beat at once, and rewinds 30 s to see everybody else |
| A reader leaves the page | Immediate, on socket close | Immediate for a normal close, because the client publishes one `bye` on `pagehide`. Up to 50 s for a crash or a lost network |
| A reader starts to edit | Immediate | Immediate. The claim message in section 7 is published at once, not on the next beat |
| Message volume, 10 readers, 1 hour | Lower | 1,800 published, 16,200 delivered, about 18,000 counted |

A ghost that stays for up to 50 seconds after a laptop lid closes is an acceptable fault in an avatar
strip. It is not acceptable in an editing lock, so the editing lock is advisory only. Section 7 states
this.

---

## 5. Which of section 1.1's six triggers does this fire?

**None. The store decision does not change. Netlify Blobs stays, one blob for each record.**

| # | Trigger | Does this requirement fire it? |
|---|---|---|
| 1 | A query is no longer scoped to one document | **No.** A channel is scoped to one document, exactly like a blob prefix |
| 2 | Somebody asks to search comment text | **No.** Unrelated |
| 3 | One document passes about 200 threads and the first paint feels slow | **No.** Unrelated. A live channel makes the first paint cheaper, because the poll goes away |
| 4 | Sustained writes exceed about one per second on one thread | **No, and this is the interesting answer.** Trigger 4 would fire immediately if presence went into Blobs. It is therefore the reason presence must not go into Blobs. By keeping presence off Blobs, the write rate on Blobs does not change at all: it stays one write for each comment and one for each edit |
| 5 | A change must span two documents atomically | **No.** Unrelated |
| 6 | Per-user state that is not per-document is needed | **No.** A roster entry is per-document and it is never stored |

**This is the correct reading of trigger 4.** A trigger is a signal that the workload has outgrown the
store. Presence has not outgrown Blobs; presence was never a fit for a durable store of any kind, Postgres
included. A Postgres table of heartbeats at 0.5 writes each second for each document would be a bad design
for the same reason: it puts a 20-second fact in a permanent place. Moving to Postgres would not solve
this. A broker solves it.

**Add one line to section 1.1's "What this rules out" list:** *No ephemeral state. Blobs has no
time-to-live, so anything with a lifetime shorter than the document belongs somewhere else.*

---

## 6. Is a 5-second poll good enough?

This is the right question to ask before adding a vendor, and the answer has two halves that point in
opposite directions.

### 6.1 Latency: the poll is good enough for content, and not for presence

| What the reader waits for | Latency budget | 5 s poll | Live channel |
|---|---|---|---|
| A new comment appears | 5 to 10 s. It is a document review, not a chat | **Fine.** Mean 2.5 s | Better, and not needed |
| An accepted edit repaints | 5 to 10 s | **Fine** | Better, and not needed |
| An avatar appears when somebody opens the document | 5 to 15 s | **Fine on latency** | Fine |
| "the owner is editing this block" | 1 to 2 s. It must arrive before the second person starts to type | **Marginal** | **Fine** |

On latency alone, a poll almost passes. Only the editing marker is uncomfortable, and the discomfort is
mild.

### 6.2 Cost: the poll loses, and it loses by three orders of magnitude

Netlify bills Functions compute at **10 credits for each GB-hour**. The Free plan gives 300 credits each
month, Personal gives 1,000, and extra credits are $10 for 1,500. A production deploy costs 15 credits, so
credits are a scarce shared budget, not a rounding error.

Take one hour, one document, 10 concurrent readers. Assume 1 GB of function memory and 150 ms of billed
time for each poll, which matches document 04's measurement of about 200 ms for a `list()` plus 50 parallel
`get()` calls.

| Design | Netlify invocations in the hour | GB-hours | **Netlify credits** | Blobs reads in the hour |
|---|---|---|---|---|
| Poll every 5 s | 7,200 | 0.30 | **3.0** | About 7,200 `list()` plus 72,000 `get()` |
| Poll every 15 s | 2,400 | 0.10 | **1.0** | About 2,400 `list()` plus 24,000 `get()` |
| Ably channel, refresh only on an event | About 10 token mints, plus about 20 refreshes | 0.0001 | **about 0.001** | About 20 `list()` plus 200 `get()` |

**Three credits for one hour of one review session.** The Free plan's whole month is 300 credits, and
deploys already want most of it. Twenty session-hours of a 5-second poll is 60 credits, which is four
production deploys thrown away on refreshing pages that did not change.

The Blobs column is worse than the credit column. Blobs rate limits are not published, so a 5-second poll
would make a live review session the first thing on this platform to find out what they are.

### 6.3 The ruling

**The broker is cheaper, simpler and lower risk than the poll it replaces. Take the broker.**

This inverts the usual instinct, so state the reason plainly: a poll pays for every reader on every
interval whether or not anything changed, and it pays in the same currency as deploys. A broker pays only
when something happens, and it pays in somebody else's currency, on a free tier that is 300 times larger
than we need.

**Keep the poll, as the fallback, for content only.** Section 4.5 of the plan already rules on refresh:
`visibilitychange`, throttled to once each 30 seconds. That rule stays exactly as written and becomes the
no-broker path. It must be exposed as a callable function, so the realtime module can call the same
refresh on an event instead of on a timer.

**Do not poll for presence.** It is not a latency question. A poll needs a mutable ephemeral store on the
server, this platform has none that is legal to use for it, and section 4.1 shows that building one on
Blobs breaks a binding decision.

---

## 7. What "near-real-time editing" means in this design

The requirement says "similar to Google Docs". Say precisely which part of Google Docs this is, and which
part it is not.

**It is not character-level co-editing.** Section 5 of the plan rejects a conflict-free replicated data
type, and the reason is still true: "Readers propose a sentence, occasionally, on a block they clicked." An
edit in this design replaces the whole text of one block, commits to git and opens a pull request. There is
no shared buffer to merge. **Nothing in this document reopens Yjs or Automerge.**

**It is block-level notification and an advisory lock.** Three events on the channel:

| Event | Published by | What every other client does |
|---|---|---|
| `edit.claim` `{aid}` | The client, on focus of an editable block | Mark that block "the owner is editing", and hide its own edit affordance on that block |
| `edit.release` `{aid}` | The client, on blur, on save, and on `pagehide` | Clear the marker |
| `edit.saved` `{aid, hash}` | The **server**, from the edit function | Fetch `/api/pending` and repaint that one block, marked "pending review" |
| `thread.changed` `{threadId}` | The **server**, from the threads function | Refresh that thread in the panel |

**The lock is advisory, and this must stay true.** Two things make it unsafe as a correctness mechanism: a
claim can be lost with the network, and a claim expires with the heartbeat. Section 3.4 of the plan already
has the authority — the block hash, checked at the branch head, returning 409 with the current text. The
channel changes the frequency of that 409 from "often, and confusing" to "rare, and expected". It must
never replace it.

Section 1.1 of the plan states the same point from the other side: two people editing one block is a
genuine conflict, and the second writer must be told. The claim marker is how the second writer is told
*before* typing instead of after. That is the whole gain, and it is a large one for a review tool.

**Server-published events must carry only an id and a hash, never the new text.** Two reasons. A client
that receives a text payload has a second source of truth for the block, and the plan's whole anchoring
design depends on there being one. And an event that carries text can exceed Ably's 64 KiB message limit,
where an id cannot.

---

## 8. The recommended design

### 8.1 The channel and the events

**One channel for each document: `doc:<docId>`.** `<docId>` is the permanent `id` from `doc.json`, per
section 1.3 of the plan. Never the slug, never the directory name.

One channel for each document gives a hard scope: a token for one document cannot subscribe to another.
The free tier allows 200 concurrent channels, so 200 documents can be live at the same moment.

| `t` | Publisher | Persisted? |
|---|---|---|
| `beat` | Client, every 20 s while visible | No |
| `bye` | Client, on `pagehide` | No |
| `edit.claim` | Client, on focus | No |
| `edit.release` | Client, on blur, save or `pagehide` | No |
| `edit.saved` | Server, from `edit.mjs` | The edit is persisted. The event is not |
| `thread.changed` | Server, from `threads.mjs` | The thread is persisted. The event is not |

**No message on this channel is ever written to Blobs, and no message is ever written to the event log.**
The event log in section 2.4 of the plan is the audit trail. A heartbeat is not an audit fact.

### 8.2 The token function — `/api/realtime-token`

```
GET /api/realtime-token?doc=<docId>
Cache-Control: private, no-store
```

| Case | Response |
|---|---|
| `ABLY_API_KEY` is not set on the site | **204, no body.** Realtime is not configured. This is not an error |
| No session | 401, no body |
| A guest whose `docs` does not hold `<docId>` | 403, no body |
| Otherwise | 200, an Ably TokenRequest |

The function holds `ABLY_API_KEY` as a Netlify environment variable, scoped to Functions, never to Builds.
It signs a TokenRequest; it never returns the key. The token carries:

- `clientId`: the `sub` from `identify()` for a member. For a guest, a random per-session id with a `g_`
  prefix. **Ably enforces `clientId`, so a client cannot publish under an id its token does not hold.**
  This is the one trusted field in the whole presence design.
- `capability`: `{ "doc:<docId>": ["subscribe", "publish"] }`, and nothing else.
- A time-to-live of 60 minutes. The client refreshes on Ably error codes 40140 to 40149.

The endpoint reads identity through `netlify/lib/identity.mjs` and through nothing else, per section 1.2
of the plan. It is a GET, so `requireOrigin()` does not apply.

### 8.3 The client transport, and the exact guard

The module is inlined in every build, and it is dark unless three separate conditions hold. Each condition
produces silence, never an error.

```js
/* templates/base/realtime.js — inlined by {{REALTIME_JS}}. Dark by default. */
(function () {
  if (!window.EventSource) return;                       // 1. No EventSource, no realtime.
  if (!/^https?:$/.test(location.protocol)) return;      // 2. file:// stops here.

  var stream = null, tok = null;

  // 3. The only trigger. session.js dispatches this only after /api/session succeeds.
  document.addEventListener("session", function (e) {
    if (stream || !e.detail) return;
    start(e.detail);
  }, { once: true });

  async function start(session) {
    tok = await token();
    if (!tok) return;                                    // 4. 204, 401, 403 or a failed fetch: stay dark.
    attach(session);
  }

  async function token() {
    try {
      var r = await fetch("/api/realtime-token?doc=" + encodeURIComponent(DOC_ID),
                          { credentials: "same-origin" });
      if (r.status === 204 || !r.ok) return null;         // 204 = not configured on this site.
      return await r.json();
    } catch (e) { return null; }                          // Never throw out of this module.
  }

  function attach(session) {
    var q = "channels=doc:" + DOC_ID + "&v=1.2&enveloped=true"
          + "&accessToken=" + encodeURIComponent(tok.token) + "&rewind=30s";
    try { stream = new EventSource("https://realtime.ably.io/sse?" + q); }
    catch (e) { return; }                                 // Stay dark. The poll fallback remains.
    stream.onmessage = route;
    stream.onerror = degrade;                             // Close, hide the roster, keep the poll.
  }
})();
```

**Four gates, and each one alone is enough:**

| Environment | Which gate stops it | What the reader sees |
|---|---|---|
| `file://`, opened from disk | Gate 2, the protocol test | The document, unchanged. No roster, no console error |
| A published Claude artifact | Gate 3. The artifact CSP blocks the `/api/session` fetch, so `session.js` never dispatches `session`, so `start()` never runs | The document, unchanged. `connect-src` also blocks Ably, so gate 4 would catch it as well |
| A Netlify site with no `ABLY_API_KEY` | Gate 4, the 204 | The document with comments and editing, and the 30-second poll from section 4.5 of the plan |
| Ably is down, or the token expires and the refresh fails | `onerror`, then `degrade()` | One small notice, and the poll fallback |

This adds **no new mechanism.** Gate 3 is the `session` event that section 1.2 of the plan already rules is
the one way a client module learns it may act. The realtime module is one more listener on it.

### 8.4 The presence user interface

Three surfaces, and all three are decoration. None of them gates an action.

1. **An avatar strip in the masthead**, next to the theme toggle. Initials in a circle, ordered by first
   sight. It shows a count above five faces. `title` holds the label.
2. **A rail marker for each block that holds a reader**, in the same margin rail the comment markers use,
   in a lighter weight. `data-aid` is the join, so this needs P1-D and nothing else.
3. **A "the owner is editing" chip on a claimed block**, and the edit affordance on that block is hidden while
   the claim holds.

**A "hide me" toggle, stored in `localStorage`.** It stops the heartbeat and keeps the subscription. A
reader who does not want to broadcast can still see the roster. It is about five lines, and section 10 says
why it is worth them. Wrap the `localStorage` read and write in `try`/`catch`, per section 5 of the plan.

---

## 9. Degradation, mode by mode

Section 6 of the plan records this as an unanimous agreement: "The document must render from `file://` and
inside a Claude artifact with no network. Every feature is hidden by default and revealed only by a
successful probe." Presence must obey it exactly.

| Environment | Realtime | Presence | Content refresh |
|---|---|---|---|
| `file://` | None. Gate 2 | None | None. The page is a snapshot |
| A published Claude artifact | None. Gate 3 | None | None |
| **Mode A**, a standalone uploaded file with no repository | **Only if the owner sets `ABLY_API_KEY`.** Otherwise the token endpoint returns 204 and the client stays dark | Same | The 30-second poll from section 4.5 of the plan |
| **Mode B**, repository-backed | Yes | Yes | On an event, and the poll as the fallback |

**Mode A deserves a plain statement.** Mode A has Netlify Functions, because section 1.4 of the plan puts
the Mode A overlay in Blobs and section 2.5 defines it as a blob record. So nothing about Mode A prevents
realtime. What prevents it is that the owner of a standalone document is one author who may have no Ably
account and no reason to make one. **Realtime must therefore be one environment variable, opt-in for each
site, and its absence must be a 204 and not an error.** The setup tool in section 1.4 of the plan may offer
to set it. It must not require it.

**One switch, and only one.** Do not add a `doc.json` field, a build flag or a second toggle. The presence
of `ABLY_API_KEY` on the site is the whole configuration surface.

---

## 10. Security and privacy

Presence leaks two things that no other feature in this platform leaks: who is reading, and when.

**What each field is worth, and who asserts it.**

| Field | Asserted by | Trustworthy? |
|---|---|---|
| `clientId` | The token, minted by our Function from `identify()` | **Yes.** Ably rejects a publish whose `clientId` does not match the token |
| `label` | The client, in the message body | **No.** It is self-asserted |
| `act`, `aid` | The client | No, and it does not matter. Both are advisory |

**So a signed-in member can show a false name beside a real and verifiable id.** That is the honest limit
of a design with no server in the message path. It is acceptable, because presence gates nothing: the worst
outcome is a confusing avatar, and the block hash still decides every edit. **Do not let any decision
depend on `label`.** If a trusted display name is ever needed, the fix is to put it in the token, not to
trust the body.

**What an anonymous viewer must broadcast.**

- `clientId`: a random `g_<12 hex>`, minted for each session by the token function. It must not be derived
  from an email, an IP address, a share-link id or anything else stable. Two visits by the same guest must
  look like two different people.
- `label`: the literal string `"Guest"`. **Never an email. Never a name. Never a domain.**
- Nothing else. A guest has `canComment: false` and `canEdit: false` per section 1.2 of the plan, so a
  guest never publishes `edit.claim`.

**Five more rules:**

1. **The capability set is scoped to one channel.** A token for `doc:k7m2q4` grants `subscribe` and
   `publish` on `doc:k7m2q4` and nothing else. A guest's token is minted only for a `docId` in the guest's
   `docs` scope.
2. **Presence is never persisted, so it can never be subpoenaed, exported or audited.** This is a feature.
   Say it in the documentation, so nobody later adds a "who read this" report from it.
3. **`ABLY_API_KEY` never reaches the browser.** The client receives a token with a 60-minute
   time-to-live. Scope the key to Functions in the Netlify user interface, not to Builds, exactly as the
   plan rules for `DOCS_GITHUB_TOKEN`. Put its rotation in a calendar.
4. **The channel is a side channel to the gate, not a hole in it.** The Edge Function gate decides who sees
   HTML. The token function decides who may join a channel. Both read `identify()`. A reader who is not
   gated in cannot get a token.
5. **Do not put comment or edit text on the channel.** Section 7 already rules this for correctness. It is
   also a privacy rule: message history is retained for 24 hours on the free tier, in a third party's
   system.

---

## 11. What we are not building

- **A WebSocket server of our own.** Section 2.1. It is impossible on Netlify Functions, and a second host
  for one socket is a second vendor, a second deploy and a second on-call surface.
- **An SSE endpoint on Netlify.** Section 2.3. With no fan-in it is polling with extra steps.
- **A conflict-free replicated data type.** Section 5 of the plan rejects it, and section 7 above explains
  why this requirement does not reopen it.
- **A realtime SDK in the page.** Ably, Pusher, Liveblocks and Supabase all ship one, and all four break
  the self-contained file.
- **Ably's own presence feature.** The SSE endpoint cannot enter a presence set, and a derived roster is
  smaller than an SDK.
- **A cursor position, a text selection or a caret for each reader.** Google Docs shows these because it
  synchronises characters. This platform synchronises blocks. A caret would imply a precision the data model
  does not have.
- **Typing indicators inside a block.** The claim marker already says who holds the block.
- **A presence history, a "who read this" report, or a read receipt.** Section 1.1 of the plan already
  rules out a per-user index, and section 10 above rules out persisting presence.
- **A chat or a direct message on the channel.** Comments are the discussion surface. A second one splits
  the record.
- **Realtime in the artifact copy or the `file://` copy.** Section 9.

---

## 12. Tickets this implies

Five tickets. They follow the plan's `P<phase>-<letter>` convention and they continue its letters: phase 2
ends at P2-E, phase 3 at P3-E, phase 4 at P4-G.

| Ticket | Work | Files it owns | Depends on |
|---|---|---|---|
| **P2-F** | The realtime server contract. `netlify/lib/realtime.mjs`: `mintToken(session, docId)` and `publish(docId, event)`, both no-ops that return `null` when `ABLY_API_KEY` is absent. `GET /api/realtime-token`, with the 204, 401 and 403 cases in section 8.2 | `netlify/lib/realtime.mjs`, `netlify/functions/realtime-token.mjs` | P1-C (identity), P1-E (`netlify.toml` and the environment variable) |
| **P3-F** | The client transport. `templates/base/realtime.js`: the four gates in section 8.3, the SSE attach with `rewind=30s`, the token refresh on Ably error 40140 to 40149, `degrade()`, and a `doc:event` `CustomEvent` bus that every other client module listens on. **No presence and no user interface** | `templates/base/realtime.js` | P1-B (the `{{REALTIME_JS}}` placeholder), P2-C (the `session` event), P2-F |
| **P3-G** | Presence. The 20-second beat, the `bye` on `pagehide`, the roster with the 50-second expiry, the masthead avatar strip, the rail marker for each block, and the "hide me" toggle | `templates/base/presence.js`, `templates/base/presence.css` | P1-D (`data-aid`), P3-F |
| **P4-H** | The server fan-out. Add a realtime sink beside the Slack sink in `netlify/lib/notify.mjs`, so there is **one** fan-out point. `thread.changed` from the threads function and `edit.saved` from the edit function, both from `context.waitUntil`, both carrying an id and a hash only | `netlify/lib/notify.mjs` | P2-F, P3-F, P3-A, P4-B, **P4-D** (which creates the file) |
| **P4-I** | The editing soft lock. `edit.claim` on focus and `edit.release` on blur, save and `pagehide`. The "the owner is editing" chip, and hiding the edit affordance on a claimed block. **The block hash stays the authority** | `templates/base/edit.js`, `templates/base/presence.js` | P3-G, **P4-B** (which owns `edit.js`) |

**P4-H and P4-I share files with earlier tickets, so they are sequenced, not parallel.** Phase 4 of the
plan is already sequenced where files are shared, so this fits the existing rule. P4-H must land after
P4-D, which creates `notify.mjs`. P4-I must land after P4-B, which creates `edit.js`, and after P3-G, which
creates `presence.js`.

**Verify P2-F:** with no `ABLY_API_KEY`, `curl -i localhost:8888/api/realtime-token?doc=k7m2q4` returns
204 with no body. With the key set and no session, 401. With a guest session and an out-of-scope document,
403. With a member session, a TokenRequest whose `capability` names exactly one channel.

**Verify P3-F:** open the built file from `file://`; no network request is made and the console is clean.
Publish it as a Claude artifact; no network request reaches Ably and the console is clean. Deploy with no
`ABLY_API_KEY`; the page works and the poll fallback runs. Set the key; two browsers see each other inside
one second.

**Verify P3-G:** open the document in three tabs; three avatars. Close one tab; the avatar goes at once,
from the `bye`. Kill one tab's process; the avatar goes inside 50 seconds. Turn on "hide me"; the other
tabs lose that avatar and the hidden tab still sees them.

**Verify P4-H:** post a comment from browser A; browser B refreshes that thread with no poll and inside one
second. Confirm the published event body holds no comment text.

**Verify P4-I:** focus a block in browser A; browser B shows the chip and hides its own edit affordance on
that block. Force both to save the same block anyway; the second gets 409 with the current text, exactly as
section 3.4 of the plan requires.

---

## 13. What this changes in the plan

I have not edited `00-integration-plan.md`. These are the exact places that need an edit.

| # | Section of `00-integration-plan.md` | The edit |
|---|---|---|
| 1 | **Section 5, "The document and the client"**, the bullet "**Real-time updates.** No websockets, no server-sent events, no polling loop." | **This bullet is now wrong and it is the headline change.** Replace it with a narrower statement of what is still not built: no WebSocket server of our own, no SSE endpoint on Netlify, no conflict-free replicated data type, no realtime SDK in the page, no caret or selection sharing. Realtime is one hosted broker, it carries ids and never text, and presence is never persisted |
| 2 | **Section 1.1, "What this rules out"** | Add one bullet: *No ephemeral state. Blobs has no time-to-live, so anything with a lifetime shorter than the document belongs somewhere else.* |
| 3 | **Section 1.1, the six triggers** | Add one sentence after the list: *Presence does not fire trigger 4, because presence must never be written to this store. Trigger 4 is the reason for that prohibition. See `07-realtime-and-presence.md` section 4.1.* |
| 4 | **Section 1.2** | Add `/api/realtime-token` to the endpoint set. It reads `identify()`, it is a GET so `requireOrigin()` does not apply, and it sends `Cache-Control: private, no-store`, like `/api/session` |
| 5 | **Section 1.4, the Mode A row** | Add the switch: realtime and presence are opt-in for each site through the `ABLY_API_KEY` environment variable, and its absence is a 204 and not an error. The setup tool may offer to set it and must not require it |
| 6 | **Section 2, the shared data model** | Add **2.10 Realtime event** and **2.11 Presence beat**. Both must carry the line *Never persisted. Never written to Blobs. Never written to the event log.* Both carry an id and a hash, never text |
| 7 | **Section 2.4** | Add one sentence: the `kind` list does not grow. A heartbeat is not an audit fact |
| 8 | **Section 4.1, the placeholder table, and the scope of P1-B** | Add three rows: `{{REALTIME_JS}}` for `templates/base/realtime.js`, owner P3-F; `{{PRESENCE_JS}}` for `templates/base/presence.js`, owner P3-G; `{{PRESENCE_CSS}}` for `templates/base/presence.css`, owner P3-G. P1-B grows by three lines and it stays safe to land first, because `slot()` resolves a missing file to an empty string |
| 9 | **Section 4.4, the phase 2 table** | Add **P2-F** |
| 10 | **Section 4.5, the phase 3 table** | Add **P3-F** and **P3-G** |
| 11 | **Section 4.5, the "Refresh rule"** | Keep the rule and reframe it as the fallback. Add: P3-C must expose its refresh as a callable function, not an inline listener, so the realtime module can call the same refresh on an event |
| 12 | **Section 4.6, the phase 4 table** | Add **P4-H** and **P4-I**, both sequenced. Note that P4-D now creates a `notify.mjs` with two sinks |
| 13 | **Section 6, "Contradictions found"** | Add row 31: *Realtime and presence against section 5's "no real-time updates" bullet. Ruling: section 5's bullet is superseded and narrowed. Netlify cannot hold a socket and has no publish-subscribe primitive, so a hosted broker is the only path. The store decision does not change* |
| 14 | **Section 6, "Open questions that block nothing but must be checked"** | Add: does `Deno.upgradeWebSocket` work inside a Netlify Edge Function, and is there any fan-in if it does? Add: what is the exact `Authorization` encoding for an Ably REST publish with a token? Both are in section 14 below |

---

## 14. Unverified

State these honestly rather than guessing. Each one is a claim I could not confirm on 2026-09-02.

1. **Whether a Netlify Edge Function can accept an inbound WebSocket upgrade.** The Edge Functions API
   reference lists the **WebSocket API** among supported web APIs, which I read as the client-side
   `WebSocket` constructor. Netlify does not document `Deno.upgradeWebSocket` and does not document the
   `Deno` namespace. **This does not change the recommendation**, because section 2.3 shows there is no
   fan-in between isolates even if the upgrade works. Smoke-test it only if somebody wants to reopen the
   question.
2. **The exact `Authorization` header encoding for an Ably REST publish with a token.** The SSE
   documentation describes `Authorization: Bearer <base64-encoded token>` and also accepts an `accessToken`
   query parameter. I did not confirm which form the REST publish endpoint wants. Confirm in P2-F with one
   `curl`.
3. **The exact Ably SSE endpoint host.** I saw both `realtime.ably.io/sse` and
   `main.realtime.ably.net/event-stream` in Ably's documentation on the same day. Take the host from the
   Ably documentation at the time P3-F is written, not from this document.
4. **Whether Ably counts each delivery as a message, or only each publish.** Section 6.2 assumes the
   pessimistic case: one publish plus one delivery for each subscriber. If only publishes count, the free
   tier holds about ten times more than stated.
5. **Whether an Ably SSE stream counts against the 200 concurrent connection limit.** I assumed yes. At 10
   readers on a handful of documents it does not matter either way.
6. **Netlify function memory and billed duration for the credit arithmetic in section 6.2.** I assumed 1 GB
   and 150 ms. The 10 credits for each GB-hour rate came from a third-party pricing summary, not from a
   Netlify page. The ratio between the poll and the broker is about 1,000 to 1 and it does not depend on
   these numbers, but the absolute credit figures do.
7. **The Liveblocks free-tier limits.** Sources disagreed on whether the free plan has a monthly-active-user
   cap. The figure that decided the rejection — 10 simultaneous connections for each room — came from a
   third-party summary and not from a Liveblocks page. Liveblocks is rejected on the bundler constraint
   anyway, which does not depend on the price.
8. **PartyKit's current status.** Cloudflare acquired it in April 2024 and the repository moved to
   `cloudflare/partykit`. I found no 2026 statement about active maintenance or deprecation.
9. **Whether Mode A sites get a function bundle.** Section 1.4 of the plan puts the Mode A overlay in Blobs,
   which needs a function, so I concluded that Mode A has functions. If a Mode A deploy turns out to be a
   bare file upload with no functions, then Mode A has no realtime and no presence at all, and the poll
   fallback is the whole story there. Confirm when the setup tool ticket is written.
10. **Netlify Blobs rate limits.** Still not published. Document 03 lists this as unverified and it is
    unverified now. Section 6.2's Blobs read volume for the 5-second poll is a reason to avoid finding out.

---

## 15. Sources, all checked 2026-09-02

**Netlify**

- [Edge Functions limits](https://docs.netlify.com/build/edge-functions/limits/) — 50 ms CPU, 40 s response
  header timeout, 512 MB memory, 20 MB code
- [Edge Functions API reference](https://docs.netlify.com/build/edge-functions/api/) — the supported web
  API list, including the WebSocket API and the Streams API
- [Edge Functions example: long-running](https://edge-functions-examples.netlify.app/example/long-running) —
  "as long as a function returns headers within 40 seconds it can run indefinitely"
- [Edge Functions example: server-sent events](https://edge-functions-examples.netlify.app/example/server-sent-events)
  — the working `ReadableStream` SSE example
- [Background Functions overview](https://docs.netlify.com/build/functions/background-functions/) — the 15
  minute limit, and that a background function cannot stream
- [Functions API reference](https://docs.netlify.com/build/functions/api/)
- [Does Netlify support websocket programming?](https://answers.netlify.com/t/does-netlify-support-websocket-programming/4213)
  — Netlify staff, 2019: "No server side processing is supported at Netlify (outside of Functions used for
  API calls)"
- [Build Real-Time Applications with Web Sockets + Serverless](https://www.netlify.com/blog/web-sockets-in-a-serverless-world/)
  — Netlify's own answer to this problem is to put Ably in front of Functions
- [Netlify pricing](https://www.netlify.com/pricing/) — 300 credits on Free, 1,000 on Personal, 3,000 on Pro
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — the `set` options, which
  hold no expiry

**Ably**

- [Ably limits](https://ably.com/docs/platform/pricing/limits) — Free: 6,000,000 messages each month, 200
  concurrent connections, 200 concurrent channels, 200 presence members for each channel, 500 messages each
  second, 64 KiB each message, 24 hour history, 2 minute connection-state recovery
- [Ably SSE and HTTP streaming](https://ably.com/docs/protocols/sse) — the endpoint, `channels`, `v`,
  `accessToken`, `enveloped`, `lastEvent` and `rewind`; subscribe-only; cannot enter or read presence; the
  token-expiry error codes 40140 to 40149
- [Ably pricing FAQs](https://ably.com/docs/platform/pricing/faqs)
- [Ably JavaScript SDK setup](https://ably.com/docs/getting-started/javascript) —
  `https://cdn.ably.com/lib/ably.min-2.js`, the script tag this design deliberately does not use

**Pusher**

- [Pusher Channels pricing](https://pusher.com/channels/pricing/) — the Sandbox plan: 100 concurrent
  connections and 200,000 messages each day

**Liveblocks**

- [Liveblocks plans](https://liveblocks.io/docs/pricing/plans)
- [Liveblocks troubleshooting](https://liveblocks.io/docs/api-reference/troubleshooting) — the no-bundler
  path is a Skypack ESM import plus a manual `globalThis.process` shim

**Supabase**

- [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) — Free: 200 peak concurrent
  realtime connections, 2,000,000 realtime messages each month, 256 KB each message

**Cloudflare**

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — available
  on the Workers Free plan with the SQLite backend only; 100,000 requests each day; 13,000 GB-s each day;
  5,000,000 SQLite reads and 100,000 writes each day; 5 GB stored; a 20:1 ratio on incoming WebSocket
  messages; the Hibernation API
- [PartyKit is joining Cloudflare](https://blog.partykit.io/posts/partykit-is-joining-cloudflare/) — April
  2024
- [cloudflare/partykit](https://github.com/cloudflare/partykit)

**In this repository**

- `templates/research/00-integration-plan.md`, sections 1.1, 1.2, 1.3, 1.4, 2.4, 3.4, 4.1, 4.5, 4.6, 5, 6
- `templates/research/03-state-storage.md`, sections 2.2, 2.4, 2.5 and 10
- `templates/research/04-comments-and-discussion.md`, section 8.1, the degradation guard this design reuses
- `templates/README.md`, on why the document is one self-contained file
