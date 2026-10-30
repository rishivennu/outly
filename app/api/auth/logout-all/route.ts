import { destroySession, realUserId, revokeAllSessions } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { forgetAllDevices } from "@/lib/push/device";
import { forgetAllTrusted, forgetThisBrowser } from "@/lib/trusted-device";

/**
 * Sign out of every device: bump the person's token version, so all their existing cookies stop verifying.
 * realUserId (1027): inside a workspace user.id is the OWNER, so a teammate pressing this signed the owner out.
 */
export const POST = route(
  async (_req, { user }) => {
    await revokeAllSessions(realUserId(user));
    await forgetAllDevices(realUserId(user));
    await forgetAllTrusted(realUserId(user));
    await forgetThisBrowser();
    destroySession();
    return json({ ok: true });
  },
  { limit: [10, 60_000] },
);
