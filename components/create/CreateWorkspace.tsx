"use client";
import { whyLine } from "@/lib/ai/caption-engine";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ChevronDown, PanelRightClose, PanelRightOpen, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PostKindSwitch } from "./PostKindSwitch";
import { useToast } from "@/components/shared/Toast";
import { defaultSchedule } from "@/components/shared/DateTimePicker";
import { api, ApiError, offerUpgrade, streamApi } from "@/lib/client/api";
import { track } from "@/lib/analytics/track";
import { discardUpload, limitsProblem, loadUploadLimits, uploadVideo, type UploadLimits } from "@/lib/client/upload";
import { useOnline } from "@/lib/client/use-online";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { CaptionTrack } from "@/lib/captions/edit";
import { handoffBatch, takeHandoff, takeSharedFile, validateVideoFile } from "@/lib/client/handoff";
import { useRouter } from "next/navigation";
import { BULK_MAX } from "@/lib/posts/bulk";
import { PLATFORM_META, PLATFORMS, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useLivePlatforms } from "@/components/shell/LivePlatforms";
import { Assistant } from "./Assistant";
import { askProposal, captionFinal, captionSource, NO_SUGGESTIONS, PANEL_OPEN, panelReducer, PIP_PANEL_KEY, pipOpensOn, pipTarget, routeCopy, suggest, type PipFooterId, type SuggestAction, type Suggestions } from "./assistant-state";
import { StepProgress, stepIndex } from "./StepProgress";
import { UploadCard, UploadFileCard, uniqueFiles } from "./UploadCard";
import { SavedDrafts } from "./SavedDrafts";
import { createFont } from "./font";
import { LaunchPanel, ScheduledView, scheduleCheckLine, type ScheduleCheck } from "./LaunchPanel";
import { PlatformDeck } from "./PlatformDeck";
import { PublishingView } from "./PublishingView";
import { VideoStage } from "./VideoStage";
import { SaveDraft } from "./SaveDraft";
import { autosaveLine, draftTitle, enabledPlatforms, launchGate, launchPlan, pickedAccount, scheduleProblem, targetPayload } from "./publish";
import { CaptionBurner } from "./CaptionBurner";
import { CaptionRunProvider, TranscribeRun, useCaptionBurning, useCaptionRunLine, useCaptionTranscribing, useCaptionWorkspace } from "./captions/CaptionRun";
import { readFrames, readVideo } from "./frame";
import { primeGroove } from "./Groove";
import { ActionBar, barState, BURN_SEND, PreviewSheet, type BarId } from "./ActionBar";
import { legacyDraftCount, newDeviceId, openDrafts, type DeviceTarget } from "@/lib/client/device-drafts";
import { useDraftSync, type ServerDraft } from "@/lib/client/draft-sync";
import { classifySyncError } from "@/lib/client/draft-sync-core";
import { useUser } from "@/components/shell/UserContext";
import { SyncStatus } from "./SyncStatus";
import { ConflictDialog } from "./ConflictDialog";
import { emptyDraft, NOTES, type AccountView, type Draft, type Hook, type HookResult, type HooksState, NO_HOOKS, NO_WATCH, type MediaView, type PlatformCopy, type PostView, type Step, type Tone, type UploadState, type WatchState } from "./types";
import { StoryComposer } from "./StoryComposer";
import { FRESH, hasCopy, withEditState } from "./review-state";
import { VideoSubtitles } from "./VideoSubtitles";
import type { PipActionsProps } from "./PipActions";
import { ASK_KEYS, STORY_ASKS, type CaptionAsk, type PipAsk } from "@/lib/ai/pip-asks";
import { ADAPT_MAX, copyKey, firstSentence, isLongForm, LONG_FORM_SEC, timedTranscript, type AdaptTone } from "@/lib/ai/adapt-core";
import { T } from "@/lib/motion/tokens";

interface Props {
  accounts: AccountView[];
  /** 1162: every account this person may post to; where a platform has several, Everywhere offers the choice. */
  choices?: AccountView[];
  initialPost: PostView | null;
  tz: string;
  connected: string | null;
  connectError: string | null;
  /** Story to start from: shared text, or an idea from the idea bank */
  initialStory?: string | null;
  /** "1" = a video arrived from the share sheet; "missed" = it was shared but couldn't be kept */
  shared?: string | null;
  /** `?local=` : a draft kept in this browser to pick up (lib/client/device-drafts). */
  restoreLocal?: string | null;
  /** `?post=` that no longer exists on the server (an expired draft): look for a copy in this browser. */
  missingPostId?: string | null;
}

type Meta = { duration: number; width: number; height: number };
const ASSISTANT_PANEL = "create-assistant-panel";
const LIVE = ["publishing", "published", "partial", "failed"];
/** The older version's drafts are offered once per tab, not on every visit to Create. */
let legacyOffered = false;

