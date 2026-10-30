import { realUserId } from "@/lib/auth";
import { HttpError, json, route } from "@/lib/http";
import { forgetAllTrusted, listTrusted, revokeTrusted } from "@/lib/trusted-device";

export const dynamic = "force-dynamic";

/** Remembered devices (1053), for Settings > Security. Always the person signed in, not the workspace owner. */
export const GET = route(async (_req, { user }) => json({ devices: await listTrusted(realUserId(user)) }));

/** DELETE ?id=… forgets one device; DELETE ?all=1 forgets them all. Either way they ask for the second step again. */
export const DELETE = route(
  async (req, { user }) => {
    const me = realUserId(user);
    const sp = req.nextUrl.searchParams;
    if (sp.get("all") === "1") {
      await forgetAllTrusted(me);
      return json({ devices: [] });
    }
    const id = sp.get("id") ?? "";
    if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new HttpError(400, "Pick a device to forget.", "bad_id");
    if (!(await revokeTrusted(me, id))) throw new HttpError(404, "That device was already forgotten.", "gone");
    return json({ devices: await listTrusted(me) });
  },
  { limit: [30, 60_000] },
);
