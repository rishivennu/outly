"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Counter } from "@/components/ui/field";
import { Stepper, StepPanels } from "@/components/ui/easy/Stepper";
import { MorphingButton } from "@/components/ui/easy/MorphingButton";
import { PlatformGlyph } from "@/components/shared/PlatformIcon";
import { api, ApiError } from "@/lib/client/api";
import { reduced } from "@/lib/motion/prefs";
import { cn } from "@/lib/utils";
import { EXTRA_MAX } from "@/lib/partners/schema";
import { PARTNER_PLATFORM_LABEL } from "@/lib/partners/types";
import { CONTROL, ERROR_INK, Field, FieldError, describe } from "./form/Field";
import { CountryCombobox } from "./form/Country";
import { PlatformRow } from "./form/PlatformRow";
import { Files } from "./form/Files";
import { Review } from "./form/Review";
import {
  CATEGORIES,
  CHIP_PLATFORMS,
  DRAFT_KEY,
  REVIEW,
  SHORT_PREFERENCES,
  STEPS,
  emptyDraft,
  emptyRow,
  fieldId,
  payload,
  restoreDraft,
  sourceFrom,
  stepErrors,
  toggleChip,
  trackHref,
  type Draft,
  type PlatformDraft,
  type UploadedFile,
} from "./form/draft";

export type ApplyMe = { name: string; email: string; verified: boolean } | null;

const GROUP_STEP: Record<string, number> = { personal: 0, socials: 1, stats: 2, files: 2, proposal: 3, consent: REVIEW };
const stepOf = (key: string) => GROUP_STEP[key.split(".")[0]] ?? 0;
/** Server issues come back as consent.terms / consent.accuracy; the short form shows them on its one checkbox. */
const fieldKey = (k: string) => (k.startsWith("consent") ? "consent" : k);

const TITLES = ["Let's get to know you.", "Show us where your audience follows you.", "Give us a quick idea of your reach.", "Choose how you'd like to collaborate.", "Check your application."];
const LEADS = [
  "We'll use these details to contact you about your application.",
  "Add each platform you post on. A link and a rough follower count are enough.",
  "Self-reported numbers. We may ask for a screenshot later.",
  "Pick the one that suits you best. Every offer is agreed individually after review.",
  "Tap Edit to change anything. Your other answers stay as they are.",
];
const STEPPER = STEPS.map((label) => ({ label }));

const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);

function ChipIcon({ platform }: { platform: (typeof CHIP_PLATFORMS)[number] }) {
  if (platform === "other") return <Globe className="h-[18px] w-[18px]" aria-hidden="true" />;
  return <PlatformGlyph platform={platform} className="h-[18px] w-[18px]" />;
}

