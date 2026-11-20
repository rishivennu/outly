/**
 * R1254: the Publishing Success screen's final layout. One max width shared by the stepper, the header row and the
 * bento grid; a header row that wraps instead of overlapping; two equal columns with aligned tops and no card
 * given a height; a readable preview row; a compact What happened; and the existing Live Activity contained in its
 * column with its logic untouched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const view = src("components/create/PublishingView.tsx");
const flow = src("components/create/CreateWorkspace.tsx");
const settled = view.slice(view.indexOf("  return (\n    <div className=\"mx-auto w-full max-w-6xl\">"), view.indexOf("function PublishedPreview"));
const fnBody = (name: string) => {
  const start = view.indexOf(`function ${name}(`);
  const next = view.indexOf("\nfunction ", start + 10);
  return view.slice(start, next === -1 ? undefined : next);
};

describe("R1254 publishing layout", () => {
  test("stepper, header row and grid share one max width", () => {
    expect(flow).toContain('className="relative mx-auto mb-8 w-full max-w-6xl px-0"');
    expect(view).toContain('<div className="mx-auto w-full max-w-6xl">');
    expect(view.match(/max-w-6xl/g)?.length).toBe(1);
  });

  test("header row: heading and count left, actions right, wrapping instead of overlapping", () => {
    expect(view).toContain('<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3" data-testid="pub-head">');
    expect(view).toContain('font-bold leading-tight tracking-[-0.02em] sm:text-2xl">{stage}.</p>');
    expect(view).toContain('"Publishing complete"');
    const actions = view.match(/<div className="([^"]+)" data-testid="pub-actions">/)?.[1] ?? "";
    expect(actions).toContain("flex-wrap");
    expect(actions).toContain("sm:ml-auto");
    expect(actions).toContain("w-full");
    expect(actions).not.toContain("min-w-0");
    // See your content first, primary; Create another second, secondary
    const a = view.slice(view.indexOf('data-testid="pub-actions"'));
    expect(a.indexOf('variant="primary"')).toBeLessThan(a.indexOf("See your content"));
    expect(a.indexOf("See your content")).toBeLessThan(a.indexOf('variant="subtle"'));
    expect(a.indexOf('variant="subtle"')).toBeLessThan(a.indexOf("Create another"));
    expect(view.indexOf('data-testid="pub-head"')).toBeLessThan(view.indexOf('data-testid="pub-bento"'));
  });

  test("two equal columns from lg, aligned tops, one gap, stacked below lg", () => {
    const grid = view.match(/!active && "([^"]+)"\)\} data-testid="pub-bento"/)?.[1] ?? "";
    expect(grid.split(" ")).toEqual(expect.arrayContaining(["grid", "items-start", "lg:grid-cols-2"]));
    expect(grid).not.toMatch(/grid-cols-\[/);
    expect(view.match(/lg:flex lg:min-w-0 lg:flex-col lg:gap-5/g)?.length).toBe(2);
    expect(view).not.toContain("items-stretch");
  });

  test("no fixed heights on the settled cards", () => {
    expect(settled).not.toContain("h-[76px]");
    expect(settled).toContain('active ? "mb-3 h-[104px]" : "mb-3"');
    for (const fn of ["PublishedPreview", "WhatHappened"]) {
      const body = fnBody(fn);
      expect(body, fn).not.toMatch(/\b(?:min-)?h-\[(?!86px)[^\]]+\]/);
      expect(body, fn).not.toMatch(/\bmax-h-/);
    }
    expect(view).toContain("[&_.la-box]:min-h-0");
  });

  test("preview row: fixed thumb frame, middle column truncates, status pinned right", () => {
    const pv = fnBody("PublishedPreview");
    expect(pv).toContain("grid-cols-[64px_minmax(0,1fr)_auto] items-center");
    expect(pv).toContain("relative h-[86px] w-[64px] shrink-0 overflow-hidden");
    expect(pv).toContain('className="h-full w-full object-cover"');
    expect(pv).toContain("line-clamp-2");
    expect(pv).toContain("{meta.name}");
    expect(pv).toContain("{handle ?");
    expect(pv).toContain("Published {when}");
    expect(pv).toContain("{live && t.url && (");
    expect(pv).toContain('<StatusBadge status={t.status} className="shrink-0 self-center whitespace-nowrap" />');
  });

  test("What happened is compact: 44px rows, one heading row", () => {
    const wh = fnBody("WhatHappened");
    expect(wh).toContain("grid min-h-11 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-2");
    expect(wh).toContain('<ul className="mt-2 divide-y divide-border/70">');
    expect(wh).toContain("flex flex-wrap items-center justify-between gap-x-3 gap-y-2");
    expect(wh).toContain("See how it's doing");
  });

  test("Live Activity is contained in its column, rendered once, logic untouched", () => {
    expect(view).toContain('"flex min-w-0 flex-col gap-4 [&>li]:!w-full [&>li]:min-w-0 [&>li]:rounded-[24px] [&_.la-box]:min-h-0"');
    expect(view).toContain('className={cn(!active && "order-4 min-w-0 lg:order-none")} data-testid="pub-live"');
    expect(view).toContain('<h2 id="pub-live-title" className="pub-label mb-3">Live activity</h2>');
    expect(view.match(/<LiveActivity key=\{t\.id\}/g)?.length).toBe(1);
    const la = fnBody("LiveActivity");
    expect(la).toContain("const step = liveStep(t, post.status);");
    expect(la).toContain("const pct = realPercent(lt?.progress);");
    expect(la).toContain('<DotText text="YOU" />');
    expect(la).toContain("See it on {meta.name}");
    expect(la).toContain('<PlatformGlyph platform={t.platform} surface="dark"');
    expect(la.match(/onClick=\{onRetry\}/g)?.length).toBe(2);
    // the in-flight layout keeps its own list
    expect(view).toContain('"mx-auto mt-10 flex max-w-[56rem] flex-wrap justify-center gap-5"');
  });

  test("one type family: no new fonts or monospace added to the settled cards", () => {
    for (const fn of ["PublishedPreview", "WhatHappened"]) expect(fnBody(fn), fn).not.toMatch(/font-(mono|serif|display)|fontFamily/);
    expect(settled).not.toMatch(/fontFamily/);
    expect(view).not.toMatch(/[\u2013\u2014]/);
  });
});
