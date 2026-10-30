import { getCurrentUser } from "@/lib/auth";
import { connectedPlatforms } from "@/lib/live/connected";
import { AnalyticsTabsBar } from "@/components/analytics/PlatformTabs";

/**
 * Analytics keeps its tab bar here (1065), above the loading boundary: switching Overview, Instagram,
 * YouTube and the rest only swaps the view below it (with a short slide in the tab's direction), so the bar
 * never flashes back to a loader. Still a server component; the pages under it are unchanged.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const user = (await getCurrentUser())!;
  const connected = await connectedPlatforms(user.id);
  return (
    <>
      <AnalyticsTabsBar connected={connected} />
      {children}
    </>
  );
}
