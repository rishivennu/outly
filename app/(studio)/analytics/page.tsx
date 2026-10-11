import { getCurrentUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { connectedPlatforms } from "@/lib/live/connected";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = (await getCurrentUser())!;
  const [initial, connected] = await Promise.all([getAnalytics(user.id, 30), connectedPlatforms(user.id)]);
  return <AnalyticsView initial={initial} connected={connected} />;
}