export function CreateWorkspace({ accounts: accountList, choices: choiceList, initialPost, tz, connected, connectError, initialStory, shared, restoreLocal, missingPostId }: Props) {
  const toast = useToast();
  /** The account each platform falls back to: the one the post is pinned to, else the picked profile, else the default (1037). */
  const defaults = useMemo(() => Object.fromEntries(accountList.map((a) => [a.platform, a])) as Partial<Record<Platform, AccountView>>, [accountList]);
  const choices = useMemo(() => choiceList ?? accountList, [choiceList, accountList]);

  /* ---------------- video ---------------- */
  const [media, setMedia] = useState<MediaView | null>(initialPost?.media ?? null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localPoster, setLocalPoster] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<Meta | null>(null);
  const [upload, setUpload] = useState<UploadState>(initialPost ? { kind: "done" } : { kind: "idle" });
  const fileRef = useRef<File | null>(null);
  /** 1170: the upload was paused by the creator (so a save can say so rather than "add a video"). */
  const pausedRef = useRef(false);
  const justUploaded = useRef(false);
  const posterBlob = useRef<Blob | null>(null);
  const synced = useRef<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  /** Resolves with the stored media when the current upload lands, or null if it fails or is cancelled. Save, launch and connect wait on it. */
  const mediaReady = useRef<Promise<MediaView | null> | null>(null);
  const uploadFail = useRef<string | null>(null);
  /** The clean video, kept while a captioned copy is in use so "without captions" is one click (no re-upload). */
  const [preCaption, setPreCaption] = useState<{ media: MediaView; file: File | null } | null>(null);
  /** Why the file just picked was turned away (format, size or storage), before any upload started. */
  const [pickError, setPickError] = useState<string | null>(null);
  /** A replacement file waiting for "Replace video?" to be confirmed. */
  const [replacing, setReplacing] = useState<File | null>(null);
  /** 1170: the server's upload facts (formats, per-file cap, storage left) for Step 1's card; never made up. */
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [limitsFailed, setLimitsFailed] = useState(false);
  const router = useRouter();
  const [stopAsk, setStopAsk] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const online = useOnline();
  const user = useUser();
  const store = useMemo(() => openDrafts(user.id), [user.id]);
  const [conflict, setConflict] = useState<ServerDraft | null>(null);
  const [comparing, setComparing] = useState(false);
  /** Bumped when an older version's drafts move into this account, so the device drafts list reads them. */
  const [adopted, setAdopted] = useState(0);
  const baseRef = useRef<string | null>(initialPost?.updatedAt ?? null);
  /** The caption editor's track as it stands, kept with this browser's copy; and the one a restored copy brought back. */
  const captionsRef = useRef<CaptionTrack | null>(null);
  const [restoredTrack, setRestoredTrack] = useState<unknown>(null);

  /* ---------------- story + hooks ---------------- */
  const [step, setStep] = useState<Step>(() => {
    if (!initialPost) return "video";
    if (initialPost.status === "scheduled") return "launch";
    // R1209: a draft that has its main caption opens on Everywhere, where the platform captions are.
    if (initialPost.hook || initialPost.story?.trim()) return "everywhere";
    return "story";
  });
  const [story, setStory] = useState(initialPost?.story ?? initialStory ?? "");
  const [submittedStory, setSubmittedStory] = useState<string | null>(initialPost?.story ?? null);
  const [hooks, setHooks] = useState<HooksState>(NO_HOOKS);
  const seen = useRef<string[]>([]);
  // One writer at a time: asking again cancels the answer still coming (no stale hooks landing late).
  const hooksAbort = useRef<AbortController | null>(null);
  /* 1160: Pip watches the video as soon as it is added (frames read here from the file, so it does not wait on the
     upload) and offers the story; the creator uses it, edits it, or just types their own. Nothing is ever put in
     the box without a tap. */
  const [watch, setWatch] = useState<WatchState>(NO_WATCH);
  const watchAbort = useRef<AbortController | null>(null);
  /** The video Pip last watched (or tried to), so a failed watch can be asked again. */
  const watchUrl = useRef<string | null>(null);
  /** 1190: the creator asked for this watch, so a long video is read too. Set just before the call, used once. */
  const manualWatch = useRef(false);
  const submittedRef = useRef<string | null>(null);
  submittedRef.current = submittedStory;
  const copyAbort = useRef(new Map<string, AbortController>());
  const [copyWriting, setCopyWriting] = useState<Platform[]>([]);
  const [hook, setHook] = useState<string | null>(initialPost?.hook ?? null);
  /** The creator's own wording of the Original caption, once they have edited it. Everything the writer is asked for comes from here. */
  const [editedOriginal, setEditedOriginal] = useState<string | null>(null);

  /* ---------------- 1190 "Write once. Outlly adapts it everywhere." ---------------- */
  /** What Pip wrote for each place, kept beside the drafts so Pip's version is always one tap away. */
  const [adapted, setAdapted] = useState<Partial<Record<Platform, PlatformCopy>>>({});
  const adaptedRef = useRef(adapted);
  adaptedRef.current = adapted;
  const [adaptWriting, setAdaptWriting] = useState<Platform[]>([]);
  const [adapting, setAdapting] = useState(false);
  const [adaptTone, setAdaptTone] = useState<AdaptTone | null>(null);
  const adaptAbort = useRef<AbortController | null>(null);

  /* ---------------- platforms ---------------- */
  const live = useLivePlatforms();
  const [drafts, setDrafts] = useState<Record<Platform, Draft>>(() => {
    const out = {} as Record<Platform, Draft>;
    for (const p of PLATFORMS) {
      const t = initialPost?.targets.find((x) => x.platform === p);
      out[p] = t
        ? { enabled: true, title: t.title ?? "", caption: t.caption ?? "", description: t.description ?? "", hashtags: t.hashtags ?? "", firstComment: t.firstComment ?? "", note: NOTES[p], reviewed: false }
        : emptyDraft(initialPost ? false : !!defaults[p] && live.includes(p));
    }
    if (initialPost && connected && (PLATFORMS as readonly string[]).includes(connected)) out[connected as Platform].enabled = true;
    return out;
  });
  /* 1162: where a platform has several accounts, the one the creator picked on Everywhere (kept on the draft) stands in
     for the default everywhere the account is shown: the deck, the preview, the launch list. A pick that is no longer
     one of the choices (disconnected, or shared no more) falls back to the default, and is never sent. */
  const accounts = useMemo(() => {
    const out = { ...defaults };
    for (const p of PLATFORMS) {
      const a = pickedAccount(p, drafts[p].accountId, choices);
      if (a) out[p] = a;
    }
    return out;
  }, [defaults, choices, drafts]);
  const options = useMemo(() => {
    const out: Partial<Record<Platform, AccountView[]>> = {};
    for (const a of choices) {
      if (a.status !== "connected") continue;
      const p = a.platform as Platform;
      (out[p] ??= []).push(a);
    }
    for (const p of PLATFORMS) if ((out[p]?.length ?? 0) < 2) delete out[p];
    return out;
  }, [choices]);
  const [rewriting, setRewriting] = useState<Platform | null>(null);
  /** Phase 3 (B2F): Pip's suggestions wait here for Accept or Skip; what Accept replaced is kept for Revert. */
  const [sugg, setSugg] = useState<Suggestions>(NO_SUGGESTIONS);
  /** R1198: the place Pip's asks work on. Step 2: the one last touched; Step 3: the one open in the editor. */
  const [pipFocus, setPipFocus] = useState<Platform | null>(null);
  const [deckActive, setDeckActive] = useState<Platform | null>(null);
  /** R1206: Launch's Fix it opens Everywhere on that one platform; cleared once the creator leaves Everywhere. */
  const [deckOpen, setDeckOpen] = useState<Platform | null>(null);
  useEffect(() => {
    if (step !== "everywhere") setDeckOpen(null);
  }, [step]);
  /** R1198: one ask in flight at a time, so the same request is never sent twice. */
  const [asking, setAsking] = useState<{ p: Platform; ask: PipAsk } | null>(null);
  const askingRef = useRef(false);
  /** R1206: an ask on Your caption itself, and its answer waiting under the box to apply or skip. */
  const [captionAsk, setCaptionAsk] = useState<CaptionAsk | null>(null);
  const [captionProposal, setCaptionProposal] = useState<{ text: string; why: string; ask: CaptionAsk; from: string } | null>(null);
  /** R1198: on a phone the video preview above the editor folds away. */
  const [videoShut, setVideoShut] = useState(false);
  /** The drafts as last rendered, so copy that arrives mid-stream knows whether a draft already has words. */
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  /* ---------------- persistence ---------------- */
  const [postId, setPostId] = useState<string | null>(initialPost?.id ?? null);
  /** 1083: the creator's own cover image (stored on the post). */
  const [coverUrl, setCoverUrl] = useState<string | null>(initialPost?.coverUrl ?? null);
  const postIdRef = useRef<string | null>(initialPost?.id ?? null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  /** This draft's copy in the browser. Resolved on mount (an existing copy is adopted), then saved as you go. */
  const deviceId = useRef<string | null>(initialPost || restoreLocal || missingPostId ? null : newDeviceId());
  const [deviceReady, setDeviceReady] = useState(!initialPost && !restoreLocal && !missingPostId);

  /* ---------------- launch ---------------- */
  const [mode, setMode] = useState<"now" | "schedule">(initialPost?.status === "scheduled" ? "schedule" : "now");
  const [when, setWhen] = useState<Date>(() => (initialPost?.scheduledAt ? new Date(initialPost.scheduledAt) : defaultSchedule(tz)));
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  /** Why the time picked can't be booked, from Launch's live check; the bar's Schedule post waits on it. */
  const [scheduleIssue, setScheduleIssue] = useState<string | null>(null);
  const [phase, setPhase] = useState<"edit" | "publishing" | "scheduled">(initialPost && LIVE.includes(initialPost.status) ? "publishing" : "edit");
  const [livePost, setLivePost] = useState<PostView | null>(initialPost && LIVE.includes(initialPost.status) ? initialPost : null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [scheduledPost, setScheduledPost] = useState<PostView | null>(null);
  /** Phase 3: open or folded is the creator's choice and carries across every step, Launch included. */
  const [panel, panelDispatch] = useReducer(panelReducer, step, (s0: Step) => panelReducer(PANEL_OPEN, { t: "step", step: s0 }));
  useEffect(() => {
    panelDispatch({ t: "step", step });
  }, [step]);
  // 1170: Pip stays open or folded the way the creator left it, in this browser.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(PIP_PANEL_KEY);
      if (v === "closed" || v === "open") panelDispatch({ t: "set", open: v === "open" });
    } catch {
      /* private mode: Pip just starts open */
    }
  }, []);
  /** R1206: the creator's own fold, read straight from this browser. Pip never opens itself over one. */
  const pipFolded = () => {
    try {
      return window.localStorage.getItem(PIP_PANEL_KEY) === "closed";
    } catch {
      return false;
    }
  };
  const togglePanel = () => {
    const open = !panel.open;
    panelDispatch({ t: "toggle" });
    try {
      window.localStorage.setItem(PIP_PANEL_KEY, open ? "open" : "closed");
    } catch {
      /* not remembered, still toggles */
    }
  };
  /** 1170: the furthest step reached this session, so going back never un-does a step, and whether Your Story has been open. */
  const [furthest, setFurthest] = useState<Step>(step);
  const storySeen = stepIndex(furthest) >= stepIndex("story");
  useEffect(() => {
    setFurthest((f) => (stepIndex(step) > stepIndex(f) ? step : f));
  }, [step]);

  /* 1152: one player for the page. The caption editor seeks it, reads its time and draws its live preview on the
     canvas laid over it; while captions are on it shows the clean video so the overlay never doubles a burned copy. */
  const capVideo = useRef<HTMLVideoElement>(null);
  const capCanvas = useRef<HTMLCanvasElement>(null);
  const [capLive, setCapLive] = useState(false);
  const onCapLive = useCallback((on: boolean) => setCapLive(on), []);
  /* Phase 4: one caption store for the whole of /create. A transcribe, translate or burn keeps going when the
     editor unmounts on a step change; it stops on Stop, a new video, leaving /create, or a reload (the store asks
     before the tab closes). Its lines still land in the draft through onTrackChange. */
  const capStore = useCaptionWorkspace();
  const capLine = useCaptionRunLine(capStore);
  const capBurning = useCaptionBurning(capStore);
  const capTranscribing = useCaptionTranscribing(capStore);

  /* 1152: the assistant is a side panel from 1280px; below that the same element opens as a drawer (one instance,
     so the conversation survives a resize, a close and a reopen). */
  const [wide, setWide] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const drawerFrom = useRef<HTMLElement | null>(null);
  const drawerClose = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const f = () => setWide(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const sheet = drawer && !wide;
  const openDrawer = useCallback(() => {
    drawerFrom.current = document.activeElement as HTMLElement | null;
    setDrawer(true);
  }, []);
  /** 1182: the floating Pip button, where focus lands when Pip closes after opening by itself. */
  const pipFab = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setDrawer(false);
    requestAnimationFrame(() => (drawerFrom.current?.isConnected ? drawerFrom.current : pipFab.current)?.focus?.());
  }, []);
  useEffect(() => {
    if (wide) setDrawer(false);
  }, [wide]);
  /* 1182: entering Your Video or Your Story opens Pip until the caption is final. Only on entering a step, so a
     keystroke, an edit or a tab switch never opens or folds it; a draft being restored is waited for first. This
     is not the creator's own choice, so it is not written to this browser. */
  const pipStep = useRef<Step | null>(null);
  useEffect(() => {
    if (phase !== "edit") {
      pipStep.current = null;
      return;
    }
    if (!deviceReady || pipStep.current === step) return;
    pipStep.current = step;
    if (!pipOpensOn(step, captionFinal(hook))) return;
    // R1206: once Pip is folded it stays folded, on every step and every visit, until the creator opens it again.
    if (pipFolded()) return;
    if (window.matchMedia("(min-width: 1280px)").matches) panelDispatch({ t: "set", open: true });
    // R1198: on a phone Your Story keeps Pip as the card above the editor, so a sheet never covers the actions.
    else if (step !== "story") {
      drawerFrom.current = null;
      setDrawer(true);
    }
  }, [step, phase, hook, deviceReady]);
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => drawerClose.current?.focus());
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheet]);
  const onDrawerKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeDrawer();
      return;
    }
    if (e.key !== "Tab" || !drawerRef.current) return;
    // Keep Tab inside the open drawer.
    const f = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  };

  const meta = useMemo(
    () => ({ duration: media?.duration ?? localMeta?.duration ?? null, width: media?.width ?? localMeta?.width ?? null, height: media?.height ?? localMeta?.height ?? null, size: media?.size ?? fileRef.current?.size ?? null, mimeType: media?.mimeType ?? fileRef.current?.type ?? null }),
    [media, localMeta],
  );
  const src = localUrl ?? media?.url ?? null;
  const poster = localPoster ?? media?.thumbnailUrl ?? null;
  const hasMedia = !!(media || localUrl);
  /** 1190: over three minutes, or landscape. YouTube then gets a regular video's title and description, never #Shorts. */
  const longForm = isLongForm(meta);
  /** The places a caption is written for: switched on here, and live on Outlly. */
  const adaptPlaces = enabledPlatforms(drafts).filter((pl) => live.includes(pl));
  const someAdapted = adaptPlaces.some((pl) => adapted[pl]);
  /** R1209: the main caption from Your Story. Everywhere opens on it, and every platform's caption is written from it. */
  const caption = story.trim() || (submittedStory ?? "").trim();

  /* ================= Pip watches the video (1160) ================= */
  const watchVideo = useCallback(async (url: string) => {
    const manual = manualWatch.current;
    manualWatch.current = false;
    watchAbort.current?.abort();
    const ctrl = new AbortController();
    watchAbort.current = ctrl;
    watchUrl.current = url;
    setWatch({ kind: "watching" });
    try {
      const { frames, duration } = await readFrames(url, 4, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!frames.length) return setWatch(NO_WATCH);
      // 1190: a long video takes longer to read, so Pip only watches it when the creator asks.
      if (!manual && duration > LONG_FORM_SEC) return setWatch(NO_WATCH);
      const heard = captionsRef.current?.cues.map((c) => c.text.trim()).filter(Boolean).join("\n") || undefined;
      const r = await api<{ story?: string; seen?: string; skipped?: string }>("/api/ai/video-caption", { method: "POST", json: { frames, duration, transcript: heard, auto: true }, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      // A plan or quota stop stays quiet (the plan says so elsewhere); a busy AI is said out loud, with a retry (1174).
      const story = r.story?.trim();
      if (r.skipped === "busy" || (!r.skipped && !story)) return setWatch({ kind: "failed" });
      if (r.skipped || !story) return setWatch(NO_WATCH);
      setWatch({ kind: "ready", story, ...(r.seen?.trim() ? { seen: r.seen.trim() } : {}) });
    } catch {
      if (!ctrl.signal.aborted) setWatch({ kind: "failed" }); // the creator can always tell the story themselves
    } finally {
      if (watchAbort.current === ctrl) watchAbort.current = null;
    }
  }, []);
  const stopWatching = useCallback(() => {
    watchAbort.current?.abort();
    watchAbort.current = null;
    setWatch(NO_WATCH);
  }, []);
  const rewatch = useCallback(() => {
    manualWatch.current = true;
    if (watchUrl.current) void watchVideo(watchUrl.current);
  }, [watchVideo]);

  /* ================= upload ================= */
  const startUpload = useCallback(
    async (file: File, objectUrl?: string, resume?: { progress: number }) => {
      uploadAbort.current?.abort();
      // R1193: a different file takes over, so the old one's unfinished upload is dropped on the server too.
      if (fileRef.current && fileRef.current !== file) discardUpload(fileRef.current, { resumeKey: deviceId.current ?? undefined });
      const ctrl = new AbortController();
      uploadAbort.current = ctrl;
      fileRef.current = file;
      pausedRef.current = false;
      synced.current = null;
      setMedia(null);
      const url = objectUrl ?? URL.createObjectURL(file);
      setLocalUrl((old) => (old && old !== url && URL.revokeObjectURL(old), url));
      setUpload({ kind: "uploading", progress: resume?.progress ?? 0 });
      // 1170: Step 1 stays put while it uploads, with its own progress; Continue opens once the server has it.
      // Resuming the same file keeps its poster, length and Pip's read of it; only the transfer starts again.
      if (!resume) {
        posterBlob.current = null;
        setLocalMeta(null);
        setLocalPoster((old) => (old && URL.revokeObjectURL(old), null));
        // A story already sent stays the creator's; Pip only watches when the story is still to be told.
        if (submittedRef.current === null) void watchVideo(url);
        else stopWatching();
      }

      if (!resume) readVideo(url)
        .then((m) => {
          setLocalMeta({ duration: m.duration, width: m.width, height: m.height });
          if (m.poster) {
            posterBlob.current = m.poster;
            setLocalPoster(URL.createObjectURL(m.poster));
          }
        })
        .catch(() => {});

      uploadFail.current = null;
      const run = (async () => {
        try {
          const r = await uploadVideo<MediaView>(file, (p, eta, info) => { if (!ctrl.signal.aborted) setUpload({ kind: "uploading", progress: p, eta, info }); }, ctrl.signal, { resumeKey: deviceId.current ?? undefined });
          if (ctrl.signal.aborted) return null;
          setMedia(r.media);
          setUpload({ kind: "done" });
          justUploaded.current = true;
          return r.media;
        } catch (e) {
          if (ctrl.signal.aborted) return null;
          const message = !navigator.onLine ? "You're offline. It picks up again when you reconnect." : e instanceof ApiError ? e.message : "Something got in the way.";
          uploadFail.current = message;
          setUpload({ kind: "failed", message });
          // The card may be off screen by now (the creator can be on Your Story while it uploads), so say it out loud too.
          if (navigator.onLine) toast(`Your video didn't upload. ${message}`, "error");
          return null;
        }
      })();
      mediaReady.current = run;
      await run;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** A file from the drop zone or Replace: checked against the server's limits first, so a refusal costs nothing. */
  const pickFile = useCallback(
    async (file: File) => {
      setPickError(null);
      const lim = await loadUploadLimits().catch(() => null); // offline or unreachable: the upload says why itself
      const bad = lim && limitsProblem(file, lim);
      if (bad) {
        setPickError(bad.message);
        if (bad.kind === "storage" || bad.kind === "upload") offerUpgrade(bad.message, bad.kind);
        else toast(bad.message, "error");
        return;
      }
      void startUpload(file);
    },
    [startUpload, toast],
  );

  /** 1170: Pause stops the transfer but keeps the file; Resume (retryUpload) sends it again from what already landed. */
  const pauseUpload = useCallback(() => {
    if (upload.kind !== "uploading") return;
    const at = upload.progress;
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    mediaReady.current = null;
    pausedRef.current = true;
    setUpload({ kind: "paused", progress: at });
  }, [upload]);

  /** Resume the paused file. TUS and multipart pick up what already landed; a plain upload starts again and the bar shows it. */
  const resumeUpload = useCallback(() => {
    if (fileRef.current && upload.kind === "paused") void startUpload(fileRef.current, localUrl ?? undefined, { progress: upload.progress });
  }, [startUpload, localUrl, upload]);

  /** 1170: what Step 1's card hands over. One video uploads here; several go to the batch planner. */
  const takeFiles = useCallback(
    (files: File[]) => {
      const { files: list, dropped } = uniqueFiles(files);
      if (dropped) toast(dropped === 1 ? "That video was in there twice, so it's added once." : `${dropped} videos were in there twice, so each is added once.`, "info");
      if (list.length === 1) return void pickFile(list[0]);
      // A batch goes to connected places; with none yet, the first video still starts here.
      if (!accountList.some((a) => a.status === "connected")) {
        toast("Planning a batch needs a connected account. Starting with your first video for now.", "info");
        return void pickFile(list[0]);
      }
      if (list.length > BULK_MAX) toast(`A batch holds up to ${BULK_MAX} videos, so the first ${BULK_MAX} are in.`, "info");
      handoffBatch(list.slice(0, BULK_MAX)); // read once by the planner; a stale batch expires on its own
      router.push("/create/bulk");
    },
    [pickFile, router, toast, accountList],
  );

  /** Same file again; TUS and multipart pick up from what already landed. */
  const retryUpload = useCallback(() => {
    if (fileRef.current) void startUpload(fileRef.current, localUrl ?? undefined);
  }, [startUpload, localUrl]);

  /** Cancel in flight: abort the transfer, drop the local preview, back to an empty stage. */
  const cancelUpload = useCallback(() => {
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    // R1193: Cancel is for good. Pause keeps the upload; this forgets it here and drops its parts on the server.
    if (fileRef.current) discardUpload(fileRef.current, { resumeKey: deviceId.current ?? undefined });
    stopWatching();
    mediaReady.current = null;
    uploadFail.current = null;
    pausedRef.current = false;
    fileRef.current = null;
    posterBlob.current = null;
    setMedia(null);
    setLocalMeta(null);
    setLocalPoster((old) => (old && URL.revokeObjectURL(old), null));
    setLocalUrl((old) => (old && URL.revokeObjectURL(old), null));
    setUpload({ kind: "idle" });
    setStep("video");
    if (!postIdRef.current && deviceId.current) void store.remove(deviceId.current);
    if (window.location.search.includes("local=")) window.history.replaceState(null, "", "/create");
  }, [store]);

  // A transfer that failed because the connection went: start it again as soon as it is back.
  useEffect(() => {
    if (online && upload.kind === "failed" && fileRef.current && uploadFail.current?.startsWith("You're offline")) retryUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
    else if (shared === "1" && !initialPost)
      void takeSharedFile().then((f) => {
        if (!f) return toast("The shared video didn't come through. Pick it again below.", "info");
        const bad = validateVideoFile(f);
        if (bad) return toast(bad, "error");
        startUpload(f, URL.createObjectURL(f));
      });
    else if (shared === "missed") toast("The shared video didn't come through. Pick it again below.", "info");
    if (connected && (PLATFORMS as readonly string[]).includes(connected)) toast(`${PLATFORM_META[connected as Platform].name} is connected.`);
    if (connectError) toast("That connection didn't go through. Let's try again.", "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    loadUploadLimits().then(
      (l) => alive && setLimits(l),
      () => alive && setLimitsFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  // The copy in this browser: adopt it for a server draft, or bring a draft back from it.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialPost) {
        const found = await store.findByPost(initialPost.id);
        deviceId.current = found?.id ?? `p_${initialPost.id}`;
      } else if (restoreLocal || missingPostId) {
        const found = restoreLocal ? await store.get(restoreLocal) : await store.findByPost(missingPostId!).then((d) => (d ? store.get(d.id) : null));
        if (!alive) return;
        if (found?.draft.postId && restoreLocal) {
          // The server still has it: open that one, it is the fuller copy.
          const onServer = await api<{ post: PostView }>(`/api/posts/${found.draft.postId}`).catch(() => null);
          if (onServer) return window.location.replace(`/create?post=${onServer.post.id}`);
        }
        if (found) {
          const d = found.draft;
          deviceId.current = d.id;
          // The server copy is gone: the next sync makes a new draft instead of editing the missing one.
          if (d.postId) await store.update(d.id, { postId: null, baseUpdatedAt: null });
          baseRef.current = null;
          postIdRef.current = null;
          setPostId(null);
          setCoverUrl(null);
          window.history.replaceState(null, "", "/create");
          setStory(d.story);
          setCaptionProposal(null);
          setSubmittedStory(d.story || null);
          setRestoredTrack(d.captions ?? null);
          if (d.adapted && typeof d.adapted === "object") setAdapted(d.adapted as Partial<Record<Platform, PlatformCopy>>);
          setHook(d.hook);
          setDrafts((cur) => {
            const out = { ...cur };
            for (const p of PLATFORMS) {
              const t = d.targets[p];
              if (t) out[p] = { ...cur[p], ...t, note: NOTES[p], reviewed: false };
            }
            return out;
          });
          if (found.video) {
            void startUpload(found.video);
            setStep(d.hook || d.story?.trim() ? "everywhere" : "story");
            toast(missingPostId ? "That draft had expired on Outlly, so we brought it back from this device. Uploading the video again." : "Picked up where you left off. Uploading the video again.", "info");
          } else {
            setStep("video");
            toast("Your words are back. Add the video again to carry on.", "info");
          }
        } else {
          if (restoreLocal) window.history.replaceState(null, "", "/create");
          toast(missingPostId ? "That draft is gone. Drafts left untouched for 3 days are removed." : "That draft isn't on this device any more.", "info");
        }
      }
      deviceId.current ??= newDeviceId();
      if (alive) setDeviceReady(true);
      // An older version of Outlly kept drafts outside any account: offer them once a visit, never adopt them silently.
      if (!initialPost && !restoreLocal && !missingPostId && !legacyOffered) {
        const n = await legacyDraftCount();
        if (!alive || !n) return;
        legacyOffered = true;
        toast(`${n === 1 ? "1 draft" : `${n} drafts`} from an older version of Outlly ${n === 1 ? "is" : "are"} on this device. Anyone who used this browser may have made ${n === 1 ? "it" : "them"}.`, "info", {
          action: {
            label: n === 1 ? "It's mine, add it" : "They're mine, add them",
            onClick: () =>
              void store.adoptLegacy().then((moved) => {
                setAdopted((v) => v + 1);
                toast(moved ? `Added ${moved === 1 ? "1 draft" : `${moved} drafts`} to your drafts on this device.` : "Those drafts couldn't be moved. They're still on this device.", moved ? "ok" : "error");
              }),
          },
        });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one server writer while editing: every local save is followed by a sync of the same words.
  const sync = useDraftSync({
    userId: user.id,
    draftKey: deviceReady ? deviceId.current : null,
    postId,
    baseUpdatedAt: initialPost?.updatedAt ?? null,
    getPayload: () =>
      media && phase === "edit"
        ? { mediaId: media.id, title: draftTitle({ drafts, hook, filename: media.filename ?? fileRef.current?.name }), story: submittedStory ?? story, hook, targets: targetPayload(drafts, choices) }
        : null,
    onSynced: (p) => {
      baseRef.current = p.updatedAt;
      if (!postIdRef.current) {
        postIdRef.current = p.id;
        setPostId(p.id);
        window.history.replaceState(null, "", `/create?post=${p.id}`);
      }
      setSaved("saved");
      setSavedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
      if (p.recreated) toast("That draft was removed elsewhere, so we saved it again.", "info");
    },
    onGone: () => {
      postIdRef.current = null;
      baseRef.current = null;
      setPostId(null);
    },
    onConflict: (server) => {
      setConflict(server);
      setComparing(true);
    },
  });
  const keepServer = (server: ServerDraft) => {
    setStory(server.story ?? "");
    setCaptionProposal(null);
    setSubmittedStory(server.story || null);
    setHook(server.hook ?? null);
    setDrafts((cur) => {
      const out = { ...cur };
      for (const t of server.targets ?? []) {
        const p = t.platform as Platform;
        if (!out[p]) continue;
        out[p] = { ...out[p], enabled: t.enabled ?? out[p].enabled, title: t.title ?? "", caption: t.caption ?? "", description: t.description ?? "", hashtags: t.hashtags ?? "", firstComment: t.firstComment ?? "", reviewed: false };
      }
      return out;
    });
    baseRef.current = server.updatedAt;
    sync.resolveConflict("server", server);
  };

  // A video that just landed goes up as a draft straight away, not after the next keystroke.
  useEffect(() => {
    if (!media || !justUploaded.current) return;
    justUploaded.current = false;
    void sync.syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media]);

  // Save as you go, to this browser: words every change, the video once. Caption edits reach it through the ref,
  // so typing in the caption editor never re-renders the whole workspace.
  const writeLocal = useRef<() => void>(() => {});
  writeLocal.current = () => {
    if (!deviceReady || phase !== "edit" || !hasMedia || !deviceId.current) return;
    const id = deviceId.current;
    {
      const filename = media?.filename ?? fileRef.current?.name ?? null;
      const targets: Record<string, DeviceTarget> = {};
      for (const p of PLATFORMS) {
        const x = drafts[p];
        targets[p] = { enabled: x.enabled, title: x.title, caption: x.caption, description: x.description, hashtags: x.hashtags, firstComment: x.firstComment, accountId: x.accountId ?? null };
      }
      const schedule = { at: mode === "schedule" ? when.toISOString() : null, tz };
      const written = store
        .save({ id, postId, title: draftTitle({ drafts, hook, filename }), story: submittedStory ?? story, hook, targets, filename, poster: posterBlob.current, captions: captionsRef.current ?? undefined, adapted: adaptedRef.current, baseUpdatedAt: baseRef.current ?? undefined, schedule }, fileRef.current)
        .then((ok) => {
          // Not on Outlly yet: put this copy in the address, so a reload picks it straight back up.
          if (ok && !postIdRef.current && window.location.pathname === "/create" && !window.location.search) window.history.replaceState(null, "", `/create?local=${encodeURIComponent(id)}`);
          return ok;
        });
      sync.saveLocal(written);
    }
  };
  useEffect(() => {
    const t = setTimeout(() => writeLocal.current(), 700);
    return () => clearTimeout(t);
  }, [deviceReady, phase, hasMedia, postId, drafts, hook, story, submittedStory, media, localPoster, mode, when]);
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTrackChange = useCallback((t: CaptionTrack | null) => {
    captionsRef.current = t;
    clearTimeout(capTimer.current);
    capTimer.current = setTimeout(() => writeLocal.current(), 700);
  }, []);

  // A paused upload is lost on reload too (the file lives only in this tab), so it warns as well.
  useEffect(() => {
    if (upload.kind !== "uploading" && upload.kind !== "paused") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [upload.kind]);

  // 1170: a video let go anywhere on Create is never opened by the browser in place of the page (the upload card
  // takes drops itself while it shows; this covers the file card, a full storage card and the later steps).
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  /* ================= hooks ================= */
  const fetchHooks = useCallback(
    async (tone: Tone, exclude: string[], text = captionSource({ edited: editedOriginal, submittedStory, story })) => {
      if (!navigator.onLine) {
        setHooks((h) => ({ ...h, loading: false, more: false, status: "", error: "You're offline. Pip can write hooks again when you reconnect." }));
        return;
      }
      hooksAbort.current?.abort();
      const ctrl = new AbortController();
      hooksAbort.current = ctrl;
      setHooks((h) => ({ ...h, loading: true, more: true, status: "Reading your idea…", error: null, tone, index: 0 }));
      // Parts land as the model writes them: what it understood, the plain title, then each hook.
      let part: HookResult = { understood: "", insight: "", original: "", hooks: [], source: "gemini" };
      const show = (patch: Partial<HookResult>, status: string) => {
        part = { ...part, ...patch };
        const r = part;
        setHooks((h) => ({ ...h, loading: !r.hooks.length, status, result: r }));
      };
      try {
        const r = await streamApi<HookResult>(
          "/api/ai/hooks",
          { story: text, tone, exclude },
          (ev) => {
            if (ctrl.signal.aborted) return;
            if (ev.t === "understood") show({ understood: String(ev.text), insight: String(ev.insight ?? "") }, "Writing the first hook…");
            else if (ev.t === "original") show({ original: String(ev.text) }, part.hooks.length ? `Writing hook ${part.hooks.length + 1} of 3…` : "Writing the first hook…");
            else if (ev.t === "hook") show({ hooks: [...part.hooks, ev.hook as Hook] }, `Writing hook ${Math.min(part.hooks.length + 2, 3)} of 3…`);
          },
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        seen.current = [...seen.current, ...r.hooks.map((x) => x.text)].slice(-30);
        setHooks((h) => ({ loading: false, more: false, status: "", result: r, index: Math.min(h.index, Math.max(0, r.hooks.length - 1)), tone, error: null }));
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // Keep any hooks that already arrived; only say sorry when there is nothing to show.
        setHooks((h) => ({ ...h, loading: false, more: false, status: "", result: part.hooks.length ? { ...part, original: part.original || text } : h.result, error: part.hooks.length ? null : e instanceof ApiError ? e.message : "I lost my train of thought. Let's try again." }));
      } finally {
        if (hooksAbort.current === ctrl) hooksAbort.current = null;
      }
    },
    [story, submittedStory, editedOriginal],
  );

  const submitText = (s: string) => {
    stopWatching(); // the creator told it themselves; Pip's take is no longer needed
    setSubmittedStory(s);
    setEditedOriginal(null); // a new story gets a new Original to read
    seen.current = [];
    fetchHooks("default", [], s);
  };
  const submitStory = () => submitText(story.trim());
  /** 1160: Pip's story, taken as is (and sent on to the hook writer) or put in the box to edit first. */
  const useWatched = (edit: boolean) => {
    if (watch.kind !== "ready") return;
    const s = watch.story;
    setStory(s);
    setWatch(NO_WATCH);
    if (!edit) submitText(s);
  };

  const tryAnother = () => {
    const r = hooks.result;
    if (r && hooks.index < r.hooks.length - 1) setHooks((h) => ({ ...h, index: h.index + 1 }));
    else if (!hooks.more) fetchHooks(hooks.tone, seen.current); // the next one is still being written
  };

  /* ================= platform copy ================= */
  /** An empty draft is filled; one with words in it gets a suggestion to accept or skip, never an overwrite. */
  const applyCopy = (items: PlatformCopy[]) => {
    for (const c of items) {
      const r = routeCopy(draftsRef.current[c.platform], c, whyLine(c.why));
      if (r.kind === "fill") {
        draftsRef.current = { ...draftsRef.current, [c.platform]: { ...draftsRef.current[c.platform], ...r.patch } };
        setDrafts((d) => ({ ...d, [c.platform]: { ...d[c.platform], ...r.patch } }));
      } else if (r.kind === "propose") setSugg((s) => suggest(s, { t: "propose", p: c.platform, proposal: r.proposal }).state);
    }
  };

  const fetchCopy = useCallback(
    async (platforms: Platform[], h: string, intent: "write" | "rewrite" = "write") => {
      if (!platforms.length) return;
      if (!navigator.onLine) return toast("You're offline. Pip can write the copy when you reconnect, or type your own.", "info");
      if (askingRef.current) return toast("Pip is still answering your last ask. Try again in a moment.", "info");
      const key = [...platforms].sort().join(",");
      copyAbort.current.get(key)?.abort();
      const ctrl = new AbortController();
      copyAbort.current.set(key, ctrl);
      const left = new Set(platforms);
      const settle = (pl: Platform) => {
        left.delete(pl);
        setCopyWriting((w) => w.filter((x) => x !== pl));
      };
      setCopyWriting((w) => [...new Set([...w, ...platforms])]);
      try {
        // Each place's copy is shown the moment it is written, so the first card is ready in a second or two.
        const r = await streamApi<{ items: PlatformCopy[] }>(
          "/api/ai/platform",
          { story: captionSource({ edited: editedOriginal, submittedStory, story }), hook: h, platforms, intent },
          (ev) => {
            const item = ev.item as PlatformCopy | undefined;
            if (ev.t !== "item" || !item || ctrl.signal.aborted || !left.has(item.platform)) return;
            applyCopy([item]);
            settle(item.platform);
          },
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        // Only the places not yet shown: a caption already on screen may be under the creator's thumbs.
        applyCopy(r.items.filter((c) => left.has(c.platform)));
      } catch (e) {
        if (ctrl.signal.aborted) return;
        toast(e instanceof ApiError ? e.message : "Couldn't write the copy just now. You can type your own.", "info");
      } finally {
        if (copyAbort.current.get(key) === ctrl) {
          copyAbort.current.delete(key);
          [...left].forEach(settle);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [story, submittedStory, editedOriginal],
  );

  /* ================= 1190 "Write once. Outlly adapts it everywhere." ================= */
  /** Pip's words for one place, straight into the draft. Used where the creator asked for exactly that. */
  const fillAdapted = (c: PlatformCopy) => {
    // R1198: new words are looked at again before Launch, and a suggestion for the old words no longer applies.
    // R1209: Pip's fresh words read Needs review, whatever the place said before.
    const patch: Partial<Draft> = { title: c.title ?? "", caption: c.caption ?? "", description: c.description ?? "", hashtags: c.hashtags ?? "", note: c.note, why: whyLine(c.why), ...FRESH };
    setSugg((s) => (s.proposals[c.platform] ? suggest(s, { t: "reject", p: c.platform }).state : s));
    draftsRef.current = { ...draftsRef.current, [c.platform]: { ...draftsRef.current[c.platform], ...patch } };
    setDrafts((d) => ({ ...d, [c.platform]: { ...d[c.platform], ...patch } }));
  };
  /** Still Pip's words, or the creator's own now? Only then may a new version be written straight in. */
  const untouched = (pl: Platform) => {
    const c = adaptedRef.current[pl];
    const d = draftsRef.current[pl];
    return !!c && copyKey(d) === copyKey({ title: c.title ?? "", caption: c.caption, description: c.description ?? "", hashtags: c.hashtags });
  };
  const restoreAdapted = (pl: Platform) => {
    const c = adaptedRef.current[pl];
    if (!c) return;
    fillAdapted(c);
    toast(`${PLATFORM_META[pl].name} is back to Pip's version.`, "ok");
  };
  const stopAdapt = () => {
    adaptAbort.current?.abort();
    adaptAbort.current = null;
    setAdapting(false);
    setAdaptWriting([]);
  };
  /**
   * One message in, one caption per place out, each shown the moment it is written. The creator's words are the
   * only source. A place they have edited themselves gets a proposal to accept or skip, never an overwrite; a
   * place still holding Pip's own last version is simply written again.
   */
  const adapt = async (platforms: Platform[], o: { fresh?: boolean; tone?: AdaptTone; direct?: boolean; update?: boolean } = {}) => {
    const text = caption;
    if (!text) return;
    if (!platforms.length) return toast("Pick at least one place to post to first.", "info");
    if (!navigator.onLine) return toast("You're offline. Pip can write the captions when you reconnect, or you can write your own.", "info");
    if (askingRef.current) return toast("Pip is still answering your last ask. Try again in a moment.", "info");
    adaptAbort.current?.abort();
    const ctrl = new AbortController();
    adaptAbort.current = ctrl;
    const left = new Set(platforms);
    setAdapting(true);
    setAdaptWriting(platforms);
    if (!o.direct) setAdaptTone(o.tone ?? null);
    const take = (c: PlatformCopy | undefined) => {
      if (!c || !left.has(c.platform)) return;
      left.delete(c.platform);
      setAdaptWriting((w) => w.filter((x) => x !== c.platform));
      // R1198: written straight in only where the words are still Pip's or there are none; an edit gets a suggestion.
      const d0 = draftsRef.current[c.platform];
      const fill = untouched(c.platform) || !(d0.title + d0.caption + d0.description).trim();
      setAdapted((a) => ({ ...a, [c.platform]: c }));
      adaptedRef.current = { ...adaptedRef.current, [c.platform]: c };
      if (fill) fillAdapted(c);
      else applyCopy([c]);
    };
    const transcript = longForm ? timedTranscript(captionsRef.current?.cues) : "";
    try {
      const r = await streamApi<{ core?: string; items?: PlatformCopy[]; clarify?: string }>(
        "/api/ai/adapt",
        { text, platforms, longForm, duration: meta.duration, seen: watch.kind === "ready" ? watch.seen : undefined, transcript: transcript || undefined, tone: o.tone, fresh: o.fresh, noClarify: true },
        (ev) => {
          if (ctrl.signal.aborted) return;
          // The message in one line stands in as the draft's hook, so Everywhere and Launch open as they always did.
          if (ev.t === "core" && typeof ev.core === "string" && ev.core.trim()) setHook(ev.core.trim());
          else if (ev.t === "item") take(ev.item as PlatformCopy | undefined);
        },
        { signal: ctrl.signal, timeoutMs: 45_000 },
      );
      if (ctrl.signal.aborted) return;
      // R1209: Your Story has no question card any more, so the writer is asked to write; a question is only a note.
      if (r.clarify) return toast(r.clarify, "info");
      (r.items ?? []).forEach(take);
      if (r.core?.trim()) setHook(r.core.trim());
      setSubmittedStory(text);
      setEditedOriginal(null);
      // R1206: one compact confirmation, then straight into reviewing the platform results. A single row's
      // Regenerate is direct and says nothing: the row itself shows what changed.
      if (!o.direct) {
        const wrote = platforms.length - left.size;
        // R1206: updating some of them after the caption changed says which, and that the rest kept their words.
        const rest = o.update ? adaptPlaces.filter((x) => !platforms.includes(x)).length : 0;
        if (wrote > 0 && rest > 0) {
          toast(`${wrote === 1 ? PLATFORM_META[platforms.find((x) => !left.has(x)) ?? platforms[0]].name : `${wrote} platforms`} updated from your new caption. The other ${rest === 1 ? "one keeps its" : `${rest} keep their`} words. Have a read.`, "ok");
          requestAnimationFrame(() => document.getElementById("adapted-captions")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
        } else if (wrote > 0) {
          toast(wrote === platforms.length ? (wrote === 1 ? "Your caption is ready for 1 platform. Have a read." : `Your caption is ready for all ${wrote} platforms. Have a read.`) : `Your caption is ready for ${wrote} of ${platforms.length} platforms. Have a read.`, "ok");
          requestAnimationFrame(() => document.getElementById("adapted-captions")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      toast(e instanceof ApiError ? e.message : "Couldn't write the captions just now. Your words are saved, so you can try again.", "info");
    } finally {
      if (adaptAbort.current === ctrl) {
        adaptAbort.current = null;
        setAdapting(false);
        setAdaptWriting([]);
      }
    }
  };
  /** The video is read only when asked for (1190), from the file in this tab or the one already uploaded. */
  const analyze = () => {
    const url = watchUrl.current ?? localUrl ?? media?.url ?? null;
    if (!url) return toast("Add your video first.", "info");
    manualWatch.current = true;
    void watchVideo(url);
  };

  const chooseHook = async (text: string) => {
    setHook(text);
    // R1209: Pip's finalized words are the main caption when the box is empty; Everywhere writes every platform from it.
    if (!story.trim()) setStory(text);
    setStep("everywhere");
  };
  /** 1182: Pip open or folded on wide screens, remembered in this browser like the panel's own button. */
  const setPip = (open: boolean) => {
    panelDispatch({ t: "set", open });
    try {
      window.localStorage.setItem(PIP_PANEL_KEY, open ? "open" : "closed");
    } catch {
      /* not remembered, still folds */
    }
  };
  /** 1182: Close and the X only fold Pip. Nothing is finalized, saved over or sent. */
  const closePip = () => (wide ? setPip(false) : closeDrawer());
  /**
   * 1182: Finalize caption picks the hook through the same chooseHook as the page (Everywhere opens with it and
   * the draft saves it), then folds Pip. The floating Pip button, or the panel button on wide screens, brings it back.
   */
  const finalizeCaption = async (text: string) => {
    if (!text.trim()) return;
    if (wide) setPip(false);
    else {
      drawerFrom.current = null;
      closeDrawer();
    }
    toast("Caption finalized. Pip is folded away; open it again any time.", "ok");
    await chooseHook(text);
  };

  const rewrite = async (p: Platform) => {
    // R1209: Everywhere can open on the caption alone, before Pip has put the message in one line.
    const h = hook || firstSentence(caption, 160);
    if (!h) return;
    setRewriting(p);
    // Rewriting words already there is caption rewriting; filling an empty place is writing captions.
    const d = draftsRef.current[p];
    await fetchCopy([p], h, d.caption || d.title || d.description ? "rewrite" : "write");
    setRewriting(null);
  };

  /** R1198: one of Pip's asks for one place. The answer is always a suggestion to accept or skip, never written in. */
  const askPip = async (pl: Platform, ask: PipAsk) => {
    if (askingRef.current) return;
    if (!navigator.onLine) return toast("You're offline. Pip can help as soon as you reconnect.", "info");
    if (adaptAbort.current || copyWriting.includes(pl) || rewriting === pl) return toast(`Pip is still writing ${PLATFORM_META[pl].name}. Try again in a moment.`, "info");
    const d = draftsRef.current[pl];
    // On Your Story the box is the source as it stands now, typed-but-not-regenerated words included.
    const source = ((step === "story" ? story.trim() : "") || captionSource({ edited: editedOriginal, submittedStory, story }) || "").trim();
    const base = source.length >= 3 ? source : (d.caption || d.description || d.title).trim();
    if (base.length < 3) return toast("Write a sentence or two first, then Pip can help.", "info");
    const h = hook && hook.trim().length >= 3 ? hook.trim() : firstSentence(base, 160);
    askingRef.current = true;
    setAsking({ p: pl, ask });
    setPipFocus(pl);
    try {
      const r = await api<{ items: PlatformCopy[] }>("/api/ai/platform", {
        method: "POST",
        json: { story: base.slice(0, 4000), hook: (h.length >= 3 ? h : base).slice(0, 500), platforms: [pl], ask, current: { title: d.title.slice(0, 400), caption: d.caption.slice(0, 6000), description: d.description.slice(0, 6000), hashtags: d.hashtags.slice(0, 1200) } },
      });
      const item = r.items?.[0];
      const proposal = item ? askProposal(draftsRef.current[pl], item, ASK_KEYS[ask], whyLine(item.why)) : null;
      if (proposal) setSugg((s) => suggest(s, { t: "propose", p: pl, proposal }).state);
      else toast(`Pip didn't find a better version for ${PLATFORM_META[pl].name}. Your words are unchanged.`, "info");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Pip couldn't do that just now. Your words are unchanged.", "info");
    } finally {
      askingRef.current = false;
      setAsking(null);
    }
  };

  /**
   * R1206: one of Pip's asks on Your caption, the words every platform's version is written from. The answer is
   * a suggestion under the box; nothing changes until the creator applies it, and then "Update" rewrites the
   * platforms from the new words.
   */
  const askCaption = async (ask: CaptionAsk) => {
    if (askingRef.current) return;
    if (!navigator.onLine) return toast("You're offline. Pip can help as soon as you reconnect.", "info");
    if (adaptAbort.current) return toast("Pip is still writing your platform captions. Try again in a moment.", "info");
    const from = story;
    const text = from.trim();
    if (text.length < 3) return toast("Write a sentence or two first, then Pip can help.", "info");
    askingRef.current = true;
    setCaptionAsk(ask);
    try {
      const r = await api<{ text: string; why: string }>("/api/ai/caption", { method: "POST", json: { text: text.slice(0, 4000), ask } });
      const next = (r.text ?? "").trim().slice(0, ADAPT_MAX);
      if (!next || next === text) toast("Pip didn't find a better version. Your caption is unchanged.", "info");
      else setCaptionProposal({ text: next, why: (r.why ?? "").trim(), ask, from });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Pip couldn't do that just now. Your caption is unchanged.", "info");
    } finally {
      askingRef.current = false;
      setCaptionAsk(null);
    }
  };

  /* R1209: Everywhere is where each platform's caption is written. On the way in (a resumed draft and coming back
     from connecting an account included) Pip writes every place still without words; a caption changed on Your
     Story is written again for them all (a place the creator edited gets a suggestion, never an overwrite). A
     place switched on here is written the same way. Each try is made once per caption and set of places, so a
     failure waits for Regenerate instead of looping. */
  const adaptTried = useRef("");
  const placesKey = adaptPlaces.join(",");
  useEffect(() => {
    if (step !== "everywhere" || phase !== "edit") {
      adaptTried.current = "";
      return;
    }
    // Pip answering another ask would turn this write away, so wait for it rather than spend the one try.
    if (!caption || online === false || adapting || asking || captionAsk) return;
    const changed = submittedStory != null && caption !== submittedStory.trim();
    const todo = changed ? adaptPlaces : adaptPlaces.filter((pl) => !hasCopy(draftsRef.current[pl]) && !adaptedRef.current[pl]);
    if (!todo.length) return;
    const key = `${caption}|${todo.join(",")}`;
    if (adaptTried.current === key) return;
    adaptTried.current = key;
    void adapt(todo, { direct: !changed && someAdapted, tone: adaptTone ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phase, caption, online, adapting, placesKey, asking, captionAsk]);

  /** R1209: typing marks a caption Edited, or takes its approval back; Pip's own writes and Approve say so themselves. */
  const onDraft = (p: Platform, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [p]: { ...d[p], ...withEditState(d[p], patch) } }));
  };

  const onSuggest = (a: SuggestAction) => {
    const r = suggest(sugg, a);
    setSugg(r.state);
    if (r.apply) onDraft(a.p, r.apply);
  };

  /* ================= saving ================= */
  const save = useCallback(
    (opts?: { force?: boolean; strict?: boolean }) => {
      // Every local change made so far is in the words this save sends; one typed after this goes up next.
      const upTo = sync.version();
      const run = async () => {
        // Autosave still waits for a hook; an explicit save only needs the video, and names the draft itself.
        if (!hook && !opts?.force) return postIdRef.current;
        let m = media;
        if (!m && mediaReady.current) {
          if (opts?.force) setSaved("saving");
          m = await mediaReady.current; // still uploading: wait for it instead of giving up
        }
        if (!m) {
          if (!opts?.force) return postIdRef.current;
          setSaved("error");
          const why = uploadFail.current
            ? `Your video didn't upload (${uploadFail.current.replace(/\.$/, "")}). Tap "Let's try again" on the video, then save.`
            : pausedRef.current
              ? "Your upload is paused. Resume it, then save."
              : "Add a video first, then save.";
          if (opts?.strict) throw new ApiError(400, why);
          toast(why, "error");
          return postIdRef.current;
        }
        setSaved("saving");
        try {
          // A new draft may only exist on this device: sync creates it (once, by clientKey) so this saves into the same one.
          if (!postIdRef.current) await sync.syncNow();
          const title = draftTitle({ drafts, hook, filename: m.filename ?? fileRef.current?.name });
          // The background sync waits while this save is out, so the two never overwrite each other.
          const r = await sync.exclusive(async () => {
            const r = await api<{ post: PostView }>("/api/posts", {
              method: "POST",
              json: {
                postId: postIdRef.current ?? undefined,
                mediaId: m.id,
                title,
                story: submittedStory ?? story,
                hook,
                targets: targetPayload(drafts, choices),
                baseUpdatedAt: postIdRef.current ? baseRef.current ?? undefined : undefined,
              },
            });
            baseRef.current = r.post.updatedAt;
            sync.markSynced({ id: r.post.id, updatedAt: r.post.updatedAt }, upTo);
            return r;
          });
          if (!postIdRef.current) {
            postIdRef.current = r.post.id;
            setPostId(r.post.id);
            window.history.replaceState(null, "", `/create?post=${r.post.id}`);
          }
          setSaved("saved");
          setSavedAt(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
          return r.post.id;
        } catch (e) {
          setSaved("error");
          const c = classifySyncError(e);
          if (c.kind === "conflict" && c.server) {
            setConflict(c.server as ServerDraft);
            setComparing(true);
          }
          if (opts?.strict) throw e;
          if (opts?.force) toast(e instanceof ApiError ? `Couldn't save the draft. ${e.message}` : "Couldn't save the draft. Check your connection and try again.", "error");
          return postIdRef.current;
        }
      };
      const next = chain.current.then(run, run);
      chain.current = next;
      return next as Promise<string | null>;
    },
    [media, hook, drafts, story, submittedStory, sync.markSynced, sync.syncNow, sync.version, sync.exclusive],
  );

  /** The Save draft button: immediate, works without a hook, and says where the draft went. */
  const saveDraftNow = useCallback(async () => {
    // Mid-upload this waits for the video to land, then saves.
    if (!media && upload.kind === "uploading") toast("Saving as soon as your video finishes uploading.", "info");
    const id = await save({ force: true });
    if (id) toast("Saved to Drafts. Find it under Content.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, save, upload.kind]);

  const connect = async (p: Platform) => {
    if (!navigator.onLine) return toast("You're offline. Connect it when you're back online.", "info");
    // Leaving the page kills an upload in flight, so let it land and save first.
    if (!media && upload.kind === "uploading") toast("Finishing your upload first, then we'll connect.", "info");
    const id = await save({ force: !!(media || mediaReady.current) });
    window.location.href = `/api/accounts/${p}/connect?returnTo=${encodeURIComponent(id ? `/create?post=${id}&connected=${p}` : "/create")}`;
  };

  /* ================= launch ================= */
  // A place with a Pip suggestion still waiting is not settled, so it holds until accepted or rejected.
  const proposed = Object.keys(sugg.proposals) as Platform[];
  const { enabled, pending, ready: allReviewed } = launchGate(drafts, accounts, meta, proposed);
  // Who really gets it: a held place (not connected, not looked over, failing a check) is never sent.
  const plan = launchPlan(drafts, accounts, meta, proposed);

  const launch = async (how: "now" | "schedule" = mode) => {
    if (!navigator.onLine) return setLaunchError("You're offline. Publishing and scheduling come back when you reconnect.");
    if (plan.hold.length || !plan.send.length) return setLaunchError("Some places aren't ready yet. Leave them out or fix them in Everywhere.");
    if (capStore.getState().busy?.kind === "burn") return setLaunchError(BURN_SEND);
    if (how === "schedule") {
      const bad = scheduleProblem(when);
      if (bad) return setLaunchError(bad);
    }
    // Still inside the click: unlock the publishing screen's music before the save + launch round trips.
    if (how === "now") primeGroove();
    setLaunching(true);
    setLaunchError(null);
    try {
      const id = await save({ force: true, strict: true });
      if (!id) throw new ApiError(400, "Add a video first.");
      if (how === "schedule") {
        // A dry run of the booking rules, so a clash or a platform limit shows before anything is booked.
        // If the check itself can't be reached, carry on: the launch route enforces the same rules.
        const check = await api<ScheduleCheck>(`/api/posts/${id}/check?at=${encodeURIComponent(when.toISOString())}`).catch(() => null);
        const stop = scheduleCheckLine(check);
        if (stop) return setLaunchError(stop);
      }
      const r = await api<{ post: PostView }>(`/api/posts/${id}/launch`, { method: "POST", json: { mode: how, scheduledAt: how === "schedule" ? when.toISOString() : undefined, confirmed: true } });
      track(how === "schedule" ? "post_scheduled" : "post_published", { kind: "video" });
      if (deviceId.current) void store.remove(deviceId.current); // it's out (or booked): no copy to keep
      if (how === "now") {
        setLivePost(r.post);
        setPhase("publishing");
      } else {
        setScheduledFor(r.post.scheduledAt ?? when.toISOString());
        setScheduledPost(r.post);
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
  /* 1162: Start over from any step. What is here is kept as a draft first (this browser, then Outlly when the video
     is up and we are online), and a clean Create opens. With no video there is nothing to keep, so it just opens. */
  const [overAsk, setOverAsk] = useState(false);
  const [overBusy, setOverBusy] = useState(false);
  const startOver = async () => {
    setOverBusy(true);
    try {
      if (hasMedia) {
        if (upload.kind === "uploading" && mediaReady.current) await mediaReady.current;
        writeLocal.current();
        await sync.syncNow();
      }
    } catch {
      /* the local copy is already written; the server copy follows next time */
    }
    another();
  };
  const startOverButton = (
    <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs font-semibold" onClick={() => (hasMedia ? setOverAsk(true) : another())} disabled={overBusy || phase !== "edit"}>
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Start over
    </Button>
  );

  const syncLine = <SyncStatus status={sync.status} lastSyncedAt={sync.lastSyncedAt} error={sync.error} needsMedia={sync.needsMedia} storedHere={sync.storedHere} onRetry={sync.retry} onResolve={conflict ? () => setComparing(true) : undefined} />;
  const bar = barState({ online, hasMedia, uploadFailed: upload.kind === "failed", hasCaption: !!caption, ready: allReviewed, enabledCount: enabled.length, launching, saving: saved === "saving", step, mode, targets: plan.send, pending: pending.map((p) => PLATFORM_META[p].name), scheduleIssue, hasDraft: !!(postId || savedAt), activity: capLine, burning: capBurning, upload: upload.kind, progress: upload.kind === "uploading" || upload.kind === "paused" ? upload.progress : undefined, storySeen });
  const onGo = (s: Step) => setStep(s);
  const goTo = (s: Step, before?: () => void) => {
    before?.();
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  /** R1206: from Launch's list, straight to the one platform that needs it, saying what to do there. */
  const fixOnDeck = (pl: Platform) => {
    const why = plan.hold.find((h) => h.platform === pl)?.reason;
    goTo("everywhere", () => {
      setDeckOpen(pl);
      if (why) toast(`${PLATFORM_META[pl].name}: ${why} ${why === "Not approved yet." ? "Read it, then approve it." : why === "A suggestion is waiting." ? "Accept it or skip it." : "Fix it here, then come back."}`, "info");
    });
  };
  /** Steps 1 and 2: Schedule and Publish take you to Launch with that choice made. Nothing is sent from there. */
  const toLaunch = (how: "now" | "schedule") => goTo("launch", () => setMode(how));
  const onBar = (id: BarId) => {
    if (id === "save") return void saveDraftNow();
    if (id === "preview") {
      capVideo.current?.pause();
      return setPreviewing(true);
    }
    // Phase 4: one Continue on every step, to the step after this one.
    if (id === "continue") return goTo(step === "video" ? "story" : step === "story" ? "everywhere" : "launch");
    if (id === "back") return goTo("everywhere");
    if (id === "mode") return setMode((m) => (m === "now" ? "schedule" : "now"));
    if (id === "schedule") return toLaunch("schedule");
    // Publish: on Launch this is the one button that sends or books; before that it only moves you there.
    if (step === "launch") return void launch(mode);
    toLaunch("now");
  };

  /** 1170: Your Story opens once the server has the video (or it was open before and a new one is coming in). */
  const storyOpen = hasMedia && (upload.kind === "done" || (storySeen && upload.kind === "uploading"));
  // A paused or failed upload closes every later step, not just Your Story: nothing can be sent without the video.
  // R1209: Everywhere opens on the main caption (not a hook), and Launch once every platform caption is approved.
  const reachable: Record<Step, boolean> = { video: true, story: storyOpen, everywhere: storyOpen && !!caption, launch: storyOpen && !!caption && allReviewed };
  const mediaWhy = !hasMedia ? "Add a video first." : upload.kind === "failed" ? "Your video didn't upload. Try it again first." : upload.kind === "paused" ? "Your upload is paused. Resume it first." : upload.kind === "uploading" && !storyOpen ? "Your video is still uploading. Your Story opens once it's in." : undefined;
  const blocked: Partial<Record<Step, string>> = {
    story: mediaWhy,
    everywhere: mediaWhy ?? (!caption ? "Write your caption on Your Story first." : undefined),
    launch: mediaWhy ?? (!caption ? "Write your caption on Your Story first." : !allReviewed ? "Approve each platform caption on Everywhere first." : undefined),
  };
  /** 1182: the lit button at the foot of Pip runs the page's own move for this step, behind the page's own checks. */
  const onPipFooter = (id: PipFooterId) => {
    if (id === "story") return void (reachable.story && goTo("story"));
    if (id === "done") return closePip();
    if (id === "everywhere" && !reachable.everywhere) return;
    if (!wide) closeDrawer();
    goTo("everywhere");
  };

  /* ================= render ================= */
  if (phase !== "edit") {
    // Same root and rail position as the editor below, so React keeps the rail mounted (no remount, no flash).
    return (
      <CaptionRunProvider value={capStore}>
      <div className="relative flex gap-0 lg:min-h-dvh">
        <Glow />
        <div className="relative min-w-0 flex-1 overflow-hidden px-[var(--frame-gutter)] pb-12 pt-4">
          <StepProgress step="launch" complete reachable={SENT_REACHABLE} onGo={noGo} className="page-frame relative mb-8 px-0" />
          <div className="page-frame relative px-0">
            {phase === "publishing" && livePost ? <PublishingView initial={livePost} onAnother={another} /> : <ScheduledView post={scheduledPost} when={scheduledFor ?? when.toISOString()} tz={tz} poster={poster} onAnother={another} />}
          </div>
        </div>
      </div>
      </CaptionRunProvider>
    );
  }

  /* R1198: Pip's one-tap asks. Your Story: for the place picked; Everywhere: for the one open in the editor. */
  const hasWords = (pl: Platform) => !!(drafts[pl].caption + drafts[pl].title + drafts[pl].description).trim();
  const storyWritten = adaptPlaces.filter(hasWords);
  const deckPlaces = live.filter((pl) => drafts[pl].enabled && hasWords(pl));
  const pipCommon = {
    busy: asking,
    proposed,
    onAccept: (pl: Platform) => onSuggest({ t: "accept", p: pl, draft: drafts[pl] }),
    onReject: (pl: Platform) => onSuggest({ t: "reject", p: pl }),
    onAsk: (pl: Platform, a: PipAsk) => void askPip(pl, a),
  };
  const pipOffline = online === false ? "You're offline. Pip can help as soon as you reconnect." : null;
  const deckTarget = deckActive && deckPlaces.includes(deckActive) ? deckActive : null;
  const pipProps: PipActionsProps | null =
    step === "story" && hasMedia
      ? {
          ...pipCommon,
          step: "story",
          places: storyWritten,
          target: pipTarget(pipFocus, storyWritten),
          caption: { busy: captionAsk, waiting: !!captionProposal, onAsk: (a) => void askCaption(a) },
          others: live.filter((pl) => !drafts[pl].enabled),
          onAdd: (pl) => {
            setDrafts((d) => ({ ...d, [pl]: { ...d[pl], enabled: true } }));
            setPipFocus(pl);
            // R1209: platform captions are written on Everywhere, so adding one here only switches it on.
            toast(`${PLATFORM_META[pl].name} added. Pip writes its caption on Everywhere.`, "ok");
          },
          why: pipOffline ?? (adapting ? "Pip is writing your captions. These open when it's done." : story.trim().length < 3 ? "Write a sentence or two in Your caption first, then ask Pip to sharpen it." : null),
          context: `Your caption: ${story.trim().length} characters. ${adaptPlaces.length} ${adaptPlaces.length === 1 ? "place" : "places"} picked, ${adaptPlaces.filter((pl) => drafts[pl].reviewed).length} approved.`,
        }
      : step === "everywhere"
        ? {
            ...pipCommon,
            step: "everywhere",
            places: deckPlaces,
            target: deckTarget,
            why: pipOffline ?? (!deckTarget ? "Open a platform that's switched on and has words, and Pip works on that one." : copyWriting.includes(deckTarget) || rewriting === deckTarget ? `Pip is writing ${PLATFORM_META[deckTarget].name}. These open when it's done.` : null),
            context: deckTarget ? `Working on ${PLATFORM_META[deckTarget].name}: ${(drafts[deckTarget].caption || drafts[deckTarget].description).trim().length} characters now.` : "Pip works on the platform open in the editor.",
          }
        : null;

  const assistant = (
    <Assistant
      pip={pipProps}
      step={step}
      hasMedia={hasMedia}
      upload={upload}
      meta={meta}
      story={story}
      onStory={setStory}
      submittedStory={submittedStory}
      onSubmitStory={submitStory}
      watch={watch}
      onUseWatched={useWatched}
      onRewatch={rewatch}
      onEditStory={() => {
        setSubmittedStory(null);
        setEditedOriginal(null);
        hooksAbort.current?.abort();
        setHooks(NO_HOOKS);
      }}
      hooks={hooks}
      original={editedOriginal ?? hooks.result?.original ?? ""}
      onOriginal={setEditedOriginal}
      onTryAnother={tryAnother}
      onTone={(t) => fetchHooks(t, [])}
      onUse={finalizeCaption}
      onRepick={() => {
        setHook(null);
        setStep("story");
        if (!hooks.result && submittedStory) fetchHooks("default", [], submittedStory);
      }}
      chosenHook={hook && (hooks.result || step !== "story") ? hook : null}
      copyLoading={adapting}
      drafts={drafts}
      platforms={[...live]}
      proposed={proposed}
      hold={plan.hold}
      sending={plan.send}
      mode={mode}
      limits={limits}
      limitsFailed={limitsFailed}
      online={online}
      captions={!!(media && upload.kind === "done")}
      finalHook={hook}
      hasCaption={!!caption}
      storyOpen={storyOpen}
      storyWhy={blocked.story}
      composer={step === "story" && hasMedia}
      onFooter={onPipFooter}
      onClose={closePip}
    />
  );

  /** 1170: Step 1 is its own screen (the card, then the picked file with its progress), never the Step 2 stage. */
  const stepOne = step === "video" || (step === "story" && !hasMedia);
  /** Step 2 with a video: preview, editor and assistant side by side. */
  const stage = step === "story" && hasMedia;
  const pipShown = wide ? panel.open : drawer;
  const railStatus = (
    <div className="flex items-center gap-x-1">
      {hasMedia && syncLine}
      <div className="flex items-center gap-x-1">
        {hasMedia && savedAt && (
          <Link href="/content?filter=draft" className="inline-flex min-h-11 items-center px-1 text-xs font-semibold underline underline-offset-4">
            View drafts
          </Link>
        )}
        {startOverButton}
      </div>
    </div>
  );
  /** Below 1280px Pip is a drawer; on Everywhere and Launch this is the way in. */
  const pipButton = (
    <div className="mb-4 flex items-center justify-between gap-2 xl:hidden">
      {startOverButton}
      <Button variant="subtle" size="sm" className="min-h-11" onClick={openDrawer} aria-haspopup="dialog" aria-expanded={drawer} aria-controls={ASSISTANT_PANEL}>
        <Sparkles className="h-4 w-4" aria-hidden="true" /> {step === "launch" ? "Pip's checklist" : "Pip's notes"}
      </Button>
    </div>
  );
  /** 1182: below 1280px a folded Pip is this small button, floating just over the action bar's right end. */
  const pipFabButton = drawer ? null : (
    <Button ref={pipFab} variant="lime" size="icon" className="h-12 w-12 rounded-full shadow-[0_12px_28px_-10px_hsl(var(--lime)/0.75)]" onClick={openDrawer} aria-haspopup="dialog" aria-expanded={false} aria-controls={ASSISTANT_PANEL} aria-label="Open the Outlly assistant">
      <Sparkles className="h-5 w-5" aria-hidden="true" />
    </Button>
  );

  return (
    <CaptionRunProvider value={capStore}>
    <div className="relative flex gap-0 lg:min-h-dvh">
      <Glow />
      <div className="relative min-w-0 flex-1" inert={sheet || undefined}>
        {/* The editor is the one studio surface off the page frame on purpose (1104), with its own tighter gutter.
            1170: one column for every step, about 900 to 1100px beside Pip and wider when Pip folds; the four steps
            sit at its top, aligned with the heading, the card and the action bar. */}
        <div className={cn("mx-auto flex w-full flex-col px-4 pb-4 pt-3 transition-[max-width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:px-6 lg:px-8 lg:pb-16 lg:pt-5", pipShown ? "max-w-[1100px]" : "max-w-[1240px]")}>
          <StepProgress step={step} furthest={furthest} reachable={reachable} blocked={blocked} onGo={onGo} trailing={railStatus} className="mb-5 lg:mb-7" />
          {/* Steps animate in on mount. No exit choreography: a nested exit that never settles must not strand the next step. */}
            {stepOne && (
              <motion.section key="drop" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={T.page} aria-labelledby="drop-title" data-testid="step-one" className={`${createFont.variable} font-create`}>
                {/* 1170: a compact heading, the kind switch under it, then the card. Nothing competes with the upload. */}
                <h1 id="drop-title" className="text-balance text-[clamp(1.6rem,1.25rem+1.1vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
                  Let&apos;s start with <span className="accent-serif energy-text">your video</span>
                </h1>
                <p className="mt-2 max-w-[62ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
                  Upload a clip. Outlly will help prepare it for Reels, Shorts, and other supported platforms. You&apos;ll review and approve everything before publishing.
                </p>
                {!initialPost && <PostKindSwitch inline value="video" className="mt-4" />}
                {!accountList.some((a) => a.status === "connected") && (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    No accounts connected yet. You can still upload and save a draft.{" "}
                    <Link href="/accounts" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4">Connect an account</Link>
                  </p>
                )}
                <div className="mt-5 sm:mt-6">
                  {hasMedia ? (
                    <UploadFileCard
                      name={media?.filename ?? fileRef.current?.name ?? "Your video"}
                      size={meta.size}
                      poster={poster}
                      duration={meta.duration}
                      width={meta.width}
                      height={meta.height}
                      upload={upload}
                      online={online}
                      onPause={upload.kind === "uploading" ? pauseUpload : undefined}
                      onResume={upload.kind === "paused" && fileRef.current ? resumeUpload : undefined}
                      onRetry={upload.kind === "failed" && fileRef.current ? retryUpload : undefined}
                      onCancel={upload.kind === "uploading" || upload.kind === "paused" ? () => setStopAsk(true) : undefined}
                      onRemove={() => setStopAsk(true)}
                      onReplace={(f) => setReplacing(f)}
                      limits={limits}
                    />
                  ) : (
                    <UploadCard limits={limits} limitsFailed={limitsFailed} onFiles={takeFiles} error={pickError} batchMax={BULK_MAX} />
                  )}
                </div>
                <details className="group mt-4 rounded-2xl text-sm">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                    Tips for a smooth upload
                  </summary>
                  <ul className="mt-1 max-w-[70ch] list-disc space-y-1.5 pl-6 text-[13px] leading-relaxed text-muted-foreground">
                    <li>Vertical 9:16 fits Reels, Shorts and TikTok without bars.</li>
                    <li>Want trending music? Add it in Instagram, YouTube or your editor, export the video, then upload it here. Outlly posts the sound that&apos;s in your video to every platform.</li>
                    <li>Your work saves as you go: to this browser straight away, and to Outlly once the video is in.</li>
                  </ul>
                </details>
                {!hasMedia && !initialPost && !restoreLocal && deviceReady && <SavedDrafts key={adopted} className="mt-8 border-t pt-8" />}
              </motion.section>
            )}

            {stage && (
              <motion.section key="stage" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -30 }} transition={T.card} aria-label="Your video" data-tips-ready={upload.kind === "done" ? "" : undefined}>
                <h1 className="sr-only">Create</h1>
                {/* Below 1280px the journey rail is hidden, so Start over (1162) sits above the Pip card. */}
                <div className="mb-2 flex justify-end xl:hidden">{startOverButton}</div>
                {/* Below 1280px the assistant lives in a drawer: this is the way in, first, since Step 2 starts there. */}
                <div className="glass mb-5 flex items-center gap-3 rounded-[22px] p-3 pl-4 xl:hidden">
                  <span className="lime-bg grid h-9 w-9 shrink-0 place-items-center rounded-full" aria-hidden="true">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <p className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className="block font-semibold">{someAdapted ? "Ask Pip to sharpen a caption" : "Stuck on the words? Ask Pip"}</span>
                    <span className="block text-muted-foreground">{someAdapted ? "A better hook, shorter, a clearer CTA. You approve every change." : "A sharper hook, hashtags, your own voice. You write it below; Pip only suggests."}</span>
                  </p>
                  <Button variant="primary" size="sm" className="min-h-11 shrink-0" onClick={openDrawer} aria-haspopup="dialog" aria-expanded={drawer} aria-controls={ASSISTANT_PANEL}>
                    Open Pip
                  </Button>
                </div>
                <div className="md:grid md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] md:items-start md:gap-5 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[minmax(240px,272px)_minmax(0,1fr)] xl:gap-5 2xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)] 2xl:gap-6">
                <div className="md:sticky md:top-20 min-[1800px]:top-6">
                <button
                  type="button"
                  aria-expanded={!videoShut}
                  aria-controls="stage-video"
                  onClick={() => (capVideo.current?.pause(), setVideoShut((v) => !v))}
                  className="mb-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-3 text-[13px] font-semibold hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
                >
                  {videoShut ? "Show video preview" : "Hide video preview"}
                  <ChevronDown className={cn("h-4 w-4 transition-transform duration-200 motion-reduce:transition-none", !videoShut && "rotate-180")} aria-hidden="true" />
                </button>
                <div id="stage-video" className={cn(videoShut && "max-md:hidden")}>
                <VideoStage
                  column
                  roomBelow={capTranscribing}
                  videoRef={capVideo}
                  overlay={<canvas ref={capCanvas} className="pointer-events-none absolute inset-0 h-full w-full object-cover" aria-hidden="true" />}
                  src={capLive && preCaption ? preCaption.media.url : src}
                  poster={poster}
                  filename={media?.filename ?? fileRef.current?.name}
                  meta={meta}
                  upload={upload}
                  onReplace={(f) => setReplacing(f)}
                  onRetry={fileRef.current ? retryUpload : undefined}
                  onCancel={() => setStopAsk(true)}
                  onError={(m) => toast(m, "info")}
                />
                </div>
                {/* R1193: the transcribe run card lives with the video it reads (on a phone it stays in the caption editor). */}
                <TranscribeRun className="mt-3 hidden md:block" />
                </div>
                <div data-pip={pipShown ? "open" : "closed"} className="group/edit mt-5 min-w-0 space-y-5 md:mt-0">
                {/* R1206: subtitles sit directly above Your caption (the brief's order): the spoken words on
                    the video come first, and stay a separate thing from each platform's social caption. */}
                {(preCaption || (src && media && upload.kind === "done")) && (
                  <VideoSubtitles transcribing={capTranscribing} burning={capBurning}>
                  <CaptionBurner
                    video={capVideo}
                    canvas={capCanvas}
                    onLive={onCapLive}
                    key={preCaption?.media.id ?? media?.id}
                    /* always the clean video, so the preview overlay and a re-burn never double the captions */
                    src={(preCaption ? preCaption.media.url : src) ?? src ?? ""}
                    file={preCaption ? preCaption.file : fileRef.current}
                    filename={(preCaption?.media ?? media)?.filename ?? fileRef.current?.name ?? "video.mp4"}
                    duration={meta?.duration ?? 0}
                    initialTrack={restoredTrack ?? undefined}
                    onTrackChange={onTrackChange}
                    session={(preCaption?.media ?? media)?.id}
                    onBurned={(f, kind) => {
                      setPreCaption((p) => p ?? (media ? { media, file: fileRef.current } : null));
                      startUpload(f);
                      toast(kind === "cut" ? "Clip cut. Uploading it as your video…" : "Captions added. Uploading the captioned video…", "info");
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
                  </VideoSubtitles>
                )}
                {/* R1209: Your Story writes the main caption only. The platforms, their captions and approving them
                    are all on Everywhere, written once from this caption on the way in. */}
                <StoryComposer
                  story={story}
                  onStory={setStory}
                  watch={watch}
                  longForm={longForm}
                  online={online}
                  onAnalyze={analyze}
                  onUseWatched={useWatched}
                  status={autosaveLine(saved, savedAt)}
                  suggestion={
                    captionProposal && {
                      text: captionProposal.text,
                      why: captionProposal.why,
                      label: STORY_ASKS.find((a) => a.id === captionProposal.ask)?.label ?? "Pip's take",
                      stale: story.trim() !== captionProposal.from.trim(),
                    }
                  }
                  onApply={() => {
                    if (!captionProposal) return;
                    setStory(captionProposal.text);
                    setCaptionProposal(null);
                    toast(someAdapted ? "Pip's version is in Your caption. Your platform captions are written again from it on Everywhere." : "Pip's version is in Your caption.", "ok");
                  }}
                  onSkip={() => setCaptionProposal(null)}
                />
                <SaveDraft className="px-1 xl:hidden" state={saved} at={savedAt} onSave={saveDraftNow} busy={saved === "saving"} hideButton sync={syncLine} />
                </div>
                </div>
              </motion.section>
            )}

            {step === "everywhere" && (
              <motion.section key="deck" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={T.page}>
                <h1 className="sr-only">Make it fit everywhere</h1>
                {pipButton}
                <PlatformDeck
                  drafts={drafts}
                  onDraft={onDraft}
                  accounts={accounts}
                  options={options}
                  media={{ src, poster, ...meta }}
                  writing={[...new Set([...copyWriting, ...adaptWriting, ...(asking ? [asking.p] : [])])]}
                  adapted={adapted}
                  onRegenerate={(pl) => void adapt([pl], { fresh: true, direct: true, tone: adaptTone ?? undefined })}
                  onRegenerateAll={(t) => void adapt(adaptPlaces, { fresh: true, tone: t ?? adaptTone ?? undefined })}
                  tone={adaptTone}
                  onRestore={restoreAdapted}
                  onStopWriting={adapting ? stopAdapt : undefined}
                  rewriting={rewriting}
                  onRewrite={rewrite}
                  onConnect={connect}
                  hook={hook ?? ""}
                  onHook={(h) => setHook(h)}
                  online={online}
                  proposals={sugg.proposals}
                  undo={sugg.undo}
                  onAccept={(p) => onSuggest({ t: "accept", p, draft: drafts[p] })}
                  onReject={(p) => onSuggest({ t: "reject", p })}
                  onRevert={(p) => onSuggest({ t: "revert", p })}
                  onActive={setDeckActive}
                  story={captionSource({ edited: editedOriginal, submittedStory, story })}
                  onEditSource={() => goTo("story", () => toast("Your caption is the one place it's written. Change it here, then ask Pip again.", "info"))}
                  open={deckOpen}
                />
              </motion.section>
            )}

            {step === "launch" && (
              <motion.section key="launch" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={T.page}>
                <h1 className="sr-only">Launch</h1>
                {pipButton}
                {/* Held places are listed with their reason and never sent; the bar's Publish waits until none are left. */}
                <LaunchPanel drafts={drafts} accounts={accounts} media={meta} poster={poster} hook={hook ?? ""} title={draftTitle({ drafts, hook, filename: media?.filename ?? fileRef.current?.name })} status={autosaveLine(saved, savedAt)} tz={tz} when={when} onWhen={setWhen} mode={mode} onMode={setMode} busy={launching} error={launchError} online={online}
                  onEdit={() => goTo("everywhere")}
                  onLeaveOut={(p) => onDraft(p, { enabled: false })}
                  onConnect={(p) => void connect(p)}
                  onFix={fixOnDeck}
                  onReplaceVideo={() => {
                    goTo("video");
                    toast("Use Replace under your video to upload the version with music. Your copy stays.", "info");
                  }}
                  coverUrl={coverUrl}
                  onCover={setCoverUrl}
                  ensurePost={() => save({ force: true, strict: true })}
                  postId={postId}
                  onScheduleIssue={setScheduleIssue}
                  proposed={proposed}
                />
              </motion.section>
            )}
          {hasMedia && !stage && <SaveDraft className="mt-6 xl:hidden" state={saved} at={savedAt} onSave={saveDraftNow} busy={saved === "saving"} hideButton sync={syncLine} />}
          <ActionBar state={bar} saveLabel={saved === "saving" ? "Saving" : "Save draft"} mode={mode} onAction={onBar} fill={stepOne} pip={pipFabButton} />
        </div>
        <ConflictDialog
          open={comparing && !!conflict}
          local={{ title: draftTitle({ drafts, hook, filename: media?.filename ?? fileRef.current?.name }), story: submittedStory ?? story, hook, targets: drafts }}
          server={conflict}
          onKeepLocal={() => {
            if (conflict) sync.resolveConflict("local", conflict);
            setConflict(null);
            setComparing(false);
          }}
          onKeepServer={() => {
            if (conflict) keepServer(conflict);
            setConflict(null);
            setComparing(false);
          }}
          onClose={() => setComparing(false)}
        />
        <PreviewSheet open={previewing} onOpenChange={setPreviewing} platforms={enabled} drafts={drafts} accounts={accounts} src={src} poster={coverUrl ?? poster} />
        <ConfirmDialog
          open={!!replacing}
          onOpenChange={(o) => !o && setReplacing(null)}
          title="Replace your video?"
          body="The new video uploads in place of this one. Your story, hook and the copy for each platform stay as they are."
          confirmLabel="Replace video"
          cancelLabel="Keep this one"
          onConfirm={() => {
            const f = replacing;
            setReplacing(null);
            if (f) void pickFile(f);
          }}
        />
        <ConfirmDialog
          open={overAsk}
          onOpenChange={(o) => !overBusy && setOverAsk(o)}
          title="Start over?"
          body={upload.kind === "uploading" ? "This one is kept in your drafts once the video finishes uploading, then a fresh Create opens at step 1." : "This one is kept in your drafts, and a fresh Create opens at step 1."}
          confirmLabel={overBusy ? "Saving…" : "Save and start over"}
          cancelLabel="Keep going"
          tone="primary"
          busy={overBusy}
          onConfirm={() => void startOver()}
        />
        <ConfirmDialog
          open={stopAsk}
          onOpenChange={setStopAsk}
          title={upload.kind === "uploading" || upload.kind === "paused" ? "Stop this upload?" : "Remove this video?"}
          body="The video comes off this draft and you can pick another one. What you have written stays on this screen."
          confirmLabel={upload.kind === "uploading" || upload.kind === "paused" ? "Stop upload" : "Remove video"}
          cancelLabel={upload.kind === "uploading" ? "Keep uploading" : upload.kind === "paused" ? "Keep it paused" : "Keep it"}
          onConfirm={() => {
            setStopAsk(false);
            cancelUpload();
          }}
        />
      </div>

      {/* R1193: a div with a role, not an aside: an aside can't be a dialog, and swapping the element would unmount the chat. */}
      <div
        ref={drawerRef}
        aria-label="AI assistant"
        role={sheet ? "dialog" : "complementary"}
        aria-modal={sheet || undefined}
        onKeyDown={sheet ? onDrawerKey : undefined}
        className={cn(
          "xl:relative xl:sticky xl:top-0 xl:flex xl:h-dvh xl:shrink-0 xl:items-start xl:p-3",
          drawer ? "max-xl:fixed max-xl:inset-0 max-xl:z-[60] max-xl:flex max-xl:flex-col max-xl:justify-end md:max-xl:flex-row md:max-xl:justify-end" : "max-xl:hidden",
        )}
      >
        {sheet && <div className="absolute inset-0 bg-[hsl(240_10%_4%/0.55)]" aria-hidden="true" onClick={closeDrawer} />}
        <Button
          variant="subtle"
          size="icon"
          className={cn("hidden shrink-0 xl:inline-flex", panel.open && "xl:absolute xl:right-6 xl:top-[26px] xl:z-[2]")}
          onClick={togglePanel}
          aria-expanded={panel.open}
          aria-controls={ASSISTANT_PANEL}
          aria-label={panel.open ? "Hide the Outlly assistant" : "Show the Outlly assistant"}
        >
          {panel.open ? <PanelRightClose className="h-5 w-5" aria-hidden="true" /> : <PanelRightOpen className="h-5 w-5" aria-hidden="true" />}
        </Button>
        {/* Folded, never unmounted: the conversation and everything typed into it is still there when it comes back. */}
        <div
          id={ASSISTANT_PANEL}
          aria-hidden={!pipShown}
          inert={!pipShown}
          className={cn(
            "relative overflow-hidden",
            sheet ? "glass-strong" : "glass",
            "xl:h-full xl:rounded-[28px] xl:transition-[width,opacity] xl:duration-300 xl:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            panel.open ? "xl:w-[300px] xl:opacity-100 2xl:w-[320px]" : "xl:w-0 xl:opacity-0",
            // 1182: a phone sheet as tall as what it holds, up to 86dvh; header and footer stay put while the middle scrolls.
            "max-xl:flex max-xl:max-h-[min(86dvh,720px)] max-xl:w-full max-xl:flex-col max-xl:rounded-t-[28px] max-xl:pb-[env(safe-area-inset-bottom)] md:max-xl:m-3 md:max-xl:max-h-none md:max-xl:w-[400px] md:max-xl:rounded-[28px] md:max-xl:pb-0",
          )}
        >
          <Button ref={drawerClose} variant="ghost" size="icon" className="absolute right-3 top-4 z-[2] xl:hidden" onClick={closeDrawer} aria-label="Close Pip">
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          {assistant}
        </div>
      </div>
    </div>
    </CaptionRunProvider>
  );
}

const SENT_REACHABLE: Record<Step, boolean> = { video: false, story: false, everywhere: false, launch: false };
const noGo = () => {};

function Glow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="animate-morph absolute -left-40 -top-40 h-[520px] w-[520px] bg-lime opacity-[0.13] blur-[120px] dark:opacity-[0.1]" />
      <div className="animate-morph absolute -bottom-60 right-0 h-[480px] w-[480px] bg-accent opacity-[0.1] blur-[130px] [animation-delay:-6s]" />
    </div>
  );
}
