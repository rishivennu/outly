/**
 * Runs the chunks of one transcription: the first chunk alone (it carries the one charge for the run and finds a
 * plan limit before anything else is spent), then the rest a few at a time. A chunk that fails for a passing
 * reason is retried with backoff; one that still fails is reported with its index so that part can be retried
 * later, and the other chunks still count. A plan or quota stop ends the run. Pure: no DOM, tested directly.
 */
export class ChunkFailure extends Error {
  constructor(message: string, public status = 0, public code = "", public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Codes that no retry can fix: the person has to do something first. */
const FINAL = new Set(["PLAN_LIMIT", "AI_QUOTA", "BUDGET_REACHED", "NO_AI", "TOO_LARGE", "BAD_TYPE", "EMPTY", "UNAUTHENTICATED", "FORBIDDEN"]);

export const isFinal = (e: ChunkFailure) => FINAL.has(e.code) || e.status === 401 || e.status === 402 || e.status === 403 || e.status === 413 || e.status === 415;

const abortError = () => new DOMException("Cancelled", "AbortError");

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      res();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      rej(abortError());
    };
    signal.addEventListener("abort", stop, { once: true });
  });

export type RunResult<T> = { results: Map<number, T>; failed: { index: number; error: ChunkFailure }[]; fatal: ChunkFailure | null };

export async function runChunks<T>(
  indices: number[],
  work: (index: number, signal: AbortSignal) => Promise<T>,
  o: { concurrency?: number; retries?: number; backoffMs?: number; signal?: AbortSignal; onDone?: (index: number, done: number, total: number) => void; onResult?: (index: number, value: T) => void } = {},
): Promise<RunResult<T>> {
  const concurrency = Math.max(1, Math.min(3, o.concurrency ?? 3));
  const retries = Math.max(0, o.retries ?? 2);
  const backoff = o.backoffMs ?? 800;
  const inner = new AbortController();
  const onOuter = () => inner.abort();
  o.signal?.addEventListener("abort", onOuter, { once: true });
  if (o.signal?.aborted) inner.abort();
  const results = new Map<number, T>();
  const failed: { index: number; error: ChunkFailure }[] = [];
  let fatal: ChunkFailure | null = null;
  let done = 0;

  const one = async (index: number) => {
    for (let attempt = 0; ; attempt++) {
      if (inner.signal.aborted) return;
      try {
        const value = await work(index, inner.signal);
        results.set(index, value);
        // Progressive: the caller shows this part's lines now, not when the whole run ends.
        if (!inner.signal.aborted) o.onResult?.(index, value);
        o.onDone?.(index, ++done, indices.length);
        return;
      } catch (err) {
        if (inner.signal.aborted || (err as Error)?.name === "AbortError") return;
        const e = err instanceof ChunkFailure ? err : new ChunkFailure((err as Error)?.message || "Transcription didn't come back.");
        if (isFinal(e)) {
          fatal ??= e;
          inner.abort();
          return;
        }
        if (attempt >= retries) {
          failed.push({ index, error: e });
          o.onDone?.(index, ++done, indices.length);
          return;
        }
        try {
          await wait(Math.min(20_000, Math.max(backoff * 2 ** attempt, (Number(e.data.retryAfter) || 0) * 1000)), inner.signal);
        } catch {
          return;
        }
      }
    }
  };

  try {
    const queue = [...indices];
    const first = queue.shift();
    if (first !== undefined) await one(first);
    const lanes = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length && !inner.signal.aborted) await one(queue.shift()!);
    });
    await Promise.all(lanes);
  } finally {
    o.signal?.removeEventListener("abort", onOuter);
  }
  if (o.signal?.aborted) throw abortError();
  failed.sort((a, b) => a.index - b.index);
  return { results, failed, fatal };
}
