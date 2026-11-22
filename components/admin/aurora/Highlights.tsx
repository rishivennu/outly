import Link from "next/link";
import { ChevronRight, CircleCheck, CreditCard, Database, LifeBuoy, TrendingDown, type LucideIcon } from "lucide-react";
import { can, type AdminRole } from "@/lib/admin/perms";
import type { overview } from "@/lib/admin/metrics";
import { AuroraKpiRow, type KpiProps } from "./AuroraKpi";

type Kpi = Awaited<ReturnType<typeof overview>>["kpi"];
type Item = { key: string; icon: LucideIcon; tone: "bad" | "info"; text: React.ReactNode; href?: string; cta?: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function attentionItems(k: Kpi, role: AdminRole, sample: boolean): Item[] {
  const items: Item[] = [];
  if (can(role, "tickets") && k.urgentTickets > 0) {
    items.push({ key: "urgent", icon: LifeBuoy, tone: "bad", text: `${plural(k.urgentTickets, "urgent ticket is", "urgent tickets are")} waiting for a reply.`, href: "/admin/tickets", cta: "Open tickets" });
  }
  if (can(role, "payments") && k.failed7 > 0) {
    items.push({ key: "failed", icon: CreditCard, tone: "bad", text: `${plural(k.failed7, "payment", "payments")} failed in the last 7 days.`, href: "/admin/payments", cta: "Open payments" });
  }
  if (can(role, "payments") && k.churnBase && k.churn > 0.08) {
    const link = can(role, "pricing") ? { href: "/admin/subscriptions", cta: "Open subscriptions" } : can(role, "retention") ? { href: "/admin/retention", cta: "Open at risk" } : {};
    items.push({ key: "churn", icon: TrendingDown, tone: "bad", text: `Churn is ${(k.churn * 100).toFixed(1)}% over 30 days, above the 8% line.`, ...link });
  }
  if (role === "super" && k.totalUsers < 3 && !sample) {
    items.push({
      key: "empty",
      icon: Database,
      tone: "info",
      text: (
        <>
          <b>Not much data yet.</b> Load sample data to see the charts filled in. It's flagged, never emailed, and clears with one click.
        </>
      ),
    });
  }
  return items;
}

export function Highlights({ k, role, sample }: { k: Kpi; role: AdminRole; sample: boolean }) {
  const items = attentionItems(k, role, sample);
  return (
    <section data-aurora="card" aria-labelledby="au-attention" className="admin-card rounded-[24px] bg-card p-5">
      <h2 id="au-attention" className="text-[16px] font-semibold leading-[1.35]">
        Needs attention
      </h2>
      {items.length ? (
        <ul className="au-list mt-2 divide-y divide-border/60">
          {items.map(({ key, icon: Icon, tone, text, href, cta }) => (
            <li key={key} className="au-row flex min-h-[44px] min-w-0 items-start gap-3 py-3">
              <span aria-hidden="true" className={tone === "bad" ? "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-destructive/12 text-destructive" : "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime/15 text-foreground"}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="break-words text-[13.5px] leading-snug">{text}</p>
                {href && cta && (
                  <Link href={href} className="au-chip inline-flex min-h-[44px] w-fit items-center gap-1 rounded-full px-3 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {cta}
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-secondary/40 px-4 py-3 text-[13.5px] text-muted-foreground" role="status">
          <CircleCheck className="h-4 w-4 shrink-0 text-[#3d6b00] dark:text-lime" aria-hidden />
          All quiet. Nothing needs you right now.
        </p>
      )}
    </section>
  );
}

export function MoreNumbers({ kpis }: { kpis: KpiProps[] }) {
  if (!kpis.length) return null;
  return (
    <section data-aurora="card" aria-labelledby="au-more" className="admin-card rounded-[24px] bg-card p-5">
      <h2 id="au-more" className="text-[16px] font-semibold leading-[1.35]">
        More numbers
      </h2>
      <ul className="au-list mt-1 divide-y divide-border/60">
        {kpis.map((kpi) => (
          <AuroraKpiRow key={kpi.label} {...kpi} />
        ))}
      </ul>
    </section>
  );
}
