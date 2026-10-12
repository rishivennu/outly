"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { UploadZone } from "@/components/shared/UploadZone";
import { useToast } from "@/components/shared/Toast";
import { defaultSchedule } from "@/components/shared/DateTimePicker";
import { api, ApiError } from "@/lib/client/api";
import { uploadVideo } from "@/lib/client/upload";
import { takeHandoff } from "@/lib/client/handoff";
import { blocking, checksFor } from "@/lib/client/checks";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { Assistant } from "./Assistant";
import { JourneyBar, JourneyRail } from "./JourneyRail";
import { createFont } from "./font";
import { LaunchPanel, ScheduledView } from "./LaunchPanel";
import { PlatformDeck } from "./PlatformDeck";
import { PublishingView } from "./PublishingView";
import { VideoStage } from "./VideoStage";
import { CaptionBurner } from "./CaptionBurner";
import { readVideo } from "./frame";
import { emptyDraft, NOTES, type AccountView, type Draft, type HookResult, type MediaView, type PlatformCopy, type PostView, type Step, type Tone, type UploadState } from "./types";

interface Props {
  accounts: AccountView[];
  initialPost: PostView | null;
  tz: string;
  connected: string | null;
  connectError: string | null;
}

type Meta = { duration: number; width: number; height: number };
const LIVE = ["publishing", "published", "partial", "failed"];

