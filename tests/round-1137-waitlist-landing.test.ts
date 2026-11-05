import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { middleware } from "../middleware";
import { joinHref } from "../components/marketing/useWaitlist";
import { WaitlistJoin } from "../components/marketing/WaitlistJoin";
import { WAITLIST_STEPS, waitlistPerks } from "../lib/marketing/waitlist-copy";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const realFetch = globalThis.fetch;
const realNow = Date.now;
const hadAppUrl = process.env.APP_URL;
let flags = { maintenance: false, waitlist: true, hide: [] as string[] };
let skew = 0;

// Middleware reads the switches from /api/maintenance and keeps them 5 s; each case moves the clock past that.
async function hit(path: string, waitlist: boolean) {
  flags = { ...flags, waitlist };
  skew += 60_000;
  Date.now = () => realNow() + skew;
  const res = await middleware(new NextRequest(new URL(path, "http://localhost:3100")));
  return { status: res.status, to: res.headers.get("location"), next: res.headers.get("x-middleware-next") === "1", wl: res.cookies.get("outlly_wl")?.value };
}

beforeAll(() => {
  if (!process.env.APP_URL) process.env.APP_URL = "http://localhost:3100";
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u instanceof Request ? u.url : u).includes("/api/maintenance")) return new Response(JSON.stringify(flags), { headers: { "content-type": "application/json" } });
    return realFetch(u as Request);
  }) as typeof fetch;
});
afterAll(async () => {
  await hit("/", false); // leave the cached switches off for any later file
  Date.now = realNow;
  globalThis.fetch = realFetch;
  if (hadAppUrl === undefined) delete process.env.APP_URL;
});

describe("1137 waitlist on: the landing page stays up", () => {
  test("signed-out visitors reach the full landing page, help and contact, and get the waitlist hint", async () => {
    for (const p of ["/", "/help", "/contact"]) {
      const r = await hit(p, true);
      expect(r.to).toBeNull();
      expect(r.next).toBe(true);
    }
    expect((await hit("/", true)).wl).toBe("1");
  });
  test("section aliases still land on the home page sections", async () => {
    const r = await hit("/pricing", true);
    expect(r.status).toBe(308);
    expect(r.to).toMatch(/\/#pricing$/);
  });
  test("sign-up and the studio stay closed to strangers", async () => {
    expect((await hit("/signup", true)).to).toMatch(/\/waitlist$/);
    expect((await hit("/signup?invite=abc", true)).next).toBe(true);
    expect((await hit("/home", true)).to).toMatch(/\/waitlist$/); // existing rule: strangers in waitlist mode go to the waitlist
    expect((await hit("/waitlist", true)).next).toBe(true);
  });
  test("waitlist off: the normal landing page and sign-up, no hint", async () => {
    const r = await hit("/", false);
    expect(r.next).toBe(true);
    expect(r.wl).toBeUndefined();
    expect((await hit("/signup", false)).next).toBe(true);
  });
});

describe("1137 join buttons scroll to the form on the landing page", () => {
  test("same-page jump where the form is, the landing page's form from anywhere else", () => {
    expect(joinHref("/")).toBe("#join");
    expect(joinHref("/waitlist")).toBe("#join");
    expect(joinHref("/help")).toBe("/#join");
    expect(joinHref(null)).toBe("/#join");
  });
  test("nav keeps its one CTA slot, relabelled Join Waitlist", () => {
    const nav = src("components/marketing/Nav.tsx");
    expect(nav).toContain('const ctaHref = waitlist ? joinHref(pathname) : "/signup";');
    expect(nav).toContain('const ctaLabel = waitlist ? "Join Waitlist" : "Start creating";');
  });
  test("no marketing CTA sends people off the landing page to /waitlist any more", () => {
    for (const f of ["components/marketing/Nav.tsx", "components/marketing/SignupCta.tsx", "components/marketing/bento/LimeCta.tsx", "components/marketing/HeroFan.tsx", "components/marketing/Footer.tsx"]) {
      expect(src(f)).not.toContain('"/waitlist" :');
      expect(src(f)).toContain("joinHref(");
    }
  });
  test("phones get a smooth scroll too (capture listener that stands the Link down)", () => {
    const f = src("components/waitlist/WaitlistForm.tsx");
    expect(f).toContain('window.addEventListener("click", onClick, true)');
    expect(f).toContain('to.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" })');
  });
});

describe("1137 the waitlist section on the landing page", () => {
  test("home page adds it before the footer only in waitlist mode, and not for members", () => {
    const p = src("app/(marketing)/page.tsx");
    expect(p).toContain('const joinOpen = site.waitlist && (await cookies()).get("outlly_in")?.value !== "1";');
    expect(p).toMatch(/<FinalCta beta=\{beta\} \/>\}\n\s+\{joinOpen && <WaitlistJoin beta=\{beta\} total=\{joined\} \/>\}/);
    // every product section is still there
    for (const s of ["<Hero ", "<HowItWorks", "<Features", "<Demo", "<Platforms", "<Pricing", "<Faq", "<FinalCta"]) expect(p).toContain(s);
  });
  test("renders the form, the why-join copy and the steps under #join", () => {
    const html = renderToStaticMarkup(createElement(WaitlistJoin, { beta: true, total: 40 }));
    expect(html).toContain('id="join"');
    expect(html).toContain("Why join the waitlist?");
    expect(html).toContain('name="email"');
    expect(html).toContain("Join the waitlist");
    expect(html).toContain("40 creators have joined so far.");
    for (const t of waitlistPerks(true)) expect(html).toContain(t);
    for (const [t] of WAITLIST_STEPS) expect(html).toContain(t);
    expect(renderToStaticMarkup(createElement(WaitlistJoin, { beta: false, total: 3 }))).not.toContain("creators have joined");
  });
  test("phones get the form right under the heading, and the scroll aims at it there", () => {
    const html = renderToStaticMarkup(createElement(WaitlistJoin, { beta: false, total: 0 }));
    expect(html.indexOf("wlj-head")).toBeLessThan(html.indexOf("data-join-form"));
    expect(html.indexOf("data-join-form")).toBeLessThan(html.indexOf("wlj-more"));
    expect(src("components/waitlist/WaitlistForm.tsx")).toContain('form.querySelector<HTMLElement>("[data-join-form]")');
  });
  test("arriving on /#section from another page keeps the section in place while the page settles", () => {
    const s = src("components/marketing/SmoothScroll.tsx");
    expect(s).toContain("if (location.hash) return holdAnchor(location.hash.slice(1));");
    expect(s).toContain("const timer = window.setTimeout(quit, 2500);");
    expect(s).toMatch(/LET_GO = \["wheel", "touchstart", "keydown", "pointerdown"\]/);
  });
  test("/waitlist and the landing section share one copy source", () => {
    const w = src("app/(marketing)/waitlist/page.tsx");
    expect(w).toContain("waitlistPerks(beta)");
    expect(w).toContain("WAITLIST_STEPS.map");
  });
});
