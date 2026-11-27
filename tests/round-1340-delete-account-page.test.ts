/**
 * R1340: the public account-deletion page Google Play requires (Play Console > App content > Data deletion).
 *
 * Source pins: /delete-account exists in the marketing tree with a canonical and a dated PageHead; it is open in every
 * site mode (signed out, waitlist, maintenance) and in the sitemap; the Footer's Legal group and the privacy page link
 * to it; the client action is the SAME deletion as Settings (DELETE /api/settings/account, email typed to confirm,
 * redirect to /account-deleted#token), sends people to sign in with a same-site `next`, and never names a price or the
 * app as the only way. The Android readiness doc names the URL.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DELETE_ACCOUNT_PATH, SIGN_IN_TO_DELETE } from "../components/account/DeleteAccountRequest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("app/(marketing)/delete-account/page.tsx");
const action = read("components/account/DeleteAccountRequest.tsx");
const middleware = read("middleware.ts");

describe("R1340 public account-deletion page", () => {
  test("the page is public, canonical, dated and explains deleted vs kept", () => {
    expect(page).toContain('canonical: "/delete-account"');
    expect(page).toMatch(/<PageHead title="Delete your account" updated="\d{1,2} \w+ \d{4}"/);
    expect(page).toContain("<DeleteAccountRequest />");
    for (const h of ["Three ways to delete", "What gets deleted", "What is kept, and why", "How long it takes", "Before you go"]) expect(page).toContain(`<h2>${h}</h2>`);
    expect(page).toContain("Invoices:");
    expect(page).toContain("8 years");
    expect(page).toContain("Uninstalling the app does not delete your account");
    expect(page).toContain('href="mailto:support@outlly.com?subject=Delete%20my%20account"');
    expect(page).not.toMatch(/robots:\s*\{\s*index:\s*false/); // reviewers and search must reach it
  });

  test("middleware keeps it open in every site mode; sitemap, footer and privacy page point at it", () => {
    for (const list of ["const OPEN = [", "const WAITLIST_OPEN = [", "const MAINTENANCE_OPEN = ["]) {
      const line = middleware.slice(middleware.indexOf(list), middleware.indexOf("];", middleware.indexOf(list)));
      expect(line).toContain('"/delete-account"');
    }
    expect(middleware).not.toMatch(/NOINDEX = \[[^\]]*"\/delete-account"/);
    expect(read("app/sitemap.ts")).toContain("${BASE}/delete-account");
    expect(read("components/marketing/Footer.tsx")).toContain('{ href: "/delete-account", label: "Delete account" }');
    expect(read("app/(marketing)/privacy/page.tsx")).toContain('<a href="/delete-account">outlly.com/delete-account</a>');
  });

  test("the action is the Settings deletion, not a new one", () => {
    expect(action).toContain('"/api/settings/account", { method: "DELETE", json: { confirm: confirm.trim() } }');
    expect(action).toContain('r.status?.startsWith("/account-deleted#") ? r.status : "/"');
    expect(action).toContain("await forgetBillingCopies()");
    expect(action).toContain('api<Me>("/api/me")'); // who is here, read in the browser (page stays static)
    expect(action).toContain("useSignedIn");
    expect(action).toContain("if (me.workspace)"); // teammates are told before they type (server says 403 NOT_OWNER)
    expect(action).not.toMatch(/fetch\(/); // same client as the rest of the studio (same-origin header, ApiError)
  });

  test("sign-in hand-off is a same-site next back to this page", () => {
    expect(DELETE_ACCOUNT_PATH).toBe("/delete-account");
    expect(SIGN_IN_TO_DELETE).toBe("/login?next=%2Fdelete-account");
    expect(action).toContain("href={SIGN_IN_TO_DELETE}");
  });

  test("accessible form: label tied to the input, error announced, 44 px buttons from the shared Button", () => {
    expect(action).toContain("<Label htmlFor={`${id}-c`}>");
    expect(action).toContain("id={`${id}-c`}");
    expect(action).toContain('role="alert"');
    expect(action).toContain("aria-invalid={error ? true : undefined}");
    expect(action).toContain('role="status" aria-live="polite"');
    expect((action.match(/<Button/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(action).not.toMatch(/<button/); // every control is the shared Button (min-h-11)
  });

  test("the Android readiness doc names the URL for Play Console", () => {
    expect(read("../../outlly-compose/docs/play-store-readiness.md")).toContain("https://outlly.com/delete-account");
  });
});
