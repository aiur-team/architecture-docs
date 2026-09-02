# Authentication and authorisation

**Area:** who may read, comment, and edit a document.
**Verified:** 2026-09-01. Every claim below was checked against a live page on that date. Links are given at the end.
**Written when the builder was Python. Converted to Rust on 2 September 2026.** Every command, module
name and code block below is now the Rust one. Where this document and `00-integration-plan.md`
disagree, the plan is correct.

**Verdict:** use **Netlify Identity** with **invite-only registration**, one **Edge Function** gate, and an email-domain allowlist. Do not build OAuth. Do not add a hosted identity vendor.

---

## 1. Current state of Netlify's own options

This area moved twice in 2026. Read this section before you trust any older blog post.

### Netlify Identity is not deprecated

Netlify announced the deprecation of Identity when it launched the Auth0 extension. **Netlify reversed that decision on 19 February 2026.** The reversal is stated on Netlify's own blog post and repeated in the support forum.

The current position:

- Identity stays. It is a supported authentication option.
- No migration is required.
- Identity can be enabled on new projects.
- Identity costs nothing extra on all credit-based plans and on Enterprise.
- Identity gives **unlimited active users** and **unlimited invite-only users** on all plans.

**Git Gateway is deprecated, and that was not reversed.** Git Gateway is bug-frozen. It receives only major security fixes. Do not use it. It is a separate product from Identity. Many stale posts confuse the two.

### "Netlify Auth" does not exist as a separate product

There is no product called Netlify Auth that supersedes Identity. The thing that people call by that name is Netlify Identity. What Netlify added is an **Auth0 extension**, which wires an external Auth0 tenant to a Netlify project. It is an option, not a replacement.

### The client library changed

The old packages are still on npm. Do not use them.

| Package | Status on 2026-09-01 | What it was |
|---|---|---|
| `@netlify/identity` | **Use this.** Latest `2.0.0`, published 2026-08-18 | Headless async functions. Browser and server. No UI. |
| `netlify-identity-widget` | Not recommended for new projects | A pre-built login modal with UI |
| `gotrue-js` | Not recommended for new projects | Low-level GoTrue HTTP client, browser only |

`@netlify/identity@2.0.0` has one dependency, `gotrue-js@^1.0.1`. It requires Node `>=22.12.0`. Its server functions require **v2 Netlify Functions** (`export default`). Lambda-compatible v1 functions (`export { handler }`) are **not supported**.

### Password protection and project visibility

Netlify replaced Password Protection with **Project visibility** on credit-based Free, Personal, and Pro plans. Password Protection remains in the UI on Enterprise, Open Source, and legacy plans.

Project visibility has three states:

| State | Effect | Plans |
|---|---|---|
| Public | Anyone with the URL can read | Free, Personal, Pro |
| Password | A single shared password | Free, Personal, Pro |
| Private | Netlify login. Team and invited people only | Free, Personal, Pro |

The important limit: **on Free and Personal, a private project is visible to the Team Owner only.** You must be on Pro ($20/month) to add other people. Pro then allows unlimited members, scoped either to one project or to the whole team.

New projects on credit-based accounts are private by default since 28 July 2026.

### Role-based access control with redirect rules

Netlify can gate a path prefix at the CDN edge with no code. You add a `Role=` condition to a redirect rule. Netlify reads the role from the `nf_jwt` cookie.

```
/docs/*  /docs/:splat  200!  Role=member
/docs/*  /login/       401!
```

**The plan requirement is unclear and you must check it in the UI before you depend on it.** The Netlify RBAC documentation page states that Identity-sourced roles work on all plans and that external JWT providers need Enterprise. A Netlify support guide agrees that Identity RBAC works on all plans. Some third-party summaries say RBAC is Enterprise-only. I could not resolve this from public pages. The recommendation below does not depend on it, so the ambiguity does not block you.

---

## 2. The recommendation

Use these four parts.

1. **Netlify Identity**, with registration set to **invite only**.
2. **One Edge Function** on `/docs/*`. It calls `getUser()`. It redirects anonymous readers to `/login/`. It rejects readers who are neither in the org domain nor scoped to that document.
3. **Every `/api/*` Function calls `getUser()` again.** The edge gate is not an authorisation decision for writes. It only decides who sees HTML.
4. **A login page with no client JavaScript.** It is an HTML form. It posts to a Function. The Function calls `login()`.

