import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/admin/guard";
import { PageHead } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { WorkshopsPanel } from "@/components/admin/workshops/WorkshopsPanel";
import { listAdminWorkshops } from "@/lib/workshops/server";
import { calendarStatus } from "@/lib/google/calendar";

export const metadata = { title: "Workshops", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function WorkshopsAdminPage() {
  await requireAdmin("workshops");
  const [workshops, calendar] = await Promise.all([listAdminWorkshops(), calendarStatus()]);
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
      <WorkshopsPanel initial={workshops} calendar={calendar} now={Date.now()} />
    </>
  );
}
