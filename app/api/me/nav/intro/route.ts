import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { patchUiPrefs } from "@/lib/ui-prefs";
import { NAV_INTRO_VERSION } from "@/lib/nav-config";

export const dynamic = "force-dynamic";

const Body = z.object({ state: z.enum(["dismissed", "tried"]) }).strict();

/**
 * R1291: the outcome of the "meet your new dock" card, saved on the account for this NAV_INTRO_VERSION, so no device
 * shows it again. "tried" also marks the dock tried.
 */
export const POST = route(
  async (req, { user }) => {
    const { state } = Body.parse(await req.json());
    const prefs = await patchUiPrefs(realUserId(user), (p) => ({ ...p, navIntro: { v: NAV_INTRO_VERSION, state, at: new Date().toISOString() }, ...(state === "tried" ? { navTried: true } : {}) }));
    return json({ intro: prefs.navIntro });
  },
  { limit: [30, 60_000] },
);
