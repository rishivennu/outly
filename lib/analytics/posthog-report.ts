import "server-only";
import { cached } from "@/lib/cache";
import { appHostFor, posthogHost, posthogKey, POSTHOG_DEFAULTS } from "./config";
import { parseCountries, parseDaily, parseFunnel, parsePages, parseReferrers, parseSignups, QUERIES, type QueryName, type RangeDays } from "./posthog-query";

/** 1149: Admin > Analytics reads PostHog's Query API on the server. The personal key never reaches a browser. */
export function posthogServerConfig(e: NodeJS.ProcessEnv = process.env) {
  const appHost = e.POSTHOG_APP_HOST?.trim().replace(/\/+$/, "") || appHostFor(posthogHost());
  const projectId = (e.POSTHOG_PROJECT_ID ?? POSTHOG_DEFAULTS.projectId).trim();
  const personalKey = e.POSTHOG_PERSONAL_API_KEY?.trim() ?? "";
  const missing = [!personalKey && "POSTHOG_PERSONAL_API_KEY", !/^\d+$/.test(projectId) && "POSTHOG_PROJECT_ID"].filter((x): x is string => !!x);
  return { appHost, projectId, personalKey, missing, tracking: !!posthogKey(), projectUrl: /^\d+$/.test(projectId) ? `${appHost}/project/${projectId}` : appHost };
}

export class PostHogQueryError extends Error {}
const TIMEOUT_MS = 8_000;
const CACHE_MS = 5 * 60_000;

export async function runHogQL(query: string, cfg = posthogServerConfig(), fetcher: typeof fetch = fetch): Promise<unknown[][]> {
  let r: Response;
  try {
    r = await fetcher(`${cfg.appHost}/api/projects/${cfg.projectId}/query/`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.personalKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const slow = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new PostHogQueryError(slow ? "PostHog took longer than 8 seconds to answer. Try again in a minute." : "Couldn't reach PostHog. Check the server's network and try again.");
  }
  if (r.status === 401 || r.status === 403) throw new PostHogQueryError("PostHog refused the personal API key. Check it is current and has query:read access to this project.");
  if (r.status === 404) throw new PostHogQueryError("PostHog couldn't find this project. Check POSTHOG_PROJECT_ID and the region (US or EU).");
  if (!r.ok) throw new PostHogQueryError(`PostHog answered with an error (status ${r.status}). Try again in a minute.`);
  const j = (await r.json().catch(() => null)) as { results?: unknown } | null;
  if (!j || !Array.isArray(j.results)) throw new PostHogQueryError("PostHog sent an answer we couldn't read.");
  return j.results as unknown[][];
}

export type Panel<T> = { ok: true; data: T } | { ok: false; error: string };

const PARSE = {
  daily: parseDaily,
  pages: parsePages,
  referrers: parseReferrers,
  signups: parseSignups,
  funnel: parseFunnel,
  countries: parseCountries,
} satisfies Record<QueryName, (rows: unknown[][], d: RangeDays) => unknown>;
type Parsed = { [K in QueryName]: ReturnType<(typeof PARSE)[K]> };

export type AnalyticsReport =
  | { connected: false; missing: string[]; tracking: boolean; projectUrl: string }
  | ({ connected: true; days: RangeDays; tracking: boolean; projectUrl: string } & { [K in QueryName]: Panel<Parsed[K]> });

async function panel<K extends QueryName>(name: K, days: RangeDays, cfg: ReturnType<typeof posthogServerConfig>, fetcher?: typeof fetch): Promise<Panel<Parsed[K]>> {
  try {
    const rows = await cached(`posthog:${cfg.projectId}:${name}:${days}`, CACHE_MS, () => runHogQL(QUERIES[name](days), cfg, fetcher));
    return { ok: true, data: (PARSE[name] as (r: unknown[][], d: RangeDays) => Parsed[K])(rows, days) };
  } catch (e) {
    if (!(e instanceof PostHogQueryError)) console.error("[posthog]", e);
    return { ok: false, error: e instanceof PostHogQueryError ? e.message : "Something went wrong reading PostHog." };
  }
}

export async function analyticsReport(days: RangeDays, cfg = posthogServerConfig(), fetcher?: typeof fetch): Promise<AnalyticsReport> {
  const base = { tracking: cfg.tracking, projectUrl: cfg.projectUrl };
  if (cfg.missing.length) return { connected: false, missing: cfg.missing, ...base };
  const [daily, pages, referrers, signups, funnel, countries] = await Promise.all([
    panel("daily", days, cfg, fetcher),
    panel("pages", days, cfg, fetcher),
    panel("referrers", days, cfg, fetcher),
    panel("signups", days, cfg, fetcher),
    panel("funnel", days, cfg, fetcher),
    panel("countries", days, cfg, fetcher),
  ]);
  return { connected: true, days, ...base, daily, pages, referrers, signups, funnel, countries };
}
