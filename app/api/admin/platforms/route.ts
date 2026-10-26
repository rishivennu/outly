import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, redact, saveConfig, KEYED_PLATFORMS } from "@/lib/settings";
import { PLATFORM_META } from "@/lib/domain";
import { livePlatforms, loadKeys } from "@/lib/social/registry";

const secret = z.union([z.string().trim().max(600), z.null()]).optional();
const Body = z.object({
  platform: z.enum(KEYED_PLATFORMS),
  clientId: z.string().trim().max(300),
  clientSecret: secret,
});

export const GET = adminRoute("platforms", async () => {
  await loadKeys();
  return json({ platforms: redact("platforms", await getConfig("platforms")), live: livePlatforms() });
});

export const PUT = adminRoute("platforms", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  if ((b.platform === "instagram" || b.platform === "facebook") && b.clientId) {
    const other = (await getConfig("platforms"))[b.platform === "instagram" ? "facebook" : "instagram"]?.clientId?.trim();
    if (other && other === b.clientId)
      throw new HttpError(
        400,
        b.platform === "instagram"
          ? "That's the Meta App ID (the one Facebook uses). Instagram needs its own: in your Meta app open Instagram > API setup with Instagram login and copy the Instagram app ID and secret."
          : "That ID is saved as the Instagram app ID. Facebook needs the Meta App ID from App settings > Basic.",
      );
  }
  const v = await saveConfig("platforms", { [b.platform]: { clientId: b.clientId, clientSecret: b.clientSecret } });
  await loadKeys();
  const live = livePlatforms();
  const name = PLATFORM_META[b.platform].name;
  await adminEvent("integration", `${admin.name} updated ${name} keys`, live.includes(b.platform) ? `${name} is live` : `${name} is off`, "/admin/platforms");
  return json({ platforms: redact("platforms", v), live });
}, [30, 60_000]);

export const dynamic = "force-dynamic";
