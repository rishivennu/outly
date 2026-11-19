/**
 * R1217: the mobile Analytics platform selector is a real sideways scroller: edge to edge of the frame, no clipped
 * first or last tab, hidden scrollbar, an honest edge fade as the indicator, the chosen tab centred on route change,
 * and the page never scrolls sideways. Same component for desktop (nothing else there changed).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const tabs = src("components/analytics/PlatformTabs.tsx");
const css = src("app/globals.css");

describe("R1217 analytics platform selector", () => {
  test("the strip owns the horizontal overflow and bleeds into the frame gutter so no tab is clipped", () => {
    expect(tabs).toContain('className="edge-fade -mx-[var(--frame-gutter)] overflow-x-auto overflow-y-hidden px-[var(--frame-gutter)] py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"');
    expect(tabs).toContain('<ul className="gseg flex w-max gap-1 rounded-full bg-secondary/60 p-1 hairline">');
    expect(tabs).toContain('<li key={t.href} className="shrink-0">');
    expect(tabs).toContain("whitespace-nowrap rounded-full px-4 text-sm font-medium");
    expect(tabs).not.toContain("-mx-1 overflow-x-auto px-1 pb-1");
  });
  test("the edge fade is the indicator (only when there is more), and it centres the chosen tab per route", () => {
    expect(tabs).toContain('import { useEdgeFade } from "@/lib/client/edge-fade";');
    expect(tabs).toContain("const row = useEdgeFade<HTMLElement>(path);");
    expect(tabs).toContain("<nav ref={row}");
    expect(css).toContain(".edge-fade { --fade-w: 28px; overscroll-behavior-x: contain;");
    const fade = src("lib/client/edge-fade.ts");
    expect(fade).toContain("const r = max > 2 && el.scrollLeft < max - 2;");
    expect(fade).toContain('el.scrollTo({ left: Math.max(0, want), behavior: reduce ? "auto" : "smooth" });');
  });
  test("the analytics layout, pill and data are untouched", () => {
    expect(tabs).toContain('className="an-tabs page-frame pt-8 lg:pt-12"');
    expect(tabs).toContain('layoutId="an-tab"');
    expect(tabs).toContain("useLivePlatforms()");
  });
});
