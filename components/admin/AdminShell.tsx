"use client";
import { StarField } from "@/components/marketing/StarField";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Award, BarChart3, BadgePercent, BellRing, CalendarDays, Gift, BadgeCheck, BookOpen, ChevronRight, Construction, FlaskConical, HeartPulse, Headset, Hourglass, Library, Newspaper, Rocket, PanelsTopLeft, PanelLeftClose, PanelLeftOpen, CreditCard, Globe, Share2, SlidersHorizontal, Sparkles, LayoutDashboard, LayoutTemplate, LifeBuoy, LogOut, Mail, Megaphone, Menu, Palette, Plug, Repeat, ShieldCheck, Tag, TrendingUp, Type, Users, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ContrastToggle } from "@/components/shared/ContrastToggle";
import { can, ROLE_LABEL, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { Bell } from "./Bell";
import { ScrollArea } from "./ScrollArea";
import { Tooltip } from "./ui";
import { T } from "@/lib/motion/tokens";

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
  { href: "/admin/behavior", label: "User behavior", icon: Activity, area: "insights", group: "Insights" },
  { href: "/admin/retention", label: "At risk", icon: HeartPulse, area: "retention", group: "Insights" },
  { href: "/admin/growth", label: "Growth", icon: Rocket, area: "growth", group: "Insights" },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, area: "growth", group: "Insights" },
  { href: "/admin/blog", label: "Blog dashboard", icon: Newspaper, area: "content", group: "Content Studio" },
  { href: "/admin/blog/generate", label: "Generate blog", icon: Wand2, area: "content", group: "Content Studio" },
  { href: "/admin/blog/library", label: "Blog library", icon: Library, area: "content", group: "Content Studio" },
  { href: "/admin/blog/calendar", label: "Content calendar", icon: CalendarDays, area: "content", group: "Content Studio" },
  { href: "/admin/blog/seo", label: "SEO performance", icon: TrendingUp, area: "content", group: "Content Studio" },
  { href: "/admin/blog/settings", label: "Blog settings", icon: SlidersHorizontal, area: "content", group: "Content Studio" },
  { href: "/admin/tickets", label: "Tickets", icon: LifeBuoy, area: "tickets", group: "Support" },
  { href: "/admin/live-assist", label: "Live Assist", icon: Headset, area: "live", group: "Support" },
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

