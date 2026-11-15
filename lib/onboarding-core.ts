/**
 * Phase 2: the guided onboarding, the pure half (unit tested). What is saved on the account (User.onboarding),
 * how it is read back, and how it merges with what the studio's own data already shows. A step counts as done
 * when the data says so (a connected account, a filled profile, a first upload, a first post booked) or when
 * the person finished or skipped it in the flow. Nothing here is guessed.
 */

import type { Platform } from "./domain";

export const ONBOARDING_STEPS = ["welcome", "connect", "profile", "create", "schedule", "analytics"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export type SavedStatus = "done" | "skipped";
export type StepStatus = SavedStatus | "todo";

export const STEP_TITLES: Record<OnboardingStepId, string> = {
  welcome: "Welcome",
  connect: "Connect your accounts",
  profile: "Set up your creator profile",
  create: "Explore creating a post",
  schedule: "Schedule your first post",
  analytics: "Explore analytics",
};

export interface OnboardingSaved {
  v: 1;
  steps: Partial<Record<OnboardingStepId, SavedStatus>>;
  finishedAt?: string;
  updatedAt: string;
}

/** Facts read from the studio's own tables. `owner` false = a teammate inside someone else's workspace. */
export interface OnboardingFacts {
  owner: boolean;
  connected: boolean;
  profile: boolean;
  uploaded: boolean;
  scheduled: boolean;
}

export interface OnboardingStepView {
  id: OnboardingStepId;
  title: string;
  status: StepStatus;
  /** true when the studio's data shows it, whatever was saved */
  auto: boolean;
}

export interface OnboardingView {
  steps: OnboardingStepView[];
  done: number;
  skipped: number;
  total: number;
  finished: boolean;
  finishedAt: string | null;
  /** Open the flow by itself: never finished, and the welcome step not yet seen. */
  autoOpen: boolean;
  next: OnboardingStepId | null;
}

export type OnboardingPatch = { step: OnboardingStepId; status: SavedStatus } | { action: "finish" | "dismiss" | "reset" };

export const isStepId = (v: unknown): v is OnboardingStepId => typeof v === "string" && (ONBOARDING_STEPS as readonly string[]).includes(v);
const isSaved = (v: unknown): v is SavedStatus => v === "done" || v === "skipped";
const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Tolerant reader: anything broken or unknown reads as "never started" (null), unknown keys are dropped. */
export function parseOnboarding(raw: string | null | undefined): OnboardingSaved | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || (o as { v?: unknown }).v !== 1) return null;
  const src = (o as { steps?: unknown }).steps;
  const steps: OnboardingSaved["steps"] = {};
  if (src && typeof src === "object") for (const id of ONBOARDING_STEPS) if (isSaved((src as Record<string, unknown>)[id])) steps[id] = (src as Record<string, SavedStatus>)[id];
  const f = (o as { finishedAt?: unknown }).finishedAt;
  const u = (o as { updatedAt?: unknown }).updatedAt;
  return { v: 1, steps, ...(isIso(f) ? { finishedAt: f } : {}), updatedAt: isIso(u) ? u : new Date(0).toISOString() };
}

export const serializeOnboarding = (s: OnboardingSaved) => JSON.stringify(s);

/** Connect and profile belong to the workspace owner; a teammate is never asked to do them. */
export const applicableSteps = (owner: boolean): OnboardingStepId[] => (owner ? [...ONBOARDING_STEPS] : ONBOARDING_STEPS.filter((s) => s !== "connect" && s !== "profile"));

export function derivedDone(f: OnboardingFacts): Partial<Record<OnboardingStepId, true>> {
  const d: Partial<Record<OnboardingStepId, true>> = {};
  if (f.connected) d.connect = true;
  if (f.profile) d.profile = true;
  if (f.uploaded) d.create = true;
  if (f.scheduled) d.schedule = true;
  return d;
}

/** Someone who already set up the old way (an account connected and a post sent or booked) is not walked through it again. */
export const legacyFinished = (f: OnboardingFacts) => f.connected && f.scheduled;

function statuses(saved: OnboardingSaved | null, f: OnboardingFacts) {
  const auto = derivedDone(f);
  return applicableSteps(f.owner).map((id): OnboardingStepView => {
    const s = saved?.steps[id];
    return { id, title: STEP_TITLES[id], status: auto[id] ? "done" : (s ?? "todo"), auto: !!auto[id] };
  });
}

export function mergeOnboarding(saved: OnboardingSaved | null, f: OnboardingFacts): OnboardingView {
  const steps = statuses(saved, f);
  const done = steps.filter((s) => s.status === "done").length;
  const skipped = steps.filter((s) => s.status === "skipped").length;
  const allResolved = steps.every((s) => s.status !== "todo");
  // The old-way rule only covers accounts that never touched this flow; after a reset the flow is theirs again.
  const finished = !!saved?.finishedAt || allResolved || (!saved && legacyFinished(f));
  const welcome = steps.find((s) => s.id === "welcome")!;
  return {
    steps,
    done,
    skipped,
    total: steps.length,
    finished,
    finishedAt: saved?.finishedAt ?? null,
    autoOpen: !finished && welcome.status === "todo",
    next: steps.find((s) => s.status === "todo")?.id ?? null,
  };
}

/** The saved record after one change. Pure: `now` is passed in. */
export function applyOnboarding(saved: OnboardingSaved | null, patch: OnboardingPatch, f: OnboardingFacts, now: Date): OnboardingSaved {
  const at = now.toISOString();
  if ("action" in patch && patch.action === "reset") return { v: 1, steps: {}, updatedAt: at };
  const next: OnboardingSaved = { v: 1, steps: { ...(saved?.steps ?? {}) }, ...(saved?.finishedAt ? { finishedAt: saved.finishedAt } : {}), updatedAt: at };
  if ("step" in patch) {
    next.steps[patch.step] = patch.status;
    if (!next.finishedAt && statuses(next, f).every((s) => s.status !== "todo")) next.finishedAt = at;
    return next;
  }
  // finish or dismiss: whatever is still open counts as skipped, so Help and Support can say so.
  for (const s of statuses(next, f)) if (s.status === "todo") next.steps[s.id] = "skipped";
  next.finishedAt ??= at;
  return next;
}

/** How a platform can be connected from here right now, or "later" when this server has no way to. */
export type ConnectHow = "oauth" | "token" | "practice" | "later";
export interface ConnectOption {
  platform: Platform;
  name: string;
  how: ConnectHow;
  status: "connected" | "needs_reconnect" | null;
  username: string | null;
  practice: boolean;
}

export interface OnboardingProfile {
  name: string;
  niche: string | null;
  avatar: string | null;
  hasPhoto: boolean;
}

export interface OnboardingPayload extends OnboardingView {
  connect: ConnectOption[] | null;
  profile: OnboardingProfile | null;
}
