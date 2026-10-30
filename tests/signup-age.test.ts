/** 1058: accounts are 18+, enforced by the API schema, not only the checkbox. */
import { describe, expect, test } from "bun:test";
import { signupSchema } from "../lib/validation";

const base = { name: "Asha", email: "asha@example.com", password: "longenough1" };

describe("signup age confirmation", () => {
  test("rejects a signup without the 18+ confirmation", () => {
    const r = signupSchema.safeParse(base);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("18 or older");
  });
  test("rejects anything but literal true", () => {
    for (const adult of [false, "true", 1, "yes"]) expect(signupSchema.safeParse({ ...base, adult }).success).toBe(false);
  });
  test("accepts a confirmed adult", () => {
    expect(signupSchema.safeParse({ ...base, adult: true }).success).toBe(true);
  });
});
