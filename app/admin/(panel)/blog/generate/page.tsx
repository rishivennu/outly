import { requireAdmin } from "@/lib/admin/guard";
import { db } from "@/lib/db";
import { recentJobs, toView } from "@/lib/blog/job";
import { blogReady, blogWebReady } from "@/lib/blog/llm";
import { blogHistory } from "@/lib/blog/calendar";
import { getConfig } from "@/lib/settings";
import { todayIn } from "@/components/admin/blog/zoned";
import { PageHead } from "@/components/admin/ui";
import { GenerateDesk } from "@/components/admin/blog/GenerateDesk";

export const metadata = { title: "Generate blog" };

export default async function Generate() {
  await requireAdmin("content");
  const [running, jobs, history, cfg] = await Promise.all([
    db.blogJob.findFirst({ where: { status: "running" }, orderBy: { startedAt: "desc" }, include: { events: { orderBy: { createdAt: "asc" } } } }),
    recentJobs(30),
    blogHistory(60),
    getConfig("blog"),
  ]);
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Generate blog" body="One click: topic, research, outline, drafts, SEO, quality check. It lands in Pending approval." />
      <GenerateDesk initial={{ running: running ? toView(running) : null, jobs, ready: blogReady(), web: blogWebReady() }} history={history} timezone={cfg.timezone} today={todayIn(cfg.timezone)} />
    </>
  );
}
