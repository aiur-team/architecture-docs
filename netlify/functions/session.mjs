import { identify } from "../lib/identity.mjs";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/session — the initial six-field Phase 1 session response.
 *
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export default async function handler(req) {
  if (req.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET", ...NO_STORE },
    });
  }

  const user = await identify(req);
  if (user === null) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }

  return Response.json(
    {
      sub: user.sub,
      email: user.email,
      name: user.name,
      roles: user.roles,
      canComment: user.canComment,
      canEdit: user.canEdit,
    },
    { headers: NO_STORE },
  );
}

export const config = { path: "/api/session" };
