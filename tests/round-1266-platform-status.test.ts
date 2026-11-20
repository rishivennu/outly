/**
 * R1266: the Social platforms page speaks the admin status vocabulary (1167), and the admin route sweep (1168).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_STATUS, platformHint, platformStatus, savedToast, saveLabel } from "../lib/admin/platform-status";
import { STATUS_LABEL } from "../components/admin/ui";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const s = (o: Partial<{ core: boolean; ready: boolean; idSet: boolean; secretSet: boolean }>) =>
  platformStatus({ core: false, ready: false, idSet: false, secretSet: false, ...o });

describe("1167 platform status state machine", () => {
  test("ready is live, core or not, whatever the saved keys (env keys count)", () => {
    expect(s({ ready: true })).toBe("live");
    expect(s({ ready: true, core: true })).toBe("live");
    expect(s({ ready: true, idSet: true, secretSet: true })).toBe("live");
  });
  test("a core platform without both keys is never live, even with no keys at all", () => {
    expect(s({ core: true })).toBe("keys-missing");
    expect(s({ core: true, idSet: true })).toBe("keys-missing");
    expect(s({ core: true, secretSet: true })).toBe("keys-missing");
  });
  test("a non-core platform with one key is keys missing, with none it is hidden", () => {
    expect(s({ idSet: true })).toBe("keys-missing");
    expect(s({ secretSet: true })).toBe("keys-missing");
    expect(s({})).toBe("hidden");
  });
  test("hints, button and toast follow the state", () => {
    expect(platformHint("live", false)).toContain("Creators can connect it");
    expect(platformHint("keys-missing", true)).toContain("Shown in the studio");
    expect(platformHint("keys-missing", false)).toContain("Hidden from creators");
    expect(platformHint("hidden", false)).toContain("don't see it");
    expect(saveLabel("keys-missing", "live")).toBe("Save and go live");
    expect(saveLabel("hidden", "live")).toBe("Save and go live");
    expect(saveLabel("live", "live")).toBe("Save");
    expect(saveLabel("hidden", "keys-missing")).toBe("Save");
    expect(savedToast("TikTok", "live", false)).toBe("TikTok is live. Creators can connect it now.");
    expect(savedToast("X", "keys-missing", true)).toContain("stays in the studio");
    expect(savedToast("TikTok", "hidden", false)).toContain("stays hidden");
    for (const st of Object.keys(PLATFORM_STATUS) as (keyof typeof PLATFORM_STATUS)[]) {
      for (const t of [platformHint(st, true), platformHint(st, false), savedToast("X", st, true)]) expect(t.includes("\u2014")).toBe(false);
    }
  });
  test("every state is registered in STATUS_LABEL with the same label and tone", () => {
    for (const [k, v] of Object.entries(PLATFORM_STATUS)) expect(STATUS_LABEL[k]).toEqual({ label: v.label, tone: v.tone });
    expect(STATUS_LABEL["keys-missing"].label).toBe("Keys missing");
    expect(STATUS_LABEL.hidden.label).toBe("Hidden");
    expect(STATUS_LABEL.live.label).toBe("Live");
  });
});

describe("1167 wiring", () => {
  const form = read("components/admin/PlatformKeysForm.tsx");
  const route = read("app/api/admin/platforms/route.ts");
  const page = read("app/admin/(panel)/platforms/page.tsx");
  test("the card uses StatusBadge with the hint, never the old Live / Not live pills", () => {
    expect(form).toContain("<StatusBadge status={status} />");
    expect(form).toContain("<Tooltip text={platformHint(status, core)} describe>");
    expect(form).not.toContain("Not live");
    expect(form).not.toContain('<Pill tone="ok">Live</Pill>');
  });
  test("status comes from ready (both keys on the server), not from the studio list", () => {
    expect(form).toContain("const status = platformStatus({ core, ready,");
    expect(form).toContain("saveLabel(status, next)");
    expect(form).toContain("toast(savedToast(meta.name, after, core)");
    expect(route).toContain("const readyPlatforms = () => PLATFORMS.filter(hasCredentials);");
    expect(route).toContain("return json({ platforms: redact(\"platforms\", v), live, ready });");
    expect(route).toContain("${name}: ${PLATFORM_STATUS[status].label}");
    expect(route).not.toContain("is off");
    expect(page).toContain("const ready = PLATFORMS.filter(hasCredentials);");
    expect(page).toContain("ready={ready}");
  });
});

describe("1168 route sweep", () => {
  const P = (r: string) => read(`app/admin/(panel)/${r}/page.tsx`);
  test("statuses go through the shared badge", () => {
    expect(P("payments")).toContain('<StatusBadge status={p.status} label={p.status === "succeeded" ? "Paid" : undefined} />');
    expect(P("payments")).not.toContain("STATUS_TONE");
    expect(P("tickets")).toContain("<StatusBadge status={t.status} />");
    expect(P("tickets")).not.toContain("STATUS_TONE");
    expect(read("app/admin/(panel)/subscriptions/_components/SubscribersPanel.tsx")).not.toContain("STATUS_TONE");
    expect(read("app/admin/(panel)/subscriptions/_components/RiskPanel.tsx")).toContain("<StatusBadge status={f.status} />");
    expect(read("components/admin/TeamView.tsx")).toContain('<StatusBadge status={a.active ? "active" : "suspended"} />');
    expect(STATUS_LABEL.suspended.label).toBe("Suspended");
  });
  test("every table is labelled", () => {
    for (const f of ["app/admin/(panel)/payments/page.tsx", "app/admin/(panel)/users/page.tsx", "components/admin/BehaviorBreakdown.tsx", "components/admin/TeamView.tsx"]) {
      for (const m of read(f).matchAll(/<Table\b[^>]*/g)) expect(m[0]).toContain("label=");
    }
  });
  test("eyebrows match the sidebar group", () => {
    expect(P("analytics").match(/<PageHead eyebrow="Insights" title="Analytics"/g)?.length).toBe(3);
    expect(P("growth")).toContain('eyebrow="Insights"');
    expect(P("retention")).toContain('eyebrow="Insights"');
    expect(P("team")).toContain('eyebrow="Administration"');
  });
  test("standalone links reach 44px on touch; empty states use the kit", () => {
    expect(P("users")).not.toContain('className="rounded-full px-3 py-1.5 hairline');
    // R1272: Previous/Next are the kit Pagination (shared Button size sm, touch:h-11) and the invoice link is a shared Button.
    expect(P("users")).toContain('<Pagination total={total} page={page} limit={PER} label="Customer list pages" />');
    expect(P("users")).not.toMatch(/<a className="inline-flex[^"]*hairline[^"]*" href=\{link\(/);
    expect(read("components/admin/Pagination.tsx")).toContain('<Button asChild variant="outline" size="sm">');
    expect(P("payments")).toContain('<Button asChild variant="outline" size="sm" className="font-mono text-[12px]">');
    expect(P("blog")).toContain('href="/admin/blog/library" className="inline-flex min-h-11');
    const b = read("components/admin/BehaviorBreakdown.tsx");
    expect(b).toContain('<Empty title="No platforms connected yet"');
    expect(b).toContain('<Empty title="No activity in this range yet" />');
    expect(read("components/admin/FaqEditor.tsx")).toContain('<Empty title="No questions match"');
  });
});
