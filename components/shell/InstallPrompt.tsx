"use client";
import { ease } from "@/lib/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { InstallOutllyButton, INSTALL_TEXT } from "@/components/pwa/InstallOutllyButton";
import { InstallGuideHost } from "@/components/pwa/InstallGuide";
import { installManager, useInstallState } from "@/lib/pwa/install";
import {
  INSTALL_KEY,
  INSTALL_VISIT_KEY,
  provenInstalled,
  installMode,
  isCalmPage,
  parseState,
  runningInstalled,
  shouldOffer,
  type InstallConfig,
  type InstallMode,
  type InstallState,
} from "@/lib/pwa-core";

type W = Window & { __outllyInstall?: unknown };

const read = (): InstallState => {
  try {
    return parseState(localStorage.getItem(INSTALL_KEY));
  } catch {
    return parseState(null);
  }
};
const write = (s: InstallState) => {
  try {
    localStorage.setItem(INSTALL_KEY, JSON.stringify(s));
  } catch {
    /* private mode: it may ask again next visit, nothing worse */
  }
};

function signals() {
  const mm = (q: string) => window.matchMedia?.(q).matches ?? false;
  return {
    standalone: mm("(display-mode: standalone)") || mm("(display-mode: fullscreen)") || mm("(display-mode: minimal-ui)") || mm("(display-mode: window-controls-overlay)"),
    iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone === true,
    appMode: document.documentElement.hasAttribute("data-app"),
    referrer: document.referrer,
    search: location.search,
  };
}
const installedNow = () => runningInstalled(signals());

/** Last tap or key press: a dialog that opens right after one was asked for (the bell, Pip), not pushed at the user. */
let lastGesture = 0;
if (typeof window !== "undefined") {
  const mark = () => (lastGesture = Date.now());
  window.addEventListener("pointerdown", mark, { capture: true, passive: true });
  window.addEventListener("keydown", mark, { capture: true, passive: true });
}

/** Something else owns the screen right now: a dialog, the tour, the cookie choice, typing. */
const busyScreen = () =>
  !!document.querySelector('[role="dialog"],[role="alertdialog"],[aria-labelledby="cc-title"]') ||
  !!document.documentElement.dataset.onboarding ||
  !!(document.activeElement as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable='true']");

/**
 * 1099: the Home Screen card. A small card above the tab bar on phones; R1256: its action is the shared Install
 * Outlly button (Android gets the browser's own install prompt, iOS the guided steps). When it shows lives in
 * lib/pwa-core.ts and Admin > Dashboard. Not a dialog, so it never traps focus or blocks the page under it.
 * It also hosts the one install guide every Install Outlly button opens, so that one shows even with the card off.
 */
