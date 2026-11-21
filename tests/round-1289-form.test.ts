// R1289 FORM: the short four-step partner application (schema, draft helpers, copy and submit guards).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { ApplicationSchema, ProposalSchema, StatsSchema, SocialsSchema, issueMap } from "@/lib/partners/schema";
import { summarise } from "@/lib/partners/core";
import { PARTNER_NICHES, PARTNER_NICHE_LABEL } from "@/lib/partners/types";
import { CATEGORIES, DRAFT_KEY, REVIEW, STEPS, detectPlatform, emptyDraft, payload, primaryIndex, stepErrors, toggleChip, trackHref, withUrl, type Draft } from "@/components/partners/form/draft";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const form = read("components/partners/ApplyForm.tsx");
const page = read("app/(marketing)/partners/page.tsx");
const route = read("app/api/partners/apply/route.ts");
const review = read("components/partners/form/Review.tsx");
const row = read("components/partners/form/PlatformRow.tsx");

const short = {
  personal: { fullName: "Ria Sharma", email: "ria@example.com", country: "India" },
  socials: [
    { platform: "instagram", url: "https://www.instagram.com/ria.creates/", followers: 4_000 },
    { platform: "youtube", url: "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw", followers: 9_000, primary: true },
  ],
  stats: { avgViews: 1_500, engagementRate: null, niche: "food" },
  proposal: { preference: "subscription", extra: "I post recipes twice a week.", form: "short" },
  consent: { terms: true, accuracy: true },
};
const long = {
  personal: { fullName: "Dev Rao", email: "dev@example.com", country: "India", city: "Pune", phone: "", brandName: "" },
  socials: [{ platform: "instagram", handle: "devrao", url: "", followers: 6_200, niche: "tech", format: "reels" }],
  stats: { avgViews: 3000, avgLikes: 200, avgComments: 20, avgShares: 10, reach: 4000, engagementRate: null, audienceCountries: "", ageRange: "25-34", frequency: "weekly", niche: "tech" },
  proposal: { why: "My viewers are small creators who post everywhere by hand and need one place to do it.", how: "A screen recording Reel.", contentType: "Reel", posts: 3, preference: "either", compensation: "", pastCollabs: "", portfolio: [] },
  consent: { terms: true, accuracy: true },
};

const filled = (): Draft => {
  const d = emptyDraft();
  d.personal = { fullName: "Ria Sharma", email: "ria@example.com", country: "India" };
  d.socials = [
    { platform: "instagram", url: "instagram.com/ria.creates", followers: "1,200", locked: false },
    { platform: "tiktok", url: "https://www.tiktok.com/@ria.creates", followers: "12,500", locked: false },
  ];
  d.stats = { avgViews: "3,400", engagementRate: "4.2", niche: "travel" };
  d.proposal = { preference: "paid", extra: "" };
  d.consent = true;
  return d;
};

describe("schema: short and long forms", () => {
  test("accepts the short payload and stores form short with extra", () => {
    const r = ApplicationSchema.safeParse(short);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.proposal.form).toBe("short");
    expect(r.data.proposal.extra).toBe("I post recipes twice a week.");
    expect(r.data.personal.city).toBe("");
    expect(r.data.stats.avgLikes).toBeUndefined();
  });
  test("still accepts a long payload, defaulting form to long", () => {
    const r = ApplicationSchema.safeParse(long);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proposal.form).toBe("long");
  });
  test("rejects a missing avgViews on both forms", () => {
    const s = ApplicationSchema.safeParse({ ...short, stats: { niche: "food" } });
    expect(s.success).toBe(false);
    if (!s.success) expect(issueMap(s.error)["stats.avgViews"]).toBeTruthy();
    expect(StatsSchema.safeParse({}).success).toBe(false);
  });
  test("long form keeps its required answers, short form does not ask for them", () => {
    expect(ApplicationSchema.safeParse({ ...long, proposal: { ...long.proposal, why: "Too short" } }).success).toBe(false);
    expect(ApplicationSchema.safeParse({ ...long, stats: { avgViews: 3000, niche: "tech" } }).success).toBe(false);
    expect(ProposalSchema.safeParse({ preference: "paid" }).success).toBe(true);
  });
  test("short form needs a content category", () => {
    const r = ApplicationSchema.safeParse({ ...short, stats: { avgViews: 100 } });
    expect(r.success).toBe(false);
    if (!r.success) expect(issueMap(r.error)["stats.niche"]).toBe("Choose your main content category");
  });
  test("extra is capped at 300 characters", () => {
    expect(ApplicationSchema.safeParse({ ...short, proposal: { ...short.proposal, extra: "a".repeat(301) } }).success).toBe(false);
  });
  test("a link with no valid username keeps a blank handle; a link to the wrong host fails", () => {
    const a = ApplicationSchema.parse(short);
    expect(a.socials[0].handle).toBe("ria.creates");
    expect(a.socials[1].url).toBe("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw");
    expect(a.socials[1].primary).toBe(true);
    expect(SocialsSchema.safeParse([{ platform: "other", url: "https://ria.substack.com/", followers: 10 }]).success).toBe(true);
    expect(SocialsSchema.safeParse([{ platform: "instagram", url: "https://evil.example.com/ria", followers: 10 }]).success).toBe(false);
    const blank = SocialsSchema.safeParse([{ platform: "x", url: "", followers: 10 }]);
    expect(blank.success).toBe(false);
    if (!blank.success) expect(issueMap(blank.error, "socials")["socials.0.url"]).toBe("Paste the link to your profile or channel");
  });
  test("summarise works on a short application", () => {
    const s = summarise(ApplicationSchema.parse(short));
    expect([s.primaryPlatform, s.followers, s.niche, s.preference]).toEqual(["youtube", 9_000, "food", "subscription"]);
  });
});

