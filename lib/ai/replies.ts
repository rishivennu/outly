import "server-only";
import { gemini } from "./creative";
import type { Platform } from "../domain";

export interface ReplySuggestion {
  label: string; // "Thank them", "Answer", "Keep it going"
  text: string;
}

export interface ReplyResult {
  intent: "question" | "praise" | "critique" | "request" | "other";
  suggestions: ReplySuggestion[];
  source: "gemini" | "studio";
}

const LIMIT: Record<Platform, number> = { instagram: 2200, youtube: 10000, x: 280 };

/** Rough read of what the commenter wants, so the offline drafts are not generic. */
export function classify(comment: string): ReplyResult["intent"] {
  const t = comment.toLowerCase();
  if (/\?|\b(how|what|where|which|when|why|can you|do you|is it|link)\b/.test(t)) return "question";
  if (/\b(please|pls|plz|make a|part 2|next video|do a|tutorial)\b/.test(t)) return "request";
  if (/\b(wrong|bad|boring|clickbait|fake|worst|hate|disagree|cringe|not true)\b/.test(t)) return "critique";
  if (/\b(love|great|amazing|awesome|fire|best|thanks|thank you|helpful|nice|cool|goat|wow)\b|🔥|❤|😍|👏/.test(t)) return "praise";
  return "other";
}

const firstName = (n: string) => {
  const w = (n.replace(/^@/, "").split(/[\s._]/)[0] || "").replace(/[^\p{L}\p{N}'-]/gu, "").slice(0, 24);
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
};

export function offlineReplies(comment: string, author: string, platform: Platform): ReplyResult {
  const intent = classify(comment);
  const name = firstName(author);
  const n = name ? `, ${name}` : ""; // "Thanks, Maya!" or just "Thanks!"
  const sets: Record<ReplyResult["intent"], ReplySuggestion[]> = {
    // the "Answer" draft stops where the creator's own answer goes, so we never invent facts
    question: [
      { label: "Answer", text: `Great question${n}! Short answer:` },
      { label: "Point to more", text: `Good one${n}. I go deeper on exactly this in my next video, so keep an eye out.` },
      { label: "Ask back", text: `Happy to help${n}. What are you working on? Then I can give you a better answer.` },
    ],
    request: [
      { label: "Say yes", text: `Noted${n}! That's going on the list for the next one.` },
      { label: "Ask for votes", text: `Love this idea${n}. If a few more people want it, part 2 is happening. 👀` },
      { label: "Thank them", text: `Thanks for the push${n}. Requests like this are how I pick what to film next.` },
    ],
    critique: [
      { label: "Stay calm", text: `Fair point${n}, thanks for saying it. What would you have done differently?` },
      { label: "Clarify", text: `I hear you${n}. I had to keep it short, but there's more context in the caption.` },
      { label: "Thank them", text: `Appreciate the honest take${n}. I'll keep it in mind for the next one.` },
    ],
    praise: [
      { label: "Thank them", text: `Thank you${n}! Comments like this make the editing worth it. 🙌` },
      { label: "Keep it going", text: `Means a lot${n}! What should I make next?` },
      { label: "Invite back", text: `So glad it helped${n}. More like this coming soon.` },
    ],
    other: [
      { label: "Thank them", text: `Thanks for watching${n}, and for taking the time to comment!` },
      { label: "Keep it going", text: `Appreciate you being here${n}. What did you think of the ending?` },
      { label: "Short and warm", text: `Thanks${n}! 🙌` },
    ],
  };
  return { intent, suggestions: sets[intent].map((s) => ({ ...s, text: tidy(s.text, platform) })), source: "studio" };
}

function tidy(text: string, platform: Platform) {
  const t = text.replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").replace(/^, /, "").trim();
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return out.length > LIMIT[platform] ? out.slice(0, LIMIT[platform] - 1) + "…" : out;
}

export async function suggestReplies(input: { comment: string; author: string; platform: Platform; postTitle?: string | null }): Promise<ReplyResult> {
  const fallback = offlineReplies(input.comment, input.author, input.platform);
  const g = await gemini<{ intent: ReplyResult["intent"]; suggestions: ReplySuggestion[] }>(
    `You help a short-form video creator reply to comments. Sound like the creator: warm, human, brief. Never corporate, never pushy, no links, no promises you can't keep. At most one emoji per reply. Match the commenter's language.`,
    `Platform: ${input.platform} (max ${LIMIT[input.platform]} chars).\nVideo: """${input.postTitle ?? "unknown"}"""\nCommenter: ${input.author}\nComment: """${input.comment}"""\nReturn JSON {"intent": one of question|praise|critique|request|other, "suggestions": [{"label": 1-3 word label like "Answer", "text": reply under 220 chars}] x3, each a different approach}`,
  );
  const list = g?.suggestions?.filter((s) => s?.text?.trim()).slice(0, 3);
  if (!list?.length) return fallback;
  return {
    intent: (["question", "praise", "critique", "request", "other"] as const).includes(g!.intent) ? g!.intent : fallback.intent,
    suggestions: list.map((s) => ({ label: (s.label || "Reply").slice(0, 24), text: tidy(s.text, input.platform) })),
    source: "gemini",
  };
}
