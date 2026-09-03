import { getUser, verifyRequestOrigin } from "@netlify/identity";

/**
 * The reserved organization domain suffix from the ruling plan. Identity
 * classifies whether the normalized email carries this suffix; it never
 * grants document authority. P2-G's resolveRole() is the final document role
 * and capability decision.
 */
const ORG_DOMAIN = "@example.com";

/**
 * @param {Request} req
 * @returns {Promise<null | {
 *   sub: string,
 *   email: string,
 *   name: string,
 *   isOrg: boolean
 * }>}
 */
export async function identify(req) {
  const user = await getUser();
  if (user === null) {
    return null;
  }

  const email = (user.email ?? "").toLowerCase();
  const name = user.name ?? email.split("@")[0];
  const isOrg = email.endsWith(ORG_DOMAIN);

  return { sub: user.id, email, name, isOrg };
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
