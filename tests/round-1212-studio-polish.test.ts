import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileFormat, uploadFigures } from "../components/create/UploadCard";
import { barState, type BarInput } from "../components/create/ActionBar";
import { whenLabel } from "../components/create/PublishingView";
import type { UploadState } from "../components/create/types";

const src = (p: string) => readFileSync(p, "utf8");
const info = (phase: string, bytes = 300, total = 1000, speed: number | null = 50) =>
  ({ phase, bytes, total, speed, partsDone: 3, partsTotal: 10, active: 1 }) as unknown as Extract<UploadState, { kind: "uploading" }>["info"];
const base: BarInput = { online: true, hasMedia: true, uploadFailed: false, hasCaption: true, ready: true, enabledCount: 1, launching: false, saving: false };

describe("1212 upload figures come from the one upload state", () => {
  test("uploading: percent, bytes, speed and time left all from the same tick", () => {
    const f = uploadFigures({ kind: "uploading", progress: 0.3, eta: 42, info: info("uploading") });
    expect(f.stage).toBe("uploading");
    expect(f.pct).toBe(30);
    expect(f.bytes).toMatch(/ of /);
    expect(f.speed).not.toBeNull();
    expect(f.eta).not.toBeNull();
    expect(f.indeterminate).toBe(false);
  });
  test("paused keeps its percent and drops speed and time", () => {
    const f = uploadFigures({ kind: "paused", progress: 0.5 });
    expect(f).toMatchObject({ stage: "paused", label: "Paused", pct: 50, speed: null, eta: null });
  });
  test("processing is its own stage with no percentage, so 100% never shows before the server confirms", () => {
    const f = uploadFigures({ kind: "uploading", progress: 1, eta: null, info: info("processing") });
    expect(f.stage).toBe("processing");
    expect(f.pct).toBeNull();
    expect(f.indeterminate).toBe(true);
    expect(f.speed).toBeNull();
  });
  test("done is 100 and labelled Uploaded only on the server's word; before that the number stops at 99", () => {
    expect(uploadFigures({ kind: "done" })).toMatchObject({ stage: "done", label: "Uploaded", pct: 100 });
    expect(uploadFigures({ kind: "uploading", progress: 0.996, eta: 1, info: info("uploading") }).pct).toBe(99);
    expect(uploadFigures({ kind: "uploading", progress: 1, eta: null, info: info("finalizing") })).toMatchObject({ stage: "finalizing", pct: 99, indeterminate: true, speed: null });
  });
  test("a multipart upload keeps its parts count under the bar", () => {
    expect(uploadFigures({ kind: "uploading", progress: 0.3, eta: 42, info: info("uploading") }).parts).toBe("3 of 10 parts");
    expect(uploadFigures({ kind: "uploading", progress: 0, eta: null, info: info("preparing") }).parts).toBeNull();
  });
  test("reconnecting reads as offline when the browser is offline", () => {
    expect(uploadFigures({ kind: "uploading", progress: 0.2, eta: null, info: info("reconnecting") }, false).stage).toBe("offline");
    expect(uploadFigures({ kind: "uploading", progress: 0.2, eta: null, info: info("reconnecting") }, true).stage).toBe("reconnecting");
    expect(uploadFigures({ kind: "failed", message: "x" }, false).label).toBe("Offline");
  });
  test("the format fact is the container, from the type or the name", () => {
    expect(fileFormat("video/mp4", "a.mov")).toBe("MP4");
    expect(fileFormat("video/quicktime", "a.mov")).toBe("MOV");
    expect(fileFormat("video/x-matroska", "a")).toBe("MKV");
    expect(fileFormat(null, "clip.WEBM")).toBe("WEBM");
    expect(fileFormat("", "noext")).toBeNull();
  });
});

