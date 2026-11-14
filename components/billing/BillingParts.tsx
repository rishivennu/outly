"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUpRight, Banknote, CreditCard, Download, FileText, Loader2, Lock, RefreshCw, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { formatMoney } from "@/lib/billing/money";
import { HISTORY_LABEL, meterPct, meterText, meterTone, type BillingStatus, type HistoryRow, type MeterView, type MethodKind } from "@/lib/billing/overview-core";
import type { PaymentMethodInfo } from "@/lib/billing/payment-method";
import { cn } from "@/lib/utils";

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<BillingStatus["tone"], string> = {
  ok: "bg-success/15 text-foreground",
  warn: "bg-warning/20 text-foreground",
  info: "bg-accent/12 text-foreground",
  bad: "bg-destructive/12 text-[hsl(0_72%_38%)] dark:text-destructive",
  muted: "bg-secondary text-muted-foreground",
};
const DOT: Record<BillingStatus["tone"], string> = { ok: "bg-success", warn: "bg-warning", info: "bg-accent", bad: "bg-destructive", muted: "bg-muted-foreground/60" };

/** The subscription's one-word state, with its date ("Active · Renews 4 Dec 2026"). */
export function StatusPill({ s, withDate = true, className }: { s: BillingStatus; withDate?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex min-h-[28px] items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold", TONE[s.tone], className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOT[s.tone])} />
      {s.label}
      {withDate && s.date && s.dateLabel && <span className="font-medium text-muted-foreground">· {s.dateLabel} {day(s.date)}</span>}
    </span>
  );
}

