import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { savePostSchema } from "@/lib/validation";
import { ownedMedia, ownedPost, postView } from "@/lib/services";
import { keepPlatforms } from "./targets";
import { supportsFirstComment } from "@/lib/domain";
import { pinTargets, postFilter } from "@/lib/profiles";
import { copyChanged } from "@/lib/collab-core";
import { recordEdit } from "@/lib/collab";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const status = req.nextUrl.searchParams.get("status");
  // The command palette only needs names: no media, no signed URLs, so it stays cheap.
  if (req.nextUrl.searchParams.get("brief") === "1") {
    const rows = await db.post.findMany({ where: { userId: user.id, ...(await postFilter(user)).where }, select: { id: true, title: true, hook: true, status: true, scheduledAt: true, publishedAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 200 });
    return json({
      posts: rows.map((p) => ({
        id: p.id,
        title: (p.title || p.hook || "Untitled post").split("\n")[0].slice(0, 90),
        status: p.status,
        at: (p.status === "scheduled" ? p.scheduledAt : p.publishedAt ?? p.updatedAt)?.toISOString() ?? null,
      })),
    });
  }
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(await postFilter(user)).where, ...(status && status !== "all" ? { status: status === "failed" ? { in: ["failed", "partial"] } : status } : {}) },
    include: { targets: true, media: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return json({ posts: await Promise.all(posts.map(postView)) });
});

/** Create or update a draft. Content is saved; nothing is sent until /launch with confirmed=true. */
export const POST = route(async (req, { user }) => {
  const body = savePostSchema.parse(await req.json());
  await ownedMedia(user.id, body.mediaId);
  let postId = body.postId;
  let changed = true;
  const existing = postId ? await ownedPost(user.id, postId) : null;
  // 1037: each destination is tied to the account it goes out on (active profile, or a member's own accounts)
  const pins = await pinTargets(user, body.targets, Object.fromEntries((existing?.targets ?? []).map((t) => [t.platform, t.socialAccountId])));
  if (existing && postId) {
    if (["publishing", "published"].includes(existing.status)) throw new HttpError(409, "This one has already gone out.");
    changed = copyChanged(existing, body, { replaceTargets: true });
    await db.post.update({ where: { id: postId }, data: { mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook } });
  } else {
    postId = (await db.post.create({ data: { userId: user.id, mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook } })).id;
  }
  const keep = keepPlatforms(body.targets);
  await db.postTarget.deleteMany({ where: { postId, platform: { notIn: keep } } });
  for (const t of body.targets) {
    const data = { title: t.title ?? null, caption: t.caption ?? null, description: t.description ?? null, hashtags: t.hashtags ?? null, firstComment: supportsFirstComment(t.platform) ? (t.firstComment?.trim() || null) : null };
    const pin = pins[t.platform] ? { socialAccountId: pins[t.platform] } : {};
    await db.postTarget.upsert({ where: { postId_platform: { postId, platform: t.platform } }, create: { postId, platform: t.platform, ...data, ...pin }, update: { ...data, ...pin } });
  }
  if (changed) await recordEdit(user, { id: postId });
  return json({ post: await postView(await ownedPost(user.id, postId)) });
});
