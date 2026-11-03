import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { normalizeDashboard } from "@/lib/dashboard-config";
import { PageHead } from "@/components/admin/ui";
import { DashboardStylePicker } from "@/components/admin/DashboardStylePicker";
import { InstallPromptSettings } from "@/components/admin/InstallPromptSettings";
import { normalizeInstall } from "@/lib/pwa-core";
import { WelcomeScreenSettings } from "@/components/admin/WelcomeScreenSettings";
import { normalizeWelcome } from "@/lib/pwa-welcome";

export const metadata = { title: "Dashboard style" };
export const dynamic = "force-dynamic";

export default async function DashboardStyleAdminPage() {
  await requireAdmin("site");
  const [cfg, install, welcome] = await Promise.all([getConfig("dashboard").then(normalizeDashboard), getConfig("install").then(normalizeInstall), getConfig("welcome").then(normalizeWelcome)]);
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Dashboard style"
        body="Pick which studio dashboard people see after they sign in: the classic Home, or the analytics dashboard. You can also let each person choose for themselves, and set when phones are offered Outlly on their Home Screen and what they see the first time they open it from there."
      />
      <div className="grid gap-5">
        <DashboardStylePicker initial={cfg} />
        <InstallPromptSettings initial={install} />
        <WelcomeScreenSettings initial={welcome} />
      </div>
    </>
  );
}
