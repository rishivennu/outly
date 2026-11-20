/**
 * R1221: the Publishing Success screen's two columns are real columns. Before, the four cards sat in shared grid
 * rows, so a tall You're live card left a hole under the preview, the success card was stretched to match its
 * neighbour, and the Live Activity list still wrapped two cards a row at tablet widths. Now each side stacks its
 * own cards with one gap, nothing is stretched, phones get a sensible single-column order (You're live, preview,
 * What happened, Live Activity), the stepper shares the content's max width, and the preview rows are readable.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const view = src("components/create/PublishingView.tsx");
const flow = src("components/create/CreateWorkspace.tsx");

describe("R1221 publishing success columns", () => {
  test("two flex columns from lg, `contents` below so the single column keeps its own order", () => {
    expect(view).toContain('data-testid="pub-col-left"');
    expect(view).toContain('data-testid="pub-col-right"');
    expect(view).toContain('!active && "order-1 rounded-[24px] bg-card px-5 py-6 hairline sm:px-8 sm:py-7 lg:order-none"');
    expect(view).toContain('className="order-2 lg:order-none" />');
    expect(view).toContain('className="order-3 lg:order-none" />');
    expect(view).toContain('className={cn(!active && "order-4 min-w-0 lg:order-none")} data-testid="pub-live"');
    expect(view).toContain('active ? "mt-4" : "order-5 lg:col-span-2"');
    // the grid itself still starts rows at the top and uses one gap
    expect(view).toContain('"mt-5 grid items-start gap-4 sm:gap-5 lg:grid-cols-2"');
    // no card is stretched to its neighbour's height any more
    expect(view).not.toContain("min-h-full flex-col justify-center rounded-[24px]");
    expect(view).not.toContain("lg:col-start-2 lg:row-start-2");
  });
  test("the settled Live Activity list is one full-width card a row at every width", () => {
    expect(view).toContain(': "flex min-w-0 flex-col gap-4 [&>li]:!w-full [&>li]:min-w-0 [&>li]:rounded-[24px] [&_.la-box]:min-h-0")}');
    expect(view).not.toContain("flex flex-wrap justify-center gap-4 lg:[&>li]:!w-full");
    // the in-flight layout is untouched
    expect(view).toContain('"mx-auto mt-10 flex max-w-[56rem] flex-wrap justify-center gap-5"');
  });
  test("preview rows: a bigger thumb, a caption that wraps to two lines, the badge pinned right", () => {
    // R1254: the three columns centre on one line
    expect(view).toContain("grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] bg-secondary/50 p-3 hairline sm:gap-4");
    expect(view).toContain('relative h-[86px] w-[64px] shrink-0 overflow-hidden rounded-xl bg-secondary');
    expect(view).toContain('className="line-clamp-2 text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]" title={line}'); // R1260: unbroken captions wrap too
    expect(view).toContain("gap-1 whitespace-nowrap font-semibold text-foreground");
    expect(view).toContain('<StatusBadge status={t.status} className="shrink-0 self-center whitespace-nowrap" />');
  });
  test("the stepper above the sent screen shares the content's width", () => {
    expect(flow).toContain('<StepProgress step="launch" complete reachable={SENT_REACHABLE} onGo={noGo} className="relative mx-auto mb-8 w-full max-w-6xl px-0" />');
    expect(view).toContain('<div className="mx-auto w-full max-w-6xl">');
  });
});
