import { PLATFORM_META } from "./domain";
import "server-only";
import { inScope, type Scope } from "./profiles-core";
import { db } from "./db";
import { HttpError } from "./http";
import { liveAccount } from "./live/account";
import { instagramThreads, youtubeThreads, type AccountThread } from "./live/comments";
import { isPlatform, type ErrorCode, type Platform } from "./domain";
import { isPracticeAccount, publisherForAccount } from "./social/registry";
import { asPublisherError, type AccountContext, type PlatformComment, type SocialPublisher } from "./social/types";
import { mediaView } from "./services";
import { youtubeEmbed, type CommentMedia } from "./inbox-media";
import type { Media } from "@prisma/client";

/** Inbox ids for comments on the creator's own account (not published through Outlly): a:<accountId>:<mediaId>. */
export const accountTargetId = (accountId: string, mediaId: string) => `a:${accountId}:${mediaId}`;
export function parseAccountTarget(id: string) {
  const m = /^a:([^:]+):(.+)$/.exec(id);
  return m ? { accountId: m[1], mediaId: m[2] } : null;
}

export const COMMENT_CACHE_MS = 60_000;

export interface InboxComment extends PlatformComment {
  targetId: string;
  postId: string;
  platform: Platform;
  postTitle: string | null;
  postUrl: string | null;
  /** The reel or short this comment is on, for the 9:16 tile and the preview (1052). Only on top-level comments. */
  media?: CommentMedia | null;
}

export interface InboxProblem {
  targetId: string;
  platform: Platform;
  postTitle: string | null;
  code: ErrorCode;
  /** Raw platform detail, kept behind a disclosure in the UI. Never invented. */
  detail?: string;
  /** Plain-language explanation shown in the banner itself, when we know why. */
  hint?: string;
}

/** Per-target cache so flipping filters or re-opening the page doesn't burn the platform's rate limit. */
const g = globalThis as unknown as { __inboxCache?: Map<string, { at: number; comments: PlatformComment[] }> };
const cache = (g.__inboxCache ??= new Map());

export function cacheKey(targetId: string) {
  return `comments:${targetId}`;
}

export function invalidateComments(targetId: string) {
  cache.delete(cacheKey(targetId));
}

async function cachedComments(targetId: string, load: () => Promise<PlatformComment[]>, now = Date.now()) {
  const hit = cache.get(cacheKey(targetId));
  if (hit && now - hit.at < COMMENT_CACHE_MS) return hit.comments;
  const comments = await load();
  cache.set(cacheKey(targetId), { at: now, comments });
  return comments;
}

type LoadedTarget = {
  target: { id: string; postId: string; platform: Platform; platformPostId: string; platformUrl: string | null; postTitle: string | null; practice: boolean };
  account: AccountContext;
  publisher: SocialPublisher;
  /** Raw pieces for the preview; only signed when the post actually has comments. */
  source: { media: Media; caption: string | null; postedAt: Date | null; account: string | null };
};

/** Every published destination that still has a connected account behind it. */
async function publishedTargets(userId: string, platform?: Platform, scope: Scope = null) {
  const rows = await db.postTarget.findMany({
    // A post deleted from the platform has no comments left to read; a hidden (private) YouTube video still does.
    // 1037: a member limited to some accounts only sees destinations tied to one of theirs.
    where: { post: { userId }, platformStatus: "published", platformPostId: { not: null }, OR: [{ removeMode: null }, { removeMode: { not: "deleted" } }], ...(platform ? { platform } : {}), ...(scope ? { socialAccountId: { in: scope } } : {}) },
    include: { socialAccount: true, post: { select: { id: true, title: true, hook: true, media: true } } },
    orderBy: { publishedAt: "desc" },
    take: 60,
  });
  const out: LoadedTarget[] = [];
  const problems: InboxProblem[] = [];
  for (const t of rows) {
    if (!isPlatform(t.platform) || !t.platformPostId) continue;
    const title = t.post.title ?? t.post.hook?.split("\n")[0] ?? null;
    const acct = t.socialAccount;
    if (!acct || acct.status !== "connected") {
      problems.push({ targetId: t.id, platform: t.platform, postTitle: title, code: "NOT_CONNECTED" });
      continue;
    }
    let publisher: SocialPublisher;
    try {
      publisher = publisherForAccount(t.platform, acct);
    } catch (e) {
      problems.push({ targetId: t.id, platform: t.platform, postTitle: title, code: "NOT_CONNECTED", detail: (e as Error).message });
      continue;
    }
    let account: AccountContext;
    try {
      account = await liveAccount(acct);
    } catch (e) {
      const pe = asPublisherError(e);
      problems.push({ targetId: t.id, platform: t.platform, postTitle: title, code: pe.code === "UNKNOWN" ? "AUTH_EXPIRED" : pe.code, detail: pe.technical ?? pe.message });
      continue;
    }
    out.push({
      target: { id: t.id, postId: t.postId, platform: t.platform, platformPostId: t.platformPostId, platformUrl: t.platformUrl, postTitle: title, practice: isPracticeAccount(acct) },
      account,
      publisher,
      source: {
        media: t.post.media,
        caption: t.caption ?? t.description ?? t.title ?? t.post.hook ?? null,
        postedAt: t.publishedAt,
        account: acct.platform === "youtube" ? acct.displayName ?? acct.username : `@${acct.username}`,
      },
    });
  }
  return { targets: out, problems };
}

