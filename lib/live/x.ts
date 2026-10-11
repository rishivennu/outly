import "server-only";
import { httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import type { LivePost, PlatformDashboard } from "./types";

const API = "https://api.x.com/2";

async function x<T>(path: string, token: string, what: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, what);
  return (await r.json()) as T;
}

type Tweet = { id: string; text: string; created_at: string; public_metrics?: { like_count: number; reply_count: number; retweet_count: number; quote_count: number; impression_count?: number }; attachments?: { media_keys?: string[] } };

export async function xDashboard(acct: AccountContext, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const notes: PlatformDashboard["notes"] = [];
  const me = await x<{ data: { id: string; name: string; username: string; profile_image_url?: string; description?: string; public_metrics?: { followers_count: number; following_count: number; tweet_count: number } } }>(
    "/users/me?user.fields=public_metrics,profile_image_url,description",
    acct.accessToken,
    "x profile",
  );
  const u = me.data;
  let tweets: { data?: Tweet[]; includes?: { media?: { media_key: string; preview_image_url?: string; url?: string; type: string }[] } } | null = null;
  try {
    tweets = await x(`/users/${u.id}/tweets?max_results=20&exclude=retweets,replies&tweet.fields=public_metrics,created_at,attachments&expansions=attachments.media_keys&media.fields=preview_image_url,url,type`, acct.accessToken, "x posts");
  } catch (e) {
    notes.push({ level: "warning", text: "X didn't return your recent posts. Reading posts needs a paid X API tier.", detail: (e as { technical?: string }).technical });
  }
  const media = new Map((tweets?.includes?.media ?? []).map((m) => [m.media_key, m]));
  const posts: LivePost[] = (tweets?.data ?? []).map((t) => {
    const m = t.attachments?.media_keys?.map((k) => media.get(k)).find(Boolean);
    const pm = t.public_metrics;
    return {
      id: t.id,
      title: t.text.split("\n")[0].slice(0, 120),
      thumb: m?.preview_image_url ?? m?.url ?? null,
      url: `https://x.com/${u.username}/status/${t.id}`,
      publishedAt: t.created_at,
      format: m?.type === "video" ? "Videos" : m ? "Images" : "Text posts",
      views: pm?.impression_count ?? null,
      likes: pm?.like_count ?? null,
      comments: pm?.reply_count ?? null,
      shares: pm ? pm.retweet_count + pm.quote_count : null,
      captionLength: t.text.length,
      hashtags: (t.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });
  const sum = (k: "views" | "likes" | "comments" | "shares") => (posts.length ? posts.reduce((a, p) => a + (p[k] ?? 0), 0) : null);
  return {
    platform: "x",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: u.name, handle: `@${u.username}`, avatar: u.profile_image_url ?? null, url: `https://x.com/${u.username}`, bio: u.description ?? null },
    headline: [
      { key: "followers", label: "Followers", value: u.public_metrics?.followers_count ?? null },
      { key: "posts", label: "Posts", value: u.public_metrics?.tweet_count ?? null },
      { key: "views", label: "Impressions", value: sum("views"), hint: posts.length ? `Last ${posts.length} posts` : undefined },
      { key: "likes", label: "Likes", value: sum("likes"), hint: posts.length ? `Last ${posts.length} posts` : undefined },
      { key: "replies", label: "Replies", value: sum("comments") },
      { key: "reposts", label: "Reposts + quotes", value: sum("shares") },
    ],
    series: [],
    posts,
    notes,
  };
}
