/**
 * 1120: the creator profile card, the pure half (unit tested). Validation for what the creator types, the public
 * link rules, the three stats added up from what each connected platform reports, and the progress bar.
 *
 * Nothing here invents a number. A stat no connected platform reports is null ("Unavailable" on the card), a
 * platform that didn't answer is listed as missing, and progress only counts things that can be checked.
 */
import { PLATFORMS, type Platform } from "./domain";

export const BIO_MAX = 160;
export const NICHE_MAX = 40;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
/** Lowercase letters, digits, dots and underscores; starts and ends with a letter or digit; no ".." */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/;

/** "@Rishi.Makes " -> "rishi.makes" */
export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").toLowerCase();

/** What's wrong with a handle, in words, or null when it's fine. */
/** Words a public page or route may need one day; nobody can hold them as a handle. */
export const RESERVED_HANDLES = new Set(["admin", "administrator", "api", "app", "accounts", "billing", "calendar", "create", "help", "home", "inbox", "login", "logout", "me", "outlly", "outly", "pricing", "privacy", "root", "settings", "signup", "staff", "support", "system", "team", "terms", "verify", "www"]);

/** "Total Views" only when every number is all-time; mixed windows (28 days, recent posts) are just "Views". */
export const viewsLabel = (scopes: { scope: ViewsScope }[]) => (scopes.length && scopes.every((s) => s.scope === "all_time") ? "Total Views" : "Views");

export function handleProblem(h: string): string | null {
  if (RESERVED_HANDLES.has(h.toLowerCase())) return "That handle is reserved. Try another.";
  if (h.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters.`;
  if (h.length > HANDLE_MAX) return `At most ${HANDLE_MAX} characters.`;
  if (!HANDLE_RE.test(h) || h.includes("..")) return "Use letters, numbers, dots and underscores, starting and ending with a letter or number.";
  return null;
}

/** One line, no control characters, runs of spaces folded. Bio keeps single line breaks (up to 3 lines). */
export function cleanText(raw: string, max: number, multiline = false): string {
  const s = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n");
  const t = multiline
    ? s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).slice(0, 3).join("\n").trim()
    : s.replace(/\s+/g, " ").trim();
  return [...t].slice(0, max).join("");
}

/** Where each platform's public profiles live. An added link must point at one of these hosts. */
export const LINK_HOSTS: Record<Platform, string[]> = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com"],
  x: ["x.com", "twitter.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
  threads: ["threads.net", "threads.com"],
};

/** A public https profile URL on the platform's own site, normalised, or null. */
export function cleanLink(platform: Platform, raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 200) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  if (!LINK_HOSTS[platform].includes(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return null; // the site's home page is not a profile
  u.hash = "";
  return u.toString();
}

/** A connected account's public profile URL, when its stored username is enough to build one. */
export function accountUrl(platform: Platform, username: string, platformUserId: string): string | null {
  const u = username.trim().replace(/^@/, "");
  switch (platform) {
    case "instagram":
      return /^[A-Za-z0-9._]{1,30}$/.test(u) ? `https://www.instagram.com/${u}/` : null;
    case "x":
      return /^[A-Za-z0-9_]{1,15}$/.test(u) ? `https://x.com/${u}` : null;
    case "threads":
      return /^[A-Za-z0-9._]{1,30}$/.test(u) ? `https://www.threads.net/@${u}` : null;
    case "tiktok":
      return /^[A-Za-z0-9._]{2,24}$/.test(u) ? `https://www.tiktok.com/@${u}` : null;
    case "youtube":
      if (/^@[A-Za-z0-9._-]{3,30}$/.test(username.trim())) return `https://www.youtube.com/${username.trim()}`;
      return /^UC[A-Za-z0-9_-]{22}$/.test(platformUserId) ? `https://www.youtube.com/channel/${platformUserId}` : null;
    case "facebook":
      return /^\d{5,20}$/.test(platformUserId) ? `https://www.facebook.com/${platformUserId}` : null;
    default:
      return null; // LinkedIn usernames are display names, not the vanity URL
  }
}

