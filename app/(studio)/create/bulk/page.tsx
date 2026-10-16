import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView } from "@/lib/services";
import { BulkPlanner } from "@/components/create/BulkPlanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan a batch" };

export default async function BulkPage() {
  const user = (await getCurrentUser())!;
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } } });
  return <BulkPlanner accounts={accounts.map(accountView)} tz={user.timezone || "UTC"} />;
}
