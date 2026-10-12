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
        body="One switch takes the whole site offline for customers and shows a 'back soon' page where visitors can leave their email. You stay signed in here and can still use the site. Turning it off emails everyone who asked."
      />
      <MaintenanceToggle initial={site} subscribers={subscribers} />
    </>
  );
}
