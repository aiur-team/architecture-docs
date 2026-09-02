# Sharing and roles

**Area:** who owns a document, who they may invite, what each invited person may do, and where each
check is made.

**Written:** 2026-09-02. It extends section 1.2 of `00-integration-plan.md`. It does not replace it.

**Reads as binding:** `00-integration-plan.md` sections 1.1, 1.2, 1.3, 1.4, 2.1 and 2.9. Where this
document and the plan disagree, the plan is correct until the plan is edited. Section 12 names the exact
edits the plan needs.

**Verified:** every external claim in this document was checked on 2026-09-02 against a live page, or it
is marked as inherited from `02-auth.md` (checked 2026-09-01), or it is in section 11, "Unverified".
Sources are in section 13.

Language: ASD-STE100 Simplified Technical English. "Must" is a requirement. "Do not" is a prohibition.

**A note on scope.** A separate document, `08-suggestions-and-editing-model.md`, owns the difference
between a suggestion and a direct edit. This document owns the capability rows only. It states who may
suggest and who may accept. It does not state how a suggestion is stored, shown or applied.

---

## 1. The recommendation

**One document has one owner. The owner invites a person by email into one of three roles: editor,
commenter or viewer. A grant is one blob, keyed by the document and by the person's Identity `sub`. The
grant store is the only authority on a document role. Identity answers "who is this person". It does not
answer "what may this person do here".**

Six parts:

1. **Four document roles**: `owner`, `editor`, `commenter`, `viewer`. Section 2.
2. **One grant record for each person on each document**, in the `doc-state` store under a new `access/`
   prefix. Section 4.
3. **The first owner comes from one site environment variable, `DOC_OWNERS`.** A person who can set a
   Netlify environment variable already controls the site. No client value and no committed file can name
   an owner. Section 6.
4. **An invitation is an identity-bound claim, never a bearer token.** The claim is keyed by the hash of
   the invited email address. Only a proven Identity session with that email address can convert it.
   Section 5.
5. **The share panel is created by JavaScript** in `templates/base/share.js`, after the one
   `session` event of section 1.2. It writes no markup into `layout.html`. With no backend there is no
   event, so there is no button. It degrades to absent. Section 7.
6. **Sharing is opt-in for each document.** A document with no entry in `DOC_OWNERS` behaves exactly as
   section 1.2 describes today: an org member reads and comments, and nobody else has access. This makes
   the whole feature additive. Section 6.4.

**This reopens ruling #10 of the plan** ("no `editor` role"). Say that plainly. The plan rejected a
second role because "a second list means a second list to maintain", and because a pull request is the
review gate. The product owner has now asked for that second list, per document, with an owner who
controls it. The requirement wins, and section 12 names the ruling to rewrite. Section 2.5 shows that
the reopening costs less than it looks: **`commenter` is exactly the org member of section 1.2**, so no
current behaviour changes.

Time to working: about two days after phase 2 of the plan is complete. Section 10 has the tickets.

---

## 2. The role model

### 2.1 The four roles

| Role | One line |
|---|---|
| `owner` | Exactly one person for each document. Controls access. Cannot be removed, only transferred |
| `editor` | Changes the text directly, and accepts a suggestion from another person |
| `commenter` | Comments, and suggests a change. Never changes the text directly |
| `viewer` | Reads. Nothing else |

**There is exactly one owner.** The requirement says "supports an owner role and has only the owner".
Do not build co-owners. A second owner needs a rule for the case in which two owners revoke each other,
and that rule has no correct answer. Ownership transfer covers the real need. Section 6.5.

### 2.2 Role against capability

| Capability | `owner` | `editor` | `commenter` | `viewer` |
|---|---|---|---|---|
| Read the document | Yes | Yes | Yes | Yes |
| Read comment threads | Yes | Yes | Yes | Yes |
| Comment, and reply | Yes | Yes | Yes | No |
| Resolve a thread | Any thread | Any thread | Own threads only | No |
| Reopen a thread | Any thread | Any thread | Own threads only | No |
| Suggest a change | Yes | Yes | Yes | No |
| Edit the text directly | Yes | Yes | No | No |
| Accept a suggestion | Yes | Yes | No | No |
| Invite a person | Yes | No | No | No |
| See who else has access | Yes | Yes | No | No |
| Change a person's role | Yes | No | No | No |
| Revoke a person | Yes | No | No | No |
| Change the org default | Yes | No | No | No |
| Transfer ownership | Yes | No | No | No |

**Rules that the table does not show.**

- **"Own threads only" is checked on `sub`**, never on the email address. Section 2.1 of the plan gives
  the reason: an email address changes on a rename, and a `sub` does not.
- **An editor may accept a suggestion, but an editor is not the only gate.** In Mode B an accepted
  suggestion becomes a pull request, and GitHub still applies its own review rules. In Mode A there is no
  second gate. Section 6.3 states the consequence.
- **A viewer must not see the share control at all.** Not disabled. Absent. Section 7.3.
- **A commenter must not see the list of people with access.** The list is a list of email addresses.
  An external commenter must not learn who else was invited to review.
- **There is no per-section role and no per-thread role.** The unit of access is one document.

### 2.3 The two cases that are not a grant

| Case | Role it resolves to | Where the default is stored |
|---|---|---|
| An org member (email ends with `@example.com`) with no grant | `commenter` by default. The owner may set `viewer` or `none` | `access/<docId>/doc.json`, field `orgDefault` |
| Anybody else with no grant and no invitation | No access. HTTP 403 | Not stored. It is the absence of a record |

An explicit grant always wins over `orgDefault`. So an owner may raise one org member to `editor`, or
lower one org member to `viewer`, without touching the default for everybody else.

`orgDefault` exists for one reason: an org of 40 people and 10 documents would otherwise need 400 grant
records, written by hand. Do not remove it.

### 2.4 What a role does not control

- **A role does not control who may deploy.** That is the Netlify account.
- **A role does not control who may commit.** That is GitHub.
- **A role does not control who may read `dist/*.html` in the repository.** Section 9.3.

### 2.5 Why this does not change any current behaviour

Section 1.2 of the plan gives an org member `canComment: true` and `canEdit: true`, and it states that
"an edit becomes a pull request, so the review gate is the pull request, not a role". So section 1.2's
`canEdit` is the capability that this document calls **suggest a change**, and section 1.2 has no
capability at all for **edit the text directly**.

Read the table again with that in mind:

> `commenter` = read + comment + suggest = the org member of section 1.2, exactly.

The default for an org member is `commenter`. **Nothing that works today stops working.** `editor` is a
new capability above the current ceiling, and `viewer` is a new capability below the current floor. This
is the test that this design had to pass.

