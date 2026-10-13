/** Every question shown in the Help centre must be answered by Pip from its own entry. */
import { describe, expect, test } from "bun:test";
import { listFaq } from "../lib/support/faq";
import { answer } from "../lib/support/bot";

describe("help centre coverage", () => {
  test("each published FAQ question gets its own answer, confidently", async () => {
    const faq = await listFaq();
    expect(faq.length).toBeGreaterThan(10);
    const misses: string[] = [];
    for (const f of faq) {
      const r = await answer(f.question);
      if (!r.confident || r.sources[0]?.id !== f.id || r.smalltalk || r.wantsHuman) misses.push(`${f.question} -> ${r.confident ? r.sources[0]?.question : "UNSURE"}`);
    }
    expect(misses).toEqual([]);
  });
});

describe("help centre coverage: everyday wording", () => {
  const cases: [string, RegExp][] = [
    ["How do I cancel my plan?", /cancel/i],
    ["Where are my invoices?", /invoice/i],
    ["My payment failed", /payment failed/i],
    ["forgot my password", /password/i],
    ["how big can my video be", /limit|big/i],
    ["where are my uploads stored", /uploads live/i],
    ["upload stuck at 90%", /stuck/i],
    ["delete my account", /delete/i],
    ["can i get my money back", /refund/i],
    ["Why did my post fail?", /fails/i],
    ["does it actually post for me", /really publish/i],
    ["instagram setup", /Instagram side/i],
    ["can I post to twitter", /About X/i],
    ["what stats can i see", /analytics/i],
    ["can I export my data", /export/i],
    ["change my email address", /email/i],
    ["which payment methods work", /payment methods/i],
  ];
  for (const [q, want] of cases)
    test(q, async () => {
      const r = await answer(q);
      expect(r.confident).toBe(true);
      expect(r.sources[0]?.question ?? "").toMatch(want);
    });
});
