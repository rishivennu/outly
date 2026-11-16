import { HttpError, json, route } from "@/lib/http";
import { isPlatform } from "@/lib/domain";
import { platformIdeas } from "@/lib/live";
import { chargeAi } from "@/lib/ai-quota";
import { realUserId } from "@/lib/auth";
import { dashboardAccount, listProfiles } from "@/lib/profiles";

export const dynamic = "force-dynamic";
// The model can take a few seconds; the dashboard itself never waits for this.
export const maxDuration = 30;

/** Gemini coaching ideas for one platform, fetched by the dashboard after its numbers are on screen. */
export const GET = route(
  async (req, { user, params }) => {
    const p = params.platform ?? "";
    if (!isPlatform(p)) throw new HttpError(404, "We don't support that platform yet.");
    // 1172: ?account= names the profile on screen; an id this person cannot see falls back to their own default.
    const asked = req.nextUrl.searchParams.get("account");
    const own = asked ? (await listProfiles(user.id, user.scope)).find((x) => x.platform === p && x.id === asked)?.id : undefined;
    const picked = own ?? (await dashboardAccount(user, p));
    await chargeAi(realUserId(user), "ai", undefined, undefined, "content");
    return json({ suggestions: await platformIdeas(user.id, p, picked === "none" ? null : picked) });
  },
  { limit: [20, 60_000] },
);