Time to working: **half a day**, including the Netlify UI setup.

### Why this and not project visibility

Project visibility is faster. It is 10 minutes and no code. Use it today as a stopgap. It is not the destination for three reasons.

- Every reader needs a Netlify account and a team seat. Readers who join the team can also see deploy logs, environment variables, and project settings. That is far more than "read a document".
- It costs Pro to give access to a second person.
- It cannot share one document with one external person. Access is per project or per team, never per document.

### Why invite-only matters

Invite-only registration means the set of users is a list you control. Nobody self-registers. Offboarding is `admin.deleteUser`. The email-domain check in the gate is a second layer, not the only layer.

**Uncertain:** I did not find a page that states whether invite-only also blocks account creation through an external provider such as GitHub. Verify this before you enable external providers. The domain check in the gate covers you if invite-only does not.

### What I would not do in version 1

- **No GitHub login button.** Netlify Identity supports `oauthLogin('github')`, but the OAuth return path needs `handleAuthCallback()` running in the browser. That needs the npm package bundled into the login page, so it needs a JavaScript build step. Email and password through a Function needs none. Add GitHub later if people complain about passwords.
- **No self-signup.** No password reset UI in version 1 either. Use `requestPasswordRecovery` from a Function when someone asks.
- **No roles beyond two.** `member` and `guest`. Add more when a third case actually appears.

---

## 3. The three questions, answered

### 3.1 How a Function knows who the caller is, and that the claim is trustworthy

Call `getUser()` from `@netlify/identity`. That is the whole answer.

```js
// netlify/functions/session.mjs
import { getUser } from '@netlify/identity'

const ORG_DOMAIN = '@example.com'

export default async () => {
  const user = await getUser()
  if (!user) return new Response(null, { status: 401 })

  const email = (user.email ?? '').toLowerCase()
  const member = email.endsWith(ORG_DOMAIN)

  return Response.json(
    {
      email,
      name: user.name ?? email.split('@')[0],
      canComment: member,
      canEdit: member,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export const config = { path: '/api/session' }
```

**Why the claim is trustworthy.** Netlify Identity issues a JWT and the runtime stores it in the `nf_jwt` cookie. The browser sends that cookie automatically. `getUser()` reads it inside the Netlify runtime and returns a normalised user. It never throws. It returns `null` when there is no valid session. The signature check happens inside the runtime, not in your code.

**One documented degradation.** When the Identity API is unreachable, `getUser()` falls back to the verified JWT claims. In that state only these fields are populated: `id`, `email`, `provider`, `name`, `pictureUrl`, `roles`, `userMetadata`, `appMetadata`. Every field this design reads is in that list. Authorisation therefore still works when Identity is degraded. Do not write an authorisation check against `confirmedAt` or `lastSignInAt`.

**What is never trustworthy.** The request body. Any header the client sets. Any `email` or `author` field in JSON. A comment's author is `user.email` from `getUser()`, never a field the page sent.

**CSRF.** `nf_jwt` is a cookie, so any endpoint that changes state is exposed to cross-site POSTs. Call `verifyRequestOrigin(req)` at the top of every mutating handler. It compares the request `Origin` against the request's own origin and throws `AuthError` with status 403 on mismatch, and also when `Origin` is absent.

This is the pattern for every write endpoint. Hand it to the comments and editing work.

```js
// The shape every mutating /api/* endpoint copies.
import { getUser, verifyRequestOrigin } from '@netlify/identity'

const ORG_DOMAIN = '@example.com'

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  try {
    verifyRequestOrigin(req)
  } catch {
    return new Response('Bad origin', { status: 403 })
  }

  const user = await getUser()
  if (!user) return new Response(null, { status: 401 })

  const email = (user.email ?? '').toLowerCase()
  if (!email.endsWith(ORG_DOMAIN)) return new Response(null, { status: 403 })

  const body = await req.json()
  // Use `email` as the author. Ignore any author field in `body`.
  // ... write to Netlify Blobs or Netlify DB here ...
  return new Response(null, { status: 204 })
}
```

### 3.2 How the page knows whether to render editing controls

The document must render from disk with no network. So the page ships with every interactive control **hidden by default**, and one small probe reveals them.

Add this to `templates/base/app.js`. It matches the existing IIFE style. **The builder does not change.** No new placeholder, no new dependency, no new build step.

