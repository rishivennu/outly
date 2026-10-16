import "server-only";
import { db } from "../db";
import { env } from "../env";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { PLATFORM_META, isPlatform } from "../domain";
import { isPracticeAccount } from "../social/registry";
import { noticeKey, parseKey, weekStamp } from "./core";

export interface NoticeInput {
  kind: "post_failed" | "post_live" | "reconnect" | "token_expiring" | "goal_nudge";
  tone: "danger" | "warn" | "info";
  title: string;
  body: string;
  href?: string | null;
  action?: string | null;
  key: string;
}

const platformName = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : p);
const absolute = (href: string) => (href.startsWith("http") ? href : `${env.APP_URL}${href}`);

/**
 * Records a notice once per key. A repeat of the same key brings an old, read notice back to
 * the top instead of piling up copies. Email goes out only the first time, and never in maintenance.
 */
export async function notify(userId: string, n: NoticeInput, opts: { email?: boolean } = {}) {
  const existing = await db.notice.findUnique({ where: { key: n.key } });
  if (existing) {
    if (existing.readAt) await db.notice.update({ where: { id: existing.id }, data: { readAt: null, title: n.title, body: n.body, createdAt: new Date() } });
    return { created: false, id: existing.id };
  }
  const created = await db.notice
    .create({ data: { userId, kind: n.kind, tone: n.tone, title: n.title, body: n.body, href: n.href ?? null, action: n.action ?? null, key: n.key } })
    .catch(() => null); // two workers racing on the same key: the other one won
  if (!created) return { created: false, id: null };
  if (opts.email && !(await getConfig("site")).maintenance) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (u)
      await sendEmail({
        to: u.email,
        kind: "notice",
        subject: n.title,
        html: templates.notice({ name: u.name.split(" ")[0], title: n.title, body: n.body, url: absolute(n.href ?? "/home"), action: n.action ?? "Open Outlly", tone: n.tone }),
      }).catch(() => {});
  }
  return { created: true, id: created.id };
}

/** Called when a target gives up for good. Practice runs stay quiet. One email per post, however many platforms failed. */
export async function noticeFailedTarget(targetId: string, code: string) {
  const t = await db.postTarget.findUnique({
    where: { id: targetId },
    select: { id: true, practice: true, platform: true, postId: true, socialAccount: { select: { id: true, platformUserId: true } }, post: { select: { userId: true, title: true, hook: true, scheduledAt: true } } },
  });
  if (!t || t.practice || (t.socialAccount && isPracticeAccount(t.socialAccount))) return;
  const name = platformName(t.platform);
  const title = (t.post.title || t.post.hook || "Your post").split("\n")[0].slice(0, 60);
  const prefix = `fail:${t.postId}:`;
  const sibling = await db.notice.count({ where: { key: { startsWith: prefix } } });
  await notify(
    t.post.userId,
    {
      kind: "post_failed",
      tone: "danger",
      title: `"${title}" didn't post to ${name}`,
      body: code === "AUTH_EXPIRED" ? `${name} signed Outlly out, so the post couldn't go out. Reconnect, then retry it.` : `${name} turned the post down. Open it to see why and retry.`,
      href: "/content?filter=failed",
      action: "See what happened",
      key: noticeKey.failed(t.postId, t.id),
    },
    { email: sibling === 0 },
  );
  if (code === "AUTH_EXPIRED" && t.socialAccount) await noticeReconnect(t.post.userId, t.socialAccount.id, t.platform);
}

export async function noticeReconnect(userId: string, accountId: string, platform: string, now = new Date()) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const name = platformName(platform);
  return notify(
    userId,
    { kind: "reconnect", tone: "danger", title: `Reconnect ${name}`, body: `${name} signed Outlly out. Posts to it will fail until you reconnect, which takes about a minute.`, href: "/accounts", action: `Reconnect ${name}`, key: noticeKey.reconnect(accountId, weekStamp(now, u?.timezone ?? "UTC")) },
    { email: true },
  );
}

/**
 * Tokens that can't refresh themselves (no refresh token) and end within a week get a warning,
 * once per account per week. Accounts already marked for reconnect get the reconnect notice.
 */
