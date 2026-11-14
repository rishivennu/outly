"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Film, GalleryHorizontalEnd, ImageIcon, ImagePlus, RefreshCw, Rocket, Send, Smartphone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { DateTimePicker, defaultSchedule } from "@/components/shared/DateTimePicker";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { fmt, tzShort } from "@/components/shell/UserContext";
import { api, ApiError } from "@/lib/client/api";
import { track } from "@/lib/analytics/track";
import { uploadVideo } from "@/lib/client/upload";
import { validateVideoFile } from "@/lib/client/handoff";
import { looksLikePhoto, PHOTO_ACCEPT, uploadPhoto } from "@/lib/client/image";
import { FEED_MAX_RATIO, FEED_MIN_RATIO, FORMAT_LABEL, MAX_SLIDES, SLIDE_FORMATS, takesCaption, type SlideFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { T } from "@/lib/motion/tokens";
import { createFont } from "./font";
import { readVideo } from "./frame";
import { primeGroove } from "./Groove";
import { PublishingView } from "./PublishingView";
import { ScheduledView } from "./LaunchPanel";
import { SaveDraft } from "./SaveDraft";
import { PostKindSwitch } from "./PostKindSwitch";
import { formatGate, hashtagCount, IG_CAPTION_MAX, shapeOk } from "./format-gate";
import type { AccountView, MediaView, PostView } from "./types";

/**
 * 1131: the Instagram composer for Stories, photo posts and carousels. Separate from the video journey on
 * purpose: no story, hooks or per-platform copy, just the files, the caption (not for a Story) and when.
 * Photos become Instagram-ready JPEGs in the browser; videos use the same upload as the video composer.
 */
export type { SlideFormat };

interface Slide {
  key: string;
  kind: "image" | "video";
  name: string;
  preview: string | null;
  poster: string | null;
  media: MediaView | null;
  status: "working" | "done" | "failed";
  progress: number;
  error?: string;
  altText: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  file?: File;
  /** How the photo was cropped: for the feed (4:5 to 1.91:1) or as a Story (9:16). */
  fit?: "feed" | "story";
}

/** Arrow keys move through a radio group, which is a single tab stop (the WAI-ARIA radio pattern). */
/** 1133: what actually stopped an upload, so "Try again" isn't a guess. */
function uploadError(e: unknown) {
  if (e instanceof ApiError) return e.message === "Something got in the way." ? `Outlly couldn't save this one (error ${e.status}). Tap Try again.` : e.message;
  console.error("[upload]", e);
  const msg = e instanceof Error ? e.message : "";
  if (/fetch|network|load failed/i.test(msg)) return "Couldn't reach Outlly. Check your connection, then tap Try again.";
  const name = e instanceof Error && e.name && e.name !== "Error" ? ` (${e.name})` : "";
  return `This browser couldn't prepare this file${name}. Tap Try again, or save it as a JPEG first.`;
}

const handle = (u: string) => (u.startsWith("@") ? u : `@${u}`);

function radioKeys<V>(values: readonly V[], current: V, set: (v: V) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    set(values[(values.indexOf(current) + step + values.length) % values.length]);
    const group = e.currentTarget;
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
}

interface Props {
  accounts: AccountView[];
  /** 1133: every Instagram account this person can post to, so one with two connected can pick. */
  choices?: AccountView[];
  initialPost: PostView | null;
  initialFormat: SlideFormat;
  tz: string;
  connected: string | null;
}

const LIVE = ["publishing", "published", "partial", "failed"];
const VIDEO_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";
let seq = 0;
const newKey = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

const ABOUT: Record<SlideFormat, { icon: typeof Smartphone; line: string }> = {
  story: { icon: Smartphone, line: "One photo or video, full screen, for 24 hours" },
  photo: { icon: ImageIcon, line: "One picture in your feed" },
  carousel: { icon: GalleryHorizontalEnd, line: `2 to ${MAX_SLIDES} photos and videos to swipe` },
};

function fromMedia(m: MediaView, altText?: string | null): Slide {
  return {
    key: newKey(), kind: m.kind, name: m.filename ?? "file", preview: m.url, poster: m.thumbnailUrl, media: m, status: "done", progress: 1,
    altText: altText ?? "", mimeType: m.mimeType, size: m.size, width: m.width, height: m.height, duration: m.duration,
  };
}

export function FormatComposer({ accounts, choices, initialPost, initialFormat, tz, connected }: Props) {
  const toast = useToast();
  // The page hands over the account this post goes out on (pinned, else the picked profile). With two or more
  // Instagram accounts connected, the creator picks one here and the post is pinned to it when saved.
  const first = accounts.find((a) => a.platform === "instagram") ?? null;
  const own = (choices ?? []).filter((a) => a.platform === "instagram");
  const options = own.length ? own : first ? [first] : [];
  const many = options.length > 1;
  const [igId, setIgId] = useState<string | null>(first?.id ?? options[0]?.id ?? null);
  const ig = options.find((a) => a.id === igId) ?? first;
  const igReady = ig?.status === "connected";
  const target = initialPost?.targets.find((t) => t.platform === "instagram");

  const [format, setFormat] = useState<SlideFormat>(() => (initialPost && initialPost.format !== "video" ? (initialPost.format as SlideFormat) : initialFormat));
  const [slides, setSlides] = useState<Slide[]>(() => (initialPost?.items?.length ? initialPost.items.map((i) => fromMedia(i, i.altText)) : initialPost ? [fromMedia(initialPost.media)] : []));
  const [picked, setPicked] = useState(0);
  const [caption, setCaption] = useState(target?.caption ?? "");
  const [hashtags, setHashtags] = useState(target?.hashtags ?? "");
  const aborts = useRef(new Map<string, AbortController>());
  // Local previews (object URLs), let go of when the page closes.
  const urls = useRef(new Set<string>());
  const keep = useCallback((u: string) => (urls.current.add(u), u), []);
  // Slides counted as they are added, so two drops in one moment can't go past 20 between renders.
  const count = useRef(slides.length);
  count.current = slides.length;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const postIdRef = useRef<string | null>(initialPost?.id ?? null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const [mode, setMode] = useState<"now" | "schedule">(initialPost?.status === "scheduled" ? "schedule" : "now");
  const [when, setWhen] = useState<Date>(() => (initialPost?.scheduledAt ? new Date(initialPost.scheduledAt) : defaultSchedule(tz)));
  const [picking, setPicking] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "publishing" | "scheduled">(initialPost && LIVE.includes(initialPost.status) ? "publishing" : "edit");
  const [livePost, setLivePost] = useState<PostView | null>(initialPost && LIVE.includes(initialPost.status) ? initialPost : null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  useEffect(() => {
    if (connected === "instagram") toast("Instagram is connected.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the page stops any upload still going and frees the previews.
  useEffect(() => {
    const running = aborts.current;
    const made = urls.current;
    return () => {
      for (const c of running.values()) c.abort();
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, []);

  const patch = useCallback((key: string, p: Partial<Slide>) => setSlides((xs) => xs.map((s) => (s.key === key ? { ...s, ...p } : s))), []);

  /* ================= files ================= */
  const run = useCallback(
    async (s: Slide, file: File, fit: "feed" | "story") => {
      const ctrl = new AbortController();
      aborts.current.set(s.key, ctrl);
      patch(s.key, { status: "working", progress: 0, error: undefined, file });
      try {
        if (s.kind === "image") {
          const r = await uploadPhoto(file, fit, ctrl.signal);
          if (ctrl.signal.aborted) return;
          keep(r.preview);
          patch(s.key, { media: r.media, status: "done", progress: 1, preview: r.preview, poster: r.preview, mimeType: "image/jpeg", size: r.media.size, width: r.width, height: r.height, fit });
        } else {
          const r = await uploadVideo<MediaView>(file, (p) => patch(s.key, { progress: p }), ctrl.signal);
          if (ctrl.signal.aborted) return;
          let m = r.media;
          // The browser measured it while it uploaded: store the size and length, and a poster frame.
          const local = await readVideo(s.preview!).catch(() => null);
          if (local) {
            m = (await api<{ media: MediaView }>(`/api/media/${m.id}`, { method: "PATCH", json: { duration: local.duration || undefined, width: local.width || undefined, height: local.height || undefined } }).catch(() => ({ media: m }))).media;
            if (local.poster) m = (await api<{ media: MediaView }>(`/api/media/${m.id}/thumbnail`, { method: "PUT", body: local.poster, headers: { "content-type": "image/jpeg" } }).catch(() => ({ media: m }))).media;
          }
          patch(s.key, { media: m, status: "done", progress: 1, size: m.size, width: m.width ?? local?.width ?? null, height: m.height ?? local?.height ?? null, duration: m.duration ?? local?.duration ?? null, ...(m.thumbnailUrl ? { poster: m.thumbnailUrl } : {}) });
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        patch(s.key, { status: "failed", error: uploadError(e) });
      } finally {
        if (aborts.current.get(s.key) === ctrl) aborts.current.delete(s.key);
      }
    },
    [patch, keep],
  );

  const add = useCallback(
    (list: FileList | File[]) => {
      let files = Array.from(list);
      if (!files.length) return;
      const bad: string[] = [];
      files = files.filter((f) => {
        if (looksLikePhoto(f)) return true;
        if (format === "photo") return void bad.push("A photo post is one picture. Pick Story or Carousel for a video.");
        const why = validateVideoFile(f);
        if (why) return void bad.push(why);
        return true;
      });
      if (bad.length) toast(bad[0], "error");
      if (!files.length) return;
      const fit = format === "story" ? "story" : "feed";
      const room = format === "carousel" ? MAX_SLIDES - count.current : 1;
      if (format === "carousel" && files.length > room) toast(room > 0 ? `A carousel takes up to ${MAX_SLIDES}. Added the first ${room}.` : `A carousel takes up to ${MAX_SLIDES} slides.`, "info");
      files = files.slice(0, Math.max(0, room));
      if (!files.length) return;
      count.current = format === "carousel" ? count.current + files.length : files.length;
      const fresh: Slide[] = files.map((f) => {
        const image = looksLikePhoto(f);
        const preview = image ? null : keep(URL.createObjectURL(f));
        return { key: newKey(), kind: image ? "image" : "video", name: f.name, preview, poster: null, media: null, status: "working", progress: 0, altText: "", mimeType: image ? "image/jpeg" : f.type || "video/mp4", size: f.size, width: null, height: null, duration: null, file: f };
      });
      if (format === "carousel") setSlides((xs) => [...xs, ...fresh]);
      else {
        // One-file posts: a new pick replaces the old one.
        for (const c of aborts.current.values()) c.abort();
        aborts.current.clear();
        setSlides(fresh);
        setPicked(0);
      }
      for (const s of fresh) {
        if (s.kind === "video" && s.preview)
          void readVideo(s.preview).then((m) => patch(s.key, { width: m.width, height: m.height, duration: m.duration, poster: m.poster ? keep(URL.createObjectURL(m.poster)) : null })).catch(() => {});
      }
      // One at a time: phones stay responsive and the plan's storage check sees each file in turn.
      void fresh.reduce((p, s) => p.then(() => run(s, s.file!, fit)), Promise.resolve());
    },
    [format, toast, run, patch, keep],
  );

  /** Photos are cropped for where they go, so moving between Story and the feed redoes the ones we still have the file for. */
  const switchFormat = (f: SlideFormat) => {
    if (f === format) return;
    setFormat(f);
    const fit = f === "story" ? "story" : "feed";
    const redo = slides.filter((s) => s.kind === "image" && s.file && s.fit && s.fit !== fit && s.status !== "working");
    void redo.reduce((p, s) => p.then(() => run(s, s.file!, fit)), Promise.resolve());
  };

  const retry = (s: Slide) => s.file && void run(s, s.file, format === "story" ? "story" : "feed");
  const remove = (key: string) => {
    aborts.current.get(key)?.abort();
    setSlides((xs) => xs.filter((s) => s.key !== key));
    setPicked((i) => Math.max(0, Math.min(i, slides.length - 2)));
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= slides.length) return;
    setSlides((xs) => {
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setPicked(j);
  };

  const uploading = slides.some((s) => s.status === "working");
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  /* ================= checks ================= */
  const gate = useMemo(() => formatGate(format, slides, { caption, hashtags }, { connected: igReady }), [format, slides, caption, hashtags, igReady]);
  const done = useMemo(() => slides.filter((s) => s.media && s.status === "done"), [slides]);
  const savable = shapeOk(format, done.length) && done.length === slides.length;

  /* ================= saving ================= */
  const save = useCallback(
    (opts?: { force?: boolean; strict?: boolean }) => {
      const go = async () => {
        if (!savable) {
          if (!opts?.force) return postIdRef.current;
          const why = uploading ? "Still uploading. Save again in a moment." : (gate.errors[0] ?? "Add your photos or videos first.");
          if (opts.strict) throw new ApiError(400, why);
          toast(why, "error");
          return postIdRef.current;
        }
        setSaved("saving");
        try {
          const items = done.map((s) => ({ mediaId: s.media!.id, altText: s.kind === "image" ? s.altText.trim() || null : null }));
          const words = takesCaption(format) ? caption.trim() : "";
          const r = await api<{ post: PostView }>("/api/posts", {
            method: "POST",
            json: {
              postId: postIdRef.current ?? undefined,
              mediaId: items[0].mediaId,
              title: (words.split("\n")[0] || `Instagram ${FORMAT_LABEL[format].toLowerCase()}`).slice(0, 120),
              format,
              items,
              targets: [{ platform: "instagram", ...(many && ig ? { accountId: ig.id } : {}), caption: words || null, hashtags: takesCaption(format) ? hashtags.trim() || null : null }],
            },
          });
          if (!postIdRef.current) {
            postIdRef.current = r.post.id;
            window.history.replaceState(null, "", `/create?post=${r.post.id}`);
          }
          setSaved("saved");
          setSavedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
          return r.post.id;
        } catch (e) {
          setSaved("error");
          if (opts?.strict) throw e;
          if (opts?.force) toast(e instanceof ApiError ? `Couldn't save the draft. ${e.message}` : "Couldn't save the draft. Check your connection and try again.", "error");
          return postIdRef.current;
        }
      };
      const next = chain.current.then(go, go);
      chain.current = next;
      return next as Promise<string | null>;
    },
    [savable, uploading, gate.errors, done, format, caption, hashtags, toast, many, ig],
  );

  // Save as you go once the files are up and the post has its shape.
  const fingerprint = JSON.stringify([format, done.map((s) => [s.media!.id, s.altText]), caption, hashtags, many ? ig?.id : null]);
  const lastSaved = useRef<string | null>(initialPost ? fingerprint : null);
  useEffect(() => {
    if (phase !== "edit" || !savable || lastSaved.current === fingerprint) return;
    const t = setTimeout(() => {
      lastSaved.current = fingerprint;
      void save();
    }, 1000);
    return () => clearTimeout(t);
  }, [fingerprint, savable, phase, save]);

  /* ================= assistant ================= */
  // 1133: once the photos are up, the Outlly assistant looks at them (and reads any words in them) and writes the
  // caption, hashtags and a description for each photo. On its own it only fills what is still empty;
  // "Write again" replaces the caption and hashtags, and any description it wrote before.
  const [ai, setAi] = useState<"idle" | "reading" | "done">("idle");
  const aiSeen = useRef(new Set<string>(slides.map((s) => s.media?.id).filter((x): x is string => !!x)));
  const aiAlt = useRef(new Map<string, string>());
  const aiCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => aiCtrl.current?.abort(), []);
  const photoIds = done.filter((s) => s.kind === "image").map((s) => s.media!.id);
  const photoKey = photoIds.join(",");
  const canWrite = takesCaption(format) && photoIds.length > 0;

  const writeWithAi = useCallback(
    async (auto: boolean) => {
      const ids = photoKey ? photoKey.split(",") : [];
      if (!ids.length || (format !== "photo" && format !== "carousel")) return;
      aiCtrl.current?.abort();
      const ctrl = new AbortController();
      aiCtrl.current = ctrl;
      for (const id of ids) aiSeen.current.add(id);
      setAi("reading");
      try {
        const r = await api<{ caption?: string; hashtags?: string; slides?: { mediaId: string; altText: string }[]; skipped?: string }>("/api/ai/photo-caption", {
          method: "POST",
          json: { mediaIds: ids, format, auto },
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        if (r.skipped || !r.caption) return setAi("idle");
        setCaption((c) => (auto && c.trim() ? c : r.caption!));
        setHashtags((h) => (auto && h.trim() ? h : r.hashtags ?? h));
        const alts = new Map((r.slides ?? []).filter((x) => x.altText).map((x) => [x.mediaId, x.altText]));
        setSlides((xs) =>
          xs.map((s) => {
            const id = s.media?.id;
            const alt = id ? alts.get(id) : undefined;
            if (!id || !alt || s.kind !== "image") return s;
            const mine = s.altText.trim() && s.altText !== aiAlt.current.get(id);
            if (mine) return s;
            aiAlt.current.set(id, alt);
            return { ...s, altText: alt };
          }),
        );
        setAi("done");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setAi("idle");
        if (!auto) toast(e instanceof ApiError ? e.message : "The assistant couldn't reach your photos. Try again.", "error");
      } finally {
        if (aiCtrl.current === ctrl) aiCtrl.current = null;
      }
    },
    [photoKey, format, toast],
  );

  // On its own once uploads settle, for photos it hasn't seen yet.
  useEffect(() => {
    if (phase !== "edit" || uploading || !canWrite) return;
    if (!photoKey.split(",").some((id) => !aiSeen.current.has(id))) return;
    const t = setTimeout(() => void writeWithAi(true), 500);
    return () => clearTimeout(t);
  }, [photoKey, uploading, phase, canWrite, writeWithAi]);

  const connect = async () => {
    const id = savable ? await save({ force: true }) : postIdRef.current;
    window.location.href = `/api/accounts/instagram/connect?returnTo=${encodeURIComponent(id ? `/create?post=${id}&connected=instagram` : `/create?format=${format}&connected=instagram`)}`;
  };

  const launch = async () => {
    if (mode === "now") primeGroove();
    setLaunching(true);
    setLaunchError(null);
    try {
      const id = await save({ force: true, strict: true });
      if (!id) throw new ApiError(400, "Add your photos or videos first.");
      const r = await api<{ post: PostView }>(`/api/posts/${id}/launch`, { method: "POST", json: { mode, scheduledAt: mode === "schedule" ? when.toISOString() : undefined, confirmed: true } });
      track(mode === "schedule" ? "post_scheduled" : "post_published", { kind: "format" });
      if (mode === "now") {
        setLivePost(r.post);
        setPhase("publishing");
      } else {
        setScheduledFor(r.post.scheduledAt ?? when.toISOString());
        setPhase("scheduled");
      }
      window.scrollTo({ top: 0 });
    } catch (e) {
      setLaunchError(e instanceof ApiError ? e.message : "Something got in the way. Let's try again.");
    } finally {
      setLaunching(false);
    }
  };

  const another = () => window.location.assign(`/create?format=${format}`);
  const cover = slides[0]?.poster ?? slides[0]?.preview ?? null;

  if (phase !== "edit") {
    return (
      <div className="relative overflow-hidden px-[var(--frame-gutter)] py-12 lg:min-h-dvh">
        <div className="page-frame relative px-0">
          {phase === "publishing" && livePost ? <PublishingView initial={livePost} onAnother={another} /> : <ScheduledView when={scheduledFor ?? when.toISOString()} tz={tz} poster={cover} onAnother={another} />}
        </div>
      </div>
    );
  }

  const accept = format === "photo" ? PHOTO_ACCEPT : `${PHOTO_ACCEPT},${VIDEO_ACCEPT}`;
  const selIndex = Math.min(picked, slides.length - 1);
  const sel = slides[selIndex];
  // Instagram crops every carousel slide to the first one's shape: the strip shows that crop.
  const r0 = slides[0]?.width && slides[0]?.height ? slides[0].width / slides[0].height : 4 / 5;
  const stripRatio = Math.min(FEED_MAX_RATIO, Math.max(FEED_MIN_RATIO, r0));
  const label = FORMAT_LABEL[format].toLowerCase();
  const full = slides.length >= MAX_SLIDES;
  const pick = () => fileInput.current?.click();
  const total = [caption.trim(), hashtags.trim()].filter(Boolean).join("\n\n").length;

  return (
    <div className="relative px-4 pb-16 pt-6 sm:px-8 lg:pt-10">
      <div className={cn("mx-auto w-full max-w-3xl", createFont.variable)}>
        {!initialPost && <PostKindSwitch value="photo" className="mb-7" />}
        <p className="step-pill mx-auto mb-5 w-fit">
          <PlatformOrb platform="instagram" size={18} />
          Instagram
        </p>
        <h1 className="create-title font-create text-balance text-center">
          Post a{" "}
          <span className="create-title-accent">
            <span className="accent-serif energy-text">{label}</span>
          </span>
        </h1>

        <div role="radiogroup" aria-label="What are you posting?" onKeyDown={radioKeys(SLIDE_FORMATS, format, switchFormat)} className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-2 rounded-[22px] bg-secondary/60 p-1.5 hairline">
          {SLIDE_FORMATS.map((f) => {
            const Icon = ABOUT[f].icon;
            const on = format === f;
            return (
              <button key={f} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => switchFormat(f)}
                className={cn("relative flex min-h-[52px] items-center justify-center rounded-[18px] px-2 text-sm font-semibold transition", on ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                {on && <motion.span layoutId="format-pick" className="absolute inset-0 rounded-[18px] bg-foreground" transition={T.glide} />}
                <span className="relative inline-flex items-center gap-1.5"><Icon className="h-4 w-4" aria-hidden="true" />{FORMAT_LABEL[f]}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-center text-sm text-muted-foreground">{ABOUT[format].line}</p>

        <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={accept} multiple={format === "carousel"}
          onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />

        <section aria-label="Your files" className="mt-8">
          {slides.length === 0 ? (
            <button type="button" onClick={pick}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
              className={cn("glass flex w-full flex-col items-center justify-center gap-3 rounded-[28px] px-6 py-14 text-center transition hairline", dragging && "ring-2 ring-lime")}>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary"><ImagePlus className="h-6 w-6" aria-hidden="true" /></span>
              <span className="text-lg font-semibold">{format === "photo" ? "Pick a photo" : format === "story" ? "Pick a photo or video" : "Pick your photos and videos"}</span>
              <span className="max-w-sm text-sm text-muted-foreground">
                {format === "photo" ? "JPEG, PNG or WebP. We crop it into Instagram's 4:5 to 1.91:1 frame." : format === "story" ? "Tall 9:16 looks best. Videos up to 60 seconds." : `Up to ${MAX_SLIDES}. Every slide takes the shape of the first one.`}
              </span>
            </button>
          ) : format === "carousel" ? (
            <div>
              <ol className="flex snap-x gap-3 overflow-x-auto pb-3" aria-label="Slides, in order">
                {slides.map((s, i) => (
                  <li key={s.key} className="shrink-0 snap-start">
                    <div className={cn("relative w-36 overflow-hidden rounded-2xl bg-secondary hairline sm:w-44", selIndex === i && "ring-2 ring-foreground")} style={{ aspectRatio: String(stripRatio) }}>
                      <button type="button" className="absolute inset-0" onClick={() => setPicked(i)} aria-pressed={selIndex === i} aria-label={`Slide ${i + 1}: ${s.name}`}>
                        <SlideArt s={s} />
                      </button>
                      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold tabular text-white">{i + 1}</span>
                      <SlideState s={s} onRetry={() => retry(s)} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move slide ${i + 1} earlier`}><ChevronLeft className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(s.key)} aria-label={`Take out slide ${i + 1}`}><X className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label={`Move slide ${i + 1} later`}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  </li>
                ))}
                {!full && (
                  <li className="shrink-0 snap-start">
                    <button type="button" onClick={pick} className="grid w-36 place-items-center rounded-2xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground transition hover:text-foreground sm:w-44" style={{ aspectRatio: String(stripRatio) }}>
                      <span className="flex flex-col items-center gap-2"><ImagePlus className="h-5 w-5" aria-hidden="true" />Add slides</span>
                    </button>
                  </li>
                )}
              </ol>
              <p className="text-sm text-muted-foreground">{slides.length} of {MAX_SLIDES} slides, shown the way Instagram will crop them.</p>
              {sel?.kind === "image" && <AltText key={sel.key} value={sel.altText} onChange={(v) => patch(sel.key, { altText: v })} label={`Describe slide ${selIndex + 1} for people who can't see it`} />}
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className={cn("relative w-full overflow-hidden rounded-[28px] bg-black hairline", format === "story" ? "max-w-[300px]" : "max-w-md")}
                style={{ aspectRatio: format === "story" ? "9 / 16" : String(slides[0].width && slides[0].height ? slides[0].width / slides[0].height : 4 / 5) }}>
                <SlideArt s={slides[0]} contain={format === "story"} play />
                <SlideState s={slides[0]} onRetry={() => retry(slides[0])} />
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="subtle" onClick={pick}><RefreshCw className="h-4 w-4" aria-hidden="true" /> Replace</Button>
                <Button variant="ghost" onClick={() => remove(slides[0].key)}><X className="h-4 w-4" aria-hidden="true" /> Remove</Button>
              </div>
              {slides.length > 1 && (
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  A {label} is one file, and this has {slides.length}.{" "}
                  <button type="button" className="inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-4" onClick={() => setSlides((xs) => xs.slice(0, 1))}>Keep only the first</button>
                </p>
              )}
              {format === "photo" && slides[0].kind === "image" && <AltText key={slides[0].key} value={slides[0].altText} onChange={(v) => patch(slides[0].key, { altText: v })} label="Describe the photo for people who can't see it" />}
            </div>
          )}
        </section>

        {takesCaption(format) ? (
          <section aria-labelledby="cap-title" className="glass mt-8 rounded-[28px] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cap-title" className="text-base font-semibold">
                <label htmlFor="ig-caption">Caption</label>
              </h2>
              <Button type="button" variant="subtle" size="md" disabled={!canWrite || ai === "reading"} onClick={() => void writeWithAi(false)}>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {ai === "reading" ? "Reading your photos…" : ai === "done" ? "Write again" : "Write with assistant"}
              </Button>
            </div>
            <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
              {ai === "reading"
                ? "The Outlly assistant is looking at your photos and reading any words in them."
                : ai === "done"
                  ? "Written by the Outlly assistant from your photos, with a description for each one. Change anything you like."
                  : canWrite
                    ? "The assistant can write this from your photos."
                    : "Add photos and the assistant writes the caption for you."}
            </p>
            <textarea id="ig-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="Say what this is about. The first line shows before 'more'."
              className="mt-3 w-full resize-y rounded-2xl bg-background/60 p-3 text-base leading-relaxed hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <label htmlFor="ig-tags" className="mt-3 block text-sm font-medium">Hashtags</label>
            <input id="ig-tags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#travel #food"
              className="mt-1.5 h-11 w-full rounded-2xl bg-background/60 px-3 text-base hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <p className={cn("mt-2 text-xs tabular", total > IG_CAPTION_MAX ? "text-destructive" : "text-muted-foreground")}>
              {total} / {IG_CAPTION_MAX} characters · {hashtagCount(`${caption} ${hashtags}`)} / 30 hashtags
            </p>
          </section>
        ) : (
          <p className="mt-8 rounded-[22px] p-4 text-sm leading-relaxed text-muted-foreground hairline">
            Stories go up without a caption, and Instagram doesn&apos;t let apps add stickers or links to them. Put any words on the photo or video itself.
          </p>
        )}

        <section aria-labelledby="where-title" className="glass mt-6 rounded-[28px] p-5">
          <h2 id="where-title" className="sr-only">Where and when</h2>
          <div className="flex items-center gap-3">
            <PlatformOrb platform="instagram" size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{ig ? (many ? `Posting to ${handle(ig.username)}` : ig.username) : "Instagram"}</p>
              <p className="text-sm text-muted-foreground">{igReady ? (ig?.mock ? "Practice account: nothing reaches Instagram" : `Goes up as a ${label}`) : ig ? "Needs you to reconnect" : "Not connected yet"}</p>
            </div>
            {!igReady && <Button variant="primary" onClick={() => void connect()}>{ig ? "Reconnect" : "Connect"}</Button>}
          </div>
          {many && ig && (
            <div role="radiogroup" aria-label="Which Instagram account should this go to?" onKeyDown={radioKeys(options.map((a) => a.id), ig.id, setIgId)} className="mt-4 grid gap-2 sm:grid-cols-2">
              {options.map((a) => {
                const on = a.id === ig.id;
                return (
                  <button key={a.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setIgId(a.id)}
                    className={cn("flex min-h-[52px] items-center gap-3 rounded-[18px] px-3 text-left transition hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-foreground text-background" : "hover:bg-secondary/60")}>
                    <PlatformOrb platform="instagram" size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{handle(a.username)}</span>
                      <span className={cn("block text-xs", on ? "text-background/70" : "text-muted-foreground")}>{a.status === "connected" ? (a.mock ? "Practice account" : "Ready to post") : "Needs reconnecting"}</span>
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          <div role="radiogroup" aria-label="When should this go live?" onKeyDown={radioKeys(["now", "schedule"] as const, mode, setMode)} className="mt-5 grid grid-cols-2 gap-2 rounded-full bg-secondary/60 p-1.5 hairline">
            {(["now", "schedule"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} onClick={() => setMode(m)} className={cn("relative h-12 rounded-full text-sm font-semibold transition", mode === m ? "text-background" : "text-muted-foreground hover:text-foreground")}>
                {mode === m && <motion.span layoutId="fmt-launch-mode" className="absolute inset-0 rounded-full bg-foreground" transition={T.glide} />}
                <span className="relative inline-flex items-center gap-2">{m === "now" ? <Send className="h-4 w-4" aria-hidden="true" /> : <CalendarClock className="h-4 w-4" aria-hidden="true" />}{m === "now" ? "Post it now" : "Schedule it"}</span>
              </button>
            ))}
          </div>
          {mode === "schedule" && (
            <button type="button" onClick={() => setPicking(true)} className="mt-3 flex min-h-[56px] w-full items-center gap-3 rounded-[20px] p-3 text-left transition hairline hover:bg-secondary/60">
              <CalendarDays className="h-5 w-5 text-warning" aria-hidden="true" />
              <span className="flex-1 font-semibold">
                {fmt(when, tz, { weekday: "long", month: "short", day: "numeric" })} · {fmt(when, tz, { hour: "numeric", minute: "2-digit" })}{" "}
                <span className="text-sm font-normal text-muted-foreground">{tzShort(tz)}</span>
              </span>
              <span className="text-sm text-muted-foreground">Change</span>
            </button>
          )}
        </section>

        {slides.length > 0 && (gate.errors.length > 0 || gate.warnings.length > 0) && (
          <ul className="mt-5 space-y-1.5 text-sm" aria-live="polite">
            {gate.errors.map((m) => (
              <li key={m} className="flex gap-2 text-destructive"><span aria-hidden="true">•</span><span>{m}</span></li>
            ))}
            {gate.warnings.map((m) => (
              <li key={m} className="flex gap-2 text-muted-foreground"><span aria-hidden="true">•</span><span><span className="font-medium text-foreground">Heads up: </span>{m}</span></li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button variant="lime" size="xl" className="w-full sm:w-auto sm:min-w-[320px]" disabled={launching || !gate.ready} onClick={() => void launch()}>
            {mode === "now" ? (
              <><Rocket className="h-5 w-5" aria-hidden="true" /> {launching ? "Sending it to Instagram…" : format === "story" ? "Share the Story" : `Post the ${label}`}</>
            ) : (
              <><CalendarClock className="h-5 w-5" aria-hidden="true" /> {launching ? "Putting it on the calendar…" : "Schedule it"}</>
            )}
          </Button>
          {launchError && <p role="alert" className="text-center text-sm text-destructive">{launchError}</p>}
        </div>

        {slides.length > 0 && <SaveDraft state={saved} at={savedAt} onSave={() => void save({ force: true }).then((id) => id && toast("Saved to Drafts. Find it under Content."))} busy={saved === "saving"} />}
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Posting a video to Reels, Shorts and more?{" "}
          <Link href="/create" className="inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-4">Use the video composer</Link>
        </p>
      </div>

      <Sheet open={picking} onOpenChange={setPicking} title="When should this go live?" description={`Times are in ${tzShort(tz)}.`} side="center">
        <DateTimePicker value={when} onChange={setWhen} tz={tz} />
        <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => setPicking(false)}>That works</Button>
      </Sheet>
    </div>
  );
}

function SlideArt({ s, contain, play }: { s: Slide; contain?: boolean; play?: boolean }) {
  const fit = contain ? "object-contain" : "object-cover";
  if (s.kind === "video" && s.preview && play)
    return <video src={s.preview} poster={s.poster ?? undefined} className={cn("h-full w-full", fit)} controls playsInline muted preload="metadata" aria-label={s.name} />;
  const src = s.kind === "image" ? s.preview : s.poster;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className={cn("h-full w-full", fit)} /> : (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          {s.kind === "video" ? <Film className="h-6 w-6" aria-hidden="true" /> : <ImageIcon className="h-6 w-6" aria-hidden="true" />}
        </span>
      )}
      {s.kind === "video" && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 p-1 text-white">
          <Film className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Video</span>
        </span>
      )}
    </>
  );
}

function SlideState({ s, onRetry }: { s: Slide; onRetry: () => void }) {
  if (s.status === "done") return null;
  if (s.status === "working") {
    const pct = Math.round(s.progress * 100);
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 p-2 text-xs font-medium text-white" role="status">
        {s.kind === "image" ? "Preparing the photo…" : `Uploading ${pct}%`}
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/25">
          <div className="h-full bg-white transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(6, s.kind === "image" ? 60 : pct)}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 p-3 text-center text-xs text-white" role="alert">
      <span>{s.error ?? "Didn't upload."}</span>
      {s.file && <button type="button" onClick={onRetry} className="min-h-[44px] rounded-full bg-white px-4 font-semibold text-black">Try again</button>}
    </div>
  );
}

function AltText({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="mt-4 w-full max-w-md self-center">
      <label htmlFor="alt-text" className="block text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <input id="alt-text" value={value} maxLength={1000} onChange={(e) => onChange(e.target.value)} placeholder="A golden retriever catching a frisbee on the beach"
        className="mt-1.5 h-11 w-full rounded-2xl bg-background/60 px-3 text-base hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </div>
  );
}
