import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { env } from "./env";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { getConfig } from "./settings";
import { inboxKey } from "./founding-config";
import { isProven } from "./founding";
import { audit, type Actor } from "./billing/access";
import { isPaidSub, rewardWindow } from "./billing/access-core";
import { REF_COOKIE, REF_VISITOR, isCode, makeCode, maskEmail, normalizeReferral, referralLabel, referrerFor, shareUrl, type ReferralConfig } from "./referral-core";

export { REF_COOKIE };

/**
 * Refer & Earn (1052). The FRIEND who signs up through someone's link gets a free month of Creator after
 * their first verified payment for an eligible plan. The month is stacked after the period they paid for.
 * One reward per account and per inbox, never for referring yourself, and a refund or chargeback of the
 * qualifying payment takes it back. Rows: invited (opened the link) -> registered -> paid -> rewarded.
 */

const SYSTEM: Actor = { login: "system", role: null };
const OPEN_CAP_PER_DAY = 200; // invited rows one link can create a day: an open link must not fill the table
const BURST = 10; // signups through one link inside 24 h before the rows are flagged for a look
const SHARED_NET = 3; // signups through one link from one network inside 30 days before they are flagged

export async function referralConfig(): Promise<ReferralConfig> {
  const plans = await db.plan.findMany({ select: { slug: true } });
  return normalizeReferral(await getConfig("referral"), plans.map((p) => p.slug));
}

/** Every user gets one stable share code, made the first time they look for it. */
export async function ensureReferralCode(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (u.referralCode) return u.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    try {
      const done = await db.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } });
      if (done.count) return code;
      return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } })).referralCode!;
    } catch {
      /* unique clash, roll again */
    }
  }
  throw new Error("Could not make a referral code");
}

export const referralUrl = (code: string) => shareUrl(env.APP_URL, code);

/** Keyed hash of the network, so abuse checks can compare signups without keeping anyone's IP. */
export const netHash = (ip: string | null | undefined) => (ip && ip !== "local" ? createHmac("sha256", env.AUTH_SECRET).update(`ref-net:${ip}`).digest("base64url").slice(0, 22) : null);

