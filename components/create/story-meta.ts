import { PLATFORMS, type Platform } from "@/lib/domain";
import { ADAPT_MAX } from "@/lib/ai/adapt-core";

/**
 * R1209 A1: Your Story asks one question, "who writes my caption, Outlly or me?". The open mode's box IS the main
 * caption (the draft's story field, the one Everywhere writes every platform from); everything else Step 2 keeps
 * lives here, saved with the draft as one JSON string (Post.storyMeta on Outlly, storyMeta on the device copy), so
 * switching modes, reloading or opening the draft elsewhere loses neither box and never reads the video again.
 * Pure: no React, no fetch, tested directly (tests/round-1209-a1-modes.test.ts).
 */
export type CaptionMode = "generate" | "own";

export interface StoryMeta {
  mode: CaptionMode;
  /** The Generate with Outlly box, as last left. While that mode is open the main caption stands in for it. */
  generated: string;
  /** Outlly's latest caption for this video, untouched: "Restore original" brings it back. */
  original: string;
  /** The Write my own box, as last left. */
  own: string;
  /** The creator's words just before they accepted a rewrite, so going back is one tap. */
  before: string;
  /** The last rewrite the creator accepted. */
  accepted: string;
  /** What Outlly saw in the video, sent along when the platform captions are written, so the video is read once. */
  seen: string;
  /** Per platform: the key of the main caption its caption was last written from (captionKey, never the words). */
  from: Partial<Record<Platform, string>>;
}

/** The server's cap on the saved string (lib/validation storyMeta). */
export const META_MAX = 20_000;
const SEEN_MAX = 1_000;

export const emptyMeta = (mode: CaptionMode = "generate"): StoryMeta => ({ mode, generated: "", original: "", own: "", before: "", accepted: "", seen: "", from: {} });

/** A draft with no meta yet: words already there are the creator's own; a new one starts with Outlly writing. */
export function startMeta(raw: unknown, story: string | null | undefined): StoryMeta {
  const m = parseMeta(raw);
  if (m) return m;
  const s = story ?? "";
  return s.trim() ? { ...emptyMeta("own"), own: s } : emptyMeta("generate");
}

/** FNV-1a (32 bit) of the trimmed caption, in base 36: a short, stable key, so the saved meta never repeats the caption. */
export function captionKey(text: string): string {
  const s = text.trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const str = (v: unknown, max = ADAPT_MAX) => (typeof v === "string" ? v.slice(0, max) : "");
const KEY = /^[0-9a-z]{1,8}$/;

/** A saved meta (string or object) back to a StoryMeta; anything unreadable is null, so the draft starts fresh. */
export function parseMeta(raw: unknown): StoryMeta | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const x = o as Record<string, unknown>;
  const from: Partial<Record<Platform, string>> = {};
  if (x.from && typeof x.from === "object") {
    for (const p of PLATFORMS) {
      const v = (x.from as Record<string, unknown>)[p];
      if (typeof v === "string" && KEY.test(v)) from[p] = v;
    }
  }
  return {
    mode: x.mode === "own" ? "own" : "generate",
    generated: str(x.generated),
    original: str(x.original),
    own: str(x.own),
    before: str(x.before),
    accepted: str(x.accepted),
    seen: str(x.seen, SEEN_MAX),
    from,
  };
}

/** The open box holds the main caption: this puts it in its mode's slot. */
export function withCaption(m: StoryMeta, caption: string): StoryMeta {
  return m.mode === "generate" ? (m.generated === caption ? m : { ...m, generated: caption }) : m.own === caption ? m : { ...m, own: caption };
}

/** The meta as saved: the open box from the caption itself, and under the cap however long the words are. */
export function serializeMeta(m: StoryMeta, caption: string): string {
  const out = withCaption(m, caption);
  let s = JSON.stringify(out);
  // Least needed first: the rewrite history, then Outlly's untouched copy. Both boxes always fit (ADAPT_MAX each).
  for (const drop of ["accepted", "before", "original", "seen"] as const) {
    if (s.length <= META_MAX) break;
    s = JSON.stringify({ ...JSON.parse(s), [drop]: "" });
  }
  return s;
}

/** Switching keeps both: the open box's words go to its slot and the other mode's words come back as the caption. */
export function switchMode(m: StoryMeta, caption: string, to: CaptionMode): { meta: StoryMeta; caption: string } {
  if (m.mode === to) return { meta: m, caption };
  const kept = withCaption(m, caption);
  return { meta: { ...kept, mode: to }, caption: to === "generate" ? kept.generated : kept.own };
}

/**
 * Outlly's caption for the video just landed. Into the Generate box when that box is empty or still Outlly's last
 * one; over words the creator edited it is offered instead (`offer`), never written in. It is always the new
 * original, and what Outlly saw is kept for the platform captions.
 */
export function takeGenerated(m: StoryMeta, caption: string, text: string, seen?: string): { meta: StoryMeta; caption: string; offer: boolean } {
  const s = text.trim().slice(0, ADAPT_MAX);
  const box = (m.mode === "generate" ? caption : m.generated).trim();
  const untouched = !box || box === m.original.trim();
  const base: StoryMeta = { ...m, original: s, seen: seen?.trim() ? seen.trim().slice(0, SEEN_MAX) : m.seen };
  if (!untouched) return { meta: m.mode === "generate" ? { ...base, generated: caption } : base, caption, offer: m.mode === "generate" };
  return m.mode === "generate" ? { meta: { ...base, generated: s }, caption: s, offer: false } : { meta: { ...base, generated: s }, caption, offer: false };
}

/** A rewrite the creator accepted: the words they had are kept, so "Back to my words" is one tap. */
export function acceptRewrite(m: StoryMeta, from: string, text: string): StoryMeta {
  return { ...m, before: from, accepted: text };
}

/** Each place whose caption was written from an older main caption (a Stop part way included) is written again; the rest keep their words and approvals. */
export function staleFor(from: Partial<Record<Platform, string>>, places: readonly Platform[], caption: string, fallback: (p: Platform) => boolean): Platform[] {
  const key = captionKey(caption);
  return places.filter((p) => (from[p] ? from[p] !== key : fallback(p)));
}
