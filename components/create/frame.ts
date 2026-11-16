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

/**
 * 1160: a handful of frames spread across a local video, as base64 JPEGs (no data: prefix) for the assistant to
 * watch. Read in the browser from the file, so it does not wait on the upload and nothing is downloaded again.
 * 512px on the long side at quality 0.7 is 30 to 90 KB a frame. Frames that fail to seek are left out; an
 * unreadable video gives none. Stops early on `signal`.
 */
export async function readFrames(url: string, count = 4, signal?: AbortSignal): Promise<{ frames: string[]; duration: number }> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  const once = (ev: "loadedmetadata" | "seeked", ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => done(false), ms);
      const done = (ok: boolean) => {
        clearTimeout(t);
        v.removeEventListener(ev, onOk);
        v.removeEventListener("error", onErr);
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      v.addEventListener(ev, onOk, { once: true });
      v.addEventListener("error", onErr, { once: true });
    });
  const meta = once("loadedmetadata", 15_000);
  v.src = url;
  if (!(await meta) || !Number.isFinite(v.duration) || v.duration <= 0) return { frames: [], duration: 0 };
  const d = v.duration;
  const n = d < 2 ? 1 : d < 6 ? Math.min(count, 2) : count;
  const times = Array.from({ length: n }, (_, i) => Math.min(Math.max(0.2, (d * (i + 0.5)) / n), Math.max(0.2, d - 0.2)));
  const scale = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(v.videoWidth * scale));
  c.height = Math.max(1, Math.round(v.videoHeight * scale));
  const ctx = c.getContext("2d");
  const frames: string[] = [];
  for (const t of times) {
    if (signal?.aborted || !ctx) break;
    const seeked = once("seeked", 6000);
    v.currentTime = t;
    if (!(await seeked)) continue;
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", 0.7).split(",")[1];
      if (data) frames.push(data);
    } catch {
      // a frame the browser would not paint (tainted or not yet decodable): skip it
    }
  }
  v.removeAttribute("src");
  v.load();
  return { frames, duration: d };
}
