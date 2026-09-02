# Persisted state: Netlify Blobs versus Netlify DB

**Area:** persisted state for comments, threads, inline edits and history.
**Decision:** use **Netlify Blobs**, one JSON blob per document, with compare-and-swap writes.
**Documentation checked:** 1 September 2026. Every Netlify limit and API signature below comes from
`docs.netlify.com` on that date. Every version number comes from the npm registry on that date.

**Written when the builder was Python. Converted to Rust on 2 September 2026.** Every command, module
name and code block below is now the Rust one. Where this document and `00-integration-plan.md`
disagree, the plan is correct.

Every other feature in this set depends on this choice. Read the recommendation, then the code.

---

## 1. Summary of the recommendation

Store all comment and thread state for one document in **one blob**, keyed by the document id.

```
store "doc-state"
  threads/<docId>                       one blob: every thread and comment for that document
  edits/<docId>                         one blob: every accepted inline edit for that document
  history/<docId>/<ms>_<rand>__<kind>__<actor>    one blob per change, append only
```

Writes use `onlyIfMatch` with the blob's ETag. This is optimistic concurrency control. When two
people comment at the same moment, the second write is **rejected, not merged and not lost**. The
function re-reads and re-applies. The reader sees both comments.

Do not use Netlify DB for this workload yet. The reasons are in section 6, and the trigger to
change the decision is in section 7.

---

## 2. Netlify Blobs

### 2.1 What it is

A key-value store built into Netlify. It needs no provisioning. It is available on all plans.

**Package:** `@netlify/blobs`
**Version to pin:** `11.0.2`, published 28 August 2026. Checked 1 September 2026.
**Caution:** version 11 declares `engines: { node: ">=22.12.0" }`. Version `10.7.13` still supports
Node 14 and 16. Netlify's default function runtime is Node 24 since July 2026, so version 11 is
safe. Pin `10.7.13` only if you force an older runtime.

### 2.2 API, as documented

```js
getStore(name, { siteID, token, consistency })
getDeployStore(name, { deployID, region, siteID, token })

store.set(key, value, { metadata, onlyIfMatch, onlyIfNew })      // -> { modified, etag }
store.setJSON(key, value, { metadata, onlyIfMatch, onlyIfNew })  // -> { modified, etag }
store.get(key, { consistency, type })                            // -> value | null
store.getWithMetadata(key, { consistency, etag, type })          // -> { data, etag, metadata } | null
store.getMetadata(key, { consistency, etag })                    // -> { metadata, etag } | null
store.list({ prefix, directories, paginate })                    // -> { blobs: [{key, etag}], directories }
store.delete(key)
store.deleteAll()                                                // -> { deletedBlobs }
```

`type` accepts `"text"`, `"json"`, `"arrayBuffer"`, `"blob"`, `"stream"`.

### 2.3 Consistency

Two models. The default is **eventual**: data lives in one region and caches at the edge. A new blob
is globally readable immediately. **Updates and deletions propagate within 60 seconds.**

The alternative is **strong**: immediately consistent everywhere, at the cost of slower reads.

**Use strong consistency for this workload.** A person must see their own comment the moment they
post it. A 60-second window where a comment appears, disappears and reappears is a bug report. Set
it once, at the store:

```js
const store = getStore({ name: "doc-state", consistency: "strong" });
```

The read is slower. At tens of readers this does not matter.

### 2.4 Concurrency

Netlify documents the plain behaviour clearly:

> Last write wins. If two overlapping calls try to write the same object, the last write wins.
> Netlify Blobs does not include a concurrency control mechanism.

That default loses data. Two people comment, both read the same blob, both write, one comment
vanishes. **Never write this store without a guard.**

The guards are conditional writes:

- `onlyIfNew: true` — the write succeeds only if the key does not exist.
- `onlyIfMatch: etag` — the write succeeds only if the entry exists and its ETag matches.

`set` returns `{ modified, etag }`. `modified` is `false` when the guard rejected the write. `etag`
is present only when a new entry was generated.

This is a compare-and-swap. It is enough to make the store correct. Section 5.2 has the loop.

**A strongly consistent read is not required before a conditional write.** The write itself fails on
an ETag mismatch. Reading strongly is still worth it here, because it makes the retry rarer.

### 2.5 What you can query

Blobs supports exactly one query: **prefix scan in key order**.

```js
for await (const page of store.list({ prefix: "history/example/", paginate: true })) { ... }
```

