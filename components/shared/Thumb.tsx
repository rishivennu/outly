"use client";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Poster that previews on hover: plays the real video when we have one, otherwise a slow Ken Burns drift. */
export function Thumb({ src, video, alt, className, playOnHover = true }: { src: string | null; video?: string | null; alt: string; className?: string; playOnHover?: boolean }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div
      className={cn("relative overflow-hidden bg-muted", className)}
      onMouseEnter={() => {
        if (!playOnHover) return;
        setHover(true);
        ref.current?.play().catch(() => {});
      }}
      onMouseLeave={() => {
        setHover(false);
        if (ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0;
        }
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" style={{ animation: hover && !video ? "kenburns 4s var(--ease-out) forwards" : undefined }} />
      ) : (
        <div className="skeleton absolute inset-0" aria-hidden="true" />
      )}
      {video && playOnHover && <video ref={ref} src={video} muted loop playsInline preload="none" aria-hidden="true" className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", hover ? "opacity-100" : "opacity-0")} />}
    </div>
  );
}
