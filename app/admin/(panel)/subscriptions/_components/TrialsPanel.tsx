"use client";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client/admin-api";
import { Card, CardTitle, Empty } from "@/components/admin/ui";
import { useToast } from "@/components/shared/Toast";
import { pct, Stat } from "./shared";

type Funnel = { started: number; active: number; converted: number; expired: number; canceled: number; conversionPct: number; decidedPct: number };
type Data = { all: Funnel; d30: Funnel; d7: Funnel };
const RANGES = [["d7", "Last 7 days"], ["d30", "Last 30 days"], ["all", "All time"]] as const;

export function TrialsPanel() {
  const toast = useToast();
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    adminApi<Data>("/api/admin/subscriptions/trials").then(setD).catch((e: Error) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!d) return <p className="text-[13.5px] text-muted-foreground" role="status">Loading trials</p>;
  if (!d.all.started) return <Empty title="No trials yet" body="Trials appear here once someone presses Start 7-day trial on Billing or the welcome screen." />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {RANGES.map(([k, label]) => {
        const f = d[k];
        const max = Math.max(f.started, 1);
        const steps = [["Started", f.started], ["Active now", f.active], ["Converted", f.converted], ["Expired", f.expired], ["Canceled", f.canceled]] as const;
        return (
          <Card key={k}>
            <CardTitle hint={`Conversion ${pct(f.conversionPct)} of started, ${pct(f.decidedPct)} of trials that ended`}>{label}</CardTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {steps.map(([name, n]) => <Stat key={name} label={name} value={n.toLocaleString("en-IN")} />)}
            </div>
            <ul className="mt-4 grid gap-2" aria-label={`${label} funnel`}>
              {steps.map(([name, n]) => (
                <li key={name} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-[12.5px]">
                  <span className="text-muted-foreground">{name}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                    <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular">{pct(n / max)}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
