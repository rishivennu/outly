"use client";
import { useId, useState } from "react";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { MineBenefit, MineDeliverable, MineOffer } from "@/lib/partners/mine-types";
import { DELIVERABLE_STATUS_LABEL } from "@/lib/partners/types";
import { fmtDay } from "@/lib/partners/offer-core";
import { API, canSubmitLink, deliverableProgress, platformLabel } from "./model";
import { TermsList } from "./OfferCard";
import { useAction } from "./useAction";

const D_TONE: Record<MineDeliverable["status"], string> = {
  planned: "bg-muted-foreground",
  submitted: "bg-cyan",
  published: "bg-success",
  verified: "bg-success",
  missed: "bg-destructive",
};

function BenefitCard({ benefit }: { benefit: NonNullable<MineBenefit> }) {
  const live = benefit.status === "active";
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-primary/[0.08] p-4">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <BadgeCheck className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{benefit.planName || "Outlly Creator"}{live ? " is active" : ""}</p>
        <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
          {live ? `Until ${fmtDay(benefit.endsAt)}, ${benefit.daysLeft} ${benefit.daysLeft === 1 ? "day" : "days"} left.` : `Status: ${benefit.status}. Runs ${fmtDay(benefit.startsAt)} to ${fmtDay(benefit.endsAt)}.`}
        </p>
      </div>
    </div>
  );
}

function LinkForm({ appRef, d }: { appRef: string; d: MineDeliverable }) {
  const { busy, run } = useAction();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(d.url);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  if (!open)
    return (
      <Button type="button" variant={d.url ? "subtle" : "lime"} size="sm" onClick={() => setOpen(true)}>
        {d.url ? "Update link" : "Submit published link"}
      </Button>
    );
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\/\S+\.\S+/.test(url.trim())) return setErr("Paste the full https link to the published post.");
    setErr("");
    const ok = await run(API.deliverable(appRef, d.id), { url: url.trim(), note: note.trim() || undefined }, "Link sent. The team will check it.");
    if (ok) setOpen(false);
  }
  return (
    <form onSubmit={send} noValidate className="mt-3 grid w-full gap-3">
      <div>
        <Label htmlFor={`${id}-url`}>Published link</Label>
        <Input id={`${id}-url`} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} autoFocus />
        {err && <p id={`${id}-err`} className="mt-2 text-[13px] text-[hsl(0_72%_38%)] dark:text-destructive">{err}</p>}
      </div>
      <div>
        <Label htmlFor={`${id}-note`}>Note for the team (optional)</Label>
        <Input id={`${id}-note`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="lime" size="md" disabled={busy} aria-busy={busy}>{busy ? "Sending…" : "Send link"}</Button>
        <Button type="button" variant="ghost" size="md" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** Offer accepted, active or completed: the benefit, what was agreed and each deliverable with its link. */
export function ActivePartnership({ appRef, status, offer, benefit, deliverables, partnerCode }: { appRef: string; status: string; offer: MineOffer | null; benefit: MineBenefit; deliverables: MineDeliverable[]; partnerCode: string | null }) {
  const p = deliverableProgress(deliverables);
  const closed = status === "completed";
  return (
    <section id="deliverables" aria-labelledby="pp-active-h" className="scroll-mt-24 grid gap-5 rounded-[24px] border border-foreground/[0.08] bg-card p-5 sm:p-6">
      <div>
        <h2 id="pp-active-h" className="text-[17px] font-semibold leading-snug">{closed ? "Your completed partnership" : "Your partnership"}</h2>
        {partnerCode && <p className="mt-1 text-[13px] text-muted-foreground">Your partner code: <span className="font-mono font-medium text-foreground">{partnerCode}</span></p>}
      </div>

      {benefit && <BenefitCard benefit={benefit} />}

      {deliverables.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Deliverables</h3>
            <p className="text-[13px] tabular-nums text-muted-foreground">{p.done} completed, {p.remaining} remaining</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Deliverables completed" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-valuetext={`${p.done} of ${p.total} completed`}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${p.pct}%` }} />
          </div>
          <ul className="mt-4 grid gap-3">
            {deliverables.map((d) => (
              <li key={d.id} data-deliverable={d.id} className="min-w-0 rounded-2xl bg-secondary/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium [overflow-wrap:anywhere]">{d.title}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {[platformLabel(d.platform), d.format, d.dueAt && `Due ${fmtDay(d.dueAt)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium">
                    <span className={cn("h-1.5 w-1.5 rounded-full", D_TONE[d.status])} aria-hidden="true" />
                    {DELIVERABLE_STATUS_LABEL[d.status] ?? d.status}
                  </span>
                </div>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md text-[14px] font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="truncate">{d.url}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
                {!closed && canSubmitLink(d) && <div className="mt-3"><LinkForm appRef={appRef} d={d} /></div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {deliverables.length === 0 && !closed && <p className="text-[14px] text-muted-foreground">Your deliverables appear here once the team sets them up.</p>}

      {offer && offer.status === "accepted" && (
        <details className="group rounded-2xl bg-secondary/30 p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            The terms you accepted{offer.respondedAt ? ` on ${fmtDay(offer.respondedAt)}` : ""}
          </summary>
          <div className="mt-3">
            <TermsList offer={offer} />
          </div>
        </details>
      )}
    </section>
  );
}
