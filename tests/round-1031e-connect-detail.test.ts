// 1031e: the live Instagram connect kept failing as a plain "exchange". Show the owner the failed step
// and Meta's own words, without ever leaking a token.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { connectDetail, connectReason } from "../lib/social/connect-reason";

const err = (technical: string, message = "Unexpected response") => Object.assign(new Error(message), { technical });

describe("connectDetail", () => {
  test("Graph error on the long-lived swap names the step, status, message and code", () => {
    const d = connectDetail(err('instagram long-lived exchange: HTTP 400 Bad Request\n{"error":{"message":"Unsupported request - method type: get","type":"IGApiException","code":100}}'));
    expect(d).toBe("Failed while swapping for a 60-day token. HTTP 400. Unsupported request - method type: get (code 100)");
  });
  test("Instagram OAuth shape (error_message) on the first swap", () => {
    const d = connectDetail(err('instagram token exchange: HTTP 400 Bad Request\n{"error_type":"OAuthException","code":400,"error_message":"Invalid platform app"}'));
    expect(d).toContain("swapping the sign-in code for a token");
    expect(d).toContain("Invalid platform app (code 400)");
  });
  test("profile step and a non-JSON body", () => {
    const d = connectDetail(err("instagram profile: HTTP 502 Bad Gateway\n<html><body>Bad gateway</body></html>"));
    expect(d).toBe("Failed while reading the account profile. HTTP 502. Bad gateway");
  });
  test("token-like strings are hidden and the line is capped", () => {
    const tok = "IGQWRP" + "a1B2c3D4".repeat(10);
    const d = connectDetail(err(`instagram profile: HTTP 400 Bad Request\n{"error":{"message":"Bad token ${tok} given ${"x ".repeat(300)}","code":190}}`));
    expect(d).not.toContain(tok);
    expect(d).toContain("[hidden]");
    expect(d.length).toBeLessThanOrEqual(240);
  });
  test("no technical text falls back to the error message", () => {
    expect(connectDetail(new Error("Instagram sent no access token"))).toBe("Instagram sent no access token");
  });
  test("classification is unchanged", () => {
    expect(connectReason(err('instagram token exchange: HTTP 400\n{"error_message":"Invalid platform app"}'))).toBe("config");
  });
});

describe("wiring", () => {
  test("callback sets a short-lived cookie, never a URL parameter", () => {
    const r = readFileSync("app/api/accounts/[platform]/callback/route.ts", "utf8");
    expect(r).toContain('res.cookies.set("outlly-connect-detail", connectDetail(e), { path: "/", maxAge: 120');
    expect(r).not.toContain("detail=");
  });
  test("Accounts page shows the line and deletes the cookie", () => {
    const v = readFileSync("components/settings/AccountsView.tsx", "utf8");
    expect(v).toContain("outlly-connect-detail=; path=/; max-age=0");
    expect(v).toContain('role="alert"');
  });
  test("profile read retries with the minimum fields on a 400", () => {
    expect(readFileSync("lib/social/instagram.ts", "utf8")).toContain("fields=user_id,username&access_token");
  });
});
