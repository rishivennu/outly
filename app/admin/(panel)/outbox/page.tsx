import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { PageHead } from "@/components/admin/ui";
import { OutboxView } from "@/components/admin/OutboxView";

export const metadata = { title: "Email outbox" };

export default async function Outbox() {
  await requireAdmin("outbox");
  const [rows, cfg] = await Promise.all([db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }), getConfig("email")]);
  return (
    <>
      <PageHead
        eyebrow="Support"
        title="Email outbox"
        body={cfg.provider === "mock" ? "Email is in Mock mode: everything Outlly would send is captured here instead of being delivered. Switch to Resend in Integrations to send for real." : "Every email Outlly sent through Resend, with delivery status."}
      />
      <OutboxView rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
    </>
  );
}
