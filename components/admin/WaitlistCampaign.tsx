"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Megaphone, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import type { CampaignStatus } from "@/lib/campaigns";
import { Card, CardTitle, Pill, Table, ago } from "./ui";

const ist = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const STATUS_WORD: Record<string, string> = { failed: "Failed", bounced: "Bounced", complained: "Marked as spam" };

/**
 * The one-time waitlist update email (1142). Preview it, confirm the exact head-count, launch once, watch it go.
 * Sending runs in the background (the minute cron); while this card is open it also pushes the next batch every
 * few seconds. Launch can only succeed once on the server, so a refresh, a second tab or a redeploy sends nothing.
 */
export function WaitlistCampaign({ initial }: { initial: CampaignStatus }) {
  const toast = useToast();
  const [st, setSt] = useState(initial);
  const [ask, setAsk] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<null | "launch" | "process">(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const pumping = useRef(false);

  const c = st.counts;
  const launched = !!st.launchedAt;
  const total = st.eligible;
  const done = total - c.pending;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const state = !launched ? "Not sent" : st.doneAt ? "Finished" : "Sending";

  async function post(action: "launch" | "process") {
    const r = await adminApi<CampaignStatus & { launched?: number; batch: { sent: number; left: number } }>("/api/admin/campaigns/waitlist-update", {
      method: "POST",
      json: action === "launch" ? { action, confirm: true, expect: st.eligible } : { action },
    });
    setSt(r);
    return r;
  }

  async function launch() {
    setBusy("launch");
    try {
      const r = await post("launch");
      toast(`Sending to ${r.launched ?? r.eligible} people. You can leave this page: it keeps going in the background.`);
      setAsk(false);
    } catch (e) {
      toast((e as Error).message, "error");
      // The list may have changed: show the current numbers before anyone tries again.
      adminApi<CampaignStatus>("/api/admin/campaigns/waitlist-update").then(setSt).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  async function processNow() {
    setBusy("process");
    try {
      const r = await post("process");
      toast(r.batch.sent ? `${r.batch.sent} sent just now` : r.counts.pending ? "Nothing due yet: retries wait a few minutes" : "Nothing left to send");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  // While launched and not finished: push a batch, wait, repeat. One request at a time.
  useEffect(() => {
    if (!launched || st.doneAt || c.pending === 0 || busy) return;
    const t = setTimeout(async () => {
      if (pumping.current || document.visibilityState !== "visible") return;
      pumping.current = true;
      try {
        await post("process");
      } catch {
        /* the cron sweep carries on; try again on the next tick */
      } finally {
        pumping.current = false;
      }
    }, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launched, st, busy]);

  async function togglePreview() {
    if (!showPreview && preview === null) {
      try {
        setPreview((await adminApi<{ html: string }>("/api/admin/campaigns/waitlist-update?preview=1")).html);
      } catch (e) {
        toast((e as Error).message, "error");
        return;
      }
    }
    setShowPreview((v) => !v);
  }

  const stats: [string, string, string][] = [
    ["Eligible", total.toLocaleString("en-IN"), launched ? "Recipients at launch" : "Would get it now"],
    ["Sent", c.sent.toLocaleString("en-IN"), c.mocked ? `${c.mocked} to the Outbox (Mock)` : "Accepted by Resend"],
    ["Pending", c.pending.toLocaleString("en-IN"), launched ? "Queued or retrying" : "Not launched"],
    ["Failed", c.failed.toLocaleString("en-IN"), c.bounced ? `${c.bounced} bounced` : "After every retry"],
    ["Delivered", st.deliveryTracking ? c.delivered.toLocaleString("en-IN") : "–", st.deliveryTracking ? "Confirmed by Resend" : "Needs the Resend webhook"],
    ["Unsubscribed", c.skipped.toLocaleString("en-IN"), "Skipped, opted out"],
  ];

  return (
    <Card className="mt-4" aria-labelledby="wl-campaign">
      <CardTitle hint={`One time, to everyone who joined before ${ist(st.cutoff)}. People who join later never get it.`} action={<Pill tone={!launched ? "muted" : st.doneAt ? "ok" : "info"}>{state}</Pill>}>
        <span id="wl-campaign" className="inline-flex items-center gap-2">
          <Megaphone className="h-4 w-4" aria-hidden /> Waitlist update email
        </span>
      </CardTitle>

      <p className="mb-4 rounded-2xl bg-secondary/40 px-4 py-3 text-[13.5px] hairline [overflow-wrap:anywhere]">
        <span className="block text-[12px] font-semibold text-muted-foreground">Subject</span>
        {st.subject}
      </p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map(([k, v, h]) => (
          <div key={k} className="min-w-0 rounded-2xl bg-secondary/50 p-3">
            <dt className="truncate text-[12px] font-semibold text-muted-foreground">{k}</dt>
            <dd className="mt-1 font-display text-[1.6rem] font-bold leading-none tabular">{v}</dd>
            <dd className="mt-1.5 truncate text-[11.5px] text-muted-foreground" title={h}>{h}</dd>
          </div>
        ))}
      </dl>

      {launched && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="font-semibold">{st.doneAt ? `Finished ${ago(st.doneAt)}` : `Sending: ${done} of ${total} done`}</span>
            <span className="text-muted-foreground tabular">{pct}%</span>
          </div>
          <div role="progressbar" aria-label="Campaign progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-success transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Launched by {st.launchedBy ?? "an admin"} {ago(st.launchedAt)}
            {st.lastSentAt ? `, last email ${ago(st.lastSentAt)}` : ""}. It keeps sending in the background if you leave.
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-1 text-[12.5px] text-muted-foreground">
        <li>Each person gets their own email; nobody sees anyone else&apos;s address. Unsubscribed people are skipped.</li>
        {!launched && (st.excluded.joinedAfter > 0 || st.excluded.invalid > 0 || st.excluded.duplicates > 0) && (
          <li>
            Left out: {st.excluded.joinedAfter} joined after the cutoff{st.excluded.invalid ? `, ${st.excluded.invalid} invalid address${st.excluded.invalid === 1 ? "" : "es"}` : ""}
            {st.excluded.duplicates ? `, ${st.excluded.duplicates} duplicate${st.excluded.duplicates === 1 ? "" : "s"}` : ""}.
          </li>
        )}
        {!st.deliveryTracking && <li>Delivered counts appear once the Resend webhook is set up (Admin &gt; Integrations &gt; Email).</li>}
      </ul>

      {st.blockedWhy && !launched && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-2xl bg-warning/10 px-4 py-3 text-[13px] hairline">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {st.blockedWhy}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="subtle" onClick={togglePreview} aria-expanded={showPreview} aria-controls="wl-campaign-preview">
          {showPreview ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          {showPreview ? "Hide preview" : "Preview email"}
        </Button>
        {!launched ? (
          <Button type="button" variant="primary" disabled={!!busy || !st.canSend || total === 0} onClick={() => (setAck(false), setAsk(true))}>
            <Send className="h-4 w-4" aria-hidden /> Send to {total.toLocaleString("en-IN")} {total === 1 ? "person" : "people"}
          </Button>
        ) : (
          !st.doneAt && (
            <Button type="button" variant="subtle" disabled={!!busy} onClick={processNow}>
              <RefreshCw className="h-4 w-4" aria-hidden /> {busy === "process" ? "Sending…" : "Send next batch now"}
            </Button>
          )
        )}
      </div>

      {showPreview && preview !== null && (
        <div id="wl-campaign-preview" className="mt-4 overflow-hidden rounded-[20px] bg-white hairline">
          <iframe title="Email preview" sandbox="" srcDoc={preview} className="block h-[640px] w-full border-0" />
        </div>
      )}

      {st.failures.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-[13px] font-semibold">Not delivered</h3>
          <Table label="Campaign failures" head={["Email", "Result", "Reason", "When"]} minWidth={560}>
            {st.failures.map((f) => (
              <tr key={f.email}>
                <td className="max-w-[240px] truncate font-medium">{f.email}</td>
                <td><Pill tone="bad">{STATUS_WORD[f.status] ?? f.status}</Pill></td>
                <td className="text-muted-foreground [overflow-wrap:anywhere]">{f.error ?? "-"}{f.attempts > 1 ? ` (${f.attempts} tries)` : ""}</td>
                <td className="whitespace-nowrap text-muted-foreground">{ago(f.at)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={ask}
        onOpenChange={(o) => !o && !busy && setAsk(false)}
        title={`Send the waitlist update to ${total.toLocaleString("en-IN")} ${total === 1 ? "person" : "people"}?`}
        body={`Everyone who joined before ${ist(st.cutoff)} gets one email: "${st.subject}". This runs once and can't be undone or sent again.`}
        confirmLabel="Send it"
        tone="primary"
        busy={busy === "launch"}
        disabled={!ack}
        onConfirm={launch}
        extra={
          <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-[13.5px]">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[hsl(var(--foreground))]" />
            <span>I&apos;ve checked the preview and the number of people.</span>
          </label>
        }
      />
    </Card>
  );
}
