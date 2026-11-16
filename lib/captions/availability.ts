import "server-only";
import { env } from "../env";
import { subtitleRules } from "../ai/engine-store";

export type TranscribeConfig = { geminiKey: string; groqKey?: string; provider: string; workerUrl: string; funasrUrl: string };

/** True when /api/ai/transcribe has an engine to call. Without one the editor offers typing only, never a fake transcript. */
/** R1177: a Groq key alone is enough, Whisper answers every part. */
export const transcriptionConfigured = (c: TranscribeConfig) => !!c.geminiKey || !!c.groqKey || (c.provider === "funasr" && !!(c.workerUrl || c.funasrUrl));

export async function transcriptionAvailable(): Promise<boolean> {
  const rules = await subtitleRules();
  return transcriptionConfigured({ geminiKey: env.GEMINI_API_KEY, groqKey: env.GROQ_API_KEY, provider: rules.provider, workerUrl: rules.workerUrl, funasrUrl: env.FUNASR_URL });
}
