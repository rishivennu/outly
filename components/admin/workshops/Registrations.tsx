"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { adminApi } from "@/lib/client/admin-api";
import type { WorkshopView } from "@/lib/workshops/core";
import { Empty, ErrorState, LoadingState, StatusBadge, ago, fmtDate, statusOf } from "@/components/admin/ui";

export type Registration = { id: string; email: string; name: string; status: string; source: string; userId: string | null; createdAt: string; cancelledAt: string | null };

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ makes spreadsheets run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registrationsCsv(rows: Registration[]) {
  const head = ["name", "email", "status", "source", "registered_at", "cancelled_at"];
  return [head.join(","), ...rows.map((r) => [r.name, r.email, r.status, r.source, r.createdAt, r.cancelledAt ?? ""].map(csvCell).join(","))].join("\r\n") + "\r\n";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RegistrationsSheet({ workshop, onOpenChange }: { workshop: WorkshopView | null; onOpenChange: (o: boolean) => void }) {
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const id = workshop?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setRows(null);
    setError("");
    adminApi<{ registrations: Registration[] }>(`/api/admin/workshops/${id}`)
      .then((r) => live && setRows(r.registrations))
      .catch((e: any) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, tick]);

  const active = rows?.filter((r) => r.status === "registered").length ?? 0;
  return (
    <Sheet open={!!workshop} onOpenChange={onOpenChange} title="Registrations" description={workshop?.title}>
      {error ? (
        <ErrorState body={error} retry={<Button size="sm" variant="lime" onClick={() => setTick((t) => t + 1)}>Try again</Button>} />
      ) : !rows ? (
        <LoadingState shape="table" lines={4} label="Loading registrations" />
      ) : rows.length === 0 ? (
        <Empty title="No registrations yet" body="Creators who register on the workshop page show up here." />
      ) : (
        <div className="grid gap-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">{active} registered{rows.length > active ? `, ${rows.length - active} cancelled` : ""}</p>
            <Button size="sm" variant="outline" onClick={() => download(`${workshop?.slug ?? "workshop"}-registrations.csv`, registrationsCsv(rows))}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </Button>
          </div>
          <ul className="grid gap-2" aria-label="Registrations">
            {rows.map((r) => (
              <li key={r.id} className="admin-card admin-card--flat rounded-2xl px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium" title={r.name || r.email}>{r.name || r.email}</p>
                    {r.name && <p className="truncate text-[12.5px] text-muted-foreground" title={r.email}>{r.email}</p>}
                  </div>
                  <StatusBadge size="sm" status={r.status === "registered" ? "active" : statusOf(r.status)} label={r.status === "registered" ? "Registered" : undefined} />
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {r.source ? `${r.source} · ` : ""}
                  <time dateTime={r.createdAt} title={fmtDate(r.createdAt, true)}>registered {ago(r.createdAt)}</time>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