/** The file we uploaded is the original, so it plays first; YouTube's own player is the fallback. */
async function targetMedia(l: LoadedTarget): Promise<CommentMedia> {
  const { media: m, caption, postedAt, account } = l.source;
  const v = await mediaView(m);
  const image = m.mimeType.startsWith("image/");
  return {
    kind: image ? "image" : "video",
    thumbnailUrl: v.thumbnailUrl ?? (image ? v.url : null),
    videoUrl: image ? null : v.url,
    embedUrl: l.target.platform === "youtube" ? youtubeEmbed(l.target.platformPostId) : null,
    caption: caption?.trim() || null,
    width: m.width,
    height: m.height,
    postedAt: postedAt?.toISOString() ?? null,
    account,
  };
}

function flatten(l: LoadedTarget, comments: PlatformComment[], media: CommentMedia | null = null): InboxComment[] {
  const decorate = (c: PlatformComment): InboxComment => ({
    ...c,
    practice: c.practice ?? l.target.practice,
    targetId: l.target.id,
    postId: l.target.postId,
    platform: l.target.platform,
    postTitle: l.target.postTitle,
    postUrl: l.target.platformUrl,
  });
  return comments.map((c) => ({ ...decorate(c), media, replies: (c.replies ?? []).map(decorate) }));
}

/**
 * One inbox across every published destination. A platform that refuses is reported as a problem,
 * never as an empty thread — a real account must never be shown invented comments.
 */
export async function inbox(userId: string, platform?: Platform, scope: Scope = null) {
  const { targets, problems } = await publishedTargets(userId, platform, scope);
  const comments: InboxComment[] = [];
  const errors = [...problems];
  // Fetch every destination at once; results are folded back in the original order.
  const results = await Promise.allSettled(
    targets.map((l) =>
      l.publisher.listComments
        ? cachedComments(l.target.id, () => l.publisher.listComments!({ platformPostId: l.target.platformPostId, practice: l.target.practice }, l.account))
        : Promise.resolve(null),
    ),
  );
  // Sign media only for posts that have something to show; a missing file just means no preview.
  const media = await Promise.all(results.map((r, i) => (r.status === "fulfilled" && r.value?.length ? targetMedia(targets[i]).catch(() => null) : null)));
  results.forEach((r, i) => {
    const l = targets[i];
    if (r.status === "fulfilled") {
      if (r.value === null) {
        errors.push({ targetId: l.target.id, platform: l.target.platform, postTitle: l.target.postTitle, code: "FORBIDDEN", detail: `${l.target.platform} comments are not wired up yet.` });
      } else {
        comments.push(...flatten(l, r.value, media[i]));
      }
    } else {
      const pe = asPublisherError(r.reason);
      errors.push({ targetId: l.target.id, platform: l.target.platform, postTitle: l.target.postTitle, code: pe.code, detail: pe.technical ?? pe.message });
    }
  });
  // Then everything else on the creator's own accounts: comments on posts made outside Outlly.
  const skip = new Set(targets.map((l) => l.target.platformPostId));
  const own = await accountComments(userId, skip, platform, scope);
  comments.push(...own.comments);
  errors.push(...own.errors);
  comments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { comments, errors, targets: targets.length + own.threads };
}

const og = globalThis as unknown as { __ownCache?: Map<string, { at: number; threads: AccountThread[] }> };
const ownCache = (og.__ownCache ??= new Map());

