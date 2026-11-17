import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { backlogTopics, calendarMonth } from "@/lib/blog/calendar";
import { blogReady } from "@/lib/blog/llm";
import { PageHead } from "@/components/admin/ui";
import { BlogCalendar } from "@/components/admin/blog/BlogCalendar";
import { TopicBacklog } from "@/components/admin/blog/TopicBacklog";

export const metadata = { title: "Blog calendar" };

/** R1178: the real calendar (runs, drafts, approvals, publications and skipped days) and the topic backlog. */
export default async function BlogCalendarPage() {
  await requireAdmin("content");
  const [calendar, topics, cfg] = await Promise.all([calendarMonth(), backlogTopics(), getConfig("blog")]);
  return (
    <>
      <PageHead eyebrow="Content Studio" title="Calendar" body="Every run, draft and published article on the day it happened, with the daily run marked. Pick a day to generate for it, skip it, or move an approved article. Nothing goes live without a person approving it." />
      <div className="grid gap-5">
        <BlogCalendar initial={calendar} ready={blogReady()} />
        <TopicBacklog initial={topics} categories={cfg.categories} />
      </div>
    </>
  );
}
