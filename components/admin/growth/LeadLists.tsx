"use client";
import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Mail } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { Empty, Pill, Table, type Tone } from "@/components/admin/ui";
import { adminApi } from "@/lib/client/admin-api";
import { DRAFTS, LISTS, type LeadKind, type Temp } from "@/lib/growth/core";
import { cn } from "@/lib/utils";

export interface LeadView {
  ref: string;
  name: string | null;
  email: string;
  avatar: string | null;
  since: string;
  score: number;
  temp: Temp;
  detail: string;
  emailedAt: string | null;
}

const TEMP_TONE: Record<Temp, Tone> = { hot: "lime", warm: "warn", cold: "muted" };
const TEMPS: (Temp | "")[] = ["", "hot", "warm", "cold"];
const WEEK = 7 * 864e5;
const short = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function LeadLists({ lists, total }: { lists: Record<LeadKind, LeadView[]>; total: Record<LeadKind, number> }) {
  const [kind, setKind] = useState<LeadKind>(LISTS.find((l) => lists[l.kind].length)?.kind ?? "waitlist");
  const [temp, setTemp] = useState<Temp | "">("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<string[] | null>(null);
  const [draft, setDraft] = useState(DRAFTS[kind]);
  const [busy, setBusy] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const toast = useToast();
  const router = useRouter();
  const ids = { subject: useId(), body: useId(), cta: useId(), panel: useId() };

  const all = lists[kind];
  const rows = useMemo(() => (temp ? all.filter((l) => l.temp === temp) : all), [all, temp]);
  const fresh = (l: LeadView) => !l.emailedAt || Date.now() - new Date(l.emailedAt).getTime() >= WEEK;
  const meta = LISTS.find((l) => l.kind === kind)!;

  function choose(k: LeadKind) {
    setKind(k);
    setPicked(new Set());
    setTemp("");
    setDraft(DRAFTS[k]);
  }
  function onTabKey(e: React.KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? LISTS.length - 1 : (i + d + LISTS.length) % LISTS.length;
    choose(LISTS[n].kind);
    tabs.current[n]?.focus();
  }
  function toggle(ref: string) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(ref) ? n.delete(ref) : n.add(ref);
      return n;
    });
  }
  const pickable = rows.filter(fresh);
  const allOn = pickable.length > 0 && pickable.every((l) => picked.has(l.ref));

  async function send() {
    if (!compose) return;
    setBusy(true);
    try {
      const r = await adminApi<{ sent: number; failed: number; skipped: number; mocked: boolean }>("/api/admin/growth/email", { method: "POST", json: { list: kind, refs: compose, ...draft } });
      const bits = [`${r.sent} sent${r.mocked ? " to the Outbox (mock email)" : ""}`, r.skipped ? `${r.skipped} skipped, emailed this week` : "", r.failed ? `${r.failed} failed` : ""].filter(Boolean);
      toast(bits.join(". ") + ".", r.failed ? "error" : "ok");
      setCompose(null);
      setPicked(new Set());
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const exportHref = `/api/admin/growth/export?list=${kind}${temp ? `&temp=${temp}` : ""}`;
  const one = compose?.length === 1 ? all.find((l) => l.ref === compose[0]) : null;

  return (
    <div>
      <div role="tablist" aria-label="Lead lists" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {LISTS.map((l, i) => {
          const on = l.kind === kind;
          return (
            <button
              key={l.kind}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`tab-${l.kind}`}
              aria-selected={on}
              aria-controls={ids.panel}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(l.kind)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on ? "lime-bg" : "bg-secondary/60 text-muted-foreground hairline hover:text-foreground",
              )}
            >
              {l.label}
              <span className={cn("tabular rounded-full px-1.5 text-[11.5px]", on ? "bg-black/10" : "bg-foreground/[0.06]")}>{total[l.kind].toLocaleString("en-IN")}</span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={ids.panel} aria-labelledby={`tab-${kind}`}>
        <p className="mb-4 text-[13.5px] text-muted-foreground">{meta.blurb}</p>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by temperature">
            {TEMPS.map((t) => {
              const n = t ? all.filter((l) => l.temp === t).length : all.length;
              return (
                <button key={t || "all"} type="button" aria-pressed={temp === t} onClick={() => { setTemp(t); setPicked(new Set()); }} className={cn("h-11 rounded-full px-3.5 text-[12.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", temp === t ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hairline hover:text-foreground")}>
                  {t ? t.charAt(0).toUpperCase() + t.slice(1) : "All"} <span className="tabular">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={exportHref} download className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold hairline hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
            <button type="button" disabled={!picked.size} onClick={() => setCompose([...picked])} className="lime-bg inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Mail className="h-4 w-4" aria-hidden /> Email {picked.size ? picked.size : "selected"}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <Empty title="Nobody on this list" body={temp ? "Try another temperature, or All." : "Good news: nobody is stuck at this step right now."} />
        ) : (
          <Table label={meta.label} head={[
            <label key="all" className="-m-3 inline-flex h-11 w-11 cursor-pointer items-center justify-center">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--lime))]" checked={allOn} disabled={!pickable.length} onChange={() => setPicked(allOn ? new Set() : new Set(pickable.map((l) => l.ref)))} aria-label={allOn ? "Unselect everyone" : `Select all ${pickable.length} not emailed this week`} />
            </label>,
            "Person", "Score", "Since", "Detail", <span key="act" className="sr-only">Action</span>,
          ]}>
            {rows.slice(0, 200).map((l) => {
              const ok = fresh(l);
              const who = l.name || l.email;
              return (
                <tr key={l.ref}>
                  <td className="w-11">
                    <label className="-m-3 inline-flex h-11 w-11 cursor-pointer items-center justify-center">
                      <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--lime))]" checked={picked.has(l.ref)} disabled={!ok} onChange={() => toggle(l.ref)} aria-label={`Select ${who}`} />
                    </label>
                  </td>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <OrbAvatar avatar={l.avatar} seed={l.email} size={30} />
                      <span className="min-w-0">
                        <span className="block font-medium">{l.name || "No name"}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">{l.email}</span>
                      </span>
                    </span>
                  </td>
                  <td><Pill tone={TEMP_TONE[l.temp]}><span className="tabular">{l.score}</span> {l.temp}</Pill></td>
                  <td className="whitespace-nowrap text-muted-foreground">{short(l.since)}</td>
                  <td className="text-[13px]">{l.detail}{l.emailedAt && <span className="block text-[12px] text-muted-foreground">Emailed {short(l.emailedAt)}</span>}</td>
                  <td className="text-right">
                    {ok ? (
                      <button type="button" onClick={() => setCompose([l.ref])} aria-label={`Email ${who}`} className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[12.5px] font-semibold hairline hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                        <Mail className="h-3.5 w-3.5" aria-hidden /> Email
                      </button>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">Wait a week</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {rows.length > 200 && <p className="mt-3 text-[12.5px] text-muted-foreground">Showing the top 200 of {rows.length}. Export the CSV for the whole list.</p>}
      </div>

      <ConfirmDialog
        open={!!compose}
        onOpenChange={(o) => !busy && !o && setCompose(null)}
        size="wide"
        tone="primary"
        title={one ? `Email ${one.name || one.email}` : `Email ${compose?.length ?? 0} people`}
        body={`Ready-written for "${meta.label}". Edit anything you like; {name} becomes each person's first name. Anyone emailed from here in the last 7 days is skipped.${kind === "waitlist" ? " This email is their invite: they're marked invited once it sends." : ""}`}
        confirmLabel={compose && compose.length > 1 ? `Send ${compose.length} emails` : "Send email"}
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={send}
        extra={
          <div className="mt-4 grid gap-3 text-left">
            <div>
              <label htmlFor={ids.subject} className="mb-1.5 block text-[13px] font-semibold">Subject</label>
              <input id={ids.subject} value={draft.subject} maxLength={120} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className="h-11 w-full rounded-2xl bg-background px-3.5 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
            </div>
            <div>
              <label htmlFor={ids.body} className="mb-1.5 block text-[13px] font-semibold">Message</label>
              <textarea id={ids.body} value={draft.body} maxLength={4000} rows={8} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="w-full resize-y rounded-2xl bg-background px-3.5 py-2.5 text-[14px] leading-relaxed hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
            </div>
            <div>
              <label htmlFor={ids.cta} className="mb-1.5 block text-[13px] font-semibold">Button label</label>
              <input id={ids.cta} value={draft.cta} maxLength={40} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} className="h-11 w-full rounded-2xl bg-background px-3.5 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
              <p className="mt-1 text-[12px] text-muted-foreground">The button opens {kind === "waitlist" ? "their personal signup invite" : <code>{DRAFTS[kind].path}</code>}.</p>
            </div>
          </div>
        }
      />
    </div>
  );
}
