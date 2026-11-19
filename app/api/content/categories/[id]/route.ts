import { z } from "zod";
import { json, route } from "@/lib/http";
import { deleteCategory, renameCategory } from "@/lib/intelligence/categories";

export const dynamic = "force-dynamic";

const body = z.object({ name: z.string().max(200).optional().nullable(), keywords: z.array(z.string().max(200)).max(100).optional().nullable() });

/** R1237: rename a category or replace its keywords. */
export const PATCH = route(async (req, { user, params }) => json({ category: await renameCategory(user.id, params.id, body.parse(await req.json())) }), { limit: [30, 60_000] });

/** R1237: delete a category; its tags go with it, the content stays. */
export const DELETE = route(async (_req, { user, params }) => {
  await deleteCategory(user.id, params.id);
  return json({ ok: true });
});
