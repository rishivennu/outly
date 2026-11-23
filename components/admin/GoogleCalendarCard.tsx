"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import type { calendarStatus } from "@/lib/google/calendar";
import { Card, CardTitle, Pill, ago, fmtDate } from "./ui";

type CalendarStatusView = Awaited<ReturnType<typeof calendarStatus>>;
type Notice = { ok: boolean; text: string } | null;

/** R1309: the Google Calendar connection workshops publish through (Meet link + invites to registered creators). */
export function GoogleCalendarCard({ initial }: { initial: CalendarStatusView }) {
  const toast = useToast();
  const router = useRouter();
  const [cal, setCal] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setCal(initial);
  }
  const [notice, setNotice] = useState<Notice>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      setCal(await adminApi<CalendarStatusView>("/api/admin/integrations/google", { method: "DELETE" }));
      setNotice(null);
      toast("Google Calendar disconnected", "ok");
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
      setAsk(false);
    }
  }

  return (
    <Card>
      <Suspense fallback={null}>
        <ReturnNotice onNotice={setNotice} />
      </Suspense>
      <CardTitle
        hint="Publishing a workshop creates the Google Calendar event with a Meet link and invites every registered creator. Edits and cancellations update the invite."
        action={<Pill tone={cal.connected ? "ok" : "muted"}>{cal.connected ? "Connected" : "Not connected"}</Pill>}
      >
        <span className="inline-flex items-center gap-2.5">
          <span aria-hidden className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-[#1a73e8] text-white"><CalendarDays className="h-4 w-4" /></span>
          Google Calendar
        </span>
      </CardTitle>

      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "mb-4 flex items-start gap-2 rounded-2xl bg-success/10 px-4 py-3 text-[13px] font-medium pill-ink-ok" : "mb-4 flex items-start gap-2 rounded-2xl bg-destructive/[0.08] px-4 py-3 text-[13px] font-medium text-[hsl(0_72%_38%)] dark:text-destructive"}>
          {notice.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {notice.text}
        </p>
      )}

      {cal.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[14px]">
            <p className="truncate font-medium" title={cal.email}>{cal.email || "Connected account"}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {cal.connectedAt ? <time suppressHydrationWarning dateTime={cal.connectedAt} title={fmtDate(cal.connectedAt, true)}>Connected {ago(cal.connectedAt)}</time> : "Connected"}
              {cal.calendarId && cal.calendarId !== "primary" ? ` · calendar ${cal.calendarId}` : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsk(true)}>Disconnect</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {!cal.clientReady && (
            <p className="text-[13px]">
              Add the Google (YouTube) client ID and secret in{" "}
              <Link href="/admin/platforms" className="font-medium underline underline-offset-4">Social platforms</Link> first. The same Google app signs in to Calendar.
            </p>
          )}
          <div>
            <Button asChild variant="lime" size="sm">
              <a href="/api/admin/integrations/google">Connect Google Calendar</a>
            </Button>
          </div>
          <p className="text-[12.5px] text-muted-foreground">Google shows an &ldquo;unverified app&rdquo; screen for now. That is expected: choose Advanced, then continue to Outlly.</p>
        </div>
      )}

      <ConfirmDialog
        open={ask}
        onOpenChange={(o) => !busy && setAsk(o)}
        busy={busy}
        title="Disconnect Google Calendar?"
        body="Publishing stops creating Meet links and invites until you connect again. Existing events stay in Google Calendar."
        confirmLabel="Disconnect"
        onConfirm={disconnect}
      />
    </Card>
  );
}

/** Reads ?gcal=connected|error&reason= once after the Google round trip, then clears it from the URL. */
function ReturnNotice({ onNotice }: { onNotice: (n: Notice) => void }) {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const done = useRef(false);
  const gcal = sp.get("gcal");
  const reason = sp.get("reason");
  useEffect(() => {
    if (done.current || (gcal !== "connected" && gcal !== "error")) return;
    done.current = true;
    const n = gcal === "connected" ? { ok: true, text: "Google Calendar connected. Publishing now creates Meet links and invites." } : { ok: false, text: `Google Calendar didn't connect${reason ? `: ${reason}` : "."}` };
    onNotice(n);
    toast(n.ok ? "Google Calendar connected" : "Google Calendar didn't connect", n.ok ? "ok" : "error");
    router.replace("/admin/integrations", { scroll: false });
    if (n.ok) router.refresh();
  }, [gcal, reason, onNotice, router, toast]);
  return null;
}
