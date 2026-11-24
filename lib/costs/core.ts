/**
 * R1314 Infrastructure & Costs: the client-safe vocabulary. Providers are only the ones Outlly actually pays or
 * meters; categories and features are the two ways a rupee is attributed. Money is integer minor units; the ledger
 * stores the original currency plus the FX it was converted at, and these helpers never reprice history.
 */
export type CostSource = "estimate" | "reported" | "billed" | "manual" | "forecast";
export const COST_SOURCES: readonly CostSource[] = ["billed", "reported", "estimate", "manual", "forecast"];
export const SOURCE_LABEL: Record<CostSource, string> = { billed: "Billed", reported: "Provider-reported", estimate: "Estimate", manual: "Manual", forecast: "Forecast" };
export const SOURCE_BLURB: Record<CostSource, string> = {
  billed: "From an invoice the provider issued.",
  reported: "Usage the provider's own API reported, priced at the unit price on file.",
  estimate: "Calculated by Outlly from recorded usage and the unit price on file.",
  manual: "Typed in by an admin.",
  forecast: "A projection. Not a bill.",
};

export type CostCategoryId = "ai" | "transcription" | "x" | "storage" | "egress" | "email" | "hosting" | "database" | "domain" | "tooling" | "payments" | "other";
export const COST_CATEGORIES: readonly CostCategoryId[] = ["ai", "transcription", "x", "storage", "egress", "email", "hosting", "database", "domain", "tooling", "payments", "other"];
export const CATEGORY_LABEL: Record<CostCategoryId, string> = {
  ai: "AI (text)", transcription: "AI captions", x: "X API", storage: "Storage", egress: "Bandwidth", email: "Email", hosting: "Hosting", database: "Database", domain: "Domains", tooling: "Tools & services", payments: "Payment fees", other: "Other",
};

export interface ProviderDef { id: string; label: string; category: CostCategoryId; currency: string; url: string }
/** Only what Outlly uses. Adding a provider here is a code change on purpose: the dashboard never lists what we do not pay for. */
export const PROVIDERS: readonly ProviderDef[] = [
  { id: "gemini", label: "Google Gemini", category: "ai", currency: "USD", url: "https://aistudio.google.com/usage" },
  { id: "nvidia", label: "NVIDIA NIM", category: "ai", currency: "USD", url: "https://build.nvidia.com/settings/api-keys" },
  { id: "openrouter", label: "OpenRouter (Kimi)", category: "ai", currency: "USD", url: "https://openrouter.ai/activity" },
  { id: "groq", label: "Groq (Whisper)", category: "transcription", currency: "USD", url: "https://console.groq.com/settings/billing" },
  { id: "vercel", label: "Vercel", category: "hosting", currency: "USD", url: "https://vercel.com/dashboard/usage" },
  { id: "render", label: "Render", category: "hosting", currency: "USD", url: "https://dashboard.render.com/billing" },
  { id: "supabase", label: "Supabase", category: "database", currency: "USD", url: "https://supabase.com/dashboard/org/_/usage" },
  { id: "resend", label: "Resend", category: "email", currency: "USD", url: "https://resend.com/settings/billing" },
  { id: "x", label: "X API", category: "x", currency: "USD", url: "https://developer.x.com/en/portal/dashboard" },
  { id: "cloudflare", label: "Cloudflare", category: "domain", currency: "USD", url: "https://dash.cloudflare.com" },
  { id: "razorpay", label: "Razorpay", category: "payments", currency: "INR", url: "https://dashboard.razorpay.com" },
  { id: "google-play", label: "Google Play", category: "tooling", currency: "USD", url: "https://play.google.com/console" },
  { id: "other", label: "Other", category: "other", currency: "INR", url: "" },
];
export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
export const providerLabel = (id: string) => (PROVIDERS.find((p) => p.id === id) ?? { label: id }).label;

/** Outlly features a cost can be attributed to (the "what did this buy" axis). */
export const FEATURE_LABEL: Record<string, string> = {
  writing: "AI writing", captions: "AI captions", "inbox-reply": "AI inbox replies", assist: "AI assist", "support-chat": "Support chat", blog: "Blog agent", try: "Try page (signed out)", ai: "AI (unattributed)", "x-post": "Posts to X", "x-read": "X reads", storage: "Media storage", egress: "Media delivery", email: "Email", platform: "Platform",
};
export const featureLabel = (id: string) => FEATURE_LABEL[id] ?? (id ? id : "Platform");

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (c: string): c is Currency => (CURRENCIES as readonly string[]).includes(c);

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const monthStartUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const nextMonthUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
export const daysInMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** INR minor units for an amount in another currency's minor units at a given rate (INR per 1 unit). */
export const toInrMinor = (amountMinor: number, fxToInr: number) => Math.round(amountMinor * fxToInr);
/** A fractional amount in major units to integer minor units (prices like $0.0000003 per token summed over many tokens). */
export const toMinor = (amountMajor: number) => Math.round(amountMajor * 100);

export const fmtInr = (minor: number, opts: { compact?: boolean } = {}) => {
  const v = minor / 100;
  if (opts.compact && Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(v >= 1e7 ? 0 : 1)} L`;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: Math.abs(v) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}`;
};
const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$", SGD: "S$", AED: "AED " };
export const fmtMoney = (minor: number, currency: string) => `${SYMBOL[currency] ?? `${currency} `}${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A recurring amount normalised to one month (yearly plans spread evenly). */
export const monthlyShare = (amountMinor: number, cadence: string) => (cadence === "yearly" ? Math.round(amountMinor / 12) : amountMinor);

/** Parses "50,75,90,100" into sorted unique whole percents between 1 and 500. */
export function parseThresholds(raw: string): number[] {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Math.round(Number(part.trim()));
    if (Number.isFinite(n) && n >= 1 && n <= 500) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
/** Thresholds crossed at `pct` that are not yet in `already`. */
export const crossedThresholds = (pct: number, thresholds: number[], already: ReadonlySet<number> = new Set()) => thresholds.filter((t) => pct >= t && !already.has(t));

/**
 * Month-end projection from what has happened so far: the variable spend so far scaled to the whole month at the
 * average daily rate, plus the recurring commitments not yet booked this month. An estimate, labelled as such.
 */
export function forecastMonth(o: { variableMtdMinor: number; recurringRemainingMinor: number; dayOfMonth: number; daysInMonth: number }) {
  const elapsed = Math.max(1, Math.min(o.dayOfMonth, o.daysInMonth));
  const dailyRate = o.variableMtdMinor / elapsed;
  const projectedVariable = Math.round(dailyRate * o.daysInMonth);
  return { dailyRateMinor: Math.round(dailyRate), projectedVariableMinor: projectedVariable, projectedTotalMinor: projectedVariable + Math.max(0, o.recurringRemainingMinor), confidence: elapsed < 5 ? ("low" as const) : elapsed < 15 ? ("medium" as const) : ("high" as const) };
}

/** RFC 4180 CSV: quotes any field with a comma, quote or newline. */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.floor((part / whole) * 100) : part > 0 ? 100 : 0);
