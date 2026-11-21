// R1292 admin: every admin destination marks "you are here" with the one solid lime fill and dark ink.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const shell = read("components/admin/AdminShell.tsx");
const dock = read("components/admin/AdminDock.tsx");
const tabs = read("components/admin/AdminTabBar.tsx");

describe("R1292 admin sidebar", () => {
  test("the travelling pill is solid lime with the soft glow, on the nav time", () => {
    expect(shell).toContain('className="absolute inset-0 rounded-2xl bg-lime shadow-[0_6px_18px_-6px_hsl(var(--lime)/.5)]" transition={T.nav}');
    expect(shell).not.toContain("bg-secondary\" transition");
  });
  test("the old 3 px lime bar is gone", () => {
    expect(shell).not.toContain("w-[3px]");
  });
  test("active ink is dark, idle is 60 %, colour swaps on the nav duration", () => {
    expect(shell).toContain('on ? "text-lime-foreground" : "text-foreground/60 [@media(hover:hover)]:hover:bg-secondary/60 [@media(hover:hover)]:hover:text-foreground"');
    expect(shell).toContain("transition-colors duration-nav ease-out motion-reduce:transition-none");
    expect(shell).not.toContain('on && "text-lime-ink"');
  });
  test("reduced motion keeps the fill in place", () => {
    expect(shell).toContain("const still = useReducedMotion();");
    expect(shell).toContain("layoutId={still ? undefined : layoutId}");
  });
  test("badges invert on the lime row", () => {
    expect(shell).toContain('on ? "bg-lime-foreground text-lime" : "bg-lime text-[hsl(var(--lime-foreground))]"');
    expect(shell).toContain('on ? "bg-lime-foreground ring-lime" : "bg-lime ring-card"');
  });
  // The 28 px avatar sits in a 40 px circle, so the lime fill shows as an edge; a ring-2 would break R1280's 1px rule.
  test("account: the slim avatar circle and the full row both take the lime fill", () => {
    expect(shell).toContain('mine && "bg-lime"');
    expect(shell).toContain('mine ? "bg-lime text-lime-foreground" : "[@media(hover:hover)]:hover:bg-secondary"');
    expect(shell).toContain('mine ? "text-lime-foreground/70" : "text-muted-foreground"');
  });
});

describe("R1292 admin dock menus", () => {
  test("the current page row and the account row use the lime fill", () => {
    expect(dock).toContain('on ? "bg-lime text-lime-foreground" : "text-muted-foreground');
    expect(dock).toContain('"min-h-14", mine ? "bg-lime text-lime-foreground"');
    expect(dock).not.toContain("bg-secondary text-foreground");
  });
  test("no lime-ink icon tint, the badge inverts on the active row", () => {
    expect(dock).not.toContain("text-lime-ink");
    expect(dock).toContain('on ? "bg-lime-foreground text-lime" : "bg-lime text-lime-foreground"');
  });
});

describe("R1292 admin tab bar", () => {
  test("More carries no marker of its own, it lights through aria-current and the shared pill", () => {
    expect(tabs).toContain('aria-current={moreOn ? "true" : undefined}');
    expect(tabs).not.toMatch(/bg-lime|dock-dot/);
  });
});
