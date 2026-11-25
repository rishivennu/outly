import { fmtInr, providerLabel } from "./core";

/**
 * R1332 Costs Phase 5, the pure half. Spike detection compares one day's variable spend per provider with the week
 * before it; recommendations are a handful of plain rules over the month's numbers. No I/O here so both are tested
 * against hand-made inputs; `lib/costs/insights.ts` feeds them from the ledger.
 */
export interface DaySpend { day: string; provider: string; source: string; inrMinor: number }
export interface Spike { provider: string; day: string; inrMinor: number; baselineMinor: number; ratio: number; severity: "warn" | "critical" }
export interface SpikeOpts {
  /** Below this a day is never a spike (noise on tiny amounts). */
  floorMinor: number;
  /** A provider with nothing in the prior week needs at least this much to count as new spend worth a look. */
  newFloorMinor: number;
  ratio: number;
  criticalRatio: number;
}
export const SPIKE_DEFAULTS: SpikeOpts = { floorMinor: 5000, newFloorMinor: 20000, ratio: 2.5, criticalRatio: 5 };

export const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * `day` against the median of the seven days before it, per provider, variable spend only (estimate + reported).
 * Manual renewals and invoices land in one lump on purpose and are left out. A missing day counts as zero, so a
 * provider that is quiet most days and busy one day does read as a spike: that is the point.
 */
export function detectSpikes(rows: DaySpend[], day: string, opts: SpikeOpts = SPIKE_DEFAULTS): Spike[] {
  const variable = rows.filter((r) => r.source === "estimate" || r.source === "reported");
  const prior = Array.from({ length: 7 }, (_, i) => addDays(day, -(i + 1)));
  const sum = (provider: string, d: string) => variable.filter((r) => r.provider === provider && r.day === d).reduce((s, r) => s + r.inrMinor, 0);
  const out: Spike[] = [];
  for (const provider of new Set(variable.map((r) => r.provider))) {
    const today = sum(provider, day);
    if (today < opts.floorMinor) continue;
    const baseline = median(prior.map((d) => sum(provider, d)));
    if (baseline <= 0) {
      if (today < opts.newFloorMinor) continue;
      out.push({ provider, day, inrMinor: today, baselineMinor: 0, ratio: Infinity, severity: today >= opts.newFloorMinor * 5 ? "critical" : "warn" });
      continue;
    }
    const ratio = today / baseline;
    if (ratio < opts.ratio) continue;
    out.push({ provider, day, inrMinor: today, baselineMinor: baseline, ratio, severity: ratio >= opts.criticalRatio ? "critical" : "warn" });
  }
  return out.sort((a, b) => b.inrMinor - a.inrMinor);
}

export function spikeAlert(s: Spike) {
  const name = providerLabel(s.provider);
  const usual = s.baselineMinor > 0 ? `${s.ratio.toFixed(1)}x its usual day (${fmtInr(s.baselineMinor)} median over the week before)` : "with nothing recorded in the week before";
  return {
    key: `spike:${s.provider}:${s.day}`,
    kind: "spike",
    severity: s.severity,
    title: `${name} spent ${fmtInr(s.inrMinor)} on ${s.day}`,
    body: `That is ${usual}. Check the ledger for that day: a runaway job, a new feature, or a price change on ${name}'s side.`,
    href: `/admin/costs?from=${s.day}&to=${s.day}`,
  };
}

/* ---------- Recommendations ---------- */

export interface InsightInput {
  month: { variableMtdMinor: number; dayOfMonth: number; daysInMonth: number; forecast: { projectedTotalMinor: number } };
  totalMinor: number;
  bySource: Record<string, number>;
  byFeature: { key: string; inrMinor: number }[];
  /** This month's variable spend (estimate + reported) per provider. */
  variableByProvider: Record<string, number>;
  budgets: { id: string; name: string; scope: string; key: string; inrMinor: number; spentMinor: number; active: boolean }[];
  recurring: { id: string; name: string; provider: string; monthlyInrMinor: number; active: boolean }[];
  connections: { provider: string; status: string }[];
  aiModels: { model: string; provider: string; calls: number; inrMinor: number; perThousandCallsMinor: number; unpriced: boolean }[];
  /** Razorpay fee events in the range, grouped by payment method. */
  fees: { method: string; feeMinor: number; amountMinor: number; count: number }[];
}
export interface Recommendation { id: string; severity: "info" | "warn"; title: string; body: string; href: string; saveMinor: number | null }

