import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { isProven } from "../founding";
import { ensurePlans } from "./plans";
import { DAY_MS, cleanEmail, grantEnd, grantState, isPaidSub, pickAccess, restackQueue, type AccessCandidate, type AccessSource } from "./access-core";

/**
 * Centralised access (1052). Every place that asks "what may this account do" goes through bestAccess():
 * paid and gift subscriptions, admin grants and referral rewards are all candidates, and the best live one
 * wins. Nothing here ever cancels a subscription, and a payment never ends a grant.
 */

type PlanRow = NonNullable<Awaited<ReturnType<typeof db.plan.findUnique>>>;
export type Access = AccessCandidate<PlanRow>;

export interface Actor {
  login: string;
  role?: string | null;
}
const SYSTEM: Actor = { login: "system", role: null };

const snap = (v: unknown) => (v == null ? null : JSON.stringify(v).slice(0, 4000));

/** Append-only trail of every change to someone's access. Never throws: the change itself already happened. */
export async function audit(e: { actor: Actor; action: string; targetType: "grant" | "referral" | "config"; targetId?: string | null; email?: string | null; before?: unknown; after?: unknown; note?: string }) {
  await db.auditLog
    .create({
      data: { actor: e.actor.login.slice(0, 120), actorRole: e.actor.role ?? null, action: e.action, targetType: e.targetType, targetId: e.targetId ?? null, email: e.email?.toLowerCase() ?? null, before: snap(e.before), after: snap(e.after), note: (e.note ?? "").slice(0, 500) },
    })
    .catch((err) => console.error("[audit]", err));
}

/** Everything live for this account right now, and the winner. */
export async function accessFor(userId: string, now = new Date()) {
  const [subs, grants] = await Promise.all([
    db.subscription.findMany({ where: { userId, status: "active", currentPeriodEnd: { gt: now }, OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] }, include: { plan: true } }),
    db.planGrant.findMany({ where: { userId, status: "active", startsAt: { lte: now }, endsAt: { gt: now } }, include: { plan: true } }),
  ]);
  const live: Access[] = [
    ...subs.map((s) => ({ plan: s.plan, source: (isPaidSub(s) ? "paid" : "gift") as AccessSource, endsAt: s.currentPeriodEnd, id: s.id })),
    ...grants.map((g) => ({ plan: g.plan, source: (g.source === "referral" ? "referral" : "admin") as AccessSource, endsAt: g.endsAt, id: g.id })),
  ];
  let best = pickAccess(live);
  if (!best) {
    await ensurePlans();
    const free = await db.plan.findUnique({ where: { slug: "free" } });
    best = free ? { plan: free, source: "free", endsAt: null } : null;
  }
  return { best, live };
}

// ------------------------------------------------------------------ grants

const isClash = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";
const userKey = (userId: string) => `admin:${userId}`;
const emailKey = (email: string) => `admin:@${email}`;

type GrantRow = NonNullable<Awaited<ReturnType<typeof db.planGrant.findUnique>>>;
const view = (g: GrantRow & { plan?: { slug: string; name: string } }) => ({
  id: g.id, email: g.email, plan: g.plan?.slug ?? g.planId, source: g.source, status: g.status, startsAt: g.startsAt, endsAt: g.endsAt, durationDays: g.durationDays, note: g.note,
});

/**
 * Bookkeeping: grants past their end become "expired" and free the one-live-grant slot. A pending grant made
 * by length is left alone: its endsAt is only a placeholder until the address is verified and the clock starts.
 */
export async function expireGrants(where: { userId?: string; email?: string } = {}, now = new Date()) {
  await db.planGrant.updateMany({
    where: { ...where, endsAt: { lte: now }, OR: [{ status: "active" }, { status: "pending", durationDays: null }] },
    data: { status: "expired", liveKey: null },
  });
}

async function grantPlan(slug: string) {
  await ensurePlans();
  const plan = await db.plan.findUnique({ where: { slug } });
  if (!plan || plan.slug === "free") throw new HttpError(400, "Pick Creator, Studio or Pro.", "BAD_PLAN");
  return plan;
}

const bad = (fn: () => Date) => {
  try {
    return fn();
  } catch (e) {
    throw new HttpError(400, (e as Error).message, "BAD_DATES");
  }
};

/**
 * Give someone a plan by email. A registered account with that exact address proven gets it now. Anyone
 * else (not signed up yet, or address not verified) gets a pending grant, activated the moment that exact
 * address is verified. A grant made by length starts its clock on activation; one with an end date keeps it.
 */
