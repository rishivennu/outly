/**
 * R1178: pure helpers behind the blog calendar and history (no "use client", no React), so the month grid,
 * the agenda and the status vocabulary are unit-tested on their own. Every status has a text label: the
 * colour of a pill is never the only signal.
 */
import type { BlogCalendarDay, BlogCalendarStatus, BlogHistoryStatus, BlogJobView } from "@/lib/blog/types";
import type { Tone } from "../ui";
import { fmtYmd } from "./zoned";

export const CAL_STATUS: Record<BlogCalendarStatus, { label: string; tone: Tone }> = {
  running: { label: "Generating", tone: "lime" },
  delayed: { label: "Running late", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Stopped", tone: "muted" },
  pending: { label: "Pending review", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  scheduled: { label: "Scheduled", tone: "info" },
  published: { label: "Published", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
};

export const HISTORY_STATUS: Record<BlogHistoryStatus, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "lime" },
  retrying: { label: "Retrying", tone: "warn" },
  delayed: { label: "Running late", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Stopped", tone: "muted" },
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "2026-11" moved by n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const monthTitle = (month: string) => fmtYmd(`${month}-01`, { month: "long", year: "numeric" });

/** Weeks of seven cells, Monday first; null pads the days before the 1st and after the last. */
export function monthGrid<T extends { date: string }>(days: T[]): (T | null)[][] {
  if (!days.length) return [];
  const [y, m, d] = days[0].date.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const cells: (T | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The phone agenda: only days with something on them (an item, the run marker or a skip). */
export const agendaDays = (days: BlogCalendarDay[]) => days.filter((d) => d.items.length > 0 || d.scheduledRun || d.skipped);

/** What a screen reader hears for a day button, e.g. "17 November, 2 items, run at 06:00". */
export function dayLabel(day: BlogCalendarDay, startTime: string, today?: string): string {
  const parts = [fmtYmd(day.date)];
  if (day.date === today) parts.push("today");
  parts.push(day.items.length === 1 ? "1 item" : `${day.items.length} items`);
  if (day.scheduledRun) parts.push(`run at ${startTime}`);
  if (day.skipped) parts.push("skipped");
  return parts.join(", ");
}

/** The latest "delayed" event on a running job, which is how the runner says it is past the ready-by time. */
export function delayedEvent(job: Pick<BlogJobView, "status" | "events"> | null | undefined) {
  if (!job || job.status !== "running") return null;
  for (let i = job.events.length - 1; i >= 0; i--) if (job.events[i].status === "delayed") return job.events[i];
  return null;
}
