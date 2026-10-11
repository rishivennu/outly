import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { accountView } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user }) => {
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return json({ accounts: accounts.map(accountView) });
});
