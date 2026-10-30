import "server-only";
import { db } from "../db";
import { signDocs, type PipDoc } from "./links";
import { previousRange, type DateRange } from "./range";
import { amountWhere, base, day, fetchAll, money, pageArgs, pct, plural, settle, sumBy, within, zipLink, type PipArgs, type PipCtx } from "./tools-core";
import type { PipResult } from "./types";

/**
 * Money answers (1049). Plain database queries only: every amount, count and date here is read, never
 * generated. Owner only (the dispatcher refuses teammates before any of this runs).
 */
const cycle = (i: string) => (i === "year" ? "Yearly" : "Monthly");
async function planNames() {
  const plans = await db.plan.findMany({ select: { id: true, name: true } });
  return new Map(plans.map((p) => [p.id, p.name]));
}
const wants = (msg: string, re: RegExp) => re.test(msg.toLowerCase());

export async function invoices(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "invoices",
    "Your invoices",
    range,
    [
      { key: "number", label: "Invoice", mono: true },
      { key: "date", label: "Date" },
      { key: "item", label: "For" },
      { key: "amount", label: "Amount", align: "end" },
      { key: "status", label: "Status" },
    ],
    range ? "No invoices in that period." : "You don't have any invoices yet. One is issued for every plan payment.",
    period,
  );
  const status = a.status === "refunded" ? "refunded" : a.status === "paid" ? "paid" : null;
  const where = {
    userId: ctx.ownerId,
    issuedAt: within(range),
    amountMinor: amountWhere(a),
    ...(status === "refunded" ? { OR: [{ creditNote: { isNot: null } }, { payment: { status: "refunded" } }] } : {}),
    ...(status === "paid" ? { creditNote: { is: null }, OR: [{ paymentId: null }, { payment: { status: { not: "refunded" } } }] } : {}),
  };
  const [found, got] = await Promise.all([
    db.invoice.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.invoice.findMany({
        where,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, number: true, issuedAt: true, description: true, amountMinor: true, currency: true, payment: { select: { status: true } }, creditNote: { select: { number: true } } },
      }),
    ),
  ]);
  const docs: PipDoc[] = [];
  for (const i of got.rows) {
    const refunded = !!i.creditNote || i.payment?.status === "refunded";
    docs.push({ kind: "inv", number: i.number });
    const links = [{ label: `PDF ${i.number}`, href: signDocs(ctx.ownerId, [{ kind: "inv", number: i.number }]), download: true }];
    if (i.creditNote) links.push({ label: `Credit note ${i.creditNote.number}`, href: signDocs(ctx.ownerId, [{ kind: "cn", number: i.creditNote.number }]), download: true });
    r.rows.push({
      id: i.id,
      cells: { number: i.number, date: day(i.issuedAt, ctx.tz), item: i.description, amount: money(i.amountMinor, i.currency), status: refunded ? "Refunded" : "Paid" },
      links,
    });
  }
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "invoices");
  for (const t of sumBy(got.rows, (i) => i.currency, (i) => i.amountMinor)) {
    r.totals.push({ label: `Invoiced (${t.currency})`, value: money(t.minor, t.currency) });
    r.facts.push(`Invoiced total ${money(t.minor, t.currency)}${r.complete ? "" : " across the invoices shown"}.`);
  }
  const refundedN = r.rows.filter((x) => x.cells.status === "Refunded").length;
  if (refundedN) r.facts.push(`${plural(refundedN, "of these was", "of these were")} refunded.`);
  zipLink(r, ctx.ownerId, docs, "the invoice");

  // Name the gap: a successful payment with no invoice is something we owe the person.
  const missing = await db.payment
    .count({ where: { userId: ctx.ownerId, status: { in: ["succeeded", "refunded"] }, invoice: { is: null }, createdAt: within(range) } })
    .catch(() => 0);
  if (missing) {
    const when = range ? ` in ${range.label}` : "";
    r.notes.push({ level: "warn", text: `${plural(missing, "payment")}${when} ${missing === 1 ? "has" : "have"} no invoice yet. Ask for a person here and we'll issue ${missing === 1 ? "it" : "them"}.` });
    r.facts.push(`${plural(missing, "payment")}${when} ${missing === 1 ? "has" : "have"} no invoice.`);
  }
  if (wants(ctx.message, /receipt/)) r.notes.push({ level: "info", text: "Your invoice is your receipt: each one shows the payment as received." });
  return r;
}

