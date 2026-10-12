import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { usingDefaultPassword } from "@/lib/admin/auth";
import { can } from "@/lib/admin/perms";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastProvider } from "@/components/shared/Toast";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Outlly admin" }, robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const [weak, openTickets] = await Promise.all([
    usingDefaultPassword(admin.id),
    can(admin.role, "tickets") ? db.ticket.count({ where: { status: { not: "resolved" } } }) : Promise.resolve(0),
  ]);
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
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
