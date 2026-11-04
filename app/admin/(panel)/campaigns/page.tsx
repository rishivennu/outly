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
        body="Flash sales and promo offers. The popup shows once per visit to people the offer fits, priced from the live plan price; checkout checks the offer again and the invoice lists it as a discount."
      />
      <CampaignsPanel initial={await campaignsState()} />
    </>
  );
}
