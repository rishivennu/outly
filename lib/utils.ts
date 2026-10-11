import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(s?: number | null) {
  if (s == null || !isFinite(s)) return "–";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function aspectLabel(w?: number | null, h?: number | null) {
  if (!w || !h) return "–";
  const r = w / h;
  const known: [number, string][] = [[9 / 16, "9:16"], [4 / 5, "4:5"], [1, "1:1"], [16 / 9, "16:9"], [4 / 3, "4:3"], [3 / 4, "3:4"]];
  const best = known.reduce((a, b) => (Math.abs(b[0] - r) < Math.abs(a[0] - r) ? b : a));
  return Math.abs(best[0] - r) < 0.03 ? best[1] : `${r.toFixed(2)}:1`;
}

export function resolutionLabel(w?: number | null, h?: number | null) {
  if (!w || !h) return "–";
  const short = Math.min(w, h);
  const tag = short >= 2160 ? "4K" : short >= 1440 ? "1440p" : short >= 1080 ? "1080p" : short >= 720 ? "720p" : `${short}p`;
  return `${tag} · ${w}×${h}`;
}

export function compact(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n);
}
