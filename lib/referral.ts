import "server-only";
import { addMonths } from "date-fns";
import { cookies } from "next/headers";
import { db } from "./db";
import { env } from "./env";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { REF_COOKIE, isCode, makeCode, referrerFor } from "./referral-core";

export { REF_COOKIE };

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

export const referralUrl = (code: string) => `${env.APP_URL}/r/${code}`;

export async function referralSummary(userId: string) {
  const code = await ensureReferralCode(userId);
  const [joined, rewarded] = await Promise.all([
    db.user.count({ where: { referredById: userId } }),
    db.user.count({ where: { referredById: userId, payments: { some: { status: "succeeded", sample: false } } } }),
  ]);
  return { code, url: referralUrl(code), joined, rewarded };
}

/** Call right after a new account is created. Reads the share cookie, credits the owner, clears it. */
export async function attachReferral(newUserId: string) {
  const jar = cookies();
  const code = jar.get(REF_COOKIE)?.value;
  if (!code) return;
  jar.delete(REF_COOKIE);
  if (!isCode(code)) return;
  const [owner, me] = await Promise.all([
    db.user.findUnique({ where: { referralCode: code }, select: { id: true } }),
    db.user.findUnique({ where: { id: newUserId }, select: { id: true, referredById: true } }),
  ]);
  if (!me) return;
  const by = referrerFor(code, me, owner);
  if (by) await db.user.update({ where: { id: newUserId }, data: { referredById: by } });
}

/**
 * The referred user just paid for the first time: the person who shared the link gets one free month.
 * An active plan is extended by a month; with no plan they get a month of the plan their friend bought.
 */
export async function rewardReferrer(userId: string, planId: string) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { name: true, referredById: true } });
  if (!me?.referredById) return;
  const paid = await db.payment.count({ where: { userId, status: { in: ["succeeded", "refunded"] }, sample: false } });
  if (paid !== 1) return; // only the first real payment counts
  const ref = await db.user.findUnique({ where: { id: me.referredById }, select: { id: true, name: true, email: true } });
  if (!ref) return;
  const now = new Date();
  const active = await db.subscription.findFirst({ where: { userId: ref.id, status: "active" }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } });
  let planName: string;
  let until: Date;
  if (active && active.priceMinor > 0) {
    until = addMonths(active.currentPeriodEnd > now ? active.currentPeriodEnd : now, 1);
    await db.subscription.update({ where: { id: active.id }, data: { currentPeriodEnd: until } });
    planName = active.plan.name;
  } else {
    const plan = await db.plan.findUniqueOrThrow({ where: { id: planId } });
    until = addMonths(now, 1);
    await db.subscription.updateMany({ where: { userId: ref.id, status: "active" }, data: { status: "canceled", canceledAt: now } });
    // A gift month: nothing to charge, it simply ends.
    await db.subscription.create({
      data: { userId: ref.id, planId: plan.id, status: "active", priceMinor: 0, currency: plan.currency, interval: "month", provider: "referral", currentPeriodEnd: until, cancelAtPeriodEnd: true },
    });
    planName = plan.name;
  }
  const untilLabel = until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  await sendEmail({
    to: ref.email,
    kind: "referral",
    subject: "You earned a free month on Outlly",
    html: templates.referralReward({ name: ref.name, friend: me.name, plan: planName, until: untilLabel, url: `${env.APP_URL}/settings#referral` }),
  }).catch((e) => console.error("[referral] email", e));
  await adminEvent("referral", `${ref.name} earned a free month`, `${me.name} upgraded via their link`, "/admin/users").catch(() => {});
}