One consequence for the API: the single `canEdit` flag of section 2.9 now carries two meanings, and it
must be split into `canSuggest` and `canEdit`. Section 3.4 gives the new shape.

### 2.6 Rejected alternatives, with reasons

| Rejected | Reason |
|---|---|
| Netlify Identity roles (`app_metadata.roles`) as the document role | Verified 2026-09-02: "Role changes take effect on the user's next login or token refresh." A revoke that waits for the next login is not a revoke. The list is also global for each person, not per document |
| `appMetadata.docs` as the per-document access list | It is one mutable array for each person, shared by every document, with no compare-and-swap. Two owners of two documents who grant the same person at the same moment lose one grant. Section 4.5 |
| Co-owners | No correct rule exists for two owners who revoke each other |
| A per-document role in `doc.json` | `doc.json` is committed. A role change would then need a commit, a review and a deploy at 15 credits. The plan rejects comments in git for the same reason |
| Five or more roles (an `approver`, a `reviewer`) | Nobody asked. Add one when a real case appears |
| A group or a team as the unit of a grant | It needs a group store, a group membership store and a cross-document query. Section 4.6, trigger 1 |

---

## 3. How this binds to section 1.2

### 3.1 Section 1.2 cannot express a per-document role, and here is exactly why

Section 1.2 gives one identity module with this contract:

```
roles: string[]      // ["member"] or ["guest"]
canComment: boolean
canEdit: boolean
docs: string[]       // guest scope, as docIds. Empty for a member.
```

Three properties of that contract block a per-document role:

1. **`roles` is a property of the person, not of the pair (person, document).** `identify(req)` takes a
   request and no document. It cannot return a per-document answer.
2. **`docs` is per document, but it is binary.** It says "may read this document". It cannot say "may
   edit this document and may only read that one".
3. **The store behind `docs` is Netlify Identity `app_metadata`.** Verified 2026-09-02: a role change
   there "takes effect on the user's next login or token refresh". A share panel that revokes a person
   must revoke them now, not at their next login.

### 3.2 The smallest change

**Split identity from authorisation. Do not add a second identity system.**

`identify()` keeps everything that answers *who*. It loses everything that answers *what may they do*.
That second question moves to one new module, `netlify/lib/access.mjs`.

```js
// netlify/lib/identity.mjs   — CHANGED. Three fields removed.
/**
 * @returns {Promise<null | {
 *   sub: string,        // unchanged
 *   email: string,      // unchanged, lower case
 *   name: string,       // unchanged
 *   isOrg: boolean      // NEW. email ends with the org domain. A fact, not a permission
 * }>}
 */
export async function identify(req) { /* getUser(), unchanged */ }

/** Unchanged. Still the first statement of every mutating handler. */
export function requireOrigin(req) { /* verifyRequestOrigin(req) */ }
```

```js
// netlify/lib/access.mjs   — NEW. The only place a role is decided.
/**
 * @param {string} docId  the permanent id of section 1.3. Never a slug
 * @param {{sub: string, email: string, isOrg: boolean} | null} user
 * @returns {Promise<{
 *   role: "owner" | "editor" | "commenter" | "viewer" | "none",
 *   shared: boolean,      // false when the document has no owner
 *   canComment: boolean,
 *   canSuggest: boolean,
 *   canEdit: boolean,
 *   canAccept: boolean,
 *   canShare: boolean,    // owner only
 *   canSeeMembers: boolean
 * }>}
 */
export async function resolveRole(docId, user) { /* section 4 */ }
```

Everything else in section 1.2 is unchanged and must stay unchanged:

- Netlify Identity, invite-only registration, `getUser()` from `@netlify/identity@2.0.0`.
- Functions v2 only. A v1 handler silently has no session.
- One Edge Function gate on `/*`, with the same three exclusions.
- `requireOrigin()` first in every mutating handler.
- One client probe, one `data-session` attribute, one `session` event. No module polls.
- No second identity vendor. No GitHub OAuth. No self-registration.
- The two identity roles `member` and `guest` stay as they are. They are now used for one thing only:
  `guest` marks an account that this platform created for an invited external person. **The four
  document roles are a different axis and they live in a different store.** Do not mix them.

### 3.3 The rule that must not be broken

**`identify()` returning a user is not authorisation.** After this change, the site has accounts for
external people who may read exactly one document. Any future code path that tests only "is there a
session" gives those accounts the whole site. Every handler must call `resolveRole()`, and the answer
must be checked, not logged.

### 3.4 The new `/api/session` response

`/api/session` becomes document-aware. It takes `?doc=<docId>`.

```json
{
  "sub": "u_931",
  "email": "owner@example.com",
  "name": "the owner W",
  "roles": ["member"],
  "doc": "k7m2q4",
  "role": "owner",
  "shared": true,
  "canComment": true,
  "canSuggest": true,
  "canEdit": true,
  "canAccept": true,
  "canShare": true,
  "canSeeMembers": true
}
```

Headers stay `Cache-Control: private, no-store`. A missing session stays 401 with no body.

**A client-supplied `doc` is safe here, and this is why.** The parameter selects a record. It asserts
nothing. The server still resolves the role for the proven `sub`. A caller can therefore learn their own
role on any docId they can name, which is their own capability and not a leak. A caller cannot learn
anybody else's role from this endpoint.

**`canEdit` changes meaning.** Today it means "may propose an edit". It now means "may change the text
directly". Section 1.2's client line must therefore become:

```js
document.documentElement.dataset.session = s.canSuggest ? "editor" : "reader";
```

Any handler that reads `canEdit` before this change lands must be re-read. There are two: the edit
function of P4-B and the reveal rule of P2-C.

**No new root attribute.** `share.js` reads `detail.role` from the `session` event. The share button is
created by JavaScript, so it needs no CSS reveal rule and no `data-role`.

---

## 4. Storage

### 4.1 The key layout

One new prefix in the one store. No new store.

```
store "doc-state"                        consistency: "strong", site-wide

  access/<docId>/doc.json                the document access record. One for each shared document.
                                         Mutable. CAS on write.
  access/<docId>/u/<sub>.json            one grant. Mutable. CAS on write.
  access/<docId>/i/<emailHash>.json      one invitation not yet converted. Mutable. CAS on write.
```

`<docId>` is the permanent `id` of section 1.3. It is never the slug and never the directory name.

`<emailHash>` is the first 32 hexadecimal characters of `SHA-256` of the lower-case, trimmed email
address. Web Crypto gives `crypto.subtle.digest` in both runtimes, so no library is needed.

**The reason for the hash is key hygiene, not secrecy.** An email address holds characters that are
awkward in a key, and its case is not stable. The record body holds the plain address, so anybody who
can read the store can read the address. Do not describe the hash as a protection.

