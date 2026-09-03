import { identify } from "../lib/identity.mjs";
import { capabilitiesFor, resolveRole } from "../lib/access.mjs";

type GateContext = {
  next(request?: Request): Promise<Response>;
};

const PLAIN_TEXT = "text/plain; charset=utf-8";
const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_META_LINE_BYTES = 96;

const AUTH_UNAVAILABLE = "Authentication is temporarily unavailable.";
const ACCESS_UNAVAILABLE = "Document access is temporarily unavailable.";
const UNVERIFIED = "Document access could not be verified.";
const DENIED = "You do not have access to this document.";

const IDENTITY_KEYS = ["sub", "email", "name", "isOrg"];
const CAPABILITY_KEYS = [
  "canRead",
  "canComment",
  "threadControl",
  "canSuggest",
  "canEdit",
  "canAccept",
  "canShare",
  "canSeeMembers",
];
const RESULT_KEYS = ["role", "shared", ...CAPABILITY_KEYS];
const CONTENT_TYPE_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const CONTENT_TYPE_QUOTED = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t !-~])*"';
const CONTENT_TYPE_PARAMETER = `;[\\t ]*${CONTENT_TYPE_TOKEN}[\\t ]*=[\\t ]*(?:${CONTENT_TYPE_TOKEN}|${CONTENT_TYPE_QUOTED})[\\t ]*`;
const HTML_CONTENT_TYPE = new RegExp(
  `^[\\t ]*text/html[\\t ]*(?:${CONTENT_TYPE_PARAMETER})*$`,
  "i",
);

function plainResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": PLAIN_TEXT, ...NO_STORE },
  });
}

function exactMutableRecord(
  value: unknown,
  keys: readonly string[],
): null | Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(
        (key, index) => typeof key !== "string" || key !== keys[index],
      )
    )
      return null;

    const record: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        !descriptor.writable ||
        !descriptor.configurable
      )
        return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function validIdentity(
  value: unknown,
): value is { sub: string; email: string; name: string; isOrg: boolean } {
  const record = exactMutableRecord(value, IDENTITY_KEYS);
  return (
    record !== null &&
    typeof record.sub === "string" &&
    typeof record.email === "string" &&
    typeof record.name === "string" &&
    typeof record.isOrg === "boolean"
  );
}

function validContentType(value: string | null): boolean {
  return value !== null && HTML_CONTENT_TYPE.test(value);
}

function validResolvedAccess(value: unknown): null | Record<string, unknown> {
  const result = exactMutableRecord(value, RESULT_KEYS);
  if (
    result === null ||
    typeof result.role !== "string" ||
    typeof result.shared !== "boolean"
  )
    return null;

  try {
    const expected = capabilitiesFor(result.role);
    if (CAPABILITY_KEYS.some((key) => result[key] !== expected[key]))
      return null;
  } catch {
    return null;
  }
  return result;
}

function isUnavailableError(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  try {
    const name = Object.getOwnPropertyDescriptor(value, "name");
    const code = Object.getOwnPropertyDescriptor(value, "code");
    const status = Object.getOwnPropertyDescriptor(value, "status");
    return (
      name !== undefined &&
      "value" in name &&
      name.value === "StoreError" &&
      code !== undefined &&
      "value" in code &&
      code.value === "unavailable" &&
      status !== undefined &&
      "value" in status &&
      status.value === 503
    );
  } catch {
    return false;
  }
}

async function cancelAndRelease(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cleanup failure must not change the authorization response.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The authorization response remains fail closed if cleanup is inaccessible.
    }
  }
}

function replayResponse(
  downstream: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  retained: Uint8Array[],
): Response {
  let terminal = false;
  const release = () => {
    if (terminal) return false;
    terminal = true;
    try {
      reader.releaseLock();
    } catch {
      // A terminal stream path cannot be replaced with another response.
    }
    return true;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of retained) controller.enqueue(chunk);
      retained.length = 0;
    },
    async pull(controller) {
      if (terminal) return;
      try {
        const next = await reader.read();
        if (next.done) {
          if (release()) controller.close();
          return;
        }
        if (!(next.value instanceof Uint8Array))
          throw new TypeError("Invalid response stream chunk");
        controller.enqueue(next.value);
      } catch (error) {
        if (release()) controller.error(error);
      }
    },
    async cancel(reason) {
      if (terminal) return;
      try {
        await reader.cancel(reason);
      } catch {
        // Consumer cancellation still settles if upstream cancellation rejects.
      } finally {
        release();
      }
    },
  });

  const headers = new Headers(downstream.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.delete("Transfer-Encoding");
  return new Response(body, {
    status: downstream.status,
    statusText: downstream.statusText,
    headers,
  });
}