Pages hold up to 1,000 entries. `list()` returns **only `key` and `etag`**. It does not return the
blob body. It does not return the metadata. Rendering 200 history entries from a bare list costs 200
further GET calls.

The fix is to put the summary **in the key**. See section 5.4. It costs nothing and cannot drift out
of sync, because there is no second copy.

You cannot do any of the following:

- filter by a field inside the JSON
- sort by anything but the key
- join two blobs
- count without reading
- search the text of comments
- write two blobs in one transaction

### 2.6 Limits

| Constraint | Limit |
|---|---|
| Store name | 64 bytes, no `/` and no `:` |
| Object key | 600 bytes, no leading `/`, not empty |
| Single blob | 5 GB |
| Metadata per blob | 2 KB |
| `list()` page | 1,000 entries |
| Update propagation, eventual mode | 60 seconds |

Netlify does not publish a per-account Blobs storage quota, a per-GB storage rate, or a rate limit.
**State this as unverified.** The credit-rate table has no Blobs line item at all.

### 2.7 What Blobs actually costs

Blobs has no storage meter of its own. The cost lands on the function that touches it:

| Resource | Credits |
|---|---|
| Web requests | 2 per 10,000 |
| Functions compute | 10 per GB-hour |
| Web bandwidth | 20 per GB |
| Production deployment | **15 each** |

Free plan: **300 credits per month, a hard cap.** No auto-recharge. When the credits run out, the
sites pause until the next cycle.

**The binding cost is deploys, not state.** 15 credits per production deploy means 20 deploys
exhausts the entire free allowance. A documentation repository deploys on every edit. Tens of
readers leaving comments all day will not come close to the cost of the writers pushing commits.
Plan the plan around deploy count. Do not plan it around comment volume.

---

## 3. Netlify DB

### 3.1 What it is, and who runs it

Managed Postgres inside Netlify. The docs never name the provider. The package does: `@netlify/database@2.0.0`
depends on `@neondatabase/serverless@^1.1.0`. **The underlying provider is Neon.** Neon's own
announcement post confirms it. Checked 1 September 2026.

**Packages and versions**, checked 1 September 2026:

- `@netlify/database` — `2.0.0`, published 18 August 2026. This is the current client.
- `@netlify/neon` — `0.1.2`, published 19 January 2026. Older, thinner, a wrapper over the Neon driver.
- `@neondatabase/serverless` — `1.1.0`, published 17 April 2026.

Use `@netlify/database` if you go this route. `@netlify/neon` looks like the earlier attempt.

### 3.2 Setting it up

```bash
netlify database init     # provision
netlify dev               # runs a real local Postgres
npm install @netlify/database
```

Migrations live in `netlify/database/migrations/`, named `<number>_<slug>`, as `.sql` files or as a
subdirectory holding `migration.sql`:

```
netlify/database/migrations/
├── 20260901120000_create_thread.sql
└── 20260901120100_create_comment.sql
```

They sort lexicographically and **run automatically at deploy**. On a production deploy they apply
immediately before publish, and **a failed migration blocks the publish**.

Read that sentence again. On a documentation site, a bad SQL file takes the documents offline. That
is a real operational risk for a tool whose whole job is to be readable.

Client usage:

```js
import { getDatabase } from "@netlify/database";
const db = getDatabase();
const users = await db.sql`SELECT * FROM users WHERE id = ${userId}`;
```

Transactions go through a pool:

```js
const client = await db.pool.connect();
try {
  await client.query("BEGIN");
  await client.query("INSERT INTO comment (thread_id, author, body) VALUES ($1,$2,$3)", [t, a, b]);
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
}
```

### 3.3 The schema that fits

This is the honest relational answer. It is not a straw man.

```sql
-- 20260901120000_create_state.sql

create table thread (
  id           bigserial primary key,
  doc_id       text        not null,
  section      text        not null,
  quote        text,                       -- anchor text, for re-finding the span
  offset_hint  integer,
  resolved     boolean     not null default false,
  created_by   text        not null,
  created_at   timestamptz not null default now()
);
create index thread_doc_idx on thread (doc_id, resolved, created_at desc);

create table comment (
  id         bigserial primary key,
  thread_id  bigint      not null references thread(id) on delete cascade,
  author     text        not null,
  body       text        not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index comment_thread_idx on comment (thread_id, created_at);

create table block_edit (
  doc_id     text        not null,
  block_id   text        not null,
  body       text        not null,
  updated_by text        not null,
  updated_at timestamptz not null default now(),
  primary key (doc_id, block_id)
);

create table revision (
  id         bigserial primary key,
  doc_id     text        not null,
  kind       text        not null,          -- 'comment' | 'resolve' | 'edit'
  actor      text        not null,
  payload    jsonb       not null,
  created_at timestamptz not null default now()
);
create index revision_doc_idx on revision (doc_id, created_at desc);
```

