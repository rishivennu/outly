import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  accountUrl, aggregate, cardLinks, cleanLink, cleanText, formatAbbr, handleProblem, imgKey, isProfileImg, litTicks,
  normalizeHandle, parseProfileLinks, progressOf, publicLinks, statsNote, viewsLabel, type TotalsRow,
} from "@/lib/profile-card-core";
import { clampOffset, coverScale, cropRect, CROP_OUT } from "@/lib/profile-crop";
import { formatOf, stepperOf, NUMBER_TIMING } from "@/lib/motion/numbers";
import { resolveAvatar } from "@/lib/avatar";
import { PC, PC_MS } from "@/components/profile/motion";
import { EASE } from "@/lib/motion/tokens";

// Round 1120: the creator profile card. Real numbers only, honest links, and the brief's motion.
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const name = (p: string) => p[0].toUpperCase() + p.slice(1);

describe("handle, bio, niche", () => {
  test("handles are normalised and checked", () => {
    expect(normalizeHandle("  @Rishi.Makes ")).toBe("rishi.makes");
    expect(handleProblem("ab")).toMatch(/At least 3/);
    expect(handleProblem("a".repeat(31))).toMatch(/At most 30/);
    expect(handleProblem("_rishi")).not.toBeNull();
    expect(handleProblem("rishi.")).not.toBeNull();
    expect(handleProblem("ri..shi")).not.toBeNull();
    expect(handleProblem("ri shi")).not.toBeNull();
    expect(handleProblem("rishi_makes.2")).toBeNull();
  });
  test("text is cleaned and capped, bio keeps at most three lines", () => {
    expect(cleanText("  Travel   &\tfood ", 40)).toBe("Travel & food");
    expect(cleanText("a\n\n\n\nb", 160, true)).toBe("a\n\nb"); // one blank line kept, runs folded
    expect(cleanText("one\ntwo\nthree\nfour", 160, true).split("\n").length).toBeLessThanOrEqual(3);
    expect([...cleanText("é".repeat(200), 160, true)].length).toBe(160);
  });
});

describe("links", () => {
  test("only https profile addresses on the platform's own site are accepted", () => {
    expect(cleanLink("instagram", "instagram.com/rishi")).toBe("https://instagram.com/rishi");
    expect(cleanLink("instagram", "http://www.instagram.com/rishi/")).toBe("https://www.instagram.com/rishi/");
    expect(cleanLink("x", "https://twitter.com/rishi")).toBe("https://twitter.com/rishi");
    expect(cleanLink("instagram", "https://instagram.com/")).toBeNull(); // the home page is not a profile
    expect(cleanLink("instagram", "https://evil.com/instagram.com/rishi")).toBeNull();
    expect(cleanLink("instagram", "https://instagram.com.evil.com/rishi")).toBeNull();
    expect(cleanLink("instagram", "javascript:alert(1)")).toBeNull();
    expect(cleanLink("youtube", "https://user:pw@youtube.com/@rishi")).toBeNull();
    expect(cleanLink("youtube", "https://youtube.com:8443/@rishi")).toBeNull();
  });
  test("a connected account's address is built only from a username that makes one", () => {
    expect(accountUrl("instagram", "rishi.makes", "1789")).toBe("https://www.instagram.com/rishi.makes/");
    expect(accountUrl("x", "@rishi_v", "1")).toBe("https://x.com/rishi_v");
    expect(accountUrl("youtube", "@rishimakes", "UCxxxxxxxxxxxxxxxxxxxxxx")).toBe("https://www.youtube.com/@rishimakes");
    expect(accountUrl("youtube", "Rishi Makes", "UC1234567890123456789012")).toBe("https://www.youtube.com/channel/UC1234567890123456789012");
    expect(accountUrl("youtube", "Rishi Makes", "not-a-channel")).toBeNull();
    expect(accountUrl("linkedin", "Rishi V", "abc")).toBeNull();
    expect(accountUrl("instagram", "has space", "1")).toBeNull();
  });
  test("the card shows public links with an address, the creator chooses which", () => {
    const accounts = [
      { id: "a1", platform: "instagram", username: "rishi", platformUserId: "1" },
      { id: "a2", platform: "linkedin", username: "Rishi V", platformUserId: "x" },
      { id: "a3", platform: "x", username: "rishi", platformUserId: "2" },
    ];
    const prefs = parseProfileLinks(JSON.stringify({ hidden: ["a3"], links: [{ platform: "tiktok", url: "tiktok.com/@rishi" }, { platform: "instagram", url: "https://www.instagram.com/rishi/" }, { platform: "threads", url: "https://evil.com/x" }] }));
    const all = cardLinks(accounts, prefs);
    expect(all.map((l) => l.key)).toEqual(["a1", "a2", "a3", "link:tiktok"]); // duplicate Instagram dropped, bad link never stored
    const shown = publicLinks(all);
    expect(shown.map((l) => l.key)).toEqual(["a1", "link:tiktok"]); // LinkedIn has no address, X is hidden
    expect(shown.every((l) => l.url!.startsWith("https://"))).toBe(true);
  });
  test("parsing never throws and drops junk", () => {
    expect(parseProfileLinks("{not json")).toEqual({ hidden: [], links: [] });
    expect(parseProfileLinks(JSON.stringify({ hidden: [1, "ok"], links: [{ platform: "myspace", url: "x" }] }))).toEqual({ hidden: ["ok"], links: [] });
  });
});

