"use client";
import { useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { CalendarPlus, Check, ChevronDown, Copy, PlayCircle, Video } from "lucide-react";
import { ApiError, api } from "@/lib/client/api";
import { fmtWhen, googleCalendarUrl, outlookCalendarUrl, seatsLabel, type WorkshopView } from "@/lib/workshops/core";
import { cn } from "@/lib/utils";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const BTN = cn("inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-6 font-display text-[15px] font-bold transition disabled:cursor-not-allowed", FOCUS);
const PRIMARY = cn(BTN, "bg-lime text-lime-foreground lime-glow hover:brightness-105 disabled:opacity-60");
const DARK = cn(BTN, "bg-foreground text-background hover:opacity-90");
const GHOST = cn(BTN, "border-2 border-foreground/15 text-foreground hover:border-foreground/40");
const QUIET = cn("inline-flex min-h-10 items-center rounded-full px-3 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline touch:min-h-11", FOCUS);

type Reply = { ok: boolean; workshop: WorkshopView | null };

export function RegisterCard({ workshop, signedIn, pageUrl }: { workshop: WorkshopView; signedIn: boolean; pageUrl: string }) {
  const [w, setW] = useState(workshop);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const path = `/workshops/${w.slug}`;
  const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
  const mine = w.mine?.status === "registered";
  const full = w.capacity > 0 && (w.seatsLeft ?? 0) <= 0;
  const cancelled = w.status === "cancelled";
  const ended = !cancelled && (w.past || w.status === "completed");

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const r = await api<Reply>(`/api/workshops/${w.slug}/register`, { method });
      if (r.workshop) setW(r.workshop);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyMeet() {
    if (!w.meetUrl) return;
    try {
      await navigator.clipboard.writeText(w.meetUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Long-press the Join button to copy the link.");
    }
  }

  const cal = { title: w.title, summary: w.summary, startsAt: w.startsAt, endsAt: w.endsAt, url: pageUrl, meetUrl: w.meetUrl };

  return (
    <div className="rounded-[1.5rem] border border-border bg-card p-5 text-card-foreground shadow-[0_24px_60px_-40px_rgb(0_0_0/0.45)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-extrabold uppercase tracking-[0.16em]">Free seat</p>
        {w.live && (
          <span className="inline-flex min-h-7 items-center gap-2 rounded-full bg-foreground px-3 text-xs font-semibold text-background">
            <span className="live-dot" aria-hidden="true" />
            Live now
          </span>
        )}
      </div>
      <p className="mt-3 font-display text-lg font-bold leading-snug">{when.day}</p>
      <p className="text-[15px] text-muted-foreground">
        {when.time} · {when.dur}
      </p>

      <div className="mt-5 space-y-3">
        {cancelled ? (
          <p role="status" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-[15px] leading-relaxed">
            <span className="font-semibold">This session was cancelled.</span> Anyone registered got an email. Keep an eye on the workshops page for a new date.
          </p>
        ) : ended ? (
          <>
            <p className="rounded-2xl bg-muted p-4 text-[15px] font-medium">This session has ended.</p>
            {w.recordingUrl && (
              <a href={w.recordingUrl} target="_blank" rel="noopener noreferrer" className={DARK}>
                <PlayCircle size={18} aria-hidden="true" />
                Watch the replay
              </a>
            )}
          </>
        ) : !signedIn ? (
          <>
            <Link href={`/login?next=${encodeURIComponent(path)}`} className={DARK}>
              Log in to save a seat
            </Link>
            <p className="text-[13px] text-muted-foreground">Free with any Outlly account. The invite goes to your email.</p>
          </>
        ) : mine ? (
          <>
            <p role="status" className="flex items-center gap-2 rounded-2xl bg-success/15 p-4 text-[15px] font-semibold text-foreground">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success text-background">
                <Check size={16} strokeWidth={3} aria-hidden="true" />
              </span>
              You&apos;re in. The invite is on its way to your inbox.
            </p>
            {w.meetUrl && (
              <div className="flex gap-2">
                <a href={w.meetUrl} target="_blank" rel="noopener noreferrer" className={cn(w.live ? PRIMARY : DARK, "flex-1")}>
                  <Video size={18} aria-hidden="true" />
                  {w.live ? "Join on Google Meet now" : "Google Meet link"}
                </a>
                <button type="button" onClick={copyMeet} aria-label={copied ? "Meet link copied" : "Copy Meet link"} className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-foreground/15 hover:border-foreground/40", FOCUS)}>
                  {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                </button>
              </div>
            )}
            <span className="sr-only" aria-live="polite">
              {copied ? "Meet link copied" : ""}
            </span>
            <Popover.Root>
              <Popover.Trigger className={GHOST}>
                <CalendarPlus size={18} aria-hidden="true" />
                Add to calendar
                <ChevronDown size={16} aria-hidden="true" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content sideOffset={8} align="center" className="z-50 w-[min(18rem,calc(100vw-2.5rem))] rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
                  <ul className="flex flex-col">
                    {[
                      { label: "Google Calendar", href: googleCalendarUrl(cal), external: true },
                      { label: "Outlook", href: outlookCalendarUrl(cal), external: true },
                      { label: "Apple Calendar (.ics)", href: `/api/workshops/${w.slug}/ics`, external: false },
                    ].map((o) => (
                      <li key={o.label}>
                        <a
                          href={o.href}
                          {...(o.external ? { target: "_blank", rel: "noopener noreferrer" } : { download: true })}
                          className={cn("flex min-h-11 items-center rounded-xl px-3 text-[15px] hover:bg-muted", FOCUS)}
                        >
                          {o.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px]">
                <span className="text-muted-foreground">Give your seat to someone else?</span>
                <button type="button" disabled={busy} onClick={() => send("DELETE")} className={cn(QUIET, "text-destructive hover:text-destructive")}>
                  {busy ? "Giving it back…" : "Yes, give it back"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={QUIET}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={QUIET}>
                Give my seat back
              </button>
            )}
          </>
        ) : full ? (
          <>
            <button type="button" disabled className={cn(BTN, "bg-muted text-muted-foreground")}>
              Full
            </button>
            <p className="text-[13px] text-muted-foreground">We&apos;ll open more sessions. Check back soon.</p>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => send("POST")} className={PRIMARY}>
            {busy ? "Saving your seat…" : "Save my seat"}
          </button>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">
            {error}
          </p>
        )}
      </div>

      {!cancelled && !ended && (
        <p className="mt-5 border-t border-border pt-4 text-[13px] text-muted-foreground">
          {seatsLabel(w)}
          {w.registered > 0 ? ` · ${w.registered} going` : ""}
        </p>
      )}
    </div>
  );
}
