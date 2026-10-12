"use client";
import { useEffect, useState } from "react";

/** Readable hint that waitlist mode is on. Middleware sets and clears it from the admin switch. */
export const WAITLIST_HINT = "outlly_wl";

/**
 * Is the site in waitlist mode? Read from the hint cookie after hydration, like useSignedIn, so
 * public pages stay cacheable. Only labels follow it: /signup itself is redirected by middleware
 * and the signup API refuses new accounts, so a stale hint can never let anyone skip the line.
 */
export function useWaitlist() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(document.cookie.split("; ").some((c) => c === `${WAITLIST_HINT}=1`));
  }, []);
  return on;
}