describe("stats come only from what platforms report", () => {
  const rows: TotalsRow[] = [
    { platform: "instagram", ok: true, totals: { followers: 72_900, posts: 300, views: 120_000, viewsScope: "28_days" }, outllyPosts: 12 },
    { platform: "youtube", ok: true, totals: { followers: null, posts: 528, views: 342_900, viewsScope: "all_time" }, outllyPosts: 4 },
    { platform: "facebook", ok: true, totals: { followers: 1_000, posts: null, views: null, viewsScope: "28_days" }, outllyPosts: 6 },
    { platform: "x", ok: false, totals: null, outllyPosts: 9 },
  ];
  test("sums the reported numbers and names the platforms left out", () => {
    const s = aggregate(rows);
    expect(s.followers).toEqual({ value: 73_900, from: ["instagram", "facebook"], missing: ["youtube", "x"], partial: [] });
    expect(s.posts.value).toBe(300 + 528 + 6); // Facebook reports no post total: its posts sent from Outlly
    expect(s.postsFromOutlly).toEqual(["facebook"]);
    expect(s.posts.missing).toEqual(["x"]); // a platform that didn't answer is missing, never zero
    expect(s.views.value).toBe(462_900);
    const note = statsNote(s, name)!;
    expect(note).toContain("Instagram last 28 days");
    expect(note).toContain("Facebook posts are the ones sent from Outlly");
    expect(note).toContain("Not included: X.");
    expect(note).toContain("Youtube counts toward posts and views only.");
  });
  test("a platform counted for posts only is never also listed as not included", () => {
    const s = aggregate([
      { platform: "tiktok", ok: true, totals: null, outllyPosts: 1 },
      { platform: "instagram", ok: false, totals: null, outllyPosts: 0 },
    ]);
    const note = statsNote(s, name)!;
    expect(note).toContain("Tiktok counts toward posts only, the ones sent from Outlly.");
    expect(note.match(/Tiktok/g)).toHaveLength(1);
    expect(note).toContain("Not included: Instagram.");
    expect(note).not.toMatch(/Not included:[^.]*Tiktok/);
  });
  test("nothing reported means Unavailable (null), not zero", () => {
    const s = aggregate([{ platform: "x", ok: false, totals: null, outllyPosts: 0 }]);
    expect(s.followers.value).toBeNull();
    expect(s.posts.value).toBeNull();
    expect(s.views.value).toBeNull();
    expect(aggregate([]).followers.value).toBeNull();
  });
  test("numbers are abbreviated like the reference: 828, 72.9K, 1.2M", () => {
    expect(formatAbbr(828)).toBe("828");
    expect(formatAbbr(72_900)).toBe("72.9K");
    expect(formatAbbr(342_900)).toBe("342.9K");
    expect(formatAbbr(1_200_000)).toBe("1.2M");
    expect(formatOf("abbr")(72_900)).toBe("72.9K");
    // Counting up holds the final unit, so the suffix never flickers.
    expect(stepperOf("abbr", 1_200_000)(600_000)).toBe("0.6M");
  });
});

