import { describe, expect, it } from "bun:test";
import { ROWS, ROW_GROUPS, COMPETITORS } from "@/lib/marketing/comparison";

describe("comparison table data", () => {
  it("groups cover every row exactly once", () => {
    expect(ROW_GROUPS.reduce((n, g) => n + g.rows, 0)).toBe(ROWS.length);
  });
  it("every row has a cell for every competitor", () => {
    for (const r of ROWS) for (const c of COMPETITORS) expect(r.cells[c.id]).toBeDefined();
  });
});
