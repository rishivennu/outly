/**
 * Growth page logic with no database or Next imports, so the edge middleware and the tests can use it.
 */

/** First-touch campaign cookie. Set by middleware when a visitor lands on any page with ?utm_source. */
export const SRC_COOKIE = "ol_src";
export const SRC_DAYS = 30;

const clean = (v: string | null | undefined, max = 40) =>
  (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);

/** "instagram/social/launch" from a landing URL, or null when there's no utm_source. */
export function sourceFromParams(sp: URLSearchParams): string | null {
  const s = clean(sp.get("utm_source"));
  if (!s) return null;
  return [s, clean(sp.get("utm_medium")), clean(sp.get("utm_campaign"))].join("/");
}

/** Only values we wrote ourselves get through: three short slug parts. */
export const isSource = (v: string | null | undefined): v is string => !!v && v.length <= 124 && /^[a-z0-9._-]{1,40}\/[a-z0-9._-]{0,40}\/[a-z0-9._-]{0,40}$/.test(v);

export function parseSource(v: string | null | undefined) {
  if (!v || v === "direct") return { source: "direct", medium: "", campaign: "" };
  if (v === "referral") return { source: "referral", medium: "", campaign: "" };
  const [source = "direct", medium = "", campaign = ""] = v.split("/");
  return { source, medium, campaign };
}

/** What the new account is credited to: a campaign link beats a friend's link beats nothing. */
export const resolveSource = (cookie: string | null | undefined, referred: boolean) => (isSource(cookie) ? cookie : referred ? "referral" : "direct");

export const CHANNELS = [
  { id: "instagram", label: "Instagram", medium: "social" },
  { id: "youtube", label: "YouTube", medium: "social" },
  { id: "x", label: "X", medium: "social" },
  { id: "linkedin", label: "LinkedIn", medium: "social" },
  { id: "threads", label: "Threads", medium: "social" },
  { id: "whatsapp", label: "WhatsApp", medium: "chat" },
  { id: "newsletter", label: "Newsletter", medium: "email" },
  { id: "creator", label: "Creator partner", medium: "partner" },
  { id: "ads", label: "Paid ads", medium: "cpc" },
] as const;

const LABEL: Record<string, string> = { direct: "Direct or unknown", referral: "Friend's link", ...Object.fromEntries(CHANNELS.map((c) => [c.id, c.label])) };
export const channelLabel = (source: string) => LABEL[source] ?? source.charAt(0).toUpperCase() + source.slice(1);

export function campaignUrl(base: string, source: string, medium: string, campaign: string, path = "/") {
  const u = new URL(path, base);
  u.searchParams.set("utm_source", clean(source) || "direct");
  if (clean(medium)) u.searchParams.set("utm_medium", clean(medium));
  if (clean(campaign)) u.searchParams.set("utm_campaign", clean(campaign));
  return u.toString();
}

// ---------- funnel ----------

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** share of the step before that made it here, 0..1; null on the first step */
  rate: number | null;
  /** people lost since the step before (never negative) */
  lost: number;
}

export function funnel(steps: { key: string; label: string; count: number }[]): FunnelStep[] {
  return steps.map((s, i) => {
    const prev = i ? steps[i - 1].count : null;
    return { ...s, rate: prev === null ? null : prev ? Math.min(1, s.count / prev) : 0, lost: prev === null ? 0 : Math.max(0, prev - s.count) };
  });
}

/** The step that loses the biggest share of people: where to work first. */
export function worstStep(f: FunnelStep[]) {
  let worst: FunnelStep | null = null;
  for (const s of f) if (s.rate !== null && f[f.indexOf(s) - 1].count > 0 && (!worst || s.rate < (worst.rate ?? 1))) worst = s;
  return worst;
}

// ---------- leads ----------

export type LeadKind = "waitlist" | "unconnected" | "unposted" | "free_active" | "quiet";
export type Temp = "hot" | "warm" | "cold";

