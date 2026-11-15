"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MotionRoot } from "./MotionRoot";
import { SmoothScroll } from "@/components/marketing/SmoothScroll";
import { ScrollProgress } from "./ScrollProgress";
import { PageScrollbar } from "@/components/marketing/PageScrollbar";
import { CookieBanner } from "./CookieConsent";
import { Connectivity, Ripples } from "./Connectivity";
import { LazyChat } from "@/components/support/LazyChat";
import { LAUNCH_EVENT } from "@/lib/client/launch-event";
import { whenSettled } from "@/lib/client/when-idle";
import { isAppPath } from "@/lib/client/routes";

// Nothing on the first paint needs these: they load once the page has loaded and the browser is idle.
const PostHogProvider = dynamic(() => import("@/components/analytics/PostHogProvider").then((m) => m.PostHogProvider), { ssr: false });
const DeviceHint = dynamic(() => import("./DeviceHint").then((m) => m.DeviceHint), { ssr: false });
const LiquidGlass = dynamic(() => import("./LiquidGlass").then((m) => m.LiquidGlass), { ssr: false });
const LaunchHost = dynamic(() => import("@/components/billing/RocketCta").then((m) => m.LaunchHost), { ssr: false });

/**
 * The root layout's client pieces (perf B2). Kept in the first bundle: what paints or answers at once (the page
 * scrollbar and scroll frame, which are server rendered so the native bar never jumps; the cookie banner; the offline
 * banner and ripples; Pip's launcher, which already defers its own code). Deferred until settled: analytics, the
 * laptop hint, the liquid glass refraction and the pricing launch veil. A launch fired before then is kept and handed
 * to the veil, so the pricing CTA still plays in full.
 * Lenis smooth scroll waits too on a visit that starts inside the app (it is only ever needed on scroll).
 */
export function RootClient({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [appStart] = useState(() => isAppPath(path));
  const [settled, setSettled] = useState(false);
  const [launch, setLaunch] = useState<string | undefined>(undefined);
  useEffect(() => whenSettled(() => setSettled(true)), []);
  useEffect(() => {
    if (settled) return;
    const on = (e: Event) => {
      setLaunch((e as CustomEvent<string>).detail ?? "");
      setSettled(true);
    };
    window.addEventListener(LAUNCH_EVENT, on, { once: true });
    return () => window.removeEventListener(LAUNCH_EVENT, on);
  }, [settled]);
  return (
    <MotionRoot>
      <SmoothScroll lazy={appStart} />
      <ScrollProgress />
      <PageScrollbar />
      {children}
      <LazyChat />
      <CookieBanner />
      <Connectivity />
      <Ripples />
      {settled && (
        <>
          <PostHogProvider />
          <DeviceHint />
          <LaunchHost initial={launch} />
          <LiquidGlass />
        </>
      )}
    </MotionRoot>
  );
}
