import "server-only";
import { listFaq } from "./faq";
import { gemini } from "../ai/creative";
import { env } from "../env";
import { productBrief } from "./knowledge";
import type { Lang } from "../i18n/support";
import { HUMAN_RE, detectScript, smallTalk } from "./smalltalk";
import { wantsHuman } from "./intent";

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
  en: { human: "I can pass this to our support team. You're not signed in, so they'll reply by email.", unsure: "I'm not sure I've got that one right. Could you say it another way? If I still can't help, I'll pass it to our team.", name: "English" },
  hi: { human: "मैं इसे हमारी सपोर्ट टीम तक पहुँचा सकता हूँ। आप साइन इन नहीं हैं, इसलिए वे ईमेल से जवाब देंगे।", unsure: "मुझे पक्का नहीं कि मैं सही समझा। क्या आप इसे दूसरे शब्दों में पूछ सकते हैं? फिर भी मदद न कर पाया तो मैं इसे हमारी टीम को भेज दूँगा।", name: "Hindi (Devanagari script)" },
  es: { human: "Puedo pasar esto a nuestro equipo de soporte. No has iniciado sesión, así que te responderán por correo.", unsure: "No estoy seguro de haberlo entendido. ¿Puedes decirlo de otra forma? Si sigo sin poder ayudarte, se lo paso a nuestro equipo.", name: "Spanish" },
  fr: { human: "Je peux transmettre ça à notre équipe d'assistance. Tu n'es pas connecté, elle te répondra donc par e-mail.", unsure: "Je ne suis pas sûr d'avoir bien compris. Tu peux reformuler ? Si je ne peux toujours pas aider, je transmets à l'équipe.", name: "French" },
  de: { human: "Ich kann das an unser Support-Team weitergeben. Du bist nicht angemeldet, deshalb antwortet es per E-Mail.", unsure: "Ich bin nicht sicher, ob ich das richtig verstanden habe. Kannst du es anders formulieren? Wenn ich dann nicht helfen kann, gebe ich es ans Team weiter.", name: "German" },
  pt: { human: "Posso passar isso para a nossa equipe de suporte. Você não está conectado, então eles respondem por e-mail.", unsure: "Não tenho certeza se entendi. Pode dizer de outro jeito? Se ainda não conseguir ajudar, passo para a nossa equipe.", name: "Portuguese (Brazil)" },
  ar: { human: "يمكنني تحويل هذا إلى فريق الدعم. أنت غير مسجّل الدخول، لذا سيردّون عبر البريد الإلكتروني.", unsure: "لست متأكدًا أنني فهمت ذلك. هل يمكنك قولها بطريقة أخرى؟ إن لم أستطع المساعدة، سأحوّلها إلى فريقنا.", name: "Arabic (Modern Standard)" },
  zh: { human: "我可以把这个转给支持团队。你还没有登录，所以他们会通过邮件回复。", unsure: "我不太确定理解对了。能换个说法吗？如果还是帮不上忙，我会转给我们的团队。", name: "Simplified Chinese" },
  ja: { human: "サポートチームにお伝えできます。ログインしていないため、返信はメールで届きます。", unsure: "うまく理解できたか自信がありません。別の言い方で聞いてもらえますか？それでも難しければ、チームに引き継ぎます。", name: "Japanese" },
  ru: { human: "Я могу передать это нашей службе поддержки. Вы не вошли в аккаунт, поэтому ответ придёт по электронной почте.", unsure: "Не уверен, что правильно понял. Можете сформулировать иначе? Если всё равно не смогу помочь, передам команде.", name: "Russian" },
  id: { human: "Aku bisa meneruskan ini ke tim support. Kamu belum masuk, jadi mereka akan membalas lewat email.", unsure: "Aku belum yakin paham maksudnya. Bisa dijelaskan dengan cara lain? Kalau masih belum bisa, aku teruskan ke tim kami.", name: "Indonesian" },
  bn: { human: "আমি এটা আমাদের সাপোর্ট টিমকে পাঠাতে পারি। আপনি সাইন ইন করেননি, তাই তারা ইমেলে উত্তর দেবে।", unsure: "ঠিক বুঝেছি কিনা নিশ্চিত নই। অন্যভাবে বলবেন? তবুও সাহায্য করতে না পারলে আমাদের টিমকে পাঠিয়ে দেব।", name: "Bengali" },
};

