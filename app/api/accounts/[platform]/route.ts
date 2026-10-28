import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { invalidateDashboards } from "@/lib/live";

/** Disconnect: tokens are deleted, not just hidden. `?id=` (1037) disconnects one account of several on a platform. */
export const DELETE = route(async (req, { user, params }) => {
  if (!isPlatform(params.platform)) throw new HttpError(404, "Unknown platform");
  if (user.actor) throw new HttpError(403, "Only the workspace owner can disconnect accounts.", "ROLE");
  const id = req.nextUrl.searchParams.get("id");
  const r = await db.socialAccount.deleteMany({ where: { userId: user.id, platform: params.platform, ...(id ? { id } : {}) } });
  if (id && !r.count) throw new HttpError(404, "That account is already gone.", "NOT_FOUND");
  invalidateDashboards(user.id);
  return json({ ok: true });
});
