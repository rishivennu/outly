import { z } from "zod";
import { json, route } from "@/lib/http";
import { assertBurnCaptions } from "@/lib/billing/entitlements";
import { planLimits } from "@/lib/billing/plan-view";

export const dynamic = "force-dynamic";

/** What the signed-in workspace's plan allows right now. `null` = unlimited. */
export const GET = route(async (_req, { user }) => json(await planLimits(user.id)));

const Check = z.object({ feature: z.enum(["burn"]) });

/**
 * Asks before a client-side feature runs. 402 PLAN_LIMIT opens the upgrade popup.
 *
 * Honest about what this is: burn-in happens in the browser (canvas + MediaRecorder), so `burnCaptions` gates
 * Outlly's button, not the pixels. Someone editing the page could still burn text into their own video, the same
 * as any free video editor can, and no server check can prevent that. So the plan copy sells it as a feature of
 * the paid plans ("captions burned into the video"), never as something Outlly stops you doing elsewhere, and the
 * 402 message tells a Free user what they can still do today (post with the captions in the text).
 * Everything with a server-side cost -- posts, AI captions, replies, uploads, storage -- is enforced in
 * lib/billing/entitlements.ts on the action itself, not here.
 */
export const POST = route(async (req, { user }) => {
  Check.parse(await req.json());
  await assertBurnCaptions(user.id);
  return json({ ok: true });
});
