"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Compass } from "lucide-react";
import { Sheet } from "@/components/shared/Sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { useUser } from "@/components/shell/UserContext";
import { readConsent } from "@/components/shared/CookieConsent";
import { afterPrivacy } from "@/components/shared/PrivacyNotice";
import { api } from "@/lib/client/api";
import { T } from "@/lib/motion/tokens";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/domain";
import { isStepId, type OnboardingPatch, type OnboardingPayload, type OnboardingStepId } from "@/lib/onboarding-core";
import { cn } from "@/lib/utils";
import { startTour, tourKey } from "./Tour";
import { tourState } from "./guides";
import { ONBOARDING_CHANGED, ONBOARDING_OPEN, cacheOnboarding, onboardingCacheKey, saveOnboarding } from "./onboarding-client";
import { ConnectStep } from "./steps/ConnectStep";
import { ProfileStep } from "./steps/ProfileStep";
import { EXPLORE, ExploreStep } from "./steps/ExploreStep";

const STATUS_WORD = { done: "done", skipped: "skipped", todo: "to do" } as const;

const platformName = (p: string | null) => ((PLATFORMS as readonly string[]).includes(p ?? "") ? PLATFORM_META[p as Platform].name : "That platform");

function connectProblem(p: string, reason: string | null) {
  const name = platformName(p);
  if (reason === "not_configured") return `${name} isn't set up on this server yet.`;
  if (reason === "owner_only") return "Only the studio owner can connect accounts.";
  if (reason === "denied" || reason === "access_denied") return `${name} wasn't connected. Nothing was changed.`;
  return `${name} didn't connect. Try again from Connected accounts to see what went wrong.`;
}

/** Another popup is up (or the Home Screen welcome, or the tour): wait for it, never stack on it. */
const busy = () =>
  !!(document.hidden || tourState.open || document.documentElement.hasAttribute("data-welcome") || document.querySelector('[role="dialog"], [role="alertdialog"], [aria-labelledby="cc-title"]'));

/**
 * Phase 2: the guided setup. Six steps, each with Back and Skip, progress saved on the account (PATCH
 * /api/me/onboarding) so it never repeats on another device once finished or dismissed. On Home it opens by
 * itself once for a new account, in the first-run order (cookie choice, privacy notice, Home Screen welcome,
 * then this, then the subscribe greeting and Pip). Help and Support opens it at any step.
 */
