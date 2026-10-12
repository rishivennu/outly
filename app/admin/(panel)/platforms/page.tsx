import { requireAdmin } from "@/lib/admin/guard";
import { getConfig, redact } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageHead } from "@/components/admin/ui";
import { PlatformKeysForm } from "@/components/admin/PlatformKeysForm";
import { liveNow } from "@/lib/social/registry";

export const metadata = { title: "Social platforms" };
export const dynamic = "force-dynamic";

export default async function PlatformsAdmin() {
  await requireAdmin("platforms");
  const live = await liveNow();
  const keys = redact("platforms", await getConfig("platforms"));
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Social platforms"
        body="Paste each platform's developer app keys here. The moment a platform has both keys, creators see it in the studio and can connect it. Secrets are encrypted in the database and never shown again after saving."
      />
      <PlatformKeysForm keys={keys} live={live} base={env.APP_URL.replace(/\/$/, "")} />
    </>
  );
}
