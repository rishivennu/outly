"use client";
import { Check, CheckCheck, Pencil, RefreshCw, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { composedCopy, countHashtags, HASHTAG_CAP, type Check as DeckCheck, type Draft } from "@/lib/client/checks";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { ADAPT_TONES, type AdaptTone } from "@/lib/ai/adapt-core";
import { cn } from "@/lib/utils";
import { bodyKey, fieldsFor } from "./deck-logic";
import { APPROVE, hasCopy, REVIEW_LABEL, reviewKind, type ReviewKind } from "./review-state";

/** A card's state: Pip writing and a waiting suggestion come before the three review states. */
export type CardKind = ReviewKind | "writing" | "proposal" | "empty";

export const CARD_LABEL: Record<CardKind, string> = { ...REVIEW_LABEL, writing: "Writing…", proposal: "Suggestion waiting", empty: "Not written yet" };

/** Pure. One platform's state in a word or two; the card, its pill and Approve all read the same thing. */
export function cardKind(o: { busy: boolean; proposal: boolean; draft: Draft }): CardKind {
  if (o.busy) return "writing";
  if (o.proposal) return "proposal";
  if (!hasCopy(o.draft)) return "empty";
  return reviewKind(o.draft);
}

/** Pure. Can this place be approved now: it has words, Pip is not writing it, nothing waits on it and no check fails. */
export function canApprove(o: { busy: boolean; proposal: boolean; blocked: boolean; draft: Draft }): boolean {
  return hasCopy(o.draft) && !o.busy && !o.proposal && !o.blocked;
}

const PILL: Record<CardKind, string> = {
  writing: "bg-secondary text-muted-foreground",
  proposal: "bg-accent/15 text-accent",
  empty: "bg-secondary text-muted-foreground",
  "needs-review": "bg-warning/10 text-warning-ink",
  edited: "bg-secondary text-foreground",
  approved: "bg-lime/25 text-foreground",
};

interface Props {
  /** Switched on and connected, in the deck's order. */
  places: Platform[];
  drafts: Record<Platform, Draft>;
  status: Record<Platform, { checks: DeckCheck[]; blocked: boolean }>;
  writing: Platform[];
  proposals: Partial<Record<Platform, unknown>>;
  online?: boolean;
  /** The platform open in the editor below, if any. */
  editing: Platform | null;
  onDraft: (p: Platform, patch: Partial<Draft>) => void;
  onEdit: (p: Platform) => void;
  onRegenerate?: (p: Platform) => void;
  /** Every place written again from the main caption; with a tone, in that direction. */
  onRegenerateAll?: (tone?: AdaptTone) => void;
  /** The direction Pip last wrote every place in, if one was asked for. */
  tone?: AdaptTone | null;
  /** Set only while Pip writes the platform captions. */
  onStop?: () => void;
}

/**
 * R1209: every platform's caption in one place, each with its state (Needs review, Edited or Approved), its count
 * against the platform's limit, and Approve, Edit and Regenerate. Only Approved ever goes out. The words are
 * changed in the one editor below (Edit opens it), so a caption is never typed into two boxes.
 */
export function CaptionCards(p: Props) {
  const busy = (pl: Platform) => p.writing.includes(pl);
  const ready = (pl: Platform) => canApprove({ busy: busy(pl), proposal: !!p.proposals[pl], blocked: p.status[pl].blocked, draft: p.drafts[pl] });
  const approved = p.places.filter((pl) => p.drafts[pl].reviewed).length;
  const left = p.places.length - approved;
  const toApprove = p.places.filter((pl) => !p.drafts[pl].reviewed && ready(pl));
  const writing = p.places.filter(busy).length;
  const written = p.places.filter((pl) => hasCopy(p.drafts[pl])).length;
  const line = !p.places.length
    ? "Switch a platform on above and Pip writes its caption from yours."
    : writing
      ? `Pip is writing ${writing === 1 ? "1 caption" : `${writing} captions`} from your caption…`
      : `${approved} of ${p.places.length} approved. Only approved captions are published.`;

  return (
    <section aria-labelledby="adapted-captions" className="mb-6 scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 id="adapted-captions" className="text-base font-semibold">
            Your platform captions
          </h3>
          <p className="mt-0.5 tabular-nums text-[13px] text-muted-foreground" aria-live="polite">
            {line}
          </p>
        </div>
        {p.places.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {p.onStop ? (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" onClick={p.onStop}>
                <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Stop writing
              </Button>
            ) : written > 1 && p.onRegenerateAll ? (
              <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3.5" disabled={p.online === false || writing > 0} onClick={() => p.onRegenerateAll?.()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Regenerate all
              </Button>
            ) : null}
            <Button type="button" variant="lime" size="sm" className="min-h-11 rounded-full px-4" disabled={!toApprove.length} onClick={() => toApprove.forEach((pl) => p.onDraft(pl, APPROVE))}>
              <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {toApprove.length > 0 && toApprove.length < left ? `Approve ${toApprove.length} ready` : "Approve all"}
            </Button>
          </div>
        )}
      </div>
      {written > 0 && !p.onStop && p.onRegenerateAll && (
        <div role="group" aria-label="Rewrite every caption in a different direction" className="mb-3 sm:flex sm:flex-wrap sm:items-center sm:gap-1.5">
          <span className="mb-1.5 block text-xs text-muted-foreground sm:mb-0 sm:mr-0.5 sm:inline">Try a different take:</span>
          {/* On a phone the takes sit in one row that scrolls sideways, so the cards stay near the top. */}
          <div className="-m-1 flex gap-1.5 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:thin] sm:contents">
          {ADAPT_TONES.map((t) => {
            const on = p.tone === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                disabled={p.online === false || writing > 0}
                onClick={() => p.onRegenerateAll?.(on ? "default" : t.id)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors hairline motion-reduce:transition-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  on ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
          </div>
        </div>
      )}
      {p.places.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {p.places.map((pl) => (
            <Card key={pl} pl={pl} p={p} ready={ready(pl)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({ pl, p, ready }: { pl: Platform; p: Props; ready: boolean }) {
  const d = p.drafts[pl];
  const meta = PLATFORM_META[pl];
  const f = fieldsFor(pl);
  const busy = p.writing.includes(pl);
  const proposal = !!p.proposals[pl];
  const kind = cardKind({ busy, proposal, draft: d });
  const has = hasCopy(d);
  const len = composedCopy(pl, d).length;
  const over = len > f.body.limit;
  const cap = HASHTAG_CAP[pl];
  const tags = countHashtags(d.hashtags);
  const err = p.status[pl].checks.find((c) => c.level === "error");
  const open = p.editing === pl;
  const body = d[bodyKey(pl)];
  return (
    <li data-pl={pl} className={cn("flex min-w-0 flex-col rounded-2xl border bg-card p-3.5 transition-[border-color] duration-hover ease-out motion-reduce:transition-none", open ? "border-foreground/35" : "border-border/60")}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PlatformOrb platform={pl} size={28} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {meta.name}
          {meta.format && <span className="font-normal text-muted-foreground"> · {meta.format}</span>}
        </p>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", PILL[kind])}>
          {kind === "writing" ? <Sparkles className="h-3 w-3 motion-safe:animate-pulse" aria-hidden="true" /> : kind === "approved" ? <Check className="h-3 w-3" aria-hidden="true" /> : kind === "edited" ? <Pencil className="h-3 w-3" aria-hidden="true" /> : null}
          {CARD_LABEL[kind]}
        </span>
      </div>

      <div className={cn("mt-2.5 min-h-[5.25rem] flex-1", busy && has && "opacity-60")}>
        {!has ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{busy ? `Writing for ${meta.name}…` : "Not written yet. Press Regenerate, or Edit to write your own."}</p>
        ) : (
          <>
            {f.title && d.title.trim() && (
              <p className="mb-1 line-clamp-2 break-words text-[13px] font-semibold leading-snug" dir="auto">
                {d.title}
              </p>
            )}
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90" dir="auto">
              {body}
              {f.hashtags && d.hashtags.trim() ? <span className="text-muted-foreground">{`${body ? "\n" : ""}${d.hashtags}`}</span> : null}
            </p>
          </>
        )}
      </div>

      <p className={cn("mt-2 text-xs tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
        {len.toLocaleString()} / {f.body.limit.toLocaleString()} characters
        {f.hashtags && cap ? ` · ${tags}/${cap.max} hashtags` : ""}
      </p>
      {proposal ? (
        <p className="mt-1 text-xs leading-snug text-muted-foreground">A suggestion is waiting. Open Edit to accept or skip it.</p>
      ) : err && has ? (
        <p className="mt-1 text-xs leading-snug text-destructive">{err.text}</p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant={d.reviewed ? "subtle" : "lime"}
          size="sm"
          className="min-h-11 rounded-full px-3.5"
          aria-pressed={d.reviewed}
          disabled={!d.reviewed && !ready}
          onClick={() => p.onDraft(pl, d.reviewed ? { reviewed: false } : APPROVE)}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {d.reviewed ? "Approved" : "Approve"} <span className="sr-only">{meta.name}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" aria-expanded={open} onClick={() => p.onEdit(pl)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Edit <span className="sr-only">{meta.name}</span>
        </Button>
        {p.onRegenerate && (
          <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-full px-3" disabled={busy || p.online === false} title={p.online === false ? "Pip needs a connection." : undefined} onClick={() => p.onRegenerate?.(pl)}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "motion-safe:animate-spin")} aria-hidden="true" />
            Regenerate <span className="sr-only">{meta.name}</span>
          </Button>
        )}
      </div>
    </li>
  );
}
