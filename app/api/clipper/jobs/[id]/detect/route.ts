import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { assertAiCaptions } from "@/lib/billing/entitlements";
import { chargeAi } from "@/lib/ai-quota";
import { activeAiGrant } from "@/lib/ai/entitlements";
import { gemini } from "@/lib/ai/creative";
import { env } from "@/lib/env";
import { detect, type AskJson } from "@/lib/clipper/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * R1321: find the moments worth a clip. With a Gemini key (and the AI entitlement, or an Unlimited AI grant on
 * "other") the model reads the transcript; without one the rule detector runs, and the response says so in
 * `source`. Either way the ranking is deterministic (candidates-core) and every candidate carries its reason.
 */
export const POST = route(
  async (_req, { user, params }) => {
    const uid = realUserId(user);
    let ask: AskJson | null = null;
    if (env.GEMINI_API_KEY) {
      const allowed = (await activeAiGrant(user.id, "other")) || (await assertAiCaptions(user.id).then(() => true, () => false));
      if (allowed) {
        await chargeAi(uid, "ai", undefined, undefined, "other");
        ask = (system, prompt) => gemini<unknown>(system, prompt, { temperature: 0.4, timeoutMs: 30_000, models: ["gemini-3.6-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"], meter: { feature: "clipper", userId: uid } });
      }
    }
    return json(await detect(user.id, params.id, { ask, actor: { id: uid, role: user.role } }));
  },
  { limit: [10, 60_000] },
);
