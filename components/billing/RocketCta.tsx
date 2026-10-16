"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { OutlyMark } from "@/components/brand/Logo";
import { BounceText } from "@/components/marketing/Split";
import { useWaitlist } from "@/components/marketing/useWaitlist";
import { cn } from "@/lib/utils";

/** Window event a CTA fires to raise the veil; LaunchHost (root layout) owns it across the navigation. */
export const LAUNCH_EVENT = "outlly:launch";

/** Timings (ms). The fill slides the rocket across, it takes off, the veil sweeps in, then we navigate. */
const SLIDE = 700;
const LIFT = 420;
const VEIL = 380;

/**
 * Pricing card call to action, built like the Live Activity bar: a lime fill with the rocket at its tip.
 * Click: the bar empties, the fill slides the rocket from left to right, the rocket takes off, a dark
 * veil sweeps across and the next page (checkout, signup) slides in from under it. Modifier clicks and
 * reduced motion skip the show and just follow the link.
 */
export function RocketCta({
  href,
  label,
  signup = false,
  tone = "lime",
  veil = "Taking you to checkout",
  className,
}: {
  href: string;
  label: string;
  /** The free plan: follows the waitlist switch like SignupCta (Join the waitlist -> /waitlist). */
  signup?: boolean;
  /** lime (default) or ink, for a lime card where a lime button would vanish. */
  tone?: "lime" | "ink";
  /** What the veil says while the next page loads. */
  veil?: string;
  className?: string;
}) {
  const router = useRouter();
  const waitlist = useWaitlist();
  const to = signup ? (waitlist ? "/waitlist" : "/signup") : href;
  const text = signup && waitlist ? "Join the waitlist" : label;
  const say = signup ? (waitlist ? "Saving your place" : "Setting up your studio") : veil;
  const [go, setGo] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    router.prefetch(to);
  }, [router, to]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (go) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return router.push(to);
    setGo(true);
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    at(SLIDE + LIFT * 0.55, () => window.dispatchEvent(new CustomEvent(LAUNCH_EVENT, { detail: say })));
    at(SLIDE + LIFT * 0.55 + VEIL, () => router.push(to));
  }

  return (
    <Link
      href={to}
      onClick={onClick}
      data-bounce=""
      data-go={go ? "1" : undefined}
      aria-busy={go || undefined}
      className={cn("rk-cta", tone === "ink" && "rk-ink", className)}
      style={{ ["--rk-slide" as string]: `${SLIDE}ms`, ["--rk-lift" as string]: `${LIFT}ms` }}
    >
      <span className="rk-clip" aria-hidden="true">
        <span className="rk-fill" />
      </span>
      <span className="rk-label">
        <BounceText text={text} />
      </span>
      <span className="rk-rider" aria-hidden="true">
        <span className="rk-rocket">
          <span className="rk-trail" />
          <OutlyMark variant={tone === "ink" ? "white" : "ink"} size={18} className="la-rocket" />
        </span>
      </span>
      <span className="sr-only" aria-live="polite">{go ? say : ""}</span>
    </Link>
  );
}

/** Full-screen dark sheet that carries the launch from one page to the next. Always dark, like the Live Activity. */
export function LaunchVeil({ say, phase }: { say: string; phase: "in" | "out" }) {
  return (
    <div className="rk-veil" data-phase={phase} aria-hidden="true">
      <span className="la-grid" />
      <span className="rk-veil-mark">
        <OutlyMark size={56} />
      </span>
      <span className="rk-veil-say">{say}</span>
    </div>
  );
}

/**
 * Mounted once in the root layout, which survives client navigation: it owns the veil, so the sheet
 * that covers the pricing page is the same element that slides off the next one. No gap, no flash.
 */
export function LaunchHost() {
  const pathname = usePathname();
  const [veil, setVeil] = useState<{ say: string; phase: "in" | "out"; from: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setVeil({ say: (e as CustomEvent<string>).detail ?? "", phase: "in", from: window.location.pathname });
    window.addEventListener(LAUNCH_EVENT, on);
    return () => window.removeEventListener(LAUNCH_EVENT, on);
  }, []);
  useEffect(() => {
    if (!veil) return;
    // Arrived (or the push failed): slide it off. A safety timer means it can never get stuck on screen.
    if (veil.phase === "in" && pathname !== veil.from) return setVeil({ ...veil, phase: "out" });
    const t = window.setTimeout(() => setVeil(veil.phase === "out" ? null : { ...veil, phase: "out" }), veil.phase === "out" ? 700 : 8000);
    return () => clearTimeout(t);
  }, [pathname, veil]);
  return veil ? <LaunchVeil say={veil.say} phase={veil.phase} /> : null;
}
