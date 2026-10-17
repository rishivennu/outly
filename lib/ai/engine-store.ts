import "server-only";
import { db } from "../db";
import { DEFAULT_RULES, ENGINE_KEY, mergeRules, type EngineRules } from "./caption-engine";
import { DEFAULT_SUBTITLE_RULES, mergeSubtitleRules, SUBTITLE_KEY, type SubtitleRules } from "../captions/subtitle-engine";

/**
 * Caption engine rules live in the Setting table (Supabase Postgres in production) under ENGINE_KEY, so
 * they can be tuned without a deploy. First read seeds the row from the code defaults. Cached for 5 min
 * per server instance; any database trouble falls back to the defaults, never blocks a caption.
 */
let cache: { at: number; rules: EngineRules } | null = null;
const TTL = 5 * 60_000;

export async function captionRules(): Promise<EngineRules> {
  if (cache && Date.now() - cache.at < TTL) return cache.rules;
  let rules = DEFAULT_RULES;
  try {
    const row = await db.setting.findUnique({ where: { key: ENGINE_KEY } });
    if (row) rules = mergeRules(JSON.parse(row.value));
    else await db.setting.create({ data: { key: ENGINE_KEY, value: JSON.stringify(DEFAULT_RULES) } }).catch(() => null);
  } catch {
    rules = DEFAULT_RULES;
  }
  cache = { at: Date.now(), rules };
  return rules;
}

/** Replace the stored rules (validated through mergeRules) and reset the cache. */
export async function saveCaptionRules(input: unknown): Promise<EngineRules> {
  const rules = mergeRules(input);
  await db.setting.upsert({ where: { key: ENGINE_KEY }, update: { value: JSON.stringify(rules) }, create: { key: ENGINE_KEY, value: JSON.stringify(rules) } });
  cache = { at: Date.now(), rules };
  return rules;
}

/* Subtitle engine (FunClip-style): same storage and caching as the caption rules, its own row. */
let subCache: { at: number; rules: SubtitleRules } | null = null;

export async function subtitleRules(): Promise<SubtitleRules> {
  if (subCache && Date.now() - subCache.at < TTL) return subCache.rules;
  let rules = DEFAULT_SUBTITLE_RULES;
  try {
    const row = await db.setting.findUnique({ where: { key: SUBTITLE_KEY } });
    if (row) rules = mergeSubtitleRules(JSON.parse(row.value));
    else await db.setting.create({ data: { key: SUBTITLE_KEY, value: JSON.stringify(DEFAULT_SUBTITLE_RULES) } }).catch(() => null);
  } catch {
    rules = DEFAULT_SUBTITLE_RULES;
  }
  subCache = { at: Date.now(), rules };
  return rules;
}

export async function saveSubtitleRules(input: unknown): Promise<SubtitleRules> {
  const rules = mergeSubtitleRules(input);
  await db.setting.upsert({ where: { key: SUBTITLE_KEY }, update: { value: JSON.stringify(rules) }, create: { key: SUBTITLE_KEY, value: JSON.stringify(rules) } });
  subCache = { at: Date.now(), rules };
  return rules;
}
