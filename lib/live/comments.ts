import { fmtHandle } from "@/lib/handle";
import "server-only";
import { httpFailure, type AccountContext, type PlatformComment } from "../social/types";
import { instagramMedia, threadsMedia, youtubeEmbed, youtubeThumb, type CommentMedia } from "../inbox-media";
import { threadsConversation } from "../social/threads";
import { collectPages, COMMENT_PAGES } from "../social/paging";

/** A post on the creator's own account that has comments, whether or not it went out through Outlly. */
export interface AccountThread {
  mediaId: string;
  title: string | null;
  url: string | null;
  comments: PlatformComment[];
  /** What the platform says the post has; lets us notice when it reports comments but returns none. */
  expected?: number;
  /** Thumbnail, playable file or player, and caption for the inbox preview (1052). */
  media?: CommentMedia | null;
}

const IG = "https://graph.instagram.com/v21.0";
const TH = "https://graph.threads.net/v1.0";
const YT = "https://www.googleapis.com/youtube/v3";

type IgC = { id: string; text?: string; username?: string; timestamp?: string; like_count?: number; replies?: { data?: IgC[] } };
const igC = (c: IgC, parentId: string | null = null): PlatformComment => ({
  id: c.id,
  text: c.text ?? "",
  authorName: fmtHandle(c.username) || "Someone on Instagram",
  createdAt: c.timestamp ?? new Date().toISOString(),
  likeCount: c.like_count,
  parentId,
});

