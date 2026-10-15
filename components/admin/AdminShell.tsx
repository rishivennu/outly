"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, BookOpen, Construction, HeartPulse, Hourglass, Rocket, PanelsTopLeft, CreditCard, Globe, Share2, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Mail, Menu, Plug, ShieldCheck, Tag, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutlyLogo, OutlyMark } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ContrastToggle } from "@/components/shared/ContrastToggle";
import { can, ROLE_LABEL, type AdminArea, type AdminRole } from "@/lib/admin/perms";
import { Bell } from "./Bell";
import { ScrollArea } from "./ScrollArea";

const NAV: { href: string; label: string; icon: typeof Users; area: AdminArea; group: "Run" | "Support" | "Setup" }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, area: "overview", group: "Run" },
  { href: "/admin/users", label: "Users", icon: Users, area: "users", group: "Run" },
  { href: "/admin/behavior", label: "User behavior", icon: Activity, area: "insights", group: "Run" },
  { href: "/admin/retention", label: "At risk", icon: HeartPulse, area: "retention", group: "Run" },
  { href: "/admin/growth", label: "Growth", icon: Rocket, area: "growth", group: "Run" },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, area: "payments", group: "Run" },
  { href: "/admin/pricing", label: "Pricing", icon: Tag, area: "pricing", group: "Run" },
  { href: "/admin/tickets", label: "Tickets", icon: LifeBuoy, area: "tickets", group: "Support" },
  { href: "/admin/faq", label: "FAQ", icon: BookOpen, area: "faq", group: "Support" },
  { href: "/admin/outbox", label: "Email outbox", icon: Mail, area: "outbox", group: "Support" },
  { href: "/admin/integrations", label: "Integrations", icon: Plug, area: "integrations", group: "Setup" },
  { href: "/admin/platforms", label: "Social platforms", icon: Share2, area: "platforms", group: "Setup" },
  { href: "/admin/landing", label: "Landing page", icon: PanelsTopLeft, area: "site", group: "Setup" },
  { href: "/admin/maintenance", label: "Maintenance", icon: Construction, area: "site", group: "Setup" },
  { href: "/admin/waitlist", label: "Waitlist", icon: Hourglass, area: "site", group: "Setup" },
  { href: "/admin/team", label: "Team & roles", icon: ShieldCheck, area: "team", group: "Setup" },
];

const active = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

function NavList({ role, path, badges, onNavigate, layoutId }: { role: AdminRole; path: string; badges: Partial<Record<AdminArea, number>>; onNavigate?: () => void; layoutId: string }) {
  const items = NAV.filter((n) => can(role, n.area));
  const groups = ["Run", "Support", "Setup"] as const;
  return (
    <nav aria-label="Admin" className="flex flex-col gap-4">
      {groups.map((g) => {
        const list = items.filter((i) => i.group === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <p className="eyebrow mb-1.5 px-3 text-[10.5px]">{g}</p>
            <div className="flex flex-col gap-0.5">
              {list.map(({ href, label, icon: Icon, area }) => {
                const on = active(path, href);
                const n = badges[area] ?? 0;
                return (
                  <Link key={href} href={href} onClick={onNavigate} aria-current={on ? "page" : undefined} className={cn("group relative flex h-10 items-center gap-3 rounded-2xl px-3 text-[14px] font-medium transition-colors duration-200", on ? "text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
                    {on && (
                      <motion.span layoutId={layoutId} className="absolute inset-0 rounded-2xl bg-secondary" transition={{ type: "spring", stiffness: 520, damping: 42 }}>
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-lime" />
                      </motion.span>
                    )}
                    <Icon className={cn("relative h-[17px] w-[17px] transition-transform duration-200 group-hover:scale-110", on && "text-lime-ink")} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                    <span className="relative">{label}</span>
                    {n > 0 && (
                      <span className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-lime px-1.5 text-[11px] font-bold text-[hsl(var(--lime-foreground))]" aria-label={`${n} open`}>
                        {n > 99 ? "99+" : n}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Footer({ admin, path, onNavigate }: { admin: { name: string; role: AdminRole }; path: string; onNavigate?: () => void }) {
  return (
    <div className="mt-auto flex flex-col gap-1 pt-4">
      <Link href="/admin/account" onClick={onNavigate} aria-current={path === "/admin/account" ? "page" : undefined} className={cn("flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] transition-colors", path === "/admin/account" ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
        <KeyRound className="h-4 w-4" aria-hidden /> My password
      </Link>
      <Link href="/" className="flex h-10 items-center gap-3 rounded-2xl px-3 text-[13.5px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
        <Globe className="h-4 w-4" aria-hidden /> View the site
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <ThemeToggle compact plain />
        <ContrastToggle label={false} />
      </div>
      <div className="mt-2 flex items-center gap-2.5 rounded-2xl p-2 hairline">
        <OrbAvatar seed={admin.name} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{admin.name}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{ROLE_LABEL[admin.role]}</span>
        </span>
        <form action="/api/admin/logout" method="post">
          <button type="submit" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export function AdminShell({ admin, badges, children }: { admin: { name: string; role: AdminRole }; badges: Partial<Record<AdminArea, number>>; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  return (
    <div className="admin-root flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
        <aside className="glass hairline flex h-full w-[248px] flex-col overflow-hidden rounded-[28px]" aria-label="Admin sidebar">
          <ScrollArea className="px-3 pb-3 pt-5">
            <div className="mb-6 flex items-center justify-between gap-2 px-2">
              <Link href="/admin" className="text-[17px]" aria-label="Admin overview">
                <OutlyLogo size={28} />
              </Link>
              <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-lime-ink">Admin</span>
            </div>
            <NavList role={admin.role} path={path} badges={badges} layoutId="admin-pill" />
            <Footer admin={admin} path={path} />
          </ScrollArea>
        </aside>
      </div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border/50 bg-background/75 px-4 py-2.5 backdrop-blur-xl lg:border-0 lg:bg-transparent lg:px-8 lg:pt-5 lg:backdrop-blur-0">
          <div className="flex items-center gap-2 lg:hidden">
            <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary">
              <Menu className="h-5 w-5" />
            </button>
            <OutlyMark size={26} />
            <span className="font-display text-[15px] font-bold tracking-tight">Admin</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Bell role={admin.role} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-2 sm:px-6 lg:px-8">
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
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
            >
              <ScrollArea className="px-3 pb-3 pt-4">
                <div className="mb-5 flex items-center justify-between px-2">
                  <OutlyLogo size={26} />
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary" autoFocus>
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <NavList role={admin.role} path={path} badges={badges} onNavigate={() => setOpen(false)} layoutId="admin-pill-m" />
                <Footer admin={admin} path={path} onNavigate={() => setOpen(false)} />
              </ScrollArea>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
