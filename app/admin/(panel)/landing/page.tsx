import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { PageHead } from "@/components/admin/ui";
import { LandingToggles } from "@/components/admin/LandingToggles";
import { PublicPageToggles } from "@/components/admin/PublicPageToggles";

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
        body="Choose what visitors see on the home page. Each switch saves at once."
      />
      <div className="mb-4">
        <PublicPageToggles initial={{ pages: landing.pages }} canEdit />
      </div>
      <LandingToggles initial={landing} />
    </>
  );
}
