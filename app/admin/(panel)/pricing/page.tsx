import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { listPlans } from "@/lib/billing/plans";
import { getConfig } from "@/lib/settings";
import { normalizeDisplay } from "@/lib/billing/display";
import { PageHead } from "@/components/admin/ui";
import { PricingEditor } from "@/components/admin/PricingEditor";

export const metadata = { title: "Pricing" };

export default async function Pricing() {
  await requireAdmin("pricing");
  const plans = await listPlans({ includeHidden: true });
  const [subs, pays, display] = await Promise.all([
    db.subscription.groupBy({ by: ["planId"], where: { status: "active" }, _count: true }),
    db.payment.groupBy({ by: ["planId"], _count: true }),
    getConfig("pricing").then(normalizeDisplay),
  ]);
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Pricing"
        body="Edit a plan and save: the website, checkout and billing page use the new price on the very next request. People already subscribed keep the price they paid until they change plan."
      />
      <PricingEditor
        display={display}
        initial={plans.map((p) => ({ ...p, subscribers: subs.find((s) => s.planId === p.id)?._count ?? 0, locked: (pays.find((s) => s.planId === p.id)?._count ?? 0) > 0 }))}
      />
    </>
  );
}
