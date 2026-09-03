# P2-A — The edge gate, login and logout

## Outcome

Every hosted HTML route is protected by a fail-closed Netlify Edge Function, and an invited user can establish or clear a Netlify Identity session through a static sign-in form and Functions v2 endpoints without adding a browser authentication library or a build step.

## Context

The published document is one self-contained HTML response, so the edge gate is the only read-control wall in front of its complete text. P1-E already declares that gate on `/*`, excludes only the login page, self-authorizing APIs, and hashed assets, and copies a root `login/` tree into the site when it appears.

P2-A supplies the implementation behind those prepared seams. It uses P1-C's single identity and same-origin contracts and remains compatible when P2-H narrows identity to `{sub,email,name,isOrg}`. The gate permits an organization member under either transition shape and denies every non-organization session until P3-J later amends the gate to resolve document grants and removes the legacy `roles` fallback.

## Scope

### In scope

- Create the `gate` Edge Function targeted by P1-E's existing `[[edge_functions]]` declaration.
- Redirect a request with no valid session to `/login/` while preserving only its same-site path and query as `next`.
- Pass an organization member through to the requested static response by returning `undefined` from the Edge Function, using P2-H's boolean `isOrg` when present and P1-C's temporary `member` role only as a legacy fallback.
- Return `undefined` before identity for exact `/invite/` and descendant pathnames so P4-K's future public acceptance page is reachable without a later gate amendment; rely on P1-E's existing `/api/*` exclusion for P4-K's future exact `POST /api/accept` endpoint.
- Return a plain-text 403 for every authenticated non-organization user in this temporary P2-A gate.
- Create Functions v2 `POST /api/login` and `POST /api/logout` endpoints.
- Apply P1-C's `requireOrigin(req)` before every authentication mutation.
- Parse and validate the login form, normalize all credential failures to one non-disclosing redirect, and restrict the post-login destination to a safe same-site path.
- Let `@netlify/identity@2.0.0` and the Netlify runtime exclusively create, refresh, and clear the `nf_jwt` and `nf_refresh` cookies.
- Create a self-contained `login/index.html` with an HTML form, inline styles, and the minimal inline script needed to carry `next` and reveal a generic error message.
- Verify the Edge runtime import, runtime-owned cookie handoff, all identity branches, every gated/excluded route family, both hosted preview contexts, and P1-E's static-page copy seam against a disposable invite-only Netlify Identity project.
- Bound every mandatory hosted package, CLI, browser, HTTP, Identity-user, and cleanup operation. Complete cleanup on the normal supervisor path; on the exceptional kernel-level path where a process cannot be killed or reaped within the terminal bound, fail closed, retain the guarded tree and ownership evidence, and print the exact manual-remediation boundary instead of claiming disposal succeeded.

### Out of scope

- Editing `netlify.toml`, its gate path, its exclusions, its headers, or its site build. P1-E owns those declarations.
- Editing `package.json`, pinning another dependency, wrapping `getUser()`, changing `identify()`, or changing `requireOrigin()`. P1-C creates those contracts and P2-H alone owns the final identity-shape amendment.
- Reading Netlify Identity through `context.clientContext`, decoding a JWT, reading cookies directly, or accepting identity data from a form, query, header, or body.
- Looking up a document ID, reading Netlify Blobs, honoring `appMetadata.docs`, resolving `viewer`, `commenter`, `editor`, or `owner`, or permitting any guest. P2-G establishes the later access model, P2-H separates person identity from authorization, and P3-J alone amends this gate to use access resolution.
- Implementing invitation acceptance. P4-K owns `invite/index.html` and exact `POST /api/accept`; it consumes the public seams that P2-A establishes and must not amend the gate or `netlify.toml`.
- Adding signup, password recovery, OAuth, an external identity provider, a browser SDK, `netlify-identity-widget`, `gotrue-js`, or a logout control in a document.
- Changing project visibility, enabling Identity, choosing registration settings, inviting production users, or keeping a disposable verification site.
- Creating a permanent test file, a lockfile, `.env`, `.netlify`, `_site/login/index.html`, or any generated output by hand.
- Changing a template, research document, dependency-ticket document, committed `dist/*.html`, or any issue other than issue #6's body.

## Interface contract

### Edge gate

Create `netlify/edge-functions/gate.ts` with this public surface and no inline `config` export:

```ts
export default async function gate(req: Request): Promise<Response | undefined>
```

Import `identify(req)` from `netlify/lib/identity.mjs`. The gate must not import or call `getUser()` directly, inspect `nf_jwt`, or duplicate P1-C's email normalization. The transitive `@netlify/identity` import through `identify()` is the package-resolution path that the Edge runtime smoke test must prove.

For every matched request:

1. Construct `url = new URL(req.url)`.
2. If `url.pathname === "/invite/" || url.pathname.startsWith("/invite/")`, return `undefined` immediately without calling `identify()`. This one case-sensitive, pathname-only family is the public static seam for P4-K; query strings do not affect the decision. It includes `/invite/` and descendants for every HTTP method, but excludes bare `/invite`, `/Invite/`, percent-spelled `/%69nvite/`, and near-prefix `/invitee/`. Before P4-K creates `invite/index.html`, the downstream result is 404. P4-K must use this seam unchanged rather than amending the gate.
3. For every other matched path, call `await identify(req)` exactly once inside the gate's own `try` boundary. If `identify(req)` throws for any reason, catch that error at the gate boundary, do not log or return it, and return the exact unavailable response below. P2-H must not catch a hypothetical future package throw and convert it to `null`: `null` means the pinned helper's documented no-session/degraded-session result, while a thrown exception means the identity boundary itself is unavailable.
4. If the result is `null`, construct `next` from `url.pathname + url.search`; fragments never reach the server and are not preserved. Return the anonymous response below.
5. Compute the temporary organization decision with this exact predicate and no email-domain duplicate:

   ```ts
   const isOrg = typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member");
   ```

   The boolean branch is authoritative. In particular, `{ isOrg: false, roles: ["member"] }` is denied and must never fall back to the legacy role. Only an absent or non-boolean `isOrg` reaches the P1-C compatibility branch. A missing or non-array `roles` value is false rather than throwing.
6. If `isOrg` is true, return `undefined`. Netlify then continues the request chain to redirects and static content. Do not call `fetch()` or `context.next()` merely to pass through.
7. For every other non-null result, including the temporary P1-C `guest` shape, P2-H `{ isOrg: false }` shape, contradictory false-plus-member shape, and malformed shape that satisfies neither branch, return the denied response below. Do not inspect `docs` or provider metadata.
8. Do not catch any later gate bug and pass the request through. The narrow catch wraps only the awaited `identify(req)` call. P1-C/P2-H preserve the pinned package's documented `null` degradation, but if a future package violates that contract, P2-H propagates the exception and P2-A converts it only here to the unavailable response. The gate never converts that failure to an anonymous redirect and never serves static bytes.

The exact responses are:

| Caller | Status | Required headers | Body |
|---|---:|---|---|
| No valid session | `302` | `Location: /login/?next=<encodeURIComponent(pathname + search)>`; `Cache-Control: private, no-store` | Empty, zero bytes |
| Identity helper throws | `503` | `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` | Exactly `Authentication is temporarily unavailable.` with no trailing newline |
| Any caller to exact `/invite/` or a descendant | downstream status, 404 before P4-K | Downstream headers | Return `undefined` before identity; do not synthesize a response |
| P1-C legacy `roles: ["member"]` or P2-H `isOrg: true` | downstream status | P1-E/downstream headers | Return `undefined`; do not synthesize a response |
| P1-C legacy guest, P2-H `isOrg: false`, or malformed non-org shape | `403` | `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` | Exactly `You do not have access to this document.` with no trailing newline |

Examples:

| Request URL | Anonymous `Location` |
|---|---|
| `/example/` | `/login/?next=%2Fexample%2F` |
| `/example/?view=review&section=overview` | `/login/?next=%2Fexample%2F%3Fview%3Dreview%26section%3Doverview` |
| `/` | `/login/?next=%2F` |

The gate applies to all HTTP methods because P1-E's declaration has no method filter. A returned response terminates the request chain. A returned `undefined` lets Netlify's normal static-route behavior decide the eventual method/status response.

### Gate declaration and exclusions

P1-E owns and has already created this exact `netlify.toml` declaration:

```toml
[[edge_functions]]
  path = "/*"
  excludedPath = ["/login/*", "/api/*", "/_assets/*"]
  function = "gate"
```

P2-A consumes that declaration and must not repeat it as an inline export or amend it.

- `/login/*` is public so the anonymous redirect terminates at the form rather than looping.
- `/api/*` bypasses the HTML gate because each Function implements its own method, origin, identity, and authorization boundary.
- `/_assets/*` bypasses the gate because P1-E names assets by their content hash and documents are otherwise self-contained.
- P2-A's gate returns `undefined` before identity only for the case-sensitive pathname family `/invite/` and `/invite/*`; every method passes downstream because the Edge declaration itself has no method filter. Bare `/invite`, `/Invite/`, `/%69nvite/`, and `/invitee/` remain gated. Before P4-K supplies the static page, the public family reaches the downstream 404.
- Exact `/api/accept` is already outside the Edge gate as part of P1-E's `/api/*` exclusion. Before P4-K supplies its Function it reaches a downstream 404. P4-K exposes only exact `POST /api/accept`; other methods receive its 405, while `/api/accept/`, case variants, and near-prefix paths do not alias that Function and remain downstream 404s. P4-K must not amend the Edge gate or declaration.
- `/`, every document slug, `/d/<id>`, every alias, deploy previews, branch deploys, and any other future top-level path remain gated by default.
- Netlify evaluates the gate before later redirect/static handling. Returning a `Response` stops that chain; returning `undefined` continues it.

### Safe post-login destination

Export this helper from `netlify/functions/login.mjs` so its security boundary can be tested without invoking Identity:

```js
/** @param {FormDataEntryValue | null | undefined} value */
export function safeNext(value)
```

`safeNext(value)` returns a string and follows these rules in order:

1. A non-string value, including a multipart `File`, returns `/`.
2. Before trimming, reject any string containing an ASCII C0 control (`U+0000`–`U+001F`) or DEL (`U+007F`) anywhere. This makes leading or trailing tabs/newlines invalid rather than silently removable.
3. Apply ECMAScript `String.prototype.trim()` once. An empty result returns `/`; non-ASCII whitespace removed by that operation is allowed around an otherwise valid destination.
4. The trimmed input must start with exactly one literal `/` and must contain no literal backslash. A scheme URL or scheme-relative URL beginning `//` returns `/`.
5. Parse the input against the fixed base `https://docs.example.invalid`. If parsing fails, return `/`.
6. Revalidate the parsed URL rather than trusting only the pre-parse spelling. Require `url.protocol === "https:"`, empty `url.username` and `url.password`, `url.host === "docs.example.invalid"`, and `url.origin === "https://docs.example.invalid"`. Require the parser-normalized `url.pathname` to begin with exactly one literal `/`, not `//`, and contain no literal backslash, C0 control, or DEL. These post-parse checks make a dot-segment normalization such as `/%2e%2e//elsewhere.invalid/path` fall back to `/` instead of returning a network-path-looking Location.
7. Decode `url.pathname` exactly once with `decodeURIComponent()` for validation only. Malformed percent escapes, a decoded pathname containing a backslash, C0 control, or DEL, or a decoded pathname that does not begin with exactly one literal `/` all return `/`. Thus an encoded leading slash cannot manufacture `//` after validation. The parser-normalized and once-decoded representations must each independently satisfy the exact-one-leading-slash rule.
8. Compare that once-decoded pathname, case-sensitively, with `/login`, `/login/*`, `/api`, `/api/*`, `/_assets`, `/_assets/*`, `/.netlify`, and `/.netlify/*`. Percent-encoding does not bypass a reserved path: `/%6cogin` and `/login%2Fnext` are rejected. Case is not folded: `/Login/` is an ordinary allowed path. A double-encoded percent sign is decoded only once.
9. Construct `destination = url.pathname + url.search` and revalidate that it begins with exactly one literal `/`; otherwise return `/`. Return `destination`, preserving the URL parser's serialized percent escapes and query order. Drop any fragment.

Required examples:

| Input | Output |
|---|---|
| `/example/?view=review` | `/example/?view=review` |
| `/d/a1b2c3` | `/d/a1b2c3` |
| `/example/#notes` | `/example/` |
| `https://elsewhere.invalid/` | `/` |
| `//elsewhere.invalid/` | `/` |
| `/%2e%2e//elsewhere.invalid/path` | `/` |
| `/%2f%2felsewhere.invalid/path` | `/` |
| `/\\elsewhere.invalid/` | `/` |
| `/login/?next=%2Fexample%2F` | `/` |
| `/api/session` | `/` |
| `null` | `/` |

The gate-generated `next` already contains only a pathname and query. `safeNext()` remains mandatory because a caller can edit the login query or submit the Function directly.

### `POST /api/login`

Create `netlify/functions/login.mjs` as an ECMAScript Functions v2 module with this complete export surface:

```js
export function safeNext(value)
export default async function handler(req)
export const config = { path: "/api/login" }
```

Import the shared origin helper with exactly `import { requireOrigin } from "../lib/identity.mjs";`; import `login` from the pinned `@netlify/identity` package separately.

Only the custom path is exposed; current Netlify Functions routing makes a Function with `config.path` unavailable at the default `/.netlify/functions/login` path.

For every request, first branch on exact `req.method !== "POST"`; that one branch returns the 405 response for every other method token without calling origin, form, or Identity code. The executable representative set is GET, HEAD, PUT, PATCH, DELETE, OPTIONS, and PROPFIND.

Handler order for `POST` is exact:

1. Call P1-C's `requireOrigin(req)` before parsing the form or invoking Identity. Catch the thrown `Response`, set `Cache-Control: private, no-store` on it, and return it unchanged in every other respect. Re-throw any unexpected non-`Response` error.
2. Call `req.formData()`. If the media type/body cannot be parsed as form data, return the documented 400 response.
3. Read each field with `form.getAll()`. `next` is accepted only when there is exactly one entry and it is a string; otherwise compute `next = safeNext(null)`. `email` and `password` are valid only when each has exactly one entry and that entry is a string. A missing field, duplicate field, or multipart `File` in either credential position follows the generic failure redirect without calling `login()`.
4. Apply ECMAScript `trim().toLowerCase()` to the one email string. This is locale-independent default Unicode lowercasing; do not call `toLocaleLowerCase()` and do not apply NFC, NFD, NFKC, or NFKD normalization. Internal whitespace and the resulting code-point sequence are preserved. Do not trim, normalize, log, or return the one password string.
5. If the normalized email or byte-preserved password is empty, return the same generic failure redirect used for bad credentials without calling `login()`.
6. Call `login(email, password)` from `@netlify/identity@2.0.0` exactly once.
7. On any rejected login, return the generic failure redirect. Do not expose whether the email exists, the provider status, or the exception message.
8. On success, return the success redirect. A real 302 full-page navigation is required so the browser sends the runtime-set cookie to the gated destination.

The exact response table is:

| Request/result | Status | Required headers | Body |
|---|---:|---|---|
| Method other than `POST`, including `GET` and `HEAD` | `405` | `Allow: POST`; `Cache-Control: private, no-store` | Empty, zero bytes |
| `POST` with missing/null/foreign `Origin` | `403` | P1-C's `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` | Exactly `Bad origin` |
| `POST` whose form data cannot be parsed | `400` | `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` | Exactly `Invalid form` |
| Missing, empty, duplicate, or non-string email/password; or rejected `login()` | `302` | `Location: /login/?next=<encodeURIComponent(safeNext)>&error=1`; `Cache-Control: private, no-store` | Empty, zero bytes |
| Successful `login()` | `302` | `Location: <safeNext>`; `Cache-Control: private, no-store`; runtime-applied auth cookies | Empty, zero bytes |

### `POST /api/logout`

Create `netlify/functions/logout.mjs` as an ECMAScript Functions v2 module:

```js
export default async function handler(req)
export const config = { path: "/api/logout" }
```

Import the shared origin helper with exactly `import { requireOrigin } from "../lib/identity.mjs";`; import `logout` from the pinned `@netlify/identity` package separately.

For every request, first branch on exact `req.method !== "POST"`; that one branch returns the 405 response for every other method token without calling origin or Identity code. The executable representative set is GET, HEAD, PUT, PATCH, DELETE, OPTIONS, and PROPFIND.

Handler order for `POST` is exact:

1. Call `requireOrigin(req)` before invoking Identity. Handle its thrown `Response` exactly as the login handler does.
2. Call `logout()` from `@netlify/identity@2.0.0` once.
3. If `logout()` rejects after the runtime has attempted cleanup, do not expose the error. Continue to the login redirect because the pinned package promises that server-side auth cookies are cleared even when its upstream logout call fails.
4. Return the redirect to `/login/`. Logout is idempotent; a caller with no valid session gets the same response.

The exact response table is:

| Request/result | Status | Required headers | Body |
|---|---:|---|---|
| Method other than `POST`, including `GET` and `HEAD` | `405` | `Allow: POST`; `Cache-Control: private, no-store` | Empty, zero bytes |
| `POST` with missing/null/foreign `Origin` | `403` | P1-C's `Content-Type: text/plain; charset=utf-8`; `Cache-Control: private, no-store` | Exactly `Bad origin` |
| Same-origin `POST`, with or without a valid session | `302` | `Location: /login/`; `Cache-Control: private, no-store`; runtime-applied cookie deletions | Empty, zero bytes |

### Login page

Create `login/index.html` as a complete HTML5 document with no external request and no build tooling. It must contain:

- `<!doctype html>`, `<html lang="en">`, UTF-8 charset, viewport metadata, and `<title>Sign in</title>`.
- Inline CSS only, using system fonts and a readable single-column width. At least one `max-width` declaration must be in the inclusive range 18–40 `rem`, 36–80 `ch`, or 288–640 `px`. One rule whose selector list contains both exact selectors `input:focus-visible` and `button:focus-visible` must declare a nonzero pixel `outline` with a visible line style and an explicit opaque six-digit hexadecimal color; the submit button must not depend on JavaScript.
- One visible `<h1>Sign in</h1>`.
- One generic error element with `id="login-error"`, `role="alert"`, and `hidden`; its exact text is `Sign-in failed. Check your details and try again.`.
- One `<form method="post" action="/api/login">`; the hidden destination, both labels, both credential inputs, and the submit button are descendants of and associated with this sole form.
- A hidden `next` input whose initial value is `/`.
- A `<label for="login-email">Email</label>` and required email input with `id="login-email"`, `name="email"`, `type="email"`, and `autocomplete="username"`.
- A `<label for="login-password">Password</label>` and required password input with `id="login-password"`, `name="password"`, `type="password"`, and `autocomplete="current-password"`.
- A `<button type="submit">Sign in</button>` that submits without JavaScript.
- One inline classic script, after the form, that reads `location.search` with `URLSearchParams`, copies a non-empty `next` query value into the hidden input, and unhides `#login-error` only when `error=1`.

Every non-empty `id` is unique in the parsed document. No element is `inert` or `aria-hidden="true"`; no form control or ancestor fieldset is disabled. The heading, form, labels, credential controls, and submit button are rendered with nonzero dimensions and are not suppressed by `display`, `visibility`, opacity, clipping, off-screen positioning, or a later cascade rule. The alert alone starts hidden and becomes visibly rendered after its `hidden` property is cleared. Both labels and all three inputs/buttons have the sole parsed form as their actual form owner, not merely a source-order appearance inside its tags. The declared focus outline remains the computed outline for both credential inputs and the submit button; a later rule must not erase it.

`URLSearchParams.get()` supplies the first occurrence of each page query parameter. For duplicate `next`, the first value alone is used and an empty first value becomes `/`; later values are ignored. For duplicate `error`, the alert is shown only when the first value is exactly `1`; later values are ignored. The script must never read or assign either credential input at runtime.

The page must not include signup, password recovery, OAuth, user enumeration, a pre-filled email, a password value, a logout form, a package import, a module script, or any external-request surface. In particular it has no URL-bearing resource attribute other than the form's exact same-origin `action="/api/login"`; no inline event-handler attribute; no image, frame, object, embed, media, source, track, SVG, MathML, portal, or refresh element; exactly one attribute-free inline style; no CSS `@import`, `@font-face`, `url()`, `image-set()`, `expression()`, `behavior`, or binding; and no script network API, dynamic import, worker, service-worker registration, beacon, `eval`, `Function`, string timer, computed/bracket property access, escaped identifier, alternate global, CSSOM/style/layout access, or dynamic resource/form construction. Client handling of `next` is convenience only; the Function always applies `safeNext()` again.

P1-E's existing `buildSite()` copies this source tree byte-for-byte to `_site/login/` when it exists. P2-A creates only `login/index.html`; it does not create, edit, or commit `_site/login/index.html`.

### Cookie, origin, error, and logging boundaries

- `nf_jwt` and `nf_refresh` are opaque runtime-owned cookies. Do not construct `Set-Cookie`, copy their values into application code, choose their attributes, decode them, persist them, or expose them to JavaScript.
- A successful server-side `login()` causes the runtime to attach both session cookies to the Function response. A server-side `logout()` causes the runtime to delete them, including when the upstream logout request fails under the pinned provider contract.
- Static source checks reject `Set-Cookie`, either cookie name, or browser cookie APIs in every P2-A source. Hosted response checks extract only cookie names from temporary raw headers, while jar checks and subsequent gated navigation prove issuance/deletion without printing values. Normal logout is safely induced live; upstream-rejection cookie deletion is a provider dependency claim whose application control flow is isolated in the package seam, not falsely labeled as hosted evidence. Tests never use `set -x` or commit a jar.
- `requireOrigin()` is mandatory for login and logout even though the cookies use `SameSite=Lax`; login CSRF creates a new attacker-controlled session and is not prevented by SameSite alone.
- Origin comparison is exact across scheme, host, and explicit port. There is no CORS allowlist and no trusted cross-origin caller.
- Credential, Identity, and logout exceptions are never logged or returned. Static diagnostic messages may identify the response class, but must not include an email, password, cookie, JWT, rejected origin, provider body, or stack trace.
- All gate-generated decisions and all authentication endpoint responses are non-cacheable as specified above. A passed-through member document retains the cache/security headers that P1-E already owns.

## Files owned

- `netlify/edge-functions/gate.ts` — **new**, created exclusively by P2-A. P2-H does not edit it. P3-J later amends it after P2-G to replace the temporary organization predicate with grant-store read authorization and removes the legacy `roles` fallback.
- `netlify/functions/login.mjs` — **new**, created exclusively by P2-A. No later Build Order ticket is expected to amend it.
- `netlify/functions/logout.mjs` — **new**, created exclusively by P2-A. No later Build Order ticket is expected to amend it.
- `login/index.html` — **new**, created exclusively by P2-A. P1-E's pre-existing site builder copies it but does not own or rewrite the source.

No other implementation source is owned by P2-A. `docs/tickets/P2-A.md` is this specification, not an implementation path.

Shared runtime and integration surfaces are not source ownership: P1-C/P2-H's sequential revisions of `netlify/lib/identity.mjs`, P1-C's `package.json`, P1-E's `netlify.toml` and `templates/docbuild/src/site.ts`, ignored `_site/**` and `templates/docbuild/dist/**`, a local `.netlify` link, runtime cookies, Identity project settings, and deploy-preview configuration. P2-A may exercise these surfaces but must not edit or commit them.

## Dependencies

P2-A starts only on a base that contains finalized P1-C and P1-E implementations.

| Dependency | Exact contract P2-A needs | Boundary |
|---|---|---|
| P1-C | Root `package.json` pins `@netlify/identity@2.0.0` and Node `>=22.12.0`; `identify(req)` returns the temporary seven-field member/guest shape without throwing; `requireOrigin(req)` throws the normalized 403 `Response`; Functions use v2 default Fetch handlers; `netlify/functions/session.mjs` owns the custom `GET /api/session` route and its anonymous 401 response | P2-A imports these contracts and copies `session.mjs` only into the disposable runtime to prove `/api/*` exclusion; it does not amend P1-C files, assert P1-C's owned response body, or add dependencies |
| P1-E | `netlify.toml` points one `/*` Edge declaration at `gate`, excludes exactly `/login/*`, `/api/*`, and `/_assets/*`, publishes `_site`, and configures Functions; `buildSite()` copies an existing root `login/` tree byte-for-byte | P2-A fills the predeclared gate target and login source; it does not reopen config or site code. Its gate adds the early `/invite/` pathname-family pass-through; P1-E's existing API exclusion already makes exact `/api/accept` reachable downstream |
| P2-H integration compatibility, not a P2-A scheduling prerequisite | P2-H later changes non-null `identify(req)` to exactly `{sub,email,name,isOrg}` and removes `roles`; `isOrg` is always boolean | P2-A owns the dual-shape gate predicate and Test 2's source-bound fixture; P2-H owns only its `identity.mjs` amendment, must not edit any P2-A file, and executes that fixture by locating its unique standalone marker comment |
| P4-K downstream consumer, not a P2-A scheduling prerequisite | Later creates `invite/index.html` and the Function whose custom route is exact `POST /api/accept` | P4-K consumes P2-A's already-public `/invite/` family and P1-E's already-excluded API family. It must not edit `gate.ts` or `netlify.toml`; before it lands, both intended entry points safely reach downstream 404s |

P2-A is not a roles-only consumer. Any coordination note that describes it that way is stale and is superseded by this issue: P2-A owns and tests the `isOrg`-authoritative compatibility predicate before P2-H integrates, while P2-H retains exclusive ownership of the identity amendment.

Dependency and parallel-work order is explicit:

1. **Dependency integration:** land P1-C and P1-E before P2-A runtime work. Their ticket documents alone are specifications; their implementation files must exist on the working base.
2. **Safe P2-A source wave:** after that base exists, the gate lane (`gate.ts`) and the authentication lane (`login.mjs`, `logout.mjs`, `login/index.html`) may be researched or implemented in parallel because their exclusively owned source files are disjoint.
3. **P2-H compatibility wave:** after P1-C, P2-A and P2-H may be authored in parallel on isolated branches because P2-A owns only its four files while P2-H alone amends `identity.mjs`. They have an integration dependency, not shared source ownership: the P2-A predicate must land before or with P2-H on any branch that runs the gate.
4. **Shared-runtime integration wave:** combine the P2-A lanes and, when present, P2-H's identity amendment; build the P1-E site; start one linked Netlify runtime; and verify gate, Function, page, cookie, identity-shape, and static-copy behavior together. Cookie state, the linked project, `_site/`, Identity, and Netlify config are shared integration surfaces, so this wave is serialized. Rerun it after integrating P2-H even if P2-A passed against P1-C.
5. **Phase 2 concurrency:** after each listed ticket's own predecessors are integrated and green, P2-A can run in parallel with P2-B, P2-C, P2-D, P2-E, P2-F, P2-G, and P2-H only when their declared source surfaces remain disjoint. P2-G specifically starts only after P2-B is integrated and green. Generated outputs and a single disposable Netlify site are not safe concurrent test targets; use isolated temporary roots/sites.
6. **Downstream amendments:** P3-J starts only after P2-A and P2-G. It becomes the sole writer of the next `gate.ts` revision, removes the P1-C `roles` fallback, and replaces this transitional organization predicate with access resolution while preserving P2-A's anonymous redirect, exact public invite seam, exclusions, origin-independent read boundary, and fail-closed behavior. P4-K later consumes the preserved invite/API seams without editing the gate or declaration.

P2-A does not wait for P3-J. The temporary rule is intentional: organization members pass; every non-org session gets 403 on every document. This is a safe closed intermediate state, not incomplete guest support.

## Acceptance criteria

P2-A has two explicit completion states. **Source-complete** means tests 1, 2, 3, 5, and 6 pass on the dependency base and a reviewer completes the semantic four-file security-boundary check named below; it requires no Netlify account, site, hosted configuration, or external operator and is sufficient to implement, review, merge, and close the source ticket. **Release-verified** additionally means an authorized operator has run test 4 successfully against the disposable site. Test 4 is mandatory before production enablement/release and after P2-H integration, but unavailable credentials or provider access do not make source implementation incomplete.

### Source-completion gate

- [ ] `gate.ts` imports `identify` from exactly `../lib/identity.mjs`, calls it once, never calls `getUser()` directly, and exports no inline route configuration.
- [ ] An anonymous request to any gated path returns the exact 302, encoded `next`, empty body, and no-store header.
- [ ] The gate contains exactly `typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member")`; it does not infer organization status from email or provider metadata.
- [ ] A legacy P1-C `roles: ["member"]` identity and a final P2-H `isOrg: true` identity each reach the normal static response by the Edge Function returning `undefined`.
- [ ] A legacy P1-C guest, final P2-H `isOrg: false`, contradictory `{ isOrg: false, roles: ["member"] }`, and malformed shape each receive the exact plain-text 403 and no document bytes. Explicit false is authoritative and never falls back.
- [ ] Identity fixtures deliberately cross email and authority signals: an external-suffix legacy member and external-suffix final `isOrg: true` identity pass, while an organization-suffix legacy guest and organization-suffix final `isOrg: false` identity are denied. A static tripwire rejects any email read or suffix operation in `gate.ts`, so the P2-H helper's independent suffix classification cannot conceal a duplicate gate rule.
- [ ] P1-C/P2-H `identify()` returning `null` produces the anonymous 302. A hypothetical thrown identity error remains propagated by P2-H, is caught only around `await identify(req)` in `gate.ts`, and produces the exact non-disclosing 503 without document bytes, redirect, or exception output.
- [ ] `/login/*`, `/api/*`, and `/_assets/*` bypass the gate by P1-E declaration. The gate itself returns `undefined` without identity only for exact `/invite/` and descendants, for every method; bare `/invite`, case/percent variants, near-prefixes, root, document paths, aliases, permanent-ID routes, previews, and unknown future paths remain gated.
- [ ] Before P4-K, exact `/invite/`, a `/invite/*` descendant, and exact GET and POST `/api/accept` reach downstream 404 rather than login or 403. After P4-K, the static page is reachable at `/invite/` and only exact POST `/api/accept` invokes acceptance; P4-K does not amend the gate.
- [ ] `safeNext()` follows the documented control-before-trim order, accepts only the documented same-site destinations, applies the exact case/one-decode percent rules, revalidates parser-normalized and decoded paths as exact-one-leading-slash same-origin outputs, rejects every open-redirect/network-path/loop class, and strips fragments.
- [ ] Login and logout are Functions v2 handlers available only on `/api/login` and `/api/logout`, accept only POST, and return every exact status/body/header combination above.
- [ ] The isolated executable matrix proves every `safeNext()` type, slash, scheme, literal/encoded backslash, leading/interior/trailing pathname position for literal and encoded ASCII controls and DEL, leading/interior/trailing query and fragment positions for every raw ASCII control and DEL, reserved-path case/percent/dot-normalization boundary, normalized and encoded network-path attempts, malformed percent, fragment, trim, query-order, double-encoding, and near-prefix boundary, plus representative non-POST methods and every origin, form, missing/duplicate/File `next`, duplicate/File/empty credential, normalization—including internal-whitespace preservation—success, provider-rejection, and zero-byte/exact-text response branch.
- [ ] Test 2's Bash fence contains one unique standalone marker comment as the machine locator that P2-H's release launcher executes; the marked fixture remains P2-A-owned, source-bound to the production gate, and authoritative for its exact two-line output. Before resolving or creating any guarded path, it installs a first-signal HUP/INT/TERM latch with empty-root-safe ownership; recursive exact-source children prove early, active-command, post-result, delegated-delete, and final-yield delivery and exact 129/130/143 outcomes. A timeout is separate state: a later terminal signal overrides 124 and, once latched, neither containment failure nor cleanup can replace it with 125. Natural direct Bash HUP/INT/TERM/KILL outcomes map to 129/130/143/137 and are proved from this exact source.
- [ ] A 32-hex `P2H_OWNER_NONCE` alone never delegates. Delegation requires inherited fd4/fd5, a bounded HMAC-SHA-256 challenge, live owner/anchor PID/PGID, and pre-creation acknowledgement of nonexistent sibling root/evidence paths. P2-H's outside owner removes both after release or group death. A missing, silent, expired, malformed, replayed, wrong-MAC, wrong-PGID, or dead-owner response falls back before root creation to the finite 120-second local watchdog. Exact-source probes strip inherited fd names from nonce-only recursion with zero request bytes; strip nonce plus both fd names from natural-signal/timeout non-owner recursion; cover hostile silence and real outside-owner group KILL; prove disappearance, pre-harness path removal, and no fabricated release acknowledgement.
- [ ] In standalone/fallback mode the Node watchdog launches a retained detached Node anchor, verifies immediately before each group signal that the positive anchor PID is still the leader of the same PGID, then applies group TERM-to-KILL, reaps that anchor, and proves group disappearance. Its launch handshake has its own finite deadline: inner spawn error, anchor error/exit, malformed or missing launch message, and timeout all settle and perform memoized containment/reaping before callers continue. It never signals a bare or disk-loaded PGID after its retained anchor exits. Every recursive removal, including successful-path removal, runs as a separately retained, bounded delete group; removal success requires exit zero, anchor reaping, group disappearance, and path absence. A deletion or containment failure atomically retains mode-600 sibling evidence and prints the exact safe guarded-root, evidence-path, supervisor-pid, and verified leader-pgid; cleanup is single-entry, and a distinct second terminal signal during cleanup/finalization cannot replace the first latch. Under an authenticated P2-H lease the fixture uses `detached: false`, never calls `setsid`, `detached: true`, double-forks, or otherwise leaves P2-H's inherited group.
- [ ] Both authentication mutations call `requireOrigin(req)` before form parsing or Identity; missing, null, foreign-host, downgraded-scheme, and wrong-port origins all return the normalized 403, while an unexpected non-`Response` origin error is rethrown unchanged.
- [ ] Login failure does not distinguish an unknown user, a bad password, missing fields, or an Identity rejection, and never echoes an email, password, provider error, or unsafe `next`.
- [ ] Successful-login, rejected-login, successful-logout, and rejected-logout source paths return the exact documented responses and invoke the pinned package exactly as specified; platform cookie issuance, deletion, no-session behavior, preservation, and browser navigation remain release-gate results rather than source-completion claims.
- [ ] Semantic review of the four owned files confirms there is no indirect, computed, aliased, or obfuscated cookie access, `Set-Cookie` construction, alternate identity accessor, credential/error logging, or exception disclosure; the executable source scan is a direct-use tripwire, not a proof of arbitrary source semantics.
- [ ] `login/index.html` satisfies the exact semantic form, accessibility, inline error/next behavior, and no-external-request rules.
- [ ] `templates/build --site` copies `login/index.html` byte-for-byte to `_site/login/index.html`; the source page is not generated and `_site/` is not committed.
- [ ] No source outside the four owned implementation paths changes.
- [ ] The committed document artifacts remain byte-identical, the TypeScript builder typechecks, and the repository scrub gate passes.

