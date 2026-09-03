import { identify } from "../lib/identity.mjs";
import { assertIdentitySub, capabilitiesFor, resolveRole } from "../lib/access.mjs";
import { StoreError } from "../lib/store.mjs";

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
  if (!isExactPlainDataObject(value, IDENTITY_KEYS, true)) {
    throw new TypeError("Invalid identity");
  }
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
  if (!isExactPlainDataObject(value, ACCESS_KEYS, false)) {
    throw new TypeError("Invalid access result");
  }
  const role = ownDataDescriptor(value, "role").value;
  const shared = ownDataDescriptor(value, "shared").value;
  const threadControl = ownDataDescriptor(value, "threadControl").value;
  if (!ROLES.includes(role) || typeof shared !== "boolean" ||
      !THREAD_CONTROLS.includes(threadControl)) {
    throw new TypeError("Invalid access result");
  }
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

export default async function handler(req) {
  if (req.method !== "GET") {
    return emptyResponse(405, { Allow: "GET", ...NO_STORE });
  }
  try {
    const identified = await identify(req);
    if (identified === null) return emptyResponse(401);
    const user = validateIdentity(identified);
    const documents = new URL(req.url).searchParams.getAll("doc");
    if (documents.length !== 1 || !DOC_ID_PATTERN.test(documents[0])) {
      return emptyResponse(400);
    }
    const docId = documents[0];
    const access = validateAccess(await resolveRole(docId, user, { consumeInvitation: true }));
    const body = {
      sub: user.sub,
      email: user.email,
      name: user.name,
      roles: [user.isOrg ? "member" : "guest"],
      canComment: access.canComment,
      canEdit: access.canEdit,
      doc: docId,
      role: access.role,
      shared: access.shared,
      canSuggest: access.canSuggest,
      canAccept: access.canAccept,
      canShare: access.canShare,
      canSeeMembers: access.canSeeMembers,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE },
    });
  } catch (error) {
    return emptyResponse(isUnavailable(error) ? 503 : 500);
  }
}

export const config = { path: "/api/session" };
