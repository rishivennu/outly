/**
 * 1136: links that come from a notification and point at one exact thing inside Inbox:
 *  - /inbox?tab=messages&thread=<id>            one conversation
 *  - /inbox?comment=<commentId>&target=<id>     one comment on a post
 *
 * Read once on arrival and then taken out of the address bar, so a refresh, a back button or a shared link
 * doesn't keep yanking the pane back to a comment the creator has already dealt with. Pure helpers, so the
 * rules are unit-tested rather than only tried in a browser.
 */

/** Every key, or nothing: a half-filled link (a comment with no post) can't open anything. */
export function pickParams(search: string, keys: string[]): Record<string, string> | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = (q.get(k) ?? "").trim();
    if (!v || v.length > 200) return null;
    out[k] = v;
  }
  return keys.length ? out : null;
}

/**
 * The same address without those keys. Returns null when there was nothing to take out, so the caller can
 * leave the address bar alone. Takes a whole URL or just a path, and gives back whichever it was handed.
 */
export function stripParams(href: string, keys: string[]): string | null {
  const relative = href.startsWith("/");
  const u = new URL(href, "https://outlly.local");
  let changed = false;
  for (const k of keys)
    if (u.searchParams.has(k)) {
      u.searchParams.delete(k);
      changed = true;
    }
  if (!changed) return null;
  return relative ? u.pathname + u.search : u.toString();
}

/** Browser side: read the link, then tidy the address bar. */
export function takeDeepLink(keys: string[]): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  const got = pickParams(window.location.search, keys);
  const next = stripParams(window.location.href, keys);
  if (next) window.history.replaceState(null, "", next);
  return got;
}