/** Newest media that actually has comments; skips ids Outlly already tracks so nothing shows twice. */
export async function instagramThreads(acct: AccountContext, skip: Set<string>, maxPosts = 8): Promise<AccountThread[]> {
  const t = encodeURIComponent(acct.accessToken);
  const r = await fetch(`${IG}/me/media?fields=id,caption,permalink,comments_count,timestamp,media_type,media_url,thumbnail_url&limit=25&access_token=${t}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, "instagram media");
  type IgM = { id: string; caption?: string; permalink?: string; comments_count?: number; timestamp?: string; media_type?: string; media_url?: string; thumbnail_url?: string };
  const media = ((await r.json()) as { data?: IgM[] }).data ?? [];
  const handle = fmtHandle(acct.username) || null;
  const withComments = media.filter((m) => (m.comments_count ?? 0) > 0 && !skip.has(m.id)).slice(0, maxPosts);
  const fields = encodeURIComponent("id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}");
  const threads = await Promise.all(
    withComments.map(async (m) => {
      // P2: follow Graph's cursor past the first 50, so a busy post shows more than its newest page.
      const base = `${IG}/${m.id}/comments?fields=${fields}&limit=50&access_token=${t}`;
      const { items: data } = await collectPages<IgC>(async (after) => {
        const c = await fetch(after ? `${base}&after=${encodeURIComponent(after)}` : base, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
        if (!c.ok) throw await httpFailure(c, "instagram comments");
        const j = (await c.json()) as { data?: IgC[]; paging?: { next?: string; cursors?: { after?: string } } };
        return { items: j.data ?? [], next: (j.paging?.next && j.paging.cursors?.after) || null };
      }, COMMENT_PAGES.instagramAccount);
      return {
        mediaId: m.id,
        title: (m.caption ?? "").split("\n")[0].trim() || "Untitled post",
        url: m.permalink ?? null,
        expected: m.comments_count ?? 0,
        media: instagramMedia(m, handle),
        comments: data.map((x) => ({ ...igC(x), replies: (x.replies?.data ?? []).map((y) => igC(y, x.id)) })),
      };
    }),
  );
  return threads;
}

type YtC = { id: string; snippet: { textOriginal?: string; textDisplay?: string; authorDisplayName?: string; publishedAt?: string; likeCount?: number; parentId?: string } };
const ytC = (c: YtC): PlatformComment => ({
  id: c.id,
  text: c.snippet.textOriginal ?? c.snippet.textDisplay ?? "",
  authorName: c.snippet.authorDisplayName ?? "Someone on YouTube",
  createdAt: c.snippet.publishedAt ?? new Date().toISOString(),
  likeCount: c.snippet.likeCount,
  parentId: c.snippet.parentId ?? null,
});

/** Every recent comment across the channel in one call, grouped back into videos. */
export async function youtubeThreads(acct: AccountContext, skip: Set<string>): Promise<AccountThread[]> {
  const h = { authorization: `Bearer ${acct.accessToken}` };
  type YtT = { snippet: { videoId: string; topLevelComment: YtC }; replies?: { comments?: YtC[] } };
  // P2: 100 a page and follow nextPageToken, so a channel with a busy week is not cut at the newest 50.
  const { items } = await collectPages<YtT>(async (pageToken) => {
    const q = new URLSearchParams({ part: "snippet,replies", allThreadsRelatedToChannelId: acct.platformUserId, maxResults: "100", order: "time", ...(pageToken ? { pageToken } : {}) });
    const r = await fetch(`${YT}/commentThreads?${q}`, { headers: h, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!r.ok) throw await httpFailure(r, "youtube channel comments");
    const j = (await r.json()) as { items?: YtT[]; nextPageToken?: string };
    return { items: j.items ?? [], next: j.nextPageToken || null };
  }, COMMENT_PAGES.youtubeChannel);
  const byVideo = new Map<string, PlatformComment[]>();
  for (const it of items) {
    if (skip.has(it.snippet.videoId)) continue;
    const list = byVideo.get(it.snippet.videoId) ?? [];
    list.push({ ...ytC(it.snippet.topLevelComment), replies: (it.replies?.comments ?? []).map(ytC) });
    byVideo.set(it.snippet.videoId, list);
  }
  if (!byVideo.size) return [];
  const v = await fetch(`${YT}/videos?part=snippet,contentDetails&id=${[...byVideo.keys()].join(",")}`, { headers: h, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  type YtV = { id: string; snippet: { title: string; description?: string; publishedAt?: string; channelTitle?: string; thumbnails?: Parameters<typeof youtubeThumb>[0] } };
  const meta = new Map<string, YtV["snippet"]>();
  if (v.ok) for (const x of ((await v.json()) as { items?: YtV[] }).items ?? []) meta.set(x.id, x.snippet);
  return [...byVideo].map(([id, comments]) => {
    const sn = meta.get(id);
    const media: CommentMedia = {
      kind: "video",
      thumbnailUrl: youtubeThumb(sn?.thumbnails),
      videoUrl: null,
      embedUrl: youtubeEmbed(id),
      caption: [sn?.title, sn?.description?.trim()].filter(Boolean).join("\n\n") || null,
      width: null,
      height: null,
      postedAt: sn?.publishedAt ?? null,
      account: sn?.channelTitle ?? null,
    };
    return { mediaId: id, title: sn?.title ?? "A video on your channel", url: `https://www.youtube.com/watch?v=${id}`, comments, media };
  });
}

/**
 * 1252 Threads: the newest posts on the profile, each with its conversation (threads_read_replies). Threads
 * reports no reply count on a post, so the newest ones are asked directly and the quiet ones dropped.
 */
export async function threadsThreads(acct: AccountContext, skip: Set<string>, maxPosts = 8): Promise<AccountThread[]> {
  const t = encodeURIComponent(acct.accessToken);
  const r = await fetch(`${TH}/${acct.platformUserId}/threads?fields=id,text,permalink,timestamp,media_type,media_url,thumbnail_url&limit=25&access_token=${t}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, "threads posts");
  type ThM = { id: string; text?: string; permalink?: string; timestamp?: string; media_type?: string; media_url?: string; thumbnail_url?: string };
  const media = (((await r.json()) as { data?: ThM[] }).data ?? []).filter((m) => !skip.has(m.id)).slice(0, maxPosts);
  const handle = fmtHandle(acct.username) || null;
  const threads = await Promise.all(
    media.map(async (m) => ({
      mediaId: m.id,
      title: (m.text ?? "").split("\n")[0].trim() || "Untitled post",
      url: m.permalink ?? null,
      media: threadsMedia(m, handle),
      comments: await threadsConversation(m.id, acct.accessToken, COMMENT_PAGES.threadsAccount),
    })),
  );
  return threads.filter((th) => th.comments.length > 0);
}

