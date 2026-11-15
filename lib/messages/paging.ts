/**
 * Phase 2 (1155): cursors and merges for the direct message list and a thread's history. Pure and
 * client-safe: the server builds cursors, the browser only hands them back and merges pages.
 * A cursor is "<epoch ms>.<row id>": rows are ordered by time, then id, so equal times never skip a row.
 */
export const THREAD_PAGE = 30;
export const THREAD_PAGE_MAX = 200;
export const MESSAGE_PAGE = 50;

export interface Cursor {
  at: Date;
  id: string;
}

export const encodeCursor = (at: Date | string, id: string) => `${new Date(at).getTime()}.${id}`;

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/.exec(raw ?? "");
  if (!m) return null;
  const at = new Date(Number(m[1]));
  return Number.isNaN(at.getTime()) ? null : { at, id: m[2] };
}

/** Rows strictly after the cursor in newest-first order (older time, or same time and a smaller id). */
export function olderThan(field: string, c: Cursor) {
  return { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] };
}

export const clampTake = (raw: unknown, fallback: number, max: number) => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

type Row = { id: string; lastMessageAt: string };
const newer = (a: Row, b: Row) => a.lastMessageAt > b.lastMessageAt || (a.lastMessageAt === b.lastMessageAt && a.id > b.id);

/**
 * A fresh first page replaces the top of the list. Rows loaded further down (older pages) stay below it, so a
 * poll never throws away what the creator scrolled to; a row that moved up is kept once, at its new place.
 */
export function mergeHead<T extends Row>(prev: T[], prevCursor: string | null, head: T[], headCursor: string | null): { threads: T[]; nextCursor: string | null } {
  if (!headCursor || !head.length) return { threads: head, nextCursor: headCursor };
  const last = head[head.length - 1];
  const seen = new Set(head.map((t) => t.id));
  const tail = prev.filter((t) => !seen.has(t.id) && newer(last, t));
  return tail.length ? { threads: [...head, ...tail], nextCursor: prevCursor } : { threads: head, nextCursor: headCursor };
}

/** An older page goes under what is loaded; a row already shown (it moved while paging) is not repeated. */
export function appendPage<T extends { id: string }>(prev: T[], page: T[]): T[] {
  const seen = new Set(prev.map((t) => t.id));
  return [...prev, ...page.filter((t) => !seen.has(t.id))];
}

type Msg = { id: string; sentAt: string };
/**
 * The newest page of a thread (oldest first) replaces the same stretch of time in what is loaded, so an unsent
 * message disappears, while older history fetched with "Show earlier messages" stays.
 */
export function mergeLatest<T extends Msg>(prev: T[] | null, latest: T[]): T[] {
  if (!prev?.length || !latest.length) return latest;
  const first = latest[0];
  const seen = new Set(latest.map((m) => m.id));
  const older = prev.filter((m) => !seen.has(m.id) && (m.sentAt < first.sentAt || (m.sentAt === first.sentAt && m.id < first.id)));
  return [...older, ...latest];
}

/** Earlier history (oldest first) goes on top. */
export function prependOlder<T extends { id: string }>(prev: T[] | null, older: T[]): T[] {
  const seen = new Set((prev ?? []).map((m) => m.id));
  return [...older.filter((m) => !seen.has(m.id)), ...(prev ?? [])];
}
