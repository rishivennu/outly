import { db } from "@/lib/db";
import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { revalidatePath } from "next/cache";
import { invalidateFaq } from "@/lib/support/faq";
import { FaqInput } from "@/lib/admin/schemas";

export const PATCH = adminRoute<{ params: { id: string } }>("faq", async (req, { params }) => {
  const f = await db.faqItem.update({ where: { id: params.id }, data: FaqInput.partial().parse(await req.json()) }).catch(() => null);
  if (!f) throw new HttpError(404, "That question was deleted.", "NOT_FOUND");
  invalidateFaq();
  revalidatePath("/help");
  return json({ item: f });
});
export const DELETE = adminRoute<{ params: { id: string } }>("faq", async (_req, { params }) => {
  await db.faqItem.delete({ where: { id: params.id } }).catch(() => null);
  invalidateFaq();
  revalidatePath("/help");
  return json({ ok: true });
});
