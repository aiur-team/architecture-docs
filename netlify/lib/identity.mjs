import { getUser, verifyRequestOrigin } from "@netlify/identity";

/**
 * The Phase 1 organization suffix from the ruling plan. The reserved sample
 * suffix is defined once here; P1-C introduces no undocumented environment
 * variable. Replacing it with a deployment-specific contract needs an
 * explicit later ruling.
 */
const ORG_SUFFIX = "@example.com";

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
export async function identify(req) {
  const user = await getUser();
  if (user === null) {
    return null;
  }

  const email = (user.email ?? "").toLowerCase();
  const name = user.name ?? email.split("@")[0];

  // Read provider roles defensively so either storage shape is safe (the
  // account-level `role` string or the `app_metadata.roles` array). Phase 1
  // never forwards them: the public classification below is forced to exactly
  // `member` for the reserved org suffix and `guest` for every other account.
  const providerRoles = user.roles ?? (user.role ? [user.role] : []);

  if (email.endsWith(ORG_SUFFIX)) {
    return {
      sub: user.id,
      email,
      name,
      roles: ["member"],
      canComment: true,
      canEdit: true,
      docs: [],
    };
  }

  const appMetadataDocs = user.appMetadata?.docs;
  const docs =
    Array.isArray(appMetadataDocs) &&
    appMetadataDocs.every((doc) => typeof doc === "string")
      ? appMetadataDocs
      : [];
  return {
    sub: user.id,
    email,
    name,
    roles: ["guest"],
    canComment: false,
    canEdit: false,
    docs,
  };
}

/**
 * @param {Request} req
 * @returns {void}
 * @throws {Response} A normalized 403 response when origin verification fails.
 */
export function requireOrigin(req) {
  try {
    verifyRequestOrigin(req);
  } catch {
    throw new Response("Bad origin", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
