import { getCurrentUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { connectedPlatforms } from "@/lib/live/connected";
import { analyticsScope } from "@/lib/profiles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: { account?: string } }) {
  const user = (await getCurrentUser())!;
  const [initial, connected] = await Promise.all([analyticsScope(user).then((ids) => getAnalytics(user.id, 30, ids)), connectedPlatforms(user.id)]);
  return <AnalyticsView initial={initial} connected={connected} focusAccount={searchParams.account?.slice(0, 64) ?? null} renderedAt={Date.now()} />;
}
