import { describe, expect, test } from "bun:test";
import { HUMAN_RE, detectScript, smallTalk } from "../lib/support/smalltalk";
import { LANG_IDS, T, HELP_T } from "../lib/i18n/support";

describe("Pip small talk", () => {
  test("hello gets a friendly greeting with variations", () => {
    const seen = new Set<string>();
    for (const r of [0, 0.3, 0.6, 0.95]) {
      const s = smallTalk("hello", "en", () => r)!;
      expect(s.intent).toBe("greeting");
      seen.add(s.reply);
    }
    expect(seen.size).toBeGreaterThan(2);
    expect([...seen]).toContain("Hi, how are you?");
  });

  test("intents and priorities", () => {
    expect(smallTalk("hi, how are you?")!.intent).toBe("howareyou");
    expect(smallTalk("Thanks a lot Pip!")!.intent).toBe("thanks");
    expect(smallTalk("ok bye")!.intent).toBe("bye");
    expect(smallTalk("who are you?")!.intent).toBe("who");
    expect(smallTalk("I'm good, and you?")!.intent).toBe("fine");
    expect(smallTalk("good morning")!.intent).toBe("greeting");
  });

  test("real questions are left for the FAQ", () => {
    expect(smallTalk("hi, how do I cancel my plan?")).toBeNull();
    expect(smallTalk("hello my upload is stuck")).toBeNull();
    expect(smallTalk("thanks but the video still fails")).toBeNull();
    expect(smallTalk("")).toBeNull();
  });

  test("replies in the language the person wrote", () => {
    expect(smallTalk("hola", "en")!.lang).toBe("es");
    expect(smallTalk("bonjour", "en")!.lang).toBe("fr");
    expect(smallTalk("bien", "fr")!.lang).toBe("fr");
    expect(smallTalk("नमस्ते")!.lang).toBe("hi");
    expect(smallTalk("你好吗")!.intent).toBe("howareyou");
    expect(smallTalk("你好吗")!.lang).toBe("zh");
    expect(smallTalk("こんにちは")!.lang).toBe("ja");
    expect(smallTalk("Привет!")!.lang).toBe("ru");
    expect(smallTalk("مرحبا")!.lang).toBe("ar");
    expect(smallTalk("apa kabar")!.lang).toBe("id");
    expect(smallTalk("নমস্কার")!.lang).toBe("bn");
    expect(smallTalk("Danke schön")!.lang).toBe("de");
    expect(smallTalk("obrigado")!.lang).toBe("pt");
    // English words everyone uses stay in the picked language
    expect(smallTalk("hi", "ja")!.lang).toBe("ja");
    expect(smallTalk("thanks", "es")!.reply).toMatch(/nada|placer|quieras/);
  });

  test("script detection", () => {
    expect(detectScript("मेरा वीडियो")).toBe("hi");
    expect(detectScript("我的视频")).toBe("zh");
    expect(detectScript("動画をアップロード")).toBe("ja");
    expect(detectScript("видео")).toBe("ru");
    expect(detectScript("فيديو")).toBe("ar");
    expect(detectScript("ভিডিও")).toBe("bn");
    expect(detectScript("video")).toBeNull();
  });

  test("asking for a person, many languages", () => {
    for (const s of ["can I talk to a human", "quiero hablar con un humano", "je veux un humain", "Ich möchte mit einem Mitarbeiter sprechen", "转人工", "オペレーターと話したい", "соедините с оператором", "किसी इंसान से बात", "أريد التحدث مع شخص"]) expect(HUMAN_RE.test(s)).toBe(true);
    expect(HUMAN_RE.test("how do I schedule a reel")).toBe(false);
  });

  test("every language has full chat and help copy", () => {
    for (const l of LANG_IDS) {
      expect(T[l].more.length).toBeGreaterThan(3);
      expect(T[l].nudge.length).toBeGreaterThan(3);
      expect(HELP_T[l].title.length).toBeGreaterThan(3);
      expect(smallTalk("hello", l)!.reply.length).toBeGreaterThan(3);
    }
  });
});
