import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";
import { rateLimit } from "./rate-limit";
import { env } from "./env";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * CSRF: session cookie is SameSite=Lax, and every state-changing request must
 * carry an Origin (or Referer) that matches APP_URL / Host. Browsers set Origin
 * on cross-site POSTs, so a forged form post from another site is rejected.
 */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) throw new HttpError(403, "Missing origin", "CSRF");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new HttpError(403, "Bad origin", "CSRF");
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = new Set([new URL(env.APP_URL).host, host].filter(Boolean) as string[]);
  if (!allowed.has(o.host)) throw new HttpError(403, "Cross-site request blocked", "CSRF");
}

function clientKey(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "local";
}

type Handler<C> = (req: NextRequest, ctx: C & { user: SessionUser }) => Promise<Response>;

/** Wraps a route: CSRF + auth + rate limit + uniform, human-safe error responses. */
export function route<C = { params: Record<string, string> }>(
  handler: Handler<C>,
  opts: { auth?: boolean; limit?: [number, number] } = {},
) {
  return async (req: NextRequest, ctx: C) => {
    try {
      assertSameOrigin(req);
      const [limit, windowMs] = opts.limit ?? [120, 60_000];
      const rl = rateLimit(`${clientKey(req)}:${req.nextUrl.pathname}:${req.method}`, limit, windowMs);
      if (!rl.ok)
        return json(
          { error: "You're moving fast. Give it a moment.", code: "RATE_LIMITED" },
          { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        );
      let user = null as SessionUser | null;
      if (opts.auth !== false) {
        user = await getCurrentUser();
        if (!user) return json({ error: "Please sign in again.", code: "UNAUTHENTICATED" }, { status: 401 });
      }
      return await handler(req, { ...ctx, user: user as SessionUser });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError)
        return json({ error: e.issues[0]?.message ?? "Invalid input", issues: e.issues, code: "VALIDATION" }, { status: 400 });
      console.error("[route]", e);
      return json({ error: "Something got in the way.", code: "INTERNAL" }, { status: 500 });
    }
  };
}