```js
/* Session probe. Reveals interactive controls when a Function confirms a
   session. Silent everywhere else: from disk, in an artifact, or logged
   out, the fetch fails and the document stays a plain document. */
(function () {
  var root = document.documentElement;
  if (location.protocol === 'file:') return;

  var abort = new AbortController();
  var timer = setTimeout(function () { abort.abort(); }, 2000);

  fetch('/api/session', {
    credentials: 'same-origin',
    signal: abort.signal,
    headers: { 'Accept': 'application/json' }
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (!s) return;
      root.dataset.session = s.canEdit ? 'editor' : 'reader';
      root.dataset.user = s.email;
      document.dispatchEvent(new CustomEvent('session', { detail: s }));
    })
    .catch(function () { /* disk, artifact, offline, or logged out */ })
    .finally(function () { clearTimeout(timer); });
})();
```

The CSS rule that goes with it, in `templates/base/components.css`:

```css
/* Interactive affordances are absent until a session says otherwise.
   `display:none` is the default so a printed or offline copy is clean. */
[data-editor-only] { display: none; }
:root[data-session="editor"] [data-editor-only] { display: revert; }

[data-reader-only] { display: none; }
:root[data-session="editor"] [data-reader-only],
:root[data-session="reader"] [data-reader-only] { display: revert; }
```

Markup then reads:

```html
<button type="button" data-editor-only class="btn-edit">Edit this section</button>
<div data-reader-only class="comments" id="comments-architecture"></div>
```

Three properties this gives you.

- **From disk it degrades correctly.** The `file:` check returns early. Nothing renders. Nothing errors in the console.
- **In a Claude artifact it degrades correctly.** The artifact CSP allows no external hosts, and `/api/session` does not exist on that origin. The request fails and `.catch` swallows it.
- **It is not a security control.** `data-session` is a rendering hint. A reader can set it in devtools and see an edit button. The button then calls a Function, and the Function calls `getUser()` and returns 403. The client hint and the server check are independent.

Other feature areas should listen for the `session` event rather than poll:

```js
document.addEventListener('session', function (e) {
  loadComments(e.detail.email, e.detail.canComment);
});
```

### 3.3 How one document is shared read-only with one external person

**Recommended: an invited guest with a document scope.** One identity system, one code path, real revocation, and an audit trail of who logged in.

Mint the guest from a Function that only an org member may call.

```js
// netlify/functions/invite-guest.mjs
import { admin, getUser, verifyRequestOrigin } from '@netlify/identity'

const ORG_DOMAIN = '@example.com'

export default async (req) => {
  try {
    verifyRequestOrigin(req)
  } catch {
    return new Response('Bad origin', { status: 403 })
  }

  const caller = await getUser()
  if (!caller) return new Response(null, { status: 401 })
  if (!(caller.email ?? '').toLowerCase().endsWith(ORG_DOMAIN)) {
    return new Response(null, { status: 403 })
  }

  const { email, doc, password } = await req.json()
  if (!email || !doc || !password) return new Response('Missing field', { status: 400 })

  const guest = await admin.createUser({
    email,
    password,
    data: {
      role: 'guest',
      app_metadata: { docs: [doc], invited_by: caller.email },
      user_metadata: { full_name: email },
    },
  })

  return Response.json({ id: guest.id, email: guest.email, docs: [doc] })
}

export const config = { path: '/api/invite-guest' }
```

Notes on the admin API, taken from the `@netlify/identity@2.0.0` README:

- `admin.*` runs only in Functions and Edge Functions. It uses the operator token that the Netlify runtime supplies. It throws `AuthError` if you call it from a browser.
- `admin.createUser` auto-confirms the user, so no confirmation email is sent.
- `data` forwards only `role`, `app_metadata`, and `user_metadata`. Other keys are silently dropped.
- To widen or narrow a guest later: `admin.updateUser(id, { app_metadata: { docs: ['a', 'b'] } })`.
- To revoke: `admin.deleteUser(id)`.

**Ambiguity to be aware of.** The `User` type has both `role?: string` and `roles?: string[]`. `admin.createUser` and `admin.updateUser` write `role` (singular). The RBAC documentation says Identity stores roles at `app_metadata.roles`. Read defensively:

```js
const roles = user.roles ?? (user.role ? [user.role] : [])
```

**The gate that enforces it.**

