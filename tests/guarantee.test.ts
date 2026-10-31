/** The 30-day money-back guarantee window (1076). */
import { describe, expect, test } from "bun:test";
import { GUARANTEE_DAYS, refundWindow, type GuaranteePayment } from "@/lib/billing/guarantee-core";

const DAY = 86_400_000;
const t0 = new Date("2026-10-01T10:00:00Z");
const pay = (over: Partial<GuaranteePayment> = {}): GuaranteePayment => ({ id: "p1", status: "succeeded", provider: "razorpay", amountMinor: 49900, currency: "INR", createdAt: t0, ...over });
const at = (days: number) => new Date(+t0 + days * DAY);

describe("refundWindow", () => {
  test("no payments means nothing to refund", () => {
    expect(refundWindow([], at(1)).state).toBe("none");
  });
  test("failed and pending payments don't count", () => {
    expect(refundWindow([pay({ status: "failed" }), pay({ id: "p2", status: "pending" })], at(1)).state).toBe("none");
  });
  test("sample payments are ignored", () => {
    expect(refundWindow([pay({ sample: true })], at(1)).state).toBe("none");
  });
  test("first payment inside 30 days is eligible", () => {
    const w = refundWindow([pay()], at(5));
    expect(w.state).toBe("eligible");
    if (w.state !== "eligible") return;
    expect(w.paymentId).toBe("p1");
    expect(w.amountMinor).toBe(49900);
    expect(w.currency).toBe("INR");
    expect(+w.until).toBe(+t0 + GUARANTEE_DAYS * DAY);
    expect(w.daysLeft).toBe(25);
    expect(w.manual).toBe(false);
  });
  test("daysLeft rounds up and never shows zero", () => {
    const w = refundWindow([pay()], new Date(+at(30) - 60_000));
    expect(w.state === "eligible" && w.daysLeft).toBe(1);
    const w2 = refundWindow([pay()], new Date(+at(4) + 3_600_000));
    expect(w2.state === "eligible" && w2.daysLeft).toBe(26);
  });
  test("day 30 exactly has expired", () => {
    expect(refundWindow([pay()], at(30)).state).toBe("expired");
    expect(refundWindow([pay()], at(45)).state).toBe("expired");
  });
  test("a refund anywhere uses the guarantee up", () => {
    expect(refundWindow([pay({ status: "refunded" })], at(2)).state).toBe("used");
    expect(refundWindow([pay({ status: "refunded" }), pay({ id: "p2", createdAt: at(40) })], at(41)).state).toBe("used");
  });
  test("a second payment (renewal or switch) voids it", () => {
    expect(refundWindow([pay(), pay({ id: "p2", createdAt: at(10) })], at(11)).state).toBe("renewed");
  });
  test("UPI through YOUPI goes to a person", () => {
    const w = refundWindow([pay({ provider: "youpi" })], at(3));
    expect(w.state === "eligible" && w.manual).toBe(true);
  });
  test("order of input doesn't matter", () => {
    const w = refundWindow([pay({ id: "late", status: "failed", createdAt: at(3) }), pay()], at(4));
    expect(w.state === "eligible" && w.paymentId).toBe("p1");
  });
});
