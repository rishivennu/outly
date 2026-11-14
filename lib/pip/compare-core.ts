/**
 * 1151: when may Pip compare two platforms, and on which numbers? Pure, so every case is tested.
 *
 * A comparison is only as good as its weakest side, so:
 *  - a metric is compared only when it came back for EVERY platform in the comparison;
 *  - an account that is disconnected (or needs reconnecting) is not current, so it is left out of a current
 *    comparison and named, unless the person asked for a historical one (its stored history is kept);
 *  - when a platform the person named returned nothing, there is no comparison at all, and the answer opens
 *    with exactly why, instead of a "winner" picked from one side's numbers.
 */
export type AcctStatus = "connected" | "needs_reconnect" | "disconnected";
export type PlatformData = {
  platform: string;
  name: string;
  /** Accounts on this platform in scope (practice accounts never). */
  accounts: { username: string; status: AcctStatus }[];
  /** Account-level insights (followers, reach) read live just now: ok, failed, or not asked (no connected account). */
  live: "ok" | "failed" | "none";
  followers: number | null;
  /** Synced numbers for posts published through Outlly in the period. */
  postsWithMetrics: number;
};
export type CompareVerdict = {
  /** Platforms in the comparison, in the order given. */
  compared: string[];
  /** Left out because they are not current (and the person didn't ask for history). */
  left: { platform: string; status: Exclude<AcctStatus, "connected"> }[];
  /** Asked about or in scope, but nothing came back at all. */
  missing: string[];
  /** In the comparison on post numbers, but their account insights didn't come back. */
  noInsights: string[];
  /** Which families of numbers may be compared. */
  metrics: { followers: boolean; posts: boolean };
  /** True when there is a real comparison to show. */
  ok: boolean;
  /** The sentence the answer must open with, when something is missing. */
  lead: string | null;
};

const list = (xs: string[], and = "and") => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/** "historical", "history", "in the past", "back when": the person asked to include accounts that aren't current. */
export const HISTORICAL_RE = /\b(historical|history|historic|in the past|back when|old data|archived?|including disconnected|disconnected (?:accounts?|ones?) too)\b/i;

export function statusOf(p: PlatformData): AcctStatus {
  if (p.accounts.some((a) => a.status === "connected")) return "connected";
  if (p.accounts.some((a) => a.status === "needs_reconnect")) return "needs_reconnect";
  return "disconnected";
}

export function compareVerdict(xs: PlatformData[], o: { historical: boolean; named: boolean }): CompareVerdict {
  const left: CompareVerdict["left"] = [];
  const pool: PlatformData[] = [];
  for (const p of xs) {
    const s = statusOf(p);
    if (s !== "connected" && !o.historical) left.push({ platform: p.platform, status: s });
    else pool.push(p);
  }
  const has = (p: PlatformData) => ({ posts: p.postsWithMetrics > 0, live: p.live === "ok" });
  const missing = pool.filter((p) => !has(p).posts && !has(p).live).map((p) => p.platform);
  const inC = pool.filter((p) => !missing.includes(p.platform));
  const two = inC.length >= 2;
  const metrics = {
    followers: two && inC.every((p) => p.live === "ok" && p.followers != null),
    posts: two && inC.every((p) => p.postsWithMetrics > 0),
  };
  const noInsights = metrics.posts ? inC.filter((p) => p.live !== "ok").map((p) => p.platform) : [];
  const name = (id: string) => xs.find((p) => p.platform === id)?.name ?? id;
  const shown = (ids: string[]) => ids.map(name);
  const blocked = o.named && (missing.length > 0 || left.length > 0);
  const okNow = !blocked && two && (metrics.followers || metrics.posts);

  let lead: string | null = null;
  const leftWhy = (l: CompareVerdict["left"][number]) => `${name(l.platform)} ${l.status === "needs_reconnect" ? "needs reconnecting" : "is disconnected"}`;
  if (!okNow) {
    const have = shown(inC.map((p) => p.platform));
    if (left.length && !missing.length) {
      lead =
        `I couldn't complete this comparison because ${list(left.map(leftWhy))}, so ${left.length > 1 ? "their" : "its"} numbers aren't current.` +
        (have.length ? ` ${list(have)} data is available.` : "") +
        ` ${left.length > 1 ? "Their" : "Its"} history is kept: reconnect to compare current numbers, or ask for a historical comparison to include it.`;
    } else if (missing.length === 1 && (have.length || left.length)) {
      const m = name(missing[0]);
      lead = `I couldn't complete this comparison because ${m} did not return its latest account insights.${have.length ? ` ${list(have)} data is available, but I need fresh ${m} data to provide an accurate comparison.` : ` I need fresh ${m} data to provide an accurate comparison.`}`;
      if (left.length) lead += ` ${list(left.map(leftWhy))}, so it is left out.`;
    } else if (missing.length >= 2) {
      const ms = shown(missing);
      lead = `I couldn't complete this comparison because ${ms.length === 2 ? `neither ${ms[0]} nor ${ms[1]} returned its` : `${list(ms)} did not return their`} latest data. I need fresh data from ${ms.length === 2 ? "both" : "each of them"} to provide an accurate comparison.`;
      if (left.length) lead += ` ${list(left.map(leftWhy))}, so it is left out.`;
    } else if (missing.length === 1) {
      lead = `I couldn't complete this comparison because ${name(missing[0])} did not return its latest account insights, and there is no other platform with data to compare it with.`;
    } else if (inC.length === 1) {
      lead = `Only ${name(inC[0].platform)} has current data, so there's nothing to compare it with yet.${left.length ? ` ${list(left.map(leftWhy))}, so it is left out.` : ""}`;
    } else if (two) {
      // Both sides answered, but no family of numbers came back for all of them.
      lead = `I couldn't complete this comparison because ${list(have)} didn't return the same numbers: account insights came back for ${list(shown(inC.filter((p) => p.live === "ok").map((p) => p.platform))) || "none of them"}, and post numbers for ${list(shown(inC.filter((p) => p.postsWithMetrics > 0).map((p) => p.platform))) || "none of them"}.`;
    }
  } else {
    const parts: string[] = [];
    if (noInsights.length) parts.push(`${list(shown(noInsights))} did not return ${noInsights.length > 1 ? "their" : "its"} latest account insights, so followers and reach are left out. This compares only posts published through Outlly.`);
    else if (!metrics.posts) parts.push(`This compares account-level numbers only: ${list(shown(inC.filter((p) => !p.postsWithMetrics).map((p) => p.platform)))} has no posts published through Outlly with numbers in this period.`);
    if (missing.length) parts.push(`${list(shown(missing))} returned no data, so ${missing.length > 1 ? "they are" : "it is"} left out.`);
    if (left.length) parts.push(`${list(left.map(leftWhy))}, so ${left.length > 1 ? "they are" : "it is"} left out of this current comparison. Ask for a historical comparison to include ${left.length > 1 ? "them" : "it"}.`);
    lead = parts.length ? parts.join(" ") : null;
  }
  return { compared: okNow ? inC.map((p) => p.platform) : [], left, missing, noInsights, metrics: okNow ? metrics : { followers: false, posts: false }, ok: okNow, lead };
}
