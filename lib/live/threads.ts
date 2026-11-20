import { fmtHandle } from "@/lib/handle";
import "server-only";
import { httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import type { Headline, LivePost, PlatformDashboard, Series } from "./types";

/**
 * 1251: Threads profile dashboard, read like Instagram's and Facebook's. The connected account is the Threads
 * profile (platformUserId = Threads user id, token = long-lived user token). Profile and the post list need
 * threads_basic; every number (views, likes, replies, reposts, quotes, shares, followers) needs
 * threads_manage_insights. Without it the counts show a dash and a note says to reconnect once.
 */
const G = "https://graph.threads.net/v1.0";
/** Threads has no insights before this day; asking for earlier dates is refused. */
const INSIGHTS_EPOCH_S = 1712991600;

async function th<T>(path: string, token: string, what: string): Promise<T> {
  const r = await fetch(`${G}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, what);
  return (await r.json()) as T;
}

type Profile = { id: string; username: string; name?: string; threads_profile_picture_url?: string; threads_biography?: string };
type Media = { id: string; media_type?: string; media_product_type?: string; text?: string; permalink?: string; timestamp: string; thumbnail_url?: string; media_url?: string };
type Insights = { data?: { name: string; period?: string; values?: { value: number; end_time?: string }[]; total_value?: { value: number } }[] };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** The one number a metric row carries: a lifetime total, else the newest value. */
const total = (ins: Insights | null, k: string) => {
  const row = ins?.data?.find((d) => d.name === k);
  if (!row) return null;
  if (row.total_value) return num(row.total_value.value);
  if (row.values?.length) return num(row.values.reduce((a, v) => a + (num(v.value) ?? 0), 0));
  return null;
};
const sumNullable = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

const formatOf = (m: Media) => (m.media_type === "VIDEO" ? "Video" : m.media_type === "IMAGE" ? "Photo" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Text");

export async function threadsDashboard(acct: AccountContext, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const t = acct.accessToken;
  const uid = acct.platformUserId;
  const notes: PlatformDashboard["notes"] = [];
  const until = Math.floor(Date.now() / 1000);
  const since = Math.max(INSIGHTS_EPOCH_S, until - rangeDays * 86400);

  const profileP = th<Profile>(`/${uid}?fields=id,username,name,threads_profile_picture_url,threads_biography`, t, "threads profile");
  // Account totals for the window. followers_count refuses a date range, so it travels alone.
  const windowP = th<Insights>(`/${uid}/threads_insights?metric=views,likes,replies,reposts,quotes&since=${since}&until=${until}`, t, "threads account insights");
  const followersP = th<Insights>(`/${uid}/threads_insights?metric=followers_count`, t, "threads followers");
  const mediaP = th<{ data?: Media[] }>(`/${uid}/threads?fields=id,media_type,media_product_type,text,permalink,timestamp,thumbnail_url,media_url&limit=24`, t, "threads posts");
  const perPostP = mediaP.then((r) => Promise.allSettled((r.data ?? []).slice(0, 12).map((m) => th<Insights>(`/${m.id}/insights?metric=views,likes,replies,reposts,quotes,shares`, t, "threads post insights"))));

  const [profileR, windowR, followersR, mediaR, perPostR] = await Promise.allSettled([profileP, windowP, followersP, mediaP, perPostP]);
  // The profile failing means the token is the problem: that error decides "reconnect" vs "try later".
  if (profileR.status === "rejected") throw profileR.reason;
  const p = profileR.value;

  let media: Media[] = [];
  if (mediaR.status === "fulfilled") media = mediaR.value.data ?? [];
  else notes.push({ level: "warning", text: "Threads didn't return your posts this time.", detail: (mediaR.reason as { technical?: string })?.technical ?? String(mediaR.reason) });

  const win = windowR.status === "fulfilled" ? windowR.value : null;
  const followers = followersR.status === "fulfilled" ? total(followersR.value, "followers_count") : null;
  const perPost = perPostR.status === "fulfilled" ? perPostR.value : [];
  const missed = perPost.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (!win && windowR.status === "rejected") {
    notes.push({
      level: "info",
      text: "Threads isn't sharing views and likes with Outlly yet. Reconnect Threads once to grant the insights permission.",
      detail: (windowR.reason as { technical?: string })?.technical ?? String(windowR.reason),
    });
  } else if (missed.length) {
    notes.push({
      level: "info",
      text: missed.length === perPost.length ? "Threads isn't sharing per-post numbers with Outlly yet. Reconnect Threads once to grant the insights permission." : `Threads didn't return numbers for ${missed.length} of your newest ${perPost.length} posts this time.`,
      detail: (missed[0].reason as { technical?: string })?.technical ?? String(missed[0].reason),
    });
  }

  const posts: LivePost[] = media.map((m, i) => {
    const ins = perPost[i]?.status === "fulfilled" ? (perPost[i] as PromiseFulfilledResult<Insights>).value : null;
    const n = (k: string) => total(ins, k);
    const text = (m.text ?? "").trim();
    // Threads counts reposts, quotes and shares apart; Outlly's one "shares" column is the three together.
    const spread = sumNullable([n("reposts"), n("quotes"), n("shares")]);
    return {
      id: m.id,
      title: (text.split("\n")[0] || `Untitled ${formatOf(m).toLowerCase()}`).slice(0, 120),
      thumb: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url ?? null : null),
      url: m.permalink ?? null,
      publishedAt: m.timestamp,
      format: formatOf(m),
      views: n("views"),
      likes: n("likes"),
      comments: n("replies"),
      shares: spread,
      captionLength: text.length,
      hashtags: (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });

  // Daily views for the chart, straight from the account insights (the only metric Threads gives per day).
  const viewsRow = win?.data?.find((d) => d.name === "views");
  const series: Series[] = viewsRow?.values?.length
    ? [{ key: "views", label: "Views", points: viewsRow.values.filter((v) => v.end_time && num(v.value) !== null).map((v) => ({ date: v.end_time!.slice(0, 10), value: v.value })) }]
    : [];

  const recent = posts.filter((x) => Date.now() - new Date(x.publishedAt).getTime() <= rangeDays * 864e5);
  const hint = recent.length ? `${recent.length} post${recent.length === 1 ? "" : "s"} in ${rangeDays} days` : `No posts in ${rangeDays} days`;
  const windowViews = total(win, "views");
  const headline: Headline[] = [
    { key: "followers", label: "Followers", value: followers },
    { key: "views", label: "Views", value: windowViews, hint: `Last ${rangeDays} days` },
    { key: "likes", label: "Likes", value: total(win, "likes"), hint: `Last ${rangeDays} days` },
    { key: "comments", label: "Replies", value: total(win, "replies"), hint: `Last ${rangeDays} days` },
    { key: "shares", label: "Reposts and quotes", value: sumNullable([total(win, "reposts"), total(win, "quotes")]), hint },
  ];

  return {
    platform: "threads",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: p.name || p.username, handle: fmtHandle(p.username) || p.username, avatar: p.threads_profile_picture_url ?? null, url: `https://www.threads.net/@${p.username}`, bio: p.threads_biography ?? null },
    headline,
    // Threads reports no all-time post count; the card falls back to the posts sent from Outlly and says so.
    totals: { followers, posts: null, views: windowViews, viewsScope: "28_days" },
    series,
    posts,
    notes,
  };
}
