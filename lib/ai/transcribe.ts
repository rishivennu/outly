import "server-only";
import { env } from "../env";
import { HttpError } from "../http";
import { normalizeCues, type Cue } from "../captions/cues";

const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const PROMPT = `Transcribe the speech in this audio for on-screen video captions.
Return JSON {"language": BCP-47 code, "cues": [{"start": seconds, "end": seconds, "text": what was said}]}.
Rules: keep the speaker's exact words and language (do not translate), fix only obvious filler like "um"; each cue at most 8 words; times in seconds from the start of THIS audio, as numbers; no cues for music or silence. If nobody speaks, return {"language":"", "cues": []}.`;

/** One chunk of 16 kHz mono WAV -> cues offset to where the chunk sits in the video. */
export async function transcribeWav(wav: ArrayBuffer, offset: number, duration: number): Promise<{ cues: Cue[]; language: string }> {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "AI transcription needs a Gemini API key on the server. You can still type or paste your captions.", "NO_AI");
  const data = Buffer.from(wav).toString("base64");
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data } }, { text: PROMPT }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) {
        lastErr = `${model} ${r.status}`;
        continue;
      }
      const j = await r.json();
      const txt: string | undefined = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
      if (!txt) continue;
      const parsed = JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
      const raw = Array.isArray(parsed) ? parsed : parsed.cues ?? [];
      return { cues: normalizeCues(raw, offset + duration, offset), language: String(parsed.language ?? "") };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new HttpError(502, `Transcription didn't come back (${lastErr || "no answer"}). Try again, or type your captions.`, "AI_FAILED");
}