const OWN_LOADERS: Partial<Record<Platform, (a: AccountContext, skip: Set<string>) => Promise<AccountThread[]>>> = {
  instagram: instagramThreads,
  youtube: youtubeThreads,
};

async function accountComments(userId: string, skip: Set<string>, platform?: Platform, scope: Scope = null) {
  const accts = await db.socialAccount.findMany({ where: { userId, status: "connected", ...(platform ? { platform } : {}), ...(scope ? { id: { in: scope } } : {}) } });
  const comments: InboxComment[] = [];
  const errors: InboxProblem[] = [];
  let threads = 0;
  await Promise.all(
    accts.map(async (a) => {
      if (!isPlatform(a.platform) || isPracticeAccount(a)) return;
      const load = OWN_LOADERS[a.platform];
      if (!load) return;
      const p = a.platform;
      try {
        const ctx = await liveAccount(a);
        const key = `own:${a.id}`;
        const hit = ownCache.get(key);
        const list: AccountThread[] = hit && Date.now() - hit.at < COMMENT_CACHE_MS ? hit.threads : await load(ctx, skip);
        if (!hit || hit.threads !== list) ownCache.set(key, { at: Date.now(), threads: list });
        const hidden = list.filter((th) => !th.comments.length && (th.expected ?? 0) > 0);
        if (hidden.length && hidden.length === list.length) {
          const n = hidden.reduce((s, th) => s + (th.expected ?? 0), 0);
          errors.push({
            targetId: `a:${a.id}`,
            platform: p,
            postTitle: null,
            code: "FORBIDDEN",
            hint: `${PLATFORM_META[p].name} counts ${n} comments on your last ${hidden.length} posts but sent back none. While a Meta app is in Development mode, Instagram only shares comments from people who have a role on the app. Switch the app to Live mode (it needs the instagram_business_manage_comments permission) and they will show up here.`,
          });
        }
        for (const th of list) {
          if (!th.comments.length) continue;
          threads++;
          const decorate = (c: PlatformComment): InboxComment => ({ ...c, practice: false, targetId: accountTargetId(a.id, th.mediaId), postId: "", platform: p, postTitle: th.title, postUrl: th.url });
          comments.push(...th.comments.map((c) => ({ ...decorate(c), media: th.media ?? null, replies: (c.replies ?? []).map(decorate) })));
        }
      } catch (e) {
        const pe = asPublisherError(e);
        errors.push({ targetId: `a:${a.id}`, platform: p, postTitle: null, code: pe.code, detail: pe.technical ?? pe.message });
      }
    }),
  );
  return { comments, errors, threads };
}

/** scope (1037): a member limited to some accounts gets the same 404 for any other account as for a missing one. */
export async function replyToComment(userId: string, targetId: string, commentId: string, text: string, scope: Scope = null) {
  const own = parseAccountTarget(targetId);
  if (own) {
    const acct = await db.socialAccount.findFirst({ where: { id: own.accountId, userId } });
    if (!acct || !isPlatform(acct.platform) || !inScope(scope, acct.id)) throw new HttpError(404, "We couldn't find that account.");
    if (acct.status !== "connected") throw new HttpError(409, "Reconnect the account first.", "NOT_CONNECTED");
    const publisher = publisherForAccount(acct.platform, acct);
    if (!publisher.replyToComment) throw new HttpError(409, "Replying isn't available for this platform yet.", "FORBIDDEN");
    const reply = await publisher.replyToComment(await liveAccount(acct), commentId, text);
    ownCache.delete(`own:${acct.id}`);
    return { ...reply, practice: false };
  }
  const t = await db.postTarget.findFirst({ where: { id: targetId, post: { userId } }, include: { socialAccount: true } });
  if (!t || !isPlatform(t.platform) || !inScope(scope, t.socialAccountId)) throw new HttpError(404, "We couldn't find that post.");
  const acct = t.socialAccount;
  if (!acct || acct.status !== "connected") throw new HttpError(409, "Reconnect the account first.", "NOT_CONNECTED");
  const publisher = publisherForAccount(t.platform, acct);
  if (!publisher.replyToComment) throw new HttpError(409, "Replying isn't available for this platform yet.", "FORBIDDEN");
  const reply = await publisher.replyToComment(await liveAccount(acct), commentId, text);
  // The thread changed, so the cached copy is stale.
  invalidateComments(targetId);
  return { ...reply, practice: reply.practice ?? isPracticeAccount(acct) };
}
