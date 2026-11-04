import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAdmin } from "@/lib/admin/auth";
import { can } from "@/lib/admin/perms";
import { invoicePdf } from "@/lib/billing/invoice";
import { rateLimit } from "@/lib/rate-limit";

/** PDF for the invoice owner, or an admin with access to payments. Anyone else gets a 404, not a 403. */
export async function GET(_req: NextRequest, props: { params: Promise<{ number: string }> }) {
  const params = await props.params;
  const inv = await db.invoice.findUnique({ where: { number: params.number } });
  const [user, admin] = await Promise.all([getCurrentUser(), getAdmin()]);
  // Billing belongs to the workspace owner (1048): inside a team workspace getCurrentUser() IS the owner, so a
  // teammate (actor set) must not pass the owner check. Same rule as the Billing page.
  const owner = !!user && !user.actor && user.id === inv?.userId;
  if (!inv || !(owner || can(admin?.role, "payments"))) return new Response("Not found", { status: 404 });
  // 1121: each download renders the PDF (fonts + art), so one person can't loop it.
  const rl = rateLimit(`invoice-pdf:${admin?.id ?? user?.id}`, 20, 60_000);
  if (!rl.ok) return new Response("Too many downloads. Try again in a minute.", { status: 429, headers: { "retry-after": String(rl.retryAfter ?? 60) } });
  const pdf = await invoicePdf(inv.id);
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${inv.number}.pdf"`, "cache-control": "private, no-store" },
  });
}
