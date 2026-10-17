/**
 * Caption engine (10-17). Platform rules, formulas, hooks and guard rails for AI captions, adapted from
 * "social-captions" v2.0.0 by Roman Knox (github.com/rediumvex/social-media-caption-generator-claude, MIT).
 * Pure module (no server-only) so tests can import it. The live copy of the rules is stored in the
 * Setting table (key ENGINE_KEY, Supabase Postgres in production) by lib/ai/engine-store.ts; the defaults
 * below seed it and are the fallback whenever the stored copy is missing or unreadable.
 */
import type { Platform } from "../domain";

export const ENGINE_KEY = "engine:captions";
export const ENGINE_VERSION = "social-captions-2.0/outlly-1";

export interface PlatformRule {
  label: string;
  /** Caption characters: [sweet spot low, sweet spot high, hard max] */
  length: [number, number, number];
  /** Hashtags allowed: [min, max] */
  tags: [number, number];
  /** YouTube only: title [sweet low, sweet high, hard max] and description [low, high] */
  title?: [number, number, number];
  description?: [number, number];
  signal: string;
  rules: string[];
}

export interface EngineRules {
  version: string;
  platforms: Record<Platform, PlatformRule>;
  formulas: string[];
  hooks: string[];
  bannedTags: string[];
  bait: string[];
  fbTriggers: Record<string, string>;
  checklist: string[];
}

