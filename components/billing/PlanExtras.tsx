"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { CANCEL_REASONS, CANCEL_REASON_LABEL, type CancelReason } from "@/lib/billing/experiments-core";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

type Meter = { used: number; limit: number; credits?: number; left: number | null };
type UsageNow = { x: Meter; ai: Meter & { on: boolean }; analyticsDays: number };
type Pack = { id: string; kind: string; units: number; days: number; label: string; price: string; block: string | null };
type Held = { id: string; kind: string; units: number; remaining: number; expiresAt: string };
type Packs = { enabled: boolean; packs: Pack[]; held: Held[] };

function Bar({ id, label, m, unit }: { id: string; label: string; m: Meter; unit: string }) {
  if (m.limit <= 0) return null; // unlimited: the plan card already says so
  const cap = m.limit + (m.credits ?? 0);
  const pct = Math.min(100, Math.round((m.used / cap) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id}>{label}</span>
        <span className="tabular text-muted-foreground">{m.used} of {m.limit}{m.credits ? ` + ${m.credits} extra` : ""} {unit}</span>
      </div>
      <div role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(m.used, cap)} className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-lime")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** 1096: X posts and AI-captioned videos this month, packs held, and packs on sale. Buying runs the same checkout as a plan. */
export function UsageExtras({ onBuy, busy }: { onBuy: (packId: string) => void; busy: string | null }) {
  const [u, setU] = useState<UsageNow | null>(null);
  const [p, setP] = useState<Packs | null>(null);
  useEffect(() => {
    api<UsageNow>("/api/billing/usage").then(setU).catch(() => {});
    api<Packs>("/api/billing/topups").then(setP).catch(() => {});
  }, []);
  const onSale = p?.enabled ? p.packs.filter((k) => !k.block) : [];
  if (!u && !p) return null;
  return (
    <div className="mt-4 grid max-w-md gap-3">
      {u && <Bar id="use-x" label="Posts to X this month" m={u.x} unit="posts" />}
      {u && u.ai.on && <Bar id="use-ai" label="AI-captioned videos this month" m={u.ai} unit="videos" />}
      {u && <p className="text-xs text-muted-foreground">Analytics history: {u.analyticsDays > 0 ? Math.min(730, u.analyticsDays) : 90} days</p>}
      {p && p.held.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="Your top-ups">
          {p.held.map((h) => (
            <li key={h.id}>{h.remaining} of {h.units} {h.kind === "ai" ? "AI-captioned videos" : h.kind === "x" ? "X posts" : h.kind === "brand" ? "extra brand" : "extra seat"} left, until {day(h.expiresAt)}</li>
          ))}
        </ul>
      )}
      {onSale.length > 0 && (
        <div role="group" aria-labelledby="packs-h" className="rounded-2xl bg-secondary/50 p-3 hairline">
          <p id="packs-h" className="text-[13px] font-semibold">Need a little more this month?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {onSale.map((k) => (
              <Button key={k.id} variant="subtle" size="sm" className="min-h-[44px] rounded-full" disabled={!!busy} onClick={() => onBuy(k.id)}>
                {busy === `pack-${k.id}` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {k.label} · {k.price}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">One-off. No subscription change. Used after your plan's own allowance.</p>
        </div>
      )}
    </div>
  );
}

/**
 * 1096: auto-renew is opt-in. Off (the default) = we email 7 days and 1 day before the plan ends. On = Razorpay
 * opens a mandate page (card or UPI Autopay) and we remind you 3 days before each charge.
 */
export function AutoRenewToggle({ on, provider, periodEnd }: { on: boolean; provider?: string; periodEnd: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const supported = provider === "razorpay" || provider === "mock";
  async function flip() {
    setBusy(true);
    try {
      const r = await api<{ autoRenew: boolean; pending?: boolean; url?: string }>("/api/billing/autorenew", { method: "POST", json: { on: !on } });
      if (r.pending && r.url) {
        toast("Approve the mandate on the next page. Nothing is charged before " + day(periodEnd) + ".", "ok");
        window.location.href = r.url;
        return;
      }
      toast(r.autoRenew ? `Auto-renew is on. We'll email you 3 days before ${day(periodEnd)}.` : "Auto-renew is off. We'll remind you before your plan ends.", "ok");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  if (!supported && !on) return null;
  return (
    <label className="mt-4 flex max-w-md cursor-pointer items-center justify-between gap-3 rounded-2xl bg-secondary/40 px-4 py-2.5 hairline">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[14px] font-medium"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Auto-renew</span>
        <span className="block text-[12px] text-muted-foreground">{on ? `Renews on ${day(periodEnd)}. Reminder 3 days before.` : "Off. We email you before it ends, nothing is charged."}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={flip} className="peer sr-only" />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-60 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5 motion-reduce:after:transition-none" />
    </label>
  );
}

export type CancelWhy = { reason?: CancelReason; detail: string; interview: boolean };

/** 1096: the optional "why are you leaving" step inside the cancel dialog. Cancelling never waits on it. */
export function CancelReasons({ value, onChange }: { value: CancelWhy; onChange: (v: CancelWhy) => void }) {
  return (
    <fieldset className="mt-5">
      <legend className="text-sm font-semibold">What's the main reason? <span className="font-normal text-muted-foreground">(optional)</span></legend>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {CANCEL_REASONS.map((r) => (
          <label key={r} className={cn("flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13px] hairline", value.reason === r ? "bg-lime/15" : "bg-secondary/40")}>
            <input type="radio" name="cancel-reason" value={r} checked={value.reason === r} onChange={() => onChange({ ...value, reason: r })} className="accent-[hsl(var(--lime-ink))]" />
            {CANCEL_REASON_LABEL[r]}
          </label>
        ))}
      </div>
      {value.reason && (
        <>
          <label htmlFor="cancel-detail" className="mt-3 block text-[13px] font-medium">Anything we should fix?</label>
          <textarea id="cancel-detail" rows={2} maxLength={1000} value={value.detail} onChange={(e) => onChange({ ...value, detail: e.target.value })} className="mt-1 w-full rounded-xl bg-secondary/40 px-3 py-2 text-[13px] hairline" />
          <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13px]">
            <input type="checkbox" checked={value.interview} onChange={(e) => onChange({ ...value, interview: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--lime-ink))]" />
            I'm happy to do a 15-minute call about it
          </label>
        </>
      )}
    </fieldset>
  );
}

const QUESTIONS = [
  { k: "tooCheap", q: "So cheap you'd doubt the quality" },
  { k: "cheap", q: "A bargain" },
  { k: "expensive", q: "Getting expensive, but you'd still think about it" },
  { k: "tooExpensive", q: "Too expensive to consider" },
] as const;
type K = (typeof QUESTIONS)[number]["k"];

/** 1096: a four-question price survey (Van Westendorp), once per person. Hides itself after an answer. */
export function PriceSurvey({ currency, planSlug }: { currency: string; planSlug: string }) {
  const toast = useToast();
  const [state, setState] = useState<"loading" | "ask" | "done" | "hidden">("loading");
  const [v, setV] = useState<Record<K, string>>({ tooCheap: "", cheap: "", expensive: "", tooExpensive: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ answered: boolean }>("/api/survey/price").then((r) => setState(r.answered ? "hidden" : "ask")).catch(() => setState("hidden"));
  }, []);
  if (state === "loading" || state === "hidden") return null;
  if (state === "done") return <p role="status" className="mt-10 max-w-5xl rounded-2xl bg-success/15 px-5 py-4 text-sm">Thanks. That goes straight into how we price Outlly.</p>;
  async function send() {
    const n = Object.fromEntries(QUESTIONS.map(({ k }) => [k, Math.round(Number(v[k].replace(/,/g, "")) * 100)])) as Record<K, number>;
    if (QUESTIONS.some(({ k }) => !v[k].trim() || !Number.isFinite(n[k]))) return setErr("Enter a price for each question.");
    setBusy(true);
    setErr(null);
    try {
      await api("/api/survey/price", { method: "POST", json: { ...n, currency, planSlug } });
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="survey-h" className="mt-10 max-w-5xl rounded-[24px] p-5 hairline sm:p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="survey-h" className="text-lg font-semibold tracking-tight">Help us price Outlly</h2>
        <p className="text-[13px] text-muted-foreground">Four quick questions, per month, in {currency}. Thirty seconds.</p>
        <button type="button" onClick={() => setState("hidden")} className="ml-auto min-h-[44px] rounded-full px-3 text-[13px] text-muted-foreground hover:bg-secondary">Not now</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-4 grid gap-3 sm:grid-cols-2">
        {QUESTIONS.map(({ k, q }) => (
          <label key={k} className="block text-[13px]">
            <span className="block font-medium">At what price is Outlly {q.charAt(0).toLowerCase() + q.slice(1)}?</span>
            <input inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="mt-1 h-11 w-full rounded-xl bg-secondary/40 px-3 tabular hairline" aria-describedby={err ? "survey-err" : undefined} />
          </label>
        ))}
        {err && <p id="survey-err" role="alert" className="text-[13px] text-destructive sm:col-span-2">{err}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" variant="lime" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Send answers</Button>
        </div>
      </form>
    </section>
  );
}

type Voice = { perk: boolean; on: boolean; samples: number; ready: boolean; preview: string[] };

/** 1096: voice memory switch for Settings. Learns from the captions you publish; off forgets them. */
export function VoiceMemoryCard() {
  const toast = useToast();
  const [s, setS] = useState<Voice | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Voice>("/api/ai/voice").then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  async function call(method: "PUT" | "DELETE", on?: boolean) {
    setBusy(true);
    try {
      setS(await api<Voice>("/api/ai/voice", { method, json: method === "PUT" ? { on } : undefined }));
      toast(method === "DELETE" ? "Forgot your saved captions" : on ? "Voice memory is on" : "Voice memory is off, saved captions forgotten", "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="voice-h" className="rounded-[24px] p-5 hairline sm:p-6">
      <h2 id="voice-h" className="text-lg font-semibold tracking-tight">Voice memory</h2>
      {!s.perk ? (
        <p className="mt-1 text-[13px] text-muted-foreground">On Creator and Agency, Outlly learns from the captions you publish so new hooks and captions sound like you. <a href="/billing" className="font-medium text-foreground underline underline-offset-4">See plans</a></p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {s.on ? (s.ready ? `Writing in your voice, from your last ${s.samples} published captions.` : `Learning: ${s.samples} of 2 captions so far. Publish a couple of posts and it kicks in.`) : "Off. Hooks and captions use Outlly's default voice."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={s.on ? "subtle" : "lime"} disabled={busy} onClick={() => call("PUT", !s.on)}>{s.on ? "Turn off" : "Turn on"}</Button>
            {s.on && s.samples > 0 && <Button variant="ghost" disabled={busy} onClick={() => call("DELETE")}>Forget saved captions</Button>}
          </div>
        </>
      )}
    </section>
  );
}
