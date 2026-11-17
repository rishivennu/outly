import { requireAdmin } from "@/lib/admin/guard";
import { campaignsState } from "@/lib/campaign";
import { PageHead } from "@/components/admin/ui";
import { CampaignsPanel } from "@/components/admin/CampaignsPanel";

export const metadata = { title: "Offers" };
export const dynamic = "force-dynamic";

export default async function CampaignsAdminPage() {
  await requireAdmin("pricing");
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Offers"
        body="Flash sales and promo offers, priced from the live plan price."
      />
      <CampaignsPanel initial={await campaignsState()} />
    </>
  );
}
