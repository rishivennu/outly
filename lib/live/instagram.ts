import "server-only";
import { httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import type { Headline, LivePost, PlatformDashboard, Series } from "./types";
import { shiftHours } from "./suggest";

const G = "https://graph.instagram.com/v21.0";
const DAY = 86400;

async function ig<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${G}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, `instagram ${path.split("?")[0]}`);
  return (await r.json()) as T;
}

type Totals = { data: { name: string; total_value?: { value: number } }[] };
type Daily = { data: { name: string; values?: { value: number; end_time: string }[] }[] };
type IgMedia = { id: string; caption?: string; media_type: string; media_product_type?: string; timestamp: string; permalink?: string; thumbnail_url?: string; media_url?: string; like_count?: number; comments_count?: number };

const tv = (t: Totals | null, k: string) => t?.data.find((d) => d.name === k)?.total_value?.value ?? null;
const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

export async function instagramDashboard(acct: AccountContext, timezone: string, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const t = acct.accessToken;
  const now = Math.floor(Date.now() / 1000);
  const totalsQ = (since: number, until: number, metrics: string) => `/me/insights?metric=${metrics}&period=day&metric_type=total_value&since=${since}&until=${until}`;
  const notes: PlatformDashboard["notes"] = [];

  // Profile first: if this fails the token is the problem and nothing else will work either.
  const me = await ig<{ username: string; name?: string; profile_picture_url?: string; biography?: string; followers_count?: number; follows_count?: number; media_count?: number }>(
    "/me?fields=user_id,username,name,profile_picture_url,biography,followers_count,follows_count,media_count",
    t,
  );

  const [cur, prev, reach, followers, online, countries, media] = await Promise.allSettled([
    ig<Totals>(totalsQ(now - rangeDays * DAY, now, "views,reach,profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves"), t),
    ig<Totals>(totalsQ(now - 2 * rangeDays * DAY, now - rangeDays * DAY, "views,reach,profile_views,accounts_engaged,total_interactions"), t),
    ig<Daily>(`/me/insights?metric=reach&period=day&since=${now - rangeDays * DAY}&until=${now}`, t),
    ig<Daily>(`/me/insights?metric=follower_count&period=day&since=${now - 29 * DAY}&until=${now - DAY}`, t),
    ig<{ data: { values?: { value: Record<string, number> }[] }[] }>("/me/insights?metric=online_followers&period=lifetime", t),
    ig<{ data: { total_value?: { breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[] }>(
      "/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=country",
      t,
    ),
    ig<{ data: IgMedia[] }>("/me/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count&limit=24", t),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>, what: string) => {
    if (r.status === "fulfilled") return r.value;
    notes.push({ level: "warning", text: `Instagram didn't return ${what} this time.`, detail: (r.reason as { technical?: string })?.technical ?? String(r.reason) });
    return null;
  };
  const c = ok(cur, "account insights");
  const p = ok(prev, "last period's insights");
  const followerSeries = ok(followers, "follower growth");
  const newFollowers = followerSeries?.data[0]?.values?.reduce((a, v) => a + v.value, 0) ?? null;

  const headline: Headline[] = [
    { key: "followers", label: "Followers", value: me.followers_count ?? null, hint: newFollowers !== null ? `+${newFollowers} in 28 days` : undefined },
    { key: "views", label: "Views", value: tv(c, "views"), delta: pct(tv(c, "views"), tv(p, "views")) },
    { key: "reach", label: "Accounts reached", value: tv(c, "reach"), delta: pct(tv(c, "reach"), tv(p, "reach")) },
    { key: "engaged", label: "Accounts engaged", value: tv(c, "accounts_engaged"), delta: pct(tv(c, "accounts_engaged"), tv(p, "accounts_engaged")) },
    { key: "interactions", label: "Interactions", value: tv(c, "total_interactions"), delta: pct(tv(c, "total_interactions"), tv(p, "total_interactions")), hint: c ? `${tv(c, "likes") ?? 0} likes · ${tv(c, "comments") ?? 0} comments · ${tv(c, "shares") ?? 0} shares · ${tv(c, "saves") ?? 0} saves` : undefined },
    { key: "profile", label: "Profile visits", value: tv(c, "profile_views"), delta: pct(tv(c, "profile_views"), tv(p, "profile_views")) },
  ];

  const day = (iso: string) => new Date(new Date(iso).getTime() - DAY * 1000).toISOString().slice(0, 10);
  const series: Series[] = [];
  const reachD = ok(reach, "daily reach");
  if (reachD?.data[0]?.values?.length) series.push({ key: "reach", label: "Reach", points: reachD.data[0].values.map((v) => ({ date: day(v.end_time), value: v.value })) });
  if (followerSeries?.data[0]?.values?.length) series.push({ key: "followers", label: "New followers", points: followerSeries.data[0].values.map((v) => ({ date: day(v.end_time), value: v.value })) });

  const on = ok(online, "when your followers are online");
  const raw = on?.data[0]?.values?.find((v) => v.value && Object.keys(v.value).length)?.value;
  const hours = raw ? shiftHours(raw, timezone) : undefined;

  const ctry = ok(countries, "follower countries");
  const results = ctry?.data[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const regionName = new Intl.DisplayNames(["en"], { type: "region" });
  const breakdown = results.length
    ? { title: "Where your followers are", items: [...results].sort((a, b) => b.value - a.value).slice(0, 6).map((r) => ({ label: safeRegion(regionName, r.dimension_values[0]), value: r.value })) }
    : undefined;

  const items = (ok(media, "your recent posts")?.data ?? []).filter((m) => m.media_product_type !== "STORY");
  // Per-post insights for the newest 16; older ones keep the counts the media endpoint already gave us.
  const insights = await Promise.allSettled(
    items.slice(0, 16).map((m) =>
      ig<{ data: { name: string; values: { value: number }[] }[] }>(
        `/${m.id}/insights?metric=${m.media_product_type === "REELS" ? "views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time" : "views,reach,likes,comments,shares,saved"}`,
        t,
      ),
    ),
  );
  const posts: LivePost[] = items.map((m, i) => {
    const ins = insights[i]?.status === "fulfilled" ? (insights[i] as PromiseFulfilledResult<{ data: { name: string; values: { value: number }[] }[] }>).value : null;
    const v = (k: string) => ins?.data.find((d) => d.name === k)?.values[0]?.value ?? null;
    const caption = m.caption ?? "";
    const watch = v("ig_reels_avg_watch_time");
    return {
      id: m.id,
      title: caption.split("\n")[0].trim() || (m.media_product_type === "REELS" ? "Untitled Reel" : "Untitled post"),
      thumb: m.thumbnail_url ?? (m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM" ? (m.media_url ?? null) : null),
      url: m.permalink ?? null,
      publishedAt: m.timestamp,
      format: m.media_product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carousels" : "Photos",
      views: v("views"),
      reach: v("reach"),
      likes: v("likes") ?? m.like_count ?? null,
      comments: v("comments") ?? m.comments_count ?? null,
      shares: v("shares"),
      saves: v("saved"),
      avgWatch: watch !== null ? watch / 1000 : null,
      captionLength: caption.length,
      hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });

  return {
    platform: "instagram",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: me.name || me.username, handle: `@${me.username}`, avatar: me.profile_picture_url ?? null, url: `https://www.instagram.com/${me.username}/`, bio: me.biography ?? null },
    headline,
    series,
    hours,
    breakdown,
    posts,
    notes,
  };
}

function safeRegion(d: Intl.DisplayNames, code?: string) {
  try {
    return (code && d.of(code)) || code || "Unknown";
  } catch {
    return code ?? "Unknown";
  }
}
