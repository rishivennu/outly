import { describe, expect, test } from "bun:test";
import { hashTrustSecret, newTrustSecret, parseTrustCookie, trustCookieValue, trustValid } from "@/lib/trusted-core";

describe("1053 remember this device", () => {
  const secret = newTrustSecret();
  const row = { userId: "u1", secretHash: hashTrustSecret(secret), tokenVersion: 3, expiresAt: new Date(Date.now() + 864e5) };
  test("cookie round-trips and rejects junk", () => {
    expect(parseTrustCookie(trustCookieValue("clx0abc123def", secret))).toEqual({ id: "clx0abc123def", secret });
    for (const bad of [null, "", "nodot", ".x", "id.short", `bad id!.${secret}`, `clx0abc123def.${secret}`.repeat(5)]) expect(parseTrustCookie(bad)).toBeNull();
  });
  test("the database keeps only a hash", () => {
    expect(row.secretHash).not.toContain(secret);
    expect(row.secretHash).toMatch(/^[0-9a-f]{64}$/);
  });
  test("valid only for the same person, version and secret, before it expires", () => {
    expect(trustValid(row, { userId: "u1", tokenVersion: 3, secret })).toBe(true);
    expect(trustValid(row, { userId: "u2", tokenVersion: 3, secret })).toBe(false);
    expect(trustValid(row, { userId: "u1", tokenVersion: 4, secret })).toBe(false); // sign out everywhere / password change
    expect(trustValid(row, { userId: "u1", tokenVersion: 3, secret: newTrustSecret() })).toBe(false);
    expect(trustValid({ ...row, expiresAt: new Date(Date.now() - 1) }, { userId: "u1", tokenVersion: 3, secret })).toBe(false);
    expect(trustValid(null, { userId: "u1", tokenVersion: 3, secret })).toBe(false);
  });
});
