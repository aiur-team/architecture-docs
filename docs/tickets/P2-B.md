# P2-B — The store helper

## Outcome

The repository has one versioned, validated Netlify Blobs helper that gives every later state API the same strong-consistency reads, record-key contract, and bounded compare-and-swap mutation behavior.

## Context

Netlify Blobs is last-write-wins unless a caller supplies a conditional-write guard. This ticket makes the safe path reusable so two requests that update one mutable record re-read and reapply instead of silently overwriting each other.

The helper is also the persistence compatibility boundary. It validates permanent document IDs and record keys, rejects unknown record versions, and exposes stable storage envelopes without making consumers reinterpret the Blobs client. P2-G uses the store factory plus the read/upgrade boundary and validates its own direct create-only writes; Phase 3 mutable APIs and P4-J use the mutation boundary.

## Scope

### In scope

- Create `netlify/lib/store.mjs` as an ESM module with exactly the runtime exports in the Interface contract.
- Open the site-wide `doc-state` store with store-level `consistency: "strong"`.
- Validate the platform key limits, permanent document IDs, and every domain identifier used by the thread, event, edit, and suggestion key builders.
- Define the version-1 record envelope and reject malformed or unsupported stored state before a caller can mutate it.
- Implement strongly consistent reads that preserve the record ETag.
- Implement optimistic mutation with exactly six read/apply/conditional-write attempts, five bounded backoffs, and no blind write.
- Normalize storage-boundary failures into the documented `StoreError` codes and statuses while preserving domain errors thrown by a mutation callback.
- Document retry purity, idempotency, append-only write behavior, and the downstream import contract in JSDoc next to the implementation.

### Out of scope

- Creating or amending `package.json`, a root lockfile, or `node_modules`. P1-C creates the package manifest and pins `@netlify/blobs@11.0.2`.
- Creating a permanent test file or npm script. This ticket owns one implementation file; the executable Test plan uses isolated inline fixtures.
- Defining thread, event, edit, suggestion, grant, invitation, or access-record domain schemas beyond the common `{ v: 1 }` envelope.
- Generating thread, event, suggestion, comment, or actor IDs. The endpoint that creates a record owns ID generation before it calls this helper.
- Access-specific key builders, email hashing, Identity `sub` validation, `DOC_OWNERS`, owner binding, invitation conversion, or authorization. P2-G owns those in `netlify/lib/access.mjs`.
- HTTP handlers, response bodies, authentication, origin checks, authorization, audit fan-out, retention, notifications, realtime, or client behavior.
- A generic list, delete, append, transaction, lock, queue, or distributed idempotency abstraction.
- Relying on `list()` to honor store-level strong consistency. That remains unverified; a create endpoint must render its response from the successful write instead of immediately relisting.
- Retrying a thrown provider error. Only a resolved conditional write with `modified: false` proves that no write occurred.

## Interface contract

### Runtime exports

`netlify/lib/store.mjs` must have exactly these named runtime exports and no default export:

```js
export const STORE_NAME = "doc-state";
export const MAX_MUTATE_ATTEMPTS = 6;
export class StoreError extends Error {}

export function docState()
export function assertKey(key)
export function assertDocId(docId)
export function upgrade(value)
export async function read(store, key, initial = null)
export async function mutate(store, key, initial, apply)

export function threadPrefix(docId)
export function threadKey(docId, threadId)
export function eventPrefix(docId, month)
export function eventKey(docId, timestamp, eventId)
export function editPrefix(docId)
export function editKey(docId, aid)
export function suggestionPrefix(docId, aid)
export function suggestionKey(docId, aid, suggestionId)
```

`month` and `aid` are optional only on their prefix builders. Calling `eventPrefix(docId)` returns the document event prefix; calling `suggestionPrefix(docId)` returns the document suggestion prefix. Every other parameter shown above is required.

Do not export private regular expressions, sleep/random helpers, serialization helpers, or segment validators. Tests may pass a duck-typed store with `getWithMetadata()` and `setJSON()` to `read()` and `mutate()`; production callers pass the `Store` returned by `docState()`.

### Store factory

`docState()` must call the pinned package in this exact form:

```js
getStore({ name: STORE_NAME, consistency: "strong" })
```

It accepts no arguments and returns the package `Store`. It must not read a token, site ID, URL, deploy ID, or environment variable itself; Netlify supplies the Blobs execution context to `@netlify/blobs`. It must not use `getDeployStore()`, because document state is site-wide and must survive deploys.

Every read made by this module must also pass `{ type: "json", consistency: "strong" }` to `getWithMetadata()`. The operation-level option is intentional defense in depth and makes the required behavior observable in a deterministic fake.

### Common record and result envelopes

A present stored value is a non-null, non-array JSON object with an own integer `v` field. P2-B supports exactly version 1:

```json
{ "v": 1 }
```

Nested field meanings belong to the consuming domain, but their representation is still a storage-boundary concern. A record is JSON-safe only when every reachable value is `null`, a boolean, a string, a finite number, a dense array with no non-index own keys, or a plain object whose prototype is exactly `Object.prototype` or `null` and whose own properties are enumerable string-keyed data properties. Sparse arrays; `undefined`; `NaN`; infinities; `-0`; bigint; symbols; functions; dates; maps; sets; typed arrays; class instances; accessors; non-enumerable properties; symbol keys; cycles; and shared/cyclic object identity are invalid. The private validator walks only own descriptors, never invokes a getter, and rejects a second visit to the same object. `null` is the absence sentinel and is never a stored record.

Every default, stored hit, and non-null callback result must pass that complete recursive JSON-safe check before cloning or writing. A failure is `StoreError("invalid-record", 500, "Invalid stored record")`. Provider methods are never called for an invalid default or callback result. This makes every documented `structuredClone()` infallible for accepted input and prevents `setJSON()` from becoming the first place that discovers an unserializable nested value.

`read()` resolves with exactly this shape:

```js
{ value, etag }
```

- On a hit, `value` is the result of `upgrade(found.data)` and `etag` is the non-empty ETag string returned by Blobs.
- On a miss, `value` is `structuredClone(initial)` after validation and `etag` is `null`. When `initial` is omitted or `null`, `value` is `null`.
- The clone prevents a caller from mutating a shared default object after a miss.

`mutate()` resolves with exactly this shape:

```js
{ value, etag, changed }
```

- A successful conditional write returns the validated value that was written, its new non-empty ETag, and `changed: true`.
- A callback no-op returns the current upgraded value, its current ETag or `null`, and `changed: false`.
- No result exposes Blobs metadata or a raw provider response.

### `upgrade(value)`

`upgrade()` is the one record-version gate:

1. Reject `null`, arrays, primitives, objects without their own `v`, non-integer versions, or any value that fails the complete recursive JSON-safe contract with `StoreError` code `invalid-record`.
2. Return a valid version-1 object unchanged, preserving an accepted null prototype.
3. Reject every other integer version with code `unsupported-version`.
4. Do not infer version 1 for an unversioned object. No legacy production state exists, so a silent default would hide corruption.

Future schema work adds a branch here and nowhere else. A read returns the upgraded value, and the next successful `mutate()` persists that value. A read or a no-op mutation never performs an unsolicited migration write.

### `read(store, key, initial = null)`

`read()` must:

1. Validate `key` with `assertKey()` and, when `initial` is non-null, validate it with `upgrade()` before any provider call. An invalid or unsupported default fails even if the key would have been present; an ignored malformed fallback is still an invalid caller contract.
2. Call `store.getWithMetadata(key, { type: "json", consistency: "strong" })` exactly once.
3. Return the miss or hit envelope above.
4. Treat a hit without a non-empty string ETag as `invalid-record`; a later write must never fall back to an unguarded update.
5. If the package's JSON decoder rejects with a `SyntaxError`, wrap it as `invalid-record`; malformed stored JSON is a data-integrity failure, not an outage or retryable conflict.
6. Wrap every other provider/network failure as `StoreError` code `unavailable`, preserving the original error only as `cause`.

The only valid resolved provider shapes are the exact miss sentinel `null` and a non-array object whose `data` passes `upgrade()` and whose `etag` is a non-empty string. A resolved `undefined`, primitive, array, object without `data`, or hit with a missing, non-string, or empty ETag is `invalid-record`; none is reinterpreted as absence or availability failure.

### `mutate(store, key, initial, apply)`

`mutate()` is the only read-modify-write path for a mutable blob:

```js
// apply receives a fresh clone on every attempt.
const result = await mutate(store, key, initial, (draft) => {
  // Return the complete next version-1 record, or null for no change.
  return draft;
});
```

Its algorithm is exact:

1. Validate `key`, require `apply` to be a function, and validate a non-null `initial` through `upgrade()` before any provider call.
2. For attempt indexes `0` through `5`, call `read(store, key, initial)` and pass `structuredClone(current)` to `apply`.
3. `apply` is synchronous. If it returns a Promise/thenable, throw `invalid-record` without awaiting or writing. Pass every other non-null result through `upgrade()` before writing: malformed or recursively unsafe version-1 results throw `invalid-record`, while an integer version other than 1 throws `unsupported-version` consistently with stored values and defaults.
4. If `apply` returns `null`, return the no-op envelope immediately. A no-op performs no write and no backoff.
5. On a missing key, call `store.setJSON(key, next, { onlyIfNew: true })`.
6. On an existing key, call `store.setJSON(key, next, { onlyIfMatch: etag })` with the opaque ETag unchanged, including quotes or a weakness prefix.
7. Require the resolved write result to be a non-array object with an own boolean `modified`. `null`, a primitive, an array, a missing or inherited `modified`, or a non-boolean `modified` is `invalid-record`; do not retry it.
8. If the call resolves with `modified: true`, require a non-empty string ETag and return the success envelope. A missing, non-string, or empty success ETag is `invalid-record`; the write may have landed, so do not retry it.
9. If the call resolves with `modified: false`, another writer won. When another attempt remains, wait `20 * 2 ** attemptIndex + Math.random() * 40` milliseconds and then re-read and reapply. The five waits therefore have base delays of 20, 40, 80, 160, and 320 ms, each plus jitter in `[0, 40)`.
10. After `modified: false` on attempt index `5`, throw `StoreError` code `conflict` immediately. There is no sixth wait because no retry follows. The total scheduled delay before exhaustion is at least 620 ms and less than 820 ms.

Do not add `updatedAt`, `v`, IDs, timestamps, comments, actors, or any other domain field. The ruling thread schema has no top-level `updatedAt`; `apply` must return the complete intended record.

If `apply` throws, preserve and rethrow that exact value. Domain validation and not-found decisions belong to the caller. If `setJSON()` throws, or `getWithMetadata()` throws anything other than its JSON-decoding `SyntaxError`, wrap once as `unavailable` and stop; retrying an ambiguous provider exception could duplicate an operation that reached the store. The decoding `SyntaxError` follows `read()`'s `invalid-record` rule.

### Retry and idempotency boundary

`apply` may run six times for one `mutate()` call. It must be a pure, repeatable transformation of its draft plus immutable request-scoped values:

- Generate IDs, actor snapshots, and timestamps once before calling `mutate()` and capture them in the callback.
- Do not perform network calls, event writes, notifications, logging with side effects, random generation, or clock reads inside `apply`.
- Write an audit event only after the mutation succeeds. A thread write and its event are two ordered acts; there is no cross-blob transaction.
- A process crash after the state write but before an event write may omit the event, but it must not lose or duplicate the state mutation within the CAS loop.
- `mutate()` provides concurrency safety for one invocation, not request replay idempotency. An endpoint that needs replay protection must own an idempotency key; P4-N later owns the `X-Suggestion-Id` contract.

Append-only and create-only records do not use `mutate()`. Their owner calls `store.setJSON(key, upgrade(record), { onlyIfNew: true })`, checks the returned `modified` boolean, and treats `modified: false` as a duplicate/collision. Never retry such a collision with a different key inside the storage helper; event and suggestion IDs are endpoint-owned, and a collision signals a bug or a replay.

### Error and HTTP status strategy

`StoreError` has this exact constructor and public fields:

```js
new StoreError(code, status, message, { cause } = {})

error.name    // "StoreError"
error.code    // stable machine-readable string
error.status  // stable HTTP status number
error.cause   // optional original error
```

The module creates only these errors:

| Code | Status | Meaning |
|---|---:|---|
| `invalid-key` | 400 | A key or key-builder input violates the exact contract below. |
| `invalid-record` | 500 | Stored/default/next state or a resolved provider envelope is malformed, an ETag is missing, JSON cannot be decoded, or `apply` is not a synchronous record transformation. |
| `unsupported-version` | 500 | A stored, default, or callback record has an integer `v` other than 1. |
| `conflict` | 409 | All six guarded writes resolved with `modified: false`. |
| `unavailable` | 503 | A Blobs write, or a Blobs read for any reason other than JSON-decoding `SyntaxError`, threw instead of returning a result. |

