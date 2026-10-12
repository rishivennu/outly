"use client";
import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/** Offline banner + service-worker registration (production only, so dev HMR is never cached). */
export function Connectivity() {
  const [state, setState] = useState<"online" | "offline" | "back">("online");
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    let t: ReturnType<typeof setTimeout>;
    const off = () => setState("offline");
    const on = () => { setState("back"); clearTimeout(t); t = setTimeout(() => setState("online"), 2600); };
    if (!navigator.onLine) off();
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); clearTimeout(t); };
  }, []);
  if (state === "online") return null;
  return (
    <div role="status" className="offline-bar fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[80] mx-auto flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-lg">
      {state === "offline" ? <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> : <Wifi className="h-4 w-4 shrink-0" aria-hidden />}
      {state === "offline" ? "You're offline. Saved pages and invoices still open; changes wait until you're back." : "Back online."}
    </div>
  );
}

/** One delegated listener gives every .ripple-host (all Buttons) a liquid ripple from the press point. */
export function Ripples() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const down = (e: PointerEvent) => {
      const host = (e.target as HTMLElement | null)?.closest<HTMLElement>(".ripple-host");
      if (!host || host.matches(":disabled,[aria-disabled=true]")) return;
      const r = host.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const s = document.createElement("span");
      s.className = "ripple";
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      host.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
    };
    document.addEventListener("pointerdown", down, { passive: true });
    return () => document.removeEventListener("pointerdown", down);
  }, []);
  return null;
}