/** Turns a non-English question into English search words so the English FAQ can match it. */
async function toEnglish(q: string) {
  const r = await gemini<{ en: string }>(
    `Translate the user's support question into plain English. Keep product names. Return JSON {"en": string}.`,
    q,
    { meter: { feature: "support-chat" } },
  ).catch(() => null);
  return r && typeof r.en === "string" ? r.en.slice(0, 800) : null;
}

/**
 * A help question picked from the chat (a Related chip or the in-chat question list): answer that exact
 * FAQ entry inside the chat, no guessing. Other languages get it translated, with the English text as fallback.
 */
export async function answerFaq(id: string, lang: Lang = "en", allowAi = true): Promise<BotReply | null> {
  const faq = await listFaq();
  const f = faq.find((x) => x.id === id);
  if (!f) return null;
  // Same contract as answer(): sources[0] is the entry answered, the rest are related questions.
  const others = [f, ...faq.filter((x) => x.id !== f.id && x.category === f.category).slice(0, 3)].map((x) => ({ id: x.id, question: x.question }));
  const use: Lang = COPY[lang] ? lang : "en";
  if (use !== "en" && allowAi) {
    const ai = await gemini<{ answer: string }>(
      `Translate this support answer from Outlly's help centre into ${COPY[use].name}. Keep product names, **bold** and [link](url) markup exactly. Return JSON {"answer": string}.`,
      f.answer,
      { meter: { feature: "support-chat" } },
    ).catch(() => null);
    if (ai && typeof ai.answer === "string" && ai.answer.trim()) return { answer: ai.answer, confident: true, sources: others, wantsHuman: false, lang: use };
  }
  return { answer: f.answer, confident: true, sources: others, wantsHuman: false, lang: "en" };
}

const PIP = `You are Pip, the support assistant inside Outlly, a tool that lets creators upload one short video and publish it to Instagram Reels, YouTube Shorts and X with AI captions, hooks and titles.
Your job: give the person a complete, correct answer right here in the chat so they never have to go anywhere else.
Rules:
- Outlly facts (features, steps, limits, prices, policies, which platforms are live) come ONLY from the HELP CENTRE and PRODUCT BRIEF below. Never invent a feature, button, price, limit or date. If something is not covered, say so plainly.
- General creator questions (best time to post, hook ideas, hashtags, video length, growth) you may answer from general knowledge, briefly and practically, and connect it to how Outlly helps when it fits.
- Give real steps: name the exact place in the studio (for example "Settings, then Your data"). Never just say "see the help centre"; the person is already talking to help.
- Use the chat so far to understand follow-ups like "and on YouTube?" or "it still fails".
- Past chats with you (1151): a signed-in person's chats are saved for 90 days under **Help centre** in the sidebar, section **Your Pip conversations**, where **Continue in Pip** reopens one. There is no "Chat History" section; never name a page, section, menu or button that the HELP CENTRE, PRODUCT BRIEF or these rules don't name.
- Transcripts (1151): never say whether a transcript can or can't be emailed, and never promise one. The chat itself offers **Resolve & Send Transcript** when it is available.
- Refunds (1076): an account's FIRST payment has a 30-day money-back guarantee. Tell them to open Billing and press "Refund my payment" (no reason needed; the plan ends at once and they move to Free; UPI refunds are sent back by hand within about 2 working days). Do not set needsHuman for that. Only past 30 days, for a later payment, or if the button is missing, treat it as a person-only problem.
- Problems only a person can fix (charged twice, a refund outside the 30-day guarantee, account access lost, a bug that persists after the steps, email change, legal) : answer what you can, then set needsHuman=true.
- If the question is unclear, ask ONE short clarifying question (answered=false).
- Tone: warm, calm, plain words, short paragraphs, under 120 words. No headings, no emoji, no em dashes. **bold** for button names is fine.
- Reply in {LANG}.
Return JSON {"answer": string, "answered": boolean, "needsHuman": boolean, "faqIds": string[] (ids of help entries you used, most relevant first, may be empty)}.`;