Messages must be the generic phrases `Invalid state key`, `Invalid stored record`, `Unsupported stored record version`, `Concurrent write limit reached`, and `State store unavailable`, respectively. Do not include the rejected value, key, record, ETag, token, URL, provider message, or actor data in a public message.

Downstream handlers may use `error.status` but must create their own endpoint-specific response body. They must never serialize a `StoreError`, its `cause`, or its stack. An arbitrary error/`Response` thrown by `apply` is not converted; the caller owns that domain status.

### Key validation and builders

`assertKey(key)` returns the same string or throws `invalid-key`. It requires a string whose UTF-8 encoding is 1 through 600 bytes, does not start with `/`, and does not start with the literal, case-sensitive encoded-slash prefix `%2F`. The lowercase text `%2f` is not that forbidden literal. It deliberately permits embedded `/` because the ruling layout uses path-like prefixes; it is not a substitute for segment validation.

`assertDocId(docId)` returns the same string or throws `invalid-key`. It requires `^[0-9a-f]{6}$`, the permanent ID contract from P1-A. It never trims, lowercases, or accepts a slug.

Every builder returns the same deterministic key for the same arguments, validates every segment without normalization, validates the final key through `assertKey()`, and uses these exact formats:

| Call | Required validation | Exact result |
|---|---|---|
| `threadPrefix("4b7d2a")` | document ID | `threads/4b7d2a/` |
| `threadKey("4b7d2a", "t_m8x2k1_4f7a9c31")` | thread ID `^t_[0-9a-z]+_[0-9a-f]{8}$` | `threads/4b7d2a/t_m8x2k1_4f7a9c31.json` |
| `eventPrefix("4b7d2a")` | document ID | `events/4b7d2a/` |
| `eventPrefix("4b7d2a", "2026-09")` | month `^\d{4}-(0[1-9]\|1[0-2])$` | `events/4b7d2a/2026-09/` |
| `eventKey("4b7d2a", "2026-09-02T18:04:11.221Z", "1788372251221-4f2a9c")` | exact UTC ISO timestamp with milliseconds; event ID `^\d{13}-[0-9a-f]{6}$`; ID milliseconds equal `Date.parse(timestamp)` | `events/4b7d2a/2026-09/1788372251221-4f2a9c.json` |
| `editPrefix("4b7d2a")` | document ID | `edits/4b7d2a/` |
| `editKey("4b7d2a", "a3f19c2b")` | anchor ID `^a[0-9a-f]{8}$` | `edits/4b7d2a/a3f19c2b.json` |
| `suggestionPrefix("4b7d2a")` | document ID | `suggest/4b7d2a/` |
| `suggestionPrefix("4b7d2a", "a3f19c2b")` | anchor ID | `suggest/4b7d2a/a3f19c2b/` |
| `suggestionKey("4b7d2a", "a3f19c2b", "s_m8x2k1_4f7a9c31")` | suggestion ID `^s_[0-9a-z]+_[0-9a-f]{8}$` | `suggest/4b7d2a/a3f19c2b/s_m8x2k1_4f7a9c31.json` |

An ISO timestamp is exact only when it matches `YYYY-MM-DDTHH:mm:ss.sssZ` and `new Date(value).toISOString() === value`. Prefix builders always end in `/`; record keys always end in `.json`.

P2-G owns `access/<docId>/doc.json`, `access/<docId>/u/<sub>.json`, and `access/<docId>/i/<emailHash>.json` builders because only the access library knows the Identity `sub` and email-hash contracts. It must import `assertDocId()` for the document segment, validate its own segments against `/` injection, and pass its complete result through `assertKey()`.

## Files owned

- `netlify/lib/store.mjs` — **new**, created by P2-B after P1-C supplies the root package contract.

No other implementation file is owned by P2-B. `docs/tickets/P2-B.md` is this specification, not part of the implementation file surface. No later Build Order ticket is authorized to amend `store.mjs`; if a downstream ticket cannot use this contract, it must stop and report the contract gap instead of silently changing the helper.

## Dependencies

### Required predecessor

- **P1-C:** must have created the root `package.json` with ESM mode, Node `>=22.12.0`, and exact `@netlify/blobs: "11.0.2"`. P2-B consumes that package only. It does not need `identify()`, `requireOrigin()`, `/api/session`, P1-E's `netlify.toml`, a linked Netlify site, or credentials.

### Downstream consumers

- **P2-G:** imports `docState`, `read`, `upgrade`, `assertDocId`, `assertKey`, and `StoreError`. It owns all `access/` builders, access-record defaults, authorization, and domain errors. P2-G reads through `read()`/`upgrade()` and performs only direct create-only writes guarded by `onlyIfNew`; P4-J later imports `mutate()` for mutable access amendments.
- **P3-A:** imports `docState`, `threadPrefix`, `threadKey`, `read`, `mutate`, `upgrade`, and `StoreError`. Thread creation uses `onlyIfNew`; reply, resolve, and reopen use `mutate`. It maps a `null` read to 404 and an exhausted CAS to 409.
- **P3-B:** imports `docState`, `eventPrefix`, `eventKey`, `upgrade`, `assertDocId`, and `StoreError`. Event writes are append-only `onlyIfNew` writes, never mutations. A duplicate event key maps to 409.
- **P3-E:** imports `docState`, `editPrefix`, `editKey`, `read`, `assertDocId`, and `StoreError`. It owns manifest comparison and stale-receipt deletion; P2-B does not claim that `list()` is strongly consistent.
- **P4-B/P4-N:** use `editKey` and the create/conflict boundary but retain the block hash as the authority for same-block edit conflicts and request-level idempotency.
- **P4-O:** imports the suggestion builders for prefix scans and immutable create-only writes. It owns the five-per-block cap, effective-base rules, and suggestion lifecycle.

These are stable consumer contracts. A consumer must not duplicate key strings, call `getStore()` directly for `doc-state`, weaken consistency, use an unguarded `setJSON()` for mutable state, or add a second CAS loop.

### Maximum safe implementation waves

Use one implementation wave when practical. At most two serial waves are safe because both touch the single owned file:

1. Error/version/read contract plus validated key builders.
2. Six-attempt mutation loop plus retry/idempotency JSDoc.

Do not parallelize the waves, and do not let a downstream ticket start against a partial first wave. The complete export surface and Test plan must pass before P2-B is available to P2-G or any Phase 3 API.

## Acceptance criteria

- [ ] `netlify/lib/store.mjs` is the only implementation path added or changed by P2-B and exposes exactly the named exports in **Interface contract**.
- [ ] `docState()` opens site-wide `doc-state` with store-level strong consistency and accepts no configuration from callers.
- [ ] Every helper read explicitly requests JSON with strong consistency and preserves the opaque ETag exactly.
- [ ] `upgrade()` accepts recursively JSON-safe version-1 records, including a null-prototype top-level object; rejects every declared nested non-JSON shape, accessor, sparse/extended array, cycle, and repeated object identity as `invalid-record` before clone/provider use; rejects missing/malformed versions as `invalid-record`; and rejects every other integer version as `unsupported-version`.
- [ ] `read()` returns the exact hit/miss envelope, validates even an otherwise unused non-null default before a provider call, clones a miss default, rejects every declared malformed resolved provider shape, and never supplies an unguarded ETag fallback.
- [ ] `mutate()` uses `onlyIfNew` on absence and `onlyIfMatch` on presence; it never performs an unconditional mutable write, accepts only a boolean `modified` result, and rejects a successful result without a non-empty ETag without retrying.
- [ ] A mutation callback receives a fresh clone on every attempt, may return `null` for no change, and cannot return a Promise or malformed record.
- [ ] Six consecutive conditional rejections run `apply` six times, schedule exactly five backoffs with the documented formula, then throw the 409 `conflict` error without a terminal sleep.
- [ ] A JSON-decoding `SyntaxError` becomes 500 `invalid-record`; a distinct thrown provider failure becomes 503 `unavailable` and is not retried; an error thrown by `apply` is preserved unchanged.
- [ ] Executable assertions cover all five exact generic `StoreError` messages as well as their stable codes and statuses.
- [ ] Two deterministic concurrent writes to one thread both land exactly once; one callback runs once and the losing callback runs twice.
- [ ] A create-only write with `onlyIfNew` succeeds once and a second write to the same key resolves with `modified: false` without replacing the first value.
- [ ] Every valid key builder returns the exact path in **Interface contract**; invalid document, thread, month, timestamp, event, anchor, suggestion, leading-slash, literal `%2F` prefix, and over-600-byte inputs fail before a provider call.
- [ ] No builder uses a slug, alias, directory, client path, email address, or unvalidated Identity `sub` as a document key.
- [ ] The helper does not add `updatedAt`, IDs, timestamps, domain fields, endpoint responses, logging, or a second store.
- [ ] The pinned package integration test uses `@netlify/blobs/server` locally, proves the store-level strong-consistency selection and real 11.0.2 conditional-write result, deletes its test key, stops the server, and removes its isolated directory. On macOS/Linux one retained detached anchor remains the positively owned group leader from nonce publication through the complete install/server/assertion command, with finite command and cleanup deadlines, conventional signal status, TERM-to-KILL containment, leader reaping, group-disappearance proof, bounded guarded deletion, and private actionable evidence for every unproved boundary. The deletion worker has no descendants; timeout uses positive `ChildProcess.kill("SIGKILL")` through its retained direct-child handle, never a negative PGID signal, and root removal remains unproved unless that child is reaped and its former group is absent.
- [ ] The document build remains byte-identical, the TypeScript builder still typechecks, the scrub gate passes, and verification leaves no root lockfile, `node_modules`, `.netlify`, fixture, or response artifact.

## Test plan

Run every step after P1-C is present. All sample identifiers and state below are invented and safe for a public repository.

### 1. Verify the predecessor and create an isolated install

Run from the repository root on the Node 22 line:

```bash
set -euo pipefail

read -r -d '' P2B_SUPERVISOR <<'NODE' || true
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SIGNAL_STATUS = Object.freeze({
  SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGKILL: 137,
});
const COMMAND_TIMEOUT_MS = 480_000;
const LAUNCH_TIMEOUT_MS = 2_000;
const TERM_GRACE_MS = 2_000;
const KILL_GRACE_MS = 2_000;
const DELETE_TIMEOUT_MS = 10_000;
const POLL_MS = 25;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const within = async (promise, milliseconds) => Promise.race([
  promise.then((value) => ({ complete: true, value })),
  delay(milliseconds).then(() => ({ complete: false })),
]);

function createSignalLatch() {
  const event = deferred();
  let signal;
  return {
    raise(next) {
      if (signal === undefined) {
        signal = next;
        event.resolve(next);
      }
    },
    wait: event.promise,
    get signal() { return signal; },
  };
}

function installSignalHandlers(target, latch) {
  const handlers = new Map();
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (latch.signal !== undefined) return;
      latch.raise(signal);
      target.exitCode = SIGNAL_STATUS[signal];
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }
  return handlers;
}

const externalSignals = createSignalLatch();
installSignalHandlers(process, externalSignals);
const TMP_PARENT = realpathSync(tmpdir());
assert.ok(TMP_PARENT.startsWith("/") && TMP_PARENT !== "/");

const safeRoot = (root, prefix) => typeof root === "string" &&
  dirname(root) === TMP_PARENT &&
  new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[A-Za-z0-9]{6}$`)
    .test(root.slice(TMP_PARENT.length + 1));

function validateRoot(root, prefix) {
  assert.equal(safeRoot(root, prefix), true);
  const stats = lstatSync(root);
  assert.equal(stats.isDirectory(), true);
  assert.equal(stats.isSymbolicLink(), false);
  assert.equal(realpathSync(root), root);
  return root;
}

function createRoot(prefix) {
  let root;
  try {
    root = mkdtempSync(join(TMP_PARENT, `${prefix}.`));
    chmodSync(root, 0o700);
    return validateRoot(root, prefix);
  } catch (error) {
    if (root !== undefined && safeRoot(root, prefix)) {
      const rootError = new Error("guarded root creation failed", { cause: error });
      rootError.p2bRoot = root;
      throw rootError;
    }
    throw error;
  }
}

