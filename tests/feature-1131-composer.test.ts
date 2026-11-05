/** 1131: the Story / photo / carousel composer's pure parts: the launch gate and the browser-side crop. */
import { describe, expect, test } from "bun:test";
import { formatGate, hashtagCount, shapeOk, type GateSlide } from "../components/create/format-gate";
import { cropBox, looksLikePhoto, outSize } from "../lib/client/image";

const img = (w = 1080, h = 1350, status: GateSlide["status"] = "done"): GateSlide => ({ mimeType: "image/jpeg", size: 400_000, width: w, height: h, status });
const vid = (duration = 20, status: GateSlide["status"] = "done"): GateSlide => ({ mimeType: "video/mp4", size: 8e6, duration, width: 1080, height: 1920, status });
const copy = { caption: "", hashtags: "" };
const on = { connected: true };

describe("launch gate", () => {
  test("a ready Story, photo and carousel pass", () => {
    expect(formatGate("story", [vid(30)], copy, on).ready).toBe(true);
    expect(formatGate("photo", [img()], { caption: "hi", hashtags: "#a" }, on).ready).toBe(true);
    expect(formatGate("carousel", [img(), img(), vid(30)], copy, on).ready).toBe(true);
  });
  test("blocks while uploading, after a failed upload, and with nothing picked", () => {
    expect(formatGate("photo", [img(1080, 1350, "working")], copy, on).errors[0]).toContain("Still uploading");
    expect(formatGate("photo", [img(1080, 1350, "failed")], copy, on).errors[0]).toContain("didn't upload");
    expect(formatGate("carousel", [], copy, on).errors[0]).toContain("at least 2");
  });
  test("blocks without Instagram connected", () => {
    const g = formatGate("story", [img(1080, 1920)], copy, { connected: false });
    expect(g.ready).toBe(false);
    expect(g.errors).toContain("Connect your Instagram account to post.");
  });
  test("caption limits count for photos and carousels, never for a Story", () => {
    const long = { caption: "x".repeat(2199), hashtags: "#a" };
    expect(formatGate("photo", [img()], long, on).errors[0]).toContain("2200");
    expect(formatGate("story", [img(1080, 1920)], long, on).ready).toBe(true);
    const tags = { caption: "", hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") };
    expect(formatGate("photo", [img()], tags, on).errors[0]).toContain("31 hashtags");
    expect(hashtagCount("#a b #c#d e# #")).toBe(2);
  });
  test("a carousel slide of another shape is a warning, not a stop", () => {
    const g = formatGate("carousel", [img(1080, 1080), img(1080, 1350)], copy, on);
    expect(g.ready).toBe(true);
    expect(g.warnings.length).toBe(1);
  });
  test("the shapes the save route accepts", () => {
    expect(shapeOk("story", 1)).toBe(true);
    expect(shapeOk("story", 2)).toBe(false);
    expect(shapeOk("photo", 0)).toBe(false);
    expect(shapeOk("carousel", 1)).toBe(false);
    expect(shapeOk("carousel", 20)).toBe(true);
    expect(shapeOk("carousel", 21)).toBe(false);
  });
});

describe("browser crop", () => {
  test("feed photos are centre-cropped into 4:5 to 1.91:1; Stories are never cropped", () => {
    expect(cropBox(1080, 1920, "feed")).toEqual({ x: 0, y: 285, w: 1080, h: 1350 });
    expect(cropBox(3000, 1000, "feed")).toEqual({ x: 545, y: 0, w: 1910, h: 1000 });
    expect(cropBox(1200, 1200, "feed")).toEqual({ x: 0, y: 0, w: 1200, h: 1200 });
    expect(cropBox(1080, 1920, "story")).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
  test("scaled down to Instagram's sizes, never up", () => {
    expect(outSize(4032, 5040, "feed")).toEqual({ w: 1440, h: 1800 });
    expect(outSize(800, 1000, "feed")).toEqual({ w: 800, h: 1000 });
    expect(outSize(2160, 3840, "story")).toEqual({ w: 1080, h: 1920 });
  });
  test("knows a photo by type or name", () => {
    expect(looksLikePhoto({ type: "image/png", name: "a" })).toBe(true);
    expect(looksLikePhoto({ type: "", name: "IMG_1.HEIC" })).toBe(true);
    expect(looksLikePhoto({ type: "video/mp4", name: "a.mp4" })).toBe(false);
  });
});
