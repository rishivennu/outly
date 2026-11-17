/**
 * 1166: the counting rules behind Admin > User behavior, as pure functions so each rule is unit-tested.
 * Every day is a UTC calendar day ("YYYY-MM-DD"); the sign-up day is day 0.
 */

export const TZ = "UTC";
const DAY = 86_400_000;
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (k: string, n: number) => dayKey(new Date(Date.parse(k + "T00:00:00Z") + n * DAY));
const ratio = (a: number, b: number) => (b ? a / b : 0);
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/* ---------------- activation funnel ---------------- */

export type Person = { id: string; name: string; email: string };
export type FunnelMember = Person & { createdAt: Date };
export type FunnelEvents = { connected: Set<string>; uploaded: Set<string>; created: Set<string>; published: Set<string>; paid: Set<string> };

export const FUNNEL_STEPS = [
  { key: "signup", label: "Signed up", rule: "Has an Outlly account." },
  { key: "connect", label: "Connected a platform", rule: "Has linked at least one social account (connected now or needing a reconnect)." },
  { key: "upload", label: "Uploaded a video", rule: "Has at least one file in their media library." },
  { key: "post", label: "Created a post", rule: "Has at least one post, in any state." },
  { key: "publish", label: "Published a post", rule: "At least one post went live on a platform. Practice runs do not count." },
  { key: "paid", label: "Paying now", rule: "Has an active or past-due paid plan today." },
] as const;
export type StepKey = (typeof FUNNEL_STEPS)[number]["key"];

export type FunnelStepOut = {
  key: StepKey;
  label: string;
  rule: string;
  count: number;
  /** share of the cohort (step 1) */
  pctOfStart: number;
  /** share of the step before; null on step 1 */
  stepRate: number | null;
  /** people who reached the step before but not this one */
  dropped: number;
  /** people in the cohort who did this step's action but skipped an earlier step, so they are not counted here */
  skipped: number;
  /** who reached the step and who stopped right before it; filled only for roles allowed to see people */
  reached: Person[];
  stopped: Person[];
};
export type CohortFunnel = { cohort: "range" | "all"; label: string; from: string | null; to: string; size: number; steps: FunnelStepOut[] };
export type WaitlistStage = { joined: number; withAccount: number; inCohort: number };
export type Activation = { range: CohortFunnel; all: CohortFunnel; waitlist: WaitlistStage; peopleShown: boolean; peopleLimit: number };

export const PEOPLE_LIMIT = 20;

/**
 * Nested funnel: every step counts the cohort members who did that action and every action before it, so a later
 * step can never be larger than an earlier one. People who did an action out of order are reported as `skipped`
 * on that step instead of being silently added or silently lost.
 */
export function cohortFunnel(members: FunnelMember[], ev: FunnelEvents, meta: { cohort: "range" | "all"; label: string; from: string | null; to: string }, limit = PEOPLE_LIMIT): CohortFunnel {
  const sets: (Set<string> | null)[] = [null, ev.connected, ev.uploaded, ev.created, ev.published, ev.paid];
  const newestFirst = [...members].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const person = (m: FunnelMember): Person => ({ id: m.id, name: m.name, email: m.email });
  let pool = newestFirst;
  const steps: FunnelStepOut[] = [];
  FUNNEL_STEPS.forEach((s, i) => {
    const set = sets[i];
    const before = pool;
    if (set) pool = pool.filter((m) => set.has(m.id));
    const stoppedAll = set ? before.filter((m) => !set.has(m.id)) : [];
    const skipped = set ? newestFirst.filter((m) => set.has(m.id)).length - pool.length : 0;
    steps.push({
      key: s.key,
      label: s.label,
      rule: s.rule,
      count: pool.length,
      pctOfStart: round(ratio(pool.length, members.length)),
      stepRate: i === 0 ? null : round(ratio(pool.length, before.length)),
      dropped: before.length - pool.length,
      skipped,
      reached: pool.slice(0, limit).map(person),
      stopped: stoppedAll.slice(0, limit).map(person),
    });
  });
  return { ...meta, size: members.length, steps };
}

/** Waitlist is its own list, matched to accounts by email (case-insensitive). It is never step 1 of the sign-up funnel. */
export function waitlistStage(entries: { email: string }[], accountEmails: Iterable<string>, cohortEmails: Iterable<string>): WaitlistStage {
  const all = new Set([...accountEmails].map((e) => e.trim().toLowerCase()));
  const cohort = new Set([...cohortEmails].map((e) => e.trim().toLowerCase()));
  const list = [...new Set(entries.map((e) => e.email.trim().toLowerCase()))];
  return { joined: list.length, withAccount: list.filter((e) => all.has(e)).length, inCohort: list.filter((e) => cohort.has(e)).length };
}

/**
 * What leaves the server for one admin. Roles that cannot open user records get counts only; the rest get names,
 * with the address masked by `mask` (only a super admin sees it in full, see lib/admin/privacy.ts).
 */
export function withPeople(a: Activation, mask: ((email: string) => string) | null): Activation {
  const map = (f: CohortFunnel): CohortFunnel => ({
    ...f,
    steps: f.steps.map((s) => ({
      ...s,
      reached: mask ? s.reached.map((p) => ({ ...p, email: mask(p.email) })) : [],
      stopped: mask ? s.stopped.map((p) => ({ ...p, email: mask(p.email) })) : [],
    })),
  });
  return { ...a, range: map(a.range), all: map(a.all), peopleShown: !!mask };
}

/* ---------------- retention ---------------- */

