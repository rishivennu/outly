import { describe, expect, test } from "bun:test";
import { liveSummary, platformFormatLabel, postWords } from "@/lib/client/post-words";

const src = (p: string) => Bun.file(p).text();

describe("1135: the sending screen names what is actually going out", () => {
  test("words per format", () => {
    expect(postWords("video").your).toBe("Your video");
    expect(postWords(null).sending).toBe("Sending your video.");
    expect(postWords("carousel", 7)).toMatchObject({ your: "Your carousel", sending: "Sending your carousel.", count: "7 slides" });
    expect(postWords("photo", 1)).toMatchObject({ your: "Your photo", count: null });
    expect(postWords("story", 1).where).toBe("Where your story is going");
  });
  test("a photo post is never called a Reel", () => {
    expect(platformFormatLabel("Reel", "carousel")).toBe("Carousel");
    expect(platformFormatLabel("Reel", "photo")).toBe("Photo");
    expect(platformFormatLabel("Reel", "story")).toBe("Story");
    expect(platformFormatLabel("Reel", "video")).toBe("Reel");
    expect(platformFormatLabel("Short", undefined)).toBe("Short");
  });
  test("summary never says all 1 places", () => {
    expect(liveSummary(1, 1, "Instagram")).toBe("Live on Instagram");
    expect(liveSummary(0, 1, "Instagram")).toBe("Not live on Instagram yet");
    expect(liveSummary(3, 3)).toBe("Live in all 3 places");
    expect(liveSummary(2, 3)).toBe("Live in 2 of 3");
  });
  test("PublishingView uses the words, not hard-coded video copy", async () => {
    const s = await src("components/create/PublishingView.tsx");
    expect(s).not.toContain(">Your video<");
    expect(s).not.toContain('aria-label="Where your video is going"');
    expect(s).toContain("{words.your}");
    expect(s).toContain("platformFormatLabel(meta.format, post.format)");
    expect(s).toContain("liveSummary(");
    expect(s).toContain("<SlideStack");
  });
  test("photo stack motion stops for reduced motion", async () => {
    const css = await src("app/globals.css");
    const marker = css.indexOf("1100: Liquid glass");
    const at = css.indexOf(".la-stack-anim .la-print{animation:la-deal");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(marker);
    expect(css).toContain(".la-stack-anim .la-print{animation:none}");
  });
});
