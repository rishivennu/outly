/** Pure referral helpers (no DB), shared by the server code and the tests. */
export const REF_COOKIE = "ol_ref";
export const REF_DAYS = 30;
// No 0/O/1/I/L: codes get read aloud and typed by hand.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function makeCode(rand: (n: number) => number = (n) => Math.floor(Math.random() * n), len = 8) {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[rand(ALPHABET.length)];
  return s;
}

export const isCode = (c: unknown): c is string => typeof c === "string" && /^[a-z0-9]{6,16}$/.test(c);

/** Only a real, different user can be credited. */
export function referrerFor(cookie: string | undefined, me: { id: string; referredById?: string | null }, owner: { id: string } | null) {
  if (!cookie || !isCode(cookie) || !owner) return null;
  if (owner.id === me.id || me.referredById) return null;
  return owner.id;
}
