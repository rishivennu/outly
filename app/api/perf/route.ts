import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/http";
import { PERF_MAX_BYTES } from "@/lib/perf/sample";
import { parsePerf, PerfTooLarge } from "@/lib/perf/schema";
import { savePerf } from "@/lib/perf/store";

export const dynamic = "force-dynamic";

/**
 * Startup timings from components/shell/PerfBeacon.tsx, one per page load. Signed-in only (the beacon lives in the
 * studio layout), so route() can rate limit per user; the row itself stores no user, IP or user agent.
 */
export const POST = route(
  async (req) => {
    if (Number(req.headers.get("content-length") ?? 0) > PERF_MAX_BYTES) throw new HttpError(413, "Too large", "TOO_LARGE");
    const text = await req.text();
    try {
      await savePerf(parsePerf(text));
    } catch (e) {
      if (e instanceof PerfTooLarge) throw new HttpError(413, "Too large", "TOO_LARGE");
      throw e;
    }
    return new NextResponse(null, { status: 204 });
  },
  { limit: [12, 60_000] },
);
