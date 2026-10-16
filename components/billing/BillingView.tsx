"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Download, FileText, Info, Loader2, ShieldCheck, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { Pip } from "@/components/brand/Pip";
import { api } from "@/lib/client/api";
import { formatMoney, intervalLabel, priceLabel, type PublicPlan } from "@/lib/billing/money";
import type { CurrencySource } from "@/lib/billing/currency";
import { CurrencyPicker } from "./CurrencyPicker";
import { CycleSwitch } from "./CycleSwitch";
import type { Cycle } from "@/lib/billing/cycle";
import { cn } from "@/lib/utils";

export type ReturnNotice = { tone: "ok" | "info" | "error"; text: string };
type Current = { planSlug: string; planName: string; priceMinor: number; currency: string; interval: string; periodEnd: string; cancelAtPeriodEnd: boolean; pausedUntil?: string | null } | null;
type Inv = { number: string; description: string; amountMinor: number; currency: string; issuedAt: string; refunded: boolean };

const CACHE = "outly-invoices-v1";
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: any) => void): void } }
}
function loadRazorpay() {
  return new Promise<void>((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Couldn't load Razorpay. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

type PricedPlan = PublicPlan & { approx: string | null; year: { priceMinor: number; currency: string; approx: string | null; save: number } | null };
/** limit 0 = unlimited */
type Usage = { used: number; limit: number; seats: number; aiCaptions: boolean };

function UsageMeter({ u }: { u: Usage }) {
  const pct = u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
  return (
    <div className="mt-4 max-w-md">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id="usage-l">Posts this month</span>
        <span className="tabular text-muted-foreground">{u.limit > 0 ? `${u.used} of ${u.limit}` : `${u.used} · unlimited`}</span>
      </div>
      {u.limit > 0 && (
        <div role="progressbar" aria-labelledby="usage-l" aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={Math.min(u.used, u.limit)} className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-lime")} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {u.seats > 0 ? `${u.seats} team seat${u.seats === 1 ? "" : "s"}` : "No team seats"} · AI captions {u.aiCaptions ? "included" : "not included"}
      </p>
    </div>
  );
}

export function BillingView(props: { email: string; notice: ReturnNotice | null; focusPlan: string | null; cycle: Cycle; gateway: string; testMode: boolean; plans: PricedPlan[]; currency: string; currencySource: CurrencySource; canPickCurrency: boolean; current: Current; usage: Usage; invoices: Inv[] }) {
  const { plans, current } = props;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle>(props.cycle);
  const anyYear = plans.some((p) => p.year && p.state === "available");
  const save = Math.max(0, ...plans.map((p) => p.year?.save ?? 0));
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState(props.notice);
  const [online, setOnline] = useState(true);
  const [invoices, setInvoices] = useState(props.invoices);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);

  // Offline: keep the last known invoice list so it can still be read (the PDFs are cached by the service worker).
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    try {
      if (props.invoices.length) localStorage.setItem(CACHE, JSON.stringify({ at: new Date().toISOString(), list: props.invoices }));
      else {
        const c = JSON.parse(localStorage.getItem(CACHE) ?? "null");
        if (c && !navigator.onLine) { setInvoices(c.list); setCachedAt(c.at); }
      }
    } catch {}
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, [props.invoices]);

  useEffect(() => {
    if (props.focusPlan) focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (props.notice) window.history.replaceState(null, "", "/billing"); // a refresh shouldn't replay the notice
  }, [props.focusPlan, props.notice]);

  async function choose(p: PricedPlan) {
    const y = cycle === "year" && p.year ? p.year : null;
    if (!online) return toast("You're offline. Reconnect to change plans.", "error");
    setBusy(p.slug);
    try {
      const r = await api<any>("/api/billing/checkout", { method: "POST", json: { plan: p.slug, currency: y ? y.currency : p.currency, cycle: y ? "year" : "month" } });
      if (r.kind === "redirect") {
        window.location.href = r.url;
        return;
      }
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: r.keyId, order_id: r.orderId, amount: r.amount, currency: r.currency, name: "Outlly", description: r.description,
        prefill: { name: r.name, email: r.email }, theme: { color: "#9ff218" },
        handler: async (resp: any) => {
          try {
            const v = await api<{ ok: boolean; invoice?: string }>("/api/billing/razorpay/verify", { method: "POST", json: { paymentId: r.paymentId, ...resp } });
            router.replace(`/billing?paid=${v.invoice ?? ""}`);
            router.refresh();
          } catch (e) { setNotice({ tone: "error", text: (e as Error).message }); }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rz.on("payment.failed", (f: any) => {
        const reason = f?.error?.description ?? "The payment didn't go through.";
        api("/api/billing/razorpay/verify", { method: "POST", json: { paymentId: r.paymentId, razorpay_order_id: r.orderId, failed: reason } }).catch(() => {});
        setNotice({ tone: "error", text: `${reason} You weren't charged. Try again or use another method.` });
      });
      rz.open();
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
      setBusy(null);
    }
  }

  async function cancelOrResume(action: "cancel" | "resume" | "pause" | "unpause", months?: number) {
    setBusy(action === "pause" ? `pause-${months}` : action);
    try {
      const r = await api<{ pausedUntil?: string; daysKept?: number }>("/api/billing/cancel", { method: "POST", json: { action, months } });
      toast(
        action === "cancel" ? `Done. ${current?.planName} stays active until ${day(current!.periodEnd)}.`
        : action === "pause" ? `Paused until ${day(r.pausedUntil!)}. Your ${r.daysKept} paid day${r.daysKept === 1 ? "" : "s"} wait for you.`
        : action === "unpause" ? "Welcome back. Your plan is running again."
        : "Welcome back. Your plan will renew as usual.",
        "ok",
      );
      setConfirm(false);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const currentSlug = current?.planSlug ?? "free";
  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <p className="eyebrow mb-3">Billing</p>
      <h1 className="display max-w-3xl text-[clamp(2.4rem,5.5vw,4.2rem)]">Your plan, invoices and payments.</h1>

      {!online && (
        <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-full bg-warning/15 px-4 py-2 text-sm text-foreground">
          <WifiOff className="h-4 w-4" aria-hidden /> You're offline. Invoices you've opened before still work; plan changes wait until you're back.
        </p>
      )}
      {notice && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={cn("admin-page-in mt-6 flex max-w-3xl items-start gap-3 rounded-2xl p-4 text-sm", notice.tone === "ok" ? "bg-success/15" : notice.tone === "error" ? "bg-destructive/10" : "bg-accent/10")}>
          {notice.tone === "ok" ? <Pip size={40} mood="happy" /> : notice.tone === "error" ? <Pip size={40} mood="sad" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <p className="flex-1 pt-1">{notice.text}</p>
          <button onClick={() => setNotice(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-foreground/5" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section aria-labelledby="cur" className="glass mt-8 flex max-w-5xl flex-col gap-5 rounded-[32px] p-6 sm:flex-row sm:items-center sm:p-8">
        <Pip size={72} mood={current ? "fly" : "idle"} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">Current plan</p>
          <h2 id="cur" className="mt-1 text-2xl font-semibold tracking-tight">
            {current ? current.planName : "Free"}
            {current && <span className="ml-2 text-base font-medium text-muted-foreground tabular">{current.priceMinor > 0 ? <>{formatMoney(current.priceMinor, current.currency)}{intervalLabel(current.interval)}</> : "free month"}</span>}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {!current ? "No card on file. Upgrade any time; you'll get an invoice by email straight away." : current.pausedUntil ? <>Paused until <b className="text-foreground">{day(current.pausedUntil)}</b>. Free limits apply until then, and your paid days run again after, to <b className="text-foreground">{day(current.periodEnd)}</b>.</> : current.cancelAtPeriodEnd ? <>Ends on <b className="text-foreground">{day(current.periodEnd)}</b>, then you move to Free. Nothing else will be charged.</> : <>Renews on <b className="text-foreground">{day(current.periodEnd)}</b>.</>}
          </p>
          <UsageMeter u={props.usage} />
        </div>
        {current && current.priceMinor > 0 && (current.pausedUntil ? (
          <Button variant="lime" onClick={() => cancelOrResume("unpause")} disabled={busy === "unpause"}>{busy === "unpause" && <Loader2 className="h-4 w-4 animate-spin" />}Resume now</Button>
        ) : current.cancelAtPeriodEnd ? (
          <Button variant="lime" onClick={() => cancelOrResume("resume")} disabled={busy === "resume"}>{busy === "resume" && <Loader2 className="h-4 w-4 animate-spin" />}Keep my plan</Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)}>Cancel plan</Button>
        ))}
      </section>

      <section aria-labelledby="plans" className="mt-10 max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="plans" className="text-xl font-semibold tracking-tight">Plans</h2>
          {props.canPickCurrency && <CurrencyPicker currency={props.currency} source={props.currencySource} className="mr-auto ml-3" />}
          {anyYear && <CycleSwitch value={cycle} onChange={setCycle} save={save} />}
          {props.testMode && <p className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-[12px] font-medium"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Test mode: no real money moves</p>}
        </div>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const y = cycle === "year" && p.year ? p.year : null;
            // Same plan on the other cycle is a switch you can make (monthly -> yearly), not "your plan".
            const mine = p.slug === currentSlug && (!current || p.priceMinor === 0 || !p.year || current.interval === (y ? "year" : "month"));
            const otherCycle = !mine && !!current && p.slug === currentSlug;
            const focus = props.focusPlan === p.slug && !mine;
            return (
              <li key={p.id} ref={focus ? focusRef : undefined}>
                <article className={cn("admin-card flex h-full flex-col rounded-[28px] bg-card p-6 hairline", p.highlight && "border-2 border-lime", focus && "ring-4 ring-lime/40", "hover:-translate-y-1")}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {mine ? <span className="rounded-full bg-lime/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-lime-ink">Your plan</span> : p.highlight && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider">Popular</span>}
                  </div>
                  <p className="mt-4 text-[1.7rem] font-semibold tracking-tight tabular">{y ? `${formatMoney(y.priceMinor, y.currency)}/yr` : priceLabel(p)}</p>
                  {y && y.save > 0 && <p className="text-[12.5px] font-medium text-lime-ink">Billed yearly, save {y.save}%</p>}
                  {(y ? y.approx : p.approx) && <p className="text-[12.5px] text-muted-foreground">{y ? y.approx : p.approx} · billed in {y ? y.currency : p.currency}</p>}
                  <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden />{f}</li>)}
                  </ul>
                  <div className="mt-6">
                    {mine ? (
                      <Button variant="subtle" className="w-full" disabled>Current plan</Button>
                    ) : p.state === "soon" ? (
                      <Button variant="subtle" className="w-full" disabled>Coming soon</Button>
                    ) : p.priceMinor === 0 ? (
                      <Button variant="outline" className="w-full" onClick={() => setConfirm(true)} disabled={!!current?.cancelAtPeriodEnd}>{current?.cancelAtPeriodEnd ? `Switching on ${day(current.periodEnd)}` : "Move to Free"}</Button>
                    ) : (
                      <Button variant={p.highlight || focus ? "lime" : "primary"} className="w-full" onClick={() => choose(p)} disabled={!!busy}>
                        {busy === p.slug && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {busy === p.slug ? "Opening checkout" : otherCycle ? `Switch to ${y ? "yearly" : "monthly"}` : current ? `Switch to ${p.name}${y ? " yearly" : ""}` : `Upgrade to ${p.name}${y ? " yearly" : ""}`}
                      </Button>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[12.5px] text-muted-foreground">Prices include applicable taxes. Switching plans starts the new one today; cancel any time and keep access until the period ends.</p>
      </section>

      <section aria-labelledby="inv" className="mt-10 max-w-5xl">
        <h2 id="inv" className="text-xl font-semibold tracking-tight">Invoices</h2>
        {cachedAt && <p className="mt-1 text-[12.5px] text-muted-foreground">Saved copy from {day(cachedAt)}.</p>}
        {invoices.length === 0 ? (
          <div className="mt-4 flex items-center gap-4 rounded-[24px] p-6 hairline">
            <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No invoices yet. When you pay for a plan, the invoice appears here and in your inbox ({props.email}).</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-[24px] hairline">
            {invoices.map((i) => (
              <li key={i.number} className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-card px-5 py-4">
                <span className="font-mono text-[13px]">{i.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{i.description}</span>
                <span className="text-sm tabular text-muted-foreground">{day(i.issuedAt)}</span>
                <span className={cn("w-24 text-right text-sm font-semibold tabular", i.refunded && "text-muted-foreground line-through")}>{formatMoney(i.amountMinor, i.currency)}</span>
                {i.refunded && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">Refunded</span>}
                <a href={`/api/billing/invoices/${i.number}`} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hairline hover:bg-secondary" aria-label={`Download invoice ${i.number} (PDF)`}>
                  <Download className="h-4 w-4" aria-hidden /> PDF
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px] text-muted-foreground">Charged by mistake or need a refund? <Link href="/support?topic=Payments" className="font-medium text-foreground underline underline-offset-4">Ask support</Link> and a person will review it.</p>
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Cancel ${current?.planName ?? "your plan"}?`}
        body={current ? `You keep everything in ${current.planName} until ${day(current.periodEnd)}, then move to Free. Your posts and media stay. You can resume before then.` : ""}
        confirmLabel="Cancel at period end"
        cancelLabel="Keep plan"
        busy={busy === "cancel"}
        onConfirm={() => cancelOrResume("cancel")}
        extra={
          current && current.priceMinor > 0 && !current.pausedUntil ? (
            <div className="mt-5 rounded-2xl bg-lime/15 p-4" role="group" aria-labelledby="pause-h">
              <p id="pause-h" className="text-sm font-semibold">Need a break instead?</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Pause and keep your unused paid days. They start again when the pause ends.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, 2, 3].map((m) => (
                  <Button key={m} variant="subtle" className="flex-1" onClick={() => cancelOrResume("pause", m)} disabled={!!busy}>
                    {busy === `pause-${m}` && <Loader2 className="h-4 w-4 animate-spin" />}Pause {m} month{m === 1 ? "" : "s"}
                  </Button>
                ))}
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
