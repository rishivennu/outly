"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ImageUp, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FX } from "@/lib/motion/tokens";
import { api, ApiError } from "@/lib/client/api";
import { clampOffset, coverScale, cropRect, CROP_OUT, type CropKind } from "@/lib/profile-crop";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_INPUT = 15 * 1024 * 1024;

/**
 * 1120: pick a picture, frame it, see exactly what will show, save. Drag (or arrow keys) to move, the slider (or
 * + / -) to zoom. The crop is drawn on a canvas in the browser and only the cropped JPEG is uploaded.
 */
export function ImageCropper({ kind, open, onOpenChange, onSaved, hasCurrent = false }: { kind: CropKind; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (url: string | null) => void; hasCurrent?: boolean }) {
  const reduce = useReducedMotion();
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const isAvatar = kind === "avatar";
  const title = isAvatar ? "Change picture" : "Change cover";

  // Start clean every time it opens; free the object URL when done.
  useEffect(() => {
    if (!open) return;
    setSrc(null), setImg(null), setZoom(1), setOff({ x: 0, y: 0 }), setFrame({ w: 0, h: 0 }), setError(null);
  }, [open]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  // The frame's real size (it is fluid), so the maths matches what is on screen.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [img]);

  const scale = img && frame.w ? coverScale(img.naturalWidth, img.naturalHeight, frame.w, frame.h) * zoom : 1;
  const place = useCallback(
    (x: number, y: number, s = scale) => (img ? clampOffset(x, y, img.naturalWidth * s, img.naturalHeight * s, frame.w, frame.h) : { x, y }),
    [img, frame, scale],
  );
  // Centre on load and whenever the frame resizes; keep the image covering the frame on zoom.
  useEffect(() => {
    if (!img || !frame.w) return;
    const s = coverScale(img.naturalWidth, img.naturalHeight, frame.w, frame.h);
    setOff(clampOffset((frame.w - img.naturalWidth * s) / 2, (frame.h - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s, frame.w, frame.h));
  }, [img, frame]);

  // Live values for bursts of wheel or key events inside one frame (the render closure would be stale).
  const zoomRef = useRef(1);
  const offRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  offRef.current = off;
  const zoomTo = (z: number) => {
    const next = Math.min(4, Math.max(1, z));
    if (!img) return (zoomRef.current = next), setZoom(next);
    // Zoom about the frame's centre.
    const s0 = coverScale(img.naturalWidth, img.naturalHeight, frame.w, frame.h);
    const k = next / zoomRef.current;
    const cx = frame.w / 2, cy = frame.h / 2;
    const o = offRef.current;
    const nextOff = clampOffset(cx - (cx - o.x) * k, cy - (cy - o.y) * k, img.naturalWidth * s0 * next, img.naturalHeight * s0 * next, frame.w, frame.h);
    zoomRef.current = next;
    offRef.current = nextOff;
    setOff(nextOff);
    setZoom(next);
  };

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!ACCEPT.split(",").includes(f.type)) return setError("Use a JPEG, PNG or WebP picture.");
    if (f.size > MAX_INPUT) return setError("That file is over 15 MB. Try a smaller one.");
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      const min = isAvatar ? 128 : 600;
      if (el.naturalWidth < min || el.naturalHeight < (isAvatar ? 128 : 200)) {
        URL.revokeObjectURL(url);
        return setError(isAvatar ? "That picture is too small. Use one at least 128 pixels across." : "That picture is too small for a cover. Use one at least 600 pixels wide.");
      }
      setSrc(url);
      setImg(el);
      setZoom(1);
    };
    el.onerror = () => (URL.revokeObjectURL(url), setError("That file couldn't be opened as a picture."));
    el.src = url;
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    setError(null);
    try {
      const out = CROP_OUT[kind];
      const r = cropRect(off.x, off.y, scale, frame.w, frame.h);
      const c = document.createElement("canvas");
      c.width = out.w;
      c.height = out.h;
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.fillStyle = "#fff";
      g.fillRect(0, 0, out.w, out.h); // transparent PNGs become white, not black, as JPEG
      g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, out.w, out.h);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.88));
      if (!blob) throw new Error("Couldn't prepare the picture.");
      const { url } = await api<{ url: string }>(`/api/settings/profile/image?kind=${kind}`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
      onSaved(url);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something got in the way.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/settings/profile/image?kind=${kind}`, { method: "DELETE" });
      onSaved(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something got in the way.");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d) {
      e.preventDefault();
      setOff((o) => place(o.x + d[0], o.y + d[1]));
    } else if (e.key === "+" || e.key === "=") (e.preventDefault(), zoomTo(zoom + 0.2));
    else if (e.key === "-") (e.preventDefault(), zoomTo(zoom - 0.2));
  };

  const imgStyle = img ? { width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `translate3d(${off.x}px, ${off.y}px, 0)` } : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[70] bg-foreground/40 backdrop-blur-[3px]" {...(reduce ? FX.fade : FX.scrim)} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="crop-d">
              <div className="fixed inset-0 z-[71] grid place-items-center overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-lenis-prevent>
                <motion.div {...(reduce ? FX.fade : FX.dialog)} className={cn("glass-strong relative w-full rounded-[28px] p-5 sm:p-6", isAvatar ? "max-w-[440px]" : "max-w-[640px]")}>
                  <Dialog.Title className="pr-12 text-lg font-semibold tracking-tight">{title}</Dialog.Title>
                  <Dialog.Description id="crop-d" className="mt-1 text-sm text-muted-foreground">
                    {img ? "Drag to frame it, or use the arrow keys. What's inside the frame is what shows." : isAvatar ? "A square picture works best. JPEG, PNG or WebP, up to 15 MB." : "A wide picture works best (3 to 1). JPEG, PNG or WebP, up to 15 MB."}
                  </Dialog.Description>

                  <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />

                  {!img ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => (e.preventDefault(), pick(e.dataTransfer.files?.[0]))}
                      className={cn("pc-drop mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-[hsl(var(--lime))] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", isAvatar ? "aspect-square" : "aspect-[3/1]")}
                    >
                      <ImageUp className="h-6 w-6" aria-hidden="true" />
                      <span className="font-medium text-foreground">Choose a picture</span>
                      <span>or drop one here</span>
                    </button>
                  ) : (
                    <>
                      <div
                        ref={frameRef}
                        role="group"
                        aria-roledescription="crop frame"
                        tabIndex={0}
                        aria-label={`${isAvatar ? "Picture" : "Cover"} framing. Arrow keys move it, plus and minus zoom.`}
                        onKeyDown={onKey}
                        onPointerDown={(e) => {
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
                        }}
                        onPointerMove={(e) => {
                          const d = drag.current;
                          if (d) setOff(place(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y));
                        }}
                        onPointerUp={() => (drag.current = null)}
                        onPointerCancel={() => (drag.current = null)}
                        onWheel={(e) => zoomTo(zoomRef.current - e.deltaY * 0.002)}
                        className={cn("pc-crop relative mt-5 w-full cursor-grab touch-none select-none overflow-hidden rounded-[22px] bg-secondary active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", isAvatar ? "aspect-square" : "aspect-[3/1]")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src!} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left" style={imgStyle} />
                        {isAvatar && <span aria-hidden="true" className="pc-crop-mask pointer-events-none absolute inset-0" />}
                        <span className="sr-only" aria-live="polite">{`Zoom ${Math.round(zoom * 100)}%`}</span>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <button type="button" onClick={() => zoomTo(zoom - 0.25)} className="pc-ico" aria-label="Zoom out">
                          <Minus className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <label className="flex-1">
                          <span className="sr-only">Zoom</span>
                          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="pc-range w-full" />
                        </label>
                        <button type="button" onClick={() => zoomTo(zoom + 0.25)} className="pc-ico" aria-label="Zoom in">
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {/* The preview: the card's own shape and size, from the same framing. */}
                        <span aria-hidden="true" className={cn("pc-preview relative shrink-0 overflow-hidden bg-secondary hairline", isAvatar ? "h-12 w-12 rounded-full" : "h-8 w-24 rounded-lg")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src!} alt="" className="absolute left-0 top-0 max-w-none origin-top-left" style={img && frame.w ? { width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `scale(${(isAvatar ? 48 : 96) / frame.w}) translate3d(${off.x}px, ${off.y}px, 0)` } : undefined} />
                        </span>
                      </div>
                    </>
                  )}

                  {error && (
                    <p role="alert" className="mt-4 text-sm text-destructive">
                      {error}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    {hasCurrent && !img && (
                      <Button type="button" variant="danger" onClick={remove} disabled={busy} className="mr-auto">
                        {isAvatar ? "Remove picture" : "Remove cover"}
                      </Button>
                    )}
                    {img && (
                      <Button type="button" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                        Choose another
                      </Button>
                    )}
                    <Button type="button" variant="primary" onClick={save} disabled={!img || busy} aria-busy={busy}>
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" disabled={busy} aria-label="Close" className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
