/**
 * 1164: the counting model behind the admin's Notifications screen, as pure functions so it can be tested
 * without a database.
 *
 * Units, once and for all:
 * - A channel attempt is one NotifyDelivery row: one channel's outcome for one notification.
 * - A notification is one decision for one creator: every row written by the same call to logDeliveries.
 *   Rows share userId + kind and the event or notice they came from; rows with neither fall back to the
 *   second they were written in, which is how createMany stamps them.
 * - Accepted means the channel took it (the bell row was written, the push or email provider said yes).
 *   It never means seen.
 * - Held back means Outlly chose not to try that channel: the creator's own switch, quiet hours, a
 *   cooldown, the global pause, or no device to send to.
 * - A notification reached someone when at least one channel accepted it; it was held back entirely when
 *   every channel was held back; it failed when nothing was accepted and a provider refused.
 */
export type DeliveryLite = {
  userId: string;
  kind: string;
  category: string;
  channel: string;
  status: string;
  eventId?: string | null;
  noticeId?: string | null;
  createdAt: Date;
};

export type Outcome = "reached" | "held" | "failed" | "waiting";

export type NotificationGroup = { key: string; userId: string; kind: string; category: string; rows: DeliveryLite[]; outcome: Outcome };

export type CategoryCount = { id: string; notifications: number; sent: number; skipped: number; failed: number; queued: number; attempts: number };

export type NotificationCounts = {
  attempts: number;
  notifications: number;
  recipients: number;
  reached: number;
  held: number;
  failed: number;
  waiting: number;
  byCategory: CategoryCount[];
  lastSentAt: Record<string, Date>;
};

export const groupKey = (r: DeliveryLite) => `${r.userId}|${r.kind}|${r.eventId ?? r.noticeId ?? Math.floor(r.createdAt.getTime() / 1000)}`;

export function outcomeOf(rows: Pick<DeliveryLite, "status">[]): Outcome {
  if (rows.some((r) => r.status === "sent")) return "reached";
  if (rows.some((r) => r.status === "queued")) return "waiting";
  if (rows.some((r) => r.status === "failed")) return "failed";
  return "held";
}

export function groupDeliveries(rows: DeliveryLite[]): NotificationGroup[] {
  const by = new Map<string, NotificationGroup>();
  for (const r of rows) {
    const key = groupKey(r);
    const g = by.get(key) ?? { key, userId: r.userId, kind: r.kind, category: r.category, rows: [], outcome: "held" as Outcome };
    g.rows.push(r);
    by.set(key, g);
  }
  for (const g of by.values()) g.outcome = outcomeOf(g.rows);
  return [...by.values()];
}

export function countNotifications(rows: DeliveryLite[]): NotificationCounts {
  const groups = groupDeliveries(rows);
  const cats = new Map<string, CategoryCount>();
  const lastSentAt: Record<string, Date> = {};
  for (const g of groups) {
    const c = cats.get(g.category) ?? { id: g.category, notifications: 0, sent: 0, skipped: 0, failed: 0, queued: 0, attempts: 0 };
    c.notifications += 1;
    for (const r of g.rows) {
      c.attempts += 1;
      if (r.status === "sent") c.sent += 1;
      else if (r.status === "skipped") c.skipped += 1;
      else if (r.status === "failed") c.failed += 1;
      else if (r.status === "queued") c.queued += 1;
      if (r.status === "sent" && (!lastSentAt[r.channel] || lastSentAt[r.channel] < r.createdAt)) lastSentAt[r.channel] = r.createdAt;
    }
    cats.set(g.category, c);
  }
  const n = (o: Outcome) => groups.filter((g) => g.outcome === o).length;
  return {
    attempts: rows.length,
    notifications: groups.length,
    recipients: new Set(groups.map((g) => g.userId)).size,
    reached: n("reached"),
    held: n("held"),
    failed: n("failed"),
    waiting: n("waiting"),
    byCategory: [...cats.values()].sort((a, b) => b.notifications - a.notifications),
    lastSentAt,
  };
}

/**
 * 1164 greeting templates. The engine replaces `{name}` with the creator's first name ("there" when the
 * account has none) and leaves every other `{...}` exactly as typed, so a typo like `{nmae}` would reach a
 * creator verbatim. These two helpers let the admin screen refuse that before it is saved and show the
 * admin what a line will read like.
 */
export const GREETING_PLACEHOLDER = "{name}";

/** Problems with a set of greeting lines, in plain words. Empty when the lines can be saved. */
export function greetingProblems(lines: string[]): string[] {
  const out: string[] = [];
  const unknown = new Set<string>();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\{([^{}]*)\}/g)) if (`{${m[1]}}` !== GREETING_PLACEHOLDER) unknown.add(`{${m[1]}}`);
    if (/[{}]/.test(line.replaceAll(/\{[^{}]*\}/g, ""))) out.push(`Line ${i + 1} has a stray brace.`);
    if (line.length > 120) out.push(`Line ${i + 1} is longer than 120 characters, which gets cut off on a phone.`);
  });
  if (unknown.size) out.unshift(`Only ${GREETING_PLACEHOLDER} is filled in. Not recognised: ${[...unknown].join(", ")}.`);
  if (!lines.length) out.push("Write at least one line, or switch this greeting off instead.");
  return out;
}

/** What a greeting line reads like for one creator; mirrors pickLine in lib/notify-assist.ts. */
export function renderGreeting(line: string, firstName: string) {
  return line.replaceAll(GREETING_PLACEHOLDER, firstName.trim() || "there").trim();
}
