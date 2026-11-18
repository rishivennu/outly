"use client";
import { useRef } from "react";
import { motion } from "framer-motion";
import { Check, Eye, Hash, Megaphone, Pencil, RefreshCw, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Textarea } from "@/components/ui/field";
import { ADAPT_MAX, ADAPT_TONES, CTA_PREFIX, KEYWORDS_PREFIX, withLine, type AdaptTone } from "@/lib/ai/adapt-core";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";
import type { WatchState } from "./types";

interface Props {
  story: string;
  onStory: (s: string) => void;
  /** While Pip writes: how many places are finished out of how many were asked for. */
  progress: { done: number; total: number } | null;
  /** How many places are switched on right now. */
  places: number;
  /** At least one place has a caption from Pip, so the "different take" asks are worth showing. */
  adapted: boolean;
  tone: AdaptTone | null;
  /** Too little to go on: Pip's one question, with the creator free to go ahead anyway. */
  clarify: string | null;
  watch: WatchState;
  /** Over three minutes or landscape: watching it takes longer, so it is never started on its own. */
  longForm: boolean;
  online: boolean;
  onGenerate: (o?: { tone?: AdaptTone; noClarify?: boolean }) => void;
  onStop: () => void;
  onUseAsIs: () => void;
  onAnalyze: () => void;
  onUseWatched: (edit: boolean) => void;
  onDismissClarify: () => void;
  /** R1198: the autosave line ("Saved just now"), so the creator sees their words are kept. */
  status?: string | null;
  className?: string;
}

/** R1198: the one writing box on Your Story. */
export const CAPTION_PLACEHOLDER = "Write your caption, describe your video, or tell Pip what you want your audience to know...";
const EXAMPLE = "I tried the 5am routine for 30 days. Days 1 to 4 were rough, by week two I was getting more done before 9am than I used to all morning. Here's what actually made it work.";

/**
 * 1190 Step 2, the one place a creator writes. One message in their own words, then Pip adapts it to every
 * place they post: same meaning, same facts, same voice, written the way each platform reads. The text lives
 * in the draft's own story field, so it is saved and restored like everything else here.
 */
