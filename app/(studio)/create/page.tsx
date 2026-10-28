import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView, ownedPost, postView, type PostView } from "@/lib/services";
import { composerAccounts } from "@/lib/profiles";
import { CreateWorkspace } from "@/components/create/CreateWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create" };

export default async function CreatePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = (await getCurrentUser())!;
  let post: PostView | null = null;
  // 1037: one account per platform, the one this post is pinned to, else the picked profile, else the default;
  // a member only ever gets accounts they were given.
  const pinned: Record<string, string | null> = {};
  if (searchParams.post) {
    try {
      const raw = await ownedPost(user.id, searchParams.post);
      for (const t of raw.targets) pinned[t.platform] = t.socialAccountId;
      post = await postView(raw);
    } catch {
      post = null;
    }
  }
  const accounts = await composerAccounts(user, pinned);
  // A story to start from: text shared from another app, or an idea picked from the idea bank on Home.
  let initialStory: string | null = null;
  if (!post && searchParams.idea) {
    const idea = await db.idea.findFirst({ where: { id: searchParams.idea, userId: user.id }, select: { text: true } });
    initialStory = idea?.text ?? null;
  } else if (!post && searchParams.text) initialStory = searchParams.text.slice(0, 600);
  return (
    <CreateWorkspace
      key={post?.id ?? searchParams.local ?? searchParams.idea ?? "new"}
      accounts={accounts.map(accountView)}
      initialPost={post}
      tz={user.timezone}
      connected={searchParams.connected ?? null}
      connectError={searchParams.connect_error ?? null}
      initialStory={initialStory}
      shared={searchParams.shared ?? null}
      restoreLocal={post ? null : (searchParams.local ?? null)}
      missingPostId={!post && searchParams.post ? searchParams.post : null}
    />
  );
}
