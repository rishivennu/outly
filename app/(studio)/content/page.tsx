import { getCurrentUser } from "@/lib/auth";
import { postFilter } from "@/lib/profiles";
import { libraryCounts, libraryPage } from "@/lib/posts/library";
import { ContentLibrary } from "@/components/content/ContentLibrary";
import { PageFresh } from "@/components/shell/PageFresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content" };

/** 1091: first page only (48 posts); the rest arrive through "Load more" (see lib/posts/library.ts). */
export default async function ContentPage() {
  const user = (await getCurrentUser())!;
  const { where } = await postFilter(user);
  const [page, counts] = await Promise.all([libraryPage(user, null, undefined, where), libraryCounts(user, where)]);
  // 1114: may open from the background preload; brings itself up to date when that copy is 2 minutes old.
  return (
    <>
      <PageFresh renderedAt={Date.now()} maxAge={120_000} />
      <ContentLibrary initial={page.posts} views={page.views} counts={counts} nextCursor={page.nextCursor} />
    </>
  );
}
