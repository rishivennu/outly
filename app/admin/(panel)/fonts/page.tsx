import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { normalizeFonts } from "@/lib/fonts";
import { PageHead } from "@/components/admin/ui";
import { FontPicker } from "@/components/admin/FontPicker";

export const metadata = { title: "Site fonts" };
export const dynamic = "force-dynamic";

export default async function FontsAdminPage() {
  await requireAdmin("site");
  const fonts = normalizeFonts(await getConfig("fonts"));
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Site fonts"
        body="Switch the typeface across the whole site: marketing pages, the app and this admin. A pick saves at once and every visitor sees it within 30 seconds, no deploy needed."
      />
      <FontPicker initial={fonts} />
    </>
  );
}
