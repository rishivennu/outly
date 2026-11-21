import { json, route } from "@/lib/http";
import { billingUsage } from "@/lib/billing/plan-view";

/** 1096 usage meter: this period's posts, X posts, AI-captioned videos, replies and storage, with top-up credits. */
export const GET = route(async (_req, { user }) => json(await billingUsage(user.id)));
