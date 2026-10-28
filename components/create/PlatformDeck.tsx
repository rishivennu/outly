"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as Switch from "@radix-ui/react-switch";
import { AlertCircle, ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, Link2, MinusCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Counter, Input, Label, Textarea } from "@/components/ui/field";
import { PlatformOrb, PLATFORM_HALO } from "@/components/shared/PlatformIcon";
import { blocking, checksFor } from "@/lib/client/checks";
import { FIRST_COMMENT_LIMIT, PLATFORM_META, PLATFORMS, supportsFirstComment, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { cn } from "@/lib/utils";
import { InstagramReel, XPost, YouTubeShort } from "./Previews";
import { SnippetBar } from "./SnippetBar";
import { enabledPlatforms, launchGate } from "./publish";
import type { AccountView, Draft } from "./types";

interface Props {
  drafts: Record<Platform, Draft>;
  onDraft: (p: Platform, patch: Partial<Draft>) => void;
  accounts: Partial<Record<Platform, AccountView>>;
  media: { src: string | null; poster: string | null; duration?: number | null; width?: number | null; height?: number | null };
  loading: boolean;
  rewriting: Platform | null;
  onRewrite: (p: Platform) => void;
  onConnect: (p: Platform) => void;
  onContinue: () => void;
  hook: string;
  onHook: (h: string) => void;
}

const READY_LABEL: Record<Platform, string> = { instagram: "Ready to go", youtube: "Wants a stronger title", x: "Make it impossible to ignore", tiktok: "Hook in the first second", threads: "Keep it conversational", facebook: "Ready for the feed", linkedin: "Lead with the lesson" };

const SURFACE: Record<Platform, string> = {
  instagram: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(330_85%_62%/0.16),transparent_60%),radial-gradient(100%_80%_at_100%_100%,hsl(30_95%_60%/0.10),transparent_60%)]",
  youtube: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(0_88%_60%/0.16),transparent_60%)]",
  x: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--foreground)/0.07),transparent_60%)]",
  tiktok: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(178_85%_45%/0.14),transparent_60%),radial-gradient(100%_80%_at_100%_100%,hsl(348_95%_58%/0.10),transparent_60%)]",
  threads: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--foreground)/0.07),transparent_60%)]",
  facebook: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(214_89%_55%/0.15),transparent_60%)]",
  linkedin: "bg-[radial-gradient(120%_80%_at_0%_0%,hsl(201_100%_40%/0.15),transparent_60%)]",
};

