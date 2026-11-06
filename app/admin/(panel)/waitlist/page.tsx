import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { istBounds, waitlistCounts, waitlistList } from "@/lib/site";
import { campaignStatus } from "@/lib/campaigns";
import { Card, CardTitle, Empty, PageHead, Pill, Table, ago } from "@/components/admin/ui";
import { WaitlistToggle } from "@/components/admin/WaitlistToggle";
import { WaitlistCampaign } from "@/components/admin/WaitlistCampaign";
import { AutoRefresh, InviteOne } from "@/components/admin/WaitlistBits";
import { DateFilter, FilterChips, FilterSelect, MoreFilters, SearchBox } from "@/components/admin/SearchBox";
import { RefreshButton } from "@/components/admin/RefreshButton";
import { Download } from "lucide-react";

export const metadata = { title: "Waitlist" };
export const dynamic = "force-dynamic";

const PER = 25;
const SORTS = [
  { value: "", label: "Newest first" },
  { value: "old", label: "Oldest first" },
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ist = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

type SP = { q?: string; st?: string; sort?: string; from?: string; to?: string; page?: string };

/**
 * Waitlist (1142): the overview and member list are always here, whatever the switch says. Members are read
 * straight from WaitlistEntry with the filters in the URL (search, status, sort, joined from/to, page), so
 * they survive refresh and back, and the CSV export uses the same filters.
 */
export default async function WaitlistAdminPage(props: { searchParams: Promise<SP> }) {
  await requireAdmin("site");
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim().slice(0, 120);
  const status = sp.st === "waiting" || sp.st === "invited" ? sp.st : "";
  const sort = sp.sort === "old" ? "old" : "";
  const from = sp.from && DAY.test(sp.from) ? sp.from : "";
  const to = sp.to && DAY.test(sp.to) ? sp.to : "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const f = { q, status: (status || "all") as "all" | "waiting" | "invited", sort: (sort || "new") as "new" | "old", from, to };
  const [c, counts, list, campaign] = await Promise.all([getConfig("site"), waitlistCounts(), waitlistList({ ...f, page, per: PER }), campaignStatus()]);

  const kept = { ...(q ? { q } : {}), ...(status ? { st: status } : {}), ...(sort ? { sort } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const link = (p: number) => `?${new URLSearchParams({ ...kept, page: String(p) })}`;
  const csv = `/api/admin/waitlist/export?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...(sort ? { sort } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;
  const narrowing = [q, status, from, to].filter(Boolean).length;
  const today = istBounds().day;
  const todayStr = new Date(today.getTime() + 330 * 60_000).toISOString().slice(0, 10);

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Waitlist"
        body="One switch pauses new signups. Every “Start creating” button becomes “Join the waitlist”, /signup shows the waitlist page, and you invite people in when you're ready. The list below is always available, on or off."
        actions={<RefreshButton total={counts.total} noun="people" loadedAt={new Date().toISOString()} />}
      />
      <AutoRefresh />
      <WaitlistToggle initial={{ waitlist: !!c.waitlist, since: c.waitlistSince, counts }} />
      <WaitlistCampaign initial={campaign} />

      <Card className="mt-4" aria-labelledby="wl-members">
        <CardTitle
          hint={narrowing ? `${list.total.toLocaleString("en-IN")} of ${counts.total.toLocaleString("en-IN")} match these filters.` : `${counts.total.toLocaleString("en-IN")} joined in total. Times are India time.`}
          action={
            <a href={csv} download className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold hairline hover:bg-secondary sm:h-9">
              <Download className="h-4 w-4" aria-hidden /> Export CSV<span className="sr-only"> ({list.total} {list.total === 1 ? "person" : "people"})</span>
            </a>
          }
        >
          <span id="wl-members">Members</span>
        </CardTitle>

        {/* Same pattern as Users: chips scroll sideways on phones, search gets its own row, sort and the date range
            sit in a two-column grid (dates behind "More filters" on phones). All of it is in the URL. */}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <FilterChips param="st" current={status} options={[{ value: "", label: "All" }, { value: "waiting", label: "Waiting" }, { value: "invited", label: "Invited" }]} />
          <SearchBox placeholder="Search name or email" />
        </div>
        <div role="group" aria-label="More filters" className="mb-4 grid grid-flow-row-dense grid-cols-2 items-end gap-2.5 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <FilterSelect fill param="sort" label="Sort" current={sort} options={SORTS} />
          <MoreFilters active={[from, to].filter(Boolean).length}>
            <DateFilter param="from" label="Joined from" current={from} max={to || todayStr} />
            <DateFilter param="to" label="Joined to" current={to} min={from || undefined} max={todayStr} />
          </MoreFilters>
          {narrowing || sort ? (
            <a href="?" className="col-span-2 inline-flex h-11 items-center justify-center rounded-full px-4 text-[13px] font-semibold text-muted-foreground hairline hover:bg-secondary hover:text-foreground sm:col-span-1">
              Clear all
            </a>
          ) : null}
        </div>

        {list.rows.length === 0 ? (
          counts.total === 0 ? (
            <Empty title="Nobody in line yet" body="When the waitlist is on, every signup button leads to the waitlist page. New entries show up here." />
          ) : (
            <Empty title="No one matches" body="Try a different search or date range, or clear the filters." />
          )
        ) : (
          <Table label="Waitlist members" head={["Email", "Name", "Source", "Joined", "Status", <span key="a" className="sr-only">Action</span>]} minWidth={720}>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[260px] truncate font-medium" title={r.email}>{r.email}</td>
                <td className="text-muted-foreground">{r.name || "-"}</td>
                <td className="text-muted-foreground">{r.source || "Direct"}</td>
                <td className="whitespace-nowrap">
                  <time dateTime={r.createdAt} className="block">{ist(r.createdAt)}</time>
                  <span className="text-[12px] text-muted-foreground">{ago(r.createdAt)}</span>
                </td>
                <td>{r.invitedAt ? <Pill tone="ok">Invited {ago(r.invitedAt)}</Pill> : <Pill tone="muted">Waiting</Pill>}</td>
                <td className="text-right">{!r.invitedAt && <InviteOne id={r.id} email={r.email} />}</td>
              </tr>
            ))}
          </Table>
        )}
        {list.pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px]">
            {list.page > 1 ? <a className="inline-flex h-11 items-center rounded-full px-4 hairline hover:bg-secondary" href={link(list.page - 1)}>Previous</a> : <span />}
            <span className="text-muted-foreground">Page {list.page} of {list.pages}</span>
            {list.page < list.pages ? <a className="inline-flex h-11 items-center rounded-full px-4 hairline hover:bg-secondary" href={link(list.page + 1)}>Next</a> : <span />}
          </nav>
        )}
      </Card>
    </>
  );
}
