"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { BrandGlyph } from "@/components/brand/brands";
import { LAND_H, LAND_W, isLand } from "./land";
import { ORBIT } from "./orbit";

// The canvas globe is its own chunk: phones never download it, and nothing waits on it to paint.
const CanvasGlobe = dynamic(() => import("./CanvasGlobe"), { ssr: false });

type Mode = "wait" | "canvas" | "css" | "still";

/**
 * The waitlist globe (1061). Picks the right globe for the device:
 * - desktop, fine pointer: the canvas globe (CanvasGlobe), loaded after first paint;
 * - phones, tablets, Save-Data: a CSS globe whose map slides inside a shaded circle, moved only by compositor
 *   transforms, so no script runs per frame (fewer icons, one arc, slower turn);
 * - a desktop that can't keep up: the same CSS globe, held completely still;
 * - reduced motion: a still frame either way, nothing moving.
 * A lime sphere placeholder is in the server HTML and cross-fades away once the real globe has drawn.
 */
export function GlobeStage() {
  const [mode, setMode] = useState<Mode>("wait");
  const [reduce, setReduce] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lite = window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    setReduce(rm.matches);
    setMode(lite || saveData ? "css" : "canvas");
    const on = () => setReduce(rm.matches);
    rm.addEventListener("change", on);
    return () => rm.removeEventListener("change", on);
  }, []);

  return (
    <div className="wl-globe" data-ready={ready || undefined} data-mode={mode} aria-hidden="true">
      <span className="wl-globe-ph" />
      {mode === "canvas" && <CanvasGlobe still={reduce} onReady={() => setReady(true)} onSlow={() => { setReady(false); setMode("still"); }} />}
      {(mode === "css" || mode === "still") && <CssGlobe moving={mode === "css" && !reduce} breathe={mode === "css" && !reduce} onReady={() => setReady(true)} />}
    </div>
  );
}

/** The flat dot map, drawn once into an image; CSS repeats it side by side so the slide loops. */
function useDotMap() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const W = 1080;
    const H = 540;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (!g) return;
    const step = 2; // every other cell: 3 degrees a dot
    const cw = W / LAND_W;
    const ch = H / LAND_H;
    g.fillStyle = "rgb(180,255,70)";
    for (let y = 0; y < LAND_H; y += step) {
      const lat = 90 - ((y + 0.5) * 180) / LAND_H;
      for (let x = 0; x < LAND_W; x += step) {
        const lng = ((x + 0.5) * 360) / LAND_W - 180;
        if (!isLand(lat, lng)) continue;
        g.beginPath();
        g.arc((x + 1) * cw, (y + 1) * ch, 1.7, 0, Math.PI * 2);
        g.fill();
      }
    }
    let made: string | null = null;
    let dead = false;
    c.toBlob((b) => {
      if (!b || dead) return; // unmounted before the image was ready: never create a URL nobody revokes
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, []);
  return url;
}

function CssGlobe({ moving, breathe, onReady }: { moving: boolean; breathe: boolean; onReady: () => void }) {
  const url = useDotMap();
  const told = useRef(false);
  useEffect(() => {
    if (url && !told.current) {
      told.current = true;
      onReady();
    }
  }, [url, onReady]);
  return (
    <div className="wl-cglobe" data-moving={moving || undefined} data-breathe={breathe || undefined}>
      <span className="wl-cglobe-glow" />
      <svg className="wl-cglobe-ring" viewBox="-100 -100 200 200" aria-hidden="true">
        <ellipse cx="0" cy="0" rx="92" ry="30" transform="rotate(-14)" />
      </svg>
      <div className="wl-cglobe-sphere">
        <div className="wl-cglobe-strip" style={url ? { backgroundImage: `url(${url})` } : undefined} />
        <svg className="wl-cglobe-arc" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M30 40 Q 52 14 74 46" pathLength="100" />
        </svg>
        <span className="wl-cglobe-pulse" style={{ left: "30%", top: "40%" }} />
        <span className="wl-cglobe-pulse" style={{ left: "74%", top: "46%", animationDelay: "-1.4s" }} />
        <span className="wl-cglobe-pulse" style={{ left: "55%", top: "64%", animationDelay: "-2.6s" }} />
        <span className="wl-cglobe-shade" />
      </div>
      <div className="wl-corbit">
        {ORBIT.slice(0, 3).map((o, i) => (
          <span key={o.brand} className="wl-corb-x" style={{ animationDelay: `${-i * 8}s` }}>
            <span className="wl-corb-y" style={{ animationDelay: `${-i * 8 - 6}s` }}>
              <span className="wl-orb wl-orb-sm">
                <BrandGlyph brand={o.brand} className="h-[15px] w-[15px]" />
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
