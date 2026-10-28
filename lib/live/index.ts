import "server-only";
import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "../db";
import { env } from "../env";
import { PLATFORM_META, type Platform } from "../domain";
import { gemini } from "../ai/creative";
import { canConnectWithToken, hasCredentials, isPracticeAccount, loadKeys } from "../social/registry";
import { asPublisherError } from "../social/types";
import { liveAccount } from "./account";
import { instagramDashboard } from "./instagram";
import { youtubeDashboard } from "./youtube";
import { xDashboard } from "./x";
import { facebookDashboard } from "./facebook";
import { outllyDashboard } from "./outlly";
import { suggest } from "./suggest";
import type { PlatformDashboard, Suggestion } from "./types";

export type { PlatformDashboard } from "./types";

/** Live numbers are cached briefly so refreshes and tab switches don't burn the platform's quota. */
export const LIVE_CACHE_MS = 90_000;
/** Older than this, a shared copy is not worth showing even for a moment: fetch fresh instead. */
const SHARED_MAX_AGE_MS = 10 * 60_000;
const g = globalThis as unknown as { __liveCache?: Map<string, { at: number; data: PlatformDashboard }>; __ideaCache?: Map<string, { at: number; sig: string; ideas: Suggestion[] }> };
const cache = (g.__liveCache ??= new Map());
const ideaCache = (g.__ideaCache ??= new Map());
const IDEAS_MS = 6 * 60 * 60_000;

export function invalidateDashboards(userId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
  for (const k of ideaCache.keys()) if (k.startsWith(`${userId}:`)) ideaCache.delete(k);
  try {
    revalidateTag(`live:${userId}`);
  } catch {
    /* outside a request (tests, scripts): only this instance's copy existed */
  }
}

/**
 * Second level, shared by every serverless instance (the Next data cache). The first request after a
 * cold start or on another route (the home strip vs the dashboard page) reads it instead of calling
 * the platform again. Stale entries are served at once and refreshed in the background.
 */
function sharedRemote(userId: string, platform: Platform, tz: string, load: () => Promise<PlatformDashboard>, accountId: string | null = null) {
  // tz is part of the key: the hours chart and the coaching depend on it, and a settings change must not reuse the old copy.
  return unstable_cache(load, ["live-dash-v2", userId, platform, tz, accountId ?? "default"], { revalidate: LIVE_CACHE_MS / 1000, tags: [`live:${userId}`, `live:${userId}:${platform}`] })().catch(noDataCache(load));
}

/** Outside a Next request (tests, scripts) there is no data cache: just run the loader. Real failures pass through. */
const noDataCache = <T,>(load: () => Promise<T>) => (e: unknown) => {
  if (/incrementalCache missing/.test(String((e as Error)?.message))) return load();
  throw e;
};

function empty(platform: Platform, status: PlatformDashboard["status"], message: string, connect?: PlatformDashboard["connect"]): PlatformDashboard {
  return { platform, status, message, connect, fetchedAt: new Date().toISOString(), rangeDays: 28, headline: [], series: [], posts: [], notes: [], suggestions: [] };
}

export async function platformDashboard(userId: string, platform: Platform, opts: { fresh?: boolean; accountId?: string | null } = {}): Promise<PlatformDashboard> {
  // 1037: a manager with several accounts on one platform sees the picked one's numbers.
  const acctId = opts.accountId ?? null;
  const key = `${userId}:${platform}${acctId ? `:${acctId}` : ""}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.data;

  const name = PLATFORM_META[platform].name;
  await loadKeys();
  const connect = { oauth: hasCredentials(platform), token: canConnectWithToken(platform) };
  const [user, acct] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    db.socialAccount.findFirst({ where: { userId, platform, status: { not: "disconnected" }, ...(acctId ? { id: acctId } : {}) }, orderBy: { createdAt: "desc" } }),
  ]);
  const tz = user?.timezone || "UTC";

  if (!acct || isPracticeAccount(acct)) {
    if (!connect.oauth && !connect.token)
      return empty(platform, "not_configured", `${name} needs developer keys before anyone can connect. Add ${platform.toUpperCase()}_CLIENT_ID and ${platform.toUpperCase()}_CLIENT_SECRET to the server's .env.`, connect);
    return empty(platform, "not_connected", `Connect your ${name} account to see live numbers here.`, connect);
  }
  if (acct.status === "needs_reconnect") return empty(platform, "needs_reconnect", `${name} asked you to sign in again before it shares more numbers.`, connect);

  const load = async (): Promise<PlatformDashboard> => {
    // Each platform's token only works on its own API. Platforms without a reader get Outlly's own record,
    // never another platform's endpoint (a Facebook token on X's API answered 401: "connection expired").
    if (platform === "threads" || platform === "linkedin" || platform === "tiktok") {
      const base = await outllyDashboard(userId, platform, acct);
      return { ...base, suggestions: [] };
    }
    const ctx = await liveAccount(acct);
    const base =
      platform === "instagram" ? await instagramDashboard(ctx, tz) : platform === "youtube" ? await youtubeDashboard(ctx) : platform === "facebook" ? await facebookDashboard(ctx) : await xDashboard(ctx);
    // Rule-based coaching only: the Gemini ideas are fetched separately (platformIdeas) so a slow model
    // never holds the numbers back. Throwing here keeps a failure out of every cache.
    return { ...base, suggestions: suggest({ platform, posts: base.posts, series: base.series, hours: base.hours, timezone: tz }) };
  };

  let data: PlatformDashboard;
  try {
    data = opts.fresh ? await load() : await sharedRemote(userId, platform, tz, load, acctId);
    if (!opts.fresh && Date.now() - new Date(data.fetchedAt).getTime() > SHARED_MAX_AGE_MS) data = await load();
  } catch (e) {
    const pe = asPublisherError(e);
    if (pe.code === "AUTH_EXPIRED") return empty(platform, "needs_reconnect", `${name} says the connection expired. Reconnect to keep the numbers live.`, connect);
    data = { ...empty(platform, "error", `${name} didn't answer just now. We'll try again on the next refresh.`, connect), notes: [{ level: "warning", text: pe.message, detail: pe.technical }] };
    return data; // never cache a failure
  }
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return data;
}

