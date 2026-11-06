/**
 * Round 1142: responsive admin tables, compact profile edit icons, the waitlist overview / member list, and the
 * one-time waitlist update campaign (cutoff, dedupe, launch-once, retry rules, webhook signatures).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "../lib/campaigns-core";
import { profileSetUp } from "../lib/profile-card-core";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

let db: typeof import("../lib/db").db;
let site: typeof import("../lib/site");
let settings: typeof import("../lib/settings");
let camp: typeof import("../lib/campaigns");
let email: typeof import("../lib/email");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  site = await import("../lib/site");
  settings = await import("../lib/settings");
  camp = await import("../lib/campaigns");
  email = await import("../lib/email");
}, 60_000);

describe("admin Table on phones", () => {
  test("rows become labelled cards; checkbox, action and lead columns are typed", async () => {
    const { Table } = await import("../components/admin/ui");
    const html = renderToStaticMarkup(
      createElement(Table, {
        label: "People",
        head: [createElement("input", { key: "c", type: "checkbox", "aria-label": "Select all" }), "Email", "Joined", createElement("span", { key: "a", className: "sr-only" }, "Action")],
        lead: 1,
        children: createElement("tr", null, createElement("td", null, "x"), createElement("td", null, "a@b.co"), createElement("td", null, "today"), createElement("td", null, "Invite")),
      }),
    );
    expect(html).toContain('role="region"');
    expect(html).toContain("atable--cards");
    expect(html).toContain('data-cell="select"');
    expect(html).toContain('data-cell="lead"');
    expect(html).toContain('data-label="Joined"');
    expect(html).toContain('data-cell="action"');
    expect(html).toContain("min-width:640px");
  });

  test("scroll mode pins the first column and keeps the table inside its own scroller", async () => {
    const { Table } = await import("../components/admin/ui");
    const html = renderToStaticMarkup(createElement(Table, { head: ["A", "B"], mobile: "scroll", minWidth: 520, children: createElement("tr", null, createElement("td", null, "1"), createElement("td", null, "2")) }));
    expect(html).toContain("atable--scroll pin-first");
    expect(html).toContain("min-width:520px");
    const css = read("app/globals.css");
    expect(css.indexOf("1142: responsive data tables")).toBeLessThan(css.indexOf("1100: Liquid glass on every studio card"));
    expect(css).toMatch(/\.atable--cards[^{]*\{/);
  });
});

describe("profile card edit controls", () => {
  test("a card with any detail filled in counts as set up (compact icons)", () => {
    expect(profileSetUp({ bio: "", handle: "", niche: "", banner: null } as never)).toBe(false);
    expect(profileSetUp({ bio: "I film food", handle: "", niche: "", banner: null } as never)).toBe(true);
    expect(profileSetUp({ bio: "", handle: "", niche: "", banner: "https://x/b.jpg" } as never)).toBe(true);
  });
  test("the icons have accessible names and tooltips, and the full buttons are kept for new cards", () => {
    const src = read("components/profile/CreatorProfileCard.tsx");
    expect(src).toContain('aria-label="Edit profile details"');
    expect(src).toContain('aria-label="Change cover image"');
    expect(src).toContain('data-tip="Edit details"');
    expect(src).toMatch(/compact \?/);
  });
});

describe("admin bell panel", () => {
  test("portalled, fixed under the bell, closes on Escape and outside press, no drag", () => {
    const src = read("components/admin/Bell.tsx");
    expect(src).toContain("createPortal");
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain("pointerdown");
    expect(src).not.toMatch(/\bdrag\b/);
  });
});

describe("waitlist numbers and list", () => {
  test("IST periods: today, Monday, the 1st", () => {
    const b = site.istBounds(new Date("2026-11-06T20:00:00Z")); // Sat 7 Nov, 01:30 IST
    expect(b.day.toISOString()).toBe("2026-11-06T18:30:00.000Z");
    expect(b.week.toISOString()).toBe("2026-11-01T18:30:00.000Z"); // Mon 2 Nov IST
    expect(b.month.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });

  test("counts come from the rows and don't change when the switch flips", async () => {
    await site.joinWaitlist(`cnt-${tag()}@test.dev`, "Count", "landing");
    await settings.saveConfig("site", { waitlist: true });
    const on = await site.waitlistCounts();
    await settings.saveConfig("site", { waitlist: false });
    const off = await site.waitlistCounts();
    expect(on.total).toBe(await db.waitlistEntry.count());
    expect(off.total).toBe(on.total);
    expect(on.waiting + on.invited).toBe(on.total);
    expect(on.today).toBeGreaterThanOrEqual(1);
    expect(on.week).toBeGreaterThanOrEqual(on.today);
    expect(on.latestAt).not.toBeNull();
  });

  test("a new join shows up in the count straight away; joining twice doesn't", async () => {
    const before = (await site.waitlistCounts()).total;
    const e = `new-${tag()}@test.dev`;
    await site.joinWaitlist(e);
    await site.joinWaitlist(e.toUpperCase());
    expect((await site.waitlistCounts()).total).toBe(before + 1);
  });

  test("search, status, sort, date range and paging", async () => {
    const t = tag();
    await site.joinWaitlist(`zeta-${t}@test.dev`, "Zeta Person");
    await new Promise((r) => setTimeout(r, 5));
    await site.joinWaitlist(`alpha-${t}@test.dev`, "Alpha Person");
    const hit = await site.waitlistList({ q: t });
    expect(hit.total).toBe(2);
    expect(hit.rows[0].email).toBe(`alpha-${t}@test.dev`); // newest first
    expect((await site.waitlistList({ q: t, sort: "old" })).rows[0].email).toBe(`zeta-${t}@test.dev`);
    expect((await site.waitlistList({ q: "zeta person" })).total).toBeGreaterThanOrEqual(1);
    expect((await site.waitlistList({ q: t, status: "invited" })).total).toBe(0);
    expect((await site.waitlistList({ q: t, from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    expect((await site.waitlistList({ q: t, from: today, to: today })).total).toBe(2);
    const p = await site.waitlistList({ per: 5, page: 999 });
    expect(p.page).toBe(p.pages);
  });

  test("CSV: every matching row, header first, formulas defused", async () => {
    expect(site.csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(site.csvCell('say "hi"')).toBe(`"say ""hi"""`);
    const t = tag();
    await site.joinWaitlist(`csv-${t}@test.dev`, "+Plus Name", "ig");
    const { csv, count } = await site.waitlistCsv({ q: `csv-${t}` });
    expect(count).toBe(1);
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toBe("email,name,source,joined_utc,joined_ist,status,invited_utc");
    expect(lines[1]).toContain(`"csv-${t}@test.dev","'+Plus Name","ig"`);
  });

  test("the admin page reads the list whatever the switch says, and the export route exists", () => {
    const page = read("app/admin/(panel)/waitlist/page.tsx");
    expect(page).toContain("waitlistList(");
    expect(page).not.toMatch(/c\.waitlist\s*&&\s*\(?\s*<Table/);
    expect(read("app/api/admin/waitlist/export/route.ts")).toContain('adminRoute("site"');
  });
});

describe("campaign rules (pure)", () => {
  test("eligible: before the cutoff only, valid, one per address (oldest kept)", () => {
    const cut = new Date("2026-11-06T10:00:00Z");
    const at = (m: number) => new Date(cut.getTime() + m * 60_000);
    const r = core.eligible(
      [
        { id: "1", email: "A@x.com", createdAt: at(-30) },
        { id: "2", email: " a@x.com ", createdAt: at(-10) },
        { id: "3", email: "bad@@x", createdAt: at(-5) },
        { id: "4", email: "late@x.com", createdAt: at(0) },
        { id: "5", email: "b@x.co.in", createdAt: at(-1) },
      ],
      cut,
    );
    expect(r.list).toEqual([{ email: "a@x.com", waitlistId: "1" }, { email: "b@x.co.in", waitlistId: "5" }]);
    expect([r.invalid, r.dupes, r.late]).toEqual([1, 1, 1]);
  });

  test("outcome: accepted keeps the provider id; 429/5xx/timeouts retry with backoff; a hard no is final", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    expect(core.outcome({ status: "sent", providerId: "re_1" }, 1, now)).toMatchObject({ status: "accepted", providerId: "re_1" });
    const r429 = core.outcome({ status: "failed", code: 429, error: "rate" }, 1, now);
    expect(r429.status).toBe("pending");
    expect(r429.nextAt!.getTime() - now.getTime()).toBe(core.BACKOFF_MS[0]);
    expect(core.outcome({ status: "failed", error: "timeout" }, 2, now).status).toBe("pending");
    expect(core.outcome({ status: "failed", code: 503 }, core.MAX_ATTEMPTS, now).status).toBe("failed");
    expect(core.outcome({ status: "failed", code: 422, error: "invalid to" }, 1, now)).toMatchObject({ status: "failed", error: "invalid to" });
    expect(core.outcome({ status: "skipped", error: "Unsubscribed" }, 1, now).status).toBe("skipped");
  });

  test("webhook events never turn a bounce back into delivered", () => {
    expect(core.applyEvent("accepted", "email.delivered")).toBe("delivered");
    expect(core.applyEvent("bounced", "email.delivered")).toBeNull();
    expect(core.applyEvent("delivered", "email.bounced")).toBe("bounced");
    expect(core.applyEvent("delivered", "email.failed")).toBeNull();
    expect(core.applyEvent("accepted", "email.opened")).toBeNull();
  });

  test("Svix signatures: right secret passes; tampered body, wrong secret and stale timestamp fail", () => {
    const key = Buffer.from("outlly-test-webhook-key-0123456789");
    const secret = `whsec_${key.toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } });
    const sig = createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64");
    const h = { id: "msg_1", timestamp: ts, signature: `v1,bogus v1,${sig}` };
    expect(core.verifySvix(secret, h, body)).toBe(true);
    expect(core.verifySvix(secret, h, body + " ")).toBe(false);
    expect(core.verifySvix(`whsec_${Buffer.from("other").toString("base64")}`, h, body)).toBe(false);
    expect(core.verifySvix(secret, h, body, Date.now() + 10 * 60_000)).toBe(false);
    expect(core.verifySvix("", h, body)).toBe(false);
  });
});

describe("waitlist update campaign (DB)", () => {
  test("subject and copy are the brief's, it's a marketing kind with unsubscribe", async () => {
    expect(core.WAITLIST_UPDATE.id).toBe("outlly_waitlist_update_announcement_2026");
    expect(core.WAITLIST_UPDATE.subject).toBe("You're on the Outlly waitlist! Here's a quick update 🚀");
    const html = email.templates.waitlistUpdate();
    for (const s of ["Hey there!", "thank you for joining the Outlly waitlist!", "Your waitlist registration is safe, and you&#39;re still on the list.", "Stay tuned. Something exciting is coming!", "Your content deserves to be everywhere.", "Team Outlly", "https://outlly.com"]) expect(html).toContain(s);
    const { listFor } = await import("../lib/email/unsubscribe");
    expect(listFor("announcement")).toBe("news");
  });

  test(
    "old members get it once; later joiners, invalid and opted-out addresses don't; it can't be launched twice",
    async () => {
      await settings.saveConfig("email", { provider: "mock" });
      const t = tag();
      const old1 = `old1-${t}@test.dev`;
      const old2 = `old2-${t}@test.dev`;
      const optedOut = `opt-${t}@test.dev`;
      await site.joinWaitlist(old1, "Old One");
      await site.joinWaitlist(old2);
      await site.joinWaitlist(optedOut);
      await db.emailOptOut.create({ data: { email: optedOut, list: "news" } });
      await db.waitlistEntry.create({ data: { email: `not an email ${t}`, createdAt: new Date(Date.now() - 60_000) } });
      await new Promise((r) => setTimeout(r, 10));

      const c = await camp.ensureCampaign();
      const again = await camp.ensureCampaign(new Date(Date.now() + 86_400_000));
      expect(again.cutoff.getTime()).toBe(c.cutoff.getTime()); // never moves
      await new Promise((r) => setTimeout(r, 10));
      const late = `late-${t}@test.dev`;
      await site.joinWaitlist(late);

      const pre = await camp.campaignStatus();
      expect(pre.launchedAt).toBeNull();
      expect(pre.excluded.joinedAfter).toBeGreaterThanOrEqual(1);
      expect(pre.excluded.invalid).toBeGreaterThanOrEqual(1);
      expect(pre.canSend).toBe(true); // mock is allowed outside production

      await expect(camp.launchCampaign("Tester", pre.eligible + 1)).rejects.toThrow(/list changed/);
      expect(await camp.launchCampaign("Tester", pre.eligible)).toBe(pre.eligible);
      await expect(camp.launchCampaign("Tester", pre.eligible)).rejects.toThrow(/already launched/);

      for (let i = 0; i < 20; i++) {
        const r = await camp.processCampaign({ budgetMs: 30_000, max: 500 });
        if (!r.left) break;
      }
      const rows = await db.emailCampaignRecipient.findMany({ where: { campaignId: core.WAITLIST_UPDATE.id } });
      const by = new Map(rows.map((r) => [r.email, r]));
      expect(rows.length).toBe(pre.eligible);
      expect(new Set(rows.map((r) => r.email)).size).toBe(rows.length);
      expect(by.get(old1)?.status).toBe("mocked");
      expect(by.get(old2)?.status).toBe("mocked");
      expect(by.get(optedOut)?.status).toBe("skipped");
      expect(by.has(late)).toBe(false);
      expect(await db.emailLog.count({ where: { to: old1, kind: "announcement" } })).toBe(1);
      expect(await db.emailLog.count({ where: { to: late, kind: "announcement" } })).toBe(0);

      // Refresh / redeploy / another sweep: nothing more goes out.
      const logs = await db.emailLog.count({ where: { kind: "announcement" } });
      expect((await camp.processCampaign()).sent).toBe(0);
      await camp.sweepCampaigns();
      expect(await db.emailLog.count({ where: { kind: "announcement" } })).toBe(logs);
      const done = await camp.campaignStatus();
      expect(done.doneAt).not.toBeNull();
      expect(done.counts.pending).toBe(0);

      // Someone who joins now is never added, even if a snapshot refill runs.
      const later = `later-${t}@test.dev`;
      await site.joinWaitlist(later);
      await camp.processCampaign();
      expect(await db.emailCampaignRecipient.count({ where: { email: later } })).toBe(0);

      // Delivery events tie back to the row by Resend's id.
      await db.emailCampaignRecipient.update({ where: { id: by.get(old1)!.id }, data: { status: "accepted", providerId: `re_${t}` } });
      expect(await camp.recordProviderEvent("email.delivered", `re_${t}`)).toBe(true);
      expect((await db.emailCampaignRecipient.findUniqueOrThrow({ where: { id: by.get(old1)!.id } })).status).toBe("delivered");
      expect(await camp.recordProviderEvent("email.delivered", "re_unknown")).toBe(false);
      await camp.recordProviderEvent("email.complained", `re_${t}`);
      expect(await db.emailOptOut.count({ where: { email: old1, list: "news" } })).toBe(1);
    },
    120_000,
  );

  test("the cron sweep calls the campaign hook, guarded", () => {
    expect(read("app/api/cron/sweep/route.ts")).toMatch(/import\("@\/lib\/campaigns"\)\.then\(\(m\) => m\.sweepCampaigns\(\)\)\.catch/);
  });
});
