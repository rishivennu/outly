/**
 * 10-18 security round: the SSRF guard on admin-settable URLs (FunASR worker, YOUPI gateway).
 * The server must never be talked into calling itself, the private network or the cloud metadata service.
 */
import { describe, expect, test } from "bun:test";
import { blockedHostReason } from "../lib/net/public-host";
import { assertPublicUrl, resolver } from "../lib/net/assert-public";
import { youpiBase } from "../lib/billing/youpi";

describe("blockedHostReason", () => {
  test("refuses loopback, private, link-local, CGNAT and multicast IPv4", () => {
    for (const h of ["127.0.0.1", "127.8.9.10", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.169.254", "100.64.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(blockedHostReason(h)).not.toBeNull();
    }
  });
  test("refuses IPv6 loopback, ULA, link-local and v4-mapped private", () => {
    for (const h of ["::1", "[::1]", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1"]) {
      expect(blockedHostReason(h)).not.toBeNull();
    }
  });
  test("refuses internal names and single-label hosts", () => {
    for (const h of ["localhost", "api.localhost", "printer.local", "metadata.google.internal", "funasr", "db.corp", "LOCALHOST."]) {
      expect(blockedHostReason(h)).not.toBeNull();
    }
  });
  test("review fixes: repeated trailing dots, IPv4-translated (::ffff:0:) and Teredo (2001:0:) are refused", () => {
    for (const h of ["localhost..", "127.0.0.1..", "metadata.google.internal...", "::ffff:0:a9fe:a9fe", "::ffff:0:7f00:1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1"]) {
      expect(blockedHostReason(h)).not.toBeNull();
    }
  });
  test("allows public hosts and addresses", () => {
    for (const h of ["8.8.8.8", "172.32.0.1", "192.169.0.1", "pay.example.com", "asr.outlly.app", "2606:4700::1111", "2001:4860:4860::8888"]) {
      expect(blockedHostReason(h)).toBeNull();
    }
  });
});

describe("assertPublicUrl", () => {
  test("catches the tricky spellings the URL parser normalises to loopback or metadata", async () => {
    for (const u of ["http://169.254.169.254/latest/meta-data/", "http://2130706433/", "http://0x7f.1/", "http://[::1]:8080/", "http://127.1/", "http://[::169.254.169.254]/", "http://[64:ff9b::169.254.169.254]/", "https://localhost:3040/x"]) {
      await expect(assertPublicUrl(u)).rejects.toThrow(/Refused/);
    }
  });
  test("refuses non-http schemes and junk", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("gopher://8.8.8.8/")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("not a url")).rejects.toThrow(/valid/);
  });
  test("a public-looking name that resolves to a private address is refused (DNS check)", async () => {
    const real = resolver.lookup;
    resolver.lookup = async (h) => (h === "asr.evil.example" ? [{ address: "93.184.216.34" }, { address: "169.254.169.254" }] : h === "asr.good.example" ? [{ address: "93.184.216.34" }] : []);
    try {
      await expect(assertPublicUrl("https://asr.evil.example/")).rejects.toThrow(/resolves to/);
      await expect(assertPublicUrl("https://asr.good.example/")).resolves.toBeUndefined();
      await expect(assertPublicUrl("https://nowhere.example/")).rejects.toThrow(/resolve/);
    } finally {
      resolver.lookup = real;
    }
  });
  test("lets a public literal address through", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/asr")).resolves.toBeUndefined();
  });
});

describe("YOUPI gateway URL in live mode", () => {
  test("a private or metadata host is unusable live, a local test gateway still works in test mode", () => {
    expect(youpiBase("https://10.0.0.5", "live")).toBe("");
    expect(youpiBase("https://169.254.169.254", "live")).toBe("");
    expect(youpiBase("https://localhost:9000", "live")).toBe("");
    expect(youpiBase("https://pay.example.com/", "live")).toBe("https://pay.example.com");
    expect(youpiBase("http://localhost:9000", "test")).toBe("http://localhost:9000");
  });
});

describe("shared rate limiter (Upstash)", () => {
  test("sends an HMAC of the key, never the raw IP or email", async () => {
    const { env } = await import("../lib/env");
    const { limitShared } = await import("../lib/rate-limit");
    const saved = { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, fetch: globalThis.fetch };
    const bodies: string[] = [];
    env.UPSTASH_REDIS_REST_URL = "https://upstash.test.dev";
    env.UPSTASH_REDIS_REST_TOKEN = "t";
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await limitShared("login:203.0.113.77:someone@example.com", 5, 60_000);
      expect(r.ok).toBe(true);
      expect(bodies.length).toBe(1);
      expect(bodies[0]).not.toContain("203.0.113.77");
      expect(bodies[0]).not.toContain("someone@example.com");
      expect(bodies[0]).toMatch(/"rl:[A-Za-z0-9_-]{32}:\d+"/);
    } finally {
      env.UPSTASH_REDIS_REST_URL = saved.url;
      env.UPSTASH_REDIS_REST_TOKEN = saved.token;
      globalThis.fetch = saved.fetch;
    }
  });
});
