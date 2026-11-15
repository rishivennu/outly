"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, ClipboardCheck, LayoutGrid, Link2, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { HoverLink } from "./HoverLink";
import { WhoCard, menuKeys, useWho } from "./AccountMenu";
import { useSignOut } from "./SignOutButton";
import { openPalette } from "./CommandPalette";
import { MAIN, TOUR, accountItems, isActive, type NavItem } from "./nav-items";
import { TAB_PAGES, hidesTabBar } from "@/lib/client/tab-bar";

/**
 * Studio pages that are not phone tabs (1100). The tab bar holds Home, Create, Calendar, Inbox and Analytics.
 * Phase 4: on a page that hides the tab bar (/create), the tab pages come first, so every page stays one tap away.
 */
export function drawerItems(teammate: boolean, tabsHidden = false): NavItem[] {
  const tabs = tabsHidden ? TAB_PAGES.map((h) => MAIN.find((m) => m.href === h)!).filter(Boolean) : [];
  return [
    ...tabs,
    { href: "/content", label: "Content", icon: LayoutGrid },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ...(teammate ? [] : [{ href: "/accounts", label: "Connected accounts", icon: Link2 }]),
    { href: "/settings", label: "Settings", icon: Settings },
  ];
}

/** 1154: one row style for every pick in the drawer: 48px tall, a pressed state, hover only where hover exists. */
const ROW =
  "group flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium outline-none transition-[background-color,color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-foreground/[0.09]";
const IDLE = "text-foreground/85 [@media(hover:hover)]:hover:bg-foreground/[0.06] [@media(hover:hover)]:hover:text-foreground";
const ON = "bg-secondary font-semibold text-foreground";
const ICON = "h-[18px] w-[18px] shrink-0 text-muted-foreground transition-colors duration-150 group-aria-[current=page]:text-foreground";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="pt-3 first:pt-1">
      <h2 id={id} className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

/**
 * Phone menu (1100, regrouped in 1154): the top bar's menu button opens a full-height drawer from the right.
 * Who is signed in comes first and opens My profile; then Workspace, My account and Support & billing, the
 * Light / Dark / System choice in words, and Log out on its own at the bottom, outside the scrolling list.
 * Radix Dialog gives the overlay, focus trap, scroll lock, Escape and outside-tap close; a pick or a route change
 * closes it too. It slides in on a time-based curve (.mdrawer in globals.css) and only fades under reduced motion.
 * Safe areas pad the top, right and bottom so nothing sits under the notch or the home indicator.
 */
export function MobileDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const who = useWho();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const loggingOut = useRef(false);
  const searching = useRef(false);
  // 1154: opened by a tap, focus goes to the panel itself (no ring); opened from the keyboard, to the first row.
  // A tapped-open drawer used to put the focus ring (lime in dark mode) round its first row, which read as a frame.
  const byPointer = useRef(false);
  const { ask, dialog } = useSignOut();
  const { account, more } = accountItems(who.teammate);
  const close = () => setOpen(false);

  useEffect(() => setOpen(false), [path]);
  // Rotating a tablet past the desktop breakpoint swaps in the rail; never leave an invisible modal behind.
  useEffect(() => {
    if (!open) return;
    const mq = matchMedia("(min-width: 1024px)");
    const off = () => mq.matches && setOpen(false);
    mq.addEventListener("change", off);
    return () => mq.removeEventListener("change", off);
  }, [open]);

  const link = ({ href, label, icon: Icon, external }: NavItem & { external?: boolean }) => {
    // Settings tabs are one page: only the Settings row itself claims /settings.
    const on = !external && !href.includes("?") && isActive(path, href);
    return (
      <HoverLink key={href} href={href} data-mi="" data-tour={external ? undefined : TOUR[href]} {...(external ? { target: "_blank", rel: "noopener" } : {})} aria-current={on ? "page" : undefined} onClick={close} className={cn(ROW, on ? ON : IDLE)}>
        <Icon className={ICON} strokeWidth={1.9} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {external && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        {external && <span className="sr-only">(opens in a new tab)</span>}
      </HoverLink>
    );
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            data-tour="menu"
            aria-label="Open menu"
            onPointerDown={() => (byPointer.current = true)}
            onKeyDown={() => (byPointer.current = false)}
            className={className}
          >
            <Menu aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="mdrawer-scrim fixed inset-0 z-[65] bg-foreground/35 lg:hidden" />
          <Dialog.Content
            ref={panel}
            aria-describedby={undefined}
            onKeyDown={menuKeys}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              if (byPointer.current) panel.current?.focus({ preventScroll: true });
              else body.current?.querySelector<HTMLElement>("[data-mi]")?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(e) => {
              // Search (1105: it left the top bar) opens the palette once the drawer has gone, same reason as Log out.
              if (searching.current) {
                e.preventDefault();
                searching.current = false;
                openPalette();
                return;
              }
              if (!loggingOut.current) return;
              // Log out confirms once the drawer has gone, so the two dialogs never fight over focus.
              e.preventDefault();
              loggingOut.current = false;
              ask(trigger.current);
            }}
            className="mdrawer fixed bottom-0 right-0 top-0 z-[66] flex w-[min(85vw,360px)] flex-col bg-background outline-none focus:outline-none focus-visible:outline-none lg:hidden"
          >
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <div ref={body} className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-1 px-2 pb-2 pt-3">
                <WhoCard size={44} href="/settings?tab=profile" onPick={close} className="min-w-0 flex-1" />
                <Dialog.Close className="mtop-btn shrink-0" aria-label="Close menu">
                  <X aria-hidden="true" />
                </Dialog.Close>
              </div>
              <div className="acct-sep mx-3" role="separator" />
              {/* The list scrolls on its own; the header and Log out stay put. */}
              <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
                <Section id="dr-work" title="Workspace">
                  <button
                    type="button"
                    data-mi=""
                    onClick={() => {
                      searching.current = true;
                      close();
                    }}
                    className={cn(ROW, IDLE)}
                  >
                    <Search className={ICON} strokeWidth={1.9} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Search</span>
                  </button>
                  {drawerItems(who.teammate, hidesTabBar(path)).map(link)}
                </Section>
                <Section id="dr-me" title="My account">{account.map(link)}</Section>
                <Section id="dr-help" title={who.teammate ? "Support" : "Support & billing"}>
                  {more.map((m) => link(m.href === "/billing" ? { ...m, label: "Billing" } : m))}
                </Section>
                <section aria-labelledby="dr-theme" className="pt-3">
                  <h2 id="dr-theme" className="px-3 pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Appearance</h2>
                  <div className="px-1">
                    <ThemeToggle plain className="flex w-full [&>button]:h-11 [&>button]:flex-1" />
                  </div>
                </section>
              </div>
              <div className="border-t border-foreground/[0.08] px-2 pb-2 pt-2">
                <button
                  type="button"
                  data-mi=""
                  onClick={() => {
                    loggingOut.current = true;
                    close();
                  }}
                  className={cn(ROW, IDLE)}
                >
                  <LogOut className={ICON} strokeWidth={1.9} aria-hidden="true" />
                  Log out
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {dialog}
    </>
  );
}
