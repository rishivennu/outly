/** Pure rules added in the 10-12 round: local currency, captions, weekly report, team roles, referral codes, PayPal amounts. */
import { describe, expect, test } from "bun:test";
import { chargeCurrency, detectCurrency, localPrice, nicePrice, parsePrices, regionFromLanguage } from "../lib/billing/currency";
import { cueAt, cuesFromScript, chunkText, normalizeCues, toSeconds, toSrt, wrapLines, MAX_CUE_CHARS } from "../lib/captions/cues";
import { reportDue, summarize } from "../lib/reports/weekly-core";
import { memberBlock } from "../lib/team/roles";
import { isCode, makeCode, referrerFor } from "../lib/referral-core";
import { escapeLittleText } from "../lib/social/linkedin";
import { bestTimes, MIN_SAMPLES } from "../lib/schedule/best-time";

const hdr = (h: Record<string, string>) => (n: string) => h[n] ?? null;

describe("visitor currency", () => {
  test("an explicit choice beats the IP country", () => expect(detectCurrency(hdr({ "x-vercel-ip-country": "US" }), "EUR").currency).toBe("EUR"));
  test("US visitors see dollars, India rupees, Germany euros, UK pounds", () => {
    for (const [c, want] of [["US", "USD"], ["IN", "INR"], ["DE", "EUR"], ["GB", "GBP"], ["CA", "CAD"], ["AU", "AUD"], ["SG", "SGD"], ["AE", "AED"]] as const)
      expect(detectCurrency(hdr({ "x-vercel-ip-country": c }), undefined)).toMatchObject({ currency: want, source: "ip", country: c });
  });
  test("Cloudflare header works too, and a country we don't price in falls back to USD", () => {
    expect(detectCurrency(hdr({ "cf-ipcountry": "fr" }), null).currency).toBe("EUR");
    expect(detectCurrency(hdr({ "x-vercel-ip-country": "JP" }), null)).toMatchObject({ currency: "USD", source: "ip" });
  });
  test("no IP: browser language region, then the default", () => {
    expect(detectCurrency(hdr({ "accept-language": "en-GB,en;q=0.9" }), null)).toMatchObject({ currency: "GBP", source: "language" });
    expect(detectCurrency(hdr({ "accept-language": "en" }), null, "INR")).toMatchObject({ currency: "INR", source: "default" });
    expect(detectCurrency(hdr({ "x-vercel-ip-country": "XX" }), null, "USD").source).toBe("default");
    expect(regionFromLanguage("fr;q=0.8,de-AT")).toBe("AT");
  });
  test("a junk cookie is ignored", () => expect(detectCurrency(hdr({ "x-vercel-ip-country": "IN" }), "BTC").currency).toBe("INR"));
});

describe("local prices", () => {
  const plan = { priceMinor: 49900, currency: "INR" }; // ₹499
  test("same currency is untouched, free stays free", () => {
    expect(localPrice(plan, "INR")).toEqual({ priceMinor: 49900, currency: "INR", converted: false });
    expect(localPrice({ priceMinor: 0, currency: "INR" }, "USD").priceMinor).toBe(0);
  });
  test("conversion lands on a clean .99 price point", () => {
    const usd = localPrice(plan, "USD");
    expect(usd).toMatchObject({ currency: "USD", converted: true });
    expect(usd.priceMinor % 100).toBe(99);
    expect(usd.priceMinor).toBe(599); // 499 / 83.5 = 5.98 -> 5.99
  });
  test("an admin-set price always wins", () => expect(localPrice({ ...plan, prices: { USD: 700 } }, "USD")).toEqual({ priceMinor: 700, currency: "USD", converted: false }));
  test("rupee prices end in 9", () => {
    expect(nicePrice(149_250, "INR")).toBe(148_900); // 1,492.5 -> nearest 9 is 1,489
    expect(nicePrice(149_700, "INR")).toBe(149_900);
    expect(nicePrice(50, "INR")).toBe(900);
    expect(nicePrice(0, "USD")).toBe(0);
  });
  test("parsePrices keeps only known currencies with whole, non-negative amounts", () => {
    expect(parsePrices('{"USD":599,"XYZ":1,"EUR":-1,"GBP":4.5}')).toEqual({ USD: 599 });
    expect(parsePrices("not json")).toEqual({});
  });
  test("gateways charge what they can: Razorpay in the plan currency, PayPal never in AED/INR", () => {
    expect(chargeCurrency("razorpay", "USD", "INR")).toBe("INR");
    expect(chargeCurrency("stripe", "AED", "INR")).toBe("AED");
    expect(chargeCurrency("paypal", "EUR", "INR")).toBe("EUR");
    expect(chargeCurrency("paypal", "AED", "INR")).toBe("USD");
    expect(chargeCurrency("paypal", "INR", "INR")).toBe("USD");
  });
});

