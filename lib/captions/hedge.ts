/**
 * One chunk, several tries at once when the first is slow. Measured 11-16: the same model and audio answer in
 * 5-15 s most of the time and in 37-48 s now and then, so waiting out a straggler costs more than asking again.
 * `hedgeMs` after the first try starts with no answer, a second try of the same model starts; a try that fails
 * starts a fallback model at once. The first good answer wins and the rest are aborted. A rate limit ends the
 * race (more tries would only be refused too) so the caller can back off. Pure: no fetch, no env, tested directly.
 */
export type TryResult<T> = { ok: true; value: T } | { ok: false; reason: string; badTiming?: boolean; status?: number };
export type HedgeOutcome<T> =
  | { ok: true; value: T; model: string; tries: number; ms: number }
  | { ok: false; reason: string; badTiming: boolean; rateLimited: boolean; tries: number; ms: number };

export async function hedged<T>(o: {
  /** Asked first, and again for a hedge: a straggler is bad luck on one request, not a bad model. */
  primary: string;
  /** Asked in turn after a try fails (an error, or garbage times), the last one repeating; none = the primary again. */
  fallbacks?: string[];
  attempt: (model: string, signal: AbortSignal, timeoutMs: number) => Promise<TryResult<T>>;
  hedgeMs: number;
  budgetMs: number;
  /** A try of this model is not started with less than this left; a fallback that can't fit gives way to the primary. */
  minLeftMs?: (model: string) => number;
  maxTries?: number;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<HedgeOutcome<T>> {
  const now = o.now ?? Date.now;
  const t0 = now();
  const stopAt = t0 + o.budgetMs;
  const minLeft = o.minLeftMs ?? (() => 8_000);
  const maxTries = Math.max(1, o.maxTries ?? 3);
  const live = new Map<AbortController, string>();
  let tries = 0;
  let fell = 0;
  let lastErr = "";
  /** Every failure so far was garbage timing (not an outage), so the creator is told that. */
  let allBadTiming = true;
  let rateLimited = false;
  let settled = false;
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<HedgeOutcome<T>>((resolve) => {
    const finish = (r: HedgeOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(endTimer);
      for (const c of live.keys()) c.abort();
      live.clear();
      o.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const fail = () => finish({ ok: false, reason: lastErr || "no answer", badTiming: tries > 0 && allBadTiming && !!lastErr, rateLimited, tries, ms: now() - t0 });
    const onAbort = () => {
      lastErr = "cancelled";
      allBadTiming = false;
      fail();
    };
    const pick = (afterFailure: boolean, left: number): string | null => {
      const fb = o.fallbacks ?? [];
      const want = afterFailure && fb.length ? fb[Math.min(fell, fb.length - 1)] : o.primary;
      if (afterFailure && fb.length) fell++;
      if (left >= minLeft(want)) return want;
      return want !== o.primary && left >= minLeft(o.primary) ? o.primary : null;
    };
    const start = (afterFailure: boolean): boolean => {
      const left = stopAt - now();
      if (settled || rateLimited || tries >= maxTries || o.signal?.aborted) return false;
      const model = pick(afterFailure, left);
      if (!model) return false;
      tries++;
      const c = new AbortController();
      live.set(c, model);
      Promise.resolve()
        .then(() => o.attempt(model, o.signal ? AbortSignal.any([o.signal, c.signal]) : c.signal, left))
        .catch((e): TryResult<T> => ({ ok: false, reason: (e as Error)?.message || "error" }))
        .then((r) => {
          live.delete(c);
          if (settled) return;
          if (r.ok) return finish({ ok: true, value: r.value, model, tries, ms: now() - t0 });
          lastErr = r.reason;
          if (!r.badTiming) allBadTiming = false;
          if (r.status === 429) rateLimited = true;
          // A failure starts the next try now; with nothing left to start and nothing out, the chunk failed.
          if (!start(true) && live.size === 0) fail();
        });
      return true;
    };
    if (o.signal?.aborted) return onAbort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    // However the tries behave, the race ends inside its budget.
    endTimer = setTimeout(() => {
      // A try still out ran out of time, which is not a timing problem.
      if (live.size) allBadTiming = false;
      if (!lastErr || live.size) lastErr = "timed out";
      fail();
    }, Math.max(0, o.budgetMs));
    if (!start(false)) return fail();
    hedgeTimer = setTimeout(() => {
      // Only a slow primary is hedged: a fallback already out was started for a failure, not for slowness.
      if (!settled && live.size === 1 && [...live.values()][0] === o.primary) start(false);
    }, o.hedgeMs);
  });
}

/** When to ask again: lite answers about 0.25 s per second of audio plus a few seconds, so a try well past that is a straggler. */
export const hedgeAfterMs = (audioSeconds: number) => Math.round(Math.min(24_000, Math.max(9_000, 6_000 + audioSeconds * 300)));
