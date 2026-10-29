"use client";
import { useEffect, useRef, useState } from "react";
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

/**
 * A number that shows it is live (1041): when the count changes, the new figure rolls up into place, so
 * the motion only ever means "this just changed". No status dot and no middle dot (Hallmark floor 10):
 * the figures carry it, set in full ink while the words around them sit back.
 */
function Num({ n, format }: { n: number; format: (n: number) => string }) {
  const last = useRef(n);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (last.current !== n) setBump((b) => b + 1);
    last.current = n;
  }, [n]);
  return (
    <span className="lc-num">
      <span key={bump} className={bump ? "lc-roll" : undefined}>
        {format(n)}
      </span>
    </span>
  );
}

/** compact: "3 online" (phone top bar). pill: a glass pill (studio Home). Default: a sentence (website nav, footer). */
export function LiveCount({ compact = false, pill = false, className }: { compact?: boolean; pill?: boolean; className?: string }) {
  const v = useLiveView();
  if (!v || (v.total === null && v.online === null)) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const label = [v.total !== null ? `${fmt(v.total)} creators on Outlly` : null, v.online !== null ? `${fmt(v.online)} online now` : null].filter(Boolean).join(", ");
  if (compact) {
    if (v.online === null) return null;
    return (
      <span className={cn("lc inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12px] hairline", className)} aria-label={label} title={label}>
        <Num n={v.online} format={compactCount} /> online
      </span>
    );
  }
  const both = v.total !== null && v.online !== null;
  const body = (
    <>
      {v.total !== null && (
        <span>
          <Num n={v.total} format={fmt} /> creators{pill ? "" : " on Outlly"}
          {both ? "," : ""}
        </span>
      )}
      {v.online !== null && (
        <span>
          <Num n={v.online} format={fmt} /> online{pill ? "" : " now"}
        </span>
      )}
    </>
  );
  if (pill) {
    return (
      <p className={cn("lc glass hairline inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[12.5px] shadow-sm", className)} aria-label={label} title={label}>
        {body}
      </p>
    );
  }
  return (
    <p className={cn("lc inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[12.5px]", className)} aria-label={label}>
      {body}
    </p>
  );
}

/** Still used by the landing trust panel. */
export function Dot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--lime))] opacity-60 motion-reduce:hidden" />
      <span className="relative h-2 w-2 rounded-full bg-[hsl(var(--lime))] ring-1 ring-foreground/25" />
    </span>
  );
}
