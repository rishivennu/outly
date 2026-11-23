"use client";
import { StarField } from "@/components/marketing/StarField";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, Award, BarChart3, BadgePercent, BellRing, ShieldAlert, CalendarDays, Gift, BadgeCheck, BookOpen, ChevronRight, Construction, FlaskConical, HeartPulse, Headset, Hourglass, Library, Newspaper, Rocket, PanelsTopLeft, PanelBottom, PanelLeftClose, PanelLeftOpen, Presentation, CreditCard, Globe, Handshake, Share2, SlidersHorizontal, Smartphone, Sparkles, LayoutDashboard, LayoutTemplate, LifeBuoy, LogOut, Mail, Megaphone, Menu, Palette, Plug, Repeat, ShieldCheck, Tag, TrendingUp, Type, Users, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutllyBrand, OutlyMark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ContrastToggle } from "@/components/shared/ContrastToggle";
import { can, ROLE_LABEL, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { Bell } from "./Bell";
import { ScrollArea } from "./ScrollArea";
import { Tooltip } from "./ui";
import { Button } from "@/components/ui/button";
import { FX, T } from "@/lib/motion/tokens";
import { useHeaderScroll } from "@/lib/client/header-scroll";
import { AdminTabBar } from "./AdminTabBar";
import { AdminCommand } from "./AdminCommand";
import { AdminDock } from "./AdminDock";

/** 1163: five groups. Run is the daily console, Insights is read-only analysis, Setup is configuration, Administration is who may do what. */
export type NavGroup = "Run" | "Insights" | "Content Studio" | "Support" | "Setup" | "Administration";
export const NAV_GROUPS: readonly NavGroup[] = ["Run", "Insights", "Content Studio", "Support", "Setup", "Administration"];

export const NAV: { href: string; label: string; icon: typeof Users; area: AdminArea; group: NavGroup }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, area: "overview", group: "Run" },
  { href: "/admin/users", label: "Users", icon: Users, area: "users", group: "Run" },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, area: "payments", group: "Run" },
  { href: "/admin/pricing", label: "Pricing", icon: Tag, area: "pricing", group: "Run" },
  { href: "/admin/campaigns", label: "Offers", icon: BadgePercent, area: "pricing", group: "Run" },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: Repeat, area: "pricing", group: "Run" },
  { href: "/admin/plans", label: "Plan grants", icon: BadgeCheck, area: "plans", group: "Run" },
  { href: "/admin/ai-usage", label: "AI usage", icon: Sparkles, area: "users", group: "Run" },
  { href: "/admin/referrals", label: "Refer & Earn", icon: Gift, area: "referrals", group: "Run" },
  { href: "/admin/partners", label: "Creator Partnerships", icon: Handshake, area: "partners", group: "Run" },
  { href: "/admin/health", label: "System Health", icon: ShieldAlert, area: "health", group: "Run" },
  { href: "/admin/behavior", label: "User behavior", icon: Activity, area: "insights", group: "Insights" },
  { href: "/admin/retention", label: "At risk", icon: HeartPulse, area: "retention", group: "Insights" },
  { href: "/admin/growth", label: "Growth", icon: Rocket, area: "growth", group: "Insights" },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, area: "growth", group: "Insights" },
  { href: "/admin/app-analytics", label: "App Analytics", icon: Smartphone, area: "appAnalytics", group: "Insights" },
  { href: "/admin/workshops", label: "Workshops", icon: Presentation, area: "workshops", group: "Content Studio" },
  { href: "/admin/blog", label: "Blog dashboard", icon: Newspaper, area: "content", group: "Content Studio" },
  { href: "/admin/blog/generate", label: "Generate blog", icon: Wand2, area: "content", group: "Content Studio" },
  { href: "/admin/blog/library", label: "Blog library", icon: Library, area: "content", group: "Content Studio" },
  { href: "/admin/blog/calendar", label: "Content calendar", icon: CalendarDays, area: "content", group: "Content Studio" },
  { href: "/admin/blog/seo", label: "SEO performance", icon: TrendingUp, area: "content", group: "Content Studio" },
  { href: "/admin/blog/settings", label: "Blog settings", icon: SlidersHorizontal, area: "content", group: "Content Studio" },
  { href: "/admin/tickets", label: "Tickets", icon: LifeBuoy, area: "tickets", group: "Support" },
  { href: "/admin/live-assist", label: "Live Support", icon: Headset, area: "live", group: "Support" },
  { href: "/admin/faq", label: "FAQ", icon: BookOpen, area: "faq", group: "Support" },
  { href: "/admin/outbox", label: "Email outbox", icon: Mail, area: "outbox", group: "Support" },
  { href: "/admin/integrations", label: "Integrations", icon: Plug, area: "integrations", group: "Setup" },
  { href: "/admin/platforms", label: "Social platforms", icon: Share2, area: "platforms", group: "Setup" },
  { href: "/admin/landing", label: "Landing page", icon: PanelsTopLeft, area: "site", group: "Setup" },
  { href: "/admin/mascot", label: "Mascot colours", icon: Palette, area: "site", group: "Setup" },
  { href: "/admin/fonts", label: "Site fonts", icon: Type, area: "site", group: "Setup" },
  { href: "/admin/dashboard", label: "Dashboard style", icon: LayoutTemplate, area: "site", group: "Setup" },
  { href: "/admin/notifications", label: "Notifications", icon: BellRing, area: "site", group: "Setup" },
  { href: "/admin/updates", label: "Update notice", icon: Megaphone, area: "site", group: "Setup" },
  { href: "/admin/maintenance", label: "Maintenance", icon: Construction, area: "site", group: "Setup" },
  { href: "/admin/perf", label: "Startup speed", icon: Activity, area: "site", group: "Setup" },
  { href: "/admin/waitlist", label: "Waitlist", icon: Hourglass, area: "site", group: "Setup" },
  { href: "/admin/beta", label: "Beta program", icon: FlaskConical, area: "site", group: "Setup" },
  { href: "/admin/founding", label: "Founding members", icon: Award, area: "site", group: "Setup" },
  { href: "/admin/team", label: "Team & roles", icon: ShieldCheck, area: "team", group: "Administration" },
];

