import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";

export const dynamic = "force-dynamic";
const MAX_OPEN = 200;

const view = (i: { id: string; text: string; source: string; sourceRef: string | null; doneAt: Date | null; createdAt: Date }) => ({ id: i.id, text: i.text, source: i.source, sourceRef: i.sourceRef, done: !!i.doneAt, createdAt: i.createdAt.toISOString() });

/** Open ideas, newest first, plus the few most recently used. */
export const GET = route(async (_req, { user }) => {
  const [open, done] = await Promise.all([
    db.idea.findMany({ where: { userId: user.id, doneAt: null }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.idea.findMany({ where: { userId: user.id, doneAt: { not: null } }, orderBy: { doneAt: "desc" }, take: 5 }),
  ]);
  return json({ ideas: open.map(view), done: done.map(view) });
});

const Body = z.object({
  text: z.string().trim().min(2, "Write a few words").max(500),
  source: z.enum(["manual", "comment", "suggestion"]).default("manual"),
  sourceRef: z.string().max(300).optional(),
});

export const POST = route(
  async (req, { user }) => {
    const b = Body.parse(await req.json());
    if ((await db.idea.count({ where: { userId: user.id, doneAt: null } })) >= MAX_OPEN) throw new HttpError(400, "Your idea bank is full. Use or clear a few first.", "LIMIT");
    // Saving the same comment twice keeps one idea.
    if (b.sourceRef) {
      const dupe = await db.idea.findFirst({ where: { userId: user.id, sourceRef: b.sourceRef } });
      if (dupe) return json({ idea: view(dupe), existed: true });
    }
    const i = await db.idea.create({ data: { userId: user.id, text: b.text, source: b.source, sourceRef: b.sourceRef ?? null } });
    return json({ idea: view(i) }, { status: 201 });
  },
  { limit: [40, 60_000] },
);
