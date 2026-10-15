import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";

async function owned(userId: string, id: string) {
  const s = await db.snippet.findFirst({ where: { id, userId } });
  if (!s) throw new HttpError(404, "That snippet is gone.", "NOT_FOUND");
  return s;
}

const Body = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  body: z.string().trim().min(1).max(2200).optional(),
  /** counts an insert, so the most useful snippets float to the top */
  used: z.literal(true).optional(),
});

export const PATCH = route(async (req, { user, params }) => {
  await owned(user.id, params.id);
  const { used, ...rest } = Body.parse(await req.json());
  const s = await db.snippet.update({ where: { id: params.id }, data: { ...rest, ...(used ? { uses: { increment: 1 } } : {}) } });
  return json({ snippet: { id: s.id, kind: s.kind, name: s.name, body: s.body, uses: s.uses, updatedAt: s.updatedAt.toISOString() } });
});

export const DELETE = route(async (_req, { user, params }) => {
  await owned(user.id, params.id);
  await db.snippet.delete({ where: { id: params.id } });
  return json({ ok: true });
});
