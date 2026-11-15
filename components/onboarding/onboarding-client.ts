"use client";
import { api } from "@/lib/client/api";
import type { OnboardingPatch, OnboardingPayload, OnboardingStepId } from "@/lib/onboarding-core";

/** Open the guided setup at a step (or where it left off). Help and Support and the Home checklist use it. */
export const ONBOARDING_OPEN = "outly:onboarding-open";
/** Fired with the fresh state after every save, so the checklist and the Help list stay in step with the flow. */
export const ONBOARDING_CHANGED = "outly:onboarding";

export function openOnboarding(step?: OnboardingStepId) {
  window.dispatchEvent(new CustomEvent(ONBOARDING_OPEN, { detail: step }));
}

/** The server is the record; this copy only lets a reload paint the last known state before the answer lands. */
export const ONBOARDING_CACHE_PREFIX = "outly:onboarding:";
export const onboardingCacheKey = (id: string, me?: string) => `${ONBOARDING_CACHE_PREFIX}${id}${me ? `:${me}` : ""}`;

export function cacheOnboarding(key: string, v: OnboardingPayload) {
  try {
    localStorage.setItem(key, JSON.stringify({ finished: v.finished, steps: v.steps.map((s) => [s.id, s.status]) }));
  } catch {
    /* storage blocked: the server still has it */
  }
}

export async function saveOnboarding(patch: OnboardingPatch): Promise<OnboardingPayload> {
  const r = await api<{ onboarding: OnboardingPayload }>("/api/me/onboarding", { method: "PATCH", json: patch, keepalive: true });
  window.dispatchEvent(new CustomEvent<OnboardingPayload>(ONBOARDING_CHANGED, { detail: r.onboarding }));
  return r.onboarding;
}
