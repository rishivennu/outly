/**
 * R1270: the arithmetic behind admin pagination, server-safe so a page can turn the same URL params into its
 * skip/take that the Pagination control reads. Pages are 1-based; an out-of-range page is clamped.
 */
export const PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 200;

export type PageWindow = { page: number; pages: number; limit: number; total: number; from: number; to: number; skip: number; take: number; prev: number | null; next: number | null };

export function pageWindow(total: number, page: number, limit: number = PAGE_LIMIT): PageWindow {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const l = Math.max(1, Math.floor(Number(limit) || PAGE_LIMIT));
  const pages = Math.max(1, Math.ceil(t / l));
  const p = Math.min(pages, Math.max(1, Math.floor(Number(page) || 1)));
  const skip = (p - 1) * l;
  return { page: p, pages, limit: l, total: t, from: t ? skip + 1 : 0, to: Math.min(t, skip + l), skip, take: l, prev: p > 1 ? p - 1 : null, next: p < pages ? p + 1 : null };
}

/** `page` and `limit` from search params (a Next page's `searchParams` or a URLSearchParams), with safe defaults. */
export function readPaging(sp: URLSearchParams | Record<string, string | string[] | undefined>, defaultLimit: number = PAGE_LIMIT): { page: number; limit: number } {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return Array.isArray(v) ? v[0] : v ?? undefined;
  };
  const page = Math.max(1, Math.floor(Number(get("page")) || 1));
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.floor(Number(get("limit")) || defaultLimit)));
  return { page, limit };
}
