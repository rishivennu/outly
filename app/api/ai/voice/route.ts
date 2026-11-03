import { z } from "zod";
import { json, route } from "@/lib/http";
import { realUserId } from "@/lib/auth";
import { clearVoice, setVoiceOn, voiceStatus } from "@/lib/ai/voice";

/** Voice memory: what Outlly has learned from your captions (count and a short preview). */
export const GET = route(async (_req, { user }) => json(await voiceStatus(realUserId(user))));

const Put = z.object({ on: z.boolean() });

/** On or off. Turning it off also forgets the samples. */
export const PUT = route(async (req, { user }) => {
  const { on } = Put.parse(await req.json());
  await setVoiceOn(realUserId(user), on);
  return json(await voiceStatus(realUserId(user)));
}, { limit: [20, 60_000] });

/** Forget the samples but keep learning from the next posts. */
export const DELETE = route(async (_req, { user }) => {
  await clearVoice(realUserId(user));
  return json(await voiceStatus(realUserId(user)));
}, { limit: [20, 60_000] });
