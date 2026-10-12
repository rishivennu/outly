import { z } from "zod";
import { CURRENCIES } from "../billing/money";

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
  prices: z.record(z.enum(CURRENCIES), z.number().int().min(1, "Local prices must be above zero").max(100_000_000)).default({}),
  postLimit: z.number().int().min(0).max(100_000).default(0),
  aiCaptions: z.boolean().default(true),
  seats: z.number().int().min(0).max(50).default(0),
});

export const FaqInput = z.object({
  category: z.enum(["Payments", "Account", "Publishing", "Technical"]),
  question: z.string().trim().min(5, "Question is too short").max(200),
  answer: z.string().trim().min(10, "Answer is too short").max(2000),
  published: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(50),
});
