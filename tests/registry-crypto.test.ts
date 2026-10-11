import { afterEach, describe, expect, test } from "bun:test";
import { env } from "../lib/env";
import { isPracticeAccount, publisherForAccount, getPublisher, hasCredentials } from "../lib/social/registry";
import { MockPublisher } from "../lib/social/mock";
import { XPublisher } from "../lib/social/x";
import { decrypt, encrypt } from "../lib/crypto";

const saved = { ...env };
afterEach(() => Object.assign(env, saved));

describe("mock vs real separation", () => {
  test("practice accounts are recognised by their mock- id", () => {
    expect(isPracticeAccount({ platformUserId: "mock-x-001" })).toBe(true);
    expect(isPracticeAccount({ platformUserId: "1234567890" })).toBe(false);
  });

  test("a practice account always rehearses, even when real credentials exist", () => {
    Object.assign(env, { X_CLIENT_ID: "id", X_CLIENT_SECRET: "secret", MOCK_SOCIAL_PUBLISHING: false });
    expect(publisherForAccount("x", { platformUserId: "mock-x-001" })).toBeInstanceOf(MockPublisher);
  });

  test("a real account never falls back to the mock, even if mocking is switched on", () => {
    Object.assign(env, { X_CLIENT_ID: "id", X_CLIENT_SECRET: "secret", MOCK_SOCIAL_PUBLISHING: true });
    expect(publisherForAccount("x", { platformUserId: "1234" })).toBeInstanceOf(XPublisher);
  });

  test("a real account without credentials fails loudly instead of faking success", () => {
    expect(hasCredentials("youtube")).toBe(false);
    expect(() => publisherForAccount("youtube", { platformUserId: "UC123" })).toThrow(/YOUTUBE_CLIENT_ID/);
  });

  test("connecting uses practice mode only when mocking is on or credentials are missing", () => {
    expect(getPublisher("instagram")).toBeInstanceOf(MockPublisher);
    Object.assign(env, { X_CLIENT_ID: "id", X_CLIENT_SECRET: "secret", MOCK_SOCIAL_PUBLISHING: false });
    expect(getPublisher("x")).toBeInstanceOf(XPublisher);
  });
});

describe("token encryption", () => {
  test("round-trips and never stores plaintext", () => {
    const c = encrypt("ya29.secret-token");
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("secret-token");
    expect(decrypt(c)).toBe("ya29.secret-token");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });
  test("tampered ciphertext is rejected", () => {
    const [v, iv, tag, ct] = encrypt("hello").split(".");
    const bytes = Buffer.from(ct, "base64url");
    bytes[0] ^= 0xff;
    const flipped = bytes.toString("base64url");
    expect(() => decrypt([v, iv, tag, flipped].join("."))).toThrow();
    expect(() => decrypt("garbage")).toThrow(/Malformed/);
  });
});
