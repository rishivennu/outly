import "server-only";
import { gemini, type GeminiOpts } from "./creative";

/**
 * 1160: the assistant watches a video and writes the creator's "what's this video about" story: the plain caption
 * the hook writer and the platform writers already work from. Until now the creator typed it themselves. It sees a
 * handful of still frames spread across the video in order (read in the browser from the file, so nothing waits on
 * the upload) and, when the video's captions have already been read, what is said in it.
 */
export type VideoStory = { story: string };

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const SYSTEM = `You help a creator describe their own video. You are shown still frames taken across the video, in order from start to end, and sometimes a transcript of what is said. Look closely: what happens, who or what is on screen, where it is, and any words shown (titles, on-screen captions, signs, products, screens). Use only what you can really see or hear. Never invent names, places, numbers, dates or claims. Write in the first person, as the creator telling a friend what the video is about: plain words, short sentences, no emoji, no hashtags, no sales talk, no "in this video".`;

/** The transcript is the creator's own words, so it is kept whole up to this many characters. */
export const TRANSCRIPT_MAX = 6000;

export function videoPrompt(frames: number, transcript: string | null, duration?: number | null) {
  const len = duration && duration > 0 ? ` It is ${Math.round(duration)} seconds long.` : "";
  const heard = transcript ? `\nWhat is said in it, in order:\n"""\n${transcript.slice(0, TRANSCRIPT_MAX)}\n"""` : "\nThere is no transcript: go by what the frames show.";
  return `These are ${frames} frame${frames === 1 ? "" : "s"} from one video, in order from start to end.${len}${heard}
Answer in JSON only:
{"story": string}
- story: 2 to 4 sentences, under 500 characters, saying what the video is about and what makes it worth watching. Name the concrete things (people, places, products, figures, words on screen) only when they are shown or said. Keep the creator's own phrasing when the transcript has a clear line.`;
}

/** Null when no model could watch the video in time. */
export async function generateVideoStory(frames: { mime: string; data: string }[], transcript: string | null, opts: GeminiOpts & { voice?: string; duration?: number | null } = {}): Promise<VideoStory | null> {
  const { voice, duration, ...rest } = opts;
  const g = await gemini<{ story?: unknown }>(SYSTEM + (voice ?? ""), videoPrompt(frames.length, transcript, duration), {
    temperature: 0.7,
    timeoutMs: 30_000,
    ...rest,
    images: frames,
  });
  const story = asText(g?.story)
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, 1500);
  if (!g || !story) return null;
  return { story };
}
