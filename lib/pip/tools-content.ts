import "server-only";
import { db } from "../db";
import { isPlatform, PLATFORM_META, type Platform } from "../domain";
import { platformDashboard } from "../live";
import type { LivePost, PlatformDashboard } from "../live/types";
import { isPracticeAccount } from "../social/registry";
import { storage } from "../storage";
import type { DateRange } from "./range";
import { base, day, fetchAll, pageArgs, pct, plural, settle, within, type PipArgs, type PipCtx } from "./tools-core";
import type { PipResult } from "./types";

/**
 * Content answers (1049): posts, what did best, engagement, uploads, tickets, notifications, activity.
 * A teammate only sees the accounts they were given (ctx.scope). Rankings use the numbers the platforms
 * report for this creator's own posts; "why" compares a post with the creator's own medians, never a guess.
 */
const POST_STATUS = ["draft", "scheduled", "publishing", "published", "partial", "failed"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pname = (p: string) => (isPlatform(p) ? PLATFORM_META[p].name : cap(p));
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function posts(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "posts",
    "Your posts",
    range,
    [
      { key: "title", label: "Post" },
      { key: "status", label: "Status" },
      { key: "where", label: "Platforms" },
      { key: "date", label: "Date" },
    ],
    range ? "No posts in that period." : "No posts yet.",
    period,
  );
  const status = a.status && POST_STATUS.includes(a.status) ? a.status : null;
  const platform = a.platform && isPlatform(a.platform) ? a.platform : null;
  // Which date a period means depends on the status: published -> when it went out, scheduled -> when it will.
  const dateKey = status === "published" ? "publishedAt" : status === "scheduled" ? "scheduledAt" : "createdAt";
  const targetFilter = {
    practice: false,
    ...(platform ? { platform } : {}),
    ...(ctx.scope ? { socialAccountId: { in: ctx.scope } } : {}),
  };
  const where = {
    userId: ctx.ownerId,
    ...(status ? { status } : {}),
    ...(range ? { [dateKey]: within(range) } : {}),
    ...(platform || ctx.scope ? { targets: { some: targetFilter } } : {}),
  };
  const [found, got] = await Promise.all([
    db.post.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.post.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: {
          id: true,
          title: true,
          hook: true,
          story: true,
          status: true,
          createdAt: true,
          scheduledAt: true,
          publishedAt: true,
          media: { select: { originalFilename: true } },
          targets: { where: { practice: false }, select: { platform: true, platformUrl: true, socialAccountId: true } },
        },
      }),
    ),
  ]);
  const counts: Record<string, number> = {};
  for (const p of got.rows) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
    const targets = ctx.scope ? p.targets.filter((t) => t.socialAccountId && ctx.scope!.includes(t.socialAccountId)) : p.targets;
    const when = p.publishedAt ?? p.scheduledAt ?? p.createdAt;
    r.rows.push({
      id: p.id,
      cells: {
        title: short(p.title || p.hook || p.story || p.media.originalFilename || "Untitled"),
        status: cap(p.status),
        where: [...new Set(targets.map((t) => pname(t.platform)))].join(", ") || "Not picked",
        date: day(when, ctx.tz),
      },
      links: targets.filter((t) => t.platformUrl).slice(0, 3).map((t) => ({ label: `Open on ${pname(t.platform)}`, href: t.platformUrl! })),
    });
  }
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "posts");
  const parts = Object.entries(counts).map(([s, n]) => `${n} ${s}`);
  if (parts.length > 1) r.facts.push(`By status: ${parts.join(", ")}.`);
  r.downloads.push({ label: "Open your content", href: "/content" });
  return r;
}