describe("caption cues", () => {
  test("timestamps in every shape the model returns", () => {
    expect(toSeconds("1:02.5")).toBe(62.5);
    expect(toSeconds("00:01:02,500")).toBe(62.5);
    expect(toSeconds("3.2s")).toBe(3.2);
    expect(toSeconds(4)).toBe(4);
    expect(Number.isNaN(toSeconds("soon"))).toBe(true);
  });
  test("long text splits on words and stays under the cue limit", () => {
    const parts = chunkText("one two three four five six seven eight nine ten eleven twelve thirteen fourteen");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CUE_CHARS);
  });
  test("normalize: drops blanks, sorts, applies the chunk offset, clamps and removes overlaps", () => {
    const c = normalizeCues(
      [
        { start: 5, end: 7, text: "second" },
        { start: "0:01", end: "0:06", text: "first" },
        { start: 2, end: 3, text: "   " },
        { start: 9, end: 99, text: "last" },
      ],
      70,
      60,
    );
    expect(c.map((x) => x.text)).toEqual(["first", "second", "last"]);
    expect(c[0].start).toBe(61);
    expect(c[0].end).toBe(65); // trimmed so it ends where "second" starts
    expect(c[2].end).toBe(70); // clamped to the clip
  });
  test("a cue with no end gets a readable minimum length", () => {
    const [c] = normalizeCues([{ start: 1, end: null, text: "hi" }]);
    expect(c.end - c.start).toBeGreaterThanOrEqual(0.6);
  });
  test("cueAt finds the cue on screen and nothing in gaps", () => {
    const cues = [{ start: 0, end: 1, text: "a" }, { start: 2, end: 3, text: "b" }, { start: 3, end: 4, text: "c" }];
    expect(cueAt(cues, 0.5)?.text).toBe("a");
    expect(cueAt(cues, 1.5)).toBeNull();
    expect(cueAt(cues, 3)?.text).toBe("c");
    expect(cueAt([], 1)).toBeNull();
  });
  test("a typed script spreads across the whole clip", () => {
    const c = cuesFromScript("Hello there\nThis is my video", 10);
    expect(c[0].start).toBe(0);
    expect(c[c.length - 1].end).toBe(10);
    expect(cuesFromScript("", 10)).toEqual([]);
  });
  test("SRT output", () => {
    expect(toSrt([{ start: 61.25, end: 62.5, text: "Hi" }])).toBe("1\n00:01:01,250 --> 00:01:02,500\nHi\n");
  });
  test("line wrap keeps to two lines", () => {
    const lines = wrapLines("a bb ccc dddd eeeee", 5, (s) => s.length);
    expect(lines.length).toBe(2);
  });
});

describe("weekly report", () => {
  const mon10IST = new Date("2026-10-12T04:30:00Z"); // Monday 10:00 in Kolkata
  const u = { weeklyReport: true, lastReportAt: null, timezone: "Asia/Kolkata" };
  test("due on Monday from 9 am in the creator's own zone", () => {
    expect(reportDue(u, mon10IST)).toBe(true);
    expect(reportDue({ ...u, timezone: "America/New_York" }, mon10IST)).toBe(false); // 00:30 Monday there
    expect(reportDue(u, new Date("2026-10-12T02:00:00Z"))).toBe(false); // 07:30 IST
    expect(reportDue(u, new Date("2026-10-13T04:30:00Z"))).toBe(false); // Tuesday
  });
  test("never twice in a week, never when turned off; force skips only the clock", () => {
    expect(reportDue({ ...u, lastReportAt: new Date(mon10IST.getTime() - 2 * 864e5) }, mon10IST)).toBe(false);
    expect(reportDue({ ...u, weeklyReport: false }, mon10IST, true)).toBe(false);
    expect(reportDue({ ...u, timezone: "America/New_York" }, mon10IST, true)).toBe(true);
  });
  test("summary totals, per-platform order and the top post", () => {
    const s = summarize(
      [
        { platform: "youtube", publishedAt: null, title: "A", views: 100, likes: 5, comments: 1 },
        { platform: "instagram", publishedAt: null, title: "B", views: 300, likes: 9, comments: 2 },
        { platform: "youtube", publishedAt: null, title: "C", views: 250, likes: 1, comments: 0 },
      ],
      4,
    );
    expect(s).toMatchObject({ published: 3, views: 650, likes: 15, comments: 3, upcoming: 4, top: { title: "B", views: 300 } });
    expect(s.byPlatform[0]).toEqual({ platform: "youtube", posts: 2, views: 350 });
    expect(summarize([{ platform: "x", publishedAt: null, title: "z", views: 0, likes: 0, comments: 0 }], 0).top).toBeNull();
  });
});

