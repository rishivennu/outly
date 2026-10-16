import { describe, expect, test } from "bun:test";
import { asTags, asText } from "@/lib/ai/creative";
import { savePostSchema } from "@/lib/validation";

describe("AI copy shape drift (Expected string, received array)", () => {
  test("hashtags as an array become one tag string", () => {
    expect(asTags(["#Netflix", "Blockbuster", "#business story", "#"])).toBe("#Netflix #Blockbuster #business #story");
    expect(asTags("#a, #b,c")).toBe("#a #b #c");
    expect(asTags(undefined)).toBe("");
    expect(asTags({ x: 1 })).toBe("");
  });
  test("asText joins arrays and ignores objects", () => {
    expect(asText(["Line one", "Line two"])).toBe("Line one Line two");
    expect(asText(42)).toBe("42");
    expect(asText(null)).toBe("");
  });
  test("save accepts a target whose fields arrived as arrays", () => {
    const r = savePostSchema.safeParse({
      mediaId: "cmvai0nkj0001a9peajj3z8cg",
      title: "Blockbuster",
      targets: [{ platform: "youtube", title: "T #Shorts", description: ["a", "b"], hashtags: ["#Shorts", "#Netflix"], caption: "c" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.targets[0].hashtags).toBe("#Shorts #Netflix");
  });
  test("still rejects real junk", () => {
    expect(savePostSchema.safeParse({ mediaId: "cmvai0nkj0001a9peajj3z8cg", targets: [{ platform: "youtube", hashtags: { a: 1 } }] }).success).toBe(false);
  });
});
