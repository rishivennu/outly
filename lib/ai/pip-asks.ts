/**
 * R1198: Pip's one-tap asks on Your Story and Everywhere. Each one rewrites ONE place's caption from the words
 * already there, and the answer is always a suggestion the creator accepts or skips: never written straight in.
 * Shared by the client (labels) and the server (the instruction the model gets), so the two can never drift.
 */
export const PIP_ASKS = ["hook", "shorter", "engaging", "cta", "hashtags", "adapt"] as const;
export type PipAsk = (typeof PIP_ASKS)[number];

export const isPipAsk = (v: unknown): v is PipAsk => typeof v === "string" && (PIP_ASKS as readonly string[]).includes(v);

/** What the model is told to do. Every ask keeps the facts: nothing about the video is ever made up. */
export const PIP_ASK_RULE: Record<PipAsk, string> = {
  hook: "Rewrite only the opening line so it stops the scroll: a sharper, more specific hook. Keep the rest of the caption as close to the current one as you can.",
  shorter: "Make it noticeably shorter (about half the length) while keeping the hook, the main point and the call to action.",
  engaging: "Make it more engaging: a stronger hook, tighter rhythm, one clear reason to keep watching. Same meaning, same facts, same voice.",
  cta: "Improve only the call to action at the end so it asks for one specific, easy action that fits this platform. Keep everything before it.",
  hashtags: "Suggest 3 to 8 relevant hashtags for this caption and platform. Return the caption, title and description exactly as they are now.",
  adapt: "Adapt it fully to this platform's conventions: its length, structure, tone, line breaks and call to action. Same meaning, same facts.",
};

/** The chips Pip shows. Step 2 talks about "my" caption; Step 3 about the place on screen. */
export const STORY_ASKS: { id: PipAsk | "other"; label: string }[] = [
  { id: "hook", label: "Improve my hook" },
  { id: "shorter", label: "Make it shorter" },
  { id: "engaging", label: "Make it engaging" },
  { id: "cta", label: "Improve the CTA" },
  { id: "other", label: "Adapt for another platform" },
];
export const DECK_ASKS: { id: PipAsk; label: string }[] = [
  { id: "hook", label: "Improve this hook" },
  { id: "shorter", label: "Make it shorter" },
  { id: "cta", label: "Improve the CTA" },
  { id: "hashtags", label: "Suggest relevant hashtags" },
  { id: "adapt", label: "Adapt for the selected platform" },
];

/** The words Pip may change for an ask. Hashtags never touch the caption; the others leave first comments alone. */
export const ASK_KEYS: Record<PipAsk, readonly ("title" | "caption" | "description" | "hashtags")[]> = {
  hook: ["title", "caption", "description"],
  shorter: ["title", "caption", "description", "hashtags"],
  engaging: ["title", "caption", "description"],
  cta: ["caption", "description"],
  hashtags: ["hashtags"],
  adapt: ["title", "caption", "description", "hashtags"],
};