```ts
// netlify/edge-functions/gate.ts
import { getUser } from '@netlify/identity'
import type { Config } from '@netlify/edge-functions'

const ORG_DOMAIN = '@example.com'

export default async (req: Request) => {
  const url = new URL(req.url)
  const user = await getUser()

  if (!user) {
    const next = encodeURIComponent(url.pathname + url.search)
    return new Response(null, {
      status: 302,
      headers: { Location: `/login/?next=${next}` },
    })
  }

  const email = (user.email ?? '').toLowerCase()

  // Everyone in the org reads everything.
  if (email.endsWith(ORG_DOMAIN)) return

  // A guest reads only the documents named in app_metadata.docs.
  const roles = user.roles ?? (user.role ? [user.role] : [])
  const scope = (user.appMetadata?.docs as string[] | undefined) ?? []
  const docId = url.pathname.split('/')[2] ?? ''

  if (roles.includes('guest') && scope.includes(docId)) return

  return new Response('You do not have access to this document.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  })
}

export const config: Config = {
  path: '/docs/*',
  excludedPath: ['/docs/*.css', '/docs/*.js', '/docs/*.woff2', '/docs/*.svg'],
}
```

Returning `undefined` passes the request through to the static file. `excludedPath` keeps the gate off assets, which matters for cost, not for security, because the documents are single self-contained files with no assets today.

**Fallback: a signed share link, no account.** Use this only when the external person will not create a password. It is weaker. A link is bearer credential. Anyone it is forwarded to gets in.

Both halves use Web Crypto, so the same code runs in Node 22 Functions and in Deno Edge Functions. **No library.** Not `jose`, not `jsonwebtoken`.

```js
// netlify/lib/share.mjs
const enc = new TextEncoder()

const b64u = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const unb64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

const keyFor = (secret, use) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [use])

export async function mintShare(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)))
  const key = await keyFor(secret, 'sign')
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  return `${body}.${b64u(mac)}`
}

export async function readShare(token, secret) {
  const [body, sig] = String(token).split('.')
  if (!body || !sig) return null
  const key = await keyFor(secret, 'verify')
  // subtle.verify is constant time. Never compare signatures with ===.
  const ok = await crypto.subtle.verify('HMAC', key, unb64u(sig), enc.encode(body))
  if (!ok) return null
  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64u(body)))
  } catch {
    return null
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}
```

Mint with `{ doc: 'example', email: 'reviewer@partner.com', exp }` and a 14-day expiry. Put `SHARE_SECRET` in Netlify environment variables. Add this branch to the gate, before the redirect to `/login/`:

```ts
const token = url.searchParams.get('share') ?? getCookie(req, 'nf_share')
if (token) {
  const claim = await readShare(token, Netlify.env.get('SHARE_SECRET'))
  if (claim && claim.doc === url.pathname.split('/')[2]) {
    const res = await context.next()
    res.headers.append(
      'Set-Cookie',
      `nf_share=${token}; Path=/docs/${claim.doc}/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`,
    )
    return res
  }
}
```

Its three real weaknesses, stated plainly:

- **Forwarding.** The link is the credential. Expiry is the only limit.
- **Revocation.** There is none, unless you add a deny list. Keep revoked token ids in a Netlify Blobs store and check it in the gate, or rotate `SHARE_SECRET` and invalidate every outstanding link.
- **No identity.** A comment from a share link has an asserted email, not a proven one. Make share links **read-only**. Set `canComment: false` for them in `/api/session`.

---

## 4. Alternatives, weighed on time and burden

| Option | Time to working | Ongoing burden | Verdict |
|---|---|---|---|
| Project visibility = Private | 10 min | None | **Use as a day-1 stopgap.** Needs Pro for a second reader. Cannot scope one document. |
| Password protection, shared password | 10 min | Rotate the password | **Reject.** No identity, so no comment attribution and no edit history author. |
| RBAC redirect rules with `Role=` | 30 min | None | **Optional later.** Zero code. Plan tier is ambiguous. Cannot express one person and one document. |
| **Netlify Identity + Edge Function gate** | **Half a day** | **Invite and delete users** | **Recommended.** |
| GitHub OAuth in a Function | ~1 day, then forever | You own sessions, CSRF, secrets, token refresh | Reject unless GitHub org membership must be the source of truth. |
| Auth0 via the Netlify extension | ~2 hours | Second vendor, second bill, second user list | Reject at this size. |

