import "server-only";
import { httpFailure, type AccountContext, type PlatformComment } from "../social/types";

/** A post on the creator's own account that has comments, whether or not it went out through Outlly. */
export interface AccountThread {
  mediaId: string;
  title: string | null;
  url: string | null;
  comments: PlatformComment[];
  /** What the platform says the post has; lets us notice when it reports comments but returns none. */
  expected?: number;
}

const IG = "https://graph.instagram.com/v21.0";
const YT = "https://www.googleapis.com/youtube/v3";

type IgC = { id: string; text?: string; username?: string; timestamp?: string; like_count?: number; replies?: { data?: IgC[] } };
const igC = (c: IgC, parentId: string | null = null): PlatformComment => ({
  id: c.id,
  text: c.text ?? "",
  authorName: c.username ? `@${c.username}` : "Someone on Instagram",
  createdAt: c.timestamp ?? new Date().toISOString(),
  likeCount: c.like_count,
  parentId,
});

/** Newest media that actually has comments; skips ids Outlly already tracks so nothing shows twice. */
export async function instagramThreads(acct: AccountContext, skip: Set<string>, maxPosts = 8): Promise<AccountThread[]> {
  const t = encodeURIComponent(acct.accessToken);
  const r = await fetch(`${IG}/me/media?fields=id,caption,permalink,comments_count,timestamp&limit=25&access_token=${t}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, "instagram media");
  const media = ((await r.json()) as { data?: { id: string; caption?: string; permalink?: string; comments_count?: number }[] }).data ?? [];
  const withComments = media.filter((m) => (m.comments_count ?? 0) > 0 && !skip.has(m.id)).slice(0, maxPosts);
  const fields = encodeURIComponent("id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}");
  const threads = await Promise.all(
    withComments.map(async (m) => {
      const c = await fetch(`${IG}/${m.id}/comments?fields=${fields}&limit=50&access_token=${t}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
      if (!c.ok) throw await httpFailure(c, "instagram comments");
      const data = ((await c.json()) as { data?: IgC[] }).data ?? [];
      return {
        mediaId: m.id,
        title: (m.caption ?? "").split("\n")[0].trim() || "Untitled post",
        url: m.permalink ?? null,
        expected: m.comments_count ?? 0,
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
  const q = new URLSearchParams({ part: "snippet,replies", allThreadsRelatedToChannelId: acct.platformUserId, maxResults: "50", order: "time" });
  const r = await fetch(`${YT}/commentThreads?${q}`, { headers: h, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, "youtube channel comments");
  const items = ((await r.json()) as { items?: { snippet: { videoId: string; topLevelComment: YtC }; replies?: { comments?: YtC[] } }[] }).items ?? [];
  const byVideo = new Map<string, PlatformComment[]>();
  for (const it of items) {
    if (skip.has(it.snippet.videoId)) continue;
    const list = byVideo.get(it.snippet.videoId) ?? [];
    list.push({ ...ytC(it.snippet.topLevelComment), replies: (it.replies?.comments ?? []).map(ytC) });
    byVideo.set(it.snippet.videoId, list);
  }
  if (!byVideo.size) return [];
  const v = await fetch(`${YT}/videos?part=snippet,contentDetails&id=${[...byVideo.keys()].join(",")}`, { headers: h, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  const meta = new Map<string, string>();
  if (v.ok) for (const x of ((await v.json()) as { items?: { id: string; snippet: { title: string } }[] }).items ?? []) meta.set(x.id, x.snippet.title);
  return [...byVideo].map(([id, comments]) => ({ mediaId: id, title: meta.get(id) ?? "A video on your channel", url: `https://www.youtube.com/watch?v=${id}`, comments }));
}