### 3.4 Concurrency, and where Postgres genuinely wins

Two people comment at the same moment. Both functions run `INSERT INTO comment`. **Both succeed.
There is no conflict, no retry and no extra round trip.** Postgres serialises the writes itself, and
`bigserial` hands out distinct ids.

This is the strongest argument against the recommendation in this document. State it plainly rather
than hiding it. The rebuttal is in section 6.3.

Postgres also gives you real transactions across tables, so writing a comment and its history row is
one atomic act. Blobs cannot do that.

### 3.5 What you can query

Everything. `WHERE`, `ORDER BY`, `JOIN`, `COUNT`, aggregates, full-text search with `tsvector`,
"every unresolved thread across every document that mentions me", pagination by keyset. This is the
other real advantage and it is the one that eventually forces the migration.

### 3.6 Limits and cost

Free plan, from the Netlify billing docs:

| Limit | Free | Personal | Pro |
|---|---|---|---|
| Databases per account | 3 | 5 | 50 |
| Max compute units per database | 1 | 4 | 16 |
| Total compute units per billing period | **48** | no limit | no limit |
| Database bandwidth per period | **5 GB** | 100 GB | 100 GB |
| Storage size | **5 GB** | 100 GB | 100 GB |
| Minimum sleep-on-inactivity | **5 minutes** | 5 minutes | always on available |

Credit rates: database compute 10 credits per GB-hour, database bandwidth 20 credits per GB.

**Storage:** the docs say "Database storage space is free until July 1, 2026", and that rates would
be "announced in advance". **That date has passed.** The documentation page still carries the old
sentence on 1 September 2026. I could not find the announced rate. **Treat database storage cost as
unknown and confirm it before committing.** This is a genuine gap, not a conservative hedge.

Two limits matter more than the numbers:

1. **Sleep on inactivity is 5 minutes minimum on Free and Personal.** An internal document read by
   tens of people is idle nearly all day. Almost every first comment load pays a wake-from-idle
   delay. Netlify publishes no number for that delay, so do not quote one — but the cost is real and
   it lands on the very first interaction a reader has.
2. **48 compute units per billing period on Free.** The database stays awake for at least 5 minutes
   after each request. A client that polls for new comments every 15 seconds keeps the database
   awake permanently and burns the period's allowance in about two days. If you use Netlify DB, **do
   not poll it.**

Compliance: database services are not PCI-DSS certified and not HIPAA-eligible by default. Blobs is
also documented as not HIPAA-compliant yet. Neither matters for internal architecture documents.

---

## 4. The comparison, on the axes that decide it

| | Netlify Blobs | Netlify DB (Neon) |
|---|---|---|
| Provisioning | none | `netlify database init` |
| Schema changes | edit the JSON shape, bump `v` | a migration file, applied at deploy |
| Failed change | one bad blob | **a failed migration blocks the deploy** |
| Two simultaneous comments | second write rejected, retried, both land | both insert, no conflict |
| Idle cost | none | wakes from sleep after 5 min |
| Cross-document query | read every blob | one `SELECT` |
| Full-text search | none | `tsvector` |
| Transactions | none | yes |
| Local development | works with the CLI | works, real local Postgres |
| Read of one document | 1 GET | 1 connect + 2 queries |
| Free-plan ceiling | no published storage quota | 5 GB, 48 CU, 5 GB bandwidth |
| Lines of code to working | roughly 120 | roughly 300, plus migrations |

---

## 5. The recommended implementation

### 5.1 Key layout and document shape

One store, `doc-state`, site-wide, strong consistency.

```
threads/<docId>          all threads and comments for one document
edits/<docId>            all accepted inline edits for one document
history/<docId>/<ms>_<rand>__<kind>__<actor>     one blob per change, never rewritten
```

`threads/<docId>`:

```json
{
  "v": 1,
  "docId": "example",
  "seq": 42,
  "updatedAt": "2026-09-01T12:04:11.201Z",
  "threads": [
    {
      "id": "t7",
      "anchor": { "section": "architecture", "quote": "where the guarantees stop", "offset": 1180 },
      "resolved": false,
      "createdAt": "2026-09-01T11:58:02.004Z",
      "comments": [
        {
          "id": "c11",
          "author": "owner@example.com",
          "name": "the owner",
          "body": "This is the part that needs a number.",
          "createdAt": "2026-09-01T11:58:02.004Z",
          "editedAt": null
        }
      ]
    }
  ]
}
```