export async function creditNotes(ctx: PipCtx, _a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "credit_notes",
    "Your credit notes",
    range,
    [
      { key: "number", label: "Credit note", mono: true },
      { key: "date", label: "Date" },
      { key: "invoice", label: "Against invoice", mono: true },
      { key: "amount", label: "Amount", align: "end" },
      { key: "reason", label: "Reason" },
    ],
    "No credit notes. One is issued whenever a payment is refunded.",
    period,
  );
  const where = { userId: ctx.ownerId, issuedAt: within(range) };
  const [found, got] = await Promise.all([
    db.creditNote.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.creditNote.findMany({
        where,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, number: true, issuedAt: true, amountMinor: true, currency: true, reason: true, invoice: { select: { number: true } } },
      }),
    ),
  ]);
  for (const n of got.rows)
    r.rows.push({
      id: n.id,
      cells: { number: n.number, date: day(n.issuedAt, ctx.tz), invoice: n.invoice.number, amount: money(-n.amountMinor, n.currency), reason: n.reason ?? "Refund" },
      links: [{ label: `PDF ${n.number}`, href: signDocs(ctx.ownerId, [{ kind: "cn", number: n.number }]), download: true }],
    });
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "credit notes");
  for (const t of sumBy(got.rows, (n) => n.currency, (n) => n.amountMinor)) {
    r.totals.push({ label: `Credited (${t.currency})`, value: money(t.minor, t.currency) });
    r.facts.push(`Credited total ${money(t.minor, t.currency)}.`);
  }
  zipLink(r, ctx.ownerId, got.rows.map((n) => ({ kind: "cn" as const, number: n.number })), "the credit note");
  return r;
}

const PAY_STATUS = ["succeeded", "failed", "refunded", "pending"];
const payLabel: Record<string, string> = { succeeded: "Paid", failed: "Failed", refunded: "Refunded", pending: "Pending" };

export async function payments(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "payments",
    "Your payments",
    range,
    [
      { key: "date", label: "Date" },
      { key: "plan", label: "Plan" },
      { key: "amount", label: "Amount", align: "end" },
      { key: "status", label: "Status" },
      { key: "invoice", label: "Invoice", mono: true },
    ],
    range ? "No payments in that period." : "No payments yet.",
    period,
  );
  const status = a.status === "paid" ? "succeeded" : a.status && PAY_STATUS.includes(a.status) ? a.status : null;
  const where = { userId: ctx.ownerId, createdAt: within(range), amountMinor: amountWhere(a), ...(status ? { status } : {}) };
  const [found, got, names] = await Promise.all([
    db.payment.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, createdAt: true, planId: true, interval: true, amountMinor: true, currency: true, status: true, invoice: { select: { number: true } } },
      }),
    ),
    planNames(),
  ]);
  let noInvoice = 0;
  for (const p of got.rows) {
    const billable = p.status === "succeeded" || p.status === "refunded";
    if (billable && !p.invoice) noInvoice++;
    r.rows.push({
      id: p.id,
      cells: {
        date: day(p.createdAt, ctx.tz),
        plan: `${(p.planId && names.get(p.planId)) || "Plan"} (${cycle(p.interval).toLowerCase()})`,
        amount: money(p.amountMinor, p.currency),
        status: payLabel[p.status] ?? p.status,
        invoice: p.invoice?.number ?? (billable ? "Missing" : "None"),
      },
      links: p.invoice ? [{ label: `Invoice ${p.invoice.number}`, href: signDocs(ctx.ownerId, [{ kind: "inv", number: p.invoice.number }]), download: true }] : undefined,
    });
  }
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "payments");
  const paid = got.rows.filter((p) => p.status === "succeeded" || p.status === "refunded");
  for (const t of sumBy(paid, (p) => p.currency, (p) => p.amountMinor)) {
    r.totals.push({ label: `Charged (${t.currency})`, value: money(t.minor, t.currency) });
    r.facts.push(`Charged ${money(t.minor, t.currency)} across ${plural(paid.filter((p) => p.currency === t.currency).length, "payment")}.`);
  }
  const failed = got.rows.filter((p) => p.status === "failed").length;
  if (failed) r.facts.push(`${plural(failed, "payment")} failed and ${failed === 1 ? "was" : "were"} not charged.`);
  if (noInvoice) r.notes.push({ level: "warn", text: `${plural(noInvoice, "paid payment")} shown ${noInvoice === 1 ? "has" : "have"} no invoice yet. Ask for a person here and we'll issue ${noInvoice === 1 ? "it" : "them"}.` });
  if (wants(ctx.message, /order|product|purchase|item/))
    r.notes.push({ level: "info", text: "Outlly sells plans only, so there are no orders or products. These are your plan payments." });
  return r;
}

