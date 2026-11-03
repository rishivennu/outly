"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeCycleButton } from "@/components/shared/ThemeToggle";
import { NoticesBell } from "./NoticesBell";
import { PaletteButton } from "./PaletteButton";
import { LiveCount } from "@/components/shared/LiveCount";
import { PulseRail } from "./PulseRail";
import { MobileDrawer } from "./MobileDrawer";
import { MAIN, TOUR, isActive } from "./nav-items";

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

export function MobileNav() {
  const path = usePathname();
  const tabs = TABS.map((h) => MAIN.find((m) => m.href === h)!);
  // One rule for every tab (1053): green marks where you are, nothing else. Create used to stay green on
  // every page, so two tabs looked selected at once.
  const tab = "group flex h-14 min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const pill = (on: boolean) => cn("grid h-8 w-11 place-items-center rounded-full transition-[background-color,color,transform] duration-200 group-active:scale-90 motion-reduce:transition-none", on ? "lime-bg" : "group-hover:bg-foreground/[0.07]");
  return (
    <nav aria-label="Primary" className="mtab web-only lg-glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex h-[68px] items-center justify-around rounded-[28px] px-1 lg:hidden">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        return (
          <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className={cn(tab, active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <span className={pill(active)}>
              <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
            </span>
            <span className={cn("text-[10.5px] leading-none", active ? "font-semibold" : "font-medium")}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phone top bar: brand, search, theme, notifications and the menu (1100: the drawer replaced the tab bar's More;
 * 1103: the theme button is back on the bar, one tap, and the drawer keeps the full switch too).
 * 1099: no box. At rest it sits on the page background with no border or shadow; once content scrolls under
 * it a frosted layer and a hairline fade in (.mtop in globals.css). One 44px button size, 20px icons.
 */
export function MobileTopBar() {
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
      <div className="mtop-row flex h-14 items-center justify-between gap-2 pl-3 pr-1.5 min-[400px]:pl-4 min-[400px]:pr-2.5">
        <Link href="/home" className="flex h-11 min-w-11 shrink-0 items-center rounded-full px-1.5 text-[17px] transition-opacity duration-150 active:opacity-60" aria-label="Outlly dashboard">
          <OutlyLogo size={24} />
        </Link>
        <div className="flex min-w-0 items-center">
          <LiveCount compact className="mr-0.5 max-[359px]:hidden" />
          <PaletteButton compact className="mtop-btn" />
          <ThemeCycleButton className="mtop-btn" />
          <NoticesBell placement="below" className="mtop-btn" />
          <MobileDrawer className="mtop-btn" />
        </div>
      </div>
    </header>
  );
}
