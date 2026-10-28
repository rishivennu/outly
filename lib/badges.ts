import "server-only";
import { cache } from "react";
import { db } from "./db";
import { entitlements } from "./billing/entitlements";
import { isProven } from "./founding";
import { isVerifiedManager, type TrustBadges } from "./badges-core";

/** The badges a workspace owner has earned. Three cheap queries, once per request. */
export const trustBadges = cache(async (ownerId: string): Promise<TrustBadges> => {
  const [u, ent, accounts] = await Promise.all([
    db.user.findUnique({ where: { id: ownerId }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true, foundingNo: true } }),
    entitlements(ownerId),
    db.socialAccount.count({ where: { userId: ownerId, status: { not: "disconnected" } } }),
  ]);
  if (!u) return { foundingNo: null, verifiedManager: false };
  return { foundingNo: u.foundingNo ?? null, verifiedManager: isVerifiedManager({ planSlug: ent.planSlug, proven: isProven(u), accounts }) };
});
