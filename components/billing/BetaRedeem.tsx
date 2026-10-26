"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";

export type BetaOffer = { code: { code: string; months: number; planName: string } | null; redeemed: boolean };

/**
 * First-member code on Billing. Members who were issued a code see it filled in; anyone with a code from
 * the team can type it. Redeeming switches the plan on straight away.
 */
export function BetaRedeem({ offer }: { offer: BetaOffer }) {
  const toast = useToast();
  const router = useRouter();
  const [code, setCode] = useState(offer.code?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (offer.redeemed) return null;

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ planName: string; until: string }>("/api/billing/beta", { method: "POST", json: { code } });
      toast(`${r.planName} is on until ${new Date(r.until).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. Enjoy!`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="beta" aria-labelledby="beta-h" className="glass mt-6 max-w-5xl rounded-[28px] p-6 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-lime/20" aria-hidden><Gift className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="beta-h" className="text-lg font-semibold tracking-tight">{offer.code ? `You've got ${offer.code.months} free months of ${offer.code.planName}` : "Have a beta code?"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {offer.code ? "Thanks for joining early. Your one-time code is below; redeem it whenever you're ready. Nothing is charged and nothing renews." : "Enter the one-time code you got from Outlly. It works once, and switches the plan on straight away."}
          </p>
          <form onSubmit={redeem} className="mt-4 flex flex-wrap items-start gap-2">
            <label htmlFor="beta-code" className="sr-only">Beta code</label>
            <Input
              id="beta-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BETA-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              aria-invalid={!!err}
              aria-describedby={err ? "beta-err" : undefined}
              className="h-11 w-full max-w-[16rem] font-mono tracking-wider"
            />
            {offer.code && (
              <Button type="button" variant="ghost" onClick={() => navigator.clipboard?.writeText(offer.code!.code).then(() => toast("Code copied"), () => {})}>
                <Copy className="h-4 w-4" aria-hidden /> Copy
              </Button>
            )}
            <Button type="submit" variant="lime" disabled={busy || code.trim().length < 6}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Redeem
            </Button>
          </form>
          {err && <p id="beta-err" role="alert" className="mt-2 text-[13px] text-destructive">{err}</p>}
        </div>
      </div>
    </section>
  );
}
