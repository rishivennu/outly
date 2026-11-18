/**
 * 1190 "Write once. Outlly adapts it everywhere." The pure half, shared by the page, the route and the tests:
 * pulling the composer's CTA and Keywords lines apart from the message, telling a long video from a Short,
 * the short question Pip asks when there is too little to go on, and the faithful no-AI version
 * ("Use my text as is", and the fallback when every model is busy). Nothing here adds a fact, a number,
 * a promise or an event the creator did not write.
 */
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { composedCopy } from "@/lib/client/checks";
import { DEFAULT_RULES, type EngineRules } from "@/lib/ai/caption-engine";
import type { PlatformCopy } from "@/components/create/types";

/** Past this a video is long-form: YouTube treats it as a regular video, not a Short, and Pip only watches it when asked. */
export const LONG_FORM_SEC = 180;
export const ADAPT_MAX = 4000;

export type AdaptTone = "default" | "takeaway" | "hook" | "professional" | "conversational" | "shorter";

/** Pip's contextual asks on Your Story. Each one rewrites every place from the same words, in that direction. */
export const ADAPT_TONES: { id: Exclude<AdaptTone, "default">; label: string; line: string }[] = [
  { id: "takeaway", label: "Make the main takeaway clearer", line: "Lead with the creator's main takeaway in plain words, so a viewer gets the point in one read." },
  { id: "hook", label: "Give it a more engaging hook", line: "Open with a sharper, more engaging first line, built only from the creator's own words and facts." },
  { id: "professional", label: "Make it more professional", line: "Polished and credible. No slang, no emoji." },
  { id: "conversational", label: "Make it more conversational", line: "Warm and conversational, like telling a friend." },
  { id: "shorter", label: "Make it shorter", line: "About half the usual length on every platform, still complete and still true to the message." },
];
export const toneLine = (t: AdaptTone | undefined) => ADAPT_TONES.find((x) => x.id === t)?.line ?? "";

export const CTA_PREFIX = "CTA: ";
export const KEYWORDS_PREFIX = "Keywords: ";

export interface StoryParts {
  /** The message itself, without the labelled lines. */
  body: string;
  /** What the creator wants people to do, when they said. */
  cta: string;
  keywords: string[];
}

const CTA_LINE = /^\s*(?:cta|call to action)\s*[:：]\s*(.*)$/i;
const KW_LINE = /^\s*(?:keywords?|tags?|hashtags?)\s*[:：]\s*(.*)$/i;

