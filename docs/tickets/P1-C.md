# P1-C — The identity contract

## Outcome

The repository has one pinned Functions package manifest, one server-side identity and same-origin contract, and a Functions v2 `GET /api/session` endpoint that returns the Phase 1 normalized session shape.

## Context

Every later API needs the same trustworthy answer to “who is calling?” and every mutating API needs the same CSRF boundary. This ticket establishes those contracts once, using Netlify Identity's request-scoped runtime context, so later functions do not read client claims, request bodies, or legacy `clientContext` directly.

This is deliberately the Phase 1 contract. P2-H later separates identity from document authorization by amending `identify()`, and P3-H later makes `/api/session` document-aware; P1-C must leave those changes for their owning tickets.

## Scope

### In scope

- Create the repository-root `package.json` exactly as specified below. It is the single dependency manifest for all Netlify Functions work.
- Create `netlify/lib/identity.mjs` and export exactly `identify(req)` and `requireOrigin(req)`.
- Normalize Netlify Identity users into the temporary Phase 1 identity/capability shape documented below.
- Enforce exact same-origin comparison through `verifyRequestOrigin(req)` and normalize every origin failure to the documented 403 response.
- Create a Functions v2 handler for `GET /api/session` at `/api/session`.
- Return only the public six-field session body, never `docs` or raw Identity metadata.
- Keep the authoring/build path independent of the new root package: dependencies are server-side only.

### Out of scope

- The edge gate, login page, login function, and logout function. P2-A owns them.
- The Blob store helper. P2-B owns it, although its dependency is pinned now.
- The client session probe, `data-session` reveal rules, and `session` browser event. P2-C owns them.
- Parsing `DOC_OWNERS`, resolving a document role, or implementing any access/grant storage. P2-G owns `netlify/lib/access.mjs`.
- Splitting identity from authorization. P2-H amends `netlify/lib/identity.mjs` to remove `roles`, `canComment`, `canEdit`, and `docs`, and to add `isOrg`.
- Accepting `?doc=`, calling `resolveRole()`, returning document roles/capabilities, or creating `GET /api/access`. P3-H amends `netlify/functions/session.mjs` and creates the access endpoint.
- Enforcing document permissions in comments, edits, suggestions, or any other write path.
- Adding a root lockfile, test file, npm script, TypeScript configuration, alternate identity provider, OAuth flow, self-registration, password-reset UI, or browser identity library.
- Editing `netlify.toml`; P1-E owns it. P1-C does not depend on P1-E and must not absorb its configuration work.

## Interface contract

### Root `package.json`

Create `package.json` with exactly this JSON content and no additional dependency, script, workspace, or metadata keys:

```json
{
  "name": "architecture-docs-functions",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "dependencies": {
    "@netlify/blobs": "11.0.2",
    "@netlify/identity": "2.0.0"
  },
  "devDependencies": {
    "@netlify/functions": "6.0.0"
  }
}
```

All versions are exact, without `^`, `~`, ranges, or tags. Do not create a root `package-lock.json`; the ruling plan owns only this one root package file. `@netlify/blobs` and `@netlify/functions` are pinned here for downstream Functions tickets even though P1-C itself only imports `@netlify/identity`.

P1-C owns the server package/runtime contract only: the root manifest requires Node `>=22.12.0`, and all P1-C code and verification run on the Node 22 line. P1-E exclusively owns `netlify.toml`, including its `[build.environment] NODE_VERSION = "22"` deployment selection. A P1-C implementer must not create or edit `netlify.toml`, set a persistent site environment variable, or wait for P1-E; the authenticated check below uses the operator's local Node 22 runtime and an ephemeral linked fixture. P1-C introduces no application secret and no committed environment file. In particular, `DOC_OWNERS`, `ABLY_API_KEY`, and `DOCS_GITHUB_TOKEN` belong to later tickets.

The Phase 1 organization suffix is the literal reserved sample suffix `@example.com` required by the ruling plan. Define it once in `netlify/lib/identity.mjs`; do not introduce an undocumented environment variable in this ticket.

### `identify(req)`

Export this exact public signature from `netlify/lib/identity.mjs`:

```js
/**
 * @param {Request} req
 * @returns {Promise<null | {
 *   sub: string,
 *   email: string,
 *   name: string,
 *   roles: string[],
 *   canComment: boolean,
 *   canEdit: boolean,
 *   docs: string[]
 * }>}
 */
export async function identify(req)
```

Behavior:

1. Call `getUser()` from `@netlify/identity` with no arguments. The package obtains the verified session from the ambient Netlify Functions v2 request context; `req` remains in this repository's public helper signature for uniform callers and future evolution.
2. If `getUser()` returns `null`, return `null`. `getUser()` is documented never to throw, and `identify()` must also never throw for a missing, expired, invalid, or temporarily degraded session.
3. Read no identity fields except `id`, `email`, `name`, `role`, `roles`, `appMetadata`, and `userMetadata`. Do not inspect `confirmedAt`, `lastSignInAt`, `clientContext`, arbitrary headers, query parameters, or request bodies.
4. Normalize `sub` from `user.id` unchanged.
5. Normalize `email` as `(user.email ?? "").toLowerCase()`. Do not trust or return a client-supplied email.
6. Normalize `name` as `user.name ?? email.split("@")[0]`. The result is always a string, including during the verified-JWT fallback.
7. Read provider roles defensively as `user.roles ?? (user.role ? [user.role] : [])` before applying the Phase 1 classification. Do not forward unrecognized provider roles.
8. If `email.endsWith("@example.com")`, return `roles: ["member"]`, `canComment: true`, `canEdit: true`, and `docs: []`.
9. For every other authenticated user, return `roles: ["guest"]`, `canComment: false`, `canEdit: false`, and `docs` from `user.appMetadata?.docs` when it is an array of strings; otherwise return `docs: []`.
10. Return a fresh plain object containing exactly the seven documented keys. Do not return the raw Identity user, tokens, provider details, timestamps, or metadata objects.

