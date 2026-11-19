import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { entitlements, uploadLimitBytes, type Entitlements } from "../billing/entitlements";
import { recordCost } from "../subscriptions/costs";
import {
  MB, cycleWindow, fmtBytes, monthlyAllowanceMb, monthlyFigures, refusal, resolveAnchor, roomLeft, storageFiguresOf, usageMessage, usageState, usesMonthly, usesStorage,
  type CycleWindow, type MonthlyFigures, type QuotaPolicy, type StorageFiguresR1209, type UsageState,
} from "./quota-core";

/**
 * R1209: the one place that answers "how much may this account upload and keep". Built on the plan entitlements
 * (lib/billing/entitlements.ts, read live on every call, so a verified payment applies at once) and the real rows:
 * Media (what is kept), UploadLedger (what was uploaded this cycle) and in-progress uploads (what is reserved).
 * The cycle is worked out at read time from the plan's anchor, so a new month needs no job to begin; the daily
 * retention job only writes the closed cycle into UsageCycle for history.
 */
type Client = Prisma.TransactionClient | typeof db;

export interface StorageUsage {
  policy: QuotaPolicy;
  monthly: MonthlyFigures | null;
  storage: StorageFiguresR1209 | null;
  /** Kept files in bytes, whatever the policy (the Storage Manager shows it on Free too). */
  storedBytes: number;
  maxFileBytes: number;
  state: UsageState;
  canUpload: boolean;
  message: string | null;
  planName: string;
  planSlug: string;
  upgradeUrl: string;
}

export type QuotaCode = "quota_monthly" | "quota_storage" | "file_too_big";

const isPostgres = () => /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "");
const big = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Bytes of one media row: sizeBytes when written (R1209), else the older Int column. */
export const mediaBytes = (m: { size: number; sizeBytes?: bigint | null }) => (m.sizeBytes != null ? Number(m.sizeBytes) : m.size);
/** Both size columns for a write: size is an Int, so it is capped while sizeBytes keeps the exact figure. */
export const sizeColumns = (bytes: number) => ({ size: Math.min(Math.max(0, Math.round(bytes)), 2_147_483_647), sizeBytes: BigInt(Math.max(0, Math.round(bytes))) });

async function sumMedia(c: Client, where: Prisma.MediaWhereInput) {
  const [exact, legacy] = await Promise.all([
    c.media.aggregate({ where: { ...where, sizeBytes: { not: null } }, _sum: { sizeBytes: true } }),
    c.media.aggregate({ where: { ...where, sizeBytes: null }, _sum: { size: true } }),
  ]);
  return big(exact._sum.sizeBytes) + (legacy._sum.size ?? 0);
}

/** Kept (finished, not failed; Trash still counts until purged), reserved (uploads in progress) and Trash bytes. */
export async function storedBytes(userId: string, c: Client = db) {
  const [stored, reserved, trash] = await Promise.all([
    sumMedia(c, { userId, status: { notIn: ["failed", "uploading"] } }),
    sumMedia(c, { userId, status: "uploading" }),
    sumMedia(c, { userId, status: { notIn: ["failed", "uploading"] }, deletedAt: { not: null } }),
  ]);
  return { stored, reserved, trash };
}

/** The cycle this account is in now. */
export async function cycleFor(userId: string, e: Entitlements, now = new Date()): Promise<CycleWindow> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const signupAt = user?.createdAt ?? now;
  if (e.cycleAnchor !== "billing" || !e.accessId || (e.source !== "paid" && e.source !== "gift")) return cycleWindow({ anchor: e.cycleAnchor === "calendar" ? "calendar" : "signup", signupAt, now });
  const sub = await db.subscription.findUnique({ where: { id: e.accessId }, select: { createdAt: true, currentPeriodStart: true } });
  if (!sub) return cycleWindow({ anchor: "signup", signupAt, now });
  const free = await db.plan.findUnique({ where: { slug: "free" }, select: { cycleAnchor: true } });
  return cycleWindow({ anchor: "billing", signupAt, subscribedAt: sub.createdAt, periodStart: sub.currentPeriodStart, previous: resolveAnchor(free?.cycleAnchor), now });
}

