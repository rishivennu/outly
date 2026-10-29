import { requireAdmin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { channelStats, growthFunnel, leads, rangeStart, referralBoard, type Range } from "@/lib/admin/growth";
import { LISTS, channelLabel, worstStep, type LeadKind } from "@/lib/growth/core";
import { SAMPLE_DOMAIN } from "@/lib/admin/sample";
import { Card, CardTitle, Empty, PageHead, Pill, Table } from "@/components/admin/ui";
import { FilterChips } from "@/components/admin/SearchBox";
import { OrbAvatar } from "@/components/brand/OrbAvatar";
import { LeadLists, type LeadView } from "@/components/admin/growth/LeadLists";
import { CampaignLinks } from "@/components/admin/growth/CampaignLinks";

export const metadata = { title: "Growth" };
export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "" : `${Math.round(n * 100)}%`);
const RANGE_LABEL: Record<Range, string> = { "30": "last 30 days", "90": "last 90 days", all: "all time" };

export default async function GrowthPage({ searchParams }: { searchParams: { r?: string } }) {
  await requireAdmin("growth");
  const r: Range = searchParams.r === "30" || searchParams.r === "all" ? searchParams.r : "90";
  const since = rangeStart(r);
  const now = new Date();
  const [steps, channels, refs, ...lists] = await Promise.all([growthFunnel(since), channelStats(since), referralBoard(), ...LISTS.map((l) => leads(l.kind, now))]);
  const worst = worstStep(steps);
  const top = Math.max(1, ...steps.map((s) => s.count));
  const byKind = Object.fromEntries(LISTS.map((l, i) => [l.kind, lists[i].slice(0, 500).map((x): LeadView => ({ ...x, since: x.since.toISOString(), emailedAt: x.emailedAt?.toISOString() ?? null }))])) as Record<LeadKind, LeadView[]>;
  const totals = Object.fromEntries(LISTS.map((l, i) => [l.kind, lists[i].length])) as Record<LeadKind, number>;

  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Growth"
        body="Where people drop off between hearing about Outlly and paying for it, who to nudge next, and which channels bring creators who stay."
        actions={<FilterChips param="r" current={r === "90" ? "" : r} options={[{ value: "30", label: "30 days" }, { value: "", label: "90 days" }, { value: "all", label: "All time" }]} />}
      />

      <Card className="mb-5">
        <CardTitle hint={`People who arrived in the ${RANGE_LABEL[r]}. Each bar shows how many of the step before made it.`}>Signup funnel</CardTitle>
        <ol className="grid gap-3">
          {steps.map((s, i) => (
            <li key={s.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[180px_1fr_120px]">
              <span className="text-[13.5px] font-semibold">{i + 1}. {s.label}</span>
              <span className="relative h-9 overflow-hidden rounded-xl bg-secondary/70" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-xl lime-bg" style={{ width: `${Math.max(2, (s.count / top) * 100)}%` }} />
              </span>
              <span className="flex items-baseline gap-2 sm:justify-end">
                <span className="font-display text-[1.15rem] font-bold tabular">{s.count.toLocaleString("en-IN")}</span>
                {s.rate !== null && <span className={`text-[12.5px] tabular ${worst?.key === s.key ? "pill-ink-bad font-semibold" : "text-muted-foreground"}`}>{pct(s.rate)}{s.lost ? `, ${s.lost.toLocaleString("en-IN")} lost` : ""}</span>}
              </span>
            </li>
          ))}
        </ol>
        {worst && (
          <p className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3 text-[13.5px]">
            Biggest drop: <b>{worst.label.toLowerCase()}</b>, only {pct(worst.rate)} make it. Start with that lead list below.
          </p>
        )}
        <p className="mt-3 text-[12px] text-muted-foreground">Waitlist and signups are counted separately: when the waitlist is off, people sign up without joining it, so step 2 can be bigger than step 1.</p>
      </Card>

      <Card className="mb-5">
        <CardTitle hint="Scored hot, warm or cold by how recent and how active they are. Each list has a ready-written email that lands in the Outbox, and a CSV export.">Lead lists</CardTitle>
        <LeadLists lists={byKind} total={totals} />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardTitle hint="Tag every link you post. Signups are credited to the first tagged link they clicked.">Campaign links</CardTitle>
          <CampaignLinks base={env.APP_URL} />
          <h3 className="mb-3 mt-7 text-[13.5px] font-semibold">Which channels bring real users ({RANGE_LABEL[r]})</h3>
          {channels.length === 0 ? (
            <Empty title="No signups in this range" body="Share a campaign link and the first signups from it show up here." />
          ) : (
            <Table label="Signups by channel" head={["Channel", "Signups", "Connected", "Posted", "Paid", "Signup to paid"]}>
              {channels.map((c) => (
                <tr key={c.key}>
                  <td>
                    <span className="block font-medium">{channelLabel(c.source)}</span>
                    {(c.medium || c.campaign) && <span className="block text-[12px] text-muted-foreground">{[c.medium, c.campaign].filter(Boolean).join(" / ")}</span>}
                  </td>
                  <td className="tabular">{c.signups}</td>
                  <td className="tabular">{c.connected}</td>
                  <td className="tabular">{c.posted}</td>
                  <td className="tabular">{c.paid}</td>
                  <td className="tabular">{c.signups ? pct(c.paid / c.signups) : ""}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardTitle hint={`${refs.total} signup${refs.total === 1 ? "" : "s"} from friends' links, ${refs.paid} of them paid. Each friend who pays gets a free Creator month. Details in Refer & Earn.`}>Referral leaderboard</CardTitle>
          {refs.rows.length === 0 ? (
            <Empty title="No referrals yet" body="When a creator's share link brings someone in, they show up here." />
          ) : (
            <ol className="grid gap-1">
              {refs.rows.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-foreground/[0.03]">
                  <span className="w-6 text-center font-display text-[15px] font-bold tabular text-muted-foreground">{i + 1}</span>
                  <OrbAvatar avatar={p.avatar} seed={p.email} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}{p.email.endsWith(SAMPLE_DOMAIN) && <Pill className="ml-2" tone="info">sample</Pill>}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{p.email}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13.5px] font-semibold tabular">{p.joined} joined</span>
                    <span className="block text-[12px] text-muted-foreground tabular">{p.paid} paid</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
