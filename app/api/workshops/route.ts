import { json, route } from "@/lib/http";
import type { SessionUser } from "@/lib/auth";
import { listPublicWorkshops, myWorkshops } from "@/lib/workshops/server";

/** Public list (the app and the /home card read it); `mine=1` adds the signed-in creator's registrations. */
export const GET = route(
  async (req, { user }) => {
    const list = await listPublicWorkshops();
    const me = user as SessionUser | null; // auth: false, so nobody may be signed in
    const mine = req.nextUrl.searchParams.get("mine") === "1" && me ? await myWorkshops(me.email) : undefined;
    return json({ ...list, ...(mine ? { mine } : {}) });
  },
  { auth: false, limit: [60, 60_000] },
);
