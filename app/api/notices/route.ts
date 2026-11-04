import { z } from "zod";
import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { listNotices } from "@/lib/retention/notices";
import { unreadCount } from "@/lib/notify";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const history = req.nextUrl.searchParams.get("history") === "1";
  const notices = await listNotices(user.id, { history });
  // The count covers every unread notice, not just the ones in this page of the list (it drives the app icon badge too).
  return json({ notices, unread: await unreadCount(user.id) });
});

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().max(40)).min(1).max(50) })]);

/** Mark read: one, several, or all. Only ever the caller's own notices. */
export const PATCH = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const r = await db.notice.updateMany({ where: { userId: user.id, readAt: null, ...("ids" in b ? { id: { in: b.ids } } : {}) }, data: { readAt: new Date() } });
  return json({ ok: true, updated: r.count });
});

/**
 * Clear from history (1118): hidden, not deleted, so the key still stops the same alert coming back
 * as new. Cleared notices count as read.
 */
export const DELETE = route(async (req, { user }) => {
  const b = Body.parse(await req.json());
  const now = new Date();
  const r = await db.notice.updateMany({ where: { userId: user.id, hiddenAt: null, ...("ids" in b ? { id: { in: b.ids } } : {}) }, data: { hiddenAt: now } });
  await db.notice.updateMany({ where: { userId: user.id, hiddenAt: now, readAt: null }, data: { readAt: now } });
  return json({ ok: true, cleared: r.count });
});
