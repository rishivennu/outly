import { z } from "zod";
import { HttpError, json } from "@/lib/http";
import { assertPublicUrl } from "@/lib/net/assert-public";
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
  // SSRF: in production an admin-typed worker URL must be a public host (never 10.x, localhost or 169.254.169.254).
  const worker = typeof rules.workerUrl === "string" ? rules.workerUrl.trim() : "";
  if (worker && process.env.NODE_ENV === "production") {
    await assertPublicUrl(worker).catch((e: Error) => {
      throw new HttpError(400, `${e.message} Put the worker on a public https address, or set FUNASR_URL on the server for a private one.`, "BAD_WORKER_URL");
    });
  }
  const v = await saveSubtitleRules(rules);
  await adminEvent("integration", `${admin.name} updated the subtitle engine`, `Engine: ${v.provider}`, "/admin/integrations");
  return json({ subtitles: v });
});
