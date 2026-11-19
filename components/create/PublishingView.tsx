"use client";
import { fmtHandle } from "@/lib/handle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firstCommentLine } from "@/lib/client/first-comment";
import { coverLine } from "@/lib/client/cover";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { deleteCopy, isFailedPost, platformReason } from "@/lib/client/failed-posts";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BarChart3, Bell, BellOff, Check, ChevronDown, ExternalLink, LayoutGrid, Link2, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutlyMark } from "@/components/brand/Logo";
import { Pip } from "@/components/brand/Pip";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useUser } from "@/components/shell/UserContext";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DotText } from "@/components/brand/DotText";
import { api, ApiError } from "@/lib/client/api";
import { PLATFORM_META, STOPPABLE, TARGET_COPY, type Platform, type TargetStatus } from "@/lib/domain";
import { targetErrorCopy } from "@/components/shared/errorCopy";
import { cn } from "@/lib/utils";
import {
  askNotify,
  fetchSending,
  LIVE_STEPS,
  liveLabel,
  liveStep,
  muteNotify,
  notifyOnce,
  notifyState,
  onSendingWake,
  pingSending,
  readTimes,
  realPercent,
  recordSendTime,
  sendSummary,
  stepText,
  typicalLabel,
  updatedLabel,
  type LivePost,
  type LiveTarget,
  type NotifyState,
} from "@/lib/client/sending";
import { DancingPip, MusicToggle, useGroove } from "./Groove";
import type { PostView, TargetView } from "./types";
import { T, ease } from "@/lib/motion/tokens";
import { liveSummary, platformFormatLabel, postWords, sendOutcome } from "@/lib/client/post-words";

/**
 * "Sending it out", styled as a Live Activity (10-16f: columns, side by side; a lone card sits in the middle).
 * Each destination is one dark slab: a dot-matrix route (YOU -> IG), a status box with the one action that matters,
 * and a glowing lime track with the Outlly rocket riding its tip. Stop while it's still moving, Send it again when
 * it stopped, See it once it's live. Text always carries the state; colour backs it up.
 * Pip dances to the groove up top while anything is still moving. This is the only screen that plays music.
 * 1135: photo, carousel and story posts say so (Your carousel, Carousel, Sending your carousel) and show their photos.
 * 1139: the track is honest. The fill is the steps a destination has really finished (Queued, Uploading,
 * Publishing, Published) and the readout names the step; a percentage only ever appears if the server really
 * measured one (realPercent). Each card also names the account it posts to, shows the thumbnail and the
 * caption going out, and says when the platform last told us something. /api/posts/sending supplies those
 * facts, and the screen wakes on a push landing on this device, on focus and when the tab comes back, so a
 * send watched on two devices says the same thing on both.
 */
const ACTIVE: TargetStatus[] = ["pending", "queued", "uploading", "processing"];
const ROW_COPY: Record<string, string> = {
  pending: "Waiting its turn.",
  queued: "Lined up, starting in a moment.",
  uploading: "Sending your video.",
  processing: "Getting it ready to go public.",
  published: "It's live. Go say hi in the comments.",
};
const CODE: Record<Platform, string> = { instagram: "IG", youtube: "YT", x: "X", tiktok: "TT", threads: "TH", facebook: "FB", linkedin: "IN" };
const POLL_MS = 1500;
/** The tracker's extra facts change slowly (an account, a thumbnail), so they are read less often than the post. */
const TRACKER_MS = 5000;

