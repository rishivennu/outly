import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { env } from "@/lib/env";
import { ACCT_COOKIE, listProfiles } from "@/lib/profiles";

export const dynamic = "force-dynamic";

const body = z.object({ id: z.string().cuid().nullable() });

/**
 * Pick the profile to work on (1037), or null for all of them. The pick is a cookie, so it survives reloads and
 * tabs; pages re-check it against what this person may see on every request, so a stale or forged id is ignored.
 */
export const POST = route(
  async (req, { user }) => {
    const { id } = body.parse(await req.json());
    const res = json({ ok: true, activeId: id });
    if (id === null) {
      res.cookies.set(ACCT_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }
    const p = (await listProfiles(user.id, user.scope)).find((x) => x.id === id);
    if (!p) throw new HttpError(404, "That profile isn't in this workspace any more.", "NOT_FOUND");
    res.cookies.set(ACCT_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 180, sameSite: "lax", httpOnly: true, secure: env.APP_URL.startsWith("https") });
    return res;
  },
  { limit: [120, 60_000] },
);
