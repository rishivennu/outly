import type { Platform } from "@/lib/domain";

/**
 * R1198: Pip's one-tap asks on Your Story and Everywhere. Each one rewrites ONE place's caption from the words
 * already there, and the answer is always a suggestion the creator accepts or skips: never written straight in.
 * Shared by the client (labels) and the server (the instruction the model gets), so the two can never drift.
 */
export const PIP_ASKS = ["hook", "shorter", "engaging", "conversational", "professional", "voice", "cta", "hashtags", "adapt", "ytmeta", "lesson", "concise", "rephrase"] as const;
export type PipAsk = (typeof PIP_ASKS)[number];

export const isPipAsk = (v: unknown): v is PipAsk => typeof v === "string" && (PIP_ASKS as readonly string[]).includes(v);

/** What the model is told to do. Every ask keeps the facts: nothing about the video is ever made up. */
export const PIP_ASK_RULE: Record<PipAsk, string> = {
  hook: "Rewrite only the opening line so it stops the scroll: a sharper, more specific hook. Keep the rest of the caption as close to the current one as you can.",
  shorter: "Make it noticeably shorter (about half the length) while keeping the hook, the main point and the call to action.",
  engaging: "Make it more engaging: a stronger hook, tighter rhythm, one clear reason to keep watching. Same meaning, same facts, same voice.",
  conversational: "Rewrite it the way the creator would say it out loud to one friend: plain words, short sentences, contractions. Same meaning and same facts, and no slang that is not already there.",
  professional: "Rewrite it for a professional audience: clear, measured, specific. No hype, no emoji, no exclamation marks. Keep every fact and the point exactly as they are.",
  voice: "Rewrite it in the creator's own voice, copying the rhythm, vocabulary and punctuation already in their words. Change the wording, never the meaning or the facts.",
  cta: "Improve only the call to action at the end so it asks for one specific, easy action that fits this platform. Keep everything before it.",
  hashtags: "Suggest 3 to 8 relevant hashtags for this caption and platform. Return the caption, title and description exactly as they are now.",
  adapt: "Adapt it fully to this platform's conventions: its length, structure, tone, line breaks and call to action. Same meaning, same facts.",
  ytmeta: "Write the YouTube title, description and keywords together: a title someone would really search for, a description whose first two lines earn the click, and keywords taken only from what is already said. Nothing invented.",
  lesson: "Lead with the lesson: open with what the reader can take away, then the part of the story that proves it, then the ask. LinkedIn's audience reads the first line and decides.",
  concise: "Say the whole point in one post that sits comfortably inside the limit: one idea, no wind-up, no filler. Do not add hashtags.",
  rephrase: "Rephrase it: a sharper opening hook, clearer sentences that read easily, a more engaging rhythm, and a clearer call to action where one fits. Keep the creator's meaning, facts and context exactly as they are; add no claim, number, name or detail that is not already there. Keep any \"CTA:\" or \"Hashtags:\" line and its label.",
};

/** The chips Pip shows. Step 2 talks about "my" caption; Step 3 about the place on screen. */
export const STORY_ASKS: { id: PipAsk | "other"; label: string; only?: readonly Platform[] }[] = [
  { id: "hook", label: "Improve my hook" },
  { id: "shorter", label: "Make it shorter" },
  { id: "engaging", label: "Make it engaging" },
  { id: "conversational", label: "Make it conversational" },
  { id: "professional", label: "Make it professional" },
  { id: "voice", label: "Rewrite in my voice" },
  { id: "cta", label: "Improve the CTA" },
  { id: "hashtags", label: "Suggest hashtags" },
  { id: "other", label: "Adapt for another platform" },
];
/** R1206: `only` keeps a platform's own ask off every other platform, where its answer would have nowhere to go. */
export const DECK_ASKS: { id: PipAsk; label: string; only?: readonly Platform[] }[] = [
  { id: "hook", label: "Improve this hook" },
  { id: "shorter", label: "Make it shorter" },
  { id: "cta", label: "Improve the CTA" },
  { id: "hashtags", label: "Suggest relevant hashtags" },
  { id: "ytmeta", label: "Write the title, description and keywords", only: ["youtube"] },
  { id: "lesson", label: "Lead with the lesson", only: ["linkedin"] },
  { id: "concise", label: "Say it in one post", only: ["x"] },
  { id: "adapt", label: "Adapt for the selected platform" },
];

