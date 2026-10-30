"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/shell/UserContext";
import { tourKey } from "@/components/onboarding/Tour";
import { welcomeKey } from "@/components/onboarding/WelcomeSubscribe";
import { afterPrivacy } from "@/components/shared/PrivacyNotice";
import { APP_SELLS_PLANS, isApp } from "@/lib/app-mode";
import { api } from "@/lib/client/api";
import { FoundingStamp } from "./FoundingStamp";

export const foundingPromoKey = (id: string) => `outlly:founding-promo:${id}`;

export type FoundingPromo =
  | { kind: "offer"; left: number; limit: number; pct: number; proven: boolean }
  | { kind: "reserved"; no: number; pct: number };

/**
 * 1067: the founding invitation, shown once. Only rendered for accounts the server says are eligible (never
 * paid, a seat open for them, or a seat held from before) and haven't closed it on any device. Closing it is
 * stored on the account and in this browser, so it never comes back. It also stands in for the generic
 * subscribe greeting, and like that one it waits for the tour, the privacy notice and any open dialog.
 */
export function FoundingWelcome({ promo }: { promo: FoundingPromo }) {
  const user = useUser();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(foundingPromoKey(user.id))) return;
    if (isApp() && !APP_SELLS_PLANS) return; // no plan offers inside the Android app (Google Play billing rules)
    document.documentElement.dataset.onboarding = "founding"; // "What's new" waits for the next visit
    let t: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const show = () => {
      t = setTimeout(() => {
        if (document.querySelector('[role="dialog"]') && ++tries < 150) return show();
        setOpen(true);
      }, 600);
    };
    let unPrivacy = () => {};
    if (localStorage.getItem(tourKey(user.id))) unPrivacy = afterPrivacy(user.id, show);
    const onClosed = () => { unPrivacy(); unPrivacy = afterPrivacy(user.id, show); };
    window.addEventListener("outly:tour-closed", onClosed, { once: true });
    return () => {
      if (t) clearTimeout(t);
      delete document.documentElement.dataset.onboarding;
      unPrivacy();
      window.removeEventListener("outly:tour-closed", onClosed);
    };
  }, [user.id]);

  const close = (o: boolean) => {
    if (o) return;
    const at = new Date().toISOString();
    localStorage.setItem(foundingPromoKey(user.id), at);
    localStorage.setItem(welcomeKey(user.id), at); // it was the welcome: the generic greeting doesn't follow it
    delete document.documentElement.dataset.onboarding;
    setOpen(false);
    // Remembered on the account too, so another browser or a cleared cache never shows it again.
    api("/api/founding", { method: "POST", json: { action: "dismiss" }, keepalive: true }).catch(() => {});
  };

  const offer = promo.kind === "offer" ? promo : null;
  const taken = offer ? offer.limit - offer.left : 0;

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[3px] dark:bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="founding-welcome-body">
              <div className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-lenis-prevent onPointerDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="glass-strong relative w-full max-w-[440px] overflow-hidden rounded-[30px] bg-card/[0.94] p-6 shadow-2xl sm:p-7"
                >
                  <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-lime/20 blur-3xl" />
                  <Dialog.Close asChild>
                    <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3 h-11 w-11" aria-label="Close the founding member invitation">
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </Dialog.Close>
                  <FoundingStamp size={64} className="mb-3" />
                  <p className="eyebrow mb-2 pr-12 text-foreground/70">Founding member</p>
                  <Dialog.Title className="pr-10 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.03em]">
                    {offer ? `Be one of Outlly's first ${offer.limit}` : <>Seat <span className="tabular">#{promo.kind === "reserved" ? promo.no : ""}</span> is still yours</>}
                  </Dialog.Title>
                  <p id="founding-welcome-body" className="mt-2.5 text-[14.5px] leading-relaxed text-foreground/80">
                    {offer
                      ? `Subscribe to any paid plan while spots last and you become a Founding Member: a numbered badge on your profile and ${offer.pct}% off every paid plan, for life.`
                      : `You joined early, so we held a founding seat for you. Subscribe to any paid plan and it becomes your Founding Member badge, with ${promo.pct}% off every paid plan for life.`}
                  </p>
                  {offer && (
                    <div className="mt-5">
                      <p className="text-[13px] font-semibold"><span className="tabular">{offer.left}</span> of <span className="tabular">{offer.limit}</span> spots left</p>
                      <div role="progressbar" aria-label="Founding spots taken" aria-valuemin={0} aria-valuemax={offer.limit} aria-valuenow={taken} className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-lime" style={{ width: `${Math.min(100, Math.round((taken / Math.max(1, offer.limit)) * 100))}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-6 flex flex-wrap-reverse gap-2">
                    <Dialog.Close asChild>
                      <Button variant="ghost" className="min-h-[44px] min-w-[8rem] flex-1 text-foreground/85 hairline">Maybe later</Button>
                    </Dialog.Close>
                    <Button asChild variant="lime" className="min-h-[44px] min-w-[8rem] flex-1">
                      <Link href="/billing#plans" onClick={() => close(false)} autoFocus>
                        See plans <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                  <p className="mt-3 text-center text-[12px] text-foreground/65">
                    {offer && !offer.proven ? "The seat is confirmed after your first payment, with a one-tap Gmail check." : "The badge appears once your first payment goes through."}
                  </p>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
