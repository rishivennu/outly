import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type SessionUser } from "./auth";
import { rateLimit } from "./rate-limit";
import { env } from "./env";
import { getConfig } from "./settings";
import { getAdmin } from "./admin/auth";
import { loadKeys } from "./social/keys";
import { memberBlock } from "./team/roles";
import { joinedBeforeMaintenance } from "./maintenance";

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
  // Only the real Host (set by the platform) and APP_URL. X-Forwarded-Host is client-supplied on many
  // setups, and trusting it let "Origin: evil + X-Forwarded-Host: evil" approve itself.
  const host = req.headers.get("host");
  const allowed = new Set([new URL(env.APP_URL).host, host].filter(Boolean) as string[]);
  if (!allowed.has(o.host)) throw new HttpError(403, "Cross-site request blocked", "CSRF");
}

/**
 * The caller's IP for rate limits. The FIRST X-Forwarded-For entry is whatever the client typed, so
 * rotating it used to dodge every limit. Trust the platform (req.ip on Vercel), else the LAST hop,
 * which our own proxy (scripts/lb.mjs) appends from the real socket. Vercel overwrites XFF with one IP.
 */
export function clientIp(req: NextRequest) {
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return req.ip || hops[hops.length - 1] || "local";
}
const clientKey = clientIp;

/** Public endpoints that stay open during maintenance so members can sign back in. */
const MAINTENANCE_OPEN = ["/api/maintenance", "/api/auth/login", "/api/auth/code", "/api/auth/2fa", "/api/auth/logout", "/api/support/chat", "/api/health"];

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
      // Maintenance (10-13): members who joined before it began keep working, admins too. Strangers get a
      // 503, except the few public endpoints a member needs to get back in (sign in/out, status, support chat).
      const site = await getConfig("site");
      let user = null as SessionUser | null;
      if (site.maintenance && !MAINTENANCE_OPEN.some((p) => req.nextUrl.pathname.startsWith(p)) && !(await getAdmin())) {
        user = await getCurrentUser();
        if (!joinedBeforeMaintenance(user && { createdAt: user.joinedAt }, site.since))
          return json({ error: "Outlly is in a short maintenance window. Members can keep working; new visitors can come back soon.", code: "MAINTENANCE" }, { status: 503, headers: { "Retry-After": "300" } });
      }
      await loadKeys(); // platform app keys saved in the admin console (cached)
      if (opts.auth !== false) {
        user ??= await getCurrentUser();
        if (!user) return json({ error: "Please sign in again.", code: "UNAUTHENTICATED" }, { status: 401 });
        const blocked = memberBlock(user.role, req.method, req.nextUrl.pathname);
        if (blocked) return json({ error: blocked, code: "ROLE" }, { status: 403 });
      }
      return await handler(req, { ...ctx, user: user as SessionUser });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError)
        return json({ error: e.issues[0]?.message ?? "Invalid input", issues: e.issues, code: "VALIDATION" }, { status: 400 });
      // req.json() on a broken body: the caller's mistake, not ours (and not worth an error log).
      if (e instanceof SyntaxError) return json({ error: "That request couldn't be read. Refresh and try again.", code: "BAD_JSON" }, { status: 400 });
      console.error("[route]", e);
      return json({ error: "Something got in the way.", code: "INTERNAL" }, { status: 500 });
    }
  };
}
