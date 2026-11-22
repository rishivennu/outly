"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, BellRing, CheckCircle2, Download, Loader2, RefreshCw, Settings2, ShieldAlert, X } from "lucide-react";
import { useToast } from "@/components/shared/Toast";
import { Card, CardTitle, ErrorState, LoadingState, Pill, Section, Table, ago, fmtDate, type Tone } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/shared/Sheet";
import { Switch } from "@/components/admin/Switch";
import { pushSupport, currentSub, permission, installedNow, type PushSupport } from "@/lib/client/push";
import { ADMIN_DEVICES_URL, adminPushFlag, enableAdminPush, setAdminPushFlag, syncAdminPush } from "@/lib/client/admin-push";
import type { AdminRole } from "@/lib/admin/perms";
import type { healthOverview, incidentRow } from "@/lib/health/overview";
import type { WatchdogConfig } from "@/lib/health/config";
import { CYCLE_STALE_SEC } from "@/lib/health/core";
import { cn } from "@/lib/utils";

/**
 * R1195 System Health. The page is a window on what the Watchdog recorded; the Watchdog runs on the server from
 * the minute cron whether this page is open or not, and alerts super admins by push and email on its own.
 *
 * Honesty rules the whole screen: a service with no check row is "Unknown", not green; "Not monitored" says why;
 * a delivery is "sent" only when the push service or the email provider accepted it; the worker card states the
 * real model (cron-driven on Vercel, no always-on process).
 *
 * Checks in every 30 s while the tab is visible, every 2 min in the background, never after 30 min without a touch.
 */

type Level = "ok" | "warning" | "critical" | "unknown";
type Overview = Awaited<ReturnType<typeof healthOverview>>;
type Incident = ReturnType<typeof incidentRow>;
type Device = { id: string; platform: string; device: string; client: string; failures: number; createdAt: string; lastSeenAt: string; lastPushAt: string | null };
type Data = Overview & { role: AdminRole; devices: Device[]; vapidPublicKey: string | null; config: WatchdogConfig | null; intervalsDefault: Record<string, number> };
type Detail = {
  incident: Incident & { errorDetail: string; ackAt: string | null; escalatedAt: string | null; notifiedAt: string | null; recoveryNotifiedAt: string | null; assigneeId: string | null; okStreak: number };
  notes: { id: string; kind: string; text: string; by: string; at: string }[];
  deliveries: { id: string; kind: string; channel: string; status: string; detail: string; at: string }[];
  checks: { status: string; latencyMs: number | null; detail: string; at: string }[];
};

const POLL_VISIBLE = 30_000;
const POLL_HIDDEN = 120_000;
const IDLE_STOP = 30 * 60_000;
const RANGES = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];
const GROUPS = ["Core", "Studio", "Publishing", "Creator", "AI", "Admin"] as const;
const LEVEL: Record<Level, { label: string; tone: Tone; dot: string }> = {
  ok: { label: "Operational", tone: "ok", dot: "bg-success" },
  warning: { label: "Warning", tone: "warn", dot: "bg-warning" },
  critical: { label: "Critical", tone: "bad", dot: "bg-destructive" },
  unknown: { label: "Unknown", tone: "muted", dot: "bg-muted-foreground/50" },
};
const SEVERITY: Record<string, { label: string; tone: Tone }> = { critical: { label: "Critical", tone: "bad" }, warning: { label: "Warning", tone: "warn" }, info: { label: "Info", tone: "info" } };
const INC_STATUS: Record<string, { label: string; tone: Tone }> = { open: { label: "Open", tone: "bad" }, acknowledged: { label: "Acknowledged", tone: "warn" }, investigating: { label: "Investigating", tone: "info" }, resolved: { label: "Resolved", tone: "ok" } };
const DELIVERY: Record<string, Tone> = { sent: "ok", failed: "bad", skipped: "muted" };

const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]";
// R1271: colour and press come from the shared Button variant; this keeps the 44px, 13px console shape.
const btn = cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50", ring);
const input = "h-11 rounded-2xl px-3 text-[13px]";
const field = cn("min-h-11 rounded-2xl border border-border/60 bg-background px-3 text-[13px]", ring);

class CallError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.location.href = `/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  if (!res.ok) throw new CallError(res.status, (data as { error?: string }).error ?? "That didn't go through. Try again.", (data as { code?: string }).code);
  return data as T;
}

const dur = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : ms < 86_400_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${(ms / 86_400_000).toFixed(1)} d`);
const ms = (v: number | null | undefined) => (v === null || v === undefined ? "No data" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
const num = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "No data" : `${Math.round(v)}${unit}`);