### GitHub OAuth, in detail, and why not

The concrete shape works. `/api/auth/start` redirects to `https://github.com/login/oauth/authorize` with a `state` nonce. `/api/auth/callback` exchanges the code, then calls `GET /orgs/{org}/memberships/{username}` with the user token to prove membership, then sets your own signed session cookie.

Its one real advantage is genuine: **GitHub org membership is already the source of truth for who works here.** Nobody maintains a second user list. Offboarding happens for free when IT removes the GitHub account.

Its costs are also genuine, and they are permanent. You own the session cookie format, its expiry, its rotation, the `state` nonce store, the client secret, and every CSRF check. That is roughly 150 lines of security-relevant code that nobody on a documentation project will ever review again. External reviewers have no org membership, so you still need the share-link path. You would build both.

If the automatic-offboarding argument wins, the cheaper form is **Netlify Identity with GitHub as an external provider**, not hand-rolled OAuth. You get GitHub sign-in and Netlify owns the session. The cost is the browser-side `handleAuthCallback()` and therefore a JavaScript build step on the login page. That is the trade, and it is worth revisiting in version 2.

### Hosted identity, in detail, and why not

Auth0 through the Netlify extension is the blessed path. The extension sets the environment variables and creates the Auth0-to-Netlify connection from the Netlify UI.

Two reasons to reject it here. First, using Auth0 JWTs with Netlify's role-based redirect rules requires an **Enterprise** plan, per Netlify's RBAC documentation, and Identity and an external provider cannot both be active on one project. Second, what Auth0 adds over Identity is MFA, enterprise SSO, and twenty-plus social providers. This is an internal documentation tool with tens of readers. None of that is needed.

Third-party sources report an Auth0 free tier of 25,000 monthly active users in 2026, up from 7,500. **I did not confirm that figure on an Auth0 page.** Treat it as unverified.

Revisit Auth0 only if the organisation mandates SSO or MFA on internal tools. That is a policy trigger, not an engineering one.

---

## 5. What to build, file by file

```
netlify.toml
package.json                      # new. Node deps for Functions only.
netlify/edge-functions/gate.ts
netlify/functions/session.mjs
netlify/functions/login.mjs
netlify/functions/logout.mjs
netlify/functions/invite-guest.mjs
netlify/lib/share.mjs             # only if you build share links
login/index.html                  # a form. No JavaScript.
templates/base/app.js             # + ~20 lines, the session probe
templates/base/components.css     # + the [data-session] rules
```

### `package.json`

```json
{
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "dependencies": {
    "@netlify/identity": "2.0.0"
  }
}
```

Pinned exactly. `2.0.0` was published 2026-08-18 and checked 2026-09-01.

**This adds a `package.json` to a repository that has none.** Be clear about what it does and does not cost. The authoring path does not change. A writer still runs `templates/build my-doc` and needs no Node and no npm. Node exists only in the Netlify build, which installs dependencies automatically when a `package.json` is present. The builder stays dependency-free. This is the minimum price of having a server at all, and there is no way to call Netlify Identity without it.

### `netlify.toml`

```toml
[build]
  publish = "public"
  command = "templates/build --site"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[edge_functions]]
  path = "/docs/*"
  excludedPath = ["/docs/*.css", "/docs/*.js", "/docs/*.woff2", "/docs/*.svg"]
  function = "gate"
```

### The path contract

The gate matches on path, so the deploy layout is part of the auth design. Fix it now.

```
/docs/<instance>/            ->  <instance>/dist/<instance>.html
/login/                      ->  login/index.html      (never gated)
/api/*                       ->  netlify/functions/*   (each gates itself)
```

The `--site` mode of `docbuild` is a few dozen lines. It runs the single-document build for each
instance and copies the output. `templates/build --site` compiles the builder first if the binary is
missing, then runs it, so the Netlify build command needs no separate compile step. Section 7 records
what the build image must supply.