type Acct = { id: string; platform: Platform; username: string };
async function accountsInScope(ctx: PipCtx, platform: string | null | undefined) {
  const rows = await db.socialAccount.findMany({
    where: { userId: ctx.ownerId, status: { not: "disconnected" }, ...(ctx.scope ? { id: { in: ctx.scope } } : {}), ...(platform && isPlatform(platform) ? { platform } : {}) },
    select: { id: true, platform: true, username: true, platformUserId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.filter((a) => isPlatform(a.platform) && !isPracticeAccount(a)).map((a) => ({ id: a.id, platform: a.platform as Platform, username: a.username }));
}

/** One dashboard per account, in parallel; a failure is reported per account, never hidden. */
async function dashboards(ctx: PipCtx, accts: Acct[], r: PipResult) {
  const out: { acct: Acct; d: PlatformDashboard }[] = [];
  await Promise.all(
    accts.map(async (acct) => {
      const who = `${pname(acct.platform)} @${acct.username}`;
      try {
        const d = await platformDashboard(ctx.ownerId, acct.platform, { accountId: acct.id });
        if (d.status !== "ok") {
          r.complete = false;
          r.notes.push({ level: "warn", text: `${who}: ${d.status === "needs_reconnect" ? "needs reconnecting before its numbers can be read." : d.message || "numbers aren't available right now."}` });
        } else {
          out.push({ acct, d });
          for (const n of d.notes) if (n.level === "warning") r.notes.push({ level: "warn", text: `${who}: ${n.text}` });
        }
      } catch {
        r.complete = false;
        r.notes.push({ level: "warn", text: `${who}: couldn't be reached just now.` });
      }
    }),
  );
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const interactions = (p: LivePost) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
const rate = (p: LivePost) => {
  const base = p.views ?? p.reach ?? 0;
  return base > 0 ? interactions(p) / base : null;
};
const fmtInt = (n: number) => new Intl.NumberFormat("en-IN").format(Math.round(n));

export async function topPosts(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const sort = a.sort ?? (/trend|momentum|taking off|right now/i.test(ctx.message) ? "momentum" : /engag/i.test(ctx.message) ? "engagement" : "views");
  const title = sort === "momentum" ? "Your posts gaining fastest" : sort === "engagement" ? "Your most engaging posts" : "Your top posts";
  const r = base(
    "top_posts",
    title,
    range,
    [
      { key: "title", label: "Post" },
      { key: "where", label: "Account" },
      { key: "date", label: "Posted" },
      { key: "views", label: "Views", align: "end" },
      { key: "rate", label: "Engagement", align: "end" },
      { key: "why", label: "Why it stands out" },
    ],
    "No published posts with numbers yet in that period.",
    period,
  );
  const accts = await accountsInScope(ctx, a.platform);
  if (!accts.length) {
    r.empty = ctx.scope ? "None of the accounts you work on are connected." : "Connect an account first; then I can rank your posts.";
    return r;
  }
  const boards = await dashboards(ctx, accts, r);
  const pool: { p: LivePost; acct: Acct; perDay: number; rate: number | null; medViews: number; medRate: number }[] = [];
  let window = 0;
  for (const { acct, d } of boards) {
    window = Math.max(window, d.rangeDays);
    const views = d.posts.map((p) => p.views ?? 0);
    const rates = d.posts.map(rate).filter((x): x is number => x != null);
    const medViews = median(views);
    const medRate = median(rates);
    for (const p of d.posts) {
      const at = new Date(p.publishedAt);
      if (range && (at < range.from || at >= range.to)) continue;
      const age = Math.max(1, (ctx.now.getTime() - at.getTime()) / 864e5);
      pool.push({ p, acct, perDay: (p.views ?? 0) / age, rate: rate(p), medViews, medRate });
    }
  }
  const key = (x: (typeof pool)[number]) => (sort === "momentum" ? x.perDay : sort === "engagement" ? (x.rate ?? -1) : (x.p.views ?? -1));
  pool.sort((x, y) => key(y) - key(x));
  const limit = Math.min(Math.max(a.limit ?? 10, 1), 25);
  for (const x of pool.slice(0, limit)) {
    const why: string[] = [];
    if (x.medViews > 0 && (x.p.views ?? 0) >= x.medViews * 1.5) why.push(`${Math.round(((x.p.views ?? 0) / x.medViews) * 10) / 10}x your usual views`);
    if (x.rate != null && x.medRate > 0 && x.rate >= x.medRate * 1.3) why.push(`engagement ${pct(((x.rate - x.medRate) / x.medRate) * 100)} vs your usual`);
    if (sort === "momentum") why.push(`${fmtInt(x.perDay)} views a day`);
    if ((x.p.shares ?? 0) > 0 && (x.p.shares ?? 0) >= (x.p.likes ?? 0) * 0.1) why.push("shared a lot");
    r.rows.push({
      id: `${x.acct.id}:${x.p.id}`,
      cells: {
        title: short(x.p.title || "Untitled"),
        where: `${pname(x.acct.platform)} @${x.acct.username}`,
        date: day(x.p.publishedAt, ctx.tz),
        views: x.p.views == null ? "Not reported" : fmtInt(x.p.views),
        rate: x.rate == null ? "Not reported" : `${Math.round(x.rate * 1000) / 10}%`,
        why: why.join("; ") || "Steady, close to your usual",
      },
      links: x.p.url ? [{ label: "Open post", href: x.p.url }] : undefined,
    });
  }
  // found = posts considered; returned = the top ones shown. Short on purpose, so no "showing X of Y" warning.
  r.found = pool.length;
  r.returned = r.rows.length;
  if (r.rows[0]) r.facts.push(`Top post: "${r.rows[0].cells.title}" on ${r.rows[0].cells.where}, ${r.rows[0].cells.views} views, ${r.rows[0].cells.rate} engagement.`);
  if (boards.length) r.facts.unshift(`Ranked ${plural(pool.length, "post")} from ${plural(boards.length, "account")} by ${sort === "momentum" ? "views per day" : sort === "engagement" ? "engagement rate" : "views"}.`);
  if (window) r.notes.push({ level: "info", text: `Platforms report your recent posts (about the last ${window} days), so older posts aren't ranked.` });
  if (/trend/i.test(ctx.message)) r.notes.push({ level: "info", text: "Trending here means among your own posts. Outlly can't see what's trending across a whole platform." });
  return r;
}

export async function engagement(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "engagement",
    "Your engagement",
    null,
    [
      { key: "where", label: "Account" },
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", align: "end" },
      { key: "delta", label: "Change", align: "end" },
    ],
    "No numbers yet. Connect an account and post, then ask again.",
    period,
  );
  const accts = await accountsInScope(ctx, a.platform);
  const boards = await dashboards(ctx, accts, r);
  let window = 0;
  for (const { acct, d } of boards) {
    window = Math.max(window, d.rangeDays);
    const who = `${pname(acct.platform)} @${acct.username}`;
    for (const h of d.headline) {
      if (h.value == null) continue;
      const value = h.format === "pct" ? `${Math.round(h.value * 10) / 10}%` : h.format === "duration" ? `${Math.round(h.value)}s` : fmtInt(h.value);
      r.rows.push({ id: `${acct.id}:${h.key}`, cells: { where: who, metric: h.label, value, delta: h.delta == null ? "" : pct(h.delta) } });
      if (h.delta != null && Math.abs(h.delta) >= 1) r.facts.push(`${who} ${h.label.toLowerCase()}: ${value} (${pct(h.delta)} vs the previous ${d.rangeDays} days).`);
    }
  }
  r.found = r.returned = r.rows.length;
  if (window) {
    r.range = { label: `Last ${window} days (as the platforms report it)`, tz: ctx.tz };
    if (range) r.notes.push({ level: "info", text: `Platforms give these totals for the last ${window} days only, so that's the window shown, not ${range.label}.` });
  }
  if (boards.length) r.facts.unshift(`Engagement from ${plural(boards.length, "account")}.`);
  else if (accts.length) r.empty = "None of your accounts could be read just now. Ask again in a minute.";
  if (!accts.length) r.empty = ctx.scope ? "None of the accounts you work on are connected." : "Connect an account first; then I can read your engagement.";
  return r;
}

export async function uploads(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "uploads",
    "Your uploads",
    range,
    [
      { key: "name", label: "File" },
      { key: "type", label: "Type" },
      { key: "size", label: "Size", align: "end" },
      { key: "status", label: "Status" },
      { key: "date", label: "Uploaded" },
    ],
    range ? "No uploads in that period." : "No uploads yet.",
    period,
  );
  const status = a.status && ["uploading", "uploaded", "processing", "ready", "failed"].includes(a.status) ? a.status : null;
  const where = { userId: ctx.ownerId, createdAt: within(range), ...(status ? { status } : {}) };
  const [found, got] = await Promise.all([
    db.media.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.media.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...pageArgs(c, take),
        select: { id: true, originalFilename: true, mimeType: true, size: true, status: true, createdAt: true, storageKey: true },
      }),
    ),
  ]);
  let linkFails = 0;
  for (const [i, m] of got.rows.entries()) {
    let links;
    if (i < 50) {
      // Ten-minute signed links for the newest 50; more would be a slow answer for little use.
      const href = await storage.signedUrl(m.storageKey, 600).catch(() => null);
      if (href) links = [{ label: `Download ${m.originalFilename}`, href, download: true }];
      else linkFails++;
    }
    r.rows.push({
      id: m.id,
      cells: { name: short(m.originalFilename, 60), type: m.mimeType.split("/")[0] || m.mimeType, size: `${Math.round((m.size / 1048576) * 10) / 10} MB`, status: cap(m.status), date: day(m.createdAt, ctx.tz) },
      links,
    });
  }
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "uploads");
  if (got.rows.length > 50) r.notes.push({ level: "info", text: "Download links are on the newest 50 and work for 10 minutes." });
  else if (got.rows.length) r.notes.push({ level: "info", text: "Download links work for 10 minutes." });
  if (linkFails) r.notes.push({ level: "warn", text: `${plural(linkFails, "file")} couldn't get a download link (the file may have been removed).` });
  const mb = got.rows.reduce((s, m) => s + m.size, 0) / 1048576;
  if (got.rows.length) r.facts.push(`Together ${Math.round(mb * 10) / 10} MB.`);
  return r;
}

