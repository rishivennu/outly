import { json, route } from "@/lib/http";
import { reconcileUser } from "@/lib/posts/reconcile";

export const dynamic = "force-dynamic";

/**
 * R1219: the Content library's "Sync now". Checks the live posts most in need of it (flagged, then never checked,
 * then the oldest check), 25 at a time, at most once a minute per workspace. Deleted-on-platform is only recorded
 * after a second miss, so one tap never rewrites history.
 */
export const POST = route(async (_req, { user }) => json({ sync: await reconcileUser(user.id) }), { limit: [20, 60_000] });
