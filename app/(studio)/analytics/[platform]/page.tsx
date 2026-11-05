import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isPlatform, PLATFORM_META } from "@/lib/domain";
import { platformDashboard } from "@/lib/live";
import { dashboardAccount } from "@/lib/profiles";
import { connectedPlatforms } from "@/lib/live/connected";
import { PlatformDashboardView } from "@/components/analytics/PlatformDashboardView";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ platform: string }> }) {
  const params = await props.params;
  return { title: isPlatform(params.platform) ? `${PLATFORM_META[params.platform].name} analytics` : "Analytics" };
}

export default async function PlatformAnalyticsPage(props: { params: Promise<{ platform: string }>; searchParams: Promise<{ account?: string }> }) {
  const [params, search] = await Promise.all([props.params, props.searchParams]);
  if (!isPlatform(params.platform)) notFound();
  const user = (await getCurrentUser())!;
  // 1140: ?account= opens one of several accounts on this platform. The API re-checks it belongs to you.
  const asked = typeof search.account === "string" && search.account.length <= 64 ? search.account : null;
  const [initial, connected] = await Promise.all([dashboardAccount(user, params.platform).then((accountId) => platformDashboard(user.id, params.platform as never, { accountId })), connectedPlatforms(user.id)]);
  return <PlatformDashboardView key={params.platform} platform={params.platform} initial={initial} connected={connected} renderedAt={Date.now()} focusAccount={asked} />;
}
