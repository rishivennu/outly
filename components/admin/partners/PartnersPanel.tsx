"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Empty, Table, ago, fmtDate } from "@/components/admin/ui";
import { DateFilter, FilterSelect, MoreFilters, SearchBox } from "@/components/admin/SearchBox";
import { Pagination } from "@/components/admin/Pagination";
import {
  PARTNER_PLATFORMS,
  PARTNER_PREFERENCES,
  PARTNER_STATUSES,
  PARTNER_STATUS_LABEL,
  PARTNER_TIERS,
} from "@/lib/partners/types";
import { SORT_OPTS, PartnerStatusBadge, PlatformMark, fmtCount, fmtRate, nicheLabel, platformLabel, preferenceLabel, tierLabel } from "./bits";

export type PartnerRow = {
  id: string; ref: string; status: string; fullName: string; email: string; primaryPlatform: string; primaryHandle: string;
  followers: number; avgViews: number; engagementRate: number | null; niche: string; createdAt: string;
};
export type PartnerKpiCounts = { total: number; submitted: number; underReview: number; moreInfo: number; approved: number; offerSent: number; active: number; rejected: number };
export type PartnerFilters = { status: string; platform: string; tier: string; preference: string; from: string; to: string; sort: string };

const KPI: { key: keyof PartnerKpiCounts; label: string; status?: string }[] = [
  { key: "total", label: "Total applications" },
  { key: "submitted", label: "New", status: "submitted" },
  { key: "underReview", label: "Under review", status: "under_review" },
  { key: "moreInfo", label: "More info needed", status: "more_info" },
  { key: "approved", label: "Approved", status: "approved" },
  { key: "offerSent", label: "Offers pending", status: "offer_sent" },
  { key: "active", label: "Active partnerships", status: "active" },
  { key: "rejected", label: "Rejected", status: "rejected" },
];

const STATUS_OPTS = [{ value: "", label: "Any status" }, ...PARTNER_STATUSES.map((s) => ({ value: s, label: PARTNER_STATUS_LABEL[s] }))];
const PLATFORM_OPTS = [{ value: "", label: "Any platform" }, ...PARTNER_PLATFORMS.map((p) => ({ value: p, label: platformLabel(p) }))];
const TIER_OPTS = [{ value: "", label: "Any tier" }, ...PARTNER_TIERS.map((t) => ({ value: t, label: tierLabel(t) }))];
const PREF_OPTS = [{ value: "", label: "Any preference" }, ...PARTNER_PREFERENCES.map((p) => ({ value: p, label: preferenceLabel(p) }))];

/** Admin: the Creator Partnerships list. Filters live in the URL (server renders the rows), so back/forward and shared links work. */
export function PartnersPanel({ rows, total, page, limit, kpis, filters, filtered }: { rows: PartnerRow[]; total: number; page: number; limit: number; kpis: PartnerKpiCounts; filters: PartnerFilters; filtered: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const kpiHref = (status?: string) => {
    const n = new URLSearchParams(sp.toString());
    status ? n.set("status", status) : n.delete("status");
    n.delete("page");
    const q = n.toString();
    return q ? `/admin/partners?${q}` : "/admin/partners";
  };
  const exportHref = `/api/admin/partners/export${sp.toString() ? `?${sp}` : ""}`;
  const more = [filters.tier, filters.preference, filters.from, filters.to].filter(Boolean).length;

  return (
    <div className="grid gap-5">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" aria-label="Application totals">
        {KPI.map((k) => {
          const on = k.status ? filters.status === k.status : !filters.status;
          return (
            <li key={k.key}>
              <Link
                href={kpiHref(k.status)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className="admin-card block min-h-[88px] rounded-[24px] bg-card p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))] data-[on=true]:ring-1 data-[on=true]:ring-[hsl(var(--lime)/0.55)]"
                data-interactive=""
                data-on={on ? "true" : "false"}
              >
                <span className="block text-[12px] font-semibold text-muted-foreground">{k.label}</span>
                <span className="mt-2 block font-display text-[1.6rem] font-bold leading-none tabular-nums">{kpis[k.key].toLocaleString("en-IN")}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <Card>
        <div role="group" aria-label="Filter applications" className="mb-5 grid grid-cols-2 items-end gap-2.5 sm:flex sm:flex-wrap">
          <div className="col-span-2 min-w-0 sm:min-w-[16rem] sm:flex-1">
            <SearchBox placeholder="Name, email, handle or OP- reference" />
          </div>
          <FilterSelect param="status" label="Status" options={STATUS_OPTS} current={filters.status} fill />
          <FilterSelect param="platform" label="Platform" options={PLATFORM_OPTS} current={filters.platform} fill />
          <MoreFilters active={more}>
            <FilterSelect param="tier" label="Tier" options={TIER_OPTS} current={filters.tier} fill />
            <FilterSelect param="preference" label="Preference" options={PREF_OPTS} current={filters.preference} fill />
            <DateFilter param="from" label="Applied from" current={filters.from} max={filters.to || undefined} />
            <DateFilter param="to" label="Applied to" current={filters.to} min={filters.from || undefined} />
          </MoreFilters>
          <FilterSelect param="sort" label="Sort" options={SORT_OPTS} current={filters.sort} fill />
          <Button asChild variant="outline" className="col-span-2 sm:col-span-1 sm:ml-auto">
            <a href={exportHref} download>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          </Button>
        </div>

        {rows.length === 0 ? (
          filtered ? (
            <Empty
              title="No applications match these filters"
              body="Try another search, or clear the filters to see every application."
              action={<Button asChild variant="outline"><Link href="/admin/partners">Clear filters</Link></Button>}
            />
          ) : (
            <Empty icon={<Handshake />} title="No applications yet" body="No applications yet. Share outlly.com/partners with creators to get started." />
          )
        ) : (
          <Table
            label="Creator applications"
            head={["Creator", "Primary platform", "Followers", "Avg views", "Engagement", "Niche", "Applied", "Status", <span key="a" className="sr-only">Actions</span>]}
            align={[undefined, undefined, "right", "right", "right"]}
            minWidth={1040}
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  router.push(`/admin/partners/${r.id}`);
                }}
              >
                <td className="max-w-[240px]">
                  <p className="truncate font-medium" title={r.fullName}>{r.fullName}</p>
                  <p className="truncate text-[12px] text-muted-foreground" title={r.email}>{r.email} · {r.ref}</p>
                </td>
                <td className="max-w-[200px]">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <PlatformMark platform={r.primaryPlatform} />
                    <span className="sr-only">{platformLabel(r.primaryPlatform)}: </span>
                    <span className="truncate">{r.primaryHandle ? `@${r.primaryHandle}` : platformLabel(r.primaryPlatform)}</span>
                  </span>
                </td>
                <td>{fmtCount(r.followers)}</td>
                <td>{fmtCount(r.avgViews)}</td>
                <td>{fmtRate(r.engagementRate)}</td>
                <td className="whitespace-nowrap">{nicheLabel(r.niche)}</td>
                <td className="whitespace-nowrap text-muted-foreground"><time dateTime={r.createdAt} title={fmtDate(r.createdAt, true)}>{ago(r.createdAt)}</time></td>
                <td><PartnerStatusBadge status={r.status} size="sm" /></td>
                <td className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/admin/partners/${r.id}`} aria-label={`View application from ${r.fullName}`}>View</Link>
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination total={total} page={page} limit={limit} label="Applications pages" />
      </Card>
    </div>
  );
}