export async function refundsMissingCreditNote(ctx: PipCtx, _a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "refunds_missing_credit_note",
    "Refunds without a credit note",
    range,
    [
      { key: "date", label: "Refunded payment" },
      { key: "amount", label: "Amount", align: "end" },
      { key: "invoice", label: "Invoice", mono: true },
      { key: "missing", label: "What's missing" },
    ],
    "Every refund has its credit note. Nothing is missing.",
    period,
  );
  const where = {
    userId: ctx.ownerId,
    status: "refunded",
    createdAt: within(range),
    OR: [{ invoice: { is: null } }, { invoice: { creditNote: { is: null } } }],
  };
  const [found, got] = await Promise.all([
    db.payment.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, createdAt: true, amountMinor: true, currency: true, invoice: { select: { number: true } } },
      }),
    ),
  ]);
  for (const p of got.rows)
    r.rows.push({
      id: p.id,
      cells: {
        date: day(p.createdAt, ctx.tz),
        amount: money(p.amountMinor, p.currency),
        invoice: p.invoice?.number ?? "None",
        missing: p.invoice ? "Credit note" : "Invoice and credit note",
      },
    });
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "refunds missing a credit note");
  if (r.rows.length)
    r.notes.push({ level: "info", text: "Credit notes for refunds are issued automatically within a day. Ask for a person here if you need one sooner." });
  return r;
}

