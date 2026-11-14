"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Gauge, Loader2, MessageCircle, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/track";
import { REVIEW_HREF, VERIFY_HREF, budgetCopy, trialCopy, type BudgetView, type CheckoutSummary, type TrialView } from "./offer-core";

/** 1147: the 7-day trial. Shown on Billing and on the post-signup welcome (`source` tells the server which). */
export function TrialCard({ trial, source = "billing", onSubscribe, className }: { trial: TrialView | null; source?: "billing" | "welcome"; onSubscribe?: () => void; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"start" | "cancel" | null>(null);
  const c = trialCopy(trial);
  if (!c || !trial) return null;
  async function act(action: "start" | "cancel") {
    setBusy(action);
    try {
      await api("/api/billing/trial", { method: "POST", json: { action, source } });
      if (action === "start") track("trial_started", { source });
      toast(action === "start" ? `Your ${trial!.planName} trial has started.` : "Trial cancelled. You're on Free now.", "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-labelledby="trial-h" className={cn("card-glass mt-4 min-w-0 rounded-[28px] bg-card p-5 hairline sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h2 id="trial-h" className="text-[17px] font-semibold tracking-tight">{c.title}</h2>
            <p className="mt-1 max-w-2xl break-words text-sm text-muted-foreground">{c.body}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.action === "start" && (
            <Button variant="lime" onClick={() => act("start")} disabled={!!busy}>
              {busy === "start" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy === "start" ? "Starting trial\u2026" : `Start ${trial.days}-day trial`}
            </Button>
          )}
          {c.action === "cancel" && (
            <>
              {onSubscribe && <Button variant="lime" onClick={onSubscribe}>Subscribe to {trial.planName}</Button>}
              <Button variant="outline" onClick={() => act("cancel")} disabled={!!busy}>
                {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {busy === "cancel" ? "Cancelling trial\u2026" : "Cancel trial"}
              </Button>
            </>
          )}
          {c.action === "verify" && <Button variant="lime" asChild><Link href={VERIFY_HREF}>Verify WhatsApp number</Link></Button>}
          {c.action === "review" && <Button variant="outline" asChild><Link href={REVIEW_HREF}>Ask for a review</Link></Button>}
        </div>
      </div>
    </section>
  );
}

/** 1147: the monthly allowance that keeps heavy AI use affordable. Percent only, never a money figure. */
export function BudgetMeter({ budget, onTopUp }: { budget: BudgetView | null; onTopUp?: () => void }) {
  const c = budgetCopy(budget);
  if (!c) return null;
  return (
    <div className="mt-4 rounded-2xl bg-secondary/40 p-4 hairline" role={c.tone === "ok" ? undefined : "status"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p id="budget-l" className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{c.title}</p>
        {c.tone !== "ok" && onTopUp && (
          <Button size="sm" variant="outline" className="min-h-[44px]" onClick={onTopUp}>See top-ups</Button>
        )}
      </div>
      <div role="progressbar" aria-labelledby="budget-l" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct} className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", c.tone === "bad" ? "bg-destructive" : c.tone === "warn" ? "bg-warning" : "bg-lime")} style={{ width: `${c.pct}%` }} />
      </div>
      <p className="mt-2 break-words text-[13px] text-muted-foreground">{c.body}</p>
    </div>
  );
}

/** 1147: why the first-time offer doesn't show, with the next step. Neutral words; never says "fraud". */
export function OfferGate({ reason, flagId }: { reason: "needs_verification" | "risk_denied" | null; flagId?: string | null }) {
  if (!reason) return null;
  return (
    <div role="status" className="admin-page-in mt-6 flex max-w-3xl items-start gap-3 rounded-2xl bg-accent/10 p-4 text-sm">
      <Tag className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {reason === "needs_verification" ? (
          <>
            <p className="font-medium">One quick step before the first-time offer and the free trial</p>
            <p className="mt-1 text-muted-foreground">Verify your WhatsApp number in Settings. It takes a minute and keeps these offers to one per person. No WhatsApp? Ask for a review and we'll check by email.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="lime" size="sm" className="min-h-[44px]" asChild><Link href={VERIFY_HREF}>Verify WhatsApp number</Link></Button>
              <Button variant="outline" size="sm" className="min-h-[44px]" asChild><Link href={REVIEW_HREF}>Ask for a review</Link></Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium">The first-time offer and free trial aren't available on this account</p>
            <p className="mt-1 text-muted-foreground">You can still subscribe at the standard price below. If you think this is a mistake, ask for a review and a person will look at it, usually within two working days.</p>
            <ReviewForm flagId={flagId ?? null} />
          </>
        )}
      </div>
    </div>
  );
}

/** The appeal: a short note that becomes a support ticket linked to the review flag. */
export function ReviewForm({ flagId, open: startOpen = false }: { flagId: string | null; open?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) return toast("Add a sentence or two so we know what to check.", "error");
    setState("sending");
    try {
      await api("/api/billing/review", { method: "POST", json: { flagId: flagId ?? undefined, message: message.trim().slice(0, 1500) } });
      setState("sent");
    } catch (err) {
      setState("idle");
      toast((err as Error).message, "error");
    }
  }
  if (state === "sent") return <p id="offer-review" role="status" className="mt-3 font-medium">Thanks. Your review request is with our team and you'll get an email reply.</p>;
  if (!open) {
    return (
      <Button id="offer-review" variant="outline" size="sm" className="mt-3 min-h-[44px]" onClick={() => setOpen(true)} aria-expanded={false}>
        <MessageCircle className="h-4 w-4" aria-hidden />Ask for a review
      </Button>
    );
  }
  return (
    <form id="offer-review" onSubmit={send} className="mt-3 max-w-xl">
      <Label htmlFor="review-msg">What should we know?</Label>
      <Textarea id="review-msg" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1500))} rows={3} className="mt-1.5" placeholder="For example: this is my first Outlly account; a family member uses the same Wi-Fi." required />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="submit" variant="lime" size="sm" className="min-h-[44px]" disabled={state === "sending"}>
          {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {state === "sending" ? "Sending request\u2026" : "Send request"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={() => setOpen(false)}>Close form</Button>
      </div>
    </form>
  );
}

/** The summary shown before any payment window opens (rendered inside the confirm dialog). */
export function CheckoutSummaryView({ s, planName }: { s: CheckoutSummary; planName: string }) {
  return (
    <dl className="mt-4 divide-y divide-border rounded-2xl bg-secondary/40 px-4 text-sm hairline">
      <div className="flex items-baseline justify-between gap-3 py-3">
        <dt className="text-muted-foreground">You pay today</dt>
        <dd className="text-right font-semibold tabular">{s.amount}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 py-3">
        <dt className="text-muted-foreground">Price</dt>
        <dd className="text-right font-medium">{s.tier}, {planName}</dd>
      </div>
      <div className="py-3">
        <dt className="text-muted-foreground">Renewal</dt>
        <dd className="mt-0.5 break-words">{s.renewal}{s.note && <span className="mt-1 block text-[13px] text-muted-foreground">{s.note}</span>}</dd>
      </div>
    </dl>
  );
}
