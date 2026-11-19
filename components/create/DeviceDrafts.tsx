"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Film, HardDrive, X } from "lucide-react";
import { ago, openDrafts, type DeviceDraft } from "@/lib/client/device-drafts";
import { useUser } from "@/components/shell/UserContext";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 1170: one row for a draft, the same on this device and on Outlly: thumbnail, name, facts, status, actions. */
export function DraftRow({ thumb, title, meta, status, resumeHref, onPreview, onRemove, removeLabel }: { thumb: string | null; title: string; meta: string; status: string; resumeHref: string; onPreview?: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl bg-card/60 p-2 pr-1.5 hairline">
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <Film className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={title}>{title}</p>
        <p className="truncate text-xs tabular-nums text-muted-foreground">
          {meta}
          <span aria-hidden="true"> · </span>
          <span>{status}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {onPreview && (
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onPreview} aria-label={`Preview "${title}"`} aria-haspopup="dialog">
            <Eye className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button asChild variant="subtle" size="sm" className="min-h-11 px-3.5">
          <Link href={resumeHref} aria-label={`Resume "${title}"`}>Resume</Link>
        </Button>
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="gbtn-icon ripple-host grid h-11 w-11 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * Drafts saved in this browser. Shown on Create's first step and on the Drafts tab, so a draft whose server copy
 * was deleted can still be picked up (the video comes along). `hidePosts` leaves out the ones
 * already listed with the drafts on Outlly, so one draft is never shown twice.
 */
export function DeviceDrafts({ className, limit = 3, heading = "Saved on this device", grid = "grid-cols-1", hidePosts, note, onCount, level = 2 }: { className?: string; limit?: number; heading?: string; grid?: string; hidePosts?: string[]; note?: React.ReactNode; onCount?: (n: number) => void; level?: 2 | 3 }) {
  const H = level === 3 ? "h3" : "h2";
  const [items, setItems] = useState<DeviceDraft[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<DeviceDraft | null>(null);
  const user = useUser();
  const store = useMemo(() => openDrafts(user.id), [user.id]);

  useEffect(() => {
    let alive = true;
    void store.list().then((all) => {
      if (!alive) return;
      setItems(all);
      const u: Record<string, string> = {};
      for (const d of all) if (d.poster) u[d.id] = URL.createObjectURL(d.poster);
      setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, [store]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const hidden = useMemo(() => new Set(hidePosts ?? []), [hidePosts]);
  const visible = (items ?? []).filter((d) => !d.postId || !hidden.has(d.postId));
  useEffect(() => {
    if (items) onCount?.(visible.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, visible.length]);

  if (!visible.length) return null;
  const shown = visible.slice(0, limit);

  const remove = async (id: string) => {
    await store.remove(id);
    setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    const u = urls[id];
    if (u) {
      URL.revokeObjectURL(u);
      setUrls(({ [id]: _gone, ...rest }) => rest);
    }
  };

  return (
    <section aria-labelledby="device-drafts" className={cn("w-full", className)}>
      <div className="mb-2.5 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <H id="device-drafts" className="text-sm font-semibold">{heading}</H>
        <span className="text-xs tabular-nums text-muted-foreground">{visible.length}</span>
      </div>
      <ul className={cn("grid gap-2", grid)}>
        {shown.map((d) => (
          <DraftRow
            key={d.id}
            thumb={urls[d.id] ?? null}
            title={d.title || d.filename || "Untitled draft"}
            meta={`Saved ${ago(d.updatedAt)}`}
            status={d.videoKey ? (d.postId ? "Video kept, also on Outlly" : "Video kept") : "Words only"}
            resumeHref={`/create?local=${encodeURIComponent(d.id)}`}
            onRemove={() => setAsking(d)}
            removeLabel={`Remove "${d.title || "Untitled draft"}" from this device`}
          />
        ))}
      </ul>
      {visible.length > shown.length && <p className="mt-2 text-xs text-muted-foreground">And {visible.length - shown.length} more on this device.</p>}
      <ConfirmDialog
        open={!!asking}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Remove this draft from this device?"
        body={asking?.postId ? "The copy on Outlly stays in your drafts. Only this browser's copy goes." : "This copy is only on this device, so its words and video go for good."}
        confirmLabel="Remove"
        onConfirm={() => {
          const d = asking;
          setAsking(null);
          if (d) void remove(d.id);
        }}
      />
      <p className="mt-2.5 text-xs text-muted-foreground">
        {note ?? <>The copy in this browser stays until you remove it, even if the draft on Outlly is deleted.</>}
      </p>
    </section>
  );
}
