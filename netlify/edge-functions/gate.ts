import { identify } from "../lib/identity.mjs";

const PLAIN_TEXT = "text/plain; charset=utf-8";
const NO_STORE = { "Cache-Control": "private, no-store" };

const UNAVAILABLE = "Authentication is temporarily unavailable.";
const DENIED = "You do not have access to this document.";

/**
 * Fail-closed edge gate targeted by the P1-E `[[edge_functions]]` declaration.
 *
 * Anonymous callers are redirected to the public login page with their
 * same-site path and query preserved as `next`. An organization member passes
 * through to the static response; every other authenticated shape receives a
 * plain-text 403. The exact `/invite/` pathname family is opened before
 * identity for P4-K's future public acceptance page.
 */
export default async function gate(req: Request): Promise<Response | undefined> {
  const url = new URL(req.url);

  // Public static seam for P4-K: exact `/invite/` and descendants bypass
  // identity for every method; before P4-K they reach the downstream 404.
  if (url.pathname === "/invite/" || url.pathname.startsWith("/invite/")) {
    return undefined;
  }

  let user: any;
  try {
    user = await identify(req);
  } catch {
    return new Response(UNAVAILABLE, {
      status: 503,
      headers: { "Content-Type": PLAIN_TEXT, ...NO_STORE },
    });
  }

  if (user === null) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/login/?next=${next}`, ...NO_STORE },
    });
  }

  const isOrg = typeof user.isOrg === "boolean" ? user.isOrg : Array.isArray(user.roles) && user.roles.includes("member");
  if (isOrg) {
    return undefined;
  }

  return new Response(DENIED, {
    status: 403,
    headers: { "Content-Type": PLAIN_TEXT, ...NO_STORE },
  });
}
