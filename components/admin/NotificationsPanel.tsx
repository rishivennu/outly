"use client";
import { useMemo, useState } from "react";
import { BellOff, BellRing, Clock, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { GREET_LABEL, GREET_SLOTS, type CategoryId, type GreetSlot } from "@/lib/notify-core";
import { IDLE_LABEL, IDLE_TIERS, type IdleTier, type NotifyConfig } from "@/lib/notify-config-core";
import { COOLDOWN_MIN } from "@/lib/notify-core";
import { greetingProblems, renderGreeting } from "@/lib/admin/notifications-core";
import type { NotifyAuditEntry } from "@/lib/admin/notifications";
import { Card, CardTitle, Pill, StatusBadge, ago } from "./ui";

type TestResult = { sent: boolean; to: string; skipped?: boolean; reason?: string | null; devices: number; channels: { channel: string; status: string; reason: string | null; detail: string | null }[] };
const CHANNEL: Record<string, string> = { inapp: "Bell", push: "Web push", fcm: "App (Android)", email: "Email" };
const REASON: Record<string, string> = { event_off: "that event is switched off for you", inapp_off: "your bell is switched off", push_off: "push is off for you", email_off: "email is off for you", quiet_hours: "your quiet hours", cooldown: "a cooldown", paused: "the global pause", no_device: "no phone or computer is connected", push_error: "the push service refused it", email_error: "the email provider refused it" };

/**
 * 1141 admin > Notifications, the editable half. Everything here changes when and how loudly Outlly
 * speaks; none of it can invent a fact, because the templates hold no numbers and the line under a
 * greeting is read from the creator's own calendar at send time.
 */
const BUCKETS: { id: CategoryId | "assist"; label: string; hint: string }[] = [
  { id: "publishing", label: "Publishing", hint: "A post going live or failing. Normally no wait at all." },
  { id: "schedule", label: "Schedule", hint: "Reminders and schedule changes." },
  { id: "account", label: "Account", hint: "Sign-outs and tokens about to end." },
  { id: "engagement", label: "Comments and messages", hint: "The busiest one: this is what stops six buzzes about one post." },
  { id: "billing", label: "Billing", hint: "Payments and plans. Best left at no wait." },
  { id: "assist", label: "Assistant", hint: "Greetings, away nudges, tips and summaries." },
];

export function NotificationsPanel({ initial, adminLogin, adminName = "", audit = [] }: { initial: NotifyConfig; adminLogin: string; adminName?: string; audit?: NotifyAuditEntry[] }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [to, setTo] = useState(adminLogin);
  const [result, setResult] = useState<TestResult | null>(null);
  /** 1164: greeting lines that could not be saved, per slot, with the reason in plain words. */
  const [greetErr, setGreetErr] = useState<Partial<Record<GreetSlot, string[]>>>({});
  const lastPause = useMemo(() => audit.find((a) => a.kind === "notify_pause") ?? null, [audit]);
  const previewName = adminName.split(" ")[0] || "Asha";

  async function save(patch: Record<string, unknown>, done: string, tag = "save") {
    setBusy(tag);
    try {
      const r = await adminApi<{ config: NotifyConfig }>("/api/admin/notifications", { method: "PATCH", json: patch });
      setCfg(r.config);
      toast(done);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await adminApi<TestResult>("/api/admin/notifications", { method: "POST", json: { email: to } });
      setResult(r);
      const ok = r.channels.filter((c) => c.status === "sent").length;
      toast(r.sent ? `Test sent to ${r.to}: ${ok} of ${r.channels.length} channel${r.channels.length === 1 ? "" : "s"} accepted it.` : r.skipped ? `Nothing was sent: ${REASON[r.reason ?? ""] ?? r.reason ?? "it was held back"}.` : "Nothing was sent: that notification already exists.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const idle = (t: IdleTier, p: Partial<NotifyConfig["idle"][IdleTier]>) => save({ idle: { [t]: p } }, "Inactivity step saved.", `idle-${t}`);
  const greet = (s: GreetSlot, p: { on?: boolean; lines?: string[] }) => save({ greet: { [s]: p } }, "Greeting saved.", `greet-${s}`);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardTitle
          hint="The emergency brake. Push and email stop for everyone; the bell keeps filling, so nothing is lost, and essential alerts (a sign-out, a failed payment) still go out."
          action={<Pill tone={cfg.paused ? "warn" : "ok"}>{cfg.paused ? "Paused" : "Running"}</Pill>}
        >
          Global pause
        </CardTitle>
        <div className={cn("flex flex-wrap items-center justify-between gap-4 rounded-[20px] p-4 hairline", cfg.paused ? "bg-warning/10" : "bg-secondary/40")}>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-11 w-11 place-items-center rounded-2xl", cfg.paused ? "bg-warning/20 text-warning" : "bg-success/15 text-success")}>
              {cfg.paused ? <BellOff className="h-5 w-5" aria-hidden="true" /> : <BellRing className="h-5 w-5" aria-hidden="true" />}
            </span>
            <p className="text-[14px] text-muted-foreground">{cfg.paused ? "Only essential alerts are reaching people right now." : "Everything is being delivered as each creator asked."}</p>
          </div>
          <Button variant={cfg.paused ? "lime" : "outline"} disabled={busy === "pause"} onClick={() => save({ paused: !cfg.paused }, cfg.paused ? "Notifications are running again." : "Notifications paused.", "pause")}>
            {cfg.paused ? "Resume notifications" : "Pause notifications"}
          </Button>
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {lastPause ? <>Last changed <span suppressHydrationWarning>{ago(lastPause.at)}</span>: {lastPause.body ?? lastPause.title}</> : "Never paused or resumed from this screen. Every change here is written to the admin audit log with who did it."}
        </p>
        {audit.length > 0 && (
          <details className="mt-2 rounded-[14px] bg-secondary/30 px-3 py-2 hairline">
            <summary className="cursor-pointer text-[13px] font-medium min-h-11 flex items-center">Recent changes from this screen ({audit.length})</summary>
            <ul className="mb-1 grid gap-1.5 text-[12.5px] text-muted-foreground">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular text-foreground/80" suppressHydrationWarning>{ago(a.at)}</span>
                  <span>{a.body ?? a.title}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card>
        <CardTitle hint="Minutes of quiet after one notification in the same group. A second one inside the wait still lands in the bell; only the buzz is held back, and a summary can gather them up. Zero means no wait at all: every notification in that group buzzes as it happens, which is right for publishing and billing and wrong for comments.">
          Cooldowns
        </CardTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUCKETS.map((b) => (
            <div key={b.id} className="rounded-[18px] p-4 hairline">
              <Label htmlFor={`cd-${b.id}`}>{b.label}</Label>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  key={cfg.cooldown[b.id]}
                  id={`cd-${b.id}`}
                  type="number"
                  min={0}
                  max={1440}
                  className="w-24 tabular"
                  defaultValue={cfg.cooldown[b.id]}
                  onBlur={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v) && v >= 0 && v !== cfg.cooldown[b.id]) save({ cooldown: { [b.id]: Math.round(v) } }, `${b.label} cooldown set to ${Math.round(v)} minutes.`, `cd-${b.id}`);
                  }}
                />
                <span className="text-[13px] text-muted-foreground">minutes</span>
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">{b.hint}</p>
              <p className={cn("mt-1 text-[12.5px]", cfg.cooldown[b.id] === 0 ? "text-warning" : "text-muted-foreground")}>
                {cfg.cooldown[b.id] === 0 ? "No wait: every one in this group buzzes as it happens." : `Wait ${cfg.cooldown[b.id]} min between buzzes.`}
                {cfg.cooldown[b.id] !== COOLDOWN_MIN[b.id] && (
                  <> Default {COOLDOWN_MIN[b.id] === 0 ? "no wait" : `${COOLDOWN_MIN[b.id]} min`}.{" "}
                    <button type="button" className="underline underline-offset-2 min-h-11 -my-3 py-3" disabled={busy === `cd-${b.id}`} onClick={() => save({ cooldown: { [b.id]: COOLDOWN_MIN[b.id] } }, `${b.label} cooldown back to the default.`, `cd-${b.id}`)}>Reset</button>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle hint="How long away counts as away, and what the nudge says. A step can be moved but never to nothing, and a creator who switched away nudges off gets none of them.">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden="true" /> Inactivity steps</span>
        </CardTitle>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Away is measured from the creator&apos;s last visit, in minutes, so it works the same in every time zone. Each step is sent once per spell away; the moment they come back the clock restarts and nothing further from that spell goes out. Somebody who returns after a long time gets only the furthest step that applies, never a pile of four. After 30 days away Outlly stops nudging altogether.
        </p>
        <div className="grid gap-3">
          {IDLE_TIERS.map((t) => (
            <div key={t} className="rounded-[18px] p-4 hairline">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14px] font-semibold">{IDLE_LABEL[t]}</p>
                <Button size="sm" variant="outline" disabled={busy === `idle-${t}`} onClick={() => idle(t, { on: !cfg.idle[t].on })}>
                  {cfg.idle[t].on ? "Switch off" : "Switch on"}
                </Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
                <Input aria-label={`${IDLE_LABEL[t]} minutes`} type="number" min={5} max={86400} className="tabular" defaultValue={cfg.idle[t].minutes} onBlur={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v >= 5 && v !== cfg.idle[t].minutes) idle(t, { minutes: Math.round(v) });
                }} />
                <Input aria-label={`${IDLE_LABEL[t]} title`} defaultValue={cfg.idle[t].title} maxLength={80} onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== cfg.idle[t].title && idle(t, { title: e.currentTarget.value.trim() })} />
              </div>
              <Input className="mt-2" aria-label={`${IDLE_LABEL[t]} body`} defaultValue={cfg.idle[t].body} maxLength={200} onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== cfg.idle[t].body && idle(t, { body: e.currentTarget.value.trim() })} />
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                What they see after {cfg.idle[t].minutes >= 1440 ? `${Math.round(cfg.idle[t].minutes / 1440)} day${Math.round(cfg.idle[t].minutes / 1440) === 1 ? "" : "s"}` : cfg.idle[t].minutes >= 60 ? `${Math.round(cfg.idle[t].minutes / 60)} hour${Math.round(cfg.idle[t].minutes / 60) === 1 ? "" : "s"}` : `${cfg.idle[t].minutes} minutes`} away: <span className="text-foreground/80">{cfg.idle[t].title}</span> {cfg.idle[t].body}
              </p>
              {!cfg.idle[t].on && <p className="mt-2 text-[12.5px] text-warning">Off: this step is skipped, and the step below is not sent in its place.</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle hint="One line is picked per creator per day, so the same person never reads the same hello twice in a row. Write {name} where their first name goes. The line underneath is read from their calendar, not from here.">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden="true" /> Greeting templates</span>
        </CardTitle>
        <div className="grid gap-3">
          {GREET_SLOTS.map((s) => (
            <div key={s} className="rounded-[18px] p-4 hairline">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[14px] font-semibold">{GREET_LABEL[s]}</p>
                <Button size="sm" variant="outline" disabled={busy === `greet-${s}`} onClick={() => greet(s, { on: !cfg.greet[s].on })}>
                  {cfg.greet[s].on ? "Switch off" : "Switch on"}
                </Button>
              </div>
              <Label className="mt-3 block" htmlFor={`greet-${s}`}>Lines, one per row</Label>
              <textarea
                id={`greet-${s}`}
                rows={3}
                defaultValue={cfg.greet[s].lines.join("\n")}
                className="mt-1 w-full rounded-[14px] bg-secondary/40 p-3 text-[13.5px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-invalid={greetErr[s]?.length ? true : undefined}
                aria-describedby={`greet-${s}-help`}
                onBlur={(e) => {
                  const lines = e.currentTarget.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
                  const problems = greetingProblems(lines);
                  setGreetErr((g) => ({ ...g, [s]: problems }));
                  if (problems.length) return;
                  if (lines.join("\n") !== cfg.greet[s].lines.join("\n")) greet(s, { lines });
                }}
              />
              <div id={`greet-${s}-help`} className="mt-2 text-[12.5px]">
                {greetErr[s]?.length ? (
                  <ul className="grid gap-1 text-destructive" role="alert">
                    {greetErr[s]!.map((m) => <li key={m}>{m} Not saved.</li>)}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    {cfg.greet[s].lines.length} line{cfg.greet[s].lines.length === 1 ? "" : "s"}; up to 12 are kept. Preview for {previewName}: <span className="text-foreground/80">{renderGreeting(cfg.greet[s].lines[0] ?? "", previewName)}</span>
                    {cfg.greet[s].lines.some((l) => !l.includes("{name}")) && " Lines without {name} are fine; they just read the same for everyone."}
                  </p>
                )}
              </div>
              {!cfg.greet[s].on && <p className="mt-2 text-[12.5px] text-warning">Off: nobody is greeted at this time, whatever they chose in their own settings.</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle hint="When several pushes are held back by a cooldown inside the window, the creator gets one summary that counts them instead.">Summaries</CardTitle>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Only pushes a cooldown held back are counted; the originals are already in the creator&apos;s bell, and the summary opens it. Every {cfg.digest.windowMin} minutes Outlly looks at the window just closed and, if {cfg.digest.min} or more were held back for one creator, sends one push saying how many. Fewer than that and nothing extra is sent. Warnings and failures are summarised separately from good news, so a problem never hides inside a happy count.
        </p>
        <div className="flex flex-wrap items-end gap-4 rounded-[18px] p-4 hairline">
          <div>
            <Label htmlFor="dg-window">Window</Label>
            <Input id="dg-window" type="number" min={5} max={1440} className="mt-1 w-24 tabular" defaultValue={cfg.digest.windowMin} onBlur={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v) && v >= 5 && v !== cfg.digest.windowMin) save({ digest: { windowMin: Math.round(v) } }, "Summary window saved.", "digest");
            }} />
          </div>
          <div>
            <Label htmlFor="dg-min">Held back before a summary</Label>
            <Input id="dg-min" type="number" min={2} max={50} className="mt-1 w-24 tabular" defaultValue={cfg.digest.min} onBlur={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v) && v >= 2 && v !== cfg.digest.min) save({ digest: { min: Math.round(v) } }, "Summary threshold saved.", "digest");
            }} />
          </div>
          <Button variant="outline" disabled={busy === "digest-on"} onClick={() => save({ digest: { on: !cfg.digest.on } }, cfg.digest.on ? "Summaries off." : "Summaries on.", "digest-on")}>
            {cfg.digest.on ? "Switch summaries off" : "Switch summaries on"}
          </Button>
          <Pill tone={cfg.digest.on ? "ok" : "muted"}>{cfg.digest.on ? "On" : "Off"}</Pill>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Sends one notification titled 'Test notification' to the account you are signed in with, through every channel that creator has on: the bell, web push to each connected browser or phone, and email if it is on. It can go nowhere else, so nobody is messaged by accident. The send is written to the admin audit log.">
          <span className="flex items-center gap-2"><Send className="h-4 w-4" aria-hidden="true" /> Test send</span>
        </CardTitle>
        <div className="flex flex-wrap items-end gap-3 rounded-[18px] p-4 hairline">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[16rem]">
            <Label htmlFor="nt-to">Your own creator account</Label>
            <Input id="nt-to" type="email" className="mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Goes to the bell, every connected device and email, exactly as a real notification would, labelled as a test.</p>
          </div>
          <Button disabled={busy === "test" || !to} onClick={test}>{busy === "test" ? "Sending" : "Send test"}</Button>
        </div>
        {result && (
          <div className="mt-3 rounded-[18px] p-4 hairline" role="status">
            <p className="text-[13px] font-semibold">What each channel said{result.sent ? ` for ${result.to}` : ""}</p>
            {result.channels.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-muted-foreground">{result.skipped ? `Held back before any channel was tried: ${REASON[result.reason ?? ""] ?? result.reason ?? "a setting"}.` : "No delivery rows were written, so there is nothing to report."}</p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {result.channels.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="min-w-[7rem] font-medium">{CHANNEL[c.channel] ?? c.channel}</span>
                    <StatusBadge status={c.status} />
                    <span className="text-[12.5px] text-muted-foreground">{c.reason ? REASON[c.reason] ?? c.reason : c.detail ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-muted-foreground">{result.devices} connected browser{result.devices === 1 ? "" : "s"} or phone{result.devices === 1 ? "" : "s"} for this account. Accepted means the provider took it, not that it was seen.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