async function adjustments(c: Client, userId: string, key: string) {
  const rows = await c.quotaAdjustment.groupBy({ by: ["kind"], where: { userId, cycleKey: key }, _sum: { bytes: true } });
  const of = (k: string) => big(rows.find((r) => r.kind === k)?._sum.bytes);
  return { extra: of("extra"), credit: of("credit") };
}

/** Uploaded this cycle, less any staff credit. Never refunded by a delete: the ledger rows outlive the files. */
export async function consumedBytes(userId: string, w: CycleWindow, c: Client = db) {
  const [sum, adj] = await Promise.all([
    c.uploadLedger.aggregate({ where: { userId, at: { gte: w.start, lt: w.end } }, _sum: { bytes: true } }),
    adjustments(c, userId, w.key),
  ]);
  return { used: Math.max(0, big(sum._sum.bytes) - adj.credit), extra: adj.extra };
}

async function figures(c: Client, userId: string, e: Entitlements, w: CycleWindow) {
  const policy = e.quotaPolicy;
  const [{ stored, reserved, trash }, consumed] = await Promise.all([storedBytes(userId, c), consumedBytes(userId, w, c)]);
  const allowanceMb = monthlyAllowanceMb(e.uploadMonthlyMb);
  const monthly = usesMonthly(policy) ? monthlyFigures(consumed.used, reserved, allowanceMb > 0 ? allowanceMb * MB + consumed.extra : 0, w) : null;
  const storage = usesStorage(policy) ? storageFiguresOf(stored, reserved, Math.max(0, e.storageMb) * MB, trash) : null;
  return { policy, monthly, storage, stored, reserved };
}

/** GET /api/storage/usage: the real figures for the meter, the upload card and Billing. */
export async function storageUsageFor(userId: string, now = new Date()): Promise<StorageUsage> {
  const e = await entitlements(userId);
  const [w, lim] = await Promise.all([cycleFor(userId, e, now), uploadLimitBytes(userId)]);
  const f = await figures(db, userId, e, w);
  const state = usageState(f.monthly, f.storage);
  return {
    policy: f.policy, monthly: f.monthly, storage: f.storage, storedBytes: f.stored, maxFileBytes: lim.bytes,
    state, canUpload: state !== "full", message: usageMessage(f.monthly, f.storage, state), planName: e.planName, planSlug: e.planSlug, upgradeUrl: "/billing",
  };
}

/** The older { usedBytes, limitBytes, remainingBytes, over, label } meter, now from the limit that binds. */
export function legacyMeter(u: StorageUsage) {
  if (u.monthly && !u.monthly.unlimited && (!u.storage || u.storage.unlimited || u.monthly.remainingBytes <= u.storage.availableBytes)) {
    const m = u.monthly;
    return { usedBytes: m.usedBytes + m.reservedBytes, limitBytes: m.allowanceBytes, remainingBytes: m.remainingBytes, over: m.usedBytes + m.reservedBytes >= m.allowanceBytes, label: `${fmtBytes(m.usedBytes + m.reservedBytes)} of your ${fmtBytes(m.allowanceBytes)} monthly upload allowance used, ${fmtBytes(m.remainingBytes)} left`, kind: "monthly" as const };
  }
  const s = u.storage;
  if (!s || s.unlimited) return { usedBytes: u.storedBytes, limitBytes: 0, remainingBytes: 0, over: false, label: `${fmtBytes(u.storedBytes)} used, no storage cap`, kind: "storage" as const };
  return { usedBytes: s.usedBytes + s.reservedBytes, limitBytes: s.capacityBytes, remainingBytes: s.availableBytes, over: s.usedBytes + s.reservedBytes > s.capacityBytes, label: `${fmtBytes(s.usedBytes)} used, ${fmtBytes(s.availableBytes)} remaining out of ${fmtBytes(s.capacityBytes)}`, kind: "storage" as const };
}

