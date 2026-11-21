"use client";
import { ActivityHeatmap, type HeatDay } from "@/components/ui/easy/ActivityHeatmap";
import { Card, CardTitle } from "./ui";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Average for each weekday (Monday first) over the given UTC days. */
export function weekdayAverages(days: HeatDay[]) {
  const sum = Array(7).fill(0) as number[];
  const cnt = Array(7).fill(0) as number[];
  for (const d of days) {
    const t = typeof d.date === "string" ? Date.parse(`${d.date.slice(0, 10)}T00:00:00Z`) : d.date.getTime();
    if (!Number.isFinite(t)) continue;
    const w = (new Date(t).getUTCDay() + 6) % 7;
    sum[w] += Math.max(0, d.value);
    cnt[w] += 1;
  }
  return WEEKDAYS.map((label, i) => ({ label, avg: cnt[i] ? sum[i] / cnt[i] : 0 }));
}

const fmt = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString("en-IN");

/** R1288: the overview's active-users series as a 12-week calendar, beside the average for each weekday. */
export function ActiveDaysCard({ days }: { days: HeatDay[] }) {
  // The grid's first week can start before the last 84 days, so it gets every day there is; the numbers use 84.
  const recent = days.slice(-84);
  const avgs = weekdayAverages(recent);
  const top = Math.max(1e-9, ...avgs.map((a) => a.avg));
  const busiest = avgs.reduce((b, a) => (a.avg > b.avg ? a : b), avgs[0]);
  const mean = recent.length ? recent.reduce((s, d) => s + Math.max(0, d.value), 0) / recent.length : 0;
  return (
    <Card className="mt-6" aria-labelledby="ov-active-days">
      <CardTitle hint="Distinct people who opened the studio each UTC day, last 12 weeks. Use the arrow keys on the grid to read a day.">
        <span id="ov-active-days">Active users per day</span>
      </CardTitle>
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start">
        <ActivityHeatmap
          data={days}
          weeks={12}
          weekStart={1}
          unit="active users"
          summaryText={() => `${fmt(mean)} a day on average`}
          ariaLabel={`Active users per day for the last 12 weeks, ${fmt(mean)} a day on average`}
        />
        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-semibold">
            Average by weekday {busiest.avg > 0 && <span className="font-normal text-muted-foreground">· busiest is {busiest.label}</span>}
          </p>
          <ul className="grid gap-1.5" aria-label="Average active users by weekday">
            {avgs.map((a) => (
              <li key={a.label} className="grid grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-[13px]">
                <span className="text-muted-foreground">{a.label}</span>
                <span className="block h-2 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
                  <span className="block h-full rounded-full bg-lime" style={{ width: `${(a.avg / top) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{fmt(a.avg)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