export function CreateWorkspace({ accounts: accountList, initialPost, tz, connected, connectError }: Props) {
  const toast = useToast();
  const accounts = useMemo(() => Object.fromEntries(accountList.map((a) => [a.platform, a])) as Partial<Record<Platform, AccountView>>, [accountList]);

  /* ---------------- video ---------------- */
  const [media, setMedia] = useState<MediaView | null>(initialPost?.media ?? null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localPoster, setLocalPoster] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<Meta | null>(null);
  const [upload, setUpload] = useState<UploadState>(initialPost ? { kind: "done" } : { kind: "idle" });
  const fileRef = useRef<File | null>(null);
  const posterBlob = useRef<Blob | null>(null);
  const synced = useRef<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  /** The clean video, kept while a captioned copy is in use so "without captions" is one click (no re-upload). */
  const [preCaption, setPreCaption] = useState<{ media: MediaView; file: File | null } | null>(null);

  /* ---------------- story + hooks ---------------- */
  const [step, setStep] = useState<Step>(() => {
    if (!initialPost) return "video";
    if (initialPost.status === "scheduled") return "launch";
    if (initialPost.hook) return "everywhere";
    return "story";
  });
  const [story, setStory] = useState(initialPost?.story ?? "");
  const [submittedStory, setSubmittedStory] = useState<string | null>(initialPost?.story ?? null);
  const [hooks, setHooks] = useState<{ loading: boolean; result: HookResult | null; index: number; tone: Tone; error: string | null }>({ loading: false, result: null, index: 0, tone: "default", error: null });
  const seen = useRef<string[]>([]);
  const [hook, setHook] = useState<string | null>(initialPost?.hook ?? null);

  /* ---------------- platforms ---------------- */
  const live = useLivePlatforms();
  const [drafts, setDrafts] = useState<Record<Platform, Draft>>(() => {
    const out = {} as Record<Platform, Draft>;
    for (const p of PLATFORMS) {
      const t = initialPost?.targets.find((x) => x.platform === p);
      out[p] = t
        ? { enabled: true, title: t.title ?? "", caption: t.caption ?? "", description: t.description ?? "", hashtags: t.hashtags ?? "", note: NOTES[p], reviewed: false }
        : emptyDraft(initialPost ? false : !!accounts[p] && live.includes(p));
    }
    if (initialPost && connected && (PLATFORMS as readonly string[]).includes(connected)) out[connected as Platform].enabled = true;
    return out;
  });
  const [copyLoading, setCopyLoading] = useState(false);
  const [rewriting, setRewriting] = useState<Platform | null>(null);

  /* ---------------- persistence ---------------- */
  const [postId, setPostId] = useState<string | null>(initialPost?.id ?? null);
  const postIdRef = useRef<string | null>(initialPost?.id ?? null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  /* ---------------- launch ---------------- */
  const [mode, setMode] = useState<"now" | "schedule">(initialPost?.status === "scheduled" ? "schedule" : "now");
  const [when, setWhen] = useState<Date>(() => (initialPost?.scheduledAt ? new Date(initialPost.scheduledAt) : defaultSchedule(tz)));
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "publishing" | "scheduled">(initialPost && LIVE.includes(initialPost.status) ? "publishing" : "edit");
  const [livePost, setLivePost] = useState<PostView | null>(initialPost && LIVE.includes(initialPost.status) ? initialPost : null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const meta = useMemo(
    () => ({ duration: media?.duration ?? localMeta?.duration ?? null, width: media?.width ?? localMeta?.width ?? null, height: media?.height ?? localMeta?.height ?? null, size: media?.size ?? fileRef.current?.size ?? null, mimeType: media?.mimeType ?? fileRef.current?.type ?? null }),
    [media, localMeta],
  );
  const src = localUrl ?? media?.url ?? null;
  const poster = localPoster ?? media?.thumbnailUrl ?? null;
  const hasMedia = !!(media || localUrl);

  /* ================= upload ================= */
  const startUpload = useCallback(
    async (file: File, objectUrl?: string) => {
      uploadAbort.current?.abort();
      const ctrl = new AbortController();
      uploadAbort.current = ctrl;
      fileRef.current = file;
      synced.current = null;
      posterBlob.current = null;
      setMedia(null);
      setLocalMeta(null);
      setLocalPoster((old) => (old && URL.revokeObjectURL(old), null));
      const url = objectUrl ?? URL.createObjectURL(file);
      setLocalUrl((old) => (old && old !== url && URL.revokeObjectURL(old), url));
      setUpload({ kind: "uploading", progress: 0 });
      setStep((s) => (s === "video" ? "story" : s));

      readVideo(url)
        .then((m) => {
          setLocalMeta({ duration: m.duration, width: m.width, height: m.height });
          if (m.poster) {
            posterBlob.current = m.poster;
            setLocalPoster(URL.createObjectURL(m.poster));
          }
        })
        .catch(() => {});

      try {
        const r = await uploadVideo<MediaView>(file, (p, eta) => setUpload({ kind: "uploading", progress: p, eta }), ctrl.signal);
        if (ctrl.signal.aborted) return;
        setMedia(r.media);
        setUpload({ kind: "done" });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setUpload({ kind: "failed", message: e instanceof ApiError ? e.message : "Something got in the way." });
      }
    },
    [],
  );

  /** Cancel in flight: abort the transfer, drop the local preview, back to an empty stage. */
  const cancelUpload = useCallback(() => {
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    fileRef.current = null;
    posterBlob.current = null;
    setMedia(null);
    setLocalMeta(null);
    setLocalPoster((old) => (old && URL.revokeObjectURL(old), null));
    setLocalUrl((old) => (old && URL.revokeObjectURL(old), null));
    setUpload({ kind: "idle" });
    setStep("video");
  }, []);

  // Browser-measured metadata + poster frame go up once both the upload and the read have finished.
  useEffect(() => {
    if (!media || !localMeta || synced.current === media.id) return;
    synced.current = media.id;
    (async () => {
      try {
        let m = (await api<{ media: MediaView }>(`/api/media/${media.id}`, { method: "PATCH", json: { duration: localMeta.duration || undefined, width: localMeta.width || undefined, height: localMeta.height || undefined } })).media;
        if (posterBlob.current) {
          m = (await api<{ media: MediaView }>(`/api/media/${media.id}/thumbnail`, { method: "PUT", body: posterBlob.current, headers: { "content-type": "image/jpeg" } })).media;
        }
        setMedia((cur) => (cur?.id === m.id ? { ...m, url: cur.url ?? m.url } : cur));
      } catch {
        /* metadata is a nicety; server-side probing covers it when available */
      }
    })();
  }, [media, localMeta]);

  useEffect(() => {
    const h = takeHandoff();
    if (h) startUpload(h.file, h.objectUrl);
    if (connected && (PLATFORMS as readonly string[]).includes(connected)) toast(`${PLATFORM_META[connected as Platform].name} is connected.`);
    if (connectError) toast("That connection didn't go through. Let's try again.", "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (upload.kind !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [upload.kind]);

  /* ================= hooks ================= */
  const fetchHooks = useCallback(
    async (tone: Tone, exclude: string[], text = submittedStory ?? story) => {
      setHooks((h) => ({ ...h, loading: true, error: null, tone }));
      try {
        const r = await api<HookResult>("/api/ai/hooks", { method: "POST", json: { story: text, tone, exclude } });
        seen.current = [...seen.current, ...r.hooks.map((x) => x.text)].slice(-30);
        setHooks({ loading: false, result: r, index: 0, tone, error: null });
      } catch (e) {
        setHooks((h) => ({ ...h, loading: false, error: e instanceof ApiError ? e.message : "I lost my train of thought. Let's try again." }));
      }
    },
    [story, submittedStory],
  );

  const submitStory = () => {
    const s = story.trim();
    setSubmittedStory(s);
    seen.current = [];
    fetchHooks("default", [], s);
  };

  const tryAnother = () => {
    const r = hooks.result;
    if (r && hooks.index < r.hooks.length - 1) setHooks((h) => ({ ...h, index: h.index + 1 }));
    else fetchHooks(hooks.tone, seen.current);
  };

  /* ================= platform copy ================= */
  const applyCopy = (items: PlatformCopy[]) =>
    setDrafts((d) => {
      const next = { ...d };
      for (const c of items) next[c.platform] = { ...next[c.platform], title: c.title ?? "", caption: c.caption ?? "", description: c.description ?? "", hashtags: c.hashtags ?? "", note: c.note, reviewed: false };
      return next;
    });

  const fetchCopy = useCallback(
    async (platforms: Platform[], h: string) => {
      if (!platforms.length) return;
      try {
        const r = await api<{ items: PlatformCopy[] }>("/api/ai/platform", { method: "POST", json: { story: submittedStory ?? story, hook: h, platforms } });
        applyCopy(r.items);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Couldn't write the copy just now. You can type your own.", "info");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story, submittedStory],
  );

  const chooseHook = async (text: string) => {
    setHook(text);
    setStep("everywhere");
    setCopyLoading(true);
    await fetchCopy(PLATFORMS.filter((p) => drafts[p].enabled), text);
    setCopyLoading(false);
  };

  const rewrite = async (p: Platform) => {
    if (!hook) return;
    setRewriting(p);
    await fetchCopy([p], hook);
    setRewriting(null);
  };

  // Resuming a draft (or coming back from connecting an account): fill any empty destination.
  useEffect(() => {
    if (!hook || phase !== "edit") return;
    const empty = PLATFORMS.filter((p) => drafts[p].enabled && !drafts[p].caption && !drafts[p].title && !drafts[p].description);
    if (empty.length) {
      setCopyLoading(true);
      fetchCopy(empty, hook).finally(() => setCopyLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDraft = (p: Platform, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [p]: { ...d[p], ...patch } }));
    if (patch.enabled && hook && !drafts[p].caption && !drafts[p].title) rewrite(p);
  };

  /* ================= saving ================= */
  const save = useCallback(() => {
    const run = async () => {
      if (!media || !hook) return postIdRef.current;
      setSaved("saving");
      try {
        const title = (drafts.youtube.enabled && drafts.youtube.title ? drafts.youtube.title.replace(/\s*#Shorts\s*$/i, "") : hook.split("\n")[0]).slice(0, 200);
        const r = await api<{ post: PostView }>("/api/posts", {
          method: "POST",
          json: {
            postId: postIdRef.current ?? undefined,
            mediaId: media.id,
            title,
            story: submittedStory ?? story,
            hook,
            targets: PLATFORMS.filter((p) => drafts[p].enabled).map((p) => ({ platform: p, title: drafts[p].title || null, caption: drafts[p].caption || null, description: drafts[p].description || null, hashtags: drafts[p].hashtags || null })),
          },
        });
        if (!postIdRef.current) {
          postIdRef.current = r.post.id;
          setPostId(r.post.id);
          window.history.replaceState(null, "", `/create?post=${r.post.id}`);
        }
        setSaved("saved");
        return r.post.id;
      } catch {
        setSaved("error");
        return postIdRef.current;
      }
    };
    const next = chain.current.then(run, run);
    chain.current = next;
    return next as Promise<string | null>;
  }, [media, hook, drafts, story, submittedStory]);

  useEffect(() => {
    if (!media || !hook || phase !== "edit" || copyLoading) return;
    const t = setTimeout(save, 900);
    return () => clearTimeout(t);
  }, [save, media, hook, phase, copyLoading]);

  const connect = async (p: Platform) => {
    const id = await save();
    window.location.href = `/api/accounts/${p}/connect?returnTo=${encodeURIComponent(id ? `/create?post=${id}&connected=${p}` : "/create")}`;
  };

  /* ================= launch ================= */
  const enabled = PLATFORMS.filter((p) => drafts[p].enabled);
  const allReviewed = enabled.length > 0 && enabled.every((p) => drafts[p].reviewed && accounts[p]?.status === "connected" && !blocking(checksFor(p, drafts[p], meta)));

  const launch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const id = await save();
      if (!id) throw new ApiError(400, "Your video is still coming in. Give it a second.");
      const r = await api<{ post: PostView }>(`/api/posts/${id}/launch`, { method: "POST", json: { mode, scheduledAt: mode === "schedule" ? when.toISOString() : undefined, confirmed: true } });
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

  const another = () => window.location.assign("/create");

  const reachable: Record<Step, boolean> = { video: true, story: hasMedia, everywhere: !!hook, launch: !!hook && allReviewed };

  /* ================= render ================= */
  if (phase !== "edit") {
    return (
      <div className="relative min-h-dvh overflow-hidden px-5 py-12 sm:px-10">
        <Glow />
        <div className="relative">
          {phase === "publishing" && livePost ? <PublishingView initial={livePost} onAnother={another} /> : <ScheduledView when={scheduledFor ?? when.toISOString()} tz={tz} poster={poster} onAnother={another} />}
        </div>
      </div>
    );
  }

  const assistant = (
    <Assistant
      step={step}
      hasMedia={hasMedia}
      upload={upload}
      meta={meta}
      story={story}
      onStory={setStory}
      submittedStory={submittedStory}
      onSubmitStory={submitStory}
      onEditStory={() => {
        setSubmittedStory(null);
        setHooks({ loading: false, result: null, index: 0, tone: "default", error: null });
      }}
      hooks={hooks}
      onTryAnother={tryAnother}
      onTone={(t) => fetchHooks(t, [])}
      onUse={chooseHook}
      onRepick={() => {
        setHook(null);
        setStep("story");
        if (!hooks.result && submittedStory) fetchHooks("default", [], submittedStory);
      }}
      chosenHook={hook && (hooks.result || step !== "story") ? hook : null}
      copyLoading={copyLoading}
      drafts={drafts}
      platforms={[...live]}
    />
  );

  const showVideo = step === "video" || step === "story";

  return (
    <div className="relative flex min-h-dvh gap-0">
      <Glow />
      <JourneyRail step={step} reachable={reachable} onGo={setStep} thumb={poster} title={hook?.split("\n")[0]} saved={saved} />

      <div className="relative min-w-0 flex-1">
        <JourneyBar step={step} reachable={reachable} onGo={setStep} />
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-16 pt-6 sm:px-8 lg:max-w-4xl lg:pt-8">
          {/* Steps animate in on mount. No exit choreography: a nested exit that never settles must not strand the next step. */}
            {showVideo && !hasMedia && (
              <motion.section key="drop" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} aria-labelledby="drop-title" className={`${createFont.variable} font-create flex flex-col items-center pt-2 sm:pt-4 lg:pt-10`}>
                <p className="step-pill mb-5">
                  <span className="step-pill-dot" aria-hidden="true" />
                  Step 1 of 4 <span className="text-muted-foreground/60" aria-hidden="true">·</span> <span className="text-muted-foreground">Your video</span>
                </p>
                <h1 id="drop-title" className="create-title text-balance text-center">
                  Let&apos;s start with{" "}
                  <span className="create-title-accent">
                    <span className="accent-serif energy-text">your video</span>
                    <svg className="create-swoosh" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                      <path d="M4 17 C 70 5, 150 4, 296 13" pathLength="1" />
                    </svg>
                  </span>
                </h1>
                <p className="mt-5 max-w-md text-balance text-center text-[clamp(.98rem,.9rem+.35vw,1.12rem)] leading-relaxed text-muted-foreground">
                  Drop one clip. We&apos;ll shape it for Reels, Shorts and X, and you approve every word.
                </p>
                <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="What works best">
                  {["MP4 or MOV", "Vertical 9:16 looks best", "Saves as you go"].map((t) => (
                    <li key={t} className="pf-chip">{t}</li>
                  ))}
                </ul>
                <div className="mt-8 w-full sm:mt-10">
                  <UploadZone compact onFile={(f) => startUpload(f)} />
                </div>
              </motion.section>
            )}

            {showVideo && hasMedia && (
              <motion.section key="stage" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 200, damping: 26 }} aria-label="Your video">
                <h1 className="sr-only">Create</h1>
                <VideoStage
                  src={src}
                  poster={poster}
                  filename={media?.filename ?? fileRef.current?.name}
                  meta={meta}
                  upload={upload}
                  onReplace={(f) => startUpload(f)}
                  onRetry={fileRef.current ? () => startUpload(fileRef.current!, localUrl ?? undefined) : undefined}
                  onCancel={cancelUpload}
                  onError={(m) => toast(m, "info")}
                />
                {(preCaption || (src && media && upload.kind === "done")) && (
                  <CaptionBurner
                    key={preCaption?.media.id ?? media?.id}
                    /* always the clean video, so the preview overlay and a re-burn never double the captions */
                    src={(preCaption ? preCaption.media.url : src) ?? src ?? ""}
                    filename={(preCaption?.media ?? media)?.filename ?? fileRef.current?.name ?? "video.mp4"}
                    duration={meta?.duration ?? 0}
                    onBurned={(f) => {
                      setPreCaption((p) => p ?? (media ? { media, file: fileRef.current } : null));
                      startUpload(f);
                      toast("Captions added. Uploading the captioned video…", "info");
                    }}
                    onUndo={
                      preCaption
                        ? () => {
                            const p = preCaption;
                            uploadAbort.current?.abort(); // a captioned upload still in flight must not land afterwards
                            setPreCaption(null);
                            fileRef.current = p.file;
                            synced.current = p.media.id;
                            setMedia(p.media);
                            setLocalMeta(null);
                            setLocalPoster(null);
                            setLocalUrl(null);
                            setUpload({ kind: "done" });
                          }
                        : undefined
                    }
                    onError={(m) => toast(m, "error")}
                  />
                )}
                <div className="glass mt-8 rounded-[28px] lg:hidden">{assistant}</div>
              </motion.section>
            )}

            {step === "everywhere" && (
              <motion.section key="deck" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ type: "spring", stiffness: 200, damping: 26 }}>
                <h1 className="sr-only">Make it fit everywhere</h1>
                <PlatformDeck
                  drafts={drafts}
                  onDraft={onDraft}
                  accounts={accounts}
                  media={{ src, poster, ...meta }}
                  loading={copyLoading}
                  rewriting={rewriting}
                  onRewrite={rewrite}
                  onConnect={connect}
                  onContinue={() => {
                    setStep("launch");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  hook={hook ?? ""}
                  onHook={(h) => setHook(h)}
                />
              </motion.section>
            )}

            {step === "launch" && (
              <motion.section key="launch" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 200, damping: 26 }}>
                <h1 className="sr-only">Launch</h1>
                {allReviewed ? (
                  <LaunchPanel drafts={drafts} accounts={accounts} poster={poster} hook={hook ?? ""} tz={tz} when={when} onWhen={setWhen} mode={mode} onMode={setMode} busy={launching} error={launchError} onLaunch={launch} onEdit={() => setStep("everywhere")} />
                ) : (
                  <div className="py-20 text-center">
                    <p className="text-lg">A couple of things still need a look first.</p>
                    <button type="button" onClick={() => setStep("everywhere")} className="mt-4 min-h-[44px] font-semibold underline underline-offset-4">
                      Back to the platforms
                    </button>
                  </div>
                )}
              </motion.section>
            )}
          {postId && <span className="sr-only" aria-live="polite">{saved === "saved" ? "Draft saved" : ""}</span>}
        </div>
      </div>

      <aside aria-label="AI assistant" className="sticky top-0 hidden h-dvh shrink-0 p-3 lg:block">
        <div className="glass h-full w-[332px] overflow-hidden rounded-[28px] xl:w-[372px]">{assistant}</div>
      </aside>
    </div>
  );
}

function Glow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="animate-morph absolute -left-40 -top-40 h-[520px] w-[520px] bg-lime opacity-[0.13] blur-[120px] dark:opacity-[0.1]" />
      <div className="animate-morph absolute -bottom-60 right-0 h-[480px] w-[480px] bg-accent opacity-[0.1] blur-[130px] [animation-delay:-6s]" />
    </div>
  );
}
