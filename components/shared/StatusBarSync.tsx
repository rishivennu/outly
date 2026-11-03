"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { syncStatusBar } from "@/lib/theme/statusbar";

/**
 * 1108: after every page change (public page to studio and back swaps the light background), once on load, and
 * whenever <html> changes theme or opens/closes the first-launch welcome (several code paths do that), point the
 * status bar at what is on screen now. Renders nothing.
 */
export function StatusBarSync() {
  const path = usePathname();
  useEffect(() => {
    syncStatusBar();
  }, [path]);
  useEffect(() => {
    const mo = new MutationObserver(() => syncStatusBar());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-welcome"] });
    return () => mo.disconnect();
  }, []);
  return null;
}
