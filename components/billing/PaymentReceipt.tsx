"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Download, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { formatMoney } from "@/lib/billing/money";
import { isFinal, receiptKey, type Receipt, type ReceiptState } from "@/lib/billing/receipt-core";
import { cn } from "@/lib/utils";

const GATEWAY: Record<string, string> = { stripe: "Card or wallet (Stripe)", razorpay: "Razorpay", paypal: "PayPal", youpi: "UPI", mock: "Test checkout" };
const POLL_MS = 4_000;
const POLL_MAX = 30; // two minutes, then hand over to email

const COPY: Record<ReceiptState, { stamp: string; title: string; line: string }> = {
  paid: { stamp: "Paid", title: "Payment received", line: "Your plan is on. The invoice is in your inbox too." },
  pending: { stamp: "Processing", title: "Confirming your payment", line: "Your bank is still confirming. This slip updates by itself." },
  failed: { stamp: "Failed", title: "Payment didn't go through", line: "Nothing was charged. Try again, or pick another way to pay." },
  cancelled: { stamp: "Cancelled", title: "Checkout cancelled", line: "You left checkout before paying, so nothing was charged." },
};

function seen(r: Receipt) {
  try {
    return localStorage.getItem(receiptKey(r)) === "1";
  } catch {
    return false;
  }
}
function markSeen(r: Receipt) {
  try {
    localStorage.setItem(receiptKey(r), "1");
  } catch {}
}

/**
 * The receipt slip that prints after checkout (1053). It only ever shows what our database says about the
 * payment; a pending one checks back until it settles. Each final outcome prints with motion once per
 * payment: a refresh, the back button or a second tab gets the same slip without the show.
 */
export function PaymentReceipt({ initial, onClose, onRetry }: { initial: Receipt; onClose: () => void; onRetry: () => void }) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [quiet, setQuiet] = useState<boolean | null>(null); // decided after mount (localStorage)
  const [tries, setTries] = useState(0);
  const [tick, setTick] = useState(0); // re-arms the timer while the tab is hidden, without spending a try
  const [checking, setChecking] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    const already = isFinal(initial.state) && seen(initial);
    setQuiet(already);
    if (isFinal(initial.state)) markSeen(initial);
  }, [initial]);

  const check = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setChecking(true);
    try {
      const j = await api<{ receipt: Receipt }>(`/api/billing/payments/${encodeURIComponent(r.paymentId)}`);
      if (j.receipt.state !== r.state) {
        setR(j.receipt);
        setQuiet(false); // a change of outcome always prints
        if (isFinal(j.receipt.state)) markSeen(j.receipt);
        if (j.receipt.state === "paid") router.refresh(); // the plan card and limits catch up
      }
    } catch {
      // offline or a blip: the next tick tries again
    } finally {
      inflight.current = false;
      setChecking(false);
      setTries((t) => t + 1);
    }
  }, [r.paymentId, r.state, router]);

  useEffect(() => {
    if (r.state !== "pending" || tries >= POLL_MAX) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") void check();
      else setTick((n) => n + 1);
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [r.state, tries, tick, check]);

  const c = COPY[r.state];
  const gaveUp = r.state === "pending" && tries >= POLL_MAX;
  const when = new Date(r.at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const rows: [string, React.ReactNode][] = [
    ["Plan", `${r.planName}, ${r.interval === "year" ? "yearly" : "monthly"}`],
    ["Amount", <span key="a" className="tabular">{formatMoney(r.amountMinor, r.currency)}</span>],
    ["Paid with", GATEWAY[r.provider] ?? r.provider],
    [r.state === "paid" ? "Paid on" : "Started", when],
    ...(r.invoice ? ([["Invoice", r.invoice]] as [string, React.ReactNode][]) : []),
    ["Reference", <span key="r" className="font-mono text-[12px]">{r.paymentId.slice(-10).toUpperCase()}</span>],
  ];
  const animate = quiet === false;

  return (
    <section aria-labelledby="rcpt-h" className="mt-6 max-w-md" data-state={r.state}>
      {/* The printer slot the slip comes out of. */}
      <div className="relative z-10 h-4 rounded-full bg-foreground/85 shadow-[0_6px_18px_-6px_rgba(0,0,0,0.5)]" aria-hidden="true" />
      <div className="-mt-2 overflow-hidden px-3 pb-3">
        <div key={`${r.state}-${animate}`} className={cn("rcpt-slip relative bg-[#fbfdf7] px-6 pb-5 pt-7 text-[#1b2119] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)]", animate && "rcpt-print")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5b6658]">Outlly receipt</p>
              <h2 id="rcpt-h" className="mt-1 text-[1.25rem] font-semibold leading-tight tracking-tight">{c.title}</h2>
            </div>
            <button type="button" onClick={onClose} className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#5b6658] hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1b2119]" aria-label="Close receipt">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <dl className="mt-4 border-y border-dashed border-[#c9d0c4] py-3 text-[14px]">
            {rows.map(([k, v], i) => (
              <div key={k} className={cn("flex items-baseline justify-between gap-4 py-1", animate && "rcpt-row")} style={animate ? { animationDelay: `${520 + i * 90}ms` } : undefined}>
                <dt className="text-[#5b6658]">{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex items-center gap-3">
            <span
              className={cn(
                "rcpt-stamp grid h-14 w-14 shrink-0 place-items-center rounded-full border-[3px] text-[10px] font-black uppercase tracking-wider",
                r.state === "paid" && "border-[#3f7a12] text-[#3f7a12]",
                r.state === "pending" && "border-[#9a5b00] text-[#9a5b00]",
                r.state === "failed" && "border-[#b42318] text-[#b42318]",
                r.state === "cancelled" && "border-[#5b6658] text-[#5b6658]",
                animate && "rcpt-stamp-in",
              )}
              style={animate ? { animationDelay: `${560 + rows.length * 90}ms` } : undefined}
              aria-hidden="true"
            >
              {r.state === "paid" ? <Check className="h-6 w-6" strokeWidth={3} /> : r.state === "pending" ? <Clock className={cn("h-6 w-6", checking && "animate-pulse")} /> : <X className="h-6 w-6" strokeWidth={3} />}
            </span>
            <p className="text-[13.5px] leading-snug" role="status" aria-live="polite">
              <b className="block text-[14px]">{c.stamp}</b>
              {gaveUp ? "Still processing. We'll email you the moment it clears, and this page will show it." : r.state === "failed" && r.reason ? `${c.line} (${r.reason})` : c.line}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {r.state === "paid" && r.invoice && (
              <Button asChild variant="primary">
                <a href={`/api/billing/invoices/${r.invoice}`} aria-label={`Download invoice ${r.invoice} (PDF)`}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Invoice PDF
                </a>
              </Button>
            )}
            {(r.state === "failed" || r.state === "cancelled") && (
              <Button variant="primary" onClick={onRetry}>
                {r.state === "failed" ? "Try again" : "Choose a plan"}
              </Button>
            )}
            {gaveUp && (
              <Button variant="outline" onClick={() => { setTries(POLL_MAX - 1); void check(); }} disabled={checking}>
                <RotateCw className={cn("h-4 w-4", checking && "animate-spin")} aria-hidden="true" /> Check again
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} className="text-[#1b2119] hover:bg-black/5">
              Done
            </Button>
          </div>
          <div className="rcpt-edge absolute inset-x-0 top-full h-2.5 bg-[#fbfdf7]" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
