"use client";
import { HoverLink as Link } from "@/components/shell/HoverLink";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutDashboard } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn } from "@/lib/utils";

/** Overview plus one tab per platform. The dot says whether that platform is connected for real. */
export function PlatformTabs({ connected }: { connected: Partial<Record<Platform, boolean>> }) {
  const path = usePathname();
  const live = useLivePlatforms();
  const tabs = [{ href: "/analytics", label: "Overview", platform: null as Platform | null }, ...live.map((p) => ({ href: `/analytics/${p}`, label: PLATFORM_META[p].name, platform: p }))];
  return (
    <nav aria-label="Analytics views" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex w-max gap-1 rounded-full bg-secondary/60 p-1 hairline">
        {tabs.map((t) => {
          const active = path === t.href;
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {active && <motion.span layoutId="an-tab" className="absolute inset-0 rounded-full bg-background shadow-sm hairline" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
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
