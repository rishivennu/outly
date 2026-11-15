"use client";
import { useEffect, useState } from "react";
import { Check, CircleDashed, Compass, RotateCcw, SkipForward } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import type { OnboardingPayload, StepStatus } from "@/lib/onboarding-core";
import { cn } from "@/lib/utils";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_CHANGED, openOnboarding, saveOnboarding } from "./onboarding-client";
import { startTour } from "./Tour";

const WORD: Record<StepStatus, string> = { done: "Done", skipped: "Skipped", todo: "To do" };
const ICON = { done: Check, skipped: SkipForward, todo: CircleDashed } as const;

/** Help and Support: every guided step with where it stands, reopened at any step, or started again. */
export function SetupGuide({ onboarding, className, action }: { onboarding: OnboardingPayload; className?: string; action: string }) {
  const toast = useToast();
  const [view, setView] = useState(onboarding);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<OnboardingPayload>).detail);
    window.addEventListener(ONBOARDING_CHANGED, on);
    return () => window.removeEventListener(ONBOARDING_CHANGED, on);
  }, []);

  const again = async () => {
    setBusy(true);
    try {
      const v = await saveOnboarding({ action: "reset" });
      openOnboarding(v.next ?? "welcome");
    } catch {
      toast("That didn't go through. Check your connection and try again.", "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-[17px] font-bold tracking-[-0.01em]">
            <Compass className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Setup guide
          </p>
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
            {view.finished ? "Finished. " : ""}
            {view.done} of {view.total} done{view.skipped ? `, ${view.skipped} skipped` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(action, "mt-0")} onClick={() => startTour()}>
            Start the tour
          </button>
          <button type="button" className={cn(action, "mt-0")} onClick={again} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Start setup again
          </button>
        </div>
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Setup steps">
        {view.steps.map((s, n) => {
          const Icon = ICON[s.status];
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => openOnboarding(s.id)}
                className="flex min-h-11 w-full items-center gap-3 rounded-2xl bg-[hsl(var(--ap-canvas))] px-3.5 py-2.5 text-left transition-[background-color] duration-hover ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [@media(hover:hover)]:hover:bg-foreground/[0.06]"
              >
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", s.status === "done" ? "lime-bg" : "hairline text-muted-foreground")} aria-hidden="true">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    <span className="tabular-nums">{n + 1}.</span> {s.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">{WORD[s.status]}</span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-foreground/80">Open</span>
              </button>
            </li>
          );
        })}
      </ol>
      <OnboardingFlow initial={view} />
    </div>
  );
}
