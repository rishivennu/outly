/**
 * 1139: the publishing tracker. The user's rule for this round is that nothing about progress may be invented,
 * so these tests pin the honest parts: the seven states come from the real status and error code, progress is
 * the step a destination has reached, and a percentage only ever appears when a real figure was measured.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTENTION_CODES,
  LIVE_LABEL,
  LIVE_STEPS,
  liveLabel,
  liveState,
  liveStep,
  realPercent,
  sinceLabel,
  stepText,
  stoppedByYou,
  updatedLabel,
} from "../lib/client/sending";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");

describe("the seven states come from the real row", () => {
  test("every status maps to a state a person recognises", () => {
    expect(liveState({ status: "pending" })).toBe("queued");
    expect(liveState({ status: "queued" })).toBe("queued");
    expect(liveState({ status: "uploading" })).toBe("uploading");
    expect(liveState({ status: "processing" })).toBe("publishing");
    expect(liveState({ status: "published" })).toBe("published");
    expect(liveState({ status: "failed", errorCode: "PLATFORM_DOWN" })).toBe("failed");
    expect(liveState({ status: "pending" }, "scheduled")).toBe("scheduled");
    expect(Object.keys(LIVE_LABEL)).toEqual(["scheduled", "queued", "uploading", "publishing", "published", "failed", "attention"]);
  });
  test("codes only the creator can clear read as Requires attention", () => {
    for (const code of ATTENTION_CODES) expect(liveState({ status: "failed", errorCode: code })).toBe("attention");
    expect(liveLabel({ status: "failed", errorCode: "AUTH_EXPIRED" })).toBe("Requires attention");
    expect(liveLabel({ status: "failed", errorCode: "NETWORK" })).toBe("Failed");
  });
  test("a post the creator stopped says so, and is never called broken", () => {
    const t = { status: "failed", errorCode: "CANCELED" };
    expect(stoppedByYou(t)).toBe(true);
    expect(liveState(t)).toBe("failed");
    expect(liveLabel(t)).toBe("Stopped by you");
  });
  test("a queued destination of a scheduled post is only Scheduled while it waits", () => {
    expect(liveState({ status: "queued" }, "scheduled")).toBe("queued");
    expect(liveState({ status: "pending" }, "publishing")).toBe("queued");
  });
});

describe("step progress, never a synthesised percentage", () => {
  test("the four steps are the real ones and the bar is what is finished", () => {
    expect(LIVE_STEPS).toEqual(["Queued", "Uploading", "Publishing", "Published"]);
    expect(liveStep({ status: "queued" })).toMatchObject({ index: 0, stepNumber: 1, current: "Queued", fraction: 0, done: false });
    expect(liveStep({ status: "uploading" })).toMatchObject({ index: 1, stepNumber: 2, current: "Uploading", fraction: 0.25 });
    expect(liveStep({ status: "processing" })).toMatchObject({ index: 2, stepNumber: 3, current: "Publishing", fraction: 0.5 });
    expect(liveStep({ status: "published" })).toMatchObject({ index: 4, stepNumber: 4, current: "Published", fraction: 1, done: true });
  });
  test("a stopped destination claims no progress at all", () => {
    const bad = liveStep({ status: "failed", errorCode: "NETWORK" });
    expect(bad).toMatchObject({ stalled: true, fraction: 0, current: "Stopped" });
    expect(liveStep({ status: "failed", errorCode: "CANCELED" }).current).toBe("Stopped by you");
  });
  test("the words name the step, with no numbers nobody measured", () => {
    expect(stepText(liveStep({ status: "uploading" }))).toBe("Step 2 of 4, Uploading");
    expect(stepText(liveStep({ status: "published" }))).toBe("Step 4 of 4, Published");
    expect(stepText(liveStep({ status: "pending" }, "scheduled"))).toBe("Waiting for its time");
    expect(stepText(liveStep({ status: "failed" }))).toBe("Stopped");
    for (const s of ["pending", "queued", "uploading", "processing", "published", "failed"]) expect(stepText(liveStep({ status: s }))).not.toMatch(/%/);
  });
  test("the same status twice gives the same answer: nothing moves with the clock", () => {
    expect(liveStep({ status: "uploading" })).toEqual(liveStep({ status: "uploading" }));
  });
});

describe("a percentage only when something really counted the bytes", () => {
  test("missing, empty or nonsense figures give null", () => {
    expect(realPercent(null)).toBeNull();
    expect(realPercent(undefined)).toBeNull();
    expect(realPercent({ sent: 1, total: 0 })).toBeNull();
    expect(realPercent({ sent: -1, total: 10 })).toBeNull();
    expect(realPercent({ sent: Number.NaN, total: 10 })).toBeNull();
  });
  test("a real figure is rounded and clamped", () => {
    expect(realPercent({ sent: 5, total: 10 })).toBe(50);
    expect(realPercent({ sent: 1, total: 3 })).toBe(33);
    expect(realPercent({ sent: 20, total: 10 })).toBe(100);
  });
});

describe("last updated", () => {
  const t = Date.parse("2026-11-05T10:00:00.000Z");
  test("plain words, and null when there is no timestamp", () => {
    expect(sinceLabel(null)).toBeNull();
    expect(sinceLabel("not a date")).toBeNull();
    expect(sinceLabel(new Date(t).toISOString(), t + 5000)).toBe("just now");
    expect(sinceLabel(new Date(t).toISOString(), t + 45_000)).toBe("45 sec ago");
    expect(sinceLabel(new Date(t).toISOString(), t + 5 * 60_000)).toBe("5 min ago");
    expect(sinceLabel(new Date(t).toISOString(), t + 3 * 3600_000)).toBe("3 h ago");
    expect(sinceLabel(new Date(t).toISOString(), t + 50 * 3600_000)).toBe("2 days ago");
    expect(updatedLabel(new Date(t).toISOString(), t + 5 * 60_000)).toBe("Updated 5 min ago");
    expect(updatedLabel(null)).toBeNull();
  });
});

describe("the copy obeys the house rules", () => {
  test("no emoji and no em dashes anywhere in the tracker's words", () => {
    const words = [...Object.values(LIVE_LABEL), ...LIVE_STEPS, stepText(liveStep({ status: "uploading" })), updatedLabel(new Date().toISOString()) ?? ""];
    for (const w of words) {
      expect(w).not.toContain("\u2014");
      expect(w).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});

describe("the screens really use it", () => {
  const pv = src("components/create/PublishingView.tsx");
  const sn = src("components/home/SendingNow.tsx");
  const pill = src("components/shell/SendingPill.tsx");
  test("the old synthesised fill is gone from every screen", () => {
    for (const s of [pv, sn]) {
      expect(s).not.toContain("BAND");
      expect(s).not.toContain("STEP_OF");
      expect(s).not.toContain("Math.exp");
      expect(s).not.toContain("eases forward");
    }
    expect(sn).not.toContain('const AT: Record<string, number>');
    expect(pv).toContain("const step = liveStep(t, post.status);");
    expect(pv).toContain("const pct = realPercent(lt?.progress);");
    expect(pv).toContain("pct === null ? `STEP ${step.stepNumber}/${step.total}`");
  });
  test("the cards show the account, the thumbnail, the caption and when it last changed", () => {
    expect(pv).toContain("acct.username ? `@${acct.username}`");
    expect(pv).toContain('className="la-thumb shrink-0"');
    expect(pv).toContain("{caption && <span");
    expect(pv).toContain("{seen && <span");
    expect(sn).toContain("t.account.username ? `@${t.account.username}`");
    expect(sn).toContain("liveLabel(t, p.status)");
  });
  test("all three screens wake on the service worker's push message, focus and the tab coming back", () => {
    for (const s of [pv, sn, pill]) expect(s).toContain("onSendingWake(");
    const lib = src("lib/client/sending.ts");
    expect(lib).toContain('export const SW_NOTICE = "outlly:notice";');
    expect(lib).toContain('navigator.serviceWorker?.addEventListener("message", onMessage)');
    expect(lib).toContain('window.addEventListener("focus", onBack)');
    expect(lib).toContain('document.addEventListener("visibilitychange", onBack)');
    // the same message the worker posts to every open page on every push
    expect(src("public/sw.js")).toContain('tell({ type: "outlly:notice" })');
  });
  test("the steps have names and reduced motion stills them, in LIVE's own block above the glass marker", () => {
    const css = src("app/globals.css");
    const mine = css.indexOf("/* ===== LIVE round 1139 =====");
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(css.indexOf("1100: Liquid glass"));
    expect(css).toContain(".la-step-name {");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .la-step-beat { animation: none; opacity: 1; } }");
    expect(pv).toContain("<span className=\"la-step-name\">{label}</span>");
  });
  test("the tracker feed is read from the database, never invented", () => {
    const route = src("app/api/posts/sending/route.ts");
    expect(route).toContain("platformStatus: true");
    expect(route).toContain("socialAccount: { select: { displayName: true, username: true, avatar: true } }");
    expect(route).toContain('searchParams.get("id")');
    expect(route).not.toContain("Math.random");
    expect(route).not.toContain("progress:");
  });
});
