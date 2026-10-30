"use client";
import { useEffect, useState } from "react";
import type { FoundingPublic } from "@/lib/founding";
import { FoundingStamp } from "./FoundingStamp";

/**
 * Signup: the live founding seat counter. Starts from the server's number, then refreshes every 30 s while
 * the tab is visible, so the count a visitor sees is the real one.
 */
export function FoundingSeats({ initial }: { initial: FoundingPublic }) {
  const [s, setS] = useState<FoundingPublic | null>(initial);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/founding/seats", { cache: "no-store" });
        if (r.ok && !stop) setS(((await r.json()) as { seats: FoundingPublic | null }).seats);
      } catch {
        /* keep the last number */
      }
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stop = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  if (!s || s.limit <= 0) return null;
  const taken = s.limit - s.left;
  const pct = Math.min(100, Math.round((taken / s.limit) * 100));
  return (
    <div className="gs-in mb-5 flex items-center gap-3 rounded-2xl bg-card p-3 pr-4 hairline">
      <FoundingStamp size={52} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug" aria-live="polite">
          {s.left > 0 ? (
            <>
              <span className="tabular">{s.left}</span> of <span className="tabular">{s.limit}</span> founding seats left
            </>
          ) : (
            <>All <span className="tabular">{s.limit}</span> founding seats are taken</>
          )}
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          {s.left > 0 ? `${s.pct}% off every paid plan, for life. Join with ${s.gmailOnly ? "Gmail" : "your email"} and subscribe to any paid plan to claim one.` : "Thank you to everyone who joined early."}
        </p>
        <div role="progressbar" aria-label="Founding seats taken" aria-valuemin={0} aria-valuemax={s.limit} aria-valuenow={taken} className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
