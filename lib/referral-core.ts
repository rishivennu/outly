/** Pure referral helpers (no DB), shared by the server code and the tests. */
export const REF_COOKIE = "ol_ref";
export const REF_DAYS = 30;
// No 0/O/1/I/L: codes get read aloud and typed by hand.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

// crypto.getRandomValues (not Math.random): codes must not be predictable, or attribution can be stolen.
const secureRand = (n: number) => {
  const max = Math.floor(0x100000000 / n) * n; // rejection sampling keeps every letter equally likely
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= max);
  return buf[0] % n;
};

export function makeCode(rand: (n: number) => number = secureRand, len = 8) {
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
