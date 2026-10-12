import { json, route } from "@/lib/http";
import { referralSummary } from "@/lib/referral";
import { realUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { user }) => json(await referralSummary(realUserId(user))));
