import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { adjustQuota, adminStorageFor } from "@/lib/admin/storage";
import { fmtBytes } from "@/lib/storage/quota-core";

export const dynamic = "force-dynamic";

/** R1209: one account's storage and upload allowance for the admin Users page. ?userId= or ?email=. */
export const GET = adminRoute("users", async (req) => {
  const p = req.nextUrl.searchParams;
  return json(await adminStorageFor({ userId: p.get("userId")?.slice(0, 40), email: p.get("email")?.slice(0, 200) }));
});

const Adjust = z.object({
  userId: z.string().trim().min(1).max(40),
  action: z.enum(["extra", "reset"]),
  mb: z.number().int().min(1).max(1_048_576).optional(),
  note: z.string().trim().min(3, "Say why, in a few words.").max(500),
});

/** A manual change for this cycle only, written to AuditLog. Giving away allowance is a plans decision. */
export const POST = adminRoute("plans", async (req, { admin }) => {
  const b = Adjust.parse(await req.json());
  const r = await adjustQuota(b, { login: admin.login, role: admin.role });
  await adminEvent("grant", `${admin.name} ${b.action === "extra" ? `added ${fmtBytes(r.adjustment.bytes)} upload allowance` : "reset the upload allowance"}`, b.note, `/admin/users`);
  return json({ ...r, storage: await adminStorageFor({ userId: b.userId }) });
}, [30, 60_000]);