### 4.2 The three record shapes

Every rule of section 2 of the plan applies: `v: 1`, ISO 8601 UTC timestamps with milliseconds, every
actor field set on the server, and a client-supplied actor field is an impersonation bug.

**The document access record.** `access/<docId>/doc.json`

```json
{
  "v": 1,
  "docId": "k7m2q4",
  "ownerSub": "u_931",
  "ownerEmail": "owner@example.com",
  "orgDefault": "commenter",
  "boundAt": "2026-09-02T09:14:02.881Z",
  "boundFrom": "env:DOC_OWNERS"
}
```

**The grant.** `access/<docId>/u/<sub>.json`

```json
{
  "v": 1,
  "docId": "k7m2q4",
  "sub": "u_412",
  "email": "reviewer@partner.com",
  "name": "Ada R",
  "role": "commenter",
  "grantedBy": { "sub": "u_931", "name": "the owner W", "email": "owner@example.com" },
  "grantedAt": "2026-09-02T09:20:41.002Z",
  "fromInvitation": "9f2c41ab7e0d5583c1b4a6ef2d087741"
}
```

`role` is `"editor" | "commenter" | "viewer"`. **`"owner"` is never a value in a grant.** The owner lives
in one field of one record. Section 6.5 explains why that removes a two-blob transaction.

**The invitation.** `access/<docId>/i/<emailHash>.json`

```json
{
  "v": 1,
  "docId": "k7m2q4",
  "email": "reviewer@partner.com",
  "role": "commenter",
  "invitedBy": { "sub": "u_931", "name": "the owner W", "email": "owner@example.com" },
  "invitedAt": "2026-09-02T09:18:11.400Z",
  "expiresAt": "2026-10-02T09:18:11.400Z",
  "accountCreated": true
}
```

An invitation expires after 30 days. An expired invitation is refused at conversion, and the retention
job of P4-F deletes it.

### 4.3 Every read this design needs, and its cost

| Question | Operation | Cost |
|---|---|---|
| What may this person do on this document | `get access/<docId>/doc.json`, `get access/<docId>/u/<sub>.json` | 2 parallel gets |
| Is there an invitation for my proven email | `get access/<docId>/i/<hash(email)>.json` | 1 get, only when the two above give no access |
| Who has access to this document | `list({prefix: "access/<docId>/u/"})` then N parallel gets | 1 list, N gets. N is the number of invited people |
| Which invitations are outstanding | `list({prefix: "access/<docId>/i/"})` then N parallel gets | 1 list, N gets |

Every one of these is scoped to one document. There is no query across documents and no per-user index.

### 4.4 Which of the six triggers this fires

Answer honestly, one at a time.

| # | The trigger from section 1.1 | Fires? |
|---|---|---|
| 1 | A query is no longer scoped to one document | **No, for this design.** Every read in section 4.3 has a `<docId>` in its key. **Yes, for two features that this document therefore refuses.** Section 4.6 |
| 2 | Somebody asks to search comment text | No. Not touched |
| 3 | One document passes about 200 threads | No. Not touched. A document with 200 people invited would be a different problem, and it will not happen |
| 4 | Sustained writes above one per second on one thread | No. An access change is a human act, a few per document per year |
| 5 | A change must span two documents atomically | **No, because of one design choice.** Ownership lives in one field of one record, so a transfer is one CAS write. Had `owner` been a grant value, a transfer would have been two writes with no transaction. Section 6.5 |
| 6 | Per-user state that is not per-document is needed | **No, and this is the closest call.** A role is per (document, person), which is per-document state that happens to be keyed by a person. A pending invitation is per (document, email), which is the same shape. Neither is a per-user index |

**So no trigger fires, and the honest reason is that two obvious features were cut to keep it that way.**
Section 4.6 names them. Do not add either one without moving to Postgres.

### 4.5 The near miss, stated in full

Section 1.1 rules out a per-user index, and it names read receipts, subscriptions and an unread count as
the casualties. A role looks like the same shape as those three, and it is not. The difference is the
direction of the key.

- A subscription is asked as "what does **this person** watch". The key must start with the person, and
  the answer spans documents. That is a per-user index.
- A role is asked as "what may this person do on **this document**". The key starts with the document,
  and the answer never leaves it. That is per-document state.

An invitation is the one record where the difference is thin, because it is keyed by an email address
that has no `sub` yet. It survives the rule for the same reason: `access/<docId>/i/<hash>` starts with
the document. The conversion read is a direct `get` on a key the server computes from the proven email
address. **It is never a scan for a matching email.** If you ever write that scan, the trigger has fired.

### 4.6 The two features this refuses, and why

1. **"Which documents am I shared into?"** A list of documents for one person is a query across
   documents. It is trigger 1 and it is also trigger 6. There is no dashboard, no inbox and no
   "shared with me" page. A person reaches a document by its URL.
2. **"Remove this person from everything."** Offboarding across documents is a write across documents.
   The answer is at the identity layer, not here: `admin.deleteUser(id)` deletes the account, and every
   gate then sees no session. The grant blobs are then dead records that the retention job may clean.
   Say this in the runbook.

---

## 5. The invitation flow

### 5.1 The ruling: an identity-bound claim, not a bearer token

**An invitation must be an identity-bound claim. A link must never be the credential.**

| | Bearer link (rejected) | Identity-bound claim (chosen) |
|---|---|---|
| What proves access | Holding the link | An Identity session whose proven email matches the invitation |
| Forwarded to another person | That person gets in. The link is the credential | Nothing happens. Their email does not match |
| Leaked in a Slack channel, a ticket, a browser history, a referrer header, a corporate proxy log | Every reader of that log gets in | Nothing. The link holds no secret |
| Revoke one person | Not possible without a deny list, or rotate the secret and break every outstanding link | Delete one blob |
| Attribution of a comment | An asserted email address, not a proven one. Section 2.1 of the plan needs a stable `sub`, and a bearer link has none | A real `sub` from a real session |
| Cost to the invitee | None | They must set a password once |

The only advantage of the bearer link is the last row, and the price of that row is every other row.
**Do not choose it for convenience.** `02-auth.md` section 3.3 offers a signed share link as a fallback,
and the plan carries it as P4-E. Section 12 retires it. A `commenter` or `editor` grant on a bearer link
is not possible at all, because a comment needs a proven author.

### 5.2 What the owner does

The owner types an email address in the share panel and picks a role. The panel sends one request:

```
POST /api/access   { "doc": "k7m2q4", "email": "reviewer@partner.com", "role": "commenter" }
```

The handler, in order:

