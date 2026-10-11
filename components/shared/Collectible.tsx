"use client";
import { useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import { PlatformGlyph } from "./PlatformIcon";

/**
 * A platform as a small, sticker-bombed collectible object (a real CSS 3D box).
 * Tilt comes from --tx / --ty on any ancestor (see useTilt), so it follows the pointer.
 */
export type CollectibleState = "idle" | "ready" | "reconnect" | "sealed";

interface Spec {
  w: number; // front width (em)
  h: number; // front height
  d: number; // depth
  body: string; // front face fill
  side: string;
  top: string;
  ink: string; // glyph colour
  plate: string; // glyph plate
  label: string;
  tag: string;
  rim: string;
}

const SPEC: Record<Platform, Spec> = {
  instagram: {
    w: 10, h: 9.4, d: 6.2,
    body: "radial-gradient(120% 120% at 15% 110%, #ffd776 0%, #f86a3d 28%, #e3266f 56%, #8e35c9 100%)",
    side: "linear-gradient(180deg,#b0247a,#5e1f8f)",
    top: "linear-gradient(90deg,#f5a3c8,#c58df0)",
    ink: "#fff", plate: "rgba(255,255,255,.16)", label: "REELS", tag: "9:16", rim: "330 90% 66%",
  },
  youtube: {
    w: 11.2, h: 8.2, d: 6.4,
    body: "linear-gradient(160deg,#ff5a52 0%,#e3201b 55%,#b3120f 100%)",
    side: "linear-gradient(180deg,#a3110d,#6d0806)",
    top: "linear-gradient(90deg,#ff958f,#ff6a62)",
    ink: "#fff", plate: "rgba(0,0,0,.18)", label: "SHORTS", tag: "VIRAL", rim: "2 95% 64%",
  },
  x: {
    w: 9.4, h: 9.4, d: 6.8,
    body: "linear-gradient(155deg,#3a3a3e 0%,#141416 60%,#050505 100%)",
    side: "linear-gradient(180deg,#26262a,#0a0a0b)",
    top: "linear-gradient(90deg,#8c8c94,#5a5a60)",
    ink: "#f4f4f4", plate: "rgba(255,255,255,.07)", label: "POST", tag: "280", rim: "220 90% 70%",
  },
};

function Barcode({ className }: { className?: string }) {
  return (
    <span className={cn("sticker block bg-white px-[.35em] pb-[.2em] pt-[.3em]", className)}>
      <span className="block h-[1.3em] w-[3.4em] [background:repeating-linear-gradient(90deg,#111_0_.09em,transparent_.09em_.18em,#111_.18em_.22em,transparent_.22em_.4em,#111_.4em_.55em,transparent_.55em_.64em)]" />
      <span className="mt-[.12em] block text-center font-mono text-[.42em] leading-none tracking-[.12em] text-black">0 4417 92</span>
    </span>
  );
}

export function Collectible({ platform, size = 64, state = "idle", float = false, className }: { platform: Platform; size?: number; state?: CollectibleState; float?: boolean; className?: string }) {
  const s = SPEC[platform];
  const half = s.d / 2;
  return (
    <span
      aria-hidden="true"
      className={cn("collectible relative inline-block", float && "collectible-float", className)}
      style={{ fontSize: size / 10, width: `${s.w + 2}em`, height: `${s.h + 3}em`, ["--rim" as string]: s.rim }}
    >
      {/* floor shadow */}
      <span className="collectible-floor absolute bottom-[.2em] left-1/2 h-[1.6em] w-[85%] -translate-x-1/2 rounded-[50%] bg-black/70 blur-[.8em]" />
      <span className="collectible-box absolute left-1/2 top-[1em]" style={{ width: `${s.w}em`, height: `${s.h}em`, marginLeft: `${-s.w / 2}em` }}>
        {/* top */}
        <span className="face" style={{ width: `${s.w}em`, height: `${s.d}em`, background: s.top, transform: `rotateX(90deg) translateZ(${s.h / 2}em)`, top: `${(s.h - s.d) / 2}em` }} />
        {/* right side */}
        <span className="face" style={{ width: `${s.d}em`, height: `${s.h}em`, background: s.side, transform: `rotateY(90deg) translateZ(${s.w / 2}em)`, left: `${(s.w - s.d) / 2}em` }} />
        {/* left side (visible on strong tilt) */}
        <span className="face" style={{ width: `${s.d}em`, height: `${s.h}em`, background: s.side, transform: `rotateY(-90deg) translateZ(${s.w / 2}em)`, left: `${(s.w - s.d) / 2}em` }} />
        {/* front */}
        <span className="face face-front overflow-hidden" style={{ width: `${s.w}em`, height: `${s.h}em`, background: s.body, transform: `translateZ(${half}em)` }}>
          <span className="absolute inset-0 [background:linear-gradient(125deg,rgba(255,255,255,.42)_0%,rgba(255,255,255,.08)_28%,transparent_45%,transparent_75%,rgba(255,255,255,.12)_100%)]" />
          <span className="absolute left-1/2 top-[46%] grid h-[5em] w-[5em] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.4em]" style={{ background: s.plate, color: s.ink, boxShadow: "inset 0 .12em .3em rgba(255,255,255,.25), inset 0 -.2em .4em rgba(0,0,0,.25)" }}>
            <PlatformGlyph platform={platform} className="h-[3em] w-[3em] drop-shadow-[0_.12em_.12em_rgba(0,0,0,.35)]" />
          </span>
          {/* bottom label strip */}
          <span className="absolute inset-x-[.7em] bottom-[.6em] flex items-center justify-between rounded-[.35em] bg-black/30 px-[.5em] py-[.22em] font-mono text-[.62em] font-bold tracking-[.18em] text-white/90">
            <span>{s.label}</span>
            <span className="opacity-70">No.{platform === "instagram" ? "01" : platform === "youtube" ? "02" : "03"}</span>
          </span>
          {/* stickers, slapped on the front */}
        <span className="sticker absolute left-[.4em] top-[.5em] -rotate-[14deg] rounded-[.4em] bg-[#fff36b] px-[.45em] py-[.18em] font-black text-[.78em] tracking-tight text-black">{s.tag}</span>
        <span className="sticker holo absolute right-[-.5em] top-[-.5em] grid h-[2.6em] w-[2.6em] rotate-[12deg] place-items-center rounded-full">
          <svg viewBox="0 0 24 24" className="h-[1.5em] w-[1.5em]" fill="#fff"><path d="M12 2l2.6 6.9L22 9.5l-5.6 4.7L18.2 22 12 17.8 5.8 22l1.8-7.8L2 9.5l7.4-.6L12 2z" /></svg>
        </span>
        <Barcode className="absolute bottom-[1.6em] right-[-.3em] rotate-[8deg]" />
        {state === "ready" && <span className="sticker absolute bottom-[1.7em] left-[.4em] -rotate-[6deg] rounded-full bg-[#3ee68a] px-[.6em] py-[.2em] text-[.72em] font-black tracking-wide text-black">READY ✓</span>}
        {state === "reconnect" && (
          <span className="sticker absolute left-[-.6em] top-[40%] w-[120%] -rotate-[9deg] py-[.2em] text-center font-mono text-[.66em] font-black tracking-[.2em] text-black [background:repeating-linear-gradient(-45deg,#ffd400_0_.8em,#111_.8em_1.6em)]">
            <span className="bg-[#ffd400] px-[.4em]">RECONNECT</span>
          </span>
        )}
        {state === "sealed" && <span className="sticker absolute bottom-[1.7em] left-[.4em] rotate-[-4deg] rounded-[.3em] bg-white px-[.5em] py-[.2em] font-mono text-[.66em] font-black tracking-[.14em] text-black">OPEN ME</span>}
          {state === "sealed" && <span className="absolute inset-0 [background:linear-gradient(115deg,transparent_30%,rgba(255,255,255,.28)_42%,transparent_50%,transparent_62%,rgba(255,255,255,.16)_70%,transparent_78%)]" />}
        </span>
      </span>

    </span>
  );
}

/** Pointer tilt for any card holding a Collectible. */
export function useTilt(max = 14) {
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      e.currentTarget.style.setProperty("--ty", String(x * max * 2));
      e.currentTarget.style.setProperty("--tx", String(-y * max));
    },
    [max],
  );
  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty("--ty", "0");
    e.currentTarget.style.setProperty("--tx", "0");
  }, []);
  return { onPointerMove, onPointerLeave };
}