export function PlatformDeck(p: Props) {
  const enabled = enabledPlatforms(p.drafts);
  const [active, setActive] = useState<Platform>(enabled[0] ?? "instagram");
  const hookId = useId();
  const live = useLivePlatforms();
  const reduce = useReducedMotion();

  // The destination rail scrolls sideways once there are more places than fit. Arrows and edge fades show
  // there is more, a vertical wheel scrolls it on desktop, and the active tab is kept in view.
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const room = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
      if (!room) return; // at the end: let the page scroll on
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure, live.length]);
  const nudge = (dir: 1 | -1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * Math.max(220, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  useEffect(() => {
    const tab = document.getElementById(`tab-${active}`)?.parentElement;
    tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [active, reduce]);

  const status = useMemo(() => {
    const out = {} as Record<Platform, { checks: ReturnType<typeof checksFor>; blocked: boolean; label: string; tone: "ok" | "warn" | "off" | "done" }>;
    for (const pl of PLATFORMS) {
      const d = p.drafts[pl];
      const acct = p.accounts[pl];
      const checks = checksFor(pl, d, p.media);
      const blocked = blocking(checks);
      const connected = acct?.status === "connected";
      out[pl] = {
        checks,
        blocked: blocked || !connected,
        label: !d.enabled ? "Skipping this one" : !connected ? (acct ? "Needs a reconnect" : "Not connected yet") : d.reviewed && !blocked ? "Looks good" : blocked ? "Needs a hand" : READY_LABEL[pl],
        tone: !d.enabled ? "off" : !connected || blocked ? "warn" : d.reviewed ? "done" : "ok",
      };
    }
    return out;
  }, [p.drafts, p.accounts, p.media]);

  // Skipped platforms are not in the gate at all, so switching one off can never hold up the launch.
  const { pending, ready } = launchGate(p.drafts, p.accounts, p.media);

  const markReviewed = (pl: Platform) => {
    p.onDraft(pl, { reviewed: true });
    const next = enabled.find((x) => x !== pl && !p.drafts[x].reviewed);
    if (next) setTimeout(() => setActive(next), 350);
  };

  return (
    <div className="w-full">
      <header className="mb-8">
        <p className="eyebrow mb-3">03 · Everywhere</p>
        <h2 className="display text-[clamp(2.2rem,5vw,3.8rem)]">
          Now let&apos;s make it
          <br />
          <span className="energy-text">fit everywhere.</span>
        </h2>
        <div className="mt-6 max-w-xl">
          <Label htmlFor={hookId}>
            Your hook <Counter value={p.hook.length} max={500} />
          </Label>
          <Input id={hookId} value={p.hook.replace(/\n/g, " ")} maxLength={500} onChange={(e) => p.onHook(e.target.value)} className="font-semibold" />
        </div>
      </header>

      {/* Destination picker. The on/off control is a sibling of the tab, never nested inside it. */}
      <div className="relative mb-6">
      <div ref={rail} className={cn("deck-rail -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3", edge.l && "deck-fade-l", edge.r && "deck-fade-r")}>
        <div role="group" aria-label="Destinations" className="contents">
          {live.map((pl) => {
            const s = status[pl];
            const on = active === pl;
            const d = p.drafts[pl];
            return (
              <div key={pl} role="presentation" className={cn("relative flex min-w-[200px] flex-1 snap-start flex-col rounded-3xl transition", on ? "glass shadow-[0_20px_60px_-30px_var(--halo)]" : "bg-secondary/40", !d.enabled && "opacity-80")} style={{ ["--halo" as string]: PLATFORM_HALO[pl] }}>
                {on && <motion.span layoutId="deck-tab" className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-foreground/25" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                <button
                  type="button"
                  id={`tab-${pl}`}
                  aria-pressed={on}
                  aria-controls={on ? `panel-${pl}` : undefined}
                  onClick={() => setActive(pl)}
                  className={cn("relative flex items-center gap-3 rounded-3xl p-3.5 pr-4 text-left transition", !on && "hover:bg-secondary/60")}
                >
                  <PlatformOrb platform={pl} size={40} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {PLATFORM_META[pl].name} <span className="font-normal text-muted-foreground">{PLATFORM_META[pl].format}</span>
                    </span>
                    <span className={cn("block truncate text-xs", s.tone === "done" ? "text-success" : s.tone === "warn" ? "text-warning" : "text-muted-foreground")}>{p.loading && d.enabled ? "Writing…" : s.label}</span>
                  </span>
                </button>
                <label htmlFor={`send-${pl}`} className="relative flex min-h-[44px] cursor-pointer items-center gap-2 rounded-b-3xl border-t border-border/60 px-3.5 text-xs font-semibold">
                  <input
                    id={`send-${pl}`}
                    type="checkbox"
                    checked={d.enabled}
                    onChange={(e) => p.onDraft(pl, { enabled: e.target.checked })}
                    className="h-5 w-5 shrink-0 cursor-pointer accent-lime focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  />
                  {d.enabled ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  <span className={d.enabled ? "text-foreground" : "text-muted-foreground"}>
                    {d.enabled ? "Sending" : "Skipping"} <span className="sr-only">{PLATFORM_META[pl].name}</span>
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
        {edge.l && (
          <button type="button" onClick={() => nudge(-1)} aria-label="Show earlier destinations" className="deck-arrow left-0 -translate-x-1/3">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {edge.r && (
          <button type="button" onClick={() => nudge(1)} aria-label="Show more destinations" className="deck-arrow right-0 translate-x-1/3">
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          role="region"
          id={`panel-${active}`}
          aria-labelledby={`tab-${active}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="glass relative overflow-hidden rounded-[32px] p-5 sm:p-7"
        >
          {/* Platform tint sits on its own layer: .glass owns the panel background. */}
          <span className={cn("pointer-events-none absolute inset-0", SURFACE[active])} aria-hidden="true" />
          <div className="relative">
            <PlatformStage {...p} platform={active} checks={status[active].checks} onReviewed={() => markReviewed(active)} />
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="sticky bottom-[calc(max(12px,env(safe-area-inset-bottom))+72px)] z-20 -mx-4 mt-6 lg:bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-4 pt-8 sm:flex-row sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {enabled.length === 0 ? "Pick at least one place to send it." : ready ? "All set. Nothing goes out until you hit send." : `${pending.length} to look over: ${pending.map((x) => PLATFORM_META[x].name).join(", ")}`}
        </p>
        <Button variant={ready ? "lime" : "subtle"} size="lg" disabled={!ready} onClick={p.onContinue}>
          On to launch <ArrowRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

function PlatformStage(p: Props & { platform: Platform; checks: ReturnType<typeof checksFor>; onReviewed: () => void }) {
  const pl = p.platform;
  const d = p.drafts[pl];
  const meta = PLATFORM_META[pl];
  const acct = p.accounts[pl];
  const connected = acct?.status === "connected";
  const id = useId();
  const blocked = blocking(p.checks);
  const set = (patch: Partial<Draft>) => p.onDraft(pl, patch);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!d.reviewed) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [d.reviewed]);

  const preview = { draft: d, src: p.media.src, poster: p.media.poster, handle: acct?.username ?? `your${pl}`, name: acct?.displayName ?? acct?.username ?? "You", avatar: acct?.avatar };
  const igLen = [d.caption, d.hashtags].filter(Boolean).join("\n\n").length;

  return (
    <div className="grid gap-8 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:items-start">
      <div className={cn("transition", !d.enabled && "opacity-40 grayscale")}>
        {p.loading ? (
          <div className={cn("skeleton mx-auto w-full max-w-[280px] rounded-[26px]", pl === "x" ? "aspect-[4/5]" : "aspect-[9/16]")} />
        ) : pl === "instagram" ? (
          <InstagramReel {...preview} />
        ) : pl === "youtube" ? (
          <YouTubeShort {...preview} />
        ) : (
          <XPost {...preview} />
        )}
      </div>

      <div className="min-w-0 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight">
              {meta.name} {meta.format}
            </h3>
            <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span className="min-w-0 truncate" title={acct ? acct.username : undefined}>{acct ? `as ${acct.username}` : "No account connected"}</span>
            </p>
          </div>
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-muted-foreground">
            <span>{d.enabled ? "Sending here" : "Skipping"}</span>
            <Switch.Root checked={d.enabled} onCheckedChange={(v) => set({ enabled: v })} aria-label={`Send to ${meta.name}`} className="relative h-7 w-12 shrink-0 rounded-full bg-secondary transition-colors hairline data-[state=checked]:bg-lime data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--lime)/0.5)]">
              <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-muted-foreground shadow transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-[hsl(var(--lime-foreground))]" />
            </Switch.Root>
          </label>
        </div>

        {d.note && d.enabled && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-accent/10 px-4 py-3 text-[14.5px]">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span>
              {pl === "youtube" ? "YouTube wants a stronger title. I wrote one that people actually search for." : pl === "x" ? "Let's make this impossible to ignore. Short, sharp, no hashtags." : pl === "instagram" ? "Instagram is ready. A hook up front, one ask, and tags that travel." : `${d.note.replace(/\.$/, "")}. Written to its rules.`}
              {d.why && <span className="mt-1 block text-[13px] text-muted-foreground">{d.why}</span>}
            </span>
          </div>
        )}

        {!connected && d.enabled && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warning/10 px-4 py-3">
            <span className="flex items-center gap-2 text-sm">
              <CircleAlert className="h-4 w-4 text-warning" aria-hidden="true" />
              {acct ? `${meta.name} needs you to reconnect.` : `Connect ${meta.name} to send it here.`}
            </span>
            <Button size="sm" variant="primary" onClick={() => p.onConnect(pl)}>
              <Link2 className="h-4 w-4" /> {acct ? "Reconnect" : "Connect account"}
            </Button>
          </div>
        )}

        <fieldset disabled={!d.enabled || p.loading} className="space-y-4 disabled:opacity-50">
          <legend className="sr-only">{meta.name} copy</legend>
          {pl === "youtube" && (
            <div>
              <Label htmlFor={`${id}-title`}>
                Title <Counter value={d.title.length} max={100} />
              </Label>
              <Input id={`${id}-title`} value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="What would someone search to find this?" />
            </div>
          )}
          {pl === "youtube" ? (
            <div>
              <Label htmlFor={`${id}-desc`}>
                Description <Counter value={d.description.length} max={5000} />
              </Label>
              <Textarea id={`${id}-desc`} rows={4} value={d.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          ) : (
            <div>
              <Label htmlFor={`${id}-cap`}>
                {pl === "x" ? "Post" : "Caption"} <Counter value={pl === "instagram" ? igLen : d.caption.length} max={meta.captionLimit} />
              </Label>
              <Textarea id={`${id}-cap`} rows={pl === "x" ? 4 : 6} value={d.caption} onChange={(e) => set({ caption: e.target.value })} placeholder={pl === "x" ? "Say it in one breath." : "Tell them why it matters."} />
            </div>
          )}
          {pl !== "x" && (
            <div>
              <Label htmlFor={`${id}-tags`}>Hashtags</Label>
              <Input id={`${id}-tags`} value={d.hashtags} onChange={(e) => set({ hashtags: e.target.value })} placeholder="#oneidea #anotherone" />
            </div>
          )}
          {supportsFirstComment(pl) && (
            <div>
              <Label htmlFor={`${id}-fc`}>
                {pl === "x" ? "First reply" : "First comment"} <Counter value={d.firstComment.length} max={FIRST_COMMENT_LIMIT[pl] ?? 2200} />
              </Label>
              <Textarea
                id={`${id}-fc`}
                rows={2}
                value={d.firstComment}
                onChange={(e) => set({ firstComment: e.target.value })}
                aria-describedby={`${id}-fc-hint`}
                placeholder={pl === "x" ? "A link, a source, or the next thought. Optional." : "Hashtags, a link, or a question. Optional."}
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p id={`${id}-fc-hint`} className="text-[12.5px] text-muted-foreground">
                  {pl === "x" ? "Posted as a reply to your post a few seconds after it goes live." : "Posted as your first comment a few seconds after it goes live."}
                </p>
                {pl !== "x" && d.hashtags.trim() && (
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    className="min-h-[44px]"
                    onClick={() => set({ firstComment: [d.firstComment.trim(), d.hashtags.trim()].filter(Boolean).join("\n\n"), hashtags: "" })}
                  >
                    Move hashtags here
                  </Button>
                )}
              </div>
            </div>
          )}
          <SnippetBar
            caption={pl === "youtube" ? d.description : d.caption}
            hashtags={d.hashtags}
            showTags={pl !== "x"}
            onCaption={(v) => set(pl === "youtube" ? { description: v } : { caption: v })}
            onTags={(v) => set({ hashtags: v })}
          />
        </fieldset>

        <ul className="space-y-1.5" aria-label="Checks">
          {p.checks.map((c) => (
            <li key={c.text} className={cn("flex items-center gap-2 text-[13.5px]", c.level === "error" ? "text-destructive" : c.level === "warning" ? "text-warning" : "text-success")}>
              {c.level === "ok" ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
              <span className="sr-only">{c.level === "ok" ? "Good: " : c.level === "warning" ? "Heads up: " : "Fix: "}</span>
              {c.text}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant={d.reviewed && !blocked ? "outline" : "primary"}
            onClick={() => (d.reviewed ? set({ reviewed: false }) : p.onReviewed())}
            disabled={!d.enabled || blocked || p.loading || !connected}
            aria-pressed={d.reviewed}
          >
            <motion.span animate={flash ? { scale: [1, 1.35, 1], rotate: [0, -12, 0] } : {}} className="inline-flex">
              <Check className="h-4 w-4" />
            </motion.span>
            {d.reviewed ? "Looks good" : "This looks good"}
          </Button>
          <Button variant="ghost" onClick={() => p.onRewrite(pl)} disabled={!d.enabled || p.rewriting === pl || p.loading}>
            <RefreshCw className={cn("h-4 w-4", p.rewriting === pl && "animate-spin")} /> Rewrite this one
          </Button>
        </div>
      </div>
    </div>
  );
}