/** The composer's "CTA:" and "Keywords:" lines, pulled apart from the message. */
export function splitStory(text: string): StoryParts {
  const body: string[] = [];
  const cta: string[] = [];
  const kw: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const c = CTA_LINE.exec(line);
    const k = c ? null : KW_LINE.exec(line);
    if (c) c[1].trim() && cta.push(c[1].trim());
    else if (k) kw.push(...k[1].split(/[,;#、，]+/).map((s) => s.trim()).filter(Boolean));
    else body.push(line);
  }
  const seen = new Set<string>();
  const keywords = kw.filter((k) => {
    const key = k.toLowerCase();
    return !seen.has(key) && (seen.add(key), true);
  });
  return { body: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(), cta: cta.join(" "), keywords: keywords.slice(0, 12) };
}

const TAGS_LINE = /^\s*hashtags?\s*[:：]/i;

/**
 * R1206: "Suggest hashtags" on Your caption. The tags go on their own labelled line (the one already there is
 * replaced), so the words above stay exactly as written and Pip reads them as keywords for every platform.
 */
export function withHashtags(text: string, tags: string): string {
  const line = `Hashtags: ${tags.trim()}`;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => TAGS_LINE.test(l));
  if (at >= 0) return [...lines.slice(0, at), line, ...lines.slice(at + 1)].join("\n").slice(0, ADAPT_MAX);
  const base = text.replace(/\s+$/, "");
  return `${base}${base ? "\n" : ""}${line}`.slice(0, ADAPT_MAX);
}

/** Adds a labelled line (or puts the cursor on the one already there), for the composer's chips. */
export function withLine(text: string, prefix: string): { text: string; caret: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const re = prefix === CTA_PREFIX ? CTA_LINE : KW_LINE;
  let at = 0;
  for (const l of lines) {
    if (re.test(l)) return { text, caret: at + l.length };
    at += l.length + 1;
  }
  const base = text.replace(/\s+$/, "");
  const next = `${base}${base ? "\n" : ""}${prefix}`;
  return { text: next, caret: next.length };
}

/** A long video, or a horizontal one: on YouTube that is a regular video, never a Short. */
export function isLongForm(m: { duration?: number | null; width?: number | null; height?: number | null } | null | undefined) {
  if (!m) return false;
  if ((m.duration ?? 0) > LONG_FORM_SEC) return true;
  return !!(m.width && m.height && m.width > m.height);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * Too little to keep a meaning intact: Pip asks one short question instead of guessing. Counted in letters as
 * well as words, so a full sentence in a script written without spaces is never taken for a thin one.
 */
export function clarifyFor(text: string): string | null {
  const { body } = splitStory(text);
  if (words(body).length >= 4 || [...body].length >= 20) return null;
  return body
    ? "Tell me a little more so I keep your meaning: what happens in the video, or what should people take away from it?"
    : "What's the video about? A sentence or two in your own words is plenty.";
}

/** The first sentence, the creator's own words, for the one-line core message. */
export function firstSentence(text: string, max = 120) {
  const one = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?。！？])\s+/)[0] ?? "";
  return fit(one, max);
}

/** Cut on a word, never mid-word, with an ellipsis only when something was cut. */
export function fit(s: string, max: number) {
  const t = s.trim();
  if (t.length <= max) return t;
  const c = t.slice(0, Math.max(1, max - 1));
  const sp = c.lastIndexOf(" ");
  return (sp > max * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;:.-]+$/, "") + "…";
}

