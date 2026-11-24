import "server-only";
import { db } from "@/lib/db";
import type { PerfRow } from "./aggregate";
import { PERF_KEEP_DAYS } from "./sample";
import type { PerfInput } from "./schema";

const PRUNE_ONE_IN = 50;
const DAY = 86_400_000;

/** A beacon that ran without a build id still lands under the version this server was built from. */
const serverVersion = () => (process.env.NEXT_PUBLIC_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || "dev").slice(0, 12);

/**
 * One row per page load. The client's load id is the primary key, so a beacon the browser retries (or a page that
 * fires twice) is stored once. Nothing identifies the person: no user id, no IP, no user agent.
 */
export async function savePerf(s: PerfInput, rand = Math.random) {
  const { id, flags, device, net, version, ...m } = s;
  // upsert with an empty update: a duplicate is a no-op, not a logged unique-constraint error.
  await db.perfSample.upsert({
    where: { id },
    update: {},
    create: {
      id,
      path: s.path,
      cold: s.cold,
      installed: s.installed,
      version: version ?? serverVersion(),
      flags: flags ?? null,
      device: device ?? null,
      net: net ?? null,
      ttfb: m.ttfb ?? null,
      fcp: m.fcp ?? null,
      lcp: m.lcp ?? null,
      cls: m.cls ?? null,
      inp: m.inp ?? null,
      hydrate: m.hydrate ?? null,
      content: m.content ?? null,
      mwMs: m.mwMs ?? null,
      userMs: m.userMs ?? null,
      cfgMs: m.cfgMs ?? null,
    },
  });
  // Opportunistic cleanup instead of a cron: about one write in 50 drops what is past the keep window.
  if (rand() < 1 / PRUNE_ONE_IN) await prunePerf().catch((e) => console.warn("[perf] prune", e));
}

export function prunePerf(now = Date.now()) {
  return db.perfSample.deleteMany({ where: { at: { lt: new Date(now - PERF_KEEP_DAYS * DAY) } } });
}

const ROW_CAP = 20_000;

export async function perfRows(since: Date): Promise<PerfRow[]> {
  return db.perfSample.findMany({
    where: { at: { gte: since } },
    orderBy: { at: "desc" },
    take: ROW_CAP,
    select: { at: true, cold: true, installed: true, version: true, ttfb: true, fcp: true, lcp: true, cls: true, inp: true, hydrate: true, content: true, mwMs: true, userMs: true, cfgMs: true },
  });
}
