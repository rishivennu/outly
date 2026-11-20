"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, PenLine, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { adminApi } from "@/lib/client/admin-api";
import { STAGE_LABEL, type BlogJobView, type BlogPostView } from "@/lib/blog/types";
import { Card, CardTitle, Pill } from "../ui";
import { StageList } from "./GenerateDesk";
import { delayedEvent } from "./calendar-grid";

/**
 * R1175 morning card. Shown on the Blog dashboard and on Overview when there is a pending article from today,
 * or a run still going. Approve here does the same server-side checks as the review desk: nothing skips them.
 */
export function TodayBlogCard({ post, job, ready, compact = false, skippedToday = false }: { post: BlogPostView | null; job: BlogJobView | null; ready: boolean; compact?: boolean; skippedToday?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"publish" | "rewrite" | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "rewrite" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // R1178: past the ready-by time the runner records a "delayed" event. The card then says the run is late,
  // at which stage and why, and makes no promise about when it will be ready.
  const late = delayedEvent(job);
  if (job && job.status === "running" && late) {
    const stage = STAGE_LABEL[job.stage as keyof typeof STAGE_LABEL] ?? job.stage;
    return (
      <Card className="border-warning/40 bg-warning/[0.05]">
        <CardTitle hint={`Still at: ${stage}.${late.message ? ` ${late.message}` : ""}`} action={<Pill tone="warn">Running late</Pill>}>Today's blog is running late</CardTitle>
        <StageList job={job} compact />
        <div className="mt-3">
          <Button asChild variant="subtle"><Link href="/admin/blog/generate">Follow the run</Link></Button>
        </div>
      </Card>
    );
  }

  if (job && job.status === "running") {
    return (
      <Card className="border-lime/40 bg-lime/[0.05]">
        <CardTitle hint={job.topic ? `Writing about: ${job.topic}` : "Finding today's topic"} action={<Pill tone="info">Running</Pill>}>Today's blog is being written</CardTitle>
        <StageList job={job} compact />
        <div className="mt-3">
          <Button asChild variant="subtle"><Link href="/admin/blog/generate">Follow the run</Link></Button>
        </div>
      </Card>
    );
  }

  if (!post) {
    if (compact) return null;
    if (skippedToday) {
      return (
        <Card className="border-dashed">
          <CardTitle hint="Today is a skip date, so the daily run does not start. Generate still works if you want an article anyway." action={<Pill tone="muted">Skipped today</Pill>}>Skipped today</CardTitle>
          <Button asChild variant="subtle"><Link href="/admin/blog/calendar">Open the calendar</Link></Button>
        </Card>
      );
    }
    return (
      <Card className="border-dashed">
        <CardTitle hint={ready ? "One click writes, researches and checks an article. You review it before anything goes live." : "Add NVIDIA_API_KEY (or KIMI_API_KEY) in the deployment settings to turn the writer on."}>No article waiting for review</CardTitle>
        {ready ? (
          <Button asChild variant="lime"><Link href="/admin/blog/generate"><Wand2 className="size-4" aria-hidden /> Generate Today's Blog</Link></Button>
        ) : (
          <Button variant="lime" disabled><Wand2 className="size-4" aria-hidden /> Generate Today's Blog</Button>
        )}
      </Card>
    );
  }

  const blocking = post.quality?.checks.filter((c) => c.critical && !c.ok) ?? [];
  async function publish() {
    setBusy("publish");
    setErr(null);
    try {
      await adminApi(`/api/admin/blog/posts/${post!.id}`, { method: "POST", json: { action: "publish" } });
      toast("Published. It is live now.");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }
  async function rewrite() {
    setBusy("rewrite");
    setErr(null);
    try {
      const r = await adminApi<{ existed: boolean }>("/api/admin/blog/jobs", { method: "POST", json: { rewriteOf: post!.id } });
      toast(r.existed ? "A run is already going" : "Regenerating. The current draft stays until the new one lands.");
      router.push("/admin/blog/generate");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  return (
    <Card className="border-lime/40 bg-lime/[0.05]">
      <CardTitle
        hint={`${post.wordCount} words, ${post.readingMin} min read, ${post.sources.filter((s) => s.verified).length} verified ${post.sources.filter((s) => s.verified).length === 1 ? "source" : "sources"}. Nothing is live until you approve it.`}
        action={<Pill tone={blocking.length ? "warn" : "ok"}>{blocking.length ? `${blocking.length} ${blocking.length === 1 ? "check" : "checks"} to fix` : "Checks passed"}</Pill>}
      >
        Your Today's Blog Is Ready!
      </CardTitle>
      <p className="text-[16px] font-semibold leading-snug">{post.title}</p>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{post.excerpt || post.metaDescription}</p>
      {blocking.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {blocking.map((c) => <li key={c.id} className="text-amber-700 dark:text-amber-300">{c.label}{c.note ? `: ${c.note}` : ""}</li>)}
        </ul>
      )}
      {err && <p role="alert" className="mt-3 text-[13px] text-destructive">{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="primary"><Link href={`/admin/blog/review/${post.id}`}><PenLine className="size-4" aria-hidden /> Review & Edit</Link></Button>
        <Button variant="subtle" disabled={busy !== null} onClick={() => setConfirm("rewrite")}>{busy === "rewrite" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} Regenerate</Button>
        <Button variant="lime" disabled={busy !== null || blocking.length > 0} title={blocking.length ? "Fix the failing checks on the review desk first" : undefined} onClick={() => setConfirm("publish")}>{busy === "publish" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="size-4" aria-hidden />} Approve & Publish</Button>
      </div>
      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publish this article?"
        body={`"${post.title}" goes live at /blog/${post.slug} right away and is added to the sitemap. You can take it offline later from the library.`}
        confirmLabel="Publish"
        cancelLabel="Not yet"
        busy={busy === "publish"}
        tone="primary"
        onConfirm={publish}
      />
      <ConfirmDialog
        open={confirm === "rewrite"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Write it again from scratch?"
        body="A new run starts on the same topic. This draft is kept until the new one lands, then it is marked rejected."
        confirmLabel="Regenerate"
        cancelLabel="Keep this draft"
        busy={busy === "rewrite"}
        tone="primary"
        onConfirm={rewrite}
      />
    </Card>
  );
}
