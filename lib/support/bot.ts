import "server-only";
import { listFaq } from "./faq";
import { gemini } from "../ai/creative";
import type { Lang } from "../i18n/support";
import { HUMAN_RE, detectScript, norm, smallTalk } from "./smalltalk";

const STOP = new Set("a an the is are am i me my we you your it to of in on for and or do does did can could how what why when where which with this that there be have has was not no yes please hi hello hey outly outlly actually really just".split(" "));
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => (w.length > 1 || w === "x") && !STOP.has(w))
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
  x: ["twitter", "tweet", "tweets"],
  platform: ["post", "posted", "posting"],
  private: ["store", "stored", "kept", "saved", "hosted", "safe", "secure", "privacy"],
  limit: ["max", "maximum", "cap", "large", "big", "huge"],
};
/** Other names for the same platform ("twitter" is X): these count in full, not at the synonym discount. */
const ALIAS = new Set(["x", "instagram", "youtube"]);
/** Synonym words for one query word (not the word itself), each with its weight. */
function synonyms(w: string): [string, number][] {
  const out = new Map<string, number>();
  for (const [k, vs] of Object.entries(SYN)) {
    if (!(w === k || vs.some((v) => v.startsWith(w) || w.startsWith(v)))) continue;
    const wt = ALIAS.has(k) && w !== k ? 1 : 0.45;
    out.set(k, Math.max(out.get(k) ?? 0, wt));
    for (const v of vs) for (const x of words(v)) out.set(x, Math.max(out.get(x) ?? 0, 0.45));
  }
  out.delete(w);
  return [...out];
}
function expand(ws: string[]) {
  const out = new Set(ws);
  for (const [k, vs] of Object.entries(SYN)) if (ws.some((w) => w === k || vs.some((v) => v.startsWith(w) || w.startsWith(v)))) out.add(k), vs.forEach((v) => words(v).forEach((x) => out.add(x)));
  return [...out];
}

export { HUMAN_RE };

export interface BotReply {
  answer: string;
  confident: boolean;
  sources: { id: string; question: string }[];
  wantsHuman: boolean;
  /** Greeting, thanks, goodbye and friends: no "Did that help?" and never counts as a miss. */
  smalltalk?: boolean;
  /** Language the reply is written in (may differ from the picker when the person wrote in another script). */
  lang?: Lang;
}

export type BotLang = Lang;
type Copy = { human: string; unsure: string; name: string };
const COPY: Record<Lang, Copy> = {
  en: { human: "Sure, I'll get a person on this. Tell me your email and I'll open a ticket for you.", unsure: "I'm not sure I've got that one right. Could you say it another way? If I still can't help, I'll pass it to our team.", name: "English" },
  hi: { human: "ज़रूर, मैं इसे हमारी टीम के किसी व्यक्ति तक पहुँचाता हूँ। अपना ईमेल बताइए, मैं आपके लिए टिकट खोल दूँगा।", unsure: "मुझे पक्का नहीं कि मैं सही समझा। क्या आप इसे दूसरे शब्दों में पूछ सकते हैं? फिर भी मदद न कर पाया तो मैं इसे हमारी टीम को भेज दूँगा।", name: "Hindi (Devanagari script)" },
  es: { human: "Claro, paso esto a una persona. Dime tu correo y abro un ticket.", unsure: "No estoy seguro de haberlo entendido. ¿Puedes decirlo de otra forma? Si sigo sin poder ayudarte, se lo paso a nuestro equipo.", name: "Spanish" },
  fr: { human: "Bien sûr, je transmets à une personne. Donne-moi ton e-mail et j'ouvre un ticket.", unsure: "Je ne suis pas sûr d'avoir bien compris. Tu peux reformuler ? Si je ne peux toujours pas aider, je transmets à l'équipe.", name: "French" },
  de: { human: "Klar, ich hole eine Person dazu. Nenn mir deine E-Mail und ich eröffne ein Ticket.", unsure: "Ich bin nicht sicher, ob ich das richtig verstanden habe. Kannst du es anders formulieren? Wenn ich dann nicht helfen kann, gebe ich es ans Team weiter.", name: "German" },
  pt: { human: "Claro, vou passar para uma pessoa. Me diga seu e-mail e eu abro um chamado.", unsure: "Não tenho certeza se entendi. Pode dizer de outro jeito? Se ainda não conseguir ajudar, passo para a nossa equipe.", name: "Portuguese (Brazil)" },
  ar: { human: "بالتأكيد، سأحوّل هذا إلى أحد أفراد الفريق. أخبرني ببريدك الإلكتروني وسأفتح لك تذكرة.", unsure: "لست متأكدًا أنني فهمت ذلك. هل يمكنك قولها بطريقة أخرى؟ إن لم أستطع المساعدة، سأحوّلها إلى فريقنا.", name: "Arabic (Modern Standard)" },
  zh: { human: "好的，我帮你转给真人客服。告诉我你的邮箱，我来为你创建工单。", unsure: "我不太确定理解对了。能换个说法吗？如果还是帮不上忙，我会转给我们的团队。", name: "Simplified Chinese" },
  ja: { human: "わかりました、担当者につなぎます。メールアドレスを教えてください。チケットを作成します。", unsure: "うまく理解できたか自信がありません。別の言い方で聞いてもらえますか？それでも難しければ、チームに引き継ぎます。", name: "Japanese" },
  ru: { human: "Конечно, передам это человеку. Напишите ваш e-mail, и я создам обращение.", unsure: "Не уверен, что правильно понял. Можете сформулировать иначе? Если всё равно не смогу помочь, передам команде.", name: "Russian" },
  id: { human: "Tentu, aku teruskan ke tim kami. Kasih tahu email kamu dan aku buatkan tiket.", unsure: "Aku belum yakin paham maksudnya. Bisa dijelaskan dengan cara lain? Kalau masih belum bisa, aku teruskan ke tim kami.", name: "Indonesian" },
  bn: { human: "অবশ্যই, আমি এটা আমাদের টিমের কাউকে দিচ্ছি। আপনার ইমেল দিন, আমি একটি টিকিট খুলে দিচ্ছি।", unsure: "ঠিক বুঝেছি কিনা নিশ্চিত নই। অন্যভাবে বলবেন? তবুও সাহায্য করতে না পারলে আমাদের টিমকে পাঠিয়ে দেব।", name: "Bengali" },
};

