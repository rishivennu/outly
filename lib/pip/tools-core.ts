import "server-only";
import { formatMoney } from "../billing/money";
import { MAX_DOCS, signDocs, type PipDoc } from "./links";
import { dayLabel, type DateRange } from "./range";
import type { PipColumn, PipResult, PipTool } from "./types";

/**
 * Shared plumbing for Pip's data tools (1049). Every tool reads ONLY the signed-in workspace's rows (ownerId
 * comes from the session, never from the message), fetches with cursor pages until done or MAX_ROWS, and counts
 * separately so the answer can say "found 212, showing 200" instead of silently stopping.
 */
export type PipCtx = {
  /** Whose records: the workspace owner (from the session). */
  ownerId: string;
  /** The teammate asking, when it isn't the owner. */
  actorId: string | null;
  /** Account ids a teammate may work on; null = all. */
  scope: string[] | null;
  tz: string;
  now: Date;
  message: string;
};

export type PipSort = "views" | "engagement" | "momentum";
export type PipArgs = {
  period?: string | null;
  status?: string | null;
  platform?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  sort?: PipSort | null;
  compare?: boolean | null;
  limit?: number | null;
};

export const PAGE = 100;
export const MAX_ROWS = 1000;

/** Cursor pages until a short page, `max` rows, or a failure (kept, not thrown, so the answer can say so). */
export async function fetchAll<T extends { id: string }>(
  page: (cursor: string | undefined, take: number) => Promise<T[]>,
  max = MAX_ROWS,
): Promise<{ rows: T[]; failed: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  try {
    while (rows.length < max) {
      const take = Math.min(PAGE, max - rows.length);
      const batch = await page(cursor, take);
      rows.push(...batch);
      if (batch.length < take) break;
      cursor = batch[batch.length - 1].id;
    }
    return { rows, failed: false };
  } catch {
    return { rows, failed: true };
  }
}

/** The Prisma bits for a cursor page. */
export const pageArgs = (cursor: string | undefined, take: number) => ({ take, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });

export function base(tool: PipTool, title: string, range: DateRange | null, columns: PipColumn[], empty: string, period: string | null): PipResult {
  return {
    tool,
    title,
    range: range ? { label: range.label, tz: range.tz } : null,
    columns,
    rows: [],
    found: 0,
    returned: 0,
    complete: true,
    totals: [],
    notes: [],
    downloads: [],
    empty,
    facts: [],
    ask: { tool, period },
  };
}

/** Records how many matched vs came back, and says plainly when the list is short or something failed. */
export function settle(r: PipResult, found: number, failed: boolean, noun: string) {
  r.found = Math.max(found, r.rows.length);
  r.returned = r.rows.length;
  r.complete = !failed && r.returned >= r.found;
  if (failed) r.notes.push({ level: "warn", text: `Some ${noun} couldn't be read just now, so this list may be short. Ask again in a minute.` });
  else if (r.returned < r.found)
    r.notes.push({ level: "warn", text: `Showing the newest ${r.returned} of ${r.found} ${noun}. Ask for a shorter period to see the rest.` });
  const where = r.range ? ` for ${r.range.label}` : " on record";
  r.facts.unshift(r.found === r.returned ? `${r.found} ${noun} found${where}.` : `${r.found} ${noun} found${where}; ${r.returned} shown.`);
  return r;
}

export const within = (range: DateRange | null) => (range ? { gte: range.from, lt: range.to } : undefined);
export const money = (minor: number, currency: string) => formatMoney(minor, currency);
export const day = (d: Date | string | null | undefined, tz: string) => (d ? dayLabel(new Date(d), tz) : "");

/** Amount bounds come in major units ("above 5,000"); rows store minor units. */
export function amountWhere(a: PipArgs) {
  const w: { gte?: number; lte?: number } = {};
  if (a.minAmount != null && Number.isFinite(a.minAmount)) w.gte = Math.round(a.minAmount * 100);
  if (a.maxAmount != null && Number.isFinite(a.maxAmount)) w.lte = Math.round(a.maxAmount * 100);
  return Object.keys(w).length ? w : undefined;
}

/** Totals per currency, never added across currencies. */
export function sumBy<T>(items: T[], cur: (x: T) => string, amt: (x: T) => number) {
  const m = new Map<string, number>();
  for (const x of items) m.set(cur(x), (m.get(cur(x)) ?? 0) + amt(x));
  return [...m.entries()].map(([currency, minor]) => ({ currency, minor }));
}

/** One link for a ZIP of up to MAX_DOCS documents (the token cap); says so when there are more. */
export function zipLink(r: PipResult, ownerId: string, docs: PipDoc[], what: string) {
  if (!docs.length) return;
  if (docs.length === 1) {
    r.downloads.push({ label: `Download ${what} (PDF)`, href: signDocs(ownerId, docs), download: true });
    return;
  }
  const n = Math.min(docs.length, MAX_DOCS);
  r.downloads.push({ label: `Download all ${n} as ZIP`, href: signDocs(ownerId, docs.slice(0, MAX_DOCS)), download: true });
  if (docs.length > MAX_DOCS) r.notes.push({ level: "warn", text: `The ZIP holds the newest ${MAX_DOCS}. Ask for a shorter period to download the rest.` });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 10) / 10}%`;
