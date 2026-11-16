import { pipFont } from "@/components/support/font";
import { captionFont } from "@/lib/captions/size";

/**
 * The caption face on the video: Poppins Bold (lib/captions/size.ts). It is the same Poppins next/font already
 * self-hosts for Pip, so captions add no download; only the hashed family name is needed, for the canvas.
 * Latin, Latin Extended and Devanagari come from Poppins; Telugu, Tamil and other scripts fall back to the
 * system face in the same weight.
 */
export const captionFontFamily = pipFont.style.fontFamily;

/**
 * Have the face in memory before a frame is drawn with it; a canvas does not wait for a font by itself. `text` is
 * the text about to be drawn, so the Latin Extended or Devanagari file is fetched too when a line needs it.
 */
export function readyCaptionFont(text?: string): Promise<unknown> {
  if (typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  return document.fonts.load(captionFont(32, captionFontFamily), text || undefined).catch(() => {});
}
