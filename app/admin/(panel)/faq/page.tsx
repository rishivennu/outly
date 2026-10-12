import { requireAdmin } from "@/lib/admin/guard";
import { FAQ_CATEGORIES, listFaq } from "@/lib/support/faq";
import { PageHead } from "@/components/admin/ui";
import { FaqEditor } from "@/components/admin/FaqEditor";

export const metadata = { title: "FAQ" };

export default async function Faq() {
  await requireAdmin("faq");
  const items = await listFaq({ all: true });
  return (
    <>
      <PageHead eyebrow="Support" title="FAQ & knowledge base" body={<>Shown on <a href="/help" target="_blank" className="underline underline-offset-4">/help</a> and used by Pip to answer chat questions, so a good answer here means fewer tickets. Changes are live immediately.</>} />
      <FaqEditor categories={[...FAQ_CATEGORIES]} initial={items.map((i) => ({ id: i.id, category: i.category, question: i.question, answer: i.answer, published: i.published, sortOrder: i.sortOrder }))} />
    </>
  );
}
