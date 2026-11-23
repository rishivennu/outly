// R1306 support@ as the default Reply-To, and RFC 9116 security.txt. Every public page points reports and takedowns
// at support@outlly.com (/terms, /security, invoices), while outgoing mail was sent from hello@mail.outlly.com with no
// Reply-To, so a reply to a sign-in code or a receipt went to the sending subdomain and not to the team. Now the alias
// lives in one place (lib/support.ts), is the stored default, and is the send-time fallback for an empty field (an admin
// who saved the form before this round has "" in the database, and merge() keeps stored values). The same alias is
// published for scanners at /.well-known/security.txt with a self-rolling Expires, and the legacy /security.txt
// redirects to it; the /security page links the file.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUPPORT_EMAIL } from "@/lib/support";
import { expiresAt, securityTxt } from "@/lib/security-txt";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

describe("R1306 one support alias", () => {
  test("lib/support.ts is the home; invoice.ts re-exports it and still uses it", () => {
    expect(SUPPORT_EMAIL).toBe("support@outlly.com");
    const inv = read("lib/billing/invoice.ts");
    expect(inv).toContain('import { SUPPORT_EMAIL } from "../support";');
    expect(inv).toContain("export { SUPPORT_EMAIL };");
    expect(inv).toContain("support: { email: SUPPORT_EMAIL,");
    expect(inv).not.toContain('SUPPORT_EMAIL = "support@outlly.com"');
  });
  test("the public pages still name the same alias", () => {
    for (const f of ["app/(marketing)/terms/page.tsx", "app/(marketing)/security/page.tsx", "components/partners/Sections.tsx"]) {
      const s = read(f);
      expect(s).toMatch(f.includes("partners") ? /mailto:partners@outlly\.com/ : /mailto:support@outlly\.com/);
    }
  });
});

describe("R1306 Reply-To", () => {
  test("the stored default is the support alias", () => {
    const s = read("lib/settings.ts");
    expect(s).toContain('import { SUPPORT_EMAIL } from "./support";');
    expect(s).toMatch(/email: \{ provider: "mock", from: "Outlly <hello@mail\.outlly\.com>", marketingFrom: "", replyTo: SUPPORT_EMAIL,/);
  });
  test("an empty saved field falls back to the alias at send time, never to no Reply-To", () => {
    const s = read("lib/email/index.ts");
    expect(s).toContain('import { SUPPORT_EMAIL } from "@/lib/support";');
    expect(s).toContain("reply_to: cfg.replyTo.trim() || SUPPORT_EMAIL,");
    expect(s).not.toContain("reply_to: cfg.replyTo || undefined");
  });
  test("the admin form says what empty means", () => {
    const s = read("components/admin/IntegrationsForm.tsx");
    expect(s).toContain('placeholder="support@outlly.com"');
    expect(s).toContain("Empty = support@outlly.com, the same queue as the contact form.");
  });
});

describe("R1306 security.txt", () => {
  test("the body follows RFC 9116: contact, expiry, languages, canonical, policy, trailing newline", () => {
    const body = securityTxt("https://www.outlly.com", new Date("2026-11-23T10:00:00Z"));
    expect(body.split("\n")).toEqual([
      "Contact: mailto:support@outlly.com?subject=Security%20report",
      "Contact: https://www.outlly.com/contact",
      "Expires: 2027-05-01T00:00:00.000Z",
      "Preferred-Languages: en",
      "Canonical: https://www.outlly.com/.well-known/security.txt",
      "Policy: https://www.outlly.com/security",
      "",
    ]);
  });
  test("Expires rolls forward on its own, always 5 to 7 months ahead and never in the past", () => {
    for (const d of ["2026-01-01T00:00:00Z", "2026-07-31T23:59:59Z", "2026-12-15T12:00:00Z", "2027-02-28T00:00:00Z"]) {
      const now = new Date(d), exp = new Date(expiresAt(now));
      const months = (exp.getUTCFullYear() - now.getUTCFullYear()) * 12 + exp.getUTCMonth() - now.getUTCMonth();
      expect(months).toBe(6);
      expect(exp.getUTCDate()).toBe(1);
      expect(exp.getTime()).toBeGreaterThan(now.getTime());
    }
    expect(new Date(expiresAt()).getTime()).toBeGreaterThan(Date.now() + 120 * 86400_000);
  });
  test("route files export only what Next allows and the legacy path redirects", () => {
    const wk = read("app/.well-known/security.txt/route.ts");
    expect(wk).toContain('import { securityTxt } from "@/lib/security-txt";');
    expect(wk).toContain("text/plain; charset=utf-8");
    expect(wk).toContain('export const dynamic = "force-dynamic";');
    expect(wk.match(/^export /gm)?.length).toBe(2);
    const legacy = read("app/security.txt/route.ts");
    expect(legacy).toContain('NextResponse.redirect(new URL("/.well-known/security.txt", env.APP_URL), 301)');
    // middleware never touches either: .well-known and *.txt are outside its matcher
    const mw = read("middleware.ts");
    expect(mw).toContain("\\\\.well-known|");
    expect(mw).toContain("txt|xml|");
  });
  test("the /security page links the file", () => {
    expect(read("app/(marketing)/security/page.tsx")).toContain('<a href="/.well-known/security.txt">/.well-known/security.txt</a>');
  });
});
