import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getConfig } from "@/lib/settings";
import { blogStats, listPosts, todayBlog } from "@/lib/blog/posts";
import { localDay } from "@/lib/blog/job";
import { blogReady } from "@/lib/blog/llm";
import { Card, CardTitle, Empty, PageHead, Pill, Table, fmtDate } from "@/components/admin/ui";
import { TodayBlogCard } from "@/components/admin/blog/TodayBlogCard";

export const metadata = { title: "Blog" };

/** R1175 Content Studio home: today's article, the queue, and the numbers that matter. */
export default async function BlogDashboard() {
  await requireAdmin("content");
  const cfg = await getConfig("blog");
  const [stats, pending, today] = await Promise.all([blogStats(), listPosts({ status: "pending", take: 20 }), todayBlog()]);
  const ready = blogReady();
  const sched = cfg.schedule;
  return (
    <>
      <PageHead
        eyebrow="Content Studio"
        title="Blog"
        body={`One article a day, published only when you approve it. ${cfg.paused ? "Scheduled runs are paused." : sched.enabled ? `The next scheduled run starts at ${sched.startTime} ${cfg.timezone} and should be ready by ${sched.readyBy}.` : "Scheduled runs are off; use Generate when you want one."}`}
        actions={<Link href="/admin/blog/generate" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Generate Today's Blog</Link>}
      />
      <div className="mb-5">
        <TodayBlogCard post={today.post} job={today.job} ready={ready} skippedToday={(cfg.skipDates ?? []).includes(localDay(cfg.timezone))} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Waiting for review", value: stats.pending, href: "/admin/blog/library?status=pending" },
          { label: "Published", value: stats.published, href: "/admin/blog/library?status=published" },
          { label: "Topics covered", value: stats.topics, href: "/admin/blog/calendar" },
          { label: "Rejected", value: stats.rejected, href: "/admin/blog/library?status=rejected" },
        ].map((k) => (
          <Link key={k.label} href={k.href} className="rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary/60">
            <p className="text-[12.5px] text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
          </Link>
        ))}
      </div>
      <Card>
        <CardTitle hint={stats.lastPublished ? `Last published: ${stats.lastPublished.title}, ${fmtDate(stats.lastPublished.at)}.` : "Nothing published yet."} action={<Link href="/admin/blog/library" className="inline-flex min-h-11 items-center text-[13px] underline underline-offset-4">Open library</Link>}>Pending approval</CardTitle>
        {pending.length === 0 ? (
          <Empty title="The queue is empty" body="Articles land here after a run finishes. Each one waits for a person to approve it." />
        ) : (
          <Table head={["Article", "Category", "Checks", "Created", ""]} label="Pending articles" lead={1} minWidth={640}>
            {pending.map((p) => {
              const bad = p.quality?.checks.filter((c) => c.critical && !c.ok).length ?? 0;
              return (
                <tr key={p.id}>
                  <td><Link href={`/admin/blog/review/${p.id}`} className="font-medium underline-offset-4 hover:underline">{p.title}</Link><span className="block text-[12px] text-muted-foreground">{p.wordCount} words, {p.readingMin} min</span></td>
                  <td>{p.category}</td>
                  <td>{bad ? <Pill tone="warn">{bad} to fix</Pill> : <Pill tone="ok">Passed</Pill>}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{fmtDate(p.createdAt, true)}</td>
                  <td className="text-right"><Link href={`/admin/blog/review/${p.id}`} className="inline-flex min-h-11 items-center px-2 text-[13px] underline underline-offset-4">Review</Link></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
