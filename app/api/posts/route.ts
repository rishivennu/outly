import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { savePostSchema } from "@/lib/validation";
import { ownedMedia, ownedPost, postView } from "@/lib/services";
import { keepPlatforms } from "./targets";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const status = req.nextUrl.searchParams.get("status");
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(status && status !== "all" ? { status: status === "failed" ? { in: ["failed", "partial"] } : status } : {}) },
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
  if (postId) {
    const existing = await ownedPost(user.id, postId);
    if (["publishing", "published"].includes(existing.status)) throw new HttpError(409, "This one has already gone out.");
    await db.post.update({ where: { id: postId }, data: { mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook } });
  } else {
    postId = (await db.post.create({ data: { userId: user.id, mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook } })).id;
  }
  const keep = keepPlatforms(body.targets);
  await db.postTarget.deleteMany({ where: { postId, platform: { notIn: keep } } });
  for (const t of body.targets) {
    const data = { title: t.title ?? null, caption: t.caption ?? null, description: t.description ?? null, hashtags: t.hashtags ?? null };
    await db.postTarget.upsert({ where: { postId_platform: { postId, platform: t.platform } }, create: { postId, platform: t.platform, ...data }, update: data });
  }
  return json({ post: await postView(await ownedPost(user.id, postId)) });
});