The normalized Phase 1 object is:

```json
{
  "sub": "u_demo_931",
  "email": "avery@example.com",
  "name": "Avery Quill",
  "roles": ["member"],
  "canComment": true,
  "canEdit": true,
  "docs": []
}
```

An invented guest example is:

```json
{
  "sub": "u_demo_482",
  "email": "river@review.invalid",
  "name": "River Vale",
  "roles": ["guest"],
  "canComment": false,
  "canEdit": false,
  "docs": ["d0c123"]
}
```

`roles`, `canComment`, `canEdit`, and `docs` are a temporary Phase 1 compatibility contract, not the final document authorization model. P2-H removes those four fields from `identify()` and adds `isOrg`; P2-G's `resolveRole(docId, user)` then becomes the only authorization decision.

### `requireOrigin(req)`

Export this exact public signature from `netlify/lib/identity.mjs`:

```js
/**
 * @param {Request} req
 * @returns {void}
 * @throws {Response} A normalized 403 response when origin verification fails.
 */
export function requireOrigin(req)
```

Behavior:

- Call `verifyRequestOrigin(req)` from `@netlify/identity` with no `allowedOrigins` override.
- A request passes only when its `Origin` header exactly equals `new URL(req.url).origin`, including scheme, hostname, and explicit port. On success return `undefined` and perform no other work.
- A missing `Origin`, `Origin: null`, a foreign scheme/host/port, or any error from `verifyRequestOrigin()` fails closed.
- Normalize every failure by throwing `new Response("Bad origin", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } })`. Do not leak the rejected origin or the identity library's internal error text.
- The check is unconditional when called; `requireOrigin()` does not inspect the HTTP method. Every POST, PATCH, and DELETE handler must call it before parsing a body, reading identity, or performing other work, then return the thrown `Response` from its handler boundary.
- GET and HEAD handlers do not call `requireOrigin()`. This ticket's session endpoint is read-only and therefore does not call it.

### `GET /api/session`

Create `netlify/functions/session.mjs` as an ECMAScript module with this Functions v2 surface:

```js
export default async function handler(req)
export const config = { path: "/api/session" }
```

The handler contract is exact:

| Request | Status | Required headers | Body |
|---|---:|---|---|
| `GET`, authenticated | `200` | `Cache-Control: private, no-store`; `Content-Type: application/json` | JSON with exactly `sub`, `email`, `name`, `roles`, `canComment`, `canEdit` copied from `identify(req)` |
| `GET`, no valid session | `401` | `Cache-Control: private, no-store` | Empty, zero bytes |
| Any other method, including `HEAD` | `405` | `Allow: GET`; `Cache-Control: private, no-store` | Empty, zero bytes |

The authenticated Phase 1 response shape is:

```json
{
  "sub": "u_demo_931",
  "email": "avery@example.com",
  "name": "Avery Quill",
  "roles": ["member"],
  "canComment": true,
  "canEdit": true
}
```

Do not expose `docs` from `identify()`. Do not accept a `doc` parameter yet. Unknown query parameters are ignored in P1-C; P3-H owns the later `?doc=<docId>` contract and the document-aware response.

### Functions v2 contract

- Use ESM imports and a default Fetch-style handler returning a standard `Response`.
- Export `config.path` exactly as shown. Do not rely on generated redirects or P1-E's future `netlify.toml`.
- Do not export a Lambda-compatible `handler`, use `module.exports`, read `context.clientContext.user`, or accept a v1 event/context pair. A v1 handler silently has no Identity session.
- Only `netlify/lib/identity.mjs` may import or call `getUser()`. `session.mjs` imports `identify()` and never reads the Identity package or `nf_jwt` itself.
- The `nf_jwt` cookie and Identity operator context are runtime-owned. Never log, return, persist, or manually decode a token.

## Files owned

- `package.json` — **new**, created by P1-C; no earlier Build Order ticket owns it.
- `netlify/lib/identity.mjs` — **new**, created by P1-C; P2-H later amends it after P1-C.
- `netlify/functions/session.mjs` — **new**, created by P1-C; P3-H later amends it after P2-G and P2-H.

No other implementation file is owned by P1-C. `docs/tickets/P1-C.md` is this specification, not part of the implementation file surface.

## Dependencies

None. P1-C is a Phase 1 root and can start immediately from the current repository state, in parallel with P1-A, P1-E, and the independent P1-B → P1-D chain because their implementation file surfaces are disjoint. P1-D itself starts only after P1-B provides its required hook; P1-C neither depends on nor delays that chain. Do not add a ticket dependency merely to sequence local runtime verification; P1-E's eventual Netlify configuration is not needed to implement or statically test this contract.

The following are downstream consumers, not prerequisites:

- P2-A needs `identify(req)`/`requireOrigin(req)` semantics and the Functions v2 dependency/runtime contract for the gate and login/logout work.
- P2-B needs the root package's pinned `@netlify/blobs` dependency.
- P2-C needs the initial six-field `/api/session` response.
- P2-F and later mutating APIs need `identify(req)` and the normalized 401/403 boundaries.
- P2-G needs P1-C's normalized person identity as input to `resolveRole()`.
- P2-H needs P1-C's identity module as the amendment base and must perform the identity/authorization split; it may not force P1-C to pre-implement the final shape.
- P3-H needs P1-C's session function as the amendment base and must add `?doc=` plus resolved document capabilities.

## Acceptance criteria

