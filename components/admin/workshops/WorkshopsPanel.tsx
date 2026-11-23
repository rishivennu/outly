"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { STATUS_LABEL, WORKSHOP_STATUSES, fmtWhen, type WorkshopStatus, type WorkshopView } from "@/lib/workshops/core";
import type { calendarStatus } from "@/lib/google/calendar";
import { Card, Empty, Pill, StatusBadge, Table, Tooltip, ago, fmtDate } from "@/components/admin/ui";
import { FilterSelect, SearchBox } from "@/components/admin/SearchBox";
import { WorkshopForm } from "./WorkshopForm";
import { RegistrationsSheet } from "./Registrations";

export type CalendarStatusView = Awaited<ReturnType<typeof calendarStatus>>;

/** Shared badge vocabulary (components/admin/ui STATUS_LABEL) with the workshop's own words. */
const BADGE: Record<WorkshopStatus, string> = { draft: "skipped", published: "live", cancelled: "canceled", completed: "queued" };
const STATUS_OPTS = [{ value: "", label: "All statuses" }, ...WORKSHOP_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))];

type Confirm = { kind: "cancel" | "delete" | "disconnect"; w?: WorkshopView } | null;

export function WorkshopsPanel({ initial, calendar, now }: { initial: WorkshopView[]; calendar: CalendarStatusView; now: number }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const [rows, setRows] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setRows(initial);
  }
  const [cal, setCal] = useState(calendar);
  const [editing, setEditing] = useState<WorkshopView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [seats, setSeats] = useState<WorkshopView | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const status = sp.get("status") ?? "";
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  // The page-head "New workshop" link is ?new=1, so it works from the server-rendered header too.
  useEffect(() => {
    if (sp.get("new") !== "1") return;
    setEditing(null);
    setFormOpen(true);
    const n = new URLSearchParams(sp.toString());
    n.delete("new");
    router.replace(n.toString() ? `${path}?${n}` : path, { scroll: false });
  }, [sp, path, router]);

  const shown = useMemo(() => rows.filter((w) => (!status || w.status === status) && (!q || w.title.toLowerCase().includes(q) || w.slug.includes(q))), [rows, status, q]);
  const kpis = useMemo(() => {
    const upcoming = rows.filter((w) => w.status === "published" && !w.past);
    return [
      { label: "Upcoming published", value: upcoming.length },
      { label: "Registered seats", value: upcoming.reduce((s, w) => s + w.registered, 0), hint: "Across upcoming sessions" },
      { label: "Drafts", value: rows.filter((w) => w.status === "draft").length },
      { label: "Completed", value: rows.filter((w) => w.status === "completed").length },
    ];
  }, [rows]);

  const put = (w: WorkshopView) => setRows((xs) => (xs.some((x) => x.id === w.id) ? xs.map((x) => (x.id === w.id ? w : x)) : [w, ...xs]));

  async function patch(w: WorkshopView, body: object, done: string) {
    setBusy(w.id);
    try {
      const r = await adminApi<{ workshop: WorkshopView }>(`/api/admin/workshops/${w.id}`, { method: "PATCH", json: body });
      put(r.workshop);
      toast(r.workshop.googleError ? `${done}. Google Calendar sync failed.` : done, r.workshop.googleError ? "error" : "ok");
      router.refresh();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, w } = confirm;
    if (kind === "cancel" && w) await patch(w, { status: "cancelled" }, "Workshop cancelled");
    if (kind === "delete" && w) {
      setBusy(w.id);
      try {
        await adminApi(`/api/admin/workshops/${w.id}`, { method: "DELETE" });
        setRows((xs) => xs.filter((x) => x.id !== w.id));
        toast("Draft deleted", "ok");
        router.refresh();
      } catch (e: any) {
        toast(e.message, "error");
      } finally {
        setBusy(null);
      }
    }
    if (kind === "disconnect") {
      setBusy("gcal");
      try {
        setCal(await adminApi<CalendarStatusView>("/api/admin/integrations/google", { method: "DELETE" }));
        toast("Google Calendar disconnected", "ok");
        router.refresh();
      } catch (e: any) {
        toast(e.message, "error");
      } finally {
        setBusy(null);
      }
    }
    setConfirm(null);
  }

  return (
    <div className="grid gap-5">
      <CalendarBanner cal={cal} busy={busy === "gcal"} onDisconnect={() => setConfirm({ kind: "disconnect" })} />

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Workshop totals">
        {kpis.map((k) => (
          <li key={k.label} className="admin-card min-h-[88px] rounded-[24px] bg-card p-4">
            <span className="block text-[12px] font-semibold text-muted-foreground">{k.label}</span>
            <span className="mt-2 block font-display text-[1.6rem] font-bold leading-none tabular-nums">{k.value.toLocaleString("en-IN")}</span>
            {k.hint && <span className="mt-1.5 block text-[12px] text-muted-foreground">{k.hint}</span>}
          </li>
        ))}
      </ul>

      <Card>
        <div role="group" aria-label="Filter workshops" className="mb-5 grid grid-cols-2 items-center gap-2.5 sm:flex sm:flex-wrap">
          <div className="col-span-2 min-w-0 sm:min-w-[16rem] sm:flex-1">
            <SearchBox placeholder="Search by title" />
          </div>
          <FilterSelect param="status" label="Status" options={STATUS_OPTS} current={status} inline />
          <Button variant="lime" size="sm" onClick={openNew} className="sm:ml-auto">
            <Plus className="h-4 w-4" aria-hidden /> New workshop
          </Button>
        </div>

        {shown.length === 0 ? (
          rows.length ? (
            <Empty
              title="No workshops match"
              body="Try another search, or clear the filters to see every workshop."
              action={<Button asChild variant="outline"><Link href="/admin/workshops">Clear filters</Link></Button>}
            />
          ) : (
            <Empty icon={<CalendarDays />} title="No workshops yet" body="Schedule the first live session. It stays a draft until you publish." action={<Button variant="lime" onClick={openNew}><Plus className="h-4 w-4" aria-hidden /> New workshop</Button>} />
          )
        ) : (
          <Table label="Workshops" head={["When", "Title", "Status", "Seats", "Calendar", <span key="a" className="sr-only">Actions</span>]} lead={1} minWidth={1000}>
            {shown.map((w) => {
              const when = fmtWhen(w.startsAt, w.endsAt, w.timezone);
              const off = busy === w.id;
              return (
                <tr key={w.id}>
                  <td className="whitespace-nowrap">
                    <p className="font-medium">{when.day}</p>
                    <p className="text-[12px] text-muted-foreground">{when.time}</p>
                  </td>
                  <td className="max-w-[280px]">
                    <p className="truncate font-medium" title={w.title}>{w.title}</p>
                    <p className="truncate font-mono text-[12px] text-muted-foreground">/{w.slug}</p>
                  </td>
                  <td>
                    {w.live && w.status === "published" ? <StatusBadge size="sm" status="running" label="Live now" /> : <StatusBadge size="sm" status={BADGE[w.status]} label={STATUS_LABEL[w.status]} />}
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setSeats(w)} className="-mx-2 font-medium tabular-nums text-foreground underline decoration-foreground/30 underline-offset-4" aria-label={`Registrations for ${w.title}: ${w.registered} of ${w.capacity || "open"}`}>
                      {w.registered} / {w.capacity || "open"}
                    </Button>
                  </td>
                  <td>
                    <CalendarCell w={w} connected={cal.connected} now={now} busy={off} onRetry={() => patch(w, { resync: true }, "Calendar synced")} />
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={off} onClick={() => { setEditing(w); setFormOpen(true); }} aria-label={`Edit ${w.title}`}>Edit</Button>
                      {w.status === "draft" && <Button size="sm" variant="lime" disabled={off} onClick={() => patch(w, { status: "published" }, "Workshop published")}>Publish</Button>}
                      {w.status === "published" && !w.past && <Button size="sm" variant="danger" disabled={off} onClick={() => setConfirm({ kind: "cancel", w })}>Cancel</Button>}
                      {w.status === "published" && w.past && <Button size="sm" variant="outline" disabled={off} onClick={() => patch(w, { status: "completed" }, "Marked completed")}>Complete</Button>}
                      {w.status === "draft" && <Button size="sm" variant="danger" disabled={off} onClick={() => setConfirm({ kind: "delete", w })}>Delete</Button>}
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/workshops/${w.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`Open the page for ${w.title} in a new tab`}>
                          Open page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <WorkshopForm
        open={formOpen}
        onOpenChange={setFormOpen}
        workshop={editing}
        calendarConnected={cal.connected}
        onSaved={(w) => {
          put(w);
          setFormOpen(false);
          toast(w.googleError ? "Saved. Google Calendar sync failed, retry from the table." : w.status === "published" ? "Workshop saved and published" : "Workshop saved", w.googleError ? "error" : "ok");
          router.refresh();
        }}
      />
      <RegistrationsSheet workshop={seats} onOpenChange={(o) => !o && setSeats(null)} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
        busy={!!busy}
        title={confirm?.kind === "cancel" ? "Cancel this workshop?" : confirm?.kind === "delete" ? "Delete this draft?" : "Disconnect Google Calendar?"}
        body={
          confirm?.kind === "cancel"
            ? `Registered creators are told "${confirm.w?.title}" is off, and the calendar event is cancelled.`
            : confirm?.kind === "delete"
              ? `"${confirm?.w?.title}" goes for good. It was never published.`
              : "Publishing stops creating Meet links and invites until you connect again. Existing events stay in Google Calendar."
        }
        confirmLabel={confirm?.kind === "cancel" ? "Cancel workshop" : confirm?.kind === "delete" ? "Delete draft" : "Disconnect"}
        onConfirm={runConfirm}
      />
    </div>
  );
}

function CalendarCell({ w, connected, now, busy, onRetry }: { w: WorkshopView; connected: boolean; now: number; busy: boolean; onRetry: () => void }) {
  if (w.googleError) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Tooltip text={w.googleError} describe>
          <span tabIndex={0} title={w.googleError} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--ring))]">
            <StatusBadge size="sm" status="failed" label="Sync failed" />
          </span>
        </Tooltip>
        <Button size="sm" variant="ghost" disabled={busy || !connected} onClick={onRetry} aria-label={`Retry the calendar sync for ${w.title}`}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      </span>
    );
  }
  if (w.googleEventId && w.googleSyncedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px]" title={fmtDate(w.googleSyncedAt, true)}>
        <Check className="h-4 w-4 text-success" aria-hidden />
        <span>Synced <span className="text-muted-foreground">{ago(w.googleSyncedAt, now)}</span></span>
      </span>
    );
  }
  if (w.status === "draft") return <span className="text-[13px] text-muted-foreground">On publish</span>;
  if (!connected) return <span className="text-[13px] text-muted-foreground">Not connected</span>;
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={onRetry} aria-label={`Sync ${w.title} to Google Calendar`}>
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Sync now
    </Button>
  );
}

function CalendarBanner({ cal, busy, onDisconnect }: { cal: CalendarStatusView; busy: boolean; onDisconnect: () => void }) {
  if (cal.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pill tone="ok" className="h-auto min-h-7 whitespace-normal py-1">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> Google Calendar connected{cal.email ? ` as ${cal.email}` : ""}
        </Pill>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDisconnect}>{busy ? "Disconnecting…" : "Disconnect"}</Button>
      </div>
    );
  }
  return (
    <Card className="bg-warning/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/15 pill-ink-warn"><CalendarDays className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Google Calendar is not connected</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Connect Google Calendar so publishing creates the Meet link and invites registered creators.</p>
            {!cal.clientReady && (
              <p className="mt-1.5 text-[13px]">
                Add the Google (YouTube) client ID and secret in{" "}
                <Link href="/admin/platforms" className="font-medium underline underline-offset-4">Social platforms</Link> first.
              </p>
            )}
          </div>
        </div>
        <Button asChild variant="lime" size="sm">
          <a href="/api/admin/integrations/google">Connect Google Calendar</a>
        </Button>
      </div>
    </Card>
  );
}
