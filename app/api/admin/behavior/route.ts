import { z } from "zod";
import { json } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { isRange, listAnalyses, runAnalysis } from "@/lib/admin/behavior";

export const dynamic = "force-dynamic";
// A Gemini read of the whole snapshot can take 10 to 40 seconds.
export const maxDuration = 60;

/** Version history, newest first. ?before=<version> pages back. */
export const GET = adminRoute("insights", async (req) => {
  const before = Number(req.nextUrl.searchParams.get("before")) || undefined;
  return json(await listAnalyses({ before, take: 20 }));
});

const RunInput = z.object({
  rangeDays: z.number().int().refine(isRange, "Pick 7, 30 or 90 days."),
  focus: z.string().trim().max(300, "Keep the question under 300 characters.").optional().nullable(),
});

/** Runs a new analysis and stores it as the next version. Earlier versions are never changed. */
export const POST = adminRoute(
  "insights",
  async (req, { admin }) => {
    const { rangeDays, focus } = RunInput.parse(await req.json());
    const a = await runAnalysis({ rangeDays: rangeDays as 7 | 30 | 90, focus, by: admin.name || admin.login });
    await adminEvent("behavior_analysis", `Behavior analysis v${a.version} ready`, a.headline, `/admin/behavior?tab=ai&v=${a.id}`);
    return json({ analysis: a });
  },
  [6, 60_000],
);
