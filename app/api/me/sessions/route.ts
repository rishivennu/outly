import { realUserId } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";
import { legacyWindowOpen, listSessions, revokeOtherSessions, revokeSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/** Active sessions (1080). Always the person signed in, not the workspace owner. */
export const GET = route(async (_req, { user }) => json({ sessions: await listSessions(realUserId(user)), legacyNote: legacyWindowOpen() }));

/** DELETE ?id=… signs one other device out; DELETE ?others=1 signs out every device but this one. */
export const DELETE = route(
  async (req, { user }) => {
    const me = realUserId(user);
    const sp = req.nextUrl.searchParams;
    if (sp.get("others") === "1") {
      const n = await revokeOtherSessions(me);
      return json({ sessions: await listSessions(me), signedOut: n, legacyNote: false });
    }
    const id = sp.get("id") ?? "";
    if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new HttpError(400, "Pick a session to sign out.", "bad_id");
    const r = await revokeSession(me, id);
    if (r === "current") throw new HttpError(400, "That's this device. Use Sign out to leave it.", "current");
    if (r === "gone") throw new HttpError(404, "That session had already ended.", "gone");
    return json({ sessions: await listSessions(me), legacyNote: legacyWindowOpen() });
  },
  { limit: [30, 60_000] },
);
