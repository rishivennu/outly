import { requireAdmin } from "@/lib/admin/guard";
import { listPosts } from "@/lib/blog/posts";
import { PageHead } from "@/components/admin/ui";
import { Library } from "@/components/admin/blog/Library";

export const metadata = { title: "Blog library" };

export default async function BlogLibrary() {
  await requireAdmin("content");
  const posts = await listPosts({ take: 300 });
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Library" body="Every article the agent has written: pending, published and rejected. Open one to read, edit, publish or take it offline." />
      <Library posts={posts} />
    </>
  );
}
