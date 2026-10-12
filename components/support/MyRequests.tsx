"use client";
import { Compass, Inbox, MessageCircle, PenLine } from "lucide-react";
import { startTour } from "@/components/onboarding/Tour";
import { cn } from "@/lib/utils";

export type MyTicket = { ref: string; subject: string; status: string; updatedAt: string; reply: { body: string; by: string } | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-warning/15 pill-ink-warn" },
  pending: { label: "We replied", cls: "bg-accent/15 pill-ink-info" },
  resolved: { label: "Resolved", cls: "bg-success/15 pill-ink-ok" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Dashboard-only strip above the answers: ask Pip, write to a person, replay the tour, and the requests already sent. */
export function MyRequests({ tickets }: { tickets: MyTicket[] }) {
  const tile = "ap-tile flex flex-col p-5";
  const action = "mt-auto inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-foreground/[0.06] px-4 text-sm font-semibold transition-colors hover:bg-foreground/[0.1]";
  return (
    <section aria-labelledby="help-quick" className="mt-8">
      <h2 id="help-quick" className="sr-only">Quick help</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cn(tile, "xl:col-span-2 xl:row-span-2")}>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Inbox className="h-4 w-4" aria-hidden="true" /> Your requests
          </p>
          {tickets.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {tickets.map((t) => {
                const s = STATUS[t.status] ?? STATUS.open;
                return (
                  <li key={t.ref} className="rounded-2xl bg-[hsl(var(--ap-canvas))] p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{t.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className="tabular">{t.ref}</span> · updated {day(t.updatedAt)}
                        </p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>{s.label}</span>
                    </div>
                    {t.reply && (
                      <details className="group mt-2">
                        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-[13px] font-semibold text-foreground/80 underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">Read the latest reply</span>
                          <span className="hidden group-open:inline">Hide the reply</span>
                        </summary>
                        <p className="mt-1 whitespace-pre-line rounded-xl bg-[hsl(var(--ap-tile))] p-3 text-[14px] leading-relaxed">
                          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t.reply.by}</span>
                          {t.reply.body}
                        </p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">Nothing open. Anything you send us shows up here with its status and our reply.</p>
          )}
        </div>

        <div className={tile}>
          <MessageCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-display text-[19px] font-bold leading-snug tracking-[-0.015em]">Ask Pip, get an answer now.</p>
          <button type="button" className={cn(action, "mt-4 bg-lime text-[hsl(var(--lime-foreground))] hover:bg-lime/90")} onClick={() => window.dispatchEvent(new CustomEvent("outly:chat-open"))}>
            Open chat
          </button>
        </div>

        <div className={tile}>
          <PenLine className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-display text-[19px] font-bold leading-snug tracking-[-0.015em]">Write to a person.</p>
          <a href="#stuck" className={cn(action, "mt-4")}>Send a message</a>
        </div>

        <div className={cn(tile, "sm:col-span-2")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-display text-[17px] font-bold tracking-[-0.01em]">
              <Compass className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> New here? Replay the one-minute tour.
            </p>
            <button type="button" className={cn(action, "mt-0")} onClick={() => startTour()}>
              Start the tour
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