- [ ] `package.json` is byte-for-byte equivalent as JSON to the exact manifest above, with all three versions pinned and no root lockfile added.
- [ ] P1-C code and verification run on Node `>=22.12.0` in the Node 22 line; no P1-C change touches `netlify.toml` or persists `NODE_VERSION` because P1-E owns that deployment configuration.
- [ ] `identify(req)` is the only code path that calls `getUser()` and returns `null` without throwing when no valid session exists.
- [ ] Member and guest identities normalize to exactly the seven-field shapes and rules above; emails are lower case and client-supplied identity data is never read.
- [ ] The verified-JWT degradation path still works because normalization reads only fields available in that fallback.
- [ ] `requireOrigin(req)` passes an exact same-origin request and throws the exact normalized 403 `Response` for missing, null, or foreign origins.
- [ ] Every mutating ticket can call `requireOrigin(req)` before all other work; P1-C itself adds no mutating endpoint.
- [ ] `GET /api/session` returns the exact six-field body and cache header for an authenticated session, 401 with no body when signed out, and 405 with `Allow: GET` for every unsupported method.
- [ ] Neither owned module uses a Lambda v1 export, `clientContext`, manual JWT parsing, a second identity SDK, or browser identity code.
- [ ] No document role, grant, ownership rule, `DOC_OWNERS` parsing, `isOrg`, `resolveRole()`, or `?doc=` behavior is implemented early.
- [ ] No file outside the three owned implementation paths changes.
- [ ] The existing document build remains byte-identical, the builder still typechecks, and the repository scrub gate passes.
- [ ] The authenticated member and guest checks complete against a freshly created, invite-only disposable Netlify Identity site; a missing fixture is a hard acceptance gate, not a reason to waive runtime coverage.
- [ ] GitHub issue #3 retains the exact ticket title and exact two-paragraph canonical-document pointer; its parsed full commit SHA and path resolve through `git show` to bytes identical to `docs/tickets/P1-C.md`.

## Test plan

1. Verify the required local runtime and root manifest exactly, without relying on key order:

   ```bash
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";

   const [major, minor] = process.versions.node.split(".").map(Number);
   assert.equal(major, 22, `expected the Node 22 line, got ${process.version}`);
   assert.ok(minor >= 12, `expected Node >=22.12.0, got ${process.version}`);

   const actual = JSON.parse(readFileSync("package.json", "utf8"));
   const expected = {
     name: "architecture-docs-functions",
     private: true,
     type: "module",
     engines: { node: ">=22.12.0" },
     dependencies: {
       "@netlify/blobs": "11.0.2",
       "@netlify/identity": "2.0.0",
     },
     devDependencies: { "@netlify/functions": "6.0.0" },
   };
   assert.deepEqual(actual, expected);
   console.log("PASS  root Functions package contract");
   NODE
   ```

   Expected: exit `0` and exactly `PASS  root Functions package contract`.

2. Create an isolated local install for steps 2–4. This intentionally keeps `node_modules`, npm's install metadata, and any accidental lockfile outside the repository:

   ```bash
   export P1C_UNIT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p1-c-unit.XXXXXX")"
   trap 'case "${P1C_UNIT_ROOT:-}" in "${TMPDIR:-/tmp}"/p1-c-unit.*) rm -rf -- "$P1C_UNIT_ROOT" ;; esac' EXIT
   mkdir -p "$P1C_UNIT_ROOT/netlify/lib"
   cp package.json "$P1C_UNIT_ROOT/package.json"
   cp netlify/lib/identity.mjs "$P1C_UNIT_ROOT/netlify/lib/identity.mjs"
   npm install --prefix "$P1C_UNIT_ROOT" --ignore-scripts --no-package-lock
   npm --prefix "$P1C_UNIT_ROOT" ls @netlify/blobs @netlify/identity @netlify/functions --depth=0
   test ! -e package-lock.json
   ```

   Expected: all commands exit `0`; the tree contains exactly `@netlify/blobs@11.0.2`, `@netlify/identity@2.0.0`, and `@netlify/functions@6.0.0` as direct dependencies, and the repository root has no `package-lock.json` or test-created `node_modules`. The `EXIT` trap deletes the isolated install even when a later unit check fails.

3. Exercise the no-session identity path and the origin contract directly outside Netlify:

   ```bash
   (
   cd "$P1C_UNIT_ROOT"
   env -u URL node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { identify, requireOrigin } from "./netlify/lib/identity.mjs";

   const req = new Request("https://docs.example.test/api/session");
   assert.equal(await identify(req), null);
   console.log("PASS  no-session identity contract");

   const sameSite = new Request("https://docs.example.test/api/write", {
     method: "POST",
     headers: { Origin: "https://docs.example.test" },
   });
   assert.equal(requireOrigin(sameSite), undefined);

   for (const origin of [
     undefined,
     "null",
     "https://other.invalid",
     "http://docs.example.test",
     "https://docs.example.test:444",
   ]) {
     const headers = origin === undefined ? {} : { Origin: origin };
     const request = new Request("https://docs.example.test/api/write", { method: "POST", headers });
     let thrown;
     try {
       requireOrigin(request);
     } catch (error) {
       thrown = error;
     }
     assert.ok(thrown instanceof Response);
     assert.equal(thrown.status, 403);
     assert.equal(thrown.headers.get("content-type"), "text/plain; charset=utf-8");
     assert.equal(await thrown.text(), "Bad origin");
   }
   console.log("PASS  request-origin contract");
   NODE
   )
   ```

   Expected: exit `0` and exactly two lines: `PASS  no-session identity contract` and `PASS  request-origin contract`. The origin loop rejects five cases: missing, `null`, foreign host, downgraded scheme, and the same host with explicit wrong port `444`. Do not fake authenticated users by assigning `globalThis.netlifyIdentityContext.user`: the pinned package's server context accepts runtime-supplied `url` and `token`, then returns normalized fields named `id`, `appMetadata`, and `userMetadata`. Authenticated normalization must run through `netlify dev` in steps 5–7.

