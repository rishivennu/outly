import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { waitlistCounts, waitlistRecent } from "@/lib/site";
import { PageHead } from "@/components/admin/ui";
import { WaitlistToggle } from "@/components/admin/WaitlistToggle";

export const metadata = { title: "Waitlist" };
export const dynamic = "force-dynamic";

export default async function WaitlistAdminPage() {
  await requireAdmin("site");
  const [c, counts, recent] = await Promise.all([getConfig("site"), waitlistCounts(), waitlistRecent(50)]);
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Waitlist"
        body="One switch pauses new signups. Every “Start creating” button becomes “Join the waitlist”, /signup shows the waitlist page, and you invite people in when you're ready."
      />
      <WaitlistToggle initial={{ waitlist: !!c.waitlist, since: c.waitlistSince, counts, recent }} />
    </>
  );
}
