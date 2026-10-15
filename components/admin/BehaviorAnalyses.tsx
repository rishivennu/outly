"use client";
import { useRef, useState } from "react";
import { ArrowRight, Check, ClipboardCopy, FlaskConical, History as HistoryIcon, Lightbulb, Loader2, ShieldAlert, Sparkles, Target, Users } from "lucide-react";
import type { AnalysisFull, AnalysisSummary } from "@/lib/admin/behavior";
import { adminApi } from "@/lib/client/admin-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Pill, ago, fmtDate } from "./ui";
import { HEALTH, LEVEL, SEVERITY, pct } from "./behavior-fmt";
import { MOTION_OK, gsap, useGSAP } from "@/lib/motion/gsap";

type History = { items: AnalysisSummary[]; more: boolean; total: number };

export function BehaviorAnalyses({ history, selected, aiReady, range, users, onCount, setParam }: { history: History; selected: AnalysisFull | null; aiReady: boolean; range: number; users: number; onCount: (n: number) => void; setParam: (mut: (q: URLSearchParams) => void) => void }) {
  const toast = useToast();
  const [items, setItems] = useState(history.items);
  const [more, setMore] = useState(history.more);
  const [current, setCurrent] = useState<AnalysisFull | null>(selected);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [older, setOlder] = useState(false);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const show = (a: AnalysisFull) => {
    setCurrent(a);
    setParam((q) => {
      q.set("tab", "ai");
      q.set("v", a.id);
    });
  };

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await adminApi<{ analysis: AnalysisFull }>("/api/admin/behavior", { method: "POST", json: { rangeDays: range, focus: focus.trim() || null } });
      const a = r.analysis;
      const summary: AnalysisSummary = { id: a.id, version: a.version, createdAt: a.createdAt, createdBy: a.createdBy, model: a.model, rangeDays: a.rangeDays, focus: a.focus, headline: a.headline, health: a.health, durationMs: a.durationMs };
      setItems((x) => [summary, ...x.filter((i) => i.id !== summary.id)]);
      onCount(r.analysis.version);
      show(r.analysis);
      setFocus("");
      toast(`Version ${r.analysis.version} saved`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function open(id: string) {
    if (current?.id === id || loadingId) return;
    setLoadingId(id);
    try {
      const r = await adminApi<{ analysis: AnalysisFull }>(`/api/admin/behavior/${id}`);
      show(r.analysis);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingId(null);
    }
  }

  async function loadOlder() {
    const last = items[items.length - 1];
    if (!last) return;
    setOlder(true);
    try {
      const r = await adminApi<History>(`/api/admin/behavior?before=${last.version}`);
      setItems((x) => [...x, ...r.items.filter((i) => !x.some((y) => y.id === i.id))]);
      setMore(r.more);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setOlder(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle hint={`Reads the last ${range} days as anonymised totals. Names and emails never leave the server.`}>New analysis</CardTitle>
          {aiReady ? (
            <>
              <label htmlFor="beh-focus" className="mb-1.5 block text-[12.5px] font-medium">Question to focus on <span className="text-muted-foreground">(optional)</span></label>
              <Textarea id="beh-focus" value={focus} maxLength={300} rows={3} onChange={(e) => setFocus(e.target.value)} placeholder="Why do people connect a platform but never publish?" disabled={running} />
              <Button type="button" variant="lime" className="mt-3 w-full" onClick={run} disabled={running || users === 0}>
                {running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {running ? "Gemini is reading..." : `Run Gemini analysis (${range} days)`}
              </Button>
              {users === 0 && <p className="mt-2 text-[12px] text-muted-foreground">There are no users to analyse yet.</p>}
              {error && <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
            </>
          ) : (
            <div className="rounded-2xl bg-secondary px-4 py-3 text-[13px]">
              <p className="font-medium">Gemini isn't set up on this server.</p>
              <p className="mt-1 text-muted-foreground">Add <code>GEMINI_API_KEY</code> to the environment variables (Vercel, Project Settings, Environment Variables) and redeploy. The Run button appears here after that. Saved versions stay readable either way.</p>
            </div>
          )}
        </Card>

        <Card className="p-3 sm:p-3">
          <p className="eyebrow mb-2 flex items-center gap-1.5 px-2 pt-1 text-[11px]"><HistoryIcon className="h-3.5 w-3.5" aria-hidden /> Versions</p>
          {items.length ? (
            <ul className="flex max-h-[560px] flex-col gap-1 overflow-y-auto pr-1">
              {items.map((i) => {
                const on = current?.id === i.id;
                const h = HEALTH[i.health] ?? HEALTH.steady;
                return (
                  <li key={i.id}>
                    <button type="button" onClick={() => open(i.id)} aria-current={on ? "true" : undefined} aria-label={`Version ${i.version}, ${h.label}, ${fmtDate(i.createdAt, true)}: ${i.headline}`} className={cn("w-full rounded-2xl px-3 py-2.5 text-left transition-colors", on ? "bg-secondary" : "hover:bg-foreground/[0.04]")}>
                      <span className="flex items-center gap-2">
                        <span className={cn("font-display text-[13.5px] font-bold tabular", on && "text-lime-ink")}>v{i.version}</span>
                        <Pill tone={h.tone} className="h-5 px-2 text-[10.5px]">{h.label}</Pill>
                        <span className="ml-auto text-[11.5px] text-muted-foreground" suppressHydrationWarning>{loadingId === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : ago(i.createdAt)}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug">{i.headline}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{i.rangeDays} days · {i.createdBy}{i.focus ? " · focused" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2 pb-2 text-[13px] text-muted-foreground">No analyses yet. Each run is saved here as a new version, and nothing is ever overwritten.</p>
          )}
          {more && (
            <Button type="button" size="sm" variant="ghost" className="mt-1 w-full" onClick={loadOlder} disabled={older}>
              {older && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />} Show older versions
            </Button>
          )}
        </Card>
      </div>

      <div aria-live="polite" aria-busy={running} className="min-w-0">
        {running ? <Running users={users} range={range} /> : current ? <Detail a={current} /> : <Empty title="Pick or run an analysis" body="Gemini reads the same numbers as the Breakdown tab and explains what people are doing, who is at risk, and what to try next." />}
      </div>
    </div>
  );
}

function Running({ users, range }: { users: number; range: number }) {
  return (
    <Card>
      <p className="flex items-center gap-2 font-display text-[1.05rem] font-semibold"><Sparkles className="h-4 w-4 text-lime-ink" aria-hidden /> Reading {users.toLocaleString("en-IN")} people over {range} days</p>
      <p className="mt-1 text-[13px] text-muted-foreground">This usually takes 10 to 40 seconds. The result is saved as the next version.</p>
      <div className="mt-5 flex flex-col gap-2.5" aria-hidden>
        {[92, 78, 85, 60, 70].map((w, i) => <span key={i} className="h-3 rounded-full bg-foreground/[0.07] motion-safe:animate-pulse" style={{ width: `${w}%` }} />)}
      </div>
    </Card>
  );
}

export function asText(a: AnalysisFull) {
  const r = a.result;
  const lines = [`Outlly user behavior, version ${a.version} (${fmtDate(a.createdAt, true)}, last ${a.rangeDays} days)`, "", r.headline, "", r.summary];
  if (r.changes.length) lines.push("", "Since the previous version:", ...r.changes.map((c) => `- ${c}`));
  if (r.insights.length) lines.push("", "Insights:", ...r.insights.map((x) => `- ${x.title}: ${x.detail}${x.evidence ? ` (${x.evidence})` : ""}`));
  if (r.segments.length) lines.push("", "Segments:", ...r.segments.map((x) => `- ${x.name} (${x.share}): ${x.behavior} Action: ${x.action}`));
  if (r.risks.length) lines.push("", "Risks:", ...r.risks.map((x) => `- [${x.severity}] ${x.title}: ${x.detail}`));
  if (r.recommendations.length) lines.push("", "Recommendations:", ...r.recommendations.map((x, i) => `${i + 1}. ${x.title}: ${x.detail} Should move: ${x.metric}. Effort: ${x.effort}.`));
  if (r.experiments.length) lines.push("", "Experiments:", ...r.experiments.map((x) => `- If ${x.hypothesis} Test: ${x.test} Success: ${x.successMetric}`));
  return lines.join("\n");
}

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <section className="gs-in mt-6">
      <h3 className="mb-2.5 flex items-center gap-2 font-display text-[1rem] font-semibold"><Icon className="h-4 w-4 text-lime-ink" aria-hidden /> {title}</h3>
      {children}
    </section>
  );
}

function Detail({ a }: { a: AnalysisFull }) {
  const r = a.result;
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Reveal each version like a report being laid down: headline, summary, then sections in order.
  useGSAP(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo(gsap.utils.selector(root)(".gs-in"), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.07 });
    }, root);
    root.dataset.gsReady = "1";
  }, { dependencies: [a.id], scope: ref, revertOnUpdate: true });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(a));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Your browser blocked the clipboard.", "error");
    }
  };
  return (
    <div ref={ref} className="gs-stage">
    <Card as="article" aria-labelledby="beh-headline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[1.25rem] font-bold tracking-tight">Version {a.version}</span>
          <Pill tone={(HEALTH[r.health] ?? HEALTH.steady).tone}>{(HEALTH[r.health] ?? HEALTH.steady).label}</Pill>
          <Pill tone={LEVEL[r.confidence]}>{r.confidence} confidence</Pill>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy as text"}
        </Button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {fmtDate(a.createdAt, true)} · by {a.createdBy} · last {a.rangeDays} days{a.model ? ` · ${a.model}` : ""}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} s` : ""}
      </p>
      {a.focus && <p className="mt-3 rounded-2xl bg-secondary px-4 py-2.5 text-[13px]"><span className="text-muted-foreground">Focus: </span>{a.focus}</p>}

      <h2 id="beh-headline" className="gs-in mt-5 font-display text-[clamp(1.2rem,2.2vw,1.55rem)] font-bold leading-snug tracking-[-0.02em]">{r.headline}</h2>
      <p className="gs-in mt-2 max-w-3xl text-[14.5px] leading-relaxed text-muted-foreground">{r.summary}</p>

      {r.changes.length > 0 && (
        <Section icon={HistoryIcon} title={`Since version ${a.version - 1}`}>
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {r.changes.map((c, i) => <li key={i} className="flex gap-2"><ArrowRight className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />{c}</li>)}
          </ul>
        </Section>
      )}

      {r.insights.length > 0 && (
        <Section icon={Lightbulb} title="What people are doing">
          <div className="grid gap-3 md:grid-cols-2">
            {r.insights.map((x, i) => (
              <div key={i} className="rounded-2xl bg-secondary/60 p-4 hairline">
                <div className="flex items-start justify-between gap-2"><p className="font-semibold leading-snug">{x.title}</p><Pill tone={LEVEL[x.impact]} className="shrink-0">{x.impact} impact</Pill></div>
                <p className="mt-1.5 text-[13px] leading-relaxed">{x.detail}</p>
                {x.evidence && <p className="mt-2 text-[12px] text-muted-foreground">Evidence: {x.evidence}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {r.segments.length > 0 && (
        <Section icon={Users} title="Segments">
          <ul className="flex flex-col divide-y divide-border/60">
            {r.segments.map((x, i) => (
              <li key={i} className="grid gap-1 py-2.5 text-[13px] sm:grid-cols-[180px_1fr]">
                <p><b>{x.name}</b><span className="block text-[12px] text-muted-foreground">{x.share}</span></p>
                <p>{x.behavior} {x.action && <><span className="text-muted-foreground">Action: </span>{x.action}</>}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.risks.length > 0 && (
        <Section icon={ShieldAlert} title="Risks">
          <ul className="flex flex-col gap-2">
            {r.risks.map((x, i) => <li key={i} className="flex items-start gap-3 text-[13px]"><Pill tone={SEVERITY[x.severity]} className="mt-0.5 shrink-0">{x.severity}</Pill><span><b>{x.title}.</b> {x.detail}</span></li>)}
          </ul>
        </Section>
      )}

      {r.recommendations.length > 0 && (
        <Section icon={Target} title="Recommendations">
          <ol className="flex flex-col gap-3">
            {r.recommendations.map((x, i) => (
              <li key={i} className="flex gap-3 text-[13px]">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lime text-[12px] font-bold text-[hsl(var(--lime-foreground))]" aria-hidden>{i + 1}</span>
                <span className="min-w-0">
                  <b>{x.title}</b> <Pill className="ml-1 h-5 px-2 text-[10.5px]">{x.effort} effort</Pill>
                  <span className="mt-0.5 block leading-relaxed">{x.detail}</span>
                  {x.metric && <span className="mt-0.5 block text-[12px] text-muted-foreground">Should move: {x.metric}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {r.experiments.length > 0 && (
        <Section icon={FlaskConical} title="Experiments to run">
          <div className="grid gap-3 md:grid-cols-2">
            {r.experiments.map((x, i) => (
              <div key={i} className="rounded-2xl p-4 text-[13px] hairline">
                <p><span className="text-muted-foreground">Idea: </span>{x.hypothesis}</p>
                <p className="mt-1.5"><span className="text-muted-foreground">Test: </span>{x.test}</p>
                <p className="mt-1.5"><span className="text-muted-foreground">Success: </span>{x.successMetric}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <details className="mt-6 rounded-2xl bg-secondary/50 px-4 py-3 text-[13px] hairline">
        <summary className="cursor-pointer font-medium">Numbers Gemini saw for this version</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Totals</p>
            <p>{a.stats.totals.users} users, {a.stats.totals.mau} active in 30 days, {a.stats.totals.paying} paying</p>
          </div>
          <div>
            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Funnel</p>
            <ul>{a.stats.funnel.map((f) => <li key={f.key}>{f.label}: {f.count}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Retention</p>
            <ul>{a.stats.retention.map((x) => <li key={x.key}>{x.label}: {x.eligible ? pct(x.rate) : "n/a"}</li>)}</ul>
          </div>
        </div>
      </details>
    </Card>
    </div>
  );
}
