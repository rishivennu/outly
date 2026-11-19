"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { FileImage, FileVideo, HardDrive, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { api, ApiError } from "@/lib/client/api";
import { QuotaCard, type QuotaView } from "@/components/billing/QuotaCard";
import { fmtBytes, fmtDay } from "@/lib/storage/quota-core";
import { cn } from "@/lib/utils";

type FileRow = { id: string; name: string; kind: "video" | "image"; bytes: number; uploadedAt: string; status: "active" | "trash"; deletedAt: string | null; purgeAt: string | null; usedBy: { id: string; title: string; status: string; href: string }[]; freesBytes: number };
type DraftRow = { id: string; title: string; updatedAt: string; createdAt: string; href: string; mediaBytes: number; ownBytes: number; files: number };
type Listing = { usage: QuotaView; files: FileRow[]; drafts: DraftRow[]; totals: { activeBytes: number; trashBytes: number; files: number; trash: number; drafts: number }; paidStorage: boolean };
type Sort = "largest" | "oldest" | "recent" | "drafts";
type Pending = { kind: "trash" | "purge"; file: FileRow } | { kind: "draft"; draft: DraftRow } | null;

const SORTS: { id: Sort; label: string }[] = [
  { id: "largest", label: "Largest" },
  { id: "oldest", label: "Oldest" },
  { id: "recent", label: "Recently uploaded" },
  { id: "drafts", label: "Drafts" },
];

/** How a delete touches the plan, said plainly before it happens. */
function effect(paid: boolean, monthly: boolean, bytes: number, kind: "trash" | "purge" | "draft") {
  const parts: string[] = [];
  if (kind === "trash") parts.push(paid ? `It still counts toward your storage while it is in Trash. Trash is emptied after 30 days, or delete it for good to free ${fmtBytes(bytes)} now.` : "You can restore it from Trash for 30 days.");
  else if (paid) parts.push(bytes > 0 ? `This frees ${fmtBytes(bytes)} of your storage.` : "No storage is freed.");
  if (monthly) parts.push("Your monthly upload allowance is not given back by deleting.");
  return parts.join(" ");
}

/**
 * R1209: Settings, Storage. Every uploaded file and saved draft with its real size (GET /api/storage/files),
 * and the four actions: Trash, Restore, Delete for good, Delete draft (keeping or deleting its media).
 */
