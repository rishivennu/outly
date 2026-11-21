import { z } from "zod";
import { cookies } from "next/headers";
import { HttpError, json, route } from "@/lib/http";
import { env } from "@/lib/env";
import { realUserId } from "@/lib/auth";
import { getConfig } from "@/lib/settings";
import { patchUiPrefs } from "@/lib/ui-prefs";
import { NAV_COOKIE, NAV_STYLES, normalizeNav } from "@/lib/nav-config";
import { navFor } from "@/lib/nav-style";

export const dynamic = "force-dynamic";

const Body = z.object({ style: z.enum(NAV_STYLES) }).strict();

const cookieOpts = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 365 * 86400 };

/** R1294: the navigation in force for this person and whether the admin has set it for everyone (what POST answers 403 to). */
export const GET = route(async () => {
  const nav = await navFor();
  return json({ style: nav.style, locked: !nav.canSwitch, own: nav.own }, { headers: { "cache-control": "no-store" } });
});

/**
 * This person's own navigation (R1290), saved on their account since R1291 so it follows them to every device. The
 * cookie is kept in step as this browser's fast path. Only while the admin lets people switch. Picking the dock
 * once also marks it tried, so the "meet your new dock" card never returns after they switch back.
 */
export const POST = route(
  async (req, { user }) => {
    const { style } = Body.parse(await req.json());
    const cfg = normalizeNav(await getConfig("nav"));
    if (!cfg.userSwitch) throw new HttpError(403, "The navigation is set for everyone right now.", "locked");
    await patchUiPrefs(realUserId(user), (p) => ({ ...p, nav: style, ...(style === "dock" ? { navTried: true } : {}) }));
    (await cookies()).set(NAV_COOKIE, style, cookieOpts);
    return json({ style });
  },
  { limit: [30, 60_000] },
);

/** Back to the workspace default: forget this person's pick (account and this browser). */
export const DELETE = route(
  async (_req, { user }) => {
    await patchUiPrefs(realUserId(user), ({ nav: _n, ...rest }) => rest);
    (await cookies()).delete(NAV_COOKIE);
    return json({ style: normalizeNav(await getConfig("nav")).style });
  },
  { limit: [30, 60_000] },
);
