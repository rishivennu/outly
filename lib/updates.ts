/**
 * "We made some changes" notice. One notice at a time: the admin edits it under Setup > Update notice
 * and presses Publish, which gives it a fresh id, so every member sees it once more on their next visit.
 * Shared by the server (settings default) and the browser (WhatsNew), so no server-only imports here.
 */
export interface UpdateNotice {
  /** Changes on every Publish. Members who dismissed this id never see it again. */
  id: string;
  /** Off = nobody sees it, whatever the id. */
  on: boolean;
  title: string;
  body: string;
  /** Short lines, one change each. */
  items: string[];
  /** When it went out. People who joined after this never used the old version, so they skip it. */
  publishedAt: string;
}

export const UPDATE_LIMITS = { title: 80, body: 320, item: 140, items: 8 } as const;

export const UPDATE_DEFAULT: UpdateNotice = {
  id: "2026-10-16",
  on: true,
  title: "We made a few changes for you",
  body: "We tuned Outlly so your work goes out faster and with fewer surprises. If anything feels off after these changes, tell us and we will fix it.",
  items: [
    "Posting now shows a live card per platform, so you can watch each video land.",
    "Uploads are steadier: a slow connection no longer leaves a video stuck half way.",
    "Your dashboard has a This week panel with views, posts out and your next good time to post.",
    "Hashtags and captions save cleanly, even when a platform sends them back oddly.",
    "Sign in, sign up and the page-not-found screen now share the night-sky look.",
  ],
  publishedAt: "2026-10-16T12:00:00.000Z",
};

export const seenUpdateKey = (userId: string) => `outlly:seen-update:${userId}`;

/** Should this member see the notice? `seen` is the id they last dismissed. */
export function shouldShowUpdate(n: Pick<UpdateNotice, "id" | "on" | "items" | "body" | "publishedAt">, seen: string | null, joinedAt?: string | Date | null): boolean {
  if (!n.on || !n.id) return false;
  if (!n.items.some((i) => i.trim()) && !n.body.trim()) return false;
  if (seen === n.id) return false;
  const pub = Date.parse(n.publishedAt);
  const joined = joinedAt ? new Date(joinedAt).getTime() : NaN;
  if (Number.isFinite(pub) && Number.isFinite(joined) && joined >= pub) return false;
  return true;
}

/** Clean what the admin typed: trimmed, blank lines dropped, capped. */
export function cleanItems(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => (l.length > UPDATE_LIMITS.item ? `${l.slice(0, UPDATE_LIMITS.item - 1).trimEnd()}…` : l)).slice(0, UPDATE_LIMITS.items);
}
