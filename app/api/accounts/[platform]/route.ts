import { db } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { invalidateDashboards } from "@/lib/live";

/** Disconnect: tokens are deleted, not just hidden. */
export const DELETE = route(async (_req, { user, params }) => {
  if (!isPlatform(params.platform)) throw new HttpError(404, "Unknown platform");
  await db.socialAccount.deleteMany({ where: { userId: user.id, platform: params.platform } });
  invalidateDashboards(user.id);
  return json({ ok: true });
});
