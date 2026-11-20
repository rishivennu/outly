"use client";
import { useId, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { api, ApiError } from "@/lib/client/api";
import { durationLabel, fmtDay, type OfferTerms } from "@/lib/partners/offer-core";
import type { PublicOffer } from "@/lib/partners/offers";

type Row = { term: string; value: React.ReactNode };

export function termRows(t: OfferTerms): Row[] {
  const rows: (Row | false)[] = [
    { term: "Type", value: t.typeLabel },
    !!t.amount && { term: "Payment", value: <span className="tabular-nums">{t.amount}</span> },
    !!t.paymentTerms && { term: "Payment terms", value: t.paymentTerms },
    !!t.planName && t.subscriptionDays > 0 && { term: "Complimentary plan", value: `${t.planName}, ${durationLabel(t.subscriptionDays)}` },
    !!t.startsAt && { term: "Starts", value: fmtDay(t.startsAt) },
    !!t.endsAt && { term: "Ends or review date", value: fmtDay(t.endsAt) },
    t.deliverables > 0 && { term: "Deliverables", value: t.deliverables === 1 ? "1 piece of content" : `${t.deliverables} pieces of content` },
    t.platformLabels.length > 0 && { term: "Platforms", value: t.platformLabels.join(", ") },
    !!t.format && { term: "Format", value: t.format },
    !!t.deadlines && { term: "Deadlines", value: t.deadlines },
    { term: "Disclosure", value: t.disclosure ? "Label every post as a paid partnership or sponsored, using the platform's own tool where it has one." : "No disclosure label is required by this offer. Follow your platform's rules." },
    !!t.usageRights && { term: "Usage rights", value: t.usageRights },
    !!t.conditions && { term: "Other conditions", value: t.conditions },
  ];
  return rows.filter((r): r is Row => !!r);
}

export function TermsList({ terms }: { terms: OfferTerms }) {
  return (
    <dl className="divide-y divide-foreground/[0.08]">
      {termRows(terms).map((r) => (
        <div key={r.term} className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
          <dt className="text-[13px] font-medium text-muted-foreground">{r.term}</dt>
          <dd className="whitespace-pre-line text-pretty text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ title, children, tone = "plain" }: { title: string; children: React.ReactNode; tone?: "plain" | "done" }) {
  return (
    <section role="status" className="rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-8">
      {tone === "done" && (
        <span aria-hidden="true" className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-lime text-lime-foreground">
          <Check className="h-5 w-5" />
        </span>
      )}
      <h2 className="text-[1.35rem] font-semibold leading-tight tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export function OfferView({ token, offer }: { token: string; offer: PublicOffer }) {
  const [state, setState] = useState(offer.state);
  const [portal, setPortal] = useState(offer.portal);
  const [ask, setAsk] = useState<"accept" | "decline" | null>(null);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const agreeId = useId();
  const reasonId = useId();

  async function answer(decision: "accept" | "decline") {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ state: PublicOffer["state"]; portal?: string }>(`/api/partners/offer/${token}`, {
        method: "POST",
        json: decision === "accept" ? { decision, agree: true } : { decision, reason: reason.trim() || undefined },
      });
      setState(r.state);
      if (r.portal) setPortal(r.portal);
      setAsk(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That didn't go through. Check your connection and try again.");
      setAsk(null);
    } finally {
      setBusy(false);
    }
  }

  const hello = offer.firstName ? `Hi ${offer.firstName}, here` : "Here";

  return (
    <div className="grid gap-6">
      <header className="max-w-2xl">
        <p className="text-[13px] font-medium text-muted-foreground">Creator Partnership Program · {offer.ref}</p>
        <h1 className="display mt-3 text-balance text-[clamp(2.1rem,5.5vw,3.25rem)] leading-[1.08]">Your partnership offer</h1>
        <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">
          {hello} is what we would like to do together. Read the terms, then accept or decline. Nothing starts until you accept.
        </p>
      </header>

      <section aria-labelledby="terms-h" className="rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-8">
        <h2 id="terms-h" className="mb-5 text-[17px] font-semibold tracking-tight">
          {state === "accepted" ? "The terms you accepted" : "The terms"}
        </h2>
        <TermsList terms={offer.terms} />
      </section>

      <div aria-live="polite">
        {err && <p role="alert" className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-[hsl(0_72%_38%)] dark:text-destructive">{err}</p>}

        {state === "open" && (
          <section className="rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-8">
            <h2 className="text-[17px] font-semibold tracking-tight">Your answer</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              {offer.expiresAt ? `This link works until ${fmtDay(offer.expiresAt)}.` : "This link works for a limited time."} Questions first? Reply to the email this link came in.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="lime" size="lg" className="sm:min-w-[12rem]" onClick={() => { setAgree(false); setAsk("accept"); }}>
                Accept offer
              </Button>
              <Button type="button" variant="outline" size="lg" className="sm:min-w-[10rem]" onClick={() => { setReason(""); setAsk("decline"); }}>
                Decline
              </Button>
            </div>
          </section>
        )}

        {state === "accepted" && (
          <Panel title="You accepted the offer" tone="done">
            <p>Thank you. We have recorded your acceptance with the date and these exact terms, and a confirmation is on its way to your inbox.</p>
            <p>Next: open your partner portal. It has your referral link, the content you agreed to and a place to submit each published post.</p>
            {offer.terms.subscriptionDays > 0 && <p>If the offer includes a complimentary plan, it appears on the Outlly account that uses this email address. Verify that address if you have not yet.</p>}
            {portal && (
              <p className="pt-2">
                <a href={portal} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime px-5 text-[15px] font-semibold text-lime-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  Open partner portal <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </p>
            )}
          </Panel>
        )}

        {state === "declined" && (
          <Panel title="You declined this offer">
            <p>Thanks for letting us know. Nothing from this offer applies. If you would like to talk about different terms, reply to the email this link came in.</p>
          </Panel>
        )}

        {state === "expired" && (
          <Panel title="This offer has expired">
            <p>The link stopped working after 14 days. If you are still interested, reply to the email it came in and we can send a new one.</p>
          </Panel>
        )}

        {state === "withdrawn" && (
          <Panel title="This offer is no longer available">
            <p>The team took this offer back, usually to send a corrected one. Check your inbox for a newer link, or reply to the email.</p>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={ask === "accept"}
        onOpenChange={(o) => !o && !busy && setAsk(null)}
        title="Accept this offer?"
        body="Your acceptance is recorded with today's date and the terms shown on this page."
        confirmLabel="Accept offer"
        cancelLabel="Not yet"
        tone="primary"
        busy={busy}
        disabled={!agree}
        extra={
          <label htmlFor={agreeId} className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-secondary/50 px-4 py-3 text-[14px] leading-snug">
            <input id={agreeId} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-lime" />
            <span>I have read and agree to these terms</span>
          </label>
        }
        onConfirm={() => void answer("accept")}
      />
      <ConfirmDialog
        open={ask === "decline"}
        onOpenChange={(o) => !o && !busy && setAsk(null)}
        title="Decline this offer?"
        body="The team is told. You can still reply to the email if you change your mind or want different terms."
        confirmLabel="Decline offer"
        cancelLabel="Go back"
        busy={busy}
        extra={
          <div className="mt-4">
            <Label htmlFor={reasonId}>Reason (optional)</Label>
            <Textarea id={reasonId} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example, the timeline does not work for me" />
          </div>
        }
        onConfirm={() => void answer("decline")}
      />
    </div>
  );
}
