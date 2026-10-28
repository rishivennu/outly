"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { BarChart3, Bell, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Home, Inbox, LayoutGrid, LifeBuoy, Link2, Monitor, Moon, Plus, Settings, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_SELLS_PLANS, appTitle } from "@/lib/app-mode";
import { APP_MORE_EVENT, haptic, markBack, useAppMode } from "@/lib/client/app-mode";
import { nativeCall, shellInfo } from "@/lib/client/native";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { useTheme, type ThemeChoice } from "@/components/shared/ThemeToggle";
import { useUser } from "./UserContext";
import { NoticesBell } from "./NoticesBell";
import { HoverLink } from "./HoverLink";

/*
 * Android app chrome (Apple HIG + Liquid Glass): large-title navigation bar, floating glass tab bar with a
 * separate Create button, an account sheet for everything else, and Create presented as a sheet.
 * Rendered on the server for every phone but shown only under html[data-app] (app/mobile-app.css), so the
 * app never flashes the web layout first and web visitors never see any of it.
 */

const TABS = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 } as const;
const SHEET = { type: "spring", stiffness: 380, damping: 38 } as const;

const isActive = (path: string, href: string) => (href === "/home" ? path === "/home" : path.startsWith(href));

function useScrollState() {
  const [s, setS] = useState({ scrolled: false, down: false });
  useEffect(() => {
    let last = scrollY;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = scrollY;
        // a few pixels of slack so a finger resting on the glass doesn't make the bar flicker
        const down = Math.abs(y - last) < 6 ? null : y > last && y > 80;
        last = y;
        setS((p) => ({ scrolled: y > 36, down: down ?? p.down }));
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", on);
    };
  }, []);
  return s;
}

function useGreeting(timezone: string) {
  const [g, setG] = useState<{ date: string; hello: string } | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      let tz = timezone;
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      } catch {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
      const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(now).replace(/^(\w+)/, "$1,");
      setG({ date, hello: hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening" });
    };
    tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => clearInterval(t);
  }, [timezone]);
  return g;
}

/** Route attribute for CSS, haptic ticks, Back direction, and keeping Play-policy screens out of the app. */
export function AppEffects() {
  const app = useAppMode();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!app) return;
    document.documentElement.dataset.appRoute = path.split("/")[1] || "home";
  }, [app, path]);
  useEffect(() => {
    if (!app || APP_SELLS_PLANS || !path.startsWith("/billing")) return;
    router.replace("/settings");
  }, [app, path, router]);
  useEffect(() => {
    if (!app) return;
    const pop = () => markBack();
    const tap = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[role=switch],[role=tab],[role=radio],[data-haptic],.app-tab,.app-fab");
      if (el) haptic(el.matches("[role=switch],.app-fab") ? 12 : 7);
    };
    addEventListener("popstate", pop);
    document.addEventListener("click", tap, { capture: true });
    return () => {
      removeEventListener("popstate", pop);
      document.removeEventListener("click", tap, { capture: true });
    };
  }, [app]);
  return null;
}

export function AppNavBar() {
  const path = usePathname();
  const app = useAppMode();
  const user = useUser();
  const { scrolled } = useScrollState();
  const greeting = useGreeting(user.timezone);
  if (path.startsWith("/create")) return <AppSheetHeader />;
  const { title, parent } = appTitle(path);
  const home = path === "/home";
  const first = (user.workspace?.me.name ?? user.name).split(" ")[0];
  const big = home ? (greeting ? `${greeting.hello}, ${first}` : `Hi, ${first}`) : title;
  return (
    <div className="app-only app-nav lg:hidden">
      <header className="app-bar" data-scrolled={scrolled}>
        <div className="app-bar-side">
          {parent && (
            <Link href={parent.href} onClick={markBack} className="app-back" aria-label={`Back to ${parent.label}`}>
              <ChevronLeft className="h-6 w-6" strokeWidth={2.4} aria-hidden="true" />
              <span className="truncate">{parent.label}</span>
            </Link>
          )}
        </div>
        <p className="app-bar-title" aria-hidden="true">{home ? "Home" : title}</p>
        <div className="app-bar-side justify-end">
          {app && <NoticesBell placement="below" className="app-round" />}
          <button type="button" className="app-avatar" aria-label="Account and more" aria-haspopup="dialog" onClick={() => dispatchEvent(new Event(APP_MORE_EVENT))}>
            <OrbAvatar avatar={user.workspace ? null : user.avatar} seed={user.workspace?.me.email ?? user.email} size={34} />
          </button>
        </div>
      </header>
      {!parent && (
        <div className="app-large" data-scrolled={scrolled}>
          {home && <p className="app-eyebrow" suppressHydrationWarning>{greeting?.date ?? "\u00A0"}</p>}
          <p className="app-large-title" suppressHydrationWarning>{big}</p>
        </div>
      )}
    </div>
  );
}