export function InstallPrompt({ config: given }: { config: InstallConfig }) {
  // The layout hands a fresh object on every navigation: key on the values so timers are not restarted.
  const key = JSON.stringify(given);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => given, [key]);
  const path = usePathname();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<InstallMode>(null);
  const [show, setShow] = useState(false);
  const install = useInstallState();
  const gaveUp = useRef(false); // another popup had this visit: wait for the next one
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => installManager()?.configure(config), [config]);

  // Count the visit once per tab session, and remember an install we can see.
  useEffect(() => {
    if (!config.enabled) return;
    const s = read();
    let next = s;
    if (provenInstalled(signals())) next = { ...next, installed: true };
    try {
      if (!sessionStorage.getItem(INSTALL_VISIT_KEY)) {
        sessionStorage.setItem(INSTALL_VISIT_KEY, "1");
        next = { ...next, visits: next.visits + 1 };
      }
    } catch {
      /* storage blocked: no counting, so it never shows */
    }
    if (next !== s) write(next);
  }, [config.enabled]);

  // Work out what we can offer: the captured prompt, or the iOS steps.
  useEffect(() => {
    if (!config.enabled) return;
    const w = window as W;
    const pick = () =>
      setMode(installMode({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, hasPrompt: !!w.__outllyInstall }));
    pick();
    const gone = () => {
      setShow(false);
      setMode(null);
    };
    window.addEventListener("outly:installable", pick);
    window.addEventListener("outly:installed", gone);
    return () => {
      window.removeEventListener("outly:installable", pick);
      window.removeEventListener("outly:installed", gone);
    };
  }, [config.enabled]);

  // Timing: phone width, calm page, nothing else on screen, after delaySec of quiet. Any popup this visit wins.
  useEffect(() => {
    if (!config.enabled || !mode || show || gaveUp.current) return;
    if (installedNow() || !shouldOffer(read(), config, Date.now())) return;
    const phone = window.matchMedia("(max-width: 1023px)");
    const skip = () => (gaveUp.current = true);
    window.addEventListener("outly:tour", skip);
    window.addEventListener("outly:guide", skip);
    let quiet = 0;
    let opened = 0; // when the current dialog was first seen
    const STEP = 1000;
    const t = window.setInterval(() => {
      if (gaveUp.current) return window.clearInterval(t);
      if (document.hidden || !phone.matches || !isCalmPage(pathRef.current)) return;
      if (busyScreen()) {
        // A dialog the app pushed (What's new, upgrade, tour) had the moment: one popup per visit.
        // One the user opened (Notices, Pip, a menu) only pauses the count.
        const dlg = document.querySelector('[role="dialog"],[role="alertdialog"]');
        if (dlg && !opened) opened = Date.now();
        if (document.documentElement.dataset.onboarding || (dlg && opened - lastGesture > 1500)) skip();
        quiet = 0;
        return;
      }
      opened = 0;
      quiet += STEP;
      if (quiet >= config.delaySec * 1000) {
        window.clearInterval(t);
        setShow(true);
      }
    }, STEP);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("outly:tour", skip);
      window.removeEventListener("outly:guide", skip);
    };
  }, [config, mode, show]);

  // Leaving for Create or an editor tucks it away for this visit; it never follows you into work.
  useEffect(() => {
    if (show && !isCalmPage(path)) {
      setShow(false);
      gaveUp.current = true;
    }
  }, [path, show]);

  // While the card is up, Pip's chat button steps aside (it sits in the same corner); asking for Pip tucks the card away.
  const visible = show && !!mode && !install.guideOpen && !install.installed && install.outcome !== "accepted";
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.setAttribute("data-install-card", "");
    const chat = () => {
      setShow(false);
      gaveUp.current = true;
    };
    window.addEventListener("outly:chat-open", chat);
    return () => {
      root.removeAttribute("data-install-card");
      window.removeEventListener("outly:chat-open", chat);
    };
  }, [visible]);

  const later = useCallback(() => {
    installManager()?.dismissPromotion();
    setShow(false);
    gaveUp.current = true;
  }, []);

  // The button already recorded the answer (a "Not now" in the prompt is a strike, the guide a pause): just step aside.
  const done = useCallback(() => {
    setShow(false);
    gaveUp.current = true;
  }, []);

  if (!config.enabled) return <InstallGuideHost />;
  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.aside
            key="install"
            aria-label="Install Outlly"
            aria-live="polite"
            data-install-banner=""
            className="install-card web-only fixed z-[45] mx-auto max-w-[440px] rounded-[24px] p-3 lg:hidden"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: reduce ? 0.15 : 0.32, ease: ease("out") }}
          >
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/app/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-[12px] shadow-sm ring-1 ring-foreground/10" />
              <p id="install-card-d" className="min-w-0 flex-1 pt-0.5 text-[14px] font-medium leading-snug">{INSTALL_TEXT}</p>
              <button type="button" onClick={later} aria-label="Not now" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,transform] duration-200 hover:bg-foreground/[0.06] hover:text-foreground active:scale-90 motion-reduce:transition-none">
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
            <InstallOutllyButton layout="card" className="mt-3" describedBy="install-card-d" onResult={done} />
          </motion.aside>
        )}
      </AnimatePresence>
      <InstallGuideHost />
    </>
  );
}
