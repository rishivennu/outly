"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { formatMoney } from "@/lib/billing/money";
import { GUARANTEE_DAYS } from "@/lib/billing/guarantee-core";

/** The refund window as the page sends it (dates as ISO strings). */
export type GuaranteeView =
  | { state: "eligible"; amountMinor: number; currency: string; until: string; daysLeft: number; manual: boolean }
  | { state: "none" | "used" | "expired" | "renewed" };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * 30-day money-back guarantee (1076): while the first payment is inside its 30 days, a plain card with one
 * button. Card, PayPal and Razorpay payments go back at once; UPI ones become an urgent ticket (no refund API).
 * Either way the plan ends today, so the dialog says so before anything happens.
 */
export function GuaranteeCard({ g }: { g: GuaranteeView }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  if (g.state !== "eligible") return null;
  const amount = formatMoney(g.amountMinor, g.currency);

  const refund = async () => {
    setBusy(true);
    try {
      const r = await api<{ done: "refunded" | "queued"; ticket?: string }>("/api/billing/refund", { method: "POST", json: { reason, confirm: true } });
      setOpen(false);
      toast(
        r.done === "refunded"
          ? `Refund of ${amount} on its way. Banks take 5 to 10 working days to show it. The receipt is in your inbox.`
          : `Refund requested (ticket ${r.ticket}). UPI refunds are sent by hand, usually within 2 working days.`,
        "ok",
      );
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="guarantee-h" className="glass mt-6 flex max-w-5xl flex-col gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime/15 text-lime-ink" aria-hidden="true">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="guarantee-h" className="font-semibold">{GUARANTEE_DAYS}-day money-back guarantee</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Not working out? Refund your first payment of <b className="text-foreground tabular">{amount}</b> yourself, no questions.{" "}
          <span className="tabular">{g.daysLeft} {g.daysLeft === 1 ? "day" : "days"}</span> left, until {day(g.until)}. Switching plans before then ends this offer.
        </p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)} className="min-h-11 shrink-0">Refund my payment</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        title={`Refund ${amount}?`}
        body={
          g.manual
            ? `Your plan ends today and you move to Free. Your posts and media stay. You paid by UPI, which has no automatic refund, so we send it back to you by hand, usually within 2 working days.`
            : `Your plan ends today and you move to Free. Your posts and media stay. The money goes back to the card or account you paid with; banks take 5 to 10 working days to show it.`
        }
        confirmLabel={g.manual ? "Request my refund" : "Refund and end my plan"}
        cancelLabel="Keep my plan"
        busy={busy}
        onConfirm={refund}
        extra={
          <div className="mt-4">
            <Label htmlFor="refund-why" className="mb-1.5 text-sm font-medium">What didn&apos;t work? <span className="font-normal text-muted-foreground">(optional, helps us fix it)</span></Label>
            <Textarea id="refund-why" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} rows={3} maxLength={300} />
          </div>
        }
      />
    </section>
  );
}
