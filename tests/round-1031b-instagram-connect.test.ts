// 1031b: Instagram connect on the live site ended in "couldn't finish the handshake". Meta's
// code-for-token answer comes wrapped in data[]; we read only the flat shape, so the token was undefined.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let ig: typeof import("../lib/social/instagram");
let keys: typeof import("../lib/social/keys");
let reason: typeof import("../lib/social/connect-reason");
const realFetch = globalThis.fetch;

beforeAll(async () => {
  ig = await import("../lib/social/instagram");
  keys = await import("../lib/social/keys");
  reason = await import("../lib/social/connect-reason");
  keys.__setKeys({ instagram: { clientId: "1234", clientSecret: "s3cr+t/=" } } as never);
});
afterAll(() => {
  globalThis.fetch = realFetch;
  keys.__setKeys(undefined);
});

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function stubInstagram(short: unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    if (url.startsWith("https://api.instagram.com/oauth/access_token")) return ok(short);
    if (url.startsWith("https://graph.instagram.com/access_token")) {
      const t = new URL(url).searchParams.get("access_token");
      if (t !== "SHORT-1") return new Response('{"error":{"message":"Invalid OAuth access token","code":190}}', { status: 400 });
      return ok({ access_token: "LONG-1", token_type: "bearer", expires_in: 5183944 });
    }
    if (url.includes("/me?")) return ok({ user_id: "1784001", username: "bizwithrishi", name: "Rishi" });
    return new Response("not stubbed", { status: 500 });
  }) as typeof fetch;
  return urls;
}

describe("Instagram token answer", () => {
  test("reads Meta's documented data[] shape", () => {
    expect(ig.shortToken({ data: [{ access_token: "A", user_id: "9", permissions: "instagram_business_basic" }] })).toEqual({ access_token: "A", user_id: "9", permissions: "instagram_business_basic" });
  });
  test("still reads the older flat shape", () => {
    expect(ig.shortToken({ access_token: "B", user_id: 7 })?.access_token).toBe("B");
  });
  test("returns null when there is no token at all", () => {
    for (const bad of [null, {}, { data: [] }, { data: [{}] }, { access_token: "" }, "x"]) expect(ig.shortToken(bad)).toBeNull();
  });

  test("connect finishes with the wrapped shape and swaps for the long-lived token", async () => {
    const urls = stubInstagram({ data: [{ access_token: "SHORT-1", user_id: "1784001", permissions: "instagram_business_basic" }] });
    const prof = await new ig.InstagramPublisher().completeConnect("CODE", "https://outly-ecru.vercel.app/api/accounts/instagram/callback");
    expect(prof.platformUserId).toBe("1784001");
    expect(prof.username).toBe("@bizwithrishi");
    expect(prof.accessToken).toBe("LONG-1");
    // the secret goes out URL-encoded, so a + or / in it can't break the swap
    expect(urls.find((u) => u.includes("ig_exchange_token"))).toContain("client_secret=s3cr%2Bt%2F%3D");
  });

  test("connect finishes with the flat shape too", async () => {
    stubInstagram({ access_token: "SHORT-1", user_id: 1784001 });
    const prof = await new ig.InstagramPublisher().completeConnect("CODE", "https://x/cb");
    expect(prof.accessToken).toBe("LONG-1");
  });

  test("a 200 without a token is a clear error, not a call with 'undefined'", async () => {
    const urls = stubInstagram({ data: [] });
    await expect(new ig.InstagramPublisher().completeConnect("CODE", "https://x/cb")).rejects.toThrow(/no access token/i);
    expect(urls.some((u) => u.includes("undefined"))).toBe(false);
  });
});

describe("connect error names the setting that's wrong", () => {
  const err = (technical: string, code?: string) => Object.assign(new Error("Media rejected"), { technical, code });
  test.each([
    ['instagram token exchange: HTTP 400\n{"error_type":"OAuthException","code":400,"error_message":"Error validating verification code. Please make sure your redirect_uri is identical"}', "redirect"],
    ['instagram token exchange: HTTP 400\n{"error_type":"OAuthException","code":400,"error_message":"Invalid platform app"}', "config"],
    ['instagram token exchange: HTTP 400\n{"error_message":"Error validating client secret."}', "config"],
    ['google token: HTTP 401\n{"error":"invalid_client"}', "config"],
    ['instagram token exchange: HTTP 400\n{"error_message":"Matching code was not found or was already used"}', "state"],
    ['x token: HTTP 400\n{"error":"invalid_grant"}', "state"],
    ["PrismaClientKnownRequestError P2002", "server"],
    ["instagram profile: HTTP 500 Internal", "exchange"],
  ])("%s", (technical, want) => {
    expect(reason.connectReason(err(technical))).toBe(want);
  });
  test("no YouTube channel keeps its own reason", () => {
    expect(reason.connectReason(err("", "NO_CHANNEL"))).toBe("no_channel");
  });
});
