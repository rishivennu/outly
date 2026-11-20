// R1282 Creator Partnership Program (form): the shared zod schema, the pure helpers and the form's draft logic.
import { describe, expect, test } from "bun:test";
import { ApplicationSchema, ConsentSchema, PersonalSchema, SocialsSchema, StatsSchema, issueMap } from "@/lib/partners/schema";
import { REF_RE, cleanFileName, emailKeyOf, makeFileToken, makeRef, normaliseHandle, normaliseProfileUrl, sniffMime, summarise, FILE_TOKEN_RE } from "@/lib/partners/core";
import { emptyDraft, payload, restoreDraft, sourceFrom, stepErrors, toNumber, withHandle } from "@/components/partners/form/draft";

const stats = { avgViews: 800, avgLikes: 60, avgComments: 8, avgShares: 4, reach: 900, engagementRate: 6.5, audienceCountries: "India 70%", ageRange: "18-24", frequency: "weekly", niche: "tech" };
const proposal = { why: "I make short tutorials on creator tools and my audience keeps asking what I use.", how: "A Reel walking through scheduling one clip to three platforms.", contentType: "Tutorial Reel", posts: 2, preference: "either", compensation: "", pastCollabs: "", portfolio: [] };
const personal = { fullName: "Ria Sharma", email: "Ria.Sharma@gmail.com", country: "India", city: "Pune", phone: "+91 98765 43210", brandName: "" };
const consent = { terms: true, accuracy: true };
const ig = (followers: number, handle = "ria.creates") => ({ platform: "instagram", handle, url: "", followers, niche: "tech", format: "reels" });

const creators = {
  small: { personal, socials: [ig(1_000)], stats, proposal, consent },
  mid: { personal, socials: [ig(5_000), { platform: "youtube", handle: "@RiaCreates", url: "", followers: 1_200, niche: "tech", format: "shorts" }], stats, proposal: { ...proposal, preference: "subscription" }, consent },
  large: {
    personal,
    socials: [
      ig(14_000),
      { platform: "youtube", handle: "", url: "https://www.youtube.com/@riacreates?si=abc", followers: 22_000, niche: "education", format: "long_video", primary: true },
      { platform: "x", handle: "ria_creates", url: "https://twitter.com/ria_creates", followers: 3_000, niche: "tech", format: "posts" },
    ],
    stats: { ...stats, avgViews: 25_000 },
    proposal: { ...proposal, preference: "paid", portfolio: ["https://riacreates.in/work"] },
    consent,
    files: [{ token: "A".repeat(24), name: "insights.png" }],
  },
};

