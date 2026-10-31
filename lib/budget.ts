/**
 * Time budgets (1079). A page that waits on a slow optional query should still render: the card that
 * needed it just sits out this visit. The query itself keeps running; only the page stops waiting.
 */

/** The promise's answer, or null once `ms` passes first. */
export async function withBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Like withBudget, but a failure or a timeout both answer `fallback`, and either one is logged under `tag`. */
export async function soft<T, F>(work: Promise<T>, ms: number, fallback: F, tag: string): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ late: true }>((r) => (timer = setTimeout(() => r({ late: true }), ms)));
  try {
    const out = await Promise.race([work.then((v) => ({ v })), late]);
    if ("late" in out) {
      console.warn(`[budget] ${tag} took over ${ms} ms, skipped`);
      return fallback;
    }
    return out.v;
  } catch (e) {
    console.error(`[budget] ${tag}`, e);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
