/**
 * R1209 B (client): Step 1 shows the limit that binds (Free: this month's uploads and the renewal day; paid: what is
 * kept), a refused pick sells the right upgrade, Start over asks before anything is lost and deletes only after a
 * second confirmation, and a saved draft is never said to expire.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { limitsLine, limitsProblem, upgradeFor, type UploadLimits } from "../lib/client/upload";
import { limitFacts, quotaMeter } from "../components/create/UploadCard";
import { deletedLine, deleteNote, flashNext, takeFlash } from "../components/create/StartOverDialog";
import { api, ApiError, UPGRADE_EVENT } from "../lib/client/api";
import { fmtDay, type MonthlyFigures, type StorageFiguresR1209 } from "../lib/storage/quota-core";
import type { QuotaView } from "../components/billing/QuotaCard";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MB = 1048576;
const RESET = "2026-12-01T00:00:00.000Z";
const FORMATS = { extensions: [".mp4", ".mov"], mimeTypes: ["video/mp4", "video/quicktime"], label: "MP4 or MOV" };

const monthly = (used: number, allowance = 500 * MB, reserved = 0): MonthlyFigures => ({
  usedBytes: used,
  allowanceBytes: allowance,
  remainingBytes: Math.max(0, allowance - used - reserved),
  reservedBytes: reserved,
  percent: allowance ? ((used + reserved) / allowance) * 100 : 0,
  unlimited: false,
  cycleKey: "2026-11",
  startedAt: "2026-11-01T00:00:00.000Z",
  resetAt: RESET,
});
const storage = (used: number, cap: number): StorageFiguresR1209 => ({
  usedBytes: used,
  capacityBytes: cap,
  availableBytes: Math.max(0, cap - used),
  reservedBytes: 0,
  percent: cap ? (used / cap) * 100 : 0,
  unlimited: false,
  trashBytes: 0,
});
const view = (m: MonthlyFigures | null, s: StorageFiguresR1209 | null, state: QuotaView["state"] = "normal"): QuotaView => ({
  policy: m && s ? "both" : m ? "monthly" : "storage",
  monthly: m,
  storage: s,
  storedBytes: s?.usedBytes ?? 0,
  maxFileBytes: 500 * MB,
  state,
  canUpload: state !== "full",
  message: null,
  planName: m ? "Free" : "Pro",
  planSlug: m ? "free" : "pro",
  upgradeUrl: "/billing",
});
const freeLimits = (used: number, state: QuotaView["state"] = "normal"): UploadLimits => {
  const m = monthly(used);
  return {
    direct: true,
    maxBytes: 500 * MB,
    planName: "Free",
    planLimited: true,
    formats: FORMATS,
    storage: { usedBytes: used, limitBytes: 500 * MB, remainingBytes: m.remainingBytes, over: m.remainingBytes < 1, label: "", kind: "monthly" },
    quota: view(m, null, state),
  };
};
const paidLimits = (used: number, cap = 50 * 1024 * MB, state: QuotaView["state"] = "normal"): UploadLimits => ({
  direct: true,
  maxBytes: 4 * 1024 * MB,
  planName: "Pro",
  formats: FORMATS,
  storage: { usedBytes: used, limitBytes: cap, remainingBytes: Math.max(0, cap - used), over: used >= cap, label: "", kind: "storage" },
  quota: view(null, storage(used, cap), state),
});
const file = (size: number) => ({ name: "clip.mp4", type: "video/mp4", size });

describe("R1209 B: a refused pick sells the upgrade that would help", () => {
  test("monthly sells uploads, storage and per-file cap sell themselves, the rest sell nothing", () => {
    expect(upgradeFor("monthly")).toBe("uploads");
    expect(upgradeFor("storage")).toBe("storage");
    expect(upgradeFor("upload")).toBe("upload");
    expect(upgradeFor("type")).toBeNull();
    expect(upgradeFor("size")).toBeNull();
  });
  test("UpgradeDialog has a title for the monthly allowance", () => {
    expect(src("components/shared/UpgradeDialog.tsx")).toContain('uploads: "Upgrade to upload more this month"');
  });
  test("Create's picker and the uploader both ask upgradeFor", () => {
    expect(src("components/create/CreateWorkspace.tsx")).toContain("const sell = upgradeFor(bad.kind);");
    expect(src("lib/client/upload.ts")).toContain("const sell = upgradeFor(bad.kind);");
  });
});

describe("R1209 B: Free is checked against this month's uploads, in the server's words", () => {
  test("a file bigger than what is left this month is refused as monthly, with the renewal day", () => {
    const p = limitsProblem(file(250 * MB), freeLimits(300 * MB));
    expect(p?.kind).toBe("monthly");
    expect(p?.message).toBe(`This file is 250 MB and you have 200 MB of your monthly upload allowance left. It renews on ${fmtDay(RESET)}, or upgrade to upload more now.`);
  });
  test("a used-up month says so and offers the upgrade", () => {
    const p = limitsProblem(file(10 * MB), freeLimits(500 * MB));
    expect(p?.kind).toBe("monthly");
    expect(p?.message).toBe(`You've used your 500 MB upload allowance for this month. Your allowance renews on ${fmtDay(RESET)}. Upgrade your plan to unlock more upload capacity immediately.`);
  });
  test("an older server without the quota block still gets a monthly line", () => {
    const lim = { ...freeLimits(300 * MB), quota: undefined };
    expect(limitsProblem(file(250 * MB), lim)?.message).toBe("This file is 250 MB and you have 200 MB of this month's uploads left. Upgrade to upload more now.");
  });
  test("a file that fits is fine", () => {
    expect(limitsProblem(file(100 * MB), freeLimits(300 * MB))).toBeNull();
  });
  test("paid plans are still checked against storage", () => {
    expect(limitsProblem(file(10 * MB), paidLimits(50 * 1024 * MB))?.kind).toBe("storage");
  });
  test("the limits line names the month on Free and storage on paid", () => {
    expect(limitsLine(freeLimits(300 * MB))).toBe("MP4 or MOV, up to 500 MB per file. 200 MB of this month's uploads left.");
    expect(limitsLine(freeLimits(500 * MB))).toBe("MP4 or MOV, up to 500 MB per file. This month's uploads are used up.");
    expect(limitsLine(paidLimits(0, 10 * 1024 * MB))).toContain("10 GB of storage left.");
  });
});

describe("R1209 B: Step 1's meter reads the real figures", () => {
  test("Free shows uploaded this month and the renewal day", () => {
    const m = quotaMeter(freeLimits(300 * MB));
    expect(m).toEqual({ state: "normal", pct: 60, label: "Monthly upload allowance", text: `300 MB of 500 MB uploaded this month. Renews ${fmtDay(RESET)}.`, tight: false });
  });
  test("paid shows what is kept, as a whole percent", () => {
    const m = quotaMeter(paidLimits(5 * 1024 * MB, 10 * 1024 * MB, "warning"));
    expect(m?.label).toBe("Storage");
    expect(m?.text).toBe("5 GB of 10 GB storage used (50%).");
    expect(m?.tight).toBe(true);
  });
  test("no quota block or an unlimited plan shows no meter, and a bad percent never escapes 0 to 100", () => {
    expect(quotaMeter(null)).toBeNull();
    expect(quotaMeter({ ...paidLimits(0), quota: undefined })).toBeNull();
    const unl = paidLimits(0);
    unl.quota = { ...unl.quota!, storage: { ...unl.quota!.storage!, unlimited: true } };
    expect(quotaMeter(unl)).toBeNull();
    const wild = freeLimits(300 * MB);
    wild.quota = { ...wild.quota!, monthly: { ...wild.quota!.monthly!, percent: 180 } };
    expect(quotaMeter(wild)?.pct).toBe(100);
  });
  test("facts never call the monthly allowance storage", () => {
    const f = limitFacts(freeLimits(300 * MB));
    expect(f.monthly).toBe(true);
    expect(f.storage).toBe("200 MB of 500 MB left this month");
    expect(f.renews).toBe(fmtDay(RESET));
    expect(limitFacts(freeLimits(500 * MB)).storage).toBe("This month's 500 MB used");
    expect(limitFacts(paidLimits(0, 10 * 1024 * MB)).monthly).toBe(false);
  });
  test("the card renders the meter as a labelled progress bar with an Upgrade link when tight", () => {
    const s = src("components/create/UploadCard.tsx");
    expect(s).toContain('data-testid="upload-quota"');
    expect(s).toContain('role="progressbar"');
    expect(s).toContain("This month's uploads are used up");
    expect(s).toContain("/settings#storage");
    expect(s).not.toContain("transition-all");
  });
});

describe("R1209 B: a 413 quota refusal opens the upgrade popup", () => {
  const realFetch = globalThis.fetch;
  const g = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in g;
  const realWindow = g.window;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (hadWindow) g.window = realWindow;
    else delete g.window;
  });
  const call = async (status: number, body: Record<string, unknown>) => {
    const seen: { message: string; feature?: string }[] = [];
    g.window = { dispatchEvent: (e: CustomEvent) => (e.type === UPGRADE_EVENT && seen.push(e.detail), true), location: { href: "" } };
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const err = await api("/api/media/direct", { method: "POST", json: {} }).catch((e) => e);
    return { seen, err };
  };
  test("quota_monthly sells uploads and the caller still gets the error", async () => {
    const { seen, err } = await call(413, { error: "You've used your 500 MB upload allowance for this month.", code: "quota_monthly" });
    expect(seen).toEqual([{ message: "You've used your 500 MB upload allowance for this month.", feature: "uploads" }]);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(413);
  });
  test("quota_storage sells storage", async () => {
    const { seen } = await call(413, { error: "Storage is full.", code: "quota_storage" });
    expect(seen[0]?.feature).toBe("storage");
  });
  test("a per-file cap only sells when a bigger plan would lift it", async () => {
    expect((await call(413, { error: "Free uploads are limited to 500 MB per file. Upgrade to upload bigger videos.", code: "file_too_big" })).seen[0]?.feature).toBe("upload");
    expect((await call(413, { error: "Keep it under 5 GB.", code: "file_too_big" })).seen).toEqual([]);
  });
  test("a 413 without a quota code opens nothing", async () => {
    expect((await call(413, { error: "Too big." })).seen).toEqual([]);
  });
});

describe("R1209 B: Start over asks, and deletes only after a second yes", () => {
  test("the note before a delete never promises allowance back", () => {
    expect(deleteNote({ monthly: true, storage: false })).toBe("This month's upload allowance stays as it is: a delete never gives it back.");
    expect(deleteNote({ monthly: false, storage: true })).toBe("Deleting it for good frees the storage it uses.");
    expect(deleteNote({ monthly: true, storage: true })).toContain("frees its storage");
    expect(deleteNote({ monthly: false, storage: false })).toBeNull();
  });
  test("the line after a delete only states what the server freed", () => {
    expect(deletedLine({ freedBytes: 120 * MB, refunded: true }, false)).toBe("Deleted. 120 MB of storage is free again.");
    expect(deletedLine({ freedBytes: 120 * MB, refunded: false }, true)).toBe("Deleted. This month's upload allowance stays as it is.");
    expect(deletedLine({ freedBytes: -5, refunded: true }, false)).toBe("Deleted. You're starting fresh.");
    expect(deletedLine(null, false)).toBe("Deleted. You're starting fresh.");
    expect(deletedLine({ freedBytes: 0, pendingBytes: 50 * MB, refunded: false }, false)).toBe("Deleted. The video is still being cleared from storage, so its space frees up shortly.");
    expect(deletedLine({ freedBytes: 0, pendingBytes: 50 * MB }, true)).toContain("allowance stays as it is");
  });
  test("the flash survives the reload once, and private mode just says nothing", () => {
    const g = globalThis as unknown as { sessionStorage?: unknown };
    const had = "sessionStorage" in g;
    const real = g.sessionStorage;
    const m = new Map<string, string>();
    g.sessionStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    try {
      flashNext("Your work has been saved as a draft.");
      expect(takeFlash()).toBe("Your work has been saved as a draft.");
      expect(takeFlash()).toBeNull();
      g.sessionStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
      expect(() => flashNext("x")).not.toThrow();
      expect(takeFlash()).toBeNull();
    } finally {
      if (had) g.sessionStorage = real;
      else delete g.sessionStorage;
    }
  });
  test("the dialog carries the brief's copy and three choices, then a second confirmation", () => {
    const s = src("components/create/StartOverDialog.tsx");
    for (const t of ["Start a new creation?", "You have an existing video and work in progress. What would you like to do with it?", "Save as draft", "Delete and start fresh", "Cancel", "Delete this creation permanently?", "This will delete the selected draft and its associated uploaded media. The action cannot be undone.", "Go back", "Delete permanently", 'role="alert"'])
      expect(s).toContain(t);
    expect(s).toContain('onClick={() => setStage("confirm")}');
    expect(s).not.toMatch(/[\u2013\u2014]/);
  });
  test("Create deletes the post with its media, or an unsaved upload, and stops saving while it wipes", () => {
    const s = src("components/create/CreateWorkspace.tsx");
    expect(s).toContain("?media=delete`, { method: \"DELETE\" })");
    expect(s).toContain("?purge=1`, { method: \"DELETE\" })");
    expect(s).toContain('if (!navigator.onLine) return setOverError("You\'re offline. Deleting needs a connection, so nothing was deleted.");');
    expect(s).toContain('if (upload.kind === "uploading" || upload.kind === "paused") cancelUpload();');
    expect(s).toContain("!wiping.current && media && phase === \"edit\"");
    expect(s).toContain("if (wiping.current || !deviceReady");
    expect(s).toContain("wiping.current = false;");
    expect(s).toContain("flashNext(deletedLine(r, ");
    expect(s).toContain("<StartOverDialog");
    expect(s).toContain('"That draft is gone. It was deleted, maybe on another device."');
  });
});

describe("R1209 B: saved drafts are never said to expire", () => {
  test("no draft copy still says drafts are removed after a few days", () => {
    for (const f of ["components/create/DeviceDrafts.tsx", "components/create/SavedDrafts.tsx", "components/create/SaveDraft.tsx", "components/content/ContentLibrary.tsx", "app/(marketing)/privacy/page.tsx"]) {
      const s = src(f);
      expect(s).not.toMatch(/days?,? (they )?are removed|are removed from Outlly|nobody has touched/);
    }
    expect(src("app/(marketing)/privacy/page.tsx")).toContain("Saved drafts stay until you delete them.");
  });
});

describe("R1209 A1: PATCH keeps the story's mode", () => {
  test("storyMeta counts as a words edit and is written", () => {
    const s = src("app/api/posts/[id]/route.ts");
    expect(s).toContain("body.storyMeta !== undefined");
    expect(s).toContain("storyMeta: body.storyMeta");
  });
});
