import { requireAdmin } from "@/lib/admin/guard";
import { overview } from "@/lib/admin/metrics";
import { can } from "@/lib/admin/perms";
import { formatMoney } from "@/lib/billing/money";
import { Card, PageHead, Unavailable } from "@/components/admin/ui";
import { OverviewCharts } from "@/components/admin/OverviewCharts";
import { ActiveDaysCard } from "@/components/admin/ActiveDaysCard";
import { SampleData } from "@/components/admin/SampleData";
import { AdminKpi as Kpi } from "@/components/admin/motion/AdminKpi";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { Greeting } from "@/components/shared/Greeting";
import { LiveGlobeCard } from "@/components/admin/live/LiveGlobeCard";
import { liveMap } from "@/lib/admin/live-map";
import { LIVE_DEFAULT_MIN } from "@/lib/live-map-core";
import { todayBlog } from "@/lib/blog/posts";
import { blogReady } from "@/lib/blog/llm";
import { TodayBlogCard } from "@/components/admin/blog/TodayBlogCard";

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
  // Morning card (1175): "Your Today's Blog Is Ready!" for roles that can open Content Studio.
  const showBlog = can(admin.role, "content");
  const [o, live, blog] = await Promise.all([overview(90), showLive ? liveMap(LIVE_DEFAULT_MIN, Date.now(), admin.role).catch(() => null) : Promise.resolve(null), showBlog ? todayBlog() : Promise.resolve(null)]);
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
        body={`${o.sample ? "Showing sample data mixed with real data. Clear it here before you share numbers. " : ""}Last updated ${new Date(o.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC. The globe refreshes itself.`}
        actions={admin.role === "super" ? <SampleData hasSample={o.sample} /> : undefined}
      />
      {searchParams.denied && (
        <p role="status" className="mb-5 rounded-2xl bg-secondary px-4 py-3 text-[13.5px]">
          Your role doesn't include <b>{searchParams.denied}</b>. A super admin can change that under Team & roles.
        </p>
      )}
      {blog && (blog.post || blog.job?.status === "running") && (
        <div className="mb-5">
          <TodayBlogCard post={blog.post} job={blog.job} ready={blogReady()} compact />
        </div>
      )}
      {empty && admin.role === "super" && (
        <Card className="mb-5 border-dashed bg-lime/[0.05]">
          <p className="text-[14px]"><b>Not much data yet.</b> Load sample data to see the charts filled in. It's flagged, never emailed, and clears with one click.</p>
        </Card>
      )}
      <EnterRoot className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2 lg:grid-cols-4">
        <Kpi i={at()} spark={sp((r) => r.active)} label="Active today" value={String(k.dau)} change={delta(k.dau, k.dauPrev)} compare="all of yesterday" sub={`${k.wau} this week · ${k.mau} this month`} hint="Distinct users who opened the studio since midnight UTC. Today is still filling in, so the comparison is with the whole of yesterday. This week and this month count the last 7 and 30 days the same way." />
        <Kpi i={at()} spark={sp((r) => r.users)} label="Total users" value={k.totalUsers.toLocaleString("en-IN")} change={delta(k.signups30, k.signupsPrev)} compare="the 30 days before" sub={`+${k.signups30} in 30 days`} hint="Every account in the database. The change compares sign-ups in the last 30 days with the 30 days before that." />
        {money ? (
          <>
            <Kpi i={at()} spark={sp((r) => r.activeSubs)} label="Monthly recurring revenue" value={formatMoney(k.mrr, o.currency, { compact: true })} change={delta(k.mrr, k.mrrPrev)} compare="30 days ago" sub={`${k.activeSubs} paying`} hint={`Sum of active subscription prices, with yearly plans divided by 12 and everything converted to ${o.currency}. Trials and cancelled plans are not included. The comparison uses the subscriptions that were live 30 days ago, whatever their payment state was then.`} />
            <Kpi i={at()} spark={sp((r) => r.revenue)} label="Revenue, 30 days" value={formatMoney(k.rev30, o.currency, { compact: true })} change={delta(k.rev30, k.revPrev)} compare="the 30 days before" hint="Successful payments received in the last 30 days, compared with the 30 days before that. Refunds are not subtracted." />
            <Kpi i={at()} spark={sp((r) => r.cancels)} invert label="Churn, 30 days" value={`${(k.churn * 100).toFixed(1)}%`} change={k.churnPrev === null || (k.churnPrev === 0 && k.churn > 0) ? null : delta(k.churn, k.churnPrev)} compare="the 30 days before" compareNote={k.churnPrev === null ? "No subscriptions were live in the 30 days before" : "Nothing was cancelled in the 30 days before"} sub={`${k.canceled30} of ${k.churnBase} subscriptions cancelled`} tone={k.churn > 0.08 ? "bad" : undefined} unavailable={k.churnBase ? undefined : "No paid subscriptions were live in the last 30 days, so there is no rate to show."} hint="Subscriptions cancelled in the last 30 days, divided by every subscription that was live at any point in those 30 days (active at the start, or started since). Small bases swing a lot: read the count beneath." />
            <Kpi i={at()} invert label="Failed payments, 7 days" value={String(k.failed7)} change={delta(k.failed7, k.failedPrev7)} compare="the 7 days before" sub={k.failed7 ? "customers were told why" : undefined} tone={k.failed7 > 0 ? "bad" : undefined} hint="Payment attempts the provider reported as failed in the last 7 days, compared with the 7 days before that. One customer can appear more than once if several attempts failed." />
            <Kpi i={at()} spark={sp((r) => r.activeSubs)} label="Active subscriptions" value={String(k.activeSubs)} change={delta(k.activeSubs, k.activeSubsPrev)} compare="30 days ago" hint="Paid subscriptions that are active right now, compared with those live 30 days ago. Free plans and trials are not counted." />
          </>
        ) : null}
        {can(admin.role, "tickets") && (
          <Kpi i={at()} label="Open tickets" value={String(k.openTickets)} sub={k.urgentTickets ? `${k.urgentTickets} urgent` : "none urgent"} tone={k.urgentTickets ? "bad" : undefined} hint="Support tickets not yet marked resolved, whatever their age. A count of right now, so there is no earlier period to compare with." />
        )}
      </EnterRoot>
      {live && <LiveGlobeCard initial={live} />}
      {showLive && !live && (
        <Card className="mt-6">
          <Unavailable reason="The live view could not be loaded just now. The numbers above are unaffected; reload to try again." />
        </Card>
      )}
      <ActiveDaysCard days={o.series.map((r) => ({ date: r.day, value: r.active }))} />
      <OverviewCharts series={o.series} revenueByPlan={money ? o.revenueByPlan : []} currency={o.currency} showMoney={money} />
    </>
  );
}
