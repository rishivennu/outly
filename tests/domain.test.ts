import { describe, expect, test } from "bun:test";
import { derivePostStatus, humanError, PLATFORMS } from "../lib/domain";

const T = (...s: string[]) => s.map((platformStatus) => ({ platformStatus }));

describe("derivePostStatus", () => {
  test("no targets is a draft", () => expect(derivePostStatus([], false)).toBe("draft"));
  test("published only when every platform confirmed", () => {
    expect(derivePostStatus(T("published", "published", "published"), false)).toBe("published");
    expect(derivePostStatus(T("published", "processing"), false)).toBe("publishing");
  });
  test("any in-flight platform keeps the post publishing", () => {
    for (const s of ["queued", "uploading", "processing"]) expect(derivePostStatus(T("failed", s), false)).toBe("publishing");
  });
  test("mixed outcome is partial, never published", () => {
    expect(derivePostStatus(T("published", "failed"), false)).toBe("partial");
  });
  test("all failed is failed", () => expect(derivePostStatus(T("failed", "failed"), false)).toBe("failed"));
  test("failed + pending (nothing live) is failed", () => expect(derivePostStatus(T("failed", "pending"), false)).toBe("failed"));
  test("pending is scheduled only with a future time", () => {
    expect(derivePostStatus(T("pending", "pending"), true)).toBe("scheduled");
    expect(derivePostStatus(T("pending"), false)).toBe("draft");
  });
});

describe("humanError", () => {
  const codes = ["AUTH_EXPIRED", "RATE_LIMITED", "MEDIA_REJECTED", "NETWORK", "PLATFORM_DOWN", "NOT_CONNECTED", "DUPLICATE", "FORBIDDEN", "UNKNOWN", null, "SOMETHING_NEW"];
  test("every code produces non-empty copy for every platform", () => {
    for (const p of PLATFORMS)
      for (const c of codes) {
        const h = humanError(p, c) as unknown;
        const text = typeof h === "string" ? h : JSON.stringify(h);
        expect(text.length).toBeGreaterThan(5);
      }
  });
});
