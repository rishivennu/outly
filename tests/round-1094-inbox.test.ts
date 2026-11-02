import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inboxReason, problemHeadline } from "@/components/inbox/InboxView";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const p = (platform: "instagram" | "youtube", code: string, targetId: string, postTitle: string | null = "A post") =>
  ({ platform, code, targetId, postTitle }) as Parameters<typeof problemHeadline>[0][number];

describe("1094 inbox notice", () => {
  test("a rejected post reads as a comments problem, never upload copy", () => {
    const h = problemHeadline([p("instagram", "MEDIA_REJECTED", "t1")]);
    expect(h.title).toBe("Comments on 1 Instagram post didn't load.");
    expect(h.retry).toBe(true);
    expect(inboxReason("instagram", "MEDIA_REJECTED")).toContain("deleted, archived or made private");
    expect(inboxReason("instagram", "MEDIA_REJECTED")).not.toContain("video");
  });
  test("reconnect leads, other failures are counted under it", () => {
    const h = problemHeadline([p("youtube", "AUTH_EXPIRED", "y1"), p("instagram", "MEDIA_REJECTED", "t1"), p("instagram", "MEDIA_REJECTED", "t2")]);
    expect(h.title).toBe("Reconnect YouTube to get new comments.");
    expect(h.body).toBe("Comments on 2 other posts didn't load either.");
    expect(h.reconnect).toEqual(["youtube"]);
  });
  test("the old wording is gone", () => {
    expect(src("components/inbox/InboxView.tsx")).not.toContain("rather than guess");
  });
});

describe("1094 own handle", () => {
  test("every leading @ is stripped when matching the creator", () => {
    expect(src("components/inbox/InboxView.tsx")).toContain('replace(/^@+/, "")');
    expect(src("lib/inbox.ts")).toContain('`@${acct.username.replace(/^@+/, "")}`');
  });
  test("the creator's own comments never count as waiting", () => {
    const s = src("components/inbox/InboxView.tsx");
    expect(s).toContain("hasOwnReply(c, mine) || isOwn(c, mine)");
    expect(s).toContain("!hasOwnReply(c, mine) && !isOwn(c, mine)");
  });
});
