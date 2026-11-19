import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { audit, type Actor } from "../billing/access";
import { entitlements } from "../billing/entitlements";
import { consumedBytes, cycleFor, mediaBytes, storageUsageFor } from "../storage/quota";
import { purgeAt } from "../storage/lifecycle";
import { MB } from "../storage/quota-core";

/** R1209: the admin Storage card (components/admin/users/StoragePanel.tsx). Real rows only. */
export async function adminStorageFor(who: { userId?: string | null; email?: string | null }, now = new Date()) {
  const user = who.userId
    ? await db.user.findUnique({ where: { id: who.userId }, select: { id: true, email: true, name: true, createdAt: true } })
    : who.email
      ? await db.user.findUnique({ where: { email: who.email.trim().toLowerCase() }, select: { id: true, email: true, name: true, createdAt: true } })
      : null;
  if (!user) throw new HttpError(404, "No account with that email.", "NOT_FOUND");
  const e = await entitlements(user.id);
  const cycle = await cycleFor(user.id, e, now);
  const kept = { userId: user.id, status: { notIn: ["failed", "uploading"] } };
  const pick = { id: true, originalFilename: true, size: true, sizeBytes: true, createdAt: true, deletedAt: true, mimeType: true } as const;
  const [usage, files, trash, drafts, largest, recent, deleted, purged, subs, cycles, adjustments] = await Promise.all([
    storageUsageFor(user.id, now),
    db.media.count({ where: kept }),
    db.media.count({ where: { ...kept, deletedAt: { not: null } } }),
    db.post.count({ where: { userId: user.id, status: "draft" } }),
    db.media.findMany({ where: kept, select: pick, orderBy: [{ sizeBytes: "desc" }, { size: "desc" }], take: 5 }),
    db.media.findMany({ where: kept, select: pick, orderBy: { createdAt: "desc" }, take: 5 }),
    db.media.findMany({ where: { ...kept, deletedAt: { not: null } }, select: pick, orderBy: { deletedAt: "desc" }, take: 5 }),
    db.storageCleanup.findMany({ where: { userId: user.id, purpose: "media" }, select: { key: true, doneAt: true, attempts: true, lastError: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.subscription.findMany({ where: { userId: user.id }, select: { id: true, status: true, provider: true, priceMinor: true, currency: true, interval: true, createdAt: true, canceledAt: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { name: true, slug: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.usageCycle.findMany({ where: { userId: user.id }, orderBy: { startsAt: "desc" }, take: 6 }),
    db.quotaAdjustment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const file = (m: (typeof largest)[number]) => ({
    id: m.id, name: m.originalFilename, bytes: mediaBytes(m), kind: m.mimeType.startsWith("image/") ? "image" : "video", uploadedAt: m.createdAt.toISOString(),
    deletedAt: m.deletedAt?.toISOString() ?? null, purgeAt: m.deletedAt ? purgeAt(m.deletedAt).toISOString() : null,
  });
  const live = subs.find((s) => s.id === e.accessId);
  return {
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt.toISOString() },
    plan: { name: e.planName, slug: e.planSlug, source: e.source, status: live?.status ?? (e.source === "free" ? "free" : "active"), endsAt: e.accessEndsAt?.toISOString() ?? null },
    cycle: { key: cycle.key, startsAt: cycle.start.toISOString(), resetAt: cycle.end.toISOString() },
    usage,
    counts: { files, trash, drafts },
    largest: largest.map(file).sort((a, b) => b.bytes - a.bytes),
    recent: recent.map(file),
    deletions: { trash: deleted.map(file), purges: purged.map((p) => ({ key: p.key.split("/").pop() ?? p.key, done: !!p.doneAt, attempts: p.attempts, lastError: p.lastError, at: p.createdAt.toISOString() })) },
    history: subs.map((s) => ({ id: s.id, plan: s.plan.name, slug: s.plan.slug, status: s.status, provider: s.provider, priceMinor: s.priceMinor, currency: s.currency, interval: s.interval, startedAt: s.createdAt.toISOString(), canceledAt: s.canceledAt?.toISOString() ?? null, endsAt: s.currentPeriodEnd.toISOString() })),
    cycles: cycles.map((c) => ({ key: c.cycleKey, startsAt: c.startsAt.toISOString(), endsAt: c.endsAt.toISOString(), plan: c.planSlug, policy: c.policy, uploadedBytes: Number(c.uploadedBytes), storedBytes: Number(c.storedBytes), allowanceBytes: Number(c.allowanceBytes), capacityBytes: Number(c.capacityBytes) })),
    adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, bytes: Number(a.bytes), cycleKey: a.cycleKey, actor: a.actor, note: a.note, at: a.createdAt.toISOString() })),
  };
}

export type QuotaAdjustInput = { userId: string; action: "extra" | "reset"; mb?: number; note: string };

/**
 * A staff change to this cycle only: "extra" adds MB to the monthly allowance, "reset" credits back what was
 * uploaded so far, so the counter reads zero. Files are never touched. Both land in AuditLog with before and after.
 */
export async function adjustQuota(input: QuotaAdjustInput, actor: Actor, now = new Date()) {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true } });
  if (!user) throw new HttpError(404, "No account with that id.", "NOT_FOUND");
  const e = await entitlements(user.id);
  const w = await cycleFor(user.id, e, now);
  const before = await storageUsageFor(user.id, now);
  let bytes: number;
  if (input.action === "extra") {
    const mb = Math.floor(input.mb ?? 0);
    if (mb < 1 || mb > 1_048_576) throw new HttpError(400, "Give the extra allowance in MB, between 1 and 1048576.", "VALIDATION");
    bytes = mb * MB;
  } else {
    bytes = (await consumedBytes(user.id, w)).used;
    if (bytes <= 0) throw new HttpError(409, "Nothing has been uploaded this cycle, so there is nothing to reset.", "NOTHING_TO_RESET");
  }
  const row = await db.quotaAdjustment.create({ data: { userId: user.id, cycleKey: w.key, kind: input.action === "extra" ? "extra" : "credit", bytes: BigInt(bytes), actor: actor.login.slice(0, 120), note: input.note.slice(0, 500) } });
  const after = await storageUsageFor(user.id, now);
  const brief = (u: typeof before) => ({ monthly: u.monthly && { usedBytes: u.monthly.usedBytes, allowanceBytes: u.monthly.allowanceBytes, remainingBytes: u.monthly.remainingBytes }, state: u.state });
  await audit({ actor, action: input.action === "extra" ? "storage.extra_allowance" : "storage.reset_cycle", targetType: "storage", targetId: row.id, email: user.email, before: brief(before), after: brief(after), note: input.note });
  return { adjustment: { id: row.id, kind: row.kind, bytes, cycleKey: w.key }, usage: after };
}