export async function tickets(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "tickets",
    "Your support requests",
    range,
    [
      { key: "ref", label: "Ref", mono: true },
      { key: "subject", label: "Subject" },
      { key: "status", label: "Status" },
      { key: "date", label: "Opened" },
    ],
    "You haven't opened any support requests.",
    period,
  );
  const status = a.status && ["open", "pending", "resolved"].includes(a.status) ? a.status : null;
  // Tickets belong to the person who raised them, so a teammate sees their own, not the owner's.
  const where = { userId: ctx.actorId ?? ctx.ownerId, createdAt: within(range), ...(status ? { status } : {}) };
  const [found, got] = await Promise.all([
    db.ticket.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.ticket.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pageArgs(c, take), select: { id: true, ref: true, subject: true, status: true, createdAt: true } }),
    ),
  ]);
  for (const t of got.rows)
    r.rows.push({ id: t.id, cells: { ref: t.ref, subject: short(t.subject), status: t.status === "pending" ? "Waiting on you" : cap(t.status), date: day(t.createdAt, ctx.tz) } });
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, "support requests");
  const open = got.rows.filter((t) => t.status !== "resolved").length;
  if (got.rows.length) r.facts.push(`${open} still open.`);
  return r;
}

export async function notices(ctx: PipCtx, a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base(
    "notices",
    "Your notifications",
    range,
    [
      { key: "title", label: "Notification" },
      { key: "date", label: "Date" },
      { key: "read", label: "Read" },
    ],
    range ? "No notifications in that period." : "No notifications.",
    period,
  );
  const unread = a.status === "unread" || /unread|new /i.test(ctx.message);
  const where = { userId: ctx.ownerId, createdAt: within(range), ...(unread ? { readAt: null } : {}) };
  const [found, got] = await Promise.all([
    db.notice.count({ where }).catch(() => -1),
    fetchAll((c, take) =>
      db.notice.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pageArgs(c, take), select: { id: true, title: true, href: true, action: true, readAt: true, createdAt: true } }),
    ),
  ]);
  for (const n of got.rows)
    r.rows.push({
      id: n.id,
      cells: { title: short(n.title, 80), date: day(n.createdAt, ctx.tz), read: n.readAt ? "Yes" : "No" },
      links: n.href && n.href.startsWith("/") ? [{ label: n.action || "Open", href: n.href }] : undefined,
    });
  settle(r, found < 0 ? got.rows.length : found, got.failed || found < 0, unread ? "unread notifications" : "notifications");
  return r;
}

