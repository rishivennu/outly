"use client";
import { useId } from "react";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CAPTION_LANGUAGES, languageName } from "@/lib/captions/languages";
import type { CaptionView } from "@/lib/captions/edit";

interface Props {
  /** "auto" or the creator's pick for the spoken language (sent to transcription as a hint). */
  hint: string;
  onHint: (code: string) => void;
  /** What the engine heard, "" when not known yet. */
  detected: string;
  disabled: boolean;
  /** Show "Translate to English" (hidden when the video is already in English or AI is off). */
  canTranslate: boolean;
  translating: boolean;
  onTranslate: () => void;
  hasEnglish: boolean;
  view: CaptionView;
  onView: (v: CaptionView) => void;
  untranslated: number;
  onTranslateMissing: () => void;
}

const seg =
  "min-h-11 min-w-0 flex-1 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";

/** Spoken language, the English translation and which track is on show. */
export function CaptionLanguage({ hint, onHint, detected, disabled, canTranslate, translating, onTranslate, hasEnglish, view, onView, untranslated, onTranslateMissing }: Props) {
  const id = useId();
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0">
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Spoken language</label>
        <select
          id={id}
          value={hint}
          disabled={disabled}
          onChange={(e) => onHint(e.target.value)}
          aria-describedby={detected ? `${id}-heard` : undefined}
          className="h-11 w-full min-w-0 rounded-xl bg-background/70 px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60"
        >
          <option value="auto">Detect it for me</option>
          {CAPTION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
        {detected && <p id={`${id}-heard`} className="mt-1 text-[12px] text-muted-foreground">We heard {languageName(detected)}.</p>}
      </div>
      {canTranslate && (
        <Button type="button" variant="outline" onClick={onTranslate} disabled={disabled}>
          {translating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Languages className="h-4 w-4" aria-hidden />}
          {translating ? "Translating…" : hasEnglish ? "Translate again" : "Translate to English"}
        </Button>
      )}
      {hasEnglish && (
        <div className="min-w-0 sm:col-span-2">
          <div role="radiogroup" aria-label="Caption track" className="gseg flex w-full max-w-sm rounded-2xl bg-secondary/60 p-1 hairline">
            {(["original", "english"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} disabled={disabled} onClick={() => onView(v)} className={cn(seg, view === v ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/15" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}>
                {v === "original" ? `Original${detected ? ` (${languageName(detected)})` : ""}` : "English"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Both tracks share the same timing. Preview, burn and .srt use the one on show.</p>
          {untranslated > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
              <span>{untranslated === 1 ? "1 line is" : `${untranslated} lines are`} not translated yet, so they show the original words.</span>
              <Button type="button" variant="ghost" onClick={onTranslateMissing} disabled={disabled}>Translate missing lines</Button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
