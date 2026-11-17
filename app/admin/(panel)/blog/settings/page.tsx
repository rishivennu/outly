import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { blogModelLabel, blogReady, blogWebReady } from "@/lib/blog/llm";
import { PageHead } from "@/components/admin/ui";
import { BlogSettingsForm } from "@/components/admin/blog/BlogSettingsForm";

export const metadata = { title: "Blog settings" };

export default async function BlogSettings() {
  await requireAdmin("content");
  const cfg = await getConfig("blog");
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Blog settings" body="Audience, tone, schedule, and the topics it must never write about." />
      <BlogSettingsForm initial={cfg} ready={blogReady()} web={blogWebReady()} modelLabel={blogModelLabel()} />
    </>
  );
}