```rust
// templates/docbuild/src/main.rs, the --site mode.
// It calls build(), the same function `docbuild <instance>` calls, so the two
// outputs cannot drift apart.

/// Build every document and lay it out for Netlify.
fn site(root: &Path) -> Result<(), String> {
    let pub_dir = root.join("public");
    if pub_dir.exists() {
        fs::remove_dir_all(&pub_dir).map_err(|e| format!("{}: {e}", pub_dir.display()))?;
    }
    let docs = pub_dir.join("docs");
    fs::create_dir_all(&docs).map_err(|e| format!("{}: {e}", docs.display()))?;
    copy_tree(&root.join("login"), &pub_dir.join("login"))?;

    let mut instances: Vec<PathBuf> = fs::read_dir(root)
        .map_err(|e| format!("{}: {e}", root.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("doc.json").is_file())
        .collect();
    instances.sort();

    for inst in &instances {
        let name = inst.file_name().unwrap_or_default().to_string_lossy().to_string();
        let built = build(root, &name)?;
        let out = docs.join(&name);
        fs::create_dir_all(&out).map_err(|e| format!("{}: {e}", out.display()))?;
        fs::copy(&built, out.join("index.html"))
            .map_err(|e| format!("{}: {e}", out.display()))?;
        println!("published /docs/{name}/");
    }
    Ok(())
}

/// Copy one directory tree. `std::fs` has no recursive copy, so this is by hand.
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("{}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("{}: {e}", from.display()))? {
        let entry = entry.map_err(|e| format!("{}: {e}", from.display()))?;
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if src.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("{}: {e}", src.display()))?;
        }
    }
    Ok(())
}
```

`/login/` must stay outside `/docs/*`, or the gate redirects the login page to itself.

### `login/index.html`

No JavaScript. No npm. A form.

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 22rem; margin: 12vh auto; padding: 0 1rem; }
  label { display: block; margin: 0.9rem 0 0.2rem; font-weight: 600; }
  input { width: 100%; padding: 0.5rem; font: inherit; box-sizing: border-box; }
  button { margin-top: 1.2rem; padding: 0.5rem 1rem; font: inherit; }
  .err { color: #b00; }
</style>
<h1>Sign in</h1>
<p class="err" hidden id="e">That email and password did not match.</p>
<form method="post" action="/api/login">
  <input type="hidden" name="next" value="/">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>
```

The `next` value and the error banner need three lines of inline script to read the query string, or a small Function that serves this page. Three lines of inline script is the smaller change. This page is never opened from disk, so it may use JavaScript freely.

### `netlify/functions/login.mjs`

```js
import { login, verifyRequestOrigin } from '@netlify/identity'

// Only same-site paths. Blocks `//evil.com` and `https://evil.com`.
const safeNext = (v) => {
  const s = String(v ?? '/')
  return s.startsWith('/') && !s.startsWith('//') ? s : '/'
}

export default async (req) => {
  try {
    verifyRequestOrigin(req)
  } catch {
    return new Response('Bad origin', { status: 403 })
  }

  const form = await req.formData()
  const next = safeNext(form.get('next'))

  try {
    await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''))
  } catch {
    const back = `/login/?next=${encodeURIComponent(next)}&error=1`
    return new Response(null, { status: 302, headers: { Location: back } })
  }

  return new Response(null, { status: 302, headers: { Location: next } })
}

