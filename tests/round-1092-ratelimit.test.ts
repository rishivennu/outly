/**
 * 11-02 (1092): per-user rate limits with a per-IP ceiling, so a team on one office network no longer
 * shares a single budget, while public routes and cookieless requests keep the old per-IP limit.
 */
import { beforeAll, describe, expect, test } from "bun:test";

let http: typeof import("../lib/http");
let rl: typeof import("../lib/rate-limit");
beforeAll(async () => {
  http = await import("../lib/http");
  rl = await import("../lib/rate-limit");
});

describe("1092 rate limit budgets", () => {
  test("public routes and requests without a session keep the plain per-IP limit", () => {
    expect(http.ipBudget(10, { auth: false }, true)).toEqual({ prefix: "", limit: 10 });
    expect(http.ipBudget(10, {}, false)).toEqual({ prefix: "", limit: 10 });
  });

  test("signed-in routes get a per-IP ceiling ten times the route's limit, under its own key", () => {
    expect(http.ipBudget(120, {}, true)).toEqual({ prefix: "ipc:", limit: 120 * http.IP_CEILING_X });
    expect(http.IP_CEILING_X).toBe(10);
  });

  test("twenty people behind one address each keep their own budget; the address still has a ceiling", async () => {
    const limit = 5, win = 60_000, ip = `10.1.${Date.now() % 250}.9`;
    const path = "/api/test-1092:GET";
    const ceiling = http.ipBudget(limit, {}, true);
    let ipRefused = 0, userRefused = 0;
    for (let u = 0; u < 20; u++)
      for (let i = 0; i < limit; i++) {
        if (!(await rl.limitShared(`${ceiling.prefix}${ip}:${path}`, ceiling.limit, win)).ok) { ipRefused++; continue; }
        if (!(await rl.limitShared(`u:user-${u}-${ip}:${path}`, limit, win)).ok) userRefused++;
      }
    // 100 requests, ceiling 50: the first 10 people fit fully, the rest hit the address ceiling.
    expect(ipRefused).toBe(100 - ceiling.limit);
    expect(userRefused).toBe(0);
    // One person past their own budget is refused even when the address has room.
    const solo = `10.2.${Date.now() % 250}.1`;
    for (let i = 0; i < limit; i++) expect((await rl.limitShared(`u:solo-${solo}:${path}`, limit, win)).ok).toBe(true);
    expect((await rl.limitShared(`u:solo-${solo}:${path}`, limit, win)).ok).toBe(false);
  });
});
