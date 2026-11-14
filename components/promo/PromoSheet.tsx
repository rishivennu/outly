"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Check, X } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { useUser } from "@/components/shell/UserContext";
import { tourKey } from "@/components/onboarding/Tour";
import { afterWelcome } from "@/lib/pwa-welcome";
import { formatMoney } from "@/lib/billing/money";
import { PROMO_SESSION_KEY, quietPath } from "@/lib/campaign-core";
import type { OfferView } from "@/lib/campaign";
import { cn } from "@/lib/utils";

/** How long the close takes (CSS .promo-out); the dialog unmounts after it. */
export const PROMO_EXIT_MS = 320;

type Offer = Pick<OfferView, "id" | "label" | "badge" | "headline" | "body" | "benefits" | "terms" | "ctaText" | "href" | "endsLabel" | "plan" | "cycle" | "currency" | "originalMinor" | "finalMinor" | "renewMinor" | "left">;

const per = (cycle: string) => (cycle === "year" ? "/yr" : "/mo");

/** Floating paper pieces, at three depths (back pieces smaller and fainter). Decorative only. */
function Confetti() {
  const bits: { c: string; x: string; y: string; r: number; s: number; d: "back" | "mid" | "front"; shape: "rect" | "dot" | "zig" }[] = [
    // All in the open space right of the headline and the big number, never over text.
    { c: "var(--promo-lime)", x: "62%", y: "4%", r: -18, s: 14, d: "back", shape: "rect" },
    { c: "var(--promo-coral)", x: "84%", y: "10%", r: 24, s: 12, d: "back", shape: "dot" },
    { c: "#141414", x: "94%", y: "26%", r: 0, s: 8, d: "back", shape: "dot" },
    { c: "var(--promo-coral)", x: "72%", y: "32%", r: 12, s: 18, d: "mid", shape: "rect" },
    { c: "#141414", x: "88%", y: "52%", r: -30, s: 18, d: "mid", shape: "zig" },
    { c: "var(--promo-lime)", x: "84%", y: "84%", r: 40, s: 22, d: "front", shape: "rect" },
  ];
  return (
    <div aria-hidden className="promo-confetti promo-in" style={{ ["--d" as string]: "450ms", ["--t" as string]: "500ms" }}>
      {bits.map((b, i) => (
        <span key={i} className={cn("promo-bit", `promo-bit-${b.d}`)} style={{ left: b.x, top: b.y, ["--r" as string]: `${b.r}deg`, ["--i" as string]: i }}>
          {b.shape === "rect" ? (
            <svg width={b.s} height={b.s * 0.55} viewBox="0 0 20 11"><rect width="20" height="11" rx="2.5" fill={b.c} /></svg>
          ) : b.shape === "dot" ? (
            <svg width={b.s} height={b.s} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill={b.c} /></svg>
          ) : (
            <svg width={b.s * 1.6} height={b.s} viewBox="0 0 32 20"><path d="M2 14 L9 5 L16 14 L23 5 L30 14" fill="none" stroke={b.c} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * The offer card (1122). Also the live preview in Admin > Offers (`preview`: plain headings, no dialog parts).
 * Every number on it comes from the server: the struck price is what this person pays today without the offer.
 */
export function PromoCard({ offer, onClose, onClaim, preview }: { offer: Offer; onClose?: () => void; onClaim?: () => void; preview?: boolean }) {
  const Title = preview ? "h3" : Dialog.Title;
  const Desc = preview ? "p" : Dialog.Description;
  const final = formatMoney(offer.finalMinor, offer.currency);
  const was = formatMoney(offer.originalMinor, offer.currency);
  const renew = offer.renewMinor !== offer.finalMinor ? `then ${formatMoney(offer.renewMinor, offer.currency)}${per(offer.cycle)}` : null;
  const [num, ...rest] = offer.label.split(" ");
  return (
    <div className="promo-card relative overflow-hidden">
      <span aria-hidden className="promo-grain" />
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close offer" className="promo-close absolute right-3 top-3 z-[3] grid h-11 w-11 place-items-center rounded-full">
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      )}
      <div className="relative z-[2] px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:px-7">
        <div className="flex items-center gap-2.5 pr-12">
          <span className="promo-in promo-logo" style={{ ["--d" as string]: "180ms", ["--t" as string]: "350ms" }}>
            {/* A fixed dark tile: the card is cream in both themes, so the mark must not follow the app theme. */}
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-[#141414]"><OutlyMark size={22} variant="glyph" /></span>
          </span>
          <span className="promo-in promo-badge inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ ["--d" as string]: "250ms", ["--t" as string]: "350ms" }}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--promo-lime)]" />
            {offer.badge}
          </span>
        </div>

        <div className="relative mt-5">
          <Confetti />
          <Title className="promo-in relative text-[15px] font-semibold text-[#5b3a2a]" style={{ ["--d" as string]: "350ms", ["--t" as string]: "500ms" }}>
            {offer.headline}
          </Title>
          <p className="promo-in promo-discount relative mt-1 font-display" style={{ ["--d" as string]: "350ms", ["--t" as string]: "500ms" }} aria-label={`${offer.label} ${offer.plan.name}`}>
            <span className="promo-num">{num}</span> <span className="promo-off">{rest.join(" ")}</span>
          </p>
        </div>

        <div className="promo-in mt-4 flex items-end justify-between gap-3" style={{ ["--d" as string]: "550ms", ["--t" as string]: "400ms" }}>
          <div className="promo-tag relative rounded-[18px] px-4 py-3">
            <span aria-hidden className="promo-tag-hole" />
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#7a4a33]">Price</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[1.9rem] font-extrabold leading-none tabular text-[#141414]">{final}</span>
              <span className="text-[13px] font-semibold text-[#5b3a2a]">{per(offer.cycle)}</span>
            </p>
            <p className="mt-1 text-[13px] text-[#5b3a2a]">
              <s className="tabular" aria-label={`was ${was}`}>{was}</s>
              <span className="ml-1.5">{offer.plan.name}{renew ? `, first ${offer.cycle === "year" ? "year" : "month"}` : ""}</span>
            </p>
          </div>
          <p className="pb-1 text-right text-[12px] font-semibold text-[#7a4a33]">
            {offer.endsLabel}
            {offer.left !== null && offer.left <= 50 && <><br />{offer.left} left</>}
          </p>
        </div>

        <div className="promo-in mt-5" style={{ ["--d" as string]: "650ms", ["--t" as string]: "400ms" }}>
          <button type="button" onClick={onClaim} disabled={!onClaim} className="promo-cta flex h-14 w-full items-center justify-center gap-2 rounded-[18px] text-[16px] font-semibold">
            {offer.ctaText}
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
          </button>
          {renew && <p className="mt-2 text-center text-[12px] text-[#5b3a2a]">{final} today, {renew}. Cancel any time.</p>}
        </div>

        <div className="promo-in mt-4" style={{ ["--d" as string]: "750ms", ["--t" as string]: "400ms" }}>
          {offer.body && <Desc className="text-[14px] leading-snug text-[#3d2a20]">{offer.body}</Desc>}
          {!offer.body && <Desc className="sr-only">{`${offer.label} ${offer.plan.name}: ${final} instead of ${was}.`}</Desc>}
          {offer.benefits.length > 0 && (
            <ul className="mt-2 grid gap-1.5 text-[14px] text-[#2a1d16]">
              {offer.benefits.map((b, i) => (
                <li key={`${i}-${b}`} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1f6b3a]" aria-hidden />{b}</li>
              ))}
            </ul>
          )}
          {offer.terms && <p className="mt-3 text-xs leading-snug text-[#6b4a3a]">{offer.terms}</p>}
        </div>
      </div>
    </div>
  );
}

const post = (id: string, kind: "impression" | "dismiss" | "click") =>
  fetch("/api/campaign/event", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind }), keepalive: true }).catch(() => {});

const otherPopup = () => !!document.documentElement.dataset.onboarding || !!document.querySelector('[role="dialog"],[role="alertdialog"]');

/**
 * 1122: the promo offer sheet. Once per fresh app entry (a new tab, a cold PWA launch), after the app has settled.
 * Never on billing, checkout, sign-in or the first-run flow, never on top of another popup, never twice in a
 * visit. Closing it simply carries on where you are.
 */
export function PromoSheet() {
  const owner = useUser().id;
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const claimed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(PROMO_SESSION_KEY)) return;
      sessionStorage.setItem(PROMO_SESSION_KEY, "1");
      // The first visit on a device belongs to the guided tour (WhatsNew and InstallPrompt wait the same way).
      if (!localStorage.getItem(tourKey(owner))) return;
    } catch {
      return; // storage blocked: never risk showing it on every page
    }
    if (quietPath(location.pathname, location.hash) || new URLSearchParams(location.search).has("tour")) return;
    let stop = false;
    let other = false;
    const onOther = () => (other = true);
    window.addEventListener("outly:tour", onOther);
    window.addEventListener("outly:guide", onOther);
    const offerP: Promise<Offer | null> = fetch("/api/campaign/active", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.offer as Offer | null) ?? null)
      .catch(() => null);
    let t = 0;
    const undo = afterWelcome(() => {
      let tries = 0;
      t = window.setInterval(() => {
        if (++tries > 30 || stop) return window.clearInterval(t); // about 36 s, then not this visit
        if (document.hidden) return;
        if (document.querySelector('[aria-labelledby="cc-title"]')) return; // the cookie choice is quick: wait for it
        const typing = (document.activeElement as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable='true']");
        if (typing) return;
        window.clearInterval(t);
        // Another popup had the moment, or they went somewhere quiet (billing, checkout): not this visit.
        if (other || otherPopup() || quietPath(location.pathname, location.hash)) return;
        void offerP.then((o) => {
          if (!o || stop || other || otherPopup() || quietPath(location.pathname, location.hash)) return;
          // Take the shared popup lock now, before React paints: What's new, page tips and the install card all wait on it.
          document.documentElement.dataset.onboarding = "promo";
          setOffer(o);
          setPhase("open");
          void post(o.id, "impression");
        });
      }, 1200);
    });
    return () => {
      stop = true;
      if (document.documentElement.dataset.onboarding === "promo") delete document.documentElement.dataset.onboarding;
      undo();
      window.clearInterval(t);
      window.removeEventListener("outly:tour", onOther);
      window.removeEventListener("outly:guide", onOther);
    };
  }, [owner]);

  const close = (why: "dismiss" | "claim") => {
    if (!offer || phase !== "open") return;
    if (why === "dismiss" && !claimed.current) void post(offer.id, "dismiss");
    setPhase("closing");
    window.setTimeout(() => {
      setPhase("closed");
      if (document.documentElement.dataset.onboarding === "promo") delete document.documentElement.dataset.onboarding;
    }, PROMO_EXIT_MS);
  };
  const claim = () => {
    if (!offer || claimed.current) return; // a double tap counts one click and navigates once
    claimed.current = true;
    void post(offer.id, "click");
    close("claim");
    router.push(offer.href);
  };

  if (!offer || phase === "closed") return null;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close("dismiss")}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn("promo-overlay fixed inset-0 z-[84]", phase === "closing" && "promo-out")} />
        <Dialog.Content
          ref={box}
          // Focus the sheet itself (it is announced as a dialog), not the close button: no ring flashes on open.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            box.current?.focus();
          }}
          className={cn("promo-sheet fixed inset-x-0 bottom-0 z-[85] mx-auto w-full max-w-[440px] outline-none sm:bottom-6", phase === "closing" && "promo-out")}
          data-lenis-prevent
        >
          <PromoCard offer={offer} onClose={() => close("dismiss")} onClaim={claim} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
