import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { Card, CardTitle, Empty, Hint, PageHead, Pill, Section, Table, fmtDate, ago } from "@/components/admin/ui";
import { ReportMeta } from "@/components/admin/FilterBar";
import { FilterSelect, SearchBox } from "@/components/admin/SearchBox";
import { SeriesChart } from "@/components/admin/SeriesChart";
import { Pagination } from "@/components/admin/Pagination";
import { readPaging } from "@/components/admin/page-window";
import { DataSwap } from "@/components/shared/DataSwap";
import { EnterRoot } from "@/components/admin/motion/EnterRoot";
import { RangeControls } from "@/components/admin/app-analytics/RangeControls";
import { LivePanel } from "@/components/admin/app-analytics/LivePanel";
import { TabBar } from "@/components/admin/app-analytics/TabBar";
import { BreakdownCard, CohortGrid, ExportLinks, KpiGrid, RetentionCards, StatusPill, fmtDur, n, pct } from "@/components/admin/app-analytics/parts";
import { DEFINITIONS, PLATFORM_LABEL, parseRange } from "@/lib/analytics/activity-core";
import { USER_JOINED, USER_PLATFORMS, USER_SORTS, USER_STATUS, activeSeries, engagement, live, overview, parseQuery, parseUserFilters, platforms, retention, usersPage } from "@/lib/admin/app-analytics";

