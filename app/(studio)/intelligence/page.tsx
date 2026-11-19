import { getCurrentUser } from "@/lib/auth";
import { analyticsScope } from "@/lib/profiles";
import { overview } from "@/lib/intelligence/service";
import { IntelligenceView } from "@/components/intelligence/IntelligenceView";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: "Content Intelligence" };
}

/**
 * R1238: Content Intelligence. The first read is computed on the server so the page paints with real numbers; the
 * client switches windows and objectives through /api/intelligence/overview. A failed read is not fatal: the view
 * fetches it itself, so one slow query never costs the whole page.
 */
export default async function IntelligencePage(props: { searchParams: Promise<{ account?: string }> }) {
  const search = await props.searchParams;
  const user = (await getCurrentUser())!;
  const account = typeof search.account === "string" && search.account.length <= 64 ? search.account : null;
  const initial = await analyticsScope(user, account)
    .then((accountIds) => overview(user, { days: 28, accountIds }))
    .catch(() => null);
  return <IntelligenceView initial={initial} account={account} />;
}
