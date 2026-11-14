"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Plus, RefreshCw, ShieldCheck, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { SavedCard } from "@/lib/billing/saved-cards-core";
import { SavedPaymentCard, cardLabel } from "./SavedPaymentCard";

type View = { supported: boolean; gateway: string; cards: SavedCard[]; lookupFailed: boolean };
const GW: Record<string, string> = { stripe: "Stripe", paypal: "PayPal", youpi: "UPI", mock: "Test checkout" };

/**
 * 1118: "Saved Payment Methods". Real cards only: what Razorpay lists for this customer.
 * Razorpay saves a card during a payment, with its own consent, so "Add new" explains that rather than faking a form.
 */
export function SavedCardsSection({ id = "billing-saved", className, plansHref = "/billing#plans" }: { id?: string; className?: string; plansHref?: string }) {
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setErr(false);
    try {
      setV(await api<View>("/api/billing/cards"));
    } catch {
      setErr(true);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function act(card: SavedCard, kind: "default" | "remove") {
    setBusy(`${kind}-${card.id}`);
    try {
      const next = await api<View>("/api/billing/cards", kind === "default" ? { method: "PATCH", json: { default: card.id } } : { method: "DELETE", json: { id: card.id } });
      setV(next);
      setConfirm(null);
      toast(kind === "default" ? `${card.networkLabel} •••• ${card.last4} is your default card.` : `${card.networkLabel} •••• ${card.last4} was removed from Razorpay.`, "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const cards = v?.cards ?? [];
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-h`} className={cn("glass scroll-mt-6 rounded-[32px] p-6 outline-none sm:p-8", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden="true"><CreditCard className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight">Saved Payment Methods</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cards are saved and held by Razorpay as secure tokens. Outlly never sees or stores a card number.</p>
          </div>
        </div>
        {v?.supported && (
          <Button variant="outline" size="sm" aria-expanded={adding} aria-controls={`${id}-add`} onClick={() => setAdding((a) => !a)}>
            <Plus className="h-4 w-4" aria-hidden />Add new
          </Button>
        )}
      </div>

      <div className="mt-5" aria-live="polite" aria-busy={!v && !err}>
        {!v && !err && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="spc-skel aspect-[1.586] max-w-[360px] rounded-[22px]" />
          </div>
        )}
        {err && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            <p className="flex-1">Saved cards couldn't load.</p>
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden />Try again</Button>
          </div>
        )}
        {v && !v.supported && (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Saved cards work when payments run through Razorpay. Checkout is on {GW[v.gateway] ?? v.gateway} right now, which doesn't keep cards, so you pick a method each time.
          </p>
        )}
        {v?.supported && v.lookupFailed && <p className="mb-4 text-sm pill-ink-warn">Razorpay didn't answer, so your saved cards can't be shown right now. They're still saved.</p>}
        {v?.supported && !v.lookupFailed && !cards.length && (
          <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">No saved cards yet. Tick <b className="text-foreground">Save this card for future transactions</b> at your next checkout and Razorpay will ask to save it.</p>
        )}

        {cards.length > 0 && (
          <ul className="grid gap-5 sm:grid-cols-2">
            {cards.map((c, i) => (
              <li key={c.id} className="spc-in flex flex-col gap-3" style={{ ["--i" as any]: i }}>
                <SavedPaymentCard card={c} />
                <div className="flex max-w-[360px] flex-wrap items-center gap-2">
                  {!c.isDefault && !c.expired && (
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void act(c, "default")} aria-label={`Make ${cardLabel(c)} the default`}>
                      <Star className="h-4 w-4" aria-hidden />{busy === `default-${c.id}` ? "Saving…" : "Set as default"}
                    </Button>
                  )}
                  {confirm === c.id ? (
                    <>
                      <Button variant="outline" size="sm" className="border-destructive/50 text-destructive" disabled={!!busy} onClick={() => void act(c, "remove")}>
                        {busy === `remove-${c.id}` ? "Removing…" : "Remove card"}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setConfirm(null)}>Keep</Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setConfirm(c.id)} aria-label={`Remove ${cardLabel(c)}`}>
                      <Trash2 className="h-4 w-4" aria-hidden />Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {v?.supported && (
          <div id={`${id}-add`} className="spc-add grid" data-open={adding || undefined} inert={!adding || undefined}>
            <div className="overflow-hidden">
              <div className="mt-5 flex gap-3 rounded-2xl bg-secondary/40 p-4 text-sm hairline">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-lime-ink" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">Cards are added during a payment</p>
                  <p className="mt-1 text-muted-foreground">Razorpay only saves a card while you pay with it, on its own secure form, so Outlly never handles the number. At your next checkout, tick <b className="text-foreground">Save this card for future transactions</b>, then agree on Razorpay's screen.</p>
                  <Link href={plansHref} className="mt-2 inline-block font-medium underline underline-offset-4" onClick={() => setAdding(false)}>See plans and top-ups</Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
