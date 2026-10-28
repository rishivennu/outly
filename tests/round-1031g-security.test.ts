import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appAuthTarget, sameSitePath } from "../lib/safe-next";

const leaves = (p: string) => new URL(p, "https://outly.example").origin !== "https://outly.example";

describe("1031g sameSitePath: after-sign-in redirects stay on the site", () => {
  const evil = ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\u0000/x", "/\u007f",
    "https://evil.com", "javascript:alert(1)", "JavaScript:alert(1)", " /home", "", "home", "\\\\evil.com", "/".padEnd(2001, "a")];
  for (const v of evil) test(`blocks ${JSON.stringify(v).slice(0, 40)}`, () => expect(sameSitePath(v)).toBeNull());

  test("the control-character bypass really did leave the site before", () => {
    // The old AuthForm check let these through; the browser strips the tab/newline and goes to evil.com.
    for (const v of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) {
      expect(/^\/(?![/\\])/.test(v)).toBe(true);
      expect(leaves(v)).toBe(true);
    }
  });

  for (const v of ["/home", "/create?post=abc&connected=instagram", "/inbox#t1", "/a\\b", "/%09/evil.com"])
    test(`keeps ${v}`, () => {
      expect(sameSitePath(v)).toBe(v);
      expect(leaves(v)).toBe(false);
    });

  test("non-strings are rejected", () => {
    for (const v of [null, undefined, 1, {}, ["/home"]]) expect(sameSitePath(v)).toBeNull();
  });
});

describe("1031g appAuthTarget: /app-auth only opens sign-in or connect", () => {
  test("allows the two hand-off targets the server builds", () => {
    expect(appAuthTarget("/api/auth/google?from=login&next=%2Fhome")).toBe("/api/auth/google?from=login&next=%2Fhome");
    expect(appAuthTarget("/api/accounts/instagram/connect?returnTo=%2Faccounts")).toBe("/api/accounts/instagram/connect?returnTo=%2Faccounts");
  });
  for (const v of ["javascript:fetch('/api/me')", "https://evil.com/api/auth/google", "//evil.com/api/auth/google", "/\t/evil.com/api/auth/google",
    "/home", "/api/auth/google/../../admin", "/api/accounts/../admin/connect", "/api/accounts/Instagram/connect", "/api/me", null])
    test(`refuses ${JSON.stringify(v)}`, () => expect(appAuthTarget(v)).toBeNull());
});

describe("1031g wiring: every client redirect uses the shared check", () => {
  const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  test("AuthForm reads next through sameSitePath", () => {
    const s = src("components/auth/AuthForm.tsx");
    expect(s).toContain('sameSitePath(params.get("next"))');
    expect(s).not.toContain('params.get("next");');
  });
  test("AppAuthBridge never hands a raw ?to= to location.replace", () => {
    const s = src("components/app/AppAuthBridge.tsx");
    expect(s).toContain('appAuthTarget(params.get("to"))');
    expect(s).not.toMatch(/const to = params\.get\("to"\)/);
  });
  test("GoogleButton, NativeBridge and safeReturnTo share it", () => {
    expect(src("components/auth/GoogleButton.tsx")).toContain("sameSitePath(next)");
    expect(src("components/shell/NativeBridge.tsx")).toContain("const safeHref = sameSitePath");
    expect(src("lib/oauth-state.ts")).toContain('sameSitePath(v) ?? "/accounts"');
  });
});

describe("1031g sweepDirectUploads: a reserved small upload can't park a huge file", () => {
  const g = globalThis as unknown as { __queueBackend?: unknown };
  let saved: unknown;
  let db: typeof import("../lib/db").db;
  let h: typeof import("../lib/queue/handlers");
  let storage: typeof import("../lib/storage").storage;
  let n = 0;
  beforeAll(async () => {
    saved = g.__queueBackend;
    g.__queueBackend = { add: async () => {} };
    ({ db } = await import("../lib/db"));
    h = await import("../lib/queue/handlers");
    ({ storage } = await import("../lib/storage"));
  }, 60_000);
  afterAll(() => {
    g.__queueBackend = saved;
  });

  async function upload(reserved: number, actual: number | null, ageMs: number) {
    const u = await db.user.create({ data: { name: `S ${++n}`, email: `s31g-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
    const key = `videos/${u.id}/direct-${n}.mp4`;
    if (actual !== null) await storage.put(key, Buffer.alloc(actual, 1), "video/mp4");
    const m = await db.media.create({
      data: { userId: u.id, storageKey: key, originalFilename: "a.mp4", mimeType: "video/mp4", size: reserved, status: "uploading", createdAt: new Date(Date.now() - ageMs) },
    });
    return m;
  }
  const status = async (id: string) => (await db.media.findUniqueOrThrow({ where: { id } })).status;

  test("an object bigger than its reservation is removed and the row fails", async () => {
    const m = await upload(10, 5000, 20 * 60_000);
    await h.sweepDirectUploads();
    expect(await status(m.id)).toBe("failed");
    expect(await storage.stat(m.storageKey)).toBeNull();
  });
  test("a right-sized upload that is still waiting for complete is left alone", async () => {
    const m = await upload(64, 64, 20 * 60_000);
    await h.sweepDirectUploads();
    expect(await status(m.id)).toBe("uploading");
    expect(await storage.stat(m.storageKey)).toEqual({ size: 64 });
    await storage.remove(m.storageKey);
  });
  test("a fresh upload is never touched, even if oversized (bytes may still be moving)", async () => {
    const m = await upload(10, 500, 60_000);
    await h.sweepDirectUploads();
    expect(await status(m.id)).toBe("uploading");
    await storage.remove(m.storageKey);
  });
  test("an upload abandoned for a day is cleaned up", async () => {
    const m = await upload(64, 64, h.STALE_DIRECT_UPLOAD_MS + 60_000);
    await h.sweepDirectUploads();
    expect(await status(m.id)).toBe("failed");
    expect(await storage.stat(m.storageKey)).toBeNull();
  });
  test("ready media is never swept", async () => {
    const m = await upload(10, 5000, h.STALE_DIRECT_UPLOAD_MS + 60_000);
    await db.media.update({ where: { id: m.id }, data: { status: "ready" } });
    await h.sweepDirectUploads();
    expect(await status(m.id)).toBe("ready");
    expect(await storage.stat(m.storageKey)).toEqual({ size: 5000 });
    await storage.remove(m.storageKey);
  });
  test("the row is claimed before the bytes are removed, so a racing /complete keeps its file", () => {
    const s = readFileSync(new URL("../lib/queue/handlers.ts", import.meta.url), "utf8");
    const body = s.slice(s.indexOf("export async function sweepDirectUploads"));
    expect(body.indexOf("updateMany")).toBeGreaterThan(-1);
    expect(body.indexOf("updateMany")).toBeLessThan(body.indexOf("storage.remove"));
    expect(body).toContain("if (r.count !== 1) continue;");
  });
  test("a stale window of a day, so a slow resumed upload isn't cut off", () => expect(h.STALE_DIRECT_UPLOAD_MS).toBe(24 * 3600_000));
  test("the minute sweeper calls it", () => {
    const s = readFileSync(new URL("../app/api/cron/sweep/route.ts", import.meta.url), "utf8");
    expect(s).toContain("await sweepDirectUploads()");
  });
});
