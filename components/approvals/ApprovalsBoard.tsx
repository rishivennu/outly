"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, Clock, MessageSquareWarning, Plus, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon3D } from "@/components/brand/Icon3D";
import { Thumb } from "@/components/shared/Thumb";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PostSheet } from "@/components/posts/PostSheet";
import { fmt, useUser } from "@/components/shell/UserContext";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/domain";
import type { PostView } from "@/lib/services";

type Lane = "needs" | "waiting" | "changes" | "approved";

/** Where a post sits in the team's review, from its latest review request. */
export function laneOf(p: Pick<PostView, "requireApproval" | "review" | "approved">): Lane | null {
  const r = p.review;
  if (r?.status === "approved" || p.approved) return "approved";
  if (r?.status === "changes_requested") return "changes";
  if (r?.status === "pending" && !r.expired) return "waiting";
  if (p.requireApproval || r) return "needs";
  return null;
}

const EMPTY: Record<Lane, string> = {
  needs: "Nothing waiting for a reviewer.",
  waiting: "No review links out right now.",
  changes: "No change requests. Nice.",
  approved: "Nothing approved yet.",
};

const LANES: { k: Lane; title: string; blurb: string; icon: typeof Check; tone: string }[] = [
  { k: "needs", title: "Needs a reviewer", blurb: "Approval is on, but nobody has the link yet (or it expired).", icon: ShieldQuestion, tone: "text-muted-foreground" },
  { k: "waiting", title: "Waiting on review", blurb: "A teammate has the link. It works for 7 days.", icon: Clock, tone: "text-[hsl(var(--youtube))]" },
  { k: "changes", title: "Changes requested", blurb: "Read the note, fix it, then send a fresh link.", icon: MessageSquareWarning, tone: "text-warning" },
  { k: "approved", title: "Approved", blurb: "Cleared to go out on schedule.", icon: Check, tone: "text-success" },
];

export function ApprovalsBoard({ initial }: { initial: PostView[] }) {
  const [posts, setPosts] = useState(initial);
  const [open, setOpen] = useState<PostView | null>(null);
  const { timezone: tz } = useUser();
  const lanes = useMemo(() => {
    const m: Record<Lane, PostView[]> = { needs: [], waiting: [], changes: [], approved: [] };
    for (const p of posts) {
      const l = laneOf(p);
      if (l) m[l].push(p);
    }
    return m;
  }, [posts]);
  const total = posts.filter((p) => laneOf(p)).length;

  return (
    <div className="px-5 pb-16 pt-8 sm:px-10 lg:pt-14">
      <p className="eyebrow mb-3">Team approvals</p>
      <h1 className="display max-w-3xl text-[clamp(2.6rem,6vw,4.6rem)]">Nothing goes out until it&apos;s cleared.</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Turn on approval for a post and send its review link to a teammate or client. They see the video and every caption, no account needed, and approve it or ask for changes.
      </p>

      {total === 0 ? (
        <div className="mt-10 grid place-items-center rounded-[28px] bg-secondary/40 px-6 py-14 text-center hairline">
          <Icon3D name="approval" size={96} className="animate-bob mb-6" />
          <p className="text-lg font-semibold">No posts are waiting for approval.</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Open any draft or scheduled post, switch on &quot;Needs approval&quot; and send the link. It shows up here so you can track it.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button asChild variant="lime">
              <Link href="/content">Pick a post</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/create">
                <Plus className="h-4 w-4" /> New post
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((l) => (
            <section key={l.k} aria-labelledby={`lane-${l.k}`} className="flex flex-col rounded-[28px] bg-secondary/35 p-3 hairline">
              <header className="px-2 pb-3 pt-1">
                <h2 id={`lane-${l.k}`} className="flex items-center gap-2 text-[15px] font-semibold">
                  <l.icon className={cn("h-4 w-4", l.tone)} aria-hidden="true" /> {l.title}
                  <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs tabular hairline">{lanes[l.k].length}</span>
                </h2>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{l.blurb}</p>
              </header>
              <ul className="flex flex-1 flex-col gap-2">
                {lanes[l.k].length === 0 && <li className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">{EMPTY[l.k]}</li>}
                {lanes[l.k].map((p, i) => (
                  <motion.li key={p.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <button onClick={() => setOpen(p)} className="glass group flex w-full gap-3 rounded-2xl p-2.5 text-left transition-transform duration-200 hover:-translate-y-0.5">
                      <span className="relative block h-[72px] w-12 shrink-0 overflow-hidden rounded-xl bg-secondary">
                        <Thumb src={p.media.thumbnailUrl} alt="" className="absolute inset-0" playOnHover={false} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{p.title ?? p.hook?.split("\n")[0] ?? "Untitled"}</span>
                        <span className="mt-1 flex items-center gap-1">
                          {p.targets.map((t) => (
                            <PlatformOrb key={t.id} platform={t.platform as Platform} size={18} />
                          ))}
                          <span className="ml-1 truncate text-xs text-muted-foreground">
                            {p.scheduledAt ? `Goes out ${fmt(p.scheduledAt, tz, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "Not scheduled"}
                          </span>
                        </span>
                        {p.review && (l.k === "changes" || l.k === "approved") && (
                          <span className="mt-1.5 block text-xs leading-snug text-muted-foreground">
                            <strong className="font-semibold text-foreground">{p.review.reviewerName ?? "Reviewer"}</strong>
                            {p.review.note ? `: "${p.review.note.slice(0, 90)}${p.review.note.length > 90 ? "…" : ""}"` : l.k === "approved" ? " approved it" : ""}
                          </span>
                        )}
                        {l.k === "waiting" && p.review && <span className="mt-1.5 block text-xs text-muted-foreground">Link sent {fmt(p.review.createdAt, tz, { month: "short", day: "numeric" })}, expires {fmt(p.review.expiresAt, tz, { month: "short", day: "numeric" })}</span>}
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <PostSheet
        post={open}
        onClose={() => setOpen(null)}
        onChange={(np) => {
          setPosts((ps) => ps.map((x) => (x.id === np.id ? np : x)));
          setOpen(np);
        }}
        onRemove={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))}
        onDuplicate={(np) => {
          setPosts((ps) => [np, ...ps]);
          setOpen(np);
        }}
      />
    </div>
  );
}