1. `requireOrigin(req)`. First statement, no exception.
2. `identify(req)`. 401 when there is no session.
3. `resolveRole(doc, user)`. 403 when `canShare` is false.
4. Validate the email address, lower-case and trim it. Refuse a role that is not one of the three.
5. Refuse when the target is the owner. Refuse when the target email is the caller's own.
6. Count the records under `access/<doc>/i/` and `access/<doc>/u/`. Refuse above **50 people for each
   document** and above **10 new invitations per hour for each document**. This endpoint can create
   Identity accounts, so it must have a cap.
7. Write `access/<doc>/i/<hash>.json` through `mutate()`.
8. Look for an Identity account for that address. When there is one, stop. The invitation is complete.
9. When there is none, create one, then ask Identity to send its own email. Section 5.3.

**The order in step 7 to step 9 matters.** Write the invitation first. If account creation then fails, the
result is an invitation with no account, which is harmless and which resolves by itself if the person
ever gets an account. The reverse order would leave an account with no invitation, which is an account
that this platform created and that nothing tracks.

**There is no transaction across those writes, and there does not need to be.** Section 1.1 rules out a
transaction across two blobs. Every step here is idempotent on the same input.

### 5.3 What the invitee receives

**Case 1, and it is the common one: the invitee already has an Identity account.** Every org member does.
This platform sends nothing. The grant is live at once. The owner sends the document URL in Slack. This
is deliberate: the plan's section 5 rules out an email provider, a sending domain and DNS records, and
this case needs none of them.

**Case 2: the invitee has no account.** The platform must not build an email sender to solve this.
Netlify Identity already sends four emails, and one of them is enough. Verified 2026-09-02: Netlify
Identity sends an Invitation email, a Confirmation email, a Password Recovery email and an Email Change
email, and on Free and Personal the sender is `no-reply@netlify.com`. A custom sender and custom
templates need Pro.

Verified 2026-09-02 in the `@netlify/identity@2.0.0` README: the library exports
`admin.listUsers`, `admin.getUser`, `admin.createUser`, `admin.updateUser` and `admin.deleteUser`. **It
does not export `admin.inviteUser`.** `admin.createUser` auto-confirms the user and sends no email. The
library does export `requestPasswordRecovery(email)`, which "sends a password recovery email to the
given address", and `acceptInvite(token, password)`, which accepts an invite token, sets a password and
logs the user in.

So the flow for case 2 is:

1. `admin.createUser({ email, password: <32 random bytes, never stored>, data: { role: 'guest' } })`.
   The account exists and is confirmed. No email is sent.
2. `requestPasswordRecovery(email)`. Netlify sends its own email from `no-reply@netlify.com`.
3. The invitee follows the link. Verified 2026-09-02: the link goes to the project URL with a **hash
   fragment** token, for example `#recovery_token=...`.
4. A hash fragment never reaches the server. So `/invite/` is a page, next to `/login/`, that reads
   `location.hash` in about ten lines of plain JavaScript, asks for a password, and posts the token and
   the password to `/api/accept`. **No npm package in the browser. No build step.** `02-auth.md` states
   that the login page is never opened from disk and may use JavaScript freely. The same holds here.
5. `/api/accept` consumes the token on the server and signs the person in.

The exact server function that consumes a **recovery** token is in section 11, "Unverified", with two
fallbacks. `acceptInvite(token, password)` is confirmed for an **invite** token.

**Do not put the document role in the email.** The email is Netlify's, its template is not ours on
Personal, and the role is already in the invitation record.

### 5.4 What happens when the invitee opens the document link

The URL is the plain document URL. It carries no token and no secret.

| State of the caller | What happens |
|---|---|
| No session | The gate redirects to `/login/?next=<path>`. Section 1.2, unchanged |
| Signed in, org member | The gate lets the HTML through on the domain check alone. No blob read |
| Signed in, not an org member, a grant exists | The gate reads the grant and lets the HTML through |
| Signed in, not an org member, an invitation exists for the proven email | The gate lets the HTML through. `/api/session` then converts the invitation to a grant. Section 5.5 |
| Signed in, not an org member, no grant and no invitation | **403.** The body says: "This document was not shared with `<the signed-in address>`." It offers a sign-out link |
| Signed in with a different address than the invited one | The same 403 as the row above |

**The 403 must never name the invited address.** Naming it turns the page into an oracle: anybody with
any account could ask "was `sam@rival.com` invited to this document?" and read the answer. Name the
address the caller is signed in as, which they already know, and nothing else.

### 5.5 Conversion, and where it happens

Conversion turns `i/<emailHash>.json` into `u/<sub>.json`. It happens in `/api/session`, which is a
Function. It must not happen in the edge gate.

Two reasons. The gate runs on every page view, and a write on a read path is a bad trade. And the gate
cannot use the admin API at all: verified 2026-09-02, the `admin` operations "use a short-lived admin
token and can only run in Netlify Functions (not in the browser or Edge Functions)".

So the gate resolves read-only, and it accepts an invitation as proof of read access. `/api/session`,
which the page calls once anyway, does the write:

1. Write `u/<sub>.json` from the invitation, with `fromInvitation` set to the hash.
2. Delete `i/<emailHash>.json`.

The two writes are not atomic. If the delete fails, the next session read converts again with the same
role and the same result. **Conversion must be idempotent, and this order makes it so.** A failure in the
other order would drop the grant.

### 5.6 Changing a role, and revoking

| Act | Request | Effect |
|---|---|---|
| Change a role | `PATCH /api/access` with `{doc, sub, role}` | One CAS write on `u/<sub>.json` |
| Change a pending invitation | `PATCH /api/access` with `{doc, email, role}` | One CAS write on `i/<hash>.json` |
| Revoke a person | `DELETE /api/access` with `{doc, sub}` | Delete `u/<sub>.json` |
| Cancel an invitation | `DELETE /api/access` with `{doc, email}` | Delete `i/<hash>.json` |

**A revoke takes effect on the next request, not at the next login.** The gate reads the grant on every
guest page view, and every write handler reads it on every write. This is the property that Identity
roles could not give. Verified 2026-09-02: an Identity role change "takes effect on the user's next login
or token refresh".

**A revoke does not end the session.** The person keeps a valid `nf_jwt` cookie for the site. It buys
them nothing: the gate refuses the HTML on the next request, and every write refuses. To end the session
as well, delete the account: `admin.deleteUser(id)`.

**A revoke does not delete their comments.** Their comments stay, with their `sub` and their name, as the
audit record of a review. The plan has no comment delete. This is consistent with that.

---

## 6. Ownership

### 6.1 The ruling

**The first owner comes from one site environment variable, `DOC_OWNERS`. It is bound to a `sub` on the
first sign-in of the named person. After binding, only a transfer changes it.**

