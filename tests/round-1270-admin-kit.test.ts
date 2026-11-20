/**
 * R1270 admin kit: the semantic status vocabulary and its normaliser, dot + word badges, pagination arithmetic,
 * and the kit pieces built on the shared components (Input, Button, Tooltip, Skeleton).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STATUS_LABEL, StatusBadge, Table, LoadingState, Empty, ErrorState, statusOf } from "../components/admin/ui";
import { pageWindow, readPaging, PAGE_LIMIT } from "../components/admin/page-window";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

describe("status vocabulary", () => {
  test("the eight semantic keys exist with their labels and tones", () => {
    const want: Record<string, [string, string]> = {
      active: ["Active", "ok"],
      pending: ["Waiting", "warn"],
      waiting: ["Waiting", "warn"],
      completed: ["Completed", "ok"],
      failed: ["Failed", "bad"],
      suspended: ["Suspended", "muted"],
      resolved: ["Resolved", "ok"],
      attention: ["Requires attention", "warn"],
    };
    for (const [k, [label, tone]] of Object.entries(want)) {
      expect(STATUS_LABEL[k]?.label).toBe(label);
      expect(STATUS_LABEL[k]?.tone).toBe(tone);
    }
    expect(STATUS_LABEL.attention.strong).toBe(true);
    expect(STATUS_LABEL.suspended.dot).toBe("bad");
  });

  test("existing keys keep their words", () => {
    expect(STATUS_LABEL.skipped.label).toBe("Held back");
    expect(STATUS_LABEL.sent.label).toBe("Accepted");
    expect(STATUS_LABEL.queued.label).toBe("Waiting");
    expect(STATUS_LABEL.live).toEqual({ label: "Live", tone: "ok" });
    expect(STATUS_LABEL["keys-missing"].label).toBe("Keys missing");
  });

  test("statusOf maps raw values onto keys", () => {
    const table: [string | null | undefined, string][] = [
      ["active", "active"],
      ["  ACTIVE ", "active"],
      ["ok", "active"],
      ["OK", "active"],
      ["enabled", "active"],
      ["error", "failed"],
      ["Errored", "failed"],
      ["failed", "failed"],
      ["needs_attention", "attention"],
      ["Needs attention", "attention"],
      ["requires-attention", "attention"],
      ["complete", "completed"],
      ["cancelled", "canceled"],
      ["disabled", "suspended"],
      ["past due", "past_due"],
      ["keys_missing", "keys-missing"],
      ["Keys-Missing", "keys-missing"],
      ["Pending Approval", "pending_approval"],
      ["something-new", "something-new"],
      ["constructor", "constructor"],
      ["", ""],
      [null, ""],
      [undefined, ""],
    ];
    for (const [raw, key] of table) expect(statusOf(raw)).toBe(key);
  });
});

describe("StatusBadge", () => {
  test("renders a dot and the word, with a small size for rows", () => {
    const md = renderToStaticMarkup(createElement(StatusBadge, { status: "failed" }));
    expect(md).toContain('data-dot=""');
    expect(md).toContain("bg-destructive");
    expect(md).toContain("Failed");
    const sm = renderToStaticMarkup(createElement(StatusBadge, { status: "active", size: "sm" }));
    expect(sm).toContain("h-5");
    expect(sm).toContain("bg-success");
    const att = renderToStaticMarkup(createElement(StatusBadge, { status: "attention" }));
    expect(att).toContain("Requires attention");
    expect(att).toContain("ring-1");
    const sus = renderToStaticMarkup(createElement(StatusBadge, { status: "suspended" }));
    expect(sus).toContain("bg-destructive");
  });
  test("unknown values print as given, the label override still wins", () => {
    expect(renderToStaticMarkup(createElement(StatusBadge, { status: "weird" }))).toContain("weird");
    expect(renderToStaticMarkup(createElement(StatusBadge, { status: "succeeded", label: "Paid" }))).toContain("Paid");
  });
});

describe("pageWindow", () => {
  test("no rows: one page, nothing to show", () => {
    expect(pageWindow(0, 1, 25)).toEqual({ page: 1, pages: 1, limit: 25, total: 0, from: 0, to: 0, skip: 0, take: 25, prev: null, next: null });
    expect(pageWindow(0, 5, 25).page).toBe(1);
  });
  test("an exact multiple has no empty last page", () => {
    const w = pageWindow(300, 12, 25);
    expect(w.pages).toBe(12);
    expect([w.from, w.to, w.next, w.prev]).toEqual([276, 300, null, 11]);
    expect(pageWindow(50, 3, 25).page).toBe(2);
  });
  test("first, middle and a short last page", () => {
    expect(pageWindow(301, 1).from).toBe(1);
    expect(pageWindow(301, 1).to).toBe(PAGE_LIMIT);
    expect(pageWindow(301, 1).prev).toBeNull();
    const mid = pageWindow(301, 2, 25);
    expect([mid.from, mid.to, mid.skip, mid.prev, mid.next]).toEqual([26, 50, 25, 1, 3]);
    const last = pageWindow(301, 13, 25);
    expect([last.from, last.to, last.next, last.pages]).toEqual([301, 301, null, 13]);
  });
  test("bad input is clamped", () => {
    expect(pageWindow(10, -3, 25).page).toBe(1);
    expect(pageWindow(10, Number.NaN, 0).limit).toBe(25);
    expect(pageWindow(-5, 1, 10).total).toBe(0);
  });
  test("readPaging reads page and limit from either kind of params", () => {
    expect(readPaging(new URLSearchParams("page=3&limit=50"))).toEqual({ page: 3, limit: 50 });
    expect(readPaging({ page: "x" })).toEqual({ page: 1, limit: 25 });
    expect(readPaging({ page: ["2"], limit: "9999" })).toEqual({ page: 2, limit: 200 });
  });
});

describe("states and table", () => {
  test("LoadingState uses the shared Skeleton in three shapes", () => {
    for (const shape of ["lines", "cards", "table"] as const) {
      const html = renderToStaticMarkup(createElement(LoadingState, { shape, lines: 3 }));
      expect(html).toContain('role="status"');
      expect(html).toContain("skeleton");
    }
    expect(read("components/admin/ui.tsx")).toContain('import { Skeleton } from "@/components/shared/Skeleton"');
  });
  test("Empty takes an icon and one action; ErrorState draws a retry link as the lime Button", () => {
    const e = renderToStaticMarkup(createElement(Empty, { title: "No rows", icon: createElement("svg"), action: createElement("a", { href: "/x" }, "Add") }));
    expect(e).toContain("No rows");
    expect(e).toContain('href="/x"');
    const err = renderToStaticMarkup(createElement(ErrorState, { body: "Down", retryHref: "/admin/users" }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('href="/admin/users"');
    expect(err).toContain("lime-bg");
    expect(err).toContain("Try again");
  });
  test("Table: quiet headers, numeric alignment, hover only on hover devices, cards contract unchanged", () => {
    const html = renderToStaticMarkup(
      createElement(Table, { head: ["Name", "Count"], align: [undefined, "right"], children: createElement("tr", { key: "a" }, createElement("td", null, "x"), createElement("td", null, "3")) }),
    );
    // R1275: headers read as sentence case at 12px/600, no uppercase or wide tracking.
    expect(html).toContain("text-[12px] font-semibold tracking-normal text-muted-foreground");
    expect(html).not.toContain("uppercase");
    expect(html).toContain("text-right tabular-nums");
    expect(html).toContain('data-cell="lead"');
    expect(html).toContain('data-label="Count"');
    expect(html).toContain('data-flip-id="a"');
    expect(html).toContain("[@media(hover:hover)]:[&amp;_tr:hover]");
    expect(html).not.toMatch(/ \[&amp;_tr:hover\]/);
    const pinned = renderToStaticMarkup(createElement(Table, { head: ["A", "B"], stickyFirst: true, children: createElement("tr", null, createElement("td", null, "1"), createElement("td", null, "2")) }));
    expect(pinned).toContain("atable--cards");
    expect(pinned).toContain("pin-first atable--pin");
  });
});

describe("source contracts", () => {
  const search = read("components/admin/SearchBox.tsx");
  const input = read("components/admin/SearchInput.tsx");
  const pag = read("components/admin/Pagination.tsx");
  const refresh = read("components/admin/RefreshButton.tsx");
  const kit = read("components/admin/kit.ts");
  const sw = read("components/admin/Switch.tsx");
  const chart = read("components/admin/ChartCard.tsx");
  const css = read("app/globals.css");

  test("search fields sit on the shared Input with a labelled clear button and Escape", () => {
    expect(input).toContain('import { Input } from "@/components/ui/field"');
    expect(input).toContain('aria-label="Clear search"');
    expect(input).toContain('e.key === "Escape"');
    expect(input).toContain("touch:h-11");
    expect(search).toContain('import { Input } from "@/components/ui/field"');
    expect(search).toContain("<SearchInput ");
    expect(search).toContain("<Input");
  });
  test("chips are a glass segmented control on phones and stay links", () => {
    expect(search).toContain('className="gseg flex');
    expect(search).toContain("aria-current={current === o.value");
    expect(search).toContain("<GlideChips");
  });
  test("MoreFilters closes on Escape and outside, focus goes back", () => {
    expect(search).toContain('"Escape"');
    expect(search).toContain("trigger.current?.focus()");
    expect(search).toContain('"pointerdown"');
  });
  test("Pagination: outline sm Buttons with labels, URL params, hidden on one page", () => {
    expect(pag).toContain('import { Button } from "@/components/ui/button"');
    expect(pag).toContain('variant="outline" size="sm"');
    expect(pag).toContain('"Previous page"');
    expect(pag).toContain('"Next page"');
    expect(pag).toContain("if (w.pages <= 1) return null;");
    expect(pag).toContain('n.set("page"');
  });
  test("RefreshButton is the shared icon Button inside a Tooltip and keeps its copy", () => {
    expect(refresh).toContain('import { Button } from "@/components/ui/button"');
    expect(refresh).toContain('size="icon-sm"');
    expect(refresh).toContain("<Tooltip ");
    expect(refresh).toContain("Last refreshed");
    expect(refresh).toContain("Up to date");
    expect(refresh).toContain("motion-reduce:animate-none");
  });
  test("chart card toggle is a segmented control with aria-pressed", () => {
    expect(chart).toContain("aria-pressed={view === v}");
    expect(chart).toContain('className="gseg');
  });
  test("kit re-exports the new pieces and Switch has a row", () => {
    for (const n of ["AdminPagination", "statusOf", "SwitchRow", "Switch", "pageWindow", "readPaging"]) expect(kit).toContain(n);
    expect(sw).toContain("export function SwitchRow(");
    expect(sw).toContain("export function Switch(");
    expect(sw).toContain("min-h-11");
  });
  test("css block sits before the 1100 marker", () => {
    const a = css.indexOf("/* R1270 admin kit");
    const b = css.indexOf("/* ---------- 1100: Liquid glass on every studio card");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(css.slice(a, css.indexOf("/* end R1270 */"))).not.toMatch(/transition|transform/);
  });
  test("touch targets: Hint gets a 44px tap zone, glide chips are 44px on touch", () => {
    expect(read("components/admin/ui.tsx")).toContain("relative grid h-6 w-6 place-items-center rounded-full text-muted-foreground touch:before:absolute touch:before:-inset-2.5");
    expect(css).toContain("@media (pointer: coarse) and (max-width: 1023.98px) { .chip-glide { height: 44px; } }");
    expect(search).toContain("sm:h-9 touch:h-11");
  });
  test("no em dashes in the kit files", () => {
    for (const s of [search, input, pag, refresh, kit, sw, chart, read("components/admin/ui.tsx"), read("components/admin/page-window.ts")]) expect(s.includes("\u2014")).toBe(false);
  });
});
