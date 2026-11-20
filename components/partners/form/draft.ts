import type { z } from "zod";
import { ConsentSchema, PersonalSchema, ProposalSchema, SocialsSchema, StatsSchema, issueMap } from "@/lib/partners/schema";
import { normaliseHandle, profileUrlFor } from "@/lib/partners/core";

export const STEPS = ["Personal", "Social accounts", "Performance", "Proposal", "Review"] as const;
export const DRAFT_KEY = "outlly:partner-apply:v1";

export interface SocialDraft {
  platform: string;
  handle: string;
  url: string;
  /** The link was typed by the creator, so a handle change no longer rewrites it. */
  urlEdited: boolean;
  followers: string;
  niche: string;
  format: string;
}

export interface UploadedFile {
  token: string;
  name: string;
  size: number;
  mime: string;
}

export interface Draft {
  personal: { fullName: string; email: string; country: string; city: string; phone: string; brandName: string };
  socials: SocialDraft[];
  primary: number;
  stats: {
    avgViews: string;
    avgLikes: string;
    avgComments: string;
    avgShares: string;
    reach: string;
    engagementRate: string;
    audienceCountries: string;
    ageRange: string;
    frequency: string;
    niche: string;
  };
  proposal: { why: string; how: string; contentType: string; posts: string; preference: string; compensation: string; pastCollabs: string; portfolio: string[] };
  consent: { terms: boolean; accuracy: boolean };
  files: UploadedFile[];
}

export const emptySocial = (): SocialDraft => ({ platform: "instagram", handle: "", url: "", urlEdited: false, followers: "", niche: "", format: "" });

export const emptyDraft = (): Draft => ({
  personal: { fullName: "", email: "", country: "", city: "", phone: "", brandName: "" },
  socials: [emptySocial()],
  primary: 0,
  stats: { avgViews: "", avgLikes: "", avgComments: "", avgShares: "", reach: "", engagementRate: "", audienceCountries: "", ageRange: "", frequency: "", niche: "" },
  proposal: { why: "", how: "", contentType: "", posts: "", preference: "", compensation: "", pastCollabs: "", portfolio: [""] },
  consent: { terms: false, accuracy: false },
  files: [],
});

/** "12,500" -> 12500; blank -> undefined so the schema says "Enter ... as a number"; junk -> NaN so it says so too. */
export function toNumber(s: string): number | undefined {
  const t = s.replace(/[,\s_]/g, "").replace(/%$/, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Handle edits keep the profile link in step until the creator types their own link. */
export function withHandle(row: SocialDraft, handle: string): SocialDraft {
  if (row.urlEdited) return { ...row, handle };
  return { ...row, handle, url: profileUrlFor(row.platform, normaliseHandle(row.platform, handle)) };
}

export function withPlatform(row: SocialDraft, platform: string): SocialDraft {
  const next = { ...row, platform };
  return row.urlEdited ? next : { ...next, url: profileUrlFor(platform, normaliseHandle(platform, row.handle)) };
}

export const personalPayload = (d: Draft) => d.personal;
export const socialsPayload = (d: Draft) =>
  d.socials.map((s, i) => ({ platform: s.platform, handle: s.handle, url: s.url, followers: toNumber(s.followers), niche: s.niche || undefined, format: s.format || undefined, primary: i === d.primary }));
export const statsPayload = (d: Draft) => {
  const s = d.stats;
  return {
    avgViews: toNumber(s.avgViews),
    avgLikes: toNumber(s.avgLikes),
    avgComments: toNumber(s.avgComments),
    avgShares: toNumber(s.avgShares),
    reach: toNumber(s.reach),
    engagementRate: s.engagementRate.trim() ? toNumber(s.engagementRate) : null,
    audienceCountries: s.audienceCountries,
    ageRange: s.ageRange || undefined,
    frequency: s.frequency || undefined,
    niche: s.niche || undefined,
  };
};
export const proposalPayload = (d: Draft) => ({
  ...d.proposal,
  posts: toNumber(d.proposal.posts),
  preference: d.proposal.preference || undefined,
  portfolio: d.proposal.portfolio.map((u) => u.trim()).filter(Boolean),
});

export function payload(d: Draft, source: string, website: string) {
  return {
    personal: personalPayload(d),
    socials: socialsPayload(d),
    stats: statsPayload(d),
    proposal: proposalPayload(d),
    consent: d.consent,
    files: d.files.map((f) => ({ token: f.token, name: f.name })),
    source,
    website,
  };
}

const check = (schema: z.ZodType, value: unknown, prefix: string) => {
  const r = schema.safeParse(value);
  return r.success ? {} : issueMap(r.error, prefix);
};

/** Errors for one step, keyed by dotted field path. Step 4 (Review) checks consent only. */
export function stepErrors(step: number, d: Draft): Record<string, string> {
  switch (step) {
    case 0:
      return check(PersonalSchema, personalPayload(d), "personal");
    case 1:
      return check(SocialsSchema, socialsPayload(d), "socials");
    case 2:
      return check(StatsSchema, statsPayload(d), "stats");
    case 3:
      return check(ProposalSchema, proposalPayload(d), "proposal");
    default:
      return check(ConsentSchema, d.consent, "consent");
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
      socials: Array.isArray(d.socials) && d.socials.length ? d.socials.slice(0, 6).map((s) => ({ ...emptySocial(), ...s })) : e.socials,
      primary: typeof d.primary === "number" ? d.primary : 0,
      stats: { ...e.stats, ...d.stats },
      proposal: { ...e.proposal, ...d.proposal, portfolio: Array.isArray(d.proposal?.portfolio) && d.proposal.portfolio.length ? d.proposal.portfolio.slice(0, 5) : [""] },
      consent: { terms: !!d.consent?.terms, accuracy: !!d.consent?.accuracy },
      files: Array.isArray(d.files) ? d.files.slice(0, 6) : [],
    };
    if (draft.primary >= draft.socials.length) draft.primary = 0;
    return { draft, step: Math.min(4, Math.max(0, Math.floor(v.step ?? 0))) };
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
