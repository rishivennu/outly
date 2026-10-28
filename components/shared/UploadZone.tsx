"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Rocket, Sparkles, UploadCloud } from "lucide-react";
import { Collectible } from "./Collectible";
import { MAX_MB, validateVideoFile } from "@/lib/client/handoff";
import { cn } from "@/lib/utils";

interface Props {
  onFile: (f: File) => void;
  compact?: boolean;
  /** Shows the "Your video is in" moment inside the zone. */
  accepted?: boolean;
}

const ORBS = [
  { p: "instagram" as const, x: "-6%", y: "18%", rot: -8, delay: 0 },
  { p: "youtube" as const, x: "96%", y: "8%", rot: 6, delay: 0.8 },
  { p: "x" as const, x: "90%", y: "78%", rot: -4, delay: 1.6 },
];
const STICKERS = [
  { icon: Sparkles, label: "AI Caption", x: "4%", y: "84%", rot: -5, delay: 0.4 },
  { icon: Clapperboard, label: "Auto Format", x: "72%", y: "-4%", rot: 4, delay: 1.2 },
  { icon: Rocket, label: "Publish Everywhere", x: "-10%", y: "52%", rot: 3, delay: 2 },
];

export function UploadZone({ onFile, compact, accepted }: Props) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const take = useCallback(
    (f?: File | null) => {
      if (!f) return;
      const e = validateVideoFile(f);
      setError(e);
      if (!e) onFile(f);
    },
    [onFile],
  );

  // Whole-window drag awareness: the zone wakes up as soon as a file enters the page.
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth.current++;
      setOver(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const prevent = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      take(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", drop);
    };
  }, [take]);

  return (
    <div data-guide="create-upload" className={cn("relative mx-auto w-full", compact ? "max-w-[560px]" : "max-w-[760px]")}>
      {/* Energy glow behind the blob */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -inset-y-[12%] -z-10 blur-[70px]"
        animate={{ opacity: over ? 0.85 : 0.35, scale: over ? 1.08 : 1 }}
        transition={{ duration: 0.4 }}
        style={{ background: "radial-gradient(40% 45% at 35% 45%, hsl(var(--lime)/0.45), transparent 70%), radial-gradient(35% 40% at 68% 58%, hsl(var(--energy-a)/0.4), transparent 70%), radial-gradient(30% 30% at 55% 25%, hsl(var(--energy-c)/0.3), transparent 70%)" }}
      />

      <motion.button
        type="button"
        onClick={() => input.current?.click()}
        aria-describedby={hintId}
        aria-label="Upload a video. Drop a file here or press to browse."
        animate={{ scale: over ? 1.035 : 1 }}
        whileHover={{ scale: over ? 1.035 : 1.012 }}
        whileTap={{ scale: 0.99 }}
        className={cn(
          "animate-morph group relative flex w-full flex-col items-center justify-center overflow-hidden text-center outline-none transition-colors duration-300 focus-visible:outline-2",
          compact ? "aspect-[16/10]" : "aspect-[16/10] sm:aspect-[16/9]",
          over ? "bg-[hsl(var(--card))]" : "bg-card/80",
        )}
        style={{ boxShadow: over ? "inset 0 0 0 2px hsl(var(--lime)/0.85)" : "inset 0 0 0 1px hsl(var(--foreground)/0.1)" }}
      >
        <motion.div
          aria-hidden="true"
          className="absolute inset-0"
          animate={{ opacity: over ? 1 : 0.5 }}
          style={{ background: "radial-gradient(60% 70% at 50% 110%, hsl(var(--lime)/0.22), transparent 70%), radial-gradient(50% 60% at 20% 0%, hsl(var(--energy-a)/0.16), transparent 70%)" }}
        />
        <div className="grain absolute inset-0" aria-hidden="true" />

        <AnimatePresence mode="wait" initial={false}>
          {accepted ? (
            <motion.div key="in" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative">
              <p className="display text-[clamp(2.2rem,6vw,4.5rem)]">Your video is in.</p>
              <p className="mt-4 text-muted-foreground">Opening your workspace…</p>
            </motion.div>
          ) : (
            <motion.div key={over ? "over" : "idle"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="relative flex flex-col items-center px-6">
              <motion.span animate={{ y: over ? -6 : 0, rotate: over ? -8 : 0 }} className="lime-bg lime-glow mb-6 grid h-16 w-16 place-items-center rounded-full">
                <UploadCloud className="h-7 w-7" strokeWidth={2} />
              </motion.span>
              <span className={cn("display block", compact ? "text-[clamp(1.8rem,4vw,2.6rem)]" : "text-[clamp(2rem,5vw,3.6rem)]")}>
                {over ? "Drop it. Let’s make something." : "Drop your video here"}
              </span>
              {!over && <span className="mt-3 text-[15px] text-foreground/80 underline decoration-foreground/30 underline-offset-4 group-hover:decoration-foreground">or click to browse</span>}
              <span id={hintId} className="mt-5 text-[13px] text-muted-foreground">MP4 or MOV · Up to {MAX_MB} MB</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Floating destinations: drift idly, rush toward the zone while a file hovers. */}
      {!compact &&
        ORBS.map((o) => (
          <motion.div
            key={o.p}
            aria-hidden="true"
            className="pointer-events-none absolute hidden sm:block"
            style={{ left: o.x, top: o.y }}
            animate={over ? { x: o.x.startsWith("-") ? 70 : -70, y: o.y === "78%" ? -40 : 30, scale: 1.15 } : { x: 0, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
          >
            <div className="animate-drift" style={{ ["--rot" as string]: `${o.rot}deg`, animationDelay: `${o.delay}s` }}>
              <Collectible platform={o.p} size={60} float />
            </div>
          </motion.div>
        ))}
      {!compact &&
        STICKERS.map(({ icon: Icon, label, x, y, rot, delay }) => (
          <motion.div key={label} aria-hidden="true" className="pointer-events-none absolute hidden md:block" style={{ left: x, top: y }} animate={{ opacity: over ? 0 : 1, scale: over ? 0.85 : 1 }}>
            <div className="animate-drift glass flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium hairline" style={{ ["--rot" as string]: `${rot}deg`, animationDelay: `${delay}s` }}>
              <Icon className="h-3.5 w-3.5 text-lime-ink" aria-hidden="true" /> {label}
            </div>
          </motion.div>
        ))}

      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <AnimatePresence>
        {error && (
          <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 text-center text-[15px] text-destructive">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
