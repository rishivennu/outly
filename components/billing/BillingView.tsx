"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, Gift, Info, Loader2, Repeat, ShieldCheck, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { Pip } from "@/components/brand/Pip";
import { api } from "@/lib/client/api";
import { formatMoney, intervalLabel, planFeatures, priceLabel, type PublicPlan } from "@/lib/billing/money";
import type { CurrencySource } from "@/lib/billing/currency";
import { CycleSwitch } from "./CycleSwitch";
import { CurrencyNote } from "./CurrencyNote";
import type { StorageMeterData } from "./StorageMeter";
import { BillingHistory, Panel, PaymentMethodCard, StatusPill, UsageGrid } from "./BillingParts";
import { cycleLabel, type BillingStatus, type EndedSub, type HistoryRow, type MeterView } from "@/lib/billing/overview-core";
import { CARD_FEATURES } from "./PlanCardView";
import { BetaRedeem, type BetaOffer } from "./BetaRedeem";
import { FoundingCard } from "@/components/founding/FoundingCard";
import type { FoundingMine } from "@/lib/founding";
import { TrustBadges } from "@/components/shared/TrustBadges";
import { MANAGER_SLUG, type TrustBadges as Badges } from "@/lib/badges-core";
import type { Cycle } from "@/lib/billing/cycle";
import { cn } from "@/lib/utils";
import type { Receipt } from "@/lib/billing/receipt-core";
import { PaymentReceipt } from "./PaymentReceipt";
import { GuaranteeCard, type GuaranteeView } from "./GuaranteeCard";
import { GUARANTEE_LINE } from "@/lib/billing/guarantee-core";
import { AutoRenewToggle, CancelReasons, PriceSurvey, UsageExtras, type CancelWhy } from "./PlanExtras";
import { SavedCardsSection } from "./SavedCards";
import posthog from "posthog-js";

export type ReturnNotice = { tone: "ok" | "info" | "error"; text: string };
type Current = { planSlug: string; planName: string; priceMinor: number; currency: string; interval: string; periodEnd: string; cancelAtPeriodEnd: boolean; pausedUntil?: string | null; provider?: string; autoRenew?: boolean } | null;
const CACHE = "outly-billing-history-v2";
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

/** 1122: `offer` is a claimed promo offer's id when the price shown is the offer price (checked again at checkout). */
type PricedPlan = PublicPlan & { approx: string | null; year: { priceMinor: number; currency: string; approx: string | null; save: number; was?: number | null; offer?: string; offerLabel?: string } | null; was?: number | null; offer?: string; offerLabel?: string };
/** limit 0 = unlimited. 1098: the tiles come from `meters`; this keeps the few facts the plan card states. */
type Usage = { used: number; limit: number; seats: number; aiCaptions: boolean; period?: "week" | "month"; maxUploadMb?: number; replies?: { limit: number; used: number }; captions?: { limit: number; used: number; burn: boolean }; storage?: StorageMeterData };
type ExtraAccess = { planName: string; source: "admin" | "referral"; endsAt: string } | null;


