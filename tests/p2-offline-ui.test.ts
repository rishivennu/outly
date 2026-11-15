/** Phase 2 offline drafts, the visible half: banner words, the pill, the compare dialog, house rules. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { connectivityLine } from "../components/shared/Connectivity";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const MINE = ["lib/client/draft-sync-core.ts", "lib/client/draft-sync.ts", "lib/client/device-drafts.ts", "lib/client/use-online.ts", "components/create/SyncStatus.tsx", "components/create/ConflictDialog.tsx", "components/shared/Connectivity.tsx", "lib/client/forget-billing.ts"];

describe("connectivity banner", () => {
  test("says when a draft is waiting, syncing, synced, failed or in conflict", () => {
    const none = { status: null, pending: false };
    expect(connectivityLine("offline", none)).toBe("You're offline. Saved pages and invoices still open; changes wait until you're back.");
    expect(connectivityLine("offline", { status: "waiting", pending: true })).toContain("saved on this device and syncs when you're back");
    expect(connectivityLine("back", { status: "waiting", pending: true })).toBe("Back online. Syncing your draft.");
    expect(connectivityLine("back", { status: "synced", pending: false })).toBe("Back online. Draft synced.");
    expect(connectivityLine("back", { status: "failed", pending: true })).toContain("didn't sync");
    expect(connectivityLine("back", { status: "conflict", pending: true })).toContain("another device");
    expect(connectivityLine("back", none)).toBe("Back online.");
  });
  test("still registers the service worker and reads one shared online hook", () => {
    const c = src("components/shared/Connectivity.tsx");
    expect(c).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(c).toContain("useOnline()");
    expect(c).not.toContain('addEventListener("online"');
  });
});

describe("sync surfaces", () => {
  test("the pill can retry and open the compare", () => {
    const s = src("components/create/SyncStatus.tsx");
    expect(s).toContain('role="status"');
    expect(s).toContain("Retry sync");
    expect(s).toContain("Compare versions");
  });
  test("the dialog offers both versions and closing chooses neither", () => {
    const s = src("components/create/ConflictDialog.tsx");
    expect(s).toContain("Keep mine");
    expect(s).toContain("Keep the other device&apos;s");
    expect(s).toContain("!o && !busy && onClose()");
    expect(s).toContain("diffDrafts(local, server");
  });
  test("useDraftSync never publishes", () => {
    const s = src("lib/client/draft-sync.ts");
    expect(s).not.toMatch(/\/launch|\/publish|scheduledAt:/);
  });
});

describe("house rules in these files", () => {
  for (const f of MINE)
    test(f, () => {
      const s = src(f);
      expect(s).not.toContain("transition-all");
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(s).not.toMatch(/(?<!\[@media\(hover:hover\)\]:)\bhover:/);
    });
});
