import { requireAdmin } from "@/lib/admin/guard";
import { usingDefaultPassword } from "@/lib/admin/auth";
import { ROLE_LABEL } from "@/lib/admin/perms";
import { PageHead, Card } from "@/components/admin/ui";
import { PasswordForm } from "@/components/admin/PasswordForm";
import { DesignPicker } from "@/components/admin/aurora/DesignPicker";
import { ADMIN_DESIGN_COOKIE, readDesign } from "@/lib/admin/design";
import { cookies } from "next/headers";

export const metadata = { title: "My account" };

export default async function Account() {
  const a = await requireAdmin();
  const weak = await usingDefaultPassword(a.id);
  // R1304: the console design is a per-admin pick, so it lives here with the other things that are yours alone.
  const design = readDesign((await cookies()).get(ADMIN_DESIGN_COOKIE)?.value);
  return (
    <>
      <PageHead eyebrow={ROLE_LABEL[a.role]} title="My account" body={`Signed in as ${a.login}. Your password and how the console looks for you.`} />
      <div className="grid gap-5">
        <section aria-labelledby="pw-h" className="grid gap-3">
          <h2 id="pw-h" className="text-[18px] font-semibold">My password</h2>
          <Card className="max-w-lg"><PasswordForm weak={weak} /></Card>
          <p className="text-[13px] text-muted-foreground">Changing it signs you out everywhere else.</p>
        </section>
        <section aria-labelledby="design-h" className="grid gap-3">
          <h2 id="design-h" className="mt-3 text-[18px] font-semibold">Console design</h2>
          <DesignPicker current={design} />
        </section>
      </div>
    </>
  );
}
