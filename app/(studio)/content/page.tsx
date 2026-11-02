import { getCurrentUser } from "@/lib/auth";
import { postFilter } from "@/lib/profiles";
import { libraryCounts, libraryPage } from "@/lib/posts/library";
import { ContentLibrary } from "@/components/content/ContentLibrary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content" };

/** 1091: first page only (48 posts); the rest arrive through "Load more" (see lib/posts/library.ts). */
export default async function ContentPage() {
  const user = (await getCurrentUser())!;
  const { where } = await postFilter(user);
  const [page, counts] = await Promise.all([libraryPage(user, null, undefined, where), libraryCounts(user, where)]);
  return <ContentLibrary initial={page.posts} views={page.views} counts={counts} nextCursor={page.nextCursor} />;
}
