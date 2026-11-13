"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { OutlyLogo } from "@/components/brand/Logo";
import { NoticesBell } from "./NoticesBell";
import { PulseRail } from "./PulseRail";
import { MobileDrawer } from "./MobileDrawer";
import { MAIN, TOUR, isActive, pageTitle } from "./nav-items";

/**
 * Desktop sidebar: the collapsible rail for every dashboard style (1103). Classic and Analytics used to have
 * different sidebars; now only Home differs between them.
 */
export function Sidebar() {
  return <PulseRail />;
}

// Phone tab bar (1100): five destinations, labels always on (Apple's tab-bar guidance: five at most). Every other
// page and the account rows live in the top bar's menu drawer (MobileDrawer).
const TABS = ["/home", "/create", "/calendar", "/inbox", "/analytics"];

/**
 * Auto-hide (1105): scrolling down through a long page tucks the tab bar away; any scroll up, the top or the end
 * of the page, or a route change brings it back, and so does a page that shrinks to short. Short pages and reduced
 * motion never hide it, and nor does the page moving under the keyboard while you type. Hidden means inert at
 * once (no focus, nothing announced, even mid-slide) and visibility: hidden once it is off screen (globals.css).
 */
function useTuckOnScroll(path: string | null) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  const run = useRef(0);
  useEffect(() => {
    setHidden(false);
    last.current = window.scrollY;
    run.current = 0;
  }, [path]);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const typing = () => !!document.activeElement?.matches("input, textarea, select, [contenteditable]");
    const check = () => {
      raf = 0;
      const y = window.scrollY;
      const d = y - last.current;
      last.current = y;
      const end = document.documentElement.scrollHeight - window.innerHeight;
      if (still.matches || end < window.innerHeight * 0.75 || y < 80 || end - y < 80) {
        run.current = 0;
        return setHidden(false);
      }
      if (typing()) {
        run.current = 0;
        return;
      }
      run.current = Math.sign(d) === Math.sign(run.current) ? run.current + d : d;
      if (run.current > 48) setHidden(true);
      else if (run.current < -12) setHidden(false);
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
  return hidden;
}

/**
 * 1105 refinement, 1115 docked: a full-width bar flush with the bottom edge, one solid surface down under the home
 * indicator with a hairline on top (.mtab in globals.css), the five tabs a 480px row in the middle. 62px plus the
 * safe area. Five equal tabs, each at least 52 x 51px. The active tab
 * keeps the lime pill with a dark icon and a semibold label; the pill grows in place (300ms), colours move in
 * 250ms, labels in 200ms, a press dips the icon (150ms), and the bar rises in once (400ms), all on
 * cubic-bezier(0.16, 1, 0.3, 1).
 */
export function MobileNav() {
  const path = usePathname();
  const tabs = TABS.map((h) => MAIN.find((m) => m.href === h)!);
  const hidden = useTuckOnScroll(path);
  return (
    <nav aria-label="Primary" data-hidden={hidden ? "" : undefined} inert={hidden} className="mtab web-only fixed inset-x-0 bottom-0 z-40 flex items-stretch lg:hidden">
      {tabs.map(({ href, label, icon: Icon }) => {
        // One rule for every tab (1053): green marks where you are, nothing else.
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className="mtab-item group flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
            <span className="mtab-pill relative grid h-[30px] w-[52px] place-items-center">
              <span className="mtab-ind" aria-hidden="true" />
              <Icon className="relative h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="mtab-label whitespace-nowrap text-[12px] leading-[14px]">{label}</span>
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
