import type { BehaviorResult } from "@/lib/admin/behavior";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import type { Tone } from "./ui";

export const pct = (r: number) => (r > 0 && r < 0.005 ? "<1%" : `${Math.round(r * 100)}%`);
export const pname = (p: string) => PLATFORM_META[p as Platform]?.name ?? p;
export const hoursText = (h: number | null) => (h === null ? "No one yet" : h < 1 ? "Under an hour" : h < 48 ? `${Math.round(h)} hours` : `${(h / 24).toFixed(1)} days`);
export const HEALTH: Record<BehaviorResult["health"], { tone: Tone; label: string }> = { strong: { tone: "ok", label: "Strong" }, steady: { tone: "info", label: "Steady" }, at_risk: { tone: "bad", label: "At risk" } };
export const LEVEL: Record<"low" | "medium" | "high", Tone> = { high: "lime", medium: "info", low: "muted" };
export const SEVERITY: Record<"low" | "medium" | "high", Tone> = { high: "bad", medium: "warn", low: "muted" };
