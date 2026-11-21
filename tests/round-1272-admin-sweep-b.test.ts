// R1272 admin sweep B: panels, toggles, subscriptions and the remaining admin pages use the shared kit.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(f, "utf8");

// Raw <button>s that stay on purpose: each is a selectable tab, radio, chip or list row with aria state.
const EXCEPTIONS: Record<string, number> = {
  "components/admin/ActivationFunnel.tsx": 1, // range radio
  "components/admin/AdminDock.tsx": 1, // R1290 dock account menu: the high contrast menuitemcheckbox row
  "components/admin/AiAccessPanel.tsx": 2, // mode radio + length chips
  "components/admin/AdminTabBar.tsx": 1, // R1274 More tab of the phone tab bar (aria-expanded, .mtab-item ink)
  "components/admin/AiEngineCard.tsx": 1, // disclosure row
  "components/admin/BehaviorAnalyses.tsx": 1, // version list row
  "components/admin/BehaviorView.tsx": 2, // tabs + range radio
  "components/admin/FaqEditor.tsx": 1, // accordion row
  "components/admin/OutboxView.tsx": 1, // selectable email row
  "components/admin/OverviewCharts.tsx": 1, // range segmented radio
  "components/admin/ReferralsPanel.tsx": 1, // eligible-plan checkbox chips
  "app/admin/(panel)/subscriptions/_components/PolicyPanel.tsx": 1, // cycle chips
  "app/admin/(panel)/subscriptions/_components/RiskPanel.tsx": 1, // status chips
  "app/admin/(panel)/subscriptions/_components/SubscribersPanel.tsx": 1, // tier chips
  "app/admin/(panel)/subscriptions/_components/SubscriptionsAdmin.tsx": 1, // tabs
};

const SWEEP_A = /components\/admin\/(liveassist|health|blog|growth|live)\/|PricingEditor|PricingLab|PlanGrantsPanel|IntegrationsForm/;
const KIT = /components\/admin\/(ui|FilterBar|SearchBox|SearchInput|ChartCard|RefreshButton|kit|Switch|Pagination|AdminShell|ScrollArea|Bell)\.tsx?$/;
const SWEEP_A_PAGES = /app\/admin\/\(panel\)\/(live-assist|health|blog|growth|integrations|pricing|plans)\//;

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n).replace(/\\/g, "/");
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const MINE = [...walk("components/admin"), ...walk("app/admin")].filter((f) => !SWEEP_A.test(f) && !KIT.test(f) && !SWEEP_A_PAGES.test(f));