async function aiAnswer(q: string, history: { role: "user" | "bot"; text: string }[], langName: string, use: Lang, ctx: ChatCtx): Promise<BotReply | null> {
  const [faq, brief] = await Promise.all([listFaq(), productBrief()]);
  const ai = await gemini<{ answer: string; answered: boolean; needsHuman?: boolean; faqIds?: string[] }>(
    PIP.replace("{LANG}", langName),
    [
      `HELP CENTRE:\n${faq.map((f) => `[${f.id}] (${f.category}) Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}`,
      `PRODUCT BRIEF:\n${brief}`,
      `PERSON: ${ctx.signedIn ? "signed in to the studio" : "a visitor, not signed in"}${ctx.page ? `, currently on ${ctx.page}` : ""}.`,
      `CHAT SO FAR:\n${history.slice(-8).map((h) => `${h.role === "user" ? "Person" : "Pip"}: ${h.text.slice(0, 600)}`).join("\n") || "(new chat)"}`,
      `QUESTION: ${q}`,
    ].join("\n\n"),
    { temperature: 0.3, timeoutMs: 12_000, meter: { feature: "support-chat", userId: ctx.userId ?? null } },
  ).catch(() => null);
  if (!ai || typeof ai.answer !== "string" || !ai.answer.trim()) return null;
  const byId = new Map(faq.map((f) => [f.id, f]));
  const used = (Array.isArray(ai.faqIds) ? ai.faqIds : []).filter((id) => byId.has(id));
  // sources[0] = the entry the answer rests on (the widget hides it and shows the rest as Related).
  // Only entries Gemini actually used: padding with keyword guesses put unrelated questions under answers.
  const sources = used.slice(0, 4).map((id) => ({ id, question: byId.get(id)!.question }));
  const answered = !!ai.answered;
  return {
    answer: ai.answer.trim().replace(/\s*\u2014\s*/g, ", "),
    confident: answered,
    sources,
    wantsHuman: !!ai.needsHuman,
    lang: use,
  };
}

/** FAQ retrieval (keyword + synonyms, BM25-ish), phrased by Gemini when a key is set. */
export type ChatCtx = {
  signedIn?: boolean;
  /** R1315: the signed-in person, so the model's tokens are attributed to them in the cost ledger. */
  userId?: string | null;
  page?: string;
  /** false = answer from the help centre only, no model call (a signed-out visitor over the free budget). */
  ai?: boolean;
};

export async function answer(question: string, history: { role: "user" | "bot"; text: string }[] = [], lang: Lang = "en", ctx: ChatCtx = {}): Promise<BotReply> {
  const q = question.trim().slice(0, 800);
  const chat = small(q, lang);
  if (chat) return chat;
  // Someone typing in another script gets answered in that script, whatever the picker says.
  const use: Lang = detectScript(q) ?? (COPY[lang] ? lang : "en");
  const L = COPY[use];
  // R1194: a signed-in person's ask for a human never reaches this far (the chat route starts the handoff first), so
  // what is left is a visitor asking for one: Pip explains the email route. For everyone else the words are a question.
  if (!ctx.signedIn && wantsHuman(q)) return { answer: L.human, confident: false, sources: [], wantsHuman: true, lang: use };
  // AI first (10-16): Gemini reads the WHOLE help centre plus the product brief and the chat so far, so
  // everyday wording, typos, follow-ups ("and on YouTube?") and any language get a real answer.
  // The keyword matcher below is the fallback when no key is set or Gemini is down.
  const useAi = ctx.ai !== false && !!env.GEMINI_API_KEY;
  if (useAi) {
    const ai = await aiAnswer(q, history, L.name, use, ctx);
    if (ai) return ai;
  }
  let r = await rank(q);
  if (useAi && (!r.best || !r.confident) && (use !== "en" || /[^\x00-\x7f]/.test(q))) {
    const en = await toEnglish(q);
    if (en) r = await rank(en);
  }
  const { top, best, confident } = r;
  if (!best || !confident) {
    return { answer: L.unsure, confident: false, sources: top.map((t) => ({ id: t.f.id, question: t.f.question })), wantsHuman: false, lang: use };
  }

  // Gemini rewrites the matched answers into a direct reply. It may ONLY use the provided FAQ text.
  const ai = !useAi ? null : await gemini<{ answer: string; answered: boolean }>(
    `You are Pip, Outlly's friendly support assistant. Answer ONLY from the FAQ entries given. If they don't answer the question, set answered=false. Keep it under 90 words, plain and warm, no markdown headings. Reply in ${L.name}. Return JSON {"answer": string, "answered": boolean}.`,
    `Recent chat:\n${history.slice(-4).map((h) => `${h.role}: ${h.text}`).join("\n")}\n\nQuestion: ${q}\n\nFAQ:\n${top.map((t) => `Q: ${t.f.question}\nA: ${t.f.answer}`).join("\n\n")}`,
    { meter: { feature: "support-chat", userId: ctx.userId ?? null } },
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