export function PublishingView({ initial, onAnother }: { initial: PostView; onAnother: () => void }) {
  const [post, setPost] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const active = post.targets.some((t) => ACTIVE.includes(t.status as TargetStatus));
  const stoppable = post.targets.filter((t) => STOPPABLE.includes(t.status as TargetStatus));
  const g = useGroove(active);
  /** A live post whose first comment is still on its way keeps a slow poll going, for five minutes at most. */
  // 1083: a cover still going on (YouTube, Facebook set it after live) counts the same way.
  const commentWait = post.targets.some((t) => (t.status === "published" && t.firstCommentState === "waiting") || coverLine(t, !!post.coverUrl)?.tone === "wait");
  const [commentGaveUp, setCommentGaveUp] = useState(false);
  useEffect(() => {
    if (!commentWait) return;
    const id = setTimeout(() => setCommentGaveUp(true), 300_000);
    return () => clearTimeout(id);
  }, [commentWait]);

  /** Signed out or the post is gone: no point asking again. */
  const [pollDead, setPollDead] = useState(false);
  /** Consecutive failed checks. Three in a row (while online) earns an honest note. */
  const [pollMiss, setPollMiss] = useState(0);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (document.hidden) return; // a background tab doesn't need second-by-second updates
    try {
      const r = await api<{ post: PostView }>(`/api/posts/${post.id}`);
      setPost(r.post);
      setPollMiss(0);
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) setPollDead(true);
      else setPollMiss((n) => n + 1);
      /* anything else is transient; next tick tries again */
    }
  }, [post.id]);

  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  // Fast while it's fresh, then easy on the server for a platform that takes its time.
  const slow = now - t0 > 120_000;

  const polling = active || (commentWait && !commentGaveUp);
  useEffect(() => {
    if (!polling || pollDead) return;
    const id = setInterval(refresh, active ? (slow ? 6000 : POLL_MS) : 5000);
    const onShow = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [polling, active, refresh, slow, pollDead]);

  useEffect(() => {
    if (!stoppable.length) setConfirmAll(false);
  }, [stoppable.length]);

  // A second at a time while it moves (the clock), a slower beat afterwards so "Updated 2 min ago" stays true.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [active]);
  const elapsed = Math.max(0, Math.floor((now - t0) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  /**
   * The tracker's facts for this post, from /api/posts/sending: which account each destination goes to, the
   * caption going out, the thumbnail, and when the platform last told us something. Read on load, whenever a
   * status really changes, and on a wake (a push on this device, focus, the tab coming back). Never guessed:
   * if the request fails the card simply shows what the post itself carries.
   */
  const [live, setLive] = useState<LivePost | null>(null);
  const loadLive = useCallback(async () => {
    if (document.hidden) return;
    try {
      const posts = await fetchSending(post.id);
      setLive(posts[0] ?? null);
    } catch {
      /* keep whatever we already have */
    }
  }, [post.id]);
  const statusKey = post.targets.map((t) => `${t.status}:${t.errorCode ?? ""}`).join("|");
  useEffect(() => {
    void loadLive();
  }, [loadLive, statusKey]);
  useEffect(
    () =>
      onSendingWake(() => {
        void refresh();
        void loadLive();
      }),
    [refresh, loadLive],
  );
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(loadLive, TRACKER_MS);
    return () => clearInterval(id);
  }, [polling, loadLive]);
  const trackerOf = (t: TargetView): LiveTarget | null => live?.targets.find((x) => x.id === t.id) ?? null;

  // Real send times (10-16g): only targets we watched from the start (pending/queued) count, timed
  // from when this screen first saw them to when they went live. Feeds "usually about N min".
  const firstSeen = useRef<Record<string, { s: string; at: number; done?: boolean }>>({});
  const [times, setTimes] = useState<Record<string, number[]>>({});
  useEffect(() => setTimes(readTimes()), []);
  useEffect(() => {
    let changed = false;
    for (const t of post.targets) {
      const f = firstSeen.current[t.id];
      if (!f) firstSeen.current[t.id] = { s: t.status, at: Date.now() };
      else if (!f.done && t.status === "published" && (f.s === "pending" || f.s === "queued") && !t.practice) {
        f.done = true;
        recordSendTime(t.platform, (Date.now() - f.at) / 1000);
        changed = true;
      }
    }
    if (changed) setTimes(readTimes());
  }, [post.targets]);

  // Wake the studio's sending pill, and the opt-in browser notification for when this settles.
  useEffect(() => {
    if (active) pingSending();
  }, [active]);
  const [notify, setNotify] = useState<NotifyState>("unsupported");
  useEffect(() => setNotify(notifyState()), []);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && document.hidden) {
      const s = sendSummary(post.targets);
      notifyOnce(post.id, s.tone === "live" ? "You're live" : "Needs a hand", `"${post.title || post.media.filename || "Your post"}": ${s.text}.`, `/create?post=${post.id}`);
    }
    wasActive.current = active;
  }, [active, post]);
  const toggleNotify = async () => {
    if (notify === "on") {
      muteNotify();
      setNotify("off");
    } else setNotify(await askNotify());
  };

  const published = post.targets.filter((t) => t.status === "published");
  const realLive = published.filter((t) => !t.practice);
  const rehearsed = published.filter((t) => t.practice);
  const failed = post.targets.filter((t) => t.status === "failed");
  const stopped = failed.filter((t) => t.errorCode === "CANCELED");
  // P4: the headline is only ever what the server confirmed, and a practice account never counts as live.
  const out = sendOutcome(post.targets, active);
  const allLive = out.allLive;
  const allStopped = !active && post.targets.length > 0 && stopped.length === post.targets.length;
  const names = (ts: TargetView[]) => ts.map((t) => PLATFORM_META[t.platform].name).join(" and ");
  const headline = active ? "Sending it out" : out.allPractice ? "Practice run done." : out.allDone ? "You're live!" : allStopped ? "Stopped. Nothing went out." : realLive.length ? "Almost everywhere." : "Something got in the way.";
  // 1212: the quiet line above the actions: what finished, in plain words. The status pill beside it carries the count.
  const stage = active ? "Publishing" : out.allPractice ? "Practice run complete" : out.allDone ? "Publishing complete" : allStopped ? "Publishing stopped" : realLive.length ? "Publishing partly done" : "Publishing didn't finish";
  const sub = active
    ? "Each platform moves at its own pace. You can leave this page; we'll keep going."
    : out.allPractice
      ? `${names(rehearsed)} ${rehearsed.length === 1 ? "is a practice account" : "are practice accounts"}, so nothing was posted for real.`
      : out.allDone
      ? rehearsed.length
        ? `Out on ${names(realLive)}. ${names(rehearsed)} was a practice run, so nothing was posted there.`
        : post.format === "story"
          ? `Your story is up on ${names(realLive)} for the next 24 hours.`
          : "Your content is now published. Go say hi in the comments."
      : allStopped
        ? "You stopped every upload. Send any of them again whenever you're ready."
        : published.length
          ? `${failed.length === 1 ? "One place needs" : "A couple of places need"} a hand. Everything else is live.`
          : "Nothing went out yet. Each card says what happened and how to fix it.";
  const summary = `${out.allDone || active ? `${realLive.length} of ${post.targets.length} live` : `${realLive.length} live, ${failed.length} to fix`}${rehearsed.length ? `, ${rehearsed.length} practice` : ""}`;

  const act = async (key: string, path: string) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await api<{ post: PostView }>(path, { method: "POST" });
      setPost(r.post);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something got in the way.");
      void refresh();
    } finally {
      setBusy(null);
    }
  };
  // Retry publishes, so an editor seat cannot do it (the route refuses them). Hide the button and say who can.
  const canRetry = useUser().workspace?.role !== "editor";
  const retry = (t: TargetView) => act(t.id, `/api/targets/${t.id}/retry`);
  const stop = (t: TargetView) => act(t.id, `/api/targets/${t.id}/cancel`);
  // A post that failed (fully or in places) can be cleared out of Outlly from right here.
  const removePost = async () => {
    setBusy("delete");
    try {
      await api(`/api/posts/${post.id}`, { method: "DELETE" });
      setConfirmDel(false);
      toast("Deleted from Outlly.", "info");
      router.push("/content");
    } catch (e) {
      setConfirmDel(false);
      setErr(e instanceof ApiError ? e.message : "Couldn't delete it. Try again in a moment.");
      setBusy(null);
    }
  };
  const delCopy = deleteCopy([post]);
  const stopAll = async () => {
    setConfirmAll(false);
    await act("all", `/api/posts/${post.id}/cancel`);
  };

  // 1212: the actions sit top right once the send has finished (and nowhere else on the page).
  const actions = !active && (
    <div className="flex flex-wrap gap-2 [&>*]:flex-1 sm:shrink-0 sm:justify-end sm:[&>*]:flex-none" data-testid="pub-actions">
      <Button asChild variant="primary" size="md">
        <Link href="/content">
          <LayoutGrid className="h-4 w-4" aria-hidden="true" /> See your content
        </Link>
      </Button>
      <Button variant="subtle" size="md" onClick={onAnother}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Create another
      </Button>
      {isFailedPost(post) && (
        <Button variant="danger" size="md" onClick={() => setConfirmDel(true)} disabled={busy === "delete"}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete this post
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      {!active && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <p className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{stage}</p>
            <p className="pub-eyebrow inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold uppercase tracking-[0.12em]">
              {out.allDone || out.allPractice ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />}
              {summary}
            </p>
          </div>
          {actions}
        </div>
      )}
      {/* R1218: once the send has settled the four blocks sit in one bento grid (two balanced columns from lg, one
          column under it): You're live and What happened on the left, the preview and the existing Live Activity
          on the right. Source order is unchanged (grid placement does the arranging), cards share one radius,
          padding and gap, and rows start at the top so a taller Live Activity never stretches its neighbour. */}
      <div className={cn(!active && "mt-6 grid items-start gap-4 lg:grid-cols-2 lg:gap-5")} data-testid="pub-bento">
      {/* R1221: each side is its own column (preview and Live Activity stack with no gap under a shorter You're live), the
          wrappers are `contents` below lg so the four cards order themselves in one column, and nothing is stretched. */}
      <div className={cn("contents", !active && "lg:flex lg:min-w-0 lg:flex-col lg:gap-5")} data-testid="pub-col-left">
      <header className={cn("relative text-center", !active && "order-1 rounded-[24px] bg-card px-5 py-6 hairline sm:px-8 lg:order-none")} data-testid="pub-header">
        <p className="sr-only" role="status" aria-live="polite">{`${headline}. ${summary}.`}</p>
        {pollMiss >= 3 && polling && online && (
          <p role="status" className="mx-auto mb-4 max-w-md rounded-2xl px-4 py-2.5 text-[13px] leading-snug text-muted-foreground glass hairline">
            We can&apos;t reach Outlly right now to check on this. The send keeps going on our side, and this page catches up once we&apos;re back.
          </p>
        )}
        {pollDead && active && (
          <p role="status" className="mx-auto mb-4 max-w-md rounded-2xl px-4 py-2.5 text-[13px] leading-snug text-muted-foreground glass hairline">
            This page can&apos;t check on the send any more. Open <Link href="/content" className="font-semibold text-foreground underline underline-offset-4">Content</Link> to see where it stands.
          </p>
        )}
        <div className={cn("flex items-end justify-center", active ? "mb-3 h-[104px]" : "mb-2 h-[76px]")}>
          {active ? <DancingPip size={92} /> : <Pip size={68} mood={out.allDone ? "happy" : "sad"} />}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {active && (
            <p className="pub-eyebrow inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em]">
              <span className={cn("pub-pulse", reduce && "pub-pulse-still")} aria-hidden="true" />
              {summary}
              <span className="font-mono tabular-nums normal-case tracking-normal text-muted-foreground" aria-hidden="true">{clock}</span>
            </p>
          )}
          {active && <MusicToggle g={g} />}
          {active && (notify === "off" || notify === "on") && (
            <button type="button" onClick={toggleNotify} aria-pressed={notify === "on"} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-xs font-semibold hairline hover:bg-secondary">
              {notify === "on" ? <Bell className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> : <BellOff className="h-3.5 w-3.5" aria-hidden="true" />}
              {notify === "on" ? "We'll tell you when it's done" : "Tell me when it's done"}
            </button>
          )}
          {stoppable.length > 1 &&
            (confirmAll ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-card p-1 pl-3 text-xs font-semibold hairline" role="group" aria-label="Stop every upload?">
                Stop {stoppable.length} uploads?
                <button type="button" onClick={stopAll} disabled={busy === "all"} className="lv-stop-yes inline-flex h-11 items-center rounded-full px-4">
                  Stop all {stoppable.length}
                </button>
                <button type="button" onClick={() => setConfirmAll(false)} className="inline-flex h-11 items-center rounded-full px-3 hover:bg-secondary">
                  Keep going
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmAll(true)} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-card px-4 text-xs font-semibold hairline hover:bg-secondary">
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> Stop all uploads
              </button>
            ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.h1 key={headline} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className={cn(active ? "display mt-4 text-[clamp(2.2rem,6vw,3.6rem)]" : "mt-1 text-[clamp(1.75rem,3vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.03em]", allLive && "energy-text")}>
            {headline}
            {active && <span className={cn("pub-dots", reduce && "pub-dots-still")} aria-hidden="true"><i /><i /><i /></span>}
          </motion.h1>
        </AnimatePresence>
        {!active && !out.allPractice && post.targets.length > 0 && (
          <p className="mt-2 text-sm font-semibold tabular-nums text-[#173A24] dark:text-[hsl(var(--lime))]">
            {rehearsed.length ? `${realLive.length} live, ${rehearsed.length} practice` : realLive.length === post.targets.length ? `${realLive.length === 1 ? "1 publication" : `${realLive.length} publications`} live` : `${realLive.length} of ${post.targets.length} live`}
          </p>
        )}
        <p className={cn("mx-auto max-w-md text-muted-foreground", active ? "mt-3" : "mt-2 text-[15px] leading-snug")}>{sub}</p>
        {allLive && !reduce && <Burst />}
      </header>
      {!active && <WhatHappened post={post} className="order-3 lg:order-none" />}
      </div>

      <div className={cn("contents", !active && "lg:flex lg:min-w-0 lg:flex-col lg:gap-5")} data-testid="pub-col-right">
      {!active && <PublishedPreview post={post} trackerOf={trackerOf} className="order-2 lg:order-none" />}

      {/* The existing Live Activity cards, untouched inside; only their outer list fits the column (one card a row, full width). */}
      <section aria-label={active ? undefined : "Live activity"} className={cn(!active && "order-4 min-w-0 lg:order-none")} data-testid="pub-live">
        {!active && <p className="pub-label mb-3">Live activity</p>}
        <ul aria-label={postWords(post.format).where} className={cn(active ? "mx-auto mt-10 flex max-w-[56rem] flex-wrap justify-center gap-5" : "flex flex-col gap-4 [&>li]:!w-full")}>
          {post.targets.map((t, i) => (
            <LiveActivity key={t.id} t={t} i={i} lt={trackerOf(t)} now={now} usually={typicalLabel(times[t.platform])} post={post} busy={busy === t.id || busy === "all"} onRetry={() => retry(t)} onStop={() => stop(t)} canRetry={canRetry} reduce={!!reduce} />
          ))}
        </ul>
      </section>
      </div>

      {err && (
        <p role="alert" className={cn("text-center text-sm text-destructive", active ? "mt-4" : "order-5 lg:col-span-2")}>
          {err}
        </p>
      )}
      </div>

      {active && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 flex flex-wrap justify-center gap-3">
          <Button variant="ghost" size="lg" onClick={onAnother}>
            <Plus className="h-5 w-5" /> Start the next one while this sends
          </Button>
        </motion.div>
      )}
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={(o) => busy !== "delete" && setConfirmDel(o)}
        title={delCopy.title}
        body={delCopy.body}
        confirmLabel={busy === "delete" ? "Deleting…" : delCopy.confirm}
        busy={busy === "delete"}
        onConfirm={removePost}
      />
    </div>
  );
}