export default async function gate(
  req: Request,
  context: GateContext,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname === "/invite/" || url.pathname.startsWith("/invite/"))
    return undefined;

  let user: unknown;
  try {
    user = await identify(req);
  } catch {
    return plainResponse(503, AUTH_UNAVAILABLE);
  }

  if (user === null) {
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/login/?next=${next}`, ...NO_STORE },
    });
  }
  if (!validIdentity(user)) return plainResponse(500, UNVERIFIED);

  const isHead = req.method === "HEAD";
  let downstream: Response;
  try {
    const nextRequest = isHead
      ? new Request(req, { method: "GET", body: null })
      : undefined;
    downstream = await context.next(nextRequest);
    if (
      !(downstream instanceof Response) ||
      downstream.status === 0 ||
      downstream.type === "opaque"
    )
      return plainResponse(503, ACCESS_UNAVAILABLE);
  } catch {
    return plainResponse(503, ACCESS_UNAVAILABLE);
  }

  let status: number;
  try {
    status = downstream.status;
  } catch {
    return plainResponse(503, ACCESS_UNAVAILABLE);
  }

  if (
    status === 204 ||
    status === 205 ||
    (status >= 300 && status <= 303) ||
    (status >= 305 && status <= 599)
  ) {
    if (!isHead) return downstream;
    try {
      return new Response(null, {
        status,
        statusText: downstream.statusText,
        headers: downstream.headers,
      });
    } catch {
      return plainResponse(503, ACCESS_UNAVAILABLE);
    }
  }
  if (status !== 200) return plainResponse(500, UNVERIFIED);

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (
      !validContentType(downstream.headers.get("Content-Type")) ||
      downstream.body === null ||
      downstream.bodyUsed ||
      downstream.body.locked
    )
      return plainResponse(500, UNVERIFIED);
    reader = downstream.body.getReader();
  } catch {
    return plainResponse(500, UNVERIFIED);
  }

  const retained: Uint8Array[] = [];
  const prefix: number[] = [];
  let firstLineFound = false;
  try {
    while (!firstLineFound) {
      const next = await reader.read();
      if (next.done || !(next.value instanceof Uint8Array)) throw new Error();
      retained.push(next.value);
      const inspectLength = Math.min(
        next.value.byteLength,
        MAX_META_LINE_BYTES - prefix.length,
      );
      for (let index = 0; index < inspectLength; index += 1) {
        const byte = next.value[index];
        prefix.push(byte);
        if (byte === 0x0a) {
          firstLineFound = true;
          break;
        }
      }
      if (!firstLineFound && prefix.length === MAX_META_LINE_BYTES)
        throw new Error();
    }

    const line = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(Uint8Array.from(prefix));
    const match = /^<meta name="doc-id" content="([0-9a-f]{6})">\n$/.exec(line);
    if (match === null) throw new Error();
    const docId = match[1];

    let resolved: unknown;
    try {
      resolved = await resolveRole(docId, user, { consumeInvitation: false });
    } catch (error) {
      await cancelAndRelease(reader);
      const unavailable = isUnavailableError(error);
      return plainResponse(
        unavailable ? 503 : 500,
        unavailable ? ACCESS_UNAVAILABLE : UNVERIFIED,
      );
    }

    const access = validResolvedAccess(resolved);
    if (access === null) {
      await cancelAndRelease(reader);
      return plainResponse(500, UNVERIFIED);
    }
    if (access.canRead !== true) {
      await cancelAndRelease(reader);
      return plainResponse(403, DENIED);
    }

    if (isHead) {
      await cancelAndRelease(reader);
      return new Response(null, {
        status: downstream.status,
        statusText: downstream.statusText,
        headers: downstream.headers,
      });
    }
    return replayResponse(downstream, reader, retained);
  } catch {
    await cancelAndRelease(reader);
    return plainResponse(500, UNVERIFIED);
  }
}
