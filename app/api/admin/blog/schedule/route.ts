import { z } from "zod";
import { json, HttpError } from "@/lib/http";
import { adminRoute, adminEvent } from "@/lib/admin/route";
import { getConfig, saveConfig } from "@/lib/settings";
import { blogConfigIssues, dayDiff, isDay, pruneSkipDates } from "@/lib/blog/config";
import { localDay } from "@/lib/blog/job";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["skip", "unskip"]), date: z.string().trim().max(10) });

/** R1178: sit the daily run out on one day, or put it back. Only touches skipDates, never the rest of the settings. */
export const POST = adminRoute("content", async (req, { admin }) => {
  const b = Body.parse(await req.json());
  if (!isDay(b.date)) throw new HttpError(400, "Pick a day as YYYY-MM-DD.", "VALIDATION");
  const cur = await getConfig("blog");
  const today = localDay(cur.timezone);
  if (b.action === "skip" && dayDiff(today, b.date) < 0) throw new HttpError(400, "That day has already passed.", "VALIDATION");
  const base = (cur.skipDates ?? []).filter((d) => d !== b.date);
  const skipDates = pruneSkipDates(b.action === "skip" ? [...base, b.date] : base, today);
  const issues = blogConfigIssues({ ...cur, skipDates });
  if (issues.length) throw new HttpError(400, issues[0], "VALIDATION");
  const saved = await saveConfig("blog", { skipDates });
  await adminEvent("blog.schedule", b.action === "skip" ? `${admin.name} skipped the blog run on ${b.date}` : `${admin.name} put the blog run back on ${b.date}`, undefined, "/admin/blog/calendar");
  return json({ skipDates: saved.skipDates });
}, [30, 60_000]);
