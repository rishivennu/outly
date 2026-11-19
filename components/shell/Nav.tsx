"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { OutlyLogo } from "@/components/brand/Logo";
import { NoticesBell } from "./NoticesBell";
import { PulseRail } from "./PulseRail";
import { MobileDrawer } from "./MobileDrawer";
import { MAIN, TOUR, isActive, pageTitle } from "./nav-items";
import { TAB_SCROLL_START, hidesTabBar, tabScrollStep, type TabScroll } from "@/lib/client/tab-bar";

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
 * 1105 refinement, 1115 docked, 11-19 floating: a pill 12px off the bottom edge and the sides (plus the safe area, so
 * it clears the home indicator and Android's gesture strip), never wider than 440px, solid in the theme's surface
 * colour with a hairline all round and a soft shadow (.mtab in globals.css). 60px tall, five equal icon-only tabs
 * (22px icons on a 56 x 32 pill), each at least 50px tall and 56px wide on the narrowest phone, named for screen
 * readers by visually hidden text. The active tab keeps the lime pill with a dark icon; the pill grows in place
 * (300ms), colours move in 250ms, a press dips the icon (150ms), and the bar rises in once (400ms), all on
 * cubic-bezier(0.16, 1, 0.3, 1). Reading on down a long page compacts it (data-compact, 300ms): the bar drops to
 * 56px and shrinks about its bottom centre to 92%, every tab still at least 44 x 56px on screen.
 */
export function MobileNav() {
  const path = usePathname();
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
  if (off) return <span hidden data-tabbar-off="" />;
  return (
    <nav aria-label="Primary" data-compact={compact ? "" : undefined} className="mtab web-only fixed inset-x-0 z-40 flex items-stretch lg:hidden">
      {tabs.map(({ href, label, icon: Icon }) => {
        // One rule for every tab (1053): green marks where you are, nothing else.
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className="mtab-item group flex min-w-0 flex-1 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
            <span className="mtab-pill relative grid h-[32px] w-[56px] place-items-center">
              <span className="mtab-ind" aria-hidden="true" />
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
 * lib/theme/colors.ts), with no border or shadow; once content scrolls under it a frosted layer and a hairline
 * fade in (.mtop in globals.css). One 44px button size, 20px icons.
 */
export function MobileTopBar() {
  const path = usePathname();
  const title = pageTitle(path);
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      setLifted(window.scrollY > 2);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <header data-mtop="" data-lifted={lifted ? "" : undefined} className="mtop web-only sticky top-0 z-30 lg:hidden">
      <div className="mtop-row grid h-[52px] grid-cols-[1fr_auto_1fr] items-center gap-2 pl-3 pr-1.5 min-[400px]:pl-4 min-[400px]:pr-2.5">
        <Link href="/home" className="mtop-logo flex h-11 min-w-11 items-center justify-self-start rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Outlly dashboard">
          <OutlyLogo size={22} />
        </Link>
        <span key={title} className="mtop-title max-w-[40vw] truncate text-[16px] font-medium tracking-[-0.01em] text-foreground">
          {title}
        </span>
        <div className="flex items-center justify-self-end">
          <NoticesBell placement="below" className="mtop-btn" />
          <MobileDrawer className="mtop-btn" />
        </div>
      </div>
    </header>
  );
}
