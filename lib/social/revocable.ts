/** Platforms whose OAuth has a documented revoke call (1095). Client-safe; lib/social/revoke.ts does the calls. */
import type { Platform } from "../domain";

export const REVOCABLE_PLATFORMS: readonly Platform[] = ["youtube", "x", "tiktok"];
