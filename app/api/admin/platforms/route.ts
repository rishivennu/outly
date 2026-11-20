import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, redact, saveConfig, KEYED_PLATFORMS } from "@/lib/settings";
import { PLATFORM_META, PLATFORMS, isCorePlatform } from "@/lib/domain";
import { hasCredentials, livePlatforms, loadKeys } from "@/lib/social/registry";
import { PLATFORM_STATUS, platformStatus } from "@/lib/admin/platform-status";

const secret = z.union([z.string().trim().max(600), z.null()]).optional();
const Body = z.object({
  platform: z.enum(KEYED_PLATFORMS),
  clientId: z.string().trim().max(300),
  clientSecret: secret,
  /** Instagram and Facebook only (1031f): false = don't ask for the messaging permissions. */
  dms: z.boolean().optional(),
  /** Instagram only (R1199): true = ask every creator for the insights permission. */
  insights: z.boolean().optional(),
});

/** `live` is what the studio offers (core platforms always); `ready` is which platforms creators can actually connect. */
const readyPlatforms = () => PLATFORMS.filter(hasCredentials);

export const GET = adminRoute("platforms", async () => {
  await loadKeys();
  return json({ platforms: redact("platforms", await getConfig("platforms")), live: livePlatforms(), ready: readyPlatforms() });
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
  const dmCapable = b.platform === "instagram" || b.platform === "facebook";
  const storeInsights = b.platform === "instagram" && b.insights !== undefined;
  const v = await saveConfig("platforms", { [b.platform]: { clientId: b.clientId, clientSecret: b.clientSecret, ...(dmCapable && b.dms !== undefined ? { dms: b.dms } : {}), ...(storeInsights ? { insights: b.insights } : {}) } });
  await loadKeys();
  const live = livePlatforms();
  const ready = readyPlatforms();
  const name = PLATFORM_META[b.platform].name;
  const saved = v[b.platform];
  const status = platformStatus({ core: isCorePlatform(b.platform), ready: ready.includes(b.platform), idSet: !!saved?.clientId, secretSet: !!saved?.clientSecret });
  await adminEvent("integration", `${admin.name} updated ${name} keys`, `${name}: ${PLATFORM_STATUS[status].label}${dmCapable && b.dms !== undefined ? `, direct messages ${b.dms ? "on" : "off"}` : ""}${storeInsights ? `, insights ${b.insights ? "on" : "off"}` : ""}`, "/admin/platforms");
  return json({ platforms: redact("platforms", v), live, ready });
}, [30, 60_000]);

export const dynamic = "force-dynamic";
