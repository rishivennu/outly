/**
 * P2 follow-up: platform comment lists come back one page at a time (Instagram 50, YouTube 100, X 100), so a post with
 * more comments than one page used to show only the newest page. collectPages follows the platform's cursor until the
 * list ends or a cap is hit, so a busy post shows its whole recent conversation without one slow post holding up the
 * inbox. The first page failing still throws (the caller turns that into a reconnect or plan hint); a later page
 * failing keeps what already arrived, because half a conversation beats an error over the whole inbox.
 */
export interface Page<T> {
  items: T[];
  /** The cursor for the next page, or null when this was the last one. */
  next: string | null;
}

export interface PageCaps {
  /** Most pages to read, the first included. */
  maxPages: number;
  /** Stop once this many items are in, even if the platform has more. */
  maxItems: number;
}

/** Most comments any one post loads, across every platform. */
export const COMMENT_CAP = 500;

/** Per platform: X's recent search is billed per read on paid tiers, so it reads less than the free APIs. */
export const COMMENT_PAGES = {
  instagram: { maxPages: 10, maxItems: COMMENT_CAP },
  youtube: { maxPages: 5, maxItems: COMMENT_CAP },
  x: { maxPages: 3, maxItems: 300 },
  /** Account-wide sweeps run for several posts (or a whole channel) at once, so each one reads less. */
  instagramAccount: { maxPages: 4, maxItems: 200 },
  threads: { maxPages: 10, maxItems: COMMENT_CAP },
  threadsAccount: { maxPages: 4, maxItems: 200 },
  youtubeChannel: { maxPages: 3, maxItems: 300 },
} satisfies Record<string, PageCaps>;

export async function collectPages<T>(load: (cursor: string | null) => Promise<Page<T>>, caps: PageCaps): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < caps.maxPages; page++) {
    let got: Page<T>;
    try {
      got = await load(cursor);
    } catch (e) {
      if (page === 0) throw e;
      console.warn("[comments] a later page failed, keeping what loaded", e);
      return { items, complete: false };
    }
    items.push(...got.items);
    if (items.length >= caps.maxItems) return { items: items.slice(0, caps.maxItems), complete: !got.next && items.length === caps.maxItems };
    // A platform that hands back the same cursor twice would loop forever.
    if (!got.next || seen.has(got.next)) return { items, complete: !got.next };
    seen.add(got.next);
    cursor = got.next;
  }
  return { items, complete: false };
}
