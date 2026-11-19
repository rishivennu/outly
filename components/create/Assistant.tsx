"use client";
import { useEffect, useMemo, useRef, useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn, formatDuration } from "@/lib/utils";
import { captionFactsKey, captionTips, pipFooter, stepLine, type CaptionFacts, type PipFooterId } from "./assistant-state";
import { useCaptionPick } from "./captions/CaptionRun";
import { limitFacts } from "./UploadCard";
import type { UploadLimits } from "@/lib/client/upload";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Draft, Step, UploadState, WatchState } from "./types";
import type { Hold } from "./publish";
import { T } from "@/lib/motion/tokens";
import { PipActions, type PipActionsProps } from "./PipActions";

interface Props {
  step: Step;
  hasMedia: boolean;
  upload: UploadState;
  meta: { duration?: number | null; width?: number | null; height?: number | null } | null;
  /** 1160: Pip watching the video. R1209 A3: only a status here; the caption it writes lands on the page. */
  watch?: WatchState;
  /** R1209 A3: who writes Your Story's caption, so Pip talks about the right box. */
  captionMode?: "generate" | "own";
  copyLoading: boolean;
  drafts: Record<Platform, Draft>;
  platforms: Platform[];
  /** Places with a Pip suggestion waiting for Accept or Skip on their card. */
  proposed?: Platform[];
  /** Launch: places switched on that won't be sent, with why. */
  hold?: Hold[];
  /** Launch: places that will really get it. */
  sending?: Platform[];
  mode?: "now" | "schedule";
  /** 1182: the server's upload limits for Step 1 (null while loading or when the request failed). */
  limits?: UploadLimits | null;
  limitsFailed?: boolean;
  online?: boolean;
  /** 1182: the caption editor is on the page (the video is in), so Pip can talk about it. */
  captions?: boolean;
  /** R1209: on Your Story the caption on the page is what Everywhere waits for. */
  hasCaption?: boolean;
  /** Your Story is open (the server has the video), and why not when it isn't. */
  storyOpen?: boolean;
  storyWhy?: string | null;
  /** The footer's lit button: the page's own move for this step. */
  onFooter?: (id: PipFooterId) => void;
  /** Close only folds Pip: nothing is saved, finalized or sent. */
  onClose?: () => void;
  /** R1198: Pip's one-tap asks on Your Story and Everywhere, each answered as a suggestion to accept or skip. */
  pip?: PipActionsProps | null;
  /** R1209 A3: wider on a desktop, full screen on a phone; the header button toggles it. */
  expanded?: boolean;
  onExpand?: () => void;
}

const names = (ps: Platform[]) => {
  const n = ps.map((p) => PLATFORM_META[p].name);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n.at(-1)}` : (n[0] ?? "");
};

/**
 * What Pip says about a place on Everywhere. Pure, so it is tested. It talks about the words on the card and
 * never says anything has been published or scheduled: only the server can say that, on the publishing screen.
 */
export function deckLine(p: Platform, d: Draft, proposed: boolean): string {
  const name = PLATFORM_META[p].name;
  if (proposed) return `I have new words for ${name}. Accept, edit or skip them on its card.`;
  if (d.reviewed) return `${name} looks good to you.`;
  return d.note || `Have a look at ${name}.`;
}

/** What Pip says on Launch: what is held back first, then what to press. Never a claim that it went out. */
export function launchLine(x: { hold: Hold[]; sending: Platform[]; mode: "now" | "schedule" }): { lead: string; items: string[] } {
  if (x.hold.length) return { lead: x.hold.length === 1 ? "One place won't go yet:" : `${x.hold.length} places won't go yet:`, items: x.hold.map((h) => `${PLATFORM_META[h.platform].name}: ${h.reason}`) };
  if (!x.sending.length) return { lead: "Switch on at least one place in Everywhere first.", items: [] };
  const where = names(x.sending);
  return x.mode === "schedule" ? { lead: `All set for ${where}. Pick a time, then press Schedule post below.`, items: [] } : { lead: `All set for ${where}. Press Publish below when you're ready.`, items: [] };
}

