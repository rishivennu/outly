import { requireAdmin } from "@/lib/admin/guard";
import { overview } from "@/lib/admin/metrics";
import { can } from "@/lib/admin/perms";
import { formatMoney } from "@/lib/billing/money";
import { Card, PageHead } from "@/components/admin/ui";
import { OverviewCharts } from "@/components/admin/OverviewCharts";
import { SampleData } from "@/components/admin/SampleData";
import { AdminKpi as Kpi } from "@/components/admin/motion/AdminKpi";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { Greeting } from "@/components/shared/Greeting";
import { LiveGlobeCard } from "@/components/admin/live/LiveGlobeCard";
import { liveMap } from "@/lib/admin/live-map";
import { LIVE_DEFAULT_MIN } from "@/lib/live-map-core";

export const metadata = { title: "Overview" };

function delta(now: number, prev: number) {
  if (!prev) return now ? null : 0;
  return (now - prev) / prev;
}

export default async function Overview(props: { searchParams: Promise<{ denied?: string }> }) {
  const searchParams = await props.searchParams;
  const admin = await requireAdmin("overview");
  // Live globe (1062): people and places are Users-area data, so only roles that can open Users see it.
  const showLive = can(admin.role, "users");
  const [o, live] = await Promise.all([overview(90), showLive ? liveMap(LIVE_DEFAULT_MIN).catch(() => null) : Promise.resolve(null)]);
  const k = o.kpi;
  const money = can(admin.role, "payments");
  const empty = k.totalUsers < 3 && !o.sample;
  // Trend lines (1081): the last 30 days of the matching daily series. Cards with no daily series get none.
  const last = o.series.slice(-30);
  const sp = (f: (r: (typeof last)[number]) => number) => last.map(f);
  let n = 0;
  const at = () => n++;
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
      <EnterRoot className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi i={at()} spark={sp((r) => r.active)} label="Active today" value={String(k.dau)} sub={`${k.wau} this week · ${k.mau} this month`} />
        <Kpi i={at()} spark={sp((r) => r.users)} label="Total users" value={k.totalUsers.toLocaleString("en-IN")} change={delta(k.signups30, k.signupsPrev)} sub={`+${k.signups30} in 30 days`} />
        {money ? (
          <>
            <Kpi i={at()} spark={sp((r) => r.activeSubs)} label="Monthly recurring revenue" value={formatMoney(k.mrr, o.currency, { compact: true })} sub={`${k.activeSubs} paying`} />
            <Kpi i={at()} spark={sp((r) => r.revenue)} label="Revenue, 30 days" value={formatMoney(k.rev30, o.currency, { compact: true })} change={delta(k.rev30, k.revPrev)} />
            <Kpi i={at()} spark={sp((r) => r.cancels)} invert label="Churn, 30 days" value={`${(k.churn * 100).toFixed(1)}%`} sub="subscriptions cancelled" tone={k.churn > 0.08 ? "bad" : undefined} />
            <Kpi i={at()} label="Failed payments, 7 days" value={String(k.failed7)} sub="customers were told why" tone={k.failed7 > 0 ? "bad" : undefined} />
          </>
        ) : null}
        {can(admin.role, "tickets") && (
          <>
            <Kpi i={at()} label="Open tickets" value={String(k.openTickets)} sub={k.urgentTickets ? `${k.urgentTickets} urgent` : "none urgent"} tone={k.urgentTickets ? "bad" : undefined} />
            <Kpi i={at()} spark={sp((r) => r.activeSubs)} label="Active subscriptions" value={String(k.activeSubs)} />
          </>
        )}
      </EnterRoot>
      {live && <LiveGlobeCard initial={live} />}
      <OverviewCharts series={o.series} revenueByPlan={money ? o.revenueByPlan : []} currency={o.currency} showMoney={money} />
    </>
  );
}
