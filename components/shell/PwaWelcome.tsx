"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, PlayCircle, Rocket, X } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { startTour } from "@/components/onboarding/Tour";
import { cn } from "@/lib/utils";
import { useUser } from "./UserContext";
import { WelcomeArt } from "./WelcomeArt";
import { HEADLINE_NOWRAP, WELCOMED_EVENT, WELCOME_DEFAULT, WELCOME_KEY, fillName, headlineParts, shouldWelcome, type WelcomeConfig } from "@/lib/pwa-welcome";

/** What the person picked on the way out (1101). Every one of them counts as seen. */
type Exit = "start" | "connect" | "tour" | "skip";
/** The exit plays for this long (globals.css .pwa-welcome[data-phase="leaving"]); reduced motion gets a short fade. */
export const WELCOME_EXIT_MS = 300;

type Phase = "ssr" | "show" | "leaving" | "gone";
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const stagger = (i: number) => ({ ["--i" as string]: i }) as React.CSSProperties;

/**
 * First launch from the Home Screen (1100; rules in lib/pwa-welcome.ts). Server-rendered on every studio load
 * and hidden by CSS unless <head> set html[data-welcome], so an installed first launch paints the welcome at
 * once. It is a dialog only while it shows (other popups look for [role="dialog"] and must not see a hidden
 * one). Get started (or Escape) remembers it on this device, plays a short exit and hands over to the page.
 * The entrance is a time-based stagger (.pwa-welcome in globals.css); reduced motion gets a plain fade.
 *
 * Review fixes (1100): it decides in a layout effect, which runs before every popup's passive effect whatever the
 * tree order; hydrating cancels the head script's watchdog (if this script never runs, the head script lifts the
 * screen after 10 s so nobody is stuck on it); the page behind is inert while it shows; on the way out focus lands
 * on #main, never on <body>. Rendered only when Admin has it on (app/(studio)/layout.tsx).
 */
