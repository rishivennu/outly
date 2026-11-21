"use client";
import { HoverLink as Link } from "@/components/shell/HoverLink";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { useEdgeFade } from "@/lib/client/edge-fade";
import { cn } from "@/lib/utils";
import { AnimatedTabIndicator } from "@/components/ui/easy/AnimatedTabs";

/**
 * Overview plus one tab per platform. The dot says whether that platform is connected for real.
 * R1217: on a phone the row is a real sideways scroller: it runs edge to edge of the page frame (the gutter is
 * padding inside the scroller, so the first and last tab are never clipped and the end has room), every tab stays
 * on one line at its own width, the scrollbar is hidden and the edge fade (useEdgeFade) says there is more only
 * when there is, and the chosen tab is scrolled into the middle whenever the route changes. The page itself never
 * scrolls sideways: the strip owns the horizontal overflow (overscroll-behavior-x: contain in .edge-fade).
 */
export function PlatformTabs({ connected }: { connected: Partial<Record<Platform, boolean>> }) {
  const path = usePathname();
  const live = useLivePlatforms();
  const tabs = [{ href: "/analytics", label: "Overview", platform: null as Platform | null }, ...live.map((p) => ({ href: `/analytics/${p}`, label: PLATFORM_META[p].name, platform: p }))];
  const row = useEdgeFade<HTMLElement>(path);
  return (
    <nav ref={row} aria-label="Analytics views" data-route-tabs="" className="edge-fade -mx-[var(--frame-gutter)] overflow-x-auto overflow-y-hidden px-[var(--frame-gutter)] py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="gseg flex w-max gap-1 rounded-full bg-secondary/60 p-1 hairline">
        {tabs.map((t) => {
          const active = path === t.href;
          return (
            <li key={t.href} className="shrink-0">
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", active ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
                {/* R1288: EasyUI's shared-layout pill (springMorph), still one layoutId across Overview and every platform. */}
                {active && <AnimatedTabIndicator layoutId="an-tab" className="gseg-pane hairline" />}
                <span className="relative flex items-center gap-2">
                  {t.platform ? <PlatformOrb platform={t.platform} size={22} /> : <LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
                  {t.label}
                  {t.platform && (
                    <span className={cn("h-1.5 w-1.5 rounded-full", connected[t.platform] ? "bg-success" : "bg-muted-foreground/40")} aria-label={connected[t.platform] ? "connected" : "not connected"} role="img" />
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The tab bar as the analytics layout renders it (1065): it stays mounted while Overview and each platform
 * swap underneath, so its pill glides and the bar itself never reloads. Overview and every platform dashboard
 * share the studio page frame (1104), so the bar lines up with whichever is showing.
 */
export function AnalyticsTabsBar({ connected }: { connected: Partial<Record<Platform, boolean>> }) {
  return (
    <div data-route-static="" className="an-tabs page-frame pt-8 lg:pt-12">
      <PlatformTabs connected={connected} />
    </div>
  );
}