/** `doneArt`: the figure on the success card, rendered by the page (components/ui/art/peeps is server-only). */
export default function ApplyForm({ me = null, doneArt = null }: { me?: ApplyMe; doneArt?: ReactNode }) {
  const [d, setD] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [announce, setAnnounce] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ ref: string; email: string; at: Date } | null>(null);
  const [serverErr, setServerErr] = useState<ReactNode>(null);
  const [uploading, setUploading] = useState(0);
  const [website, setWebsite] = useState("");
  const [editIdentity, setEditIdentity] = useState(false);
  const [fromReview, setFromReview] = useState(false);
  const source = useRef("");
  const ready = useRef(false);
  const moved = useRef(false);
  const submitting = useRef(false);
  const lastSubmit = useRef(0);
  const coolUntil = useRef(0);
  const card = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    source.current = sourceFrom(window.location.search);
    let draft = emptyDraft();
    let at = 0;
    try {
      const saved = restoreDraft(window.sessionStorage.getItem(DRAFT_KEY));
      if (saved) {
        draft = saved.draft;
        at = saved.step;
      }
    } catch {
      /* storage blocked: the form still works, it just won't survive a reload */
    }
    if (me) draft = { ...draft, personal: { ...draft.personal, fullName: draft.personal.fullName || me.name, email: draft.personal.email || me.email } };
    setD(draft);
    setStep(at);
    ready.current = true;
  }, [me]);

  useEffect(() => {
    if (!ready.current) return;
    try {
      if (done) window.sessionStorage.removeItem(DRAFT_KEY);
      else window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: d, step }));
    } catch {}
  }, [d, step, done]);

  // A field already marked wrong is re-checked as it is edited, so the error clears the moment it is fixed.
  useEffect(() => {
    setErrors((e) => {
      const keys = Object.keys(e).filter((k) => stepOf(k) === step);
      if (!keys.length) return e;
      const now = stepErrors(step, d);
      const next = { ...e };
      let changed = false;
      for (const k of keys) {
        if (now[k] !== e[k]) {
          changed = true;
          if (now[k]) next[k] = now[k];
          else delete next[k];
        }
      }
      return changed ? next : e;
    });
  }, [d, step]);

  useEffect(() => {
    if (!moved.current) return;
    head.current?.focus({ preventScroll: true });
    const el = card.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
  }, [step, done]);

  const setPersonal = (k: keyof Draft["personal"], v: string) => setD((x) => ({ ...x, personal: { ...x.personal, [k]: v } }));
  const setStats = (k: keyof Draft["stats"], v: string) => setD((x) => ({ ...x, stats: { ...x.stats, [k]: v } }));
  const setProposal = (k: keyof Draft["proposal"], v: string) => setD((x) => ({ ...x, proposal: { ...x.proposal, [k]: v } }));
  const setRows = (fn: (rows: PlatformDraft[]) => PlatformDraft[]) => setD((x) => ({ ...x, socials: fn(x.socials) }));
  const setFiles = useCallback((fn: (prev: UploadedFile[]) => UploadedFile[]) => setD((x) => ({ ...x, files: fn(x.files) })), []);
  const clearStepErrors = (at: number) => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => stepOf(k) !== at)));

  const blur = (key: string) => {
    const now = stepErrors(stepOf(key), d);
    setErrors((e) => {
      if (now[key] === e[key]) return e;
      const next = { ...e };
      if (now[key]) next[key] = now[key];
      else delete next[key];
      return next;
    });
  };

  const focusFirstInvalid = () =>
    window.requestAnimationFrame(() => {
      const el = card.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (el) el.focus();
      else head.current?.focus();
    });

  const flag = (errs: Record<string, string>, at: number) => {
    const n = Object.keys(errs).length;
    setErrors((e) => ({ ...Object.fromEntries(Object.entries(e).filter(([k]) => stepOf(k) !== at)), ...errs }));
    setSummary(n === 1 ? "One answer needs attention before you continue." : `${n} answers need attention before you continue.`);
    focusFirstInvalid();
  };

  const go = (i: number, opts: { edit?: boolean } = {}) => {
    moved.current = true;
    setSummary("");
    setServerErr(null);
    setFromReview(!!opts.edit);
    setStep(i);
    setAnnounce(i === REVIEW ? "Review your application" : `Step ${i + 1} of ${STEPS.length}: ${STEPS[i]}`);
  };

  const next = () => {
    if (step === 2 && uploading > 0) return setSummary("Your files are still uploading. Wait for them to finish, then continue.");
    const errs = stepErrors(step, d);
    if (Object.keys(errs).length) return flag(errs, step);
    go(fromReview ? REVIEW : step + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < REVIEW) return next();
    // A ref, not state: two taps in the same frame both see sending === false.
    if (submitting.current) return;
    const now = Date.now();
    if (now < coolUntil.current) return setServerErr("Too many attempts in a short time. Wait a minute, then submit again.");
    if (now - lastSubmit.current < 4000) return;
    for (let i = 0; i <= REVIEW; i++) {
      const errs = stepErrors(i, d);
      if (Object.keys(errs).length) {
        if (i !== step) go(i);
        return flag(errs, i);
      }
    }
    submitting.current = true;
    lastSubmit.current = now;
    setSending(true);
    setServerErr(null);
    try {
      const r = await api<{ ok: true; ref: string }>("/api/partners/apply", { method: "POST", json: payload(d, source.current, website) });
      moved.current = true;
      setDone({ ref: r.ref, email: d.personal.email.trim(), at: new Date() });
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE") {
        const ref = typeof err.data?.ref === "string" ? err.data.ref : "";
        setServerErr(
          <>
            {`You already have an open application (ID ${ref}). We will get back to you on that one.`}
            {me && (
              <>
                {" "}
                <Link href="/dashboard/partnerships" className="font-medium underline underline-offset-2">
                  Track it in My Partnerships
                </Link>
              </>
            )}
          </>,
        );
      } else if (err instanceof ApiError && err.status === 429) {
        coolUntil.current = Date.now() + 60_000;
        setServerErr(err.message || "We have received a lot of attempts. Please wait a while, then try again.");
      } else if (err instanceof ApiError && err.code === "VALIDATION" && Array.isArray(err.data?.issues)) {
        const errs: Record<string, string> = {};
        for (const i of err.data.issues as { path?: unknown[]; message?: string }[]) {
          const k = fieldKey((i.path ?? []).map(String).join("."));
          if (k && !(k in errs)) errs[k] = i.message ?? "Check this answer";
        }
        const firstStep = Math.min(...Object.keys(errs).map(stepOf), REVIEW);
        if (firstStep !== step) go(firstStep);
        flag(errs, firstStep);
      } else {
        setServerErr(err instanceof ApiError && err.status ? err.message : "Your application didn't send. Check your connection and try again. Your answers are still here.");
      }
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };

  if (done)
    return (
      <div ref={card} className="mx-auto max-w-2xl scroll-mt-24 rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-10" role="status">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime/15">
            <Check className="h-6 w-6 text-lime-ink" aria-hidden="true" />
          </span>
          {doneArt}
        </div>
        <h3 ref={head} tabIndex={-1} className="mt-5 text-[24px] font-semibold tracking-tight focus:outline-none sm:text-[26px]">
          {"You're officially in!"}
        </h3>
        <p className="mt-3 text-[16px] leading-relaxed text-foreground">
          {"Your creator partnership application has been submitted. We'll review your profile and notify you when there's an update."}
        </p>
        <dl className="mt-6 grid gap-3 rounded-2xl bg-secondary/50 p-4 text-[14px] sm:grid-cols-3 sm:p-5">
          <div className="min-w-0">
            <dt className="text-[12px] text-muted-foreground">Application ID</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{done.ref}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted-foreground">Submitted on</dt>
            <dd className="mt-0.5 tabular-nums">{fmtDay(done.at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[12px] text-muted-foreground">Status</dt>
            <dd className="mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-[12px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-ink" aria-hidden="true" />
                Submitted
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">A confirmation email is on its way to {done.email}.</p>
        <Button asChild variant="lime" className="mt-7 h-12 px-6 text-[15px]">
          <Link href={trackHref(done.ref, !!me)}>
            Track My Application
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </Link>
        </Button>
        {!me && <p className="mt-3 text-[13px] text-muted-foreground">Sign in with {done.email} to track it.</p>}
      </div>
    );

  const p = d.personal;
  const s = d.stats;
  const q = d.proposal;
  const err = (k: string) => errors[k];
  const ctl = (k: string, hint?: boolean) => ({ ...describe(fieldId(k), err(k), hint), onBlur: () => blur(k) });
  const asMe = !!me?.verified && !editIdentity && !!p.fullName.trim() && p.email.trim().toLowerCase() === me.email.toLowerCase();
  const onChip = (pl: string) => {
    clearStepErrors(1);
    setRows((rows) => toggleChip(rows, pl));
  };

  return (
    <div ref={card} className="mx-auto max-w-3xl scroll-mt-24 rounded-[24px] border border-foreground/[0.08] bg-card p-5 sm:p-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow">Your partnership application</p>
        <p className="text-[13px] tabular-nums text-muted-foreground" aria-hidden="true">
          {step < REVIEW ? `Step ${step + 1} of ${STEPS.length}` : "Review"}
        </p>
      </div>
      <Stepper steps={STEPPER} current={step} onStepChange={(i) => go(i, { edit: step === REVIEW })} aria-label="Application progress" />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <form onSubmit={submit} noValidate className="mt-6" aria-labelledby="pa-step-title">
        <h3 id="pa-step-title" ref={head} tabIndex={-1} className="text-[20px] font-semibold tracking-tight focus:outline-none sm:text-[22px]">
          {TITLES[step]}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{LEADS[step]}</p>

        <StepPanels current={step} className="mt-6">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {asMe ? (
                <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary/40 px-4 py-2.5 sm:col-span-2">
                  <p className="min-w-0 break-words text-[15px]">
                    <span className="text-muted-foreground">Applying as </span>
                    <span className="font-medium">{p.fullName}</span>, <span className="break-all">{p.email}</span>
                  </p>
                  <Button type="button" variant="ghost" className="h-11 px-3" onClick={() => setEditIdentity(true)} aria-label="Change your name or email">
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Field id={fieldId("personal.fullName")} label="Full name" error={err("personal.fullName")}>
                    <Input {...ctl("personal.fullName")} className="rounded-xl" autoComplete="name" maxLength={80} value={p.fullName} onChange={(e) => setPersonal("fullName", e.target.value)} />
                  </Field>
                  <Field id={fieldId("personal.email")} label="Email" error={err("personal.email")}>
                    <Input {...ctl("personal.email")} className="rounded-xl" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={200} value={p.email} onChange={(e) => setPersonal("email", e.target.value)} />
                  </Field>
                </>
              )}
              <Field id={fieldId("personal.country")} label="Country" error={err("personal.country")}>
                <CountryCombobox {...describe(fieldId("personal.country"), err("personal.country"))} value={p.country} onChange={(v) => setPersonal("country", v)} onBlur={() => blur("personal.country")} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              <fieldset aria-describedby={err("socials") ? `${fieldId("socials")}-err` : undefined}>
                <legend className="mb-2.5 text-[15px] font-medium">Where do you share your content?</legend>
                <div className="flex flex-wrap gap-2">
                  {CHIP_PLATFORMS.map((pl) => {
                    const on = d.socials.some((r) => r.platform === pl);
                    return (
                      <button
                        key={pl}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChip(pl)}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                          on ? "bg-foreground font-medium text-background" : "bg-secondary/60 text-foreground hover:bg-secondary",
                        )}
                      >
                        <ChipIcon platform={pl} />
                        {PARTNER_PLATFORM_LABEL[pl]}
                        {on && <Check className="h-4 w-4" strokeWidth={2.75} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
                <FieldError id={fieldId("socials")} error={err("socials")} />
              </fieldset>
              {d.socials.map((row, i) => (
                <PlatformRow
                  key={i}
                  i={i}
                  row={row}
                  errors={errors}
                  onChange={(r) => setRows((rows) => rows.map((x, j) => (j === i ? r : x)))}
                  onRemove={() => {
                    clearStepErrors(1);
                    setRows((rows) => rows.filter((_, j) => j !== i));
                  }}
                  onBlur={blur}
                />
              ))}
              {d.socials.length > 0 && d.socials.length < 6 && (
                <Button type="button" variant="outline" className="h-12 justify-self-start px-5" onClick={() => setRows((rows) => [...rows, emptyRow()])}>
                  <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                  Add another platform
                </Button>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fieldId("stats.avgViews")} label="Average views per Reel, video or post" hint="A rough number is fine, for example 12,500." error={err("stats.avgViews")}>
                <Input {...ctl("stats.avgViews", true)} className="rounded-xl tabular-nums" inputMode="numeric" autoComplete="off" maxLength={16} value={s.avgViews} onChange={(e) => setStats("avgViews", e.target.value)} />
              </Field>
              <Field id={fieldId("stats.niche")} label="Primary content category" error={err("stats.niche")}>
                <select {...ctl("stats.niche")} value={s.niche} onChange={(e) => setStats("niche", e.target.value)} className={CONTROL}>
                  <option value="">Choose a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={fieldId("stats.engagementRate")} label="Engagement rate (%)" optional hint="If you know it. 0 to 100." error={err("stats.engagementRate")}>
                <Input {...ctl("stats.engagementRate", true)} className="rounded-xl tabular-nums" inputMode="decimal" autoComplete="off" maxLength={8} value={s.engagementRate} onChange={(e) => setStats("engagementRate", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-1 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                  <span>Analytics screenshot or media kit</span>
                  <span className="text-[12px] font-normal">Optional</span>
                </p>
                <p className="mb-3 text-[13px] leading-snug text-muted-foreground">It helps us review faster. Never share passwords or login details.</p>
                <Files files={d.files} onChange={setFiles} onBusy={setUploading} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-5">
              <fieldset aria-describedby={err("proposal.preference") ? `${fieldId("proposal.preference")}-err` : undefined}>
                <legend className="mb-2.5 text-[15px] font-medium">How would you like to partner with Outlly?</legend>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {SHORT_PREFERENCES.map((o, i) => {
                    const on = q.preference === o.value;
                    return (
                      <label
                        key={o.value}
                        className={cn(
                          "flex min-h-11 cursor-pointer gap-3 rounded-2xl border px-4 py-3.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 sm:flex-col sm:gap-2",
                          on ? "border-lime-ink bg-lime/10" : "border-foreground/[0.08] bg-secondary/30 hover:bg-secondary/60",
                        )}
                      >
                        <input
                          type="radio"
                          name="pa-preference"
                          value={o.value}
                          checked={on}
                          onChange={() => setProposal("preference", o.value)}
                          onBlur={() => blur("proposal.preference")}
                          id={i === 0 ? fieldId("proposal.preference") : undefined}
                          aria-invalid={err("proposal.preference") ? true : undefined}
                          className="sr-only"
                        />
                        <span aria-hidden="true" className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-lime-ink bg-lime-ink" : "border-muted-foreground/60")}>
                          {on && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold">{o.title}</span>
                          <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">{o.body}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FieldError id={fieldId("proposal.preference")} error={err("proposal.preference")} />
              </fieldset>
              <Field id={fieldId("proposal.extra")} label="Anything else you'd like us to know?" optional error={err("proposal.extra")}>
                <Textarea {...ctl("proposal.extra")} className="rounded-xl" rows={3} maxLength={EXTRA_MAX} value={q.extra} onChange={(e) => setProposal("extra", e.target.value)} />
                <div className="mt-1 flex justify-end">
                  <Counter value={q.extra.trim().length} max={EXTRA_MAX} />
                </div>
              </Field>
            </div>
          )}

          {step === REVIEW && (
            <div className="grid gap-5">
              <Review d={d} onEdit={(i) => go(i, { edit: true })} />
              <div>
                <label htmlFor={fieldId("consent")} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl py-2 text-[14px] leading-relaxed">
                  <input
                    {...describe(fieldId("consent"), err("consent"))}
                    type="checkbox"
                    checked={d.consent}
                    onChange={(e) => setD((x) => ({ ...x, consent: e.target.checked }))}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--lime-ink))]"
                  />
                  <span>
                    I accept the{" "}
                    <Link href="/terms" target="_blank" className="font-medium underline underline-offset-2">
                      Terms
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-2">
                      Privacy Policy
                    </Link>
                    , and confirm my details are accurate so Outlly can review my public profiles.
                  </span>
                </label>
                <FieldError id={fieldId("consent")} error={err("consent")} />
              </div>
            </div>
          )}
        </StepPanels>

        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="pa-website">Website</label>
          <input id="pa-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        <p className="sr-only" aria-live="assertive">
          {summary}
        </p>
        {summary && (
          <p aria-hidden="true" className={cn("mt-6 rounded-xl bg-destructive/10 px-4 py-3 text-[14px]", ERROR_INK)}>
            {summary}
          </p>
        )}
        {serverErr && (
          <p role="alert" className={cn("mt-6 rounded-xl bg-destructive/10 px-4 py-3 text-[14px]", ERROR_INK)}>
            {serverErr}
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          {step > 0 && !fromReview ? (
            <Button type="button" variant="outline" className="h-12 px-5" onClick={() => go(step - 1)} disabled={sending}>
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < REVIEW ? (
            <Button type="submit" variant="lime" className="h-12 px-6 text-[15px]">
              {fromReview ? "Save and review" : "Next"}
              <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          ) : (
            <MorphingButton type="submit" variant="lime" className="h-12 px-6 text-[15px]" status={sending ? "loading" : "idle"} loadingText="Submitting" successText="Submitted" disabled={sending}>
              Submit My Application
            </MorphingButton>
          )}
        </div>
        {step === REVIEW ? (
          <p className="mt-4 text-[13px] text-muted-foreground">Free to apply. Our team will review your profile before making an offer.</p>
        ) : (
          <p className="mt-4 text-[12px] text-muted-foreground">Your answers are kept in this browser tab until you submit.</p>
        )}
      </form>
    </div>
  );
}