4. Verify the Functions v2 and single-accessor boundaries statically:

   ```bash
   test "$(rg -l 'getUser\(' netlify --glob '*.mjs')" = "netlify/lib/identity.mjs"
   ! rg -n 'clientContext|module\.exports|export[[:space:]]+\{[[:space:]]*handler' netlify
   rg -q 'export default async function handler\(req\)' netlify/functions/session.mjs
   rg -q 'export const config = \{ path: "/api/session" \}' netlify/functions/session.mjs
   echo "PASS  Functions v2 identity boundary"
   case "$P1C_UNIT_ROOT" in
     "${TMPDIR:-/tmp}"/p1-c-unit.*) rm -rf -- "$P1C_UNIT_ROOT" ;;
     *) echo 'refusing to remove unexpected unit-test path' >&2; exit 1 ;;
   esac
   unset P1C_UNIT_ROOT
   trap - EXIT
   ```

   Expected: exit `0` and exactly `PASS  Functions v2 identity boundary`; either legacy syntax, a second `getUser()` caller, or a missing route export exits nonzero.

5. Satisfy the authenticated fixture gate. Netlify CLI does not expose a deterministic command to enable Identity or change its registration mode, so these are explicit manual external prerequisites, not steps the P1-C implementation may pretend to automate. The operator must have permission to create and delete a project. Do all of the following before running step 6:

   1. Run `npx --yes netlify-cli@24.2.0 login` and complete the browser login. This pins every later CLI invocation to `24.2.0`; do not paste an auth token into the shell transcript.
   2. In the Netlify UI, create a new blank project with no Git repository. Use it only for this P1-C run.
   3. In that project's **Project configuration → Identity**, choose **Enable Identity**.
   4. In **Identity → Registration**, choose **Invite only** and save. Do not enable an external provider.
   5. Copy the project's API ID and canonical HTTPS origin from the UI. They are not credentials. Confirm that this disposable project may be deleted automatically at the end of step 6.

   **Hard gate:** if any prerequisite is unavailable, stop. The static and signed-out checks do not satisfy P1-C acceptance without the live member and guest checks. The temporary admin fixture in step 6, running only on loopback, creates auto-confirmed reserved-address accounts and their `member`/`guest` provider roles; no invitation email or real identity is used.

