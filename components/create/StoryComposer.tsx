"use client";
import { useRef, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Check, Eye, Hash, Megaphone, PenLine, RotateCcw, Sparkles, Undo2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Textarea } from "@/components/ui/field";
import { ADAPT_MAX, CTA_PREFIX, KEYWORDS_PREFIX, withLine } from "@/lib/ai/adapt-core";
import { REFINE_ASKS, type CaptionAsk } from "@/lib/ai/pip-asks";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";
import type { CaptionMode } from "./story-meta";
import type { WatchState } from "./types";

interface Props {
  /** R1209 A1: who writes the main caption. Only that way shows; the other box is kept (story-meta). */
  mode: CaptionMode;
  onMode: (m: CaptionMode) => void;
  /** The open box: the main caption itself. */
  story: string;
  onStory: (s: string) => void;
  watch: WatchState;
  /** Over three minutes or landscape: watching it takes longer, so it is never started on its own. */
  longForm: boolean;
  online: boolean;
  /** Outlly's latest caption for this video, untouched ("" before it has written one). */
  original: string;
  /** Generate, or Regenerate, the caption from the video. */
  onGenerate: () => void;
  onRestore: () => void;
  /** Use this caption: on to Everywhere with it. */
  onUse: () => void;
  /** The refinement or rephrase on its way, if any. */
  asking: CaptionAsk | null;
  onAsk: (a: CaptionAsk) => void;
  /** Write my own, after a rewrite was accepted: the creator's own words are one tap away. */
  canBack?: boolean;
  onBack?: () => void;
  /** R1198: the autosave line ("Saved just now"), so the creator sees their words are kept. */
  status?: string | null;
  /**
   * A rewrite of the caption (a refinement, a rephrase or a fresh one from the video). It waits here, beside the
   * words it would replace, until the creator accepts, edits or skips it: Outlly never writes over their words.
   * `stale`: the caption was edited after it was asked for.
   */
  suggestion?: { text: string; why: string; label: string; from: string; stale: boolean } | null;
  onApply?: () => void;
  onEditSuggestion?: () => void;
  onSkip?: () => void;
  className?: string;
}

/** R1198: the one writing box on Your Story (Write my own). */
export const CAPTION_PLACEHOLDER = "Write your caption or describe what you want your audience to know...";
export const GENERATE_PLACEHOLDER = "Outlly's caption for your video appears here.";
export const CAPTION_MODES: { id: CaptionMode; label: string }[] = [
  { id: "generate", label: "Generate with Outlly" },
  { id: "own", label: "Write my own" },
];
const EXAMPLE = "I tried the 5am routine for 30 days. Days 1 to 4 were rough, by week two I was getting more done before 9am than I used to all morning. Here's what actually made it work.";

/**
 * 1190 Step 2, the one place a creator writes the main caption. R1209: this step only writes it; the platform
 * captions are written from it on Everywhere, once, so moving between steps never asks Outlly twice. R1209 A1: it
 * answers "who writes it, Outlly or me?" with one box either way: Outlly's caption from the video it already
 * watched, refined on request, or the creator's own, rephrased on request. Both are saved with the draft.
 */