/**
 * R1206: on Your Story the asks work on the creator's own caption, the one every platform's version is written
 * from, not on any one platform. These are the ones that make sense there ("Adapt for another platform" adds a
 * platform instead), each said about the original caption rather than a platform's copy.
 */
export const CAPTION_ASKS = ["hook", "shorter", "engaging", "conversational", "professional", "voice", "cta", "hashtags", "rephrase"] as const satisfies readonly PipAsk[];
export type CaptionAsk = (typeof CAPTION_ASKS)[number];
export const isCaptionAsk = (v: unknown): v is CaptionAsk => typeof v === "string" && (CAPTION_ASKS as readonly string[]).includes(v);

export const CAPTION_ASK_RULE: Record<CaptionAsk, string> = {
  hook: PIP_ASK_RULE.hook,
  shorter: PIP_ASK_RULE.shorter,
  engaging: PIP_ASK_RULE.engaging,
  conversational: PIP_ASK_RULE.conversational,
  professional: PIP_ASK_RULE.professional,
  voice: PIP_ASK_RULE.voice,
  cta: "Improve only the call to action so it asks for one specific, easy action. If a line starts with \"CTA:\", improve that line and keep its label. Keep everything else exactly as it is.",
  hashtags: "Suggest 3 to 8 relevant hashtags taken only from what the caption really says: nothing off-topic, nothing trending for its own sake. Do not change the caption.",
  rephrase: PIP_ASK_RULE.rephrase,
};

/**
 * R1209 A1: the optional refinements under Outlly's caption on Your Story (Generate with Outlly), in the brief's
 * words. Each one is a suggestion the creator accepts, edits or skips; the caption box stays the source.
 */
export const REFINE_ASKS: { id: CaptionAsk; label: string }[] = [
  { id: "engaging", label: "Make it more engaging" },
  { id: "hook", label: "Create a stronger hook" },
  { id: "shorter", label: "Make it shorter" },
  { id: "cta", label: "Improve the CTA" },
  { id: "conversational", label: "Make it conversational" },
  { id: "professional", label: "Make it professional" },
];
/**
 * R1209 A3: Pip's asks on Your Story, by caption mode. The page has its own buttons (the Refine chips under
 * Outlly's caption, Rephrase under the creator's own), so Pip offers only the others: one place for each action.
 */
export const STORY_MODE_ASKS: Record<"generate" | "own", { id: CaptionAsk | "other"; label: string; only?: readonly Platform[] }[]> = {
  generate: [
    { id: "voice", label: "Rewrite in my voice" },
    { id: "hashtags", label: "Suggest hashtags" },
    { id: "other", label: "Adapt for another platform" },
  ],
  own: [
    { id: "hook", label: "Improve my hook" },
    { id: "shorter", label: "Make it shorter" },
    { id: "engaging", label: "Make it engaging" },
    { id: "cta", label: "Improve the CTA" },
    { id: "hashtags", label: "Suggest hashtags" },
    { id: "other", label: "Adapt for another platform" },
  ],
};
/** What a caption suggestion card calls the ask it answers. */
export const CAPTION_ASK_LABEL: Record<CaptionAsk, string> = {
  hook: "Create a stronger hook",
  shorter: "Make it shorter",
  engaging: "Make it more engaging",
  conversational: "Make it conversational",
  professional: "Make it professional",
  voice: "Rewrite in my voice",
  cta: "Improve the CTA",
  hashtags: "Suggest hashtags",
  rephrase: "Rephrased by Outlly Assistant",
};

/** The words Pip may change for an ask. Hashtags never touch the caption; the others leave first comments alone. */
export const ASK_KEYS: Record<PipAsk, readonly ("title" | "caption" | "description" | "hashtags")[]> = {
  hook: ["title", "caption", "description"],
  shorter: ["title", "caption", "description", "hashtags"],
  engaging: ["title", "caption", "description"],
  conversational: ["title", "caption", "description"],
  professional: ["title", "caption", "description"],
  voice: ["title", "caption", "description"],
  cta: ["caption", "description"],
  hashtags: ["hashtags"],
  adapt: ["title", "caption", "description", "hashtags"],
  ytmeta: ["title", "description", "hashtags"],
  lesson: ["title", "caption", "description"],
  concise: ["caption"],
  rephrase: ["title", "caption", "description"],
};
