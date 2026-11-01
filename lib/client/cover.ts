import { COVER_SUPPORT, PLATFORM_META, type Platform } from "@/lib/domain";

/** The longest edge a cover keeps (1080 x 1920 is what Instagram and Shorts show). */
export const COVER_MAX_EDGE = 1920;
/** Smaller than this on the short side and every platform shows it blurry; YouTube wants 640 wide at least. */
export const COVER_MIN_EDGE = 320;

/** The size to draw the cover at: never upscaled, longest edge at most COVER_MAX_EDGE, aspect kept. */
export function coverSize(w: number, h: number, maxEdge = COVER_MAX_EDGE): { w: number; h: number } {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** JPEG qualities tried in turn until the file fits under the size cap. */
export const COVER_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];

/**
 * Any JPEG, PNG or WebP the creator picks, as one JPEG under `maxBytes` (YouTube caps thumbnails at 2 MB and
 * Instagram wants a JPEG). Browser only. Throws an Error whose message can be shown as is.
 */
export async function toCoverJpeg(file: File, maxBytes: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Pick a JPEG, PNG or WebP image for the cover.");
  if (file.size > 25 * 1024 * 1024) throw new Error("That image is over 25 MB. Pick a smaller one.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("That image couldn't be opened. Try another one.");
  }
  try {
    if (Math.min(bmp.width, bmp.height) < COVER_MIN_EDGE) throw new Error(`That image is only ${bmp.width} x ${bmp.height}. Use one at least ${COVER_MIN_EDGE} pixels on its short side, ideally 1080 x 1920.`);
    const { w, h } = coverSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("Your browser couldn't prepare the cover. Try another browser.");
    g.fillStyle = "#000"; // a transparent PNG would otherwise turn black in patches; make it deliberate
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, w, h);
    for (const q of COVER_QUALITIES) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && blob.size <= maxBytes) return blob;
    }
    throw new Error("That cover is still over 2 MB after shrinking it. Try a simpler or smaller image.");
  } finally {
    bmp.close();
  }
}

type T = { platform: Platform; status: string; coverSet?: boolean; coverError?: string | null };

/** One honest line about the cover on a live post, or null when there is nothing to say. */
export function coverLine(t: T, hasCover: boolean): { text: string; tone: "ok" | "wait" | "bad" } | null {
  if (!hasCover || t.status !== "published") return null;
  if (COVER_SUPPORT[t.platform] !== "upload") return null;
  if (t.coverError) return { text: `Cover didn't go on: ${t.coverError}`, tone: "bad" };
  if (t.coverSet) return { text: "Your cover is on it", tone: "ok" };
  return { text: `Setting your cover on ${PLATFORM_META[t.platform].name}…`, tone: "wait" };
}
