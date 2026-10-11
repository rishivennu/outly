import "server-only";
import { httpFailure } from "../social/types";
import type { AccountContext } from "../social/types";
import type { Headline, LivePost, PlatformDashboard, Series } from "./types";

const API = "https://www.googleapis.com/youtube/v3";
const YTA = "https://youtubeanalytics.googleapis.com/v2/reports";

async function yt<T>(url: string, token: string, what: string): Promise<T> {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!r.ok) throw await httpFailure(r, what);
  return (await r.json()) as T;
}

/** ISO 8601 duration (PT1M3S) to seconds. */
export function isoSeconds(d?: string) {
  const m = d?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + +(m[4] ?? 0);
}

type Report = { columnHeaders: { name: string }[]; rows?: (string | number)[][] };
const col = (r: Report | null, name: string) => r?.columnHeaders.findIndex((h) => h.name === name) ?? -1;
const total = (r: Report | null, name: string) => {
  const i = col(r, name);
  return r && i >= 0 && r.rows?.[0] ? Number(r.rows[0][i]) : null;
};
const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function youtubeDashboard(acct: AccountContext, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const t = acct.accessToken;
  const notes: PlatformDashboard["notes"] = [];
  const ch = await yt<{ items?: { id: string; snippet: { title: string; description?: string; customUrl?: string; thumbnails?: { default?: { url: string }; medium?: { url: string } } }; statistics: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    `${API}/channels?part=snippet,statistics,contentDetails&mine=true`,
    t,
    "youtube channel",
  );
  const c = ch.items?.[0];
  if (!c) return { platform: "youtube", status: "error", message: "This Google account has no YouTube channel yet.", fetchedAt: new Date().toISOString(), rangeDays, headline: [], series: [], posts: [], notes };

  const end = new Date();
  const start = new Date(end.getTime() - (rangeDays - 1) * 864e5);
  const pEnd = new Date(start.getTime() - 864e5);
  const pStart = new Date(pEnd.getTime() - (rangeDays - 1) * 864e5);
  const metrics = "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares";
  const rep = (s: Date, e: Date, extra = "") => `${YTA}?ids=channel==MINE&startDate=${ymd(s)}&endDate=${ymd(e)}&metrics=${metrics}${extra}`;

  const [uploads, daily, cur, prev, perVideo] = await Promise.allSettled([
    yt<{ items?: { contentDetails: { videoId: string } }[] }>(`${API}/playlistItems?part=contentDetails&maxResults=24&playlistId=${c.contentDetails.relatedPlaylists.uploads}`, t, "youtube uploads"),
    yt<Report>(rep(start, end, "&dimensions=day&sort=day"), t, "youtube analytics daily"),
    yt<Report>(rep(start, end), t, "youtube analytics"),
    yt<Report>(rep(pStart, pEnd), t, "youtube analytics previous"),
    yt<Report>(`${YTA}?ids=channel==MINE&startDate=2005-04-23&endDate=${ymd(end)}&metrics=views,averageViewDuration,averageViewPercentage&dimensions=video&sort=-views&maxResults=50`, t, "youtube analytics per video"),
  ]);
  let analyticsOff = false;
  const ok = <T,>(r: PromiseSettledResult<T>, what: string, analytics = false) => {
    if (r.status === "fulfilled") return r.value;
    const technical = (r.reason as { technical?: string })?.technical ?? String(r.reason);
    if (analytics && /accessNotConfigured|has not been used|disabled|insufficient|scope/i.test(technical)) {
      if (!analyticsOff) notes.push({ level: "warning", text: "Watch time and daily views need the YouTube Analytics API. Turn it on in Google Cloud, then reconnect YouTube so we can ask for it.", detail: technical });
      analyticsOff = true;
    } else if (!analytics || !analyticsOff) notes.push({ level: "warning", text: `YouTube didn't return ${what} this time.`, detail: technical });
    return null;
  };
  const up = ok(uploads, "your uploads");
  const d = ok(daily, "daily analytics", true);
  const cu = ok(cur, "analytics", true);
  const pr = ok(prev, "last period's analytics", true);
  const pv = ok(perVideo, "per-video retention", true);

  const ids = (up?.items ?? []).map((i) => i.contentDetails.videoId);
  const vids = ids.length
    ? await yt<{ items?: { id: string; snippet: { title: string; description?: string; publishedAt: string; thumbnails?: { medium?: { url: string }; high?: { url: string } } }; statistics: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails: { duration?: string } }[] }>(
        `${API}/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`,
        t,
        "youtube videos",
      ).catch((e) => {
        notes.push({ level: "warning", text: "YouTube didn't return your video stats this time.", detail: (e as { technical?: string }).technical });
        return null;
      })
    : null;

  const retention = new Map<string, { avg: number; pct: number }>();
  if (pv?.rows) {
    const iv = col(pv, "video"), ia = col(pv, "averageViewDuration"), ip = col(pv, "averageViewPercentage");
    for (const row of pv.rows) retention.set(String(row[iv]), { avg: Number(row[ia]), pct: Number(row[ip]) });
  }

  const posts: LivePost[] = (vids?.items ?? []).map((v) => {
    const dur = isoSeconds(v.contentDetails.duration);
    const r = retention.get(v.id);
    return {
      id: v.id,
      title: v.snippet.title,
      thumb: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.high?.url ?? null,
      url: dur !== null && dur <= 180 ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
      publishedAt: v.snippet.publishedAt,
      format: dur !== null && dur <= 180 ? "Shorts" : "Long videos",
      duration: dur,
      views: v.statistics.viewCount !== undefined ? Number(v.statistics.viewCount) : null,
      likes: v.statistics.likeCount !== undefined ? Number(v.statistics.likeCount) : null,
      comments: v.statistics.commentCount !== undefined ? Number(v.statistics.commentCount) : null,
      avgWatch: r?.avg ?? null,
      captionLength: v.snippet.title.length,
      hashtags: ((v.snippet.title + " " + (v.snippet.description ?? "")).match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });

  const gained = total(cu, "subscribersGained");
  const lost = total(cu, "subscribersLost");
  const minutes = total(cu, "estimatedMinutesWatched");
  const headline: Headline[] = [
    { key: "subscribers", label: "Subscribers", value: c.statistics.hiddenSubscriberCount ? null : Number(c.statistics.subscriberCount ?? 0), hint: gained !== null ? `+${gained} / -${lost ?? 0} in ${rangeDays} days` : c.statistics.hiddenSubscriberCount ? "Hidden on your channel" : undefined },
    { key: "views", label: "Views", value: total(cu, "views"), delta: pct(total(cu, "views"), total(pr, "views")), hint: cu ? undefined : `${Number(c.statistics.viewCount ?? 0).toLocaleString("en-US")} all-time` },
    { key: "watch", label: "Watch time (hours)", value: minutes !== null ? Math.round(minutes / 60) : null, delta: pct(minutes, total(pr, "estimatedMinutesWatched")) },
    { key: "avd", label: "Avg view duration", value: total(cu, "averageViewDuration"), format: "duration", delta: pct(total(cu, "averageViewDuration"), total(pr, "averageViewDuration")) },
    { key: "net", label: "Net subscribers", value: gained !== null ? gained - (lost ?? 0) : null, delta: pct(gained !== null ? gained - (lost ?? 0) : null, total(pr, "subscribersGained") !== null ? total(pr, "subscribersGained")! - (total(pr, "subscribersLost") ?? 0) : null) },
    { key: "videos", label: "Videos", value: Number(c.statistics.videoCount ?? 0), hint: `${Number(c.statistics.viewCount ?? 0).toLocaleString("en-US")} views all-time` },
  ];

  const series: Series[] = [];
  if (d?.rows?.length) {
    const di = col(d, "day"), vi = col(d, "views"), si = col(d, "subscribersGained"), mi = col(d, "estimatedMinutesWatched");
    series.push({ key: "views", label: "Views", points: d.rows.map((r) => ({ date: String(r[di]), value: Number(r[vi]) })) });
    series.push({ key: "watch", label: "Minutes watched", points: d.rows.map((r) => ({ date: String(r[di]), value: Number(r[mi]) })) });
    series.push({ key: "subs", label: "Subscribers gained", points: d.rows.map((r) => ({ date: String(r[di]), value: Number(r[si]) })) });
  }

  return {
    platform: "youtube",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: {
      name: c.snippet.title,
      handle: c.snippet.customUrl ?? c.snippet.title,
      avatar: c.snippet.thumbnails?.medium?.url ?? c.snippet.thumbnails?.default?.url ?? null,
      url: c.snippet.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
      bio: c.snippet.description?.split("\n")[0] ?? null,
    },
    headline,
    series,
    posts,
    notes,
  };
}
