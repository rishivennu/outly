"use client";
import { useEffect, useId, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Pencil, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { composedCopy, countHashtags, HASHTAG_CAP, type Draft } from "@/lib/client/checks";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { copyKey } from "@/lib/ai/adapt-core";
import type { PlatformCopy } from "@/lib/ai/creative";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";
import { SuggestionCard } from "./SuggestionCard";
import type { Proposal, Undo } from "./proposal";

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
  /** R1198: Pip's suggestions for a place wait here for Accept or Skip, never written straight in. */
  proposals?: Partial<Record<Platform, Proposal>>;
  undo?: Partial<Record<Platform, Undo>>;
  onAccept?: (p: Platform) => void;
  onReject?: (p: Platform) => void;
  onRevert?: (p: Platform) => void;
  /** The place Pip's asks work on, and telling the page when the creator picks another. */
  focus?: Platform | null;
  onFocus?: (p: Platform) => void;
  className?: string;
}

/**
 * 1190 Step 2, R1198 compact: one row per platform with the caption Pip wrote from "Your caption". A row shows the
 * words, the count against the platform's limit and whether it is approved; Edit opens its fields in place.
 * An edit is the creator's own: Pip never writes over it, Regenerate touches only that row, and Pip's version
 * stays one tap away. Approving is the same `reviewed` flag Everywhere and Launch already read.
 */
export function AdaptedCaptions(p: Props) {
  const places = p.platforms;
  const written = places.filter((x) => p.adapted[x]).length;
  const approved = places.filter((x) => p.drafts[x]?.reviewed).length;
  if (!places.length) return null;

  return (
    <section aria-labelledby="adapted-captions" className={cn("glass rounded-[24px] p-4 sm:p-5", p.className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id="adapted-captions" className="text-base font-semibold tracking-tight">
            Your platform captions
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {written ? `${written} of ${places.length} written · ${approved} approved` : "Written from your caption, one for each platform."}
          </p>
        </div>
        {written > 1 && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5 text-[13px]" disabled={!!p.writing.length || p.online === false} onClick={p.onRegenerateAll}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Regenerate all
          </Button>
        )}
      </div>
      <ul className="mt-3.5 space-y-2.5">
        {places.map((pl) => (
          <Row key={pl} platform={pl} {...p} />
        ))}
      </ul>
    </section>
  );
}

function Row({ platform, ...p }: Props & { platform: Platform }) {
  const d = p.drafts[platform];
  const pip = p.adapted[platform];
  const meta = PLATFORM_META[platform];
  const id = useId();
  const busy = p.writing.includes(platform);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<Draft>) => p.onDraft(platform, patch);
  const yt = platform === "youtube";
  const tags = platform !== "x";
  const bodyKey: "caption" | "description" = yt ? "description" : "caption";
  const bodyLen = composedCopy(platform, d).length;
  const over = bodyLen > meta.captionLimit;
  const cap = HASHTAG_CAP[platform];
  const tagCount = countHashtags(d.hashtags);
  /** Still Pip's words, or the creator's own now? Only the fields on this row count. */
  const mine = !!pip && copyKey(d) !== copyKey({ title: pip.title ?? "", caption: pip.caption, description: pip.description ?? "", hashtags: pip.hashtags });
  const empty = !d.title.trim() && !d.caption.trim() && !d.description.trim();
  const focused = p.focus === platform;
  const proposal = p.proposals?.[platform];

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

  const state = busy ? "Writing…" : proposal ? "Suggestion waiting" : d.reviewed ? "Approved" : empty ? "Not written yet" : mine ? "Edited by you" : "Ready to review";

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T.card}
      data-pl={platform}
      onFocusCapture={() => p.onFocus?.(platform)}
      onPointerDown={() => p.onFocus?.(platform)}
      className={cn("min-w-0 rounded-2xl border p-3 transition-[border-color] motion-reduce:transition-none sm:p-3.5", focused ? "border-foreground/30 bg-card" : "border-border/60 bg-secondary/25")}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PlatformOrb platform={platform} size={26} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {meta.name}
          {meta.format && <span className="font-normal text-muted-foreground"> · {meta.format}</span>}
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            d.reviewed && !busy && !proposal ? "bg-lime/20 text-foreground" : proposal ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground",
          )}
        >
          {busy ? <Sparkles className="h-3 w-3 motion-safe:animate-pulse" aria-hidden="true" /> : d.reviewed && !proposal ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          {state}
        </span>
      </div>

      {!open && (
        <div className="mt-2">
          {busy && empty ? (
            <p className="text-[13px] text-muted-foreground" aria-live="polite">Writing for {meta.name}…</p>
          ) : empty ? (
            <p className="text-[13px] text-muted-foreground">Nothing here yet. Generate captions above, or press Edit and write your own.</p>
          ) : (
            <>
              {yt && d.title.trim() && <p className="text-[13px] font-semibold leading-snug">{d.title}</p>}
              <p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90" dir="auto">
                {d[bodyKey]}
                {tags && d.hashtags.trim() ? <span className="text-muted-foreground">{`\n${d.hashtags}`}</span> : null}
              </p>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3">
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
            </Label>
            <Textarea id={`${id}-body`} autoFocus rows={yt ? 6 : 5} value={d[bodyKey]} onChange={(e) => set({ [bodyKey]: e.target.value, custom: true })} placeholder={`Your caption, written for ${meta.name}`} className="min-h-[112px]" />
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
        </div>
      )}

      <p className={cn("mt-1.5 text-xs tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
        {bodyLen.toLocaleString()} / {meta.captionLimit.toLocaleString()} characters{tags && cap ? ` · ${tagCount}/${cap.max} hashtags` : ""}
        {over ? `. Over ${meta.name}'s limit, shorten it before it can go out.` : ""}
      </p>

      {proposal && p.onAccept && (
        <div className="mt-2.5">
          <SuggestionCard
            platform={platform}
            draft={d}
            proposal={proposal}
            undo={p.undo?.[platform]}
            onAccept={() => p.onAccept?.(platform)}
            onEdit={() => (p.onAccept?.(platform), setOpen(true))}
            onReject={() => p.onReject?.(platform)}
            onRevert={() => p.onRevert?.(platform)}
          />
        </div>
      )}
      {!proposal && p.undo?.[platform] && p.onRevert && (
        <div className="mt-2.5">
          <SuggestionCard platform={platform} draft={d} undo={p.undo[platform]} onAccept={() => {}} onEdit={() => {}} onReject={() => {}} onRevert={() => p.onRevert?.(platform)} />
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button type="button" variant={d.reviewed ? "subtle" : "lime"} size="sm" className="min-h-11 rounded-full px-3.5" aria-pressed={d.reviewed} disabled={empty || busy || !!proposal} onClick={() => set({ reviewed: !d.reviewed })}>
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {d.reviewed ? "Approved" : "Approve"} <span className="sr-only">{meta.name}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" aria-expanded={open} aria-controls={open ? `${id}-body` : undefined} onClick={() => setOpen((v) => !v)}>
          {open ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          {open ? "Done" : "Edit"} <span className="sr-only">{meta.name}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" disabled={busy || p.online === false} onClick={() => p.onRegenerate(platform)}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "motion-safe:animate-spin")} aria-hidden="true" />
          Regenerate <span className="sr-only">{meta.name}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" disabled={empty} onClick={copy}>
          {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-lime" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </Button>
        {mine && open && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" onClick={() => p.onRestore(platform)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Restore Pip&apos;s version
          </Button>
        )}
      </div>
    </motion.li>
  );
}
