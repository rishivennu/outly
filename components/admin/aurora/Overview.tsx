import Link from "next/link";
import { CreditCard, LifeBuoy, Users } from "lucide-react";
import { can, type AdminRole } from "@/lib/admin/perms";
import type { overview } from "@/lib/admin/metrics";
import type { todayBlog } from "@/lib/blog/posts";
import type { LiveMap } from "@/lib/live-map-core";
import { formatMoney } from "@/lib/billing/money";
import { blogReady } from "@/lib/blog/llm";
import { cn } from "@/lib/utils";
import { Unavailable } from "@/components/admin/ui";
import { OverviewCharts } from "@/components/admin/OverviewCharts";
import { ActiveDaysCard } from "@/components/admin/ActiveDaysCard";
import { SampleData } from "@/components/admin/SampleData";
import { LiveGlobeCard } from "@/components/admin/live/LiveGlobeCard";
import { TodayBlogCard } from "@/components/admin/blog/TodayBlogCard";
import { Greeting } from "@/components/shared/Greeting";
import { AuroraStage } from "./Stage";
import { AuroraKpi, type KpiProps } from "./AuroraKpi";
import { Highlights, MoreNumbers } from "./Highlights";

function delta(now: number, prev: number) {
  if (!prev) return now ? null : 0;
  return (now - prev) / prev;
}

const STAT_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

/** The classic KPI set, same order, wording and gates as app/admin/(panel)/page.tsx. */
function kpis(o: Awaited<ReturnType<typeof overview>>, role: AdminRole): KpiProps[] {
  const k = o.kpi;
  const last = o.series.slice(-30);
  const sp = (f: (r: (typeof last)[number]) => number) => last.map(f);
  const out: KpiProps[] = [
    { spark: sp((r) => r.active), label: "Active today", value: String(k.dau), change: delta(k.dau, k.dauPrev), compare: "all of yesterday", sub: `${k.wau} this week · ${k.mau} this month`, hint: "Distinct users who opened the studio since midnight UTC. Today is still filling in, so the comparison is with the whole of yesterday. This week and this month count the last 7 and 30 days the same way." },
    { spark: sp((r) => r.users), label: "Total users", value: k.totalUsers.toLocaleString("en-IN"), change: delta(k.signups30, k.signupsPrev), compare: "the 30 days before", sub: `+${k.signups30} in 30 days`, hint: "Every account in the database. The change compares sign-ups in the last 30 days with the 30 days before that." },
  ];
  if (can(role, "payments")) {
    out.push(
      { spark: sp((r) => r.activeSubs), label: "Monthly recurring revenue", value: formatMoney(k.mrr, o.currency, { compact: true }), change: delta(k.mrr, k.mrrPrev), compare: "30 days ago", sub: `${k.activeSubs} paying`, hint: `Sum of active subscription prices, with yearly plans divided by 12 and everything converted to ${o.currency}. Trials and cancelled plans are not included. The comparison uses the subscriptions that were live 30 days ago, whatever their payment state was then.` },
      { spark: sp((r) => r.revenue), label: "Revenue, 30 days", value: formatMoney(k.rev30, o.currency, { compact: true }), change: delta(k.rev30, k.revPrev), compare: "the 30 days before", hint: "Successful payments received in the last 30 days, compared with the 30 days before that. Refunds are not subtracted." },
      {
        spark: sp((r) => r.cancels),
        invert: true,
        label: "Churn, 30 days",
        value: `${(k.churn * 100).toFixed(1)}%`,
        change: k.churnPrev === null || (k.churnPrev === 0 && k.churn > 0) ? null : delta(k.churn, k.churnPrev),
        compare: "the 30 days before",
        compareNote: k.churnPrev === null ? "No subscriptions were live in the 30 days before" : "Nothing was cancelled in the 30 days before",
        sub: `${k.canceled30} of ${k.churnBase} subscriptions cancelled`,
        tone: k.churn > 0.08 ? "bad" : undefined,
        unavailable: k.churnBase ? undefined : "No paid subscriptions were live in the last 30 days, so there is no rate to show.",
        hint: "Subscriptions cancelled in the last 30 days, divided by every subscription that was live at any point in those 30 days (active at the start, or started since). Small bases swing a lot: read the count beneath.",
      },
      { invert: true, label: "Failed payments, 7 days", value: String(k.failed7), change: delta(k.failed7, k.failedPrev7), compare: "the 7 days before", sub: k.failed7 ? "customers were told why" : undefined, tone: k.failed7 > 0 ? "bad" : undefined, hint: "Payment attempts the provider reported as failed in the last 7 days, compared with the 7 days before that. One customer can appear more than once if several attempts failed." },
      { spark: sp((r) => r.activeSubs), label: "Active subscriptions", value: String(k.activeSubs), change: delta(k.activeSubs, k.activeSubsPrev), compare: "30 days ago", hint: "Paid subscriptions that are active right now, compared with those live 30 days ago. Free plans and trials are not counted." },
    );
  }
  if (can(role, "tickets")) {
    out.push({ label: "Open tickets", value: String(k.openTickets), sub: k.urgentTickets ? `${k.urgentTickets} urgent` : "none urgent", tone: k.urgentTickets ? "bad" : undefined, hint: "Support tickets not yet marked resolved, whatever their age. A count of right now, so there is no earlier period to compare with." });
  }
  return out;
}

