"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/shell/UserContext";
import { tourKey } from "./Tour";
import { afterPrivacy } from "@/components/shared/PrivacyNotice";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";
import { APP_SELLS_PLANS, isApp } from "@/lib/app-mode";

export type WelcomeOffer = { slug: string; name: string; price: string; interval: string; features: string[]; postLimit: number; aiCaptions: boolean; postPeriod?: "week" | "month" };

/** One honest sentence built from the real plan limits. */
export function welcomePitch(freeLimit: number, offer: WelcomeOffer | null, freePeriod: "week" | "month" = "month") {
  const free = freeLimit > 0 ? `You're on the Free plan with ${freeLimit} posts a ${freePeriod}, so you can start right away.` : "You're on the Free plan, so you can start posting right away.";
  if (!offer) return `${free} When you want more, subscribe from Billing.`;
  const more = offer.postLimit > 0 ? `${offer.postLimit} posts a ${offer.postPeriod ?? "month"}` : "unlimited posts";
  return `${free} Subscribe to ${offer.name} for ${more}${offer.aiCaptions ? " and AI-written captions" : ""}, and keep every video going everywhere.`;
}

export const welcomeKey = (id: string) => `outly:welcome-subscribe:${id}`;

/**
 * First-time greeting that invites a free user to subscribe. Shown once per account per device.
 * It never stacks on the guided tour: if the tour hasn't been done yet it waits for it to close.
 */
export function WelcomeSubscribe({ firstName, offer, freeLimit, freePeriod = "month" }: { firstName: string; offer: WelcomeOffer | null; freeLimit: number; freePeriod?: "week" | "month" }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<HTMLDivElement | null>(null);

  // GSAP choreography inside the card: glow blooms, copy lines rise in order, the offer lifts in,
  // each check mark pops as its feature slides in, then the buttons settle. The card itself keeps
  // its framer-motion spring and exit so the two never fight over the same transform.
  useGSAP(() => {
    if (!card) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.5 }, delay: 0.06 });
      tl.from("[data-w=glow]", { scale: 0.35, opacity: 0, duration: 1.2, ease: "expo.out" }, 0)
        .from("[data-w=line]", { opacity: 0, y: 12, stagger: 0.07 }, 0.04)
        .from("[data-w=offer]", { opacity: 0, y: 16, scale: 0.97 }, "<0.18")
        .from("[data-w=feat]", { opacity: 0, x: -8, duration: 0.38, stagger: 0.08 }, "<0.2")
        .from("[data-w=check]", { scale: 0, rotation: -60, transformOrigin: "50% 50%", duration: 0.45, ease: "back.out(2.4)", stagger: 0.08 }, "<0.05")
        .from("[data-w=cta]", { opacity: 0, y: 10, stagger: 0.06 }, "-=0.3");
    }, card);
  }, { dependencies: [card], revertOnUpdate: true });

  useEffect(() => {
    if (localStorage.getItem(welcomeKey(user.id))) return;
    if (isApp() && !APP_SELLS_PLANS) return; // no plan offers inside the Android app (Google Play billing rules)
    // Claim this visit so the "What's new" card waits for the next one instead of stacking on top.
    document.documentElement.dataset.onboarding = "welcome";
    let t: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const show = () => {
      // Never open over another dialog that is already up: check again shortly (about a minute at most).
      t = setTimeout(() => {
        if (document.querySelector('[role="dialog"]') && ++tries < 150) return show();
        setOpen(true);
      }, 450);
    };
    // Never on top of the privacy notice: wait for it to be closed first.
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
    localStorage.setItem(welcomeKey(user.id), new Date().toISOString());
    delete document.documentElement.dataset.onboarding;
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[3px] dark:bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="welcome-sub-body">
              <div className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-lenis-prevent onPointerDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
                <motion.div
                  ref={setCard}
                  initial={{ opacity: 0, y: 20, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                  className="glass-strong relative w-full max-w-[460px] overflow-hidden rounded-[30px] bg-card/[0.94] p-6 shadow-2xl sm:p-7"
                >
                  {/* Near-opaque card (not see-through glass): the busy home page behind it made the grey text unreadable. */}
                  <span aria-hidden data-w="glow" className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-lime/25 blur-3xl" />
                  <Dialog.Close asChild>
                    <Button size="icon-sm" variant="ghost" className="absolute right-3 top-3 h-11 w-11" aria-label="Close the welcome message">
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </Dialog.Close>
                  <p data-w="line" className="eyebrow mb-2 pr-12 text-foreground/70">Welcome to Outlly</p>
                  <Dialog.Title data-w="line" className="pr-10 font-display text-[1.6rem] font-bold leading-tight tracking-[-0.03em]">
                    Hi {firstName}, glad you're here.
                  </Dialog.Title>
                  <p id="welcome-sub-body" data-w="line" className="mt-2.5 text-[14.5px] leading-relaxed text-foreground/80">
                    {welcomePitch(freeLimit, offer, freePeriod)}
                  </p>
                  {offer && (
                    <div data-w="offer" className="mt-5 rounded-2xl bg-lime/[0.08] p-4 hairline">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-display text-[1.05rem] font-semibold">{offer.name}</p>
                        <p className="tabular text-[14px]"><b className="font-display text-[1.25rem]">{offer.price}</b><span className="text-foreground/70"> / {offer.interval}</span></p>
                      </div>
                      {offer.features.length > 0 && (
                        <ul className="mt-3 flex flex-col gap-1.5 text-[13.5px]">
                          {offer.features.map((f) => (
                            <li key={f} data-w="feat" className="flex items-start gap-2"><Check data-w="check" className="mt-0.5 h-4 w-4 shrink-0 text-lime-ink" aria-hidden />{f}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div data-w="cta" className="mt-6 flex flex-wrap-reverse gap-2">
                    <Dialog.Close asChild>
                      <Button variant="ghost" className="min-w-[8rem] flex-1 text-foreground/85 hairline">Keep exploring free</Button>
                    </Dialog.Close>
                    <Button asChild variant="lime" className="min-w-[8rem] flex-1">
                      <Link href={offer ? `/billing?plan=${encodeURIComponent(offer.slug)}` : "/billing"} onClick={() => close(false)} autoFocus>
                        {offer ? `Subscribe to ${offer.name}` : "See plans"} <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                  <p data-w="cta" className="mt-3 text-center text-[12px] text-foreground/65">Cancel any time from Billing.</p>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
