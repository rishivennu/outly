import { requireAdmin } from "@/lib/admin/guard";
import { aiReady, behavior, getAnalysis, isRange, listAnalyses, type Range } from "@/lib/admin/behavior";
import { PageHead } from "@/components/admin/ui";
import { BehaviorView } from "@/components/admin/BehaviorView";

export const metadata = { title: "User behavior" };
export const dynamic = "force-dynamic";

export default async function BehaviorPage({ searchParams }: { searchParams: { range?: string; tab?: string; v?: string } }) {
  await requireAdmin("insights");
  const n = Number(searchParams.range);
  const range: Range = isRange(n) ? n : 30;
  const [stats, history] = await Promise.all([behavior(range), listAnalyses({ take: 20 })]);
  const pick = searchParams.v || history.items[0]?.id;
  const selected = pick ? await getAnalysis(pick) : null;
  return (
    <>
      <PageHead
        eyebrow="Insights"
        title="User behavior"
        body={stats.sample ? "Includes sample users. Clear sample data on the Overview before you share these numbers." : "How people actually use Outlly: where they drop off, who comes back, and what Gemini makes of it. Every analysis is kept as a numbered version."}
      />
      <BehaviorView stats={stats} history={history} selected={selected} tab={searchParams.tab === "ai" ? "ai" : "breakdown"} aiReady={aiReady()} />
    </>
  );
}
