"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { useOnline } from "@/lib/client/use-online";
import { draftSyncSignal, type DraftSyncSignal } from "@/lib/client/draft-sync-core";

const NONE: DraftSyncSignal = { status: null, pending: false };

/** The banner's words: offline, back, and whether an open draft still has changes to send. */
export function connectivityLine(state: "offline" | "back", d: DraftSyncSignal) {
  if (state === "offline") return d.pending ? "You're offline. Your draft is saved on this device and syncs when you're back. Publishing waits until then." : "You're offline. Saved pages and invoices still open; changes wait until you're back.";
  if (d.status === "conflict") return "Back online. Your draft changed on another device too: pick the version to keep.";
  if (d.status === "failed") return "Back online, but your draft didn't sync. Retry from the draft.";
  if (d.pending) return "Back online. Syncing your draft.";
  if (d.status === "synced") return "Back online. Draft synced.";
  return "Back online.";
}

/** Offline banner + service-worker registration (production only, so dev HMR is never cached). */
export function Connectivity() {
  const online = useOnline();
  const draft = useSyncExternalStore(draftSyncSignal.subscribe, draftSyncSignal.get, () => NONE);
  const [state, setState] = useState<"online" | "offline" | "back">("online");
  const was = useRef(true);
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (!online) setState("offline");
    else if (!was.current) setState("back");
    was.current = online;
  }, [online]);
  // "Back online" stays up while a draft is still going up, then a moment after it lands or fails.
  const busy = state === "back" && draft.pending && draft.status !== "failed" && draft.status !== "conflict";
  useEffect(() => {
    if (state !== "back") return;
    const cap = setTimeout(() => setState("online"), 10_000);
    return () => clearTimeout(cap);
  }, [state]);
  useEffect(() => {
    if (state !== "back" || busy) return;
    const t = setTimeout(() => setState("online"), draft.status === "failed" || draft.status === "conflict" ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [state, busy, draft.status]);
  if (state === "online") return null;
  return (
    <div role="status" className="offline-bar fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[96] mx-auto flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-[20px] bg-foreground px-4 py-2 text-balance text-[13px] font-medium leading-snug text-background shadow-lg">
      {state === "offline" ? <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> : <Wifi className="h-4 w-4 shrink-0" aria-hidden />}
      {connectivityLine(state, draft)}
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
