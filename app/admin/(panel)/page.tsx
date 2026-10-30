import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { overview } from "@/lib/admin/metrics";
import { can } from "@/lib/admin/perms";
import { formatMoney } from "@/lib/billing/money";
import { Card, PageHead } from "@/components/admin/ui";
import { OverviewCharts } from "@/components/admin/OverviewCharts";
import { SampleData } from "@/components/admin/SampleData";
import { cn } from "@/lib/utils";
import { Greeting } from "@/components/shared/Greeting";
import { LiveGlobeCard } from "@/components/admin/live/LiveGlobeCard";
import { liveMap } from "@/lib/admin/live-map";
import { LIVE_DEFAULT_MIN } from "@/lib/live-map-core";

export const metadata = { title: "Overview" };

function delta(now: number, prev: number) {
  if (!prev) return now ? null : 0;
  return (now - prev) / prev;
}

function Kpi({ label, value, sub, change, invert, tone }: { label: string; value: string; sub?: string; change?: number | null; invert?: boolean; tone?: "bad" }) {
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <Card as="div" className="kpi-card p-5">
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-display text-[1.85rem] font-bold leading-none tracking-[-0.03em] tabular", tone === "bad" && "text-destructive")}>{value}</p>
      <div className="mt-2.5 flex items-center gap-2 text-[12px]">
        {change !== undefined && change !== null && change !== 0 && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
            {up ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}
            {Math.abs(change * 100).toFixed(0)}%<span className="sr-only">{up ? " up" : " down"} on the previous 30 days</span>
          </span>
        )}
        {sub && <span className="text-muted-foreground">{sub}</span>}
      </div>
    </Card>
  );
}

export default async function Overview({ searchParams }: { searchParams: { denied?: string } }) {
  const admin = await requireAdmin("overview");
  // Live globe (1062): people and places are Users-area data, so only roles that can open Users see it.
  const showLive = can(admin.role, "users");
  const [o, live] = await Promise.all([overview(90), showLive ? liveMap(LIVE_DEFAULT_MIN).catch(() => null) : Promise.resolve(null)]);
  const k = o.kpi;
  const money = can(admin.role, "payments");
  const empty = k.totalUsers < 3 && !o.sample;
  return (
    <>
      <PageHead
        greet={<Greeting name={admin.name.split(" ")[0]} />}
        title="How Outlly is doing"
        body={o.sample ? "Showing sample data mixed with real data. Clear it from here before you share numbers." : "Live numbers from the database. Active means a user opened the studio that day."}
        actions={admin.role === "super" ? <SampleData hasSample={o.sample} /> : undefined}
      />
      {searchParams.denied && (
        <p role="status" className="mb-5 rounded-2xl bg-secondary px-4 py-3 text-[13.5px]">
          Your role doesn't include <b>{searchParams.denied}</b>. A super admin can change that under Team & roles.
        </p>
      )}
      {empty && admin.role === "super" && (
        <Card className="mb-5 border-dashed bg-lime/[0.05]">
          <p className="text-[14px]"><b>Not much data yet.</b> Load sample data to see the charts filled in. It's flagged, never emailed, and clears with one click.</p>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active today" value={String(k.dau)} sub={`${k.wau} this week · ${k.mau} this month`} />
        <Kpi label="Total users" value={k.totalUsers.toLocaleString("en-IN")} change={delta(k.signups30, k.signupsPrev)} sub={`+${k.signups30} in 30 days`} />
        {money ? (
          <>
            <Kpi label="Monthly recurring revenue" value={formatMoney(k.mrr, o.currency, { compact: true })} sub={`${k.activeSubs} paying`} />
            <Kpi label="Revenue, 30 days" value={formatMoney(k.rev30, o.currency, { compact: true })} change={delta(k.rev30, k.revPrev)} />
            <Kpi label="Churn, 30 days" value={`${(k.churn * 100).toFixed(1)}%`} sub="subscriptions cancelled" tone={k.churn > 0.08 ? "bad" : undefined} />
            <Kpi label="Failed payments, 7 days" value={String(k.failed7)} sub="customers were told why" tone={k.failed7 > 0 ? "bad" : undefined} />
          </>
        ) : null}
        {can(admin.role, "tickets") && (
          <>
            <Kpi label="Open tickets" value={String(k.openTickets)} sub={k.urgentTickets ? `${k.urgentTickets} urgent` : "none urgent"} tone={k.urgentTickets ? "bad" : undefined} />
            <Kpi label="Active subscriptions" value={String(k.activeSubs)} />
          </>
        )}
      </div>
      {live && <LiveGlobeCard initial={live} />}
      <OverviewCharts series={o.series} revenueByPlan={money ? o.revenueByPlan : []} currency={o.currency} showMoney={money} />
    </>
  );
}
