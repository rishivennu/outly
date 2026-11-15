type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/** `fn` once the browser is idle (at most `timeout` ms later). Safari has no requestIdleCallback: 1.2 s instead. Returns a cancel. */
export function onIdle(fn: () => void, timeout = 2500): () => void {
  const w = window as IdleWindow;
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(t);
}

/** `fn` `ms` after now, then at the next idle moment. Returns a cancel. */
export function whenIdle(fn: () => void, ms = 2500) {
  const w = window as IdleWindow;
  let idle = 0;
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 4000 });
    else fn();
  }, ms);
  return () => {
    window.clearTimeout(t);
    if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle);
  };
}

/** `fn` once the page has fully loaded (document.readyState "complete"), at once if it already has. Returns a cancel. */
export function afterLoad(fn: () => void): () => void {
  if (document.readyState === "complete") {
    fn();
    return () => {};
  }
  const on = () => fn();
  window.addEventListener("load", on, { once: true });
  return () => window.removeEventListener("load", on);
}

/** Loaded, then `ms`, then idle: work that must never compete with the first paint or hydration. Returns a cancel. */
export function whenSettled(fn: () => void, ms = 0): () => void {
  let stop = () => {};
  const unload = afterLoad(() => (stop = whenIdle(fn, ms)));
  return () => {
    unload();
    stop();
  };
}
