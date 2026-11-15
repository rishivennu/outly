import type { ThreadView } from "@/lib/messages/service";
import type { DmPlatform } from "@/lib/messages/meta";

/** 1093: waiting = they wrote last (or it is unread) and Meta still lets us answer here. */
export const threadNeedsReply = (t: Pick<ThreadView, "unread" | "snippet" | "canReply">) => t.unread > 0 || (t.canReply && !t.snippet.startsWith("You:"));
export const threadsWaiting = (threads: ThreadView[]) => threads.filter(threadNeedsReply).length;

export type ThreadStatus = "needs_reply" | "replied" | "window_closed";
/** Phase 2 (1155): the one status a row shows. A closed window wins: Outlly can't answer it either way. */
export function threadStatus(t: Pick<ThreadView, "unread" | "snippet" | "canReply">): ThreadStatus {
  if (!t.canReply) return "window_closed";
  return threadNeedsReply(t) ? "needs_reply" : "replied";
}

/** What the list shows. needs and all read the same server list (not archived); needs narrows it here. */
export type DmView = "needs" | "unread" | "all" | "archived";
export type DmFilter = { view: DmView; platform: DmPlatform | "all" };
export const DM_VIEWS: { id: DmView; label: string }[] = [
  { id: "needs", label: "Needs reply" },
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];
export const serverView = (v: DmView) => (v === "unread" ? "unread" : v === "archived" ? "archived" : "inbox");

export function listQuery(f: DmFilter, opts: { sync?: boolean; cursor?: string | null; take?: number } = {}) {
  const q = new URLSearchParams();
  if (f.platform !== "all") q.set("platform", f.platform);
  const v = serverView(f.view);
  if (v !== "inbox") q.set("view", v);
  if (opts.sync) q.set("sync", "1");
  if (opts.cursor) q.set("cursor", opts.cursor);
  if (opts.take) q.set("take", String(opts.take));
  return q.size ? `?${q}` : "";
}

/**
 * Search covers the conversations loaded on this device: message text is encrypted at rest, so the server
 * can't search it. An open conversation stays listed after you answer it, so it doesn't jump away mid-thought.
 */
export function visibleThreads(threads: ThreadView[], f: Pick<DmFilter, "view">, query: string, openId: string | null) {
  const q = query.trim().toLowerCase();
  return threads.filter((t) => (f.view !== "needs" || threadNeedsReply(t) || t.id === openId) && (!q || `${t.participantName} ${t.participantHandle ?? ""} ${t.snippet}`.toLowerCase().includes(q)));
}

/** Seconds left before a rate-limited send may be tried again (0 = now). */
export function secondsUntil(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now) / 1000));
}