`seq` is a monotonic counter. Ids are minted from it **inside** the compare-and-swap. The CAS is what
makes them unique. No UUID library is needed.

`edits/<docId>`:

```json
{
  "v": 1,
  "docId": "example",
  "seq": 8,
  "updatedAt": "2026-09-01T12:04:11.201Z",
  "blocks": {
    "architecture:p3": { "body": "Revised sentence.", "by": "owner@example.com", "at": "2026-09-01T12:04:11.201Z" }
  }
}
```

### 5.2 The store helper — `netlify/lib/store.mjs`

This is the whole concurrency story. Copy it as it is.

```js
// netlify/lib/store.mjs
import { getStore } from "@netlify/blobs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One site-wide store. Strong consistency, because a person must see their
// own comment the moment they post it. Reads are slower. At tens of readers
// that does not matter.
export const docState = () =>
  getStore({ name: "doc-state", consistency: "strong" });

export const emptyThreads = (docId) => ({
  v: 1, docId, seq: 0, updatedAt: null, threads: [],
});

export const emptyEdits = (docId) => ({
  v: 1, docId, seq: 0, updatedAt: null, blocks: {},
});

/**
 * Read, modify and write one blob under optimistic concurrency control.
 *
 * `apply` receives the current value and returns the next value, or null to
 * make no change. If another writer commits between our read and our write,
 * the conditional write is rejected, and `apply` runs again on the value that
 * writer left behind. Nothing is lost and nothing is merged blindly.
 *
 * Returns { value, etag, changed }.
 */
export async function mutate(store, key, initial, apply, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    const found = await store.getWithMetadata(key, {
      type: "json",
      consistency: "strong",
    });

    const current = found ? found.data : initial;
    const next = apply(structuredClone(current));
    if (next === null) {
      return { value: current, etag: found ? found.etag : null, changed: false };
    }

    next.updatedAt = new Date().toISOString();

    // The guard. Without it, Netlify Blobs is last-write-wins and a
    // simultaneous comment is silently destroyed.
    const guard = found ? { onlyIfMatch: found.etag } : { onlyIfNew: true };
    const { modified, etag } = await store.setJSON(key, next, guard);
    if (modified) return { value: next, etag, changed: true };

    // Someone committed first. Back off, then retry on their value.
    await sleep(20 * 2 ** i + Math.random() * 40);
  }
  throw new Error(`too many concurrent writes to ${key}`);
}

/** Read one blob with its ETag, for a client that wants to send If-Match. */
export async function read(store, key, initial) {
  const found = await store.getWithMetadata(key, {
    type: "json",
    consistency: "strong",
  });
  return found
    ? { value: found.data, etag: found.etag }
    : { value: initial, etag: null };
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._@-]/g, "-").slice(0, 64);

/**
 * History keys carry their own summary. `list()` returns keys only, never
 * bodies and never metadata, so a key that describes itself renders a
 * timeline with zero extra reads. Digits-only time keeps the lexicographic
 * order correct and avoids any question about ':' in a key.
 */
export function historyKey(docId, kind, actor) {
  const ms = String(Date.now()).padStart(13, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `history/${safe(docId)}/${ms}_${rand}__${safe(kind)}__${safe(actor)}`;
}

export function parseHistoryKey(key) {
  const tail = key.split("/").pop();
  const [stamp, kind, actor] = tail.split("__");
  return {
    key,
    at: new Date(Number(stamp.split("_")[0])).toISOString(),
    kind,
    actor,
  };
}
```

### 5.3 The threads function — `netlify/functions/threads.mjs`

