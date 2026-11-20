"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";
import { NoticesBell } from "./NoticesBell";
import { PulseRail } from "./PulseRail";
import { MobileDrawer } from "./MobileDrawer";
import { MAIN, TOUR, isActive, pageTitle } from "./nav-items";
import { TAB_SCROLL_START, hidesTabBar, slideIndex, slideLock, slideStretch, slideTarget, tabScrollStep, type TabScroll } from "@/lib/client/tab-bar";
import { haptic } from "@/lib/client/app-mode";
import { useHeaderScroll } from "@/lib/client/header-scroll";

/**
 * Desktop sidebar: the collapsible rail for every dashboard style (1103). Classic and Analytics used to have
 * different sidebars; now only Home differs between them.
 */
export function Sidebar() {
  return <PulseRail />;
}

// Phone tab bar (1100): five destinations (Apple's tab-bar guidance: five at most), icons only since 11-19 (the
// creator's call; the top bar names the section you are in, and each tab keeps its name for screen readers). Every
// other page and the account rows live in the top bar's menu drawer (MobileDrawer).
const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"];

/**
 * Compact on scroll (11-19, Instagram style; it replaced 1105's auto-hide, which slid the bar off screen): reading on
 * down a long page compacts the tab bar (labels fold away, the pill shrinks, .mtab[data-compact] in globals.css); any
 * scroll back up, the top or the end of the page, or a route change opens it again, and so does a page that shrinks
 * to short. Short pages and reduced motion never compact it, and nor does the page moving under the keyboard while
 * you type. The bar never leaves the screen. The rule itself is tabScrollStep (lib/client/tab-bar.ts), one step per
 * frame: scroll events coalesce into a single requestAnimationFrame, and a state that has not changed never renders.
 */
