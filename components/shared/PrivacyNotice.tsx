"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Ban, Clock, Database, Lock, Share2, SlidersHorizontal, X } from "lucide-react";
import { readConsent } from "@/components/shared/CookieConsent";
import { useUser } from "@/components/shell/UserContext";

/**
 * "How we handle your data", shown once per person per version on their first studio visit (10-18).
 * Order of first-run popups: cookie choice, then this, then the tour, then the welcome offer. Anything
 * that would open after it calls afterPrivacy(). Bump PRIVACY_VERSION when what we collect, who receives
 * it or how long we keep it changes, and everyone sees the new version once. Keep it in step with /privacy.
 */
export const PRIVACY_VERSION = "2026-10-18";
const UPDATED = "18 Oct 2026";
export const privacyKey = (userId: string) => `outlly:privacy-seen:${userId}`;
const OPEN = "outlly:privacy-open";
const CLOSED = "outlly:privacy-closed";

export function privacyPending(userId: string) {
  try {
    return localStorage.getItem(privacyKey(userId)) !== PRIVACY_VERSION;
  } catch {
    return false; // storage blocked: never hold other things back for a notice we can't remember
  }
}

/** Run `cb` once the privacy notice is out of the way (now, if it was already seen). Returns a cleanup. */
export function afterPrivacy(userId: string, cb: () => void) {
  if (!privacyPending(userId)) {
    cb();
    return () => {};
  }
  window.addEventListener(CLOSED, cb, { once: true });
  return () => window.removeEventListener(CLOSED, cb);
}

/** Reopen it from anywhere (Settings, Your data). */
export function openPrivacyNotice() {
  window.dispatchEvent(new Event(OPEN));
}

const ROWS = [
  { icon: Database, title: "What we keep", body: "Your account details, the videos you upload, your posts and schedules, and the numbers your connected accounts report." },
  {
    icon: Share2,
    title: "Who else gets it",
    body: "Only services doing a job for you: the platforms you publish to, Google Gemini when you use an AI feature (your notes, or your video's audio for captions from speech), the payment gateway you pick, Resend for email, and Supabase and Vercel, which host Outlly.",
  },
  { icon: Lock, title: "How it's protected", body: "HTTPS everywhere. Platform tokens are encrypted and never reach your browser. We never see your card, bank or platform passwords." },
  { icon: Clock, title: "How long we keep it", body: "Drafts nobody touches for 3 days are removed. Email logs go after 90 days, post metric history after 180, sign-in codes after a day." },
  { icon: Ban, title: "What we never do", body: "Sell your data, show ads, run trackers, or train AI models on your videos, captions or numbers." },
  { icon: SlidersHorizontal, title: "You're in control", body: "Download a copy or delete your account in Settings, any time. Disconnect any platform in Accounts and its tokens are deleted at once." },
] as const;

export function PrivacyNotice() {
  const userId = useUser().id;
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const shown = useRef(false);

  // Reopen on request, whether or not it was seen.
  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN, reopen);
    return () => window.removeEventListener(OPEN, reopen);
  }, []);

  // First time (per version): after the cookie choice, and never on top of another dialog.
  useEffect(() => {
    if (shown.current || !privacyPending(userId)) return;
    let tries = 0;
    let t = 0;
    const tick = () => {
      if (++tries > 120) return window.clearInterval(t); // about 1.5 minutes, then next visit
      if (document.hidden || !readConsent()) return;
      if (document.querySelector('[role="dialog"], [aria-labelledby="cc-title"]')) return;
      shown.current = true;
      setOpen(true);
      window.clearInterval(t);
    };
    t = window.setInterval(tick, 700);
    return () => window.clearInterval(t);
  }, [userId]);

  const close = () => {
    try {
      localStorage.setItem(privacyKey(userId), PRIVACY_VERSION);
    } catch {
      /* private mode: it shows again next visit */
    }
    setOpen(false);
    window.dispatchEvent(new Event(CLOSED));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[4px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <div
                className="fixed inset-0 z-[81] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                data-lenis-prevent
                data-privacy-notice
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) close();
                }}
              >
                <motion.div
                  className="wn-card relative w-full max-w-[520px] overflow-hidden rounded-[30px] p-5 sm:p-6"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
                  transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 34 }}
                >
                  <span aria-hidden className="wn-glow" />
                  <div className="relative flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="wn-eyebrow inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.08em]">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--lime))]" />
                        Your privacy · Updated {UPDATED}
                      </p>
                      <Dialog.Title className="mt-2 font-display text-[1.32rem] font-semibold leading-tight tracking-tight">How Outlly handles your data</Dialog.Title>
                    </div>
                    <Dialog.Close asChild>
                      <button type="button" aria-label="Close" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
                        <X className="h-5 w-5" aria-hidden />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="relative mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
                    The short version, in about 30 seconds. Nothing here changes anything you have already set up.
                  </Dialog.Description>
                  <ul className="relative mt-4 grid gap-2">
                    {ROWS.map(({ icon: Icon, title, body }) => (
                      <li key={title} className="wn-item flex items-start gap-3 rounded-[16px] px-3 py-2.5">
                        <span aria-hidden className="wn-tick mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full">
                          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                        <span className="min-w-0 text-[13.5px] leading-snug">
                          <strong className="block text-[14px] font-semibold">{title}</strong>
                          <span className="text-muted-foreground">{body}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="relative mt-5 flex flex-wrap-reverse gap-2">
                    <Link
                      href="/privacy"
                      onClick={close}
                      className="wn-btn-ghost inline-flex h-12 min-w-[10rem] flex-1 items-center justify-center whitespace-nowrap rounded-full px-5 text-sm font-semibold transition-transform active:scale-[0.97]"
                    >
                      Read the full policy
                    </Link>
                    <Dialog.Close asChild>
                      <button type="button" autoFocus className="lime-bg lime-glow inline-flex h-12 min-w-[7rem] flex-1 items-center justify-center rounded-full px-5 text-sm font-semibold transition-transform active:scale-[0.97]">
                        Got it
                      </button>
                    </Dialog.Close>
                  </div>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
