import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/perms";
import { AI_FEATURES, AI_FEATURE_LABEL, isAiFeature } from "@/lib/ai/features";
import { aiMonitoring, type GrantState } from "@/lib/ai/entitlements";
import { Card, CardTitle, Empty, PageHead, Pill, Table, ago, fmtDate } from "@/components/admin/ui";
import { DateFilter, FilterSelect, SearchBox } from "@/components/admin/SearchBox";
import { AiAccessButton } from "@/components/admin/AiAccessPanel";
import { GRANT_TONE, featuresText } from "@/components/admin/AiAccessFormat";

export const metadata = { title: "AI usage" };
export const dynamic = "force-dynamic";

type Params = { q?: string; feature?: string; status?: string; from?: string; to?: string };

const FEATURES = [{ value: "", label: "Every feature" }, ...AI_FEATURES.map((f) => ({ value: f, label: AI_FEATURE_LABEL[f] }))];
const STATUSES = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

/** A5: AI usage and Unlimited AI Access across everyone. Every figure is a database aggregate. */
export default async function AiUsage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const admin = await requireAdmin("users");
  const manage = can(admin.role, "plans");
  const feature = isAiFeature(sp.feature) ? sp.feature : "";
  const status = (["active", "expired", "revoked"].includes(sp.status ?? "") ? sp.status : "") as GrantState | "";
  const m = await aiMonitoring({ q: sp.q, feature, status, from: sp.from, to: sp.to });
  const top = Math.max(1, ...m.byFeature.map((r) => r.count));
  const stats = [
    { label: "AI generations", value: m.total, hint: `${m.range.from} to ${m.range.to}` },
    { label: "Covered by Unlimited", value: m.unlimitedCalls, hint: "Counted, no quota used" },
    { label: "People with Unlimited AI", value: m.unlimitedUsers, hint: "Live grants right now" },
    { label: "Active grants", value: m.activeCount, hint: "Matching the filters" },
    { label: "Expired grants", value: m.expiredCount, hint: "Ended by time" },
  ];
  return (
    <>
      <PageHead eyebrow="Run" title="AI usage" body="AI calls by feature, people close to their monthly AI limit, and every Unlimited AI Access grant. Usage is counted for everyone, including calls an Unlimited grant covered." />
      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <SearchBox placeholder="Search name or email" />
          <div role="group" aria-label="Filters" className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-end">
            <FilterSelect fill param="feature" label="Feature" current={feature} options={FEATURES} />
            <FilterSelect fill param="status" label="Grant status" current={status} options={STATUSES} />
            <DateFilter param="from" label="From" current={sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : ""} max={m.range.to} />
            <DateFilter param="to" label="To" current={sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : ""} min={m.range.from} />
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4 sm:p-5">
            <p className="text-[12px] font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-[1.6rem] font-bold tabular-nums">{s.value.toLocaleString("en-IN")}</p>
            <p className="text-[12px] text-muted-foreground">{s.hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle hint={m.mostUsed.length ? `Most used: ${m.mostUsed.map((f) => AI_FEATURE_LABEL[f]).join(", ")}` : "Nothing counted in this range yet."}>Usage by feature</CardTitle>
          <ul className="grid gap-3">
            {m.byFeature.map((r) => (
              <li key={r.feature}>
                <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                  <span className="truncate">{AI_FEATURE_LABEL[r.feature]}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.count.toLocaleString("en-IN")}
                    {r.unlimited ? ` (${r.unlimited.toLocaleString("en-IN")} unlimited)` : ""}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary" aria-hidden>
                  <div className="h-full rounded-full bg-lime" style={{ width: `${Math.round((r.count / top) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle hint="This month, 80% or more of the plan's monthly AI requests. People with Unlimited on every feature are left out.">Near their limit</CardTitle>
          {m.nearLimits.length === 0 ? (
            <Empty title="No one is close" body="People show here once they use 80% of their monthly AI requests." />
          ) : (
            <Table label="People near their AI limit" head={["Person", "Used", <span key="a" className="sr-only">Manage</span>]} minWidth={420}>
              {m.nearLimits.map((n) => (
                <tr key={n.userId}>
                  <td className="max-w-[240px]">
                    <span className="block truncate font-medium">{n.user!.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{n.user!.email}</span>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {n.used} of {n.limit} <Pill tone={n.pct >= 100 ? "bad" : "warn"}>{n.pct}%</Pill>
                  </td>
                  <td><AiAccessButton userId={n.userId} name={n.user!.name} canManage={manage} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle hint="Newest first. Expired means the end date passed; revoked means an admin ended it.">Unlimited AI Access grants</CardTitle>
          {m.grants.length === 0 ? (
            <Empty title="No grants match" body="Grant Unlimited AI Access from a person's row in Users, or loosen the filters." />
          ) : (
            <Table label="Unlimited AI Access grants" head={["Person", "Features", "Status", "Ends", "By", "Made", <span key="a" className="sr-only">Manage</span>]} minWidth={760}>
              {m.grants.map((g) => (
                <tr key={g.id}>
                  <td className="max-w-[240px]">
                    <span className="block truncate font-medium">{g.user.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{g.user.email}</span>
                  </td>
                  <td className="max-w-[260px] text-[13px]">{featuresText(g.features)}</td>
                  <td><Pill tone={GRANT_TONE[g.state]}>{g.state}</Pill></td>
                  <td className="whitespace-nowrap text-muted-foreground">{g.revokedAt ? `Revoked ${fmtDate(g.revokedAt)}` : g.expiresAt ? fmtDate(g.expiresAt) : "Permanent"}</td>
                  <td className="text-muted-foreground">{g.grantedBy}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{ago(g.createdAt)}</td>
                  <td><AiAccessButton userId={g.userId} name={g.user.name} canManage={manage} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
