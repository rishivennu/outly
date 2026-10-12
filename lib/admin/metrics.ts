import "server-only";
import { subDays } from "date-fns";
import { db } from "../db";
import { cached } from "../cache";
import { FX_PER_USD, isCurrency } from "../billing/currency";

/** Visitors now pay in their own currency, so every total is converted to the reporting currency at the list-price rate. */
const convert = (minor: number, from: string, to: string) => (from === to || !isCurrency(from) || !isCurrency(to) ? minor : Math.round((minor / FX_PER_USD[from]) * FX_PER_USD[to]));

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Several admins refreshing the overview share one computation per 20 s. */
export function overview(days = 90) {
  return cached(`admin:overview:${days}`, 20_000, () => computeOverview(days));
}

async function computeOverview(days: number) {
  const now = new Date();
  const since = subDays(now, days - 1);
  since.setUTCHours(0, 0, 0, 0);
  const [users, activity, subs, pays, tickets, plans] = await Promise.all([
    db.user.findMany({ select: { id: true, createdAt: true } }),
    db.userActivityDay.findMany({ where: { day: { gte: dayKey(subDays(now, Math.max(days, 30))) } }, select: { userId: true, day: true } }),
    db.subscription.findMany({ select: { id: true, planId: true, status: true, priceMinor: true, currency: true, interval: true, createdAt: true, canceledAt: true, sample: true } }),
    db.payment.findMany({ where: { createdAt: { gte: since } }, select: { amountMinor: true, currency: true, status: true, createdAt: true, planId: true, sample: true } }),
    db.ticket.groupBy({ by: ["status", "priority"], _count: true }),
    db.plan.findMany({ select: { id: true, name: true } }),
  ]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const today = dayKey(now);
  const distinct = (fromDay: string) => new Set(activity.filter((a) => a.day >= fromDay).map((a) => a.userId)).size;
  const dau = distinct(today);
  const wau = distinct(dayKey(subDays(now, 6)));
  const mau = distinct(dayKey(subDays(now, 29)));

  const ccy = (() => {
    const c = new Map<string, number>();
    for (const s of subs) c.set(s.currency, (c.get(s.currency) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "INR";
  })();
  const active = subs.filter((s) => s.status === "active");
  const mrr = active.reduce((t, s) => t + convert(s.interval === "year" ? s.priceMinor / 12 : s.priceMinor, s.currency, ccy), 0);

  const d30 = subDays(now, 30);
  const activeAtStart = subs.filter((s) => s.createdAt < d30 && (!s.canceledAt || s.canceledAt >= d30)).length;
  const canceled30 = subs.filter((s) => s.canceledAt && s.canceledAt >= d30).length;
  const churn = activeAtStart ? canceled30 / activeAtStart : 0;

  const ok = pays.filter((p) => p.status === "succeeded").map((p) => ({ ...p, amountMinor: convert(p.amountMinor, p.currency, ccy), currency: ccy }));
  const rev30 = ok.filter((p) => p.createdAt >= d30).reduce((t, p) => t + p.amountMinor, 0);
  const prevRows = await db.payment.groupBy({ by: ["currency"], _sum: { amountMinor: true }, where: { status: "succeeded", createdAt: { gte: subDays(now, 60), lt: d30 } } });
  const revPrev = { _sum: { amountMinor: prevRows.reduce((t, r) => t + convert(r._sum.amountMinor ?? 0, r.currency, ccy), 0) } };
  const failed7 = pays.filter((p) => p.status === "failed" && p.createdAt >= subDays(now, 7)).length;
  const signups30 = users.filter((u) => u.createdAt >= d30).length;
  const signupsPrev = users.filter((u) => u.createdAt >= subDays(now, 60) && u.createdAt < d30).length;

  // ------- daily series
  const series: { day: string; label: string; users: number; signups: number; active: number; revenue: number; newSubs: number; cancels: number; activeSubs: number }[] = [];
  const actByDay = new Map<string, Set<string>>();
  for (const a of activity) (actByDay.get(a.day) ?? actByDay.set(a.day, new Set()).get(a.day)!).add(a.userId);
  for (let i = 0; i < days; i++) {
    const d = subDays(now, days - 1 - i);
    const k = dayKey(d);
    const end = new Date(k + "T23:59:59.999Z");
    series.push({
      day: k,
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      users: users.filter((u) => u.createdAt <= end).length,
      signups: users.filter((u) => dayKey(u.createdAt) === k).length,
      active: actByDay.get(k)?.size ?? 0,
      revenue: ok.filter((p) => dayKey(p.createdAt) === k).reduce((t, p) => t + p.amountMinor, 0) / 100,
      newSubs: subs.filter((s) => dayKey(s.createdAt) === k).length,
      cancels: subs.filter((s) => s.canceledAt && dayKey(s.canceledAt) === k).length,
      activeSubs: subs.filter((s) => s.createdAt <= end && (!s.canceledAt || s.canceledAt > end)).length,
    });
  }
  const byPlan = new Map<string, number>();
  for (const p of ok) byPlan.set(planName.get(p.planId ?? "") ?? "Other", (byPlan.get(planName.get(p.planId ?? "") ?? "Other") ?? 0) + p.amountMinor);
  const openTickets = tickets.filter((t) => t.status !== "resolved").reduce((n, t) => n + t._count, 0);
  const urgentTickets = tickets.filter((t) => t.status !== "resolved" && t.priority === "urgent").reduce((n, t) => n + t._count, 0);
  const sample = subs.some((s) => s.sample) || pays.some((p) => p.sample);

  return {
    currency: ccy,
    kpi: { dau, wau, mau, totalUsers: users.length, signups30, signupsPrev, mrr, rev30, revPrev: revPrev._sum.amountMinor ?? 0, failed7, churn, activeSubs: active.length, openTickets, urgentTickets },
    series,
    revenueByPlan: [...byPlan.entries()].map(([name, v]) => ({ name, value: v / 100 })).sort((a, b) => b.value - a.value),
    sample,
  };
}
