import { PLATFORM_META, type Platform } from "@/lib/domain";

type T = { platform: Platform; status: string; firstCommentState?: "posted" | "failed" | "waiting" | null; firstCommentError?: string | null };

/** One honest line about the first comment, or null when there is nothing to say. */
export function firstCommentLine(t: T): { text: string; tone: "ok" | "wait" | "bad" } | null {
  if (!t.firstCommentState) return null;
  const what = t.platform === "x" ? "First reply" : "First comment";
  if (t.firstCommentState === "posted") return { text: `${what} posted`, tone: "ok" };
  if (t.firstCommentState === "failed") return { text: `${what} didn't go up: ${t.firstCommentError ?? `${PLATFORM_META[t.platform].name} said no.`}`, tone: "bad" };
  if (t.status !== "published") return { text: `${what} goes up right after it's live`, tone: "wait" };
  return { text: `${what} going up in a few seconds`, tone: "wait" };
}
