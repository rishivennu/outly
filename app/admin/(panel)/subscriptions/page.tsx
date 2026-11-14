import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { policyTarget } from "@/app/api/admin/subscriptions/_lib/policy-admin";
import { SubscriptionsAdmin } from "./_components/SubscriptionsAdmin";

export const metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

export default async function Subscriptions() {
  await requireAdmin("pricing");
  const [target, openFlags] = await Promise.all([policyTarget(), db.riskFlag.count({ where: { status: "open" } })]);
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Subscriptions"
        body="First-time and returning prices, the 7-day trial, repeat-offer checks and the margin on every paying subscriber. Prices are snapshotted when someone buys, so nothing here re-prices an existing subscriber."
      />
      <SubscriptionsAdmin target={target} openFlags={openFlags} />
    </>
  );
}
