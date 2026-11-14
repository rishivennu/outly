import { z } from "zod";
import { revalidatePath } from "next/cache";
import { json, route } from "@/lib/http";
import { cancelTrial, startTrial, trialState, type TrialRefusal } from "@/lib/subscriptions/trial";

const Body = z.object({ action: z.enum(["start", "cancel"]), source: z.enum(["billing", "welcome"]).optional() }).strict();

const REFUSAL: Record<TrialRefusal, { status: number; error: string }> = {
  used: { status: 409, error: "The free trial has already been used for this account." },
  already_paid: { status: 409, error: "You already have a paid plan, so the trial isn't needed." },
  disabled: { status: 403, error: "Free trials aren't available right now." },
  needs_verification: { status: 403, error: "Please verify your WhatsApp number (or email) first, then start the trial." },
  risk_denied: { status: 403, error: "We can't offer a trial on this account. You can still subscribe, or ask us for a review." },
};

/** 1147: the 7-day trial for the signed-in creator. GET = state; POST start | cancel. */
export const GET = route(async (_req, { user }) => json(await trialState(user.id)));

export const POST = route(
  async (req, { user }) => {
    const body = Body.parse(await req.json());
    if (body.action === "cancel") {
      const r = await cancelTrial(user.id);
      if (!r.ok) return json({ error: "There's no active trial to cancel.", reason: "none", code: "NO_TRIAL" }, { status: 409 });
      revalidatePath("/billing");
      return json({ ok: true, trial: (await trialState(user.id)).trial });
    }
    const r = await startTrial({ userId: user.id, req, source: body.source ?? "billing" });
    if (!r.ok) {
      const m = REFUSAL[r.reason];
      return json({ error: m.error, reason: r.reason, code: r.reason.toUpperCase(), flagId: r.flagId ?? null }, { status: m.status });
    }
    revalidatePath("/billing");
    return json({ ok: true, trial: r.trial });
  },
  { limit: [10, 60_000] },
);