/** Remembered per browser: the icon-only sidebar is a preference, not a page state. */
export const SLIM_KEY = "admin:nav:slim";

/** R1290: the desktop layout, also per browser: the grouped sidebar (default) or the dock along the bottom. */
export const ADMIN_NAV_KEY = "admin:nav:style";
export type AdminNavStyle = "sidebar" | "dock";
export const readNavStyle = (v: string | null): AdminNavStyle => (v === "dock" ? "dock" : "sidebar");

/** Touch screens focus a tapped button, which would leave its focus-within tooltip standing; there the label is aria only. */
const TOUCH_TIP = "[@media(hover:none)]:[&>.admin-tip]:!hidden";

/** R1269: the phone drawer arrives like the studio one: a short slide plus fade on the card time, out quicker than in. */
const DRAWER_FX = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: T.card },
  exit: { opacity: 0, x: 24, transition: T.menuExit },
};

/** Longest matching entry wins, so /admin/blog/library lights "Blog library" and not "Blog dashboard" as well. */
export const active = (path: string, href: string) => {
  if (href === "/admin") return path === "/admin";
  if (path !== href && !path.startsWith(href + "/")) return false;
  return !NAV.some((n) => n.href !== href && n.href.length > href.length && (path === n.href || path.startsWith(n.href + "/")));
};

/**
 * Slim-mode tooltips. The nav sits in a scroller, which would clip a CSS tooltip popping out to its right, so the
 * hovered or focused item reports where it is and one fixed-position tooltip is drawn outside the scroller.
 */
type SlimTip = { show: (el: HTMLElement, text: string) => void; hide: () => void };
function useSlimTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const api: SlimTip = {
    show: (el, text) => {
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.right + 10, y: r.top + r.height / 2 });
    },
    hide: () => setTip(null),
  };
  const node = tip ? (
    <span role="tooltip" aria-hidden className="admin-tip admin-tip--fixed" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </span>
  ) : null;
  return { api, node };
}