export function PwaWelcome({ config }: { config: WelcomeConfig }) {
  const user = useUser();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ssr");
  const box = useRef<HTMLDivElement>(null);
  const exit = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(exit.current), []);

  useIso(() => {
    const d = document.documentElement;
    const w = window as Window & { __owT?: number };
    window.clearTimeout(w.__owT); // hydrated: the head script's no-JS way out is no longer needed
    const done = () => {
      d.removeAttribute("data-welcome");
      window.dispatchEvent(new Event(WELCOMED_EVENT));
      setPhase("gone");
    };
    if (!config.enabled) return done();
    let seen = false;
    try {
      seen = !!localStorage.getItem(WELCOME_KEY);
    } catch {
      seen = true; // storage blocked: we could never remember it, so never show it
    }
    // Head script missed it (signed in, then a soft navigation into the studio): same test, here.
    if (!d.hasAttribute("data-welcome")) {
      const nav = navigator as Navigator & { standalone?: boolean };
      const ok = shouldWelcome({ standalone: matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches, iosStandalone: nav.standalone === true, appMode: d.hasAttribute("data-app"), referrer: document.referrer, path: location.pathname, seen });
      if (!ok) return setPhase("gone");
      d.setAttribute("data-welcome", "");
    } else if (seen) return done();
    setPhase("show");
  }, [config.enabled]);

  useEffect(() => {
    // The dialog itself takes focus, so screen readers read the welcome and no ring flashes on a tap launch;
    // Tab goes to Get started.
    if (phase === "show") box.current?.focus({ preventScroll: true });
  }, [phase]);

  const live = phase === "show" || phase === "leaving";
  useEffect(() => {
    // aria-modal alone leaks (iOS VoiceOver swipes into the dashboard): everything else on the page is inert.
    const me = box.current;
    if (!live || !me) return;
    const others = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(me) && !el.hasAttribute("inert"));
    for (const el of others) el.setAttribute("inert", "");
    // The welcome is inside the studio's root wrapper, so mark that wrapper's other children too.
    const sibs = me.parentElement && me.parentElement !== document.body ? [...me.parentElement.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== me && !el.hasAttribute("inert")) : [];
    for (const el of sibs) el.setAttribute("inert", "");
    return () => {
      for (const el of [...others, ...sibs]) el.removeAttribute("inert");
    };
  }, [live]);

  if (phase === "gone") return null;

  const leave = (how: Exit) => {
    if (phase !== "show") return;
    try {
      localStorage.setItem(WELCOME_KEY, new Date().toISOString());
    } catch {
      /* private mode: shows again next launch */
    }
    setPhase("leaving");
    // Navigate under the exit, so the new page is already there when the screen has faded.
    if (how === "connect") router.push("/accounts");
    if (how === "skip" && location.pathname !== "/home") router.push("/home");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    exit.current = window.setTimeout(() => {
      document.documentElement.removeAttribute("data-welcome");
      window.dispatchEvent(new Event(WELCOMED_EVENT));
      setPhase("gone");
      requestAnimationFrame(() => {
        // The tour takes focus itself; otherwise hand focus to the page, not <body> (inert is lifted first).
        if (how === "tour") startTour();
        else document.getElementById("main")?.focus({ preventScroll: true });
      });
    }, reduce ? 160 : WELCOME_EXIT_MS);
  };

  const name = user.workspace?.me.name ?? user.name;
  // A title that was only "{name}" would leave the dialog's label blank for someone without a name.
  const head = headlineParts(fillName(config.title, name).trim() || WELCOME_DEFAULT.title);
  const line = (t: string) => cn("pw-line", t.length <= HEADLINE_NOWRAP && "pw-nowrap");
  const last = head.tail ? `${head.tail} ${head.hl}` : head.hl;
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-pwa-welcome=""
      data-phase={phase}
      role={live ? "dialog" : undefined}
      aria-modal={live ? true : undefined}
      aria-labelledby="pw-title"
      aria-describedby="pw-body"
      onKeyDown={(e) => {
        if (e.key === "Escape") leave("start");
        if (e.key === "Enter" && e.target === box.current) leave("start");
        if (e.key === "Tab") {
          // Focus cycles through the screen's own controls, never onto the page behind or the browser chrome.
          const items = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
          if (!items.length) return;
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1;
          e.preventDefault();
          items[next].focus();
        }
      }}
      className="pwa-welcome"
    >
      <div className="pw-wrap">
        <header className="pw-top pw-a">
          <span className="pw-brand">
            <OutlyMark size={28} />
            Outlly
          </span>
          <button type="button" onClick={() => leave("start")} className="pw-x" aria-label="Close welcome">
            <X aria-hidden="true" />
          </button>
        </header>
        {/* Not a heading: the dialog is already labelled by it, and studio pages own their only h1. */}
        <p id="pw-title" className="pw-title pw-b">
          {head.lines.map((t, i) => (
            <span key={i} className={line(t)}>
              {t}{" "}
            </span>
          ))}
          <span className={line(last)}>
            {head.tail && `${head.tail} `}
            <span className="pw-hl">{head.hl}</span>
          </span>
        </p>
        <p id="pw-body" className="sr-only">
          {config.body}
        </p>
        <div className="pw-art pw-c">
          <WelcomeArt />
        </div>
        <div className="pw-actions">
          <button type="button" onClick={() => leave("start")} className="pw-cta pw-primary pw-d" style={stagger(0)}>
            <Rocket aria-hidden="true" />
            {config.button}
          </button>
          <button type="button" onClick={() => leave("connect")} className="pw-cta pw-ghost pw-d" style={stagger(1)}>
            <Link2 aria-hidden="true" />
            {config.connect}
          </button>
          <button type="button" onClick={() => leave("tour")} className="pw-cta pw-ghost pw-d" style={stagger(2)}>
            <PlayCircle aria-hidden="true" />
            {config.tour}
          </button>
          <button type="button" onClick={() => leave("skip")} className="pw-link pw-d" style={stagger(3)}>
            {config.skip}
          </button>
        </div>
      </div>
    </div>
  );
}
