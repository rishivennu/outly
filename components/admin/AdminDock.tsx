"use client";
/*
 * R1290: the admin console's second desktop layout, a dock along the bottom (the shared components/ui/motion/Dock.tsx).
 * Forty pages do not fit in a dock, so each sidebar group is one icon that opens its pages in a menu above the dock.
 * Phones never see it: below lg the tab bar and the drawer stay as they are.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, BarChart3, ChevronRight, Contrast, Globe, LayoutDashboard, LifeBuoy, LogOut, Newspaper, PanelLeftOpen, Search, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Dock, DockItem, DockSeparator } from "@/components/ui/motion/Dock";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { Button } from "@/components/ui/button";
import { NEXT_THEME, THEME_OPTIONS, useTheme } from "@/components/shared/ThemeToggle";
import { CONTRAST_KEY } from "@/lib/theme/script";
import { can, ROLE_LABEL, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { FX } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils";
import type { NavGroup } from "./AdminShell";

type Entry = { href: string; label: string; icon: LucideIcon; area: AdminArea; group: NavGroup };

export const GROUP_ICON: Record<NavGroup, LucideIcon> = {
  Run: Activity,
  Insights: BarChart3,
  "Content Studio": Newspaper,
  Support: LifeBuoy,
  Setup: SlidersHorizontal,
  Administration: ShieldCheck,
};

/** Overview has its own icon, so the groups list every other page the role may open; empty groups are left out. */
export function dockGroups(nav: readonly Entry[], groups: readonly NavGroup[], role: AdminRole) {
  const mine = nav.filter((n) => n.href !== "/admin" && can(role, n.area));
  return groups.map((g) => ({ group: g, items: mine.filter((n) => n.group === g) })).filter((g) => g.items.length > 0);
}

/** The menus rise out of the dock, so FX.pop runs upward here. */
const RISE = {
  initial: { ...FX.pop.initial, y: 6 },
  animate: FX.pop.animate,
  exit: { ...FX.pop.exit, y: 4 },
};
const MENU_W = 272;
const ACCOUNT = "account";
const ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]';
const ROW = "flex min-h-11 w-full items-center gap-3 rounded-[16px] px-3 text-left text-[14px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const trigger = (key: string) => document.querySelector<HTMLElement>(`[data-dock-menu="${CSS.escape(key)}"]`);
const openSearch = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));

function useContrast() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(document.documentElement.dataset.contrast === "more"), []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      if (next) {
        document.documentElement.dataset.contrast = "more";
        localStorage.setItem(CONTRAST_KEY, "more");
      } else {
        delete document.documentElement.dataset.contrast;
        localStorage.removeItem(CONTRAST_KEY);
      }
    } catch {}
  };
  return { on, toggle };
}

type Props = {
  nav: readonly Entry[];
  groups: readonly NavGroup[];
  role: AdminRole;
  admin: { name: string; role: AdminRole };
  path: string;
  badges: Partial<Record<AdminArea, number>>;
  active: (path: string, href: string) => boolean;
  onSidebar: () => void;
};

