import { requireAdmin } from "@/lib/admin/guard";
import { usingDefaultPassword } from "@/lib/admin/auth";
import { ROLE_LABEL } from "@/lib/admin/perms";
import { PageHead, Card } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/PasswordForm";

export const metadata = { title: "My password" };

export default async function Account() {
  const a = await requireAdmin();
  const weak = await usingDefaultPassword(a.id);
  return (
    <>
      <PageHead eyebrow={ROLE_LABEL[a.role]} title="My password" body={`Signed in as ${a.login}. Changing it signs you out everywhere else.`} />
      <Card className="max-w-lg"><PasswordForm weak={weak} /></Card>
    </>
  );
}
