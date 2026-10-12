import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SettingsView } from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  // Inside someone else's workspace the profile and email settings are theirs, so they aren't shown.
  const own = user.actor ? null : await db.user.findUnique({ where: { id: user.id }, select: { weeklyReport: true } });
  return <SettingsView weeklyReport={own?.weeklyReport ?? true} />;
}