/** The first line of whatever copy is going out, for the card's one-line reminder of what this is. */
const firstLine = (s?: string | null) => (s ?? "").split("\n").find((x) => x.trim())?.trim() ?? null;

/** "Today, 4:12 PM" or "18 Nov, 4:12 PM": when the platform confirmed it. Null when there is no confirmed time. */
export function whenLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

/**
 * 1212: what went out, one card per destination: the real thumbnail, the title or first caption line, the platform,
 * the account it posted to, the technical status, when the platform confirmed it, and a link only when the platform
 * sent one back. Retry and stop stay on the Live Activity cards below, so nothing is wired twice.
 */
function PublishedPreview({ post, trackerOf, className }: { post: PostView; trackerOf: (t: TargetView) => LiveTarget | null; className?: string }) {
  const words = postWords(post.format, post.items.length);
  const thumb = post.media.thumbnailUrl ?? post.items[0]?.thumbnailUrl ?? null;
  if (post.targets.length === 0) return null;
  return (
    <section aria-labelledby="pub-preview-title" className={cn("min-w-0 rounded-[24px] bg-card p-4 hairline sm:p-5", className)} data-testid="published-preview">
      <h2 id="pub-preview-title" className="pub-label">
        {words.your}, where it went
      </h2>
      {/* R1218: one row per platform, every row the same shape: thumb, words, badge. A long caption truncates in its
          own column, so the badge never moves and the card never grows sideways. */}
      <ul className="mt-3 flex flex-col gap-2">
        {post.targets.map((t) => {
          const meta = PLATFORM_META[t.platform];
          const acct = trackerOf(t)?.account ?? null;
          const handle = acct ? fmtHandle(acct.username) || acct.name : null;
          const line = firstLine(t.title || t.caption) || post.title || post.media.filename || words.your;
          const when = t.status === "published" ? whenLabel(t.publishedAt) : null;
          const live = t.status === "published" && !t.practice;
          return (
            <li key={t.id} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-3 rounded-[16px] bg-secondary/50 p-3 hairline" data-testid="preview-card" data-status={t.status}>
              <div className="relative h-[86px] w-[64px] shrink-0 overflow-hidden rounded-xl bg-secondary">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <OutlyMark size={20} className="absolute inset-0 m-auto text-muted-foreground" />
                )}
                <PlatformOrb platform={t.platform} size={22} className="absolute bottom-1 right-1 shadow-sm" />
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-[15px] font-semibold leading-snug" title={line}>{line}</p>
                <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {meta.name}
                  {handle ? <> <span aria-hidden="true">·</span> {handle}</> : null}
                  {t.practice && t.status === "published" ? <> <span aria-hidden="true">·</span> practice run</> : null}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {when && <span className="tabular-nums">{when}</span>}
                  {live && t.url && (
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap font-semibold text-foreground underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:underline">
                      Open on {meta.name} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </p>
              </div>
              <StatusBadge status={t.status} className="shrink-0 self-start" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LiveActivity({ t, i, lt, now, usually, post, busy, onRetry, onStop, canRetry, reduce }: { t: TargetView; i: number; lt: LiveTarget | null; now: number; usually: string | null; post: PostView; busy: boolean; onRetry: () => void; onStop: () => void; canRetry: boolean; reduce: boolean }) {
  const meta = PLATFORM_META[t.platform];
  const canceled = t.status === "failed" && t.errorCode === "CANCELED";
  const h = t.status === "failed" && !canceled ? targetErrorCopy(t.platform, t.errorCode) : null;
  // 1139: the step this destination has really reached, and a percentage only if the server measured one.
  const step = liveStep(t, post.status);
  const pct = realPercent(lt?.progress);
  const acct = lt?.account ?? null;
  const caption = lt?.caption ?? firstLine(t.title || t.caption);
  const seen = updatedLabel(lt?.updatedAt, now);
  const isActive = ACTIVE.includes(t.status as TargetStatus);
  /** The bar is the steps really finished, or the measured upload figure on the step that has one. */
  const fill = pct !== null && step.state === "uploading" ? Math.round(((step.index + pct / 100) / step.total) * 100) : Math.round(step.fraction * 100);
  const canStop = STOPPABLE.includes(t.status as TargetStatus);
  const practice = t.status === "published" && !!t.practice;
  const live = t.status === "published" && !practice;
  const bad = t.status === "failed";
  const reason = bad && !canceled ? platformReason(t.errorDetail) : null;
  const fc = firstCommentLine(t);
  const cv = coverLine(t, !!post.coverUrl);
  const returnTo = encodeURIComponent(`/create?post=${post.id}`);
  const words = postWords(post.format, post.items.length);
  const slideish = words.format !== "video";
  const name = post.title || (slideish && words.count) || post.media.filename || "Untitled";
  const kindLabel = platformFormatLabel(meta.format, post.format);
  // A video post shows its frame here; slide posts already fan their own photos above.
  const thumb = slideish ? null : post.media.thumbnailUrl;
  const title = canceled ? "Stopped" : practice ? "Practice run" : liveLabel(t, post.status);
  const statusLine = practice
    ? `A practice account. Nothing was posted on ${meta.name}.`
    : canceled
    ? `You stopped this one before it reached ${meta.name}.`
    : h
      ? h.title
      : t.status === "uploading"
        ? words.sending
        : live && words.format === "story"
          ? "It's up. Stories stay for 24 hours."
          : (ROW_COPY[t.status] ?? TARGET_COPY[t.status as TargetStatus] ?? t.status);
  const accent = practice
    ? "Not posted for real"
    : live
    ? "Live now"
    : canceled
      ? "Send it again anytime"
      : bad
        ? h?.kind === "reconnect"
          ? "Reconnect to finish"
          : "Tap retry to finish"
        : step.state === "publishing"
          ? `${stepText(step)}, can't stop now`
          : `${stepText(step)}${t.attempts > 1 ? `, try ${t.attempts}` : usually ? `, usually ${usually}` : ""}`;

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...T.card, delay: reduce ? 0 : i * 0.08 }}
      className={cn(
        "la-card la-col relative flex w-full flex-col overflow-hidden rounded-[2rem] p-5 text-white sm:w-[calc(50%-0.625rem)]",
        live && "la-live",
        bad && !canceled && "la-bad",
      )}
    >
      <span className="la-grid" aria-hidden="true" />
      <div className="relative flex items-center gap-3" aria-hidden="true">
        <DotText text="YOU" />
        <ArrowRight className="la-arrow h-6 w-6 shrink-0" strokeWidth={3} />
        <DotText text={CODE[t.platform] ?? "GO"} />
        {slideish && <SlideStack items={post.items} moving={isActive && !reduce} landed={live} />}
      </div>
      <div className="relative mt-3 grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{words.your}</p>
          <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-white/60" title={name}>
            {name}
          </p>
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold leading-tight">{meta.name}</h2>
          <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.08em] text-white/60">{kindLabel}</p>
        </div>
      </div>

      {/* 1139: who it posts as, what it looks like and the first line going out. All read from the post itself. */}
      <div className="relative mt-3 flex items-center gap-2.5">
        {thumb && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" className="la-thumb shrink-0" draggable={false} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            {acct?.avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={acct.avatar} alt="" className="la-face" draggable={false} />
            ) : (
              <PlatformOrb platform={t.platform} size={18} />
            )}
            <span className="truncate text-[13px] font-semibold">{acct ? (fmtHandle(acct.username) || acct.name) : `Your ${meta.name} account`}</span>
          </span>
          {caption && <span className="mt-1 block truncate text-xs leading-snug text-white/60">{caption}</span>}
        </span>
      </div>

      <div className="la-box relative mt-4 flex min-h-[7.75rem] flex-col justify-center rounded-[1.25rem] p-4 pr-16">
        <p className="text-lg font-semibold leading-tight">{title}</p>
        <p className="mt-1 text-sm leading-snug text-white/65">{statusLine}</p>
        {reason && reason !== statusLine && <p className="mt-1 break-words text-[13px] leading-snug text-white/80">Reason: {reason}</p>}
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-xs font-bold uppercase tracking-[0.1em]", bad && !canceled ? "text-[#ff8a80]" : "text-[hsl(var(--lime))]")}>{accent}</span>
          {seen && <span className="text-xs font-semibold text-white/45">{seen}</span>}
        </p>
        {fc && !canceled && (
          <p className={cn("mt-2 text-[13px] leading-snug", fc.tone === "bad" ? "text-[#ff8a80]" : fc.tone === "ok" ? "text-white/85" : "text-white/65")} aria-live="polite">
            {fc.text}
          </p>
        )}
        {cv && !canceled && (
          <p className={cn("mt-1 text-[13px] leading-snug", cv.tone === "bad" ? "text-[#ff8a80]" : cv.tone === "ok" ? "text-white/85" : "text-white/65")} aria-live="polite">
            {cv.text}
          </p>
        )}
        <span className="absolute right-3 top-3">
          {bad && h?.kind !== "reconnect" && canRetry ? (
            <button type="button" onClick={onRetry} disabled={busy} className="la-round" aria-label={`${canceled ? "Send it again" : (h?.action ?? "Try again")} on ${meta.name}`}>
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden="true" />
            </button>
          ) : (
            <span className="grid h-11 w-11 place-items-center" aria-hidden="true">
              <PlatformOrb platform={t.platform} size={32} className={cn(t.status === "pending" && "opacity-60")} />
            </span>
          )}
        </span>
      </div>

      {/* 1139: the track shows the steps this destination has really finished. The readout names the step; it
          only ever shows a percentage when the server measured one. The rocket rides the end of the fill. */}
      <div
        className={cn("la-track relative mt-4 h-14 rounded-full", canceled && "la-off")}
        role="progressbar"
        aria-label={`${meta.name} progress`}
        aria-valuemin={0}
        aria-valuemax={step.total}
        aria-valuenow={step.index}
        aria-valuetext={`${meta.name}: ${canceled ? "stopped by you" : step.stalled ? "stopped, needs a hand" : pct === null ? stepText(step) : `${pct} percent uploaded, ${stepText(step)}`}`}
      >
        <div className={cn("la-fill absolute inset-0 rounded-full", isActive && !reduce && "la-fill-anim")} style={{ ["--p" as string]: `max(3.5rem, ${fill}%)` }}>
          {t.status === "published" && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-[hsl(var(--lime-foreground))]">{practice ? "Practice" : "Landed"}</span>}
        </div>
        <span className="la-rider" style={{ ["--p" as string]: `max(3.5rem, ${fill}%)` }} aria-hidden="true">
          <span className="absolute right-1.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center">
            <OutlyMark variant="ink" size={26} className={cn("la-rocket", isActive && !reduce && "la-rocket-anim")} />
          </span>
        </span>
        {t.status !== "published" && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold tabular-nums text-white/60">
            {bad ? "STOPPED" : pct === null ? `STEP ${step.stepNumber}/${step.total}` : `${pct}%`}
          </span>
        )}
      </div>

      <ol className="la-steps relative mt-2.5" aria-hidden="true">
        {LIVE_STEPS.map((label, n) => (
          <li key={label} className={cn("la-step", step.stalled ? (n === 0 ? "la-step-bad" : "") : n < step.index ? "la-step-done" : n === step.index ? "la-step-now" : "")}>
            <span className={cn("la-step-bar", isActive && n === step.index && !reduce && "la-step-beat")} />
            <span className="la-step-name">{label}</span>
          </li>
        ))}
      </ol>

      {(canStop || live || h?.kind === "reconnect" || (bad && !canceled)) && (
        <div className="relative mt-4 space-y-1">
          {live &&
            (t.url ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="la-pill">
                See it on {meta.name} <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <p className="text-xs leading-snug text-white/65">{meta.name} didn&apos;t send us a link to it. It&apos;s on your {meta.name} profile.</p>
            ))}
          {canStop && (
            <button type="button" onClick={onStop} disabled={busy} className="la-pill la-pill-ghost">
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> {busy ? "Stopping" : "Stop this upload"}
              <span className="sr-only">to {meta.name}</span>
            </button>
          )}
          {h?.kind === "reconnect" && (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/accounts/${t.platform}/connect?returnTo=${returnTo}`} className="la-pill">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {h.action}
              </a>
              {canRetry && (
                <button type="button" onClick={onRetry} disabled={busy} className="la-pill la-pill-ghost">
                  Already did? Try again
                </button>
              )}
            </div>
          )}
          {bad && !canRetry && (
            <p role="note" className="text-xs leading-snug text-white/65">
              Editors can&apos;t send posts. The workspace owner or a manager can try this one again.
            </p>
          )}
          {bad && !canceled && (
            <details className="group text-xs text-white/65">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-medium hover:text-white">
                Technical details <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <dl className="space-y-1 rounded-xl bg-white/5 p-3 font-mono text-xs leading-relaxed">
                <div>
                  <dt className="inline text-white/75">code: </dt>
                  <dd className="inline">{t.errorCode ?? "UNKNOWN"}</dd>
                </div>
                {t.errorDetail && (
                  <div>
                    <dt className="inline text-white/75">detail: </dt>
                    <dd className="inline break-words">{t.errorDetail}</dd>
                  </div>
                )}
                <div>
                  <dt className="inline text-white/75">attempts: </dt>
                  <dd className="inline">{t.attempts}</dd>
                </div>
              </dl>
            </details>
          )}
        </div>
      )}
    </motion.li>
  );
}

/**
 * What happened (10-16g): once a send settles, one card that sums it up. Where it's live with a link
 * to each post, what didn't go and why in a few words. Numbers live in Analytics, which reads them
 * from each platform; we don't keep per-post numbers here, so we link there rather than guess.
 */
function WhatHappened({ post, className }: { post: PostView; className?: string }) {
  const rows = post.targets.map((t) => {
    const meta = PLATFORM_META[t.platform];
    const canceled = t.status === "failed" && t.errorCode === "CANCELED";
    const result = t.status === "published" ? (t.practice ? "Practice run, not posted" : "Live") : canceled ? "Stopped by you" : t.status === "failed" ? "Needs a hand" : "Not sent";
    const why = t.status === "failed" && !canceled ? targetErrorCopy(t.platform, t.errorCode).title : null;
    return { t, meta, result, why };
  });
  const live = rows.filter((r) => r.t.status === "published" && !r.t.practice);
  return (
    // R1218: the same card as the other three (one radius, padding, hairline), the page's own type, and the
    // shared Button for its two actions, so it reads as part of the grid rather than a second Live Activity card.
    <section aria-labelledby="what-happened" className={cn("min-w-0 rounded-[24px] bg-card p-4 hairline sm:p-5", className)} data-testid="what-happened">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="pub-label">What happened</p>
          <h2 id="what-happened" className="mt-1 text-[17px] font-semibold leading-tight tracking-[-0.01em]">
            {liveSummary(live.length, rows.length, rows[0]?.meta.name)}
          </h2>
        </div>
        {live.length > 0 && (
          <Button asChild variant="subtle" size="sm">
            <Link href="/analytics">
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> See how it's doing
            </Link>
          </Button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-border/70">
        {rows.map(({ t, meta, result, why }) => (
          <li key={t.id} className="grid min-h-[56px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
            <PlatformOrb platform={t.platform} size={28} />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight">
                {meta.name} <span className="text-xs font-medium text-muted-foreground">{platformFormatLabel(meta.format, post.format)}</span>
              </p>
              <p className={cn("mt-0.5 text-sm leading-snug", t.status === "published" && !t.practice ? "font-semibold text-[#173A24] dark:text-[hsl(var(--lime))]" : t.status === "failed" && t.errorCode !== "CANCELED" ? "text-destructive" : "text-muted-foreground")}>
                {result}
                {why && <span className="font-normal text-muted-foreground">. {why}</span>}
              </p>
              {t.status === "published" && firstCommentLine(t) && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{firstCommentLine(t)!.text}</p>}
              {coverLine(t, !!post.coverUrl) && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{coverLine(t, !!post.coverUrl)!.text}</p>}
            </div>
            {t.status === "published" && !t.practice && t.url ? (
              <Button asChild variant="subtle" size="icon" aria-label={`Open the post on ${meta.name} (opens in a new tab)`}>
                <a href={t.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
            ) : (
              <span aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 1135: a photo post shows its own photos on the route, not the video look. Up to three slides fanned like
 * prints; while sending they drift toward the platform, once live they settle. Decorative (the text says it all).
 */
function SlideStack({ items, moving, landed }: { items: PostView["items"]; moving: boolean; landed: boolean }) {
  const shown = items.filter((m) => m.thumbnailUrl).slice(0, 3);
  if (!shown.length) return null;
  return (
    <span className={cn("la-stack ml-auto", moving && "la-stack-anim", landed && "la-stack-landed")} aria-hidden="true">
      {shown.map((m, i) => (
        <span key={m.id} className="la-print" style={{ ["--i" as string]: i, ["--n" as string]: shown.length }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.thumbnailUrl!} alt="" className="h-full w-full object-cover" draggable={false} />
        </span>
      ))}
      {items.length > 3 && <span className="la-more">+{items.length - 3}</span>}
    </span>
  );
}

function Burst() {
  const bits = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        // Seeded by index, not Math.random: the server render and the first client render must match.
        const rnd = (k: number) => {
          const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        const a = (i / 30) * Math.PI * 2 + rnd(1) * 0.4;
        const r = 120 + rnd(2) * 160;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.7, c: ["--lime", "--energy-a", "--energy-b", "--energy-c", "--success"][i % 5], s: 6 + rnd(3) * 6, rot: rnd(4) * 360, round: i % 3 === 0 };
      }),
    [],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/3" aria-hidden="true">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className={cn("absolute block", b.round ? "rounded-full" : "rounded-[2px]")}
          style={{ width: b.s, height: b.round ? b.s : b.s * 0.45, background: `hsl(var(${b.c}))` }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 80], opacity: [1, 1, 0], rotate: b.rot, scale: 1 }}
          transition={{ duration: 1.6, ease: ease("out") }}
        />
      ))}
    </div>
  );
}
