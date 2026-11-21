import type { z } from "zod";
import { ConsentSchema, PersonalSchema, ProposalSchema, ShortStatsSchema, SocialsSchema, issueMap } from "@/lib/partners/schema";
import { PLATFORM_HOSTS } from "@/lib/partners/core";
import { PARTNER_PLATFORMS, type PartnerNiche, type PartnerPlatform } from "@/lib/partners/types";
import { COUNTRIES } from "./countries";

/** R1289 short application: four steps, then a review. */
export const STEPS = ["Your details", "Your platforms", "Your reach", "Your reward preference"] as const;
export const REVIEW = STEPS.length;
export const DRAFT_KEY = "outlly:partner-apply:v2";

/** The chips on "Your platforms". A pasted LinkedIn, Facebook or Threads link still detects as itself. */
export const CHIP_PLATFORMS = ["instagram", "youtube", "tiktok", "x", "other"] as const satisfies readonly PartnerPlatform[];

/** The spec's categories, mapped onto the stored niche values (Technology is the long form's "tech"). */
export const CATEGORIES: { value: PartnerNiche; label: string }[] = [
  { value: "lifestyle", label: "Lifestyle" },
  { value: "tech", label: "Technology" },
  { value: "education", label: "Education" },
  { value: "business", label: "Business" },
  { value: "entertainment", label: "Entertainment" },
  { value: "gaming", label: "Gaming" },
  { value: "food", label: "Food" },
  { value: "travel", label: "Travel" },
  { value: "other", label: "Other" },
];

export const SHORT_PREFERENCES = [
  { value: "paid", title: "Paid Collaboration", body: "Earn money by introducing Outlly to your audience." },
  { value: "subscription", title: "Free Creator Subscription", body: "Get access to Outlly Creator while collaborating with us." },
  { value: "either", title: "Open to Both", body: "Let's find the best partnership for both of us." },
] as const;

export interface PlatformDraft {
  platform: string;
  url: string;
  followers: string;
  /** The creator picked the platform by hand, so a pasted link no longer changes it. */
  locked: boolean;
}

export interface UploadedFile {
  token: string;
  name: string;
  size: number;
  mime: string;
}

export interface Draft {
  personal: { fullName: string; email: string; country: string };
  socials: PlatformDraft[];
  stats: { avgViews: string; engagementRate: string; niche: string };
  proposal: { preference: string; extra: string };
  consent: boolean;
  files: UploadedFile[];
}

export const emptyRow = (platform = ""): PlatformDraft => ({ platform, url: "", followers: "", locked: false });

export const emptyDraft = (): Draft => ({
  personal: { fullName: "", email: "", country: "" },
  socials: [],
  stats: { avgViews: "", engagementRate: "", niche: "" },
  proposal: { preference: "", extra: "" },
  consent: false,
  files: [],
});

