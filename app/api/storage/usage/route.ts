import { json, route } from "@/lib/http";
import { storageUsageFor } from "@/lib/storage/quota";

export const dynamic = "force-dynamic";

/** R1209: the live upload allowance and storage figures (lib/storage/quota.ts). */
export const GET = route(async (_req, { user }) => json(await storageUsageFor(user.id)), { limit: [240, 60_000] });
