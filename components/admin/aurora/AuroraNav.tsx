"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { UserRound } from "lucide-react";
import { gsap } from "@/lib/motion/gsap";
import { MOTION_OK } from "@/lib/motion/prefs";
import { cn } from "@/lib/utils";
import { can, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { NAV, NAV_GROUPS, active, type NavGroup } from "@/components/admin/AdminShell";
import { hideInk, slideInk } from "./motion";

export type NavEntry = (typeof NAV)[number];
export type VisibleGroup = { group: NavGroup; items: NavEntry[] };
export type Badges = Partial<Record<AdminArea, number>>;

export const PILL_LABEL: Record<NavGroup, string> = {
  Run: "Run",
  Insights: "Insights",
  "Content Studio": "Content",
  Support: "Support",
  Setup: "Setup",
  Administration: "Admin",
};

export const ACCOUNT_HREF = "/admin/account";

/** Only these areas carry open counts in Aurora (tickets on its tab and the Support pill, live on its tab and the pill). */
const COUNTED: readonly AdminArea[] = ["tickets", "live"];
export const countFor = (area: AdminArea, badges: Badges) => (COUNTED.includes(area) ? Math.max(0, badges[area] ?? 0) : 0);
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

export function visibleGroups(role: AdminRole): VisibleGroup[] {
  return NAV_GROUPS.map((group) => ({ group, items: NAV.filter((n) => n.group === group && can(role, n.area)) })).filter((g) => g.items.length > 0);
}

/** Where the admin is: the active entry (longest match, see `active`) and its group; /admin/account is in no group. */
export function locate(groups: VisibleGroup[], path: string) {
  for (const g of groups) {
    const entry = g.items.find((n) => active(path, n.href));
    if (entry) return { group: g, entry };
  }
  return { group: null, entry: null };
}

export const isAccount = (path: string) => path === ACCOUNT_HREF || path.startsWith(ACCOUNT_HREF + "/");

const groupCount = (g: VisibleGroup, badges: Badges) => [...new Set(g.items.map((i) => i.area))].reduce((sum, a) => sum + countFor(a, badges), 0);

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuroraPills({ groups, current, badges, className }: { groups: VisibleGroup[]; current: NavGroup | null; badges: Badges; className?: string }) {
  return (
    <nav aria-label="Sections" className={cn("au-nav", className)}>
      <ul className="flex items-center gap-1">
        {groups.map((g) => {
          const on = g.group === current;
          const n = groupCount(g, badges);
          return (
            <li key={g.group}>
              <Link
                href={g.items[0].href}
                aria-current={on ? "location" : undefined}
                aria-label={n > 0 ? `${g.group}, ${n} open` : g.group === PILL_LABEL[g.group] ? undefined : g.group}
                title={g.group}
                className={cn("au-pill relative inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium", RING)}
              >
                <span>{PILL_LABEL[g.group]}</span>
                {n > 0 && (
                  <span className="au-pill-badge grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular" aria-hidden>
                    {badgeText(n)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type Tab = { href: string; label: string; icon: typeof UserRound; area: AdminArea | null };

/**
 * The second row: the active group's pages, one sliding ink under the active one. The ink is placed without a tween
 * on first paint, on a resize and when the group changes (the tabs are different ones), and glides when the admin
 * moves between pages of the same group.
 */
export function AuroraTabs({ groups, path, badges }: { groups: VisibleGroup[]; path: string; badges: Badges }) {
  const { group, entry } = locate(groups, path);
  const account = !group && isAccount(path);
  const shown = group ?? (account ? null : groups[0] ?? null);
  const tabs: Tab[] = account ? [{ href: ACCOUNT_HREF, label: "My account", icon: UserRound, area: null }] : (shown?.items ?? []);
  const activeHref = account ? ACCOUNT_HREF : (entry?.href ?? null);
  const label = account ? "My account" : (shown?.group ?? "Pages");
  const key = account ? "account" : (shown?.group ?? "none");

  const strip = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const placed = useRef<string | null>(null);

  const find = () => strip.current?.querySelector<HTMLElement>('[data-aurora="tab"][aria-current="page"]') ?? null;

  useLayoutEffect(() => {
    const s = strip.current, i = ink.current;
    if (!s || !i) return;
    const el = find();
    if (!el) {
      hideInk(i);
      placed.current = null;
      delete s.dataset.inkReady;
      return;
    }
    slideInk(i, el, s, placed.current === key);
    placed.current = key;
    s.dataset.inkReady = "";
    const smooth = window.matchMedia(MOTION_OK).matches;
    el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: smooth ? "smooth" : "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref, key]);

  // Re-measure when the strip or the active tab itself changes size (fonts settling, a badge arriving on the tab).
  useEffect(() => {
    const s = strip.current, i = ink.current;
    if (!s || !i) return;
    let live = true;
    const place = () => {
      if (!live) return;
      const el = find();
      if (el) slideInk(i, el, s, false);
      else hideInk(i);
    };
    const ro = new ResizeObserver(place);
    ro.observe(s);
    const active = find();
    if (active) ro.observe(active);
    void document.fonts?.ready.then(place);
    return () => {
      live = false;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref, key]);

  useEffect(() => {
    const i = ink.current;
    return () => {
      if (i) gsap.killTweensOf(i);
    };
  }, []);

  return (
    <nav aria-label={`Pages in ${label}`} className="au-tabs">
      <div ref={strip} className="relative flex items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-header-scroll="ignore">
        <span ref={ink} data-aurora-ink="" aria-hidden className="au-ink pointer-events-none absolute left-0 opacity-0" />
        {tabs.map(({ href, label: text, icon: Icon, area }) => {
          const on = href === activeHref;
          const n = area ? countFor(area, badges) : 0;
          return (
            <Link
              key={href}
              href={href}
              data-aurora="tab"
              aria-current={on ? "page" : undefined}
              aria-label={n > 0 ? `${text}, ${n} open` : undefined}
              className={cn("au-tab relative z-[1] inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-medium", RING, "focus-visible:ring-inset")}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
              <span>{text}</span>
              {n > 0 && (
                <span className="au-pill-badge grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular" aria-hidden>
                  {badgeText(n)}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
