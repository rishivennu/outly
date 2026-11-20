"use client";
import Link from "next/link";
import { forwardRef } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { can, type AdminArea, type AdminRole } from "@/lib/admin/perms";

type Entry = { href: string; label: string; icon: LucideIcon; area: AdminArea; group: string };
export type AdminTab = Entry & { on: boolean };

/**
 * R1274: the phone and tablet tab bar of the admin. Four destinations plus More, each taken from NAV so labels, icons
 * and hrefs have one source. `want` is the entry a tab prefers; when the role cannot open it, the tab takes the next
 * entry of the same group the role can open (and no other tab already shows), or it is left out. Overview and Users
 * light on their own routes only; Content and Support light anywhere in their group; More lights everywhere else.
 */
const SLOTS: { want: string; group: string; wholeGroup: boolean }[] = [
  { want: "/admin", group: "Run", wholeGroup: false },
  { want: "/admin/users", group: "Run", wholeGroup: false },
  { want: "/admin/blog", group: "Content Studio", wholeGroup: true },
  { want: "/admin/tickets", group: "Support", wholeGroup: true },
];

export function adminTabs(nav: readonly Entry[], role: AdminRole, path: string, active: (path: string, href: string) => boolean): { tabs: AdminTab[]; moreOn: boolean } {
  const here = nav.find((n) => active(path, n.href));
  const taken = new Set<string>();
  const tabs: AdminTab[] = [];
  for (const s of SLOTS) {
    const group = nav.filter((n) => n.group === s.group);
    const from = Math.max(0, group.findIndex((n) => n.href === s.want));
    const pick = group.slice(from).find((n) => can(role, n.area) && !taken.has(n.href));
    if (!pick) continue;
    taken.add(pick.href);
    tabs.push({ ...pick, on: active(path, pick.href) || (s.wholeGroup && here?.group === s.group) });
  }
  return { tabs, moreOn: !tabs.some((t) => t.on) };
}

type Props = { nav: readonly Entry[]; role: AdminRole; path: string; active: (path: string, href: string) => boolean; compact: boolean; open: boolean; byPointer: { current: boolean }; onMore: () => void };

/**
 * Same bar as the studio's MobileNav (.mtab in globals.css): a floating glass pill, icon-only tabs named by hidden
 * text, one lime pill (.mtab-ind) that glides to the current tab on --i, compact (data-compact) while the admin header
 * is folded. More opens the one admin drawer; it is a plain button because the shared Button's ghost hover, lift and
 * press scale would fight the .mtab-item ink and the pill's own press.
 */
export const AdminTabBar = forwardRef<HTMLButtonElement, Props>(function AdminTabBar({ nav, role, path, active, compact, open, byPointer, onMore }, more) {
  const { tabs, moreOn } = adminTabs(nav, role, path, active);
  const n = tabs.length + 1;
  const idx = moreOn ? tabs.length : tabs.findIndex((t) => t.on);
  return (
    <nav
      aria-label="Admin tabs"
      data-compact={compact ? "" : undefined}
      style={{ ["--i" as string]: idx, ["--n" as string]: n }}
      className="admin-tabbar mtab fixed inset-x-0 z-[var(--admin-z-header)] flex items-stretch lg:hidden"
    >
      <span className="mtab-ind" aria-hidden="true" />
      {tabs.map(({ href, label, icon: Icon, on }) => (
        <Link key={href} href={href} aria-current={on ? "page" : undefined} draggable={false} className="mtab-item group flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
          <span className="mtab-pill relative grid h-[32px] w-[56px] place-items-center">
            <Icon className="relative h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
          </span>
          <span className="sr-only">{label}</span>
        </Link>
      ))}
      <button
        ref={more}
        type="button"
        onPointerDown={() => (byPointer.current = true)}
        onKeyDown={() => (byPointer.current = false)}
        onClick={onMore}
        aria-label="More"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={moreOn ? "true" : undefined}
        className="mtab-item group flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
      >
        <span className="mtab-pill relative grid h-[32px] w-[56px] place-items-center">
          <Ellipsis className="relative h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
        </span>
      </button>
    </nav>
  );
});