/** What the creator chose (User.profileLinks): links they typed, and which entries stay off the card. */
export interface ProfileLinks {
  /** Account ids, or "link:<platform>" for an added link, kept off the public card. */
  hidden: string[];
  links: { platform: Platform; url: string }[];
}
const isPlatform = (p: unknown): p is Platform => typeof p === "string" && (PLATFORMS as readonly string[]).includes(p);

export function parseProfileLinks(raw: string | null | undefined): ProfileLinks {
  try {
    const j = raw ? JSON.parse(raw) : null;
    const hidden = Array.isArray(j?.hidden) ? j.hidden.filter((x: unknown): x is string => typeof x === "string" && x.length <= 64).slice(0, 40) : [];
    const seen = new Set<string>();
    const links: ProfileLinks["links"] = [];
    for (const l of Array.isArray(j?.links) ? j.links : []) {
      if (!isPlatform(l?.platform) || typeof l?.url !== "string" || seen.has(l.platform)) continue;
      const url = cleanLink(l.platform, l.url);
      if (!url) continue;
      seen.add(l.platform);
      links.push({ platform: l.platform, url });
    }
    return { hidden, links };
  } catch {
    return { hidden: [], links: [] };
  }
}

export interface CardLink {
  key: string;
  platform: Platform;
  /** "@handle" for a connected account, the URL's path for an added link. */
  label: string;
  /** Null = no valid public URL, so it is not a link. */
  url: string | null;
  source: "connected" | "added";
  public: boolean;
}

export interface LinkAccount {
  id: string;
  platform: string;
  username: string;
  platformUserId: string;
}

/** Every link the creator could show: one per connected account, then each added one. A connected account's
 *  link wins over an added link to the same address. */
export function cardLinks(accounts: LinkAccount[], prefs: ProfileLinks): CardLink[] {
  const hidden = new Set(prefs.hidden);
  const out: CardLink[] = [];
  const urls = new Set<string>();
  for (const a of accounts) {
    if (!isPlatform(a.platform)) continue;
    const url = accountUrl(a.platform, a.username, a.platformUserId);
    if (url) urls.add(url.toLowerCase());
    out.push({ key: a.id, platform: a.platform, label: /^@|\s/.test(a.username) ? a.username : `@${a.username}`, url, source: "connected", public: !hidden.has(a.id) });
  }
  for (const l of prefs.links) {
    if (urls.has(l.url.toLowerCase())) continue;
    const key = `link:${l.platform}`;
    out.push({ key, platform: l.platform, label: new URL(l.url).pathname.replace(/^\/+|\/+$/g, "") || l.url, url: l.url, source: "added", public: !hidden.has(key) });
  }
  return out;
}

/** What the card shows: public entries with a real address only. */
export const publicLinks = (links: CardLink[]) => links.filter((l) => l.public && l.url);

// ---------- Stats ----------

/** How far back a platform's views go. Platforms differ, so the card says so instead of pretending they match. */
export type ViewsScope = "all_time" | "28_days" | "recent_posts";

/** All-time totals a platform reader reports (lib/live/*). Null = the platform doesn't say. */
export interface PlatformTotals {
  followers: number | null;
  posts: number | null;
  views: number | null;
  viewsScope?: ViewsScope;
}

export interface TotalsRow {
  platform: Platform;
  /** "ok" = the platform answered. Anything else is listed as missing, never counted as zero. */
  ok: boolean;
  totals?: PlatformTotals | null;
  /** Posts this account published through Outlly (used only when the platform reports no post count). */
  outllyPosts: number;
}