export async function createGrant(input: { email: string; plan: string; days?: number | null; endsAt?: string | null; startsAt?: string | null; note?: string }, actor: Actor, now = new Date()) {
  const email = cleanEmail(input.email);
  if (!email) throw new HttpError(400, "That email doesn't look right.", "BAD_EMAIL");
  const plan = await grantPlan(input.plan);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  const proven = !!user && isProven(user);
  await expireGrants({ email }, now);
  const live = await db.planGrant.findFirst({ where: { liveKey: { in: [emailKey(email), ...(user ? [userKey(user.id)] : [])] } } });
  if (live) throw new HttpError(409, "This person already has a live grant. Extend it or change its plan instead.", "GRANT_EXISTS");
  const startsAt = input.startsAt ? new Date(input.startsAt) : now;
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now.getTime() - DAY_MS) throw new HttpError(400, "The start date can't be in the past.", "BAD_DATES");
  const endsAt = bad(() => grantEnd(startsAt, { days: input.endsAt ? null : input.days, endsAt: input.endsAt }, now));
  const byLength = !input.endsAt;
  try {
    const g = await db.planGrant.create({
      data: {
        userId: proven ? user!.id : null, email, planId: plan.id, source: "admin", status: proven ? "active" : "pending", startsAt, endsAt,
        durationDays: byLength ? Number(input.days) : null, note: (input.note ?? "").trim().slice(0, 500), grantedBy: actor.login, liveKey: proven ? userKey(user!.id) : emailKey(email),
      },
      include: { plan: true },
    });
    await audit({ actor, action: "grant.create", targetType: "grant", targetId: g.id, email, after: view(g), note: g.note });
    return g;
  } catch (e) {
    if (isClash(e)) throw new HttpError(409, "This person already has a live grant. Extend it or change its plan instead.", "GRANT_EXISTS");
    throw e;
  }
}

async function liveGrant(id: string, adminOnly = false) {
  const g = await db.planGrant.findUnique({ where: { id }, include: { plan: true } });
  if (!g) throw new HttpError(404, "Grant not found.", "NOT_FOUND");
  // A Refer & Earn month is stacked after the friend's paid period; editing it here would also give it an
  // admin liveKey and block a real admin grant. Revoke still works on it.
  if (adminOnly && g.source !== "admin") throw new HttpError(409, "That's a Refer & Earn month. Manage it from Refer & Earn.", "NOT_ADMIN_GRANT");
  return g;
}

/** More time: `days` adds on top of what is left (or from today if it already ended); `endsAt` sets the exact end. */
export async function extendGrant(id: string, input: { days?: number | null; endsAt?: string | null; note?: string }, actor: Actor, now = new Date()) {
  const g = await liveGrant(id, true);
  if (g.status === "revoked") throw new HttpError(409, "A revoked grant can't be extended. Make a new one.", "REVOKED");
  const ended = grantState(g, now) === "expired";
  let endsAt: Date;
  let durationDays = g.durationDays;
  if (input.endsAt) {
    endsAt = bad(() => grantEnd(g.startsAt, { endsAt: input.endsAt }, now));
    durationDays = null;
  } else {
    const days = Number(input.days);
    const from = g.endsAt > now ? g.endsAt : now;
    endsAt = bad(() => grantEnd(from, { days }, now));
    if (g.status === "pending" && durationDays) durationDays += days;
  }
  let liveKey = g.liveKey;
  let status = g.status;
  if (ended) {
    status = g.userId ? "active" : "pending";
    liveKey = g.userId ? userKey(g.userId) : emailKey(g.email);
  }
  try {
    const next = await db.planGrant.update({ where: { id }, data: { endsAt, durationDays, status, liveKey }, include: { plan: true } });
    await audit({ actor, action: "grant.extend", targetType: "grant", targetId: id, email: g.email, before: view(g), after: view(next), note: input.note });
    return next;
  } catch (e) {
    if (isClash(e)) throw new HttpError(409, "This person already has another live grant. Change that one instead.", "GRANT_EXISTS");
    throw e;
  }
}

/** Upgrade or downgrade a live grant to another plan. Its dates stay. */
export async function changeGrant(id: string, input: { plan: string; note?: string }, actor: Actor, now = new Date()) {
  const g = await liveGrant(id, true);
  const st = grantState(g, now);
  if (st === "revoked" || st === "expired") throw new HttpError(409, "That grant has ended. Make a new one.", "ENDED");
  const plan = await grantPlan(input.plan);
  if (plan.id === g.planId) throw new HttpError(409, `It's already ${plan.name}.`, "SAME_PLAN");
  const next = await db.planGrant.update({ where: { id }, data: { planId: plan.id }, include: { plan: true } });
  await audit({ actor, action: plan.sortOrder > g.plan.sortOrder ? "grant.upgrade" : "grant.downgrade", targetType: "grant", targetId: id, email: g.email, before: view(g), after: view(next), note: input.note });
  return next;
}

/** Ends a grant now. The account falls back to whatever else it has (a paid plan keeps running). */
export async function revokeGrant(id: string, reason: string, actor: Actor, now = new Date()) {
  const g = await liveGrant(id);
  if (g.status === "revoked") return g;
  const next = await db.planGrant.update({ where: { id }, data: { status: "revoked", liveKey: null, revokedAt: now, revokedBy: actor.login, revokeReason: reason.slice(0, 300) || null }, include: { plan: true } });
  await audit({ actor, action: "grant.revoke", targetType: "grant", targetId: id, email: g.email, before: view(g), after: view(next), note: reason });
  return next;
}

