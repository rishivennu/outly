/** AI reply suggestions: the offline drafts read the comment's intent, stay in the platform limit, and Gemini is optional. */
import { describe, expect, test } from "bun:test";
import { classify, offlineReplies, suggestReplies } from "../lib/ai/replies";

describe("reply suggestions", () => {
  test("classifies intent", () => {
    expect(classify("How did you edit this?")).toBe("question");
    expect(classify("please do a part 2")).toBe("request");
    expect(classify("this is clickbait")).toBe("critique");
    expect(classify("love this 🔥")).toBe("praise");
    expect(classify("first")).toBe("other");
  });

  test("offline drafts use the first name and stay distinct", () => {
    const r = offlineReplies("this was so helpful, thanks!", "@maya.k", "instagram");
    expect(r.source).toBe("studio");
    expect(r.suggestions).toHaveLength(3);
    expect(r.suggestions[0].text).toContain("Maya");
    expect(new Set(r.suggestions.map((s) => s.text)).size).toBe(3);
  });

  test("no name still reads cleanly", () => {
    for (const s of offlineReplies("what mic?", "", "x").suggestions) {
      expect(s.text).not.toMatch(/^[,\s]/);
      expect(s.text).not.toMatch(/\s[,!]/);
      expect(s.text.length).toBeLessThanOrEqual(280);
    }
  });

  test("falls back to offline drafts when Gemini is unavailable", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const r = await suggestReplies({ comment: "where did you film this?", author: "Ravi", platform: "youtube" });
    expect(r.intent).toBe("question");
    expect(r.suggestions.length).toBe(3);
    globalThis.fetch = real;
  });
});
