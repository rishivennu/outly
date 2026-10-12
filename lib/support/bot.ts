import "server-only";
import { listFaq } from "./faq";
import { gemini } from "../ai/creative";

const STOP = new Set("a an the is are am i me my we you your it to of in on for and or do does did can could how what why when where which with this that there be have has was not no yes please hi hello hey outly outlly".split(" "));
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ""));

const SYN: Record<string, string[]> = {
  pay: ["payment", "charge", "bill", "billing", "card", "upi", "money", "paid"],
  invoice: ["receipt", "bill", "gst", "tax"],
  cancel: ["stop", "end", "unsubscribe", "quit"],
  refund: ["money back", "return", "chargeback"],
  password: ["login", "sign in", "signin", "forgot", "reset"],
  upload: ["file", "video", "size", "stuck", "mb"],
  delete: ["remove", "close account"],
  instagram: ["insta", "ig", "reels"],
  youtube: ["yt", "shorts"],
};
function expand(ws: string[]) {
  const out = new Set(ws);
  for (const [k, vs] of Object.entries(SYN)) if (ws.some((w) => w === k || vs.some((v) => v.startsWith(w) || w.startsWith(v)))) out.add(k), vs.forEach((v) => words(v).forEach((x) => out.add(x)));
  return [...out];
}

export const HUMAN_RE = /\b(human|agent|person|real person|someone|talk to (a|an|your)|support team|call me|escalate)\b|इंसान|व्यक्ति|एजेंट|किसी से बात/i;

export interface BotReply {
  answer: string;
  confident: boolean;
  sources: { id: string; question: string }[];
  wantsHuman: boolean;
}

/** FAQ retrieval (keyword + synonyms, BM25-ish), phrased by Gemini when a key is set. */
export type BotLang = "en" | "hi";
const COPY: Record<BotLang, { human: string; unsure: string; name: string }> = {
  en: { human: "Sure, I'll get a person on this. Tell me your email and I'll open a ticket for you.", unsure: "I'm not sure I've got that one right. Could you say it another way? If I still can't help, I'll pass it to our team.", name: "English" },
  hi: { human: "ज़रूर, मैं इसे हमारी टीम के किसी व्यक्ति तक पहुँचाता हूँ। अपना ईमेल बताइए, मैं आपके लिए टिकट खोल दूँगा।", unsure: "मुझे पक्का नहीं कि मैं सही समझा। क्या आप इसे दूसरे शब्दों में पूछ सकते हैं? फिर भी मदद न कर पाया तो मैं इसे हमारी टीम को भेज दूँगा।", name: "Hindi (Devanagari script)" },
};

export async function answer(question: string, history: { role: "user" | "bot"; text: string }[] = [], lang: BotLang = "en"): Promise<BotReply> {
  const L = COPY[lang] ?? COPY.en;
  const q = question.trim().slice(0, 800);
  if (HUMAN_RE.test(q)) return { answer: L.human, confident: false, sources: [], wantsHuman: true };
  const faq = await listFaq();
  const qw = expand(words(q));
  const df = new Map<string, number>();
  const docs = faq.map((f) => ({ f, w: words(`${f.question} ${f.question} ${f.answer} ${f.category}`) }));
  for (const d of docs) for (const w of new Set(d.w)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length || 1;
  const scored = docs
    .map((d) => {
      let s = 0;
      for (const w of qw) {
        const tf = d.w.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
        if (tf) s += (Math.log(1 + N / (df.get(w) ?? 1)) * (tf * 2.2)) / (tf + 1.2);
      }
      return { f: d.f, s };
    })
    .sort((a, b) => b.s - a.s);
  const top = scored.filter((x) => x.s > 0).slice(0, 3);
  const best = top[0];
  const confident = !!best && best.s >= 2.2 && qw.length > 0;

  if (!best || !confident) {
    return {
      answer: L.unsure,
      confident: false,
      sources: top.map((t) => ({ id: t.f.id, question: t.f.question })),
      wantsHuman: false,
    };
  }

  // Gemini rewrites the matched answers into a direct reply. It may ONLY use the provided FAQ text.
  const ai = await gemini<{ answer: string; answered: boolean }>(
    `You are Pip, Outlly's friendly support assistant. Answer ONLY from the FAQ entries given. If they don't answer the question, set answered=false. Keep it under 90 words, plain and warm, no markdown headings. Reply in ${L.name}. Return JSON {"answer": string, "answered": boolean}.`,
    `Recent chat:\n${history.slice(-4).map((h) => `${h.role}: ${h.text}`).join("\n")}\n\nQuestion: ${q}\n\nFAQ:\n${top.map((t) => `Q: ${t.f.question}\nA: ${t.f.answer}`).join("\n\n")}`,
  ).catch(() => null);
  if (ai && typeof ai.answer === "string") {
    return { answer: ai.answer, confident: !!ai.answered, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false };
  }
  return { answer: best.f.answer, confident: true, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false };
}
