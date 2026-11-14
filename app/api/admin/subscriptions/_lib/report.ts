import "server-only";
import { db } from "@/lib/db";
import { adminEvent } from "@/lib/admin/route";
import type { AdminSession } from "@/lib/admin/auth";
import { formatMoney, intervalLabel } from "@/lib/billing/money";

export const TIERS = ["intro", "standard", "legacy", "founding"] as const;
export type Tier = (typeof TIERS)[number];
export const FLAG_STATUSES = ["open", "verified", "cleared", "confirmed"] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const validMonth = (m: string | null | undefined) => (m && MONTH_RE.test(m) ? m : monthKey());

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Margin as a share of net revenue; null when there was no revenue to measure against. */
export const marginOf = (revenue: number, fee: number, cost: number) => (revenue > 0 ? (revenue - fee - cost) / revenue : null);

/** AuditLog row + AdminEvent for every subscriptions change, so the change history and the activity feed both show it. */
export async function subsAudit(admin: Pick<AdminSession, "login" | "role" | "name">, e: { action: string; targetType: string; targetId?: string | null; email?: string | null; before?: unknown; after?: unknown; note?: string; title: string; body?: string }) {
  const snap = (v: unknown) => (v === undefined ? null : JSON.stringify(v).slice(0, 20_000));
  await db.auditLog
    .create({ data: { actor: admin.login.slice(0, 120), actorRole: admin.role, action: e.action, targetType: e.targetType, targetId: e.targetId ?? null, email: e.email?.toLowerCase() ?? null, before: snap(e.before), after: snap(e.after), note: (e.note ?? "").slice(0, 500) } })
    .catch((err) => console.error("[subs-audit]", err));
  await adminEvent("subscriptions", e.title, e.body, "/admin/subscriptions");
}

export type Funnel = { started: number; active: number; converted: number; expired: number; canceled: number; conversionPct: number; decidedPct: number };

/** Trial funnel for trials started in [from, to). conversionPct is of all started; decidedPct only counts trials that have ended. */
export async function trialFunnel(range: { from?: Date; to?: Date } = {}): Promise<Funnel> {
  const where = range.from || range.to ? { startedAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } } : {};
  const g = await db.trial.groupBy({ by: ["status"], where, _count: true });
  const n = (s: string) => g.find((r) => r.status === s)?._count ?? 0;
  const [active, converted, expired, canceled] = [n("active"), n("converted"), n("expired"), n("canceled")];
  const started = g.reduce((a, r) => a + r._count, 0);
  const decided = converted + expired + canceled;
  return { started, active, converted, expired, canceled, conversionPct: started ? converted / started : 0, decidedPct: decided ? converted / decided : 0 };
}

export type SubscriberRow = { subscriptionId: string; userId: string; email: string; name: string | null; plan: string; planSlug: string; tier: string; priceMinor: number; currency: string; interval: string; status: string; currentPeriodEnd: string; pausedUntil: string | null; createdAt: string; policyVersion: string | null };

