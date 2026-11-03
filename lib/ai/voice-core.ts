/**
 * Voice memory (1096), pure part. A short list of captions the creator actually shipped, newest first,
 * turned into a style note for the caption and hook prompts. Nothing here trains a model; it's a prompt.
 */

export const VOICE_MAX = 8;
const MIN_LEN = 20;
const MAX_LEN = 600;

export interface VoiceState {
  on: boolean;
  samples: string[];
  updatedAt: string | null;
}

export const VOICE_EMPTY: VoiceState = { on: true, samples: [], updatedAt: null };

export function parseVoice(raw: string | null | undefined): VoiceState {
  if (!raw) return { ...VOICE_EMPTY, samples: [] };
  try {
    const o = JSON.parse(raw) as Partial<VoiceState>;
    return {
      on: o.on !== false,
      samples: Array.isArray(o.samples) ? o.samples.filter((s): s is string => typeof s === "string").slice(0, VOICE_MAX) : [],
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
    };
  } catch {
    return { ...VOICE_EMPTY, samples: [] };
  }
}

/** Whitespace folded, links and @handles dropped (they say nothing about voice and could leak into copy). */
export function cleanSample(s: string) {
  return s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(^|\s)@[\w.]+/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_LEN);
}

/** Adds new captions to the front, skipping short ones and repeats; keeps the newest VOICE_MAX. */
export function addSamples(current: readonly string[], incoming: readonly string[], max = VOICE_MAX) {
  const out: string[] = [];
  const seen = new Set<string>();
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  for (const s of [...incoming.map(cleanSample), ...current]) {
    if (s.length < MIN_LEN || seen.has(key(s))) continue;
    seen.add(key(s));
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** The style note for the system prompt; empty until there are two samples (one caption is not a voice). */
export function voicePrompt(samples: readonly string[]) {
  if (samples.length < 2) return "";
  const list = samples.slice(0, VOICE_MAX).map((s, i) => `${i + 1}. """${s.replace(/"""/g, "'")}"""`).join("\n");
  return `\n\nThis creator's own voice, from captions they published:\n${list}\nMatch their sentence length, punctuation, casing, emoji habits and favourite words. Never copy a line from these, and never reuse their facts: the facts come only from the new story.`;
}
