"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Award, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import type { FoundingMine } from "@/lib/founding";
import { FoundingStamp } from "./FoundingStamp";

const NOTE: Record<string, string> = {
  claimed: "Confirmed. Your founding seat is yours.",
  full: "Your Gmail is confirmed, but the last founding seat went just before you. Sorry about that.",
  unpaid: "Your Gmail is confirmed. A founding seat comes with your first paid plan.",
  expired: "That link has expired or was already replaced. Send a fresh one below.",
  not_gmail: "Founding seats are for Gmail addresses only.",
  taken: "That Gmail inbox already holds a founding seat on another account.",
  off: "Founding seats have closed.",
  busy: "Too many tries just now. Wait a few minutes and try again.",
};

const WRAP = "mt-6 max-w-5xl";
const plans = () => document.getElementById("plans")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

/**
 * Billing only (1067): the stamp and number for members, a held seat waiting on its first payment, the
 * one-tap claim for paying customers, and a plain "every seat is taken" note for free accounts. The
 * invitation itself is a one-time popup on Home, so free accounts with a seat open see nothing extra here.
 */
export function FoundingCard({ f, status }: { f: FoundingMine; status?: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const router = useRouter();
  const note = said ?? (status && Object.hasOwn(NOTE, status) ? NOTE[status] : null);

  // Back from the claim link with no seat to show (full, wrong inbox, expired), or nothing to show: just say what happened.
  if (!f || f.kind === "offer") {
    if (!note || status === "claimed") return null;
    return (
      <div className={WRAP}>
        <p role="status" className="glass flex items-center gap-3 rounded-[22px] p-4 text-sm">
          <FoundingStamp size={40} tilt={false} />
          {note}
        </p>
      </div>
    );
  }

  if (f.kind === "member") {
    return (
      <div className={WRAP}>
        <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
          <FoundingStamp size={76} label="Outlly founding member stamp" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Founding member</p>
            <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">You're founding member <span className="tabular">#{f.no}</span></h2>
            <p className="mt-1 text-sm text-muted-foreground">{f.pct}% off every paid plan, for life. The prices below already include it.</p>
            {note && status === "claimed" && <p role="status" className="mt-2 text-sm font-medium text-lime-ink">{note}</p>}
          </div>
        </section>
      </div>
    );
  }

  if (f.kind === "reserved") {
    return (
      <div className={WRAP}>
        <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
          <FoundingStamp size={68} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Founding seat held</p>
            <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">Seat <span className="tabular">#{f.no}</span> is waiting for your first plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">You joined early, so we kept it for you. Subscribe to any paid plan and it becomes your Founding Member badge. The prices below already include your founding price.</p>
          </div>
          <Button type="button" variant="primary" onClick={plans} className="min-h-[44px] shrink-0">
            See plans <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
        </section>
      </div>
    );
  }

  if (f.kind === "full") {
    return (
      <div className={WRAP}>
        <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
          <FoundingStamp size={56} tilt={false} />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Founding members</p>
            <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">All <span className="tabular">{f.limit}</span> founding spots have been filled</h2>
            <p className="mt-1 text-sm text-muted-foreground">Thank you to everyone who joined early. You can still upgrade to a paid plan any time to post more and unlock every feature.</p>
            {note && <p role="status" className="mt-2 text-sm font-medium">{note}</p>}
          </div>
          <Button type="button" variant="primary" onClick={plans} className="min-h-[44px] shrink-0">
            Upgrade <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
        </section>
      </div>
    );
  }

  async function claim() {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; result: string; no: number | null }>("/api/founding", { method: "POST", json: { action: "claim" } });
      if (r.ok) {
        toast(r.no ? `You're founding member #${r.no}` : "Your founding seat is yours");
        router.refresh();
      } else setSaid(Object.hasOwn(NOTE, r.result) ? NOTE[r.result] : "That didn't work. Try again in a moment.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const r = await api<{ to: string }>("/api/founding", { method: "POST", json: { action: "send" } });
      setSent(r.to);
      toast(`Link sent to ${r.to}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  // claim: a paying customer with a seat open that isn't theirs yet.
  return (
    <div className={WRAP}>
      <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
        <FoundingStamp size={68} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Founding seat waiting</p>
          <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">
            Your founding seat is ready: <span className="tabular">{f.left}</span> of <span className="tabular">{f.limit}</span> left
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {f.reason === "ready" ? (
              <>Thanks for subscribing. Your inbox <span className="font-medium text-foreground">{f.email}</span> is confirmed, so one tap and the seat is yours.</>
            ) : (
              <>Thanks for subscribing. Seats go only to confirmed Gmail inboxes, so we'll email a one-tap link to <span className="font-medium text-foreground">{f.email}</span>; tap it and the seat is yours.</>
            )}
          </p>
          {note && <p role="status" className="mt-2 text-sm font-medium">{note}</p>}
          {sent && <p role="status" className="mt-2 text-sm font-medium text-lime-ink">Sent. Check {sent}, including the Promotions tab.</p>}
        </div>
        {f.reason === "ready" ? (
          <Button type="button" variant="primary" disabled={busy} onClick={claim} className="min-h-[44px] shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Award className="h-4 w-4" aria-hidden />} Claim my seat
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled={busy} onClick={send} className="min-h-[44px] shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MailCheck className="h-4 w-4" aria-hidden />} {sent ? "Send again" : "Email me the link"}
          </Button>
        )}
      </section>
    </div>
  );
}