function useCompactOnScroll(path: string | null) {
  const [compact, setCompact] = useState(false);
  const s = useRef<TabScroll>(TAB_SCROLL_START);
  useEffect(() => {
    setCompact(false);
    s.current = { y: window.scrollY, run: 0, compact: false };
  }, [path]);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const typing = () => !!document.activeElement?.matches("input, textarea, select, [contenteditable]");
    const check = () => {
      raf = 0;
      const end = document.documentElement.scrollHeight - window.innerHeight;
      s.current = tabScrollStep(s.current, window.scrollY, end, window.innerHeight, { still: still.matches, typing: typing() });
      setCompact(s.current.compact);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const grew = new ResizeObserver(onScroll);
    grew.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      grew.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return compact;
}

/**
 * R1213 (11-19), finger-following tabs. Touch a tab and slide sideways: the lime pill (one element for the whole bar,
 * .mtab-ind) leaves the tab you are on and follows the finger, a soft liquid highlight (.mtab-ripple) rides under the
 * fingertip, the pill stretches a little in the direction of travel, and the tab nearest the finger lights up as you
 * cross into it (data-over, with a tick of haptics where the phone has them). Letting go snaps the pill to that tab
 * and opens it, once; letting go where you started, or a flick too short to cross a boundary, steps one tab on.
 * A finger that moves up or down instead is the page scrolling (touch-action: pan-y hands it to the browser, which
 * cancels the pointer) and nothing here fires; a plain tap stays a plain tap on the link. Everything the finger moves
 * is a CSS variable on the bar (--i the pill's tab, fractional while dragging; --fx the highlight's x; --sx the
 * stretch), so following it never renders React. Reduced motion keeps the slide (it is the control) and drops the
 * stretch and the ripple. The track the finger is measured against is the bar's inner width (inside the border and
 * --mtab-px), the same track .mtab-ind slides on, so the pill sits exactly under the finger in either bar size.
 */
function useSlideTabs(nav: RefObject<HTMLElement | null>, hrefs: string[], activeIdx: number, go: (href: string) => void) {
  type Gesture = { id: number; x0: number; y0: number; x: number; t: number; vx: number; lock: "h" | "v" | null; over: number; bx: number; left: number; w: number; scale: number };
  const g = useRef<Gesture | null>(null);
  // when the last drag let go: the click the browser sends right after it must not open the link under the finger too
  const dragEnd = useRef(0);
  const still = useRef(false);
  const timers = useRef<{ drop?: ReturnType<typeof setTimeout>; stretch?: ReturnType<typeof setTimeout> }>({});
  const n = hrefs.length;
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => void (still.current = m.matches);
    read();
    m.addEventListener("change", read);
    return () => m.removeEventListener("change", read);
  }, []);
  const set = (k: string, v: string) => nav.current?.style.setProperty(k, v);
  // The pill follows the tab you are on whenever a navigation lands (or does not: a redirect, a blocked route) and
  // no finger holds it; React alone would only rewrite --i when the active tab changes.
  useEffect(() => {
    if (!g.current) set("--i", String(Math.max(0, activeIdx)));
  }, [activeIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    clearTimeout(timers.current.drop);
    clearTimeout(timers.current.stretch);
  }, []);
  // The bar may be scaled (compact): finger x in the bar's own layout pixels.
  const fingerX = (s: Gesture, clientX: number) => `${((clientX - s.bx) / s.scale).toFixed(1)}px`;
  // The track: the bar's inner width (inside its border and --mtab-px), as .mtab-ind measures it.
  const measure = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const scale = r.width / (el.offsetWidth || r.width);
    const inset = ((parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.getPropertyValue("--mtab-px")) || 0)) * scale;
    return { bx: r.left, left: r.left + inset, w: r.width - 2 * inset, scale };
  };
  const markOver = (i: number) => nav.current?.querySelectorAll<HTMLElement>(".mtab-item").forEach((el, k) => el.toggleAttribute("data-over", k === i));
  const settle = (idx: number) => {
    const el = nav.current;
    if (!el) return;
    el.removeAttribute("data-drag");
    el.removeAttribute("data-press");
    set("--i", String(Math.max(0, idx)));
    set("--sx", "1");
    clearTimeout(timers.current.stretch);
    markOver(-1);
    g.current = null;
  };
  // The release ripple: a short bloom where the finger left the glass (restarted if the last one is still going).
  const drop = () => {
    const el = nav.current;
    if (!el || still.current) return;
    clearTimeout(timers.current.drop);
    el.removeAttribute("data-drop");
    void el.offsetWidth;
    el.setAttribute("data-drop", "");
    timers.current.drop = setTimeout(() => el.removeAttribute("data-drop"), 480);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = nav.current;
    if (e.button !== 0 || !el) return;
    // a gesture whose end never reached the bar (a mouse let go outside it) gives way to the new one
    if (g.current) settle(activeIdx);
    const m = measure(el);
    const s: Gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t: e.timeStamp, vx: 0, lock: null, over: Math.round(slideIndex(e.clientX, m.left, m.w, n)), ...m };
    g.current = s;
    set("--fx", fingerX(s, e.clientX));
    el.setAttribute("data-press", "");
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    const el = nav.current;
    if (!s || !el || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.lock) {
      s.lock = slideLock(dx, dy);
      if (s.lock === "h") {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
        Object.assign(s, measure(el)); // the bar may have compacted since the touch
        el.setAttribute("data-drag", "");
      } else if (s.lock === "v") el.removeAttribute("data-press");
    }
    if (s.lock !== "h") return;
    const fi = slideIndex(e.clientX, s.left, s.w, n);
    // speed, smoothed over the last few samples so one late event does not read as a stop
    s.vx = 0.6 * ((e.clientX - s.x) / Math.max(1, e.timeStamp - s.t)) + 0.4 * s.vx;
    s.x = e.clientX;
    s.t = e.timeStamp;
    // R1220: the pill fills the tab under the finger (magnetic), never rests between two icons; the glow (--fx) is
    // what follows the finger exactly.
    set("--i", String(Math.round(fi)));
    set("--fx", fingerX(s, e.clientX));
    if (!still.current) {
      set("--sx", slideStretch(s.vx).toFixed(3));
      // a finger that stops lets the pill relax
      clearTimeout(timers.current.stretch);
      timers.current.stretch = setTimeout(() => set("--sx", "1"), 90);
    }
    const near = Math.round(fi);
    if (near !== s.over) {
      s.over = near;
      markOver(near);
      haptic(5);
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    const el = nav.current;
    if (!s || !el || e.pointerId !== s.id) return;
    if (s.lock === "h") {
      const from = Math.round(slideIndex(s.x0, s.left, s.w, n));
      const target = slideTarget(slideIndex(e.clientX, s.left, s.w, n), from, e.clientX - s.x0, n, 24, s.vx);
      settle(target);
      dragEnd.current = e.timeStamp;
      if (target !== activeIdx) go(hrefs[target]!);
    } else {
      el.removeAttribute("data-press");
      g.current = null;
    }
    drop();
  };
  const onPointerCancel = () => settle(activeIdx);
  // a mouse or pen that leaves the bar before it has locked sideways is a press that came to nothing
  const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (s && s.lock !== "h" && e.pointerId === s.id) settle(activeIdx);
  };
  // R1220: a gesture whose end never reaches the bar (the page took the touch, the app went to the background, iOS
  // dropped the pointer) can't leave the pill parked where the finger last was: the window's own end events and a
  // hidden tab put it back on the current page.
  useEffect(() => {
    const end = () => {
      if (g.current) settle(activeIdx);
    };
    const hide = () => {
      if (document.visibilityState === "hidden") end();
    };
    // Bubble phase: the bar's own handler (React, on the root) has already finished the gesture by then, so this
    // only catches the ends it never saw.
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [activeIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // the click the browser sends after a drag must not open the link under the finger as well
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!dragEnd.current || e.timeStamp - dragEnd.current > 500) return;
    dragEnd.current = 0;
    e.preventDefault();
    e.stopPropagation();
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onClickCapture };
}

