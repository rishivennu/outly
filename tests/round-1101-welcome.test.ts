/** 1101: the Home Screen welcome redesigned after the reference (headline, hero art, stacked actions, text link). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HEADLINE_NOWRAP, WELCOME_DEFAULT, WELCOME_OLD_TITLE, headlineParts, normalizeWelcome } from "../lib/pwa-welcome";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const w = src("components/shell/PwaWelcome.tsx");
const css = src("app/globals.css");
const block = css.slice(css.indexOf("/* 1100 first launch from the Home Screen (PwaWelcome)"), css.indexOf("@keyframes wa-drift"));

describe("1101 headline", () => {
  test("the new default, split per sentence, last word highlighted", () => {
    expect(WELCOME_DEFAULT.title).toBe("Welcome! Let's get to it.");
    expect(headlineParts(WELCOME_DEFAULT.title)).toEqual({ lines: ["Welcome!"], tail: "Let's get to", hl: "it." });
    expect(headlineParts("Hello")).toEqual({ lines: [], tail: "", hl: "Hello" });
    expect(headlineParts("Hi Maya. Ready? Go now.")).toEqual({ lines: ["Hi Maya.", "Ready?"], tail: "Go", hl: "now." });
  });
  test("short lines never break inside; long ones may wrap", () => {
    expect("Let's get to it.".length).toBeLessThanOrEqual(HEADLINE_NOWRAP);
    expect(w).toContain('t.length <= HEADLINE_NOWRAP && "pw-nowrap"');
    expect(block).toContain(".pw-nowrap { white-space: nowrap; }");
  });
  test("a saved copy of the old default follows the new one; a custom title stays", () => {
    expect(normalizeWelcome({ title: WELCOME_OLD_TITLE }).title).toBe(WELCOME_DEFAULT.title);
    expect(normalizeWelcome({ title: "Hey {name}." }).title).toBe("Hey {name}.");
  });
  test("lime highlight: bright in dark, lime-ink with a lime marker in light", () => {
    expect(block).toMatch(/html\.dark\[data-welcome\] \.pwa-welcome \{[^}]*--pw-hl: hsl\(78 100% 55%\)/);
    expect(block).toMatch(/--pw-hl: hsl\(84 85% 24%\)/);
    expect(block).toContain("html:not(.dark) .pw-hl { background: linear-gradient(hsl(78 92% 50%");
  });
});

describe("1101 actions keep working", () => {
  test("four actions, each counts as seen; connect, tour and skip go where they say", () => {
    for (const k of ['leave("start")', 'leave("connect")', 'leave("tour")', 'leave("skip")']) expect(w).toContain(k);
    expect(w).toContain('if (how === "connect") router.push("/accounts")');
    expect(w).toContain('if (how === "skip" && location.pathname !== "/home") router.push("/home")');
    expect(w).toContain('if (how === "tour") startTour();');
    expect(w).toMatch(/const leave = \(how: Exit\) => \{\s*if \(phase !== "show"\) return;\s*try \{\s*localStorage\.setItem\(WELCOME_KEY/);
  });
  test("close X and Escape both close it; Tab cycles inside the screen", () => {
    expect(w).toContain('aria-label="Close welcome"');
    expect(w).toContain('if (e.key === "Escape") leave("start")');
    expect(w).toMatch(/e\.key === "Tab"[\s\S]{0,500}items\[next\]\.focus\(\)/);
  });
  test("labels are admin-adjustable and validated", () => {
    const n = normalizeWelcome({ connect: "  ", tour: "x".repeat(99), skip: "Later" });
    expect(n.connect).toBe(WELCOME_DEFAULT.connect);
    expect(n.tour.length).toBe(28);
    expect(n.skip).toBe("Later");
    const r = src("app/api/admin/welcome/route.ts");
    for (const k of ["connect", "tour", "skip"]) expect(r).toContain(`${k}: z.string().trim().min(1).max(WELCOME_LIMITS.${k}).optional()`);
    const card = src("components/admin/WelcomeScreenSettings.tsx");
    expect(card).toContain('const WORDS = ["title", "body", "button", "connect", "tour", "skip"] as const;');
    expect(card).not.toContain("Ticked lines");
  });
});

describe("1101 look and motion", () => {
  test("follows the theme: paper in light, ink in dark; black primary with white text in light", () => {
    expect(block).toMatch(/--pw-bg: hsl\(40 33% 96%\);[^}]*--pw-cta-bg: hsl\(232 16% 7%\); --pw-cta-fg: hsl\(0 0% 100%\)/);
    expect(block).toMatch(/html\.dark\[data-welcome\] \.pwa-welcome \{\s*--pw-bg: hsl\(232 16% 7%\)/);
    expect(w).toContain("<WelcomeArt />");
  });
  test("timings from the brief", () => {
    expect(block).toContain(".pw-a { animation: pw-fade .4s var(--pw-ease) both; }");
    expect(block).toContain(".pw-b { animation: pw-rise .6s var(--pw-ease) .08s both; }");
    expect(block).toContain(".pw-c { animation: pw-grow .8s var(--pw-ease) .18s both; }");
    expect(block).toContain("calc(340ms + var(--i, 0) * 100ms)");
    expect(block).toContain("--pw-ease: cubic-bezier(.16, 1, .3, 1);");
    expect(block).toMatch(/\.pw-cta:active, \.pw-x:active, \.pw-link:active \{ transform: scale\(\.98\); \}/);
    expect(block).toMatch(/transition: transform \.15s var\(--pw-ease\)/);
    expect(block).toContain('.pwa-welcome[data-phase="leaving"] { animation: pw-leave .3s var(--pw-ease) forwards;');
    expect(css).toContain("@keyframes pw-leave { to { opacity: 0; transform: translateY(24px); } }");
    expect(w).toContain("export const WELCOME_EXIT_MS = 300;");
  });
  test("reduced motion: no float, no slide, no press scale", () => {
    const reduce = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toContain(".pw-cta:active, .pw-x:active, .pw-link:active { transform: none; }");
    const moving = block.slice(block.indexOf("@media (prefers-reduced-motion: no-preference)"), block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(moving).toContain(".wa-float");
    expect(block.split(".wa-float").length).toBe(2); // only inside the no-preference block
  });
  test("44px targets, safe areas, fits short phones", () => {
    expect(block).toMatch(/\.pw-x \{[^}]*width: 44px; height: 44px/);
    expect(block).toMatch(/\.pw-link \{[^}]*min-height: 44px/);
    for (const s of ["top", "right", "bottom", "left"]) expect(block).toContain(`env(safe-area-inset-${s})`);
    expect(block).toContain("@media (max-height: 700px) and (max-width: 1023px)");
  });
  test("the art is decorative, self-contained and theme-aware", () => {
    const a = src("components/shell/WelcomeArt.tsx");
    expect(a).toContain('aria-hidden="true"');
    expect(a).toContain("<feTurbulence");
    expect(a).toContain('stroke="currentColor"');
    expect(a).not.toMatch(/<image|href=/);
  });
});