describe("progress is made of facts", () => {
  const none = { photo: false, cover: false, bio: false, handle: false, niche: false, connected: 0, publicLinks: 0, published30: 0 };
  test("each step is a checkable fact, and only earned ticks light", () => {
    const p0 = progressOf(none);
    expect(p0.done).toBe(0);
    expect(litTicks(p0, 30)).toBe(0);
    const p = progressOf({ ...none, photo: true, bio: true, connected: 2, published30: 3 });
    expect(p.steps.filter((s) => s.done).map((s) => s.id)).toEqual(["photo", "bio", "connect", "more", "active"]);
    expect(litTicks(p, 30)).toBe(15);
    expect(progressOf({ photo: true, cover: true, bio: true, handle: true, niche: true, connected: 3, publicLinks: 2, published30: 9 })).toMatchObject({ done: 10, level: "All set" });
  });
  test("the card never calls it a score or invents experience", () => {
    const card = read("components/profile/CreatorProfileCard.tsx");
    expect(card).not.toMatch(/\bscore\b|\blevel \d/i);
    expect(card).not.toMatch(/\bexp\.|\bXP\b/);
  });
});

describe("pictures", () => {
  test("uploaded picture names map to private keys and nothing else", () => {
    expect(imgKey("avatar-cm1abcdefghij-0123456789abcdef")).toBe("profile/cm1abcdefghij/avatar-0123456789abcdef.jpg");
    expect(imgKey("avatar-../../etc-0123456789abcdef")).toBeNull();
    expect(imgKey("logo-cm1abcdefghij-0123456789abcdef")).toBeNull();
    expect(isProfileImg("/api/u/img/banner-cm1abcdefghij-0123456789abcdef", "banner")).toBe(true);
    expect(isProfileImg("/api/u/img/banner-cm1abcdefghij-0123456789abcdef", "avatar")).toBe(false);
    expect(isProfileImg("https://evil.com/api/u/img/avatar-cm1abcdefghij-0123456789abcdef")).toBe(false);
  });
  test("an uploaded avatar shows as a photo; typed URLs still can't be set from the client", () => {
    expect(resolveAvatar("/api/u/img/avatar-cm1abcdefghij-0123456789abcdef", "a@b.c")).toEqual({ photo: "/api/u/img/avatar-cm1abcdefghij-0123456789abcdef" });
    expect("orb" in resolveAvatar("/api/u/img/banner-cm1abcdefghij-0123456789abcdef", "a@b.c")).toBe(true);
    const api = read("app/api/settings/profile/route.ts");
    expect(api).toContain('avatar: z.string().refine(isOrbValue');
  });
  test("the crop always covers the frame and maps back to image pixels", () => {
    const s = coverScale(2000, 1000, 300, 300);
    expect(s).toBeCloseTo(0.3);
    expect(clampOffset(50, 50, 600, 300, 300, 300)).toEqual({ x: 0, y: 0 });
    expect(clampOffset(-900, -10, 600, 300, 300, 300)).toEqual({ x: -300, y: 0 });
    const r = cropRect(-150, 0, s, 300, 300);
    expect(r.sx).toBeCloseTo(500);
    expect(r.sw).toBeCloseTo(1000);
    expect(r.sh).toBeCloseTo(1000);
    expect(CROP_OUT.banner.w / CROP_OUT.banner.h).toBe(3);
  });
  test("the upload route checks the bytes and the shape, and only the owner can change it", () => {
    const up = read("app/api/settings/profile/image/route.ts");
    expect(up).toContain("jpegSize(buf)");
    expect(up).toContain("size.w === size.h");
    expect(up).toMatch(/user\.actor\) throw new HttpError\(403/);
    const img = read("app/api/u/img/[name]/route.ts");
    expect(img).toContain("imgKey(params.name)");
    expect(img).toContain("nosniff");
  });
});