export function StoryComposer(p: Props) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const busy = !!p.progress;
  const enough = p.story.trim().length > 0;
  const watching = p.watch.kind === "watching";

  /** The CTA and Keywords chips: a labelled line, or the cursor on the one already there. */
  const addLine = (prefix: string) => {
    const { text, caret } = withLine(p.story, prefix);
    p.onStory(text);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      el.scrollTop = el.scrollHeight;
    });
  };

  return (
    <section aria-labelledby="your-caption" className={cn("glass rounded-[24px] p-4 sm:p-5", p.className)}>
      {/* R1198: one editor, "Your caption". Pip writes each platform's version from it; nothing needs the video read first. */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="your-caption" className="text-[clamp(1.2rem,1.05rem+0.5vw,1.5rem)] font-semibold leading-tight tracking-[-0.02em]">
          <label htmlFor="story-box">Your caption</label>
        </h2>
        <Counter value={p.story.length} max={ADAPT_MAX} />
      </div>
      <p className="mt-1 max-w-[60ch] text-pretty text-[13px] leading-relaxed text-muted-foreground">
        Write it once in your own words. Pip writes a version for each platform you picked, and you approve every one.
      </p>

      <div className="mt-3.5">
        <Textarea
          id="story-box"
          ref={box}
          rows={6}
          value={p.story}
          maxLength={ADAPT_MAX}
          onChange={(e) => p.onStory(e.target.value)}
          placeholder={CAPTION_PLACEHOLDER}
          aria-describedby="story-box-status"
          className="min-h-[148px] text-[15px]"
        />
        <p id="story-box-status" className="mt-1 text-xs text-muted-foreground">
          {p.status || "Saves as you type."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Add to your message">
          <Chip onClick={() => addLine(CTA_PREFIX)} icon={<Megaphone className="h-3.5 w-3.5" aria-hidden="true" />}>
            Call to action
          </Chip>
          <Chip onClick={() => addLine(KEYWORDS_PREFIX)} icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
            Keywords
          </Chip>
          {!p.story.trim() && (
            <Chip onClick={() => (p.onStory(EXAMPLE), box.current?.focus())}>Use an example</Chip>
          )}
        </div>
      </div>

      {p.clarify && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.card} className="mt-3 rounded-2xl bg-secondary/60 p-3.5 hairline">
          <p className="text-[13px] leading-snug text-foreground">{p.clarify}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button type="button" variant="subtle" size="sm" className="min-h-11 rounded-full px-3.5" onClick={() => (p.onDismissClarify(), box.current?.focus())}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              I&apos;ll add more
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={() => p.onGenerate({ noClarify: true })}>
              Go ahead anyway
            </Button>
          </div>
        </motion.div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {busy ? (
          <>
            <Button type="button" variant="lime" className="min-h-12 flex-1 rounded-full px-5 sm:flex-none" disabled aria-live="polite">
              <Sparkles className="mr-1.5 h-4 w-4 motion-safe:animate-pulse" aria-hidden="true" />
              Writing for {Math.min(p.progress!.done + 1, p.progress!.total)} of {p.progress!.total} {p.progress!.total === 1 ? "place" : "places"}…
            </Button>
            <Button type="button" variant="subtle" className="min-h-12 rounded-full px-4" onClick={p.onStop}>
              <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Stop
            </Button>
          </>
        ) : (
          <Button type="button" variant="lime" className="min-h-12 w-full rounded-full px-5" disabled={!enough || !p.places || p.online === false} onClick={() => p.onGenerate()}>
            {p.adapted ? <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            {p.adapted ? "Write them again" : "Generate captions with Pip AI"}
          </Button>
        )}
        {!busy && enough && (
          <Button type="button" variant="ghost" className="min-h-12 rounded-full px-4 text-[13px]" onClick={p.onUseAsIs}>
            Use my text as it is
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs leading-snug text-muted-foreground" aria-live="polite">
        {p.online === false
          ? "You're offline. Your words are saved, and Pip can write as soon as you reconnect."
          : !p.places
            ? "Pick at least one place below first."
            : !enough
              ? "A sentence or two is plenty."
              : busy
                ? "Each place appears the moment it's written."
                : `Pip writes for the ${p.places === 1 ? "place" : `${p.places} places`} you picked below. Nothing is posted yet.`}
      </p>

      <div className="mt-4 border-t border-border/60 pt-3.5">
        {p.watch.kind === "ready" ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.card}>
            <p className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Eye className="h-3.5 w-3.5 text-lime" aria-hidden="true" />
              Pip watched your video
            </p>
            {p.watch.seen && <p className="mt-1 text-xs leading-snug text-muted-foreground">{p.watch.seen}</p>}
            <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-secondary/60 px-3 py-2.5 text-[13px] leading-snug hairline" dir="auto">
              {p.watch.story}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button type="button" variant="subtle" size="sm" className="min-h-11 rounded-full px-3.5" onClick={() => p.onUseWatched(true)}>
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Put it in the box
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onAnalyze}>
                Watch it again
              </Button>
            </div>
          </motion.div>
        ) : (
          <>
            <Button type="button" variant="subtle" size="sm" className="min-h-11 rounded-full px-3.5" disabled={watching || p.online === false} onClick={p.onAnalyze}>
              <Eye className={cn("mr-1.5 h-3.5 w-3.5", watching && "motion-safe:animate-pulse")} aria-hidden="true" />
              {watching ? "Watching your video…" : "Analyze my video for more accurate captions"}
            </Button>
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {watching
                ? "You can keep typing. Your words always win."
                : p.watch.kind === "failed"
                  ? "Pip couldn't watch it just now, the AI was busy. Your own words work just as well."
                  : p.longForm
                    ? "Pip reads a few frames and your subtitles. On a longer video this takes a little longer, so it only runs when you ask."
                    : "Pip reads a few frames and your subtitles, then suggests the message for you."}
            </p>
          </>
        )}
      </div>

      {p.adapted && !busy && (
        <div className="mt-4 border-t border-border/60 pt-3.5">
          <p className="text-[13px] font-semibold">Want a different take?</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Ask Pip for a different take">
            {ADAPT_TONES.map((t) => (
              <Chip key={t.id} onClick={() => p.onGenerate({ tone: t.id })} pressed={p.tone === t.id}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Chip({ children, icon, onClick, pressed }: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition hairline motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        pressed ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
