import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { accountAuth, accountView } from "@/lib/services";
import { entitlements } from "@/lib/billing/entitlements";
import { canConnectWithToken, hasCredentials, liveNow, practiceAllowed } from "@/lib/social/registry";
import { PLATFORMS } from "@/lib/domain";

export const dynamic = "force-dynamic";

/**
 * Connected accounts (1095: a disconnected one is no longer listed as if it were still here; see `previous`).
 * R-APP6: also the props app/(studio)/accounts/page.tsx passes AccountsView (live platforms, how each one can be
 * connected, plan limits), so the native app's Accounts screen can draw the same page.
 */
export const GET = route(async (_req, { user }) => {
  const [rows, ent, live] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    entitlements(user.id),
    liveNow(), // refreshes the key snapshot, so hasCredentials below reads fresh keys
  ]);
  return json({
    accounts: rows.filter((a) => a.status !== "disconnected").map((a) => ({ ...accountView(a), ...accountAuth(a) })),
    previous: rows.filter((a) => a.status === "disconnected").map((a) => ({ id: a.id, platform: a.platform, username: a.username })),
    live,
    setup: Object.fromEntries(PLATFORMS.map((p) => [p, { oauth: hasCredentials(p), token: canConnectWithToken(p), practice: practiceAllowed() }])),
    accountLimit: ent.accountLimit > 0 ? ent.accountLimit : ent.brandLimit + ent.extraBrands > 1 ? (ent.brandLimit + ent.extraBrands) * PLATFORMS.length : 0,
    brands: ent.brandLimit > 0 ? ent.brandLimit + ent.extraBrands : 0,
    platformLimit: ent.platformLimit,
  });
});