describe("1212 Step 1 screen", () => {
  const ws = src("components/create/CreateWorkspace.tsx");
  const card = src("components/create/UploadCard.tsx");
  test("the heading and the subtitle are the agreed words", () => {
    expect(ws).toContain('Let&apos;s start with <span className="accent-serif energy-text">your video.</span>');
    expect(ws).toContain("Upload your content. Outlly will prepare it for Reels, Shorts, and other supported platforms. You&apos;ll review everything before publishing.");
  });
  test("the tips fold into one panel, closed by default, with the server's own size limit", () => {
    expect(ws).toContain("<UploadTips limits={limits} limitsFailed={limitsFailed}");
    expect(ws).not.toContain("Tips for a smooth upload");
    expect(card).toContain('<details data-testid="upload-tips"');
    expect(card).not.toContain("<details open");
    expect(card).toContain("limitFacts(limits)");
    expect(card).toMatch(/File size", v: facts\.size/);
  });
  test("the card gets the format and leads with one percentage", () => {
    expect(ws).toContain("mimeType={meta.mimeType}");
    expect(card).toContain('data-testid="upload-progress"');
    expect(card).toContain('data-testid="upload-detail"');
    expect(card).toContain("const fig = uploadFigures(upload, online)");
    expect(card).toContain('upload.kind === "done" ? "Ready for your story."');
  });
  test("the bar says the video is in once the server confirms it, and only then", () => {
    expect(barState({ ...base, step: "video", upload: "done" }).note).toBe("Your video is in. Continue to your story.");
    expect(barState({ ...base, step: "video", upload: "done", activity: "Captions are on their way" }).note).toBe("Captions are on their way");
    expect(barState({ ...base, step: "video", upload: "uploading", progress: 0.5 }).note).toContain("uploading (50%)");
    expect(barState({ ...base, step: "video" }).note).toBeNull();
  });
  test("the stepper: lime for the current step, deep green with a check once done", () => {
    const sp = src("components/create/StepProgress.tsx");
    expect(sp).toContain('on ? "lime-bg ring-2 ring-[hsl(var(--lime)/0.35)]" : done ? "bg-[#173A24] text-white"');
    expect(sp).toContain("<Lock");
  });
});

describe("1212 publishing success screen", () => {
  const pv = src("components/create/PublishingView.tsx");
  test("See your content and Create another appear once, top right, under the stepper", () => {
    expect(pv.match(/See your content/g)?.length).toBe(1);
    expect(pv.match(/Create another/g)?.length).toBe(1);
    expect(pv.indexOf('data-testid="pub-actions"')).toBeLessThan(pv.indexOf('data-testid="pub-header"'));
    expect(pv).not.toContain("Start the next one while this sends</Button>\n          </>");
  });
  test("the order: heading and status, actions, You're live block, preview, the existing Live Activity, What happened", () => {
    const at = (s: string) => {
      const i = pv.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const stage = at("<p className=\"text-[22px] font-semibold leading-tight tracking-[-0.02em]\">{stage}</p>");
    const actions = at("{actions}");
    const header = at('data-testid="pub-header"');
    const preview = at('{!active && <PublishedPreview post={post} trackerOf={trackerOf} className="lg:col-start-2 lg:row-start-1" />}');
    const live = at("<ul aria-label={postWords(post.format).where}");
    const what = at('{!active && <WhatHappened post={post} className="lg:col-start-1 lg:row-start-2" />}');
    expect(stage).toBeLessThan(actions);
    expect(actions).toBeLessThan(header);
    expect(header).toBeLessThan(preview);
    expect(preview).toBeLessThan(live);
    expect(live).toBeLessThan(what);
  });
  test("the Live Activity component is rendered once, untouched, in its list", () => {
    expect(pv.match(/<LiveActivity key=\{t\.id\}/g)?.length).toBe(1);
    expect(pv).toContain("function LiveActivity({ t, i, lt, now, usually, post, busy, onRetry, onStop, canRetry, reduce }");
    // retry stays on the Live Activity cards only (audit-content counts exactly two).
    expect(pv.match(/onClick=\{onRetry\}/g)?.length).toBe(2);
  });
  test("the words: You're live! with a count and the short message; a link only when the platform sent one", () => {
    expect(pv).toContain('out.allDone ? "You\'re live!"');
    expect(pv).toContain('"Your content is now published. Go say hi in the comments."');
    expect(pv).toContain("{live && t.url && (");
    expect(pv).toContain("whenLabel(t.publishedAt)");
    expect(pv).toContain("<StatusBadge status={t.status}");
    expect(pv).toContain("<Pip size={68}");
  });
  test("whenLabel is honest about missing or broken times", () => {
    expect(whenLabel(null)).toBeNull();
    expect(whenLabel("nope")).toBeNull();
    const now = new Date(2026, 10, 19, 16, 12);
    expect(whenLabel(new Date(2026, 10, 19, 9, 5).toISOString(), now)).toMatch(/^Today, 9:05/);
    expect(whenLabel(new Date(2026, 10, 18, 9, 5).toISOString(), now)).toMatch(/^18 Nov, 9:05/);
  });
  test("no em dashes in the touched files", () => {
    for (const f of ["components/create/PublishingView.tsx", "components/create/UploadCard.tsx", "components/create/CreateWorkspace.tsx", "components/create/StepProgress.tsx", "components/create/ActionBar.tsx"]) {
      expect(src(f)).not.toContain("\u2014");
    }
  });
});