export async function listSubscribers(f: { q?: string; tier?: string; status?: string; take?: number; skip?: number } = {}) {
  const take = Math.min(Math.max(f.take ?? 50, 1), 200);
  const where = {
    sample: false,
    ...(f.tier && (TIERS as readonly string[]).includes(f.tier) ? { priceTier: f.tier } : {}),
    ...(f.status && ["active", "past_due", "canceled"].includes(f.status) ? { status: f.status } : {}),
    ...(f.q?.trim() ? { user: { email: { contains: f.q.trim().toLowerCase() } } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.subscription.findMany({ where, orderBy: { createdAt: "desc" }, take, skip: Math.max(f.skip ?? 0, 0), include: { user: { select: { email: true, name: true } }, plan: { select: { name: true, slug: true } } } }),
    db.subscription.count({ where }),
  ]);
  const list: SubscriberRow[] = rows.map((s) => ({
    subscriptionId: s.id, userId: s.userId, email: s.user.email, name: s.user.name, plan: s.plan.name, planSlug: s.plan.slug, tier: s.priceTier,
    priceMinor: s.priceMinor, currency: s.currency, interval: s.interval, status: s.status, currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    pausedUntil: s.pausedUntil?.toISOString() ?? null, createdAt: s.createdAt.toISOString(), policyVersion: s.policyVersion,
  }));
  return { rows: list, total };
}

export type TimelineEvent = { at: string; kind: "subscription" | "payment" | "trial" | "risk" | "ledger" | "admin" | "month"; title: string; detail?: string; tone?: "ok" | "warn" | "bad" | "muted" };

/** Everything that decided what this person pays, newest first. */
export async function subscriberHistory(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, phone: true, createdAt: true, foundingNo: true, foundingPct: true } });
  if (!user) return null;
  const [subs, pays, trial, flags, ledger, months, audits] = await Promise.all([
    db.subscription.findMany({ where: { userId }, include: { plan: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.payment.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, take: 200 }),
    db.trial.findUnique({ where: { userId } }),
    db.riskFlag.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.offerLedger.findMany({ where: { userId } }),
    db.subscriberMonth.findMany({ where: { userId }, orderBy: { month: "asc" } }),
    db.auditLog.findMany({ where: { email: user.email.toLowerCase(), action: { startsWith: "subs." } }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const planIds = [...new Set(pays.map((p) => p.planId).filter((x): x is string => !!x))];
  const planNames = new Map((planIds.length ? await db.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } }) : []).map((p) => [p.id, p.name]));
  const ev: TimelineEvent[] = [];
  for (const s of subs) {
    ev.push({ at: s.createdAt.toISOString(), kind: "subscription", title: `Subscribed to ${s.plan.name}`, detail: `${s.priceTier} tier, ${formatMoney(s.priceMinor, s.currency)}${intervalLabel(s.interval)}${s.policyVersion ? `, policy ${s.policyVersion}` : ""}`, tone: "ok" });
    if (s.pausedUntil) ev.push({ at: s.updatedAt.toISOString(), kind: "subscription", title: "Paused", detail: `Until ${s.pausedUntil.toISOString().slice(0, 10)}. A pause is not a lapse.`, tone: "muted" });
    if (s.canceledAt) ev.push({ at: s.canceledAt.toISOString(), kind: "subscription", title: `Canceled ${s.plan.name}`, detail: `Access until ${s.currentPeriodEnd.toISOString().slice(0, 10)}`, tone: "warn" });
  }
  for (const p of pays) {
    if (p.status === "pending") continue;
    const what = p.purpose === "topup" ? "Pack" : p.purpose === "renewal" ? "Renewal" : "Payment";
    ev.push({ at: p.updatedAt.toISOString(), kind: "payment", title: `${what} ${p.status}${p.planId && planNames.has(p.planId) ? ` (${planNames.get(p.planId)})` : ""}`, detail: `${formatMoney(p.amountMinor, p.currency)} via ${p.provider}${p.priceTier ? `, ${p.priceTier} tier` : ""}${p.failureReason ? `: ${p.failureReason}` : ""}`, tone: p.status === "succeeded" ? "ok" : p.status === "refunded" ? "warn" : "bad" });
  }
  if (trial) {
    ev.push({ at: trial.startedAt.toISOString(), kind: "trial", title: "Trial started", detail: `Ends ${trial.endsAt.toISOString().slice(0, 10)}, from ${trial.source}`, tone: "ok" });
    const end = trial.convertedAt ?? trial.canceledAt ?? trial.expiredAt;
    if (end) ev.push({ at: end.toISOString(), kind: "trial", title: `Trial ${trial.status}`, tone: trial.status === "converted" ? "ok" : "muted" });
  }
  for (const f of flags) {
    ev.push({ at: f.createdAt.toISOString(), kind: "risk", title: `Risk ${f.level} (${f.score}) at ${f.context}`, detail: `Action ${f.action}, status ${f.status}`, tone: f.level === "high" ? "bad" : f.level === "medium" ? "warn" : "muted" });
    if (f.reviewedAt) ev.push({ at: f.reviewedAt.toISOString(), kind: "risk", title: `Flag ${f.status} by ${f.reviewedBy ?? "admin"}`, detail: f.note ?? undefined, tone: "muted" });
  }
  for (const l of ledger) {
    if (l.trialUsedAt) ev.push({ at: l.trialUsedAt.toISOString(), kind: "ledger", title: `Trial recorded on ${l.kind} key`, tone: "muted" });
    if (l.firstPaidAt) ev.push({ at: l.firstPaidAt.toISOString(), kind: "ledger", title: `First paid on ${l.kind} key`, detail: l.lastPaidUntil ? `Paid until ${l.lastPaidUntil.toISOString().slice(0, 10)}` : undefined, tone: "muted" });
  }
  for (const a of audits) ev.push({ at: a.createdAt.toISOString(), kind: "admin", title: a.action, detail: [a.actor, a.note].filter(Boolean).join(": "), tone: "muted" });
  ev.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    user: { id: user.id, email: user.email, name: user.name, phoneVerified: !!user.phone, createdAt: user.createdAt.toISOString(), founding: user.foundingNo != null ? { no: user.foundingNo, pct: user.foundingPct } : null },
    months: months.map((m) => ({ month: m.month, tier: m.tier, revenueMinor: m.revenueMinor, feeMinor: m.feeMinor, costMinor: m.costMinor, budgetMinor: m.budgetMinor, margin: marginOf(m.revenueMinor, m.feeMinor, m.costMinor), breakdown: parseJson<Record<string, number>>(m.costBreakdown, {}) })),
    timeline: ev,
  };
}

export type FlagRow = { id: string; userId: string | null; email: string | null; score: number; level: string; action: string; status: string; context: string; reasons: { code: string; weight: number; detail?: string }[]; related: { id: string; email: string | null }[]; ticket: { id: string; ref: string; status: string } | null; note: string | null; reviewedBy: string | null; reviewedAt: string | null; createdAt: string };

