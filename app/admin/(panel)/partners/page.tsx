import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { PartnersPanel } from "@/components/admin/partners/PartnersPanel";
import { SORT_OPTS } from "@/components/admin/partners/bits";
import { kpis, listApplications, normaliseQuery } from "@/lib/partners/admin";

export const metadata = { title: "Creator Partnerships", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Params = { q?: string; status?: string; platform?: string; tier?: string; niche?: string; preference?: string; from?: string; to?: string; sort?: string; page?: string };

export default async function PartnersAdminPage(props: { searchParams: Promise<Params> }) {
  await requireAdmin("partners");
  const sp = await props.searchParams;
  const sortParam = SORT_OPTS.some((o) => o.value === sp.sort) ? sp.sort ?? "" : "";
  const query = { ...sp, sort: sortParam === "oldest" || !sortParam ? "createdAt" : sortParam, dir: sortParam === "oldest" ? "asc" : "desc" };
  const [list, counts] = await Promise.all([listApplications(query), kpis()]);
  const n = normaliseQuery(query);
  const filtered = !!(n.q || n.status || n.platform || n.tier || n.niche || n.preference || n.from || n.to);
  return (
    <>
      <PageHead eyebrow="Run" title="Creator Partnerships" body="Applications, offers and active creator partnerships." />
      <PartnersPanel
        rows={JSON.parse(JSON.stringify(list.rows))}
        total={list.total}
        page={list.page}
        limit={list.limit}
        kpis={counts}
        filtered={filtered}
        filters={{ status: n.status, platform: n.platform, tier: n.tier, preference: n.preference, from: n.from, to: n.to, sort: sortParam }}
      />
    </>
  );
}
