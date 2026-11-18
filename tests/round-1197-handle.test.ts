import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bareHandle, fmtHandle } from "@/lib/handle";
import { at } from "@/lib/pip/tools-core";

/*
 * Round 1197 (user, 11-18): one username formatter, one display format, no "@@" anywhere. Instagram, Threads, TikTok
 * and X accounts are stored with their "@", the rest without; screens used to add another one on top.
 */
describe("fmtHandle", () => {
  test("the acceptance inputs all show exactly one leading @", () => {
    expect(fmtHandle("justzrishi")).toBe("@justzrishi");
    expect(fmtHandle("@justzrishi")).toBe("@justzrishi");
    expect(fmtHandle("@@justzrishi")).toBe("@justzrishi");
    expect(fmtHandle("rishi_vennu")).toBe("@rishi_vennu");
    expect(fmtHandle("@rishi_vennu")).toBe("@rishi_vennu");
    expect(fmtHandle("  @@@rishi.vennu ")).toBe("@rishi.vennu");
  });
  test("nothing in, nothing out; emails, URLs and names with spaces are left alone", () => {
    for (const v of [null, undefined, "", "   ", "@", "@@"]) expect(fmtHandle(v)).toBe("");
    expect(fmtHandle("rishi@outlly.com")).toBe("rishi@outlly.com");
    expect(fmtHandle("https://x.com/justzrishi")).toBe("https://x.com/justzrishi");
    expect(fmtHandle("Rishi Vennu")).toBe("Rishi Vennu");
    expect(fmtHandle("@Rishi Vennu")).toBe("Rishi Vennu");
  });
  test("bareHandle drops every leading @", () => {
    expect(bareHandle("@@justzrishi")).toBe("justzrishi");
    expect(bareHandle(null)).toBe("");
  });
  test("Pip's at() is the same formatter", () => {
    expect(at("@@justzrishi")).toBe("@justzrishi");
    expect(at("justzrishi")).toBe("@justzrishi");
  });
});

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });

describe("no screen adds its own @", () => {
  const files = ["app", "components", "lib"].flatMap(walk).filter((f) => !/(^|[\\/])lib[\\/](social[\\/]|handle\.ts)/.test(f));
  test("no `@${x.username}` or @{x.username} outside the formatter (providers' own storage aside)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (/`@\$\{[\w.?!()]*\.?(username|handle)\b|>\s*@\{[\w.?!]*(username|handle)|@\{[\w.?!]*\.(username|handle)/.test(s)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
  test("the screens the user named go through fmtHandle", () => {
    for (const f of [
      "components/admin/liveassist/LiveAssistConsole.tsx",
      "components/settings/AccountsView.tsx",
      "components/create/PlatformDeck.tsx",
      "components/create/publish.ts",
      "components/create/PublishingView.tsx",
      "lib/notify-events.ts",
      "lib/inbox.ts",
    ])
      expect(readFileSync(f, "utf8")).toContain("fmtHandle(");
  });
});