/** One row of the sidebar. In slim mode the label becomes a tooltip to the right and a badge becomes a lime dot. */
function NavItem({ href, label, icon: Icon, on, n, slim, onNavigate, layoutId, tip }: { href: string; label: string; icon: typeof Users; on: boolean; n: number; slim: boolean; onNavigate?: () => void; layoutId: string; tip?: SlimTip }) {
  const text = n > 0 ? `${label} (${n} open)` : label;
  // R1292: reduced motion swaps the colour in place; the lime fill does not travel between rows.
  const still = useReducedMotion();
  const hover = slim && tip ? { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => tip.show(e.currentTarget, text), onPointerLeave: tip.hide, onFocus: (e: React.FocusEvent<HTMLElement>) => tip.show(e.currentTarget, text), onBlur: tip.hide } : {};
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={on ? "page" : undefined}
      aria-label={slim && n > 0 ? `${label}, ${n} open` : undefined}
      {...hover}
      className={cn("group relative flex h-11 items-center rounded-2xl text-[14px] font-medium outline-none transition-colors duration-nav ease-out motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:h-10", slim ? "w-11 justify-center lg:w-10" : "gap-3 px-3", on ? "text-lime-foreground" : "text-foreground/60 [@media(hover:hover)]:hover:bg-secondary/60 [@media(hover:hover)]:hover:text-foreground")}
    >
      {on && (
        <motion.span layoutId={still ? undefined : layoutId} className="absolute inset-0 rounded-2xl bg-lime shadow-[0_6px_18px_-6px_hsl(var(--lime)/.5)]" transition={T.nav} />
      )}
      <Icon className={cn("relative h-[17px] w-[17px] shrink-0 transition-transform duration-200 motion-reduce:transition-none [@media(hover:hover)]:group-hover:scale-110")} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
      <span className={cn("relative truncate", slim && "sr-only")}>{label}</span>
      {n > 0 && !slim && (
        <span className={cn("relative ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold", on ? "bg-lime-foreground text-lime" : "bg-lime text-[hsl(var(--lime-foreground))]")} aria-label={`${n} open`}>
          {n > 99 ? "99+" : n}
        </span>
      )}
      {n > 0 && slim && <span className={cn("absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2", on ? "bg-lime-foreground ring-lime" : "bg-lime ring-card")} aria-hidden />}
    </Link>
  );
}