6. Run this single Bash block from the repository root. It copies the three owned implementation files into an isolated workspace, links only that workspace, installs packages there, creates two test identities, acquires JWTs into shell variables without printing them, starts the pinned local runtime, and checks signed-out, POST, HEAD, authenticated identity, and session behavior. Enter only the non-secret disposable site ID and origin when prompted.

   ```bash
   bash <<'BASH'
   set -euo pipefail
   umask 077

   read -r -p 'Disposable Netlify site API ID: ' P1C_SITE_ID
   read -r -p 'Disposable site HTTPS origin (for example https://name.netlify.app): ' P1C_SITE_ORIGIN
   P1C_SITE_ORIGIN="${P1C_SITE_ORIGIN%/}"
   test -n "$P1C_SITE_ID"
   [[ "$P1C_SITE_ORIGIN" == https://* ]]

   P1C_REPO="$PWD"
   P1C_TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p1-c-live.XXXXXX")"
   P1C_CLI=(npx --yes netlify-cli@24.2.0)
   P1C_DEV_PID=''
   P1C_MEMBER_ID=''
   P1C_GUEST_ID=''
   P1C_FIXTURE_NONCE=''
   P1C_PASSWORD=''

   cleanup() {
     local cleanup_status=0
     set +e
     if [[ -n "${P1C_DEV_PID:-}" ]] && kill -0 "$P1C_DEV_PID" 2>/dev/null; then
       for P1C_DELETE_ID in "${P1C_MEMBER_ID:-}" "${P1C_GUEST_ID:-}"; do
         if [[ -n "$P1C_DELETE_ID" ]]; then
           P1C_DELETE_ID="$P1C_DELETE_ID" node --input-type=module --eval \
             'process.stdout.write(JSON.stringify({ id: process.env.P1C_DELETE_ID }))' \
             | curl --fail --silent --show-error --output /dev/null \
                 --request DELETE \
                 --header 'Content-Type: application/json' \
                 --header "X-P1-C-Fixture: $P1C_FIXTURE_NONCE" \
                 --data-binary @- http://127.0.0.1:8888/api/p1-c-fixture \
             || echo "WARN  user cleanup failed; deleting the disposable site is the fallback" >&2
         fi
       done
       kill "$P1C_DEV_PID" 2>/dev/null
       wait "$P1C_DEV_PID" 2>/dev/null
     fi
     unset TEST_MEMBER_TOKEN TEST_GUEST_TOKEN P1C_PASSWORD P1C_FIXTURE_NONCE
     unset P1C_MEMBER_EMAIL P1C_GUEST_EMAIL P1C_MEMBER_NAME P1C_GUEST_NAME
     "${P1C_CLI[@]}" sites:delete "$P1C_SITE_ID" --force >/dev/null \
       || {
         echo "ERROR  delete the disposable site manually: npx --yes netlify-cli@24.2.0 sites:delete $P1C_SITE_ID --force" >&2
         cleanup_status=1
       }
     case "${P1C_TEST_ROOT:-}" in
       "${TMPDIR:-/tmp}"/p1-c-live.*) rm -rf -- "$P1C_TEST_ROOT" || cleanup_status=1 ;;
       *)
         echo 'ERROR  refusing to remove unexpected test path' >&2
         cleanup_status=1
         ;;
     esac
     set -e
     return "$cleanup_status"
   }
   trap cleanup EXIT
   trap 'exit 130' INT
   trap 'exit 143' TERM

   P1C_FIXTURE_NONCE="$(openssl rand -hex 32)"
   P1C_RUN_ID="$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
   P1C_MEMBER_EMAIL="p1c-${P1C_RUN_ID}@example.com"
   P1C_GUEST_EMAIL="p1c-${P1C_RUN_ID}@review.invalid"
   P1C_MEMBER_NAME='P1-C Member'
   P1C_GUEST_NAME='P1-C Guest'
   P1C_PASSWORD="$(openssl rand -base64 36)"

   mkdir -p "$P1C_TEST_ROOT/netlify/lib" \
     "$P1C_TEST_ROOT/netlify/functions/_p1_c_fixture"
   cp "$P1C_REPO/package.json" "$P1C_TEST_ROOT/package.json"
   cp "$P1C_REPO/netlify/lib/identity.mjs" "$P1C_TEST_ROOT/netlify/lib/identity.mjs"
   cp "$P1C_REPO/netlify/functions/session.mjs" "$P1C_TEST_ROOT/netlify/functions/session.mjs"

   install -m 600 /dev/stdin "$P1C_TEST_ROOT/netlify/functions/_p1_c_fixture/index.mjs" <<'FIXTURE'
   import { admin } from "@netlify/identity";
   import { identify } from "../../lib/identity.mjs";

   function authorized(req) {
     const expected = process.env.P1C_FIXTURE_NONCE ?? "";
     return expected.length === 64 && req.headers.get("x-p1-c-fixture") === expected;
   }

   export default async function fixture(req) {
     const pathname = new URL(req.url).pathname;
     if (pathname === "/api/p1-c-identify" && req.method === "GET") {
       const user = await identify(req);
       return user ? Response.json(user) : new Response(null, { status: 401 });
     }
     if (pathname !== "/api/p1-c-fixture" || !authorized(req)) {
       return new Response(null, { status: 404 });
     }
     if (req.method === "POST") {
       const { kind, email, password, name } = await req.json();
       if (!['member', 'guest'].includes(kind) || !email || !password || !name) {
         return new Response("Bad fixture", { status: 400 });
       }
       const user = await admin.createUser({
         email,
         password,
         data: {
           role: kind,
           app_metadata: { docs: kind === "guest" ? ["d0c123"] : [] },
           user_metadata: { full_name: name },
         },
       });
       return Response.json({ id: user.id });
     }
     if (req.method === "DELETE") {
       const { id } = await req.json();
       if (!id) return new Response("Bad fixture", { status: 400 });
       await admin.deleteUser(id);
       return new Response(null, { status: 204 });
     }
     return new Response(null, { status: 405 });
   }

   export const config = {
     path: ["/api/p1-c-fixture", "/api/p1-c-identify"],
   };
   FIXTURE

   cd "$P1C_TEST_ROOT"
   npm install --ignore-scripts --no-package-lock >/dev/null
   "${P1C_CLI[@]}" link --id "$P1C_SITE_ID" >/dev/null
   P1C_FIXTURE_NONCE="$P1C_FIXTURE_NONCE" \
     "${P1C_CLI[@]}" dev --functions netlify/functions --dir . --port 8888 \
       --no-open --skip-gitignore >"$P1C_TEST_ROOT/netlify-dev.log" 2>&1 &
   P1C_DEV_PID=$!

   for _ in $(seq 1 60); do
     if curl --silent --output /dev/null http://127.0.0.1:8888/api/session; then break; fi
     sleep 1
   done
   kill -0 "$P1C_DEV_PID"

   curl --silent --show-error --dump-header "$P1C_TEST_ROOT/anon.headers" \
     --output "$P1C_TEST_ROOT/anon.body" http://127.0.0.1:8888/api/session
   grep -qE '^HTTP/[^ ]+ 401' "$P1C_TEST_ROOT/anon.headers"
   grep -qi '^cache-control: private, no-store' "$P1C_TEST_ROOT/anon.headers"
   test ! -s "$P1C_TEST_ROOT/anon.body"

   curl --silent --show-error --request POST \
     --dump-header "$P1C_TEST_ROOT/post.headers" --output "$P1C_TEST_ROOT/post.body" \
     http://127.0.0.1:8888/api/session
   grep -qE '^HTTP/[^ ]+ 405' "$P1C_TEST_ROOT/post.headers"
   grep -qi '^allow: GET' "$P1C_TEST_ROOT/post.headers"
   grep -qi '^cache-control: private, no-store' "$P1C_TEST_ROOT/post.headers"
   test ! -s "$P1C_TEST_ROOT/post.body"

   curl --silent --show-error --head --output "$P1C_TEST_ROOT/head.headers" \
     http://127.0.0.1:8888/api/session
   grep -qE '^HTTP/[^ ]+ 405' "$P1C_TEST_ROOT/head.headers"
   grep -qi '^allow: GET' "$P1C_TEST_ROOT/head.headers"
   grep -qi '^cache-control: private, no-store' "$P1C_TEST_ROOT/head.headers"

   create_identity() {
     local kind="$1" email="$2" name="$3" response_file="$4"
     P1C_KIND="$kind" P1C_EMAIL="$email" P1C_NAME="$name" P1C_PASSWORD="$P1C_PASSWORD" \
       node --input-type=module --eval '
         process.stdout.write(JSON.stringify({
           kind: process.env.P1C_KIND,
           email: process.env.P1C_EMAIL,
           password: process.env.P1C_PASSWORD,
           name: process.env.P1C_NAME,
         }));
       ' \
       | curl --fail --silent --show-error \
           --header 'Content-Type: application/json' \
           --header "X-P1-C-Fixture: $P1C_FIXTURE_NONCE" \
           --data-binary @- http://127.0.0.1:8888/api/p1-c-fixture \
           --output "$response_file"
   }

   create_identity member "$P1C_MEMBER_EMAIL" "$P1C_MEMBER_NAME" "$P1C_TEST_ROOT/member.create.json"
   P1C_MEMBER_ID="$(node --input-type=module --eval \
     'const j=JSON.parse(await new Response(process.stdin).text()); if(!j.id)process.exit(1); process.stdout.write(j.id)' \
     <"$P1C_TEST_ROOT/member.create.json")"
   create_identity guest "$P1C_GUEST_EMAIL" "$P1C_GUEST_NAME" "$P1C_TEST_ROOT/guest.create.json"
   P1C_GUEST_ID="$(node --input-type=module --eval \
     'const j=JSON.parse(await new Response(process.stdin).text()); if(!j.id)process.exit(1); process.stdout.write(j.id)' \
     <"$P1C_TEST_ROOT/guest.create.json")"

   acquire_token() {
     local email="$1" response
     response="$(P1C_EMAIL="$email" P1C_PASSWORD="$P1C_PASSWORD" \
       node --input-type=module --eval '
         process.stdout.write(new URLSearchParams({
           grant_type: "password",
           username: process.env.P1C_EMAIL,
           password: process.env.P1C_PASSWORD,
         }).toString());
       ' \
       | curl --fail --silent --show-error \
           --header 'Content-Type: application/x-www-form-urlencoded' --data-binary @- \
           "$P1C_SITE_ORIGIN/.netlify/identity/token")"
     printf '%s' "$response" | node --input-type=module --eval '
       const j=JSON.parse(await new Response(process.stdin).text());
       if(!j.access_token) process.exit(1);
       process.stdout.write(j.access_token);
     '
   }

   TEST_MEMBER_TOKEN="$(acquire_token "$P1C_MEMBER_EMAIL")"
   TEST_GUEST_TOKEN="$(acquire_token "$P1C_GUEST_EMAIL")"
   TEST_MEMBER_SUB="$P1C_MEMBER_ID"
   TEST_MEMBER_EMAIL="$P1C_MEMBER_EMAIL"
   TEST_MEMBER_NAME="$P1C_MEMBER_NAME"
   TEST_GUEST_SUB="$P1C_GUEST_ID"
   TEST_GUEST_EMAIL="$P1C_GUEST_EMAIL"
   TEST_GUEST_NAME="$P1C_GUEST_NAME"
   export TEST_MEMBER_TOKEN TEST_MEMBER_SUB TEST_MEMBER_EMAIL TEST_MEMBER_NAME
   export TEST_GUEST_TOKEN TEST_GUEST_SUB TEST_GUEST_EMAIL TEST_GUEST_NAME

   for test_var in \
     TEST_MEMBER_TOKEN TEST_MEMBER_SUB TEST_MEMBER_EMAIL TEST_MEMBER_NAME \
     TEST_GUEST_TOKEN TEST_GUEST_SUB TEST_GUEST_EMAIL TEST_GUEST_NAME; do
     test -n "${!test_var}"
   done

   check_identity_and_session() {
     local test_kind="$1" test_token="$2" test_sub="$3" test_email="$4" test_name="$5"
     local identity_body="$P1C_TEST_ROOT/${test_kind}.identity.json"
     local session_body="$P1C_TEST_ROOT/${test_kind}.session.json"
     local session_headers="$P1C_TEST_ROOT/${test_kind}.session.headers"

     curl --fail --silent --show-error --header "Cookie: nf_jwt=$test_token" \
       --output "$identity_body" http://127.0.0.1:8888/api/p1-c-identify
     curl --fail --silent --show-error --header "Cookie: nf_jwt=$test_token" \
       --dump-header "$session_headers" --output "$session_body" \
       http://127.0.0.1:8888/api/session

     TEST_KIND="$test_kind" TEST_SUB="$test_sub" TEST_EMAIL="$test_email" TEST_NAME="$test_name" \
       IDENTITY_BODY="$identity_body" SESSION_BODY="$session_body" node --input-type=module <<'NODE'
     import assert from "node:assert/strict";
     import { readFileSync } from "node:fs";
     const member = process.env.TEST_KIND === "member";
     const common = {
       sub: process.env.TEST_SUB,
       email: process.env.TEST_EMAIL.toLowerCase(),
       name: process.env.TEST_NAME,
       roles: [member ? "member" : "guest"],
       canComment: member,
       canEdit: member,
     };
     assert.deepEqual(JSON.parse(readFileSync(process.env.IDENTITY_BODY, "utf8")), {
       ...common,
       docs: member ? [] : ["d0c123"],
     });
     assert.deepEqual(JSON.parse(readFileSync(process.env.SESSION_BODY, "utf8")), common);
     console.log(`PASS  ${process.env.TEST_KIND} session contract`);
   NODE
     grep -qi '^cache-control: private, no-store' "$session_headers"
     grep -qi '^content-type: application/json' "$session_headers"
   }

   check_identity_and_session member "$TEST_MEMBER_TOKEN" "$TEST_MEMBER_SUB" "$TEST_MEMBER_EMAIL" "$TEST_MEMBER_NAME"
   check_identity_and_session guest "$TEST_GUEST_TOKEN" "$TEST_GUEST_SUB" "$TEST_GUEST_EMAIL" "$TEST_GUEST_NAME"

   cleanup
   trap - EXIT INT TERM
   test ! -e "$P1C_REPO/package-lock.json"
   echo 'PASS  live fixture cleaned'
   BASH
   ```

   The eight populated test variables are two short-lived tokens plus six expected values (`sub`, `email`, and `name` for member and guest). They and the shared generated password remain only in the Bash process; `set -x` is prohibited. Before authentication, the executable assertions require GET to return `401`, POST to return `405`, and HEAD to return `405`; both unsupported methods must include `Allow: GET`, and all three responses must include `Cache-Control: private, no-store`. Expected contract output is exactly `PASS  member session contract`, then `PASS  guest session contract`, then `PASS  live fixture cleaned`. The first two output assertions cover the exact seven-field member/guest `identify()` objects and the exact six-field session projections; the guest identity has `docs: ["d0c123"]`, while neither HTTP session body exposes `docs`. The final line means the dev process stopped, both identities were deleted (or the site deletion supplied the fallback), the disposable site was deleted, and the isolated `.netlify`, `node_modules`, fixture module, logs, headers, bodies, and JSON response files were removed with the test root. If site deletion emits the manual-cleanup error, cleanup did not pass and the ticket remains open until the printed targeted command succeeds.