export interface LeadFacts {
  /** days since they entered this list (joined the waitlist, signed up, connected, went quiet) */
  ageDays: number;
  /** distinct days they opened the app in the last 14 */
  activeDays14: number;
  /** real posts in the last 30 days */
  posts30: number;
  /** came in through a friend's link */
  referred: boolean;
}

const BASE: Record<LeadKind, number> = { free_active: 40, unposted: 30, unconnected: 25, waitlist: 25, quiet: 15 };

/** 0..100: how likely one email moves this person to the next step. */
export function leadScore(kind: LeadKind, f: LeadFacts): { score: number; temp: Temp } {
  let s = BASE[kind];
  const a = Math.max(0, f.ageDays);
  s += a <= 3 ? 30 : a <= 7 ? 20 : a <= 21 ? 10 : a > 60 ? -15 : 0;
  s += Math.min(25, f.activeDays14 * 4);
  s += Math.min(15, f.posts30 * 3);
  if (f.referred) s += 10;
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, temp: score >= 60 ? "hot" : score >= 35 ? "warm" : "cold" };
}

export const LISTS: { kind: LeadKind; label: string; blurb: string }[] = [
  { kind: "waitlist", label: "Waitlist, not invited", blurb: "Asked to get in and are still waiting. The email is their invite." },
  { kind: "unconnected", label: "Signed up, no account connected", blurb: "Made an account but never linked Instagram, YouTube or anything else." },
  { kind: "unposted", label: "Connected, never posted", blurb: "Linked an account and stopped before the first post." },
  { kind: "free_active", label: "Active on Free", blurb: "Used the app in the last 14 days and have never paid." },
  { kind: "quiet", label: "Gone quiet", blurb: "Posted before, then nothing for three weeks or more." },
];

/** Ready-written email per list. {name} becomes the first name. Plain text; blank lines are paragraphs. */
export const DRAFTS: Record<LeadKind, { subject: string; body: string; cta: string; path: string }> = {
  waitlist: {
    subject: "You're in, {name}",
    body: "Hi {name},\n\nThanks for waiting. Your spot is ready and your account is one click away.\n\nUpload one clip, pick your platforms, and Outlly writes the captions for each one. Most people send their first post in under five minutes.",
    cta: "Create my account",
    path: "/signup?invite=1",
  },
  unconnected: {
    subject: "One step left, {name}",
    body: "Hi {name},\n\nYour studio is set up, but no social account is linked yet, so nothing can go out.\n\nConnecting Instagram or YouTube takes about 30 seconds and you can disconnect any time. Then try a practice post: it runs the whole flow without publishing anything.",
    cta: "Connect an account",
    path: "/accounts",
  },
  unposted: {
    subject: "Your first post is two minutes away",
    body: "Hi {name},\n\nYour accounts are connected. The only thing left is the first post.\n\nPick any clip you already have. Outlly writes a caption for each platform and you can schedule it for later if today is busy.",
    cta: "Make my first post",
    path: "/create",
  },
  free_active: {
    subject: "You're getting a lot out of Outlly, {name}",
    body: "Hi {name},\n\nYou've been using Outlly a lot lately, which is great to see.\n\nIf you're bumping into the Free limits, a paid plan gives you more posts, more accounts and the full analytics. You can pause or cancel any time from Billing.",
    cta: "See the plans",
    path: "/billing",
  },
  quiet: {
    subject: "Your studio misses you, {name}",
    body: "Hi {name},\n\nIt's been a few weeks since your last post. Everything you made is still here, drafts and captions included.\n\nAn easy way back: pick an old clip that did well, give it a fresh caption, and send it out again.",
    cta: "Open my studio",
    path: "/home",
  },
};

export const firstName = (name: string | null | undefined, email: string) => (name?.trim().split(/\s+/)[0] || email.split("@")[0]).slice(0, 40);
export const fill = (t: string, name: string) => t.replace(/\{name\}/g, name);

// ---------- CSV ----------

/** RFC 4180 CSV. Cells that start with = + - @ get a leading quote so a spreadsheet won't run them as formulas. */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
