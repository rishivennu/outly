import { z } from "zod";
import { json, route } from "@/lib/http";
import { createCategory, listCategories } from "@/lib/intelligence/categories";

export const dynamic = "force-dynamic";

const body = z.object({ name: z.string().max(200), keywords: z.array(z.string().max(200)).max(100).optional().nullable() });

/** R1237: the workspace's content categories. Every role can read and add them (tagging is editing work). */
export const GET = route(async (_req, { user }) => json({ categories: await listCategories(user.id) }));

export const POST = route(
  async (req, { user }) => json({ category: await createCategory(user.id, body.parse(await req.json())) }, { status: 201 }),
  { limit: [30, 60_000] },
);
