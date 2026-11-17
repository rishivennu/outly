import { json, HttpError } from "@/lib/http";
import { adminRoute } from "@/lib/admin/route";
import { JobError } from "@/lib/blog/job";
import { calendarMonth } from "@/lib/blog/calendar";

export const dynamic = "force-dynamic";

/** R1178: one month of runs and articles, laid out on the blog timezone's days. */
export const GET = adminRoute("content", async (req) => {
  const month = req.nextUrl.searchParams.get("month") || undefined;
  try {
    return json({ calendar: await calendarMonth(month) });
  } catch (e) {
    if (e instanceof JobError) throw new HttpError(e.status, e.message, "JOB");
    throw e;
  }
});
