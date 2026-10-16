/** Delete failed posts from Outlly: which posts qualify, the confirm copy, and partial-failure reporting. */
import { describe, expect, test } from "bun:test";
import { deleteCopy, deletePosts, isFailedPost, liveCount } from "../lib/client/failed-posts";

const P = (id: string, status: string, ts: string[]) => ({ id, status, targets: ts.map((s) => ({ status: s })) });

describe("failed posts", () => {
  test("failed and partial qualify, anything mid-send or fine does not", () => {
    expect(isFailedPost(P("a", "failed", ["failed"]))).toBe(true);
    expect(isFailedPost(P("b", "partial", ["published", "failed"]))).toBe(true);
    expect(isFailedPost(P("c", "partial", ["uploading", "failed"]))).toBe(false);
    expect(isFailedPost(P("d", "published", ["published"]))).toBe(false);
    expect(isFailedPost(P("e", "scheduled", ["pending"]))).toBe(false);
    expect(isFailedPost(P("f", "publishing", ["failed"]))).toBe(false);
  });

  test("copy warns only when something went live", () => {
    const one = deleteCopy([P("a", "failed", ["failed"])]);
    expect(one.title).toBe("Delete this failed post?");
    expect(one.body).not.toContain("live");
    expect(one.confirm).toBe("Delete it");
    const part = deleteCopy([P("b", "partial", ["published", "failed"])]);
    expect(part.body).toContain("did go live keep it");
    const many = deleteCopy([P("a", "failed", ["failed"]), P("b", "partial", ["published", "failed"]), P("c", "failed", ["failed"])]);
    expect(many.title).toBe("Delete 3 failed posts?");
    expect(many.body).toContain("One of them went live somewhere, and it stays up");
    expect(many.confirm).toBe("Delete 3");
    expect(liveCount([P("b", "partial", ["published"]), P("x", "partial", ["published"])])).toBe(2);
    expect(deleteCopy([P("b", "partial", ["published"]), P("x", "partial", ["published"])]).body).toContain("All of them");
    for (const c of [one, part, many]) expect(`${c.title}${c.body}${c.confirm}`).not.toMatch(/\u2014/);
  });

  test("deletePosts keeps going past a failure and reports both", async () => {
    const r = await deletePosts(["a", "b", "c"], async (id) => {
      if (id === "b") throw new Error("409");
    });
    expect(r).toEqual({ done: ["a", "c"], failed: ["b"] });
  });
});