const chip = "au-chip inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuroraOverview({ admin, o, live, blog, denied }: { admin: { name: string; role: AdminRole }; o: Awaited<ReturnType<typeof overview>>; live: LiveMap | null; blog: Awaited<ReturnType<typeof todayBlog>> | null; denied?: string }) {
  const role = admin.role;
  const money = can(role, "payments");
  const showLive = can(role, "users");
  const all = kpis(o, role);
  const stats = all.slice(0, 4);
  const more = all.slice(4);
  const updated = new Date(o.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const links = [
    can(role, "users") && { href: "/admin/users", label: "Users", icon: Users },
    money && { href: "/admin/payments", label: "Payments", icon: CreditCard },
    can(role, "tickets") && { href: "/admin/tickets", label: "Tickets", icon: LifeBuoy },
  ].filter((l): l is { href: string; label: string; icon: typeof Users } => !!l);

  return (
    <AuroraStage className="grid gap-5">
      <section data-aurora="card" aria-labelledby="au-hero-title" className="admin-card au-hero relative overflow-hidden rounded-[28px] bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-muted-foreground">
              <Greeting name={admin.name.split(" ")[0]} />
            </div>
            <h1 id="au-hero-title" className="mt-1.5 font-display text-[28px] font-[650] leading-[1.1] tracking-[-0.02em] sm:text-[34px]">
              How Outlly is doing
            </h1>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-normal text-muted-foreground">
              {o.sample ? "Showing sample data mixed with real data. Clear it here before you share numbers. " : ""}
              Last updated {updated} UTC.{showLive ? " The globe refreshes itself." : ""}
            </p>
          </div>
          {(role === "super" || links.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {role === "super" && <SampleData hasSample={o.sample} />}
              {links.length > 0 && (
                <nav aria-label="Quick links" className="flex flex-wrap gap-2">
                  {links.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={chip} aria-label={`Open ${label}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                      {label}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
          )}
        </div>
        {denied && (
          <p role="status" className="mt-5 rounded-2xl bg-secondary px-4 py-3 text-[13.5px]">
            Your role doesn't include <b>{denied}</b>. A super admin can change that under Team & roles.
          </p>
        )}
      </section>

      <div className={cn("grid grid-cols-1 gap-4 min-[440px]:grid-cols-2", STAT_COLS[stats.length] ?? "lg:grid-cols-4")}>
        {stats.map((kpi) => (
          <AuroraKpi key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="grid min-w-0 gap-5 lg:col-span-8 [&>*]:mt-0">
          <div className="min-w-0 [&>*]:mt-0">
            <OverviewCharts series={o.series} revenueByPlan={money ? o.revenueByPlan : []} currency={o.currency} showMoney={money} />
          </div>
          {live && (
            <div data-aurora="card" className="min-w-0 [&>*]:mt-0">
              <LiveGlobeCard initial={live} />
            </div>
          )}
          {showLive && !live && (
            <section data-aurora="card" aria-label="Live view" className="admin-card rounded-[24px] bg-card p-5 sm:p-6">
              <Unavailable reason="The live view could not be loaded just now. The numbers above are unaffected; reload to try again." />
            </section>
          )}
          <div data-aurora="card" className="min-w-0 [&>*]:mt-0">
            <ActiveDaysCard days={o.series.map((r) => ({ date: r.day, value: r.active }))} />
          </div>
        </div>

        <aside aria-label="Highlights" className="au-side grid min-w-0 gap-5 lg:col-span-4">
          <Highlights k={o.kpi} role={role} sample={o.sample} />
          <MoreNumbers kpis={more} />
          {blog && (blog.post || blog.job?.status === "running") && (
            <div data-aurora="card" className="min-w-0">
              <TodayBlogCard post={blog.post} job={blog.job} ready={blogReady()} compact />
            </div>
          )}
        </aside>
      </div>
    </AuroraStage>
  );
}