function writePrivateJSON(path, value, fail = false) {
  if (fail) throw new Error("invented lifecycle evidence failure");
  const pending = `${path}.new`;
  writeFileSync(pending, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(pending, 0o600);
  renameSync(pending, path);
  chmodSync(path, 0o600);
  assert.equal(statSync(path).mode & 0o777, 0o600);
}

function retainEvidence(details, options = {}) {
  let root;
  let path;
  const io = options.io ?? { mkdtempSync, chmodSync, realpathSync, writeFileSync,
    renameSync, statSync };
  try {
    root = io.mkdtempSync(join(TMP_PARENT, "p2-b-remediation."));
    assert.equal(safeRoot(root, "p2-b-remediation"), true);
    io.chmodSync(root, 0o700);
    assert.equal(io.realpathSync(root), root);
    path = join(root, "manual-remediation.json");
    const pending = `${path}.new`;
    io.writeFileSync(pending, `${JSON.stringify({
      version: 1, recordedAt: new Date().toISOString(), ...details,
    }, null, 2)}\n`, { mode: 0o600 });
    io.chmodSync(pending, 0o600);
    io.renameSync(pending, path);
    io.chmodSync(path, 0o600);
    assert.equal(io.statSync(path).mode & 0o777, 0o600);
    if (!options.silent) {
      console.error(`ERROR  P2-B cleanup unproved; owned-root=${details.ownedRoot ?? "not-created"} owner-pid=${details.ownerPid ?? "not-published"} owner-pgid=${details.ownerPgid ?? "not-published"} evidence=${path}; manual remediation required`);
    }
    return path;
  } catch {
    const locator = path ?? root ?? TMP_PARENT;
    if (!options.silent) {
      console.error(`ERROR  P2-B cleanup unproved; owned-root=${details.ownedRoot ?? "not-created"} owner-pid=${details.ownerPid ?? "not-published"} owner-pgid=${details.ownerPgid ?? "not-published"} evidence=unavailable; inspect=${locator}; manual remediation required`);
    }
    return null;
  }
}

function groupAlive(pgid) {
  assert(Number.isSafeInteger(pgid) && pgid > 1, "unsafe process-group id");
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function groupGone(pgid, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (groupAlive(pgid) && Date.now() < deadline) await delay(POLL_MS);
  return !groupAlive(pgid);
}

function groupMembers(pgid) {
  const rows = execFileSync("ps", ["-axo", "pid=,pgid="], {
    encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024,
  });
  return rows.split("\n").map((row) => row.trim().split(/\s+/).map(Number))
    .filter(([pid, group]) => Number.isSafeInteger(pid) && group === pgid)
    .map(([pid]) => pid).sort((left, right) => left - right);
}

const absent = (path) => {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
};

async function deleteOwnedRoots(ownedRoot, lifecycleRoot, options = {}) {
  try {
    validateRoot(ownedRoot, "p2-b-store");
    validateRoot(lifecycleRoot, "p2-b-owner-evidence");
  } catch {
    const evidencePath = retainEvidence({
      reason: "deletion-root-validation", ownedRoot, lifecycleRoot,
      ownerPid: null, ownerPgid: null,
    }, options);
    return { complete: false, reaped: true, groupDisappeared: true, evidencePath };
  }
  const workerSource = options.deleteMode === "hang"
    ? "setInterval(() => {}, 60000);"
    : options.deleteMode === "fail"
      ? "process.exit(73);"
      : String.raw`
        const {rmSync} = require("node:fs");
        rmSync(process.argv[1], {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
        rmSync(process.argv[2], {recursive: true, force: true, maxRetries: 2, retryDelay: 25});
      `;
  let worker;
  try {
    worker = spawn(process.execPath, ["-e", workerSource, ownedRoot, lifecycleRoot], {
      detached: true, stdio: "ignore",
    });
  } catch {
    const evidencePath = retainEvidence({
      reason: "deletion-spawn-threw", ownedRoot, lifecycleRoot,
      ownerPid: null, ownerPgid: null,
    }, options);
    return { complete: false, reaped: true, groupDisappeared: true, evidencePath };
  }
  const pgid = worker.pid;
  let workerResult;
  const exited = new Promise((resolve) => {
    worker.once("error", () => { workerResult = { kind: "error" }; resolve(workerResult); });
    worker.once("exit", (code, signal) => {
      workerResult = { kind: "exit", code, signal };
      resolve(workerResult);
    });
  });
  if (!Number.isSafeInteger(pgid) || pgid <= 1) {
    worker.unref();
    const evidencePath = retainEvidence({
      reason: "deletion-ownership-unproved", ownedRoot, lifecycleRoot,
      ownerPid: pgid ?? null, ownerPgid: pgid ?? null,
    }, options);
    return { complete: false, reaped: false, groupDisappeared: false, evidencePath };
  }
  const first = await Promise.race([
    exited.then(() => "exit"),
    delay(options.deleteTimeoutMs ?? DELETE_TIMEOUT_MS).then(() => "timeout"),
  ]);
  if (first === "timeout") {
    try {
      if (workerResult === undefined) worker.kill("SIGKILL");
    } catch {}
  }
  const reaped = (await within(exited, options.killGraceMs ?? KILL_GRACE_MS)).complete;
  let disappeared = false;
  try {
    disappeared = reaped && await groupGone(pgid, options.killGraceMs ?? KILL_GRACE_MS);
  } catch {}
  const removed = absent(ownedRoot) && absent(lifecycleRoot);
  if (first === "exit" && reaped && disappeared && removed &&
      workerResult?.kind === "exit" && workerResult.code === 0 && workerResult.signal === null) {
    return { complete: true, reaped, groupDisappeared: true, rootRemoved: true };
  }
  if (!reaped || !disappeared) {
    try { worker.removeAllListeners(); worker.unref(); } catch {}
  }
  const evidencePath = retainEvidence({
    reason: first === "timeout" ? "deletion-timeout" : "deletion-failed",
    ownedRoot, lifecycleRoot, ownerPid: pgid, ownerPgid: pgid,
    deletionWorkerReaped: reaped, deletionGroupDisappeared: disappeared,
    deletionWorkerResult: workerResult ?? null,
  }, options);
  return {
    complete: false, reaped, groupDisappeared: disappeared, rootRemoved: removed,
    timedOut: first === "timeout", workerResult, evidencePath,
  };
}

const ANCHOR = String.raw`
set -u
trap ':' HUP INT TERM
owner_pid=$$
owner_pgid=$(ps -o pgid= -p "$owner_pid" | tr -d '[:space:]')
test "$owner_pid" = "$owner_pgid" || exit 125
if test "$P2B_PUBLICATION_FAIL" = 1; then exit 73; fi
printf 'READY %s %s\n' "$P2B_OWNER_NONCE" "$owner_pid" >&3 || exit 125
IFS= read -r command <&4 || exit 125
test "$command" = "START $P2B_OWNER_NONCE" || exit 125
set +e
bash -seu -o pipefail 3>&- 4>&-
fixture_status=$?
set -e
printf 'DONE %s %s %s\n' "$P2B_OWNER_NONCE" "$owner_pid" "$fixture_status" >&3 || exit 125
while IFS= read -r command <&4; do
  if test "$command" = "RELEASE $P2B_OWNER_NONCE"; then exit "$fixture_status"; fi
done
exit 125
`;

async function supervise(block, options = {}) {
  assert.ok(["darwin", "linux"].includes(process.platform),
    "P2-B supervisor requires macOS or Linux");
  const signalLatch = options.signalLatch ?? externalSignals;
  const stageHook = options.stageHook ?? (async () => {});
  await stageHook("early", {});
  await delay(0);
  if (signalLatch.signal !== undefined) {
    return {
      code: null, signal: null, stdout: "", stderr: "",
      failure: `external-signal:${signalLatch.signal}`, ownedRoot: null,
      cleanup: { complete: true, groupDisappeared: true, rootRemoved: true, signals: [] },
    };
  }

  let ownedRoot;
  try {
    ownedRoot = createRoot("p2-b-store");
  } catch (error) {
    ownedRoot = error?.p2bRoot ?? null;
    const evidencePath = retainEvidence({
      reason: "owned-root-creation", ownedRoot,
      lifecycleRoot: null, ownerPid: null, ownerPgid: null,
    }, options);
    return {
      code: null, signal: null, stdout: "", stderr: "", failure: "manual-remediation",
      ownedRoot, lifecycleRoot: null, evidencePath,
      cleanup: { complete: false, groupDisappeared: true, rootRemoved: false, signals: [] },
    };
  }
  let lifecycle;
  try {
    lifecycle = { root: createRoot("p2-b-owner-evidence") };
    lifecycle.path = join(lifecycle.root, "owner.json");
    writePrivateJSON(lifecycle.path, {
      version: 1, state: "pre-spawn", supervisorPid: process.pid, ownedRoot,
    }, options.evidenceFailureAt === "pre-spawn");
  } catch (error) {
    const lifecycleRoot = lifecycle?.root ?? error?.p2bRoot ?? null;
    const evidencePath = retainEvidence({
      reason: "pre-spawn-evidence-write", ownedRoot,
      lifecycleRoot, ownerPid: null, ownerPgid: null,
    }, options);
    return {
      code: null, signal: null, stdout: "", stderr: "", failure: "manual-remediation",
      ownedRoot, lifecycleRoot, evidencePath,
      cleanup: { complete: false, groupDisappeared: true, rootRemoved: false, signals: [] },
    };
  }
  await stageHook("pre-spawn", {
    ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path,
  });

  const nonce = randomBytes(16).toString("hex");
  let child;
  try {
    child = spawn("bash", ["-c", ANCHOR], {
      cwd: process.cwd(), detached: true,
      env: {
        ...process.env, P2B_TEST_ROOT: ownedRoot, TMPDIR: ownedRoot,
        P2B_OWNER_NONCE: nonce,
        P2B_PUBLICATION_FAIL: options.publicationFailure ? "1" : "0",
      },
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
  } catch {
    const deletion = await deleteOwnedRoots(ownedRoot, lifecycle.root, options);
    return {
      code: null, signal: null, stdout: "", stderr: "", failure: "spawn-error",
      ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: deletion.evidencePath,
      cleanup: { ...deletion, signals: [] },
    };
  }

  const pid = child.pid;
  const ready = deferred();
  const done = deferred();
  const failed = deferred();
  const spawnFailed = deferred();
  let failure;
  let fixtureStatus;
  let exitedResult;
  const fail = (reason) => {
    if (failure === undefined) {
      failure = reason;
      failed.resolve(reason);
    }
  };
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => {
    exitedResult = { code, signal };
    resolve(exitedResult);
  }));
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.once("error", (error) => {
    const reason = error?.code === "ENOENT" ? "spawn-error" : "launch-error";
    fail(reason);
    spawnFailed.resolve(reason);
  });
  const capture = (stream, label) => {
    const chunks = [];
    let bytes = 0;
    stream.on("data", (chunk) => {
      if (bytes + chunk.length > (options.maxOutputBytes ?? MAX_OUTPUT_BYTES)) {
        fail(`${label}-limit`);
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    });
    stream.on("error", () => fail(`${label}-error`));
    return () => Buffer.concat(chunks, bytes).toString("utf8");
  };
  const stdout = capture(child.stdout, "stdout");
  const stderr = capture(child.stderr, "stderr");
  child.stdin.on("error", (error) => { if (error?.code !== "EPIPE") fail("stdin-error"); });
  child.stdio[3].on("error", () => fail("protocol-error"));
  child.stdio[4].on("error", (error) => { if (error?.code !== "EPIPE") fail("control-error"); });
  const detach = () => {
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    child.stdio[3].destroy(); child.stdio[4].destroy(); child.unref();
  };

  let protocol = "";
  child.stdio[3].setEncoding("utf8");
  child.stdio[3].on("data", (chunk) => {
    protocol += chunk;
    if (protocol.length > 4096) return fail("protocol-limit");
    while (protocol.includes("\n")) {
      const index = protocol.indexOf("\n");
      const line = protocol.slice(0, index);
      protocol = protocol.slice(index + 1);
      const readyMatch = /^READY ([0-9a-f]{32}) ([0-9]+)$/.exec(line);
      const doneMatch = /^DONE ([0-9a-f]{32}) ([0-9]+) ([0-9]+)$/.exec(line);
      if (readyMatch && readyMatch[1] === nonce && Number(readyMatch[2]) === pid) {
        ready.resolve(true);
      } else if (doneMatch && doneMatch[1] === nonce && Number(doneMatch[2]) === pid) {
        fixtureStatus = Number(doneMatch[3]);
        done.resolve(fixtureStatus);
      } else {
        fail("protocol-error");
      }
    }
  });

  const finishAfterDeletion = async (result) => {
    const deletion = await deleteOwnedRoots(ownedRoot, lifecycle.root, options);
    if (!deletion.complete) {
      return {
        ...result, ownedRoot, lifecycleRoot: lifecycle.root,
        failure: "manual-remediation", evidencePath: deletion.evidencePath,
        cleanup: { ...result.cleanup, ...deletion, complete: false, rootRemoved: false },
      };
    }
    await stageHook("final-cleanup", {
      ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path, pid,
    });
    if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
    return {
      ...result, ownedRoot, lifecycleRoot: lifecycle.root, failure,
      cleanup: { ...result.cleanup, ...deletion, complete: true, rootRemoved: true },
    };
  };

  const launch = await Promise.race([
    ready.promise.then(() => "ready"), spawnFailed.promise,
    failed.promise.then(() => "failure"), exited.then(() => "exit"),
    signalLatch.wait.then(() => "external-signal"),
    delay(options.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS).then(() => "launch-timeout"),
  ]);
  if (launch !== "ready") {
    child.stdin.destroy();
    child.stdio[4].destroy();
    const signals = [];
    if (Number.isSafeInteger(pid) && pid > 1 && exitedResult === undefined) {
      try { child.kill("SIGTERM"); signals.push("SIGTERM"); } catch {}
      if (!(await within(exited, options.termGraceMs ?? TERM_GRACE_MS)).complete) {
        try { child.kill("SIGKILL"); signals.push("SIGKILL"); } catch {}
      }
    }
    const reaped = Number.isSafeInteger(pid)
      ? (await within(exited, options.killGraceMs ?? KILL_GRACE_MS)).complete
      : true;
    const closeComplete = (await within(closed, options.killGraceMs ?? KILL_GRACE_MS)).complete;
    let disappeared = !Number.isSafeInteger(pid);
    try {
      if (Number.isSafeInteger(pid) && pid > 1) {
        disappeared = reaped && closeComplete &&
          await groupGone(pid, options.killGraceMs ?? KILL_GRACE_MS);
      }
    } catch {}
    if (!reaped || !closeComplete || !disappeared) {
      detach();
      const evidencePath = retainEvidence({
        reason: failure ?? (launch === "exit" ? "publication-failure" : launch),
        ownedRoot, lifecycleRoot: lifecycle.root,
        ownerPid: Number.isSafeInteger(pid) ? pid : null,
        ownerPgid: Number.isSafeInteger(pid) ? pid : null,
        ownershipPublished: false, reaped, groupDisappeared: disappeared, signals,
      }, options);
      return {
        code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
        stdout: stdout(), stderr: stderr(), failure: "manual-remediation",
        ownedRoot, lifecycleRoot: lifecycle.root, evidencePath,
        cleanup: { complete: false, reaped, groupDisappeared: disappeared, signals },
      };
    }
    const launchFailure = signalLatch.signal !== undefined
      ? `external-signal:${signalLatch.signal}`
      : options.publicationFailure ? "publication-failure" : failure ?? launch;
    failure = launchFailure;
    return finishAfterDeletion({
      code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
      stdout: stdout(), stderr: stderr(), failure: launchFailure,
      cleanup: { complete: true, reaped: true, groupDisappeared: true, signals },
    });
  }

  let members;
  try {
    members = groupMembers(pid);
    assert.ok(Number.isSafeInteger(pid) && pid > 1 && members.includes(pid));
    writePrivateJSON(lifecycle.path, {
      version: 1, state: "active", supervisorPid: process.pid,
      ownedRoot, ownerPid: pid, ownerPgid: pid, nonce,
    }, options.evidenceFailureAt === "active");
  } catch {
    const signals = [];
    let reaped = false;
    let disappeared = false;
    try {
      if (Number.isSafeInteger(pid) && pid > 1 && groupMembers(pid).includes(pid)) {
        process.kill(-pid, "SIGTERM"); signals.push("SIGTERM");
        await delay(options.termGraceMs ?? TERM_GRACE_MS);
        if (groupAlive(pid)) { process.kill(-pid, "SIGKILL"); signals.push("SIGKILL"); }
        reaped = (await within(exited, options.killGraceMs ?? KILL_GRACE_MS)).complete;
        const closeComplete = (await within(closed,
          options.killGraceMs ?? KILL_GRACE_MS)).complete;
        disappeared = reaped && closeComplete &&
          await groupGone(pid, options.killGraceMs ?? KILL_GRACE_MS);
      }
    } catch {}
    if (!reaped || !disappeared) detach();
    const evidencePath = retainEvidence({
      reason: "active-evidence-write", ownedRoot, lifecycleRoot: lifecycle.root,
      ownerPid: pid, ownerPgid: pid, ownershipPublished: true,
      reaped, groupDisappeared: disappeared, signals,
    }, options);
    return {
      code: exitedResult?.code ?? null, signal: exitedResult?.signal ?? null,
      stdout: stdout(), stderr: stderr(), failure: "manual-remediation",
      ownedRoot, lifecycleRoot: lifecycle.root, evidencePath,
      cleanup: { complete: false, reaped, groupDisappeared: disappeared,
        rootRemoved: false, signals },
    };
  }

  await stageHook("active-evidence", {
    ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path, pid,
  });
  child.stdin.end(block);
  child.stdio[4].write(`START ${nonce}\n`);
  await stageHook("active", {
    ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path, pid,
  });

  const first = await Promise.race([
    done.promise.then(() => "done"), failed.promise.then(() => "failure"),
    exited.then(() => "owner-exit"), signalLatch.wait.then(() => "external-signal"),
    delay(options.timeoutMs ?? COMMAND_TIMEOUT_MS).then(() => "timeout"),
  ]);
  if (first === "timeout") fail("timeout");
  if (first === "external-signal") fail(`external-signal:${signalLatch.signal}`);
  if (first === "owner-exit") fail("ownership-lost");
  if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);

  const signals = [];
  const manual = (reason, observed = []) => {
    detach();
    const evidencePath = retainEvidence({
      reason, ownedRoot, lifecycleRoot: lifecycle.root, ownerPid: pid, ownerPgid: pid,
      ownershipPublished: true, lastObservedGroupMembers: observed, signals,
    }, options);
    return {
      code: fixtureStatus ?? exitedResult?.code ?? null,
      signal: exitedResult?.signal ?? null, stdout: stdout(), stderr: stderr(),
      failure: "manual-remediation", ownedRoot, lifecycleRoot: lifecycle.root,
      evidencePath, cleanup: { complete: false, groupDisappeared: false, signals },
    };
  };
  const ownedMembers = () => {
    if (exitedResult !== undefined || !Number.isSafeInteger(pid) || pid <= 1) {
      throw new Error("ownership-lost");
    }
    const observed = groupMembers(pid);
    if (!observed.includes(pid)) throw new Error("ownership-lost");
    return observed;
  };
  const signalGroup = (signal) => {
    const observed = ownedMembers();
    process.kill(-pid, signal);
    signals.push(signal);
    return observed;
  };
  const waitForOnlyAnchor = async (milliseconds) => {
    const deadline = Date.now() + milliseconds;
    while (true) {
      const observed = ownedMembers();
      if (observed.length === 1) return { complete: true, observed };
      if (Date.now() >= deadline) return { complete: false, observed };
      await delay(POLL_MS);
    }
  };

  let observed = members;
  try {
    observed = ownedMembers();
    if (failure !== undefined || observed.length > 1) {
      signalGroup("SIGTERM");
      const afterTerm = await waitForOnlyAnchor(options.termGraceMs ?? TERM_GRACE_MS);
      observed = afterTerm.observed;
      if (!afterTerm.complete) {
        signalGroup("SIGKILL");
        child.stdio[4].destroy();
        const exitComplete = (await within(exited,
          options.killGraceMs ?? KILL_GRACE_MS)).complete;
        const closeComplete = (await within(closed,
          options.killGraceMs ?? KILL_GRACE_MS)).complete;
        let disappeared = false;
        try {
          disappeared = exitComplete && closeComplete &&
            await groupGone(pid, options.killGraceMs ?? KILL_GRACE_MS);
        } catch {}
        if (!exitComplete || !closeComplete || !disappeared) {
          return manual("group-survived-sigkill", observed);
        }
        await stageHook("post-result", {
          ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path, pid,
        });
        if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
        return finishAfterDeletion({
          code: fixtureStatus ?? (failure === "timeout" ? 124 : null),
          signal: exitedResult?.signal ?? null, stdout: stdout(), stderr: stderr(), failure,
          cleanup: { complete: true, reaped: true, groupDisappeared: true, signals },
        });
      }
    }
    child.stdio[4].end(`RELEASE ${nonce}\n`);
    const exitComplete = (await within(exited,
      options.killGraceMs ?? KILL_GRACE_MS)).complete;
    const closeComplete = (await within(closed,
      options.killGraceMs ?? KILL_GRACE_MS)).complete;
    let disappeared = false;
    try {
      disappeared = exitComplete && closeComplete &&
        await groupGone(pid, options.killGraceMs ?? KILL_GRACE_MS);
    } catch {}
    if (!exitComplete || !closeComplete || !disappeared) {
      return manual("anchor-release-incomplete", observed);
    }
    await stageHook("post-result", {
      ownedRoot, lifecycleRoot: lifecycle.root, evidencePath: lifecycle.path, pid,
    });
    if (signalLatch.signal !== undefined) fail(`external-signal:${signalLatch.signal}`);
    return finishAfterDeletion({
      code: fixtureStatus ?? exitedResult?.code ?? null,
      signal: exitedResult?.signal ?? null, stdout: stdout(), stderr: stderr(), failure,
      cleanup: { complete: true, reaped: true, groupDisappeared: true, signals },
    });
  } catch {
    return manual("ownership-lost", observed ?? []);
  }
}

function artifactSnapshot() {
  return readdirSync(TMP_PARENT).filter((name) =>
    /^(?:p2-b-store|p2-b-owner-evidence|p2-b-remediation)\.[A-Za-z0-9]{6}$/.test(name))
    .sort();
}

function removeRetained(result) {
  assert.equal(result.cleanup.groupDisappeared, true);
  const roots = new Set([
    result.ownedRoot, result.lifecycleRoot,
    result.evidencePath ? dirname(result.evidencePath) : null,
  ].filter(Boolean));
  for (const root of roots) {
    const prefix = root.includes("/p2-b-store.") ? "p2-b-store"
      : root.includes("/p2-b-owner-evidence.") ? "p2-b-owner-evidence"
        : "p2-b-remediation";
    validateRoot(root, prefix);
    rmSync(root, { recursive: true, force: true });
  }
}

async function captureDiagnostics(run) {
  const native = console.error;
  const messages = [];
  console.error = (message) => messages.push(String(message));
  try { return { result: await run(), messages }; }
  finally { console.error = native; }
}

async function testSupervisor() {
  const before = artifactSnapshot();
  for (const stage of ["early", "active", "post-result", "final-cleanup"]) {
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      const secondSignal = stage === "final-cleanup"
        ? ({SIGHUP: "SIGINT", SIGINT: "SIGTERM", SIGTERM: "SIGHUP"})[signal]
        : null;
      const probe = spawnSync(process.execPath, [
        ...process.execArgv, "--", `--probe-stage=${stage}`, `--probe-signal=${signal}`,
        ...(secondSignal === null ? [] : [`--probe-second-signal=${secondSignal}`]),
      ], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 });
      assert.equal(probe.error, undefined, `${stage}/${signal} spawn`);
      assert.equal(probe.signal, null, `${stage}/${signal} signal`);
      assert.equal(probe.status, SIGNAL_STATUS[signal], `${stage}/${signal} status`);
      assert.equal(probe.stdout, "", `${stage}/${signal} stdout`);
      assert.equal(probe.stderr, "", `${stage}/${signal} stderr`);
    }
  }

  for (const [signal, status] of Object.entries(SIGNAL_STATUS)) {
    const result = await supervise(`kill -${signal.slice(3)} $$\n`, {
      timeoutMs: 500, termGraceMs: 50, killGraceMs: 500,
      deleteTimeoutMs: 500, silent: true,
    });
    assert.equal(result.code, status, `${signal} status`);
    assert.equal(result.signal, null, `${signal} anchor signal`);
    assert.equal(result.failure, undefined, `${signal} failure`);
    assert.equal(result.cleanup.complete, true, `${signal} cleanup`);
    assert.equal(result.cleanup.groupDisappeared, true, `${signal} group`);
    assert.equal(result.cleanup.rootRemoved, true, `${signal} root`);
  }

  let result = await supervise(":\n", {
    publicationFailure: true, timeoutMs: 500, termGraceMs: 50,
    killGraceMs: 500, deleteTimeoutMs: 500, silent: true,
  });
  assert.equal(result.failure, "publication-failure");
  assert.equal(result.cleanup.complete, true);
  assert.equal(result.cleanup.groupDisappeared, true);
  assert.equal(result.cleanup.rootRemoved, true);

  result = await supervise("sleep 10\n", {
    timeoutMs: 40, termGraceMs: 100, killGraceMs: 500,
    deleteTimeoutMs: 500, silent: true,
  });
  assert.equal(result.failure, "timeout");
  assert.equal(result.cleanup.complete, true);
  assert.ok(result.cleanup.signals.includes("SIGTERM"));

  result = await supervise("trap '' TERM\n(trap '' TERM; while :; do sleep 1; done) &\nwait\n", {
    timeoutMs: 40, termGraceMs: 75, killGraceMs: 500,
    deleteTimeoutMs: 500, silent: true,
  });
  assert.deepEqual(result.cleanup.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result.cleanup.complete, true);
  assert.equal(result.cleanup.groupDisappeared, true);

  result = await supervise("(trap 'exit 0' TERM; while :; do sleep 1; done) &\nexit 0\n", {
    timeoutMs: 500, termGraceMs: 250, killGraceMs: 500,
    deleteTimeoutMs: 500, silent: true,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.cleanup.signals, ["SIGTERM"]);
  assert.equal(result.cleanup.complete, true);
  assert.equal(result.cleanup.groupDisappeared, true);

  const evidenceStates = [];
  result = await supervise(":\n", {
    timeoutMs: 500, killGraceMs: 500, deleteTimeoutMs: 500, silent: true,
    stageHook: async (stage, context) => {
      if (!["pre-spawn", "active-evidence"].includes(stage)) return;
      assert.equal(statSync(context.evidencePath).mode & 0o777, 0o600);
      const evidence = JSON.parse(readFileSync(context.evidencePath, "utf8"));
      assert.equal(evidence.state, stage === "pre-spawn" ? "pre-spawn" : "active");
      evidenceStates.push(evidence.state);
    },
  });
  assert.deepEqual(evidenceStates, ["pre-spawn", "active"]);
  assert.equal(result.cleanup.complete, true);

  for (const evidenceFailureAt of ["pre-spawn", "active"]) {
    const probe = await captureDiagnostics(() => supervise(":\n", {
      evidenceFailureAt, timeoutMs: 500, termGraceMs: 50,
      killGraceMs: 500, deleteTimeoutMs: 500,
    }));
    assert.equal(probe.result.failure, "manual-remediation");
    assert.equal(probe.result.cleanup.complete, false);
    assert.equal(probe.result.cleanup.groupDisappeared, true);
    assert.equal(statSync(probe.result.evidencePath).mode & 0o777, 0o600);
    assert.equal(probe.messages.length, 1);
    assert.match(probe.messages[0], /owned-root=.* owner-pid=.* owner-pgid=.* evidence=.*manual-remediation\.json/);
    removeRetained(probe.result);
  }

  for (const deleteMode of ["fail", "hang"]) {
    const probe = await captureDiagnostics(() => supervise(":\n", {
      deleteMode, timeoutMs: 500, killGraceMs: 500,
      deleteTimeoutMs: deleteMode === "hang" ? 40 : 500,
    }));
    assert.equal(probe.result.failure, "manual-remediation");
    assert.equal(probe.result.cleanup.complete, false);
    assert.equal(probe.result.cleanup.reaped, true);
    assert.equal(probe.result.cleanup.groupDisappeared, true);
    if (deleteMode === "hang") {
      assert.equal(probe.result.cleanup.timedOut, true);
      assert.equal(probe.result.cleanup.workerResult?.signal, "SIGKILL");
    }
    assert.equal(statSync(probe.result.evidencePath).mode & 0o777, 0o600);
    assert.equal(probe.messages.length, 1);
    assert.match(probe.messages[0], /owner-pid=[0-9]+ owner-pgid=[0-9]+ evidence=.*manual-remediation\.json/);
    removeRetained(probe.result);
  }

  const unavailable = await captureDiagnostics(async () => retainEvidence({
    reason: "invented-persistence-failure", ownedRoot: "not-created",
    ownerPid: 4242, ownerPgid: 4242,
  }, {
    io: { mkdtempSync() { throw new Error("invented mkdir failure"); } },
  }));
  assert.equal(unavailable.result, null);
  assert.equal(unavailable.messages.length, 1);
  assert.match(unavailable.messages[0],
    /owner-pid=4242 owner-pgid=4242 evidence=unavailable; inspect=.*manual remediation required/);

  assert.deepEqual(artifactSnapshot(), before, "P2-B supervisor self-tests left residue");
}

const signalStatus = (fallback) => SIGNAL_STATUS[externalSignals.signal] ?? fallback;
async function exitWithSignalAuthority(fallback) {
  await delay(0);
  await new Promise((resolve) => setImmediate(resolve));
  process.exit(signalStatus(fallback));
}

(async () => {
  const stageArgument = process.argv.find((value) => value.startsWith("--probe-stage="));
  const signalArgument = process.argv.find((value) => value.startsWith("--probe-signal="));
  const secondSignalArgument = process.argv.find((value) =>
    value.startsWith("--probe-second-signal="));
  if (stageArgument !== undefined || signalArgument !== undefined ||
      secondSignalArgument !== undefined) {
    assert.ok(stageArgument !== undefined && signalArgument !== undefined);
    const stage = stageArgument.slice("--probe-stage=".length);
    const signal = signalArgument.slice("--probe-signal=".length);
    assert.ok(["early", "active", "post-result", "final-cleanup"].includes(stage));
    assert.ok(["SIGHUP", "SIGINT", "SIGTERM"].includes(signal));
    const secondSignal = secondSignalArgument?.slice("--probe-second-signal=".length);
    assert.equal(secondSignal === undefined || (stage === "final-cleanup" &&
      ["SIGHUP", "SIGINT", "SIGTERM"].includes(secondSignal) && secondSignal !== signal), true);
    let fired = false;
    const result = await supervise(stage === "active" ? "sleep 10\n" : ":\n", {
      timeoutMs: 500, termGraceMs: 50, killGraceMs: 500,
      deleteTimeoutMs: 500, silent: true,
      stageHook: async (current) => {
        if (fired || current !== stage) return;
        fired = true;
        process.kill(process.pid, signal);
        await delay(0);
        await externalSignals.wait;
        if (secondSignal !== undefined) {
          process.kill(process.pid, secondSignal);
          await delay(0);
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(externalSignals.signal, signal);
        }
      },
    });
    assert.equal(fired, true);
    assert.equal(externalSignals.signal, signal);
    assert.equal(result.failure, `external-signal:${signal}`);
    assert.equal(result.cleanup.complete, true);
    assert.equal(result.cleanup.groupDisappeared, true);
    assert.equal(result.cleanup.rootRemoved, true);
    return SIGNAL_STATUS[signal];
  }
  if (process.argv.includes("--self-test")) {
    await testSupervisor();
    return 0;
  }
  const timeoutArgument = process.argv.find((value) => value.startsWith("--timeout-ms="));
  const timeoutMs = timeoutArgument === undefined
    ? COMMAND_TIMEOUT_MS : Number(timeoutArgument.slice("--timeout-ms=".length));
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  const block = readFileSync(0, "utf8");
  const result = await supervise(block, { timeoutMs });
  if (externalSignals.signal !== undefined) return SIGNAL_STATUS[externalSignals.signal];
  if (!result.cleanup.complete || result.failure !== undefined) {
    if (result.failure !== "manual-remediation") {
      console.error(`ERROR  P2-B supervised fixture failed: ${result.failure}`);
    }
    return result.failure === "timeout" ? 124 : 1;
  }
  writeFileSync(1, result.stdout);
  writeFileSync(2, result.stderr);
  return result.code ?? 1;
})().then(exitWithSignalAuthority).catch(async () => {
  console.error("ERROR  P2-B supervisor failed before safe completion");
  await exitWithSignalAuthority(1);
});
NODE

p2b_supervise() {
  node --input-type=module --eval "$P2B_SUPERVISOR" -- "$@"
}

p2b_supervise --self-test
p2b_supervise --timeout-ms=30000 <<'FIXTURE'
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
assert.equal(major, 22, `expected the Node 22 line, got ${process.version}`);
assert.ok(minor >= 12, `expected Node >=22.12.0, got ${process.version}`);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(pkg.type, "module");
assert.equal(pkg.engines?.node, ">=22.12.0");
assert.equal(pkg.dependencies?.["@netlify/blobs"], "11.0.2");
console.log("PASS  P1-C Blobs prerequisite");
NODE
FIXTURE
```

Expected: exit `0` and exactly `PASS  P1-C Blobs prerequisite`. The exact supervisor self-tests are silent and leave no matching fixture/evidence root. HUP, INT, and TERM handlers are installed before the resolved temporary parent is read or any artifact exists. For each command the supervisor creates exact nonsymlink mode-`0700` `p2-b-store.` and `p2-b-owner-evidence.` roots directly below that resolved parent and writes mode-`0600` pre-spawn evidence. Its detached Bash anchor proves by nonce that it is the positive PID/PGID owner, then waits; the command cannot start until the parent has published mode-`0600` active evidence and sends the matching `START`. Publication failure therefore has no command or descendant to escape containment.

The silent tests exercise this exact source for failed nonce publication; all three real terminal signals at early, active, post-result, and final-cleanup boundaries; a second distinct real terminal signal during each final-cleanup case; natural child HUP/INT/TERM/KILL statuses 129/130/143/137; command timeout; a TERM-resistant descendant; a parent-exit descendant; both pre-spawn and active evidence-write failure; deletion failure and timeout/KILL; evidence-persistence failure with the exact safe PID/PGID/root locator; and zero residue after every proved path. The first directly received terminal signal sets the eventual status immediately; the final-cleanup probes deliver and drain a second distinct handler event, assert that the latch still names the first signal, and prove that first status remains authoritative through the final event-loop boundary. Normal and failure containment use finite deadlines, TERM then KILL the still-proved command group, await/reap the direct leader, close inherited streams, prove the process group disappeared, and only then invoke a separately owned bounded deletion worker. That worker spawns no descendants, so timeout KILL is positive through the retained direct-child handle; it is still reaped and its former group must disappear before deletion is accepted. If ownership, reaping, disappearance, evidence, or deletion cannot be proved, guarded roots and mode-`0600` actionable evidence are retained and printed for manual remediation; recursive deletion is never attempted over a possibly live group.

### 2. Run the deterministic contract and real local-server checks

Continue in the same shell so the exact `p2b_supervise` definition from step 1 remains active:

```bash
set -euo pipefail

p2b_supervise <<'FIXTURE'
mkdir -p "$P2B_TEST_ROOT/netlify/lib" "$P2B_TEST_ROOT/blob-data"
cp package.json "$P2B_TEST_ROOT/package.json"
cp netlify/lib/store.mjs "$P2B_TEST_ROOT/netlify/lib/store.mjs"
npm install --prefix "$P2B_TEST_ROOT" --ignore-scripts --no-package-lock >/dev/null
npm --prefix "$P2B_TEST_ROOT" ls @netlify/blobs --depth=0 >/dev/null
test ! -e package-lock.json
test ! -e node_modules
cd "$P2B_TEST_ROOT"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { register } from "node:module";

const moduleSource = [
  "export const calls = [];",
  "export const sentinel = Object.freeze({ kind: 'invented-store-sentinel' });",
  "export function getStore(options) {",
  "  calls.push(structuredClone(options));",
  "  return sentinel;",
  "}",
].join("\n");
const hookSource = [
  `const moduleSource = ${JSON.stringify(moduleSource)};`,
  "export async function resolve(specifier, context, nextResolve) {",
  "  if (specifier === '@netlify/blobs') return { url: 'p2b:blobs', shortCircuit: true };",
  "  return nextResolve(specifier, context);",
  "}",
  "export async function load(url, context, nextLoad) {",
  "  if (url === 'p2b:blobs') return { format: 'module', source: moduleSource, shortCircuit: true };",
  "  return nextLoad(url, context);",
  "}",
].join("\n");
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url);

