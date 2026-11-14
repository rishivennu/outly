/** 1148: the Content library's search and multi-select rules, pure so they are unit tested. */
type Searchable = {
  title: string | null;
  hook: string | null;
  story: string | null;
  media: { filename: string | null };
  targets: { title: string | null; caption: string | null; description: string | null; hashtags: string | null }[];
};

/** The same fields the server searches (lib/posts/library.ts searchWhere): title, hook, story, file name, captions and tags. */
export function matchesQuery(p: Searchable, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [p.title, p.hook, p.story, p.media?.filename, ...p.targets.flatMap((t) => [t.title, t.caption, t.description, t.hashtags])].some((v) => !!v && v.toLowerCase().includes(s));
}

/**
 * A click on one checkbox. With shift and an earlier click (`anchor`), every card between the two takes the
 * clicked card's new state, as in a file manager.
 */
export function selectRange(ids: string[], selected: ReadonlySet<string>, anchor: number | null, index: number, shift: boolean): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(ids[index]);
  const [a, b] = shift && anchor !== null && anchor < ids.length ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
  for (let i = a; i <= b; i++) on ? next.add(ids[i]) : next.delete(ids[i]);
  return next;
}

type Live = { targets: { status: string }[] };

/** The confirm for deleting several posts from the studio. Live copies stay on the platform, and it says so. */
export function bulkDeleteCopy(ps: Live[]): { title: string; body: string; confirm: string } {
  const n = ps.length;
  const live = ps.filter((p) => p.targets.some((t) => t.status === "published")).length;
  const title = n === 1 ? "Delete 1 post?" : `Delete ${n} posts?`;
  const base = n === 1 ? "It goes from your studio with its captions and video." : `All ${n} go from your studio with their captions and videos.`;
  const tail = live === 0 ? "" : n === 1 ? " It stays live on the platform it went out on." : live === n ? " They stay live on the platforms they went out on." : ` ${live} of them went live, and those stay up on the platform.`;
  return { title, body: `${base}${tail} You can undo it for a few seconds after.`, confirm: n === 1 ? "Delete 1 post" : `Delete ${n} posts` };
}
