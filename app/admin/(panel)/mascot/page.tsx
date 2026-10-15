import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { normalizeMascot } from "@/lib/mascot/palettes";
import { PageHead } from "@/components/admin/ui";
import { MascotPicker } from "@/components/admin/MascotPicker";

export const metadata = { title: "Mascot colours" };
export const dynamic = "force-dynamic";

export default async function MascotAdminPage() {
  await requireAdmin("site");
  const mascot = normalizeMascot(await getConfig("mascot"));
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Mascot colours"
        body="Pip keeps the same look everywhere; only the colours change. Give each moment its own colourway, for example gold when someone hits a goal or ember inside the streak flame. Each pick saves at once."
      />
      <MascotPicker initial={mascot} />
    </>
  );
}