```js
// netlify/functions/threads.mjs
import { docState, emptyThreads, mutate, read, historyKey } from "../lib/store.mjs";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

// DEPENDENCY: the auth area owns this. Until it lands, this returns null and
// the function rejects every write. It must never trust a client-sent name.
function identityOf(req, context) {
  // Replace with the verified identity from the auth design.
  const user = context.clientContext?.user;
  if (!user) return null;
  return { id: user.email, name: user.user_metadata?.full_name || user.email };
}

export default async (req, context) => {
  const { docId } = context.params;
  const store = docState();
  const key = `threads/${docId}`;

  if (req.method === "GET") {
    const { value, etag } = await read(store, key, emptyThreads(docId));
    return json(value, 200, etag ? { etag } : {});
  }

  const me = identityOf(req, context);
  if (!me) return json({ error: "not signed in" }, 401);

  const input = await req.json();

  // Post a comment. Either opens a thread, or replies to one.
  if (req.method === "POST") {
    const body = String(input.body || "").trim();
    if (!body) return json({ error: "empty comment" }, 400);
    if (body.length > 8000) return json({ error: "comment too long" }, 400);

    let created = null;

    const { value } = await mutate(store, key, emptyThreads(docId), (doc) => {
      doc.seq += 1;
      const now = new Date().toISOString();
      const comment = {
        id: `c${doc.seq}`,
        author: me.id,
        name: me.name,
        body,
        createdAt: now,
        editedAt: null,
      };

      if (input.threadId) {
        const thread = doc.threads.find((t) => t.id === input.threadId);
        if (!thread) throw new Error("no such thread");
        thread.comments.push(comment);
      } else {
        doc.seq += 1;
        doc.threads.push({
          id: `t${doc.seq}`,
          anchor: {
            section: String(input.section || ""),
            quote: String(input.quote || "").slice(0, 400),
            offset: Number(input.offset) || 0,
          },
          resolved: false,
          createdAt: now,
          comments: [comment],
        });
      }

      created = comment;
      return doc;
    });

    // History is append only, so it is never contended and needs no guard.
    // It is a separate write. Blobs has no transactions, so a crash between
    // the two writes loses the history row, not the comment. That is the
    // right way round.
    await store.setJSON(historyKey(docId, "comment", me.id), {
      kind: "comment",
      actor: me.id,
      at: created.createdAt,
      threadId: input.threadId || null,
      body,
    });

    return json({ ok: true, comment: created, doc: value }, 201);
  }

  // Resolve or reopen a thread.
  if (req.method === "PATCH") {
    const { value } = await mutate(store, key, emptyThreads(docId), (doc) => {
      const thread = doc.threads.find((t) => t.id === input.threadId);
      if (!thread) throw new Error("no such thread");
      if (thread.resolved === Boolean(input.resolved)) return null; // no change
      thread.resolved = Boolean(input.resolved);
      return doc;
    });

    await store.setJSON(historyKey(docId, input.resolved ? "resolve" : "reopen", me.id), {
      kind: input.resolved ? "resolve" : "reopen",
      actor: me.id,
      at: new Date().toISOString(),
      threadId: input.threadId,
    });

    return json({ ok: true, doc: value });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = {
  path: "/api/threads/:docId",
  method: ["GET", "POST", "PATCH"],
};
```

### 5.4 The history function — `netlify/functions/history.mjs`

This is where the self-describing key pays for itself. The timeline renders from `list()` alone.

```js
// netlify/functions/history.mjs
import { docState, parseHistoryKey } from "../lib/store.mjs";

export default async (req, context) => {
  const { docId } = context.params;
  const store = docState();
  const entries = [];

  // list() returns { key, etag } only. Never the body, never the metadata.
  // The summary lives in the key, so this costs one call, not one per entry.
  for await (const page of store.list({
    prefix: `history/${docId}/`,
    paginate: true,
  })) {
    for (const blob of page.blobs) entries.push(parseHistoryKey(blob.key));
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : -1)); // newest first

  return new Response(JSON.stringify({ docId, entries: entries.slice(0, 200) }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { path: "/api/history/:docId", method: "GET" };
```

Fetch a body only when a reader expands one entry. Add a second route for that, or let the client
call `/api/history/:docId?key=...`.

### 5.5 The inline-edit function — `netlify/functions/edits.mjs`

The client holds the ETag from its last read and sends it back. This stops a reader from silently
overwriting an edit made while their tab was open.