/**
 * 1105 refinement, 1115 docked, 11-19 floating, R1213 liquid glass: a pill 12px off the bottom edge and the sides
 * (plus the safe area, so it clears the home indicator and Android's gesture strip), never wider than 440px. Since
 * R1213 the pill is glass (.mtab in globals.css): the page shows through a blur and a light tint, a lit rim runs round
 * the edge, a sheen sits across the top and a soft shadow grounds it; icons keep 4.5:1 on the tint whatever scrolls
 * under. 60px tall, five equal icon-only tabs (22px icons on a 56 x 32 pill), each at least 50px tall and 56px wide
 * on the narrowest phone, named for screen readers by visually hidden text. One lime pill (.mtab-ind) marks the tab
 * you are on and glides to the next (350ms on cubic-bezier(0.16, 1, 0.3, 1)) instead of one pill fading out and
 * another fading in; a finger can also drag it across the bar (useSlideTabs). Reading on down a long page compacts
 * the bar (data-compact, 300ms): it drops to 56px and shrinks about its bottom centre to 92%, every tab still at
 * least 44 x 56px on screen. It never leaves the screen.
 */
export function MobileNav() {
  const path = usePathname();
  const router = useRouter();
  const tabs = TABS.map((h) => MAIN.find((m) => m.href === h)!);
  const folded = useCompactOnScroll(path);
  // A page may opt out of the tab bar (lib/client/tab-bar.ts; none does since 11-16, /create's post actions bar
  // now sits above the tabs). The studio layout then drops the room it keeps for the bar (data-tabbar-off below).
  const off = hidesTabBar(path);
  const compact = folded && !off;
  // 1154: Pip (ChatWidget .pc-dock) steps aside while the bar is compact (you are reading on), so the foot of the
  // page is clear; it is back the moment the bar opens.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-tabs-compact", compact);
    return () => document.documentElement.removeAttribute("data-tabs-compact");
  }, [compact]);
  // One rule for every tab (1053): green marks where you are, nothing else. A page outside the five (Content,
  // Settings) has no pill (data-none) until a finger brings one in.
  const activeIdx = tabs.findIndex((t) => isActive(path, t.href));
  const nav = useRef<HTMLElement | null>(null);
  const slide = useSlideTabs(nav, TABS, activeIdx, (href) => router.push(href));
  if (off) return <span hidden data-tabbar-off="" />;
  return (
    <nav
      ref={nav}
      aria-label="Primary"
      data-compact={compact ? "" : undefined}
      data-none={activeIdx < 0 ? "" : undefined}
      style={{ ["--i" as string]: Math.max(0, activeIdx), ["--n" as string]: tabs.length }}
      className="mtab web-only fixed inset-x-0 z-40 flex items-stretch lg:hidden"
      {...slide}
    >
      <span className="mtab-ind" aria-hidden="true" />
      <span className="mtab-ripple" aria-hidden="true" />
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} draggable={false} className="mtab-item group flex min-w-0 flex-1 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
            <span className="mtab-pill relative grid h-[32px] w-[56px] place-items-center">
              <Icon className="relative h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone top bar (1105): three parts. Left the logo, centre the section you are in (it cross-fades as you move,
 * 250ms), right the notices bell and the menu. Search, the theme switch and Account live in the menu drawer, so
 * the bar stays as light as the tab bar. 52px tall plus the top safe area, which only this bar pads (the drawer
 * pads its own, being a separate layer), so it is never applied twice.
 * 1099: no box. At rest it sits on the page background (the same colour the status bar is painted, see
 * lib/theme/colors.ts), with no border or shadow; R1284: once content scrolls under it the bar takes the page colour
 * and a soft fade sits under it (.mtop, R1284 in globals.css). One 44px button size, 20px icons. R1214: the bell and the menu are the shared
 * .gbtn-icon buttons; R1284 strips their glass inside the bar (bare icons, a tonal fill only while touched). The brand is the
 * rocket and wordmark, the rocket alone under 360px (.mtop-brand-*).
 * R1216: the bar follows the scroll (lib/client/header-scroll.ts): moving down the page folds it away
 * (data-folded, a 300ms translate in globals.css), moving back brings it in, at the top it always shows. One
 * listener here for every mobile route and for pages that scroll in their own container; nothing else changed.
 */
