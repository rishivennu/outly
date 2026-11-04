import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cfg = readFileSync(join(import.meta.dir, "..", "next.config.mjs"), "utf8").replace(/\r\n/g, "\n");

describe("1116 router cache", () => {
  test("a visited dynamic page stays in the client router cache for 30 s", () => {
    expect(cfg).toMatch(/experimental:\s*\{[\s\S]*staleTimes:\s*\{\s*dynamic:\s*30\s*\}/);
  });
  test("static (prefetched) entries keep Next's 300 s default", () => {
    expect(cfg).not.toMatch(/staleTimes:\s*\{[^}]*static/);
  });
});