export function BillingView(props: { offerNote?: { tone: "ok" | "info"; text: string } | null; email: string; notice: ReturnNotice | null; receipt?: Receipt | null; focusPlan: string | null; cycle: Cycle; gateway: string; testMode: boolean; plans: PricedPlan[]; currency: string; charged?: string; currencySource: CurrencySource; current: Current; access?: ExtraAccess; usage: Usage; status: BillingStatus; nextCharge: string | null; meters: MeterView[]; history: HistoryRow[]; ended?: EndedSub | null; beta?: BetaOffer | null; founding?: FoundingMine; foundingStatus?: string | null; badges?: Badges; guarantee?: GuaranteeView }) {
  const { plans, current } = props;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cycle, setCycle] = useState<Cycle>(props.cycle);
  const anyYear = plans.some((p) => p.year && p.state === "available");
  const save = Math.max(0, ...plans.map((p) => p.year?.save ?? 0));
  const [confirm, setConfirm] = useState(false);
  // 1118: opt-in, off by default. Razorpay still asks for its own consent before it tokenises a card.
  const [saveCard, setSaveCard] = useState(false);
  const [why, setWhy] = useState<CancelWhy>({ detail: "", interview: false });
  const [notice, setNotice] = useState(props.notice);
  // 1053: a checkout that came back gets a receipt slip built from our payment row; it replaces the text notice.
  const [receipt, setReceipt] = useState<Receipt | null>(props.receipt ?? null);
  useEffect(() => {
    if (props.receipt) setReceipt(props.receipt);
  }, [props.receipt]);
  const showReceipt = async (paymentId: string) => {
    try {
      const j = await api<{ receipt: Receipt }>(`/api/billing/payments/${encodeURIComponent(paymentId)}`);
      setReceipt(j.receipt);
      setNotice(null);
    } catch {}
  };
  const [online, setOnline] = useState(true);
  const [history, setHistory] = useState(props.history);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);

  // Offline: keep the last known invoice list so it can still be read (the PDFs are cached by the service worker).
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    try {
      if (props.history.length) {
        localStorage.setItem(CACHE, JSON.stringify({ at: new Date().toISOString(), list: props.history }));
        setHistory(props.history);
      } else {
        const c = JSON.parse(localStorage.getItem(CACHE) ?? "null");
        if (c && !navigator.onLine) { setHistory(c.list); setCachedAt(c.at); }
      }
    } catch {}
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, [props.history]);

  useEffect(() => {
    if (props.focusPlan) focusRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    if (props.notice || props.receipt) window.history.replaceState(null, "", "/billing"); // a refresh shouldn't replay the notice
  }, [props.focusPlan, props.notice, props.receipt]);

  async function choose(p: PricedPlan) {
    const y = cycle === "year" && p.year ? p.year : null;
    if (!online) return toast("You're offline. Reconnect to change plans.", "error");
    setBusy(p.slug);
    const offer = (y ? y.offer : p.offer) || undefined; // 1122: the server re-checks it and prices it itself
    posthog.capture("subscription_checkout_started", { purchase_type: "plan", plan_slug: p.slug, billing_cycle: y ? "year" : "month" });
    await pay(() => api<any>("/api/billing/checkout", { method: "POST", json: { plan: p.slug, currency: y ? y.currency : p.currency, cycle: y ? "year" : "month", ...(offer ? { campaign: offer } : {}) } }));
  }

  /** 1096: a usage pack goes through exactly the same checkout as a plan. */
  async function buyPack(packId: string) {
    if (!online) return toast("You're offline. Reconnect to buy a top-up.", "error");
    setBusy(`pack-${packId}`);
    posthog.capture("subscription_checkout_started", { purchase_type: "top_up" });
    await pay(() => api<any>("/api/billing/topups", { method: "POST", json: { pack: packId } }));
  }

  async function pay(start: () => Promise<any>) {
    try {
      const r = await start();
      if (r.kind === "redirect") {
        window.location.href = r.url;
        return;
      }
      await loadRazorpay();
      const rz = new window.Razorpay!({
        key: r.keyId, order_id: r.orderId, amount: r.amount, currency: r.currency, name: "Outlly", description: r.description,
        prefill: { name: r.name, email: r.email }, theme: { color: "#9ff218" },
        // 1118: with a customer, Checkout lists this person's saved cards; remember_customer lets it offer to save a new one.
        ...(r.customerId ? { customer_id: r.customerId, remember_customer: saveCard } : {}),
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
        setNotice({ tone: "error", text: `${reason} You weren't charged. Try again or use another method.` });
        // Once the server has recorded the failure, the slip shows it (from the database, not from the popup).
        api("/api/billing/razorpay/verify", { method: "POST", json: { paymentId: r.paymentId, razorpay_order_id: r.orderId, failed: reason } })
          .catch(() => {})
          .finally(() => void showReceipt(r.paymentId));
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
      const feedback = action === "cancel" && why.reason ? { reason: why.reason, detail: why.detail.trim() || undefined, interview: why.interview } : {};
      const r = await api<{ pausedUntil?: string; daysKept?: number }>("/api/billing/cancel", { method: "POST", json: { action, months, ...feedback } });
      toast(
        action === "cancel" ? `Done. ${current?.planName} stays active until ${day(current!.periodEnd)}.`
        : action === "pause" ? `Paused until ${day(r.pausedUntil!)}. Your ${r.daysKept} paid day${r.daysKept === 1 ? "" : "s"} wait for you.`
        : action === "unpause" ? "Welcome back. Your plan is running again."
        : `Welcome back. Your plan stays paid through ${day(current!.periodEnd)} and won't renew on its own.`,
        "ok",
      );
      setConfirm(false);
      posthog.capture("subscription_updated", { action });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const currentSlug = current?.planSlug ?? "free";
  const paid = !!current && current.priceMinor > 0;
  const mineYear = plans.find((p) => p.slug === currentSlug)?.year;
  const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toPlans = (c?: Cycle) => {
    if (c) setCycle(c);
    document.getElementById("plans")?.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "start" });
  };
  const s = props.status;
  const due = props.nextCharge ?? s.date;
  const dueLabel = props.nextCharge ? "Next billing date" : s.key === "paused" ? "Resumes" : s.key === "cancelled" ? "Ends on" : s.key === "expired" ? "Ended on" : s.key === "renewing" ? "Renewal due" : s.key === "gift" ? "Free access until" : paid ? "Paid through" : "Next billing date";
  const planName = current ? current.planName : props.access ? props.access.planName : props.ended ? props.ended.planName : "Free";
  return (
    <div className="page-frame pb-16 pt-8 lg:pt-12">
      <header>
        <p className="eyebrow mb-3">Billing</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="display text-[clamp(2.1rem,4.6vw,3.4rem)]">Billing &amp; Subscription</h1>
          <StatusPill s={s} />
        </div>
        <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">Your plan, what you've used this period, how you pay and every invoice, in one place.</p>
      </header>

      {!online && (
        <p role="status" className="mt-6 inline-flex items-center gap-2 rounded-full bg-warning/15 px-4 py-2 text-sm text-foreground">
          <WifiOff className="h-4 w-4" aria-hidden /> You're offline. Invoices you've opened before still work; plan changes wait until you're back.
        </p>
      )}
      {receipt && (
        <PaymentReceipt
          initial={receipt}
          onClose={() => setReceipt(null)}
          onRetry={() => {
            setReceipt(null);
            toPlans();
          }}
        />
      )}
      {notice && !receipt && (
        <div role={notice.tone === "error" ? "alert" : "status"} className={cn("admin-page-in mt-6 flex max-w-3xl items-start gap-3 rounded-2xl p-4 text-sm", notice.tone === "ok" ? "bg-success/15" : notice.tone === "error" ? "bg-destructive/10" : "bg-accent/10")}>
          {notice.tone === "ok" ? <Pip size={40} mood="happy" /> : notice.tone === "error" ? <Pip size={40} mood="sad" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <p className="flex-1 pt-1">{notice.text}</p>
          <button onClick={() => setNotice(null)} className="-m-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-foreground/5" aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {props.offerNote && (
        <div role="status" className={cn("admin-page-in mt-6 flex max-w-3xl items-start gap-3 rounded-2xl p-4 text-sm", props.offerNote.tone === "ok" ? "bg-success/15" : "bg-accent/10")}>
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="flex-1">{props.offerNote.text}</p>
        </div>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel id="cur" title="Current plan" action={<StatusPill s={s} withDate={false} />}>
          <div className="mt-4 flex items-center gap-4">
            <Pip size={56} mood={current ? "fly" : "idle"} className="shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-2xl font-semibold tracking-tight">{planName}</p>
              <p className="text-[15px] text-muted-foreground tabular">
                {current ? (current.priceMinor > 0 ? <>{formatMoney(current.priceMinor, current.currency)}{intervalLabel(current.interval)}</> : current.provider === "beta" ? "Free, early member" : "Free month") : props.access ? "Free access" : "No charge"}
              </p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div className="rounded-[18px] bg-secondary/40 p-3 hairline">
              <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Repeat className="h-3.5 w-3.5" aria-hidden />Billing cycle</dt>
              <dd className="mt-1 text-[15px] font-semibold">{cycleLabel(current?.interval, current?.priceMinor ?? 0)}</dd>
            </div>
            <div className="rounded-[18px] bg-secondary/40 p-3 hairline">
              <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{dueLabel}</dt>
              <dd className="mt-1 text-[15px] font-semibold tabular">{due ? day(due) : "Nothing due"}</dd>
            </div>
            <div className="col-span-2 rounded-[18px] bg-secondary/40 p-3 hairline sm:col-span-1">
              <dt className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Renewal</dt>
              <dd className="mt-1 text-[15px] font-semibold">{!paid ? "Not needed" : current!.pausedUntil ? "On hold" : current!.cancelAtPeriodEnd ? "Won't renew" : current!.autoRenew ? "Automatic" : "Manual"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            {!current
              ? props.ended
                ? s.key === "renewing"
                  ? <>Your {props.ended.planName} renewal is being processed. This usually clears within a day; you'll get the invoice by email.</>
                  : <>Your {props.ended.planName} plan ended on <b className="text-foreground">{day(props.ended.endedAt)}</b>. You're on Free limits now; your posts and media are safe. Pick a plan to continue.</>
                : props.access
                  ? <>Paid plan features are on until <b className="text-foreground">{day(props.access.endsAt)}</b>, then you move to Free. No card needed.</>
                  : "No card on file. Upgrade any time; you'll get an invoice by email straight away."
              : current.pausedUntil ? <>Paused until <b className="text-foreground">{day(current.pausedUntil)}</b>. Free limits apply until then, and your paid days run again after, to <b className="text-foreground">{day(current.periodEnd)}</b>.</>
              : current.cancelAtPeriodEnd ? <>Ends on <b className="text-foreground">{day(current.periodEnd)}</b>, then you move to Free. Nothing else will be charged.</>
              : current.priceMinor <= 0 ? <>Free access runs until <b className="text-foreground">{day(current.periodEnd)}</b>. Nothing is charged.</>
              : current.autoRenew ? <>Renews on <b className="text-foreground">{day(current.periodEnd)}</b>. We email you 3 days before the charge.</>
              : <>Paid through <b className="text-foreground">{day(current.periodEnd)}</b>. It does not renew or charge you again on its own.</>}
          </p>
          {props.access && current && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lime/15 px-3 py-1 text-[12.5px] text-foreground" role="status">
              <Gift className="h-3.5 w-3.5" aria-hidden />
              {props.access.source === "referral" ? "Referral reward" : "Granted by Outlly"}: {props.access.planName} until {day(props.access.endsAt)}
            </p>
          )}
          {props.access && !current && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-lime/15 px-3 py-1 text-[12.5px] text-foreground">
              <Gift className="h-3.5 w-3.5" aria-hidden />{props.access.source === "referral" ? "Referral reward" : "Granted by Outlly"}
            </p>
          )}
          {props.badges && <TrustBadges b={props.badges} className="mt-3" />}
          {current?.planSlug === MANAGER_SLUG && props.badges && !props.badges.verifiedManager && (
            <p className="mt-2 text-[12.5px] text-muted-foreground">Your Verified Manager badge appears once your email is confirmed and two or more accounts are connected.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant={paid && !current!.cancelAtPeriodEnd && !current!.pausedUntil ? "subtle" : "lime"} onClick={() => toPlans()}>
              {paid ? "Change plan" : props.ended ? "Renew a plan" : "Upgrade"}<ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            {paid && (current!.pausedUntil ? (
              <Button variant="lime" onClick={() => cancelOrResume("unpause")} disabled={busy === "unpause"}>{busy === "unpause" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Resume now</Button>
            ) : current!.cancelAtPeriodEnd ? (
              <Button variant="lime" onClick={() => cancelOrResume("resume")} disabled={busy === "resume"}>{busy === "resume" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Keep my plan</Button>
            ) : null)}
          </div>
        </Panel>

        <Panel id="manage-h" title="Manage subscription">
          {paid && !current!.pausedUntil && !current!.cancelAtPeriodEnd ? (
            <AutoRenewToggle on={!!current!.autoRenew} provider={current!.provider} periodEnd={current!.periodEnd} />
          ) : (
            <p className="mt-4 rounded-2xl bg-secondary/40 px-4 py-3 text-[13px] text-muted-foreground hairline">
              {!paid ? "Auto-renew becomes available once you're on a paid plan. Until then nothing is ever charged on its own." : current!.pausedUntil ? "Auto-renew is held while your plan is paused." : "Auto-renew is off because this plan is set to end. Keep your plan to turn it back on."}
            </p>
          )}
          <ul className="mt-3 divide-y divide-border text-sm">
            {paid && mineYear && (
              <li className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{current!.interval === "year" ? "Billed yearly" : "Billed monthly"}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{current!.interval === "year" ? "Switch to monthly at your next payment." : mineYear.save > 0 ? `Yearly saves ${mineYear.save}%.` : "Pay once a year instead."}</span>
                </span>
                <Button size="sm" variant="outline" className="min-h-[44px] shrink-0" onClick={() => toPlans(current!.interval === "year" ? "month" : "year")}>
                  Switch to {current!.interval === "year" ? "monthly" : "yearly"}
                </Button>
              </li>
            )}
            <li className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block font-medium">Change plan</span>
                <span className="block text-[12.5px] text-muted-foreground">A new plan starts today.</span>
              </span>
              <Button size="sm" variant="outline" className="min-h-[44px] shrink-0" onClick={() => toPlans()}>See plans</Button>
            </li>
            {paid && !current!.cancelAtPeriodEnd && !current!.pausedUntil && (
              <li className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">Pause or cancel</span>
                  <span className="block text-[12.5px] text-muted-foreground">You keep everything until {day(current!.periodEnd)}. Pausing saves your paid days.</span>
                </span>
                <Button size="sm" variant="ghost" className="min-h-[44px] shrink-0" onClick={() => setConfirm(true)}>Cancel plan</Button>
              </li>
            )}
          </ul>
          <p className="mt-2 flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Cancelling never deletes your posts or media. When a paid period ends you move to Free, and you can come back any time.
          </p>
        </Panel>
      </div>

      <Panel id="use-h" title="Plan usage & limits" className="mt-4" action={<span className="text-[12.5px] text-muted-foreground">Resets with your plan's period</span>}>
        <UsageGrid meters={props.meters} />
        {(!!props.usage.maxUploadMb || (props.usage.captions && !props.usage.captions.burn && props.usage.aiCaptions)) && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {[props.usage.maxUploadMb ? `Uploads up to ${props.usage.maxUploadMb} MB each` : null, props.usage.captions && !props.usage.captions.burn && props.usage.aiCaptions ? "Burned-in captions come with paid plans" : null].filter(Boolean).join(" · ")}
          </p>
        )}
        <UsageExtras onBuy={buyPack} busy={busy} packsOnly />
      </Panel>

      {(props.guarantee || props.founding || props.foundingStatus || props.beta) && (
        <div>
          {props.guarantee && <GuaranteeCard g={props.guarantee} />}
          {(props.founding || props.foundingStatus) && <FoundingCard f={props.founding ?? null} status={props.foundingStatus} />}
          {props.beta && <BetaRedeem offer={props.beta} />}
        </div>
      )}

      <section aria-labelledby="plans" className="mt-10 scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="plans" className="scroll-mt-24 text-xl font-semibold tracking-tight">Available plans</h2>
          <CurrencyNote currency={props.charged ?? props.currency} wanted={props.currency} source={props.currencySource} className="mr-auto ml-3" />
          {anyYear && <CycleSwitch value={cycle} onChange={setCycle} save={save} />}
          {props.testMode && <p className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-[12px] font-medium"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Test mode: no real money moves</p>}
        </div>
        <ul className={cn("mt-4 grid gap-4 md:grid-cols-2", plans.length === 3 ? "lg:grid-cols-3" : plans.length >= 4 && "lg:grid-cols-4")}>
          {plans.map((p) => {
            const y = cycle === "year" && p.year ? p.year : null;
            // Same plan on the other cycle is a switch you can make (monthly -> yearly), not "your plan".
            const mine = p.slug === currentSlug && (!current || p.priceMinor === 0 || !p.year || current.interval === (y ? "year" : "month"));
            const otherCycle = !mine && !!current && p.slug === currentSlug;
            const focus = props.focusPlan === p.slug && !mine;
            return (
              <li key={p.id} ref={focus ? focusRef : undefined}>
                <article className={cn("admin-card card-glass flex h-full flex-col rounded-[28px] bg-card p-6 hairline", p.highlight && "border-2 border-lime", focus && "ring-4 ring-lime/40", "hover:-translate-y-1")}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {mine ? <span className="rounded-full bg-lime/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-lime-ink">Your plan</span> : p.highlight && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider">Popular</span>}
                  </div>
                  {(y ? y.was : p.was) ? (
                    <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[1.7rem] font-semibold tracking-tight tabular">{y ? `${formatMoney(y.priceMinor, y.currency)}/yr` : priceLabel(p)}</span>
                      <s className="text-sm text-muted-foreground tabular" aria-label={`was ${formatMoney((y ? y.was : p.was)!, y ? y.currency : p.currency)}`}>{formatMoney((y ? y.was : p.was)!, y ? y.currency : p.currency)}</s>
                      <span className="text-[12.5px] font-medium text-lime-ink">{(y ? y.offerLabel : p.offerLabel) ? `Offer: ${(y ? y.offerLabel : p.offerLabel)!.toLowerCase()}, first ${y ? "year" : "month"}` : "Founding price"}</span>
                    </p>
                  ) : (
                    <p className="mt-4 text-[1.7rem] font-semibold tracking-tight tabular">{y ? `${formatMoney(y.priceMinor, y.currency)}/yr` : priceLabel(p)}</p>
                  )}
                  {y && y.save > 0 && <p className="text-[12.5px] font-medium text-lime-ink">Billed yearly, save {y.save}%</p>}
                  {(y ? y.approx : p.approx) && <p className="text-[12.5px] text-muted-foreground">{y ? y.approx : p.approx} · billed in {y ? y.currency : p.currency}</p>}
                  <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
                  <div className="mt-5 flex-1 text-sm">
                    <ul className="space-y-2">{planFeatures(p).slice(0, CARD_FEATURES).map((f, i) => <li key={`${i}-${f}`} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden />{f}</li>)}</ul>
                    {planFeatures(p).length > CARD_FEATURES && (
                      <details className="group mt-1">
                        <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center font-semibold text-lime-ink underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">+{planFeatures(p).length - CARD_FEATURES} more</span>
                          <span className="hidden group-open:inline">Show less</span>
                        </summary>
                        <ul className="space-y-2">{planFeatures(p).slice(CARD_FEATURES).map((f, i) => <li key={`m${i}-${f}`} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden />{f}</li>)}</ul>
                      </details>
                    )}
                  </div>
                  <div className="mt-6">
                    {mine ? (
                      <Button variant="subtle" className="w-full" disabled>Current plan</Button>
                    ) : p.state === "soon" ? (
                      <Button variant="subtle" className="w-full" disabled>Coming soon</Button>
                    ) : p.priceMinor === 0 && current && current.priceMinor <= 0 ? (
                      // A gift month isn't cancelled: it simply ends and Free takes over.
                      <Button variant="subtle" className="w-full" disabled>Free from {day(current.periodEnd)}</Button>
                    ) : p.priceMinor === 0 ? (
                      <Button variant="outline" className="w-full" onClick={() => setConfirm(true)} disabled={!!current?.cancelAtPeriodEnd}>{current?.cancelAtPeriodEnd ? `Switching on ${day(current.periodEnd)}` : "Move to Free"}</Button>
                    ) : (
                      <Button variant={p.highlight || focus ? "lime" : "primary"} className="w-full" onClick={() => choose(p)} disabled={!!busy}>
                        {busy === p.slug && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        {busy === p.slug ? "Opening checkout" : otherCycle ? `Switch to ${y ? "yearly" : "monthly"}` : current ? `Switch to ${p.name}${y ? " yearly" : ""}` : `Upgrade to ${p.name}${y ? " yearly" : ""}`}
                      </Button>
                    )}
                    {/* 1058: the terms sit next to the button, not only in the footnote. */}
                    {!mine && p.state !== "soon" && p.priceMinor > 0 && (
                      <p className="mt-2 text-center text-[12px] leading-snug text-muted-foreground">
                        One payment of {y ? formatMoney(y.priceMinor, y.currency) : formatMoney(p.priceMinor, p.currency)} for {y ? "1 year" : "1 month"}. It does not renew or charge you again on its own.
                        {/* 1076: the guarantee covers an account's first payment only, so it's promised only before one. */}
                        {props.guarantee?.state === "none" && <span className="mt-1 flex items-center justify-center gap-1 font-medium text-foreground"><ShieldCheck className="h-3.5 w-3.5 text-lime-ink" aria-hidden />{GUARANTEE_LINE}</span>}
                      </p>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
        {props.gateway === "razorpay" && (
          <label className="mt-4 flex w-fit max-w-full cursor-pointer items-start gap-3 rounded-2xl bg-secondary/40 p-3 pr-4 text-sm hairline">
            <input type="checkbox" className="spc-check mt-0.5 h-[18px] w-[18px] shrink-0" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
            <span>
              <span className="block font-medium">Save this card for future transactions</span>
              <span className="block text-[12.5px] text-muted-foreground">Razorpay keeps it as a secure token after you agree on its screen. Outlly never sees the card number.</span>
            </span>
          </label>
        )}
        <p className="mt-3 text-[12.5px] text-muted-foreground">Prices include applicable taxes. Each payment covers one period and nothing is charged automatically unless you turn on auto-renew: when it ends you can pay again or stay on Free. Switching plans starts the new one today.</p>
      </section>

      <div className="mt-10 grid items-start gap-4 lg:grid-cols-[1fr_1.6fr]">
        <PaymentMethodCard periodEnd={current?.periodEnd ?? null} online={online} />
        <BillingHistory rows={history} email={props.email} cachedAt={cachedAt} />
      </div>
      <SavedCardsSection className="mt-4" plansHref="#plans" />
      <p className="mt-4 text-[13px] text-muted-foreground">{props.guarantee?.state === "eligible" ? "Charged by mistake, or something else? " : "Charged by mistake, or need a refund after the 30-day guarantee? "}<Link href="/support?topic=Payments" className="font-medium text-foreground underline underline-offset-4">Ask support</Link> and a person will review it.</p>

      <PriceSurvey currency={props.currency} planSlug={currentSlug} />

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
            <>
            <CancelReasons value={why} onChange={setWhy} />
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
            </>
          ) : null
        }
      />
    </div>
  );
}
