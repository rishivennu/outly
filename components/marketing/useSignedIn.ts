"use client";
import { useEffect, useState } from "react";

/** Name of the readable "you have a session" hint. Middleware keeps it in step with the real (httpOnly) session cookie. */
export const SIGNED_IN_HINT = "outlly_in";

/**
 * Is the visitor signed in? Read in the browser, not on the server, so public pages stay
 * cacheable: the same HTML goes to everyone and the nav swaps "Log in" for "Dashboard" after
 * hydration. The hint is not a credential; the dashboard re-checks the real session.
 */
export function useSignedIn(fallback = false) {
  const [signedIn, setSignedIn] = useState(fallback);
  useEffect(() => {
    setSignedIn(document.cookie.split("; ").some((c) => c === `${SIGNED_IN_HINT}=1`));
  }, []);
  return signedIn;
}
