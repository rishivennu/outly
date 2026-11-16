/** 1165: every Overview card names what it is compared with, the live globe says when it is stale, and non-super roles never get a full address from it. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";
import { overview } from "../lib/admin/metrics";
import { liveMap } from "../lib/admin/live-map";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const DAY = 86_400_000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

describe("1165 Overview comparisons come from the same rows as the headline numbers", () => {
  test("yesterday's active count, MRR 30 days ago, failed payments the week before, churn the month before", async () => {
    const now = new Date();
    const tag = uniq();
    const u1 = await db.user.create({ data: { name: "Ov One", email: `ov1-${tag}@test.dev`, passwordHash: "x" } });
    const u2 = await db.user.create({ data: { name: "Ov Two", email: `ov2-${tag}@test.dev`, passwordHash: "x" } });
    await db.userActivityDay.createMany({ data: [{ userId: u1.id, day: dayKey(new Date(now.getTime() - DAY)) }, { userId: u2.id, day: dayKey(new Date(now.getTime() - DAY)) }, { userId: u1.id, day: dayKey(now) }] });
    const plan = await db.plan.create({ data: { slug: `t1165-${tag}`, name: "T1165", priceMinor: 1000, state: "hidden" } });
    // live for 45 days, still active: in both MRR figures and both churn bases
    await db.subscription.create({ data: { userId: u1.id, planId: plan.id, status: "active", priceMinor: 1000, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(now.getTime() + 20 * DAY), createdAt: new Date(now.getTime() - 45 * DAY) } });
    // started 50 days ago, cancelled 40 days ago: only in the earlier churn window
    await db.subscription.create({ data: { userId: u2.id, planId: plan.id, status: "canceled", priceMinor: 1000, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(now.getTime() - 40 * DAY), createdAt: new Date(now.getTime() - 50 * DAY), canceledAt: new Date(now.getTime() - 40 * DAY) } });
    await db.payment.create({ data: { userId: u1.id, planId: plan.id, amountMinor: 1000, currency: "INR", status: "failed", provider: "mock", createdAt: new Date(now.getTime() - 10 * DAY) } });

    const o = await overview(97 + Math.floor(Math.random() * 1000)); // a fresh cache key
    const k = o.kpi;
    expect(k.dauPrev).toBeGreaterThanOrEqual(2);
    expect(k.dau).toBeGreaterThanOrEqual(1);
    expect(k.mrrPrev).toBeGreaterThanOrEqual(1000);
    expect(k.failedPrev7).toBeGreaterThanOrEqual(1);
    expect(k.activeSubsPrev).toBeGreaterThanOrEqual(1);
    expect(k.churnPrev).not.toBeNull();
    expect(k.churnPrev as number).toBeGreaterThan(0);
    expect(typeof o.at).toBe("string");
    expect(Number.isNaN(Date.parse(o.at))).toBe(false);

    await db.payment.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
    await db.subscription.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
    await db.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
    await db.plan.delete({ where: { id: plan.id } });
  });

  test("every card that has history names its comparison period; cards without one say so", () => {
    const p = src("app/admin/(panel)/page.tsx");
    expect(p).toContain('change={delta(k.dau, k.dauPrev)} compare="all of yesterday"');
    expect(p).toContain('change={delta(k.mrr, k.mrrPrev)} compare="30 days ago"');
    expect(p).toContain('change={delta(k.failed7, k.failedPrev7)} compare="the 7 days before"');
    expect(p).toContain('change={delta(k.activeSubs, k.activeSubsPrev)} compare="30 days ago"');
    expect(p).toContain('compareNote={k.churnPrev === null ? "No subscriptions were live in the 30 days before" : "Nothing was cancelled in the 30 days before"}');
    expect(p).toContain("so there is no earlier period to compare with");
    expect(p).toContain("Last updated ${new Date(o.at)");
    expect(p).toContain("The live view could not be loaded just now.");
    const k = src("components/admin/motion/AdminKpi.tsx");
    expect(k).toContain("{compareNote ?? `Nothing in ${compare} to compare with`}");
  });
});

describe("1165 live globe", () => {
  test("non-super roles get masked addresses from the server, super gets the full one", async () => {
    const tag = uniq();
    const u = await db.user.create({ data: { name: "Live Probe", email: `live-${tag}@test.dev`, passwordHash: "x", lastSeenAt: new Date(), locCountry: "IN", locCity: "Hyderabad" } });
    const sup = await liveMap(5, Date.now(), "super");
    const supp = await liveMap(5, Date.now(), "support");
    const find = (m: Awaited<ReturnType<typeof liveMap>>) => m.places.flatMap((p) => p.people).find((p) => p.id === u.id);
    expect(find(sup)?.email).toBe(`live-${tag}@test.dev`);
    expect(find(supp)?.email).toContain("****@test.dev");
    expect(find(supp)?.email).not.toBe(`live-${tag}@test.dev`);
    await db.user.delete({ where: { id: u.id } });
  });

  test("the route passes the caller's role, the card says when its figures are stale, and the range buttons are 44px", () => {
    expect(src("app/api/admin/live/route.ts")).toContain("admin.role");
    const c = src("components/admin/live/LiveGlobeCard.tsx");
    expect(c).toContain("Showing figures from {hhmmss(updated)}, not live.");
    expect(c).toContain("active means seen in the last {data.timeoutMin} min");
    expect(c).toContain('u.email.includes("****") ? u.name : u.email');
    expect(src("components/admin/OverviewCharts.tsx")).toContain('"relative z-[1] h-11 min-w-[64px]');
  });
});
