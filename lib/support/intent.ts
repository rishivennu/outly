/**
 * R1194: what the person wants from Pip, before any answer is written. Pure (no database), shared by the chat
 * route and its tests.
 *
 * HUMAN_SUPPORT_REQUEST is the one that matters: "Connect me with a support specialist", "connect me in chat",
 * "connect to live support", "I want to talk to a human", "let me speak to an agent", "I need a real person",
 * "transfer me to support", "can someone help me?", "human assistance please", with typos, extra words and in
 * every language Pip speaks. The chat route then starts the handoff itself: no "would you like a human?" card,
 * no "tell me your email", no "explain your issue first".
 *
 * Routing order (brief section 9): a specialist in the chat > a waiting request > an explicit ask for a person >
 * everything else (records, help centre, model), which the chat route decides after this.
 */
import { HUMAN_RE, norm } from "./smalltalk";
import type { LiveMode } from "./live-core";

export type PipIntent = "HUMAN_ACTIVE_RELAY" | "QUEUE_RELAY" | "HUMAN_SUPPORT_REQUEST" | "GENERAL";

/** Lower case, no accents, apostrophes and punctuation out, one space between words. */
export function fold(s: string): string {
  return norm(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words a typo is corrected to (Latin script only, five letters or more, one edit away). Short words are left
// alone: "like" is one edit from "live" and "love", and nobody should reach a person because they liked a reel.
const KEYS = ["human", "agent", "person", "specialist", "representative", "operator", "support", "connect", "transfer", "someone", "somebody", "assistance", "escalate", "customer", "service"];
const KEY_SET = new Set(KEYS);

/** Damerau-Levenshtein distance capped at 2 (adjacent swap counts as one edit: "humna" -> "human"). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const m = a.length, n = b.length;
  let prev2: number[] = [], prev = Array.from({ length: n + 1 }, (_, j) => j), cur: number[] = [];
  for (let i = 1; i <= m; i++) {
    cur = [i];
    for (let j = 1; j <= n; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** "conect me to a humna pls" -> "connect me to a human pls": each Latin word of 5+ letters snaps to a key word one edit away. */
export function fixTypos(text: string): string {
  return text
    .split(" ")
    .map((w) => {
      if (w.length < 5 || !/^[a-z]+$/.test(w)) return w;
      const base = w.length > 5 && w.endsWith("s") ? w.slice(0, -1) : w;
      if (KEY_SET.has(base)) return base;
      let best: string | null = null;
      for (const k of KEYS) {
        if (Math.abs(k.length - base.length) > 1) continue;
        if (editDistance(base, k) <= 1) { best = k; break; }
      }
      return best ?? w;
    })
    .join(" ");
}

const WHO = "(human|person|people|agent|specialist|representative|rep|operator|staff|someone|somebody|anyone|support team|support staff|customer service|customer care|customer support|live support|live chat|live agent|real person|actual person|support)";
// Verbs that move the person to someone else. "send", "take" and "bring" only with "me" or "us" ("send me to an
// agent"): "send it to the team" and "take this to the team" are about the work, not a handoff.
const VERB = "(connect|transfer|put|hand|pass|route|forward|escalate|switch|redirect|refer|(send|take|bring) (me|us))";
const PERSON = "(person|human|agent|specialist|representative|operator)";

/**
 * Latin-script phrasings, tried on the folded, typo-corrected text. STRONG ones name the move and the person
 * ("connect me with a support specialist", "talk to a human", "I need an agent") and win over the topical guards
 * below: "connect me with support about my plan" is still an ask for a person. WEAK ones are shorter or looser
 * ("live support", "can someone help me", "support team") and give way to the guards.
 */
const STRONG: RegExp[] = [
  // "connect me with a support specialist", "connect me in chat", "connect to live support", "transfer me to support",
  // "put me through to someone", "escalate this to your team", "send me to an agent"
  new RegExp(`\\b${VERB}\\b( me| us| this| it| my (issue|problem|case|ticket|chat))?( through| over| on| in| to| with| directly)*( to| with| in)?( a| an| the| your| some| real| live| actual| human)*( ${WHO}|( live| human| real| actual)? ?(chat|support|desk|agent)| your team)\\b`),
  // "I want to talk to a human", "let me speak to an agent", "can I chat with support", "talk to a real person"
  new RegExp(`\\b(talk|speak|chat|speaking|talking|chatting|converse)\\b( directly)? (to|with) (a |an |the |some |your |real |live |actual |human )*${WHO}\\b`),
  // "I need a real person", "get me a human", "I want an agent", "need human". Not "like" or a bare "get": "I like
  // someone's reel" and "get someone to follow me" are about the work.
  new RegExp(`\\b(need|want|prefer|require|looking for|ask for|request|requesting|get me|give me)\\b( me| to have| to get| to reach)?( a| an| the| some)?( real| live| actual| human)? ?${PERSON}\\b`),
  // "I want someone from your team", "need somebody to help", "give me someone who can help"
  /\b(need|want|get me|give me) (someone|somebody|anyone) (real|human|from (your |the )?(team|support)|who can help|to help|to assist|to talk|to look|please|pls|plz|now|asap)\b/,
];
const WEAK: RegExp[] = [
  // "real person please", "live support", "live chat", "human assistance please", "human support". Not "real help
  // with captions": "real" and "actual" only name a person.
  /\b(real|actual) ?(person|human|agent|operator|specialist|representative)\b/,
  /\blive ?(support|chat|agent|person|help|assistance)\b/,
  /\bhuman ?(person|being|agent|support|chat|help|assistance|assistant|operator|specialist|representative)\b/,
  /\b(human|agent|person|specialist|representative|operator|support) (assistance|please|pls|plz|now|asap|needed|required)\b/,
  // "can someone help me?", "could somebody assist", "is anyone there", "is there a human". The tail is required:
  // "can anyone see my drafts" asks about drafts.
  /\b(can|could|will|would|may|is|are)\b ?(there )?(someone|somebody|anyone|anybody|a person|a human|an agent|a specialist)\b ?(else )?(who )?(can |could |please )?(help|assist|talk|chat|call|contact|take a look|look at|there|available|around|online|on your team|from (your |the )?team)\b/,
  /\bis there (a |an )?(human|person|agent|specialist|someone|somebody|anyone)\b/,
  // "support specialist", "support agent", "customer service please", "contact support", "reach support". Not
  // "message the team" or "message my team": a team of their own is not ours.
  /\bsupport (specialist|agent|person|staff|rep|representative|team|human)\b/,
  /\b(contact|reach|call|talk to|speak to|speak with|chat with|message) (your |the |a |an )?(support|customer service|customer care|help desk|helpdesk|support team|humans?)\b/,
  // bare asks: "human", "agent please", "support", "live chat", "a person", "real person"
  /^(a |an |the )?(human|agent|person|real person|live chat|live support|support|customer service|specialist|operator|representative|someone)( please| pls| plz| now| asap)?$/,
  // "escalate", "escalate this", "escalation please"
  /\bescalat(e|ion|ed)\b/,
  // "no bot", "not a bot", "stop the bot", "I don't want a bot", "not you, a person"
  /\b(no|not|stop|without|dont want|do not want|not the|skip the|skip)\b ?(a |the |this |you |ai |an )?(bot|robot|chatbot|ai|automated|automation|machine|pip)\b/,
];

// Never a request for a person, whatever else the words say.
const HARD_GUARDS: RegExp[] = [
  // Asking about Pip itself: "are you a human?", "am I talking to a bot?", "is this a real person?"
  /^(are|r) (you|u|ya) (a |an |even )?(human|real|person|bot|robot|ai|real person|machine)/,
  /^(am i|is this|is that|its|it s) (talking to |chatting with |speaking to |speaking with )?(a |an )?(human|bot|robot|real person|person|ai|machine)/,
  // Explicitly not wanting one: "I don't need a human", "no need for an agent", "not a human, just tell me"
  /\b(dont|do not|didnt|did not|no) (need|want|require)( for)? (a |an |the |any )?(human|person|agent|specialist|someone|somebody|support|representative|operator)\b/,
  /\bno need (for|to) (a |an |the )?(human|person|agent|specialist|someone|somebody|support|talk|speak|chat)\b/,
];
// Not a request for a person when only a WEAK phrase (or a bare word) fired: the topic is the product.
const SOFT_GUARDS: RegExp[] = [
  // Plans and prices: "does the pro plan include priority support?", "what support comes with the free plan?"
  /\b(plan|plans|pricing|price|prices|cost|costs|tier|tiers|subscription|include|includes|included|priority support|email support)\b.*\bsupport\b|\bsupport\b.*\b(plan|plans|pricing|price|tier|include|included|includes|cost)\b/,
  // Connecting a social account, not a person: "connect my instagram", "how do I connect youtube", "connect account"
  /\b(connect|reconnect|link|add|disconnect)\b.*\b(instagram|facebook|youtube|tiktok|linkedin|twitter|pinterest|threads|snapchat|x account|account|accounts|page|channel|profile|platform|workspace|calendar)\b/,
  // "support" as a verb or feature: "do you support reels", "is 4k supported", "which platforms are supported"
  /\b(do|does|did|you|is|are|can)\b.*\bsupport(s|ed)?\b.*\b(reels|shorts|stories|carousel|video|videos|images|formats?|4k|hdr|platforms?|languages?|files?|mp4|mov|gif|webp|png|jpg|captions?|hashtags?|threads|tiktok|youtube|instagram|linkedin|pinterest|facebook)\b/,
  // "how do I check my existing support ticket" is a follow-up on a ticket, not a new ask
  /\b(check|track|status of|update on|where is|what about|see|view|find) (my |the |an |our )?(existing |open |last |current |previous |old )?(support )?(ticket|request|case)\b/,
];

// Bare English words the multilingual word list accepts ("agent", "person", "someone") decide nothing here: the
// phrasings above already cover English ("the agent tab doesn't load" and "I like someone's reel" are about the
// work). Every other word in the list ("humano", "mensch", "atendente", the other scripts) still counts.
const LOOSE_EN = /^(human|agent|person|someone|specialists?|operator|representative|support team|real person|escalate)$/i;
const HUMAN_WORDS = new RegExp(HUMAN_RE.source, "giu");
function humanWord(s: string): boolean {
  for (const m of s.matchAll(HUMAN_WORDS)) if (!LOOSE_EN.test(m[0])) return true;
  return false;
}

/** True when these words ask for a person on the team, in any supported language. */
export function wantsHuman(text: string): boolean {
  const raw = (text ?? "").trim().slice(0, 800);
  if (!raw) return false;
  const f = fixTypos(fold(raw));
  if (!f) return false;
  if (HARD_GUARDS.some((g) => g.test(f))) return false;
  if (STRONG.some((re) => re.test(f))) return true;
  if (SOFT_GUARDS.some((g) => g.test(f))) return false;
  if (WEAK.some((re) => re.test(f))) return true;
  // The original multilingual matcher (words, not phrases) and a few more phrasings in other scripts.
  if (humanWord(raw) || humanWord(norm(raw)) || humanWord(f)) return true;
  return MORE_LANGS.test(raw) || MORE_LANGS.test(f);
}

/** Phrases in other languages that the word list misses: "soporte en vivo", "service client", "सपोर्ट से बात", "转接客服". */
const MORE_LANGS =
  /\b(soporte en vivo|chat en vivo|hablar con soporte|conectame con soporte|conectame con|quiero una persona|hablar con (una |alguna |otra )?persona|hablar con (un |una )?(agente|humano|asesor|asesora|representante|operador|operadora|alguien)|quiero (un |una )?(agente|humano|asesor|representante)|falar com (uma |um )?(pessoa|humano|agente|atendente|alguem)|parler (a|avec) (une |un |quelqu )?(personne|humain|agent|conseiller|un|quelquun|vraie personne)|mit (einem|einer) (menschen|agenten|mitarbeiter|mitarbeiterin|person|berater)|atencion al cliente|servicio al cliente|support humain|service client|parler au support|chat en direct|assistance humaine|un conseiller|atendimento humano|falar com o suporte|suporte ao vivo|falar com alguem|quero uma pessoa|kundenservice|kundendienst|mit jemandem sprechen|mit dem support sprechen|echter mensch|mit einem menschen|einem menschen sprechen|echten menschen|mit einer person sprechen|mit einem mitarbeiter|live chat|layanan pelanggan|bicara dengan tim|hubungkan saya|tim dukungan|dukungan langsung)\b|सपोर्ट से बात|लाइव सपोर्ट|कस्टमर केयर|सपोर्ट टीम|किसी इंसान|इंसान से|एजेंट से|ग्राहक सेवा|সাপোর্ট টিম|লাইভ সাপোর্ট|কাস্টমার কেয়ার|সাপোর্টের সাথে|خدمة العملاء|الدعم المباشر|فريق الدعم|تحويلي|أريد موظف|转接客服|联系客服|真人客服|人工服务|接通客服|客服人员|サポートに繋|サポート担当|人間と話|有人対応|поддержк[аеуи] (онлайн|живая|человек)|живой оператор|соедините|связаться с поддержкой|служба поддержки/i;

/**
 * Where this message goes. mode is the conversation's authoritative mode (lib/support/live-core.ts): a specialist
 * in the chat or a waiting request beats every other reading of the words.
 */
export function routeIntent(text: string, ctx: { mode?: LiveMode | string | null } = {}): { intent: PipIntent; repeat: boolean } {
  const asked = wantsHuman(text);
  if (ctx.mode === "human") return { intent: "HUMAN_ACTIVE_RELAY", repeat: asked };
  if (ctx.mode === "waiting") return { intent: "QUEUE_RELAY", repeat: asked };
  return { intent: asked ? "HUMAN_SUPPORT_REQUEST" : "GENERAL", repeat: false };
}
