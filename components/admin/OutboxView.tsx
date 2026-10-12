"use client";
import { useState } from "react";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Empty, Pill, STATUS_TONE } from "./ui";

type R = { id: string; to: string; subject: string; html: string; kind: string; provider: string; status: string; error: string | null; createdAt: string };
const KIND: Record<string, string> = { invoice: "Invoice", ticket_opened: "Ticket opened", ticket_reply: "Ticket reply", test: "Test" };

export function OutboxView({ rows }: { rows: R[] }) {
  const [sel, setSel] = useState(rows[0]?.id ?? null);
  const cur = rows.find((r) => r.id === sel);
  if (!rows.length) return <Card><Empty title="No emails yet" body="Invoices, ticket confirmations and replies will appear here as they're sent." /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="max-h-[75dvh] overflow-y-auto p-2 sm:p-2">
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSel(r.id)} aria-pressed={sel === r.id} className={cn("flex w-full gap-3 rounded-2xl p-3 text-left transition-colors", sel === r.id ? "bg-secondary" : "hover:bg-foreground/[0.03]")}>
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{r.subject}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{r.to}</span>
                  <span className="mt-1 flex gap-1.5"><Pill>{KIND[r.kind] ?? r.kind}</Pill><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill></span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {cur && (
        <Card className="flex min-h-[60dvh] flex-col">
          <dl className="mb-4 grid gap-1 text-[13px]">
            <div className="flex gap-2"><dt className="w-16 text-muted-foreground">To</dt><dd className="font-medium">{cur.to}</dd></div>
            <div className="flex gap-2"><dt className="w-16 text-muted-foreground">Subject</dt><dd className="font-medium">{cur.subject}</dd></div>
            <div className="flex gap-2"><dt className="w-16 text-muted-foreground">Via</dt><dd className="capitalize">{cur.provider}{cur.error && <span className="text-destructive"> · {cur.error}</span>}</dd></div>
          </dl>
          {/* sandbox: no scripts, no same-origin, so a stored email can never touch the admin session */}
          <iframe title={`Email: ${cur.subject}`} sandbox="" srcDoc={cur.html} className="w-full flex-1 rounded-2xl bg-white hairline" style={{ minHeight: 480 }} />
        </Card>
      )}
    </div>
  );
}