```
DOC_OWNERS = "k7m2q4:owner@example.com,a91f03:sam@example.com"
```

A `docId:email` pair, comma separated. One variable for the whole site.

**Why an environment variable and not a committed file.** Three tests decide this, and only the
environment variable passes all three.

| Test | `doc.json` (Mode B only) | The build manifest | A first-writer-wins claim | `DOC_OWNERS` |
|---|---|---|---|---|
| Works in Mode A, which has no repository and no build | No | No | Yes | **Yes** |
| Out of reach of the client | Yes | Yes | No | **Yes** |
| Cannot be seized by whoever opens the document first | Yes | Yes | **No** | **Yes** |

A first-writer-wins claim is a land-grab. The document is served on a public URL behind a gate, so the
first person to sign in and open it is not necessarily the author. Reject it.

`DOC_OWNERS` also needs no build change at all, which keeps this design out of `main.rs`, out
of `layout.html` and out of the edit manifest. It costs one edit in the Netlify user interface, or one
`netlify env:set`, for each document that is shared.

**The trigger to change it.** Above about 20 shared documents the single variable becomes hard to edit by
hand. At that point move it to a blob written by the connect tool, and keep the variable as the fallback.
Not before.

### 6.2 Binding, in both modes

Binding is one function in `netlify/lib/access.mjs`, and it is the same code in both modes:

1. `resolveRole(docId, user)` finds no `access/<docId>/doc.json`.
2. It reads `DOC_OWNERS`. When there is no entry for `docId`, the document is not shared. Section 6.4.
3. When there is an entry, and it matches `user.email`, write `doc.json` with `ownerSub: user.sub`,
   `orgDefault: "commenter"` and `boundFrom: "env:DOC_OWNERS"`, with `onlyIfNew: true`.
4. When there is an entry and it does not match, the caller is not the owner. They get `orgDefault` if
   they are an org member, and nothing otherwise.

After step 3 the record is the authority. **A later edit of `DOC_OWNERS` does not move ownership.** That
is deliberate: ownership then has one mechanism, the transfer of section 6.5, with one audit event.
To re-bind by hand, delete the record with the CLI:
`netlify blobs:delete doc-state access/<docId>/doc.json`. Deliberate friction on a rare, destructive act,
exactly as the plan treats comment delete.

### 6.3 Mode A, which is the hard case

Mode A has no repository, no CI and no pull request. Section 1.4 of the plan states the cost already:
"In Mode A the overlay *is* the document, and nobody reviews it."

**Ruling: the connect tool sets `DOC_OWNERS` when it creates the site.** Section 1.4 already gives the
tool the two things it needs. It signs the user in through the Netlify CLI, so it holds a session for the
Netlify account. And it creates or links the site, so it knows the site and the `docId`. Setting one
environment variable at that moment is one more CLI call.

This makes the authority chain in Mode A short and honest:

> Whoever can deploy the file decides who owns it.

That is the strongest claim available in a mode with no repository, and it is stronger than anything the
file itself could say. A value inside the HTML would be a client value, and section 2 of the plan
forbids trusting one.

**Three consequences of Mode A that the owner must be told, in the connect tool's own output.**

1. **An `editor` grant in Mode A changes the live document with no review.** In Mode B a change becomes a
   pull request. In Mode A the overlay is the document. Grant `editor` in Mode A only to a person you
   would give push access to.
2. **Export is the only path back to a reviewable artifact.** Section 1.4 says to build the export before
   the editing. That ordering applies twice as hard once other people can edit.
3. **A Netlify account with site access outranks the document owner.** They can change `DOC_OWNERS`,
   delete the store and redeploy the file. There is no way around this and no reason to pretend
   otherwise.

### 6.4 A document with no owner

**Sharing is opt-in for each document.** With no entry in `DOC_OWNERS` and no access record:

- `resolveRole()` returns `shared: false`.
- An org member gets `commenter`, which is exactly section 1.2's behaviour today.
- Anybody else gets no access, which is also section 1.2's behaviour today, because
  `appMetadata.docs` is retired and nothing else grants them anything.
- `canShare` is false for everybody, so **the share panel does not appear at all**.
- Every write path behaves as it does today.

This is the property that makes the feature additive. A document that nobody shares never sees any of
this code.

### 6.5 Transfer of ownership

Only the owner may transfer. The target must already hold a grant on the document, so a transfer is
never also an invitation.

```
POST /api/access/transfer   { "doc": "k7m2q4", "sub": "u_412" }
```

**The move itself is one CAS write.** The owner is one field of `access/<docId>/doc.json`, so `ownerSub`
and `ownerEmail` move together in one write. The two grants around it are separate blobs, and section 1.1
has no transaction across two blobs. So the order is fixed:

1. Write the target's grant to `role: "editor"` first, if it is not already `editor` or higher. This is
   safe in isolation: the target is a person the owner already trusted with a grant.
2. Then one CAS write on `doc.json` to move `ownerSub`.
3. Then write a grant for the old owner at `role: "editor"`.

A crash after step 2 leaves the old owner with no grant. They are an org member, so `orgDefault` catches
them at `commenter`. If they are not an org member, they lose access to a document they owned, and the
new owner must re-invite them. Say that in the confirmation dialog. **The alternative is worse:** moving
the ownership last would leave two writes that both say "owner" for a moment, and no rule for which one
wins.

Every one of these acts writes an event. Section 8.

---

## 7. The share panel

### 7.1 Where it sits in the existing markup

`templates/base/layout.html` puts three items in `.head-top`:

```html
<div class="head-top">
  <p class="eyebrow">{{EYEBROW}}</p>
  <span class="status-chip">{{STATUS}}</span>
  <button class="tt" id="tt" type="button" aria-label="Toggle colour theme">…</button>
</div>
```

`.head-top` is `display:flex` with `align-items:center` and `flex-wrap:wrap`, and `.status-chip` carries
`margin-left:auto`, so the chip and the theme toggle already sit at the right end of the row. **The share
button is appended to `.head-top`, after the theme toggle.** It is the last element in the row, so it is
the top right of the document. It matches `.tt`: a pill, mono, uppercase, `var(--border-strong)`.

**No markup is added to `layout.html`.** `share.js` creates the button and appends it. Two reasons:

- A button in the built HTML would be present in a printed copy, in a `file://` copy and inside a Claude
  artifact, where it can do nothing. The plan requires every feature to be hidden by default and revealed
  only by a successful probe. Absent is better than hidden.
- `layout.html` is owned by P1-B. Creating the button in JavaScript keeps this feature out of that file
  and needs only the two placeholder rows of section 12.

### 7.2 How it wakes up

