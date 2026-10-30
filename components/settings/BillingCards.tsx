"use client";
import Link from "next/link";
import { ArrowRight, CreditCard, Download, FileText, Receipt, RefreshCw, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/billing/money";
import { cn } from "@/lib/utils";
import { useOpenCategory } from "./SettingsShell";

export type BillingSummary = {
  name: string;
  email: string;
  gateway: string;
  inForce: string;
  plan: { name: string; priceMinor: number; currency: string; interval: string; periodEnd: string; cancelAtPeriodEnd: boolean; pausedUntil: string | null; provider: string } | null;
  extra: { planName: string; source: string; endsAt: string } | null;
  payments: { id: string; amountMinor: number; currency: string; provider: string; status: string; interval: string; at: string; reason: string | null; invoice: string | null }[];
  invoices: { number: string; description: string; amountMinor: number; currency: string; issuedAt: string; refunded: boolean; creditNote: string | null }[];
};

type MethodId = "visa" | "mc" | "apple" | "gpay" | "upi";
const METHODS: { id: MethodId; label: string }[] = [
  { id: "visa", label: "Visa" },
  { id: "mc", label: "Mastercard" },
  { id: "apple", label: "Apple Pay" },
  { id: "gpay", label: "Google Pay" },
  { id: "upi", label: "UPI" },
];
/** What each gateway's checkout page can take. Wallets show only on devices that support them. */
const OFFERED: Record<string, MethodId[]> = {
  stripe: ["visa", "mc", "apple", "gpay"],
  razorpay: ["visa", "mc", "gpay", "upi"],
  paypal: ["visa", "mc"],
  youpi: ["upi", "gpay"],
  mock: ["visa", "mc", "apple", "gpay", "upi"],
};
const GATEWAY: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay", paypal: "PayPal", youpi: "UPI", mock: "Test checkout" };
const gwName = (g: string) => GATEWAY[g] ?? g;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const cycle = (i: string) => (i === "year" ? "year" : "month");

const STATUS: Record<string, { label: string; cls: string }> = {
  succeeded: { label: "Paid", cls: "bg-success/15 pill-ink-ok" },
  pending: { label: "Processing", cls: "bg-warning/15 pill-ink-warn" },
  failed: { label: "Failed", cls: "bg-destructive/10 pill-ink-bad" },
  refunded: { label: "Refunded", cls: "bg-accent/10 pill-ink-info" },
};
function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-secondary text-muted-foreground" };
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-semibold", s.cls)}>{s.label}</span>;
}

/** Wordmark chips, drawn in type and two circles so no brand image files are needed. */
function Chip({ id, className, style }: { id: MethodId; className?: string; style?: React.CSSProperties }) {
  const base = "pay-chip inline-flex h-9 items-center justify-center rounded-xl px-3 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)] ring-1 ring-white/10";
  const body =
    id === "visa" ? <span className="text-[15px] font-black italic tracking-tight text-[#1a1f71]">VISA</span>
    : id === "mc" ? (
      <span className="flex items-center" aria-hidden="true">
        <span className="h-5 w-5 rounded-full bg-[#eb001b]" />
        <span className="-ml-2 h-5 w-5 rounded-full bg-[#f79e1b] mix-blend-multiply" />
      </span>
    )
    : id === "apple" ? <span className="text-[13.5px] font-semibold tracking-tight text-white">Apple Pay</span>
    : id === "gpay" ? <span className="text-[13.5px] font-semibold tracking-tight text-[#3c4043]"><span className="text-[#4285f4]">G</span> Pay</span>
    : <span className="text-[14px] font-black italic tracking-tight"><span className="text-[#097939]">UP</span><span className="text-[#ed752e]">I</span></span>;
  const bg = id === "apple" ? "bg-black" : "bg-white";
  return (
    <span className={cn(base, bg, className)} style={style} title={METHODS.find((m) => m.id === id)?.label}>
      {body}
      <span className="sr-only">{METHODS.find((m) => m.id === id)?.label}</span>
    </span>
  );
}

const scrollTo = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
};