export interface CardStat {
  value: number | null;
  /** Platforms whose numbers are in the value. */
  from: Platform[];
  /** Connected platforms that didn't report this. */
  missing: Platform[];
  /** Platforms with several accounts where some answered and some didn't: counted, but short. */
  partial: Platform[];
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

function stat(rows: TotalsRow[], pick: (r: TotalsRow) => number | null): CardStat {
  let value: number | null = null;
  const from: Platform[] = [];
  const missing: Platform[] = [];
  for (const r of rows) {
    const v = r.ok ? pick(r) : null;
    if (num(v)) {
      value = (value ?? 0) + v;
      from.push(r.platform);
    } else missing.push(r.platform);
  }
  return { value, from: uniq(from), missing: uniq(missing).filter((p) => !from.includes(p)), partial: uniq(missing).filter((p) => from.includes(p)) };
}

export interface CardStats {
  followers: CardStat;
  posts: CardStat;
  views: CardStat;
  /** Platforms whose post count is the posts sent from Outlly (they report no total of their own). */
  postsFromOutlly: Platform[];
  viewsScopes: { platform: Platform; scope: ViewsScope }[];
}

export function aggregate(rows: TotalsRow[]): CardStats {
  const postsFromOutlly: Platform[] = [];
  const posts = stat(rows, (r) => {
    if (num(r.totals?.posts)) return r.totals!.posts;
    // The platform answered but keeps no post total (Facebook Pages, or no reader): Outlly's own record is real.
    if (r.outllyPosts > 0) {
      postsFromOutlly.push(r.platform);
      return r.outllyPosts;
    }
    return null;
  });
  const views = stat(rows, (r) => r.totals?.views ?? null);
  const viewsScopes = rows.filter((r) => r.ok && num(r.totals?.views) && r.totals?.viewsScope).map((r) => ({ platform: r.platform, scope: r.totals!.viewsScope! }));
  return { followers: stat(rows, (r) => r.totals?.followers ?? null), posts, views, postsFromOutlly: uniq(postsFromOutlly), viewsScopes };
}

const SCOPE_WORDS: Record<ViewsScope, string> = { all_time: "all time", "28_days": "last 28 days", recent_posts: "recent posts" };

/** One honest footnote under the stats, or null when there is nothing to qualify. */
export function statsNote(s: CardStats, name: (p: Platform) => string): string | null {
  const parts: string[] = [];
  const scopes = uniq(s.viewsScopes.map((v) => v.scope));
  if (scopes.length > 1 || (scopes.length === 1 && scopes[0] !== "all_time")) {
    parts.push(`Views: ${s.viewsScopes.map((v) => `${name(v.platform)} ${SCOPE_WORDS[v.scope]}`).join(", ")}.`);
  }
  // A platform can count toward one stat and not another (TikTok posts sent from Outlly, but no follower
  // reader): name it once, as left out entirely or as counting toward only some stats, never both.
  const anyValue = s.followers.value !== null || s.posts.value !== null || s.views.value !== null;
  if (anyValue) {
    const stats = [["followers", s.followers], ["posts", s.posts], ["views", s.views]] as const;
    const all = uniq(stats.flatMap(([, st]) => [...st.from, ...st.missing]));
    const none = all.filter((p) => stats.every(([, st]) => !st.from.includes(p)));
    const some = all.filter((p) => !none.includes(p) && stats.some(([, st]) => st.missing.includes(p)));
    const outllyOnly: Platform[] = [];
    for (const p of some) {
      const counted = stats.filter(([, st]) => st.from.includes(p)).map(([k]) => k);
      if (counted.length === 1 && counted[0] === "posts" && s.postsFromOutlly.includes(p)) outllyOnly.push(p);
      else parts.push(`${name(p)} counts toward ${counted.join(" and ")} only.`);
    }
    const sentFrom = s.postsFromOutlly.filter((p) => !outllyOnly.includes(p));
    if (sentFrom.length) parts.push(`${sentFrom.map(name).join(", ")} posts are the ones sent from Outlly.`);
    if (outllyOnly.length) parts.push(`${outllyOnly.map(name).join(", ")} counts toward posts only, the ones sent from Outlly.`);
    if (none.length) parts.push(`Not included: ${none.map(name).join(", ")}.`);
    const short = uniq(stats.flatMap(([, st]) => st.partial));
    if (short.length) parts.push(`Some ${short.map(name).join(", ")} accounts didn't answer, so those totals are short.`);
  } else if (s.postsFromOutlly.length) parts.push(`${s.postsFromOutlly.map(name).join(", ")} posts are the ones sent from Outlly.`);
  return parts.length ? parts.join(" ") : null;
}

/** 72.9K, 1.2M, 828: the card's short form (always one decimal at most, like the brief). */
const abbr = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const formatAbbr = (n: number) => abbr.format(n);

// ---------- Progress ----------

export const PROGRESS_STEPS = [
  { id: "photo", label: "Add a profile picture" },
  { id: "cover", label: "Add a cover" },
  { id: "bio", label: "Write a short bio" },
  { id: "handle", label: "Pick a handle" },
  { id: "niche", label: "Say what you make" },
  { id: "connect", label: "Connect a platform" },
  { id: "more", label: "Connect a second platform" },
  { id: "links", label: "Show a link on your card" },
  { id: "active", label: "Publish in the last 30 days" },
  { id: "steady", label: "Publish 4 times in 30 days" },
] as const;
export type ProgressStepId = (typeof PROGRESS_STEPS)[number]["id"];

export interface ProgressInput {
  photo: boolean;
  cover: boolean;
  bio: boolean;
  handle: boolean;
  niche: boolean;
  connected: number;
  publicLinks: number;
  published30: number;
}

export interface Progress {
  done: number;
  total: number;
  level: string;
  steps: { id: ProgressStepId; label: string; done: boolean }[];
}

/** Profile completion, connected platforms and publishing activity, each one a checkable fact. Not a score. */
export function progressOf(i: ProgressInput): Progress {
  const ok: Record<ProgressStepId, boolean> = {
    photo: i.photo,
    cover: i.cover,
    bio: i.bio,
    handle: i.handle,
    niche: i.niche,
    connect: i.connected >= 1,
    more: i.connected >= 2,
    links: i.publicLinks >= 1,
    active: i.published30 >= 1,
    steady: i.published30 >= 4,
  };
  const steps = PROGRESS_STEPS.map((s) => ({ id: s.id, label: s.label, done: ok[s.id] }));
  const done = steps.filter((s) => s.done).length;
  const total = steps.length;
  const level = done === total ? "All set" : done >= 7 ? "Nearly there" : done >= 4 ? "Taking shape" : "Just starting";
  return { done, total, level, steps };
}

/** How many of `ticks` marks are lit for a progress (never lights one that isn't earned). */
export const litTicks = (p: Pick<Progress, "done" | "total">, ticks: number) => (p.total ? Math.floor((p.done / p.total) * ticks) : 0);

/** The card's whole payload (GET /api/profile/card). */
export interface ProfileCardView {
  name: string;
  handle: string | null;
  bio: string | null;
  niche: string | null;
  avatar: string | null;
  banner: string | null;
  email: string;
  links: CardLink[];
  stats: CardStats;
  note: string | null;
  progress: Progress;
  connected: number;
  fetchedAt: string;
}

/** Uploaded profile images: "/api/u/img/avatar-<userId>-<rand>". The id keeps the file the owner's; rand busts caches. */
export const IMG_NAME_RE = /^(avatar|banner)-([a-z0-9]{8,40})-([a-z0-9]{12,32})$/;
export const IMG_PREFIX = "/api/u/img/";
export const imgKey = (name: string) => {
  const m = IMG_NAME_RE.exec(name);
  return m ? `profile/${m[2]}/${m[1]}-${m[3]}.jpg` : null;
};
export const isProfileImg = (v: unknown, kind?: "avatar" | "banner"): v is string =>
  typeof v === "string" && v.startsWith(IMG_PREFIX) && IMG_NAME_RE.test(v.slice(IMG_PREFIX.length)) && (!kind || v.slice(IMG_PREFIX.length).startsWith(`${kind}-`));
