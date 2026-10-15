import { PLATFORMS } from "@/lib/domain";

/** Destinations the client still wants, de-duplicated and in a stable order. */
export function keepPlatforms(targets: { platform: string }[]): string[] {
  const want = new Set(targets.map((t) => t.platform));
  return PLATFORMS.filter((p) => want.has(p));
}

/** Destinations that were switched off: their targets are deleted so nothing can publish to them. */
export function removedPlatforms(current: { platform: string }[], keep: string[]): string[] {
  return current.map((t) => t.platform).filter((p) => !keep.includes(p));
}
