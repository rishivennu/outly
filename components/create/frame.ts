"use client";
/** Reads real metadata and a poster frame from a local file, entirely in the browser. */
export function readVideo(url: string): Promise<{ duration: number; width: number; height: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    const fail = () => reject(new Error("unreadable"));
    const timer = setTimeout(fail, 15_000);
    v.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1.2, (v.duration || 3) / 3);
    };
    v.onseeked = () => {
      clearTimeout(timer);
      const meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      try {
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => resolve({ ...meta, poster: b }), "image/jpeg", 0.82);
      } catch {
        resolve({ ...meta, poster: null });
      }
    };
  });
}
