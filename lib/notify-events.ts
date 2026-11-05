import "server-only";
import { format } from "date-fns";
import { db } from "./db";
import { PLATFORM_META, isPlatform } from "./domain";
import { isPracticeAccount } from "./social/registry";
import { formatMoney, type Currency } from "./billing/money";
import { notify } from "./retention/notices";
import { crossed, milestoneLabel } from "./notify-core";
import { dayStamp } from "./alerts-core";

/*
 * 1118: the notices that came with the notification settings. Each one is raised only where the server has
 * just verified the event itself: a payment the gateway confirmed, a webhook, a platform answer, a sweep.
 * All best effort: a notice that can't be written never breaks the payment, post or connect it describes.
 */

const name = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);
const quiet = <T>(p: Promise<T>) => p.catch((e) => (console.error("[notify]", e), null));
const money = (minor: number, cur: string) => formatMoney(minor, cur as Currency);

/** A payment went through (checkout or an auto-renew charge). Sample (test-mode) payments stay quiet. */
export function noticePaymentOk(paymentId: string) {
  return quiet(
    (async () => {
      const p = await db.payment.findUnique({ where: { id: paymentId }, select: { userId: true, amountMinor: true, currency: true, sample: true, purpose: true, planId: true } });
      if (!p || p.sample) return;
      const plan = p.planId ? ((await db.plan.findUnique({ where: { id: p.planId }, select: { name: true } }))?.name ?? "Your plan") : "Your plan";
      const what = p.purpose === "topup" ? "Your top-up" : p.purpose === "renewal" ? `${plan} renewal` : plan;
      await notify(p.userId, { kind: "payment_ok", tone: "info", title: "Payment successful", body: `${what} payment of ${money(p.amountMinor, p.currency)} went through. The invoice is in Billing.`, href: "/billing", action: "See invoice", key: `pay_ok:${paymentId}` });
    })(),
  );
}

/** A payment failed at the gateway. Emailed too: a plan lapsing unnoticed is the worst outcome here. */
export function noticePaymentFailed(paymentId: string) {
  return quiet(
    (async () => {
      const p = await db.payment.findUnique({ where: { id: paymentId }, select: { userId: true, amountMinor: true, currency: true, sample: true } });
      if (!p || p.sample) return;
      await notify(
        p.userId,
        { kind: "payment_failed", tone: "danger", title: "Payment failed", body: `A payment of ${money(p.amountMinor, p.currency)} didn't go through. Nothing was charged. Try again or use another method.`, href: "/billing", action: "Open Billing", key: `pay_fail:${paymentId}` },
        { email: false },
      );
    })(),
  );
}

/** Razorpay stopped an auto-renew mandate (halted after failed charges, or cancelled at the bank). */
export function noticeAutoRenewStopped(userId: string, subId: string, halted: boolean, periodEnd: Date) {
  return quiet(
    notify(
      userId,
      halted
        ? { kind: "payment_failed", tone: "danger", title: "Auto-renew charge failed", body: `Your bank turned down the renewal charges, so auto-renew stopped. Your plan runs until ${format(periodEnd, "d MMM")}; renew in Billing to keep it.`, href: "/billing", action: "Renew plan", key: `halted:${subId}:${periodEnd.getTime()}` }
        : { kind: "plan_update", tone: "warn", title: "Auto-renew is off", body: `Auto-renew was switched off at the bank or the payment gateway. Your plan runs until ${format(periodEnd, "d MMM")}.`, href: "/billing", action: "Open Billing", key: `renew_off:${subId}:${periodEnd.getTime()}` },
      { email: false },
    ),
  );
}

/** The renewal reminder (a week and a day before), next to the email that already goes out. */
export function noticeRenewal(userId: string, s: { id: string; plan: string; at: Date; autoRenew: boolean; priceMinor: number; currency: string }, step: string) {
  return quiet(
    notify(userId, {
      kind: "renewal",
      tone: "info",
      title: s.autoRenew ? `${s.plan} renews on ${format(s.at, "d MMM")}` : `${s.plan} ends on ${format(s.at, "d MMM")}`,
      body: s.autoRenew ? `${money(s.priceMinor, s.currency)} will be charged automatically.` : "Renew before then to keep your plan's limits and features.",
      href: "/billing",
      action: s.autoRenew ? "Manage plan" : "Renew plan",
      key: `renewal:${s.id}:${s.at.getTime()}:${step}`,
    }),
  );
}

/** This month's AI allowance just ran out (the request that hit it was refused). Once a month. */
export function noticeUsageLimit(userId: string, limit: number, now = new Date()) {
  return quiet(
    notify(userId, {
      kind: "usage_limit",
      tone: "warn",
      title: "AI limit reached for this month",
      body: `You've used all ${limit} AI requests your plan includes this month. They come back on the 1st, or upgrade for more.`,
      href: "/billing",
      action: "See plans",
      key: `limit:ai:${userId}:${now.toISOString().slice(0, 7)}`,
    }),
  );
}

/** An account was connected (or reconnected) and is ready to post to. Once a day per account. */
export function noticeAccountConnected(acct: { id: string; userId: string; platform: string; platformUserId: string; username: string; createdAt: Date; updatedAt: Date }, tz = "UTC") {
  if (isPracticeAccount(acct)) return Promise.resolve(null);
  const again = acct.updatedAt.getTime() - acct.createdAt.getTime() > 5000;
  return quiet(
    notify(acct.userId, {
      kind: "account_connected",
      tone: "info",
      title: `${name(acct.platform)} ${again ? "reconnected" : "connected"}`,
      body: `@${acct.username.replace(/^@/, "")} is ready to post to.`,
      href: "/accounts",
      action: "See accounts",
      key: `connected:${acct.id}:${dayStamp(new Date(), tz)}`,
    }),
  );
}

