import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { listNotices } from "@/lib/retention/notices";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user }) => {
  const notices = await listNotices(user.id);
  return json({ notices, unread: notices.filter((n) => !n.read).length });
});

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().max(40)).min(1).max(50) })]);

/** Mark read: one, several, or all. Only ever the caller's own notices. */
export const PATCH = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const r = await db.notice.updateMany({ where: { userId: user.id, readAt: null, ...("ids" in b ? { id: { in: b.ids } } : {}) }, data: { readAt: new Date() } });
  return json({ ok: true, updated: r.count });
});