export async function activity(ctx: PipCtx, _a: PipArgs, range: DateRange | null, period: string | null): Promise<PipResult> {
  const r = base("activity", "Your activity", range, [{ key: "what", label: "What" }, { key: "count", label: "Count", align: "end" }], "Nothing happened in that period.", period);
  const w = within(range);
  const scoped = ctx.scope ? { socialAccountId: { in: ctx.scope } } : {};
  // Activity days are stored as UTC dates (lib/activity.ts); name the person's local days in that key space.
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ctx.tz }).format(d);
  const tasks: [string, Promise<number>][] = [
    ["Posts created", db.post.count({ where: { userId: ctx.ownerId, createdAt: w, ...(ctx.scope ? { targets: { some: scoped } } : {}) } })],
    ["Went live on a platform", db.postTarget.count({ where: { post: { userId: ctx.ownerId }, practice: false, platformStatus: "published", publishedAt: w, ...scoped } })],
    ["Failed to publish", db.postTarget.count({ where: { post: { userId: ctx.ownerId }, practice: false, platformStatus: "failed", updatedAt: w, ...scoped } })],
    ["Files uploaded", db.media.count({ where: { userId: ctx.ownerId, createdAt: w } })],
    ["Support requests", db.ticket.count({ where: { userId: ctx.actorId ?? ctx.ownerId, createdAt: w } })],
    ["Notifications", db.notice.count({ where: { userId: ctx.ownerId, createdAt: w } })],
    ["Days active", db.userActivityDay.count({ where: { userId: ctx.actorId ?? ctx.ownerId, ...(range ? { day: { gte: dayKey(range.from), lte: dayKey(new Date(range.to.getTime() - 1)) } } : {}) } })],
  ];
  if (!ctx.actorId) tasks.push(["Payments", db.payment.count({ where: { userId: ctx.ownerId, createdAt: w, status: { in: ["succeeded", "refunded"] } } })]);
  const results = await Promise.allSettled(tasks.map(([, p]) => p));
  let failed = 0;
  results.forEach((res, i) => {
    const what = tasks[i][0];
    if (res.status === "rejected") {
      failed++;
      r.rows.push({ id: what, cells: { what, count: "Couldn't read" } });
      return;
    }
    r.rows.push({ id: what, cells: { what, count: res.value } });
    if (res.value) r.facts.push(`${what}: ${res.value}.`);
  });
  if (failed) r.facts.push(`${plural(failed, "count")} couldn't be read just now.`);
  if (!r.facts.length) r.rows = [];
  r.found = r.returned = r.rows.length;
  r.complete = failed === 0;
  if (failed) r.notes.push({ level: "warn", text: `${plural(failed, "count")} couldn't be read just now.` });
  return r;
}