export const DEFAULT_RULES: EngineRules = {
  version: ENGINE_VERSION,
  platforms: {
    instagram: {
      label: "Instagram Reels",
      length: [80, 200, 2200],
      tags: [3, 5],
      signal: "DM shares, then saves",
      rules: [
        "Hook in the first 125 characters; it stops the scroll in 5-10 words (conflict, transformation, curiosity gap, bold statement or a striking number).",
        "Hook, then 1-2 sentences, then ONE call to action that asks for a DM share (\"send this to a friend who...\") or a save.",
        "Primary keyword in the first 2 sentences. No emoji in the first line.",
      ],
    },
    tiktok: {
      label: "TikTok",
      length: [100, 300, 2200],
      tags: [3, 5],
      signal: "completion rate (70%+)",
      rules: [
        "First 80 characters carry the hook and the primary keyword (they show before truncation).",
        "Hook, 1-2 short sentences, then a question CTA. Tease why watching to the end pays off.",
        "Hashtags: 1 niche + 1 thematic + 1 trending-in-niche.",
      ],
    },
    youtube: {
      label: "YouTube Shorts",
      length: [150, 300, 5000],
      tags: [3, 5],
      title: [40, 70, 100],
      description: [150, 300],
      signal: "search (title SEO) and retention",
      rules: [
        "Title is a search headline: primary keyword first, then the benefit or a curiosity gap. Never misleading; it must match the video exactly.",
        "Title formulas: \"[Keyword]: [what viewer gets]\", \"How to [result] in [time]\", \"Why [common belief] is wrong\".",
        "Description: first 100 characters front-load the hook (repeat or expand the title), 1-2 sentences of value, a subscribe CTA, hashtags at the end.",
        "Hashtags: 1 broad + 1-2 niche + 1 topic. #Shorts may be added but never as the only tag.",
      ],
    },
    x: {
      label: "X",
      length: [70, 240, 280],
      tags: [0, 0],
      signal: "replies and reposts",
      rules: [
        "One idea, said sharply. Reads like a person, not a brand.",
        "End with a reason to reply (a take to argue with, or a question). No hashtags.",
      ],
    },
    threads: {
      label: "Threads",
      length: [100, 280, 500],
      tags: [0, 1],
      signal: "replies",
      rules: [
        "One clear idea in a conversational tone, like a group chat.",
        "Provoke a real conversation; never copy another platform's caption.",
        "At most 1 topic tag, niche over broad.",
      ],
    },
    facebook: {
      label: "Facebook",
      length: [40, 80, 2000],
      tags: [0, 2],
      signal: "meaningful comments",
      rules: [
        "Ultra short for reach: hook, value, then a discussion question.",
        "Zero trigger words (buy now, limited time, FREE in caps, click here, money, income, contest, giveaway).",
      ],
    },
    linkedin: {
      label: "LinkedIn",
      length: [150, 600, 3000],
      tags: [0, 3],
      signal: "comments and dwell time",
      rules: [
        "Lead with the lesson in the first line (the part shown before \"see more\").",
        "Short paragraphs with line breaks, a practical takeaway, then an open question for peers.",
      ],
    },
  },
  formulas: [
    "Trend-Hook + Benefit: \"[Trend]: [benefit] for [audience]\"",
    "Curiosity X vs Y: \"[A] vs [B]: which works better for [situation]?\"",
    "Myth Buster: \"Myth: [belief]. Fact: [rebuttal]\"",
    "Data Teaser: \"[Number] -> [result] in [timeframe]\"",
    "What Works Now: \"What works in [niche] right now: [1], [2], [3]\"",
    "Watch Time Promise: \"In [time] you'll get [result]. Watch till the end for [bonus]\"",
    "Beginner's Path: \"New to [field]: [step 1] -> [step 2] -> [step 3]\"",
    "Micro-Decision: \"Are you [A] or [B]? And why?\"",
    "Hot Take: \"Unpopular opinion: [thesis]. Agree or disagree?\"",
    "This or That: \"[A] or [B] for [situation]? Your pick?\"",
    "Objection Destroyer: \"Think '[objection]'? Actually, [counter]\"",
    "Series: \"Day [1/N] of [topic]. Follow for the rest\"",
  ],
  hooks: [
    "Provocation: \"Stop [doing X], here's why\" / \"You're doing [X] wrong\"",
    "Curiosity: \"Here's what no one tells you about [topic]\" / \"I tested [N] methods. These [N] won\"",
    "Value: \"Save this for when [situation]\" / \"[N] things I wish I knew before [X]\"",
    "Emotion: \"Honest truth about [topic]\" / \"One change flipped everything\"",
    "Short-video: \"Stop scrolling if you [situation]\" / \"POV: you just discovered [thing]\"",
  ],
  bannedTags: ["fyp", "foryou", "foryoupage", "viral", "instagood", "like4like", "likeforlike", "follow4follow", "followforfollow", "reelsdaily", "explorepage", "trending"],
  bait: ["like if you agree", "comment yes", "tag 3 friends", "tag three friends", "tag a friend", "share before they delete", "react with", "double tap if", "smash that like"],
  fbTriggers: {
    "buy now": "available today",
    "limited time": "this week",
    "click here": "learn more",
    "giveaway": "community pick",
    "contest": "challenge",
    "free": "no cost",
  },
  checklist: [
    "Hook in the first 80-125 characters.",
    "1-3 search keywords worked in naturally.",
    "ONE clear call to action.",
    "2-3 power words at most (proven, tested, honest, behind-the-scenes, unlock...).",
    "Short paragraphs with line breaks, never a wall of text.",
    "A DIFFERENT formula on every platform.",
  ],
};