export async function listFlags(f: { status?: string; take?: number } = {}) {
  const status = f.status && (FLAG_STATUSES as readonly string[]).includes(f.status) ? f.status : undefined;
  const where = status ? { status } : f.status === "all" ? {} : { status: "open" };
  const [flags, counts] = await Promise.all([
    db.riskFlag.findMany({ where, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: Math.min(Math.max(f.take ?? 100, 1), 300) }),
    db.riskFlag.groupBy({ by: ["status"], _count: true }),
  ]);
  const parsed = flags.map((r) => ({ r, related: parseJson<unknown[]>(r.relatedUserIds, []).filter((x): x is string => typeof x === "string").slice(0, 20) }));
  const ids = [...new Set(parsed.flatMap(({ r, related }) => [r.userId, ...related]).filter((x): x is string => !!x))];
  const ticketIds = [...new Set(flags.map((r) => r.ticketId).filter((x): x is string => !!x))];
  const [users, tickets] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : Promise.resolve([]),
    ticketIds.length ? db.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, ref: true, status: true } }) : Promise.resolve([]),
  ]);
  const email = (id: string | null) => (id ? users.find((u) => u.id === id)?.email ?? null : null);
  const rows: FlagRow[] = parsed.map(({ r, related }) => ({
    id: r.id, userId: r.userId, email: email(r.userId), score: r.score, level: r.level, action: r.action, status: r.status, context: r.context,
    reasons: parseJson<FlagRow["reasons"]>(r.reasons, []).filter((x) => x && typeof x.code === "string"),
    related: related.map((id) => ({ id, email: email(id) })),
    ticket: tickets.find((t) => t.id === r.ticketId) ?? null,
    note: r.note, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  }));
  const count = Object.fromEntries(FLAG_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0])) as Record<FlagStatus, number>;
  return { rows, counts: count };
}

export type EconRow = { userId: string; email: string | null; plan: string; tier: string; revenueMinor: number; feeMinor: number; costMinor: number; profitMinor: number; budgetMinor: number; margin: number | null; overBudget: boolean };
export type EconPlan = { plan: string; subscribers: number; revenueMinor: number; feeMinor: number; costMinor: number; profitMinor: number; margin: number | null; belowTarget: number };

/** Per subscriber and per plan revenue, cost, profit and margin for one UTC month (all INR paise, revenue net of GST). */
export async function economicsReport(month: string, target = 0.6) {
  const m = validMonth(month);
  const rows = await db.subscriberMonth.findMany({ where: { month: m }, orderBy: { revenueMinor: "desc" }, take: 2000 });
  const ids = rows.map((r) => r.userId);
  const [users, subs] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : Promise.resolve([]),
    ids.length ? db.subscription.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { userId: true, plan: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const planOf = (id: string) => subs.find((s) => s.userId === id)?.plan.name ?? "No plan";
  const list: EconRow[] = rows.map((r) => {
    const profit = r.revenueMinor - r.feeMinor - r.costMinor;
    return { userId: r.userId, email: users.find((u) => u.id === r.userId)?.email ?? null, plan: planOf(r.userId), tier: r.tier, revenueMinor: r.revenueMinor, feeMinor: r.feeMinor, costMinor: r.costMinor, profitMinor: profit, budgetMinor: r.budgetMinor, margin: marginOf(r.revenueMinor, r.feeMinor, r.costMinor), overBudget: r.budgetMinor > 0 && r.costMinor > r.budgetMinor };
  });
  const byPlan = new Map<string, EconPlan>();
  for (const r of list) {
    const p = byPlan.get(r.plan) ?? { plan: r.plan, subscribers: 0, revenueMinor: 0, feeMinor: 0, costMinor: 0, profitMinor: 0, margin: null, belowTarget: 0 };
    p.subscribers++;
    p.revenueMinor += r.revenueMinor;
    p.feeMinor += r.feeMinor;
    p.costMinor += r.costMinor;
    p.profitMinor += r.profitMinor;
    if (r.margin !== null && r.margin < target) p.belowTarget++;
    byPlan.set(r.plan, p);
  }
  const plans = [...byPlan.values()].map((p) => ({ ...p, margin: marginOf(p.revenueMinor, p.feeMinor, p.costMinor) }));
  const sum = (k: "revenueMinor" | "feeMinor" | "costMinor" | "profitMinor") => list.reduce((a, r) => a + r[k], 0);
  const totals = { subscribers: list.length, revenueMinor: sum("revenueMinor"), feeMinor: sum("feeMinor"), costMinor: sum("costMinor"), profitMinor: sum("profitMinor"), margin: marginOf(sum("revenueMinor"), sum("feeMinor"), sum("costMinor")), belowTarget: list.filter((r) => r.margin !== null && r.margin < target).length };
  return { month: m, target, rows: list, plans, totals };
}
