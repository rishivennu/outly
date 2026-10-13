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
        body="One switch closes the site to new visitors and shows a 'back soon' page with a live countdown where they can leave their email. Members who joined before it started keep working and posting, and you can still use everything. Turning it off emails everyone who asked."
      />
      <MaintenanceToggle initial={site} subscribers={subscribers} />
    </>
  );
}
