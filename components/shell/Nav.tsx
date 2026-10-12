"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, BarChart3, CreditCard, LifeBuoy, CalendarDays, ClipboardCheck, Globe, Home, LayoutGrid, MessagesSquare, Plus, Settings, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";
import { ThemeCycleButton, ThemeToggle } from "@/components/shared/ThemeToggle";
import { useUser } from "./UserContext";

const MAIN = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/content", label: "Content", icon: LayoutGrid },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
];

const TOUR: Record<string, string> = { "/create": "new-post", "/content": "content", "/calendar": "calendar", "/analytics": "analytics", "/inbox": "inbox", "/approvals": "approvals", "/accounts": "accounts" };

function isActive(path: string, href: string) {
  return href === "/home" ? path === "/home" : path.startsWith(href);
}

export function Sidebar() {
  const path = usePathname();
  const user = useUser();
  const studio = MAIN.filter((m) => m.href !== "/create");
  return (
    <div className="sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
      <aside className="glass hairline flex h-full w-[240px] flex-col overflow-y-auto rounded-[28px] px-3 pb-4 pt-5" aria-label="Primary">
        <Link href="/home" className="mb-6 flex items-center gap-2 rounded-2xl px-2 py-1 text-[18px] transition-opacity hover:opacity-80" aria-label="Outlly dashboard" title="Dashboard">
          <OutlyLogo size={30} />
        </Link>

        <Link
          href="/create"
          data-tour="new-post"
          aria-current={isActive(path, "/create") ? "page" : undefined}
          className="lime-glow group mb-6 flex h-12 items-center gap-2.5 rounded-2xl bg-lime px-4 text-[15px] font-semibold text-[hsl(var(--lime-foreground))] transition-transform duration-200 hover:-translate-y-px active:scale-[0.98]"
        >
          <Plus className="h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-90" strokeWidth={2.6} aria-hidden="true" />
          New post
        </Link>

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

        <div className="mt-auto flex flex-col gap-0.5">
          <p className="eyebrow mb-2 px-3 text-[11px]">Workspace</p>
          {[
            ...(user.workspace ? [] : [
              { href: "/accounts", label: "Connected accounts", icon: Link2 },
              { href: "/billing", label: "Billing", icon: CreditCard },
            ]),
            { href: "/support", label: "Help centre", icon: LifeBuoy },
            { href: "/settings", label: "Settings", icon: Settings },
          ].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-tour={TOUR[href]} aria-current={isActive(path, href) ? "page" : undefined} className={cn("flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] transition-colors duration-200", isActive(path, href) ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
              <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {label}
            </Link>
          ))}
          <Link href="/" className="group flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] text-muted-foreground transition-colors duration-200 hover:bg-foreground/[0.04] hover:text-foreground">
            <Globe className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Outlly website
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </Link>
          <ThemeToggle compact plain className="mb-1 mt-2 self-start" />
          <div className="mt-2 flex items-center gap-2 rounded-2xl p-1.5 hairline">
            <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 hover:bg-secondary/60">
              <span className="lime-bg grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[13px] font-bold" aria-hidden="true">
                {(user.workspace?.me.name ?? user.name).split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{user.workspace?.me.name ?? user.name}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">{user.workspace ? `In ${user.workspace.ownerName}'s studio` : user.email}</span>
              </span>
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="glass-strong fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 flex h-[68px] items-center justify-around rounded-[28px] px-1 lg:hidden">
      {MAIN.filter((m) => m.href !== "/approvals").map(({ href, label, icon: Icon }) => {
        const active = isActive(path, href);
        const create = href === "/create";
        return (
          <Link key={href} href={href} data-tour={TOUR[href]} aria-current={active ? "page" : undefined} className={cn("flex h-14 min-w-[48px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 transition-colors duration-200", create ? "" : active ? "text-foreground" : "text-muted-foreground")}>
            <span className={cn("grid h-8 w-11 place-items-center rounded-full transition-colors duration-200", create ? "lime-bg lime-glow" : active && "bg-secondary text-lime-ink")}>
              <Icon className="h-[19px] w-[19px]" strokeWidth={create ? 2.4 : active ? 2.2 : 1.9} aria-hidden="true" />
            </span>
            <span className="text-[10.5px] font-medium leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileTopBar() {
  const { workspace } = useUser();
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-2 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] lg:hidden">
      <Link href="/home" className="flex min-w-0 shrink-0 items-center gap-2 rounded-2xl py-1 text-[16px]" aria-label="Outlly dashboard">
        <OutlyMark size={28} />
        <span className="hidden font-display text-[1.15em] font-bold tracking-[-0.03em] min-[480px]:inline">outlly</span>
      </Link>
      <div className="flex min-w-0 items-center gap-0.5">
        <Link href="/" aria-label="Outlly website" title="Outlly website" className="hidden h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary min-[420px]:grid">
          <Globe className="h-[18px] w-[18px]" />
        </Link>
        {!workspace && (
          <Link href="/billing" aria-label="Billing" title="Billing" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
            <CreditCard className="h-[18px] w-[18px]" />
          </Link>
        )}
        {/* One cycling button: the three-way switch made the row wider than a phone (10-12f). */}
        <ThemeCycleButton />
        <Link href="/approvals" data-tour="approvals" aria-label="Approvals" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
          <ClipboardCheck className="h-[18px] w-[18px]" />
        </Link>
        {!workspace && (
          <Link href="/accounts" data-tour="accounts" aria-label="Connected accounts" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
            <Link2 className="h-[18px] w-[18px]" />
          </Link>
        )}
        <Link href="/settings" aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
          <Settings className="h-[18px] w-[18px]" />
        </Link>
      </div>
    </div>
  );
}