const helper = await import("./netlify/lib/store.mjs?factory-contract");
const blobs = await import("@netlify/blobs");
assert.equal(helper.docState(), blobs.sentinel);
assert.deepEqual(blobs.calls, [{ name: "doc-state", consistency: "strong" }]);
NODE

P2B_BLOB_DIR="$P2B_TEST_ROOT/blob-data" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { BlobsServer } from "@netlify/blobs/server";
import { setEnvironmentContext } from "@netlify/blobs";
import * as helper from "./netlify/lib/store.mjs";

const {
  MAX_MUTATE_ATTEMPTS,
  STORE_NAME,
  StoreError,
  assertDocId,
  assertKey,
  docState,
  editKey,
  editPrefix,
  eventKey,
  eventPrefix,
  mutate,
  read,
  suggestionKey,
  suggestionPrefix,
  threadKey,
  threadPrefix,
  upgrade,
} = helper;

const expectedExports = [
  "MAX_MUTATE_ATTEMPTS", "STORE_NAME", "StoreError", "assertDocId", "assertKey",
  "docState", "editKey", "editPrefix", "eventKey", "eventPrefix", "mutate", "read",
  "suggestionKey", "suggestionPrefix", "threadKey", "threadPrefix", "upgrade",
].sort();
assert.deepEqual(Object.keys(helper).sort(), expectedExports);
assert.equal(STORE_NAME, "doc-state");
assert.equal(MAX_MUTATE_ATTEMPTS, 6);