export function MobileTopBar() {
  const path = usePathname();
  const title = pageTitle(path);
  const bar = useRef<HTMLElement>(null);
  const { lifted, hidden } = useHeaderScroll(path, bar);
  return (
    <header ref={bar} data-mtop="" data-lifted={lifted ? "" : undefined} data-folded={hidden ? "" : undefined} className="mtop web-only sticky top-0 z-30 lg:hidden">
      <div className="mtop-row grid h-[52px] grid-cols-[1fr_auto_1fr] items-center gap-2 pl-3 pr-1.5 min-[400px]:pl-4 min-[400px]:pr-2.5">
        <Link href="/home" className="mtop-logo flex h-11 min-w-11 items-center justify-self-start rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Outlly dashboard">
          <span className="mtop-brand-full inline-flex"><OutlyLogo size={22} /></span>
          <span className="mtop-brand-mark"><OutlyMark size={22} /></span>
        </Link>
        <span key={title} className="mtop-title max-w-[40vw] truncate text-[16px] font-medium tracking-[-0.01em] text-foreground">
          {title}
        </span>
        <div className="flex items-center gap-2 justify-self-end">
          <NoticesBell placement="below" className="mtop-btn gbtn-icon ripple-host" />
          <MobileDrawer className="mtop-btn gbtn-icon ripple-host" />
        </div>
      </div>
    </header>
  );
}
