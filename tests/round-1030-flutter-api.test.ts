import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { assertSameOrigin, HttpError } from "../lib/http";
import { NATIVE_CLIENT_HEADER, parseNativeClient } from "../lib/native-client";
import { sessionNeedsRenewal } from "../lib/auth";
import { POST as finishPOST } from "../app/api/app/finish/route";

const post = (headers: Record<string, string>) => new NextRequest("http://localhost/api/posts", { method: "POST", body: "{}", headers: { host: "localhost", ...headers } });
const csrf = (req: NextRequest) => {
  try {
    assertSameOrigin(req);
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : "threw";
  }
};

describe("native client header", () => {
  test("reads platform, version and build", () => {
    expect(parseNativeClient("android/2.0.0+3")).toEqual({ platform: "android", version: "2.0.0", build: 3 });
    expect(parseNativeClient(" ios/2.1.10 ")).toEqual({ platform: "ios", version: "2.1.10", build: null });
  });
  test("anything else is not the app", () => {
    for (const v of ["", null, undefined, "android", "android/2.0", "web/2.0.0", "android/2.0.0+x", "Mozilla/5.0 android/2.0.0", "android/2.0.0+3 extra"]) expect(parseNativeClient(v)).toBeNull();
  });
});

describe("CSRF with the app", () => {
  test("the app's request (no Origin, app header) is allowed", () => expect(csrf(post({ [NATIVE_CLIENT_HEADER]: "android/2.0.0+3" }))).toBe("ok"));
  test("no Origin and no app header is still refused", () => expect(csrf(post({}))).toBe("403 CSRF"));
  test("a malformed app header is refused", () => expect(csrf(post({ [NATIVE_CLIENT_HEADER]: "yes" }))).toBe("403 CSRF"));
  test("a foreign Origin is refused even with the app header", () =>
    expect(csrf(post({ [NATIVE_CLIENT_HEADER]: "android/2.0.0", origin: "https://evil.test" }))).toBe("403 CSRF"));
  test("the website is unchanged", () => {
    expect(csrf(post({ origin: "http://localhost" }))).toBe("ok");
    expect(csrf(post({ origin: "https://evil.test" }))).toBe("403 CSRF");
  });
  test("a real route accepts the app's request and then checks its body as usual", async () => {
    const res = await finishPOST(
      new NextRequest("http://localhost/api/app/finish", { method: "POST", body: JSON.stringify({ code: "x", verifier: "y".repeat(50) }), headers: { "content-type": "application/json", host: "localhost", [NATIVE_CLIENT_HEADER]: "android/2.0.0+3" } }),
      { params: {} } as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("app session renewal", () => {
  const now = 1_800_000_000;
  test("a session under 3 days old is left alone", () => {
    expect(sessionNeedsRenewal(now - 60, now)).toBe(false);
    expect(sessionNeedsRenewal(now - 3 * 86400, now)).toBe(false);
  });
  test("an older one is re-issued", () => {
    expect(sessionNeedsRenewal(now - 3 * 86400 - 1, now)).toBe(true);
    expect(sessionNeedsRenewal(0, now)).toBe(true);
  });
});
