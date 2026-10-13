"use client";
import { useEffect, useState } from "react";
import { LANDING_HINT } from "@/lib/landing";

/**
 * Landing anchors the admin switched off (read from the hint cookie the middleware keeps in step, like
 * useWaitlist). On the home page itself the DOM is the truth: a link stays only if its section is there.
 */
export function useHiddenSections(pathname?: string | null) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${LANDING_HINT}=`))?.slice(LANDING_HINT.length + 1) ?? "";
    const set = new Set(decodeURIComponent(raw).split(".").filter(Boolean));
    if (pathname === "/") for (const id of ["how", "features", "demo", "why", "platforms", "compare", "pricing", "faq"]) if (!document.getElementById(id)) set.add(id);
    setHidden(set);
  }, [pathname]);
  return hidden;
}
