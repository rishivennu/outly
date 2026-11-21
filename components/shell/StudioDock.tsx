"use client";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Dock, DockItem, DockSeparator } from "@/components/ui/motion/Dock";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { OutllyLogoIcon } from "@/components/brand/OutllyBrand";
import { NoticesBell } from "./NoticesBell";
import { NavStyleSwitch } from "./NavStyleSwitch";
import { openPalette } from "./CommandPalette";
import { AccountMenu, useWho } from "./AccountMenu";
import { MAIN, TOUR, isActive, workspaceItems } from "./nav-items";
import { usePressFx } from "@/lib/motion/useFluid";

export { DOCK_MAIN_PAD } from "@/lib/nav-config";

/** A 44px place in the dock for a control that brings its own button (the bell, the account menu). */
function Slot({ children }: { children: React.ReactNode }) {
  return <div className="dock-item dock-slot relative flex h-11 w-11 shrink-0 items-center justify-center">{children}</div>;
}

/**
 * R1290: the studio's second desktop navigation, picked in Settings > Personalization (or by the admin for
 * everyone). Same destinations, order and tour targets as the rail (PulseRail), laid out along the bottom: the
 * brand, the studio sections, the workspace, then Search, Notices and the account menu. Desktop only; phones keep
 * the tab bar. The layout does not render the rail at all while this is on, and pads the page so it scrolls clear.
 */
export function StudioDock() {
  const path = usePathname();
  const who = useWho();
  // The shared press for the whole studio, which the rail mounts when it is the one on screen.
  usePressFx();
  const lower = workspaceItems(who.teammate);
  return (
    <div className="studio-dock pointer-events-none fixed inset-x-0 bottom-[max(16px,var(--sa-b))] z-40 hidden justify-center px-3 lg:flex">
      <Dock label="Primary" className="pointer-events-auto max-w-full">
        <DockItem label="Outlly dashboard" href="/home" className="dock-logo">
          <OutllyLogoIcon size={22} />
        </DockItem>
        {MAIN.map(({ href, label, icon: Icon }) => {
          const create = href === "/create";
          return (
            <DockItem
              key={href}
              label={create ? "New post" : label}
              href={href}
              active={isActive(path, href)}
              attrs={{ "data-tour": TOUR[href] }}
              // R1292: outlined like the rail's .rail-new, so the solid lime fill marks only the page you are on.
              className={create ? "dock-new" : undefined}
            >
              <Icon strokeWidth={1.8} />
            </DockItem>
          );
        })}
        <DockSeparator />
        {lower.map(({ href, label, icon: Icon }) => (
          <DockItem key={href} label={label} href={href} active={isActive(path, href)} attrs={{ "data-tour": TOUR[href] }}>
            <Icon strokeWidth={1.8} />
          </DockItem>
        ))}
        <DockSeparator />
        <NavStyleSwitch variant="dock" />
        <DockItem label="Search" onClick={() => openPalette()} attrs={{ "aria-haspopup": "dialog", "aria-keyshortcuts": "Control+K Meta+K" }}>
          <Search strokeWidth={1.8} />
        </DockItem>
        <Slot>
          <NoticesBell placement="above" className="rounded-[16px] text-foreground/80 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </Slot>
        <Slot>
          <AccountMenu side="top">
            <button type="button" aria-label={`Account menu, ${who.name}`} className="dock-me grid h-11 w-11 place-items-center rounded-full outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring">
              <OrbAvatar avatar={who.avatar} seed={who.email} size={34} />
            </button>
          </AccountMenu>
        </Slot>
      </Dock>
    </div>
  );
}