export const metadata = { title: "App Analytics" };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "installs", label: "Downloads & installs", short: "Installs" },
  { key: "active", label: "Active users", short: "Active" },
  { key: "engagement", label: "Engagement" },
  { key: "retention", label: "Retention" },
  { key: "platforms", label: "Platforms & devices", short: "Platforms" },
  { key: "users", label: "User activity", short: "Users" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const tabOf = (v: string | undefined): TabKey => (TABS.some((t) => t.key === v) ? (v as TabKey) : "overview");

const PLATFORM_OPTIONS = [{ value: "", label: "All platforms" }, { value: "web", label: PLATFORM_LABEL.web }, { value: "pwa", label: PLATFORM_LABEL.pwa }, { value: "android", label: PLATFORM_LABEL.android }, { value: "ios", label: PLATFORM_LABEL.ios }];
const LIME = "hsl(var(--lime))", INK = "hsl(var(--lime-ink))", ACCENT = "hsl(var(--accent))", MUTED = "hsl(var(--muted-foreground) / 0.5)";

export default async function AppAnalyticsPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const admin = await requireAdmin("appAnalytics");
  const now = new Date();
  const range = parseRange({ r: str(sp.r), from: str(sp.from), to: str(sp.to) }, now);
  const q = parseQuery(sp, range);
  const cmpRange = str(sp.cf) && str(sp.ct) ? parseRange({ from: str(sp.cf), to: str(sp.ct) }, now) : null;
  const uf = parseUserFilters({ ...sp, platform: sp.up }, readPaging(sp));
  const tab = tabOf(str(sp.tab));
  const on = (...keys: TabKey[]) => keys.includes(tab);
  // One group at a time: only its queries run (overview always, for the header meta and the tracking start).
  const [ov, series, eng, ret, plat, users, lv, cmp] = await Promise.all([
    overview(q, now),
    on("active") ? activeSeries(q) : null,
    on("engagement") ? engagement(q) : null,
    on("retention") ? retention(q, now) : null,
    on("platforms", "installs") ? platforms(q) : null,
    on("users") ? usersPage(uf, admin.role, now) : null,
    on("overview") ? live(admin.role, now) : null,
    on("overview") && cmpRange ? overview({ ...q, range: cmpRange }, now) : null,
  ]);
  const compareText = range.days === 1 ? "the day before" : `the previous ${range.days} days`;
  const since = ov.trackingSince ? new Date(ov.trackingSince) : null;
  const tracked = (eng?.tracked ?? false) || (plat?.tracked ?? false);
  const base = `/api/admin/app-analytics?r=${range.key}&from=${range.from}&to=${range.to}&g=${q.g}&platform=${q.platform === "all" ? "" : q.platform}`;
  const noEvents = { title: "No events yet", body: since ? `Event tracking started ${fmtDate(since)}; nothing in this range.` : "Event tracking starts with this release. Numbers appear as people use Outlly." };
  const narrowing = [uf.q, uf.platform, uf.status, uf.joined].filter(Boolean).length;
  const panel = (key: TabKey) => ({ id: `panel-${key}`, role: "tabpanel", "aria-labelledby": `tab-${key}` } as const);
  const userKey = [uf.q, uf.platform, uf.status, uf.joined, uf.sort, uf.page].join("|");
  const kpiKey = `${range.from}|${range.to}|${q.platform}|${q.g}`;

  return (
    <>
      <PageHead eyebrow="Insights" title="App Analytics" body="Installs, who is active, what they use and whether they come back, across web, installed web app and Android." />

      <TabBar tabs={TABS} current={tab} />

      <Card className="mb-5">
        <RangeControls
          range={range}
          g={q.g}
          compare={cmpRange ? { from: cmpRange.from, to: cmpRange.to } : null}
          trailing={<FilterSelect inline param="platform" label="Platform" current={q.platform === "all" ? "" : q.platform} options={PLATFORM_OPTIONS} />}
          meta={<ReportMeta source={since ? `Tracking since ${fmtDate(since)}` : "Event tracking starts with this release"} range={range.label} updatedAt={ov.now} />}
        />
        {q.platform !== "all" && <p className="mt-3 text-[12.5px] text-muted-foreground">Platform views use event data, which exists from this release on; all-platform history also uses the older daily activity log.</p>}
      </Card>

      <EnterRoot>
        {/* 1. Overview */}
        {tab === "overview" && lv && (
          <div {...panel("overview")}>
          <Section id="overview" className="mt-0" title="Overview" hint={`Each change compares against ${compareText}. Hover the "i" on a card for how it is counted.`} actions={<ExportLinks base={base} kinds={[{ kind: "daily", label: "Daily series" }]} />}>
            <DataSwap k={kpiKey}>
              <KpiGrid kpis={ov.kpis} compare={compareText} />
            </DataSwap>
            {cmp && (
              <Card data-enter className="mt-4">
                <CardTitle hint="The same numbers for both ranges, side by side. DAU, WAU and MAU are taken on the last day of each range.">Comparison</CardTitle>
                <Table label="Range comparison" head={["Metric", range.label, cmp.range.label, "Change"]} align={[undefined, "right", "right", "right"]}>
                  {ov.kpis.filter((k) => !k.unavailable && k.key !== "online").map((k) => {
                    const b = cmp.kpis.find((x) => x.key === k.key);
                    const d = b && b.value > 0 ? (k.value - b.value) / b.value : null;
                    return (
                      <tr key={k.key}>
                        <td className="font-medium">{k.label}</td>
                        <td>{n(k.value)}</td>
                        <td>{b ? n(b.value) : ""}</td>
                        <td className={d === null ? "text-muted-foreground" : d >= 0 ? "text-[hsl(var(--lime-ink))]" : "text-destructive"}>{d === null ? "n/a" : `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`}</td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            )}
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
              <LivePanel initial={lv} />
              <Card data-enter as="div">
                <CardTitle hint="Printed here so the numbers and the words never drift apart.">How things are counted</CardTitle>
                <dl className="flex flex-col gap-2.5 text-[13px]">
                  {DEFINITIONS.map((d) => (
                    <div key={d.key}>
                      <dt className="font-semibold">{d.label}</dt>
                      <dd className="text-muted-foreground">{d.rule}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-border/60 pt-3 text-[12.5px] text-muted-foreground">Dates are UTC days. Heartbeats and background jobs (publishing, sweeps) never count as activity. Sample accounts are left out everywhere.</p>
              </Card>
            </div>
          </Section>
          </div>
        )}

        {/* 2. Downloads & installs */}
        {tab === "installs" && plat && (
          <div {...panel("installs")}>
          <Section id="installs" className="mt-0" title="Downloads & installs" hint="A download is not an install. Installs are confirmed signals only.">
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] [&>*]:min-w-0">
              <Card data-enter as="div">
                <CardTitle hint={DEFINITIONS.find((d) => d.key === "download")?.rule}>Downloads</CardTitle>
                <Empty title="No download source yet" body={ov.downloads.reason} />
                <p className="mt-3 text-[12.5px] text-muted-foreground">Once the Play listing is live, store downloads can be read from the Play Console export; until then this card stays honest and empty.</p>
              </Card>
              <Card data-enter as="div">
                <CardTitle hint={DEFINITIONS.find((d) => d.key === "install")?.rule}>Installs</CardTitle>
                <Table label="Installs by platform" head={["Platform", "Installed now", `New in range`, "Change", "Uninstalled"]} align={[undefined, "right", "right", "right", "right"]}>
                  {ov.installs.map((r) => {
                    const d = r.prev > 0 ? (r.inRange - r.prev) / r.prev : null;
                    return (
                      <tr key={r.platform}>
                        <td className="font-medium">{PLATFORM_LABEL[r.platform]}</td>
                        <td>{n(r.active)}</td>
                        <td>{n(r.inRange)}</td>
                        <td className="text-muted-foreground">{d === null ? (r.inRange ? "new" : "") : `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`}</td>
                        <td>{n(r.uninstalled)}</td>
                      </tr>
                    );
                  })}
                </Table>
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  Android installs are counted when the app first signs in with its install id (the app sends it from its next release). Uninstalls are inferred when the phone&apos;s push token is reported dead, so they lag and undercount. iOS has no app yet.
                </p>
                {plat.installs.some((p) => p.versions.length > 0) && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {plat.installs.filter((p) => p.versions.length > 0).map((p) => (
                      <div key={p.platform} className="text-[13px]">
                        <p className="mb-1 font-semibold">{p.label} versions</p>
                        <ul className="flex flex-col gap-1">
                          {p.versions.map((v) => (
                            <li key={v.version} className="flex justify-between gap-3 tabular-nums"><span className="text-muted-foreground">{v.version}</span><span>{n(v.count)}</span></li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </Section>
          </div>
        )}

        {/* 3. Active users */}
        {tab === "active" && series && (
          <div {...panel("active")}>
          <Section id="active" className="mt-0" title="Active users" hint="Unique people, so one person on three devices is still one." actions={<ExportLinks base={base} kinds={[{ kind: "daily", label: "Daily" }, { kind: "buckets", label: q.g === "day" ? "Daily buckets" : q.g === "week" ? "Weekly" : "Monthly" }]} />}>
            <DataSwap k={kpiKey}>
              <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                <SeriesChart title="DAU, WAU and MAU" hint="Per UTC day: active that day, in the trailing 7 days, in the trailing 30 days." rows={series.daily} series={[{ key: "dau", name: "DAU", kind: "bar", color: LIME }, { key: "wau", name: "WAU", kind: "line", color: INK }, { key: "mau", name: "MAU", kind: "line", color: ACCENT }]} table={{ head: ["Day", "DAU", "WAU", "MAU"], rows: series.daily.map((r) => [String(r.label), Number(r.dau), Number(r.wau), Number(r.mau)]), label: "Active users per day" }} empty={noEvents} />
                <SeriesChart title={`Active, new and returning per ${q.g}`} hint="Active: unique people in the bucket. New: accounts created. Returning: active on a day after their sign-up day." rows={series.rows} series={[{ key: "active", name: "Active", kind: "bar", color: LIME }, { key: "new", name: "New", kind: "bar", color: ACCENT }, { key: "returning", name: "Returning", kind: "line", color: INK }]} table={{ head: [q.g === "day" ? "Day" : q.g === "week" ? "Week" : "Month", "Active", "New", "Returning", "Sessions"], rows: series.rows.map((r) => [String(r.label), Number(r.active), Number(r.new), Number(r.returning), Number(r.sessions)]), label: "Active users per bucket" }} empty={noEvents} />
              </div>
            </DataSwap>
          </Section>
          </div>
        )}

        {/* 4. Engagement */}
        {tab === "engagement" && eng && (
          <div {...panel("engagement")}>
          <Section id="engagement" className="mt-0" title="Engagement" hint="What people actually do, from the events the app records. Background jobs and heartbeats are never counted." actions={<ExportLinks base={base} kinds={[{ kind: "events", label: "Events" }, { kind: "features", label: "Features" }]} />}>
            <DataSwap k={kpiKey}>
              {!tracked ? (
                <Card data-enter><Empty title={noEvents.title} body={noEvents.body} /></Card>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
                    {[
                      ["Sessions", n(eng.sessions), DEFINITIONS.find((d) => d.key === "session")?.rule ?? ""],
                      ["Sessions per user", String(eng.perUser), "Sessions in the range divided by the unique people who had one."],
                      ["Average session", fmtDur(eng.avgDurationS), `Mean length from first to last event. Median ${fmtDur(eng.medianDurationS)}.`],
                      ["Events per session", String(eng.eventsPerSession), "Recorded actions per session, page views included."],
                    ].map(([label, value, hint]) => (
                      <Card key={label} data-enter as="div" className="p-5">
                        <p className="flex items-start gap-1 text-[12.5px] font-medium text-muted-foreground"><span>{label}</span><Hint text={hint} label={`How ${label} is counted`} /></p>
                        <p className="mt-2 font-display text-[1.75rem] font-bold leading-none tabular-nums">{value}</p>
                      </Card>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
                    <Card data-enter as="div">
                      <CardTitle hint="Share of people active in the range who used the feature at least once.">Feature adoption</CardTitle>
                      <ol className="flex flex-col gap-2 text-[13px]" aria-label="Feature adoption">
                        {eng.features.map((f) => (
                          <li key={f.key}>
                            <div className="flex items-baseline justify-between gap-3"><span className="font-medium">{f.label}</span><span className="tabular-nums text-muted-foreground"><b className="text-foreground">{pct(f.adoption)}</b> · {n(f.users)} {f.users === 1 ? "person" : "people"}</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden><span className="block h-full rounded-full bg-[hsl(var(--lime))]" style={{ width: `${Math.max(f.adoption ? 2 : 0, f.adoption * 100)}%` }} /></div>
                          </li>
                        ))}
                      </ol>
                    </Card>
                    <Card data-enter as="div">
                      <CardTitle hint="Studio pages opened, folded into their section. Ids and query strings are never recorded.">Most visited sections</CardTitle>
                      {eng.sections.length === 0 ? <Empty title="No page views yet" body="Page views arrive from the browser tracker once people open the studio." /> : (
                        <Table label="Sections" head={["Section", "Views"]} align={[undefined, "right"]}>
                          {eng.sections.map((s) => <tr key={s.section}><td className="font-medium capitalize">{s.section}</td><td>{n(s.views)}</td></tr>)}
                        </Table>
                      )}
                    </Card>
                    <Card data-enter as="div">
                      <CardTitle hint="Every recorded event in the range, most frequent first, with how many different people did it.">Events</CardTitle>
                      <Table label="Events" head={["Event", "Count", "People"]} align={[undefined, "right", "right"]}>
                        {eng.events.map((e) => <tr key={e.name}><td className="font-medium">{e.label}</td><td>{n(e.count)}</td><td>{n(e.users)}</td></tr>)}
                      </Table>
                    </Card>
                  </div>
                  <div className="mt-4">
                    <SeriesChart title={`Content per ${q.g}`} hint="Posts created, uploads, schedules and live publishes." rows={eng.content} series={[{ key: "content_created", name: "Created", kind: "bar", color: LIME }, { key: "video_uploaded", name: "Uploads", kind: "bar", color: MUTED }, { key: "post_scheduled", name: "Scheduled", kind: "line", color: ACCENT }, { key: "post_published", name: "Published", kind: "line", color: INK }]} table={{ head: ["Bucket", "Created", "Uploads", "Scheduled", "Published"], rows: eng.content.map((r) => [String(r.label), Number(r.content_created), Number(r.video_uploaded), Number(r.post_scheduled), Number(r.post_published)]), label: "Content per bucket" }} empty={noEvents} />
                  </div>
                </>
              )}
            </DataSwap>
          </Section>
          </div>
        )}

        {/* 5. Retention */}
        {tab === "retention" && ret && (
          <div {...panel("retention")}>
          <Section id="retention" className="mt-0" title="Retention" hint="Do people come back? Cohorts are everyone who signed up; a window counts only once it has fully ended." actions={<ExportLinks base={base} kinds={[{ kind: "retention", label: "Windows" }, { kind: "cohorts", label: "Cohorts" }]} />}>
            <RetentionCards rows={ret.rows} />
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
              <CohortGrid cohorts={ret.cohorts} />
              <div className="flex flex-col gap-4 [&>*]:min-w-0">
                <SeriesChart title={`Sign-ups per ${q.g}`} hint="Accounts created in the bucket, and how many of them have been active on a later day (so far)." rows={ret.growth} series={[{ key: "signups", name: "Sign-ups", kind: "bar", color: LIME }, { key: "cameBack", name: "Came back", kind: "line", color: INK }]} table={{ head: ["Bucket", "Sign-ups", "Came back"], rows: ret.growth.map((r) => [String(r.label), Number(r.signups), Number(r.cameBack)]), label: "Sign-ups per bucket" }} empty={{ title: "No sign-ups in this range" }} height={200} />
                <Card data-enter as="div">
                  <CardTitle hint="For people who signed up in the range: time from the account being created to their first recorded action.">Sign-up to first activity</CardTitle>
                  {ret.firstActivity.measured === 0 ? (
                    <Empty title="Nothing measured yet" body="Needs sign-ups in the range and the event tracking from this release." />
                  ) : (
                    <dl className="grid grid-cols-3 gap-3 text-[13px]">
                      <div><dt className="text-muted-foreground">Median</dt><dd className="font-display text-[1.4rem] font-bold tabular-nums">{ret.firstActivity.medianHours === null ? "" : ret.firstActivity.medianHours < 1 ? `${Math.round(ret.firstActivity.medianHours * 60)}m` : `${ret.firstActivity.medianHours}h`}</dd></div>
                      <div><dt className="text-muted-foreground">Within 24h</dt><dd className="font-display text-[1.4rem] font-bold tabular-nums">{pct(ret.firstActivity.measured ? ret.firstActivity.within24h / ret.firstActivity.measured : 0)}</dd></div>
                      <div><dt className="text-muted-foreground">No activity yet</dt><dd className="font-display text-[1.4rem] font-bold tabular-nums">{n(ret.firstActivity.never)}</dd></div>
                    </dl>
                  )}
                </Card>
              </div>
            </div>
          </Section>
          </div>
        )}

        {/* 6. Platforms & devices */}
        {tab === "platforms" && plat && (
          <div {...panel("platforms")}>
          <Section id="platforms" className="mt-0" title="Platforms & devices" hint="From the qualifying events in the range. Coarse buckets only: no user agent strings are stored." actions={<ExportLinks base={base} kinds={[{ kind: "platforms", label: "All breakdowns" }]} />}>
            <DataSwap k={kpiKey}>
              {!plat.tracked ? (
                <Card data-enter><Empty title={noEvents.title} body={noEvents.body} /></Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
                  <BreakdownCard title="Platform" hint="Web app, installed web app (standalone), Android app." rows={plat.platforms} empty="Events carry their platform." />
                  <BreakdownCard title="Device" hint="Phone, tablet or desktop, from the browser's user agent class." rows={plat.devices} empty="Events carry their device class." />
                  <BreakdownCard title="Operating system" hint="Android, iOS, Windows, macOS, ChromeOS, Linux." rows={plat.os} empty="Events carry their OS family." />
                  <BreakdownCard title="Browser" hint="Browser family; the Android app shows as Outlly app." rows={plat.browsers} empty="Events carry their browser family." />
                  <BreakdownCard title="App version" hint="Android app version from the x-outlly-client header; web requests have none." rows={plat.versions} empty="Appears once the Android app reports events." />
                  <BreakdownCard title="Country" hint="From the account's last known sign-in location (country only)." rows={plat.countries} empty="Appears once locations are known." />
                </div>
              )}
            </DataSwap>
          </Section>
          </div>
        )}

        {/* 7. User activity */}
        {tab === "users" && users && (
          <div {...panel("users")}>
          <Section id="users" className="mt-0" title="User activity" hint={`${n(users.total)} ${narrowing ? "match the filters" : "accounts"}, ${uf.limit} per page. Click a name for their history.`} actions={<ExportLinks base={`/api/admin/app-analytics?q=${encodeURIComponent(uf.q)}&platform=${uf.platform}&status=${uf.status}&joined=${uf.joined}&sort=${uf.sort}`} kinds={[{ kind: "users", label: "Users (filtered)" }]} />}>
            <Card data-enter>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <SearchBox placeholder="Search name, email or id" />
                <div role="group" aria-label="User filters" className="grid grid-cols-2 items-end gap-2.5 sm:flex sm:flex-wrap">
                  <FilterSelect fill param="status" label="Status" current={uf.status} options={[...USER_STATUS]} />
                  <FilterSelect fill param="up" label="Platform" current={uf.platform} options={[...USER_PLATFORMS]} />
                  <FilterSelect fill param="joined" label="Joined" current={uf.joined} options={[...USER_JOINED]} />
                  <FilterSelect fill param="sort" label="Sort" current={uf.sort} options={[...USER_SORTS]} />
                </div>
              </div>
              <DataSwap k={userKey}>
                {users.rows.length === 0 ? (
                  <Empty title={uf.q ? `No one matches "${uf.q}"` : narrowing ? "No one matches these filters" : "No users yet"} body={uf.q || narrowing ? "Loosen a filter or try part of an email or a first name." : "Sign-ups appear here as soon as someone creates an account."} />
                ) : (
                  <Table label="User activity" head={["User", "Registered", "Last active", "Platform", "Device", "Version", "Sessions", "Last sign-in", "Status"]} align={[undefined, undefined, undefined, undefined, undefined, undefined, "right", undefined, undefined]} stickyFirst>
                    {users.rows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link href={`/admin/app-analytics/${u.id}`} className="font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">{u.name}</Link>
                          <span className="block text-[12px] text-muted-foreground">{u.email}</span>
                        </td>
                        <td>{fmtDate(u.createdAt)}</td>
                        <td title={u.lastActiveAt ? fmtDate(u.lastActiveAt, true) : undefined}>{u.lastActiveAt ? ago(u.lastActiveAt) : <span className="text-muted-foreground">never</span>}</td>
                        <td>{u.platform ? PLATFORM_LABEL[u.platform] : <span className="text-muted-foreground">not seen yet</span>}</td>
                        <td className="capitalize">{u.device ?? ""}</td>
                        <td>{u.version ?? ""}</td>
                        <td>{n(u.sessions)}</td>
                        <td title={u.lastLoginAt ? fmtDate(u.lastLoginAt, true) : undefined}>{u.lastLoginAt ? ago(u.lastLoginAt) : <span className="text-muted-foreground">before tracking</span>}</td>
                        <td><StatusPill status={u.status} /></td>
                      </tr>
                    ))}
                  </Table>
                )}
              </DataSwap>
              <Pagination total={users.total} page={uf.page} limit={uf.limit} className="mt-4" />
              <p className="mt-3 text-[12px] text-muted-foreground">Sessions and platform come from the usage sessions recorded since this release; &quot;Last active&quot; uses the older daily activity log too. {admin.role !== "super" && <Pill tone="muted">emails masked for your role</Pill>}</p>
            </Card>
          </Section>
          </div>
        )}
      </EnterRoot>
    </>
  );
}
