import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isFinal, receiptKey, receiptState } from "@/lib/billing/receipt-core";

describe("1053 payment receipt", () => {
  test("the slip follows the database status, never the URL", () => {
    expect(receiptState("succeeded")).toBe("paid");
    expect(receiptState("pending")).toBe("pending");
    expect(receiptState("failed")).toBe("failed");
    expect(receiptState("failed", true)).toBe("cancelled");
    expect(receiptState("pending", true)).toBe("cancelled");
    expect(receiptState("refunded")).toBeNull();
    expect(receiptState("anything")).toBeNull();
  });
  test("each outcome animates once per payment", () => {
    expect(receiptKey({ paymentId: "p1", state: "paid" })).toBe("outlly-receipt:p1:paid");
    expect(receiptKey({ paymentId: "p1", state: "paid" })).not.toBe(receiptKey({ paymentId: "p1", state: "failed" }));
    expect(isFinal("pending")).toBe(false);
    expect(isFinal("paid") && isFinal("failed") && isFinal("cancelled")).toBe(true);
  });
  test("receipts are owner only and read from our own payment row", () => {
    const lib = readFileSync("lib/billing/receipt.ts", "utf8");
    expect(lib).toContain("where: { id: paymentId, userId }");
    const api = readFileSync("app/api/billing/payments/[id]/route.ts", "utf8");
    expect(api).toContain("user.actor");
    expect(api).not.toMatch(/export const (POST|PATCH|PUT|DELETE)/);
    const page = readFileSync("app/(studio)/billing/page.tsx", "utf8");
    expect(page).toContain("receiptFor(user.id, searchParams, cancelledId)");
  });
  test("reduced motion shows the slip finished", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.rcpt-print, \.rcpt-row, \.rcpt-stamp-in \{ animation: none; \} \}/);
  });
});
