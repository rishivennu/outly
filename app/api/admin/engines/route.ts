import { z } from "zod";
import { json } from "@/lib/http";
import { adminEvent, adminRoute } from "@/lib/admin/route";
import { captionRules, saveCaptionRules, saveSubtitleRules, subtitleRules } from "@/lib/ai/engine-store";
import { env } from "@/lib/env";

/** Both AI engines' settings, stored in the Setting table (Supabase Postgres in production). */
export const GET = adminRoute("integrations", async () => {
  const [captions, subtitles] = await Promise.all([captionRules(), subtitleRules()]);
  return json({ captions, subtitles, funasrEnv: !!env.FUNASR_URL });
});

const Body = z.object({ key: z.enum(["captions", "subtitles"]), rules: z.record(z.unknown()) });

export const PUT = adminRoute("integrations", async (req, { admin }) => {
  const { key, rules } = Body.parse(await req.json());
  if (key === "captions") {
    const v = await saveCaptionRules(rules);
    await adminEvent("integration", `${admin.name} updated the caption engine`, undefined, "/admin/integrations");
    return json({ captions: v });
  }
  const v = await saveSubtitleRules(rules);
  await adminEvent("integration", `${admin.name} updated the subtitle engine`, `Engine: ${v.provider}`, "/admin/integrations");
  return json({ subtitles: v });
});