export class QuotaError extends HttpError {
  constructor(status: number, message: string, code: QuotaCode, usage: unknown) {
    super(status, message, code, { usage, feature: code === "file_too_big" ? "upload" : "storage", upgrade: "/billing" });
  }
}

/** One reservation at a time per account on this instance; Postgres adds a lock that holds across instances. */
const lanes = new Map<string, Promise<unknown>>();
async function inLane<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = lanes.get(userId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  lanes.set(userId, tail);
  try {
    return await run;
  } finally {
    if (lanes.get(userId) === tail) lanes.delete(userId);
  }
}

/**
 * Checks the file against the per-file cap, the monthly allowance and the storage capacity, counting every upload
 * still in progress at its declared size, and runs `create` (which makes the "uploading" row that holds the space)
 * inside the same locked transaction. Two uploads started together can't both take the last room.
 */
export async function reserveUpload<T>(userId: string, bytes: number, create: (tx: Prisma.TransactionClient) => Promise<T>, now = new Date()): Promise<T> {
  const e = await entitlements(userId);
  const lim = await uploadLimitBytes(userId);
  const w = await cycleFor(userId, e, now);
  if (bytes > lim.bytes) {
    const u = await storageUsageFor(userId, now);
    throw new QuotaError(413, lim.planLimited ? `${lim.planName} uploads are limited to ${lim.mb} MB per file. Upgrade to upload bigger videos, or compress this one.` : `That file is larger than ${lim.mb} MB.`, "file_too_big", u);
  }
  let refused: { code: Exclude<QuotaCode, "file_too_big">; message: string } | null = null;
  const out = await inLane(userId, () =>
    db.$transaction(
      async (tx) => {
        if (isPostgres()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        const f = await figures(tx, userId, e, w);
        if (f.monthly && !f.monthly.unlimited && bytes > f.monthly.remainingBytes) refused = { code: "quota_monthly", message: refusal("quota_monthly", bytes, f.monthly, f.storage, e.planName) };
        else if (f.storage && !f.storage.unlimited && bytes > f.storage.availableBytes) refused = { code: "quota_storage", message: refusal("quota_storage", bytes, f.monthly, f.storage, e.planName) };
        if (refused) return null;
        return { value: await create(tx) };
      },
      { timeout: 15_000, maxWait: 10_000 },
    ),
  );
  if (!out) {
    const r = refused as unknown as { code: Exclude<QuotaCode, "file_too_big">; message: string };
    throw new QuotaError(413, r.message, r.code, await storageUsageFor(userId, now));
  }
  await recordCost({ userId, category: "storage", units: bytes / 1e9 }); // 1147: GB-month (never throws)
  return out.value;
}

/**
 * A finished upload counts once: the ledger row is keyed by mediaId, so a retried complete, a second tab or a
 * multipart stitch answered twice write nothing more. `bytes` is the size the bucket reported, not the declared one.
 */
export async function recordUpload(m: { id: string; userId: string }, bytes: number, now = new Date()) {
  const e = await entitlements(m.userId);
  const w = await cycleFor(m.userId, e, now);
  await db.media.updateMany({ where: { id: m.id }, data: sizeColumns(bytes) });
  try {
    await db.uploadLedger.create({ data: { userId: m.userId, mediaId: m.id, bytes: BigInt(Math.max(0, Math.round(bytes))), cycleKey: w.key, at: now } });
    return true;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") return false;
    throw err;
  }
}

/** Room left for one more upload right now (Infinity when nothing caps it). */
export async function uploadRoom(userId: string, now = new Date()) {
  const u = await storageUsageFor(userId, now);
  return roomLeft(u.monthly, u.storage);
}
