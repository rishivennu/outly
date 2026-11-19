"use client";
import { fmtHandle } from "@/lib/handle";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import * as Switch from "@radix-ui/react-switch";
import { AlertCircle, Check, ChevronDown, CircleAlert, ImageIcon, Link2, MessageSquarePlus, Pencil, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { blocking, checksFor, composedCopy, countHashtags, HASHTAG_CAP, type Check as DeckCheck, type CheckField } from "@/lib/client/checks";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn } from "@/lib/utils";
import { SnippetBar } from "./SnippetBar";
import { PlatformPreview } from "./PlatformPreview";
import { SuggestionCard } from "./SuggestionCard";
import { bodyKey, bodyRoom, clipTo, fieldsFor, nextIndex, normalizeTags, previewDraft, previewNote, type FieldKey } from "./deck-logic";
import { enabledPlatforms, launchGate } from "./publish";
import type { Proposal, Undo } from "./proposal";
import type { AccountView, Draft, PlatformCopy } from "./types";
import { copyKey, type AdaptTone } from "@/lib/ai/adapt-core";
import { CaptionCards } from "./CaptionCards";
import { APPROVE, REVIEW_LABEL, reviewKind } from "./review-state";
import { ease } from "@/lib/motion/tokens";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface Props {
  drafts: Record<Platform, Draft>;
  onDraft: (p: Platform, patch: Partial<Draft>) => void;
  accounts: Partial<Record<Platform, AccountView>>;
  /** 1162: platforms with more than one connected account to choose from (the pick is kept on the draft as accountId). */
  options?: Partial<Record<Platform, AccountView[]>>;
  media: { src: string | null; poster: string | null; duration?: number | null; width?: number | null; height?: number | null };
  /** Places whose copy is still being written (each one unlocks as soon as its own copy lands). */
  writing: Platform[];
  rewriting: Platform | null;
  onRewrite: (p: Platform) => void;
  onConnect: (p: Platform) => void;
  hook: string;
  onHook: (h: string) => void;
  /** Rewrites and connecting need the network; off with a reason while offline. */
  online?: boolean;
  proposals: Partial<Record<Platform, Proposal>>;
  undo: Partial<Record<Platform, Undo>>;
  onAccept: (p: Platform) => void;
  onReject: (p: Platform) => void;
  onRevert: (p: Platform) => void;
  /** R1198: tells the page which platform is open in the editor (null when folded), so Pip works on that one. */
  onActive?: (p: Platform | null) => void;
  /** R1206: the creator's one caption from Your caption, read-only here. It is written in exactly one place. */
  story?: string;
  /** R1206: take the creator back to Your caption, the only place the caption is written. */
  onEditSource?: () => void;
  /** R1206: the platform to open first, when Launch sent the creator here to fix that one. */
  open?: Platform | null;
  /** R1209: what Pip last wrote for each place, so "Restore Pip's version" is one tap away. */
  adapted?: Partial<Record<Platform, PlatformCopy>>;
  /** R1209: Pip writes this place again from the main caption. A place the creator edited gets a suggestion. */
  onRegenerate?: (p: Platform) => void;
  onRegenerateAll?: (tone?: AdaptTone) => void;
  /** R1209: the direction Pip last wrote every place in. */
  tone?: AdaptTone | null;
  onRestore?: (p: Platform) => void;
  /** R1209: set only while Pip writes the platform captions. */
  onStopWriting?: () => void;
}

const SURFACE: Record<Platform, string> = {
  instagram: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(330_85%_62%/0.12),transparent_60%)]",
  youtube: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(0_88%_60%/0.12),transparent_60%)]",
  x: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--foreground)/0.05),transparent_60%)]",
  tiktok: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(178_85%_45%/0.10),transparent_60%)]",
  threads: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--foreground)/0.05),transparent_60%)]",
  facebook: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(214_89%_55%/0.11),transparent_60%)]",
  linkedin: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(201_100%_40%/0.11),transparent_60%)]",
};

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const fieldDom = (id: string, k: FieldKey) => `${id}-${k}`;

