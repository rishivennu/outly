import Link from "next/link";
import { AdminFilterBar } from "@/components/admin/FilterBar";
import { DateFilter, FilterSelect, SearchBox } from "@/components/admin/SearchBox";
import { filtersOn, type QueueFilters } from "@/lib/admin/notifications";

const STATUS = [
  { value: "", label: "Waiting or retrying" },
  { value: "waiting", label: "Waiting" },
  { value: "retrying", label: "Retrying" },
  { value: "failed", label: "Failed" },
  { value: "dead", label: "Dead letters" },
];
const CHANNEL = [
  { value: "", label: "Any channel" },
  { value: "email", label: "Asks for email" },
  { value: "inapp", label: "Bell and push only" },
];
const LIMIT = [25, 50, 100].map((n) => ({ value: String(n), label: `${n} rows` }));

/** R1267: one bar for both cards below it. Every control writes the URL, so a filtered view is a shareable link. */
export function QueueFilterBar({ f, shown }: { f: QueueFilters; shown: string }) {
  return (
    <AdminFilterBar label="Queue and dead letter filters" meta={shown} className="mt-4 items-end">
      <SearchBox placeholder="Search event, title or creator id" />
      <FilterSelect param="status" label="Status" current={f.status} options={STATUS} />
      <FilterSelect param="channel" label="Channel" current={f.channel} options={CHANNEL} />
      <DateFilter param="from" label="Created from" current={f.from} max={f.to || undefined} />
      <DateFilter param="to" label="Created to" current={f.to} min={f.from || undefined} />
      <FilterSelect param="limit" label="Show" current={String(f.limit)} options={LIMIT} />
      {filtersOn(f) && (
        <Link href="/admin/notifications" scroll={false} className="inline-flex min-h-11 items-center rounded-full px-3.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          Clear filters
        </Link>
      )}
    </AdminFilterBar>
  );
}
