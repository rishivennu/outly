import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";

async function owned(userId: string, id: string) {
  const i = await db.idea.findFirst({ where: { id, userId } });
  if (!i) throw new HttpError(404, "That idea is gone.", "NOT_FOUND");
  return i;
}

const Body = z.object({ text: z.string().trim().min(2).max(500).optional(), done: z.boolean().optional() });

export const PATCH = route(async (req, { user, params }) => {
  await owned(user.id, params.id);
  const b = Body.parse(await req.json());
  const i = await db.idea.update({ where: { id: params.id }, data: { ...(b.text ? { text: b.text } : {}), ...(b.done === undefined ? {} : { doneAt: b.done ? new Date() : null }) } });
  return json({ idea: { id: i.id, text: i.text, source: i.source, sourceRef: i.sourceRef, done: !!i.doneAt, createdAt: i.createdAt.toISOString() } });
});

export const DELETE = route(async (_req, { user, params }) => {
  await owned(user.id, params.id);
  await db.idea.delete({ where: { id: params.id } });
  return json({ ok: true });
});