/** Stored rules can be old or hand-edited: keep any valid parts, fill the rest from the defaults. */
export function mergeRules(stored: unknown): EngineRules {
  if (!stored || typeof stored !== "object") return DEFAULT_RULES;
  const s = stored as Partial<EngineRules>;
  const list = (v: unknown, d: string[]) => (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length ? (v as string[]) : d);
  const platforms = { ...DEFAULT_RULES.platforms };
  if (s.platforms && typeof s.platforms === "object") {
    for (const p of Object.keys(platforms) as Platform[]) {
      const r = (s.platforms as Record<string, Partial<PlatformRule>>)[p];
      if (!r || typeof r !== "object") continue;
      const d = platforms[p];
      const tuple = <T extends number[]>(v: unknown, dv: T): T => (Array.isArray(v) && v.length === dv.length && v.every((n) => Number.isFinite(n) && n >= 0) ? (v as T) : dv);
      platforms[p] = {
        ...d,
        label: typeof r.label === "string" && r.label ? r.label : d.label,
        signal: typeof r.signal === "string" && r.signal ? r.signal : d.signal,
        rules: list(r.rules, d.rules),
        length: tuple(r.length, d.length),
        tags: tuple(r.tags, d.tags),
        ...(d.title ? { title: tuple(r.title, d.title) } : {}),
        ...(d.description ? { description: tuple(r.description, d.description) } : {}),
      };
    }
  }
  const triggers = s.fbTriggers && typeof s.fbTriggers === "object" && Object.values(s.fbTriggers).every((v) => typeof v === "string") ? (s.fbTriggers as Record<string, string>) : DEFAULT_RULES.fbTriggers;
  return {
    version: typeof s.version === "string" && s.version ? s.version : DEFAULT_RULES.version,
    platforms,
    formulas: list(s.formulas, DEFAULT_RULES.formulas),
    hooks: list(s.hooks, DEFAULT_RULES.hooks),
    bannedTags: list(s.bannedTags, DEFAULT_RULES.bannedTags),
    bait: list(s.bait, DEFAULT_RULES.bait),
    fbTriggers: triggers,
    checklist: list(s.checklist, DEFAULT_RULES.checklist),
  };
}

/** System prompt: the whole playbook, only for the platforms being written. */
export function enginePrompt(rules: EngineRules, platforms: Platform[]): string {
  const blocks = platforms.map((p) => {
    const r = rules.platforms[p];
    const lines = [
      `### ${p} (${r.label}) - optimise for ${r.signal}`,
      `- Caption length: ${r.length[0]}-${r.length[1]} characters (never over ${r.length[2]}).`,
      r.tags[1] === 0 ? "- No hashtags." : `- Hashtags: ${r.tags[0]}-${r.tags[1]}, niche and specific to this video.`,
      ...(r.title ? [`- Title: ${r.title[0]}-${r.title[1]} characters (max ${r.title[2]}).`] : []),
      ...(r.description ? [`- Description: ${r.description[0]}-${r.description[1]} characters.`] : []),
      ...r.rules.map((x) => `- ${x}`),
    ];
    return lines.join("\n");
  });
  return [
    "You write algorithm-aware captions for short-form video. Every platform rewards a different signal; the strongest is shares/DM sends, then saves, then comments, then watch time; likes are the weakest.",
    "## Platform rules (follow exactly)",
    ...blocks,
    "## Formulas (use a DIFFERENT one for each platform)",
    ...rules.formulas.map((f) => `- ${f}`),
    "## Hook types",
    ...rules.hooks.map((h) => `- ${h}`),
    "## Never",
    `- Engagement bait: ${rules.bait.map((b) => `"${b}"`).join(", ")}.`,
    `- These hashtags: ${rules.bannedTags.map((t) => "#" + t).join(" ")}. Never more than 5 hashtags. Never the same tag set on every platform.`,
    "- Shadow-ban triggers: violent or adult words, financial promises (guaranteed income, get rich quick). Letter swaps do not help.",
    "- Facebook trigger words: " + Object.keys(rules.fbTriggers).join(", ") + ".",
    "- Em dashes, walls of text, made-up facts or numbers that are not in the story.",
    "## Before answering, check",
    ...rules.checklist.map((c) => `- ${c}`),
  ].join("\n");
}

export interface EngineWhy {
  formula: string;
  hook: string;
  cta: string;
  signal: string;
}

export interface EngineCopy {
  title?: string;
  caption: string;
  description?: string;
  hashtags: string;
}

const cut = (s: string, max: number) => {
  if (s.length <= max) return s;
  const c = s.slice(0, max - 1);
  const sp = c.lastIndexOf(" ");
  return (sp > max * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;:.-]+$/, "") + "…";
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Last-line guard rails on whatever the model (or the offline writer) produced: drop banned and extra
 * hashtags, strip engagement-bait lines, swap Facebook trigger words, no em dashes, hard length caps.
 * Returns the cleaned copy and what was changed, in plain words.
 */
