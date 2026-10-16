"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, MessageCircle, X } from "lucide-react";
import { Pip } from "@/components/brand/Pip";
import { seenUpdateKey, shouldShowUpdate, type UpdateNotice } from "@/lib/updates";
import { tourKey } from "@/components/onboarding/Tour";
import { useUser } from "@/components/shell/UserContext";

const TELL_US = "/support?write=changes#stuck";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** The card itself, also used as the live preview in the admin editor. */
export function WhatsNewCard({ notice, onClose, onTell, preview }: { notice: Pick<UpdateNotice, "title" | "body" | "items" | "publishedAt">; onClose?: () => void; onTell?: () => void; preview?: boolean }) {
  const Title = preview ? "h3" : Dialog.Title;
  const Body = preview ? "p" : Dialog.Description;
  const items = notice.items.filter((i) => i.trim());
  const date = fmt(notice.publishedAt);
  return (
    <div className="wn-card relative w-full max-w-[460px] overflow-hidden rounded-[30px] p-5 sm:p-6">
      <span aria-hidden className="wn-glow" />
      <div className="relative flex items-start gap-3">
        <Pip size={52} mood="happy" />
        <div className="min-w-0 flex-1 pt-0.5">
          <p suppressHydrationWarning className="wn-eyebrow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--lime))]" />
            What changed{date ? ` · ${date}` : ""}
          </p>
          <Title className="mt-2 font-display text-[1.32rem] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{notice.title || "We made a few changes"}</Title>
        </div>
        {onClose && (
          <Dialog.Close asChild>
            <button type="button" aria-label="Close" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </Dialog.Close>
        )}
      </div>
      {notice.body && <Body className="relative mt-3 text-[14.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{notice.body}</Body>}
      {items.length > 0 && (
        <ul className="relative mt-4 grid gap-2">
          {items.map((it, i) => (
            <li key={i} className="wn-item flex items-start gap-3 rounded-[16px] px-3 py-2.5 text-[14px] leading-snug">
              <span aria-hidden className="wn-tick mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              <span className="[overflow-wrap:anywhere]">{it}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="relative mt-4 text-[13px] leading-relaxed text-muted-foreground">
        Something feel off or slower than before? Tell us. A real person reads every message, and we reply fast.
      </p>
      <div className="relative mt-5 flex flex-wrap-reverse gap-2">
        {preview ? (
          <>
            <span className="wn-btn-ghost inline-flex h-12 min-w-[9rem] whitespace-nowrap flex-1 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold"><MessageCircle className="h-4 w-4" aria-hidden />Tell us what&apos;s off</span>
            <span className="lime-bg inline-flex h-12 min-w-[7rem] flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold">Got it</span>
          </>
        ) : (
          <>
            <a href={TELL_US} onClick={(e) => { e.preventDefault(); onTell?.(); }} className="wn-btn-ghost inline-flex h-12 min-w-[9rem] whitespace-nowrap flex-1 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-transform active:scale-[0.97]">
              <MessageCircle className="h-4 w-4" aria-hidden />Tell us what&apos;s off
            </a>
            <Dialog.Close asChild>
              <button type="button" autoFocus className="lime-bg lime-glow inline-flex h-12 min-w-[7rem] flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold transition-transform active:scale-[0.97]">
                Got it
              </button>
            </Dialog.Close>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shown once per published notice, a moment after the dashboard settles, so members know what moved
 * and that they can say so if something feels wrong. Radix gives the focus trap, Escape and aria-modal.
 */
export function WhatsNew({ notice, userId, joinedAt }: { notice: UpdateNotice; userId: string; joinedAt: string }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const router = useRouter();

  const owner = useUser().id;
  const shown = useRef(false);

  useEffect(() => {
    let seen: string | null = null;
    let toured = false;
    try {
      seen = localStorage.getItem(seenUpdateKey(userId));
      toured = !!localStorage.getItem(tourKey(owner));
    } catch {
      return; // storage blocked: never nag on every page
    }
    if (shown.current || !shouldShowUpdate(notice, seen, joinedAt)) return;
    // One popup per visit. First visit on this device belongs to the guided tour (and its welcome offer);
    // the notice waits for the next visit rather than stacking a third card on top.
    if (!toured || new URLSearchParams(location.search).get("tour") === "1") return;
    let other = false;
    const onTour = () => (other = true);
    window.addEventListener("outly:tour", onTour);
    let tries = 0;
    const t = window.setInterval(() => {
      // Give up after about a minute and a half; it will try again next visit.
      if (++tries > 60) return window.clearInterval(t);
      if (document.hidden) return;
      // The cookie banner is a quick choice: wait for it. Any other dialog this visit: skip until next time.
      if (document.querySelector('[aria-labelledby="cc-title"]')) return;
      if (other || document.querySelector('[role="dialog"]')) {
        other = true;
        window.clearInterval(t);
        return;
      }
      shown.current = true;
      setOpen(true);
      window.clearInterval(t);
    }, 1400);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("outly:tour", onTour);
    };
    // Keyed on the notice fields, not the object: the layout hands a fresh object on every navigation.
  }, [notice.id, notice.on, notice.publishedAt, userId, joinedAt, owner]);

  const close = () => {
    try {
      localStorage.setItem(seenUpdateKey(userId), notice.id);
    } catch {
      /* private mode: it simply shows again next time */
    }
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[4px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount {...(notice.body ? {} : { "aria-describedby": undefined })}>
              <div
                className="fixed inset-0 z-[81] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                data-lenis-prevent
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) close();
                }}
              >
                <motion.div
                  className="w-full max-w-[460px]"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                  transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 34 }}
                >
                  <WhatsNewCard notice={notice} onClose={close} onTell={() => { close(); router.push(TELL_US); }} />
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
