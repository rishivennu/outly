import { z } from "zod";
import {
  AGE_RANGES,
  PARTNER_FILE_MAX_COUNT,
  PARTNER_FORMATS,
  PARTNER_NICHES,
  PARTNER_PLATFORMS,
  PARTNER_PLATFORM_LABEL,
  PARTNER_PREFERENCES,
  POSTING_FREQUENCIES,
} from "./types";
import { FILE_TOKEN_RE, HANDLE_RULES, normaliseHandle, normaliseProfileUrl, stripHtml } from "./core";

/** Trimmed plain text with tags removed, then length-checked. */
const text = (max: number, min = 0, msg?: string) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => stripHtml(s).trim())
    .pipe(min ? z.string().min(min, msg).max(max, `Keep it under ${max} characters`) : z.string().max(max, `Keep it under ${max} characters`));

const count = (label: string, max = 10_000_000_000) =>
  z.number({ error: `Enter ${label} as a number` }).int(`Use a whole number for ${label}`).min(0, `${label[0].toUpperCase()}${label.slice(1)} can't be negative`).max(max);

const PHONE_RE = /^\+?[0-9 ().-]{6,24}$/;

export const PersonalSchema = z.object({
  fullName: text(80, 2, "Enter your full name"),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address")),
  country: text(60, 2, "Choose your country"),
  city: text(80).default(""),
  phone: z
    .string()
    .trim()
    .max(30)
    .default("")
    .refine((p) => !p || (PHONE_RE.test(p) && p.replace(/\D/g, "").length >= 6 && p.replace(/\D/g, "").length <= 15), "Enter a phone number with 6 to 15 digits, for example +91 98765 43210"),
  brandName: text(80).default(""),
});

export const SocialSchema = z
  .object({
    platform: z.enum(PARTNER_PLATFORMS, { error: "Choose a platform" }),
    handle: z.string().max(200).default("").transform((h) => h.trim()),
    url: z.string().max(300).default("").transform((u) => u.trim()),
    followers: count("followers"),
    // Per-account niche and format are long-form only (R1289).
    niche: z.enum(PARTNER_NICHES, { error: "Choose a niche" }).optional(),
    format: z.enum(PARTNER_FORMATS, { error: "Choose a format" }).optional(),
    primary: z.boolean().optional(),
  })
  .transform((s, ctx) => {
    // A typed username is checked as typed. A username read out of a pasted link is a bonus: a link that names no
    // valid username (a channel ID page, a short link) still identifies the account, so the handle stays blank.
    const typed = s.handle;
    const fromLink = !typed && s.platform !== "other" ? normaliseHandle(s.platform, s.url) : "";
    const url = normaliseProfileUrl(s.platform, s.url || normaliseHandle(s.platform, typed));
    const handle = typed ? normaliseHandle(s.platform, typed) : HANDLE_RULES[s.platform].re.test(fromLink) ? fromLink : "";
    if (typed && !HANDLE_RULES[s.platform].re.test(handle)) ctx.addIssue({ code: "custom", path: ["handle"], message: HANDLE_RULES[s.platform].hint });
    if (!url) {
      if (!typed && !s.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Paste the link to your profile or channel" });
      else
        ctx.addIssue({
          code: "custom",
          path: ["url"],
          message: s.platform === "other" ? "Enter a full https link to your profile" : `Enter a link to your ${PARTNER_PLATFORM_LABEL[s.platform]} profile`,
        });
    }
    return { ...s, handle, url: url ?? "" };
  });

export const SocialsSchema = z
  .array(SocialSchema)
  .min(1, "Add at least one platform")
  .max(6, "Add up to 6 accounts")
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const id = (r.handle || r.url).toLowerCase();
      const k = `${r.platform}:${id}`;
      if (id && seen.has(k)) ctx.addIssue({ code: "custom", path: [i, r.handle ? "handle" : "url"], message: "This account is already listed" });
      seen.add(k);
    });
    if (rows.filter((r) => r.primary).length > 1) ctx.addIssue({ code: "custom", path: [0, "primary"], message: "Choose one primary account" });
  })
  .transform((rows) => {
    const primary = Math.max(0, rows.findIndex((r) => r.primary));
    return rows.map((r, i) => ({ ...r, primary: i === primary }));
  });

/** R1289: average views is the only number every application must have. The long form adds the rest (see ApplicationSchema). */
export const StatsSchema = z.object({
  avgViews: count("average views"),
  avgLikes: count("average likes").optional(),
  avgComments: count("average comments").optional(),
  avgShares: count("average shares").optional(),
  reach: count("average reach").optional(),
  engagementRate: z.number({ error: "Enter engagement as a number" }).min(0, "Engagement rate can't be negative").max(100, "Engagement rate is a percentage, 0 to 100").nullable().default(null),
  audienceCountries: text(200).default(""),
  ageRange: z.enum(AGE_RANGES, { error: "Choose an age range" }).optional(),
  frequency: z.enum(POSTING_FREQUENCIES, { error: "Choose how often you post" }).optional(),
  niche: z.enum(PARTNER_NICHES, { error: "Choose a content niche" }).optional(),
});