const expectedMessages = new Map([
  ["invalid-key", "Invalid state key"],
  ["invalid-record", "Invalid stored record"],
  ["unsupported-version", "Unsupported stored record version"],
  ["conflict", "Concurrent write limit reached"],
  ["unavailable", "State store unavailable"],
]);

function expectStoreError(fn, code, status) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof StoreError);
    assert.equal(error.name, "StoreError");
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.message, expectedMessages.get(code));
    return true;
  });
}

async function expectStoreRejection(promise, code, status, expectedCause) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StoreError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.message, expectedMessages.get(code));
    if (expectedCause !== undefined) assert.equal(error.cause, expectedCause);
    return true;
  });
}

class FakeStore {
  constructor() {
    this.entries = new Map();
    this.reads = [];
    this.writes = [];
    this.nextETag = 1;
    this.forcedConflicts = 0;
    this.readError = null;
    this.writeError = null;
  }

  seed(key, value, etag = '"seed"') {
    this.entries.set(key, { value: structuredClone(value), etag });
  }

  async getWithMetadata(key, options) {
    this.reads.push({ key, options: structuredClone(options) });
    if (this.readError) throw this.readError;
    const entry = this.entries.get(key);
    return entry
      ? { data: structuredClone(entry.value), etag: entry.etag, metadata: {} }
      : null;
  }

