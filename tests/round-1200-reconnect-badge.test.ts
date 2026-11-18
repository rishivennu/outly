// R1200: the analytics "Needs reconnect" badges compared the account status with "active", a value SocialAccount
// never has (connected | needs_reconnect | disconnected), so every working account showed "Needs reconnect".
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const schema = src("prisma/schema.prisma");
const model = schema.slice(schema.indexOf("model SocialAccount {"), schema.indexOf("}", schema.indexOf("model SocialAccount {")));

describe("R1200 reconnect badge uses the real account status", () => {
  test("SocialAccount statuses are connected | needs_reconnect | disconnected, with no active", () => {
    expect(model).toContain('@default("connected") // connected | needs_reconnect | disconnected');
    expect(model).not.toContain("active");
  });
  test("the profile API passes the database status through unchanged", () => {
    expect(src("app/api/analytics/profile/route.ts")).toContain("status: p.status");
    expect(src("lib/profiles.ts")).toContain("status: a.status");
  });
  test("the dashboard header shows Needs reconnect only when the account is not connected", () => {
    const s = src("components/analytics/PlatformDashboardView.tsx");
    expect(s).toContain('{picked && picked.status !== "connected" ? (');
    expect(s).not.toContain('picked.status !== "active"');
  });
  test("the account switcher flags only accounts that are not connected", () => {
    const s = src("components/analytics/ProfileExtras.tsx");
    expect(s).toContain('{a.status !== "connected" && <span');
    expect(s).not.toContain('a.status !== "active"');
  });
});
