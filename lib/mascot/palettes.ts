/**
 * Pip colourways (2026-10-15). Same Pip everywhere: the glowing cloud, the blurred "heart light" inside,
 * the white line eyes. A palette only swaps the colours. The admin picks one palette per situation
 * (Admin > Setup > Mascot colours), and /api/pip-theme turns that choice into a few CSS variables.
 *
 * Pure and browser-safe: the admin picker and the Pip component both read it.
 */

export interface PipPalette {
  id: string;
  name: string;
  /** body gradient: light, mid, deep */
  body: [string, string, string];
  /** glassy rim: inner, outer */
  rim: [string, string];
  /** the heart light, four stops */
  core: [string, string, string, string];
  halo: string;
  edge: string;
  /** thinking dots and sleepy Zs */
  accent: string;
}

export const PIP_PALETTES: PipPalette[] = [
  { id: "indigo", name: "Indigo", body: ["#5b4cf5", "#3a2bd6", "#2a1c9e"], rim: ["#8d80ff", "#b4abff"], core: ["#ff5fb8", "#ffb13d", "#9ff218", "#3ee0ff"], halo: "#6c5cff", edge: "#c9c2ff", accent: "#b4abff" },
  { id: "ember", name: "Ember", body: ["#ff8a3d", "#e85d12", "#a8380a"], rim: ["#ffb27a", "#ffd29e"], core: ["#fff06a", "#ffd23d", "#ff9f1c", "#ff5fb8"], halo: "#ff7a1a", edge: "#ffd5b0", accent: "#ffb27a" },
  { id: "gold", name: "Gold", body: ["#ffcf3d", "#eea20c", "#a86d05"], rim: ["#ffe58a", "#fff3c2"], core: ["#ffffff", "#ff7a1a", "#ff5fb8", "#9ff218"], halo: "#ffc21a", edge: "#fff0b8", accent: "#f5c542" },
  { id: "lime", name: "Lime", body: ["#9be22a", "#62ad10", "#3b6e08"], rim: ["#c4f27a", "#e1ffaf"], core: ["#ffe14d", "#3ee0ff", "#ff5fb8", "#ffffff"], halo: "#9ff218", edge: "#e4ffc0", accent: "#a5dc4a" },
  { id: "mint", name: "Mint", body: ["#3fe0b4", "#14b088", "#0a7258"], rim: ["#9ff5da", "#d0fff0"], core: ["#ff5fb8", "#ffb13d", "#ffffff", "#3ee0ff"], halo: "#22d3a0", edge: "#c8fbe9", accent: "#5fd9b5" },
  { id: "ocean", name: "Ocean", body: ["#3fa9ff", "#1a6fe0", "#0f3f9e"], rim: ["#8fd0ff", "#c2e6ff"], core: ["#ff5fb8", "#9ff218", "#3ee0ff", "#ffffff"], halo: "#2f8cff", edge: "#c6e5ff", accent: "#7cc0ff" },
  { id: "lilac", name: "Lilac", body: ["#c3a6ff", "#9a7af0", "#6a4fc4"], rim: ["#ddccff", "#efe6ff"], core: ["#ffb13d", "#ff5fb8", "#3ee0ff", "#ffffff"], halo: "#a98bff", edge: "#e9dfff", accent: "#b9a0ff" },
  { id: "grape", name: "Grape", body: ["#a04cf5", "#7a22d6", "#4e129e"], rim: ["#c58dff", "#e0c2ff"], core: ["#ffb13d", "#ff5fb8", "#3ee0ff", "#9ff218"], halo: "#9a4cff", edge: "#dcc2ff", accent: "#c58dff" },
  { id: "rose", name: "Rose", body: ["#ff6fae", "#e0367f", "#9e1c55"], rim: ["#ffa3cc", "#ffd0e5"], core: ["#ffd23d", "#ffffff", "#9ff218", "#3ee0ff"], halo: "#ff4f9a", edge: "#ffcfe4", accent: "#ff8fbf" },
  { id: "sunset", name: "Sunset", body: ["#ff9a4d", "#f2545b", "#8e2a7a"], rim: ["#ffc38f", "#ffe0c2"], core: ["#ffe14d", "#ff5fb8", "#6c5cff", "#3ee0ff"], halo: "#ff6a4d", edge: "#ffd9c0", accent: "#ff9f7a" },
  { id: "storm", name: "Storm", body: ["#8a93a8", "#5d667c", "#3a4152"], rim: ["#b7bfd1", "#dde2ee"], core: ["#9fb6ff", "#c2d0ff", "#ffffff", "#9fe4ff"], halo: "#7a849c", edge: "#d6dbe8", accent: "#a3acc0" },
  { id: "midnight", name: "Midnight", body: ["#2b3350", "#171c33", "#0b0e1e"], rim: ["#5d6aa3", "#8e9bd6"], core: ["#6c5cff", "#3ee0ff", "#ff5fb8", "#ffb13d"], halo: "#3a4680", edge: "#7d8acc", accent: "#8e9bd6" },
];
export const PIP_PALETTE_IDS = PIP_PALETTES.map((p) => p.id) as [string, ...string[]];
export const paletteById = (id: string | undefined | null): PipPalette => PIP_PALETTES.find((p) => p.id === id) ?? PIP_PALETTES[0];

