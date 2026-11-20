"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Counter } from "@/components/ui/field";
import { api, ApiError } from "@/lib/client/api";
import { reduced } from "@/lib/motion/prefs";
import { cn } from "@/lib/utils";
import { AGE_RANGES, PARTNER_NICHES, PARTNER_NICHE_LABEL, PARTNER_PREFERENCES, PARTNER_PREFERENCE_LABEL, PARTNER_SUBMITTED_MESSAGE, POSTING_FREQUENCIES, POSTING_FREQUENCY_LABEL } from "@/lib/partners/types";
import { COUNTRIES } from "./form/countries";
import { CONTROL, ERROR_INK, Field, FieldError, describe } from "./form/Field";
import { Stepper } from "./form/Stepper";
import { SocialRow } from "./form/SocialRow";
import { Files } from "./form/Files";
import { Review } from "./form/Review";
import { DRAFT_KEY, STEPS, emptyDraft, emptySocial, fieldId, payload, restoreDraft, sourceFrom, stepErrors, type Draft, type SocialDraft, type UploadedFile } from "./form/draft";

const GROUPS = ["personal", "socials", "stats", "proposal", "consent"];
const stepOf = (key: string) => Math.max(0, GROUPS.findIndex((g) => key === g || key.startsWith(`${g}.`)));
const HINT_WHY = "Between 40 and 1200 characters.";
const TEXTAREA = "rounded-xl";

type Group = "personal" | "stats" | "proposal";

