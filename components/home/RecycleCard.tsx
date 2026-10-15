"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Thumb } from "@/components/shared/Thumb";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import type { Platform } from "@/lib/domain";

export type Recyclable = { id: string; title: string; thumb: string | null; views: number; publishedAt: string | null; platforms: string[] };

const fmt = (n: number) => new Intl.NumberFormat("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 864e5);
  return d >= 60 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 7)} weeks ago`;
};

/** Your best posts from a few weeks back: copy one into a fresh draft and send it again. */
export function RecycleCard({ posts }: { posts: Recyclable[] }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [busy, setBusy] = useState<string | null>(null);
  if (!posts.length) return null;

  async function again(p: Recyclable) {
    setBusy(p.id);
    try {
      const r = await api<{ post: { id: string } }>(`/api/posts/${p.id}/duplicate`, { method: "POST" });
      toast("Copied into a new draft. Give it a fresh caption.", "ok");
      router.push(`/create?post=${r.post.id}`);
    } catch (e) {
      setBusy(null);
      toast(e instanceof ApiError ? e.message : "Couldn't copy that post", "error");
    }
  }

  return (
    <section id="recycle" aria-labelledby={`${id}-h`} className="glass h-full min-w-0 scroll-mt-24 rounded-[32px] p-5 sm:p-6">
      <h2 id={`${id}-h`} className="eyebrow mb-1 flex items-center gap-2"><Repeat2 className="h-3.5 w-3.5" aria-hidden="true" /> Worth posting again</h2>
      <p className="mb-4 text-sm text-muted-foreground">Your best performers from a while back. Most followers never saw them.</p>
      <ul className="flex flex-col gap-2">
        {posts.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-2xl p-2">
            <Thumb src={p.thumb} alt="" className="h-16 w-12 shrink-0 rounded-xl" playOnHover={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.title}</span>
              <span className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> {fmt(p.views)} views</span>
                <span aria-hidden="true">&middot;</span>
                <span>{ago(p.publishedAt)}</span>
                <span className="ml-1 hidden -space-x-1.5 sm:flex" aria-hidden="true">{p.platforms.slice(0, 3).map((pl) => <PlatformOrb key={pl} platform={pl as Platform} size={20} ring />)}</span>
              </span>
            </span>
            <Button variant="subtle" onClick={() => again(p)} disabled={busy === p.id} aria-label={`Post "${p.title}" again`}>
              <Repeat2 className="h-4 w-4" aria-hidden="true" /> {busy === p.id ? "Copying" : "Post again"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
