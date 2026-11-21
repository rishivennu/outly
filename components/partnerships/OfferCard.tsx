"use client";
import { useEffect, useId, useState } from "react";
import { Clock3, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/shared/Sheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { MineOffer } from "@/lib/partners/mine-types";
import { API, expiryLabel, offerTerms } from "./model";
import { useAction } from "./useAction";

export function TermsList({ offer }: { offer: MineOffer }) {
  return (
    <dl className="divide-y divide-foreground/[0.08]">
      {offerTerms(offer).map((r) => (
        <div key={r.term} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
          <dt className="text-[13px] font-medium text-muted-foreground">{r.term}</dt>
          <dd className="whitespace-pre-line text-pretty text-[15px] leading-relaxed [overflow-wrap:anywhere]">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Re-reads the clock every minute, so "Expires in 5 hours" stays true while the page is open. */
function useExpiry(expiresAt: string | null) {
  const [label, setLabel] = useState(() => expiryLabel(expiresAt));
  useEffect(() => {
    setLabel(expiryLabel(expiresAt));
    if (!expiresAt) return;
    const t = window.setInterval(() => setLabel(expiryLabel(expiresAt)), 60_000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  return label;
}

/** An offer waiting for the creator. Accepting goes through a full-terms confirmation with an explicit tick. */
export function OfferCard({ appRef, offer }: { appRef: string; offer: MineOffer }) {
  const { busy, run } = useAction();
  const id = useId();
  const expiry = useExpiry(offer.expiresAt);
  const expired = expiry === "Expired";
  const [ask, setAsk] = useState<"accept" | "decline" | null>(null);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");

  async function answer(decision: "accept" | "decline") {
    const json = decision === "accept" ? { decision } : { decision, declineReason: reason.trim() || undefined };
    const ok = await run(API.offer(appRef, offer.id), json, decision === "accept" ? "Offer accepted. Welcome aboard." : "Offer declined. Thanks for letting us know.");
    if (ok) setAsk(null);
  }

  return (
    <section id="offer" aria-labelledby={`${id}-h`} className="scroll-mt-24 rounded-[24px] border border-lime-ink/40 bg-card p-5 sm:p-6" data-offer={offer.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime/20 text-lime-ink">
            <Gift className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-h`} className="text-[17px] font-semibold leading-snug">Your partnership offer</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Offer version {offer.version}. Nothing starts until you accept.</p>
          </div>
        </div>
        {expiry && (
          <span className={expired ? "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 text-xs font-medium text-[hsl(0_72%_38%)] dark:text-destructive" : "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs font-medium"} aria-live="polite">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {expiry}
          </span>
        )}
      </div>

      <div className="mt-5">
        <TermsList offer={offer} />
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="lime" size="md" disabled={expired || busy} onClick={() => { setAgree(false); setAsk("accept"); }} className="w-full sm:w-auto sm:min-w-[11rem]">
          Accept Offer
        </Button>
        <Button type="button" variant="outline" size="md" disabled={expired || busy} onClick={() => { setReason(""); setAsk("decline"); }} className="w-full sm:w-auto sm:min-w-[10rem]">
          Decline Offer
        </Button>
      </div>
      {expired && <p className="mt-3 text-[13px] text-muted-foreground">This offer has expired. Reply to the offer email if you are still interested.</p>}

      <Sheet open={ask === "accept"} onOpenChange={(o) => !o && !busy && setAsk(null)} side="center" title="Confirm the terms" description={`Offer version ${offer.version}. Your acceptance is recorded with today's date and these exact terms.`}>
        <div className="grid gap-5 pt-2">
          {/* The terms scroll inside their own box so the checkbox and the buttons stay in view. */}
          <div data-lenis-prevent className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-2xl border border-foreground/[0.08] px-4 py-1">
            <TermsList offer={offer} />
          </div>
          <label htmlFor={`${id}-agree`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-secondary/50 px-4 py-3 text-[14px] leading-snug">
            <input id={`${id}-agree`} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-lime" data-agree="" />
            <span>I accept these terms</span>
          </label>
          <p className="text-[13px] text-muted-foreground">Any complimentary subscription switches on only after our system confirms the acceptance.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="subtle" size="md" onClick={() => setAsk(null)} disabled={busy}>
              Not yet
            </Button>
            <Button type="button" variant="lime" size="md" disabled={!agree || busy} aria-busy={busy} onClick={() => void answer("accept")}>
              {busy ? "Accepting…" : "Accept Offer"}
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={ask === "decline"}
        onOpenChange={(o) => !o && !busy && setAsk(null)}
        title="Decline this offer?"
        body="The team is told. If you change your mind or would like different terms, reply to the offer email."
        confirmLabel="Decline Offer"
        cancelLabel="Go back"
        busy={busy}
        extra={
          <div className="mt-4">
            <Label htmlFor={`${id}-reason`}>Reason (optional)</Label>
            <Textarea id={`${id}-reason`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example, the timeline does not work for me" />
          </div>
        }
        onConfirm={() => void answer("decline")}
      />
    </section>
  );
}
