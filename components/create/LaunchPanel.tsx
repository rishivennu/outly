"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarClock, CalendarDays, Check, CircleCheck, Film, Flame, LayoutGrid, Link2, Loader2, Pencil, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { Pip } from "@/components/brand/Pip";
import { Sheet } from "@/components/shared/Sheet";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DateTimePicker } from "@/components/shared/DateTimePicker";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { fmt, tzShort } from "@/components/shell/UserContext";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { MIN_SAMPLES, type BestTimes } from "@/lib/schedule/best-time";
import type { AccountView, Draft, PostView } from "./types";
import { calendarHref } from "@/lib/client/post-words";
import { confirmRows, diffRows, enabledPlatforms, FIX_LABEL, readinessLine, scheduleProblem, type Fix } from "./publish";
import { MusicNote } from "./MusicNote";
import { CoverPicker } from "./CoverPicker";
import { OFFLINE_SEND } from "./ActionBar";
import { T } from "@/lib/motion/tokens";

interface Props {
  drafts: Record<Platform, Draft>;
  accounts: Partial<Record<Platform, AccountView>>;
  media: { duration?: number | null; width?: number | null; height?: number | null } | null;
  poster: string | null;
  hook: string;
  /** The draft's name, the same one Content lists it under. */
  title: string;
  /** Where the draft stands right now, e.g. "Draft saved 5:45 PM". */
  status: string;
  tz: string;
  when: Date;
  onWhen: (d: Date) => void;
  mode: "now" | "schedule";
  onMode: (m: "now" | "schedule") => void;
  busy: boolean;
  error: string | null;
  /** The one way back to Everywhere. */
  onEdit: () => void;
  /** Switches a held place off, so the rest can go. */
  onLeaveOut: (p: Platform) => void;
  /** R1206: connect or reconnect a held place's account, right from here. */
  onConnect: (p: Platform) => void;
  /** R1206: open that one platform on Everywhere, for a failing check, a waiting suggestion or a first look. */
  onFix: (p: Platform) => void;
  /** Back to step 1 to swap in a version of the video that has music on it. */
  onReplaceVideo: () => void;
  /** 1083: the post's own cover image, if any; it also stands in for the poster in the summary. */
  coverUrl: string | null;
  onCover: (url: string | null) => void;
  /** Saves the draft if needed and returns its id: a cover belongs to a saved post. */
  ensurePost: () => Promise<string | null>;
  /** The saved post, for the booking dry run while a time is picked. */
  postId: string | null;
  /** What stops this time from being booked, or null; the action bar reads it. */
  onScheduleIssue: (line: string | null) => void;
  /** Off while the device is offline: nothing can be sent or booked without a connection. */
  online?: boolean;
  /** Places with a Pip suggestion still waiting: held back until it is accepted or rejected. */
  proposed?: Platform[];
}

/** /api/best-time: slots only ever come from the creator's own posts; "none" says how many more are needed. */
export type BestAnswer = Omit<BestTimes, "source"> & { source: string; samples?: number; needed?: number };

/** GET /api/posts/[id]/check: the booking checks for a time, run before anything is booked. */
export interface ScheduleCheck {
  ok: boolean;
  issues?: { code: string; message: string; platform?: string }[];
  conflicts?: { postId: string; title: string; scheduledAt: string; platform: string }[];
}

export const SCHEDULE_CHECKING = "Checking that time.";

/** What stops this booking, in one line for the launch error, or null when nothing does. */
export function scheduleCheckLine(r: ScheduleCheck | null): string | null {
  if (!r || r.ok) return null;
  const lines = (r.issues ?? []).map((i) => {
    const where = i.platform ? PLATFORM_META[i.platform as Platform]?.name : null;
    return where && !i.message.startsWith(where) ? `${where}: ${i.message}` : i.message;
  });
  const near = [...new Set((r.conflicts ?? []).map((c) => c.title).filter(Boolean))];
  if (near.length) lines.push(`Booked close to it: ${near.slice(0, 3).join(", ")}${near.length > 3 ? ` and ${near.length - 3} more` : ""}.`);
  return lines.length ? lines.join(" ") : "That time doesn't work for this post. Pick another one.";
}

