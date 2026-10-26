import "server-only";
import { httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import type { Headline, LivePost, PlatformDashboard } from "./types";

// Facebook Page dashboard. The connected account IS the Page (platformUserId = Page id, token = Page token),
// so everything here is read with that token. Per-Reel plays need read_insights; without it the counts show a dash.
const G = "https://graph.facebook.com/v21.0";

async function fb<T>(path: string, token: string, what: string): Promise<T> {
  const r = await fetch(`${G}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, what);
  return (await r.json()) as T;
}

type Page = { id: string; name: string; username?: string; link?: string; about?: string; fan_count?: number; followers_count?: number; picture?: { data?: { url?: string } } };
type Count = { summary?: { total_count?: number } };
type Reel = { id: string; title?: string; description?: string; created_time: string; permalink_url?: string; length?: number; picture?: string; likes?: Count; comments?: Count };
type VideoInsights = { data: { name: string; values?: { value: number | Record<string, number> }[] }[] };

const abs = (u?: string) => (u ? (u.startsWith("http") ? u : `https://www.facebook.com${u}`) : null);

export async function facebookDashboard(acct: AccountContext, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const t = acct.accessToken;
  const page = acct.platformUserId;
  const notes: PlatformDashboard["notes"] = [];

  const pageP = fb<Page>(`/${page}?fields=id,name,username,link,about,fan_count,followers_count,picture{url}`, t, "facebook page");
  const reelsP = fb<{ data?: Reel[] }>(
    `/${page}/video_reels?fields=id,title,description,created_time,permalink_url,length,picture,likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=24`,
    t,
    "facebook reels",
  ).catch(() =>
    // Some Pages refuse the like/comment summaries; the list alone is still worth showing.
    fb<{ data?: Reel[] }>(`/${page}/video_reels?fields=id,title,description,created_time,permalink_url,length,picture&limit=24`, t, "facebook reels"),
  );
  const insightsP = reelsP.then((r) =>
    Promise.allSettled((r.data ?? []).slice(0, 12).map((v) => fb<VideoInsights>(`/${v.id}/video_insights?metric=fb_reels_total_plays,post_impressions_unique,post_video_avg_time_watched`, t, "facebook reel insights"))),
  );
  const [pageR, reelsR, insightsR] = await Promise.allSettled([pageP, reelsP, insightsP]);
  // The Page itself failing means the token is the problem: report that error (it decides "reconnect" vs "try later").
  if (pageR.status === "rejected") throw pageR.reason;
  const p = pageR.value;

  let reels: Reel[] = [];
  if (reelsR.status === "fulfilled") reels = reelsR.value.data ?? [];
  else notes.push({ level: "warning", text: "Facebook didn't return your Reels this time.", detail: (reelsR.reason as { technical?: string })?.technical ?? String(reelsR.reason) });

  const insights = insightsR.status === "fulfilled" ? insightsR.value : [];
  const missed = insights.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (missed.length)
    notes.push({
      level: "info",
      text:
        missed.length === insights.length
          ? "Facebook isn't sharing play counts with Outlly yet. Reconnect Facebook once to grant the insights permission."
          : `Facebook didn't return play counts for ${missed.length} of your newest ${insights.length} Reels this time.`,
      detail: (missed[0].reason as { technical?: string })?.technical ?? String(missed[0].reason),
    });

  const posts: LivePost[] = reels.map((r, i) => {
    const ins = insights[i]?.status === "fulfilled" ? (insights[i] as PromiseFulfilledResult<VideoInsights>).value : null;
    const n = (k: string) => {
      const v = ins?.data.find((d) => d.name === k)?.values?.[0]?.value;
      return typeof v === "number" ? v : null;
    };
    const text = (r.description ?? "").trim();
    const watch = n("post_video_avg_time_watched");
    return {
      id: r.id,
      title: (r.title || text.split("\n")[0] || "Untitled Reel").slice(0, 120),
      thumb: r.picture ?? null,
      url: abs(r.permalink_url),
      publishedAt: r.created_time,
      format: "Reels",
      duration: r.length ?? null,
      views: n("fb_reels_total_plays"),
      reach: n("post_impressions_unique"),
      likes: r.likes?.summary?.total_count ?? null,
      comments: r.comments?.summary?.total_count ?? null,
      avgWatch: watch !== null ? watch / 1000 : null,
      captionLength: text.length,
      hashtags: (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });

  const recent = posts.filter((x) => Date.now() - new Date(x.publishedAt).getTime() <= rangeDays * 864e5);
  const sum = (k: "views" | "likes" | "comments") => (recent.some((x) => x[k] !== null) ? recent.reduce((a, x) => a + (x[k] ?? 0), 0) : null);
  const hint = recent.length ? `${recent.length} Reel${recent.length === 1 ? "" : "s"} in ${rangeDays} days` : `No Reels in ${rangeDays} days`;
  const headline: Headline[] = [
    { key: "followers", label: "Followers", value: p.followers_count ?? null },
    { key: "fans", label: "Page likes", value: p.fan_count ?? null },
    { key: "views", label: "Reel plays", value: sum("views"), hint },
    { key: "likes", label: "Reactions", value: sum("likes"), hint },
    { key: "comments", label: "Comments", value: sum("comments"), hint },
  ];

  return {
    platform: "facebook",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: p.name, handle: p.username ? `@${p.username}` : p.name, avatar: p.picture?.data?.url ?? null, url: p.link ?? `https://www.facebook.com/${p.id}`, bio: p.about ?? null },
    headline,
    series: [],
    posts,
    notes,
  };
}
