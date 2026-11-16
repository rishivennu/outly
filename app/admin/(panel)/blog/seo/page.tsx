import { requireAdmin } from "@/lib/admin/guard";
import { PageHead, Unavailable } from "@/components/admin/ui";

export const metadata = { title: "Blog SEO" };

export default async function BlogSeo() {
  await requireAdmin("content");
  return (
    <>
      <PageHead eyebrow="Content Studio" title="SEO performance" body="Clicks, impressions and position per article once Search Console is connected." />
      <Unavailable reason="Search Console is not connected yet. This page fills in once it is; nothing here is estimated." />
    </>
  );
}
