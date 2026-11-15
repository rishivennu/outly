import "server-only";
import { unstable_cache } from "next/cache";
import { settingTag } from "./settings";

// A deploy can add default fields to a setting; an entry built by an older build must not stand in for them.
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "local";

/** Next throws these when there is no request around (tests, workers, scripts): there is no shared cache to use. */
export const outsideNext = (e: unknown) => /incrementalCache missing|static generation store missing/.test(String((e as Error)?.message ?? e));

/**
 * Perf (startup): a value built from site-wide admin settings, kept in Next's shared data cache so a cold function
 * instance answers without a database round trip before its first byte. saveConfig expires the tags, so an admin
 * change still lands at once; `revalidate` only bounds the age if an expiry were ever missed. Never per-user data,
 * and never secrets: whatever `fn` returns is stored outside this process.
 */
export function sharedSetting<T>(name: string, keys: string[], revalidate: number, fn: () => Promise<T>): () => Promise<T> {
  const cached = unstable_cache(fn, ["setting", name, BUILD], { revalidate, tags: keys.map(settingTag) });
  return async () => {
    try {
      return await cached();
    } catch (e) {
      if (outsideNext(e)) return fn();
      throw e;
    }
  };
}
