/** 1166: the database loaders behind User behavior and Analytics read the rows the pure rules expect. */
import { describe, expect, test } from "bun:test";
import { db } from "../lib/db";
import { behavior } from "../lib/admin/behavior";
import { outllyAnalytics } from "../lib/admin/analytics";
import { parseWindow } from "../lib/admin/analytics-core";

const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function post(userId: string, platform: string, practice: boolean, n: number) {
  const media = await db.media.create({ data: { userId, originalFilename: "a.mp4", storageKey: `t1166/${tag}-${n}.mp4`, mimeType: "video/mp4", size: 1000, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId, platform, platformUserId: `t1166-${tag}-${n}`, username: "@t", accessToken: "x", status: "connected" } });
  const at = new Date(Date.now() - 3_600_000);
  const p = await db.post.create({ data: { userId, mediaId: media.id, status: "published", publishedAt: at } });
  await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: acct.id, platformStatus: "published", publishedAt: at, practice } });
  return p;
}

describe("1166 loaders", () => {
  test("practice-only publishers are not counted as published; the waitlist is loaded separately", async () => {
    const real = await db.user.create({ data: { name: "Real Pub", email: `real-${tag}@t.dev`, passwordHash: "x" } });
    const prac = await db.user.create({ data: { name: "Practice Pub", email: `prac-${tag}@t.dev`, passwordHash: "x" } });
    await post(real.id, "youtube", false, 1);
    await post(prac.id, "youtube", true, 2);
    await db.waitlistEntry.create({ data: { email: `real-${tag}@t.dev` } });
    await db.waitlistEntry.create({ data: { email: `only-${tag}@t.dev` } });

    const b = await behavior(7);
    const pub = b.activation.range.steps.find((s) => s.key === "publish")!;
    const ids = pub.reached.map((p) => p.id);
    expect(ids).toContain(real.id);
    expect(ids).not.toContain(prac.id);
    expect(b.activation.waitlist.joined).toBeGreaterThanOrEqual(2);
    expect(b.activation.waitlist.inCohort).toBeGreaterThanOrEqual(1);

    const a = await outllyAnalytics(parseWindow({ d: "7" }));
    expect(a.totals.signups).toBeGreaterThanOrEqual(2);
    expect(a.totals.postsPublished).toBeGreaterThanOrEqual(1);
    expect(a.platforms.reduce((t, p) => t + p.count, 0)).toBe(a.totals.publishes);
    expect(a.sources.reduce((t, s) => t + s.signups, 0)).toBe(a.totals.signups);
    expect(typeof a.generatedAt).toBe("string");

    await db.waitlistEntry.deleteMany({ where: { email: { contains: tag } } });
    await db.user.deleteMany({ where: { id: { in: [real.id, prac.id] } } });
  });
});
