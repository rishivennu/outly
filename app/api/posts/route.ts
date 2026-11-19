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
import { DRAFT_CONFLICT_MESSAGE, draftConflict, serverDraft, StaleDraftError } from "@/lib/posts/conflicts";
import { lineageAfterCreate } from "@/lib/intelligence/lineage";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { user }) => {
  const status = req.nextUrl.searchParams.get("status");
  // The command palette only needs names: no media, no signed URLs, so it stays cheap.
  if (req.nextUrl.searchParams.get("brief") === "1") {
    const rows = await db.post.findMany({ where: { userId: user.id, archivedAt: null, ...(await postFilter(user)).where }, select: { id: true, title: true, hook: true, status: true, scheduledAt: true, publishedAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 200 });
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
  // 1148: `q` searches the whole library (the search box, when not every post is loaded yet).
  if (req.nextUrl.searchParams.get("library") === "1") return json(await libraryPage(user, req.nextUrl.searchParams.get("cursor"), undefined, undefined, isLibraryStatus(status) ? status : null, req.nextUrl.searchParams.get("q")));
  const posts = await db.post.findMany({
    where: { userId: user.id, archivedAt: null, ...(await postFilter(user)).where, ...(status && status !== "all" ? { status: status === "failed" ? { in: ["failed", "partial"] } : status } : {}) },
    include: { targets: true, media: true, items: { include: { media: true }, orderBy: { position: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return json({ posts: await Promise.all(posts.map(postView)) });
});

/** Create or update a draft. Content is saved; nothing is sent until /launch with confirmed=true. */
export const POST = route(async (req, { user }) => {
  const body = savePostSchema.parse(await req.json());
  // Phase 2: a device syncing a draft it made offline sends the same clientKey every try. The first one creates it;
  // a retry (its answer lost, maybe with words typed since) saves into that draft and says so with deduped.
  const twinOf = () => (!body.postId && body.clientKey ? db.post.findFirst({ where: { userId: user.id, clientKey: body.clientKey }, select: { id: true } }) : Promise.resolve(null));
  const save = async (postId: string | undefined, deduped: boolean) => {
    const main = await ownedMedia(user.id, body.mediaId);
    let changed = true;
    const existing = postId ? await ownedPost(user.id, postId) : null;
    // Phase 2: an edit made on an older copy than the one stored, that would overwrite a different change, waits for the creator.
    const theirs = existing ? draftConflict(existing, body, body.baseUpdatedAt, { replaceTargets: true }) : null;
    if (theirs) throw new HttpError(409, DRAFT_CONFLICT_MESSAGE, "draft_conflict", { server: theirs });
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
    if (existing) {
      if (["publishing", "published"].includes(existing.status)) throw new HttpError(409, "This one has already gone out.");
      changed = copyChanged(existing, body, { replaceTargets: true }) || existing.format !== format || itemsBefore !== itemsAfter;
    } else {
      postId = (await db.post.create({ data: { userId: user.id, mediaId: body.mediaId, title: body.title, story: body.story, storyMeta: body.storyMeta, hook: body.hook, format, clientKey: body.clientKey ?? null } })).id;
    }
    const id = postId!;
    try {
      await db.$transaction(async (tx) => {
        if (existing) {
          // With a base, the write only lands on the copy that was checked above: a save from another device in
          // between makes it a conflict instead of a silent overwrite.
          const n = await tx.post.updateMany({ where: { id, ...(body.baseUpdatedAt ? { updatedAt: existing.updatedAt } : {}) }, data: { mediaId: body.mediaId, title: body.title, story: body.story, storyMeta: body.storyMeta, hook: body.hook, format } });
          if (!n.count) throw new StaleDraftError();
        }
        if (!existing || itemsBefore !== itemsAfter) {
          await tx.postMedia.deleteMany({ where: { postId: id } });
          for (const [position, it] of items.entries()) await tx.postMedia.create({ data: { postId: id, mediaId: it.mediaId, position, altText: it.altText?.trim() || null } });
        }
        await tx.postTarget.deleteMany({ where: { postId: id, platform: { notIn: keepPlatforms(body.targets) } } });
        for (const t of body.targets) {
          const data = { title: t.title ?? null, caption: t.caption ?? null, description: t.description ?? null, hashtags: t.hashtags ?? null, firstComment: supportsFirstComment(t.platform) && takesFirstComment(format) ? (t.firstComment?.trim() || null) : null };
          const pin = pins[t.platform] ? { socialAccountId: pins[t.platform] } : {};
          await tx.postTarget.upsert({ where: { postId_platform: { postId: id, platform: t.platform } }, create: { postId: id, platform: t.platform, ...data, ...pin }, update: { ...data, ...pin } });
        }
      }, { timeout: 15_000 });
    } catch (e) {
      if (e instanceof StaleDraftError) throw new HttpError(409, DRAFT_CONFLICT_MESSAGE, "draft_conflict", { server: serverDraft(await ownedPost(user.id, id)) });
      throw e;
    }
    // R1234: only a draft this call created gets its Content Memory item (a clientKey twin or an update already has one).
    if (!existing) await lineageAfterCreate(user.id, id, { adaptedFromPostId: body.adaptedFromPostId, recommendationId: body.recommendationId });
    if (changed) await recordEdit(user, { id });
    return json({ post: await postView(await ownedPost(user.id, id)), ...(deduped ? { deduped: true } : {}) });
  };
  const twin = await twinOf();
  try {
    return await save(twin?.id ?? body.postId, !!twin);
  } catch (e) {
    // Two tries of the same sync raced: the unique (userId, clientKey) let one in, the other saves into it.
    const again = !twin && (e as { code?: string }).code === "P2002" ? await twinOf() : null;
    if (again) return save(again.id, true);
    throw e;
  }
});
