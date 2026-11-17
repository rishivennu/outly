"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Check, Copy, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { composedCopy, countHashtags, HASHTAG_CAP, type Draft } from "@/lib/client/checks";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { copyKey } from "@/lib/ai/adapt-core";
import type { PlatformCopy } from "@/lib/ai/creative";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";

interface Props {
  /** The places switched on, in the page's own order. */
  platforms: Platform[];
  drafts: Record<Platform, Draft>;
  /** What Pip wrote, kept beside the draft so "Restore Pip's version" is always possible. */
  adapted: Partial<Record<Platform, PlatformCopy>>;
  writing: Platform[];
  longForm: boolean;
  online: boolean;
  onDraft: (p: Platform, patch: Partial<Draft>) => void;
  onRegenerate: (p: Platform) => void;
  onRegenerateAll: () => void;
  onRestore: (p: Platform) => void;
  onCopied?: (p: Platform) => void;
  className?: string;
}

/**
 * 1190 Step 2: one card per place, with the caption Pip wrote from the creator's message. Everything here is
 * editable, and an edit is the creator's own: Pip never writes over it, and Pip's version stays one tap away.
 * Approving a place is the same `reviewed` flag the deck and Launch already read.
 */
export function AdaptedCaptions(p: Props) {
  const [tab, setTab] = useState<Platform | null>(null);
  const places = p.platforms;
  const current = tab && places.includes(tab) ? tab : places[0];
  const tabs = useRef<HTMLDivElement | null>(null);

  /** A place that has just been written is the one worth looking at, until the creator picks another. */
  useEffect(() => {
    if (tab && places.includes(tab)) return;
    setTab(places[0] ?? null);
  }, [places, tab]);

  const written = places.filter((x) => p.adapted[x]).length;
  const approved = places.filter((x) => p.drafts[x]?.reviewed).length;

  if (!places.length || !current) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = places.indexOf(current);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -1;
    if (next < 0 || next >= places.length) return;
    e.preventDefault();
    setTab(places[next]);
    requestAnimationFrame(() => tabs.current?.querySelector<HTMLButtonElement>(`[data-pl="${places[next]}"]`)?.focus());
  };

  return (
    <section aria-labelledby="adapted-captions" className={cn("glass rounded-[24px] p-4 sm:p-5", p.className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id="adapted-captions" className="text-base font-semibold tracking-tight">
            Your captions, place by place
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {written ? `${written} of ${places.length} written · ${approved} approved. Edit anything.` : "Written from your message, one for each place."}
          </p>
        </div>
        {written > 1 && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5 text-[13px]" disabled={!!p.writing.length || p.online === false} onClick={p.onRegenerateAll}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Regenerate all
          </Button>
        )}
      </div>

      <div ref={tabs} role="tablist" aria-label="Places" onKeyDown={onKey} className="mt-3.5 -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1">
        {places.map((pl) => {
          const on = pl === current;
          const busy = p.writing.includes(pl);
          return (
            <button
              key={pl}
              data-pl={pl}
              role="tab"
              type="button"
              id={`adapt-tab-${pl}`}
              aria-selected={on}
              aria-controls={`adapt-panel-${pl}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(pl)}
              className={cn(
                "inline-flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full px-3 text-[13px] font-semibold transition hairline motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground",
              )}
            >
              <PlatformOrb platform={pl} size={20} />
              <span>{PLATFORM_META[pl].name}</span>
              {busy ? (
                <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden="true" />
              ) : p.drafts[pl]?.reviewed ? (
                <Check className="h-3.5 w-3.5 text-lime" aria-hidden="true" />
              ) : null}
              <span className="sr-only">{busy ? ", being written" : p.drafts[pl]?.reviewed ? ", approved" : ""}</span>
            </button>
          );
        })}
      </div>

      <Card key={current} platform={current} {...p} />
    </section>
  );
}

function Card({ platform, ...p }: Props & { platform: Platform }) {
  const d = p.drafts[platform];
  const pip = p.adapted[platform];
  const meta = PLATFORM_META[platform];
  const id = useId();
  const busy = p.writing.includes(platform);
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<Draft>) => p.onDraft(platform, patch);
  const yt = platform === "youtube";
  const tags = platform !== "x";
  const bodyKey: "caption" | "description" = yt ? "description" : "caption";
  const bodyLen = composedCopy(platform, d).length;
  const cap = HASHTAG_CAP[platform];
  const tagCount = countHashtags(d.hashtags);
  /** Still Pip's words, or the creator's own now? Only the fields on this card count. */
  const mine = !!pip && copyKey(d) !== copyKey({ title: pip.title ?? "", caption: pip.caption, description: pip.description ?? "", hashtags: pip.hashtags });

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    const text = [yt ? d.title : "", composedCopy(platform, d)].filter((s) => s.trim()).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      p.onCopied?.(platform);
    } catch {
      setCopied(false);
    }
  };

  const empty = !d.title.trim() && !d.caption.trim() && !d.description.trim();

  return (
    <motion.div key={platform} role="tabpanel" id={`adapt-panel-${platform}`} aria-labelledby={`adapt-tab-${platform}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.card} className="mt-3.5 min-w-0">
      {busy && empty ? (
        <p className="rounded-2xl bg-secondary/50 px-3.5 py-6 text-center text-[13px] text-muted-foreground hairline" aria-live="polite">
          <Sparkles className="mx-auto mb-2 block h-4 w-4 motion-safe:animate-pulse" aria-hidden="true" />
          Writing for {meta.name}…
        </p>
      ) : empty ? (
        <p className="rounded-2xl bg-secondary/50 px-3.5 py-6 text-center text-[13px] text-muted-foreground hairline">
          Nothing here yet. Write your message above and Pip fills this in, or type your own.
        </p>
      ) : null}

      {(!empty || !busy) && (
        <div className={cn("space-y-3.5", empty && "mt-3.5")}>
          {yt && (
            <div>
              <Label htmlFor={`${id}-title`}>
                <span>Title</span>
                <Counter value={d.title.length} max={meta.titleLimit ?? 100} />
              </Label>
              <Input id={`${id}-title`} value={d.title} maxLength={(meta.titleLimit ?? 100) + 40} onChange={(e) => set({ title: e.target.value })} placeholder="A title people would search for" />
            </div>
          )}
          <div>
            <Label htmlFor={`${id}-body`}>
              <span>{yt ? "Description" : platform === "x" ? "Post" : "Caption"}</span>
              <Counter value={bodyLen} max={meta.captionLimit} />
            </Label>
            <Textarea id={`${id}-body`} rows={yt ? 7 : 5} value={d[bodyKey]} onChange={(e) => set({ [bodyKey]: e.target.value, custom: true })} placeholder={`Your message, written for ${meta.name}`} className="min-h-[112px]" />
            {tags ? <p className="mt-1 text-xs text-muted-foreground">{yt ? "Hashtags are added to the end of the description when it posts." : "Hashtags are added to the end of the caption when it posts."}</p> : null}
          </div>
          {tags && (
            <div>
              <Label htmlFor={`${id}-tags`}>
                <span>Hashtags</span>
                <span className={cn("tabular text-xs", cap && tagCount > cap.max ? "text-destructive" : "text-muted-foreground")}>{tagCount}{cap ? `/${cap.max}` : ""}</span>
              </Label>
              <Input id={`${id}-tags`} value={d.hashtags} onChange={(e) => set({ hashtags: e.target.value })} placeholder="#yourtopic #yourniche" />
            </div>
          )}
          {pip?.note && !mine && <p className="text-xs leading-snug text-muted-foreground">{pip.note}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={d.reviewed ? "subtle" : "lime"} size="sm" className="min-h-11 rounded-full px-4" aria-pressed={d.reviewed} onClick={() => set({ reviewed: !d.reviewed })}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {d.reviewed ? "Approved" : "Approve"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={copy}>
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-lime" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" disabled={busy || p.online === false} onClick={() => p.onRegenerate(platform)}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "motion-safe:animate-spin")} aria-hidden="true" />
              Regenerate
            </Button>
            {mine && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={() => p.onRestore(platform)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Restore Pip&apos;s version
              </Button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
