import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isPlatform, PLATFORM_META } from "@/lib/domain";
import { platformDashboard } from "@/lib/live";
import { connectedPlatforms } from "@/lib/live/connected";
import { PlatformDashboardView } from "@/components/analytics/PlatformDashboardView";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { platform: string } }) {
  return { title: isPlatform(params.platform) ? `${PLATFORM_META[params.platform].name} analytics` : "Analytics" };
}

export default async function PlatformAnalyticsPage({ params }: { params: { platform: string } }) {
  if (!isPlatform(params.platform)) notFound();
  const user = (await getCurrentUser())!;
  const [initial, connected] = await Promise.all([platformDashboard(user.id, params.platform), connectedPlatforms(user.id)]);
  return <PlatformDashboardView key={params.platform} platform={params.platform} initial={initial} connected={connected} />;
}