export async function spending(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "spending",
    a.compare && range ? "Your spending, compared" : "Your spending",
    range,
    [
      { key: "plan", label: "Plan" },
      { key: "cycle", label: "Billing" },
      { key: "count", label: "Payments", align: "end" },
      { key: "paid", label: "Paid", align: "end" },
      { key: "refunded", label: "Refunded", align: "end" },
      { key: "net", label: "Net", align: "end" },
    ],
    range ? "You weren't charged anything in that period." : "You haven't been charged anything yet.",
    period,
  );
  const load = (rg: DateRange | null) =>
    fetchAll((c, take) =>
      db.payment.findMany({
        where: { userId: ctx.ownerId, status: { in: ["succeeded", "refunded"] }, createdAt: within(rg) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, planId: true, interval: true, amountMinor: true, currency: true, status: true },
      }),
    );
  const [got, names, count] = await Promise.all([
    load(range),
    planNames(),
    db.payment.count({ where: { userId: ctx.ownerId, status: { in: ["succeeded", "refunded"] }, createdAt: within(range) } }).catch(() => -1),
  ]);
  const groups = new Map<string, { plan: string; cycle: string; currency: string; n: number; paid: number; refunded: number }>();
  for (const p of got.rows) {
    const k = `${p.planId}|${p.interval}|${p.currency}`;
    const g = groups.get(k) ?? { plan: (p.planId && names.get(p.planId)) || "Plan", cycle: cycle(p.interval), currency: p.currency, n: 0, paid: 0, refunded: 0 };
    g.n++;
    g.paid += p.amountMinor;
    if (p.status === "refunded") g.refunded += p.amountMinor;
    groups.set(k, g);
  }
  for (const [k, g] of groups)
    r.rows.push({
      id: k,
      cells: { plan: g.plan, cycle: g.cycle, count: g.n, paid: money(g.paid, g.currency), refunded: money(g.refunded, g.currency), net: money(g.paid - g.refunded, g.currency) },
    });
  // Rows are plan groups, so found/returned count groups; the number of payments goes in the facts.
  const found = count < 0 ? got.rows.length : count;
  r.found = r.returned = r.rows.length;
  r.complete = !got.failed && count >= 0 && got.rows.length >= found;
  if (got.failed || count < 0) r.notes.push({ level: "warn", text: "Some payments couldn't be read just now, so the totals may be short. Ask again in a minute." });
  else if (got.rows.length < found) r.notes.push({ level: "warn", text: `Added up the newest ${got.rows.length} of ${found} payments, so the totals are short. Ask for a shorter period.` });
  const where = r.range ? ` in ${r.range.label}` : " in total";
  const net = sumBy(got.rows, (p) => p.currency, (p) => (p.status === "refunded" ? 0 : p.amountMinor));
  r.facts.push(`${plural(found, "payment")}${where}.`);
  for (const t of net) {
    r.totals.push({ label: `Net spent (${t.currency})`, value: money(t.minor, t.currency) });
    r.facts.push(`Net spent ${money(t.minor, t.currency)}${where}, after refunds.`);
  }
  const refunds = sumBy(got.rows.filter((p) => p.status === "refunded"), (p) => p.currency, (p) => p.amountMinor);
  for (const t of refunds) r.totals.push({ label: `Refunded (${t.currency})`, value: money(t.minor, t.currency) });

  if (a.compare && range) {
    const prev = previousRange(range, ctx.now);
    const before = await load(prev);
    const prevNet = sumBy(before.rows, (p) => p.currency, (p) => (p.status === "refunded" ? 0 : p.amountMinor));
    const currencies = new Set([...net, ...prevNet].map((x) => x.currency));
    for (const cur of currencies) {
      const now = net.find((x) => x.currency === cur)?.minor ?? 0;
      const then = prevNet.find((x) => x.currency === cur)?.minor ?? 0;
      r.totals.push({ label: `Before (${cur})`, value: money(then, cur) });
      if (then > 0) {
        const change = ((now - then) / then) * 100;
        r.totals.push({ label: `Change (${cur})`, value: pct(change) });
        r.facts.push(`Compared with ${prev.label}: ${money(then, cur)} then, ${money(now, cur)} now (${pct(change)}).`);
      } else r.facts.push(`Compared with ${prev.label}: nothing was spent then in ${cur}, ${money(now, cur)} now.`);
    }
    if (before.failed) {
      r.complete = false;
      r.notes.push({ level: "warn", text: "The earlier period couldn't be read in full, so the comparison may be off." });
    }
  }
  if (wants(ctx.message, /categor|breakdown|split/)) r.notes.push({ level: "info", text: "Outlly only charges for plans, so spending is grouped by plan and billing cycle." });
  return r;
}

export async function subscription(ctx: PipCtx, _a: PipArgs, _range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "subscription",
    "Your plan",
    null,
    [
      { key: "plan", label: "Plan" },
      { key: "status", label: "Status" },
      { key: "price", label: "Price", align: "end" },
      { key: "next", label: "Next" },
    ],
    "You're on the free plan. There's no paid subscription.",
    period,
  );
  const s = await db.subscription
    .findFirst({ where: { userId: ctx.ownerId, status: { in: ["active", "past_due"] } }, orderBy: { createdAt: "desc" }, include: { plan: { select: { name: true } } } })
    .catch(() => undefined);
  if (s === undefined) {
    r.complete = false;
    r.empty = "I couldn't read your plan just now. Ask again in a minute.";
    r.notes.push({ level: "warn", text: "Your plan couldn't be read just now. Ask again in a minute." });
    return r;
  }
  if (s) {
    const ends = day(s.currentPeriodEnd, ctx.tz);
    const next = s.pausedUntil && s.pausedUntil > ctx.now ? `Paused until ${day(s.pausedUntil, ctx.tz)}` : s.cancelAtPeriodEnd ? `Ends ${ends}` : `Paid through ${ends} (does not renew on its own)`;
    r.rows.push({
      id: s.id,
      cells: { plan: s.plan.name, status: s.status === "past_due" ? "Payment due" : "Active", price: `${money(s.priceMinor, s.currency)} ${s.interval === "year" ? "a year" : "a month"}`, next },
      links: [{ label: "Manage plan", href: "/billing" }],
    });
    r.facts.push(`You're on ${s.plan.name}, ${money(s.priceMinor, s.currency)} ${s.interval === "year" ? "a year" : "a month"}. ${next}.`);
  }
  r.found = r.returned = r.rows.length;
  return r;
}
