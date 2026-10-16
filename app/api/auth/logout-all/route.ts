import { destroySession, revokeAllSessions } from "@/lib/auth";
import { json, route } from "@/lib/http";

/** Sign out of every device: bump the user's token version, so all existing cookies stop verifying. */
export const POST = route(
  async (_req, { user }) => {
    await revokeAllSessions(user.id);
    destroySession();
    return json({ ok: true });
  },
  { limit: [10, 60_000] },
);
