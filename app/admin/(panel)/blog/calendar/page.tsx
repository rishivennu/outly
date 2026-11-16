import { requireAdmin } from "@/lib/admin/guard";
import { PageHead, Unavailable } from "@/components/admin/ui";

export const metadata = { title: "Blog calendar" };

export default async function BlogCalendar() {
  await requireAdmin("content");
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Calendar" body="Planned, generated and published days at a glance, with the scheduled run marked." />
      <Unavailable reason="The calendar arrives with scheduled runs in the next release. Until then the library lists every article by date." />
    </>
  );
}