export async function sweepAccountHealth(now = new Date()) {
  const soon = new Date(now.getTime() + 7 * 864e5);
  const accounts = await db.socialAccount.findMany({
    where: { OR: [{ status: "needs_reconnect" }, { status: "connected", refreshToken: null, tokenExpiresAt: { gt: now, lt: soon } }] },
    select: { id: true, userId: true, platform: true, platformUserId: true, status: true, tokenExpiresAt: true, user: { select: { timezone: true } } },
    take: 200,
  });
  let sent = 0;
  for (const a of accounts) {
    if (isPracticeAccount(a)) continue;
    const week = weekStamp(now, a.user.timezone);
    if (a.status === "needs_reconnect") {
      if ((await noticeReconnect(a.userId, a.id, a.platform, now)).created) sent++;
      continue;
    }
    const days = Math.max(1, Math.ceil((a.tokenExpiresAt!.getTime() - now.getTime()) / 864e5));
    const name = platformName(a.platform);
    const r = await notify(
      a.userId,
      { kind: "token_expiring", tone: "warn", title: `${name} access ends ${days <= 1 ? "tomorrow" : `in ${days} days`}`, body: `${name} only lets Outlly post for a limited time. Reconnect before then so nothing you scheduled fails.`, href: "/accounts", action: `Reconnect ${name}`, key: noticeKey.expiring(a.id, week) },
      { email: true },
    );
    if (r.created) sent++;
  }
  return { checked: accounts.length, sent };
}

/** Marks notices read once the thing they were about is fixed: the post went out, or the account is healthy again. */
export async function resolveStale(userId: string, now = new Date()) {
  const open = await db.notice.findMany({ where: { userId, readAt: null, kind: { in: ["post_failed", "reconnect", "token_expiring"] } }, select: { id: true, key: true } });
  if (!open.length) return 0;
  const done: string[] = [];
  const targets = open.filter((n) => n.key.startsWith("fail:")).map((n) => ({ id: n.id, ...parseKey(n.key) }));
  const accts = open.filter((n) => !n.key.startsWith("fail:")).map((n) => ({ id: n.id, ...parseKey(n.key) }));
  if (targets.length) {
    const rows = await db.postTarget.findMany({ where: { id: { in: targets.map((t) => t.b) } }, select: { id: true, platformStatus: true } });
    const st = new Map(rows.map((r) => [r.id, r.platformStatus]));
    for (const t of targets) if (st.get(t.b) !== "failed") done.push(t.id); // published, retrying, or the post was deleted
  }
  if (accts.length) {
    const rows = await db.socialAccount.findMany({ where: { id: { in: accts.map((a) => a.a) } }, select: { id: true, status: true, refreshToken: true, tokenExpiresAt: true } });
    const by = new Map(rows.map((r) => [r.id, r]));
    const week = now.getTime() + 7 * 864e5;
    for (const a of accts) {
      const r = by.get(a.a);
      const healthy = !r || r.status === "disconnected" || (r.status === "connected" && (!!r.refreshToken || !r.tokenExpiresAt || r.tokenExpiresAt.getTime() > week));
      if (healthy) done.push(a.id);
    }
  }
  if (done.length) await db.notice.updateMany({ where: { id: { in: done } }, data: { readAt: now } });
  return done.length;
}

export async function listNotices(userId: string) {
  await resolveStale(userId).catch(() => 0);
  const rows = await db.notice.findMany({ where: { userId }, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 20 });
  return rows.map((n) => ({ id: n.id, kind: n.kind, tone: n.tone, title: n.title, body: n.body, href: n.href, action: n.action, read: !!n.readAt, createdAt: n.createdAt.toISOString() }));
}

/**
 * Called once when a send settles with at least one place live (10-16g). In-app only, no email: a
 * failure already has its own notice and email. Practice runs stay quiet. Links to the posting screen,
 * which shows the summary.
 */
export async function noticePostLive(postId: string) {
  const p = await db.post.findUnique({
    where: { id: postId },
    select: { userId: true, title: true, hook: true, targets: { select: { platform: true, platformStatus: true, practice: true, socialAccount: { select: { id: true, platformUserId: true } } } } },
  });
  if (!p) return;
  const real = p.targets.filter((t) => !t.practice && !(t.socialAccount && isPracticeAccount(t.socialAccount)));
  const live = real.filter((t) => t.platformStatus === "published");
  if (!live.length) return;
  const rest = real.filter((t) => t.platformStatus === "failed");
  const names = (ts: { platform: string }[]) => {
    const n = ts.map((t) => platformName(t.platform));
    return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  };
  const title = (p.title || p.hook || "Your post").split("\n")[0].slice(0, 60);
  await notify(p.userId, {
    kind: "post_live",
    tone: "info",
    title: `"${title}" is live on ${names(live)}`,
    body: rest.length ? `${names(rest)} still ${rest.length === 1 ? "needs" : "need"} a hand. Open it to see what happened.` : "Everything went out. Open it for the links to each post.",
    href: `/create?post=${postId}`,
    action: "See what happened",
    key: noticeKey.live(postId),
  });
}
