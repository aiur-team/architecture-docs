import { identify } from "../lib/identity.mjs";
import {
  accessDocumentKey, accessGrantKey, accessGrantPrefix, accessInvitationPrefix,
  assertAccessDocument, assertAccessGrant, assertAccessInvitationAtKey,
  assertIdentitySub, capabilitiesFor, resolveRole,
} from "../lib/access.mjs";
import { StoreError, docState, read } from "../lib/store.mjs";

const NO_STORE = { "Cache-Control": "private, no-store" };
const IDENTITY_KEYS = Object.freeze(["sub", "email", "name", "isOrg"]);
const ACCESS_KEYS = Object.freeze([
  "role", "shared", "canRead", "canComment", "threadControl", "canSuggest",
  "canEdit", "canAccept", "canShare", "canSeeMembers",
]);
const CAPABILITY_KEYS = Object.freeze(ACCESS_KEYS.slice(2));
const ROLES = Object.freeze(["owner", "editor", "commenter", "viewer", "none"]);
const THREAD_CONTROLS = Object.freeze(["any", "own", "none"]);
const DOC_ID_PATTERN = /^[0-9a-f]{6}$/;
const INVITATION_HASH_PATTERN = /^[0-9a-f]{32}$/;
const MAX_PAGES = 52;
const MAX_KEYS = 50;
const MAX_PAGE_ENTRIES = 1_000;
const MAX_KEY_BYTES = 600;

function ownDataDescriptor(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.enumerable !== true) {
    return null;
  }
  return descriptor;
}

function isExactPlainDataObject(value, keys, requireMutable) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || !keys.every((key, index) => names[index] === key)) {
    return false;
  }
  return keys.every((key) => {
    const descriptor = ownDataDescriptor(value, key);
    return descriptor !== null && (!requireMutable ||
      (descriptor.writable === true && descriptor.configurable === true));
  });
}

function validateIdentity(value) {
  if (!isExactPlainDataObject(value, IDENTITY_KEYS, true)) throw new TypeError("Invalid identity");
  const sub = ownDataDescriptor(value, "sub").value;
  const email = ownDataDescriptor(value, "email").value;
  const name = ownDataDescriptor(value, "name").value;
  const isOrg = ownDataDescriptor(value, "isOrg").value;
  if (typeof sub !== "string" || typeof email !== "string" ||
      typeof name !== "string" || typeof isOrg !== "boolean" ||
      isOrg !== email.endsWith("@example.com") || assertIdentitySub(sub) !== sub) {
    throw new TypeError("Invalid identity");
  }
  return value;
}

function validateAccess(value) {
  if (!isExactPlainDataObject(value, ACCESS_KEYS, false)) throw new TypeError("Invalid access result");
  const role = ownDataDescriptor(value, "role").value;
  const shared = ownDataDescriptor(value, "shared").value;
  const threadControl = ownDataDescriptor(value, "threadControl").value;
  if (!ROLES.includes(role) || typeof shared !== "boolean" ||
      !THREAD_CONTROLS.includes(threadControl)) throw new TypeError("Invalid access result");
  for (const key of CAPABILITY_KEYS) {
    const field = ownDataDescriptor(value, key).value;
    if (key === "threadControl" ? typeof field !== "string" : typeof field !== "boolean") {
      throw new TypeError("Invalid access result");
    }
  }
  const expected = capabilitiesFor(role);
  if (!isExactPlainDataObject(expected, CAPABILITY_KEYS, false)) {
    throw new TypeError("Invalid capability result");
  }
  for (const key of CAPABILITY_KEYS) {
    if (ownDataDescriptor(value, key).value !== ownDataDescriptor(expected, key).value) {
      throw new TypeError("Inconsistent access result");
    }
  }
  return value;
}

function isUnavailable(error) {
  try {
    if (!(error instanceof StoreError)) return false;
    const name = ownDataDescriptor(error, "name");
    const code = ownDataDescriptor(error, "code");
    const status = ownDataDescriptor(error, "status");
    return name !== null && code !== null && status !== null &&
      name.value === "StoreError" && code.value === "unavailable" && status.value === 503;
  } catch {
    return false;
  }
}

function emptyResponse(status, headers = NO_STORE) {
  return new Response(null, { status, headers });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0;
}

function dataDescriptorsOnly(value) {
  return isPlainObject(value) && Object.getOwnPropertyNames(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Object.prototype.hasOwnProperty.call(descriptor, "value");
  });
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || names.at(-1) !== "length") return false;
  for (let index = 0; index < value.length; index += 1) {
    if (names[index] !== String(index) || ownDataDescriptor(value, String(index)) === null) return false;
  }
  return true;
}

function utf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length &&
             value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function inheritedDataMethod(value, key) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  let cursor = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor !== undefined) {
      return Object.prototype.hasOwnProperty.call(descriptor, "value") &&
        typeof descriptor.value === "function" ? descriptor.value : null;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return null;
}

function iteratorResult(result) {
  if (!dataDescriptorsOnly(result)) throw new TypeError("Invalid iterator result");
  const done = ownDataDescriptor(result, "done");
  if (done === null || typeof done.value !== "boolean") {
    throw new TypeError("Invalid iterator result");
  }
  if (done.value) return { done: true, value: undefined };
  const value = ownDataDescriptor(result, "value");
  if (value === null) throw new TypeError("Invalid iterator result");
  return { done: false, value: value.value };
}

