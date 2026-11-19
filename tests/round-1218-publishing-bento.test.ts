/**
 * R1218: the Publishing Success screen is a bento grid on large screens (You're live + What happened on the left,
 * preview + Live activity on the right), a single column on phones, one type system and one card style throughout.
 * The in-flight (active) state is untouched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const view = src("components/create/PublishingView.tsx");
const css = src("app/globals.css");

describe("R1218 publishing success bento", () => {
  test("a two column grid only once settled, single column below lg", () => {
    expect(view).toContain('className={cn(!active && "mt-6 grid items-start gap-4 lg:grid-cols-2 lg:gap-5")} data-testid="pub-bento"');
    expect(view).toContain("lg:col-start-1 lg:row-start-1");
    expect(view).toContain('className="lg:col-start-2 lg:row-start-1"');
    expect(view).toContain('"min-w-0 lg:col-start-2 lg:row-start-2"');
    expect(view).toContain('className="lg:col-start-1 lg:row-start-2"');
  });
  test("one card style and one label style, no leftover themed card tokens", () => {
    expect(view).toContain("rounded-[24px] bg-card px-5 py-7 hairline sm:px-8");
    expect(view).toContain("rounded-[24px] bg-card p-4 hairline sm:p-5");
    expect(view).not.toContain("la-card la-themed");
    expect(css).toContain(".pub-label");
    expect(css).toMatch(/\.pub-label\s*\{[^}]*font-size:\s*12px/);
    expect(css).toMatch(/\.pub-label\s*\{[^}]*text-transform:\s*uppercase/);
  });
  test("live activity renders once per target and the active state keeps its layout", () => {
    expect(view.split("<LiveActivity key={t.id}").length - 1).toBe(1);
    expect(view).toContain('data-testid="pub-live"');
    expect(view).toContain('data-testid="what-happened"');
    expect(view).toContain('<Button asChild variant="subtle" size="sm">');
  });
});