function NavList({ role, path, badges, onNavigate, layoutId, slim = false, tip }: { role: AdminRole; path: string; badges: Partial<Record<AdminArea, number>>; onNavigate?: () => void; layoutId: string; slim?: boolean; tip?: SlimTip }) {
  const items = NAV.filter((n) => can(role, n.area));
  return (
    <nav aria-label="Admin" className={cn("flex flex-col", slim ? "items-center gap-3" : "gap-4")}>
      {NAV_GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className={cn(slim && "flex flex-col items-center gap-1 border-t border-border/60 pt-3 first:border-0 first:pt-0")}>
            <p className={cn("mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground", slim && "sr-only")}>{g}</p>
            <div className="flex flex-col gap-1">
              {list.map(({ href, label, icon, area }) => (
                <NavItem key={href} href={href} label={label} icon={icon} on={active(path, href)} n={badges[area] ?? 0} slim={slim} onNavigate={onNavigate} layoutId={layoutId} tip={tip} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Account controls, always at the bottom of the sidebar and never inside the scrolling list (1163). */
function Footer({ admin, path, onNavigate, slim = false, onDock }: { admin: { name: string; role: AdminRole }; path: string; onNavigate?: () => void; slim?: boolean; onDock?: () => void }) {
  const mine = path === "/admin/account";
  const dockBtn = onDock && (
    <Tooltip text="Switch to the dock" side={slim ? "right" : "top"} className={cn("flex", TOUCH_TIP)}>
      <Button type="button" variant="ghost" size="icon" onClick={onDock} aria-label="Switch to the dock" data-admin-nav-switch="" className="text-muted-foreground lg:h-10 lg:w-10">
        <PanelBottom className="h-4 w-4" aria-hidden />
      </Button>
    </Tooltip>
  );
  const signOut = (
    <form action="/api/admin/logout" method="post" className="shrink-0">
      <Button type="submit" variant="ghost" size="icon" className="lg:h-10 lg:w-10" aria-label="Sign out">
        <LogOut className="h-4 w-4" aria-hidden />
      </Button>
    </form>
  );
  if (slim) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border/60 px-3 pb-3 pt-3">
        <Tooltip text="My account" side="right" className="flex">
          <Link href="/admin/account" onClick={onNavigate} aria-current={mine ? "page" : undefined} aria-label={`My account, ${admin.name}`} className={cn("grid h-11 w-11 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-10 lg:w-10", mine && "bg-lime")}>
            <OrbAvatar seed={admin.name} size={28} />
          </Link>
        </Tooltip>
        <Tooltip text="Sign out" side="right" className="flex">
          {signOut}
        </Tooltip>
        {dockBtn}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 px-3 pb-3 pt-3">
      <div className="flex items-center gap-1">
        <ThemeToggle compact plain />
        {dockBtn}
        <Tooltip text="View the site" side="top" className="ml-auto flex">
          <Link href="/" aria-label="View the site" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
            <Globe className="h-4 w-4" aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <ContrastToggle className="min-h-11 w-full justify-start" />
      <div className="flex items-center gap-1 rounded-2xl bg-secondary/40 p-1.5">
        <Link href="/admin/account" onClick={onNavigate} aria-current={mine ? "page" : undefined} className={cn("group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", mine ? "bg-lime text-lime-foreground" : "[@media(hover:hover)]:hover:bg-secondary")}>
          <OrbAvatar seed={admin.name} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{admin.name}</span>
            <span className={cn("block truncate text-[11.5px]", mine ? "text-lime-foreground/70" : "text-muted-foreground")}>{ROLE_LABEL[admin.role]} · My account</span>
          </span>
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", mine ? "text-lime-foreground/70" : "text-muted-foreground")} aria-hidden />
        </Link>
        <Tooltip text="Sign out" side="top" className={cn("flex", TOUCH_TIP)}>
          {signOut}
        </Tooltip>
      </div>
    </div>
  );
}

export function AdminShell({ admin, badges, children }: { admin: { name: string; role: AdminRole }; badges: Partial<Record<AdminArea, number>>; children: React.ReactNode }) {
  const path = usePathname();
  // 1191: the live console is a dense working screen, so the brand stars stay off it; the panel's own
  // palette and corner glow (.sky-host) are unchanged, so it still matches every other admin page.
  const quiet = path === "/admin/live-assist";
  const [open, setOpen] = useState(false);
  // Slim starts false on both server and client (no hydration mismatch), then reads the saved preference.
  const [slim, setSlim] = useState(false);
  const slimTip = useSlimTip();
  const reduce = useReducedMotion();
  const top = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  // Opened by a tap, focus lands on the panel itself (no ring, no tooltip); from the keyboard, on its first control.
  const byPointer = useRef(false);
  // R1274: the drawer opens from the header menu or from the tab bar's More; focus goes back to whichever opened it.
  const moreBtn = useRef<HTMLButtonElement>(null);
  const fromTab = useRef(false);
  // R1269: the phone and tablet bar folds away on the way down and comes back on the way up (the studio's own hook).
  const { lifted, hidden } = useHeaderScroll(path, top);
  useEffect(() => setOpen(false), [path]);
  // Rotating a tablet past the desktop breakpoint swaps in the sidebar; never leave an invisible modal behind.
  useEffect(() => {
    if (!open) return;
    const mq = matchMedia("(min-width: 1024px)");
    const off = () => mq.matches && setOpen(false);
    mq.addEventListener("change", off);
    return () => mq.removeEventListener("change", off);
  }, [open]);
  useEffect(() => {
    try {
      setSlim(localStorage.getItem(SLIM_KEY) === "1");
    } catch {}
  }, []);
  // R1290: read before paint, so a dock user sees the sidebar for one frame at most (the server cannot see localStorage).
  const [navStyle, setNavStyle] = useState<AdminNavStyle>("sidebar");
  const dock = navStyle === "dock";
  const switched = useRef(false);
  useLayoutEffect(() => {
    try {
      setNavStyle(readNavStyle(localStorage.getItem(ADMIN_NAV_KEY)));
    } catch {}
  }, []);
  const chooseNav = (next: AdminNavStyle) => {
    switched.current = true;
    setNavStyle(next);
    try {
      localStorage.setItem(ADMIN_NAV_KEY, next);
    } catch {}
  };
  // The switch that was pressed unmounts with its layout; focus lands on the one that switches back.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.querySelector<HTMLElement>("[data-admin-nav-switch]")?.focus({ preventScroll: true });
  }, [navStyle]);
  const toggleSlim = () => {
    const next = !slim;
    setSlim(next);
    try {
      localStorage.setItem(SLIM_KEY, next ? "1" : "0");
    } catch {}
  };

  return (
    <div className="admin-root sky-host relative isolate flex min-h-dvh" data-nav={slim ? "slim" : "full"} data-admin-nav={navStyle}>
      {!quiet && <StarField nebula />}
      {!dock && (
        <div className="sticky top-0 z-[var(--admin-z-sidebar)] hidden h-dvh shrink-0 p-3 pt-[max(0.75rem,var(--sa-t))] lg:block">
          <aside data-route-order="" className={cn("glass flex h-full flex-col overflow-hidden rounded-[28px] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none", slim ? "w-[72px]" : "w-[248px]")} aria-label="Admin sidebar">
            <div className={cn("flex items-center gap-2 pb-4 pt-5", slim ? "flex-col px-3" : "justify-between px-5")}>
              <Link href="/admin" aria-label="Admin overview" className="flex h-10 items-center">
                <OutllyBrand variant={slim ? "icon" : "full"} size={slim ? 26 : undefined} label={false} />
              </Link>
              {!slim && <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-lime-ink">Admin</span>}
              {/* Slim: the rail clips its own overflow, so the toggle uses the same fixed tooltip as the nav items. */}
              <Tooltip text={slim ? "Expand sidebar" : "Collapse sidebar"} side="bottom" className={cn("flex", slim && "[&>.admin-tip]:!hidden")}>
                <Button type="button" variant="ghost" size="icon-sm" onClick={toggleSlim} aria-pressed={slim} aria-label={slim ? "Expand sidebar" : "Collapse sidebar"} {...(slim ? { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => slimTip.api.show(e.currentTarget, "Expand sidebar"), onPointerLeave: slimTip.api.hide, onFocus: (e: React.FocusEvent<HTMLElement>) => slimTip.api.show(e.currentTarget, "Expand sidebar"), onBlur: slimTip.api.hide } : {})} className="h-10 w-10">
                  {slim ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
                </Button>
              </Tooltip>
            </div>
            <div className="flex min-h-0 flex-1 flex-col" onScrollCapture={slimTip.api.hide}>
              <ScrollArea className="px-3 pb-3">
                <NavList role={admin.role} path={path} badges={badges} layoutId="admin-pill" slim={slim} tip={slim ? slimTip.api : undefined} />
              </ScrollArea>
            </div>
            <Footer admin={admin} path={path} slim={slim} onDock={() => chooseNav("dock")} />
          </aside>
          {slim && slimTip.node}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* 1191: one bar, one height. The phone bar is 52px tall (R1274: the studio bar's height) plus the status-bar inset (box-content, so the inset never eats the row), and
            the menu, mark, title and bell all sit on its centre line, so nothing shifts between admin pages. */}
        {/* R1269: under 1024px .admin-top folds on data-folded (globals.css); it stays sticky in the flow, so nothing jumps.
            R1284: no border, fill or blur of its own: under 1024px it is the page (globals.css R1284 block). */}
        <header ref={top} data-lifted={lifted ? "" : undefined} data-folded={hidden ? "" : undefined} className="admin-top sticky top-0 z-[var(--admin-z-header)] box-content flex h-[52px] items-center gap-2 pl-[max(1rem,var(--sa-l))] pr-[max(0.75rem,calc(var(--sa-r)+0.5rem))] pt-[var(--sa-t)] md:h-16 lg:h-auto lg:pl-8 lg:pr-8 lg:pt-[max(1.25rem,var(--sa-t))]">
          {/* R1283: on the phone the menu button sits on the RIGHT, after the bell (user request); the drawer opens from the same edge. */}
          <div className={cn("flex min-w-0 items-center gap-1.5", !dock && "lg:hidden")}>
            <OutlyMark size={24} />
            <span className="truncate font-display text-[16px] font-semibold leading-none tracking-[-0.01em]">Admin</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* R1288: Ctrl/Cmd+K palette over NAV; its Search pill shows from md up, the shortcut works everywhere. */}
            <AdminCommand nav={NAV} role={admin.role} />
            <Bell role={admin.role} />
            <Tooltip text="Open menu" side="bottom" className={cn("-mr-2 flex shrink-0 lg:hidden", TOUCH_TIP)}>
              <Button ref={menuBtn} type="button" variant="ghost" size="icon" onPointerDown={() => (byPointer.current = true)} onKeyDown={() => (byPointer.current = false)} onClick={() => { fromTab.current = false; setOpen(true); }} aria-label="Open menu" aria-expanded={open} aria-haspopup="dialog" className="text-foreground">
                <Menu className="h-5 w-5" strokeWidth={1.85} aria-hidden />
              </Button>
            </Tooltip>
          </div>
        </header>
        {/* 1163: one content column for every admin page. Wide enough to use a 1920 screen (four metric columns, two
            charts side by side) and capped so ultrawide monitors do not stretch tables across the whole desk. */}
        {/* 1191: the console is sized to the window, so the panel's usual deep bottom padding would leave
            a dead strip under it and make the page scroll for nothing. */}
        <main id="main" className={cn("admin-main mx-auto w-full max-w-[1480px] pb-[calc(var(--sa-float)+1rem)] pl-[max(1rem,var(--sa-l))] pr-[max(1rem,var(--sa-r))] pt-2 sm:pl-[max(1.5rem,var(--sa-l))] sm:pr-[max(1.5rem,var(--sa-r))] lg:px-8", quiet ? "lg:pb-4" : "lg:pb-24", dock && "lg:pb-[calc(6rem+var(--sa-b))]")}>
          {children}
        </main>
      </div>

      {/* R1290: the dock replaces the sidebar from lg up; it renders nothing below lg. */}
      {dock && <AdminDock nav={NAV} groups={NAV_GROUPS} role={admin.role} admin={admin} path={path} badges={badges} active={active} onSidebar={() => chooseNav("sidebar")} />}

      {/* R1274: the phone and tablet tab bar; compact while the header is folded (the same scroll signal, one listener). */}
      <AdminTabBar
        ref={moreBtn}
        nav={NAV}
        role={admin.role}
        path={path}
        active={active}
        compact={hidden}
        open={open}
        byPointer={byPointer}
        onMore={() => {
          fromTab.current = true;
          setOpen(true);
        }}
      />

      {/* R1269: Radix gives the focus trap, Escape, outside tap and the body scroll lock (data-scroll-locked, which
          also pauses Lenis); framer only animates. Focus goes back to the menu button when it closes. */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div className="admin-layer fixed inset-0 z-[var(--admin-z-drawer)] bg-foreground/40 backdrop-blur-[3px] lg:hidden" {...(reduce ? FX.fade : FX.scrim)} />
              </Dialog.Overlay>
              <Dialog.Content
                asChild
                forceMount
                aria-describedby={undefined}
                onOpenAutoFocus={(e) => {
                  if (!byPointer.current) return;
                  e.preventDefault();
                  drawer.current?.focus({ preventScroll: true });
                }}
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  if (fromTab.current) moreBtn.current?.focus({ preventScroll: true });
                  else menuBtn.current?.focus({ preventScroll: true });
                }}
              >
                <motion.aside
                  ref={drawer}
                  tabIndex={-1}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Admin menu"
                  className="admin-layer glass-strong fixed bottom-[calc(var(--sa-b)+0.5rem)] right-[max(0.5rem,var(--sa-r))] top-[calc(var(--sa-t)+0.5rem)] z-[var(--admin-z-drawer)] flex w-[min(300px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[28px] outline-none lg:hidden"
                  {...(reduce ? FX.fade : DRAWER_FX)}
                >
                  <Dialog.Title className="sr-only">Admin menu</Dialog.Title>
                  <div className="flex items-center justify-between px-5 pb-3 pt-4">
                    <OutllyBrand variant="full" />
                    <Tooltip text="Close menu" side="bottom" className={cn("flex", TOUCH_TIP)}>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu" className="text-foreground">
                        <X className="h-5 w-5" aria-hidden />
                      </Button>
                    </Tooltip>
                  </div>
                  <ScrollArea className="px-3 pb-3">
                    <NavList role={admin.role} path={path} badges={badges} onNavigate={() => setOpen(false)} layoutId="admin-pill-m" />
                  </ScrollArea>
                  <Footer admin={admin} path={path} onNavigate={() => setOpen(false)} />
                </motion.aside>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </div>
  );
}
