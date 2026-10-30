"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Check, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn, formatDuration } from "@/lib/utils";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Draft, HooksState, Step, Tone, UploadState } from "./types";

const EXAMPLES = ["How a ₹5 shampoo sachet changed Indian retail", "My 5 AM routine that actually stuck", "Why Blockbuster said no to Netflix"];

const TONES: { id: Tone; label: string }[] = [
  { id: "punchier", label: "Make it punchier" },
  { id: "professional", label: "Make it more professional" },
  { id: "genz", label: "Make it Gen Z" },
];

interface Props {
  step: Step;
  hasMedia: boolean;
  upload: UploadState;
  meta: { duration?: number | null; width?: number | null; height?: number | null } | null;
  story: string;
  onStory: (s: string) => void;
  submittedStory: string | null;
  onSubmitStory: () => void;
  onEditStory: () => void;
  hooks: HooksState;
  onTryAnother: () => void;
  onTone: (t: Tone) => void;
  onUse: (text: string) => void;
  onRepick: () => void;
  chosenHook: string | null;
  copyLoading: boolean;
  drafts: Record<Platform, Draft>;
  platforms: Platform[];
}

function Bubble({ from, children, className }: { from: "outly" | "you"; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn("max-w-[92%] text-[15px] leading-relaxed", from === "you" ? "ml-auto rounded-[22px] rounded-br-md bg-foreground px-4 py-2.5 text-background" : "text-foreground", className)}
    >
      {children}
    </motion.div>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-lime" animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
        ))}
      </span>
      {label}
    </motion.div>
  );
}