  async setJSON(key, value, options) {
    this.writes.push({ key, value: structuredClone(value), options: structuredClone(options) });
    if (this.writeError) throw this.writeError;
    if (this.forcedConflicts > 0) {
      this.forcedConflicts -= 1;
      return { modified: false };
    }
    const current = this.entries.get(key);
    if (options.onlyIfNew === true && current) return { modified: false };
    if (typeof options.onlyIfMatch === "string" && current?.etag !== options.onlyIfMatch) {
      return { modified: false };
    }
    if (typeof options.onlyIfMatch === "string" && !current) return { modified: false };
    const etag = `"fake-${this.nextETag++}"`;
    this.entries.set(key, { value: structuredClone(value), etag });
    return { modified: true, etag };
  }
}

class BarrierStore extends FakeStore {
  constructor() {
    super();
    this.barrierReads = 0;
    this.releaseBarrier = null;
    this.barrier = new Promise((resolve) => { this.releaseBarrier = resolve; });
  }

  async getWithMetadata(key, options) {
    const snapshot = await super.getWithMetadata(key, options);
    if (this.barrierReads < 2) {
      this.barrierReads += 1;
      if (this.barrierReads === 2) this.releaseBarrier();
      await this.barrier;
    }
    return snapshot;
  }
}

class FixedReadResultStore {
  constructor(result) {
    this.result = result;
    this.reads = [];
  }

  async getWithMetadata(key, options) {
    this.reads.push({ key, options: structuredClone(options) });
    return this.result;
  }
}

class FixedWriteResultStore extends FakeStore {
  constructor(result) {
    super();
    this.result = result;
  }

  async setJSON(key, value, options) {
    this.writes.push({ key, value: structuredClone(value), options: structuredClone(options) });
    return this.result;
  }
}

assert.equal(assertKey("threads/4b7d2a/"), "threads/4b7d2a/");
assert.equal(assertKey("%2flowercase-is-not-the-literal-prefix"), "%2flowercase-is-not-the-literal-prefix");
const key600 = "é".repeat(300);
const key601 = key600 + "x";
assert.equal(Buffer.byteLength(key600, "utf8"), 600);
assert.equal(Buffer.byteLength(key601, "utf8"), 601);
assert.equal(assertKey(key600), key600);
expectStoreError(() => assertKey(key601), "invalid-key", 400);
assert.equal(assertDocId("4b7d2a"), "4b7d2a");
for (const key of ["", "/bad", "%2Fbad", null]) {
  expectStoreError(() => assertKey(key), "invalid-key", 400);
}
const invalidKeyStore = new FakeStore();
let invalidKeyApplyCalls = 0;
await expectStoreRejection(
  read(invalidKeyStore, "/bad", { v: 1 }),
  "invalid-key",
  400,
);
await expectStoreRejection(
  mutate(invalidKeyStore, "%2Fbad", { v: 1 }, (draft) => {
    invalidKeyApplyCalls += 1;
    return draft;
  }),
  "invalid-key",
  400,
);
assert.equal(invalidKeyApplyCalls, 0);
assert.equal(invalidKeyStore.reads.length, 0);
assert.equal(invalidKeyStore.writes.length, 0);
for (const docId of ["g7m2q4", "4B7D2A", "4b7d2", "example", "4b7d2a/"]) {
  expectStoreError(() => assertDocId(docId), "invalid-key", 400);
}
assert.equal(threadPrefix("4b7d2a"), "threads/4b7d2a/");
assert.equal(threadKey("4b7d2a", "t_m8x2k1_4f7a9c31"), "threads/4b7d2a/t_m8x2k1_4f7a9c31.json");
assert.equal(eventPrefix("4b7d2a"), "events/4b7d2a/");
assert.equal(eventPrefix("4b7d2a", "2026-09"), "events/4b7d2a/2026-09/");
assert.equal(
  eventKey("4b7d2a", "2026-09-02T18:04:11.221Z", "1788372251221-4f2a9c"),
  "events/4b7d2a/2026-09/1788372251221-4f2a9c.json",
);
assert.equal(editPrefix("4b7d2a"), "edits/4b7d2a/");
assert.equal(editKey("4b7d2a", "a3f19c2b"), "edits/4b7d2a/a3f19c2b.json");
assert.equal(suggestionPrefix("4b7d2a"), "suggest/4b7d2a/");
assert.equal(suggestionPrefix("4b7d2a", "a3f19c2b"), "suggest/4b7d2a/a3f19c2b/");
assert.equal(
  suggestionKey("4b7d2a", "a3f19c2b", "s_m8x2k1_4f7a9c31"),
  "suggest/4b7d2a/a3f19c2b/s_m8x2k1_4f7a9c31.json",
);
for (const call of [
  () => threadKey("4b7d2a", "thread/one"),
  () => eventPrefix("4b7d2a", "2026-13"),
  () => eventKey("4b7d2a", "2026-09-02T18:04:11Z", "1788372251221-4f2a9c"),
  () => eventKey("4b7d2a", "2026-09-02T18:04:11.221Z", "1788372251220-4f2a9c"),
  () => editKey("4b7d2a", "a3f19c2b/next"),
  () => suggestionKey("4b7d2a", "a3f19c2b", "s_bad/path"),
]) {
  expectStoreError(call, "invalid-key", 400);
}
console.log("PASS  exports and key contract");

const v1 = { v: 1, value: "invented" };
assert.equal(upgrade(v1), v1);
const nullPrototypeV1 = Object.assign(Object.create(null), { v: 1, value: "invented" });
assert.equal(upgrade(nullPrototypeV1), nullPrototypeV1);
const nullPrototypeNested = Object.assign(Object.create(null), {
  safe: [null, true, false, "invented", 0, 17.5, { nested: [] }],
});
const recursivelyValid = { v: 1, nested: nullPrototypeNested };
assert.equal(upgrade(recursivelyValid), recursivelyValid);
const inheritedVersion = Object.create({ v: 1 });
inheritedVersion.value = "invented inherited version";
for (const value of [
  undefined, null, false, 17, "record", [], {}, inheritedVersion, { v: "1" }, { v: 1.5 },
]) {
  expectStoreError(() => upgrade(value), "invalid-record", 500);
}
const getterRecord = { v: 1 };
let getterCalls = 0;
Object.defineProperty(getterRecord, "secret", {
  enumerable: true,
  get() { getterCalls += 1; return "must-not-run"; },
});
const setterRecord = { v: 1 };
Object.defineProperty(setterRecord, "secret", {
  enumerable: true,
  set(_value) { assert.fail("setter must not run"); },
});
const nonEnumerableRecord = { v: 1 };
Object.defineProperty(nonEnumerableRecord, "secret", {
  value: "invented", enumerable: false,
});
const symbolKeyRecord = { v: 1 };
symbolKeyRecord[Symbol("invented-key")] = "invented";
const nonEnumerableVersion = {};
Object.defineProperty(nonEnumerableVersion, "v", { value: 1, enumerable: false });
const sparse = [];
sparse.length = 1;
const extended = [];
extended.extra = true;
const hiddenExtended = [];
Object.defineProperty(hiddenExtended, "extra", { value: true, enumerable: false });
const accessorArray = [];
Object.defineProperty(accessorArray, "0", {
  enumerable: true,
  get() { getterCalls += 1; return "must-not-run"; },
});
accessorArray.length = 1;
const cyclic = { v: 1 };
cyclic.self = cyclic;
const shared = { marker: "invented" };
class InventedRecord { constructor() { this.value = "invented"; } }
const customPrototype = Object.assign(Object.create({ inherited: true }), { value: "invented" });
for (const value of [
  { v: 1, nested: undefined },
  { v: 1, nested: Number.NaN },
  { v: 1, nested: Infinity },
  { v: 1, nested: -Infinity },
  { v: 1, nested: -0 },
  { v: 1, nested: 1n },
  { v: 1, nested: Symbol("invented") },
  { v: 1, nested() {} },
  { v: 1, nested: new Date("2026-09-03T00:00:00.000Z") },
  { v: 1, nested: new Map([["invented", true]]) },
  { v: 1, nested: new Set(["invented"]) },
  { v: 1, nested: new Uint8Array([1, 2]) },
  { v: 1, nested: new InventedRecord() },
  { v: 1, nested: customPrototype },
  { v: 1, nested: [undefined] },
  { v: 1, nested: sparse },
  { v: 1, nested: extended },
  { v: 1, nested: hiddenExtended },
  { v: 1, nested: accessorArray },
  cyclic,
  { v: 1, first: shared, second: shared },
  getterRecord,
  setterRecord,
  nonEnumerableRecord,
  symbolKeyRecord,
  nonEnumerableVersion,
]) {
  expectStoreError(() => upgrade(value), "invalid-record", 500);
}
assert.equal(getterCalls, 0, "record validation must inspect descriptors, not invoke accessors");
expectStoreError(() => upgrade({ v: 2 }), "unsupported-version", 500);

const readStore = new FakeStore();
const fallback = { v: 1, count: 0 };
const missing = await read(readStore, "threads/4b7d2a/missing.json", fallback);
assert.deepEqual(missing, { value: fallback, etag: null });
assert.notEqual(missing.value, fallback);
missing.value.count = 9;
assert.equal(fallback.count, 0);
readStore.seed("threads/4b7d2a/present.json", { v: 1, count: 2 }, 'W/"opaque"');
assert.deepEqual(await read(readStore, "threads/4b7d2a/present.json"), {
  value: { v: 1, count: 2 },
  etag: 'W/"opaque"',
});
assert.ok(readStore.reads.every(({ options }) =>
  options.type === "json" && options.consistency === "strong"));

for (const initial of [
  [], "record", {}, { v: "1" }, { v: 1.5 }, { v: 1, nested: undefined },
  { v: 1, nested: new Date("2026-09-03T00:00:00.000Z") },
]) {
  const malformedDefaultStore = new FakeStore();
  const key = "threads/4b7d2a/malformed-default.json";
  malformedDefaultStore.seed(key, { v: 1, present: true });
  await expectStoreRejection(
    read(malformedDefaultStore, key, initial),
    "invalid-record",
    500,
  );
  assert.equal(malformedDefaultStore.reads.length, 0);
  assert.equal(malformedDefaultStore.writes.length, 0);
}
const unsupportedDefaultStore = new FakeStore();
unsupportedDefaultStore.seed(
  "threads/4b7d2a/unsupported-default.json",
  { v: 1, present: true },
);
await expectStoreRejection(
  read(unsupportedDefaultStore, "threads/4b7d2a/unsupported-default.json", { v: 2 }),
  "unsupported-version",
  500,
);
assert.equal(unsupportedDefaultStore.reads.length, 0);

