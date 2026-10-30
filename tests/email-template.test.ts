/** Shared email chrome: brand fonts, preheader, footer, escaping, and that every template renders. */
import { beforeAll, describe, expect, test } from "bun:test";
import type { WeeklyStats } from "../lib/reports/weekly-core";

let templates: typeof import("../lib/email").templates;

beforeAll(async () => {
  process.env.APP_URL = "https://outlly.test/";
  templates = (await import("../lib/email")).templates;
}, 60_000);

const stats = (over: Partial<WeeklyStats> = {}): WeeklyStats => ({
  published: 4,
  views: 12_400,
  likes: 310,
  comments: 42,
  byPlatform: [
    { platform: "instagram", posts: 2, views: 9000 },
    { platform: "youtube", posts: 1, views: 3400 },
  ],
  top: { title: "Cold brew in 60s", platform: "youtube", views: 3400 },
  upcoming: 2,
  ...over,
});

const all = () => ({
  invoice: templates.invoice({ name: "Tej", number: "INV-1", amount: "$19.00", plan: "Pro", url: "https://outlly.test/billing" }),
  ticketOpened: templates.ticketOpened({ name: "Tej", ref: "T-7", subject: "Upload stuck", url: "https://outlly.test/help" }),
  ticketReply: templates.ticketReply({ name: "Tej", ref: "T-7", body: "We fixed it.", status: "resolved" }),
  refund: templates.refund({ name: "Tej", amount: "$19.00", number: "INV-1" }),
  canceled: templates.canceled({ name: "Tej", plan: "Pro", until: "1 Nov 2026", url: "https://outlly.test/billing" }),
  waitlistInvite: templates.waitlistInvite({ url: "https://outlly.test/signup", name: "Tej" }),
  waitlistInviteAnon: templates.waitlistInvite({ url: "https://outlly.test/signup", name: null }),
  backOnline: templates.backOnline({ url: "https://outlly.test" }),
  weeklyReport: templates.weeklyReport({ name: "Tej", stats: stats(), url: "https://outlly.test/analytics", settingsUrl: "https://outlly.test/settings" }),
  weeklyReportQuiet: templates.weeklyReport({
    name: "Tej",
    stats: stats({ published: 0, views: 0, likes: 0, comments: 0, byPlatform: [], top: null, upcoming: 0 }),
    url: "https://outlly.test/analytics",
    settingsUrl: "https://outlly.test/settings",
  }),
  teamInvite: templates.teamInvite({ owner: "Ana", role: "editor", url: "https://outlly.test/invite" }),
  referralReward: templates.referralReward({ name: "Tej", friend: "Ana", plan: "Creator", length: "1 month", starts: "1 Nov 2026", until: "1 Dec 2026", url: "https://outlly.test/settings#referral" }),
  test: templates.test("resend"),
});

