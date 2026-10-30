"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";

/**
 * Six one-digit boxes for a 6-digit code (1060). Typing moves to the next box, Backspace on an empty box
 * steps back, arrow keys move freely, and pasting (or the phone's "From Messages" autofill, which lands
 * the whole code in one box) fills all six. The first box carries autocomplete="one-time-code" so iOS and
 * Android offer the code. `onComplete` fires once the sixth digit is in.
 *
 * Screen readers hear one group ("6-digit code") with each box labelled "Digit 1 of 6" and so on.
 */
export type OtpBoxesHandle = { focus: () => void };

export const OtpBoxes = forwardRef<OtpBoxesHandle, {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  id?: string;
}>(function OtpBoxes({ value, onChange, onComplete, label, disabled, invalid, describedBy, id = "otp" }, fwd) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.replace(/\D/g, "").slice(0, 6);
  // The latest digits, ahead of React's re-render: fast typing (or a test robot) lands the next key before
  // the new value is on screen, and focus moves at once so that key goes in the next box.
  const live = useRef(digits);
  live.current = digits;
  useImperativeHandle(fwd, () => ({ focus: () => boxes.current[Math.min(digits.length, 5)]?.focus() }), [digits.length]);

  const set = (next: string, focusAt: number) => {
    const v = next.replace(/\D/g, "").slice(0, 6);
    const was = live.current;
    live.current = v;
    onChange(v);
    boxes.current[Math.max(0, Math.min(focusAt, 5))]?.focus();
    if (v.length === 6 && v !== was) onComplete?.(v);
  };
  /** Put `typed` in at box i, overwriting from there on: one digit, or a whole pasted/autofilled code. */
  const put = (i: number, typed: string) => {
    const t = typed.replace(/\D/g, "");
    if (!t) return;
    // A whole code replaces whatever was there. Longer than 6 means it landed next to an old digit, and
    // the code is the newest 6 (the last ones), never the first 6, which would drop a digit.
    if (t.length >= 6) return set(t.slice(-6), 5);
    const arr = live.current.padEnd(6, " ").split("");
    for (let k = 0; k < t.length && i + k < 6; k++) arr[i + k] = t[k];
    // Boxes can't hold gaps: anything after a blank box is dropped, so the code always reads left to right.
    const joined = arr.join("");
    const gap = joined.indexOf(" ");
    set(gap === -1 ? joined : joined.slice(0, gap), i + t.length);
  };

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex justify-between gap-2 sm:gap-2.5">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          id={i === 0 ? id : `${id}-${i + 1}`}
          name={i === 0 ? id : undefined}
          value={digits[i] ?? ""}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          // Room for a whole autofilled code (plus the digit already there) in any box; `put` spreads it out.
          maxLength={7}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of 6`}
          aria-invalid={invalid || undefined}
          onFocus={(e) => {
            // Never let the caret sit in a box past the first empty one.
            const n = live.current.length;
            if (i > n) boxes.current[n]?.focus();
            else e.currentTarget.select();
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            const d = live.current;
            if (!raw) return set(d.slice(0, i), i); // cleared (e.g. a cut)
            // Typing (or an autofill) into a filled box that wasn't selected, common on Android: drop the digit
            // that was already there, on whichever side of the caret it sat, and keep only what's new.
            const had = d[i];
            const typed = had && raw.length > 1 ? (raw.startsWith(had) ? raw.slice(1) : raw.endsWith(had) ? raw.slice(0, -1) : raw) : raw;
            put(i, typed);
          }}
          onPaste={(e) => {
            e.preventDefault();
            put(i, e.clipboardData.getData("text"));
          }}
          onKeyDown={(e) => {
            const d = live.current;
            if (e.key === "Backspace") {
              e.preventDefault();
              if (d[i]) set(d.slice(0, i) + d.slice(i + 1), i);
              else if (i > 0) set(d.slice(0, i - 1) + d.slice(i), i - 1);
            } else if (e.key === "Delete") {
              e.preventDefault();
              set(d.slice(0, i) + d.slice(i + 1), i);
            } else if (e.key === "ArrowLeft" && i > 0) {
              e.preventDefault();
              boxes.current[i - 1]?.focus();
            } else if (e.key === "ArrowRight" && i < Math.min(d.length, 5)) {
              e.preventDefault();
              boxes.current[i + 1]?.focus();
            }
          }}
          className={
            "tabular h-14 w-full min-w-0 max-w-[3.25rem] rounded-xl border bg-card text-center text-[22px] font-semibold text-foreground caret-lime-ink shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-[border-color,box-shadow] duration-150 " +
            "focus:border-lime-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-60 " +
            (invalid ? "border-destructive/70" : digits[i] ? "border-foreground/60" : "border-foreground/35 hover:border-foreground/55")
          }
        />
      ))}
    </div>
  );
});
