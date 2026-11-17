import { requireAdmin } from "@/lib/admin/guard";
import { aiReady, behavior, getAnalysis, isRange, listAnalyses, type Range } from "@/lib/admin/behavior";
import { PageHead } from "@/components/admin/ui";
import { BehaviorView } from "@/components/admin/BehaviorView";
import { adminEmail } from "@/lib/admin/privacy";
import { withPeople } from "@/lib/admin/activation";
import { can } from "@/lib/admin/perms";

export const metadata = { title: "User behavior" };
export const dynamic = "force-dynamic";

export default async function BehaviorPage(props: { searchParams: Promise<{ range?: string; tab?: string; v?: string }> }) {
  const searchParams = await props.searchParams;
  const admin = await requireAdmin("insights");
  const n = Number(searchParams.range);
  const range: Range = isRange(n) ? n : 30;
  const [raw, history] = await Promise.all([behavior(range), listAnalyses({ take: 20 })]);
  // 1163: the engaged-people list leaves the server with masked addresses unless a super admin is looking.
  // 1166: people (engaged list, who is in each funnel step) only reach roles that may open user records.
  const people = can(admin.role, "users");
  const stats = {
    ...raw,
    topUsers: people ? raw.topUsers.map((u) => ({ ...u, email: adminEmail(u.email, admin.role) })) : [],
    activation: withPeople(raw.activation, people ? (e) => adminEmail(e, admin.role) : null),
  };
  const pick = searchParams.v || history.items[0]?.id;
  const selected = pick ? await getAnalysis(pick) : null;
  return (
    <>
      <PageHead
        eyebrow="Insights"
        title="User behavior"
        body={stats.sample ? "Includes sample users. Clear sample data on the Overview before you share these numbers." : "How people use Outlly: where they drop off, who comes back and how often. Every number is from Outlly's own records in UTC days; hover the i beside a number to see how it is counted."}
      />
      <BehaviorView stats={stats} history={history} selected={selected} tab={searchParams.tab === "ai" ? "ai" : "breakdown"} aiReady={aiReady()} />
    </>
  );
}