```js
// netlify/functions/edits.mjs
import { docState, emptyEdits, mutate, read, historyKey } from "../lib/store.mjs";

export default async (req, context) => {
  const { docId } = context.params;
  const store = docState();
  const key = `edits/${docId}`;

  if (req.method === "GET") {
    const { value, etag } = await read(store, key, emptyEdits(docId));
    return new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", ...(etag ? { etag } : {}) },
    });
  }

  const me = identityOf(req, context);            // same stub as threads.mjs
  if (!me) return new Response("{}", { status: 401 });

  const input = await req.json();
  const blockId = String(input.blockId || "");
  const body = String(input.body || "");
  if (!blockId) return new Response("{}", { status: 400 });

  let before = null;

  const { value } = await mutate(store, key, emptyEdits(docId), (doc) => {
    const held = doc.blocks[blockId];

    // The reader edited a version that has since changed. Refuse, and let the
    // UI show both. Do not merge text automatically.
    if (input.ifAt && held && held.at !== input.ifAt) throw new Error("stale");

    before = held ? held.body : null;
    if (held && held.body === body) return null;

    doc.seq += 1;
    doc.blocks[blockId] = { body, by: me.id, at: new Date().toISOString() };
    return doc;
  });

  await store.setJSON(historyKey(docId, "edit", me.id), {
    kind: "edit",
    actor: me.id,
    at: new Date().toISOString(),
    blockId,
    before,
    after: body,
  });

  return new Response(JSON.stringify({ ok: true, doc: value }), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { path: "/api/edits/:docId", method: ["GET", "POST"] };
```

### 5.6 The client, and how it degrades

The page must render correctly from disk with no network. It must also render correctly as a Claude
artifact, where the CSP blocks `fetch` to every host. **One piece of code covers both cases.** The
client feature-detects. It never announces failure.

```js
// templates/base/state.js  -- inlined by the builder, like app.js
(function () {
  var host = document.querySelector(".masthead");
  var docId = host && host.dataset.docId;

  // file:// -> no network. The document stays static and reads correctly.
  var served = location.protocol === "http:" || location.protocol === "https:";
  if (!docId || !served) return;

  var state = { threads: [], etag: null, on: false };

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, opts))
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        state.etag = r.headers.get("etag");
        return r.json();
      });
  }

  // The one probe. It fails on a plain static host, and it fails under the
  // artifact CSP. Both failures are silent, and the document stays static.
  api("/api/threads/" + docId)
    .then(function (doc) {
      state.threads = doc.threads;
      state.on = true;
      document.documentElement.classList.add("has-state");   // CSS reveals the UI
      render();
      poll();
    })
    .catch(function () { /* stay static. This is a supported mode. */ });

  function poll() {
    setInterval(function () {
      if (document.hidden) return;                 // do not poll a background tab
      api("/api/threads/" + docId)
        .then(function (doc) { state.threads = doc.threads; render(); })
        .catch(function () {});
    }, 15000);
  }

  function post(body, threadId, anchor) {
    return api("/api/threads/" + docId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ body: body, threadId: threadId }, anchor)),
    }).then(function (r) { state.threads = r.doc.threads; render(); });
  }

  function render() { /* owned by the commenting-UI area */ }
})();
```

The rule that makes this work: **every comment control is hidden by default and revealed only by
`.has-state`.** From disk, the class is never added, so the reader sees a clean document with no
dead buttons.

```css
.comment-ui { display: none; }
.has-state .comment-ui { display: block; }
```

### 5.7 The three lines of build change

The authoring path does not change. A writer still edits an HTML fragment and runs one build
command.

In `templates/base/layout.html`:

```html
<header class="masthead" data-doc-id="{{DOC_ID}}">
```

and next to the existing `{{APP_JS}}`:

```html
{{STATE_JS}}
```

In `templates/docbuild/src/main.rs`, inside the `subs` list that `build()` already builds:

```rust
("{{DOC_ID}}", doc.get_or("id", instance)),
("{{STATE_JS}}", read(&base.join("state.js"))?),
```

That is the entire change. The builder keeps its zero dependencies and still compiles with plain
`rustc`.

### 5.8 The one dependency file

The repository has no `package.json` today. The functions need one. Netlify installs it during the
build.

```json
{
  "name": "architecture-docs-functions",
  "private": true,
  "type": "module",
  "dependencies": {
    "@netlify/blobs": "11.0.2"
  }
}
```

**This does not break the zero-dependency rule.** That rule protects the authoring path. A writer
never runs `npm`. Only Netlify does, only at deploy, and only for the server side.

```toml
# netlify.toml
[build]
  publish = "."
  command = "templates/build example"

[functions]
  directory = "netlify/functions"
```

---

## 6. The defence of the recommendation

### 6.1 The workload is genuinely small and append-mostly

Comment threads on one document are: a few hundred rows at most, appended far more often than
edited, and **always read together**. Nobody asks for "the third comment on thread 7" alone. They
open the document and want every thread at once.

A relational schema splits that natural unit across two tables and rejoins it on every read. The
blob stores the unit as the unit. One GET returns the exact object the page renders. That is not a
shortcut. It matches the access pattern.

### 6.2 Operationally, there is nothing to run

