import "server-only";
import { db } from "../db";
import { notifyConfig } from "../notify-config";
import { CENTRE_TABS, type CentreTab } from "../notify-core";
import { recordEvent } from "../notify-engine";

/**
 * 1141 batching. The cooldown stops the phone buzzing six times about one busy post, but the creator still
 * wants to know those six things happened. So every window the engine looks at exactly the notifications
 * whose push was held back by a cooldown (the delivery log records each one with reason "cooldown") and, if
 * there were enough of them, sends one summary that points at the notification centre.
 *
 * It counts rows that really exist, so the number in the summary is never a guess, and a window that was
 * quiet sends nothing at all.
 */
export const DIGEST_REASON = "cooldown";

/** The window this instant falls in. Two sweeps inside one window produce the same key, so one summary. */
export const digestSlot = (now: Date, windowMin: number) => Math.floor(now.getTime() / (windowMin * 60_000));

const label = (tab: CentreTab) => CENTRE_TABS.find((t) => t.id === tab)?.title ?? "updates";

export async function sweepDigests(now = new Date()) {
  const cfg = await notifyConfig();
  const out = { looked: 0, sent: 0 };
  if (!cfg.digest.on) return out;
  const since = new Date(now.getTime() - cfg.digest.windowMin * 60_000);
  const where = { channel: "push", status: "skipped", reason: DIGEST_REASON, createdAt: { gte: since } };
  const held = await db.notifyDelivery.groupBy({ by: ["userId"], where, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 200 });
  out.looked = held.length;
  const slot = digestSlot(now, cfg.digest.windowMin);
  for (const row of held) {
    const n = row._count._all;
    if (n < cfg.digest.min) continue;
    const by = await db.notifyDelivery.groupBy({ by: ["category"], where: { ...where, userId: row.userId }, _count: { _all: true }, orderBy: { _count: { category: "desc" } }, take: 1 });
    const top = (by[0]?.category ?? "all") as CentreTab;
    const key = `summary:${row.userId}:${slot}`;
    const r = await recordEvent({
      userId: row.userId,
      kind: "summary",
      source: "sweep:digest",
      idemKey: key,
      payload: {
        title: `${n} updates you have not seen`,
        body: `Mostly ${label(top).toLowerCase()}. Open your notifications to catch up.`,
        href: "/settings/notifications#nf-history",
        action: "Open notifications",
        tone: "info",
        key,
      },
      nextAt: now,
    });
    if (r.id && !r.duplicate) out.sent++;
  }
  return out;
}