/** Longest matching entry wins, so /admin/blog/library lights "Blog library" and not "Blog dashboard" as well. */
const active = (path: string, href: string) => {
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
  const hover = slim && tip ? { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => tip.show(e.currentTarget, text), onPointerLeave: tip.hide, onFocus: (e: React.FocusEvent<HTMLElement>) => tip.show(e.currentTarget, text), onBlur: tip.hide } : {};
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={on ? "page" : undefined}
      aria-label={slim && n > 0 ? `${label}, ${n} open` : undefined}
      {...hover}
      className={cn("group relative flex h-11 items-center rounded-2xl text-[14px] font-medium transition-colors duration-200 lg:h-10", slim ? "w-11 justify-center lg:w-10" : "gap-3 px-3", on ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:bg-foreground/[0.04] [@media(hover:hover)]:hover:text-foreground")}
    >
      {on && (
        <motion.span layoutId={layoutId} className="absolute inset-0 rounded-2xl bg-secondary" transition={T.glide}>
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lime" />
        </motion.span>
      )}
      <Icon className={cn("relative h-[17px] w-[17px] shrink-0 transition-transform duration-200 motion-reduce:transition-none [@media(hover:hover)]:group-hover:scale-110", on && "text-lime-ink")} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
      <span className={cn("relative truncate", slim && "sr-only")}>{label}</span>
      {n > 0 && !slim && (
        <span className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-lime px-1.5 text-[11px] font-bold text-[hsl(var(--lime-foreground))]" aria-label={`${n} open`}>
          {n > 99 ? "99+" : n}
        </span>
      )}
      {n > 0 && slim && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-lime ring-2 ring-card" aria-hidden />}
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
          <div key={g} className={cn(slim && "flex flex-col items-center gap-0.5 border-t border-border/60 pt-3 first:border-0 first:pt-0")}>
            <p className={cn("eyebrow mb-1.5 px-3 text-[10.5px]", slim && "sr-only")}>{g}</p>
            <div className="flex flex-col gap-0.5">
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
function Footer({ admin, path, onNavigate, slim = false }: { admin: { name: string; role: AdminRole }; path: string; onNavigate?: () => void; slim?: boolean }) {
  const mine = path === "/admin/account";
  const signOut = (
    <form action="/api/admin/logout" method="post" className="shrink-0">
      <button type="submit" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground lg:h-10 lg:w-10" aria-label="Sign out">
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
  if (slim) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border/60 px-3 pb-3 pt-3">
        <Tooltip text="My account" side="right" className="flex">
          <Link href="/admin/account" onClick={onNavigate} aria-current={mine ? "page" : undefined} aria-label={`My account, ${admin.name}`} className={cn("grid h-11 w-11 place-items-center rounded-full lg:h-10 lg:w-10", mine && "bg-secondary")}>
            <OrbAvatar seed={admin.name} size={28} />
          </Link>
        </Tooltip>
        <Tooltip text="Sign out" side="right" className="flex">
          {signOut}
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 px-3 pb-3 pt-3">
      <div className="flex items-center gap-1">
        <ThemeToggle compact plain />
        <ContrastToggle label={false} />
        <Tooltip text="View the site" side="top" className="ml-auto flex">
          <Link href="/" aria-label="View the site" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
            <Globe className="h-4 w-4" aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <div className="flex items-center gap-1 rounded-2xl p-1.5 hairline">
        <Link href="/admin/account" onClick={onNavigate} aria-current={mine ? "page" : undefined} className={cn("group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 text-left", mine ? "bg-secondary" : "[@media(hover:hover)]:hover:bg-secondary")}>
          <OrbAvatar seed={admin.name} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{admin.name}</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">{ROLE_LABEL[admin.role]} · My account</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
        {signOut}
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
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    try {
      setSlim(localStorage.getItem(SLIM_KEY) === "1");
    } catch {}
  }, []);
  const toggleSlim = () => {
    const next = !slim;
    setSlim(next);
    try {
      localStorage.setItem(SLIM_KEY, next ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  return (
    <div className="admin-root sky-host relative isolate flex min-h-dvh" data-nav={slim ? "slim" : "full"}>
      {!quiet && <StarField nebula />}
      <div className="sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
        <aside data-route-order="" className={cn("glass hairline flex h-full flex-col overflow-hidden rounded-[28px] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none", slim ? "w-[72px]" : "w-[248px]")} aria-label="Admin sidebar">
          <div className={cn("flex items-center gap-2 pb-4 pt-5", slim ? "flex-col px-3" : "justify-between px-5")}>
            <Link href="/admin" aria-label="Admin overview" className="flex h-10 items-center">
              {slim ? <OutlyMark size={26} /> : <OutlyLogo size={28} />}
            </Link>
            {!slim && <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-lime-ink">Admin</span>}
            {/* Slim: the rail clips its own overflow, so the toggle uses the same fixed tooltip as the nav items. */}
            <Tooltip text={slim ? "Expand sidebar" : "Collapse sidebar"} side="bottom" className={cn("flex", slim && "[&>.admin-tip]:!hidden")}>
              <button type="button" onClick={toggleSlim} aria-pressed={slim} aria-label={slim ? "Expand sidebar" : "Collapse sidebar"} {...(slim ? { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => slimTip.api.show(e.currentTarget, "Expand sidebar"), onPointerLeave: slimTip.api.hide, onFocus: (e: React.FocusEvent<HTMLElement>) => slimTip.api.show(e.currentTarget, "Expand sidebar"), onBlur: slimTip.api.hide } : {})} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
                {slim ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
              </button>
            </Tooltip>
          </div>
          <div className="flex min-h-0 flex-1 flex-col" onScrollCapture={slimTip.api.hide}>
            <ScrollArea className="px-3 pb-3">
              <NavList role={admin.role} path={path} badges={badges} layoutId="admin-pill" slim={slim} tip={slim ? slimTip.api : undefined} />
            </ScrollArea>
          </div>
          <Footer admin={admin} path={path} slim={slim} />
        </aside>
        {slim && slimTip.node}
      </div>

      <div className="min-w-0 flex-1">
        {/* 1191: one bar, one hairline, one height. The phone bar is 56px tall plus the status-bar inset, and
            the menu, mark, title and bell all sit on its centre line, so nothing shifts between admin pages. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/50 bg-background/75 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:h-auto lg:border-0 lg:bg-transparent lg:pl-8 lg:pr-8 lg:pt-5 lg:backdrop-blur-0">
          <div className="flex min-w-0 items-center gap-1.5 lg:hidden">
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full [@media(hover:hover)]:hover:bg-secondary">
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <OutlyMark size={24} />
            <span className="truncate font-display text-[15px] font-bold leading-none tracking-tight">Admin</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center">
            <Bell role={admin.role} />
          </div>
        </header>
        {/* 1163: one content column for every admin page. Wide enough to use a 1920 screen (four metric columns, two
            charts side by side) and capped so ultrawide monitors do not stretch tables across the whole desk. */}
        {/* 1191: the console is sized to the window, so the panel's usual deep bottom padding would leave
            a dead strip under it and make the page scroll for nothing. */}
        <main id="main" className={cn("admin-main mx-auto w-full max-w-[1480px] px-4 pt-2 sm:px-6 lg:px-8", quiet ? "pb-4" : "pb-24")}>
          {children}
        </main>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[3px] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Admin menu"
              className="glass-strong fixed inset-y-2 left-2 z-50 flex w-[min(300px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[28px] lg:hidden"
              initial={{ x: "-110%" }}
              animate={{ x: 0 }}
              exit={{ x: "-110%" }}
              transition={T.card}
            >
              <div className="flex items-center justify-between px-5 pb-3 pt-4">
                <OutlyLogo size={26} />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-full [@media(hover:hover)]:hover:bg-secondary" autoFocus>
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <ScrollArea className="px-3 pb-3">
                <NavList role={admin.role} path={path} badges={badges} onNavigate={() => setOpen(false)} layoutId="admin-pill-m" />
              </ScrollArea>
              <Footer admin={admin} path={path} onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