/**
 * The exact address was just verified (markEmailVerified). Pending grants for it become this account's.
 * Never throws. A grant made by length starts today; one with a fixed end keeps it (or expires if it passed).
 */
export async function activatePendingGrants(userId: string, now = new Date()) {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
    if (!u || !isProven(u)) return 0;
    const email = u.email.toLowerCase();
    const pending = await db.planGrant.findMany({ where: { email, status: "pending" }, include: { plan: true } });
    let n = 0;
    for (const g of pending) {
      const startsAt = g.durationDays ? (g.startsAt > now ? g.startsAt : now) : g.startsAt;
      const endsAt = g.durationDays ? new Date(startsAt.getTime() + g.durationDays * DAY_MS) : g.endsAt;
      if (endsAt <= now) {
        await db.planGrant.update({ where: { id: g.id }, data: { status: "expired", liveKey: null } });
        continue;
      }
      try {
        const next = await db.planGrant.update({ where: { id: g.id, status: "pending" }, data: { userId, status: "active", startsAt, endsAt, liveKey: userKey(userId) }, include: { plan: true } });
        await audit({ actor: SYSTEM, action: "grant.activate", targetType: "grant", targetId: g.id, email, before: view(g), after: view(next), note: "Address verified" });
        n++;
      } catch (e) {
        if (!isClash(e)) throw e;
        // Already holds a live grant on the account itself: keep that one, record why this one didn't run.
        await db.planGrant.update({ where: { id: g.id }, data: { status: "revoked", liveKey: null, revokedAt: now, revokedBy: "system", revokeReason: "Account already had a live grant" } });
        await audit({ actor: SYSTEM, action: "grant.revoke", targetType: "grant", targetId: g.id, email, before: view(g), note: "Account already had a live grant" });
      }
    }
    return n;
  } catch (e) {
    console.error("[grants] activate", e);
    return 0;
  }
}

/**
 * A payment just set (or moved) the end of the paid period. Referral months that haven't started yet move
 * to begin after it, so a renewal never eats the free month.
 */
export async function restackReferralGrants(userId: string, paidUntil: Date, now = new Date()) {
  const later = await db.planGrant.findMany({ where: { userId, source: "referral", status: "active", startsAt: { gt: now } } });
  // Several earned months queue up one after another (1066), so none of them is lost under another.
  for (const m of restackQueue(later, paidUntil, now)) await db.planGrant.update({ where: { id: m.id }, data: { startsAt: m.startsAt, endsAt: m.endsAt } });
}

/** One account's plan picture for the admin: who they are, what wins now, every source and the trail. */
export async function accessByEmail(raw: string, now = new Date()) {
  const email = cleanEmail(raw);
  if (!email) throw new HttpError(400, "That email doesn't look right.", "BAD_EMAIL");
  await expireGrants({ email }, now);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, createdAt: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  if (user) await expireGrants({ userId: user.id }, now);
  const [grants, subs, history, current] = await Promise.all([
    db.planGrant.findMany({ where: { OR: [{ email }, ...(user ? [{ userId: user.id }] : [])] }, include: { plan: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    user ? db.subscription.findMany({ where: { userId: user.id }, include: { plan: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    db.auditLog.findMany({ where: { email }, orderBy: { createdAt: "desc" }, take: 100 }),
    user ? accessFor(user.id, now) : null,
  ]);
  return {
    email,
    user: user ? { id: user.id, name: user.name, createdAt: user.createdAt, verified: isProven(user) } : null,
    current: current?.best ? { plan: current.best.plan.slug, planName: current.best.plan.name, source: current.best.source, endsAt: current.best.endsAt } : null,
    grants: grants.map((g) => ({ ...view(g), planName: g.plan.name, state: grantState(g, now), grantedBy: g.grantedBy, revokedBy: g.revokedBy, revokeReason: g.revokeReason, createdAt: g.createdAt })),
    subscriptions: subs.map((s) => ({ id: s.id, plan: s.plan.slug, planName: s.plan.name, status: s.status, provider: s.provider, paid: isPaidSub(s), endsAt: s.currentPeriodEnd, pausedUntil: s.pausedUntil, createdAt: s.createdAt })),
    history: history.map((h) => ({ id: h.id, actor: h.actor, actorRole: h.actorRole, action: h.action, note: h.note, createdAt: h.createdAt, before: h.before, after: h.after })),
  };
}

/** Recent grants across everyone, for the admin list. */
export async function recentGrants(filter: { state?: string } = {}, now = new Date()) {
  await expireGrants({}, now);
  const where = filter.state === "pending" ? { status: "pending" } : filter.state === "active" ? { status: "active", endsAt: { gt: now } } : filter.state === "ended" ? { status: { in: ["expired", "revoked"] } } : {};
  const rows = await db.planGrant.findMany({ where: { ...where, source: "admin" }, include: { plan: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((g) => ({ ...view(g), planName: g.plan.name, state: grantState(g, now), grantedBy: g.grantedBy, createdAt: g.createdAt }));
}