/** The dark Payments card at the top of Settings > Billing: the wallet, the ways to pay and the three promises. */
export function PaymentsBento({ b }: { b: BillingSummary }) {
  const status = !b.plan
    ? `You're on ${b.inForce}.`
    : b.plan.pausedUntil
      ? `${b.plan.name} is paused until ${day(b.plan.pausedUntil)}.`
      : b.plan.cancelAtPeriodEnd
        ? `${b.plan.name} ends on ${day(b.plan.periodEnd)}.`
        : `${b.plan.name} renews on ${day(b.plan.periodEnd)}.`;
  const tiles = [
    { Ico: CreditCard, t: "Pay your way", d: "Cards, wallets and UPI, depending on where you are." },
    { Ico: Receipt, t: "Invoice in seconds", d: "A PDF in your inbox the moment a payment clears." },
    { Ico: RefreshCw, t: "Change any time", d: "Upgrade, pause or cancel. No calls, no forms." },
  ];
  return (
    <section aria-labelledby="pay-h" className="pay-bento relative overflow-hidden rounded-[32px] bg-[#0a0d0b] p-4 text-white ring-1 ring-white/10 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* The wallet, with the ways to pay floating around it. Decorative: the same list is spelled out below. */}
        <div className="relative isolate grid min-h-[250px] place-items-center overflow-hidden rounded-[24px] bg-[#111612] ring-1 ring-white/[0.06]" aria-hidden="true">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_55%,rgba(190,242,100,0.22),transparent_70%)]" />
          <div className="relative h-[118px] w-[168px]">
            <div className="absolute inset-x-3 -top-5 h-16 rotate-[-6deg] rounded-xl bg-gradient-to-br from-[#d9f99d] to-[#84cc16] shadow-lg">
              <span className="absolute left-3 top-3 h-3.5 w-5 rounded-[4px] bg-black/25" />
            </div>
            <div className="absolute inset-x-6 -top-2 h-14 rotate-[5deg] rounded-xl bg-[#26302a] ring-1 ring-white/10" />
            <div className="absolute inset-0 rounded-[22px] bg-gradient-to-b from-[#1d2520] to-[#121813] ring-1 ring-white/15">
              <div className="absolute -right-1 top-1/2 h-10 w-12 -translate-y-1/2 rounded-l-xl bg-[#0c100d] ring-1 ring-white/15">
                <span className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-lime shadow-[0_0_18px_rgba(190,242,100,0.75)]" />
              </div>
              <Wallet className="absolute bottom-3 left-4 h-5 w-5 text-white/40" />
            </div>
          </div>
          <Chip id="visa" className="absolute left-[8%] top-[14%]" style={{ animationDelay: "0s" }} />
          <Chip id="mc" className="absolute right-[9%] top-[12%]" style={{ animationDelay: "-1.4s" }} />
          <Chip id="apple" className="absolute left-[5%] bottom-[16%]" style={{ animationDelay: "-2.8s" }} />
          <Chip id="gpay" className="absolute right-[6%] bottom-[18%]" style={{ animationDelay: "-4.2s" }} />
          <Chip id="upi" className="absolute bottom-[5%] left-1/2 -translate-x-1/2" style={{ animationDelay: "-3.5s" }} />
        </div>

        <div className="flex flex-col justify-between gap-5 rounded-[24px] bg-white/[0.04] p-5 ring-1 ring-white/[0.06] sm:p-6">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-lime">Payments</p>
            <h2 id="pay-h" className="mt-2 text-[1.65rem] font-semibold leading-tight tracking-tight">Seamless Payment Solutions</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">
              Checkout runs on {gwName(b.gateway)}. Your card or UPI details go straight to them, so Outlly never sees or stores them.
            </p>
            <p className="mt-4 flex items-center gap-2 text-[14px] font-medium text-white/90" role="status">
              <ShieldCheck className="h-4 w-4 shrink-0 text-lime" aria-hidden="true" /> {status}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="lime">
              <Link href="/billing">{b.plan ? "Manage plan" : "See plans"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            </Button>
            <button type="button" onClick={() => scrollTo("billing-invoices")} className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-white/85 ring-1 ring-white/15 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime">
              <FileText className="h-4 w-4" aria-hidden="true" /> Invoices
            </button>
          </div>
        </div>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {tiles.map(({ Ico, t, d }) => (
          <li key={t} className="rounded-[20px] bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime/15 text-lime" aria-hidden="true"><Ico className="h-[18px] w-[18px]" /></span>
            <p className="mt-3 text-[14.5px] font-semibold">{t}</p>
            <p className="mt-1 text-[13px] leading-snug text-white/65">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ id, title, hint, icon: Ico, children, action }: { id: string; title: string; hint?: string; icon: typeof Wallet; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-h`} className="glass scroll-mt-6 rounded-[32px] p-6 outline-none sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true"><Ico className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight">{title}</h2>
            {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ icon: Ico, children }: { icon: typeof Wallet; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
      <Ico className="h-5 w-5 shrink-0 opacity-70" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function PlanSection({ b }: { b: BillingSummary }) {
  const p = b.plan;
  return (
    <Card id="billing-plan" title="Plan" icon={ShieldCheck} hint="What you're on and when it next changes." action={<Button asChild variant="outline"><Link href="/billing">{p ? "Change plan" : "Upgrade"}</Link></Button>}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-2xl bg-secondary/40 p-4">
        <p className="text-lg font-semibold">{p ? p.name : b.inForce}</p>
        <p className="tabular text-[15px] font-medium">{p ? `${formatMoney(p.priceMinor, p.currency)} / ${cycle(p.interval)}` : "No charge"}</p>
        <p className="w-full text-sm text-muted-foreground">
          {!p
            ? "Nothing is charged. Upgrade any time and the invoice arrives by email straight away."
            : p.pausedUntil
              ? `Paused until ${day(p.pausedUntil)}. Your paid days pick up after, to ${day(p.periodEnd)}.`
              : p.cancelAtPeriodEnd
                ? `Ends on ${day(p.periodEnd)}, then you move to Free. Nothing else will be charged.`
                : `Renews on ${day(p.periodEnd)} through ${gwName(p.provider)}.`}
        </p>
      </div>
      {b.extra && (
        <p className="mt-3 text-sm text-muted-foreground">
          Also active: <b className="text-foreground">{b.extra.planName}</b> {b.extra.source === "referral" ? "from a referral" : "from the Outlly team"}, until {day(b.extra.endsAt)}.
        </p>
      )}
    </Card>
  );
}

export function MethodsSection({ b }: { b: BillingSummary }) {
  const on = new Set(OFFERED[b.gateway] ?? []);
  return (
    <Card id="billing-methods" title="Payment methods" icon={CreditCard} hint={`Picked at checkout on ${gwName(b.gateway)}. No card is saved with Outlly, so there's nothing here to remove or leak.`}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {METHODS.map((m) => {
          const ok = on.has(m.id);
          return (
            <li key={m.id} className={cn("flex min-h-14 items-center gap-3 rounded-2xl p-3 hairline", ok ? "bg-secondary/40" : "opacity-60")}>
              <Chip id={m.id} className="pay-chip-static h-8 shrink-0 shadow-none" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{m.label}</span>
                <span className={cn("block text-[12.5px]", ok ? "pill-ink-ok" : "text-muted-foreground")}>{ok ? (m.id === "apple" || m.id === "gpay" ? "At checkout, on supported devices" : "At checkout") : "Not offered right now"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function HistorySection({ b }: { b: BillingSummary }) {
  return (
    <Card id="billing-history" title="Payment history" icon={Receipt} hint="Every attempt, including ones that didn't go through.">
      {b.payments.length === 0 ? (
        <Empty icon={Receipt}>No payments yet. When you buy a plan, each payment shows here with its status.</Empty>
      ) : (
        <ul className="divide-y divide-border/60">
          {b.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{cycle(p.interval) === "year" ? "Yearly plan" : "Monthly plan"} · {gwName(p.provider)}</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {day(p.at)}
                  {p.status === "failed" && p.reason ? ` · ${p.reason}` : ""}
                  {p.invoice ? ` · Invoice ${p.invoice}` : ""}
                </span>
              </span>
              <span className="tabular text-[14px] font-medium">{formatMoney(p.amountMinor, p.currency)}</span>
              <StatusPill status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function InvoicesSection({ b }: { b: BillingSummary }) {
  const link = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hairline hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <Card id="billing-invoices" title="Invoices" icon={FileText} hint="PDFs for your records. The full list lives on the Billing page." action={b.invoices.length ? <Button asChild variant="ghost"><Link href="/billing">All invoices</Link></Button> : undefined}>
      {b.invoices.length === 0 ? (
        <Empty icon={FileText}>No invoices yet. They appear here and in your inbox ({b.email}) after a payment.</Empty>
      ) : (
        <ul className="divide-y divide-border/60">
          {b.invoices.map((i) => (
            <li key={i.number} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{i.number}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{day(i.issuedAt)} · {i.description}</span>
              </span>
              <span className="tabular text-[14px] font-medium">{formatMoney(i.amountMinor, i.currency)}</span>
              {i.refunded && <StatusPill status="refunded" />}
              <a href={`/api/billing/invoices/${i.number}`} className={link} aria-label={`Download invoice ${i.number} (PDF)`}>
                <Download className="h-4 w-4" aria-hidden="true" /> PDF
              </a>
              {i.creditNote && (
                <a href={`/api/billing/credit-notes/${i.creditNote}`} className={link} aria-label={`Download credit note ${i.creditNote} (PDF)`}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Credit note
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function BillingDetailsSection({ b }: { b: BillingSummary }) {
  const open = useOpenCategory();
  return (
    <Card id="billing-details" title="Billing details" icon={UserRound} hint="Printed on every invoice at the moment you pay.">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-secondary/40 p-4">
          <dt className="text-[12.5px] font-semibold text-muted-foreground">Name</dt>
          <dd className="mt-1 truncate text-[15px] font-medium">{b.name}</dd>
        </div>
        <div className="rounded-2xl bg-secondary/40 p-4">
          <dt className="text-[12.5px] font-semibold text-muted-foreground">Invoices go to</dt>
          <dd className="mt-1 truncate text-[15px] font-medium">{b.email}</dd>
        </div>
      </dl>
      <Button variant="outline" className="mt-4" onClick={() => open("profile")}>Change name in Profile</Button>
    </Card>
  );
}

/** Workspace members don't pay; the studio owner does. */
export function MemberBillingNote({ owner }: { owner: string }) {
  return (
    <Card id="billing-plan" title="Billing" icon={Wallet} hint={`Plans, payments and invoices belong to ${owner}, who owns this studio.`}>
      <Empty icon={ShieldCheck}>Nothing to pay here. Ask {owner} if you need an invoice or a bigger plan.</Empty>
    </Card>
  );
}
