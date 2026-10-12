import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { Card, Empty, PageHead, Pill, STATUS_TONE, ago } from "@/components/admin/ui";
import { FilterChips, SearchBox } from "@/components/admin/SearchBox";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tickets" };
const PRIO = { urgent: 0, high: 1, normal: 2 } as Record<string, number>;

export default async function Tickets({ searchParams }: { searchParams: { s?: string; q?: string } }) {
  await requireAdmin("tickets");
  const s = searchParams.s ?? "active";
  const q = searchParams.q?.trim();
  const rows = await db.ticket.findMany({
    where: {
      ...(s === "active" ? { status: { not: "resolved" } } : s ? { status: s } : {}),
      ...(q ? { OR: [{ ref: { contains: q.toUpperCase() } }, { email: { contains: q } }, { subject: { contains: q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, author: true } } },
  });
  // urgent first, then oldest waiting first: the bot already escalated these
  rows.sort((a, b) => (PRIO[a.priority] - PRIO[b.priority]) || (s === "active" ? +a.createdAt - +b.createdAt : 0));
  return (
    <>
      <PageHead eyebrow="Support" title="Tickets" body="Raised automatically when Pip can't answer twice or someone asks for a person. Money questions are marked urgent. The customer already has an email with their ticket number." />
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips param="s" current={s} options={[{ value: "active", label: "Needs action" }, { value: "open", label: "Open" }, { value: "pending", label: "Waiting on customer" }, { value: "resolved", label: "Resolved" }, { value: "", label: "All" }]} />
          <SearchBox placeholder="Ref, email or subject" />
        </div>
        {rows.length === 0 ? (
          <Empty title={s === "active" ? "Inbox zero" : "No tickets here"} body={s === "active" ? "Every ticket is answered. Pip is handling the rest." : "Nothing matches these filters."} />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/tickets/${t.id}`} className="group flex items-start gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-foreground/[0.03]">
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", t.priority === "urgent" ? "bg-destructive" : t.priority === "high" ? "bg-warning" : "bg-muted-foreground/30")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-muted-foreground">{t.ref}</span>
                      <span className="truncate font-medium">{t.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{t.name ?? t.email} · {t.messages[0]?.author === "admin" ? "You: " : ""}{t.messages[0]?.body}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="flex gap-1">{t.priority !== "normal" && <Pill tone={STATUS_TONE[t.priority]}>{t.priority}</Pill>}<Pill tone={STATUS_TONE[t.status]}>{t.status === "pending" ? "waiting" : t.status}</Pill></span>
                    <span className="text-[11.5px] text-muted-foreground">{ago(t.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