export function polish(platform: Platform, input: EngineCopy, rules: EngineRules = DEFAULT_RULES): { copy: EngineCopy; fixes: string[] } {
  const r = rules.platforms[platform];
  const fixes: string[] = [];
  let copy = input;
  const banned = new Set(rules.bannedTags.map((t) => t.toLowerCase()));

  // Models often repeat the tags as the last line of the text; those belong in the hashtags field only.
  const moved: string[] = [];
  const unTag = (s: string | undefined) => {
    if (!s) return s;
    const lines = s.trimEnd().split("\n");
    while (lines.length && /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(lines[lines.length - 1])) moved.unshift(...lines.pop()!.trim().split(/\s+/));
    return lines.join("\n").trimEnd();
  };
  copy = { ...copy, caption: unTag(copy.caption) ?? "", description: unTag(copy.description) };

  const seen = new Set<string>();
  const all = [...copy.hashtags.split(/\s+/), ...moved].filter((t) => /^#[\p{L}\p{N}_]+$/u.test(t));
  const kept = all.filter((t) => {
    const k = t.slice(1).toLowerCase();
    if (banned.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (kept.length < all.length) fixes.push("Removed hashtags that hurt reach");
  // #Shorts never counts as the only YouTube tag; keep it last.
  let tags = kept;
  if (platform === "youtube") {
    const shorts = tags.find((t) => t.toLowerCase() === "#shorts");
    tags = tags.filter((t) => t.toLowerCase() !== "#shorts");
    tags = tags.slice(0, r.tags[1] - (shorts ? 1 : 0));
    if (shorts && tags.length) tags.push(shorts);
  } else if (tags.length > r.tags[1]) {
    tags = tags.slice(0, r.tags[1]);
    fixes.push(r.tags[1] === 0 ? "Dropped hashtags" : `Kept the best ${r.tags[1]} hashtags`);
  }

  const clean = (s: string | undefined) => {
    if (!s) return s;
    let out = s.replace(/\s*[—–]\s*/g, ", ");
    const lines = out.split("\n");
    const noBait = lines.filter((l) => !rules.bait.some((b) => l.toLowerCase().includes(b)));
    if (noBait.length < lines.length) fixes.push("Removed engagement bait");
    out = noBait.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (platform === "facebook") {
      for (const [w, safe] of Object.entries(rules.fbTriggers)) {
        const re = new RegExp(`\\b${escapeRe(w)}\\b`, w === "free" ? "g" : "gi");
        // "free" only as a shouted word or a price claim, so "feel free" stays.
        const target = w === "free" ? /\bFREE\b|\b[Ff]ree (?=(?:trial|download|gift|money|course|access)\b)/g : re;
        if (target.test(out)) {
          out = out.replace(target, (m: string, ...a: unknown[]) => {
            const at = a.find((x) => typeof x === "number") as number;
            const start = at === 0 || /[.!?]\s+$|\n\s*$/.test(out.slice(Math.max(0, at - 3), at));
            return start ? safe.charAt(0).toUpperCase() + safe.slice(1) : safe;
          });
          fixes.push("Swapped words Facebook limits");
        }
      }
    }
    return out;
  };

  let caption = clean(copy.caption) ?? "";
  if (caption.length > r.length[2]) {
    caption = cut(caption, r.length[2]);
    fixes.push("Trimmed to fit");
  }
  let title = clean(copy.title);
  if (title && r.title && title.length > r.title[2]) {
    title = cut(title, r.title[2]);
    fixes.push("Trimmed the title");
  }
  const description = clean(copy.description);
  return { copy: { ...copy, caption, title, description, hashtags: tags.join(" ") }, fixes: [...new Set(fixes)] };
}

/** "Formula · optimised for" line for the platform card. */
export function whyLine(w: EngineWhy | undefined): string {
  if (!w || !w.formula) return "";
  return [w.formula, w.hook && `${w.hook} hook`, w.signal && `optimised for ${w.signal}`].filter(Boolean).join(" · ");
}
