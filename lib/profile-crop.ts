/** 1120: the cropper's maths, pure so tests can check it. Offsets are the image's top-left inside the frame, in px. */
export type CropKind = "avatar" | "banner";

/** What gets uploaded: a 512px square picture, a 1500 x 500 cover (the API checks both shapes). */
export const CROP_OUT: Record<CropKind, { w: number; h: number }> = { avatar: { w: 512, h: 512 }, banner: { w: 1500, h: 500 } };

/** The smallest scale at which the image covers the whole frame. */
export const coverScale = (iw: number, ih: number, fw: number, fh: number) => Math.max(fw / iw, fh / ih);

/** Keep the image covering the frame: never a gap at any edge. */
export function clampOffset(x: number, y: number, dw: number, dh: number, fw: number, fh: number) {
  const cl = (v: number, lo: number) => Math.min(0, Math.max(lo, v));
  return { x: cl(x, fw - dw), y: cl(y, fh - dh) };
}

/** The source rectangle (in the image's own pixels) that the frame shows. */
export const cropRect = (x: number, y: number, scale: number, fw: number, fh: number) => ({ sx: -x / scale, sy: -y / scale, sw: fw / scale, sh: fh / scale });
