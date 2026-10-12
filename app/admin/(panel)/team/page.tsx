import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/guard";
import { ROLE_BLURB, ROLE_LABEL } from "@/lib/admin/perms";
import { PageHead } from "@/components/admin/ui";
import { TeamView } from "@/components/admin/TeamView";

export const metadata = { title: "Team & roles" };

export default async function Team() {
  const me = await requireAdmin("team");
  const team = await db.adminUser.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, login: true, role: true, active: true, lastLoginAt: true } });
  return (
    <>
      <PageHead eyebrow="Setup" title="Team & roles" body="Give each person only what they need. Every admin signs in at /admin/login with their own login." />
      <TeamView me={me.id} roles={{ label: ROLE_LABEL, blurb: ROLE_BLURB }} initial={team.map((t) => ({ ...t, lastLoginAt: t.lastLoginAt?.toISOString() ?? null }))} />
    </>
  );
}