describe("email wrapper", () => {
  test("every template renders a complete document with the brand chrome", () => {
    for (const [name, html] of Object.entries(all())) {
      expect(html.startsWith("<!doctype html"), name).toBe(true);
      expect(html.endsWith("</html>"), name).toBe(true);
      expect(html, name).toContain('<meta name="color-scheme" content="light only">');
      expect(html, name).toContain('role="presentation"');
      expect(html, name).toContain("max-width:600px");
      expect(html, name).toContain("/brand/rocket/mark-anim.gif");
      expect(html, name).toContain(">Outlly<");
      expect(html, name).toContain("@media only screen and (max-width:600px)");
      expect(html.includes("undefined"), name).toBe(false);
      expect(/[\u2014\u2013]/.test(html), name).toBe(false);
    }
  });

  test("loads both brand fonts and keeps a safe fallback stack inline", () => {
    const html = templates.test("resend");
    // Self-hosted (1058): nothing in an email may load from Google.
    expect(html).toContain('<link rel="stylesheet" href="https://outlly.test/brand/email/fonts/fonts.css">');
    expect(html).toContain("@import url('https://outlly.test/brand/email/fonts/fonts.css');");
    expect(html).not.toMatch(/googleapis|gstatic/);
    expect(html).toContain("'Bricolage Grotesque','Segoe UI',Helvetica,Arial,sans-serif");
    expect(html).toContain("'DM Sans',Helvetica,Arial,sans-serif");
    for (const m of html.matchAll(/font-family:([^;"]+)/g)) {
      expect(m[1]).toContain("Arial,sans-serif");
    }
  });

  test("h1 uses the display font and body copy is 15px or larger", () => {
    const html = templates.refund({ name: "Tej", amount: "$1", number: "INV-9" });
    expect(html).toMatch(/<h1[^>]+font-family:'Bricolage Grotesque'/);
    expect(html).toContain("font-size:16px;line-height:1.6");
  });

  test("hidden preheader defaults to the title and can be overridden", () => {
    const plain = templates.backOnline({ url: "https://outlly.test" });
    expect(plain).toMatch(/<span style="display:none[^"]*mso-hide:all">We're back online<\/span>/);

    const invoice = templates.invoice({ name: "Tej", number: "INV-42", amount: "$19.00", plan: "Pro", url: "https://outlly.test/billing" });
    expect(invoice).toContain(">Invoice INV-42 for Pro</span>");
    const evilInvoice = templates.invoice({ name: "x", number: "<script>", amount: "$1", plan: "<b>", url: "https://outlly.test" });
    expect(evilInvoice).not.toContain("<script>");
    expect(invoice).toContain("Payment received. Thank you!");
  });

  test("bulletproof button is a soft pill in the hero's accent with a white label", () => {
    const html = templates.backOnline({ url: "https://outlly.test/go" });
    expect(html).toContain('bgcolor="#3f6b2c"');
    expect(html).toContain("border-radius:999px");
    expect(html).toMatch(/<a href="https:\/\/outlly\.test\/go"[^>]+color:#ffffff[^>]*>Open Outlly<\/a>/);
    expect(templates.refund({ name: "Tej", amount: "$1", number: "INV-9" })).not.toContain('bgcolor="#3f6b2c"');
  });

  test("soft sunrise: white card, pastel hero with kicker and illustration, no neon", () => {
    const html = templates.invoice({ name: "Tej", number: "INV-1", amount: "$19.00", plan: "Pro", url: "https://outlly.test/billing" });
    expect(html).toContain("background:#f3f1ec");
    expect(html).toMatch(/bgcolor="#eef6dc" style="background:#eef6dc;border-radius:24px 24px 0 0/);
    expect(html).toContain('src="https://outlly.test/brand/email/hero-lime.png"');
    expect(html).toContain("text-transform:uppercase;color:#3f6b2c\">Billing</div>");
    expect(html).toContain("$19.00");
    expect(html).toContain('class="stack"');
    expect(templates.refund({ name: "Tej", amount: "$1", number: "INV-9" })).toContain('src="https://outlly.test/brand/email/hero-cream.png"');
    expect(templates.security({ name: "Tej", change: "off", url: "https://outlly.test/settings", at: new Date(0) })).toContain("hero-white.png");
    for (const [name, h] of Object.entries(all())) {
      expect(h.includes("%%outlly-accent%%"), name).toBe(false);
      expect(/#9ff218|#151713|#0b0d08/i.test(h), name).toBe(false);
    }
  });

  test("footer carries the help line, wordmark, tagline, links, reason line and copyright", () => {
    for (const [name, html] of Object.entries(all())) {
      expect(html, name).toContain("Questions? Just reply to this email");
      expect(html, name).toContain("Create once. Publish everywhere.");
      expect(html, name).toContain('href="https://outlly.test/help"');
      expect(html, name).toContain('href="https://outlly.test/privacy"');
      expect(html, name).toContain('href="https://outlly.test/terms"');
      expect(html, name).toContain('href="https://outlly.test/settings"');
      expect(html, name).toContain("You are receiving this because you have an Outlly account.");
      expect(html, name).toContain(`&copy; ${new Date().getFullYear()} Outlly`);
      expect(html, name).toContain("background:#ebe8e2");
    }
  });

  test("escapes user input everywhere it is interpolated", () => {
    const evil = "<script>alert(1)</script>";
    const htmls = [
      templates.invoice({ name: evil, number: evil, amount: evil, plan: evil, url: "https://outlly.test" }),
      templates.ticketOpened({ name: evil, ref: evil, subject: evil, url: "https://outlly.test" }),
      templates.ticketReply({ name: evil, ref: evil, body: evil, status: evil }),
      templates.teamInvite({ owner: evil, role: evil, url: "https://outlly.test" }),
      templates.waitlistInvite({ url: "https://outlly.test", name: evil }),
      templates.weeklyReport({
        name: evil,
        stats: stats({ byPlatform: [{ platform: evil, posts: 1, views: 1 }], top: { title: evil, platform: evil, views: 1 } }),
        url: "https://outlly.test",
        settingsUrl: "https://outlly.test/settings",
      }),
      templates.test(evil),
    ];
    for (const html of htmls) {
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
  });

  test("weekly report shows stats when there are posts and a quiet note when there are none", () => {
    const busy = templates.weeklyReport({ name: "Tej", stats: stats(), url: "https://outlly.test/a", settingsUrl: "https://outlly.test/settings" });
    expect(busy).toContain("Your week on Outlly");
    expect(busy).toContain("posts out");
    expect(busy).toContain("Instagram");
    expect(busy).toContain("YouTube");
    expect(busy).toContain("Best performer");
    expect(busy).toContain("2 posts are scheduled for this week.");

    const quiet = templates.weeklyReport({
      name: "Tej",
      stats: stats({ published: 0, views: 0, likes: 0, comments: 0, byPlatform: [], top: null, upcoming: 0 }),
      url: "https://outlly.test/a",
      settingsUrl: "https://outlly.test/settings",
    });
    expect(quiet).toContain("A quiet week");
    expect(quiet).toContain("nothing went out last week");
    expect(quiet).not.toContain("posts out");
  });
});
