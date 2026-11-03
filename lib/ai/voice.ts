import "server-only";
import { db } from "../db";
import { entitlements } from "../billing/entitlements";
import { hasPerk } from "../billing/plan-rules";
import { addSamples, parseVoice, voicePrompt, type VoiceState } from "./voice-core";

const key = (userId: string) => `voice:${userId}`;

export async function getVoice(userId: string): Promise<VoiceState> {
  const row = await db.setting.findUnique({ where: { key: key(userId) } });
  return parseVoice(row?.value);
}

async function save(userId: string, v: VoiceState) {
  const value = JSON.stringify(v);
  await db.setting.upsert({ where: { key: key(userId) }, create: { key: key(userId), value }, update: { value } });
}

const allowed = async (userId: string) => hasPerk(await entitlements(userId), "voice-memory");

/** Called when a post launches. Only for plans with voice memory, and only while the creator has it on. Never throws. */
export async function recordVoice(userId: string, captions: (string | null | undefined)[]) {
  try {
    const text = captions.filter((c): c is string => !!c && !!c.trim());
    if (!text.length || !(await allowed(userId))) return;
    const v = await getVoice(userId);
    if (!v.on) return;
    const samples = addSamples(v.samples, text);
    if (samples.join("\u0000") === v.samples.join("\u0000")) return;
    await save(userId, { on: true, samples, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[voice]", e);
  }
}

/** The style note to add to the AI's system prompt, or "" (no perk, switched off, or not enough samples yet). */
export async function voiceFor(userId: string) {
  try {
    if (!(await allowed(userId))) return "";
    const v = await getVoice(userId);
    return v.on ? voicePrompt(v.samples) : "";
  } catch {
    return "";
  }
}

export async function setVoiceOn(userId: string, on: boolean) {
  const v = await getVoice(userId);
  await save(userId, { ...v, on, samples: on ? v.samples : [], updatedAt: new Date().toISOString() });
}

export const clearVoice = (userId: string) => db.setting.deleteMany({ where: { key: key(userId) } });

export async function voiceStatus(userId: string) {
  const [perk, v] = await Promise.all([allowed(userId), getVoice(userId)]);
  return { perk, on: v.on, samples: v.samples.length, ready: v.samples.length >= 2, updatedAt: v.updatedAt, preview: v.samples.slice(0, 3) };
}
