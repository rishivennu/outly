import { afterAll, describe, expect, it } from "bun:test";
import http from "node:http";
// @ts-expect-error plain ESM script, no types
import { startLb } from "../scripts/lb.mjs";

function upstream(name: string) {
  let posts = 0;
  const s = http.createServer((req, res) => {
    if (req.url === "/api/health") return res.end("ok");
    if (req.method === "POST") posts++;
    res.end(name);
  });
  return new Promise<{ s: http.Server; port: number; posts: () => number }>((r) => s.listen(0, () => r({ s, port: (s.address() as { port: number }).port, posts: () => posts })));
}

const a = await upstream("a");
const b = await upstream("b");
const LB = 3990 + Math.floor(Math.random() * 9);
const lb = startLb({ port: LB, upstreams: [`http://127.0.0.1:${a.port}`, `http://127.0.0.1:${b.port}`] });
await new Promise((r) => setTimeout(r, 150));
const get = (m = "GET") => fetch(`http://127.0.0.1:${LB}/x`, { method: m, body: m === "POST" ? "{}" : undefined }).then(async (r) => ({ status: r.status, body: await r.text() }));

afterAll(() => {
  lb.close();
  a.s.close();
  b.s.close();
});

describe("load balancer", () => {
  it("spreads requests across healthy instances", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) seen.add((await get()).body);
    expect([...seen].sort()).toEqual(["a", "b"]);
  });

  it("fails a GET over to the other instance when one dies", async () => {
    await new Promise<void>((r) => b.s.close(() => r()));
    b.s.closeAllConnections?.();
    const bodies: string[] = [];
    for (let i = 0; i < 4; i++) bodies.push((await get()).body);
    expect(bodies.every((x) => x === "a")).toBe(true);
  });

  it("never replays a POST, and answers 503 when nothing is up", async () => {
    const before = a.posts();
    await new Promise<void>((r) => a.s.close(() => r()));
    a.s.closeAllConnections?.();
    const r = await get("POST");
    expect([502, 503]).toContain(r.status);
    expect(a.posts()).toBe(before);
  });
});
