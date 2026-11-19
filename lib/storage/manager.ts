import "server-only";
import { db } from "../db";
import { mediaBytes, storageUsageFor } from "./quota";
import { purgeAt } from "./lifecycle";
import { usesStorage } from "./quota-core";

/** R1209: what Settings, Storage lists. Every figure comes from the rows; nothing is estimated. */
export const STORAGE_SORTS = ["largest", "oldest", "recent", "drafts"] as const;
export type StorageSort = (typeof STORAGE_SORTS)[number];

export interface StorageFileRow {
  id: string;
  name: string;
  kind: "video" | "image";
  bytes: number;
  uploadedAt: string;
  status: "active" | "trash";
  deletedAt: string | null;
  purgeAt: string | null;
  usedBy: { id: string; title: string; status: string; href: string }[];
  /** Bytes a permanent delete would give back to paid storage (0 on a monthly-only plan). */
  freesBytes: number;
}

export interface StorageDraftRow {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  href: string;
  mediaBytes: number;
  /** Of those bytes, the ones only this draft uses (what "delete its media" removes). */
  ownBytes: number;
  files: number;
}

const titleOf = (t: string | null | undefined) => (t?.trim() ? t.trim().slice(0, 80) : "Untitled draft");
const resume = (p: { id: string; status: string }) => (p.status === "draft" ? `/create?post=${p.id}` : `/content?open=${p.id}`);

export async function storageFiles(userId: string, sort: StorageSort = "largest", now = new Date()) {
  const [usage, media, drafts] = await Promise.all([
    storageUsageFor(userId, now),
    db.media.findMany({
      where: { userId, status: { notIn: ["failed", "uploading"] } },
      select: {
        id: true, originalFilename: true, mimeType: true, size: true, sizeBytes: true, createdAt: true, deletedAt: true,
        posts: { select: { id: true, title: true, status: true } },
        postItems: { select: { post: { select: { id: true, title: true, status: true } } } },
      },
      take: 1000,
    }),
    db.post.findMany({
      where: { userId, status: "draft" },
      select: { id: true, title: true, createdAt: true, updatedAt: true, mediaId: true, items: { select: { mediaId: true } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);
  const paid = usesStorage(usage.policy);
  const byId = new Map(media.map((m) => [m.id, m]));
  const files: StorageFileRow[] = media.map((m) => {
    const users = new Map<string, { id: string; title: string | null; status: string }>();
    for (const p of [...m.posts, ...m.postItems.map((i) => i.post)]) users.set(p.id, p);
    const bytes = mediaBytes(m);
    return {
      id: m.id, name: m.originalFilename, kind: m.mimeType.startsWith("image/") ? "image" : "video", bytes, uploadedAt: m.createdAt.toISOString(),
      status: m.deletedAt ? "trash" : "active", deletedAt: m.deletedAt?.toISOString() ?? null, purgeAt: m.deletedAt ? purgeAt(m.deletedAt).toISOString() : null,
      usedBy: [...users.values()].map((p) => ({ id: p.id, title: titleOf(p.title), status: p.status, href: resume(p) })),
      freesBytes: paid ? bytes : 0,
    };
  });
  const uses = new Map<string, number>();
  for (const f of files) uses.set(f.id, f.usedBy.length);
  const draftRows: StorageDraftRow[] = drafts.map((d) => {
    const ids = [...new Set([d.mediaId, ...d.items.map((i) => i.mediaId)])].filter((id) => byId.has(id));
    const sizeOf = (id: string) => mediaBytes(byId.get(id)!);
    return {
      id: d.id, title: titleOf(d.title), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(), href: `/create?post=${d.id}`,
      mediaBytes: ids.reduce((a, id) => a + sizeOf(id), 0), ownBytes: ids.filter((id) => (uses.get(id) ?? 0) <= 1).reduce((a, id) => a + sizeOf(id), 0), files: ids.length,
    };
  });
  const order: Record<StorageSort, (a: StorageFileRow, b: StorageFileRow) => number> = {
    largest: (a, b) => b.bytes - a.bytes,
    oldest: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
    recent: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
    drafts: (a, b) => Number(b.usedBy.some((p) => p.status === "draft")) - Number(a.usedBy.some((p) => p.status === "draft")) || b.bytes - a.bytes,
  };
  files.sort(order[sort]);
  if (sort === "largest") draftRows.sort((a, b) => b.mediaBytes - a.mediaBytes);
  if (sort === "oldest") draftRows.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return {
    usage, sort, files, drafts: draftRows,
    totals: {
      activeBytes: files.filter((f) => f.status === "active").reduce((a, f) => a + f.bytes, 0),
      trashBytes: files.filter((f) => f.status === "trash").reduce((a, f) => a + f.bytes, 0),
      files: files.length, trash: files.filter((f) => f.status === "trash").length, drafts: draftRows.length,
    },
    paidStorage: paid,
  };
}
