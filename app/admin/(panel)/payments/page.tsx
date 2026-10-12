import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { formatMoney } from "@/lib/billing/money";
import { activeGateway } from "@/lib/billing/service";
import { Card, Empty, PageHead, Pill, STATUS_TONE, Table, fmtDate } from "@/components/admin/ui";
import { FilterChips, SearchBox } from "@/components/admin/SearchBox";
import { RefundButton } from "@/components/admin/RefundButton";

export const metadata = { title: "Payments" };

export default async function Payments({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  await requireAdmin("payments");
  const status = searchParams.status ?? "";
  const q = searchParams.q?.trim();
  const where: any = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ user: { email: { contains: q } } }, { user: { name: { contains: q } } }, { invoice: { number: { contains: q.toUpperCase() } } }] } : {}),
  };
  const [rows, gw, sums] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { name: true, email: true } }, invoice: { select: { number: true, emailedAt: true } } } }),
    activeGateway(),
    db.payment.groupBy({ by: ["status"], _count: true }),
  ]);
  const plans = new Map((await db.plan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const count = (s: string) => sums.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHead
        eyebrow="Run"
        title="Payments & invoices"
        body={<>Refunds go back through the same gateway and end the plan immediately. Invoices are created automatically the moment a payment succeeds and emailed to the customer. Gateway: <b className="text-foreground">{gw.provider === "mock" ? "Mock (test)" : `${gw.provider} · ${gw.cfg.mode}`}</b>{gw.misconfigured && <span className="text-warning"> (your chosen gateway is missing keys, so checkout is using Mock)</span>}.</>}
      />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips param="status" current={status} options={[{ value: "", label: "All" }, { value: "succeeded", label: `Paid · ${count("succeeded")}` }, { value: "failed", label: `Failed · ${count("failed")}` }, { value: "pending", label: `Pending · ${count("pending")}` }, { value: "refunded", label: `Refunded · ${count("refunded")}` }]} />
          <SearchBox placeholder="Customer or invoice number" />
        </div>
        {rows.length === 0 ? (
          <Empty title="No payments here" body={status || q ? "Nothing matches these filters." : "Payments show up the moment a customer checks out."} />
        ) : (
          <Table head={["Customer", "Plan", "Amount", "Status", "Gateway", "Date", "Invoice", ""]}>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="block font-medium">{p.user.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{p.user.email}</span>
                </td>
                <td>{plans.get(p.planId ?? "") ?? "Other"}</td>
                <td className="font-semibold tabular">{formatMoney(p.amountMinor, p.currency)}</td>
                <td>
                  <Pill tone={STATUS_TONE[p.status]}>{p.status === "succeeded" ? "Paid" : p.status}</Pill>
                  {p.failureReason && <span className={`mt-1 block max-w-[220px] text-[12px] ${p.status === "refunded" ? "text-muted-foreground" : "text-destructive"}`}>{p.failureReason}</span>}
                </td>
                <td className="capitalize text-muted-foreground">{p.provider}{p.sample && " · sample"}</td>
                <td className="whitespace-nowrap text-muted-foreground">{fmtDate(p.createdAt, true)}</td>
                <td>
                  {p.invoice ? (
                    <a href={`/api/billing/invoices/${p.invoice.number}`} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] hairline hover:bg-secondary" title={p.invoice.emailedAt ? "Emailed to customer" : "Not emailed"}>
                      <Download className="h-3.5 w-3.5" aria-hidden />{p.invoice.number}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td>{p.status === "succeeded" && <RefundButton id={p.id} amount={formatMoney(p.amountMinor, p.currency)} customer={p.user.name} />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