It listens for the one `session` event of section 1.2. It does not call `/api/session` and it does not
poll.

```js
/* Share panel. Absent until a session says the reader may share or may see
   the member list. Never renders from disk. */
(function () {
  if (location.protocol === 'file:') return;

  document.addEventListener('session', function (e) {
    var s = e.detail;
    if (!s || !s.shared) return;                       // the document is not shared
    if (!s.canShare && !s.canSeeMembers) return;       // a commenter or a viewer sees nothing
    mountShareButton(s);                                // append to .head-top
  }, { once: true });
})();
```

The member list is fetched on the first click of `GET /api/access?doc=<docId>`, never on load. A document
that nobody opens the panel on costs one extra fetch: none.

### 7.3 What each role sees

| Role | The button | The member list | The invite row | The role menu, revoke, transfer |
|---|---|---|---|---|
| `owner` | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes, read only | **No** | No |
| `commenter` | **No** | No | No | No |
| `viewer` | **No** | No | No | No |
| No session, or a document that is not shared | No | No | No | No |

**A viewer must not see an invite control**, and it must not be a disabled control either. The button is
never created for them, so there is nothing in the DOM to enable.

**An editor sees the list and no controls.** Knowing who else is reviewing is useful to a person who may
change the text. A commenter and a viewer do not get the list, because it is a list of email addresses
and an external reviewer must not learn who else was invited.

### 7.4 How it degrades

| Context | What happens |
|---|---|
| `file://` | `session.js` returns early on the `file:` check, so no `session` event fires. `share.js` also returns early on its own check. Nothing renders. No console error |
| Inside a Claude artifact | `/api/session` does not exist on that origin. The fetch fails and is swallowed. No event, no button |
| Mode A before the site is connected | There is no backend, so `/api/session` 404s. `r.ok` is false, `session.js` dispatches nothing. No button |
| Signed out on a live site | The gate redirects to `/login/` before the page loads. The case cannot arise |
| A document with no owner | `shared: false`, so `mountShareButton` is never called |
| Print | `@media print { .share-btn, .share-pop { display: none } }` in `share.css`. The button is also not in the source, so a saved copy has none |

**The requirement is "absent, not broken", and the mechanism that gives it is that the button does not
exist in the HTML.** There is no state in which a share control is present and dead.

### 7.5 What the panel is not

- **Not a modal.** A popover under the button, `position: absolute`, closed on `Escape` and on an outside
  click. It must not trap focus and it must not block reading.
- **Not a live list.** It is fetched when the panel opens. No polling, per the plan's refresh rule.
- **Not a link generator.** There is no "copy a share link" button, because there is no share link.
  Section 5.1. It may hold a "copy the document URL" button, which copies a URL that grants nothing.
- **Not an autocompleting people picker.** That needs `admin.listUsers` on a keystroke. Type the whole
  address.

---

## 8. The audit trail

Add four kinds to the `kind` enum of section 2.4 of the plan:

| `kind` | Written when |
|---|---|
| `access.invite` | An invitation is written. `target: { email }`, plus the role in `summary` |
| `access.change` | A role changes, on a grant or on an invitation |
| `access.revoke` | A grant or an invitation is deleted |
| `access.transfer` | Ownership moves |

Every event is one append-only blob, written with `onlyIfNew: true`, exactly as section 1.1 requires.
`access.grant` is deliberately **not** in the list: a conversion is a mechanical consequence of an
invitation that is already in the log, and logging it would put one event on a read path.

**Do not put a plain email address in `summary` for an external person if the event log is ever exposed
to a reader.** Today it is read only by the changelog and the audit, which are org-only. Note it and move
on.

---

## 9. What a determined reader can still see

State this plainly, because a design that says "role" in a table can read as though it enforces one.

### 9.1 Where every check is actually made

| Check | Where it runs | Is it enforcement? |
|---|---|---|
| May this person read the HTML | `netlify/edge-functions/gate.ts`, on every request to `/*` | **Yes. It is the only wall in front of the document text** |
| May this person comment, resolve, suggest, edit, accept | `resolveRole()` inside each `/api/*` Function, after `requireOrigin()` and `identify()` | **Yes** |
| May this person invite, change a role, revoke, transfer | `resolveRole()` inside `/api/access`, `canShare` | **Yes** |
| Is the caller the author of this thread | The thread record's `author.sub` against the session `sub`, in the thread handler | **Yes** |
| Should the share button exist | `share.js`, from the `session` event | **No. A rendering hint** |
| Should the edit affordance be revealed | `data-session` on the root element and the CSS in `session.css` | **No. A rendering hint** |

The plan already says this about `data-session`, and it is worth repeating for the panel: a reader can
set the attribute in the developer tools, and they can call `mountShareButton` from the console. The
invite box then appears, the POST runs, `resolveRole()` returns `canShare: false`, and the function
returns 403. **The client hint and the server check are independent, and only the second one counts.**

### 9.2 The gate is the whole of read control

The document is one self-contained HTML file with the whole text inside it. There is no lazy loading and
no per-section fetch. So:

- **Anybody who gets past the gate has the whole document.** Roles do not divide the text. A `viewer`
  reads everything an `editor` reads, including every comment thread through `GET /api/threads`, which
  has no per-thread access control.
- **If the gate is misconfigured, the URL is the document.** Section 1.2 chooses Netlify Personal and
  sets project visibility to public, because the gate does the access control. That choice makes the gate
  load-bearing. A `netlify.toml` edit that drops the `[[edge_functions]]` block publishes every document
  to the internet with no error and no warning. Put an assertion in CI: the block must exist, its `path`
  must be `/*`, and `excludedPath` must be exactly the three paths.
- **The default for a new path must stay "gated".** Section 1.2 already rules this. A new top-level
  directory that somebody adds to `excludedPath` for convenience is the likely way this breaks.

### 9.3 What roles cannot cover at all

- **The repository.** In Mode B, `dist/*.html` is committed. Anybody with read access to the repository
  has every document, whatever their role says. **Do not invite an external person into a document whose
  text may not be in the repository they cannot see.** The role model is not a confidentiality boundary
  against a repository reader.
- **The baked history block.** Section 2.8 puts commit subjects, authors and diff patches inside the
  document. An external `viewer` therefore reads the repository's commit messages and the diffs for that
  document. That may be more than the owner intended to share. There is no per-role rendering of the
  document, so the only fix is to not share a document whose history is sensitive. Say this in the
  share panel, once, as a line of text.
- **A deploy preview URL.** The gate matches `/*`, so it covers a preview too. Confirm that in P1-E's
  verification, because a preview URL is the classic hole.