/** "12,500" -> 12500; blank -> undefined so the schema says "Enter ... as a number"; junk -> NaN so it says so too. */
export function toNumber(s: string): number | undefined {
  const t = s.replace(/[,\s_]/g, "").replace(/%$/, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** The platform a pasted link points at, from its host; null when it is not a link to a known platform. */
export function detectPlatform(input: string): PartnerPlatform | null {
  const s = input.trim();
  if (!s || /\s/.test(s) || !/[./]/.test(s)) return null;
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const p of PARTNER_PLATFORMS) if (PLATFORM_HOSTS[p].some((d) => host === d || host.endsWith(`.${d}`))) return p;
  return null;
}

/** A URL edit re-detects the platform unless the creator chose it by hand. */
export function withUrl(row: PlatformDraft, url: string): PlatformDraft {
  const found = row.locked ? null : detectPlatform(url);
  return { ...row, url, platform: found ?? row.platform };
}

/** Toggle a chip: on adds a row for it, off removes that platform's rows. */
export function toggleChip(rows: PlatformDraft[], platform: string): PlatformDraft[] {
  return rows.some((r) => r.platform === platform) ? rows.filter((r) => r.platform !== platform) : rows.length < 6 ? [...rows, emptyRow(platform)] : rows;
}

export const countryMatch = (s: string) => COUNTRIES.find((c) => c.toLowerCase() === s.trim().toLowerCase()) ?? "";

/** The largest account is the primary one: that is the number the admin table sorts by. */
export const primaryIndex = (rows: PlatformDraft[]) =>
  rows.reduce((best, r, i) => ((toNumber(r.followers) ?? 0) > (toNumber(rows[best]?.followers ?? "") ?? 0) ? i : best), 0);

export const personalPayload = (d: Draft) => ({ ...d.personal, country: countryMatch(d.personal.country) || d.personal.country.trim() });
export const socialsPayload = (d: Draft) => {
  const primary = primaryIndex(d.socials);
  return d.socials.map((s, i) => ({ platform: s.platform || undefined, handle: "", url: s.url, followers: toNumber(s.followers), primary: i === primary }));
};
export const statsPayload = (d: Draft) => ({
  avgViews: toNumber(d.stats.avgViews),
  engagementRate: d.stats.engagementRate.trim() ? toNumber(d.stats.engagementRate) : null,
  niche: d.stats.niche || undefined,
});
export const proposalPayload = (d: Draft) => ({ preference: d.proposal.preference || undefined, extra: d.proposal.extra, form: "short" as const });

export function payload(d: Draft, source: string, website: string) {
  return {
    personal: personalPayload(d),
    socials: socialsPayload(d),
    stats: statsPayload(d),
    proposal: proposalPayload(d),
    // One checkbox on the short form covers both: "I accept the Terms and Privacy Policy and confirm my details are accurate."
    consent: { terms: d.consent, accuracy: d.consent },
    files: d.files.map((f) => ({ token: f.token, name: f.name })),
    source,
    website,
  };
}

const check = (schema: z.ZodType, value: unknown, prefix: string) => {
  const r = schema.safeParse(value);
  return r.success ? {} : issueMap(r.error, prefix);
};

/** Errors for one step, keyed by dotted field path. The review step checks consent only. */
export function stepErrors(step: number, d: Draft): Record<string, string> {
  switch (step) {
    case 0: {
      const e = check(PersonalSchema, personalPayload(d), "personal");
      if (!e["personal.country"] && !countryMatch(d.personal.country)) e["personal.country"] = "Choose your country from the list";
      return e;
    }
    case 1:
      return check(SocialsSchema, socialsPayload(d), "socials");
    case 2:
      return check(ShortStatsSchema, statsPayload(d), "stats");
    case 3:
      return check(ProposalSchema, proposalPayload(d), "proposal");
    default: {
      const r = ConsentSchema.safeParse({ terms: d.consent, accuracy: d.consent });
      return r.success ? {} : { consent: "Tick the box to accept the terms and confirm your details" };
    }
  }
}

export const fieldId = (key: string) => `pa-${key.replace(/\./g, "-")}`;

/** A saved draft from sessionStorage, merged onto an empty one so a field added later never comes back undefined. */
export function restoreDraft(raw: string | null): { draft: Draft; step: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { draft?: Partial<Draft>; step?: number };
    const e = emptyDraft();
    const d = v.draft ?? {};
    const draft: Draft = {
      personal: { ...e.personal, ...d.personal },
      socials: Array.isArray(d.socials) ? d.socials.slice(0, 6).map((s) => ({ ...emptyRow(), ...s })) : [],
      stats: { ...e.stats, ...d.stats },
      proposal: { ...e.proposal, ...d.proposal },
      consent: d.consent === true,
      files: Array.isArray(d.files) ? d.files.slice(0, 6) : [],
    };
    return { draft, step: Math.min(REVIEW, Math.max(0, Math.floor(v.step ?? 0))) };
  } catch {
    return null;
  }
}

/** ?ref= and utm_* from the landing URL, e.g. "ref:ria utm:youtube/bio". */
export function sourceFrom(search: string) {
  const q = new URLSearchParams(search);
  const parts: string[] = [];
  const ref = q.get("ref");
  if (ref) parts.push(`ref:${ref}`);
  const utm = [q.get("utm_source"), q.get("utm_medium"), q.get("utm_campaign")].filter(Boolean).join("/");
  if (utm) parts.push(`utm:${utm}`);
  return parts.join(" ").replace(/[^\w.:/@ -]/g, "").slice(0, 120);
}

/** Where "Track My Application" goes: the dashboard when signed in, otherwise sign in first and land there. */
export function trackHref(ref: string, signedIn: boolean) {
  const dest = `/dashboard/partnerships?new=${encodeURIComponent(ref)}`;
  return signedIn ? dest : `/login?next=${encodeURIComponent(dest)}`;
}
