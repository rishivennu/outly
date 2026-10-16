/**
 * Command palette rules with no React in them, so they are unit-tested: how a query ranks commands,
 * and when a single-letter shortcut may fire (never while typing, never with a modifier, never over a dialog).
 */
export interface Command {
  id: string;
  label: string;
  group: "Go to" | "Do" | "Posts";
  /** Extra words that should find it ("schedule" finds Calendar). */
  keywords?: string;
  hint?: string;
  href?: string;
  shortcut?: string;
  /** Only whole-word or substring matches, no scattered letters. Used for post titles, where "cal" finding "City walk" is noise. */
  strict?: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

/**
 * Score one command for a query, or -1 when it doesn't match. Every query letter must appear in order;
 * whole-label prefix beats word start beats a scattered match, and shorter labels win ties.
 */
export function score(c: Pick<Command, "label" | "keywords" | "strict">, query: string): number {
  const q = norm(query.trim());
  if (!q) return 0;
  const label = norm(c.label);
  if (label.startsWith(q)) return 1000 - label.length;
  const words = label.split(/[^a-z0-9]+/);
  if (words.some((w) => w.startsWith(q))) return 800 - label.length;
  if (label.includes(q)) return 600 - label.length;
  const kw = norm(c.keywords ?? "");
  if (kw.split(/\s+/).some((w) => w.startsWith(q))) return 500 - label.length;
  if (c.strict) return -1;
  // in-order letters, rewarding runs and word starts
  let at = 0, s = 0, run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = label.indexOf(ch, at);
    if (i < 0) return -1;
    run = i === at ? run + 1 : 0;
    s += 10 + run * 5 + (i === 0 || /[^a-z0-9]/.test(label[i - 1]) ? 15 : 0) - Math.min(9, i - at);
    at = i + 1;
  }
  return Math.max(1, Math.min(400, s));
}

export function rank<T extends Command>(items: T[], query: string, limit = 30): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((c, i) => ({ c, i, s: score(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; repeat?: boolean };
type TargetLike = { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;

/** Typing somewhere: an input, a text area, a select or anything editable. */
export function isTyping(t: TargetLike) {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t.isContentEditable || !!t.closest?.("[contenteditable=''],[contenteditable='true']");
}

/** Ctrl+K or Cmd+K opens the palette from anywhere, even mid-typing. */
export const isPaletteKey = (e: KeyLike) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";

/**
 * Which single-letter shortcut this key press is, if any. Off when the creator turned them off
 * (WCAG 2.1.4), while typing, with any modifier, on key repeat, or while a dialog is open.
 */
export function letterShortcut(e: KeyLike, target: TargetLike, opts: { enabled: boolean; dialogOpen: boolean }): "new" | "schedule" | null {
  if (!opts.enabled || opts.dialogOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(target)) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return null;
  return k === "n" ? "new" : k === "s" ? "schedule" : null;
}

export const LETTERS_KEY = "outlly:letter-shortcuts";