export function PlatformDeck(p: Props) {
  const enabled = enabledPlatforms(p.drafts);
  const live = useLivePlatforms();
  /** 1182: connected accounts first, as cards you can open to edit; everything else is a compact Not connected row. */
  const linked = live.filter((pl) => p.accounts[pl]?.status === "connected");
  const off = live.filter((pl) => p.accounts[pl]?.status !== "connected");
  const [picked, setActive] = useState<Platform>(() => (p.open && linked.includes(p.open) ? p.open : null) ?? enabled.find((pl) => p.accounts[pl]?.status === "connected") ?? enabled[0] ?? "instagram");
  const active = linked.includes(picked) ? picked : (linked[0] ?? picked);
  /** A second tap on the open card folds its editor; picking another card opens that one. */
  const [shut, setShut] = useState(false);
  const onActive = p.onActive;
  useEffect(() => {
    onActive?.(linked.length && !shut ? active : null);
  }, [active, shut, linked.length, onActive]);
  const offRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  // Sent here from Launch to fix one platform: its editor is the one in view, with focus on its card.
  const sentTo = useRef(p.open && linked.includes(p.open) ? p.open : null);
  useEffect(() => {
    const pl = sentTo.current;
    if (!pl) return;
    const t = setTimeout(() => {
      document.getElementById(`panel-${pl}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      cards.current[pl]?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toOff = () => {
    const el = offRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.querySelector<HTMLButtonElement>("button[data-connect]:not([disabled])")?.focus({ preventScroll: true });
  };
  const mainId = useId();
  const cards = useRef<Partial<Record<Platform, HTMLButtonElement | null>>>({});

  const status = useMemo(() => {
    const out = {} as Record<Platform, { checks: DeckCheck[]; blocked: boolean; label: string; tone: "ok" | "warn" | "off" | "done" }>;
    for (const pl of PLATFORMS) {
      const d = p.drafts[pl];
      const acct = p.accounts[pl];
      const checks = checksFor(pl, d, p.media);
      const blocked = blocking(checks);
      const connected = acct?.status === "connected";
      out[pl] = {
        checks,
        blocked: blocked || !connected,
        // R1209: the same three words as the caption cards: Needs review, Edited, Approved.
        label: !d.enabled ? (connected ? "Not sending" : acct ? "Needs a reconnect" : "Not connected") : !connected ? (acct ? "Needs a reconnect" : "Not connected yet") : blocked ? "Needs a hand" : p.proposals[pl] ? "Suggestion waiting" : REVIEW_LABEL[reviewKind(d)],
        tone: !d.enabled ? "off" : !connected || blocked ? "warn" : d.reviewed ? "done" : "ok",
      };
    }
    return out;
  }, [p.drafts, p.accounts, p.media, p.proposals]);

  // Skipped platforms are not in the gate at all, so switching one off can never hold up the launch.
  const { pending, ready } = launchGate(p.drafts, p.accounts, p.media, Object.keys(p.proposals) as Platform[]);

  const markReviewed = (pl: Platform) => {
    p.onDraft(pl, APPROVE);
    const next = enabled.find((x) => x !== pl && !p.drafts[x].reviewed && linked.includes(x));
    if (next) setTimeout(() => (setActive(next), setShut(false)), 350);
  };

  // A place with no live account can still be judged: its preview shows the copy it would get, and nothing more.
  const previewOnly = p.accounts[active]?.status !== "connected" && !p.drafts[active].enabled;
  const look = previewOnly ? previewDraft(active, p.drafts, p.hook) : { draft: p.drafts[active], source: "own" as const };

  /** R1209: Edit on a caption card opens this platform in the editor below, with the cursor in its words. */
  const editOne = (pl: Platform) => {
    setActive(pl);
    setShut(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const panel = document.getElementById(`panel-${pl}`);
        panel?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        panel?.querySelector<HTMLElement>("[data-body]")?.focus({ preventScroll: true });
      }),
    );
  };

  const onCardKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = linked.indexOf(active);
    const n = nextIndex(e.key, i, linked.length);
    if (n < 0 || !(e.target instanceof HTMLButtonElement) || !e.target.dataset.card) return;
    e.preventDefault();
    const pl = linked[n];
    setActive(pl);
    cards.current[pl]?.focus();
  };

  /* 1182: one editor for the picked connected account. Under 640px it opens right under its card; wider, under the cards. */
  const editor = linked.length ? (
      <motion.div
        key={active}
        role="region"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: ease("out") }}
        className="glass relative overflow-hidden rounded-[32px] p-4 sm:p-6"
      >
        <span className={cn("pointer-events-none absolute inset-0", SURFACE[active])} aria-hidden="true" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_clamp(260px,36%,380px)] lg:items-start lg:gap-8">
          <div className="min-w-0 lg:order-2">
            <PlatformPreview platform={active} draft={look.draft} media={p.media} account={p.accounts[active]} writing={p.writing.includes(active)} previewOnly={previewOnly ? previewNote(active, look.source) : undefined} />
          </div>
          <div className="min-w-0 lg:order-1">
            <PlatformStage
              {...p}
              platform={active}
              checks={status[active].checks}
              onReviewed={() => markReviewed(active)}
            />
          </div>
        </div>
      </motion.div>
  ) : null;

  return (
    <div className="w-full min-w-0">
      <header className="mb-6">
        <p className="eyebrow mb-2">03 · Everywhere</p>
        <h2 className="display text-[clamp(1.9rem,3.6vw,2.8rem)]">
          Now let&apos;s make it <span className="energy-text">fit everywhere.</span>
        </h2>
        <p className="mt-2 max-w-[60ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">Review each platform&apos;s version. Make your final edits before publishing.</p>
        {p.story?.trim() && (
          <SourceCaption
            story={p.story}
            onEditSource={p.onEditSource}
            active={linked.length && !shut ? active : null}
            activeWords={p.drafts[active][bodyKey(active)]}
            onUse={(text) => p.onDraft(active, { [bodyKey(active)]: clipTo(text, bodyRoom(active, p.drafts[active])), custom: true })}
          />
        )}
      </header>

      <section aria-labelledby={`${mainId}-dest`} className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${mainId}-dest`} className="text-base font-semibold">Your platforms</h3>
          <p className="tabular-nums text-[13px] text-muted-foreground">{linked.length === 0 ? "None yet" : enabled.length === 0 ? "Pick at least one" : `${enabled.length} selected`}</p>
        </div>
        {linked.length === 0 ? (
          <p className="rounded-2xl bg-secondary/30 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground hairline">
            No accounts connected yet, so there is nowhere to send this post. Connect one under Connect more platforms; your draft and its copy stay as they are.
          </p>
        ) : (
          /* R1198: a compact horizontal switcher. Selecting a card picks the one platform you edit (a second tap folds
             it); the checkbox under it decides if it is sent. Siblings, never nested. Only connected accounts get a card. */
          <div role="group" aria-label="Destinations" onKeyDown={onCardKeys} className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-2 [scrollbar-width:thin]">
            {linked.map((pl) => {
              const s = status[pl];
              const on = active === pl;
              const open = on && !shut;
              const d = p.drafts[pl];
              const acct = p.accounts[pl];
              const connected = acct?.status === "connected";
              const who = acct ? `${fmtHandle(acct.username)}${acct.mock ? " (practice)" : ""}` : "No account yet";
              const choice = connected && acct ? p.options?.[pl] : undefined;
              return (
                <Fragment key={pl}>
                  <div
                    className={cn(
                      "relative flex w-[min(80vw,236px)] shrink-0 snap-start flex-col rounded-3xl border transition-[background-color,border-color,box-shadow] duration-nav ease-out motion-reduce:transition-none",
                      on ? "border-foreground/35 bg-card shadow-[0_18px_50px_-30px_var(--halo)]" : "border-border/70 bg-secondary/30",
                    )}
                    style={{ ["--halo" as string]: PLATFORM_HALO[pl] }}
                  >
                    <button
                      type="button"
                      id={`tab-${pl}`}
                      data-card="1"
                      ref={(el) => {
                        cards.current[pl] = el;
                      }}
                      tabIndex={on ? 0 : -1}
                      aria-expanded={open}
                      aria-controls={open ? `panel-${pl}` : undefined}
                      aria-label={`Edit ${PLATFORM_META[pl].name}. ${who}. ${p.writing.includes(pl) && d.enabled ? "Writing" : s.label}.`}
                      onClick={() => (on ? setShut((v) => !v) : (setActive(pl), setShut(false)))}
                      className={cn("relative flex min-h-[64px] min-w-0 items-center gap-2.5 rounded-t-3xl p-3 pr-9 text-left", open && "pr-[76px]", " transition-[background-color] duration-hover ease-out motion-reduce:transition-none", FOCUS, !on && "[@media(hover:hover)]:hover:bg-secondary/60")}
                    >
                      <PlatformOrb platform={pl} size={30} />
                      <span className="min-w-0 flex-1" aria-hidden="true">
                        <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold">
                          <span className="truncate">{PLATFORM_META[pl].name}</span>
                          <span className="shrink-0 text-[13px] font-normal text-muted-foreground">{PLATFORM_META[pl].format}</span>
                        </span>
                        <span className="block truncate text-[13px] text-muted-foreground" title={who}>{who}</span>
                        <span className={cn("block truncate text-xs", s.tone === "done" ? "text-success-ink" : s.tone === "warn" ? "text-warning-ink" : "text-muted-foreground")}>
                          {p.writing.includes(pl) && d.enabled ? "Writing" : s.label}
                        </span>
                      </span>
                      {open && <span className="absolute right-3 top-3 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background" aria-hidden="true">Editing</span>}
                      <ChevronDown className={cn("absolute bottom-3.5 right-3 h-4 w-4 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
                    </button>
                    <div className="flex min-h-11 items-center justify-between gap-2 border-t border-border/60 pl-3.5 pr-1.5">
                      <label htmlFor={`send-${pl}`} className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-[13px] font-semibold">
                        <input
                          id={`send-${pl}`}
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) => p.onDraft(pl, { enabled: e.target.checked })}
                          className={cn("h-5 w-5 shrink-0 cursor-pointer accent-lime", FOCUS)}
                        />
                        <span className={d.enabled ? "text-foreground" : "text-muted-foreground"}>
                          {d.enabled ? "Sending" : "Not sending"} <span className="sr-only">to {PLATFORM_META[pl].name}</span>
                        </span>
                      </label>
                      {/* 1162: several accounts on this platform: which one. A native select, so it works the same on a phone. */}
                      {choice && acct && (
                        <span className="relative flex h-11 max-w-[46%] shrink-0 items-center">
                          <select
                            aria-label={`Which ${PLATFORM_META[pl].name} account`}
                            value={acct.id}
                            onChange={(e) => p.onDraft(pl, { accountId: e.target.value })}
                            className={cn("h-9 w-full cursor-pointer appearance-none truncate rounded-full bg-secondary pl-3 pr-7 text-[13px] font-semibold text-foreground hairline", FOCUS, "[@media(hover:hover)]:hover:bg-secondary/70")}
                          >
                            {choice.map((a) => (
                              <option key={a.id} value={a.id}>
                                {fmtHandle(a.username)}{a.mock ? " (practice)" : ""}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
        {off.length > 0 && (
          <button type="button" onClick={toOff} className={cn("mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-muted-foreground underline-offset-4 transition-[color] duration-hover ease-out motion-reduce:transition-none [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:hover:underline", FOCUS)}>
            <Link2 className="h-4 w-4" aria-hidden="true" /> Connect more platforms
          </button>
        )}
      </section>

      {linked.length > 0 && (
        <CaptionCards
          places={linked.filter((pl) => p.drafts[pl].enabled)}
          drafts={p.drafts}
          status={status}
          writing={p.writing}
          proposals={p.proposals}
          online={p.online}
          editing={!shut ? active : null}
          onDraft={p.onDraft}
          onEdit={editOne}
          onRegenerate={p.onRegenerate}
          onRegenerateAll={p.onRegenerateAll}
          tone={p.tone}
          onStop={p.onStopWriting}
        />
      )}

      {!shut && editor}

      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {enabled.length === 0 ? "Pick at least one place to send it." : ready ? "All set. Nothing goes out until you publish." : pendingLine(pending, linked)}
      </p>

      {/* 1182: places with no live account are one compact row each: what it is, that it is not connected, and Connect.
          No card, no empty preview. A place still switched on from an older draft can be left out right here. */}
      {off.length > 0 && (
        <section ref={offRef} aria-labelledby={`${mainId}-off`} className="mt-8 scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${mainId}-off`} className="text-base font-semibold">Connect more platforms</h3>
            <p className="text-[13px] text-muted-foreground">Preview only until you connect. Nothing is sent there.</p>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {off.map((pl) => {
              const d = p.drafts[pl];
              const acct = p.accounts[pl];
              const name = PLATFORM_META[pl].name;
              const format = PLATFORM_META[pl].format;
              return (
                <li key={pl} className="flex min-h-16 max-h-[76px] min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 py-2 pl-3 pr-1.5">
                  <PlatformOrb platform={pl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {name}
                      {format && <span className="font-normal text-muted-foreground"> · {format}</span>}
                    </span>
                    <span className={cn("block truncate text-[13px]", d.enabled ? "text-warning-ink" : "text-muted-foreground")}>
                      {acct ? "Needs a reconnect" : "Not connected"}
                      {d.enabled ? ", still switched on" : ""}
                    </span>
                  </span>
                  {d.enabled && (
                    <Button size="sm" variant="ghost" className="h-11 shrink-0 px-2.5" onClick={() => p.onDraft(pl, { enabled: false })}>
                      Leave out <span className="sr-only">{name}</span>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" data-connect="" className="h-11 shrink-0 rounded-full px-3 hairline" onClick={() => p.onConnect(pl)} disabled={p.online === false} title={p.online === false ? "Connecting needs a connection." : undefined}>
                    <Link2 className="h-4 w-4" aria-hidden="true" /> {acct ? "Reconnect" : "Connect"} <span className="sr-only">{name} to send</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * R1206: the one caption the creator wrote on Your caption, folded by default and read-only here. It can be viewed,
 * put on the open platform as it is, or changed, which takes them back to the single editor. There is no second
 * writer: a caption is written in exactly one place, and nothing here changes a platform's words unasked.
 */
function SourceCaption(p: {
  story: string;
  active: Platform | null;
  activeWords: string;
  onUse: (text: string) => void;
  onEditSource?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<"use" | null>(null);
  const name = p.active ? PLATFORM_META[p.active].name : "";
  const use = () => (p.activeWords.trim() && p.activeWords.trim() !== p.story.trim() ? setAsk("use") : p.onUse(p.story));
  return (
    <section aria-labelledby={`${id}-h`} className="mt-4 max-w-3xl rounded-2xl bg-secondary/30 hairline">
      <h3 id={`${id}-h`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((v) => !v)}
          className={cn("flex min-h-12 w-full items-center gap-2 rounded-2xl px-3.5 text-left text-sm font-semibold", FOCUS)}
        >
          <span className="min-w-0 flex-1">
            Original caption
            <span className="ml-2 font-normal text-muted-foreground">{open ? "" : "View original"}</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open} className="px-3.5 pb-3.5">
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-card px-3 py-2.5 text-[13px] leading-relaxed hairline" dir="auto">
          {p.story}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">Your caption is the one place it is written. Change it there and ask Pip again, and every platform follows.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {p.onEditSource && (
            <Button type="button" size="sm" variant="subtle" className="min-h-11 rounded-full px-3.5" onClick={p.onEditSource}>
              <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Change your caption
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" className="min-h-11 rounded-full px-3.5" disabled={!p.active} onClick={use} title={p.active ? undefined : "Open a platform first."}>
            Use original caption{name ? <span className="sr-only"> for {name}</span> : null}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={ask === "use"}
        onOpenChange={(o) => !o && setAsk(null)}
        title={`Use your original caption for ${name}?`}
        body={`${name}'s caption is replaced with your original words, trimmed to fit if needed. The other platforms stay as they are.`}
        confirmLabel="Use original caption"
        cancelLabel="Keep this one"
        tone="primary"
        onConfirm={() => {
          setAsk(null);
          p.onUse(p.story);
        }}
      />
    </section>
  );
}

/** 1182: connected places to look over first; places still switched on without an account get one short clause. */
function pendingLine(pending: readonly Platform[], linked: readonly Platform[]) {
  const names = (xs: readonly Platform[]) => xs.map((x) => PLATFORM_META[x].name).join(", ");
  const on = pending.filter((x) => linked.includes(x));
  const off = pending.filter((x) => !linked.includes(x));
  const parts = [on.length ? `${on.length} to approve: ${names(on)}` : "", off.length ? `Switched on but not connected: ${names(off)}. Connect or leave out` : ""];
  return parts.filter(Boolean).join(". ");
}

function FieldChecks({ checks, field, id }: { checks: DeckCheck[]; field: CheckField; id: string }) {
  const list = checks.filter((c) => c.field === field && c.level !== "ok");
  if (!list.length) return null;
  return (
    <ul id={id} className="mt-1.5 space-y-1">
      {list.map((c) => (
        <li key={c.text} className={cn("flex items-start gap-1.5 text-[13px]", c.level === "error" ? "text-destructive" : "text-warning-ink")}>
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">{c.level === "warning" ? "Heads up: " : "Fix: "}</span>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

type StageProps = Props & { platform: Platform; checks: DeckCheck[]; onReviewed: () => void };

function PlatformStage(p: StageProps) {
  const pl = p.platform;
  const d = p.drafts[pl];
  const meta = PLATFORM_META[pl];
  const f = fieldsFor(pl);
  const acct = p.accounts[pl];
  const connected = acct?.status === "connected";
  const id = useId();
  const blocked = blocking(p.checks);
  const set = (patch: Partial<Draft>) => p.onDraft(pl, patch);
  const offline = p.online === false;
  const busy = p.writing.includes(pl);
  // Not connected and not switched on: only the preview and a way to connect. No fields, no review, nothing to send.
  const previewOnly = !connected && !d.enabled;
  const [flash, setFlash] = useState(false);
  const [fcOpen, setFcOpen] = useState(!!d.firstComment.trim());
  const has = (field: CheckField) => p.checks.some((c) => c.field === field && c.level !== "ok");
  const bad = (field: CheckField) => p.checks.some((c) => c.field === field && c.level === "error");

  useEffect(() => {
    if (!d.reviewed) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [d.reviewed]);

  const bodyLen = composedCopy(pl, d).length; // the gate counts caption plus hashtags, so the counter has to as well
  const tagCount = countHashtags(d.hashtags);
  const cap = HASHTAG_CAP[pl];
  const general = p.checks.filter((c) => !c.field || c.field === "media" || c.field === "account");

  // R1209: the creator changed Pip's words here; Pip's last version is one tap away.
  const pip = p.adapted?.[pl];
  const restorable = !!pip && !!p.onRestore && copyKey(d) !== copyKey({ title: pip.title ?? "", caption: pip.caption, description: pip.description ?? "", hashtags: pip.hashtags });

  // R1206: there is no shared writer here any more, so typing in a place is always that place's own words.
  const editBody = (v: string) => set({ [f.body.key]: v, custom: true });

  const acceptThen = (field: FieldKey | null) => {
    const proposal = p.proposals[pl];
    p.onAccept(pl);
    // An accepted caption is this place's own now, so the main caption leaves it alone.
    if (proposal && typeof proposal.patch[f.body.key] === "string" && proposal.patch[f.body.key] !== d[f.body.key]) set({ custom: true });
    if (!field) return;
    if (field === "firstComment") setFcOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(fieldDom(id, field))?.focus()));
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PlatformOrb platform={pl} size={32} />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold tracking-tight">
              {meta.name} {meta.format}
            </h3>
            <p className="truncate text-[13px] text-muted-foreground" title={fmtHandle(acct?.username)}>
              {acct ? `as ${fmtHandle(acct.username)}` : "No account connected"}
            </p>
          </div>
        </div>
        {/* 1182: no Preview only pill; the Connect line below already says why nothing is sent. */}
        {previewOnly ? null : (
        <label className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground">
          <span>{d.enabled ? "Sending here" : "Not sending"}</span>
          <Switch.Root
            checked={d.enabled}
            onCheckedChange={(v) => set({ enabled: v })}
            aria-label={`Send to ${meta.name}`}
            className={cn("relative h-7 w-12 shrink-0 rounded-full bg-secondary transition-colors duration-press hairline motion-reduce:transition-none data-[state=checked]:bg-lime data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--lime)/0.5)]", FOCUS)}
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-muted-foreground shadow transition-transform duration-press motion-reduce:transition-none data-[state=checked]:translate-x-6 data-[state=checked]:bg-[hsl(var(--lime-foreground))]" />
          </Switch.Root>
        </label>
        )}
      </div>

      {d.note && d.enabled && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-accent/10 px-4 py-3 text-[15px]">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            {pl === "youtube" ? "YouTube wants a stronger title. I wrote one that people actually search for." : pl === "x" ? "Let's make this impossible to ignore. Short, sharp, no hashtags." : pl === "instagram" ? "Instagram is ready. A hook up front, one ask, and tags that travel." : `${d.note.replace(/\.$/, "")}. Written to its rules.`}
            {d.why && <span className="mt-1 block text-[13px] text-muted-foreground">{d.why}</span>}
          </span>
        </div>
      )}

      {!connected && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3", d.enabled ? "bg-warning/10" : "bg-secondary/50 hairline")}>
          <span className="flex items-center gap-2 text-sm">
            <CircleAlert className={cn("h-4 w-4 shrink-0", d.enabled ? "text-warning-ink" : "text-muted-foreground")} aria-hidden="true" />
            {acct ? `${meta.name} needs you to reconnect.` : d.enabled ? `Connect ${meta.name} to send it here.` : `Connect ${meta.name} to send. Until then the preview shows how it would look.`}
          </span>
          <Button size="md" variant="primary" onClick={() => p.onConnect(pl)} disabled={offline} title={offline ? "Connecting needs a connection." : undefined}>
            <Link2 className="h-4 w-4" /> {acct ? "Reconnect" : "Connect account"}
          </Button>
        </div>
      )}

      {previewOnly ? null : (
      <>
      <SuggestionCard
        platform={pl}
        draft={d}
        proposal={p.proposals[pl]}
        undo={p.undo[pl]}
        onAccept={() => acceptThen(null)}
        onEdit={acceptThen}
        onReject={() => p.onReject(pl)}
        onRevert={() => p.onRevert(pl)}
        disabled={!d.enabled}
      />

      <fieldset disabled={!d.enabled || busy} className="min-w-0 space-y-5 disabled:opacity-50">
        <legend className="sr-only">{meta.name} copy</legend>

        {f.title && (
          <div>
            <Label htmlFor={fieldDom(id, "title")}>
              {f.title.label} {f.title.limit ? <Counter value={d.title.length} max={f.title.limit} /> : <span className="tabular-nums text-xs text-muted-foreground">{d.title.length}</span>}
            </Label>
            <Input
              id={fieldDom(id, "title")}
              value={d.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={f.title.placeholder}
              aria-invalid={bad("title") || undefined}
              aria-describedby={has("title") ? `${id}-title-c` : undefined}
            />
            <FieldChecks checks={p.checks} field="title" id={`${id}-title-c`} />
          </div>
        )}

        <div>
          <Label htmlFor={fieldDom(id, f.body.key)}>
            {f.body.label} <Counter value={bodyLen} max={f.body.limit} />
          </Label>
          <Textarea
            id={fieldDom(id, f.body.key)}
            rows={pl === "x" ? 4 : 7}
            data-body=""
            value={d[f.body.key]}
            onChange={(e) => editBody(e.target.value)}
            placeholder={pl === "x" ? "Say it in one breath." : pl === "youtube" ? "What is it about, and why watch to the end?" : "Tell them why it matters."}
            aria-invalid={bad("body") || undefined}
            aria-describedby={`${id}-body-h${has("body") ? ` ${id}-body-c` : ""}`}
          />
          <p id={`${id}-body-h`} className="mt-1.5 text-[13px] text-muted-foreground">
            {f.hashtags && d.hashtags.trim() ? "The count includes your hashtags." : pl === "x" ? "X has no hashtag field. Put any tags in the post." : "Only this place gets these words."}
          </p>
          <FieldChecks checks={p.checks} field="body" id={`${id}-body-c`} />
        </div>

        {f.hashtags && (
          <div>
            <Label htmlFor={fieldDom(id, "hashtags")}>
              Hashtags
              <span className={cn("tabular-nums text-xs", cap && tagCount > cap.max ? "text-destructive" : "text-muted-foreground")}>
                {tagCount}
                {cap ? `/${cap.max}` : ""} <span className="sr-only">hashtags</span>
              </span>
            </Label>
            <Input
              id={fieldDom(id, "hashtags")}
              value={d.hashtags}
              onChange={(e) => set({ hashtags: e.target.value })}
              onBlur={(e) => {
                const clean = normalizeTags(e.target.value);
                // Tidying the tags is not an edit, so it never takes an approval back.
                if (clean !== d.hashtags) set({ hashtags: clean, reviewed: !!d.reviewed });
              }}
              placeholder="#oneidea #anotherone"
              aria-invalid={bad("hashtags") || undefined}
              aria-describedby={`${id}-tags-h${has("hashtags") ? ` ${id}-tags-c` : ""}`}
            />
            <p id={`${id}-tags-h`} className="mt-1.5 text-[13px] text-muted-foreground">
              Space between tags. We add the # and drop repeats{meta.hashtagStyle === "few" ? ". A few focused tags work best." : "."}
            </p>
            <FieldChecks checks={p.checks} field="hashtags" id={`${id}-tags-c`} />
          </div>
        )}

        {f.firstComment &&
          (fcOpen ? (
            <div>
              <Label htmlFor={fieldDom(id, "firstComment")}>
                {f.firstComment.label} (optional) <Counter value={d.firstComment.length} max={f.firstComment.limit} />
              </Label>
              <Textarea
                id={fieldDom(id, "firstComment")}
                rows={2}
                value={d.firstComment}
                onChange={(e) => set({ firstComment: e.target.value })}
                aria-invalid={bad("firstComment") || undefined}
                aria-describedby={`${id}-fc-h${has("firstComment") ? ` ${id}-fc-c` : ""}`}
                placeholder={pl === "x" ? "A link, a source, or the next thought." : "Hashtags, a link, or a question."}
              />
              <FieldChecks checks={p.checks} field="firstComment" id={`${id}-fc-c`} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p id={`${id}-fc-h`} className="text-[13px] text-muted-foreground">{f.firstComment.hint}</p>
                {f.hashtags && d.hashtags.trim() && (
                  <Button type="button" size="md" variant="subtle" onClick={() => set({ firstComment: [d.firstComment.trim(), d.hashtags.trim()].filter(Boolean).join("\n\n"), hashtags: "" })}>
                    Move hashtags here
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="md" className="-ml-2" onClick={() => {
              setFcOpen(true);
              requestAnimationFrame(() => document.getElementById(fieldDom(id, "firstComment"))?.focus());
            }}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> Add a {f.firstComment.label.toLowerCase()}
            </Button>
          ))}

        {f.cover !== "none" && (
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {f.cover === "upload" ? `You can add a cover for ${meta.name} on the Launch step.` : `${meta.name} uses a frame from your video as the cover.`}
          </p>
        )}

        <SnippetBar
          caption={d[f.body.key]}
          hashtags={d.hashtags}
          showTags={f.hashtags}
          onCaption={(v) => editBody(v)}
          onTags={(v) => set({ hashtags: v })}
        />
      </fieldset>

      <ul className="space-y-1.5" aria-label="Checks">
        {general.map((c) => (
          <li key={c.text} className={cn("flex items-center gap-2 text-[14px]", c.level === "error" ? "text-destructive" : c.level === "warning" ? "text-warning-ink" : "text-success-ink")}>
            {c.level === "ok" ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="sr-only">{c.level === "ok" ? "Good: " : c.level === "warning" ? "Heads up: " : "Fix: "}</span>
            {c.text}
          </li>
        ))}
        {blocked && !general.some((c) => c.level === "error") && (
          <li className="flex items-center gap-2 text-[14px] text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> Fix the notes above to send it here.
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={d.reviewed && !blocked ? "outline" : "primary"}
          onClick={() => (d.reviewed ? set({ reviewed: false }) : p.onReviewed())}
          disabled={!d.enabled || blocked || busy || !connected || (!d.reviewed && !!p.proposals[pl])}
          aria-pressed={d.reviewed}
        >
          <motion.span animate={flash ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 0.45, ease: ease("out") }} className="inline-flex motion-reduce:transform-none">
            <Check className="h-4 w-4" />
          </motion.span>
          {d.reviewed ? "Approved" : "Approve"}
        </Button>
        <Button variant="ghost" onClick={() => p.onRewrite(pl)} disabled={!d.enabled || p.rewriting === pl || busy || offline} aria-describedby={`${id}-rw`}>
          <RefreshCw className={cn("h-4 w-4", p.rewriting === pl && "animate-spin motion-reduce:animate-none")} /> Rewrite this one
        </Button>
        <span id={`${id}-rw`} className="sr-only">Pip suggests new words. Nothing changes until you accept.</span>
        {restorable && (
          <Button variant="ghost" onClick={() => p.onRestore?.(pl)} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restore Pip&apos;s version
          </Button>
        )}
      </div>
      </>
      )}
      {offline && <p className="text-[13px] text-muted-foreground">You&apos;re offline. Rewrites and connecting come back when you reconnect. Your edits are kept on this device.</p>}
    </div>
  );
}
