import "server-only";
import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { assertSameOrigin, clientIp, HttpError, json } from "../http";
import { rateLimit } from "../rate-limit";
import { getAdmin, type AdminSession } from "./auth";
import { can, type AdminArea } from "./perms";

type Handler<C> = (req: NextRequest, ctx: C & { admin: AdminSession }) => Promise<Response>;

/** Admin API wrapper: same-origin + admin session + role check + rate limit. */
export function adminRoute<C = { params: Record<string, string> }>(area: AdminArea, handler: Handler<C>, limit: [number, number] = [90, 60_000]) {
  return async (req: NextRequest, ctx: C) => {
    try {
      assertSameOrigin(req);
      const ip = clientIp(req);
      const rl = rateLimit(`admin:${ip}:${req.nextUrl.pathname}:${req.method}`, limit[0], limit[1]);
      if (!rl.ok) return json({ error: "Too many requests. Wait a moment.", code: "RATE_LIMITED" }, { status: 429 });
      const admin = await getAdmin();
      if (!admin) return json({ error: "Your admin session ended. Sign in again.", code: "UNAUTHENTICATED" }, { status: 401 });
      if (!can(admin.role, area)) return json({ error: "Your role can't do that. Ask a super admin.", code: "FORBIDDEN" }, { status: 403 });
      return await handler(req, { ...ctx, admin });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? "Invalid input", code: "VALIDATION" }, { status: 400 });
      if (e instanceof SyntaxError) return json({ error: "That request couldn't be read. Refresh and try again.", code: "BAD_JSON" }, { status: 400 });
      console.error("[admin]", e);
      return json({ error: "Something went wrong on our side. Nothing was changed.", code: "INTERNAL" }, { status: 500 });
    }
  };
}

export async function adminEvent(kind: string, title: string, body?: string, href?: string) {
  const { db } = await import("../db");
  await db.adminEvent.create({ data: { kind, title, body, href } }).catch(() => {});
}
