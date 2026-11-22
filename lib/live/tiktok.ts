import { fmtHandle } from "@/lib/handle";
import "server-only";
import { httpFailure, PublisherError } from "../social/types";
import type { AccountContext } from "../social/types";
import type { LivePost, PlatformDashboard } from "./types";

/**
 * 1296: TikTok dashboard, read with the Display API. The connected account is the creator (platformUserId =
 * open_id, token = Login Kit user token). Profile and the follower / likes / video totals need user.info.basic +
 * user.info.stats; the video list with its view, like, comment and share counts needs video.list. A creator who
 * connected before those scopes existed gets the profile only and a note asking them to reconnect once.
 */
const API = "https://open.tiktokapis.com/v2";
const USER_FIELDS = "open_id,avatar_url,display_name,username,bio_description,profile_deep_link,follower_count,following_count,likes_count,video_count";
const VIDEO_FIELDS = "id,title,video_description,duration,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count";

type TikTokError = { code?: string; message?: string; log_id?: string };
type User = { open_id: string; avatar_url?: string; display_name?: string; username?: string; bio_description?: string; profile_deep_link?: string; follower_count?: number; following_count?: number; likes_count?: number; video_count?: number };
type Video = { id: string; title?: string; video_description?: string; duration?: number; cover_image_url?: string; share_url?: string; create_time?: number; like_count?: number; comment_count?: number; share_count?: number; view_count?: number };

/** TikTok answers 200 with error.code != "ok" for a missing scope or a bad token; both read like an HTTP failure here. */
async function tt<T>(path: string, token: string, what: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json; charset=UTF-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!r.ok) throw await httpFailure(r, what);
  const j = (await r.json()) as { data?: T; error?: TikTokError };
  const code = j.error?.code ?? "ok";
  if (code !== "ok") {
    const technical = `${what}: ${code} ${j.error?.message ?? ""} (log_id ${j.error?.log_id ?? "-"})`;
    if (/access_token|token|unauthori|invalid_grant/i.test(code)) throw new PublisherError("AUTH_EXPIRED", "Authorization expired", technical, false);
    if (/scope|permission/i.test(`${code} ${j.error?.message ?? ""}`)) throw new PublisherError("FORBIDDEN", "TikTok refused this permission", technical, false);
    if (/rate|limit/i.test(code)) throw new PublisherError("RATE_LIMITED", "Rate limited", technical);
    throw new PublisherError("UNKNOWN", "TikTok didn't answer", technical);
  }
  return (j.data ?? {}) as T;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function tiktokDashboard(acct: AccountContext, rangeDays = 28): Promise<Omit<PlatformDashboard, "suggestions">> {
  const notes: PlatformDashboard["notes"] = [];
  // The profile failing means the token is the problem: that error decides "reconnect" vs "try later".
  const { user: u } = await tt<{ user?: User }>(`/user/info/?fields=${USER_FIELDS}`, acct.accessToken, "tiktok profile").then((d) => ({ user: d.user ?? ({ open_id: acct.platformUserId } as User) }));

  let videos: Video[] = [];
  try {
    const page = await tt<{ videos?: Video[]; cursor?: number; has_more?: boolean }>(`/video/list/?fields=${VIDEO_FIELDS}`, acct.accessToken, "tiktok videos", { max_count: 20 });
    videos = page.videos ?? [];
  } catch (e) {
    const pe = e as PublisherError;
    if (pe.code === "AUTH_EXPIRED") throw e;
    notes.push({
      level: pe.code === "FORBIDDEN" ? "info" : "warning",
      text: pe.code === "FORBIDDEN" ? "TikTok isn't sharing your videos with Outlly yet. Reconnect TikTok once to grant the video list permission." : "TikTok didn't return your videos this time.",
      detail: pe.technical ?? String(e),
    });
  }

  const posts: LivePost[] = videos.map((v) => {
    const text = (v.video_description ?? v.title ?? "").trim();
    return {
      id: v.id,
      title: ((v.title ?? text).split("\n")[0] || "Untitled video").slice(0, 120),
      thumb: v.cover_image_url ?? null,
      url: v.share_url ?? null,
      publishedAt: new Date((v.create_time ?? 0) * 1000).toISOString(),
      format: "Videos",
      duration: num(v.duration),
      views: num(v.view_count),
      likes: num(v.like_count),
      comments: num(v.comment_count),
      shares: num(v.share_count),
      captionLength: text.length,
      hashtags: (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    };
  });
  // Only a sum of numbers TikTok actually sent: videos without a count make it null, never 0.
  const sum = (k: "views" | "likes" | "comments" | "shares") => (posts.some((p) => p[k] !== null) ? posts.reduce((a, p) => a + (p[k] ?? 0), 0) : null);
  const recent = posts.filter((p) => Date.now() - new Date(p.publishedAt).getTime() <= rangeDays * 864e5);
  const hint = posts.length ? `Last ${posts.length} videos` : undefined;
  const handle = u.username ? fmtHandle(u.username) : (acct.username || "TikTok");
  const url = u.profile_deep_link ?? (u.username ? `https://www.tiktok.com/@${u.username}` : null);
  if (u.follower_count === undefined && u.likes_count === undefined) {
    notes.push({ level: "info", text: "TikTok isn't sharing follower and like totals with Outlly yet. Reconnect TikTok once to grant the stats permission." });
  }

  return {
    platform: "tiktok",
    status: "ok",
    fetchedAt: new Date().toISOString(),
    rangeDays,
    profile: { name: u.display_name ?? handle, handle, avatar: u.avatar_url ?? null, url, bio: u.bio_description ?? null },
    headline: [
      { key: "followers", label: "Followers", value: num(u.follower_count) },
      { key: "likes_total", label: "Total likes", value: num(u.likes_count) },
      { key: "videos", label: "Videos", value: num(u.video_count) },
      { key: "views", label: "Views", value: sum("views"), hint },
      { key: "likes", label: "Likes", value: sum("likes"), hint },
      { key: "comments", label: "Comments", value: sum("comments"), hint },
      { key: "shares", label: "Shares", value: sum("shares"), hint },
      { key: "recent", label: `Posted in ${rangeDays} days`, value: recent.length },
    ],
    totals: { followers: num(u.follower_count), posts: num(u.video_count), views: sum("views"), viewsScope: "recent_posts" },
    series: [],
    posts,
    notes,
  };
}
