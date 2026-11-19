import { isPlatform, PLATFORM_META, type Platform } from "../domain";
import { FORMAT_LABEL, isPostFormat, supportsFormat, type PostFormat } from "../formats";
import { transitions, type Prefill } from "./planner-core";

/**
 * R1241: an accepted recommendation as the video composer's starting state (/create?rec=<id>). Pure and client-safe:
 * CreateWorkspace applies it, tests read it directly. Only fields the composer already has: the main caption (own
 * mode), the platforms switched on, the source post for lineage and the recommendation id sent with the first save.
 */
export interface PrefillDraft {
  /** The main caption box, written from the recommendation. Never empty. */
  story: string;
  /** Platforms to switch on. Empty keeps the composer's defaults. */
  platforms: Platform[];
  /** The format kept, or null when the pair or this composer can't make it. */
  format: PostFormat | null;
  topic: string | null;
  title: string;
  /** Why something in the recommendation was left out, in a sentence. */
  note: string | null;
  adaptedFromPostId?: string;
  recommendationId: string;
}

/** The server's cap on Post.story (lib/validation savePostSchema). */
export const STORY_MAX = 4000;
const POST_ID = /^[A-Za-z0-9]{1,40}$/;
const FALLBACK = "An idea from your Growth Planner. Say it in your own words.";

// House copy has no em or en dashes: the engine's text is tidied the same way before it lands in the box.
const tidy = (s: string | null | undefined) => (s ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/[ \t]+/g, " ").trim();

export function storyOf(title: string, concept: string): string {
  const t = tidy(title).replace(/[.!?:]+$/, "");
  const c = tidy(concept);
  const text = t && c ? (c.toLowerCase().startsWith(t.toLowerCase()) ? c : `${t}.\n\n${c}`) : t ? `${t}.` : c;
  return (text || FALLBACK).slice(0, STORY_MAX);
}

export function prefillToDraft(prefill: Prefill, opts: { recommendationId: string; makes?: readonly PostFormat[] }): PrefillDraft {
  const makes = opts.makes ?? ["video"];
  const platform = isPlatform(prefill.platform) ? prefill.platform : null;
  let format: PostFormat | null = isPostFormat(prefill.format) ? prefill.format : null;
  let note: string | null = null;
  if (platform && format && !supportsFormat(platform, format)) {
    note = `${PLATFORM_META[platform].name} can't take a ${FORMAT_LABEL[format].toLowerCase()} from Outlly yet, so this starts as a video.`;
    format = null;
  } else if (format && !makes.includes(format)) {
    note = `This was planned as a ${FORMAT_LABEL[format].toLowerCase()}. This editor makes videos, so it starts as one.`;
    format = null;
  }
  const source = prefill.basedOn.find((id) => POST_ID.test(id));
  return {
    story: storyOf(prefill.title, prefill.concept),
    platforms: platform ? [platform] : [],
    format,
    topic: tidy(prefill.topic) || null,
    title: tidy(prefill.title) || "Your recommendation",
    note,
    ...(source ? { adaptedFromPostId: source } : {}),
    recommendationId: opts.recommendationId,
  };
}

/** A composer with nothing typed yet: a prefill may fill it without asking. */
export function editorEmpty(s: { story: string; hook: string | null; captions: readonly string[] }): boolean {
  return !s.story.trim() && !s.hook?.trim() && s.captions.every((c) => !c.trim());
}

/** Opening the composer from an open or saved recommendation accepts it; any other status is left as it is. */
export const acceptsOnOpen = (status: string): boolean => transitions(status).includes("accept");