/** Turns a non-English question into English search words so the English FAQ can match it. */
async function toEnglish(q: string) {
  const r = await gemini<{ en: string }>(
    `Translate the user's support question into plain English. Keep product names. Return JSON {"en": string}.`,
    q,
  ).catch(() => null);
  return r && typeof r.en === "string" ? r.en.slice(0, 800) : null;
}

/** FAQ retrieval (keyword + synonyms, BM25-ish), phrased by Gemini when a key is set. */
export async function answer(question: string, history: { role: "user" | "bot"; text: string }[] = [], lang: Lang = "en"): Promise<BotReply> {
  const q = question.trim().slice(0, 800);
  const chat = small(q, lang);
  if (chat) return chat;
  // Someone typing in another script gets answered in that script, whatever the picker says.
  const use: Lang = detectScript(q) ?? (COPY[lang] ? lang : "en");
  const L = COPY[use];
  if (HUMAN_RE.test(q) || HUMAN_RE.test(norm(q))) return { answer: L.human, confident: false, sources: [], wantsHuman: true, lang: use };
  let r = await rank(q);
  if ((!r.best || !r.confident) && (use !== "en" || /[^\x00-\x7f]/.test(q))) {
    const en = await toEnglish(q);
    if (en) r = await rank(en);
  }
  const { top, best, confident } = r;
  if (!best || !confident) {
    return { answer: L.unsure, confident: false, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false, lang: use };
  }

  // Gemini rewrites the matched answers into a direct reply. It may ONLY use the provided FAQ text.
  const ai = await gemini<{ answer: string; answered: boolean }>(
    `You are Pip, Outlly's friendly support assistant. Answer ONLY from the FAQ entries given. If they don't answer the question, set answered=false. Keep it under 90 words, plain and warm, no markdown headings. Reply in ${L.name}. Return JSON {"answer": string, "answered": boolean}.`,
    `Recent chat:\n${history.slice(-4).map((h) => `${h.role}: ${h.text}`).join("\n")}\n\nQuestion: ${q}\n\nFAQ:\n${top.map((t) => `Q: ${t.f.question}\nA: ${t.f.answer}`).join("\n\n")}`,
  ).catch(() => null);
  if (ai && typeof ai.answer === "string") {
    return { answer: ai.answer, confident: !!ai.answered, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false, lang: use };
  }
  return { answer: best.f.answer, confident: true, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false, lang: "en" };
}

function small(q: string, lang: Lang): BotReply | null {
  const s = smallTalk(q, lang);
  return s && { answer: s.reply, confident: true, smalltalk: true, sources: [], wantsHuman: false, lang: s.lang };
}

export async function rank(q: string) {
  const faq = await listFaq();
  const own = words(q);
  // "twitter" -> "x", "insta" -> "instagram": the platform's own name, for the title comparison below
  const canon = own.map((w) => [...ALIAS].find((k) => SYN[k].some((v) => v === w || (w.length > 2 && v.startsWith(w)))) ?? w);
  // synonyms widen recall but count for less than the person's own words, so "upload" doesn't drag
  // every question about uploads onto "My upload is stuck"
  const qw = expand(own);
  const hit = (list: string[], w: string) => list.some((x) => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x) && x.length > 3)));
  const df = new Map<string, number>();
  const docs = faq.map((f) => {
    const title = words(f.question);
    return { f, title, w: [...title, ...title, ...words(`${f.answer} ${f.category}`)] };
  });
  for (const d of docs) for (const w of new Set(d.w)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length || 1;
  const scored = docs
    .map((d) => {
      const term = (w: string) => {
        const tf = d.w.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
        return tf ? (Math.log(1 + N / (df.get(w) ?? 1)) * (tf * 2.2)) / (tf + 1.2) : 0;
      };
      // each word the person typed counts once: itself, or else its single best synonym at a discount
      let s = 0;
      for (const w of own) s += Math.max(term(w), ...synonyms(w).map(([x, wt]) => term(x) * wt));
      // the Help centre question itself (or close to it): how much of it the person's words cover, both ways
      if (own.length && d.title.length) {
        const a = canon.filter((w) => hit(d.title, w)).length / canon.length;
        const b = d.title.filter((w) => hit(canon, w)).length / d.title.length;
        s += 6 * a * b;
      }
      return { f: d.f, s };
    })
    .sort((a, b) => b.s - a.s);
  const top = scored.filter((x) => x.s > 0).slice(0, 3);
  const best = top[0];
  const confident = !!best && best.s >= 2.2 && qw.length > 0;
  return { top, best, confident };
}
