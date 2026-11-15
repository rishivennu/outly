/** Phase 2 inbox comments: the pure rules behind the filter row, the reply errors and the platform list. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMMENT_VIEWS, inView, isUnread, keptView, matchesQuery } from "@/components/inbox/InboxView";
import { COMMENT_PLATFORMS, commentCapable, replyFailure } from "@/lib/inbox-state";
import { PublisherError } from "@/lib/social/types";
import { PLATFORMS } from "@/lib/domain";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("unread", () => {
  test("marked by hand wins; never opened is unread until answered", () => {
    expect(isUnread({ read: "unread" }, true)).toBe(true);
    expect(isUnread({ read: "read" }, false)).toBe(false);
    expect(isUnread({ read: null }, false)).toBe(true);
    expect(isUnread({ read: null }, true)).toBe(false);
  });
});

describe("views", () => {
  const c = (read: "read" | "unread" | null, archived: boolean) => ({ read, archived });
  test("archived only shows under Archived", () => {
    for (const v of COMMENT_VIEWS) expect(inView(v, c("read", true), true)).toBe(v === "archived");
  });
  test("To reply, Unread and All", () => {
    expect(inView("reply", c("read", false), false)).toBe(true);
    expect(inView("reply", c("unread", false), true)).toBe(false);
    expect(inView("unread", c("unread", false), true)).toBe(true);
    expect(inView("unread", c("read", false), false)).toBe(false);
    expect(inView("all", c("read", false), true)).toBe(true);
    expect(inView("archived", c(null, false), false)).toBe(false);
  });
  test("a filter kept before Phase 2 maps onto the new views; junk is dropped", () => {
    expect(keptView({ platform: "all", needsOnly: true })).toEqual({ platform: "all", view: "reply" });
    expect(keptView({ platform: "youtube", needsOnly: false })).toEqual({ platform: "youtube", view: "all" });
    expect(keptView({ platform: "x", view: "archived" })).toEqual({ platform: "x", view: "archived" });
    expect(keptView({ platform: "myspace", view: "all" })).toBeNull();
    expect(keptView({ platform: "all", view: "spam" })).toBeNull();
    expect(keptView(null)).toBeNull();
  });
});

describe("search", () => {
  const c = { authorName: "@priya", text: "Which lens?", postTitle: "Shot in Goa", platform: "youtube" as const };
  test("who, what, which post and which platform", () => {
    for (const q of ["priya", "LENS", "goa", "youtube", "  "]) expect(matchesQuery(c, q)).toBe(true);
    expect(matchesQuery(c, "instagram")).toBe(false);
  });
});

describe("comment-capable platforms", () => {
  test("exactly the publishers in lib/social that implement listComments", () => {
    const real = PLATFORMS.filter((p) => /async listComments\(/.test(src(`lib/social/${p}.ts`)));
    expect([...COMMENT_PLATFORMS].sort()).toEqual([...real].sort());
    expect(commentCapable("facebook")).toBe(false);
  });
});

describe("reply errors are told in plain words with the right status", () => {
  test("a platform rate limit is a 429 that says how long to wait", () => {
    const e = new PublisherError("RATE_LIMITED", "Rate limited");
    e.retryAfterMs = 42_000;
    const h = replyFailure(e);
    expect(h.status).toBe(429);
    expect(h.code).toBe("RATE_LIMITED");
    expect(h.extra).toEqual({ retryAfter: 42 });
    expect(h.message).toContain("42 seconds");
    expect(replyFailure(new PublisherError("RATE_LIMITED", "x")).message).toContain("a minute");
  });
  test("sign-out, permission, rejection and outage each get their own message", () => {
    expect(replyFailure(new PublisherError("AUTH_EXPIRED", "x")).status).toBe(409);
    expect(replyFailure(new PublisherError("FORBIDDEN", "x")).status).toBe(403);
    expect(replyFailure(new PublisherError("MEDIA_REJECTED", "x")).status).toBe(422);
    expect(replyFailure(new PublisherError("PLATFORM_DOWN", "x")).status).toBe(502);
    for (const c of ["AUTH_EXPIRED", "FORBIDDEN", "MEDIA_REJECTED", "NETWORK", "UNKNOWN"] as const) expect(replyFailure(new PublisherError(c, "x")).message).not.toMatch(/[\u2013\u2014]/);
  });
  test("the reply route uses it and marks the answered comment read", () => {
    const r = src("app/api/inbox/reply/route.ts");
    expect(r).toContain("if (err instanceof PublisherError) throw replyFailure(err);");
    expect(r).toContain("read: true");
  });
});

describe("house rules in the Phase 2 inbox files", () => {
  for (const f of ["components/inbox/InboxView.tsx", "components/inbox/InboxList.tsx", "lib/inbox-state.ts", "app/api/inbox/state/route.ts"]) {
    test(`${f}: no em or en dashes, no emoji, no transition-all`, () => {
      const s = src(f);
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(s).not.toContain("transition-all");
    });
  }
  test("a comment link opens on Comments even when Messages was the kept tab", () => {
    expect(src("components/inbox/InboxView.tsx")).toContain('!params?.get("comment") && keptTab.saved === "messages"');
  });
  test("the filter row: four views and platform chips", () => {
    const v = src("components/inbox/InboxView.tsx");
    expect(v).toContain("<ScopeBar views={views} view={view}");
    expect(v).toContain("chips platforms={chipPlatforms}");
    expect(src("components/inbox/InboxList.tsx")).toContain('role="group" aria-label="Platform"');
  });
});
