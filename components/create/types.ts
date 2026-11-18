import type { AccountView, MediaView, PostView, TargetView } from "@/lib/services";
import type { Platform } from "@/lib/domain";
import type { Draft } from "@/lib/client/checks";
import type { UploadInfo } from "@/lib/client/upload";

export type { AccountView, MediaView, PostView, TargetView, Draft };

export type Step = "video" | "story" | "everywhere" | "launch";
export const STEPS: { id: Step; n: string; label: string; hint: string }[] = [
  { id: "video", n: "01", label: "Your Video", hint: "Upload your clip" },
  { id: "story", n: "02", label: "Your Story", hint: "Find the hook" },
  { id: "everywhere", n: "03", label: "Everywhere", hint: "Fit each platform" },
  { id: "launch", n: "04", label: "Launch", hint: "Publish or schedule" },
];

export interface Hook {
  text: string;
  angle: string;
}
export interface HookResult {
  understood: string;
  insight: string;
  original: string;
  hooks: Hook[];
  source: "gemini" | "studio";
}
export interface PlatformCopy {
  platform: Platform;
  title?: string;
  caption: string;
  description?: string;
  hashtags: string;
  note: string;
  why?: { formula: string; hook: string; cta: string; signal: string };
}
export type Tone = "default" | "punchier" | "professional" | "genz";

/** 1160: the assistant watching the video and writing the story for the creator to use or edit.
 * 1174: `failed` = every model was busy or down; the creator is told and can ask again, instead of a silent blank. */
export type WatchState = { kind: "idle" } | { kind: "watching" } | { kind: "ready"; story: string; seen?: string } | { kind: "failed" };
export const NO_WATCH: WatchState = { kind: "idle" };

/** The hook writer's state. `more` = hooks are still arriving; `status` = what it is doing right now. */
export type HooksState = { loading: boolean; more: boolean; status: string; result: HookResult | null; index: number; tone: Tone; error: string | null };
export const NO_HOOKS: HooksState = { loading: false, more: false, status: "", result: null, index: 0, tone: "default", error: null };

export type UploadState =
  | { kind: "idle" }
  /** R1193: `info` = the engine's phase, bytes, speed and parts (direct uploads), for the card and the stage pill. */
  | { kind: "uploading"; progress: number; eta?: number | null; info?: UploadInfo }
  /** 1170: stopped by the creator on Step 1; Resume sends the same file again and picks up what already landed. */
  | { kind: "paused"; progress: number }
  | { kind: "done" }
  | { kind: "failed"; message: string };

export const emptyDraft = (enabled: boolean): Draft => ({ enabled, title: "", caption: "", description: "", hashtags: "", firstComment: "", note: "", reviewed: false });

export const NOTES: Record<Platform, string> = {
  instagram: "Instagram is ready",
  youtube: "YouTube wants a stronger title",
  x: "Let's make this impossible to ignore.",
  tiktok: "TikTok wants a hook in the first second.",
  threads: "Threads likes it conversational.",
  facebook: "Facebook is ready for the feed.",
  linkedin: "LinkedIn wants the lesson up front.",
};
