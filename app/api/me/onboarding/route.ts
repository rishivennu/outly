import { z } from "zod";
import { json, route } from "@/lib/http";
import { ONBOARDING_STEPS } from "@/lib/onboarding-core";
import { onboardingFor, updateOnboarding } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

const patch = z.union([
  z.object({ step: z.enum(ONBOARDING_STEPS), status: z.enum(["done", "skipped"]) }).strict(),
  z.object({ action: z.enum(["finish", "dismiss", "reset"]) }).strict(),
]);

/** Phase 2: the guided onboarding's progress, saved on the account so it never repeats on another device. */
export const GET = route(async (_req, { user }) => json({ onboarding: await onboardingFor(user) }, { headers: { "Cache-Control": "private, no-store" } }), { limit: [60, 60_000] });

export const PATCH = route(async (req, { user }) => {
  const body = patch.parse(await req.json());
  return json({ onboarding: await updateOnboarding(user, body) });
}, { limit: [60, 60_000] });
