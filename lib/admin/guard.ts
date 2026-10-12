import "server-only";
import { redirect } from "next/navigation";
import { getAdmin, type AdminSession } from "./auth";
import { can, type AdminArea } from "./perms";

/** Page guard. No session: sign in. Wrong role: back to the overview with a note. */
export async function requireAdmin(area?: AdminArea): Promise<AdminSession> {
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  if (area && !can(a.role, area)) redirect(`/admin?denied=${area}`);
  return a;
}
