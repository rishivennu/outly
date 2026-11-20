"use client";
import { useId, useState } from "react";
import { Table2, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardTitle, Empty, Table } from "./ui";

export type ChartTable = { head: string[]; rows: (string | number)[][]; label?: string };

/**
 * 1163: every chart on the panel lives in one of these. Title and a line on what the chart measures; a switch
 * to the same data as a table (the numbers are the record, the drawing is a reading aid); and when every value
 * in the range is zero, the empty message instead of a flat line pretending to be a trend.
 */
export function AdminChartCard({ title, hint, children, table, empty, allZero = false, action, className, tall = false }: { title: string; hint?: React.ReactNode; children: React.ReactNode; table?: ChartTable; empty?: { title: string; body?: string }; allZero?: boolean; action?: React.ReactNode; className?: string; tall?: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  const fmt = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-IN") : v);
  // R1270: a two-way segmented control (glass trough on phones, .gseg) instead of one toggle button.
  const seg = (v: "chart" | "table", Icon: typeof LineChart, text: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      aria-controls={id}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[hsl(var(--ring))] touch:h-11",
        view === v ? "bg-background font-semibold text-foreground shadow-sm" : "font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {text}
    </button>
  );
  const toggle = table ? (
    <div role="group" aria-label={`Show ${title} as`} className="gseg inline-flex shrink-0 items-center gap-0.5 rounded-full bg-secondary/60 p-0.5">
      {seg("chart", LineChart, "Chart")}
      {seg("table", Table2, "Table")}
    </div>
  ) : null;
  return (
    <Card data-enter className={cn("flex min-w-0 flex-col", className)}>
      <CardTitle hint={hint} action={action || toggle ? <div className="flex items-center gap-2">{action}{toggle}</div> : undefined}>{title}</CardTitle>
      <div id={id} className={cn("min-w-0 flex-1", tall && "min-h-[260px]")}>
        {view === "table" && table ? (
          <Table label={table.label ?? `${title} as a table`} head={table.head} align={table.head.map((_, j) => (j > 0 ? "right" : undefined))}>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cn(j > 0 && "tabular")}>{fmt(c)}</td>
                ))}
              </tr>
            ))}
          </Table>
        ) : allZero ? (
          <Empty title={empty?.title ?? "Nothing in this range"} body={empty?.body ?? "Every value is zero, so there is no trend to draw yet."} />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
