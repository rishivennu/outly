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
    handle: z.string().max(200).transform((h) => h.trim()),
    url: z.string().max(300).transform((u) => u.trim()),
    followers: count("followers"),
    niche: z.enum(PARTNER_NICHES, { error: "Choose a niche" }),
    format: z.enum(PARTNER_FORMATS, { error: "Choose a format" }),
    primary: z.boolean().optional(),
  })
  .transform((s, ctx) => {
    // A pasted link with no username still names the account: take the handle from the link.
    const handle = normaliseHandle(s.platform, s.handle || (s.platform === "other" ? "" : s.url));
    if (!handle) ctx.addIssue({ code: "custom", path: ["handle"], message: "Enter your username" });
    else if (!HANDLE_RULES[s.platform].re.test(handle)) ctx.addIssue({ code: "custom", path: ["handle"], message: HANDLE_RULES[s.platform].hint });
    const url = normaliseProfileUrl(s.platform, s.url || handle);
    if (!url)
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: s.platform === "other" ? "Enter a full https link to your profile" : `Enter a link to your ${PARTNER_PLATFORM_LABEL[s.platform]} profile`,
      });
    return { ...s, handle, url: url ?? "" };
  });

export const SocialsSchema = z
  .array(SocialSchema)
  .min(1, "Add at least one social account")
  .max(6, "Add up to 6 accounts")
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const k = `${r.platform}:${r.handle.toLowerCase()}`;
      if (r.handle && seen.has(k)) ctx.addIssue({ code: "custom", path: [i, "handle"], message: "This account is already listed" });
      seen.add(k);
    });
    if (rows.filter((r) => r.primary).length > 1) ctx.addIssue({ code: "custom", path: [0, "primary"], message: "Choose one primary account" });
  })
  .transform((rows) => {
    const primary = Math.max(0, rows.findIndex((r) => r.primary));
    return rows.map((r, i) => ({ ...r, primary: i === primary }));
  });

export const StatsSchema = z.object({
  avgViews: count("average views"),
  avgLikes: count("average likes"),
  avgComments: count("average comments"),
  avgShares: count("average shares"),
  reach: count("average reach"),
  engagementRate: z.number({ error: "Enter engagement as a number" }).min(0, "Engagement rate can't be negative").max(100, "Engagement rate is a percentage, 0 to 100").nullable().default(null),
  audienceCountries: text(200).default(""),
  ageRange: z.enum(AGE_RANGES, { error: "Choose an age range" }),
  frequency: z.enum(POSTING_FREQUENCIES, { error: "Choose how often you post" }),
  niche: z.enum(PARTNER_NICHES, { error: "Choose a content niche" }),
});

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

export const ProposalSchema = z.object({
  why: text(1200, 40, "Tell us a bit more, at least 40 characters"),
  how: text(1200, 10, "Describe how you would introduce Outlly, at least 10 characters"),
  contentType: text(120, 2, "Say what kind of content you would make"),
  posts: z.number({ error: "Enter the number of posts" }).int("Use a whole number").min(1, "Plan at least 1 post").max(50, "Plan up to 50 posts"),
  preference: z.enum(PARTNER_PREFERENCES, { error: "Choose a partnership preference" }),
  compensation: text(200).default(""),
  pastCollabs: text(1200).default(""),
  portfolio: z.array(httpsUrl).max(5, "Add up to 5 links").default([]),
});

export const ConsentSchema = z.object({
  terms: z.literal(true, { error: "Accept the Terms and Privacy Policy to continue" }),
  accuracy: z.literal(true, { error: "Confirm the information is accurate to continue" }),
});

export const FileRefSchema = z.object({
  token: z.string().regex(FILE_TOKEN_RE, "That upload has expired. Remove it and add the file again."),
  name: z.string().max(200).default(""),
});

export const ApplicationSchema = z.object({
  personal: PersonalSchema,
  socials: SocialsSchema,
  stats: StatsSchema,
  proposal: ProposalSchema,
  consent: ConsentSchema,
  files: z.array(FileRefSchema).max(PARTNER_FILE_MAX_COUNT, `Attach up to ${PARTNER_FILE_MAX_COUNT} files`).default([]),
  source: z.string().max(400).transform((s) => s.replace(/[^\w.:/@ -]/g, "").trim().slice(0, 120)).default(""),
  website: z.string().max(200).optional(),
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
