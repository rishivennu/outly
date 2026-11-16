import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/settings";
import { getPost } from "@/lib/blog/posts";
import { JobError, allowedLinks } from "@/lib/blog/job";
import { PageHead } from "@/components/admin/ui";
import { ReviewDesk } from "@/components/admin/blog/ReviewDesk";

export const metadata = { title: "Review article" };

export default async function Review(props: { params: Promise<{ id: string }> }) {
  await requireAdmin("content");
  const { id } = await props.params;
  const post = await getPost(id).catch((e) => {
    if (e instanceof JobError && e.status === 404) return null;
    throw e;
  });
  if (!post) notFound();
  const [cfg, links] = await Promise.all([getConfig("blog"), allowedLinks(id)]);
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Review & edit" body="Read it the way a visitor would, fix what needs fixing, then approve. Approve & Publish is the only way an article goes live; the server runs the quality checks again on every save and on publish." />
      <ReviewDesk initial={post} categories={cfg.categories} allowedLinks={links} siteUrl={env.APP_URL} />
    </>
  );
}
