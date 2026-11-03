import { getCurrentUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { connectedPlatforms } from "@/lib/live/connected";
import { analyticsScope } from "@/lib/profiles";
import { entitlements } from "@/lib/billing/entitlements";
import { analyticsWindow, hasPerk } from "@/lib/billing/plan-rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

export default async function AnalyticsPage(props: { searchParams: Promise<{ account?: string }> }) {
  const searchParams = await props.searchParams;
  const user = (await getCurrentUser())!;
  const e = await entitlements(user.id);
  const w = analyticsWindow(e, 30);
  const [initial, connected] = await Promise.all([analyticsScope(user).then((ids) => getAnalytics(user.id, w.days, ids)), connectedPlatforms(user.id)]);
  return (
    <AnalyticsView
      initial={initial}
      connected={connected}
      focusAccount={searchParams.account?.slice(0, 64) ?? null}
      renderedAt={Date.now()}
      maxDays={w.maxDays}
      reports={{ csv: hasPerk(e, "csv-export"), pdf: hasPerk(e, "client-reports") }}
    />
  );
}
