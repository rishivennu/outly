import "server-only";
import { db } from "../db";
import { env } from "../env";
import { dayKey, monthStartUtc } from "./core";
import { addDays, detectSpikes, recommend, spikeAlert, type InsightInput, type Recommendation } from "./insights-core";
import type { Overview } from "./overview";

/**
 * R1332 Costs Phase 5, the I/O half: spikes from the daily rollup (run by the sweep), recommendations for the
 * dashboard from the overview plus a few extra reads, and the email that backs a warn/critical alert.
 */

/** Yesterday (UTC) against the week before it, one alert per provider per day. Returns how many alerts were new. */
export async function sweepSpikes(now = new Date()) {
  const day = addDays(dayKey(now), -1);
  const rows = await db.costDaily.findMany({ where: { day: { gte: addDays(day, -7), lte: day } }, select: { day: true, provider: true, source: true, inrMinor: true } });
  const { raiseAlert } = await import("./manual");
  let raised = 0;
  for (const s of detectSpikes(rows, day)) if (await raiseAlert(spikeAlert(s))) raised++;
  return raised;
}

/** The extra reads the rules need beyond the overview: this month's variable spend per provider, Razorpay fees by method, AI models. */
export async function recommendationsFor(o: Overview, now = new Date()): Promise<Recommendation[]> {
  const mFrom = dayKey(monthStartUtc(now)), mTo = dayKey(now);
  const [monthRows, feeRows, ai] = await Promise.all([
    db.costDaily.findMany({ where: { day: { gte: mFrom, lte: mTo }, source: { in: ["estimate", "reported"] } }, select: { provider: true, inrMinor: true } }),
    db.costEvent.findMany({ where: { provider: "razorpay", day: { gte: o.range.from, lte: o.range.to }, ref: { startsWith: "razorpay:fee:" } }, select: { amountMinor: true, fxToInr: true, meta: true } }),
    import("./overview").then((m) => m.aiBreakdown({ from: o.range.from, to: o.range.to, now })).catch(() => null),
  ]);
  const variableByProvider: Record<string, number> = {};
  for (const r of monthRows) variableByProvider[r.provider] = (variableByProvider[r.provider] ?? 0) + r.inrMinor;
  const byMethod = new Map<string, { method: string; feeMinor: number; amountMinor: number; count: number }>();
  for (const f of feeRows) {
    let meta: { method?: unknown; amount?: unknown } = {};
    try { meta = JSON.parse(f.meta || "{}"); } catch { /* unreadable meta: counted as unknown method */ }
    const method = typeof meta.method === "string" && meta.method ? meta.method : "unknown";
    const amount = typeof meta.amount === "number" && Number.isFinite(meta.amount) ? meta.amount : 0;
    const cur = byMethod.get(method) ?? { method, feeMinor: 0, amountMinor: 0, count: 0 };
    cur.feeMinor += Math.round(f.amountMinor * f.fxToInr);
    cur.amountMinor += Math.round(amount * f.fxToInr);
    cur.count++;
    byMethod.set(method, cur);
  }
  const input: InsightInput = {
    month: o.month,
    totalMinor: o.totalMinor,
    bySource: o.bySource,
    byFeature: o.byFeature,
    variableByProvider,
    budgets: o.budgets,
    recurring: o.recurring,
    connections: o.connections,
    aiModels: ai?.byModel ?? [],
    fees: [...byMethod.values()],
  };
  return recommend(input);
}

/** A warn/critical cost alert also goes to the System Health alert address, when one is set. Never throws. */
export async function emailCostAlert(a: { title: string; body?: string; href?: string; severity?: string }) {
  try {
    const { watchdogConfig } = await import("../health/config");
    const cfg = await watchdogConfig();
    if (!cfg.alertEmail) return { sent: false, status: "no alert email" };
    const { sendEmail } = await import("../email");
    const href = `${env.APP_URL.replace(/\/$/, "")}${a.href ?? "/admin/costs"}`;
    const body = a.body ?? "";
    const r = await sendEmail({ to: cfg.alertEmail, kind: "costs", subject: `Costs${a.severity === "critical" ? " (critical)" : ""}: ${a.title}`, html: costEmailHtml(a.title, body, href), text: `${a.title}\n\n${body}\n\n${href}` });
    return { sent: r.ok && r.status !== "mocked", status: r.status };
  } catch (e) {
    console.error("[costs] alert email", e);
    return { sent: false, status: "failed" };
  }
}

function costEmailHtml(title: string, body: string, href: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111"><h2 style="margin:0 0 12px">${esc(title)}</h2><p style="margin:0 0 16px;white-space:pre-wrap">${esc(body)}</p><p><a href="${esc(href)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Open Infrastructure &amp; Costs</a></p><p style="color:#666;font-size:13px">Sent by Outlly's cost sweep. The same alert is in the admin bell; acknowledge it there and it will not come back for the same condition. Change the address under System Health &gt; Alert settings.</p></div>`;
}
