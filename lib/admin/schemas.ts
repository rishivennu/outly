import { z } from "zod";
import { CURRENCIES } from "../billing/money";
import { PERKS } from "../billing/plan-rules";

export const PlanInput = z.object({
  name: z.string().trim().min(1, "Give the plan a name").max(40),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Slug: 2-30 lowercase letters, numbers or dashes").optional(),
  priceMinor: z.number().int().min(0, "Price can't be negative").max(100_000_000),
  currency: z.enum(CURRENCIES),
  interval: z.enum(["month", "year"]),
  note: z.string().trim().max(80).default(""),
  features: z.array(z.string().trim().min(1).max(90)).max(12, "Keep it to 12 features or fewer"),
  state: z.enum(["available", "soon", "hidden"]),
  highlight: z.boolean(),
  sortOrder: z.number().int().min(0).max(99),
  /** Exact prices in other currencies, minor units. Missing currencies are converted from priceMinor. */
  prices: z.partialRecord(z.enum(CURRENCIES), z.number().int().min(1, "Local prices must be above zero").max(100_000_000)).default({}),
  /** Yearly price in the plan currency, minor units. 0 = monthly x (12 - free months). */
  yearlyMinor: z.number().int().min(0, "Yearly price can't be negative").max(1_000_000_000).default(0),
  postLimit: z.number().int().min(0).max(100_000).default(0),
  aiCaptions: z.boolean().default(true),
  seats: z.number().int().min(0).max(50).default(0),
  /** Window the post limit counts over. */
  postPeriod: z.enum(["week", "month"]).default("month"),
  /** Largest upload per file in MB; 0 = the server maximum. */
  maxUploadMb: z.number().int().min(0).max(5000).default(0),
  /** Inbox replies per week; 0 = unlimited. */
  replyLimit: z.number().int().min(0).max(100_000).default(0),
  /** Videos per month that can get AI captions; 0 = unlimited. */
  captionVideos: z.number().int().min(0).max(10_000).default(0),
  /** Burn captions into the video file. */
  burnCaptions: z.boolean().default(true),
  /** Connected accounts in total, several per platform (1037). 0 = one per platform. */
  accountLimit: z.number().int().min(0).max(50).default(0),
  /** Total storage for every file, MB (1052). 0 = no cap. Optional so an older editor never wipes it. */
  storageMb: z.number().int().min(0).max(10_000_000).optional(),
  // 1096. All optional, so an older editor (or a partial PATCH) never resets them.
  /** Exact yearly prices in other currencies, minor units. */
  yearlyPrices: z.partialRecord(z.enum(CURRENCIES), z.number().int().min(1, "Yearly local prices must be above zero").max(1_000_000_000)).optional(),
  /** Different platforms connected at once; 0 = all. */
  platformLimit: z.number().int().min(0).max(10).optional(),
  /** Accounts (brands) per platform; 0 = older rules. */
  brandLimit: z.number().int().min(0).max(50).optional(),
  /** Posts to X per month; 0 = no cap. */
  xPostLimit: z.number().int().min(0).max(100_000).optional(),
  /** Days of analytics history; 0 = 90. */
  analyticsDays: z.number().int().min(0).max(730).optional(),
  /** Fair-use line for unlimited posts (alert only); 0 = off. */
  fairUsePosts: z.number().int().min(0).max(100_000).optional(),
  /** Perks on the plan; null = every perk. */
  perks: z.array(z.enum(PERKS)).max(PERKS.length).nullable().optional(),
});

export const FaqInput = z.object({
  category: z.enum(["Payments", "Account", "Publishing", "Technical"]),
  question: z.string().trim().min(5, "Question is too short").max(200),
  answer: z.string().trim().min(10, "Answer is too short").max(2000),
  published: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(50),
});
