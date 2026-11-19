/**
 * R1225 (perf phase 3, measured with PRISMA_QUERY_LOG=1 on the dev server, the dev-only 15 s sweeper excluded):
 * Home ran 39 queries for the page and its 6 API calls, Analytics 72, Settings 67, Content 68, Accounts 45.
 * - entitlements() was asked 2-3 times per page (Settings: 3 x 7 queries). It is computed once per request now
 *   (React cache, the same way getCurrentUser is), so later asks in the same request share the first.
 * - ensurePlans() read the plan count and four migration markers on every free account's entitlements read. Once
 *   an instance has seen them settled it skips that for ten minutes (production only: tests re-run migrations).
 * - PRISMA_QUERY_LOG=1 turns on Prisma's query log, so a route's cost can be measured instead of guessed.
 * - cachedApi (R1224) shares a request still in flight, so a quiet refresh never doubles a warm-up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1225 one entitlements read per request", () => {
  test("entitlements is wrapped in React cache and still exported under its name", () => {
    const s = src("lib/billing/entitlements.ts");
    expect(s).toContain('import { cache } from "react";');
    expect(s).toContain("export const entitlements = cache(entitlementsNow);");
    expect(s).toContain("async function entitlementsNow(userId: string): Promise<Entitlements> {");
    expect(s).not.toContain("export async function entitlements(");
  });
  test("outside a request the cached function still answers (tests, sweeps)", async () => {
    const { cache } = await import("react");
    let calls = 0;
    const f = cache(async (id: string) => (calls++, `plan-for-${id}`));
    expect(await f("u1")).toBe("plan-for-u1");
    expect(calls).toBeGreaterThan(0);
  });
});

describe("R1225 ensurePlans settles", () => {
  test("skips the two-query check for ten minutes once settled, production only", () => {
    const s = src("lib/billing/plans.ts");
    expect(s).toContain("let settledAt = 0;");
    expect(s).toContain("const SETTLED_MS = 10 * 60_000;");
    expect(s).toContain('if (process.env.NODE_ENV === "production" && Date.now() - settledAt < SETTLED_MS) return Promise.resolve();');
    expect(s).toContain("if (count > 0 && done === MIGRATION_KEYS.length) {\n    settledAt = Date.now();\n    return;\n  }");
  });
});

describe("R1225 query log switch", () => {
  test("PRISMA_QUERY_LOG=1 adds the query log, default stays warn+error", () => {
    const s = src("lib/db.ts");
    expect(s).toContain('const log: ("query" | "warn" | "error")[] = process.env.PRISMA_QUERY_LOG ? ["query", "warn", "error"] : ["warn", "error"];');
    expect(s).toContain("new PrismaClient({ log, ...(url ? { datasources: { db: { url } } } : {}) })");
  });
});
