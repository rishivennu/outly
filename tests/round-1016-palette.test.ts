/** 10-16 UX round, feature 4: command palette ranking and the shortcut guards. */
import { describe, expect, test } from "bun:test";
import { isPaletteKey, isTyping, letterShortcut, rank, score, type Command } from "../lib/client/commands";

const C = (label: string, keywords = ""): Command => ({ id: label, label, group: "Go to", keywords });
const items = [C("Home", "dashboard"), C("Calendar", "schedule plan week"), C("Content", "library posts drafts"), C("Connected accounts", "instagram youtube"), C("Plan a batch", "schedule bulk"), C("Analytics", "views stats")];
const key = (k: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...m });
const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable, closest: () => null });

describe("ranking", () => {
  test("empty query keeps the given order", () => {
    expect(rank(items, "  ").map((c) => c.label)).toEqual(items.map((c) => c.label));
  });
  test("prefix beats word start beats keyword beats scattered letters", () => {
    expect(rank(items, "co").map((c) => c.label).slice(0, 2)).toEqual(["Content", "Connected accounts"]);
    expect(rank(items, "acc")[0].label).toBe("Connected accounts");
    expect(rank(items, "schedule").map((c) => c.label)).toEqual(["Calendar", "Plan a batch"]);
    expect(rank(items, "cal")[0].label).toBe("Calendar");
    expect(rank(items, "pab")[0].label).toBe("Plan a batch");
  });
  test("no match is no match, and case or accents don't matter", () => {
    expect(rank(items, "zzz")).toEqual([]);
    expect(score(C("Café notes"), "CAFE")).toBeGreaterThan(0);
    expect(score(C("Home"), "emoh")).toBe(-1);
  });
  test("limit is respected", () => {
    expect(rank(items, "a", 2)).toHaveLength(2);
  });
});

describe("strict items", () => {
  test("post titles need a real word or substring match, not scattered letters", () => {
    const post = { id: "p", group: "Posts" as const, label: "City walk", strict: true };
    expect(score(post, "cal")).toBe(-1);
    expect(score(post, "walk")).toBeGreaterThan(0);
    expect(score(post, "ty wa")).toBeGreaterThan(0);
    expect(score({ ...post, strict: false }, "cal")).toBeGreaterThan(0);
  });
});

describe("keys", () => {
  test("Ctrl+K and Cmd+K open it, plain K and Alt combos don't", () => {
    expect(isPaletteKey(key("k", { ctrlKey: true }))).toBe(true);
    expect(isPaletteKey(key("K", { metaKey: true }))).toBe(true);
    expect(isPaletteKey(key("k"))).toBe(false);
    expect(isPaletteKey(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
  });
  test("typing targets are recognised", () => {
    expect(isTyping(el("INPUT"))).toBe(true);
    expect(isTyping(el("textarea"))).toBe(true);
    expect(isTyping(el("DIV", true))).toBe(true);
    expect(isTyping(el("BUTTON"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
  test("N and S fire only when it's safe", () => {
    const ok = { enabled: true, dialogOpen: false };
    expect(letterShortcut(key("n"), el("BODY"), ok)).toBe("new");
    expect(letterShortcut(key("s"), el("BUTTON"), ok)).toBe("schedule");
    expect(letterShortcut(key("n"), el("INPUT"), ok)).toBeNull();
    expect(letterShortcut(key("n", { ctrlKey: true }), el("BODY"), ok)).toBeNull();
    expect(letterShortcut(key("s", { metaKey: true }), el("BODY"), ok)).toBeNull(); // Cmd+S stays the browser's
    expect(letterShortcut(key("N", { shiftKey: true }), el("BODY"), ok)).toBeNull();
    expect(letterShortcut(key("n", { repeat: true }), el("BODY"), ok)).toBeNull();
    expect(letterShortcut(key("n"), el("BODY"), { enabled: true, dialogOpen: true })).toBeNull();
    expect(letterShortcut(key("n"), el("BODY"), { enabled: false, dialogOpen: false })).toBeNull();
    expect(letterShortcut(key("x"), el("BODY"), ok)).toBeNull();
  });
});
