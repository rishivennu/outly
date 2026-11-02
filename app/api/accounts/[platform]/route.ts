import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { invalidateDashboards } from "@/lib/live";
import { disconnectAccounts } from "@/lib/accounts";
import { ACCOUNT_ID } from "@/lib/connect-decision";

/**
 * Disconnect (1095): the keys are wiped (and revoked at the platform where it allows that), the account is
 * marked disconnected, and its posts, analytics and messages stay. `?id=` (1037) disconnects one account of
 * several on a platform; without it, every connected account on the platform.
 */
export const DELETE = route(async (req, { user, params }) => {
  if (!isPlatform(params.platform)) throw new HttpError(404, "Unknown platform");
  if (user.actor) throw new HttpError(403, "Only the workspace owner can disconnect accounts.", "ROLE");
  const id = req.nextUrl.searchParams.get("id");
  if (id && !ACCOUNT_ID.test(id)) throw new HttpError(404, "That account is already gone.", "NOT_FOUND");
  const n = await disconnectAccounts(user.id, params.platform, id);
  if (id && !n) throw new HttpError(404, "That account is already disconnected.", "NOT_FOUND");
  invalidateDashboards(user.id);
  return json({ ok: true, disconnected: n });
});
