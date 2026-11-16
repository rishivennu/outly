import "server-only";
import { env } from "../env";

const ENDPOINT = "https://api.indexnow.org/indexnow";

export const siteBase = () => env.APP_URL.replace(/\/+$/, "");

/**
 * Tells Bing, Yandex and the other IndexNow engines that these URLs changed. Optional (no key, no call) and
 * best effort: a slow or failing endpoint must never hold up or fail a publish, so this resolves, never rejects.
 */
export async function pingIndexNow(urls: string[]): Promise<{ sent: boolean; status?: number }> {
  const key = env.INDEXNOW_KEY.trim();
  const list = [...new Set(urls.filter(Boolean))];
  if (!key || !list.length) return { sent: false };
  try {
    const base = siteBase();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}/api/indexnow-key`, urlList: list }),
      signal: AbortSignal.timeout(5000),
    });
    // 200 and 202 both mean accepted; anything else is worth a log line, not an error.
    if (!res.ok) console.warn(`[indexnow] ${res.status} for ${list.length} url(s)`);
    return { sent: res.ok, status: res.status };
  } catch (e) {
    console.warn("[indexnow]", e instanceof Error ? e.message : e);
    return { sent: false };
  }
}
