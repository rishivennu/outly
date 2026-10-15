import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";

export const dynamic = "force-dynamic";
const MAX = 100;
const SnippetKind = z.enum(["caption", "hashtags", "template", "brand"]);

const view = (s: { id: string; kind: string; name: string; body: string; uses: number; updatedAt: Date }) => ({ id: s.id, kind: s.kind, name: s.name, body: s.body, uses: s.uses, updatedAt: s.updatedAt.toISOString() });

/** Caption presets, hashtag sets, templates and brand notes. Most used first. */
export const GET = route(async (req, { user }) => {
  const kind = SnippetKind.safeParse(req.nextUrl.searchParams.get("kind"));
  const rows = await db.snippet.findMany({ where: { userId: user.id, ...(kind.success ? { kind: kind.data } : {}) }, orderBy: [{ uses: "desc" }, { updatedAt: "desc" }], take: MAX });
  return json({ snippets: rows.map(view) });
});

const Body = z.object({
  kind: SnippetKind,
  name: z.string().trim().min(1, "Give it a short name").max(60),
  body: z.string().trim().min(1, "Nothing to save yet").max(2200),
});

export const POST = route(
  async (req, { user }) => {
    const b = Body.parse(await req.json());
    if ((await db.snippet.count({ where: { userId: user.id } })) >= MAX) throw new HttpError(400, `You can keep up to ${MAX} snippets. Delete one you don't use first.`, "LIMIT");
    const s = await db.snippet.create({ data: { userId: user.id, ...b } });
    return json({ snippet: view(s) }, { status: 201 });
  },
  { limit: [30, 60_000] },
);