export function StorageManager() {
  const id = useId();
  const toast = useToast();
  const [sort, setSort] = useState<Sort>("largest");
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [dropMedia, setDropMedia] = useState(false);

  const load = useCallback(async (s: Sort) => {
    try {
      setData(await api<Listing>(`/api/storage/files?sort=${s}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't load your files. Try again in a moment.");
    }
  }, []);
  useEffect(() => { void load(sort); }, [load, sort]);

  const paid = !!data?.paidStorage;
  const monthly = !!data?.usage.monthly && !data.usage.monthly.unlimited;

  const run = async (key: string, fn: () => Promise<{ freedBytes?: number; pendingBytes?: number }>, done: (r: { freedBytes?: number; pendingBytes?: number }) => string) => {
    setBusy(key);
    try {
      const r = await fn();
      toast(done(r));
      await load(sort);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "That didn't go through. Nothing changed.", "error");
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  const confirm = () => {
    const p = pending;
    if (!p) return;
    if (p.kind !== "draft") {
      const f = p.file;
      if (p.kind === "trash") return run(f.id, () => api(`/api/media/${f.id}`, { method: "DELETE" }), () => "Moved to Trash. Restore it any time in the next 30 days.");
      return run(f.id, () => api(`/api/media/${f.id}?purge=1`, { method: "DELETE" }), (r) => (paid && r.freedBytes ? `Deleted for good. ${fmtBytes(r.freedBytes)} of storage freed.` : "Deleted for good."));
    }
    const d = p.draft;
    return run(d.id, () => api(`/api/posts/${d.id}?media=${dropMedia ? "delete" : "keep"}`, { method: "DELETE" }), (r) => (dropMedia ? (r.pendingBytes ? "Draft deleted. Its media is still being cleared from storage, so the space frees up shortly." : paid && r.freedBytes ? `Draft and its media deleted. ${fmtBytes(r.freedBytes)} of storage freed.` : "Draft and its media deleted.") : "Draft deleted. Its media is still in your files."));
  };

  const restore = (f: FileRow) => run(f.id, () => api(`/api/media/${f.id}/restore`, { method: "POST" }), () => "Restored. It is back with your files.");

  const dialog = (() => {
    if (!pending) return null;
    if (pending.kind === "draft") {
      const d = pending.draft;
      return {
        title: `Delete "${d.title}"?`,
        body: dropMedia ? effect(paid, monthly, d.ownBytes, "draft") || "The draft and the media only it uses are deleted for good." : "The draft is deleted. Its media stays in your files, so it still counts toward your storage.",
        label: dropMedia ? "Delete draft and media" : "Delete draft",
      };
    }
    const f = pending.file;
    return pending.kind === "trash"
      ? { title: `Move "${f.name}" to Trash?`, body: effect(paid, monthly, f.bytes, "trash"), label: "Move to Trash" }
      : { title: `Delete "${f.name}" for good?`, body: `${effect(paid, monthly, f.bytes, "purge")} This can't be undone.`.trim(), label: "Delete for good" };
  })();

  return (
    <section id="storage" className="glass scroll-mt-24 rounded-[32px] p-6 sm:p-8" aria-labelledby={`${id}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><HardDrive className="h-5 w-5" aria-hidden /> Storage</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your uploaded videos and images, and the drafts that use them. Sizes are the real files.</p>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-2xl bg-destructive/10 p-3 text-sm">{error}</p>}
      {!data && !error && <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading your files</p>}

      {data && (
        <>
          <QuotaCard q={data.usage} manageHref="#storage-files" />
          <div role="group" aria-label="Sort files" className="mt-6 flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                className={cn(
                  "min-h-11 rounded-full px-4 text-[13px] font-medium hairline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  sort === s.id ? "bg-foreground text-background" : "bg-secondary/50 [@media(hover:hover)]:hover:bg-secondary",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {sort === "drafts" && (
            <div className="mt-5">
              <h3 className="text-[15px] font-semibold">Saved drafts ({data.drafts.length})</h3>
              {data.drafts.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No saved drafts. Drafts are kept until you delete them.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60">
                  {data.drafts.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="block truncate text-[14px] font-medium">{d.title}</span>
                        <span className="block text-[12px] text-muted-foreground tabular">
                          {d.files} file{d.files === 1 ? "" : "s"}, {fmtBytes(d.mediaBytes)} · edited {fmtDay(d.updatedAt)}
                        </span>
                      </span>
                      <Button asChild size="sm" variant="outline" className="min-h-11"><Link href={d.href}>Resume draft</Link></Button>
                      <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy === d.id} onClick={() => { setDropMedia(false); setPending({ kind: "draft", draft: d }); }}>
                        <Trash2 className="h-4 w-4" aria-hidden /> Delete draft
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div id="storage-files" className="mt-5 scroll-mt-24">
            <h3 className="text-[15px] font-semibold">
              Files ({data.totals.files}){data.totals.trash > 0 && <span className="font-normal text-muted-foreground">, {data.totals.trash} in Trash ({fmtBytes(data.totals.trashBytes)})</span>}
            </h3>
            {data.files.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing uploaded yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border/60">
                {data.files.map((f) => {
                  const Icon = f.kind === "image" ? FileImage : FileVideo;
                  const trash = f.status === "trash";
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary"><Icon className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="block truncate text-[14px] font-medium">{f.name}</span>
                        <span className="block text-[12px] text-muted-foreground tabular">
                          {fmtBytes(f.bytes)} · uploaded {fmtDay(f.uploadedAt)}
                          {paid && !trash && ` · counts ${fmtBytes(f.bytes)} toward storage`}
                        </span>
                        <span className="mt-0.5 block text-[12px]">
                          {trash ? (
                            <span className="font-medium text-[hsl(0_72%_38%)] dark:text-destructive">In Trash, deleted for good on {fmtDay(f.purgeAt!)}</span>
                          ) : f.usedBy.length ? (
                            <>
                              Used by{" "}
                              {f.usedBy.map((p, i) => (
                                <span key={p.id}>
                                  {i > 0 && ", "}
                                  <Link href={p.href} className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{p.title}</Link>
                                  {p.status === "draft" ? " (draft)" : ""}
                                </span>
                              ))}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Active, not used by any post or draft</span>
                          )}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {trash ? (
                          <>
                            <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy === f.id} onClick={() => restore(f)}>
                              <RotateCcw className="h-4 w-4" aria-hidden /> Restore
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy === f.id} onClick={() => setPending({ kind: "purge", file: f })}>
                              Delete for good
                            </Button>
                          </>
                        ) : f.usedBy.length ? (
                          <span className="max-w-[16rem] text-[12px] text-muted-foreground">Delete the draft to remove this file.</span>
                        ) : (
                          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy === f.id} onClick={() => setPending({ kind: "trash", file: f })}>
                            <Trash2 className="h-4 w-4" aria-hidden /> Delete file
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={dialog?.title ?? ""}
        body={dialog?.body ?? ""}
        confirmLabel={dialog?.label ?? "Delete"}
        busy={!!busy}
        onConfirm={() => void confirm()}
        extra={
          pending?.kind === "draft" ? (
            <fieldset className="mt-1 space-y-2">
              <legend className="mb-1 text-[13px] font-medium">Its media</legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-secondary/50 px-3 text-[13px]">
                <input type="radio" name={`${id}-media`} checked={!dropMedia} onChange={() => setDropMedia(false)} className="h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
                Keep the media in my files
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl bg-secondary/50 px-3 text-[13px]">
                <input type="radio" name={`${id}-media`} checked={dropMedia} onChange={() => setDropMedia(true)} className="h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" />
                Delete its media too ({fmtBytes(pending.draft.ownBytes)} only this draft uses)
              </label>
            </fieldset>
          ) : undefined
        }
      />
    </section>
  );
}
