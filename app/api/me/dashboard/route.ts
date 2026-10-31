import { z } from "zod";
import { cookies } from "next/headers";
import { HttpError, json, route } from "@/lib/http";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/settings";
import { DASH_COOKIE, DASHBOARD_STYLES, normalizeDashboard } from "@/lib/dashboard-config";

export const dynamic = "force-dynamic";

const Body = z.object({ style: z.enum(DASHBOARD_STYLES) }).strict();

/** This browser's own dashboard pick (1080). Only while the admin lets people switch. */
export const POST = route(
  async (req) => {
    const { style } = Body.parse(await req.json());
    const cfg = normalizeDashboard(await getConfig("dashboard"));
    if (!cfg.userSwitch) throw new HttpError(403, "The dashboard style is set for everyone right now.", "locked");
    cookies().set(DASH_COOKIE, style, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 365 * 86400 });
    return json({ style });
  },
  { limit: [30, 60_000] },
);
