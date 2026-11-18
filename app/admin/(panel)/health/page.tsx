import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { SystemHealth } from "@/components/admin/health/SystemHealth";

export const metadata = { title: "System Health" };
export const dynamic = "force-dynamic";

/**
 * R1195: the Watchdog's screen. Everything on it comes from recorded checks and incidents (the admin API); the
 * monitoring itself runs on the server from the minute cron, with or without this page open.
 */
export default async function Health() {
  const a = await requireAdmin("health");
  return (
    <>
      <PageHead tight eyebrow="Run" title="System Health" body="What the Watchdog checked, what is failing and who is on it. Super admins are alerted even when it is closed." />
      <SystemHealth me={{ id: a.id, name: a.name }} role={a.role} />
    </>
  );
}
