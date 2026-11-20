import { requireAdmin } from "@/lib/admin/guard";
import { getConfig, redact } from "@/lib/settings";
import { env } from "@/lib/env";
import { PageHead } from "@/components/admin/ui";
import { PlatformKeysForm } from "@/components/admin/PlatformKeysForm";
import { PLATFORMS } from "@/lib/domain";
import { hasCredentials, loadKeys } from "@/lib/social/registry";
import { webhookVerifyToken } from "@/lib/messages/webhook";

export const metadata = { title: "Social platforms" };
export const dynamic = "force-dynamic";

export default async function PlatformsAdmin() {
  await requireAdmin("platforms");
  await loadKeys();
  const ready = PLATFORMS.filter(hasCredentials);
  const keys = redact("platforms", await getConfig("platforms"));
  const base = env.APP_URL.replace(/\/$/, "");
  const dm = { webhook: `${base}/api/webhooks/meta`, verifyToken: webhookVerifyToken(), deletion: `${base}/api/webhooks/meta/deletion` };
  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Social platforms"
        body="Paste each platform's app keys. With both keys set, creators can connect it."
      />
      <PlatformKeysForm keys={keys} ready={ready} base={base} dm={dm} />
    </>
  );
}
