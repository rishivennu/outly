/**
 * Deploy skew (1079). A tab opened before a deploy still asks for the old build's JS chunks, which the new
 * build no longer has, so a click or a lazy part fails to load and the page can sit on its loader. Reloading
 * fetches the new build. At most once a minute per tab (sessionStorage), never while offline, so it can't loop.
 */
export const CHUNK_KEY = "outlly-chunk-reload";
const BAD = /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkError(e: unknown): boolean {
  if (!e) return false;
  const x = e as { name?: string; message?: string };
  return BAD.test(`${x.name ?? ""} ${x.message ?? String(e)}`);
}

/** Reloads once; false when it already did within the minute (or can't tell), so the caller shows its screen. */
export function reloadOnce(): boolean {
  try {
    if (!navigator.onLine) return false;
    const t = Number(sessionStorage.getItem(CHUNK_KEY)) || 0;
    if (Date.now() - t < 60_000) return false;
    sessionStorage.setItem(CHUNK_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Inline in <head>, before any chunk loads: a missing build script or a failed dynamic import reloads once. */
export const chunkScript = `(function(){var K=${JSON.stringify(CHUNK_KEY)},B=${BAD.toString()};function go(){try{if(!navigator.onLine)return;var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<6e4)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){return}location.reload()}addEventListener("error",function(e){var s=e.target;if(s&&s.tagName==="SCRIPT"&&/\\/_next\\/static\\//.test(s.src||""))go();else if(e.error&&B.test((e.error.name||"")+" "+(e.error.message||"")))go()},true);addEventListener("unhandledrejection",function(e){var r=e.reason;if(r&&B.test((r.name||"")+" "+(r.message||String(r))))go()})})();`;
