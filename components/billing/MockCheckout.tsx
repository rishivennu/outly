"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CreditCard, Loader2, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Pip } from "@/components/brand/Pip";
import { OutlyLogo } from "@/components/brand/Logo";
import { formatMoney, intervalLabel } from "@/lib/billing/money";
import { cn } from "@/lib/utils";

const CARDS = [
  { n: "4242 4242 4242 4242", what: "succeeds" },
  { n: "4000 0000 0000 0002", what: "is declined" },
  { n: "4000 0000 0000 9995", what: "has insufficient funds" },
];
const fmtCard = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
const fmtExp = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

/** Stands in for a hosted gateway page so the whole paid flow (success, decline, retry, invoice, email) can be tested. */
export function MockCheckout({ paymentId, amountMinor, currency, planName, interval, email }: { paymentId: string; amountMinor: number; currency: string; planName: string; interval: string; email: string }) {
  const router = useRouter();
  const [method, setMethod] = useState<"card" | "upi">("card");
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [upi, setUpi] = useState("");
  const [state, setState] = useState<"idle" | "paying" | "failed" | "done">("idle");
  const [error, setError] = useState("");
  const amount = formatMoney(amountMinor, currency);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (method === "card" && (!/^\d{2}\/\d{2}$/.test(exp) || cvc.length < 3)) {
      setState("failed");
      setError("Add the expiry (MM/YY) and the 3-digit CVC. Any future date and any CVC work in test mode.");
      return;
    }
    setState("paying");
    setError("");
    try {
      const r = await fetch("/api/billing/mock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentId, method, card, upi }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error ?? "The payment didn't go through.");
      setState("done");
      setTimeout(() => router.replace(`/billing?paid=${j.invoice ?? ""}`), 1100);
    } catch (err) {
      setState("failed");
      setError(navigator.onLine ? (err as Error).message : "You're offline. Nothing was charged; reconnect and try again.");
    }
  }

  const mood = state === "done" ? "happy" : state === "failed" ? "sad" : state === "paying" ? "think" : "wave";
  return (
    <div className="grid min-h-[calc(100dvh-2rem)] place-items-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <Link href="/billing" className="mb-4 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Back to billing</Link>
        <div className="glass-strong admin-page-in rounded-[32px] p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <OutlyLogo size={26} />
            <span className="rounded-full bg-warning/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider">Test checkout</span>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <Pip size={64} mood={mood} />
            <div>
              <p className="text-sm text-muted-foreground">Outlly {planName}</p>
              <p className="text-3xl font-semibold tracking-tight tabular">{amount}<span className="text-base font-medium text-muted-foreground">{intervalLabel(interval)}</span></p>
            </div>
          </div>

          {state === "done" ? (
            <div role="status" className="mt-8 text-center">
              <p className="text-lg font-semibold">Payment successful</p>
              <p className="mt-1 text-sm text-muted-foreground">Your invoice is on its way to {email}. Taking you back…</p>
            </div>
          ) : (
            <form onSubmit={pay} className="mt-7" noValidate>
              <div role="tablist" aria-label="Payment method" className="relative grid grid-cols-2 rounded-full bg-secondary p-1">
                <span aria-hidden className="blob-tab absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-card shadow-sm" style={{ transform: method === "upi" ? "translateX(100%)" : "none" }} />
                {(["card", "upi"] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setState("idle"); setError(""); }} className={cn("relative z-10 flex h-10 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors", method === m ? "text-foreground" : "text-muted-foreground")}>
                    {m === "card" ? <CreditCard className="h-4 w-4" aria-hidden /> : <Smartphone className="h-4 w-4" aria-hidden />}{m === "card" ? "Card" : "UPI"}
                  </button>
                ))}
              </div>

              {method === "card" ? (
                <div className="mt-5 space-y-4">
                  <div>
                    <Label htmlFor="cc">Card number</Label>
                    <Input id="cc" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={card} onChange={(e) => setCard(fmtCard(e.target.value))} className="mt-1.5 font-mono tabular" aria-invalid={state === "failed"} aria-describedby="pay-err" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label htmlFor="exp">Expiry</Label><Input id="exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={exp} onChange={(e) => setExp(fmtExp(e.target.value))} className="mt-1.5 tabular" /></div>
                    <div><Label htmlFor="cvc">CVC</Label><Input id="cvc" inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, ""))} className="mt-1.5 tabular" /></div>
                  </div>
                </div>
              ) : (
                <div className="mt-5">
                  <Label htmlFor="upi">UPI id</Label>
                  <Input id="upi" autoComplete="off" placeholder="name@okbank" value={upi} onChange={(e) => setUpi(e.target.value.trim())} className="mt-1.5" aria-invalid={state === "failed"} aria-describedby="pay-err" />
                </div>
              )}

              <div id="pay-err" role="alert" className="liquid-panel mt-3 text-sm text-destructive" data-open={state === "failed"}>
                <div><p className="liquid-inner">{error}{state === "failed" && " Nothing was charged."}</p></div>
              </div>

              <Button type="submit" variant="lime" size="lg" className="mt-5 w-full" disabled={state === "paying"}>
                {state === "paying" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Processing</> : <><Lock className="h-4 w-4" aria-hidden /> {state === "failed" ? "Try again" : `Pay ${amount}`}</>}
              </Button>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-lime-ink" aria-hidden />
                First payment? It has a 30-day money-back guarantee.
              </p>
            </form>
          )}
        </div>

        <details className="mt-4 rounded-[20px] px-5 py-4 text-sm hairline">
          <summary className="cursor-pointer font-medium">Test details</summary>
          <ul className="mt-3 space-y-1.5 text-muted-foreground">
            {CARDS.map((c) => (
              <li key={c.n}><button type="button" className="font-mono text-foreground underline-offset-4 hover:underline" onClick={() => { setMethod("card"); setCard(c.n); setExp("12/30"); setCvc("123"); setState("idle"); }}>{c.n}</button> {c.what}</li>
            ))}
            <li>UPI: any <span className="font-mono text-foreground">name@bank</span> succeeds, <span className="font-mono text-foreground">fail@upi</span> is declined.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
