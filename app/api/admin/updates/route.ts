import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { cleanItems, UPDATE_LIMITS } from "@/lib/updates";

export const dynamic = "force-dynamic";

export const GET = adminRoute("site", async () => json({ notice: await getConfig("updates") }));

const Body = z.object({
  title: z.string().trim().min(1, "Give it a short title").max(UPDATE_LIMITS.title),
  body: z.string().trim().max(UPDATE_LIMITS.body),
  items: z.array(z.string().max(400)).max(30),
  on: z.boolean(),
  /** true = new id, so every member sees it again on their next visit. false = quiet edit (fix a typo). */
  publish: z.boolean().default(false),
});

export const PUT = adminRoute("site", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  const now = new Date().toISOString();
  const items = cleanItems(b.items);
  const notice = await saveConfig("updates", {
    title: b.title,
    body: b.body,
    items,
    on: b.on,
    ...(b.publish ? { id: now, publishedAt: now, on: true } : {}),
  });
  if (b.publish) await adminEvent("updates", `${admin.name} published an update notice`, `${notice.title} (${items.length} change${items.length === 1 ? "" : "s"})`, "/admin/updates");
  return json({ notice });
}, [20, 60_000]);
