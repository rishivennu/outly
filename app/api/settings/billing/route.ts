import { json, route } from "@/lib/http";
import { billingSummary } from "@/lib/billing/summary";

/**
 * The native app's Settings > Billing & Subscription (components/settings/BillingCards.tsx) reads what the settings
 * page renders server-side. Inside someone else's workspace billing is the owner's, so `billing` is null and `owner`
 * names them (MemberBillingNote), exactly as app/(studio)/settings/page.tsx decides.
 */
export const GET = route(async (_req, { user }) => {
  const billing = user.actor ? null : await billingSummary(user.id, user.name, user.email);
  return json({ billing, owner: user.actor ? user.name : null }, { headers: { "cache-control": "no-store" } });
});
