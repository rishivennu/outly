/** Spoken languages the caption editor offers. Gemini handles many more; these are the ones creators pick most. */
export type CaptionLanguage = { code: string; name: string };

export const CAPTION_LANGUAGES: CaptionLanguage[] = [
  { code: "en", name: "English" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "hi", name: "Hindi" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "or", name: "Odia" },
  { code: "as", name: "Assamese" },
  { code: "ne", name: "Nepali" },
  { code: "si", name: "Sinhala" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "ar", name: "Arabic" },
  { code: "id", name: "Indonesian" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
];

/** "auto", or a BCP-47 tag such as "te" or "pt-BR". Anything else is refused before it reaches a prompt. */
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** A model's language answer ("Telugu", "te-IN", " TE ") -> a short tag, or "" when it is not one. */
export function normalizeLang(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const byName = CAPTION_LANGUAGES.find((l) => l.name.toLowerCase() === s.toLowerCase());
  if (byName) return byName.code;
  const [base, region] = s.replace("_", "-").split("-");
  const tag = region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
  return LANG_RE.test(tag) ? tag : "";
}

/** "te" -> "Telugu"; an unknown tag is shown as it is. */
export function languageName(code: string): string {
  if (!code) return "";
  const base = code.split("-")[0].toLowerCase();
  return CAPTION_LANGUAGES.find((l) => l.code === base)?.name ?? code;
}

export const isEnglish = (code: string) => code.split("-")[0].toLowerCase() === "en";
