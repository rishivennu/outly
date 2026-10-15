import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { formatMoney } from "@/lib/billing/money";
import { Card, CardTitle, Pill, fmtDate } from "@/components/admin/ui";
import { TicketThread } from "@/components/admin/TicketThread";

export const metadata = { title: "Ticket" };

export default async function TicketPage({ params }: { params: { id: string } }) {
  await requireAdmin("tickets");
  const t = await db.ticket.findUnique({ where: { id: params.id }, include: { messages: { orderBy: { createdAt: "asc" } }, user: { select: { name: true, email: true, avatar: true, createdAt: true, subscriptions: { where: { status: "active" }, take: 1, include: { plan: true } }, payments: { orderBy: { createdAt: "desc" }, take: 3 } } } } });
  if (!t) notFound();
  const sub = t.user?.subscriptions[0];
  return (
    <>
      <Link href="/admin/tickets" className="mb-4 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />All tickets</Link>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <TicketThread
          ticket={{ avatar: t.user?.avatar ?? null, id: t.id, ref: t.ref, subject: t.subject, status: t.status, priority: t.priority, email: t.email, name: t.name, source: t.source, createdAt: t.createdAt.toISOString() }}
          messages={t.messages.map((m) => ({ id: m.id, author: m.author, authorName: m.authorName, body: m.body, createdAt: m.createdAt.toISOString() }))}
        />
        <Card className="self-start">
          <CardTitle>Customer</CardTitle>
          <p className="font-medium">{t.name ?? t.user?.name ?? "Guest"}</p>
          <p className="text-[13px] text-muted-foreground">{t.email}</p>
          {t.user ? (
            <dl className="mt-4 grid gap-2 text-[13px]">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Joined</dt><dd>{fmtDate(t.user.createdAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Plan</dt><dd>{sub ? `${sub.plan.name} · ${formatMoney(sub.priceMinor, sub.currency)}` : "Free"}</dd></div>
              {t.user.payments.map((p) => (
                <div key={p.id} className="flex justify-between gap-2"><dt className="text-muted-foreground">{fmtDate(p.createdAt)}</dt><dd className="flex items-center gap-1.5">{formatMoney(p.amountMinor, p.currency)}<Pill tone={p.status === "succeeded" ? "ok" : p.status === "failed" ? "bad" : "warn"}>{p.status === "succeeded" ? "paid" : p.status}</Pill></dd></div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted-foreground">Not signed in when they asked. Replies go to this email.</p>
          )}
          <p className="mt-4 text-[12px] text-muted-foreground">Raised {fmtDate(t.createdAt, true)} via {t.source === "chatbot" ? "Pip (chat)" : t.source}.</p>
        </Card>
      </div>
    </>
  );
}
