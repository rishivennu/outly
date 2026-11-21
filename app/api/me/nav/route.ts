import { z } from "zod";
import { cookies } from "next/headers";
import { HttpError, json, route } from "@/lib/http";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/settings";
import { NAV_COOKIE, NAV_STYLES, normalizeNav } from "@/lib/nav-config";

export const dynamic = "force-dynamic";

const Body = z.object({ style: z.enum(NAV_STYLES) }).strict();

/** This browser's own desktop navigation (R1290). Only while the admin lets people switch. */
export const POST = route(
  async (req) => {
    const { style } = Body.parse(await req.json());
    const cfg = normalizeNav(await getConfig("nav"));
    if (!cfg.userSwitch) throw new HttpError(403, "The navigation is set for everyone right now.", "locked");
    (await cookies()).set(NAV_COOKIE, style, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
    return json({ style });
  },
  { limit: [30, 60_000] },
);

/** Back to the workspace default: forget this browser's pick. */
export const DELETE = route(
  async () => {
    (await cookies()).delete(NAV_COOKIE);
    return json({ style: normalizeNav(await getConfig("nav")).style });
  },
  { limit: [30, 60_000] },
);
