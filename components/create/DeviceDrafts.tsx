"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Film, HardDrive, X } from "lucide-react";
import { ago, DRAFT_TTL_DAYS, listDeviceDrafts, removeDeviceDraft, type DeviceDraft } from "@/lib/client/device-drafts";
import { cn } from "@/lib/utils";

/**
 * Drafts saved in this browser. Shown on an empty Create stage and on the Drafts tab, so a draft
 * whose server copy expired after DRAFT_TTL_DAYS can still be picked up (the video comes along).
 */
export function DeviceDrafts({ className, limit = 3, heading = "Saved on this device", grid = "grid-cols-1" }: { className?: string; limit?: number; heading?: string; grid?: string }) {
  const [items, setItems] = useState<DeviceDraft[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void listDeviceDrafts().then((all) => {
      if (!alive) return;
      setItems(all);
      const u: Record<string, string> = {};
      for (const d of all) if (d.poster) u[d.id] = URL.createObjectURL(d.poster);
      setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);

  if (!items?.length) return null;
  const shown = items.slice(0, limit);

  const remove = async (id: string) => {
    await removeDeviceDraft(id);
    setItems((xs) => (xs ?? []).filter((x) => x.id !== id));
    const u = urls[id];
    if (u) {
      URL.revokeObjectURL(u);
      setUrls(({ [id]: _gone, ...rest }) => rest);
    }
  };

  return (
    <section aria-labelledby="device-drafts" className={cn("w-full", className)}>
      <div className="mb-3 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 id="device-drafts" className="text-sm font-semibold">{heading}</h2>
      </div>
      <ul className={cn("grid gap-3", grid)}>
        {shown.map((d) => (
          <li key={d.id} className="glass hairline flex items-center gap-3 rounded-2xl p-2.5 pr-1.5">
            <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-secondary">
              {urls[d.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[d.id]} alt="" className="h-full w-full object-cover" />
              ) : (
                <Film className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{d.title || "Untitled draft"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {ago(d.updatedAt)}
                {d.videoKey ? " · video kept" : " · words only"}
              </p>
              <Link href={`/create?local=${encodeURIComponent(d.id)}`} className="inline-flex min-h-[44px] items-center text-xs font-semibold underline underline-offset-4">
                Pick it up
              </Link>
            </div>
            <button type="button" onClick={() => remove(d.id)} aria-label={`Remove "${d.title || "Untitled draft"}" from this device`} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Drafts you don&apos;t touch for {DRAFT_TTL_DAYS} days are removed from Outlly. The copy in this browser stays until you remove it.
      </p>
    </section>
  );
}