describe("motion from the brief", () => {
  test("card 450, banner 600, avatar 500, stats 1000, hover 200, actions 180, one curve", () => {
    expect(PC_MS).toEqual({ card: 450, banner: 600, avatar: 500, stats: 1000, hover: 200, action: 180 });
    expect(PC.card.transition.duration).toBe(0.45);
    expect(PC.banner.transition.duration).toBe(0.6);
    expect(PC.avatar.transition.duration).toBe(0.5);
    expect(PC.action.transition.duration).toBe(0.18);
    for (const k of ["card", "banner", "avatar", "action"] as const) expect(PC[k].transition.ease).toEqual([...EASE.out]);
    expect(PC.avatar.initial).toMatchObject({ opacity: 0 });
    expect(PC.avatar.initial.scale).toBeLessThan(1);
    expect(NUMBER_TIMING.profile.ms).toBe(1000);
  });
  test("hover is 200ms in CSS, transforms and opacity only, reduced motion respected", () => {
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("/* ---------- 1120: creator profile card"), css.indexOf("/* ---------- 1100: Liquid glass on every studio card"));
    expect(block.length).toBeGreaterThan(500);
    expect(block).toContain("box-shadow 200ms var(--m-ease-out)");
    expect(block).toContain("prefers-reduced-motion: reduce");
    expect(block).not.toMatch(/transition:[^;]*(width|height|top|left|margin)/);
    const card = read("components/profile/CreatorProfileCard.tsx");
    expect(card).toContain('tier="profile"');
    expect(card).toContain("useReducedMotion");
  });
  test("the card lives at the top of Settings > Profile with every action from the brief", () => {
    const sv = read("components/settings/SettingsView.tsx");
    expect(sv.indexOf("<CreatorProfileCard />")).toBeLessThan(sv.indexOf("<ProfileForm />"));
    const card = read("components/profile/CreatorProfileCard.tsx");
    for (const a of ["Edit Profile", "Change Cover", "Change Picture", "Edit Bio", "Manage Social Links", "View Connected Platforms"]) expect(card).toContain(a);
    expect(card).toContain("Unavailable");
    expect(card).toContain("max-w-[560px]");
  });
});

describe("review fixes", () => {
  test("one account of two failing is named, not hidden", () => {
    const s = aggregate([
      { platform: "instagram", ok: true, totals: { followers: 100, posts: 5, views: 50, viewsScope: "all_time" }, outllyPosts: 0 },
      { platform: "instagram", ok: false, totals: null, outllyPosts: 0 },
    ]);
    expect(s.followers.value).toBe(100);
    expect(s.followers.partial).toEqual(["instagram"]);
    expect(statsNote(s, name)).toContain("Some Instagram accounts didn't answer");
  });
  test("views are Total Views only when every number is all-time", () => {
    expect(viewsLabel([{ scope: "all_time" }])).toBe("Total Views");
    expect(viewsLabel([{ scope: "all_time" }, { scope: "28_days" }])).toBe("Views");
    expect(viewsLabel([])).toBe("Views");
  });
  test("reserved words can't be handles", () => {
    expect(handleProblem("admin")).toMatch(/reserved/);
    expect(handleProblem("Settings")).toMatch(/reserved/);
    expect(handleProblem("maya.makes")).toBeNull();
  });
  test("X never sums missing metrics into a zero; uploads are refused before buffering", () => {
    const x = readFileSync("lib/live/x.ts", "utf8");
    expect(x).toContain("posts.some((p) => p[k] !== null)");
    const up = readFileSync("app/api/settings/profile/image/route.ts", "utf8").replace(/\r\n/g, "\n");
    expect(up.indexOf('req.headers.get("content-length")')).toBeGreaterThan(-1);
    expect(up.indexOf('req.headers.get("content-length")')).toBeLessThan(up.indexOf("await req.arrayBuffer()"));
    expect(up).toContain("startsWith(`${kind}-${uid.toLowerCase()}-`)");
  });
});