/** A titled card section, the building block of the page. */
export function Panel({ id, title, action, children, className }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("card-glass min-w-0 rounded-[28px] bg-card p-5 hairline sm:p-6", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const BAR: Record<string, string> = { ok: "bg-lime", warn: "bg-warning", bad: "bg-destructive", none: "bg-lime" };

function MeterTile({ m }: { m: MeterView }) {
  const tone = meterTone(m.used, m.limit, m.extra);
  const id = `meter-${m.key}`;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span id={id} className="text-[13px] font-medium text-muted-foreground">{m.label}</span>
        {m.locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : m.href ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /> : null}
      </div>
      <p className={cn("mt-1.5 text-[15px] font-semibold leading-snug tabular", m.locked && "text-muted-foreground", tone === "bad" && "text-[hsl(0_72%_38%)] dark:text-destructive")}>{meterText(m)}</p>
      {m.limit > 0 && !m.locked ? (
        <div role="progressbar" aria-labelledby={id} aria-valuetext={meterText(m)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meterPct(m.used, m.limit, m.extra)} className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", BAR[tone])} style={{ width: `${Math.max(m.used > 0 ? 2 : 0, meterPct(m.used, m.limit, m.extra))}%` }} />
        </div>
      ) : (
        <div aria-hidden className="mt-2.5 h-1.5" />
      )}
      {m.note && <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{m.note}</p>}
    </>
  );
  const cls = "group flex h-full min-w-0 flex-col rounded-[20px] bg-secondary/40 p-3.5 hairline sm:p-4";
  return m.href && !m.locked ? (
    <Link href={m.href} className={cn(cls, "transition-colors hover:bg-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Plan usage and limits: one tile per allowance, two across on a phone. */
export function UsageGrid({ meters }: { meters: MeterView[] }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {meters.map((m) => (
        <li key={m.key} className="min-w-0">
          <MeterTile m={m} />
        </li>
      ))}
    </ul>
  );
}

const METHOD_ICON: Record<MethodKind, typeof CreditCard> = { card: CreditCard, upi: Smartphone, netbanking: Banknote, wallet: Wallet, emi: CreditCard, paylater: Wallet, other: CreditCard };

/**
 * The saved payment method (1098). Outlly stores no cards: the only saved method is a Razorpay mandate for
 * auto-renew. Add = turn auto-renew on, Update = approve a new mandate (the old one runs until then),
 * Remove = auto-renew off. The last payment's card / UPI is read from the gateway, never stored.
 */
export function PaymentMethodCard({ periodEnd, online }: { periodEnd: string | null; online: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<PaymentMethodInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"add" | "update" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api<PaymentMethodInfo>("/api/billing/payment-method").then(setD, () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  async function act(kind: "add" | "update" | "remove") {
    if (!online) return toast("You're offline. Reconnect to change your payment method.", "error");
    setBusy(kind);
    try {
      const r = await api<{ autoRenew: boolean; pending?: boolean; url?: string | null }>("/api/billing/autorenew", { method: "POST", json: kind === "remove" ? { on: false } : { on: true, ...(kind === "update" ? { replace: true } : {}) } });
      if (r.pending && r.url) {
        toast(kind === "update" ? "Approve the new method on the next page. Your current one keeps working until you do." : `Approve the mandate on the next page. Nothing is charged before ${periodEnd ? day(periodEnd) : "your renewal date"}.`, "ok");
        window.location.href = r.url;
        return;
      }
      toast(kind === "remove" ? "Payment method removed. Auto-renew is off, and we'll remind you before your plan ends." : kind === "update" ? "Payment method updated." : "Payment method saved. Auto-renew is on.", "ok");
      setConfirm(false);
      load();
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  let body: React.ReactNode;
  if (failed) {
    body = (
      <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl bg-destructive/8 p-4 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <p className="flex-1">We couldn't load your payment method.</p>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Try again</Button>
      </div>
    );
  } else if (!d) {
    body = (
      <div aria-busy="true" aria-label="Loading payment method" className="mt-4 space-y-3">
        <div className="h-[68px] animate-pulse rounded-2xl bg-secondary/60 motion-reduce:animate-none" />
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-secondary/60 motion-reduce:animate-none" />
      </div>
    );
  } else {
    const M = d.mandate;
    const Icon = d.last?.method ? METHOD_ICON[d.last.method.kind] : CreditCard;
    body = (
      <>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-secondary/40 p-3.5 hairline">
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-background hairline"><RefreshCw className={cn("h-5 w-5", M ? "text-lime-ink" : "text-muted-foreground")} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{M ? M.label : "No saved method"}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {M
                ? M.state === "pending"
                  ? "Not approved yet at Razorpay. Auto-renew starts once you approve it."
                  : M.state === "attention"
                    ? "Razorpay stopped this mandate, so it won't charge. Set it up again to keep auto-renew."
                    : M.ended
                      ? "Renewal charge processing"
                      : M.nextCharge
                        ? `Next charge ${day(M.nextCharge)}`
                        : "Saved for auto-renew"
                : "Outlly never stores card numbers. Each payment is one-off unless you turn on auto-renew."}
            </p>
          </div>
          {M && <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", M.state === "active" ? "bg-success/15" : M.state === "attention" ? "bg-destructive/12 text-[hsl(0_72%_38%)] dark:text-destructive" : "bg-warning/20")}>{M.state === "active" ? "Active" : M.state === "attention" ? "Needs attention" : "Pending"}</span>}
        </div>
        {d.last && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">Last paid with <b className="font-medium text-foreground">{d.last.method?.label ?? d.last.gateway}</b> · {d.last.amount} on {day(d.last.at)}</span>
          </p>
        )}
        {d.lookupFailed && <p className="mt-2 text-[12px] text-muted-foreground">Razorpay didn't answer just now, so some details are missing.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {M ? (
            <>
              {M.state === "pending" && M.approveUrl ? (
                // The same approval page Razorpay sent: nothing is cancelled or created again.
                <Button variant="lime" asChild><a href={M.approveUrl}>Finish approval<ArrowUpRight className="h-4 w-4" aria-hidden /></a></Button>
              ) : M.state === "active" ? (
                <Button variant="subtle" onClick={() => void act("update")} disabled={!!busy || M.ended}>
                  {busy === "update" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Update method
                </Button>
              ) : d.canAdd ? (
                <Button variant="lime" onClick={() => void act("add")} disabled={!!busy}>
                  {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{M.state === "attention" ? "Set up again" : "Start again"}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setConfirm(true)} disabled={!!busy}>Remove</Button>
            </>
          ) : d.canAdd ? (
            <Button variant="lime" onClick={() => void act("add")} disabled={!!busy}>
              {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Add for auto-renew
            </Button>
          ) : null}
        </div>
        {!M && d.addBlock && <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">{d.addBlock}</p>}
      </>
    );
  }
  return (
    <Panel id="pay-h" title="Payment method">
      {body}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={d?.mandate?.state === "active" ? "Remove your payment method?" : "Remove this mandate?"}
        body={
          d?.mandate?.state === "active"
            ? `Auto-renew turns off and the mandate is cancelled at Razorpay. Your plan stays paid${periodEnd ? ` through ${day(periodEnd)}` : ""}, and we'll email you before it ends.`
            : `It's cancelled at Razorpay, so it can never charge you. Auto-renew stays off and your plan stays paid${periodEnd ? ` through ${day(periodEnd)}` : ""}.`
        }
        confirmLabel="Remove"
        cancelLabel="Keep it"
        busy={busy === "remove"}
        onConfirm={() => void act("remove")}
      />
    </Panel>
  );
}

const PILL: Record<HistoryRow["status"], string> = {
  paid: "bg-success/15",
  refunded: "bg-secondary text-muted-foreground",
  failed: "bg-destructive/12 text-[hsl(0_72%_38%)] dark:text-destructive",
  pending: "bg-warning/20",
};

function Downloads({ r }: { r: HistoryRow }) {
  if (!r.number) return <span className="text-[12.5px] text-muted-foreground">No invoice</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      <a href={`/api/billing/invoices/${r.number}`} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hairline transition-colors hover:bg-secondary sm:h-9" aria-label={`Download invoice ${r.number} (PDF)`}>
        <Download className="h-4 w-4" aria-hidden /> PDF
      </a>
      {r.creditNote && (
        <a href={`/api/billing/credit-notes/${r.creditNote}`} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hairline transition-colors hover:bg-secondary sm:h-9" aria-label={`Download credit note ${r.creditNote} for invoice ${r.number} (PDF)`}>
          <Download className="h-4 w-4" aria-hidden /> Credit note
        </a>
      )}
    </span>
  );
}

/** Billing history: a table from sm up, a stacked list on phones (no sideways scrolling). */
export function BillingHistory({ rows, email, cachedAt }: { rows: HistoryRow[]; email: string; cachedAt: string | null }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <Panel id="inv" title="Billing history" action={cachedAt ? <span className="text-[12.5px] text-muted-foreground">Saved copy from {day(cachedAt)}</span> : undefined}>
      {rows.length === 0 ? (
        <div className="mt-4 flex items-center gap-4 rounded-2xl bg-secondary/40 p-5 hairline">
          <FileText className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 break-words text-sm text-muted-foreground">No payments yet. When you pay for a plan, the invoice appears here and in your inbox ({email}).</p>
        </div>
      ) : (
        <>
          <table className="mt-4 hidden w-full text-left text-sm sm:table">
            <thead>
              <tr className="text-[12px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">Invoice</th>
                <th scope="col" className="pb-2 font-medium">Date</th>
                <th scope="col" className="pb-2 font-medium">Plan</th>
                <th scope="col" className="pb-2 text-right font-medium">Amount</th>
                <th scope="col" className="pb-2 pl-4 font-medium">Status</th>
                <th scope="col" className="pb-2 text-right font-medium"><span className="sr-only">Download</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="py-3 pr-3 font-mono text-[12.5px]">{r.number ?? "Not issued"}</td>
                  <td className="py-3 pr-3 whitespace-nowrap tabular text-muted-foreground">{day(r.date)}</td>
                  <td className="py-3 pr-3"><span className="line-clamp-1">{r.plan}</span>{r.note && <span className="block text-[12px] text-muted-foreground">{r.note}</span>}</td>
                  <td className={cn("py-3 text-right font-semibold whitespace-nowrap tabular", r.status === "refunded" && "text-muted-foreground line-through")}>{formatMoney(r.amountMinor, r.currency)}</td>
                  <td className="py-3 pl-4"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[r.status])}>{HISTORY_LABEL[r.status]}</span></td>
                  <td className="py-3 pl-3 text-right"><Downloads r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 divide-y divide-border sm:hidden">
            {shown.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] font-medium">{r.plan}</span>
                  <span className={cn("shrink-0 font-semibold tabular", r.status === "refunded" && "text-muted-foreground line-through")}>{formatMoney(r.amountMinor, r.currency)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold text-foreground", PILL[r.status])}>{HISTORY_LABEL[r.status]}</span>
                  <span className="tabular">{day(r.date)}</span>
                  {r.number && <span className="font-mono text-xs">{r.number}</span>}
                </div>
                {r.note && <p className="mt-1 text-[12px] text-muted-foreground">{r.note}</p>}
                {r.number && <div className="mt-2 flex"><Downloads r={r} /></div>}
              </li>
            ))}
          </ul>
          {rows.length > 8 && (
            <Button variant="ghost" className="mt-2 w-full" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button>
          )}
        </>
      )}
    </Panel>
  );
}
