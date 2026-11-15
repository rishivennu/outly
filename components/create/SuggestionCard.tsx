"use client";
import { Check, PenLine, RotateCcw, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Draft } from "@/lib/client/checks";
import type { Proposal, Undo } from "./proposal";
import { proposalChanges, type FieldKey } from "./deck-logic";
import { ease } from "@/lib/motion/tokens";

interface Props {
  platform: Platform;
  draft: Draft;
  proposal?: Proposal;
  undo?: Undo;
  onAccept: () => void;
  /** Accepts, then puts the cursor in the first field it changed. */
  onEdit: (field: FieldKey | null) => void;
  onReject: () => void;
  onRevert: () => void;
  disabled?: boolean;
}

/** A Pip suggestion for one platform: what would change and why. Nothing changes until the person accepts it. */
export function SuggestionCard({ platform, draft, proposal, undo, onAccept, onEdit, onReject, onRevert, disabled }: Props) {
  const reduce = useReducedMotion();
  const enter = reduce ? { initial: false as const } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.22, ease: ease("out") } };
  const name = PLATFORM_META[platform].name;

  if (proposal) {
    const changes = proposalChanges(platform, draft, proposal);
    return (
      <motion.section {...enter} aria-label={`Suggestion for ${name}`} className="rounded-2xl bg-accent/10 p-4 hairline">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> Pip suggests
        </p>
        {changes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">This one already reads well. Nothing to change.</p>
        ) : (
          <dl className="mt-3 space-y-3">
            {changes.map((c) => (
              <div key={c.key} className="min-w-0">
                <dt className="text-[13px] font-medium text-muted-foreground">{c.label}</dt>
                <dd className="mt-0.5 line-clamp-4 whitespace-pre-line break-words text-[15px] leading-snug">{c.after || "Leave it empty"}</dd>
              </div>
            ))}
          </dl>
        )}
        {proposal.why && <p className="mt-3 text-[13px] text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{proposal.why}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {changes.length > 0 && (
            <>
              <Button size="md" variant="lime" onClick={onAccept} disabled={disabled}>
                <Check className="h-4 w-4" aria-hidden="true" /> Accept
              </Button>
              <Button size="md" variant="outline" onClick={() => onEdit(changes[0]?.key ?? null)} disabled={disabled}>
                <PenLine className="h-4 w-4" aria-hidden="true" /> Edit
              </Button>
            </>
          )}
          <Button size="md" variant="ghost" onClick={onReject}>
            <X className="h-4 w-4" aria-hidden="true" /> {changes.length ? "Reject" : "Dismiss"}
          </Button>
        </div>
      </motion.section>
    );
  }

  if (undo)
    return (
      <motion.div {...enter} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/50 px-4 py-2 hairline">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-success-ink" aria-hidden="true" /> Suggestion applied.
        </p>
        <Button size="md" variant="ghost" onClick={onRevert} disabled={disabled}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Revert
        </Button>
      </motion.div>
    );

  return null;
}