function pageKeys(page) {
  if (!dataDescriptorsOnly(page)) throw new TypeError("Invalid list page");
  const blobs = ownDataDescriptor(page, "blobs");
  const directories = ownDataDescriptor(page, "directories");
  if (blobs === null || directories === null || !isDenseArray(blobs.value) ||
      blobs.value.length > MAX_PAGE_ENTRIES || !isDenseArray(directories.value) ||
      directories.value.length !== 0) throw new TypeError("Invalid list page");
  return blobs.value.map((entry) => {
    if (!dataDescriptorsOnly(entry)) throw new TypeError("Invalid list entry");
    const key = ownDataDescriptor(entry, "key");
    if (key === null || key.writable !== true || key.configurable !== true ||
        typeof key.value !== "string" || utf8Length(key.value) > MAX_KEY_BYTES) {
      throw new TypeError("Invalid list entry");
    }
    return key.value;
  });
}

async function collectKeys(store, prefixes) {
  const keys = [];
  const seen = new Set();
  let pages = 0;
  for (const prefix of prefixes) {
    const options = Object.fromEntries([["prefix", prefix], ["paginate", true]]);
    const listing = store.list(options);
    const iteratorMethod = inheritedDataMethod(listing, Symbol.asyncIterator);
    if (iteratorMethod === null) throw new TypeError("Invalid list iterator");
    const iterator = iteratorMethod.call(listing);
    const next = inheritedDataMethod(iterator, "next");
    if (next === null) throw new TypeError("Invalid list iterator");
    while (true) {
      const result = iteratorResult(await next.call(iterator));
      if (result.done) break;
      pages += 1;
      if (pages > MAX_PAGES) throw new TypeError("Too many list pages");
      for (const key of pageKeys(result.value)) {
        if (seen.has(key)) throw new TypeError("Duplicate list key");
        seen.add(key);
        keys.push({ key, prefix });
        if (keys.length > MAX_KEYS) throw new TypeError("Too many list keys");
      }
    }
  }
  return keys;
}

function classifyKey(docId, entry, grantPrefix, invitationPrefix) {
  const { key, prefix } = entry;
  if (!key.startsWith(prefix) || !key.endsWith(".json")) throw new TypeError("Invalid child key");
  const middle = key.slice(prefix.length, -5);
  if (prefix === grantPrefix) {
    if (middle.length === 0 || assertIdentitySub(middle) !== middle ||
        accessGrantKey(docId, middle) !== key) throw new TypeError("Invalid grant key");
    return { key, kind: "grant", sub: middle };
  }
  if (prefix !== invitationPrefix || !INVITATION_HASH_PATTERN.test(middle)) {
    throw new TypeError("Invalid invitation key");
  }
  return { key, kind: "invitation" };
}

function readValue(result) {
  if (!isExactPlainDataObject(result, ["value", "etag"], false)) {
    throw new TypeError("Invalid read result");
  }
  const value = ownDataDescriptor(result, "value").value;
  const etag = ownDataDescriptor(result, "etag").value;
  if ((value === null && etag !== null) ||
      (value !== null && (typeof etag !== "string" || etag.length === 0))) {
    throw new TypeError("Invalid read result");
  }
  return value;
}

export default async function handler(req) {
  if (req.method !== "GET") return emptyResponse(405, { Allow: "GET", ...NO_STORE });
  try {
    const identified = await identify(req);
    if (identified === null) return emptyResponse(401);
    const user = validateIdentity(identified);
    const documents = new URL(req.url).searchParams.getAll("doc");
    if (documents.length !== 1 || !DOC_ID_PATTERN.test(documents[0])) return emptyResponse(400);
    const docId = documents[0];
    const access = validateAccess(await resolveRole(docId, user));
    if (access.canSeeMembers !== true) return emptyResponse(403);

    const store = docState();
    const documentValue = readValue(await read(store, accessDocumentKey(docId)));
    if (documentValue === null) throw new TypeError("Missing access document");
    const document = assertAccessDocument(documentValue, docId);
    if (document !== documentValue) throw new TypeError("Invalid document validation result");

    const grantPrefix = accessGrantPrefix(docId);
    const invitationPrefix = accessInvitationPrefix(docId);
    const listed = await collectKeys(store, [grantPrefix, invitationPrefix]);
    const children = listed.map((entry) => classifyKey(docId, entry, grantPrefix, invitationPrefix));
    const results = await Promise.all(children.map(({ key }) => read(store, key)));
    const grants = [];
    const invitations = [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const value = readValue(results[index]);
      if (value === null) continue;
      if (child.kind === "grant") {
        const grant = assertAccessGrant(value, docId, child.sub);
        if (grant !== value) throw new TypeError("Invalid grant validation result");
        grants.push(grant);
      } else {
        const invitation = await assertAccessInvitationAtKey(value, docId, child.key);
        if (invitation !== value) throw new TypeError("Invalid invitation validation result");
        invitations.push(invitation);
      }
    }

    const members = grants.filter(({ sub }) => sub !== document.ownerSub);
    const emails = new Set([document.ownerEmail]);
    for (const member of members) {
      if (emails.has(member.email)) throw new TypeError("Duplicate member email");
      emails.add(member.email);
    }
    const now = new Date().toISOString();
    members.sort((left, right) => left.email < right.email ? -1 : left.email > right.email ? 1 :
      left.sub < right.sub ? -1 : left.sub > right.sub ? 1 : 0);
    invitations.sort((left, right) => left.email < right.email ? -1 : left.email > right.email ? 1 : 0);
    const body = {
      doc: docId,
      orgDefault: document.orgDefault,
      members: [
        { sub: document.ownerSub, email: document.ownerEmail, name: "", role: "owner" },
        ...members.map(({ sub, email, name, role }) => ({ sub, email, name, role })),
      ],
      invitations: invitations.filter(({ expiresAt }) => expiresAt > now)
        .map(({ email, role, expiresAt }) => ({ email, role, expiresAt })),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE },
    });
  } catch (error) {
    return emptyResponse(isUnavailable(error) ? 503 : 500);
  }
}

export const config = { path: "/api/access" };
