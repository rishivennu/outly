import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig } from "@/lib/settings";
import { JobError } from "@/lib/blog/job";
import { getPost, publishPost, regenerateSection, rejectPost, restorePost, schedulePost, unpublishPost, unschedulePost, updatePost, verifySource } from "@/lib/blog/posts";

export const dynamic = "force-dynamic";
/** Regenerating a section is one model call, budgeted at 55 s. */
export const maxDuration = 60;

const wrap = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "BLOG");
    throw e;
  }
};

export const GET = adminRoute<{ params: { id: string } }>("content", async (_req, { params }) => json({ post: await wrap(() => getPost(params.id)) }));

const Link = z.object({ href: z.string().max(200), label: z.string().max(120) });
const Patch = z.object({
  title: z.string().max(200).optional(),
  seoTitle: z.string().max(120).optional(),
  metaDescription: z.string().max(240).optional(),
  excerpt: z.string().max(500).optional(),
  bodyMd: z.string().max(60_000).optional(),
  category: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  primaryKeyword: z.string().max(80).optional(),
  secondaryKeywords: z.array(z.string().max(80)).max(12).optional(),
  slug: z.string().max(100).optional(),
  internalLinks: z.array(Link).max(8).optional(),
});

export const PATCH = adminRoute<{ params: { id: string } }>("content", async (req, { params, admin }) => {
  const patch = Patch.parse(await req.json());
  return json({ post: await wrap(() => updatePost(admin, params.id, patch)) });
}, [60, 60_000]);

const Act = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("unpublish") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().max(500).default("") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("regenerate"), heading: z.string().trim().min(1).max(200), note: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("schedule"), at: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("verifySource"), sourceId: z.string().trim().min(1).max(60), verified: z.boolean() }),
]);

export const POST = adminRoute<{ params: { id: string } }>("content", async (req, { params, admin }) => {
  const a = Act.parse(await req.json());
  const post = await wrap(async () => {
    switch (a.action) {
      case "publish":
        return publishPost(admin, params.id);
      case "unpublish":
        return unpublishPost(admin, params.id);
      case "reject":
        return rejectPost(admin, params.id, a.reason);
      case "restore":
        return restorePost(admin, params.id);
      case "regenerate":
        return regenerateSection(admin, params.id, a.heading, a.note);
      case "schedule":
        return schedulePost(admin, params.id, a.at);
      case "unschedule":
        return unschedulePost(admin, params.id);
      case "verifySource":
        return verifySource(admin, params.id, a.sourceId, a.verified);
    }
  });
  if (a.action === "schedule" && post.scheduledFor) {
    const tz = (await getConfig("blog")).timezone;
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(post.scheduledFor));
    await adminEvent("blog.scheduled", `${admin.name} set "${post.title}" to publish on ${when}`, `Timezone: ${tz}`, `/admin/blog/review/${post.id}`);
  }
  if (a.action === "publish") await adminEvent("blog.published", `${admin.name} published "${post.title}"`, undefined, `/blog/${post.slug}`);
  if (a.action === "reject") await adminEvent("blog.rejected", `${admin.name} rejected "${post.title}"`, a.reason || undefined, `/admin/blog/review/${post.id}`);
  return json({ post });
}, [60, 60_000]);
