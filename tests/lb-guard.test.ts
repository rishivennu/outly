import { afterAll, describe, expect, it } from "bun:test";
import http from "node:http";
// @ts-expect-error plain ESM script, no types
import { startLb } from "../scripts/lb.mjs";

// One upstream that is healthy but never answers /hang, and holds /slow for 120 ms.
const s = http.createServer((req, res) => {
  if (req.url === "/api/health") return res.end("ok");
  if (req.url === "/hang") return;
  if (req.url === "/slow") return setTimeout(() => res.end("slow"), 120);
  res.setHeader("connection", "keep-alive, x-secret");
  res.setHeader("x-secret", "hop");
  res.end(JSON.stringify({ proto: req.headers["x-forwarded-proto"], conn: req.headers["x-drop"] ?? null }));
});
await new Promise<void>((r) => s.listen(0, () => r()));
const up = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
const PORT = 4010 + Math.floor(Math.random() * 9);
const lb = startLb({ port: PORT, upstreams: [up], timeoutMs: 200, maxActive: 1 });
await new Promise((r) => setTimeout(r, 150));
const url = (p: string) => `http://127.0.0.1:${PORT}${p}`;

afterAll(() => {
  lb.close();
  s.closeAllConnections?.();
  s.close();
});

describe("load balancer guards", () => {
  it("answers 504 when an instance accepts but never responds", async () => {
    const r = await fetch(url("/hang"));
    expect(r.status).toBe(504);
  });

  it("sheds load with 503 + Retry-After when every instance is full", async () => {
    const first = fetch(url("/slow"));
    await new Promise((r) => setTimeout(r, 40));
    const second = await fetch(url("/x"));
    expect(second.status).toBe(503);
    expect(second.headers.get("retry-after")).toBe("2");
    expect((await first).status).toBe(200);
  });

  it("keeps the TLS proxy's X-Forwarded-Proto and strips hop-by-hop headers", async () => {
    const r = await fetch(url("/x"), { headers: { "x-forwarded-proto": "https", connection: "x-drop", "x-drop": "1" } });
    const j = await r.json();
    expect(j.proto).toBe("https");
    expect(j.conn).toBeNull();
    expect(r.headers.get("x-secret")).toBeNull();
  });
});
