import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { getApplication } from "@/lib/partners/admin";
import { PageHead, Pill, fmtDate } from "@/components/admin/ui";
import { PartnerDetail } from "@/components/admin/partners/PartnerDetail";
import { PartnerStatusBadge, tierLabel } from "@/components/admin/partners/bits";

export const metadata = { title: "Creator application", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PartnerApplicationPage(props: { params: Promise<{ id: string }> }) {
  await requireAdmin("partners");
  const { id } = await props.params;
  const app = await getApplication(id);
  if (!app) notFound();
  const data = JSON.parse(JSON.stringify(app));
  return (
    <>
      <Link href="/admin/partners" className="mb-3 inline-flex min-h-[44px] items-center gap-1 rounded-full pr-3 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]">
        <ChevronLeft className="h-4 w-4" aria-hidden /> All applications
      </Link>
      <PageHead
        eyebrow="Creator Partnerships"
        title={app.fullName}
        body={
          <span className="flex flex-wrap items-center gap-2">
            <PartnerStatusBadge status={app.status} />
            <Pill tone="muted">{tierLabel(app.tier)} tier</Pill>
            <span className="tabular-nums">{app.ref}</span>
            <span aria-hidden="true">·</span>
            <span>Applied <time dateTime={app.createdAt.toISOString()}>{fmtDate(app.createdAt)}</time></span>
          </span>
        }
      />
      <PartnerDetail app={data} />
    </>
  );
}
