import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { normalizeDashboard } from "@/lib/dashboard-config";
import { PageHead } from "@/components/admin/ui";
import { DashboardStylePicker } from "@/components/admin/DashboardStylePicker";

export const metadata = { title: "Dashboard style" };
export const dynamic = "force-dynamic";

export default async function DashboardStyleAdminPage() {
  await requireAdmin("site");
  const cfg = normalizeDashboard(await getConfig("dashboard"));
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Dashboard style"
        body="Pick which studio dashboard people see after they sign in: the classic Home, or the analytics dashboard. You can also let each person choose for themselves."
      />
      <DashboardStylePicker initial={cfg} />
    </>
  );
}
