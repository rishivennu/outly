"use client";
import { T, FX, ease } from "@/lib/motion/tokens";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INSTALL_KEY,
  INSTALL_VISIT_KEY,
  dismiss,
  guided,
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

/** The event Chrome-based browsers fire when Outlly can be installed (not in TypeScript's DOM types yet). */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type W = Window & { __outllyInstall?: InstallEvent | null };

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
 * 1099: "Add Outlly to your Home Screen". A small card above the tab bar on phones; Android gets the
 * browser's own install prompt, iOS gets the three Share-sheet steps. Rules live in lib/pwa-core.ts and
 * Admin > Dashboard style. Not a dialog, so it never traps focus or blocks the page under it.
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
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const gaveUp = useRef(false); // another popup had this visit: wait for the next one
  const pathRef = useRef(path);
  pathRef.current = path;

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
  const visible = show && !!mode && !guide;
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
    write(dismiss(read(), Date.now()));
    setShow(false);
    gaveUp.current = true;
  }, []);

  const add = async () => {
    if (mode === "ios") {
      setGuide(true);
      return;
    }
    const ev = (window as W).__outllyInstall;
    if (!ev) {
      // The browser took its prompt back: tuck the card away for this visit without counting a "Not now".
      setShow(false);
      setMode(null);
      gaveUp.current = true;
      return;
    }
    setBusy(true);
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      (window as W).__outllyInstall = null; // a prompt can be used once
      if (outcome === "accepted") write({ ...read(), installed: true });
      else write(dismiss(read(), Date.now()));
    } catch {
      write(dismiss(read(), Date.now()));
    } finally {
      setBusy(false);
      setShow(false);
      setMode(null);
      gaveUp.current = true;
    }
  };

  const closeGuide = () => {
    setGuide(false);
    // We cannot see an iOS install from here: pause for one cooldown, without a strike towards "stop for good".
    write(guided(read(), Date.now()));
    setShow(false);
    gaveUp.current = true;
  };

  if (!config.enabled) return null;
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
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[14.5px] font-semibold leading-snug">Get a better Outlly experience</p>
                <p className="text-[13px] leading-snug text-muted-foreground">Add Outlly to your Home Screen. It opens full screen, like an app.</p>
              </div>
              <button type="button" onClick={later} aria-label="Not now" className="-mr-1 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,transform] duration-200 hover:bg-foreground/[0.06] hover:text-foreground active:scale-90 motion-reduce:transition-none">
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>
            <Button variant="lime" className="mt-3 w-full" onClick={() => void add()} disabled={busy} aria-haspopup={mode === "ios" ? "dialog" : undefined}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {busy ? "Opening…" : "Add to Home Screen"}
            </Button>
          </motion.aside>
        )}
      </AnimatePresence>
      <IosGuide open={guide} onClose={closeGuide} />
    </>
  );
}

const STEPS: { icon: React.ReactNode; title: string; body: string }[] = [
  { icon: <Share className="h-5 w-5" aria-hidden="true" />, title: "Tap the Share button", body: "In Safari it is in the toolbar, at the bottom of the screen (or at the top on iPad)." },
  { icon: <SquarePlus className="h-5 w-5" aria-hidden="true" />, title: "Select \u201cAdd to Home Screen\u201d", body: "Scroll the list down a little if you don\u2019t see it straight away." },
  { icon: <span className="text-[13px] font-bold" aria-hidden="true">Add</span>, title: "Tap \u201cAdd\u201d", body: "Top right. Outlly lands on your Home Screen and opens full screen." },
];

/** iOS has no install prompt a site can call: three steps through the Share sheet. A bottom sheet on phones. */
function IosGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[4px]" {...FX.scrim} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="ios-install-d">
              <motion.div
                className="install-sheet fixed inset-x-0 bottom-0 z-[81] mx-auto w-full max-w-[480px] rounded-t-[28px] px-5 pt-3 outline-none sm:bottom-6 sm:rounded-[28px]"
                initial={reduce ? { opacity: 0 } : { y: "100%" }}
                animate={reduce ? { opacity: 1 } : { y: 0 }}
                exit={reduce ? { opacity: 0 } : { y: "100%" }}
                transition={reduce ? { duration: 0.15 } : T.card}
              >
                <span aria-hidden="true" className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-foreground/15" />
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/app/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-[13px] shadow-sm ring-1 ring-foreground/10" />
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="font-display text-[19px] font-bold leading-tight tracking-[-0.02em]">Add Outlly to your Home Screen</Dialog.Title>
                    <Dialog.Description id="ios-install-d" className="mt-0.5 text-[13.5px] text-muted-foreground">Three taps. It opens full screen, like an app.</Dialog.Description>
                  </div>
                </div>
                <ol className="mt-5 grid gap-2">
                  {STEPS.map((s, i) => (
                    <li key={s.title} className="flex items-start gap-3 rounded-2xl bg-secondary/50 p-3 hairline">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background text-foreground shadow-sm hairline">{s.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold leading-snug">
                          <span className="text-muted-foreground">{i + 1}. </span>
                          {s.title}
                        </span>
                        <span className="block text-[13px] leading-snug text-muted-foreground">{s.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <Button variant="lime" className="mt-5 w-full" onClick={onClose}>
                  Got it
                </Button>
                <span aria-hidden="true" className="block h-[max(16px,env(safe-area-inset-bottom))]" />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
