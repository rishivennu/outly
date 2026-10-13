import { describe, expect, test } from "bun:test";
import { joinedBeforeMaintenance, minutesLeft } from "../lib/maintenance";
import { LANDING_DEFAULT, LANDING_SECTIONS, hiddenAnchors, shown } from "../lib/landing";
import { leftLabel } from "../components/maintenance/Countdown";

describe("maintenance: members keep working, newcomers wait", () => {
  const since = "2026-10-13T10:00:00.000Z";
  test("joined before the switch", () => {
    expect(joinedBeforeMaintenance({ createdAt: "2026-10-01T00:00:00Z" }, since)).toBe(true);
    expect(joinedBeforeMaintenance({ createdAt: new Date("2026-10-13T09:59:59Z") }, since)).toBe(true);
  });
  test("joined after, or not signed in", () => {
    expect(joinedBeforeMaintenance({ createdAt: "2026-10-13T10:00:01Z" }, since)).toBe(false);
    expect(joinedBeforeMaintenance(null, since)).toBe(false);
  });
  test("no start time means every existing account counts", () => {
    expect(joinedBeforeMaintenance({ createdAt: "2026-10-13T12:00:00Z" }, "")).toBe(true);
  });
});

describe("countdown", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  test("minutesLeft rounds up and floors at zero", () => {
    expect(minutesLeft("2026-10-13T11:00:00Z", now)).toBe(60);
    expect(minutesLeft("2026-10-13T10:00:01Z", now)).toBe(1);
    expect(minutesLeft("2026-10-13T09:00:00Z", now)).toBe(0);
    expect(minutesLeft("nope", now)).toBeNull();
  });
  test("labels read like the brief: 1 hour shows 60 minutes", () => {
    expect(leftLabel(60 * 60_000)).toBe("60 minutes left");
    expect(leftLabel(59 * 60_000 + 1)).toBe("60 minutes left");
    expect(leftLabel(60_000)).toBe("1 minute left");
    expect(leftLabel(45_000)).toBe("45 seconds left");
    expect(leftLabel(125 * 60_000)).toBe("2 h 05 min left");
    expect(leftLabel(120 * 60_000)).toBe("2 hours left");
    expect(leftLabel(0)).toBe("Any moment now");
  });
});

describe("landing toggles", () => {
  test("everything shows by default, unknown keys too", () => {
    for (const s of LANDING_SECTIONS) expect(shown(LANDING_DEFAULT, s.id)).toBe(true);
    expect(shown(null, "pricing")).toBe(true);
    expect(hiddenAnchors(LANDING_DEFAULT)).toEqual([]);
  });
  test("hidden sections drop their nav anchors", () => {
    const cfg = { ...LANDING_DEFAULT, sections: { ...LANDING_DEFAULT.sections, pricing: false, faq: false } };
    expect(shown(cfg, "pricing")).toBe(false);
    const a = hiddenAnchors(cfg);
    for (const x of a) expect(x).toMatch(/^[a-z]{1,20}$/);
    expect(a.length).toBe(2);
  });
});
