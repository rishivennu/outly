"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** "60 minutes left", "2 h 05 min left", "45 seconds left". Whole units, rounded up so it never says 0 too early. */
export function leftLabel(ms: number) {
  if (ms <= 0) return "Any moment now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} left`;
  const m = Math.ceil(s / 60);
  if (m <= 90) return `${m} minute${m === 1 ? "" : "s"} left`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")} min left` : `${h} hour${h === 1 ? "" : "s"} left`;
}

function clock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Re-renders every second. Starts at null on the server so the markup never mismatches. */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Live maintenance countdown. "tile" is the big block on the maintenance page; "bar" is the slim strip
 * members see in the studio and on the landing page. Once the clock runs out it checks the status API every
 * 15 s and reloads the page the moment maintenance is off, so nobody has to keep hitting refresh.
 */
export function Countdown({ endsAt, since, variant = "tile", className }: { endsAt: string; since?: string; variant?: "tile" | "bar"; className?: string }) {
  const now = useNow();
  const end = Date.parse(endsAt);
  const start = since ? Date.parse(since) : NaN;
  const ms = now === null || !Number.isFinite(end) ? null : end - now;
  const done = ms !== null && ms <= 0;

  useEffect(() => {
    if (!done || variant !== "tile") return;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch("/api/maintenance", { cache: "no-store" });
        if (r.ok && !(await r.json()).maintenance) window.location.assign("/");
      } catch {
        /* offline: try again next tick */
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [done, variant]);

  if (!Number.isFinite(end)) return null;
  const label = ms === null ? "" : leftLabel(ms);
  const pct = ms !== null && Number.isFinite(start) && end > start ? Math.min(100, Math.max(0, ((now! - start) / (end - start)) * 100)) : null;
  // Screen readers hear the minute, not every second.
  const spoken = ms === null ? "" : done ? "Any moment now" : leftLabel(Math.ceil(ms / 60_000) * 60_000);

  if (variant === "bar") {
    return (
      <p className={cn("flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[13px] font-semibold", className)}>
        <span className="live-dot" style={{ background: "hsl(var(--lime))" }} aria-hidden="true" />
        <span aria-hidden="true" className="tabular">{label || "\u00a0"}</span>
        <span className="font-normal opacity-80" aria-hidden="true">{done ? "Wrapping up maintenance." : "Maintenance in progress, you can keep working."}</span>
        <span className="sr-only" aria-live="polite">{spoken ? `${spoken}. Maintenance in progress, you can keep working.` : ""}</span>
      </p>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <p className="font-display text-[clamp(2rem,4.5vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.03em]" aria-hidden="true">
        <span className="tabular">{label || "\u00a0"}</span>
      </p>
      <p className="mt-1 text-[15px] font-semibold text-[hsl(var(--ap-ink2))]" aria-hidden="true">
        {done ? "Finishing the last checks. This page reloads by itself." : "Hold your breath to start posting!"}
      </p>
      <span className="sr-only" aria-live="polite">{spoken ? `${spoken}. ${done ? "This page reloads by itself." : "Hold your breath to start posting!"}` : ""}</span>
      {pct !== null && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
          <div className="cd-fill h-full rounded-full bg-[hsl(var(--lime))]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {ms !== null && !done && <p className="mt-2 font-mono text-[13px] tabular text-[hsl(var(--ap-ink2))]" aria-hidden="true">{clock(ms)}</p>}
    </div>
  );
}
