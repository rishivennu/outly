"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Cloud } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Sheet } from "@/components/shared/Sheet";
import { useToast } from "@/components/shared/Toast";
import { cn } from "@/lib/utils";
import { DeviceDrafts, DraftRow } from "./DeviceDrafts";
import type { PostView } from "./types";

/**
 * 1170: Step 1's "Pick up where you left off". Two kinds of draft, said plainly:
 *  - On Outlly: saved to the account (GET /api/posts?status=draft), open on any device; kept until deleted (R1209).
 *  - On this device: kept in this browser (IndexedDB), video included, until removed here.
 * A draft that is in both shows once, with the Outlly ones.
 */
const SHOWN = 4;

export const draftName = (p: Pick<PostView, "title" | "hook"> & { media: { filename: string | null } | null }) => p.title?.trim() || p.hook?.trim() || p.media?.filename || "Untitled draft";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function savedAgo(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Saved just now";
  if (m < 60) return `Saved ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Saved ${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Saved yesterday" : `Saved ${d} days ago`;
}

export function SavedDrafts({ className }: { className?: string }) {
  const toast = useToast();
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);
  const [asking, setAsking] = useState<PostView | null>(null);
  const [previewing, setPreviewing] = useState<PostView | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ posts: PostView[] }>("/api/posts?status=draft").then(
      (r) => alive && setPosts(r.posts),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (p: PostView) => {
    try {
      await api(`/api/posts/${p.id}`, { method: "DELETE" });
      setPosts((xs) => (xs ?? []).filter((x) => x.id !== p.id));
      toast("Draft removed.");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't remove that draft. Try again.", "error");
    }
  };

  const cloud = posts ?? [];
  const shown = cloud.slice(0, SHOWN);
  // Nothing to pick up (or still loading with nothing on this device): the section stays out of the way, but the
  // device list stays mounted so it can say how many it holds.
  const hide = (posts === null && !failed && !deviceCount) || (posts !== null && !cloud.length && !deviceCount && !failed);

  return (
    <section aria-labelledby="saved-drafts" data-testid="saved-drafts" hidden={hide || undefined} className={cn("w-full", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="saved-drafts" className="text-base font-semibold tracking-[-0.01em]">Pick up where you left off</h2>
        {cloud.length > SHOWN && (
          <Link href="/content?filter=draft" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
            All {cloud.length} drafts
          </Link>
        )}
      </div>
      <div className={cn("grid gap-6 lg:gap-5", (cloud.length > 0 || failed) && deviceCount > 0 && "lg:grid-cols-2")}>
        {(cloud.length > 0 || failed) && (
          <section aria-labelledby="cloud-drafts" className="min-w-0">
            <div className="mb-2.5 flex items-center gap-2">
              <Cloud className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h3 id="cloud-drafts" className="text-sm font-semibold">On Outlly</h3>
              {cloud.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{cloud.length}</span>}
            </div>
            {failed ? (
              <p className="text-sm text-muted-foreground">Your drafts on Outlly didn&apos;t load. They are safe; open Content to see them.</p>
            ) : (
              <ul className="grid gap-2">
                {shown.map((p) => {
                  const name = draftName(p);
                  const facts = [savedAgo(p.updatedAt), p.media?.duration ? clock(p.media.duration) : null].filter(Boolean).join(" · ");
                  const places = p.targets.length;
                  return (
                    <DraftRow
                      key={p.id}
                      thumb={p.coverUrl ?? p.media?.thumbnailUrl ?? null}
                      title={name}
                      meta={facts}
                      status={p.format !== "video" ? "Photo draft" : p.hook ? `Draft, ${places} place${places === 1 ? "" : "s"}` : "Draft, no hook yet"}
                      resumeHref={`/create?post=${p.id}`}
                      onPreview={p.media?.url ? () => setPreviewing(p) : undefined}
                      onRemove={() => setAsking(p)}
                      removeLabel={`Remove "${name}" from your drafts`}
                    />
                  );
                })}
              </ul>
            )}
            <p className="mt-2.5 text-xs text-muted-foreground">Saved to your account, so they open on any device. They stay until you delete them.</p>
          </section>
        )}
        <DeviceDrafts
          level={3}
          className="min-w-0"
          limit={SHOWN}
          heading="On this device"
          hidePosts={cloud.map((p) => p.id)}
          onCount={setDeviceCount}
          note="Kept in this browser only, video included, until you remove it. Handy if a draft on Outlly was deleted."
        />
      </div>
      <ConfirmDialog
        open={!!asking}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Remove this draft?"
        body="It comes off your drafts on Outlly for every device. A copy saved in this browser stays until you remove it too."
        confirmLabel="Remove draft"
        onConfirm={() => {
          const p = asking;
          setAsking(null);
          if (p) void remove(p);
        }}
      />
      <Sheet open={!!previewing} onOpenChange={(o) => !o && setPreviewing(null)} title={previewing ? draftName(previewing) : "Preview"} description="The video saved with this draft." side="center">
        {previewing?.media?.url && (
          <video src={previewing.media.url} poster={previewing.coverUrl ?? previewing.media.thumbnailUrl ?? undefined} controls playsInline preload="metadata" className="mx-auto max-h-[65dvh] w-full max-w-[360px] rounded-2xl bg-black" />
        )}
      </Sheet>
    </section>
  );
}