/**
 * Up to three Gemini ideas on top of the rule-based ones, asked for after the dashboard has rendered.
 * Remembered per creator until their posts' numbers move, so the model is called a few times a day, not per view.
 */
export async function platformIdeas(userId: string, platform: Platform): Promise<Suggestion[]> {
  const d = await platformDashboard(userId, platform);
  if (d.status !== "ok") return [];
  const sig = createHash("sha256").update(JSON.stringify(d.posts.slice(0, 12).map((p) => [p.id, p.views, p.likes, p.comments]))).digest("base64url").slice(0, 16);
  const key = `${userId}:${platform}`;
  const hit = ideaCache.get(key);
  if (hit && hit.sig === sig && Date.now() - hit.at < IDEAS_MS) return hit.ideas;
  const load = () => aiSuggestions(platform, d, d.suggestions);
  let ideas: Suggestion[];
  try {
    ideas = await unstable_cache(load, ["live-ideas-v1", userId, platform, sig], { revalidate: IDEAS_MS / 1000, tags: [`live:${userId}`] })().catch(noDataCache(load));
  } catch {
    return []; // the model was unreachable: show the rule-based ideas and try again next time
  }
  ideaCache.set(key, { at: Date.now(), sig, ideas });
  if (ideaCache.size > 500) ideaCache.delete(ideaCache.keys().next().value as string);
  return ideas;
}

/** With a Gemini key, ask for up to three extra ideas grounded in the same numbers. Without one, nothing is added. */
async function aiSuggestions(platform: Platform, d: Omit<PlatformDashboard, "suggestions">, rules: Suggestion[]): Promise<Suggestion[]> {
  if (!env.GEMINI_API_KEY || d.posts.length < 3) return [];
  const facts = {
    platform,
    headline: d.headline.map((h) => ({ label: h.label, value: h.value, changePct: h.delta })),
    posts: d.posts.slice(0, 12).map((p) => ({ title: p.title, published: p.publishedAt, format: p.format, views: p.views, likes: p.likes, comments: p.comments, avgWatchS: p.avgWatch, durationS: p.duration })),
    alreadySaid: rules.map((r) => r.title),
  };
  const r = await gemini<{ suggestions?: { title: string; body: string; evidence: string }[] }>(
    "You coach short-form video creators. Use ONLY the numbers given. Never invent a statistic, benchmark or study. Plain words, no emoji, no hype.",
    `Here are a creator's live ${platform} numbers as JSON:\n${JSON.stringify(facts)}\n\nGive up to 3 specific, different suggestions that are not in alreadySaid. Each needs: title (max 8 words), body (max 35 words, what to do next), evidence (which of the given numbers support it). Reply as JSON {"suggestions":[...]}.`,
  ).catch(() => null);
  // null = the model didn't answer. Throw so that miss is never cached as "no ideas".
  if (!r) throw new Error("gemini unavailable");
  return (r.suggestions ?? []).slice(0, 3).filter((s) => s.title && s.body).map((s, i) => ({ id: `ai-${i}`, title: s.title, body: s.body, evidence: s.evidence ?? "", impact: "medium" as const, source: "ai" as const }));
}