/** Providers whose usage Outlly meters, so "no usage this month" means something. */
const METERED = new Set(["gemini", "groq", "openrouter", "nvidia", "resend", "x", "supabase", "vercel", "render"]);
const CARD_LIKE = new Set(["card", "emi", "netbanking", "wallet", "paylater"]);
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export function recommend(i: InsightInput): Recommendation[] {
  const out: Recommendation[] = [];
  const { dayOfMonth: dom, daysInMonth: dim } = i.month;

  // 1. Budgets on course to be exceeded at this month's pace (the total budget uses the dashboard's own forecast).
  for (const b of i.budgets) {
    if (!b.active || b.inrMinor <= 0 || b.spentMinor <= 0 || dom < 3) continue;
    const projected = b.scope === "total" ? i.month.forecast.projectedTotalMinor : Math.round((b.spentMinor / dom) * dim);
    if (projected <= b.inrMinor) continue;
    out.push({
      id: `budget-pace:${b.id}`,
      severity: "warn",
      title: `${b.name} is on course for ${fmtInr(projected)} against a ${fmtInr(b.inrMinor)} budget`,
      body: `${fmtInr(b.spentMinor)} spent by day ${dom} of ${dim}. At this pace the month ends about ${fmtInr(projected - b.inrMinor)} over. Raise the budget if that is planned, or find the driver in the breakdowns above.`,
      href: "/admin/costs",
      saveMinor: null,
    });
  }

  // 2. A metered provider with no usage this month that still renews.
  if (dom >= 7)
    for (const r of i.recurring) {
      if (!r.active || !METERED.has(r.provider) || (i.variableByProvider[r.provider] ?? 0) > 0) continue;
      out.push({
        id: `idle:${r.id}`,
        severity: "info",
        title: `No ${providerLabel(r.provider)} usage recorded this month, but ${r.name} still renews`,
        body: `${fmtInr(r.monthlyInrMinor)} a month. If the plan is really idle, downgrade or cancel it. If usage just is not reaching the ledger, connect the provider so the dashboard sees it.`,
        href: "/admin/costs",
        saveMinor: r.monthlyInrMinor,
      });
    }

  // 3. Two hosts at once.
  const hosts = i.recurring.filter((r) => r.active && (r.provider === "vercel" || r.provider === "render"));
  if (hosts.some((h) => h.provider === "vercel") && hosts.some((h) => h.provider === "render")) {
    const v = hosts.filter((h) => h.provider === "vercel").reduce((s, h) => s + h.monthlyInrMinor, 0);
    const r = hosts.filter((h) => h.provider === "render").reduce((s, h) => s + h.monthlyInrMinor, 0);
    out.push({
      id: "hosting-overlap",
      severity: "info",
      title: "Two hosts are being paid for",
      body: `Vercel (${fmtInr(v)} a month) and Render (${fmtInr(r)} a month) both renew. Once the migration is done, cancel the one left behind.`,
      href: "/admin/costs",
      saveMinor: Math.min(v, r),
    });
  }

  // 4. AI spend concentrated on a model that costs several times a cheaper one already in use.
  const priced = i.aiModels.filter((m) => !m.unpriced && m.calls > 0 && m.perThousandCallsMinor > 0).sort((a, b) => b.inrMinor - a.inrMinor);
  const aiTotal = priced.reduce((s, m) => s + m.inrMinor, 0);
  if (priced.length >= 2 && aiTotal > 0 && priced[0].inrMinor / aiTotal >= 0.6) {
    const top = priced[0];
    const cheap = priced.filter((m) => m !== top && m.perThousandCallsMinor <= top.perThousandCallsMinor / 2).sort((a, b) => a.perThousandCallsMinor - b.perThousandCallsMinor)[0];
    if (cheap) {
      const halfSave = Math.round((top.inrMinor / 2) * (1 - cheap.perThousandCallsMinor / top.perThousandCallsMinor));
      out.push({
        id: `ai-mix:${top.model}`,
        severity: "info",
        title: `Most AI spend is ${top.model}`,
        body: `${pct(top.inrMinor, aiTotal)}% of AI spend, at ${fmtInr(top.perThousandCallsMinor)} per 1k calls. ${cheap.model} already handles ${cheap.calls.toLocaleString("en-IN")} calls at ${fmtInr(cheap.perThousandCallsMinor)} per 1k. Moving half of the routine calls to it would save about ${fmtInr(halfSave)} over the same period.`,
        href: "/admin/costs?view=ai",
        saveMinor: halfSave,
      });
    }
  }

  // 5. Card fees against UPI when both are in use.
  const paid = i.fees.reduce((s, f) => s + f.amountMinor, 0);
  const cards = i.fees.filter((f) => CARD_LIKE.has(f.method));
  const upi = i.fees.filter((f) => f.method === "upi");
  const cardAmt = cards.reduce((s, f) => s + f.amountMinor, 0), cardFee = cards.reduce((s, f) => s + f.feeMinor, 0);
  const upiAmt = upi.reduce((s, f) => s + f.amountMinor, 0), upiFee = upi.reduce((s, f) => s + f.feeMinor, 0);
  if (paid > 0 && cardAmt > 0 && upiAmt > 0 && cardAmt / paid >= 0.4) {
    const cardRate = cardFee / cardAmt, upiRate = upiFee / upiAmt;
    if (cardRate - upiRate >= 0.005) {
      out.push({
        id: "fees-method",
        severity: "info",
        title: `Card payments cost ${pct(cardFee, cardAmt)}% in fees; UPI costs ${pct(upiFee, upiAmt)}%`,
        body: `Cards and bank transfers carried ${pct(cardAmt, paid)}% of the money paid in this range. Showing UPI first at checkout for buyers in India brings the blended fee down, up to ${fmtInr(Math.round(cardAmt * (cardRate - upiRate)))} on this range's volume.`,
        href: "/admin/payments",
        saveMinor: Math.round(cardAmt * (cardRate - upiRate)),
      });
    }
  }

  // 6. Mostly estimates while connectable providers are not connected.
  const est = i.bySource.estimate ?? 0;
  const unconnected = ["vercel", "render", "supabase"].filter((p) => (i.variableByProvider[p] ?? 0) > 0 || i.recurring.some((r) => r.active && r.provider === p)).filter((p) => !i.connections.some((c) => c.provider === p && c.status === "ok"));
  if (i.totalMinor > 0 && est / i.totalMinor >= 0.7 && unconnected.length) {
    out.push({
      id: "estimates-heavy",
      severity: "info",
      title: "Most of these numbers are Outlly's own estimates",
      body: `${pct(est, i.totalMinor)}% of the range is estimated from usage and the unit prices on file. Connect ${unconnected.map(providerLabel).join(", ")} under Provider connections so plans and bandwidth come from the providers' own APIs.`,
      href: "/admin/costs",
      saveMinor: null,
    });
  }

  // 7. Reading X costs more than posting to it.
  const feat = (k: string) => i.byFeature.find((f) => f.key === k)?.inrMinor ?? 0;
  const reads = feat("x-read"), posts = feat("x-post");
  if (reads >= 10000 && reads > posts) {
    out.push({
      id: "x-reads",
      severity: "info",
      title: "Reading X costs more than posting to it",
      body: `${fmtInr(reads)} on reads against ${fmtInr(posts)} on posts. Reads come from the Inbox comment check and the live dashboard; a longer comment cache or fewer dashboard refreshes cuts them without touching publishing.`,
      href: "/admin/costs",
      saveMinor: null,
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? (b.saveMinor ?? -1) - (a.saveMinor ?? -1) : a.severity === "warn" ? -1 : 1));
}
