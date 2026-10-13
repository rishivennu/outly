import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { PageHead } from "@/components/admin/ui";
import { LandingToggles } from "@/components/admin/LandingToggles";

export const metadata = { title: "Landing page" };
export const dynamic = "force-dynamic";

export default async function LandingAdminPage() {
  await requireAdmin("site");
  const landing = await getConfig("landing");
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Landing page"
        body="Choose what visitors see on the home page. Each switch saves at once and the page follows within about 15 seconds. Hidden sections also drop out of the nav and footer links."
      />
      <LandingToggles initial={landing} />
    </>
  );
}
