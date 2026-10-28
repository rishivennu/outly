/** Landing trust figures (1037), pure. A figure only shows once it is big enough to mean something; nothing is rounded up. */
export type TrustCounts = { creators: number; posts: number; platforms: number };
export const TRUST_MIN = { creators: 50, posts: 100 } as const;

/** Rounds DOWN to a friendly step, so "1,240" reads "1,200+" and never more than the truth. */
export function floorNice(n: number) {
  const step = n >= 10_000 ? 1000 : n >= 1000 ? 100 : n >= 100 ? 10 : 1;
  return Math.floor(n / step) * step;
}

export function trustFigures(c: TrustCounts) {
  const out: { value: string; label: string }[] = [];
  if (c.creators >= TRUST_MIN.creators) out.push({ value: `${floorNice(c.creators).toLocaleString("en-US")}+`, label: "creators signed up" });
  if (c.posts >= TRUST_MIN.posts) out.push({ value: `${floorNice(c.posts).toLocaleString("en-US")}+`, label: "posts published for real" });
  if (c.platforms > 0) out.push({ value: String(c.platforms), label: c.platforms === 1 ? "platform live today" : "platforms live today" });
  return out;
}