describe("ApplicationSchema", () => {
  test("accepts the three sample creators", () => {
    for (const c of Object.values(creators)) expect(ApplicationSchema.safeParse(c).success).toBe(true);
  });
  test("normalises handles and builds profile links", () => {
    const a = ApplicationSchema.parse(creators.mid);
    expect(a.socials[0].url).toBe("https://www.instagram.com/ria.creates/");
    expect(a.socials[1].handle).toBe("RiaCreates");
    expect(a.socials[1].url).toBe("https://www.youtube.com/@RiaCreates");
    expect(a.personal.email).toBe("ria.sharma@gmail.com");
  });
  test("explicit primary row wins, otherwise the first", () => {
    const a = ApplicationSchema.parse(creators.large);
    expect(a.socials.map((s) => s.primary)).toEqual([false, true, false]);
    expect(a.socials[1].handle).toBe("riacreates");
    expect(ApplicationSchema.parse(creators.small).socials[0].primary).toBe(true);
  });
  test("strips HTML from free text", () => {
    const a = ApplicationSchema.parse({ ...creators.small, personal: { ...personal, fullName: "<b>Ria</b> Sharma" } });
    expect(a.personal.fullName).toBe("Ria Sharma");
  });
  test("rejects a link to the wrong host", () => {
    const r = SocialsSchema.safeParse([{ ...ig(10), url: "https://evil.example.com/ria" }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(issueMap(r.error, "socials")["socials.0.url"]).toBeTruthy();
  });
  test("rejects bad handles per platform", () => {
    expect(SocialsSchema.safeParse([{ ...ig(10), handle: "ria creates!" }]).success).toBe(false);
    expect(SocialsSchema.safeParse([{ platform: "x", handle: "this_handle_is_too_long", url: "", followers: 1, niche: "tech", format: "posts" }]).success).toBe(false);
  });
  test("rejects negative numbers", () => {
    expect(SocialsSchema.safeParse([ig(-5)]).success).toBe(false);
    expect(StatsSchema.safeParse({ ...stats, avgViews: -1 }).success).toBe(false);
    expect(StatsSchema.safeParse({ ...stats, engagementRate: 140 }).success).toBe(false);
  });
  test("rejects missing consent", () => {
    expect(ConsentSchema.safeParse({ terms: true, accuracy: false }).success).toBe(false);
    expect(ApplicationSchema.safeParse({ ...creators.small, consent: { terms: false, accuracy: true } }).success).toBe(false);
  });
  test("rejects more than 6 files and more than 6 accounts", () => {
    const files = Array.from({ length: 7 }, (_, i) => ({ token: String(i).repeat(24), name: "a.png" }));
    expect(ApplicationSchema.safeParse({ ...creators.small, files }).success).toBe(false);
    expect(SocialsSchema.safeParse(Array.from({ length: 7 }, (_, i) => ig(10, `ria${i}`))).success).toBe(false);
  });
  test("rejects duplicate accounts and an empty list", () => {
    expect(SocialsSchema.safeParse([ig(10), ig(20)]).success).toBe(false);
    expect(SocialsSchema.safeParse([]).success).toBe(false);
  });
  test("phone is optional but checked when given", () => {
    expect(PersonalSchema.safeParse({ ...personal, phone: "" }).success).toBe(true);
    expect(PersonalSchema.safeParse({ ...personal, phone: "call me" }).success).toBe(false);
    expect(PersonalSchema.safeParse({ ...personal, phone: "+1 (415) 555-0100" }).success).toBe(true);
  });
  test("proposal why needs 40 characters and posts 1 to 50", () => {
    expect(ApplicationSchema.safeParse({ ...creators.small, proposal: { ...proposal, why: "Too short" } }).success).toBe(false);
    expect(ApplicationSchema.safeParse({ ...creators.small, proposal: { ...proposal, posts: 51 } }).success).toBe(false);
    expect(ApplicationSchema.safeParse({ ...creators.small, proposal: { ...proposal, portfolio: ["http://x.com/a"] } }).success).toBe(false);
  });
});

describe("core helpers", () => {
  test("makeRef shape and alphabet", () => {
    for (let i = 0; i < 200; i++) expect(makeRef()).toMatch(REF_RE);
    expect(REF_RE.test("OP-0O1IL2")).toBe(false);
    expect(makeFileToken()).toMatch(FILE_TOKEN_RE);
  });
  test("emailKeyOf folds gmail dots, +tags and googlemail", () => {
    expect(emailKeyOf("Ria.Sharma+partners@Gmail.com")).toBe("riasharma@gmail.com");
    expect(emailKeyOf("ria.sharma@googlemail.com")).toBe("riasharma@gmail.com");
    expect(emailKeyOf("ria.sharma+x@outlook.com")).toBe("ria.sharma@outlook.com");
  });
  test("normaliseProfileUrl per platform", () => {
    expect(normaliseProfileUrl("instagram", "@ria.creates")).toBe("https://www.instagram.com/ria.creates/");
    expect(normaliseProfileUrl("instagram", "instagram.com/ria.creates?igsh=1")).toBe("https://instagram.com/ria.creates");
    expect(normaliseProfileUrl("youtube", "https://youtu.be/abc?t=3")).toBe("https://youtu.be/abc?t=3");
    expect(normaliseProfileUrl("tiktok", "ria.creates")).toBe("https://www.tiktok.com/@ria.creates");
    expect(normaliseProfileUrl("x", "http://twitter.com/ria_creates")).toBe("https://twitter.com/ria_creates");
    expect(normaliseProfileUrl("linkedin", "ria-sharma")).toBe("https://www.linkedin.com/in/ria-sharma");
    expect(normaliseProfileUrl("facebook", "https://m.facebook.com/riacreates")).toBe("https://m.facebook.com/riacreates");
    expect(normaliseProfileUrl("threads", "@ria.creates")).toBe("https://www.threads.net/@ria.creates");
    expect(normaliseProfileUrl("other", "https://ria.substack.com/")).toBe("https://ria.substack.com/");
    expect(normaliseProfileUrl("other", "ria")).toBeNull();
    expect(normaliseProfileUrl("instagram", "https://instagram.com.evil.io/ria")).toBeNull();
    expect(normaliseProfileUrl("x", "https://x.com/")).toBeNull();
    expect(normaliseProfileUrl("instagram", "javascript:alert(1)")).toBeNull();
  });
  test("normaliseHandle pulls the handle out of a link", () => {
    expect(normaliseHandle("instagram", "https://www.instagram.com/ria.creates/")).toBe("ria.creates");
    expect(normaliseHandle("linkedin", "https://linkedin.com/in/ria-sharma")).toBe("ria-sharma");
    expect(normaliseHandle("youtube", "youtube.com/@RiaCreates")).toBe("RiaCreates");
    expect(normaliseHandle("x", "@@ria")).toBe("ria");
  });
  test("summarise picks the primary row, the largest account and tierFor", () => {
    const a = ApplicationSchema.parse(creators.large);
    const s = summarise(a);
    expect(s.primaryPlatform).toBe("youtube");
    expect(s.followers).toBe(22_000);
    expect(s.tier).toBe("established");
    expect(s.avgViews).toBe(25_000);
    expect(s.preference).toBe("paid");
    expect(summarise(ApplicationSchema.parse(creators.small)).tier).toBe("emerging");
    expect(summarise(ApplicationSchema.parse(creators.mid)).tier).toBe("growing");
  });
  test("sniffMime reads magic bytes", () => {
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("<svg>"))).toBeNull();
  });
  test("cleanFileName keeps safe characters only", () => {
    expect(cleanFileName("../../etc/<pass>wd.png")).toBe("....etcpasswd.png");
    expect(cleanFileName("ñ".repeat(5))).toBe("file");
    expect(cleanFileName("a".repeat(200)).length).toBe(80);
  });
});