describe("R1272 sweep B: shared controls", () => {
  test("the sweep covers the panels it owns", () => {
    for (const f of ["components/admin/BetaPanel.tsx", "components/admin/TeamView.tsx", "app/admin/(panel)/error.tsx", "app/admin/(panel)/subscriptions/_components/shared.tsx"]) expect(MINE).toContain(f);
  });

  test("raw <button> only where a documented selectable row or tab stays", () => {
    const got: Record<string, number> = {};
    for (const f of MINE) {
      const n = (read(f).match(/<button\b/g) ?? []).length;
      if (n) got[f] = n;
    }
    expect(got).toEqual(EXCEPTIONS);
  });

  test("the remaining raw buttons keep a 44px target and a focus ring, without a press bounce", () => {
    for (const f of Object.keys(EXCEPTIONS)) {
      for (const m of read(f).matchAll(/<button\b[\s\S]*?<\/button>/g)) {
        const tag = m[0];
        expect({ f, ok: /min-h-11|h-11/.test(tag) || /chip\(/.test(tag) }).toEqual({ f, ok: true });
        expect({ f, ok: /focus-visible:(ring|outline)|chip\(/.test(tag) }).toEqual({ f, ok: true });
        expect({ f, ok: /aria-(pressed|selected|checked|expanded|current)/.test(tag) }).toEqual({ f, ok: true });
        expect(tag).not.toContain("active:scale");
      }
    }
  });

  test("no hand-rolled switch: every toggle is the shared Switch", () => {
    for (const f of MINE) {
      const s = read(f);
      expect({ f, raw: s.includes('role="switch"') }).toEqual({ f, raw: false });
      expect({ f, knob: /bg-white[^"]*shadow|rounded-full bg-white/.test(s) }).toEqual({ f, knob: false });
    }
    const users = ["BetaPanel", "FoundingPanel", "CampaignsPanel", "LandingToggles", "WaitlistToggle", "MaintenanceToggle", "WelcomeScreenSettings", "UpdatesEditor", "DashboardStylePicker", "InstallPromptSettings", "PlatformKeysForm"];
    for (const n of users) expect({ n, ok: read(`components/admin/${n}.tsx`).includes('import { Switch } from "./Switch";') }).toEqual({ n, ok: true });
    expect((read("components/admin/FoundingPanel.tsx").match(/<Switch /g) ?? []).length).toBe(2);
    expect((read("components/admin/PlatformKeysForm.tsx").match(/<Switch /g) ?? []).length).toBe(2);
    expect(read("app/admin/(panel)/subscriptions/_components/shared.tsx")).toContain('import { Switch as AdminSwitch } from "@/components/admin/Switch";');
    expect(read("components/admin/LandingToggles.tsx")).not.toContain("function Switch(");
  });

  test("no white plate behind a logo; only the email previews keep a white page", () => {
    for (const f of MINE) {
      if (!read(f).includes("bg-white")) continue;
      expect(["components/admin/OutboxView.tsx", "components/admin/WaitlistCampaign.tsx"]).toContain(f);
    }
    expect(read("components/admin/PlatformKeysForm.tsx")).toContain("<PlatformOrb platform={p} size={40} />");
  });

  test("status words come from StatusBadge", () => {
    expect(read("components/admin/OutboxView.tsx")).toContain("<StatusBadge status={r.status} />");
    expect(read("components/admin/OutboxView.tsx")).not.toContain("STATUS_TONE");
    expect(read("components/admin/TeamView.tsx")).toContain('<StatusBadge status={a.active ? "active" : "suspended"} />');
    expect(read("app/admin/(panel)/tickets/[id]/page.tsx")).toContain('<StatusBadge status={p.status === "succeeded" ? "paid" : p.status} />');
    expect(read("app/admin/(panel)/waitlist/page.tsx")).toContain('<StatusBadge status="waiting" />');
    expect(read("app/admin/(panel)/subscriptions/_components/SubscribersPanel.tsx")).toContain("<StatusBadge status=");
    expect(read("app/admin/(panel)/subscriptions/_components/RiskPanel.tsx")).toContain("<StatusBadge status={f.status} />");
    expect(read("app/admin/(panel)/payments/page.tsx")).toContain("<StatusBadge status={p.status}");
    for (const f of ["MaintenanceToggle", "FoundingPanel", "WaitlistToggle", "BetaPanel", "UpdatesEditor"]) {
      expect(read(`components/admin/${f}.tsx`)).toMatch(/action=\{<StatusBadge status=\{/);
    }
    expect(read("components/admin/BetaPanel.tsx")).not.toContain("<Pill");
  });

  test("card-mode pill wrap never shrinks a button or link, console link is a 44px target", () => {
    expect(read("app/globals.css")).toContain(".rounded-full.whitespace-nowrap:not(button, a) {");
    expect(read("components/admin/AiAccessPanel.tsx")).toMatch(/<Button type="button" size="sm" variant="outline" className="min-h-11"/);
    expect(read("components/admin/PlatformKeysForm.tsx")).toContain('className="inline-flex min-h-11 items-center gap-1.5 text-[13px]');
  });

  test("destructive and confirm actions use the shared Button and ConfirmDialog", () => {
    for (const f of ["components/admin/RefundButton.tsx", "components/admin/WinbackButton.tsx"]) {
      const s = read(f);
      expect(s).toContain('variant="danger"');
      expect(s).toContain("<ConfirmDialog");
    }
    expect(read("components/admin/TeamView.tsx")).toContain('<Tooltip text="Remove"><Button variant="danger" size="icon-sm"');
  });

  test("error boundary uses ErrorState and the shared Button", () => {
    const s = read("app/admin/(panel)/error.tsx");
    expect(s).toContain("<ErrorState");
    expect(s).toContain('<Button type="button" variant="lime" onClick={reset}>');
  });

  test("lists that already read ?page use the kit Pagination", () => {
    for (const f of ["app/admin/(panel)/users/page.tsx", "app/admin/(panel)/waitlist/page.tsx"]) {
      const s = read(f);
      expect(s).toContain('import { Pagination } from "@/components/admin/Pagination";');
      expect(s).toContain("<Pagination total=");
      expect(s).not.toContain('aria-label="Pages"');
    }
  });

  test("no transition-all", () => {
    for (const f of MINE) expect({ f, bad: read(f).includes("transition-all") }).toEqual({ f, bad: false });
  });
});
