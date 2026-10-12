import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { revalidatePath } from "next/cache";
import { invalidateFaq } from "@/lib/support/faq";
import { FaqInput } from "@/lib/admin/schemas";



export const POST = adminRoute("faq", async (req) => {
  const f = await db.faqItem.create({ data: FaqInput.parse(await req.json()) });
  invalidateFaq();
  revalidatePath("/help");
  return json({ item: f });
});
