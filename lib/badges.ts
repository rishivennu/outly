import "server-only";
import { cache } from "react";
import { db } from "./db";
import { entitlements } from "./billing/entitlements";
import { foundingBadgeNo, isProven } from "./founding";
import { isVerifiedManager, type TrustBadges } from "./badges-core";

/** The badges a workspace owner has earned. A few cheap queries, once per request. */
export const trustBadges = cache(async (ownerId: string): Promise<TrustBadges> => {
  const [u, ent, accounts, foundingNo] = await Promise.all([
    db.user.findUnique({ where: { id: ownerId }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true } }),
    entitlements(ownerId),
    db.socialAccount.count({ where: { userId: ownerId, status: { not: "disconnected" } } }),
    // 1067: a founding seat shows as a badge only once a real payment backs it (checked here, not in the UI).
    foundingBadgeNo(ownerId),
  ]);
  if (!u) return { foundingNo: null, verifiedManager: false };
  return { foundingNo, verifiedManager: isVerifiedManager({ planSlug: ent.planSlug, proven: isProven(u), accounts }) };
});