const malformedReadResults = [
  undefined,
  false,
  17,
  "result",
  [],
  {},
  { etag: '"orphan"' },
  { data: { v: 1 } },
  { data: { v: 1 }, etag: null },
  { data: { v: 1 }, etag: 17 },
  { data: { v: 1 }, etag: "" },
  { data: null, etag: '"bad-data"' },
  { data: [], etag: '"bad-data"' },
  { data: {}, etag: '"bad-data"' },
  { data: { v: 1, nested: undefined }, etag: '"nested-undefined"' },
  { data: { v: 1, nested: new Date("2026-09-03T00:00:00.000Z") }, etag: '"date"' },
];
for (const result of malformedReadResults) {
  const malformedResultStore = new FixedReadResultStore(result);
  await expectStoreRejection(
    read(malformedResultStore, "threads/4b7d2a/malformed-result.json", { v: 1 }),
    "invalid-record",
    500,
  );
  assert.equal(malformedResultStore.reads.length, 1);
}

const noETagStore = new FakeStore();
noETagStore.seed("threads/4b7d2a/no-etag.json", { v: 1 }, null);
await expectStoreRejection(
  read(noETagStore, "threads/4b7d2a/no-etag.json"),
  "invalid-record",
  500,
);
const invalidJSONStore = new FakeStore();
const invalidJSONCause = new SyntaxError("invented malformed JSON");
invalidJSONStore.readError = invalidJSONCause;
await expectStoreRejection(
  read(invalidJSONStore, "threads/4b7d2a/invalid-json.json"),
  "invalid-record",
  500,
  invalidJSONCause,
);
assert.equal(invalidJSONStore.reads.length, 1);
assert.equal(invalidJSONStore.writes.length, 0);
const readFailure = new FakeStore();
const readCause = new Error("provider detail must stay in cause");
readFailure.readError = readCause;
await expectStoreRejection(
  read(readFailure, "threads/4b7d2a/read-error.json"),
  "unavailable",
  503,
  readCause,
);
assert.equal(readFailure.reads.length, 1);
assert.equal(readFailure.writes.length, 0);
console.log("PASS  version and read envelope contract");

const mutationStore = new FakeStore();
const mutableKey = "threads/4b7d2a/t_m8x2k1_4f7a9c31.json";
for (const invalidApply of [undefined, null, {}, "apply"]) {
  const invalidApplyStore = new FakeStore();
  await expectStoreRejection(
    mutate(invalidApplyStore, mutableKey, { v: 1 }, invalidApply),
    "invalid-record",
    500,
  );
  assert.equal(invalidApplyStore.reads.length, 0);
  assert.equal(invalidApplyStore.writes.length, 0);
}
for (const [invalidInitial, expectedCode] of [
  [{}, "invalid-record"],
  [{ v: 2 }, "unsupported-version"],
  [{ v: 1, nested: undefined }, "invalid-record"],
  [{ v: 1, nested: new Date("2026-09-03T00:00:00.000Z") }, "invalid-record"],
]) {
  const invalidInitialStore = new FakeStore();
  invalidInitialStore.seed(mutableKey, { v: 1, present: true });
  let applyCalls = 0;
  await assert.rejects(
    mutate(invalidInitialStore, mutableKey, invalidInitial, (draft) => {
      applyCalls += 1;
      return draft;
    }),
    (error) => error instanceof StoreError && error.code === expectedCode &&
      error.message === expectedMessages.get(expectedCode),
  );
  assert.equal(applyCalls, 0);
  assert.equal(invalidInitialStore.reads.length, 0);
  assert.equal(invalidInitialStore.writes.length, 0);
}

const missingNoopStore = new FakeStore();
const missingNoopInitial = { v: 1, comments: [] };
let missingNoopDraft;
const missingNoop = await mutate(
  missingNoopStore,
  mutableKey,
  missingNoopInitial,
  (draft) => {
    missingNoopDraft = draft;
    draft.comments.push("must not leak");
    return null;
  },
);
assert.deepEqual(missingNoop, { value: { v: 1, comments: [] }, etag: null, changed: false });
assert.notEqual(missingNoop.value, missingNoopInitial);
assert.notEqual(missingNoopDraft, missingNoop.value);
assert.deepEqual(missingNoopInitial, { v: 1, comments: [] });
assert.equal(missingNoopStore.reads.length, 1);
assert.equal(missingNoopStore.writes.length, 0);

const weakETag = 'W/"opaque-before"';
mutationStore.seed(mutableKey, { v: 1, comments: [] }, weakETag);
const noop = await mutate(mutationStore, mutableKey, null, (draft) => {
  draft.comments.push("must not leak");
  return null;
});
assert.deepEqual(noop, { value: { v: 1, comments: [] }, etag: weakETag, changed: false });
assert.equal(mutationStore.writes.length, 0);
const updated = await mutate(mutationStore, mutableKey, null, (draft) => {
  draft.comments.push("invented reply");
  return draft;
});
assert.equal(updated.changed, true);
assert.deepEqual(mutationStore.writes.at(-1).options, { onlyIfMatch: weakETag });
const created = await mutate(
  mutationStore,
  "threads/4b7d2a/t_m8x2k2_5a8b0d42.json",
  { v: 1, comments: [] },
  (draft) => draft,
);
assert.equal(created.changed, true);
assert.deepEqual(mutationStore.writes.at(-1).options, { onlyIfNew: true });

for (const existing of [false, true]) {
  const omittedETagStore = new FixedWriteResultStore({ modified: true });
  if (existing) omittedETagStore.seed(mutableKey, { v: 1, count: 0 }, '"before"');
  let applyCalls = 0;
  await expectStoreRejection(
    mutate(omittedETagStore, mutableKey, { v: 1, count: 0 }, (draft) => {
      applyCalls += 1;
      draft.count += 1;
      return draft;
    }),
    "invalid-record",
    500,
  );
  assert.equal(applyCalls, 1);
  assert.equal(omittedETagStore.reads.length, 1);
  assert.equal(omittedETagStore.writes.length, 1);
  assert.deepEqual(omittedETagStore.writes[0].options, existing
    ? { onlyIfMatch: '"before"' }
    : { onlyIfNew: true });
}

const malformedWriteResults = [
  undefined,
  null,
  false,
  17,
  "result",
  [],
  {},
  Object.create({ modified: true, etag: '"inherited"' }),
  { modified: null },
  { modified: "true", etag: '"wrong-type"' },
  { modified: true, etag: null },
  { modified: true, etag: 17 },
  { modified: true, etag: "" },
];
for (const result of malformedWriteResults) {
  const malformedResultStore = new FixedWriteResultStore(result);
  malformedResultStore.seed(mutableKey, { v: 1, count: 0 }, '"before"');
  let applyCalls = 0;
  await expectStoreRejection(
    mutate(malformedResultStore, mutableKey, null, (draft) => {
      applyCalls += 1;
      draft.count += 1;
      return draft;
    }),
    "invalid-record",
    500,
  );
  assert.equal(applyCalls, 1);
  assert.equal(malformedResultStore.reads.length, 1);
  assert.equal(malformedResultStore.writes.length, 1);
}

const domainError = new Error("invented domain decision");
const domainStore = new FakeStore();
domainStore.seed(mutableKey, { v: 1 });
await assert.rejects(mutate(domainStore, mutableKey, null, () => { throw domainError; }),
  (error) => error === domainError);
assert.equal(domainStore.writes.length, 0);
await expectStoreRejection(
  mutate(domainStore, mutableKey, null, async (draft) => draft),
  "invalid-record",
  500,
);
let thenCalls = 0;
const inventedThenable = {
  v: 1,
  then() { thenCalls += 1; assert.fail("thenable must not be awaited"); },
};
const accessorThenable = { v: 1 };
Object.defineProperty(accessorThenable, "then", {
  enumerable: true,
  get() { thenCalls += 1; assert.fail("then accessor must not run"); },
});
for (const invalidNext of [
  Promise.resolve({ v: 1 }),
  inventedThenable,
  accessorThenable,
  { v: 1, nested: undefined },
  { v: 1, nested: new Date("2026-09-03T00:00:00.000Z") },
  getterRecord,
  setterRecord,
  cyclic,
  { v: 1, first: shared, second: shared },
]) {
  const invalidNextStore = new FakeStore();
  invalidNextStore.seed(mutableKey, { v: 1, count: 0 }, '"before"');
  await expectStoreRejection(
    mutate(invalidNextStore, mutableKey, null, () => invalidNext),
    "invalid-record",
    500,
  );
  assert.equal(invalidNextStore.reads.length, 1);
  assert.equal(invalidNextStore.writes.length, 0);
}
assert.equal(thenCalls, 0);
const unsupportedNextStore = new FakeStore();
unsupportedNextStore.seed(mutableKey, { v: 1 }, '"before"');
await expectStoreRejection(
  mutate(unsupportedNextStore, mutableKey, null, () => ({ v: 2 })),
  "unsupported-version",
  500,
);
assert.equal(unsupportedNextStore.reads.length, 1);
assert.equal(unsupportedNextStore.writes.length, 0);

const writeFailure = new FakeStore();
writeFailure.seed(mutableKey, { v: 1, count: 0 });
const writeCause = new Error("ambiguous provider failure");
writeFailure.writeError = writeCause;
let writeApplyCalls = 0;
await expectStoreRejection(
  mutate(writeFailure, mutableKey, null, (draft) => {
    writeApplyCalls += 1;
    draft.count += 1;
    return draft;
  }),
  "unavailable",
  503,
  writeCause,
);
assert.equal(writeApplyCalls, 1);
assert.equal(writeFailure.reads.length, 1);
assert.equal(writeFailure.writes.length, 1);
console.log("PASS  guarded mutation and failure contract");

const conflictStore = new FakeStore();
conflictStore.seed(mutableKey, { v: 1, count: 0 });
conflictStore.forcedConflicts = 6;
let conflictApplyCalls = 0;
const waits = [];
const originalRandom = Math.random;
const originalSetTimeout = globalThis.setTimeout;
Math.random = () => 0.5;
globalThis.setTimeout = (callback, milliseconds) => {
  waits.push(milliseconds);
  queueMicrotask(callback);
  return 0;
};
try {
  await expectStoreRejection(
    mutate(conflictStore, mutableKey, null, (draft) => {
      conflictApplyCalls += 1;
      draft.count += 1;
      return draft;
    }),
    "conflict",
    409,
  );
} finally {
  Math.random = originalRandom;
  globalThis.setTimeout = originalSetTimeout;
}
assert.equal(conflictApplyCalls, 6);
assert.equal(conflictStore.reads.length, 6);
assert.equal(conflictStore.writes.length, 6);
assert.deepEqual(waits, [40, 60, 100, 180, 340]);
console.log("PASS  six-attempt backoff contract");

const concurrentStore = new BarrierStore();
concurrentStore.seed(mutableKey, { v: 1, comments: [] }, '"shared"');
const callbackCounts = [0, 0];
await Promise.all([
  mutate(concurrentStore, mutableKey, null, (draft) => {
    callbackCounts[0] += 1;
    draft.comments.push("reply-a");
    return draft;
  }),
  mutate(concurrentStore, mutableKey, null, (draft) => {
    callbackCounts[1] += 1;
    draft.comments.push("reply-b");
    return draft;
  }),
]);
const concurrentFinal = await read(concurrentStore, mutableKey);
assert.deepEqual([...concurrentFinal.value.comments].sort(), ["reply-a", "reply-b"]);
assert.deepEqual([...callbackCounts].sort(), [1, 2]);
assert.equal(concurrentStore.writes.length, 3);
console.log("PASS  two concurrent writes land exactly once");

