import { currentSessionId, endSession, getCurrentUser } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { forgetThisDevice } from "@/lib/push/device";
import { endSessions, track } from "@/lib/analytics/activity";
import { realUserId } from "@/lib/auth";
import { forgetThisBrowser } from "@/lib/trusted-device";

export const POST = route(async () => {
  // R1308: the usage session closes with the sign-in; never blocks sign-out.
  try {
    const [u, sid] = await Promise.all([getCurrentUser(), currentSessionId()]);
    if (u) {
      track("logout", realUserId(u), undefined, { key: sid });
      await endSessions(realUserId(u), sid);
    }
  } catch {}
  await forgetThisDevice();
  await forgetThisBrowser(); // signing out also un-remembers this device (1053)
  await endSession(); // 1080: its Active sessions row goes too
  return json({ ok: true });
}, { auth: false });