describe("team roles", () => {
  test("owners can do anything", () => expect(memberBlock("owner", "DELETE", "/api/billing/cancel")).toBeNull());
  test("members never touch billing, settings, accounts or the team list", () => {
    for (const p of ["/api/billing/checkout", "/api/settings/profile", "/api/accounts/youtube", "/api/team/members"]) expect(memberBlock("manager", "POST", p)).toMatch(/owner/i);
  });
  test("switching and leaving always work", () => {
    for (const p of ["/api/team/switch", "/api/team/leave", "/api/team/accept", "/api/auth/logout"]) expect(memberBlock("editor", "POST", p)).toBeNull();
  });
  test("editors draft but don't publish or delete; managers publish", () => {
    expect(memberBlock("editor", "POST", "/api/posts/abc/launch")).toMatch(/can't publish/i);
    expect(memberBlock("editor", "DELETE", "/api/posts/abc")).toMatch(/delete/i);
    expect(memberBlock("editor", "PATCH", "/api/posts/abc")).toBeNull();
    expect(memberBlock("editor", "GET", "/api/posts/abc/launch")).toBeNull();
    expect(memberBlock("manager", "POST", "/api/posts/abc/launch")).toBeNull();
  });
});

describe("referral codes", () => {
  test("8 readable characters, no look-alikes", () => {
    for (let i = 0; i < 50; i++) {
      const c = makeCode();
      expect(c).toHaveLength(8);
      expect(isCode(c)).toBe(true);
      expect(c).not.toMatch(/[01ilo]/);
    }
  });
  test("credit only a different, real owner, and only once", () => {
    expect(referrerFor("abcd2345", { id: "me" }, { id: "them" })).toBe("them");
    expect(referrerFor("abcd2345", { id: "me" }, { id: "me" })).toBeNull();
    expect(referrerFor("abcd2345", { id: "me", referredById: "x" }, { id: "them" })).toBeNull();
    expect(referrerFor("abcd2345", { id: "me" }, null)).toBeNull();
    expect(referrerFor("<script>", { id: "me" }, { id: "them" })).toBeNull();
  });
});

describe("LinkedIn little text", () => {
  test("reserved characters are escaped", () => expect(escapeLittleText("Hi @all #new (v2) *wow*")).toBe("Hi \\@all \\#new \\(v2\\) \\*wow\\*"));
});

describe("best time to post", () => {
  test("few posts: typical peaks, labelled as such", () => {
    const b = bestTimes({ samples: [], platforms: ["instagram"], tz: "Asia/Kolkata", now: new Date("2026-10-12T04:30:00Z") });
    expect(b.source).toBe("typical");
    expect(b.peakHours.length).toBeGreaterThan(0);
  });
  test("enough of your own posts: your strongest hour leads", () => {
    const samples = Array.from({ length: MIN_SAMPLES + 4 }, (_, i) => ({ platform: "instagram" as const, publishedAt: new Date(Date.UTC(2026, 8, 1 + i, i % 2 ? 14 : 3, 30)), views: i % 2 ? 5000 : 10 }));
    const b = bestTimes({ samples, platforms: ["instagram"], tz: "Asia/Kolkata", now: new Date("2026-10-12T04:30:00Z") });
    expect(b.source).toBe("yours");
    expect(b.peakHours[0]).toBe(20); // 14:30 UTC is 20:00 IST
  });
});
