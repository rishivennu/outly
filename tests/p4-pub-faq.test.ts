/** P4 item 6: the Music and copyright note on Create lands on a real Help centre entry that ships by default. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { ensureFaq, FAQ_ANCHORS, invalidateFaq, listFaq, MUSIC_FAQ } from "../lib/support/faq";
import { answer } from "../lib/support/bot";
import { MUSIC_HELP } from "../components/create/MusicNote";

const src = (p: string) => readFileSync(p, "utf8");

describe("music FAQ entry", () => {
  test("ships in the published FAQ under Publishing", async () => {
    invalidateFaq();
    const faq = await listFaq();
    const row = faq.find((f) => f.question === MUSIC_FAQ.q);
    expect(row).toBeTruthy();
    expect(row!.category).toBe("Publishing");
    expect(row!.published).toBe(true);
  });

  test("covers what Instagram and YouTube flag, original audio and a muted post, in plain words", () => {
    const a = MUSIC_FAQ.a;
    for (const w of ["Instagram", "YouTube", "copyright claim", "Original audio is safest", "mutes a post", "can't add music"]) expect(a).toContain(w);
    expect(a + MUSIC_FAQ.q).not.toMatch(/[\u2013\u2014]/);
  });

  test("the Music and copyright link opens exactly this entry", () => {
    const key = new URL(MUSIC_HELP, "https://x.test").searchParams.get("faq");
    expect(key).toBe("music");
    expect(FAQ_ANCHORS[key!]).toBe(MUSIC_FAQ.q);
    const page = src("app/(marketing)/help/page.tsx");
    expect(page).toContain("FAQ_ANCHORS[searchParams.faq]");
    expect(page).toContain("initialOpen={openId}");
    // the default shows even if the row is missing
    expect(page).toContain('id: "default-music"');
    const hc = src("components/support/HelpCenter.tsx");
    expect(hc).toContain("useState<string | null>(initialOpen ?? null)");
  });

  test("Pip answers a music question from this entry", async () => {
    invalidateFaq();
    const faq = await listFaq();
    const id = faq.find((f) => f.question === MUSIC_FAQ.q)!.id;
    for (const q of ["Will music in my video get it muted?", "my reel got muted because of the song"]) {
      const r = await answer(q);
      expect(r.sources[0]?.id, q).toBe(id);
    }
  });

  test("an FAQ table seeded before the entry existed gets it once; an admin delete then sticks", async () => {
    await db.faqItem.deleteMany({ where: { question: MUSIC_FAQ.q } });
    await db.setting.deleteMany({ where: { key: "migrate:faq-music-p4" } });
    await ensureFaq();
    expect(await db.faqItem.count({ where: { question: MUSIC_FAQ.q } })).toBe(1);
    await ensureFaq();
    expect(await db.faqItem.count({ where: { question: MUSIC_FAQ.q } })).toBe(1);
    await db.faqItem.deleteMany({ where: { question: MUSIC_FAQ.q } });
    await ensureFaq();
    expect(await db.faqItem.count({ where: { question: MUSIC_FAQ.q } })).toBe(0);
    // put it back for anything else reading this database
    await db.faqItem.create({ data: { category: MUSIC_FAQ.category, question: MUSIC_FAQ.q, answer: MUSIC_FAQ.a, sortOrder: 200 } });
    invalidateFaq();
  });
});
