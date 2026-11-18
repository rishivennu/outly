"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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

type StateKind = "writing" | "proposal" | "approved" | "empty" | "mine" | "ready";

/** Still Pip's words, or the creator's own now? Only the fields shown for the platform count. */
const isMine = (d: Draft, pip: PlatformCopy | undefined) => !!pip && copyKey(d) !== copyKey({ title: pip.title ?? "", caption: pip.caption, description: pip.description ?? "", hashtags: pip.hashtags });

/** One platform's state in a word or two: the tab and the open card say the same thing. */
export function captionState(o: { busy: boolean; proposal: boolean; reviewed: boolean; empty: boolean; mine: boolean }): { kind: StateKind; label: string } {
  if (o.busy) return { kind: "writing", label: "Writing…" };
  if (o.proposal) return { kind: "proposal", label: "Suggestion waiting" };
  if (o.reviewed) return { kind: "approved", label: "Approved" };
  if (o.empty) return { kind: "empty", label: "Not written yet" };
  if (o.mine) return { kind: "mine", label: "Edited by you" };
  return { kind: "ready", label: "Ready to review" };
}

function stateFor(platform: Platform, p: Props) {
  const d = p.drafts[platform];
  return captionState({
    busy: p.writing.includes(platform),
    proposal: !!p.proposals?.[platform],
    reviewed: !!d?.reviewed,
    empty: !d || (!d.title.trim() && !d.caption.trim() && !d.description.trim()),
    mine: !!d && isMine(d, p.adapted[platform]),
  });
}

function StateMark({ kind }: { kind: StateKind }) {
  if (kind === "writing") return <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden="true" />;
  if (kind === "approved") return <Check className="h-3.5 w-3.5" aria-hidden="true" />;
  if (kind === "mine") return <Pencil className="h-3 w-3" aria-hidden="true" />;
  if (kind === "proposal") return <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />;
  if (kind === "empty") return <span className="h-2 w-2 rounded-full border border-current opacity-60" aria-hidden="true" />;
  return null;
}

/**
 * 1190 Step 2, R1206 one at a time: a row of platform tabs, each with its own state, and the one picked open
 * below with the caption Pip wrote from "Your caption", its count against the platform's limit and Approve.
 * An edit is the creator's own: Pip never writes over it, Regenerate touches only that platform, and Pip's
 * version stays one tap away. Approving is the same `reviewed` flag Everywhere and Launch already read.
 */
export function AdaptedCaptions(p: Props) {
  const places = p.platforms;
  const written = places.filter((x) => p.adapted[x]).length;
  const approved = places.filter((x) => p.drafts[x]?.reviewed).length;
  const ids = useId();
  const [own, setOwn] = useState<Platform | null>(null);
  const tabs = useRef<Partial<Record<Platform, HTMLButtonElement | null>>>({});
  if (!places.length) return null;
  // The page's pick (Pip just added a platform, say) wins; otherwise the one tapped here, else the first.
  const want = p.focus ?? own;
  const sel = want && places.includes(want) ? want : places[0];
  const pick = (pl: Platform) => {
    setOwn(pl);
    p.onFocus?.(pl);
  };
  /** Arrow keys move along the tabs, Home and End jump to the ends: one tab stop for the whole row. */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = places.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(places[to]);
    tabs.current[places[to]]?.focus();
  };

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
      <div role="tablist" aria-label="Your platforms" className="-mx-1 mt-3.5 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {places.map((pl, i) => {
          const on = pl === sel;
          const s = stateFor(pl, p);
          return (
            <button
              key={pl}
              ref={(el) => {
                tabs.current[pl] = el;
              }}
              type="button"
              role="tab"
              id={`${ids}-${pl}-tab`}
              aria-selected={on}
              aria-controls={`${ids}-panel`}
              tabIndex={on ? 0 : -1}
              data-tab={pl}
              onClick={() => pick(pl)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold outline-none transition-[background-color,color] duration-200 hairline motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary/70 [@media(hover:hover)]:hover:text-foreground",
              )}
            >
              <PlatformOrb platform={pl} size={24} />
              {PLATFORM_META[pl].name}
              <StateMark kind={s.kind} />
              <span className="sr-only">, {s.label}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${sel}-tab`} className="mt-2.5">
        <Row key={sel} platform={sel} {...p} />
      </div>
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
  const mine = isMine(d, pip);
  const empty = !d.title.trim() && !d.caption.trim() && !d.description.trim();
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

  const state = captionState({ busy, proposal: !!proposal, reviewed: d.reviewed, empty, mine }).label;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.card} data-pl={platform} className="min-w-0 rounded-2xl border border-border/60 bg-card p-3 sm:p-3.5">
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
    </motion.div>
  );
}