/** "budget travel" -> "#budgettravel". Letters and numbers in any script; nothing invented. */
export function tagsFrom(keywords: string[], max: number) {
  if (max <= 0) return "";
  const seen = new Set<string>();
  return keywords
    .map((k) => k.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((k) => k.length > 1 && !seen.has(k.toLowerCase()) && (seen.add(k.toLowerCase()), true))
    .slice(0, max)
    .map((k) => `#${k}`)
    .join(" ");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 75 -> "01:15", 3725 -> "1:02:05". The format YouTube reads as chapters. */
export function stamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** The subtitles as timestamped lines, so chapters can only ever point at moments that are really in the video. */
export function timedTranscript(cues: { start: number; text: string }[] | null | undefined, max = 6000) {
  if (!cues?.length) return "";
  let out = "";
  for (const c of cues) {
    const t = c.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const line = `${stamp(c.start)} ${t}\n`;
    if (out.length + line.length > max) break;
    out += line;
  }
  return out.trim();
}

const toSec = (t: string) => t.split(":").reduce((a, p) => a * 60 + Number(p), 0);

/**
 * Chapters a model proposed, kept only when YouTube would accept them and they are true to the video: the
 * first at 00:00, at least three, in order, ten seconds apart, inside the video, each at a moment the
 * transcript really has. Anything else is dropped, never repaired by guessing.
 */
export function cleanChapters(raw: unknown, transcript: string, duration: number | null | undefined): string {
  if (!Array.isArray(raw) || !transcript) return "";
  const real = new Set([...transcript.matchAll(/^(\d{1,2}(?::\d{2}){1,2})\s/gm)].map((m) => toSec(m[1])));
  real.add(0);
  const out: { at: number; title: string }[] = [];
  for (const c of raw) {
    const at = typeof c?.at === "string" && /^\d{1,2}(?::\d{2}){1,2}$/.test(c.at.trim()) ? toSec(c.at.trim()) : NaN;
    const title = typeof c?.title === "string" ? c.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!Number.isFinite(at) || !title) return "";
    if (!real.has(at) || (duration && at >= duration)) return "";
    if (out.length && at - out[out.length - 1].at < 10) return "";
    out.push({ at, title });
  }
  if (out.length < 3 || out[0].at !== 0) return "";
  return out.map((c) => `${stamp(c.at)} ${c.title}`).join("\n");
}

/** Long-form YouTube: a regular video, so the Shorts playbook (and #Shorts) is swapped for one that fits. */
export function longFormRules(r: EngineRules): EngineRules {
  return {
    ...r,
    platforms: {
      ...r.platforms,
      youtube: {
        ...r.platforms.youtube,
        label: "YouTube (long-form video, not a Short)",
        title: [45, 70, 100],
        description: [200, 1200],
        signal: "search (title SEO), click-through and watch time",
        rules: [
          "This is a regular long-form YouTube video, not a Short: never write #Shorts or call it a Short.",
          "Title is a search headline: primary keyword first, then the benefit. It must match the video exactly.",
          "Description: the first two lines say what the viewer gets, then 1-3 short paragraphs from the creator's text, then the creator's CTA if they gave one.",
          "Hashtags: 2-3 specific ones, at the end.",
        ],
      },
    },
  };
}

const NAME = (p: Platform) => PLATFORM_META[p].name;

/** Keep the composed post (body plus hashtags) inside the platform's real limit. */
function inLimit(p: Platform, c: PlatformCopy): PlatformCopy {
  const lim = PLATFORM_META[p].captionLimit;
  const d = { caption: c.caption, description: c.description ?? "", hashtags: c.hashtags };
  const over = composedCopy(p, d).length - lim;
  if (over <= 0) return c;
  if (p === "youtube") return { ...c, description: fit(c.description ?? "", Math.max(0, (c.description ?? "").length - over - 1)) };
  return { ...c, caption: fit(c.caption, Math.max(0, c.caption.length - over - 1)) };
}

/**
 * The creator's text fitted to each place without any AI: the same words, the CTA they wrote, hashtags only
 * from their own keywords, cut on a word where a place is shorter. "Use my text as is" and the busy-AI fallback.
 */
export function offlineAdapt(text: string, platforms: Platform[], opts: { longForm?: boolean; rules?: EngineRules } = {}): PlatformCopy[] {
  const rules = opts.rules ?? DEFAULT_RULES;
  const { body, cta, keywords } = splitStory(text);
  const msg = [body, cta].filter(Boolean).join("\n\n");
  return platforms.map((p): PlatformCopy => {
    const r = rules.platforms[p];
    const note = `Your words, fitted to ${NAME(p)}.`;
    if (p === "youtube") {
      // A Short keeps #Shorts, last and never alone with room to spare; a long video never gets it.
      const tags = [tagsFrom(keywords, r.tags[1] - (opts.longForm ? 0 : 1)), opts.longForm ? "" : "#Shorts"].filter(Boolean).join(" ");
      return inLimit(p, { platform: p, title: fit(firstSentence(body || cta, 100), r.title?.[2] ?? 100), caption: "", description: msg, hashtags: tags, note });
    }
    const tags = tagsFrom(keywords, r.tags[1]);
    if (p === "x") return { platform: p, caption: fit(msg.replace(/\n{2,}/g, "\n\n"), r.length[2]), hashtags: "", note };
    return inLimit(p, { platform: p, caption: fit(msg, r.length[2]), hashtags: tags, note });
  });
}

/** The fields a platform card shows, as one comparable string: "is this still Pip's version?" */
export const copyKey = (c: { title?: string; caption?: string; description?: string; hashtags?: string }) => [c.title ?? "", c.caption ?? "", c.description ?? "", c.hashtags ?? ""].map((s) => s.trim()).join("\u0000");
