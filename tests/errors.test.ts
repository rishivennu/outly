import { describe, expect, test } from "bun:test";
import { asPublisherError, commonMediaChecks, httpFailure, PublisherError } from "../lib/social/types";

const res = (status: number, body = "") => new Response(body, { status });

describe("httpFailure maps platform HTTP errors to safe codes", () => {
  const cases: [number, string, string, boolean][] = [
    [401, "", "AUTH_EXPIRED", false],
    [403, '{"detail":"You are not allowed to create a Tweet with duplicate content."}', "DUPLICATE", false],
    [403, '{"error":{"message":"Error validating access token: Session has expired"}}', "AUTH_EXPIRED", false],
    [403, '{"title":"Client Forbidden","detail":"This endpoint requires a paid tier"}', "FORBIDDEN", false],
    [429, "slow down", "RATE_LIMITED", true],
    [500, "", "PLATFORM_DOWN", true],
    [503, "", "PLATFORM_DOWN", true],
    [400, "bad video", "MEDIA_REJECTED", false],
    [413, "", "MEDIA_REJECTED", false],
    [422, "", "MEDIA_REJECTED", false],
    [404, "", "UNKNOWN", false],
  ];
  for (const [status, body, code, retryable] of cases)
    test(`${status} ${body.slice(0, 30) || "(empty)"} -> ${code}`, async () => {
      const e = await httpFailure(res(status, body), "test call");
      expect(e).toBeInstanceOf(PublisherError);
      expect(e.code).toBe(code as PublisherError["code"]);
      expect(e.retryable).toBe(retryable);
      expect(e.technical).toContain(`HTTP ${status}`);
    });

  test("technical detail is capped so huge bodies never reach the UI", async () => {
    const e = await httpFailure(res(500, "x".repeat(10_000)), "big");
    expect(e.technical!.length).toBeLessThan(2100);
  });
});

describe("asPublisherError", () => {
  test("passes PublisherError through untouched", () => {
    const pe = new PublisherError("FORBIDDEN", "no");
    expect(asPublisherError(pe)).toBe(pe);
  });
  test("fetch-level failures are retryable NETWORK (outcome unknown)", () => {
    for (const e of [new TypeError("fetch failed"), Object.assign(new Error("aborted"), { name: "AbortError" }), new Error("connect ECONNRESET"), new Error("ETIMEDOUT")]) {
      const pe = asPublisherError(e);
      expect(pe.code).toBe("NETWORK");
      expect(pe.retryable).toBe(true);
    }
  });
  test("anything else is UNKNOWN and not auto-retried", () => {
    const pe = asPublisherError(new Error("boom"));
    expect(pe.code).toBe("UNKNOWN");
    expect(pe.retryable).toBe(false);
    expect(asPublisherError("str").code).toBe("UNKNOWN");
  });
});

describe("commonMediaChecks", () => {
  const rules = { name: "YouTube", maxDuration: 180, maxBytes: 100e6, preferVertical: true };
  test("clean vertical MP4 passes", () => {
    expect(commonMediaChecks({ mimeType: "video/mp4", size: 5e6, duration: 30, width: 1080, height: 1920 }, rules)).toEqual([]);
  });
  test("wrong type, too big, too long are errors; landscape is a warning", () => {
    const issues = commonMediaChecks({ mimeType: "video/webm", size: 200e6, duration: 400, width: 1920, height: 1080 }, rules);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(3);
    expect(issues.filter((i) => i.level === "warning")).toHaveLength(1);
  });
});
