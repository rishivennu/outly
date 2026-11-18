"use client";
import { useEffect, useState } from "react";

/** Name of the readable "you have a session" hint. Middleware keeps it in step with the real (httpOnly) session cookie. */
export const SIGNED_IN_HINT = "outlly_in";

/**
 * Is the visitor signed in? Read in the browser, not on the server, so public pages stay
 * cacheable: the same HTML goes to everyone and the nav swaps "Log in" for "Dashboard" after
 * hydration. The hint is not a credential; the dashboard re-checks the real session.
 */
/** R1208: the same check, read right now. Only for code that never renders on the server (Pip is ssr:false). */
export function hasSignedInHint() {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === `${SIGNED_IN_HINT}=1`);
}

export function useSignedIn(fallback = false) {
  const [signedIn, setSignedIn] = useState(fallback);
  useEffect(() => {
    setSignedIn(document.cookie.split("; ").some((c) => c === `${SIGNED_IN_HINT}=1`));
  }, []);
  return signedIn;
}
