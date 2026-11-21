import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { normalizeDashboard } from "@/lib/dashboard-config";
import { normalizeNav } from "@/lib/nav-config";
import { PageHead } from "@/components/admin/ui";
import { DashboardStylePicker } from "@/components/admin/DashboardStylePicker";
import { NavStylePicker } from "@/components/admin/NavStylePicker";
import { InstallPromptSettings } from "@/components/admin/InstallPromptSettings";
import { normalizeInstall } from "@/lib/pwa-core";
import { WelcomeScreenSettings } from "@/components/admin/WelcomeScreenSettings";
import { normalizeWelcome } from "@/lib/pwa-welcome";

export const metadata = { title: "Dashboard style" };
export const dynamic = "force-dynamic";

export default async function DashboardStyleAdminPage() {
  await requireAdmin("site");
  const [cfg, nav, install, welcome] = await Promise.all([getConfig("dashboard").then(normalizeDashboard), getConfig("nav").then(normalizeNav), getConfig("install").then(normalizeInstall), getConfig("welcome").then(normalizeWelcome)]);
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Dashboard style"
        body="Pick which dashboard and desktop navigation people see after they sign in, and what phones are offered."
      />
      <div className="grid gap-5">
        <DashboardStylePicker initial={cfg} />
        <section aria-labelledby="nav-h" className="grid gap-3">
          <h2 id="nav-h" className="mt-3 text-[18px] font-semibold">Navigation</h2>
          <NavStylePicker initial={nav} />
        </section>
        <InstallPromptSettings initial={install} />
        <WelcomeScreenSettings initial={welcome} />
      </div>
    </>
  );
}
