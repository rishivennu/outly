"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutllyBrand } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ContrastToggle } from "@/components/shared/ContrastToggle";
import { Button } from "@/components/ui/button";
import { useHeaderScroll } from "@/lib/client/header-scroll";
import type { AdminArea, AdminRole } from "@/lib/admin/perms";
import { NAV } from "@/components/admin/AdminShell";
import { AdminCommand } from "@/components/admin/AdminCommand";
import { Bell } from "@/components/admin/Bell";
import { Tooltip } from "@/components/admin/ui";
import { DesignSwitch } from "./DesignSwitch";
import { AuroraDrawer } from "./AuroraDrawer";
import { ACCOUNT_HREF, AuroraPills, AuroraTabs, isAccount, locate, visibleGroups } from "./AuroraNav";

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** Touch screens focus a tapped button, which would leave its focus-within tooltip standing; there the label is aria only. */
const TOUCH_TIP = "[@media(hover:none)]:[&>.admin-tip]:!hidden";

/**
 * R1304: the Aurora console chrome. One sticky glass header: brand, the group pills (from 1024px; below that a menu
 * button opens the sheet), the tools, and a second row with the active group's pages. The header never folds away.
 */
export function AuroraShell({ admin, badges, children }: { admin: { name: string; role: AdminRole }; badges: Partial<Record<AdminArea, number>>; children: React.ReactNode }) {
  const path = usePathname() ?? "/admin";
  const groups = useMemo(() => visibleGroups(admin.role), [admin.role]);
  const { group } = locate(groups, path);
  const mine = isAccount(path);
  const [open, setOpen] = useState(false);
  const top = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const { lifted } = useHeaderScroll(path, top);
  useEffect(() => setOpen(false), [path]);

  return (
    <div className="admin-root aurora sky-host relative isolate flex min-h-dvh flex-col" data-admin-design="aurora">
      <header ref={top} data-lifted={lifted ? "" : undefined} className="au-header sticky top-0 z-[var(--admin-z-header)] pt-[var(--sa-t)]">
        <div className="mx-auto flex h-[60px] w-full max-w-[1480px] items-center gap-3 pl-[max(1rem,var(--sa-l))] pr-[max(0.75rem,calc(var(--sa-r)+0.5rem))] sm:px-6 lg:h-16 lg:px-8">
          <Link href="/admin" aria-label="Admin overview" className={cn("au-brand flex min-h-11 shrink-0 items-center gap-2 rounded-full pr-1", RING)}>
            <OutllyBrand variant="icon" size={26} label={false} />
            <span className="au-brand-pill rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none tracking-[-0.01em]">Admin</span>
          </Link>

          <AuroraPills groups={groups} current={group?.group ?? null} badges={badges} className="hidden min-w-0 lg:ml-4 lg:block" />

          <div className="au-tools ml-auto flex shrink-0 items-center gap-1">
            <AdminCommand nav={NAV} role={admin.role} />
            <Bell role={admin.role} />
            <ThemeToggle compact plain className="hidden lg:inline-flex" />
            <ContrastToggle label={false} className={cn("hidden h-11 w-11 justify-center px-0 lg:inline-flex", RING)} />
            <DesignSwitch current="aurora" />
            <Tooltip text="My account" side="bottom" className={cn("hidden sm:flex", TOUCH_TIP)}>
              <Link href={ACCOUNT_HREF} aria-current={mine ? "page" : undefined} aria-label={`My account, ${admin.name}`} className={cn("au-avatar grid h-11 w-11 place-items-center rounded-full", RING)}>
                <OrbAvatar seed={admin.name} size={30} />
              </Link>
            </Tooltip>
            <form action="/api/admin/logout" method="post" className="hidden shrink-0 lg:block">
              <Tooltip text="Sign out" side="bottom" className={cn("flex", TOUCH_TIP)}>
                <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" className={RING}>
                  <LogOut className="h-4 w-4" aria-hidden />
                </Button>
              </Tooltip>
            </form>
            <Button ref={menuBtn} type="button" variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation" aria-expanded={open} aria-haspopup="dialog" className={cn("au-menu-btn min-h-11 min-w-11 lg:hidden", RING)}>
              <Menu className="h-5 w-5" strokeWidth={1.85} aria-hidden />
            </Button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1480px] pb-2 pl-[max(0.75rem,var(--sa-l))] pr-[max(0.75rem,var(--sa-r))] sm:px-5 lg:px-7">
          <AuroraTabs groups={groups} path={path} badges={badges} />
        </div>
      </header>

      <main id="main" className="admin-main aurora-main mx-auto w-full max-w-[1480px] px-[max(1rem,var(--sa-l))] pb-[calc(var(--sa-b)+2rem)] pt-4 sm:px-6 lg:px-8">
        {children}
      </main>

      <AuroraDrawer open={open} onOpenChange={setOpen} admin={admin} path={path} groups={groups} badges={badges} returnFocus={menuBtn} />
    </div>
  );
}
