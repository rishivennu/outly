import "server-only";
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
import { suggest } from "./suggest";
import type { PlatformDashboard, Suggestion } from "./types";

export type { PlatformDashboard } from "./types";

/** Live numbers are cached briefly so refreshes and tab switches don't burn the platform's quota. */
export const LIVE_CACHE_MS = 90_000;
const g = globalThis as unknown as { __liveCache?: Map<string, { at: number; data: PlatformDashboard }> };
const cache = (g.__liveCache ??= new Map());

export function invalidateDashboards(userId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}

function empty(platform: Platform, status: PlatformDashboard["status"], message: string, connect?: PlatformDashboard["connect"]): PlatformDashboard {
  return { platform, status, message, connect, fetchedAt: new Date().toISOString(), rangeDays: 28, headline: [], series: [], posts: [], notes: [], suggestions: [] };
}

export async function platformDashboard(userId: string, platform: Platform, opts: { fresh?: boolean } = {}): Promise<PlatformDashboard> {
  const key = `${userId}:${platform}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.data;

  const name = PLATFORM_META[platform].name;
  await loadKeys();
  const connect = { oauth: hasCredentials(platform), token: canConnectWithToken(platform) };
  const [user, acct] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    db.socialAccount.findFirst({ where: { userId, platform, status: { not: "disconnected" } }, orderBy: { createdAt: "desc" } }),
  ]);
  const tz = user?.timezone || "UTC";

  if (!acct || isPracticeAccount(acct)) {
    if (!connect.oauth && !connect.token)
      return empty(platform, "not_configured", `${name} needs developer keys before anyone can connect. Add ${platform.toUpperCase()}_CLIENT_ID and ${platform.toUpperCase()}_CLIENT_SECRET to the server's .env.`, connect);
    return empty(platform, "not_connected", `Connect your ${name} account to see live numbers here.`, connect);
  }
  if (acct.status === "needs_reconnect") return empty(platform, "needs_reconnect", `${name} asked you to sign in again before it shares more numbers.`, connect);

  let data: PlatformDashboard;
  try {
    const ctx = await liveAccount(acct);
    const base = platform === "instagram" ? await instagramDashboard(ctx, tz) : platform === "youtube" ? await youtubeDashboard(ctx) : await xDashboard(ctx);
    const rules = suggest({ platform, posts: base.posts, series: base.series, hours: base.hours, timezone: tz });
    data = { ...base, suggestions: [...rules, ...(await aiSuggestions(platform, base, rules))] };
  } catch (e) {
    const pe = asPublisherError(e);
    if (pe.code === "AUTH_EXPIRED") return empty(platform, "needs_reconnect", `${name} says the connection expired. Reconnect to keep the numbers live.`, connect);
    data = { ...empty(platform, "error", `${name} didn't answer just now. We'll try again on the next refresh.`, connect), notes: [{ level: "warning", text: pe.message, detail: pe.technical }] };
    return data; // never cache a failure
  }
  cache.set(key, { at: Date.now(), data });
  return data;
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
  return (r?.suggestions ?? []).slice(0, 3).filter((s) => s.title && s.body).map((s, i) => ({ id: `ai-${i}`, title: s.title, body: s.body, evidence: s.evidence ?? "", impact: "medium" as const, source: "ai" as const }));
}