export function OnboardingFlow({ initial, auto = false }: { initial: OnboardingPayload; auto?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [view, setView] = useState(initial);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<OnboardingStepId>(initial.next ?? initial.steps[0].id);
  const firstRun = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const shownAt = useRef<OnboardingStepId | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cacheKey = onboardingCacheKey(user.id, user.workspace?.me.email);

  useEffect(() => setView(initial), [initial]);
  useEffect(() => cacheOnboarding(cacheKey, view), [cacheKey, view]);
  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<OnboardingPayload>).detail);
    window.addEventListener(ONBOARDING_CHANGED, on);
    return () => window.removeEventListener(ONBOARDING_CHANGED, on);
  }, []);

  const show = useCallback((step?: OnboardingStepId | null) => {
    const v = viewRef.current;
    setAt(step && v.steps.some((s) => s.id === step) ? step : (v.next ?? v.steps[0].id));
    setOpen(true);
    window.dispatchEvent(new Event("outly:guide")); // Pip and the update notice wait their turn
  }, []);

  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<OnboardingStepId | undefined>).detail);
    window.addEventListener(ONBOARDING_OPEN, on);
    return () => window.removeEventListener(ONBOARDING_OPEN, on);
  }, [show]);

  // What the address brought: a connect coming back, a step asked for, or a first visit.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const choose = q.get("choose");
    // Several accounts came back from the platform: the Accounts page asks which one (it holds that dialog).
    if (choose && /^[0-9a-f-]{36}$/.test(choose)) return router.replace(`/accounts?choose=${choose}`);
    const setup = q.get("setup");
    const err = q.get("connect_error");
    const connected = q.get("connected");
    const welcome = q.get("welcome") === "1";
    if (err) toast(connectProblem(err, q.get("reason")), "info");
    // With ?welcome=1 the checklist says hello and names the channel in one line.
    if (connected && !welcome) toast(`${platformName(connected)} is connected.`, "ok");
    if (setup || err || (connected && !welcome)) {
      ["setup", "connect_error", "reason", ...(welcome ? [] : ["connected", "notice"])].forEach((k) => q.delete(k));
      history.replaceState(history.state, "", location.pathname + (q.toString() ? `?${q}` : ""));
    }

    let poll = 0;
    let unPrivacy = () => {};
    const whenQuiet = (then: () => void) => {
      let tries = 0;
      poll = window.setInterval(() => {
        if (busy() && ++tries < 150) return;
        window.clearInterval(poll);
        if (tries < 150) then();
      }, 400);
    };
    if (setup || err) {
      whenQuiet(() => show(isStepId(setup) ? setup : err ? "connect" : null));
      return () => window.clearInterval(poll);
    }
    if (!auto) return;
    let toured = true;
    try {
      toured = !!localStorage.getItem(tourKey(user.id));
    } catch {
      /* storage blocked: never nag on every visit */
    }
    const v = viewRef.current;
    if (!v.autoOpen || q.get("tour") === "1" || (toured && !welcome)) {
      // Not opening: the greetings that wait for the first-run walk-through may go ahead on this device.
      try {
        if (!toured) localStorage.setItem(tourKey(user.id), new Date().toISOString());
      } catch {}
      return;
    }
    const begin = () => {
      unPrivacy = afterPrivacy(user.id, () =>
        whenQuiet(() => {
          firstRun.current = true;
          show("welcome");
        }),
      );
    };
    if (readConsent()) begin();
    else window.addEventListener("outly:consent", begin, { once: true });
    return () => {
      window.clearInterval(poll);
      unPrivacy();
      window.removeEventListener("outly:consent", begin);
    };
    // Once per page load: later state changes come through events, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(
    (patch: OnboardingPatch) =>
      saveOnboarding(patch)
        .then((v) => (setView(v), v))
        .catch(() => {
          toast("Your setup progress didn't save. Check your connection; it will ask again next time.", "info");
          return null;
        }),
    [toast],
  );

  const close = useCallback(() => {
    setOpen(false);
    try {
      if (!localStorage.getItem(tourKey(user.id))) localStorage.setItem(tourKey(user.id), new Date().toISOString());
    } catch {}
    window.dispatchEvent(new Event("outly:guide-closed"));
    // The first-run greetings were waiting for this walk-through, the same way they wait for the tour.
    if (firstRun.current) {
      firstRun.current = false;
      window.dispatchEvent(new Event("outly:tour-closed"));
    }
    // Seen once is enough: it never opens by itself again, on any device.
    if (viewRef.current.steps.find((s) => s.id === "welcome")?.status === "todo") void persist({ step: "welcome", status: "skipped" });
  }, [persist, user.id]);

  // Moving between steps: focus the new step, since the button that was pressed has usually gone.
  useEffect(() => {
    if (!open) return void (shownAt.current = null);
    if (shownAt.current && shownAt.current !== at) body.current?.focus({ preventScroll: true });
    shownAt.current = at;
  }, [at, open]);

  const steps = view.steps;
  const i = Math.max(0, steps.findIndex((s) => s.id === at));
  const step = steps[i];
  const last = i === steps.length - 1;

  const advance = useCallback(
    (v: OnboardingPayload | null) => {
      const cur = v ?? viewRef.current;
      if (cur.finished && !cur.steps.some((s) => s.status === "todo")) {
        close();
        toast("Setup finished. You can look at any step again from Help and Support.", "ok");
        return;
      }
      if (last) return close();
      setAt(steps[i + 1].id);
    },
    [close, i, last, steps, toast],
  );

  const mark = async (status: "done" | "skipped") => advance(await persist({ step: step.id, status }));
  const refresh = () => api<{ onboarding: OnboardingPayload }>("/api/me/onboarding").then((r) => setView(r.onboarding)).catch(() => {});

  const leaveTo = (href: string, save?: OnboardingPatch) => {
    if (save) void persist(save);
    close();
    router.push(href);
  };

  const takeTour = () => {
    void persist({ step: "welcome", status: "done" });
    setOpen(false);
    window.dispatchEvent(new Event("outly:guide-closed"));
    // Back to the next step once the tour is done; the tour itself tells the greetings it closed.
    const back = () => show(viewRef.current.next);
    window.addEventListener("outly:tour-closed", back, { once: true });
    requestAnimationFrame(() => startTour());
  };

  if (!step) return null;
  const done = step.status === "done";
  const explore = step.id === "create" || step.id === "schedule" || step.id === "analytics" ? EXPLORE[step.id] : null;

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} title={step.title} description={`Step ${i + 1} of ${steps.length}`} side="center">
      <ol className="mb-5 mt-1 flex gap-1.5" aria-label="Setup progress">
        {steps.map((s, n) => (
          <li key={s.id} className="flex-1">
            <button
              type="button"
              onClick={() => setAt(s.id)}
              aria-current={n === i ? "step" : undefined}
              aria-label={`${n + 1}. ${s.title}, ${STATUS_WORD[s.status]}`}
              className="group flex h-11 w-full items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "block h-1.5 w-full rounded-full transition-[background-color,box-shadow] duration-hover ease-out motion-reduce:transition-none",
                  s.status === "done" ? "lime-bg" : s.status === "skipped" ? "bg-muted-foreground/40" : "bg-secondary",
                  n === i && "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background",
                )}
              />
            </button>
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">
        {`${step.title}, step ${i + 1} of ${steps.length}, ${STATUS_WORD[step.status]}. ${view.done} of ${view.total} steps done.`}
      </p>
      <motion.div key={step.id} initial={{ opacity: 0, x: reduce ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} transition={reduce ? T.fade : T.nav} ref={body} tabIndex={-1} aria-label={step.title} className="min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {step.status !== "todo" && (
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            {done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {done ? (step.auto ? "Done, your studio already shows it" : "Done") : "Skipped earlier"}
          </p>
        )}
        {step.id === "welcome" && (
          <div>
            <p className="font-display text-[22px] font-bold leading-snug tracking-[-0.015em]">Welcome to Outlly, {(user.workspace?.me.name ?? user.name).split(" ")[0]}.</p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Six short steps get you from here to your first post going out. Skip any of them and come back later from Help and Support.</p>
          </div>
        )}
        {step.id === "connect" && view.connect && <ConnectStep options={view.connect} />}
        {step.id === "profile" && view.profile && <ProfileStep profile={view.profile} seed={user.id} onChanged={refresh} onSaved={() => void mark("done")} />}
        {explore && <ExploreStep id={step.id as "create" | "schedule" | "analytics"} />}
      </motion.div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {i > 0 && (
          <Button variant="ghost" className="px-3" onClick={() => setAt(steps[i - 1].id)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </Button>
        )}
        <span className="flex-1" />
        {step.id === "welcome" ? (
          <>
            <Button variant="outline" onClick={takeTour}>
              <Compass className="h-4 w-4" aria-hidden="true" /> Take the tour
            </Button>
            <Button variant="lime" onClick={() => void mark("done")}>
              Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            {!done && (
              <Button variant="ghost" onClick={() => void mark("skipped")}>
                {last ? "Skip and finish" : "Skip for now"}
              </Button>
            )}
            {explore && !done && (
              <Button variant="lime" asChild>
                <Link
                  href={explore.href}
                  onClick={(e) => {
                    e.preventDefault();
                    leaveTo(explore.href, step.id === "analytics" ? { step: "analytics", status: "done" } : undefined);
                  }}
                >
                  {explore.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
            {done && (
              <Button variant="lime" onClick={() => advance(null)}>
                {last ? "Finish" : "Next"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
