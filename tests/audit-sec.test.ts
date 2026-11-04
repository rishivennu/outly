import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { memberBlock } from "../lib/team/roles";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const src = (f: string) => readFileSync(join(root, f), "utf8");

function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (e === "route.ts") out.push(rel);
  }
  return out;
}
const routes = walk("app/api");
const apiPath = (f: string) => "/" + f.replace(/^app\//, "").replace(/\/route\.ts$/, "");

describe("sec: publishing routes refuse editor seats", () => {
  const publishers = routes.filter((f) => /\b(launchPost|bookBatch)\(/.test(src(f)));

  test("the publishing routes are the three we know about", () => {
    expect(publishers.sort()).toEqual(["app/api/posts/[id]/launch/route.ts", "app/api/posts/[id]/route.ts", "app/api/posts/bulk/route.ts"]);
  });

  for (const f of publishers)
    test(`${apiPath(f)} blocks editors, in middleware rules or in the handler`, () => {
      const byRules = memberBlock("editor", "POST", apiPath(f).replace(/\[id\]/, "abc")) !== null;
      const byHandler = src(f).includes('user.role === "editor"');
      expect(byRules || byHandler).toBe(true);
    });

  test("bulk booking carries the guard in the handler (memberBlock has no /api/posts/bulk rule)", () => {
    // Regression for the escalation found in this audit: before the fix an editor seat could
    // schedule up to 10 posts to the owner's connected accounts through /api/posts/bulk.
    expect(memberBlock("editor", "POST", "/api/posts/bulk")).toBeNull();
    const s = src("app/api/posts/bulk/route.ts");
    expect(s).toContain('user.role === "editor"');
    expect(s).toMatch(/HttpError\(403, "Editors can't publish[^"]*", "ROLE"\)/);
  });

  test("managers and owners still get through", () => {
    expect(memberBlock("manager", "POST", "/api/posts/bulk")).toBeNull();
    expect(memberBlock("owner", "POST", "/api/posts/bulk")).toBeNull();
  });
});

describe("sec: admin surface is guarded server-side", () => {
  const adminRoutes = routes.filter((f) => f.startsWith("app/api/admin/"));
  test("there are admin routes to check", () => expect(adminRoutes.length).toBeGreaterThan(30));
  for (const f of adminRoutes)
    test(`${apiPath(f)} uses adminRoute or its own origin + rate limit`, () => {
      const s = src(f);
      if (/\badminRoute[(<]/.test(s)) return;
      expect(f).toMatch(/app\/api\/admin\/(login|logout)\/route\.ts/);
      expect(s).toContain("assertSameOrigin");
      // Signing in is brute-forceable, so it also carries a limit; signing out only needs the origin check.
      if (f.includes("/login/")) expect(s).toMatch(/rateLimit|limitShared/);
    });

  const pages: string[] = [];
  (function pw(dir: string) {
    for (const e of readdirSync(join(root, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(root, rel)).isDirectory()) pw(rel);
      else if (e === "page.tsx") pages.push(rel);
    }
  })("app/admin");
  for (const f of pages)
    test(`${f} calls an admin guard`, () => expect(src(f)).toMatch(/requireAdmin|getAdmin|adminGuard/));
});

describe("sec: cron routes need CRON_SECRET compared safely", () => {
  const crons = routes.filter((f) => f.startsWith("app/api/cron/"));
  test("cron routes exist", () => expect(crons.length).toBeGreaterThan(0));
  for (const f of crons)
    test(`${apiPath(f)} checks the secret`, () => {
      const s = src(f);
      expect(s).toMatch(/CRON_SECRET|cronOk|assertCron/);
      expect(s).toMatch(/safeEqual|timingSafeEqual/);
    });
});

describe("sec: every write handler is CSRF protected", () => {
  const writers = routes.filter((f) => /export const (POST|PUT|PATCH|DELETE)\b/.test(src(f)));
  test("most routes have writes", () => expect(writers.length).toBeGreaterThan(50));
  for (const f of writers)
    test(`${apiPath(f)} goes through route()/adminRoute or verifies a signature`, () => {
      const s = src(f);
      const wrapped = /\broute[(<]/.test(s) || /\badminRoute[(<]/.test(s);
      const explicit = s.includes("assertSameOrigin");
      const signed = /verifySignature|safeEqual|timingSafeEqual|createHmac|CRON_SECRET|unsubToken/.test(s);
      expect(wrapped || explicit || signed).toBe(true);
    });
});

describe("sec: user-owned rows are scoped to the session user", () => {
  let db: typeof import("../lib/db").db;
  let s: typeof import("../lib/services");
  let a: { id: string }, b: { id: string };
  let postA: { id: string }, mediaA: { id: string }, targetA: { id: string };

  beforeAll(async () => {
    ({ db } = await import("../lib/db"));
    s = await import("../lib/services");
    const n = Date.now();
    a = await db.user.create({ data: { name: "A", email: `sec-a-${n}@t.dev`, passwordHash: "x" } });
    b = await db.user.create({ data: { name: "B", email: `sec-b-${n}@t.dev`, passwordHash: "x" } });
    mediaA = await db.media.create({ data: { userId: a.id, originalFilename: "a.mp4", storageKey: `k-${n}`, mimeType: "video/mp4", size: 10 } });
    postA = await db.post.create({ data: { userId: a.id, title: "A post", mediaId: mediaA.id } });
    targetA = await db.postTarget.create({ data: { postId: postA.id, platform: "youtube" } });
  });

  test("ownedPost only answers for the owner", async () => {
    expect((await s.ownedPost(a.id, postA.id)).id).toBe(postA.id);
    expect(s.ownedPost(b.id, postA.id)).rejects.toThrow(/couldn't find/i);
  });
  test("ownedMedia only answers for the owner", async () => {
    expect((await s.ownedMedia(a.id, mediaA.id)).id).toBe(mediaA.id);
    expect(s.ownedMedia(b.id, mediaA.id)).rejects.toThrow(/couldn't find/i);
  });
  test("ownedTarget only answers for the owner", async () => {
    expect((await s.ownedTarget(a.id, targetA.id)).id).toBe(targetA.id);
    expect(s.ownedTarget(b.id, targetA.id)).rejects.toThrow(/couldn't find/i);
  });
});

describe("sec: session cookies and headers keep their flags", () => {
  test("the session cookie is httpOnly and lax", () => {
    const s = src("lib/auth.ts");
    expect(s).toContain("httpOnly: true");
    expect(s).toContain('sameSite: "lax"');
    expect(s).toMatch(/secure: /);
  });
  test("next.config keeps the baseline headers", () => {
    const s = src("next.config.mjs");
    for (const h of ["Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options", "Permissions-Policy"]) expect(s).toContain(h);
  });
  test("storage keys cannot traverse out of the bucket", async () => {
    const { storage } = await import("../lib/storage");
    expect(src("lib/storage/index.ts")).toMatch(/function safeKey[\s\S]*?Invalid storage key/);
    if (storage.name !== "local") return; // the traversal check lives in the local driver's path resolution
    for (const k of ["../secret", "a/../../b", "/abs", "c:/windows"]) expect(() => storage.localPath!(k)).toThrow(/Invalid storage key/);
    expect(storage.localPath!("media/ok.mp4")).toContain("ok.mp4");
  });
});

describe("sec: rate-limit keys cannot be chosen by the caller", () => {
  test("founding verify keys on the trusted hop, not the first X-Forwarded-For entry", () => {
    const s = src("app/api/founding/verify/route.ts");
    expect(s).toContain("clientIp(req)");
    expect(s).not.toContain('x-forwarded-for');
  });
  test("clientIp ignores the client-supplied first hop", async () => {
    const { clientIp } = await import("../lib/http");
    const req = (xff: string) => ({ headers: new Headers({ "x-forwarded-for": xff }) }) as never;
    expect(clientIp(req("1.1.1.1, 9.9.9.9"))).toBe("9.9.9.9");
    expect(clientIp(req("1.1.1.1"))).toBe("1.1.1.1");
  });
});

describe("sec: email sign-in codes use the shared limiter", () => {
  test("no synchronous rateLimit left in the email OTP service", () => {
    const s = src("lib/otp/service.ts");
    expect(s).toContain('import { limitShared } from "../rate-limit"');
    expect(s).not.toMatch(/\brateLimit\(/);
    expect(s.match(/await limitShared\(/g)?.length).toBe(3);
  });
  test("asking twice in a row is refused (the awaited limiter decides before the send)", async () => {
    const { issueCode } = await import("../lib/otp/service");
    const { db } = await import("../lib/db");
    const email = `sec-otp-${Date.now()}@t.dev`;
    await db.user.create({ data: { name: "Otp", email, passwordHash: "x" } });
    const channel = { send: async () => ({ ok: true as const }) };
    expect((await issueCode(email, "login", channel as never)).ok).toBe(true);
    expect(issueCode(email, "login", channel as never)).rejects.toThrow(/already on its way/i);
  });
});

describe("sec: JSON-LD cannot break out of its script tag", () => {
  for (const f of ["app/(marketing)/page.tsx", "app/(marketing)/help/page.tsx"])
    test(`${f} escapes < in the serialised JSON`, () => expect(src(f)).toMatch(/JSON\.stringify\([A-Za-z]+\)\.replace\(\/<\/g, "\\\\u003c"\)/));
  test("the escape really neutralises a closing tag", () => {
    const payload = JSON.stringify({ a: "</script><script>alert(1)</script>" }).replace(/</g, "\\u003c");
    expect(payload).not.toContain("</script");
    expect(JSON.parse(payload).a).toContain("</script>");
  });
});

describe("sec: a partial admin integration patch cannot blank a stored secret", () => {
  test("saving WhatsApp without the token keeps the token that is already stored", async () => {
    const { getConfig, saveConfig } = await import("../lib/settings");
    await saveConfig("whatsapp", { phoneNumberId: "123", token: "secret-token-1", template: "code_v1", lang: "en" });
    expect((await getConfig("whatsapp")).token).toBe("secret-token-1");
    await saveConfig("whatsapp", { template: "code_v2" }); // the admin only renamed the template
    const after = await getConfig("whatsapp");
    expect(after.token).toBe("secret-token-1");
    expect(after.phoneNumberId).toBe("123");
    expect(after.template).toBe("code_v2");
  });
  test("an explicit null clears it, and an empty string is treated as 'unchanged'", async () => {
    const { getConfig, saveConfig } = await import("../lib/settings");
    await saveConfig("whatsapp", { token: "secret-token-2" });
    await saveConfig("whatsapp", { token: "" });
    expect((await getConfig("whatsapp")).token).toBe("secret-token-2");
    await saveConfig("whatsapp", { token: null });
    expect((await getConfig("whatsapp")).token).toBe("");
  });
});

describe("sec: editors never speak for the brand or re-publish", () => {
  test("retry is a launch under another name, so editors are refused", () => {
    expect(memberBlock("editor", "POST", "/api/targets/abc/retry")).toMatch(/can't publish/i);
    expect(memberBlock("manager", "POST", "/api/targets/abc/retry")).toBeNull();
  });
  test("Inbox comment replies are refused, like direct messages", () => {
    expect(memberBlock("editor", "POST", "/api/inbox/reply")).toMatch(/can't reply/i);
    expect(memberBlock("manager", "POST", "/api/inbox/reply")).toBeNull();
  });
  test("reading the Inbox is still fine", () => {
    expect(memberBlock("editor", "GET", "/api/inbox")).toBeNull();
    expect(memberBlock("editor", "GET", "/api/inbox/reply")).toBeNull();
  });
  test("bookBatch is called with the actor, so its own role check runs for every caller", async () => {
    const { bookBatch } = await import("../lib/posts/bulk-server");
    expect(src("app/api/posts/bulk/route.ts")).toContain("bookBatch(user.id, bulkScheduleSchema.parse(await req.json()), user)");
    expect(bookBatch("someone", { items: [], platforms: [] } as never, { role: "editor" })).rejects.toThrow(/can't publish/i);
  });
});

describe("sec: demo credentials cannot ship in a production build", () => {
  test("the prefill is guarded by NODE_ENV, not only by the public flag", () => {
    const s = src("components/auth/AuthForm.tsx");
    expect(s).toMatch(/process\.env\.NODE_ENV !== "production" && process\.env\.NEXT_PUBLIC_DEMO_LOGIN === "true"/);
    expect(s).not.toMatch(/=\s*mode === "login" && process\.env\.NEXT_PUBLIC_DEMO_LOGIN/);
  });
  test("the sign-in subtitle is guarded the same way", () => {
    const s = src("app/(auth)/login/page.tsx");
    expect(s).toMatch(/process\.env\.NODE_ENV !== "production" && process\.env\.NEXT_PUBLIC_DEMO_LOGIN === "true"/);
  });
  test("no other file prefills the demo account", () => {
    const hits: string[] = [];
    for (const dir of ["app", "components"]) {
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop()!;
        for (const e of readdirSync(join(root, d))) {
          const rel = `${d}/${e}`;
          if (statSync(join(root, rel)).isDirectory()) stack.push(rel);
          else if (/\.tsx?$/.test(e) && src(rel).includes("NEXT_PUBLIC_DEMO_LOGIN")) hits.push(rel);
        }
      }
    }
    expect(hits.sort()).toEqual(["app/(auth)/login/page.tsx", "components/auth/AuthForm.tsx"]);
  });
});
