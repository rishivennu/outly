/**
 * Clearing failed posts out of Outlly. Deleting only touches the studio: anything that did go live on a
 * platform stays up there, so the copy says so whenever part of the post went out.
 */
type P = { id: string; status: string; targets: { status: string }[] };

/** A post that didn't fully make it and isn't mid-send. "partial" counts: some places failed. */
export const isFailedPost = (p: P) => (p.status === "failed" || p.status === "partial") && !p.targets.some((t) => ["queued", "uploading", "processing"].includes(t.status));

/** How many of these went live somewhere, so the confirm can warn that those stay up. */
export const liveCount = (ps: P[]) => ps.filter((p) => p.targets.some((t) => t.status === "published")).length;

export function deleteCopy(ps: P[]): { title: string; body: string; confirm: string } {
  const n = ps.length;
  const live = liveCount(ps);
  const title = n === 1 ? "Delete this failed post?" : `Delete ${n} failed posts?`;
  const base = n === 1 ? "It goes from Outlly with its captions and video. This can't be undone." : "They go from Outlly with their captions and videos. This can't be undone.";
  const tail = live === 0 ? "" : n === 1 ? " The places it did go live keep it; delete it there if you want it gone." : live === 1 ? " One of them went live somewhere, and it stays up on that platform." : ` ${live === n ? "All" : live} of them went live somewhere, and those stay up on the platform.`;
  return { title, body: base + tail, confirm: n === 1 ? "Delete it" : `Delete ${n}` };
}

/** Delete one by one through the normal route (it checks ownership and refuses mid-send). Reports what stuck. */
export async function deletePosts(ids: string[], del: (id: string) => Promise<unknown>): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = [], failed: string[] = [];
  for (const id of ids) {
    try {
      await del(id);
      done.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { done, failed };
}
