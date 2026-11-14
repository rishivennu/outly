"use client";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client/admin-api";
import { Input, Label } from "@/components/ui/field";
import { Card, CardTitle, Empty, Pill, Table } from "@/components/admin/ui";
import { useToast } from "@/components/shared/Toast";
import { inr, MarginBadge, pct, Stat, TIER_LABEL } from "./shared";

type Row = { userId: string; email: string | null; plan: string; tier: string; revenueMinor: number; feeMinor: number; costMinor: number; profitMinor: number; budgetMinor: number; margin: number | null; overBudget: boolean };
type PlanRow = { plan: string; subscribers: number; revenueMinor: number; feeMinor: number; costMinor: number; profitMinor: number; margin: number | null; belowTarget: number };
type Report = { month: string; target: number; rows: Row[]; plans: PlanRow[]; totals: Omit<PlanRow, "plan"> };

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function EconomicsReport() {
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setR(null);
    adminApi<Report>(`/api/admin/subscriptions/economics?month=${month}`).then(setR).catch((e: Error) => toast(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <Card>
      <CardTitle
        hint="Net revenue is after GST. Every amount is in rupees at the policy exchange rate. Margin is (net revenue minus fees minus cost) over net revenue."
        action={
          <div className="w-40 shrink-0">
            <Label htmlFor="econ-month">Month (UTC)</Label>
            <Input id="econ-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </div>
        }
      >
        Revenue, cost and margin
      </CardTitle>
      {!r ? (
        <p className="text-[13.5px] text-muted-foreground" role="status">Loading {month}</p>
      ) : !r.rows.length ? (
        <Empty title={`No paying subscribers in ${r.month}`} body="Rows appear as payments and metered usage are recorded for the month." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Subscribers" value={r.totals.subscribers} />
            <Stat label="Net revenue" value={inr(r.totals.revenueMinor)} />
            <Stat label="Fees + cost" value={inr(r.totals.feeMinor + r.totals.costMinor)} />
            <Stat label="Profit" value={inr(r.totals.profitMinor)} />
            <Stat label="Margin" value={pct(r.totals.margin)} hint={`${r.totals.belowTarget} below ${pct(r.target)}`} />
          </div>
          <h3 className="mb-2 mt-6 text-[13px] font-semibold">Per plan</h3>
          <Table label="Economics per plan" head={["Plan", "Subscribers", "Net revenue", "Fees", "Cost", "Profit", "Margin", "Below target"]} minWidth={720}>
            {r.plans.map((p) => (
              <tr key={p.plan}>
                <td className="font-medium">{p.plan}</td>
                <td className="tabular">{p.subscribers}</td>
                <td className="tabular">{inr(p.revenueMinor)}</td>
                <td className="tabular">{inr(p.feeMinor)}</td>
                <td className="tabular">{inr(p.costMinor)}</td>
                <td className="tabular">{inr(p.profitMinor)}</td>
                <td><MarginBadge margin={p.margin} target={r.target} /></td>
                <td className="tabular">{p.belowTarget}</td>
              </tr>
            ))}
          </Table>
          <h3 className="mb-2 mt-6 text-[13px] font-semibold">Per subscriber</h3>
          <Table label="Economics per subscriber" head={["Email", "Plan", "Tier", "Net revenue", "Fees", "Cost", "Budget", "Profit", "Margin"]} minWidth={860}>
            {r.rows.map((x) => (
              <tr key={x.userId}>
                <td className="min-w-0 break-words">{x.email ?? "Deleted account"}</td>
                <td>{x.plan}</td>
                <td>{TIER_LABEL[x.tier] ?? (x.tier || "n/a")}</td>
                <td className="tabular">{inr(x.revenueMinor)}</td>
                <td className="tabular">{inr(x.feeMinor)}</td>
                <td className="tabular">{inr(x.costMinor)}{x.overBudget && <Pill tone="warn" className="ml-1.5">over budget</Pill>}</td>
                <td className="tabular">{x.budgetMinor ? inr(x.budgetMinor) : "None"}</td>
                <td className="tabular">{inr(x.profitMinor)}</td>
                <td><MarginBadge margin={x.margin} target={r.target} /></td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Card>
  );
}
