import { isLibraryStatus, libraryPage } from "@/lib/posts/library";
import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { savePostSchema } from "@/lib/validation";
import { ownedMedia, ownedPost, postView } from "@/lib/services";
import { keepPlatforms } from "./targets";
import { supportsFirstComment } from "@/lib/domain";
import { pinTargets, postFilter } from "@/lib/profiles";
import { copyChanged } from "@/lib/collab-core";
import { recordEdit } from "@/lib/collab";
import { FORMAT_LABEL, isImageMime, supportsFormat, takesFirstComment, type PostFormat } from "@/lib/formats";
import { PLATFORM_META } from "@/lib/domain";

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
  // 1091: the Content library's "Load more" (cursor = id of the last post shown).
  if (req.nextUrl.searchParams.get("library") === "1") return json(await libraryPage(user, req.nextUrl.searchParams.get("cursor"), undefined, undefined, isLibraryStatus(status) ? status : null));
  const posts = await db.post.findMany({
    where: { userId: user.id, ...(await postFilter(user)).where, ...(status && status !== "all" ? { status: status === "failed" ? { in: ["failed", "partial"] } : status } : {}) },
    include: { targets: true, media: true, items: { include: { media: true }, orderBy: { position: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return json({ posts: await Promise.all(posts.map(postView)) });
});

/** Create or update a draft. Content is saved; nothing is sent until /launch with confirmed=true. */
export const POST = route(async (req, { user }) => {
  const body = savePostSchema.parse(await req.json());
  const main = await ownedMedia(user.id, body.mediaId);
  let postId = body.postId;
  let changed = true;
  const existing = postId ? await ownedPost(user.id, postId) : null;
  // 1131: what the post is. Not sent keeps the saved format (older clients only ever send video).
  const format: PostFormat = body.format ?? ((existing?.format as PostFormat | undefined) ?? "video");
  const items = format === "video" ? [] : (body.items ?? existing?.items?.map((i) => ({ mediaId: i.mediaId, altText: i.altText })) ?? []);
  if (format !== "video") {
    const owned = await db.media.findMany({ where: { userId: user.id, id: { in: items.map((i) => i.mediaId) } }, select: { id: true, mimeType: true } });
    if (owned.length !== items.length) throw new HttpError(404, "We couldn't find one of those photos or videos.");
    if (!items.length || items[0].mediaId !== body.mediaId) throw new HttpError(400, "The first slide has to be the post's main photo or video.");
    if (format === "photo" && !isImageMime(main.mimeType)) throw new HttpError(400, "A photo post needs an image.");
    const off = body.targets.find((t) => !supportsFormat(t.platform, format));
    if (off) throw new HttpError(400, `${PLATFORM_META[off.platform].name} can't take a ${FORMAT_LABEL[format].toLowerCase()} from Outlly yet. Switch it off for this post.`, "FORMAT_UNSUPPORTED");
  } else if (isImageMime(main.mimeType)) throw new HttpError(400, "That's a photo. Post it as a photo, carousel or Story.");
  const itemsBefore = JSON.stringify((existing?.items ?? []).map((i) => [i.mediaId, i.altText ?? ""]));
  const itemsAfter = JSON.stringify(items.map((i) => [i.mediaId, i.altText ?? ""]));
  // 1037: each destination is tied to the account it goes out on (active profile, or a member's own accounts)
  const pins = await pinTargets(user, body.targets, Object.fromEntries((existing?.targets ?? []).map((t) => [t.platform, t.socialAccountId])));
  if (existing && postId) {
    if (["publishing", "published"].includes(existing.status)) throw new HttpError(409, "This one has already gone out.");
    changed = copyChanged(existing, body, { replaceTargets: true }) || existing.format !== format || itemsBefore !== itemsAfter;
    await db.post.update({ where: { id: postId }, data: { mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook, format } });
  } else {
    postId = (await db.post.create({ data: { userId: user.id, mediaId: body.mediaId, title: body.title, story: body.story, hook: body.hook, format } })).id;
  }
  if (!existing || itemsBefore !== itemsAfter) {
    await db.$transaction([
      db.postMedia.deleteMany({ where: { postId } }),
      ...items.map((it, position) => db.postMedia.create({ data: { postId: postId!, mediaId: it.mediaId, position, altText: it.altText?.trim() || null } })),
    ]);
  }
  const keep = keepPlatforms(body.targets);
  await db.postTarget.deleteMany({ where: { postId, platform: { notIn: keep } } });
  for (const t of body.targets) {
    const data = { title: t.title ?? null, caption: t.caption ?? null, description: t.description ?? null, hashtags: t.hashtags ?? null, firstComment: supportsFirstComment(t.platform) && takesFirstComment(format) ? (t.firstComment?.trim() || null) : null };
    const pin = pins[t.platform] ? { socialAccountId: pins[t.platform] } : {};
    await db.postTarget.upsert({ where: { postId_platform: { postId, platform: t.platform } }, create: { postId, platform: t.platform, ...data, ...pin }, update: { ...data, ...pin } });
  }
  if (changed) await recordEdit(user, { id: postId });
  return json({ post: await postView(await ownedPost(user.id, postId)) });
});