export function AdminDock({ nav, groups, role, admin, path, badges, active, onSidebar }: Props) {
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState<{ key: string; left: number; bottom: number; focus: boolean } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const contrast = useContrast();
  const list = dockGroups(nav, groups, role);

  const show = (key: string, focus: boolean) => {
    const el = trigger(key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(12, r.left + r.width / 2 - MENU_W / 2), window.innerWidth - MENU_W - 12);
    setMenu({ key, left, bottom: window.innerHeight - r.top + 14, focus });
  };
  const close = (refocus: boolean) => {
    const key = menu?.key;
    setMenu(null);
    if (refocus && key) trigger(key)?.focus({ preventScroll: true });
  };
  // e.detail is 0 for Enter and Space: then focus moves into the menu, as the menu button pattern asks.
  const toggle = (key: string) => (e: ReactMouseEvent<HTMLElement>) => (menu?.key === key ? close(false) : show(key, e.detail === 0));

  useEffect(() => setMenu(null), [path]);
  useEffect(() => {
    if (!menu) return;
    if (menu.focus) panel.current?.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (panel.current?.contains(t) || t?.closest(`[data-dock-menu="${CSS.escape(menu.key)}"]`)) return;
      setMenu(null);
    };
    const onResize = () => setMenu(null);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  const onDockKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).dataset?.dockMenu;
    if (key && e.key === "ArrowUp") {
      e.preventDefault();
      show(key, true);
    } else if (e.key === "Escape" && menu) {
      e.preventDefault();
      close(true);
    }
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setMenu(null);
    } else if (to !== undefined && items.length) {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    }
  };

  const count = (items: readonly Entry[]) => items.reduce((s, n) => s + (badges[n.area] ?? 0), 0);
  const badge = (n: number) => (n > 0 ? (n > 99 ? "99+" : n) : undefined);
  const menuAttrs = (key: string) => ({ "data-dock-menu": key, "aria-haspopup": "menu", "aria-expanded": menu?.key === key, "aria-controls": menu?.key === key ? "admin-dock-menu" : undefined });
  const current = THEME_OPTIONS.find((o) => o.value === theme.choice) ?? THEME_OPTIONS[1]!;
  const nextTheme = THEME_OPTIONS.find((o) => o.value === NEXT_THEME[theme.choice])!;
  const ThemeIcon = current.Icon;

  const open = menu ? list.find((g) => g.group === menu.key) : undefined;
  let body: ReactNode = null;
  let title = "";
  if (open) {
    title = open.group;
    body = open.items.map(({ href, label, icon: Icon, area }) => {
      const on = active(path, href);
      const n = badges[area] ?? 0;
      return (
        <Link key={href} href={href} role="menuitem" tabIndex={-1} aria-current={on ? "page" : undefined} onClick={() => setMenu(null)} className={cn(ROW, on ? "bg-lime text-lime-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary/60 [@media(hover:hover)]:hover:text-foreground")}>
          <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {n > 0 && (
            <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold", on ? "bg-lime-foreground text-lime" : "bg-lime text-lime-foreground")} aria-label={`${n} open`}>
              {n > 99 ? "99+" : n}
            </span>
          )}
        </Link>
      );
    });
  } else if (menu?.key === ACCOUNT) {
    title = `Your account, ${admin.name}`;
    const mine = path === "/admin/account";
    body = (
      <>
        <Link href="/admin/account" role="menuitem" tabIndex={-1} aria-current={mine ? "page" : undefined} onClick={() => setMenu(null)} className={cn(ROW, "min-h-14", mine ? "bg-lime text-lime-foreground" : "[@media(hover:hover)]:hover:bg-secondary/60")}>
          <OrbAvatar seed={admin.name} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{admin.name}</span>
            <span className={cn("block truncate text-[11.5px] font-normal", mine ? "text-lime-foreground/70" : "text-muted-foreground")}>{ROLE_LABEL[admin.role]} · My account</span>
          </span>
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", mine ? "text-lime-foreground/70" : "text-muted-foreground")} aria-hidden />
        </Link>
        <Link href="/" role="menuitem" tabIndex={-1} onClick={() => setMenu(null)} className={cn(ROW, "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary/60 [@media(hover:hover)]:hover:text-foreground")}>
          <Globe className="h-[17px] w-[17px] shrink-0" aria-hidden />
          View the site
        </Link>
        <button type="button" role="menuitemcheckbox" tabIndex={-1} aria-checked={contrast.on} onClick={contrast.toggle} className="flex min-h-11 w-full items-center gap-3 rounded-[16px] px-3 text-left text-[14px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(hover:hover)]:hover:bg-secondary/60 [@media(hover:hover)]:hover:text-foreground">
          <Contrast className="h-[17px] w-[17px] shrink-0" aria-hidden />
          <span className="flex-1">High contrast</span>
          <span aria-hidden className={cn("h-2 w-2 rounded-full", contrast.on ? "bg-lime" : "bg-foreground/[0.16]")} />
        </button>
        <form action="/api/admin/logout" method="post" role="none">
          <Button type="submit" variant="ghost" role="menuitem" tabIndex={-1} className={cn(ROW, "h-auto justify-start rounded-[16px] active:scale-100")}>
            <LogOut className="h-[17px] w-[17px] shrink-0" aria-hidden />
            Sign out
          </Button>
        </form>
      </>
    );
  }

  return (
    <div className="admin-dock pointer-events-none fixed inset-x-0 z-40 hidden justify-center lg:flex" style={{ bottom: "max(16px, var(--sa-b))" }} onKeyDown={onDockKey}>
      <Dock label="Admin" className="pointer-events-auto">
        {can(role, "overview") && (
          <DockItem label="Overview" href="/admin" active={path === "/admin"}>
            <LayoutDashboard />
          </DockItem>
        )}
        {list.map(({ group, items }) => {
          const Icon = GROUP_ICON[group];
          return (
            <DockItem key={group} label={group} onClick={toggle(group)} active={items.some((n) => active(path, n.href))} badge={badge(count(items))} attrs={menuAttrs(group)}>
              <Icon />
            </DockItem>
          );
        })}
        <DockSeparator />
        <DockItem label="Search" onClick={openSearch} attrs={{ "aria-haspopup": "dialog", "aria-keyshortcuts": "Control+K Meta+K" }}>
          <Search />
        </DockItem>
        <DockItem label={`Theme: ${current.label}. Switch to ${nextTheme.label}`} onClick={() => theme.set(nextTheme.value)}>
          <ThemeIcon />
        </DockItem>
        <DockItem label="Your account" onClick={toggle(ACCOUNT)} active={path === "/admin/account"} attrs={menuAttrs(ACCOUNT)}>
          <OrbAvatar seed={admin.name} size={22} />
        </DockItem>
        <DockSeparator />
        <DockItem label="Switch to sidebar" onClick={onSidebar} attrs={{ "data-admin-nav-switch": "" }}>
          <PanelLeftOpen />
        </DockItem>
      </Dock>

      <AnimatePresence>
        {menu && body && (
          <motion.div
            key={menu.key}
            ref={panel}
            id="admin-dock-menu"
            role="menu"
            aria-label={title}
            onKeyDown={onMenuKey}
            {...(reduce ? FX.fade : RISE)}
            className="lg-glass pointer-events-auto fixed z-[var(--admin-z-popover)] flex max-h-[calc(100dvh-8rem)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-[24px] p-1.5"
            style={{ left: menu.left, bottom: menu.bottom, width: MENU_W, transformOrigin: "50% 100%" }}
          >
            {open && (
              <p aria-hidden className="px-3 pb-1 pt-2 text-[12px] font-semibold text-muted-foreground">
                {title}
              </p>
            )}
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
