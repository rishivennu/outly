import { getCurrentUser } from "@/lib/auth";
import { analyticsScope } from "@/lib/profiles";
import { intelligenceAccess } from "@/lib/intelligence/entitlements";
import { overview } from "@/lib/intelligence/service";
import { outcomesFor } from "@/lib/intelligence/outcome";
import { hasOutcomeLine } from "@/components/intelligence/view-core";
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
  // R1248: the accepted cards' outcomes come with the first paint (one server read, no client round trip).
  const accepted = initial?.recommendations.filter((r) => hasOutcomeLine(r.status)).map((r) => r.id) ?? [];
  const initialOutcomes = accepted.length ? await outcomesFor(user.id, accepted).catch(() => undefined) : {};
  // R1334: the personal layer is a plan perk, decided here on the server; the view only renders what it is told.
  const access = await intelligenceAccess(user.id);
  return <IntelligenceView initial={initial} account={account} initialOutcomes={initialOutcomes} personal={{ enabled: access.enabled, planName: access.planName }} />;
}
