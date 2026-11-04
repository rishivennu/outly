import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Answer } from "../components/support/Answer";

const read = (p: string) => readFileSync(p, "utf8");
const html = (text: string, emphasis = true) => renderToStaticMarkup(createElement(Answer, { text, emphasis }));
const bold = (h: string) => [...h.matchAll(/<strong class="pc-num">([^<]+)<\/strong>/g)].map((m) => m[1]);

describe("1125 Pip typography: Poppins inside Pip only", () => {
  const font = read("components/support/font.ts");
  const css = read("app/globals.css");
  const widget = read("components/support/ChatWidget.tsx");
  test("Poppins is loaded for Pip with every weight the hierarchy uses, not preloaded", () => {
    expect(font).toContain('from "next/font/google"');
    expect(font).toMatch(/Poppins\(\{[^}]*weight: \["400", "500", "600", "700", "800"\]/);
    expect(font).toContain('variable: "--font-pip"');
    expect(font).toContain("preload: false");
    expect(font).toContain('"devanagari"');
  });
  test("the font is scoped to the Pip panel; the site keeps its own font", () => {
    expect(widget).toContain('cn(pipFont.variable, "pc fixed');
    expect(css).toMatch(/\.pc, \.pc :is\([^)]*\) \{ font-family: var\(--font-pip\), var\(--font-body\)/);
    expect(read("app/layout.tsx")).not.toMatch(/Poppins/);
    expect(css).not.toMatch(/(^|\n)(body|html|:root)[^{]*\{[^}]*--font-pip/);
  });
  test("weights follow the hierarchy", () => {
    expect(widget).toContain('className="pc-display mt-2 text-[19px] font-extrabold"');
    expect(widget).toContain('id="pc-title" className="truncate text-[15px] font-bold');
    expect(css).toContain(".pc .pc-num { font-weight: 700;");
    expect(css).toContain(".pc .pc-eyebrow { font-weight: 600;");
    expect(css).toContain(".pc .pc-muted { font-weight: 500; }");
    expect(css).toMatch(/\.pc \.pc-bubble \{ font-size: 14\.5px; line-height: 1\.6; font-weight: 400; \}/);
    expect(css).toMatch(/@media \(max-width: 639px\) \{ \.pc \.pc-bubble/);
  });
  test("only data answers get emphasis; FAQ answers render as before", () => {
    expect(widget).toContain("<Answer text={m.text} emphasis={!!m.data} />");
    expect(html("You got 94,500 views.", false)).not.toContain("pc-num");
  });
});

describe("1125 bold numbers in Pip data answers", () => {
  test("metrics are bold: counts, rates, changes, multiples, money", () => {
    const h = html("You got 94,500 views and a 7.1% engagement rate, up +12% on last month. Reels did 2.3x your usual and earned \u20b91,250 from 14 posts.");
    expect(bold(h)).toEqual(["94,500 views", "7.1%", "+12%", "2.3x", "\u20b91,250", "14 posts"]);
  });
  test("dates and years in a range stay regular, and a full stop is not part of the number", () => {
    const h = html("From Oct 1, 2026 to Oct 31, 2026 you posted 9 posts.");
    expect(bold(h)).toEqual(["9 posts"]);
    expect(h).toContain("9 posts</strong>.");
    // A time span is the question's frame, not a result.
    expect(bold(html("In the last 90 days you had 94,500 views over 12 weeks."))).toEqual(["94,500 views"]);
  });
  test("a rate written out in words is bold as a whole", () => {
    expect(bold(html("Your engagement rate was 7.1 percent, up 2 points."))).toEqual(["7.1 percent", "2 points"]);
  });
  test("the first sentence of a longer answer is the takeaway; one sentence is not all made heavy", () => {
    const two = html("Instagram did best with 7.1% engagement. YouTube had more views.");
    expect(two).toMatch(/<span class="pc-lead">Instagram did best with <strong class="pc-num">7\.1%<\/strong> engagement\.<\/span> YouTube/);
    expect(html("You posted 12 posts this month.")).not.toContain("pc-lead");
  });
  test("markdown bold and links still work alongside number emphasis, and nothing is injected as HTML", () => {
    const h = html("See **your best post** with 3,200 views [here](/analytics). <b>x</b>");
    expect(h).toContain(">your best post</strong>");
    expect(bold(h)).toEqual(["3,200 views"]);
    expect(h).toContain('href="/analytics"');
    expect(h).toContain("&lt;b&gt;");
  });
});

describe("1125 short footer: one reconnect line, clean handles", () => {
  test("handles never double the @, and page names with spaces get none", async () => {
    const { at } = await import("../lib/pip/tools-core");
    expect(at("maya_rao")).toBe("@maya_rao");
    expect(at("@maya_rao")).toBe("@maya_rao");
    expect(at("Maya Rao Studio")).toBe("Maya Rao Studio");
    expect(at("")).toBe("");
  });
  test("accounts needing a reconnect are named together, once", () => {
    const src = read("lib/pip/tools-content.ts");
    expect(src).toContain("relink.push(who)");
    expect(src).toContain("relinkNote(relink)");
    expect(src).not.toContain("needs reconnecting before its numbers can be read.");
    expect(read("lib/pip/tools-analytics.ts") + src).not.toMatch(/@\$\{/);
  });
});

describe("1125 a report names each account to reconnect once", () => {
  test("several reconnect lines fold into one, keeping order and other warnings", async () => {
    const { mergeRelink, relinkNote } = await import("../lib/pip/tools-core");
    const notes = [
      { level: "info" as const, text: "How this works." },
      relinkNote(["X @maya_rao", "Instagram @maya.food", "YouTube Maya Rao Vlogs"]),
      { level: "warn" as const, text: "The trend part couldn't be worked out just now." },
      relinkNote(["Instagram @maya.food", "Instagram @maya.travels"]),
      relinkNote(["Facebook Maya Rao Studio"]),
    ];
    const out = mergeRelink(notes);
    expect(out.map((n) => n.text)).toEqual([
      "How this works.",
      "Reconnect 5 accounts to read their numbers: X @maya_rao, Instagram @maya.food, YouTube Maya Rao Vlogs, Instagram @maya.travels, Facebook Maya Rao Studio.",
      "The trend part couldn't be worked out just now.",
    ]);
    expect(mergeRelink([relinkNote(["X @a"])])[0].text).toBe("Reconnect X @a to read its numbers.");
    expect(read("lib/pip/tools.ts")).toContain("r.notes = mergeRelink(r.notes);");
  });
});