export const CATEGORY_REQUIRED = "Choose your main content category";
/** What the short form's "Your reach" step checks: the category is required there. */
export const ShortStatsSchema = StatsSchema.extend({ niche: z.enum(PARTNER_NICHES, { error: CATEGORY_REQUIRED }) });

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && /\.[a-z]{2,}$/i.test(x.hostname);
    } catch {
      return false;
    }
  }, "Use a full https link");

export const PARTNER_FORMS = ["short", "long"] as const;
export const EXTRA_MAX = 300;

export const ProposalSchema = z.object({
  why: text(1200).default(""),
  how: text(1200).default(""),
  contentType: text(120).default(""),
  posts: z.number({ error: "Enter the number of posts" }).int("Use a whole number").min(1, "Plan at least 1 post").max(50, "Plan up to 50 posts").optional(),
  preference: z.enum(PARTNER_PREFERENCES, { error: "Choose how you'd like to partner" }),
  compensation: text(200).default(""),
  pastCollabs: text(1200).default(""),
  portfolio: z.array(httpsUrl).max(5, "Add up to 5 links").default([]),
  extra: text(EXTRA_MAX).default(""),
  // Applications sent before R1289 carry no form marker: they are long ones.
  form: z.enum(PARTNER_FORMS).default("long"),
});

export const ConsentSchema = z.object({
  terms: z.literal(true, { error: "Accept the Terms and Privacy Policy to continue" }),
  accuracy: z.literal(true, { error: "Confirm the information is accurate to continue" }),
});

export const FileRefSchema = z.object({
  token: z.string().regex(FILE_TOKEN_RE, "That upload has expired. Remove it and add the file again."),
  name: z.string().max(200).default(""),
});

type Issue = { path: (string | number)[]; message: string };

/** The long (R1282) form keeps every answer it always required; the short (R1289) form needs a content category. */
export function formIssues(a: { socials: { niche?: string; format?: string }[]; stats: z.output<typeof StatsSchema>; proposal: z.output<typeof ProposalSchema> }): Issue[] {
  const out: Issue[] = [];
  const add = (path: (string | number)[], message: string) => out.push({ path, message });
  if (!a.proposal) return out;
  if (a.proposal.form === "short") {
    if (!a.stats?.niche) add(["stats", "niche"], CATEGORY_REQUIRED);
    return out;
  }
  (a.socials ?? []).forEach((s, i) => {
    if (!s.niche) add(["socials", i, "niche"], "Choose a niche");
    if (!s.format) add(["socials", i, "format"], "Choose a format");
  });
  const s: Partial<z.output<typeof StatsSchema>> = a.stats ?? {};
  if (s.avgLikes === undefined) add(["stats", "avgLikes"], "Enter average likes as a number");
  if (s.avgComments === undefined) add(["stats", "avgComments"], "Enter average comments as a number");
  if (s.avgShares === undefined) add(["stats", "avgShares"], "Enter average shares as a number");
  if (s.reach === undefined) add(["stats", "reach"], "Enter average reach as a number");
  if (!s.ageRange) add(["stats", "ageRange"], "Choose an age range");
  if (!s.frequency) add(["stats", "frequency"], "Choose how often you post");
  if (!s.niche) add(["stats", "niche"], "Choose a content niche");
  const p = a.proposal;
  if ((p.why ?? "").length < 40) add(["proposal", "why"], "Tell us a bit more, at least 40 characters");
  if ((p.how ?? "").length < 10) add(["proposal", "how"], "Describe how you would introduce Outlly, at least 10 characters");
  if ((p.contentType ?? "").length < 2) add(["proposal", "contentType"], "Say what kind of content you would make");
  if (p.posts === undefined) add(["proposal", "posts"], "Enter the number of posts");
  return out;
}

export const ApplicationSchema = z
  .object({
    personal: PersonalSchema,
    socials: SocialsSchema,
    stats: StatsSchema,
    proposal: ProposalSchema,
    consent: ConsentSchema,
    files: z.array(FileRefSchema).max(PARTNER_FILE_MAX_COUNT, `Attach up to ${PARTNER_FILE_MAX_COUNT} files`).default([]),
    source: z.string().max(400).transform((s) => s.replace(/[^\w.:/@ -]/g, "").trim().slice(0, 120)).default(""),
    website: z.string().max(200).optional(),
  })
  .superRefine((a, ctx) => {
    for (const i of formIssues(a)) ctx.addIssue({ code: "custom", path: i.path, message: i.message });
  });

export type ApplicationInput = z.input<typeof ApplicationSchema>;
export type Application = z.output<typeof ApplicationSchema>;

export const WithdrawSchema = z.object({
  ref: z.string().trim().toUpperCase().max(20),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a valid email address")),
});

/** Zod issues keyed by dotted path ("socials.0.handle" for prefix "socials"), first message wins. */
export function issueMap(error: z.ZodError, prefix = "") {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = [prefix, ...i.path.map(String)].filter(Boolean).join(".");
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}
