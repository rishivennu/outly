import "server-only";
import { gemini, type GeminiOpts } from "./creative";

/**
 * 1160: the assistant watches a video and writes the creator's "what's this video about" story: the plain caption
 * the hook writer and the platform writers already work from. Until now the creator typed it themselves. It sees a
 * handful of still frames spread across the video in order (read in the browser from the file, so nothing waits on
 * the upload) and, when the video's captions have already been read, what is said in it.
 *
 * R1180: with Gemini out of the way (NVIDIA Super VL first, Kimi behind it) the answer read like a frame-by-frame
 * report ("A scene shows a sign that says HQ BOARD MEETING... The final scene shows..."), copying the burned-in
 * subtitles. Gemini had been working out the point on its own; the others need to be asked. So the model now says
 * what it saw, then the point of the reel (the joke, payoff or takeaway), then the caption the creator would post,
 * in that order, so the caption is written after it has looked and understood. A caption that still narrates frames
 * is asked for once more. Measured 11-17 on Reels 50-53: Super VL 1.5-2 s, every caption on the point.
 */
export type VideoStory = { story: string; seen?: string };

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const SYSTEM = `You are the social media manager for a short-form video creator. You watch their video (still frames in order, and sometimes what is said in it) and write the caption they post with it.
First work out the point: the joke, the twist, the lesson or the feeling a viewer leaves with. A caption sells that point; it never retells the plot.
Words burned into the frames are usually subtitles of what is said: read them to understand the video, never copy them line after line.
Never describe the frames or narrate scenes: no "scene", "frame", "shows", "we see", "in this video", "the video", "the final shot".
Use only what is really shown or said. Never invent names, relationships (my kid, my boss), places, numbers, prices, dates, products or claims; when a brand or app appears, call it exactly what the video calls it. Never promise a link, a discount or a giveaway the video does not mention.
No em dashes, no hashtags.`;

/** The transcript is the creator's own words, so it is kept whole up to this many characters. */
export const TRANSCRIPT_MAX = 6000;

export function videoPrompt(frames: number, transcript: string | null, duration?: number | null) {
  const len = duration && duration > 0 ? ` It is ${Math.round(duration)} seconds long.` : "";
  const heard = transcript ? `\nWhat is said in it, in order:\n"""\n${transcript.slice(0, TRANSCRIPT_MAX)}\n"""` : "\nThere is no transcript: go by what the frames show.";
  return `These are ${frames} frame${frames === 1 ? "" : "s"} from one video, in order from start to end.${len}${heard}
Answer in JSON only:
{"seen": string, "point": string, "caption": string}
- seen: one sentence under 160 characters on what is on screen: the look (live action, animation, screen recording, talking head...), the setting, who or what appears, and any brand or product shown.
- point: one sentence on what the video is really about for a viewer: the joke, payoff or takeaway. Not a summary of events.
- caption: the caption this creator posts with the video, in their own voice (first person when they speak to camera, otherwise speaking to the viewer). A first line under 10 words that stops the scroll and teases the payoff without giving it away, then one or two short lines of why it matters, then one natural call to action (save it, send it to a friend who..., or a question to answer; never "link in bio" unless the video says it). 120 to 300 characters, a line break between the parts, at most one emoji, no hashtags.`;
}

/** A frame-by-frame report instead of a caption: "A scene shows...", "The final scene...", "In this video we see...". */
export function narrates(text: string): boolean {
  const hits = text.match(/\b(scenes?|frames?|we see|is shown|are shown|in this video|the video shows|the final shot|on screen,)\b|\bshows? (a|an|the|one|two|three)\b/gi);
  return (hits?.length ?? 0) >= 2 || /^\s*(a|an|the)\b[^.\n]{0,80}\b(scene|frame|shot)\b/i.test(text);
}

const AGAIN = `\nYour last answer described the frames instead of writing a caption. Write the caption a creator would really post: the hook line, why it matters, one call to action.`;

const tidy = (s: string) =>
  s
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);

/** Null when no model could watch the video in time. */
export async function generateVideoStory(frames: { mime: string; data: string }[], transcript: string | null, opts: GeminiOpts & { voice?: string; duration?: number | null } = {}): Promise<VideoStory | null> {
  const { voice, duration, ...rest } = opts;
  const ask = (extra = "") =>
    gemini<{ caption?: unknown; story?: unknown; seen?: unknown }>(SYSTEM + (voice ?? ""), videoPrompt(frames.length, transcript, duration) + extra, {
      temperature: 0.7,
      timeoutMs: 30_000,
      ...rest,
      ...(extra ? { cacheKey: undefined } : {}),
      images: frames,
    });
  let g = await ask();
  // An older answer shape ({"story"}) still counts: the caption is what goes in the box either way.
  let story = tidy(asText(g?.caption) || asText(g?.story));
  if (g && story && narrates(story) && !rest.signal?.aborted) {
    const again = await ask(AGAIN);
    const better = tidy(asText(again?.caption) || asText(again?.story));
    if (again && better && !narrates(better)) (g = again), (story = better);
  }
  if (!g || !story) return null;
  const seen = tidy(asText(g.seen)).slice(0, 300);
  return seen ? { story, seen } : { story };
}
