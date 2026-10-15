/**
 * Orb avatars (2026-10-15): a soft, glowing sphere in one colour with a bold black face near the top.
 * Stored on User.avatar as "orb:<colour>:<face>". A real photo URL still wins; anything else
 * (null, junk) falls back to a default orb picked from a stable seed (email or id), so every
 * person keeps the same orb on every screen and device.
 */
export const ORB_COLORS = [
  { id: "sun", name: "Sun", light: "#fff3c4", base: "#f7cf5c", deep: "#eeb43a" },
  { id: "mint", name: "Mint", light: "#c9f5dc", base: "#5fd394", deep: "#36b56f" },
  { id: "dusk", name: "Dusk", light: "#d5dafc", base: "#8792e6", deep: "#5d68cf" },
  { id: "ember", name: "Ember", light: "#fbc6c2", base: "#e86b67", deep: "#c84646" },
  { id: "peach", name: "Peach", light: "#ffd9bd", base: "#f39a58", deep: "#e07a35" },
  { id: "sky", name: "Sky", light: "#d4ecff", base: "#74c1fa", deep: "#47a5ef" },
  { id: "lilac", name: "Lilac", light: "#f3e8ff", base: "#d4b6f1", deep: "#b48edd" },
  { id: "lagoon", name: "Lagoon", light: "#c6ecf7", base: "#4fb3d8", deep: "#2b8fbb" },
  { id: "rose", name: "Rose", light: "#fdd3ea", base: "#ea78b3", deep: "#d24f93" },
] as const;

/** Faces read as moods, named kindly: people pick these for themselves. */
export const ORB_FACES = [
  { id: "joy", name: "Joy" },
  { id: "cheeky", name: "Cheeky" },
  { id: "calm", name: "Calm" },
  { id: "fierce", name: "Fierce" },
  { id: "focus", name: "Focused" },
  { id: "soft", name: "Soft" },
  { id: "shy", name: "Shy" },
  { id: "starry", name: "Starry" },
  { id: "blush", name: "Blush" },
] as const;

export type OrbColor = (typeof ORB_COLORS)[number]["id"];
export type OrbFace = (typeof ORB_FACES)[number]["id"];
export type Orb = { color: OrbColor; face: OrbFace };

const COLOR_IDS = ORB_COLORS.map((c) => c.id) as string[];
const FACE_IDS = ORB_FACES.map((f) => f.id) as string[];

/** Each colour has a "home" face (the pairing in the reference set), used for defaults. */
const HOME_FACE: Record<OrbColor, OrbFace> = { sun: "joy", mint: "cheeky", dusk: "calm", ember: "fierce", peach: "focus", sky: "soft", lilac: "shy", lagoon: "starry", rose: "blush" };

export const ORB_RE = /^orb:([a-z]+):([a-z]+)$/;

export const orbValue = (o: Orb) => `orb:${o.color}:${o.face}`;

export function isOrbValue(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = v.match(ORB_RE);
  return !!m && COLOR_IDS.includes(m[1]) && FACE_IDS.includes(m[2]);
}

/** FNV-1a: tiny, stable on server and browser. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function defaultOrb(seed: string): Orb {
  const color = ORB_COLORS[hash(seed.trim().toLowerCase() || "outlly") % ORB_COLORS.length].id;
  return { color, face: HOME_FACE[color] };
}

/** Photo URL wins; then a valid saved orb; otherwise the seed's default orb. */
export function resolveAvatar(avatar: string | null | undefined, seed: string): { photo: string } | { orb: Orb } {
  if (avatar && /^https:\/\/[^\s"'<>]+$/i.test(avatar)) return { photo: avatar };
  if (isOrbValue(avatar)) {
    const [, color, face] = avatar.match(ORB_RE)!;
    return { orb: { color: color as OrbColor, face: face as OrbFace } };
  }
  return { orb: defaultOrb(seed) };
}

export const orbColor = (id: OrbColor) => ORB_COLORS.find((c) => c.id === id) ?? ORB_COLORS[0];