/** Create, presented the iOS way: a sheet with a grabber that you can pull down to dismiss. */
function AppSheetHeader() {
  const router = useRouter();
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const dismiss = () => {
    markBack();
    if (history.length > 1) router.back();
    else router.replace("/home");
  };
  const main = () => document.getElementById("main");
  const head = useRef<HTMLDivElement>(null);
  const move = (dy: number, animate: boolean) => {
    for (const el of [main(), head.current]) {
      if (!el) continue;
      el.style.transition = animate ? "transform .42s cubic-bezier(.32,.72,0,1)" : "none";
      el.style.transform = dy ? `translate3d(0,${dy}px,0)` : "";
    }
  };
  return (
    <div
      ref={head}
      className="app-only app-sheet-head lg:hidden"
      onPointerDown={(e) => {
        if ((e.target as Element).closest("a,button")) return;
        drag.current = { y: e.clientY, dy: 0 };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        // rubber band: follows the finger 1:1 downward, resists upward
        const raw = e.clientY - drag.current.y;
        drag.current.dy = raw > 0 ? raw : raw / 6;
        move(drag.current.dy, false);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.dy > 110) {
          haptic(10);
          move(innerHeight, true);
          setTimeout(dismiss, 260);
        } else move(0, true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        move(0, true);
      }}
    >
      <span className="app-grabber" aria-hidden="true" />
      <div className="app-sheet-row">
        <button type="button" onClick={dismiss} className="app-round" aria-label="Close">
          <X className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <p className="app-sheet-title">New post</p>
        <Link href="/content" className="app-sheet-action">Drafts</Link>
      </div>
    </div>
  );
}

export function AppTabBar() {
  const path = usePathname();
  const { down } = useScrollState();
  if (path.startsWith("/create")) return null;
  return (
    <div className="app-only app-tabbar-wrap lg:hidden" data-compact={down}>
      <nav aria-label="Tabs" className="app-tabbar liquid">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          // Analytics warms its whole page on touch (1039); the other tabs keep Next's own prefetch.
          const TabLink = href === "/analytics" ? HoverLink : Link;
          return (
            <TabLink key={href} href={href} aria-current={active ? "page" : undefined} className={cn("app-tab", active && "is-active")}>
              {active && <motion.span layoutId="app-tab-pill" className="app-tab-pill" transition={SPRING} />}
              <Icon className="relative h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
              <span className="app-tab-label">{label}</span>
            </TabLink>
          );
        })}
      </nav>
      <Link href="/create" className="app-fab" aria-label="New post">
        <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
      </Link>
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Auto", Icon: Monitor },
];

export function AppMoreSheet() {
  const app = useAppMode();
  const path = usePathname();
  const user = useUser();
  const { choice, set } = useTheme();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    addEventListener(APP_MORE_EVENT, on);
    return () => removeEventListener(APP_MORE_EVENT, on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  const [push, setPush] = useState(false);
  useEffect(() => {
    if (app) void shellInfo().then((i) => setPush(!!i?.push));
  }, [app]);
  if (!app) return null;
  const owner = !user.workspace;
  const groups = [
    [
      { href: "/content", label: "Content", icon: LayoutGrid, tint: "#5e5ce6" },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck, tint: "#ff9f0a" },
      ...(owner ? [{ href: "/accounts", label: "Connected accounts", icon: Link2, tint: "#0a84ff" }] : []),
    ],
    [
      { href: "/settings", label: "Settings", icon: Settings, tint: "#8e8e93" },
      { href: "/support", label: "Help centre", icon: LifeBuoy, tint: "#30d158" },
    ],
  ];
  const onDragEnd = (_: unknown, i: PanInfo) => {
    if (i.offset.y > 120 || i.velocity.y > 600) setOpen(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="app-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="app-sheet liquid"
                data-lenis-prevent
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={SHEET}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.05, bottom: 0.9 }}
                onDragEnd={onDragEnd}
              >
                <span className="app-grabber" aria-hidden="true" />
                <div className="app-sheet-row">
                  <span className="w-[60px]" />
                  <Dialog.Title className="app-sheet-title">Account</Dialog.Title>
                  <Dialog.Close className="app-sheet-action w-[60px] text-right">Done</Dialog.Close>
                </div>
                <Link href="/settings" className="app-group app-profile">
                  <OrbAvatar avatar={owner ? user.avatar : null} seed={user.workspace?.me.email ?? user.email} size={56} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[19px] font-semibold">{user.workspace?.me.name ?? user.name}</span>
                    <span className="block truncate text-[14px] text-muted-foreground">{owner ? user.email : `In ${user.workspace!.ownerName}'s studio`}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/70" aria-hidden="true" />
                </Link>
                {groups.map((g, gi) => (
                  <ul key={gi} className="app-group">
                    {g.map(({ href, label, icon: Icon, tint }) => (
                      <li key={href}>
                        <Link href={href} className="app-row" aria-current={isActive(path, href) ? "page" : undefined}>
                          <span className="app-row-icon" style={{ background: tint }}><Icon className="h-[17px] w-[17px]" strokeWidth={2.2} aria-hidden="true" /></span>
                          <span className="flex-1">{label}</span>
                          <ChevronRight className="h-5 w-5 text-muted-foreground/70" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ))}
                {push && (
                  <ul className="app-group">
                    <li>
                      <button type="button" className="app-row w-full text-left" onClick={() => void nativeCall("OutllyShell", "openNotificationSettings").catch(() => {})}>
                        <span className="app-row-icon" style={{ background: "#ff375f" }}><Bell className="h-[17px] w-[17px]" strokeWidth={2.2} aria-hidden="true" /></span>
                        <span className="flex-1">Notifications</span>
                        <ChevronRight className="h-5 w-5 text-muted-foreground/70" aria-hidden="true" />
                      </button>
                    </li>
                  </ul>
                )}
                <p className="app-group-label" id="app-theme-label">Appearance</p>
                <div role="radiogroup" aria-labelledby="app-theme-label" className="app-seg">
                  {THEMES.map(({ value, label, Icon }) => (
                    <button key={value} type="button" role="radio" aria-checked={choice === value} onClick={() => set(value)} className="app-seg-item">
                      {choice === value && <motion.span layoutId="app-seg-pill" className="app-seg-pill" transition={SPRING} />}
                      <Icon className="relative h-4 w-4" aria-hidden="true" />
                      <span className="relative">{label}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
