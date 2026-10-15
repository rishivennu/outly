"use client";
import { useEffect, useState } from "react";
import { PageTransition } from "@/components/shared/PageTransition";

let inAuth = false; // module scope: true while one auth page is mounted

/**
 * Coming in from elsewhere keeps the site's page transition. Switching between sign in and sign up
 * is a segmented control, not a page change, so it skips the wave and the form animates itself in.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const [within] = useState(() => inAuth);
  useEffect(() => {
    inAuth = true;
    return () => { inAuth = false; };
  }, []);
  return within ? <>{children}</> : <PageTransition>{children}</PageTransition>;
}
