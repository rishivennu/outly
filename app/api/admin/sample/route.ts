import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { clearSample, seedSample } from "@/lib/admin/sample";
import { invalidate } from "@/lib/cache";

export const POST = adminRoute("integrations", async () => {
  await seedSample();
  invalidate("admin:");
  return json({ ok: true });
}, [4, 60_000]);
export const DELETE = adminRoute("integrations", async () => {
  await clearSample();
  invalidate("admin:");
  return json({ ok: true });
}, [4, 60_000]);