/** Moments Pip shows up in. The admin gives each its own colourway. */
export const PIP_SITUATIONS = [
  { id: "default", name: "Everyday", mood: "idle", hint: "Sidebar, help centre, support chat and anywhere else Pip just hangs out." },
  { id: "celebrate", name: "Celebrating", mood: "happy", hint: "Payment done, invite accepted, a goal hit." },
  { id: "streak", name: "Streak flame", mood: "happy", hint: "Pip inside the streak flame on Home." },
  { id: "idle", name: "Idle antics", mood: "wave", hint: "When nobody has touched the page for a while and Pip starts babbling." },
  { id: "thinking", name: "Thinking", mood: "think", hint: "Loading, reading your numbers, waiting on a reply." },
  { id: "oops", name: "Something went wrong", mood: "sad", hint: "Errors, failed payments, a page that would not load." },
  { id: "sleepy", name: "Resting", mood: "sleepy", hint: "Maintenance and quiet moments." },
] as const;
export type PipSituation = (typeof PIP_SITUATIONS)[number]["id"];
export const PIP_SITUATION_IDS = PIP_SITUATIONS.map((s) => s.id) as [PipSituation, ...PipSituation[]];

export interface MascotConfig {
  situations: Record<PipSituation, string>;
}
/** Out of the box Pip looks exactly as before (Indigo) except in the streak flame. */
export const MASCOT_DEFAULT: MascotConfig = {
  situations: { default: "indigo", celebrate: "indigo", streak: "ember", idle: "indigo", thinking: "indigo", oops: "indigo", sleepy: "indigo" },
};

/** Which situation a mood falls under when a caller doesn't say. */
export function moodSituation(mood: string): PipSituation {
  if (mood === "happy" || mood === "fly") return "celebrate";
  if (mood === "think" || mood === "wait") return "thinking";
  if (mood === "sad" || mood === "dizzy") return "oops";
  if (mood === "sleepy") return "sleepy";
  return "default";
}

const HEX = /^#[0-9a-f]{6}$/i;
/** CSS custom properties for one palette. Values come from the fixed list above, never from input. */
export function paletteVars(p: PipPalette): Record<string, string> {
  const all = [...p.body, ...p.rim, ...p.core, p.halo, p.edge, p.accent];
  if (!all.every((c) => HEX.test(c))) throw new Error(`bad palette ${p.id}`);
  return {
    "--pip-b0": p.body[0], "--pip-b1": p.body[1], "--pip-b2": p.body[2],
    "--pip-r0": p.rim[0], "--pip-r1": p.rim[1],
    "--pip-c0": p.core[0], "--pip-c1": p.core[1], "--pip-c2": p.core[2], "--pip-c3": p.core[3],
    "--pip-halo": p.halo, "--pip-edge": p.edge, "--pip-accent": p.accent,
  };
}

/** Clean a stored config: unknown situations dropped, unknown palette ids fall back to the default. */
export function normalizeMascot(raw: unknown): MascotConfig {
  const src = (raw && typeof raw === "object" ? (raw as { situations?: Record<string, unknown> }).situations : null) ?? {};
  const out = { ...MASCOT_DEFAULT.situations };
  for (const s of PIP_SITUATION_IDS) {
    const v = src[s];
    if (typeof v === "string" && PIP_PALETTE_IDS.includes(v)) out[s] = v;
  }
  return { situations: out };
}

/** The stylesheet /api/pip-theme serves. Only situations that differ from Indigo need a rule. */
export function mascotCss(cfg: MascotConfig): string {
  const c = normalizeMascot(cfg);
  const rule = (sel: string, id: string) =>
    `${sel}{${Object.entries(paletteVars(paletteById(id))).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  const lines = [rule(".pip", c.situations.default)];
  for (const s of PIP_SITUATION_IDS) if (s !== "default") lines.push(rule(`.pip.pip-sit-${s}`, c.situations[s]));
  return `/* Pip colourways, from Admin > Mascot colours */\n${lines.join("\n")}\n`;
}