/** The line shown instead of best times while there is not enough of the creator's own data. */
export function bestTimesWaitLine(b: Pick<BestAnswer, "samples" | "needed">) {
  const needed = b.needed ?? MIN_SAMPLES;
  return typeof b.samples === "number" ? `Best times appear after ${needed} posts with views (${b.samples} so far).` : `Best times appear after ${needed} posts with views.`;
}

export const realSlots = (b: BestAnswer | null) => (b && b.source === "yours" ? b.slots : []);

export const MULTI_LINE = "One video, with each place's own words. Each place posts on its own, so one that fails never stops the others.";

const ease = "ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

/**
 * Step 4. The same shape as Everywhere: the summary and the choices on the left, cover and music on the right.
 * It has no send button of its own: the action bar below carries the one Publish or Schedule button.
 */
export function LaunchPanel(p: Props) {
  const [picking, setPicking] = useState(false);
  // Only the destinations the user left switched on. Nothing else is ever listed, and held ones are never sent.
  const targets = enabledPlatforms(p.drafts);
  const rows = confirmRows(p.drafts, p.accounts, p.media, p.proposed);
  const sending = rows.filter((r) => r.sending);
  const diffs = diffRows(p.drafts, rows.map((r) => r.platform));
  const [best, setBest] = useState<BestAnswer | null>(null);
  const slots = realSlots(best);
  const peaks = best?.source === "yours" ? best.peakHours : [];
  const online = p.online ?? true;
  const [check, setCheck] = useState<{ busy: boolean; line: string | null; ok: boolean }>({ busy: false, line: null, ok: false });
  // The device's own zone, read after mount (the server render has none): a phone abroad still books in the profile's zone.
  const [deviceTz, setDeviceTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDeviceTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDeviceTz(null);
    }
  }, []);
  const key = targets.join(",");
  useEffect(() => {
    let live = true;
    api<BestAnswer>(`/api/best-time?platforms=${key}`)
      .then((b) => live && setBest(b))
      .catch(() => live && setBest(null));
    return () => {
      live = false;
    };
  }, [key]);

  // A time is checked as it is picked: in the future first, then the server's dry run (clashes, platform limits).
  // A check that can't be reached says nothing: the launch route enforces the same rules when the post is booked.
  const at = p.when.getTime();
  const { onScheduleIssue } = p;
  useEffect(() => {
    if (p.mode !== "schedule") {
      setCheck({ busy: false, line: null, ok: false });
      onScheduleIssue(null);
      return;
    }
    const local = scheduleProblem(new Date(at));
    if (local || !p.postId || !online) {
      setCheck({ busy: false, line: local, ok: false });
      onScheduleIssue(local);
      return;
    }
    let live = true;
    setCheck((c) => ({ ...c, busy: true }));
    // Schedule post waits until the dry run has answered for this time.
    onScheduleIssue(SCHEDULE_CHECKING);
    const t = setTimeout(() => {
      api<ScheduleCheck>(`/api/posts/${p.postId}/check?at=${encodeURIComponent(new Date(at).toISOString())}`)
        .then((r) => {
          if (!live) return;
          const line = scheduleCheckLine(r);
          setCheck({ busy: false, line, ok: !line });
          onScheduleIssue(line);
        })
        .catch(() => {
          if (!live) return;
          setCheck({ busy: false, line: null, ok: false });
          onScheduleIssue(null);
        });
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [p.mode, at, p.postId, online, key, onScheduleIssue]);

  const thumb = p.coverUrl ?? p.poster;
  const lead = p.mode === "now" ? "Publishing to" : "Scheduling for";

  return (
    <div className="w-full">
      <p className="eyebrow mb-3">04 · Launch</p>
      <h2 className="display text-[clamp(2.2rem,5vw,3.6rem)]">
        Ready when <span className="energy-text">you are.</span>
      </h2>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-start">
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="launch-summary" className="glass flex gap-4 rounded-[28px] p-4">
            <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-2xl bg-secondary sm:w-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 id="launch-summary" className="line-clamp-2 text-base font-semibold leading-snug sm:text-lg">
                    {p.title}
                  </h3>
                  {p.hook && p.hook !== p.title && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.hook}</p>}
                </div>
                <Button variant="subtle" size="sm" onClick={p.onEdit} className="min-h-11 shrink-0" aria-label="Edit the post in Everywhere">
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                </Button>
              </div>
              {diffs.length > 0 ? (
                <ul className="mt-3 divide-y divide-border/60" aria-label="What each place gets">
                  {diffs.map((r) => {
                    const handle = rows.find((x) => x.platform === r.platform)?.handle;
                    return (
                      <li key={r.platform} className="flex min-w-0 items-start gap-2 py-2 text-sm first:pt-0 last:pb-0">
                        <PlatformOrb platform={r.platform} size={22} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="flex min-w-0 items-baseline gap-2">
                            <span className="shrink-0 font-medium">{PLATFORM_META[r.platform].name}</span>
                            <span className="min-w-0 truncate text-[13px] text-muted-foreground">{handle ?? "Not connected"}</span>
                          </p>
                          <p className="truncate text-[13px] text-foreground/90" title={r.firstLine || undefined}>
                            <span className="sr-only">First line: </span>
                            {r.firstLine || <span className="text-muted-foreground">No words yet</span>}
                          </p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {r.format} · {r.hashtags === 0 ? "No hashtags" : r.hashtags === 1 ? "1 hashtag" : `${r.hashtags} hashtags`}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="mt-3 space-y-1.5" aria-label="Where it's going">
                  {rows.map((r) => (
                    <li key={r.platform} className="flex min-w-0 items-center gap-2 text-sm">
                      <PlatformOrb platform={r.platform} size={22} />
                      <span className="shrink-0 font-medium">{PLATFORM_META[r.platform].name}</span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {[PLATFORM_META[r.platform].format, r.handle ?? "Not connected"].join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
                {p.status}
              </p>
            </div>
          </section>

          <div role="radiogroup" aria-label="When should this go live?" className="gseg grid grid-cols-2 gap-1.5 rounded-full bg-secondary/60 p-1.5 hairline">
            {(["now", "schedule"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={p.mode === m}
                disabled={p.busy}
                onClick={() => p.onMode(m)}
                className={cn("relative min-h-11 rounded-full px-2 text-sm font-semibold outline-none transition-[color] duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]", ease, p.mode === m ? "text-background" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
              >
                {p.mode === m && <motion.span layoutId="launch-mode" className="absolute inset-0 rounded-full bg-foreground" transition={T.nav} />}
                <span className="relative inline-flex items-center gap-2">
                  {m === "now" ? <Send className="h-4 w-4" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}
                  {m === "now" ? "Publish now" : "Schedule for later"}
                </span>
              </button>
            ))}
          </div>

          {p.mode === "schedule" && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={T.nav} aria-label="Pick a time" className="space-y-3">
              <button
                type="button"
                onClick={() => setPicking(true)}
                className={cn("glass flex min-h-11 w-full items-center gap-4 rounded-[24px] p-4 text-left outline-none transition-[background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-secondary/60", ease)}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-warning/15 text-warning-ink">
                  <CalendarDays className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Goes live</span>
                  <span className="block text-base font-semibold tabular-nums sm:text-lg">
                    {fmt(p.when, p.tz, { weekday: "long", month: "short", day: "numeric" })}, {fmt(p.when, p.tz, { hour: "numeric", minute: "2-digit" })}{" "}
                    <span className="text-sm font-normal text-muted-foreground">{tzShort(p.tz)}</span>
                  </span>
                </span>
                <span className="text-sm font-medium text-muted-foreground">Change</span>
              </button>

              {deviceTz && deviceTz !== p.tz && tzShort(deviceTz) !== tzShort(p.tz) && (
                <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                  Times are in {tzShort(p.tz)}, the time zone on your Outlly profile. This device is on {tzShort(deviceTz)}.
                </p>
              )}

              <p className={cn("flex items-start gap-2 px-1 text-[13px] leading-snug", check.line ? "text-[hsl(0_72%_42%)] dark:text-destructive" : "text-muted-foreground")} role="status" aria-live="polite">
                {check.busy ? (
                  <>
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Checking that time for {sending.length === 1 ? PLATFORM_META[sending[0].platform].name : "each place"}
                  </>
                ) : check.line ? (
                  <>
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {check.line}
                  </>
                ) : check.ok ? (
                  <>
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" aria-hidden="true" /> That time works for every place it&apos;s going.
                  </>
                ) : null}
              </p>

              {best && slots.length === 0 && (
                <p className="flex items-start gap-2 rounded-[20px] px-4 py-3 text-xs leading-relaxed text-muted-foreground hairline">
                  <Flame className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="tabular-nums">{bestTimesWaitLine(best)}</span>
                </p>
              )}

              {best && slots.length > 0 && (
                <section aria-labelledby="best-times" className="rounded-[24px] p-4 hairline">
                  <h3 id="best-times" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <Flame className="h-4 w-4 text-accent" aria-hidden="true" /> Best times to post
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">From your posts</span>
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {slots.map((s) => {
                      const on = Math.abs(new Date(s.at).getTime() - p.when.getTime()) < 60_000;
                      return (
                        <button key={s.at} type="button" aria-pressed={on} onClick={() => p.onWhen(new Date(s.at))} className={cn("h-11 rounded-full px-4 text-sm font-semibold tabular-nums outline-none transition-[background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] hairline", ease, on ? "bg-foreground text-background" : "[@media(hover:hover)]:hover:bg-secondary/70")}>
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{best.reason}</p>
                </section>
              )}
            </motion.section>
          )}

          <section aria-labelledby="launch-confirm" className="rounded-[24px] p-4 hairline sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="launch-confirm" className="text-sm font-semibold">
                {lead}:
              </h3>
              {rows.length > 0 && (
                <p className={cn("flex items-center gap-1.5 text-[13px] font-medium tabular-nums", sending.length === rows.length ? "text-success-ink" : "text-muted-foreground")} role="status" aria-live="polite">
                  {sending.length === rows.length && <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                  {readinessLine(rows)}
                </p>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing is switched on. Pick at least one place in Everywhere.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {rows.map((r) => (
                  <li key={r.platform} className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <PlatformOrb platform={r.platform} size={28} className={cn(!r.sending && "opacity-60")} />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-semibold">{PLATFORM_META[r.platform].name}</span>
                        {r.handle && <span className="min-w-0 truncate text-muted-foreground">{r.handle}</span>}
                        {r.practice && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">Practice account</span>}
                      </p>
                      {r.sending ? (
                        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                          <Check className="h-3.5 w-3.5 text-success-ink" aria-hidden="true" /> {p.mode === "now" ? "Goes out when you publish" : "Goes out at that time"}
                        </p>
                      ) : (
                        <p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-[hsl(0_72%_42%)] dark:text-destructive">
                          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Not sending. {r.reason}
                        </p>
                      )}
                      {r.warnings.map((w) => (
                        <p key={w} className="mt-0.5 flex items-start gap-1.5 text-[13px] text-warning-ink">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {w}
                        </p>
                      ))}
                    </div>
                    {!r.sending && (
                      <div className="flex w-full flex-wrap gap-1.5 pl-[40px] sm:w-auto sm:pl-0">
                        {r.fix && <FixButton fix={r.fix} name={PLATFORM_META[r.platform].name} disabled={p.busy || ((r.fix === "connect" || r.fix === "reconnect") && !online)} onClick={() => (r.fix === "connect" || r.fix === "reconnect" ? p.onConnect(r.platform) : r.fix === "video" ? p.onReplaceVideo() : p.onFix(r.platform))} />}
                        <Button variant="ghost" size="sm" className="min-h-11" onClick={() => p.onLeaveOut(r.platform)} disabled={p.busy}>
                          Leave it out <span className="sr-only">{PLATFORM_META[r.platform].name}</span>
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sending.length > 1 && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{MULTI_LINE}</p>}
            {!online && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{OFFLINE_SEND}</p>}
            {p.error && (
              <p role="alert" className="mt-3 text-sm text-[hsl(0_72%_42%)] dark:text-destructive">
                {p.error}
              </p>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
          <CoverPicker targets={targets} coverUrl={p.coverUrl} ensurePost={p.ensurePost} onChange={p.onCover} />
          <MusicNote platforms={targets} onReplace={p.onReplaceVideo} />
        </div>
      </div>

      <Sheet open={picking} onOpenChange={setPicking} title="When should this go live?" description={`Times are in ${tzShort(p.tz)}.${peaks.length ? " Dots mark your best times to post." : ""}`} side="center">
        <DateTimePicker value={p.when} onChange={p.onWhen} tz={p.tz} peakHours={peaks} />
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => setPicking(false)}>
          That works
        </Button>
      </Sheet>
    </div>
  );
}

/** R1206: the one action that clears a held place: connect where it isn't, a new video, or open it on Everywhere. */
function FixButton({ fix, name, disabled, onClick }: { fix: Fix; name: string; disabled: boolean; onClick: () => void }) {
  const link = fix === "connect" || fix === "reconnect";
  return (
    <Button variant="subtle" size="sm" className="min-h-11" onClick={onClick} disabled={disabled}>
      {link ? <Link2 className="h-4 w-4" aria-hidden="true" /> : fix === "video" ? <Film className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
      {FIX_LABEL[fix]} <span className="sr-only">{link ? name : fix === "video" ? `, too long for ${name}` : `for ${name}, in Everywhere`}</span>
    </Button>
  );
}

/**
 * P4: the booked screen after Schedule. It only says "on the calendar" when the server returned the post as
 * scheduled with a time. It shows the time in the creator's own time zone, where it is going, a link that opens
 * the calendar on that day with this post open, and the way back to Create for the next one.
 */
export function ScheduledView({ post, when, tz, poster, onAnother }: { post?: PostView | null; when: string; tz: string; poster: string | null; onAnother: () => void }) {
  // `when` alone is the pre-P4 call (the launch reply's time); pass `post` and only a confirmed booking counts.
  const at = post ? (post.status === "scheduled" ? post.scheduledAt : null) : when;
  const where = (post?.targets ?? []).map((t) => PLATFORM_META[t.platform].name);
  const whereText = where.length > 1 ? `${where.slice(0, -1).join(", ")} and ${where[where.length - 1]}` : (where[0] ?? "");
  if (!at)
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
        <Pip size={84} mood="sad" />
        <h2 className="display mt-6 text-[clamp(2rem,5vw,3rem)]">We couldn&apos;t confirm the booking.</h2>
        <p className="mt-4 text-lg text-muted-foreground">Nothing is booked until the calendar shows it. Open Content to see where this post stands.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild variant="primary" size="lg">
            <Link href="/content">
              <LayoutGrid className="h-5 w-5" aria-hidden="true" /> Open Content
            </Link>
          </Button>
          <Button variant="subtle" size="lg" onClick={onAnother}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Create another
          </Button>
        </div>
      </div>
    );
  const zone = tzShort(tz);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={T.card} className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
      <motion.div initial={{ rotate: -8, y: 20 }} animate={{ rotate: -4, y: 0 }} transition={T.card} className="glass-strong relative mb-10 w-52 rounded-[28px] p-3 shadow-[0_40px_80px_-30px_hsl(var(--warning)/0.4)]" aria-hidden="true">
        <div className="rounded-t-2xl bg-warning px-4 py-2 text-left text-sm font-bold uppercase tracking-wider text-[hsl(var(--lime-foreground))]">{fmt(at, tz, { month: "long" })}</div>
        <div className="flex items-center gap-3 p-4">
          <span className="display text-6xl tabular-nums">{fmt(at, tz, { day: "numeric" })}</span>
          <span className="text-left text-sm text-muted-foreground tabular-nums">
            {fmt(at, tz, { weekday: "long" })}
            <br />
            {fmt(at, tz, { hour: "numeric", minute: "2-digit" })} {zone}
          </span>
        </div>
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute -right-8 -top-6 aspect-[9/16] w-16 rotate-[10deg] rounded-xl object-cover shadow-xl hairline" />
        )}
      </motion.div>
      <Icon3D name="schedule" size={88} className="mb-6" />
      <h2 className="display text-[clamp(2.4rem,6vw,4rem)]">It&apos;s on the calendar.</h2>
      <StatusBadge status="scheduled" className="mt-4" />
      <p className="mt-4 text-lg text-muted-foreground">
        We&apos;ll send it{whereText ? ` to ${whereText}` : ""} on <span className="tabular-nums">{fmt(at, tz, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> {zone}. Change it any time before then.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="primary" size="lg">
          <Link href={post ? calendarHref(post.id, at, tz) : "/calendar"}>
            <CalendarDays className="h-5 w-5" aria-hidden="true" /> Open in Calendar
          </Link>
        </Button>
        <Button variant="subtle" size="lg" onClick={onAnother}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Create another
        </Button>
      </div>
    </motion.div>
  );
}
