import { reviewPackage } from "@/lib/review";
import { ReviewPage } from "@/components/review/ReviewPage";

export const dynamic = "force-dynamic";
// A review link is a secret. Keep it out of every index.
export const metadata = { title: "Review this post", robots: { index: false, follow: false, nocache: true } };

export default async function Page({ params }: { params: { token: string } }) {
  const data = await reviewPackage(params.token);
  if (!data)
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">This link doesn&apos;t work any more.</h1>
        <p className="mt-2 text-muted-foreground">It may have been replaced by a newer one, or the post was removed. Ask whoever sent it for a fresh link.</p>
      </Shell>
    );
  return (
    <Shell>
      <ReviewPage token={params.token} data={data} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <p className="eyebrow mb-3">Review</p>
      {children}
    </main>
  );
}