export function StoryComposer(p: Props) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const gen = p.mode === "generate";
  const watching = p.watch.kind === "watching";
  const failed = p.watch.kind === "failed";
  const has = p.story.trim().length > 0;
  const offline = p.online === false;
  const busy = p.asking !== null;
  const canRestore = gen && !!p.original.trim() && p.story.trim() !== p.original.trim();

  const focusBox = () =>
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
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
  /** Arrow keys, Home and End move between the two modes, as a tab list does. */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = CAPTION_MODES.length;
    const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    p.onMode(CAPTION_MODES[j].id);
    tabs.current[j]?.focus();
  };

  const lead = gen
    ? watching && !has
      ? "Outlly is watching your video and writing your caption. It appears here in a moment."
      : has
        ? "Written by Outlly from your video. Edit it, refine it, or use it as it is."
        : "Outlly writes your caption from the video you added. Nothing to explain, nothing to type."
    : "Type or paste your caption. Outlly can rephrase it, and nothing changes until you accept.";

  return (
    <section aria-labelledby="your-caption" className={cn("glass rounded-[24px] p-4 sm:p-5", p.className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="your-caption" className="text-[clamp(1.2rem,1.05rem+0.5vw,1.5rem)] font-semibold leading-tight tracking-[-0.02em]">
          <label htmlFor="story-box">Your caption</label>
        </h2>
        <Counter value={p.story.length} max={ADAPT_MAX} />
      </div>

      {/* R1209 A1: one question first, who writes it. Only the way picked shows; both boxes are kept. */}
      <div role="tablist" aria-label="Who writes your caption" className="gseg mt-3 grid grid-cols-2 gap-1 rounded-full bg-secondary/70 p-1 hairline">
        {CAPTION_MODES.map((m, i) => {
          const on = p.mode === m.id;
          return (
            <button
              key={m.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`caption-mode-${m.id}`}
              aria-selected={on}
              aria-controls="caption-mode-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => p.onMode(m.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on ? "bg-card text-foreground shadow-[0_1px_3px_hsl(var(--foreground)/0.1)]" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
              )}
            >
              {m.id === "generate" ? <Sparkles className={cn("h-3.5 w-3.5 shrink-0", on && "text-lime-ink")} aria-hidden="true" /> : <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{m.label}</span>
            </button>
          );
        })}
      </div>

      <div id="caption-mode-panel" role="tabpanel" aria-labelledby={`caption-mode-${p.mode}`} className="mt-3" data-caption-mode={p.mode}>
        <p className="max-w-[60ch] text-pretty text-[13px] leading-relaxed text-muted-foreground">{lead}</p>
        <Textarea
          id="story-box"
          ref={box}
          rows={gen ? 6 : 8}
          value={p.story}
          maxLength={ADAPT_MAX}
          onChange={(e) => p.onStory(e.target.value)}
          placeholder={gen ? GENERATE_PLACEHOLDER : CAPTION_PLACEHOLDER}
          aria-describedby="story-box-status"
          aria-busy={gen && watching ? true : undefined}
          className={cn("mt-2.5 text-[15px]", gen ? "min-h-[148px]" : "min-h-[200px]")}
        />
        <p id="story-box-status" className="mt-1 text-xs text-muted-foreground">
          {p.status || "Saves as you type."}
        </p>

        {gen ? (
          has ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" variant="lime" size="sm" className="min-h-11 rounded-full px-4" onClick={p.onUse}>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Use this caption
                </Button>
                <Button type="button" variant="subtle" size="sm" className="min-h-11 rounded-full px-3.5" onClick={focusBox}>
                  <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Edit caption
                </Button>
                <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" disabled={watching || offline} onClick={p.onGenerate}>
                  <RotateCcw className={cn("mr-1.5 h-3.5 w-3.5", watching && "motion-safe:animate-spin")} aria-hidden="true" />
                  {watching ? "Writing a new one…" : "Regenerate caption"}
                </Button>
                {canRestore && (
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onRestore}>
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Restore original
                  </Button>
                )}
              </div>
              <div className="mt-3.5" role="group" aria-labelledby="refine-label">
                <p id="refine-label" className="text-xs font-semibold text-muted-foreground">
                  Refine it, if you like
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {REFINE_ASKS.map((a) => (
                    <Chip key={a.id} onClick={() => p.onAsk(a.id)} disabled={busy || offline || watching} pressed={p.asking === a.id}>
                      {p.asking === a.id ? "Working on it…" : a.label}
                    </Chip>
                  ))}
                </div>
                {offline && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">You&apos;re offline. Outlly can refine it when you reconnect.</p>}
              </div>
            </>
          ) : (
            <div className="mt-3">
              {watching ? (
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Eye className="h-3.5 w-3.5 text-lime-ink motion-safe:animate-pulse" aria-hidden="true" />
                  Watching your video…
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="lime" size="sm" className="min-h-11 rounded-full px-4" disabled={offline} onClick={p.onGenerate}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    {failed ? "Try again" : "Generate caption"}
                  </Button>
                  {!!p.original.trim() && (
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onRestore}>
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Restore original
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                {watching
                  ? "You can type in the box while it works. Your words always win."
                  : offline
                    ? "You're offline. Outlly can write it when you reconnect, or write your own."
                    : failed
                      ? p.watch.kind === "failed" && p.watch.why
                        ? p.watch.why
                        : "Outlly couldn't write it just now, the AI was busy. Try again, or write your own."
                      : p.longForm
                        ? "Outlly reads a few frames and your subtitles. On a longer video this takes a little longer, so it runs when you ask."
                        : "Outlly reads a few frames and your subtitles, then writes the caption."}
              </p>
            </div>
          )
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Add to your message">
              <Chip onClick={() => addLine(CTA_PREFIX)} icon={<Megaphone className="h-3.5 w-3.5" aria-hidden="true" />}>
                Call to action
              </Chip>
              <Chip onClick={() => addLine(KEYWORDS_PREFIX)} icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
                Keywords
              </Chip>
              {!has && <Chip onClick={() => (p.onStory(EXAMPLE), box.current?.focus())}>Use an example</Chip>}
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="lime"
                className="min-h-11 w-full rounded-full px-5 sm:w-auto"
                disabled={p.story.trim().length < 3 || busy || offline}
                onClick={() => p.onAsk("rephrase")}
                aria-describedby="rephrase-hint"
              >
                <Wand2 className={cn("mr-1.5 h-4 w-4", p.asking === "rephrase" && "motion-safe:animate-pulse")} aria-hidden="true" />
                {p.asking === "rephrase" ? "Rephrasing…" : "Rephrase with Outlly Assistant"}
              </Button>
              {p.canBack && (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onBack}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Back to my original
                </Button>
              )}
            </div>
            <p id="rephrase-hint" className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {offline
                ? "You're offline. Outlly can rephrase it when you reconnect."
                : p.story.trim().length < 3
                  ? "Write a sentence or two, then Outlly can rephrase it."
                  : "A sharper hook, clearer sentences and a clear call to action. Same meaning, nothing made up."}
            </p>
          </>
        )}
      </div>

      {p.suggestion && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.card} role="group" aria-labelledby="caption-suggestion" className="mt-4 rounded-2xl bg-secondary/60 p-3.5 hairline" data-caption-suggestion>
          <p id="caption-suggestion" className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-lime-ink" aria-hidden="true" />
            Suggested caption
            <span className="font-normal text-muted-foreground">({p.suggestion.label})</span>
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{p.suggestion.why || "Nothing changes until you accept it."}</p>
          <div className="mt-2.5 grid gap-2 lg:grid-cols-2">
            <Pane label={gen ? "Current" : "Your original"} text={p.suggestion.from} />
            <Pane label="Suggested" text={p.suggestion.text} strong />
          </div>
          {p.suggestion.stale && <p className="mt-2 text-xs leading-snug text-muted-foreground">You edited your caption after asking. Accepting replaces it with this version.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="lime" size="sm" className="min-h-11 rounded-full px-4" onClick={p.onApply}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Accept suggestion
            </Button>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              className="min-h-11 rounded-full px-3.5"
              onClick={() => {
                p.onEditSuggestion?.();
                focusBox();
              }}
            >
              <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Edit suggestion
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onSkip}>
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {gen ? "Keep current" : "Keep original"}
            </Button>
          </div>
        </motion.div>
      )}
    </section>
  );
}

/** One side of the comparison: the words as they are, or the suggestion. Long ones scroll inside. */
function Pane({ label, text, strong }: { label: string; text: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl p-3", strong ? "bg-card ring-1 ring-lime/60" : "bg-card/50 hairline")}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn("mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md text-[14px] leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", !strong && "text-muted-foreground")}
        dir="auto"
      >
        {text || "(empty)"}
      </div>
    </div>
  );
}

function Chip({ children, icon, onClick, pressed, disabled }: { children: React.ReactNode; icon?: React.ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition hairline motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55",
        pressed ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
