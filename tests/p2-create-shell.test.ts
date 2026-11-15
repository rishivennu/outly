/**
 * Phase 2 Create shell: upload limits shown before picking, the compact action bar's rules, best times that
 * only come from real data, offline gating and confirmations for destructive actions.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { formatBytes, limitsLine, limitsProblem, resumeSlot, type UploadLimits } from "../lib/client/upload";
import { barState, OFFLINE_SEND, type BarInput } from "../components/create/ActionBar";
import { bestTimesWaitLine, realSlots, scheduleCheckLine, type BestAnswer } from "../components/create/LaunchPanel";

const g = globalThis as unknown as { __shellUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__shellUser !== undefined ? g.__shellUser : realGetCurrentUser()) }));

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const MB = 1024 * 1024;
const lim = (x: Partial<UploadLimits> = {}): UploadLimits => ({ direct: true, maxBytes: 500 * MB, maxMb: 500, planLimited: false, planName: "Creator", formats: { extensions: [".mp4", ".mov"], mimeTypes: ["video/mp4", "video/quicktime"], label: "MP4 or MOV" }, ...x });
const file = (name: string, type: string, size: number) => ({ name, type, size });

describe("upload limits from the server", () => {
  test("the line says the real formats, size and storage left", () => {
    expect(limitsLine(lim())).toBe("MP4 or MOV, up to 500 MB per file");
    expect(limitsLine(lim({ storage: { limitBytes: 5 * 1024 * MB, remainingBytes: 2 * 1024 * MB, over: false, label: "5 GB" } }))).toBe("MP4 or MOV, up to 500 MB per file. 2 GB of storage left.");
    expect(limitsLine(lim({ storage: { limitBytes: 5 * MB, remainingBytes: 0, over: true, label: "5 MB" } }))).toContain("Storage is full (5 MB).");
    expect(limitsLine(lim({ maxMb: 2048, maxBytes: 2048 * MB }))).toBe("MP4 or MOV, up to 2 GB per file");
  });
  test("a file is turned away before upload for type, plan size, server size and storage", () => {
    expect(limitsProblem(file("a.mp4", "video/mp4", 10 * MB), lim())).toBeNull();
    expect(limitsProblem(file("a.MOV", "", 10 * MB), lim())).toBeNull();
    expect(limitsProblem(file("a.avi", "video/x-msvideo", 10 * MB), lim())?.kind).toBe("type");
    expect(limitsProblem(file("a.mp4", "video/mp4", 600 * MB), lim())).toEqual({ kind: "size", message: "That's a big one. Keep it under 500 MB for now." });
    expect(limitsProblem(file("a.mp4", "video/mp4", 60 * MB), lim({ maxBytes: 50 * MB, maxMb: 50, planLimited: true, planName: "Free" }))?.kind).toBe("upload");
    const st = limitsProblem(file("a.mp4", "video/mp4", 30 * MB), lim({ storage: { limitBytes: 100 * MB, remainingBytes: 20 * MB, over: false, label: "100 MB" } }));
    expect(st?.kind).toBe("storage");
    expect(st?.message).toContain("needs 30 MB");
  });
  test("an older server without a formats list still means MP4 or MOV", () => {
    const { formats: _f, ...old } = lim();
    expect(limitsProblem(file("a.mov", "video/quicktime", MB), old)).toBeNull();
    expect(limitsProblem(file("a.webm", "video/webm", MB), old)?.message).toContain("MP4 or MOV");
  });
  test("a stable resume key survives a File rebuilt from this browser's copy", () => {
    const a = { name: "v.mp4", size: 99, lastModified: 1 };
    const b = { ...a, lastModified: 2 };
    expect(resumeSlot(a, "d_1")).toBe(resumeSlot(b, "d_1"));
    expect(resumeSlot(a)).not.toBe(resumeSlot(b));
    expect(formatBytes(1536 * MB)).toBe("1.5 GB");
  });
});

describe("action bar rules", () => {
  const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasHook: true, ready: true, enabledCount: 2, launching: false, saving: false };
  test("all four work when the post is ready", () => {
    const s = barState(base);
    expect([s.save, s.preview, s.schedule, s.publish].every((a) => !a.disabled)).toBe(true);
    expect(s.note).toBeNull();
  });
  test("offline: publish and schedule are off and say why; saving and preview stay", () => {
    const s = barState({ ...base, online: false });
    expect(s.publish.disabled && s.schedule.disabled).toBe(true);
    expect(s.note).toBe(OFFLINE_SEND);
    expect(s.save.disabled || s.preview.disabled).toBe(false);
  });
  test("each blocker has its own reason, in order", () => {
    expect(barState({ ...base, hasMedia: false }).note).toBe("Add a video first.");
    expect(barState({ ...base, uploadFailed: true }).note).toContain("didn't upload");
    expect(barState({ ...base, enabledCount: 0 }).note).toBe("Pick at least one place to send it.");
    expect(barState({ ...base, hasHook: false }).note).toContain("hook");
    expect(barState({ ...base, ready: false }).note).toContain("Everywhere");
    expect(barState({ ...base, launching: true }).publish.disabled).toBe(true);
    expect(barState({ ...base, saving: true }).save.disabled).toBe(true);
  });
});

describe("best times: real data only", () => {
  const none: BestAnswer = { source: "none", peakHours: [], slots: [], reason: "", samples: 2, needed: 6 };
  test("not enough posts: no slots, and the count so far", () => {
    expect(realSlots(none)).toEqual([]);
    expect(bestTimesWaitLine(none)).toBe("Best times appear after 6 posts with views (2 so far).");
    expect(bestTimesWaitLine({})).toBe("Best times appear after 6 posts with views.");
  });
  test("a typical answer from an older server is never shown as slots", () => {
    expect(realSlots({ ...none, source: "typical", slots: [{ at: "2026-11-16T10:00:00Z", label: "Mon 10 AM" }] })).toEqual([]);
    expect(realSlots({ ...none, source: "yours", slots: [{ at: "2026-11-16T10:00:00Z", label: "Mon 10 AM" }] })).toHaveLength(1);
  });
  test("the panel has no industry label left", () => {
    const lp = src("components/create/LaunchPanel.tsx");
    expect(lp).not.toContain('"Typical"');
    expect(lp).toContain("peakHours={peaks}");
  });
});

describe("workspace wiring", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  test("replace and stop upload ask first, with the shared dialog", () => {
    expect(ws).toContain("onReplace={(f) => setReplacing(f)}");
    expect(ws).toContain("onCancel={() => setStopAsk(true)}");
    expect(ws).toContain('title="Replace your video?"');
    expect(ws).toContain('title="Stop this upload?"');
    expect(src("components/create/CoverPicker.tsx")).toContain('title="Remove the cover?"');
    expect(src("components/create/DeviceDrafts.tsx")).toContain("Remove this draft from this device?");
  });
  test("the bar is one sticky element above the tab bar and the deck does not stack a second", () => {
    const bar = src("components/create/ActionBar.tsx");
    expect(bar).toContain("sticky bottom-[calc(env(safe-area-inset-bottom)+76px)]");
    expect(bar).not.toContain("transition-all");
    // Phase 3 CONTRACT-B: the deck no longer docks its own bar, so the one ActionBar is the only bar.
    expect(ws.match(/<ActionBar/g)?.length).toBe(1);
  });
  test("picks go through the server limits, uploads resume by draft id", () => {
    expect(ws).toContain("onFile={(f) => void pickFile(f)}");
    expect(ws).toContain("<UploadLimits error={pickError}");
    expect(ws).toContain("resumeKey: deviceId.current ?? undefined");
  });
  test("offline: AI writing, connecting and launch refuse with a reason", () => {
    expect(ws).toContain("Pip can write hooks again when you reconnect.");
    expect(ws).toContain("Pip can write the copy when you reconnect");
    expect(ws).toContain("Connect it when you're back online.");
    expect(ws).toContain("busy={launching} error={launchError} online={online}");
  });
  test("drafts sync through one writer, per account, with conflicts shown", () => {
    expect(ws).toContain("useDraftSync({");
    expect(ws).toContain("const store = useMemo(() => openDrafts(user.id), [user.id]);");
    expect(ws).toContain("sync.saveLocal(written);");
    // Review fix 4: the explicit save never races the background sync, and settles only what it carried.
    expect(ws).toContain("sync.markSynced({ id: r.post.id, updatedAt: r.post.updatedAt }, upTo);");
    expect(ws).toContain("const upTo = sync.version();");
    expect(ws).toContain("await sync.exclusive(async () => {");
    // Review fix 15: a gone server copy clears the base instead of storing "".
    expect(ws).not.toContain('baseUpdatedAt: ""');
    expect(ws).toContain("onGone: () => {");
    expect(ws).not.toContain("setTimeout(() => save(), 900)");
    expect(ws).not.toMatch(/saveDeviceDraft|removeDeviceDraft|getDeviceDraft|findDeviceDraftByPost/);
    expect(ws).toContain("<ConflictDialog");
    expect(ws).toContain("sync.resolveConflict(\"server\", server);");
    expect(ws).toContain("hideButton sync={syncLine}");
    const dd = src("components/create/DeviceDrafts.tsx");
    expect(dd).toContain("store.list()");
    expect(dd).not.toMatch(/listDeviceDrafts|removeDeviceDraft/);
  });
  test("no em or en dashes in the new copy", () => {
    for (const f of ["components/create/ActionBar.tsx", "components/create/UploadLimits.tsx", "lib/client/use-online.ts"]) expect(src(f)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("check before scheduling", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  test("a clear time, or a check that never answered, does not stop the booking", () => {
    expect(scheduleCheckLine({ ok: true, issues: [], conflicts: [] })).toBeNull();
    expect(scheduleCheckLine(null)).toBeNull();
  });
  test("issues and nearby bookings are spelled out", () => {
    const line = scheduleCheckLine({
      ok: false,
      issues: [
        { code: "schedule_conflict", message: "1 post sends this video to the same account within 10 minutes." },
        { code: "platform_limit", message: "The caption is over 2,200 characters.", platform: "instagram" },
      ],
      conflicts: [{ postId: "p1", title: "Day 12", scheduledAt: "2026-11-16T10:00:00.000Z", platform: "instagram" }],
    })!;
    expect(line).toContain("within 10 minutes.");
    expect(line).toContain("Instagram: The caption is over 2,200 characters.");
    expect(line).toContain("Booked close to it: Day 12.");
  });
  test("a failed check with no detail still says something", () => {
    expect(scheduleCheckLine({ ok: false })).toBe("That time doesn't work for this post. Pick another one.");
  });
  test("the workspace asks before booking and lets a network failure through", () => {
    expect(ws).toContain("/check?at=${encodeURIComponent(when.toISOString())}`).catch(() => null);");
    expect(ws).toContain("if (stop) return setLaunchError(stop);");
  });
});

describe("GET /api/media/direct", () => {
  let db: typeof import("../lib/db").db;
  let directRoute: typeof import("../app/api/media/direct/route");
  beforeAll(async () => {
    db = (await import("../lib/db")).db;
    directRoute = await import("../app/api/media/direct/route");
  }, 60_000);
  afterAll(() => {
    g.__shellUser = undefined;
  });
  const req = () => new NextRequest("http://localhost/api/media/direct", { headers: { host: "localhost" } });

  test("signed out gets 401", async () => {
    g.__shellUser = null;
    expect((await directRoute.GET(req(), {} as never)).status).toBe(401);
  });
  test("returns the formats POST accepts and this account's size limit", async () => {
    const u = await db.user.create({ data: { name: "Shell", email: `shell-${Date.now()}@test.dev`, passwordHash: "x" } });
    g.__shellUser = { ...u, actor: null, role: "owner", joinedAt: u.createdAt, scope: null };
    const res = await directRoute.GET(req(), {} as never);
    expect(res.status).toBe(200);
    const j = (await res.json()) as UploadLimits;
    expect(j.formats).toEqual({ extensions: [".mp4", ".mov"], mimeTypes: ["video/mp4", "video/quicktime"], label: "MP4 or MOV" });
    expect(j.maxBytes).toBeGreaterThan(0);
    expect(typeof j.maxMb).toBe("number");
    expect(limitsProblem(file("a.mp4", "video/mp4", 1), j)).toBeNull();
  });
});
