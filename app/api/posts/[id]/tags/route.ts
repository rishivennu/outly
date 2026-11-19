import { z } from "zod";
import { json, route } from "@/lib/http";
import { setTopic, tagPost, tagsForPost } from "@/lib/intelligence/categories";

export const dynamic = "force-dynamic";

/** R1237: the post's topic and categories, the owner's category list and a keyword suggestion. Every role can tag. */
export const GET = route(async (_req, { user, params }) => json(await tagsForPost(user.id, params.id)), { limit: [300, 60_000] });

const body = z.object({ categoryIds: z.array(z.string().max(40)).max(20).optional(), topic: z.string().max(200).optional().nullable() });

/** Replaces the categories and/or the topic. A field not sent stays as it is; topic null or blank clears it. */
export const PUT = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    if (b.categoryIds !== undefined) await tagPost(user.id, params.id, b.categoryIds);
    if (b.topic !== undefined) await setTopic(user.id, params.id, b.topic);
    return json(await tagsForPost(user.id, params.id));
  },
  { limit: [60, 60_000] },
);