/** Someone opened a share link (the signup page reports it once). Makes the "Invited" row. Never throws. */
export async function recordOpen(code: string | undefined, visitorKey: string | undefined, ip?: string) {
  try {
    if (!isCode(code) || !visitorKey || !/^[a-zA-Z0-9-]{16,64}$/.test(visitorKey)) return false;
    const cfg = await referralConfig();
    if (!cfg.enabled) return false;
    const owner = await db.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!owner) return false;
    if (await db.referral.findUnique({ where: { visitorKey }, select: { id: true } })) return true;
    const today = await db.referral.count({ where: { referrerId: owner.id, status: "invited", createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= OPEN_CAP_PER_DAY) return false;
    await db.referral.create({ data: { referrerId: owner.id, code, visitorKey, status: "invited", ipHash: netHash(ip) } }).catch(() => {});
    return true;
  } catch (e) {
    console.error("[referral] open", e);
    return false;
  }
}

/**
 * Right after a new account is created. Reads the share cookies, ties the account to the link and clears
 * them. Self-referrals and an inbox that was already referred are kept as disqualified rows, so an admin
 * can see the attempt; a burst of signups or several from one network are flagged, not refused.
 */
export async function attachReferral(newUserId: string, ip?: string) {
  const jar = cookies();
  const code = jar.get(REF_COOKIE)?.value;
  const visitorKey = jar.get(REF_VISITOR)?.value;
  if (!code) return;
  jar.delete(REF_COOKIE);
  jar.delete(REF_VISITOR);
  if (!isCode(code)) return;
  const cfg = await referralConfig();
  if (!cfg.enabled) return;
  const [owner, me] = await Promise.all([
    db.user.findUnique({ where: { referralCode: code }, select: { id: true, email: true } }),
    db.user.findUnique({ where: { id: newUserId }, select: { id: true, email: true, referredById: true } }),
  ]);
  if (!me || !owner) return;
  if (await db.referral.findUnique({ where: { referredId: me.id }, select: { id: true } })) return;
  const now = new Date();
  const ipHash = netHash(ip);
  const myInbox = inboxKey(me.email);
  let disq: string | null = null;
  if (owner.id === me.id || inboxKey(owner.email) === myInbox) disq = "Signed up with the sharer's own inbox";
  else if (await db.referral.findFirst({ where: { inboxKey: myInbox, referredId: { not: null } }, select: { id: true } })) disq = "This inbox was already referred";
  else if (!referrerFor(code, me, owner)) disq = "Already referred";
  const flags: string[] = [];
  if (!disq) {
    const [burst, shared] = await Promise.all([
      db.referral.count({ where: { referrerId: owner.id, registeredAt: { gt: new Date(now.getTime() - 86_400_000) } } }),
      ipHash ? db.referral.count({ where: { referrerId: owner.id, ipHash, registeredAt: { gt: new Date(now.getTime() - 30 * 86_400_000) } } }) : 0,
    ]);
    if (burst >= BURST) flags.push("burst");
    if (shared >= SHARED_NET - 1) flags.push("shared-network");
  }
  const data = {
    referrerId: owner.id, referredId: me.id, code, status: disq ? "disqualified" : "registered", ipHash, inboxKey: myInbox, flags: flags.join(","), registeredAt: now,
    ...(disq ? { disqualifiedAt: now, disqualifiedReason: disq } : {}),
  };
  // The row the link made when it was opened becomes this signup; otherwise a fresh one.
  const opened = visitorKey ? await db.referral.findUnique({ where: { visitorKey }, select: { id: true, referrerId: true, referredId: true } }) : null;
  try {
    if (opened && opened.referrerId === owner.id && !opened.referredId) await db.referral.update({ where: { id: opened.id }, data });
    else await db.referral.create({ data });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // a racing second attach: the first one stands
    return;
  }
  if (!disq) await db.user.update({ where: { id: me.id }, data: { referredById: owner.id } });
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Issue the reward for a referral whose qualifying payment is in. Idempotent: the grant is unique per
 * referral, so a webhook retry, the return URL and email verification can all call it.
 */
async function issueReward(referralId: string, now = new Date()) {
  const cfg = await referralConfig();
  const r = await db.referral.findUnique({ where: { id: referralId }, include: { referred: { select: { id: true, name: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } }, grant: true } });
  if (!r || r.status !== "paid" || r.grant || !r.referred || !r.paymentId) return null;
  if (!isProven(r.referred)) return null; // waits for the address to be verified (settleReferral)
  const pay = await db.payment.findUnique({ where: { id: r.paymentId }, select: { status: true } });
  if (pay?.status !== "succeeded") return null;
  const plan = await db.plan.findUnique({ where: { slug: cfg.rewardPlan } });
  if (!plan) return null;
  // Stacked after the paid period: the latest end among the friend's paid plans.
  const subs = await db.subscription.findMany({ where: { userId: r.referred.id, status: "active", currentPeriodEnd: { gt: now } } });
  const paidUntil = subs.filter(isPaidSub).reduce<Date | null>((a, s) => (!a || s.currentPeriodEnd > a ? s.currentPeriodEnd : a), null);
  const win = rewardWindow(paidUntil, now, cfg.rewardDays);
  try {
    const g = await db.$transaction(async (tx) => {
      const flip = await tx.referral.updateMany({ where: { id: r.id, status: "paid" }, data: { status: "rewarded" } });
      if (!flip.count) return null;
      return tx.planGrant.create({
        data: { userId: r.referred!.id, email: r.referred!.email.toLowerCase(), planId: plan.id, source: "referral", status: "active", startsAt: win.startsAt, endsAt: win.endsAt, durationDays: cfg.rewardDays, note: `Refer & Earn: qualifying payment ${r.paymentId}`, grantedBy: "system", referralId: r.id },
      });
    });
    if (!g) return null;
    await audit({ actor: SYSTEM, action: "referral.reward", targetType: "referral", targetId: r.id, email: r.referred.email, after: { grant: g.id, plan: plan.slug, startsAt: g.startsAt, endsAt: g.endsAt } });
    const days = cfg.rewardDays === 30 ? "1 month" : `${cfg.rewardDays} days`;
    await sendEmail({
      to: r.referred.email,
      kind: "referral",
      subject: `Your free ${days} of ${plan.name} is ready`,
      html: templates.referralFriendReward({ name: r.referred.name, plan: plan.name, length: days, starts: fmtDay(g.startsAt), until: fmtDay(g.endsAt), url: `${env.APP_URL}/settings#referral` }),
    }).catch((e) => console.error("[referral] email", e));
    await adminEvent("referral", `${r.referred.name} earned ${days} of ${plan.name}`, "Refer & Earn: first qualifying payment", "/admin/referrals").catch(() => {});
    return g;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null; // already granted
    throw e;
  }
}

/**
 * A payment just succeeded (completePayment, any gateway). If this account came through a link and this is
 * its first qualifying payment, record it and issue the friend's month. Never throws.
 */
export async function rewardReferredFriend(paymentId: string) {
  try {
    const p = await db.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.sample || p.status !== "succeeded" || p.amountMinor <= 0 || !p.planId) return null;
    const [cfg, plan] = await Promise.all([referralConfig(), db.plan.findUnique({ where: { id: p.planId }, select: { slug: true } })]);
    if (!cfg.enabled || !plan || !cfg.eligiblePlans.includes(plan.slug)) return null;
    let r = await db.referral.findUnique({ where: { referredId: p.userId } });
    if (!r) {
      // Signed up through a link before Refer & Earn (1052): their first real payment still counts.
      const u = await db.user.findUnique({ where: { id: p.userId }, select: { referredById: true, email: true, createdAt: true } });
      const real = await db.payment.count({ where: { userId: p.userId, status: { in: ["succeeded", "refunded"] }, sample: false } });
      if (!u?.referredById || real !== 1) return null;
      const owner = await db.user.findUnique({ where: { id: u.referredById }, select: { referralCode: true } });
      r = await db.referral.create({ data: { referrerId: u.referredById, referredId: p.userId, code: owner?.referralCode ?? "legacy", status: "registered", inboxKey: inboxKey(u.email), registeredAt: u.createdAt } }).catch(() => null);
      if (!r) return null;
    }
    if (r.status !== "registered" && r.status !== "invited") return r.status === "paid" ? issueReward(r.id) : null;
    const claimed = await db.referral.updateMany({ where: { id: r.id, status: { in: ["registered", "invited"] }, paymentId: null }, data: { status: "paid", paymentId: p.id, paidAt: new Date() } });
    if (!claimed.count) return null;
    return await issueReward(r.id);
  } catch (e) {
    console.error("[referral] reward", e);
    return null;
  }
}

/** The friend's address was just verified: a payment that was waiting on it can now earn the month. Never throws. */
export async function settleReferral(userId: string) {
  try {
    const r = await db.referral.findUnique({ where: { referredId: userId }, select: { id: true, status: true } });
    if (r?.status === "paid") await issueReward(r.id);
  } catch (e) {
    console.error("[referral] settle", e);
  }
}

/** Ends the reward (and disqualifies the referral). Refunds and chargebacks call it with the payment id. */
async function disqualify(r: { id: string; referred?: { email: string } | null }, actor: Actor, reason: string, now = new Date()) {
  const before = await db.referral.findUnique({ where: { id: r.id }, include: { grant: true } });
  if (!before) return null;
  await db.$transaction([
    db.referral.update({ where: { id: r.id }, data: { status: "disqualified", disqualifiedAt: now, disqualifiedReason: reason.slice(0, 300) } }),
    ...(before.grant && before.grant.status !== "revoked" ? [db.planGrant.update({ where: { id: before.grant.id }, data: { status: "revoked", liveKey: null, revokedAt: now, revokedBy: actor.login, revokeReason: reason.slice(0, 300) } })] : []),
  ]);
  const email = r.referred?.email ?? before.grant?.email ?? null;
  await audit({ actor, action: "referral.revoke", targetType: "referral", targetId: r.id, email, before: { status: before.status, grant: before.grant?.id ?? null, grantStatus: before.grant?.status ?? null }, after: { status: "disqualified" }, note: reason });
  return before;
}

/** The qualifying payment was refunded or charged back: the free month goes with it. Never throws. */
export async function revokeReferralForPayment(paymentId: string, by: string, why: "refund" | "chargeback" = "refund") {
  try {
    const r = await db.referral.findUnique({ where: { paymentId }, include: { referred: { select: { email: true } } } });
    if (!r || r.status === "disqualified") return false;
    await disqualify(r, { login: by }, why === "chargeback" ? "Qualifying payment was charged back" : "Qualifying payment was refunded");
    return true;
  } catch (e) {
    console.error("[referral] revoke", e);
    return false;
  }
}

/** Admin: disqualify one referral (and end its reward), with a reason for the trail. */
export async function adminRevokeReferral(id: string, reason: string, actor: Actor) {
  const r = await db.referral.findUnique({ where: { id }, include: { referred: { select: { email: true } } } });
  if (!r) return null;
  if (r.status === "disqualified") return r;
  return disqualify(r, actor, reason || "Disqualified by an admin");
}

/** The Refer & Earn card: link, counts, history with friendly statuses, and the terms in force. */
export async function referralSummary(userId: string) {
  const [code, cfg] = await Promise.all([ensureReferralCode(userId), referralConfig()]);
  const now = new Date();
  const [rows, plan, eligible, myReward] = await Promise.all([
    db.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { name: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } }, grant: { select: { status: true, endsAt: true, startsAt: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.plan.findUnique({ where: { slug: cfg.rewardPlan }, select: { name: true } }),
    db.plan.findMany({ where: { slug: { in: cfg.eligiblePlans } }, select: { name: true }, orderBy: { sortOrder: "asc" } }),
    db.referral.findUnique({ where: { referredId: userId }, include: { grant: { select: { status: true, startsAt: true, endsAt: true } } } }),
  ]);
  const history = rows
    .filter((r) => r.status !== "invited" || !!r.visitorKey)
    .map((r) => {
      const status = referralLabel({ status: r.status, verified: r.referred ? isProven(r.referred) : false, grant: r.grant }, now);
      return {
        id: r.id,
        friend: r.referred ? `${r.referred.name.split(" ")[0] || "A friend"} (${maskEmail(r.referred.email)})` : "Someone opened your link",
        status,
        at: (r.registeredAt ?? r.createdAt).toISOString(),
        rewardStarts: r.grant?.startsAt.toISOString() ?? null,
        rewardEnds: r.grant?.endsAt.toISOString() ?? null,
      };
    });
  const count = (s: string) => history.filter((h) => h.status === s).length;
  return {
    code,
    url: referralUrl(code),
    enabled: cfg.enabled,
    terms: { plan: plan?.name ?? "Creator", days: cfg.rewardDays, eligible: eligible.map((p) => p.name) },
    stats: {
      invited: history.length,
      registered: history.filter((h) => h.status !== "Invited").length,
      awaiting: count("Registered") + count("Awaiting qualifying payment"),
      verified: count("Payment verified"),
      rewarded: count("Reward granted") + count("Reward expired"),
      disqualified: count("Referral disqualified"),
    },
    history: history.slice(0, 50),
    // This account's own reward, if it joined through someone's link.
    mine: myReward
      ? { status: referralLabel({ status: myReward.status, verified: true, grant: myReward.grant }, now), startsAt: myReward.grant?.startsAt.toISOString() ?? null, endsAt: myReward.grant?.endsAt.toISOString() ?? null }
      : null,
  };
}

// ------------------------------------------------------------------ admin views

export async function adminReferrals(q: { search?: string; status?: string; flagged?: boolean } = {}) {
  const s = q.search?.trim().toLowerCase();
  const who = s ? await db.user.findMany({ where: { OR: [{ email: { contains: s } }, { referralCode: s }] }, select: { id: true }, take: 50 }) : null;
  const ids = who?.map((u) => u.id) ?? [];
  const rows = await db.referral.findMany({
    where: {
      ...(q.status ? { status: q.status } : { status: { not: "invited" } }),
      ...(q.flagged ? { flags: { not: "" } } : {}),
      ...(s ? { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }, { code: s }] } : {}),
    },
    include: {
      referrer: { select: { id: true, name: true, email: true } },
      referred: { select: { id: true, name: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true, createdAt: true } },
      grant: { select: { id: true, status: true, startsAt: true, endsAt: true, plan: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 150,
  });
  const now = new Date();
  // Same network or inbox as someone else in this list: shown so an admin can investigate.
  const net = new Map<string, number>();
  for (const r of rows) if (r.ipHash) net.set(r.ipHash, (net.get(r.ipHash) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    label: referralLabel({ status: r.status, verified: r.referred ? isProven(r.referred) : false, grant: r.grant }, now),
    referrer: r.referrer,
    referred: r.referred ? { id: r.referred.id, name: r.referred.name, email: r.referred.email, verified: isProven(r.referred), joined: r.referred.createdAt } : null,
    flags: r.flags ? r.flags.split(",") : [],
    sameNetwork: r.ipHash ? (net.get(r.ipHash) ?? 1) - 1 : 0,
    paymentId: r.paymentId,
    paidAt: r.paidAt,
    registeredAt: r.registeredAt,
    disqualifiedReason: r.disqualifiedReason,
    grant: r.grant ? { id: r.grant.id, status: r.grant.status, plan: r.grant.plan.name, startsAt: r.grant.startsAt, endsAt: r.grant.endsAt } : null,
    createdAt: r.createdAt,
  }));
}

export async function referralTotals() {
  const g = await db.referral.groupBy({ by: ["status"], _count: true });
  const by = Object.fromEntries(g.map((x) => [x.status, x._count])) as Record<string, number>;
  return { invited: by.invited ?? 0, registered: by.registered ?? 0, paid: by.paid ?? 0, rewarded: by.rewarded ?? 0, disqualified: by.disqualified ?? 0, flagged: await db.referral.count({ where: { flags: { not: "" } } }) };
}
