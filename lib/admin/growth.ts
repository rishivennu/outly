import "server-only";
import { db } from "../db";
import { funnel, leadScore, parseSource, type LeadKind, type Temp } from "../growth/core";

const DAY = 864e5;
const real = { practice: false, platformStatus: "published" } as const;
const paidPay = { status: { in: ["succeeded", "refunded"] } };
const days = (from: Date | null | undefined, now: Date) => (from ? Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY)) : 0);

export type Range = "30" | "90" | "all";
export const rangeStart = (r: Range, now = new Date()) => (r === "all" ? new Date(0) : new Date(now.getTime() - Number(r) * DAY));

/** waitlist -> signed up -> connected -> first post -> paid, for people who arrived in the range. */
export async function growthFunnel(since: Date) {
  const born = { createdAt: { gte: since } };
  const [waitlist, signed, connected, posted, paid] = await Promise.all([
    db.waitlistEntry.count({ where: born }),
    db.user.count({ where: born }),
    db.user.count({ where: { ...born, socialAccounts: { some: {} } } }),
    db.user.count({ where: { ...born, posts: { some: { targets: { some: real } } } } }),
    db.user.count({ where: { ...born, payments: { some: paidPay } } }),
  ]);
  return funnel([
    { key: "waitlist", label: "Joined the waitlist", count: waitlist },
    { key: "signed", label: "Signed up", count: signed },
    { key: "connected", label: "Connected an account", count: connected },
    { key: "posted", label: "Sent a first post", count: posted },
    { key: "paid", label: "Paid", count: paid },
  ]);
}

/** Which channels bring people who actually stay: signups, then how many of them post and pay. */
export async function channelStats(since: Date) {
  const born = { createdAt: { gte: since } };
  const by = (where: object) => db.user.groupBy({ by: ["signupSource"], where: { ...born, ...where }, _count: { _all: true } });
  const [all, connected, posted, paid] = await Promise.all([by({}), by({ socialAccounts: { some: {} } }), by({ posts: { some: { targets: { some: real } } } }), by({ payments: { some: paidPay } })]);
  const rows = new Map<string, { source: string; medium: string; campaign: string; key: string; signups: number; connected: number; posted: number; paid: number }>();
  const add = (list: typeof all, field: "signups" | "connected" | "posted" | "paid") => {
    for (const g of list) {
      const key = g.signupSource ?? "direct";
      const r = rows.get(key) ?? { ...parseSource(key), key, signups: 0, connected: 0, posted: 0, paid: 0 };
      r[field] += g._count._all;
      rows.set(key, r);
    }
  };
  add(all, "signups");
  add(connected, "connected");
  add(posted, "posted");
  add(paid, "paid");
  return [...rows.values()].sort((a, b) => b.paid - a.paid || b.posted - a.posted || b.signups - a.signups);
}

export async function referralBoard(take = 10) {
  const [joined, paid] = await Promise.all([
    db.user.groupBy({ by: ["referredById"], where: { referredById: { not: null } }, _count: { _all: true } }),
    db.user.groupBy({ by: ["referredById"], where: { referredById: { not: null }, payments: { some: paidPay } }, _count: { _all: true } }),
  ]);
  const paidBy = new Map(paid.map((p) => [p.referredById!, p._count._all]));
  const top = joined
    .map((j) => ({ id: j.referredById!, joined: j._count._all, paid: paidBy.get(j.referredById!) ?? 0 }))
    .sort((a, b) => b.paid - a.paid || b.joined - a.joined)
    .slice(0, take);
  const people = await db.user.findMany({ where: { id: { in: top.map((t) => t.id) } }, select: { id: true, name: true, email: true, avatar: true, referralCode: true } });
  const who = new Map(people.map((p) => [p.id, p]));
  return {
    total: joined.reduce((s, j) => s + j._count._all, 0),
    paid: paid.reduce((s, p) => s + p._count._all, 0),
    rows: top.flatMap((t) => (who.has(t.id) ? [{ ...who.get(t.id)!, joined: t.joined, paid: t.paid }] : [])),
  };
}

export interface Lead {
  /** "u:<userId>" or "w:<waitlistId>" */
  ref: string;
  name: string | null;
  email: string;
  avatar: string | null;
  since: Date;
  score: number;
  temp: Temp;
  detail: string;
  emailedAt: Date | null;
}

type Cand = { ref: string; id: string; name: string | null; email: string; avatar: string | null; since: Date; ageFrom: Date | null; referred: boolean; detail: string };

