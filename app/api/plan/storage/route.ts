import { json, route } from "@/lib/http";
import { storageUsage } from "@/lib/billing/entitlements";

export const dynamic = "force-dynamic";

/** The storage meter (1052), read fresh from the server so every device shows the same figures. */
export const GET = route(async (_req, { user }) => {
  const s = await storageUsage(user.id);
  return json(
    { plan: { slug: s.planSlug, name: s.planName }, usedBytes: s.usedBytes, limitBytes: s.limitBytes, remainingBytes: s.remainingBytes, over: s.over, pct: s.pct, label: s.label },
    { headers: { "cache-control": "no-store" } },
  );
});
