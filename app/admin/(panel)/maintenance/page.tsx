import { requireAdmin } from "@/lib/admin/guard";
import { siteStatus, subscriberCounts } from "@/lib/site";
import { PageHead } from "@/components/admin/ui";
import { MaintenanceToggle } from "@/components/admin/MaintenanceToggle";

export const metadata = { title: "Maintenance" };
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  await requireAdmin("site");
  const [site, subscribers] = await Promise.all([siteStatus(), subscriberCounts()]);
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Maintenance mode"
        body="Close the site to new visitors and show a 'back soon' page. Members keep working."
      />
      <MaintenanceToggle initial={site} subscribers={subscribers} />
    </>
  );
}
