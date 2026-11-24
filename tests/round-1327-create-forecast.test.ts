/**
 * R1327: the Launch-step forecast panel (plan Phase 3 "Create Step panel", built late). The key folds every input the
 * request sends, the panel asks per enabled destination only, shows the server's words, and never shows a number
 * without the server's explanation behind it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { forecastKey } from "../components/create/DraftForecast";
import type { Draft } from "../lib/client/checks";
import { PLATFORMS, type Platform } from "../lib/domain";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const draft = (o: Partial<Draft> = {}): Draft => ({ enabled: true, title: "", caption: "hello", description: "", hashtags: "", firstComment: "", note: "", reviewed: false, ...o }) as Draft;
const drafts = Object.fromEntries(PLATFORMS.map((p) => [p, draft()])) as Record<Platform, Draft>;

describe("R1327 forecast key", () => {
  test("changes with the words, the hook, the media, the timing and the post; not with a disabled platform's text", () => {
    const base = forecastKey(["instagram"], drafts, "", { duration: 30, width: 1080, height: 1920 }, null, null);
    expect(forecastKey(["instagram"], drafts, "", { duration: 30, width: 1080, height: 1920 }, null, null)).toBe(base);
    expect(forecastKey(["instagram"], { ...drafts, instagram: draft({ caption: "other" }) }, "", { duration: 30, width: 1080, height: 1920 }, null, null)).not.toBe(base);
    expect(forecastKey(["instagram"], { ...drafts, youtube: draft({ caption: "other" }) }, "", { duration: 30, width: 1080, height: 1920 }, null, null)).toBe(base);
    expect(forecastKey(["instagram"], drafts, "a hook", { duration: 30, width: 1080, height: 1920 }, null, null)).not.toBe(base);
    expect(forecastKey(["instagram"], drafts, "", { duration: 31, width: 1080, height: 1920 }, null, null)).not.toBe(base);
    expect(forecastKey(["instagram"], drafts, "", { duration: 30, width: 1080, height: 1920 }, "2026-12-01T10:00:00.000Z", null)).not.toBe(base);
    expect(forecastKey(["instagram"], drafts, "", { duration: 30, width: 1080, height: 1920 }, null, "post1")).not.toBe(base);
    expect(forecastKey(["instagram", "youtube"], drafts, "", { duration: 30, width: 1080, height: 1920 }, null, null)).not.toBe(base);
  });
});

describe("R1327 wiring", () => {
  test("Launch step renders the panel for enabled destinations only; the panel speaks the server's words", () => {
    const ws = read("components/create/CreateWorkspace.tsx");
    expect(ws).toContain('<DraftForecast platforms={enabledPlatforms(drafts)} drafts={drafts} hook={hook ?? ""} media={meta} when={mode === "schedule" ? when : null} postId={postId} online={online} className="mb-4" />');
    const panel = read("components/create/DraftForecast.tsx");
    expect(panel).toContain('"use client"');
    expect(panel).toContain('api<Answer>("/api/intelligence/predictions"');
    expect(panel).toContain('format: "video"');
    expect(panel).toContain("{r.answer.prediction.explanation}"); // the server's sentence, with its source and sample
    expect(panel).toContain("{r.answer.reason ?? \"Nothing to go on yet.\"}"); // no number without a basis
    expect(panel).toContain('aria-live="polite"');
    expect(panel).not.toMatch(/\b0 views\b/);
    expect(read("docs/intelligence-clipper-plan.md")).toContain("Create Step 3 draft-prediction panel: DONE in R1327");
  });
});
