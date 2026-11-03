/** 1106: an installed Android app picks up a new home-screen icon on its next manifest check. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import manifest from "@/app/manifest";
import { iconUrl } from "@/lib/brand/icon-url";

const files = ["icon-192.png", "icon-512.png", "icon-512-maskable.png"];
const hash = (f: string) => createHash("sha256").update(readFileSync(`public/brand/app/${f}`)).digest("hex").slice(0, 10);

describe("1106 icon updates", () => {
  test("every manifest icon URL carries a fingerprint of the file that ships", () => {
    const srcs = manifest().icons!.map((i) => i.src);
    for (const f of files) expect(srcs).toContain(`/brand/app/${f}?v=${hash(f)}`);
  });
  test("a different picture gets a different URL", () => {
    expect(new Set(files.map((f) => iconUrl(`/brand/app/${f}`).split("?v=")[1])).size).toBe(files.length);
  });
  test("a missing file falls back to the plain path instead of breaking the manifest", () => {
    expect(iconUrl("/brand/app/nope.png")).toBe("/brand/app/nope.png");
  });
  test("the manifest keeps its id, so it stays the same installed app", () => {
    expect(manifest().id).toBe("/home");
  });
  test("home-screen icons are always revalidated, after the long brand cache rule", async () => {
    const cfg = (await import("../next.config.mjs")).default;
    const rules = await cfg.headers();
    const brand = rules.findIndex((r: { source: string }) => r.source === "/(brand|samples)/:path*");
    const app = rules.findIndex((r: { source: string }) => r.source === "/brand/app/:path*");
    expect(app).toBeGreaterThan(brand);
    expect(rules[app].headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=0, must-revalidate" });
  });
});