export const RETENTION_WINDOWS = [
  { key: "d1", label: "Day one", from: 1, to: 1, rule: "Active on day 1, the UTC day after the sign-up day. Measurable once day 1 has ended." },
  { key: "w1", label: "Week one", from: 1, to: 7, rule: "Active on at least one of days 1 to 7 after the sign-up day. Measurable once day 7 has ended." },
  { key: "d30", label: "Month one", from: 8, to: 30, rule: "Active on at least one of days 8 to 30, so still around after the first week. Measurable once day 30 has ended." },
] as const;
export type RetentionRow = { key: "d1" | "w1" | "d30"; label: string; rule: string; eligible: number; retained: number; rate: number; measurable: boolean; pending: number };

/** The cohort is everyone who signed up in the last `lookback` days. A person counts only once their window has fully ended. */
export function retentionRows(members: { id: string; createdAt: Date }[], activeIn: (id: string, from: string, to: string) => boolean, today: string, lookback = 120): RetentionRow[] {
  const cohort = members.filter((m) => dayKey(m.createdAt) >= addDays(today, -lookback) && dayKey(m.createdAt) <= today);
  return RETENTION_WINDOWS.map((w) => {
    const eligible = cohort.filter((m) => addDays(dayKey(m.createdAt), w.to) < today);
    const retained = eligible.filter((m) => {
      const s = dayKey(m.createdAt);
      return activeIn(m.id, addDays(s, w.from), addDays(s, w.to));
    }).length;
    return { key: w.key, label: w.label, rule: w.rule, eligible: eligible.length, retained, rate: round(ratio(retained, eligible.length)), measurable: eligible.length > 0, pending: cohort.length - eligible.length };
  });
}

/* ---------------- weekly cohorts ---------------- */

export type CohortRow = { label: string; start: string; size: number; weeks: (number | null)[]; active: (number | null)[]; partial: number | null };

/**
 * Calendar weeks, Monday to Sunday (UTC). W0 is the week they joined. A cell is null when that week has not started
 * (not yet measurable, never 0%); `partial` is the index of the week still running, whose share can still grow.
 */
export function weeklyCohorts(members: { id: string; createdAt: Date }[], activeIn: (id: string, from: string, to: string) => boolean, now: Date, count = 8): CohortRow[] {
  const today = dayKey(now);
  const thisMonday = addDays(today, -((now.getUTCDay() + 6) % 7));
  return Array.from({ length: count }, (_, i) => {
    const start = addDays(thisMonday, -7 * (count - 1 - i));
    const end = addDays(start, 6);
    const ms = members.filter((u) => dayKey(u.createdAt) >= start && dayKey(u.createdAt) <= end);
    const active: (number | null)[] = [];
    let partial: number | null = null;
    for (let w = 0; w < count; w++) {
      const ws = addDays(start, 7 * w);
      const we = addDays(ws, 6);
      if (ws > today || !ms.length) {
        active.push(null);
        continue;
      }
      if (we >= today) partial = w;
      active.push(ms.filter((u) => activeIn(u.id, ws, we)).length);
    }
    const label = new Date(start + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    return { label, start, size: ms.length, weeks: active.map((a) => (a === null ? null : round(ratio(a, ms.length)))), active, partial };
  });
}

/* ---------------- segments ---------------- */

export type SegmentRow = { key: "new" | "power" | "regular" | "casual" | "dormant"; label: string; description: string; users: number; share: number };

export const powerThreshold = (days: number) => Math.max(4, Math.round(days * 0.27));

/**
 * Five segments that never overlap: each person gets the first rule they match, in this order. The population is
 * every account, so the segment counts always add up to the account total.
 */
export function segmentUsers(people: { createdAt: Date; activeDays: number }[], days: number, today: string): SegmentRow[] {
  const p = powerThreshold(days);
  const weekStart = addDays(today, -6);
  const defs: { key: SegmentRow["key"]; label: string; description: string; test: (u: { createdAt: Date; activeDays: number }) => boolean }[] = [
    { key: "new", label: "New this week", description: "Signed up today or in the 6 days before. Checked first.", test: (u) => dayKey(u.createdAt) >= weekStart },
    { key: "power", label: "Power creators", description: `Active on ${p} or more days in the range`, test: (u) => u.activeDays >= p },
    { key: "regular", label: "Regulars", description: p - 1 === 3 ? "Active on 3 days in the range" : `Active on 3 to ${p - 1} days in the range`, test: (u) => u.activeDays >= 3 },
    { key: "casual", label: "Casual", description: "Active on 1 or 2 days in the range", test: (u) => u.activeDays >= 1 },
    { key: "dormant", label: "Dormant", description: "No active day in the range", test: () => true },
  ];
  const n = new Map(defs.map((d) => [d.key, 0]));
  for (const u of people) {
    const d = defs.find((x) => x.test(u))!;
    n.set(d.key, (n.get(d.key) ?? 0) + 1);
  }
  return defs.map((d) => ({ key: d.key, label: d.label, description: d.description, users: n.get(d.key) ?? 0, share: round(ratio(n.get(d.key) ?? 0, people.length)) }));
}

/* ---------------- weekday rhythm ---------------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Active person-days per weekday, and the average per occurrence, because a 30-day range holds some weekdays 5 times and others 4. */
export function weekdayRhythm(activeByDay: Map<string, number>, rangeStart: string, today: string) {
  const total = new Array(7).fill(0);
  const occ = new Array(7).fill(0);
  for (let k = rangeStart; k <= today; k = addDays(k, 1)) {
    const wd = new Date(k + "T00:00:00Z").getUTCDay();
    occ[wd]++;
    total[wd] += activeByDay.get(k) ?? 0;
  }
  return [1, 2, 3, 4, 5, 6, 0].map((i) => ({ day: WEEKDAYS[i], active: total[i], days: occ[i], avg: round(ratio(total[i], occ[i]), 1) }));
}
