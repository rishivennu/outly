import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { accountView, ownedPost, postView, type PostView } from "@/lib/services";
import { CreateWorkspace } from "@/components/create/CreateWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create" };

export default async function CreatePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = (await getCurrentUser())!;
  const accounts = await db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } } });
  let post: PostView | null = null;
  if (searchParams.post) {
    try {
      post = await postView(await ownedPost(user.id, searchParams.post));
    } catch {
      post = null;
    }
  }
  return (
    <CreateWorkspace
      key={post?.id ?? "new"}
      accounts={accounts.map(accountView)}
      initialPost={post}
      tz={user.timezone}
      connected={searchParams.connected ?? null}
      connectError={searchParams.connect_error ?? null}
    />
  );
}
