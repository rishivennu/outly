/** 1033: the Content Security Policy is enforced with a per-request nonce. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCsp, newNonce } from "../lib/csp";
import { POST as report } from "../app/api/csp-report/route";

const dir = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name + " ")) ?? "";

describe("CSP", () => {
  test("nonces are random, base64 and 128-bit", () => {
    const a = newNonce(), b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
  test("production: scripts need the nonce; no eval; the rest is locked down", () => {
    const csp = buildCsp("abc", false);
    const s = dir(csp, "script-src");
    expect(s).toContain("'nonce-abc'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("unsafe-eval");
    for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "upgrade-insecure-requests", "report-uri /api/csp-report"]) expect(csp).toContain(d);
    expect(dir(csp, "frame-src")).toContain("https://checkout.razorpay.com");
  });
  test("dev allows eval for React Refresh and skips the https upgrade", () => {
    const csp = buildCsp("abc", true);
    expect(dir(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
  test("the header is enforced, not report-only, and every inline layout script carries the nonce", () => {
    expect(readFileSync("next.config.mjs", "utf8")).not.toContain("Content-Security-Policy-Report-Only");
    expect(readFileSync("middleware.ts", "utf8")).toContain('res.headers.set("Content-Security-Policy", csp)');
    const layout = readFileSync("app/layout.tsx", "utf8");
    const scripts = layout.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s).toContain("nonce={nonce}");
  });
  test("middleware never answers a page without passing the nonce headers on", () => {
    const mw = readFileSync("middleware.ts", "utf8");
    expect(mw).not.toContain("NextResponse.next()");
    expect(mw).not.toMatch(/NextResponse\.rewrite\([^)]*\)\s*;/);
  });
});

describe("csp-report endpoint", () => {
  const post = (body: string, type = "application/csp-report") => report(new Request("http://x/api/csp-report", { method: "POST", body, headers: { "content-type": type } }) as never);
  const capture = async (fn: () => Promise<unknown>) => {
    const logs: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => void logs.push(m);
    try { await fn(); } finally { console.warn = orig; }
    return logs;
  };
  test("logs one short line per report, never the query string", async () => {
    const logs: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => void logs.push(m);
    try {
      const r = await post(JSON.stringify({ "csp-report": { "blocked-uri": "https://evil.example/x.js?token=secret", "violated-directive": "script-src-elem", "document-uri": "https://outlly.com/home?code=abc" } }));
      expect(r.status).toBe(204);
      await post(JSON.stringify([{ type: "csp-violation", body: { blockedURL: "inline", effectiveDirective: "script-src-attr", documentURL: "https://outlly.com/" } }]));
    } finally {
      console.warn = orig;
    }
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("evil.example/x.js");
    expect(logs.join(" ")).not.toContain("secret");
    expect(logs.join(" ")).not.toContain("code=abc");
  });
  test("junk and oversized bodies are ignored quietly", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post("x".repeat(20_000))).status).toBe(204);
  });
  test("a forged report can't write extra log lines or long junk", async () => {
    const logs = await capture(() => post(JSON.stringify({ "csp-report": { "violated-directive": "x\n[csp] blocked https://evil by script-src on /admin" + "A".repeat(500), "line-number": "9\r\nFAKE", "blocked-uri": "inline\u2028X" } })));
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toMatch(/[\r\n\u2028]/);
    expect(logs[0].length).toBeLessThan(400);
    expect(logs[0]).not.toContain("FAKE");
  });
  test("a body that isn't a CSP report type is ignored", async () => {
    const logs = await capture(() => post(JSON.stringify({ "csp-report": { "violated-directive": "script-src" } }), "text/plain"));
    expect(logs).toHaveLength(0);
  });
});

describe("review fixes", () => {
  test("form-action is locked to us and Razorpay fonts load", () => {
    const csp = buildCsp("abc", false);
    expect(csp).toContain("form-action 'self'");
    expect(dir(csp, "font-src")).toContain("https://checkout.razorpay.com");
  });
  test("Reporting-Endpoints uses an absolute URL", () => {
    expect(readFileSync("middleware.ts", "utf8")).toContain("csp=\"${req.nextUrl.origin}${CSP_REPORT_PATH}\"");
  });
  test("the script-free offline page has no inline handlers", () => {
    expect(readFileSync("public/offline.html", "utf8")).not.toMatch(/\son[a-z]+=/i);
  });
  test("JSON-LD scripts carry the nonce", () => {
    for (const f of ["app/(marketing)/page.tsx", "app/(marketing)/help/page.tsx"]) {
      for (const s of readFileSync(f, "utf8").match(/<script\b[^>]*>/g) ?? []) expect(s).toContain("nonce=");
    }
  });
});
