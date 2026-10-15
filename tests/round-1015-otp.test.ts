import { describe, expect, test } from "bun:test";
import {
  base32Decode, base32Encode, checkOtp, codeDigest, groupKey, hotp, isCodeShape, looksLikeRecovery, newCode, newRecoveryCodes,
  newTotpSecret, normalizeCode, otpauthUri, OTP_MAX_ATTEMPTS, parseHashes, recoveryDigest, spendRecovery, stepAt, totp, verifyTotp,
} from "../lib/otp/core";
import { qrMatrix, qrSvgPath } from "../lib/otp/qr";

const RFC_KEY = base32Encode(Buffer.from("12345678901234567890"));

describe("email codes", () => {
  test("6 digits, varied", () => {
    const set = new Set(Array.from({ length: 200 }, newCode));
    for (const c of set) expect(isCodeShape(c)).toBe(true);
    expect(set.size).toBeGreaterThan(190);
  });
  test("normalize spaces and dashes", () => expect(normalizeCode(" 123-456 ")).toBe("123456"));
  test("digest is keyed and case-insensitive on email", () => {
    expect(codeDigest("k", "login", "A@B.co", "123456")).toBe(codeDigest("k", "login", "a@b.co", "123456"));
    expect(codeDigest("k", "login", "a@b.co", "123456")).not.toBe(codeDigest("k2", "login", "a@b.co", "123456"));
    expect(codeDigest("k", "login", "a@b.co", "123456")).not.toBe(codeDigest("k", "login", "a@b.co", "123457"));
  });
  test("verdict order", () => {
    const d = codeDigest("k", "login", "a@b.co", "111111");
    const row = { codeHash: d, attempts: 0, expiresAt: new Date(Date.now() + 60_000), usedAt: null };
    expect(checkOtp(row, d)).toBe("ok");
    expect(checkOtp(row, "nope")).toBe("wrong");
    expect(checkOtp(null, d)).toBe("wrong");
    expect(checkOtp({ ...row, usedAt: new Date() }, d)).toBe("used");
    expect(checkOtp({ ...row, expiresAt: new Date(Date.now() - 1) }, d)).toBe("expired");
    expect(checkOtp({ ...row, attempts: OTP_MAX_ATTEMPTS }, d)).toBe("locked");
  });
});

describe("TOTP (RFC 6238 vectors, SHA1)", () => {
  test("base32 round trip", () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  test.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("t=%d", (t, want) => {
    expect(totp(RFC_KEY, t * 1000, 8)).toBe(want);
    expect(totp(RFC_KEY, t * 1000)).toBe(want.slice(2));
  });
  test("HOTP RFC 4226 counter 0..2", () => {
    const k = Buffer.from("12345678901234567890");
    expect([0, 1, 2].map((c) => hotp(k, c))).toEqual(["755224", "287082", "359152"]);
  });
  test("window and replay", () => {
    const s = newTotpSecret();
    expect(s).toHaveLength(32);
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(s, totp(s, now), now)).toBe(step);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(s, totp(s, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
    expect(verifyTotp(s, totp(s, now), now, step)).toBeNull(); // replay
    expect(verifyTotp(s, "12345", now)).toBeNull();
  });
  test("otpauth uri", () => {
    const u = otpauthUri({ secret: "ABC", account: "a@b.co", issuer: "Outlly" });
    expect(u.startsWith("otpauth://totp/Outlly%3Aa%40b.co?")).toBe(true);
    expect(new URL(u).searchParams.get("secret")).toBe("ABC");
    expect(groupKey("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});

describe("recovery codes", () => {
  test("shape, single use", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    const hashes = codes.map((c) => recoveryDigest("k", c));
    const left = spendRecovery(hashes, "k", codes[3].toUpperCase().replace("-", " "));
    expect(left).toHaveLength(9);
    expect(spendRecovery(left!, "k", codes[3])).toBeNull();
    expect(looksLikeRecovery(codes[0])).toBe(true);
    expect(looksLikeRecovery("123456")).toBe(false);
    expect(parseHashes("oops")).toEqual([]);
  });
});

describe("QR encoder", () => {
  test("sizes follow the version", () => {
    expect(qrMatrix("hello")).toHaveLength(21);
    expect(qrMatrix(otpauthUri({ secret: newTotpSecret(), account: "creator@studio.dev", issuer: "Outlly" })).length).toBeGreaterThanOrEqual(45);
    expect(() => qrMatrix("x".repeat(600))).toThrow();
  });
  test("finder patterns in three corners", () => {
    const m = qrMatrix("hello");
    const n = m.length;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      expect(m[y][x] && m[y + 6][x + 6] && m[y + 3][x + 3]).toBe(true);
      expect(m[y + 1][x + 1]).toBe(false);
    }
    expect(qrSvgPath("hello").size).toBe(29);
  });
});
