import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getAdmin } from "@/lib/admin/auth";
import { can } from "@/lib/admin/perms";
import { creditNotePdf } from "@/lib/billing/credit-note";

/** Credit note PDF (1049): the workspace owner (never a teammate) or an admin with payments access. Anyone else: 404. */
export async function GET(_req: NextRequest, { params }: { params: { number: string } }) {
  const cn = await db.creditNote.findUnique({ where: { number: params.number } });
  const [user, admin] = await Promise.all([getCurrentUser(), getAdmin()]);
  const owner = !!user && !user.actor && user.id === cn?.userId;
  if (!cn || !(owner || can(admin?.role, "payments"))) return new Response("Not found", { status: 404 });
  const pdf = await creditNotePdf(cn.id);
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${cn.number}.pdf"`, "cache-control": "private, no-store" },
  });
}
