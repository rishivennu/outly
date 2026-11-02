import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { accountView } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Connected accounts (1095: a disconnected one is no longer listed as if it were still here; see `previous`). */
export const GET = route(async (_req, { user }) => {
  const rows = await db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return json({
    accounts: rows.filter((a) => a.status !== "disconnected").map(accountView),
    previous: rows.filter((a) => a.status === "disconnected").map((a) => ({ id: a.id, platform: a.platform, username: a.username })),
  });
});