describe("niches", () => {
  test("Food and Travel added without dropping an existing niche", () => {
    for (const n of ["tech", "ai_tools", "productivity", "business", "marketing", "creator_economy", "finance", "education", "lifestyle", "entertainment", "gaming", "other"]) expect(PARTNER_NICHES).toContain(n as never);
    expect(PARTNER_NICHE_LABEL.food).toBe("Food");
    expect(PARTNER_NICHE_LABEL.travel).toBe("Travel");
  });
  test("categories follow the spec and map onto stored niches", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(["Lifestyle", "Technology", "Education", "Business", "Entertainment", "Gaming", "Food", "Travel", "Other"]);
    expect(CATEGORIES.find((c) => c.label === "Technology")?.value).toBe("tech");
    for (const c of CATEGORIES) expect(PARTNER_NICHES).toContain(c.value);
  });
});

describe("draft helpers", () => {
  test("step labels and the v2 draft key", () => {
    expect([...STEPS]).toEqual(["Your details", "Your platforms", "Your reach", "Your reward preference"]);
    expect(REVIEW).toBe(4);
    expect(DRAFT_KEY).toBe("outlly:partner-apply:v2");
  });
  test("detectPlatform reads the host", () => {
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube");
    expect(detectPlatform("tiktok.com/@ria")).toBe("tiktok");
    expect(detectPlatform("https://twitter.com/ria")).toBe("x");
    expect(detectPlatform("https://www.linkedin.com/in/ria")).toBe("linkedin");
    expect(detectPlatform("ria.creates")).toBeNull();
    expect(detectPlatform("https://instagram.com.evil.io/ria")).toBeNull();
  });
  test("a manual platform choice is kept when the link changes", () => {
    const r = withUrl({ platform: "instagram", url: "", followers: "", locked: false }, "https://x.com/ria");
    expect(r.platform).toBe("x");
    expect(withUrl({ ...r, locked: true }, "https://www.tiktok.com/@ria").platform).toBe("x");
  });
  test("chips toggle rows on and off", () => {
    const on = toggleChip([], "youtube");
    expect(on.map((r) => r.platform)).toEqual(["youtube"]);
    expect(toggleChip(on, "youtube")).toEqual([]);
  });
  test("largest account becomes primary", () => {
    expect(primaryIndex(filled().socials)).toBe(1);
  });
  test("payload marks the short form and passes every step", () => {
    const d = filled();
    for (let i = 0; i <= REVIEW; i++) expect(stepErrors(i, d)).toEqual({});
    const p = payload(d, "", "");
    expect(p.proposal.form).toBe("short");
    expect(p.consent).toEqual({ terms: true, accuracy: true });
    const r = ApplicationSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.socials.map((s) => s.primary)).toEqual([false, true]);
  });
  test("step errors: country from the list, a platform, views, category, preference, consent", () => {
    const d = filled();
    d.personal.country = "Atlantis";
    expect(stepErrors(0, d)["personal.country"]).toBe("Choose your country from the list");
    expect(stepErrors(1, { ...d, socials: [] }).socials).toBe("Add at least one platform");
    expect(stepErrors(2, { ...d, stats: { avgViews: "", engagementRate: "", niche: "" } })["stats.avgViews"]).toBeTruthy();
    expect(stepErrors(2, { ...d, stats: { avgViews: "10", engagementRate: "", niche: "" } })["stats.niche"]).toBe("Choose your main content category");
    expect(stepErrors(3, { ...d, proposal: { preference: "", extra: "" } })["proposal.preference"]).toBeTruthy();
    expect(stepErrors(REVIEW, { ...d, consent: false }).consent).toBeTruthy();
  });
  test("Track My Application goes to the dashboard, or through sign in", () => {
    expect(trackHref("OP-ABC234", true)).toBe("/dashboard/partnerships?new=OP-ABC234");
    expect(trackHref("OP-ABC234", false)).toBe("/login?next=%2Fdashboard%2Fpartnerships%3Fnew%3DOP-ABC234");
  });
});

