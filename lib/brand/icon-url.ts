import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Icon URL plus a fingerprint of the file's bytes (1106). An installed Android app re-reads this manifest about
 * once a day and only swaps its home-screen icon when an icon changes. With a fixed URL it was often handed
 * yesterday's cached file and kept the old icon; now a new picture is a new URL, so it fetches the new one.
 */
export function iconUrl(path: string) {
  try {
    return `${path}?v=${createHash("sha256").update(readFileSync(join(process.cwd(), "public", path))).digest("hex").slice(0, 10)}`;
  } catch {
    return path;
  }
}
