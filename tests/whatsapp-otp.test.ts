import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { maskPhone, normalizePhone, redactCode, whatsappCodePayload } from "../lib/phone";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("normalizePhone", () => {
  test("Indian mobiles in every usual shape", () => {
    for (const s of ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "919876543210", "0091 9876543210", "(+91) 98765.43210"])
      expect(normalizePhone(s)).toBe("+919876543210");
  });
  test("other countries need a + or 00", () => {
    expect(normalizePhone("+1 (415) 555-0123")).toBe("+14155550123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("4155550123")).toBeNull();
  });
  test("junk is refused", () => {
    for (const s of ["", "abc", "12345", "+0123456789", "+91 12345 67890", "+91 98765 4321", "98765/43210", "+1234567890123456", "9".repeat(40)])
      expect(normalizePhone(s)).toBeNull();
  });
});

describe("maskPhone", () => {
  test("keeps the country code and last four", () => {
    expect(maskPhone("+919876543210")).toBe("+91 ••••••3210");
    expect(maskPhone("+14155550123")).toBe("+1 ••••••0123");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("9876543210")).toBeNull();
  });
});

describe("Cloud API payload", () => {
  test("code goes in the body and the copy-code button, number without +", () => {
    const p = whatsappCodePayload("+919876543210", "123456", "outlly_code", "en");
    expect(p.to).toBe("919876543210");
    expect(p.template.name).toBe("outlly_code");
    expect(p.template.language.code).toBe("en");
    expect(JSON.stringify(p.template.components)).toBe(JSON.stringify([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]));
  });
  test("codes never survive into error text", () => {
    expect(redactCode("bad param 123456 in 123456", "123456")).toBe("bad param •••••• in ••••••");
    expect(redactCode("nothing", "")).toBe("nothing");
  });
});

describe("wiring", () => {
  test("token is a secret and WhatsApp is off by default", () => {
    const s = src("lib/settings.ts");
    expect(s).toContain('whatsapp: ["token"]');
    expect(s).toMatch(/whatsapp: \{ enabled: false/);
  });
  test("both schemas carry the proven phone", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = src(f);
      expect(s).toMatch(/phone\s+String\?\s+@unique/);
      expect(s).toMatch(/phoneVerifiedAt DateTime\?/);
    }
  });
  test("WhatsApp codes use their own keys, never an email address", () => {
    const s = src("lib/otp/whatsapp.ts");
    for (const k of ["`wa:${phone}`", "`add:${userId}:${phone}`", "`2fa:${userId}`"]) expect(s).toContain(k);
    expect(s).toContain("WA_PER_DAY");
    expect(s).not.toMatch(/console\.\w+\([^)]*\bcode\b\)/);
  });
  test("a WhatsApp first step can't also be the second", () => {
    const s = src("lib/otp/two-factor.ts");
    expect(s).toContain('ch.m === "whatsapp"');
    expect(src("app/api/auth/code/verify/route.ts")).toContain('beginSignIn(user.id, "whatsapp"');
  });
  test("only a proven number is saved", () => {
    const s = src("lib/otp/whatsapp.ts");
    const start = s.slice(s.indexOf("export async function startPhoneAdd"), s.indexOf("export async function confirmPhoneAdd"));
    expect(start).not.toContain("db.user.update");
  });
});
