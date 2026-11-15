/** Phase 2 onboarding, the pure half: reading the saved record, merging it with real data, and every change. */
import { describe, expect, test } from "bun:test";
import { ONBOARDING_STEPS, applicableSteps, applyOnboarding, mergeOnboarding, parseOnboarding, serializeOnboarding, type OnboardingFacts } from "../lib/onboarding-core";

const NOW = new Date("2026-11-15T10:00:00.000Z");
const fresh: OnboardingFacts = { owner: true, connected: false, profile: false, uploaded: false, scheduled: false };
const status = (v: ReturnType<typeof mergeOnboarding>) => Object.fromEntries(v.steps.map((s) => [s.id, s.status]));

describe("parseOnboarding", () => {
  test("null, broken JSON, the wrong version and junk all read as never started", () => {
    for (const raw of [null, undefined, "", "{", "[]", '{"v":2,"steps":{}}', '"text"']) expect(parseOnboarding(raw)).toBeNull();
  });
  test("keeps only known steps with a known status and a real date", () => {
    const p = parseOnboarding(JSON.stringify({ v: 1, steps: { welcome: "done", connect: "skipped", profile: "maybe", evil: "done" }, finishedAt: "nope", updatedAt: NOW.toISOString(), extra: 1 }));
    expect(p).toEqual({ v: 1, steps: { welcome: "done", connect: "skipped" }, updatedAt: NOW.toISOString() });
  });
  test("round trips through serialize", () => {
    const s = applyOnboarding(null, { step: "welcome", status: "done" }, fresh, NOW);
    expect(parseOnboarding(serializeOnboarding(s))).toEqual(s);
  });
});

describe("mergeOnboarding", () => {
  test("a new account: six steps to do, opens by itself once, starts at Welcome", () => {
    const v = mergeOnboarding(null, fresh);
    expect(v.steps.map((s) => s.id)).toEqual([...ONBOARDING_STEPS]);
    expect(v).toMatchObject({ done: 0, skipped: 0, total: 6, finished: false, autoOpen: true, next: "welcome" });
  });
  test("done comes from real data whatever was saved, and is marked as such", () => {
    const v = mergeOnboarding({ v: 1, steps: { connect: "skipped" }, updatedAt: "" }, { ...fresh, connected: true, uploaded: true });
    expect(status(v)).toMatchObject({ connect: "done", create: "done", profile: "todo" });
    expect(v.steps.find((s) => s.id === "connect")!.auto).toBe(true);
    expect(v.steps.find((s) => s.id === "welcome")!.auto).toBe(false);
  });
  test("an account set up the old way (connected and a post sent or booked) is not walked through again", () => {
    expect(mergeOnboarding(null, { ...fresh, connected: true, scheduled: true })).toMatchObject({ finished: true, autoOpen: false });
    expect(mergeOnboarding(null, { ...fresh, connected: true })).toMatchObject({ finished: false });
    expect(mergeOnboarding(null, { ...fresh, scheduled: true })).toMatchObject({ finished: false });
  });
  test("after Start again the old-way rule no longer closes it", () => {
    const reset = applyOnboarding({ v: 1, steps: { welcome: "done" }, finishedAt: NOW.toISOString(), updatedAt: "" }, { action: "reset" }, fresh, NOW);
    expect(mergeOnboarding(reset, { ...fresh, connected: true, scheduled: true })).toMatchObject({ finished: false, next: "welcome" });
  });
  test("once the welcome is seen (done or skipped) it never opens by itself again", () => {
    expect(mergeOnboarding({ v: 1, steps: { welcome: "skipped" }, updatedAt: "" }, fresh)).toMatchObject({ autoOpen: false, finished: false, next: "connect" });
  });
  test("a teammate is never asked to connect accounts or fill the owner's profile", () => {
    expect(applicableSteps(false)).toEqual(["welcome", "create", "schedule", "analytics"]);
    expect(mergeOnboarding(null, { ...fresh, owner: false }).total).toBe(4);
  });
});

describe("applyOnboarding", () => {
  test("a step can be done or skipped; skipping the last open one finishes", () => {
    let s = applyOnboarding(null, { step: "welcome", status: "done" }, fresh, NOW);
    expect(s).toEqual({ v: 1, steps: { welcome: "done" }, updatedAt: NOW.toISOString() });
    for (const id of ["connect", "profile", "create", "schedule"] as const) s = applyOnboarding(s, { step: id, status: "skipped" }, fresh, NOW);
    expect(s.finishedAt).toBeUndefined();
    s = applyOnboarding(s, { step: "analytics", status: "done" }, fresh, NOW);
    expect(s.finishedAt).toBe(NOW.toISOString());
    expect(mergeOnboarding(s, fresh)).toMatchObject({ finished: true, done: 2, skipped: 4, next: null });
  });
  test("finish and dismiss mark whatever is open as skipped, keep what is done, and stamp the time once", () => {
    for (const action of ["finish", "dismiss"] as const) {
      const s = applyOnboarding({ v: 1, steps: { welcome: "done" }, updatedAt: "" }, { action }, { ...fresh, uploaded: true }, NOW);
      expect(s.steps).toEqual({ welcome: "done", connect: "skipped", profile: "skipped", schedule: "skipped", analytics: "skipped" });
      expect(s.finishedAt).toBe(NOW.toISOString());
      const later = applyOnboarding(s, { action }, fresh, new Date("2026-12-01T00:00:00Z"));
      expect(later.finishedAt).toBe(NOW.toISOString());
    }
  });
  test("reset clears the record but real data still counts", () => {
    const s = applyOnboarding({ v: 1, steps: { welcome: "done", analytics: "done" }, finishedAt: NOW.toISOString(), updatedAt: "" }, { action: "reset" }, fresh, NOW);
    expect(s).toEqual({ v: 1, steps: {}, updatedAt: NOW.toISOString() });
    expect(status(mergeOnboarding(s, { ...fresh, uploaded: true }))).toMatchObject({ welcome: "todo", create: "done" });
  });
  test("reopening a finished step does not unfinish it", () => {
    const s = applyOnboarding({ v: 1, steps: {}, finishedAt: NOW.toISOString(), updatedAt: "" }, { step: "connect", status: "skipped" }, fresh, new Date("2026-12-01T00:00:00Z"));
    expect(s.finishedAt).toBe(NOW.toISOString());
  });
});