7. Run the repository-wide non-regression gates from the repository root. Step 4 has already removed `P1C_UNIT_ROOT`; if an earlier unit command failed, its `EXIT` trap performs the same cleanup when that shell exits.

   ```bash
   templates/check-dist
   npm --prefix templates/docbuild run check
   scripts/scrub-check.sh docs/tickets/P1-C.md package.json netlify/lib/identity.mjs netlify/functions/session.mjs
   ```

   Expected: all commands exit `0`; `check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`, typecheck emits no diagnostics, and scrub-check ends with `PASS  no denied term and no warning.`

8. Confirm the implementation diff is exclusive and that verification left no package-manager, CLI-link, fixture, or response artifact in the repository:

   ```bash
   git diff --name-only -- package.json netlify/lib/identity.mjs netlify/functions/session.mjs
   test ! -e package-lock.json
   test ! -e .netlify
   test ! -e netlify/functions/_p1_c_fixture
   test -z "$(find . -maxdepth 1 -name 'p1-c-*' -print -quit)"
   git status --short
   ```

   Expected: every `test` exits `0`, and P1-C contributes exactly the three owned implementation paths. The coordination branch may also contain `docs/tickets/P1-C.md` and other agents' separately owned ticket documents; P1-C must not modify them. A pre-existing operator `.netlify` link must not be used for this procedure: the disposable link lives only in `P1C_TEST_ROOT`, so this check can require the repository path to be absent.