const server = new BlobsServer({
  directory: process.env.P2B_BLOB_DIR,
  token: "p2b-local-token",
  logger: () => {},
});
const { port } = await server.start();
const origin = `http://127.0.0.1:${port}`;
const localKey = threadKey("4b7d2a", "t_m8x2k3_6b9c1e53");
try {
  setEnvironmentContext({
    edgeURL: origin,
    siteID: "p2b-local-site",
    token: "p2b-local-token",
  });
  await assert.rejects(docState().get(localKey, { type: "json" }),
    (error) => error?.name === "BlobsConsistencyError");

  setEnvironmentContext({
    edgeURL: origin,
    uncachedEdgeURL: origin,
    siteID: "p2b-local-site",
    token: "p2b-local-token",
  });
  const localStore = docState();
  const first = await localStore.setJSON(localKey, { v: 1, comments: ["first"] }, { onlyIfNew: true });
  assert.equal(first.modified, true);
  assert.equal(typeof first.etag, "string");
  const duplicate = await localStore.setJSON(localKey, { v: 1, comments: ["replacement"] }, { onlyIfNew: true });
  assert.deepEqual(duplicate, { modified: false });
  assert.deepEqual((await read(localStore, localKey)).value, { v: 1, comments: ["first"] });
  await mutate(localStore, localKey, null, (draft) => {
    draft.comments.push("second");
    return draft;
  });
  assert.deepEqual((await read(localStore, localKey)).value, { v: 1, comments: ["first", "second"] });
  await localStore.delete(localKey);
  assert.equal(await localStore.get(localKey, { type: "json", consistency: "strong" }), null);
} finally {
  await server.stop();
}
console.log("PASS  real @netlify/blobs 11.0.2 local contract");
NODE
FIXTURE
```

Expected: exit `0` and exactly these six lines, in order:

```text
PASS  exports and key contract
PASS  version and read envelope contract
PASS  guarded mutation and failure contract
PASS  six-attempt backoff contract
PASS  two concurrent writes land exactly once
PASS  real @netlify/blobs 11.0.2 local contract
```

The concurrency test is deterministic: both first reads are held at a barrier, both callbacks receive the same ETag snapshot, one `onlyIfMatch` wins, and the loser re-reads and reapplies once. The one retained anchor owns the network-dependent install, installed-version check, factory assertion, in-process filesystem-backed server's `start()`/`stop()`, and every contract assertion as one command group. The group has a 480-second command deadline; cleanup then follows the exact finite TERM-to-KILL, leader-reap, stream-close, group-disappearance, and bounded root-deletion contract proved in step 1. No Netlify site, account, token, network store, production data, or persistent fixture is involved.

The preceding groups also prove the exact 600-byte accepted and 601-byte rejected UTF-8 key boundary; reject malformed and unsupported miss defaults before any provider call, even when the key would have hit; reject a non-function callback before any read; preserve a cloned default during a missing-record no-op; and reject every declared malformed resolved read/write shape. Their recursive matrices cover null-prototype objects, accessors, non-enumerable and symbol keys, sparse or extended arrays, cycles, repeated identity, unsupported built-ins/prototypes, non-finite numbers, negative zero, and every non-JSON primitive. Both create and update paths treat `modified: true` without an ETag as an ambiguous landed write, return `invalid-record`, and make no retry.

### 3. Confirm isolated cleanup and run repository gates

Continue in the same shell:

```bash
set -euo pipefail

test ! -e package-lock.json
test ! -e node_modules
test ! -e .netlify
P2B_TMP_PARENT="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
test -z "$(find "$P2B_TMP_PARENT" -maxdepth 1 \( \
  -name 'p2-b-store.*' -o -name 'p2-b-owner-evidence.*' -o \
  -name 'p2-b-remediation.*' \) -print -quit)"

templates/check-dist
npm --prefix templates/docbuild run check
scripts/scrub-check.sh docs/tickets/P2-B.md netlify/lib/store.mjs

node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const fields = execFileSync(
  "git",
  ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
  { encoding: "utf8" },
).split("\0");
if (fields.at(-1) === "") fields.pop();

const changedPaths = [];
for (let index = 0; index < fields.length; index += 1) {
  const entry = fields[index];
  assert.match(entry, /^.. /, `unexpected git status entry: ${entry}`);
  const status = entry.slice(0, 2);
  changedPaths.push(entry.slice(3));
  if (/[RC]/.test(status)) {
    index += 1;
    assert.ok(fields[index], "rename/copy entry is missing its source path");
    changedPaths.push(fields[index]);
  }
}

const implementationPaths = [...new Set(changedPaths)]
  .filter((path) => !path.startsWith("docs/tickets/"))
  .sort();
assert.deepEqual(implementationPaths, ["netlify/lib/store.mjs"]);
console.log("PASS  P2-B changed no implementation path except netlify/lib/store.mjs");
NODE
test -z "$(git status --short -- package-lock.json node_modules .netlify)"
echo "PASS  P2-B fixture cleaned and repository gates passed"
```

Expected: every command exits `0`; the exact fixture, lifecycle-evidence, and remediation-root prefixes are absent below the resolved temporary parent; `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`; typecheck emits no diagnostics; scrub-check ends with `PASS  no denied term and no warning.`; the ownership check mechanically rejects every changed path outside `docs/tickets/**` except `netlify/lib/store.mjs`; and the final line is exactly `PASS  P2-B fixture cleaned and repository gates passed`. The coordination branch may also contain `docs/tickets/P2-B.md` and other agents' separately owned ticket documents; P2-B contributes only `netlify/lib/store.mjs` to the implementation diff.

## Failure modes

### Handled

- Missing key: `read()` returns the validated cloned default and `etag: null`; callers can distinguish absence without an exception.
- Invalid key or domain segment: a key builder throws 400 `invalid-key` before any store call.
- Malformed JSON, missing/malformed version, unsupported version, or a malformed resolved read/write envelope: fail closed with a 500 storage error and do not reinterpret the result as a miss, conflict, or successful unguarded write.
- Malformed or recursively unsafe default, unsupported default version, or non-function callback: fail with the documented 500 storage error before any provider read, including when the key would otherwise have hit.
- Successful provider result without a non-empty ETag: fail with `invalid-record` after one guarded write and do not retry an outcome that may already have landed.
- Concurrent create/update: conditional rejection reruns the callback against the newer record; no caller writes its stale draft.
- Six consecutive races: return the stable 409 error after five waits and six total attempts.
- Callback no-op: return the current value and ETag without a write, retry, or timestamp mutation.
- Callback domain error: preserve it exactly so the endpoint can apply its own 400/403/404/409 response contract.
- JSON-decoding `SyntaxError`: return 500 `invalid-record`; for any distinct provider/network exception, return 503 with the provider error retained only as `cause` and do not retry an ambiguous outcome.
- Duplicate append-only/create-only key: `onlyIfNew` yields `modified: false`; the record that already exists is unchanged.
- Attempted async callback: reject before `setJSON`; retry loops cannot safely replay hidden asynchronous effects.
- Shared default or stale object mutation: clone both a miss default and the current record before the callback receives them.
- Fixture interruption or deadline: the retained anchor converts natural child HUP/INT/TERM/KILL to 129/130/143/137, keeps the first directly received HUP/INT/TERM authoritative through final cleanup, and uses finite TERM-to-KILL containment before release.
- Unproved fixture ownership, reaping, group disappearance, evidence publication, or bounded deletion: fail closed, retain guarded roots plus mode-`0600` actionable evidence, and print the exact PID/PGID/root locator for manual remediation; never recursively delete across a possibly live group.

### Deliberately not handled

- Request replay after a successful function invocation, function crash, or lost HTTP response. Endpoint-specific idempotency owns that boundary.
- Atomicity across a state record and an audit event. Write state first; a crash may omit the event but must not discard state.
- Merge semantics for two edits to the same block. The block hash remains authoritative and returns a domain 409.
- Domain validation, maximum body sizes, permissions, actor derivation, notification delivery, or HTTP JSON error shapes.
- Eventual-consistency behavior of `list()`. Consumers must not relist to construct a just-written response.
- Automatic migration of unversioned records or unknown future versions.
- Production load testing, provider outage simulation, distributed locks, or a transaction layer.

## Settled decisions

- Use one site-wide Netlify Blobs store named `doc-state`, with strong consistency and one blob per record. Do not add Netlify DB, another store, a shared per-document array, or a deploy-scoped store.
- The permanent six-character lowercase hexadecimal `doc.json` ID is the storage identity. Never use a slug, alias, directory name, route, or client-supplied path.
- Mutable records use ETag compare-and-swap. Existing records use `onlyIfMatch`; absent records use `onlyIfNew`. Never use last-write-wins for a mutable record.
- The CAS loop has six attempts, exponential base delay plus `[0, 40)` ms jitter, and retries only a resolved `modified: false` result.
- Append-only events and immutable suggestions use `onlyIfNew` directly and are never rewritten. Key existence carries suggestion state; P2-B does not add a status field.
- Every stored record carries `v: 1` and crosses one `upgrade()` gate. There is no eager migration job and no unversioned fallback.
- The helper never invents domain fields. In particular, it does not carry the superseded research prototype's top-level `updatedAt` mutation into the ruling thread shape.
- There is no cross-blob transaction. A state change lands before its audit event.
- Access-specific builders remain in P2-G, but P2-G consumes P2-B's store-factory, permanent-ID, final-key, read, upgrade, and error contracts for direct create-only writes. P4-J later imports `mutate()` for mutable access amendments.
- Both standalone and repository-backed modes use the same state keys and helper. Realtime remains outside Blobs, and presence is never persisted.
- `@netlify/blobs` remains pinned at 11.0.2 by P1-C even if a later package exists. Changing the pin or package API is not P2-B work.
- The standalone verification owns its complete install/server/assertion workload with one retained detached anchor. Command start is gated on nonce-verified positive PID/PGID ownership plus active private evidence; root deletion follows only proved leader reaping, stream closure, and process-group disappearance.

## Assumptions and open questions

- **Assumption (non-blocking):** the final failed conditional write throws immediately instead of sleeping, because the documented backoff exists only before a retry. This preserves six attempts while avoiding a delay with no following work.
- **Assumption (non-blocking):** `eventKey()` enforces equality between the event ID's millisecond prefix and `Date.parse(timestamp)`. The ruling model defines both from the same event time; rejecting disagreement prevents a record body from sorting into the wrong month/key chronology.
- **Assumption (non-blocking):** malformed defaults and callback results use the same `invalid-record` code as malformed stored JSON. All are programmer/data-integrity failures with the same fail-closed 500 boundary, and no endpoint should expose the internal distinction.
- **Assumption (non-blocking):** `assertKey()` mirrors the pinned 11.0.2 client by rejecting the literal, case-sensitive `%2F` prefix in addition to `/`; lowercase `%2f` remains valid at this generic boundary. Domain builders remain stricter and reject separator injection inside their individual segments.
- **Open question (does not block P2-B):** the ruling plan does not confirm whether `list()` honors store-level strong consistency. No P2-B or downstream contract may depend on it; return a successful write directly and treat later list refresh as independent.

## References

- `docs/research/00-integration-plan.md` §1.1, **The state store** — ruling store, key layout, one-blob-per-record rule, strong consistency, six-attempt CAS, append-only writes, idempotency order, and the `list()` caveat.
- `docs/research/00-integration-plan.md` §2, **The shared data model** — version-1 record envelope, server-owned actors, timestamps, and thread/event/edit shapes.
- `docs/research/00-integration-plan.md` §4.4, **Phase 2** — P2-B's one-file surface, dependency on P1-C, and two-concurrent-write verification.
- `docs/research/00-integration-plan.md` §4.5 and §4.7 — P3-A/P3-B/P3-E and P2-G/P4-O downstream dependencies and ownership boundaries.
- `docs/tickets/P1-A.md`, **Interface contract** — normative `^[0-9a-f]{6}$` permanent document ID, which corrects the ruling plan's non-hex illustrative value.
- `docs/tickets/P1-C.md`, **Root `package.json`** — exact Node/ESM runtime and `@netlify/blobs@11.0.2` predecessor contract.
- `docs/research/03-state-storage.md` §2.2–§2.6 and §5.2 — primary API investigation and the six-attempt prototype. Its shared-document blobs, history keys, domain defaults, and implicit `updatedAt` write are superseded by the ruling plan and are not copied.
- `docs/research/04-comments-and-discussion.md` §6–§7.3 — one-blob-per-thread layout, ETag mutation rationale, and concurrent-reply behavior. Its three-attempt loop and separate store name are superseded.
- [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — official `getStore`, strong consistency, `getWithMetadata`, conditional `setJSON`, result shapes, local development, limits, and last-write-wins behavior; checked 2026-09-02.
- [`@netlify/blobs` 11.0.2 package](https://www.npmjs.com/package/@netlify/blobs/v/11.0.2) and [pinned package types](https://unpkg.com/@netlify/blobs@11.0.2/dist/main.d.ts) — exact engine requirement, overloads, `Store` methods, mutually exclusive conditional-write options, and optional success ETag.
- [`@netlify/blobs` 11.0.2 server types](https://unpkg.com/@netlify/blobs@11.0.2/dist/server.d.ts) — official filesystem-backed `BlobsServer` test seam and cleanup API.
- [`@netlify/blobs` changelog](https://github.com/netlify/primitives/blob/main/packages/blobs/CHANGELOG.md#1102-2026-08-19) — 11.0.2 release record and the 11.0.0 Node 22.12 breaking requirement.
