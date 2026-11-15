import { z } from "zod";
import { PERF_MAX_BYTES, PERF_MAX_MS, type PerfPayload } from "./sample";

const timing = z.number().int().min(0).max(PERF_MAX_MS).nullable().optional();

export const perfSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
    path: z.string().regex(/^\/[\w.:/-]{0,99}$/),
    cold: z.boolean(),
    installed: z.boolean(),
    version: z.string().regex(/^[\w.-]{1,40}$/).optional(),
    flags: z.enum(["hit", "stale", "miss", "timeout"]).optional(),
    device: z.string().regex(/^[a-z0-9.;]{1,40}$/).optional(),
    net: z.string().regex(/^[a-z0-9.;-]{1,40}$/).optional(),
    ttfb: timing,
    fcp: timing,
    lcp: timing,
    cls: z.number().int().min(0).max(100_000).nullable().optional(),
    inp: timing,
    hydrate: timing,
    content: timing,
    mwMs: timing,
    userMs: timing,
    cfgMs: timing,
  })
  .strict() satisfies z.ZodType<PerfPayload>;

export type PerfInput = z.infer<typeof perfSchema>;

export class PerfTooLarge extends Error {}

/** Size first (bytes, not characters), then shape. Throws PerfTooLarge, SyntaxError or ZodError. */
export function parsePerf(text: string): PerfInput {
  if (new TextEncoder().encode(text).length > PERF_MAX_BYTES) throw new PerfTooLarge("Perf sample too large");
  return perfSchema.parse(JSON.parse(text));
}