No provisioning. No migration files. No migration that can block a deploy. No connection pool. No
idle sleep and no wake-up delay. No compute-unit budget to watch. No second thing that can be down
while the documents are up.

The brief asks for low operational burden. Blobs has close to none.

### 6.3 The concurrency objection, answered

Postgres handles two simultaneous comments with no retry. Blobs needs a compare-and-swap loop. That
is a real advantage for Postgres and section 3.4 states it without hedging.

Here is why it does not decide the question.

The CAS loop is **twenty lines, written once, in one file**. It is not spread through the codebase.
It is correct: a rejected write re-reads and re-applies, so no comment is lost and no state is merged
blindly.

The collision needs two writes to the same document inside one round trip, roughly 50 to 150
milliseconds. With tens of readers, on a document that receives a handful of comments an hour, that
is rare enough to be uninteresting. When it does happen, the cost is one extra round trip and the
reader notices nothing.

Six attempts with exponential back-off covers far more contention than this workload will ever
produce.

### 6.4 The failure modes are smaller

A bad blob write damages one document's comments. A bad migration blocks the deploy and takes every
document offline. For a documentation tool, the blast radius argument points one way only.

---

## 7. Where this reasoning stops being true

Be specific, so the next person recognises the moment. **Any one of these is enough to migrate.**

1. **A query is no longer scoped to one document.**
   This is the real signal, and it usually arrives first. "Every unresolved thread assigned to me,
   across every document" costs one `SELECT` in Postgres. In Blobs it costs one GET per document.
   Fine at 30 documents. Wrong at 300. A notification digest or an inbox view triggers this.

2. **Someone asks to search comment text.**
   Blobs has no index and cannot get one. Postgres has `tsvector`. There is no clever fix.

3. **One document's threads blob passes roughly 1 MB.**
   Every write rewrites the whole blob. At about 500 bytes a comment, 1 MB is roughly 2,000
   comments. Below that the rewrite is noise. Above it, you burn bandwidth credits rewriting old
   comments to append a new one. Add a size assertion and let it fail loudly.

4. **Sustained writes exceed roughly one per second on one document.**
   CAS retry cost grows with the square of the number of concurrent writers on one key. A live
   review where forty people comment on one paragraph at once will thrash the loop. Scheduled
   asynchronous reading will not.

5. **A change must span two documents atomically.**
   Blobs has no transaction. Moving a thread between documents, or a cascading delete, cannot be
   made atomic. Postgres can.

6. **You need per-user state that is not per-document.**
   Read receipts, subscriptions, an unread count. These are indexed by user, not by document. They
   fit the relational model and fight the blob model.

Until one of those is true, the blob is the simpler correct answer.

---

## 8. Migration, in both directions

### 8.1 Blobs to Postgres

The migration is easy **because the blob is already the aggregate**. One blob becomes one document's
rows. There is no reshaping and no ambiguity.

Run it once, as a Netlify function or as a local script with `NETLIFY_BLOBS_CONTEXT` set.