export const config = { path: '/api/login' }
```

Server-side `login()` calls the Identity API and sets `nf_jwt` through the Netlify runtime. The 302 is a full navigation, so the browser sends the new cookie on the next request. That is required. A soft client-side navigation may not carry the cookie.

`netlify/functions/logout.mjs` is the same shape with `logout()` and a redirect to `/login/`. Auth cookies are cleared even when the server call fails.

### Netlify UI setup, in order

1. Project configuration, then **Identity**, then **Enable Identity**.
2. Identity, **Registration**, set to **Invite only**.
3. Identity, **Invite users**, add each org email.
4. Site environment variables, add `SHARE_SECRET` if you build share links. Generate it with `openssl rand -base64 32`.
5. Leave **Project visibility** at **Private** until the gate is verified in production. Then set it to **Public**, because the gate is now doing the work.

Test locally with `netlify dev`. The Identity endpoint is not available otherwise, and `getUser()` will return `null` for every request.

---

## 6. Cost and limits

Netlify moved to credit-based plans. Checked 2026-09-01.

| Plan | Price | Credits per month |
|---|---|---|
| Free | $0 | 300 |
| Personal | $9 | 1,000 |
| Pro | $20 | 3,000 |
| Enterprise | Custom | Unlimited |

Published credit rates: a production deploy costs 15, compute costs 10 per GB-hour, bandwidth costs 20 per GB, and web requests cost 2 per 10,000.

**Identity itself is free on every credit-based plan, with unlimited active users and unlimited invite-only users.** These need Pro or higher: custom email templates, a custom outgoing email address, and the Identity audit log. On Free, invite and confirmation emails come from `no-reply@netlify.com`. For tens of internal readers, that is a cosmetic problem, not a functional one.

**This design fits the Free plan.** Tens of readers reading a 50 KB document, with an edge function per page view, is far below 300 credits. Assume Pro at $20/month anyway. You will want the audit log, and Pro is where the rest of the platform stops arguing with you.

### Where this breaks

- **Free-plan private visibility is Team-Owner-only.** Do not use project visibility as the org gate on Free. The Edge Function gate is what does the work.
- **The edge gate runs on every matching request.** Exclude assets with `excludedPath`. At this size, cost is not the issue. A slow gate on every page view is.
- **`@netlify/identity` server calls need v2 Functions.** A v1 `export { handler }` function silently has no session. Do not mix styles.
- **Identity has no MFA and no SSO.** If the organisation later mandates either on internal tools, this design is replaced, not extended. That is the trigger to revisit Auth0.
- **Share links do not revoke.** Add a Netlify Blobs deny list before you issue more than a handful.
- **Password reset has no UI in version 1.** Someone must run `requestPasswordRecovery` from a Function or the Netlify UI. Budget for building this in version 2.

---

## 7. Open questions I could not resolve

State these to whoever implements, and verify each in the Netlify UI on the actual account.

1. **Does Identity RBAC with `Role=` redirect rules work on non-Enterprise plans?** Netlify's RBAC page and its support guide say yes for Identity-sourced roles. Some third-party summaries say Enterprise only. The recommendation does not depend on it.
2. **Does invite-only registration also block account creation through an external provider such as GitHub?** No page stated this. The domain check in the gate covers the gap.
3. **Does `import { getUser } from '@netlify/identity'` resolve inside a Deno Edge Function?** The package README shows an explicit "Protect an Edge Function" example, so it should. **Smoke-test this first with `netlify dev`.** If it fails, move the gate into a v2 Function with `export const config = { path: '/docs/*' }` that reads the built HTML and returns it, and accept the extra complexity.
4. **`role` or `roles`?** The write API takes `role` (a string). The docs describe storage at `app_metadata.roles`. Read both, as shown above.
5. **The Auth0 free-tier MAU figure.** Third-party sources say 25,000. Not confirmed on an Auth0 page.
6. **The Rust in section 5 has not been compiled.** It is a translation of the Python this document
   first proposed, written against the structs `main.rs` defines. Compile it before you trust it.
7. **The build image installs no default Rust toolchain.** `rustup` and `cargo` are preinstalled, but
   Netlify installs no toolchain until you ask for one, so a `rust-toolchain` file in the base
   directory is required. Document 01 section 2 carries the citation and the fallback.

---

## 8. Sources, all checked 2026-09-01

- [Netlify Identity is staying (Feb 2026 reversal)](https://answers.netlify.com/t/netlify-identity-is-staying-feb-2026-reversal-what-changed-whos-affected-and-how-to-proceed/162733)
- [Netlify + Auth0: Platform extensibility and Identity changes](https://www.netlify.com/blog/auth0-extension-identity-changes/)
- [Authenticate users with Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/)
- [Add Identity to your project](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/)
- [Use Identity in functions](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/)
- [Identity plans and pricing](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/plans-and-pricing/)
- [Role-based access control with JWT](https://docs.netlify.com/manage/security/secure-access-to-sites/role-based-access-control/)
- [Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Password Protection overview](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/)
- [Secure access to sites overview](https://docs.netlify.com/manage/security/secure-access-to-sites/overview/)
- [Support guide: access control options](https://answers.netlify.com/t/support-guide-access-control-options-for-your-netlify-sites/31289)
- [Keep projects private by default (changelog, 2026-07-28)](https://www.netlify.com/changelog/2026-07-28-start-with-private-project-urls/)
- [Netlify pricing](https://www.netlify.com/pricing/)
- [Edge Functions declarations](https://docs.netlify.com/build/edge-functions/declarations/)
- [Functions get started](https://docs.netlify.com/build/functions/get-started/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Auth0 integration setup guide](https://docs.netlify.com/extend/install-and-use/setup-guides/auth0/)
- `@netlify/identity` version and README read from the npm registry and `unpkg.com/@netlify/identity@2.0.0/README.md`