function LevelPill({ level, text }: { level: Level; text?: string }) {
  const l = LEVEL[level] ?? LEVEL.unknown;
  return (
    <Pill tone={l.tone}>
      <span aria-hidden className={cn("size-1.5 rounded-full", l.dot)} />
      {text ?? l.label}
    </Pill>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  const edge = tone === "bad" ? "ring-1 ring-inset ring-destructive/40" : tone === "warn" ? "ring-1 ring-inset ring-warning/40" : tone === "ok" ? "ring-1 ring-inset ring-success/30" : undefined;
  return (
    <Card as="div" className={cn("p-4 sm:p-4", edge)}>
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-display text-[1.45rem] font-semibold leading-none tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-[12.5px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <dt className="text-[13px] text-muted-foreground">
        {label}
        {hint && <span className="sr-only">, {hint}</span>}
      </dt>
      <dd className="text-[13.5px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** R1207: enrolling this browser lives in lib/client/admin-push.ts, shared with the Live Support console. */
const DEVICES = ADMIN_DEVICES_URL;
const flagOn = adminPushFlag;
const setFlag = setAdminPushFlag;

export function SystemHealth({ me, role }: { me: { id: string; name: string }; role: AdminRole }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const incidentId = params.get("incident");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("24h");
  const [group, setGroup] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [pushHere, setPushHere] = useState(false);
  const lastTouch = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSuper = role === "super";

  const load = useCallback(async () => {
    try {
      const d = await call<Data>(`/api/admin/health?range=${range}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load System Health.");
    }
  }, [range]);

  // Polling: visible 30 s, hidden 2 min, stopped after 30 min without a touch (the Watchdog keeps running regardless).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (Date.now() - lastTouch.current < IDLE_STOP) await load();
      timer.current = setTimeout(tick, document.visibilityState === "hidden" ? POLL_HIDDEN : POLL_VISIBLE);
    };
    void tick();
    const touch = () => {
      const idle = Date.now() - lastTouch.current >= IDLE_STOP;
      lastTouch.current = Date.now();
      if (idle) void load();
    };
    const vis = () => {
      if (document.visibilityState === "visible") touch();
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", vis);
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);

  // Push on this device: feature support, and whether this browser was enrolled as an alert device here.
  useEffect(() => {
    setSupport(pushSupport());
    if (!flagOn()) return;
    void currentSub().then((s) => setPushHere(!!s && permission() === "granted"));
  }, []);
  // Re-save a still-valid subscription when the page opens (refreshes "last seen"; brings it back after a reinstall).
  useEffect(() => {
    void syncAdminPush(data?.vapidPublicKey);
    // Only when the key arrives the first time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.vapidPublicKey]);

  const openIncident = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (id) q.set("incident", id);
    else q.delete("incident");
    router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };

  const runNow = async () => {
    setBusy("run");
    try {
      const r = await call<{ cycle: { ran: string[]; threw: number; opened: string[]; resolved: string[]; ms: number; skipped?: string } }>("/api/admin/health", { action: "run" });
      const c = r.cycle;
      toast(c.skipped ? `Checks did not run: ${c.skipped === "disabled" ? "the Watchdog is turned off in settings" : "another cycle is running"}` : `${c.ran.length} checks in ${(c.ms / 1000).toFixed(1)} s. ${c.opened.length} new incident(s), ${c.resolved.length} recovered.`, c.skipped ? "error" : "ok");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The checks didn't run.", "error");
    } finally {
      setBusy(null);
    }
  };

  const testAlert = async () => {
    setBusy("test");
    try {
      const r = await call<{ status: string; devices: number; sent: number; detail: string }>("/api/admin/health", { action: "test-alert" });
      toast(r.status === "sent" ? `Push accepted for ${r.sent} of ${r.devices} device(s). It should appear in a moment.` : r.status === "skipped" ? "No alert device for you yet. Turn on alert pushes on this device first." : `The push service refused it: ${r.detail}`, r.status === "sent" ? "ok" : "error");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Test alert not sent.", "error");
    } finally {
      setBusy(null);
    }
  };

  const togglePushHere = async () => {
    if (!data) return;
    setBusy("push");
    try {
      if (pushHere) {
        const s = await currentSub();
        if (s) await call(DEVICES, { endpoint: s.endpoint }, "DELETE");
        setFlag(false);
        setPushHere(false);
        toast("Alert pushes are off on this device.", "ok");
      } else {
        if (!data.vapidPublicKey) throw new Error("Web Push is not configured on the server (VAPID keys).");
        await enableAdminPush(data.vapidPublicKey);
        setPushHere(true);
        toast("Alert pushes are on for this device. Send a test to be sure.", "ok");
      }
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't change alert pushes here.", "error");
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = async (cfg: WatchdogConfig) => {
    setBusy("config");
    try {
      await call("/api/admin/health", { action: "config", config: cfg });
      toast("Watchdog settings saved.", "ok");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Settings not saved.", "error");
    } finally {
      setBusy(null);
    }
  };

  const services = useMemo(() => (data ? data.services.filter((s) => group === "all" || s.group === group) : []), [data, group]);
  const summary = data?.summary;
  const overall: Level = summary?.overall ?? "unknown";
  const worker = data?.worker;
  const workerOk = !!worker && !!worker.lastCycle && worker.lastCycle.ageSec < CYCLE_STALE_SEC; // R1297: cycles every 2 minutes

  if (error && !data)
    return (
      <ErrorState
        title="Couldn't load System Health"
        body={error}
        retry={
          <Button type="button" className={btn} onClick={() => void load()}>
            Try again
          </Button>
        }
      />
    );

  return (
    <div className="pb-24">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="health-range">
          Time range
        </label>
        <select id="health-range" className={field} value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="health-group">
          Service group
        </label>
        <select id="health-group" className={field} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">All groups</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        {error && (
          <span className="text-[12.5px] text-destructive" role="status">
            Last refresh failed: {error}
          </span>
        )}
        <Button type="button" className={btn} onClick={() => void load()} aria-label="Refresh">
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
        {isSuper && (
          <Button type="button" variant="lime" className={btn} onClick={() => void runNow()} disabled={busy === "run"}>
            {busy === "run" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Activity className="size-4" aria-hidden />} Run checks now
          </Button>
        )}
        <Button type="button" className={btn} onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
          <Settings2 className="size-4" aria-hidden /> Alerts & settings
        </Button>
      </div>

      {!data ? (
        <LoadingState lines={4} label="Loading System Health" />
      ) : (
        <>
          {/* Overall status */}
          <Card className={cn(overall === "critical" ? "ring-1 ring-inset ring-destructive/40" : overall === "warning" ? "ring-1 ring-inset ring-warning/40" : overall === "ok" ? "ring-1 ring-inset ring-success/30" : "")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span aria-hidden className={cn("grid size-11 place-items-center rounded-full", overall === "critical" ? "bg-destructive/15 text-destructive" : overall === "warning" ? "bg-warning/15 pill-ink-warn" : overall === "ok" ? "bg-success/15 pill-ink-ok" : "bg-secondary text-muted-foreground")}>
                  {overall === "ok" ? <CheckCircle2 className="size-5" /> : overall === "unknown" ? <ShieldAlert className="size-5" /> : <AlertTriangle className="size-5" />}
                </span>
                <div>
                  <p className="font-display text-[1.15rem] font-semibold leading-tight">
                    {overall === "ok" ? "All monitored services operational" : overall === "critical" ? "Critical: at least one core service is failing" : overall === "warning" ? "Degraded: some services need attention" : "Unknown: the Watchdog has not completed a check cycle yet"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    Status as of {fmtDate(data.now, true)}. Last successful cycle {worker?.lastCycle ? `${ago(worker.lastCycle.at)} (${worker.lastCycle.ran} checks in ${worker.lastCycle.ms} ms, via ${worker.lastCycle.source})` : "never"}.
                  </p>
                </div>
              </div>
              <LevelPill level={overall} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Kpi label="Healthy" value={summary!.counts.ok} sub="of monitored services" tone="ok" />
              <Kpi label="Degraded" value={summary!.counts.warning} sub="warning on last check" tone={summary!.counts.warning ? "warn" : undefined} />
              <Kpi label="Critical incidents" value={summary!.openCritical} sub="open right now" tone={summary!.openCritical ? "bad" : undefined} />
              <Kpi label="Active warnings" value={summary!.openWarnings} sub="open right now" tone={summary!.openWarnings ? "warn" : undefined} />
              <Kpi label="Unknown" value={summary!.counts.unknown + data.services.filter((s) => s.monitored && !s.lastCheckedAt).length} sub="not checked yet" />
              <Kpi label="Worker" value={workerOk ? "Running" : worker?.lastCycle ? "Stalled" : "Never ran"} sub={worker?.model ?? ""} tone={workerOk ? "ok" : "bad"} />
            </div>
            <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
              <Stat label="Check engine" value={worker?.model ?? "Unknown"} />
              <Stat label="Minute sweep (drives the checks)" value={worker?.sweep.lastAt ? `${worker.sweep.stale ? "Stale, last" : "Last"} ${ago(worker.sweep.lastAt)} (${worker.sweep.source})` : "Never seen"} />
              <Stat label="Independent heartbeat (/api/cron/health)" value={worker?.heartbeat.configured ? `${worker.heartbeat.stale ? "Stale, last" : "Last"} ${ago(worker.heartbeat.lastAt)}` : "Not configured: add a second external pinger"} />
              <Stat label="Alert email backup" value={worker?.alertEmail || "Not set"} />
            </dl>
          </Card>

          <ServicesSection services={services} onOpen={openIncident} />
          <IncidentsSection incidents={data.incidents} onOpen={openIncident} />
          <PerfSection perf={data.perf} />
          <HistorySection data={data} range={range} onOpen={openIncident} />
        </>
      )}

      {incidentId && <IncidentDrawer id={incidentId} me={me} onClose={() => openIncident(null)} onChanged={load} />}
      {settingsOpen && data && (
        <SettingsPanel
          data={data}
          isSuper={isSuper}
          support={support}
          pushHere={pushHere}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onTogglePush={togglePushHere}
          onTest={testAlert}
          onSave={saveConfig}
          onRemoveDevice={async (id) => {
            await call(DEVICES, { id }, "DELETE").catch((e: unknown) => toast(e instanceof Error ? e.message : "Not removed.", "error"));
            await load();
          }}
        />
      )}
    </div>
  );
}

type ServiceRow = Data["services"][number];

function ServicesSection({ services, onOpen }: { services: ServiceRow[]; onOpen: (id: string | null) => void }) {
  const groups = GROUPS.filter((g) => services.some((s) => s.group === g));
  return (
    <Section id="svc" title="A. Service health" hint="Every monitored service, judged on its latest real check. Error rate is failing checks over checks in the last hour. Unmonitored services say why.">
      {groups.map((g) => {
        const rows = services.filter((s) => s.group === g);
        return (
          <Card key={g} className="min-w-0">
            <CardTitle hint={`${rows.filter((r) => r.monitored).length} monitored, ${rows.filter((r) => !r.monitored).length} not`}>{g}</CardTitle>
            <Table head={["Service", "Status", "Last checked", "Response", "Error rate", "Incidents", "Details"]} label={`${g} services`} minWidth={880}>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="font-semibold">{s.name}</span>
                    {s.monitored && s.intervalSec ? <span className="block text-[11.5px] text-muted-foreground">every {s.intervalSec >= 60 ? `${Math.round(s.intervalSec / 60)} min` : `${s.intervalSec} s`}</span> : null}
                  </td>
                  <td>{s.monitored ? <LevelPill level={s.lastCheckedAt ? s.level : "unknown"} text={s.lastCheckedAt ? undefined : "Unknown"} /> : <Pill tone="muted">Not monitored</Pill>}</td>
                  <td className="text-muted-foreground">{s.lastCheckedAt ? ago(s.lastCheckedAt) : s.monitored ? "Never" : "n/a"}</td>
                  <td className="tabular-nums">{s.monitored ? ms(s.latencyMs) : "n/a"}</td>
                  <td className="tabular-nums">{s.monitored ? (s.errorRatePct === null ? "No checks yet" : `${s.errorRatePct}% of ${s.checks}`) : "n/a"}</td>
                  <td>
                    {s.openIncidents ? (
                      <Button type="button" variant="ghost" size="sm" className={cn("px-2 text-[12.5px] font-semibold underline-offset-2 hover:underline", ring, s.openSeverity === "critical" ? "text-destructive" : "pill-ink-warn")} onClick={() => document.getElementById("inc-title")?.scrollIntoView({ block: "start" })}>
                        {s.openIncidents} open
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="max-w-[360px] text-[12.5px] text-muted-foreground">
                    {s.monitored ? s.detail : s.why}
                    {s.monitored && s.covers ? <span className="block text-[11.5px] opacity-80">Checks: {s.covers}</span> : null}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        );
      })}
      {!groups.length && <Card>No services in this group.</Card>}
    </Section>
  );
}

function IncidentsSection({ incidents, onOpen }: { incidents: Incident[]; onOpen: (id: string) => void }) {
  return (
    <Section id="inc" title="B. Active incidents" hint="Open, acknowledged or investigating. Acknowledging never resolves; an incident closes after two passing checks in a row or when someone resolves it.">
      <Card className="min-w-0">
        {incidents.length ? (
          <Table head={["Incident", "Severity", "Service", "First detected", "Duration", "Status", "Assignee"]} label="Active incidents" minWidth={880}>
            {incidents.map((i) => (
              <tr key={i.id}>
                <td>
                  <button type="button" className={cn("text-left font-semibold underline-offset-2 hover:underline touch:min-h-11", ring)} onClick={() => onOpen(i.id)}>
                    {i.title}
                  </button>
                  <span className="block text-[12px] text-muted-foreground">
                    {i.occurrences > 1 ? `${i.occurrences} failed checks grouped` : "1 failed check"}
                    {i.escalated ? ", escalated" : ""}
                  </span>
                </td>
                <td>
                  <Pill tone={SEVERITY[i.severity]?.tone ?? "muted"}>{SEVERITY[i.severity]?.label ?? i.severity}</Pill>
                </td>
                <td>{i.serviceName}</td>
                <td className="text-muted-foreground">{fmtDate(i.firstDetectedAt, true)}</td>
                <td className="tabular-nums">{dur(i.durationMs)}</td>
                <td>
                  <Pill tone={INC_STATUS[i.status]?.tone ?? "muted"}>{INC_STATUS[i.status]?.label ?? i.status}</Pill>
                </td>
                <td className="text-muted-foreground">{i.assigneeName ?? "Unassigned"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No active incidents.</p>
        )}
      </Card>
    </Section>
  );
}

function PerfCard({ title, at, rows }: { title: string; at: string | null; rows: [string, React.ReactNode][] }) {
  return (
    <Card>
      <CardTitle hint={at ? `As of ${fmtDate(at, true)}` : "No check recorded yet"}>{title}</CardTitle>
      <dl>
        {rows.map(([k, v]) => (
          <Stat key={k} label={k} value={v} />
        ))}
      </dl>
    </Card>
  );
}

function PerfSection({ perf }: { perf: Data["perf"] }) {
  const hosts = Object.entries(perf.external.hosts ?? {});
  const pub = Object.entries(perf.external.publish ?? {});
  return (
    <Section id="perf" title="C. Performance" hint="The latest numbers each probe reported. A blank is a probe that has not run, never a guess." cols={3}>
      <PerfCard title="API response times" at={perf.api.at} rows={[["/api/health", ms(perf.api.healthMs)], ["Home page", ms(perf.api.homeMs)], ["/api/me (auth)", ms(perf.api.authMs)], ["Admin login page", ms(perf.api.adminLoginMs)]]} />
      <PerfCard title="Database" at={perf.db.at} rows={[["SELECT 1 round trip", ms(perf.db.ms)]]} />
      <PerfCard title="Job delays" at={perf.jobs.at} rows={[["Overdue scheduled posts", num(perf.jobs.overduePosts)], ["Stuck publish targets", num(perf.jobs.stuckTargets)], ["Sweep age", num(perf.jobs.sweepAgeSec, " s")], ["Oldest pending notice", num(perf.jobs.oldestNotifyMin, " min")]]} />
      <PerfCard title="AI generation" at={perf.ai.at} rows={[["Text model avg", ms(perf.ai.avgModelMs)], ["Models configured", num(perf.ai.models)], ["Models benched", num(perf.ai.benched)], ["Captions model avg", ms(perf.ai.captionsAvgMs)], ["Whisper benched", perf.ai.whisperBenched === null ? "No data" : perf.ai.whisperBenched ? "Yes" : "No"]]} />
      <PerfCard title="Uploads and processing" at={perf.upload.at} rows={[["Uploads done, last hour", num(perf.upload.completedLastHour)], ["Uploads failed, last hour", num(perf.upload.failedLastHour)], ["Upload fail rate", num(perf.upload.failRatePct, "%")], ["Storage stat", ms(perf.upload.storageMs)], ["Processing fail rate", num(perf.upload.processingFailRatePct, "%")]]} />
      <PerfCard title="Notification delivery" at={perf.notifications.at} rows={[["Push sent, last hour", num(perf.notifications.pushSent)], ["Push failed, last hour", num(perf.notifications.pushFailed)], ["Push outbox", num(perf.notifications.pushOutbox)], ["Email sent, last hour", num(perf.notifications.emailSent)], ["Email failed, last hour", num(perf.notifications.emailFailed)], ["Dead letters, last hour", num(perf.notifications.deadLetters)]]} />
      <Card className="sm:col-span-2 xl:col-span-3">
        <CardTitle hint={perf.external.at ? `As of ${fmtDate(perf.external.at, true)}` : "No check recorded yet"}>External platform APIs</CardTitle>
        <div className="grid gap-6 md:grid-cols-2">
          <dl>
            <Stat label="Unreachable hosts" value={num(perf.external.unreachable)} />
            {hosts.map(([h, v]) => (
              <Stat key={h} label={h} value={ms(v as number | null)} />
            ))}
            {!hosts.length && <p className="py-2 text-[13px] text-muted-foreground">No reachability probe yet.</p>}
          </dl>
          <dl>
            {pub.map(([p, v]) => (
              <Stat key={p} label={`Publishing to ${p}`} value={`${v.failed24h} failed / ${v.published24h} published (24 h), ${v.failRatePct}%${v.delayed ? `, ${v.delayed} delayed` : ""}`} />
            ))}
            {!pub.length && <p className="py-2 text-[13px] text-muted-foreground">No publishing checks yet.</p>}
          </dl>
        </div>
      </Card>
    </Section>
  );
}

function HistorySection({ data, range, onOpen }: { data: Data; range: string; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [service, setService] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const query = useMemo(() => new URLSearchParams({ status, severity, service, q, range: range === "1h" ? "24h" : range }).toString(), [status, severity, service, q, range]);
  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => {
      call<{ incidents: Incident[] }>(`/api/admin/health/incidents?${query}`)
        .then((r) => !gone && (setRows(r.incidents), setErr(null)))
        .catch((e: unknown) => !gone && setErr(e instanceof Error ? e.message : "Couldn't load history."));
    }, 250);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [query, data.now]);
  const alerts = data.history.alerts;
  const channels = ["bell", "push", "email"];
  return (
    <Section id="hist" title="D. History" hint="Incidents and recoveries in the range, failed checks, and every alert the Watchdog tried to send with the channel's real answer.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Failed checks" value={data.history.failedChecks} sub="warning or critical results in range" />
        <Kpi label="Incidents in range" value={data.history.incidents.length} sub={`${data.history.incidents.filter((i) => i.resolvedAt).length} recovered`} />
        <Kpi label="Alert deliveries" value={channels.reduce((n, c) => n + Object.values(alerts[c] ?? {}).reduce((a, b) => a + b, 0), 0)} sub={channels.map((c) => `${c}: ${alerts[c]?.sent ?? 0} sent, ${alerts[c]?.failed ?? 0} failed, ${alerts[c]?.skipped ?? 0} skipped`).join(" / ")} />
      </div>
      <Card className="min-w-0">
        <CardTitle
          hint="Filter, then export the same list."
          action={
            <Button asChild className={btn}>
              <a href={`/api/admin/health/incidents?${query}&format=csv`} download>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            </Button>
          }
        >
          Incident history
        </CardTitle>
        <div className="mb-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="h-status">
            Status
          </label>
          <select id="h-status" className={field} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            <option value="active">Unresolved</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
          <label className="sr-only" htmlFor="h-sev">
            Severity
          </label>
          <select id="h-sev" className={field} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">Any severity</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <label className="sr-only" htmlFor="h-svc">
            Service
          </label>
          <select id="h-svc" className={field} value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Any service</option>
            {data.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Input className={cn(input, "w-auto min-w-[180px] flex-1")} placeholder="Search title or details" aria-label="Search incidents" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {err ? (
          <p className="text-[13px] text-destructive" role="alert">
            {err}
          </p>
        ) : rows === null ? (
          <LoadingState lines={3} label="Loading history" />
        ) : rows.length ? (
          <Table head={["Incident", "Severity", "Service", "First detected", "Resolved", "Duration", "Status"]} label="Incident history" minWidth={880}>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  <button type="button" className={cn("text-left font-semibold underline-offset-2 hover:underline touch:min-h-11", ring)} onClick={() => onOpen(i.id)}>
                    {i.title}
                  </button>
                  <span className="block text-[12px] text-muted-foreground">{i.occurrences} check(s)</span>
                </td>
                <td>
                  <Pill tone={SEVERITY[i.severity]?.tone ?? "muted"}>{SEVERITY[i.severity]?.label ?? i.severity}</Pill>
                </td>
                <td>{i.serviceName}</td>
                <td className="text-muted-foreground">{fmtDate(i.firstDetectedAt, true)}</td>
                <td className="text-muted-foreground">{i.resolvedAt ? `${fmtDate(i.resolvedAt, true)}${i.resolvedBy ? ` by ${i.resolvedBy}` : ""}` : "Still open"}</td>
                <td className="tabular-nums">{dur(i.durationMs)}</td>
                <td>
                  <Pill tone={INC_STATUS[i.status]?.tone ?? "muted"}>{INC_STATUS[i.status]?.label ?? i.status}</Pill>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No incidents match.</p>
        )}
      </Card>
    </Section>
  );
}

/** The incident drawer (?incident=<id>, the link every alert carries). Actions are separate steps; each is a note in the trail. */
function IncidentDrawer({ id, me, onClose, onChanged }: { id: string; me: { id: string; name: string }; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => call<Detail>(`/api/admin/health/incidents/${encodeURIComponent(id)}`).then((r) => (setD(r), setErr(null))).catch((e: unknown) => setErr(e instanceof Error ? e.message : "Couldn't load the incident.")), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}, done?: string) => {
    setBusy(action);
    try {
      const r = await call<{ ok: boolean } & Detail>(`/api/admin/health/incidents/${encodeURIComponent(id)}`, { action, ...extra }, "PATCH");
      setD({ incident: r.incident, notes: r.notes, deliveries: r.deliveries, checks: r.checks });
      setText("");
      if (done) toast(done, "ok");
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't go through.", "error");
    } finally {
      setBusy(null);
    }
  };

  const inc = d?.incident;
  const resolved = inc?.status === "resolved";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={inc?.title ?? (err ? "Not available" : "Loading")} description="Incident" className="lg:w-[640px]">
        {inc && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Pill tone={SEVERITY[inc.severity]?.tone ?? "muted"}>{SEVERITY[inc.severity]?.label ?? inc.severity}</Pill>
            <Pill tone={INC_STATUS[inc.status]?.tone ?? "muted"}>{INC_STATUS[inc.status]?.label ?? inc.status}</Pill>
            <Pill tone="muted">{inc.serviceName}</Pill>
            {inc.escalated && <Pill tone="bad">Escalated</Pill>}
          </div>
        )}
        {err && (
          <p className="text-[13.5px] text-destructive" role="alert">
            {err}
          </p>
        )}
        {inc && d && (
          <>
            <dl className="rounded-2xl bg-secondary/60 px-4 py-1">
              <Stat label="First detected" value={fmtDate(inc.firstDetectedAt, true)} />
              <Stat label="Last observed" value={fmtDate(inc.lastObservedAt, true)} />
              <Stat label="Duration" value={dur(inc.durationMs)} />
              <Stat label="Failed checks grouped" value={inc.occurrences} />
              <Stat label="Affected (estimated)" value={inc.affectedCount} />
              <Stat label="Assignee" value={inc.assigneeName ?? "Unassigned"} />
              <Stat label="Acknowledged" value={inc.ackAt ? fmtDate(inc.ackAt, true) : "No"} />
              <Stat label="Alert sent" value={inc.notifiedAt ? fmtDate(inc.notifiedAt, true) : "Not yet"} />
              {inc.resolvedAt && <Stat label="Resolved" value={`${fmtDate(inc.resolvedAt, true)} by ${inc.resolvedBy ?? "unknown"}`} />}
              {inc.recoveryNotifiedAt && <Stat label="Recovery alert" value={fmtDate(inc.recoveryNotifiedAt, true)} />}
            </dl>
            <h3 className="mt-5 text-[16px] font-semibold">What failed</h3>
            <p className="mt-1 text-[13.5px]">{inc.description || "No description recorded."}</p>
            {inc.errorDetail && <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-secondary/60 p-3 font-mono text-[12px]">{inc.errorDetail}</pre>}
            <h3 className="mt-4 text-[16px] font-semibold">Likely cause (estimated)</h3>
            <p className="mt-1 text-[13.5px] text-muted-foreground">{inc.likelyCause || "Not enough signal to estimate a cause."}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {!resolved && (
                <>
                  <Button type="button" className={btn} disabled={!!busy || inc.acknowledged} onClick={() => void act("ack", {}, "Acknowledged. The incident stays open until it is resolved.")}>
                    {inc.acknowledged ? "Acknowledged" : "Acknowledge"}
                  </Button>
                  <Button type="button" className={btn} disabled={!!busy || inc.status === "investigating"} onClick={() => void act("investigate", {}, "Marked as investigating.")}>
                    Investigating
                  </Button>
                  <Button type="button" className={btn} disabled={!!busy || inc.assigneeId === me.id} onClick={() => void act("assign", { assigneeId: me.id }, "Assigned to you.")}>
                    Assign to me
                  </Button>
                  {inc.assigneeId && (
                    <Button type="button" className={btn} disabled={!!busy} onClick={() => void act("assign", { assigneeId: null }, "Assignee removed.")}>
                      Unassign
                    </Button>
                  )}
                  <Button type="button" variant="danger" className={btn} disabled={!!busy} onClick={() => void act("resolve", text.trim() ? { text: text.trim() } : {}, "Resolved. A new incident opens if the check fails again.")}>
                    Resolve
                  </Button>
                </>
              )}
              {resolved && (
                <Button type="button" className={btn} disabled={!!busy} onClick={() => void act("reopen", text.trim() ? { text: text.trim() } : {}, "Reopened.")}>
                  Reopen
                </Button>
              )}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void act("note", { text: text.trim() }, "Note added.");
              }}
            >
              <Input className={cn(input, "flex-1")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note (also attached to Resolve / Reopen)" aria-label="Note" maxLength={2000} />
              <Button type="submit" variant="lime" className={btn} disabled={!!busy || !text.trim()}>
                {busy === "note" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : "Add note"}
              </Button>
            </form>

            <h3 className="mt-6 text-[16px] font-semibold">Timeline</h3>
            <ol className="mt-2 space-y-2">
              {d.notes.map((n) => (
                <li key={n.id} className="flex gap-3 text-[13px]">
                  <span className="w-[112px] shrink-0 tabular-nums text-muted-foreground">{fmtDate(n.at, true)}</span>
                  <span>
                    <span className="font-semibold">{n.by}</span> <span className="text-muted-foreground">({n.kind})</span> {n.text}
                  </span>
                </li>
              ))}
              {!d.notes.length && <li className="text-[13px] text-muted-foreground">No notes yet.</li>}
            </ol>

            <h3 className="mt-6 text-[16px] font-semibold">Alert deliveries</h3>
            <ul className="mt-2 space-y-1.5">
              {d.deliveries.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="w-[112px] shrink-0 tabular-nums text-muted-foreground">{fmtDate(x.at, true)}</span>
                  <Pill tone={DELIVERY[x.status] ?? "muted"}>
                    {x.channel}: {x.status}
                  </Pill>
                  <span className="text-muted-foreground">{x.kind}</span>
                  {x.detail && <span className="text-muted-foreground">{x.detail}</span>}
                </li>
              ))}
              {!d.deliveries.length && <li className="text-[13px] text-muted-foreground">No alert was attempted for this incident.</li>}
            </ul>

            <h3 className="mt-6 text-[16px] font-semibold">Checks around it</h3>
            <ul className="mt-2 space-y-1.5">
              {d.checks.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="w-[112px] shrink-0 tabular-nums text-muted-foreground">{fmtDate(c.at, true)}</span>
                  <LevelPill level={(c.status as Level) ?? "unknown"} />
                  <span className="tabular-nums text-muted-foreground">{ms(c.latencyMs)}</span>
                  <span className="text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
    </Sheet>
  );
}

/** Alerts & settings: this device's alert pushes (every health admin), the Watchdog switches (super only). */
function SettingsPanel({ data, isSuper, support, pushHere, busy, onClose, onTogglePush, onTest, onSave, onRemoveDevice }: { data: Data; isSuper: boolean; support: PushSupport; pushHere: boolean; busy: string | null; onClose: () => void; onTogglePush: () => Promise<void>; onTest: () => Promise<void>; onSave: (cfg: WatchdogConfig) => Promise<void>; onRemoveDevice: (id: string) => Promise<void> }) {
  const cfg = data.config;
  const [enabled, setEnabled] = useState(cfg?.enabled ?? true);
  const [email, setEmail] = useState(cfg?.alertEmail ?? "");
  const [muted, setMuted] = useState<string[]>(cfg?.muted ?? []);
  const [intervals, setIntervals] = useState<Record<string, number>>(cfg?.intervals ?? {});
  const monitored = data.services.filter((s) => s.monitored);
  const pushWord = support === "unsupported" ? "This browser cannot show Outlly notifications." : support === "ios-needs-install" ? "On iPhone and iPad, add Outlly to the Home Screen first; Safari tabs cannot receive pushes." : pushHere ? "Alert pushes are on for this device." : "Alerts reach this device only after you turn pushes on here.";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Alerts & settings" description="Watchdog" className="lg:w-[560px]">
        <section aria-labelledby="set-push" className="rounded-2xl bg-secondary/40 p-4">
          <h3 id="set-push" className="flex items-center gap-2 text-[14px] font-semibold">
            <BellRing className="size-4" aria-hidden /> Alert pushes on this device
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">{pushWord} Pushes are sent by the server, so they arrive with the admin console closed or after you sign out. Only super admins receive incident alerts; the test below goes to your own devices.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant={pushHere ? "subtle" : "lime"} className={btn} disabled={busy === "push" || support !== "supported"} onClick={() => void onTogglePush()}>
              {busy === "push" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null} {pushHere ? "Turn off on this device" : "Turn on alert pushes here"}
            </Button>
            <Button type="button" className={btn} disabled={busy === "test" || !data.devices.length} onClick={() => void onTest()}>
              {busy === "test" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null} Send a test alert
            </Button>
          </div>
          <h4 className="mt-4 text-[16px] font-semibold">Your alert devices</h4>
          <ul className="mt-1.5 divide-y divide-border/60">
            {data.devices.map((dv) => (
              <li key={dv.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span>
                  <span className="font-semibold">{dv.device}</span> <span className="text-muted-foreground">{dv.client}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    Seen {ago(dv.lastSeenAt)}
                    {dv.lastPushAt ? `, last push ${ago(dv.lastPushAt)}` : ", no push yet"}
                    {dv.failures ? `, ${dv.failures} refused` : ""}
                  </span>
                </span>
                <Button type="button" size="sm" className={cn(btn, "min-h-9 px-3 text-[12px]")} onClick={() => void onRemoveDevice(dv.id)}>
                  Remove
                </Button>
              </li>
            ))}
            {!data.devices.length && <li className="py-2 text-[13px] text-muted-foreground">None yet.</li>}
          </ul>
        </section>

        {isSuper && cfg ? (
          <form
            className="mt-4 rounded-2xl bg-secondary/40 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave({ enabled, alertEmail: email.trim(), muted, intervals });
            }}
          >
            <h3 className="text-[14px] font-semibold">Watchdog settings</h3>
            <div className="mt-3 flex items-center justify-between gap-3 text-[13.5px]">
              <span>
                Monitoring on
                <span id="h-mon-d" className="block text-[12px] text-muted-foreground">Off stops checks and alerts. Incidents stay as they are.</span>
              </span>
              <Switch on={enabled} onChange={setEnabled} label="Monitoring on" describedBy="h-mon-d" />
            </div>
            <label className="mt-4 block text-[13.5px]">
              Email backup for critical alerts
              <span className="block text-[12px] text-muted-foreground">Used only when no alert device accepts a push. Blank turns the backup off.</span>
              <Input type="email" className={cn(input, "mt-1.5")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@example.com" />
            </label>
            <h4 className="mt-5 text-[16px] font-semibold">Check frequency and muting</h4>
            <p className="mt-1 text-[12px] text-muted-foreground">Minimum 60 s: the engine runs from the minute cron, so nothing is checked more often than once a minute. A muted service is still checked and recorded, never alerted.</p>
            <ul className="mt-2 divide-y divide-border/60">
              {monitored.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <span className="min-w-[160px] font-semibold">{s.name}</span>
                  <span className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      every
                      <Input type="number" min={60} max={3600} step={30} className={cn(input, "h-9 w-[90px] px-2 touch:h-11")} value={intervals[s.id] ?? data.intervalsDefault[s.id] ?? 60} onChange={(e) => setIntervals({ ...intervals, [s.id]: Math.max(60, Math.min(3600, Number(e.target.value) || 60)) })} aria-label={`${s.name} check interval in seconds`} />
                      s
                    </label>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      <Switch on={muted.includes(s.id)} onChange={(v) => setMuted(v ? [...muted, s.id] : muted.filter((x) => x !== s.id))} label={`Mute ${s.name}`} />
                      <span aria-hidden>mute</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button type="submit" variant="lime" className={btn} disabled={busy === "config"}>
                {busy === "config" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null} Save settings
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-[13px] text-muted-foreground">Check frequencies, muting and the email backup are set by a super admin.</p>
        )}
    </Sheet>
  );
}