```js
// scripts/blobs-to-postgres.mjs
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";

const store = getStore({ name: "doc-state", consistency: "strong" });
const db = getDatabase();

const docIds = [];
for await (const page of store.list({ prefix: "threads/", paginate: true })) {
  for (const b of page.blobs) docIds.push(b.key.slice("threads/".length));
}

for (const docId of docIds) {
  const doc = await store.get(`threads/${docId}`, { type: "json", consistency: "strong" });
  if (!doc) continue;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const t of doc.threads) {
      const { rows } = await client.query(
        `insert into thread (doc_id, section, quote, offset_hint, resolved, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [docId, t.anchor.section, t.anchor.quote, t.anchor.offset, t.resolved,
         t.comments[0].author, t.createdAt]
      );
      const threadId = rows[0].id;
      for (const c of t.comments) {
        await client.query(
          `insert into comment (thread_id, author, body, created_at, edited_at)
           values ($1,$2,$3,$4,$5)`,
          [threadId, c.author, c.body, c.createdAt, c.editedAt]
        );
      }
    }
    await client.query("COMMIT");
    console.log(`migrated ${docId}: ${doc.threads.length} threads`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

The cutover:

1. Deploy the Postgres schema as a migration. Write nothing to it yet.
2. Run the script. Blobs stays the store of record.
3. Deploy functions that **write to both** and still read from Blobs. Run for a few days.
4. Flip reads to Postgres. Keep the dual write.
5. Re-run the script for anything written during the window. Compare counts.
6. Drop the Blobs write. **Do not delete the blobs.** They are a free, complete backup.

Step 6 is the point of the whole design. The old store costs nothing to keep.

### 8.2 Postgres back to Blobs

Also easy, and worth knowing, because it means the choice is not a trap in either direction.

```sql
select
  t.doc_id,
  jsonb_build_object(
    'v', 1,
    'docId', t.doc_id,
    'threads', jsonb_agg(
      jsonb_build_object(
        'id', 't' || t.id,
        'anchor', jsonb_build_object('section', t.section, 'quote', t.quote, 'offset', t.offset_hint),
        'resolved', t.resolved,
        'createdAt', t.created_at,
        'comments', (
          select jsonb_agg(jsonb_build_object(
            'id', 'c' || c.id, 'author', c.author, 'body', c.body,
            'createdAt', c.created_at, 'editedAt', c.edited_at
          ) order by c.created_at)
          from comment c where c.thread_id = t.id
        )
      ) order by t.created_at
    )
  ) as doc
from thread t
group by t.doc_id;
```

Write each row to `threads/<doc_id>`. Then set `seq` above the highest numeric id you emitted, or new
ids will collide with old ones.

### 8.3 Versioning, so this stays cheap

Every blob carries `"v": 1`. Read through one function:

```js
function upgrade(doc) {
  if (doc.v === 1) return doc;
  throw new Error(`unknown state version ${doc.v}`);
}
```

A shape change becomes a new branch there, applied lazily on read and persisted on the next write.
No migration step, no downtime, and no deploy that can be blocked by SQL.

---

## 9. What I would not do, and why

**I would not use Netlify DB for this today.**
Not because Postgres is wrong, but because the free plan's 5-minute idle sleep puts a wake-up delay
on the first interaction of nearly every reading session, the 48 compute-unit period budget punishes
exactly the polling this UI wants, and automatic migrations at deploy mean a bad SQL file can take
the documents offline. Revisit when section 7 fires.

**I would not use a blob per comment or per thread.**
`threads/<doc>/<thread>/<comment>` removes the CAS conflict entirely. It also makes rendering a
document cost one `list()` plus N GETs, and makes it impossible to read a thread as one consistent
object. The write-side gain is not worth the read-side loss at this size.

**I would not use eventual consistency.**
It is the default and it is cheaper. It also gives a 60-second window where a person's own comment
can appear, vanish and return. That reads as data loss. Pay for strong.

**I would not add an ORM.**
Drizzle is offered in the Netlify DB docs and it is good. It also adds `node_modules`, a build step
and a type-generation step to a repository whose whole appeal is one dependency-free binary. If Postgres arrives
later, `db.sql` tagged templates are enough.

**I would not keep comments in Git.**
It is a tempting fit for a repository of documents. It fails on three counts: every comment needs a
push and a deploy at 15 credits each, inline anchors do not survive a rebase, and two readers
commenting at once produce a merge conflict that neither can resolve from a browser.

**I would not use a CRDT for the inline editing.**
Yjs or Automerge solve concurrent character-level editing. This is not that. Readers suggest a
sentence, occasionally, on a block they clicked. Per-block last-writer-wins with a staleness check —
`ifAt` in section 5.5 — is enough, and it fits in one file.

**I would not reach outside Netlify.**
Supabase, Firebase, Upstash and PlanetScale all do this job. Every one adds a second vendor, a second
set of credentials and a second thing that can be down. Netlify Blobs needs none of that and is
provisioned already.

**I would not use `localStorage` as the store of record.**
It is right for one thing: the reader's draft comment, so a refresh does not lose typing. It is wrong
for anything another person must see.

---

## 10. Unverified, and worth confirming before building

State these honestly rather than guessing.

1. **Netlify DB storage pricing after 1 July 2026.** The docs still say storage is free until that
   date. That date has passed. The announced rate was not findable on 1 September 2026.
2. **Any per-account Blobs storage quota.** Netlify publishes per-object limits but no account
   total, and the credit-rate table has no Blobs line. Blobs cost appears to land entirely on
   function compute, requests and bandwidth. Confirm with support before storing anything large.
3. **Blobs rate limits.** Not documented. Not expected to matter at tens of readers.
4. **The wake-from-idle delay for Netlify DB.** Netlify publishes no number. Measure it before
   relying on any estimate.
5. **Whether `@netlify/blobs` is available to functions without a `package.json`.** Section 5.8 adds
   one, which makes the question moot. Do not depend on implicit availability.