- **The Netlify account.** Anybody with site access can read the store, change `DOC_OWNERS` and redeploy.
  A document owner is not protected against the site owner. Section 6.3.
- **A person who was revoked five seconds ago.** They may have the page open. Nothing takes the text out
  of a browser that already has it. Revocation stops the next request, and it stops every write at once.

---

## 10. Tickets this implies

`P<phase>-<letter>`, continuing the plan's section 4. No two tickets in one phase own the same file.
Where a ticket amends a file that another ticket owns, it is sequenced after it and says so.

| Ticket | Work | Files it owns | Needs |
|---|---|---|---|
| **P2-F** | The access library. Parse `DOC_OWNERS`. `resolveRole()`, the capability map of section 2.2, the key builders, the email hash, owner binding, invitation conversion, the caps of section 5.2 step 6 | `netlify/lib/access.mjs` | P1-C, P2-B |
| **P2-G** | Split identity from authorisation. Remove `canComment`, `canEdit` and `docs` from `identify()`. Add `isOrg`. Amends `netlify/lib/identity.mjs`, which P1-C owns, so it lands after P1-C | `netlify/lib/identity.mjs` (after P1-C) | P1-C |
| **P3-F** | `GET /api/access`: the member list and the outstanding invitations, for `canSeeMembers` only. Amend `/api/session` to take `?doc=` and return the section 3.4 shape | `netlify/functions/access.mjs`, and `netlify/functions/session.mjs` (after P1-C) | P2-F, P2-G |
| **P3-G** | The share panel, read only. Create the button in `.head-top` from the `session` event. The popover, the member list, the `file:` guard, the print rule | `templates/base/share.js`, `templates/base/share.css` | P1-B, P2-C, P3-F |
| **P3-H** | The gate learns the grant store. For a non-org session, read the docId from `<meta name="doc-id">` in `context.next()`, then resolve read access from `access/`. Retire `appMetadata.docs`. Amends the gate, which P2-A owns | `netlify/edge-functions/gate.ts` (after P2-A) | P2-A, P2-F |
| **P4-H** | The access write path. `POST`, `PATCH` and `DELETE` on `/api/access`. `POST /api/access/transfer`. `admin.createUser` and `requestPasswordRecovery` for case 2. The four audit events | `netlify/functions/access.mjs` (after P3-F) | P3-F, P3-H, P2-A |
| **P4-I** | Invitation acceptance. `/invite/` as an HTML page with about ten lines of inline JavaScript that reads `location.hash`. `POST /api/accept` consumes the token on the server | `invite/index.html`, `netlify/functions/accept.mjs` | P4-H, P2-A |
| **P4-J** | The share panel write controls. The invite row, the role menu, revoke, cancel, transfer with its confirmation, the org default control | `templates/base/share.js` (after P3-G) | P3-G, P4-H |
| **P4-K** | Enforcement in the existing write paths. `threads.mjs` and `thread.mjs` call `resolveRole()` and check `canComment` and the resolve rule of section 2.2. `edit.mjs` checks `canSuggest` and `canEdit`. Amends files that P3-A and P4-B own | `netlify/functions/threads.mjs`, `netlify/functions/thread.mjs` (after P3-A), `netlify/functions/edit.mjs` (after P4-B) | P3-A, P4-B, P2-F |
| **P4-L** | The connect tool sets `DOC_OWNERS` for Mode A, and prints the three warnings of section 6.3. Amends the phase-4 connect-tool ticket that section 1.4 adds | the connect tool | P2-F, the connect tool ticket |

**Verify P2-F:** a unit test for each row of the table in section 2.2. `resolveRole()` on a document with
no owner returns `shared: false` and `commenter` for an org member. It never throws, and it returns
`role: "none"` for a null user.

**Verify P2-G:** every existing caller of `canComment` or `canEdit` on `identify()` is found and changed.
`grep -r 'identify(' netlify/` must show no reader of a removed field.

**Verify P3-F:** with `curl` against `netlify dev`: a `commenter` gets 403 from `GET /api/access`. An
`editor` gets the list. `/api/session?doc=<unknown>` returns `shared: false`, not 500.

**Verify P3-G:** as an `owner`, the button is in `.head-top` and it is the last child. As a `viewer`,
`document.querySelector('.share-btn')` is null. Open the file from `file://`: null, and no console error.
Serve the built file from a plain static server with no `/api`: null, and no console error. Print: no
button.

**Verify P3-H:** a signed-in non-org user with no grant gets 403 on the document. Grant them `viewer`
and reload: the page renders. Delete the grant and reload: 403 on the next request, with no sign-out.

**Verify P4-H:** an `editor` gets 403 from every write on this endpoint. An invitation for an address
with no account creates one account and sends one email. Fifty-one people on one document is refused.
A transfer moves `ownerSub`, and the old owner is then an `editor`.

**Verify P4-I:** the whole flow, once, with a real external address. Then revoke, and confirm 403.

**Verify P4-K:** a `viewer` who posts a comment with `data-session` set to `editor` in the developer
tools gets 403. A `commenter` who resolves another person's thread gets 403. A `commenter` who resolves
their own thread succeeds.

---

## 11. Unverified

Every item here must be checked before the ticket that depends on it is closed.

1. **Which server function consumes a Netlify Identity *recovery* token.** `acceptInvite(token, password)`
   is confirmed in the `@netlify/identity@2.0.0` README (checked 2026-09-02) for an **invite** token. The
   equivalent for the recovery token that `requestPasswordRecovery` sends is not confirmed. Two
   fallbacks, in order: use `admin.updateUser(id, { password })` from `/api/accept` after proving the
   token another way; or invite the person from the Netlify user interface, which sends a real Invitation
   email whose token `acceptInvite` does accept, and treat account creation as a manual step in v1.
   **P4-I must not close until one of the three is proven with `netlify dev`.**
2. **Whether `@netlify/blobs` in a Deno edge function honours a store-level `consistency: "strong"`.**
   Blobs is documented as supported in Edge Functions (checked 2026-09-02). The consistency question is
   the plan's own open question 2, and it now also applies to the gate. A stale read at the gate would
   let a revoked person read the HTML for up to about 60 seconds. Test it. If it is eventual, pass
   `{ consistency: 'strong' }` at `getStore()` in the gate.
3. **The latency that a blob read adds to the gate for a guest.** The org path returns before any blob
   read, so the cost lands on external readers only. Measure it in P3-H. If it is above about 100 ms,
   cache the resolved role in a short-lived signed cookie, and accept that a revoke then waits for the
   cookie to expire. Do not do this before it is measured.
4. **Whether reading the response body from `context.next()` in the gate has a measurable cost on the
   guest path.** `context.next()` returning a modifiable `Response` whose body may be read is documented
   (checked 2026-09-02). The cost of doing it on every guest page view is not measured.
