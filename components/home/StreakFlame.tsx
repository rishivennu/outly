"use client";
import { useEffect, useState } from "react";
import { Pip, type PipMood } from "@/components/brand/Pip";
import { usePipAntics } from "@/components/brand/usePipAntics";
import { cn } from "@/lib/utils";
import { streakTier } from "./streak-tier";


const TIER = [
  { scale: 0.84, flick: "0s", sparks: 0, outer: "#ece5d6", mid: "#dcd2bf", core: "#f7f2e8", aura: null, bg: "hsl(var(--secondary))" },
  { scale: 0.88, flick: "1.7s", sparks: 2, outer: "#ffc21a", mid: "#ff9a1a", core: "#fff3b0", aura: null, bg: "linear-gradient(160deg, #ffb35c, #ff8a2a)" },
  { scale: 0.95, flick: "1.25s", sparks: 4, outer: "#ffc21a", mid: "#ff7a1a", core: "#fff0a0", aura: null, bg: "linear-gradient(160deg, #ffa547, #ff6f1a)" },
  { scale: 1, flick: "1s", sparks: 6, outer: "#ffb21a", mid: "#ff5a1f", core: "#ffe680", aura: "#ff3d6a", bg: "linear-gradient(160deg, #ff9640, #f2522a)" },
  { scale: 1.05, flick: "0.8s", sparks: 9, outer: "#ffd23d", mid: "#ff4d1f", core: "#c8f2ff", aura: "#ff2d8a", bg: "linear-gradient(160deg, #ff7a3d, #e3336b)" },
] as const;

// Chunky, flat flame like a sticker: outer tongue, middle tongue, a pale heart Pip sits in.
const OUTER = "M100 6C118 40 150 52 160 92C166 76 164 62 158 50C186 76 196 116 190 148C184 188 148 214 100 214C52 214 16 188 10 148C4 112 22 84 44 66C42 82 46 94 54 102C56 62 80 36 100 6Z";
const MID = "M100 52C112 78 136 92 142 120C146 106 146 98 142 88C160 106 168 132 162 156C156 184 130 204 100 204C70 204 44 184 38 156C33 130 46 110 62 98C62 110 66 118 72 124C74 96 88 76 100 52Z";
const CORE = "M100 104C112 124 132 134 134 158C136 182 120 198 100 198C80 198 64 182 66 158C68 136 88 124 100 104Z";

const weekStamp = () => Math.floor(Date.now() / (7 * 86_400_000));

/**
 * Pip inside the streak flame. Bigger, hotter and livelier as the streak grows. Pip is happy while a
 * streak is alive, cheers once when this week's goal turns it up, and babbles when the page sits idle.
 * Decorative: the card beside it states the streak in words.
 */
export function StreakFlame({ streak, met, className }: { streak: number; met: boolean; className?: string }) {
  const tier = streakTier(streak);
  const t = TIER[tier];
  const act = usePipAntics(9000, 2800);
  const [cheer, setCheer] = useState(false);

  useEffect(() => {
    if (!met || streak <= 0) return;
    const k = `outly-streak-cheer-${weekStamp()}-${streak}`;
    try {
      if (localStorage.getItem(k)) return;
    } catch {}
    setCheer(true);
    // Mark it seen only once the cheer has actually played, so a StrictMode re-run can't swallow it.
    const id = window.setTimeout(() => {
      setCheer(false);
      try { localStorage.setItem(k, "1"); } catch {}
    }, 4200);
    return () => window.clearTimeout(id);
  }, [met, streak]);

  const mood: PipMood = act ? act.mood : cheer || streak > 0 ? "happy" : "wait";
  const say = act ? act.say : cheer ? `${streak} week${streak === 1 ? "" : "s"}! yay` : null;
  const sparks = Array.from({ length: t.sparks }, (_, i) => ({ left: 16 + ((i * 37) % 66), delay: ((i * 0.37) % 2.2).toFixed(2), dx: ((i % 3) - 1) * 14, size: 4 + (i % 3) * 2 }));

  return (
    <div className={cn("relative", className)} aria-hidden="true" data-tier={tier}>
      {say && <span key={say} className="pip-bubble">{say}</span>}
      <div
        className={cn("sf-stage aspect-square w-full", tier === 0 && "sf-still", cheer && "sf-cheer")}
        style={{ background: t.bg, ["--sf-scale" as string]: t.scale, ["--sf-flick" as string]: t.flick }}
      >
        <svg viewBox="0 0 200 220" className="sf-flame absolute inset-x-[7%] bottom-0 top-[5%] h-[95%] w-[86%]" preserveAspectRatio="xMidYMax meet">
          {t.aura && <path d={OUTER} className="sf-aura" fill={t.aura} opacity="0.4" />}
          <path d={OUTER} className="sf-l" fill={t.outer} />
          <path d={MID} className="sf-l sf-l2" fill={t.mid} />
          <path d={CORE} className="sf-l sf-l3" fill={t.core} />
        </svg>
        {sparks.map((s, i) => (
          <span key={i} className="sf-spark" style={{ left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, ["--dx" as string]: `${s.dx}px` }} />
        ))}
        <Pip size={80} mood={mood} situation={act ? "idle" : "streak"} className="sf-pip" />
      </div>
    </div>
  );
}
