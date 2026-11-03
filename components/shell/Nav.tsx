"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, Globe, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutlyLogo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { useUser } from "./UserContext";
import { NoticesBell } from "./NoticesBell";
import { SignOutButton } from "./SignOutButton";
import { PaletteButton } from "./PaletteButton";
import { LiveCount } from "@/components/shared/LiveCount";
import { PulseRail } from "./PulseRail";
import { MobileDrawer } from "./MobileDrawer";
import { MAIN, TOUR, isActive, workspaceItems } from "./nav-items";
import type { DashboardStyle } from "@/lib/dashboard-config";

export { isActive } from "./nav-items";
/**
 * Marks a scroll box with data-scrolling while it moves and for a moment after (1064), so its slim scrollbar
 * (.nav-scroll in globals.css) can show a little more while in use and fade back when idle.
 */
function useScrolling() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      if (!el.hasAttribute("data-scrolling")) el.setAttribute("data-scrolling", "");
      if (t) clearTimeout(t);
      t = setTimeout(() => el.removeAttribute("data-scrolling"), 800);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => {
      el.removeEventListener("scroll", on);
      if (t) clearTimeout(t);
    };
  }, []);
  return ref;
}

export function Sidebar({ variant = "classic" }: { variant?: DashboardStyle }) {
  return variant === "pulse" ? <PulseRail /> : <ClassicSidebar />;
}

function ClassicSidebar() {
  const path = usePathname();
  const user = useUser();
  const studio = MAIN.filter((m) => m.href !== "/create");
  const scroller = useScrolling();
  return (
    <div className="sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
      <aside data-route-order="" className="lg-glass flex h-full w-[240px] flex-col overflow-hidden rounded-[28px]" aria-label="Primary">
        <div ref={scroller} data-lenis-prevent className="nav-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 pt-5 [&>*]:shrink-0">
        <Link href="/home" className="mb-6 flex min-h-11 items-center gap-2 rounded-2xl px-2 text-[18px] transition-opacity hover:opacity-80" aria-label="Outlly dashboard" title="Dashboard">
          <OutlyLogo size={30} />
        </Link>

        <Link
          href="/create"
          data-tour="new-post"
          aria-current={isActive(path, "/create") ? "page" : undefined}
          className="lime-glow group mb-3 flex h-12 items-center gap-2.5 rounded-2xl bg-lime px-4 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-px active:scale-[0.98]"
        >
          <Plus className="h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-90" strokeWidth={2.6} aria-hidden="true" />
          New post
        </Link>
        <PaletteButton />

        <p className="eyebrow mb-2 px-3 text-[11px]">Studio</p>
        <nav className="flex flex-col gap-0.5">
          {studio.map(({ href, label, icon: Icon }) => {
            const active = isActive(path, href);
            return (
              <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className={cn("group relative flex h-11 items-center gap-3 rounded-2xl px-3 text-[14.5px] font-medium transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-secondary" transition={{ type: "spring", stiffness: 520, damping: 42 }}>
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lime" />
                  </motion.span>
                )}
                <Icon className={cn("relative h-[18px] w-[18px] transition-transform duration-200 group-hover:scale-110", active && "text-lime-ink")} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-0.5 pt-6">
          <p className="eyebrow mb-2 px-3 text-[11px]">Workspace</p>
          {workspaceItems(!!user.workspace).map(({ href, label, icon: Icon }) => {
            // 1065: the same gliding pill as the Studio list (one layoutId), so the selection travels between
            // the two groups instead of one item blinking off and another blinking on.
            const active = isActive(path, href);
            return (
              <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className={cn("group relative flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-2xl bg-secondary" transition={{ type: "spring", stiffness: 520, damping: 42 }}>
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lime" />
                  </motion.span>
                )}
                <Icon className={cn("relative h-4 w-4 transition-transform duration-200 group-hover:scale-110", active && "text-lime-ink")} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
          <Link href="/" className="group flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] text-muted-foreground transition-colors duration-200 hover:bg-foreground/[0.04] hover:text-foreground">
            <Globe className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Outlly website
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </Link>
          <ThemeToggle compact plain className="mb-1 mt-2 self-start" />
          <div className="mt-2 flex items-center gap-0.5 rounded-2xl p-1.5 hairline">
            <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 hover:bg-secondary/60">
              {/* Teammates get their own stable orb; the owner's saved avatar is theirs alone. */}
              <OrbAvatar avatar={user.workspace ? null : user.avatar} seed={user.workspace?.me.email ?? user.email} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{user.workspace?.me.name ?? user.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{user.workspace ? `In ${user.workspace.ownerName}'s studio` : user.email}</span>
              </span>
            </Link>
            <NoticesBell placement="side" />
            <SignOutButton />
          </div>
        </div>
        </div>
      </aside>
    </div>
  );
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
 * Phone top bar: brand, search, notifications and the menu (1100: the drawer replaced the tab bar's More, and the
 * theme switch moved into it).
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
          <NoticesBell placement="below" className="mtop-btn" />
          <MobileDrawer className="mtop-btn" />
        </div>
      </div>
    </header>
  );
}