export default function ApplyForm() {
  const [d, setD] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ ref: string; email: string } | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [website, setWebsite] = useState("");
  const source = useRef("");
  const ready = useRef(false);
  const moved = useRef(false);
  const lastSubmit = useRef(0);
  const coolUntil = useRef(0);
  const card = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    source.current = sourceFrom(window.location.search);
    try {
      const saved = restoreDraft(window.sessionStorage.getItem(DRAFT_KEY));
      if (saved) {
        setD(saved.draft);
        setStep(saved.step);
      }
    } catch {
      /* storage blocked: the form still works, it just won't survive a reload */
    }
    ready.current = true;
  }, []);

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

  const set = <G extends Group>(g: G, k: keyof Draft[G], v: Draft[G][keyof Draft[G]]) => setD((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const setRow = (i: number, row: SocialDraft) => setD((x) => ({ ...x, socials: x.socials.map((r, j) => (j === i ? row : r)) }));
  const setFiles = useCallback((fn: (prev: UploadedFile[]) => UploadedFile[]) => setD((x) => ({ ...x, files: fn(x.files) })), []);

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

  const go = (i: number) => {
    moved.current = true;
    setSummary("");
    setServerErr(null);
    setStep(i);
  };

  const next = () => {
    if (step === 2 && uploading > 0) return setSummary("Your files are still uploading. Wait for them to finish, then continue.");
    const errs = stepErrors(step, d);
    if (Object.keys(errs).length) return flag(errs, step);
    go(step + 1);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 4) return next();
    if (sending) return;
    const now = Date.now();
    if (now < coolUntil.current) return setServerErr("Too many attempts in a short time. Wait a minute, then submit again.");
    if (now - lastSubmit.current < 4000) return;
    for (let i = 0; i < STEPS.length; i++) {
      const errs = stepErrors(i, d);
      if (Object.keys(errs).length) {
        if (i !== step) go(i);
        return flag(errs, i);
      }
    }
    lastSubmit.current = now;
    setSending(true);
    setServerErr(null);
    try {
      const r = await api<{ ok: true; ref: string }>("/api/partners/apply", { method: "POST", json: payload(d, source.current, website) });
      moved.current = true;
      setDone({ ref: r.ref, email: d.personal.email.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE") {
        const ref = typeof err.data?.ref === "string" ? err.data.ref : "";
        setServerErr(`You already have an open application (ID ${ref}). We will get back to you on that one.`);
      } else if (err instanceof ApiError && err.status === 429) {
        coolUntil.current = Date.now() + 60_000;
        setServerErr(err.message || "We have received a lot of attempts. Please wait a while, then try again.");
      } else if (err instanceof ApiError && err.code === "VALIDATION" && Array.isArray(err.data?.issues)) {
        const errs: Record<string, string> = {};
        for (const i of err.data.issues as { path?: unknown[]; message?: string }[]) {
          const k = (i.path ?? []).map(String).join(".");
          if (k && !(k in errs)) errs[k] = i.message ?? "Check this answer";
        }
        const firstStep = Math.min(...Object.keys(errs).map(stepOf), 4);
        if (firstStep !== step) go(firstStep);
        flag(errs, firstStep);
      } else {
        setServerErr(err instanceof ApiError && err.status ? err.message : "Your application didn't send. Check your connection and try again. Your answers are still here.");
      }
    } finally {
      setSending(false);
    }
  };

  if (done)
    return (
      <div ref={card} className="mx-auto max-w-2xl scroll-mt-24 rounded-[24px] border border-foreground/[0.08] bg-card p-6 sm:p-10" role="status">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime/15">
          <Check className="h-6 w-6 text-lime-ink" aria-hidden="true" />
        </span>
        <h3 ref={head} tabIndex={-1} className="mt-5 text-[22px] font-semibold tracking-tight focus:outline-none">
          Application submitted
        </h3>
        <p className="mt-3 text-[16px] leading-relaxed text-foreground">{PARTNER_SUBMITTED_MESSAGE}</p>
        <p className="mt-5 inline-flex rounded-xl bg-secondary/60 px-4 py-2.5 text-[15px] font-medium tabular-nums">Application ID: {done.ref}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">A confirmation email is on its way to {done.email}.</p>
        <Button asChild variant="outline" className="mt-7 h-12 px-6">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    );

  const p = d.personal;
  const s = d.stats;
  const q = d.proposal;
  const err = (k: string) => errors[k];
  const ctl = (k: string, hint?: boolean) => ({ ...describe(fieldId(k), err(k), hint), onBlur: () => blur(k) });

  return (
    <div ref={card} className="mx-auto max-w-3xl scroll-mt-24 rounded-[24px] border border-foreground/[0.08] bg-card p-5 sm:p-8">
      <Stepper step={step} onGo={go} />
      <form onSubmit={submit} noValidate className="mt-6" aria-labelledby="pa-step-title">
        <h3 id="pa-step-title" ref={head} tabIndex={-1} className="text-[20px] font-semibold tracking-tight focus:outline-none sm:text-[22px]">
          {["About you", "Your social accounts", "Your performance", "Your proposal", "Review and submit"][step]}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          {
            [
              "We use these details to contact you about your application.",
              "Add the accounts you would post on. Mark the one you are best known for as primary.",
              "Creator-provided. We may verify figures before making an offer.",
              "Tell us how a partnership with Outlly could work for you and your audience.",
              "Check your answers. Use Edit to change anything before you submit.",
            ][step]
          }
        </p>

        <div className="mt-6">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fieldId("personal.fullName")} label="Full name" error={err("personal.fullName")}>
                <Input {...ctl("personal.fullName")} className="rounded-xl" autoComplete="name" maxLength={80} value={p.fullName} onChange={(e) => set("personal", "fullName", e.target.value)} />
              </Field>
              <Field id={fieldId("personal.email")} label="Email" error={err("personal.email")}>
                <Input {...ctl("personal.email")} className="rounded-xl" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={200} value={p.email} onChange={(e) => set("personal", "email", e.target.value)} />
              </Field>
              <Field id={fieldId("personal.country")} label="Country" error={err("personal.country")}>
                <select {...ctl("personal.country")} autoComplete="country-name" value={p.country} onChange={(e) => set("personal", "country", e.target.value)} className={CONTROL}>
                  <option value="">Choose your country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={fieldId("personal.city")} label="City" optional error={err("personal.city")}>
                <Input {...ctl("personal.city")} className="rounded-xl" autoComplete="address-level2" maxLength={80} value={p.city} onChange={(e) => set("personal", "city", e.target.value)} />
              </Field>
              <Field id={fieldId("personal.phone")} label="Phone" optional hint="Include your country code, for example +91." error={err("personal.phone")}>
                <Input {...ctl("personal.phone", true)} className="rounded-xl" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={p.phone} onChange={(e) => set("personal", "phone", e.target.value)} />
              </Field>
              <Field id={fieldId("personal.brandName")} label="Creator or business name" optional error={err("personal.brandName")}>
                <Input {...ctl("personal.brandName")} className="rounded-xl" autoComplete="organization" maxLength={80} value={p.brandName} onChange={(e) => set("personal", "brandName", e.target.value)} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4">
              {d.socials.map((row, i) => (
                <SocialRow
                  key={i}
                  i={i}
                  row={row}
                  primary={d.primary === i}
                  canRemove={d.socials.length > 1}
                  errors={errors}
                  onChange={(r) => setRow(i, r)}
                  onPrimary={() => setD((x) => ({ ...x, primary: i }))}
                  onRemove={() => {
                    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => stepOf(k) !== 1)));
                    setD((x) => ({ ...x, socials: x.socials.filter((_, j) => j !== i), primary: x.primary === i ? 0 : x.primary > i ? x.primary - 1 : x.primary }));
                  }}
                  onBlur={blur}
                />
              ))}
              <FieldError id={fieldId("socials")} error={err("socials")} />
              {d.socials.length < 6 && (
                <Button type="button" variant="outline" className="h-12 justify-self-start px-5" onClick={() => setD((x) => ({ ...x, socials: [...x.socials, emptySocial()] }))}>
                  <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                  Add another account
                </Button>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["avgViews", "Average views per post"],
                  ["reach", "Average reach per post"],
                  ["avgLikes", "Average likes"],
                  ["avgComments", "Average comments"],
                  ["avgShares", "Average shares"],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} id={fieldId(`stats.${k}`)} label={label} error={err(`stats.${k}`)}>
                  <Input {...ctl(`stats.${k}`)} className="rounded-xl tabular-nums" inputMode="numeric" autoComplete="off" maxLength={16} value={s[k]} onChange={(e) => set("stats", k, e.target.value)} />
                </Field>
              ))}
              <Field id={fieldId("stats.engagementRate")} label="Engagement rate (%)" optional hint="0 to 100." error={err("stats.engagementRate")}>
                <Input {...ctl("stats.engagementRate", true)} className="rounded-xl tabular-nums" inputMode="decimal" autoComplete="off" maxLength={8} value={s.engagementRate} onChange={(e) => set("stats", "engagementRate", e.target.value)} />
              </Field>
              <Field id={fieldId("stats.audienceCountries")} label="Top audience countries" optional hint="For example: India 60%, United States 15%." error={err("stats.audienceCountries")} className="sm:col-span-2">
                <Input {...ctl("stats.audienceCountries", true)} className="rounded-xl" maxLength={200} value={s.audienceCountries} onChange={(e) => set("stats", "audienceCountries", e.target.value)} />
              </Field>
              <Field id={fieldId("stats.ageRange")} label="Main audience age" error={err("stats.ageRange")}>
                <select {...ctl("stats.ageRange")} value={s.ageRange} onChange={(e) => set("stats", "ageRange", e.target.value)} className={CONTROL}>
                  <option value="">Choose an age range</option>
                  {AGE_RANGES.map((a) => (
                    <option key={a} value={a}>
                      {a === "mixed" ? "Mixed ages" : a}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={fieldId("stats.frequency")} label="How often you post" error={err("stats.frequency")}>
                <select {...ctl("stats.frequency")} value={s.frequency} onChange={(e) => set("stats", "frequency", e.target.value)} className={CONTROL}>
                  <option value="">Choose a frequency</option>
                  {POSTING_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {POSTING_FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={fieldId("stats.niche")} label="Content niche" error={err("stats.niche")} className="sm:col-span-2">
                <select {...ctl("stats.niche")} value={s.niche} onChange={(e) => set("stats", "niche", e.target.value)} className={CONTROL}>
                  <option value="">Choose a niche</option>
                  {PARTNER_NICHES.map((n) => (
                    <option key={n} value={n}>
                      {PARTNER_NICHE_LABEL[n]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-2 text-[13px] font-medium text-muted-foreground">Analytics attachments (optional)</p>
                <p className="mb-3 text-[13px] leading-snug text-muted-foreground">Screenshots of your analytics help us review faster. Never share passwords or login details.</p>
                <Files files={d.files} onChange={setFiles} onBusy={setUploading} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Long id="proposal.why" label="Why do you want to partner with Outlly?" hint={HINT_WHY} max={1200} value={q.why} error={err("proposal.why")} ctl={ctl} onChange={(v) => set("proposal", "why", v)} />
              <Long id="proposal.how" label="How would you introduce Outlly to your audience?" max={1200} value={q.how} error={err("proposal.how")} ctl={ctl} onChange={(v) => set("proposal", "how", v)} />
              <Field id={fieldId("proposal.contentType")} label="Content type" hint="For example: a tutorial Reel and a story series." error={err("proposal.contentType")}>
                <Input {...ctl("proposal.contentType", true)} className="rounded-xl" maxLength={120} value={q.contentType} onChange={(e) => set("proposal", "contentType", e.target.value)} />
              </Field>
              <Field id={fieldId("proposal.posts")} label="How many posts" hint="1 to 50." error={err("proposal.posts")}>
                <Input {...ctl("proposal.posts", true)} className="rounded-xl tabular-nums" inputMode="numeric" maxLength={3} value={q.posts} onChange={(e) => set("proposal", "posts", e.target.value)} />
              </Field>
              <fieldset className="sm:col-span-2" aria-describedby={err("proposal.preference") ? `${fieldId("proposal.preference")}-err` : undefined}>
                <legend className="mb-2 text-[13px] font-medium text-muted-foreground">Partnership preference</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PARTNER_PREFERENCES.map((v, i) => {
                    const on = q.preference === v;
                    return (
                      <label
                        key={v}
                        className={cn(
                          "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-foreground/[0.08] px-4 py-3 text-[15px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                          on ? "bg-secondary font-medium" : "bg-secondary/30 hover:bg-secondary/60",
                        )}
                      >
                        <input
                          type="radio"
                          name="pa-preference"
                          value={v}
                          checked={on}
                          onChange={() => set("proposal", "preference", v)}
                          onBlur={() => blur("proposal.preference")}
                          id={i === 0 ? fieldId("proposal.preference") : undefined}
                          aria-invalid={err("proposal.preference") ? true : undefined}
                          className="sr-only"
                        />
                        <span aria-hidden="true" className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-lime-ink bg-lime-ink" : "border-muted-foreground/60")}>
                          {on && <Check className="h-3 w-3 text-background" strokeWidth={3} />}
                        </span>
                        {PARTNER_PREFERENCE_LABEL[v]}
                      </label>
                    );
                  })}
                </div>
                <FieldError id={fieldId("proposal.preference")} error={err("proposal.preference")} />
              </fieldset>
              <Field id={fieldId("proposal.compensation")} label="Expected compensation" optional hint="In your own words. This helps us shape an offer, it is not a commitment." error={err("proposal.compensation")} className="sm:col-span-2">
                <Input {...ctl("proposal.compensation", true)} className="rounded-xl" maxLength={200} value={q.compensation} onChange={(e) => set("proposal", "compensation", e.target.value)} />
              </Field>
              <Long id="proposal.pastCollabs" label="Past brand collaborations" optional max={1200} value={q.pastCollabs} error={err("proposal.pastCollabs")} ctl={ctl} onChange={(v) => set("proposal", "pastCollabs", v)} />
              <div className="sm:col-span-2">
                <p className="mb-2 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                  <span>Portfolio links</span>
                  <span className="text-[12px] font-normal">Optional</span>
                </p>
                <div className="grid gap-2">
                  {q.portfolio.map((u, i) => {
                    const k = `proposal.portfolio.${i}`;
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <Input
                            {...ctl(k)}
                            aria-label={`Portfolio link ${i + 1}`}
                            className="rounded-xl"
                            type="url"
                            inputMode="url"
                            placeholder="https://"
                            maxLength={300}
                            value={u}
                            onChange={(e) => set("proposal", "portfolio", q.portfolio.map((x, j) => (j === i ? e.target.value : x)))}
                          />
                          {q.portfolio.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" aria-label={`Remove portfolio link ${i + 1}`} onClick={() => set("proposal", "portfolio", q.portfolio.filter((_, j) => j !== i))}>
                              <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                        <FieldError id={fieldId(k)} error={err(k)} />
                      </div>
                    );
                  })}
                </div>
                {q.portfolio.length < 5 && (
                  <Button type="button" variant="ghost" className="mt-2 h-11 px-3" onClick={() => set("proposal", "portfolio", [...q.portfolio, ""])}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add a link
                  </Button>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-5">
              <Review d={d} onEdit={go} />
              <fieldset className="grid gap-2">
                <legend className="sr-only">Agreements</legend>
                <Agree id="consent.terms" checked={d.consent.terms} error={err("consent.terms")} onChange={(v) => setD((x) => ({ ...x, consent: { ...x.consent, terms: v } }))}>
                  I accept the{" "}
                  <Link href="/terms" target="_blank" className="font-medium underline underline-offset-2">
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-2">
                    Privacy Policy
                  </Link>
                  .
                </Agree>
                <Agree id="consent.accuracy" checked={d.consent.accuracy} error={err("consent.accuracy")} onChange={(v) => setD((x) => ({ ...x, consent: { ...x.consent, accuracy: v } }))}>
                  I confirm the information is accurate and consent to Outlly evaluating my public profiles and the figures I provided.
                </Agree>
              </fieldset>
            </div>
          )}
        </div>

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
          {step > 0 ? (
            <Button type="button" variant="outline" className="h-12 px-5" onClick={() => go(step - 1)} disabled={sending}>
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <Button type="submit" variant="lime" className="h-12 px-6 text-[15px]">
              Next
              <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="submit" variant="lime" className="h-12 px-6 text-[15px]" disabled={sending} aria-busy={sending}>
              {sending ? "Submitting\u2026" : "Submit Partnership Application"}
            </Button>
          )}
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">Your answers are kept in this browser tab until you submit.</p>
      </form>
    </div>
  );
}

function Long({
  id,
  label,
  hint,
  optional,
  max,
  value,
  error,
  ctl,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  max: number;
  value: string;
  error?: string;
  ctl: (k: string, hint?: boolean) => ReturnType<typeof describe> & { onBlur: () => void };
  onChange: (v: string) => void;
}) {
  return (
    <Field id={fieldId(id)} label={label} optional={optional} hint={hint} error={error} className="sm:col-span-2">
      <Textarea {...ctl(id, !!hint)} className={TEXTAREA} rows={4} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1 flex justify-end">
        <Counter value={value.trim().length} max={max} />
      </div>
    </Field>
  );
}

function Agree({ id, checked, error, onChange, children }: { id: string; checked: boolean; error?: string; onChange: (v: boolean) => void; children: ReactNode }) {
  const fid = fieldId(id);
  return (
    <div>
      <label htmlFor={fid} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl py-2 text-[14px] leading-relaxed">
        <input {...describe(fid, error)} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--lime-ink))]" />
        <span>{children}</span>
      </label>
      <FieldError id={fid} error={error} />
    </div>
  );
}