export function Assistant(p: Props) {
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [tweak, setTweak] = useState("");
  const result = p.hooks.result;
  const current = result?.hooks[p.hooks.index];

  useEffect(() => {
    setEditing(false);
    setTweak(current?.text ?? "");
  }, [current?.text]);

  const key = [p.step, p.upload.kind, !!p.submittedStory, p.hooks.loading, result?.hooks.length, p.hooks.index, p.chosenHook, p.copyLoading].join("|");
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [key, reduce]);

  const vertical = p.meta?.width && p.meta?.height ? p.meta.height > p.meta.width : null;
  const askStory = p.step !== "video" && !p.submittedStory;

  return (
    <section aria-label="Creative partner" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 px-6 pb-3 pt-6">
        <span className="lime-bg relative grid h-9 w-9 place-items-center rounded-full">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Outlly assistant</h2>
          <p className="text-xs text-muted-foreground">{p.hooks.loading || p.hooks.more || p.copyLoading ? "Writing…" : "Here with you"}</p>
        </div>
      </header>

      <div className="scrollbar-none min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4 pt-3 [mask-image:linear-gradient(to_bottom,transparent_0,#000_28px)]" aria-live="polite">
        {!p.hasMedia && <Bubble from="outly">Hey! Drop a video in and I&apos;ll help it land everywhere it needs to go.</Bubble>}
        {p.hasMedia && p.upload.kind === "uploading" && <Bubble from="outly">Bringing it in. You can start telling me about it while it uploads.</Bubble>}
        {p.hasMedia && p.upload.kind !== "uploading" && p.meta?.duration ? (
          <Bubble from="outly">
            Your video is in. <span className="text-muted-foreground">{formatDuration(p.meta.duration)}{vertical === null ? "" : vertical ? ", vertical. Perfect for Reels and Shorts." : ", horizontal. It'll sit with bars on vertical feeds."}</span>
          </Bubble>
        ) : null}

        {p.step !== "video" && (
          <Bubble from="outly">
            <span className="display block text-[28px] leading-[1.02] tracking-[-0.04em]">What&apos;s this video about?</span>
            {askStory && <span className="mt-2 block text-sm text-muted-foreground">A sentence or two is plenty. Tell it the way you&apos;d tell a friend.</span>}
          </Bubble>
        )}

        {askStory && !p.story && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" onClick={() => p.onStory(e)} className="min-h-[44px] rounded-full px-3.5 py-2 text-left text-[13px] text-muted-foreground hairline transition hover:bg-secondary hover:text-foreground">
                {e}
              </button>
            ))}
          </motion.div>
        )}

        {p.submittedStory && (
          <div className="flex flex-col items-end gap-1">
            <Bubble from="you">{p.submittedStory}</Bubble>
            {!p.chosenHook && !p.hooks.loading && (
              <button type="button" onClick={p.onEditStory} className="min-h-[44px] px-2 text-xs text-muted-foreground hover:text-foreground">
                Change what I said
              </button>
            )}
          </div>
        )}

        <AnimatePresence>{p.hooks.loading && !result?.understood && <Typing label={p.hooks.status || "Reading your idea…"} />}</AnimatePresence>

        {p.hooks.error && <Bubble from="outly" className="text-destructive">{p.hooks.error}</Bubble>}

        {result?.understood && (
          <>
            <Bubble from="outly">
              <span className="font-semibold">Oh, I like this one.</span> {result.understood}
              <span className="mt-2 block text-muted-foreground">{result.insight}</span>
            </Bubble>

            <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="rounded-3xl bg-secondary/50 p-4 hairline">
                <p className="eyebrow mb-1.5">Original</p>
                {result.original ? <p className="text-[15px] text-muted-foreground">{result.original}</p> : <div className="skeleton h-4 w-3/4 rounded-full" aria-hidden="true" />}
              </div>

              <div className={cn("relative overflow-hidden rounded-3xl p-[1.5px]", p.chosenHook ? "bg-border" : "lime-bg")}>
                <div className="relative rounded-[calc(1.5rem-1.5px)] bg-card p-5 text-foreground">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="eyebrow !text-foreground">Suggested</p>
                    {current && (
                      <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                        {current.angle} <span className="tabular text-accent/70">· {p.hooks.index + 1}/{p.hooks.more ? Math.max(3, result.hooks.length) : result.hooks.length}</span>
                      </span>
                    )}
                  </div>
                  <AnimatePresence mode="wait">
                    {p.hooks.loading || !current ? (
                      <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 py-1">
                        <div className="skeleton h-5 w-11/12 rounded-full" />
                        <div className="skeleton h-5 w-2/3 rounded-full" />
                        {p.hooks.status && (
                          <p className="pt-1 text-xs text-muted-foreground" role="status">
                            {p.hooks.status}
                          </p>
                        )}
                      </motion.div>
                    ) : editing ? (
                      <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <label htmlFor={`${inputId}-tweak`} className="sr-only">
                          Edit the suggested hook
                        </label>
                        <textarea id={`${inputId}-tweak`} autoFocus rows={3} value={tweak} maxLength={500} onChange={(e) => setTweak(e.target.value)} className="w-full resize-none rounded-2xl bg-secondary/60 p-3 text-lg font-semibold leading-snug hairline" />
                      </motion.div>
                    ) : (
                      <motion.p key={current?.text} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="whitespace-pre-line text-[22px] font-semibold leading-[1.2] tracking-[-0.02em]">
                        {tweak || current?.text}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  {!p.chosenHook && (
                    <>
                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <Button variant="lime" onClick={() => p.onUse((tweak || current?.text || "").trim())} disabled={p.hooks.loading || !(tweak || current?.text)}>
                          <Check className="h-4 w-4" /> Use this
                        </Button>
                        <Button variant="subtle" onClick={p.onTryAnother} disabled={p.hooks.loading || (p.hooks.more && p.hooks.index >= result.hooks.length - 1)}>
                          <RefreshCw className={cn("h-4 w-4", (p.hooks.loading || (p.hooks.more && p.hooks.index >= result.hooks.length - 1)) && "animate-spin")} />
                          {p.hooks.more && p.hooks.index >= result.hooks.length - 1 ? "Writing the next…" : "Try another"}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setEditing((e) => !e)} aria-label={editing ? "Done editing" : "Tweak it yourself"} aria-pressed={editing}>
                          {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Change the tone">
                        {TONES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            disabled={p.hooks.loading}
                            aria-pressed={p.hooks.tone === t.id}
                            onClick={() => p.onTone(p.hooks.tone === t.id ? "default" : t.id)}
                            className={cn("min-h-[36px] rounded-full px-3 text-[12.5px] font-medium transition disabled:opacity-50", p.hooks.tone === t.id ? "bg-foreground text-background" : "text-muted-foreground hairline hover:bg-secondary hover:text-foreground")}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}

        {p.chosenHook && (
          <>
            <div className="flex flex-col items-end gap-1">
              <Bubble from="you">Let&apos;s go with that one.</Bubble>
              {p.step === "story" && (
                <button type="button" onClick={p.onRepick} className="min-h-[44px] px-2 text-xs text-muted-foreground hover:text-foreground">
                  Actually, let&apos;s rethink the hook
                </button>
              )}
            </div>
            <Bubble from="outly">
              <span className="display block text-[24px] leading-[1.05] tracking-[-0.035em]">Now let&apos;s make it fit everywhere.</span>
              <span className="mt-2 block text-sm text-muted-foreground">Each place gets its own words. Nothing goes out until you say so.</span>
            </Bubble>
          </>
        )}

        <AnimatePresence>{p.copyLoading && <Typing label="Writing something different for each place…" />}</AnimatePresence>

        {(p.step === "everywhere" || p.step === "launch") && !p.copyLoading && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
            {p.platforms
              .filter((pl) => p.drafts[pl].enabled && p.drafts[pl].note)
              .map((pl) => (
                <li key={pl} className="flex items-center gap-3 text-[15px]">
                  <PlatformOrb platform={pl} size={28} />
                  <span>
                    <span className="sr-only">{PLATFORM_META[pl].name}: </span>
                    {p.drafts[pl].reviewed ? `${PLATFORM_META[pl].name} looks good to you. ✓` : p.drafts[pl].note}
                  </span>
                </li>
              ))}
          </motion.ul>
        )}

        {p.step === "launch" && <Bubble from="outly">Everything looks ready. When should it go live?</Bubble>}
        <div ref={end} />
      </div>

      {askStory && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (p.story.trim().length >= 3) p.onSubmitStory();
          }}
          className="p-4 pt-2"
        >
          <div className="flex items-end gap-2 rounded-[26px] bg-secondary/70 p-2 hairline focus-within:bg-secondary">
            <label htmlFor={inputId} className="sr-only">
              What&apos;s this video about?
            </label>
            <textarea
              id={inputId}
              rows={2}
              value={p.story}
              maxLength={4000}
              onChange={(e) => p.onStory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (p.story.trim().length >= 3) p.onSubmitStory();
                }
              }}
              placeholder="It's about…"
              className="max-h-40 min-h-[48px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground/80 focus-visible:outline-none"
            />
            <Button type="submit" variant={p.story.trim().length >= 3 ? "lime" : "subtle"} size="icon" disabled={p.story.trim().length < 3} aria-label="Send">
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