/** One lead list, scored, hottest first. Users get their app activity and recent posts counted in. */
export async function leads(kind: LeadKind, now = new Date(), take = 500): Promise<Lead[]> {
  const d14 = new Date(now.getTime() - 14 * DAY);
  const d21 = new Date(now.getTime() - 21 * DAY);
  const d30 = new Date(now.getTime() - 30 * DAY);
  const userSel = { id: true, name: true, email: true, avatar: true, createdAt: true, lastActiveAt: true, referredById: true } as const;
  let cands: Cand[] = [];

  if (kind === "waitlist") {
    const rows = await db.waitlistEntry.findMany({ where: { invitedAt: null }, orderBy: { createdAt: "asc" }, take: take * 2 });
    const taken = new Set((await db.user.findMany({ where: { email: { in: rows.map((r) => r.email) } }, select: { email: true } })).map((u) => u.email));
    cands = rows
      .filter((r) => !taken.has(r.email))
      .slice(0, take)
      .map((r) => ({ ref: `w:${r.id}`, id: r.id, name: r.name, email: r.email, avatar: null, since: r.createdAt, ageFrom: r.createdAt, referred: false, detail: r.source ? `From ${r.source}` : "Joined the list" }));
  } else if (kind === "unconnected") {
    const rows = await db.user.findMany({ where: { socialAccounts: { none: {} } }, orderBy: { createdAt: "desc" }, take, select: userSel });
    cands = rows.map((u) => ({ ref: `u:${u.id}`, id: u.id, name: u.name, email: u.email, avatar: u.avatar, since: u.createdAt, ageFrom: u.createdAt, referred: !!u.referredById, detail: "No account linked" }));
  } else if (kind === "unposted") {
    const rows = await db.user.findMany({
      where: { socialAccounts: { some: {} }, posts: { none: { targets: { some: real } } } },
      orderBy: { createdAt: "desc" },
      take,
      select: { ...userSel, socialAccounts: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true, platform: true } }, _count: { select: { posts: true } } },
    });
    cands = rows.map((u) => {
      const a = u.socialAccounts[0];
      return { ref: `u:${u.id}`, id: u.id, name: u.name, email: u.email, avatar: u.avatar, since: a?.createdAt ?? u.createdAt, ageFrom: a?.createdAt ?? u.createdAt, referred: !!u.referredById, detail: u._count.posts ? `${u._count.posts} draft${u._count.posts === 1 ? "" : "s"}, none sent` : `Connected ${a?.platform ?? "an account"}` };
    });
  } else if (kind === "free_active") {
    const rows = await db.user.findMany({
      where: { lastActiveAt: { gte: d14 }, payments: { none: paidPay }, subscriptions: { none: { status: "active", priceMinor: { gt: 0 } } } },
      orderBy: { lastActiveAt: "desc" },
      take,
      select: userSel,
    });
    cands = rows.map((u) => ({ ref: `u:${u.id}`, id: u.id, name: u.name, email: u.email, avatar: u.avatar, since: u.createdAt, ageFrom: u.lastActiveAt, referred: !!u.referredById, detail: "On Free" }));
  } else {
    const rows = await db.user.findMany({
      where: { posts: { some: { targets: { some: real } }, none: { targets: { some: { ...real, publishedAt: { gte: d21 } } } } } },
      orderBy: { lastActiveAt: "desc" },
      take,
      select: userSel,
    });
    const last = await db.post.groupBy({ by: ["userId"], where: { userId: { in: rows.map((r) => r.id) }, targets: { some: real } }, _max: { publishedAt: true } });
    const lastBy = new Map(last.map((l) => [l.userId, l._max.publishedAt]));
    cands = rows.map((u) => {
      const lp = lastBy.get(u.id) ?? null;
      return { ref: `u:${u.id}`, id: u.id, name: u.name, email: u.email, avatar: u.avatar, since: lp ?? u.createdAt, ageFrom: lp, referred: !!u.referredById, detail: lp ? `Last post ${days(lp, now)} days ago` : "Posted before" };
    });
  }

  const userIds = kind === "waitlist" ? [] : cands.map((c) => c.id);
  const [activity, recent, mailed] = await Promise.all([
    userIds.length ? db.userActivityDay.groupBy({ by: ["userId"], where: { userId: { in: userIds }, day: { gte: d14.toISOString().slice(0, 10) } }, _count: { _all: true } }) : [],
    userIds.length ? db.postTarget.findMany({ where: { ...real, publishedAt: { gte: d30 }, post: { userId: { in: userIds } } }, select: { postId: true, post: { select: { userId: true } } } }) : [],
    db.emailLog.groupBy({ by: ["to"], where: { kind: "growth", to: { in: cands.map((c) => c.email) }, status: { not: "failed" } }, _max: { createdAt: true } }),
  ]);
  const act = new Map(activity.map((a) => [a.userId, a._count._all]));
  const posts = new Map<string, Set<string>>();
  for (const t of recent) (posts.get(t.post.userId) ?? posts.set(t.post.userId, new Set()).get(t.post.userId)!).add(t.postId);
  const mail = new Map(mailed.map((m) => [m.to, m._max.createdAt]));

  // Quiet people are scored by how recently they went quiet, so the freshest lapse is the hottest.
  return cands
    .map((c) => {
      const s = leadScore(kind, { ageDays: kind === "quiet" ? Math.max(0, days(c.ageFrom, now) - 21) : days(c.ageFrom, now), activeDays14: act.get(c.id) ?? 0, posts30: posts.get(c.id)?.size ?? 0, referred: c.referred });
      return { ref: c.ref, name: c.name, email: c.email, avatar: c.avatar, since: c.since, ...s, detail: c.detail, emailedAt: mail.get(c.email) ?? null };
    })
    .sort((a, b) => b.score - a.score);
}

/** Resolves refs posted by the email composer back to real people. Unknown refs are dropped. */
export async function resolveRefs(refs: string[]) {
  const u = refs.filter((r) => r.startsWith("u:")).map((r) => r.slice(2));
  const w = refs.filter((r) => r.startsWith("w:")).map((r) => r.slice(2));
  const [users, wait] = await Promise.all([
    u.length ? db.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [],
    w.length ? db.waitlistEntry.findMany({ where: { id: { in: w }, invitedAt: null }, select: { id: true, name: true, email: true } }) : [],
  ]);
  return [...users.map((x) => ({ ref: `u:${x.id}`, waitlistId: null as string | null, name: x.name as string | null, email: x.email })), ...wait.map((x) => ({ ref: `w:${x.id}`, waitlistId: x.id, name: x.name, email: x.email }))];
}