/** A team member moved one of the owner's scheduled posts. The owner moving their own post stays quiet. */
export function noticeScheduleChange(post: { id: string; userId: string; title: string | null; hook: string | null }, by: string, at: Date | null, tz = "UTC") {
  const title = (post.title || post.hook || "A post").split("\n")[0].slice(0, 60);
  let when = "unscheduled";
  if (at) {
    try {
      when = `moved to ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(at)}`;
    } catch {
      when = `moved to ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    }
  }
  return quiet(
    notify(post.userId, { kind: "schedule_change", tone: "info", title: "Schedule changed", body: `${by} ${when === "unscheduled" ? "took" : "moved"} "${title}" ${when === "unscheduled" ? "off the schedule" : when.replace("moved ", "")}.`, href: `/create?post=${post.id}`, action: "Review it", key: `moved:${post.id}:${at?.getTime() ?? "none"}` }),
  );
}

/** 1136: the platform's mark as a notification picture, for when we have no photo of the person. */
export const platformIcon = (p: string) => (isPlatform(p) ? `/brand/platforms/${p}-192.png` : "/brand/app/icon-192.png");
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}\u2026` : t;
};

/**
 * 1136: someone commented on a post of a connected account (Meta webhook). The notification says which
 * platform, who, what they wrote and on which post, and carries what a quick reply needs. A busy post buzzes
 * at most once every 2 minutes (the device shows the latest; Inbox has them all). Meta's retries of the same
 * comment are the same key, so they never notify twice.
 */
export const COMMENT_GAP_MS = 2 * 60_000;
export function noticeNewComment(
  userId: string,
  c: { accountId: string; platform: string; commentId: string; replyTo: string; mediaId: string; targetId: string; postTitle: string | null; from: string; text: string },
  now = new Date(),
) {
  return quiet(
    (async () => {
      const base = `cm:${c.accountId}:${c.mediaId}:`;
      const last = await db.notice.findFirst({ where: { userId, kind: "new_comment", key: { startsWith: base } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, key: true } });
      if (last?.key === base + c.commentId) return;
      if (last && now.getTime() - last.createdAt.getTime() < COMMENT_GAP_MS) return;
      const p = name(c.platform);
      const on = c.postTitle ? `on \u201c${clip(c.postTitle, 48)}\u201d` : "on your post";
      const href = `/inbox?comment=${encodeURIComponent(c.replyTo)}&target=${encodeURIComponent(c.targetId)}`;
      await notify(
        userId,
        { kind: "new_comment", tone: "info", title: clip(`New ${p} comment from ${c.from}`, 80), body: `${c.text ? `\u201c${clip(c.text, 120)}\u201d ` : ""}${on}`.slice(0, 200), href, action: "Reply", key: base + c.commentId },
        { push: { icon: platformIcon(c.platform), platform: p, reply: { kind: "comment", targetId: c.targetId, commentId: c.replyTo }, who: c.from, tag: `cm:${c.accountId}:${c.mediaId}` } },
      );
    })(),
  );
}

/** A new DM came in. At most one alert per conversation per hour, so a chat doesn't buzz on every line. */
export function noticeNewMessage(userId: string, threadId: string, platform: string, from: string, text: string, now = new Date(), avatar: string | null = null) {
  return quiet(
    (async () => {
      // At most one an hour per thread, counted from the LAST notice for it, not from the clock hour
      // (which let 10:59 and 11:01 both through).
      const last = await db.notice.findFirst({
        where: { userId, kind: "new_message", key: { startsWith: `dm:${threadId}:` } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (last && now.getTime() - last.createdAt.getTime() < 60 * 60_000) return;
      // 1136: the platform in the title, the person's photo when Meta shared one, and a quick reply into this thread.
      const p = name(platform);
      await notify(
        userId,
        { kind: "new_message", tone: "info", title: clip(`New ${p} message from ${from}`, 80), body: clip(text || `Sent you a message on ${p}.`, 140), href: `/inbox?tab=messages&thread=${encodeURIComponent(threadId)}`, action: "Reply", key: `dm:${threadId}:${now.getTime()}` },
        { push: { icon: avatar && /^https:\/\//.test(avatar) ? avatar : platformIcon(platform), platform: p, reply: { kind: "dm", threadId }, who: from, tag: `dm:${threadId}` } },
      );
    })(),
  );
}

/** A post passed a view milestone on one platform (1K, 10K, 100K, 1M). Each milestone once. */
export async function noticeMilestones(targetId: string, before: number, after: number) {
  const hit = crossed(before, after);
  if (!hit.length) return;
  const top = hit[hit.length - 1];
  await quiet(
    (async () => {
      const t = await db.postTarget.findUnique({ where: { id: targetId }, select: { platform: true, practice: true, postId: true, post: { select: { userId: true, title: true, hook: true } } } });
      if (!t || t.practice) return;
      const title = (t.post.title || t.post.hook || "Your post").split("\n")[0].slice(0, 60);
      await notify(t.post.userId, { kind: "milestone", tone: "info", title: `${milestoneLabel(top)} views on ${name(t.platform)}`, body: `"${title}" just passed ${milestoneLabel(top)} views.`, href: `/analytics`, action: "See analytics", key: `ms:${targetId}:${top}` });
    })(),
  );
}
