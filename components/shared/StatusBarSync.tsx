"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncStatusBar } from "@/lib/theme/statusbar";

/**
 * 1108: after every page change (public page to studio and back swaps the light background) and once on load,
 * point the status bar at the page now on screen. Renders nothing.
 */
export function StatusBarSync() {
  const path = usePathname();
  useEffect(() => {
    syncStatusBar();
  }, [path]);
  return null;
}