9. After the canonical document is committed, pushed, and linked from the tracker, verify the immutable issue pointer:

   ```bash
   set -euo pipefail
   p1c_issue_json="$(mktemp "${TMPDIR:-/tmp}/p1-c-issue.XXXXXX")"
   p1c_linked_blob="$(mktemp "${TMPDIR:-/tmp}/p1-c-linked.XXXXXX")"
   trap 'rm -f "$p1c_issue_json" "$p1c_linked_blob"' EXIT
   gh issue view 3 --repo aiur-team/architecture-docs --json title,body >"$p1c_issue_json"
   read -r p1c_commit_sha p1c_linked_path < <(
     P1C_ISSUE_JSON="$p1c_issue_json" \
     P1C_TICKET_PATH="docs/tickets/P1-C.md" \
     P1C_EXPECTED_TITLE="P1-C — The identity contract" \
       node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";

   const issue = JSON.parse(readFileSync(process.env.P1C_ISSUE_JSON, "utf8"));
   assert.equal(issue.title, process.env.P1C_EXPECTED_TITLE, "issue title changed");
   const match = issue.body.match(/^Implementation specification: \[`([^`\n]+)`\]\(https:\/\/github\.com\/aiur-team\/architecture-docs\/blob\/([0-9a-f]{40})\/([^)\n]+)\)\n\nThis issue tracks implementation of the linked canonical specification\.$/);
   assert.ok(match, "issue body is not the exact two-paragraph pointer form");
   assert.equal(match[1], process.env.P1C_TICKET_PATH, "link label path changed");
   assert.equal(match[3], process.env.P1C_TICKET_PATH, "link target path changed");
   process.stdout.write(`${match[2]} ${match[3]}\n`);
   NODE
   )
   git show "$p1c_commit_sha:$p1c_linked_path" >"$p1c_linked_blob"
   cmp -s docs/tickets/P1-C.md "$p1c_linked_blob"
   rm -f "$p1c_issue_json" "$p1c_linked_blob"
   trap - EXIT
   echo "PASS  P1-C issue #3 points to the byte-identical canonical document"
   ```

   Expected: exit `0` and exactly `PASS  P1-C issue #3 points to the byte-identical canonical document`. The gate fails if the title changes, the body differs from the exact two-paragraph short form in `docs/prompts/rewrite-tickets.md`, the URL does not contain one full lowercase 40-character commit SHA and the exact canonical path, or that committed blob differs by one byte from the local document.

## Failure modes

### Handled

- Missing, invalid, or expired session: `identify()` returns `null`; `/api/session` returns 401 with an empty body.
- Identity API outage with valid JWT claims: `getUser()` falls back to verified claims, and the allowed field set still produces the normalized object.
- Missing email or name in the normalized user: email becomes `""`; name falls back to the email local part (also `""` when email is absent), so the helper keeps its string-valued shape and fails outside the org capability path.
- Uppercase email: normalize before domain comparison and return.
- Absent or malformed guest `appMetadata.docs`: return an empty array rather than throwing or forwarding non-string entries.
- Missing, null, foreign, downgraded-scheme, or wrong-port `Origin`: throw the normalized 403 response before a mutating caller performs work.
- Unsupported `/api/session` method: return 405 with `Allow: GET` and no body.
- Accidental response caching: every session response carries `Cache-Control: private, no-store`.
- Client identity spoofing: request bodies, arbitrary headers, and query values never supply the actor.
- Accidental legacy handler: static verification rejects v1 exports and `clientContext`.

