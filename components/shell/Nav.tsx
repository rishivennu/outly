"use client";
import { HoverLink as Link } from "./HoverLink";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, BarChart3, CreditCard, LifeBuoy, CalendarDays, ClipboardCheck, Globe, Home, LayoutGrid, MessagesSquare, MoreHorizontal, Plus, Settings, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";
import { ThemeCycleButton, ThemeToggle } from "@/components/shared/ThemeToggle";
import { useUser } from "./UserContext";
import { NoticesBell } from "./NoticesBell";
import { PaletteButton } from "./PaletteButton";
import { LiveCount } from "@/components/shared/LiveCount";

const MAIN = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/content", label: "Content", icon: LayoutGrid },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
];

const TOUR: Record<string, string> = { "/home": "home", "/billing": "billing", "/support": "support", "/settings": "settings", "/create": "new-post", "/content": "content", "/calendar": "calendar", "/analytics": "analytics", "/inbox": "inbox", "/approvals": "approvals", "/accounts": "accounts" };

/** Exact route or one of its children: "/create" is active on "/create/bulk", never on "/creator". */
export function isActive(path: string | null, href: string) {
  if (!path) return false;
  return path === href || path.startsWith(`${href}/`);
}

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

export function Sidebar() {
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
          {[
            ...(user.workspace ? [] : [
              { href: "/accounts", label: "Connected accounts", icon: Link2 },
              { href: "/billing", label: "Billing", icon: CreditCard },
            ]),
            { href: "/support", label: "Help centre", icon: LifeBuoy },
            { href: "/settings", label: "Settings", icon: Settings },
          ].map(({ href, label, icon: Icon }) => {
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
          <div className="mt-2 flex items-center gap-2 rounded-2xl p-1.5 hairline">
            <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 hover:bg-secondary/60">
              {/* Teammates get their own stable orb; the owner's saved avatar is theirs alone. */}
              <OrbAvatar avatar={user.workspace ? null : user.avatar} seed={user.workspace?.me.email ?? user.email} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{user.workspace?.me.name ?? user.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{user.workspace ? `In ${user.workspace.ownerName}'s studio` : user.email}</span>
              </span>
            </Link>
            <NoticesBell placement="side" />
          </div>
        </div>
        </div>
      </aside>
    </div>
  );
}

// Phone tab bar: four destinations and More (Apple's tab-bar guidance: five at most, labels always on).
const TABS = ["/home", "/create", "/calendar", "/inbox"];

export function MobileNav() {
  const path = usePathname();
  const { workspace } = useUser();
  const [more, setMore] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const extra = [
    { href: "/content", label: "Content", icon: LayoutGrid },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ...(workspace ? [] : [{ href: "/accounts", label: "Connected accounts", icon: Link2 }, { href: "/billing", label: "Billing", icon: CreditCard }]),
    { href: "/support", label: "Help centre", icon: LifeBuoy },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/", label: "Outlly website", icon: Globe },
  ];
  // The page you are on lives under More: More is the selected tab (also while its panel is open).
  const moreActive = extra.some((x) => x.href !== "/" && isActive(path, x.href));

  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMore(false);
        btn.current?.focus();
      }
    };
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setMore(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", away);
    };
  }, [more]);

  // One rule for every tab (1053): green marks where you are, nothing else. Create used to stay green on
  // every page, so two tabs looked selected at once.
  const tab = "group flex h-14 min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const pill = (on: boolean) => cn("grid h-8 w-11 place-items-center rounded-full transition-[background-color,color,transform] duration-200 group-active:scale-90 motion-reduce:transition-none", on ? "lime-bg" : "group-hover:bg-foreground/[0.07]");
  return (
    <>
      <div
        ref={panel}
        id="more-panel"
        hidden={!more}
        className="web-only fixed inset-x-3 bottom-[calc(max(12px,env(safe-area-inset-bottom))+76px)] z-[56] max-h-[60dvh] bg-background/95 shadow-2xl backdrop-blur-xl hairline overflow-y-auto rounded-[28px] p-2 lg:hidden"
      >
        <ul className="grid grid-cols-1 gap-0.5 min-[400px]:grid-cols-2">
          {extra.map(({ href, label, icon: Icon }) => {
            const active = href !== "/" && isActive(path, href);
            return (
              <li key={href}>
                <Link href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className={cn("flex h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium", active ? "bg-secondary text-foreground" : "text-foreground/85 hover:bg-foreground/[0.05]")}>
                  <Icon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <nav aria-label="Primary" className="web-only lg-glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex h-[68px] items-center justify-around rounded-[28px] px-1 lg:hidden">
        {MAIN.filter((m) => TABS.includes(m.href)).map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href) && !more;
          return (
            <Link key={href} href={href} data-tour={TOUR[href]} aria-current={isActive(path, href) ? "page" : undefined} className={cn(tab, active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <span className={pill(active)}>
                <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
              </span>
              <span className={cn("text-[10.5px] leading-none", active ? "font-semibold" : "font-medium")}>{label}</span>
            </Link>
          );
        })}
        <button ref={btn} type="button" data-tour="more" aria-expanded={more} aria-controls="more-panel" onClick={() => setMore((m) => !m)} className={cn(tab, more || moreActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          <span className={cn(pill(moreActive || more), more && !moreActive && "!bg-secondary")}>
            <MoreHorizontal className="h-[19px] w-[19px]" strokeWidth={more || moreActive ? 2.4 : 1.9} aria-hidden="true" />
          </span>
          <span className="text-[10.5px] font-medium leading-none">More</span>
        </button>
      </nav>
    </>
  );
}

/** Phone top bar: brand, theme and notifications. Everything else moved to More in the tab bar. */
export function MobileTopBar() {
  return (
    <header className="web-only sticky top-0 z-30 flex border-b border-border/70 bg-background shadow-[0_10px_24px_-18px_rgb(0_0_0/0.6)] items-center justify-between gap-2 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] lg:hidden">
      <Link href="/home" className="flex min-h-11 min-w-0 shrink-0 items-center gap-2 rounded-2xl text-[16px]" aria-label="Outlly dashboard">
        {/* Hide on a wrapper: on the mark itself, its own "dark:block" outranks min-[480px]:hidden and both logos showed (1050). */}
        <span className="inline-flex min-[480px]:hidden">
          <OutlyMark size={26} />
        </span>
        <OutlyLogo className="hidden min-[480px]:inline-flex" />
      </Link>
      <div className="flex min-w-0 items-center gap-0.5">
        {/* One cycling button: the three-way switch made the row wider than a phone (10-12f). */}
        <LiveCount compact className="mr-1 max-[379px]:hidden" />
        <PaletteButton compact />
        <ThemeCycleButton />
        <NoticesBell placement="below" />
      </div>
    </header>
  );
}
