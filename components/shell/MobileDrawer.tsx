"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { ClipboardCheck, LayoutGrid, Link2, Menu, Search, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverLink } from "./HoverLink";
import { AccountRows, WhoCard, menuKeys, useWho } from "./AccountMenu";
import { useSignOut } from "./SignOutButton";
import { openPalette } from "./CommandPalette";
import { TOUR, isActive, type NavItem } from "./nav-items";

/** Studio pages that are not phone tabs (1100). The tab bar holds Home, Create, Calendar, Inbox and Analytics. */
export function drawerItems(teammate: boolean): NavItem[] {
  return [
    { href: "/content", label: "Content", icon: LayoutGrid },
    { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
    ...(teammate ? [] : [{ href: "/accounts", label: "Connected accounts", icon: Link2 }]),
    { href: "/settings", label: "Settings", icon: Settings },
  ];
}

const ROW = "h-12 text-[15px]";

/**
 * Phone menu (1100): the top bar's menu button opens a full-height drawer from the right with who is signed in,
 * the studio pages that are not tabs, the account rows the desktop menu has (theme included) and Log out.
 * Radix Dialog gives the overlay, focus trap, scroll lock, Escape and outside-tap close; a pick or a route change
 * closes it too. It slides in on a time-based curve (.mdrawer in globals.css) and only fades under reduced motion.
 * Safe areas pad the top, right and bottom so nothing sits under the notch or the home indicator.
 */
export function MobileDrawer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const who = useWho();
  const trigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const loggingOut = useRef(false);
  const searching = useRef(false);
  const { ask, dialog } = useSignOut();

  useEffect(() => setOpen(false), [path]);
  // Rotating a tablet past the desktop breakpoint swaps in the rail; never leave an invisible modal behind.
  useEffect(() => {
    if (!open) return;
    const mq = matchMedia("(min-width: 1024px)");
    const off = () => mq.matches && setOpen(false);
    mq.addEventListener("change", off);
    return () => mq.removeEventListener("change", off);
  }, [open]);

  const page = (item: NavItem) => {
    const { href, label, icon: Icon } = item;
    const on = isActive(path, href);
    return (
      <HoverLink key={href} href={href} data-mi="" data-tour={TOUR[href]} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)} className={cn("group flex w-full items-center gap-3 rounded-xl px-3 font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.09]", ROW, on ? "bg-secondary text-foreground" : "text-foreground/85 hover:bg-foreground/[0.06]")}>
        <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </HoverLink>
    );
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button ref={trigger} type="button" data-tour="menu" aria-label="Open menu" className={className}>
            <Menu aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="mdrawer-scrim fixed inset-0 z-[65] bg-foreground/35 lg:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            onKeyDown={menuKeys}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              body.current?.querySelector<HTMLElement>("[data-mi]")?.focus({ preventScroll: true });
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
            className="mdrawer fixed bottom-0 right-0 top-0 z-[66] flex w-[min(85vw,360px)] flex-col bg-background outline-none lg:hidden"
          >
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <div className="flex items-center gap-2 px-3 pb-3 pt-3">
              <WhoCard size={44} className="flex-1 pl-1" />
              <Dialog.Close className="mtop-btn" aria-label="Close menu">
                <X aria-hidden="true" />
              </Dialog.Close>
            </div>
            <div className="acct-sep mx-3" role="separator" />
            <div ref={body} data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-2">
              <button
                type="button"
                data-mi=""
                onClick={() => {
                  searching.current = true;
                  setOpen(false);
                }}
                className={cn("group flex w-full items-center gap-3 rounded-xl px-3 font-medium text-foreground/85 outline-none transition-colors duration-150 hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.09]", ROW)}
              >
                <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">Search or jump</span>
              </button>
              <nav aria-label="Studio" className="flex flex-col gap-0.5">{drawerItems(who.teammate).map(page)}</nav>
              <div className="acct-sep" role="separator" />
              <AccountRows
                rowClass={ROW}
                onPick={() => setOpen(false)}
                onLogout={() => {
                  loggingOut.current = true;
                  setOpen(false);
                }}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {dialog}
    </>
  );
}
