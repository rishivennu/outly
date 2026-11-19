/**
 * R1222 (perf phase 1): brand art ships as WebP. The 1.07 MB of rocket, logo, founding, payment and brand PNGs
 * became 331 KB of WebP (lossless where the source was lossless, q90 otherwise), every component points at the
 * .webp, the unused 48-icon PNG set and its 2.1 MB sheet are gone, and the images that sit below the fold or in
 * lists carry loading="lazy" decoding="async" so the first paint is not queued behind them. Kept as PNG on purpose:
 * the invoice/email stamp art, the notification icons and the PWA icons, which non-browser consumers read.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("R1222 WebP brand art", () => {
  test("every component points at .webp, none at the old PNGs", () => {
    for (const f of [
      "components/brand/Logo.tsx",
      "components/brand/brands.tsx",
      "components/founding/FoundingStamp.tsx",
      "components/admin/FoundingPanel.tsx",
      "components/settings/BillingCards.tsx",
      "components/brand/ServiceLogo.tsx",
    ]) {
      const s = src(f);
      expect(s).not.toMatch(/\/brand\/(rocket|logos|founding|pay)\/[^"'`]*\.png/);
      expect(s).not.toMatch(/\/brands\/[^"'`]*\.png/);
    }
    expect(src("components/brand/Logo.tsx")).toContain("`/brand/rocket/${name}-96.webp` : `/brand/rocket/${name}-256.webp`");
    expect(src("components/brand/Logo.tsx")).toContain("`/brand/rocket/mark-light-${n}.webp`");
    expect(src("components/brand/brands.tsx")).toContain('/brand/logos/${p}${dark && REVERSED.has(p) ? "-dark" : ""}.webp');
    expect(src("components/brand/brands.tsx")).toContain("/brands/${brand}.webp");
    expect(src("scripts/brand-platform-icons.mjs")).toContain("${p}.webp");
  });
  test("the referenced WebP files exist on disk", () => {
    const need = [
      ...["rocket", "rocket-ink", "rocket-white", "rocket-lime-ink"].flatMap((n) => [96, 256].map((s) => `public/brand/rocket/${n}-${s}.webp`)),
      ...[64, 128, 256].flatMap((s) => [`public/brand/rocket/mark-${s}.webp`, `public/brand/rocket/mark-light-${s}.webp`]),
      "public/brand/rocket/mark-light-512.webp",
      ...["instagram", "youtube", "x", "x-dark", "tiktok", "tiktok-dark", "threads", "threads-dark", "facebook", "linkedin"].map((p) => `public/brand/logos/${p}.webp`),
      "public/brand/pay/upi.webp",
      "public/brands/later.webp",
      "public/brands/metricool.webp",
    ];
    const missing = need.filter((p) => !existsSync(p));
    expect(missing).toEqual([]);
    // the files the invoice PDF and the founding email still read stay PNG
    expect(existsSync("public/brand/rocket/rocket-ink-256.png")).toBe(true);
    expect(existsSync("public/brand/founding/01-rocket-badge.png")).toBe(true);
    for (const m of src("components/settings/BillingCards.tsx").matchAll(/"(\/brand\/pay\/[^"]+\.webp)"/g)) expect(existsSync(`public${m[1]}`)).toBe(true);
    for (const m of src("components/founding/FoundingStamp.tsx").matchAll(/"(\/brand\/founding\/[^"]+\.webp)"/g)) expect(existsSync(`public${m[1]}`)).toBe(true);
  });
  test("the unused icon set, its sheet and the big GIFs are gone, with their config and CSS", () => {
    expect(existsSync("public/brand/icons")).toBe(false);
    expect(existsSync("public/brand/icon-sheet.png")).toBe(false);
    expect(existsSync("public/brand/rocket/rocket-anim-forest.gif")).toBe(false);
    expect(src("next.config.mjs")).not.toContain("icon-sheet.png");
    expect(src("next.config.mjs")).not.toContain("brand/icons/**");
    expect(src("app/globals.css")).not.toContain("/brand/icons/");
  });
  test("list and below-the-fold images are lazy with async decoding; the login art and PWA icons stay eager", () => {
    const lazy = [
      ["components/brand/brands.tsx", 2],
      ["components/home/SendingNow.tsx", 1],
      ["components/home/ProfileSwitcher.tsx", 1],
      ["components/inbox/InboxList.tsx", 1],
      ["components/analytics/AccountDrill.tsx", 1],
      ["components/analytics/ProfileExtras.tsx", 1],
      ["components/analytics/AnalyticsView.tsx", 1],
      ["components/create/DeviceDrafts.tsx", 1],
      ["components/create/BulkPlanner.tsx", 1],
      ["components/create/PublishingView.tsx", 3],
      ["components/admin/liveassist/LiveAssistConsole.tsx", 1],
    ] as const;
    for (const [f, n] of lazy) expect(src(f).match(/loading="lazy" decoding="async"/g)?.length ?? 0).toBeGreaterThanOrEqual(n);
    expect(src("components/brand/Logo.tsx")).toContain('loading: "lazy" as const');
    for (const f of ["components/create/Previews.tsx", "components/create/UploadCard.tsx", "components/create/VideoStage.tsx", "components/blog/BlogArticle.tsx", "components/brand/OrbAvatar.tsx"])
      expect(src(f)).toContain('decoding="async"');
    expect(src("components/shell/WelcomeArt.tsx")).not.toContain('loading="lazy"');
    expect(src("components/shell/InstallPrompt.tsx")).not.toContain('loading="lazy"');
  });
});
