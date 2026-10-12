import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { formatMoney } from "@/lib/billing/money";
import { SAMPLE_DOMAIN } from "@/lib/admin/sample";
import { Card, Empty, PageHead, Pill, Table, ago, fmtDate } from "@/components/admin/ui";
import { FilterChips, SearchBox } from "@/components/admin/SearchBox";

export const metadata = { title: "Users" };
const PER = 50;

export default async function Users({ searchParams }: { searchParams: { q?: string; f?: string; page?: string } }) {
  await requireAdmin("users");
  const q = searchParams.q?.trim();
  const f = searchParams.f ?? "";
  const page = Math.max(1, Number(searchParams.page) || 1);
  const since7 = new Date(Date.now() - 7 * 864e5);
  const where: any = {
    ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    ...(f === "paying" ? { subscriptions: { some: { status: "active" } } } : {}),
    ...(f === "active" ? { lastActiveAt: { gte: since7 } } : {}),
    ...(f === "dormant" ? { OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: since7 } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PER,
      skip: (page - 1) * PER,
      select: {
        id: true, name: true, email: true, createdAt: true, lastActiveAt: true,
        subscriptions: { where: { status: "active" }, take: 1, select: { priceMinor: true, currency: true, cancelAtPeriodEnd: true, plan: { select: { name: true } } } },
        _count: { select: { tickets: true, posts: true } },
      },
    }),
    db.user.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const link = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(f ? { f } : {}), page: String(p) })}`;
  return (
    <>
      <PageHead eyebrow="Run" title="Users" body={`${total.toLocaleString("en-IN")} ${f ? "matching" : "creator accounts"}. Last active updates once a day per user.`} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips param="f" current={f} options={[{ value: "", label: "All" }, { value: "paying", label: "Paying" }, { value: "active", label: "Active 7d" }, { value: "dormant", label: "Dormant" }]} />
          <SearchBox placeholder="Search name or email" />
        </div>
        {rows.length === 0 ? (
          <Empty title={q ? `No one matches "${q}"` : "No users yet"} body={q ? "Try part of an email or a first name." : "Sign-ups appear here as soon as someone creates an account."} />
        ) : (
          <Table head={["User", "Plan", "Last active", "Joined", "Posts", "Tickets"]}>
            {rows.map((u) => {
              const s = u.subscriptions[0];
              return (
                <tr key={u.id}>
                  <td>
                    <span className="block font-medium">{u.name}{u.email.endsWith(SAMPLE_DOMAIN) && <Pill className="ml-2" tone="info">sample</Pill>}</span>
                    <span className="block text-[12px] text-muted-foreground">{u.email}</span>
                  </td>
                  <td>{s ? <span className="flex flex-wrap items-center gap-1.5"><Pill tone="lime">{s.plan.name}</Pill><span className="text-[12px] text-muted-foreground">{formatMoney(s.priceMinor, s.currency)}</span>{s.cancelAtPeriodEnd && <Pill tone="warn">cancelling</Pill>}</span> : <span className="text-muted-foreground">Free</span>}</td>
                  <td className="whitespace-nowrap">{ago(u.lastActiveAt)}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmtDate(u.createdAt)}</td>
                  <td className="tabular">{u._count.posts}</td>
                  <td className="tabular">{u._count.tickets}</td>
                </tr>
              );
            })}
          </Table>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px]">
            {page > 1 ? <a className="rounded-full px-3 py-1.5 hairline hover:bg-secondary" href={link(page - 1)}>Previous</a> : <span />}
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            {page < pages ? <a className="rounded-full px-3 py-1.5 hairline hover:bg-secondary" href={link(page + 1)}>Next</a> : <span />}
          </nav>
        )}
      </Card>
    </>
  );
}
