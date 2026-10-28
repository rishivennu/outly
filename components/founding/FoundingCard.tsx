"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Award, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import type { FoundingMine } from "@/lib/founding";
import { FoundingStamp } from "./FoundingStamp";

const NOTE: Record<string, string> = {
  claimed: "Confirmed. Your founding seat is yours.",
  full: "Your Gmail is confirmed, but the last founding seat went just before you. Sorry about that.",
  expired: "That link has expired or was already replaced. Send a fresh one below.",
  not_gmail: "Founding seats are for Gmail addresses only.",
  taken: "That Gmail inbox already holds a founding seat on another account.",
  off: "Founding seats have closed.",
  busy: "Too many tries just now. Wait a few minutes and try again.",
};

/** Home and Billing: the stamp and number for members; for everyone else with a seat open, the one-tap claim. */
export function FoundingCard({ f, where, status }: { f: FoundingMine; where: "home" | "billing"; status?: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const router = useRouter();
  const note = said ?? (status && Object.hasOwn(NOTE, status) ? NOTE[status] : null);
  const wrap = where === "home" ? "mx-auto max-w-5xl px-5 pb-4 sm:px-10" : "mt-6 max-w-5xl";

  // Back from the claim link with no seat to show (full, wrong inbox, expired): just say what happened.
  if (!f) {
    if (!note || status === "claimed") return null;
    return (
      <div className={wrap}>
        <p role="status" className="glass flex items-center gap-3 rounded-[22px] p-4 text-sm">
          <FoundingStamp size={40} tilt={false} />
          {note}
        </p>
      </div>
    );
  }
  if (f.kind === "member") {
    return (
      <div className={wrap}>
        <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
          <FoundingStamp size={76} label="Outlly founding member stamp" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Founding member</p>
            <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">You're founding member <span className="tabular">#{f.no}</span></h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {f.pct}% off every paid plan, for life.{where === "billing" ? " The prices below already include it." : " It's applied at checkout automatically."}
            </p>
            {note && status === "claimed" && <p role="status" className="mt-2 text-sm font-medium text-lime-ink">{note}</p>}
          </div>
          {where === "home" && (
            <Link href="/billing" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-semibold hairline hover:bg-secondary">
              See your prices <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
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

  return (
    <div className={wrap}>
      <section aria-labelledby="founding-h" className="glass flex flex-col items-start gap-4 rounded-[28px] p-5 sm:flex-row sm:items-center sm:p-6">
        <FoundingStamp size={68} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Founding seat waiting</p>
          <h2 id="founding-h" className="mt-1 text-lg font-semibold tracking-tight">
            Claim {f.pct}% off for life: <span className="tabular">{f.left}</span> of <span className="tabular">{f.limit}</span> seats left
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {f.reason === "ready" ? (
              <>Your inbox <span className="font-medium text-foreground">{f.email}</span> is already confirmed. One tap and the seat is yours.</>
            ) : (
              <>Seats go only to confirmed Gmail inboxes. We'll email a one-tap link to <span className="font-medium text-foreground">{f.email}</span>; tap it and the seat is yours.</>
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
