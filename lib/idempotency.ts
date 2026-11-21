import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "./db";
import { HttpError } from "./http";

/*
 * R1294: Idempotency-Key for the calls the app may retry after a lost answer (launch, bulk booking). The first
 * request with a key claims a Setting row (the same short-lived store as app holds and connect choices); its 2xx
 * answer is saved there for 24 hours and a repeat gets that answer back with Idempotent-Replayed: true. A failed
 * answer is not kept, so a retry after a refusal runs again. No key: exactly as before.
 */
const PREFIX = "idem:";
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
// A claim whose request died before it answered (a crashed function) stops blocking retries after this long.
const PENDING_MS = 2 * 60_000;
const PENDING = "pending";
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
export const REPLAYED_HEADER = "Idempotent-Replayed";

const sweep = () => db.setting.deleteMany({ where: { key: { startsWith: PREFIX }, updatedAt: { lt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) } } }).catch(() => {});
const release = (key: string) => db.setting.deleteMany({ where: { key, value: PENDING } }).catch(() => {});
const claim = (key: string) => db.setting.create({ data: { key, value: PENDING }, select: { key: true } }).then(() => true, () => false);

export async function idempotent(req: NextRequest, userId: string, scope: string, run: () => Promise<Response>): Promise<Response> {
  const raw = req.headers.get("idempotency-key");
  if (raw === null) return run();
  const k = raw.trim();
  if (!KEY.test(k)) throw new HttpError(400, "That Idempotency-Key can't be used. Send a UUID of up to 64 characters.", "BAD_IDEMPOTENCY_KEY");
  const key = `${PREFIX}${userId}:${scope}:${k}`;
  await sweep();
  if (!(await claim(key))) {
    const row = await db.setting.findUnique({ where: { key } });
    const stale = row?.value === PENDING && Date.now() - row.updatedAt.getTime() > PENDING_MS;
    if (stale) await db.setting.deleteMany({ where: { key, updatedAt: row.updatedAt } });
    if (!stale || !(await claim(key))) {
      if (!row || row.value === PENDING) throw new HttpError(409, "That request is still being handled. Give it a moment.", "IDEMPOTENCY_IN_PROGRESS");
      const saved = JSON.parse(row.value) as { status: number; body: unknown };
      return NextResponse.json(saved.body, { status: saved.status, headers: { [REPLAYED_HEADER]: "true" } });
    }
  }
  let res: Response;
  try {
    res = await run();
  } catch (e) {
    await release(key);
    throw e;
  }
  if (!res.ok) {
    await release(key);
    return res;
  }
  const body = await res.clone().json().catch(() => null);
  await db.setting.update({ where: { key }, data: { value: JSON.stringify({ status: res.status, body }) } }).catch(() => release(key));
  return res;
}