### Hosted integration/release gate

- [ ] The transitive `@netlify/identity@2.0.0` import resolves in local runtime smoke and `getUser()` supplies four real authenticated disposable sessions independently inside hosted `deploy-preview` and `branch-deploy` contexts, whose Function runtimes report those exact `CONTEXT` values. Only after real hosted authentication, the disposable P2-A wrapper deterministically projects and reports a legacy `roles: ["member"]` shape, a legacy guest shape, exact `{sub,email,name,isOrg:true}`, and exact `{sub,email,name,isOrg:false}`; all four sessions prove both runtime cookies, the allow cases prove rejected-logout preservation, and all four prove valid logout deletion plus the following anonymous redirect.
- [ ] Authenticated hosted requests to `/.netlify/functions/login` and `/.netlify/functions/logout` prove the default Function routes are unavailable.
- [ ] Runtime response headers and cookie jars prove the platform supplies `nf_jwt` and `nf_refresh`, while direct-use static tripwires plus semantic review prove application code never authors or reads either cookie.
- [ ] Normal hosted logout proves both cookie deletions. Upstream-rejection control flow is proven only by the isolated package seam: inducing that provider failure safely in the hosted runtime is not supported and is not misrepresented as live evidence.
- [ ] A real headless browser parses the deployed login page, proves unique IDs, parsed form ownership, enabled and visible controls, visible focus outlines, initial/failed alert visibility, submits the actual form, follows the 302 navigation, receives both runtime cookies, and opens the gated destination without manually supplying a JWT.
- [ ] Same-origin hosted logout with and without a session is idempotent, redirects to `/login/`, clears or expires both runtime-owned cookies, and leaves the following gated navigation anonymous; a rejected cross-origin logout emits no cookie mutation and preserves the active session.
- [ ] Anonymous route matrices prove both deploy-preview and branch-deploy URLs are publicly reachable through P2-A itself, with no project/team access wall in front of the exact edge response. Before any mutation, the operator separately confirms that the site is blank, disposable, invite-only, free of production domains/data/users/environment values, and authorized for deletion; missing exact confirmation fails closed.
- [ ] Mandatory package installation, CLI link and deploy operations, browser/provider flows, fixture-user creation, every `curl`, local-runtime startup, user/site deletion, recursive tree deletion, and all other hosted work have explicit deterministic deadlines and a 4 MiB combined-output bound where the supervisor captures output. The embedded supervisor creates a dedicated detached POSIX group whose retained launcher is the group leader, validates positive supervisor/launcher identifiers, and immediately before each group signal rechecks that the still-live retained launcher PID remains the leader of that exact PGID. It atomically publishes an independent mode-600 evidence artifact under the mode-700 guarded root, waits for the launcher's positive child-launch message, opens a token-authenticated Unix control socket, and atomically publishes a mode-600 running record before a background runtime is considered established. The direct pinned CLI is the launcher's child; neither `npx` nor an npm launcher obscures the owned group.
- [ ] Only the live supervisor signals the PGID it created; shell cleanup never signals a PID or PGID read from disk. Probe, stop, and interruption requests must authenticate over the live control socket and match the atomic publication. A missing, malformed, manual-remediation, or stale record/socket fails closed without sending any signal and retains evidence for the operator. With proved cleanup, HUP/INT/TERM during the pre-publication handshake preserve 129/130/143, and a directly supervised command's natural HUP/INT/TERM/KILL preserves 129/130/143/137; status 125 is reserved for indeterminate cleanup/manual remediation or an unsafe invocation. The fixture's exact self-tests cover those signal mappings, nonzero exit, deadline, TERM-to-KILL escalation, authenticated external interruption, output overflow, parent-exit/background-descendant cleanup, ordinary launch/publication failure, pre-publication manual-evidence retention, evidence-persistence failure, stale-record rejection, and completed control-artifact cleanup.
- [ ] One reentrancy-protected terminal promise owns hosted TERM-to-KILL, leader reaping, group-disappearance proof, server close, stream close, artifact removal, evidence transition, and final event-loop yield. HUP/INT/TERM handlers remain installed throughout that promise; the first latched 129/130/143 overrides an earlier timeout 124 and remains the final status even when containment independently requires retained `manual-remediation` evidence (125 applies only when no terminal signal is latched). Deterministic real-signal probes cover pre-publication, active command, timeout cleanup, server close, artifact removal, final yield, and forced manual-remediation paths.
- [ ] On the normal supervisor path, TERM/KILL completes, the retained leader is reaped, the owned group disappears, per-user deletion is attempted, the authorized site is deleted, and only then is the validated guarded tree removed by a fresh supervised delete group. Before recursive deletion, a mode-600 evidence artifact is created beside rather than inside the guarded tree; success requires the delete command's zero status, TERM/KILL/reaping/group-disappearance proof, and path absence. Failure or timeout retains that sibling artifact with the exact site/root/evidence/record/PID/PGID locator. If SIGKILL cannot eliminate an uninterruptible process or the leader cannot be reaped within the terminal bound, the supervisor atomically changes every writable evidence surface to `manual-remediation` and forces outer retention; evidence-persistence failure itself retains the tree. Its exact safe diagnostic names `disposable-site-id`, `guarded-root`, `evidence-path`, `record-path`, `control-socket`, `supervisor-pid`, and `leader-pgid`; no secret appears, so the output remains actionable after the child shell exits. Site deletion or local deletion failure likewise keeps release verification open and retains the deletion-capable pinned CLI and evidence. No claim is made about a pre-existing npm-managed cache outside the guarded tree.
- [ ] P2-H's release launcher locates and executes the uniquely marked P2-A Test 2 fixture on the combined tree; the launcher is only a machine router, while this ticket's source-binding and exact-output contract remains the release authority for the transitional gate matrix.

## Test plan

Run commands from the repository root on a branch that already contains the P1-C and P1-E implementations, including P1-C's `netlify/functions/session.mjs` custom `/api/session` route. Tests 1, 2, 3, 5, and 6 are the locally completable source gate. Test 4 is the separately authorized hosted integration/release gate whether the integrated production `identify()` still has P1-C's shape or already has P2-H's shape. When P2-H is integrated, rerun test 4 on that combined base: the wrapper still calls that real helper first, then independently freezes both gate input shapes so a private organization suffix never enters this public fixture.

The local source gate supports macOS or Linux with Git, Bash 3.2 or later, Node 22.12 or later on the Node 22 line, npm from that Node installation, `curl`, `cmp`, `install`, `find`, `sort`, `seq`, `date`, and a BSD- or GNU-compatible `mktemp` accepting a six-`X` template. Test 4 additionally requires outbound HTTPS/DNS, OpenSSL with `rand`, temporary guarded-root installations of exact `netlify-cli@24.2.0` and `playwright@1.55.0` plus Playwright's Chromium runtime and host libraries, an authenticated CLI principal, the two required noninteractive operator inputs shown in test 4, and the exact disposable Netlify/Identity permissions and settings stated below. Test 4 resolves and executes `$P2A_TEST_ROOT/node_modules/.bin/netlify` directly; it never places `npx` or an npm launcher between the supervisor and the CLI. `PLAYWRIGHT_BROWSERS_PATH` is confined to the guarded temporary tree. Never enable shell tracing during the live test.

