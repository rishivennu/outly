"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { OutlyMark } from "@/components/brand/Logo";
import { useUser } from "./UserContext";
import { WELCOMED_EVENT, WELCOME_KEY, fillName, shouldWelcome, type WelcomeConfig } from "@/lib/pwa-welcome";

type Phase = "ssr" | "show" | "leaving" | "gone";
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const at = (i: number) => ({ ["--i" as string]: i }) as React.CSSProperties;

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
  const [phase, setPhase] = useState<Phase>("ssr");
  const btn = useRef<HTMLButtonElement>(null);
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

  const start = () => {
    if (phase !== "show") return;
    try {
      localStorage.setItem(WELCOME_KEY, new Date().toISOString());
    } catch {
      /* private mode: shows again next launch */
    }
    setPhase("leaving");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    exit.current = window.setTimeout(() => {
      document.documentElement.removeAttribute("data-welcome");
      window.dispatchEvent(new Event(WELCOMED_EVENT));
      setPhase("gone");
      // Hand focus to the page, not <body>, so a keyboard user starts at the dashboard (inert is lifted first).
      requestAnimationFrame(() => document.getElementById("main")?.focus({ preventScroll: true }));
    }, reduce ? 160 : 460);
  };

  const name = user.workspace?.me.name ?? user.name;
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
        if (e.key === "Escape") start();
        if (e.key === "Enter" && e.target === box.current) start();
        if (e.key === "Tab") {
          // One control: focus stays on it both ways, never on the page behind. This also keeps Tab off the
          // browser chrome while the screen is up; Escape or Get started is always the way out.
          e.preventDefault();
          btn.current?.focus();
        }
      }}
      className="pwa-welcome"
    >
      <div className="pw-glow" aria-hidden="true" />
      <div className="pw-inner">
        <div className="pw-mark pw-in" style={at(0)}>
          <span className="pw-ring" aria-hidden="true" />
          <OutlyMark size={52} tone="dark" />
        </div>
        <p className="pw-kicker pw-in" style={at(1)}>Outlly</p>
        <h1 id="pw-title" className="pw-title pw-in" style={at(2)}>
          {fillName(config.title, name)}
        </h1>
        <p id="pw-body" className="pw-body pw-in" style={at(3)}>
          {config.body}
        </p>
        {config.points.length > 0 && (
          <ul className="pw-points">
            {config.points.map((p, i) => (
              <li key={i} className="pw-in" style={at(4 + i)}>
                <span className="pw-tick" aria-hidden="true">
                  <Check strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pw-foot pw-in" style={at(5 + config.points.length)}>
        <button ref={btn} type="button" onClick={start} className="pw-cta lime-bg">
          {config.button}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