5. **Whether `admin.createUser` on an address that already has an account throws or returns the existing
   user.** Section 5.2 step 8 looks first with `admin.listUsers` or `admin.getUser`, so the case should
   not arise. It will arise in a race. Handle both.
6. **Whether Netlify Identity invite-only registration blocks the account that `admin.createUser`
   creates.** This is the plan's open question 3, and this design now depends on it: an external person's
   account is created by the server, not by self-registration. `admin.createUser` is documented as
   auto-confirming, which suggests it is unaffected. Prove it.
7. **Whether an Identity account can exist with no password until the recovery flow sets one.** The
   design sets 32 random bytes and never stores them. If Identity rejects a create with no password, the
   random value is the workaround, and it already is.
8. **The Identity audit log needs Pro** (inherited from `02-auth.md`, checked 2026-09-01). This design
   writes its own events, so the Identity log is a convenience. Do not upgrade the plan for it.
9. **Whether `/d/<id>` survives a Mode A to Mode B move** is the plan's own open item in section 1.4. If
   the URL changes, every grant survives, because a grant is keyed by the docId. **This design is
   unaffected by that migration, and that is worth recording.**

---

## 12. What this changes in the plan

I do not edit `00-integration-plan.md`. These are the exact sections that must change.

| Section of the plan | The edit |
|---|---|
| **1.1, the key layout** | Add the three `access/` keys of section 4.1 to the key block. Add one line to "What this rules out": there is no cross-document access query, so there is no "shared with me" list and no cross-document revoke |
| **1.2, the heading and the decision line** | "Two roles" becomes "two identity roles, and four document roles held in the state store" |
| **1.2, the identity module** | `identify()` loses `canComment`, `canEdit` and `docs`, and gains `isOrg`. Point at `netlify/lib/access.mjs` for the rest |
| **1.2, the rules inside `identify()`** | Delete the two rules that set `canComment` and `canEdit` from the email domain, and the rule that reads `appMetadata.docs`. Keep the defensive role read and the "read only these fields" rule unchanged |
| **1.2, "Roles"** | Rewrite. The paragraph that says "There is no `editor` role" is now wrong. State that ruling #10 was reopened by the product requirement, and that `commenter` preserves the old behaviour exactly |
| **1.2, "The client contract"** | `s.canEdit` becomes `s.canSuggest` in the `data-session` line |
| **1.2, "What this rules out"** | Add: no bearer share link, no co-owner, no group as the unit of a grant |
| **1.4, Mode A** | Add one row to the setup cell: the connect tool sets `DOC_OWNERS` for the new document. Add the three Mode A warnings of section 6.3 |
| **2.4, the `kind` enum** | Add `access.invite`, `access.change`, `access.revoke`, `access.transfer` |
| **2.9, the session response** | Replace with the shape in section 3.4 of this document. Note that `canEdit` changes meaning and that `canSuggest` is new |
| **New 2.10** | The three record shapes of section 4.2: the document access record, the grant, the invitation |
| **4.1, the placeholder table** | Two new rows: `{{SHARE_JS}}` → `templates/base/share.js`, owner P3-G and P4-J; `{{SHARE_CSS}}` → `templates/base/share.css`, owner P3-G. No markup is added to `.head-top`, so P1-B gains two rows and nothing else |
| **4.3, P1-C** | Note that `identify()` and `/api/session` are amended later, by P2-G and P3-F |
| **4.4, P2-A** | Note that the gate is amended by P3-H, and that until P3-H lands a non-org session gets 403 on every document. That fails closed, so it is safe to ship in that order |
| **4.5, P3-A** | Note that P4-K adds the `resolveRole()` check |
| **4.6, P4-B** | Note that P4-K changes the check from `canEdit` to `canSuggest` and `canEdit` |
| **4.6, P4-E** | **Retire it.** `invite-guest.mjs` is replaced by `/api/access` in P4-H. `netlify/lib/share.mjs` is not built. Section 5.1 gives the reason |
| **5, "Identity"** | Delete the bullet "An `editor` role. Section 1.2". Add three: no bearer share link, no co-owner, no cross-document access query or "shared with me" list |
| **6, ruling #10** | Mark it as reopened on 2026-09-02 by the product requirement, and point at this document. Do not delete the original ruling; the reason it gave is still the reason `editor` is not the default |
| **6, "Added in review"** | Add a row: "Who may edit, and who decides? An owner for each document, and three grantable roles. Document 09" |
| **6, open questions** | Add items 1, 2, 5 and 6 of section 11 of this document |

---

## 13. Sources

**Checked 2026-09-02, by me, for this document.**

- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) — Blobs CRUD is
  supported from Functions, Edge Functions, Build Plugins and the CLI. An Edge Function example is given.
- [Edge Functions API](https://docs.netlify.com/build/edge-functions/api/) — `context.next()` returns a
  `Promise` of the origin `Response` and the body may be read; `Netlify.env.get(name)`; `context.cookies`.
- [Identity-generated emails](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/identity-generated-emails/)
  — four emails: Invitation, Confirmation, Password Recovery, Email Change. Sender on Free and Personal
  is `no-reply@netlify.com`. The link carries a hash-fragment token. A custom sender needs Pro.
- [Manage existing Identity users](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/manage-existing-users/)
  — roles are stored at `app_metadata.roles`; "Role changes take effect on the user's next login or token
  refresh"; roles are not user-editable.
- [Use Identity in functions](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/)
  — `admin` operations "use a short-lived admin token and can only run in Netlify Functions (not in the
  browser or Edge Functions)". Five Identity event handlers exist.
- `@netlify/identity@2.0.0` README, read from
  [unpkg](https://unpkg.com/@netlify/identity@2.0.0/README.md) — `admin.listUsers`, `admin.getUser`,
  `admin.createUser`, `admin.updateUser`, `admin.deleteUser`. **No `admin.inviteUser`.**
  `admin.createUser` auto-confirms and sends no email. `requestPasswordRecovery(email)` sends a recovery
  email. `acceptInvite(token, password)` accepts an invite token, sets a password and logs the user in.

**Inherited from `02-auth.md` section 8, checked 2026-09-01, not re-checked today.** The February 2026
Identity deprecation reversal, Identity plans and pricing, project visibility, the credit rates, the
`role` against `roles` ambiguity, `verifyRequestOrigin`, and the `getUser()` degraded-mode field list.

**Read in this repository, 2026-09-02.** `templates/base/layout.html`, `templates/base/app.js`,
`templates/base/components.css` lines 15 to 27, `templates/research/00-integration-plan.md`,
`templates/research/02-auth.md`.
