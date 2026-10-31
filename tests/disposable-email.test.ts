/** Throwaway inboxes are refused at sign-up and on the waitlist (1076). */
import { describe, expect, test } from "bun:test";
import { DISPOSABLE_MESSAGE, isDisposableEmail } from "@/lib/disposable-email";
import { signupSchema } from "@/lib/validation";

describe("isDisposableEmail", () => {
  test("known services", () => {
    for (const e of ["a@mailinator.com", "b@yopmail.com", "c@guerrillamail.com", "d@10minutemail.com", "e@temp-mail.org"]) expect(isDisposableEmail(e)).toBe(true);
  });
  test("case, spaces, trailing dot and subdomains", () => {
    expect(isDisposableEmail("X@MAILINATOR.COM")).toBe(true);
    expect(isDisposableEmail("x@mailinator.com.")).toBe(true);
    expect(isDisposableEmail("x@inbox.mailinator.com")).toBe(true);
  });
  test("real providers pass", () => {
    for (const e of ["a@gmail.com", "b@outlook.com", "c@icloud.com", "d@outlly.com", "e@company.co.in", "f@proton.me"]) expect(isDisposableEmail(e)).toBe(false);
  });
  test("lookalikes are not caught", () => {
    expect(isDisposableEmail("a@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("a@mailinator.company")).toBe(false);
  });
  test("no @ is not disposable", () => {
    expect(isDisposableEmail("mailinator.com")).toBe(false);
  });
});

describe("signupSchema", () => {
  test("refuses a throwaway inbox", () => {
    const ok = { name: "Asha", email: "asha@gmail.com", password: "a-long-password-123", adult: true };
    expect(signupSchema.safeParse(ok).success).toBe(true);
    const r = signupSchema.safeParse({ ...ok, email: "asha@mailinator.com" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual([DISPOSABLE_MESSAGE]);
  });
});
