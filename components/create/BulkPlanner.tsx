"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CalendarCheck2, CalendarClock, Check, ChevronLeft, Film, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { DateTimePicker } from "@/components/shared/DateTimePicker";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { fmt, tzShort } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { uploadVideo } from "@/lib/client/upload";
import { validateVideoFile } from "@/lib/client/handoff";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { BULK_MAX, titleFromFilename, tooLongFor } from "@/lib/posts/bulk";
import { cn } from "@/lib/utils";
import { readVideo } from "./frame";
import type { AccountView, MediaView, PostView } from "./types";

interface Row {
  key: string;
  file: File;
  title: string;
  caption: string;
  state: "waiting" | "uploading" | "ready" | "failed";
  progress: number;
  error?: string;
  media?: MediaView;
  poster?: string;
  duration?: number;
  at: string | null;
  /** The creator picked this time themselves, so a new plan leaves it alone. */
  pinned: boolean;
}
interface Plan {
  slots: string[];
  peakHours: number[];
  source: "yours" | "typical";
  reason: string;
  left: number | null;
  planName: string;
  period?: "week" | "month";
}
type Done = { posts: PostView[]; failed: { index: number; message: string }[] };

const CONCURRENT = 2;
let seq = 0;

export function BulkPlanner({ accounts, tz }: { accounts: AccountView[]; tz: string }) {
  const toast = useToast();
  const connected = useMemo(() => PLATFORMS.filter((p) => accounts.some((a) => a.platform === p && a.status === "connected")), [accounts]);
  const [platforms, setPlatforms] = useState<Platform[]>(() => connected.filter((p) => p === "instagram" || p === "youtube").length ? connected.filter((p) => p === "instagram" || p === "youtube") : connected.slice(0, 1));
  const [rows, setRows] = useState<Row[]>([]);
  const [hashtags, setHashtags] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<string, AbortController>());

  const patch = useCallback((key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))), []);

  /* ---------- adding files ---------- */
  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const room = BULK_MAX - rows.length;
      if (room <= 0) return toast(`That's ${BULK_MAX} already. Book these first, then start another batch.`, "info");
      const bad = list.map((f) => validateVideoFile(f)).find(Boolean);
      const good = list.filter((f) => !validateVideoFile(f));
      if (bad) toast(good.length ? `Skipped one or more files. ${bad}` : bad, "error");
      if (good.length > room) toast(`Added the first ${room}. A batch holds up to ${BULK_MAX} videos.`, "info");
      const fresh: Row[] = good.slice(0, room).map((file) => ({ key: `r${++seq}`, file, title: titleFromFilename(file.name), caption: "", state: "waiting", progress: 0, at: null, pinned: false }));
      setRows((rs) => [...rs, ...fresh]);
      for (const r of fresh) {
        const url = URL.createObjectURL(r.file);
        readVideo(url)
          .then((m) => patch(r.key, { duration: m.duration || undefined, poster: m.poster ? URL.createObjectURL(m.poster) : undefined }))
          .catch(() => {})
          .finally(() => URL.revokeObjectURL(url));
      }
    },
    [rows.length, toast, patch],
  );

  /* ---------- uploads, two at a time ---------- */
  useEffect(() => {
    const running = rows.filter((r) => r.state === "uploading").length;
    const next = rows.filter((r) => r.state === "waiting").slice(0, Math.max(0, CONCURRENT - running));
    for (const r of next) {
      patch(r.key, { state: "uploading", progress: 0, error: undefined });
      const ctrl = new AbortController();
      aborts.current.set(r.key, ctrl);
      uploadVideo<MediaView>(r.file, (p) => patch(r.key, { progress: p }), ctrl.signal)
        .then(({ media }) => {
          if (ctrl.signal.aborted) return;
          patch(r.key, { state: "ready", progress: 1, media });
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          patch(r.key, { state: "failed", error: e instanceof ApiError ? e.message : "Something got in the way." });
        })
        .finally(() => aborts.current.delete(r.key));
    }
  }, [rows, patch]);

  // Duration and poster go up once both the upload and the read have finished (same as single Create).
  const synced = useRef(new Set<string>());
  useEffect(() => {
    for (const r of rows) {
      if (!r.media || !r.duration || synced.current.has(r.media.id)) continue;
      synced.current.add(r.media.id);
      const id = r.media.id;
      (async () => {
        try {
          await api(`/api/media/${id}`, { method: "PATCH", json: { duration: r.duration } });
          if (r.poster) {
            const blob = await fetch(r.poster).then((x) => x.blob());
            await api(`/api/media/${id}/thumbnail`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
          }
        } catch {
          /* a nicety: the calendar falls back to a plain tile */
        }
      })();
    }
  }, [rows]);

  useEffect(() => () => aborts.current.forEach((c) => c.abort()), []);

  /* ---------- suggested times ---------- */
  const count = rows.length;
  const platformKey = platforms.join(",");
  useEffect(() => {
    if (!count) return setPlan(null);
    let alive = true;
    const t = setTimeout(() => {
      api<Plan>(`/api/posts/bulk?platforms=${platformKey}&count=${count}`)
        .then((p) => alive && setPlan(p))
        .catch(() => alive && setPlan(null));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [count, platformKey]);

  // Unpinned rows take the suggested slots in order; pinned ones keep the creator's pick.
  useEffect(() => {
    if (!plan) return;
    setRows((rs) => {
      const pinned = new Set(rs.filter((r) => r.pinned && r.at).map((r) => r.at));
      const free = plan.slots.filter((s) => !pinned.has(s));
      let i = 0;
      return rs.map((r) => (r.pinned ? r : { ...r, at: free[i++] ?? r.at }));
    });
  }, [plan]);

  /* ---------- booking ---------- */
  const uploading = rows.some((r) => r.state === "uploading" || r.state === "waiting");
  const failedUploads = rows.filter((r) => r.state === "failed").length;
  const missingTime = rows.some((r) => !r.at);
  const overPlan = plan?.left != null && rows.length > plan.left;
  const canBook = rows.length > 0 && platforms.length > 0 && !uploading && !failedUploads && !missingTime && !overPlan && !busy;
  const why = !rows.length
    ? "Add some videos first."
    : !platforms.length
      ? "Pick at least one place to send them."
      : uploading
        ? "Waiting for uploads to finish."
        : failedUploads
          ? "Retry or remove the videos that didn't upload."
          : overPlan
            ? `${plan!.planName} has ${plan!.left} post${plan!.left === 1 ? "" : "s"} left ${plan!.period === "week" ? "this week" : "this month"}. Remove ${rows.length - plan!.left!} or upgrade in Billing.`
            : missingTime
              ? "Finding times..."
              : null;

  const book = async () => {
    setBusy(true);
    try {
      const r = await api<Done>("/api/posts/bulk", {
        method: "POST",
        json: { platforms, items: rows.map((x) => ({ mediaId: x.media!.id, title: x.title, caption: x.caption, hashtags, scheduledAt: x.at })) },
      });
      setDone(r);
      if (!r.failed.length) toast(`${r.posts.length} post${r.posts.length === 1 ? "" : "s"} booked.`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't book the batch. Check your connection and try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = (key: string) => {
    aborts.current.get(key)?.abort();
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (editing === key) setEditing(null);
  };
  const toggle = (p: Platform) => setPlatforms((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || ps.includes(x))));
  const when = (iso: string) => fmt(iso, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (done) return <Booked done={done} rows={rows} when={when} />;

  return (
    <div className="mx-auto max-w-4xl px-5 pb-28 pt-8 sm:px-10 lg:pt-14">
      <Link href="/create" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> One video instead
      </Link>
      <p className="eyebrow mb-3 mt-4">Plan a batch · {tzShort(tz)}</p>
      <h1 className="display text-[clamp(2.4rem,5.5vw,4rem)]">{rows.length ? `${rows.length} video${rows.length === 1 ? "" : "s"}, one go.` : "A week of posts, one go."}</h1>
      <p className="mt-4 max-w-lg text-muted-foreground">Drop up to {BULK_MAX} videos. We space them over the days ahead at your best times, and you can change any time before booking, or drag them on the Calendar later.</p>

      {connected.length === 0 ? (
        <div className="mt-10 rounded-[24px] p-6 hairline">
          <p className="font-semibold">Connect an account first.</p>
          <p className="mt-1 text-sm text-muted-foreground">A batch goes to the places you have connected.</p>
          <Button asChild variant="lime" className="mt-4">
            <Link href="/accounts">Connect an account</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Where */}
          <section aria-labelledby="bulk-where" className="mt-10">
            <h2 id="bulk-where" className="text-sm font-semibold">Send them to</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {connected.map((p) => {
                const on = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(p)}
                    className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-medium transition hairline", on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                  >
                    <PlatformOrb platform={p} size={30} />
                    {PLATFORM_META[p].name}
                    {on && <Check className="h-4 w-4" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Drop */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files.length) add(e.dataTransfer.files);
            }}
            className={cn("mt-8 flex flex-col items-center justify-center gap-3 rounded-[28px] border-2 border-dashed p-8 text-center transition", over ? "border-[hsl(var(--lime))] bg-[hsl(var(--lime)/0.08)]" : "border-border")}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{rows.length >= BULK_MAX ? `That's the ${BULK_MAX}-video limit for one batch.` : "Drag videos here, or"}</p>
            <Button variant="subtle" onClick={() => picker.current?.click()} disabled={rows.length >= BULK_MAX}>
              <Film className="h-4 w-4" /> Choose videos
            </Button>
            <p className="text-xs text-muted-foreground">MP4 or MOV · {BULK_MAX - rows.length} more fit in this batch</p>
            <input
              ref={picker}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,.mp4,.mov"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                if (e.target.files?.length) add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Plan */}
          {plan && rows.length > 0 && (
            <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground" aria-live="polite">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
Spaced over the days ahead, one a day where they fit. {plan.reason}
              </span>
            </p>
          )}

          <ol className="mt-6 space-y-3" aria-label="Videos in this batch">
            <AnimatePresence initial={false}>
              {rows.map((r, i) => {
                const long = tooLongFor(r.duration, platforms);
                return (
                  <motion.li key={r.key} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="rounded-[24px] p-3 hairline sm:p-4">
                    <div className="flex gap-3 sm:gap-4">
                      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-2xl bg-secondary hairline">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.poster && <img src={r.poster} alt="" className="h-full w-full object-cover" />}
                        <span className="tabular absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[11px] font-semibold text-white">{i + 1}</span>
                        {r.state !== "ready" && (
                          <div className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                            {r.state === "failed" ? <AlertTriangle className="h-5 w-5" aria-hidden /> : <span className="tabular text-xs font-semibold">{r.state === "waiting" ? "Queued" : `${Math.round(r.progress * 100)}%`}</span>}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Label htmlFor={`t-${r.key}`} className="sr-only">Title for video {i + 1}</Label>
                            <Input id={`t-${r.key}`} value={r.title} maxLength={200} onChange={(e) => patch(r.key, { title: e.target.value })} placeholder="Title" />
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => remove(r.key)} aria-label={`Remove video ${i + 1}`}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <Label htmlFor={`c-${r.key}`} className="sr-only">Caption for video {i + 1}</Label>
                        <Textarea id={`c-${r.key}`} rows={2} value={r.caption} maxLength={5000} onChange={(e) => patch(r.key, { caption: e.target.value })} placeholder="Caption (optional)" />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant={editing === r.key ? "primary" : "subtle"} size="sm" onClick={() => setEditing(editing === r.key ? null : r.key)} aria-expanded={editing === r.key} disabled={!r.at}>
                            <CalendarClock className="h-4 w-4" /> {r.at ? when(r.at) : "Finding a time..."}
                          </Button>
                          {r.pinned && (
                            <button type="button" className="min-h-[44px] px-1 text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => patch(r.key, { pinned: false })}>
                              Use the suggestion
                            </button>
                          )}
                          {r.state === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Uploading" />}
                          {r.state === "failed" && (
                            <Button variant="danger" size="sm" onClick={() => patch(r.key, { state: "waiting" })}>
                              <RotateCcw className="h-4 w-4" /> Try again
                            </Button>
                          )}
                        </div>
                        {r.state === "failed" && <p className="text-xs text-[hsl(0_72%_38%)] dark:text-destructive">This one didn&apos;t upload. {r.error}</p>}
                        {long.length > 0 && (
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            Longer than {long.map((p) => `${PLATFORM_META[p].name} allows (${PLATFORM_META[p].maxDurationSec} s)`).join(" and ")}. It may be turned down there.
                          </p>
                        )}
                      </div>
                    </div>
                    {editing === r.key && r.at && (
                      <div className="mt-4 border-t border-border pt-4">
                        <DateTimePicker value={new Date(r.at)} tz={tz} peakHours={plan?.peakHours} onChange={(d) => patch(r.key, { at: d.toISOString(), pinned: true })} />
                      </div>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>

          {rows.length > 0 && (
            <div className="mt-6">
              <Label htmlFor="bulk-tags">Hashtags for every video</Label>
              <p id="bulk-tags-hint" className="mt-1 text-xs text-muted-foreground">Optional. Left off X when they don&apos;t fit in 280 characters.</p>
              <Input id="bulk-tags" aria-describedby="bulk-tags-hint" className="mt-2" value={hashtags} maxLength={1000} onChange={(e) => setHashtags(e.target.value)} placeholder="#travel #weekend" />
            </div>
          )}

          {/* Book */}
          {rows.length > 0 && (
            <div className="sticky bottom-[calc(max(12px,env(safe-area-inset-bottom))+80px)] z-10 mt-8 lg:bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] p-3 pl-5 glass hairline">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {why ?? `${rows.length} post${rows.length === 1 ? "" : "s"} to ${platforms.map((p) => PLATFORM_META[p].name).join(", ")}.`}
              </p>
              <Button variant="lime" onClick={book} disabled={!canBook}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarCheck2 className="h-4 w-4" aria-hidden />}
                {busy ? "Booking..." : `Schedule all ${rows.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Booked({ done, rows, when }: { done: Done; rows: Row[]; when: (iso: string) => string }) {
  const ok = done.posts.filter((p) => p.status === "scheduled");
  return (
    <div className="mx-auto max-w-2xl px-5 pb-20 pt-10 sm:px-10 lg:pt-16">
      <p className="eyebrow mb-3">Batch booked</p>
      <h1 className="display text-[clamp(2.4rem,5.5vw,4rem)]">{ok.length === done.posts.length ? `All ${ok.length} are booked.` : `${ok.length} of ${done.posts.length} booked.`}</h1>
      <ul className="mt-8 space-y-2">
        {done.posts.map((p, i) => {
          const fail = done.failed.find((f) => f.index === i);
          return (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl p-3 hairline">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", fail ? "bg-destructive/15" : "lime-bg")}>{fail ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.title ?? rows[i]?.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">{fail ? `Saved as a draft. ${fail.message}` : p.scheduledAt ? when(p.scheduledAt) : ""}</p>
              </div>
              {fail && (
                <Link href={`/create?post=${p.id}`} className="min-h-[44px] content-center text-sm font-medium underline-offset-4 hover:underline">
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-8 flex flex-wrap gap-2">
        <Button asChild variant="lime">
          <Link href="/calendar">See them on the Calendar</Link>
        </Button>
        <Button asChild variant="ghost">
          <a href="/create/bulk">Plan another batch</a>
        </Button>
      </div>
    </div>
  );
}
