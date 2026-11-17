import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LANGS, PIP_DATA, T, pipHome } from "@/lib/i18n/support";
import { LIVE_EN } from "@/lib/i18n/live";
import { HUMAN_RE } from "@/lib/support/smalltalk";

const widget = readFileSync("components/support/ChatWidget.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("R1189 Pip welcome: four topics, not a FAQ list", () => {
  test("English topics and questions match the brief", () => {
    const h = pipHome("en");
    expect(h.ask).toBe("What can I help you with today?");
    expect(h.topics.map((x) => [x.id, x.title, x.line])).toEqual([
      ["analytics", "Your Analytics", "Views, reach, growth, engagement and performance."],
      ["publishing", "Publishing & Content", "Failed posts, scheduling, captions and content creation."],
      ["billing", "Account & Billing", "Subscription plans, payments, invoices and account settings."],
      ["human", "Human Support", "Connect with an Outlly support specialist."],
    ]);
    expect(h.topics.map((x) => x.questions)).toEqual([
      ["How many views did I get this week?", "Compare my Instagram and YouTube performance.", "When is my best time to post?"],
      ["Why did my post fail?", "Where can I see scheduled posts?", "How do I improve my caption?"],
      ["How do I change my plan?", "Where can I find my invoices?", "Why did my payment fail?"],
      ["Connect me with a support specialist.", "Check my existing support ticket."],
    ]);
  });
  test("every language: four topics, at most three questions up front, no dashes", () => {
    for (const l of LANGS) {
      const h = pipHome(l.id);
      expect({ l: l.id, n: h.topics.length }).toEqual({ l: l.id, n: 4 });
      for (const x of h.topics) {
        expect({ l: l.id, id: x.id, ok: x.questions.length >= 2 && x.questions.length <= 3 }).toEqual({ l: l.id, id: x.id, ok: true });
        for (const s of [x.title, x.line, ...x.questions, ...x.more]) expect({ s, dash: /[\u2013\u2014]/.test(s) }).toEqual({ s, dash: false });
      }
      for (const s of [h.ask, h.more, h.fewer, h.back, h.signIn, h.signInBtn, h.label]) expect(s.length).toBeGreaterThan(0);
    }
  });
  test("nothing from the old starter lists is lost: it moves under More questions", () => {
    const en = pipHome("en");
    const all = en.topics.flatMap((x) => [...x.questions, ...x.more]);
    for (const q of PIP_DATA.en!.suggestions.filter((q) => !/views did I get|Compare|best time/i.test(q))) expect(all).toContain(q);
    expect(all).toContain("How do I cancel my subscription?");
    for (const l of LANGS.filter((x) => x.id !== "en")) expect(pipHome(l.id).topics.find((x) => x.id === "billing")!.more).toContain(T[l.id].suggestions[0]);
  });
  test("the connect question in every language counts as asking for a person", () => {
    for (const l of LANGS) {
      const q = pipHome(l.id).topics.find((x) => x.id === "human")!.questions[0];
      expect({ q, human: HUMAN_RE.test(q) }).toEqual({ q, human: true });
    }
    expect(HUMAN_RE.test("how do I schedule a post")).toBe(false);
  });
});

describe("R1189 widget: one welcome, then only the conversation", () => {
  test("the welcome and the topics render only before the first message", () => {
    expect(widget).toContain('{msgs.length === 0 && (<div className="pc-home">');
    expect(widget).toContain('{cx.welcome} <span aria-hidden>👋</span>');
    expect(widget).toContain("{home.ask}");
    // The two long starter lists are gone.
    expect(widget).not.toContain("pc-yours");
    expect(widget).not.toContain("pc-pop");
    expect(widget).not.toContain("{t.hello}");
  });
  test("a topic shows three questions, More questions reveals the rest, Back returns focus", () => {
    expect(widget).toContain("(allQs ? [...tp.questions, ...tp.more] : tp.questions)");
    expect(widget).toContain("aria-expanded={allQs}");
    expect(widget).toContain("topicRefs.current[was]?.focus");
    expect(widget).toContain("backRef.current?.focus");
    expect(widget).toContain("setTopic(null); setAllQs(false);");
  });
  test("questions become the person's message; Connect goes to the real handoff", () => {
    expect(widget).toMatch(/if \(id === "human" && i === 0\) \{\s+push\(\{ role: "user", text: q \}\);\s+return escalate\(\);/);
    expect(widget).toMatch(/function pick[\s\S]{0,300}send\(q\);/);
    expect(LIVE_EN.offer).toContain("Would you like me to connect you with a human support specialist?");
  });
  test("visitors are asked to sign in for analytics instead of getting invented numbers", () => {
    expect(widget).toContain('tp.id === "analytics" && !signedIn ?');
    expect(widget).toContain('href="/login?next=/analytics"');
  });
  test("attention cards and insights stay, compact, only on the welcome", () => {
    expect(widget).toContain("shown.slice(0, 2).map");
    expect(widget).toContain("nudges.slice(0, 1).map");
    expect(widget.indexOf('{msgs.length === 0 && (<div className="pc-home">')).toBeLessThan(widget.indexOf('aria-labelledby="pc-att"'));
    expect(widget.indexOf('aria-labelledby="pc-worth"')).toBeLessThan(widget.indexOf("</div>)}"));
  });
  test("at most three follow-ups under an answer; header, composer and language as briefed", () => {
    expect(widget).toContain("m.sources.slice(0, 3).map");
    expect(T.en.title).toBe("Pip from Outlly");
    expect(widget).toContain('if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing)');
    expect(widget).toContain("writeLang(l)");
    expect(widget).toContain('className="pc-lang relative inline-flex h-11 shrink-0 items-center"');
    expect(widget).toContain("{t.faqLink}");
    expect(T.en.faqLink).toBe("All help questions");
  });
});

describe("R1189 style: Outlly lime, contrast kept", () => {
  test("lime is the fill; rings and edges use the darker ink", () => {
    expect(css).toContain(".pc { --pc-accent: hsl(var(--lime));");
    expect(css).toContain("--pc-on-accent: hsl(var(--lime-foreground)); --pc-ring: hsl(var(--lime-ink));");
    expect(css).toContain(".pc :focus-visible { outline: 2px solid transparent; box-shadow: 0 0 0 2px var(--pc-solid), 0 0 0 4px var(--pc-ring); }");
    expect(css).not.toContain("#5b4bf5");
    expect(css).toContain(".pc .pc-row:focus-visible { box-shadow: inset 0 0 0 2px var(--pc-ring); }");
  });
});

describe("R1189 phone sheet and status", () => {
  test("banners at z-60 step aside while the chat fills a phone", () => {
    expect(css).toContain("@media (max-width: 767.98px) { html:has(.pc-dock[data-open]) .consent-in { display: none; } }");
  });
  test("every language says Online, not a response-time promise", () => {
    for (const l of LANGS) expect(T[l.id].status.length).toBeLessThan(14);
    expect(T.es.status).toBe("En línea");
  });
});
