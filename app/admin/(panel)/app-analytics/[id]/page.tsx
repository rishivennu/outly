import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate, ago } from "@/components/admin/ui";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { StatusPill, fmtDur, n } from "@/components/admin/app-analytics/parts";
import { userDetail } from "@/lib/admin/app-analytics";
import { PLATFORM_LABEL, isPlatform } from "@/lib/analytics/activity-core";

export const metadata = { title: "User activity" };
export const dynamic = "force-dynamic";

const plat = (p: string) => (isPlatform(p) ? PLATFORM_LABEL[p] : p);

/** R1308: one person's activity history: sessions, platforms, features and the raw event list (no personal data in events). */
export default async function AppAnalyticsUserPage(props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("appAnalytics");
  const { id } = await props.params;
  const d = await userDetail(id, admin.role);
  if (!d) notFound();
  const u = d.user;
  const facts: [string, ReactNode][] = [
    ["Registered", fmtDate(u.createdAt, true)],
    ["Last active", u.lastActiveAt ? `${ago(u.lastActiveAt)} (${fmtDate(u.lastActiveAt, true)})` : "never"],
    ["Last sign-in", u.lastLoginAt ? fmtDate(u.lastLoginAt, true) : "before tracking"],
    ["Latest platform", u.platform ? PLATFORM_LABEL[u.platform] : "not seen yet"],
    ["Device", u.device ?? ""],
    ["App version", u.version ?? ""],
    ["Time zone", u.timezone],
    ["Country", u.country ?? "unknown"],
  ];
  return (
    <>
      <Link href="/admin/app-analytics?tab=users" className="mb-3 inline-flex min-h-[44px] items-center gap-1 rounded-full pr-3 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">
        <ArrowLeft className="h-4 w-4" aria-hidden /> App Analytics
      </Link>
      <PageHead eyebrow="User activity" title={u.name} body={u.email} actions={<StatusPill status={u.status} />} />
      <EnterRoot>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          {[
            ["Sessions", n(d.totals.sessions)],
            ["Events", n(d.totals.events)],
            ["Active days (90d)", n(d.totals.activeDays)],
            ["First event", d.totals.firstEventAt ? fmtDate(d.totals.firstEventAt) : "none yet"],
          ].map(([label, value]) => (
            <Card key={label} data-enter as="div" className="p-5">
              <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
              <p className="mt-2 font-display text-[1.6rem] font-bold leading-none tabular-nums">{value}</p>
            </Card>
          ))}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
          <Card data-enter as="div">
            <CardTitle>About</CardTitle>
            <dl className="flex flex-col gap-2 text-[13px]">
              {facts.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {d.days.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-[13px] font-semibold">Active days, last 90</h3>
                <ol className="flex flex-wrap gap-1" aria-label="Active days">
                  {d.days.map((day) => <li key={day}><Pill tone="lime">{fmtDate(day)}</Pill></li>)}
                </ol>
              </>
            )}
          </Card>
          <Card data-enter as="div">
            <CardTitle hint="Sessions and total time per platform, since this release.">Platform usage</CardTitle>
            {d.platforms.length === 0 ? <Empty title="No sessions yet" body="Sessions are recorded from this release on." /> : (
              <Table label="Platform usage" head={["Platform", "Sessions", "Time"]} align={[undefined, "right", "right"]}>
                {d.platforms.map((p) => <tr key={p.platform}><td className="font-medium">{p.label}</td><td>{n(p.sessions)}</td><td>{fmtDur(p.durationS)}</td></tr>)}
              </Table>
            )}
          </Card>
          <Card data-enter as="div">
            <CardTitle hint="How often each feature was used, all time, and when last.">Features</CardTitle>
            {d.features.length === 0 ? <Empty title="No feature use yet" body="Appears once they create, upload, schedule or connect." /> : (
              <Table label="Features" head={["Feature", "Times", "Last"]} align={[undefined, "right", undefined]}>
                {d.features.map((f) => <tr key={f.key}><td className="font-medium">{f.label}</td><td>{n(f.count)}</td><td>{f.lastAt ? ago(f.lastAt) : ""}</td></tr>)}
              </Table>
            )}
          </Card>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <Card data-enter as="div">
            <CardTitle hint="Most recent first. A session ends at sign-out or after 30 quiet minutes.">Sessions</CardTitle>
            {d.sessions.length === 0 ? <Empty title="No sessions yet" /> : (
              <Table label="Sessions" head={["Started", "Length", "Platform", "Device", "Events"]} align={[undefined, "right", undefined, undefined, "right"]}>
                {d.sessions.map((s) => (
                  <tr key={s.startedAt}>
                    <td title={fmtDate(s.startedAt, true)}>{ago(s.startedAt)}</td>
                    <td>{fmtDur(s.durationS)}</td>
                    <td>{plat(s.platform)}</td>
                    <td className="capitalize">{[s.device, s.os, s.browser, s.version].filter(Boolean).join(" · ")}</td>
                    <td>{n(s.events)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card data-enter as="div">
            <CardTitle hint="The last 200 recorded actions. Only the action, its time, platform and a small tag (section, format, platform) are stored.">Activity history</CardTitle>
            {d.events.length === 0 ? <Empty title="No events yet" body="Events are recorded from this release on." /> : (
              <ol className="flex max-h-[520px] flex-col divide-y divide-border/60 overflow-y-auto text-[13px]" aria-label="Activity history">
                {d.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="w-[150px] shrink-0 text-[12px] text-muted-foreground tabular-nums">{fmtDate(e.at, true)}</span>
                    <span className="min-w-0 flex-1 font-medium">{e.label}{e.meta && <span className="ml-2 font-normal text-muted-foreground">{Object.entries(e.meta).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>}</span>
                    <Pill tone="muted">{plat(e.platform)}</Pill>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </EnterRoot>
    </>
  );
}
