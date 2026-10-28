import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView } from "@/lib/services";
import { BulkPlanner } from "@/components/create/BulkPlanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan a batch" };

export default async function BulkPage() {
  const user = (await getCurrentUser())!;
  // Every account this person may post to (a member only theirs), oldest first, so a manager can pick several.
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" }, ...(user.scope ? { id: { in: user.scope } } : {}) }, orderBy: { createdAt: "asc" } });
  return <BulkPlanner accounts={accounts.map(accountView)} tz={user.timezone || "UTC"} />;
}
