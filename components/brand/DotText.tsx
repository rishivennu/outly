"use client";
import { useMemo } from "react";

/* Dot-matrix letters, airport-board style. 5x7 glyphs, each pixel drawn as a 2x2 cluster of dots. */
const GLYPH: Record<string, string[]> = {
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
};
export function DotText({ text }: { text: string }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    [...text].forEach((ch, ci) => {
      const g = GLYPH[ch];
      if (!g) return;
      g.forEach((row, ry) =>
        [...row].forEach((on, rx) => {
          if (on !== "1") return;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) out.push({ x: ci * 12 + rx * 2 + dx, y: ry * 2 + dy });
        }),
      );
    });
    return out;
  }, [text]);
  const cols = text.length * 12 - 2;
  return (
    <svg aria-hidden="true" className="la-dots h-9 shrink-0" viewBox={`0 0 ${cols} 14`} style={{ aspectRatio: `${cols} / 14` }}>
      {dots.map((d, k) => (
        <circle key={k} cx={d.x + 0.5} cy={d.y + 0.5} r={0.46} fill="currentColor" />
      ))}
    </svg>
  );
}