describe("form draft", () => {
  test("numbers accept commas, blank is undefined", () => {
    expect(toNumber("12,500")).toBe(12500);
    expect(toNumber("")).toBeUndefined();
    expect(Number.isNaN(toNumber("abc"))).toBe(true);
  });
  test("handle edits fill the link until the creator types one", () => {
    const r = withHandle({ platform: "instagram", handle: "", url: "", urlEdited: false, followers: "", niche: "", format: "" }, "@ria.creates");
    expect(r.url).toBe("https://www.instagram.com/ria.creates/");
    expect(withHandle({ ...r, url: "https://instagram.com/other", urlEdited: true }, "ria2").url).toBe("https://instagram.com/other");
  });
  test("empty step 1 reports field-keyed errors", () => {
    const e = stepErrors(0, emptyDraft());
    expect(e["personal.fullName"]).toBeTruthy();
    expect(e["personal.email"]).toBeTruthy();
    expect(e["personal.city"]).toBeUndefined();
  });
  test("a filled draft builds a payload the server schema accepts", () => {
    const d = emptyDraft();
    d.personal = { ...personal };
    d.socials = [{ platform: "instagram", handle: "ria.creates", url: "", urlEdited: false, followers: "1,000", niche: "tech", format: "reels" }];
    d.stats = { avgViews: "800", avgLikes: "60", avgComments: "8", avgShares: "4", reach: "900", engagementRate: "", audienceCountries: "", ageRange: "18-24", frequency: "weekly", niche: "tech" };
    d.proposal = { ...proposal, posts: "2", portfolio: [""] };
    d.consent = { terms: true, accuracy: true };
    for (let i = 0; i < 5; i++) expect(stepErrors(i, d)).toEqual({});
    const r = ApplicationSchema.safeParse(payload(d, "ref:ria", ""));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stats.engagementRate).toBeNull();
  });
  test("restoreDraft survives junk and clamps the step", () => {
    expect(restoreDraft("{not json")).toBeNull();
    const r = restoreDraft(JSON.stringify({ draft: { personal: { fullName: "Ria" } }, step: 9 }));
    expect(r?.step).toBe(4);
    expect(r?.draft.personal.fullName).toBe("Ria");
    expect(r?.draft.socials.length).toBe(1);
  });
  test("sourceFrom reads ref and utm", () => {
    expect(sourceFrom("?ref=ria2026&utm_source=youtube&utm_medium=bio")).toBe("ref:ria2026 utm:youtube/bio");
    expect(sourceFrom("")).toBe("");
  });
});
