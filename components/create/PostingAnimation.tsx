"use client";
import { useEffect, useState } from "react";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";

/*
 * Shown while a post is going out (10-15e). Three soft grainy ribbons of light (lime, indigo, green)
 * flow into one glass pill that names the place being sent to, cycling through every place still
 * in flight, with Pip flying on top. Decorative: PublishingView's live header and the per-place cards
 * carry the real state, so this is aria-hidden. Reduced motion: still ribbons, no cycling.
 */
export function PostingAnimation({ platforms }: { platforms: Platform[] }) {
  const [i, setI] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (still || platforms.length < 2) return;
    const t = window.setInterval(() => setI((n) => n + 1), 1800);
    return () => window.clearInterval(t);
  }, [still, platforms.length]);

  const p = platforms.length ? platforms[i % platforms.length] : null;
  return (
    <div className="pa-stage" aria-hidden="true">
      <span className="pa-ribbon pa-r1" />
      <span className="pa-ribbon pa-r2" />
      <span className="pa-ribbon pa-r3" />
      <span className="pa-grain auth-grain" />
      <div className="pa-pill-wrap">
        <Pip size={58} mood="fly" className="pa-pip" />
        <div className="pa-pill">
          {p && (
            <span key={`o-${p}-${i}`} className="pa-swap">
              <PlatformOrb platform={p} size={26} />
            </span>
          )}
          <span key={`t-${p}-${i}`} className="pa-swap pa-text">
            {p ? `Posting to ${PLATFORM_META[p].name}` : "Posting"}
            <span className="pa-dots">
              <i />
              <i />
              <i />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
