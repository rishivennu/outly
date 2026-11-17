import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { BLOG_MODELS, BLOG_TONES, blogConfigIssues, pruneSkipDates, type BlogConfig } from "@/lib/blog/config";
import { localDay } from "@/lib/blog/job";
import { blogReady, blogWebReady } from "@/lib/blog/llm";

export const dynamic = "force-dynamic";

export const GET = adminRoute("content", async () => json({ config: await getConfig("blog"), ready: blogReady(), web: blogWebReady() }));

const Feature = z.object({ id: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(80), helpsWith: z.string().trim().max(300), href: z.string().trim().regex(/^\/[^\s]*$/, "Feature links must be paths on outlly.com, like /#features").max(120) });
const Put = z.object({
  audience: z.string().trim().max(600).optional(),
  tone: z.enum(BLOG_TONES).optional(),
  minWords: z.number().int().optional(),
  maxWords: z.number().int().optional(),
  timezone: z.string().trim().max(60).optional(),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  restrictedTopics: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  featureRefs: z.array(Feature).max(20).optional(),
  brandLines: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  author: z.string().trim().max(80).optional(),
  schedule: z.object({ enabled: z.boolean().optional(), startTime: z.string().optional(), readyBy: z.string().optional(), perDay: z.number().int().optional() }).optional(),
  paused: z.boolean().optional(),
  model: z.enum(BLOG_MODELS).optional(),
  webResearch: z.boolean().optional(),
  skipDates: z.array(z.string().trim().max(10)).max(200).optional(),
});

export const PUT = adminRoute("content", async (req, { admin }) => {
  const patch = Put.parse(await req.json());
  const cur = await getConfig("blog");
  const next: BlogConfig = { ...cur, ...patch, schedule: { ...cur.schedule, ...(patch.schedule ?? {}), autoPublish: false } } as BlogConfig;
  // R1178: a form that does not know about skipped days keeps them; old days drop off on every save.
  next.skipDates = pruneSkipDates(patch.skipDates ?? cur.skipDates ?? [], localDay(next.timezone));
  const issues = blogConfigIssues(next);
  if (issues.length) throw new HttpError(400, issues[0], "VALIDATION");
  const saved = await saveConfig("blog", next);
  await adminEvent("blog.settings", `${admin.name} updated blog settings`, patch.paused !== undefined ? (patch.paused ? "Agent paused" : "Agent resumed") : undefined, "/admin/blog/settings");
  return json({ config: saved });
}, [30, 60_000]);
