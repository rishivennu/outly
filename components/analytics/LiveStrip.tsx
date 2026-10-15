"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { api } from "@/lib/client/api";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn, compact } from "@/lib/utils";
import type { PlatformDashboard } from "@/lib/live/types";

/** One card per platform with its live headline numbers; each opens that platform's dashboard. */
export function LiveStrip({ connected }: { connected: Partial<Record<Platform, boolean>> }) {
  const [data, setData] = useState<Partial<Record<Platform, PlatformDashboard | "error">>>({});
  const live = useLivePlatforms();
  useEffect(() => {
    for (const p of live)
      if (connected[p])
        api<PlatformDashboard>(`/api/platforms/${p}`)
          .then((d) => setData((x) => ({ ...x, [p]: d })))
          .catch(() => setData((x) => ({ ...x, [p]: "error" })));
  }, [connected, live]);

  return (
    <section aria-labelledby="live-strip" className="ai-type mt-8">
      <h2 id="live-strip" className="eyebrow ai-kicker mb-3 flex items-center gap-2">
        <span className="live-dot" aria-hidden="true" /> Live from your accounts
      </h2>
      <ul className="grid gap-3 md:grid-cols-3">
        {live.map((p) => {
          const d = data[p];
          const on = connected[p];
          const first = d && d !== "error" ? d.headline[0] : null;
          const second = d && d !== "error" ? d.headline[1] : null;
          return (
            <li key={p}>
              <Link href={`/analytics/${p}`} className="glass group relative flex min-h-[132px] flex-col overflow-hidden rounded-[24px] p-5 transition-transform duration-300 hover:-translate-y-0.5">
                <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40" style={{ background: PLATFORM_HALO[p] }} aria-hidden="true" />
                <span className="relative flex items-center gap-2 text-sm font-medium">
                  <PlatformOrb platform={p} size={26} /> {PLATFORM_META[p].name}
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                {!on ? (
                  <span className="relative mt-auto text-sm text-muted-foreground">Not connected. Open to connect it.</span>
                ) : !d ? (
                  <span className="relative mt-auto flex gap-6" aria-label="Loading">
                    <span className="h-10 w-20 animate-pulse rounded-lg bg-secondary" />
                    <span className="h-10 w-20 animate-pulse rounded-lg bg-secondary" />
                  </span>
                ) : d === "error" || d.status !== "ok" ? (
                  <span className={cn("relative mt-auto text-sm", "text-warning")}>{d === "error" ? "Couldn't load right now." : d.message}</span>
                ) : (
                  <span className="relative mt-auto flex gap-6">
                    {[first, second].filter(Boolean).map((h) => (
                      <span key={h!.key}>
                        <span className="block text-2xl font-semibold tracking-tight tabular">{h!.value === null ? "–" : compact(h!.value)}</span>
                        <span className="block text-xs text-muted-foreground">{h!.label}{h!.key === "views" ? `, ${d.rangeDays}d` : ""}</span>
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
