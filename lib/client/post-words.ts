import { FORMAT_LABEL, type PostFormat } from "@/lib/formats";

/**
 * 1135: the words the sending screen uses for a post, by what it is made of. The screen was written for videos,
 * so a carousel said "Your video" and "Reel". Pure and client-safe so tests can read it directly.
 */
export function postWords(format: PostFormat | null | undefined, slides = 0) {
  const f: PostFormat = format ?? "video";
  const noun = f === "video" ? "video" : f;
  return {
    format: f,
    noun,
    your: `Your ${noun}`,
    sending: `Sending your ${noun}.`,
    where: `Where your ${noun} is going`,
    /** "7 slides" under a carousel (slides can mix photos and clips). */
    count: f === "carousel" && slides > 1 ? `${slides} slides` : null,
  };
}

/** What the post is on the platform: a video on Instagram is a Reel; a photo, carousel or story is just that. */
export const platformFormatLabel = (platformFormat: string, format: PostFormat | null | undefined) =>
  format && format !== "video" ? FORMAT_LABEL[format] : platformFormat;

/** "Live on Instagram", "Live in all 3 places", "Live in 2 of 3". Never "all 1 places". */
export function liveSummary(live: number, total: number, onlyName?: string) {
  if (total === 1) return live === 1 ? `Live on ${onlyName ?? "1 place"}` : `Not live on ${onlyName ?? "1 place"} yet`;
  return live === total ? `Live in all ${total} places` : `Live in ${live} of ${total}`;
}
