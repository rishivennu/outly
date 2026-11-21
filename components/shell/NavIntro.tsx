"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";
import { track } from "@/lib/analytics/track";
import { NAV_INTRO_VERSION } from "@/lib/nav-config";
import { PANEL } from "@/lib/motion/fluid";
import { usePanelPresence } from "@/lib/motion/useFluid";
import { useToast } from "@/components/shared/Toast";
import { useNavStyle } from "./NavStyleProvider";

const SESSION_KEY = `outlly:nav-intro:v${NAV_INTRO_VERSION}`;
const FIRST_WAIT = 2500;
const RETRY_EVERY = 4000;
const GIVE_UP_AFTER = 30_000;
const POPUPS = '[role="dialog"],[role="alertdialog"],[aria-labelledby="cc-title"]';

// R1291: onboarding, cookie consent and real dialogs always come first; the card waits its turn behind them.
const popupUp = () => !!document.documentElement.dataset.onboarding || !!document.querySelector(POPUPS);

function seen(): boolean {
  try {
    return !!sessionStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // Private mode: the account still remembers the answer, the card may only reappear on the next load.
  }
}

/**
 * R1291: one gentle "meet your new dock" card for people still on the sidebar. The server decides eligibility; this
 * only times it (desktop, once per visit, never over another popup). A region, not a dialog, so it never blocks
 * the dialogs it waits behind.
 */
export function NavIntro() {
  const { intro, style, canSwitch, set, introDone, busy } = useNavStyle();
  const toast = useToast();
  const eligible = intro && canSwitch && style === "sidebar";
  const [open, setOpen] = useState(false);
  const decided = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const showing = open && eligible;
  const shown = usePanelPresence(showing, card, PANEL.rise, "100% 100%");

  useEffect(() => {
    if (!eligible || decided.current || seen()) return;
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) return void (decided.current = true);
      if (seen()) return void (decided.current = true);
      if (popupUp()) {
        // Give up quietly for this visit; no session key, so the next visit asks again.
        if (Date.now() - start + RETRY_EVERY <= GIVE_UP_AFTER) timer = setTimeout(attempt, RETRY_EVERY);
        else decided.current = true;
        return;
      }
      decided.current = true;
      markSeen();
      setOpen(true);
      track("nav_intro_shown", { style });
    };
    timer = setTimeout(attempt, FIRST_WAIT);
    return () => clearTimeout(timer);
  }, [eligible, style]);

  const later = () => {
    track("nav_intro_later", {});
    setOpen(false);
    void introDone("dismissed");
  };

  const tryDock = async () => {
    track("nav_intro_try", { from: style });
    try {
      await set("dock", "intro");
      setOpen(false);
      void introDone("tried");
      toast("Dock is on. Change it any time from the dock's style button.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not switch the navigation.", "error");
    }
  };

  if (!shown) return null;
  return createPortal(
    <div className="hidden lg:block">
      <div
        ref={card}
        role="region"
        aria-label="Meet your new Outlly dock"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            later();
          }
        }}
        className="glass-strong fixed bottom-[max(24px,var(--sa-b))] right-6 z-[60] w-[340px] max-w-[calc(100vw-48px)] rounded-[24px] p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 pt-1.5 text-[15px] font-semibold text-foreground">Meet your new Outlly dock</p>
          <button
            type="button"
            aria-label="Maybe later"
            onClick={later}
            disabled={busy}
            className="-mr-2 -mt-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">Try the updated navigation for a cleaner, smoother experience.</p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={tryDock}
            disabled={busy}
            className="h-11 rounded-full bg-lime px-5 text-[14px] font-semibold text-lime-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Try New Dock
          </button>
          <button
            type="button"
            onClick={later}
            disabled={busy}
            className="h-11 rounded-full px-4 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