function Bubble({ from, children, className }: { from: "outly" | "you"; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={T.card}
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

/**
 * R1209 A3: Pip beside the page. The caption is written and approved on the page only (one box, one Accept, one
 * approval): Pip never shows a second caption box, a second copy of a suggestion or its own Accept buttons. It
 * says one short line for the step and the caption mode, and offers the asks the page doesn't already have.
 */
export function Assistant(p: Props) {
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const footNoteId = `${useId()}-foot`;
  const key = [p.step, p.upload.kind, p.watch?.kind, p.copyLoading, p.hold?.length, p.proposed?.join(","), p.mode, p.captionMode, p.hasCaption].join("|");
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [key, reduce]);

  const vertical = p.meta?.width && p.meta?.height ? p.meta.height > p.meta.width : null;

  /* 1182: Step 1 facts from the server, caption notes from the real run, and the footer's one lit button. */
  const facts = limitFacts(p.limits ?? null);
  const capKey = useCaptionPick(captionFactsKey);
  const capNotes = useMemo(() => (capKey && p.captions ? captionTips(JSON.parse(capKey) as CaptionFacts) : []), [capKey, p.captions]);
  const footer = p.onFooter ? pipFooter({ step: p.step, storyOpen: !!p.storyOpen, storyWhy: p.storyWhy, finalized: !!p.hasCaption, canFinalize: false, composer: p.hasMedia }) : null;
  const footNote = footer?.hint ?? null;
  const watching = p.step === "story" && p.watch?.kind === "watching";
  const busyNow = p.copyLoading || !!p.pip?.busy || !!p.pip?.caption?.busy;
  const status = p.online === false ? "Offline. I'm back when you reconnect." : busyNow ? "Writing…" : watching ? "Watching your video…" : "Available";
  const target = p.step === "everywhere" ? (p.pip?.target ?? null) : null;
  const line = stepLine({ step: p.step, mode: p.captionMode ?? "generate", hasCaption: !!p.hasCaption, watching, place: target ? PLATFORM_META[target].name : null, limit: target ? PLATFORM_META[target].captionLimit : null });
  const next =
    p.step !== "video"
      ? null
      : !p.hasMedia
        ? "Next: pick your video."
        : p.upload.kind === "uploading"
          ? "Next: let it finish, then Continue to Your Story."
          : p.upload.kind === "paused"
            ? "Next: resume the upload."
            : p.upload.kind === "failed"
              ? "Next: try the upload again, or pick another video."
              : "Next: Continue to Your Story for your caption.";
  /* The upload notes matter while the video is coming in; once it's in, later steps say only their own line. */
  const early = p.step === "video" || p.step === "story";

  return (
    <section aria-label="Creative partner" className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-[64px] shrink-0 items-center gap-3 py-2.5 pl-5 pr-16 xl:min-h-[76px] xl:py-3">
        <span className="lime-bg relative grid h-9 w-9 shrink-0 place-items-center rounded-full">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", p.online === false ? "bg-muted-foreground" : "bg-success")} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Outlly Assistant</h2>
          <p className="truncate text-xs text-muted-foreground" role="status">{status}</p>
        </div>
        {p.onExpand && (
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={p.onExpand} aria-label={p.expanded ? "Make the assistant smaller" : "Expand the assistant"} data-pip-expand={p.expanded ? "on" : "off"}>
            {p.expanded ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </Button>
        )}
      </header>

      <div className="scrollbar-none min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-2 [mask-image:linear-gradient(to_bottom,transparent_0,#000_28px)]" aria-live="polite">
        {!p.hasMedia && (
          <Bubble from="outly">
            <span className="font-semibold">Hi, I&apos;m Pip.</span> Upload your video and I&apos;ll help you prepare it for every platform. You approve every word before anything goes out.
          </Bubble>
        )}
        {/* 1182: how to upload and what fits, from the server's own limits (the same line the card shows). */}
        {!p.hasMedia && p.step === "video" && (
          <div role="group" aria-label="How to upload" className="rounded-2xl bg-secondary/50 p-3.5 hairline">
            <p className="text-[13px] font-semibold">How to upload</p>
            <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Press Browse files on the card, or drop a video onto it. One video makes one post; several at once go to a batch.</p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5 text-xs font-medium" aria-label="What you can upload">
              <li className="rounded-full bg-card px-2.5 py-1 hairline">{facts.formats}</li>
              <li className="rounded-full bg-card px-2.5 py-1 tabular-nums hairline">{facts.size ?? (p.limitsFailed ? "Size checked when the upload starts" : "Checking your limits…")}</li>
              {facts.storage && <li className="rounded-full bg-card px-2.5 py-1 tabular-nums hairline">{facts.storage}</li>}
            </ul>
          </div>
        )}
        {/* 1170: Step 1 tips, short and only what is true of Outlly today. */}
        {!p.hasMedia && p.step === "video" && (
          <ul className="space-y-1.5 pl-1 text-[13px] leading-snug text-muted-foreground" aria-label="Before you upload">
            <li>Vertical 9:16 fits Reels, Shorts and TikTok without bars.</li>
            <li>Want music? Add it in your editor first. Outlly posts the sound that&apos;s in your video.</li>
            <li>Next, Outlly writes your caption from the video, or you write your own. You approve every word.</li>
          </ul>
        )}
        {p.hasMedia && p.upload.kind === "uploading" && (
          <Bubble from="outly">
            {p.step === "video" ? "Bringing it in. Continue opens as soon as it's uploaded." : "Bringing it in. You can start on your caption while it uploads."}
          </Bubble>
        )}
        {p.hasMedia && p.upload.kind === "paused" && <Bubble from="outly">Upload paused. Resume when you&apos;re ready.</Bubble>}
        {p.hasMedia && p.upload.kind === "failed" && (
          <Bubble from="outly">
            That upload didn&apos;t make it. <span className="text-muted-foreground">{p.upload.message} Try it again when you&apos;re ready.</span>
            <span className="mt-2 block text-sm text-muted-foreground">
              If it fails again, check your connection first. The video has to be an {facts.formats}
              {facts.size ? `, ${facts.size.replace(/^Up to/, "up to")}` : ""}. Your caption stays while you retry.
            </span>
          </Bubble>
        )}
        {early && p.hasMedia && p.upload.kind === "done" && p.meta?.duration ? (
          <Bubble from="outly">
            Your video is in. <span className="text-muted-foreground">{formatDuration(p.meta.duration)}{vertical === null ? "" : vertical ? ", vertical. Perfect for Reels and Shorts." : ", horizontal. It'll sit with bars on vertical feeds."}</span>
          </Bubble>
        ) : null}
        {next && <p className="pl-1 text-[13px] font-medium text-foreground">{next}</p>}

        {/* R1209 A3: one line for the step and the caption mode, in place of asking what the video is about. */}
        {line && (
          <Bubble from="outly" className="max-w-full">
            <span className="display block text-[22px] leading-[1.1] tracking-[-0.03em]" data-pip-line={p.step === "story" ? p.captionMode ?? "generate" : p.step}>
              {line.title}
            </span>
            <span className="mt-1.5 block text-sm text-muted-foreground">{line.body}</span>
          </Bubble>
        )}

        {/* 1182: caption notes from the real run (language, translation, what failed), only once the editor is there. */}
        {p.step === "story" && capNotes.length > 0 && (
          <div role="group" aria-label="Captions on the video" className="rounded-2xl bg-secondary/50 p-3.5 hairline">
            <p className="text-[13px] font-semibold">Captions on the video</p>
            <ul className="mt-1 space-y-1.5 text-[13px] leading-snug text-muted-foreground">
              {capNotes.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}

        <AnimatePresence>{p.copyLoading && <Typing label="Writing something different for each place…" />}</AnimatePresence>

        {p.step === "everywhere" && !p.copyLoading && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T.nav} className="space-y-2.5" aria-label="What to look at">
            {p.platforms
              .filter((pl) => p.drafts[pl].enabled)
              .map((pl) => (
                <li key={pl} className="flex items-start gap-3 text-[15px] leading-snug">
                  <PlatformOrb platform={pl} size={28} />
                  <span className="min-w-0 pt-0.5">
                    <span className="sr-only">{PLATFORM_META[pl].name}: </span>
                    {deckLine(pl, p.drafts[pl], !!p.proposed?.includes(pl))}
                  </span>
                  {p.drafts[pl].reviewed && <Check className="ml-auto mt-1 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" />}
                </li>
              ))}
          </motion.ul>
        )}

        {p.step === "launch" &&
          (() => {
            const l = launchLine({ hold: p.hold ?? [], sending: p.sending ?? [], mode: p.mode ?? "now" });
            return (
              <Bubble from="outly">
                {l.lead}
                {l.items.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {l.items.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </Bubble>
            );
          })()}
        {p.pip && (p.step === "story" || p.step === "everywhere") && <PipActions {...p.pip} />}
        <div ref={end} />
      </div>

      {/* 1182: always a way forward besides the X. Close only folds Pip; the lit button is this step's next move. */}
      {footer && (
        <footer className="shrink-0 border-t border-border/60 px-4 pb-3 pt-2.5">
          {footNote && (
            <p id={footNoteId} className="mb-2 text-xs leading-snug text-muted-foreground" aria-live="polite">
              {footNote}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="min-h-11 shrink-0 px-3.5" onClick={p.onClose}>
              Close
            </Button>
            <Button type="button" variant="lime" className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal py-2 leading-tight" disabled={footer.disabled} aria-describedby={footNote ? footNoteId : undefined} onClick={() => footer.id !== "finalize" && p.onFooter?.(footer.id)}>
              {footer.id === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              <span className="text-balance text-center">{footer.label}</span>
            </Button>
          </div>
        </footer>
      )}
    </section>
  );
}
