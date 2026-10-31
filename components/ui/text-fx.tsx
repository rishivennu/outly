import { cn } from "@/lib/utils";

/**
 * FlipText (1069, after vennu-orcin.vercel.app): a label with two faces. When the link or button around
 * it is hovered or focused, the face tips back and away while the back face rolls up into place in lime,
 * and the back's letters scramble into the word (TextFx). `back` can say something else ("Let's go").
 *
 * The face is the real text, so the accessible name and copy-paste stay the plain label; the back is
 * aria-hidden. Both faces share one grid cell, so the box is as wide as the wider one and nothing shifts.
 * `tone="inherit"` keeps the back in the current text colour (for labels on a lime button or pill).
 * Reduced motion keeps the face still (globals.css).
 */
export function FlipText({ text, back, tone, className }: { text: string; back?: string; tone?: "inherit"; className?: string }) {
  const b = back ?? text;
  return (
    <span className={cn("ft", className)} data-tone={tone}>
      <span className="ft-face">{text}</span>
      <span className="ft-back" aria-hidden="true" data-text={b}>
        {b}
      </span>
    </span>
  );
}

/**
 * ScrambleText: short single-line text (eyebrows, small labels) that decodes from random characters.
 * `on`: "view" plays once when it scrolls into sight, "hover" each time the pointer arrives, "both" does both.
 * The real text never changes (TextFx runs the decode in an aria-hidden overlay), so screen readers, search
 * and copy-paste only ever see the words.
 */
export function ScrambleText({ text, on = "both", className }: { text: string; on?: "view" | "hover" | "both"; className?: string }) {
  return (
    <span className={cn("scr", className)} data-scramble={on}>
      <span className="scr-t">{text}</span>
    </span>
  );
}
