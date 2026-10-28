"use client";
import { useEffect, useState } from "react";
import { compactCount, type LiveView } from "@/lib/presence-core";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;
let shared: { at: number; v: LiveView } | null = null; // two strips on one page share one request

/**
 * Real-time counts on every page (1037): creators on Outlly and how many are online now. Polls once a
 * minute while the tab is visible (that poll is also the signed-in person's presence ping) and renders
 * nothing until the server says the numbers are big enough to show.
 */
/** The live counts, polled once a minute while the tab is visible; null until the first answer. Shared by every strip. */
export function useLiveView() {
  const [v, setV] = useState<LiveView | null>(shared?.v ?? null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      if (shared && Date.now() - shared.at < POLL_MS / 2) return alive && setV(shared.v);
      try {
        const r = await fetch("/api/stats/live", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return;
        const next = (await r.json()) as LiveView;
        shared = { at: Date.now(), v: next };
        if (alive) setV(next);
      } catch {
        /* offline: keep the last numbers */
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    const onVis = () => void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return v;
}

export function LiveCount({ compact = false, className }: { compact?: boolean; className?: string }) {
  const v = useLiveView();
  if (!v || (v.total === null && v.online === null)) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const label = [v.total !== null ? `${fmt(v.total)} creators on Outlly` : null, v.online !== null ? `${fmt(v.online)} online now` : null].filter(Boolean).join(", ");
  if (compact) {
    if (v.online === null) return null;
    return (
      <span className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold tabular text-foreground/80 hairline", className)} aria-label={label} title={label}>
        <Dot /> {compactCount(v.online)}
      </span>
    );
  }
  return (
    <p className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-medium tabular text-foreground/75", className)} aria-label={label}>
      {v.online !== null && <Dot />}
      {v.total !== null && <span>{fmt(v.total)} creators on Outlly</span>}
      {v.total !== null && v.online !== null && <span aria-hidden="true">·</span>}
      {v.online !== null && <span>{fmt(v.online)} online now</span>}
    </p>
  );
}

export function Dot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--lime))] opacity-60 motion-reduce:hidden" />
      <span className="relative h-2 w-2 rounded-full bg-[hsl(var(--lime))] ring-1 ring-foreground/25" />
    </span>
  );
}
