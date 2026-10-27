import { destroySession, realUserId, revokeAllSessions } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { forgetAllDevices } from "@/lib/push/device";

/**
 * Sign out of every device: bump the person's token version, so all their existing cookies stop verifying.
 * realUserId (1027): inside a workspace user.id is the OWNER, so a teammate pressing this signed the owner out.
 */
export const POST = route(
  async (_req, { user }) => {
    await revokeAllSessions(realUserId(user));
    await forgetAllDevices(realUserId(user));
    destroySession();
    return json({ ok: true });
  },
  { limit: [10, 60_000] },
);
