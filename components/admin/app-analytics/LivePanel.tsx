"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle, Empty, Pill, ago } from "@/components/admin/ui";
import type { Live } from "@/lib/admin/app-analytics";
import { PLATFORM_LABEL, isPlatform } from "@/lib/analytics/activity-core";

const POLL_MS = 20_000;
const n = (v: number) => v.toLocaleString("en-IN");

/** R1308: who is on right now and what just happened. Refreshes every 20 s while the tab is visible; never more. */
export function LivePanel({ initial }: { initial: Live }) {
  const [live, setLive] = useState(initial);
  const [stale, setStale] = useState(false);
  // The clock starts at the server's timestamp so the SSR text and the first client render agree (no hydration diff on
  // a slow network); after mount it follows the browser and advances with every refresh.
  const [now, setNow] = useState(() => new Date(initial.at).getTime());
  useEffect(() => {
    setNow(Date.now());
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/admin/app-analytics/live", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as Live;
        if (!stop) {
          setLive(data);
          setNow(Date.now());
          setStale(false);
        }
      } catch {
        if (!stop) setStale(true);
      }
    };
    const id = setInterval(() => { setNow(Date.now()); void tick(); }, POLL_MS);
    const onShow = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  const h = live.lastHour;
  const stats: [string, number][] = [["Sign-ins", h.logins], ["Sign-ups", h.signups], ["Posts created", h.created], ["Published", h.published], ["Accounts connected", h.connected], ["Installs", h.installs]];
  return (
    <Card as="div" className="min-w-0">
      <CardTitle hint="People seen in the last 5 minutes, and the last 15 minutes of sign-ins, sign-ups, posts, publishes, connections and installs. Refreshes every 20 seconds while this tab is open." action={<span className="text-[12px] text-muted-foreground" aria-live="polite">{stale ? "Refresh failed, showing the last answer" : `updated ${ago(live.at, now)}`}</span>}>
        Right now
      </CardTitle>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <p className="text-[12.5px] font-medium text-muted-foreground">Online now</p>
          <p className="mt-1 font-display text-[2rem] font-bold leading-none tabular-nums">{n(live.online)}</p>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          {stats.map(([label, v]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{n(v)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">Counts in the last hour.</p>
      <h3 className="mb-2 mt-5 text-[13.5px] font-semibold">Last 15 minutes</h3>
      {live.recent.length === 0 ? (
        <Empty title="Quiet right now" body="Sign-ins, posts and installs appear here the moment they happen." />
      ) : (
        <ol className="flex flex-col divide-y divide-border/60 text-[13px]" aria-label="Recent activity">
          {live.recent.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-[72px] shrink-0 text-[12px] text-muted-foreground tabular-nums">{ago(e.at, now)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{e.user?.name ?? "Someone"}</span> <span className="text-muted-foreground">{e.label.toLowerCase()}</span>
              </span>
              <Pill tone="muted">{isPlatform(e.platform) ? PLATFORM_LABEL[e.platform] : e.platform}</Pill>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