### Deliberately not handled

- Document authorization, grants, roles, owner binding, invitation conversion, and access enforcement. P2-G, P2-H, P3-H, P3-J, and P4-M own those layers.
- A configurable organization suffix. The public ruling plan uses the reserved `@example.com` suffix; replacing it with a deployment-specific contract needs an explicit later ruling.
- Login, logout, password recovery, account creation, and Identity UI configuration beyond the stated runtime prerequisite.
- CORS or trusted cross-origin mutations. No `allowedOrigins` list is supplied; the contract is same-origin only.
- Rate limiting, audit events, storage, realtime, comments, or edits.
- A permanent automated test file. The canonical document's exact commands exercise this bounded three-file contract without widening file ownership.
- Provider outage without a valid JWT fallback. It is indistinguishable from no valid session and returns 401.

## Settled decisions

- Netlify Identity with invite-only registration is the only identity provider. Do not add GitHub OAuth, Auth0, `netlify-identity-widget`, `gotrue-js`, self-registration, or a second user system.
- Server identity uses `getUser()` from exactly `@netlify/identity@2.0.0`, in Functions v2 only. No function reads `clientContext`, manually decodes `nf_jwt`, or accepts an author from the client.
- Same-origin verification is mandatory and first for every POST, PATCH, and DELETE handler. It is a server security boundary; client UI state is not.
- P1-C implements the temporary Phase 1 capability fields because current downstream contracts require them. P2-H, not P1-C, performs the settled split: identity answers who the person is; `resolveRole()` answers what they may do on one document.
- Document authority is one owner plus `editor`, `commenter`, and `viewer`, held under per-record access keys in the state store. It never lives in Identity roles or committed `doc.json`, and every authority change later writes an append-only audit event.
- The state store remains Netlify Blobs with strong consistency and one blob per record. P1-C pins its package but does not create or access state.
- Both standalone and repository-backed deployment modes remain supported; the standalone owner is seeded later through `DOC_OWNERS`. P1-C does not implement deployment or ownership.
- Realtime remains opt-in Ably on the free tier, absent without `ABLY_API_KEY`, with presence never persisted. P1-C adds no realtime behavior.
- `data-aid`, `norm()`, and the block scanner remain the single shared anchoring implementation. Identity work must not touch or duplicate them.
- The browser's future `data-session` value is a rendering hint only. Every server write path must independently identify and authorize the caller.

## Assumptions and open questions

- **Assumption (non-blocking):** unsupported `/api/session` methods return 405 with `Allow: GET`, an empty body, and the no-store header. The plan specifies `GET`, 200, and 401 but does not spell out the method-error response; this fail-closed behavior makes the route contract complete without widening scope.
- **Assumption (non-blocking):** `requireOrigin(req)` catches `@netlify/identity`'s `AuthError` and throws the normalized `Response` described by the plan. Downstream Fetch handlers must catch that thrown `Response` at their outer boundary and return it; they must not expose the package error message.
- **Assumption (non-blocking):** provider `role`/`roles` is read defensively as the plan requires, but the Phase 1 public classification is forced to exactly `member` for the reserved org suffix and `guest` for every other authenticated account. P2-H removes this temporary role output before document authorization lands.
- **Assumption (non-blocking):** root dependency installation during local checks uses `--no-package-lock` because no Build Order ticket owns a root lockfile. If the project later adopts one, that requires an explicit ownership/ruling change.
- **Open question (does not block P1-C):** whether invite-only registration also blocks account creation through an external provider remains unverified in the ruling plan. No external provider is enabled by this ticket, and the domain classification fails outside accounts into the guest capability shape.

## References

- `docs/prompts/rewrite-tickets.md`, **The goal**, **Method**, and **The acceptance test for your own work** — the document-only canonical source and immutable short-pointer publication contract.
- `docs/research/00-integration-plan.md` §1.2, “The authentication model” — ruling identity accessor, temporary Phase 1 normalization, CSRF rule, Functions v2 requirement, and exclusions.
- `docs/research/00-integration-plan.md` §2.9, “Session — the `/api/session` response” — initial six-field response, cache header, and signed-out behavior.
- `docs/research/00-integration-plan.md` §4.3, “Phase 1” — P1-C's exclusive file surface, runtime verification, exact root `package.json`, and Node environment guidance.
- `docs/research/00-integration-plan.md` §1.1, §1.4, §1.5, §1.6, and §3.3 — settled state, deployment, authority, realtime, and anchoring boundaries that this ticket may not reopen.
- `docs/research/00-integration-plan.md` §4.7, P2-G/P2-H/P3-H rows — downstream access library, identity split, and document-aware session amendment boundaries.
- `docs/research/00-integration-plan.md` §6, rulings 9, 10, and 14 — Functions v2 identity, reopened role ruling, and consolidated package manifest.
- `docs/research/02-auth.md` §1 “The client library changed,” §3.1, and §5 `package.json` — primary package/runtime behavior, `getUser()`, origin verification, and server dependency rationale.
- `docs/research/09-sharing-and-roles.md` §2.5 and §3 — the later identity/authorization split, why P1-C's capabilities are transitional, and the future document-aware session shape.
- `@netlify/identity@2.0.0` packaged `README.md` (`getUser`, “Protect a Netlify Function,” and `verifyRequestOrigin`) and `dist/main.d.ts` (`User` and `VerifyRequestOriginOptions`) — primary-source server context, normalized field names, signatures, and failure behavior pinned by this ticket.
