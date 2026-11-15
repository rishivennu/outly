/** P4 item 7: the sending and booked screens only claim what the server confirmed. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { platformReason } from "../lib/client/failed-posts";
import { calendarHref, sendOutcome } from "../lib/client/post-words";

const src = (p: string) => readFileSync(p, "utf8");
const pv = src("components/create/PublishingView.tsx");

describe("platformReason", () => {
  test("keeps the platform's sentence out of a JSON reply", () => {
    expect(platformReason('HTTP 400: {"error":{"message":"The video is too long for a Reel.","code":100}}')).toBe("The video is too long for a Reel.");
    expect(platformReason('{"errors":[{"detail":"You are not allowed to create a Tweet with duplicate content."}]}')).toBe("You are not allowed to create a Tweet with duplicate content.");
  });
  test("plain text passes through, first line only, trimmed", () => {
    expect(platformReason("  Upload quota exceeded for today.\nstack here")).toBe("Upload quota exceeded for today.");
    expect(platformReason("400 - Bad media type")).toBe("Bad media type");
  });
  test("nothing usable gives null", () => {
    for (const d of [null, undefined, "", "   ", "{}", "500", "<html><body>oops</body></html>", "TypeError: x at run (C:/a/b.ts:10:5)"]) expect(platformReason(d)).toBeNull();
  });
  test("long reasons are cut to fit a card", () => {
    const r = platformReason("a".repeat(400), 160)!;
    expect(r.length).toBe(160);
    expect(r.endsWith("…")).toBe(true);
  });
});

describe("sendOutcome", () => {
  test("live only when every destination is published for real", () => {
    expect(sendOutcome([{ status: "published" }, { status: "published" }], false)).toMatchObject({ allDone: true, allLive: true, allPractice: false, real: 2 });
    expect(sendOutcome([{ status: "published" }, { status: "failed" }], false)).toMatchObject({ allDone: false, allLive: false });
    expect(sendOutcome([{ status: "published" }, { status: "uploading" }], true).allLive).toBe(false);
  });
  test("no destinations is never live", () => {
    expect(sendOutcome([], false)).toMatchObject({ allDone: false, allLive: false, allPractice: false });
  });
  test("a practice account is a rehearsal, never live", () => {
    expect(sendOutcome([{ status: "published", practice: true }], false)).toMatchObject({ allDone: true, allLive: false, allPractice: true, real: 0, rehearsed: 1 });
    expect(sendOutcome([{ status: "published", practice: true }, { status: "published" }], false)).toMatchObject({ allDone: true, allLive: false, allPractice: false, real: 1 });
  });
});

describe("calendarHref", () => {
  test("opens the day in the creator's time zone with the post open", () => {
    // 20:30 UTC on 15 Nov is 16 Nov in Kolkata
    expect(calendarHref("p1", "2026-11-15T20:30:00.000Z", "Asia/Kolkata")).toBe("/calendar?post=p1&day=2026-11-16");
    expect(calendarHref("p1", "2026-11-15T20:30:00.000Z", "America/New_York")).toBe("/calendar?post=p1&day=2026-11-15");
  });
  test("no time still opens the post", () => {
    expect(calendarHref("p 2", null, "UTC")).toBe("/calendar?post=p+2");
    expect(calendarHref("p3", "not a date", "UTC")).toBe("/calendar?post=p3");
  });
});

describe("the screens use it", () => {
  test("headline and cards read the confirmed outcome; practice is labelled", () => {
    expect(pv).toContain("const out = sendOutcome(post.targets, active);");
    expect(pv).toContain('out.allPractice ? "Practice run done."');
    expect(pv).toContain('"Not posted for real"');
    expect(pv).toContain('t.practice ? "Practice run, not posted" : "Live"');
  });
  test("live shows a visible See it link to the real post, or says there is no link", () => {
    expect(pv).toContain("See it on {meta.name}");
    expect(pv).toMatch(/\{live &&\r?\n\s+\(t\.url \? \(/);
    expect(pv).toContain("didn&apos;t send us a link to it");
  });
  test("failed shows the platform's reason next to our words", () => {
    expect(pv).toContain("platformReason(t.errorDetail)");
    expect(pv).toContain("Reason: {reason}");
  });
  test("a send this page can no longer watch says so", () => {
    expect(pv).toContain("{pollDead && active && (");
  });
  test("booked screen: only on a confirmed scheduled post, with time zone, exact calendar entry and a way back", () => {
    const lp = src("components/create/LaunchPanel.tsx");
    expect(lp).toContain('const at = post ? (post.status === "scheduled" ? post.scheduledAt : null) : when;');
    expect(lp).toContain("We couldn&apos;t confirm the booking.");
    expect(lp).toContain("calendarHref(post.id, at, tz)");
    expect(lp).toContain("Open in Calendar");
    expect(lp).toContain("{fmt(at, tz, { hour: \"numeric\", minute: \"2-digit\" })} {zone}");
    expect(lp.split("onClick={onAnother}").length - 1).toBe(2);
  });
  test("no dashes in the copy", () => {
    for (const f of ["components/create/PublishingView.tsx", "lib/client/post-words.ts", "lib/client/failed-posts.ts", "lib/support/faq.ts", "components/support/HelpCenter.tsx", "app/(marketing)/help/page.tsx", "components/create/LaunchPanel.tsx"]) expect(src(f), f).not.toMatch(/[\u2013\u2014]/);
  });
});
