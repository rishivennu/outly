"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { T, FX } from "@/lib/motion/tokens";
import { Button } from "@/components/ui/button";
import { installManager, useInstallState, type Browser, type GuideKind } from "@/lib/pwa/install";

type ArtKind = "share-bottom" | "share-top" | "menu-bottom" | "menu-dots" | "row" | "confirm" | "address-install";
interface Step {
  art: ArtKind;
  label?: string;
  title: string;
  body: string;
}
interface Guide {
  title: string;
  lead: string;
  steps: Step[];
  note?: string;
}

const ROW_HOME = (title = "Select Add to Home Screen"): Step => ({ art: "row", label: "Add to Home Screen", title, body: "Scroll down the list if you do not see it straight away." });
const CONFIRM_ADD: Step = { art: "confirm", label: "Add", title: "Tap Add", body: "Top right. Outlly lands on your Home Screen and opens full screen, like an app." };
const IOS_LEAD = "Apple adds web apps from the Share menu, so this takes three taps. No download, nothing to update.";
const IOS_NOTE = "The Home Screen app keeps its own sign-in, so it may ask you to sign in once.";

/** The steps for each browser. iOS has no install call a website can make, so these walk through the browser's own menus. */
export function guideFor(kind: GuideKind, browser: Browser, tablet = false): Guide {
  switch (kind) {
    case "ios-safari":
      return {
        title: "Add Outlly to your Home Screen",
        lead: IOS_LEAD,
        steps: [
          tablet
            ? { art: "share-top", title: "Tap the Share icon", body: "It is at the top right of Safari, next to the address bar." }
            : { art: "share-bottom", title: "Tap the Share icon", body: "It is in the toolbar at the bottom of Safari. If you only see \u2022\u2022\u2022, tap that first, then Share." },
          ROW_HOME(),
          CONFIRM_ADD,
        ],
        note: IOS_NOTE,
      };
    case "ios-other":
      return {
        title: "Add Outlly to your Home Screen",
        lead: IOS_LEAD,
        steps: [
          browser === "chrome"
            ? { art: "share-top", title: "Tap the Share icon", body: "In Chrome it is at the top right, inside the address bar." }
            : browser === "firefox"
              ? { art: "menu-bottom", title: "Tap the menu, then Share", body: "In Firefox the menu button is at the bottom right of the screen." }
              : { art: "menu-bottom", title: "Open the menu, then Share", body: "Some browsers show the Share icon in the toolbar, others keep it in the menu." },
          ROW_HOME(),
          CONFIRM_ADD,
        ],
        note: "Other browsers on iPhone and iPad can do this from iOS 16.4. If Add to Home Screen is missing, open this page in Safari. " + IOS_NOTE,
      };
    case "android":
      return {
        title: "Add Outlly to your Home Screen",
        lead: "Your browser did not offer its install button here, so this goes through its menu.",
        steps: [
          {
            art: "menu-dots",
            title: "Open the browser menu",
            body: browser === "samsung" ? "Tap the menu button (three lines) at the bottom of the screen." : browser === "firefox" ? "Tap \u22EE next to the address bar." : "Tap \u22EE at the top right of the browser.",
          },
          browser === "samsung"
            ? { art: "row", label: "Add page to", title: "Choose Add page to, then Home screen", body: "Outlly gets its own icon." }
            : { art: "row", label: "Install app", title: "Choose Install app", body: "Some browsers call it Add to Home screen." },
          { art: "confirm", label: "Install", title: "Tap Install", body: "Outlly lands on your Home Screen and in your app drawer." },
        ],
      };
    case "desktop":
      return {
        title: "Install Outlly on this computer",
        lead: "Your browser keeps its install option in the address bar and its menu.",
        steps: [
          { art: "address-install", title: "Click the install icon", body: "At the right end of the address bar. If Outlly is already installed, it says Open in app instead." },
          {
            art: "row",
            label: "Install Outlly",
            title: "Or use the browser menu",
            body: browser === "edge" ? "Menu, then Apps, then Install this site as an app." : browser === "chrome" ? "Menu \u22EE, then Cast, save and share, then Install page as app." : "Look for Install in the browser menu.",
          },
          { art: "confirm", label: "Install", title: "Click Install", body: "Outlly opens in its own window, with its own icon." },
        ],
      };
    case "desktop-safari":
      return {
        title: "Install Outlly on this Mac",
        lead: "Safari adds web apps to the Dock from macOS Sonoma.",
        steps: [
          { art: "share-top", title: "Click Share in the toolbar", body: "Or open the File menu at the top of the screen." },
          { art: "row", label: "Add to Dock", title: "Choose Add to Dock", body: "Outlly gets its own icon in the Dock." },
          { art: "confirm", label: "Add", title: "Click Add", body: "Outlly opens in its own window." },
        ],
      };
    case "in-app":
      return {
        title: "Open Outlly in your browser first",
        lead: "This browser runs inside another app and cannot add Outlly to your Home Screen.",
        steps: [
          { art: "menu-dots", title: "Open this screen's menu", body: "Tap \u2022\u2022\u2022 or \u22EE in a corner of the screen." },
          { art: "row", label: "Open in browser", title: "Choose Open in browser", body: "It may say Open in Safari or Open in Chrome." },
          { art: "confirm", label: "Install", title: "Tap Install Outlly again", body: "Your browser can then add it to your Home Screen." },
        ],
      };
    default:
      return {
        title: "Install Outlly from another browser",
        lead: "Firefox on a computer cannot install web apps. Open outlly.com in Chrome, Edge or Safari to install it there, or add Outlly to your phone.",
        steps: [],
      };
  }
}