describe("form source pins", () => {
  test("uses the ported Stepper, StepPanels and MorphingButton", () => {
    expect(form).toContain('import { Stepper, StepPanels } from "@/components/ui/easy/Stepper";');
    expect(form).toContain('import { MorphingButton } from "@/components/ui/easy/MorphingButton";');
    expect(form).toContain("<StepPanels current={step}");
    expect(existsSync("components/partners/form/SocialRow.tsx")).toBe(false);
  });
  test("top label and step microcopy", () => {
    for (const s of [
      "Your partnership application",
      "Let's get to know you.",
      "Show us where your audience follows you.",
      "Where do you share your content?",
      "Give us a quick idea of your reach.",
      "Self-reported numbers. We may ask for a screenshot later.",
      "Choose how you'd like to collaborate.",
      "How would you like to partner with Outlly?",
      "Anything else you'd like us to know?",
      "Add another platform",
      "Submit My Application",
      "Free to apply. Our team will review your profile before making an offer.",
    ])
      expect(form).toContain(s);
    expect(read("components/partners/form/draft.ts")).toContain('{ value: "paid", title: "Paid Collaboration", body: "Earn money by introducing Outlly to your audience." }');
    expect(read("components/partners/form/draft.ts")).toContain('{ value: "either", title: "Open to Both", body: "Let\'s find the best partnership for both of us." }');
  });
  test("success screen copy and the track link", () => {
    expect(form).toContain("You're officially in!");
    expect(form).toContain("Your creator partnership application has been submitted. We'll review your profile and notify you when there's an update.");
    expect(form).toContain("Track My Application");
    expect(form).toContain("<Link href={trackHref(done.ref, !!me)}>");
    expect(form).toContain("Sign in with {done.email} to track it.");
    expect(form).toContain("Application ID");
  });
  test("double submit guard: a ref plus the disabled, loading button", () => {
    expect(form).toContain("if (submitting.current) return;");
    expect(form).toContain("submitting.current = true;");
    expect(form).toContain("submitting.current = false;");
    expect(form).toContain('status={sending ? "loading" : "idle"}');
  });
  test("verified accounts see a compact identity row with Change", () => {
    expect(form).toContain("Applying as ");
    expect(form).toContain("setEditIdentity(true)");
    expect(form).toContain("!!me?.verified");
  });
  test("duplicate links to the dashboard only when signed in, honeypot kept", () => {
    expect(form).toContain('href="/dashboard/partnerships"');
    expect(form).toContain('id="pa-website"');
    expect(form).toContain('aria-live="polite"');
  });
  test("route passes the signed-in user, page passes me and the new headline", () => {
    expect(route).toContain("createApplication(input, { ip, userId: me ? realUserId(me) : undefined })");
    expect(page).toContain("<ApplyForm me={me} />");
    expect(page).toContain("Share a little about your content and audience. If we're a good fit, you could earn through paid collaborations or get access to Outlly Creator for free.");
    for (const b of ["Paid creator collaborations", "Complimentary Creator subscription", "Opportunities to grow with Outlly"]) expect(page).toContain(b);
  });
  test("no em-dashes and no guarantees in the form files", () => {
    for (const s of [form, review, row, page]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toMatch(/guarantee/i);
    }
  });
});
