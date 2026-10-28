import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { cached } from "@/lib/cache";
import { requireAdmin } from "@/lib/admin/guard";
import { usingDefaultPassword } from "@/lib/admin/auth";
import { can } from "@/lib/admin/perms";
import { sweeperHealth, type SweeperHealth } from "@/lib/queue/health";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastProvider } from "@/components/shared/Toast";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Outlly admin" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** What to check when the sweep this deployment relies on has gone quiet. */
const SWEEP_FIX: Record<SweeperHealth["source"], string> = {
  cron: "Check the cron-job.org pinger: it should call /api/cron/sweep every minute with the CRON_SECRET bearer token.",
  worker: "Check that the queue worker (npm run worker) is running and can reach Redis.",
  inproc: "The app server runs the sweep itself here, so restart it if this stays.",
};

function ago(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const [weak, openTickets, sweep] = await Promise.all([
    usingDefaultPassword(admin.id),
    // The sidebar badge can lag a few seconds; it should not cost a database trip on every click.
    can(admin.role, "tickets") ? cached("admin:open-tickets", 15_000, () => db.ticket.count({ where: { status: { not: "resolved" } } })) : Promise.resolve(0),
    // Only the people who can fix it (integrations) see it. A failed check never blocks the panel.
    can(admin.role, "integrations") ? cached("admin:sweeper-health", 30_000, () => sweeperHealth()).catch(() => null) : Promise.resolve(null),
  ]);
  const late = sweep?.latePosts ?? 0;
  return (
    <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Skip to main content
      </a>
      <AdminShell admin={{ name: admin.name, role: admin.role }} badges={{ tickets: openTickets }}>
        {weak && (
          <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-[20px] bg-warning/12 px-4 py-3 text-[13.5px] hairline">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span className="flex-1">You're still on the starter password. Anyone who guesses 4 digits gets in, so change it before going live.</span>
            <Link href="/admin/account" className="rounded-full bg-foreground px-3.5 py-1.5 text-[12.5px] font-semibold text-background">Change password</Link>
          </div>
        )}
        {sweep?.stale && (
          <div role="alert" className="mb-6 flex flex-wrap items-start gap-3 rounded-[20px] bg-warning/12 px-4 py-3 text-[13.5px] hairline">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span className="min-w-[16rem] flex-1">
              <strong className="font-semibold">Scheduled posts aren't going out on time.</strong>{" "}
              The minute sweep {sweep.lastAt === null ? "has no recorded run yet" : `last ran ${ago(Date.now() - sweep.lastAt)}`}
              {late > 0 ? `, and ${late} scheduled post${late === 1 ? " is" : "s are"} overdue` : ""}. {SWEEP_FIX[sweep.source]}
            </span>
          </div>
        )}
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
