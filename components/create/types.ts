import type { AccountView, MediaView, PostView, TargetView } from "@/lib/services";
import type { Platform } from "@/lib/domain";
import type { Draft } from "@/lib/client/checks";

export type { AccountView, MediaView, PostView, TargetView, Draft };

export type Step = "video" | "story" | "everywhere" | "launch";
export const STEPS: { id: Step; n: string; label: string; hint: string }[] = [
  { id: "video", n: "01", label: "Your video", hint: "Drop it in" },
  { id: "story", n: "02", label: "Your story", hint: "Find the hook" },
  { id: "everywhere", n: "03", label: "Everywhere", hint: "Make it fit" },
  { id: "launch", n: "04", label: "Launch", hint: "Send it out" },
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
}
export type Tone = "default" | "punchier" | "professional" | "genz";

export type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number; eta?: number | null }
  | { kind: "done" }
  | { kind: "failed"; message: string };

export const emptyDraft = (enabled: boolean): Draft => ({ enabled, title: "", caption: "", description: "", hashtags: "", note: "", reviewed: false });

export const NOTES: Record<Platform, string> = {
  instagram: "Instagram is ready",
  youtube: "YouTube wants a stronger title",
  x: "Let's make this impossible to ignore.",
  tiktok: "TikTok wants a hook in the first second.",
  threads: "Threads likes it conversational.",
  facebook: "Facebook is ready for the feed.",
  linkedin: "LinkedIn wants the lesson up front.",
};