1. Verify source boundaries, route declarations, and every static login-page and accessibility requirement:

   ```bash
   node --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";
   import vm from "node:vm";

   const gate = readFileSync("netlify/edge-functions/gate.ts", "utf8");
   const login = readFileSync("netlify/functions/login.mjs", "utf8");
   const logout = readFileSync("netlify/functions/logout.mjs", "utf8");
   const page = readFileSync("login/index.html", "utf8");
   const toml = readFileSync("netlify.toml", "utf8");

   function parseAttributes(source, label) {
     const attributes = new Map();
     let cursor = 0;
     while (cursor < source.length) {
       while (/\s/.test(source[cursor] ?? "")) cursor += 1;
       if (cursor >= source.length || source[cursor] === "/") break;
       const nameMatch = /^[^\s"'<>/=]+/.exec(source.slice(cursor));
       assert.ok(nameMatch, `${label}: malformed attribute at ${cursor}`);
       const name = nameMatch[0].toLowerCase();
       assert.ok(!attributes.has(name), `${label}: duplicate ${name}`);
       cursor += nameMatch[0].length;
       while (/\s/.test(source[cursor] ?? "")) cursor += 1;
       let value = null;
       if (source[cursor] === "=") {
         cursor += 1;
         while (/\s/.test(source[cursor] ?? "")) cursor += 1;
         const quote = source[cursor];
         if (quote === '"' || quote === "'") {
           const end = source.indexOf(quote, cursor + 1);
           assert.ok(end >= 0, `${label}: unterminated ${name}`);
           value = source.slice(cursor + 1, end);
           cursor = end + 1;
         } else {
           const valueMatch = /^[^\s"'=<>`]+/.exec(source.slice(cursor));
           assert.ok(valueMatch, `${label}: malformed ${name} value`);
           value = valueMatch[0];
           cursor += value.length;
         }
       }
       attributes.set(name, value);
     }
     while (/\s/.test(source[cursor] ?? "")) cursor += 1;
     assert.ok(cursor === source.length || source.slice(cursor).trim() === "/", `${label}: malformed tail`);
     return attributes;
   }

   function scanStartTags(source) {
     const tags = [];
     const lower = source.toLowerCase();
     let cursor = 0;
     while (cursor < source.length) {
       const start = source.indexOf("<", cursor);
       if (start < 0) break;
       if (source.startsWith("<!--", start)) {
         const end = source.indexOf("-->", start + 4);
         assert.ok(end >= 0, `unclosed comment at ${start}`);
         cursor = end + 3;
         continue;
       }
       let quote = "";
       let end = start + 1;
       for (; end < source.length; end += 1) {
         const character = source[end];
         if (quote) {
           if (character === quote) quote = "";
         } else if (character === '"' || character === "'") {
           quote = character;
         } else if (character === ">") {
           break;
         }
       }
       assert.ok(end < source.length, `unclosed tag at ${start}`);
       const open = source.slice(start, end + 1);
       cursor = end + 1;
       if (/^<\s*[!/]/.test(open)) continue;
       const match = /^<\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(open);
       if (!match) continue;
       const name = match[1].toLowerCase();
       const attributeSource = open.slice(match[0].length, -1);
       const tag = {
         name,
         attributes: parseAttributes(attributeSource, `${name} at ${start}`),
         start,
         end: end + 1,
       };
       tags.push(tag);
       if (name === "script" || name === "style") {
         const close = `</${name}>`;
         const closeAt = lower.indexOf(close, cursor);
         assert.ok(closeAt >= 0, `unclosed ${name}`);
         cursor = closeAt + close.length;
       }
     }
     return tags;
   }

   const tags = scanStartTags(page);
   function exactlyOne(name, predicate, label) {
     const matches = tags.filter((tag) => tag.name === name && predicate(tag.attributes));
     assert.equal(matches.length, 1, label);
     return matches[0];
   }
   function contentOf(tag) {
     const close = `</${tag.name}>`;
     const end = page.toLowerCase().indexOf(close, tag.end);
     assert.ok(end >= 0, `unclosed ${tag.name}`);
     return page.slice(tag.end, end);
   }

   assert.match(gate, /^import \{ identify \} from "\.\.\/lib\/identity\.mjs";$/m);
   assert.equal((gate.match(/^import \{ identify \} from "\.\.\/lib\/identity\.mjs";$/gm) ?? []).length, 1);
   assert.equal((gate.match(/\bimport\b/g) ?? []).length, 1, "the gate has exactly one import token");
   assert.deepEqual(gate.match(/^import .*;$/gm), ['import { identify } from "../lib/identity.mjs";'],
     "the gate has one allowed import and cannot alias a package-level identity accessor");
   assert.match(gate,
     /^export default async function gate\(req: Request\): Promise<Response \| undefined>\s*\{/m);
   assert.doesNotMatch(gate, /\bgetUser\s*\(/);
   assert.doesNotMatch(gate, /\bemail\b|endsWith\s*\(/,
     "the gate must consume identity facts without duplicating P2-H's suffix rule");
   assert.doesNotMatch(gate, /export\s+const\s+config/);
   assert.ok(gate.includes('typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member")'));
   assert.match(login, /export\s+function\s+safeNext\s*\(/);
   assert.match(login, /export\s+default\s+async\s+function\s+handler\s*\(req\)/);
   assert.match(login, /export\s+const\s+config\s*=\s*\{\s*path:\s*"\/api\/login"\s*\}/);
   assert.match(logout, /export\s+default\s+async\s+function\s+handler\s*\(req\)/);
   assert.match(logout, /export\s+const\s+config\s*=\s*\{\s*path:\s*"\/api\/logout"\s*\}/);
   for (const [name, source, packageImport] of [
     ["login", login, 'import { login } from "@netlify/identity";'],
     ["logout", logout, 'import { logout } from "@netlify/identity";'],
   ]) {
     assert.equal((source.match(/^import \{ requireOrigin \} from "\.\.\/lib\/identity\.mjs";$/gm) ?? []).length, 1,
       `${name} must use the exact shared-origin import path`);
     assert.deepEqual((source.match(/^import .*;$/gm) ?? []).sort(), [
       'import { requireOrigin } from "../lib/identity.mjs";', packageImport,
     ].sort(), `${name} has exactly the two allowed imports`);
     assert.equal((source.match(/\bimport\b/g) ?? []).length, 2, `${name} has exactly two import tokens`);
     assert.match(source,
       /export\s+default\s+async\s+function\s+handler\s*\(req\)\s*\{\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*if\s*\(\s*req\.method\s*!==\s*"POST"\s*\)/,
       `${name} must make the non-POST branch its first executable statement`);
     assert.doesNotMatch(source, /\bimport\s*\(/, `${name} must not dynamically import an alternate boundary`);
   }
   assert.match(login, /form\.getAll\s*\(\s*["']email["']\s*\)/);
   assert.match(login, /form\.getAll\s*\(\s*["']password["']\s*\)/);
   assert.match(login, /form\.getAll\s*\(\s*["']next["']\s*\)/);
   assert.match(login, /\.trim\s*\(\s*\)\s*\.toLowerCase\s*\(\s*\)/);
   assert.doesNotMatch(login, /toLocaleLowerCase|\.normalize\s*\(/);
   assert.doesNotMatch(`${login}\n${logout}`, /clientContext|module\.exports|export\s*\{\s*handler/);
   for (const [name, source] of Object.entries({ gate, login, logout, page })) {
     assert.doesNotMatch(source, /Set-Cookie|\bnf_jwt\b|\bnf_refresh\b|document\s*\.\s*cookie|\bcookieStore\b/i,
       `${name} must not author or read runtime cookies`);
   }
   for (const [name, source] of Object.entries({ gate, login, logout })) {
     assert.doesNotMatch(source,
       /headers\s*\.\s*(?:get|getSetCookie)\s*\(\s*["'`]cookie["'`]|\b(?:cookies?|cookieStore)\s*\.|["'`]set-cookie["'`]/i,
       `${name} must not access a generic cookie header or cookie API`);
   }
   assert.doesNotMatch(`${gate}\n${login}\n${logout}`,
     /\bconsole\s*\.|process\s*\.\s*(?:stdout|stderr|emitWarning)|\b(?:Deno|Bun)\s*\.|\bprint\s*\(|\blogger\b/i,
     "authentication and gate source must not log runtime values or exceptions");

   const edgeBlocks = toml.match(/\[\[edge_functions\]\][\s\S]*?(?=\n\[|$)/g) ?? [];
   assert.deepEqual(edgeBlocks.map((block) => block.replace(/\r\n/g, "\n").trim()), [
     '[[edge_functions]]\n  path = "/*"\n  excludedPath = ["/login/*", "/api/*", "/_assets/*"]\n  function = "gate"',
   ], "repository netlify.toml must contain exactly the settled gate block and no extra filter or exclusion");

   assert.match(page, /^<!doctype html>/i);
   assert.match(page, /<\/body>\s*<\/html>\s*$/i);
   const htmlTag = exactlyOne("html", () => true, "expected one html element");
   assert.equal(htmlTag.attributes.get("lang"), "en");
   exactlyOne("meta", (attributes) => attributes.get("charset") === "utf-8", "expected UTF-8 meta");
   exactlyOne("meta", (attributes) => attributes.get("name") === "viewport"
     && /(?:^|,)\s*width=device-width(?:\s*,|$)/.test(attributes.get("content") ?? ""), "expected viewport meta");
   const title = exactlyOne("title", () => true, "expected one title");
   assert.equal(contentOf(title), "Sign in");
   const heading = exactlyOne("h1", () => true, "expected one h1");
   assert.equal(contentOf(heading).trim(), "Sign in");
   const form = exactlyOne("form", () => true, "expected one form");
   assert.equal(form.attributes.get("method"), "post");
   assert.equal(form.attributes.get("action"), "/api/login");
   const formClose = page.toLowerCase().indexOf("</form>", form.end);
   assert.ok(formClose > form.end, "expected closing form");
   const errorMatches = tags.filter((tag) => tag.attributes.get("id") === "login-error");
   assert.equal(errorMatches.length, 1, "expected login alert");
   const error = errorMatches[0];
   assert.equal(error.attributes.get("role"), "alert");
   assert.ok(error.attributes.has("hidden"));
   assert.equal(contentOf(error), "Sign-in failed. Check your details and try again.");
   const nextInput = exactlyOne("input", (attributes) => attributes.get("name") === "next", "expected next input");
   assert.equal(nextInput.attributes.get("type"), "hidden");
   assert.equal(nextInput.attributes.get("value"), "/");
   const emailLabel = exactlyOne("label", (attributes) => attributes.get("for") === "login-email", "expected email label");
   assert.equal(contentOf(emailLabel).trim(), "Email");
   const emailInput = exactlyOne("input", (attributes) => attributes.get("id") === "login-email", "expected email input");
   assert.equal(emailInput.attributes.get("name"), "email");
   assert.equal(emailInput.attributes.get("type"), "email");
   assert.equal(emailInput.attributes.get("autocomplete"), "username");
   assert.ok(emailInput.attributes.has("required"));
   assert.ok(!emailInput.attributes.has("value"));
   const passwordLabel = exactlyOne("label", (attributes) => attributes.get("for") === "login-password", "expected password label");
   assert.equal(contentOf(passwordLabel).trim(), "Password");
   const passwordInput = exactlyOne("input", (attributes) => attributes.get("id") === "login-password", "expected password input");
   assert.equal(passwordInput.attributes.get("name"), "password");
   assert.equal(passwordInput.attributes.get("type"), "password");
   assert.equal(passwordInput.attributes.get("autocomplete"), "current-password");
   assert.ok(passwordInput.attributes.has("required"));
   assert.ok(!passwordInput.attributes.has("value"));
   const submit = exactlyOne("button", (attributes) => attributes.get("type") === "submit", "expected submit button");
   assert.equal(contentOf(submit).trim(), "Sign in");
   const ids = tags.flatMap((tag) => tag.attributes.has("id") ? [tag.attributes.get("id")] : []);
   assert.equal(ids.length, new Set(ids).size, "every parsed ID must be unique");
   for (const tag of tags) {
     assert.ok(!tag.attributes.has("disabled"), `<${tag.name}> must not be disabled`);
     assert.ok(!tag.attributes.has("inert"), `<${tag.name}> must not be inert`);
     assert.notEqual(tag.attributes.get("aria-hidden")?.toLowerCase(), "true", `<${tag.name}> must not be aria-hidden`);
     if (tag.attributes.has("hidden")) assert.equal(tag, error, "only the initial error alert may be hidden");
   }
   for (const control of [nextInput, emailLabel, emailInput, passwordLabel, passwordInput, submit]) {
     assert.ok(control.start >= form.end && control.end <= formClose,
       `${control.name} is not a descendant of the sole form`);
     assert.ok(!control.attributes.has("form"), `${control.name} overrides its form owner`);
   }
   assert.doesNotMatch(page, /sign[ -]?up|password recovery|forgot password|oauth|action="\/api\/logout"/i);
   const credentialInputs = tags.filter((tag) => tag.name === "input"
     && ["email", "password"].includes(tag.attributes.get("name")));
   assert.equal(credentialInputs.length, 2);

   const forbiddenElements = new Set([
     "img", "iframe", "object", "embed", "audio", "video", "source", "track",
     "picture", "svg", "math", "portal", "link", "base", "frame", "frameset", "applet",
   ]);
   const requestAttributes = new Set([
     "src", "srcset", "href", "xlink:href", "data", "poster", "background",
     "ping", "formaction", "manifest", "action", "style", "archive", "codebase",
     "classid", "profile", "longdesc", "imagesrcset",
   ]);
   for (const tag of tags) {
     assert.ok(!forbiddenElements.has(tag.name), `forbidden request-capable <${tag.name}>`);
     assert.ok(!(tag.name === "meta" && tag.attributes.get("http-equiv")?.toLowerCase() === "refresh"));
     for (const attribute of tag.attributes.keys()) {
       assert.doesNotMatch(attribute, /^on/i, `forbidden inline handler ${tag.name}[${attribute}]`);
       if (!requestAttributes.has(attribute)) continue;
       assert.ok(tag === form && attribute === "action" && tag.attributes.get(attribute) === "/api/login",
         `forbidden request attribute ${tag.name}[${attribute}]`);
     }
   }

   const styleTags = tags.filter((tag) => tag.name === "style");
   assert.equal(styleTags.length, 1, "expected exactly one style total");
   const styleTag = exactlyOne("style", (attributes) => attributes.size === 0, "expected one attribute-free style");
   const css = contentOf(styleTag);
   assert.match(css, /font-family\s*:[^;}]*(?:system-ui|-apple-system|sans-serif)/i);
   const widths = [...css.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)\s*(rem|ch|px)\b/gi)]
     .map((match) => ({ value: Number(match[1]), unit: match[2].toLowerCase() }));
   assert.ok(widths.some(({ value, unit }) => (unit === "rem" && value >= 18 && value <= 40)
     || (unit === "ch" && value >= 36 && value <= 80)
     || (unit === "px" && value >= 288 && value <= 640)), "missing bounded readable max-width");
   assert.doesNotMatch(css,
     /@import\b|@font-face\b|\burl\s*\(|\b(?:-webkit-)?image-set\s*\(|\bexpression\s*\(|\bbehavior\s*:|-moz-binding/i);
   assert.doesNotMatch(css, /\\/, "CSS escapes can disguise request-capable tokens");
   const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
     selectors: match[1].split(",").map((selector) => selector.trim()),
     declarations: new Map(match[2].split(";").map((declaration) => declaration.trim()).filter(Boolean)
       .map((declaration) => {
         const colon = declaration.indexOf(":");
         assert.ok(colon > 0, `malformed CSS declaration: ${declaration}`);
         return [declaration.slice(0, colon).trim().toLowerCase(), declaration.slice(colon + 1).trim()];
       })),
   }));
   const focusRule = cssRules.find(({ selectors }) => selectors.includes("input:focus-visible")
     && selectors.includes("button:focus-visible"));
   assert.ok(focusRule, "missing exact input/button :focus-visible selectors");
   const outline = focusRule.declarations.get("outline") ?? "";
   assert.match(outline, /(?:^|\s)(?:[1-9]\d*|\d*\.[1-9]\d*)px(?:\s|$)/);
   assert.match(outline, /\b(?:solid|double|dotted|dashed)\b/i);
   assert.match(outline, /#[0-9a-f]{6}\b/i, "focus outline needs an explicit opaque color");
   assert.doesNotMatch(outline, /\b(?:none|transparent)\b/i);

   const scripts = tags.filter((tag) => tag.name === "script");
   assert.equal(scripts.length, 1, "expected exactly one script total");
   const scriptTag = scripts[0];
   assert.equal(scriptTag.attributes.size, 0, "script must be inline, attribute-free, and classic/nonmodule");
   const scriptSource = contentOf(scriptTag);
   assert.ok(scriptTag.start > page.toLowerCase().indexOf("</form>"));
   assert.doesNotMatch(scriptSource,
     /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|Image|Audio|DOMParser|Proxy|Reflect|setTimeout|setInterval)\b|navigator\s*\.\s*sendBeacon|serviceWorker\s*\.\s*register|\bimport\s*\(|\bObject\s*\.\s*(?:assign|defineProperty)|document\s*\.\s*(?:createElement|createElementNS|write|writeln)|\b(?:window\s*\.\s*)?open\s*\(|(?:window\s*\.\s*)?location\s*\.\s*(?:assign|replace)\s*\(|(?:window\s*\.\s*)?location\s*(?:\.\s*href\s*)?=|document\s*\.\s*location\s*=|\.(?:src|href|action|formAction|innerHTML|outerHTML|textContent|style)\s*=|\.(?:submit|requestSubmit|click|insertAdjacentHTML|createContextualFragment|append|prepend|replaceChildren|setAttribute|setAttributeNS|toggleAttribute|insertRule)\s*\(/i);
   assert.doesNotMatch(scriptSource, /\b(?:eval|Function|constructor|prototype|HTMLFormElement|CSSStyleSheet)\b|__proto__/);
   const nextSelectorLiteral = /(["'])input\[name="next"\]\1/g;
   assert.equal((scriptSource.match(nextSelectorLiteral) ?? []).length, 1,
     "the one required next selector must be the only bracket-bearing string literal");
   const scriptWithoutNextSelector = scriptSource.replace(nextSelectorLiteral, "");
   assert.doesNotMatch(scriptWithoutNextSelector, /[\[\]\\]/,
     "computed access and every escaped/code-point spelling outside the required selector are forbidden");
   assert.doesNotMatch(scriptSource,
     /\b(?:globalThis|window|top|parent|frames|self)\b|document\s*\.\s*(?:body|head|documentElement|styleSheets)|\.\s*(?:style|className|classList|dataset|attributes|setProperty|addRule|insertBefore|before|after|replaceWith|remove)\b/,
     "the page script cannot reach alternate globals, CSSOM, layout, or mutation surfaces");
   assert.doesNotMatch(scriptSource, /\b(?:email|password|credential)\b/i,
     "the page script must not read or assign credential values");
   assert.equal((scriptSource.match(/document\s*\.\s*querySelector\s*\(/g) ?? []).length, 1);
   assert.match(scriptSource,
     /document\s*\.\s*querySelector\s*\(\s*(["'])input\[name="next"\]\1\s*\)/);
   assert.equal((scriptSource.match(/document\s*\.\s*getElementById\s*\(/g) ?? []).length, 1);
   assert.match(scriptSource, /document\s*\.\s*getElementById\s*\(\s*(["'])login-error\1\s*\)/);
   assert.doesNotMatch(scriptSource,
     /\b(?:querySelectorAll|getElementsByName|getElementsByTagName|getElementsByClassName|namedItem)\b|document\s*\.\s*forms\b|\.elements\b/,
     "dynamic element-name lookup is forbidden");
   assert.equal((scriptSource.match(/\.value\s*=/g) ?? []).length, 1,
     "the hidden next assignment must be the script's only runtime value assignment");
   assert.doesNotMatch(scriptSource,
     /\.value\s*(?:\|\|=|&&=|\?\?=|\+=|-=|\*=|\/=|%=|\+\+|--)|\.valueAs\w*\s*=|\.setRangeText\s*\(/,
     "alternate input-value mutation is forbidden");
   assert.doesNotMatch(scriptSource, /preventDefault\s*\(/);
   function runPageScript(search) {
     const hidden = { value: "/" };
     const error = { hidden: true };
     vm.runInNewContext(scriptSource, {
       URLSearchParams,
       location: { search },
       document: {
         querySelector: (selector) => {
           assert.equal(selector, 'input[name="next"]', "script queried an undeclared control");
           return hidden;
         },
         getElementById: (id) => {
           assert.equal(id, "login-error", "script queried an undeclared element ID");
           return error;
         },
       },
     });
     return { hidden, error };
   }
   const failure = runPageScript("?next=%2Fexample%2F%3Fview%3Dreview&error=1");
   assert.equal(failure.hidden.value, "/example/?view=review");
   assert.equal(failure.error.hidden, false);
   const quiet = runPageScript("?next=&error=0");
   assert.equal(quiet.hidden.value, "/");
   assert.equal(quiet.error.hidden, true);
   const duplicateNext = runPageScript("?next=&next=%2Flater%2F&error=0");
   assert.equal(duplicateNext.hidden.value, "/");
   const duplicateErrorHidden = runPageScript("?next=%2Ffirst%2F&next=%2Flater%2F&error=0&error=1");
   assert.equal(duplicateErrorHidden.hidden.value, "/first/");
   assert.equal(duplicateErrorHidden.error.hidden, true);
   const duplicateErrorShown = runPageScript("?error=1&error=0");
   assert.equal(duplicateErrorShown.error.hidden, false);
   console.log("PASS  P2-A source, login-page, and accessibility contracts");
   NODE
   ```

   Expected: exit `0` and exactly `PASS  P2-A source, login-page, and accessibility contracts`. The source oracle enforces the exact and sole identity/origin/package imports, the exact gate signature, a first-statement non-POST branch, `getAll()` field extraction, non-locale/non-normalizing email operations, and direct lexical tripwires against cookie access, alternate identity access, and logging. Those tripwires are deliberately not described as proof against intentionally obfuscated source: acceptance also requires semantic review of the four small owned files against the cookie and logging boundary. The repository's one Edge block is byte-normalized and compared with the complete settled declaration, so an extra exclusion or method field fails. The quote-aware start-tag scanner verifies real attributes rather than matching `data-*` lookalikes; the assertions reject duplicate IDs, disabled/inert/hidden controls, and `aria-hidden`, and prove the hidden destination, both associated labels and inputs, and submit control occur inside the sole source form. Exactly one attribute-free style and one attribute-free classic script may exist. The script's one required `input[name="next"]` selector literal is the sole square-bracket exception; removing that exact literal before the bracket/escape tripwire keeps every computed-access spelling forbidden. The script's first-occurrence `next`/`error` semantics are executable, its only `.value =` assignment is the hidden destination, and alternate global, CSSOM, layout, mutation, and undeclared-element surfaces fail. These static assertions are paired with the release-gate parsed-DOM browser oracle, which decides actual form ownership, visibility, focus cascade, submission, redirect, and cookie handoff rather than attributing those runtime facts to regexes.

2. Copy the modules into an isolated package mock and test every `safeNext()`, gate, login, logout, status, header, body, ordering, normalization, and rejection boundary deterministically:

   ```bash
   # P2-A gate compatibility source fixture
   bash <<'BASH'
   set -euo pipefail
   node --input-type=module --eval '
     import assert from "node:assert/strict";
     import { spawn, execFileSync } from "node:child_process";
     import { createHmac, randomBytes } from "node:crypto";
     import {
       chmodSync, closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync,
       realpathSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync,
     } from "node:fs";
     import { join } from "node:path";

     if (process.platform === "win32") throw new Error("the source fixture requires POSIX groups");
     const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
     async function within(promise, milliseconds) {
       let timer;
       try { return await Promise.race([promise, new Promise((resolve) => {
         timer = setTimeout(() => resolve(null), milliseconds);
       })]); } finally { clearTimeout(timer); }
     }
     const SIGNAL_STATUS = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGKILL: 137, SIGTERM: 143 });
     const ownerNonce = process.env.P2H_OWNER_NONCE ?? "";
     const ownerCandidate = /^[0-9a-f]{32}$/.test(ownerNonce)
       && process.env.P2H_OWNER_REQUEST_FD === "5"
       && process.env.P2H_OWNER_RESPONSE_FD === "4";
     const externalOwnerProbe = process.env.P2A_SOURCE_EXTERNAL_OWNER_PROBE ?? "";
     const sourceSelfProbe = process.env.P2A_SOURCE_SELF_PROBE === "1";
     if (!["", "early", "active", "post-result", "delete", "final", "manual-final", "kill", "timeout-cleanup"].includes(externalOwnerProbe)
       || (externalOwnerProbe !== "" && typeof process.send !== "function")) {
       throw new Error("invalid external-owner source probe");
     }
     let externallyOwned = false;
     let ownerLease = null;

     function installInterruptionHandlers(receive) {
       const handlers = new Map();
       for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
         const handler = () => receive(signal);
         handlers.set(signal, handler);
         process.on(signal, handler);
       }
       return handlers;
     }

     let latchedSignalStatus = 0;
     let timedOut = false;
     let signalResolve;
     const interrupted = new Promise((resolve) => { signalResolve = resolve; });
     const signalHandlers = installInterruptionHandlers((signalName) => {
       if (latchedSignalStatus !== 0) return;
       latchedSignalStatus = SIGNAL_STATUS[signalName];
       process.exitCode = latchedSignalStatus;
       signalResolve({ kind: "signal", code: latchedSignalStatus });
     });
     let parent = "";
     let root = "";
     let evidencePath = "";
     let cleanupPromise = null;

     function finalStatus(fallback, manual = false) {
       return latchedSignalStatus || (manual ? 125 : (timedOut ? 124 : fallback));
     }

     function processGroup(pid) {
       const output = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
         encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
       }).trim();
       if (!/^[0-9]+$/.test(output)) throw new Error("process group is unavailable");
       const group = Number(output);
       if (!Number.isSafeInteger(group) || group <= 1) throw new Error("unsafe process group");
       return group;
     }

     function hmac(value) {
       return createHmac("sha256", Buffer.from(ownerNonce, "hex"))
         .update(JSON.stringify(value)).digest("hex");
     }

     let ownerInput = null;
     let ownerBuffer = "";
     const ownerLines = [];
     const ownerWaiters = [];
     let ownerReadFailed = false;
     let ownerChannelClosed = false;
     function startOwnerChannel() {
       if (ownerInput) return;
       ownerInput = createReadStream(null, { fd: 4, autoClose: false });
       ownerInput.setEncoding("utf8");
       ownerInput.on("data", (chunk) => {
         ownerBuffer += chunk;
         if (Buffer.byteLength(ownerBuffer) > 16384) {
           ownerReadFailed = true;
           ownerBuffer = "";
         }
         for (;;) {
           const newline = ownerBuffer.indexOf("\n");
           if (newline < 0) break;
           const line = ownerBuffer.slice(0, newline);
           ownerBuffer = ownerBuffer.slice(newline + 1);
           const waiter = ownerWaiters.shift();
           if (waiter) waiter(line); else ownerLines.push(line);
         }
       });
       ownerInput.on("error", () => { ownerReadFailed = true; });
       ownerInput.on("end", () => { ownerReadFailed = true; });
     }

     async function readOwnerLine(milliseconds) {
       if (ownerReadFailed) throw new Error("owner response channel closed");
       if (ownerLines.length) return ownerLines.shift();
       let timer;
       const line = await Promise.race([
         new Promise((resolve) => ownerWaiters.push(resolve)),
         new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("owner response timeout")), milliseconds); }),
       ]);
       clearTimeout(timer);
       return line;
     }

     async function ownerExchange(action, fields, milliseconds = 1000) {
       startOwnerChannel();
       const request = { version: 1, action, ...fields };
       writeSync(5, `${JSON.stringify({ ...request, mac: hmac(request) })}\n`);
       if (action === "release" && externalOwnerProbe === "delete") {
         process.send({ type: "external-owner-delete" });
         await pause(500);
       }
       const response = JSON.parse(await readOwnerLine(milliseconds));
       const { mac, ...signed } = response ?? {};
       if (response?.version !== 1 || response?.action !== `${action}-ack`
         || typeof mac !== "string" || mac !== hmac(signed)) {
         throw new Error("owner authentication failed");
       }
       for (const [key, value] of Object.entries(fields)) {
         if (response[key] !== value) throw new Error("owner response mismatch");
       }
       return response;
     }

     function closeOwnerChannel() {
       if (ownerChannelClosed) return;
       ownerChannelClosed = true;
       try { ownerInput?.destroy(); } catch {}
       for (const descriptor of [4, 5]) {
         try { closeSync(descriptor); } catch {}
       }
     }

     async function claimExternalOwner() {
       if (!ownerCandidate) return null;
       try {
         const challenge = randomBytes(16).toString("hex");
         const claim = await ownerExchange("claim", { challenge, childPid: process.pid });
         if (!Number.isSafeInteger(claim.ownerPid) || claim.ownerPid <= 1
           || !Number.isSafeInteger(claim.anchorPgid) || claim.anchorPgid <= 1
           || !Number.isSafeInteger(claim.leaseDeadlineMs)
           || claim.leaseDeadlineMs <= Date.now() + 250 || claim.leaseDeadlineMs > Date.now() + 120000
           || typeof claim.ownerRoot !== "string" || !claim.ownerRoot.startsWith("/")
           || claim.ownerRoot === "/" || realpathSync(claim.ownerRoot) !== claim.ownerRoot
           || !statSync(claim.ownerRoot).isDirectory()
           || processGroup(process.pid) !== claim.anchorPgid
           || processGroup(claim.anchorPgid) !== claim.anchorPgid
           || processGroup(claim.ownerPid) === claim.anchorPgid) {
           throw new Error("owner lease is not live");
         }
         process.kill(claim.ownerPid, 0);
         return claim;
       } catch {
         closeOwnerChannel();
         return null;
       }
     }

     function alive(pgid) {
       try { process.kill(-pgid, 0); return true; }
       catch (error) {
         if (error?.code === "ESRCH") return false;
         if (error?.code === "EPERM") return true;
         throw error;
       }
     }
     function signal(pgid, name) {
       assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
       try { process.kill(-pgid, name); }
       catch (error) { if (error?.code !== "ESRCH") throw error; }
     }
     async function gone(pgid, milliseconds) {
       const end = Date.now() + milliseconds;
       while (alive(pgid) && Date.now() < end) await pause(25);
       return !alive(pgid);
     }
     function persist(path, value) {
       const pending = `${path}.new`;
       writeFileSync(pending, `${JSON.stringify(value)}\n`, { mode: 0o600 });
       renameSync(pending, path);
     }
     function launch(command, args, options = {}) {
       const child = spawn(command, args, options);
       const launched = new Promise((resolve, reject) => {
         child.once("spawn", resolve);
         child.once("error", reject);
       });
       const result = new Promise((resolve) => child.once("exit", (code, childSignal) => {
         resolve({ code, signal: childSignal });
       }));
       return { child, launched, result };
     }
     const anchorSource = `
       import { spawn } from "node:child_process";
       const [inheritFd3, command, ...args] = process.argv.slice(1);
       if (typeof process.send !== "function" || !command) process.exit(127);
       for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signalName, () => {});
       const stdio = inheritFd3 === "1"
         ? ["ignore", "inherit", "inherit", 3]
         : ["ignore", "inherit", "inherit"];
       const probe = process.env.P2A_LAUNCH_FAILURE ?? "";
       if (probe === "anchor-exit") process.exit(91);
       if (probe === "malformed") process.send({ type: "launched", childPid: "invalid" });
       else {
         const commandChild = spawn(command, args, { env: process.env, stdio });
         commandChild.once("spawn", () => {
           if (probe !== "missing") process.send({ type: "launched", childPid: commandChild.pid });
         });
         commandChild.once("error", () => process.send({ type: "result", code: null, signal: null, spawnError: true }));
         commandChild.once("exit", (code, childSignal) => {
           process.send({ type: "result", code, signal: childSignal, spawnError: false });
         });
       }
       setInterval(() => {}, 60000);
     `;

     function launchOwned(command, args, { env = process.env, inheritFd3 = false,
       stdio = "ignore", launchProbe = "" } = {}) {
       const descriptors = inheritFd3
         ? ["ignore", stdio === "ignore" ? "ignore" : "inherit",
           stdio === "ignore" ? "ignore" : "inherit", 3, "ipc"]
         : ["ignore", stdio === "ignore" ? "ignore" : "inherit",
           stdio === "ignore" ? "ignore" : "inherit", "ipc"];
       const anchorEnvironment = { ...env };
       if (launchProbe) anchorEnvironment.P2A_LAUNCH_FAILURE = launchProbe;
       else delete anchorEnvironment.P2A_LAUNCH_FAILURE;
       const anchor = spawn(process.execPath,
         ["--input-type=module", "--eval", anchorSource, inheritFd3 ? "1" : "0", command, ...args], {
           detached: true, env: anchorEnvironment, stdio: descriptors,
         });
       let anchorExited = false;
       let startupResolve;
       let commandResolve;
       const startup = new Promise((resolve) => { startupResolve = resolve; });
       const commandResult = new Promise((resolve) => { commandResolve = resolve; });
       anchor.on("message", (message) => {
         if (message?.type === "launched") startupResolve(Number.isSafeInteger(message.childPid)
           && message.childPid > 1 ? { kind: "launched", childPid: message.childPid }
             : { kind: "malformed" });
         if (message?.type === "result") {
           const value = { code: message.code, signal: message.signal,
             spawnError: message.spawnError === true };
           commandResolve(value);
           startupResolve({ kind: "early-result", value });
         }
       });
       const result = new Promise((resolve) => {
         anchor.once("error", () => {
           anchorExited = true;
           startupResolve({ kind: "anchor-error" });
           resolve({ code: null, signal: null });
         });
         anchor.once("exit", (code, childSignal) => {
           anchorExited = true;
           startupResolve({ kind: "anchor-exit" });
           resolve({ code, signal: childSignal });
         });
       });
       const run = { child: anchor, commandResult, result, termination: null,
         get anchorExited() { return anchorExited; } };
       run.launched = (async () => {
         const outcome = await within(startup, sourceSelfProbe || launchProbe ? 500 : 5000);
         if (outcome?.kind === "launched" && currentAnchor(run)) return outcome.childPid;
         const terminal = await terminateOwned(run, 0);
         const error = new Error(`owned launch failed: ${outcome?.kind ?? "timeout"}`);
         error.cleanupComplete = terminal.complete;
         throw error;
       })();
       return run;
     }

     function currentAnchor(run) {
       if (run.anchorExited || !Number.isSafeInteger(run.child.pid) || run.child.pid <= 1) return false;
       try { return processGroup(run.child.pid) === run.child.pid && alive(run.child.pid); }
       catch { return false; }
     }

     async function terminateOwned(run, grace = 100) {
       if (run.termination) return run.termination;
       run.termination = (async () => {
       const pgid = run.child.pid;
       if (!currentAnchor(run)) {
         const reaped = await within(run.result, 2000) !== null;
         const disappeared = reaped && (!Number.isSafeInteger(pgid) || pgid <= 1
           || await gone(pgid, 2000));
         return { complete: reaped && disappeared, pgid, owned: false, reaped, disappeared };
       }
       signal(pgid, "SIGTERM");
       if (grace > 0) await pause(grace);
       if (currentAnchor(run)) signal(pgid, "SIGKILL");
       const reaped = await within(run.result, 2000) !== null;
       const disappeared = reaped && await gone(pgid, 2000);
       return { complete: reaped && disappeared, pgid, owned: true };
       })();
       return run.termination;
     }
     async function watchdog(command, args, { timeout, stdio = "ignore", env } = {}) {
       const run = launchOwned(command, args, { stdio, env });
       await run.launched;
       const pgid = run.child.pid;
       assert.ok(Number.isSafeInteger(pgid) && pgid > 1 && currentAnchor(run));
       const timeoutResult = Symbol("timeout");
       const outcome = await Promise.race([
         run.commandResult,
         pause(timeout).then(() => timeoutResult),
       ]);
       const terminal = await terminateOwned(run);
       return { complete: terminal.complete, outcome, pgid, result: await Promise.race([
         run.result, pause(1).then(() => null),
       ]), run };
     }

     async function removeTreeBounded(path, verifiedPgid = "not-applicable") {
       if (!path) return true;
       const deletion = launchOwned(process.execPath, ["--input-type=module", "--eval",
         `import { rmSync } from "node:fs"; rmSync(process.argv[1], { recursive: true, force: true });`, path]);
       let outcome;
       try {
         await Promise.race([deletion.launched, pause(2000).then(() => { throw new Error("delete launch timeout"); })]);
         outcome = await Promise.race([
           deletion.commandResult,
           pause(5000).then(() => ({ code: 124, signal: null, spawnError: false })),
         ]);
       } catch {
         outcome = { code: 127, signal: null, spawnError: true };
       }
       const terminal = await terminateOwned(deletion, 100);
       return outcome.code === 0 && !outcome.signal && terminal.complete && !existsSync(path);
     }

     async function proveOwnedLaunchFailures() {
       if (sourceSelfProbe || externalOwnerProbe !== "") return;
       for (const [mode, command, args] of [
         ["inner-spawn-error", "p2-a-command-does-not-exist", []],
         ["anchor-exit", "sh", ["-c", "exit 0"]],
         ["malformed", "sh", ["-c", "exit 0"]],
         ["missing", "sh", ["-c", "trap \"\" TERM; sleep 30"]],
       ]) {
         const run = launchOwned(command, args, {
           launchProbe: mode === "inner-spawn-error" ? "" : mode,
         });
         const failure = await within(run.launched.then(() => null, (error) => error), 5000);
         assert.match(failure?.message ?? "", /^owned launch failed: /, mode);
         assert.equal(failure.cleanupComplete, true, mode);
         assert.notEqual(await within(run.result, 100), null, mode);
         if (Number.isSafeInteger(run.child.pid) && run.child.pid > 1) {
           assert.equal(await gone(run.child.pid, 2000), true, mode);
         }
       }
     }

     // Exercise the exact handler installer before any guarded path exists. Each
     // child owns no descendants, publishes a positive readiness handshake, and
     // must preserve its signal status while its guarded-root variable is empty.
     async function proveEmptyRootSignalSafety() {
       for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
         const source = `
           const SIGNAL_STATUS = ${JSON.stringify(SIGNAL_STATUS)};
           ${installInterruptionHandlers.toString()}
           let guardedRoot = "";
           installInterruptionHandlers((receivedSignal) => {
             if (guardedRoot !== "") process.exit(125);
             process.exit(SIGNAL_STATUS[receivedSignal] ?? 125);
           });
           process.send({ type: "ready", guardedRoot });
           setInterval(() => {}, 60000);
         `;
         const proof = launch(process.execPath, ["--input-type=module", "--eval", source], {
           stdio: ["ignore", "ignore", "ignore", "ipc"],
         });
         let reaped = false;
         try {
           await proof.launched;
           assert.ok(Number.isSafeInteger(proof.child.pid) && proof.child.pid > 1);
           const ready = await Promise.race([
             new Promise((resolve) => proof.child.once("message", resolve)),
             pause(2000).then(() => null),
           ]);
           assert.deepEqual(ready, { type: "ready", guardedRoot: "" });
           process.kill(proof.child.pid, signalName);
           const outcome = await Promise.race([proof.result, pause(2000).then(() => null)]);
           assert.deepEqual(outcome, { code: SIGNAL_STATUS[signalName], signal: null });
           reaped = true;
         } finally {
           if (!reaped && Number.isSafeInteger(proof.child.pid) && proof.child.pid > 1) {
             try { process.kill(proof.child.pid, "SIGKILL"); } catch (error) {
               if (error?.code !== "ESRCH") throw error;
             }
             await Promise.race([proof.result, pause(2000)]);
           }
         }
       }
     }

     async function harnessRemove(path) {
       if (!path || !existsSync(path)) return true;
       try {
         execFileSync(process.execPath, ["--input-type=module", "--eval",
           `import { rmSync } from "node:fs"; rmSync(process.argv[1], { recursive: true, force: true });`, path], {
             timeout: 2000, stdio: "ignore",
           });
       } catch { return false; }
       return !existsSync(path);
     }

     function signedFor(nonce, value) {
       return createHmac("sha256", Buffer.from(nonce, "hex"))
         .update(JSON.stringify(value)).digest("hex");
     }

     // Run this exact eval source recursively behind a live fake P2-H owner. The
     // child receives two inherited one-way descriptors, authenticates every
     // response, stays in our inherited group, and delegates only after reserve.
     async function proveExternalOwnerSignalAuthority() {
       if (sourceSelfProbe || externalOwnerProbe !== "") return;
       for (const phase of ["early", "active", "post-result", "delete", "final", "manual-final", "kill"]) {
         for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
           const nonce = randomBytes(16).toString("hex");
           const ownerRoot = mkdtempSync(join(realpathSync(process.env.TMPDIR || "/tmp"), "p2-a-owner."));
           chmodSync(ownerRoot, 0o700);
           const environment = {
             ...process.env,
             P2H_OWNER_NONCE: nonce,
             P2H_OWNER_REQUEST_FD: "5",
             P2H_OWNER_RESPONSE_FD: "4",
             P2A_SOURCE_SELF_PROBE: "1",
             P2A_SOURCE_EXTERNAL_OWNER_PROBE: phase,
           };
           const proof = launch(process.execPath, process.execArgv, {
             detached: true,
             env: environment,
             stdio: ["ignore", "ignore", "pipe", "pipe", "pipe", "pipe", "ipc"],
           });
           let errorOutput = "";
           let requestBuffer = "";
           let reservedRoot = "";
           let reservedEvidence = "";
           let releaseAcked = false;
           proof.child.stderr.setEncoding("utf8");
           proof.child.stderr.on("data", (chunk) => { errorOutput += chunk; });
           proof.child.stdio[3].on("error", () => {});
           proof.child.stdio[5].setEncoding("utf8");
           proof.child.stdio[5].on("data", async (chunk) => {
             requestBuffer += chunk;
             for (;;) {
               const newline = requestBuffer.indexOf("\n");
               if (newline < 0) break;
               const line = requestBuffer.slice(0, newline);
               requestBuffer = requestBuffer.slice(newline + 1);
               const request = JSON.parse(line);
               const { mac, ...signedRequest } = request;
               assert.equal(mac, signedFor(nonce, signedRequest));
               let response = { ...signedRequest, action: `${request.action}-ack` };
               if (request.action === "claim") {
                 const anchorPgid = processGroup(proof.child.pid);
                 response = { ...response, ownerPid: process.pid, anchorPgid, ownerRoot,
                   leaseDeadlineMs: Date.now() + (phase === "manual-final" ? 1000 : 30000) };
               } else if (request.action === "reserve") {
                 assert.equal(request.guardedRoot.slice(0, request.guardedRoot.lastIndexOf("/")), ownerRoot);
                 assert.equal(request.evidencePath.slice(0, request.evidencePath.lastIndexOf("/")), ownerRoot);
                 reservedRoot = request.guardedRoot;
                 reservedEvidence = request.evidencePath;
               } else if (request.action === "release") {
                 assert.equal(request.guardedRoot, reservedRoot);
                 assert.equal(request.evidencePath, reservedEvidence);
                 if (phase === "manual-final") continue;
                 assert.equal(await harnessRemove(reservedRoot), true);
                 try { unlinkSync(reservedEvidence); } catch (error) {
                   if (error?.code !== "ENOENT") throw error;
                 }
                 assert.equal(existsSync(reservedRoot), false);
                 assert.equal(existsSync(reservedEvidence), false);
                 releaseAcked = true;
               }
               if (request.action === "release") assert.equal(releaseAcked, true);
               proof.child.stdio[4].write(`${JSON.stringify({
                 ...response, mac: signedFor(nonce, response),
               })}\n`);
             }
           });
           const ready = new Promise((resolve) => proof.child.once("message", resolve));
           let reaped = false;
           try {
             await proof.launched;
             assert.ok(Number.isSafeInteger(proof.child.pid) && proof.child.pid > 1);
             proof.child.stdio[3].end(phase === "kill" ? "sleep 30\n"
               : phase === "active" ? "sleep 0.5\n" : "exit 0\n");
             const handshake = await Promise.race([ready, pause(3000).then(() => null)]);
             assert.deepEqual(handshake, { type: `external-owner-${phase}` });
             if (phase === "kill") signal(proof.child.pid, "SIGKILL");
             else {
               process.kill(proof.child.pid, signalName);
               if (["delete", "final", "manual-final"].includes(phase)) {
                 const second = { SIGHUP: "SIGTERM", SIGINT: "SIGHUP", SIGTERM: "SIGINT" }[signalName];
                 await pause(25);
                 process.kill(proof.child.pid, second);
               }
             }
             const outcome = await Promise.race([proof.result, pause(6000).then(() => null)]);
             if (phase === "kill") {
               assert.deepEqual(outcome, { code: null, signal: "SIGKILL" }, `${phase}-${signalName}`);
               assert.equal(await gone(proof.child.pid, 3000), true);
               assert.ok(reservedRoot && reservedEvidence);
               assert.equal(releaseAcked, false);
               assert.equal(await harnessRemove(reservedRoot), true);
               try { unlinkSync(reservedEvidence); } catch (error) {
                 if (error?.code !== "ENOENT") throw error;
               }
               assert.equal(existsSync(reservedRoot), false);
               assert.equal(existsSync(reservedEvidence), false);
             }
             else assert.deepEqual(outcome, { code: SIGNAL_STATUS[signalName], signal: null }, `${phase}-${signalName}`);
             if (phase !== "manual-final") assert.equal(errorOutput, "");
             else assert.match(errorOutput, /manual remediation required/);
             assert.equal(existsSync(ownerRoot), true);
             if (phase !== "manual-final") {
               if (reservedRoot !== "") assert.equal(existsSync(reservedRoot), false);
               if (reservedEvidence !== "") assert.equal(existsSync(reservedEvidence), false);
             }
             if (!["early", "manual-final", "kill"].includes(phase)) assert.equal(releaseAcked, true);
             reaped = true;
           } finally {
             if (!reaped && Number.isSafeInteger(proof.child.pid) && proof.child.pid > 1) {
               try { process.kill(-proof.child.pid, "SIGKILL"); } catch (error) {
                 if (error?.code !== "ESRCH") throw error;
               }
               await Promise.race([proof.result, pause(3000)]);
             }
             assert.equal(await harnessRemove(ownerRoot), true);
           }
         }
       }

       // Simulate inherited outer fds; non-hostile strips names, hostile restores them.
       for (const hostile of [false, true]) {
         const environment = { ...process.env, P2A_SOURCE_SELF_PROBE: "1",
           P2H_OWNER_NONCE: randomBytes(16).toString("hex"),
           P2H_OWNER_REQUEST_FD: "5", P2H_OWNER_RESPONSE_FD: "4" };
         if (hostile) {
           environment.P2H_OWNER_REQUEST_FD = "5";
           environment.P2H_OWNER_RESPONSE_FD = "4";
         } else {
           delete environment.P2H_OWNER_REQUEST_FD;
           delete environment.P2H_OWNER_RESPONSE_FD;
         }
         const fallback = launch(process.execPath, process.execArgv, {
           env: environment,
           stdio: ["ignore", "ignore", "ignore", "pipe", "pipe", "pipe"],
         });
         let ownerRequest = "";
         fallback.child.stdio[5].setEncoding("utf8");
         fallback.child.stdio[5].on("data", (chunk) => { ownerRequest += chunk; });
         const requestClosed = new Promise((resolve) => fallback.child.stdio[5].once("close", () => resolve(true)));
         await fallback.launched;
         fallback.child.stdio[3].end("exit 0\n");
         const outcome = await Promise.race([fallback.result, pause(12000).then(() => null)]);
         assert.deepEqual(outcome, { code: 0, signal: null }, `fallback-hostile-${hostile}`);
         assert.equal(await within(requestClosed, 1000), true, `fallback-request-close-${hostile}`);
         if (!hostile) assert.equal(ownerRequest, "", "nonce-only fallback sent an owner request");
         else assert.match(ownerRequest, /"action":"claim"/, "hostile request probe");
       }
       const nonOwnerEnvironment = { ...process.env, P2A_SOURCE_SELF_PROBE: "1" };
       for (const name of ["P2H_OWNER_NONCE", "P2H_OWNER_REQUEST_FD", "P2H_OWNER_RESPONSE_FD"])
         delete nonOwnerEnvironment[name];
       for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM", "SIGKILL"]) {
         const natural = launch(process.execPath, process.execArgv, {
           env: nonOwnerEnvironment,
           stdio: ["ignore", "ignore", "ignore", "pipe"],
         });
         await natural.launched;
         natural.child.stdio[3].end(`kill -${signalName} $$\n`);
         assert.deepEqual(await within(natural.result, 12000),
           { code: SIGNAL_STATUS[signalName], signal: null }, signalName);
       }

       for (const signalName of ["SIGHUP", "SIGINT", "SIGTERM"]) {
         const timeoutSignal = launch(process.execPath, process.execArgv, {
           env: { ...nonOwnerEnvironment,
             P2A_SOURCE_EXTERNAL_OWNER_PROBE: "timeout-cleanup" },
           stdio: ["ignore", "ignore", "ignore", "pipe", "ipc"],
         });
         await timeoutSignal.launched;
         timeoutSignal.child.stdio[3].end("trap \"\" TERM; sleep 30\n");
         const ready = await Promise.race([
           new Promise((resolve) => timeoutSignal.child.once("message", resolve)),
           pause(3000).then(() => null),
         ]);
         assert.deepEqual(ready, { type: "external-owner-timeout-cleanup" });
         process.kill(timeoutSignal.child.pid, signalName);
         assert.deepEqual(await Promise.race([timeoutSignal.result, pause(12000).then(() => null)]),
           { code: SIGNAL_STATUS[signalName], signal: null });
       }
     }

     sourceMain: {
     await proveOwnedLaunchFailures();
     await proveEmptyRootSignalSafety();
     await proveExternalOwnerSignalAuthority();
     if (externalOwnerProbe === "early") {
       process.send({ type: "external-owner-early" });
       await pause(500);
     }
     if (latchedSignalStatus !== 0) {
       process.exitCode = finalStatus(0);
       if (sourceSelfProbe && process.connected) process.disconnect();
       break sourceMain;
     }

     ownerLease = await claimExternalOwner();
     externallyOwned = ownerLease !== null;
     if (externallyOwned) {
       parent = ownerLease.ownerRoot;
       for (let attempt = 0; attempt < 32 && root === ""; attempt += 1) {
         const suffix = randomBytes(6).toString("base64url").replace(/[-_]/g, "a").slice(0, 6);
         const candidate = join(parent, `p2-a-unit.${suffix}`);
         const candidateEvidence = join(parent, `.p2-a-unit.${suffix}.evidence.json`);
         if (existsSync(candidate) || existsSync(candidateEvidence)) continue;
         try {
           await ownerExchange("reserve", {
             challenge: ownerLease.challenge, childPid: process.pid,
             anchorPgid: ownerLease.anchorPgid, guardedRoot: candidate,
             evidencePath: candidateEvidence,
           });
           root = candidate;
           evidencePath = candidateEvidence;
         } catch { root = ""; }
       }
       if (root === "") throw new Error("authenticated owner did not reserve a guarded root");
       mkdirSync(root, { mode: 0o700 });
     } else {
       parent = realpathSync(process.env.TMPDIR || "/tmp");
       assert.ok(parent.startsWith("/") && parent !== "/");
       root = mkdtempSync(join(parent, "p2-a-unit."));
       evidencePath = `${root}.evidence.json`;
     }
     chmodSync(root, 0o700);
     assert.equal(root.slice(0, root.lastIndexOf("/")), parent);
     assert.match(root.slice(root.lastIndexOf("/") + 1), /^p2-a-unit\.[^/]{6}$/);

     function printSourceRemediation(leaderPgid) {
       console.error(`ERROR  P2-A source watchdog requires manual remediation; guarded-root=${root} evidence-path=${evidencePath} supervisor-pid=${process.pid} leader-pgid=${leaderPgid}; manual remediation required`);
     }

     async function cleanupGuarded(fallbackStatus, { manual = false,
       leaderPgid = "not-applicable" } = {}) {
       if (cleanupPromise) return cleanupPromise;
       cleanupPromise = (async () => {
         let clean = !manual;
         if (clean && externallyOwned) {
           try {
             process.kill(ownerLease.ownerPid, 0);
             await ownerExchange("release", {
               challenge: ownerLease.challenge, childPid: process.pid,
               anchorPgid: ownerLease.anchorPgid, guardedRoot: root, evidencePath,
             }, Math.max(250, Math.min(5000, ownerLease.leaseDeadlineMs - Date.now())));
             clean = !existsSync(root) && !existsSync(evidencePath);
           } catch { clean = false; }
         } else if (clean) {
           clean = await removeTreeBounded(root, leaderPgid);
           if (clean) {
             try { unlinkSync(evidencePath); }
             catch (error) { if (error?.code !== "ENOENT") clean = false; }
           }
         }
         if (!clean) {
           try {
             persist(evidencePath, {
               version: 1, state: "manual-remediation", guardedRoot: root, evidencePath,
               supervisorPid: process.pid, leaderPgid,
             });
           } catch {}
           printSourceRemediation(leaderPgid);
         }
         if (externallyOwned) closeOwnerChannel();
         if (externalOwnerProbe === "final" || externalOwnerProbe === "manual-final") {
           process.send({ type: `external-owner-${externalOwnerProbe}` });
           await pause(500);
         }
         await pause(0);
         process.exitCode = finalStatus(fallbackStatus, !clean);
         if (sourceSelfProbe && process.connected) process.disconnect();
         return clean;
       })();
       return cleanupPromise;
     }

     try {
       persist(evidencePath, {
         version: 1, state: "preparing", guardedRoot: root, evidencePath,
         supervisorPid: process.pid,
         leaderPgid: externallyOwned ? ownerLease.anchorPgid : null,
       });
     } catch {
       printSourceRemediation(externallyOwned ? ownerLease.anchorPgid : "unassigned");
       await cleanupGuarded(125, {
         manual: true, leaderPgid: externallyOwned ? ownerLease.anchorPgid : "unassigned",
       });
       break sourceMain;
     }
     await Promise.race([pause(0), interrupted]);
     if (latchedSignalStatus !== 0) {
       await cleanupGuarded(0, {
         leaderPgid: externallyOwned ? ownerLease.anchorPgid : "not-applicable",
       });
       break sourceMain;
     }

     // Deterministic watchdog regression: TERM-resistant Bash and its descendant
     // are killed as one owned group and the direct child is reaped.
     if (!externallyOwned && !sourceSelfProbe) {
       const resistant = await watchdog("sh", ["-c",
         "trap \"\" TERM; (trap \"\" TERM; sleep 30) & wait"], { timeout: 100 });
       assert.equal(typeof resistant.outcome, "symbol");
       assert.equal(resistant.complete, true);

       // Deterministic watchdog regression: a child that exits cannot leave a
       // delayed descendant outside the group-cleanup proof.
       const marker = join(root, "source-watchdog-descendant.marker");
       const descendant = await watchdog("sh", ["-c",
         "(sleep 1; printf leak >\"$1\") & exit 0", "p2-a-watchdog", marker], { timeout: 2000 });
       assert.equal(descendant.complete, true);
       await pause(1200);
       try { readFileSync(marker); assert.fail("watchdog descendant survived"); }
       catch (error) { assert.equal(error?.code, "ENOENT"); }
     }

     const fixtureEnvironment = { ...process.env, P2A_UNIT_PARENT: parent, P2A_UNIT_ROOT: root };
     const fixture = externallyOwned
       ? launch("bash", ["/dev/fd/3"], {
         detached: false, env: fixtureEnvironment,
         stdio: ["ignore", "inherit", "inherit", "inherit"],
       })
       : launchOwned("bash", ["/dev/fd/3"], {
         env: fixtureEnvironment, inheritFd3: true, stdio: "inherit",
       });
     let pgid;
     try {
       await fixture.launched;
       pgid = externallyOwned ? ownerLease.anchorPgid : fixture.child.pid;
       assert.ok(Number.isSafeInteger(pgid) && pgid > 1);
       if (!externallyOwned) {
         assert.ok(currentAnchor(fixture));
         persist(evidencePath, {
           version: 1, state: "running", guardedRoot: root, evidencePath,
           supervisorPid: process.pid, leaderPgid: pgid,
         });
       }
     } catch {
       let complete = true;
       if (!externallyOwned && Number.isSafeInteger(fixture.child.pid) && fixture.child.pid > 1) {
         complete = (await terminateOwned(fixture, 0)).complete;
       }
       await cleanupGuarded(127, { manual: !complete, leaderPgid: pgid ?? "unassigned" });
       break sourceMain;
     }

     // P2-H supplies the enclosing detached anchor, timeout, TERM/KILL, reaping,
     // and retained evidence. Staying in that inherited group is mandatory.
     if (externallyOwned) {
       if (["active", "kill"].includes(externalOwnerProbe)) {
         process.send({ type: `external-owner-${externalOwnerProbe}` });
       }
       const leaseWait = Math.max(1, ownerLease.leaseDeadlineMs - Date.now());
       const ownerDeadline = Symbol("owner-deadline");
       let leaseTimer;
       let outcome = await Promise.race([
         fixture.result,
         interrupted,
         new Promise((resolve) => { leaseTimer = setTimeout(() => resolve(ownerDeadline), leaseWait); }),
       ]);
       clearTimeout(leaseTimer);
       let delegatedComplete = true;
       if (outcome === ownerDeadline || outcome?.kind === "signal") {
         if (outcome === ownerDeadline) timedOut = true;
         try {
           await ownerExchange("interrupt", {
             challenge: ownerLease.challenge, childPid: process.pid,
             anchorPgid: ownerLease.anchorPgid, guardedRoot: root, evidencePath,
           }, Math.max(250, Math.min(2000, ownerLease.leaseDeadlineMs - Date.now())));
         } catch {}
         const remaining = Math.max(1, ownerLease.leaseDeadlineMs - Date.now());
         let completionTimer;
         const completed = await Promise.race([
           fixture.result,
           new Promise((resolve) => { completionTimer = setTimeout(() => resolve(null), remaining); }),
         ]);
         clearTimeout(completionTimer);
         if (completed === null) delegatedComplete = false;
         else outcome = completed;
       }
       const completionStatus = outcome.code
         || (outcome.signal ? SIGNAL_STATUS[outcome.signal] ?? 125 : 0);
       process.exitCode = finalStatus(completionStatus);
       if (externalOwnerProbe === "post-result") {
         process.send({ type: "external-owner-post-result" });
         await pause(500);
       }
       await cleanupGuarded(completionStatus, {
         manual: !delegatedComplete, leaderPgid: ownerLease.anchorPgid,
       });
     } else {
       let timer;
       const outcome = await Promise.race([
         fixture.commandResult,
         interrupted,
         new Promise((resolve) => { timer = setTimeout(() => {
           timedOut = true;
           resolve({ kind: "timeout", code: 124 });
         }, sourceSelfProbe ? 500 : 120_000); }),
       ]);
       clearTimeout(timer);
       if (externalOwnerProbe === "timeout-cleanup" && outcome.kind === "timeout") {
         process.send({ type: "external-owner-timeout-cleanup" });
         await pause(500);
       }
       const terminal = await terminateOwned(fixture,
         latchedSignalStatus || timedOut ? (sourceSelfProbe ? 100 : 5000) : 0);
       if (timedOut && !latchedSignalStatus) {
         console.error("ERROR  P2-A source fixture exceeded its 120-second watchdog");
       }
       const completionStatus = outcome.code
         || (outcome.signal ? SIGNAL_STATUS[outcome.signal] ?? 125 : 0);
       await cleanupGuarded(completionStatus, { manual: !terminal.complete, leaderPgid: pgid });
     }
     }
   ' 3<<'P2A_SOURCE_FIXTURE'
   set -euo pipefail
   P2A_UNIT_PARENT="${P2A_UNIT_PARENT:-}"
   P2A_UNIT_ROOT="${P2A_UNIT_ROOT:-}"
   if [[ -z "$P2A_UNIT_ROOT" || "${P2A_UNIT_ROOT%/*}" != "$P2A_UNIT_PARENT" \
     || "$P2A_UNIT_ROOT" == "$P2A_UNIT_PARENT" || "${P2A_UNIT_ROOT##*/}" != p2-a-unit.?????? \
     || ! -d "$P2A_UNIT_ROOT" ]]; then
     echo 'unit-test root must be the expected direct child of its resolved parent' >&2
     exit 1
   fi
   mkdir -p "$P2A_UNIT_ROOT/netlify/functions" "$P2A_UNIT_ROOT/netlify/edge-functions" \
     "$P2A_UNIT_ROOT/netlify/lib" "$P2A_UNIT_ROOT/node_modules/@netlify/identity"
   cp netlify/functions/login.mjs "$P2A_UNIT_ROOT/netlify/functions/login.mjs"
   cp netlify/functions/logout.mjs "$P2A_UNIT_ROOT/netlify/functions/logout.mjs"
   cp netlify/edge-functions/gate.ts "$P2A_UNIT_ROOT/netlify/edge-functions/gate.ts"
   cp netlify/lib/identity.mjs "$P2A_UNIT_ROOT/netlify/lib/identity.mjs"
   install -m 600 /dev/stdin "$P2A_UNIT_ROOT/package.json" <<'JSON'
   { "private": true, "type": "module" }
   JSON
   install -m 600 /dev/stdin "$P2A_UNIT_ROOT/node_modules/@netlify/identity/package.json" <<'JSON'
   { "name": "@netlify/identity", "version": "2.0.0", "type": "module", "exports": "./index.mjs" }
   JSON
   install -m 600 /dev/stdin "$P2A_UNIT_ROOT/node_modules/@netlify/identity/index.mjs" <<'MOCK'
   const state = globalThis.__p2aIdentityState ??= {
     loginCalls: [], logoutCalls: 0, originCalls: 0, getUserCalls: 0,
     loginError: null, logoutError: null, getUserError: null,
   };
   export async function getUser() {
     state.getUserCalls += 1;
     if (state.getUserError) throw state.getUserError;
     return null;
   }
   export async function login(email, password) {
     state.loginCalls.push({ email, password });
     if (state.loginError) throw state.loginError;
     return { id: "u_fixture_member_17" };
   }
   export async function logout() {
     state.logoutCalls += 1;
     if (state.logoutError) throw state.logoutError;
   }
   export function verifyRequestOrigin(req) {
     state.originCalls += 1;
     const actual = req.headers.get("origin");
     if (!actual || actual !== new URL(req.url).origin) throw new Error("mock rejected origin");
   }
   MOCK
   (
     cd "$P2A_UNIT_ROOT"
     NODE_NO_WARNINGS=1 node --experimental-strip-types --input-type=module <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync, writeFileSync } from "node:fs";
   import * as loginModule from "./netlify/functions/login.mjs";
   import * as logoutModule from "./netlify/functions/logout.mjs";
   import { identify as dependencyIdentify } from "./netlify/lib/identity.mjs";

   assert.deepEqual(Object.keys(loginModule).sort(), ["config", "default", "safeNext"]);
   assert.deepEqual(Object.keys(logoutModule).sort(), ["config", "default"]);
   const { default: loginHandler, safeNext } = loginModule;
   const { default: logoutHandler } = logoutModule;

   const cases = [
     [undefined, "/"],
     [null, "/"],
     [new String("/example/"), "/"],
     [new File(["/example/"], "next.txt"), "/"],
     ["", "/"],
     [" \t\r\n", "/"],
     ["\u00a0/example/\u00a0", "/example/"],
     ["\ufeff/example/\ufeff", "/example/"],
     ["\t/example/", "/"],
     ["/example/\n", "/"],
     ["/", "/"],
     ["/example/?view=review", "/example/?view=review"],
     ["/d/a1b2c3", "/d/a1b2c3"],
     ["/example/#notes", "/example/"],
     ["  /trimmed/?ok=1  ", "/trimmed/?ok=1"],
     ["example/", "/"],
     ["https://elsewhere.invalid/", "/"],
     ["//elsewhere.invalid/", "/"],
     ["///elsewhere.invalid/", "/"],
     ["/%2e%2e//elsewhere.invalid/path", "/"],
     ["/.%2e//elsewhere.invalid/path", "/"],
     ["/x/%2e%2e//elsewhere.invalid/path", "/"],
     ["/x/..//elsewhere.invalid/path", "/"],
     ["/%2felsewhere.invalid/path", "/"],
     ["/%2F%2Felsewhere.invalid/path", "/"],
     ["/\\\\elsewhere.invalid/", "/"],
     ["/example\\next", "/"],
     ["/login", "/"],
     ["/login/?next=%2Fexample%2F", "/"],
     ["/api", "/"],
     ["/api/session", "/"],
     ["/_assets", "/"],
     ["/_assets/app.js", "/"],
     ["/.netlify", "/"],
     ["/.netlify/functions/login", "/"],
     ["/%6cogin", "/"],
     ["/login%2Fnext", "/"],
     ["/%61pi/session", "/"],
     ["/%5fassets/app.js", "/"],
     ["/%2enetlify/functions/login", "/"],
     ["/example%5ctail", "/"],
     ["/example/%0atail", "/"],
     ["/%", "/"],
     ["/%2", "/"],
     ["/%gg", "/"],
     ["/Login/", "/Login/"],
     ["/API/session", "/API/session"],
     ["/_Assets/app.js", "/_Assets/app.js"],
     ["/.NETLIFY/functions/login", "/.NETLIFY/functions/login"],
     ["/%256cogin", "/%256cogin"],
     ["/ordinary%2fsection?x=%2f", "/ordinary%2fsection?x=%2f"],
     ["/ordered/?b=2&a=1&b=3", "/ordered/?b=2&a=1&b=3"],
     ["/x/../login/", "/"],
     ["/%2e%2e/login/", "/"],
     ["/x/%2e%2e/api/session", "/"],
     ["/%252e%252e//elsewhere.invalid/path", "/%252e%252e//elsewhere.invalid/path"],
     ["/login-example/", "/login-example/"],
     ["/apiary/", "/apiary/"],
     ["/_assets-old/", "/_assets-old/"],
     ["/.netlify-old/", "/.netlify-old/"],
   ];
   for (const [input, expected] of cases) assert.equal(safeNext(input), expected, String(input));
   for (let code = 0; code <= 0x1f; code += 1) {
     const control = String.fromCharCode(code);
     assert.equal(safeNext(`/example/${control}tail`), "/", `control ${code}`);
     assert.equal(safeNext(`${control}/example/`), "/", `leading control ${code}`);
     assert.equal(safeNext(`/example/${control}`), "/", `trailing control ${code}`);
     assert.equal(safeNext(`/example/?q=${control}tail`), "/", `leading query control ${code}`);
     assert.equal(safeNext(`/example/?q=head${control}tail`), "/", `interior query control ${code}`);
     assert.equal(safeNext(`/example/?q=tail${control}`), "/", `trailing query control ${code}`);
     assert.equal(safeNext(`/example/#${control}tail`), "/", `leading fragment control ${code}`);
     assert.equal(safeNext(`/example/#head${control}tail`), "/", `interior fragment control ${code}`);
     assert.equal(safeNext(`/example/#tail${control}`), "/", `trailing fragment control ${code}`);
     const encoded = `%${code.toString(16).padStart(2, "0")}`;
     assert.equal(safeNext(`/${encoded}example/`), "/", `leading encoded control ${code}`);
     assert.equal(safeNext(`/example/${encoded}tail`), "/", `interior encoded control ${code}`);
     assert.equal(safeNext(`/example/${encoded}`), "/", `trailing encoded control ${code}`);
   }
   assert.equal(safeNext(`/example/${String.fromCharCode(0x7f)}tail`), "/", "DEL");
   assert.equal(safeNext(`${String.fromCharCode(0x7f)}/example/`), "/", "leading DEL");
   assert.equal(safeNext(`/example/${String.fromCharCode(0x7f)}`), "/", "trailing DEL");
   assert.equal(safeNext(`/example/?q=${String.fromCharCode(0x7f)}tail`), "/", "leading query DEL");
   assert.equal(safeNext(`/example/?q=head${String.fromCharCode(0x7f)}tail`), "/", "interior query DEL");
   assert.equal(safeNext(`/example/?q=tail${String.fromCharCode(0x7f)}`), "/", "trailing query DEL");
   assert.equal(safeNext(`/example/#${String.fromCharCode(0x7f)}tail`), "/", "leading fragment DEL");
   assert.equal(safeNext(`/example/#head${String.fromCharCode(0x7f)}tail`), "/", "interior fragment DEL");
   assert.equal(safeNext(`/example/#tail${String.fromCharCode(0x7f)}`), "/", "trailing fragment DEL");
   assert.equal(safeNext("/%7fexample/"), "/", "leading encoded DEL");
   assert.equal(safeNext("/example/%7ftail"), "/", "interior encoded DEL");
   assert.equal(safeNext("/example/%7f"), "/", "trailing encoded DEL");

   const state = globalThis.__p2aIdentityState;
   const bytes = async (response) => Buffer.from(await response.arrayBuffer()).byteLength;
   async function expectResponse(response, status, headers = {}, body = null) {
     assert.equal(response.status, status);
     assert.equal(response.headers.get("cache-control"), "private, no-store");
     for (const [name, value] of Object.entries(headers)) assert.equal(response.headers.get(name), value);
     if (body === null) assert.equal(await bytes(response), 0);
     else assert.equal(await response.text(), body);
   }
   const post = (fields, origin = "https://docs.example.invalid") => new Request(
     "https://docs.example.invalid/api/login",
     {
       method: "POST",
       headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
       body: new URLSearchParams(fields),
     },
   );

   const beforeMethods = { ...state };
   for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND"]) {
     await expectResponse(await loginHandler(new Request("https://docs.example.invalid/api/login", { method })),
       405, { allow: "POST" });
     await expectResponse(await logoutHandler(new Request("https://docs.example.invalid/api/logout", { method })),
       405, { allow: "POST" });
   }
   assert.equal(state.originCalls, beforeMethods.originCalls);
   assert.equal(state.loginCalls.length, beforeMethods.loginCalls.length);
   assert.equal(state.logoutCalls, beforeMethods.logoutCalls);

   for (const origin of [undefined, "null", "https://elsewhere.invalid", "http://docs.example.invalid", "https://docs.example.invalid:444"]) {
     const loginHeaders = origin === undefined ? {} : { Origin: origin };
     const loginReq = new Request("https://docs.example.invalid/api/login", {
       method: "POST", headers: loginHeaders,
       body: new URLSearchParams({ email: "member@example.com", password: "secret" }),
     });
     let formDataCalls = 0;
     Object.defineProperty(loginReq, "formData", { value: async () => {
       formDataCalls += 1;
       throw new Error("origin rejection must precede parsing");
     } });
     await expectResponse(await loginHandler(loginReq), 403,
       { "content-type": "text/plain; charset=utf-8" }, "Bad origin");
     assert.equal(formDataCalls, 0);
     const logoutHeaders = origin === undefined ? {} : { Origin: origin };
     const logoutReq = new Request("https://docs.example.invalid/api/logout", { method: "POST", headers: logoutHeaders });
     await expectResponse(await logoutHandler(logoutReq), 403,
       { "content-type": "text/plain; charset=utf-8" }, "Bad origin");
   }
   assert.equal(state.loginCalls.length, 0);
   assert.equal(state.logoutCalls, 0);

   const originImport = /^import \{ requireOrigin \} from "\.\.\/lib\/identity\.mjs";$/m;
   for (const [input, output] of [
     ["./netlify/functions/login.mjs", "./netlify/functions/login-origin-seam.mjs"],
     ["./netlify/functions/logout.mjs", "./netlify/functions/logout-origin-seam.mjs"],
   ]) {
     const source = readFileSync(input, "utf8");
     assert.equal((source.match(new RegExp(originImport.source, "gm")) ?? []).length, 1);
     writeFileSync(output, source.replace(originImport,
       "const requireOrigin = (...args) => globalThis.__p2aRequireOrigin(...args);"));
   }
   const { default: loginOriginHandler } = await import("./netlify/functions/login-origin-seam.mjs");
   const { default: logoutOriginHandler } = await import("./netlify/functions/logout-origin-seam.mjs");
   const unexpectedOriginError = new Error("injected non-Response origin failure");
   let seamOriginCalls = 0;
   globalThis.__p2aRequireOrigin = () => {
     seamOriginCalls += 1;
     throw unexpectedOriginError;
   };
   const seamLoginRequest = post({ email: "member@example.com", password: "secret" });
   let seamFormDataCalls = 0;
   Object.defineProperty(seamLoginRequest, "formData", { value: async () => {
     seamFormDataCalls += 1;
     throw new Error("unexpected parse");
   } });
   await assert.rejects(() => loginOriginHandler(seamLoginRequest),
     (error) => error === unexpectedOriginError);
   await assert.rejects(() => logoutOriginHandler(new Request("https://docs.example.invalid/api/logout", {
     method: "POST", headers: { Origin: "https://docs.example.invalid" },
   })), (error) => error === unexpectedOriginError);
   assert.equal(seamOriginCalls, 2);
   assert.equal(seamFormDataCalls, 0);
   assert.equal(state.loginCalls.length, 0);
   assert.equal(state.logoutCalls, 0);

   const malformed = new Request("https://docs.example.invalid/api/login", {
     method: "POST",
     headers: { Origin: "https://docs.example.invalid", "Content-Type": "application/json" },
     body: "{}",
   });
   await expectResponse(await loginHandler(malformed), 400,
     { "content-type": "text/plain; charset=utf-8" }, "Invalid form");
   assert.equal(state.loginCalls.length, 0);

   for (const fields of [
     { password: "secret", next: "/example/" },
     { email: "", password: "secret", next: "/example/" },
     { email: " \t", password: "secret", next: "/example/" },
     { email: "member@example.com", next: "/example/" },
     { email: "member@example.com", password: "", next: "/example/" },
   ]) {
     await expectResponse(await loginHandler(post(fields)), 302,
       { location: "/login/?next=%2Fexample%2F&error=1" });
   }
   assert.equal(state.loginCalls.length, 0);

   function multipart(entries) {
     const form = new FormData();
     for (const [name, value] of entries) form.append(name, value);
     return new Request("https://docs.example.invalid/api/login", {
       method: "POST", headers: { Origin: "https://docs.example.invalid" }, body: form,
     });
   }
   const fileValue = new File(["invented credential bytes"], "credential.txt", { type: "text/plain" });
   const invalidCredentialEntries = [
     [["email", "member@example.com"], ["email", "second@example.com"], ["password", "secret"], ["next", "/example/"]],
     [["email", "member@example.com"], ["password", "secret"], ["password", "second"], ["next", "/example/"]],
     [["email", fileValue], ["password", "secret"], ["next", "/example/"]],
     [["email", "member@example.com"], ["password", fileValue], ["next", "/example/"]],
   ];
   for (const entries of invalidCredentialEntries) {
     const before = state.loginCalls.length;
     await expectResponse(await loginHandler(multipart(entries)), 302,
       { location: "/login/?next=%2Fexample%2F&error=1" });
     assert.equal(state.loginCalls.length, before, "invalid credential shape must not call login");
   }

   state.loginError = new Error("private provider rejection");
   const beforeRejectedLogin = state.loginCalls.length;
   await expectResponse(await loginHandler(post({
     email: "missing@review.invalid", password: "wrong", next: "https://elsewhere.invalid/",
   })), 302, { location: "/login/?next=%2F&error=1" });
   assert.equal(state.loginCalls.length, beforeRejectedLogin + 1,
     "provider rejection must follow exactly one login call");
   state.loginError = null;
   const successRequest = post({
     email: "  MEMBER@EXAMPLE.COM ", password: "  exact password  ", next: "/example/#notes",
   });
   const nativeFormData = successRequest.formData.bind(successRequest);
   const originCallsBeforeSuccess = state.originCalls;
   let successFormDataCalls = 0;
   Object.defineProperty(successRequest, "formData", { value: async () => {
     successFormDataCalls += 1;
     assert.equal(state.originCalls, originCallsBeforeSuccess + 1,
       "origin verification must precede form parsing");
     return nativeFormData();
   } });
   const beforeSuccessfulLogin = state.loginCalls.length;
   await expectResponse(await loginHandler(successRequest), 302, { location: "/example/" });
   assert.equal(successFormDataCalls, 1);
   assert.equal(state.loginCalls.length, beforeSuccessfulLogin + 1,
     "success must call login exactly once");
   assert.deepEqual(state.loginCalls.at(-1), {
     email: "member@example.com", password: "  exact password  ",
   });

   const beforeUnicodeLogin = state.loginCalls.length;
   await expectResponse(await loginHandler(post({
     email: "  \u0130NFO+CAFE\u0301@EXAMPLE.COM  ", password: " ", next: "/",
   })), 302, { location: "/" });
   assert.equal(state.loginCalls.length, beforeUnicodeLogin + 1);
   assert.deepEqual(state.loginCalls.at(-1), {
     email: "i\u0307nfo+cafe\u0301@example.com", password: " ",
   }, "default Unicode lowercasing must expand U+0130 without normalizing the decomposed accent");

   const beforeInternalWhitespaceLogin = state.loginCalls.length;
   await expectResponse(await loginHandler(post({
     email: "  MEMBER \t.TAG@EXAMPLE.COM  ", password: "secret", next: "/",
   })), 302, { location: "/" });
   assert.equal(state.loginCalls.length, beforeInternalWhitespaceLogin + 1);
   assert.deepEqual(state.loginCalls.at(-1), {
     email: "member \t.tag@example.com", password: "secret",
   }, "email normalization must preserve internal whitespace and apply no transform after lowercasing");

   const beforeMissingNext = state.loginCalls.length;
   await expectResponse(await loginHandler(post({
     email: "member@example.com", password: "secret",
   })), 302, { location: "/" });
   assert.equal(state.loginCalls.length, beforeMissingNext + 1,
     "a missing next field must fall back to safeNext(null) and still call login exactly once");

   for (const nextValue of [
     [["next", "/first/"], ["next", "/later/"]],
     [["next", fileValue]],
   ]) {
     const before = state.loginCalls.length;
     await expectResponse(await loginHandler(multipart([
       ["email", "member@example.com"], ["password", "secret"], ...nextValue,
     ])), 302, { location: "/" });
     assert.equal(state.loginCalls.length, before + 1);
   }

   const beforeSuccessfulLogout = state.logoutCalls;
   await expectResponse(await logoutHandler(new Request("https://docs.example.invalid/api/logout", {
     method: "POST", headers: { Origin: "https://docs.example.invalid" },
   })), 302, { location: "/login/" });
   assert.equal(state.logoutCalls, beforeSuccessfulLogout + 1);
   state.logoutError = new Error("private upstream logout rejection");
   const beforeRejectedLogout = state.logoutCalls;
   await expectResponse(await logoutHandler(new Request("https://docs.example.invalid/api/logout", {
     method: "POST", headers: { Origin: "https://docs.example.invalid" },
   })), 302, { location: "/login/" });
   assert.equal(state.logoutCalls, beforeRejectedLogout + 1);
   state.logoutError = null;
   console.log("PASS  safeNext and exact login/logout response matrix");

   const gatePath = "./netlify/edge-functions/gate.ts";
   const originalGate = readFileSync(gatePath, "utf8");
   const importPattern = /^import \{ identify \} from "\.\.\/lib\/identity\.mjs";$/m;
   assert.equal((originalGate.match(new RegExp(importPattern.source, "gm")) ?? []).length, 1);
   const testGate = originalGate.replace(
     importPattern,
     "const identify = (...args) => globalThis.__p2aIdentify(...args);",
   );
   assert.notEqual(testGate, originalGate);
   const testGatePath = "./netlify/edge-functions/gate-under-test.ts";
   writeFileSync(testGatePath, testGate);

   let caseNumber = 0;
   const thrownIdentityError = new Error("injected identity failure");
   async function gateResult(user, path = "/example/", method = "GET", expectedIdentifyCalls = 1) {
     let identifyCalls = 0;
     globalThis.__p2aIdentify = async () => {
       identifyCalls += 1;
       if (user === thrownIdentityError) throw thrownIdentityError;
       return user;
     };
     const gateModule = await import(`${testGatePath}?case=${caseNumber++}`);
     assert.deepEqual(Object.keys(gateModule), ["default"], "the gate exports only its handler");
     const { default: gate } = gateModule;
     const request = new Request(`https://docs.example.invalid${path}`, { method });
     const previousIdentify = globalThis.__p2aIdentify;
     globalThis.__p2aIdentify = async (actualRequest) => {
       assert.equal(actualRequest, request, "gate must pass the original Request to identify");
       return previousIdentify(actualRequest);
     };
     try {
       return await gate(request);
     } finally {
       assert.equal(identifyCalls, expectedIdentifyCalls,
         `gate identify call count for ${method} ${path}`);
     }
   }

   for (const path of ["/invite/", "/invite/?token=fragment-never-arrives", "/invite/child"]) {
     for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
       assert.equal(await gateResult(null, path, method, 0), undefined,
         `${method} ${path} must use the public invite seam`);
     }
   }
   for (const [path, encodedNext] of [
     ["/invite", "%2Finvite"],
     ["/Invite/", "%2FInvite%2F"],
     ["/%69nvite/", "%2F%2569nvite%2F"],
     ["/invitee/", "%2Finvitee%2F"],
   ]) {
     await expectResponse(await gateResult(null, path), 302, {
       location: `/login/?next=${encodedNext}`,
     });
   }

   state.getUserError = new Error("injected provider degradation");
   const getUserCallsBeforeDegradation = state.getUserCalls;
   const degradedIdentity = await dependencyIdentify(new Request("https://docs.example.invalid/example/"));
   assert.equal(degradedIdentity, null);
   assert.equal(state.getUserCalls, getUserCallsBeforeDegradation + 1);
   state.getUserError = null;
   await expectResponse(await gateResult(degradedIdentity, "/degraded/"), 302, {
     location: "/login/?next=%2Fdegraded%2F",
   });

   await expectResponse(await gateResult(null, "/example/?view=review&section=overview"), 302, {
     location: "/login/?next=%2Fexample%2F%3Fview%3Dreview%26section%3Doverview",
   });

   const identityCases = [
     ["external-suffix legacy member", { email: "member@outside.invalid", roles: ["member"] }, "pass"],
     ["organization-suffix legacy guest", { email: "guest@example.com", roles: ["guest"] }, 403],
     ["external-suffix final organization user", { email: "org@outside.invalid", isOrg: true }, "pass"],
     ["organization-suffix final external user", { email: "external@example.com", isOrg: false }, 403],
     ["authoritative false with legacy member", {
       email: "contradiction@example.com", isOrg: false, roles: ["member"],
     }, 403],
     ["malformed identity shape", { isOrg: "yes", roles: "member" }, 403],
   ];
   for (const [name, user, expected] of identityCases) {
     const result = await gateResult(user);
     if (expected === "pass") assert.equal(result, undefined, name);
     else {
       await expectResponse(result, expected,
         { "content-type": "text/plain; charset=utf-8" },
         "You do not have access to this document.");
     }
   }
   await expectResponse(await gateResult(thrownIdentityError), 503,
     { "content-type": "text/plain; charset=utf-8" },
     "Authentication is temporarily unavailable.");
   console.log("PASS  exact anonymous, legacy, final, contradictory, and malformed gate matrix");
   NODE
   )
   test ! -e package-lock.json
   test ! -e node_modules
   P2A_SOURCE_FIXTURE
   BASH
   ```

   Expected: exit `0` and exactly these two lines in order:

   ```text
   PASS  safeNext and exact login/logout response matrix
   PASS  exact anonymous, legacy, final, contradictory, and malformed gate matrix
   ```

   The destination and endpoint matrices exhaust the specified type, trim/control, slash/origin/scheme/backslash, normalized/decoded/reserved-path, malformed-escape, query/fragment, method, form-field, Unicode-email, byte-preserved-password, provider-result, and exact response-byte boundaries. They also prove invite bypass before identity, exactly one identity call for protected paths, dependency `null` degradation, crossed suffix/authority cases, and the non-disclosing thrown-identity 503.

   Delegation uses authenticated fd4/fd5, not the nonce alone. HMAC claim binds a live outside owner, inherited anchor group, absolute root, and 250 ms–120 s lease; reserve transfers nonexistent sibling root/evidence paths before creation. Nonce-only recursion strips fd names and writes zero requests. Natural-signal/timeout recursion strips all owner env while the real top-level client retains exact `1/1/0/1`; invalid or silent exchanges fall back before creation. Release acknowledgement requires both paths absent. The outside-owner group-KILL probe kills the Bash-bearing group, proves disappearance and no release ack, then removes reserved paths before harness cleanup. Delegated code never detaches or daemonizes.

   Local fallback uses retained anchors and current `ps` ownership before TERM/KILL; startup now bounds and contains inner-spawn error, anchor exit, malformed/missing handshake, and timeout. Reaping/group disappearance precede the separately owned five-second recursive deletion. Exact-source probes cover all HUP/INT/TERM lifecycle windows, a distinct second cleanup/finalization signal, timeout precedence, release failure, resistant and parent-exit descendants, natural Bash HUP/INT/TERM/KILL 129/130/143/137, and retained mode-600 remediation evidence. The nested fixture validates its root before writes and leaves no package, lockfile, or transformed source outside it.

3. Prove P1-E's optional login-copy seam and restore normal local site output:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   trap 'exit 129' HUP
   trap 'exit 130' INT
   trap 'exit 143' TERM
   unset CONTEXT
   rm -f -- _site/login/index.html
   templates/build --site >/dev/null
   cmp login/index.html _site/login/index.html
   test ! -e _site/_headers
   echo "PASS  login source copied byte-for-byte"
   trap - HUP INT TERM
   BASH
   ```

   Expected: exit `0` and exactly `PASS  login source copied byte-for-byte`. `_site/login/index.html` exists only as ignored generated output.

4. Satisfy the operator-owned provider/runtime release gate. The operator must create one blank disposable Netlify project that contains no production/custom domain, deploy, user, environment value, or content; enable Identity; set registration to **Invite only**; ensure deploy-preview and branch-deploy URLs are publicly reachable without a Netlify team/password/SSO wall; confirm both contexts are permitted; and authorize deletion of the complete project when cleanup reaches its normal path. The settled application gate remains the only read wall. The authenticated CLI principal must already be noninteractively authenticated and allowed to link, deploy both contexts, manage disposable Identity users through a deployed Functions v2 fixture, and delete the site; interactive CLI login is an operator precondition, not an unbounded step inside this script. Invoke the script with `P2A_SITE_ID` set to the canonical site API UUID and `P2A_SAFETY_CONFIRMATION` set to the exact confirmation shown below. Both are required noninteractive inputs, so a headless operator run fails closed instead of reading its own script heredoc or waiting on a terminal. The script validates both inputs, then creates and self-tests its supervisor and installs/verifies the exact direct `netlify-cli@24.2.0` deletion capability before it activates deletion authorization or creates any site credential, links, deploys, or creates users. Therefore a later root-package, browser, link, or deploy setup failure still has the pinned deletion tool available. A failure before that preflight makes no provider mutation and never claims that the script accepted deletion responsibility. Absent an API-safe way in the pinned CLI/runtime to enumerate every account-side setting without exposing account data, the operator confirmation is the fail-closed oracle for blankness, invite-only configuration, lack of production attachment, and deletion authority. The anonymous response matrices then mechanically prove that no outer access wall intercepts either deployed context. OpenSSL generates the password and fixture nonce. The password travels only through scoped inherited environment and request stdin; the nonce travels only through a shell variable and one mode-600 curl config consumed by stdin-backed requests, while only its SHA-256 is embedded in the temporary Function. Neither secret enters `argv`/process listings, a URL, script-created diagnostic, deploy JSON, or repository file. Both are removed on normal cleanup; an exceptional retained tree remains mode-protected and is named for manual cleanup rather than falsely reported as destroyed. Provider-managed transport and access logging is outside the repository's observable boundary; the executable oracle therefore inspects every log and deploy-result file the script itself creates rather than claiming access to provider-internal logs.

   Every mandatory hosted operation is bounded. Each package or browser installation has a 600-second process deadline; CLI version preflight has 30 seconds; site linking has 120 seconds; each deploy has 300 seconds; the complete browser flow has 180 seconds; and local runtime startup makes at most 60 attempts whose curl request is limited to one second to connect and two seconds total after the separate ten-second authenticated publication handshake. Every ordinary or user-creation HTTP call uses curl's 10-second connection and 25-second total limits. Cleanup gives each user deletion a 30-second supervisor deadline around the same curl limits, gives the local runtime a ten-second TERM grace plus terminal verification bounds, and gives site deletion 60 seconds plus a five-second TERM grace. A mandatory setup, link, deploy, browser, request, or user-creation timeout prints its exact static `ERROR  ...; guarded cleanup is running` diagnostic and exits nonzero through the installed trap. A user-deletion timeout warns and continues to site deletion. A runtime, site-deletion, or kernel-level terminal-proof failure warns, marks release verification failed, and retains the guarded tree and ownership/deletion evidence. A timed-out fixture creation may finish provider-side after the client deadline, so deletion of the complete blank disposable site—not only collected user IDs—is the normal cleanup authority; if that deletion itself fails, the exact manual-remediation boundary remains visible.

   The disposable tree renames the integrated P1-C-or-P2-H helper copy to `identity-production.mjs` and installs a P2-A-only fixture wrapper at the import path used by the unmodified production gate. Its deployed administration Function uses the pinned package's documented, auto-confirming `admin.createUser({ email, password })` call and writes no role or application metadata. The wrapper always authenticates through the real helper first. Only after a real non-null session exists, it recognizes four invented, invite-only fixture email patterns and projects crossed signals: the legacy member and final `isOrg: true` identities use an external suffix, while the legacy guest and final `isOrg: false` identities use the illustrative organization suffix. A second disposable Function reports only the runtime `CONTEXT`, projected key set, `roles`, `isOrg`, and one boolean stating whether `sub`, email, and name are non-empty strings; it never reports an identity, cookie, or token value. This safe seam is generated only below the guarded temporary root, is deployed only to the blank disposable site, is never copied back, and is removed on verified cleanup or retained in the guarded tree on the explicit exceptional path. It makes both gate branches deterministic, proves suffix-independent authorization, and does so without accepting a client-selected role or editing another ticket's source.

   ```bash
   P2A_SITE_ID='replace-with-canonical-disposable-site-uuid' \
   P2A_SAFETY_CONFIRMATION='BLANK INVITE-ONLY PUBLIC DISPOSABLE DELETE-AUTHORIZED' \
   bash <<'BASH'
   set -euo pipefail
   umask 077

   P2A_REPO="$PWD"
   P2A_CLI=''
   P2A_SUPERVISOR=''
   P2A_LAUNCHER=''
   P2A_SITE_ID="${P2A_SITE_ID:-}"
   P2A_DISPOSABLE_SITE_ID=''
   P2A_SITE_DELETE_AUTHORIZED=0
   P2A_TEMP_PARENT=''
   P2A_TEST_ROOT=''
   P2A_DEV_PID=''
   P2A_DEV_RECORD=''
   P2A_DEV_SOCKET=''
   P2A_DEV_READY=0
   P2A_ADMIN_BASE=''
   P2A_CONTROL_TOKEN=''
   P2A_CURL_SECRET_CONFIG=''
   P2A_MANUAL_REMEDIATION=0
   P2A_DELETE_EVIDENCE=''
   P2A_SAFETY_CONFIRMATION="${P2A_SAFETY_CONFIRMATION:-}"
   P2A_USER_IDS=()

   run_bounded() {
     local limit="$1" control_base record_file socket_file status
     shift
     if ! control_base="$(mktemp "$P2A_TEST_ROOT/p2-a-control.XXXXXX")"; then
       return 125
     fi
     rm -f -- "$control_base"
     record_file="$control_base.json"
     socket_file="$control_base.sock"
     if P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
       P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
       P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
       node "$P2A_SUPERVISOR" run \
       "$limit" 5 4194304 "$record_file" "$socket_file" "$P2A_LAUNCHER" "$@"; then
       return 0
     else
       status=$?
       if [[ "$status" == 125 || -e "$record_file" || -e "$socket_file" ]]; then
         P2A_MANUAL_REMEDIATION=1
       fi
       return "$status"
     fi
   }

   must_run_bounded() {
     local limit="$1" label="$2" status
     shift 2
     if run_bounded "$limit" "$@"; then
       return 0
     else
       status=$?
       echo "ERROR  $label failed or timed out; guarded cleanup is running" >&2
       return "$status"
     fi
   }

   supervisor_control() {
     local record_file="$1" socket_file="$2" action="$3"
     P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" node "$P2A_SUPERVISOR" control \
       "$record_file" "$socket_file" "$action"
   }

   stop_process_bounded() {
     local supervisor_pid="$1" record_file="$2" socket_file="$3" status=0 tick
     if [[ ! "$supervisor_pid" =~ ^[0-9]+$ ]] || (( supervisor_pid <= 1 )); then
       return 1
     fi
     if [[ ! -f "$record_file" || ! -S "$socket_file" ]]; then
       if [[ ! -e "$record_file" && ! -e "$socket_file" ]] \
         && ! kill -0 "$supervisor_pid" 2>/dev/null; then
         if wait "$supervisor_pid" 2>/dev/null; then status=0; else status=$?; fi
         [[ "$status" == 125 ]] && return 125
         return 0
       fi
       return 1
     fi
     if ! supervisor_control "$record_file" "$socket_file" stop; then
       return 1
     fi
     for tick in $(seq 1 20); do
       if ! kill -0 "$supervisor_pid" 2>/dev/null; then
         wait "$supervisor_pid" 2>/dev/null || status=$?
         [[ ! -e "$record_file" && ! -e "$socket_file" ]] || status=125
         return "$status"
       fi
       sleep 1
     done
     return 125
   }

   stop_recorded_groups() {
     local record_file socket_file status=0 tick
     [[ -d "${P2A_TEST_ROOT:-}" ]] || return 0
     while IFS= read -r record_file; do
       socket_file="${record_file%.json}.sock"
       if [[ ! -S "$socket_file" ]] || ! supervisor_control "$record_file" "$socket_file" stop; then
         status=1
         continue
       fi
       for tick in $(seq 1 20); do
         if [[ ! -e "$record_file" && ! -e "$socket_file" ]]; then break; fi
         sleep 1
       done
       if [[ -e "$record_file" || -e "$socket_file" ]]; then
         status=1
       fi
     done < <(find "$P2A_TEST_ROOT" -maxdepth 1 -type f \
       \( -name 'p2-a-control.??????.json' -o -name 'netlify-dev.json' \) -print)
     return "$status"
   }

   retain_cleanup_boundary() {
     local evidence_path="${P2A_DELETE_EVIDENCE:-$P2A_TEST_ROOT/manual-remediation.evidence.json}"
     P2A_BOUNDARY_SITE_ID="$P2A_DISPOSABLE_SITE_ID" \
       P2A_BOUNDARY_ROOT="$P2A_TEST_ROOT" \
       P2A_BOUNDARY_EVIDENCE="$evidence_path" \
       P2A_BOUNDARY_RECORD="${P2A_DEV_RECORD:-not-applicable}" \
       P2A_BOUNDARY_SUPERVISOR="${P2A_DEV_PID:-not-applicable}" \
       node --input-type=module --eval '
         import { readFileSync, renameSync, writeFileSync } from "node:fs";
         let leaderPgid = "not-applicable";
         try {
           const record = JSON.parse(readFileSync(process.env.P2A_BOUNDARY_RECORD, "utf8"));
           if (Number.isSafeInteger(record?.leaderPgid) && record.leaderPgid > 1) {
             leaderPgid = String(record.leaderPgid);
           }
         } catch {}
         const supervisorPid = /^[0-9]+$/.test(process.env.P2A_BOUNDARY_SUPERVISOR ?? "")
           && Number(process.env.P2A_BOUNDARY_SUPERVISOR) > 1
           ? process.env.P2A_BOUNDARY_SUPERVISOR : "not-applicable";
         const evidence = {
           version: 1,
           state: "manual-remediation",
           disposableSiteId: process.env.P2A_BOUNDARY_SITE_ID,
           guardedRoot: process.env.P2A_BOUNDARY_ROOT,
           evidencePath: process.env.P2A_BOUNDARY_EVIDENCE,
           recordPath: process.env.P2A_BOUNDARY_RECORD,
           supervisorPid,
           leaderPgid,
         };
         try {
           const pending = `${evidence.evidencePath}.new`;
           writeFileSync(pending, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
           renameSync(pending, evidence.evidencePath);
         } catch {}
         console.error(`ERROR  release cleanup is incomplete; disposable-site-id=${evidence.disposableSiteId} guarded-root=${evidence.guardedRoot} evidence-path=${evidence.evidencePath} record-path=${evidence.recordPath} supervisor-pid=${supervisorPid} leader-pgid=${leaderPgid}; manual remediation required`);
       '
   }

   remove_guarded_root_bounded() {
     local target="$P2A_TEST_ROOT" parent name status=0
     parent="${target%/*}"
     name="${target##*/}"
     if [[ -z "${P2A_TEMP_PARENT:-}" || "$parent" != "$P2A_TEMP_PARENT" \
       || "$target" == "$P2A_TEMP_PARENT" || "$name" != p2-a-live.?????? ]]; then
       echo 'refusing to remove unexpected live-test path' >&2
       return 1
     fi
     P2A_DELETE_EVIDENCE="$(mktemp "$P2A_TEMP_PARENT/.p2-a-delete.XXXXXX")" || return 125
     P2A_DELETE_ROOT="$target" P2A_DELETE_SITE_ID="$P2A_DISPOSABLE_SITE_ID" \
       P2A_DELETE_EVIDENCE="$P2A_DELETE_EVIDENCE" node --input-type=module --eval '
         import { renameSync, writeFileSync } from "node:fs";
         const evidence = { version: 1, state: "delete-preparing",
           disposableSiteId: process.env.P2A_DELETE_SITE_ID,
           guardedRoot: process.env.P2A_DELETE_ROOT,
           evidencePath: process.env.P2A_DELETE_EVIDENCE,
           recordPath: "not-yet-published", supervisorPid: "not-yet-published",
           leaderPgid: "not-yet-published" };
         const pending = `${evidence.evidencePath}.new`;
         writeFileSync(pending, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
         renameSync(pending, evidence.evidencePath);
       ' || return 125
     export P2A_SUPERVISOR_EXTERNAL_EVIDENCE="$P2A_DELETE_EVIDENCE"
     export P2A_DELETE_ROOT="$target" P2A_DELETE_PARENT="$parent"
     if run_bounded 30 node --input-type=module --eval '
       import { rmSync } from "node:fs";
       const target = process.env.P2A_DELETE_ROOT ?? "";
       const parent = process.env.P2A_DELETE_PARENT ?? "";
       if (!target.startsWith("/") || target === parent
         || target.slice(0, target.lastIndexOf("/")) !== parent
         || !/^p2-a-live\.[^/]{6}$/.test(target.slice(target.lastIndexOf("/") + 1))) process.exit(125);
       rmSync(target, { recursive: true, force: true });
     '; then
       status=0
     else
       status=$?
     fi
     unset P2A_SUPERVISOR_EXTERNAL_EVIDENCE P2A_DELETE_ROOT P2A_DELETE_PARENT
     if [[ "$status" == 0 && ! -e "$target" && ! -e "$P2A_DELETE_EVIDENCE" ]]; then
       P2A_TEST_ROOT=''
       P2A_DELETE_EVIDENCE=''
       return 0
     fi
     P2A_MANUAL_REMEDIATION=1
     echo "ERROR  guarded tree deletion is incomplete; disposable-site-id=$P2A_DISPOSABLE_SITE_ID guarded-root=$target evidence-path=$P2A_DELETE_EVIDENCE; manual remediation required" >&2
     return 125
   }

   cleanup() {
     local cleanup_status=0 parent name P2A_DELETE_BODY
     set +e
     if [[ -n "${P2A_ADMIN_BASE:-}" && -n "${P2A_FIXTURE_NONCE:-}" ]]; then
       for P2A_DELETE_ID in "${P2A_USER_IDS[@]}"; do
         if [[ -n "$P2A_DELETE_ID" ]]; then
           P2A_DELETE_BODY="$(P2A_DELETE_ID="$P2A_DELETE_ID" node --input-type=module --eval \
             'process.stdout.write(JSON.stringify({ id: process.env.P2A_DELETE_ID }))')"
           export P2A_DELETE_BODY P2A_CURL_SECRET_CONFIG P2A_ADMIN_BASE
           if ! run_bounded 30 sh -c '
             printf "%s" "$P2A_DELETE_BODY" | curl --fail --silent --show-error \
               --config "$P2A_CURL_SECRET_CONFIG" --output /dev/null \
               --connect-timeout 10 --max-time 25 --request DELETE \
               --header "Content-Type: application/json" --data-binary @- \
               "$P2A_ADMIN_BASE/api/p2-a-fixture"
           '; then
             echo 'WARN  fixture user cleanup failed or timed out; site deletion is the fallback' >&2
           fi
           unset P2A_DELETE_BODY
         fi
       done
     fi
     if [[ -n "${P2A_DEV_PID:-}" ]]; then
       if stop_process_bounded "$P2A_DEV_PID" "$P2A_DEV_RECORD" "$P2A_DEV_SOCKET"; then
         P2A_DEV_PID=''
       else
         echo 'WARN  local Netlify supervisor did not prove bounded cleanup; control evidence retained' >&2
         cleanup_status=1
         P2A_MANUAL_REMEDIATION=1
       fi
     fi
     unset P2A_PASSWORD P2A_FIXTURE_NONCE P2A_LEGACY_MEMBER_EMAIL P2A_LEGACY_GUEST_EMAIL
     unset P2A_FIXTURE_NONCE_HASH P2A_FINAL_ORG_EMAIL P2A_FINAL_EXTERNAL_EMAIL P2A_ADMIN_BASE
     if [[ "${P2A_SITE_DELETE_AUTHORIZED:-0}" == 1 && -n "${P2A_SITE_ID:-}" ]]; then
       if [[ "$P2A_SITE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
         && [[ -x "${P2A_CLI:-}" ]] \
         && run_bounded 60 "$P2A_CLI" sites:delete "$P2A_SITE_ID" --force >/dev/null; then
         P2A_SITE_ID=''
         P2A_SITE_DELETE_AUTHORIZED=0
       else
         echo 'WARN  disposable site deletion failed or timed out; delete the known site manually' >&2
         cleanup_status=1
       fi
     fi
     if [[ -n "${P2A_TEST_ROOT:-}" ]] && ! stop_recorded_groups; then
       echo 'WARN  a live authenticated supervisor could not prove cleanup; guarded tree retained' >&2
       cleanup_status=1
       P2A_MANUAL_REMEDIATION=1
     fi
     if [[ -n "${P2A_TEST_ROOT:-}" && "$cleanup_status" == 0 \
       && "${P2A_MANUAL_REMEDIATION:-0}" == 0 ]]; then
       if ! remove_guarded_root_bounded; then
         cleanup_status=1
       fi
     fi
     if [[ -n "${P2A_TEST_ROOT:-}" && "$cleanup_status" != 0 ]]; then
       retain_cleanup_boundary
     fi
     set -e
     return "$cleanup_status"
   }
   trap cleanup EXIT
   trap 'exit 129' HUP
   trap 'exit 130' INT
   trap 'exit 143' TERM

   if [[ ! "$P2A_SITE_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
     echo 'P2A_SITE_ID must name the disposable site in canonical UUID form' >&2
     exit 1
   fi
   if [[ "$P2A_SAFETY_CONFIRMATION" != 'BLANK INVITE-ONLY PUBLIC DISPOSABLE DELETE-AUTHORIZED' ]]; then
     echo 'exact disposable-project safety confirmation is required' >&2
     exit 1
   fi
   unset P2A_SAFETY_CONFIRMATION
   P2A_DISPOSABLE_SITE_ID="$P2A_SITE_ID"

   P2A_TEMP_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
   P2A_TEST_ROOT="$(mktemp -d "$P2A_TEMP_PARENT/p2-a-live.XXXXXX")"
   P2A_SUPERVISOR="$P2A_TEST_ROOT/process-supervisor.mjs"
   P2A_LAUNCHER="$P2A_TEST_ROOT/process-launcher.mjs"
   while IFS= read -r P2A_SUPERVISOR_LINE; do
     printf '%s\n' "$P2A_SUPERVISOR_LINE"
   done >"$P2A_SUPERVISOR" <<'SUPERVISOR'
   import { execFileSync, spawn } from "node:child_process";
   import { createConnection, createServer } from "node:net";
   import {
     readFileSync, renameSync, unlinkSync, writeFileSync,
   } from "node:fs";
   import { dirname, join } from "node:path";

   const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
   const SIGNAL_STATUS = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGKILL: 137, SIGTERM: 143 });

   function conventionalSignalStatus(signal) {
     return SIGNAL_STATUS[signal] ?? 127;
   }

   function completedCommandStatus(code) {
     return Number.isSafeInteger(code) && code >= 0 && code <= 255 && code !== 125 ? code : 127;
   }

   function completedPrepublicationStatus(outcome) {
     if (outcome.kind === "signal") return conventionalSignalStatus(outcome.signal);
     if (outcome.kind === "overflow") return 126;
     if (outcome.kind === "handshake-timeout") return 124;
     if (outcome.kind === "result") {
       if (outcome.spawnError) return 127;
       if (outcome.signal) return conventionalSignalStatus(outcome.signal);
       const status = completedCommandStatus(outcome.code);
       return status === 0 ? 127 : status;
     }
     if (outcome.kind === "leader-exit" && outcome.signal) {
       return conventionalSignalStatus(outcome.signal);
     }
     return 127;
   }

   function positiveInteger(value, label, { allowZero = false } = {}) {
     if (!/^[0-9]+$/.test(value ?? "")) throw new Error(`${label} must be an integer`);
     const parsed = Number(value);
     if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 2)) {
       throw new Error(`${label} is outside the safe range`);
     }
     return parsed;
   }

   function controlToken() {
     const token = process.env.P2A_SUPERVISOR_TOKEN ?? "";
     if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("invalid supervisor token");
     return token;
   }

   function groupAlive(groupId) {
     try {
       process.kill(-groupId, 0);
       return true;
     } catch (error) {
       if (error?.code === "ESRCH") return false;
       if (error?.code === "EPERM") return true;
       throw error;
     }
   }

   function signalGroup(groupId, signal) {
     if (!Number.isSafeInteger(groupId) || groupId <= 1) {
       throw new Error("refusing unsafe process-group signal");
     }
     try {
       process.kill(-groupId, signal);
     } catch (error) {
       if (error?.code !== "ESRCH") throw error;
     }
   }

   function currentProcessGroup(pid) {
     const output = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
       encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
     }).trim();
     if (!/^[0-9]+$/.test(output)) throw new Error("anchor process group unavailable");
     return Number(output);
   }

   function retainedAnchorOwnsGroup(groupId, leader) {
     if (!leader || leader.exitCode !== null || leader.signalCode !== null
       || leader.pid !== groupId || !Number.isSafeInteger(groupId) || groupId <= 1) return false;
     try {
       process.kill(leader.pid, 0);
       return currentProcessGroup(leader.pid) === groupId;
     } catch { return false; }
   }

   async function waitForGroupExit(groupId, milliseconds) {
     const deadline = Date.now() + milliseconds;
     while (groupAlive(groupId) && Date.now() < deadline) await pause(100);
     return !groupAlive(groupId);
   }

   function removeIfPresent(path) {
     try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
   }

   async function closeServer(server) {
     if (!server) return true;
     return await Promise.race([
       new Promise((resolve) => server.close((error) => resolve(!error))),
       pause(2000).then(() => false),
     ]);
   }

   function publish(recordFile, publication) {
     const pending = `${recordFile}.new`;
     writeFileSync(pending, `${JSON.stringify(publication)}\n`, { mode: 0o600 });
     renameSync(pending, recordFile);
   }

   function remediationContext(recordFile, socketPath, ids) {
     const siteId = process.env.P2A_SUPERVISOR_SITE_ID ?? "";
     const guardedRoot = process.env.P2A_SUPERVISOR_TEST_ROOT ?? "";
     if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(siteId)
       || !guardedRoot.startsWith("/") || guardedRoot === "/") {
       throw new Error("missing remediation context");
     }
     const externalEvidence = process.env.P2A_SUPERVISOR_EXTERNAL_EVIDENCE ?? "";
     const evidencePath = externalEvidence !== ""
       && externalEvidence.startsWith("/")
       && dirname(externalEvidence) === dirname(guardedRoot)
       && /^\.p2-a-delete\.[^/]{6}$/.test(externalEvidence.slice(externalEvidence.lastIndexOf("/") + 1))
       ? externalEvidence : join(guardedRoot, `process-${process.pid}.evidence.json`);
     return {
       version: 1,
       state: "launching",
       disposableSiteId: siteId,
       guardedRoot,
       evidencePath,
       recordPath: recordFile,
       socketPath,
       supervisorPid: ids.supervisorPid,
       leaderPgid: ids.leaderPgid,
     };
   }

   function persistEvidence(context, state) {
     const evidence = { ...context, state };
     const pending = `${context.evidencePath}.new`;
     writeFileSync(pending, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
     renameSync(pending, context.evidencePath);
   }

   function printManualRemediation(context) {
     console.error(
       `ERROR  process cleanup could not be proven within terminal bound; disposable-site-id=${context.disposableSiteId} guarded-root=${context.guardedRoot} evidence-path=${context.evidencePath} record-path=${context.recordPath} control-socket=${context.socketPath} supervisor-pid=${context.supervisorPid} leader-pgid=${context.leaderPgid}; manual remediation required`,
     );
   }

   function listen(server, socketPath) {
     return new Promise((resolve, reject) => {
       server.once("error", reject);
       server.listen(socketPath, () => {
         server.removeListener("error", reject);
         resolve();
       });
     });
   }

   function installControlServer(token, socketPath, ids, resolveControl) {
     const server = createServer((connection) => {
       connection.setTimeout(2000, () => connection.destroy());
       let input = "";
       connection.on("data", (chunk) => {
         input += chunk.toString("utf8");
         if (Buffer.byteLength(input) > 4096) connection.destroy();
         const newline = input.indexOf("\n");
         if (newline < 0) return;
         try {
           const request = JSON.parse(input.slice(0, newline));
           if (request.token !== token || !["probe", "stop", "interrupt"].includes(request.action)) {
             throw new Error("unauthorized control request");
           }
           connection.end(`${JSON.stringify({ ok: true, ...ids })}\n`);
           if (request.action === "stop") resolveControl({ kind: "stop" });
           if (request.action === "interrupt") {
             setImmediate(() => process.kill(process.pid, "SIGTERM"));
           }
         } catch {
           connection.destroy();
         }
       });
     });
     return server;
   }

   const terminationByGroup = new Map();
   async function terminateOwnedGroup(groupId, leader, leaderResult, graceSeconds) {
     if (terminationByGroup.has(groupId)) return terminationByGroup.get(groupId);
     const terminal = (async () => {
       let signalFailure = false;
       if (!retainedAnchorOwnsGroup(groupId, leader)) {
         return { complete: false, reaped: false, disappeared: false, ownership: false };
       }
       try { signalGroup(groupId, "SIGTERM"); } catch { signalFailure = true; }
       if (graceSeconds > 0) await pause(graceSeconds * 1000);
       if (!retainedAnchorOwnsGroup(groupId, leader)) {
         return { complete: false, reaped: false, disappeared: false, ownership: false };
       }
       try { signalGroup(groupId, "SIGKILL"); } catch { signalFailure = true; }
       const reaped = await Promise.race([
         leaderResult.then(() => true),
         pause(5000).then(() => false),
       ]);
       const disappeared = reaped && await waitForGroupExit(groupId, 5000);
       const forcedFailure = process.env.P2A_SUPERVISOR_TEST_FORCE_TERMINAL_FAILURE === "1";
       return { complete: !forcedFailure && !signalFailure && reaped && disappeared,
         reaped, disappeared, ownership: true };
     })();
     terminationByGroup.set(groupId, terminal);
     return terminal;
   }

   async function controlMode(arguments_) {
     const [recordFile, socketPath, action, ...extra] = arguments_;
     if (extra.length || !recordFile || !socketPath || !["probe", "stop", "interrupt"].includes(action)) {
       throw new Error("invalid control invocation");
     }
     const token = controlToken();
     const publication = JSON.parse(readFileSync(recordFile, "utf8"));
     if (publication?.version !== 1 || publication?.state !== "running"
       || publication?.socketPath !== socketPath
       || !Number.isSafeInteger(publication?.supervisorPid) || publication.supervisorPid <= 1
       || !Number.isSafeInteger(publication?.leaderPgid) || publication.leaderPgid <= 1) {
       throw new Error("invalid or stale supervisor publication");
     }
     await new Promise((resolve, reject) => {
       const connection = createConnection(socketPath);
       let response = "";
       const timer = setTimeout(() => {
         connection.destroy();
         reject(new Error("control timeout"));
       }, 3000);
       connection.once("error", reject);
       connection.on("data", (chunk) => {
         response += chunk.toString("utf8");
         if (Buffer.byteLength(response) > 4096) connection.destroy();
       });
       connection.once("connect", () => {
         connection.end(`${JSON.stringify({ token, action })}\n`);
       });
       connection.once("close", () => {
         clearTimeout(timer);
         try {
           const reply = JSON.parse(response.trim());
           if (reply?.ok !== true || reply.supervisorPid !== publication.supervisorPid
             || reply.leaderPgid !== publication.leaderPgid) {
             throw new Error("control identity mismatch");
           }
           resolve();
         } catch (error) { reject(error); }
       });
     });
   }

   async function runMode(arguments_) {
     const [limitValue, graceValue, outputValue, recordFile, socketPath, launcher, command,
       ...commandArguments] = arguments_;
     const limit = positiveInteger(limitValue, "deadline", { allowZero: true });
     const grace = positiveInteger(graceValue, "TERM grace", { allowZero: true });
     const outputLimit = positiveInteger(outputValue, "output limit");
     if (!recordFile || !socketPath || !launcher || !command) {
       throw new Error("run mode requires control paths, launcher, and command");
     }
     const token = controlToken();
     removeIfPresent(`${recordFile}.new`);
     removeIfPresent(socketPath);

     let latchedSignalStatus = 0;
     let signalResolve;
     const interrupted = new Promise((resolve) => { signalResolve = resolve; });
     const signalHandlers = new Map();
     for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
       const handler = () => {
         if (latchedSignalStatus !== 0) return;
         latchedSignalStatus = conventionalSignalStatus(signal);
         process.exitCode = latchedSignalStatus;
         signalResolve({ kind: "signal", signal });
       };
       signalHandlers.set(signal, handler);
       process.on(signal, handler);
     }
     const authoritativeStatus = (fallback, manual = false) =>
       latchedSignalStatus || (manual ? 125 : fallback);

     const childEnvironment = { ...process.env };
     delete childEnvironment.P2A_SUPERVISOR_TOKEN;
     delete childEnvironment.P2A_SUPERVISOR_EXTERNAL_EVIDENCE;
     delete childEnvironment.P2A_SUPERVISOR_TEST_DELAY_PHASE;
     delete childEnvironment.P2A_SUPERVISOR_TEST_PHASE_FILE;
     delete childEnvironment.P2A_SUPERVISOR_TEST_FORCE_TERMINAL_FAILURE;
     const leader = spawn(process.execPath, [launcher, command, ...commandArguments], {
       detached: true,
       env: childEnvironment,
       stdio: ["inherit", "pipe", "pipe", "ipc"],
     });
     const leaderResult = new Promise((resolve) => {
       leader.once("error", () => resolve({ kind: "leader-error" }));
       leader.once("exit", (code, signal) => resolve({ kind: "leader-exit", code, signal }));
     });
     const groupId = leader.pid;
     if (!Number.isSafeInteger(groupId) || groupId <= 1) {
       await Promise.race([leaderResult, pause(5000)]);
       process.exitCode = authoritativeStatus(127);
       return;
     }
     const ids = { supervisorPid: process.pid, leaderPgid: groupId };
     const remediation = remediationContext(recordFile, socketPath, ids);

     let outputBytes = 0;
     let overflowResolve;
     const overflow = new Promise((resolve) => { overflowResolve = resolve; });
     for (const [stream, destination] of [[leader.stdout, process.stdout], [leader.stderr, process.stderr]]) {
       stream.on("data", (chunk) => {
         const remaining = Math.max(0, outputLimit - outputBytes);
         if (remaining > 0) destination.write(chunk.subarray(0, remaining));
         outputBytes += chunk.length;
         if (outputBytes > outputLimit) overflowResolve({ kind: "overflow" });
       });
     }

     let server = null;
     let terminalPromise = null;
     async function terminalCleanup(fallbackStatus, graceSeconds, forceManual = false) {
       if (terminalPromise) return terminalPromise;
       terminalPromise = (async () => {
         const phaseFile = process.env.P2A_SUPERVISOR_TEST_PHASE_FILE ?? "";
         const delayPhase = process.env.P2A_SUPERVISOR_TEST_DELAY_PHASE ?? "";
         const phase = async (name) => {
           if (phaseFile) writeFileSync(phaseFile, `${name}\n`, { mode: 0o600 });
           if (delayPhase === name) await pause(1000);
         };
         await phase("termination");
         const terminal = await terminateOwnedGroup(groupId, leader, leaderResult, graceSeconds);
         await phase("server-close");
         const serverClosed = await closeServer(server);
         leader.stdout.destroy();
         leader.stderr.destroy();
         let clean = !forceManual && terminal.complete && serverClosed;
         if (clean) {
           await phase("artifact-removal");
           try {
             removeIfPresent(recordFile);
             removeIfPresent(socketPath);
             removeIfPresent(`${recordFile}.new`);
             if ((process.env.P2A_SUPERVISOR_EXTERNAL_EVIDENCE ?? "") !== ""
               && fallbackStatus !== 0) {
               persistEvidence(remediation, "delete-failed");
             } else {
               removeIfPresent(remediation.evidencePath);
               removeIfPresent(`${remediation.evidencePath}.new`);
             }
           } catch { clean = false; }
         }
         if (!clean) {
           try { publish(recordFile, { version: 1, state: "manual-remediation", socketPath, ...ids }); }
           catch {}
           try { persistEvidence(remediation, "manual-remediation"); } catch {}
           printManualRemediation(remediation);
         }
         await phase("final-exit");
         await pause(0);
         process.exitCode = authoritativeStatus(fallbackStatus, !clean);
         return { clean, terminal, serverClosed };
       })();
       return terminalPromise;
     }

     try {
       persistEvidence(remediation, "launching");
     } catch {
       await terminalCleanup(125, 0, true);
       return;
     }

     let launchResolve;
     let resultResolve;
     const launched = new Promise((resolve) => { launchResolve = resolve; });
     const commandResult = new Promise((resolve) => { resultResolve = resolve; });
     leader.on("message", (message) => {
       if (message?.type === "launched") launchResolve({ kind: "launched" });
       if (message?.type === "result") {
         resultResolve({ kind: "result", code: message.code, signal: message.signal,
           spawnError: message.spawnError === true });
       }
     });
     let handshakeTimer;
     const handshakeDeadline = new Promise((resolve) => {
       handshakeTimer = setTimeout(() => resolve({ kind: "handshake-timeout" }), 10000);
     });
     const launchOutcome = await Promise.race([
       launched,
       commandResult,
       leaderResult,
       overflow,
       interrupted,
       handshakeDeadline,
     ]);
     clearTimeout(handshakeTimer);
     if (launchOutcome.kind !== "launched") {
       if (launchOutcome.kind !== "signal") {
         console.error("ERROR  process launch handshake failed before publication");
       }
       await terminalCleanup(completedPrepublicationStatus(launchOutcome), 0);
       return;
     }

     let controlResolve;
     const controlled = new Promise((resolve) => { controlResolve = resolve; });
     server = installControlServer(token, socketPath, ids, controlResolve);
     try {
       await listen(server, socketPath);
       publish(recordFile, { version: 1, state: "running", socketPath, ...ids });
       persistEvidence(remediation, "running");
     } catch {
       console.error("ERROR  process launch handshake failed before publication");
       await terminalCleanup(127, 0);
       return;
     }

     let deadlineTimer;
     const deadline = limit === 0 ? new Promise(() => {}) : new Promise((resolve) => {
       deadlineTimer = setTimeout(() => resolve({ kind: "timeout" }), limit * 1000);
     });
     const outcome = await Promise.race([commandResult, deadline, interrupted, controlled, overflow]);
     if (deadlineTimer) clearTimeout(deadlineTimer);
     let fallbackStatus;
     if (outcome.kind === "timeout") {
       console.error("ERROR  process deadline exceeded");
       fallbackStatus = 124;
     } else if (outcome.kind === "overflow") {
       console.error("ERROR  process output exceeded bounded limit");
       fallbackStatus = 126;
     } else if (outcome.kind === "stop") {
       fallbackStatus = 0;
     } else if (outcome.kind === "signal") {
       fallbackStatus = conventionalSignalStatus(outcome.signal);
     } else if (outcome.spawnError) {
       fallbackStatus = 127;
     } else if (outcome.signal) {
       fallbackStatus = conventionalSignalStatus(outcome.signal);
     } else {
       fallbackStatus = completedCommandStatus(outcome.code);
     }
     await terminalCleanup(fallbackStatus,
       outcome.kind === "timeout" || outcome.kind === "signal" || outcome.kind === "stop" ? grace : 0);
   }

   try {
     const [mode, ...arguments_] = process.argv.slice(2);
     if (mode === "run") await runMode(arguments_);
     else if (mode === "control") await controlMode(arguments_);
     else throw new Error("unknown process-supervisor mode");
   } catch {
     console.error("ERROR  process supervisor rejected an unsafe or malformed invocation");
     process.exitCode = 125;
   }
   SUPERVISOR
   while IFS= read -r P2A_LAUNCHER_LINE; do
     printf '%s\n' "$P2A_LAUNCHER_LINE"
   done >"$P2A_LAUNCHER" <<'LAUNCHER'
   import { spawn } from "node:child_process";

   const [command, ...arguments_] = process.argv.slice(2);
   if (!command || typeof process.send !== "function") process.exit(127);
   for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {});
   const delayText = process.env.P2A_LAUNCHER_TEST_DELAY_MS ?? "";
   const launchDelay = /^(?:[1-9][0-9]{0,4})$/.test(delayText) ? Number(delayText) : 0;
   const childEnvironment = { ...process.env };
   delete childEnvironment.P2A_LAUNCHER_TEST_DELAY_MS;
   const child = spawn(command, arguments_, { env: childEnvironment, stdio: "inherit" });
   child.once("spawn", () => {
     if (launchDelay === 0) process.send({ type: "launched" });
     else setTimeout(() => process.send({ type: "launched" }), launchDelay);
   });
   child.once("error", () => {
     process.send({ type: "result", code: null, signal: null, spawnError: true });
   });
   child.once("exit", (code, signal) => {
     process.send({ type: "result", code, signal, spawnError: false });
   });
   setInterval(() => {}, 60_000);
   LAUNCHER
   chmod 700 "$P2A_SUPERVISOR"
   chmod 700 "$P2A_LAUNCHER"
   unset P2A_SUPERVISOR_LINE P2A_LAUNCHER_LINE
   P2A_CONTROL_TOKEN="$(openssl rand -hex 32)"

   supervisor_self_run() {
     local limit="$1" grace="$2" output_limit="$3" stem="$4"
     shift 4
     P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
       P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
       P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
       node "$P2A_SUPERVISOR" run \
       "$limit" "$grace" "$output_limit" "$P2A_TEST_ROOT/$stem.json" \
       "$P2A_TEST_ROOT/$stem.sock" "$P2A_LAUNCHER" "$@"
   }
   supervisor_self_status() {
     local expected="$1" label="$2" status
     shift 2
     if "$@"; then status=0; else status=$?; fi
     if [[ "$status" != "$expected" ]]; then
       echo "supervisor self-test $label returned $status, expected $expected" >&2
       return 1
     fi
   }

   supervisor_self_status 23 nonzero supervisor_self_run 5 1 1024 self-nonzero \
     sh -c 'exit 23' >"$P2A_TEST_ROOT/self-nonzero.out" 2>"$P2A_TEST_ROOT/self-nonzero.err"
   test ! -s "$P2A_TEST_ROOT/self-nonzero.out"
   test ! -s "$P2A_TEST_ROOT/self-nonzero.err"
   supervisor_self_status 127 reserved-status supervisor_self_run 5 1 1024 self-reserved-status \
     sh -c 'exit 125' \
     >"$P2A_TEST_ROOT/self-reserved-status.out" 2>"$P2A_TEST_ROOT/self-reserved-status.err"
   test ! -s "$P2A_TEST_ROOT/self-reserved-status.out"
   test ! -s "$P2A_TEST_ROOT/self-reserved-status.err"
   echo 'PASS  supervisor preserves ordinary nonzero status and reserves 125'

   supervisor_self_status 124 timeout supervisor_self_run 1 1 1024 self-timeout \
     sh -c 'while :; do sleep 1; done' \
     >"$P2A_TEST_ROOT/self-timeout.out" 2>"$P2A_TEST_ROOT/self-timeout.err"
   test ! -s "$P2A_TEST_ROOT/self-timeout.out"
   test "$(<"$P2A_TEST_ROOT/self-timeout.err")" = 'ERROR  process deadline exceeded'
   echo 'PASS  supervisor enforces the command deadline'

   P2A_TERM_MARKER="$P2A_TEST_ROOT/self-term.marker"
   supervisor_self_status 124 term-escalation supervisor_self_run 1 1 1024 self-term \
     node --input-type=module --eval '
       import { writeFileSync } from "node:fs";
       process.on("SIGTERM", () => writeFileSync(process.argv[1], "TERM"));
       setInterval(() => {}, 1000);
     ' "$P2A_TERM_MARKER" \
     >"$P2A_TEST_ROOT/self-term.out" 2>"$P2A_TEST_ROOT/self-term.err"
   test "$(<"$P2A_TERM_MARKER")" = TERM
   test "$(<"$P2A_TEST_ROOT/self-term.err")" = 'ERROR  process deadline exceeded'
   echo 'PASS  supervisor escalates TERM to KILL for a resistant group'

   P2A_SIGNAL_RECORD="$P2A_TEST_ROOT/self-signal.json"
   P2A_SIGNAL_SOCKET="$P2A_TEST_ROOT/self-signal.sock"
   P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
     P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
     P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
     node "$P2A_SUPERVISOR" run \
     0 1 1024 "$P2A_SIGNAL_RECORD" "$P2A_SIGNAL_SOCKET" "$P2A_LAUNCHER" \
     sh -c 'while :; do sleep 1; done' \
     >"$P2A_TEST_ROOT/self-signal.out" 2>"$P2A_TEST_ROOT/self-signal.err" &
   P2A_SIGNAL_PID=$!
   P2A_SIGNAL_READY=0
   for _ in $(seq 1 50); do
     if supervisor_control "$P2A_SIGNAL_RECORD" "$P2A_SIGNAL_SOCKET" probe \
       >/dev/null 2>&1; then
       P2A_SIGNAL_READY=1
       break
     fi
     sleep 0.1
   done
   test "$P2A_SIGNAL_READY" = 1
   supervisor_control "$P2A_SIGNAL_RECORD" "$P2A_SIGNAL_SOCKET" interrupt
   if wait "$P2A_SIGNAL_PID"; then P2A_SIGNAL_STATUS=0; else P2A_SIGNAL_STATUS=$?; fi
   test "$P2A_SIGNAL_STATUS" = 143
   test ! -e "$P2A_SIGNAL_RECORD"
   test ! -e "$P2A_SIGNAL_SOCKET"
   test ! -s "$P2A_TEST_ROOT/self-signal.out"
   test ! -s "$P2A_TEST_ROOT/self-signal.err"
   echo 'PASS  supervisor handles an authenticated external interruption'

   P2A_PREPUBLICATION_MARKERS=''
   for P2A_PREPUBLICATION_SPEC in HUP:129 INT:130 TERM:143; do
     P2A_PREPUBLICATION_SIGNAL="${P2A_PREPUBLICATION_SPEC%%:*}"
     P2A_PREPUBLICATION_EXPECTED="${P2A_PREPUBLICATION_SPEC##*:}"
     P2A_PREPUBLICATION_STEM="self-prepublication-$P2A_PREPUBLICATION_SIGNAL"
     P2A_PREPUBLICATION_RECORD="$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.json"
     P2A_PREPUBLICATION_SOCKET="$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.sock"
     P2A_PREPUBLICATION_EVIDENCE=''
     P2A_PREPUBLICATION_MARKER="$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.marker"
     P2A_PREPUBLICATION_MARKERS="$P2A_PREPUBLICATION_MARKERS $P2A_PREPUBLICATION_MARKER"
     P2A_LAUNCHER_TEST_DELAY_MS=5000 \
       P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
       P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
       P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
       node "$P2A_SUPERVISOR" run 0 1 1024 \
       "$P2A_PREPUBLICATION_RECORD" "$P2A_PREPUBLICATION_SOCKET" "$P2A_LAUNCHER" \
       sh -c '(sleep 2; printf "%s" leak >"$1") & wait' p2-a-prepublication \
         "$P2A_PREPUBLICATION_MARKER" \
       >"$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.out" \
       2>"$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.err" &
     P2A_PREPUBLICATION_PID=$!
     test "$P2A_PREPUBLICATION_PID" -gt 1
     for _ in $(seq 1 50); do
       P2A_PREPUBLICATION_EVIDENCE="$P2A_TEST_ROOT/process-$P2A_PREPUBLICATION_PID.evidence.json"
       if [[ -s "$P2A_PREPUBLICATION_EVIDENCE" ]]; then break; fi
       sleep 0.1
     done
     test -s "$P2A_PREPUBLICATION_EVIDENCE"
     test ! -e "$P2A_PREPUBLICATION_RECORD"
     test ! -e "$P2A_PREPUBLICATION_SOCKET"
     kill -"$P2A_PREPUBLICATION_SIGNAL" "$P2A_PREPUBLICATION_PID"
     if wait "$P2A_PREPUBLICATION_PID"; then
       P2A_PREPUBLICATION_STATUS=0
     else
       P2A_PREPUBLICATION_STATUS=$?
     fi
     test "$P2A_PREPUBLICATION_STATUS" = "$P2A_PREPUBLICATION_EXPECTED"
     test ! -e "$P2A_PREPUBLICATION_EVIDENCE"
     test ! -e "$P2A_PREPUBLICATION_RECORD"
     test ! -e "$P2A_PREPUBLICATION_SOCKET"
     test ! -s "$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.out"
     test ! -s "$P2A_TEST_ROOT/$P2A_PREPUBLICATION_STEM.err"
   done
   sleep 3
   for P2A_PREPUBLICATION_MARKER in $P2A_PREPUBLICATION_MARKERS; do
     test ! -e "$P2A_PREPUBLICATION_MARKER"
   done
   unset P2A_PREPUBLICATION_EVIDENCE P2A_PREPUBLICATION_EXPECTED P2A_PREPUBLICATION_MARKER
   unset P2A_PREPUBLICATION_MARKERS P2A_PREPUBLICATION_PID P2A_PREPUBLICATION_RECORD
   unset P2A_PREPUBLICATION_SIGNAL P2A_PREPUBLICATION_SOCKET P2A_PREPUBLICATION_SPEC
   unset P2A_PREPUBLICATION_STATUS P2A_PREPUBLICATION_STEM
   echo 'PASS  supervisor preserves pre-publication HUP, INT, and TERM statuses'

   for P2A_NATURAL_SPEC in HUP:129 INT:130 TERM:143 KILL:137; do
     P2A_NATURAL_SIGNAL="${P2A_NATURAL_SPEC%%:*}"
     P2A_NATURAL_EXPECTED="${P2A_NATURAL_SPEC##*:}"
     P2A_NATURAL_STEM="self-natural-$P2A_NATURAL_SIGNAL"
     supervisor_self_status "$P2A_NATURAL_EXPECTED" "natural-$P2A_NATURAL_SIGNAL" \
       supervisor_self_run 5 1 1024 "$P2A_NATURAL_STEM" \
       sh -c 'kill -"$1" "$$"' p2-a-natural "$P2A_NATURAL_SIGNAL" \
       >"$P2A_TEST_ROOT/$P2A_NATURAL_STEM.out" \
       2>"$P2A_TEST_ROOT/$P2A_NATURAL_STEM.err"
     test ! -s "$P2A_TEST_ROOT/$P2A_NATURAL_STEM.out"
     test ! -s "$P2A_TEST_ROOT/$P2A_NATURAL_STEM.err"
   done
   unset P2A_NATURAL_EXPECTED P2A_NATURAL_SIGNAL P2A_NATURAL_SPEC P2A_NATURAL_STEM
   echo 'PASS  supervisor preserves natural command signal statuses'

   supervisor_phase_signal() {
     local phase="$1" signal="$2" expected="$3" manual="$4" limit=5 command='exit 0'
     local stem="self-phase-$phase-$signal-$manual" phase_file="$P2A_TEST_ROOT/self-phase-$phase-$signal-$manual.phase"
     local record="$P2A_TEST_ROOT/$stem.json" socket="$P2A_TEST_ROOT/$stem.sock" pid ready=0 result
     if [[ "$phase" == termination ]]; then limit=1; command='while :; do sleep 1; done'; fi
     P2A_SUPERVISOR_TEST_FORCE_TERMINAL_FAILURE="$manual" \
       P2A_SUPERVISOR_TEST_DELAY_PHASE="$phase" P2A_SUPERVISOR_TEST_PHASE_FILE="$phase_file" \
       P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
       P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" node "$P2A_SUPERVISOR" run "$limit" 1 1024 \
       "$record" "$socket" "$P2A_LAUNCHER" sh -c "$command" \
       >"$P2A_TEST_ROOT/$stem.out" 2>"$P2A_TEST_ROOT/$stem.err" &
     pid=$!
     for _ in $(seq 1 150); do
       if [[ -s "$phase_file" && "$(<"$phase_file")" == "$phase" ]]; then ready=1; break; fi
       sleep 0.1
     done
     test "$ready" = 1
     kill -"$signal" "$pid"
     if wait "$pid"; then result=0; else result=$?; fi
     test "$result" = "$expected"
     if [[ "$manual" == 1 ]]; then
       test -s "$record"; test -s "$P2A_TEST_ROOT/process-$pid.evidence.json"
       grep -q manual-remediation "$record"
       grep -q 'manual remediation required' "$P2A_TEST_ROOT/$stem.err"
       rm -f -- "$record" "$socket" "$P2A_TEST_ROOT/process-$pid.evidence.json"
     else
       test ! -e "$record"; test ! -e "$socket"
       test ! -e "$P2A_TEST_ROOT/process-$pid.evidence.json"
     fi
   }
   supervisor_phase_signal termination HUP 129 0
   supervisor_phase_signal server-close INT 130 0
   supervisor_phase_signal artifact-removal TERM 143 0
   supervisor_phase_signal final-exit HUP 129 0
   echo 'PASS  supervisor keeps the first terminal signal authoritative through every cleanup phase'
   supervisor_phase_signal final-exit INT 130 1
   unset -f supervisor_phase_signal
   echo 'PASS  supervisor retains remediation evidence without overriding a latched signal'

   supervisor_self_status 126 output-overflow supervisor_self_run 5 1 1024 self-overflow \
     node --input-type=module --eval 'process.stdout.write("x".repeat(2048))' \
     >"$P2A_TEST_ROOT/self-overflow.out" 2>"$P2A_TEST_ROOT/self-overflow.err"
   test "$(wc -c <"$P2A_TEST_ROOT/self-overflow.out" | tr -d ' ')" = 1024
   test "$(<"$P2A_TEST_ROOT/self-overflow.err")" = 'ERROR  process output exceeded bounded limit'
   echo 'PASS  supervisor rejects output overflow at the exact byte bound'

   P2A_DESCENDANT_MARKER="$P2A_TEST_ROOT/self-descendant.marker"
   supervisor_self_status 0 descendant supervisor_self_run 5 1 1024 self-descendant \
     sh -c '(sleep 2; printf "%s" leak >"$1") & exit 0' p2-a-descendant "$P2A_DESCENDANT_MARKER" \
     >"$P2A_TEST_ROOT/self-descendant.out" 2>"$P2A_TEST_ROOT/self-descendant.err"
   sleep 3
   test ! -e "$P2A_DESCENDANT_MARKER"
   test ! -s "$P2A_TEST_ROOT/self-descendant.out"
   test ! -s "$P2A_TEST_ROOT/self-descendant.err"
   echo 'PASS  supervisor removes a background descendant after parent exit'

   P2A_PUBLICATION_MARKER="$P2A_TEST_ROOT/self-publication.marker"
   supervisor_self_status 127 publication supervisor_self_run 5 1 1024 \
     missing-parent/self-publication sh -c 'sleep 2; printf "%s" leak >"$1"' \
       p2-a-publication "$P2A_PUBLICATION_MARKER" \
     >"$P2A_TEST_ROOT/self-publication.out" 2>"$P2A_TEST_ROOT/self-publication.err"
   sleep 3
   test ! -e "$P2A_PUBLICATION_MARKER"
   test "$(<"$P2A_TEST_ROOT/self-publication.err")" = \
     'ERROR  process launch handshake failed before publication'
   echo 'PASS  supervisor fails closed when publication cannot complete'

   P2A_RETAIN_RECORD="$P2A_TEST_ROOT/missing-retain-parent/self-retain.json"
   P2A_RETAIN_SOCKET="$P2A_TEST_ROOT/missing-retain-parent/self-retain.sock"
   if P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
     P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
     P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
     P2A_SUPERVISOR_TEST_FORCE_TERMINAL_FAILURE=1 \
     node "$P2A_SUPERVISOR" run 5 1 1024 \
       "$P2A_RETAIN_RECORD" "$P2A_RETAIN_SOCKET" "$P2A_LAUNCHER" \
       sh -c 'sleep 2; printf "%s" leak >"$1"' p2-a-retain \
         "$P2A_TEST_ROOT/self-retain.marker" \
       >"$P2A_TEST_ROOT/self-retain.out" 2>"$P2A_TEST_ROOT/self-retain.err"; then
     P2A_RETAIN_STATUS=0
   else
     P2A_RETAIN_STATUS=$?
   fi
   test "$P2A_RETAIN_STATUS" = 125
   test ! -e "$P2A_TEST_ROOT/self-retain.marker"
   test ! -s "$P2A_TEST_ROOT/self-retain.out"
   P2A_RETAIN_EVIDENCE="$(find "$P2A_TEST_ROOT" -maxdepth 1 -type f \
     -name 'process-*.evidence.json' -print)"
   P2A_RETAIN_EVIDENCE="$P2A_RETAIN_EVIDENCE" \
     P2A_RETAIN_ERROR="$P2A_TEST_ROOT/self-retain.err" \
     P2A_RETAIN_RECORD="$P2A_RETAIN_RECORD" P2A_RETAIN_SOCKET="$P2A_RETAIN_SOCKET" \
     P2A_RETAIN_SITE_ID="$P2A_SITE_ID" P2A_RETAIN_ROOT="$P2A_TEST_ROOT" \
     node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync, statSync } from "node:fs";
       const evidence = JSON.parse(readFileSync(process.env.P2A_RETAIN_EVIDENCE, "utf8"));
       assert.equal(statSync(process.env.P2A_RETAIN_EVIDENCE).mode & 0o777, 0o600);
       assert.deepEqual(evidence, {
         version: 1,
         state: "manual-remediation",
         disposableSiteId: process.env.P2A_RETAIN_SITE_ID,
         guardedRoot: process.env.P2A_RETAIN_ROOT,
         evidencePath: process.env.P2A_RETAIN_EVIDENCE,
         recordPath: process.env.P2A_RETAIN_RECORD,
         socketPath: process.env.P2A_RETAIN_SOCKET,
         supervisorPid: evidence.supervisorPid,
         leaderPgid: evidence.leaderPgid,
       });
       assert.ok(Number.isSafeInteger(evidence.supervisorPid) && evidence.supervisorPid > 1);
       assert.ok(Number.isSafeInteger(evidence.leaderPgid) && evidence.leaderPgid > 1);
       assert.throws(() => process.kill(-evidence.leaderPgid, 0), (error) => error?.code === "ESRCH");
       const expected = `ERROR  process cleanup could not be proven within terminal bound; disposable-site-id=${evidence.disposableSiteId} guarded-root=${evidence.guardedRoot} evidence-path=${evidence.evidencePath} record-path=${evidence.recordPath} control-socket=${evidence.socketPath} supervisor-pid=${evidence.supervisorPid} leader-pgid=${evidence.leaderPgid}; manual remediation required\n`;
       assert.equal(readFileSync(process.env.P2A_RETAIN_ERROR, "utf8"), expected);
     '
   rm -f -- "$P2A_RETAIN_EVIDENCE" "$P2A_TEST_ROOT/self-retain.err"
   unset P2A_RETAIN_EVIDENCE P2A_RETAIN_ERROR P2A_RETAIN_RECORD P2A_RETAIN_SOCKET
   unset P2A_RETAIN_SITE_ID P2A_RETAIN_ROOT P2A_RETAIN_STATUS
   echo 'PASS  supervisor retains atomic evidence for pre-publication remediation'

   P2A_MISSING_EVIDENCE_ROOT="$P2A_TEST_ROOT/missing-evidence-root"
   P2A_MISSING_EVIDENCE_RECORD="$P2A_TEST_ROOT/missing-evidence-record/self-missing.json"
   P2A_MISSING_EVIDENCE_SOCKET="$P2A_TEST_ROOT/missing-evidence-record/self-missing.sock"
   if P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
     P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
     P2A_SUPERVISOR_TEST_ROOT="$P2A_MISSING_EVIDENCE_ROOT" \
     P2A_SUPERVISOR_TEST_FORCE_TERMINAL_FAILURE=1 \
     node "$P2A_SUPERVISOR" run 5 1 1024 \
       "$P2A_MISSING_EVIDENCE_RECORD" "$P2A_MISSING_EVIDENCE_SOCKET" \
       "$P2A_LAUNCHER" sh -c 'while :; do sleep 1; done' \
       >"$P2A_TEST_ROOT/self-missing-evidence.out" \
       2>"$P2A_TEST_ROOT/self-missing-evidence.err"; then
     P2A_MISSING_EVIDENCE_STATUS=0
   else
     P2A_MISSING_EVIDENCE_STATUS=$?
   fi
   test "$P2A_MISSING_EVIDENCE_STATUS" = 125
   test ! -s "$P2A_TEST_ROOT/self-missing-evidence.out"
   test ! -e "$P2A_MISSING_EVIDENCE_ROOT"
   P2A_MISSING_EVIDENCE_ERROR="$P2A_TEST_ROOT/self-missing-evidence.err" \
     P2A_MISSING_EVIDENCE_SITE_ID="$P2A_SITE_ID" \
     P2A_MISSING_EVIDENCE_ROOT="$P2A_MISSING_EVIDENCE_ROOT" \
     P2A_MISSING_EVIDENCE_RECORD="$P2A_MISSING_EVIDENCE_RECORD" \
     P2A_MISSING_EVIDENCE_SOCKET="$P2A_MISSING_EVIDENCE_SOCKET" \
     node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync } from "node:fs";
       const line = readFileSync(process.env.P2A_MISSING_EVIDENCE_ERROR, "utf8");
       const prefix = `ERROR  process cleanup could not be proven within terminal bound; disposable-site-id=${process.env.P2A_MISSING_EVIDENCE_SITE_ID} guarded-root=${process.env.P2A_MISSING_EVIDENCE_ROOT} evidence-path=${process.env.P2A_MISSING_EVIDENCE_ROOT}/process-`;
       const suffix = `.evidence.json record-path=${process.env.P2A_MISSING_EVIDENCE_RECORD} control-socket=${process.env.P2A_MISSING_EVIDENCE_SOCKET}`;
       assert.ok(line.startsWith(prefix));
       const remainder = line.slice(prefix.length);
       const pieces = remainder.split(suffix);
       assert.equal(pieces.length, 2);
       assert.match(pieces[0], /^[0-9]+$/);
       const match = /^ supervisor-pid=([0-9]+) leader-pgid=([0-9]+); manual remediation required\n$/.exec(pieces[1]);
       assert.ok(match);
       assert.ok(Number(pieces[0]) > 1 && Number(match[1]) > 1 && Number(match[2]) > 1);
       assert.equal(Number(pieces[0]), Number(match[1]));
     '
   rm -f -- "$P2A_TEST_ROOT/self-missing-evidence.err"
   unset P2A_MISSING_EVIDENCE_ERROR P2A_MISSING_EVIDENCE_ROOT
   unset P2A_MISSING_EVIDENCE_RECORD P2A_MISSING_EVIDENCE_SOCKET P2A_MISSING_EVIDENCE_STATUS
   unset P2A_MISSING_EVIDENCE_SITE_ID
   echo 'PASS  supervisor retains the tree boundary when evidence persistence fails'

   P2A_STALE_RECORD="$P2A_TEST_ROOT/self-stale.json"
   P2A_STALE_SOCKET="$P2A_TEST_ROOT/self-stale.sock"
   P2A_STALE_RECORD="$P2A_STALE_RECORD" P2A_STALE_SOCKET="$P2A_STALE_SOCKET" \
     node --input-type=module --eval '
       import { writeFileSync } from "node:fs";
       writeFileSync(process.env.P2A_STALE_RECORD, `${JSON.stringify({
         version: 1,
         state: "running",
         socketPath: process.env.P2A_STALE_SOCKET,
         supervisorPid: 2,
         leaderPgid: 2,
       })}\n`, { mode: 0o600 });
     '
   supervisor_self_status 125 stale-control supervisor_control \
     "$P2A_STALE_RECORD" "$P2A_STALE_SOCKET" stop \
     >"$P2A_TEST_ROOT/self-stale.out" 2>"$P2A_TEST_ROOT/self-stale.err"
   test ! -s "$P2A_TEST_ROOT/self-stale.out"
   test "$(<"$P2A_TEST_ROOT/self-stale.err")" = \
     'ERROR  process supervisor rejected an unsafe or malformed invocation'
   rm -f -- "$P2A_STALE_RECORD"
   echo 'PASS  supervisor refuses a stale record without signaling its IDs'

   P2A_DELETE_TEST_ROOT="$(mktemp -d "$P2A_TEMP_PARENT/p2-a-live.XXXXXX")"
   P2A_DELETE_TEST_EVIDENCE="$(mktemp "$P2A_TEMP_PARENT/.p2-a-delete.XXXXXX")"
   printf retained >"$P2A_DELETE_TEST_ROOT/payload"
   P2A_SUPERVISOR_EXTERNAL_EVIDENCE="$P2A_DELETE_TEST_EVIDENCE" \
     P2A_DELETE_ROOT="$P2A_DELETE_TEST_ROOT" P2A_DELETE_PARENT="$P2A_TEMP_PARENT" \
     P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
     P2A_SUPERVISOR_TEST_ROOT="$P2A_DELETE_TEST_ROOT" \
     node "$P2A_SUPERVISOR" run 1 1 1024 \
       "$P2A_DELETE_TEST_ROOT/delete-failure.json" \
       "$P2A_DELETE_TEST_ROOT/delete-failure.sock" "$P2A_LAUNCHER" \
       sh -c 'while :; do sleep 1; done' \
       >"$P2A_TEST_ROOT/self-delete-failure.out" \
       2>"$P2A_TEST_ROOT/self-delete-failure.err" && P2A_DELETE_TEST_STATUS=0 \
       || P2A_DELETE_TEST_STATUS=$?
   test "$P2A_DELETE_TEST_STATUS" = 124
   test -d "$P2A_DELETE_TEST_ROOT"
   test -s "$P2A_DELETE_TEST_EVIDENCE"
   P2A_DELETE_TEST_EVIDENCE="$P2A_DELETE_TEST_EVIDENCE" \
     P2A_DELETE_TEST_ROOT="$P2A_DELETE_TEST_ROOT" node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync, statSync } from "node:fs";
       const evidence = JSON.parse(readFileSync(process.env.P2A_DELETE_TEST_EVIDENCE, "utf8"));
       assert.equal(evidence.state, "delete-failed");
       assert.equal(evidence.guardedRoot, process.env.P2A_DELETE_TEST_ROOT);
       assert.equal(statSync(process.env.P2A_DELETE_TEST_EVIDENCE).mode & 0o777, 0o600);
       assert.ok(Number.isSafeInteger(evidence.supervisorPid) && evidence.supervisorPid > 1);
       assert.ok(Number.isSafeInteger(evidence.leaderPgid) && evidence.leaderPgid > 1);
     '
   rm -f -- "$P2A_DELETE_TEST_EVIDENCE"
   P2A_DELETE_TEST_EVIDENCE="$(mktemp "$P2A_TEMP_PARENT/.p2-a-delete.XXXXXX")"
   supervisor_self_status 0 bounded-delete \
     env P2A_SUPERVISOR_EXTERNAL_EVIDENCE="$P2A_DELETE_TEST_EVIDENCE" \
       P2A_DELETE_ROOT="$P2A_DELETE_TEST_ROOT" P2A_DELETE_PARENT="$P2A_TEMP_PARENT" \
       P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
       P2A_SUPERVISOR_TEST_ROOT="$P2A_DELETE_TEST_ROOT" \
       node "$P2A_SUPERVISOR" run 5 1 1024 \
       "$P2A_DELETE_TEST_ROOT/delete-success.json" \
       "$P2A_DELETE_TEST_ROOT/delete-success.sock" "$P2A_LAUNCHER" \
       node --input-type=module --eval '
         import { rmSync } from "node:fs";
         const target = process.env.P2A_DELETE_ROOT ?? "";
         const parent = process.env.P2A_DELETE_PARENT ?? "";
         if (!target.startsWith("/") || target === parent
           || target.slice(0, target.lastIndexOf("/")) !== parent
           || !/^p2-a-live\.[^/]{6}$/.test(target.slice(target.lastIndexOf("/") + 1))) process.exit(125);
         rmSync(target, { recursive: true, force: true });
       ' >"$P2A_TEST_ROOT/self-delete-success.out" 2>"$P2A_TEST_ROOT/self-delete-success.err"
   test ! -e "$P2A_DELETE_TEST_ROOT"
   test ! -e "$P2A_DELETE_TEST_EVIDENCE"
   test ! -s "$P2A_TEST_ROOT/self-delete-success.out"
   test ! -s "$P2A_TEST_ROOT/self-delete-success.err"
   unset P2A_DELETE_TEST_EVIDENCE P2A_DELETE_TEST_ROOT P2A_DELETE_TEST_STATUS
   echo 'PASS  supervisor bounds recursive deletion and retains exact failure evidence'

   P2A_SELF_RESIDUE="$(find "$P2A_TEST_ROOT" -maxdepth 2 \
     \( -name 'self-*.json' -o -name 'self-*.json.new' -o -name 'self-*.sock' \
       -o -name 'process-*.evidence.json' -o -name 'process-*.evidence.json.new' \) -print -quit)"
   test -z "$P2A_SELF_RESIDUE"
   test "$P2A_MANUAL_REMEDIATION" = 0
   unset P2A_SELF_RESIDUE P2A_SIGNAL_PID P2A_SIGNAL_STATUS P2A_SIGNAL_READY
   echo 'PASS  supervisor self-test cleanup removes every control artifact'

   cp "$P2A_REPO/package.json" "$P2A_TEST_ROOT/package.json"
   cd "$P2A_TEST_ROOT"
   must_run_bounded 600 'root package installation' \
     npm install --ignore-scripts --no-package-lock >/dev/null
   must_run_bounded 600 'hosted tool package installation' \
     npm install --ignore-scripts --no-package-lock --no-save \
       netlify-cli@24.2.0 playwright@1.55.0 >/dev/null
   P2A_CLI="$P2A_TEST_ROOT/node_modules/.bin/netlify"
   if [[ ! -x "$P2A_CLI" ]]; then
     echo 'ERROR  isolated Netlify CLI binary is unavailable; guarded cleanup is running' >&2
     exit 1
   fi
   must_run_bounded 30 'Netlify CLI version preflight' "$P2A_CLI" --version \
     >"$P2A_TEST_ROOT/netlify-version.txt"
   P2A_VERSION_FILE="$P2A_TEST_ROOT/netlify-version.txt" node --input-type=module --eval '
     import assert from "node:assert/strict";
     import { readFileSync } from "node:fs";
     assert.match(readFileSync(process.env.P2A_VERSION_FILE, "utf8"),
       /(?:^|\/)24\.2\.0(?:\s|$)/, "direct CLI must report exact netlify-cli 24.2.0");
   '
   rm -f -- "$P2A_TEST_ROOT/netlify-version.txt"
   P2A_SITE_DELETE_AUTHORIZED=1

   P2A_FIXTURE_NONCE="$(openssl rand -hex 32)"
   P2A_FIXTURE_NONCE_HASH="$(P2A_FIXTURE_NONCE="$P2A_FIXTURE_NONCE" node --input-type=module --eval '
     import { createHash } from "node:crypto";
     process.stdout.write(createHash("sha256").update(process.env.P2A_FIXTURE_NONCE, "utf8").digest("hex"));
   ')"
   P2A_PASSWORD="$(openssl rand -base64 36)"
   P2A_CURL_SECRET_CONFIG="$P2A_TEST_ROOT/fixture-curl.conf"
   printf 'header = "X-P2-A-Fixture: %s"\n' "$P2A_FIXTURE_NONCE" \
     >"$P2A_CURL_SECRET_CONFIG"
   chmod 600 "$P2A_CURL_SECRET_CONFIG"
   P2A_RUN_ID="$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)"
   P2A_LEGACY_MEMBER_EMAIL="p2a-${P2A_RUN_ID}-legacy-member@outside.invalid"
   P2A_LEGACY_GUEST_EMAIL="p2a-${P2A_RUN_ID}-legacy-guest@example.com"
   P2A_FINAL_ORG_EMAIL="p2a-${P2A_RUN_ID}-final-org@outside.invalid"
   P2A_FINAL_EXTERNAL_EMAIL="p2a-${P2A_RUN_ID}-final-external@example.com"

   mkdir -p \
     "$P2A_TEST_ROOT/netlify/edge-functions" \
     "$P2A_TEST_ROOT/netlify/functions/_p2_a_fixture" \
     "$P2A_TEST_ROOT/netlify/functions/_p2_a_shape" \
     "$P2A_TEST_ROOT/netlify/lib" \
     "$P2A_TEST_ROOT/_site/example" \
     "$P2A_TEST_ROOT/_site/login" \
     "$P2A_TEST_ROOT/_site/_assets"
   cp "$P2A_REPO/package.json" "$P2A_TEST_ROOT/package.json"
   cp "$P2A_REPO/netlify/edge-functions/gate.ts" "$P2A_TEST_ROOT/netlify/edge-functions/gate.ts"
   cp "$P2A_REPO/netlify/functions/login.mjs" "$P2A_TEST_ROOT/netlify/functions/login.mjs"
   cp "$P2A_REPO/netlify/functions/logout.mjs" "$P2A_TEST_ROOT/netlify/functions/logout.mjs"
   cp "$P2A_REPO/netlify/functions/session.mjs" "$P2A_TEST_ROOT/netlify/functions/session.mjs"
   cp "$P2A_REPO/netlify/lib/identity.mjs" "$P2A_TEST_ROOT/netlify/lib/identity-production.mjs"
   cp "$P2A_REPO/login/index.html" "$P2A_TEST_ROOT/_site/login/index.html"
   printf '%s\n' '<!doctype html><title>Invented index</title><p>Invented gated index.</p>' \
     >"$P2A_TEST_ROOT/_site/index.html"
   printf '%s\n' '<!doctype html><title>Invented document</title><p>Invented gated page.</p>' \
     >"$P2A_TEST_ROOT/_site/example/index.html"
   printf '%s\n' \
     '/d/a1b2c3 /example/ 301' \
     '/d/a1b2c3/* /example/ 301' \
     '/former-example /example/ 301!' \
     '/former-example/* /example/:splat 301!' \
     >"$P2A_TEST_ROOT/_site/_redirects"
   printf '%s\n' 'invented immutable asset' >"$P2A_TEST_ROOT/_site/_assets/fixture.txt"

   cp "$P2A_REPO/netlify.toml" "$P2A_TEST_ROOT/netlify.toml"

   install -m 600 /dev/stdin "$P2A_TEST_ROOT/netlify/functions/_p2_a_fixture/index.mjs" <<'FIXTURE'
   import { admin } from "@netlify/identity";
   import { Buffer } from "node:buffer";
   import { createHash, timingSafeEqual } from "node:crypto";

   const expectedNonceHash = "__P2A_NONCE_HASH__";

   function authorized(req) {
     const supplied = req.headers.get("x-p2-a-fixture") ?? "";
     const actualNonceHash = createHash("sha256").update(supplied, "utf8").digest("hex");
     return /^[0-9a-f]{64}$/.test(expectedNonceHash)
       && timingSafeEqual(Buffer.from(actualNonceHash, "ascii"), Buffer.from(expectedNonceHash, "ascii"));
   }

   export default async function fixture(req) {
     if (!authorized(req)) return new Response(null, { status: 404 });
     if (req.method === "POST") {
       const { email, password } = await req.json();
       if (typeof email !== "string" || !email || typeof password !== "string" || !password) {
         return new Response("Bad fixture", { status: 400 });
       }
       const user = await admin.createUser({ email, password });
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

   export const config = { path: "/api/p2-a-fixture" };
   FIXTURE

   P2A_FIXTURE_FILE="$P2A_TEST_ROOT/netlify/functions/_p2_a_fixture/index.mjs" \
     P2A_FIXTURE_NONCE_HASH="$P2A_FIXTURE_NONCE_HASH" node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync, writeFileSync } from "node:fs";
       const source = readFileSync(process.env.P2A_FIXTURE_FILE, "utf8");
       assert.equal((source.match(/__P2A_NONCE_HASH__/g) ?? []).length, 1);
       assert.match(process.env.P2A_FIXTURE_NONCE_HASH, /^[0-9a-f]{64}$/);
       writeFileSync(process.env.P2A_FIXTURE_FILE,
         source.replace("__P2A_NONCE_HASH__", process.env.P2A_FIXTURE_NONCE_HASH), { mode: 0o600 });
     '

   install -m 600 /dev/stdin "$P2A_TEST_ROOT/netlify/lib/identity.mjs" <<'IDENTITY'
   export { requireOrigin } from "./identity-production.mjs";
   import { identify as identifyProduction } from "./identity-production.mjs";

   const externalFixture = /^p2a-[0-9]{14}-[0-9a-f]{8}-(legacy-member|final-org)@outside\.invalid$/;
   const organizationFixture = /^p2a-[0-9]{14}-[0-9a-f]{8}-(legacy-guest|final-external)@example\.com$/;

   export async function identify(req) {
     const user = await identifyProduction(req);
     if (user === null) return null;
     const kind = externalFixture.exec(user.email)?.[1] ?? organizationFixture.exec(user.email)?.[1];
     if (kind === "legacy-member" || kind === "legacy-guest") {
       const legacy = { ...user, roles: [kind === "legacy-member" ? "member" : "guest"] };
       delete legacy.isOrg;
       return legacy;
     }
     if (kind === "final-org" || kind === "final-external") {
       return {
         sub: user.sub,
         email: user.email,
         name: user.name,
         isOrg: kind === "final-org",
       };
     }
     return user;
   }
   IDENTITY

   install -m 600 /dev/stdin "$P2A_TEST_ROOT/netlify/functions/_p2_a_shape/index.mjs" <<'SHAPE'
   import { identify } from "../../lib/identity.mjs";

   export default async function shape(req) {
     if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
     const user = await identify(req);
     if (user === null) return new Response(null, { status: 401 });
     return Response.json({
       context: process.env.CONTEXT ?? null,
       keys: Object.keys(user).sort(),
       roles: Array.isArray(user.roles) ? user.roles : null,
       isOrg: typeof user.isOrg === "boolean" ? user.isOrg : null,
       identityFieldsValid: [user.sub, user.email, user.name]
         .every((value) => typeof value === "string" && value.length > 0),
     }, { headers: { "Cache-Control": "private, no-store" } });
   }

   export const config = { path: "/api/p2-a-shape" };
   SHAPE

   install -m 600 /dev/stdin "$P2A_TEST_ROOT/p2-a-browser.mjs" <<'BROWSER'
   import assert from "node:assert/strict";
   import { chromium } from "playwright";

   const base = process.env.P2A_BROWSER_BASE;
   const email = process.env.P2A_BROWSER_EMAIL;
   const password = process.env.P2A_BROWSER_PASSWORD;
   assert.match(base ?? "", /^https:\/\//, "browser base must be a hosted HTTPS origin");
   assert.ok(email && password, "browser fixture credentials are required");

   const browser = await chromium.launch({ headless: true });
   try {
     const context = await browser.newContext();
     const page = await context.newPage();
     const requestedPath = "/example/?view=review";
     await page.goto(`${base}${requestedPath}`, { waitUntil: "domcontentloaded" });
     const redirected = new URL(page.url());
     assert.equal(`${redirected.pathname}${redirected.search}`,
       "/login/?next=%2Fexample%2F%3Fview%3Dreview");

     const parsed = await page.evaluate(() => {
       const visible = (element) => {
         const rect = element.getBoundingClientRect();
         for (let current = element; current; current = current.parentElement) {
           const style = getComputedStyle(current);
           if (current.hidden || style.display === "none" || style.visibility === "hidden"
             || style.visibility === "collapse" || Number(style.opacity) <= 0
             || style.clip !== "auto" || style.clipPath !== "none") return false;
         }
         return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
           && rect.top < innerHeight && rect.left < innerWidth;
       };
       const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
       const form = document.querySelector('form[method="post"][action="/api/login"]');
       const next = document.querySelector('input[name="next"]');
       const emailInput = document.getElementById("login-email");
       const passwordInput = document.getElementById("login-password");
       const submit = document.querySelector('button[type="submit"]');
       const heading = document.querySelector("h1");
       const error = document.getElementById("login-error");
       const labels = [...document.querySelectorAll("label")];
       return {
         duplicateIds: ids.length !== new Set(ids).size,
         formCount: document.forms.length,
         disabledCount: document.querySelectorAll(":disabled").length,
         inertCount: document.querySelectorAll("[inert]").length,
         nextValue: next?.value,
         parsedOwners: Boolean(form && next?.form === form && emailInput?.form === form
           && passwordInput?.form === form && submit?.form === form),
         labelAssociations: labels.length === 2
           && labels[0].control === emailInput && labels[1].control === passwordInput,
         visibleHeading: Boolean(heading && visible(heading)),
         visibleForm: Boolean(form && visible(form)),
         visibleLabels: labels.length === 2 && labels.every(visible),
         visibleEmail: Boolean(emailInput && visible(emailInput)),
         visiblePassword: Boolean(passwordInput && visible(passwordInput)),
         visibleSubmit: Boolean(submit && visible(submit)),
         errorInitiallyHidden: Boolean(error?.hidden && !visible(error)),
       };
     });
     assert.deepEqual(parsed, {
       duplicateIds: false,
       formCount: 1,
       disabledCount: 0,
       inertCount: 0,
       nextValue: requestedPath,
       parsedOwners: true,
       labelAssociations: true,
       visibleHeading: true,
       visibleForm: true,
       visibleLabels: true,
       visibleEmail: true,
       visiblePassword: true,
       visibleSubmit: true,
       errorInitiallyHidden: true,
     });

     async function assertVisibleFocus(selector) {
       await page.locator(selector).focus();
       const focus = await page.locator(selector).evaluate((element) => {
         const style = getComputedStyle(element);
         return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor };
       });
       assert.ok(focus.width > 0, `${selector} focus outline has zero width`);
       assert.notEqual(focus.style, "none", `${selector} focus outline has no visible style`);
       assert.ok(focus.color !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(focus.color),
         `${selector} focus outline is transparent`);
     }
     await assertVisibleFocus("#login-email");
     await assertVisibleFocus("#login-password");
     await assertVisibleFocus('button[type="submit"]');

     await page.goto(`${base}/login/?next=%2Fexample%2F&error=1`, { waitUntil: "domcontentloaded" });
     assert.equal(await page.locator("#login-error").isVisible(), true, "error=1 must reveal the alert");

     await page.goto(`${base}${requestedPath}`, { waitUntil: "domcontentloaded" });
     await page.locator("#login-email").fill(email);
     await page.locator("#login-password").fill(password);
     await Promise.all([
       page.waitForURL((url) => url.origin === base
         && `${url.pathname}${url.search}` === requestedPath),
       page.locator('button[type="submit"]').click(),
     ]);
     assert.equal((await page.locator("body").innerText()).trim(), "Invented gated page.");
     const cookieNames = (await context.cookies()).map(({ name }) => name)
       .filter((name) => name === "nf_jwt" || name === "nf_refresh").sort();
     assert.deepEqual(cookieNames, ["nf_jwt", "nf_refresh"]);
   } finally {
     await browser.close();
   }
   BROWSER

   cd "$P2A_TEST_ROOT"
   P2A_BROWSER_PATH="$P2A_TEST_ROOT/playwright-browsers"
   must_run_bounded 600 'Playwright Chromium installation' \
     env PLAYWRIGHT_BROWSERS_PATH="$P2A_BROWSER_PATH" \
       ./node_modules/.bin/playwright install chromium >/dev/null
   must_run_bounded 120 'Netlify site link' \
     "$P2A_CLI" link --id "$P2A_SITE_ID" >/dev/null
   P2A_DEV_RECORD="$P2A_TEST_ROOT/netlify-dev.json"
   P2A_DEV_SOCKET="$P2A_TEST_ROOT/netlify-dev.sock"
   P2A_SUPERVISOR_TOKEN="$P2A_CONTROL_TOKEN" \
     P2A_SUPERVISOR_SITE_ID="$P2A_SITE_ID" \
     P2A_SUPERVISOR_TEST_ROOT="$P2A_TEST_ROOT" \
     node "$P2A_SUPERVISOR" run \
     0 10 4194304 "$P2A_DEV_RECORD" "$P2A_DEV_SOCKET" "$P2A_LAUNCHER" \
     "$P2A_CLI" dev --dir _site --functions netlify/functions --port 8888 \
       --no-open --skip-gitignore >"$P2A_TEST_ROOT/netlify-dev.log" 2>&1 &
   P2A_DEV_PID=$!

   P2A_DEV_PUBLISHED=0
   for _ in $(seq 1 100); do
     if supervisor_control "$P2A_DEV_RECORD" "$P2A_DEV_SOCKET" probe >/dev/null 2>&1; then
       P2A_DEV_PUBLISHED=1
       break
     fi
     if ! kill -0 "$P2A_DEV_PID" 2>/dev/null; then break; fi
     sleep 0.1
   done
   if [[ "$P2A_DEV_PUBLISHED" != 1 ]]; then
     echo 'ERROR  local Netlify runtime launch/PGID publication handshake failed; guarded cleanup is running' >&2
     exit 1
   fi

   for _ in $(seq 1 60); do
     if curl --silent --output /dev/null --connect-timeout 1 --max-time 2 \
       http://127.0.0.1:8888/login/; then
       P2A_DEV_READY=1
       break
     fi
     sleep 1
   done
   if [[ "$P2A_DEV_READY" != 1 ]] || [[ ! "$P2A_DEV_PID" =~ ^[0-9]+$ ]] \
     || (( P2A_DEV_PID <= 1 )) || ! kill -0 "$P2A_DEV_PID" 2>/dev/null; then
     echo 'ERROR  local Netlify runtime did not become ready within the bounded startup window; guarded cleanup is running' >&2
     exit 1
   fi

   request() {
     local name="$1"; shift
     if ! curl --silent --show-error --connect-timeout 10 --max-time 25 \
       --dump-header "$P2A_TEST_ROOT/$name.headers" \
       --output "$P2A_TEST_ROOT/$name.body" "$@"; then
       echo "ERROR  HTTP request $name failed or timed out; guarded cleanup is running" >&2
       return 1
     fi
   }
   response_head() {
     P2A_HEADERS="$P2A_TEST_ROOT/$1.headers" P2A_STATUS="${2:-}" \
       P2A_HEADER_NAME="${3:-}" P2A_HEADER_VALUE="${4:-}" \
       node --input-type=module --eval '
         import assert from "node:assert/strict";
         import { readFileSync } from "node:fs";
         const blocks = readFileSync(process.env.P2A_HEADERS, "utf8")
           .split(/\r?\n\r?\n/).filter((block) => /^HTTP\//.test(block));
         assert.ok(blocks.length >= 1, "response has no HTTP header block");
         const lines = blocks.at(-1).split(/\r?\n/);
         const status = /^HTTP\/\S+ ([0-9]{3})(?: |$)/.exec(lines[0])?.[1];
         if (process.env.P2A_STATUS) assert.equal(status, process.env.P2A_STATUS);
         if (process.env.P2A_HEADER_NAME) {
           const name = process.env.P2A_HEADER_NAME.toLowerCase();
           const values = lines.slice(1).flatMap((line) => {
             const colon = line.indexOf(":");
             return colon > 0 && line.slice(0, colon).toLowerCase() === name
               ? [line.slice(colon + 1).trim()] : [];
           });
           assert.deepEqual(values, [process.env.P2A_HEADER_VALUE]);
         }
       '
   }
   status_is() { response_head "$1" "$2"; }
   header_is() { response_head "$1" '' "$2" "$3"; }
   body_is() {
     P2A_BODY="$P2A_TEST_ROOT/$1.body" P2A_BODY_VALUE="$2" \
       node --input-type=module --eval '
         import assert from "node:assert/strict";
         import { readFileSync } from "node:fs";
         assert.deepEqual(readFileSync(process.env.P2A_BODY), Buffer.from(process.env.P2A_BODY_VALUE, "utf8"));
       '
   }
   empty_body() { test ! -s "$P2A_TEST_ROOT/$1.body"; }
   cookie_names_are() {
     P2A_COOKIE_JAR="$1" P2A_COOKIE_NAMES="$2" node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync } from "node:fs";
       const names = readFileSync(process.env.P2A_COOKIE_JAR, "utf8")
         .split(/\r?\n/)
         .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
         .map((line) => line.split("\t"))
         .filter((columns) => columns.length >= 7)
         .map((columns) => columns[5])
         .filter((name) => name === "nf_jwt" || name === "nf_refresh")
         .sort();
       const expected = process.env.P2A_COOKIE_NAMES ? process.env.P2A_COOKIE_NAMES.split(",").sort() : [];
       assert.deepEqual(names, expected);
     '
   }
   response_cookie_names_are() {
     P2A_HEADERS="$P2A_TEST_ROOT/$1.headers" P2A_COOKIE_NAMES="$2" \
       node --input-type=module --eval '
         import assert from "node:assert/strict";
         import { readFileSync } from "node:fs";
         const blocks = readFileSync(process.env.P2A_HEADERS, "utf8")
           .split(/\r?\n\r?\n/).filter((block) => /^HTTP\//.test(block));
         assert.ok(blocks.length >= 1);
         const names = blocks.at(-1).split(/\r?\n/).slice(1).flatMap((line) => {
           const match = /^set-cookie\s*:\s*([^=;\s]+)=/i.exec(line);
           return match && (match[1] === "nf_jwt" || match[1] === "nf_refresh") ? [match[1]] : [];
         }).sort();
         const expected = process.env.P2A_COOKIE_NAMES ? process.env.P2A_COOKIE_NAMES.split(",").sort() : [];
         assert.deepEqual(names, expected);
       '
   }

   login_request() {
     local name="$1" base="$2" email="$3" next="$4" jar="$5" origin="${6:-$2}"
     if ! (P2A_FORM_EMAIL="$email" P2A_FORM_PASSWORD="$P2A_PASSWORD" P2A_FORM_NEXT="$next" \
       node --input-type=module --eval '
          process.stdout.write(new URLSearchParams({
            email: process.env.P2A_FORM_EMAIL,
            password: process.env.P2A_FORM_PASSWORD,
            next: process.env.P2A_FORM_NEXT,
          }).toString());
        ' | curl --silent --show-error --connect-timeout 10 --max-time 25 \
            --dump-header "$P2A_TEST_ROOT/$name.headers" \
            --output "$P2A_TEST_ROOT/$name.body" \
            --cookie-jar "$jar" --request POST \
            --header "Origin: $origin" \
            --header 'Content-Type: application/x-www-form-urlencoded' \
            --data-binary @- "$base/api/login"); then
       echo "ERROR  login request $name failed or timed out; guarded cleanup is running" >&2
       return 1
     fi
   }

   route_matrix() {
     local base="${1%/}" prefix="$2"
     request "$prefix-root" "$base/"
     status_is "$prefix-root" 302
     header_is "$prefix-root" location '/login/?next=%2F'
     header_is "$prefix-root" cache-control 'private, no-store'
     empty_body "$prefix-root"
     request "$prefix-document" "$base/example/?view=review"
     status_is "$prefix-document" 302
     header_is "$prefix-document" location '/login/?next=%2Fexample%2F%3Fview%3Dreview'
     header_is "$prefix-document" cache-control 'private, no-store'
     empty_body "$prefix-document"
     request "$prefix-permanent-id" "$base/d/a1b2c3"
     status_is "$prefix-permanent-id" 302
     header_is "$prefix-permanent-id" location '/login/?next=%2Fd%2Fa1b2c3'
     header_is "$prefix-permanent-id" cache-control 'private, no-store'
     empty_body "$prefix-permanent-id"
     request "$prefix-alias" "$base/former-example/section?view=review"
     status_is "$prefix-alias" 302
     header_is "$prefix-alias" location '/login/?next=%2Fformer-example%2Fsection%3Fview%3Dreview'
     header_is "$prefix-alias" cache-control 'private, no-store'
     empty_body "$prefix-alias"
     request "$prefix-invite-bare" "$base/invite"
     status_is "$prefix-invite-bare" 302
     header_is "$prefix-invite-bare" location '/login/?next=%2Finvite'
     header_is "$prefix-invite-bare" cache-control 'private, no-store'
     empty_body "$prefix-invite-bare"
     request "$prefix-invite-root" "$base/invite/"
     status_is "$prefix-invite-root" 404
     request "$prefix-invite-child-post" --request POST "$base/invite/accept"
     status_is "$prefix-invite-child-post" 404
     request "$prefix-accept-get" "$base/api/accept"
     status_is "$prefix-accept-get" 404
     request "$prefix-accept-post" --request POST "$base/api/accept"
     status_is "$prefix-accept-post" 404
     request "$prefix-accept-slash" --request POST "$base/api/accept/"
     status_is "$prefix-accept-slash" 404
     request "$prefix-future" "$base/future-top-level/"
     status_is "$prefix-future" 302
     header_is "$prefix-future" location '/login/?next=%2Ffuture-top-level%2F'
     header_is "$prefix-future" cache-control 'private, no-store'
     empty_body "$prefix-future"
     request "$prefix-login" "$base/login/"
     status_is "$prefix-login" 200
     cmp "$P2A_TEST_ROOT/$prefix-login.body" "$P2A_TEST_ROOT/_site/login/index.html"
     request "$prefix-api" "$base/api/session"
     status_is "$prefix-api" 401
     request "$prefix-asset" "$base/_assets/fixture.txt"
     status_is "$prefix-asset" 200
     cmp "$P2A_TEST_ROOT/$prefix-asset.body" "$P2A_TEST_ROOT/_site/_assets/fixture.txt"
   }

   deploy_context() {
     local context="$1" output="$P2A_TEST_ROOT/deploy-$1.json"
     if ! run_bounded 300 "$P2A_CLI" deploy --context "$context" --dir _site \
       --functions netlify/functions --no-build --json >"$output"; then
       echo "ERROR  Netlify $context deployment failed or timed out; guarded cleanup is running" >&2
       return 1
     fi
     node --input-type=module --eval '
       import { readFileSync } from "node:fs";
       const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
       const url = result.deploy_url ?? result.deployUrl;
       if (typeof url !== "string" || !url.startsWith("https://")) process.exit(1);
       process.stdout.write(url);
     ' "$output"
   }

   route_matrix 'http://127.0.0.1:8888' local
   echo 'PASS  local gated and excluded route matrix'

   request invalid-cookie --header 'Cookie: nf_jwt=invalid-fixture-token' \
     http://127.0.0.1:8888/example/
   status_is invalid-cookie 302

   P2A_PREVIEW_URL="$(deploy_context deploy-preview)"
   P2A_ADMIN_BASE="$P2A_PREVIEW_URL"
   route_matrix "$P2A_PREVIEW_URL" deploy-preview
   echo 'PASS  deploy-preview gated and excluded route matrix'
   P2A_BRANCH_URL="$(deploy_context branch-deploy)"
   route_matrix "$P2A_BRANCH_URL" branch-deploy
   echo 'PASS  branch-deploy gated and excluded route matrix'

   create_user() {
     local email="$1" out="$2" user_id
     if ! (P2A_EMAIL="$email" P2A_PASSWORD="$P2A_PASSWORD" \
       node --input-type=module --eval '
         process.stdout.write(JSON.stringify({
           email: process.env.P2A_EMAIL,
           password: process.env.P2A_PASSWORD,
         }));
       ' | curl --fail --silent --show-error --config "$P2A_CURL_SECRET_CONFIG" \
           --connect-timeout 10 --max-time 25 \
           --header 'Content-Type: application/json' \
           --data-binary @- \
           "$P2A_ADMIN_BASE/api/p2-a-fixture" --output "$out"); then
       echo 'ERROR  fixture user creation failed or timed out; guarded cleanup is running' >&2
       return 1
     fi
     user_id="$(node --input-type=module --eval \
       'const j=JSON.parse(await new Response(process.stdin).text()); if(typeof j.id!=="string"||!j.id)process.exit(1); process.stdout.write(j.id)' \
       <"$out")"
     P2A_USER_IDS+=("$user_id")
   }
   create_user "$P2A_LEGACY_MEMBER_EMAIL" "$P2A_TEST_ROOT/legacy-member.json"
   create_user "$P2A_LEGACY_GUEST_EMAIL" "$P2A_TEST_ROOT/legacy-guest.json"
   create_user "$P2A_FINAL_ORG_EMAIL" "$P2A_TEST_ROOT/final-org.json"
   create_user "$P2A_FINAL_EXTERNAL_EMAIL" "$P2A_TEST_ROOT/final-external.json"

   (
     export P2A_BROWSER_BASE="$P2A_PREVIEW_URL"
     export P2A_BROWSER_EMAIL="$P2A_LEGACY_MEMBER_EMAIL"
     export P2A_BROWSER_PASSWORD="$P2A_PASSWORD"
     export PLAYWRIGHT_BROWSERS_PATH="$P2A_BROWSER_PATH"
     must_run_bounded 180 'hosted browser login flow' \
       node "$P2A_TEST_ROOT/p2-a-browser.mjs"
   )
   echo 'PASS  hosted parsed DOM and browser form flow'

   identity_shape_is() {
     local name="$1" expected_kind="$2" expected_context="$3"
     P2A_SHAPE_FILE="$P2A_TEST_ROOT/$name.body" P2A_SHAPE_KIND="$expected_kind" \
       P2A_SHAPE_CONTEXT="$expected_context" \
       node --input-type=module --eval '
         import assert from "node:assert/strict";
         import { readFileSync } from "node:fs";
         const shape = JSON.parse(readFileSync(process.env.P2A_SHAPE_FILE, "utf8"));
         assert.deepEqual(Object.keys(shape), ["context", "keys", "roles", "isOrg", "identityFieldsValid"]);
         assert.equal(shape.context, process.env.P2A_SHAPE_CONTEXT);
         if (process.env.P2A_SHAPE_KIND === "legacy-member") {
           assert.ok(shape.keys.includes("roles"));
           assert.ok(!shape.keys.includes("isOrg"));
           assert.deepEqual(shape.roles, ["member"]);
           assert.equal(shape.isOrg, null);
         } else if (process.env.P2A_SHAPE_KIND === "legacy-guest") {
           assert.ok(shape.keys.includes("roles"));
           assert.ok(!shape.keys.includes("isOrg"));
           assert.deepEqual(shape.roles, ["guest"]);
           assert.equal(shape.isOrg, null);
         } else {
           assert.deepEqual(shape.keys, ["email", "isOrg", "name", "sub"]);
           assert.equal(shape.roles, null);
           assert.equal(shape.isOrg, process.env.P2A_SHAPE_KIND === "final-org");
           assert.equal(shape.identityFieldsValid, true,
             "final identity fields must be non-empty strings without exposing their values");
         }
       '
   }

   identity_case() {
     local base="${1%/}" prefix="$2" expected_context="$3" allow_email="$4" allow_kind="$5"
     local deny_email="$6" deny_kind="$7"
     local allow_jar="$P2A_TEST_ROOT/$prefix-allow.jar"
     local deny_jar="$P2A_TEST_ROOT/$prefix-deny.jar"

     login_request "$prefix-allow-login" "$base" "$allow_email" \
       '/example/?view=review' "$allow_jar"
     status_is "$prefix-allow-login" 302
     header_is "$prefix-allow-login" location '/example/?view=review'
     header_is "$prefix-allow-login" cache-control 'private, no-store'
     empty_body "$prefix-allow-login"
     response_cookie_names_are "$prefix-allow-login" 'nf_jwt,nf_refresh'
     cookie_names_are "$allow_jar" 'nf_jwt,nf_refresh'

     request "$prefix-allow-shape" --cookie "$allow_jar" "$base/api/p2-a-shape"
     status_is "$prefix-allow-shape" 200
     header_is "$prefix-allow-shape" cache-control 'private, no-store'
     identity_shape_is "$prefix-allow-shape" "$allow_kind" "$expected_context"
     request "$prefix-allow-document" --cookie "$allow_jar" "$base/example/"
     status_is "$prefix-allow-document" 200
     cmp "$P2A_TEST_ROOT/$prefix-allow-document.body" "$P2A_TEST_ROOT/_site/example/index.html"
     request "$prefix-default-login-route" --cookie "$allow_jar" "$base/.netlify/functions/login"
     status_is "$prefix-default-login-route" 404
     request "$prefix-default-logout-route" --cookie "$allow_jar" "$base/.netlify/functions/logout"
     status_is "$prefix-default-logout-route" 404

     login_request "$prefix-deny-login" "$base" "$deny_email" '/example/' "$deny_jar"
     status_is "$prefix-deny-login" 302
     header_is "$prefix-deny-login" location '/example/'
     header_is "$prefix-deny-login" cache-control 'private, no-store'
     empty_body "$prefix-deny-login"
     response_cookie_names_are "$prefix-deny-login" 'nf_jwt,nf_refresh'
     cookie_names_are "$deny_jar" 'nf_jwt,nf_refresh'
     request "$prefix-deny-shape" --cookie "$deny_jar" "$base/api/p2-a-shape"
     status_is "$prefix-deny-shape" 200
     header_is "$prefix-deny-shape" cache-control 'private, no-store'
     identity_shape_is "$prefix-deny-shape" "$deny_kind" "$expected_context"
     request "$prefix-deny-document" --cookie "$deny_jar" "$base/example/"
     status_is "$prefix-deny-document" 403
     header_is "$prefix-deny-document" content-type 'text/plain; charset=utf-8'
     header_is "$prefix-deny-document" cache-control 'private, no-store'
     body_is "$prefix-deny-document" 'You do not have access to this document.'

     request "$prefix-rejected-logout" --cookie "$allow_jar" --cookie-jar "$allow_jar" --request POST \
       --header 'Origin: https://elsewhere.invalid' "$base/api/logout"
     status_is "$prefix-rejected-logout" 403
     header_is "$prefix-rejected-logout" content-type 'text/plain; charset=utf-8'
     header_is "$prefix-rejected-logout" cache-control 'private, no-store'
     body_is "$prefix-rejected-logout" 'Bad origin'
     response_cookie_names_are "$prefix-rejected-logout" ''
     cookie_names_are "$allow_jar" 'nf_jwt,nf_refresh'
     cookie_names_are "$deny_jar" 'nf_jwt,nf_refresh'
     request "$prefix-after-rejected-logout" --cookie "$allow_jar" "$base/example/"
     status_is "$prefix-after-rejected-logout" 200
     cmp "$P2A_TEST_ROOT/$prefix-after-rejected-logout.body" "$P2A_TEST_ROOT/_site/example/index.html"

     request "$prefix-logout" --cookie "$allow_jar" --cookie-jar "$allow_jar" \
       --request POST --header "Origin: $base" "$base/api/logout"
     status_is "$prefix-logout" 302
     header_is "$prefix-logout" location '/login/'
     header_is "$prefix-logout" cache-control 'private, no-store'
     empty_body "$prefix-logout"
     response_cookie_names_are "$prefix-logout" 'nf_jwt,nf_refresh'
     cookie_names_are "$allow_jar" ''
     cookie_names_are "$deny_jar" 'nf_jwt,nf_refresh'
     request "$prefix-after-logout" --cookie "$allow_jar" "$base/example/"
     status_is "$prefix-after-logout" 302
     header_is "$prefix-after-logout" location '/login/?next=%2Fexample%2F'
     header_is "$prefix-after-logout" cache-control 'private, no-store'
     empty_body "$prefix-after-logout"

     request "$prefix-deny-logout" --cookie "$deny_jar" --cookie-jar "$deny_jar" \
       --request POST --header "Origin: $base" "$base/api/logout"
     status_is "$prefix-deny-logout" 302
     header_is "$prefix-deny-logout" location '/login/'
     header_is "$prefix-deny-logout" cache-control 'private, no-store'
     empty_body "$prefix-deny-logout"
     response_cookie_names_are "$prefix-deny-logout" 'nf_jwt,nf_refresh'
     cookie_names_are "$deny_jar" ''
     request "$prefix-deny-after-logout" --cookie "$deny_jar" "$base/example/"
     status_is "$prefix-deny-after-logout" 302
     header_is "$prefix-deny-after-logout" location '/login/?next=%2Fexample%2F'
     header_is "$prefix-deny-after-logout" cache-control 'private, no-store'
     empty_body "$prefix-deny-after-logout"
   }

   hosted_identity_matrix() {
     local base="$1" prefix="$2" expected_context="$3"
     identity_case "$base" "$prefix-legacy" "$expected_context" \
       "$P2A_LEGACY_MEMBER_EMAIL" legacy-member "$P2A_LEGACY_GUEST_EMAIL" legacy-guest
     identity_case "$base" "$prefix-final" "$expected_context" \
       "$P2A_FINAL_ORG_EMAIL" final-org "$P2A_FINAL_EXTERNAL_EMAIL" final-external
   }

   hosted_identity_matrix "$P2A_PREVIEW_URL" deploy-preview-auth deploy-preview
   echo 'PASS  deploy-preview authenticated Identity and cookie lifecycle'
   hosted_identity_matrix "$P2A_BRANCH_URL" branch-deploy-auth branch-deploy
   echo 'PASS  branch-deploy authenticated Identity and cookie lifecycle'

   anonymous_logout_case() {
     local base="${1%/}" prefix="$2"
     request "$prefix-no-session-logout" --request POST --header "Origin: $base" "$base/api/logout"
     status_is "$prefix-no-session-logout" 302
     header_is "$prefix-no-session-logout" location '/login/'
     header_is "$prefix-no-session-logout" cache-control 'private, no-store'
     empty_body "$prefix-no-session-logout"
     response_cookie_names_are "$prefix-no-session-logout" 'nf_jwt,nf_refresh'
     request "$prefix-after-no-session-logout" "$base/example/"
     status_is "$prefix-after-no-session-logout" 302
     header_is "$prefix-after-no-session-logout" location '/login/?next=%2Fexample%2F'
     header_is "$prefix-after-no-session-logout" cache-control 'private, no-store'
     empty_body "$prefix-after-no-session-logout"
   }
   anonymous_logout_case "$P2A_PREVIEW_URL" deploy-preview
   anonymous_logout_case "$P2A_BRANCH_URL" branch-deploy

   request login-get http://127.0.0.1:8888/api/login
   status_is login-get 405
   header_is login-get allow POST
   request logout-get http://127.0.0.1:8888/api/logout
   status_is logout-get 405
   header_is logout-get allow POST
   request bad-form --request POST --header 'Origin: http://127.0.0.1:8888' \
     --header 'Content-Type: application/json' --data '{}' http://127.0.0.1:8888/api/login
   status_is bad-form 400
   header_is bad-form content-type 'text/plain; charset=utf-8'
   header_is bad-form cache-control 'private, no-store'
   body_is bad-form 'Invalid form'
   login_request bad-origin 'http://127.0.0.1:8888' "$P2A_LEGACY_MEMBER_EMAIL" '/' \
     "$P2A_TEST_ROOT/bad-origin.jar" 'https://elsewhere.invalid'
   status_is bad-origin 403
   header_is bad-origin content-type 'text/plain; charset=utf-8'
   header_is bad-origin cache-control 'private, no-store'
   body_is bad-origin 'Bad origin'

   request bad-credentials --request POST --header 'Origin: http://127.0.0.1:8888' \
     --data-urlencode 'email=missing@review.invalid' --data-urlencode 'password=invented-wrong-password' \
     --data-urlencode 'next=/example/' http://127.0.0.1:8888/api/login
   status_is bad-credentials 302
   header_is bad-credentials location '/login/?next=%2Fexample%2F&error=1'
   header_is bad-credentials cache-control 'private, no-store'
   empty_body bad-credentials

   P2A_PASSWORD="$P2A_PASSWORD" P2A_FIXTURE_NONCE="$P2A_FIXTURE_NONCE" \
     node --input-type=module --eval '
       import assert from "node:assert/strict";
       import { readFileSync } from "node:fs";
       for (const path of process.argv.slice(1)) {
         const content = readFileSync(path, "utf8");
         assert.ok(!content.includes(process.env.P2A_PASSWORD), `${path} contains the generated password`);
         assert.ok(!content.includes(process.env.P2A_FIXTURE_NONCE), `${path} contains the fixture nonce`);
       }
     ' "$P2A_TEST_ROOT/netlify-dev.log" "$P2A_TEST_ROOT/deploy-deploy-preview.json" \
       "$P2A_TEST_ROOT/deploy-branch-deploy.json"

   echo 'PASS  organization pass-through and external denial'
   echo 'PASS  login origin, redirect, and runtime cookies'
   echo 'PASS  logout origin and session cleanup'
   cleanup
   trap - EXIT HUP INT TERM
   test ! -e "$P2A_REPO/.netlify"
   test ! -e "$P2A_REPO/package-lock.json"
   echo 'PASS  disposable Identity fixture cleaned'
   BASH
   ```

   Expected contract output contains these twenty-six lines in order and ends with the cleanup line:

   ```text
   PASS  supervisor preserves ordinary nonzero status and reserves 125
   PASS  supervisor enforces the command deadline
   PASS  supervisor escalates TERM to KILL for a resistant group
   PASS  supervisor handles an authenticated external interruption
   PASS  supervisor preserves pre-publication HUP, INT, and TERM statuses
   PASS  supervisor preserves natural command signal statuses
   PASS  supervisor keeps the first terminal signal authoritative through every cleanup phase
   PASS  supervisor retains remediation evidence without overriding a latched signal
   PASS  supervisor rejects output overflow at the exact byte bound
   PASS  supervisor removes a background descendant after parent exit
   PASS  supervisor fails closed when publication cannot complete
   PASS  supervisor retains atomic evidence for pre-publication remediation
   PASS  supervisor retains the tree boundary when evidence persistence fails
   PASS  supervisor refuses a stale record without signaling its IDs
   PASS  supervisor bounds recursive deletion and retains exact failure evidence
   PASS  supervisor self-test cleanup removes every control artifact
   PASS  local gated and excluded route matrix
   PASS  deploy-preview gated and excluded route matrix
   PASS  branch-deploy gated and excluded route matrix
   PASS  hosted parsed DOM and browser form flow
   PASS  deploy-preview authenticated Identity and cookie lifecycle
   PASS  branch-deploy authenticated Identity and cookie lifecycle
   PASS  organization pass-through and external denial
   PASS  login origin, redirect, and runtime cookies
   PASS  logout origin and session cleanup
   PASS  disposable Identity fixture cleaned
   ```

   Each route matrix sends real requests through the repository's copied `netlify.toml`, not a recreated declaration. For the root, current document, permanent-ID, alias, bare `/invite`, and unknown future GET route classes it proves the exact anonymous gate status, Location, single `private, no-store` header, and zero-byte body before redirects/static/404 handling. It separately proves that exact `/invite/`, a POST to its descendant, exact GET and POST `/api/accept`, and trailing-slash POST `/api/accept/` reach 404 before P4-K instead of the gate response; those downstream 404 body/header bytes belong to Netlify and are intentionally not restated as a P2-A response. The exact anonymous gate response plus the byte-identical public login and asset responses mechanically prove that neither hosted context has a project/team access wall in front of P2-A. The operator's exact pre-secret confirmation is the fail-closed evidence for account-side blankness, invite-only mode, lack of production attachment, and deletion authority that the deployed application boundary cannot enumerate safely.

   The isolated Playwright browser uses the deployed page itself. It checks the parsed DOM rather than source order: unique IDs, one form, actual form owners, no disabled or inert element, visible heading/form/credentials/submit control, initially hidden and subsequently visible alert, and the computed focus outline on both input and button. It then fills the real controls, activates the real submit button, follows the 302, verifies the gated document body, and observes only the two auth cookie names. No credential or cookie value is emitted.

   In both deployed origins, four independent real credential flows obtain exactly one `nf_jwt` and one `nf_refresh` cookie before the disposable wrapper can project anything. Raw response-header parsing proves those cookie names arrive from the runtime on login/logout; static tripwires plus semantic review, rather than the header observation alone, establish that application source does not author or read them. Authenticated 404s at both default `/.netlify/functions/*` names prove only the custom routes exist. The shape Function proves the runtime `CONTEXT`, the legacy roles/no-`isOrg` distinction, and the final exact key set, boolean `isOrg`, and non-empty string `sub`, `email`, and `name` without exposing any identity value. The external-suffix allow identities and organization-suffix deny identities prove that the unmodified gate consumes `roles`/`isOrg` rather than independently inferring authority from email.

   A rejected cross-origin logout writes its response into the same allow-session jar, emits no cookie mutation, and leaves the complete allowed document reachable. Normal valid logout for every authenticated session proves both cookie names disappear and the following navigation becomes anonymous. Separate same-origin calls with no cookie in both contexts prove the runtime's idempotent no-session response and following anonymous state. The isolated rejection seam—not this live matrix—proves only that the handler absorbs an upstream logout exception; safely inducing that provider failure in the hosted runtime would require changing the deployed handler/package or provider behavior, so upstream-failure cookie deletion remains an explicitly unexecuted pinned-provider dependency claim.

   Traps precede input and temporary/secret setup. Recursive cleanup validates the six-character child name, creates a private sibling locator, and uses a 30-second retained-anchor supervisor. Site deletion stays disabled until exact input and pinned-CLI preflight succeed. No generated secret enters diagnostics or argv; verified cleanup removes the guarded `.netlify`, packages/browser, process artifacts, secrets, logs, results, wrappers, and copies, without claiming to remove a pre-existing npm cache.

   The POSIX supervisor creates a retained detached Node group leader and directly spawns the requested binary. Before TERM and KILL, its live handle plus two-second `ps` must still prove that PID leads that PGID; lost proof sends no group signal and retains evidence. Evidence precedes child/public control publication, and readiness requires authenticated socket proof. One memoized terminal promise owns TERM→KILL, reaping, disappearance, server/stream close, artifact transition, and final yield. Handlers remain installed: first HUP/INT/TERM (129/130/143) overrides timeout 124 and containment 125; natural child HUP/INT/TERM/KILL is 129/130/143/137. Overflow and unsafe launch use 126/127; unproved cleanup without a signal uses 125. The pinned CLI is invoked directly.

   Shell never signals record-loaded IDs; token-authenticated `probe`, `stop`, or test `interrupt` must match live publication. Sixteen exact-source test groups cover statuses 23/124/129/130/137/143/126/127/125; pre-publication and natural signals; timeout, server-close, artifact, final-yield, and forced-manual signals; TERM→KILL, output bound, descendants, publication/evidence failures, stale control, bounded delete with sibling failure evidence, and successful artifact removal.

   All mandatory work has the stated deadline. Uninterruptible work, lost anchor ownership, failed reaping/disappearance, server close, or artifact removal writes `manual-remediation` and the exact safe site/root/evidence/record/socket/supervisor/PGID diagnostic. Fallback is 125 unless HUP/INT/TERM already latched. Evidence-write failure still prints those identifiers and forces retention. Recursive deletion uses a mode-600 sibling artifact, retained as `delete-failed` on nonzero status, so partial removal cannot erase its site/root/process locator. Process, site, or tree failure keeps release verification open and never claims cleanup.

5. On the normal P2-A branch, run the repository-wide non-regression and privacy gates after restoring the production-shaped site output:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   trap 'exit 129' HUP
   trap 'exit 130' INT
   trap 'exit 143' TERM
   unset CONTEXT
   templates/build --site >/dev/null
   templates/check-dist
   npm --prefix templates/docbuild run check
   git diff --exit-code -- '*/dist/*.html'
   scripts/scrub-check.sh docs/tickets/P2-A.md netlify/edge-functions/gate.ts netlify/functions/login.mjs netlify/functions/logout.mjs login/index.html
   trap - HUP INT TERM
   BASH
   ```

   Expected: all commands exit `0`; `templates/check-dist` ends with `PASS  every committed document is byte-identical after a rebuild`, typecheck and `git diff` print no diagnostics, and scrub-check ends with `PASS  no denied term and no warning.`

6. Confirm exclusive source ownership and no verification residue:

   ```bash
   bash <<'BASH'
   set -euo pipefail
   export P2A_BOUNDARY_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
   export P2A_BOUNDARY_ROOT="$(mktemp -d "$P2A_BOUNDARY_PARENT/p2-a-boundary.XXXXXX")"
   cleanup_boundary() {
     if [[ -z "${P2A_BOUNDARY_ROOT:-}" ]]; then return 0; fi
     local parent="${P2A_BOUNDARY_ROOT%/*}" name="${P2A_BOUNDARY_ROOT##*/}"
     if [[ "$parent" != "$P2A_BOUNDARY_PARENT" || "$P2A_BOUNDARY_ROOT" == "$P2A_BOUNDARY_PARENT" \
       || "$name" != p2-a-boundary.?????? ]]; then
       echo 'refusing to remove unexpected boundary-test path' >&2
       return 1
     fi
     rm -f -- "$P2A_BOUNDARY_ROOT/changed-unsorted.txt" "$P2A_BOUNDARY_ROOT/changed.txt"
     rmdir -- "$P2A_BOUNDARY_ROOT"
     P2A_BOUNDARY_ROOT=''
   }
   trap cleanup_boundary EXIT
   trap 'exit 129' HUP
   trap 'exit 130' INT
   trap 'exit 143' TERM
   {
     git diff --no-renames --name-only HEAD --
     git ls-files --others --exclude-standard
   } >"$P2A_BOUNDARY_ROOT/changed-unsorted.txt"
   LC_ALL=C sort -u "$P2A_BOUNDARY_ROOT/changed-unsorted.txt" >"$P2A_BOUNDARY_ROOT/changed.txt"
   node --input-type=module - "$P2A_BOUNDARY_ROOT/changed.txt" <<'NODE'
   import assert from "node:assert/strict";
   import { readFileSync } from "node:fs";

   const changed = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
   const owned = [
     "login/index.html",
     "netlify/edge-functions/gate.ts",
     "netlify/functions/login.mjs",
     "netlify/functions/logout.mjs",
   ].sort();
   const implementation = changed.filter((path) => path !== "docs/tickets/P2-A.md").sort();
   assert.deepEqual(
     implementation,
     owned,
     `implementation boundary violation; changed paths outside P2-A ownership or missing owned paths: ${implementation.join(", ")}`,
   );
   console.log("PASS  implementation diff is exactly P2-A's four owned source paths");
   NODE
   cleanup_boundary
   trap - EXIT HUP INT TERM
   unset P2A_BOUNDARY_ROOT P2A_BOUNDARY_PARENT
   test ! -e package-lock.json
   test ! -e node_modules
   test ! -e .netlify
   P2A_REPOSITORY_RESIDUE="$(find . -maxdepth 1 -name 'p2-a-*' -print -quit)"
   test -z "$P2A_REPOSITORY_RESIDUE"
   unset P2A_REPOSITORY_RESIDUE
   BASH
   ```

   Expected: the Node check prints exactly `PASS  implementation diff is exactly P2-A's four owned source paths` and every `test` exits `0`. The check reads tracked, staged, and untracked paths, ignores only this ticket body, and mechanically rejects any implementation change outside the four owned paths, any other changed ticket/document, or any missing owned path. Cleanup accepts only a direct child of the resolved temporary parent whose basename has the exact prefix and six generated characters, including under EXIT, HUP, INT, and TERM. `_site/`, compiler output, runtime links, packages, credentials, cookies, and response artifacts do not appear.

## Failure modes

### Handled

- No, expired, invalid, or provider-degraded session: P1-C returns `null`; the gate redirects to login without serving HTML.
- A hypothetical future `identify()` throw propagated by P2-H: catch it only at the gate call boundary and return the exact non-disclosing 503 without redirecting or serving HTML.
- Anonymous URL has a query: preserve it inside one encoded `next` value; never preserve a host or fragment.
- Legacy P1-C member or final P2-H `isOrg: true`: pass through without synthesizing a response.
- Legacy P1-C guest or final P2-H `isOrg: false`: return 403 for every gated document, including one named in temporary `appMetadata.docs`.
- Contradictory `{ isOrg: false, roles: ["member"] }`: honor explicit false and return 403; never consult the legacy role after a boolean is present.
- Malformed non-null identity with neither a boolean `isOrg` nor a `member` in an array `roles`: return 403 without throwing or serving HTML.
- Login-page, API, or asset request: P1-E's exact exclusions bypass the gate and prevent redirect loops.
- Unknown future top-level route: it is gated by default because no new exclusion is added.
- Exact `/invite/` or a descendant, any method: bypass identity and continue downstream; before P4-K it is a public 404, and after P4-K the intended static route can resolve. Bare `/invite`, case/percent variants, and near-prefixes remain gated.
- Exact `/api/accept`: P1-E's existing API exclusion sends it downstream for every method; before P4-K it is 404, while P4-K later owns exact POST handling and non-POST rejection without a gate change.
- External, scheme-relative, parser-normalized or once-decoded network-path, literal/encoded-backslash, pre-trim control-character, malformed-percent, once-decoded login-loop, API, asset, or implementation `next`: fall back to `/`; differently cased near paths and ordinary percent-encoded paths remain valid exactly as specified.
- Unsupported auth-endpoint method: return 405, advertise POST, and perform no origin, form, or Identity work.
- Missing, null, foreign, downgraded-scheme, or wrong-port Origin on a mutation: return P1-C's normalized 403 before reading credentials or changing cookies.
- Malformed form body: return the generic 400 without invoking Identity.
- Missing, empty, duplicate, or multipart-File credentials and Identity rejection: return the same generic login error redirect without calling Identity for an invalid credential shape; reveal no account/provider detail.
- Successful server-side login: use a real 302 so the runtime-set cookies participate in the next full request.
- Same-origin logout with no session or an upstream logout failure: redirect to `/login/`; the pinned runtime contract owns cookie cleanup. Hosted checks induce authenticated and no-session deletion; the source seam proves rejected control flow, while upstream-failure deletion remains an honestly labeled provider dependency claim rather than live evidence.
- Cross-origin logout: reject before `logout()` so the existing session remains intact.
- Verification interruption or assertion failure after completed operator authorization: traps request bounded shutdown only through the authenticated live supervisor, continue through user and site cleanup after an individual ordinary timeout, and remove only the validated temporary tree after process and site cleanup are proven. An interruption before the deletion-capable authorization point performs no provider mutation or site deletion.
- Standalone Test 2 launch error/exit/bad handshake/timeout: finite startup contains and reaps its retained anchor. Later timeout or descendant hang uses current PID-to-PGID proof before TERM/KILL and retains sibling evidence/root if containment or bounded deletion fails. Only authenticated P2-H claim/reserve enables inherited-group mode; that outside owner removes both paths after release or proved group KILL, never false-acks, and the first terminal signal remains authoritative over a distinct second cleanup signal.
- Hosted launch, listen, running-record publication, server-close, or artifact-removal failure: the independent atomic mode-600 evidence artifact already names the disposable site, guarded root, record/socket paths, and owned supervisor PID/launcher PGID. An unproved group becomes `manual-remediation`; if evidence persistence itself fails, the exact safe diagnostic carries those identifiers after the shell exits. Fallback 125 applies only when no HUP/INT/TERM is already latched; a latched signal keeps 129/130/143 while the manual evidence still forces retention.
- Hosted package install, browser install/flow, CLI link/deploy, local-runtime startup, HTTP, or fixture-user creation timeout: print the specified static error, exit nonzero, and execute guarded user/site/tree cleanup. A late provider-side user creation is normally covered by deletion of the complete disposable site. If process termination/reaping or site deletion cannot be proven within its terminal bound, retain the tree, pinned CLI, and control evidence and require manual remediation; never print the cleanup PASS line.

### Deliberately not handled

- Per-document grants for external readers. P3-J amends the gate after P2-G; P2-A intentionally denies them until then.
- Invitation acceptance behavior and source. P4-K owns it, but consumes P2-A's already-public invite/API seams and may not edit the gate or configuration.
- Password recovery, self-registration, OAuth callbacks, MFA, SSO, or a second provider.
- Automatic project creation, Identity enablement, invite-only selection, production invitations, project-visibility changes, or credential rotation.
- Authorization of API writes other than the origin boundary on P2-A's two auth mutations. Each later API authorizes itself.
- Refreshing an expired server session inside the gate. P1-C's `identify()` contract returns `null`; the user signs in again.
- A friendly 403 HTML page. The response is deliberately small, exact, and independent of any template/build path.
- Recovery from a package-resolution or provider regression in the Edge runtime. Current official Netlify contracts explicitly support `getUser()` in Edge Functions; if the hosted release gate fails, keep release verification open and report the blocker without revoking source-complete status. Do not create an unowned fallback Function or edit P1-E's config silently.
- Preserving temporary sites, test identities, logs, cookies, package installs, or generated `_site/` output after successful verified cleanup. The explicit exceptional supervisor/site-deletion path retains guarded evidence until the operator completes manual remediation.

## Settled decisions

- Netlify Identity in invite-only mode is the only identity system. Use exactly `@netlify/identity@2.0.0`; do not add OAuth, Auth0, the Identity widget, or direct GoTrue code.
- The edge gate, not Netlify project visibility, is the whole document read-control wall. Its declaration matches `/*` and excludes `/login/*`, `/api/*`, and `/_assets/*`; inside the gate, exact `/invite/` and descendants are the sole additional public pathname family and return `undefined` before identity so P4-K is reachable without a later gate amendment.
- The gate controls receipt of HTML. It does not authorize comments, edits, suggestions, access changes, or any other API write.
- All server authentication code uses modern Functions v2/Edge Fetch handlers. Do not use Lambda v1 exports or `clientContext`.
- P1-C is the one identity accessor and origin contract. The gate consumes `identify()`; authentication mutations consume `requireOrigin()`.
- A `null` identity is the helper's documented no-session/degraded-session result and redirects to login. A thrown identity error remains distinct: P2-H propagates it, and P2-A alone catches it at the gate boundary to return the exact closed 503.
- The temporary P2-A authority rule is organization member or deny. During the P1-C/P2-H transition, a boolean `isOrg` is authoritative and only a non-boolean or absent value uses the legacy `roles` fallback. P3-J later replaces this entire predicate with the state-store grant model and removes the fallback.
- Document authority remains one owner plus `editor`, `commenter`, and `viewer` records in Netlify Blobs. It never lives in Identity roles, the login form, or `doc.json`.
- Both deployment modes remain supported. This ticket's hosted gate and form do not alter the offline/self-contained artifact contract.
- Source completion is decided by tests 1, 2, 3, 5, and 6 plus the explicit semantic review of the four owned files for indirect cookie/identity/logging behavior. The credentialed disposable-site matrix is a mandatory pre-release integration gate, not a condition for implementing, merging, or closing the source work.
- The root login page is source owned by P2-A and copied by P1-E's optional static-tree seam. There is no second page generator or duplicate source.
- Runtime cookies are opaque. The library/runtime owns `nf_jwt` and `nf_refresh`; application code owns only redirects and authorization results.
- Every login/logout POST is same-origin protected. `SameSite=Lax` is not a replacement for login-CSRF protection.
- P1-E's public cache header on passed-through static documents and all of its Netlify declarations remain unchanged; P2-A's own decision/auth responses are no-store.
- The live dual-shape proof uses only a generated disposable wrapper around the integrated production identity helper. It recognizes server-created fixture accounts by authenticated reserved email, never accepts a requested role/shape from HTTP input, exposes no identity value, and cannot become a permanent source or production authorization seam.
- The state store remains strong-consistency Netlify Blobs with one blob per record; P2-A performs no state read or write.
- Realtime remains optional Ably and presence is never persisted; neither is involved in authentication.
- `data-aid`, `norm()`, and the shared block scanner remain untouched.

## Assumptions and open questions

### Assumptions

- **Transitional organization check:** P2-A uses exactly `typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member")`. This consumes P2-H's final fact without repeating its private email suffix, stays runnable on the P1-C base, makes explicit false authoritative, and fails closed for malformed shapes that satisfy neither branch. P3-J removes the fallback when it becomes the next owner of `gate.ts`.
- **Disposable shape seam:** provider authentication and cookie issuance are the live integration boundary; P1-C and P2-H separately own how production identities derive their fields. P2-A's temporary wrapper runs only after the real helper returns a user and exists solely to make both gate input shapes observable and deterministic on either integration base without importing private domain policy into this public ticket.
- **No inline Edge config:** P1-E already declares the gate in `netlify.toml`. An inline `config` export would merge with and take precedence over duplicate fields, weakening the one auditable declaration, so P2-A exports only its handler.
- **Redirect status:** Authentication and gate redirects use `302`, matching the ruling research and the pinned package's official server-side example. For a form POST, browsers perform the required full-page GET navigation.
- **Method errors:** Login/logout return 405 with `Allow: POST` before origin verification for non-POST methods. This makes the route contract complete while preserving the rule that `requireOrigin()` is the first operation for every actual mutation.
- **Malformed form:** An unparseable form returns `400 Invalid form`; valid form data with missing credentials follows the non-disclosing `error=1` path. The ruling plan did not assign these cases a status.
- **Credential normalization:** Exactly one string email is transformed with ECMAScript `trim().toLowerCase()` and no Unicode normalization; exactly one string password is passed byte-for-byte. Missing, duplicate, or File values are invalid. This matches P1-C's lower-case identity contract without silently merging fields or altering a password.
- **Safe destination:** `safeNext()` rejects controls before Unicode trimming, revalidates protocol, credentials, host, and origin after parsing, requires exactly one leading slash on both the parser-normalized and once-decoded path and on the final serialized destination, validates reserved paths case-sensitively, preserves ordinary serialized percent escapes, rejects normalized/encoded network paths and encoded reserved/backslash/control paths, and strips fragments. These restrictions close open redirects, loops, and implementation-route redirects without narrowing any destination the gate itself generates.
- **Invitation reachability:** The gate uses the precise case-sensitive `/invite/` pathname family rather than another `netlify.toml` edit because P2-A owns `gate.ts` while P1-E owns the settled declaration. P1-E already excludes the API family. P4-K therefore adds only its page and exact custom Function route and cannot accidentally broaden or reorder the document gate.
- **Error copy:** One generic error string covers invalid credentials and provider rejection so the page does not enumerate accounts or claim that every failure proves a password mismatch.
- **Logout rejection:** The handler absorbs a `logout()` rejection and redirects because `@netlify/identity@2.0.0` promises that server-side auth cookies are still cleared. The deterministic source seam proves the rejection branch; the hosted matrix proves normal runtime deletion but does not falsely claim it can induce an upstream failure without changing the deployed boundary.
- **Edge support is resolved externally:** Current Netlify docs and the pinned package README explicitly say `getUser()` and server-side Identity functions work in Edge Functions. The old research question remains a required pre-release live smoke test because npm-package support in the Edge runtime is beta, but it does not block source completion or justify designing a second gate path in advance.

### Open questions

None block implementation.
If the live Edge smoke test contradicts the current official contract, report the exact provider/CLI versions and failure before changing scope. The ruling plan's old Function fallback would require a new owned source path and a P1-E configuration amendment, so it needs an explicit coordination decision rather than an unreviewed P2-A edit.

## References

- `HANDOFF.md`, “Non-negotiable: this repository becomes public” and “Decisions that are already made” — invented fixtures, scrub-first verification, and settled state/authority/realtime/anchoring boundaries.
- `README.md`, “Checks” and “The platform” — self-contained artifact behavior, builder checks, and ruling-plan authority.
- `docs/research/00-integration-plan.md` §1.2 — Functions v2 Identity model, single identity helper, CSRF rule, exact gate declaration/exclusions, temporary identity roles, and no browser widget.
- `docs/research/00-integration-plan.md` §1.3–§1.5 — permanent document routes, two deployment modes, and the later state-store authority model this ticket must not implement early.
- `docs/research/00-integration-plan.md` §2.9 and §4.3–§4.4 — P1-C session shape, P1-E prepared configuration, P2-A file surface, dependency order, verification, and the original Edge-import smoke test.
- `docs/research/00-integration-plan.md` §4.7 P3-J and §6 rulings 2, 9, 10, 11, 12, and 15 — downstream gate amendment, clean URLs, v2 Identity, role split, session hint boundary, shared document ID, and gate-backed Personal plan.
- `docs/research/02-auth.md` §§2, 3.1, 5, and 7 — server-side form flow, `safeNext`, generic login failure, runtime cookies, logout cleanup, login-CSRF threat, and the historical Edge smoke question. Its `/docs/*`, direct gate `getUser()`, guest metadata authorization, and partial package/config examples are superseded by the ruling plan and finalized dependency tickets.
- `docs/research/09-sharing-and-roles.md` §9.1–§9.2 — the gate is the only wall before the complete document and all API authorization remains independent; P3-J later supplies document-grant reads.
- `docs/tickets/P1-C.md` — exact `identify(req)`, `requireOrigin(req)`, root package, Functions v2, normalized errors, cookie secrecy, and downstream-consumer boundaries.
- `docs/tickets/P1-E.md` — exact `netlify.toml` declaration, fail-closed CI assertion, static `login/` copy seam, `_site` ownership, and deferred provider verification that P2-A closes.
- `docs/tickets/P2-H.md` — final four-field identity shape, authoritative `isOrg` boolean, removal of `roles`, P2-A compatibility predicate, and source-disjoint integration order.
- [Netlify: Use Identity in functions](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/) — current official `getUser()` Edge/Function support, server-side login/logout, runtime handling of `nf_jwt` and `nf_refresh`, and mandatory origin verification.
- [Netlify: `@netlify/identity@2.0.0` API reference](https://www.npmjs.com/package/@netlify/identity/v/2.0.0) — pinned signatures, v2/Edge prerequisite, `login()`/`logout()` behavior, cookie lifecycle, full-navigation requirement, and CSRF threat model.
- [Netlify: Edge Functions API](https://docs.netlify.com/build/edge-functions/api/) — Fetch handler/response contract and `undefined` pass-through behavior.
- [Netlify: Edge Function declarations](https://docs.netlify.com/build/edge-functions/declarations/) — `path`/`excludedPath`, config merge precedence, declaration order, and response termination of the request chain.
- [Netlify: Functions configuration](https://docs.netlify.com/build/functions/configuration/) — `config.path`, custom-route exclusivity, method matching, and v2 routing behavior.
- [Netlify: Registration and login](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/registration-login/) — invite-only registration and server-auth CSRF requirement.