const LIME = "hsl(var(--lime))";

function ShareGlyph({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 5} ${y - 2}v7h10v-7M${x} ${y + 2}V${y - 8}M${x - 3.5} ${y - 4.5}L${x} ${y - 8}l3.5 3.5`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
}
const Ring = ({ x, y, r = 9 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill={LIME} fillOpacity="0.28" stroke={LIME} strokeWidth="1.6" />;

/** Small drawings of the real browser controls, so the step is recognisable at a glance. Decorative: the text says it all. */
function Art({ kind, label = "" }: { kind: ArtKind; label?: string }) {
  const frame = <rect x="1" y="1" width="94" height="62" rx="12" fill="hsl(var(--background))" stroke="currentColor" strokeOpacity="0.18" />;
  const dim = { stroke: "currentColor", strokeOpacity: 0.35, strokeWidth: 1.6, strokeLinecap: "round" as const, fill: "none" };
  let body: React.ReactNode;
  switch (kind) {
    case "share-bottom":
      body = (
        <>
          <rect x="6" y="40" width="84" height="18" rx="9" fill="currentColor" fillOpacity="0.07" />
          <path d="M17 45l-4 4 4 4M29 45l4 4-4 4" {...dim} />
          <Ring x={48} y={49} />
          <ShareGlyph x={48} y={50} />
          <path d="M60 45h7v8h-7zM76 46h8v7h-8z" {...dim} />
          <rect x="16" y="10" width="64" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
          <rect x="16" y="20" width="44" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
        </>
      );
      break;
    case "share-top":
      body = (
        <>
          <rect x="6" y="7" width="66" height="16" rx="8" fill="currentColor" fillOpacity="0.07" />
          <rect x="14" y="13" width="36" height="4" rx="2" fill="currentColor" fillOpacity="0.2" />
          <Ring x={83} y={15} />
          <ShareGlyph x={83} y={16} />
          <rect x="12" y="32" width="72" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
          <rect x="12" y="42" width="52" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
        </>
      );
      break;
    case "menu-bottom":
      body = (
        <>
          <rect x="6" y="40" width="84" height="18" rx="9" fill="currentColor" fillOpacity="0.07" />
          <path d="M17 45l-4 4 4 4M29 45l4 4-4 4M44 49h8M48 45v8" {...dim} />
          <Ring x={78} y={49} />
          <path d="M73 45.5h10M73 49h10M73 52.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="16" y="10" width="64" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
          <rect x="16" y="20" width="44" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
        </>
      );
      break;
    case "menu-dots":
      body = (
        <>
          <rect x="6" y="7" width="66" height="16" rx="8" fill="currentColor" fillOpacity="0.07" />
          <rect x="14" y="13" width="36" height="4" rx="2" fill="currentColor" fillOpacity="0.2" />
          <Ring x={83} y={15} />
          <g fill="currentColor">
            <circle cx="83" cy="10.5" r="1.4" />
            <circle cx="83" cy="15" r="1.4" />
            <circle cx="83" cy="19.5" r="1.4" />
          </g>
          <rect x="12" y="32" width="72" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
          <rect x="12" y="42" width="52" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
        </>
      );
      break;
    case "address-install":
      body = (
        <>
          <rect x="6" y="7" width="84" height="16" rx="8" fill="currentColor" fillOpacity="0.07" />
          <rect x="14" y="13" width="40" height="4" rx="2" fill="currentColor" fillOpacity="0.2" />
          <Ring x={79} y={15} r={8} />
          <path d="M74 10.5h10v7h-10zM77 20h4M79 12v4M77.3 14.4l1.7 1.7 1.7-1.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="12" y="32" width="72" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
          <rect x="12" y="42" width="52" height="5" rx="2.5" fill="currentColor" fillOpacity="0.1" />
        </>
      );
      break;
    case "row":
      body = (
        <>
          <rect x="8" y="6" width="80" height="12" rx="4" fill="currentColor" fillOpacity="0.06" />
          <rect x="6" y="23" width="84" height="18" rx="6" fill={LIME} fillOpacity="0.22" stroke={LIME} strokeWidth="1.4" />
          <text x="12" y="35" fontSize="7.5" fontWeight="600" fill="currentColor" {...(label.length > 12 ? { textLength: 60, lengthAdjust: "spacingAndGlyphs" } : {})}>
            {label}
          </text>
          <path d="M77 27.5h8v8h-8zM81 29.5v4M79 31.5h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="8" y="46" width="80" height="12" rx="4" fill="currentColor" fillOpacity="0.06" />
        </>
      );
      break;
    default:
      body = (
        <>
          <rect x="6" y="7" width="84" height="18" rx="6" fill="currentColor" fillOpacity="0.07" />
          <text x="11" y="19" fontSize="7.5" fill="currentColor" fillOpacity="0.55">Cancel</text>
          <rect x={88 - (label.length * 5 + 10)} y="9.5" width={label.length * 5 + 10} height="13" rx="6.5" fill={LIME} fillOpacity="0.3" stroke={LIME} strokeWidth="1.4" />
          <text x={83 - label.length * 2.5} y="19" fontSize="8" fontWeight="700" textAnchor="middle" fill="currentColor">{label}</text>
          <rect x="34" y="33" width="28" height="22" rx="7" fill="currentColor" fillOpacity="0.12" />
          <path d="M42 44h12M48 38v12" stroke={LIME} strokeWidth="2" strokeLinecap="round" />
        </>
      );
  }
  return (
    <svg viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false" className="h-16 w-24 shrink-0 text-foreground">
      {frame}
      {body}
    </svg>
  );
}

/**
 * R1256: the manual install steps, for browsers that give a website no install prompt (iPhone and iPad above all).
 * A bottom sheet on phones and a centred dialog on wider screens. It never opens the Share sheet itself (iOS has no
 * supported way to), and closing it is not an install: the caller only pauses promotions.
 */
export function InstallGuide({ open, onClose, kind, browser, tablet }: { open: boolean; onClose: () => void; kind: GuideKind; browser: Browser; tablet: boolean }) {
  const reduce = useReducedMotion();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!open) return;
    const q = window.matchMedia("(min-width: 640px)");
    const on = () => setWide(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [open]);
  const g = guideFor(kind, browser, tablet);
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : wide
      ? { initial: { opacity: 0, y: 16, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 8, scale: 0.98 }, transition: T.card }
      : { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" }, transition: T.card };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[4px]" {...FX.scrim} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="install-guide-d">
              <motion.div
                data-lenis-prevent
                className="install-sheet fixed inset-x-0 bottom-0 z-[81] mx-auto flex w-full max-w-[480px] flex-col overflow-y-auto overscroll-contain rounded-t-[28px] pt-3 outline-none sm:inset-0 sm:m-auto sm:h-fit sm:rounded-[28px] sm:pt-6"
                style={{
                  maxHeight: "calc(100dvh - env(safe-area-inset-top) - 12px)",
                  paddingLeft: "max(20px, env(safe-area-inset-left))",
                  paddingRight: "max(20px, env(safe-area-inset-right))",
                  paddingBottom: "max(16px, env(safe-area-inset-bottom))",
                }}
                {...motionProps}
              >
                <span aria-hidden="true" className="mx-auto mb-3 block h-1.5 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden" />
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/app/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-[13px] shadow-sm ring-1 ring-foreground/10" />
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="font-display text-[19px] font-bold leading-tight tracking-[-0.02em]">{g.title}</Dialog.Title>
                    <Dialog.Description id="install-guide-d" className="mt-1 text-[14px] leading-snug text-muted-foreground">{g.lead}</Dialog.Description>
                  </div>
                  <Dialog.Close aria-label="Close" className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <X className="h-[18px] w-[18px]" aria-hidden="true" />
                  </Dialog.Close>
                </div>
                {g.steps.length > 0 && (
                  <ol className="mt-5 grid gap-2" aria-label="Steps">
                    {g.steps.map((s, i) => (
                      <li key={s.title} className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3 hairline">
                        <Art kind={s.art} label={s.label} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold leading-snug">
                            <span className="text-muted-foreground">{i + 1}. </span>
                            {s.title}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{s.body}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {g.note && <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">{g.note}</p>}
                <Button variant="lime" className="mt-5 w-full shrink-0" onClick={onClose}>
                  Got it
                </Button>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** The one guide sheet for every Install Outlly button, mounted once in the studio shell (components/shell/InstallPrompt.tsx). */
export function InstallGuideHost() {
  const s = useInstallState();
  if (!s.ready) return null;
  return <InstallGuide open={s.guideOpen} onClose={() => installManager()?.closeGuide()} kind={s.guide} browser={s.browser} tablet={s.tablet} />;
}
