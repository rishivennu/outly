"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLivePlatforms } from "./LivePlatforms";
import { warmAnalytics, whenIdle } from "@/lib/client/warm";

const KEY = "outlly:warm-analytics";
const EVERY = 10 * 60_000;

/**
 * Once the studio is idle, load Analytics in the background (1039), so the first visit to it opens
 * with its numbers already there. At most once every 10 minutes per tab, and never on Analytics itself
 * (it loads its own) or when the browser asks to save data (warmAnalytics checks).
 */
export function WarmUp() {
  const router = useRouter();
  const path = usePathname();
  const live = useLivePlatforms();
  const onAnalytics = path.startsWith("/analytics");
  useEffect(() => {
    if (onAnalytics) return;
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {}
    if (Date.now() - last < EVERY) return;
    return whenIdle(() => {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {}
      warmAnalytics(router, live);
    }, 3000);
  }, [onAnalytics, router, live]);
  return null;
}
