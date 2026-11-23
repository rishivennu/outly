import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/perms";
import { getConfig } from "@/lib/settings";
import { PublicPageToggles } from "@/components/admin/PublicPageToggles";
import { PageHead } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { WorkshopsPanel } from "@/components/admin/workshops/WorkshopsPanel";
import { listAdminWorkshops } from "@/lib/workshops/server";
import { calendarStatus } from "@/lib/google/calendar";

export const metadata = { title: "Workshops", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkshopsAdminPage() {
  const admin = await requireAdmin("workshops");
  const [workshops, calendar, landing] = await Promise.all([listAdminWorkshops(), calendarStatus(), getConfig("landing")]);
  return (
    <>
      <PageHead
        eyebrow="Content Studio"
        title="Workshops"
        body="Live sessions for creators: schedule, publish, and Google Calendar sends the Meet invites."
        actions={
          <Button asChild variant="lime" size="sm">
            <Link href="/admin/workshops?new=1" scroll={false}>
              <Plus className="h-4 w-4" aria-hidden /> New workshop
            </Link>
          </Button>
        }
      />
      <div className="mb-4">
        <PublicPageToggles initial={{ pages: landing.pages }} canEdit={can(admin.role, "site")} />
      </div>
      <WorkshopsPanel initial={workshops} calendar={calendar} now={Date.now()} />
    </>
  );
}
