/**
 * UI / UX audit (ui teammate).
 * Each test here failed before the fix in the same commit and passes after.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Tailwind arbitrary values stay unambiguous", () => {
  /**
   * `ease-[cubic-bezier(0.4,0,0.2,1)]` made Tailwind 3 print
   * "The class `before:ease-[cubic-bezier(0.4,0,0.2,1)]` is ambiguous and matches multiple utilities"
   * on every build. The curve is already a motion token, so the class points at that instead.
   */
  test("no arbitrary ease value carries a bare comma list", () => {
    const src = read("components/ui/animated-link.tsx");
    expect(src).not.toMatch(/ease-\[/); // any arbitrary ease value warns, a var() one included
    expect(src).toContain("before:ease-std");
  });

  test("the named easing the class points at is defined", () => {
    expect(read("tailwind.config.ts")).toMatch(/std:\s*"var\(--m-ease-std\)"/);
    expect(read("app/globals.css")).toMatch(/--m-ease-std:\s*cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/);
  });
});

describe("admin pages fit a phone", () => {
  /** A min-w table inside a flex/grid track with min-width:auto pushed the whole page sideways (723px at 390px). */
  test("every behaviour row lets its cards shrink", () => {
    const src = read("components/admin/BehaviorBreakdown.tsx");
    for (const m of src.matchAll(/className="grid gap-4[^"]*"/g)) expect(m[0]).toContain("[&>*]:min-w-0");
    expect(src).toContain("gs-stage flex flex-col gap-4 [&>*]:min-w-0");
    // Fractional tracks have to allow a zero minimum, or the track grows to its content.
    expect(src).not.toMatch(/lg:grid-cols-\[(?!minmax)[^\]]*fr_/);
  });

  /** The direct-messages block held a webhook URL, and its implicit auto column sized to that URL. */
  test("the platform key columns cannot exceed their track", () => {
    const src = read("components/admin/PlatformKeysForm.tsx");
    expect(src).toContain('className="mt-5 grid grid-cols-1 min-w-0 gap-4 [&>*]:min-w-0"');
    expect(src).toContain('className="grid min-w-0 grid-cols-1 gap-2 [&>*]:min-w-0"');
    expect(src).not.toMatch(/className="grid gap-2"/);
  });
});

describe("practice accounts are reachable exactly when they are allowed", () => {
  test("the accounts page passes practiceAllowed() to the view", () => {
    const src = read("app/(studio)/accounts/page.tsx");
    expect(src).toContain("practiceAllowed");
    expect(src).toMatch(/practice: practiceAllowed\(\)/);
  });

  test("the connect button and the lock message both respect it", () => {
    const src = read("components/settings/AccountsView.tsx");
    // No keys, no token and no practice mode: only then is the platform locked.
    expect(src).toContain('{!ok && !setup[p].oauth && !setup[p].token && !setup[p].practice && (');
    expect(src).toContain("{!ok && (setup[p].oauth || setup[p].practice) && (");
    expect(src).toContain("Set up a practice account");
  });
});

describe("one currency everywhere", () => {
  test("the landing prices in the currency the gateway charges", () => {
    const src = read("components/marketing/Pricing.tsx");
    expect(src).toContain("chargeCurrency(gw.provider, visitor.currency,");
    expect(src).toContain("inCurrency(all, charged)");
    expect(src).toContain("priceFor(base, charged,");
    expect(src).toContain("<CurrencyNote currency={charged} wanted={visitor.currency}");
  });

  test("the billing pill names the charged currency, not the visitor's", () => {
    expect(read("app/(studio)/billing/page.tsx")).toContain("charged={chargeCurrency(gw.provider, visitor.currency,");
    expect(read("components/billing/BillingView.tsx")).toContain("<CurrencyNote currency={props.charged ?? props.currency} wanted={props.currency}");
  });

  test("the note explains a currency the visitor did not ask for", () => {
    const src = read("components/billing/CurrencyNote.tsx");
    expect(src).toContain("const forced = !!wanted && wanted !== currency;");
    expect(src).toContain("what our payment provider charges");
  });
});

describe("headings and titles", () => {
  /** The hidden welcome screen is mounted on every studio page, so its heading made two h1 per page. */
  test("the welcome screen holds no h1", () => {
    const src = read("components/shell/PwaWelcome.tsx");
    expect(src).not.toMatch(/<h1[\s>]/);
    expect(src).toContain('<p id="pw-title" className="pw-title pw-b">');
    expect(src).toContain('aria-labelledby="pw-title"'); // still names the dialog
  });

  /** The root template appends " \u00b7 Outlly", so a title holding the brand printed it twice. */
  test("no page title repeats the brand the template adds", () => {
    expect(read("app/layout.tsx")).toContain('template: "%s \u00b7 Outlly"');
    for (const f of ["app/(marketing)/page.tsx", "app/app-share/page.tsx"]) {
      const src = read(f);
      const m = /title:\s*(\{\s*absolute:\s*)?"([^"]*)"/.exec(src)!;
      if (/Outlly/.test(m[2])) expect(m[1]).toBeTruthy();
    }
  });
});

describe("a checkout link with no payment is a clean 404", () => {
  /**
   * notFound() from the page body landed after the shell had flushed: React aborted the open
   * boundaries (two "Minified React error #419" in the console) and the title stayed "Checkout".
   */
  test("the decision happens in generateMetadata, on one shared read", () => {
    const src = read("app/(studio)/billing/checkout/page.tsx");
    expect(src).toContain('import { cache } from "react"');
    expect(src).toContain("const loadPayment = cache(");
    expect(src).toMatch(/generateMetadata[\s\S]*user && !payment \? "Page not found" : "Checkout"/);
    // The page reuses the same cached read instead of querying again.
    expect(src).toContain("await loadPayment(searchParams.p)");
    // It renders the shared not-found screen rather than throwing into a flushed shell.
    expect(src).toContain("if (!p) return <NotFound />;");
    expect(src).not.toMatch(/import \{[^}]*notFound/);
  });
});

describe("an upload that failed says so", () => {
  test("the assistant has a failed bubble and stops claiming the video is in", () => {
    const src = read("components/create/Assistant.tsx");
    expect(src).toContain('{p.hasMedia && p.upload.kind === "failed" && (');
    expect(src).toContain("That upload didn&apos;t make it.");
    expect(src).toContain('p.upload.kind !== "uploading" && p.upload.kind !== "failed" && p.meta?.duration');
  });
});
