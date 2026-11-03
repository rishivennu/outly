"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ArrowUpRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { HoverLink } from "./HoverLink";
import { useUser } from "./UserContext";
import { useSignOut } from "./SignOutButton";
import { accountItems, isActive } from "./nav-items";

/** Who is signed in, the way every account surface shows it. Teammates get their own orb, never the owner's avatar. */
export function useWho() {
  const user = useUser();
  return {
    name: user.workspace?.me.name ?? user.name,
    sub: user.workspace ? `In ${user.workspace.ownerName}'s studio` : user.email,
    email: user.workspace?.me.email ?? user.email,
    avatar: user.workspace ? null : user.avatar,
    teammate: !!user.workspace,
  };
}

/** Up/Down/Home/End move between a menu's rows (roving focus), as a native menu does. */
export function menuKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  // The theme switch is a radio group: its own arrows move between Light, Dark and System.
  if ((e.target as HTMLElement).closest('[role="radiogroup"]')) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-mi]")];
  if (!rows.length) return;
  e.preventDefault();
  const i = rows.indexOf(document.activeElement as HTMLElement);
  const n = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
  rows[n]!.focus();
}

const ROW = "group flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] font-medium text-foreground/85 outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:bg-foreground/[0.06] focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:bg-foreground/[0.09]";

/**
 * The menu's rows (1100), shared by the desktop dropdown and the phone drawer: profile links, then billing,
 * help and the website, then theme, then Log out. `onPick` runs as a row is chosen (it closes the surface).
 */
export function AccountRows({ onPick, onLogout, extra, rowClass }: { onPick: () => void; onLogout: (from: HTMLElement) => void; extra?: React.ReactNode; rowClass?: string }) {
  const who = useWho();
  const path = usePathname();
  const { account, more } = accountItems(who.teammate);
  const row = cn(ROW, rowClass);
  const link = ({ href, label, icon: Icon, external }: { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; external?: boolean }) => {
    // Settings links are tabs of one page: none claims it. Others match their children too (/billing/invoices).
    const on = !external && href.split("?")[0] !== "/settings" && isActive(path, href);
    return (
      <HoverLink key={href} href={href} {...(external ? { target: "_blank", rel: "noopener" } : {})} data-mi="" aria-current={on ? "page" : undefined} onClick={onPick} className={cn(row, on && "bg-secondary text-foreground")}>
        <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {external && <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
        {external && <span className="sr-only">(opens in a new tab)</span>}
      </HoverLink>
    );
  };
  return (
    <>
      <div role="group" aria-label="Account" className="flex flex-col gap-0.5">{account.map(link)}</div>
      {extra}
      <div className="acct-sep" role="separator" />
      <div role="group" aria-label="More" className="flex flex-col gap-0.5">{more.map(link)}</div>
      <div className="acct-sep" role="separator" />
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <span className="text-[13px] text-muted-foreground">Theme</span>
        <ThemeToggle compact plain />
      </div>
      <div className="acct-sep" role="separator" />
      <button type="button" data-mi="" onClick={(e) => onLogout(e.currentTarget)} className={cn(row, "text-foreground/85")}>
        <LogOut className="h-[18px] w-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" strokeWidth={1.9} aria-hidden="true" />
        Log out
      </button>
    </>
  );
}

/** Avatar, name and email at the top of the menu and the drawer. */
export function WhoCard({ size = 40, className }: { size?: number; className?: string }) {
  const who = useWho();
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <OrbAvatar avatar={who.avatar} seed={who.email} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-semibold text-foreground">{who.name}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{who.sub}</span>
      </span>
    </div>
  );
}

/**
 * Desktop account menu (1100), opened from the rail's profile circle. Radix Popover: it closes on a click
 * outside, Escape (focus returns to the circle) and route change; it flips to stay on screen. Rows move with
 * the arrow keys. Opens with a short fade and scale from the circle (CSS .acct-menu), opacity only under
 * reduced motion.
 */
export function AccountMenu({ children, side = "right" }: { children: React.ReactNode; side?: "right" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const loggingOut = useRef(false);
  const { ask, dialog } = useSignOut();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild ref={trigger}>
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={content}
            side={side}
            align="end"
            sideOffset={14}
            collisionPadding={12}
            aria-label="Account menu"
            onKeyDown={menuKeys}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              content.current?.querySelector<HTMLElement>("[data-mi]")?.focus();
            }}
            onCloseAutoFocus={(e) => {
              if (!loggingOut.current) return;
              // Confirm once the menu has gone, so the two never fight over focus (as the phone drawer does).
              e.preventDefault();
              loggingOut.current = false;
              ask(trigger.current);
            }}
            data-lenis-prevent
            className="acct-menu lg-glass z-[70] max-h-[var(--radix-popover-content-available-height)] w-[288px] overflow-y-auto overscroll-contain rounded-[24px] p-1.5"
          >
            <WhoCard className="px-3 pb-3 pt-2.5" />
            <div className="acct-sep" role="separator" />
            <AccountRows
              onPick={() => setOpen(false)}
              onLogout={() => {
                loggingOut.current = true;
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {dialog}
    </>
  );
}
